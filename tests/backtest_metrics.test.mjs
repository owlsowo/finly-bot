import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBacktestMetrics,
  computeBacktestMetrics,
  summarizeBacktestMetrics,
  wilsonInterval95,
} from "../lib/backtest_metrics.mjs";

function point(day, equity) {
  return { timestamp: `2025-01-${String(day).padStart(2, "0")}T21:00:00Z`, equity };
}

test("descriptive metrics distinguish returns, risk, abstention, and sample coverage", () => {
  const metrics = calculateBacktestMetrics({
    equityCurve: [point(2, 100), point(3, 110), point(4, 90), point(5, 120)],
    benchmarkCurve: [point(2, 100), point(5, 110)],
    trades: [
      { pnl: 100, maxCapitalAtRisk: 500 },
      { pnl: -40, maxCapitalAtRisk: 400 },
      { pnl: 0, maxCapitalAtRisk: 300 },
      { pnl: 20, maxCapitalAtRisk: 200 },
    ],
    decisions: { total: 10, traded: 4, abstained: 6 },
    annualization: { periodsPerYear: 252, riskFreeRateAnnual: 0.04 },
  });

  assert.equal(metrics.schema_version, "finly_backtest_metrics.v1");
  assert.equal(metrics.start_equity, 100);
  assert.equal(metrics.end_equity, 120);
  assert.ok(Math.abs(metrics.total_return - 0.2) < 1e-12);
  assert.ok(Math.abs(metrics.benchmark_return - 0.1) < 1e-12);
  assert.ok(Math.abs(metrics.excess_return - 0.1) < 1e-12);
  assert.ok(Math.abs(metrics.max_drawdown - (1 - 90 / 110)) < 1e-12);
  assert.equal(metrics.annualized_volatility, null);
  assert.match(metrics.unavailable_reasons.annualized_volatility, /at least 20/);

  assert.deepEqual(
    [metrics.trade_count, metrics.win_count, metrics.loss_count, metrics.flat_count],
    [4, 2, 1, 1],
  );
  assert.equal(metrics.win_rate, 2 / 3);
  assert.deepEqual(metrics.win_rate_wilson_95, wilsonInterval95(2, 3));
  assert.ok(metrics.win_rate_wilson_95.lower < metrics.win_rate);
  assert.ok(metrics.win_rate_wilson_95.upper > metrics.win_rate);
  assert.equal(metrics.gross_profit, 120);
  assert.equal(metrics.gross_loss, 40);
  assert.equal(metrics.net_pnl, 80);
  assert.equal(metrics.profit_factor, 3);
  assert.equal(metrics.average_pnl, 20);
  assert.equal(metrics.median_pnl, 10);
  assert.equal(metrics.average_max_capital_at_risk, 350);
  assert.ok(Math.abs(metrics.return_on_risk - 80 / 1400) < 1e-12);
  assert.equal(metrics.abstention_rate, 0.6);
  assert.equal(metrics.data_coverage.benchmark_boundary_aligned, true);
  assert.equal(metrics.data_coverage.benchmark_timestamp_coverage, 0.5);
  assert.equal(metrics.data_coverage.capital_at_risk_coverage, 1);
  assert.doesNotMatch(JSON.stringify(metrics), /NaN|Infinity/);
});

