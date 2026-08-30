import { createHash } from "node:crypto";

import {
  aggregateScheduleOffsets,
  CHAMPION_BLOCK_LENGTHS,
  deflatedSharpeAcrossTrials,
  FROZEN_BOOTSTRAP_SEEDS,
  pairedBlockBootstrapSuite,
} from "./champion_statistics.mjs";

const TRADING_DAYS = 252;

export const GENERATION6_CUMULATIVE_TRIALS = 113;
export const GENERATION6_COST_LEVELS_BPS = Object.freeze([5, 10, 25]);
export const GENERATION6_REBALANCE_ANCHORS = Object.freeze(Array.from({ length: 21 }, (_, index) => index));
export const GENERATION6_BLOCK_LENGTHS = CHAMPION_BLOCK_LENGTHS;
export const GENERATION6_BOOTSTRAP_SEEDS = FROZEN_BOOTSTRAP_SEEDS;
export const GENERATION6_BOOTSTRAP_ITERATIONS = 4_999;
export const GENERATION6_VOLATILITY_MATCH_SPECIFICATION = Object.freeze({
  lookback_sessions: 63,
  rebalance_interval_sessions: 21,
  minimum_spy_weight: 0,
  maximum_spy_weight: 1.5,
  base_one_way_cost_bps: 5,
  annual_borrow_spread: 0.005,
  realized_volatility_ratio_minimum: 0.90,
  realized_volatility_ratio_maximum: 1.10,
});
export const GENERATION6_SYSTEMATIC_BETA_DIAGNOSTIC_SPECIFICATION = Object.freeze({
  lookback_sessions: 63,
  rebalance_interval_sessions: 21,
  minimum_beta: 0,
  maximum_beta: 1,
  base_one_way_cost_bps: 5,
});
// Backward-compatible name. The primary risk match is volatility-based; the
// older beta comparator is retained below as an explicitly diagnostic path.
export const GENERATION6_RISK_MATCH_SPECIFICATION = GENERATION6_VOLATILITY_MATCH_SPECIFICATION;

function fail(message) {
  throw new TypeError(message);
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a finite number`);
  return value;
}

function integer(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${path} must be a safe integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    fail(`${path} must contain only letters, numbers, dots, underscores, or hyphens`);
  }
  return value;
}

function calendarDate(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${path} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${path} is invalid`);
  return value;
}

function round(value, places = 12) {
  finiteNumber(value, "rounded value");
  const scale = 10 ** places;
  const result = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function kahanSum(values) {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  return sum;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) fail("mean requires at least one value");
  return kahanSum(values) / values.length;
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) fail("sample standard deviation requires at least two values");
  const average = mean(values);
  return Math.sqrt(kahanSum(values.map((value) => (value - average) ** 2)) / (values.length - 1));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function assertUniqueIds(ids, path, minimum = 1) {
  if (!Array.isArray(ids) || ids.length < minimum) fail(`${path} must contain at least ${minimum} identifier(s)`);
  const normalized = ids.map((id, index) => identifier(id, `${path}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${path} must not contain duplicates`);
  return normalized;
}

function validatePairedRows(rows, ids, minimumRows = 2) {
  const checkedIds = assertUniqueIds(ids, "ids", 1);
  if (!Array.isArray(rows) || rows.length < minimumRows) fail(`rows must contain at least ${minimumRows} observations`);
  let priorDate = "";
  const values = Object.fromEntries(checkedIds.map((id) => [id, []]));
  const dates = [];
  rows.forEach((row, rowIndex) => {
    const date = calendarDate(row?.execution_return_date, `rows[${rowIndex}].execution_return_date`);
    if (date <= priorDate) fail("rows must be strictly chronological");
    priorDate = date;
    dates.push(date);
    for (const id of checkedIds) {
      const value = finiteNumber(row?.strategies?.[id]?.net_return, `rows[${rowIndex}].strategies.${id}.net_return`);
      if (value <= -1) fail(`rows[${rowIndex}].strategies.${id}.net_return must be greater than -1`);
      values[id].push(value);
    }
  });
  return { dates, values };
}

function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical evidence cannot contain a non-finite number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("canonical evidence may contain only JSON-compatible plain objects");
  }
  if (seen.has(value)) fail("canonical evidence cannot contain a cycle");
  seen.add(value);
  const result = Object.fromEntries(Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) fail("canonical evidence cannot contain undefined");
    return [key, canonicalize(value[key], seen)];
  }));
  seen.delete(value);
  return result;
}

export function canonicalEvidenceJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function hashGeneration6RobustnessEvidence(value) {
  return createHash("sha256").update(canonicalEvidenceJson(value)).digest("hex");
}

/**
 * Align already-scored strategy rows into the paired-return shape required by
 * the statistical and risk-matching functions. This function deliberately
 * does not add entry/exit costs; callers must pass rows with the desired
 * standalone-boundary treatment already applied.
 */
export function buildGeneration6PairedRows(rowsById, ids) {
  const checkedIds = assertUniqueIds(ids, "ids", 2);
  if (!rowsById || typeof rowsById !== "object" || Array.isArray(rowsById)) fail("rowsById must be an object");
  const reference = rowsById[checkedIds[0]];
  if (!Array.isArray(reference) || reference.length < 2) fail(`rowsById.${checkedIds[0]} must contain at least two rows`);
  for (const id of checkedIds) {
    if (!Array.isArray(rowsById[id]) || rowsById[id].length !== reference.length) {
      fail(`rowsById.${id} must align exactly with ${checkedIds[0]}`);
    }
  }
  const paired = reference.map((referenceRow, index) => {
    const date = calendarDate(referenceRow.execution_return_date, `rowsById.${checkedIds[0]}[${index}].execution_return_date`);
    const strategies = Object.fromEntries(checkedIds.map((id) => {
      const row = rowsById[id][index];
      if (row?.execution_return_date !== date) fail(`rowsById.${id} is date-misaligned at index ${index}`);
      const netReturn = finiteNumber(row.net_return, `rowsById.${id}[${index}].net_return`);
      if (netReturn <= -1) fail(`rowsById.${id}[${index}].net_return must be greater than -1`);
      return [id, Object.freeze({ net_return: netReturn })];
    }));
    return Object.freeze({ execution_return_date: date, strategies: Object.freeze(strategies) });
  });
  validatePairedRows(paired, checkedIds);
  return Object.freeze(paired);
}

