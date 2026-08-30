import assert from "node:assert/strict";
import test from "node:test";

import {
  AlpacaReconciliationClient,
  compareCandidateAcrossSources,
  normalizeAlpacaBars,
  reconcileSymbol,
  RECONCILIATION_SYMBOLS,
} from "../research/source_overlap_reconciliation.mjs";

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
  const symbolOffset = RECONCILIATION_SYMBOLS.indexOf(symbol) + 1;
  return dates.map((date, index) => ({
    date,
    close: 50 + symbolOffset + (index * (0.015 + symbolOffset * 0.0005))
      + Math.sin(index / (11 + symbolOffset)) * (0.2 + symbolOffset * 0.01)
      + perturbation * Math.cos(index / 7),
  }));
}

test("Alpaca reconciliation client paginates read-only adjusted daily bars without leaking credentials", async () => {
  const calls = [];
  const secret = "paper-secret-do-not-persist";
  const client = new AlpacaReconciliationClient({
    keyId: "paper-key-id",
    secretKey: secret,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (!new URL(url).searchParams.has("page_token")) {
        return response({
          bars: { SPY: [{ t: "2020-01-02T05:00:00Z", c: 100 }] },
          next_page_token: "next",
        });
      }
      return response({
        bars: { SPY: [{ t: "2020-01-03T05:00:00Z", c: 101 }] },
        next_page_token: null,
      });
    },
  });
  const result = await client.getDailyBars(["SPY"], {
    start: "2020-01-01",
    end: "2020-01-04",
    adjustment: "split",
  });
  assert.equal(result.series_by_symbol.SPY.length, 2);
  assert.equal(result.provenance.page_count, 2);
  assert.ok(calls.every((call) => call.url.origin === "https://data.alpaca.markets"));
  assert.ok(calls.every((call) => call.url.pathname === "/v2/stocks/bars"));
  assert.ok(calls.every((call) => call.url.searchParams.get("adjustment") === "split"));
  assert.ok(calls.every((call) => call.options.method === "GET"));
  assert.ok(calls.every((call) => call.options.headers["APCA-API-SECRET-KEY"] === secret));
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("Alpaca reconciliation client rejects repeated tokens, malformed bars, and unsafe symbols", async () => {
  const client = new AlpacaReconciliationClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-do-not-persist",
    fetchImpl: async () => response({ bars: { SPY: [] }, next_page_token: "same" }),
  });
  await assert.rejects(() => client.getDailyBars(["SPY"], {
    start: "2020-01-01",
    end: "2020-01-04",
  }), /repeated/);
  await assert.rejects(() => client.getDailyBars(["AAPL"], {
    start: "2020-01-01",
    end: "2020-01-04",
  }), /not allowlisted/);
  assert.throws(() => normalizeAlpacaBars("SPY", [
    { t: "2020-01-03T05:00:00Z", c: 100 },
    { t: "2020-01-02T05:00:00Z", c: 101 },
  ]), /out of order/);
});

test("per-symbol reconciliation distinguishes ordinary-session feed agreement from distribution adjustments", () => {
  const dates = weekdayDates(1_050);
  const yahoo = syntheticSeries("SPY", dates);
  const split = yahoo.map((point, index) => ({ ...point, close: point.close * (1 + Math.sin(index / 5) * 0.000001) }));
  const all = split.map((point, index) => ({
    ...point,
    close: index < 700 ? point.close * 0.98 : point.close,
  }));
  const result = reconcileSymbol({
    symbol: "SPY",
    yahooSeries: yahoo,
    alpacaSplitSeries: split,
    alpacaAllSeries: all,
  });
  assert.equal(result.passed, true);
  assert.ok(result.ordinary_session_log_return_comparison.log_return_correlation > 0.999);
  assert.ok(result.corporate_action_adjustment_diagnostic.excluded_interval_count >= 1);
  assert.ok(result.corporate_action_adjustment_diagnostic.excluded_interval_dates.includes(dates[700]));
});

test("per-symbol reconciliation fails closed when coverage or return concordance is poor", () => {
  const dates = weekdayDates(1_050);
  const yahoo = syntheticSeries("SPY", dates);
  const sparse = yahoo.filter((_, index) => index % 3 !== 0).map((point, index) => ({
    ...point,
    close: point.close * (1 + 0.02 * Math.sin(index)),
  }));
  const result = reconcileSymbol({
    symbol: "SPY",
    yahooSeries: yahoo,
    alpacaSplitSeries: sparse,
    alpacaAllSeries: sparse,
  });
  assert.equal(result.passed, false);
  assert.equal(result.gates.minimum_common_sessions, false);
  assert.equal(result.gates.yahoo_dates_covered, false);
});

test("candidate comparison runs the real qqq_core_sector_12_6 decision rule on a common panel", () => {
  const dates = weekdayDates(1_050);
  const yahoo = Object.fromEntries(RECONCILIATION_SYMBOLS.map((symbol) => [symbol, syntheticSeries(symbol, dates)]));
  const alpaca = Object.fromEntries(RECONCILIATION_SYMBOLS.map((symbol) => [symbol, syntheticSeries(symbol, dates, 0.00001)]));
  const result = compareCandidateAcrossSources({
    yahooSeriesBySymbol: yahoo,
    alpacaSeriesBySymbol: alpaca,
  });
  assert.equal(result.common_panel_sessions, dates.length);
  assert.equal(result.candidate_signal_comparison.exact_top_three_agreement_fraction, 1);
  assert.ok(result.candidate_return_comparison.daily_log_return_correlation > 0.999);
  assert.equal(result.passed, true);
});
