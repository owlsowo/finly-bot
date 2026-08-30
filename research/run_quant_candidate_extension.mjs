import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEconomicStatisticalEvidence,
  probabilisticDeflatedSharpeEvidence,
} from "../lib/economic_statistics.mjs";
import {
  alpacaHistoricalCredentialsFromEnv,
  HistoricalAlpacaClient,
} from "../lib/historical_alpaca.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "research/output");
const jsonOutput = resolve(outputDirectory, "quant_candidate_extension.json");
const reportOutput = resolve(outputDirectory, "quant_candidate_extension_report.md");
const existingEconomicReportPath = resolve(projectRoot, "public/data/economic_research.json");

const PROTOCOL = Object.freeze({
  schema_version: "finly_quant_candidate_extension_protocol.v1",
  status: "exploratory_research_extension",
  requested_start: "2004-01-01",
  requested_end: "2026-08-28",
  development: Object.freeze({ start: "2008-06-01", end: "2017-12-31" }),
  validation: Object.freeze({ start: "2018-01-01", end: "2024-12-31" }),
  post_holdout_research_extension: Object.freeze({ start: "2025-01-01", end: "2026-08-28" }),
  execution_lag: "signal at adjusted close t; rebalance at adjusted close t+1; position first earns adjusted close-to-close return t+1 to t+2",
  rebalance_interval_sessions: 5,
  base_one_way_cost_bps_per_traded_notional: 1,
  cost_sensitivity_bps: Object.freeze([1, 5, 10]),
  base_target_annualized_volatility: 0.10,
  target_volatility_sensitivity: Object.freeze([0.08, 0.10, 0.12]),
  realized_volatility_lookback_sessions: 20,
  trend_horizons_sessions: Object.freeze([21, 63, 252]),
  short_borrow_cost_annualized: 0.005,
  maximum_gross_exposure: 1,
  leverage_allowed: false,
  cash_proxy: "BIL adjusted-close total return",
  selection_information: "development and validation only; no 2025-2026 row enters qualification, scoring, or tie-breaking",
  selection_objective: "highest minimum BIL-excess Sharpe across development and validation among candidates that beat BIL in both partitions, have positive BIL-excess Sharpe in both, have at least 5% average absolute SPY utilization, and have shallower validation drawdown than SPY",
  claim_boundary: "The candidate family was defined after prior Finly results had been seen. The exercise is disciplined exploratory research, not preregistration or independent proof of alpha.",
  promotion_gate_source: "data/private/quant_method_audit.md sections 1 and 8",
});

const CANDIDATES = Object.freeze([
  Object.freeze({ id: "bil_cash", label: "BIL cash baseline", kind: "bil_cash", role: "baseline" }),
  Object.freeze({ id: "spy_buy_hold", label: "SPY buy-and-hold baseline", kind: "spy_buy_hold", role: "baseline" }),
  Object.freeze({ id: "vol_target_10", label: "SPY 10% volatility-target baseline", kind: "vol_target", role: "baseline" }),
  Object.freeze({
    id: "frozen_finly",
    label: "Frozen Finly 21/63/252 relative-trend ensemble",
    kind: "frozen_finly",
    role: "candidate",
    literature_basis: "Moskowitz, Ooi, and Pedersen; Hurst, Ooi, and Pedersen; Moreira and Muir",
  }),
  Object.freeze({
    id: "absolute_252_cash",
    label: "252-session absolute momentum, otherwise BIL",
    kind: "absolute_252_cash",
    role: "candidate",
    literature_basis: "Antonacci absolute momentum; Moskowitz, Ooi, and Pedersen",
  }),
  Object.freeze({
    id: "absolute_majority_cash",
    label: "21/63/252 majority absolute momentum, otherwise BIL",
    kind: "absolute_majority_cash",
    role: "candidate",
    literature_basis: "Multi-horizon time-series momentum adaptation",
  }),
  Object.freeze({
    id: "signed_ensemble_unlevered",
    label: "Signed multi-horizon trend with uninvested collateral",
    kind: "signed_ensemble_unlevered",
    role: "candidate",
    literature_basis: "Moskowitz, Ooi, and Pedersen signed time-series momentum",
  }),
  Object.freeze({
    id: "frozen_drawdown_brake",
    label: "Frozen Finly with a fixed drawdown brake",
    kind: "frozen_drawdown_brake",
    role: "candidate",
    literature_basis: "Drawdown-controlled allocation literature",
  }),
  Object.freeze({
    id: "frozen_volatility_brake",
    label: "Frozen Finly with a fixed high-volatility brake",
    kind: "frozen_volatility_brake",
    role: "candidate",
    literature_basis: "Moreira and Muir; Barroso and Santa-Clara",
  }),
  Object.freeze({
    id: "dual_momentum_cross_asset_gate",
    label: "Frozen Finly with a 252-session SPY/TLT/GLD dual-momentum gate",
    kind: "dual_momentum_cross_asset_gate",
    role: "candidate",
    literature_basis: "Antonacci absolute and relative momentum",
  }),
]);

const SELECTABLE_IDS = Object.freeze(CANDIDATES.filter((candidate) => candidate.role === "candidate").map((candidate) => candidate.id));
const DECLARED_STRATEGY_TRIALS = 53;
const TRIAL_COUNT_BASIS = "Conservative floor covering at least 44 registered extension, manual, and causal expert-selector variants, prior v1 candidates and tested target-volatility variants, plus three subsequently run fixed VIX/curve/combined variants; the true cumulative human/code count is still not known exactly.";
const SYMBOLS = Object.freeze(["SPY", "BIL", "TLT", "GLD"]);
const SOURCE_ACCEPTANCE = Object.freeze({
  design_status: "Explicit long-horizon-use thresholds set during this exploratory extension after initial overlap inspection; not preregistered.",
  minimum_common_session_coverage: 0.995,
  minimum_daily_return_correlation_risk_assets: 0.995,
  minimum_daily_return_correlation_cash_proxy: 0.95,
  maximum_median_absolute_daily_return_difference: 0.00005,
  maximum_p95_absolute_daily_return_difference: 0.0006,
  maximum_absolute_terminal_log_wealth_difference: 0.01,
});

const REGIME_SLICES = Object.freeze([
  Object.freeze({ id: "2008_2009", label: "2008-2009 GFC", start: "2008-01-01", end: "2009-12-31" }),
  Object.freeze({ id: "2011", label: "2011 stress", start: "2011-01-01", end: "2011-12-31" }),
  Object.freeze({ id: "2013_2015", label: "2013-2015", start: "2013-01-01", end: "2015-12-31" }),
  Object.freeze({ id: "2015_2016", label: "2015-2016", start: "2015-01-01", end: "2016-12-31" }),
  Object.freeze({ id: "q4_2018", label: "Q4 2018", start: "2018-10-01", end: "2018-12-31" }),
  Object.freeze({ id: "2020", label: "2020 COVID shock and rebound", start: "2020-01-01", end: "2020-12-31" }),
  Object.freeze({ id: "2022", label: "2022 inflation/rate shock", start: "2022-01-01", end: "2022-12-31" }),
  Object.freeze({ id: "2023_2026", label: "2023-2026 recent regime", start: "2023-01-01", end: "2026-08-28" }),
  Object.freeze({ id: "seen_2025_2026", label: "Already-seen post-holdout extension", start: "2025-01-01", end: "2026-08-28" }),
]);

const SOURCES = Object.freeze([
  Object.freeze({
    title: "Time Series Momentum",
    authors: "Tobias J. Moskowitz, Yao Hua Ooi, and Lasse Heje Pedersen",
    url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2089463",
    design_use: "Fixed 1- to 12-month directional trend signals; this study uses a single-ETF, unlevered adaptation.",
  }),
  Object.freeze({
    title: "A Century of Evidence on Trend-Following Investing",
    authors: "Brian K. Hurst, Yao Hua Ooi, and Lasse Heje Pedersen",
    url: "https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing",
    design_use: "The predeclared 1-, 3-, and 12-month horizon ensemble.",
  }),
  Object.freeze({
    title: "Absolute Momentum: A Simple Rule-Based Strategy and Universal Trend-Following Overlay",
    authors: "Gary Antonacci",
    url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2244633",
    design_use: "Long/cash absolute momentum and the bounded cross-asset relative-momentum gate.",
  }),
  Object.freeze({
    title: "Volatility-Managed Portfolios",
    authors: "Alan Moreira and Tyler Muir",
    url: "https://www.nber.org/papers/w22208",
    design_use: "Lagged inverse-volatility scaling, capped at one rather than levered.",
  }),
  Object.freeze({
    title: "Momentum Has Its Moments",
    authors: "Pedro Barroso and Pedro Santa-Clara",
    url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2041429",
    design_use: "A fixed high-volatility brake as a falsifiable crash-risk overlay.",
  }),
  Object.freeze({
    title: "The Deflated Sharpe Ratio",
    authors: "David H. Bailey and Marcos Lopez de Prado",
    url: "https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf",
    design_use: "Multiple-testing and non-normality-aware Sharpe falsification.",
  }),
  Object.freeze({
    title: "A Reality Check for Data Snooping",
    authors: "Halbert White",
    url: "https://users.ssc.wisc.edu/~behansen/718/White2000.pdf",
    design_use: "Shared-block maximum-statistic bootstrap across the disclosed candidate family.",
  }),
  Object.freeze({
    title: "Alpaca Historical Stock Bars",
    authors: "Alpaca",
    url: "https://docs.alpaca.markets/reference/stockbars",
    design_use: "Authenticated, adjusted SIP overlap reference for source reconciliation.",
  }),
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

function quantile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function sha256(value) {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(payload).digest("hex");
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function isoDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new TypeError("invalid market-data timestamp");
  return date.toISOString().slice(0, 10);
}

function validateSeries(series, label) {
  if (!Array.isArray(series) || series.length < 300) throw new TypeError(`${label} has insufficient history`);
  let prior = "";
  return series.map((point, index) => {
    const date = String(point?.date ?? "");
    const close = Number(point?.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= prior) throw new TypeError(`${label} dates are invalid or unsorted at ${index}`);
    if (!Number.isFinite(close) || close <= 0) throw new TypeError(`${label} adjusted close is invalid at ${index}`);
    prior = date;
    return Object.freeze({ date, close });
  });
}

async function fetchYahooAdjustedSeries(symbol) {
  const period1 = Math.floor(Date.parse(`${PROTOCOL.requested_start}T00:00:00Z`) / 1_000);
  const period2 = Math.floor((Date.parse(`${PROTOCOL.requested_end}T00:00:00Z`) + 86_400_000) / 1_000);
  const url = new URL(`/v8/finance/chart/${symbol}`, "https://query1.finance.yahoo.com");
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("includeAdjustedClose", "true");
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json", "user-agent": "FinlyResearch/1.0" },
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
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = Number(adjusted[index]);
    if (!Number.isFinite(close) || close <= 0) {
      nullRows += 1;
      continue;
    }
    series.push({ date: isoDate(Number(timestamps[index]) * 1_000), close });
  }
  return Object.freeze({
    symbol,
    series: validateSeries(series, `Yahoo ${symbol}`),
    provenance: Object.freeze({
      provider: "Yahoo Finance chart endpoint",
      host: url.host,
      path: url.pathname,
      adjusted_close_field: "chart.result[0].indicators.adjclose[0].adjclose",
      read_only: true,
      response_sha256: sha256(raw),
      normalized_series_sha256: sha256(series.map((point) => [point.date, round(point.close, 10)])),
      raw_rows: timestamps.length,
      accepted_rows: series.length,
      omitted_null_rows: nullRows,
      first_date: series[0]?.date ?? null,
      last_date: series.at(-1)?.date ?? null,
      raw_response_persisted: false,
      service_boundary: "Free endpoint without an availability or revision SLA; admitted only after overlap reconciliation to Alpaca SIP.",
    }),
  });
}

async function fetchAlpacaSeries(symbol, client) {
  const response = await client.getStockBars(symbol, {
    start: PROTOCOL.requested_start,
    end: PROTOCOL.requested_end,
    timeframe: "1Day",
    feed: "sip",
    adjustment: "all",
    limit: 10_000,
  });
  const series = validateSeries(response.bars.map((bar) => ({ date: isoDate(bar.t), close: Number(bar.c) })), `Alpaca ${symbol}`);
  return Object.freeze({
    symbol,
    series,
    provenance: Object.freeze({
      provider: response.provenance.provider,
      host: "data.alpaca.markets",
      path: response.provenance.path,
      feed: "sip",
      adjustment: "all",
      read_only: true,
      page_count: response.provenance.page_count,
      normalized_series_sha256: sha256(series.map((point) => [point.date, round(point.close, 10)])),
      accepted_rows: series.length,
      first_date: series[0].date,
      last_date: series.at(-1).date,
      raw_response_persisted: false,
    }),
  });
}

function alignSeriesByDate(seriesBySymbol) {
  const maps = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, new Map(seriesBySymbol[symbol].map((point) => [point.date, point.close]))]));
  const commonDates = [...maps.SPY.keys()].filter((date) => SYMBOLS.every((symbol) => maps[symbol].has(date))).sort();
  if (commonDates.length < 300) throw new Error("common multi-asset history is too short");
  const points = commonDates.map((date) => Object.freeze({
    date,
    ...Object.fromEntries(SYMBOLS.map((symbol) => [symbol, maps[symbol].get(date)])),
  }));
  return Object.freeze({
    points: Object.freeze(points),
    common_start: points[0].date,
    common_end: points.at(-1).date,
    common_sessions: points.length,
    dropped_noncommon_sessions: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, seriesBySymbol[symbol].length - points.length])),
    normalized_panel_sha256: sha256(points.map((point) => [point.date, ...SYMBOLS.map((symbol) => round(point[symbol], 10))])),
  });
}

