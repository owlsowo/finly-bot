import { createHash } from "node:crypto";

const TRADING_DAYS = 252;
const CASH = "CASH";

function fail(message) {
  throw new TypeError(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

function canonicalNumber(value) {
  return Number(Number(value).toPrecision(15));
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("market-data date is invalid");
  return date.toISOString().slice(0, 10);
}

function positiveNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) fail(`${label} must be positive and finite`);
  return numeric;
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + ((value - average) ** 2), 0)
      / (values.length - 1),
  );
}

export const AEGIS_Q_LEGACY_PARAMETERS = deepFreeze({
  trend_window: 200,
  momentum_window: 63,
  volatility_window: 20,
  volatility_threshold: 0.25,
  tqqq_weight: 0.70,
  qqq_weight: 1.00,
  rebalance_band: 0.05,
  slippage_bps_one_way: 5,
  cash_return: 0,
});

export const AEGIS_Q_LEGACY_METADATA = deepFreeze({
  reproduction_id: "aegis_q_legacy_equity_v1_pinned_76bb97e",
  status: "AUXILIARY_LEGACY_EQUITY_COMPARISON_ONLY",
  pinned_commit: "76bb97e9200c41c519440bb64ea40d2161367627",
  license: "MIT",
  source_urls: {
    repository: "https://github.com/VicensPaneque/aegis-q/tree/76bb97e9200c41c519440bb64ea40d2161367627",
    parameters: "https://github.com/VicensPaneque/aegis-q/blob/76bb97e9200c41c519440bb64ea40d2161367627/src/pnl_agent/config.py#L10-L27",
    strategy: "https://github.com/VicensPaneque/aegis-q/blob/76bb97e9200c41c519440bb64ea40d2161367627/src/pnl_agent/strategy.py#L27-L59",
    backtest: "https://github.com/VicensPaneque/aegis-q/blob/76bb97e9200c41c519440bb64ea40d2161367627/src/pnl_agent/backtest.py#L25-L205",
    published_metrics: "https://github.com/VicensPaneque/aegis-q/blob/76bb97e9200c41c519440bb64ea40d2161367627/reports/metrics.json",
    published_report: "https://github.com/VicensPaneque/aegis-q/blob/76bb97e9200c41c519440bb64ea40d2161367627/reports/BACKTEST_REPORT.md",
  },
  native_semantics: {
    signal: "QQQ close > inclusive SMA200 and QQQ 63-session close return > 0",
    low_volatility_risk_on: "If annualized sample RV20 <= 25%, target 70% TQQQ and 30% zero-return cash",
    high_volatility_risk_on: "If annualized sample RV20 > 25%, target 100% QQQ",
    risk_off: "Hold zero-return cash",
    timing: "Form signal at close t and execute using split-adjusted open t+1",
    rebalance: "Trade when the selected asset changes or target-weight drift reaches five percentage points",
    friction: "Charge 5 bp one way for each traded leg; commission is zero",
    return_definition: "Split-adjusted price returns; dividends and cash interest excluded",
  },
  claim_boundary: {
    eligible_as_finly_champion: false,
    submitted_options_pnl: false,
    comparison_role: "Auxiliary reproduction of a competitor's archived legacy equity strategy",
    panel_requirement: "A future runner must provide and hash-freeze a QQQ/TQQQ adjusted-open/close panel before observing outcomes",
  },
});

