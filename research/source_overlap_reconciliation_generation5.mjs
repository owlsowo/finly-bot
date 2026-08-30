import { createHash } from "node:crypto";

import {
  normalizeLongWeights,
  round,
  simulateStrategy,
} from "./champion_engine.mjs";
import { CORE_SYMBOLS } from "./champion_strategies.mjs";

const DATA_ORIGIN = "https://data.alpaca.markets";
const MAX_REMOTE_PAGES = 100;
const MAX_PAGE_LIMIT = 10_000;
const TRADING_DAYS = 252;

export const GENERATION5_SOURCE_SYMBOLS = Object.freeze([...CORE_SYMBOLS]);
export const GENERATION5_SOURCE_THRESHOLDS = Object.freeze({
  minimum_common_sessions_per_symbol: 1_250,
  minimum_yahoo_coverage_of_alpaca_dates: 0.99,
  risky_minimum_daily_log_return_correlation: 0.995,
  risky_maximum_annualized_log_return_tracking_error: 0.03,
  risky_maximum_median_absolute_daily_log_return_difference_bps: 5,
  risky_maximum_p99_absolute_daily_log_return_difference_bps: 50,
  bil_maximum_annualized_mean_log_return_difference_bps: 25,
  bil_maximum_annualized_log_return_tracking_error: 0.01,
  bil_maximum_median_absolute_daily_log_return_difference_bps: 1,
  bil_maximum_p99_absolute_daily_log_return_difference_bps: 5,
  candidate_minimum_exact_decision_agreement: 0.99,
  candidate_minimum_daily_log_return_correlation: 0.995,
  candidate_maximum_annualized_log_return_tracking_error: 0.02,
  candidate_maximum_absolute_edge_difference_bps_per_year: 50,
});
export const GENERATION5_SOURCE_SIMULATION_OPTIONS = Object.freeze({
  cashSymbol: "BIL",
  lookbackSessions: 252,
  rebalanceIntervalSessions: 21,
  rebalanceAnchor: 0,
  oneWayCostBps: 5,
  annualBorrowSpread: 0.005,
  maximumRiskyGross: 1,
  terminalLiquidation: true,
});

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
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

function assertDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label} is invalid`);
}

function isoDate(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(`${label} is not a valid timestamp`);
  return parsed.toISOString().slice(0, 10);
}

function assertSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0 || new Set(symbols).size !== symbols.length) {
    fail("source-reconciliation symbols must be a unique non-empty array");
  }
  for (const symbol of symbols) {
    if (!GENERATION5_SOURCE_SYMBOLS.includes(symbol)) fail(`source-reconciliation symbol ${symbol} is not allowlisted`);
  }
}

export function assertGeneration5PriceSeries(symbol, series, label = "price series") {
  if (!GENERATION5_SOURCE_SYMBOLS.includes(symbol)) fail(`${label} symbol is not allowlisted`);
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

export function normalizeGeneration5AlpacaBars(symbol, bars) {
  if (!Array.isArray(bars) || bars.length === 0) fail(`${symbol} Alpaca bars are empty`);
  const series = bars.map((bar, index) => {
    if (!bar || typeof bar !== "object" || Array.isArray(bar)) fail(`${symbol} Alpaca bar ${index} is invalid`);
    if (typeof bar.t !== "string") fail(`${symbol} Alpaca bar ${index} timestamp is invalid`);
    const close = Number(bar.c);
    if (!Number.isFinite(close) || close <= 0) fail(`${symbol} Alpaca bar ${index} close is invalid`);
    return Object.freeze({ date: isoDate(bar.t, `${symbol} Alpaca bar ${index} timestamp`), close });
  });
  return Object.freeze(assertGeneration5PriceSeries(symbol, series, "Alpaca series"));
}

export class AlpacaGeneration5ReconciliationClient {
  #fetchImpl;
  #headers;
  #maxPages;

  constructor({ keyId, secretKey, fetchImpl = globalThis.fetch, maxPages = MAX_REMOTE_PAGES } = {}) {
    if (typeof keyId !== "string" || keyId.length < 8) fail("missing Alpaca key ID");
    if (typeof secretKey !== "string" || secretKey.length < 12) fail("missing Alpaca secret key");
    if (typeof fetchImpl !== "function") fail("Alpaca fetch implementation is required");
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_REMOTE_PAGES) {
      fail("Alpaca maximum page count is invalid");
    }
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
    if (feed !== "iex") fail("only Alpaca IEX is allowlisted for Generation 5 source reconciliation");
    if (!new Set(["all", "split"]).has(adjustment)) fail("Alpaca adjustment is not allowlisted");
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
        fail("Alpaca Generation 5 reconciliation transport failed");
      }
      if (!response || typeof response.ok !== "boolean") fail("Alpaca returned an invalid response");
      if (!response.ok) fail(`Alpaca Generation 5 reconciliation read failed with HTTP ${response.status}`);
      const raw = await response.text();
      responseBodies.push(raw);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        fail("Alpaca response was not valid JSON");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !payload.bars || typeof payload.bars !== "object") {
        fail("Alpaca response has an invalid shape");
      }
      for (const [symbol, bars] of Object.entries(payload.bars)) {
        if (!symbols.includes(symbol) || !Array.isArray(bars)) fail("Alpaca response contains an unexpected symbol or bar shape");
        barsBySymbol[symbol].push(...bars);
      }
      pageCount += 1;
      const next = payload.next_page_token;
      if (next === null || next === undefined || next === "") break;
      if (typeof next !== "string" || seenTokens.has(next)) fail("Alpaca pagination token is invalid or repeated");
      seenTokens.add(next);
      pageToken = next;
    }

    const seriesBySymbol = Object.fromEntries(symbols.map((symbol) => [
      symbol,
      normalizeGeneration5AlpacaBars(symbol, barsBySymbol[symbol]),
    ]));
    return Object.freeze({
      series_by_symbol: Object.freeze(seriesBySymbol),
      provenance: Object.freeze({
        provider: "Alpaca Market Data API",
        origin: DATA_ORIGIN,
        path: "/v2/stocks/bars",
        feed,
        adjustment,
        adjustment_semantics: adjustment === "all"
          ? "forward/reverse splits, cash dividends, and spin-offs"
          : "forward and reverse splits",
        timeframe: "1Day",
        start,
        end,
        page_count: pageCount,
        response_content_sha256: sha256(responseBodies.join("\n--PAGE--\n")),
        raw_responses_persisted: false,
        request_headers_persisted: false,
        page_tokens_persisted: false,
        authenticated_read_only_get: true,
      }),
    });
  }
}

export function generation5CredentialsFromEnvironment(environment = process.env) {
  return Object.freeze({
    keyId: environment.APCA_API_KEY_ID ?? environment.ALPACA_API_KEY,
    secretKey: environment.APCA_API_SECRET_KEY ?? environment.ALPACA_SECRET_KEY,
  });
}

function alignedLogReturns(leftSeries, rightSeries) {
  const leftMap = new Map(leftSeries.map((point) => [point.date, point.close]));
  const rightMap = new Map(rightSeries.map((point) => [point.date, point.close]));
  const commonDates = [...leftMap.keys()].filter((date) => rightMap.has(date)).sort();
  const left = [];
  const right = [];
  const returnEndDates = [];
  for (let index = 1; index < commonDates.length; index += 1) {
    const prior = commonDates[index - 1];
    const current = commonDates[index];
    left.push(Math.log(leftMap.get(current) / leftMap.get(prior)));
    right.push(Math.log(rightMap.get(current) / rightMap.get(prior)));
    returnEndDates.push(current);
  }
  return Object.freeze({ commonDates, returnEndDates, left, right });
}

function calculateAlignedLogReturnMetrics(left, right) {
  if (left.length !== right.length) fail("aligned return vectors differ in length");
  const differences = left.map((value, index) => value - right[index]);
  const absolute = differences.map(Math.abs);
  const deviation = sampleStandardDeviation(differences);
  const averageDifference = mean(differences);
  return Object.freeze({
    observations: left.length,
    daily_log_return_correlation: pearson(left, right),
    annualized_log_return_tracking_error: Number.isFinite(deviation) ? deviation * Math.sqrt(TRADING_DAYS) : null,
    annualized_mean_log_return_difference_bps: Number.isFinite(averageDifference)
      ? Math.abs(averageDifference) * TRADING_DAYS * 10_000
      : null,
    median_absolute_daily_log_return_difference_bps: quantile(absolute, 0.50) * 10_000,
    p99_absolute_daily_log_return_difference_bps: quantile(absolute, 0.99) * 10_000,
    maximum_absolute_daily_log_return_difference_bps: absolute.length > 0 ? Math.max(...absolute) * 10_000 : null,
  });
}

function presentAlignedLogReturnMetrics(metrics) {
  return Object.freeze(Object.fromEntries(Object.entries(metrics).map(([key, value]) => [
    key,
    key === "observations" ? value : round(value),
  ])));
}

function finiteAtMost(value, threshold) {
  return Number.isFinite(value) && value <= threshold;
}

function finiteAtLeast(value, threshold) {
  return Number.isFinite(value) && value >= threshold;
}

export function evaluateGeneration5SymbolGates({
  symbol,
  commonSessions,
  yahooCoverageOfAlpaca,
  rawMetrics,
  thresholds = GENERATION5_SOURCE_THRESHOLDS,
}) {
  const commonSessionGate = commonSessions >= thresholds.minimum_common_sessions_per_symbol;
  const coverageGate = yahooCoverageOfAlpaca >= thresholds.minimum_yahoo_coverage_of_alpaca_dates;
  return symbol === "BIL"
    ? Object.freeze({
      minimum_common_sessions: commonSessionGate,
      yahoo_covers_alpaca_dates: coverageGate,
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
      minimum_common_sessions: commonSessionGate,
      yahoo_covers_alpaca_dates: coverageGate,
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

export function reconcileGeneration5Symbol({
  symbol,
  yahooSeries,
  alpacaAllSeries,
  alpacaSplitSeries,
  thresholds = GENERATION5_SOURCE_THRESHOLDS,
}) {
  assertGeneration5PriceSeries(symbol, yahooSeries, "Yahoo adjusted series");
  assertGeneration5PriceSeries(symbol, alpacaAllSeries, "Alpaca all-adjusted series");
  assertGeneration5PriceSeries(symbol, alpacaSplitSeries, "Alpaca split-adjusted diagnostic series");

  const overlapStart = [yahooSeries[0].date, alpacaAllSeries[0].date].sort().at(-1);
  const overlapEnd = [yahooSeries.at(-1).date, alpacaAllSeries.at(-1).date].sort()[0];
  if (overlapStart > overlapEnd) fail(`${symbol} has no Yahoo/Alpaca-all overlap`);
  const yahooDates = yahooSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd).map((point) => point.date);
  const alpacaDates = alpacaAllSeries.filter((point) => point.date >= overlapStart && point.date <= overlapEnd).map((point) => point.date);
  const primary = alignedLogReturns(yahooSeries, alpacaAllSeries);
  const primaryRawMetrics = calculateAlignedLogReturnMetrics(primary.left, primary.right);
  const primaryMetrics = presentAlignedLogReturnMetrics(primaryRawMetrics);
  const commonSessions = primary.commonDates.length;
  const yahooCoverageOfAlpaca = commonSessions / alpacaDates.length;
  const alpacaCoverageOfYahoo = commonSessions / yahooDates.length;
  const gates = evaluateGeneration5SymbolGates({
    symbol,
    commonSessions,
    yahooCoverageOfAlpaca,
    rawMetrics: primaryRawMetrics,
    thresholds,
  });

  const splitDiagnostic = alignedLogReturns(alpacaAllSeries, alpacaSplitSeries);
  const splitDates = new Set(alpacaSplitSeries.map((point) => point.date));
  const allDates = new Set(alpacaAllSeries.map((point) => point.date));
  return Object.freeze({
    symbol,
    primary_comparison: "Yahoo adjusted close versus Alpaca IEX adjustment=all",
    overlap_start: overlapStart,
    overlap_end: overlapEnd,
    yahoo_sessions_in_overlap: yahooDates.length,
    alpaca_all_sessions_in_overlap: alpacaDates.length,
    common_sessions: commonSessions,
    yahoo_coverage_of_alpaca_dates: round(yahooCoverageOfAlpaca),
    alpaca_coverage_of_yahoo_dates: round(alpacaCoverageOfYahoo),
    yahoo_only_date_count: yahooDates.filter((date) => !allDates.has(date)).length,
    alpaca_all_only_date_count: alpacaDates.filter((date) => !new Set(yahooDates).has(date)).length,
    primary_log_return_metrics: primaryMetrics,
    alpaca_split_diagnostic: Object.freeze({
      role: "Diagnostic only; no date or return is excluded from the primary comparison.",
      common_sessions: splitDiagnostic.commonDates.length,
      alpaca_all_only_date_count: alpacaAllSeries.filter((point) => !splitDates.has(point.date)).length,
      alpaca_split_only_date_count: alpacaSplitSeries.filter((point) => !allDates.has(point.date)).length,
      all_versus_split_log_return_metrics: presentAlignedLogReturnMetrics(
        calculateAlignedLogReturnMetrics(splitDiagnostic.left, splitDiagnostic.right),
      ),
      interpretation: "Alpaca all includes split, cash-dividend, and spin-off adjustments; split includes forward and reverse splits. Differences are adjustment-series diagnostics, not event labels or exclusion rules.",
    }),
    gate_family: symbol === "BIL" ? "BIL_NEAR_ZERO_RETURN" : "RISKY_ETF",
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

function canonicalWeightVector(weights, symbols) {
  return Object.freeze(symbols.map((symbol) => round(Number(weights?.[symbol] ?? 0), 10)));
}

function recordedStrategy(strategy, symbols, records) {
  if (!strategy || typeof strategy.id !== "string" || typeof strategy.decide !== "function") fail("candidate strategy is invalid");
  const wrapper = {
    ...strategy,
    decide(context) {
      const weights = strategy.decide(context);
      records.push(Object.freeze({
        signal_date: context.signalDate,
        canonical_weights: canonicalWeightVector(weights, symbols),
      }));
      return weights;
    },
  };
  if (typeof strategy.observe === "function") wrapper.observe = (row) => strategy.observe(row);
  return Object.freeze(wrapper);
}

function strategyById(createStrategies, id) {
  const strategies = createStrategies();
  if (!Array.isArray(strategies)) fail("Generation 5 strategy factory must return an array");
  const matches = strategies.filter((strategy) => strategy?.id === id);
  if (matches.length !== 1) fail(`Generation 5 strategy ${id} is missing or duplicated`);
  return matches[0];
}

function validateEligibleRegistry({ createStrategies, metadata, eligibleCandidateIds }) {
  if (typeof createStrategies !== "function" || !metadata || typeof metadata !== "object") {
    fail("Generation 5 strategy factory and metadata are required");
  }
  if (!Array.isArray(eligibleCandidateIds) || eligibleCandidateIds.length === 0
    || new Set(eligibleCandidateIds).size !== eligibleCandidateIds.length) {
    fail("Generation 5 eligible candidate IDs must be unique and non-empty");
  }
  const metadataEligible = Object.keys(metadata).filter((id) => metadata[id]?.role === "candidate").sort();
  const declaredEligible = [...eligibleCandidateIds].sort();
  if (JSON.stringify(metadataEligible) !== JSON.stringify(declaredEligible)) {
    fail("Generation 5 eligible candidate IDs do not match metadata role=candidate");
  }
  const strategyIds = createStrategies().map((strategy) => strategy?.id);
  if (new Set(strategyIds).size !== strategyIds.length) fail("Generation 5 strategy IDs are duplicated");
  for (const id of declaredEligible) {
    if (!strategyIds.includes(id)) fail(`Generation 5 eligible strategy ${id} is absent`);
  }
}

function compareSimulationRows(leftRows, rightRows) {
  if (leftRows.length !== rightRows.length || leftRows.some((row, index) => (
    row.execution_return_date !== rightRows[index].execution_return_date
  ))) fail("candidate simulations are not date-aligned");
  const left = leftRows.map((row) => Math.log1p(row.net_return));
  const right = rightRows.map((row) => Math.log1p(row.net_return));
  return calculateAlignedLogReturnMetrics(left, right);
}

function annualizedLogGrowthFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail("candidate rows are unavailable");
  const logGrowth = rows.reduce((sum, row) => {
    if (!Number.isFinite(row.net_return) || row.net_return <= -1) fail("candidate row has invalid net return");
    return sum + Math.log1p(row.net_return);
  }, 0);
  return logGrowth * TRADING_DAYS / rows.length;
}

export function evaluateGeneration5CandidateGates({
  exactDecisionAgreement,
  rawReturnMetrics,
  yahooEdge,
  alpacaEdge,
  thresholds = GENERATION5_SOURCE_THRESHOLDS,
}) {
  const edgeDifferenceBps = Math.abs(yahooEdge - alpacaEdge) * 10_000;
  return Object.freeze({
    exact_decision_agreement: finiteAtLeast(
      exactDecisionAgreement,
      thresholds.candidate_minimum_exact_decision_agreement,
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
      edgeDifferenceBps,
      thresholds.candidate_maximum_absolute_edge_difference_bps_per_year,
    ),
  });
}

function spyStrategy() {
  return Object.freeze({
    id: "generation5_source_reconciliation_spy",
    decide() {
      return normalizeLongWeights({ SPY: 1 }, { cashSymbol: "BIL", maximumRiskyGross: 1 });
    },
  });
}

export function compareGeneration5CandidatesAcrossSources({
  yahooSeriesBySymbol,
  alpacaAllSeriesBySymbol,
  createStrategies,
  metadata,
  eligibleCandidateIds,
  symbols = GENERATION5_SOURCE_SYMBOLS,
  thresholds = GENERATION5_SOURCE_THRESHOLDS,
  simulationOptions = GENERATION5_SOURCE_SIMULATION_OPTIONS,
}) {
  assertSymbols(symbols);
  validateEligibleRegistry({ createStrategies, metadata, eligibleCandidateIds });
  const yahooMaps = Object.fromEntries(symbols.map((symbol) => {
    assertGeneration5PriceSeries(symbol, yahooSeriesBySymbol[symbol], "Yahoo adjusted series");
    return [symbol, new Map(yahooSeriesBySymbol[symbol].map((point) => [point.date, point.close]))];
  }));
  const alpacaMaps = Object.fromEntries(symbols.map((symbol) => {
    assertGeneration5PriceSeries(symbol, alpacaAllSeriesBySymbol[symbol], "Alpaca all-adjusted series");
    return [symbol, new Map(alpacaAllSeriesBySymbol[symbol].map((point) => [point.date, point.close]))];
  }));
  const yahooPanelDates = commonPanelDates(yahooMaps, symbols);
  const alpacaPanelDates = commonPanelDates(alpacaMaps, symbols);
  if (yahooPanelDates.length === 0 || alpacaPanelDates.length === 0) fail("Generation 5 source panels are empty");
  const overlapStart = [yahooPanelDates[0], alpacaPanelDates[0]].sort().at(-1);
  const overlapEnd = [yahooPanelDates.at(-1), alpacaPanelDates.at(-1)].sort()[0];
  const yahooInOverlap = yahooPanelDates.filter((date) => date >= overlapStart && date <= overlapEnd);
  const alpacaInOverlap = alpacaPanelDates.filter((date) => date >= overlapStart && date <= overlapEnd);
  const alpacaDateSet = new Set(alpacaInOverlap);
  const dates = yahooInOverlap.filter((date) => alpacaDateSet.has(date));
  if (dates.length < thresholds.minimum_common_sessions_per_symbol) {
    fail("fully common Generation 5 source panel is shorter than the frozen minimum");
  }
  const yahooPoints = pointsForDates(yahooMaps, symbols, dates);
  const alpacaPoints = pointsForDates(alpacaMaps, symbols, dates);
  const yahooSpy = simulateStrategy(yahooPoints, symbols, spyStrategy(), simulationOptions);
  const alpacaSpy = simulateStrategy(alpacaPoints, symbols, spyStrategy(), simulationOptions);
  const yahooSpyGrowth = annualizedLogGrowthFromRows(yahooSpy.rows);
  const alpacaSpyGrowth = annualizedLogGrowthFromRows(alpacaSpy.rows);

  const candidates = Object.fromEntries(eligibleCandidateIds.map((id) => {
    const yahooDecisions = [];
    const alpacaDecisions = [];
    const yahooStrategy = recordedStrategy(strategyById(createStrategies, id), symbols, yahooDecisions);
    const alpacaStrategy = recordedStrategy(strategyById(createStrategies, id), symbols, alpacaDecisions);
    const yahooSimulation = simulateStrategy(yahooPoints, symbols, yahooStrategy, simulationOptions);
    const alpacaSimulation = simulateStrategy(alpacaPoints, symbols, alpacaStrategy, simulationOptions);
    if (yahooDecisions.length !== alpacaDecisions.length || yahooDecisions.some((decision, index) => (
      decision.signal_date !== alpacaDecisions[index].signal_date
    ))) fail(`${id} source decision schedules do not align`);
    const exactCount = yahooDecisions.filter((decision, index) => (
      JSON.stringify(decision.canonical_weights) === JSON.stringify(alpacaDecisions[index].canonical_weights)
    )).length;
    const exactFraction = yahooDecisions.length > 0 ? exactCount / yahooDecisions.length : 0;
    const maximumWeightL1Difference = yahooDecisions.reduce((maximum, decision, index) => {
      const difference = decision.canonical_weights.reduce((sum, weight, symbolIndex) => (
        sum + Math.abs(weight - alpacaDecisions[index].canonical_weights[symbolIndex])
      ), 0);
      return Math.max(maximum, difference);
    }, 0);
    const rawReturnComparison = compareSimulationRows(yahooSimulation.rows, alpacaSimulation.rows);
    const returnComparison = presentAlignedLogReturnMetrics(rawReturnComparison);
    const yahooEdge = annualizedLogGrowthFromRows(yahooSimulation.rows) - yahooSpyGrowth;
    const alpacaEdge = annualizedLogGrowthFromRows(alpacaSimulation.rows) - alpacaSpyGrowth;
    const edgeDifferenceBps = Math.abs(yahooEdge - alpacaEdge) * 10_000;
    const gates = evaluateGeneration5CandidateGates({
      exactDecisionAgreement: exactFraction,
      rawReturnMetrics: rawReturnComparison,
      yahooEdge,
      alpacaEdge,
      thresholds,
    });
    return [id, Object.freeze({
      id,
      common_panel_start: dates[0],
      common_panel_end: dates.at(-1),
      common_panel_sessions: dates.length,
      decision_comparison: Object.freeze({
        canonicalization: "Full CORE_SYMBOLS weight vector rounded to the engine's canonical 10 decimal places.",
        decision_count: yahooDecisions.length,
        exact_decision_count: exactCount,
        exact_decision_agreement_fraction: round(exactFraction),
        maximum_weight_l1_difference: round(maximumWeightL1Difference),
      }),
      return_comparison: returnComparison,
      candidate_vs_spy_edge: Object.freeze({
        yahoo_annualized_log_growth_edge: round(yahooEdge),
        alpaca_annualized_log_growth_edge: round(alpacaEdge),
        absolute_edge_difference_bps_per_year: round(edgeDifferenceBps),
      }),
      gates,
      passed: Object.values(gates).every(Boolean),
    })];
  }));

  return Object.freeze({
    primary_comparison: "Stored Yahoo adjusted close versus fresh authenticated Alpaca IEX adjustment=all",
    common_panel_start: dates[0],
    common_panel_end: dates.at(-1),
    common_panel_sessions: dates.length,
    yahoo_full_panel_sessions_in_overlap: yahooInOverlap.length,
    alpaca_full_panel_sessions_in_overlap: alpacaInOverlap.length,
    yahoo_coverage_of_alpaca_full_panel_dates: round(dates.length / alpacaInOverlap.length),
    eligible_candidate_ids: Object.freeze([...eligibleCandidateIds]),
    candidates: Object.freeze(candidates),
    passed: Object.values(candidates).every((candidate) => candidate.passed),
  });
}

export function buildGeneration5SourceReconciliation({
  yahooSeriesBySymbol,
  alpacaAllSeriesBySymbol,
  alpacaSplitSeriesBySymbol,
  createStrategies,
  metadata,
  eligibleCandidateIds,
  thresholds = GENERATION5_SOURCE_THRESHOLDS,
  simulationOptions = GENERATION5_SOURCE_SIMULATION_OPTIONS,
}) {
  const perSymbol = Object.fromEntries(GENERATION5_SOURCE_SYMBOLS.map((symbol) => [symbol, reconcileGeneration5Symbol({
    symbol,
    yahooSeries: yahooSeriesBySymbol[symbol],
    alpacaAllSeries: alpacaAllSeriesBySymbol[symbol],
    alpacaSplitSeries: alpacaSplitSeriesBySymbol[symbol],
    thresholds,
  })]));
  const candidates = compareGeneration5CandidatesAcrossSources({
    yahooSeriesBySymbol,
    alpacaAllSeriesBySymbol,
    createStrategies,
    metadata,
    eligibleCandidateIds,
    thresholds,
    simulationOptions,
  });
  const blockingReasons = [
    ...Object.values(perSymbol).filter((result) => !result.passed)
      .map((result) => `${result.symbol} failed one or more primary Yahoo-versus-Alpaca-all gates`),
    ...Object.values(candidates.candidates).filter((result) => !result.passed)
      .map((result) => `${result.id} failed one or more candidate source-concordance gates`),
  ];
  return Object.freeze({
    thresholds,
    simulation_options: simulationOptions,
    per_symbol: Object.freeze(perSymbol),
    candidate_comparison: candidates,
    passed: blockingReasons.length === 0,
    blocking_reasons: Object.freeze(blockingReasons),
    claim_boundary: "Designed after the Generation 4 FAIL_CLOSED result was observed. This is source concordance over already-seen history, not fresh out-of-sample evidence or proof of future profitability.",
  });
}
