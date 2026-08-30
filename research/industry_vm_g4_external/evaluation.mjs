import { inverseNormal, normalCdf } from "../../lib/quant.mjs";
import { sha256 } from "../../lib/canonical.mjs";
import {
  normalizeLongWeights,
  rowsWithin,
  scaleRiskyWeightsToTarget,
  simulateStrategy,
} from "../champion_engine.mjs";
import {
  KENNETH_FRENCH_10_INDUSTRY_FACTOR_ADAPTER_SCHEMA,
  KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS,
} from "./source.mjs";
import {
  INDUSTRY_VM_G4_ANNUALIZED_VOLATILITY_TARGET,
  INDUSTRY_VM_G4_ANNUAL_BORROW_SPREAD,
  INDUSTRY_VM_G4_CASH_SYMBOL,
  INDUSTRY_VM_G4_DIAGNOSTIC_STRATEGY,
  INDUSTRY_VM_G4_MARKET_SYMBOL,
  INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
  INDUSTRY_VM_G4_PRIMARY_STRATEGY,
  INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
  INDUSTRY_VM_G4_SIGNAL_LOOKBACK_SESSIONS,
  INDUSTRY_VM_G4_TRANSACTION_COST_SYMBOLS,
  INDUSTRY_VM_G4_VOLATILITY_LOOKBACK_SESSIONS,
  applyIndustryVmG4RiskyOnlyTransactionCosts,
  buildIndustryVmG4PrimaryRawWeights,
  rebaseIndustryVmG4RowsForStandalonePeriod,
} from "./strategy.mjs";

export const INDUSTRY_VM_G4_EVALUATION_SCHEMA =
  "finly_industry_vm_g4_external_evaluation.v1";
export const INDUSTRY_VM_G4_PRIMARY_SERIES_SCHEMA =
  "finly_industry_vm_g4_external_primary_pair.v1";

export const INDUSTRY_VM_G4_PRIMARY_END = "2007-05-29";
export const INDUSTRY_VM_G4_OVERLAP_START = "2007-05-30";
export const INDUSTRY_VM_G4_OFFICIAL_SOURCE_FIRST_DATE = "1926-07-01";
export const INDUSTRY_VM_G4_OFFICIAL_SOURCE_LAST_DATE = "2026-06-30";
export const INDUSTRY_VM_G4_OFFICIAL_SOURCE_OBSERVATIONS = 26_274;
export const INDUSTRY_VM_G4_EXPECTED_PRIMARY_START = "1927-05-07";
export const INDUSTRY_VM_G4_EXPECTED_PRIMARY_OBSERVATIONS = 21_218;
export const INDUSTRY_VM_G4_COST_BPS = Object.freeze([5, 10, 25]);
export const INDUSTRY_VM_G4_CADENCE_ANCHORS = Object.freeze(
  Array.from({ length: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS }, (_, index) => index),
);
export const INDUSTRY_VM_G4_PRIMARY_COST_BPS = 5;
export const INDUSTRY_VM_G4_PRIMARY_ANCHOR = 0;
export const INDUSTRY_VM_G4_BOOTSTRAP_SEED = 20260830;
export const INDUSTRY_VM_G4_BOOTSTRAP_RESAMPLES = 4_999;
export const INDUSTRY_VM_G4_EXPECTED_BLOCK_SESSIONS = 20;
export const INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT = 200;
export const INDUSTRY_VM_G4_NOMINAL_ALPHA = 0.05;
export const INDUSTRY_VM_G4_BONFERRONI_THRESHOLD =
  INDUSTRY_VM_G4_NOMINAL_ALPHA / INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT;
export const INDUSTRY_VM_G4_MAX_AGGREGATE_BYTES = 2 * 1024 * 1024;
export const INDUSTRY_VM_G4_MAX_PRIMARY_SERIES_BYTES = 8 * 1024 * 1024;

export const INDUSTRY_VM_G4_GATE_NAMES = Object.freeze([
  "primary_direction",
  "statistical_evidence",
  "absolute_and_rf_performance",
  "cost_stress",
  "cadence_robustness",
  "complete_decades",
  "drawdown_guardrail",
  "volatility_matched_control",
  "integrity",
]);

export const INDUSTRY_VM_G4_EXTERNAL_INTEGRITY_INPUTS = Object.freeze([
  "protocol_self_hash",
  "artifact_hash_binding",
  "official_source_identity_and_receipt",
  "strict_parser_schema_and_row_order",
  "source_transform_identity_and_exact_date_alignment",
  "future_observation_mutation_invariance",
]);

const EXPECTED_COMPLETE_DECADES = Object.freeze([
  1930, 1940, 1950, 1960, 1970, 1980, 1990,
]);
const EULER_MASCHERONI = 0.5772156649015329;
const MINIMUM_INFERENCE_OBSERVATIONS = 41;
const MARKET_BUY_HOLD_POLICY_ID = "industry_external_market_buy_hold.anchor_0";
const COMPACT_ACCOUNTING_ROW_KEYS = Object.freeze([
  "cash_return",
  "execution_return_date",
  "financing_spread_cost",
  "net_return",
  "rebalanced",
  "transaction_cost",
  "turnover_notional",
]);