function trailingBeta(candidateExcess, spyExcess) {
  const candidateMean = mean(candidateExcess);
  const spyMean = mean(spyExcess);
  const covariance = kahanSum(candidateExcess.map((value, index) => (
    (value - candidateMean) * (spyExcess[index] - spyMean)
  )));
  const spyVariance = kahanSum(spyExcess.map((value) => (value - spyMean) ** 2));
  return spyVariance > 0 ? covariance / spyVariance : 0;
}

/**
 * Build a systematic-beta SPY/cash diagnostic. This is retained for exposure
 * interpretation and is not the primary volatility-matched risk gate. At
 * return row t, any target beta is estimated only from t-lookback through
 * t-1. The target then earns row t and drifts until the next rebalance.
 */
export function buildCausalSystematicBetaSpyDiagnostic(rows, options = {}) {
  const candidateId = identifier(options.candidateId, "options.candidateId");
  const spyId = identifier(options.spyId ?? "spy_buy_hold", "options.spyId");
  const cashId = identifier(options.cashId ?? "bil_cash", "options.cashId");
  const comparatorId = identifier(
    options.comparatorId ?? `risk_matched_spy_${candidateId}`,
    "options.comparatorId",
  );
  const ids = [candidateId, spyId, cashId];
  if (new Set([...ids, comparatorId]).size !== 4) fail("candidate, SPY, cash, and comparator ids must differ");
  const lookback = integer(
    options.lookbackSessions ?? GENERATION6_SYSTEMATIC_BETA_DIAGNOSTIC_SPECIFICATION.lookback_sessions,
    "options.lookbackSessions",
    2,
    10_000,
  );
  const interval = integer(
    options.rebalanceIntervalSessions
      ?? GENERATION6_SYSTEMATIC_BETA_DIAGNOSTIC_SPECIFICATION.rebalance_interval_sessions,
    "options.rebalanceIntervalSessions",
    1,
    10_000,
  );
  const anchor = integer(options.rebalanceAnchor ?? 0, "options.rebalanceAnchor", 0, interval - 1);
  const minimumBeta = finiteNumber(
    options.minimumBeta ?? GENERATION6_SYSTEMATIC_BETA_DIAGNOSTIC_SPECIFICATION.minimum_beta,
    "options.minimumBeta",
  );
  const maximumBeta = finiteNumber(
    options.maximumBeta ?? GENERATION6_SYSTEMATIC_BETA_DIAGNOSTIC_SPECIFICATION.maximum_beta,
    "options.maximumBeta",
  );
  if (minimumBeta < 0 || maximumBeta < minimumBeta || maximumBeta > 2) fail("risk-match beta bounds are invalid");
  const oneWayCostBps = finiteNumber(
    options.oneWayCostBps
      ?? GENERATION6_SYSTEMATIC_BETA_DIAGNOSTIC_SPECIFICATION.base_one_way_cost_bps,
    "options.oneWayCostBps",
  );
  if (oneWayCostBps < 0 || oneWayCostBps > 1_000) fail("options.oneWayCostBps is invalid");
  const terminalLiquidation = options.terminalLiquidation ?? true;
  if (typeof terminalLiquidation !== "boolean") fail("options.terminalLiquidation must be boolean");
  const { dates, values } = validatePairedRows(rows, ids, lookback + 2);
  const candidate = values[candidateId];
  const spy = values[spyId];
  const cash = values[cashId];
  let spyWeight = 0;
  let cashWeight = 1;
  const output = [];

  for (let index = 0; index < rows.length; index += 1) {
    const scheduled = index >= lookback + anchor && (index - lookback - anchor) % interval === 0;
    let estimatedBeta = null;
    let estimationStartDate = null;
    let estimationEndDate = null;
    let transactionCost = 0;
    let turnoverNotional = 0;
    if (scheduled) {
      const candidateExcess = [];
      const spyExcess = [];
      for (let trailingIndex = index - lookback; trailingIndex < index; trailingIndex += 1) {
        candidateExcess.push(candidate[trailingIndex] - cash[trailingIndex]);
        spyExcess.push(spy[trailingIndex] - cash[trailingIndex]);
      }
      estimatedBeta = Math.max(minimumBeta, Math.min(maximumBeta, trailingBeta(candidateExcess, spyExcess)));
      const targetCashWeight = 1 - estimatedBeta;
      turnoverNotional = Math.abs(estimatedBeta - spyWeight) + Math.abs(targetCashWeight - cashWeight);
      transactionCost = turnoverNotional * oneWayCostBps / 10_000;
      spyWeight = estimatedBeta;
      cashWeight = targetCashWeight;
      estimationStartDate = dates[index - lookback];
      estimationEndDate = dates[index - 1];
    }
    const startSpyWeight = spyWeight;
    const startCashWeight = cashWeight;
    const grossReturn = startSpyWeight * spy[index] + startCashWeight * cash[index];
    const netReturn = grossReturn - transactionCost;
    if (!(1 + grossReturn > 0) || !(1 + netReturn > 0)) fail(`risk-matched comparator has invalid return at ${dates[index]}`);
    const grossMultiplier = 1 + grossReturn;
    spyWeight = startSpyWeight * (1 + spy[index]) / grossMultiplier;
    cashWeight = startCashWeight * (1 + cash[index]) / grossMultiplier;
    output.push({
      execution_return_date: dates[index],
      strategies: {
        [candidateId]: { net_return: candidate[index] },
        [spyId]: { net_return: spy[index] },
        [cashId]: { net_return: cash[index] },
        [comparatorId]: {
          net_return: round(netReturn),
          gross_return: round(grossReturn),
          transaction_cost: round(transactionCost),
          turnover_notional: round(turnoverNotional),
          start_spy_weight: round(startSpyWeight),
          start_cash_weight: round(startCashWeight),
        },
      },
      risk_match: {
        rebalanced: scheduled,
        estimated_beta: estimatedBeta === null ? null : round(estimatedBeta),
        estimation_start_date: estimationStartDate,
        estimation_end_date: estimationEndDate,
        execution_return_date: dates[index],
      },
    });
  }

  if (terminalLiquidation) {
    const last = output.at(-1);
    const liquidationCost = spyWeight * oneWayCostBps / 10_000;
    last.strategies[comparatorId] = {
      ...last.strategies[comparatorId],
      net_return: round(last.strategies[comparatorId].net_return - liquidationCost),
      transaction_cost: round(last.strategies[comparatorId].transaction_cost + liquidationCost),
      turnover_notional: round(last.strategies[comparatorId].turnover_notional + spyWeight),
      terminal_liquidation: true,
      terminal_liquidation_cost: round(liquidationCost),
      terminal_liquidation_notional: round(spyWeight),
    };
  }

  const frozenRows = output.map((row) => deepFreeze(row));
  return deepFreeze({
    schema_version: "finly_generation6_causal_systematic_beta_spy_diagnostic.v1",
    role: "systematic_beta_diagnostic_not_primary_risk_match",
    candidate_id: candidateId,
    spy_id: spyId,
    cash_id: cashId,
    comparator_id: comparatorId,
    observations: frozenRows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    specification: {
      estimator: "trailing OLS beta of candidate-minus-cash on SPY-minus-cash with an intercept",
      lookback_sessions: lookback,
      rebalance_interval_sessions: interval,
      rebalance_anchor: anchor,
      minimum_beta: minimumBeta,
      maximum_beta: maximumBeta,
      one_way_cost_bps_per_absolute_traded_notional: oneWayCostBps,
      terminal_liquidation: terminalLiquidation,
    },
    causality_boundary: "Every beta used for execution return t is estimated only from return rows t-lookback through t-1. No current or future candidate/SPY return enters its weight.",
    interpretation_boundary: "This diagnostic matches trailing systematic SPY beta within the declared long-only bounds. It is not the primary risk-matched gate and does not guarantee equal realized volatility, drawdown, or tail risk.",
    rows: Object.freeze(frozenRows),
  });
}

