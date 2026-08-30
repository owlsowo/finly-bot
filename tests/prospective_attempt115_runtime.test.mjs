import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  downsideSemivolatilityTarget,
} from "../research/downside_semivolatility_challenger.mjs";
import attempt115ProtocolJson from "../research/downside_semivolatility_challenger_protocol.json" with { type: "json" };
import { frozenPolicyTarget } from "../research/equity_execution_realism.mjs";
import {
  ATTEMPT115_ACTIVATION,
  ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256,
  ATTEMPT115_ACTIVATION_SHA256,
  canonicalProspectiveAttempt115ActivationJson,
  loadProspectiveAttempt115Activation,
  validateProspectiveAttempt115Activation,
} from "../research/prospective_attempt115/activation.mjs";
import {
  buildAttempt115PairedPolicyDecision,
  validateAttempt115PairedPolicyDecision,
} from "../research/prospective_attempt115/policy.mjs";
import {
  ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
  ATTEMPT115_PROTOCOL_SHA256,
  canonicalProspectiveAttempt115ProtocolJson,
  loadProspectiveAttempt115Protocol,
  validateProspectiveAttempt115Protocol,
} from "../research/prospective_attempt115/protocol.mjs";
import {
  ATTEMPT115_FROZEN_REFERENCE_SOURCE_HASHES,
  ATTEMPT115_LOCAL_RUNTIME_SOURCE_PATHS,
  ATTEMPT115_RUNTIME_MANIFEST_SCHEMA,
  ATTEMPT115_RUNTIME_SOURCE_PATHS,
  buildProspectiveAttempt115RuntimeManifest,
  canonicalProspectiveAttempt115RuntimeManifestJson,
  hashProspectiveAttempt115RuntimeManifest,
  validateProspectiveAttempt115RuntimeManifest,
  verifyProspectiveAttempt115RuntimeManifestSources,
} from "../research/prospective_attempt115/runtime.mjs";

function clone(value) {
  return structuredClone(value);
}

function syntheticAcquisition() {
  const count = 253;
  const end = Date.parse("2026-08-31T00:00:00.000Z");
  const start = end - (count - 1) * 86_400_000;
  const dates = Array.from({ length: count }, (_, index) => (
    new Date(start + index * 86_400_000).toISOString().slice(0, 10)
  ));
  const spy = dates.map((sessionDate, index) => ({
    session_date: sessionDate,
    close: 100 * Math.exp(index * 0.00032 + Math.sin(index / 7) * 0.013),
  }));
  const bil = dates.map((sessionDate, index) => ({
    session_date: sessionDate,
    close: 100 * Math.exp(index * 0.00008 + Math.sin(index / 31) * 0.0002),
  }));
  return {
    session: { session_date: dates.at(-1) },
    adjusted_close_rows: { SPY: spy, BIL: bil },
  };
}

function acquisitionFromReturns(spyReturns, bilReturns) {
  assert.equal(spyReturns.length, 252);
  assert.equal(bilReturns.length, 252);
  const start = Date.parse("2025-12-22T00:00:00.000Z");
  const dates = Array.from({ length: 253 }, (_, index) => (
    new Date(start + index * 86_400_000).toISOString().slice(0, 10)
  ));
  const spyCloses = [100];
  const bilCloses = [100];
  for (let index = 0; index < 252; index += 1) {
    spyCloses.push(spyCloses.at(-1) * (1 + spyReturns[index]));
    bilCloses.push(bilCloses.at(-1) * (1 + bilReturns[index]));
  }
  return {
    session: { session_date: dates.at(-1) },
    adjusted_close_rows: {
      SPY: dates.map((sessionDate, index) => ({
        session_date: sessionDate,
        close: spyCloses[index],
      })),
      BIL: dates.map((sessionDate, index) => ({
        session_date: sessionDate,
        close: bilCloses[index],
      })),
    },
  };
}

function oraclePoints(acquisition) {
  return acquisition.adjusted_close_rows.SPY.map((row, index) => ({
    date: row.session_date,
    SPY: row.close,
    BIL: acquisition.adjusted_close_rows.BIL[index].close,
  }));
}

function deterministicReturns(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  return {
    spy: Array.from({ length: 252 }, () => (random() - 0.49) * 0.035),
    bil: Array.from({ length: 252 }, () => 0.00008 + (random() - 0.5) * 0.00008),
  };
}

function assertPolicyOracleEquivalence(acquisition, sequence = 1) {
  const points = oraclePoints(acquisition);
  const decision = buildAttempt115PairedPolicyDecision({
    acquisition,
    commitmentSequence: sequence,
  });
  assert.deepEqual(decision.policies.tsmom_ensemble_vol, frozenPolicyTarget(points, 252));
  assert.deepEqual(
    decision.policies.tsmom_ensemble_downside_semivol,
    downsideSemivolatilityTarget(points, 252),
  );
  return decision;
}

