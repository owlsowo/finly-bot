import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  alignSeriesByDate,
  calculatePortfolioMetrics,
  compareMetrics,
  fetchYahooAdjustedSeries,
  quantile,
  round,
  rowsWithin,
  sha256,
  simulateStrategy,
} from "./champion_engine.mjs";
import {
  buildEnsembleStrategies,
  CORE_SYMBOLS,
  createPrimaryStrategies,
  STRATEGY_METADATA,
} from "./champion_strategies.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolPath = resolve(projectRoot, "research/champion_search_protocol.json");
const outputDirectory = resolve(projectRoot, "research/output");
const jsonOutput = resolve(outputDirectory, "quant_champion_search.json");
const reportOutput = resolve(outputDirectory, "quant_champion_search_report.md");

const SLICES = Object.freeze({
  development: Object.freeze({ start: "2008-06-02", end: "2017-12-29" }),
  validation_selection: Object.freeze({ start: "2018-01-02", end: "2024-12-31" }),
  consumed_recent_diagnostic: Object.freeze({ start: "2025-01-02", end: "2026-08-28" }),
  requested_2013_2015: Object.freeze({ start: "2013-01-01", end: "2015-12-31" }),
  post_2013_full_history: Object.freeze({ start: "2013-01-01", end: "2026-08-28" }),
  gfc: Object.freeze({ start: "2008-06-02", end: "2009-12-31" }),
  covid_2020: Object.freeze({ start: "2020-01-01", end: "2020-12-31" }),
  inflation_2022: Object.freeze({ start: "2022-01-01", end: "2022-12-31" }),
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

function annualizedLogGrowth(metrics) {
  if (!metrics || metrics.observations < 2 || metrics.total_return <= -1) return null;
  return Math.log1p(metrics.total_return) * 252 / metrics.observations;
}

function median(values) {
  return quantile(values, 0.5);
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
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
    const batch = symbols.slice(index, index + batchSize);
    results.push(...await Promise.all(batch.map((symbol) => fetchWithRetry(symbol, range))));
  }
  return results;
}

function simulateFamily(points, options = BASE_OPTIONS) {
  const primary = createPrimaryStrategies().map((strategy) => simulateStrategy(points, CORE_SYMBOLS, strategy, options));
  const ensembleBuild = buildEnsembleStrategies(primary, points, CORE_SYMBOLS);
  const ensembles = ensembleBuild.strategies.map((strategy) => simulateStrategy(points, CORE_SYMBOLS, strategy, options));
  return Object.freeze({
    simulations: Object.freeze([...primary, ...ensembles]),
    online_probability_history: ensembleBuild.online_probability_history,
  });
}

function metricsForSlice(simulations, slice) {
  return Object.fromEntries(simulations.map((simulation) => [
    simulation.id,
    calculatePortfolioMetrics(rowsWithin(simulation.rows, slice.start, slice.end)),
  ]));
}

function metricsBySlice(simulations) {
  return Object.fromEntries(Object.entries(SLICES).map(([id, slice]) => [id, metricsForSlice(simulations, slice)]));
}

function compareAllToSpy(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([id, values]) => [id, compareMetrics(values, metrics.spy_buy_hold)]));
}

function annualOriginWindows(candidateRows, spyRows, sessions) {
  const spyByDate = new Map(spyRows.map((row) => [row.execution_return_date, row]));
  const alignedCandidate = candidateRows.filter((row) => spyByDate.has(row.execution_return_date));
  const starts = [];
  for (let index = 0; index < alignedCandidate.length; index += 1) {
    const date = alignedCandidate[index].execution_return_date;
    if (index === 0 || date.slice(0, 4) !== alignedCandidate[index - 1].execution_return_date.slice(0, 4)) starts.push(index);
  }
  return starts.filter((start) => start + sessions <= alignedCandidate.length).map((start) => {
    const candidateWindow = alignedCandidate.slice(start, start + sessions);
    const spyWindow = candidateWindow.map((row) => spyByDate.get(row.execution_return_date));
    const candidate = calculatePortfolioMetrics(candidateWindow);
    const spy = calculatePortfolioMetrics(spyWindow);
    return Object.freeze({
      start_date: candidate.start_date,
      end_date: candidate.end_date,
      candidate_annualized_log_growth: round(annualizedLogGrowth(candidate)),
      spy_annualized_log_growth: round(annualizedLogGrowth(spy)),
      annualized_log_growth_difference: round(annualizedLogGrowth(candidate) - annualizedLogGrowth(spy)),
      candidate_total_return: candidate.total_return,
      spy_total_return: spy.total_return,
      beats_spy: candidate.total_return > spy.total_return,
    });
  });
}