export const AEGIS_Q_PUBLISHED_METRICS = deepFreeze({
  QQQ: {
    annual_volatility: 0.22787217896967307,
    best_day: 0.09141867346693289,
    cagr: 0.1645925682908902,
    end: "2026-08-27",
    ending_value: 223980.6280268708,
    max_drawdown: -0.3710067047919542,
    observations: 1330,
    profit: 123980.6280268708,
    sharpe_0pct_cash: 0.7851299268978624,
    start: "2021-05-12",
    total_return: 1.239806280268708,
    worst_day: -0.06882230792049837,
  },
  TQQQ: {
    annual_volatility: 0.682827842961523,
    best_day: 0.24183673469387745,
    cagr: 0.2440062450542908,
    end: "2026-08-27",
    ending_value: 317560.277441374,
    max_drawdown: -0.8160227462786419,
    observations: 1330,
    profit: 217560.27744137403,
    sharpe_0pct_cash: 0.6634544889552761,
    start: "2021-05-12",
    total_return: 2.1756027744137403,
    worst_day: -0.20512542078401574,
  },
  agent: {
    annual_volatility: 0.2927572090474777,
    best_day: 0.09560737518093831,
    cagr: 0.2063201838796893,
    end: "2026-08-27",
    ending_value: 269849.54101804015,
    estimated_slippage_dollars: 5735.090337632874,
    max_drawdown: -0.3364827079567,
    observations: 1330,
    order_legs: 90,
    profit: 169849.54101804015,
    sharpe_0pct_cash: 0.790535550733135,
    start: "2021-05-12",
    total_return: 1.6984954101804015,
    trade_events: 72,
    turnover_multiple: 114.73004324276727,
    worst_day: -0.0912016155854819,
  },
});

function normalizedParameters(overrides = {}) {
  const parameters = { ...AEGIS_Q_LEGACY_PARAMETERS, ...overrides };
  for (const key of ["trend_window", "momentum_window", "volatility_window"]) {
    if (!Number.isSafeInteger(parameters[key]) || parameters[key] < 2) {
      fail(`${key} must be an integer of at least two sessions`);
    }
  }
  for (const key of ["volatility_threshold", "tqqq_weight", "qqq_weight", "rebalance_band"]) {
    if (!Number.isFinite(parameters[key]) || parameters[key] <= 0 || parameters[key] > 1) {
      fail(`${key} must be in (0, 1]`);
    }
  }
  if (!Number.isFinite(parameters.slippage_bps_one_way)
    || parameters.slippage_bps_one_way < 0
    || parameters.slippage_bps_one_way >= 10_000) {
    fail("slippage_bps_one_way must be in [0, 10000)");
  }
  if (parameters.cash_return !== 0) fail("the pinned legacy reproduction requires zero-return cash");
  return Object.freeze(parameters);
}

/**
 * Apply AEGIS-Q's published corporate-action rule to daily OHLC rows.
 * Each forward split multiplies pre-ex-date OHLC by old_rate / new_rate.
 * Volume is deliberately left untouched, matching the pinned Python source.
 */
export function normalizeAdjustedOhlc(rawRows, forwardSplits = []) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) fail("raw OHLC rows are required");
  if (!Array.isArray(forwardSplits)) fail("forward splits must be an array");

  const splits = forwardSplits.map((split) => {
    if (!split || typeof split.symbol !== "string" || split.symbol.length === 0) {
      fail("split symbol is required");
    }
    return Object.freeze({
      symbol: split.symbol.toUpperCase(),
      ex_date: isoDate(split.ex_date),
      old_rate: positiveNumber(split.old_rate, "split old_rate"),
      new_rate: positiveNumber(split.new_rate, "split new_rate"),
    });
  }).sort((left, right) => left.ex_date.localeCompare(right.ex_date)
    || left.symbol.localeCompare(right.symbol));

  const seen = new Set();
  const bars = rawRows.map((row) => {
    if (!row || typeof row.symbol !== "string" || row.symbol.length === 0) {
      fail("OHLC row symbol is required");
    }
    const symbol = row.symbol.toUpperCase();
    const date = isoDate(row.date);
    const key = `${date}\u0000${symbol}`;
    if (seen.has(key)) fail(`duplicate OHLC row for ${symbol} on ${date}`);
    seen.add(key);
    const factor = splits
      .filter((split) => split.symbol === symbol && date < split.ex_date)
      .reduce((product, split) => product * split.old_rate / split.new_rate, 1);
    const adjusted = {
      date,
      symbol,
      open: positiveNumber(row.open, `${symbol} open`) * factor,
      high: positiveNumber(row.high, `${symbol} high`) * factor,
      low: positiveNumber(row.low, `${symbol} low`) * factor,
      close: positiveNumber(row.close, `${symbol} close`) * factor,
    };
    if (row.volume !== undefined && row.volume !== null) {
      const volume = Number(row.volume);
      if (!Number.isFinite(volume) || volume < 0) fail(`${symbol} volume must be non-negative and finite`);
      adjusted.volume = volume;
    }
    return adjusted;
  }).sort((left, right) => left.date.localeCompare(right.date)
    || left.symbol.localeCompare(right.symbol));

  const symbols = [...new Set(bars.map((bar) => bar.symbol))].sort();
  const canonicalRows = bars.map((bar) => [
    bar.date,
    bar.symbol,
    canonicalNumber(bar.open),
    canonicalNumber(bar.high),
    canonicalNumber(bar.low),
    canonicalNumber(bar.close),
    bar.volume ?? null,
  ]);
  return deepFreeze({
    bars,
    symbols,
    first_date: bars[0].date,
    last_date: bars.at(-1).date,
    rows: bars.length,
    applied_forward_splits: splits,
    normalized_panel_sha256: sha256(canonicalRows),
  });
}

