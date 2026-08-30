import { createHash } from "node:crypto";

import {
  hashEquityExecutionOhlcBundle,
  validateEquityExecutionOhlcBundle,
} from "./acquire_equity_execution_ohlc.mjs";

const TRADING_DAYS = 252;
const REQUIRED_SYMBOLS = Object.freeze(["SPY", "BIL"]);

export const EQUITY_EXECUTION_REALISM_PROTOCOL = Object.freeze({
  schema_version: "finly_equity_execution_realism_protocol.v1",
  evidence_class: "CONSUMED_RETROSPECTIVE_EXECUTION_REALISM",
  selected_policy_id: "tsmom_ensemble_vol",
  symbols: REQUIRED_SYMBOLS,
  signal: "adjusted SPY and BIL closes available at session close t",
  execution: "fractional market DAY orders at the next session open t+1",
  holding_period: "next open t+1 through subsequent opens, with self-financing drift between five-session rebalances",
  trend_horizons_sessions: Object.freeze([21, 63, 252]),
  volatility_lookback_sessions: 20,
  target_annualized_volatility: 0.10,
  maximum_spy_weight: 1,
  rebalance_interval_sessions: 5,
  one_way_cost_stress_bps: Object.freeze([1, 5, 10, 25]),
  cadence_anchors: Object.freeze([0, 1, 2, 3, 4]),
  small_account_initial_equity_usd: 300,
  small_account_minimum_order_notional_usd: 1,
  small_account_quantity_decimals: 9,
  small_account_sell_day_fee_proxy_usd: 0.01,
  mutation_authorized: false,
  network_authorized: false,
  alpha_claim_authorized: false,
  future_profit_claim_authorized: false,
});

export const EQUITY_EXECUTION_REALISM_PUBLICATION_BOUNDARY = Object.freeze({
  aggregate_artifact_publication_permitted: true,
  raw_ohlc_publication_permitted: false,
  profitability_claim_publication_permitted: false,
  alpha_claim_publication_permitted: false,
  future_profit_claim_publication_permitted: false,
});

function fail(message) {
  throw new TypeError(message);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function sha256(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(stableValue(value));
  return createHash("sha256").update(serialized).digest("hex");
}

export function round(value, places = 10) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  const result = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function isoDate(value, label) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(`${label} is not a valid date or timestamp`);
  return parsed.toISOString().slice(0, 10);
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(`${label} must be positive and finite`);
  return number;
}

function rowsForSymbol(book, symbol) {
  const direct = book?.[symbol];
  if (Array.isArray(direct)) return direct;
  if (Array.isArray(direct?.bars)) return direct.bars;
  if (Array.isArray(book?.bars?.[symbol])) return book.bars[symbol];
  if (Array.isArray(book?.series_by_symbol?.[symbol])) return book.series_by_symbol[symbol];
  fail(`OHLC book omits ${symbol}`);
}

function normalizeOhlcSeries(rows, symbol, label) {
  if (!Array.isArray(rows) || rows.length < 2) fail(`${label} ${symbol} series is too short`);
  let priorDate = "";
  return Object.freeze(rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail(`${label} ${symbol} row ${index} is invalid`);
    const date = isoDate(row.date ?? row.t, `${label} ${symbol} row ${index} date`);
    if (date <= priorDate) fail(`${label} ${symbol} dates are duplicated or out of order`);
    priorDate = date;
    return Object.freeze({
      date,
      open: positive(row.open ?? row.o, `${label} ${symbol} row ${index} open`),
      close: positive(row.close ?? row.c, `${label} ${symbol} row ${index} close`),
    });
  }));
}

