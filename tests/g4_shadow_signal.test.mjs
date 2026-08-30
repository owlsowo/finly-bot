import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  G4_SHADOW_SYMBOLS,
  buildG4ShadowSignal,
  validateG4ShadowSignal,
} from "../research/g4_shadow_signal.mjs";

const SECTORS = ["XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU"];

function sessionDates(count = 253) {
  const dates = [];
  const cursor = new Date("2025-09-10T12:00:00.000Z");
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function panel() {
  const dates = sessionDates();
  return Object.fromEntries(G4_SHADOW_SYMBOLS.map((symbol, symbolIndex) => {
    const sectorRank = SECTORS.indexOf(symbol);
    const dailyGrowth = sectorRank >= 0 ? 0.0002 + sectorRank * 0.0001 : 0.0003;
    return [symbol, dates.map((sessionDate, index) => ({
      session_date: sessionDate,
      bar_timestamp: `${sessionDate}T20:00:00.000Z`,
      close: 100 * Math.exp(dailyGrowth * index + 0.00001 * symbolIndex),
    }))];
  }));
}

test("builds the exact frozen G4 close-time signal without broker authority", () => {
  const signal = buildG4ShadowSignal({ adjustedCloseRows: panel(), sessionNumber: 0 });
  assert.equal(signal.strategy_id, "qqq_core_sector_12_6");
  assert.equal(signal.action, "REBALANCE");
  assert.deepEqual(signal.selected_sectors, ["XLB", "XLU", "XLV"]);
  assert.equal(signal.target_weights.QQQ, 0.5);
  assert.equal(signal.target_weights.XLB, 1 / 6);
  assert.equal(signal.target_weights.XLV, 1 / 6);
  assert.equal(signal.target_weights.XLU, 1 / 6);
  assert.ok(Math.abs(Object.values(signal.target_weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.equal(Object.keys(signal.target_weights).length, G4_SHADOW_SYMBOLS.length);
  assert.equal(signal.authority.shadow_only, true);
  assert.equal(signal.authority.broker_mutation_authorized, false);
  assert.equal(signal.authority.order_payload, null);
  assert.match(signal.signal_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(signal), true);
});

test("HOLD preserves the prior target and the 21-session cadence", () => {
  const first = buildG4ShadowSignal({ adjustedCloseRows: panel(), sessionNumber: 0 });
  const held = buildG4ShadowSignal({
    adjustedCloseRows: panel(),
    sessionNumber: 1,
    previousTargetWeights: first.target_weights,
  });
  const next = buildG4ShadowSignal({
    adjustedCloseRows: panel(),
    sessionNumber: 21,
    previousTargetWeights: first.target_weights,
  });
  assert.equal(held.action, "HOLD");
  assert.deepEqual(held.target_weights, first.target_weights);
  assert.equal(next.action, "REBALANCE");
});

test("source hash binds normalized economic inputs rather than JSON number representation", () => {
  const numeric = panel();
  const strings = structuredClone(numeric);
  for (const symbol of G4_SHADOW_SYMBOLS) {
    for (const row of strings[symbol]) row.close = String(row.close);
  }
  const numericSignal = buildG4ShadowSignal({ adjustedCloseRows: numeric, sessionNumber: 0 });
  const stringSignal = buildG4ShadowSignal({ adjustedCloseRows: strings, sessionNumber: 0 });
  assert.equal(numericSignal.source_panel_sha256, stringSignal.source_panel_sha256);
  assert.deepEqual(numericSignal.target_weights, stringSignal.target_weights);
});

test("rejects hindsight-prone or malformed panels and target state", () => {
  const base = panel();
  const missing = structuredClone(base);
  delete missing.SPY;
  assert.throws(() => buildG4ShadowSignal({ adjustedCloseRows: missing, sessionNumber: 0 }), /exactly/u);

  const short = structuredClone(base);
  short.QQQ.pop();
  assert.throws(() => buildG4ShadowSignal({ adjustedCloseRows: short, sessionNumber: 0 }), /253 sessions/u);

  const misaligned = structuredClone(base);
  misaligned.XLK[100].session_date = "2026-01-01";
  assert.throws(() => buildG4ShadowSignal({ adjustedCloseRows: misaligned, sessionNumber: 0 }), /do not align|strictly increasing/u);

  assert.throws(() => buildG4ShadowSignal({ adjustedCloseRows: base, sessionNumber: 1 }), /requires previousTargetWeights/u);
  assert.throws(() => buildG4ShadowSignal({ adjustedCloseRows: base, sessionNumber: -1 }), /non-negative safe integer/u);
});

test("validation catches tampering with the frozen cadence, weights, and hash", () => {
  const signal = buildG4ShadowSignal({ adjustedCloseRows: panel(), sessionNumber: 0 });

  const wrongAction = structuredClone(signal);
  wrongAction.action = "HOLD";
  assert.throws(() => validateG4ShadowSignal(wrongAction), /frozen cadence/u);

  const wrongWeight = structuredClone(signal);
  wrongWeight.target_weights.QQQ = 0.6;
  assert.throws(() => validateG4ShadowSignal(wrongWeight), /sum to/u);

  const forgedAllocation = structuredClone(signal);
  forgedAllocation.target_weights.QQQ = 0.7;
  for (const sector of forgedAllocation.selected_sectors) forgedAllocation.target_weights[sector] = 0.1;
  const forgedAllocationBody = structuredClone(forgedAllocation);
  delete forgedAllocationBody.signal_sha256;
  forgedAllocation.signal_sha256 = sha256(forgedAllocationBody);
  assert.throws(() => validateG4ShadowSignal(forgedAllocation), /frozen 50% QQQ/u);

  const forgedSelection = structuredClone(signal);
  forgedSelection.selected_sectors = ["XLE", "XLF", "XLK"];
  assert.throws(() => validateG4ShadowSignal(forgedSelection), /selected sectors/u);

  const wrongHash = structuredClone(signal);
  wrongHash.signal_sha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateG4ShadowSignal(wrongHash), /hash is invalid/u);
});