function syntheticManifest() {
  const runtimeSourceFiles = Object.fromEntries(ATTEMPT115_RUNTIME_SOURCE_PATHS.map((path) => [
    path,
    ATTEMPT115_FROZEN_REFERENCE_SOURCE_HASHES[path]
      ?? `sha256:${"1".repeat(64)}`,
  ]));
  runtimeSourceFiles["research/prospective_attempt115/activation.json"] =
    ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256;
  const body = {
    schema_version: ATTEMPT115_RUNTIME_MANIFEST_SCHEMA,
    attempt_id: "finly_prospective_profitability_attempt_115",
    manifest_kind: "PRE_SIGNAL_DETERMINISTIC_COMMIT_REVEAL_RUNTIME_FREEZE",
    frozen_at: "2026-08-30T07:00:00.000Z",
    publication_deadline: "2026-08-31T20:00:00.000Z",
    publication_deadline_exclusive: true,
    protocol: {
      path: "research/downside_semivolatility_challenger_protocol.json",
      raw_bytes_sha256: ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
      protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    },
    activation: {
      path: "research/prospective_attempt115/activation.json",
      raw_bytes_sha256: ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256,
      activation_sha256: ATTEMPT115_ACTIVATION_SHA256,
    },
    runtime_source_files: runtimeSourceFiles,
    runtime_source_files_sha256: sha256(runtimeSourceFiles),
    authority: {
      research_only: true,
      alpaca_or_broker_network_requests_permitted: false,
      public_github_get_verification_permitted: true,
      broker_reads_permitted: false,
      broker_mutation_authorized: false,
      order_payload: null,
      content_addressed_local_evidence_persistence_permitted: true,
      retrospective_scoring_permitted: false,
      public_claim_mutation_authorized: false,
    },
    evaluation_gates: {
      protocol_activation_runtime_publication_verified: false,
      input_commitment_replay_enabled: false,
      settlement_enabled: false,
      inference_enabled: false,
    },
    assurance: {
      github_publication_before_first_signal_close_required: true,
      separate_attempt115_signal_anchor_required: false,
      frozen_function_over_preopen_forward_input_hash_required: true,
      all_first_252_forward_input_publication_runs_complete_before_committed_next_open_required: true,
      all_first_253_forward_private_bundles_and_public_anchors_required: true,
      all_first_252_outcome_price_lineages_required: true,
      independent_cryptographic_timestamp_verified: false,
      provider_origin_verified: false,
      broker_execution_verified: false,
      performance_inference_permitted: false,
    },
    claim_boundary: "This manifest binds the exact pre-signal Attempt 115 protocol, activation, deterministic policy compiler, input-hash verifier, settlement, inference, and frozen upstream source bytes. It does not itself prove public publication, open replay, settlement, or inference gates, verify provider origin or broker execution, authorize trading, or establish profitability.",
  };
  return { ...body, manifest_sha256: sha256(body) };
}

test("Attempt 115 protocol and activation are canonical, self-hashed, and strictly pre-signal", async () => {
  const protocol = await loadProspectiveAttempt115Protocol();
  const activation = await loadProspectiveAttempt115Activation();
  assert.equal(protocol.protocol_sha256, ATTEMPT115_PROTOCOL_SHA256);
  assert.equal(activation.activation_sha256, ATTEMPT115_ACTIVATION_SHA256);
  assert.equal(
    await readFile("research/downside_semivolatility_challenger_protocol.json", "utf8"),
    canonicalProspectiveAttempt115ProtocolJson(protocol),
  );
  assert.equal(
    await readFile("research/prospective_attempt115/activation.json", "utf8"),
    canonicalProspectiveAttempt115ActivationJson(activation),
  );
  assert.ok(activation.frozen_at < activation.publication_deadline);
  assert.equal(activation.deterministic_commitment.separate_attempt115_signal_anchor_required, false);
  assert.equal(activation.sample.first_execution_market_open_at, "2026-09-01T13:30:00.000Z");
});

