import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  calculatePortfolioMetrics,
  mean,
  quantile,
  rebaseRowsForStandalonePeriod,
  round,
  rowsWithin,
  sampleStandardDeviation,
  sha256,
  simulateStrategy,
} from "./champion_engine.mjs";
import { CORE_SYMBOLS, createPrimaryStrategies } from "./champion_strategies.mjs";
import { createGeneration4Strategies } from "./champion_strategies_generation4.mjs";
import { createGeneration5Strategies } from "./champion_strategies_generation5.mjs";
import {
  createGeneration6Strategies,
  GENERATION6_METADATA,
  GENERATION6_REQUIRED_SYMBOLS,
} from "./champion_strategies_generation6.mjs";
import {
  GENERATION6_BLOCK_LENGTHS,
  GENERATION6_BOOTSTRAP_ITERATIONS,
  GENERATION6_BOOTSTRAP_SEEDS,
  GENERATION6_COST_LEVELS_BPS,
  GENERATION6_CUMULATIVE_TRIALS,
  GENERATION6_REBALANCE_ANCHORS,
  GENERATION6_VOLATILITY_MATCH_SPECIFICATION,
} from "./champion_generation6_robustness.mjs";
import { GENERATION6_GROWTH_STATISTICS_SPECIFICATION } from "./champion_generation6_growth_statistics.mjs";
import {
  GENERATION6_CANDIDATE_REQUIRED_SYMBOLS,
  GENERATION6_SOURCE_SIMULATION_OPTIONS,
  GENERATION6_SOURCE_SYMBOLS,
  GENERATION6_SOURCE_THRESHOLDS,
} from "./source_overlap_reconciliation_generation6.mjs";
import {
  GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH,
  GENERATION6_ALPACA_PANEL_PROTOCOL_PATH,
  GENERATION6_ALPACA_PANEL_REQUEST,
  GENERATION6_ALPACA_PANEL_RESULT_RECEIPT_PATH,
  GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH,
  validateStoredGeneration6AlpacaPanel,
} from "./persist_alpaca_adjustment_all_panel_generation6.mjs";
import { compareRollingMonthlyContributions } from "./recurring_contribution.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const protocolPath = resolve(projectRoot, "research/champion_search_generation6_protocol.json");
const trialLedgerPath = resolve(projectRoot, "research/champion_trial_ledger_generation6.json");
const freezeReceiptPath = resolve(projectRoot, "research/champion_search_generation6_freeze_receipt.json");
const outputDirectory = resolve(projectRoot, "research/output");
const jsonOutputPath = resolve(outputDirectory, "quant_champion_generation6.json");
const markdownOutputPath = resolve(outputDirectory, "quant_champion_generation6_report.md");
const resultReceiptPath = resolve(projectRoot, "research/champion_generation6_result_receipt.json");
export const GENERATION6_RUN_CLAIM_RELATIVE_PATH = "research/champion_generation6_run_claim.json";
const runClaimPath = resolve(projectRoot, GENERATION6_RUN_CLAIM_RELATIVE_PATH);
const runLockPath = resolve(projectRoot, "research/.champion_generation6_run.lock");

export const GENERATION6_ALL_IDS = Object.freeze(createGeneration6Strategies().map((strategy) => strategy.id));
export const GENERATION6_CONTROL_IDS = Object.freeze(GENERATION6_ALL_IDS.filter(
  (id) => GENERATION6_METADATA[id]?.eligible === false,
));
export const GENERATION6_CANDIDATE_IDS = Object.freeze(GENERATION6_ALL_IDS.filter(
  (id) => GENERATION6_METADATA[id]?.eligible === true,
));

export const GENERATION6_GROWTH_CONTROL_IDS = Object.freeze([
  "qqq_buy_hold",
  "static_spy_qqq_50_50_control",
  "static_qqq_equal_sectors_control",
]);

export const GENERATION6_COMPARATOR_IDS = Object.freeze([
  "spy_buy_hold",
  ...GENERATION6_GROWTH_CONTROL_IDS,
  "qqq_core_sector_12_6",
  "frozen_finly",
  "spy_vol_target_15",
  "bil_cash",
  "faber_gtaa5_trend",
]);

export const GENERATION6_SLICES = Object.freeze({
  development: Object.freeze({ start: "2008-06-02", end: "2017-12-29" }),
  validation: Object.freeze({ start: "2018-01-02", end: "2024-12-31" }),
  recent_veto_only: Object.freeze({ start: "2025-01-02", end: "2026-08-27" }),
});

export const GENERATION6_BASE_OPTIONS = Object.freeze({
  cashSymbol: "BIL",
  lookbackSessions: 252,
  rebalanceIntervalSessions: 21,
  rebalanceAnchor: 0,
  oneWayCostBps: 5,
  annualBorrowSpread: 0.005,
  maximumRiskyGross: 1,
  terminalLiquidation: true,
});

export const GENERATION6_SELECTION_THRESHOLDS = Object.freeze({
  minimum_spy_annualized_log_growth_edge: 0.005,
  minimum_cash_excess_sharpe_difference: 0,
  maximum_drawdown_disadvantage: 0.05,
  maximum_expected_shortfall_magnitude_ratio: 1.10,
  maximum_annualized_turnover_notional: 4,
  recent_absolute_maximum_drawdown_floor: -0.20,
});

export const GENERATION6_ROLLING_HORIZONS = Object.freeze([252, 504, 756]);
export const GENERATION6_REGIME_SPECIFICATION = Object.freeze({
  trendLookbackSessions: 252,
  volatilityLookbackSessions: 63,
  highVolatilityAnnualizedThreshold: 0.20,
});
export const GENERATION6_RECURRING_SPECIFICATION = Object.freeze({
  monthly_contribution: 300,
  horizons_months: Object.freeze([1, 3, 6, 12]),
  minimum_start_date: "2013-01-01",
  one_way_cost_bps: 5,
  fractional_units: true,
  terminal_sale: false,
});