function rollingEvidence(simulations) {
  const byId = new Map(simulations.map((simulation) => [simulation.id, simulation]));
  const spy = byId.get("spy_buy_hold");
  return Object.fromEntries(Object.entries(STRATEGY_METADATA)
    .filter(([, metadata]) => metadata.role === "candidate")
    .map(([id]) => {
      const candidate = byId.get(id);
      const horizons = Object.fromEntries([252, 504, 756].map((sessions) => {
        const windows = annualOriginWindows(candidate.rows, spy.rows, sessions);
        const differences = windows.map((window) => window.annualized_log_growth_difference);
        return [sessions, Object.freeze({
          windows: Object.freeze(windows),
          count: windows.length,
          median_annualized_log_growth_difference: round(median(differences)),
          positive_fraction: round(windows.filter((window) => window.beats_spy).length / windows.length),
        })];
      }));
      return [id, Object.freeze(horizons)];
    }));
}

function selectionEvidence(metrics, rolling) {
  const development = metrics.development;
  const validation = metrics.validation_selection;
  const candidates = Object.entries(STRATEGY_METADATA).filter(([, metadata]) => metadata.role === "candidate").map(([id]) => id);
  const assessments = candidates.map((id) => {
    const dev = development[id];
    const val = validation[id];
    const devSpy = development.spy_buy_hold;
    const valSpy = validation.spy_buy_hold;
    const valFrozen = validation.frozen_finly;
    const valVolTarget = validation.spy_vol_target_15;
    const devRaw = annualizedLogGrowth(dev) - annualizedLogGrowth(devSpy);
    const valRaw = annualizedLogGrowth(val) - annualizedLogGrowth(valSpy);
    const rollingGates = Object.fromEntries([252, 504, 756].flatMap((sessions) => {
      const evidence = rolling[id][sessions];
      return [
        [`rolling_${sessions}_median_raw_excess_positive`, evidence.median_annualized_log_growth_difference > 0],
        [`rolling_${sessions}_positive_fraction_at_least_60pct`, evidence.positive_fraction >= 0.60],
      ];
    }));
    const gates = Object.freeze({
      development_raw_log_growth_exceeds_spy: devRaw > 0,
      validation_raw_log_growth_exceeds_spy: valRaw > 0,
      validation_raw_advantage_at_least_50bp: valRaw >= 0.005,
      validation_volatility_not_above_spy: val.annualized_volatility <= valSpy.annualized_volatility,
      validation_drawdown_not_over_2pp_worse_than_spy: val.maximum_drawdown >= valSpy.maximum_drawdown - 0.02,
      validation_sharpe_exceeds_frozen_by_10bp: val.cash_excess_sharpe >= valFrozen.cash_excess_sharpe + 0.10,
      validation_sharpe_exceeds_vol_target_by_10bp: val.cash_excess_sharpe >= valVolTarget.cash_excess_sharpe + 0.10,
      validation_drawdown_not_over_2pp_worse_than_frozen: val.maximum_drawdown >= valFrozen.maximum_drawdown - 0.02,
      validation_drawdown_not_worse_than_15pct: val.maximum_drawdown >= -0.15,
      ...rollingGates,
    });
    return Object.freeze({
      id,
      eligible_before_cost_schedule_statistics: Object.values(gates).every(Boolean),
      development_annualized_log_growth_advantage_vs_spy: round(devRaw),
      validation_annualized_log_growth_advantage_vs_spy: round(valRaw),
      robust_raw_score: round(Math.min(devRaw, valRaw)),
      validation_sharpe_tiebreaker: val.cash_excess_sharpe,
      validation_drawdown_tiebreaker: val.maximum_drawdown,
      gates,
    });
  });
  const ranked = [...assessments].sort((left, right) => right.robust_raw_score - left.robust_raw_score
    || right.validation_sharpe_tiebreaker - left.validation_sharpe_tiebreaker
    || right.validation_drawdown_tiebreaker - left.validation_drawdown_tiebreaker
    || left.id.localeCompare(right.id));
  const eligible = ranked.filter((assessment) => assessment.eligible_before_cost_schedule_statistics);
  return Object.freeze({
    selected_id_before_robustness: eligible[0]?.id ?? null,
    ranked_candidate_ids: Object.freeze(ranked.map((assessment) => assessment.id)),
    assessments: Object.freeze(Object.fromEntries(assessments.map((assessment) => [assessment.id, assessment]))),
    recent_interval_used_for_selection: false,
  });
}

