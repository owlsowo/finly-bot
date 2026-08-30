import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildEquityShadowExecution,
  canonicalEquityShadowExecutionJson,
} from "../lib/equity_shadow_execution.mjs";

function eligibleAssets() {
  return {
    SPY: { tradable: true, fractionable: true },
    BIL: { tradable: true, fractionable: true },
  };
}

function baseInput(overrides = {}) {
  return {
    holdings: { SPY: "2.000000000", BIL: "0" },
    cash: "100",
    prices: { SPY: "500", BIL: "100" },
    target_weights: { SPY: 0.5, BIL: 0.5 },
    asset_eligibility: eligibleAssets(),
    ...overrides,
  };
}

test("builds a deterministic, sell-before-buy, self-financing fractional preview", () => {
  const preview = buildEquityShadowExecution(baseInput({
    theoretical_adjusted_total_return: {
      portfolio_index: 1.2345,
      series: { SPY: 1.3, BIL: 1.04 },
    },
  }));

  assert.equal(preview.preview_only, true);
  assert.equal(preview.broker_mutation_authorized, false);
  assert.equal(preview.status, "ready");
  assert.deepEqual(preview.order_plan.orders.map(({ sequence, symbol, side, qty }) => ({ sequence, symbol, side, qty })), [
    { sequence: 1, symbol: "SPY", side: "sell", qty: "0.900000000" },
    { sequence: 2, symbol: "BIL", side: "buy", qty: "5.500000000" },
  ]);
  assert.equal(preview.order_plan.orders.every((order) => /^\d+\.\d{9}$/u.test(order.qty)), true);
  assert.equal(preview.order_plan.orders.every((order) => order.reference_notional >= 1), true);
  assert.equal(preview.funding.net_sell_proceeds, 450);
  assert.equal(preview.funding.buy_budget_after_sells, 550);
  assert.equal(preview.funding.total_buy_cash_required, 550);
  assert.equal(preview.funding.self_financing, true);
  assert.equal(preview.broker_cash_equity.calculated_equity_before, 1100);
  assert.equal(preview.broker_cash_equity.cash_after_preview, 0);
  assert.deepEqual(preview.broker_cash_equity.holdings_after_preview, {
    SPY: "1.100000000",
    BIL: "5.500000000",
  });
  assert.deepEqual(preview.drift.after_preview.weight_minus_target, { SPY: 0, BIL: 0 });
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.isFrozen(preview.order_plan.orders), true);
});

test("models adverse bps slippage, costs, and sell-only regulatory fees in the buy budget", () => {
  const preview = buildEquityShadowExecution(baseInput({
    cost_model: {
      slippage_bps: 10,
      cost_bps: 5,
      regulatory_sell_fee_bps: 2,
    },
  }));
  const [sell, buy] = preview.order_plan.orders;

  assert.equal(sell.side, "sell");
  assert.equal(buy.side, "buy");
  assert.equal(sell.modeled_execution_price, 499.5);
  assert.equal(buy.modeled_execution_price, 100.1);
  assert.equal(sell.modeled_transaction_cost, 0.224775);
  assert.equal(sell.modeled_regulatory_sell_fee, 0.08991);
  assert.equal(buy.modeled_regulatory_sell_fee, 0);
  assert.equal(preview.funding.net_sell_proceeds, 449.235315);
  assert.equal(preview.funding.buy_budget_after_sells, 549.235315);
  assert.equal(preview.funding.total_buy_cash_required <= preview.funding.buy_budget_after_sells, true);
  assert.equal(preview.funding.unused_buy_budget >= 0, true);
  assert.equal(preview.broker_cash_equity.calculated_equity_after_preview < 1100, true);
  assert.equal(preview.order_plan.skipped_deltas.some((item) => item.reason === "self_financing_buy_budget_limit"), true);
});

test("keeps adjusted-total-return theory separate from broker cash-equity sizing", () => {
  const lowTheory = buildEquityShadowExecution(baseInput({
    theoretical_adjusted_total_return: { BIL: 0.01, SPY: -0.5 },
  }));
  const highTheory = buildEquityShadowExecution(baseInput({
    theoretical_adjusted_total_return: { SPY: 9, BIL: 8 },
  }));

  assert.deepEqual(lowTheory.order_plan.orders, highTheory.order_plan.orders);
  assert.deepEqual(lowTheory.broker_cash_equity, highTheory.broker_cash_equity);
  assert.equal(lowTheory.non_broker_theory.used_for_order_sizing, false);
  assert.equal(lowTheory.non_broker_theory.used_for_broker_cash_equity, false);
  assert.deepEqual(lowTheory.non_broker_theory.theoretical_adjusted_total_return, { BIL: 0.01, SPY: -0.5 });
  assert.equal("theoretical_adjusted_total_return" in lowTheory.broker_cash_equity, false);
});

