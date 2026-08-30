import assert from "node:assert/strict";
import test from "node:test";

import {
  AlpacaGeneration5ReconciliationClient,
  buildGeneration5SourceReconciliation,
  compareGeneration5CandidatesAcrossSources,
  evaluateGeneration5CandidateGates,
  evaluateGeneration5SymbolGates,
  GENERATION5_SOURCE_SIMULATION_OPTIONS,
  GENERATION5_SOURCE_SYMBOLS,
  GENERATION5_SOURCE_THRESHOLDS,
  reconcileGeneration5Symbol,
} from "../research/source_overlap_reconciliation_generation5.mjs";
import {
  createGeneration5Strategies,
  GENERATION5_METADATA,
  GENERATION5_REQUIRED_SYMBOLS,
} from "../research/champion_strategies_generation5.mjs";
import {
  GENERATION5_FREEZE_REQUIRED_FILES,
  GENERATION5_LOCK_REQUIRED_FILES,
  hasExactManifestKeys,
  SOURCE_FREEZE_REQUIRED_FILES,
} from "../research/run_source_overlap_reconciliation_generation5.mjs";

const ELIGIBLE_IDS = Object.freeze(Object.keys(GENERATION5_METADATA)
  .filter((id) => GENERATION5_METADATA[id].role === "candidate"));

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

function weekdayDates(length, start = "2018-01-01") {
  const dates = [];
  let timestamp = Date.parse(`${start}T00:00:00Z`);
  while (dates.length < length) {
    const date = new Date(timestamp);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(date.toISOString().slice(0, 10));
    timestamp += 86_400_000;
  }
  return dates;
}

function syntheticSeries(symbol, dates, perturbation = 0) {
  const symbolIndex = GENERATION5_SOURCE_SYMBOLS.indexOf(symbol) + 1;
  if (symbol === "BIL") {
    return dates.map((date, index) => ({
      date,
      close: 100 * Math.exp(index * 0.00001) * (1 + perturbation * Math.sin(index / 19)),
    }));
  }
  return dates.map((date, index) => ({
    date,
    close: (40 + symbolIndex) * Math.exp(index * (0.00012 + symbolIndex * 0.000002))
      * (1 + 0.006 * Math.sin(index / (8 + symbolIndex)) + perturbation * Math.cos(index / 17)),
  }));
}

function panel(dates, perturbation = 0) {
  return Object.fromEntries(GENERATION5_SOURCE_SYMBOLS.map((symbol) => [
    symbol,
    syntheticSeries(symbol, dates, perturbation),
  ]));
}

