import assert from "node:assert/strict";
import test from "node:test";

import {
  AEGIS_Q_LEGACY_METADATA,
  AEGIS_Q_PUBLISHED_METRICS,
  buildCausalSignals,
  calculatePerformanceMetrics,
  normalizeAdjustedOhlc,
  simulateAegisQLegacy,
  verifyPublishedMetrics,
} from "../research/aegis_q_legacy_reproduction.mjs";

function sessionDate(index) {
  return new Date(Date.parse("2020-01-01T00:00:00Z") + index * 86_400_000)
    .toISOString().slice(0, 10);
}

function syntheticRows(length, {
  qqqClose = (index) => 100 * (1.001 ** index),
  qqqOpen = (_index, close) => close,
  tqqqOpen = (index) => 50 * (1.002 ** index),
} = {}) {
  const rows = [];
  for (let index = 0; index < length; index += 1) {
    const date = sessionDate(index);
    const close = qqqClose(index);
    const open = qqqOpen(index, close);
    const leveragedOpen = tqqqOpen(index);
    rows.push({ date, symbol: "QQQ", open, high: Math.max(open, close), low: Math.min(open, close), close });
    rows.push({
      date,
      symbol: "TQQQ",
      open: leveragedOpen,
      high: leveragedOpen,
      low: leveragedOpen,
      close: leveragedOpen,
    });
  }
  return rows;
}

test("adjusted OHLC normalization applies cumulative pre-ex-date split factors without touching volume", () => {
  const raw = [
    { date: "2020-01-03", symbol: "TQQQ", open: 120, high: 126, low: 114, close: 123, volume: 42 },
    { date: "2020-01-01", symbol: "TQQQ", open: 120, high: 126, low: 114, close: 123, volume: 40 },
    { date: "2020-01-02", symbol: "TQQQ", open: 120, high: 126, low: 114, close: 123, volume: 41 },
  ];
  const panel = normalizeAdjustedOhlc(raw, [
    { symbol: "TQQQ", ex_date: "2020-01-02", old_rate: 1, new_rate: 2 },
    { symbol: "TQQQ", ex_date: "2020-01-03", old_rate: 1, new_rate: 3 },
  ]);

  assert.deepEqual(panel.bars.map((bar) => bar.open), [20, 40, 120]);
  assert.deepEqual(panel.bars.map((bar) => bar.volume), [40, 41, 42]);
  assert.match(panel.normalized_panel_sha256, /^[a-f0-9]{64}$/);
  assert.equal(raw[0].open, 120);
});

test("normalization fails closed on duplicate symbol-date rows", () => {
  const row = { date: "2020-01-01", symbol: "QQQ", open: 1, high: 1, low: 1, close: 1 };
  assert.throws(() => normalizeAdjustedOhlc([row, { ...row }]), /duplicate OHLC row/);
});

test("signals use an inclusive SMA200, a 63-session return, sample RV20, and no future bars", () => {
  const basePanel = normalizeAdjustedOhlc(syntheticRows(205));
  const extendedRows = [
    ...syntheticRows(205),
    ...syntheticRows(2, {
      qqqClose: (index) => (index === 0 ? 1_000 : 5),
      tqqqOpen: (index) => (index === 0 ? 2_000 : 4),
    }).map((row) => ({
      ...row,
      date: sessionDate(205 + Number(row.date === sessionDate(1))),
    })),
  ];
  const base = buildCausalSignals(basePanel);
  const extended = buildCausalSignals(normalizeAdjustedOhlc(extendedRows));

  assert.equal(base[198].formed, false);
  assert.equal(base[199].formed, true);
  assert.equal(base[199].target_symbol, "TQQQ");
  assert.equal(base[199].target_weight, 0.7);
  assert.ok(Math.abs(base[199].sma
    - syntheticRows(200).filter((row) => row.symbol === "QQQ")
      .reduce((sum, row) => sum + row.close, 0) / 200) < 1e-10);
  assert.deepEqual(extended.slice(0, base.length), base);
});

test("simulation queues a close signal to the next open and rebalances only after five-point drift", () => {
  const rows = syntheticRows(205, {
    tqqqOpen: (index) => (index <= 200 ? 100 : 200),
  });
  const result = simulateAegisQLegacy(normalizeAdjustedOhlc(rows), {
    initialCapital: 100_000,
  });

  assert.equal(result.decisions[0].signal_bar_date, sessionDate(199));
  assert.equal(result.decisions[0].date, sessionDate(200));
  assert.equal(result.decisions[0].position_after, "TQQQ");
  assert.equal(result.decisions[0].target_weight, 0.7);
  assert.equal(result.decisions[0].traded, true);
  assert.ok(Math.abs(result.equity_curve[0].agent - (30_000 + 70_000 / 1.0005)) < 1e-8);
  assert.equal(result.decisions[1].traded, true);
  assert.ok(result.decisions[1].weight_before - 0.7 > 0.05);
  assert.equal(result.metrics.agent.trade_events, 2);
  assert.equal(result.metrics.agent.order_legs, 2);
});

test("risk-off cash earns exactly zero and creates no trade legs", () => {
  const result = simulateAegisQLegacy(normalizeAdjustedOhlc(syntheticRows(205, {
    qqqClose: () => 100,
    qqqOpen: () => 100,
    tqqqOpen: () => 100,
  })));

  assert.ok(result.equity_curve.every((point) => point.agent === 100_000));
  assert.ok(result.decisions.every((decision) => decision.target_symbol === "CASH"));
  assert.equal(result.metrics.agent.trade_events, 0);
  assert.equal(result.metrics.agent.order_legs, 0);
  assert.equal(result.metrics.agent.total_return, 0);
});

test("performance statistics reproduce the source's price-return definitions", () => {
  const metrics = calculatePerformanceMetrics([
    { date: "2020-01-01", value: 100 },
    { date: "2020-01-02", value: 110 },
    { date: "2020-01-03", value: 99 },
  ], { initialCapital: 100 });

  assert.ok(Math.abs(metrics.total_return + 0.01) < 1e-12);
  assert.ok(Math.abs(metrics.annual_volatility - Math.sqrt(0.02) * Math.sqrt(252)) < 1e-12);
  assert.ok(Math.abs(metrics.sharpe_0pct_cash) < 1e-12);
  assert.ok(Math.abs(metrics.max_drawdown + 0.1) < 1e-12);
  assert.ok(Math.abs(metrics.best_day - 0.1) < 1e-12);
  assert.ok(Math.abs(metrics.worst_day + 0.1) < 1e-12);
});

test("published-metric verifier passes the pinned bundle and identifies any changed field", () => {
  const exact = verifyPublishedMetrics(AEGIS_Q_PUBLISHED_METRICS);
  assert.equal(exact.verified, true);
  assert.equal(exact.failed_fields.length, 0);
  assert.equal(exact.compared_fields, 40);

  const changed = structuredClone(AEGIS_Q_PUBLISHED_METRICS);
  changed.agent.cagr += 0.01;
  const failed = verifyPublishedMetrics(changed);
  assert.equal(failed.verified, false);
  assert.deepEqual(failed.failed_fields, ["metrics.agent.cagr"]);
  assert.equal(failed.published_source_url, AEGIS_Q_LEGACY_METADATA.source_urls.published_metrics);
  assert.equal(failed.claim_boundary.submitted_options_pnl, false);
});