/**
 * Build the primary causal volatility-matched SPY/BIL comparator. A scheduled
 * target uses only the prior lookback rows: candidate sample volatility divided
 * by SPY-minus-BIL sample volatility, clipped to [0, 1.5]. Negative residual
 * BIL represents borrowing and incurs the same annual 50 bp financing spread
 * used by the champion engine.
 */
export function buildCausalVolatilityMatchedSpyComparator(rows, options = {}) {
  const candidateId = identifier(options.candidateId, "options.candidateId");
  const spyId = identifier(options.spyId ?? "spy_buy_hold", "options.spyId");
  const cashId = identifier(options.cashId ?? "bil_cash", "options.cashId");
  const comparatorId = identifier(
    options.comparatorId ?? `volatility_matched_spy_${candidateId}`,
    "options.comparatorId",
  );
  const ids = [candidateId, spyId, cashId];
  if (new Set([...ids, comparatorId]).size !== 4) fail("candidate, SPY, cash, and comparator ids must differ");
  const lookback = integer(
    options.lookbackSessions ?? GENERATION6_VOLATILITY_MATCH_SPECIFICATION.lookback_sessions,
    "options.lookbackSessions",
    2,
    10_000,
  );
  const interval = integer(
    options.rebalanceIntervalSessions
      ?? GENERATION6_VOLATILITY_MATCH_SPECIFICATION.rebalance_interval_sessions,
    "options.rebalanceIntervalSessions",
    1,
    10_000,
  );
  const anchor = integer(options.rebalanceAnchor ?? 0, "options.rebalanceAnchor", 0, interval - 1);
  const minimumSpyWeight = finiteNumber(
    options.minimumSpyWeight ?? GENERATION6_VOLATILITY_MATCH_SPECIFICATION.minimum_spy_weight,
    "options.minimumSpyWeight",
  );
  const maximumSpyWeight = finiteNumber(
    options.maximumSpyWeight ?? GENERATION6_VOLATILITY_MATCH_SPECIFICATION.maximum_spy_weight,
    "options.maximumSpyWeight",
  );
  if (minimumSpyWeight < 0 || maximumSpyWeight < minimumSpyWeight || maximumSpyWeight > 2) {
    fail("volatility-match SPY-weight bounds are invalid");
  }
  const oneWayCostBps = finiteNumber(
    options.oneWayCostBps ?? GENERATION6_VOLATILITY_MATCH_SPECIFICATION.base_one_way_cost_bps,
    "options.oneWayCostBps",
  );
  if (oneWayCostBps < 0 || oneWayCostBps > 1_000) fail("options.oneWayCostBps is invalid");
  const annualBorrowSpread = finiteNumber(
    options.annualBorrowSpread ?? GENERATION6_VOLATILITY_MATCH_SPECIFICATION.annual_borrow_spread,
    "options.annualBorrowSpread",
  );
  if (annualBorrowSpread < 0 || annualBorrowSpread > 1) fail("options.annualBorrowSpread is invalid");
  const terminalLiquidation = options.terminalLiquidation ?? true;
  if (typeof terminalLiquidation !== "boolean") fail("options.terminalLiquidation must be boolean");
  const { dates, values } = validatePairedRows(rows, ids, lookback + 2);
  const candidate = values[candidateId];
  const spy = values[spyId];
  const cash = values[cashId];
  let spyWeight = 0;
  let cashWeight = 1;
  const output = [];

  for (let index = 0; index < rows.length; index += 1) {
    const scheduled = index >= lookback + anchor && (index - lookback - anchor) % interval === 0;
    let candidateAnnualizedVolatility = null;
    let spyExcessAnnualizedVolatility = null;
    let targetSpyWeight = null;
    let estimationStartDate = null;
    let estimationEndDate = null;
    let transactionCost = 0;
    let turnoverNotional = 0;
    if (scheduled) {
      const candidateTrailing = candidate.slice(index - lookback, index).map((value, offset) => (
        value - cash[index - lookback + offset]
      ));
      const spyExcessTrailing = spy.slice(index - lookback, index).map((value, offset) => (
        value - cash[index - lookback + offset]
      ));
      candidateAnnualizedVolatility = sampleStandardDeviation(candidateTrailing) * Math.sqrt(TRADING_DAYS);
      spyExcessAnnualizedVolatility = sampleStandardDeviation(spyExcessTrailing) * Math.sqrt(TRADING_DAYS);
      const rawTarget = spyExcessAnnualizedVolatility > 0
        ? candidateAnnualizedVolatility / spyExcessAnnualizedVolatility
        : 0;
      targetSpyWeight = Math.max(minimumSpyWeight, Math.min(maximumSpyWeight, rawTarget));
      const targetCashWeight = 1 - targetSpyWeight;
      turnoverNotional = Math.abs(targetSpyWeight - spyWeight) + Math.abs(targetCashWeight - cashWeight);
      transactionCost = turnoverNotional * oneWayCostBps / 10_000;
      spyWeight = targetSpyWeight;
      cashWeight = targetCashWeight;
      estimationStartDate = dates[index - lookback];
      estimationEndDate = dates[index - 1];
    }
    const startSpyWeight = spyWeight;
    const startCashWeight = cashWeight;
    const grossReturn = startSpyWeight * spy[index] + startCashWeight * cash[index];
    const financingSpreadCost = Math.max(0, -startCashWeight) * annualBorrowSpread / TRADING_DAYS;
    const netReturn = grossReturn - transactionCost - financingSpreadCost;
    if (!(1 + grossReturn > 0) || !(1 + netReturn > 0)) {
      fail(`volatility-matched comparator has invalid return at ${dates[index]}`);
    }
    const grossMultiplier = 1 + grossReturn;
    spyWeight = startSpyWeight * (1 + spy[index]) / grossMultiplier;
    cashWeight = startCashWeight * (1 + cash[index]) / grossMultiplier;
    output.push({
      execution_return_date: dates[index],
      strategies: {
        [candidateId]: { net_return: candidate[index] },
        [spyId]: { net_return: spy[index] },
        [cashId]: { net_return: cash[index] },
        [comparatorId]: {
          net_return: round(netReturn),
          gross_return: round(grossReturn),
          transaction_cost: round(transactionCost),
          financing_spread_cost: round(financingSpreadCost),
          turnover_notional: round(turnoverNotional),
          start_spy_weight: round(startSpyWeight),
          start_cash_weight: round(startCashWeight),
        },
      },
      volatility_match: {
        rebalanced: scheduled,
        candidate_annualized_sample_volatility:
          candidateAnnualizedVolatility === null ? null : round(candidateAnnualizedVolatility),
        spy_minus_bil_annualized_sample_volatility:
          spyExcessAnnualizedVolatility === null ? null : round(spyExcessAnnualizedVolatility),
        target_spy_weight: targetSpyWeight === null ? null : round(targetSpyWeight),
        estimation_start_date: estimationStartDate,
        estimation_end_date: estimationEndDate,
        execution_return_date: dates[index],
      },
    });
  }

  if (terminalLiquidation) {
    const last = output.at(-1);
    const liquidationCost = Math.abs(spyWeight) * oneWayCostBps / 10_000;
    last.strategies[comparatorId] = {
      ...last.strategies[comparatorId],
      net_return: round(last.strategies[comparatorId].net_return - liquidationCost),
      transaction_cost: round(last.strategies[comparatorId].transaction_cost + liquidationCost),
      turnover_notional: round(last.strategies[comparatorId].turnover_notional + Math.abs(spyWeight)),
      terminal_liquidation: true,
      terminal_liquidation_cost: round(liquidationCost),
      terminal_liquidation_notional: round(Math.abs(spyWeight)),
    };
  }

  const frozenRows = output.map((row) => deepFreeze(row));
  return deepFreeze({
    schema_version: "finly_generation6_causal_volatility_matched_spy.v1",
    role: "primary_risk_matched_gate",
    candidate_id: candidateId,
    spy_id: spyId,
    cash_id: cashId,
    comparator_id: comparatorId,
    observations: frozenRows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    specification: {
      estimator: "prior-window candidate-minus-BIL sample volatility divided by prior-window SPY-minus-BIL sample volatility",
      annualization_sessions: TRADING_DAYS,
      lookback_sessions: lookback,
      rebalance_interval_sessions: interval,
      rebalance_anchor: anchor,
      minimum_spy_weight: minimumSpyWeight,
      maximum_spy_weight: maximumSpyWeight,
      residual_asset: cashId,
      one_way_cost_bps_per_absolute_traded_notional: oneWayCostBps,
      annual_borrow_spread: annualBorrowSpread,
      terminal_liquidation: terminalLiquidation,
    },
    causality_boundary: "Every target used for execution return t is estimated only from return rows t-lookback through t-1. No current or future candidate, SPY, or BIL return enters its weight.",
    financing_boundary: "A target SPY weight above one creates negative residual BIL; the comparator pays BIL plus the declared annual borrowing spread, with the spread charged daily on start-of-return borrowing.",
    interpretation_boundary: "This targets trailing realized volatility under a clipped, discretely rebalanced SPY/BIL implementation. It cannot force ex-post volatility equality or match drawdown and tail risk.",
    rows: Object.freeze(frozenRows),
  });
}

