import { sha256 } from "./canonical.mjs";

export const ECONOMIC_RESEARCH_PROTOCOL = Object.freeze({
  schema_version: "finly_economic_research_protocol.v1",
  symbol: "SPY",
  bar_source: "Alpaca SIP historical daily bars",
  cash_proxy: "BIL adjusted daily return",
  adjustment: "all",
  requested_start: "2016-01-01",
  requested_end: "2026-08-28",
  development_start: "2017-01-01",
  training_end: "2021-12-31",
  validation_start: "2022-01-01",
  validation_end: "2024-12-31",
  final_holdout_start: "2025-01-01",
  final_holdout_end: "2026-08-28",
  execution_lag: "signal at adjusted close t; rebalance at adjusted close t+1; exposure first earns adjusted close-to-close return t+1 to t+2",
  rebalance_frequency: "every five market sessions",
  cash_return_assumption: "observed adjusted BIL close-to-close return; no synthetic interest rate",
  one_way_turnover_cost_bps_per_traded_leg: 1,
  target_annualized_volatility: 0.10,
  maximum_gross_exposure: 1,
  leverage_allowed: false,
  shorting_allowed_by_selected_policy: false,
  economic_candidate_count: 6,
  selectable_candidate_count: 1,
  diagnostic_candidate_count: 5,
  preregistered_candidate_id: "tsmom_ensemble_vol",
  preregistered_candidate_definition: "Equal-weight positive-trend fraction across 21-, 63-, and 252-session SPY-minus-BIL return horizons, multiplied by an unlevered 10% 20-session SPY realized-volatility target; unallocated exposure earns the observed BIL return.",
  selection_rule: "The preregistered candidate is fixed from the cited literature before economic results are computed. It proceeds to the final holdout only if validation return and BIL-excess Sharpe are positive, validation has at least 252 observations, average exposure is at least 5%, and it has either lower volatility or shallower drawdown than buy-and-hold. All other candidates are diagnostics and cannot be selected.",
  holdout_rule: "The preregistered candidate ID and validation gate are instantiated in a hashed selection receipt before the dated final holdout is sliced or scored.",
  claim_boundary: "A positive historical holdout is evidence about this fixed sample and cost model, not proof of durable alpha, live options profitability, or future returns.",
});

export const ECONOMIC_CANDIDATES = Object.freeze([
  Object.freeze({ id: "buy_hold", label: "SPY buy-and-hold baseline", kind: "buy_hold" }),
  Object.freeze({ id: "vol_target_long", label: "Long-only 20-session volatility target", kind: "vol_target_long" }),
  Object.freeze({ id: "tsmom_12m_vol", label: "Long-only 12-month trend plus volatility target", kind: "tsmom_12m_vol" }),
  Object.freeze({ id: "tsmom_ensemble_vol", label: "Long-only multi-horizon trend plus volatility target", kind: "tsmom_ensemble_vol" }),
  Object.freeze({ id: "tsmom_majority_vol", label: "Long-only majority trend plus volatility target", kind: "tsmom_majority_vol" }),
  Object.freeze({ id: "finly_5_20_signed", label: "Existing Finly 5/20-session signed trend diagnostic", kind: "finly_5_20_signed" }),
]);

function round(value, places = 8) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function dateFromTimestamp(timestamp) {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError("daily bar timestamp is invalid");
  return parsed.toISOString().slice(0, 10);
}

