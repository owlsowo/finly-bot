import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  alignSeriesByDate,
  calculatePortfolioMetrics,
  fetchYahooAdjustedSeries,
  quantile,
  rebaseRowsForStandalonePeriod,
  round,
  rowsWithin,
  sha256,
  simulateStrategy,
} from "./champion_engine.mjs";
import { CORE_SYMBOLS, createPrimaryStrategies } from "./champion_strategies.mjs";
import {
  createGeneration3Strategies,
  GENERATION3_ADDITIONAL_SYMBOLS,
  GENERATION3_METADATA,
} from "./champion_strategies_generation3.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolPath = resolve(projectRoot, "research/champion_search_generation3_protocol.json");
const ledgerPath = resolve(projectRoot, "research/champion_trial_ledger.json");
const outputDirectory = resolve(projectRoot, "research/output");
const privateDirectory = resolve(projectRoot, "data/private/champion_search");
const jsonOutput = resolve(outputDirectory, "quant_champion_generation3.json");
const reportOutput = resolve(outputDirectory, "quant_champion_generation3_report.md");

const SYMBOLS = Object.freeze([...CORE_SYMBOLS, ...GENERATION3_ADDITIONAL_SYMBOLS]);
const BASELINE_IDS = Object.freeze([
  "bil_cash",
  "spy_buy_hold",
  "qqq_buy_hold",
  "spy_levered_150",
  "spy_vol_target_15",
  "frozen_finly",
]);
const CANDIDATE_IDS = Object.freeze(createGeneration3Strategies().map((strategy) => strategy.id));

const SLICES = Object.freeze({
  development: Object.freeze({ start: "2008-06-02", end: "2017-12-29" }),
  validation_selection: Object.freeze({ start: "2018-01-02", end: "2024-12-31" }),
  consumed_recent_diagnostic: Object.freeze({ start: "2025-01-02", end: "2026-08-28" }),
  requested_2013_2015: Object.freeze({ start: "2013-01-01", end: "2015-12-31" }),
  post_2013_full_history: Object.freeze({ start: "2013-01-01", end: "2026-08-28" }),
});

const BASE_OPTIONS = Object.freeze({
  cashSymbol: "BIL",
  lookbackSessions: 252,
  rebalanceIntervalSessions: 21,
  rebalanceAnchor: 0,
  oneWayCostBps: 5,
  annualBorrowSpread: 0.005,
  maximumRiskyGross: 1.5,
  terminalLiquidation: true,
});

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function atomicWriteBuffer(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { mode: 0o600 });
  await rename(temporary, path);
}

function sha256Bytes(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

async function fetchWithRetry(symbol, range, attempts = 3) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchYahooAdjustedSeries(symbol, range);
    } catch (error) {
      failure = error;
      if (attempt === attempts) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 500));
    }
  }
  throw failure;
}

async function fetchInBatches(symbols, range, batchSize = 5) {
  const results = [];
  for (let index = 0; index < symbols.length; index += batchSize) {
    results.push(...await Promise.all(symbols.slice(index, index + batchSize).map((symbol) => fetchWithRetry(symbol, range))));
  }
  return results;
}

function annualizedLogGrowth(metrics) {
  return Math.log1p(metrics.total_return) * 252 / metrics.observations;
}

function standalone(rows) {
  return rebaseRowsForStandalonePeriod(rows, {
    cashSymbol: BASE_OPTIONS.cashSymbol,
    oneWayCostBps: BASE_OPTIONS.oneWayCostBps,
  });
}

function metricsForSlice(simulations, slice) {
  return Object.fromEntries(simulations.map((simulation) => [
    simulation.id,
    calculatePortfolioMetrics(standalone(rowsWithin(simulation.rows, slice.start, slice.end))),
  ]));
}

function annualWindows(candidateRows, spyRows, sessions) {
  const candidate = rowsWithin(candidateRows, SLICES.validation_selection.start, SLICES.validation_selection.end);
  const spyByDate = new Map(rowsWithin(spyRows, SLICES.validation_selection.start, SLICES.validation_selection.end)
    .map((row) => [row.execution_return_date, row]));
  const aligned = candidate.filter((row) => spyByDate.has(row.execution_return_date));
  const starts = aligned.map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index === 0 || row.execution_return_date.slice(0, 4) !== aligned[index - 1].execution_return_date.slice(0, 4))
    .map(({ index }) => index);
  return Object.freeze(starts.filter((index) => index + sessions <= aligned.length).map((index) => {
    const candidateMetrics = calculatePortfolioMetrics(standalone(aligned.slice(index, index + sessions)));
    const spyMetrics = calculatePortfolioMetrics(standalone(aligned.slice(index, index + sessions)
      .map((row) => spyByDate.get(row.execution_return_date))));
    const edge = annualizedLogGrowth(candidateMetrics) - annualizedLogGrowth(spyMetrics);
    return Object.freeze({
      start_date: candidateMetrics.start_date,
      end_date: candidateMetrics.end_date,
      candidate_total_return: candidateMetrics.total_return,
      spy_total_return: spyMetrics.total_return,
      annualized_log_growth_difference: round(edge),
      beats_spy: candidateMetrics.total_return > spyMetrics.total_return,
    });
  }));
}