function alignBook(book, label, minimumSessions) {
  const normalized = Object.fromEntries(REQUIRED_SYMBOLS.map((symbol) => [
    symbol,
    normalizeOhlcSeries(rowsForSymbol(book, symbol), symbol, label),
  ]));
  const maps = Object.fromEntries(REQUIRED_SYMBOLS.map((symbol) => [
    symbol,
    new Map(normalized[symbol].map((row) => [row.date, row])),
  ]));
  const dates = [...maps.SPY.keys()].filter((date) => maps.BIL.has(date)).sort();
  if (dates.length < minimumSessions) fail(`${label} common OHLC history has fewer than ${minimumSessions} sessions`);
  const points = dates.map((date) => Object.freeze({
    date,
    SPY: maps.SPY.get(date),
    BIL: maps.BIL.get(date),
  }));
  return Object.freeze({
    points: Object.freeze(points),
    common_start: points[0].date,
    common_end: points.at(-1).date,
    common_sessions: points.length,
    dropped_noncommon_sessions: Object.freeze(Object.fromEntries(REQUIRED_SYMBOLS.map((symbol) => [
      symbol,
      normalized[symbol].length - points.length,
    ]))),
    normalized_sha256: sha256(points.map((point) => [
      point.date,
      round(point.SPY.open),
      round(point.SPY.close),
      round(point.BIL.open),
      round(point.BIL.close),
    ])),
  });
}

function sameDates(left, right) {
  return left.length === right.length && left.every((point, index) => point.date === right[index].date);
}

/**
 * Provider-agnostic importer for an immutable payload shaped as either
 * `{ adjusted: { SPY: [...], BIL: [...] }, raw: ... }` or
 * `{ prices: { adjusted: ..., raw: ... } }`. Rows may use Alpaca's
 * `t/o/c` fields or normalized `date/open/close` fields.
 */
export function importImmutableOhlc(payload, { minimumSessions = 255, requireRaw = true } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("immutable OHLC payload must be an object");
  if (!Number.isSafeInteger(minimumSessions) || minimumSessions < 255) fail("minimumSessions must be an integer of at least 255");
  const isFinlyBundle = payload.schema_version === "finly_equity_execution_ohlc_bundle.v1";
  if (isFinlyBundle) validateEquityExecutionOhlcBundle(payload);
  const adjustedInput = payload.series?.all ?? payload.series?.adjusted ?? payload.prices?.adjusted ?? payload.adjusted;
  if (!adjustedInput) fail("immutable OHLC payload omits an adjusted book");
  const adjusted = alignBook(adjustedInput, "adjusted", minimumSessions);
  const rawInput = payload.series?.raw ?? payload.prices?.raw ?? payload.raw ?? payload.prices?.distribution_excluded ?? payload.distribution_excluded;
  if (!rawInput && requireRaw) fail("immutable OHLC payload omits a raw/distribution-excluded book");
  const raw = rawInput ? alignBook(rawInput, "raw/distribution-excluded", minimumSessions) : null;
  if (raw && !sameDates(adjusted.points, raw.points)) {
    fail("adjusted and raw/distribution-excluded OHLC books must contain identical common dates");
  }
  return Object.freeze({
    schema_version: "finly_immutable_ohlc_import.v1",
    adjusted,
    raw,
    provenance: Object.freeze({ ...(payload.provenance ?? payload.source ?? {}) }),
    payload_sha256: sha256(payload),
    source_binding: isFinlyBundle ? Object.freeze({
      schema_version: payload.schema_version,
      bundle_sha256: hashEquityExecutionOhlcBundle(payload),
      request: payload.source.request,
      acquisition_boundary: payload.acquisition_boundary,
    }) : null,
  });
}

function normalizeCloseSeries(rows, symbol, label) {
  if (!Array.isArray(rows) || rows.length < 2) fail(`${label} ${symbol} close series is too short`);
  let priorDate = "";
  return Object.freeze(rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail(`${label} ${symbol} close row ${index} is invalid`);
    const date = isoDate(row.date ?? row.t, `${label} ${symbol} close row ${index} date`);
    if (date <= priorDate) fail(`${label} ${symbol} close dates are duplicated or out of order`);
    priorDate = date;
    return Object.freeze({ date, close: positive(row.close ?? row.c, `${label} ${symbol} close row ${index}`) });
  }));
}

export function importImmutableClosePanel(book, { minimumSessions = 255 } = {}) {
  const series = Object.fromEntries(REQUIRED_SYMBOLS.map((symbol) => [
    symbol,
    normalizeCloseSeries(rowsForSymbol(book, symbol), symbol, "adjusted"),
  ]));
  const maps = Object.fromEntries(REQUIRED_SYMBOLS.map((symbol) => [
    symbol,
    new Map(series[symbol].map((row) => [row.date, row.close])),
  ]));
  const dates = [...maps.SPY.keys()].filter((date) => maps.BIL.has(date)).sort();
  if (dates.length < minimumSessions) fail(`adjusted common close history has fewer than ${minimumSessions} sessions`);
  const points = Object.freeze(dates.map((date) => Object.freeze({
    date,
    SPY: maps.SPY.get(date),
    BIL: maps.BIL.get(date),
  })));
  return Object.freeze({
    points,
    common_start: points[0].date,
    common_end: points.at(-1).date,
    common_sessions: points.length,
    dropped_noncommon_sessions: Object.freeze(Object.fromEntries(REQUIRED_SYMBOLS.map((symbol) => [
      symbol,
      series[symbol].length - points.length,
    ]))),
    normalized_sha256: sha256(points.map((point) => [point.date, round(point.SPY), round(point.BIL)])),
  });
}