test("Generation 5 source thresholds and execution assumptions are exact", () => {
  assert.deepEqual(GENERATION5_SOURCE_THRESHOLDS, {
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
  assert.deepEqual(GENERATION5_SOURCE_SIMULATION_OPTIONS, {
    cashSymbol: "BIL",
    lookbackSessions: 252,
    rebalanceIntervalSessions: 21,
    rebalanceAnchor: 0,
    oneWayCostBps: 5,
    annualBorrowSpread: 0.005,
    maximumRiskyGross: 1,
    terminalLiquidation: true,
  });
});

test("freeze and integration manifests reject every missing or unexpected path", () => {
  for (const required of [
    SOURCE_FREEZE_REQUIRED_FILES,
    GENERATION5_FREEZE_REQUIRED_FILES,
    GENERATION5_LOCK_REQUIRED_FILES,
  ]) {
    const exact = Object.fromEntries(required.map((path) => [path, "0".repeat(64)]));
    assert.equal(hasExactManifestKeys(exact, required), true);
    assert.equal(hasExactManifestKeys(Object.fromEntries(Object.entries(exact).slice(1)), required), false);
    assert.equal(hasExactManifestKeys({ ...exact, "unexpected.file": "0".repeat(64) }, required), false);
  }
});

test("raw values just outside frozen boundaries fail instead of rounding onto the threshold", () => {
  const epsilon = 4e-11;
  const riskyOutside = evaluateGeneration5SymbolGates({
    symbol: "SPY",
    commonSessions: 1_300,
    yahooCoverageOfAlpaca: 1,
    rawMetrics: {
      daily_log_return_correlation: 0.995 - epsilon,
      annualized_log_return_tracking_error: 0.03 + epsilon,
      median_absolute_daily_log_return_difference_bps: 5 + epsilon,
      p99_absolute_daily_log_return_difference_bps: 50 + epsilon,
    },
  });
  assert.ok(Object.values(riskyOutside).slice(2).every((passed) => passed === false));
  const riskyInside = evaluateGeneration5SymbolGates({
    symbol: "SPY",
    commonSessions: 1_300,
    yahooCoverageOfAlpaca: 1,
    rawMetrics: {
      daily_log_return_correlation: 0.995 + epsilon,
      annualized_log_return_tracking_error: 0.03 - epsilon,
      median_absolute_daily_log_return_difference_bps: 5 - epsilon,
      p99_absolute_daily_log_return_difference_bps: 50 - epsilon,
    },
  });
  assert.ok(Object.values(riskyInside).every(Boolean));
  const bilOutside = evaluateGeneration5SymbolGates({
    symbol: "BIL",
    commonSessions: 1_300,
    yahooCoverageOfAlpaca: 1,
    rawMetrics: {
      annualized_mean_log_return_difference_bps: 25 + epsilon,
      annualized_log_return_tracking_error: 0.01 + epsilon,
      median_absolute_daily_log_return_difference_bps: 1 + epsilon,
      p99_absolute_daily_log_return_difference_bps: 5 + epsilon,
    },
  });
  assert.ok(Object.values(bilOutside).slice(2).every((passed) => passed === false));
  const candidateOutside = evaluateGeneration5CandidateGates({
    exactDecisionAgreement: 0.99 - epsilon,
    rawReturnMetrics: {
      daily_log_return_correlation: 0.995 - epsilon,
      annualized_log_return_tracking_error: 0.02 + epsilon,
    },
    yahooEdge: 0.01,
    alpacaEdge: 0.005 - epsilon,
  });
  assert.equal(candidateOutside.exact_decision_agreement, false);
  assert.equal(candidateOutside.daily_log_return_correlation, false);
  assert.equal(candidateOutside.annualized_log_return_tracking_error, false);
  assert.equal(candidateOutside.candidate_vs_spy_edge_same_sign, true);
  assert.equal(candidateOutside.candidate_vs_spy_edge_difference, false);
});

test("Generation 5 Alpaca client supports all CORE_SYMBOLS, paginates GET-only, and does not persist secrets", async () => {
  const calls = [];
  const secret = "generation-five-secret";
  const client = new AlpacaGeneration5ReconciliationClient({
    keyId: "generation-five-key",
    secretKey: secret,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (!new URL(url).searchParams.has("page_token")) {
        return response({
          bars: { IWM: [{ t: "2020-01-02T05:00:00Z", c: 100 }] },
          next_page_token: "opaque-next",
        });
      }
      return response({
        bars: { IWM: [{ t: "2020-01-03T05:00:00Z", c: 101 }] },
        next_page_token: null,
      });
    },
  });
  const result = await client.getDailyBars(["IWM"], {
    start: "2020-01-01",
    end: "2020-01-04",
    adjustment: "all",
  });
  assert.equal(result.series_by_symbol.IWM.length, 2);
  assert.equal(result.provenance.page_count, 2);
  assert.equal(result.provenance.adjustment, "all");
  assert.equal(result.provenance.raw_responses_persisted, false);
  assert.equal(result.provenance.page_tokens_persisted, false);
  assert.ok(calls.every((call) => call.url.origin === "https://data.alpaca.markets"));
  assert.ok(calls.every((call) => call.url.pathname === "/v2/stocks/bars"));
  assert.ok(calls.every((call) => call.options.method === "GET"));
  assert.ok(calls.every((call) => call.options.redirect === "error"));
  assert.ok(calls.every((call) => call.options.headers["APCA-API-SECRET-KEY"] === secret));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("opaque-next"), false);
  await assert.rejects(() => client.getDailyBars(["IWM"], {
    start: "2020-01-01",
    end: "2020-01-04",
    feed: "sip",
  }), /only Alpaca IEX/);
  await assert.rejects(() => client.getDailyBars(["AAPL"], {
    start: "2020-01-01",
    end: "2020-01-04",
  }), /not allowlisted/);
});

test("primary risky-ETF gates compare Yahoo adjusted close to Alpaca all without exclusions", () => {
  const dates = weekdayDates(1_300);
  const yahoo = syntheticSeries("SPY", dates);
  const all = syntheticSeries("SPY", dates, 0.000001);
  const split = all.map((point, index) => ({
    ...point,
    close: index < 700 ? point.close * 0.97 : point.close,
  }));
  const result = reconcileGeneration5Symbol({
    symbol: "SPY",
    yahooSeries: yahoo,
    alpacaAllSeries: all,
    alpacaSplitSeries: split,
  });
  assert.equal(result.passed, true);
  assert.equal(result.primary_comparison, "Yahoo adjusted close versus Alpaca IEX adjustment=all");
  assert.equal(result.common_sessions, dates.length);
  assert.equal(result.primary_log_return_metrics.observations, dates.length - 1);
  assert.equal(result.alpaca_split_diagnostic.role.includes("no date or return is excluded"), true);
  assert.equal(Object.keys(result).some((key) => key.includes("excluded")), false);
});

test("BIL uses mean-difference and tracking gates but no correlation gate", () => {
  const dates = weekdayDates(1_300);
  const yahoo = dates.map((date) => ({ date, close: 100 }));
  const all = dates.map((date, index) => ({ date, close: 100 + (index % 2) * 0.000001 }));
  const result = reconcileGeneration5Symbol({
    symbol: "BIL",
    yahooSeries: yahoo,
    alpacaAllSeries: all,
    alpacaSplitSeries: all,
  });
  assert.equal(result.primary_log_return_metrics.daily_log_return_correlation, null);
  assert.equal("daily_log_return_correlation" in result.gates, false);
  assert.equal(result.passed, true);
});