function requirePrice(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${label} must be positive and finite`);
  return number;
}

export function validateAdjustedDailyBars(bars) {
  if (!Array.isArray(bars) || bars.length < 300) throw new TypeError("economic research requires at least 300 daily bars");
  let priorTimestamp = -Infinity;
  return bars.map((bar, index) => {
    if (!bar || typeof bar !== "object" || Array.isArray(bar)) throw new TypeError(`daily bar ${index} must be an object`);
    const timestamp = Date.parse(bar.t);
    if (!Number.isFinite(timestamp) || timestamp <= priorTimestamp) throw new TypeError("daily bars must be strictly chronological");
    priorTimestamp = timestamp;
    return Object.freeze({
      date: dateFromTimestamp(bar.t),
      close: requirePrice(bar.c, `daily bar ${index} close`),
    });
  });
}

function excessReturn(points, startIndex, endIndex) {
  if (startIndex < 0 || endIndex >= points.length || startIndex >= endIndex) return null;
  const spy = Math.log(points[endIndex].close / points[startIndex].close);
  const cash = Math.log(points[endIndex].cash_close / points[startIndex].cash_close);
  return spy - cash;
}

function realizedVolatility(dailyReturns, endIndex, lookback = 20) {
  if (endIndex - lookback + 1 < 0) return null;
  const values = dailyReturns.slice(endIndex - lookback + 1, endIndex + 1);
  const sigma = sampleStandardDeviation(values);
  return sigma === null ? null : sigma * Math.sqrt(252);
}

function cappedVolatilityScale(volatility, targetVolatility) {
  if (!Number.isFinite(volatility) || volatility <= 0) return 0;
  return Math.min(1, targetVolatility / volatility);
}

function sign(value) {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function candidateExposure(candidate, context) {
  const { points, dailyReturns, signalIndex, targetVolatility } = context;
  const volatility = realizedVolatility(dailyReturns, signalIndex - 1, 20);
  const scale = cappedVolatilityScale(volatility, targetVolatility);
  if (candidate.kind === "buy_hold") return 1;
  if (candidate.kind === "vol_target_long") return scale;
  if (candidate.kind === "tsmom_12m_vol") {
    const momentum = excessReturn(points, signalIndex - 252, signalIndex);
    return momentum !== null && momentum > 0 ? scale : 0;
  }
  if (candidate.kind === "tsmom_ensemble_vol" || candidate.kind === "tsmom_majority_vol") {
    const momenta = [21, 63, 252].map((lookback) => excessReturn(points, signalIndex - lookback, signalIndex));
    if (momenta.some((value) => value === null)) return 0;
    const positiveFraction = momenta.filter((value) => value > 0).length / momenta.length;
    return candidate.kind === "tsmom_ensemble_vol"
      ? positiveFraction * scale
      : (positiveFraction >= (2 / 3) ? scale : 0);
  }
  if (candidate.kind === "finly_5_20_signed") {
    if (signalIndex < 20 || volatility === null) return 0;
    const recentReturns = dailyReturns.slice(signalIndex - 20, signalIndex);
    const sigma = Math.max(sampleStandardDeviation(recentReturns) ?? 0, 0.001);
    const momentum5 = recentReturns.slice(-5).reduce((sum, value) => sum + Math.log1p(value), 0);
    const momentum20 = recentReturns.reduce((sum, value) => sum + Math.log1p(value), 0);
    const blendedZ = 0.65 * momentum5 / (sigma * Math.sqrt(5)) + 0.35 * momentum20 / (sigma * Math.sqrt(20));
    const score = Math.tanh(blendedZ / 2);
    return Math.abs(score) >= 0.18 ? sign(score) * scale : 0;
  }
  throw new TypeError(`unsupported economic candidate: ${candidate.kind}`);
}

export function buildEconomicReturnRows(bars, {
  cashBars,
  candidates = ECONOMIC_CANDIDATES,
  targetVolatility = ECONOMIC_RESEARCH_PROTOCOL.target_annualized_volatility,
  oneWayTurnoverCostBps = ECONOMIC_RESEARCH_PROTOCOL.one_way_turnover_cost_bps_per_traded_leg,
} = {}) {
  const spyPoints = validateAdjustedDailyBars(bars);
  const cashPoints = validateAdjustedDailyBars(cashBars);
  const cashByDate = new Map(cashPoints.map((point) => [point.date, point.close]));
  const points = spyPoints.map((point) => {
    const cashClose = cashByDate.get(point.date);
    if (!Number.isFinite(cashClose)) throw new TypeError(`cash proxy omits SPY session ${point.date}`);
    return Object.freeze({ ...point, cash_close: cashClose });
  });
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError("economic candidates are required");
  if (!Number.isFinite(targetVolatility) || targetVolatility <= 0 || targetVolatility > 1) throw new TypeError("target volatility is invalid");
  if (!Number.isFinite(oneWayTurnoverCostBps) || oneWayTurnoverCostBps < 0 || oneWayTurnoverCostBps > 100) throw new TypeError("turnover cost is invalid");
  const dailyReturns = points.slice(1).map((point, index) => point.close / points[index].close - 1);
  const priorExposures = new Map(candidates.map((candidate) => [candidate.id, 0]));
  const rows = [];
  for (let signalIndex = 252; signalIndex < points.length - 2; signalIndex += 1) {
    const nextReturn = points[signalIndex + 2].close / points[signalIndex + 1].close - 1;
    const nextCashReturn = points[signalIndex + 2].cash_close / points[signalIndex + 1].cash_close - 1;
    const rebalance = (signalIndex - 252) % 5 === 0;
    const strategies = {};
    for (const candidate of candidates) {
      const priorExposure = priorExposures.get(candidate.id) ?? 0;
      const exposure = rebalance
        ? candidateExposure(candidate, { points, dailyReturns, signalIndex, targetVolatility })
        : priorExposure;
      const turnover = Math.abs(exposure - priorExposure);
      const cashExposure = Math.max(0, 1 - Math.abs(exposure));
      const transactionCost = turnover * 2 * oneWayTurnoverCostBps / 10_000;
      const grossReturn = exposure * nextReturn + cashExposure * nextCashReturn;
      strategies[candidate.id] = Object.freeze({
        exposure: round(exposure),
        cash_exposure: round(cashExposure),
        turnover: round(turnover),
        gross_return: round(grossReturn),
        transaction_cost: round(transactionCost),
        net_return: round(grossReturn - transactionCost),
      });
      priorExposures.set(candidate.id, exposure);
    }
    rows.push(Object.freeze({
      signal_date: points[signalIndex].date,
      rebalance_date: points[signalIndex + 1].date,
      execution_return_date: points[signalIndex + 2].date,
      rebalanced: rebalance,
      underlying_return: round(nextReturn),
      cash_return: round(nextCashReturn),
      strategies: Object.freeze(strategies),
    }));
  }
  return Object.freeze(rows);
}

function maximumDrawdown(returns) {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity / peak - 1);
  }
  return drawdown;
}

function calendarYearReturns(rows, candidateId) {
  const years = new Map();
  for (const row of rows) {
    const year = row.execution_return_date.slice(0, 4);
    const current = years.get(year) ?? 1;
    years.set(year, current * (1 + row.strategies[candidateId].net_return));
  }
  return Object.fromEntries([...years.entries()].map(([year, growth]) => [year, round(growth - 1)]));
}

export function calculateEconomicMetrics(rows, candidateId) {
  if (!Array.isArray(rows) || rows.length < 2) throw new TypeError("economic metrics require at least two rows");
  const records = rows.map((row) => row.strategies?.[candidateId]);
  if (records.some((record) => !record)) throw new TypeError(`economic rows omit candidate ${candidateId}`);
  const returns = records.map((record) => record.net_return);
  const grossReturns = records.map((record) => record.gross_return);
  const excessReturns = rows.map((row, index) => returns[index] - row.cash_return);
  const growth = returns.reduce((value, item) => value * (1 + item), 1);
  const grossGrowth = grossReturns.reduce((value, item) => value * (1 + item), 1);
  const bilGrowth = rows.reduce((value, row) => value * (1 + row.cash_return), 1);
  const annualizedReturn = growth ** (252 / rows.length) - 1;
  const drawdown = maximumDrawdown(returns);
  const average = mean(returns);
  const averageExcess = mean(excessReturns);
  const dailyVolatility = sampleStandardDeviation(returns);
  const dailyExcessVolatility = sampleStandardDeviation(excessReturns);
  const downside = excessReturns.filter((value) => value < 0);
  const downsideDeviation = downside.length > 0 ? Math.sqrt(mean(downside.map((value) => value ** 2))) : null;
  const turnover = records.reduce((sum, record) => sum + record.turnover, 0);
  const costs = records.reduce((sum, record) => sum + record.transaction_cost, 0);
  const positiveYears = calendarYearReturns(rows, candidateId);
  const yearlyValues = Object.values(positiveYears);
  return Object.freeze({
    observations: rows.length,
    start_date: rows[0].execution_return_date,
    end_date: rows.at(-1).execution_return_date,
    total_return: round(growth - 1),
    gross_total_return: round(grossGrowth - 1),
    bil_total_return: round(bilGrowth - 1),
    total_return_minus_bil: round(growth - bilGrowth),
    annualized_return: round(annualizedReturn),
    annualized_volatility: round(dailyVolatility === null ? null : dailyVolatility * Math.sqrt(252)),
    annualized_total_return_to_volatility: round(dailyVolatility && dailyVolatility > 0 ? average / dailyVolatility * Math.sqrt(252) : null),
    bil_excess_sharpe: round(dailyExcessVolatility && dailyExcessVolatility > 0 ? averageExcess / dailyExcessVolatility * Math.sqrt(252) : null),
    bil_excess_sortino: round(downsideDeviation && downsideDeviation > 0 ? averageExcess / downsideDeviation * Math.sqrt(252) : null),
    maximum_drawdown: round(drawdown),
    calmar_ratio: round(drawdown < 0 ? annualizedReturn / Math.abs(drawdown) : null),
    average_exposure: round(mean(records.map((record) => record.exposure))),
    average_bil_exposure: round(mean(records.map((record) => record.cash_exposure))),
    maximum_absolute_exposure: round(Math.max(...records.map((record) => Math.abs(record.exposure)))),
    cumulative_turnover: round(turnover),
    modeled_cost_drag_simple_sum: round(costs),
    positive_day_fraction: round(returns.filter((value) => value > 0).length / returns.length),
    calendar_year_returns: positiveYears,
    positive_calendar_year_fraction: round(yearlyValues.filter((value) => value > 0).length / yearlyValues.length),
  });
}

export function rowsWithin(rows, start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    throw new TypeError("economic range is invalid");
  }
  return rows.filter((row) => row.execution_return_date >= start && row.execution_return_date <= end);
}

export function selectEconomicCandidate(validationMetrics, {
  baselineId = "buy_hold",
  candidates = ECONOMIC_CANDIDATES,
  fixedCandidateId = ECONOMIC_RESEARCH_PROTOCOL.preregistered_candidate_id,
} = {}) {
  const baseline = validationMetrics?.[baselineId];
  if (!baseline) throw new TypeError("validation baseline metrics are required");
  const considered = candidates.filter((candidate) => candidate.id !== baselineId).map((candidate) => {
    const metrics = validationMetrics[candidate.id];
    if (!metrics) throw new TypeError(`validation metrics omit ${candidate.id}`);
    const qualifies = metrics.observations >= 252
      && metrics.total_return > 0
      && metrics.bil_excess_sharpe > 0
      && metrics.average_exposure >= 0.05
      && (metrics.annualized_volatility < baseline.annualized_volatility || metrics.maximum_drawdown > baseline.maximum_drawdown);
    return { id: candidate.id, label: candidate.label, qualifies, metrics };
  });
  const fixed = considered.find((item) => item.id === fixedCandidateId);
  if (!fixed) throw new TypeError("preregistered economic candidate is missing");
  return Object.freeze({
    preregistered_id: fixedCandidateId,
    selected_id: fixed.qualifies ? fixed.id : null,
    selected_label: fixed.qualifies ? fixed.label : null,
    diagnostic_qualifiers: considered.filter((item) => item.qualifies).map((item) => item.id),
    candidate_qualification: Object.fromEntries(considered.map((item) => [item.id, item.qualifies])),
    selection_failed_closed: !fixed.qualifies,
  });
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function blockBootstrapTerminalReturns(rows, candidateId, {
  iterations = 2_000,
  blockLength = 20,
  seed = 20_260_829,
} = {}) {
  if (!Number.isInteger(iterations) || iterations < 100 || iterations > 100_000) throw new TypeError("bootstrap iterations are invalid");
  if (!Number.isInteger(blockLength) || blockLength < 1 || blockLength > rows.length) throw new TypeError("bootstrap block length is invalid");
  const returns = rows.map((row) => row.strategies?.[candidateId]?.net_return);
  if (returns.some((value) => !Number.isFinite(value))) throw new TypeError("bootstrap candidate returns are incomplete");
  const random = mulberry32(seed);
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let growth = 1;
    let count = 0;
    while (count < returns.length) {
      const start = Math.floor(random() * returns.length);
      for (let offset = 0; offset < blockLength && count < returns.length; offset += 1) {
        growth *= 1 + returns[(start + offset) % returns.length];
        count += 1;
      }
    }
    samples.push(growth - 1);
  }
  samples.sort((left, right) => left - right);
  return Object.freeze({
    method: "deterministic circular block bootstrap of daily net returns",
    iterations,
    block_length_sessions: blockLength,
    seed,
    terminal_return_p05: round(quantile(samples, 0.05)),
    terminal_return_p50: round(quantile(samples, 0.50)),
    terminal_return_p95: round(quantile(samples, 0.95)),
    positive_terminal_return_fraction: round(samples.filter((value) => value > 0).length / samples.length),
  });
}

export function rollingWindowEvidence(rows, candidateId, windowSessions = 252) {
  if (!Number.isInteger(windowSessions) || windowSessions < 20 || windowSessions > rows.length) throw new TypeError("rolling window is invalid");
  const windows = [];
  for (let end = windowSessions - 1; end < rows.length; end += 1) {
    const slice = rows.slice(end - windowSessions + 1, end + 1);
    const growth = slice.reduce((value, row) => value * (1 + row.strategies[candidateId].net_return), 1);
    windows.push({ start_date: slice[0].execution_return_date, end_date: slice.at(-1).execution_return_date, return: round(growth - 1) });
  }
  return Object.freeze({
    window_sessions: windowSessions,
    window_count: windows.length,
    positive_window_fraction: round(windows.filter((window) => window.return > 0).length / windows.length),
    worst_window_return: round(Math.min(...windows.map((window) => window.return))),
    median_window_return: round(quantile(windows.map((window) => window.return).sort((left, right) => left - right), 0.5)),
    best_window_return: round(Math.max(...windows.map((window) => window.return))),
  });
}

export function calendarQuarterFoldEvidence(rows, candidateId, { start, end } = {}) {
  const relevant = start && end ? rowsWithin(rows, start, end) : rows;
  if (relevant.length < 20) throw new TypeError("quarter-fold evidence requires at least twenty rows");
  const groups = new Map();
  for (const row of relevant) {
    const date = new Date(`${row.execution_return_date}T00:00:00.000Z`);
    const key = `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const folds = [...groups.entries()].filter(([, foldRows]) => foldRows.length >= 20).map(([id, foldRows]) => ({
    id,
    metrics: calculateEconomicMetrics(foldRows, candidateId),
  }));
  if (folds.length === 0) throw new TypeError("quarter-fold evidence has no complete folds");
  const returns = folds.map((fold) => fold.metrics.total_return);
  const positiveLogs = returns.filter((value) => value > 0).map((value) => Math.log1p(value));
  const totalPositiveLogReturn = positiveLogs.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    fold_definition: "calendar quarters with at least twenty scored sessions",
    fold_count: folds.length,
    positive_fold_fraction: round(returns.filter((value) => value > 0).length / folds.length),
    median_fold_return: round(quantile([...returns].sort((left, right) => left - right), 0.5)),
    worst_fold_return: round(Math.min(...returns)),
    best_fold_return: round(Math.max(...returns)),
    largest_positive_fold_share: round(totalPositiveLogReturn > 0 ? Math.max(...positiveLogs) / totalPositiveLogReturn : null),
    folds,
  });
}