function fail(message) {
  throw new TypeError(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    fail(`${label} must contain exactly: ${sortedExpected.join(", ")}`);
  }
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function isoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${label} must be an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be an ISO date`);
  }
  return value;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0)
    / (values.length - 1);
  return Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : null;
}

function serializedByteCount(value) {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`).byteLength;
}

function validateAdaptedPanel(adapted) {
  plainObject(adapted, "adapted Kenneth French industry panel");
  if (adapted.schema_version !== KENNETH_FRENCH_10_INDUSTRY_FACTOR_ADAPTER_SCHEMA
    || adapted.source_return_units !== "percent simple daily returns"
    || adapted.cash_and_financing_symbol !== INDUSTRY_VM_G4_CASH_SYMBOL
    || adapted.market_identity !== "MARKET = (Mkt-RF + RF) / 100"
    || !Array.isArray(adapted.symbols)
    || adapted.symbols.length !== KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.length
    || adapted.symbols.some((symbol, index) => (
      symbol !== KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS[index]
    ))
    || !Array.isArray(adapted.points)
    || adapted.points.length < INDUSTRY_VM_G4_SIGNAL_LOOKBACK_SESSIONS + 3
    || adapted.exact_date_rows !== adapted.points.length) {
    fail("adapted Kenneth French industry panel schema is invalid");
  }
  let priorDate = "";
  const expectedKeys = ["date", ...KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS].sort();
  adapted.points.forEach((point, index) => {
    const keys = point && typeof point === "object" && !Array.isArray(point)
      ? Object.keys(point).sort()
      : [];
    if (keys.length !== expectedKeys.length
      || keys.some((key, keyIndex) => key !== expectedKeys[keyIndex])) {
      fail(`adapted panel point ${index + 1} fields are invalid`);
    }
    const date = isoDate(point.date, `adapted panel point ${index + 1} date`);
    if (date <= priorDate) fail("adapted panel dates must be strictly increasing");
    priorDate = date;
    for (const symbol of KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS) {
      if (!(finite(point[symbol], `adapted panel point ${index + 1} ${symbol}`) > 0)) {
        fail(`adapted panel point ${index + 1} ${symbol} must be positive`);
      }
    }
  });
  return adapted.points;
}

function validateExternalIntegrityInputs(integrityInputs) {
  exactKeys(
    integrityInputs,
    INDUSTRY_VM_G4_EXTERNAL_INTEGRITY_INPUTS,
    "industry external integrity inputs",
  );
  for (const name of INDUSTRY_VM_G4_EXTERNAL_INTEGRITY_INPUTS) {
    if (typeof integrityInputs[name] !== "boolean") {
      fail(`industry external integrity input ${name} must be boolean`);
    }
  }
  return integrityInputs;
}

function anchoredStrategy(strategy, anchor, suffix = "") {
  return Object.freeze({
    ...strategy,
    id: `${strategy.id}${suffix}.anchor_${anchor}`,
    rebalanceAnchor: anchor,
  });
}

function marketBuyHoldStrategy() {
  return Object.freeze({
    id: "industry_external_market_buy_hold",
    // Enter at the first eligible anchor-0 signal and hold. A monthly target
    // would turn a buy-and-hold control into an actively rebalanced strategy.
    rebalanceIntervalSessions: Number.MAX_SAFE_INTEGER,
    decide() {
      return normalizeLongWeights(
        { [INDUSTRY_VM_G4_MARKET_SYMBOL]: 1 },
        {
          cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
          maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
        },
      );
    },
  });
}

function volatilityMatchedMarketStrategy() {
  return Object.freeze({
    id: "industry_external_market_vol20_cap15",
    rebalanceIntervalSessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
    decide({ returnsBySymbol, signalIndex }) {
      return scaleRiskyWeightsToTarget(
        { [INDUSTRY_VM_G4_MARKET_SYMBOL]: 1 },
        {
          returnsBySymbol,
          signalIndex,
          targetVolatility: INDUSTRY_VM_G4_ANNUALIZED_VOLATILITY_TARGET,
          volatilityLookback: INDUSTRY_VM_G4_VOLATILITY_LOOKBACK_SESSIONS,
          cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
          maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
        },
      );
    },
  });
}

function unscaledPrimaryStrategy() {
  return Object.freeze({
    id: "industry_external_unscaled_primary_a",
    rebalanceIntervalSessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
    decide({ points, signalIndex }) {
      return normalizeLongWeights(
        buildIndustryVmG4PrimaryRawWeights(points, signalIndex),
        {
          cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
          maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
        },
      );
    },
  });
}

function rfCashStrategy() {
  return Object.freeze({
    id: "industry_external_rf_cash",
    rebalanceIntervalSessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
    decide() {
      return normalizeLongWeights({}, {
        cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
        maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
      });
    },
  });
}

function simulate(points, strategy, anchor, oneWayCostBps) {
  const zeroCostSimulation = simulateStrategy(
    points,
    KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS,
    anchoredStrategy(strategy, anchor, `.cost_${oneWayCostBps}`),
    {
      cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
      lookbackSessions: INDUSTRY_VM_G4_SIGNAL_LOOKBACK_SESSIONS,
      rebalanceIntervalSessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
      rebalanceAnchor: anchor,
      oneWayCostBps: 0,
      annualBorrowSpread: INDUSTRY_VM_G4_ANNUAL_BORROW_SPREAD,
      maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
      terminalLiquidation: false,
    },
  );
  return applyIndustryVmG4RiskyOnlyTransactionCosts(zeroCostSimulation, {
    oneWayCostBps,
    terminalLiquidation: false,
  });
}