function recentVeto(metrics, selection) {
  if (!selection.selected_id_before_robustness) return Object.freeze({ applicable: false, hard_safety_veto: false, reasons: [] });
  const candidate = metrics.consumed_recent_diagnostic[selection.selected_id_before_robustness];
  const spy = metrics.consumed_recent_diagnostic.spy_buy_hold;
  const reasons = [];
  if (candidate.maximum_drawdown < -0.20) reasons.push("recent maximum drawdown breached 20%");
  if (candidate.total_return < metrics.consumed_recent_diagnostic.bil_cash.total_return) reasons.push("recent return trailed BIL");
  if (candidate.maximum_drawdown < spy.maximum_drawdown - 0.05) reasons.push("recent drawdown was over five points worse than SPY");
  return Object.freeze({ applicable: true, hard_safety_veto: reasons.length > 0, reasons: Object.freeze(reasons) });
}

function strategyTable(metrics, comparisons) {
  return Object.keys(STRATEGY_METADATA).map((id) => {
    const value = metrics[id];
    const comparison = comparisons[id];
    return `| ${id} | ${(100 * value.total_return).toFixed(2)}% | ${(100 * value.annualized_return).toFixed(2)}% | ${(100 * value.annualized_volatility).toFixed(2)}% | ${value.cash_excess_sharpe?.toFixed(3) ?? "n/a"} | ${(100 * value.maximum_drawdown).toFixed(2)}% | ${(100 * comparison.total_return_difference).toFixed(2)}% |`;
  }).join("\n");
}

function renderReport(report) {
  const selection = report.selection;
  const selected = selection.selected_id_before_robustness ?? "none";
  const slices = ["development", "validation_selection", "consumed_recent_diagnostic", "requested_2013_2015", "post_2013_full_history"];
  const sections = slices.map((sliceId) => `## ${sliceId.replaceAll("_", " ")}\n\n| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Return minus SPY |\n|---|---:|---:|---:|---:|---:|---:|\n${strategyTable(report.metrics[sliceId], report.comparisons_to_spy[sliceId])}`).join("\n\n");
  const assessmentRows = selection.ranked_candidate_ids.map((id) => {
    const item = selection.assessments[id];
    const failures = Object.entries(item.gates).filter(([, passed]) => !passed).map(([gate]) => gate).join(", ") || "none";
    return `| ${id} | ${(100 * item.development_annualized_log_growth_advantage_vs_spy).toFixed(2)}% | ${(100 * item.validation_annualized_log_growth_advantage_vs_spy).toFixed(2)}% | ${item.eligible_before_cost_schedule_statistics ? "yes" : "no"} | ${failures} |`;
  }).join("\n");
  return `# Finly quantitative champion search\n\nGenerated: ${report.generated_at}\n\nProtocol SHA-256: \`${report.protocol_sha256}\`  \nPanel SHA-256: \`${report.dataset.normalized_panel_sha256}\`\n\n## Answer first\n\nThe pre-robustness selector chose **${selected}**. Historical disposition: **${report.disposition}**. This is a retrospective, revised-data research result; no historical interval is represented as a fresh prospective test.\n\n${sections}\n\n## Selection gates\n\n| Candidate | Development log-growth edge | Validation log-growth edge | Eligible before robustness | Failed gates |\n|---|---:|---:|---:|---|\n${assessmentRows}\n\nThe consumed 2025-2026 interval was not used for ranking or tie-breaking. Recent hard-safety veto: **${report.recent_veto.hard_safety_veto ? "yes" : "no"}**.\n\n## Claim boundary\n\nA historical pass can earn only SHADOW_ONLY. It cannot prove future profitability, faithful options P&L, or superiority to unreproducible competitor submissions. Leverage and QQQ buy-and-hold remain visible baselines so a SPY beat cannot be attributed silently to either.\n`;
}