function closeValue(point, symbol) {
  const value = point?.[symbol];
  return typeof value === "number" ? value : value?.close;
}

function closeReturn(points, symbol, startIndex, endIndex) {
  if (startIndex < 0 || endIndex >= points.length || startIndex >= endIndex) return null;
  return Math.log(closeValue(points[endIndex], symbol) / closeValue(points[startIndex], symbol));
}

function realizedVolatility(points, signalIndex, lookback) {
  if (signalIndex - lookback < 0) return null;
  const returns = [];
  for (let index = signalIndex - lookback + 1; index <= signalIndex; index += 1) {
    returns.push(closeValue(points[index], "SPY") / closeValue(points[index - 1], "SPY") - 1);
  }
  const deviation = sampleStandardDeviation(returns);
  return deviation === null ? null : deviation * Math.sqrt(TRADING_DAYS);
}

export function frozenPolicyTarget(points, signalIndex) {
  if (!Array.isArray(points) || signalIndex < 252 || signalIndex >= points.length) fail("signal index is outside the frozen policy history");
  const excessTrends = EQUITY_EXECUTION_REALISM_PROTOCOL.trend_horizons_sessions.map((lookback) => {
    const spy = closeReturn(points, "SPY", signalIndex - lookback, signalIndex);
    const bil = closeReturn(points, "BIL", signalIndex - lookback, signalIndex);
    return spy - bil;
  });
  const positiveFraction = excessTrends.filter((value) => value > 0).length / excessTrends.length;
  const volatility = realizedVolatility(points, signalIndex, EQUITY_EXECUTION_REALISM_PROTOCOL.volatility_lookback_sessions);
  const volatilityScale = Number.isFinite(volatility) && volatility > 0
    ? Math.min(1, EQUITY_EXECUTION_REALISM_PROTOCOL.target_annualized_volatility / volatility)
    : 0;
  const spyWeight = Math.min(1, Math.max(0, positiveFraction * volatilityScale));
  return Object.freeze({
    SPY: spyWeight,
    BIL: 1 - spyWeight,
    diagnostics: Object.freeze({
      positive_trend_fraction: positiveFraction,
      realized_spy_volatility: volatility,
      volatility_scale: volatilityScale,
      excess_log_returns: Object.freeze(Object.fromEntries(
        EQUITY_EXECUTION_REALISM_PROTOCOL.trend_horizons_sessions.map((lookback, index) => [String(lookback), excessTrends[index]]),
      )),
    }),
  });
}

function validSimulationOptions({ oneWayCostBps, rebalanceAnchor, evaluationStart, evaluationEnd }) {
  if (!Number.isFinite(oneWayCostBps) || oneWayCostBps < 0 || oneWayCostBps > 1_000) fail("one-way cost must be between zero and 1,000 bps");
  if (!Number.isSafeInteger(rebalanceAnchor) || rebalanceAnchor < 0 || rebalanceAnchor >= 5) fail("rebalance anchor must be 0 through 4");
  if (evaluationStart != null) isoDate(evaluationStart, "evaluation start");
  if (evaluationEnd != null) isoDate(evaluationEnd, "evaluation end");
  if (evaluationStart != null && evaluationEnd != null && evaluationStart > evaluationEnd) fail("evaluation bounds are inverted");
}

function dueAt(step, anchor) {
  return ((step - anchor) % 5 + 5) % 5 === 0;
}

function within(date, start, end) {
  return (start == null || date >= start) && (end == null || date <= end);
}

/**
 * Retrospective theoretical ledger. The frozen close signal is evaluated at t,
 * weights drift self-financing through the overnight gap, and a target change
 * is charged at the next session open before the open-to-close return.
 */
