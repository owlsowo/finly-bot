import {
  mean,
  normalizeLongWeights,
  quantile,
  round,
  sampleStandardDeviation,
  simulateStrategy,
} from "./champion_engine.mjs";
import {
  CORE_SYMBOLS,
  CROSS_ASSET_SYMBOLS,
  SECTOR_SYMBOLS,
} from "./champion_strategies.mjs";
import { GENERATION5_SOURCE_THRESHOLDS } from "./source_overlap_reconciliation_generation5.mjs";

const TRADING_DAYS = 252;
const CASH_SYMBOL = "BIL";
const WEIGHT_EPSILON = 1e-10;

export const GENERATION6_SOURCE_SYMBOLS = Object.freeze([...CORE_SYMBOLS]);

export const GENERATION6_PER_SYMBOL_THRESHOLDS = Object.freeze({
  minimum_common_sessions_per_symbol: GENERATION5_SOURCE_THRESHOLDS.minimum_common_sessions_per_symbol,
  minimum_yahoo_coverage_of_alpaca_dates: GENERATION5_SOURCE_THRESHOLDS.minimum_yahoo_coverage_of_alpaca_dates,
  risky_minimum_daily_log_return_correlation: GENERATION5_SOURCE_THRESHOLDS.risky_minimum_daily_log_return_correlation,
  risky_maximum_annualized_log_return_tracking_error:
    GENERATION5_SOURCE_THRESHOLDS.risky_maximum_annualized_log_return_tracking_error,
  risky_maximum_median_absolute_daily_log_return_difference_bps:
    GENERATION5_SOURCE_THRESHOLDS.risky_maximum_median_absolute_daily_log_return_difference_bps,
  risky_maximum_p99_absolute_daily_log_return_difference_bps:
    GENERATION5_SOURCE_THRESHOLDS.risky_maximum_p99_absolute_daily_log_return_difference_bps,
  bil_maximum_annualized_mean_log_return_difference_bps:
    GENERATION5_SOURCE_THRESHOLDS.bil_maximum_annualized_mean_log_return_difference_bps,
  bil_maximum_annualized_log_return_tracking_error:
    GENERATION5_SOURCE_THRESHOLDS.bil_maximum_annualized_log_return_tracking_error,
  bil_maximum_median_absolute_daily_log_return_difference_bps:
    GENERATION5_SOURCE_THRESHOLDS.bil_maximum_median_absolute_daily_log_return_difference_bps,
  bil_maximum_p99_absolute_daily_log_return_difference_bps:
    GENERATION5_SOURCE_THRESHOLDS.bil_maximum_p99_absolute_daily_log_return_difference_bps,
});

export const GENERATION6_SOURCE_THRESHOLDS = Object.freeze({
  ...GENERATION6_PER_SYMBOL_THRESHOLDS,
  candidate_minimum_exact_discrete_or_rank_state_agreement: 0.99,
  candidate_maximum_mean_target_weight_l1_difference: 0.02,
  candidate_maximum_p99_target_weight_l1_difference: 0.10,
  candidate_minimum_daily_log_return_correlation: 0.995,
  candidate_maximum_annualized_log_return_tracking_error: 0.02,
  candidate_maximum_absolute_edge_difference_bps_per_year: 50,
});

export const GENERATION6_SOURCE_SIMULATION_OPTIONS = Object.freeze({
  cashSymbol: CASH_SYMBOL,
  lookbackSessions: 252,
  rebalanceIntervalSessions: 21,
  rebalanceAnchor: 0,
  oneWayCostBps: 5,
  annualBorrowSpread: 0.005,
  maximumRiskyGross: 1,
  terminalLiquidation: true,
});

export const GENERATION6_SOURCE_SERIES_CONTRACT = Object.freeze({
  per_symbol_gates: "ORIGINAL_PER_SYMBOL_HISTORIES_WITHOUT_INTERSECTION_COLLAPSE",
  candidate_simulation: "EXACT_ALL_20_SYMBOL_STRATEGY_INTERSECTION_ONLY",
});

function orderedSubset(symbols) {
  const requested = new Set(symbols);
  return Object.freeze(GENERATION6_SOURCE_SYMBOLS.filter((symbol) => requested.has(symbol)));
}

const G4_INPUTS = orderedSubset([CASH_SYMBOL, "QQQ", ...SECTOR_SYMBOLS]);
const RESIDUAL_INPUTS = orderedSubset([CASH_SYMBOL, "SPY", "QQQ", ...SECTOR_SYMBOLS]);
const CROSS_ASSET_INPUTS = orderedSubset([CASH_SYMBOL, ...CROSS_ASSET_SYMBOLS]);

