import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { reconcileBrokerPositions } from "../lib/broker_positions.mjs";
import { runDecision } from "../lib/pipeline.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const receipt = await runDecision({
  fixture: { ...fixture, data_mode: "alpaca_paper_live" },
  planner: new DeterministicReplayPlanner(),
  signingSecret: "broker-position-reconciliation-secret-0123456789",
  certificateScope: "paper_submit",
});
const entryProjection = structuredClone(receipt.alpaca_payload);
delete entryProjection.payload_sha256;

function exactSpread() {
  return entryProjection.legs.map((leg) => ({
    symbol: leg.symbol,
    asset_class: "us_option",
    side: leg.side === "buy" ? "long" : "short",
    qty: entryProjection.qty,
  }));
}

test("broker positions must be exactly flat before entry and after terminal close", () => {
  for (const lifecyclePhase of ["CREATED", "ENTRY_ACCEPTED", "CLOSED"]) {
    const result = reconcileBrokerPositions({ positions: [], entryProjection, lifecyclePhase });
    assert.equal(result.expected_state, "flat");
    assert.equal(result.matched, true);
  }
  assert.throws(
    () => reconcileBrokerPositions({ positions: exactSpread(), entryProjection, lifecyclePhase: "CLOSED" }),
    /disagree with a flat lifecycle state/,
  );
});

test("open lifecycle phases require exactly the certified two-leg broker spread", () => {
  for (const lifecyclePhase of ["POSITION_OPEN", "EXIT_REQUIRED", "EXIT_ACCEPTED"]) {
    const result = reconcileBrokerPositions({ positions: exactSpread().reverse(), entryProjection, lifecyclePhase });
    assert.equal(result.expected_state, "certified_spread");
    assert.equal(result.position_count, 2);
  }

  assert.throws(
    () => reconcileBrokerPositions({ positions: [], entryProjection, lifecyclePhase: "POSITION_OPEN" }),
    /absent from the broker account/,
  );
  assert.throws(
    () => reconcileBrokerPositions({ positions: exactSpread().slice(0, 1), entryProjection, lifecyclePhase: "POSITION_OPEN" }),
    /exactly the certified spread/,
  );
  assert.throws(
    () => reconcileBrokerPositions({
      positions: exactSpread().map((position, index) => index === 0 ? { ...position, side: "short" } : position),
      entryProjection,
      lifecyclePhase: "POSITION_OPEN",
    }),
    /differ from the certified spread/,
  );
  assert.throws(
    () => reconcileBrokerPositions({
      positions: [...exactSpread(), { symbol: "SPY", asset_class: "us_equity", side: "long", qty: "1" }],
      entryProjection,
      lifecyclePhase: "POSITION_OPEN",
    }),
    /unsupported holding|non-option holding/,
  );
});

test("ambiguous quantities, duplicate symbols, and unsupported phases fail closed", () => {
  assert.throws(
    () => reconcileBrokerPositions({
      positions: exactSpread().map((position, index) => index === 0 ? { ...position, qty: "1.5" } : position),
      entryProjection,
      lifecyclePhase: "POSITION_OPEN",
    }),
    /quantity is ambiguous/,
  );
  assert.throws(
    () => reconcileBrokerPositions({ positions: [exactSpread()[0], exactSpread()[0]], entryProjection, lifecyclePhase: "POSITION_OPEN" }),
    /duplicate or ambiguous/,
  );
  assert.throws(
    () => reconcileBrokerPositions({ positions: exactSpread(), entryProjection, lifecyclePhase: "ERROR_FROZEN" }),
    /unsupported/,
  );
});
