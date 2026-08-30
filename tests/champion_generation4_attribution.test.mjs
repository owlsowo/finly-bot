import assert from "node:assert/strict";
import test from "node:test";

import {
  factorLikeExposureAttribution,
  fitDescriptiveOls,
  grossReturnContributions,
  rollingReturnDifferenceAttribution,
  sectorSelectionAttribution,
  turnoverAndCostAttribution,
  validateAlignedRows,
  weightAttribution,
} from "../research/champion_generation4_attribution.mjs";

const symbols = ["SPY", "BIL", "QQQ", "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU"];

function row(index, {
  candidateReturn = 0.01,
  spyReturn = 0.005,
  qqqReturn = 0.008,
  xlkReturn = 0.009,
  staticReturn = 0.0065,
  rebalanced = index % 2 === 0,
  transactionCost = 0,
  turnover = 0,
} = {}) {
  const date = `2020-01-${String(index + 1).padStart(2, "0")}`;
  const weights = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
  Object.assign(weights, { QQQ: 0.5, XLK: 1 / 6, XLF: 1 / 6, XLE: 1 / 6 });
  const assetReturns = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
  Object.assign(assetReturns, { SPY: spyReturn, QQQ: qqqReturn, XLK: xlkReturn, XLF: candidateReturn, XLE: candidateReturn, BIL: 0 });
  return {
    signal_date: date,
    rebalance_date: date,
    execution_return_date: date,
    rebalanced,
    signal_weights: { ...weights },
    weights: { ...weights },
    asset_returns: assetReturns,
    cash_return: 0,
    gross_return: candidateReturn,
    transaction_cost: transactionCost,
    financing_spread_cost: 0,
    turnover_notional: turnover,
    net_return: candidateReturn - transactionCost,
    static_return: staticReturn,
  };
}

test("sector frequencies and average weights use executed targets and realized holdings", () => {
  const rows = [row(0), row(1), row(2), row(3)];
  rows[2].signal_weights.XLK = 0;
  rows[2].signal_weights.XLY = 1 / 6;
  const selection = sectorSelectionAttribution(rows);
  assert.equal(selection.executed_rebalance_decisions, 2);
  assert.equal(selection.by_sector.XLK.selected_decisions, 1);
  assert.equal(selection.by_sector.XLY.selected_decisions, 1);
  assert.equal(selection.sector_slots, 6);
  const weights = weightAttribution(rows, symbols);
  assert.equal(weights.time_weighted_realized_start_of_return_weights.QQQ, 0.5);
  assert.equal(weights.direct_concentration_proxies.average_qqq_plus_xlk_direct_weight, 0.6666666667);
});

test("wealth-weighted gross contributions reconcile exactly", () => {
  const first = row(0, { candidateReturn: 0.01, qqqReturn: 0.02, xlkReturn: 0 });
  const second = row(1, { candidateReturn: 0.01, qqqReturn: 0.02, xlkReturn: 0 });
  first.asset_returns.XLF = 0;
  first.asset_returns.XLE = 0;
  second.asset_returns.XLF = 0;
  second.asset_returns.XLE = 0;
  const result = grossReturnContributions([first, second], symbols);
  assert.equal(result.compounded_gross_total_return, 0.0201);
  assert.equal(result.by_asset.QQQ.initial_capital_return_contribution, 0.0201);
  assert.ok(Math.abs(result.reconciliation_error) < 1e-10);
});

test("rolling differences compound continuous net returns without artificial boundary trades", () => {
  const candidate = [row(0, { candidateReturn: 0.04 }), row(1, { candidateReturn: -0.01 }), row(2, { candidateReturn: 0.03 })];
  const spy = candidate.map((item) => ({ ...item, net_return: 0.01 }));
  const result = rollingReturnDifferenceAttribution(candidate, spy, [2]);
  const stats = result.by_sessions[2].candidate_minus_spy_total_return_difference;
  assert.equal(stats.count, 2);
  assert.equal(stats.positive_fraction, 0.5);
  assert.equal(stats.minimum, -0.0004);
  assert.equal(stats.maximum, 0.0095);
});

test("OLS recovers deterministic coefficients and exposure wrapper is descriptive", () => {
  const x1 = Array.from({ length: 12 }, (_, index) => (index - 5) / 100);
  const x2 = Array.from({ length: 12 }, (_, index) => ((index % 3) - 1) / 100);
  const y = x1.map((value, index) => 0.001 + 2 * value - 0.5 * x2[index]);
  const fitted = fitDescriptiveOls(y, { first: x1, second: x2 });
  assert.equal(fitted.intercept_daily, 0.001);
  assert.equal(fitted.coefficients.first, 2);
  assert.equal(fitted.coefficients.second, -0.5);
  assert.equal(fitted.r_squared, 1);

  const candidate = Array.from({ length: 12 }, (_, index) => row(index, {
    candidateReturn: 0.001 + index * 0.0005,
    spyReturn: 0.0005 + index * 0.0003,
    qqqReturn: 0.0008 + index * 0.0004 + (index % 2) * 0.0001,
    xlkReturn: 0.0009 + index * 0.00045 + (index % 3) * 0.0001,
    staticReturn: 0.0007 + index * 0.00025 + (index % 4) * 0.00005,
  }));
  const staticRows = candidate.map((item) => ({ ...item, gross_return: item.static_return }));
  const exposure = factorLikeExposureAttribution(candidate, staticRows);
  assert.equal(exposure.regressions.market_and_growth_proxy.observations, 12);
  assert.match(exposure.interpretation_boundary, /not investable alpha evidence/);
});

test("turnover separates terminal liquidation and alignment fails closed", () => {
  const rows = [row(0, { transactionCost: 0.001, turnover: 2 }), row(1), row(2, { transactionCost: 0.0005, turnover: 1 })];
  rows[2].terminal_liquidation_notional = 1;
  rows[2].terminal_liquidation_cost = 0.0005;
  const result = turnoverAndCostAttribution(rows);
  assert.equal(result.cumulative_turnover_notional_including_terminal_liquidation, 3);
  assert.equal(result.cumulative_strategy_turnover_notional_excluding_terminal_liquidation, 2);
  assert.equal(result.transaction_cost_simple_sum_excluding_terminal_liquidation, 0.001);

  const left = [row(0), row(1)];
  const right = [row(0), row(1)];
  assert.equal(validateAlignedRows({ left, right }, ["left", "right"]).aligned, true);
  right[1].execution_return_date = "2020-02-01";
  assert.throws(() => validateAlignedRows({ left, right }, ["left", "right"]), /misaligned/);
});