const protocolRaw = await readFile(protocolPath, "utf8");
const protocol = JSON.parse(protocolRaw);
const protocolSha256 = sha256(protocolRaw);
const yahooResults = await fetchInBatches(CORE_SYMBOLS, {
  start: protocol.data.requested_start,
  end: protocol.data.requested_end,
});
const panel = alignSeriesByDate(yahooResults, CORE_SYMBOLS);
const family = simulateFamily(panel.points, BASE_OPTIONS);
const metrics = metricsBySlice(family.simulations);
const comparisons = Object.fromEntries(Object.entries(metrics).map(([sliceId, values]) => [sliceId, compareAllToSpy(values)]));
const rolling = rollingEvidence(family.simulations);
const selection = selectionEvidence(metrics, rolling);
const veto = recentVeto(metrics, selection);
const disposition = selection.selected_id_before_robustness && !veto.hard_safety_veto ? "ROBUSTNESS_PENDING" : "KEEP_V1";

const report = Object.freeze({
  schema_version: "finly_quant_champion_search.v1",
  generated_at: new Date().toISOString(),
  protocol_sha256: protocolSha256,
  protocol,
  claim_boundary: protocol.claim_boundary,
  dataset: Object.freeze({
    provider: "Yahoo Finance chart endpoint adjusted close",
    symbols: CORE_SYMBOLS,
    common_start: panel.common_start,
    common_end: panel.common_end,
    common_sessions: panel.common_sessions,
    scored_start: family.simulations[0].rows[0].execution_return_date,
    scored_end: family.simulations[0].rows.at(-1).execution_return_date,
    scored_sessions: family.simulations[0].rows.length,
    dropped_noncommon_sessions: panel.dropped_noncommon_sessions,
    normalized_panel_sha256: panel.normalized_panel_sha256,
    source_provenance: Object.fromEntries(yahooResults.map((result) => [result.symbol, result.provenance])),
  }),
  execution: BASE_OPTIONS,
  strategy_metadata: STRATEGY_METADATA,
  metrics,
  comparisons_to_spy: comparisons,
  rolling_annual_origin_evidence: rolling,
  selection,
  recent_veto: veto,
  online_probability_history: family.online_probability_history,
  disposition,
  next_required_stage: disposition === "ROBUSTNESS_PENDING"
    ? "Run every 21-session rebalance offset, 10/25 bp costs, paired block inference, and data-source reconciliation before any promotion."
    : "No registered candidate passed the co-primary raw-return and risk gates; append any new literature/competitor candidate before evaluation.",
});

await atomicWrite(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(reportOutput, renderReport(report));

process.stdout.write(`${JSON.stringify({
  ok: true,
  protocol_sha256: protocolSha256,
  panel_sha256: panel.normalized_panel_sha256,
  selected_id_before_robustness: selection.selected_id_before_robustness,
  disposition,
  json: jsonOutput,
  report: reportOutput,
}, null, 2)}\n`);
