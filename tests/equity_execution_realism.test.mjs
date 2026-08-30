import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildEquityExecutionOhlcBundle,
  hashEquityExecutionOhlcBundle,
} from "../research/acquire_equity_execution_ohlc.mjs";
import {
  EQUITY_EXECUTION_REALISM_PROTOCOL,
  EQUITY_EXECUTION_REALISM_PUBLICATION_BOUNDARY,
  frozenPolicyTarget,
  importImmutableClosePanel,
  importImmutableOhlc,
  runCloseOnlySensitivity,
  runCompleteNextOpenStudy,
  simulateNextOpenTheory,
} from "../research/equity_execution_realism.mjs";

const DAY_MILLISECONDS = 86_400_000;

function weekdayDates(count, start = "2019-01-02T00:00:00.000Z") {
  const dates = [];
  let timestamp = Date.parse(start);
  while (dates.length < count) {
    const date = new Date(timestamp);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) dates.push(date.toISOString());
    timestamp += DAY_MILLISECONDS;
  }
  return dates;
}

function frozenRangeWeekdays() {
  const dates = [];
  let timestamp = Date.parse("2016-01-04T00:00:00.000Z");
  const end = Date.parse("2026-08-28T00:00:00.000Z");
  while (timestamp <= end) {
    const date = new Date(timestamp);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) dates.push(date.toISOString());
    timestamp += DAY_MILLISECONDS;
  }
  return dates;
}

function syntheticSeries(dates, symbol, { raw = false } = {}) {
  let priorClose = symbol === "SPY" ? 100 : 91;
  return dates.map((timestamp, index) => {
    const gap = symbol === "SPY"
      ? 0.0007 * Math.sin(index / 11)
      : 0.000015 * Math.cos(index / 19);
    const cyclical = symbol === "SPY" ? 0.0035 * Math.sin(index / 23) : 0;
    const baseReturn = symbol === "SPY" ? 0.00035 : 0.00008;
    const rawDrag = raw ? (symbol === "SPY" ? 0.000035 : 0.00007) : 0;
    const open = priorClose * (1 + gap);
    const close = open * (1 + baseReturn + cyclical - rawDrag);
    priorClose = close;
    return { date: timestamp.slice(0, 10), open, close };
  });
}

function syntheticPayload(count = 680) {
  const dates = weekdayDates(count);
  return {
    adjusted: {
      SPY: syntheticSeries(dates, "SPY"),
      BIL: syntheticSeries(dates, "BIL"),
    },
    raw: {
      SPY: syntheticSeries(dates, "SPY", { raw: true }),
      BIL: syntheticSeries(dates, "BIL", { raw: true }),
    },
    provenance: { provider: "synthetic-test-only" },
  };
}

function officialResponse(dates, symbol, adjustment) {
  const symbolOffset = symbol === "SPY" ? 300 : 90;
  const adjustmentOffset = adjustment === "all" ? -10 : 0;
  const bars = dates.map((timestamp, index) => {
    const open = symbolOffset + adjustmentOffset + index * (symbol === "SPY" ? 0.05 : 0.002);
    const close = open * (1 + (symbol === "SPY" ? 0.0002 : 0.00003));
    return {
      t: timestamp,
      o: open,
      h: Math.max(open, close) * 1.001,
      l: Math.min(open, close) * 0.999,
      c: close,
      v: 1_000,
    };
  });
  return {
    symbol,
    bars,
    next_page_token: null,
    provenance: {
      provider: "Alpaca",
      origin: "https://data.alpaca.markets",
      path: `/v2/stocks/${symbol}/bars`,
      transport: "HTTPS GET",
      read_only: true,
      complete: true,
      page_count: 1,
      underlying: symbol,
      start: "2016-01-01",
      end: "2026-08-28T20:15:00.000Z",
      timeframe: "1Day",
      feed: "sip",
      adjustment,
    },
  };
}

function officialBundle() {
  const dates = frozenRangeWeekdays();
  return buildEquityExecutionOhlcBundle({
    all: {
      SPY: officialResponse(dates, "SPY", "all"),
      BIL: officialResponse(dates, "BIL", "all"),
    },
    raw: {
      SPY: officialResponse(dates, "SPY", "raw"),
      BIL: officialResponse(dates, "BIL", "raw"),
    },
  });
}