function standaloneRows(simulation, start, end, oneWayCostBps, label) {
  const selected = rowsWithin(simulation.rows, start, end);
  if (selected.length < 2) fail(`${label} partition requires at least two scored rows`);
  return rebaseIndustryVmG4RowsForStandalonePeriod(selected, {
    oneWayCostBps,
  });
}

function summarizeRows(rows, label) {
  if (!Array.isArray(rows) || rows.length < 2) fail(`${label} requires at least two rows`);
  const returns = [];
  const excessReturns = [];
  let netLogGrowth = 0;
  let wealth = 1;
  let peak = 1;
  let maximumDrawdown = 0;
  let turnover = 0;
  let transactionCost = 0;
  let financingCost = 0;
  let rebalancedObservations = 0;
  for (const [index, row] of rows.entries()) {
    const netReturn = finite(row?.net_return, `${label} row ${index + 1} net return`);
    const cashReturn = finite(row?.cash_return, `${label} row ${index + 1} cash return`);
    if (netReturn <= -1) fail(`${label} row ${index + 1} net return must exceed -1`);
    const logReturn = Math.log1p(netReturn);
    netLogGrowth += logReturn;
    wealth *= 1 + netReturn;
    peak = Math.max(peak, wealth);
    maximumDrawdown = Math.min(maximumDrawdown, wealth / peak - 1);
    returns.push(netReturn);
    excessReturns.push(netReturn - cashReturn);
    turnover += finite(row.turnover_notional, `${label} row ${index + 1} risky-asset turnover`);
    transactionCost += finite(
      row.transaction_cost,
      `${label} row ${index + 1} risky-asset transaction cost`,
    );
    financingCost += finite(row.financing_spread_cost, `${label} row ${index + 1} financing cost`);
    if (row.rebalanced === true) rebalancedObservations += 1;
  }
  const volatility = sampleStandardDeviation(returns);
  const excessVolatility = sampleStandardDeviation(excessReturns);
  return deepFreeze({
    observations: rows.length,
    start_date: rows[0].execution_return_date,
    end_date: rows.at(-1).execution_return_date,
    net_log_growth: netLogGrowth,
    annualized_net_log_growth: netLogGrowth * 252 / rows.length,
    total_return: Math.exp(netLogGrowth) - 1,
    annualized_return: Math.exp(netLogGrowth * 252 / rows.length) - 1,
    annualized_volatility: volatility * Math.sqrt(252),
    cash_excess_sharpe: excessVolatility > 0
      ? mean(excessReturns) / excessVolatility * Math.sqrt(252)
      : null,
    maximum_drawdown: maximumDrawdown,
    annualized_risky_asset_turnover_notional: turnover * 252 / rows.length,
    modeled_risky_asset_transaction_cost_simple_sum: transactionCost,
    modeled_financing_spread_simple_sum: financingCost,
    rebalanced_observations: rebalancedObservations,
  });
}

function pairRows(candidateRows, benchmarkRows, label) {
  if (candidateRows.length !== benchmarkRows.length) {
    fail(`${label} policies have different observation counts`);
  }
  return candidateRows.map((candidate, index) => {
    const benchmark = benchmarkRows[index];
    if (candidate.execution_return_date !== benchmark.execution_return_date) {
      fail(`${label} policies have different outcome dates`);
    }
    const candidateLog = Math.log1p(candidate.net_return);
    const benchmarkLog = Math.log1p(benchmark.net_return);
    return Object.freeze({
      outcome_date: candidate.execution_return_date,
      candidate_net_return: candidate.net_return,
      benchmark_net_return: benchmark.net_return,
      candidate_minus_benchmark_net_log_return: candidateLog - benchmarkLog,
    });
  });
}

function policyId(strategy, anchor = 0) {
  return `${strategy.id}.anchor_${anchor}`;
}

function comparison(candidateRows, benchmarkRows, {
  label,
  candidatePolicy,
  benchmarkPolicy,
}) {
  if (typeof candidatePolicy !== "string" || candidatePolicy.length === 0
    || typeof benchmarkPolicy !== "string" || benchmarkPolicy.length === 0) {
    fail(`${label} requires explicit candidate and benchmark policy ids`);
  }
  const paired = pairRows(candidateRows, benchmarkRows, label);
  const candidate = summarizeRows(candidateRows, `${label} candidate`);
  const benchmark = summarizeRows(benchmarkRows, `${label} benchmark`);
  const edge = paired.reduce(
    (sum, row) => sum + row.candidate_minus_benchmark_net_log_return,
    0,
  );
  return deepFreeze({
    candidate_policy: candidatePolicy,
    benchmark_policy: benchmarkPolicy,
    candidate,
    benchmark,
    paired_mean_daily_net_log_return_difference: edge / paired.length,
    annualized_net_log_growth_difference: edge * 252 / paired.length,
    net_log_growth_difference: edge,
    candidate_path_sha256: sha256(candidateRows.map((row) => [
      row.execution_return_date,
      row.net_return,
      row.rebalanced,
    ])),
    benchmark_path_sha256: sha256(benchmarkRows.map((row) => [
      row.execution_return_date,
      row.net_return,
      row.rebalanced,
    ])),
    paired,
  });
}