test("annualized volatility and Sharpe require an explicit frequency and enough returns", () => {
  let equity = 100;
  const equityCurve = [point(1, equity)];
  for (let day = 2; day <= 21; day += 1) {
    equity *= day % 2 === 0 ? 1.01 : 0.995;
    equityCurve.push(point(day, equity));
  }

  const withoutAssumptions = calculateBacktestMetrics({ equityCurve });
  assert.equal(withoutAssumptions.annualized_volatility, null);
  assert.equal(withoutAssumptions.sharpe_ratio, null);
  assert.match(withoutAssumptions.unavailable_reasons.sharpe_ratio, /explicit/);

  const withAssumptions = calculateBacktestMetrics({
    equityCurve,
    annualization: { periodsPerYear: 252, riskFreeRateAnnual: 0.03 },
  });
  assert.ok(Number.isFinite(withAssumptions.annualized_volatility));
  assert.ok(withAssumptions.annualized_volatility > 0);
  assert.ok(Number.isFinite(withAssumptions.sharpe_ratio));
  assert.equal(withAssumptions.unavailable_reasons.annualized_volatility, null);
  assert.equal(withAssumptions.unavailable_reasons.sharpe_ratio, null);

  const flatCurve = Array.from({ length: 21 }, (_, index) => point(index + 1, 100));
  const flat = calculateBacktestMetrics({
    equityCurve: flatCurve,
    annualization: { periodsPerYear: 252, riskFreeRateAnnual: 0 },
  });
  assert.equal(flat.annualized_volatility, 0);
  assert.equal(flat.sharpe_ratio, null);
  assert.match(flat.unavailable_reasons.sharpe_ratio, /volatility is zero/);
});

test("realized-exit curves suppress annualized risk claims and label drawdown scope", () => {
  let equity = 100;
  const equityCurve = [point(1, equity)];
  for (let day = 2; day <= 21; day += 1) {
    equity += day % 2 === 0 ? 1 : -0.5;
    equityCurve.push(point(day, equity));
  }
  const metrics = calculateBacktestMetrics({
    equityCurve,
    trades: [{ pnl: equity - 100, maxCapitalAtRisk: 25 }],
    equityCurveBasis: "realized_exit_only",
    annualization: { periodsPerYear: 252, riskFreeRateAnnual: 0.03 },
  });
  assert.equal(metrics.equity_curve_basis, "realized_exit_only");
  assert.ok(Number.isFinite(metrics.max_drawdown));
  assert.match(metrics.metric_basis.max_drawdown, /excludes_intratrade/);
  assert.equal(metrics.annualized_volatility, null);
  assert.equal(metrics.sharpe_ratio, null);
  assert.match(metrics.unavailable_reasons.annualized_volatility, /daily mark-to-market/);
  assert.equal(metrics.metric_basis.sharpe_ratio, "suppressed_requires_daily_mark_to_market");
});

test("a no-trade cash result does not claim excess return over a falling benchmark", () => {
  const metrics = calculateBacktestMetrics({
    equityCurve: [point(1, 100), point(2, 100)],
    benchmarkCurve: [point(1, 100), point(2, 90)],
    decisions: { total: 1, traded: 0, abstained: 1 },
    equityCurveBasis: "realized_exit_only",
    annualization: { periodsPerYear: 252, riskFreeRateAnnual: 0.03 },
  });
  assert.equal(metrics.total_return, 0);
  assert.ok(Math.abs(metrics.benchmark_return + 0.1) < 1e-12);
  assert.equal(metrics.excess_return, null);
  assert.match(metrics.unavailable_reasons.excess_return, /no-trade window/);
  assert.equal(metrics.metric_basis.excess_return, "suppressed_for_no_trade_window");
  assert.equal(metrics.max_drawdown, null);
  assert.match(metrics.unavailable_reasons.max_drawdown, /not evidence of zero market risk/);
});

test("empty and incomplete samples return explicit nulls instead of fabricated evidence", () => {
  const empty = calculateBacktestMetrics();
  for (const key of [
    "start_equity",
    "end_equity",
    "total_return",
    "benchmark_return",
    "excess_return",
    "max_drawdown",
    "annualized_volatility",
    "sharpe_ratio",
    "win_rate",
    "win_rate_wilson_95",
    "profit_factor",
    "average_pnl",
    "median_pnl",
    "average_max_capital_at_risk",
    "return_on_risk",
    "abstention_rate",
  ]) {
    assert.equal(empty[key], null, key);
    assert.equal(typeof empty.unavailable_reasons[key], "string", key);
  }
  assert.deepEqual(
    [empty.trade_count, empty.win_count, empty.loss_count, empty.flat_count],
    [0, 0, 0, 0],
  );
  assert.equal(empty.gross_profit, 0);
  assert.equal(empty.gross_loss, 0);
  assert.equal(empty.net_pnl, 0);
  assert.equal(empty.data_coverage.benchmark_timestamp_coverage, null);
  assert.equal(empty.data_coverage.capital_at_risk_coverage, null);

  const partialRisk = calculateBacktestMetrics({
    trades: [{ pnl: 10, maxCapitalAtRisk: 50 }, { pnl: -5 }],
    decisionCounts: { total: 3, executed: 2, abstained: 1 },
  });
  assert.equal(partialRisk.average_max_capital_at_risk, null);
  assert.equal(partialRisk.return_on_risk, null);
  assert.match(partialRisk.unavailable_reasons.return_on_risk, /1 of 2/);
  assert.equal(partialRisk.data_coverage.capital_at_risk_coverage, 0.5);
  assert.equal(partialRisk.abstention_rate, 1 / 3);
});

