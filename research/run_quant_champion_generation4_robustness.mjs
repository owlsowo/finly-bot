import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import {
  calculatePortfolioMetrics,
  compareMetrics,
  rebaseRowsForStandalonePeriod,
  round,
  rowsWithin,
  sha256,
  simulateStrategy,
} from "./champion_engine.mjs";
import { CORE_SYMBOLS, createPrimaryStrategies } from "./champion_strategies.mjs";
import { createGeneration4Strategies } from "./champion_strategies_generation4.mjs";
import {
  aggregateScheduleOffsets,
  annualOriginWindowSummaries,
  CHAMPION_BLOCK_LENGTHS,
  deflatedSharpeAcrossTrials,
  FROZEN_BOOTSTRAP_SEEDS,
  pairedBlockBootstrapSuite,
} from "./champion_statistics.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const privateDirectory = resolve(projectRoot, "data/private/champion_search");
const outputDirectory = resolve(projectRoot, "research/output");
const robustnessProtocolPath = resolve(projectRoot, "research/champion_generation4_robustness_protocol.json");
const robustnessFreezeReceiptPath = resolve(projectRoot, "research/champion_generation4_robustness_freeze_receipt.json");
const protocolPath = resolve(projectRoot, "research/champion_search_generation4_protocol.json");
const freezeReceiptPath = resolve(projectRoot, "research/champion_search_generation4_freeze_receipt.json");
const trialLedgerPath = resolve(projectRoot, "research/champion_trial_ledger_generation4.json");
const frozenOutputPath = resolve(outputDirectory, "quant_champion_generation4.json");
const sourceOverlapPath = resolve(outputDirectory, "source_overlap_reconciliation.json");
const sourceOverlapProtocolPath = resolve(projectRoot, "research/source_overlap_reconciliation_protocol.json");
const sourceOverlapFreezeReceiptPath = resolve(projectRoot, "research/source_overlap_reconciliation_freeze_receipt.json");
const jsonOutputPath = resolve(outputDirectory, "quant_champion_generation4_robustness.json");
const markdownOutputPath = resolve(outputDirectory, "quant_champion_generation4_robustness_report.md");

export const FIXED_CANDIDATE_ID = "qqq_core_sector_12_6";
export const COST_LEVELS_BPS = Object.freeze([5, 10, 25]);
export const NATIVE_21_SESSION_OFFSETS = Object.freeze(Array.from({ length: 21 }, (_, index) => index));
export const COMPARATOR_IDS = Object.freeze([
  "spy_buy_hold",
  "qqq_buy_hold",
  "frozen_finly",
  "spy_vol_target_15",
  "static_spy_qqq_50_50_control",
]);
export const GENERATION4_TRIAL_IDS = Object.freeze(createGeneration4Strategies().map((strategy) => strategy.id));
export const GENERATION4_ELIGIBLE_IDS = Object.freeze(GENERATION4_TRIAL_IDS.filter(
  (id) => id !== "static_spy_qqq_50_50_control",
));
export const REQUIRED_SOURCE_OVERLAP_SYMBOLS = Object.freeze([
  "SPY", "BIL", "QQQ", "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
]);

const SOURCE_OVERLAP_SCHEMA = "finly_generation4_source_overlap_reconciliation.v1";
const SOURCE_OVERLAP_PROTOCOL_SHA256 = "306f49f6632ed58c3e9ea446d87c1c28fc0a0d13b188cfa276f83f7cbbb0652d";
const SOURCE_OVERLAP_FREEZE_RECEIPT_SHA256 = "467f0d2310c56c422c902c37542df521df19779ed15bd0f95f2d1a0e0dbae11d";
const SOURCE_OVERLAP_OUTPUT_SHA256 = "f581f6c286540cf2f4b178450810993b2147628a10c85c8a9da181b50092001c";

