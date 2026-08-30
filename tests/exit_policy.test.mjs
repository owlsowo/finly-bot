import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { evaluateDebitSpreadExit } from "../lib/exit_policy.mjs";
import { runDecision } from "../lib/pipeline.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const signingSecret = "exit-policy-paper-certificate-secret-0123456789";
const receipt = await runDecision({
  fixture: { ...fixture, data_mode: "alpaca_paper_live" },
  planner: new DeterministicReplayPlanner(),
  signingSecret,
  certificateScope: "paper_submit",
});
const entryProjection = structuredClone(receipt.alpaca_payload);
delete entryProjection.payload_sha256;

function quotes({ longBid = 5.2, longAsk = 5.25, shortBid = 1.7, shortAsk = 1.75, at = fixture.decision_time } = {}) {
  return {
    [entryProjection.legs[0].symbol]: { bp: longBid, ap: longAsk, t: at },
    [entryProjection.legs[1].symbol]: { bp: shortBid, ap: shortAsk, t: at },
  };
}

test("exit policy holds a fresh spread inside deterministic profit, loss, time, and expiry gates", () => {
  const assessment = evaluateDebitSpreadExit({
    certificate: receipt.certificate,
    entryProjection,
    quotes: quotes(),
    observedAt: fixture.decision_time,
    strategyDirection: "bearish",
  });
  assert.equal(assessment.decision, "HOLD");
  assert.equal(assessment.trigger, null);
  assert.equal(assessment.credit_limit, null);
  assert.equal(assessment.entry_direction, "bearish");
});

test("exit policy emits a fill-oriented negative-credit magnitude boundary for risk and profit exits", () => {
  const loss = evaluateDebitSpreadExit({
    certificate: receipt.certificate,
    entryProjection,
    quotes: quotes({ longBid: 1.1, longAsk: 1.15, shortBid: 0.9, shortAsk: 0.95 }),
    observedAt: fixture.decision_time,
  });
  assert.equal(loss.trigger, "risk_limit");
  assert.equal(loss.credit_limit, "0.09");

  const profit = evaluateDebitSpreadExit({
    certificate: receipt.certificate,
    entryProjection,
    quotes: quotes({ longBid: 8.3, longAsk: 8.35, shortBid: 0.7, shortAsk: 0.75 }),
    observedAt: fixture.decision_time,
  });
  assert.equal(profit.trigger, "profit_target");
  assert.equal(profit.credit_limit, "7.49");
  assert.ok(profit.estimated_unrealized_pnl > 0);
});

test("exit policy applies horizon, expiry, invalidation, and quote-freshness gates", () => {
  const horizonCertificate = { ...receipt.certificate, horizon_sessions: 1 };
  const nextSession = "2026-08-31T18:30:05.000Z";
  const timeStop = evaluateDebitSpreadExit({
    certificate: horizonCertificate,
    entryProjection,
    quotes: quotes({ at: nextSession }),
    observedAt: nextSession,
  });
  assert.equal(timeStop.trigger, "time_stop");

  const invalidated = evaluateDebitSpreadExit({
    certificate: receipt.certificate,
    entryProjection,
    quotes: quotes(),
    observedAt: fixture.decision_time,
    strategyDirection: "bullish",
  });
  assert.equal(invalidated.trigger, "strategy_invalidation");

  const neutralized = evaluateDebitSpreadExit({
    certificate: receipt.certificate,
    entryProjection,
    quotes: quotes(),
    observedAt: fixture.decision_time,
    strategyDirection: "neutral",
  });
  assert.equal(neutralized.trigger, "strategy_invalidation");

  assert.throws(
    () => evaluateDebitSpreadExit({
      certificate: receipt.certificate,
      entryProjection,
      quotes: quotes({ at: "2026-08-28T18:20:00.000Z" }),
      observedAt: fixture.decision_time,
    }),
    /stale/,
  );
});

test("time stop uses broker-observed entry fill time when it is available", () => {
  const observedAt = "2026-09-01T18:30:05.000Z";
  const horizonCertificate = { ...receipt.certificate, horizon_sessions: 2 };
  const fallback = evaluateDebitSpreadExit({
    certificate: horizonCertificate,
    entryProjection,
    quotes: quotes({ at: observedAt }),
    observedAt,
  });
  assert.equal(fallback.trigger, "time_stop");
  assert.equal(fallback.holding_period_anchor_source, "certificate_created_at_fallback");

  const fillAnchored = evaluateDebitSpreadExit({
    certificate: horizonCertificate,
    entryProjection,
    quotes: quotes({ at: observedAt }),
    observedAt,
    entryFilledAt: "2026-08-31T15:00:00.000Z",
  });
  assert.equal(fillAnchored.decision, "HOLD");
  assert.equal(fillAnchored.sessions_elapsed, 1);
  assert.equal(fillAnchored.holding_period_anchor_at, "2026-08-31T15:00:00.000Z");
  assert.equal(fillAnchored.holding_period_anchor_source, "broker_entry_filled_at");
});