export function simulateNextOpenTheory(imported, {
  executionBook = "adjusted",
  oneWayCostBps = 1,
  rebalanceAnchor = 0,
  evaluationStart = null,
  evaluationEnd = null,
  freshStart = false,
} = {}) {
  if (!imported?.adjusted?.points) fail("an imported adjusted OHLC book is required");
  if (!new Set(["adjusted", "raw"]).has(executionBook)) fail("executionBook must be adjusted or raw");
  const execution = executionBook === "adjusted" ? imported.adjusted : imported.raw;
  if (!execution?.points) fail(`${executionBook} execution OHLC is unavailable`);
  if (!sameDates(imported.adjusted.points, execution.points)) fail("signal and execution OHLC dates are not aligned");
  validSimulationOptions({ oneWayCostBps, rebalanceAnchor, evaluationStart, evaluationEnd });

  const signals = imported.adjusted.points;
  const prices = execution.points;
  let spyWeight = 0;
  let bilWeight = 1;
  let freshActivated = !freshStart;
  let freshStep = 0;
  const rows = [];
  for (let signalIndex = 252; signalIndex < signals.length - 1; signalIndex += 1) {
    const executionDate = prices[signalIndex + 1].date;
    if (freshStart && !freshActivated) {
      if (evaluationStart == null || executionDate >= evaluationStart) {
        spyWeight = 0;
        bilWeight = 1;
        freshStep = 0;
        freshActivated = true;
      } else {
        continue;
      }
    }

    const spyOvernight = prices[signalIndex + 1].SPY.open / prices[signalIndex].SPY.close;
    const bilOvernight = prices[signalIndex + 1].BIL.open / prices[signalIndex].BIL.close;
    const overnightGrowth = spyWeight * spyOvernight + bilWeight * bilOvernight;
    if (!(overnightGrowth > 0)) fail("next-open overnight portfolio growth is invalid");
    const openSpyWeight = spyWeight * spyOvernight / overnightGrowth;
    const openBilWeight = bilWeight * bilOvernight / overnightGrowth;
    const cadenceStep = freshStart ? freshStep : signalIndex - 252;
    const rebalanced = dueAt(cadenceStep, rebalanceAnchor);
    const target = rebalanced ? frozenPolicyTarget(signals, signalIndex) : { SPY: openSpyWeight, BIL: openBilWeight };
    const grossTurnover = Math.abs(target.SPY - openSpyWeight) + Math.abs(target.BIL - openBilWeight);
    const transactionCostFraction = grossTurnover * oneWayCostBps / 10_000;
    const spyIntraday = prices[signalIndex + 1].SPY.close / prices[signalIndex + 1].SPY.open;
    const bilIntraday = prices[signalIndex + 1].BIL.close / prices[signalIndex + 1].BIL.open;
    const intradayGrowth = target.SPY * spyIntraday + target.BIL * bilIntraday;
    if (!(intradayGrowth > 0) || transactionCostFraction >= 1) fail("next-open portfolio growth or transaction cost is invalid");
    const netGrowth = overnightGrowth * (1 - transactionCostFraction) * intradayGrowth;
    spyWeight = target.SPY * spyIntraday / intradayGrowth;
    bilWeight = target.BIL * bilIntraday / intradayGrowth;
    const record = Object.freeze({
      signal_date: signals[signalIndex].date,
      execution_date: executionDate,
      rebalanced,
      target_spy_weight: round(target.SPY),
      close_spy_weight: round(spyWeight),
      gross_two_leg_turnover: round(grossTurnover),
      transaction_cost_fraction: round(transactionCostFraction),
      net_return: round(netGrowth - 1, 12),
      spy_return: round(prices[signalIndex + 1].SPY.close / prices[signalIndex].SPY.close - 1, 12),
      bil_return: round(prices[signalIndex + 1].BIL.close / prices[signalIndex].BIL.close - 1, 12),
    });
    if (within(executionDate, evaluationStart, evaluationEnd)) rows.push(record);
    if (freshStart) freshStep += 1;
  }
  if (rows.length < 2) fail("next-open evaluation produced fewer than two observations");
  return Object.freeze(rows);
}

/**
 * Close-only sensitivity. This deliberately is not named or interpreted as a
 * next-open execution replay: it trades at close t+1 and earns t+1 to t+2.
 */