test("per-symbol gates fail closed on insufficient overlap and poor risky-series concordance", () => {
  const dates = weekdayDates(1_300);
  const yahoo = syntheticSeries("SPY", dates);
  const sparse = yahoo.filter((_, index) => index % 3 !== 0).map((point, index) => ({
    ...point,
    close: point.close * (1 + 0.03 * Math.sin(index)),
  }));
  const result = reconcileGeneration5Symbol({
    symbol: "SPY",
    yahooSeries: yahoo,
    alpacaAllSeries: sparse,
    alpacaSplitSeries: sparse,
  });
  assert.equal(result.passed, false);
  assert.equal(result.gates.minimum_common_sessions, false);
  assert.equal(result.gates.daily_log_return_correlation, false);
});

test("all four eligible Generation 5 candidates are compared on the exact common all-adjusted panel", () => {
  const dates = weekdayDates(1_300);
  const yahoo = panel(dates);
  const alpacaAll = panel(dates);
  const result = compareGeneration5CandidatesAcrossSources({
    yahooSeriesBySymbol: yahoo,
    alpacaAllSeriesBySymbol: alpacaAll,
    createStrategies: createGeneration5Strategies,
    metadata: GENERATION5_METADATA,
    eligibleCandidateIds: ELIGIBLE_IDS,
  });
  assert.deepEqual(GENERATION5_REQUIRED_SYMBOLS, GENERATION5_SOURCE_SYMBOLS);
  assert.deepEqual(result.eligible_candidate_ids, ELIGIBLE_IDS);
  assert.equal(Object.keys(result.candidates).length, 4);
  assert.equal(result.passed, true);
  for (const candidate of Object.values(result.candidates)) {
    assert.equal(candidate.decision_comparison.exact_decision_agreement_fraction, 1);
    assert.equal(candidate.return_comparison.daily_log_return_correlation, 1);
    assert.equal(candidate.return_comparison.annualized_log_return_tracking_error, 0);
    assert.equal(candidate.passed, true);
  }
});

test("candidate decision disagreement fails its frozen exact-agreement gate", () => {
  const dates = weekdayDates(1_300);
  const yahoo = panel(dates);
  const alpacaAll = panel(dates);
  alpacaAll.SPY = alpacaAll.SPY.map((point, index) => ({
    ...point,
    close: index % 42 < 21 ? point.close * 0.5 : point.close * 1.5,
  }));
  const createStrategies = () => [{
    id: "test_switch",
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      const chooseSpy = points[signalIndex].SPY > points[signalIndex].QQQ;
      return Object.freeze({
        BIL: 0,
        [chooseSpy ? "SPY" : "QQQ"]: 1,
      });
    },
  }];
  const result = compareGeneration5CandidatesAcrossSources({
    yahooSeriesBySymbol: yahoo,
    alpacaAllSeriesBySymbol: alpacaAll,
    createStrategies,
    metadata: { test_switch: { role: "candidate" } },
    eligibleCandidateIds: ["test_switch"],
  });
  assert.equal(result.candidates.test_switch.gates.exact_decision_agreement, false);
  assert.equal(result.passed, false);
});

test("overall result requires every symbol and every eligible candidate to pass", () => {
  const dates = weekdayDates(1_300);
  const yahoo = panel(dates);
  const alpacaAll = panel(dates);
  const alpacaSplit = panel(dates);
  const passing = buildGeneration5SourceReconciliation({
    yahooSeriesBySymbol: yahoo,
    alpacaAllSeriesBySymbol: alpacaAll,
    alpacaSplitSeriesBySymbol: alpacaSplit,
    createStrategies: createGeneration5Strategies,
    metadata: GENERATION5_METADATA,
    eligibleCandidateIds: ELIGIBLE_IDS,
  });
  assert.equal(passing.passed, true);
  const damaged = {
    ...alpacaAll,
    EFA: alpacaAll.EFA.map((point, index) => ({
      ...point,
      close: point.close * (1 + 0.04 * Math.sin(index)),
    })),
  };
  const failing = buildGeneration5SourceReconciliation({
    yahooSeriesBySymbol: yahoo,
    alpacaAllSeriesBySymbol: damaged,
    alpacaSplitSeriesBySymbol: alpacaSplit,
    createStrategies: createGeneration5Strategies,
    metadata: GENERATION5_METADATA,
    eligibleCandidateIds: ELIGIBLE_IDS,
  });
  assert.equal(failing.per_symbol.EFA.passed, false);
  assert.equal(failing.passed, false);
  assert.ok(failing.blocking_reasons.some((reason) => reason.startsWith("EFA failed")));
});