test("benchmark excess return is withheld when comparison boundaries differ", () => {
  const metrics = calculateBacktestMetrics({
    equityCurve: [point(2, 100), point(5, 105)],
    benchmarkCurve: [point(1, 100), point(5, 102)],
    trades: [{ pnl: 5, maxCapitalAtRisk: 10 }],
  });
  assert.ok(Math.abs(metrics.total_return - 0.05) < 1e-12);
  assert.ok(Math.abs(metrics.benchmark_return - 0.02) < 1e-12);
  assert.equal(metrics.excess_return, null);
  assert.match(metrics.unavailable_reasons.excess_return, /identical start and end timestamps/);
  assert.equal(metrics.data_coverage.benchmark_boundary_aligned, false);
});

test("malformed, ambiguous, and non-chronological inputs fail closed", () => {
  assert.throws(() => calculateBacktestMetrics(null), /must be an object/);
  assert.throws(
    () => calculateBacktestMetrics({ equityCurve: [point(2, 100), point(1, 101)] }),
    /strictly increasing/,
  );
  assert.throws(
    () => calculateBacktestMetrics({ equityCurve: [{ timestamp: "2025-01-01T12:00:00", equity: 100 }] }),
    /timezone/,
  );
  assert.throws(
    () => calculateBacktestMetrics({ equityCurve: [{ timestamp: "2025-01-01", equity: 0 }] }),
    /greater than zero/,
  );
  assert.throws(() => calculateBacktestMetrics({ trades: [{}] }), /pnl is required/);
  assert.throws(
    () => calculateBacktestMetrics({ trades: [{ pnl: Number.NaN }] }),
    /finite number/,
  );
  assert.throws(
    () => calculateBacktestMetrics({ trades: [{ pnl: 1, maxCapitalAtRisk: 0 }] }),
    /greater than zero/,
  );
  assert.throws(
    () => calculateBacktestMetrics({ decisions: { total: 5, traded: 3, abstained: 3 } }),
    /must equal/,
  );
  assert.throws(
    () => calculateBacktestMetrics({ decisions: { total: 1, traded: 1 }, decisionCounts: { total: 1, traded: 1 } }),
    /not both/,
  );
  assert.throws(
    () => calculateBacktestMetrics({ annualization: { periodsPerYear: 0, riskFreeRateAnnual: 0 } }),
    /greater than zero/,
  );
  assert.throws(
    () => calculateBacktestMetrics({ equityCurveBasis: "interpolated_guess" }),
    /equityCurveBasis/,
  );
});

test("public aliases are identical and Wilson intervals handle edge proportions", () => {
  assert.equal(computeBacktestMetrics, calculateBacktestMetrics);
  assert.equal(summarizeBacktestMetrics, calculateBacktestMetrics);
  assert.equal(wilsonInterval95(0, 0), null);
  const noWins = wilsonInterval95(0, 10);
  const allWins = wilsonInterval95(10, 10);
  assert.equal(noWins.lower, 0);
  assert.equal(allWins.upper, 1);
  assert.ok(noWins.upper > 0);
  assert.ok(allWins.lower < 1);
  assert.throws(() => wilsonInterval95(2, 1), /must not exceed/);
});