test("Attempt 115 validators reject re-hashed semantic weakening and unknown fields", () => {
  const protocol = clone(validateProspectiveAttempt115Protocol(attempt115ProtocolJson));
  protocol.authority_and_disposition.retrospective_evaluation_authorized = true;
  protocol.protocol_sha256 = sha256(Object.fromEntries(
    Object.entries(protocol).filter(([key]) => key !== "protocol_sha256"),
  ));
  assert.throws(() => validateProspectiveAttempt115Protocol(protocol), /self-hash changed/);

  const activation = clone(ATTEMPT115_ACTIVATION);
  activation.deterministic_commitment.separate_attempt115_signal_anchor_required = true;
  activation.activation_sha256 = sha256(Object.fromEntries(
    Object.entries(activation).filter(([key]) => key !== "activation_sha256"),
  ));
  assert.throws(() => validateProspectiveAttempt115Activation(activation), /commitment rule changed/);
  const unknown = clone(ATTEMPT115_ACTIVATION);
  unknown.unfrozen_escape_hatch = true;
  assert.throws(() => validateProspectiveAttempt115Activation(unknown), /contain exactly/);
});

test("Attempt 115 byte loaders reject a symlinked protocol before parsing it", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "finly-attempt115-protocol-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const researchDirectory = path.join(temporaryRoot, "research");
  await mkdir(researchDirectory, { recursive: true });
  await symlink(
    path.resolve("research/downside_semivolatility_challenger_protocol.json"),
    path.join(researchDirectory, "downside_semivolatility_challenger_protocol.json"),
  );
  await assert.rejects(
    loadProspectiveAttempt115Protocol({ projectRoot: temporaryRoot }),
    /traverses a symbolic link/,
  );
});

test("pure Attempt 115 compiler exactly matches both frozen policy oracles", () => {
  const acquisition = syntheticAcquisition();
  const decision = assertPolicyOracleEquivalence(acquisition);
  assert.equal(decision.rebalance_schedule.rebalance_due, true);
  assert.equal(decision.authority.broker_mutation_authorized, false);
  assert.equal(decision.decision_sha256, sha256(Object.fromEntries(
    Object.entries(decision).filter(([key]) => key !== "decision_sha256"),
  )));
  assert.equal(buildAttempt115PairedPolicyDecision({
    acquisition,
    commitmentSequence: 2,
  }).rebalance_schedule.action, "HOLD");
});

test("policy compiler is byte-for-byte equivalent across broad deterministic fixtures", () => {
  for (let seed = 1; seed <= 128; seed += 1) {
    const returns = deterministicReturns(seed * 2_654_435_761);
    assertPolicyOracleEquivalence(
      acquisitionFromReturns(returns.spy, returns.bil),
      (seed % 252) + 1,
    );
  }
});

test("policy equivalence covers sparse negatives, zero-downside fallback, and boundary weights", () => {
  const bil = Array(252).fill(0.00005);
  const sparse = Array.from({ length: 252 }, (_, index) => 0.0003 + (index % 3) * 0.00002);
  for (const offset of [21, 25, 29, 33, 37]) sparse[252 - offset] = -0.001;
  sparse[252 - 4] = -0.0012;
  sparse[252 - 13] = -0.0008;
  const sparseDecision = assertPolicyOracleEquivalence(acquisitionFromReturns(sparse, bil));
  assert.equal(
    sparseDecision.policies.tsmom_ensemble_downside_semivol
      .diagnostics.downside_semivolatility.selected_lookback_sessions,
    40,
  );
  assert.equal(
    sparseDecision.policies.tsmom_ensemble_downside_semivol
      .diagnostics.downside_semivolatility.incumbent_total_volatility_fallback_used,
    false,
  );

  const zeroDownside = Array.from({ length: 252 }, (_, index) => (
    0.0001 + (index % 5) * 0.00003
  ));
  const zeroDecision = assertPolicyOracleEquivalence(
    acquisitionFromReturns(zeroDownside, bil),
  );
  assert.equal(
    zeroDecision.policies.tsmom_ensemble_downside_semivol
      .diagnostics.downside_semivolatility.incumbent_total_volatility_fallback_used,
    true,
  );

  const positiveLowVol = Array.from({ length: 252 }, (_, index) => (
    index % 11 === 0 ? -0.0001 : 0.00045
  ));
  const positiveDecision = assertPolicyOracleEquivalence(
    acquisitionFromReturns(positiveLowVol, Array(252).fill(0.00002)),
  );
  assert.equal(positiveDecision.policies.tsmom_ensemble_vol.SPY, 1);
  assert.equal(positiveDecision.policies.tsmom_ensemble_downside_semivol.SPY, 1);

  const negativeTrend = Array.from({ length: 252 }, (_, index) => (
    -0.00035 - (index % 3) * 0.00001
  ));
  const negativeDecision = assertPolicyOracleEquivalence(
    acquisitionFromReturns(negativeTrend, bil),
  );
  assert.equal(negativeDecision.policies.tsmom_ensemble_vol.SPY, 0);
  assert.equal(negativeDecision.policies.tsmom_ensemble_downside_semivol.SPY, 0);
});