const REQUIRED_SIMULATION_IDS = Object.freeze([
  ...new Set([...GENERATION4_TRIAL_IDS, ...COMPARATOR_IDS, "bil_cash"]),
]);
const SLICES = Object.freeze({
  development: Object.freeze({ start: "2008-06-02", end: "2017-12-29", consumed: true }),
  validation: Object.freeze({ start: "2018-01-02", end: "2024-12-31", consumed: true }),
  recent_consumed_diagnostic: Object.freeze({ start: "2025-01-02", end: "2026-08-28", consumed: true }),
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
const BOOTSTRAP_ITERATIONS = 2_000;
const CUMULATIVE_TRIALS = 100;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function safePrivateArtifactPath(filename) {
  invariant(typeof filename === "string" && filename.length > 0, "private artifact filename is missing");
  invariant(basename(filename) === filename, "private artifact filename must not contain a path");
  const path = resolve(privateDirectory, filename);
  invariant(path.startsWith(`${privateDirectory}/`), "private artifact escaped its fixed directory");
  return path;
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function annualizedLogGrowth(metrics) {
  invariant(metrics && metrics.observations > 0, "annualized log growth requires non-empty metrics");
  return Math.log1p(metrics.total_return) * 252 / metrics.observations;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateRobustnessProtocol(protocol) {
  const reasons = [];
  if (protocol?.schema_version !== "finly_champion_generation4_robustness_protocol.v1") reasons.push("unexpected robustness protocol schema");
  if (protocol?.status !== "frozen_before_first_post_selection_robustness_output") reasons.push("robustness protocol is not frozen");
  if (protocol?.fixed_candidate_id !== FIXED_CANDIDATE_ID) reasons.push("robustness protocol candidate mismatch");
  if (!sameJson(protocol?.data_and_execution?.cost_levels_bps, COST_LEVELS_BPS)) reasons.push("cost levels differ from 5/10/25 bp");
  if (!sameJson(protocol?.data_and_execution?.native_offsets, NATIVE_21_SESSION_OFFSETS)) reasons.push("native offsets differ from 0 through 20");
  if (protocol?.data_and_execution?.native_rebalance_interval_sessions !== 21) reasons.push("native interval is not 21 sessions");
  if (protocol?.data_and_execution?.anchor_cost_bps !== 5) reasons.push("anchor cost is not 5 bp");
  if (protocol?.data_and_execution?.maximum_risky_gross !== 1) reasons.push("maximum risky gross is not one");
  if (protocol?.statistical_gate?.slice !== "validation_only") reasons.push("statistics are not validation-only");
  if (protocol?.statistical_gate?.benchmark_id !== "spy_buy_hold") reasons.push("statistical benchmark is not SPY");
  if (!sameJson(protocol?.statistical_gate?.eligible_candidate_ids, GENERATION4_ELIGIBLE_IDS)) reasons.push("statistical family is not the seven eligible candidates");
  if (protocol?.statistical_gate?.cumulative_effective_trials !== CUMULATIVE_TRIALS) reasons.push("cumulative trial count is not 100");
  if (protocol?.statistical_gate?.deflated_sharpe_probability_minimum !== 0.95) reasons.push("DSR gate is not 0.95");
  if (protocol?.statistical_gate?.bootstrap_iterations_per_test !== BOOTSTRAP_ITERATIONS) reasons.push("bootstrap count is not 2,000");
  if (!sameJson(protocol?.statistical_gate?.block_lengths_sessions, CHAMPION_BLOCK_LENGTHS)) reasons.push("block lengths are not 5/20/60");
  if (!sameJson(protocol?.statistical_gate?.methods, ["circular", "moving"])) reasons.push("bootstrap methods differ");
  if (!sameJson(protocol?.statistical_gate?.frozen_seeds, FROZEN_BOOTSTRAP_SEEDS)) reasons.push("bootstrap seeds differ from frozen implementation seeds");
  if (protocol?.statistical_gate?.familywise_fixed_candidate_p_value_maximum !== 0.05) reasons.push("familywise gate is not 0.05");
  if (!sameJson(protocol?.comparators, COMPARATOR_IDS)) reasons.push("comparator list differs");
  if (protocol?.slices?.development?.start !== SLICES.development.start
    || protocol?.slices?.development?.end !== SLICES.development.end) reasons.push("development slice differs");
  if (protocol?.slices?.validation?.start !== SLICES.validation.start
    || protocol?.slices?.validation?.end !== SLICES.validation.end) reasons.push("validation slice differs");
  if (protocol?.slices?.recent?.start !== SLICES.recent_consumed_diagnostic.start
    || protocol?.slices?.recent?.end !== SLICES.recent_consumed_diagnostic.end) reasons.push("recent slice differs");
  if (protocol?.slices?.recent?.status !== "consumed_veto_and_descriptive_only") reasons.push("recent is not marked consumed");
  if (protocol?.source_overlap?.runner_fetch_permitted !== false || protocol?.source_overlap?.fail_closed !== true) {
    reasons.push("source-overlap boundary is not no-fetch and fail-closed");
  }
  if (protocol?.source_overlap?.artifact !== "research/output/source_overlap_reconciliation.json") {
    reasons.push("source-overlap artifact path differs from the frozen authenticated result");
  }
  if (protocol?.source_overlap?.artifact_schema !== SOURCE_OVERLAP_SCHEMA) reasons.push("source-overlap schema differs");
  if (protocol?.source_overlap?.artifact_sha256 !== SOURCE_OVERLAP_OUTPUT_SHA256) reasons.push("source-overlap output hash differs");
  if (protocol?.source_overlap?.protocol_sha256 !== SOURCE_OVERLAP_PROTOCOL_SHA256) reasons.push("source-overlap protocol hash differs");
  if (protocol?.source_overlap?.freeze_receipt_sha256 !== SOURCE_OVERLAP_FREEZE_RECEIPT_SHA256) {
    reasons.push("source-overlap freeze-receipt hash differs");
  }
  if (!sameJson(protocol?.source_overlap?.required_symbols, REQUIRED_SOURCE_OVERLAP_SYMBOLS)) {
    reasons.push("source-overlap symbols differ from the fixed candidate, SPY, and BIL scope");
  }
  if (protocol?.source_overlap?.required_overall_disposition !== "PASS") reasons.push("source-overlap PASS disposition is not required");
  if (protocol?.source_overlap?.known_result_disposition !== "FAIL_CLOSED"
    || protocol?.source_overlap?.result_known_at_robustness_refreeze !== true) {
    reasons.push("known authenticated source failure is not preserved at refreeze");
  }
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function standaloneRows(simulation, slice, oneWayCostBps) {
  const rows = rowsWithin(simulation.rows, slice.start, slice.end);
  invariant(rows.length >= 2, `${simulation.id} has too few rows in ${slice.start} through ${slice.end}`);
  return rebaseRowsForStandalonePeriod(rows, { cashSymbol: "BIL", oneWayCostBps });
}

function strategyRegistry() {
  const strategies = [...createPrimaryStrategies(), ...createGeneration4Strategies()];
  const registry = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  invariant(registry.size === strategies.length, "strategy registry contains a duplicate id");
  return registry;
}

function simulateIds(points, ids, { oneWayCostBps, candidateOffset = 0 } = {}) {
  const registry = strategyRegistry();
  return new Map(ids.map((id) => {
    const strategy = registry.get(id);
    invariant(strategy, `strategy registry omits ${id}`);
    const interval = strategy.rebalanceIntervalSessions ?? BASE_OPTIONS.rebalanceIntervalSessions;
    const rebalanceAnchor = id === FIXED_CANDIDATE_ID ? candidateOffset : 0;
    invariant(rebalanceAnchor >= 0 && rebalanceAnchor < interval, `${id} cannot use rebalance anchor ${rebalanceAnchor}`);
    return [id, simulateStrategy(points, CORE_SYMBOLS, strategy, {
      ...BASE_OPTIONS,
      oneWayCostBps,
      rebalanceAnchor,
    })];
  }));
}

function comparisonRecord(candidateMetrics, benchmarkMetrics) {
  return Object.freeze({
    candidate: candidateMetrics,
    benchmark: benchmarkMetrics,
    differences: compareMetrics(candidateMetrics, benchmarkMetrics),
    annualized_log_growth_difference: round(
      annualizedLogGrowth(candidateMetrics) - annualizedLogGrowth(benchmarkMetrics),
    ),
    candidate_total_return_exceeds_benchmark: candidateMetrics.total_return > benchmarkMetrics.total_return,
  });
}

function recentSafetyVeto(candidate, spy, bil) {
  const reasons = [];
  if (candidate.maximum_drawdown < -0.20) reasons.push("maximum drawdown below -20%");
  if (candidate.total_return < bil.total_return) reasons.push("total return trailed BIL");
  if (candidate.maximum_drawdown < spy.maximum_drawdown - 0.05) {
    reasons.push("maximum drawdown over five percentage points worse than SPY");
  }
  return Object.freeze({
    consumed: true,
    hard_safety_veto: reasons.length > 0,
    reasons: Object.freeze(reasons),
    interpretation: "This interval was already inspected by Generation 4. It is a consumed safety diagnostic, not fresh out-of-sample evidence.",
  });
}

function sliceEvidence(simulations, oneWayCostBps) {
  return Object.fromEntries(Object.entries(SLICES).map(([sliceId, slice]) => {
    const metrics = Object.fromEntries(REQUIRED_SIMULATION_IDS.map((id) => [
      id,
      calculatePortfolioMetrics(standaloneRows(simulations.get(id), slice, oneWayCostBps)),
    ]));
    return [sliceId, Object.freeze({
      consumed: slice.consumed,
      start: slice.start,
      requested_end: slice.end,
      observed_end: metrics[FIXED_CANDIDATE_ID].end_date,
      comparisons: Object.fromEntries(COMPARATOR_IDS.map((id) => [
        id,
        comparisonRecord(metrics[FIXED_CANDIDATE_ID], metrics[id]),
      ])),
      candidate_metrics: metrics[FIXED_CANDIDATE_ID],
      bil_metrics: metrics.bil_cash,
    })];
  }));
}

export function assessCostStressRecords(records) {
  const byCost = new Map(records.map((record) => [record.cost_bps, record]));
  const missing = COST_LEVELS_BPS.filter((cost) => !byCost.has(cost));
  const unexpected = [...byCost.keys()].filter((cost) => !COST_LEVELS_BPS.includes(cost));
  const duplicateCount = records.length - byCost.size;
  const complete = missing.length === 0 && unexpected.length === 0 && duplicateCount === 0;
  const gates = Object.fromEntries(COST_LEVELS_BPS.map((cost) => {
    const record = byCost.get(cost);
    return [String(cost), Object.freeze({
      development_spy_edge_positive: Boolean(record?.gates?.development_spy_edge_positive),
      validation_spy_edge_positive: Boolean(record?.gates?.validation_spy_edge_positive),
    })];
  }));
  return Object.freeze({
    expected_costs_bps: COST_LEVELS_BPS,
    observed_costs_bps: [...byCost.keys()].sort((left, right) => left - right),
    complete_coverage: complete,
    missing_costs_bps: missing,
    unexpected_costs_bps: unexpected,
    duplicate_cost_records: duplicateCount,
    gates,
    raw_spy_edge_keeps_sign_at_every_cost: complete && Object.values(gates).every((item) => (
      item.development_spy_edge_positive && item.validation_spy_edge_positive
    )),
  });
}

function buildCostStress(points) {
  const records = COST_LEVELS_BPS.map((cost) => {
    const simulations = simulateIds(points, REQUIRED_SIMULATION_IDS, { oneWayCostBps: cost, candidateOffset: 0 });
    const slices = sliceEvidence(simulations, cost);
    const developmentEdge = slices.development.comparisons.spy_buy_hold.annualized_log_growth_difference;
    const validationEdge = slices.validation.comparisons.spy_buy_hold.annualized_log_growth_difference;
    const recentVeto = recentSafetyVeto(
      slices.recent_consumed_diagnostic.candidate_metrics,
      slices.recent_consumed_diagnostic.comparisons.spy_buy_hold.benchmark,
      slices.recent_consumed_diagnostic.bil_metrics,
    );
    return Object.freeze({
      cost_bps: cost,
      simulations,
      slices,
      gates: Object.freeze({
        development_spy_edge_positive: developmentEdge > 0,
        validation_spy_edge_positive: validationEdge > 0,
      }),
      recent_consumed_safety_veto: recentVeto,
    });
  });
  return Object.freeze({ records, assessment: assessCostStressRecords(records) });
}

function buildAnchorRobustness(points, baseFiveBpsSimulations) {
  const records = NATIVE_21_SESSION_OFFSETS.map((offset) => {
    const candidate = simulateIds(points, [FIXED_CANDIDATE_ID], {
      oneWayCostBps: 5,
      candidateOffset: offset,
    }).get(FIXED_CANDIDATE_ID);
    const simulations = new Map(baseFiveBpsSimulations);
    simulations.set(FIXED_CANDIDATE_ID, candidate);
    const slices = sliceEvidence(simulations, 5);
    const developmentEdge = slices.development.comparisons.spy_buy_hold.annualized_log_growth_difference;
    const validationEdge = slices.validation.comparisons.spy_buy_hold.annualized_log_growth_difference;
    const recentEdge = slices.recent_consumed_diagnostic.comparisons.spy_buy_hold.annualized_log_growth_difference;
    return Object.freeze({
      offset,
      metrics: Object.freeze({
        development: Object.freeze({ annualized_log_growth_edge_vs_spy: developmentEdge }),
        validation: Object.freeze({ annualized_log_growth_edge_vs_spy: validationEdge }),
        recent_consumed_diagnostic: Object.freeze({ annualized_log_growth_edge_vs_spy: recentEdge }),
      }),
      gates: Object.freeze({
        development: Object.freeze({ spy_edge_positive: developmentEdge > 0 }),
        validation: Object.freeze({ spy_edge_positive: validationEdge > 0 }),
      }),
      standalone_slices: slices,
    });
  });
  return Object.freeze({
    records,
    aggregation: aggregateScheduleOffsets(records, { expectedOffsets: NATIVE_21_SESSION_OFFSETS }),
    recent_interpretation: "All 21 recent results are consumed diagnostics and cannot rank schedules or support an out-of-sample claim.",
  });
}

export function buildPairedRows(simulations, ids, slice, oneWayCostBps) {
  invariant(Array.isArray(ids) && ids.length >= 2, "paired rows require at least two strategy ids");
  const uniqueIds = [...new Set(ids)];
  invariant(uniqueIds.length === ids.length, "paired row ids must not contain duplicates");
  const rowsById = new Map(uniqueIds.map((id) => {
    const simulation = simulations.get(id);
    invariant(simulation, `paired rows omit simulation ${id}`);
    return [id, standaloneRows(simulation, slice, oneWayCostBps)];
  }));
  const reference = rowsById.get(uniqueIds[0]);
  for (const [id, rows] of rowsById) invariant(rows.length === reference.length, `paired rows have a different length for ${id}`);
  return Object.freeze(reference.map((row, index) => {
    const date = row.execution_return_date;
    const strategies = Object.fromEntries(uniqueIds.map((id) => {
      const candidateRow = rowsById.get(id)[index];
      invariant(candidateRow?.execution_return_date === date, `paired rows are misaligned for ${id} at ${date}`);
      return [id, Object.freeze({ net_return: candidateRow.net_return })];
    }));
    return Object.freeze({ execution_return_date: date, strategies: Object.freeze(strategies) });
  }));
}

function buildStatisticalEvidence(baseFiveBpsSimulations) {
  const ids = [...GENERATION4_ELIGIBLE_IDS, "spy_buy_hold"];
  const rows = buildPairedRows(baseFiveBpsSimulations, ids, SLICES.validation, 5);
  const evidence = Object.freeze({
    deflated_sharpe: deflatedSharpeAcrossTrials(rows, GENERATION4_ELIGIBLE_IDS, {
      benchmarkId: "spy_buy_hold",
      fixedCandidateId: FIXED_CANDIDATE_ID,
      cumulativeTrialCount: CUMULATIVE_TRIALS,
      periodsPerYear: 252,
    }),
    paired_block_bootstrap: pairedBlockBootstrapSuite(rows, GENERATION4_ELIGIBLE_IDS, {
      benchmarkId: "spy_buy_hold",
      fixedCandidateId: FIXED_CANDIDATE_ID,
      iterations: BOOTSTRAP_ITERATIONS,
    }),
  });
  return Object.freeze({
    slice: "validation_only",
    benchmark_id: "spy_buy_hold",
    candidate_family: GENERATION4_ELIGIBLE_IDS,
    static_growth_control_excluded_from_candidate_family: true,
    cumulative_trial_count: CUMULATIVE_TRIALS,
    bootstrap_iterations_per_test: BOOTSTRAP_ITERATIONS,
    validation: evidence,
    gates: Object.freeze({
      validation_deflated_sharpe_probability_at_least_95_percent:
        evidence.deflated_sharpe.deflated_sharpe.passes_95_percent_gate,
      all_six_validation_fixed_candidate_familywise_p_values_at_most_5_percent:
        evidence.paired_block_bootstrap.all_six_fixed_candidate_familywise_p_values_at_most_5_percent,
    }),
    interpretation: "The frozen protocol applies DSR and familywise block tests to validation only. Validation was consumed by selection, so these tests penalize multiplicity and dependence but do not restore a pristine holdout.",
  });
}

function nonzeroWeightSignature(weights) {
  return Object.entries(weights)
    .filter(([, weight]) => Math.abs(weight) > 1e-8)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, weight]) => `${symbol}:${weight.toFixed(8)}`)
    .join("|");
}

export function distinguishFromStaticControl(candidateRows, controlRows) {
  invariant(Array.isArray(candidateRows) && Array.isArray(controlRows), "control distinction requires row arrays");
  const controlBySignal = new Map(controlRows.map((row) => [row.signal_date, row]));
  const candidateRebalances = candidateRows.filter((row) => row.rebalanced);
  const matched = candidateRebalances.map((row) => [row, controlBySignal.get(row.signal_date)]).filter(([, control]) => control);
  const uniqueCandidateTargets = new Set(candidateRebalances.map((row) => nonzeroWeightSignature(row.signal_weights)));
  const outsideCoreSymbols = [...new Set(candidateRebalances.flatMap((row) => Object.entries(row.signal_weights)
    .filter(([symbol, weight]) => !new Set(["SPY", "QQQ", "BIL"]).has(symbol) && weight > 1e-8)
    .map(([symbol]) => symbol)))].sort();
  const averageTargetL1Distance = matched.length === 0 ? 0 : matched.reduce((sum, [candidate, control]) => (
    sum + CORE_SYMBOLS.reduce((inner, symbol) => (
      inner + Math.abs((candidate.signal_weights[symbol] ?? 0) - (control.signal_weights[symbol] ?? 0))
    ), 0)
  ), 0) / matched.length;
  const mechanicallyDistinct = matched.length > 0
    && uniqueCandidateTargets.size >= 2
    && outsideCoreSymbols.length > 0
    && averageTargetL1Distance > 1e-8;
  return Object.freeze({
    mechanically_distinct: mechanicallyDistinct,
    candidate_rebalance_rows: candidateRebalances.length,
    matched_control_signal_dates: matched.length,
    unique_candidate_target_allocations: uniqueCandidateTargets.size,
    noncore_assets_used: outsideCoreSymbols,
    average_target_l1_distance_from_static_control: round(averageTargetL1Distance),
  });
}

function buildStaticControlAssessment(baseFiveBpsRecord) {
  const candidate = baseFiveBpsRecord.simulations.get(FIXED_CANDIDATE_ID);
  const control = baseFiveBpsRecord.simulations.get("static_spy_qqq_50_50_control");
  const distinction = distinguishFromStaticControl(candidate.rows, control.rows);
  const development = baseFiveBpsRecord.slices.development.comparisons.static_spy_qqq_50_50_control;
  const validation = baseFiveBpsRecord.slices.validation.comparisons.static_spy_qqq_50_50_control;
  const beatsBoth = development.annualized_log_growth_difference > 0
    && validation.annualized_log_growth_difference > 0;
  const rollingRows = buildPairedRows(
    baseFiveBpsRecord.simulations,
    [FIXED_CANDIDATE_ID, "static_spy_qqq_50_50_control"],
    SLICES.validation,
    5,
  );
  const rolling = annualOriginWindowSummaries(rollingRows, {
    candidateId: FIXED_CANDIDATE_ID,
    benchmarkId: "static_spy_qqq_50_50_control",
    horizons: [252, 504, 756],
    periodsPerYear: 252,
  });
  const rollingConsistent = Object.values(rolling.horizons).every((horizon) => (
    horizon.window_count > 0
    && horizon.median_annualized_log_growth_difference > 0
    && horizon.positive_fraction >= 0.60
  ));
  const alphaIndependenceSupported = beatsBoth && rollingConsistent;
  return Object.freeze({
    development,
    validation,
    validation_annual_origin_windows: rolling,
    candidate_beats_control_in_both_selection_slices: beatsBoth,
    every_validation_rolling_family_has_positive_median_and_60pct_win_rate: rollingConsistent,
    alpha_independence_from_static_growth_tilt_supported: alphaIndependenceSupported,
    mechanical_distinction: distinction,
    control_disclosure_complete: distinction.mechanically_distinct,
    interpretation: alphaIndependenceSupported
      ? "The candidate met the frozen consistency definition against the static growth control, although the result remains retrospective."
      : "The candidate did not meet the frozen consistency definition against the static growth control. Mechanical distinction is disclosed, but alpha independent of SPY/QQQ growth exposure is rejected.",
  });
}

export function validateFrozenSelection(report, protocol, trialLedger) {
  const reasons = [];
  if (report?.schema_version !== "finly_quant_champion_generation4.v1") reasons.push("unexpected Generation 4 output schema");
  if (report?.raw_return_track?.selected_id_before_recent_and_robustness !== FIXED_CANDIDATE_ID) {
    reasons.push(`frozen raw candidate is not ${FIXED_CANDIDATE_ID}`);
  }
  if (report?.balanced_track?.selected_id_before_recent_and_robustness !== null) reasons.push("a balanced candidate unexpectedly exists");
  if (report?.disposition !== "RAW_RETURN_ROBUSTNESS_PENDING") reasons.push("frozen disposition is not robustness-pending");
  if (report?.raw_return_track?.recent_veto?.applicable !== true) reasons.push("frozen recent veto was not applied");
  if (report?.raw_return_track?.recent_veto?.hard_safety_veto !== false) reasons.push("frozen recent veto did not pass");
  if (protocol?.trial_accounting?.cumulative_effective_trials !== CUMULATIVE_TRIALS) reasons.push("protocol trial count is not 100");
  if (trialLedger?.append_only_through !== CUMULATIVE_TRIALS) reasons.push("trial ledger is not append-only through 100");
  return Object.freeze({
    passes: reasons.length === 0,
    reasons: Object.freeze(reasons),
    fixed_candidate_id: FIXED_CANDIDATE_ID,
    frozen_disposition: report?.disposition ?? null,
    recent_consumed: true,
  });
}

export function assessSourceOverlapEvidence(
  evidence,
  expectedPanelHash,
  requiredSymbols = REQUIRED_SOURCE_OVERLAP_SYMBOLS,
  expectedGeneration4OutputHash = null,
  expectedGeneration4ProtocolHash = null,
) {
  if (!evidence) {
    return Object.freeze({
      status: "NOT_RUN",
      passes: false,
      required_symbols: requiredSymbols,
      missing_symbols: requiredSymbols,
      reasons: Object.freeze(["authenticated source-overlap artifact is absent"]),
    });
  }
  const reasons = [];
  if (evidence.schema_version !== SOURCE_OVERLAP_SCHEMA) reasons.push("unexpected source-overlap schema");
  if (evidence.protocol_sha256 !== SOURCE_OVERLAP_PROTOCOL_SHA256) reasons.push("source-overlap protocol hash mismatch");
  if (evidence.generation4_panel_sha256 !== expectedPanelHash) reasons.push("source-overlap panel hash does not match Generation 4");
  if (expectedGeneration4OutputHash && evidence.generation4_output_sha256 !== expectedGeneration4OutputHash) {
    reasons.push("source-overlap Generation 4 output hash mismatch");
  }
  if (expectedGeneration4ProtocolHash && evidence.generation4_protocol_sha256 !== expectedGeneration4ProtocolHash) {
    reasons.push("source-overlap Generation 4 protocol hash mismatch");
  }
  if (evidence.candidate_id !== FIXED_CANDIDATE_ID) reasons.push("source-overlap candidate mismatch");
  if (evidence.alpaca_split_source?.provider !== "Alpaca Market Data API"
    || evidence.alpaca_split_source?.origin !== "https://data.alpaca.markets"
    || evidence.alpaca_split_source?.path !== "/v2/stocks/bars"
    || evidence.alpaca_split_source?.feed !== "iex"
    || evidence.alpaca_split_source?.adjustment !== "split"
    || evidence.alpaca_split_source?.authenticated_read_only_get !== true) {
    reasons.push("split-adjusted Alpaca provenance is incomplete or invalid");
  }
  if (evidence.alpaca_all_source?.provider !== "Alpaca Market Data API"
    || evidence.alpaca_all_source?.origin !== "https://data.alpaca.markets"
    || evidence.alpaca_all_source?.path !== "/v2/stocks/bars"
    || evidence.alpaca_all_source?.feed !== "iex"
    || evidence.alpaca_all_source?.adjustment !== "all"
    || evidence.alpaca_all_source?.authenticated_read_only_get !== true) {
    reasons.push("all-adjusted Alpaca provenance is incomplete or invalid");
  }
  if (evidence.disposition !== "PASS") reasons.push(`source-overlap disposition is ${evidence.disposition ?? "missing"}, not PASS`);
  if (evidence.reconciliation?.passed !== true) reasons.push("source-overlap reconciliation did not pass overall");
  if (evidence.reconciliation?.candidate?.passed !== true) reasons.push("fixed-candidate source concordance did not pass");
  const symbolEvidence = evidence.reconciliation?.per_symbol && typeof evidence.reconciliation.per_symbol === "object"
    ? evidence.reconciliation.per_symbol
    : {};
  const missingSymbols = requiredSymbols.filter((symbol) => !symbolEvidence[symbol]);
  const failedSymbols = requiredSymbols.filter((symbol) => symbolEvidence[symbol] && symbolEvidence[symbol].passed !== true);
  if (missingSymbols.length > 0) reasons.push(`missing symbols: ${missingSymbols.join(", ")}`);
  if (failedSymbols.length > 0) reasons.push(`failed symbols: ${failedSymbols.join(", ")}`);
  return Object.freeze({
    status: reasons.length === 0 ? "PASS" : "INVALID_OR_FAILED",
    passes: reasons.length === 0,
    required_symbols: requiredSymbols,
    missing_symbols: missingSymbols,
    failed_symbols: failedSymbols,
    reasons: Object.freeze(reasons),
    evidence_generated_at: evidence.generated_at ?? null,
    frozen_result_disposition: evidence.disposition ?? null,
    candidate_level_passes: evidence.reconciliation?.candidate?.passed === true,
  });
}

async function readFrozenSourceOverlap() {
  try {
    const [raw, protocolRaw, receiptRaw] = await Promise.all([
      readFile(sourceOverlapPath),
      readFile(sourceOverlapProtocolPath),
      readFile(sourceOverlapFreezeReceiptPath),
    ]);
    invariant(hashBytes(raw) === SOURCE_OVERLAP_OUTPUT_SHA256, "authenticated source-overlap result hash mismatch");
    invariant(hashBytes(protocolRaw) === SOURCE_OVERLAP_PROTOCOL_SHA256, "source-overlap protocol hash mismatch");
    invariant(hashBytes(receiptRaw) === SOURCE_OVERLAP_FREEZE_RECEIPT_SHA256, "source-overlap freeze-receipt hash mismatch");
    const receipt = parseJson(receiptRaw, "source-overlap freeze receipt");
    invariant(receipt?.frozen_before_authenticated_read === true, "source-overlap receipt was not frozen before authentication");
    const verifiedFiles = {};
    for (const [relativePath, expectedHash] of Object.entries(receipt.files ?? {})) {
      const path = resolve(projectRoot, relativePath);
      invariant(path.startsWith(`${projectRoot}/`), `source-overlap receipt path escaped project root: ${relativePath}`);
      const sourceRaw = await readFile(path);
      const actualHash = hashBytes(sourceRaw);
      invariant(actualHash === expectedHash, `source-overlap frozen file hash mismatch: ${relativePath}`);
      verifiedFiles[relativePath] = actualHash;
    }
    return Object.freeze({
      evidence: parseJson(raw, "source-overlap artifact"),
      sha256: hashBytes(raw),
      protocol_sha256: hashBytes(protocolRaw),
      freeze_receipt_sha256: hashBytes(receiptRaw),
      verified_files: Object.freeze(verifiedFiles),
      read_error: null,
    });
  } catch (error) {
    return Object.freeze({
      evidence: null,
      sha256: null,
      protocol_sha256: null,
      freeze_receipt_sha256: null,
      verified_files: Object.freeze({}),
      read_error: error.message,
    });
  }
}

async function verifyFreezeReceipt(receipt) {
  invariant(receipt?.status === "frozen_before_first_generation_4_output", "Generation 4 freeze receipt has the wrong status");
  invariant(receipt?.generation_4_results_seen_at_freeze === false, "Generation 4 receipt was not frozen before results");
  const verified = {};
  for (const [relativePath, expectedHash] of Object.entries(receipt.files ?? {})) {
    const path = resolve(projectRoot, relativePath);
    invariant(path.startsWith(`${projectRoot}/`), `freeze receipt path escaped project root: ${relativePath}`);
    const raw = await readFile(path);
    const actualHash = hashBytes(raw);
    invariant(actualHash === expectedHash, `frozen file hash mismatch: ${relativePath}`);
    verified[relativePath] = actualHash;
  }
  return Object.freeze(verified);
}

async function verifyRobustnessFreezeReceipt(receipt) {
  invariant(
    receipt?.status === "frozen_before_first_post_selection_robustness_output",
    "post-selection robustness freeze receipt has the wrong status",
  );
  invariant(receipt?.robustness_results_seen_at_freeze === false, "robustness receipt was not frozen before results");
  const verified = {};
  for (const [relativePath, expectedHash] of Object.entries(receipt.files ?? {})) {
    const path = resolve(projectRoot, relativePath);
    invariant(path.startsWith(`${projectRoot}/`), `robustness receipt path escaped project root: ${relativePath}`);
    const raw = await readFile(path);
    const actualHash = hashBytes(raw);
    invariant(actualHash === expectedHash, `post-selection frozen file hash mismatch: ${relativePath}`);
    verified[relativePath] = actualHash;
  }
  return Object.freeze(verified);
}

async function loadFrozenInputs() {
  const [
    robustnessProtocolRaw,
    robustnessReceiptRaw,
    protocolRaw,
    receiptRaw,
    trialLedgerRaw,
    frozenOutputRaw,
    runnerRaw,
  ] = await Promise.all([
    readFile(robustnessProtocolPath),
    readFile(robustnessFreezeReceiptPath),
    readFile(protocolPath),
    readFile(freezeReceiptPath),
    readFile(trialLedgerPath),
    readFile(frozenOutputPath),
    readFile(modulePath),
  ]);
  const robustnessProtocol = parseJson(robustnessProtocolRaw, "Generation 4 robustness protocol");
  const robustnessReceipt = parseJson(robustnessReceiptRaw, "Generation 4 robustness freeze receipt");
  const protocol = parseJson(protocolRaw, "Generation 4 protocol");
  const receipt = parseJson(receiptRaw, "Generation 4 freeze receipt");
  const trialLedger = parseJson(trialLedgerRaw, "Generation 4 trial ledger");
  const frozenOutput = parseJson(frozenOutputRaw, "Generation 4 output");
  const protocolHash = hashBytes(protocolRaw);
  const trialLedgerHash = hashBytes(trialLedgerRaw);
  invariant(protocolHash === frozenOutput.protocol_sha256, "protocol hash does not match frozen output");
  invariant(trialLedgerHash === frozenOutput.trial_ledger_sha256, "trial-ledger hash does not match frozen output");
  const selection = validateFrozenSelection(frozenOutput, protocol, trialLedger);
  invariant(selection.passes, `frozen selection validation failed: ${selection.reasons.join("; ")}`);
  const verifiedFreezeFiles = await verifyFreezeReceipt(receipt);
  const robustnessProtocolValidation = validateRobustnessProtocol(robustnessProtocol);
  invariant(
    robustnessProtocolValidation.passes,
    `post-selection robustness protocol validation failed: ${robustnessProtocolValidation.reasons.join("; ")}`,
  );
  const verifiedRobustnessFreezeFiles = await verifyRobustnessFreezeReceipt(robustnessReceipt);
  invariant(robustnessProtocol.frozen_inputs.generation4_output.sha256 === hashBytes(frozenOutputRaw), "robustness protocol Generation 4 output hash mismatch");
  invariant(robustnessProtocol.frozen_inputs.generation4_protocol_sha256 === protocolHash, "robustness protocol base protocol hash mismatch");
  invariant(robustnessProtocol.frozen_inputs.trial_ledger_sha256 === trialLedgerHash, "robustness protocol trial-ledger hash mismatch");
  const panelPath = safePrivateArtifactPath(frozenOutput.dataset.private_panel_filename);
  const ledgerPath = safePrivateArtifactPath(frozenOutput.dataset.private_ledger_filename);
  const [panelRaw, ledgerRaw] = await Promise.all([readFile(panelPath), readFile(ledgerPath)]);
  invariant(hashBytes(panelRaw) === frozenOutput.dataset.private_panel_payload_sha256, "private panel byte hash mismatch");
  invariant(hashBytes(ledgerRaw) === frozenOutput.dataset.private_ledger_gzip_sha256, "private ledger gzip hash mismatch");
  invariant(robustnessProtocol.frozen_inputs.private_panel.payload_sha256 === hashBytes(panelRaw), "robustness protocol private panel hash mismatch");
  invariant(robustnessProtocol.frozen_inputs.private_ledger.gzip_sha256 === hashBytes(ledgerRaw), "robustness protocol private ledger hash mismatch");
  const panel = parseJson(panelRaw, "private Generation 4 panel");
  const privateLedger = parseJson(gunzipSync(ledgerRaw), "private Generation 4 ledger");
  invariant(panel.schema_version === "finly_generation4_private_panel.v1", "private panel schema mismatch");
  invariant(panel.protocol_sha256 === protocolHash, "private panel protocol hash mismatch");
  invariant(privateLedger.schema_version === "finly_generation4_private_ledger.v1", "private ledger schema mismatch");
  invariant(privateLedger.normalized_panel_sha256 === panel.normalized_panel_sha256, "private artifacts disagree on panel hash");
  invariant(panel.normalized_panel_sha256 === frozenOutput.dataset.normalized_panel_sha256, "private panel differs from frozen output");
  invariant(Array.isArray(panel.points) && panel.points.length === frozenOutput.dataset.common_sessions, "private panel row count mismatch");
  let priorDate = "";
  for (const point of panel.points) {
    invariant(typeof point.date === "string" && point.date > priorDate, "private panel dates are not strictly chronological");
    priorDate = point.date;
    for (const symbol of CORE_SYMBOLS) invariant(Number.isFinite(point[symbol]) && point[symbol] > 0, `invalid ${symbol} panel value at ${point.date}`);
  }
  const normalizedHash = sha256(panel.points.map((point) => [
    point.date,
    ...CORE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
  ]));
  invariant(normalizedHash === panel.normalized_panel_sha256, "normalized private panel hash cannot be reproduced");
  for (const id of REQUIRED_SIMULATION_IDS) {
    invariant(Array.isArray(privateLedger.simulations?.[id]), `private ledger omits ${id}`);
  }
  return Object.freeze({
    robustnessProtocol,
    robustnessReceipt,
    robustnessProtocolValidation,
    protocol,
    receipt,
    trialLedger,
    frozenOutput,
    panel,
    privateLedger,
    selection,
    hashes: Object.freeze({
      robustness_protocol_sha256: hashBytes(robustnessProtocolRaw),
      robustness_freeze_receipt_sha256: hashBytes(robustnessReceiptRaw),
      protocol_sha256: protocolHash,
      freeze_receipt_sha256: hashBytes(receiptRaw),
      trial_ledger_sha256: trialLedgerHash,
      frozen_generation4_output_sha256: hashBytes(frozenOutputRaw),
      private_panel_sha256: hashBytes(panelRaw),
      private_ledger_gzip_sha256: hashBytes(ledgerRaw),
      robustness_runner_sha256: hashBytes(runnerRaw),
    }),
    verifiedFreezeFiles,
    verifiedRobustnessFreezeFiles,
  });
}

function verifyBaseReplay(simulations, privateLedger) {
  const strategies = Object.fromEntries(REQUIRED_SIMULATION_IDS.map((id) => {
    const replayRows = simulations.get(id).rows;
    const frozenRows = privateLedger.simulations[id];
    const replayHash = sha256(replayRows);
    const frozenHash = sha256(frozenRows);
    return [id, Object.freeze({
      exact_match: replayHash === frozenHash,
      replay_rows: replayRows.length,
      frozen_rows: frozenRows.length,
      replay_rows_sha256: replayHash,
      frozen_rows_sha256: frozenHash,
    })];
  }));
  return Object.freeze({
    strategies,
    all_required_base_simulations_match_frozen_private_ledger_exactly: Object.values(strategies).every((item) => item.exact_match),
  });
}

function stripSimulationMaps(costStress) {
  return Object.freeze(costStress.records.map((record) => Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "simulations"),
  )));
}

