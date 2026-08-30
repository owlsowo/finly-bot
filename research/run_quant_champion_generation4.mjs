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
  createGeneration4Strategies,
  GENERATION4_METADATA,
} from "./champion_strategies_generation4.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolPath = resolve(projectRoot, "research/champion_search_generation4_protocol.json");
const trialLedgerPath = resolve(projectRoot, "research/champion_trial_ledger_generation4.json");
const outputDirectory = resolve(projectRoot, "research/output");
const privateDirectory = resolve(projectRoot, "data/private/champion_search");
const jsonOutput = resolve(outputDirectory, "quant_champion_generation4.json");
const reportOutput = resolve(outputDirectory, "quant_champion_generation4_report.md");

const BASELINE_IDS = Object.freeze([
  "bil_cash",
  "spy_buy_hold",
  "qqq_buy_hold",
  "spy_levered_150",
  "spy_vol_target_15",
  "frozen_finly",
]);
const ALL_GENERATION4_IDS = Object.freeze(createGeneration4Strategies().map((strategy) => strategy.id));
const CANDIDATE_IDS = Object.freeze(ALL_GENERATION4_IDS.filter((id) => GENERATION4_METADATA[id].role === "candidate"));

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
  maximumRiskyGross: 1,
  terminalLiquidation: true,
});
const LEVERED_DIAGNOSTIC_OPTIONS = Object.freeze({ ...BASE_OPTIONS, maximumRiskyGross: 1.5 });

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

function annualWindows(candidateRows, benchmarkRows, sessions) {
  const candidate = rowsWithin(candidateRows, SLICES.validation_selection.start, SLICES.validation_selection.end);
  const benchmarkByDate = new Map(rowsWithin(benchmarkRows, SLICES.validation_selection.start, SLICES.validation_selection.end)
    .map((row) => [row.execution_return_date, row]));
  const aligned = candidate.filter((row) => benchmarkByDate.has(row.execution_return_date));
  const starts = aligned.map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index === 0 || row.execution_return_date.slice(0, 4) !== aligned[index - 1].execution_return_date.slice(0, 4))
    .map(({ index }) => index);
  return Object.freeze(starts.filter((index) => index + sessions <= aligned.length).map((index) => {
    const candidateMetrics = calculatePortfolioMetrics(standalone(aligned.slice(index, index + sessions)));
    const benchmarkMetrics = calculatePortfolioMetrics(standalone(aligned.slice(index, index + sessions)
      .map((row) => benchmarkByDate.get(row.execution_return_date))));
    const edge = annualizedLogGrowth(candidateMetrics) - annualizedLogGrowth(benchmarkMetrics);
    return Object.freeze({
      start_date: candidateMetrics.start_date,
      end_date: candidateMetrics.end_date,
      candidate_total_return: candidateMetrics.total_return,
      benchmark_total_return: benchmarkMetrics.total_return,
      annualized_log_growth_difference: round(edge),
      beats_benchmark: candidateMetrics.total_return > benchmarkMetrics.total_return,
    });
  }));
}

function summarizeWindows(windows) {
  const edges = windows.map((window) => window.annualized_log_growth_difference);
  return Object.freeze({
    windows,
    count: windows.length,
    median_annualized_log_growth_difference: round(edges.length > 0 ? quantile(edges, 0.5) : null),
    positive_fraction: windows.length > 0
      ? round(windows.filter((window) => window.beats_benchmark).length / windows.length)
      : null,
  });
}

function rollingEvidence(simulations) {
  const byId = new Map(simulations.map((simulation) => [simulation.id, simulation]));
  const spy = byId.get("spy_buy_hold");
  const growthControl = byId.get("static_spy_qqq_50_50_control");
  return Object.fromEntries(CANDIDATE_IDS.map((id) => [id, Object.fromEntries([252, 504, 756].map((sessions) => [
    sessions,
    Object.freeze({
      versus_spy: summarizeWindows(annualWindows(byId.get(id).rows, spy.rows, sessions)),
      versus_static_growth_control: summarizeWindows(annualWindows(byId.get(id).rows, growthControl.rows, sessions)),
    }),
  ]))]));
}