export const GENERATION6_CANDIDATE_REQUIRED_SYMBOLS = Object.freeze({
  g6_trend_guard_g4: G4_INPUTS,
  g6_vol_target_g4: G4_INPUTS,
  g6_breadth_scaled_g4: G4_INPUTS,
  g6_residual_sector: RESIDUAL_INPUTS,
  g6_long_only_tsmom_1_3_12: CROSS_ASSET_INPUTS,
  g6_hrp_trend: CROSS_ASSET_INPUTS,
  g6_equal_evidence_ensemble: GENERATION6_SOURCE_SYMBOLS,
});

function fail(message) {
  throw new Error(message);
}

function finiteAtMost(value, threshold) {
  return Number.isFinite(value) && value <= threshold;
}

function finiteAtLeast(value, threshold) {
  return Number.isFinite(value) && value >= threshold;
}

function assertDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label} is invalid`);
}

function assertSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0 || new Set(symbols).size !== symbols.length) {
    fail("Generation 6 source symbols must be a unique non-empty array");
  }
  for (const symbol of symbols) {
    if (!GENERATION6_SOURCE_SYMBOLS.includes(symbol)) fail(`Generation 6 source symbol ${symbol} is not allowlisted`);
  }
}

export function assertGeneration6PriceSeries(symbol, series, label = "price series") {
  if (!GENERATION6_SOURCE_SYMBOLS.includes(symbol)) fail(`${label} symbol is not allowlisted`);
  if (!Array.isArray(series) || series.length === 0) fail(`${symbol} ${label} is empty`);
  let priorDate = "";
  for (let index = 0; index < series.length; index += 1) {
    const point = series[index];
    if (!point || typeof point !== "object" || Array.isArray(point)) fail(`${symbol} ${label} row ${index} is invalid`);
    assertDate(point.date, `${symbol} ${label} row ${index} date`);
    if (point.date <= priorDate) fail(`${symbol} ${label} dates are duplicated or out of order`);
    if (!Number.isFinite(point.close) || point.close <= 0) fail(`${symbol} ${label} row ${index} close is invalid`);
    priorDate = point.date;
  }
  return series;
}

export function generation6SeriesBySymbolFromPoints(points, symbols = GENERATION6_SOURCE_SYMBOLS) {
  assertSymbols(symbols);
  if (!Array.isArray(points) || points.length === 0) fail("Generation 6 stored panel points are empty");
  const series = Object.fromEntries(symbols.map((symbol) => [symbol, []]));
  let priorDate = "";
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || typeof point !== "object" || Array.isArray(point)) fail(`stored panel row ${index} is invalid`);
    assertDate(point.date, `stored panel row ${index} date`);
    if (point.date <= priorDate) fail("stored panel dates are duplicated or out of order");
    priorDate = point.date;
    for (const symbol of symbols) {
      const close = Number(point[symbol]);
      if (!Number.isFinite(close) || close <= 0) fail(`stored panel has invalid ${symbol} close at ${point.date}`);
      series[symbol].push(Object.freeze({ date: point.date, close }));
    }
  }
  return Object.freeze(Object.fromEntries(symbols.map((symbol) => [
    symbol,
    Object.freeze(series[symbol]),
  ])));
}

function pearson(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  if (!(leftVariance > 0) || !(rightVariance > 0)) return null;
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function alignedLogReturns(leftSeries, rightSeries) {
  const leftMap = new Map(leftSeries.map((point) => [point.date, point.close]));
  const rightMap = new Map(rightSeries.map((point) => [point.date, point.close]));
  const commonDates = [...leftMap.keys()].filter((date) => rightMap.has(date)).sort();
  const left = [];
  const right = [];
  for (let index = 1; index < commonDates.length; index += 1) {
    const prior = commonDates[index - 1];
    const current = commonDates[index];
    left.push(Math.log(leftMap.get(current) / leftMap.get(prior)));
    right.push(Math.log(rightMap.get(current) / rightMap.get(prior)));
  }
  return Object.freeze({ commonDates: Object.freeze(commonDates), left, right });
}

function calculateAlignedLogReturnMetrics(left, right) {
  if (left.length !== right.length) fail("aligned return vectors differ in length");
  const differences = left.map((value, index) => value - right[index]);
  const absoluteDifferences = differences.map(Math.abs);
  const deviation = sampleStandardDeviation(differences);
  const averageDifference = mean(differences);
  return Object.freeze({
    observations: left.length,
    daily_log_return_correlation: pearson(left, right),
    annualized_log_return_tracking_error: Number.isFinite(deviation) ? deviation * Math.sqrt(TRADING_DAYS) : null,
    annualized_mean_log_return_difference_bps: Number.isFinite(averageDifference)
      ? Math.abs(averageDifference) * TRADING_DAYS * 10_000
      : null,
    median_absolute_daily_log_return_difference_bps: quantile(absoluteDifferences, 0.50) * 10_000,
    p99_absolute_daily_log_return_difference_bps: quantile(absoluteDifferences, 0.99) * 10_000,
    maximum_absolute_daily_log_return_difference_bps: absoluteDifferences.length > 0
      ? Math.max(...absoluteDifferences) * 10_000
      : null,
  });
}

function presentMetrics(metrics) {
  return Object.freeze(Object.fromEntries(Object.entries(metrics).map(([key, value]) => [
    key,
    key === "observations" ? value : round(value),
  ])));
}

export function evaluateGeneration6SymbolGates({
  symbol,
  commonSessions,
  yahooCoverageOfAlpaca,
  rawMetrics,
  thresholds = GENERATION6_SOURCE_THRESHOLDS,
}) {
  const shared = {
    minimum_common_sessions: commonSessions >= thresholds.minimum_common_sessions_per_symbol,
    yahoo_covers_alpaca_dates: yahooCoverageOfAlpaca >= thresholds.minimum_yahoo_coverage_of_alpaca_dates,
  };
  return symbol === CASH_SYMBOL
    ? Object.freeze({
      ...shared,
      annualized_mean_log_return_difference: finiteAtMost(
        rawMetrics.annualized_mean_log_return_difference_bps,
        thresholds.bil_maximum_annualized_mean_log_return_difference_bps,
      ),
      annualized_log_return_tracking_error: finiteAtMost(
        rawMetrics.annualized_log_return_tracking_error,
        thresholds.bil_maximum_annualized_log_return_tracking_error,
      ),
      median_absolute_daily_log_return_difference: finiteAtMost(
        rawMetrics.median_absolute_daily_log_return_difference_bps,
        thresholds.bil_maximum_median_absolute_daily_log_return_difference_bps,
      ),
      p99_absolute_daily_log_return_difference: finiteAtMost(
        rawMetrics.p99_absolute_daily_log_return_difference_bps,
        thresholds.bil_maximum_p99_absolute_daily_log_return_difference_bps,
      ),
    })
    : Object.freeze({
      ...shared,
      daily_log_return_correlation: finiteAtLeast(
        rawMetrics.daily_log_return_correlation,
        thresholds.risky_minimum_daily_log_return_correlation,
      ),
      annualized_log_return_tracking_error: finiteAtMost(
        rawMetrics.annualized_log_return_tracking_error,
        thresholds.risky_maximum_annualized_log_return_tracking_error,
      ),
      median_absolute_daily_log_return_difference: finiteAtMost(
        rawMetrics.median_absolute_daily_log_return_difference_bps,
        thresholds.risky_maximum_median_absolute_daily_log_return_difference_bps,
      ),
      p99_absolute_daily_log_return_difference: finiteAtMost(
        rawMetrics.p99_absolute_daily_log_return_difference_bps,
        thresholds.risky_maximum_p99_absolute_daily_log_return_difference_bps,
      ),
    });
}

export function reconcileGeneration6Symbol({
  symbol,
  yahooSeries,
  alpacaAllSeries,
  thresholds = GENERATION6_SOURCE_THRESHOLDS,
}) {
  assertGeneration6PriceSeries(symbol, yahooSeries, "Yahoo adjusted series");
  assertGeneration6PriceSeries(symbol, alpacaAllSeries, "persisted Alpaca all-adjusted series");
  const overlapStart = [yahooSeries[0].date, alpacaAllSeries[0].date].sort().at(-1);
  const overlapEnd = [yahooSeries.at(-1).date, alpacaAllSeries.at(-1).date].sort()[0];
  if (overlapStart > overlapEnd) fail(`${symbol} has no Yahoo/Alpaca-all overlap`);
  const yahooDates = yahooSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd)
    .map((point) => point.date);
  const alpacaDates = alpacaAllSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd)
    .map((point) => point.date);
  const primary = alignedLogReturns(yahooSeries, alpacaAllSeries);
  const rawMetrics = calculateAlignedLogReturnMetrics(primary.left, primary.right);
  const yahooDateSet = new Set(yahooDates);
  const alpacaDateSet = new Set(alpacaDates);
  const commonSessions = primary.commonDates.length;
  const yahooCoverageOfAlpaca = commonSessions / alpacaDates.length;
  const gates = evaluateGeneration6SymbolGates({
    symbol,
    commonSessions,
    yahooCoverageOfAlpaca,
    rawMetrics,
    thresholds,
  });
  return Object.freeze({
    symbol,
    primary_comparison: "Hash-pinned Yahoo adjusted close versus hash-pinned Alpaca IEX adjustment=all",
    overlap_start: overlapStart,
    overlap_end: overlapEnd,
    yahoo_sessions_in_overlap: yahooDates.length,
    alpaca_all_sessions_in_overlap: alpacaDates.length,
    common_sessions: commonSessions,
    yahoo_coverage_of_alpaca_dates: round(yahooCoverageOfAlpaca),
    alpaca_coverage_of_yahoo_dates: round(commonSessions / yahooDates.length),
    yahoo_only_date_count: yahooDates.filter((date) => !alpacaDateSet.has(date)).length,
    alpaca_all_only_date_count: alpacaDates.filter((date) => !yahooDateSet.has(date)).length,
    primary_log_return_metrics: presentMetrics(rawMetrics),
    raw: Object.freeze({
      yahoo_coverage_of_alpaca_dates: yahooCoverageOfAlpaca,
      primary_log_return_metrics: Object.freeze({ ...rawMetrics }),
    }),
    gate_family: symbol === CASH_SYMBOL ? "G5_BIL_NEAR_ZERO_RETURN" : "G5_RISKY_ETF",
    gates,
    passed: Object.values(gates).every(Boolean),
  });
}

function compactSupport(weights, symbols) {
  return symbols.filter((symbol) => symbol !== CASH_SYMBOL && Math.abs(weights[symbol] ?? 0) > WEIGHT_EPSILON);
}

function supportState(weights, symbols) {
  return Object.freeze({
    support: Object.freeze(compactSupport(weights, symbols).sort()),
  });
}

function supportAndWeightRankState(weights, symbols) {
  const support = compactSupport(weights, symbols);
  return Object.freeze({
    support: Object.freeze([...support].sort()),
    descending_target_weight_rank: Object.freeze([...support].sort((left, right) => (
      (weights[right] ?? 0) - (weights[left] ?? 0) || left.localeCompare(right)
    ))),
  });
}

export function generation6DecisionStateSpecification(candidateId) {
  if (candidateId === "g6_hrp_trend") {
    return Object.freeze({
      applicable: true,
      kind: "active_universe_and_descending_target_weight_rank",
      extract: supportAndWeightRankState,
    });
  }
  if ([
    "g6_trend_guard_g4",
    "g6_vol_target_g4",
    "g6_breadth_scaled_g4",
    "g6_residual_sector",
    "g6_long_only_tsmom_1_3_12",
  ].includes(candidateId)) {
    return Object.freeze({
      applicable: true,
      kind: "active_target_universe",
      extract: supportState,
    });
  }
  if (candidateId === "g6_equal_evidence_ensemble") {
    return Object.freeze({
      applicable: false,
      kind: "not_observable_from_blended_target_weights",
      extract: null,
    });
  }
  fail(`no Generation 6 decision-state specification exists for ${candidateId}`);
}

function canonicalWeights(weights, symbols = GENERATION6_SOURCE_SYMBOLS) {
  return Object.freeze(Object.fromEntries(symbols.map((symbol) => [
    symbol,
    round(Number(weights?.[symbol] ?? 0), 10),
  ])));
}

function recordedStrategy(strategy, records, stateSpecification) {
  if (!strategy || typeof strategy.id !== "string" || typeof strategy.decide !== "function") fail("candidate strategy is invalid");
  const wrapper = {
    ...strategy,
    decide(context) {
      const weights = strategy.decide(context);
      const canonical = canonicalWeights(weights);
      records.push(Object.freeze({
        signal_date: context.signalDate,
        canonical_target_weights: canonical,
        discrete_or_rank_state: stateSpecification.applicable
          ? stateSpecification.extract(canonical, GENERATION6_SOURCE_SYMBOLS)
          : null,
      }));
      return weights;
    },
  };
  if (typeof strategy.observe === "function") wrapper.observe = (row) => strategy.observe(row);
  return Object.freeze(wrapper);
}

export function compareGeneration6DecisionRecords(
  yahooRecords,
  alpacaRecords,
  { stateApplicable, stateKind },
) {
  if (!Array.isArray(yahooRecords) || !Array.isArray(alpacaRecords)
    || yahooRecords.length !== alpacaRecords.length || yahooRecords.length === 0) {
    fail("Generation 6 source decision records are empty or length-misaligned");
  }
  const l1Differences = [];
  let exactStateCount = 0;
  for (let index = 0; index < yahooRecords.length; index += 1) {
    const yahoo = yahooRecords[index];
    const alpaca = alpacaRecords[index];
    if (yahoo.signal_date !== alpaca.signal_date) fail(`Generation 6 source decision schedules differ at ${index}`);
    const yahooKeys = Object.keys(yahoo.canonical_target_weights ?? {});
    const alpacaKeys = Object.keys(alpaca.canonical_target_weights ?? {});
    if (JSON.stringify(yahooKeys) !== JSON.stringify(GENERATION6_SOURCE_SYMBOLS)
      || JSON.stringify(alpacaKeys) !== JSON.stringify(GENERATION6_SOURCE_SYMBOLS)) {
      fail("Generation 6 decision record does not contain the canonical 20-symbol vector");
    }
    l1Differences.push(GENERATION6_SOURCE_SYMBOLS.reduce((sum, symbol) => (
      sum + Math.abs(yahoo.canonical_target_weights[symbol] - alpaca.canonical_target_weights[symbol])
    ), 0));
    if (stateApplicable && JSON.stringify(yahoo.discrete_or_rank_state) === JSON.stringify(alpaca.discrete_or_rank_state)) {
      exactStateCount += 1;
    }
  }
  const exactStateAgreement = stateApplicable ? exactStateCount / yahooRecords.length : null;
  return Object.freeze({
    decision_count: yahooRecords.length,
    weight_vector: "All 20 CORE_SYMBOLS, target weights rounded only for canonical recording at 10 decimals.",
    discrete_or_rank_state: Object.freeze({
      applicable: stateApplicable,
      kind: stateKind,
      exact_count: stateApplicable ? exactStateCount : null,
      exact_agreement_fraction: stateApplicable ? round(exactStateAgreement) : null,
    }),
    target_weight_l1_difference: Object.freeze({
      mean: round(mean(l1Differences)),
      p99: round(quantile(l1Differences, 0.99)),
      maximum: round(Math.max(...l1Differences)),
    }),
    raw: Object.freeze({
      exact_state_agreement_fraction: exactStateAgreement,
      mean_target_weight_l1_difference: mean(l1Differences),
      p99_target_weight_l1_difference: quantile(l1Differences, 0.99),
    }),
  });
}

function annualizedLogGrowthFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail("candidate rows are unavailable");
  const growth = rows.reduce((sum, row) => {
    if (!Number.isFinite(row.net_return) || row.net_return <= -1) fail("candidate row has invalid net return");
    return sum + Math.log1p(row.net_return);
  }, 0);
  return growth * TRADING_DAYS / rows.length;
}

function compareSimulationRows(leftRows, rightRows) {
  if (leftRows.length !== rightRows.length || leftRows.some((row, index) => (
    row.execution_return_date !== rightRows[index].execution_return_date
  ))) fail("Generation 6 source simulations are not date-aligned");
  return calculateAlignedLogReturnMetrics(
    leftRows.map((row) => Math.log1p(row.net_return)),
    rightRows.map((row) => Math.log1p(row.net_return)),
  );
}

export function evaluateGeneration6CandidateGates({
  stateApplicable,
  exactStateAgreement,
  meanTargetWeightL1Difference,
  p99TargetWeightL1Difference,
  rawReturnMetrics,
  yahooEdge,
  alpacaEdge,
  thresholds = GENERATION6_SOURCE_THRESHOLDS,
}) {
  return Object.freeze({
    exact_discrete_or_rank_state_agreement: !stateApplicable || finiteAtLeast(
      exactStateAgreement,
      thresholds.candidate_minimum_exact_discrete_or_rank_state_agreement,
    ),
    mean_target_weight_l1_difference: finiteAtMost(
      meanTargetWeightL1Difference,
      thresholds.candidate_maximum_mean_target_weight_l1_difference,
    ),
    p99_target_weight_l1_difference: finiteAtMost(
      p99TargetWeightL1Difference,
      thresholds.candidate_maximum_p99_target_weight_l1_difference,
    ),
    daily_log_return_correlation: finiteAtLeast(
      rawReturnMetrics.daily_log_return_correlation,
      thresholds.candidate_minimum_daily_log_return_correlation,
    ),
    annualized_log_return_tracking_error: finiteAtMost(
      rawReturnMetrics.annualized_log_return_tracking_error,
      thresholds.candidate_maximum_annualized_log_return_tracking_error,
    ),
    candidate_vs_spy_edge_same_sign: Number.isFinite(yahooEdge) && Number.isFinite(alpacaEdge)
      && Math.sign(yahooEdge) === Math.sign(alpacaEdge),
    candidate_vs_spy_edge_difference: finiteAtMost(
      Math.abs(yahooEdge - alpacaEdge) * 10_000,
      thresholds.candidate_maximum_absolute_edge_difference_bps_per_year,
    ),
  });
}

function commonPanelDates(seriesMaps, symbols) {
  return [...seriesMaps[symbols[0]].keys()]
    .filter((date) => symbols.every((symbol) => seriesMaps[symbol].has(date)))
    .sort();
}

function pointsForDates(seriesMaps, symbols, dates) {
  return dates.map((date) => Object.freeze({
    date,
    ...Object.fromEntries(symbols.map((symbol) => [symbol, seriesMaps[symbol].get(date)])),
  }));
}

function spyStrategy() {
  return Object.freeze({
    id: "generation6_source_reconciliation_spy",
    decide() {
      return normalizeLongWeights({ SPY: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function strategyById(createStrategies, id) {
  const strategies = createStrategies();
  if (!Array.isArray(strategies)) fail("Generation 6 strategy factory must return an array");
  const matches = strategies.filter((strategy) => strategy?.id === id);
  if (matches.length !== 1) fail(`Generation 6 strategy ${id} is missing or duplicated`);
  return matches[0];
}

function requiredSymbolsForCandidate(candidateId, requiredSymbolsByCandidateId) {
  const declared = requiredSymbolsByCandidateId[candidateId];
  if (!Array.isArray(declared) || declared.length === 0) fail(`required-symbol registry omits ${candidateId}`);
  assertSymbols(declared);
  return orderedSubset([CASH_SYMBOL, "SPY", ...declared]);
}

function validateSelectedRegistry({ createStrategies, metadata, selectedCandidateIds }) {
  if (typeof createStrategies !== "function" || !metadata || typeof metadata !== "object") {
    fail("Generation 6 strategy factory and metadata are required");
  }
  if (!Array.isArray(selectedCandidateIds) || selectedCandidateIds.length === 0
    || new Set(selectedCandidateIds).size !== selectedCandidateIds.length) {
    fail("Generation 6 selected candidate IDs must be unique and non-empty");
  }
  const strategyIds = createStrategies().map((strategy) => strategy?.id);
  if (new Set(strategyIds).size !== strategyIds.length) fail("Generation 6 strategy IDs are duplicated");
  for (const id of selectedCandidateIds) {
    if (!strategyIds.includes(id)) fail(`selected Generation 6 strategy ${id} is absent`);
    if (metadata[id]?.eligible !== true) fail(`selected Generation 6 strategy ${id} is not eligible`);
  }
}

export function extractGeneration6SelectedCandidates(selectionOutput, allowedCandidateIds) {
  if (selectionOutput?.schema_version !== "finly_quant_champion_generation6.v1") {
    fail("Generation 6 selection-output schema is invalid");
  }
  const tracks = Object.freeze({
    primary_spy: selectionOutput?.selection?.primary_spy_track?.selected_id_before_post_selection_robustness ?? null,
    growth_control_challenge:
      selectionOutput?.selection?.growth_control_challenge_track?.selected_id_before_post_selection_robustness ?? null,
  });
  const selectedCandidateIds = [...new Set(Object.values(tracks).filter((value) => value !== null))];
  if (selectedCandidateIds.length === 0) fail("Generation 6 selection output contains no selected source-reconciliation candidate");
  if (!Array.isArray(allowedCandidateIds) || allowedCandidateIds.length === 0) fail("allowed Generation 6 candidate registry is empty");
  for (const id of selectedCandidateIds) {
    if (!allowedCandidateIds.includes(id)) fail(`Generation 6 selection output names unknown or ineligible candidate ${id}`);
  }
  return Object.freeze({
    tracks,
    selected_candidate_ids: Object.freeze(selectedCandidateIds),
    deduplicated: Object.values(tracks).filter((value) => value !== null).length !== selectedCandidateIds.length,
  });
}

export function compareGeneration6CandidatesAcrossSources({
  yahooSeriesBySymbol,
  alpacaAllSeriesBySymbol,
  createStrategies,
  metadata,
  selectedCandidateIds,
  requiredSymbolsByCandidateId = GENERATION6_CANDIDATE_REQUIRED_SYMBOLS,
  stateSpecificationForCandidate = generation6DecisionStateSpecification,
  thresholds = GENERATION6_SOURCE_THRESHOLDS,
  simulationOptions = GENERATION6_SOURCE_SIMULATION_OPTIONS,
}) {
  validateSelectedRegistry({ createStrategies, metadata, selectedCandidateIds });
  const yahooMaps = Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol) => {
    assertGeneration6PriceSeries(symbol, yahooSeriesBySymbol[symbol], "Yahoo adjusted series");
    return [symbol, new Map(yahooSeriesBySymbol[symbol].map((point) => [point.date, point.close]))];
  }));
  const alpacaMaps = Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol) => {
    assertGeneration6PriceSeries(symbol, alpacaAllSeriesBySymbol[symbol], "persisted Alpaca all-adjusted series");
    return [symbol, new Map(alpacaAllSeriesBySymbol[symbol].map((point) => [point.date, point.close]))];
  }));

  const candidates = Object.fromEntries(selectedCandidateIds.map((id) => {
    const simulationSymbols = requiredSymbolsForCandidate(id, requiredSymbolsByCandidateId);
    const yahooDates = commonPanelDates(yahooMaps, simulationSymbols);
    const alpacaDates = commonPanelDates(alpacaMaps, simulationSymbols);
    const overlapStart = [yahooDates[0], alpacaDates[0]].sort().at(-1);
    const overlapEnd = [yahooDates.at(-1), alpacaDates.at(-1)].sort()[0];
    const alpacaDateSet = new Set(alpacaDates);
    const dates = yahooDates.filter((date) => date >= overlapStart && date <= overlapEnd && alpacaDateSet.has(date));
    if (dates.length < thresholds.minimum_common_sessions_per_symbol) {
      fail(`${id} fully common source panel is shorter than the frozen minimum`);
    }
    const yahooPoints = pointsForDates(yahooMaps, simulationSymbols, dates);
    const alpacaPoints = pointsForDates(alpacaMaps, simulationSymbols, dates);
    const stateSpecification = stateSpecificationForCandidate(id);
    if (!stateSpecification || typeof stateSpecification.applicable !== "boolean"
      || (stateSpecification.applicable && typeof stateSpecification.extract !== "function")) {
      fail(`${id} has an invalid decision-state specification`);
    }
    const yahooDecisions = [];
    const alpacaDecisions = [];
    const yahooStrategy = recordedStrategy(strategyById(createStrategies, id), yahooDecisions, stateSpecification);
    const alpacaStrategy = recordedStrategy(strategyById(createStrategies, id), alpacaDecisions, stateSpecification);
    const yahooSimulation = simulateStrategy(yahooPoints, simulationSymbols, yahooStrategy, simulationOptions);
    const alpacaSimulation = simulateStrategy(alpacaPoints, simulationSymbols, alpacaStrategy, simulationOptions);
    const yahooSpy = simulateStrategy(yahooPoints, simulationSymbols, spyStrategy(), simulationOptions);
    const alpacaSpy = simulateStrategy(alpacaPoints, simulationSymbols, spyStrategy(), simulationOptions);
    const decisions = compareGeneration6DecisionRecords(yahooDecisions, alpacaDecisions, {
      stateApplicable: stateSpecification.applicable,
      stateKind: stateSpecification.kind,
    });
    const rawReturnMetrics = compareSimulationRows(yahooSimulation.rows, alpacaSimulation.rows);
    const yahooEdge = annualizedLogGrowthFromRows(yahooSimulation.rows) - annualizedLogGrowthFromRows(yahooSpy.rows);
    const alpacaEdge = annualizedLogGrowthFromRows(alpacaSimulation.rows) - annualizedLogGrowthFromRows(alpacaSpy.rows);
    const gates = evaluateGeneration6CandidateGates({
      stateApplicable: stateSpecification.applicable,
      exactStateAgreement: decisions.raw.exact_state_agreement_fraction,
      meanTargetWeightL1Difference: decisions.raw.mean_target_weight_l1_difference,
      p99TargetWeightL1Difference: decisions.raw.p99_target_weight_l1_difference,
      rawReturnMetrics,
      yahooEdge,
      alpacaEdge,
      thresholds,
    });
    const observedNonzeroTargetSymbols = orderedSubset([...new Set([
      ...yahooDecisions,
      ...alpacaDecisions,
    ].flatMap((decision) => GENERATION6_SOURCE_SYMBOLS.filter((symbol) => (
      Math.abs(decision.canonical_target_weights[symbol]) > WEIGHT_EPSILON
    ))))]);
    const undeclaredObserved = observedNonzeroTargetSymbols.filter((symbol) => !simulationSymbols.includes(symbol));
    if (undeclaredObserved.length > 0) fail(`${id} produced undeclared target symbols: ${undeclaredObserved.join(", ")}`);
    return [id, Object.freeze({
      id,
      required_symbols: simulationSymbols,
      observed_nonzero_target_symbols: observedNonzeroTargetSymbols,
      common_panel_start: dates[0],
      common_panel_end: dates.at(-1),
      common_panel_sessions: dates.length,
      decision_comparison: decisions,
      return_comparison: presentMetrics(rawReturnMetrics),
      candidate_vs_spy_edge: Object.freeze({
        yahoo_annualized_log_growth_edge: round(yahooEdge),
        alpaca_annualized_log_growth_edge: round(alpacaEdge),
        absolute_edge_difference_bps_per_year: round(Math.abs(yahooEdge - alpacaEdge) * 10_000),
      }),
      raw: Object.freeze({
        return_comparison: Object.freeze({ ...rawReturnMetrics }),
        yahoo_annualized_log_growth_edge: yahooEdge,
        alpaca_annualized_log_growth_edge: alpacaEdge,
      }),
      gates,
      passed: Object.values(gates).every(Boolean),
    })];
  }));
  return Object.freeze({
    selected_candidate_ids: Object.freeze([...selectedCandidateIds]),
    candidates: Object.freeze(candidates),
    passed: Object.values(candidates).every((candidate) => candidate.passed),
  });
}

export function buildGeneration6SourceReconciliation({
  selectionOutput,
  allowedCandidateIds,
  yahooSeriesBySymbol,
  alpacaAllSeriesBySymbol,
  yahooPerSymbolSeriesBySymbol = yahooSeriesBySymbol,
  alpacaPerSymbolSeriesBySymbol = alpacaAllSeriesBySymbol,
  yahooStrategySeriesBySymbol = yahooSeriesBySymbol,
  alpacaStrategySeriesBySymbol = alpacaAllSeriesBySymbol,
  createStrategies,
  metadata,
  requiredSymbolsByCandidateId = GENERATION6_CANDIDATE_REQUIRED_SYMBOLS,
  stateSpecificationForCandidate = generation6DecisionStateSpecification,
  thresholds = GENERATION6_SOURCE_THRESHOLDS,
  simulationOptions = GENERATION6_SOURCE_SIMULATION_OPTIONS,
}) {
  const selection = extractGeneration6SelectedCandidates(selectionOutput, allowedCandidateIds);
  const candidateComparison = compareGeneration6CandidatesAcrossSources({
    yahooSeriesBySymbol: yahooStrategySeriesBySymbol,
    alpacaAllSeriesBySymbol: alpacaStrategySeriesBySymbol,
    createStrategies,
    metadata,
    selectedCandidateIds: selection.selected_candidate_ids,
    requiredSymbolsByCandidateId,
    stateSpecificationForCandidate,
    thresholds,
    simulationOptions,
  });
  // The combined gate covers the complete CORE universe. This includes every
  // selected-candidate input and every SPY/growth-control comparator input,
  // avoiding a pass that silently ignores a failed comparator series.
  const requiredSymbols = GENERATION6_SOURCE_SYMBOLS;
  const requiredSymbolSet = new Set(requiredSymbols);
  const perSymbol = Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol) => {
    const result = reconcileGeneration6Symbol({
      symbol,
      yahooSeries: yahooPerSymbolSeriesBySymbol[symbol],
      alpacaAllSeries: alpacaPerSymbolSeriesBySymbol[symbol],
      thresholds,
    });
    return [symbol, Object.freeze({
      ...result,
      required_for_selected_candidates_or_spy_bil: requiredSymbolSet.has(symbol),
      required_for_combined_generation6_gate: requiredSymbolSet.has(symbol),
      blocks_overall_disposition: requiredSymbolSet.has(symbol) && !result.passed,
    })];
  }));
  const blockingReasons = [
    ...Object.values(perSymbol).filter((result) => result.blocks_overall_disposition)
      .map((result) => `${result.symbol} failed one or more inherited Generation 5 per-symbol source gates`),
    ...Object.values(candidateComparison.candidates).filter((result) => !result.passed)
      .map((result) => `${result.id} failed one or more Generation 6 candidate source-concordance gates`),
  ];
  return Object.freeze({
    schema_version: "finly_generation6_source_overlap_reconciliation_evidence.v1",
    selection,
    required_symbols_for_overall_gate: requiredSymbols,
    all_20_symbols_reported: Object.keys(perSymbol).length === GENERATION6_SOURCE_SYMBOLS.length,
    thresholds,
    simulation_options: simulationOptions,
    source_series_contract: GENERATION6_SOURCE_SERIES_CONTRACT,
    per_symbol: Object.freeze(perSymbol),
    candidate_comparison: candidateComparison,
    passed: blockingReasons.length === 0,
    blocking_reasons: Object.freeze(blockingReasons),
    prior_generation5_boundary: Object.freeze({
      inherited: false,
      statement: "Generation 5's overall FAIL_CLOSED disposition concerned different candidates and is not inherited by a selected Generation 6 candidate. Generation 6 must pass this candidate-specific reconciliation on its own evidence.",
    }),
    claim_boundary: "A pass is hash-pinned cross-provider concordance over already-seen history. It is not untouched out-of-sample evidence, independent alpha, future-profit evidence, options-P&L evidence, or permission for live capital.",
  });
}