export function simulateCloseRebalanceSensitivity(panel, {
  oneWayCostBps = 1,
  rebalanceAnchor = 0,
  evaluationStart = null,
  evaluationEnd = null,
  freshStart = false,
} = {}) {
  if (!panel?.points) fail("an adjusted close panel is required");
  validSimulationOptions({ oneWayCostBps, rebalanceAnchor, evaluationStart, evaluationEnd });
  const points = panel.points;
  let spyWeight = 0;
  let bilWeight = 1;
  let freshActivated = !freshStart;
  let freshStep = 0;
  const rows = [];
  for (let signalIndex = 252; signalIndex < points.length - 2; signalIndex += 1) {
    const returnDate = points[signalIndex + 2].date;
    if (freshStart && !freshActivated) {
      if (evaluationStart == null || returnDate >= evaluationStart) {
        spyWeight = 0;
        bilWeight = 1;
        freshStep = 0;
        freshActivated = true;
      } else {
        continue;
      }
    }
    const cadenceStep = freshStart ? freshStep : signalIndex - 252;
    const rebalanced = dueAt(cadenceStep, rebalanceAnchor);
    const target = rebalanced ? frozenPolicyTarget(points, signalIndex) : { SPY: spyWeight, BIL: bilWeight };
    const grossTurnover = Math.abs(target.SPY - spyWeight) + Math.abs(target.BIL - bilWeight);
    const transactionCostFraction = grossTurnover * oneWayCostBps / 10_000;
    const spyGross = points[signalIndex + 2].SPY / points[signalIndex + 1].SPY;
    const bilGross = points[signalIndex + 2].BIL / points[signalIndex + 1].BIL;
    const marketGrowth = target.SPY * spyGross + target.BIL * bilGross;
    const netGrowth = (1 - transactionCostFraction) * marketGrowth;
    spyWeight = target.SPY * spyGross / marketGrowth;
    bilWeight = target.BIL * bilGross / marketGrowth;
    const record = Object.freeze({
      signal_date: points[signalIndex].date,
      assumed_rebalance_date: points[signalIndex + 1].date,
      return_date: returnDate,
      rebalanced,
      target_spy_weight: round(target.SPY),
      close_spy_weight: round(spyWeight),
      gross_two_leg_turnover: round(grossTurnover),
      transaction_cost_fraction: round(transactionCostFraction),
      net_return: round(netGrowth - 1, 12),
      spy_return: round(spyGross - 1, 12),
      bil_return: round(bilGross - 1, 12),
    });
    if (within(returnDate, evaluationStart, evaluationEnd)) rows.push(record);
    if (freshStart) freshStep += 1;
  }
  if (rows.length < 2) fail("close-rebalance evaluation produced fewer than two observations");
  return Object.freeze(rows);
}

function truncateQuantity(value, decimals) {
  const scale = 10 ** decimals;
  return Math.floor(Math.max(0, value) * scale + 1e-9) / scale;
}

function accountPositionValue(state, point, field) {
  return state.SPY * point.SPY[field] + state.BIL * point.BIL[field] + state.cash;
}

function desiredQuantity(targetWeight, equity, price, decimals) {
  return truncateQuantity(targetWeight * equity / price, decimals);
}

/**
 * Small-account order proxy. Sells are processed before buys, quantities are
 * truncated to the configured precision, and buys are capped by cash after
 * proportional friction and the explicit per-sell-day fee proxy.
 */