test("decision validation is canonical-order independent and rejects a rehashed output override", () => {
  const acquisition = syntheticAcquisition();
  const input = { acquisition, commitmentSequence: 1 };
  const decision = buildAttempt115PairedPolicyDecision(input);
  const reordered = Object.fromEntries(Object.entries(decision).reverse());
  assert.equal(validateAttempt115PairedPolicyDecision(reordered, input), reordered);
  const forged = clone(decision);
  forged.policies.tsmom_ensemble_downside_semivol.SPY = 0.999;
  forged.policies.tsmom_ensemble_downside_semivol.BIL = 0.001;
  forged.decision_sha256 = sha256(Object.fromEntries(
    Object.entries(forged).filter(([key]) => key !== "decision_sha256"),
  ));
  assert.throws(
    () => validateAttempt115PairedPolicyDecision(forged, input),
    /not the frozen deterministic replay/,
  );
});

test("runtime schema binds the full source closure and keeps every evaluation gate closed", () => {
  for (const required of [
    "research/prospective_attempt115/activation.mjs",
    "research/prospective_attempt115/policy.mjs",
    "research/prospective_attempt115/settlement.mjs",
    "research/prospective_attempt115/inference.mjs",
    "scripts/verify_attempt115_forward_anchor.mjs",
    "scripts/verify_attempt115_github_publication.mjs",
    "research/prospective_attempt114/settlement.mjs",
    "research/prospective_attempt114/inference.mjs",
    "research/forward_trial_live_core.mjs",
    "scripts/verify_forward_live_github_publication.mjs",
  ]) assert.ok(ATTEMPT115_RUNTIME_SOURCE_PATHS.includes(required), required);
  assert.equal(new Set(ATTEMPT115_RUNTIME_SOURCE_PATHS).size, ATTEMPT115_RUNTIME_SOURCE_PATHS.length);
  assert.ok(ATTEMPT115_LOCAL_RUNTIME_SOURCE_PATHS.every(
    (path) => ATTEMPT115_RUNTIME_SOURCE_PATHS.includes(path),
  ));
  const manifest = syntheticManifest();
  assert.equal(
    validateProspectiveAttempt115RuntimeManifest(manifest).manifest_sha256,
    hashProspectiveAttempt115RuntimeManifest(manifest),
  );
  assert.deepEqual(manifest.evaluation_gates, {
    protocol_activation_runtime_publication_verified: false,
    input_commitment_replay_enabled: false,
    settlement_enabled: false,
    inference_enabled: false,
  });
  const weakened = clone(manifest);
  weakened.evaluation_gates.inference_enabled = true;
  weakened.manifest_sha256 = hashProspectiveAttempt115RuntimeManifest(weakened);
  assert.throws(() => validateProspectiveAttempt115RuntimeManifest(weakened), /runtime gates changed/);
});

test("runtime builder reopens every bound source without symlinks and rejects a late freeze", async () => {
  const manifest = await buildProspectiveAttempt115RuntimeManifest({
    frozen_at: "2026-08-30T07:10:00.000Z",
  });
  const receipt = await verifyProspectiveAttempt115RuntimeManifestSources(manifest);
  assert.equal(receipt.source_files_verified, ATTEMPT115_RUNTIME_SOURCE_PATHS.length);
  assert.equal(receipt.source_bytes_verified, true);
  assert.equal(receipt.symlink_traversal_rejected, true);
  assert.equal(receipt.separate_attempt115_signal_anchor_required, false);
  assert.equal(receipt.input_commitment_replay_enabled, false);
  assert.equal(receipt.settlement_enabled, false);
  assert.equal(receipt.inference_enabled, false);
  await assert.rejects(
    buildProspectiveAttempt115RuntimeManifest({
      frozen_at: "2026-08-31T20:00:00.000Z",
    }),
    /strictly before/,
  );
});

test("checked-in runtime manifest is canonical, reproducible, and matches live source bytes", async () => {
  const manifestPath = "research/prospective_attempt115/runtime_manifest.json";
  const bytes = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(bytes);
  validateProspectiveAttempt115RuntimeManifest(manifest);
  assert.equal(bytes, canonicalProspectiveAttempt115RuntimeManifestJson(manifest));
  const rebuilt = await buildProspectiveAttempt115RuntimeManifest({
    frozen_at: manifest.frozen_at,
  });
  assert.deepEqual(rebuilt, manifest);
  const receipt = await verifyProspectiveAttempt115RuntimeManifestSources(manifest);
  assert.equal(receipt.source_files_verified, ATTEMPT115_RUNTIME_SOURCE_PATHS.length);
  assert.equal(receipt.source_bytes_verified, true);
  assert.equal(receipt.symlink_traversal_rejected, true);
});