function buildAssessments(metrics, rolling) {
  const dev = metrics.development;
  const val = metrics.validation_selection;
  return Object.freeze(Object.fromEntries(CANDIDATE_IDS.map((id) => {
    const devEdge = annualizedLogGrowth(dev[id]) - annualizedLogGrowth(dev.spy_buy_hold);
    const valEdge = annualizedLogGrowth(val[id]) - annualizedLogGrowth(val.spy_buy_hold);
    const rollingGates = Object.fromEntries([252, 504, 756].flatMap((sessions) => [
      [`rolling_${sessions}_median_spy_edge_positive`, rolling[id][sessions].versus_spy.median_annualized_log_growth_difference > 0],
      [`rolling_${sessions}_spy_win_fraction_60pct`, rolling[id][sessions].versus_spy.positive_fraction >= 0.60],
    ]));
    const rawGates = Object.freeze({
      development_log_growth_exceeds_spy: devEdge > 0,
      validation_log_growth_exceeds_spy: valEdge > 0,
      validation_edge_at_least_50bp: valEdge >= 0.005,
      validation_drawdown_within_2pp_spy: val[id].maximum_drawdown >= val.spy_buy_hold.maximum_drawdown - 0.02,
      validation_volatility_not_above_qqq: val[id].annualized_volatility <= val.qqq_buy_hold.annualized_volatility,
      ...rollingGates,
    });
    const balancedAdditionalGates = Object.freeze({
      validation_volatility_not_above_spy: val[id].annualized_volatility <= val.spy_buy_hold.annualized_volatility,
      validation_sharpe_exceeds_frozen_by_10bp: val[id].cash_excess_sharpe >= val.frozen_finly.cash_excess_sharpe + 0.10,
      validation_sharpe_exceeds_vol_target_by_10bp: val[id].cash_excess_sharpe >= val.spy_vol_target_15.cash_excess_sharpe + 0.10,
      validation_drawdown_within_2pp_frozen: val[id].maximum_drawdown >= val.frozen_finly.maximum_drawdown - 0.02,
      validation_drawdown_no_worse_15pct: val[id].maximum_drawdown >= -0.15,
    });
    return [id, Object.freeze({
      id,
      development_annualized_log_growth_edge_vs_spy: round(devEdge),
      validation_annualized_log_growth_edge_vs_spy: round(valEdge),
      robust_raw_score: round(Math.min(devEdge, valEdge)),
      raw_gates: rawGates,
      balanced_additional_gates: balancedAdditionalGates,
      raw_eligible_before_recent_and_robustness: Object.values(rawGates).every(Boolean),
      balanced_eligible_before_recent_and_robustness: Object.values(rawGates).every(Boolean)
        && Object.values(balancedAdditionalGates).every(Boolean),
    })];
  })));
}

function rankAssessments(assessments, eligibilityField) {
  const ranked = Object.values(assessments).sort((left, right) => right.robust_raw_score - left.robust_raw_score
    || right.validation_annualized_log_growth_edge_vs_spy - left.validation_annualized_log_growth_edge_vs_spy
    || left.id.localeCompare(right.id));
  return Object.freeze({
    ranked_candidate_ids: Object.freeze(ranked.map((item) => item.id)),
    selected_id_before_recent_and_robustness: ranked.find((item) => item[eligibilityField])?.id ?? null,
  });
}

