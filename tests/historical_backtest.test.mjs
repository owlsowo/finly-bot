import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateHistoricalDecision,
  validateHistoricalDecision,
} from "../lib/historical_backtest.mjs";

const fixtureUrl = new URL("../fixtures/spy_bearish_replay.json", import.meta.url);

async function fixture() {
  const value = JSON.parse(await readFile(fileURLToPath(fixtureUrl), "utf8"));
  value.market.history_mode = "alpaca_historical_point_in_time";
  return value;
}

test("historical evaluation reuses the checked compiler but never authorizes mutation", async () => {
  const input = await fixture();
  const record = evaluateHistoricalDecision({
    decisionTime: input.decision_time,
    market: input.market,
    optionChain: input.option_chain,
    signals: input.signals,
    horizonSessions: input.horizon_sessions,
    equity: input.account.equity,
  });
  validateHistoricalDecision(record);
  assert.equal(record.status, "ELIGIBLE");
  assert.equal(record.mutation_authorized, false);
  assert.equal(record.candidate.action, "BEAR_PUT_DEBIT_SPREAD");
  assert.equal(record.shadow_candidate.action, "BEAR_PUT_DEBIT_SPREAD");
  assert.ok(Math.abs(record.shadow_candidate.width - 5) <= Math.abs(record.candidate.width - 5));
  assert.ok(record.quantity > 0);
  assert.equal(record.sizing_reference_equity, input.account.equity);
  assert.ok([0.0025, 0.005].includes(record.sizing_risk_fraction));
  assert.ok(record.reserved_max_loss <= 500);
});

test("historical evaluation fails closed when no option chain exists", async () => {
  const input = await fixture();
  const record = evaluateHistoricalDecision({
    decisionTime: input.decision_time,
    market: input.market,
    optionChain: [],
    signals: input.signals,
  });
  assert.equal(record.status, "INPUT_REJECTED");
  assert.deepEqual(record.reasons, ["NO_POINT_IN_TIME_OPTION_CHAIN"]);
  assert.equal(record.shadow_candidate, null);
  assert.equal(record.quantity, 0);
  assert.equal(record.sizing_risk_fraction, null);
});

test("historical signal shadow remains measurable when confidence authorization fails", async () => {
  const input = await fixture();
  input.signals = input.signals.map((signal) => ({ ...signal, quality: 0.1 }));
  const record = evaluateHistoricalDecision({
    decisionTime: input.decision_time,
    market: input.market,
    optionChain: input.option_chain,
    signals: input.signals,
    horizonSessions: input.horizon_sessions,
    equity: input.account.equity,
  });
  assert.equal(record.status, "NO_CANDIDATE");
  assert.equal(record.candidate, null);
  assert.equal(record.shadow_candidate.action, "BEAR_PUT_DEBIT_SPREAD");
  assert.ok(record.shadow_waived_gates.includes("MINIMUM_COVERAGE"));
  assert.equal(record.mutation_authorized, false);
});

test("historical evaluation rejects observations from the future", async () => {
  const input = await fixture();
  input.market.observed_at = "2026-08-28T20:00:00.000Z";
  assert.throws(() => evaluateHistoricalDecision({
    decisionTime: "2026-08-28T19:59:59.000Z",
    market: input.market,
    optionChain: input.option_chain,
    signals: input.signals,
  }), /later than the decision/);
});

test("historical evaluation refuses synthetic history labels", async () => {
  const input = await fixture();
  input.market.history_mode = "synthetic_fixture";
  assert.throws(() => evaluateHistoricalDecision({
    decisionTime: input.decision_time,
    market: input.market,
    optionChain: input.option_chain,
    signals: input.signals,
  }), /refuses synthetic or unlabeled/);
});
