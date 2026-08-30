import { createHash } from "node:crypto";

const TRADING_DAYS = 252;

function fail(message) {
  throw new TypeError(message);
}

export function round(value, places = 10) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  const result = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

export function quantile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function isoDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) fail("invalid market-data timestamp");
  return date.toISOString().slice(0, 10);
}

export async function fetchYahooAdjustedSeries(symbol, { start, end }) {
  if (typeof symbol !== "string" || !/^[A-Z0-9.^-]+$/.test(symbol)) fail("invalid Yahoo symbol");
  const period1 = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1_000);
  const period2 = Math.floor((Date.parse(`${end}T00:00:00Z`) + 86_400_000) / 1_000);
  const url = new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`, "https://query1.finance.yahoo.com");
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("includeAdjustedClose", "true");
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json", "user-agent": "FinlyChampionResearch/1.0" },
  });
  if (!response.ok) throw new Error(`Yahoo chart read for ${symbol} failed with HTTP ${response.status}`);
  const raw = await response.text();
  const payload = JSON.parse(raw);
  const result = payload?.chart?.result?.[0];
  if (!result || payload?.chart?.error) throw new Error(`Yahoo chart read for ${symbol} returned an error`);
  const timestamps = result.timestamp;
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(timestamps) || !Array.isArray(adjusted) || timestamps.length !== adjusted.length) {
    throw new Error(`Yahoo chart arrays for ${symbol} are incomplete`);
  }
  const series = [];
  let nullRows = 0;
  let priorDate = "";
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = Number(adjusted[index]);
    if (!Number.isFinite(close) || close <= 0) {
      nullRows += 1;
      continue;
    }
    const date = isoDate(Number(timestamps[index]) * 1_000);
    if (date <= priorDate) throw new Error(`${symbol} Yahoo dates are not strictly increasing`);
    series.push(Object.freeze({ date, close }));
    priorDate = date;
  }
  if (series.length < 300) throw new Error(`${symbol} has insufficient Yahoo history`);
  return Object.freeze({
    symbol,
    series: Object.freeze(series),
    provenance: Object.freeze({
      provider: "Yahoo Finance chart endpoint",
      host: url.host,
      path: url.pathname,
      adjusted_close_field: "chart.result[0].indicators.adjclose[0].adjclose",
      raw_rows: timestamps.length,
      accepted_rows: series.length,
      omitted_null_rows: nullRows,
      first_date: series[0].date,
      last_date: series.at(-1).date,
      raw_response_sha256: sha256(raw),
      normalized_series_sha256: sha256(series.map((point) => [point.date, round(point.close, 10)])),
      raw_response_persisted: false,
    }),
  });
}

export function alignSeriesByDate(seriesResults, symbols) {
  if (!Array.isArray(symbols) || symbols.length < 2) fail("symbols must contain at least two items");
  const bySymbol = Object.fromEntries(seriesResults.map((result) => [result.symbol, result.series]));
  for (const symbol of symbols) {
    if (!Array.isArray(bySymbol[symbol])) fail(`missing series for ${symbol}`);
  }
  const maps = Object.fromEntries(symbols.map((symbol) => [symbol, new Map(bySymbol[symbol].map((point) => [point.date, point.close]))]));
  const commonDates = [...maps[symbols[0]].keys()].filter((date) => symbols.every((symbol) => maps[symbol].has(date))).sort();
  if (commonDates.length < 300) fail("common panel history is too short");
  const points = commonDates.map((date) => Object.freeze({
    date,
    ...Object.fromEntries(symbols.map((symbol) => [symbol, maps[symbol].get(date)])),
  }));
  return Object.freeze({
    symbols: Object.freeze([...symbols]),
    points: Object.freeze(points),
    common_start: points[0].date,
    common_end: points.at(-1).date,
    common_sessions: points.length,
    dropped_noncommon_sessions: Object.fromEntries(symbols.map((symbol) => [symbol, bySymbol[symbol].length - points.length])),
    normalized_panel_sha256: sha256(points.map((point) => [point.date, ...symbols.map((symbol) => round(point[symbol], 10))])),
  });
}

export function buildReturnsBySymbol(points, symbols) {
  return Object.fromEntries(symbols.map((symbol) => {
    const values = [null];
    for (let index = 1; index < points.length; index += 1) {
      values.push(points[index][symbol] / points[index - 1][symbol] - 1);
    }
    return [symbol, Object.freeze(values)];
  }));
}

export function logReturn(points, symbol, startIndex, endIndex) {
  if (startIndex < 0 || endIndex >= points.length || startIndex >= endIndex) return null;
  const start = points[startIndex]?.[symbol];
  const end = points[endIndex]?.[symbol];
  if (!(start > 0) || !(end > 0)) return null;
  return Math.log(end / start);
}

export function annualizedVolatility(returns, endIndex, lookback) {
  const start = endIndex - lookback + 1;
  if (start < 1 || endIndex >= returns.length) return null;
  const values = returns.slice(start, endIndex + 1);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const deviation = sampleStandardDeviation(values);
  return deviation === null ? null : deviation * Math.sqrt(TRADING_DAYS);
}

export function staticPortfolioVolatility(weights, returnsBySymbol, endIndex, lookback) {
  const start = endIndex - lookback + 1;
  if (start < 1) return null;
  const values = [];
  for (let index = start; index <= endIndex; index += 1) {
    let value = 0;
    for (const [symbol, weight] of Object.entries(weights)) {
      const item = returnsBySymbol[symbol]?.[index];
      if (!Number.isFinite(item)) return null;
      value += weight * item;
    }
    values.push(value);
  }
  const deviation = sampleStandardDeviation(values);
  return deviation === null ? null : deviation * Math.sqrt(TRADING_DAYS);
}

export function normalizeLongWeights(rawWeights, { cashSymbol = "BIL", maximumRiskyGross = 1.5 } = {}) {
  const clean = {};
  for (const [symbol, rawWeight] of Object.entries(rawWeights ?? {})) {
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || (symbol !== cashSymbol && weight < -1e-12)) fail(`long-only weight for ${symbol} is invalid`);
    if (weight > 1e-12) clean[symbol] = weight;
  }
  delete clean[cashSymbol];
  const riskyGross = Object.values(clean).reduce((sum, weight) => sum + weight, 0);
  if (riskyGross > maximumRiskyGross + 1e-10) fail(`risky gross ${riskyGross} exceeds ${maximumRiskyGross}`);
  clean[cashSymbol] = 1 - riskyGross;
  return Object.freeze(Object.fromEntries(Object.entries(clean).sort(([left], [right]) => left.localeCompare(right))));
}

export function scaleRiskyWeightsToTarget(rawWeights, {
  returnsBySymbol,
  signalIndex,
  targetVolatility,
  volatilityLookback = 63,
  cashSymbol = "BIL",
  maximumRiskyGross = 1.5,
}) {
  const risky = Object.fromEntries(Object.entries(rawWeights).filter(([symbol]) => symbol !== cashSymbol));
  const currentGross = Object.values(risky).reduce((sum, weight) => sum + Math.abs(weight), 0);
  if (currentGross <= 1e-12) return normalizeLongWeights({}, { cashSymbol, maximumRiskyGross });
  const volatility = staticPortfolioVolatility(risky, returnsBySymbol, signalIndex, volatilityLookback);
  const scale = !Number.isFinite(volatility) || volatility <= 0
    ? 0
    : Math.min(maximumRiskyGross / currentGross, targetVolatility / volatility);
  return normalizeLongWeights(
    Object.fromEntries(Object.entries(risky).map(([symbol, weight]) => [symbol, Math.max(0, weight * scale)])),
    { cashSymbol, maximumRiskyGross },
  );
}

export function inverseVolatilityWeights(symbols, returnsBySymbol, signalIndex, lookback = 63) {
  if (!Array.isArray(symbols) || symbols.length === 0) return Object.freeze({});
  const inverses = symbols.map((symbol) => {
    const volatility = annualizedVolatility(returnsBySymbol[symbol], signalIndex, lookback);
    return [symbol, Number.isFinite(volatility) && volatility > 0 ? 1 / volatility : 0];
  });
  const denominator = inverses.reduce((sum, [, value]) => sum + value, 0);
  if (!(denominator > 0)) return Object.freeze({});
  return Object.freeze(Object.fromEntries(inverses.map(([symbol, value]) => [symbol, value / denominator])));
}

function validateWeights(weights, symbols, { cashSymbol, maximumRiskyGross }) {
  const unknown = Object.keys(weights).filter((symbol) => !symbols.includes(symbol));
  if (unknown.length > 0) fail(`weights contain unknown symbols: ${unknown.join(", ")}`);
  let sum = 0;
  let riskyGross = 0;
  for (const symbol of symbols) {
    const weight = Number(weights[symbol] ?? 0);
    if (!Number.isFinite(weight)) fail(`weight for ${symbol} is not finite`);
    if (symbol !== cashSymbol && weight < -1e-12) fail(`risky weight for ${symbol} is negative`);
    if (symbol !== cashSymbol) riskyGross += Math.abs(weight);
    sum += weight;
  }
  if (Math.abs(sum - 1) > 1e-8) fail(`weights sum to ${sum}, not one`);
  if (riskyGross > maximumRiskyGross + 1e-8) fail(`risky gross ${riskyGross} exceeds ${maximumRiskyGross}`);
  if ((weights[cashSymbol] ?? 0) < 1 - maximumRiskyGross - 1e-8) fail("cash borrowing exceeds the permitted leverage");
}

export function simulateStrategy(points, symbols, strategy, {
  cashSymbol = "BIL",
  lookbackSessions = 252,
  rebalanceIntervalSessions = 21,
  rebalanceAnchor = 0,
  oneWayCostBps = 2,
  annualBorrowSpread = 0.005,
  maximumRiskyGross = 1.5,
  terminalLiquidation = true,
} = {}) {
  if (!strategy || typeof strategy.decide !== "function") fail("strategy.decide must be a function");
  const strategyRebalanceInterval = strategy.rebalanceIntervalSessions ?? rebalanceIntervalSessions;
  const strategyRebalanceAnchor = strategy.rebalanceAnchor ?? rebalanceAnchor;
  const strategyRebalanceBand = strategy.rebalanceBand ?? null;
  if (!Number.isSafeInteger(strategyRebalanceInterval) || strategyRebalanceInterval < 1) fail("strategy rebalance interval is invalid");
  if (!Number.isSafeInteger(strategyRebalanceAnchor) || strategyRebalanceAnchor < 0 || strategyRebalanceAnchor >= strategyRebalanceInterval) {
    fail("strategy rebalance anchor is invalid");
  }
  if (strategyRebalanceBand !== null
    && (!Number.isFinite(strategyRebalanceBand) || strategyRebalanceBand <= 0 || strategyRebalanceBand >= 1)) {
    fail("strategy rebalance band is invalid");
  }
  const returnsBySymbol = buildReturnsBySymbol(points, symbols);
  let holdings = normalizeLongWeights({}, { cashSymbol, maximumRiskyGross });
  let pendingDecision = null;
  let activePeriod = null;
  const rows = [];

  // Iterate in market-time order. A signal made at close t becomes a queued
  // decision for close t+1 and cannot earn a return until t+1 -> t+2.
  for (let closeIndex = lookbackSessions; closeIndex < points.length; closeIndex += 1) {
    if (activePeriod !== null) {
      const periodReturns = Object.fromEntries(symbols.map((symbol) => [
        symbol,
        points[closeIndex][symbol] / points[closeIndex - 1][symbol] - 1,
      ]));
      const grossReturn = symbols.reduce(
        (sum, symbol) => sum + (activePeriod.weights[symbol] ?? 0) * periodReturns[symbol],
        0,
      );
      const cashWeight = activePeriod.weights[cashSymbol] ?? 0;
      const financingSpreadCost = Math.max(0, -cashWeight) * annualBorrowSpread / TRADING_DAYS;
      const netReturn = grossReturn - activePeriod.transactionCost - financingSpreadCost;
      if (!Number.isFinite(netReturn) || netReturn <= -1 || !Number.isFinite(1 + grossReturn) || 1 + grossReturn <= 0) {
        fail(`${strategy.id ?? "strategy"} produced invalid return`);
      }
      const row = Object.freeze({
        signal_date: activePeriod.signalDate,
        rebalance_date: points[closeIndex - 1].date,
        execution_return_date: points[closeIndex].date,
        rebalanced: activePeriod.rebalanced,
        signal_weights: Object.freeze(Object.fromEntries(symbols.map((symbol) => [symbol, round(activePeriod.signalWeights[symbol] ?? 0)]))),
        weights: Object.freeze(Object.fromEntries(symbols.map((symbol) => [symbol, round(activePeriod.weights[symbol] ?? 0)]))),
        asset_returns: Object.freeze(Object.fromEntries(symbols.map((symbol) => [symbol, round(periodReturns[symbol])]))),
        cash_return: round(periodReturns[cashSymbol]),
        gross_return: round(grossReturn),
        transaction_cost: round(activePeriod.transactionCost),
        financing_spread_cost: round(financingSpreadCost),
        turnover_notional: round(activePeriod.turnoverNotional),
        net_return: round(netReturn),
      });
      rows.push(row);
      holdings = Object.freeze(Object.fromEntries(symbols.map((symbol) => [
        symbol,
        (activePeriod.weights[symbol] ?? 0) * (1 + periodReturns[symbol]) / (1 + grossReturn),
      ])));
      // Market moves may drift an otherwise valid allocation beyond its target
      // gross cap. The cap is enforced at each decision, not by granting a free
      // continuous rebalance between decisions.
      validateWeights(holdings, symbols, { cashSymbol, maximumRiskyGross: Number.POSITIVE_INFINITY });
      if (typeof strategy.observe === "function") strategy.observe(row);
    }

    if (pendingDecision !== null) {
      let transactionCost = 0;
      let turnoverNotional = 0;
      let executedRebalance = pendingDecision.rebalanced;
      if (executedRebalance) {
        turnoverNotional = symbols.reduce(
          (sum, symbol) => sum + Math.abs((pendingDecision.weights[symbol] ?? 0) - (holdings[symbol] ?? 0)),
          0,
        );
        const maximumDifference = Math.max(...symbols.map((symbol) => (
          Math.abs((pendingDecision.weights[symbol] ?? 0) - (holdings[symbol] ?? 0))
        )));
        if (pendingDecision.rebalanceBand !== null && maximumDifference < pendingDecision.rebalanceBand) {
          executedRebalance = false;
          turnoverNotional = 0;
        } else {
          transactionCost = turnoverNotional * oneWayCostBps / 10_000;
          holdings = pendingDecision.weights;
        }
      }
      activePeriod = Object.freeze({
        signalDate: pendingDecision.signalDate,
        rebalanced: executedRebalance,
        signalWeights: pendingDecision.signalWeights,
        weights: holdings,
        turnoverNotional,
        transactionCost,
      });
    }

    // There must be two later closes: one for execution and one for the first
    // realized return. Rows visible here end no later than this signal close.
    if (closeIndex <= points.length - 3) {
      const rebalanced = (closeIndex - lookbackSessions - strategyRebalanceAnchor) % strategyRebalanceInterval === 0;
      let targetWeights = null;
      if (rebalanced) {
        targetWeights = strategy.decide(Object.freeze({
          points,
          symbols,
          returnsBySymbol,
          signalIndex: closeIndex,
          signalDate: points[closeIndex].date,
          priorWeights: holdings,
          rows: Object.freeze([...rows]),
        }));
        validateWeights(targetWeights, symbols, { cashSymbol, maximumRiskyGross });
      }
      pendingDecision = Object.freeze({
        signalDate: points[closeIndex].date,
        rebalanced,
        weights: targetWeights,
        signalWeights: rebalanced ? targetWeights : holdings,
        rebalanceBand: strategyRebalanceBand,
      });
    } else {
      pendingDecision = null;
    }
  }

  if (terminalLiquidation && rows.length > 0) {
    const last = rows.at(-1);
    const liquidationNotional = symbols.filter((symbol) => symbol !== cashSymbol)
      .reduce((sum, symbol) => sum + Math.abs(holdings[symbol] ?? 0), 0);
    const liquidationCost = liquidationNotional * oneWayCostBps / 10_000;
    rows[rows.length - 1] = Object.freeze({
      ...last,
      terminal_liquidation: true,
      terminal_liquidation_notional: round(liquidationNotional),
      terminal_liquidation_cost: round(liquidationCost),
      transaction_cost: round(last.transaction_cost + liquidationCost),
      turnover_notional: round(last.turnover_notional + liquidationNotional),
      net_return: round(last.net_return - liquidationCost),
    });
  }
  return Object.freeze({ id: strategy.id, rows: Object.freeze(rows) });
}

export function rowsWithin(rows, start, end) {
  return rows.filter((row) => row.execution_return_date >= start && row.execution_return_date <= end);
}

export function rebaseRowsForStandalonePeriod(rows, {
  cashSymbol = "BIL",
  oneWayCostBps = 2,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return Object.freeze([]);
  if (!Number.isFinite(oneWayCostBps) || oneWayCostBps < 0) fail("one-way cost is invalid");
  const symbols = Object.keys(rows[0].weights ?? {});
  if (!symbols.includes(cashSymbol)) fail("standalone rows omit the cash symbol");
  const normalized = rows.map((row) => {
    if (!row?.weights || !row?.asset_returns || Object.keys(row.weights).some((symbol) => !Number.isFinite(row.asset_returns[symbol]))) {
      fail("standalone rows require weights and per-asset returns");
    }
    const priorTerminalCost = Number(row.terminal_liquidation_cost ?? 0);
    const priorTerminalNotional = Number(row.terminal_liquidation_notional ?? 0);
    const transactionCost = row.transaction_cost - priorTerminalCost;
    const turnoverNotional = row.turnover_notional - priorTerminalNotional;
    const base = Object.fromEntries(Object.entries(row).filter(([key]) => ![
      "terminal_liquidation",
      "terminal_liquidation_notional",
      "terminal_liquidation_cost",
    ].includes(key)));
    return {
      ...base,
      transaction_cost: round(transactionCost),
      turnover_notional: round(turnoverNotional),
      net_return: round(row.gross_return - transactionCost - row.financing_spread_cost),
    };
  });

  const first = normalized[0];
  const cashWeights = Object.fromEntries(symbols.map((symbol) => [symbol, symbol === cashSymbol ? 1 : 0]));
  const entryNotional = symbols.reduce(
    (sum, symbol) => sum + Math.abs((first.weights[symbol] ?? 0) - cashWeights[symbol]),
    0,
  );
  const entryCost = entryNotional * oneWayCostBps / 10_000;
  normalized[0] = {
    ...first,
    standalone_entry: true,
    standalone_entry_notional: round(entryNotional),
    standalone_entry_cost: round(entryCost),
    transaction_cost: round(entryCost),
    turnover_notional: round(entryNotional),
    net_return: round(first.gross_return - entryCost - first.financing_spread_cost),
  };

  const lastIndex = normalized.length - 1;
  const last = normalized[lastIndex];
  const grossMultiplier = 1 + last.gross_return;
  if (!(grossMultiplier > 0)) fail("standalone final gross return is invalid");
  const endWeights = Object.fromEntries(symbols.map((symbol) => [
    symbol,
    (last.weights[symbol] ?? 0) * (1 + last.asset_returns[symbol]) / grossMultiplier,
  ]));
  const liquidationNotional = symbols.filter((symbol) => symbol !== cashSymbol)
    .reduce((sum, symbol) => sum + Math.abs(endWeights[symbol]), 0);
  const liquidationCost = liquidationNotional * oneWayCostBps / 10_000;
  normalized[lastIndex] = {
    ...last,
    standalone_terminal_liquidation: true,
    standalone_terminal_liquidation_notional: round(liquidationNotional),
    standalone_terminal_liquidation_cost: round(liquidationCost),
    transaction_cost: round(last.transaction_cost + liquidationCost),
    turnover_notional: round(last.turnover_notional + liquidationNotional),
    net_return: round(last.net_return - liquidationCost),
  };
  return Object.freeze(normalized.map((row) => Object.freeze(row)));
}

function drawdownEvidence(returns, dates) {
  let equity = 1;
  let peak = 1;
  let peakDate = dates[0] ?? null;
  let maximum = 0;
  let maximumPeakDate = peakDate;
  let valleyDate = dates[0] ?? null;
  for (let index = 0; index < returns.length; index += 1) {
    equity *= 1 + returns[index];
    if (equity > peak) {
      peak = equity;
      peakDate = dates[index];
    }
    const drawdown = equity / peak - 1;
    if (drawdown < maximum) {
      maximum = drawdown;
      maximumPeakDate = peakDate;
      valleyDate = dates[index];
    }
  }
  return { maximum_drawdown: maximum, peak_date: maximumPeakDate, valley_date: valleyDate };
}

export function calculatePortfolioMetrics(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const dates = rows.map((row) => row.execution_return_date);
  const returns = rows.map((row) => row.net_return);
  const excess = rows.map((row) => row.net_return - row.cash_return);
  const growth = returns.reduce((value, item) => value * (1 + item), 1);
  const grossGrowth = rows.reduce((value, item) => value * (1 + item.gross_return), 1);
  const cashGrowth = rows.reduce((value, item) => value * (1 + item.cash_return), 1);
  const annualizedReturn = growth ** (TRADING_DAYS / rows.length) - 1;
  const volatility = sampleStandardDeviation(returns);
  const excessVolatility = sampleStandardDeviation(excess);
  const drawdown = drawdownEvidence(returns, dates);
  const varThreshold = quantile(returns, 0.05);
  const tail = returns.filter((value) => value <= varThreshold);
  const calendarGrowth = {};
  for (let index = 0; index < rows.length; index += 1) {
    const year = dates[index].slice(0, 4);
    calendarGrowth[year] = (calendarGrowth[year] ?? 1) * (1 + returns[index]);
  }
  const calendarYearReturns = Object.fromEntries(Object.entries(calendarGrowth).map(([year, value]) => [year, round(value - 1)]));
  const riskyGrossValues = rows.map((row) => Object.entries(row.weights)
    .filter(([symbol]) => symbol !== "BIL")
    .reduce((sum, [, weight]) => sum + Math.abs(weight), 0));
  return Object.freeze({
    observations: rows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    total_return: round(growth - 1),
    gross_total_return: round(grossGrowth - 1),
    cash_total_return: round(cashGrowth - 1),
    annualized_return: round(annualizedReturn),
    annualized_volatility: round(volatility * Math.sqrt(TRADING_DAYS)),
    cash_excess_sharpe: round(excessVolatility > 0 ? mean(excess) / excessVolatility * Math.sqrt(TRADING_DAYS) : null),
    maximum_drawdown: round(drawdown.maximum_drawdown),
    maximum_drawdown_peak_date: drawdown.peak_date,
    maximum_drawdown_valley_date: drawdown.valley_date,
    calmar_ratio: round(drawdown.maximum_drawdown < 0 ? annualizedReturn / Math.abs(drawdown.maximum_drawdown) : null),
    daily_expected_shortfall_p05: round(tail.length > 0 ? mean(tail) : null),
    worst_day_return: round(Math.min(...returns)),
    cumulative_turnover_notional: round(rows.reduce((sum, row) => sum + row.turnover_notional, 0)),
    annualized_turnover_notional: round(rows.reduce((sum, row) => sum + row.turnover_notional, 0) * TRADING_DAYS / rows.length),
    modeled_transaction_cost_simple_sum: round(rows.reduce((sum, row) => sum + row.transaction_cost, 0)),
    modeled_financing_spread_simple_sum: round(rows.reduce((sum, row) => sum + row.financing_spread_cost, 0)),
    average_risky_gross: round(mean(riskyGrossValues)),
    maximum_risky_gross: round(Math.max(...riskyGrossValues)),
    positive_calendar_year_fraction: round(Object.values(calendarYearReturns).filter((value) => value > 0).length / Object.keys(calendarYearReturns).length),
    calendar_year_returns: calendarYearReturns,
  });
}

export function compareMetrics(candidate, benchmark) {
  if (!candidate || !benchmark) return null;
  return Object.freeze({
    total_return_difference: round(candidate.total_return - benchmark.total_return),
    annualized_return_difference: round(candidate.annualized_return - benchmark.annualized_return),
    cash_excess_sharpe_difference: round(candidate.cash_excess_sharpe - benchmark.cash_excess_sharpe),
    maximum_drawdown_difference: round(candidate.maximum_drawdown - benchmark.maximum_drawdown),
    annualized_volatility_ratio: round(candidate.annualized_volatility / benchmark.annualized_volatility),
  });
}

export function buildPlanStrategy(id, planBySignalDate, {
  cashSymbol = "BIL",
  maximumRiskyGross = 1.5,
  rebalanceIntervalSessions,
} = {}) {
  return Object.freeze({
    id,
    ...(rebalanceIntervalSessions === undefined ? {} : { rebalanceIntervalSessions }),
    decide({ signalDate }) {
      const weights = planBySignalDate.get(signalDate);
      if (!weights) fail(`${id} plan omits ${signalDate}`);
      return normalizeLongWeights(weights, { cashSymbol, maximumRiskyGross });
    },
  });
}
