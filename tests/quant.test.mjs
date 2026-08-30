import assert from "node:assert/strict";
import test from "node:test";
import { verticalPayoff } from "../lib/compiler.mjs";
import { POLICY } from "../lib/policy.mjs";
import { scenarioPrices } from "../lib/quant.mjs";

function independentPayoff({ action, longStrike, shortStrike, debit, terminalPrice }) {
  const longIntrinsic = action === "BULL_CALL_DEBIT_SPREAD"
    ? Math.max(0, terminalPrice - longStrike)
    : Math.max(0, longStrike - terminalPrice);
  const shortIntrinsic = action === "BULL_CALL_DEBIT_SPREAD"
    ? Math.max(0, terminalPrice - shortStrike)
    : Math.max(0, shortStrike - terminalPrice);
  return Math.round((longIntrinsic - shortIntrinsic - debit) * 10000) / 100;
}

test("1,000 random verticals agree with an independent payoff oracle to one cent", () => {
  let state = 0xC0FFEE;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < 1000; index += 1) {
    const bullish = random() > 0.5;
    const lower = 50 + Math.floor(random() * 500);
    const width = 1 + Math.floor(random() * 15);
    const debit = Math.round((0.05 + random() * (width - 0.10)) * 100) / 100;
    const spread = bullish
      ? { action: "BULL_CALL_DEBIT_SPREAD", longStrike: lower, shortStrike: lower + width, debit }
      : { action: "BEAR_PUT_DEBIT_SPREAD", longStrike: lower + width, shortStrike: lower, debit };
    const testPrices = [0, lower - 1, lower, lower + width / 2, lower + width, lower + width + 100];
    for (const terminalPrice of testPrices) {
      assert.ok(Math.abs(verticalPayoff({ ...spread, terminalPrice }) - independentPayoff({ ...spread, terminalPrice })) <= 0.01);
    }
    const expectedMaxLoss = -debit * 100;
    const expectedMaxGain = (width - debit) * 100;
    const endpointPayoffs = [verticalPayoff({ ...spread, terminalPrice: 0 }), verticalPayoff({ ...spread, terminalPrice: lower + width + 1000 })];
    assert.ok(endpointPayoffs.some((value) => Math.abs(value - expectedMaxLoss) <= 0.01));
    assert.ok(endpointPayoffs.some((value) => Math.abs(value - expectedMaxGain) <= 0.01));
  }
});

test("both deterministic scenario models emit 2,048 finite but distinct paths", () => {
  const intent = { direction_score: -0.4, volatility_score: 0.2 };
  const history = Array.from({ length: 80 }, (_, index) => 0.007 * Math.sin(index * 1.37) - 0.0002);
  const common = { spot: 560, intent, iv: 0.22, horizonSessions: 5, historicalLogReturns: history, seed: "quant-test" };
  const implied = scenarioPrices({ ...common, model: "tilted_implied_distribution" });
  const bootstrap = scenarioPrices({ ...common, model: "vol_scaled_block_bootstrap" });
  assert.equal(implied.length, POLICY.scenarioPathCount);
  assert.equal(bootstrap.length, POLICY.scenarioPathCount);
  assert.ok(implied.every((value) => Number.isFinite(value) && value > 0));
  assert.ok(bootstrap.every((value) => Number.isFinite(value) && value > 0));
  assert.notDeepEqual(implied.slice(0, 20), bootstrap.slice(0, 20));
  assert.deepEqual(bootstrap, scenarioPrices({ ...common, model: "vol_scaled_block_bootstrap" }));
});

test("the block bootstrap fails closed without a sufficient return history", () => {
  assert.throws(() => scenarioPrices({
    spot: 560,
    intent: { direction_score: -0.4, volatility_score: 0.2 },
    iv: 0.22,
    horizonSessions: 5,
    historicalLogReturns: [0.01, -0.01],
    model: "vol_scaled_block_bootstrap",
  }), /requires at least 20/);
});