test("fails closed when eligibility is absent or reported account equity does not reconcile", () => {
  const missingEligibility = buildEquityShadowExecution(baseInput({ asset_eligibility: undefined }));
  assert.equal(missingEligibility.status, "blocked_asset_eligibility");
  assert.deepEqual(missingEligibility.order_plan.orders, []);
  assert.equal(missingEligibility.asset_eligibility.SPY.eligible_for_fractional_order, false);
  assert.equal(missingEligibility.asset_eligibility.BIL.flags_present, false);
  assert.deepEqual(missingEligibility.order_plan.skipped_deltas.map((item) => item.reason), [
    "asset_not_tradable_or_fractionable",
    "asset_not_tradable_or_fractionable",
  ]);

  const mismatch = buildEquityShadowExecution(baseInput({ reported_equity: 1100.02 }));
  assert.equal(mismatch.status, "blocked_equity_reconciliation");
  assert.equal(mismatch.broker_cash_equity.reconciliation.status, "mismatch");
  assert.equal(mismatch.broker_cash_equity.reconciliation.reported_minus_calculated, 0.02);
  assert.deepEqual(mismatch.order_plan.orders, []);
  assert.equal(mismatch.order_plan.skipped_deltas.every((item) => item.reason === "account_equity_reconciliation_mismatch"), true);
});

test("skips sub-dollar deltas and records the reason instead of rounding them into orders", () => {
  const preview = buildEquityShadowExecution({
    holdings: { SPY: 1, BIL: 1 },
    cash: 0,
    prices: { SPY: 100, BIL: 100 },
    target_weights: { SPY: 0.504, BIL: 0.496 },
    asset_eligibility: eligibleAssets(),
  });

  assert.equal(preview.status, "no_executable_orders");
  assert.deepEqual(preview.order_plan.orders, []);
  assert.deepEqual(preview.order_plan.skipped_deltas.map(({ symbol, side, reason, desired_delta_notional }) => ({
    symbol,
    side,
    reason,
    desired_delta_notional,
  })), [
    { symbol: "BIL", side: "sell", reason: "below_one_dollar_minimum", desired_delta_notional: 0.8 },
    { symbol: "SPY", side: "buy", reason: "below_one_dollar_minimum", desired_delta_notional: 0.8 },
  ]);
  assert.equal(preview.funding.self_financing, true);
  assert.equal(preview.broker_cash_equity.cash_after_preview, 0);
});

test("strictly rejects malformed, ambiguous, and unsafe inputs", () => {
  const invalidInputs = [
    [baseInput({ cash: -1 }), /cash must be between/u],
    [baseInput({ prices: { SPY: 500, BIL: 0 } }), /prices\.BIL must be greater than zero/u],
    [baseInput({ holdings: { SPY: "1.1234567891", BIL: 0 } }), /at most 9 decimal places/u],
    [baseInput({ target_weights: { SPY: 0.4, BIL: 0.5 } }), /sum to exactly 1/u],
    [baseInput({ target_weights: { SPY: 0.5, BIL: 0.5, QQQ: 0 } }), /exactly SPY and BIL/u],
    [baseInput({ cost_model: { cost_bps: 1, transaction_cost_bps: 1 } }), /must not supply both/u],
    [baseInput({ asset_eligibility: { ...eligibleAssets(), QQQ: { tradable: true, fractionable: true } } }), /unsupported field QQQ/u],
    [baseInput({ theoretical_adjusted_total_return: { SPY: Number.NaN } }), /non-finite/u],
    [{ ...baseInput(), unexpected: true }, /unsupported field unexpected/u],
  ];

  for (const [input, expected] of invalidInputs) assert.throws(() => buildEquityShadowExecution(input), expected);
});

test("canonical output ignores object insertion order and module exposes no mutation or network path", async () => {
  const left = buildEquityShadowExecution(baseInput({
    theoretical_adjusted_total_return: { z: 1, a: { y: 2, x: 3 } },
  }));
  const right = buildEquityShadowExecution({
    theoretical_adjusted_total_return: { a: { x: 3, y: 2 }, z: 1 },
    asset_eligibility: {
      BIL: { fractionable: true, tradable: true },
      SPY: { fractionable: true, tradable: true },
    },
    target_weights: { BIL: 0.5, SPY: 0.5 },
    prices: { BIL: 100, SPY: 500 },
    cash: 100,
    holdings: { BIL: 0, SPY: 2 },
  });
  assert.equal(canonicalEquityShadowExecutionJson(left), canonicalEquityShadowExecutionJson(right));

  const source = await readFile(new URL("../lib/equity_shadow_execution.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/mu);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /client_order_id|submitOrder|placeOrder/u);
});