function pathMetrics(values) {
  const logGrowth = kahanSum(values.map((value) => Math.log1p(value)));
  const annualizedLogGrowth = logGrowth * TRADING_DAYS / values.length;
  const volatility = sampleStandardDeviation(values) * Math.sqrt(TRADING_DAYS);
  let wealth = 1;
  let peak = 1;
  let maximumDrawdown = 0;
  for (const value of values) {
    wealth *= 1 + value;
    peak = Math.max(peak, wealth);
    maximumDrawdown = Math.min(maximumDrawdown, wealth / peak - 1);
  }
  return {
    total_return: round(Math.expm1(logGrowth)),
    annualized_log_growth: round(annualizedLogGrowth),
    annualized_volatility: round(volatility),
    maximum_drawdown: round(maximumDrawdown),
  };
}

export function assessCausalSystematicBetaSpyDiagnostic(evidence, options = {}) {
  if (evidence?.schema_version !== "finly_generation6_causal_systematic_beta_spy_diagnostic.v1") {
    fail("systematic-beta diagnostic evidence schema is invalid");
  }
  const { candidate_id: candidateId, comparator_id: comparatorId, rows } = evidence;
  const full = validatePairedRows(rows, [candidateId, comparatorId], 2);
  const firstEstimatedRow = rows.find((row) => row.risk_match.rebalanced);
  if (!firstEstimatedRow) fail("risk-matched evidence has no trailing estimate");
  const scoringStartDate = options.scoringStartDate === undefined
    ? firstEstimatedRow.execution_return_date
    : calendarDate(options.scoringStartDate, "options.scoringStartDate");
  const scoringEndDate = options.scoringEndDate === undefined
    ? full.dates.at(-1)
    : calendarDate(options.scoringEndDate, "options.scoringEndDate");
  if (scoringStartDate > scoringEndDate) fail("risk-matched scoring dates are inverted");
  const scoringRows = rows.filter((row) => (
    row.execution_return_date >= scoringStartDate && row.execution_return_date <= scoringEndDate
  ));
  const { dates, values } = validatePairedRows(scoringRows, [candidateId, comparatorId], 2);
  const candidateMetrics = pathMetrics(values[candidateId]);
  const comparatorMetrics = pathMetrics(values[comparatorId]);
  const rebalances = scoringRows.filter((row) => row.risk_match.rebalanced);
  const causal = rebalances.every((row) => (
    row.risk_match.estimation_end_date < row.execution_return_date
      && row.risk_match.estimation_start_date <= row.risk_match.estimation_end_date
  ));
  const bounds = rebalances.every((row) => (
    row.risk_match.estimated_beta >= evidence.specification.minimum_beta
      && row.risk_match.estimated_beta <= evidence.specification.maximum_beta
  ));
  const edge = candidateMetrics.annualized_log_growth - comparatorMetrics.annualized_log_growth;
  const gates = {
    at_least_one_trailing_estimate: rebalances.length > 0,
    every_estimate_precedes_its_earned_return: causal,
    every_estimate_respects_frozen_beta_bounds: bounds,
    candidate_annualized_log_growth_strictly_exceeds_risk_matched_spy: edge > 0,
  };
  return deepFreeze({
    schema_version: "finly_generation6_causal_systematic_beta_spy_diagnostic_assessment.v1",
    role: "systematic_beta_diagnostic_not_primary_risk_match",
    candidate_id: candidateId,
    comparator_id: comparatorId,
    observations: rows.length,
    scored_observations: scoringRows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    rebalance_estimates: rebalances.length,
    candidate_metrics: candidateMetrics,
    comparator_metrics: comparatorMetrics,
    annualized_log_growth_edge: round(edge),
    realized_annualized_volatility_ratio: comparatorMetrics.annualized_volatility > 0
      ? round(candidateMetrics.annualized_volatility / comparatorMetrics.annualized_volatility)
      : null,
    gates,
    passes: Object.values(gates).every(Boolean),
    scoring_boundary: "The diagnostic is warmed on all earlier supplied rows, but metrics use only the declared scoring dates. By default scoring begins with the first causal beta estimate, so an uninvested warmup cannot create a false candidate edge.",
    interpretation: "A positive edge here is descriptive evidence beyond a causally beta-scaled SPY/cash path under the same cost convention. This is not the primary risk-matched gate or proof of alpha or future profitability.",
  });
}