test("provider-agnostic importer fails closed on incomplete or misaligned OHLC", () => {
  const payload = syntheticPayload();
  const withoutRaw = structuredClone(payload);
  delete withoutRaw.raw;
  assert.throws(() => importImmutableOhlc(withoutRaw), /raw\/distribution-excluded book/u);

  const withoutOpen = structuredClone(payload);
  delete withoutOpen.adjusted.SPY[20].open;
  assert.throws(() => importImmutableOhlc(withoutOpen), /open must be positive/u);

  const misaligned = structuredClone(payload);
  misaligned.raw.BIL.splice(300, 1);
  assert.throws(() => importImmutableOhlc(misaligned), /identical common dates/u);
});

test("the official finly bundle shape binds schema, request, boundary, and canonical hash", () => {
  const bundle = officialBundle();
  const imported = importImmutableOhlc(bundle);
  assert.equal(imported.adjusted.common_start, "2016-01-04");
  assert.equal(imported.adjusted.common_end, "2026-08-28");
  assert.equal(imported.source_binding.schema_version, "finly_equity_execution_ohlc_bundle.v1");
  assert.equal(imported.source_binding.bundle_sha256, hashEquityExecutionOhlcBundle(bundle));
  assert.deepEqual(imported.source_binding.request.adjustments, ["all", "raw"]);
  assert.equal(imported.source_binding.request.feed, "sip");
  assert.equal(imported.source_binding.acquisition_boundary.broker_mutation_authorized, false);
});

test("next-open ledger uses close t information, opens at t+1, and self-finances the first trade", () => {
  const imported = importImmutableOhlc(syntheticPayload());
  const rows = simulateNextOpenTheory(imported, { oneWayCostBps: 5, rebalanceAnchor: 0 });
  const first = rows[0];
  const signals = imported.adjusted.points;
  const target = frozenPolicyTarget(signals, 252);
  const executionPoint = signals[253];
  const signalPoint = signals[252];
  const overnightGrowth = executionPoint.BIL.open / signalPoint.BIL.close;
  const grossTurnover = 2 * target.SPY;
  const intradayGrowth = target.SPY * executionPoint.SPY.close / executionPoint.SPY.open
    + target.BIL * executionPoint.BIL.close / executionPoint.BIL.open;
  const expectedReturn = overnightGrowth * (1 - grossTurnover * 5 / 10_000) * intradayGrowth - 1;

  assert.equal(first.signal_date, signalPoint.date);
  assert.equal(first.execution_date, executionPoint.date);
  assert.ok(first.signal_date < first.execution_date);
  assert.ok(Math.abs(first.gross_two_leg_turnover - grossTurnover) < 1e-9);
  assert.ok(Math.abs(first.net_return - expectedReturn) < 1e-10);
});

test("future price mutations cannot change an earlier frozen signal", () => {
  const payload = syntheticPayload();
  const before = importImmutableOhlc(payload);
  const beforeTarget = frozenPolicyTarget(before.adjusted.points, 400);
  const mutated = structuredClone(payload);
  mutated.adjusted.SPY[600].open *= 4;
  mutated.adjusted.SPY[600].close *= 4;
  const after = importImmutableOhlc(mutated);
  const afterTarget = frozenPolicyTarget(after.adjusted.points, 400);
  assert.deepEqual(afterTarget, beforeTarget);
});

test("complete next-open study covers cost, cadence, fresh starts, raw proxy, and $300 feasibility", () => {
  const imported = importImmutableOhlc(syntheticPayload());
  const evaluationStart = imported.adjusted.points[400].date;
  const study = runCompleteNextOpenStudy(imported, { evaluationStart });
  const costs = study.adjusted_theoretical_total_return.cost_stress_bps_per_leg;

  assert.equal(study.status, "AVAILABLE_CONSUMED_RETROSPECTIVE_EXECUTION_REALISM");
  assert.deepEqual(Object.keys(costs), ["1", "5", "10", "25"]);
  assert.deepEqual(Object.keys(study.adjusted_theoretical_total_return.continuous_cadence_anchors_at_1bp), ["0", "1", "2", "3", "4"]);
  assert.deepEqual(Object.keys(study.adjusted_theoretical_total_return.fresh_start_cadence_anchors_at_1bp), ["0", "1", "2", "3", "4"]);
  assert.ok(costs["25"].total_return <= costs["1"].total_return);
  assert.ok(Number.isFinite(study.raw_no_distribution_proxy.metrics_at_1bp.total_return));
  assert.equal(study.small_account_proxy.execution.initial_equity_usd, 300);
  assert.equal(study.small_account_proxy.execution.minimum_order_notional_usd, 1);
  assert.equal(study.small_account_proxy.execution.quantity_decimals, 9);
  assert.equal(study.small_account_proxy.execution.sell_day_fee_proxy_usd, 0.01);
  assert.ok(study.small_account_proxy.ending_equity_usd > 0);
  assert.equal(EQUITY_EXECUTION_REALISM_PROTOCOL.alpha_claim_authorized, false);
  assert.equal(EQUITY_EXECUTION_REALISM_PROTOCOL.future_profit_claim_authorized, false);
  assert.equal(EQUITY_EXECUTION_REALISM_PUBLICATION_BOUNDARY.aggregate_artifact_publication_permitted, true);
  assert.equal(EQUITY_EXECUTION_REALISM_PUBLICATION_BOUNDARY.raw_ohlc_publication_permitted, false);
  assert.equal(EQUITY_EXECUTION_REALISM_PUBLICATION_BOUNDARY.profitability_claim_publication_permitted, false);
});