function barsFrom(value) {
  const bars = Array.isArray(value) ? value : value?.bars;
  if (!Array.isArray(bars) || bars.length === 0) fail("normalized OHLC bars are required");
  return bars;
}

function strictQqqTqqqPanel(value) {
  const bars = barsFrom(value);
  const byDate = new Map();
  for (const bar of bars) {
    const date = isoDate(bar.date);
    const symbol = String(bar.symbol ?? "").toUpperCase();
    if (!byDate.has(date)) byDate.set(date, new Map());
    if (byDate.get(date).has(symbol)) fail(`duplicate ${symbol} bar on ${date}`);
    byDate.get(date).set(symbol, {
      date,
      symbol,
      open: positiveNumber(bar.open, `${symbol} open`),
      close: positiveNumber(bar.close, `${symbol} close`),
    });
  }
  const panel = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, rows]) => {
    for (const symbol of ["QQQ", "TQQQ"]) {
      if (!rows.has(symbol)) fail(`incomplete QQQ/TQQQ panel on ${date}`);
    }
    return Object.freeze({
      date,
      QQQ: Object.freeze(rows.get("QQQ")),
      TQQQ: Object.freeze(rows.get("TQQQ")),
    });
  });
  return Object.freeze(panel);
}

/**
 * Build close-of-session decisions using only observations dated at or before
 * each signal date. The returned signal remains queued until the next row's
 * adjusted open; this function itself performs no execution.
 */
