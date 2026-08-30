import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CORE_SYMBOLS as CHAMPION_CORE_SYMBOLS } from "../research/champion_strategies.mjs";
import {
  CORE_SYMBOLS,
  buildMultiAssetShadowExecution,
  canonicalMultiAssetShadowExecutionJson,
} from "../lib/multi_asset_shadow_execution.mjs";

function symbolMap(value) {
  return Object.fromEntries(CORE_SYMBOLS.map((symbol) => [
    symbol,
    typeof value === "function" ? value(symbol) : value,
  ]));
}

function eligibleAssets() {
  return symbolMap(() => ({ tradable: true, fractionable: true }));
}

function baseInput(overrides = {}) {
  return {
    holdings: symbolMap((symbol) => symbol === "SPY" ? "2.000000000" : "0"),
    cash: "100",
    prices: symbolMap((symbol) => ({ SPY: "500", QQQ: "300" }[symbol] ?? "100")),
    target_weights: symbolMap((symbol) => ({ SPY: 0.5, BIL: 0.2, QQQ: 0.3 }[symbol] ?? 0)),
    asset_eligibility: eligibleAssets(),
    ...overrides,
  };
}

test("uses the exact frozen 20-symbol strategy universe", () => {
  assert.equal(CORE_SYMBOLS.length, 20);
  assert.deepEqual(CORE_SYMBOLS, CHAMPION_CORE_SYMBOLS);
  assert.equal(new Set(CORE_SYMBOLS).size, 20);
});

test("builds a deterministic long-only fractional preview with every sell before every buy", () => {
  const preview = buildMultiAssetShadowExecution(baseInput());

  assert.equal(preview.preview_only, true);
  assert.equal(preview.broker_mutation_authorized, false);
  assert.equal(preview.status, "ready");
  assert.deepEqual(
    preview.order_plan.orders.map(({ sequence, symbol, side, qty }) => ({ sequence, symbol, side, qty })),
    [
      { sequence: 1, symbol: "SPY", side: "sell", qty: "0.900000000" },
      { sequence: 2, symbol: "BIL", side: "buy", qty: "2.200000000" },
      { sequence: 3, symbol: "QQQ", side: "buy", qty: "1.100000000" },
    ],
  );
  assert.equal(preview.order_plan.orders.every((order) => /^\d+\.\d{9}$/u.test(order.qty)), true);
  assert.equal(preview.order_plan.orders.every((order) => order.reference_notional >= 1), true);
  assert.equal(preview.funding.net_sell_proceeds, 450);
  assert.equal(preview.funding.buy_budget_after_sells, 550);
  assert.equal(preview.funding.total_buy_cash_required, 550);
  assert.equal(preview.funding.self_financing, true);
  assert.equal(preview.portfolio.equity_before, 1100);
  assert.equal(preview.portfolio.equity_after_preview, 1100);
  assert.equal(preview.portfolio.residual_cash, 0);
  assert.equal(preview.portfolio.holdings_after_preview.SPY, "1.100000000");
  assert.equal(preview.portfolio.holdings_after_preview.BIL, "2.200000000");
  assert.equal(preview.portfolio.holdings_after_preview.QQQ, "1.100000000");
  assert.equal(
    CORE_SYMBOLS.every((symbol) => Number(preview.portfolio.holdings_after_preview[symbol]) >= 0),
    true,
  );
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.isFrozen(preview.order_plan.orders), true);
});

test("accepts the strategy's native binary-float sector weights without weakening sum validation", () => {
  const preview = buildMultiAssetShadowExecution(baseInput({
    target_weights: symbolMap((symbol) => ({
      QQQ: 0.5,
      XLB: 1 / 6,
      XLV: 1 / 6,
      XLU: 1 / 6,
    }[symbol] ?? 0)),
  }));

  assert.equal(preview.allocation.target_weights.QQQ, 0.5);
  assert.equal(preview.allocation.target_weights.XLB, 0.166666666667);
  assert.equal(preview.funding.self_financing, true);
});

test("models adverse slippage and costs while preserving a self-financing buy budget", () => {
  const preview = buildMultiAssetShadowExecution(baseInput({
    cost_model: {
      slippage_bps: 10,
      transaction_cost_bps: 5,
      regulatory_sell_fee_bps: 2,
    },
  }));
  const orders = preview.order_plan.orders;
  const firstBuyIndex = orders.findIndex((order) => order.side === "buy");
  const lastSellIndex = orders.findLastIndex((order) => order.side === "sell");

  assert.equal(lastSellIndex < firstBuyIndex, true);
  assert.equal(orders[0].modeled_execution_price, 499.5);
  assert.equal(orders[0].modeled_transaction_cost, 0.224775);
  assert.equal(orders[0].modeled_regulatory_sell_fee, 0.08991);
  assert.equal(preview.funding.net_sell_proceeds, 449.235315);
  assert.equal(preview.funding.total_buy_cash_required <= preview.funding.buy_budget_after_sells, true);
  assert.equal(preview.funding.residual_cash >= 0, true);
  assert.equal(preview.funding.self_financing, true);
  assert.equal(preview.portfolio.equity_after_preview < preview.portfolio.equity_before, true);
  assert.equal(orders.filter((order) => order.side === "buy").every(
    (order) => order.modeled_execution_price > order.reference_price,
  ), true);
  assert.equal(preview.order_plan.skipped_deltas.some(
    (item) => item.reason === "self_financing_buy_budget_limit",
  ), true);
});

