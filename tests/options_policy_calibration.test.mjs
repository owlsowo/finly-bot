import assert from "node:assert/strict";
import test from "node:test";

import returnsFixture from "../fixtures/spy_ordinary_bullish_20231214.json" with { type: "json" };
import { sha256 } from "../lib/canonical.mjs";
import { compileIntent } from "../lib/compiler.mjs";
import { LIVE_ALPHA_CONFIDENCE_POLICY, POLICY } from "../lib/policy.mjs";
import { blackScholesPrice } from "../lib/quant.mjs";

const SPOT = 560;
const OBSERVED_AT = "2026-08-28T18:30:03.000Z";

function standardDeviation(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function momentumScore(returns) {
  const recent = returns.slice(-20);
  const sigma = Math.max(standardDeviation(recent), 0.001);
  const momentum5 = returns.slice(-5).reduce((sum, value) => sum + value, 0);
  const momentum20 = recent.reduce((sum, value) => sum + value, 0);
  return Math.tanh((0.65 * momentum5 / (sigma * Math.sqrt(5))
    + 0.35 * momentum20 / (sigma * Math.sqrt(20))) / 2);
}

function optionSymbol(type, strike) {
  return `SPY260911${type === "call" ? "C" : "P"}${String(strike * 1_000).padStart(8, "0")}`;
}

function ordinaryChain({ askImprovement = 0 } = {}) {
  const rows = [];
  for (let strike = 520; strike <= 600; strike += 5) {
    for (const type of ["call", "put"]) {
      const midpoint = blackScholesPrice({
        type,
        spot: SPOT,
        strike,
        timeYears: 14 / 365,
        volatility: 0.20,
        rate: POLICY.interestRate,
      });
      const bid = Math.max(0.01, Math.round((midpoint - 0.05) * 100) / 100);
      const ask = Math.max(bid + 0.01, Math.round((midpoint + 0.05 - askImprovement) * 100) / 100);
      rows.push({
        underlying: "SPY",
        symbol: optionSymbol(type, strike),
        type,
        expiry: "2026-09-11",
        strike,
        bid,
        ask,
        iv: 0.20,
        dte: 14,
        feed: "indicative",
        quote_age_seconds: 2,
        open_interest: 1_000,
        tradable: true,
      });
    }
  }
  return rows;
}

function historicalIntent() {
  const directionScore = momentumScore(returnsFixture.historical_log_returns);
  return {
    schema_version: "finly_intent.v1",
    underlying: "SPY",
    direction: directionScore > 0 ? "bullish" : "bearish",
    direction_score: directionScore,
    volatility_score: 0,
    coverage: 0.55,
    agreement: 0.65,
    active_weight: 0.55,
    horizon_sessions: 3,
    source_families: ["market", "options"],
    evidence_root: sha256(returnsFixture),
  };
}

function market() {
  return {
    spot: SPOT,
    observed_at: OBSERVED_AT,
    historical_log_returns: returnsFixture.historical_log_returns,
    interest_rate: POLICY.interestRate,
  };
}

test("ordinary historical momentum does not force a trade at a fair modeled surface", () => {
  const result = compileIntent(historicalIntent(), ordinaryChain(), market(), {
    maxLossBudget: 500,
    alphaPolicy: LIVE_ALPHA_CONFIDENCE_POLICY,
  });
  assert.equal(result.selected, null);
  assert.equal(result.action, "NO_TRADE");
});

test("prospective v3 alpha thresholds preserve strict EV while permitting asymmetric positive-EV payoffs", () => {
  assert.equal(LIVE_ALPHA_CONFIDENCE_POLICY.minimumProbabilityOfProfit, 0.45);
  assert.equal(LIVE_ALPHA_CONFIDENCE_POLICY.minimumRewardRisk, 1.25);
  assert.equal(LIVE_ALPHA_CONFIDENCE_POLICY.minimumEvDollars, 5);
  assert.equal(LIVE_ALPHA_CONFIDENCE_POLICY.minimumEvToMaxLoss, 0.02);
});

test("the same ordinary regime permits one modestly favorable, positive-margin spread", () => {
  // Four cents of ask improvement is smaller than the policy's modeled
  // two-leg round-trip slippage. It represents a plausible quote difference,
  // not an extreme trend or a zero-cost option fixture.
  const result = compileIntent(historicalIntent(), ordinaryChain({ askImprovement: 0.04 }), market(), {
    maxLossBudget: 500,
    alphaPolicy: LIVE_ALPHA_CONFIDENCE_POLICY,
  });
  assert.equal(result.selected?.action, "BULL_CALL_DEBIT_SPREAD");
  assert.ok(result.selected.max_loss <= 500);
  assert.ok(result.selected.probability_profit >= LIVE_ALPHA_CONFIDENCE_POLICY.minimumProbabilityOfProfit);
  assert.ok(result.selected.reward_risk >= 1.25);
  assert.ok(result.selected.conservative_ev >= Math.max(5, result.selected.max_loss * 0.02));
});

test("candidate selection searches for an affordable eligible spread before abstaining", () => {
  const result = compileIntent(historicalIntent(), ordinaryChain({ askImprovement: 0.04 }), market(), {
    maxLossBudget: 430,
    alphaPolicy: LIVE_ALPHA_CONFIDENCE_POLICY,
  });
  assert.ok(result.selected);
  assert.ok(result.selected.max_loss <= 430);
  assert.ok(result.rejected.some((row) => row.code === "RISK_BUDGET"));
});