export function buildCausalSignals(normalizedOhlc, parameterOverrides = {}) {
  const parameters = normalizedParameters(parameterOverrides);
  const panel = strictQqqTqqqPanel(normalizedOhlc);
  const closes = panel.map((point) => point.QQQ.close);
  const returns = closes.map((close, index) => (
    index === 0 ? null : close / closes[index - 1] - 1
  ));
  const signals = [];
  let rollingSum = 0;

  for (let index = 0; index < panel.length; index += 1) {
    rollingSum += closes[index];
    if (index >= parameters.trend_window) rollingSum -= closes[index - parameters.trend_window];
    const sma = index >= parameters.trend_window - 1
      ? rollingSum / parameters.trend_window
      : null;
    const momentum = index >= parameters.momentum_window
      ? closes[index] / closes[index - parameters.momentum_window] - 1
      : null;
    const volatilityStart = index - parameters.volatility_window + 1;
    const volatilityReturns = volatilityStart >= 1
      ? returns.slice(volatilityStart, index + 1)
      : [];
    const deviation = volatilityReturns.length === parameters.volatility_window
      ? sampleStandardDeviation(volatilityReturns)
      : null;
    const realizedVolatility = deviation === null ? null : deviation * Math.sqrt(TRADING_DAYS);
    const formed = Number.isFinite(sma)
      && Number.isFinite(momentum)
      && Number.isFinite(realizedVolatility);
    const trendPositive = formed && closes[index] > sma;
    const momentumPositive = formed && momentum > 0;
    const riskOn = trendPositive && momentumPositive;
    const lowVolatility = riskOn && realizedVolatility <= parameters.volatility_threshold;

    let regime = "RISK_OFF";
    let targetSymbol = CASH;
    let targetWeight = 0;
    let reason = null;
    if (lowVolatility) {
      regime = "RISK_ON_LOW_VOL";
      targetSymbol = "TQQQ";
      targetWeight = parameters.tqqq_weight;
      reason = "Trend and momentum are positive; volatility is below the threshold.";
    } else if (riskOn) {
      regime = "RISK_ON_HIGH_VOL";
      targetSymbol = "QQQ";
      targetWeight = parameters.qqq_weight;
      reason = "Trend and momentum are positive; volatility is above the TQQQ threshold.";
    } else if (formed) {
      const failed = [];
      if (!trendPositive) failed.push("trend");
      if (!momentumPositive) failed.push("momentum");
      reason = `Risk-off because ${failed.join(", ")} confirmation is negative.`;
    }

    signals.push(Object.freeze({
      bar_date: panel[index].date,
      formed,
      regime,
      target_symbol: targetSymbol,
      target_weight: targetWeight,
      qqq_close: closes[index],
      sma,
      momentum,
      realized_volatility: realizedVolatility,
      trend_positive: trendPositive,
      momentum_positive: momentumPositive,
      risk_on: riskOn,
      reason,
    }));
  }
  return Object.freeze(signals);
}

/** Calculate the pinned report's price-return statistics. */
export function calculatePerformanceMetrics(equityPoints, {
  valueKey = "value",
  initialCapital = 100_000,
} = {}) {
  if (!Array.isArray(equityPoints) || equityPoints.length < 2) {
    fail("at least two equity observations are required");
  }
  positiveNumber(initialCapital, "initial capital");
  const points = equityPoints.map((point) => ({
    date: isoDate(point.date),
    value: positiveNumber(point[valueKey], `equity ${valueKey}`),
  }));
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].date <= points[index - 1].date) fail("equity dates must be strictly increasing");
  }
  const returns = points.slice(1).map((point, index) => point.value / points[index].value - 1);
  const deviation = sampleStandardDeviation(returns) ?? 0;
  const averageReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const elapsedYears = (Date.parse(`${points.at(-1).date}T00:00:00Z`)
    - Date.parse(`${points[0].date}T00:00:00Z`)) / (365.25 * 86_400_000);
  if (!(elapsedYears > 0)) fail("equity period must span more than zero calendar days");
  const first = points[0].value;
  const last = points.at(-1).value;
  let peak = 0;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.min(maxDrawdown, point.value / peak - 1);
  }
  return deepFreeze({
    start: points[0].date,
    end: points.at(-1).date,
    observations: points.length,
    ending_value: last,
    profit: last - initialCapital,
    total_return: last / first - 1,
    cagr: (last / first) ** (1 / elapsedYears) - 1,
    annual_volatility: deviation * Math.sqrt(TRADING_DAYS),
    sharpe_0pct_cash: deviation > 0 ? averageReturn / deviation * Math.sqrt(TRADING_DAYS) : 0,
    max_drawdown: maxDrawdown,
    best_day: Math.max(...returns),
    worst_day: Math.min(...returns),
  });
}

/**
 * Reproduce the pinned next-open evaluator. The function is deliberately
 * data-source agnostic: it consumes a previously normalized panel and never
 * downloads or mutates market data.
 */