function suiteMaximumAdjustedPValue(suite) {
  return Math.max(...Object.values(suite.evidence).flatMap((method) => Object.values(method))
    .map((item) => item.fixed_candidate_familywise_adjusted_p_value));
}

function renderReport(report) {
  const costRows = report.cost_stress.records.map((record) => {
    const development = record.slices.development.comparisons.spy_buy_hold.annualized_log_growth_difference;
    const validation = record.slices.validation.comparisons.spy_buy_hold.annualized_log_growth_difference;
    const recent = record.slices.recent_consumed_diagnostic.comparisons.spy_buy_hold.annualized_log_growth_difference;
    return `| ${record.cost_bps} | ${(100 * development).toFixed(2)}% | ${(100 * validation).toFixed(2)}% | ${(100 * recent).toFixed(2)}% | ${record.gates.development_spy_edge_positive && record.gates.validation_spy_edge_positive ? "PASS" : "FAIL"} |`;
  }).join("\n");
  const validationStats = report.statistical_evidence.validation;
  const anchorDevelopment = report.schedule_offsets.aggregation.metric_summaries["development.annualized_log_growth_edge_vs_spy"];
  const anchorValidation = report.schedule_offsets.aggregation.metric_summaries["validation.annualized_log_growth_edge_vs_spy"];
  return `# Finly Generation 4 post-selection robustness\n\n## Answer first\n\n**${report.disposition}**. Fixed candidate: \`${report.fixed_candidate_id}\`. Local robustness: **${report.gates.local_robustness_passes ? "PASS" : "FAIL"}**. Authenticated source overlap: **${report.source_overlap.status}**. Promotion is fail-closed until every frozen gate passes.\n\n## Cost stress versus SPY\n\n| One-way cost | Development log-growth edge | Validation log-growth edge | Recent edge (consumed) | Pre-recent sign gate |\n|---:|---:|---:|---:|---|\n${costRows}\n\n## Schedule sensitivity\n\nAll 21 native monthly offsets were run. Development minimum: ${(100 * anchorDevelopment.minimum).toFixed(2)}% at offset ${anchorDevelopment.minimum_offset}; validation minimum: ${(100 * anchorValidation.minimum).toFixed(2)}% at offset ${anchorValidation.minimum_offset}. All-offset sign gate: **${report.gates.all_21_offsets_keep_development_and_validation_spy_edges_positive ? "PASS" : "FAIL"}**.\n\n## Multiplicity and dependence\n\n| Consumed slice | DSR probability | Worst familywise adjusted p-value across circular/moving 5/20/60 blocks |\n|---|---:|---:|\n| Validation only | ${(100 * validationStats.deflated_sharpe.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark).toFixed(2)}% | ${suiteMaximumAdjustedPValue(validationStats.paired_block_bootstrap).toFixed(4)} |\n\nThe DSR declares all 100 disclosed trials, while its observable trial-distribution moments use the seven eligible Generation 4 candidates on the exact ledger. The static 50/50 growth control is excluded from that candidate family and reported separately. The block tests share one resampled path across the family and use deterministic seeds. Validation was already consumed by selection; these tests do not create a fresh holdout.\n\n## Growth-control boundary\n\n${report.static_growth_control.interpretation}\n\n## Required caveats\n\n- Development, validation, and 2025–2026 recent data were all seen before this post-selection audit. Recent is a consumed veto diagnostic, not fresh evidence.\n- The ETF universe survives to 2026 and QQQ is an obvious ex-post winner; this is retrospective shadow research, not proof of future profitability.\n- Source overlap is checked only from a separate authenticated artifact. This runner makes no market request and refuses promotion when that artifact is absent, malformed, incomplete, or tied to another panel hash.\n- Failing the static-control consistency definition rejects alpha independent of growth tilt even if the candidate is mechanically different and beats SPY.\n- A pass may justify only the frozen label \`RAW_RETURN_SHADOW_ONLY\`; it cannot justify \`BALANCED_SHADOW_ONLY\`, live capital, or a profitability guarantee.\n`;
}