export function simulateSmallAccountNextOpen(imported, {
  initialEquityUsd = EQUITY_EXECUTION_REALISM_PROTOCOL.small_account_initial_equity_usd,
  minimumOrderNotionalUsd = EQUITY_EXECUTION_REALISM_PROTOCOL.small_account_minimum_order_notional_usd,
  quantityDecimals = EQUITY_EXECUTION_REALISM_PROTOCOL.small_account_quantity_decimals,
  sellDayFeeUsd = EQUITY_EXECUTION_REALISM_PROTOCOL.small_account_sell_day_fee_proxy_usd,
  oneWayCostBps = 1,
  rebalanceAnchor = 0,
  evaluationStart = null,
  evaluationEnd = null,
  freshStart = true,
} = {}) {
  if (!imported?.adjusted?.points) fail("an imported adjusted OHLC book is required");
  validSimulationOptions({ oneWayCostBps, rebalanceAnchor, evaluationStart, evaluationEnd });
  if (!Number.isFinite(initialEquityUsd) || initialEquityUsd <= 0) fail("initial account equity must be positive");
  if (!Number.isFinite(minimumOrderNotionalUsd) || minimumOrderNotionalUsd < 0) fail("minimum order notional is invalid");
  if (!Number.isSafeInteger(quantityDecimals) || quantityDecimals < 0 || quantityDecimals > 9) fail("quantity decimals must be 0 through 9");
  if (!Number.isFinite(sellDayFeeUsd) || sellDayFeeUsd < 0) fail("sell-day fee proxy is invalid");

  const signals = imported.adjusted.points;
  const prices = imported.adjusted.points;
  let state = null;
  let activated = !freshStart;
  let freshStep = 0;
  let skippedMinimumOrders = 0;
  let sellDayFees = 0;
  const rows = [];
  for (let signalIndex = 252; signalIndex < signals.length - 1; signalIndex += 1) {
    const executionDate = prices[signalIndex + 1].date;
    if (!activated && (evaluationStart == null || executionDate >= evaluationStart)) activated = true;
    if (!activated) continue;
    if (state === null) {
      const bilQuantity = truncateQuantity(initialEquityUsd / prices[signalIndex].BIL.close, quantityDecimals);
      state = { SPY: 0, BIL: bilQuantity, cash: initialEquityUsd - bilQuantity * prices[signalIndex].BIL.close };
    }
    const priorCloseEquity = accountPositionValue(state, prices[signalIndex], "close");
    const openEquity = accountPositionValue(state, prices[signalIndex + 1], "open");
    const cadenceStep = freshStart ? freshStep : signalIndex - 252;
    const rebalanced = dueAt(cadenceStep, rebalanceAnchor);
    const target = rebalanced ? frozenPolicyTarget(signals, signalIndex) : null;
    let grossTradedNotional = 0;
    let sellOccurred = false;
    let orderCount = 0;
    let targetSpyWeight = state.SPY * prices[signalIndex + 1].SPY.open / openEquity;
    if (target) {
      targetSpyWeight = target.SPY;
      const desired = {
        SPY: desiredQuantity(target.SPY, openEquity, prices[signalIndex + 1].SPY.open, quantityDecimals),
        BIL: desiredQuantity(target.BIL, openEquity, prices[signalIndex + 1].BIL.open, quantityDecimals),
      };
      for (const symbol of REQUIRED_SYMBOLS) {
        const price = prices[signalIndex + 1][symbol].open;
        const quantity = Math.max(0, state[symbol] - desired[symbol]);
        const notional = quantity * price;
        if (quantity <= 0) continue;
        if (notional + 1e-9 < minimumOrderNotionalUsd) {
          skippedMinimumOrders += 1;
          continue;
        }
        state[symbol] -= quantity;
        state.cash += notional * (1 - oneWayCostBps / 10_000);
        grossTradedNotional += notional;
        sellOccurred = true;
        orderCount += 1;
      }
      if (sellOccurred && sellDayFeeUsd > 0) {
        state.cash -= sellDayFeeUsd;
        sellDayFees += sellDayFeeUsd;
      }
      for (const symbol of REQUIRED_SYMBOLS) {
        const price = prices[signalIndex + 1][symbol].open;
        const requested = Math.max(0, desired[symbol] - state[symbol]);
        const requestedNotional = requested * price;
        if (requested <= 0) continue;
        if (requestedNotional + 1e-9 < minimumOrderNotionalUsd) {
          skippedMinimumOrders += 1;
          continue;
        }
        const affordable = truncateQuantity(state.cash / (price * (1 + oneWayCostBps / 10_000)), quantityDecimals);
        const quantity = Math.min(requested, affordable);
        const notional = quantity * price;
        if (quantity <= 0 || notional + 1e-9 < minimumOrderNotionalUsd) {
          skippedMinimumOrders += 1;
          continue;
        }
        state[symbol] += quantity;
        state.cash -= notional * (1 + oneWayCostBps / 10_000);
        grossTradedNotional += notional;
        orderCount += 1;
      }
    }
    if (state.cash < -1e-6) fail("small-account proxy overspent cash");
    const closeEquity = accountPositionValue(state, prices[signalIndex + 1], "close");
    const closeSpyWeight = state.SPY * prices[signalIndex + 1].SPY.close / closeEquity;
    const record = Object.freeze({
      signal_date: signals[signalIndex].date,
      execution_date: executionDate,
      rebalanced,
      target_spy_weight: round(targetSpyWeight),
      close_spy_weight: round(closeSpyWeight),
      tracking_error_absolute: round(Math.abs(closeSpyWeight - targetSpyWeight)),
      gross_two_leg_turnover: round(grossTradedNotional / openEquity),
      order_count: orderCount,
      sell_day_fee_usd: sellOccurred ? round(sellDayFeeUsd) : 0,
      skipped_minimum_orders_cumulative: skippedMinimumOrders,
      ending_equity_usd: round(closeEquity, 8),
      net_return: round(closeEquity / priorCloseEquity - 1, 12),
      spy_return: round(prices[signalIndex + 1].SPY.close / prices[signalIndex].SPY.close - 1, 12),
      bil_return: round(prices[signalIndex + 1].BIL.close / prices[signalIndex].BIL.close - 1, 12),
    });
    if (within(executionDate, evaluationStart, evaluationEnd)) rows.push(record);
    if (freshStart) freshStep += 1;
  }
  if (rows.length < 2) fail("small-account evaluation produced fewer than two observations");
  return Object.freeze({
    rows: Object.freeze(rows),
    execution: Object.freeze({
      initial_equity_usd: initialEquityUsd,
      minimum_order_notional_usd: minimumOrderNotionalUsd,
      quantity_decimals: quantityDecimals,
      sell_day_fee_proxy_usd: sellDayFeeUsd,
      sell_day_fees_total_usd: round(sellDayFees, 8),
      skipped_minimum_orders: skippedMinimumOrders,
    }),
  });
}