function compactComparison(value) {
  return deepFreeze({
    candidate_policy: value.candidate_policy,
    benchmark_policy: value.benchmark_policy,
    candidate: value.candidate,
    benchmark: value.benchmark,
    paired_mean_daily_net_log_return_difference:
      value.paired_mean_daily_net_log_return_difference,
    annualized_net_log_growth_difference: value.annualized_net_log_growth_difference,
    net_log_growth_difference: value.net_log_growth_difference,
    candidate_path_sha256: value.candidate_path_sha256,
    benchmark_path_sha256: value.benchmark_path_sha256,
  });
}

function compactAccountingRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze({
    execution_return_date: row.execution_return_date,
    rebalanced: row.rebalanced,
    cash_return: row.cash_return,
    net_return: row.net_return,
    turnover_notional: row.turnover_notional,
    transaction_cost: row.transaction_cost,
    financing_spread_cost: row.financing_spread_cost,
  })));
}

function accountingRowsAreCompact(rows) {
  return rows.every((row) => {
    const keys = Object.keys(row).sort();
    return keys.length === COMPACT_ACCOUNTING_ROW_KEYS.length
      && keys.every((key, index) => key === COMPACT_ACCOUNTING_ROW_KEYS[index]);
  });
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function runIndustryVmG4StationaryBootstrap(dailyValues) {
  if (!Array.isArray(dailyValues) || dailyValues.length < MINIMUM_INFERENCE_OBSERVATIONS) {
    fail(`industry external inference requires at least ${MINIMUM_INFERENCE_OBSERVATIONS} values`);
  }
  dailyValues.forEach((value, index) => finite(value, `industry paired value ${index + 1}`));
  const observedMean = mean(dailyValues);
  const centered = dailyValues.map((value) => value - observedMean);
  const random = mulberry32(INDUSTRY_VM_G4_BOOTSTRAP_SEED);
  let exceedances = 0;
  for (let draw = 0; draw < INDUSTRY_VM_G4_BOOTSTRAP_RESAMPLES; draw += 1) {
    let source = Math.floor(random() * centered.length);
    let sum = 0;
    for (let index = 0; index < centered.length; index += 1) {
      sum += centered[source];
      source = random() < 1 / INDUSTRY_VM_G4_EXPECTED_BLOCK_SESSIONS
        ? Math.floor(random() * centered.length)
        : (source + 1) % centered.length;
    }
    if (sum / centered.length >= observedMean) exceedances += 1;
  }
  const pValue = (1 + exceedances) / (INDUSTRY_VM_G4_BOOTSTRAP_RESAMPLES + 1);
  return deepFreeze({
    test: "one-sided null-centered stationary circular block bootstrap",
    observations: dailyValues.length,
    observed_mean: observedMean,
    seed_uint32: INDUSTRY_VM_G4_BOOTSTRAP_SEED,
    resamples: INDUSTRY_VM_G4_BOOTSTRAP_RESAMPLES,
    expected_block_sessions: INDUSTRY_VM_G4_EXPECTED_BLOCK_SESSIONS,
    restart_probability: 1 / INDUSTRY_VM_G4_EXPECTED_BLOCK_SESSIONS,
    equality_counts_as_exceedance: true,
    exceedances,
    nominal_one_sided_p_value: pValue,
    nominal_alpha: INDUSTRY_VM_G4_NOMINAL_ALPHA,
    global_trial_count: INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT,
    bonferroni_threshold: INDUSTRY_VM_G4_BONFERRONI_THRESHOLD,
    adjusted_p_value: Math.min(1, pValue * INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT),
    passes_nominal_gate: observedMean > 0 && pValue <= INDUSTRY_VM_G4_NOMINAL_ALPHA,
    passes_bonferroni_gate: observedMean > 0
      && pValue <= INDUSTRY_VM_G4_BONFERRONI_THRESHOLD,
  });
}

export function industryVmG4DeflatedSharpe(dailyValues) {
  if (!Array.isArray(dailyValues) || dailyValues.length < 2) {
    fail("industry external DSR requires at least two values");
  }
  dailyValues.forEach((value, index) => finite(value, `industry DSR value ${index + 1}`));
  const observations = dailyValues.length;
  const average = mean(dailyValues);
  const sampleDeviation = sampleStandardDeviation(dailyValues);
  const populationVariance = dailyValues.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0,
  ) / observations;
  const constantSeries = dailyValues.every((value) => value === dailyValues[0]);
  if (constantSeries || !(sampleDeviation > 0) || !(populationVariance > 0)) {
    return deepFreeze({
      method: "parametric null-maximum deflated Sharpe probability",
      calibration: "Cross-trial Sharpe mean is fixed at zero and its null standard error is fixed at 1/sqrt(T-1); no empirical 200-trial Sharpe distribution is available.",
      empirical_trial_sharpe_distribution_used: false,
      observations,
      probability: null,
      global_trial_count: INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT,
      passes_gate: false,
      disposition: "GATE_FAILS_CLOSED",
    });
  }
  const thirdMoment = dailyValues.reduce(
    (sum, value) => sum + ((value - average) ** 3),
    0,
  ) / observations;
  const fourthMoment = dailyValues.reduce(
    (sum, value) => sum + ((value - average) ** 4),
    0,
  ) / observations;
  const observedSharpe = average / sampleDeviation;
  const skewness = thirdMoment / (populationVariance ** 1.5);
  const pearsonKurtosis = fourthMoment / (populationVariance ** 2);
  const expectedMaximumCoefficient = (1 - EULER_MASCHERONI)
    * inverseNormal(1 - 1 / INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT)
    + EULER_MASCHERONI
      * inverseNormal(1 - 1 / (INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT * Math.E));
  const benchmarkSharpe = expectedMaximumCoefficient / Math.sqrt(observations - 1);
  const varianceFactor = 1 - skewness * observedSharpe
    + ((pearsonKurtosis - 1) / 4) * (observedSharpe ** 2);
  const zScore = varianceFactor > 0
    ? (observedSharpe - benchmarkSharpe) * Math.sqrt(observations - 1)
      / Math.sqrt(varianceFactor)
    : null;
  const probability = Number.isFinite(zScore) ? normalCdf(zScore) : null;
  const valid = [sampleDeviation, populationVariance, observedSharpe, skewness,
    pearsonKurtosis, expectedMaximumCoefficient, benchmarkSharpe, varianceFactor,
    zScore, probability].every((value) => Number.isFinite(value))
    && varianceFactor > 0 && probability >= 0 && probability <= 1;
  return deepFreeze({
    method: "parametric null-maximum deflated Sharpe probability",
    calibration: "Cross-trial Sharpe mean is fixed at zero and its null standard error is fixed at 1/sqrt(T-1); no empirical 200-trial Sharpe distribution is available.",
    empirical_trial_sharpe_distribution_used: false,
    observations,
    sample_mean: average,
    sample_standard_deviation: sampleDeviation,
    observed_periodic_sharpe: valid ? observedSharpe : null,
    uncorrected_skewness: valid ? skewness : null,
    pearson_kurtosis: valid ? pearsonKurtosis : null,
    global_trial_count: INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT,
    expected_maximum_coefficient: valid ? expectedMaximumCoefficient : null,
    deflated_benchmark_sharpe_periodic: valid ? benchmarkSharpe : null,
    non_normality_variance_factor: valid ? varianceFactor : null,
    z_score: valid ? zScore : null,
    probability: valid ? probability : null,
    passes_gate: valid && probability >= 0.95,
    disposition: valid ? "FINITE" : "GATE_FAILS_CLOSED",
  });
}