// Compatibility aliases for the original scaffold API. New integrations
// should use the explicitly named systematic-beta diagnostic exports above.
export const buildCausalRiskMatchedSpyComparator = buildCausalSystematicBetaSpyDiagnostic;
export const assessCausalRiskMatchedSpyComparator = assessCausalSystematicBetaSpyDiagnostic;

export function assessCausalVolatilityMatchedSpyComparator(evidence, options = {}) {
  if (evidence?.schema_version !== "finly_generation6_causal_volatility_matched_spy.v1") {
    fail("volatility-matched evidence schema is invalid");
  }
  const { candidate_id: candidateId, comparator_id: comparatorId, rows } = evidence;
  const full = validatePairedRows(rows, [candidateId, comparatorId], 2);
  const firstEstimatedRow = rows.find((row) => row.volatility_match.rebalanced);
  if (!firstEstimatedRow) fail("volatility-matched evidence has no trailing estimate");
  const scoringStartDate = options.scoringStartDate === undefined
    ? firstEstimatedRow.execution_return_date
    : calendarDate(options.scoringStartDate, "options.scoringStartDate");
  const scoringEndDate = options.scoringEndDate === undefined
    ? full.dates.at(-1)
    : calendarDate(options.scoringEndDate, "options.scoringEndDate");
  if (scoringStartDate > scoringEndDate) fail("volatility-matched scoring dates are inverted");
  const minimumVolatilityRatio = finiteNumber(
    options.minimumRealizedVolatilityRatio
      ?? GENERATION6_VOLATILITY_MATCH_SPECIFICATION.realized_volatility_ratio_minimum,
    "options.minimumRealizedVolatilityRatio",
  );
  const maximumVolatilityRatio = finiteNumber(
    options.maximumRealizedVolatilityRatio
      ?? GENERATION6_VOLATILITY_MATCH_SPECIFICATION.realized_volatility_ratio_maximum,
    "options.maximumRealizedVolatilityRatio",
  );
  if (minimumVolatilityRatio <= 0 || maximumVolatilityRatio < minimumVolatilityRatio) {
    fail("realized-volatility ratio bounds are invalid");
  }
  if (minimumVolatilityRatio
      !== GENERATION6_VOLATILITY_MATCH_SPECIFICATION.realized_volatility_ratio_minimum
    || maximumVolatilityRatio
      !== GENERATION6_VOLATILITY_MATCH_SPECIFICATION.realized_volatility_ratio_maximum) {
    fail("Generation 6 realized-volatility ratio bounds must remain 0.90 through 1.10");
  }
  const scoringRows = rows.filter((row) => (
    row.execution_return_date >= scoringStartDate && row.execution_return_date <= scoringEndDate
  ));
  const { dates, values } = validatePairedRows(scoringRows, [candidateId, comparatorId], 2);
  const candidateMetrics = pathMetrics(values[candidateId]);
  const comparatorMetrics = pathMetrics(values[comparatorId]);
  const estimatesAvailableByScoringEnd = rows.filter((row) => (
    row.execution_return_date <= scoringEndDate && row.volatility_match.rebalanced
  ));
  const estimatesInScoringWindow = scoringRows.filter((row) => row.volatility_match.rebalanced);
  const causal = estimatesAvailableByScoringEnd.every((row) => (
    row.volatility_match.estimation_end_date < row.execution_return_date
      && row.volatility_match.estimation_start_date <= row.volatility_match.estimation_end_date
  ));
  const bounds = estimatesAvailableByScoringEnd.every((row) => (
    row.volatility_match.target_spy_weight >= evidence.specification.minimum_spy_weight
      && row.volatility_match.target_spy_weight <= evidence.specification.maximum_spy_weight
  ));
  const edge = candidateMetrics.annualized_log_growth - comparatorMetrics.annualized_log_growth;
  const volatilityRatio = comparatorMetrics.annualized_volatility > 0
    ? candidateMetrics.annualized_volatility / comparatorMetrics.annualized_volatility
    : null;
  const gates = {
    scoring_starts_after_first_causal_estimate:
      scoringStartDate >= firstEstimatedRow.execution_return_date,
    at_least_one_trailing_estimate_available_by_scoring_end:
      estimatesAvailableByScoringEnd.length > 0,
    every_available_estimate_precedes_its_earned_return: causal,
    every_available_target_respects_frozen_spy_weight_bounds: bounds,
    candidate_annualized_log_growth_strictly_exceeds_volatility_matched_spy: edge > 0,
    realized_candidate_to_comparator_volatility_ratio_at_least_0_90:
      volatilityRatio !== null && volatilityRatio >= minimumVolatilityRatio,
    realized_candidate_to_comparator_volatility_ratio_at_most_1_10:
      volatilityRatio !== null && volatilityRatio <= maximumVolatilityRatio,
  };
  return deepFreeze({
    schema_version: "finly_generation6_causal_volatility_matched_spy_assessment.v1",
    role: "primary_risk_matched_gate",
    candidate_id: candidateId,
    comparator_id: comparatorId,
    observations: rows.length,
    scored_observations: scoringRows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    estimates_available_by_scoring_end: estimatesAvailableByScoringEnd.length,
    estimates_in_scoring_window: estimatesInScoringWindow.length,
    candidate_metrics: candidateMetrics,
    comparator_metrics: comparatorMetrics,
    annualized_log_growth_edge: round(edge),
    realized_candidate_to_comparator_volatility_ratio:
      volatilityRatio === null ? null : round(volatilityRatio),
    realized_volatility_ratio_gate: {
      minimum: minimumVolatilityRatio,
      maximum: maximumVolatilityRatio,
    },
    gates,
    passes: Object.values(gates).every(Boolean),
    scoring_boundary: "The comparator is warmed on all supplied rows before scoring. Metrics use only the explicit scoring dates and do not create artificial entry or exit trades at slice boundaries.",
    interpretation: "Passing requires positive annualized log-growth edge and ex-post candidate/comparator volatility within the frozen 0.90-1.10 band. It remains retrospective evidence, not proof of alpha or future profitability.",
  });
}