function correlation(left, right) {
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
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function reconcileSymbol(symbol, yahooSeries, alpacaSeries) {
  const yahooMap = new Map(yahooSeries.map((point) => [point.date, point.close]));
  const alpacaMap = new Map(alpacaSeries.map((point) => [point.date, point.close]));
  const overlapStart = alpacaSeries[0].date;
  const overlapEnd = alpacaSeries.at(-1).date;
  const yahooOverlapCount = yahooSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd).length;
  const alpacaOverlapCount = alpacaSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd).length;
  const dates = [...alpacaMap.keys()].filter((date) => yahooMap.has(date)).sort();
  const yahooReturns = [];
  const alpacaReturns = [];
  for (let index = 1; index < dates.length; index += 1) {
    yahooReturns.push(yahooMap.get(dates[index]) / yahooMap.get(dates[index - 1]) - 1);
    alpacaReturns.push(alpacaMap.get(dates[index]) / alpacaMap.get(dates[index - 1]) - 1);
  }
  const differences = yahooReturns.map((value, index) => value - alpacaReturns[index]);
  const absoluteDifferences = differences.map(Math.abs);
  const largestDiscrepancies = differences.map((difference, index) => ({
    date: dates[index + 1],
    yahoo_return: yahooReturns[index],
    alpaca_return: alpacaReturns[index],
    difference,
  })).sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference)).slice(0, 5);
  const yahooTerminal = yahooMap.get(dates.at(-1)) / yahooMap.get(dates[0]) - 1;
  const alpacaTerminal = alpacaMap.get(dates.at(-1)) / alpacaMap.get(dates[0]) - 1;
  const terminalLogWealthDifference = Math.log1p(yahooTerminal) - Math.log1p(alpacaTerminal);
  const metrics = {
    overlap_start: dates[0],
    overlap_end: dates.at(-1),
    common_sessions: dates.length,
    yahoo_overlap_sessions: yahooOverlapCount,
    alpaca_overlap_sessions: alpacaOverlapCount,
    common_session_coverage: round(dates.length / Math.max(yahooOverlapCount, alpacaOverlapCount)),
    yahoo_only_sessions: yahooOverlapCount - dates.length,
    alpaca_only_sessions: alpacaOverlapCount - dates.length,
    daily_return_observations: differences.length,
    daily_return_correlation: round(correlation(yahooReturns, alpacaReturns), 10),
    mean_signed_daily_return_difference: round(mean(differences), 10),
    mean_absolute_daily_return_difference: round(mean(absoluteDifferences), 10),
    median_absolute_daily_return_difference: round(quantile(absoluteDifferences, 0.5), 10),
    p95_absolute_daily_return_difference: round(quantile(absoluteDifferences, 0.95), 10),
    maximum_absolute_daily_return_difference: round(Math.max(...absoluteDifferences), 10),
    largest_daily_return_discrepancies: largestDiscrepancies.map((item) => ({
      date: item.date,
      yahoo_return: round(item.yahoo_return, 10),
      alpaca_return: round(item.alpaca_return, 10),
      difference: round(item.difference, 10),
    })),
    yahoo_terminal_return: round(yahooTerminal),
    alpaca_terminal_return: round(alpacaTerminal),
    terminal_return_difference: round(yahooTerminal - alpacaTerminal),
    terminal_log_wealth_difference: round(terminalLogWealthDifference, 10),
  };
  const correlationThreshold = symbol === "BIL"
    ? SOURCE_ACCEPTANCE.minimum_daily_return_correlation_cash_proxy
    : SOURCE_ACCEPTANCE.minimum_daily_return_correlation_risk_assets;
  const gates = {
    common_session_coverage: metrics.common_session_coverage >= SOURCE_ACCEPTANCE.minimum_common_session_coverage,
    daily_return_correlation: metrics.daily_return_correlation >= correlationThreshold,
    median_absolute_daily_return_difference: metrics.median_absolute_daily_return_difference <= SOURCE_ACCEPTANCE.maximum_median_absolute_daily_return_difference,
    p95_absolute_daily_return_difference: metrics.p95_absolute_daily_return_difference <= SOURCE_ACCEPTANCE.maximum_p95_absolute_daily_return_difference,
    terminal_log_wealth_difference: Math.abs(metrics.terminal_log_wealth_difference) <= SOURCE_ACCEPTANCE.maximum_absolute_terminal_log_wealth_difference,
  };
  return Object.freeze({ ...metrics, acceptance_gates: gates, accepted: Object.values(gates).every(Boolean) });
}

function seriesReturns(points, symbol) {
  return points.slice(1).map((point, index) => point[symbol] / points[index][symbol] - 1);
}

function realizedVolatility(returns, signalIndex, lookback, targetVolatility) {
  const end = signalIndex - 1;
  const start = end - lookback + 1;
  if (start < 0) return { volatility: null, scale: 0 };
  const sigma = sampleStandardDeviation(returns.slice(start, end + 1));
  const volatility = sigma === null ? null : sigma * Math.sqrt(252);
  return {
    volatility,
    scale: !Number.isFinite(volatility) || volatility <= 0 ? 0 : Math.min(1, targetVolatility / volatility),
  };
}

function logReturn(points, symbol, startIndex, endIndex) {
  if (startIndex < 0 || endIndex >= points.length || startIndex >= endIndex) return null;
  return Math.log(points[endIndex][symbol] / points[startIndex][symbol]);
}

function excessMomentum(points, signalIndex, lookback) {
  const spy = logReturn(points, "SPY", signalIndex - lookback, signalIndex);
  const bil = logReturn(points, "BIL", signalIndex - lookback, signalIndex);
  return spy === null || bil === null ? null : spy - bil;
}

function underlyingDrawdown(points, signalIndex, lookback) {
  if (signalIndex - lookback + 1 < 0) return null;
  const closes = points.slice(signalIndex - lookback + 1, signalIndex + 1).map((point) => point.SPY);
  return points[signalIndex].SPY / Math.max(...closes) - 1;
}

function candidateSpyWeight(candidate, context) {
  const { points, returnsBySymbol, signalIndex, targetVolatility } = context;
  const { volatility, scale } = realizedVolatility(
    returnsBySymbol.SPY,
    signalIndex,
    PROTOCOL.realized_volatility_lookback_sessions,
    targetVolatility,
  );
  if (candidate.kind === "bil_cash") return 0;
  if (candidate.kind === "spy_buy_hold") return 1;
  if (candidate.kind === "vol_target") return scale;
  const momenta = PROTOCOL.trend_horizons_sessions.map((lookback) => excessMomentum(points, signalIndex, lookback));
  if (momenta.some((value) => value === null)) return 0;
  const positiveFraction = momenta.filter((value) => value > 0).length / momenta.length;
  const frozen = positiveFraction * scale;
  if (candidate.kind === "frozen_finly") return frozen;
  if (candidate.kind === "absolute_252_cash") return momenta.at(-1) > 0 ? scale : 0;
  if (candidate.kind === "absolute_majority_cash") return positiveFraction >= (2 / 3) ? scale : 0;
  if (candidate.kind === "signed_ensemble_unlevered") {
    const signedScore = mean(momenta.map((value) => (value > 0 ? 1 : value < 0 ? -1 : 0)));
    return signedScore * scale;
  }
  if (candidate.kind === "frozen_drawdown_brake") {
    const drawdown = underlyingDrawdown(points, signalIndex, 63);
    return frozen * (drawdown !== null && drawdown <= -0.10 ? 0.5 : 1);
  }
  if (candidate.kind === "frozen_volatility_brake") {
    return frozen * (volatility !== null && volatility >= 0.25 ? 0.5 : 1);
  }
  if (candidate.kind === "dual_momentum_cross_asset_gate") {
    const spy = logReturn(points, "SPY", signalIndex - 252, signalIndex);
    const bil = logReturn(points, "BIL", signalIndex - 252, signalIndex);
    const tlt = logReturn(points, "TLT", signalIndex - 252, signalIndex);
    const gld = logReturn(points, "GLD", signalIndex - 252, signalIndex);
    const gate = spy > bil && spy >= Math.max(tlt, gld);
    return gate ? frozen : 0;
  }
  throw new TypeError(`unsupported candidate kind: ${candidate.kind}`);
}