function decadeEvidence(paired) {
  const byYear = new Map();
  paired.forEach((row) => {
    const year = Number(row.outcome_date.slice(0, 4));
    const values = byYear.get(year) ?? [];
    values.push(row.candidate_minus_benchmark_net_log_return);
    byYear.set(year, values);
  });
  const complete = EXPECTED_COMPLETE_DECADES.filter((start) => (
    Array.from({ length: 10 }, (_, offset) => start + offset)
      .every((year) => (byYear.get(year)?.length ?? 0) > 0)
  )).map((start) => {
    let edge = 0;
    for (let year = start; year <= start + 9; year += 1) {
      edge += byYear.get(year).reduce((sum, value) => sum + value, 0);
    }
    return Object.freeze({ start_year: start, net_log_growth_edge: edge, positive: edge > 0 });
  });
  return deepFreeze({
    expected_start_years: [...EXPECTED_COMPLETE_DECADES],
    observed_complete_decades: complete,
    median_edge: complete.length > 0 ? median(complete.map((item) => item.net_log_growth_edge)) : null,
    positive_count: complete.filter((item) => item.positive).length,
    positive_fraction: complete.length > 0
      ? complete.filter((item) => item.positive).length / complete.length
      : 0,
  });
}

function chronologyIsCausal(rows) {
  return rows.every((row) => row.signal_date < row.rebalance_date
    && row.rebalance_date < row.execution_return_date);
}

function exactStandaloneEntry(rows, costBps) {
  const first = rows[0];
  const entryExpected = first.standalone_entry_notional * costBps / 10_000;
  return first.standalone_entry === true
    && Math.abs(first.standalone_entry_cost - entryExpected) <= 1e-9;
}

function exactStandaloneTerminalLiquidation(rows, costBps) {
  const last = rows.at(-1);
  const terminalExpected = last.standalone_terminal_liquidation_notional
    * costBps / 10_000;
  return last.standalone_terminal_liquidation === true
    && Math.abs(last.standalone_terminal_liquidation_cost - terminalExpected) <= 1e-9;
}

function gate(name, checks) {
  return deepFreeze({ name, checks, passed: Object.values(checks).every(Boolean) });
}

/**
 * Evaluate the sole frozen A policy. This performs no file or network I/O and
 * returns only aggregate evidence plus the one prespecified primary pair.
 */