function rollingEvidence(simulations) {
  const byId = new Map(simulations.map((simulation) => [simulation.id, simulation]));
  const spy = byId.get("spy_buy_hold");
  return Object.fromEntries(CANDIDATE_IDS.map((id) => [id, Object.fromEntries([252, 504, 756].map((sessions) => {
    const windows = annualWindows(byId.get(id).rows, spy.rows, sessions);
    const edges = windows.map((window) => window.annualized_log_growth_difference);
    return [sessions, Object.freeze({
      windows,
      count: windows.length,
      median_annualized_log_growth_difference: round(edges.length > 0 ? quantile(edges, 0.5) : null),
      positive_fraction: windows.length > 0 ? round(windows.filter((window) => window.beats_spy).length / windows.length) : null,
    })];
  }))]));
}

function select(metrics, rolling) {
  const dev = metrics.development;
  const val = metrics.validation_selection;
  const assessments = CANDIDATE_IDS.map((id) => {
    const devEdge = annualizedLogGrowth(dev[id]) - annualizedLogGrowth(dev.spy_buy_hold);
    const valEdge = annualizedLogGrowth(val[id]) - annualizedLogGrowth(val.spy_buy_hold);
    const rollingGates = Object.fromEntries([252, 504, 756].flatMap((sessions) => [
      [`rolling_${sessions}_median_positive`, rolling[id][sessions].median_annualized_log_growth_difference > 0],
      [`rolling_${sessions}_positive_fraction_60pct`, rolling[id][sessions].positive_fraction >= 0.60],
    ]));
    const gates = Object.freeze({
      development_log_growth_exceeds_spy: devEdge > 0,
      validation_log_growth_exceeds_spy: valEdge > 0,
      validation_edge_at_least_50bp: valEdge >= 0.005,
      validation_volatility_not_above_spy: val[id].annualized_volatility <= val.spy_buy_hold.annualized_volatility,
      validation_drawdown_within_2pp_spy: val[id].maximum_drawdown >= val.spy_buy_hold.maximum_drawdown - 0.02,
      validation_sharpe_exceeds_frozen_by_10bp: val[id].cash_excess_sharpe >= val.frozen_finly.cash_excess_sharpe + 0.10,
      validation_sharpe_exceeds_vol_target_by_10bp: val[id].cash_excess_sharpe >= val.spy_vol_target_15.cash_excess_sharpe + 0.10,
      validation_drawdown_within_2pp_frozen: val[id].maximum_drawdown >= val.frozen_finly.maximum_drawdown - 0.02,
      validation_drawdown_no_worse_15pct: val[id].maximum_drawdown >= -0.15,
      ...rollingGates,
    });
    return Object.freeze({
      id,
      development_annualized_log_growth_edge: round(devEdge),
      validation_annualized_log_growth_edge: round(valEdge),
      robust_raw_score: round(Math.min(devEdge, valEdge)),
      eligible_before_robustness: Object.values(gates).every(Boolean),
      gates,
    });
  });
  const ranked = [...assessments].sort((left, right) => right.robust_raw_score - left.robust_raw_score
    || right.validation_annualized_log_growth_edge - left.validation_annualized_log_growth_edge
    || left.id.localeCompare(right.id));
  return Object.freeze({
    selected_id_before_robustness: ranked.find((item) => item.eligible_before_robustness)?.id ?? null,
    ranked_candidate_ids: Object.freeze(ranked.map((item) => item.id)),
    assessments: Object.freeze(Object.fromEntries(assessments.map((item) => [item.id, item]))),
    recent_used_for_selection: false,
  });
}

function renderReport(report) {
  const rows = report.selection.ranked_candidate_ids.map((id) => {
    const assessment = report.selection.assessments[id];
    const dev = report.metrics.development[id];
    const val = report.metrics.validation_selection[id];
    const failures = Object.entries(assessment.gates).filter(([, passed]) => !passed).map(([gate]) => gate).join(", ") || "none";
    return `| ${id} | ${(100 * dev.total_return).toFixed(2)}% | ${(100 * val.total_return).toFixed(2)}% | ${(100 * assessment.development_annualized_log_growth_edge).toFixed(2)}% | ${(100 * assessment.validation_annualized_log_growth_edge).toFixed(2)}% | ${(100 * val.maximum_drawdown).toFixed(2)}% | ${failures} |`;
  }).join("\n");
  return `# Finly Generation 3 quantitative search\n\nProtocol: \`${report.protocol_sha256}\`  \nPanel: \`${report.dataset.normalized_panel_sha256}\`\n\n## Answer first\n\nSelected before robustness: **${report.selection.selected_id_before_robustness ?? "none"}**. Disposition: **${report.disposition}**. This is retrospective revised-data evidence only.\n\n| Candidate | Dev return | Validation return | Dev log-growth edge | Validation edge | Validation drawdown | Failed gates |\n|---|---:|---:|---:|---:|---:|---|\n${rows}\n\nSPY returned ${(100 * report.metrics.development.spy_buy_hold.total_return).toFixed(2)}% in development and ${(100 * report.metrics.validation_selection.spy_buy_hold.total_return).toFixed(2)}% in validation under identical standalone costs. Recent history was veto-only and did not rank candidates.\n`;
}