function recentVetoFor(candidateId, metrics) {
  if (!candidateId) return Object.freeze({ applicable: false, hard_safety_veto: false, reasons: Object.freeze([]) });
  const recent = metrics.consumed_recent_diagnostic[candidateId];
  const spy = metrics.consumed_recent_diagnostic.spy_buy_hold;
  const bil = metrics.consumed_recent_diagnostic.bil_cash;
  const reasons = [];
  if (recent.maximum_drawdown < -0.20) reasons.push("recent maximum drawdown below -20%");
  if (recent.total_return < bil.total_return) reasons.push("recent total return trailed BIL");
  if (recent.maximum_drawdown < spy.maximum_drawdown - 0.05) reasons.push("recent drawdown over five points worse than SPY");
  return Object.freeze({
    applicable: true,
    hard_safety_veto: reasons.length > 0,
    reasons: Object.freeze(reasons),
    metrics: recent,
  });
}

function renderReport(report) {
  const rows = report.raw_return_track.ranked_candidate_ids.map((id) => {
    const item = report.assessments[id];
    const val = report.metrics.validation_selection[id];
    const rawFailures = Object.entries(item.raw_gates).filter(([, passed]) => !passed).map(([gate]) => gate).join(", ") || "none";
    return `| ${id} | ${(100 * item.development_annualized_log_growth_edge_vs_spy).toFixed(2)}% | ${(100 * item.validation_annualized_log_growth_edge_vs_spy).toFixed(2)}% | ${(100 * val.annualized_volatility).toFixed(2)}% | ${(100 * val.maximum_drawdown).toFixed(2)}% | ${rawFailures} |`;
  }).join("\n");
  const control = report.metrics.validation_selection.static_spy_qqq_50_50_control;
  return `# Finly Generation 4 quantitative search\n\nProtocol: \`${report.protocol_sha256}\`  \nPanel: \`${report.dataset.normalized_panel_sha256}\`\n\n## Answer first\n\nRaw-return candidate before robustness: **${report.raw_return_track.selected_id_before_recent_and_robustness ?? "none"}**. Balanced candidate: **${report.balanced_track.selected_id_before_recent_and_robustness ?? "none"}**. Disposition: **${report.disposition}**.\n\n| Candidate | Development SPY edge | Validation SPY edge | Validation vol | Validation drawdown | Failed raw gates |\n|---|---:|---:|---:|---:|---|\n${rows}\n\nThe mandatory static 50/50 SPY/QQQ control returned ${(100 * control.total_return).toFixed(2)}% in validation. It is not an agent and cannot win selection; it exists to expose how much apparent SPY outperformance is merely a growth tilt. Every result is retrospective and remains unproven prospectively.\n`;
}

const protocolRaw = await readFile(protocolPath, "utf8");
const trialLedgerRaw = await readFile(trialLedgerPath, "utf8");
const protocol = JSON.parse(protocolRaw);
const trialLedger = JSON.parse(trialLedgerRaw);
if (trialLedger.append_only_through !== protocol.trial_accounting.cumulative_effective_trials
  || trialLedger.blocks.reduce((sum, block) => sum + block.count, 0) !== trialLedger.append_only_through) {
  throw new Error("Generation 4 trial ledger does not match its protocol");
}
const fetched = await fetchInBatches(CORE_SYMBOLS, {
  start: protocol.data.requested_start,
  end: protocol.data.requested_end,
});
const panel = alignSeriesByDate(fetched, CORE_SYMBOLS);
const strategies = [
  ...createPrimaryStrategies().filter((strategy) => BASELINE_IDS.includes(strategy.id)),
  ...createGeneration4Strategies(),
];
const simulations = strategies.map((strategy) => simulateStrategy(
  panel.points,
  CORE_SYMBOLS,
  strategy,
  strategy.id === "spy_levered_150" ? LEVERED_DIAGNOSTIC_OPTIONS : BASE_OPTIONS,
));
const panelPayload = `${JSON.stringify({
  schema_version: "finly_generation4_private_panel.v1",
  protocol_sha256: sha256(protocolRaw),
  normalized_panel_sha256: panel.normalized_panel_sha256,
  provenance: Object.fromEntries(fetched.map((result) => [result.symbol, result.provenance])),
  points: panel.points,
})}\n`;
const panelPayloadSha = sha256(panelPayload);
const panelFilename = `generation4_panel_${panelPayloadSha}.json`;
await atomicWrite(resolve(privateDirectory, panelFilename), panelPayload);
const ledgerBuffer = gzipSync(JSON.stringify({
  schema_version: "finly_generation4_private_ledger.v1",
  normalized_panel_sha256: panel.normalized_panel_sha256,
  simulations: Object.fromEntries(simulations.map((simulation) => [simulation.id, simulation.rows])),
}));
const ledgerPayloadSha = sha256Bytes(ledgerBuffer);
const ledgerFilename = `generation4_ledger_${ledgerPayloadSha}.json.gz`;
await atomicWriteBuffer(resolve(privateDirectory, ledgerFilename), ledgerBuffer);