export function evaluateIndustryVmG4External(adapted, { integrityInputs } = {}) {
  const points = validateAdaptedPanel(adapted);
  const externalIntegrity = validateExternalIntegrityInputs(integrityInputs);
  if (points[0].date > INDUSTRY_VM_G4_PRIMARY_END
    || points.at(-1).date < INDUSTRY_VM_G4_OVERLAP_START) {
    fail("adapted panel does not cover both frozen partitions");
  }

  const marketStrategy = marketBuyHoldStrategy();
  const primaryPolicy = policyId(
    INDUSTRY_VM_G4_PRIMARY_STRATEGY,
    INDUSTRY_VM_G4_PRIMARY_ANCHOR,
  );
  const marketPolicy = policyId(marketStrategy, 0);
  if (marketPolicy !== MARKET_BUY_HOLD_POLICY_ID) {
    fail("market buy-and-hold policy id changed");
  }
  const primaryCostCells = [];
  const primaryBoundaryChecksByCost = {};
  let primaryPair = null;
  let primaryRowsAtFive = null;
  let marketRowsAtFive = null;
  for (const costBps of INDUSTRY_VM_G4_COST_BPS) {
    const candidateSimulation = simulate(
      points,
      INDUSTRY_VM_G4_PRIMARY_STRATEGY,
      INDUSTRY_VM_G4_PRIMARY_ANCHOR,
      costBps,
    );
    const marketSimulation = simulate(
      points,
      marketStrategy,
      0,
      costBps,
    );
    const candidateRows = standaloneRows(
      candidateSimulation,
      points[0].date,
      INDUSTRY_VM_G4_PRIMARY_END,
      costBps,
      `primary candidate ${costBps}bp`,
    );
    const marketRows = standaloneRows(
      marketSimulation,
      points[0].date,
      INDUSTRY_VM_G4_PRIMARY_END,
      costBps,
      `primary market ${costBps}bp`,
    );
    const compared = comparison(candidateRows, marketRows, {
      label: `primary ${costBps}bp`,
      candidatePolicy: primaryPolicy,
      benchmarkPolicy: marketPolicy,
    });
    primaryBoundaryChecksByCost[costBps] = Object.freeze({
      candidate_entry: exactStandaloneEntry(candidateRows, costBps),
      market_entry: exactStandaloneEntry(marketRows, costBps),
      candidate_terminal: exactStandaloneTerminalLiquidation(candidateRows, costBps),
      market_terminal: exactStandaloneTerminalLiquidation(marketRows, costBps),
    });
    primaryCostCells.push(Object.freeze({ cost_bps: costBps, ...compactComparison(compared) }));
    if (costBps === INDUSTRY_VM_G4_PRIMARY_COST_BPS) {
      primaryPair = compared;
      primaryRowsAtFive = candidateRows;
      marketRowsAtFive = marketRows;
    }
  }
  const isOfficialFrozenRange = points.length === INDUSTRY_VM_G4_OFFICIAL_SOURCE_OBSERVATIONS
    && points[0].date === INDUSTRY_VM_G4_OFFICIAL_SOURCE_FIRST_DATE
    && points.at(-1).date === INDUSTRY_VM_G4_OFFICIAL_SOURCE_LAST_DATE;
  if (isOfficialFrozenRange
    && (primaryPair.candidate.start_date !== INDUSTRY_VM_G4_EXPECTED_PRIMARY_START
      || primaryPair.candidate.observations !== INDUSTRY_VM_G4_EXPECTED_PRIMARY_OBSERVATIONS
      || primaryPair.benchmark.start_date !== INDUSTRY_VM_G4_EXPECTED_PRIMARY_START
      || primaryPair.benchmark.observations !== INDUSTRY_VM_G4_EXPECTED_PRIMARY_OBSERVATIONS)) {
    fail("official industry replay primary partition differs from 1927-05-07 / 21,218");
  }
  const primaryChronologyAtFive = chronologyIsCausal(primaryRowsAtFive)
    && chronologyIsCausal(marketRowsAtFive);
  primaryRowsAtFive = compactAccountingRows(primaryRowsAtFive);
  marketRowsAtFive = compactAccountingRows(marketRowsAtFive);
  const primaryAccountingLedgersCompacted = accountingRowsAreCompact(primaryRowsAtFive)
    && accountingRowsAreCompact(marketRowsAtFive);

  const cadenceCells = [];
  for (const anchor of INDUSTRY_VM_G4_CADENCE_ANCHORS) {
    if (anchor === INDUSTRY_VM_G4_PRIMARY_ANCHOR) {
      cadenceCells.push(Object.freeze({
        anchor,
        ...compactComparison(primaryPair),
      }));
      continue;
    }
    const candidateRows = standaloneRows(
      simulate(points, INDUSTRY_VM_G4_PRIMARY_STRATEGY, anchor, 5),
      points[0].date,
      INDUSTRY_VM_G4_PRIMARY_END,
      5,
      `cadence candidate anchor ${anchor}`,
    );
    cadenceCells.push(Object.freeze({
      anchor,
      ...compactComparison(comparison(
        candidateRows,
        marketRowsAtFive,
        {
          label: `cadence anchor ${anchor}`,
          candidatePolicy: policyId(INDUSTRY_VM_G4_PRIMARY_STRATEGY, anchor),
          benchmarkPolicy: marketPolicy,
        },
      )),
    }));
  }

  const comparatorDefinitions = Object.freeze({
    volatility_matched_market: volatilityMatchedMarketStrategy(),
    unscaled_primary_a: unscaledPrimaryStrategy(),
    rf_cash: rfCashStrategy(),
    mapping_b_non_rescuing: INDUSTRY_VM_G4_DIAGNOSTIC_STRATEGY,
  });
  const comparators = {};
  for (const [id, strategy] of Object.entries(comparatorDefinitions)) {
    const rows = standaloneRows(
      simulate(points, strategy, 0, 5),
      points[0].date,
      INDUSTRY_VM_G4_PRIMARY_END,
      5,
      `comparator ${id}`,
    );
    comparators[id] = id === "mapping_b_non_rescuing"
      ? compactComparison(comparison(
        rows,
        marketRowsAtFive,
        {
          label: "mapping B versus market",
          candidatePolicy: policyId(strategy, 0),
          benchmarkPolicy: marketPolicy,
        },
      ))
      : compactComparison(comparison(
        primaryRowsAtFive,
        rows,
        {
          label: `candidate versus ${id}`,
          candidatePolicy: primaryPolicy,
          benchmarkPolicy: policyId(strategy, 0),
        },
      ));
  }

  const overlapCandidateRows = standaloneRows(
    simulate(points, INDUSTRY_VM_G4_PRIMARY_STRATEGY, 0, 5),
    INDUSTRY_VM_G4_OVERLAP_START,
    points.at(-1).date,
    5,
    "overlap candidate",
  );
  const overlapMarketRows = standaloneRows(
    simulate(points, marketStrategy, 0, 5),
    INDUSTRY_VM_G4_OVERLAP_START,
    points.at(-1).date,
    5,
    "overlap market",
  );
  const overlapDiagnostic = compactComparison(comparison(
    overlapCandidateRows,
    overlapMarketRows,
    {
      label: "overlap diagnostic",
      candidatePolicy: primaryPolicy,
      benchmarkPolicy: marketPolicy,
    },
  ));

  const dailyValues = primaryPair.paired.map(
    (row) => row.candidate_minus_benchmark_net_log_return,
  );
  const bootstrap = runIndustryVmG4StationaryBootstrap(dailyValues);
  const deflatedSharpe = industryVmG4DeflatedSharpe(dailyValues);
  const decades = decadeEvidence(primaryPair.paired);
  const costByBps = Object.fromEntries(primaryCostCells.map((cell) => [cell.cost_bps, cell]));
  const cadenceEdges = cadenceCells.map((cell) => cell.net_log_growth_difference);
  const volatilityRatio = primaryPair.candidate.annualized_volatility
    / comparators.volatility_matched_market.benchmark.annualized_volatility;
  if (!Number.isFinite(volatilityRatio) || volatilityRatio < 0) {
    fail("industry external volatility-matched comparator produced an invalid ratio");
  }

  const computedIntegrity = {
    warmup_signal_rebalance_outcome_chronology: primaryChronologyAtFive,
    cost_monotonicity_and_exact_entry_cost:
      costByBps[5].candidate.net_log_growth >= costByBps[10].candidate.net_log_growth
      && costByBps[10].candidate.net_log_growth >= costByBps[25].candidate.net_log_growth
      && costByBps[5].benchmark.net_log_growth >= costByBps[10].benchmark.net_log_growth
      && costByBps[10].benchmark.net_log_growth >= costByBps[25].benchmark.net_log_growth
      && INDUSTRY_VM_G4_COST_BPS.every((costBps) => (
        primaryBoundaryChecksByCost[costBps].candidate_entry
        && primaryBoundaryChecksByCost[costBps].market_entry
      )),
    exact_terminal_liquidation:
      INDUSTRY_VM_G4_COST_BPS.every((costBps) => (
        primaryBoundaryChecksByCost[costBps].candidate_terminal
        && primaryBoundaryChecksByCost[costBps].market_terminal
      )),
    retained_5bp_ledgers_compacted_after_boundary_and_chronology_checks:
      primaryAccountingLedgersCompacted,
  };

  const gates = {
    primary_direction: gate("primary_direction", {
      anchor_zero_5bp_market_edge_strictly_positive:
        primaryPair.net_log_growth_difference > 0,
    }),
    statistical_evidence: gate("statistical_evidence", {
      nominal_p_value_at_most_0_05: bootstrap.passes_nominal_gate,
      bonferroni_raw_p_value_at_most_0_05_over_200: bootstrap.passes_bonferroni_gate,
      parametric_deflated_sharpe_probability_at_least_0_95:
        deflatedSharpe.passes_gate,
    }),
    absolute_and_rf_performance: gate("absolute_and_rf_performance", {
      candidate_positive_net_log_growth: primaryPair.candidate.net_log_growth > 0,
      candidate_beats_rf: comparators.rf_cash.net_log_growth_difference > 0,
    }),
    cost_stress: gate("cost_stress", {
      edge_positive_at_5bp: costByBps[5].net_log_growth_difference > 0,
      edge_positive_at_10bp: costByBps[10].net_log_growth_difference > 0,
      edge_positive_at_25bp: costByBps[25].net_log_growth_difference > 0,
    }),
    cadence_robustness: gate("cadence_robustness", {
      anchor_zero_positive: cadenceEdges[0] > 0,
      median_of_21_anchors_positive: median(cadenceEdges) > 0,
      at_least_17_of_21_anchors_positive:
        cadenceEdges.filter((value) => value > 0).length >= 17,
    }),
    complete_decades: gate("complete_decades", {
      exact_expected_seven_complete_decades:
        decades.observed_complete_decades.length === EXPECTED_COMPLETE_DECADES.length
        && decades.observed_complete_decades.every(
          (item, index) => item.start_year === EXPECTED_COMPLETE_DECADES[index],
        ),
      median_complete_decade_edge_positive: (decades.median_edge ?? Number.NEGATIVE_INFINITY) > 0,
      at_least_five_of_seven_complete_decades_positive: decades.positive_count >= 5,
    }),
    drawdown_guardrail: gate("drawdown_guardrail", {
      candidate_drawdown_no_more_than_0_05_worse:
        primaryPair.candidate.maximum_drawdown
          >= primaryPair.benchmark.maximum_drawdown - 0.05,
    }),
    volatility_matched_control: gate("volatility_matched_control", {
      candidate_beats_causal_volatility_matched_market:
        comparators.volatility_matched_market.net_log_growth_difference > 0,
      realized_volatility_ratio_at_least_0_90: volatilityRatio >= 0.90,
      realized_volatility_ratio_at_most_1_10: volatilityRatio <= 1.10,
    }),
    integrity: gate("integrity", {
      ...externalIntegrity,
      ...computedIntegrity,
    }),
  };
  if (Object.keys(gates).length !== INDUSTRY_VM_G4_GATE_NAMES.length
    || INDUSTRY_VM_G4_GATE_NAMES.some((name) => gates[name]?.name !== name)) {
    fail("industry external gate set changed");
  }

  const aggregateCore = {
    schema_version: INDUSTRY_VM_G4_EVALUATION_SCHEMA,
    claim_boundary:
      "Retrospective external industry-proxy mechanism evidence only; mapping B is diagnostic and cannot rescue primary A.",
    primary_policy: "A: 50% HiTec plus top three of the remaining nine industries, volatility-managed",
    diagnostic_mapping_b_role: "NON_RESCUING",
    transaction_cost_accounting: {
      basis: "one-way risky-asset L1 turnover at standalone entry, executed rebalances, and terminal liquidation",
      charged_symbols: [...INDUSTRY_VM_G4_TRANSACTION_COST_SYMBOLS],
      excluded_cash_and_financing_symbol: INDUSTRY_VM_G4_CASH_SYMBOL,
      borrow_spread_financing_charged_separately: true,
    },
    source: {
      observations: points.length,
      first_date: points[0].date,
      last_date: points.at(-1).date,
    },
    partitions: {
      primary_unseen: {
        end_date_inclusive: INDUSTRY_VM_G4_PRIMARY_END,
        ...compactComparison(primaryPair),
      },
      overlap_diagnostic_non_rescuing: {
        start_date_inclusive: INDUSTRY_VM_G4_OVERLAP_START,
        ...overlapDiagnostic,
      },
    },
    primary_cost_cells: primaryCostCells,
    cadence_5bp_cells: cadenceCells,
    comparators,
    inference: { bootstrap, parametric_deflated_sharpe: deflatedSharpe },
    complete_decades: decades,
    realized_volatility_ratio_to_matched_market: volatilityRatio,
    gates,
    all_nine_gates_passed: Object.values(gates).every((item) => item.passed),
    pass_label: "EXTERNAL_INDUSTRY_VM_G4_EDGE_ESTABLISHED_ON_FROZEN_PROXY_REPLAY",
    failure_label: "EXTERNAL_INDUSTRY_VM_G4_EDGE_NOT_ESTABLISHED",
  };
  const aggregate = deepFreeze({
    ...aggregateCore,
    evaluation_sha256: sha256(aggregateCore),
  });
  const primaryPairedSeriesCore = {
    schema_version: INDUSTRY_VM_G4_PRIMARY_SERIES_SCHEMA,
    partition: "PRIMARY_UNSEEN_THROUGH_2007_05_29",
    candidate_policy: primaryPair.candidate_policy,
    benchmark_policy: primaryPair.benchmark_policy,
    cadence_anchor: 0,
    one_way_cost_bps: 5,
    rows: primaryPair.paired,
  };
  const primaryPairedSeries = deepFreeze({
    ...primaryPairedSeriesCore,
    series_sha256: sha256(primaryPairedSeriesCore),
  });
  const aggregateBytes = serializedByteCount(aggregate);
  const pairedSeriesBytes = serializedByteCount(primaryPairedSeries);
  if (aggregateBytes > INDUSTRY_VM_G4_MAX_AGGREGATE_BYTES) {
    fail("industry external aggregate evaluation exceeds the 2 MiB one-shot bound");
  }
  if (pairedSeriesBytes > INDUSTRY_VM_G4_MAX_PRIMARY_SERIES_BYTES) {
    fail("industry external primary paired series exceeds the 8 MiB one-shot bound");
  }
  return deepFreeze({
    aggregate,
    primary_paired_series: primaryPairedSeries,
    output_size_guard: {
      aggregate_bytes: aggregateBytes,
      aggregate_maximum_bytes: INDUSTRY_VM_G4_MAX_AGGREGATE_BYTES,
      primary_series_bytes: pairedSeriesBytes,
      primary_series_maximum_bytes: INDUSTRY_VM_G4_MAX_PRIMARY_SERIES_BYTES,
      full_cartesian_grid_persisted: false,
      retained_5bp_accounting_ledgers_compacted: primaryAccountingLedgersCompacted,
      passed: true,
    },
  });
}
