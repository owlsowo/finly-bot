import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256 } from "../lib/canonical.mjs";
import { aggregateSignals } from "../lib/signals.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));

function reidentify(record) {
  const body = { ...record };
  delete body.evidence_id;
  return { ...body, evidence_id: sha256(body) };
}

test("evidence records are canonical, causal, and available at decision time", () => {
  const future = structuredClone(fixture.signals);
  const record = future[0].evidence[0];
  future[0].evidence[0] = reidentify({ ...record, available_at: "2026-08-28T18:31:00.000Z" });
  future[0].evidence_ids = [future[0].evidence[0].evidence_id];
  assert.throws(() => aggregateSignals(future, { asOf: fixture.decision_time }), /not available at decision time/);

  const tampered = structuredClone(fixture.signals);
  tampered[0].evidence[0].content_sha256 = sha256("changed without reidentifying the record");
  assert.throws(() => aggregateSignals(tampered), /evidence ID does not match/);
});

test("cross-family duplicates and shared origins cannot manufacture independence", () => {
  const duplicateGroup = structuredClone(fixture.signals);
  const marketGroup = duplicateGroup[0].evidence[0].duplicate_group;
  duplicateGroup[1].evidence[0] = reidentify({ ...duplicateGroup[1].evidence[0], duplicate_group: marketGroup });
  duplicateGroup[1].evidence_ids = [duplicateGroup[1].evidence[0].evidence_id];
  assert.throws(() => aggregateSignals(duplicateGroup), /cross-family duplicate group overlap/);

  const sharedOrigin = structuredClone(fixture.signals);
  const marketOrigin = sharedOrigin[0].evidence[0].origin_id;
  sharedOrigin[1].evidence[0] = reidentify({ ...sharedOrigin[1].evidence[0], origin_id: marketOrigin });
  sharedOrigin[1].evidence_ids = [sharedOrigin[1].evidence[0].evidence_id];
  assert.throws(() => aggregateSignals(sharedOrigin), /cross-family origin overlap/);
});

test("source and intent boundaries reject unknown properties and duplicate family weight", () => {
  const injected = structuredClone(fixture.signals);
  injected[0].limit_price = 999;
  assert.throws(() => aggregateSignals(injected), /missing or unknown fields/);
  assert.throws(() => aggregateSignals([...fixture.signals, structuredClone(fixture.signals[0])]), /double count evidence/);
});