test("fails closed when required fractional eligibility is absent or account equity does not reconcile", () => {
  const missingEligibility = buildMultiAssetShadowExecution(baseInput({ asset_eligibility: undefined }));
  assert.equal(missingEligibility.status, "blocked_asset_eligibility");
  assert.deepEqual(missingEligibility.order_plan.orders, []);
  assert.equal(missingEligibility.asset_eligibility.SPY.eligible_for_fractional_order, false);
  assert.equal(missingEligibility.asset_eligibility.QQQ.flags_present, false);
  assert.equal(missingEligibility.order_plan.skipped_deltas.every(
    (item) => item.reason === "asset_not_tradable_or_fractionable",
  ), true);

  const mismatch = buildMultiAssetShadowExecution(baseInput({ reported_equity: 1100.02 }));
  assert.equal(mismatch.status, "blocked_equity_reconciliation");
  assert.equal(mismatch.portfolio.reconciliation.status, "mismatch");
  assert.equal(mismatch.portfolio.reconciliation.reported_minus_calculated, 0.02);
  assert.deepEqual(mismatch.order_plan.orders, []);
  assert.equal(mismatch.order_plan.skipped_deltas.every(
    (item) => item.reason === "account_equity_reconciliation_mismatch",
  ), true);
});

test("skips sub-dollar deltas rather than rounding them into executable orders", () => {
  const preview = buildMultiAssetShadowExecution({
    holdings: symbolMap((symbol) => ["SPY", "BIL"].includes(symbol) ? 1 : 0),
    cash: 0,
    prices: symbolMap(() => 100),
    target_weights: symbolMap((symbol) => ({ SPY: 0.504, BIL: 0.496 }[symbol] ?? 0)),
    asset_eligibility: eligibleAssets(),
  });

  assert.equal(preview.status, "no_executable_orders");
  assert.deepEqual(preview.order_plan.orders, []);
  assert.deepEqual(
    preview.order_plan.skipped_deltas.map(
      ({ symbol, side, reason, desired_delta_notional }) => ({
        symbol,
        side,
        reason,
        desired_delta_notional,
      }),
    ),
    [
      { symbol: "BIL", side: "sell", reason: "below_one_dollar_minimum", desired_delta_notional: 0.8 },
      { symbol: "SPY", side: "buy", reason: "below_one_dollar_minimum", desired_delta_notional: 0.8 },
    ],
  );
  assert.equal(preview.funding.self_financing, true);
  assert.equal(preview.portfolio.residual_cash, 0);
});

test("strictly rejects malformed, non-long-only, ambiguous, and non-allowlisted inputs", () => {
  const withoutXlu = Object.fromEntries(
    Object.entries(baseInput().target_weights).filter(([symbol]) => symbol !== "XLU"),
  );
  const invalidInputs = [
    [baseInput({ cash: -1 }), /cash must be between/u],
    [baseInput({ holdings: { ...baseInput().holdings, SPY: -1 } }), /holdings\.SPY must be between/u],
    [baseInput({ holdings: { ...baseInput().holdings, SPY: "1.1234567891" } }), /at most 9 decimal places/u],
    [baseInput({ prices: { ...baseInput().prices, XLU: 0 } }), /prices\.XLU must be greater than zero/u],
    [baseInput({ target_weights: symbolMap((symbol) => symbol === "SPY" ? 0.9 : 0) }), /sum to exactly 1/u],
    [baseInput({ target_weights: withoutXlu }), /exactly the 20 allowlisted/u],
    [baseInput({ target_weights: { ...baseInput().target_weights, AAPL: 0 } }), /exactly the 20 allowlisted/u],
    [baseInput({ cost_model: { cost_bps: 1, transaction_cost_bps: 1 } }), /must not supply both/u],
    [baseInput({ cost_model: { transaction_cost_bps: 6000, regulatory_sell_fee_bps: 5000 } }), /combined sell-side/u],
    [baseInput({ asset_eligibility: { ...eligibleAssets(), AAPL: { tradable: true, fractionable: true } } }), /unsupported field AAPL/u],
    [{ ...baseInput(), unexpected: true }, /unsupported field unexpected/u],
  ];

  for (const [input, expected] of invalidInputs) {
    assert.throws(() => buildMultiAssetShadowExecution(input), expected);
  }
});

test("canonical JSON ignores insertion order and the engine exposes no transport or broker-order path", async () => {
  const left = buildMultiAssetShadowExecution(baseInput());
  const reverse = (object) => Object.fromEntries(Object.entries(object).reverse());
  const sourceInput = baseInput();
  const right = buildMultiAssetShadowExecution({
    asset_eligibility: reverse(sourceInput.asset_eligibility),
    target_weights: reverse(sourceInput.target_weights),
    prices: reverse(sourceInput.prices),
    cash: sourceInput.cash,
    holdings: reverse(sourceInput.holdings),
  });

  assert.equal(
    canonicalMultiAssetShadowExecutionJson(left),
    canonicalMultiAssetShadowExecutionJson(right),
  );
  assert.throws(
    () => canonicalMultiAssetShadowExecutionJson({ schema_version: "multi_asset_shadow_execution.v1" }),
    /non-authorizing/u,
  );

  const source = await readFile(
    new URL("../lib/multi_asset_shadow_execution.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /^\s*import\s/mu);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /client_order_id|submitOrder|placeOrder|broker_payload/u);
});