export function economicDatasetFingerprint(bars) {
  const points = validateAdjustedDailyBars(bars);
  return sha256(points.map((point) => [point.date, point.close]));
}

export const CURRENT_ECONOMIC_DECISION_PROTOCOL = Object.freeze({
  schema_version: "finly_current_economic_decision_protocol.v1",
  policy_id: ECONOMIC_RESEARCH_PROTOCOL.preregistered_candidate_id,
  symbols: Object.freeze(["SPY", "BIL"]),
  trend_horizons_sessions: Object.freeze([21, 63, 252]),
  volatility_lookback_sessions: 20,
  target_annualized_volatility: ECONOMIC_RESEARCH_PROTOCOL.target_annualized_volatility,
  rebalance_interval_sessions: 5,
  maximum_spy_weight: 1,
  minimum_spy_weight: 0,
  remaining_weight_asset: "BIL",
  execution_timing: "proposal may be evaluated for the next available market session after the decision timestamp",
  authorization_scope: "allocation_research_only",
  broker_mutation_authorized: false,
});

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, keys, label) {
  requirePlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function requireCanonicalTimestamp(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be an ISO-8601 timestamp string`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO-8601 UTC timestamp`);
  }
  return parsed.toISOString();
}

function normalizeCompletedSessionBoundary(boundary, sourceAvailableAt, decisionTimestamp) {
  requireExactKeys(boundary, [
    "sessionDate",
    "marketCloseAt",
    "eligibleAt",
    "availabilityDelayMinutes",
  ], "completedSessionBoundary");
  if (typeof boundary.sessionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(boundary.sessionDate)) {
    throw new TypeError("completedSessionBoundary.sessionDate must be an ISO calendar date");
  }
  const calendarDate = new Date(`${boundary.sessionDate}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== boundary.sessionDate) {
    throw new TypeError("completedSessionBoundary.sessionDate is invalid");
  }
  const marketCloseAt = requireCanonicalTimestamp(boundary.marketCloseAt, "completedSessionBoundary.marketCloseAt");
  const eligibleAt = requireCanonicalTimestamp(boundary.eligibleAt, "completedSessionBoundary.eligibleAt");
  if (!Number.isInteger(boundary.availabilityDelayMinutes)
    || boundary.availabilityDelayMinutes < 1
    || boundary.availabilityDelayMinutes > 120) {
    throw new TypeError("completedSessionBoundary.availabilityDelayMinutes must be an integer from 1 to 120");
  }
  const expectedEligible = new Date(
    new Date(marketCloseAt).getTime() + boundary.availabilityDelayMinutes * 60_000,
  ).toISOString();
  if (eligibleAt !== expectedEligible) throw new TypeError("completedSessionBoundary eligibility timestamp is inconsistent");
  if (eligibleAt > sourceAvailableAt || sourceAvailableAt > decisionTimestamp) {
    throw new TypeError("completedSessionBoundary is outside the source-availability boundary");
  }
  return Object.freeze({
    session_date: boundary.sessionDate,
    market_close_at: marketCloseAt,
    eligible_at: eligibleAt,
    availability_delay_minutes: boundary.availabilityDelayMinutes,
  });
}

function normalizeCurrentBars(bars, label, completedSessionDate) {
  if (!Array.isArray(bars) || bars.length < 253) {
    throw new TypeError(`${label} requires at least 253 adjusted daily bars`);
  }
  let priorTimestamp = -Infinity;
  let priorDate = null;
  return bars.map((bar, index) => {
    requirePlainObject(bar, `${label} bar ${index}`);
    if (typeof bar.t !== "string") throw new TypeError(`${label} bar ${index} timestamp must be a string`);
    const timestamp = new Date(bar.t);
    if (!Number.isFinite(timestamp.getTime())) throw new TypeError(`${label} bar ${index} timestamp is invalid`);
    if (timestamp.getTime() <= priorTimestamp) throw new TypeError(`${label} bars must be strictly chronological`);
    if (typeof bar.c !== "number" || !Number.isFinite(bar.c) || bar.c <= 0) {
      throw new TypeError(`${label} bar ${index} close must be a positive finite number`);
    }
    const observedAt = timestamp.toISOString();
    const date = observedAt.slice(0, 10);
    if (date > completedSessionDate) {
      throw new TypeError(`${label} contains an incomplete session after the completed-session boundary`);
    }
    if (date === priorDate) throw new TypeError(`${label} must contain at most one bar per UTC date`);
    priorTimestamp = timestamp.getTime();
    priorDate = date;
    return Object.freeze({ date, observed_at: observedAt, close: bar.c });
  });
}

function normalizeCurrentAllocation(currentAllocation) {
  requireExactKeys(currentAllocation, ["spyWeight", "bilWeight"], "currentAllocation");
  const { spyWeight, bilWeight } = currentAllocation;
  if (![spyWeight, bilWeight].every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("currentAllocation weights must be finite numbers");
  }
  if (spyWeight < 0 || spyWeight > 1 || bilWeight < 0 || bilWeight > 1) {
    throw new TypeError("currentAllocation weights must be between zero and one");
  }
  if (Math.abs(spyWeight + bilWeight - 1) > 1e-10) {
    throw new TypeError("currentAllocation weights must sum to one");
  }
  return Object.freeze({ spy_weight: round(spyWeight), bil_weight: round(bilWeight) });
}

function receipt(body) {
  return Object.freeze({ ...body, receipt_sha256: sha256(body) });
}

/**
 * Compute the fixed economic policy from information explicitly available at a
 * point in time. This function is pure: it fetches nothing, submits nothing,
 * and returns no broker-compatible payload or authorization.
 */
export function buildCurrentEconomicDecision(input) {
  requireExactKeys(input, [
    "spyBars",
    "cashBars",
    "decisionTimestamp",
    "sourceAvailableAt",
    "completedSessionBoundary",
    "currentAllocation",
    "lastRebalanceDate",
  ], "current economic decision input");
  const decisionTimestamp = requireCanonicalTimestamp(input.decisionTimestamp, "decisionTimestamp");
  const sourceAvailableAt = requireCanonicalTimestamp(input.sourceAvailableAt, "sourceAvailableAt");
  if (sourceAvailableAt > decisionTimestamp) throw new TypeError("sourceAvailableAt cannot follow decisionTimestamp");
  const completedSessionBoundary = normalizeCompletedSessionBoundary(
    input.completedSessionBoundary,
    sourceAvailableAt,
    decisionTimestamp,
  );
  const spyPoints = normalizeCurrentBars(input.spyBars, "SPY", completedSessionBoundary.session_date);
  const cashPoints = normalizeCurrentBars(input.cashBars, "BIL", completedSessionBoundary.session_date);
  if (spyPoints.length !== cashPoints.length) throw new TypeError("SPY and BIL bars must contain identical sessions");
  for (let index = 0; index < spyPoints.length; index += 1) {
    if (spyPoints[index].date !== cashPoints[index].date) {
      throw new TypeError(`SPY and BIL session ${index} is not aligned`);
    }
  }
  const currentAllocation = normalizeCurrentAllocation(input.currentAllocation);
  if (input.lastRebalanceDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.lastRebalanceDate)) {
    throw new TypeError("lastRebalanceDate must be null or an ISO calendar date");
  }

  const points = spyPoints.map((point, index) => Object.freeze({
    ...point,
    cash_close: cashPoints[index].close,
  }));
  const signalIndex = points.length - 1;
  const dailyReturns = points.slice(1).map((point, index) => point.close / points[index].close - 1);
  const horizonReturns = CURRENT_ECONOMIC_DECISION_PROTOCOL.trend_horizons_sessions.map((lookback) => Object.freeze({
    sessions: lookback,
    spy_minus_bil_log_return: round(excessReturn(points, signalIndex - lookback, signalIndex), 12),
  }));
  const positiveTrendFraction = horizonReturns.filter((item) => item.spy_minus_bil_log_return > 0).length / horizonReturns.length;
  const annualizedVolatility = realizedVolatility(dailyReturns, signalIndex - 1, CURRENT_ECONOMIC_DECISION_PROTOCOL.volatility_lookback_sessions);
  const volatilityScale = cappedVolatilityScale(
    annualizedVolatility,
    CURRENT_ECONOMIC_DECISION_PROTOCOL.target_annualized_volatility,
  );
  const indicatedSpyWeight = positiveTrendFraction * volatilityScale;
  const latestDate = points[signalIndex].date;
  let sessionsSinceLastRebalance = null;
  if (input.lastRebalanceDate !== null) {
    const lastIndex = points.findIndex((point) => point.date === input.lastRebalanceDate);
    if (lastIndex < 0) throw new TypeError("lastRebalanceDate must identify an aligned input session");
    if (lastIndex > signalIndex) throw new TypeError("lastRebalanceDate cannot follow the latest session");
    sessionsSinceLastRebalance = signalIndex - lastIndex;
  }
  const rebalanceDue = sessionsSinceLastRebalance === null
    || sessionsSinceLastRebalance >= CURRENT_ECONOMIC_DECISION_PROTOCOL.rebalance_interval_sessions;
  const proposedAllocation = rebalanceDue
    ? Object.freeze({ spy_weight: round(indicatedSpyWeight), bil_weight: round(1 - indicatedSpyWeight) })
    : null;
  const body = {
    schema_version: "finly_current_economic_decision.v1",
    protocol_sha256: sha256(CURRENT_ECONOMIC_DECISION_PROTOCOL),
    policy_id: CURRENT_ECONOMIC_DECISION_PROTOCOL.policy_id,
    decision_timestamp: decisionTimestamp,
    source_available_at: sourceAvailableAt,
    latest_observation: Object.freeze({
      session_date: latestDate,
      spy_observed_at: spyPoints[signalIndex].observed_at,
      bil_observed_at: cashPoints[signalIndex].observed_at,
      aligned_session_count: points.length,
      timestamp_semantics: "daily bar timestamp is a session label, not an availability timestamp",
      completed_session_boundary: completedSessionBoundary,
    }),
    point_in_time_controls: Object.freeze({
      future_observations_rejected: true,
      source_availability_precedes_decision: sourceAvailableAt <= decisionTimestamp,
      sessions_exactly_aligned: true,
      incomplete_current_session_rejected: true,
      daily_bar_timestamp_not_used_as_availability: true,
    }),
    signal: Object.freeze({
      horizon_returns: Object.freeze(horizonReturns),
      positive_trend_fraction: round(positiveTrendFraction),
      realized_volatility_20_session_annualized: round(annualizedVolatility),
      volatility_target_scale: round(volatilityScale),
      indicated_spy_weight: round(indicatedSpyWeight),
      indicated_bil_weight: round(1 - indicatedSpyWeight),
    }),
    schedule: Object.freeze({
      rebalance_interval_sessions: CURRENT_ECONOMIC_DECISION_PROTOCOL.rebalance_interval_sessions,
      last_rebalance_date: input.lastRebalanceDate,
      sessions_since_last_rebalance: sessionsSinceLastRebalance,
      rebalance_due: rebalanceDue,
    }),
    current_allocation: currentAllocation,
    decision: rebalanceDue ? "PROPOSE_REBALANCE" : "NO_TRADE",
    proposed_allocation: proposedAllocation,
    authorization: Object.freeze({
      scope: CURRENT_ECONOMIC_DECISION_PROTOCOL.authorization_scope,
      broker_mutation_authorized: false,
      order_payload: null,
    }),
  };
  return receipt(body);
}

function validateCurrentDecisionReceipt(baseDecision) {
  requirePlainObject(baseDecision, "baseDecision");
  if (baseDecision.schema_version !== "finly_current_economic_decision.v1") {
    throw new TypeError("baseDecision schema is invalid");
  }
  const { receipt_sha256: receiptSha256, ...body } = baseDecision;
  if (receiptSha256 !== sha256(body)) throw new TypeError("baseDecision receipt hash is invalid");
  if (baseDecision.authorization?.broker_mutation_authorized !== false
    || baseDecision.authorization?.order_payload !== null) {
    throw new TypeError("baseDecision crosses the research-only authorization boundary");
  }
  if (baseDecision.point_in_time_controls?.incomplete_current_session_rejected !== true
    || baseDecision.point_in_time_controls?.daily_bar_timestamp_not_used_as_availability !== true
    || baseDecision.latest_observation?.completed_session_boundary?.eligible_at > baseDecision.source_available_at) {
    throw new TypeError("baseDecision has no valid completed-session availability boundary");
  }
  if (baseDecision.decision === "PROPOSE_REBALANCE") {
    const weight = baseDecision.proposed_allocation?.spy_weight;
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new TypeError("baseDecision SPY weight is invalid");
  } else if (baseDecision.decision !== "NO_TRADE") {
    throw new TypeError("baseDecision decision is invalid");
  }
}

function validateEconomicRiskCommitteeReceipt(committeeDecision, baseDecision) {
  requirePlainObject(committeeDecision, "committeeDecision");
  if (committeeDecision.schema_version !== "finly_economic_risk_committee_receipt.v1") {
    throw new TypeError("committeeDecision schema is invalid");
  }
  const { receipt_sha256: receiptSha256, ...body } = committeeDecision;
  if (receiptSha256 !== sha256(body)) throw new TypeError("committeeDecision receipt hash is invalid");
  if (committeeDecision.base_receipt_sha256 !== baseDecision.receipt_sha256) {
    throw new TypeError("committeeDecision is not bound to baseDecision");
  }
  if (committeeDecision.authorization?.broker_mutation_authorized !== false
    || committeeDecision.authorization?.order_payload !== null
    || committeeDecision.non_amplification?.passed !== true) {
    throw new TypeError("committeeDecision crosses the research-only authorization boundary");
  }
  if (committeeDecision.decision === "PROPOSE_REBALANCE") {
    const baseWeight = baseDecision.proposed_allocation?.spy_weight;
    const finalWeight = committeeDecision.final_allocation?.spy_weight;
    if (!Number.isFinite(finalWeight) || finalWeight < 0 || finalWeight > baseWeight) {
      throw new TypeError("committeeDecision amplifies or corrupts the base exposure");
    }
  } else if (committeeDecision.decision !== "NO_TRADE" || committeeDecision.final_allocation !== null) {
    throw new TypeError("committeeDecision decision is invalid");
  }
}

/**
 * Convert the checked, research-only allocation bundle into one additional
 * fail-closed condition for a new defined-risk options entry. This receipt is
 * not a broker permit: the existing option certificate, preflight, and MCP
 * mutation gates remain independently required. The long-only economic policy
 * can authorize only a bullish option intent and only when its final SPY
 * allocation is materially risk-on.
 */
export function buildEconomicOptionsExecutionGuard(bundle, {
  asOf,
  intentDirection,
  maximumDecisionAgeMinutes = 30,
  minimumSpyWeight = 0.5,
} = {}) {
  requireExactKeys(bundle, [
    "schema_version",
    "generated_at",
    "data",
    "paper_account_boundary",
    "deterministic_decision",
    "risk_committee_decision",
    "mutation_requested",
    "artifact_sha256",
  ], "economicBundle");
  if (bundle.schema_version !== "finly_current_economic_bundle.v1") {
    throw new TypeError("economicBundle schema is invalid");
  }
  const { artifact_sha256: artifactSha256, ...body } = bundle;
  if (artifactSha256 !== sha256(body)) throw new TypeError("economicBundle artifact hash is invalid");
  if (bundle.mutation_requested !== false || bundle.data?.read_only !== true) {
    throw new TypeError("economicBundle must remain an authenticated read-only artifact");
  }
  validateCurrentDecisionReceipt(bundle.deterministic_decision);
  validateEconomicRiskCommitteeReceipt(bundle.risk_committee_decision, bundle.deterministic_decision);
  const evaluatedAt = requireCanonicalTimestamp(asOf, "economic options guard asOf");
  const generatedAt = requireCanonicalTimestamp(bundle.generated_at, "economicBundle generated_at");
  const decisionTimestamp = requireCanonicalTimestamp(
    bundle.deterministic_decision.decision_timestamp,
    "economicBundle decision_timestamp",
  );
  if (!Number.isInteger(maximumDecisionAgeMinutes)
    || maximumDecisionAgeMinutes < 1
    || maximumDecisionAgeMinutes > 1_440) {
    throw new TypeError("maximumDecisionAgeMinutes must be an integer from 1 to 1440");
  }
  if (typeof minimumSpyWeight !== "number"
    || !Number.isFinite(minimumSpyWeight)
    || minimumSpyWeight < 0
    || minimumSpyWeight > 1) {
    throw new TypeError("minimumSpyWeight must be between zero and one");
  }
  if (!new Set(["bullish", "bearish", "neutral"]).has(intentDirection)) {
    throw new TypeError("intentDirection is invalid");
  }
  const ageMinutes = (new Date(evaluatedAt).getTime() - new Date(decisionTimestamp).getTime()) / 60_000;
  if (ageMinutes < 0) throw new TypeError("economicBundle decision is in the future");
  if (generatedAt < decisionTimestamp || generatedAt > evaluatedAt) {
    throw new TypeError("economicBundle generation timestamp is outside the decision boundary");
  }
  const finalSpyWeight = bundle.risk_committee_decision.final_allocation?.spy_weight ?? null;
  const reasons = [];
  if (ageMinutes > maximumDecisionAgeMinutes) reasons.push("ECONOMIC_DECISION_STALE");
  if (bundle.risk_committee_decision.decision !== "PROPOSE_REBALANCE") reasons.push("ECONOMIC_POLICY_NO_TRADE");
  if (finalSpyWeight === null || finalSpyWeight < minimumSpyWeight) reasons.push("ECONOMIC_EXPOSURE_BELOW_ENTRY_THRESHOLD");
  if (intentDirection !== "bullish") reasons.push("LONG_ONLY_ECONOMIC_DIRECTION_MISMATCH");
  const entryGatePassed = reasons.length === 0;
  const guardBody = {
    schema_version: "finly_economic_options_execution_guard.v1",
    evaluated_at: evaluatedAt,
    economic_bundle_sha256: bundle.artifact_sha256,
    economic_base_receipt_sha256: bundle.deterministic_decision.receipt_sha256,
    economic_committee_receipt_sha256: bundle.risk_committee_decision.receipt_sha256,
    economic_decision_age_minutes: round(ageMinutes),
    maximum_decision_age_minutes: maximumDecisionAgeMinutes,
    minimum_spy_weight: minimumSpyWeight,
    final_spy_weight: finalSpyWeight,
    option_intent_direction: intentDirection,
    decision: entryGatePassed ? "ALLOW_BULLISH_DEFINED_RISK_ENTRY_GATE" : "NO_TRADE",
    reason_codes: Object.freeze(reasons),
    entry_gate_passed: entryGatePassed,
    authorization_boundary: Object.freeze({
      broker_mutation_authorized_by_this_guard: false,
      additional_option_certificate_required: true,
      fresh_broker_preflight_required: true,
    }),
  };
  return receipt(guardBody);
}

/**
 * Bind the checked economic bundle into the deterministic intent compiler.
 * The authority supplies a direction and an upper bound, never a forecast
 * boost: live deterministic evidence must still support the direction and any
 * model-derived event evidence may only reduce or veto it.
 */
export function buildEconomicOptionsDirectionAuthority(bundle, {
  asOf,
  maximumDecisionAgeMinutes = 30,
  minimumSpyWeight = 0.5,
} = {}) {
  const guard = buildEconomicOptionsExecutionGuard(bundle, {
    asOf,
    intentDirection: "bullish",
    maximumDecisionAgeMinutes,
    minimumSpyWeight,
  });
  const enabled = guard.entry_gate_passed === true;
  const body = {
    schema_version: "finly_economic_options_direction_authority.v1",
    decision: enabled ? "ALLOW_BULLISH_DIRECTION_ONLY" : "NO_TRADE",
    direction: enabled ? "bullish" : "neutral",
    maximum_direction_score: enabled ? guard.final_spy_weight : 0,
    authority_weight: 0.5,
    economic_bundle_sha256: bundle.artifact_sha256,
    economic_guard_receipt_sha256: guard.receipt_sha256,
    reduction_only: true,
    broker_mutation_authorized: false,
  };
  return Object.freeze({ ...body, authority_sha256: sha256(body) });
}

/**
 * Apply an agent risk-committee scale or veto. SCALE is mathematically unable
 * to amplify the deterministic policy because the multiplier is restricted to
 * [0, 1]. VETO always returns NO_TRADE. The result remains research-only.
 */
export function applyEconomicRiskCommitteeVeto(baseDecision, committeeAssessment) {
  validateCurrentDecisionReceipt(baseDecision);
  requireExactKeys(committeeAssessment, [
    "assessedAt",
    "disposition",
    "spyExposureMultiplier",
    "reasonCodes",
  ], "committeeAssessment");
  const assessedAt = requireCanonicalTimestamp(committeeAssessment.assessedAt, "committeeAssessment.assessedAt");
  if (assessedAt < baseDecision.decision_timestamp) {
    throw new TypeError("committee assessment cannot predate the economic decision");
  }
  if (!Array.isArray(committeeAssessment.reasonCodes)
    || committeeAssessment.reasonCodes.some((code) => typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code))) {
    throw new TypeError("committee reasonCodes must be uppercase machine-readable codes");
  }
  const reasonCodes = [...new Set(committeeAssessment.reasonCodes)].sort();
  const multiplier = committeeAssessment.spyExposureMultiplier;
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1) {
    throw new TypeError("committee SPY exposure multiplier must be between zero and one");
  }
  if (committeeAssessment.disposition !== "SCALE" && committeeAssessment.disposition !== "VETO") {
    throw new TypeError("committee disposition must be SCALE or VETO");
  }
  if (committeeAssessment.disposition === "VETO" && multiplier !== 0) {
    throw new TypeError("a committee veto must use a zero SPY exposure multiplier");
  }

  const baseSpyWeight = baseDecision.decision === "PROPOSE_REBALANCE"
    ? baseDecision.proposed_allocation.spy_weight
    : null;
  const scaledSpyWeight = baseSpyWeight === null ? null : round(baseSpyWeight * multiplier);
  const noTrade = baseDecision.decision === "NO_TRADE" || committeeAssessment.disposition === "VETO";
  const finalAllocation = noTrade ? null : Object.freeze({
    spy_weight: scaledSpyWeight,
    bil_weight: round(1 - scaledSpyWeight),
  });
  const body = {
    schema_version: "finly_economic_risk_committee_receipt.v1",
    base_receipt_sha256: baseDecision.receipt_sha256,
    decision_timestamp: baseDecision.decision_timestamp,
    assessed_at: assessedAt,
    disposition: committeeAssessment.disposition,
    reason_codes: Object.freeze(reasonCodes),
    spy_exposure_multiplier: multiplier,
    base_spy_weight: baseSpyWeight,
    decision: noTrade ? "NO_TRADE" : "PROPOSE_REBALANCE",
    final_allocation: finalAllocation,
    non_amplification: Object.freeze({
      constraint: "final SPY weight must not exceed the deterministic policy SPY weight",
      passed: finalAllocation === null || finalAllocation.spy_weight <= baseSpyWeight,
    }),
    authorization: Object.freeze({
      scope: CURRENT_ECONOMIC_DECISION_PROTOCOL.authorization_scope,
      broker_mutation_authorized: false,
      order_payload: null,
    }),
  };
  return receipt(body);
}