function buildReturnRows(points, {
  targetVolatility = PROTOCOL.base_target_annualized_volatility,
  oneWayCostBps = PROTOCOL.base_one_way_cost_bps_per_traded_notional,
  rebalanceAnchor = 0,
} = {}) {
  if (!Array.isArray(points) || points.length < 300) throw new TypeError("research points are insufficient");
  if (!Number.isFinite(targetVolatility) || targetVolatility <= 0 || targetVolatility > 1) throw new TypeError("target volatility is invalid");
  if (!Number.isFinite(oneWayCostBps) || oneWayCostBps < 0 || oneWayCostBps > 100) throw new TypeError("cost is invalid");
  if (!Number.isInteger(rebalanceAnchor) || rebalanceAnchor < 0 || rebalanceAnchor >= PROTOCOL.rebalance_interval_sessions) throw new TypeError("rebalance anchor is invalid");
  const returnsBySymbol = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, seriesReturns(points, symbol)]));
  const runningSpyPeak = [];
  let spyPeak = 0;
  for (const point of points) {
    spyPeak = Math.max(spyPeak, point.SPY);
    runningSpyPeak.push(spyPeak);
  }
  const priorWeights = new Map(CANDIDATES.map((candidate) => [candidate.id, { spy: 0, bil: 1 }]));
  const rows = [];
  for (let signalIndex = 252; signalIndex < points.length - 2; signalIndex += 1) {
    const rebalanced = (signalIndex - 252 - rebalanceAnchor) % PROTOCOL.rebalance_interval_sessions === 0;
    const nextSpyReturn = points[signalIndex + 2].SPY / points[signalIndex + 1].SPY - 1;
    const nextBilReturn = points[signalIndex + 2].BIL / points[signalIndex + 1].BIL - 1;
    const priorVolatility = realizedVolatility(
      returnsBySymbol.SPY,
      signalIndex,
      PROTOCOL.realized_volatility_lookback_sessions,
      targetVolatility,
    ).volatility;
    const priorDrawdown = points[signalIndex].SPY / runningSpyPeak[signalIndex] - 1;
    const priorTrend = excessMomentum(points, signalIndex, 252);
    const strategies = {};
    for (const candidate of CANDIDATES) {
      const prior = priorWeights.get(candidate.id);
      const spyWeight = rebalanced
        ? candidateSpyWeight(candidate, { points, returnsBySymbol, signalIndex, targetVolatility })
        : prior.spy;
      if (!Number.isFinite(spyWeight) || Math.abs(spyWeight) > 1 + 1e-12) throw new Error(`${candidate.id} violated the no-leverage bound`);
      const bilWeight = 1 - Math.abs(spyWeight);
      const grossExposure = Math.abs(spyWeight) + bilWeight;
      const turnoverNotional = Math.abs(spyWeight - prior.spy) + Math.abs(bilWeight - prior.bil);
      const transactionCost = turnoverNotional * oneWayCostBps / 10_000;
      const shortBorrowCost = Math.max(0, -spyWeight) * PROTOCOL.short_borrow_cost_annualized / 252;
      const grossReturn = spyWeight * nextSpyReturn + bilWeight * nextBilReturn;
      const netReturn = grossReturn - transactionCost - shortBorrowCost;
      if (netReturn <= -1 || !Number.isFinite(netReturn)) throw new Error(`${candidate.id} produced an invalid return`);
      strategies[candidate.id] = Object.freeze({
        exposure: round(spyWeight),
        spy_weight: round(spyWeight),
        cash_exposure: round(bilWeight),
        bil_weight: round(bilWeight),
        gross_exposure: round(grossExposure),
        turnover: round(Math.abs(spyWeight - prior.spy)),
        turnover_notional: round(turnoverNotional),
        gross_return: round(grossReturn),
        transaction_cost: round(transactionCost),
        financing_cost: round(shortBorrowCost),
        net_return: round(netReturn),
      });
      priorWeights.set(candidate.id, { spy: spyWeight, bil: bilWeight });
    }
    rows.push(Object.freeze({
      signal_date: points[signalIndex].date,
      rebalance_date: points[signalIndex + 1].date,
      execution_return_date: points[signalIndex + 2].date,
      rebalanced,
      underlying_return: round(nextSpyReturn),
      cash_return: round(nextBilReturn),
      prior_close_regime: Object.freeze({
        spy_volatility_20_session_annualized: round(priorVolatility),
        spy_volatility_bucket: priorVolatility < 0.15 ? "lt_15pct" : priorVolatility <= 0.25 ? "15_to_25pct" : "gt_25pct",
        spy_drawdown_from_running_peak: round(priorDrawdown),
        spy_drawdown_bucket: priorDrawdown > -0.10 ? "lt_10pct" : priorDrawdown >= -0.20 ? "10_to_20pct" : "gt_20pct",
        spy_minus_bil_252_trend: priorTrend > 0 ? "positive" : "nonpositive",
      }),
      strategies: Object.freeze(strategies),
    }));
  }
  return Object.freeze(rows);
}

function rowsWithin(rows, start, end) {
  return rows.filter((row) => row.execution_return_date >= start && row.execution_return_date <= end);
}

function maximumDrawdownEvidence(returns, dates) {
  let equity = 1;
  let peak = 1;
  let peakDate = dates[0];
  let maximum = 0;
  let maximumPeakDate = dates[0];
  let valleyDate = dates[0];
  let recoveryDate = null;
  let searchingRecovery = false;
  for (let index = 0; index < returns.length; index += 1) {
    equity *= 1 + returns[index];
    if (equity > peak) {
      peak = equity;
      peakDate = dates[index];
      if (searchingRecovery) {
        recoveryDate = dates[index];
        searchingRecovery = false;
      }
    }
    const drawdown = equity / peak - 1;
    if (drawdown < maximum) {
      maximum = drawdown;
      maximumPeakDate = peakDate;
      valleyDate = dates[index];
      recoveryDate = null;
      searchingRecovery = true;
    }
  }
  return {
    maximum_drawdown: maximum,
    peak_date: maximumPeakDate,
    valley_date: valleyDate,
    recovery_date: recoveryDate,
  };
}

function worstCompoundedWindow(returns, dates, sessions) {
  if (returns.length < sessions) return null;
  let worst = Infinity;
  let start = null;
  let end = null;
  for (let right = sessions - 1; right < returns.length; right += 1) {
    let growth = 1;
    for (let index = right - sessions + 1; index <= right; index += 1) growth *= 1 + returns[index];
    const value = growth - 1;
    if (value < worst) {
      worst = value;
      start = dates[right - sessions + 1];
      end = dates[right];
    }
  }
  return { sessions, return: round(worst), start_date: start, end_date: end };
}

function calculateMetrics(rows, candidateId) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const records = rows.map((row) => row.strategies?.[candidateId]);
  if (records.some((record) => !record)) throw new TypeError(`rows omit candidate ${candidateId}`);
  const dates = rows.map((row) => row.execution_return_date);
  const returns = records.map((record) => record.net_return);
  const grossReturns = records.map((record) => record.gross_return);
  const excessReturns = rows.map((row, index) => returns[index] - row.cash_return);
  const growth = returns.reduce((value, item) => value * (1 + item), 1);
  const grossGrowth = grossReturns.reduce((value, item) => value * (1 + item), 1);
  const bilGrowth = rows.reduce((value, row) => value * (1 + row.cash_return), 1);
  const annualizedReturn = growth ** (252 / rows.length) - 1;
  const dailyVolatility = sampleStandardDeviation(returns);
  const dailyExcessVolatility = sampleStandardDeviation(excessReturns);
  const negativeExcess = excessReturns.filter((value) => value < 0);
  const downsideDeviation = negativeExcess.length > 0 ? Math.sqrt(mean(negativeExcess.map((value) => value ** 2))) : null;
  const drawdown = maximumDrawdownEvidence(returns, dates);
  const leftTail = returns.filter((value) => value <= quantile(returns, 0.05));
  const calendarYears = {};
  for (let index = 0; index < rows.length; index += 1) {
    const year = dates[index].slice(0, 4);
    calendarYears[year] = (calendarYears[year] ?? 1) * (1 + returns[index]);
  }
  const calendarYearReturns = Object.fromEntries(Object.entries(calendarYears).map(([year, value]) => [year, round(value - 1)]));
  return Object.freeze({
    observations: rows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    total_return: round(growth - 1),
    gross_total_return: round(grossGrowth - 1),
    bil_total_return: round(bilGrowth - 1),
    total_return_minus_bil: round(growth - bilGrowth),
    annualized_return: round(annualizedReturn),
    annualized_volatility: round(dailyVolatility === null ? null : dailyVolatility * Math.sqrt(252)),
    bil_excess_sharpe: round(dailyExcessVolatility && dailyExcessVolatility > 0 ? mean(excessReturns) / dailyExcessVolatility * Math.sqrt(252) : null),
    bil_excess_sortino: round(downsideDeviation && downsideDeviation > 0 ? mean(excessReturns) / downsideDeviation * Math.sqrt(252) : null),
    maximum_drawdown: round(drawdown.maximum_drawdown),
    maximum_drawdown_peak_date: drawdown.peak_date,
    maximum_drawdown_valley_date: drawdown.valley_date,
    maximum_drawdown_recovery_date: drawdown.recovery_date,
    calmar_ratio: round(drawdown.maximum_drawdown < 0 ? annualizedReturn / Math.abs(drawdown.maximum_drawdown) : null),
    daily_return_p05: round(quantile(returns, 0.05)),
    daily_expected_shortfall_p05: round(leftTail.length > 0 ? mean(leftTail) : null),
    worst_day_return: round(Math.min(...returns)),
    worst_5_session_window: worstCompoundedWindow(returns, dates, 5),
    worst_20_session_window: worstCompoundedWindow(returns, dates, 20),
    average_spy_weight: round(mean(records.map((record) => record.spy_weight))),
    average_absolute_spy_weight: round(mean(records.map((record) => Math.abs(record.spy_weight)))),
    average_bil_weight: round(mean(records.map((record) => record.bil_weight))),
    maximum_gross_exposure: round(Math.max(...records.map((record) => record.gross_exposure))),
    long_spy_session_fraction: round(records.filter((record) => record.spy_weight > 0).length / records.length),
    short_spy_session_fraction: round(records.filter((record) => record.spy_weight < 0).length / records.length),
    at_least_95_percent_bil_session_fraction: round(records.filter((record) => record.bil_weight >= 0.95).length / records.length),
    cumulative_turnover_notional: round(records.reduce((sum, record) => sum + record.turnover_notional, 0)),
    annualized_turnover_notional: round(records.reduce((sum, record) => sum + record.turnover_notional, 0) * 252 / rows.length),
    modeled_transaction_cost_simple_sum: round(records.reduce((sum, record) => sum + record.transaction_cost, 0)),
    modeled_short_financing_cost_simple_sum: round(records.reduce((sum, record) => sum + record.financing_cost, 0)),
    positive_day_fraction: round(returns.filter((value) => value > 0).length / returns.length),
    calendar_year_returns: calendarYearReturns,
    positive_calendar_year_fraction: round(Object.values(calendarYearReturns).filter((value) => value > 0).length / Object.keys(calendarYearReturns).length),
  });
}

function metricsByCandidate(rows) {
  return Object.fromEntries(CANDIDATES.map((candidate) => [candidate.id, calculateMetrics(rows, candidate.id)]));
}

function dynamicRegimeEvidence(rows) {
  const dimensions = {
    prior_20_session_spy_volatility: ["lt_15pct", "15_to_25pct", "gt_25pct"],
    prior_spy_drawdown: ["lt_10pct", "10_to_20pct", "gt_20pct"],
    prior_252_session_spy_minus_bil_trend: ["positive", "nonpositive"],
  };
  const readBucket = {
    prior_20_session_spy_volatility: (row) => row.prior_close_regime.spy_volatility_bucket,
    prior_spy_drawdown: (row) => row.prior_close_regime.spy_drawdown_bucket,
    prior_252_session_spy_minus_bil_trend: (row) => row.prior_close_regime.spy_minus_bil_252_trend,
  };
  return Object.fromEntries(Object.entries(dimensions).map(([dimension, buckets]) => [dimension, Object.fromEntries(buckets.map((bucket) => {
    const relevant = rows.filter((row) => readBucket[dimension](row) === bucket);
    return [bucket, {
      observations: relevant.length,
      metrics: relevant.length >= 2 ? metricsByCandidate(relevant) : null,
    }];
  }))]));
}

function compareMetrics(left, right) {
  if (!left || !right) return null;
  return {
    total_return_difference: round(left.total_return - right.total_return),
    annualized_return_difference: round(left.annualized_return - right.annualized_return),
    bil_excess_sharpe_difference: round(left.bil_excess_sharpe - right.bil_excess_sharpe),
    maximum_drawdown_difference: round(left.maximum_drawdown - right.maximum_drawdown),
    annualized_volatility_ratio: round(left.annualized_volatility / right.annualized_volatility),
  };
}