const metrics = Object.fromEntries(Object.entries(SLICES).map(([sliceId, slice]) => [sliceId, metricsForSlice(simulations, slice)]));
const rolling = rollingEvidence(simulations);
const assessments = buildAssessments(metrics, rolling);
const rawRank = rankAssessments(assessments, "raw_eligible_before_recent_and_robustness");
const balancedRank = rankAssessments(assessments, "balanced_eligible_before_recent_and_robustness");
const rawVeto = recentVetoFor(rawRank.selected_id_before_recent_and_robustness, metrics);
const balancedVeto = recentVetoFor(balancedRank.selected_id_before_recent_and_robustness, metrics);
const rawReturnTrack = Object.freeze({ ...rawRank, recent_veto: rawVeto });
const balancedTrack = Object.freeze({ ...balancedRank, recent_veto: balancedVeto });
const disposition = balancedRank.selected_id_before_recent_and_robustness && !balancedVeto.hard_safety_veto
  ? "BALANCED_ROBUSTNESS_PENDING"
  : rawRank.selected_id_before_recent_and_robustness && !rawVeto.hard_safety_veto
    ? "RAW_RETURN_ROBUSTNESS_PENDING"
    : "KEEP_V1";
const report = Object.freeze({
  schema_version: "finly_quant_champion_generation4.v1",
  generated_at: new Date().toISOString(),
  protocol_sha256: sha256(protocolRaw),
  trial_ledger_sha256: sha256(trialLedgerRaw),
  trial_count: trialLedger.append_only_through,
  dataset: Object.freeze({
    symbols: CORE_SYMBOLS,
    common_start: panel.common_start,
    common_end: panel.common_end,
    common_sessions: panel.common_sessions,
    normalized_panel_sha256: panel.normalized_panel_sha256,
    dropped_noncommon_sessions: panel.dropped_noncommon_sessions,
    private_panel_filename: panelFilename,
    private_panel_payload_sha256: panelPayloadSha,
    private_ledger_filename: ledgerFilename,
    private_ledger_gzip_sha256: ledgerPayloadSha,
    provenance: Object.fromEntries(fetched.map((result) => [result.symbol, result.provenance])),
  }),
  execution: Object.freeze({
    primary: BASE_OPTIONS,
    levered_spy_diagnostic: LEVERED_DIAGNOSTIC_OPTIONS,
  }),
  strategy_metadata: GENERATION4_METADATA,
  metrics,
  rolling_validation_evidence: rolling,
  assessments,
  raw_return_track: rawReturnTrack,
  balanced_track: balancedTrack,
  disposition,
});
await atomicWrite(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(reportOutput, renderReport(report));
process.stdout.write(`${JSON.stringify({
  ok: true,
  protocol_sha256: report.protocol_sha256,
  panel_sha256: panel.normalized_panel_sha256,
  raw_selected: rawRank.selected_id_before_recent_and_robustness,
  balanced_selected: balancedRank.selected_id_before_recent_and_robustness,
  disposition,
  json: jsonOutput,
  report: reportOutput,
}, null, 2)}\n`);