export function assessCausalVolatilityMatchedSpySlices(evidence, slices) {
  if (!slices || typeof slices !== "object" || Array.isArray(slices)) fail("slices must be an object");
  const required = ["development", "validation"];
  const keys = Object.keys(slices).sort();
  if (keys.length !== required.length || !required.every((key) => keys.includes(key))) {
    fail("slices must contain exactly development and validation");
  }
  const assessments = Object.fromEntries(required.map((sliceId) => {
    const slice = slices[sliceId];
    if (!slice || typeof slice !== "object" || Array.isArray(slice)) fail(`slices.${sliceId} must be an object`);
    return [sliceId, assessCausalVolatilityMatchedSpyComparator(evidence, {
      scoringStartDate: slice.start,
      scoringEndDate: slice.end,
    })];
  }));
  const specification = evidence?.specification;
  const frozenSpecificationMatches = specification?.annualization_sessions === TRADING_DAYS
    && specification?.lookback_sessions
      === GENERATION6_VOLATILITY_MATCH_SPECIFICATION.lookback_sessions
    && specification?.rebalance_interval_sessions
      === GENERATION6_VOLATILITY_MATCH_SPECIFICATION.rebalance_interval_sessions
    && specification?.rebalance_anchor === 0
    && specification?.minimum_spy_weight
      === GENERATION6_VOLATILITY_MATCH_SPECIFICATION.minimum_spy_weight
    && specification?.maximum_spy_weight
      === GENERATION6_VOLATILITY_MATCH_SPECIFICATION.maximum_spy_weight
    && specification?.one_way_cost_bps_per_absolute_traded_notional
      === GENERATION6_VOLATILITY_MATCH_SPECIFICATION.base_one_way_cost_bps
    && specification?.annual_borrow_spread
      === GENERATION6_VOLATILITY_MATCH_SPECIFICATION.annual_borrow_spread
    && specification?.terminal_liquidation === true;
  const gates = {
    frozen_primary_specification_matches: frozenSpecificationMatches,
    development_primary_risk_match_passes: assessments.development.passes,
    validation_primary_risk_match_passes: assessments.validation.passes,
  };
  return deepFreeze({
    schema_version: "finly_generation6_causal_volatility_matched_spy_slice_assessment.v1",
    role: "primary_risk_matched_gate",
    required_slices: required,
    assessments,
    gates,
    passes: Object.values(gates).every(Boolean),
    interpretation: "Promotion requires the frozen growth and 0.90-1.10 realized-volatility gates to pass independently in both predeclared slices.",
  });
}