function chooseCandidate(developmentMetrics, validationMetrics) {
  const validationSpy = validationMetrics.spy_buy_hold;
  const assessments = SELECTABLE_IDS.map((id) => {
    const development = developmentMetrics[id];
    const validation = validationMetrics[id];
    const gates = {
      development_has_two_years: development.observations >= 504,
      validation_has_two_years: validation.observations >= 504,
      development_beats_bil: development.total_return_minus_bil > 0,
      validation_beats_bil: validation.total_return_minus_bil > 0,
      development_positive_bil_excess_sharpe: development.bil_excess_sharpe > 0,
      validation_positive_bil_excess_sharpe: validation.bil_excess_sharpe > 0,
      meaningful_utilization: Math.min(development.average_absolute_spy_weight, validation.average_absolute_spy_weight) >= 0.05,
      validation_drawdown_shallower_than_spy: validation.maximum_drawdown > validationSpy.maximum_drawdown,
      no_leverage: Math.max(development.maximum_gross_exposure, validation.maximum_gross_exposure) <= 1,
    };
    const robustScore = Math.min(development.bil_excess_sharpe, validation.bil_excess_sharpe);
    return {
      id,
      eligible: Object.values(gates).every(Boolean),
      gates,
      robust_score_min_partition_bil_excess_sharpe: round(robustScore),
      mean_partition_bil_excess_sharpe: round((development.bil_excess_sharpe + validation.bil_excess_sharpe) / 2),
    };
  });
  const ranked = assessments.filter((assessment) => assessment.eligible).sort((left, right) => {
    return right.robust_score_min_partition_bil_excess_sharpe - left.robust_score_min_partition_bil_excess_sharpe
      || right.mean_partition_bil_excess_sharpe - left.mean_partition_bil_excess_sharpe
      || left.id.localeCompare(right.id);
  });
  return Object.freeze({
    selected_id: ranked[0]?.id ?? null,
    selection_failed_closed: ranked.length === 0,
    ranked_eligible_ids: ranked.map((assessment) => assessment.id),
    assessments: Object.fromEntries(assessments.map((assessment) => [assessment.id, assessment])),
    information_cutoff: PROTOCOL.validation.end,
    post_holdout_rows_used: 0,
  });
}

function rollingWindowSummary(rows, candidateId, windowSessions) {
  if (rows.length < windowSessions) return null;
  const ids = [candidateId, "spy_buy_hold", "frozen_finly"];
  const prefixes = Object.fromEntries(ids.map((id) => {
    const prefix = [0];
    for (const row of rows) prefix.push(prefix.at(-1) + Math.log1p(row.strategies[id].net_return));
    return [id, prefix];
  }));
  const windows = [];
  for (let end = windowSessions; end <= rows.length; end += 1) {
    const start = end - windowSessions;
    const candidateReturn = Math.expm1(prefixes[candidateId][end] - prefixes[candidateId][start]);
    const spyReturn = Math.expm1(prefixes.spy_buy_hold[end] - prefixes.spy_buy_hold[start]);
    const frozenReturn = Math.expm1(prefixes.frozen_finly[end] - prefixes.frozen_finly[start]);
    windows.push({
      start_date: rows[start].execution_return_date,
      end_date: rows[end - 1].execution_return_date,
      candidate_return: candidateReturn,
      spy_return: spyReturn,
      frozen_return: frozenReturn,
    });
  }
  const returns = windows.map((window) => window.candidate_return);
  const worst = windows.reduce((left, right) => (right.candidate_return < left.candidate_return ? right : left));
  const best = windows.reduce((left, right) => (right.candidate_return > left.candidate_return ? right : left));
  return Object.freeze({
    window_sessions: windowSessions,
    window_count: windows.length,
    first_window_start: windows[0].start_date,
    last_window_end: windows.at(-1).end_date,
    positive_return_fraction: round(windows.filter((window) => window.candidate_return > 0).length / windows.length),
    beats_spy_fraction: round(windows.filter((window) => window.candidate_return > window.spy_return).length / windows.length),
    beats_frozen_finly_fraction: round(windows.filter((window) => window.candidate_return > window.frozen_return).length / windows.length),
    median_return: round(quantile(returns, 0.5)),
    worst_window: { start_date: worst.start_date, end_date: worst.end_date, return: round(worst.candidate_return) },
    best_window: { start_date: best.start_date, end_date: best.end_date, return: round(best.candidate_return) },
    interpretation: "Overlapping retrospective windows; not independent observations and not an untouched holdout.",
  });
}

function annualWalkForward(rows) {
  const folds = [];
  const stitchedRows = [];
  let liveWeights = { spy: 0, bil: 1 };
  for (let year = 2013; year <= 2024; year += 1) {
    const priorRows = rows.filter((row) => row.execution_return_date < `${year}-01-01`);
    const testRows = rowsWithin(rows, `${year}-01-01`, `${year}-12-31`);
    if (priorRows.length < 756 || testRows.length < 200) continue;
    const splitIndex = Math.max(504, Math.floor(priorRows.length * 0.70));
    if (priorRows.length - splitIndex < 252) continue;
    const developmentRows = priorRows.slice(0, splitIndex);
    const validationRows = priorRows.slice(splitIndex);
    const selection = chooseCandidate(metricsByCandidate(developmentRows), metricsByCandidate(validationRows));
    const selectedId = selection.selected_id ?? "bil_cash";
    const foldMetrics = calculateMetrics(testRows, selectedId);
    folds.push({
      year,
      training_start: priorRows[0].execution_return_date,
      training_end: priorRows.at(-1).execution_return_date,
      development_observations: developmentRows.length,
      validation_observations: validationRows.length,
      selected_id: selection.selected_id,
      fail_closed_to_bil: selection.selected_id === null,
      test_metrics: foldMetrics,
    });
    for (const [testIndex, row] of testRows.entries()) {
      const source = row.strategies[selectedId];
      const record = testIndex === 0 ? {
        ...source,
        turnover: round(Math.abs(source.spy_weight - liveWeights.spy)),
        turnover_notional: round(Math.abs(source.spy_weight - liveWeights.spy) + Math.abs(source.bil_weight - liveWeights.bil)),
        transaction_cost: round((Math.abs(source.spy_weight - liveWeights.spy) + Math.abs(source.bil_weight - liveWeights.bil)) * PROTOCOL.base_one_way_cost_bps_per_traded_notional / 10_000),
      } : source;
      if (testIndex === 0) record.net_return = round(record.gross_return - record.transaction_cost - record.financing_cost);
      stitchedRows.push({
        ...row,
        strategies: { walk_forward_selector: record },
      });
      liveWeights = { spy: source.spy_weight, bil: source.bil_weight };
    }
  }
  return Object.freeze({
    method: "For each calendar test year, use only earlier rows; split those rows 70/30 chronologically into development/validation, apply the fixed selection rule, then hold the chosen candidate for the next year. A failed fold holds BIL.",
    folds,
    selection_counts: Object.fromEntries([...new Set(folds.map((fold) => fold.selected_id ?? "FAIL_CLOSED_BIL"))].sort().map((id) => [id, folds.filter((fold) => (fold.selected_id ?? "FAIL_CLOSED_BIL") === id).length])),
    stitched_metrics: stitchedRows.length >= 2 ? calculateMetrics(stitchedRows, "walk_forward_selector") : null,
    claim_boundary: "Each fold is mechanically out of sample relative to that fold's selector, but the overall method and candidate family were designed after prior Finly results were observed.",
  });
}

function annualizedLogGrowth(rows, candidateId) {
  return rows.reduce((sum, row) => sum + Math.log1p(row.strategies[candidateId].net_return), 0) * 252 / rows.length;
}

function annualizedCashLogGrowth(rows) {
  return rows.reduce((sum, row) => sum + Math.log1p(row.cash_return), 0) * 252 / rows.length;
}

function annualOriginSlices(rows, windowSessions) {
  const firstIndexByYear = new Map();
  rows.forEach((row, index) => {
    const year = row.execution_return_date.slice(0, 4);
    if (!firstIndexByYear.has(year)) firstIndexByYear.set(year, index);
  });
  return [...firstIndexByYear.entries()].map(([originYear, startIndex]) => ({
    originYear,
    startIndex,
    slice: rows.slice(startIndex, startIndex + windowSessions),
  })).filter((item) => item.slice.length === windowSessions);
}

function matchedRiskWindowFamily(rows, candidateId, baselineId, windowSessions) {
  const windows = annualOriginSlices(rows, windowSessions).map(({ originYear, slice }) => {
    const candidateReturns = slice.map((row) => row.strategies[candidateId].net_return);
    const baselineReturns = slice.map((row) => row.strategies[baselineId].net_return);
    const candidateGrowth = annualizedLogGrowth(slice, candidateId);
    const baselineGrowth = annualizedLogGrowth(slice, baselineId);
    const bilGrowth = annualizedCashLogGrowth(slice);
    const candidateVolatility = sampleStandardDeviation(candidateReturns) * Math.sqrt(252);
    const baselineVolatility = sampleStandardDeviation(baselineReturns) * Math.sqrt(252);
    const mrer = candidateGrowth - (bilGrowth + (candidateVolatility / baselineVolatility) * (baselineGrowth - bilGrowth));
    const pairedExcessLogGrowth = slice.reduce((sum, row) => sum
      + Math.log1p(row.strategies[candidateId].net_return)
      - Math.log1p(row.strategies[baselineId].net_return), 0);
    const bilExcessLogGrowth = slice.reduce((sum, row) => sum
      + Math.log1p(row.strategies[candidateId].net_return)
      - Math.log1p(row.cash_return), 0);
    const candidateMetrics = calculateMetrics(slice, candidateId);
    const frozenMetrics = calculateMetrics(slice, "frozen_finly");
    return {
      origin_year: Number(originYear),
      start_date: slice[0].execution_return_date,
      end_date: slice.at(-1).execution_return_date,
      mrer: round(mrer, 10),
      candidate_annualized_log_growth: round(candidateGrowth, 10),
      baseline_annualized_log_growth: round(baselineGrowth, 10),
      bil_annualized_log_growth: round(bilGrowth, 10),
      candidate_annualized_volatility: round(candidateVolatility, 10),
      baseline_annualized_volatility: round(baselineVolatility, 10),
      paired_excess_log_growth: round(pairedExcessLogGrowth, 10),
      bil_excess_log_growth: round(bilExcessLogGrowth, 10),
      candidate_maximum_drawdown: candidateMetrics.maximum_drawdown,
      frozen_finly_maximum_drawdown: frozenMetrics.maximum_drawdown,
      drawdown_difference_to_frozen_finly: round(candidateMetrics.maximum_drawdown - frozenMetrics.maximum_drawdown, 10),
    };
  });
  const mrers = windows.map((window) => window.mrer);
  const positivePairedExcess = windows.map((window) => Math.max(0, window.paired_excess_log_growth));
  const totalPositivePairedExcess = positivePairedExcess.reduce((sum, value) => sum + value, 0);
  const summary = {
    baseline_id: baselineId,
    window_sessions: windowSessions,
    annual_origin_window_count: windows.length,
    first_origin_year: windows[0]?.origin_year ?? null,
    last_origin_year: windows.at(-1)?.origin_year ?? null,
    median_mrer: round(quantile(mrers, 0.5), 10),
    positive_mrer_fraction: round(mrers.filter((value) => value > 0).length / mrers.length, 10),
    worst_candidate_bil_excess_log_growth: round(Math.min(...windows.map((window) => window.bil_excess_log_growth)), 10),
    largest_positive_paired_excess_share: round(totalPositivePairedExcess > 0 ? Math.max(...positivePairedExcess) / totalPositivePairedExcess : null, 10),
    worst_candidate_maximum_drawdown: round(Math.min(...windows.map((window) => window.candidate_maximum_drawdown)), 10),
    worst_drawdown_difference_to_frozen_finly: round(Math.min(...windows.map((window) => window.drawdown_difference_to_frozen_finly)), 10),
    checks: {
      median_mrer_strictly_positive: quantile(mrers, 0.5) > 0,
      positive_mrer_fraction_at_least_60_percent: mrers.filter((value) => value > 0).length / mrers.length >= 0.60,
      worst_3y_bil_excess_log_growth_positive: windowSessions !== 756 || Math.min(...windows.map((window) => window.bil_excess_log_growth)) > 0,
      largest_3y_positive_paired_excess_share_at_most_50_percent: windowSessions !== 756 || (totalPositivePairedExcess > 0 && Math.max(...positivePairedExcess) / totalPositivePairedExcess <= 0.50),
      worst_3y_drawdown_no_more_than_2pp_worse_than_frozen: windowSessions !== 756 || Math.min(...windows.map((window) => window.drawdown_difference_to_frozen_finly)) >= -0.02,
      worst_3y_drawdown_not_worse_than_15_percent: windowSessions !== 756 || Math.min(...windows.map((window) => window.candidate_maximum_drawdown)) >= -0.15,
    },
  };
  return { summary, windows };
}