const REQUIRED_PRIMARY_IDS = Object.freeze([
  "bil_cash",
  "spy_buy_hold",
  "qqq_buy_hold",
  "frozen_finly",
  "spy_vol_target_15",
]);
const REQUIRED_GENERATION4_IDS = Object.freeze([
  "static_spy_qqq_50_50_control",
  "qqq_core_sector_12_6",
]);
const REQUIRED_GENERATION5_IDS = Object.freeze(["static_qqq_equal_sectors_control"]);
const EXPECTED_PRIOR_TRIALS = 105;
const EXPECTED_FIRST_TRIAL = EXPECTED_PRIOR_TRIALS + 1;
const EXPECTED_LAST_TRIAL = EXPECTED_PRIOR_TRIALS + GENERATION6_ALL_IDS.length;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256Bytes(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function orderedEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function compound(values) {
  return values.reduce((wealth, value) => wealth * (1 + value), 1) - 1;
}

function describe(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return Object.freeze({
    count: values.length,
    mean: round(mean(values)),
    minimum: round(Math.min(...values)),
    p05: round(quantile(values, 0.05)),
    median: round(quantile(values, 0.50)),
    p95: round(quantile(values, 0.95)),
    maximum: round(Math.max(...values)),
    positive_fraction: round(values.filter((value) => value > 0).length / values.length),
  });
}

function assertAlignedRows(left, right, leftId = "candidate", rightId = "benchmark") {
  invariant(Array.isArray(left) && Array.isArray(right), `${leftId} and ${rightId} rows are required`);
  invariant(left.length === right.length && left.length > 0, `${leftId} and ${rightId} row counts are misaligned`);
  for (let index = 0; index < left.length; index += 1) {
    invariant(
      left[index].execution_return_date === right[index].execution_return_date,
      `${leftId} and ${rightId} dates are misaligned at ${index}`,
    );
  }
}

export function annualizedLogGrowth(metrics) {
  invariant(metrics && Number.isSafeInteger(metrics.observations) && metrics.observations > 0, "metrics observations are invalid");
  invariant(finite(metrics.total_return) && metrics.total_return > -1, "metrics total return is invalid");
  return Math.log1p(metrics.total_return) * 252 / metrics.observations;
}

export function annualizedLogGrowthEdge(candidateMetrics, comparatorMetrics) {
  return round(annualizedLogGrowth(candidateMetrics) - annualizedLogGrowth(comparatorMetrics));
}

function thresholdRegistry(protocol) {
  return protocol?.selection?.thresholds ?? protocol?.selection_thresholds ?? null;
}

function candidateRegistry(protocol, trackId) {
  return protocol?.selection_tracks?.[trackId]?.candidate_ids ?? null;
}

export function validateGeneration6Protocol(protocol, trialLedger) {
  const reasons = [];
  const registry = protocol?.registered_formulas ?? [];
  const registeredIds = registry.map((item) => item.id);
  const registeredTrials = registry.map((item) => item.trial);
  const expectedTrials = Array.from(
    { length: GENERATION6_ALL_IDS.length },
    (_, index) => EXPECTED_FIRST_TRIAL + index,
  );
  const range = `${EXPECTED_FIRST_TRIAL}-${EXPECTED_LAST_TRIAL}`;
  const ledgerBlock = trialLedger?.blocks?.find((block) => block.range === range);
  const thresholds = thresholdRegistry(protocol);
  const robustness = protocol?.post_selection_robustness;
  const privatePanel = protocol?.frozen_inputs?.generation_4_private_panel;
  const alpacaAcquisitionProtocol = protocol?.frozen_inputs
    ?.generation_6_alpaca_acquisition_protocol;
  const alpacaAcquisitionFreeze = protocol?.frozen_inputs
    ?.generation_6_alpaca_acquisition_freeze_receipt;
  const alpacaAcquisitionClaim = protocol?.frozen_inputs
    ?.generation_6_alpaca_acquisition_run_claim;
  const alpacaAcquisitionResult = protocol?.frozen_inputs
    ?.generation_6_alpaca_acquisition_result_receipt;
  const alpacaPanel = protocol?.frozen_inputs?.generation_6_alpaca_all_panel;

  if (protocol?.schema_version !== "finly_champion_search_generation6_protocol.v1") reasons.push("protocol schema mismatch");
  if (protocol?.status !== "preregistered_before_first_generation_6_output") reasons.push("protocol status mismatch");
  if (protocol?.frozen_before_first_generation_6_output !== true) reasons.push("protocol is not marked frozen before output");
  if (protocol?.maximum_permitted_status !== "RETROSPECTIVE_PAPER_CHALLENGER") reasons.push("protocol claim ceiling mismatch");
  if (protocol?.data?.runner_market_fetch_permitted !== false) reasons.push("protocol does not forbid runner market fetches");
  if (!orderedEqual(protocol?.data?.symbols, GENERATION6_REQUIRED_SYMBOLS)) reasons.push("protocol symbols differ from strategy requirements");
  if (!orderedEqual(GENERATION6_REQUIRED_SYMBOLS, CORE_SYMBOLS)) reasons.push("Generation 6 does not reuse the immutable CORE_SYMBOLS panel");
  if (!orderedEqual(registeredIds, GENERATION6_ALL_IDS)) reasons.push("registered formula ids differ from executable strategy order");
  if (!orderedEqual(registeredTrials, expectedTrials)) reasons.push(`registered trials are not exactly ${range}`);
  for (const item of registry) {
    if (item.eligible !== GENERATION6_METADATA[item.id]?.eligible) reasons.push(`eligibility mismatch for ${item.id}`);
    if (!sameJson(item.metadata, GENERATION6_METADATA[item.id])) reasons.push(`metadata mismatch for ${item.id}`);
  }
  if (GENERATION6_CONTROL_IDS.length !== 1 || GENERATION6_CONTROL_IDS[0] !== "faber_gtaa5_trend") {
    reasons.push("the executable Generation 6 control registry is not the frozen Faber control");
  }
  if (!orderedEqual(candidateRegistry(protocol, "primary_spy"), GENERATION6_CANDIDATE_IDS)) {
    reasons.push("primary SPY selection candidate registry mismatch");
  }
  if (!orderedEqual(candidateRegistry(protocol, "growth_control_challenge"), GENERATION6_CANDIDATE_IDS)) {
    reasons.push("growth-control selection candidate registry mismatch");
  }
  if (!orderedEqual(protocol?.comparators, GENERATION6_COMPARATOR_IDS)) reasons.push("comparator registry mismatch");
  if (protocol?.execution?.signal_trade_return
      !== "close-t information -> queued close-t+1 execution -> first t+1-to-t+2 return") {
    reasons.push("protocol signal/execution timing differs");
  }
  if (protocol?.execution?.lookback_sessions !== GENERATION6_BASE_OPTIONS.lookbackSessions) {
    reasons.push("protocol lookback differs");
  }
  if (protocol?.execution?.rebalance_interval_sessions
      !== GENERATION6_BASE_OPTIONS.rebalanceIntervalSessions) {
    reasons.push("protocol cadence is not 21 sessions");
  }
  if (protocol?.execution?.rebalance_anchor !== GENERATION6_BASE_OPTIONS.rebalanceAnchor) {
    reasons.push("protocol rebalance anchor differs");
  }
  if (protocol?.execution?.base_one_way_cost_bps_per_absolute_traded_notional
      !== GENERATION6_BASE_OPTIONS.oneWayCostBps) {
    reasons.push("protocol base one-way cost is not 5 bp");
  }
  if (protocol?.execution?.long_only !== true
      || protocol?.execution?.maximum_risky_gross !== GENERATION6_BASE_OPTIONS.maximumRiskyGross) {
    reasons.push("protocol long-only gross boundary mismatch");
  }
  if (protocol?.execution?.residual_cash_proxy !== GENERATION6_BASE_OPTIONS.cashSymbol) {
    reasons.push("protocol residual cash proxy differs");
  }
  if (protocol?.execution?.annual_borrow_spread !== GENERATION6_BASE_OPTIONS.annualBorrowSpread) {
    reasons.push("protocol annual borrow spread differs");
  }
  if (protocol?.execution?.terminal_liquidation !== GENERATION6_BASE_OPTIONS.terminalLiquidation) {
    reasons.push("protocol terminal-liquidation boundary differs");
  }
  if (!sameJson(protocol?.execution?.cost_stress_levels_bps, GENERATION6_COST_LEVELS_BPS)) {
    reasons.push("protocol cost-stress levels mismatch");
  }
  if (!privatePanel || typeof privatePanel !== "object") {
    reasons.push("protocol omits the Generation 4 private-panel descriptor");
  } else {
    const panelIdentityPairs = [
      [protocol?.data?.schema_version, privatePanel.schema_version, "schema"],
      [protocol?.data?.payload_sha256, privatePanel.payload_sha256, "payload hash"],
      [protocol?.data?.normalized_panel_sha256, privatePanel.normalized_panel_sha256,
        "normalized hash"],
      [protocol?.data?.common_start, privatePanel.common_start, "common start"],
      [protocol?.data?.common_end, privatePanel.common_end, "common end"],
      [protocol?.data?.common_sessions, privatePanel.common_sessions, "common sessions"],
    ];
    for (const [actual, expected, label] of panelIdentityPairs) {
      if (actual !== expected) reasons.push(`protocol top-level panel ${label} differs from frozen descriptor`);
    }
  }
  for (const [sliceId, expected] of Object.entries(GENERATION6_SLICES)) {
    const actual = protocol?.partitions?.[sliceId];
    if (actual?.start !== expected.start || actual?.end !== expected.end) reasons.push(`${sliceId} partition mismatch`);
  }
  for (const [key, expected] of Object.entries(GENERATION6_SELECTION_THRESHOLDS)) {
    if (thresholds?.[key] !== expected) reasons.push(`selection threshold mismatch for ${key}`);
  }
  if (protocol?.selection_tracks?.primary_spy?.benchmark_id !== "spy_buy_hold"
    || protocol?.selection_tracks?.primary_spy?.pending_label !== "SPY_CHALLENGER_ROBUSTNESS_PENDING") {
    reasons.push("primary SPY track definition mismatch");
  }
  if (!sameJson(
    protocol?.selection_tracks?.growth_control_challenge?.benchmark_ids,
    GENERATION6_GROWTH_CONTROL_IDS,
  ) || protocol?.selection_tracks?.growth_control_challenge?.pending_label
      !== "GROWTH_CONTROL_CHALLENGER_ROBUSTNESS_PENDING"
    || protocol?.selection_tracks?.growth_control_challenge?.can_veto_primary_spy !== false) {
    reasons.push("growth-control track definition mismatch");
  }
  if (!sameJson(protocol?.diagnostics?.regime_specification, GENERATION6_REGIME_SPECIFICATION)) {
    reasons.push("regime diagnostic specification mismatch");
  }
  if (!sameJson(protocol?.diagnostics?.recurring_contribution, GENERATION6_RECURRING_SPECIFICATION)) {
    reasons.push("recurring-contribution specification mismatch");
  }
  if (robustness?.status !== "preregistered_before_generation_6_selection_output"
    || robustness?.blocking_for_champion_claim !== true) {
    reasons.push("post-selection robustness is not preregistered and blocking");
  }
  if (!sameJson(robustness?.cost_sensitivity?.cost_levels_bps, GENERATION6_COST_LEVELS_BPS)
    || robustness?.cost_sensitivity?.minimum_spy_edge !== 0) {
    reasons.push("post-selection cost sensitivity mismatch");
  }
  if (!sameJson(robustness?.anchor_sensitivity?.rebalance_anchors, GENERATION6_REBALANCE_ANCHORS)
    || robustness?.anchor_sensitivity?.one_way_cost_bps !== 5
    || robustness?.anchor_sensitivity?.minimum_spy_edge !== 0) {
    reasons.push("post-selection anchor sensitivity mismatch");
  }
  if (robustness?.statistical_validation?.slice !== "validation"
    || robustness?.statistical_validation?.cumulative_effective_trials !== GENERATION6_CUMULATIVE_TRIALS
    || robustness?.statistical_validation?.bootstrap_iterations_per_test !== GENERATION6_BOOTSTRAP_ITERATIONS
    || !sameJson(robustness?.statistical_validation?.block_lengths_sessions, GENERATION6_BLOCK_LENGTHS)
    || !sameJson(robustness?.statistical_validation?.methods, ["circular", "moving"])
    || !sameJson(robustness?.statistical_validation?.frozen_seeds, GENERATION6_BOOTSTRAP_SEEDS)
    || robustness?.statistical_validation?.deflated_sharpe_probability_minimum !== 0.95
    || robustness?.statistical_validation?.cumulative_familywise_p_value_maximum !== 0.05) {
    reasons.push("post-selection statistical specification mismatch");
  }
  if (robustness?.growth_control_joint_statistical_validation?.slice !== "validation"
    || !sameJson(
      robustness?.growth_control_joint_statistical_validation?.specification,
      GENERATION6_GROWTH_STATISTICS_SPECIFICATION,
    )
    || robustness?.growth_control_joint_statistical_validation?.all_six_tests_required !== true
    || robustness?.growth_control_joint_statistical_validation
      ?.cumulative_familywise_p_value_maximum !== 0.05) {
    reasons.push("growth-control joint statistical specification mismatch");
  }
  if (!sameJson(
    robustness?.causal_volatility_matched_spy?.specification,
    GENERATION6_VOLATILITY_MATCH_SPECIFICATION,
  ) || !sameJson(robustness?.causal_volatility_matched_spy?.required_slices, ["development", "validation"])) {
    reasons.push("causal volatility-matched SPY specification mismatch");
  }
  if (!sameJson(robustness?.annual_origin_validation?.horizons_sessions, GENERATION6_ROLLING_HORIZONS)
    || robustness?.annual_origin_validation?.minimum_median_edge !== 0
    || robustness?.annual_origin_validation?.minimum_positive_window_fraction !== 0.60) {
    reasons.push("annual-origin validation specification mismatch");
  }
  if (robustness?.source_reconciliation?.combined_artifact_required !== true
    || robustness?.source_reconciliation?.runner_market_fetch_permitted !== false
    || robustness?.source_reconciliation?.g5_overall_disposition_inherited !== false
    || robustness?.source_reconciliation?.all_20_core_symbols_required !== true
    || !sameJson(robustness?.source_reconciliation?.symbols, GENERATION6_SOURCE_SYMBOLS)
    || !sameJson(robustness?.source_reconciliation?.thresholds, GENERATION6_SOURCE_THRESHOLDS)
    || !sameJson(
      robustness?.source_reconciliation?.simulation_options,
      GENERATION6_SOURCE_SIMULATION_OPTIONS,
    )
    || !sameJson(
      robustness?.source_reconciliation?.candidate_required_symbols,
      GENERATION6_CANDIDATE_REQUIRED_SYMBOLS,
    )) {
    reasons.push("source-reconciliation boundary mismatch");
  }
  const acquisitionDescriptors = [
    [alpacaAcquisitionProtocol, GENERATION6_ALPACA_PANEL_PROTOCOL_PATH,
      "Alpaca acquisition protocol"],
    [alpacaAcquisitionFreeze, GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH,
      "Alpaca acquisition freeze receipt"],
    [alpacaAcquisitionClaim, GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH,
      "Alpaca acquisition run claim"],
    [alpacaAcquisitionResult, GENERATION6_ALPACA_PANEL_RESULT_RECEIPT_PATH,
      "Alpaca acquisition result receipt"],
  ];
  for (const [descriptor, expectedPath, label] of acquisitionDescriptors) {
    if (descriptor?.path !== expectedPath || !isSha256(descriptor?.sha256)) {
      reasons.push(`${label} descriptor mismatch`);
    }
  }
  if (!alpacaPanel || typeof alpacaPanel !== "object"
    || typeof alpacaPanel.path !== "string"
    || !alpacaPanel.path.startsWith("data/private/champion_search/alpaca_adjustment_all_panel_generation6_")
    || !isSha256(alpacaPanel.payload_sha256)
    || alpacaPanel.schema_version !== "finly_generation6_alpaca_adjustment_all_panel.v2"
    || alpacaPanel.role !== "preacquired_authenticated_cross_provider_reconciliation_only"
    || alpacaPanel.adjustment !== "all"
    || !sameJson(alpacaPanel.request, GENERATION6_ALPACA_PANEL_REQUEST)
    || !isSha256(alpacaPanel.series_integrity_sha256)
    || !isSha256(alpacaPanel.strategy_intersection_normalized_panel_sha256)
    || !Number.isSafeInteger(alpacaPanel.strategy_intersection_observations)
    || alpacaPanel.strategy_intersection_observations < 1_250
    || typeof alpacaPanel.strategy_intersection_start_date !== "string"
    || alpacaPanel.strategy_intersection_end_date !== "2026-08-27") {
    reasons.push("preacquired Alpaca v2 panel descriptor mismatch");
  }
  const preacquired = robustness?.source_reconciliation?.preacquired_alpaca_panel;
  if (!alpacaPanel || !sameJson(preacquired, {
    schema_version: alpacaPanel.schema_version,
    payload_sha256: alpacaPanel.payload_sha256,
    series_integrity_sha256: alpacaPanel.series_integrity_sha256,
    strategy_intersection_normalized_panel_sha256:
      alpacaPanel.strategy_intersection_normalized_panel_sha256,
    strategy_intersection_start_date: alpacaPanel.strategy_intersection_start_date,
    strategy_intersection_end_date: alpacaPanel.strategy_intersection_end_date,
    strategy_intersection_observations: alpacaPanel.strategy_intersection_observations,
    full_history_certified: false,
    permitted_role: "RECENT_CROSS_PROVIDER_RECONCILIATION_ONLY",
  })) {
    reasons.push("preacquired Alpaca source boundary mismatch");
  }
  if (protocol?.trial_accounting?.prior_cumulative_effective_trials !== EXPECTED_PRIOR_TRIALS) reasons.push("prior effective-trial count mismatch");
  if (protocol?.trial_accounting?.cumulative_effective_trials !== EXPECTED_LAST_TRIAL) reasons.push("cumulative effective-trial count mismatch");
  if (trialLedger?.append_only_through !== EXPECTED_LAST_TRIAL) reasons.push("trial ledger append boundary mismatch");
  if (!ledgerBlock || ledgerBlock.count !== GENERATION6_ALL_IDS.length || !orderedEqual(ledgerBlock.ids, GENERATION6_ALL_IDS)) {
    reasons.push("trial ledger Generation 6 block mismatch");
  }
  if ((trialLedger?.blocks ?? []).reduce((sum, block) => sum + Number(block.count ?? 0), 0) !== EXPECTED_LAST_TRIAL) {
    reasons.push("trial ledger block counts do not sum to the cumulative trial count");
  }
  const priorLedgerDescriptor = protocol?.frozen_inputs?.generation_5_trial_ledger;
  if (!priorLedgerDescriptor?.sha256) reasons.push("protocol omits the frozen Generation 5 trial-ledger hash");
  if (trialLedger?.prior_ledger_sha256 !== priorLedgerDescriptor?.sha256) reasons.push("trial ledger prior hash mismatch");
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function standaloneRows(rows) {
  return rebaseRowsForStandalonePeriod(rows, {
    cashSymbol: GENERATION6_BASE_OPTIONS.cashSymbol,
    oneWayCostBps: GENERATION6_BASE_OPTIONS.oneWayCostBps,
  });
}

export function buildGeneration6SliceMetrics(simulations, slices = GENERATION6_SLICES) {
  invariant(Array.isArray(simulations) && simulations.length > 0, "simulations are required");
  return Object.freeze(Object.fromEntries(Object.entries(slices).map(([sliceId, slice]) => [
    sliceId,
    Object.freeze(Object.fromEntries(simulations.map((simulation) => {
      const selected = rowsWithin(simulation.rows, slice.start, slice.end);
      invariant(selected.length >= 2, `${simulation.id} has too few rows in ${sliceId}`);
      return [simulation.id, calculatePortfolioMetrics(standaloneRows(selected))];
    }))),
  ])));
}

export function buildAnnualizedLogGrowthComparisons(
  metrics,
  candidateIds = GENERATION6_CANDIDATE_IDS,
  comparatorIds = ["spy_buy_hold", ...GENERATION6_GROWTH_CONTROL_IDS],
) {
  const slices = ["development", "validation"];
  return Object.freeze(Object.fromEntries(slices.map((sliceId) => {
    invariant(metrics?.[sliceId], `metrics omit ${sliceId}`);
    return [sliceId, Object.freeze(Object.fromEntries(candidateIds.map((candidateId) => [
      candidateId,
      Object.freeze(Object.fromEntries(comparatorIds.map((comparatorId) => [
        comparatorId,
        annualizedLogGrowthEdge(metrics[sliceId][candidateId], metrics[sliceId][comparatorId]),
      ]))),
    ])))];
  })));
}

function expectedShortfallMagnitude(value) {
  invariant(finite(value), "expected shortfall must be finite");
  return Math.max(0, -value);
}

function esGate(candidate, benchmark, maximumRatio) {
  const candidateMagnitude = expectedShortfallMagnitude(candidate.daily_expected_shortfall_p05);
  const benchmarkMagnitude = expectedShortfallMagnitude(benchmark.daily_expected_shortfall_p05);
  return Object.freeze({
    candidate_magnitude: round(candidateMagnitude),
    benchmark_magnitude: round(benchmarkMagnitude),
    magnitude_ratio: round(benchmarkMagnitude > 0 ? candidateMagnitude / benchmarkMagnitude : null),
    passes: benchmarkMagnitude > 0 ? candidateMagnitude <= benchmarkMagnitude * maximumRatio : candidateMagnitude === 0,
  });
}

export function generation6RecentVeto(candidateId, metrics, thresholds = GENERATION6_SELECTION_THRESHOLDS) {
  const candidate = metrics?.recent_veto_only?.[candidateId];
  const spy = metrics?.recent_veto_only?.spy_buy_hold;
  const bil = metrics?.recent_veto_only?.bil_cash;
  invariant(candidate && spy && bil, `recent-veto metrics are incomplete for ${candidateId}`);
  const reasons = [];
  if (candidate.maximum_drawdown < thresholds.recent_absolute_maximum_drawdown_floor) {
    reasons.push("recent maximum drawdown breached the absolute floor");
  }
  if (candidate.total_return < bil.total_return) reasons.push("recent total return trailed BIL");
  if (candidate.maximum_drawdown < spy.maximum_drawdown - thresholds.maximum_drawdown_disadvantage) {
    reasons.push("recent maximum drawdown was over five percentage points worse than SPY");
  }
  return Object.freeze({
    hard_safety_veto: reasons.length > 0,
    reasons: Object.freeze(reasons),
    metrics: candidate,
  });
}

export function buildGeneration6Assessments(
  metrics,
  candidateIds = GENERATION6_CANDIDATE_IDS,
  thresholds = GENERATION6_SELECTION_THRESHOLDS,
) {
  const edges = buildAnnualizedLogGrowthComparisons(metrics, candidateIds);
  return Object.freeze(Object.fromEntries(candidateIds.map((id) => {
    const development = metrics.development[id];
    const validation = metrics.validation[id];
    const developmentSpy = metrics.development.spy_buy_hold;
    const validationSpy = metrics.validation.spy_buy_hold;
    invariant(development && validation && developmentSpy && validationSpy, `assessment metrics are incomplete for ${id}`);
    const recentVeto = generation6RecentVeto(id, metrics, thresholds);
    const developmentEs = esGate(development, developmentSpy, thresholds.maximum_expected_shortfall_magnitude_ratio);
    const validationEs = esGate(validation, validationSpy, thresholds.maximum_expected_shortfall_magnitude_ratio);
    const economicGates = Object.freeze({
      development_spy_log_growth_edge_strictly_above_50bp:
        edges.development[id].spy_buy_hold > thresholds.minimum_spy_annualized_log_growth_edge,
      validation_spy_log_growth_edge_strictly_above_50bp:
        edges.validation[id].spy_buy_hold > thresholds.minimum_spy_annualized_log_growth_edge,
      development_cash_excess_sharpe_not_below_spy:
        finite(development.cash_excess_sharpe) && finite(developmentSpy.cash_excess_sharpe)
        && development.cash_excess_sharpe - developmentSpy.cash_excess_sharpe
          >= thresholds.minimum_cash_excess_sharpe_difference,
      validation_cash_excess_sharpe_not_below_spy:
        finite(validation.cash_excess_sharpe) && finite(validationSpy.cash_excess_sharpe)
        && validation.cash_excess_sharpe - validationSpy.cash_excess_sharpe
          >= thresholds.minimum_cash_excess_sharpe_difference,
      development_drawdown_not_over_5pp_worse_than_spy:
        development.maximum_drawdown >= developmentSpy.maximum_drawdown - thresholds.maximum_drawdown_disadvantage,
      validation_drawdown_not_over_5pp_worse_than_spy:
        validation.maximum_drawdown >= validationSpy.maximum_drawdown - thresholds.maximum_drawdown_disadvantage,
      development_expected_shortfall_magnitude_not_over_10pct_worse_than_spy: developmentEs.passes,
      validation_expected_shortfall_magnitude_not_over_10pct_worse_than_spy: validationEs.passes,
      development_annualized_turnover_not_over_four:
        development.annualized_turnover_notional <= thresholds.maximum_annualized_turnover_notional,
      validation_annualized_turnover_not_over_four:
        validation.annualized_turnover_notional <= thresholds.maximum_annualized_turnover_notional,
      recent_hard_safety_veto_passes: recentVeto.hard_safety_veto === false,
    });
    const growthControlGates = Object.freeze(Object.fromEntries(GENERATION6_GROWTH_CONTROL_IDS.flatMap((comparatorId) => [
      [`development_edge_over_${comparatorId}_strictly_positive`, edges.development[id][comparatorId] > 0],
      [`validation_edge_over_${comparatorId}_strictly_positive`, edges.validation[id][comparatorId] > 0],
    ])));
    const spyScoredEdges = [
      edges.development[id].spy_buy_hold,
      edges.validation[id].spy_buy_hold,
    ];
    const growthControlScoredEdges = GENERATION6_GROWTH_CONTROL_IDS.flatMap((comparatorId) => [
      edges.development[id][comparatorId],
      edges.validation[id][comparatorId],
    ]);
    const minimumSharpeDifference = Math.min(
      development.cash_excess_sharpe - developmentSpy.cash_excess_sharpe,
      validation.cash_excess_sharpe - validationSpy.cash_excess_sharpe,
    );
    return [id, Object.freeze({
      id,
      annualized_log_growth_edges: Object.freeze({
        development: edges.development[id],
        validation: edges.validation[id],
      }),
      frozen_spy_minimum_edge_score: round(Math.min(...spyScoredEdges)),
      frozen_growth_control_minimum_edge_score: round(Math.min(...growthControlScoredEdges)),
      minimum_cash_excess_sharpe_difference: round(minimumSharpeDifference),
      validation_maximum_drawdown: validation.maximum_drawdown,
      validation_annualized_turnover_notional: validation.annualized_turnover_notional,
      expected_shortfall: Object.freeze({ development: developmentEs, validation: validationEs }),
      economic_gates: economicGates,
      growth_control_gates: growthControlGates,
      eligible_for_spy_post_selection_robustness: Object.values(economicGates).every(Boolean),
      eligible_for_growth_challenge_post_selection_robustness:
        Object.values(economicGates).every(Boolean) && Object.values(growthControlGates).every(Boolean),
      recent_veto: recentVeto,
    })];
  })));
}

export function selectGeneration6Candidate(assessments) {
  invariant(assessments && typeof assessments === "object", "assessments are required");
  const tieBreak = (left, right) => (
    right.minimum_cash_excess_sharpe_difference - left.minimum_cash_excess_sharpe_difference
    || Math.abs(left.validation_maximum_drawdown) - Math.abs(right.validation_maximum_drawdown)
    || left.validation_annualized_turnover_notional - right.validation_annualized_turnover_notional
    || left.id.localeCompare(right.id)
  );
  const spyRanked = Object.values(assessments).sort((left, right) => (
    right.frozen_spy_minimum_edge_score - left.frozen_spy_minimum_edge_score
    || tieBreak(left, right)
  ));
  const growthRanked = Object.values(assessments).sort((left, right) => (
    right.frozen_growth_control_minimum_edge_score - left.frozen_growth_control_minimum_edge_score
    || right.minimum_cash_excess_sharpe_difference - left.minimum_cash_excess_sharpe_difference
    || Math.abs(left.validation_maximum_drawdown) - Math.abs(right.validation_maximum_drawdown)
    || left.validation_annualized_turnover_notional - right.validation_annualized_turnover_notional
    || left.id.localeCompare(right.id)
  ));
  const tieBreaks = Object.freeze([
    "larger minimum development/validation cash-excess Sharpe difference versus SPY",
    "shallower validation maximum drawdown",
    "lower validation annualized turnover",
    "alphabetical candidate identifier",
  ]);
  const primarySpyTrack = Object.freeze({
    objective: "Among candidates that pass every frozen SPY economic and safety gate, maximize the smaller development/validation annualized log-growth edge versus SPY.",
    ranked_candidate_ids: Object.freeze(spyRanked.map((item) => item.id)),
    selected_id_before_post_selection_robustness:
      spyRanked.find((item) => item.eligible_for_spy_post_selection_robustness)?.id ?? null,
    tie_breaks: tieBreaks,
  });
  const growthControlChallengeTrack = Object.freeze({
    objective: "Separately challenge QQQ and two static growth controls without making their higher-risk exposures a prerequisite for the primary SPY-improvement track.",
    ranked_candidate_ids: Object.freeze(growthRanked.map((item) => item.id)),
    selected_id_before_post_selection_robustness:
      growthRanked.find((item) => item.eligible_for_growth_challenge_post_selection_robustness)?.id ?? null,
    tie_breaks: tieBreaks,
  });
  return Object.freeze({
    primary_spy_track: primarySpyTrack,
    growth_control_challenge_track: growthControlChallengeTrack,
    objective: primarySpyTrack.objective,
    ranked_candidate_ids: primarySpyTrack.ranked_candidate_ids,
    selected_id_before_post_selection_robustness: primarySpyTrack.selected_id_before_post_selection_robustness,
    tie_breaks: tieBreaks,
    recent_data_use: "Recent data can veto but never rank, rescue, or break a tie.",
  });
}

function rollingBoundaryState(rows) {
  invariant(Array.isArray(rows) && rows.length > 0, "rolling boundary rows are required");
  const baseReturns = [];
  const entryReturns = [];
  const terminalCosts = [];
  for (const row of rows) {
    const symbols = Object.keys(row.weights ?? {});
    invariant(symbols.includes(GENERATION6_BASE_OPTIONS.cashSymbol), "rolling row omits BIL weights");
    invariant(row.asset_returns && symbols.every((symbol) => finite(row.asset_returns[symbol])), "rolling row omits asset returns");
    const inheritedTerminalCost = Number(row.terminal_liquidation_cost ?? 0);
    const baseTransactionCost = round(row.transaction_cost - inheritedTerminalCost);
    const baseReturn = round(row.gross_return - baseTransactionCost - row.financing_spread_cost);
    const entryNotional = symbols.reduce((sum, symbol) => sum + Math.abs(
      (row.weights[symbol] ?? 0) - (symbol === GENERATION6_BASE_OPTIONS.cashSymbol ? 1 : 0)
    ), 0);
    const entryReturn = round(row.gross_return
      - entryNotional * GENERATION6_BASE_OPTIONS.oneWayCostBps / 10_000
      - row.financing_spread_cost);
    const grossMultiplier = 1 + row.gross_return;
    invariant(grossMultiplier > 0, "rolling row gross return is invalid");
    const terminalNotional = symbols.filter((symbol) => symbol !== GENERATION6_BASE_OPTIONS.cashSymbol)
      .reduce((sum, symbol) => sum + Math.abs(
        (row.weights[symbol] ?? 0) * (1 + row.asset_returns[symbol]) / grossMultiplier
      ), 0);
    const terminalCost = terminalNotional * GENERATION6_BASE_OPTIONS.oneWayCostBps / 10_000;
    invariant(1 + baseReturn > 0 && 1 + entryReturn > 0 && 1 + baseReturn - terminalCost > 0,
      "rolling standalone return is invalid");
    baseReturns.push(baseReturn);
    entryReturns.push(entryReturn);
    terminalCosts.push(terminalCost);
  }
  return Object.freeze({
    rows,
    baseReturns: Object.freeze(baseReturns),
    entryReturns: Object.freeze(entryReturns),
    terminalCosts: Object.freeze(terminalCosts),
  });
}

function rollingStandaloneReturn(state, start, sessions) {
  const end = start + sessions - 1;
  invariant(start >= 0 && end < state.rows.length, "rolling window is out of range");
  let wealth = 1;
  for (let index = start; index <= end; index += 1) {
    let netReturn = index === start ? state.entryReturns[index] : state.baseReturns[index];
    if (index === end) netReturn = round(netReturn - state.terminalCosts[index]);
    wealth *= 1 + netReturn;
  }
  return wealth - 1;
}

export function rollingStandaloneWindowReturns(rows, sessions) {
  invariant(Number.isSafeInteger(sessions) && sessions > 0, "rolling sessions are invalid");
  if (!Array.isArray(rows) || sessions > rows.length) return Object.freeze([]);
  const state = rollingBoundaryState(rows);
  return Object.freeze(Array.from(
    { length: rows.length - sessions + 1 },
    (_, start) => rollingStandaloneReturn(state, start, sessions),
  ));
}

export function rollingSessionComparison(
  candidateRows,
  benchmarkRows,
  horizons = GENERATION6_ROLLING_HORIZONS,
) {
  assertAlignedRows(candidateRows, benchmarkRows);
  const uniqueHorizons = [...new Set(horizons)];
  invariant(uniqueHorizons.every((value) => Number.isSafeInteger(value) && value > 0), "rolling horizons are invalid");
  const candidateState = rollingBoundaryState(candidateRows);
  const benchmarkState = rollingBoundaryState(benchmarkRows);
  return Object.freeze({
    construction: "Every overlapping window is independently rebased from BIL, charges a fresh 5 bp entry per absolute traded notional, removes any inherited full-sample terminal liquidation, and charges its own terminal liquidation.",
    inference_boundary: "Overlapping windows are autocorrelated descriptive evidence, not independent trials or p-values.",
    by_sessions: Object.freeze(Object.fromEntries(uniqueHorizons.map((sessions) => {
      if (sessions > candidateRows.length) {
        return [String(sessions), Object.freeze({ sessions, windows: 0, candidate_minus_benchmark: null })];
      }
      const differences = Array.from(
        { length: candidateRows.length - sessions + 1 },
        (_, start) => rollingStandaloneReturn(candidateState, start, sessions)
          - rollingStandaloneReturn(benchmarkState, start, sessions),
      );
      return [String(sessions), Object.freeze({
        sessions,
        windows: differences.length,
        first_window_start: candidateRows[0].execution_return_date,
        first_window_end: candidateRows[sessions - 1].execution_return_date,
        last_window_start: candidateRows[candidateRows.length - sessions].execution_return_date,
        last_window_end: candidateRows.at(-1).execution_return_date,
        candidate_minus_benchmark: describe(differences),
      })];
    }))),
  });
}

function summarizeRegimeRows(rows) {
  if (rows.length === 0) {
    return Object.freeze({
      observations: 0,
      candidate_total_return: null,
      spy_total_return: null,
      candidate_annualized_log_growth: null,
      spy_annualized_log_growth: null,
      candidate_minus_spy_annualized_log_growth: null,
      candidate_daily_win_fraction: null,
    });
  }
  const candidateReturn = compound(rows.map((item) => item.candidate_return));
  const spyReturn = compound(rows.map((item) => item.spy_return));
  const candidateGrowth = Math.log1p(candidateReturn) * 252 / rows.length;
  const spyGrowth = Math.log1p(spyReturn) * 252 / rows.length;
  return Object.freeze({
    observations: rows.length,
    candidate_total_return: round(candidateReturn),
    spy_total_return: round(spyReturn),
    candidate_annualized_log_growth: round(candidateGrowth),
    spy_annualized_log_growth: round(spyGrowth),
    candidate_minus_spy_annualized_log_growth: round(candidateGrowth - spyGrowth),
    candidate_daily_win_fraction: round(rows.filter((item) => item.candidate_return > item.spy_return).length / rows.length),
  });
}

export function causalFourRegimeEvidence(
  candidateRows,
  spyRows,
  specification = GENERATION6_REGIME_SPECIFICATION,
) {
  assertAlignedRows(candidateRows, spyRows);
  const trendLookback = specification.trendLookbackSessions;
  const volatilityLookback = specification.volatilityLookbackSessions;
  const volatilityThreshold = specification.highVolatilityAnnualizedThreshold;
  invariant(Number.isSafeInteger(trendLookback) && trendLookback > 1, "trend lookback is invalid");
  invariant(Number.isSafeInteger(volatilityLookback) && volatilityLookback > 1 && volatilityLookback <= trendLookback, "volatility lookback is invalid");
  invariant(finite(volatilityThreshold) && volatilityThreshold > 0, "volatility threshold is invalid");
  const buckets = {
    up_low_vol: [],
    up_high_vol: [],
    down_low_vol: [],
    down_high_vol: [],
  };
  for (let index = trendLookback; index < candidateRows.length; index += 1) {
    const history = spyRows.slice(index - trendLookback, index);
    const spyTrend = compound(history.map((row) => row.asset_returns.SPY));
    const bilTrend = compound(history.map((row) => row.asset_returns.BIL));
    const trailingVolatility = sampleStandardDeviation(
      history.slice(-volatilityLookback).map((row) => row.asset_returns.SPY),
    ) * Math.sqrt(252);
    invariant([spyTrend, bilTrend, trailingVolatility].every(finite), "regime inputs are invalid");
    const direction = spyTrend > bilTrend ? "up" : "down";
    const volatility = trailingVolatility > volatilityThreshold ? "high_vol" : "low_vol";
    buckets[`${direction}_${volatility}`].push(Object.freeze({
      date: candidateRows[index].execution_return_date,
      candidate_return: candidateRows[index].net_return,
      spy_return: spyRows[index].net_return,
    }));
  }
  return Object.freeze({
    classification: `Before each scored return, compare compounded SPY and BIL returns over the prior ${trendLookback} sessions and annualize SPY volatility over the prior ${volatilityLookback}; volatility strictly above ${(100 * volatilityThreshold).toFixed(0)}% is high.`,
    causality: "The current scored return is excluded from both regime signals. Regimes are descriptive and were specified after history was seen.",
    unclassified_warmup_observations: Math.min(trendLookback, candidateRows.length),
    regimes: Object.freeze(Object.fromEntries(Object.entries(buckets).map(([id, rows]) => [id, summarizeRegimeRows(rows)]))),
  });
}

export function concentrationStatistics(rows, { cashSymbol = "BIL" } = {}) {
  invariant(Array.isArray(rows) && rows.length > 0, "concentration rows are required");
  const symbols = Object.keys(rows[0].weights ?? {});
  invariant(symbols.includes(cashSymbol), "concentration rows omit the cash symbol");
  const riskySymbols = symbols.filter((symbol) => symbol !== cashSymbol);
  const riskyGross = [];
  const maximumPosition = [];
  const hhi = [];
  const effectivePositions = [];
  for (const row of rows) {
    const weights = riskySymbols.map((symbol) => Math.abs(Number(row.weights?.[symbol] ?? 0)));
    invariant(weights.every(finite), "concentration weights are invalid");
    const gross = weights.reduce((sum, value) => sum + value, 0);
    const rowHhi = gross > 0 ? weights.reduce((sum, value) => sum + (value / gross) ** 2, 0) : 0;
    riskyGross.push(gross);
    maximumPosition.push(Math.max(0, ...weights));
    hhi.push(rowHhi);
    effectivePositions.push(rowHhi > 0 ? 1 / rowHhi : 0);
  }
  const averageWeights = Object.fromEntries(symbols.map((symbol) => [
    symbol,
    round(mean(rows.map((row) => Number(row.weights?.[symbol] ?? 0)))),
  ]));
  return Object.freeze({
    observations: rows.length,
    time_weighted_average_weights: Object.freeze(averageWeights),
    average_risky_gross: round(mean(riskyGross)),
    maximum_risky_gross: round(Math.max(...riskyGross)),
    maximum_single_risky_position: Object.freeze({
      average: round(mean(maximumPosition)),
      p95: round(quantile(maximumPosition, 0.95)),
      maximum: round(Math.max(...maximumPosition)),
    }),
    conditional_risky_weight_hhi: Object.freeze({
      average: round(mean(hhi)),
      p95: round(quantile(hhi, 0.95)),
      maximum: round(Math.max(...hhi)),
    }),
    conditional_effective_risky_positions: Object.freeze({
      average: round(mean(effectivePositions)),
      p05: round(quantile(effectivePositions, 0.05)),
      minimum: round(Math.min(...effectivePositions)),
    }),
    direct_qqq_plus_xlk_average_weight: round((averageWeights.QQQ ?? 0) + (averageWeights.XLK ?? 0)),
    boundary: "HHI and effective-position counts condition on non-cash gross and do not look through ETF holdings; direct QQQ plus XLK is not a technology look-through exposure.",
  });
}

function compactContributionComparison(value) {
  return Object.freeze({
    schema_version: value.schema_version,
    contribution_timing: value.contribution_timing,
    cost_model: value.cost_model,
    implementation_boundary: value.implementation_boundary,
    monthly_contribution: value.monthly_contribution,
    one_way_cost_bps: value.one_way_cost_bps,
    minimum_start_date: value.minimum_start_date,
    horizons: Object.freeze(Object.fromEntries(Object.entries(value.horizons).map(([id, horizon]) => [id, Object.freeze({
      horizon_months: horizon.horizon_months,
      summary: horizon.summary,
      latest_window: horizon.latest_window ? Object.freeze({
        start_month: horizon.latest_window.start_month,
        end_month: horizon.latest_window.end_month,
        start_date: horizon.latest_window.start_date,
        end_date: horizon.latest_window.end_date,
        total_contributions: horizon.latest_window.total_contributions,
        candidate_ending_value: horizon.latest_window.candidate.ending_value,
        benchmark_ending_value: horizon.latest_window.benchmark.ending_value,
        ending_value_advantage: horizon.latest_window.ending_value_advantage,
        candidate_beat_benchmark: horizon.latest_window.candidate_beat_benchmark,
      }) : null,
    })]))),
  });
}

export function buildRecurringContributionEvidence(
  rowsById,
  candidateId,
  benchmarkIds = ["spy_buy_hold", ...GENERATION6_GROWTH_CONTROL_IDS],
  {
    horizonsMonths = [1, 3, 6, 12],
    monthlyContribution = 300,
    oneWayCostBps = 5,
    minimumStartDate = "2013-01-01",
  } = {},
) {
  invariant(Array.isArray(rowsById?.[candidateId]), `recurring-contribution rows omit ${candidateId}`);
  return Object.freeze({
    candidate_id: candidateId,
    purpose: "Small-account fractional-ETF evidence only; this is not an options-P&L simulation.",
    comparisons: Object.freeze(Object.fromEntries(benchmarkIds.map((benchmarkId) => {
      invariant(Array.isArray(rowsById?.[benchmarkId]), `recurring-contribution rows omit ${benchmarkId}`);
      return [benchmarkId, compactContributionComparison(compareRollingMonthlyContributions(
        rowsById[candidateId],
        rowsById[benchmarkId],
        { horizonsMonths, monthlyContribution, oneWayCostBps, minimumStartDate },
      ))];
    }))),
  });
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readAndVerify(path, expectedHash, label) {
  invariant(typeof expectedHash === "string" && /^[0-9a-f]{64}$/.test(expectedHash), `${label} expected hash is invalid`);
  const payload = await readFile(path);
  invariant(sha256Bytes(payload) === expectedHash, `${label} hash mismatch`);
  return payload;
}

function safeProjectPath(relativePath, label) {
  invariant(typeof relativePath === "string" && relativePath.length > 0,
    `${label} path is invalid`);
  const absolute = resolve(projectRoot, relativePath);
  invariant(absolute.startsWith(`${projectRoot}${sep}`), `${label} path escapes the project root`);
  return absolute;
}

async function loadFrozenInputs() {
  const [protocolRaw, trialLedgerRaw, freezeReceiptRaw] = await Promise.all([
    readFile(protocolPath),
    readFile(trialLedgerPath),
    readFile(freezeReceiptPath),
  ]);
  const protocol = JSON.parse(protocolRaw.toString("utf8"));
  const trialLedger = JSON.parse(trialLedgerRaw.toString("utf8"));
  const freezeReceipt = JSON.parse(freezeReceiptRaw.toString("utf8"));
  const validation = validateGeneration6Protocol(protocol, trialLedger);
  invariant(validation.passes, `Generation 6 protocol validation failed: ${validation.reasons.join("; ")}`);
  invariant(
    freezeReceipt.schema_version === "finly_champion_search_generation6_freeze_receipt.v1",
    "Generation 6 freeze-receipt schema mismatch",
  );
  invariant(freezeReceipt.generation_6_results_seen_at_freeze === false, "freeze receipt says Generation 6 results were seen");
  invariant(freezeReceipt.generation_6_output_absent_at_freeze === true, "freeze receipt does not attest output absence");
  invariant(freezeReceipt.market_fetch_permitted === false, "freeze receipt permits a market fetch");

  const requiredFreezeFiles = [
    "research/champion_search_generation6_protocol.json",
    "research/champion_trial_ledger_generation6.json",
    "research/HINDSIGHT_BIAS_LOCK.md",
    "research/HINDSIGHT_BIAS_LOCK_ADDENDUM.md",
    "research/hindsight_bias_lock.json",
    "research/champion_engine.mjs",
    "research/champion_statistics.mjs",
    "research/recurring_contribution.mjs",
    "research/champion_strategies.mjs",
    "research/champion_strategies_generation4.mjs",
    "research/champion_strategies_generation5.mjs",
    "research/champion_strategies_generation6.mjs",
    "research/champion_generation6_robustness.mjs",
    "research/champion_generation6_growth_statistics.mjs",
    "research/run_quant_champion_generation6.mjs",
    "research/run_quant_champion_generation6_robustness.mjs",
    "research/source_overlap_reconciliation_generation6.mjs",
    "research/run_source_overlap_reconciliation_generation6.mjs",
    "research/source_overlap_reconciliation_generation5.mjs",
    GENERATION6_ALPACA_PANEL_PROTOCOL_PATH,
    GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH,
    GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH,
    GENERATION6_ALPACA_PANEL_RESULT_RECEIPT_PATH,
    "research/persist_alpaca_adjustment_all_panel_generation6.mjs",
    "research/competitor_strategy_registry_generation6.json",
    "tests/champion_generation6.test.mjs",
    "tests/champion_generation6_formula_audit.test.mjs",
    "tests/champion_generation6_runner.test.mjs",
    "tests/champion_generation6_robustness.test.mjs",
    "tests/champion_generation6_growth_statistics.test.mjs",
    "tests/champion_generation6_robustness_runner.test.mjs",
    "tests/source_overlap_reconciliation_generation6.test.mjs",
    "tests/source_overlap_reconciliation_generation5.test.mjs",
    "tests/alpaca_adjustment_all_panel_generation6.test.mjs",
  ];
  for (const relativePath of requiredFreezeFiles) {
    invariant(freezeReceipt.files?.[relativePath], `freeze receipt omits ${relativePath}`);
  }
  for (const [relativePath, expectedHash] of Object.entries(freezeReceipt.files ?? {})) {
    await readAndVerify(
      safeProjectPath(relativePath, `freeze file ${relativePath}`),
      expectedHash,
      `freeze file ${relativePath}`,
    );
  }

  const frozenPayloads = {};
  for (const [id, item] of Object.entries(protocol.frozen_inputs ?? {})) {
    if (!item?.path) continue;
    const expectedHash = item.sha256 ?? item.payload_sha256;
    frozenPayloads[id] = await readAndVerify(
      safeProjectPath(item.path, `frozen input ${id}`),
      expectedHash,
      `frozen input ${id}`,
    );
  }
  const alpacaPanelPayload = frozenPayloads.generation_6_alpaca_all_panel;
  const alpacaResultPayload = frozenPayloads.generation_6_alpaca_acquisition_result_receipt;
  const alpacaProtocolPayload = frozenPayloads.generation_6_alpaca_acquisition_protocol;
  const alpacaFreezePayload = frozenPayloads.generation_6_alpaca_acquisition_freeze_receipt;
  const alpacaClaimPayload = frozenPayloads.generation_6_alpaca_acquisition_run_claim;
  invariant(alpacaPanelPayload && alpacaResultPayload && alpacaProtocolPayload
    && alpacaFreezePayload && alpacaClaimPayload,
  "frozen inputs omit the authenticated Alpaca v2 acquisition chain");
  const storedAlpacaPanel = JSON.parse(alpacaPanelPayload.toString("utf8"));
  validateStoredGeneration6AlpacaPanel(storedAlpacaPanel);
  const alpacaResult = JSON.parse(alpacaResultPayload.toString("utf8"));
  const alpacaProtocol = JSON.parse(alpacaProtocolPayload.toString("utf8"));
  const alpacaDescriptor = protocol.frozen_inputs.generation_6_alpaca_all_panel;
  invariant(sameJson(alpacaProtocol.request, GENERATION6_ALPACA_PANEL_REQUEST),
    "frozen Alpaca acquisition request differs");
  invariant(alpacaResult.protocol_sha256 === sha256Bytes(alpacaProtocolPayload),
    "Alpaca result does not bind its acquisition protocol");
  invariant(alpacaResult.freeze_receipt_sha256 === sha256Bytes(alpacaFreezePayload),
    "Alpaca result does not bind its acquisition freeze receipt");
  invariant(alpacaResult.run_claim_sha256 === sha256Bytes(alpacaClaimPayload),
    "Alpaca result does not bind its pre-read run claim");
  invariant(alpacaResult.panel.path === alpacaDescriptor.path
    && alpacaResult.panel.payload_sha256 === alpacaDescriptor.payload_sha256
    && alpacaResult.panel.series_integrity_sha256 === alpacaDescriptor.series_integrity_sha256
    && alpacaResult.panel.strategy_intersection_normalized_panel_sha256
      === alpacaDescriptor.strategy_intersection_normalized_panel_sha256
    && alpacaResult.panel.strategy_intersection_observations
      === alpacaDescriptor.strategy_intersection_observations
    && alpacaResult.panel.strategy_intersection_start_date
      === alpacaDescriptor.strategy_intersection_start_date
    && alpacaResult.panel.strategy_intersection_end_date
      === alpacaDescriptor.strategy_intersection_end_date,
  "Alpaca result and frozen panel descriptor differ");
  const panelKey = Object.keys(frozenPayloads).find((id) => (
    id.includes("private_panel") || protocol.frozen_inputs[id]?.schema_version?.includes("private_panel")
  ));
  invariant(panelKey, "protocol frozen inputs omit the immutable private panel");
  const panelDescriptor = protocol.frozen_inputs[panelKey];
  const panel = JSON.parse(frozenPayloads[panelKey].toString("utf8"));
  invariant(Array.isArray(panel.points) && panel.points.length >= 756, "private panel has insufficient rows");
  invariant(panel.schema_version === panelDescriptor.schema_version, "private panel schema mismatch");
  invariant(panel.normalized_panel_sha256 === panelDescriptor.normalized_panel_sha256, "private panel normalized hash declaration mismatch");
  invariant(panel.points[0]?.date === panelDescriptor.common_start,
    "private panel common-start declaration mismatch");
  invariant(panel.points.at(-1)?.date === panelDescriptor.common_end,
    "private panel common-end declaration mismatch");
  invariant(panel.points.length === panelDescriptor.common_sessions,
    "private panel common-session declaration mismatch");
  const normalizedPanelHash = sha256(panel.points.map((point) => [
    point.date,
    ...GENERATION6_REQUIRED_SYMBOLS.map((symbol) => round(point[symbol], 10)),
  ]));
  invariant(normalizedPanelHash === panel.normalized_panel_sha256, "private panel normalized hash cannot be reproduced");
  let priorDate = "";
  for (const point of panel.points) {
    invariant(typeof point.date === "string" && point.date > priorDate, "private panel dates are not strictly increasing");
    priorDate = point.date;
    for (const symbol of GENERATION6_REQUIRED_SYMBOLS) {
      invariant(finite(point[symbol]) && point[symbol] > 0, `private panel has invalid ${symbol} at ${point.date}`);
    }
  }
  return Object.freeze({
    protocol,
    trialLedger,
    freezeReceipt,
    panel,
    panelDescriptor,
    hashes: Object.freeze({
      protocol_sha256: sha256Bytes(protocolRaw),
      trial_ledger_sha256: sha256Bytes(trialLedgerRaw),
      freeze_receipt_sha256: sha256Bytes(freezeReceiptRaw),
      private_panel_payload_sha256: sha256Bytes(frozenPayloads[panelKey]),
      normalized_panel_sha256: normalizedPanelHash,
      alpaca_panel_payload_sha256: sha256Bytes(alpacaPanelPayload),
      alpaca_series_integrity_sha256: alpacaDescriptor.series_integrity_sha256,
      alpaca_strategy_intersection_normalized_panel_sha256:
        alpacaDescriptor.strategy_intersection_normalized_panel_sha256,
    }),
  });
}

function requiredStrategies() {
  const primary = createPrimaryStrategies().filter((strategy) => REQUIRED_PRIMARY_IDS.includes(strategy.id));
  const generation4 = createGeneration4Strategies().filter((strategy) => REQUIRED_GENERATION4_IDS.includes(strategy.id));
  const generation5 = createGeneration5Strategies().filter((strategy) => REQUIRED_GENERATION5_IDS.includes(strategy.id));
  const strategies = [...primary, ...generation4, ...generation5, ...createGeneration6Strategies()];
  const ids = strategies.map((strategy) => strategy.id);
  invariant(new Set(ids).size === ids.length, "Generation 6 simulation registry contains duplicate ids");
  for (const id of [...GENERATION6_COMPARATOR_IDS, ...GENERATION6_CANDIDATE_IDS]) {
    invariant(ids.includes(id), `Generation 6 simulation registry omits ${id}`);
  }
  return Object.freeze(strategies);
}

function renderMarkdown(report) {
  const rows = report.selection.ranked_candidate_ids.map((id) => {
    const item = report.assessments[id];
    const spyFailures = Object.entries(item.economic_gates)
      .filter(([, passed]) => !passed)
      .map(([gate]) => gate);
    const growthFailures = Object.entries(item.growth_control_gates)
      .filter(([, passed]) => !passed)
      .map(([gate]) => gate);
    return `| ${id} | ${(100 * item.frozen_spy_minimum_edge_score).toFixed(2)}% | ${(100 * item.frozen_growth_control_minimum_edge_score).toFixed(2)}% | ${item.minimum_cash_excess_sharpe_difference.toFixed(3)} | ${(100 * item.validation_maximum_drawdown).toFixed(2)}% | ${item.validation_annualized_turnover_notional.toFixed(2)}x | ${spyFailures.join(", ") || "none"} | ${growthFailures.join(", ") || "none"} |`;
  }).join("\n");
  const selected = report.selection.selected_id_before_post_selection_robustness ?? "none";
  const growthSelected = report.selection.growth_control_challenge_track
    .selected_id_before_post_selection_robustness ?? "none";
  return `# Finly Generation 6 retrospective model comparison\n\nProtocol: \`${report.input_integrity.protocol_sha256}\`  \nImmutable panel: \`${report.dataset.normalized_panel_sha256}\`\n\n## Answer first\n\nPrimary SPY-track selection before separately frozen post-selection robustness: **${selected}**. Separate growth-control challenger: **${growthSelected}**. Disposition: **${report.disposition}**. Recent history was veto-only and did not rank or break ties.\n\n| Candidate | Minimum SPY edge | Minimum growth-control edge | Minimum Sharpe difference | Validation drawdown | Validation turnover | Failed SPY gates | Failed growth gates |\n|---|---:|---:|---:|---:|---:|---|---|\n${rows}\n\n## Diagnostics\n\nThe JSON artifact records 252/504/756-session comparisons, four regimes classified only from prior observations, direct-position concentration, and rolling $300/month fractional-ETF comparisons. Those overlapping-window results are descriptive, not independent probabilities. The primary track asks whether a candidate improves SPY under frozen risk gates; the separate challenge asks whether the same evidence also survives more aggressive growth controls.\n\n## Claim boundary\n\nAll historical intervals and the literature themes used to create Generation 6 were already seen. This is a hash-frozen retrospective comparison, not untouched out-of-sample evidence. It does not establish future profit, exact options P&L, or financial superiority over submissions whose strategies cannot be reproduced under the same data, timing, costs, and capital rules.\n`;
}

function buildResultReceipt(report, jsonPayload, markdownPayload, privateLedgerRelativePath, privateLedgerPayload) {
  return Object.freeze({
    schema_version: "finly_champion_generation6_result_receipt.v1",
    generated_at: report.generated_at,
    execution_mode: "first_hash_frozen_generation_6_run",
    input_integrity: report.input_integrity,
    files: Object.freeze({
      [GENERATION6_RUN_CLAIM_RELATIVE_PATH]: report.input_integrity.run_claim_sha256,
      "research/output/quant_champion_generation6.json": sha256Bytes(jsonPayload),
      "research/output/quant_champion_generation6_report.md": sha256Bytes(markdownPayload),
      [privateLedgerRelativePath]: sha256Bytes(privateLedgerPayload),
    }),
    selected_ids_before_post_selection_robustness: Object.freeze({
      primary_spy: report.selection.primary_spy_track.selected_id_before_post_selection_robustness,
      growth_control_challenge:
        report.selection.growth_control_challenge_track.selected_id_before_post_selection_robustness,
    }),
    track_statuses: report.track_statuses,
    disposition: report.disposition,
    claim_boundary: report.claim_boundary,
  });
}

export async function computeGeneration6Bundle() {
  // The claim is deliberately loaded from its authoritative on-disk path.
  // Callers cannot preview an outcome by supplying an unpersisted buffer.
  const persistedRunClaim = await readRunClaim();
  const { raw: runClaimRaw, claim: runClaim } = persistedRunClaim;
  validateRunClaimShape(runClaim);
  const generatedAt = runClaim.generated_at;
  const frozen = await loadFrozenInputs();
  invariant(runClaim.protocol_sha256 === frozen.hashes.protocol_sha256,
    "Generation 6 run claim does not bind the frozen protocol");
  invariant(runClaim.trial_ledger_sha256 === frozen.hashes.trial_ledger_sha256,
    "Generation 6 run claim does not bind the frozen trial ledger");
  invariant(runClaim.freeze_receipt_sha256 === frozen.hashes.freeze_receipt_sha256,
    "Generation 6 run claim does not bind the frozen freeze receipt");
  const runClaimSha = sha256Bytes(runClaimRaw);
  const strategies = requiredStrategies();
  const simulations = strategies.map((strategy) => simulateStrategy(
    frozen.panel.points,
    GENERATION6_REQUIRED_SYMBOLS,
    strategy,
    GENERATION6_BASE_OPTIONS,
  ));
  const rowsById = Object.freeze(Object.fromEntries(simulations.map((simulation) => [simulation.id, simulation.rows])));
  const metrics = buildGeneration6SliceMetrics(simulations);
  const assessments = buildGeneration6Assessments(metrics);
  const selection = selectGeneration6Candidate(assessments);
  const diagnosticCandidateId = selection.primary_spy_track.selected_id_before_post_selection_robustness
    ?? selection.ranked_candidate_ids[0];
  invariant(diagnosticCandidateId, "Generation 6 has no diagnostic candidate");
  const growthDiagnosticCandidateId = selection.growth_control_challenge_track
    .selected_id_before_post_selection_robustness
    ?? selection.growth_control_challenge_track.ranked_candidate_ids[0];
  invariant(growthDiagnosticCandidateId, "Generation 6 has no growth-control diagnostic candidate");
  const buildDiagnostics = (candidateId, promotionCandidate) => Object.freeze({
    candidate_id: candidateId,
    promotion_candidate: promotionCandidate,
    rolling_session_comparisons: Object.freeze(Object.fromEntries(
      ["spy_buy_hold", ...GENERATION6_GROWTH_CONTROL_IDS].map((comparatorId) => [
        comparatorId,
        rollingSessionComparison(rowsById[candidateId], rowsById[comparatorId]),
      ]),
    )),
    causal_four_regime_evidence: causalFourRegimeEvidence(
      rowsById[candidateId],
      rowsById.spy_buy_hold,
    ),
    concentration: concentrationStatistics(rowsById[candidateId]),
    recurring_300_per_month: buildRecurringContributionEvidence(rowsById, candidateId),
  });
  const privateLedgerPayload = gzipSync(JSON.stringify({
    schema_version: "finly_generation6_private_ledger.v1",
    protocol_sha256: frozen.hashes.protocol_sha256,
    run_claim_sha256: runClaimSha,
    normalized_panel_sha256: frozen.hashes.normalized_panel_sha256,
    simulations: rowsById,
  }), { level: 9 });
  const privateLedgerSha = sha256Bytes(privateLedgerPayload);
  const privateLedgerFilename = `generation6_ledger_${privateLedgerSha}.json.gz`;
  const privateLedgerRelativePath = `data/private/champion_search/${privateLedgerFilename}`;
  const selected = selection.primary_spy_track.selected_id_before_post_selection_robustness;
  const growthSelected = selection.growth_control_challenge_track
    .selected_id_before_post_selection_robustness;
  const trackStatuses = Object.freeze({
    primary_spy: selected ? "SPY_CHALLENGER_ROBUSTNESS_PENDING" : "NO_SPY_CHALLENGER",
    growth_control_challenge: growthSelected
      ? "GROWTH_CONTROL_CHALLENGER_ROBUSTNESS_PENDING"
      : "NO_GROWTH_CONTROL_CHALLENGER",
  });
  const report = Object.freeze({
    schema_version: "finly_quant_champion_generation6.v1",
    generated_at: generatedAt,
    disposition: selected
      ? "GENERATION6_POST_SELECTION_ROBUSTNESS_PENDING"
      : "KEEP_G4_DESCRIPTIVE_BASELINE",
    track_statuses: trackStatuses,
    claim_boundary: frozen.protocol.claim_boundary,
    input_integrity: Object.freeze({
      ...frozen.hashes,
      run_claim_sha256: runClaimSha,
      generation_6_results_seen_at_freeze: frozen.freezeReceipt.generation_6_results_seen_at_freeze,
      generation_6_output_absent_at_freeze: frozen.freezeReceipt.generation_6_output_absent_at_freeze,
      no_market_fetch_performed: true,
    }),
    dataset: Object.freeze({
      symbols: GENERATION6_REQUIRED_SYMBOLS,
      common_start: frozen.panel.points[0].date,
      common_end: frozen.panel.points.at(-1).date,
      common_sessions: frozen.panel.points.length,
      normalized_panel_sha256: frozen.hashes.normalized_panel_sha256,
      reused_private_panel_path: frozen.panelDescriptor.path,
      private_generation_6_ledger_filename: privateLedgerFilename,
      private_generation_6_ledger_gzip_sha256: privateLedgerSha,
    }),
    execution: GENERATION6_BASE_OPTIONS,
    comparators: GENERATION6_COMPARATOR_IDS,
    strategy_metadata: GENERATION6_METADATA,
    selection_thresholds: GENERATION6_SELECTION_THRESHOLDS,
    metrics,
    assessments,
    selection,
    diagnostics: Object.freeze({
      candidate_id: diagnosticCandidateId,
      promotion_candidate: diagnosticCandidateId === selected,
      primary_spy: buildDiagnostics(diagnosticCandidateId, diagnosticCandidateId === selected),
      growth_control_challenge: growthDiagnosticCandidateId === diagnosticCandidateId
        ? Object.freeze({
          shared_with_primary_spy: true,
          ...buildDiagnostics(growthDiagnosticCandidateId, growthDiagnosticCandidateId === growthSelected),
        })
        : Object.freeze({
          shared_with_primary_spy: false,
          ...buildDiagnostics(growthDiagnosticCandidateId, growthDiagnosticCandidateId === growthSelected),
        }),
    }),
  });
  const jsonPayload = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  const markdownPayload = Buffer.from(renderMarkdown(report));
  const receipt = buildResultReceipt(
    report,
    jsonPayload,
    markdownPayload,
    privateLedgerRelativePath,
    privateLedgerPayload,
  );
  const receiptPayload = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze({
    report,
    jsonPayload,
    markdownPayload,
    privateLedgerPayload,
    privateLedgerRelativePath,
    privateLedgerPath: resolve(projectRoot, privateLedgerRelativePath),
    receipt,
    receiptPayload,
  });
}

export async function writeOnceOrVerify(path, payload, label = "artifact") {
  invariant(Buffer.isBuffer(payload), `${label} payload must be a Buffer`);
  await mkdir(dirname(path), { recursive: true });
  const staged = `${path}.${process.pid}.${randomUUID()}.stage`;
  await writeFile(staged, payload, { flag: "wx", mode: 0o600 });
  try {
    try {
      await link(staged, path);
      return "created";
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const actual = await readFile(path);
      invariant(actual.equals(payload), `${label} already exists with different bytes`);
      return "verified_existing";
    }
  } finally {
    // A leaked, uniquely named stage file is harmless and never becomes an
    // authoritative artifact. Do not let cleanup mask publication integrity.
    await unlink(staged).catch(() => {});
  }
}

export async function withExclusiveDirectoryLock(path, callback) {
  invariant(typeof path === "string" && path.length > 0, "exclusive-lock path is required");
  invariant(typeof callback === "function", "exclusive-lock callback is required");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Generation 6 run lock already exists; another run is active or a stale lock needs audit: ${path}`);
    }
    throw error;
  }
  const ownerPath = resolve(path, "owner.json");
  const owner = Object.freeze({
    schema_version: "finly_exclusive_directory_lock_owner.v1",
    pid: process.pid,
    hostname: hostname(),
    token: randomUUID(),
    started_at: new Date().toISOString(),
    recovery_instruction:
      "Do not delete this lock while the recorded process may still be alive. Audit the owner and authoritative artifacts before removing a stale lock.",
  });
  try {
    await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return await callback();
  } finally {
    await unlink(ownerPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await rmdir(path);
  }
}

async function assertKnownOutputsAbsent() {
  const existing = [];
  for (const path of [jsonOutputPath, markdownOutputPath, resultReceiptPath]) {
    if (await pathExists(path)) existing.push(path);
  }
  try {
    const privateNames = await readdir(resolve(projectRoot, "data/private/champion_search"));
    existing.push(...privateNames
      .filter((name) => /^generation6_ledger_[0-9a-f]{64}\.json\.gz$/.test(name))
      .map((name) => resolve(projectRoot, "data/private/champion_search", name)));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  invariant(existing.length === 0, `Generation 6 output already exists; use --verify-existing and do not overwrite: ${existing.join(", ")}`);
}

function validateRunClaimShape(claim) {
  invariant(claim?.schema_version === "finly_champion_generation6_run_claim.v1",
    "Generation 6 run-claim schema mismatch");
  invariant(claim?.status === "claimed_before_first_generation_6_computation",
    "Generation 6 run-claim status mismatch");
  invariant(claim?.generation_6_results_seen_before_claim === false,
    "Generation 6 run claim says results were seen");
  invariant(claim?.generation_6_output_absent_before_claim === true,
    "Generation 6 run claim omits the output-absence attestation");
  invariant(typeof claim?.generated_at === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(claim.generated_at)
    && new Date(claim.generated_at).toISOString() === claim.generated_at,
  "Generation 6 run-claim timestamp is invalid");
  invariant(typeof claim?.process_attestation_boundary === "string"
    && claim.process_attestation_boundary.includes("official Generation 6 runner")
    && claim.process_attestation_boundary.includes("not cryptographic proof"),
  "Generation 6 run-claim process-attestation boundary is missing");
  for (const field of ["protocol_sha256", "trial_ledger_sha256", "freeze_receipt_sha256"]) {
    invariant(typeof claim?.[field] === "string" && /^[0-9a-f]{64}$/.test(claim[field]),
      `Generation 6 run claim has invalid ${field}`);
  }
  return claim;
}

async function readRunClaim() {
  const raw = await readFile(runClaimPath);
  let claim;
  try {
    claim = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error(`Generation 6 run claim is not valid JSON: ${error.message}`);
  }
  validateRunClaimShape(claim);
  return Object.freeze({ raw, claim });
}

async function createRunClaim(validatedFrozenInputs) {
  invariant(validatedFrozenInputs?.hashes, "validated frozen inputs are required before claim creation");
  const claim = Object.freeze({
    schema_version: "finly_champion_generation6_run_claim.v1",
    status: "claimed_before_first_generation_6_computation",
    generated_at: new Date().toISOString(),
    generation_6_results_seen_before_claim: false,
    generation_6_output_absent_before_claim: true,
    protocol_sha256: validatedFrozenInputs.hashes.protocol_sha256,
    trial_ledger_sha256: validatedFrozenInputs.hashes.trial_ledger_sha256,
    freeze_receipt_sha256: validatedFrozenInputs.hashes.freeze_receipt_sha256,
    recovery_boundary: "A repeated invocation may only finish missing files or verify byte-identical files from this same claim. It may never replace a completed or conflicting artifact.",
    process_attestation_boundary: "This claim attests only that the official Generation 6 runner persisted this claim before its own first computation. Because the local panel, engine, and strategies are readable, it is not cryptographic proof that no alternate script previewed the same history.",
  });
  const raw = Buffer.from(`${JSON.stringify(claim, null, 2)}\n`);
  const status = await writeOnceOrVerify(runClaimPath, raw, "Generation 6 run claim");
  invariant(status === "created", "a Generation 6 run claim appeared during exclusive claim creation");
  return Object.freeze({ raw, claim });
}

async function assertNoConflictingPrivateLedgers(expectedPath) {
  const directory = resolve(projectRoot, "data/private/champion_search");
  const expectedName = expectedPath.slice(expectedPath.lastIndexOf("/") + 1);
  const names = await readdir(directory);
  const conflicts = names.filter((name) => (
    /^generation6_ledger_[0-9a-f]{64}\.json\.gz$/.test(name) && name !== expectedName
  ));
  invariant(conflicts.length === 0,
    `conflicting Generation 6 private ledger exists: ${conflicts.join(", ")}`);
}

async function firstRun() {
  return withExclusiveDirectoryLock(runLockPath, async () => {
    const claimExists = await pathExists(runClaimPath);
    if (!claimExists) await assertKnownOutputsAbsent();
    if (!claimExists) {
      // Validate every frozen hash and the immutable panel before publishing
      // the nonreplaceable claim, but do not simulate a strategy yet.
      const validatedFrozenInputs = await loadFrozenInputs();
      await createRunClaim(validatedFrozenInputs);
    }
    const bundle = await computeGeneration6Bundle();
    await assertNoConflictingPrivateLedgers(bundle.privateLedgerPath);
    await writeOnceOrVerify(bundle.privateLedgerPath, bundle.privateLedgerPayload,
      "Generation 6 private ledger");
    await writeOnceOrVerify(jsonOutputPath, bundle.jsonPayload, "Generation 6 JSON output");
    await writeOnceOrVerify(markdownOutputPath, bundle.markdownPayload,
      "Generation 6 Markdown report");
    await writeOnceOrVerify(resultReceiptPath, bundle.receiptPayload,
      "Generation 6 result receipt");
    return bundle;
  });
}

async function assertByteEqual(path, expected, label) {
  const actual = await readFile(path);
  invariant(actual.equals(expected), `${label} differs from deterministic recomputation`);
}

async function verifyExisting() {
  return withExclusiveDirectoryLock(runLockPath, async () => {
    for (const path of [runClaimPath, jsonOutputPath, markdownOutputPath, resultReceiptPath]) {
      invariant(await pathExists(path), `cannot verify absent Generation 6 artifact ${path}`);
    }
    const bundle = await computeGeneration6Bundle();
    await assertNoConflictingPrivateLedgers(bundle.privateLedgerPath);
    await assertByteEqual(jsonOutputPath, bundle.jsonPayload, "Generation 6 JSON output");
    await assertByteEqual(markdownOutputPath, bundle.markdownPayload, "Generation 6 Markdown report");
    await assertByteEqual(bundle.privateLedgerPath, bundle.privateLedgerPayload, "Generation 6 private ledger");
    await assertByteEqual(resultReceiptPath, bundle.receiptPayload, "Generation 6 result receipt");
    return bundle;
  });
}

async function main() {
  const args = process.argv.slice(2);
  invariant(args.length <= 1 && (args.length === 0 || args[0] === "--verify-existing"), "usage: node research/run_quant_champion_generation6.mjs [--verify-existing]");
  const verification = args[0] === "--verify-existing";
  const bundle = verification ? await verifyExisting() : await firstRun();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: verification ? "verify-existing" : "first-run",
    disposition: bundle.report.disposition,
    selected_id: bundle.report.selection.selected_id_before_post_selection_robustness,
    growth_control_selected_id:
      bundle.report.selection.growth_control_challenge_track.selected_id_before_post_selection_robustness,
    diagnostic_candidate_id: bundle.report.diagnostics.candidate_id,
    normalized_panel_sha256: bundle.report.dataset.normalized_panel_sha256,
    json: jsonOutputPath,
    markdown: markdownOutputPath,
    receipt: resultReceiptPath,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