export function simulateAegisQLegacy(normalizedOhlc, {
  initialCapital = 100_000,
  ...parameterOverrides
} = {}) {
  positiveNumber(initialCapital, "initial capital");
  const parameters = normalizedParameters(parameterOverrides);
  const panel = strictQqqTqqqPanel(normalizedOhlc);
  const signals = buildCausalSignals(normalizedOhlc, parameters);
  const firstSignalIndex = signals.findIndex((signal) => signal.formed);
  if (firstSignalIndex < 0) fail("dataset is too short to form the strategy signal");
  const startIndex = firstSignalIndex + 1;
  if (startIndex >= panel.length - 1) fail("at least two next-open observations are required after the first signal");

  let cash = initialCapital;
  let shares = 0;
  let held = CASH;
  const slippage = parameters.slippage_bps_one_way / 10_000;
  const decisions = [];
  const equityCurve = [];
  let tradeEvents = 0;
  let orderLegs = 0;
  let turnoverDollars = 0;
  let slippageDollars = 0;
  const startOpenQqq = panel[startIndex].QQQ.open;
  const startOpenTqqq = panel[startIndex].TQQQ.open;

  for (let index = startIndex; index < panel.length; index += 1) {
    const point = panel[index];
    const signal = signals[index - 1];
    const heldPrice = held === CASH ? 0 : point[held].open;
    const equityBefore = cash + shares * heldPrice;
    if (!(equityBefore > 0)) fail(`non-positive portfolio equity on ${point.date}`);
    const desired = signal.target_symbol;
    const targetWeight = signal.target_weight;
    const currentWeight = held === CASH ? 0 : shares * heldPrice / equityBefore;
    const needsTrade = desired !== held
      || (desired !== CASH && Math.abs(currentWeight - targetWeight) >= parameters.rebalance_band);
    let eventTurnover = 0;
    let eventSlippage = 0;
    const beforeHeld = held;

    if (needsTrade) {
      tradeEvents += 1;
      if (held !== CASH && desired !== held) {
        const marketValue = shares * heldPrice;
        const cost = marketValue * slippage;
        cash += marketValue - cost;
        eventTurnover += marketValue;
        eventSlippage += cost;
        shares = 0;
        held = CASH;
        orderLegs += 1;
      }

      if (desired === CASH) {
        // The sale above completes the transition to zero-return cash.
      } else if (held === CASH) {
        const buyPrice = point[desired].open;
        const budget = cash * targetWeight;
        shares = budget / (buyPrice * (1 + slippage));
        cash -= budget;
        held = desired;
        eventTurnover += budget;
        eventSlippage += budget * slippage / (1 + slippage);
        orderLegs += 1;
      } else {
        const desiredValue = equityBefore * targetWeight;
        const currentValue = shares * heldPrice;
        const delta = desiredValue - currentValue;
        if (delta > 0) {
          const spend = Math.min(delta, cash);
          shares += spend / (heldPrice * (1 + slippage));
          cash -= spend;
          eventTurnover += spend;
          eventSlippage += spend * slippage / (1 + slippage);
          orderLegs += 1;
        } else if (delta < 0) {
          const marketValue = Math.min(-delta, currentValue);
          shares -= marketValue / heldPrice;
          cash += marketValue * (1 - slippage);
          eventTurnover += marketValue;
          eventSlippage += marketValue * slippage;
          orderLegs += 1;
        }
      }
    }

    turnoverDollars += eventTurnover;
    slippageDollars += eventSlippage;
    const finalHeldPrice = held === CASH ? 0 : point[held].open;
    const equityAfter = cash + shares * finalHeldPrice;
    decisions.push(Object.freeze({
      date: point.date,
      signal_bar_date: signal.bar_date,
      regime: signal.regime,
      target_symbol: desired,
      target_weight: targetWeight,
      position_before: beforeHeld,
      position_after: held,
      weight_before: currentWeight,
      traded: needsTrade,
      turnover_dollars: eventTurnover,
      estimated_slippage_dollars: eventSlippage,
      equity_after_trade: equityAfter,
    }));
    equityCurve.push(Object.freeze({
      date: point.date,
      agent: equityAfter,
      QQQ: initialCapital * point.QQQ.open / startOpenQqq,
      TQQQ: initialCapital * point.TQQQ.open / startOpenTqqq,
      position: held,
    }));
  }

  const metrics = {
    agent: calculatePerformanceMetrics(equityCurve, { valueKey: "agent", initialCapital }),
    QQQ: calculatePerformanceMetrics(equityCurve, { valueKey: "QQQ", initialCapital }),
    TQQQ: calculatePerformanceMetrics(equityCurve, { valueKey: "TQQQ", initialCapital }),
  };
  metrics.agent = deepFreeze({
    ...metrics.agent,
    trade_events: tradeEvents,
    order_legs: orderLegs,
    turnover_multiple: turnoverDollars / initialCapital,
    estimated_slippage_dollars: slippageDollars,
  });
  const latest = [...signals].reverse().find((signal) => signal.formed);
  const latestSignal = {
    bar_date: latest.bar_date,
    momentum: latest.momentum,
    qqq_close: latest.qqq_close,
    realized_volatility: latest.realized_volatility,
    reason: latest.reason,
    regime: latest.regime,
    sma: latest.sma,
    target_symbol: latest.target_symbol,
    target_weight: latest.target_weight,
  };
  return deepFreeze({
    equity_curve: equityCurve,
    decisions,
    metrics,
    latest_signal: latestSignal,
    assumptions: {
      initial_capital: initialCapital,
      execution: "Signal at close t; rebalance at open t+1",
      slippage_bps_one_way: parameters.slippage_bps_one_way,
      commission: 0,
      cash_return: 0,
      dividends: "Excluded; results are split-adjusted price returns",
      rebalance_band: parameters.rebalance_band,
    },
    reproduction_metadata: AEGIS_Q_LEGACY_METADATA,
  });
}