function pairedDifferenceRows(rows, baselineId) {
  return rows.map((row) => ({
    execution_return_date: row.execution_return_date,
    cash_return: 0,
    strategies: Object.fromEntries(SELECTABLE_IDS.map((id) => [id, {
      net_return: round(row.strategies[id].net_return - row.strategies[baselineId].net_return, 10),
    }])),
  }));
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

function circularBlockSums(values, take) {
  const observations = values.length;
  const sums = new Float64Array(observations);
  let running = 0;
  for (let offset = 0; offset < take; offset += 1) running += values[offset % observations];
  sums[0] = running;
  for (let start = 1; start < observations; start += 1) {
    running -= values[start - 1];
    running += values[(start + take - 1) % observations];
    sums[start] = running;
  }
  return sums;
}

function pairedFamilywiseBlockBootstrap(rows, baselineId, fixedCandidateId, blockLength, {
  iterations = 1_000,
  seed = 20_260_900,
} = {}) {
  const matrix = SELECTABLE_IDS.map((id) => rows.map((row) => row.strategies[id].net_return - row.strategies[baselineId].net_return));
  const observedMeans = matrix.map(mean);
  const centered = matrix.map((values, candidateIndex) => values.map((value) => value - observedMeans[candidateIndex]));
  const observations = rows.length;
  const rootN = Math.sqrt(observations);
  const fixedIndex = SELECTABLE_IDS.indexOf(fixedCandidateId);
  const observedFixedStatistic = rootN * observedMeans[fixedIndex];
  const random = mulberry32(seed);
  const fullBlockCount = Math.floor(observations / blockLength);
  const remainder = observations % blockLength;
  const fullBlockSums = centered.map((values) => circularBlockSums(values, blockLength));
  const remainderSums = remainder > 0 ? centered.map((values) => circularBlockSums(values, remainder)) : null;
  let exceedances = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sums = Array(SELECTABLE_IDS.length).fill(0);
    for (let block = 0; block < fullBlockCount; block += 1) {
      const start = Math.floor(random() * observations);
      for (let candidateIndex = 0; candidateIndex < centered.length; candidateIndex += 1) {
        sums[candidateIndex] += fullBlockSums[candidateIndex][start];
      }
    }
    if (remainderSums) {
      const start = Math.floor(random() * observations);
      for (let candidateIndex = 0; candidateIndex < centered.length; candidateIndex += 1) {
        sums[candidateIndex] += remainderSums[candidateIndex][start];
      }
    }
    const bootstrapMaximum = Math.max(...sums.map((sum) => rootN * sum / observations));
    if (bootstrapMaximum >= observedFixedStatistic) exceedances += 1;
  }
  return {
    method: "paired centered circular-block maximum-statistic bootstrap",
    baseline_id: baselineId,
    fixed_candidate_id: fixedCandidateId,
    candidate_ids: SELECTABLE_IDS,
    observations,
    iterations,
    block_length_sessions: blockLength,
    seed,
    observed_fixed_statistic: round(observedFixedStatistic, 10),
    fixed_candidate_familywise_adjusted_p_value: round((exceedances + 1) / (iterations + 1), 10),
    pass_at_5_percent: (exceedances + 1) / (iterations + 1) <= 0.05,
  };
}

function pairedStatisticalGate(rows, candidateId, baselineId, anchor) {
  const differenceRows = pairedDifferenceRows(rows, baselineId);
  const dsr = probabilisticDeflatedSharpeEvidence(differenceRows, SELECTABLE_IDS, {
    fixedCandidateId: candidateId,
    trialCount: DECLARED_STRATEGY_TRIALS,
    periodsPerYear: 252,
  });
  const blocks = Object.fromEntries([5, 20, 60].map((blockLength) => [String(blockLength), pairedFamilywiseBlockBootstrap(
    rows,
    baselineId,
    candidateId,
    blockLength,
    { iterations: 1_000, seed: 20_260_900 + anchor * 100 + blockLength + (baselineId === "vol_target_10" ? 10_000 : 0) },
  )]));
  const probability = dsr.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark;
  return {
    baseline_id: baselineId,
    deflated_sharpe: dsr,
    block_bootstrap: blocks,
    checks: {
      paired_deflated_sharpe_probability_at_least_95_percent: probability >= 0.95,
      familywise_p_at_most_5_percent_block_5: blocks["5"].pass_at_5_percent,
      familywise_p_at_most_5_percent_block_20: blocks["20"].pass_at_5_percent,
      familywise_p_at_most_5_percent_block_60: blocks["60"].pass_at_5_percent,
    },
  };
}

function allTrue(value) {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.every(allTrue);
  if (value && typeof value === "object") return Object.values(value).every(allTrue);
  return true;
}

function falseBooleanPaths(value, prefix = "") {
  if (typeof value === "boolean") return value ? [] : [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => falseBooleanPaths(item, prefix ? `${prefix}.${key}` : key));
}

function coreDirectionChecks(details) {
  const checks = {};
  for (const [baselineId, horizons] of Object.entries(details)) {
    checks[baselineId] = Object.fromEntries(Object.entries(horizons).map(([horizon, evidence]) => [horizon, {
      median_mrer_strictly_positive: evidence.summary.checks.median_mrer_strictly_positive,
      positive_mrer_fraction_at_least_60_percent: evidence.summary.checks.positive_mrer_fraction_at_least_60_percent,
    }]));
  }
  return checks;
}

function buildGateB(points, candidateId, regimeReportingComplete) {
  const baselines = ["frozen_finly", "vol_target_10"];
  const anchors = {};
  const costGrid = {};
  for (let anchor = 0; anchor < PROTOCOL.rebalance_interval_sessions; anchor += 1) {
    const rows = buildReturnRows(points, { rebalanceAnchor: anchor });
    const windowEvidence = Object.fromEntries(baselines.map((baselineId) => [baselineId, Object.fromEntries([252, 504, 756].map((windowSessions) => [String(windowSessions), matchedRiskWindowFamily(rows, candidateId, baselineId, windowSessions)]))]));
    const statisticalEvidence = Object.fromEntries(baselines.map((baselineId) => [baselineId, pairedStatisticalGate(rows, candidateId, baselineId, anchor)]));
    const checks = {
      core_direction: coreDirectionChecks(windowEvidence),
      three_year_tail_and_drawdown: Object.fromEntries(baselines.map((baselineId) => [baselineId, {
        worst_3y_bil_excess_log_growth_positive: windowEvidence[baselineId]["756"].summary.checks.worst_3y_bil_excess_log_growth_positive,
        largest_3y_positive_paired_excess_share_at_most_50_percent: windowEvidence[baselineId]["756"].summary.checks.largest_3y_positive_paired_excess_share_at_most_50_percent,
        worst_3y_drawdown_no_more_than_2pp_worse_than_frozen: windowEvidence[baselineId]["756"].summary.checks.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen,
        worst_3y_drawdown_not_worse_than_15_percent: windowEvidence[baselineId]["756"].summary.checks.worst_3y_drawdown_not_worse_than_15_percent,
      }])),
      paired_statistics: Object.fromEntries(baselines.map((baselineId) => [baselineId, statisticalEvidence[baselineId].checks])),
    };
    anchors[String(anchor)] = { window_evidence: windowEvidence, paired_statistics: statisticalEvidence, checks, passed: allTrue(checks) };
    costGrid[String(anchor)] = {};
    for (const costBps of PROTOCOL.cost_sensitivity_bps) {
      const costRows = buildReturnRows(points, { rebalanceAnchor: anchor, oneWayCostBps: costBps });
      const costEvidence = Object.fromEntries(baselines.map((baselineId) => [baselineId, Object.fromEntries([252, 504, 756].map((windowSessions) => [String(windowSessions), matchedRiskWindowFamily(costRows, candidateId, baselineId, windowSessions)]))]));
      const costChecks = coreDirectionChecks(costEvidence);
      costGrid[String(anchor)][String(costBps)] = { window_evidence: costEvidence, checks: costChecks, passed: allTrue(costChecks) };
    }
  }
  const requirements = {
    earliest_history_and_2013_2015_available: points[0].date <= "2007-12-31",
    every_completed_annual_origin_window_reported: Object.values(anchors).every((anchor) => ["252", "504", "756"].every((horizon) => anchor.window_evidence.frozen_finly[horizon].summary.annual_origin_window_count > 0)),
    every_predeclared_named_and_prior_close_regime_reported: regimeReportingComplete,
    all_five_rebalance_anchors_pass_base_gate: Object.values(anchors).every((anchor) => anchor.passed),
    all_five_rebalance_anchors_survive_1_5_10bp_cost_direction: Object.values(costGrid).every((anchor) => Object.values(anchor).every((cost) => cost.passed)),
    full_human_and_code_trial_registry_known: false,
    options_quote_and_spread_stress_not_applicable_to_spy_bil_core: true,
  };
  const failedDetails = [
    ...falseBooleanPaths(Object.fromEntries(Object.entries(anchors).map(([anchor, evidence]) => [anchor, evidence.checks])), "anchors"),
    ...falseBooleanPaths(Object.fromEntries(Object.entries(costGrid).map(([anchor, costs]) => [anchor, Object.fromEntries(Object.entries(costs).map(([cost, evidence]) => [cost, evidence.checks]))])), "cost_grid"),
    ...falseBooleanPaths(requirements, "requirements"),
  ];
  return {
    candidate_id: candidateId,
    method_source: "data/private/quant_method_audit.md sections 1 and 8",
    annual_origin_definition: "The first scored session in each calendar year; only windows containing exactly 252, 504, or 756 scored sessions are retained.",
    declared_strategy_trial_count: DECLARED_STRATEGY_TRIALS,
    trial_count_basis: TRIAL_COUNT_BASIS,
    anchors,
    cost_grid: costGrid,
    requirements,
    failed_boolean_paths: [...new Set(failedDetails)].sort(),
    passed: allTrue(requirements) && Object.values(anchors).every((anchor) => anchor.passed) && Object.values(costGrid).every((anchor) => Object.values(anchor).every((cost) => cost.passed)),
  };
}

