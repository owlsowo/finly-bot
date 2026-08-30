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
  CORE_SYMBOLS,
  createPrimaryStrategies,
} from "./champion_strategies.mjs";
import {
  createAegisLegacyProxyStrategies,
  createGeneration2LongOnlyStrategies,
  GENERATION2_METADATA,
} from "./champion_strategies_generation2.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolPath = resolve(projectRoot, "research/champion_search_generation2_protocol.json");
const outputDirectory = resolve(projectRoot, "research/output");
const jsonOutput = resolve(outputDirectory, "quant_champion_generation2.json");
const reportOutput = resolve(outputDirectory, "quant_champion_generation2_report.md");

const PRIMARY_BASELINE_IDS = Object.freeze([
  "bil_cash",
  "spy_buy_hold",
  "qqq_buy_hold",
  "spy_levered_150",
  "spy_vol_target_15",
  "frozen_finly",
]);

const CANDIDATE_IDS = Object.freeze(createGeneration2LongOnlyStrategies().map((strategy) => strategy.id));

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
  return values.length > 0 ? quantile(values, 0.5) : null;
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

function baselineStrategies() {
  return createPrimaryStrategies().filter((strategy) => PRIMARY_BASELINE_IDS.includes(strategy.id));
}

function simulatePrimary(points, options = BASE_OPTIONS) {
  const strategies = [...baselineStrategies(), ...createGeneration2LongOnlyStrategies()];
  return Object.freeze(strategies.map((strategy) => simulateStrategy(points, CORE_SYMBOLS, strategy, options)));
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

function annualOriginWindows(candidateRows, benchmarkRows, sessions, slice = null) {
  const boundedCandidate = slice ? rowsWithin(candidateRows, slice.start, slice.end) : candidateRows;
  const boundedBenchmark = slice ? rowsWithin(benchmarkRows, slice.start, slice.end) : benchmarkRows;
  const benchmarkByDate = new Map(boundedBenchmark.map((row) => [row.execution_return_date, row]));
  const aligned = boundedCandidate.filter((row) => benchmarkByDate.has(row.execution_return_date));
  const starts = [];
  for (let index = 0; index < aligned.length; index += 1) {
    if (index === 0 || aligned[index].execution_return_date.slice(0, 4) !== aligned[index - 1].execution_return_date.slice(0, 4)) {
      starts.push(index);
    }
  }
  return Object.freeze(starts.filter((start) => start + sessions <= aligned.length).map((start) => {
    const candidateWindow = aligned.slice(start, start + sessions);
    const benchmarkWindow = candidateWindow.map((row) => benchmarkByDate.get(row.execution_return_date));
    const candidateMetrics = calculatePortfolioMetrics(candidateWindow);
    const benchmarkMetrics = calculatePortfolioMetrics(benchmarkWindow);
    const candidateGrowth = annualizedLogGrowth(candidateMetrics);
    const benchmarkGrowth = annualizedLogGrowth(benchmarkMetrics);
    return Object.freeze({
      start_date: candidateMetrics.start_date,
      end_date: candidateMetrics.end_date,
      candidate_annualized_log_growth: round(candidateGrowth),
      benchmark_annualized_log_growth: round(benchmarkGrowth),
      annualized_log_growth_difference: round(candidateGrowth - benchmarkGrowth),
      candidate_total_return: candidateMetrics.total_return,
      benchmark_total_return: benchmarkMetrics.total_return,
      beats_benchmark: candidateMetrics.total_return > benchmarkMetrics.total_return,
    });
  }));
}

function summarizeWindows(windows) {
  const differences = windows.map((window) => window.annualized_log_growth_difference);
  return Object.freeze({
    windows,
    count: windows.length,
    median_annualized_log_growth_difference: round(median(differences)),
    positive_fraction: windows.length > 0
      ? round(windows.filter((window) => window.beats_benchmark).length / windows.length)
      : null,
  });
}

function rollingEvidence(simulations) {
  const byId = new Map(simulations.map((simulation) => [simulation.id, simulation]));
  const spy = byId.get("spy_buy_hold");
  return Object.fromEntries(CANDIDATE_IDS.map((id) => {
    const candidate = byId.get(id);
    return [id, Object.freeze(Object.fromEntries([252, 504, 756].map((sessions) => [sessions, Object.freeze({
      full_history: summarizeWindows(annualOriginWindows(candidate.rows, spy.rows, sessions)),
      validation: summarizeWindows(annualOriginWindows(candidate.rows, spy.rows, sessions, SLICES.validation_selection)),
    })])))];
  }));
}

function selectionEvidence(metrics, rolling) {
  const development = metrics.development;
  const validation = metrics.validation_selection;
  const assessments = CANDIDATE_IDS.map((id) => {
    const dev = development[id];
    const val = validation[id];
    const devSpy = development.spy_buy_hold;
    const valSpy = validation.spy_buy_hold;
    const valFrozen = validation.frozen_finly;
    const valVolTarget = validation.spy_vol_target_15;
    const devRaw = annualizedLogGrowth(dev) - annualizedLogGrowth(devSpy);
    const valRaw = annualizedLogGrowth(val) - annualizedLogGrowth(valSpy);
    const rollingGates = Object.fromEntries([252, 504, 756].flatMap((sessions) => {
      const evidence = rolling[id][sessions].validation;
      return [
        [`validation_rolling_${sessions}_median_raw_excess_positive`, evidence.median_annualized_log_growth_difference > 0],
        [`validation_rolling_${sessions}_positive_fraction_at_least_60pct`, evidence.positive_fraction >= 0.60],
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
      eligible_before_robustness: Object.values(gates).every(Boolean),
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
  const eligible = ranked.filter((assessment) => assessment.eligible_before_robustness);
  return Object.freeze({
    selected_id_before_robustness: eligible[0]?.id ?? null,
    ranked_candidate_ids: Object.freeze(ranked.map((assessment) => assessment.id)),
    assessments: Object.freeze(Object.fromEntries(assessments.map((assessment) => [assessment.id, assessment]))),
    recent_interval_used_for_selection: false,
  });
}

function recentVeto(metrics, selection) {
  if (!selection.selected_id_before_robustness) {
    return Object.freeze({ applicable: false, hard_safety_veto: false, reasons: Object.freeze([]) });
  }
  const candidate = metrics.consumed_recent_diagnostic[selection.selected_id_before_robustness];
  const spy = metrics.consumed_recent_diagnostic.spy_buy_hold;
  const bil = metrics.consumed_recent_diagnostic.bil_cash;
  const reasons = [];
  if (candidate.maximum_drawdown < -0.20) reasons.push("recent maximum drawdown breached 20%");
  if (candidate.total_return < bil.total_return) reasons.push("recent return trailed BIL");
  if (candidate.maximum_drawdown < spy.maximum_drawdown - 0.05) reasons.push("recent drawdown was over five points worse than SPY");
  return Object.freeze({ applicable: true, hard_safety_veto: reasons.length > 0, reasons: Object.freeze(reasons) });
}

function strategyTable(metrics, comparisons, ids) {
  return ids.map((id) => {
    const value = metrics[id];
    const comparison = comparisons[id];
    return `| ${id} | ${(100 * value.total_return).toFixed(2)}% | ${(100 * value.annualized_return).toFixed(2)}% | ${(100 * value.annualized_volatility).toFixed(2)}% | ${value.cash_excess_sharpe?.toFixed(3) ?? "n/a"} | ${(100 * value.maximum_drawdown).toFixed(2)}% | ${(100 * comparison.total_return_difference).toFixed(2)}% |`;
  }).join("\n");
}

function renderReport(report) {
  const selected = report.selection.selected_id_before_robustness ?? "none";
  const ids = [...PRIMARY_BASELINE_IDS, ...CANDIDATE_IDS];
  const shownSlices = ["development", "validation_selection", "consumed_recent_diagnostic", "requested_2013_2015", "post_2013_full_history"];
  const sections = shownSlices.map((sliceId) => `## ${sliceId.replaceAll("_", " ")}\n\n| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Return minus SPY |\n|---|---:|---:|---:|---:|---:|---:|\n${strategyTable(report.metrics[sliceId], report.comparisons_to_spy[sliceId], ids)}`).join("\n\n");
  const assessmentRows = report.selection.ranked_candidate_ids.map((id) => {
    const item = report.selection.assessments[id];
    const failures = Object.entries(item.gates).filter(([, passed]) => !passed).map(([gate]) => gate).join(", ") || "none";
    return `| ${id} | ${(100 * item.development_annualized_log_growth_advantage_vs_spy).toFixed(2)}% | ${(100 * item.validation_annualized_log_growth_advantage_vs_spy).toFixed(2)}% | ${item.eligible_before_robustness ? "yes" : "no"} | ${failures} |`;
  }).join("\n");
  const diagnostic = report.aegis_legacy_diagnostic.metrics;
  return `# Finly quantitative champion search — Generation 2\n\nGenerated: ${report.generated_at}\n\nProtocol SHA-256: \`${report.protocol_sha256}\`  \nPrimary panel SHA-256: \`${report.dataset.normalized_panel_sha256}\`\n\n## Answer first\n\nThe preregistered pre-robustness selector chose **${selected}**. Historical disposition: **${report.disposition}**. All history is retrospective and revised; a passing candidate would remain shadow-only until prospective broker evidence exists.\n\n${sections}\n\n## Pre-robustness selection gates\n\n| Candidate | Development log-growth edge | Validation log-growth edge | Eligible | Failed gates |\n|---|---:|---:|---:|---|\n${assessmentRows}\n\nThe consumed 2025–2026 interval did not rank or break ties. Recent hard-safety veto: **${report.recent_veto.hard_safety_veto ? "yes" : "no"}**.\n\n## Separate AEGIS-Q legacy proxy diagnostic\n\nThis uses TQQQ and is ineligible for the primary long-only champion. It also differs from the source's next-open, split-adjusted, zero-cash-return evaluator. On its own common panel it returned **${(100 * diagnostic.aegis_legacy_tqqq_regime_proxy.total_return).toFixed(2)}%** versus **${(100 * diagnostic.spy_buy_hold.total_return).toFixed(2)}%** for SPY and **${(100 * diagnostic.qqq_buy_hold.total_return).toFixed(2)}%** for QQQ.\n\n## Claim boundary\n\nA historical pass can earn only SHADOW_ONLY. It cannot prove future profitability, faithful options P&L, or superiority to unreproducible submissions. QQQ and a 1.5x SPY diagnostic remain visible so raw SPY outperformance cannot be mistaken for novel alpha.\n`;
}

const protocolRaw = await readFile(protocolPath, "utf8");
const protocol = JSON.parse(protocolRaw);
const protocolSha256 = sha256(protocolRaw);
const allSymbols = [...new Set([...CORE_SYMBOLS, "TQQQ"])];
const yahooResults = await fetchInBatches(allSymbols, {
  start: protocol.data.requested_start,
  end: protocol.data.requested_end,
});
const resultBySymbol = new Map(yahooResults.map((result) => [result.symbol, result]));

const primaryPanel = alignSeriesByDate(CORE_SYMBOLS.map((symbol) => resultBySymbol.get(symbol)), CORE_SYMBOLS);
const primarySimulations = simulatePrimary(primaryPanel.points, BASE_OPTIONS);
const metrics = metricsBySlice(primarySimulations);
const comparisons = Object.fromEntries(Object.entries(metrics).map(([sliceId, values]) => [sliceId, compareAllToSpy(values)]));
const rolling = rollingEvidence(primarySimulations);
const selection = selectionEvidence(metrics, rolling);
const veto = recentVeto(metrics, selection);
const disposition = selection.selected_id_before_robustness && !veto.hard_safety_veto ? "ROBUSTNESS_PENDING" : "KEEP_V1";

const aegisSymbols = ["SPY", "BIL", "QQQ", "TQQQ"];
const aegisPanel = alignSeriesByDate(aegisSymbols.map((symbol) => resultBySymbol.get(symbol)), aegisSymbols);
const aegisBenchmarkStrategies = createPrimaryStrategies().filter((strategy) => ["spy_buy_hold", "qqq_buy_hold", "bil_cash"].includes(strategy.id));
const aegisStrategies = [...aegisBenchmarkStrategies, ...createAegisLegacyProxyStrategies()];
const aegisSimulations = aegisStrategies.map((strategy) => simulateStrategy(aegisPanel.points, aegisSymbols, strategy, BASE_OPTIONS));
const aegisMetrics = Object.fromEntries(aegisSimulations.map((simulation) => [simulation.id, calculatePortfolioMetrics(simulation.rows)]));

const report = Object.freeze({
  schema_version: "finly_quant_champion_generation2.v1",
  generated_at: new Date().toISOString(),
  protocol_sha256: protocolSha256,
  protocol,
  dataset: Object.freeze({
    provider: "Yahoo Finance chart endpoint adjusted close",
    symbols: CORE_SYMBOLS,
    common_start: primaryPanel.common_start,
    common_end: primaryPanel.common_end,
    common_sessions: primaryPanel.common_sessions,
    scored_start: primarySimulations[0].rows[0].execution_return_date,
    scored_end: primarySimulations[0].rows.at(-1).execution_return_date,
    scored_sessions: primarySimulations[0].rows.length,
    dropped_noncommon_sessions: primaryPanel.dropped_noncommon_sessions,
    normalized_panel_sha256: primaryPanel.normalized_panel_sha256,
    source_provenance: Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, resultBySymbol.get(symbol).provenance])),
  }),
  execution: BASE_OPTIONS,
  strategy_metadata: Object.fromEntries(CANDIDATE_IDS.map((id) => [id, GENERATION2_METADATA[id]])),
  metrics,
  comparisons_to_spy: comparisons,
  rolling_annual_origin_evidence: rolling,
  selection,
  recent_veto: veto,
  aegis_legacy_diagnostic: Object.freeze({
    eligible_for_primary_champion: false,
    panel: Object.freeze({
      symbols: aegisSymbols,
      common_start: aegisPanel.common_start,
      common_end: aegisPanel.common_end,
      common_sessions: aegisPanel.common_sessions,
      normalized_panel_sha256: aegisPanel.normalized_panel_sha256,
      source_provenance: Object.fromEntries(aegisSymbols.map((symbol) => [symbol, resultBySymbol.get(symbol).provenance])),
    }),
    metrics: aegisMetrics,
  }),
  disposition,
  next_required_stage: disposition === "ROBUSTNESS_PENDING"
    ? "Run native schedule anchors, 10/25 bp costs, boundary-rebased windows, paired block inference, deflated statistics, and authenticated data reconciliation."
    : "No Generation 2 candidate passed every preregistered gate. Append any bounded Generation 3 formula before inspecting its output.",
});

await atomicWrite(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(reportOutput, renderReport(report));

process.stdout.write(`${JSON.stringify({
  ok: true,
  protocol_sha256: protocolSha256,
  panel_sha256: primaryPanel.normalized_panel_sha256,
  selected_id_before_robustness: selection.selected_id_before_robustness,
  ranked_candidate_ids: selection.ranked_candidate_ids,
  disposition,
  aegis_legacy_panel_sha256: aegisPanel.normalized_panel_sha256,
  json: jsonOutput,
  report: reportOutput,
}, null, 2)}\n`);