function maximumDrawdown(returns) {
  let wealth = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of returns) {
    wealth *= 1 + value;
    peak = Math.max(peak, wealth);
    drawdown = Math.min(drawdown, wealth / peak - 1);
  }
  return drawdown;
}

export function calculateExecutionMetrics(rows) {
  if (!Array.isArray(rows) || rows.length < 2) fail("execution metrics require at least two rows");
  const returns = rows.map((row) => Number(row.net_return));
  if (returns.some((value) => !Number.isFinite(value) || value <= -1)) fail("execution rows contain an invalid net return");
  const growth = returns.reduce((value, item) => value * (1 + item), 1);
  const spyGrowth = rows.reduce((value, row) => value * (1 + Number(row.spy_return)), 1);
  const bilGrowth = rows.reduce((value, row) => value * (1 + Number(row.bil_return)), 1);
  const deviation = sampleStandardDeviation(returns);
  const startDate = rows[0].execution_date ?? rows[0].return_date;
  const endDate = rows.at(-1).execution_date ?? rows.at(-1).return_date;
  return Object.freeze({
    observations: rows.length,
    start_date: startDate,
    end_date: endDate,
    total_return: round(growth - 1),
    annualized_return: round(growth ** (TRADING_DAYS / rows.length) - 1),
    annualized_volatility: round(deviation === null ? null : deviation * Math.sqrt(TRADING_DAYS)),
    maximum_drawdown: round(maximumDrawdown(returns)),
    spy_total_return: round(spyGrowth - 1),
    bil_total_return: round(bilGrowth - 1),
    total_return_minus_bil: round(growth - bilGrowth),
    cumulative_gross_two_leg_turnover: round(rows.reduce((sum, row) => sum + Number(row.gross_two_leg_turnover ?? 0), 0)),
    modeled_cost_drag_simple_sum: round(rows.reduce((sum, row) => sum + Number(row.transaction_cost_fraction ?? 0), 0)),
    rebalance_days: rows.filter((row) => row.rebalanced).length,
    traded_days: rows.filter((row) => Number(row.gross_two_leg_turnover ?? 0) > 1e-12).length,
  });
}

function metricStudy(simulator, source, options) {
  return Object.fromEntries(EQUITY_EXECUTION_REALISM_PROTOCOL.one_way_cost_stress_bps.map((cost) => [
    String(cost),
    calculateExecutionMetrics(simulator(source, { ...options, oneWayCostBps: cost })),
  ]));
}