function comparativeAssessment(developmentMetrics, validationMetrics, postMetrics) {
  const partitions = { development: developmentMetrics, validation: validationMetrics, post_holdout_research_extension: postMetrics };
  const alternatives = SELECTABLE_IDS.filter((id) => id !== "frozen_finly");
  const byCandidate = {};
  for (const id of alternatives) {
    byCandidate[id] = {};
    for (const [partition, metrics] of Object.entries(partitions)) {
      byCandidate[id][partition] = {
        beats_frozen_total_return: metrics[id].total_return > metrics.frozen_finly.total_return,
        beats_frozen_bil_excess_sharpe: metrics[id].bil_excess_sharpe > metrics.frozen_finly.bil_excess_sharpe,
        has_shallower_drawdown_than_frozen: metrics[id].maximum_drawdown > metrics.frozen_finly.maximum_drawdown,
        beats_spy_total_return: metrics[id].total_return > metrics.spy_buy_hold.total_return,
        beats_spy_bil_excess_sharpe: metrics[id].bil_excess_sharpe > metrics.spy_buy_hold.bil_excess_sharpe,
      };
    }
  }
  const consistent = (field) => alternatives.filter((id) => Object.values(byCandidate[id]).every((partition) => partition[field]));
  const validationAndRecent = alternatives.filter((id) => ["validation", "post_holdout_research_extension"].every((partition) => byCandidate[id][partition].beats_frozen_total_return && byCandidate[id][partition].beats_frozen_bil_excess_sharpe));
  return {
    by_candidate: byCandidate,
    candidates_beating_frozen_return_in_all_partitions: consistent("beats_frozen_total_return"),
    candidates_beating_frozen_sharpe_in_all_partitions: consistent("beats_frozen_bil_excess_sharpe"),
    candidates_with_shallower_drawdown_than_frozen_in_all_partitions: consistent("has_shallower_drawdown_than_frozen"),
    candidates_beating_spy_raw_return_in_all_partitions: consistent("beats_spy_total_return"),
    candidates_beating_frozen_return_and_sharpe_in_validation_and_seen_extension: validationAndRecent,
    full_replacement_found: alternatives.some((id) => Object.values(byCandidate[id]).every((partition) => partition.beats_frozen_total_return && partition.beats_frozen_bil_excess_sharpe && partition.has_shallower_drawdown_than_frozen)),
  };
}

function futurePerturbationPass(points, referenceRows) {
  const cutoffIndex = Math.floor(points.length * 0.62);
  const cutoffDate = points[cutoffIndex].date;
  const perturbed = points.map((point, index) => index <= cutoffIndex ? point : {
    ...point,
    SPY: point.SPY * 1.73,
    BIL: point.BIL * 0.91,
    TLT: point.TLT * 1.29,
    GLD: point.GLD * 0.77,
  });
  const changedRows = buildReturnRows(perturbed);
  const project = (rows) => rows.filter((row) => row.execution_return_date <= cutoffDate).map((row) => ({
    signal_date: row.signal_date,
    rebalance_date: row.rebalance_date,
    execution_return_date: row.execution_return_date,
    strategies: Object.fromEntries(CANDIDATES.map((candidate) => [candidate.id, row.strategies[candidate.id]])),
  }));
  return sha256(project(referenceRows)) === sha256(project(changedRows));
}

function stateContinuityPass(points) {
  for (let anchor = 0; anchor < PROTOCOL.rebalance_interval_sessions; anchor += 1) {
    const rows = buildReturnRows(points, { rebalanceAnchor: anchor });
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index].rebalanced) continue;
      for (const candidate of CANDIDATES) {
        if (rows[index].strategies[candidate.id].spy_weight !== rows[index - 1].strategies[candidate.id].spy_weight) return false;
      }
    }
  }
  return true;
}

function costImplementationPass(rows) {
  return rows.every((row) => CANDIDATES.every((candidate) => {
    const record = row.strategies[candidate.id];
    const expected = round(record.turnover_notional * PROTOCOL.base_one_way_cost_bps_per_traded_notional / 10_000);
    return Math.abs(record.transaction_cost - expected) <= 2e-8
      && Math.abs(record.net_return - round(record.gross_return - record.transaction_cost - record.financing_cost)) <= 2e-8;
  }));
}

function buildGateA(points, rows, gateB, sourceAccepted) {
  const checks = {
    immutable_pre_evaluation_freeze_exists: false,
    complete_human_and_code_trial_registry_frozen: false,
    output_schema_frozen_before_evaluation: false,
    every_date_through_2026_08_28_labeled_seen: true,
    chronology_and_full_session_lag_pass: rows.every((row) => row.signal_date < row.rebalance_date && row.rebalance_date < row.execution_return_date),
    future_data_perturbation_pass: futurePerturbationPass(points, rows),
    partition_boundary_excludes_seen_extension_from_selection: true,
    non_rebalance_state_continuity_pass_all_anchors: stateContinuityPass(points),
    turnover_and_cost_formula_pass: costImplementationPass(rows),
    aligned_panel_has_no_missing_prices: points.every((point) => SYMBOLS.every((symbol) => Number.isFinite(point[symbol]) && point[symbol] > 0)),
    deterministic_in_process_rerun_pass: sha256(rows) === sha256(buildReturnRows(points)),
    dataset_fingerprints_present: typeof sha256(points.map((point) => [point.date, ...SYMBOLS.map((symbol) => point[symbol])])) === "string",
    yahoo_alpaca_long_horizon_reconciliation_pass: sourceAccepted,
    all_five_rebalance_anchors_evaluated: Object.keys(gateB.anchors).length === 5,
    turnover_semantics_explicit: true,
  };
  return {
    method_source: "data/private/quant_method_audit.md section 8",
    checks,
    failed_boolean_paths: falseBooleanPaths(checks, "checks"),
    passed: allTrue(checks),
  };
}

function buildGateC() {
  const checks = {
    forward_policy_frozen_before_collection: false,
    at_least_60_new_market_sessions: false,
    at_least_12_scheduled_core_decisions: false,
    broker_reconciled_core_pnl_positive_and_better_than_both_baselines: false,
    forward_maximum_drawdown_at_most_10_percent: false,
    one_hundred_percent_decision_order_fill_position_fee_equity_reconciliation: false,
    zero_policy_broker_boundary_violations: false,
    options_has_50_completed_broker_reconciled_spreads: false,
    options_net_pnl_positive_under_frozen_cost_model: false,
  };
  return {
    method_source: "data/private/quant_method_audit.md section 8",
    checks,
    failed_boolean_paths: falseBooleanPaths(checks, "checks"),
    passed: false,
  };
}

function decideDisposition(gateA, gateB, gateC) {
  if (gateA.passed && gateB.passed && gateC.passed) return "PROMOTE";
  if (gateA.passed && gateB.passed) return "SHADOW_ONLY";
  return "KEEP_V1";
}

function formatPercent(value, digits = 2) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value, digits = 3) {
  return value === null || value === undefined ? "n/a" : Number(value).toFixed(digits);
}

function candidateTable(metrics, ids = CANDIDATES.map((candidate) => candidate.id)) {
  const labels = Object.fromEntries(CANDIDATES.map((candidate) => [candidate.id, candidate.label]));
  const lines = ["| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Avg. |SPY| |", "|---|---:|---:|---:|---:|---:|---:|"];
  for (const id of ids) {
    const item = metrics[id];
    if (!item) continue;
    lines.push(`| ${labels[id] ?? id} | ${formatPercent(item.total_return)} | ${formatPercent(item.annualized_return)} | ${formatPercent(item.annualized_volatility)} | ${formatNumber(item.bil_excess_sharpe)} | ${formatPercent(item.maximum_drawdown)} | ${formatPercent(item.average_absolute_spy_weight)} |`);
  }
  return lines.join("\n");
}

