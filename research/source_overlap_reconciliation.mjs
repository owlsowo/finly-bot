import { createHash } from "node:crypto";

import {
  calculatePortfolioMetrics,
  normalizeLongWeights,
  simulateStrategy,
} from "./champion_engine.mjs";
import { createGeneration4Strategies } from "./champion_strategies_generation4.mjs";

const DATA_ORIGIN = "https://data.alpaca.markets";
const ALLOWED_FEEDS = new Set(["iex"]);
const ALLOWED_ADJUSTMENTS = new Set(["split", "all"]);
const MAX_REMOTE_PAGES = 100;
const MAX_PAGE_LIMIT = 10_000;
const TRADING_DAYS = 252;

export const RECONCILIATION_SYMBOLS = Object.freeze([
  "SPY", "BIL", "QQQ", "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
]);
export const RECONCILIATION_SECTOR_SYMBOLS = Object.freeze([
  "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
]);
export const RECONCILIATION_THRESHOLDS = Object.freeze({
  minimum_common_sessions_per_symbol: 1_000,
  minimum_date_coverage_each_direction: 0.95,
  distribution_interval_detection_difference_bps: 0.01,
  maximum_distribution_interval_exclusion_fraction: 0.08,
  minimum_ordinary_log_return_observations: 900,
  minimum_ordinary_log_return_correlation: 0.999,
  maximum_median_absolute_ordinary_log_return_difference_bps: 5,
  maximum_p99_absolute_ordinary_log_return_difference_bps: 50,
  minimum_full_panel_sessions: 1_000,
  minimum_full_panel_yahoo_date_coverage: 0.95,
  minimum_exact_top_three_signal_agreement: 0.90,
  minimum_mean_top_three_jaccard: 0.95,
  minimum_candidate_daily_log_return_correlation: 0.999,
  maximum_candidate_annualized_log_return_tracking_error: 0.01,
  maximum_candidate_vs_spy_edge_difference_bps_per_year: 50,
});

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function round(value, places = 10) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  const result = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function mean(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function quantile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower));
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

function isoDate(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(`${label} is not a valid timestamp`);
  return parsed.toISOString().slice(0, 10);
}

function assertDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label} is invalid`);
}

function assertSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0 || new Set(symbols).size !== symbols.length) {
    fail("reconciliation symbols must be a unique non-empty array");
  }
  for (const symbol of symbols) {
    if (!RECONCILIATION_SYMBOLS.includes(symbol)) fail(`reconciliation symbol ${symbol} is not allowlisted`);
  }
}

export function assertPriceSeries(symbol, series, label = "price series") {
  if (!RECONCILIATION_SYMBOLS.includes(symbol)) fail(`${label} symbol is not allowlisted`);
  if (!Array.isArray(series) || series.length === 0) fail(`${symbol} ${label} is empty`);
  let prior = "";
  for (let index = 0; index < series.length; index += 1) {
    const point = series[index];
    if (!point || typeof point !== "object" || Array.isArray(point)) fail(`${symbol} ${label} row ${index} is invalid`);
    assertDate(point.date, `${symbol} ${label} row ${index} date`);
    if (point.date <= prior) fail(`${symbol} ${label} dates are duplicated or out of order`);
    if (!Number.isFinite(point.close) || point.close <= 0) fail(`${symbol} ${label} row ${index} close is invalid`);
    prior = point.date;
  }
  return series;
}

export function normalizeAlpacaBars(symbol, bars) {
  if (!Array.isArray(bars) || bars.length === 0) fail(`${symbol} Alpaca bars are empty`);
  const series = bars.map((bar, index) => {
    if (!bar || typeof bar !== "object" || Array.isArray(bar)) fail(`${symbol} Alpaca bar ${index} is invalid`);
    if (typeof bar.t !== "string") fail(`${symbol} Alpaca bar ${index} timestamp is invalid`);
    const close = Number(bar.c);
    if (!Number.isFinite(close) || close <= 0) fail(`${symbol} Alpaca bar ${index} close is invalid`);
    return Object.freeze({ date: isoDate(bar.t, `${symbol} Alpaca bar ${index} timestamp`), close });
  });
  return Object.freeze(assertPriceSeries(symbol, series, "Alpaca series"));
}

export class AlpacaReconciliationClient {
  #fetchImpl;
  #headers;
  #maxPages;

  constructor({ keyId, secretKey, fetchImpl = globalThis.fetch, maxPages = MAX_REMOTE_PAGES } = {}) {
    if (typeof keyId !== "string" || keyId.length < 8) fail("missing Alpaca key ID");
    if (typeof secretKey !== "string" || secretKey.length < 12) fail("missing Alpaca secret key");
    if (typeof fetchImpl !== "function") fail("Alpaca fetch implementation is required");
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_REMOTE_PAGES) fail("Alpaca maximum page count is invalid");
    this.#fetchImpl = fetchImpl;
    this.#maxPages = maxPages;
    this.#headers = Object.freeze({
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey,
      accept: "application/json",
    });
  }

  async getDailyBars(symbols, {
    start,
    end,
    feed = "iex",
    adjustment = "all",
    limit = MAX_PAGE_LIMIT,
  } = {}) {
    assertSymbols(symbols);
    assertDate(start, "Alpaca range start");
    assertDate(end, "Alpaca range end");
    if (start > end) fail("Alpaca range bounds are inverted");
    if (!ALLOWED_FEEDS.has(feed)) fail("Alpaca feed is not allowlisted for reconciliation");
    if (!ALLOWED_ADJUSTMENTS.has(adjustment)) fail("Alpaca adjustment is not allowlisted for reconciliation");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) fail("Alpaca page limit is invalid");

    const barsBySymbol = Object.fromEntries(symbols.map((symbol) => [symbol, []]));
    const responseBodies = [];
    const seenTokens = new Set();
    let pageToken;
    let pageCount = 0;
    while (true) {
      if (pageCount >= this.#maxPages) fail("Alpaca pagination exceeded the fail-closed safety limit");
      const url = new URL("/v2/stocks/bars", DATA_ORIGIN);
      url.searchParams.set("symbols", symbols.join(","));
      url.searchParams.set("timeframe", "1Day");
      url.searchParams.set("start", start);
      url.searchParams.set("end", end);
      url.searchParams.set("adjustment", adjustment);
      url.searchParams.set("feed", feed);
      url.searchParams.set("sort", "asc");
      url.searchParams.set("limit", String(limit));
      if (pageToken) url.searchParams.set("page_token", pageToken);
      if (url.origin !== DATA_ORIGIN || url.pathname !== "/v2/stocks/bars") fail("Alpaca request escaped the allowlisted endpoint");

      let response;
      try {
        response = await this.#fetchImpl(url, {
          method: "GET",
          redirect: "error",
          headers: this.#headers,
        });
      } catch {
        fail("Alpaca reconciliation transport failed");
      }
      if (!response || typeof response.ok !== "boolean") fail("Alpaca reconciliation returned an invalid response");
      if (!response.ok) fail(`Alpaca reconciliation read failed with HTTP ${response.status}`);
      const raw = await response.text();
      responseBodies.push(raw);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        fail("Alpaca reconciliation response was not valid JSON");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !payload.bars || typeof payload.bars !== "object") {
        fail("Alpaca reconciliation response has an invalid shape");
      }
      for (const [symbol, bars] of Object.entries(payload.bars)) {
        if (!symbols.includes(symbol) || !Array.isArray(bars)) fail("Alpaca reconciliation response contains an unexpected symbol or bar shape");
        barsBySymbol[symbol].push(...bars);
      }
      pageCount += 1;
      const next = payload.next_page_token;
      if (next === null || next === undefined || next === "") break;
      if (typeof next !== "string" || seenTokens.has(next)) fail("Alpaca reconciliation pagination token is invalid or repeated");
      seenTokens.add(next);
      pageToken = next;
    }

    const seriesBySymbol = Object.fromEntries(symbols.map((symbol) => [symbol, normalizeAlpacaBars(symbol, barsBySymbol[symbol])]));
    return Object.freeze({
      series_by_symbol: Object.freeze(seriesBySymbol),
      provenance: Object.freeze({
        provider: "Alpaca Market Data API",
        origin: DATA_ORIGIN,
        path: "/v2/stocks/bars",
        feed,
        adjustment,
        timeframe: "1Day",
        start,
        end,
        page_count: pageCount,
        response_content_sha256: sha256(responseBodies.join("\n--PAGE--\n")),
        raw_responses_persisted: false,
        authenticated_read_only_get: true,
      }),
    });
  }
}

export function credentialsFromEnvironment(environment = process.env) {
  return Object.freeze({
    keyId: environment.APCA_API_KEY_ID ?? environment.ALPACA_API_KEY,
    secretKey: environment.APCA_API_SECRET_KEY ?? environment.ALPACA_SECRET_KEY,
  });
}

function returnsOnCommonDates(leftSeries, rightSeries) {
  const leftMap = new Map(leftSeries.map((point) => [point.date, point.close]));
  const rightMap = new Map(rightSeries.map((point) => [point.date, point.close]));
  const commonDates = [...leftMap.keys()].filter((date) => rightMap.has(date)).sort();
  const left = [];
  const right = [];
  const returnEndDates = [];
  for (let index = 1; index < commonDates.length; index += 1) {
    const previous = commonDates[index - 1];
    const current = commonDates[index];
    left.push(Math.log(leftMap.get(current) / leftMap.get(previous)));
    right.push(Math.log(rightMap.get(current) / rightMap.get(previous)));
    returnEndDates.push(current);
  }
  return { commonDates, returnEndDates, left, right, leftMap, rightMap };
}

export function reconcileSymbol({
  symbol,
  yahooSeries,
  alpacaSplitSeries,
  alpacaAllSeries,
  thresholds = RECONCILIATION_THRESHOLDS,
}) {
  assertPriceSeries(symbol, yahooSeries, "Yahoo adjusted series");
  assertPriceSeries(symbol, alpacaSplitSeries, "Alpaca split-adjusted series");
  assertPriceSeries(symbol, alpacaAllSeries, "Alpaca all-adjusted series");
  const overlapStart = [yahooSeries[0].date, alpacaSplitSeries[0].date].sort().at(-1);
  const overlapEnd = [yahooSeries.at(-1).date, alpacaSplitSeries.at(-1).date].sort()[0];
  if (overlapStart > overlapEnd) fail(`${symbol} has no Yahoo/Alpaca overlap`);
  const yahooDates = yahooSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd).map((point) => point.date);
  const alpacaDates = alpacaSplitSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd).map((point) => point.date);
  const alpacaAllDates = alpacaAllSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd).map((point) => point.date);
  const yahooSet = new Set(yahooDates);
  const alpacaSet = new Set(alpacaDates);
  const {
    commonDates,
    returnEndDates,
    left: yahooReturns,
    right: alpacaSplitReturns,
  } = returnsOnCommonDates(yahooSeries, alpacaSplitSeries);
  const commonInOverlap = commonDates.filter((date) => date >= overlapStart && date <= overlapEnd);
  const adjustment = returnsOnCommonDates(alpacaAllSeries, alpacaSplitSeries);
  const adjustmentDifferenceByDate = new Map(adjustment.returnEndDates.map((date, index) => [
    date,
    Math.abs(adjustment.left[index] - adjustment.right[index]),
  ]));
  const distributionThreshold = thresholds.distribution_interval_detection_difference_bps / 10_000;
  const excludedDates = returnEndDates.filter((date) => (
    (adjustmentDifferenceByDate.get(date) ?? Number.POSITIVE_INFINITY) > distributionThreshold
  ));
  const excludedSet = new Set(excludedDates);
  const ordinaryYahooReturns = yahooReturns.filter((_, index) => !excludedSet.has(returnEndDates[index]));
  const ordinarySplitReturns = alpacaSplitReturns.filter((_, index) => !excludedSet.has(returnEndDates[index]));
  const absoluteOrdinaryDifferences = ordinaryYahooReturns.map((value, index) => Math.abs(value - ordinarySplitReturns[index]));
  const correlation = pearson(ordinaryYahooReturns, ordinarySplitReturns);
  const medianBps = quantile(absoluteOrdinaryDifferences, 0.50) * 10_000;
  const p99Bps = quantile(absoluteOrdinaryDifferences, 0.99) * 10_000;
  const exclusionFraction = returnEndDates.length > 0 ? excludedDates.length / returnEndDates.length : 1;
  const alpacaAdjustmentDatesMatch = alpacaDates.length === alpacaAllDates.length
    && alpacaDates.every((date, index) => date === alpacaAllDates[index]);
  const gates = Object.freeze({
    minimum_common_sessions: commonInOverlap.length >= thresholds.minimum_common_sessions_per_symbol,
    yahoo_dates_covered: commonInOverlap.length / yahooDates.length >= thresholds.minimum_date_coverage_each_direction,
    alpaca_dates_covered: commonInOverlap.length / alpacaDates.length >= thresholds.minimum_date_coverage_each_direction,
    alpaca_adjustment_dates_match: alpacaAdjustmentDatesMatch,
    distribution_interval_exclusion_within_cap: exclusionFraction <= thresholds.maximum_distribution_interval_exclusion_fraction,
    minimum_ordinary_log_return_observations: ordinaryYahooReturns.length >= thresholds.minimum_ordinary_log_return_observations,
    ordinary_log_return_correlation: Number.isFinite(correlation)
      && correlation >= thresholds.minimum_ordinary_log_return_correlation,
    median_ordinary_log_return_difference: medianBps <= thresholds.maximum_median_absolute_ordinary_log_return_difference_bps,
    p99_ordinary_log_return_difference: p99Bps <= thresholds.maximum_p99_absolute_ordinary_log_return_difference_bps,
  });
  return Object.freeze({
    symbol,
    overlap_start: overlapStart,
    overlap_end: overlapEnd,
    yahoo_sessions_in_overlap: yahooDates.length,
    alpaca_sessions_in_overlap: alpacaDates.length,
    common_sessions: commonInOverlap.length,
    yahoo_only_dates: yahooDates.filter((date) => !alpacaSet.has(date)),
    alpaca_only_dates: alpacaDates.filter((date) => !yahooSet.has(date)),
    yahoo_date_coverage_by_alpaca: round(commonInOverlap.length / yahooDates.length),
    alpaca_date_coverage_by_yahoo: round(commonInOverlap.length / alpacaDates.length),
    ordinary_session_log_return_comparison: Object.freeze({
      observations_before_distribution_exclusion: returnEndDates.length,
      observations_after_distribution_exclusion: ordinaryYahooReturns.length,
      log_return_correlation: round(correlation),
      median_absolute_log_return_difference_bps: round(medianBps),
      p99_absolute_log_return_difference_bps: round(p99Bps),
      maximum_absolute_log_return_difference_bps: round(Math.max(...absoluteOrdinaryDifferences) * 10_000),
    }),
    corporate_action_adjustment_diagnostic: Object.freeze({
      common_alpaca_split_all_sessions: adjustment.commonDates.length,
      detection_threshold_bps: thresholds.distribution_interval_detection_difference_bps,
      excluded_interval_count: excludedDates.length,
      excluded_interval_fraction: round(exclusionFraction),
      excluded_interval_dates: Object.freeze(excludedDates),
      excluded_interval_date_examples: Object.freeze(excludedDates.slice(0, 10)),
      maximum_split_vs_all_log_return_difference_bps: round(Math.max(...adjustmentDifferenceByDate.values()) * 10_000),
      interpretation: "Intervals where Alpaca all-versus-split log returns differ are excluded only from the price-feed fidelity gate because Yahoo adjusted close includes distributions. The exclusions are fully disclosed and capped.",
    }),
    gates,
    passed: Object.values(gates).every(Boolean),
  });
}

function commonPanelDates(seriesMaps, symbols) {
  const first = seriesMaps[symbols[0]];
  return [...first.keys()].filter((date) => symbols.every((symbol) => seriesMaps[symbol].has(date))).sort();
}

function pointsForDates(seriesMaps, symbols, dates) {
  return dates.map((date) => Object.freeze({
    date,
    ...Object.fromEntries(symbols.map((symbol) => [symbol, seriesMaps[symbol].get(date)])),
  }));
}

function annualizedLogGrowth(metrics) {
  return Math.log1p(metrics.total_return) * TRADING_DAYS / metrics.observations;
}

function compareReturnRows(leftRows, rightRows) {
  if (leftRows.length !== rightRows.length || leftRows.some((row, index) => (
    row.execution_return_date !== rightRows[index].execution_return_date
  ))) fail("candidate simulations are not date-aligned");
  const left = leftRows.map((row) => Math.log1p(row.net_return));
  const right = rightRows.map((row) => Math.log1p(row.net_return));
  const differences = left.map((value, index) => value - right[index]);
  return Object.freeze({
    observations: left.length,
    daily_log_return_correlation: round(pearson(left, right)),
    annualized_log_return_tracking_error: round(sampleStandardDeviation(differences) * Math.sqrt(TRADING_DAYS)),
    median_absolute_daily_log_return_difference_bps: round(quantile(differences.map(Math.abs), 0.50) * 10_000),
    p95_absolute_daily_log_return_difference_bps: round(quantile(differences.map(Math.abs), 0.95) * 10_000),
    maximum_absolute_daily_log_return_difference_bps: round(Math.max(...differences.map(Math.abs)) * 10_000),
  });
}

export function compareCandidateAcrossSources({
  yahooSeriesBySymbol,
  alpacaSeriesBySymbol,
  symbols = RECONCILIATION_SYMBOLS,
  thresholds = RECONCILIATION_THRESHOLDS,
}) {
  assertSymbols(symbols);
  const yahooMaps = Object.fromEntries(symbols.map((symbol) => {
    assertPriceSeries(symbol, yahooSeriesBySymbol[symbol], "Yahoo adjusted series");
    return [symbol, new Map(yahooSeriesBySymbol[symbol].map((point) => [point.date, point.close]))];
  }));
  const alpacaMaps = Object.fromEntries(symbols.map((symbol) => {
    assertPriceSeries(symbol, alpacaSeriesBySymbol[symbol], "Alpaca adjusted series");
    return [symbol, new Map(alpacaSeriesBySymbol[symbol].map((point) => [point.date, point.close]))];
  }));
  const yahooPanelDates = commonPanelDates(yahooMaps, symbols);
  const alpacaPanelDates = commonPanelDates(alpacaMaps, symbols);
  const alpacaPanelSet = new Set(alpacaPanelDates);
  const overlapStart = [yahooPanelDates[0], alpacaPanelDates[0]].sort().at(-1);
  const overlapEnd = [yahooPanelDates.at(-1), alpacaPanelDates.at(-1)].sort()[0];
  const yahooInOverlap = yahooPanelDates.filter((date) => date >= overlapStart && date <= overlapEnd);
  const dates = yahooInOverlap.filter((date) => alpacaPanelSet.has(date));
  if (dates.length < 255) fail("fully common source-overlap panel is too short to evaluate the candidate");
  const yahooPoints = pointsForDates(yahooMaps, symbols, dates);
  const alpacaPoints = pointsForDates(alpacaMaps, symbols, dates);
  const candidate = createGeneration4Strategies().find((strategy) => strategy.id === "qqq_core_sector_12_6");
  if (!candidate) fail("Generation 4 selected candidate implementation is missing");

  const signalRows = [];
  for (let index = 252; index <= dates.length - 3; index += candidate.rebalanceIntervalSessions) {
    const yahooWeights = candidate.decide({ points: yahooPoints, signalIndex: index });
    const alpacaWeights = candidate.decide({ points: alpacaPoints, signalIndex: index });
    const yahooBasket = RECONCILIATION_SECTOR_SYMBOLS.filter((symbol) => yahooWeights[symbol] > 0).sort();
    const alpacaBasket = RECONCILIATION_SECTOR_SYMBOLS.filter((symbol) => alpacaWeights[symbol] > 0).sort();
    const union = new Set([...yahooBasket, ...alpacaBasket]);
    const intersection = yahooBasket.filter((symbol) => alpacaBasket.includes(symbol));
    signalRows.push(Object.freeze({
      date: dates[index],
      exact_match: yahooBasket.join(",") === alpacaBasket.join(","),
      jaccard: union.size > 0 ? intersection.length / union.size : 1,
    }));
  }

  const simulationOptions = Object.freeze({
    cashSymbol: "BIL",
    lookbackSessions: 252,
    rebalanceIntervalSessions: 21,
    rebalanceAnchor: 0,
    oneWayCostBps: 5,
    annualBorrowSpread: 0.005,
    maximumRiskyGross: 1,
    terminalLiquidation: true,
  });
  const spy = Object.freeze({
    id: "source_reconciliation_spy_buy_hold",
    decide() {
      return normalizeLongWeights({ SPY: 1 }, { cashSymbol: "BIL", maximumRiskyGross: 1 });
    },
  });
  const yahooCandidate = simulateStrategy(yahooPoints, symbols, candidate, simulationOptions);
  const alpacaCandidate = simulateStrategy(alpacaPoints, symbols, candidate, simulationOptions);
  const yahooSpy = simulateStrategy(yahooPoints, symbols, spy, simulationOptions);
  const alpacaSpy = simulateStrategy(alpacaPoints, symbols, spy, simulationOptions);
  const yahooCandidateMetrics = calculatePortfolioMetrics(yahooCandidate.rows);
  const alpacaCandidateMetrics = calculatePortfolioMetrics(alpacaCandidate.rows);
  const yahooSpyMetrics = calculatePortfolioMetrics(yahooSpy.rows);
  const alpacaSpyMetrics = calculatePortfolioMetrics(alpacaSpy.rows);
  const yahooEdge = annualizedLogGrowth(yahooCandidateMetrics) - annualizedLogGrowth(yahooSpyMetrics);
  const alpacaEdge = annualizedLogGrowth(alpacaCandidateMetrics) - annualizedLogGrowth(alpacaSpyMetrics);
  const returnComparison = compareReturnRows(yahooCandidate.rows, alpacaCandidate.rows);
  const exactAgreement = signalRows.filter((row) => row.exact_match).length / signalRows.length;
  const meanJaccard = mean(signalRows.map((row) => row.jaccard));
  const edgeDifferenceBps = Math.abs(yahooEdge - alpacaEdge) * 10_000;
  const gates = Object.freeze({
    minimum_full_panel_sessions: dates.length >= thresholds.minimum_full_panel_sessions,
    yahoo_full_panel_dates_covered: dates.length / yahooInOverlap.length >= thresholds.minimum_full_panel_yahoo_date_coverage,
    exact_top_three_signal_agreement: exactAgreement >= thresholds.minimum_exact_top_three_signal_agreement,
    mean_top_three_jaccard: meanJaccard >= thresholds.minimum_mean_top_three_jaccard,
    candidate_daily_log_return_correlation: returnComparison.daily_log_return_correlation >= thresholds.minimum_candidate_daily_log_return_correlation,
    candidate_annualized_log_return_tracking_error: returnComparison.annualized_log_return_tracking_error <= thresholds.maximum_candidate_annualized_log_return_tracking_error,
    candidate_vs_spy_edge_direction_agrees: Math.sign(yahooEdge) === Math.sign(alpacaEdge)
      || (Math.abs(yahooEdge) < 0.0025 && Math.abs(alpacaEdge) < 0.0025),
    candidate_vs_spy_edge_difference: edgeDifferenceBps <= thresholds.maximum_candidate_vs_spy_edge_difference_bps_per_year,
  });
  return Object.freeze({
    common_panel_start: dates[0],
    common_panel_end: dates.at(-1),
    common_panel_sessions: dates.length,
    yahoo_full_panel_sessions_in_overlap: yahooInOverlap.length,
    yahoo_full_panel_date_coverage_by_alpaca: round(dates.length / yahooInOverlap.length),
    candidate_signal_comparison: Object.freeze({
      signal_count: signalRows.length,
      exact_top_three_agreement_fraction: round(exactAgreement),
      mean_top_three_jaccard: round(meanJaccard),
      differing_signal_count: signalRows.filter((row) => !row.exact_match).length,
      differing_signal_dates: signalRows.filter((row) => !row.exact_match).map((row) => row.date),
    }),
    candidate_return_comparison: returnComparison,
    candidate_vs_spy_edge: Object.freeze({
      yahoo_annualized_log_growth_edge: round(yahooEdge),
      alpaca_annualized_log_growth_edge: round(alpacaEdge),
      absolute_edge_difference_bps_per_year: round(edgeDifferenceBps),
      interpretation: "This is an overlap-period source-concordance diagnostic, not an independent out-of-sample profitability test.",
    }),
    gates,
    passed: Object.values(gates).every(Boolean),
  });
}

export function buildReconciliationReport({
  yahooSeriesBySymbol,
  alpacaSplitSeriesBySymbol,
  alpacaAllSeriesBySymbol,
  thresholds = RECONCILIATION_THRESHOLDS,
}) {
  const perSymbol = Object.fromEntries(RECONCILIATION_SYMBOLS.map((symbol) => [symbol, reconcileSymbol({
    symbol,
    yahooSeries: yahooSeriesBySymbol[symbol],
    alpacaSplitSeries: alpacaSplitSeriesBySymbol[symbol],
    alpacaAllSeries: alpacaAllSeriesBySymbol[symbol],
    thresholds,
  })]));
  const candidate = compareCandidateAcrossSources({
    yahooSeriesBySymbol,
    alpacaSeriesBySymbol: alpacaAllSeriesBySymbol,
    thresholds,
  });
  const blockingReasons = [
    ...Object.values(perSymbol).filter((item) => !item.passed).map((item) => `${item.symbol} failed one or more source gates`),
    ...(!candidate.passed ? ["qqq_core_sector_12_6 failed one or more candidate source-concordance gates"] : []),
  ];
  return Object.freeze({
    thresholds,
    per_symbol: Object.freeze(perSymbol),
    candidate,
    passed: blockingReasons.length === 0,
    blocking_reasons: Object.freeze(blockingReasons),
  });
}