const protocolRaw = await readFile(protocolPath, "utf8");
const ledgerRaw = await readFile(ledgerPath, "utf8");
const protocol = JSON.parse(protocolRaw);
const ledger = JSON.parse(ledgerRaw);
if (ledger.append_only_through !== protocol.trial_accounting.cumulative_effective_trials
  || ledger.blocks.reduce((sum, block) => sum + block.count, 0) !== ledger.append_only_through) {
  throw new Error("trial ledger does not match Generation 3 protocol");
}
const fetched = await fetchInBatches(SYMBOLS, { start: protocol.data.requested_start, end: protocol.data.requested_end });
const panel = alignSeriesByDate(fetched, SYMBOLS);
const strategies = [
  ...createPrimaryStrategies().filter((strategy) => BASELINE_IDS.includes(strategy.id)),
  ...createGeneration3Strategies(),
];
const simulations = strategies.map((strategy) => simulateStrategy(panel.points, SYMBOLS, strategy, BASE_OPTIONS));

const panelPayload = `${JSON.stringify({
  schema_version: "finly_generation3_private_panel.v1",
  protocol_sha256: sha256(protocolRaw),
  normalized_panel_sha256: panel.normalized_panel_sha256,
  provenance: Object.fromEntries(fetched.map((result) => [result.symbol, result.provenance])),
  points: panel.points,
})}\n`;
const panelPayloadSha = sha256(panelPayload);
const panelFilename = `generation3_panel_${panelPayloadSha}.json`;
await atomicWrite(resolve(privateDirectory, panelFilename), panelPayload);
const ledgerBuffer = gzipSync(JSON.stringify({
  schema_version: "finly_generation3_private_ledger.v1",
  normalized_panel_sha256: panel.normalized_panel_sha256,
  simulations: Object.fromEntries(simulations.map((simulation) => [simulation.id, simulation.rows])),
}));
const ledgerPayloadSha = sha256Bytes(ledgerBuffer);
const ledgerFilename = `generation3_ledger_${ledgerPayloadSha}.json.gz`;
await atomicWriteBuffer(resolve(privateDirectory, ledgerFilename), ledgerBuffer);

const metrics = Object.fromEntries(Object.entries(SLICES).map(([sliceId, slice]) => [sliceId, metricsForSlice(simulations, slice)]));
const rolling = rollingEvidence(simulations);
const selection = select(metrics, rolling);
let recentVeto = null;
if (selection.selected_id_before_robustness) {
  const recent = metrics.consumed_recent_diagnostic[selection.selected_id_before_robustness];
  const recentSpy = metrics.consumed_recent_diagnostic.spy_buy_hold;
  recentVeto = Object.freeze({
    hard_safety_veto: recent.maximum_drawdown < -0.20
      || recent.total_return < metrics.consumed_recent_diagnostic.bil_cash.total_return
      || recent.maximum_drawdown < recentSpy.maximum_drawdown - 0.05,
    candidate_metrics: recent,
  });
}
const disposition = selection.selected_id_before_robustness && !recentVeto?.hard_safety_veto ? "ROBUSTNESS_PENDING" : "KEEP_V1";
const report = Object.freeze({
  schema_version: "finly_quant_champion_generation3.v1",
  generated_at: new Date().toISOString(),
  protocol_sha256: sha256(protocolRaw),
  trial_ledger_sha256: sha256(ledgerRaw),
  trial_count: ledger.append_only_through,
  dataset: Object.freeze({
    symbols: SYMBOLS,
    common_start: panel.common_start,
    common_end: panel.common_end,
    common_sessions: panel.common_sessions,
    normalized_panel_sha256: panel.normalized_panel_sha256,
    private_panel_filename: panelFilename,
    private_panel_payload_sha256: panelPayloadSha,
    private_ledger_filename: ledgerFilename,
    private_ledger_gzip_sha256: ledgerPayloadSha,
    provenance: Object.fromEntries(fetched.map((result) => [result.symbol, result.provenance])),
  }),
  execution: BASE_OPTIONS,
  strategy_metadata: GENERATION3_METADATA,
  metrics,
  rolling_validation_evidence: rolling,
  selection,
  recent_veto: recentVeto,
  disposition,
});
await atomicWrite(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(reportOutput, renderReport(report));
process.stdout.write(`${JSON.stringify({
  ok: true,
  protocol_sha256: report.protocol_sha256,
  panel_sha256: panel.normalized_panel_sha256,
  selected_id_before_robustness: selection.selected_id_before_robustness,
  ranked_candidate_ids: selection.ranked_candidate_ids,
  disposition,
  json: jsonOutput,
  report: reportOutput,
}, null, 2)}\n`);
