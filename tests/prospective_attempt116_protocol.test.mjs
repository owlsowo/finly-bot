import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import attempt116ProtocolJson from "../research/prospective_attempt116/protocol.json" with { type: "json" };
import {
  ATTEMPT116_FIRST_ELIGIBLE_INPUT_AT,
  ATTEMPT116_ID,
  ATTEMPT116_PROTOCOL_RAW_BYTES_SHA256,
  ATTEMPT116_PROTOCOL_SHA256,
  canonicalProspectiveAttempt116ProtocolJson,
  hashProspectiveAttempt116Protocol,
  loadProspectiveAttempt116Protocol,
  prospectiveAttempt116ProtocolBody,
  validateProspectiveAttempt116Protocol,
  verifyProspectiveAttempt116ProtocolBytes,
} from "../research/prospective_attempt116/protocol.mjs";

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rehash(protocol) {
  protocol.protocol_sha256 = sha256(prospectiveAttempt116ProtocolBody(protocol));
  return protocol;
}

test("Attempt 116 protocol is canonical, self-hashed, and future-only", async () => {
  const bytes = await readFile("research/prospective_attempt116/protocol.json");
  const protocol = await loadProspectiveAttempt116Protocol();
  assert.equal(bytes.toString("utf8"), canonicalProspectiveAttempt116ProtocolJson(protocol));
  assert.equal(rawDigest(bytes), ATTEMPT116_PROTOCOL_RAW_BYTES_SHA256);
  assert.equal(hashProspectiveAttempt116Protocol(protocol), ATTEMPT116_PROTOCOL_SHA256);
  assert.equal(protocol.protocol_sha256, ATTEMPT116_PROTOCOL_SHA256);
  assert.equal(protocol.attempt_id, ATTEMPT116_ID);
  assert.equal(protocol.attempt_number, 116);
  assert.equal(protocol.trial_accounting.registered_attempt_count_after_publication, 116);
  assert.equal(protocol.first_eligible_input.not_before, ATTEMPT116_FIRST_ELIGIBLE_INPUT_AT);
  assert.ok(protocol.draft_frozen_at < protocol.publication_boundary.publication_deadline);
  assert.equal(protocol.first_eligible_input.existing_historical_bundle_eligible_for_scoring, false);
  assert.equal(protocol.first_eligible_input.retrospective_runner_permitted, false);
  assert.equal(protocol.publication_boundary.separate_per_signal_anchor_required, false);
});

test("Attempt 116 binds the exact MIT source and preserves its license notice", async () => {
  const [licenseBytes, attribution] = await Promise.all([
    readFile("research/prospective_attempt116/UPSTREAM_LICENSE.txt"),
    readFile("research/prospective_attempt116/SOURCE_ATTRIBUTION.md", "utf8"),
  ]);
  assert.equal(
    rawDigest(licenseBytes),
    "sha256:97ed157640064056357c7edceb8aeed5db11577dbdd381bdb556759d80ef9935",
  );
  assert.equal(
    attempt116ProtocolJson.source_basis.pinned_source_raw_bytes_sha256[
      "src/vrp_engine/strategy/signals.py"
    ],
    "sha256:85047bb266ac75d18c055a90568a3c8de811583405e26c076b90b81581f97d99",
  );
  assert.equal(
    attempt116ProtocolJson.source_basis.commit,
    "84d6bff500b53a27cb2743a870b9533fc7d5c098",
  );
  assert.match(attribution, /strict raw floating-point comparison greater than `0\.08`/u);
  assert.match(attribution, /missing front or next ATM IV stands down/iu);
  assert.match(attribution, /does not implement fractional Kelly/iu);
});

test("every Attempt 116 authority flag and initial evaluation gate is false", () => {
  const protocol = validateProspectiveAttempt116Protocol(attempt116ProtocolJson);
  assert.ok(Object.keys(protocol.authority).length > 0);
  assert.ok(Object.values(protocol.authority).every((value) => value === false));
  assert.ok(Object.values(protocol.evaluation_gates).every((value) => value === false));
  assert.ok(Object.values(protocol.excluded_surfaces).every((value) => value === true));
  assert.equal(protocol.authority.real_data_runner_enabled, false);
  assert.equal(protocol.authority.broker_mutation_authorized, false);
  assert.equal(protocol.authority.retrospective_evaluation_authorized, false);
});

test("protocol validator rejects re-hashed semantic weakening and unknown fields", () => {
  for (const mutate of [
    (value) => { value.authority.broker_reads_permitted = true; },
    (value) => { value.signal_specification.relative_gap.sell_vol_shadow_minimum_inclusive = 0.14; },
    (value) => { value.signal_specification.term_slope_blackout.comparison = "greater_than_or_equal"; },
    (value) => { value.source_basis.commit = "0".repeat(40); },
    (value) => { value.first_eligible_input.retrospective_runner_permitted = true; },
  ]) {
    const changed = structuredClone(attempt116ProtocolJson);
    mutate(changed);
    rehash(changed);
    assert.throws(
      () => validateProspectiveAttempt116Protocol(changed),
      /protocol self-hash changed/iu,
    );
  }

  const extra = structuredClone(attempt116ProtocolJson);
  extra.unregistered_extension = true;
  assert.throws(
    () => validateProspectiveAttempt116Protocol(extra),
    /must contain exactly/iu,
  );
});

test("protocol byte verifier is explicit that public registration is not yet verified", async () => {
  const receipt = await verifyProspectiveAttempt116ProtocolBytes();
  assert.equal(receipt.canonical_bytes_verified, true);
  assert.equal(receipt.public_registration_verified, false);
  assert.equal(receipt.real_data_runner_enabled, false);
  assert.equal(receipt.broker_or_order_authority, false);
  assert.equal(receipt.historical_scoring_permitted, false);
  assert.match(receipt.receipt_sha256, /^sha256:[0-9a-f]{64}$/u);
});

test("protocol loader rejects a symlinked protocol path", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "finly-attempt116-protocol-"));
  try {
    const target = path.join(temporaryRoot, "target.json");
    const protocolDirectory = path.join(temporaryRoot, "research", "prospective_attempt116");
    await mkdir(protocolDirectory, { recursive: true });
    await writeFile(target, canonicalProspectiveAttempt116ProtocolJson(attempt116ProtocolJson));
    await symlink(target, path.join(protocolDirectory, "protocol.json"));
    await assert.rejects(
      loadProspectiveAttempt116Protocol({ projectRoot: temporaryRoot }),
      /symbolic link/iu,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