function anchorStudy(simulator, source, options) {
  return Object.fromEntries(EQUITY_EXECUTION_REALISM_PROTOCOL.cadence_anchors.map((anchor) => [
    String(anchor),
    calculateExecutionMetrics(simulator(source, { ...options, rebalanceAnchor: anchor })),
  ]));
}

export function runCompleteNextOpenStudy(imported, {
  evaluationStart,
  evaluationEnd,
} = {}) {
  if (!imported?.adjusted?.points || !imported?.raw?.points) fail("complete next-open study requires adjusted and raw/distribution-excluded OHLC");
  const shared = { evaluationStart, evaluationEnd, rebalanceAnchor: 0, freshStart: false };
  const adjustedCostStress = metricStudy(simulateNextOpenTheory, imported, { ...shared, executionBook: "adjusted" });
  const continuousCadenceAnchors = anchorStudy(simulateNextOpenTheory, imported, {
    evaluationStart,
    evaluationEnd,
    executionBook: "adjusted",
    oneWayCostBps: 1,
    freshStart: false,
  });
  const freshStartCadenceAnchors = anchorStudy(simulateNextOpenTheory, imported, {
    evaluationStart,
    evaluationEnd,
    executionBook: "adjusted",
    oneWayCostBps: 1,
    freshStart: true,
  });
  const rawRows = simulateNextOpenTheory(imported, { ...shared, executionBook: "raw", oneWayCostBps: 1 });
  const small = simulateSmallAccountNextOpen(imported, {
    evaluationStart,
    evaluationEnd,
    oneWayCostBps: 1,
    rebalanceAnchor: 0,
    freshStart: true,
  });
  return Object.freeze({
    status: "AVAILABLE_CONSUMED_RETROSPECTIVE_EXECUTION_REALISM",
    adjusted_theoretical_total_return: Object.freeze({
      ledger_definition: "Adjusted OHLC includes distributions; theoretical weights and proportional friction; not an Alpaca paper-equity ledger.",
      cost_stress_bps_per_leg: Object.freeze(adjustedCostStress),
      continuous_cadence_anchors_at_1bp: Object.freeze(continuousCadenceAnchors),
      fresh_start_cadence_anchors_at_1bp: Object.freeze(freshStartCadenceAnchors),
    }),
    raw_no_distribution_proxy: Object.freeze({
      ledger_definition: "Adjusted closes generate signals; raw/distribution-excluded OHLC supplies returns. This approximates paper equity that omits distributions but is not a broker fill replay.",
      metrics_at_1bp: calculateExecutionMetrics(rawRows),
    }),
    small_account_proxy: Object.freeze({
      ledger_definition: "A $300 adjusted-OHLC shadow with sell-first orders, $1 minimum notional, quantities truncated to nine decimals, proportional friction, and a one-cent per-sell-day fee proxy.",
      metrics_at_1bp: calculateExecutionMetrics(small.rows),
      execution: small.execution,
      ending_equity_usd: small.rows.at(-1).ending_equity_usd,
      mean_absolute_close_tracking_error: round(mean(small.rows.map((row) => row.tracking_error_absolute))),
    }),
  });
}

export function runCloseOnlySensitivity(panel, { evaluationStart, evaluationEnd } = {}) {
  const costStress = metricStudy(simulateCloseRebalanceSensitivity, panel, {
    evaluationStart,
    evaluationEnd,
    rebalanceAnchor: 0,
    freshStart: false,
  });
  const continuous = anchorStudy(simulateCloseRebalanceSensitivity, panel, {
    evaluationStart,
    evaluationEnd,
    oneWayCostBps: 1,
    freshStart: false,
  });
  const fresh = anchorStudy(simulateCloseRebalanceSensitivity, panel, {
    evaluationStart,
    evaluationEnd,
    oneWayCostBps: 1,
    freshStart: true,
  });
  return Object.freeze({
    status: "AVAILABLE_CLOSE_REBALANCE_SENSITIVITY_NOT_EXECUTION_REALISM",
    warning: "This assumes fills at a historical close and cannot be described as a next-open, paper-fill, or live-execution result.",
    cost_stress_bps_per_leg: Object.freeze(costStress),
    continuous_cadence_anchors_at_1bp: Object.freeze(continuous),
    fresh_start_cadence_anchors_at_1bp: Object.freeze(fresh),
  });
}