export async function runGeneration4Robustness() {
  const frozen = await loadFrozenInputs();
  const costStressWithMaps = buildCostStress(frozen.panel.points);
  const baseFiveBpsRecord = costStressWithMaps.records.find((record) => record.cost_bps === 5);
  invariant(baseFiveBpsRecord, "5 bp base record is missing");
  const baseReplay = verifyBaseReplay(baseFiveBpsRecord.simulations, frozen.privateLedger);
  invariant(
    baseReplay.all_required_base_simulations_match_frozen_private_ledger_exactly,
    "post-selection base replay differs from the frozen private ledger",
  );
  const scheduleOffsets = buildAnchorRobustness(frozen.panel.points, baseFiveBpsRecord.simulations);
  const statisticalEvidence = buildStatisticalEvidence(baseFiveBpsRecord.simulations);
  const staticGrowthControl = buildStaticControlAssessment(baseFiveBpsRecord);
  const sourceArtifact = await readFrozenSourceOverlap();
  const sourceOverlap = assessSourceOverlapEvidence(
    sourceArtifact.evidence,
    frozen.panel.normalized_panel_sha256,
    REQUIRED_SOURCE_OVERLAP_SYMBOLS,
    frozen.hashes.frozen_generation4_output_sha256,
    frozen.hashes.protocol_sha256,
  );
  const sourceAssessment = sourceArtifact.read_error
    ? Object.freeze({ ...sourceOverlap, status: "READ_ERROR", passes: false, reasons: [...sourceOverlap.reasons, sourceArtifact.read_error] })
    : sourceOverlap;
  const allOffsetsPass = scheduleOffsets.aggregation.complete_offset_coverage
    && scheduleOffsets.aggregation.gate_summaries["development.spy_edge_positive"].all_expected_offsets_pass
    && scheduleOffsets.aggregation.gate_summaries["validation.spy_edge_positive"].all_expected_offsets_pass;
  const recentVetoPass = baseFiveBpsRecord.recent_consumed_safety_veto.hard_safety_veto === false;
  const localRobustnessPass = frozen.selection.passes
    && baseReplay.all_required_base_simulations_match_frozen_private_ledger_exactly
    && costStressWithMaps.assessment.raw_spy_edge_keeps_sign_at_every_cost
    && allOffsetsPass
    && statisticalEvidence.gates.validation_deflated_sharpe_probability_at_least_95_percent
    && statisticalEvidence.gates.all_six_validation_fixed_candidate_familywise_p_values_at_most_5_percent
    && staticGrowthControl.control_disclosure_complete
    && recentVetoPass;
  const promotionEligible = localRobustnessPass && sourceAssessment.passes;
  const disposition = promotionEligible
    ? "RAW_RETURN_SHADOW_ONLY"
    : localRobustnessPass
      ? "LOCAL_ROBUSTNESS_PASS_SOURCE_OVERLAP_REQUIRED"
      : "KEEP_V1_POST_SELECTION_ROBUSTNESS_FAILED";
  const report = Object.freeze({
    schema_version: "finly_quant_champion_generation4_robustness.v1",
    generated_at: new Date().toISOString(),
    fixed_candidate_id: FIXED_CANDIDATE_ID,
    frozen_track: "raw_return_shadow",
    disposition,
    claim_boundary: "Retrospective fixed-candidate falsification only. A full pass earns RAW_RETURN_SHADOW_ONLY, never a future-profit or balanced-champion claim.",
    consumed_data_disclosure: Object.freeze({
      development: "seen during search",
      validation: "seen during selection",
      recent_2025_2026: "seen and consumed by the frozen hard-safety veto",
      pristine_holdout_remaining: false,
    }),
    input_integrity: Object.freeze({
      hashes: frozen.hashes,
      verified_freeze_files: frozen.verifiedFreezeFiles,
      verified_post_selection_freeze_files: frozen.verifiedRobustnessFreezeFiles,
      post_selection_protocol_validation: frozen.robustnessProtocolValidation,
      normalized_panel_sha256: frozen.panel.normalized_panel_sha256,
      common_sessions: frozen.panel.points.length,
      private_ledger_schema: frozen.privateLedger.schema_version,
      no_market_fetch_performed: true,
      base_replay: baseReplay,
    }),
    frozen_selection: frozen.selection,
    cost_stress: Object.freeze({
      records: stripSimulationMaps(costStressWithMaps),
      assessment: costStressWithMaps.assessment,
    }),
    schedule_offsets: scheduleOffsets,
    statistical_evidence: statisticalEvidence,
    comparator_scope: Object.freeze({
      ids: COMPARATOR_IDS,
      statement: "Every cost record contains standalone development, validation, and consumed-recent comparisons against SPY, QQQ, frozen Finly, 15% SPY volatility targeting, and static 50/50 SPY/QQQ.",
    }),
    static_growth_control: staticGrowthControl,
    alpha_independence_claim: staticGrowthControl.alpha_independence_from_static_growth_tilt_supported
      ? "RETROSPECTIVELY_SUPPORTED_UNDER_FROZEN_STATIC_CONTROL_DEFINITION"
      : "REJECTED_NOT_CONSISTENTLY_ABOVE_STATIC_SPY_QQQ_CONTROL",
    source_overlap: Object.freeze({
      ...sourceAssessment,
      artifact_path: "research/output/source_overlap_reconciliation.json",
      artifact_sha256: sourceArtifact.sha256,
      protocol_sha256: sourceArtifact.protocol_sha256,
      freeze_receipt_sha256: sourceArtifact.freeze_receipt_sha256,
      verified_source_freeze_files: sourceArtifact.verified_files,
      expected_schema: SOURCE_OVERLAP_SCHEMA,
      no_fetch_boundary: "This runner never fetches market data and consumes only the hash-pinned authenticated Alpaca reconciliation result frozen into the post-selection protocol. The known FAIL_CLOSED result cannot be replaced or rescued.",
    }),
    gates: Object.freeze({
      frozen_candidate_and_recent_veto_match: frozen.selection.passes && recentVetoPass,
      base_5bp_replay_matches_private_ledger_exactly: baseReplay.all_required_base_simulations_match_frozen_private_ledger_exactly,
      raw_spy_edge_keeps_sign_at_5_10_25bp: costStressWithMaps.assessment.raw_spy_edge_keeps_sign_at_every_cost,
      all_21_offsets_keep_development_and_validation_spy_edges_positive: allOffsetsPass,
      validation_dsr_probability_at_least_95_percent: statisticalEvidence.gates.validation_deflated_sharpe_probability_at_least_95_percent,
      validation_familywise_p_at_most_5_percent_for_all_six_block_tests: statisticalEvidence.gates.all_six_validation_fixed_candidate_familywise_p_values_at_most_5_percent,
      static_growth_control_disclosure_complete: staticGrowthControl.control_disclosure_complete,
      alpha_independence_from_static_growth_tilt_supported: staticGrowthControl.alpha_independence_from_static_growth_tilt_supported,
      authenticated_source_overlap_for_every_used_symbol: sourceAssessment.passes,
      local_robustness_passes: localRobustnessPass,
      promotion_eligible: promotionEligible,
    }),
  });
  return report;
}

async function main() {
  const report = await runGeneration4Robustness();
  await atomicWrite(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(markdownOutputPath, renderReport(report));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    fixed_candidate_id: report.fixed_candidate_id,
    disposition: report.disposition,
    local_robustness_passes: report.gates.local_robustness_passes,
    source_overlap_passes: report.gates.authenticated_source_overlap_for_every_used_symbol,
    json: jsonOutputPath,
    report: markdownOutputPath,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