function renderReport(report) {
  const selectedId = report.selection.selected_id;
  const selectedLabel = CANDIDATES.find((candidate) => candidate.id === selectedId)?.label ?? "none";
  const post = report.evaluation.post_holdout_research_extension.metrics;
  const validation = report.selection.validation_metrics;
  const selectedPost = selectedId ? post[selectedId] : null;
  const currentPost = post.frozen_finly;
  const spyPost = post.spy_buy_hold;
  const verdict = !selectedId
    ? "No candidate passed the exploratory development/validation selector."
    : `The exploratory selector chose ${selectedLabel}, but this is not a promotion or a winner. On the already-seen 2025-2026 extension it ${selectedPost.bil_excess_sharpe > currentPost.bil_excess_sharpe ? "exceeded" : "trailed"} frozen Finly's BIL-excess Sharpe and ${selectedPost.total_return > spyPost.total_return ? "exceeded" : "trailed"} SPY's raw return.`;
  const reconciliationRows = SYMBOLS.map((symbol) => {
    const item = report.dataset.source_reconciliation.by_symbol[symbol];
    return `| ${symbol} | ${item.common_sessions} | ${formatNumber(item.daily_return_correlation, 6)} | ${formatPercent(item.median_absolute_daily_return_difference, 4)} | ${formatPercent(item.p95_absolute_daily_return_difference, 4)} | ${formatPercent(item.terminal_log_wealth_difference)} | ${item.accepted ? "PASS" : "FAIL"} |`;
  }).join("\n");
  const selectionRows = SELECTABLE_IDS.map((id) => {
    const assessment = report.selection.assessments[id];
    return `| ${id} | ${formatNumber(report.selection.development_metrics[id].bil_excess_sharpe)} | ${formatNumber(validation[id].bil_excess_sharpe)} | ${formatNumber(assessment.robust_score_min_partition_bil_excess_sharpe)} | ${assessment.eligible ? "yes" : "no"} |`;
  }).join("\n");
  const rolling = selectedId ? report.evaluation.rolling_windows[selectedId] : report.evaluation.rolling_windows.frozen_finly;
  const sources = report.sources.map((source) => `- [${source.title}](${source.url}) — ${source.design_use}`).join("\n");
  const gateA = report.promotion_decision.gate_a;
  const gateB = report.promotion_decision.gate_b;
  const gateC = report.promotion_decision.gate_c;
  const gateFailures = [
    ...gateA.failed_boolean_paths.map((path) => `- Gate A: \`${path}\``),
    ...gateB.failed_boolean_paths.map((path) => `- Gate B: \`${path}\``),
    ...gateC.failed_boolean_paths.map((path) => `- Gate C: \`${path}\``),
  ].join("\n");
  const gateBAnchorZeroRows = ["frozen_finly", "vol_target_10"].flatMap((baselineId) => [252, 504, 756].map((horizon) => {
    const summary = gateB.anchors["0"].window_evidence[baselineId][String(horizon)].summary;
    return `| ${baselineId} | ${horizon} | ${summary.annual_origin_window_count} | ${formatPercent(summary.median_mrer)} | ${formatPercent(summary.positive_mrer_fraction)} | ${summary.checks.median_mrer_strictly_positive ? "PASS" : "FAIL"} | ${summary.checks.positive_mrer_fraction_at_least_60_percent ? "PASS" : "FAIL"} |`;
  })).join("\n");
  return `# Finly quantitative candidate extension

Generated ${report.generated_at.slice(0, 10)}. Private research artifact; no public claim is changed by this report.

## Answer first

**Disposition: ${report.promotion_decision.disposition}.** ${verdict}

The economically honest question is not whether one backtest line is highest. It is whether an alternative improves a declared metric consistently across development, validation, rolling windows, subperiods, costs, and statistical corrections. The 2025-2026 interval has already been viewed, so this report labels it a **post-holdout research extension**, not a fresh holdout.

No tested candidate is authorized to replace frozen Finly. No candidate beat frozen Finly simultaneously on return, BIL-excess Sharpe, and drawdown in development, validation, and the seen extension; no candidate beat SPY's raw return in all three partitions. The independent A/B/C promotion rule retains v1 whenever any Gate A or Gate B Boolean fails.

## Explicit promotion gate

| Gate | Passed | Consequence |
|---|---:|---|
| A — freeze and engineering eligibility | ${gateA.passed ? "yes" : "no"} | Historical research was not frozen before its results were seen. |
| B — permission to enter prospective shadow | ${gateB.passed ? "yes" : "no"} | MRER, window frequency, costs, paired DSR, and 5/20/60 block tests must all pass against both baselines under all five anchors. |
| C — forward broker evidence | ${gateC.passed ? "yes" : "no"} | No new 60-session broker-reconciled v2 record exists. |

Every failed Boolean is listed at the end of this report and represented structurally in the JSON.

## Data decision

The uniform long-history panel uses Yahoo adjusted close because its 2016-2026 overlap passed explicit, usage-specific long-horizon reconciliation gates against authenticated Alpaca SIP adjusted bars. Those gates were set during this exploratory extension after initial overlap inspection, so they are not preregistered. No Yahoo/Alpaca splice is used. Exact common Yahoo history is ${report.dataset.research_panel.common_start} through ${report.dataset.research_panel.common_end} (${report.dataset.research_panel.common_sessions.toLocaleString()} complete sessions); scoring begins only after 252 complete lookback sessions on ${report.dataset.scored_start}.

| Symbol | Common overlap | Return correlation | Median abs. diff | 95th-pct abs. diff | Terminal log-wealth diff | Gate |
|---|---:|---:|---:|---:|---:|---:|
${reconciliationRows}

Yahoo is a free endpoint without a data SLA. Its four 28 August rows had null adjusted closes and were omitted without imputation, so the uniform panel ends 27 August; Alpaca's complete 28 August row remains separate for exact v1 replication. Raw responses are not stored, but response and normalized-series SHA-256 fingerprints are recorded in the JSON. Alpaca remains the authenticated overlap reference. The JSON also preserves the largest overlap disagreements, concentrated in the March 2020 stress period; this admission is for slow trend research, not event-level execution reconstruction.

## Candidate selection uses no 2025-2026 rows

Development is ${report.protocol.development.start} to ${report.protocol.development.end}; validation is ${report.protocol.validation.start} to ${report.protocol.validation.end}. The objective is the minimum of development and validation BIL-excess Sharpe, subject to positive BIL-relative evidence in both, meaningful utilization, no leverage, and shallower validation drawdown than SPY.

| Candidate | Development Sharpe | Validation Sharpe | Robust score | Eligible |
|---|---:|---:|---:|---:|
${selectionRows}

Exploratory selector choice, not promoted: **${selectedLabel}**. Selection receipt SHA-256: \`${report.selection.selection_sha256}\`.

### Validation metrics (2018-2024)

${candidateTable(validation)}

## Already-seen 2025-2026 research extension

${candidateTable(post)}

${selectedId ? `Selected-versus-frozen differences: return ${formatPercent(report.evaluation.post_holdout_research_extension.selected_comparisons.to_frozen_finly.total_return_difference)}, Sharpe ${formatNumber(report.evaluation.post_holdout_research_extension.selected_comparisons.to_frozen_finly.bil_excess_sharpe_difference)}, drawdown ${formatPercent(report.evaluation.post_holdout_research_extension.selected_comparisons.to_frozen_finly.maximum_drawdown_difference)}. Selected-versus-SPY raw return difference: ${formatPercent(report.evaluation.post_holdout_research_extension.selected_comparisons.to_spy.total_return_difference)}.` : "No selected candidate comparison is reported because selection failed closed."}

The same selector choice also trails the 10% volatility-target baseline in this seen extension by ${formatPercent(report.evaluation.post_holdout_research_extension.selected_comparisons.to_vol_target.total_return_difference)} of total return and ${formatNumber(report.evaluation.post_holdout_research_extension.selected_comparisons.to_vol_target.bil_excess_sharpe_difference)} Sharpe.

## The requested 2013-2015 check

${candidateTable(report.evaluation.regime_slices["2013_2015"].metrics)}

This interval is inside development, not an independent test. It is reported because it was explicitly requested and was not used as a separate tuning target.

## Rolling and walk-forward evidence

For ${selectedId ?? "frozen_finly"}, positive rolling-window fractions were ${formatPercent(rolling["252"].positive_return_fraction)} over 252 sessions, ${formatPercent(rolling["504"].positive_return_fraction)} over 504 sessions, and ${formatPercent(rolling["756"].positive_return_fraction)} over 756 sessions. The respective fractions beating SPY were ${formatPercent(rolling["252"].beats_spy_fraction)}, ${formatPercent(rolling["504"].beats_spy_fraction)}, and ${formatPercent(rolling["756"].beats_spy_fraction)}. These windows overlap and are not independent.

The annual walk-forward selector produced ${report.evaluation.walk_forward.folds.length} test-year folds from 2013 through 2024. Its stitched return was ${formatPercent(report.evaluation.walk_forward.stitched_metrics?.total_return)}, BIL-excess Sharpe ${formatNumber(report.evaluation.walk_forward.stitched_metrics?.bil_excess_sharpe)}, and maximum drawdown ${formatPercent(report.evaluation.walk_forward.stitched_metrics?.maximum_drawdown)}. Fold selection counts: ${Object.entries(report.evaluation.walk_forward.selection_counts).map(([id, count]) => `${id} ${count}`).join(", ")}.

## Costs, parameters, tails, and statistical gates

Base costs are one basis point per one-way traded notional. A long-only change from 0% to 100% SPY trades two notionals—sell BIL and buy SPY—so it costs two basis points. The signed strategy is capped at one unit of gross exposure, excludes short-sale proceeds from BIL, and pays a 50-basis-point annualized borrow charge on short notional.

Target-volatility and 1/5/10-basis-point cost sensitivities for the selected and frozen strategies are recorded in the JSON. Tail evidence includes daily 5% expected shortfall, worst day, worst five-session and 20-session windows, drawdown dates, turnover, long/short utilization, and cash utilization.

For the selected candidate, the selection-sample Deflated-Sharpe probability is ${formatPercent(report.statistics.selection_sample.probabilistic_deflated_sharpe.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark)} and the White-style familywise p-value is ${formatNumber(report.statistics.selection_sample.circular_block_reality_check.familywise_p_value, 5)}. The corresponding already-seen 2025-2026 values are ${formatPercent(report.statistics.post_holdout_research_extension.probabilistic_deflated_sharpe.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark)} and ${formatNumber(report.statistics.post_holdout_research_extension.circular_block_reality_check.familywise_p_value, 5)}. These are falsification tools, not proof of stationarity or future profitability.

### Gate B matched-risk evidence, anchor 0

MRER is annualized candidate log growth minus BIL growth plus the baseline's BIL-excess log growth scaled to the candidate's realized volatility. Promotion requires positive median MRER and at least 60% positive annual-origin windows versus **both** baselines for every horizon, under every anchor and cost stress.

| Baseline | Sessions | Windows | Median MRER | Positive fraction | Median gate | Frequency gate |
|---|---:|---:|---:|---:|---:|---:|
${gateBAnchorZeroRows}

The JSON contains the same window families for all five rebalance anchors, 1/5/10 bp each-way costs, paired Deflated-Sharpe probabilities using a conservative ${report.promotion_decision.gate_b.declared_strategy_trial_count}-trial declaration, and familywise circular-block tests at 5/20/60 sessions.

## What this can and cannot establish

- It can identify whether a small, literature-grounded rule improves return, Sharpe, drawdown, utilization, or cost robustness in these samples.
- It cannot make 2025-2026 fresh again, turn Yahoo into exchange-grade source data, establish live fill quality, or prove options profitability.
- Competitor projects are not simulated here because no public strategy specification has yet been shown to be faithful enough for like-for-like replication.
- Frozen Finly remains the incumbent. A new candidate would need a newly frozen, prospective Alpaca paper period after passing Gates A and B.

## Every failed promotion Boolean

${gateFailures || "None."}

## Primary sources

${sources}
`;
}

function safeJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError("report contains a non-finite number");
    return item;
  }, 2);
}

