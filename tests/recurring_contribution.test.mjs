import assert from "node:assert/strict";
import test from "node:test";

import {
  rebaseRowsForFundedWindow,
  simulateMonthlyContributions,
} from "../research/recurring_contribution.mjs";
import { compareRollingMonthlyContributions } from "../research/recurring_contribution_complete_months.mjs";

function row(date, netReturn, {
  spyWeight = 1,
  transactionCost = 0,
  terminalCost = 0,
} = {}) {
  return Object.freeze({
    signal_date: date,
    rebalance_date: date,
    execution_return_date: date,
    rebalanced: false,
    signal_weights: Object.freeze({ SPY: spyWeight, BIL: 1 - spyWeight }),
    weights: Object.freeze({ SPY: spyWeight, BIL: 1 - spyWeight }),
    asset_returns: Object.freeze({ SPY: netReturn, BIL: 0 }),
    cash_return: 0,
    gross_return: netReturn * spyWeight,
    transaction_cost: transactionCost + terminalCost,
    financing_spread_cost: 0,
    turnover_notional: 0,
    net_return: netReturn * spyWeight - transactionCost - terminalCost,
    ...(terminalCost > 0 ? {
      terminal_liquidation: true,
      terminal_liquidation_notional: spyWeight,
      terminal_liquidation_cost: terminalCost,
    } : {}),
  });
}

test("funded-window rebasing removes inherited and terminal costs and charges one fresh entry", () => {
  const rows = [
    row("2025-01-02", 0.01, { transactionCost: 0.0002 }),
    row("2025-01-03", 0.02, { terminalCost: 0.0005 }),
  ];
  const rebased = rebaseRowsForFundedWindow(rows, { oneWayCostBps: 5 });
  assert.equal(rebased[0].funded_window_entry_notional, 2);
  assert.equal(rebased[0].funded_window_entry_cost, 0.001);
  assert.equal(rebased[0].net_return, 0.009);
  assert.equal(rebased[1].transaction_cost, 0);
  assert.equal(rebased[1].net_return, 0.02);
  assert.equal("terminal_liquidation" in rebased[1], false);
});

test("monthly deposits occur before the first return in each month and later buys pay incremental cost", () => {
  const rows = [
    row("2025-01-02", 0.10),
    row("2025-01-31", 0),
    row("2025-02-03", 0.10),
  ];
  const result = simulateMonthlyContributions(rows, {
    monthlyContribution: 300,
    contributionPurchaseCostBps: 5,
  });
  assert.equal(result.calendar_months, 2);
  assert.equal(result.total_contributions, 600);
  assert.equal(result.contribution_purchase_cost_dollars, 0.15);
  assert.ok(Math.abs(result.ending_value - (((300 * 1.1) + 299.85) * 1.1)) < 1e-8);
});

test("rolling comparisons use equal contribution schedules and expose the requested horizons", () => {
  const dates = [
    "2025-01-02", "2025-01-31", "2025-02-03", "2025-02-28",
    "2025-03-03", "2025-03-31", "2025-04-01", "2025-04-30",
  ];
  const candidate = dates.map((date) => row(date, 0.01));
  const benchmark = dates.map((date) => row(date, 0.005));
  const result = compareRollingMonthlyContributions(candidate, benchmark, {
    horizonsMonths: [1, 3],
    monthlyContribution: 300,
    oneWayCostBps: 5,
  });
  assert.equal(result.horizons["1"].summary.windows, 4);
  assert.equal(result.horizons["3"].summary.windows, 2);
  assert.equal(result.horizons["3"].latest_window.total_contributions, 900);
  assert.equal(result.horizons["3"].summary.candidate_beat_benchmark_fraction, 1);
  assert.ok(result.horizons["3"].latest_window.ending_value_advantage > 0);
});

test("rolling comparisons exclude a partial terminal calendar month", () => {
  const dates = ["2025-01-31", "2025-02-28", "2025-03-27"];
  const candidate = dates.map((date) => row(date, 0.01));
  const benchmark = dates.map((date) => row(date, 0.005));
  const result = compareRollingMonthlyContributions(candidate, benchmark, {
    horizonsMonths: [1],
    monthlyContribution: 300,
    oneWayCostBps: 5,
  });
  assert.equal(result.terminal_month_excluded, true);
  assert.equal(result.terminal_observation_date, "2025-03-27");
  assert.equal(result.horizons["1"].summary.windows, 2);
  assert.equal(result.horizons["1"].latest_window.end_month, "2025-02");
});

test("rolling comparisons reject misaligned dates", () => {
  assert.throws(() => compareRollingMonthlyContributions(
    [row("2025-01-02", 0)],
    [row("2025-01-03", 0)],
  ), /share execution dates/);
});