export function buildGeneration6StatisticalEvidence(rows, candidateIds, fixedCandidateId, options = {}) {
  const candidates = assertUniqueIds(candidateIds, "candidateIds", 2);
  const fixed = identifier(fixedCandidateId, "fixedCandidateId");
  if (!candidates.includes(fixed)) fail("fixedCandidateId must name a supplied candidate");
  const benchmarkId = identifier(options.benchmarkId ?? "spy_buy_hold", "options.benchmarkId");
  const cumulativeTrialCount = integer(
    options.cumulativeTrialCount ?? GENERATION6_CUMULATIVE_TRIALS,
    "options.cumulativeTrialCount",
    candidates.length,
    1_000_000_000,
  );
  if (cumulativeTrialCount !== GENERATION6_CUMULATIVE_TRIALS) {
    fail(`Generation 6 cumulative trial count must remain ${GENERATION6_CUMULATIVE_TRIALS}`);
  }
  const iterations = integer(
    options.iterations ?? GENERATION6_BOOTSTRAP_ITERATIONS,
    "options.iterations",
    100,
    100_000,
  );
  validatePairedRows(rows, [...candidates, benchmarkId], 60);
  const deflated = deflatedSharpeAcrossTrials(rows, candidates, {
    benchmarkId,
    fixedCandidateId: fixed,
    cumulativeTrialCount,
    periodsPerYear: TRADING_DAYS,
  });
  const bootstrap = pairedBlockBootstrapSuite(rows, candidates, {
    benchmarkId,
    fixedCandidateId: fixed,
    iterations,
    seeds: GENERATION6_BOOTSTRAP_SEEDS,
  });
  const correction = {};
  for (const method of ["circular", "moving"]) {
    correction[method] = Object.fromEntries(GENERATION6_BLOCK_LENGTHS.map((blockLength) => {
      const evidence = bootstrap.evidence[method][blockLength];
      const raw = evidence.fixed_candidate_one_sided_p_value;
      const adjusted = Math.min(1, raw * cumulativeTrialCount);
      return [String(blockLength), Object.freeze({
        raw_fixed_candidate_one_sided_p_value: raw,
        current_batch_max_statistic_adjusted_p_value: evidence.fixed_candidate_familywise_adjusted_p_value,
        cumulative_113_trial_bonferroni_adjusted_p_value: round(adjusted),
        passes_cumulative_113_trial_5_percent_gate: adjusted <= 0.05,
      })];
    }));
  }
  const correctionTests = Object.values(correction).flatMap((method) => Object.values(method));
  const minimumAttainableRawPValue = 1 / (iterations + 1);
  const minimumAttainableAdjustedPValue = Math.min(
    1,
    minimumAttainableRawPValue * cumulativeTrialCount,
  );
  const gates = {
    bootstrap_resolution_can_resolve_cumulative_113_trial_5_percent_gate:
      minimumAttainableAdjustedPValue <= 0.05,
    deflated_sharpe_probability_at_least_95_percent:
      deflated.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark >= 0.95,
    all_six_cumulative_113_trial_bonferroni_p_values_at_most_5_percent:
      correctionTests.every((item) => item.passes_cumulative_113_trial_5_percent_gate),
  };
  return deepFreeze({
    schema_version: "finly_generation6_statistical_robustness.v1",
    candidate_ids: candidates,
    fixed_candidate_id: fixed,
    benchmark_id: benchmarkId,
    cumulative_effective_trials: cumulativeTrialCount,
    observations: rows.length,
    bootstrap_iterations_per_test: iterations,
    bootstrap_resolution: {
      add_one_p_value_correction: true,
      minimum_attainable_raw_p_value: round(minimumAttainableRawPValue),
      minimum_attainable_cumulative_113_trial_bonferroni_adjusted_p_value:
        round(minimumAttainableAdjustedPValue),
    },
    block_lengths_sessions: [...GENERATION6_BLOCK_LENGTHS],
    fixed_seeds: GENERATION6_BOOTSTRAP_SEEDS,
    deflated_sharpe: deflated,
    paired_block_bootstrap: bootstrap,
    cumulative_trial_familywise_correction: {
      method: "Bonferroni correction of each fixed-candidate one-sided paired-block-bootstrap p-value across all 113 disclosed effective trials",
      evidence: correction,
      boundary: "The current-batch maximum-statistic p-value is also reported, but returns for all prior trials are unavailable. Bonferroni over the raw fixed-candidate p-value is the conservative familywise correction that can cover all 113 declared trials without inventing their return paths.",
    },
    assumptions: [
      "Daily paired arithmetic returns are candidate net return minus SPY net return on the identical date.",
      "Circular and moving block lengths are fixed at 5, 20, and 60 sessions and use the frozen seeds recorded here.",
      "The DSR expected-maximum correction uses 113 cumulative effective trials; its trial-Sharpe mean and dispersion can only be estimated from the supplied Generation 6 candidate family.",
      "Validation data were consumed by model development, so these procedures penalize dependence and multiple testing but do not recreate a pristine holdout.",
    ],
    gates,
    passes: Object.values(gates).every(Boolean),
  });
}

function validateSensitivityRecord(record, index, dimension, expectedValue, candidateId, benchmarkId) {
  if (!record || typeof record !== "object" || Array.isArray(record)) fail(`${dimension}Records[${index}] must be an object`);
  if (record.candidate_id !== candidateId) fail(`${dimension}Records[${index}] candidate mismatch`);
  if (record.benchmark_id !== benchmarkId) fail(`${dimension}Records[${index}] benchmark mismatch`);
  if (record[dimension] !== expectedValue) fail(`${dimension}Records[${index}] ${dimension} mismatch`);
  return {
    development_edge: finiteNumber(
      record.development_spy_annualized_log_growth_edge,
      `${dimension}Records[${index}].development_spy_annualized_log_growth_edge`,
    ),
    validation_edge: finiteNumber(
      record.validation_spy_annualized_log_growth_edge,
      `${dimension}Records[${index}].validation_spy_annualized_log_growth_edge`,
    ),
  };
}