/** Compare a reproduced metric bundle with the pinned report, field by field. */
export function verifyPublishedMetrics(resultOrMetrics, {
  expected = AEGIS_Q_PUBLISHED_METRICS,
  absoluteTolerance = 1e-8,
  relativeTolerance = 1e-10,
} = {}) {
  if (!resultOrMetrics || typeof resultOrMetrics !== "object") fail("reproduced metrics are required");
  if (!Number.isFinite(absoluteTolerance) || absoluteTolerance < 0
    || !Number.isFinite(relativeTolerance) || relativeTolerance < 0) {
    fail("verification tolerances must be non-negative and finite");
  }
  const actual = resultOrMetrics.metrics ?? resultOrMetrics;
  const checks = [];
  for (const portfolio of ["agent", "QQQ", "TQQQ"]) {
    if (!actual[portfolio] || !expected[portfolio]) fail(`missing ${portfolio} metrics`);
    for (const [field, expectedValue] of Object.entries(expected[portfolio])) {
      const actualValue = actual[portfolio][field];
      let passed = false;
      let absoluteError = null;
      let tolerance = null;
      if (typeof expectedValue === "number") {
        absoluteError = Number.isFinite(actualValue) ? Math.abs(actualValue - expectedValue) : null;
        if (Number.isInteger(expectedValue)) {
          tolerance = 0;
          passed = actualValue === expectedValue;
        } else {
          tolerance = absoluteTolerance + relativeTolerance * Math.abs(expectedValue);
          passed = absoluteError !== null && absoluteError <= tolerance;
        }
      } else {
        passed = actualValue === expectedValue;
      }
      checks.push(Object.freeze({
        path: `metrics.${portfolio}.${field}`,
        expected: expectedValue,
        actual: actualValue ?? null,
        absolute_error: absoluteError,
        tolerance,
        passed,
      }));
    }
  }
  const failed = checks.filter((check) => !check.passed);
  return deepFreeze({
    verified: failed.length === 0,
    compared_fields: checks.length,
    failed_fields: failed.map((check) => check.path),
    checks,
    published_source_url: AEGIS_Q_LEGACY_METADATA.source_urls.published_metrics,
    claim_boundary: AEGIS_Q_LEGACY_METADATA.claim_boundary,
  });
}
