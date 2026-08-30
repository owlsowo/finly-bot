const MILLISECONDS_PER_DAY = 86_400_000;
const MIN_ANNUALIZED_RETURN_OBSERVATIONS = 20;
const WILSON_95_Z = 1.959963984540054;
const EQUITY_CURVE_BASES = new Set([
  "caller_supplied",
  "daily_mark_to_market",
  "realized_exit_only",
]);

function fail(message) {
  throw new TypeError(message);
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  return value;
}

function nonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${path} must be a non-negative safe integer`);
  }
  return value;
}

function timestamp(value, path) {
  let milliseconds;
  if (value instanceof Date) {
    milliseconds = value.getTime();
  } else if (typeof value === "number") {
    milliseconds = value;
  } else if (typeof value === "string") {
    // Date-only values are unambiguously UTC. Date-times must state a zone so
    // the same replay cannot move when it is run on another machine.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const zonedDateTime = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    if (!dateOnly && !zonedDateTime) {
      fail(`${path} must be an ISO 8601 timestamp with a timezone or a YYYY-MM-DD date`);
    }
    milliseconds = Date.parse(value);
  } else {
    fail(`${path} must be a Date, epoch-millisecond number, or ISO 8601 string`);
  }
  if (!Number.isFinite(milliseconds)) fail(`${path} is not a valid timestamp`);
  return { milliseconds, iso: new Date(milliseconds).toISOString() };
}

function oneOf(object, names, path, { required = true } = {}) {
  const present = names.filter((name) => object[name] !== undefined);
  if (present.length > 1) fail(`${path} provides duplicate aliases: ${present.join(", ")}`);
  if (present.length === 0) {
    if (required) fail(`${path} is required`);
    return undefined;
  }
  return object[present[0]];
}

function normalizeCurve(curve, path) {
  if (curve === undefined) return [];
  if (!Array.isArray(curve)) fail(`${path} must be an array`);
  let previousTimestamp = -Infinity;
  return curve.map((point, index) => {
    const pointPath = `${path}[${index}]`;
    if (point === null || typeof point !== "object" || Array.isArray(point)) {
      fail(`${pointPath} must be an object`);
    }
    const parsedTimestamp = timestamp(point.timestamp, `${pointPath}.timestamp`);
    if (parsedTimestamp.milliseconds <= previousTimestamp) {
      fail(`${path} timestamps must be strictly increasing`);
    }
    previousTimestamp = parsedTimestamp.milliseconds;
    const equity = finiteNumber(
      oneOf(point, ["equity", "value"], `${pointPath}.equity`),
      `${pointPath}.equity`,
    );
    if (equity <= 0) fail(`${pointPath}.equity must be greater than zero`);
    return { timestamp: parsedTimestamp.iso, milliseconds: parsedTimestamp.milliseconds, equity };
  });
}

function normalizeTrades(trades) {
  if (trades === undefined) return [];
  if (!Array.isArray(trades)) fail("trades must be an array");
  return trades.map((trade, index) => {
    const path = `trades[${index}]`;
    if (trade === null || typeof trade !== "object" || Array.isArray(trade)) {
      fail(`${path} must be an object`);
    }
    const pnl = finiteNumber(
      oneOf(trade, ["pnl", "realizedPnl", "realized_pnl"], `${path}.pnl`),
      `${path}.pnl`,
    );
    const riskValue = oneOf(
      trade,
      ["maxCapitalAtRisk", "max_capital_at_risk"],
      `${path}.maxCapitalAtRisk`,
      { required: false },
    );
    let maxCapitalAtRisk = null;
    if (riskValue !== undefined && riskValue !== null) {
      maxCapitalAtRisk = finiteNumber(riskValue, `${path}.maxCapitalAtRisk`);
      if (maxCapitalAtRisk <= 0) fail(`${path}.maxCapitalAtRisk must be greater than zero`);
    }
    return { pnl, maxCapitalAtRisk };
  });
}

function normalizeDecisions(decisions) {
  if (decisions === undefined) return { total: 0, traded: 0, abstained: 0 };
  if (decisions === null || typeof decisions !== "object" || Array.isArray(decisions)) {
    fail("decisions must be an object of counts");
  }
  const total = nonNegativeInteger(decisions.total, "decisions.total");
  const tradedValue = oneOf(
    decisions,
    ["traded", "executed"],
    "decisions.traded",
    { required: false },
  );
  const abstainedValue = decisions.abstained;
  if (tradedValue === undefined && abstainedValue === undefined) {
    if (total === 0) return { total: 0, traded: 0, abstained: 0 };
    fail("decisions must include traded/executed or abstained");
  }
  const traded = tradedValue === undefined
    ? total - nonNegativeInteger(abstainedValue, "decisions.abstained")
    : nonNegativeInteger(tradedValue, "decisions.traded");
  const abstained = abstainedValue === undefined
    ? total - traded
    : nonNegativeInteger(abstainedValue, "decisions.abstained");
  if (traded < 0 || abstained < 0 || traded + abstained !== total) {
    fail("decisions.traded plus decisions.abstained must equal decisions.total");
  }
  return { total, traded, abstained };
}

function normalizeAnnualization(annualization) {
  if (annualization === undefined || annualization === null) return null;
  if (typeof annualization !== "object" || Array.isArray(annualization)) {
    fail("annualization must be an object");
  }
  const periodsPerYear = finiteNumber(annualization.periodsPerYear, "annualization.periodsPerYear");
  if (periodsPerYear <= 0) fail("annualization.periodsPerYear must be greater than zero");
  const riskFreeRateAnnual = finiteNumber(
    annualization.riskFreeRateAnnual,
    "annualization.riskFreeRateAnnual",
  );
  if (riskFreeRateAnnual <= -1) fail("annualization.riskFreeRateAnnual must be greater than -1");
  return { periodsPerYear, riskFreeRateAnnual };
}

function normalizeEquityCurveBasis(value) {
  if (value === undefined) return "caller_supplied";
  if (typeof value !== "string" || !EQUITY_CURVE_BASES.has(value)) {
    fail(`equityCurveBasis must be one of: ${[...EQUITY_CURVE_BASES].join(", ")}`);
  }
  return value;
}

function safeSum(values, path) {
  let sum = 0;
  for (const value of values) {
    sum += value;
    if (!Number.isFinite(sum)) fail(`${path} exceeds the finite numeric range`);
  }
  return Object.is(sum, -0) ? 0 : sum;
}

function safeRatio(numerator, denominator, path) {
  const value = numerator / denominator;
  if (!Number.isFinite(value)) fail(`${path} exceeds the finite numeric range`);
  return Object.is(value, -0) ? 0 : value;
}

function curveReturns(curve, path) {
  const returns = [];
  for (let index = 1; index < curve.length; index += 1) {
    returns.push(safeRatio(curve[index].equity, curve[index - 1].equity, `${path}[${index}] return`) - 1);
  }
  return returns;
}

function sampleStatistics(values) {
  const mean = safeRatio(safeSum(values, "sample sum"), values.length, "sample mean");
  const squaredDeviations = values.map((value) => (value - mean) ** 2);
  if (!squaredDeviations.every(Number.isFinite)) fail("sample variance exceeds the finite numeric range");
  const variance = safeRatio(
    safeSum(squaredDeviations, "sample squared deviations"),
    values.length - 1,
    "sample variance",
  );
  return { mean, standardDeviation: Math.sqrt(variance) };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return safeRatio(sorted[middle - 1] + sorted[middle], 2, "median P&L");
}

/** Wilson score interval for a binomial proportion, excluding flat trades. */
export function wilsonInterval95(successes, observations) {
  nonNegativeInteger(successes, "successes");
  nonNegativeInteger(observations, "observations");
  if (successes > observations) fail("successes must not exceed observations");
  if (observations === 0) return null;
  const proportion = successes / observations;
  const zSquared = WILSON_95_Z ** 2;
  const denominator = 1 + zSquared / observations;
  const center = (proportion + zSquared / (2 * observations)) / denominator;
  const margin = WILSON_95_Z
    * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * observations)) / observations)
    / denominator;
  return {
    lower: successes === 0 ? 0 : Math.max(0, center - margin),
    upper: successes === observations ? 1 : Math.min(1, center + margin),
  };
}

function unavailableReasons() {
  return {
    start_equity: null,
    end_equity: null,
    total_return: null,
    benchmark_return: null,
    excess_return: null,
    max_drawdown: null,
    annualized_volatility: null,
    sharpe_ratio: null,
    win_rate: null,
    win_rate_wilson_95: null,
    profit_factor: null,
    average_pnl: null,
    median_pnl: null,
    average_max_capital_at_risk: null,
    return_on_risk: null,
    abstention_rate: null,
    benchmark_timestamp_coverage: null,
    capital_at_risk_coverage: null,
  };
}

/**
 * Produce JSON-safe descriptive metrics for a completed historical replay.
 *
 * `gross_loss` is the positive magnitude of losing P&L. Win rate excludes flat
 * trades. Max drawdown is a positive peak-to-trough fraction. Annualized
 * metrics require the caller to state the replay frequency and risk-free rate;
 * this function will not silently assume daily observations or a zero rate.
 */
export function calculateBacktestMetrics(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("backtest metrics input must be an object");
  }
  const equityCurve = normalizeCurve(input.equityCurve, "equityCurve");
  const benchmarkCurve = normalizeCurve(input.benchmarkCurve, "benchmarkCurve");
  const trades = normalizeTrades(input.trades);
  if (input.decisions !== undefined && input.decisionCounts !== undefined) {
    fail("provide decisions or decisionCounts, not both");
  }
  const decisions = normalizeDecisions(input.decisions ?? input.decisionCounts);
  const annualization = normalizeAnnualization(input.annualization);
  const equityCurveBasis = normalizeEquityCurveBasis(input.equityCurveBasis);
  const reasons = unavailableReasons();

  let startEquity = null;
  let endEquity = null;
  let totalReturn = null;
  let maxDrawdown = null;
  if (equityCurve.length === 0) {
    const reason = "equityCurve has no observations";
    reasons.start_equity = reason;
    reasons.end_equity = reason;
    reasons.total_return = "total return requires at least two equity observations";
    reasons.max_drawdown = "max drawdown requires at least one equity observation";
  } else {
    startEquity = equityCurve[0].equity;
    endEquity = equityCurve[equityCurve.length - 1].equity;
    let peak = startEquity;
    maxDrawdown = 0;
    for (const point of equityCurve) {
      peak = Math.max(peak, point.equity);
      maxDrawdown = Math.max(maxDrawdown, 1 - safeRatio(point.equity, peak, "max drawdown"));
    }
    if (equityCurve.length < 2) {
      reasons.total_return = "total return requires at least two equity observations";
    } else {
      totalReturn = safeRatio(endEquity, startEquity, "total return") - 1;
    }
  }

  let benchmarkReturn = null;
  if (benchmarkCurve.length < 2) {
    reasons.benchmark_return = "benchmark return requires at least two benchmark observations";
  } else {
    benchmarkReturn = safeRatio(
      benchmarkCurve[benchmarkCurve.length - 1].equity,
      benchmarkCurve[0].equity,
      "benchmark return",
    ) - 1;
  }

  const benchmarkBoundaryAligned = equityCurve.length >= 2
    && benchmarkCurve.length >= 2
    && equityCurve[0].milliseconds === benchmarkCurve[0].milliseconds
    && equityCurve[equityCurve.length - 1].milliseconds === benchmarkCurve[benchmarkCurve.length - 1].milliseconds;
  let excessReturn = null;
  if (totalReturn === null) {
    reasons.excess_return = "excess return requires a strategy total return";
  } else if (benchmarkReturn === null) {
    reasons.excess_return = "excess return requires a benchmark return";
  } else if (!benchmarkBoundaryAligned) {
    reasons.excess_return = "strategy and benchmark curves must have identical start and end timestamps";
  } else if (trades.length === 0) {
    reasons.excess_return = "excess return is not reported for a no-trade window; cash and SPY remain descriptive comparison contexts";
  } else {
    excessReturn = totalReturn - benchmarkReturn;
  }

  const periodicReturns = curveReturns(equityCurve, "equityCurve");
  let annualizedVolatility = null;
  let sharpeRatio = null;
  if (equityCurveBasis === "realized_exit_only") {
    const reason = "not reported from a realized-exit-only equity curve; daily mark-to-market equity is required";
    reasons.annualized_volatility = reason;
    reasons.sharpe_ratio = reason;
  } else if (annualization === null) {
    const reason = "annualization requires explicit periodsPerYear and riskFreeRateAnnual inputs";
    reasons.annualized_volatility = reason;
    reasons.sharpe_ratio = reason;
  } else if (periodicReturns.length < MIN_ANNUALIZED_RETURN_OBSERVATIONS) {
    const reason = `annualized metrics require at least ${MIN_ANNUALIZED_RETURN_OBSERVATIONS} periodic returns; received ${periodicReturns.length}`;
    reasons.annualized_volatility = reason;
    reasons.sharpe_ratio = reason;
  } else {
    const statistics = sampleStatistics(periodicReturns);
    annualizedVolatility = statistics.standardDeviation * Math.sqrt(annualization.periodsPerYear);
    if (!Number.isFinite(annualizedVolatility)) fail("annualized volatility exceeds the finite numeric range");
    if (statistics.standardDeviation === 0) {
      reasons.sharpe_ratio = "Sharpe ratio is undefined because periodic return volatility is zero";
    } else {
      const periodicRiskFreeRate = (1 + annualization.riskFreeRateAnnual) ** (1 / annualization.periodsPerYear) - 1;
      sharpeRatio = (statistics.mean - periodicRiskFreeRate)
        / statistics.standardDeviation
        * Math.sqrt(annualization.periodsPerYear);
      if (!Number.isFinite(sharpeRatio)) fail("Sharpe ratio exceeds the finite numeric range");
    }
  }

  const pnls = trades.map((trade) => trade.pnl);
  const winningPnls = pnls.filter((pnl) => pnl > 0);
  const losingPnls = pnls.filter((pnl) => pnl < 0);
  const flatCount = pnls.length - winningPnls.length - losingPnls.length;
  const resolvedTradeCount = winningPnls.length + losingPnls.length;
  const grossProfit = safeSum(winningPnls, "gross profit");
  const signedGrossLoss = safeSum(losingPnls, "gross loss");
  const grossLoss = signedGrossLoss === 0 ? 0 : -signedGrossLoss;
  const netPnl = safeSum(pnls, "net P&L");

  let winRate = null;
  let winRateWilson95 = null;
  if (resolvedTradeCount === 0) {
    const reason = "win rate requires at least one non-flat completed trade";
    reasons.win_rate = reason;
    reasons.win_rate_wilson_95 = reason;
  } else {
    winRate = winningPnls.length / resolvedTradeCount;
    winRateWilson95 = wilsonInterval95(winningPnls.length, resolvedTradeCount);
  }

  let profitFactor = null;
  if (grossLoss === 0) {
    reasons.profit_factor = "profit factor is undefined because gross loss is zero";
  } else {
    profitFactor = safeRatio(grossProfit, grossLoss, "profit factor");
  }

  let averagePnl = null;
  let medianPnl = null;
  if (trades.length === 0) {
    reasons.average_pnl = "average P&L requires at least one completed trade";
    reasons.median_pnl = "median P&L requires at least one completed trade";
  } else {
    averagePnl = safeRatio(netPnl, trades.length, "average P&L");
    medianPnl = median(pnls);
  }

  const risks = trades.filter((trade) => trade.maxCapitalAtRisk !== null).map((trade) => trade.maxCapitalAtRisk);
  const completeRiskCoverage = trades.length > 0 && risks.length === trades.length;
  let averageMaxCapitalAtRisk = null;
  let returnOnRisk = null;
  if (!completeRiskCoverage) {
    const reason = trades.length === 0
      ? "capital-at-risk metrics require at least one completed trade"
      : `capital-at-risk metrics require maxCapitalAtRisk for every trade; received ${risks.length} of ${trades.length}`;
    reasons.average_max_capital_at_risk = reason;
    reasons.return_on_risk = reason;
  } else {
    const totalRisk = safeSum(risks, "total max capital at risk");
    averageMaxCapitalAtRisk = safeRatio(totalRisk, risks.length, "average max capital at risk");
    returnOnRisk = safeRatio(netPnl, totalRisk, "return on risk");
  }

  let abstentionRate = null;
  if (decisions.total === 0) {
    reasons.abstention_rate = "abstention rate requires at least one decision";
  } else {
    abstentionRate = decisions.abstained / decisions.total;
  }

  const equityTimestampSet = new Set(equityCurve.map((point) => point.milliseconds));
  const exactBenchmarkMatches = benchmarkCurve.filter((point) => equityTimestampSet.has(point.milliseconds)).length;
  let benchmarkTimestampCoverage = null;
  if (equityCurve.length === 0) {
    reasons.benchmark_timestamp_coverage = "benchmark timestamp coverage requires equity observations";
  } else {
    benchmarkTimestampCoverage = exactBenchmarkMatches / equityCurve.length;
  }
  let capitalAtRiskCoverage = null;
  if (trades.length === 0) {
    reasons.capital_at_risk_coverage = "capital-at-risk coverage requires completed trades";
  } else {
    capitalAtRiskCoverage = risks.length / trades.length;
  }

  const equityStartTimestamp = equityCurve[0]?.timestamp ?? null;
  const equityEndTimestamp = equityCurve[equityCurve.length - 1]?.timestamp ?? null;
  const benchmarkStartTimestamp = benchmarkCurve[0]?.timestamp ?? null;
  const benchmarkEndTimestamp = benchmarkCurve[benchmarkCurve.length - 1]?.timestamp ?? null;

  if (equityCurveBasis === "realized_exit_only" && trades.length === 0 && maxDrawdown !== null) {
    maxDrawdown = null;
    reasons.max_drawdown = "not reported for a no-trade realized-exit-only curve; zero realized variation is not evidence of zero market risk";
  }

  return {
    schema_version: "finly_backtest_metrics.v1",
    equity_curve_basis: equityCurveBasis,
    start_equity: startEquity,
    end_equity: endEquity,
    total_return: totalReturn,
    benchmark_return: benchmarkReturn,
    excess_return: excessReturn,
    max_drawdown: maxDrawdown,
    annualized_volatility: annualizedVolatility,
    sharpe_ratio: sharpeRatio,
    trade_count: trades.length,
    win_count: winningPnls.length,
    loss_count: losingPnls.length,
    flat_count: flatCount,
    win_rate: winRate,
    win_rate_wilson_95: winRateWilson95,
    gross_profit: grossProfit,
    gross_loss: grossLoss,
    net_pnl: netPnl,
    profit_factor: profitFactor,
    average_pnl: averagePnl,
    median_pnl: medianPnl,
    average_max_capital_at_risk: averageMaxCapitalAtRisk,
    return_on_risk: returnOnRisk,
    decision_count: decisions.total,
    traded_decision_count: decisions.traded,
    abstention_count: decisions.abstained,
    abstention_rate: abstentionRate,
    metric_basis: {
      total_return: equityCurveBasis,
      benchmark_return: "caller_supplied_benchmark_curve",
      excess_return: trades.length === 0
        ? "suppressed_for_no_trade_window"
        : "arithmetic_difference_from_full_notional_benchmark_not_risk_adjusted_alpha",
      max_drawdown: equityCurveBasis === "realized_exit_only"
        ? "realized_exit_equity_only_excludes_intratrade_mark_to_market_drawdown"
        : equityCurveBasis,
      annualized_volatility: equityCurveBasis === "realized_exit_only"
        ? "suppressed_requires_daily_mark_to_market"
        : equityCurveBasis,
      sharpe_ratio: equityCurveBasis === "realized_exit_only"
        ? "suppressed_requires_daily_mark_to_market"
        : equityCurveBasis,
    },
    data_coverage: {
      equity_observations: equityCurve.length,
      equity_return_observations: periodicReturns.length,
      equity_start_timestamp: equityStartTimestamp,
      equity_end_timestamp: equityEndTimestamp,
      equity_calendar_days: equityCurve.length === 0
        ? null
        : (equityCurve[equityCurve.length - 1].milliseconds - equityCurve[0].milliseconds) / MILLISECONDS_PER_DAY,
      benchmark_observations: benchmarkCurve.length,
      benchmark_return_observations: Math.max(0, benchmarkCurve.length - 1),
      benchmark_start_timestamp: benchmarkStartTimestamp,
      benchmark_end_timestamp: benchmarkEndTimestamp,
      benchmark_boundary_aligned: benchmarkBoundaryAligned,
      exact_benchmark_timestamp_matches: exactBenchmarkMatches,
      benchmark_timestamp_coverage: benchmarkTimestampCoverage,
      trades_with_max_capital_at_risk: risks.length,
      capital_at_risk_coverage: capitalAtRiskCoverage,
      annualization_periods_per_year: annualization?.periodsPerYear ?? null,
      annualization_risk_free_rate_annual: annualization?.riskFreeRateAnnual ?? null,
    },
    unavailable_reasons: reasons,
  };
}

export const computeBacktestMetrics = calculateBacktestMetrics;
export const summarizeBacktestMetrics = calculateBacktestMetrics;