export function assessGeneration6CostSensitivity(records, options = {}) {
  const candidateId = identifier(options.candidateId, "options.candidateId");
  const benchmarkId = identifier(options.benchmarkId ?? "spy_buy_hold", "options.benchmarkId");
  const minimumEdge = finiteNumber(options.minimumAnnualizedLogGrowthEdge ?? 0, "options.minimumAnnualizedLogGrowthEdge");
  if (!Array.isArray(records)) fail("records must be an array");
  const byCost = new Map();
  for (const record of records) {
    if (byCost.has(record?.cost_bps)) fail(`duplicate cost record ${record?.cost_bps}`);
    byCost.set(record?.cost_bps, record);
  }
  const missing = GENERATION6_COST_LEVELS_BPS.filter((cost) => !byCost.has(cost));
  const unexpected = [...byCost.keys()].filter((cost) => !GENERATION6_COST_LEVELS_BPS.includes(cost));
  const evidence = Object.fromEntries(GENERATION6_COST_LEVELS_BPS.map((cost, index) => {
    const record = byCost.get(cost);
    if (!record) return [String(cost), null];
    const values = validateSensitivityRecord(record, index, "cost_bps", cost, candidateId, benchmarkId);
    const gates = {
      development_edge_exceeds_minimum: values.development_edge > minimumEdge,
      validation_edge_exceeds_minimum: values.validation_edge > minimumEdge,
    };
    return [String(cost), {
      development_spy_annualized_log_growth_edge: round(values.development_edge),
      validation_spy_annualized_log_growth_edge: round(values.validation_edge),
      gates,
      passes: Object.values(gates).every(Boolean),
    }];
  }));
  const complete = missing.length === 0 && unexpected.length === 0 && records.length === GENERATION6_COST_LEVELS_BPS.length;
  return deepFreeze({
    schema_version: "finly_generation6_cost_sensitivity.v1",
    candidate_id: candidateId,
    benchmark_id: benchmarkId,
    required_cost_levels_bps: [...GENERATION6_COST_LEVELS_BPS],
    minimum_annualized_log_growth_edge: minimumEdge,
    complete_coverage: complete,
    missing_cost_levels_bps: missing,
    unexpected_cost_levels_bps: unexpected,
    evidence,
    passes: complete && Object.values(evidence).every((item) => item?.passes === true),
  });
}

export function assessGeneration6AnchorSensitivity(records, options = {}) {
  const candidateId = identifier(options.candidateId, "options.candidateId");
  const benchmarkId = identifier(options.benchmarkId ?? "spy_buy_hold", "options.benchmarkId");
  const minimumEdge = finiteNumber(options.minimumAnnualizedLogGrowthEdge ?? 0, "options.minimumAnnualizedLogGrowthEdge");
  if (!Array.isArray(records)) fail("records must be an array");
  const byAnchor = new Map();
  for (const record of records) {
    if (byAnchor.has(record?.rebalance_anchor)) fail(`duplicate rebalance anchor ${record?.rebalance_anchor}`);
    byAnchor.set(record?.rebalance_anchor, record);
  }
  const normalized = GENERATION6_REBALANCE_ANCHORS.flatMap((anchor, index) => {
    const record = byAnchor.get(anchor);
    if (!record) return [];
    const values = validateSensitivityRecord(record, index, "rebalance_anchor", anchor, candidateId, benchmarkId);
    return [{
      offset: anchor,
      metrics: {
        development_spy_annualized_log_growth_edge: values.development_edge,
        validation_spy_annualized_log_growth_edge: values.validation_edge,
      },
      gates: {
        development_edge_exceeds_minimum: values.development_edge > minimumEdge,
        validation_edge_exceeds_minimum: values.validation_edge > minimumEdge,
      },
    }];
  });
  const aggregation = normalized.length > 0
    ? aggregateScheduleOffsets(normalized, { expectedOffsets: GENERATION6_REBALANCE_ANCHORS })
    : null;
  const missing = GENERATION6_REBALANCE_ANCHORS.filter((anchor) => !byAnchor.has(anchor));
  const unexpected = [...byAnchor.keys()].filter((anchor) => !GENERATION6_REBALANCE_ANCHORS.includes(anchor));
  const complete = missing.length === 0 && unexpected.length === 0 && records.length === GENERATION6_REBALANCE_ANCHORS.length;
  return deepFreeze({
    schema_version: "finly_generation6_rebalance_anchor_sensitivity.v1",
    candidate_id: candidateId,
    benchmark_id: benchmarkId,
    required_rebalance_anchors: [...GENERATION6_REBALANCE_ANCHORS],
    minimum_annualized_log_growth_edge: minimumEdge,
    complete_coverage: complete,
    missing_rebalance_anchors: missing,
    unexpected_rebalance_anchors: unexpected,
    aggregation,
    passes: complete && aggregation?.all_gates_pass_across_every_expected_offset === true,
  });
}

export function summarizeGeneration6PostSelectionRobustness({
  statistical,
  costSensitivity,
  anchorSensitivity,
  riskMatchedSpy,
  sourceReconciliationPasses,
}) {
  if (typeof sourceReconciliationPasses !== "boolean") fail("sourceReconciliationPasses must be boolean");
  const components = {
    statistical: statistical?.passes === true,
    cost_sensitivity: costSensitivity?.passes === true,
    rebalance_anchor_sensitivity: anchorSensitivity?.passes === true,
    causal_volatility_matched_spy_both_slices:
      riskMatchedSpy?.schema_version
        === "finly_generation6_causal_volatility_matched_spy_slice_assessment.v1"
      && riskMatchedSpy?.passes === true,
    independent_source_reconciliation: sourceReconciliationPasses,
  };
  const core = deepFreeze({
    schema_version: "finly_generation6_post_selection_robustness_summary.v1",
    components,
    passes: Object.values(components).every(Boolean),
    failure_reasons: Object.entries(components).filter(([, passes]) => !passes).map(([name]) => name),
    claim_boundary: "Passing is a predeclared retrospective robustness disposition. It is not a guarantee of future profit, pristine out-of-sample evidence, exact options P&L, or proof of superiority over unreproducible competitors.",
  });
  return deepFreeze({ ...core, deterministic_payload_sha256: hashGeneration6RobustnessEvidence(core) });
}