async function main() {
const credentials = alpacaHistoricalCredentialsFromEnv();
const alpacaClient = new HistoricalAlpacaClient(credentials);
const [yahooResults, alpacaResults] = await Promise.all([
  Promise.all(SYMBOLS.map((symbol) => fetchYahooAdjustedSeries(symbol))),
  Promise.all(SYMBOLS.map((symbol) => fetchAlpacaSeries(symbol, alpacaClient))),
]);
const yahooBySymbol = Object.fromEntries(yahooResults.map((result) => [result.symbol, result]));
const alpacaBySymbol = Object.fromEntries(alpacaResults.map((result) => [result.symbol, result]));
const reconciliationBySymbol = Object.fromEntries(SYMBOLS.map((symbol) => [
  symbol,
  reconcileSymbol(symbol, yahooBySymbol[symbol].series, alpacaBySymbol[symbol].series),
]));
const longHistoryAccepted = Object.values(reconciliationBySymbol).every((item) => item.accepted);
const yahooPanel = alignSeriesByDate(Object.fromEntries(SYMBOLS.map((symbol) => [symbol, yahooBySymbol[symbol].series])));
const alpacaPanel = alignSeriesByDate(Object.fromEntries(SYMBOLS.map((symbol) => [symbol, alpacaBySymbol[symbol].series])));
const researchPanel = longHistoryAccepted ? yahooPanel : alpacaPanel;
const sourceDecision = longHistoryAccepted
  ? "Yahoo adjusted-close panel admitted as a uniform long-history research source after all four symbols passed Alpaca overlap gates; no series splice."
  : "Yahoo long history rejected because at least one Alpaca overlap gate failed; 2013-2015 is unavailable and the research panel falls back to uniform Alpaca SIP history.";

const baseRows = buildReturnRows(researchPanel.points);
const alpacaRows = buildReturnRows(alpacaPanel.points);
const developmentRows = rowsWithin(baseRows, PROTOCOL.development.start, PROTOCOL.development.end);
const validationRows = rowsWithin(baseRows, PROTOCOL.validation.start, PROTOCOL.validation.end);
const postHoldoutRows = rowsWithin(baseRows, PROTOCOL.post_holdout_research_extension.start, PROTOCOL.post_holdout_research_extension.end);
if (developmentRows.length < 504 || validationRows.length < 504 || postHoldoutRows.length < 252) {
  throw new Error(`research partitions are too small after source admission: ${JSON.stringify({ longHistoryAccepted, reconciliationBySymbol, development: developmentRows.length, validation: validationRows.length, postHoldout: postHoldoutRows.length })}`);
}
const developmentMetrics = metricsByCandidate(developmentRows);
const validationMetrics = metricsByCandidate(validationRows);
const selection = chooseCandidate(developmentMetrics, validationMetrics);
const selectedId = selection.selected_id ?? "frozen_finly";
const selectionReceiptBody = {
  protocol: PROTOCOL,
  candidate_definitions: CANDIDATES,
  source_decision: sourceDecision,
  dataset_sha256: researchPanel.normalized_panel_sha256,
  development_metrics: developmentMetrics,
  validation_metrics: validationMetrics,
  selection,
};
const selectionReceipt = { ...selectionReceiptBody, selection_sha256: sha256(selectionReceiptBody) };

const postHoldoutMetrics = metricsByCandidate(postHoldoutRows);
const regimeSlices = Object.fromEntries(REGIME_SLICES.map((slice) => {
  const sliced = rowsWithin(baseRows, slice.start, slice.end);
  return [slice.id, {
    label: slice.label,
    requested_start: slice.start,
    requested_end: slice.end,
    observations: sliced.length,
    metrics: sliced.length >= 2 ? metricsByCandidate(sliced) : null,
  }];
}));
const dynamicRegimes = dynamicRegimeEvidence(baseRows);
const regimeReportingComplete = Object.values(regimeSlices).every((slice) => slice.observations >= 2)
  && Object.values(dynamicRegimes).every((dimension) => Object.values(dimension).every((bucket) => bucket.observations >= 2));
const rollingWindows = Object.fromEntries(CANDIDATES.map((candidate) => [candidate.id, Object.fromEntries([252, 504, 756].map((sessions) => [String(sessions), rollingWindowSummary(baseRows, candidate.id, sessions)]))]));
const walkForward = annualWalkForward(rowsWithin(baseRows, PROTOCOL.development.start, PROTOCOL.validation.end));

const sensitivityIds = [...new Set(["frozen_finly", selectedId])];
const targetVolatilitySensitivity = Object.fromEntries(PROTOCOL.target_volatility_sensitivity.map((targetVolatility) => {
  const rows = buildReturnRows(researchPanel.points, { targetVolatility });
  return [targetVolatility.toFixed(2), Object.fromEntries(sensitivityIds.map((id) => [id, {
    validation: calculateMetrics(rowsWithin(rows, PROTOCOL.validation.start, PROTOCOL.validation.end), id),
    post_holdout_research_extension: calculateMetrics(rowsWithin(rows, PROTOCOL.post_holdout_research_extension.start, PROTOCOL.post_holdout_research_extension.end), id),
  }]))];
}));
const costSensitivity = Object.fromEntries(PROTOCOL.cost_sensitivity_bps.map((oneWayCostBps) => {
  const rows = buildReturnRows(researchPanel.points, { oneWayCostBps });
  return [String(oneWayCostBps), Object.fromEntries(sensitivityIds.map((id) => [id, {
    validation: calculateMetrics(rowsWithin(rows, PROTOCOL.validation.start, PROTOCOL.validation.end), id),
    post_holdout_research_extension: calculateMetrics(rowsWithin(rows, PROTOCOL.post_holdout_research_extension.start, PROTOCOL.post_holdout_research_extension.end), id),
  }]))];
}));

const selectionSampleRows = rowsWithin(baseRows, PROTOCOL.development.start, PROTOCOL.validation.end);
const statistics = {
  declared_strategy_trials: DECLARED_STRATEGY_TRIALS,
  trial_count_basis: TRIAL_COUNT_BASIS,
  supplied_candidate_ids: SELECTABLE_IDS,
  selected_for_falsification: selectedId,
  selection_sample: buildEconomicStatisticalEvidence(selectionSampleRows, SELECTABLE_IDS, {
    fixedCandidateId: selectedId,
    trialCount: DECLARED_STRATEGY_TRIALS,
    periodsPerYear: 252,
    iterations: 1_000,
    blockLength: 20,
    seed: 20_260_829,
  }),
  post_holdout_research_extension: buildEconomicStatisticalEvidence(postHoldoutRows, SELECTABLE_IDS, {
    fixedCandidateId: selectedId,
    trialCount: DECLARED_STRATEGY_TRIALS,
    periodsPerYear: 252,
    iterations: 1_000,
    blockLength: 20,
    seed: 20_260_830,
  }),
};

let existingEconomicReport = null;
try {
  existingEconomicReport = JSON.parse(await readFile(existingEconomicReportPath, "utf8"));
} catch {
  existingEconomicReport = null;
}
const alpacaPostRows = rowsWithin(alpacaRows, PROTOCOL.post_holdout_research_extension.start, PROTOCOL.post_holdout_research_extension.end);
const alpacaFrozenMetrics = calculateMetrics(alpacaPostRows, "frozen_finly");
const existingFrozenMetrics = existingEconomicReport?.final_holdout?.selected_candidate_metrics ?? null;
const replicationDeltas = existingFrozenMetrics ? {
  total_return: round(alpacaFrozenMetrics.total_return - existingFrozenMetrics.total_return, 10),
  annualized_volatility: round(alpacaFrozenMetrics.annualized_volatility - existingFrozenMetrics.annualized_volatility, 10),
  maximum_drawdown: round(alpacaFrozenMetrics.maximum_drawdown - existingFrozenMetrics.maximum_drawdown, 10),
  bil_excess_sharpe: round(alpacaFrozenMetrics.bil_excess_sharpe - existingFrozenMetrics.bil_excess_sharpe, 10),
} : null;

const qa = {
  source_reconciliation_passed: longHistoryAccepted,
  exact_2013_2015_available: longHistoryAccepted && regimeSlices["2013_2015"].observations >= 500,
  development_observations: developmentRows.length,
  validation_observations: validationRows.length,
  post_holdout_observations: postHoldoutRows.length,
  selection_post_holdout_rows_used: selection.post_holdout_rows_used,
  all_candidates_within_gross_exposure_bound: CANDIDATES.every((candidate) => Math.max(...baseRows.map((row) => row.strategies[candidate.id].gross_exposure)) <= 1),
  full_session_lag_strictly_ordered: baseRows.every((row) => row.signal_date < row.rebalance_date && row.rebalance_date < row.execution_return_date),
  raw_market_rows_persisted: false,
  credentials_persisted: false,
  frozen_alpaca_replication_deltas: replicationDeltas,
  frozen_alpaca_replication_within_5e_6: replicationDeltas ? Object.values(replicationDeltas).every((value) => Math.abs(value) <= 0.000005) : null,
};
if (!qa.all_candidates_within_gross_exposure_bound || !qa.full_session_lag_strictly_ordered || selection.post_holdout_rows_used !== 0) {
  throw new Error("quantitative protocol invariant failed");
}

const comparisonAudit = comparativeAssessment(developmentMetrics, validationMetrics, postHoldoutMetrics);
const gateB = buildGateB(researchPanel.points, selectedId, regimeReportingComplete);
const gateA = buildGateA(researchPanel.points, baseRows, gateB, longHistoryAccepted);
const gateC = buildGateC();
const disposition = decideDisposition(gateA, gateB, gateC);

const reportBody = {
  schema_version: "finly_quant_candidate_extension.v1",
  generated_at: new Date().toISOString(),
  mutation_authorized: false,
  public_claims_changed: false,
  durable_alpha_proven: false,
  future_profitability_guaranteed: false,
  protocol: PROTOCOL,
  sources: SOURCES,
  candidate_definitions: CANDIDATES,
  dataset: {
    requested_start: PROTOCOL.requested_start,
    requested_end: PROTOCOL.requested_end,
    yahoo: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, yahooBySymbol[symbol].provenance])),
    alpaca: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, alpacaBySymbol[symbol].provenance])),
    source_reconciliation: {
      thresholds: SOURCE_ACCEPTANCE,
      by_symbol: reconciliationBySymbol,
      all_symbols_accepted: longHistoryAccepted,
      decision: sourceDecision,
      no_series_splice: true,
      gate_design_status: SOURCE_ACCEPTANCE.design_status,
    },
    research_panel: {
      provider: longHistoryAccepted ? "Yahoo adjusted close, uniform panel" : "Alpaca SIP adjustment=all, uniform panel",
      common_start: researchPanel.common_start,
      common_end: researchPanel.common_end,
      common_sessions: researchPanel.common_sessions,
      dropped_noncommon_sessions: researchPanel.dropped_noncommon_sessions,
      normalized_panel_sha256: researchPanel.normalized_panel_sha256,
      requested_final_session: "2026-08-28",
      final_session_status: researchPanel.common_end === "2026-08-28"
        ? "complete_adjusted_close"
        : "2026-08-28 Yahoo rows were present but all four adjusted closes were null; omitted without imputation",
      yahoo_null_adjusted_close_rows_on_2026_08_28: SYMBOLS.reduce((sum, symbol) => sum + (yahooBySymbol[symbol].provenance.last_date === "2026-08-28" ? 0 : 1), 0),
    },
    scored_start: baseRows[0].execution_return_date,
    scored_end: baseRows.at(-1).execution_return_date,
    scored_sessions: baseRows.length,
    raw_market_rows_embedded: false,
  },
  selection: {
    ...selection,
    selection_sha256: selectionReceipt.selection_sha256,
    selection_receipt_body_sha256: selectionReceipt.selection_sha256,
    development_metrics: developmentMetrics,
    validation_metrics: validationMetrics,
  },
  evaluation: {
    post_holdout_research_extension: {
      status: "already_seen_not_independent",
      start: PROTOCOL.post_holdout_research_extension.start,
      end: PROTOCOL.post_holdout_research_extension.end,
      metrics: postHoldoutMetrics,
      selected_comparisons: selection.selected_id ? {
        to_frozen_finly: compareMetrics(postHoldoutMetrics[selection.selected_id], postHoldoutMetrics.frozen_finly),
        to_spy: compareMetrics(postHoldoutMetrics[selection.selected_id], postHoldoutMetrics.spy_buy_hold),
        to_vol_target: compareMetrics(postHoldoutMetrics[selection.selected_id], postHoldoutMetrics.vol_target_10),
      } : null,
    },
    regime_slices: regimeSlices,
    prior_close_regimes: dynamicRegimes,
    rolling_windows: rollingWindows,
    walk_forward: walkForward,
    target_volatility_sensitivity: targetVolatilitySensitivity,
    one_way_cost_bps_sensitivity: costSensitivity,
  },
  statistics,
  comparative_assessment: comparisonAudit,
  promotion_decision: {
    disposition,
    incumbent_policy: "frozen_finly",
    evaluated_candidate: selectedId,
    selector_label: "development_validation_selector_choice_not_promoted",
    gate_a: gateA,
    gate_b: gateB,
    gate_c: gateC,
    exact_rule: "PROMOTE only if A+B+C pass; SHADOW_ONLY only if A+B pass while C is pending; KEEP_V1 if any Gate A or B item fails.",
  },
  alpaca_frozen_rule_replication: {
    metrics: alpacaFrozenMetrics,
    existing_public_metrics_present: Boolean(existingFrozenMetrics),
    deltas_to_existing_public_report: replicationDeltas,
  },
  qa,
  interpretation_rule: "An alternative honestly improves frozen Finly only where its named metric is better in validation and the already-seen extension; raw-return, risk-adjusted, and drawdown conclusions are reported separately. Beating SPY raw return is not inferred from lower volatility or shallower drawdown.",
  next_proof: "Retain v1. Any future v2 must be frozen before a new prospective Alpaca paper interval, pass Gate B without retuning, and then accumulate the Gate C broker-reconciled record; options and competitor claims remain separate until faithfully reproducible.",
};
const report = { ...reportBody, artifact_sha256: sha256(reportBody) };
const jsonText = `${safeJson(report)}\n`;
const markdown = renderReport(report);
await atomicWrite(jsonOutput, jsonText);
await atomicWrite(reportOutput, markdown);

console.log(JSON.stringify({
  json_output: jsonOutput.slice(projectRoot.length + 1),
  report_output: reportOutput.slice(projectRoot.length + 1),
  artifact_sha256: report.artifact_sha256,
  source_decision: sourceDecision,
  research_panel: report.dataset.research_panel,
  selected_id: selection.selected_id,
  disposition,
  gate_a_passed: gateA.passed,
  gate_b_passed: gateB.passed,
  gate_c_passed: gateC.passed,
  post_holdout_status: report.evaluation.post_holdout_research_extension.status,
  qa,
}, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export {
  CANDIDATES,
  PROTOCOL,
  SELECTABLE_IDS,
  alignSeriesByDate,
  buildReturnRows,
  calculateMetrics,
  chooseCandidate,
  costImplementationPass,
  decideDisposition,
  futurePerturbationPass,
  matchedRiskWindowFamily,
  metricsByCandidate,
  reconcileSymbol,
  rowsWithin,
  stateContinuityPass,
  validateSeries,
};
