import assert from "node:assert/strict";
import test from "node:test";

import {
  G4_SHADOW_LIVE_FIRST_SIGNAL_ELIGIBLE_AT,
  G4_SHADOW_LIVE_PROTOCOL_RAW_BYTES_SHA256,
  G4_SHADOW_LIVE_PROTOCOL_SHA256,
  hashG4ShadowLiveProtocol,
  loadG4ShadowLiveProtocol,
  validateG4ShadowLiveProtocol,
} from "../research/g4_shadow_live_protocol.mjs";

test("loads the byte-frozen G4 shadow protocol before the first signal", async () => {
  const protocol = await loadG4ShadowLiveProtocol();
  assert.equal(protocol.protocol_sha256, G4_SHADOW_LIVE_PROTOCOL_SHA256);
  assert.equal(hashG4ShadowLiveProtocol(protocol), G4_SHADOW_LIVE_PROTOCOL_SHA256);
  assert.match(G4_SHADOW_LIVE_PROTOCOL_RAW_BYTES_SHA256, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(protocol.registered_at < G4_SHADOW_LIVE_FIRST_SIGNAL_ELIGIBLE_AT);
  assert.equal(protocol.authority.broker_mutation_authorized, false);
  assert.equal(protocol.shadow_account.initial_cash_usd, 300);
  assert.equal(protocol.shadow_account.valuation_method, "SAME_VINTAGE_ADJUSTED_TOTAL_RETURN_EQUIVALENT_UNITS");
  assert.equal(Object.isFrozen(protocol), true);
  assert.equal(Object.isFrozen(protocol.publication), true);
  assert.equal(Object.isFrozen(protocol.publication.public_fields), true);
  for (const field of [
    "action", "signal_sha256", "signal", "execution_session_date", "execution_status",
    "executed_prior_signal_sha256", "next_signal_session_date", "publication_deadline",
  ]) {
    assert.ok(protocol.publication.public_fields.includes(field));
  }
});
test("protocol validation rejects hindsight, strategy, and authority drift", async () => {
  const protocol = await loadG4ShadowLiveProtocol();
  for (const mutate of [
    (value) => { value.registered_at = G4_SHADOW_LIVE_FIRST_SIGNAL_ELIGIBLE_AT; },
    (value) => { value.frozen_strategy.technology_core_weight = 0.6; },
    (value) => { value.signal_chronology.execution_time = "SAME_CLOSE"; },
    (value) => { value.authority.broker_mutation_authorized = true; },
  ]) {
    const changed = structuredClone(protocol);
    mutate(changed);
    assert.throws(() => validateG4ShadowLiveProtocol(changed));
  }
});