test("close-only analysis is impossible to mistake for execution realism", () => {
  const payload = syntheticPayload();
  const panel = importImmutableClosePanel({
    SPY: payload.adjusted.SPY.map(({ date, close }) => ({ date, close })),
    BIL: payload.adjusted.BIL.map(({ date, close }) => ({ date, close })),
  });
  const result = runCloseOnlySensitivity(panel, { evaluationStart: panel.points[400].date });
  assert.equal(result.status, "AVAILABLE_CLOSE_REBALANCE_SENSITIVITY_NOT_EXECUTION_REALISM");
  assert.match(result.warning, /cannot be described as a next-open/u);
  assert.ok(result.cost_stress_bps_per_leg["25"].total_return <= result.cost_stress_bps_per_leg["1"].total_return);
});

test("the published aggregate is locked to the content-addressed OHLC replay and candid report", async () => {
  const [jsonBytes, report] = await Promise.all([
    readFile(new URL("../research/output/equity_execution_realism.json", import.meta.url), "utf8"),
    readFile(new URL("../research/output/equity_execution_realism_report.md", import.meta.url), "utf8"),
  ]);
  const evidence = JSON.parse(jsonBytes);
  const nextOpen = evidence.next_open_execution_realism;

  assert.equal(evidence.schema_version, "finly_equity_execution_realism_evidence.v1");
  assert.equal(evidence.artifact_scope,
    "Credential-free reproducible aggregate; raw OHLC remains private and the frozen public claim surface is unchanged.");
  assert.deepEqual(evidence.publication_boundary, EQUITY_EXECUTION_REALISM_PUBLICATION_BOUNDARY);
  assert.equal(evidence.input_integrity.optional_ohlc.file_sha256,
    "bf6d30d1935580bad515c69f2f8f22a3107ec583fc262d3b661024ac83dc1f45");
  assert.equal(evidence.input_integrity.optional_ohlc.common_sessions, 2679);
  assert.equal(evidence.input_integrity.optional_ohlc.common_start, "2016-01-04");
  assert.equal(evidence.input_integrity.optional_ohlc.common_end, "2026-08-28");
  assert.equal(nextOpen.status, "AVAILABLE_CONSUMED_RETROSPECTIVE_EXECUTION_REALISM");
  assert.equal(nextOpen.adjusted_theoretical_total_return.cost_stress_bps_per_leg["1"].total_return,
    0.1637768834);
  assert.equal(nextOpen.adjusted_theoretical_total_return.cost_stress_bps_per_leg["1"].spy_total_return,
    0.3352366407);
  assert.equal(nextOpen.adjusted_theoretical_total_return.cost_stress_bps_per_leg["5"].total_return,
    0.1538759778);
  assert.equal(nextOpen.adjusted_theoretical_total_return.cost_stress_bps_per_leg["25"].total_return,
    0.1055891073);
  assert.equal(nextOpen.raw_no_distribution_proxy.metrics_at_1bp.total_return, 0.12745684);
  assert.equal(nextOpen.small_account_proxy.ending_equity_usd, 351.88433421);
  assert.equal(nextOpen.small_account_proxy.execution.skipped_minimum_orders, 12);
  assert.equal(nextOpen.small_account_proxy.execution.sell_day_fees_total_usd, 0.7);
  assert.equal(evidence.alpha_proven, false);
  assert.equal(evidence.future_profitability_proven, false);
  assert.equal(evidence.mutation_authorized, false);
  assert.equal(evidence.broker_mutation, false);

  assert.match(report, /16\.38%/u);
  assert.match(report, /33\.52%/u);
  assert.match(report, /Finly did \*\*not\*\* beat SPY on total return/u);
  assert.match(report, /\$351\.88/u);
  assert.match(report, /not a paper-fill receipt/u);
  assert.doesNotMatch(jsonBytes, /APCA-API-KEY|API.?SECRET|authorization|client_order_id/iu);
});
