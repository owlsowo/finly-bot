import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  INDUSTRY_VM_G4_ARTIFACT_PATHS,
  INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RAW_SHA256,
  INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RELATIVE_PATH,
  INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_SHA256,
  INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RAW_SHA256,
  INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RELATIVE_PATH,
  INDUSTRY_VM_G4_ATTEMPT149_FAILURE_SHA256,
  INDUSTRY_VM_G4_ATTEMPT149_LEGACY_PROTOCOL_RELATIVE_PATH,
  INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RAW_SHA256,
  INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RELATIVE_PATH,
  INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_SHA256,
  INDUSTRY_VM_G4_ATTEMPT149_RUN_START_MARKER_SHA256,
  INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RAW_SHA256,
  INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RELATIVE_PATH,
  INDUSTRY_VM_G4_BONFERRONI_THRESHOLD,
  INDUSTRY_VM_G4_FACTOR_ARTIFACT_RAW_SHA256,
  INDUSTRY_VM_G4_INFERENTIAL_EFFECTIVE_TRIAL_COUNT,
  INDUSTRY_VM_G4_HTTP_ACCEPT,
  INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_MEMBER,
  INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL,
  INDUSTRY_VM_G4_OPERATIONAL_ATTEMPT_NUMBER,
  INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV,
  INDUSTRY_VM_G4_REQUIRED_NODE_VERSION,
  INDUSTRY_VM_G4_TRIAL_LEDGER_RAW_SHA256,
  INDUSTRY_VM_G4_TRIAL_LEDGER_RELATIVE_PATH,
  canonicalIndustryVmG4ProtocolJson,
  createIndustryVmG4ProtocolBody,
  sealIndustryVmG4Protocol,
  validateIndustryVmG4Protocol,
  verifyIndustryVmG4ProtocolBytes,
} from "../research/industry_vm_g4_external/protocol.mjs";

function hashMap(paths, prefix) {
  return Object.fromEntries(paths.map((path) => [path, sha256(`${prefix}:${path}`)]));
}

function rawSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function protocol() {
  return sealIndustryVmG4Protocol(createIndustryVmG4ProtocolBody({
    frozenAt: "2026-08-30T12:00:00.000Z",
    sourceFilesSha256: hashMap(INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files, "source"),
    testFilesSha256: hashMap(INDUSTRY_VM_G4_ARTIFACT_PATHS.test_files, "test"),
  }));
}

test("Attempt150 protocol freezes the transport-only successor and effective N201 inference", () => {
  const frozen = protocol();
  assert.equal(INDUSTRY_VM_G4_OPERATIONAL_ATTEMPT_NUMBER, 150);
  assert.equal(INDUSTRY_VM_G4_INFERENTIAL_EFFECTIVE_TRIAL_COUNT, 201);
  assert.equal(INDUSTRY_VM_G4_BONFERRONI_THRESHOLD, 0.05 / 201);
  assert.equal(frozen.registration.ledger_attempt_count, 150);
  assert.equal(frozen.registration.conservative_unlogged_scratch_reserve, 51);
  assert.equal(frozen.registration.inferential_effective_trial_count, 201);
  assert.equal(frozen.inference.inferential_effective_trial_count, 201);
  assert.equal(frozen.inference.bonferroni_threshold, 0.05 / 201);
  assert.equal(frozen.source_freeze.official_archive_url, INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL);
  assert.equal(frozen.source_freeze.logical_archive_member, INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_MEMBER);
  assert.equal(frozen.source_freeze.http.accept, INDUSTRY_VM_G4_HTTP_ACCEPT);
  assert.equal(frozen.source_freeze.acquisition_state, "NOT_ACQUIRED_FOR_ATTEMPT150");
  assert.equal(frozen.source_freeze.expected_observations, 26_274);
  assert.equal(frozen.factor_binding.raw_bytes_sha256, INDUSTRY_VM_G4_FACTOR_ARTIFACT_RAW_SHA256);
  assert.equal(frozen.factor_binding.expected_observations, 26_274);
  assert.equal(
    frozen.inference.deflated_sharpe_method,
    "parametric null-maximum deflated Sharpe probability",
  );
  assert.equal(frozen.inference.empirical_trial_sharpe_distribution_used, false);
  assert.match(frozen.gates.statistical_evidence, /parametric null-maximum/iu);
  assert.equal(frozen.gates.all_nine_required, true);
  assert.deepEqual(frozen.policy_binding.comparators, [
    "MARKET_BUY_HOLD", "MARKET_VOL20_CAP15", "UNSCALED_A", "RF_CASH",
  ]);
  assert.equal(frozen.output_contract.full_grid_persistence_permitted, false);
  assert.equal(frozen.output_contract.official_archive_filename, "official_source_archive.zip");
  assert.equal(frozen.output_contract.official_member_filename, "official_source_member.csv");
  assert.equal(frozen.output_contract.official_archive_maximum_bytes, 16 * 1024 * 1024);
  assert.equal(frozen.output_contract.official_member_maximum_bytes, 16 * 1024 * 1024);
  assert.equal(frozen.output_contract.canonical_source_maximum_bytes, 16 * 1024 * 1024);
  assert.equal(frozen.output_contract.aggregate_maximum_bytes, 2 * 1024 * 1024);
  assert.equal(frozen.output_contract.primary_series_maximum_bytes, 8 * 1024 * 1024);
  assert.equal(frozen.output_contract.each_receipt_maximum_bytes, 512 * 1024);
  assert.equal(frozen.output_contract.total_output_maximum_bytes, 64 * 1024 * 1024);
  assert.equal(frozen.output_contract.same_marker_retry_permitted, false);
  assert.equal(frozen.output_contract.fixed_output_directory_creation_is_preclaim, true);
  assert.equal(frozen.output_contract.orphan_preclaim_directory_retry_permitted, false);
  assert.equal(
    frozen.output_contract.orphan_preclaim_directory_requires_new_preregistered_protocol,
    true,
  );
  assert.equal(frozen.output_contract.run_start_permanently_consumes_operational_attempt, true);
  assert.equal(frozen.output_contract.failure_receipt_required_after_run_start, true);
  assert.equal(frozen.execution_protocol.runtime.exact_node_version,
    INDUSTRY_VM_G4_REQUIRED_NODE_VERSION);
  assert.deepEqual(frozen.execution_protocol.runtime.exact_process_exec_argv,
    INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV);
  assert.equal(frozen.execution_protocol.runtime.v8_old_space_limit_mib, 256);
  assert.equal(frozen.execution_protocol.runtime.unlisted_node_exec_argv_permitted, false);
  assert.equal(frozen.execution_protocol.runtime.node_options_permitted, false);
  assert.equal(
    INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files.includes("research/champion_engine.mjs"),
    true,
  );
  assert.equal(
    INDUSTRY_VM_G4_ARTIFACT_PATHS.test_files.includes("tests/champion_engine.test.mjs"),
    false,
  );
  assert.equal(frozen.policy_binding.diagnostic_mapping_b.selection_eligible, false);
  assert.equal(frozen.policy_binding.diagnostic_mapping_b.enters_any_primary_gate, false);
  assert.equal(
    frozen.policy_binding.diagnostic_mapping_b.can_rescue_reverse_or_modify_primary,
    false,
  );
  assert.equal(frozen.execution_protocol.overlap_diagnostic_can_rescue_primary, false);
  assert.match(frozen.execution_protocol.transaction_cost_basis, /risky-asset L1/iu);
  assert.equal(frozen.execution_protocol.transaction_cost_symbols.includes("RF"), false);
  assert.deepEqual(frozen.execution_protocol.transaction_cost_symbols, [
    "NoDur", "Durbl", "Manuf", "Enrgy", "HiTec", "Telcm",
    "Shops", "Hlth", "Utils", "Other", "MARKET",
  ]);
  assert.match(frozen.execution_protocol.borrow_spread_accounting, /separately/iu);
  assert.match(frozen.claim_boundary, /Mapping B.+non-rescuing/iu);
  assert.match(frozen.claim_boundary, /transport-only successor/iu);
  assert.equal(frozen.predecessor_attempt.operational_attempt_number, 149);
  assert.equal(frozen.predecessor_attempt.outcomes_observed, false);
  assert.equal(frozen.predecessor_attempt.successor_scope, "HTTP_ACCEPT_REQUEST_HEADER_ONLY");
  assert.equal(frozen.predecessor_attempt.attempt150_accept, "*/*");
  assert.equal(
    frozen.predecessor_attempt.transport_diagnosis.response_body_or_official_source_values_read,
    false,
  );
});

test("semantic self-hash and canonical raw bytes reject any mutation", () => {
  const frozen = protocol();
  assert.equal(
    frozen.protocol_sha256,
    sha256(Object.fromEntries(Object.entries(frozen).filter(([key]) => key !== "protocol_sha256"))),
  );
  assert.equal(validateIndustryVmG4Protocol(frozen), frozen);
  const text = canonicalIndustryVmG4ProtocolJson(frozen);
  assert.deepEqual(verifyIndustryVmG4ProtocolBytes(text), frozen);
  assert.throws(
    () => verifyIndustryVmG4ProtocolBytes(text.replace("0.05/201", "0.05/202")),
    /self-hash|changed/iu,
  );
  assert.throws(
    () => verifyIndustryVmG4ProtocolBytes(` ${text}`),
    /not canonical/iu,
  );
});

test("hash maps must bind every exact source and test path", () => {
  const sources = hashMap(INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files, "source");
  const tests = hashMap(INDUSTRY_VM_G4_ARTIFACT_PATHS.test_files, "test");
  delete sources[INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files[0]];
  assert.throws(
    () => createIndustryVmG4ProtocolBody({
      frozenAt: "2026-08-30T12:00:00.000Z",
      sourceFilesSha256: sources,
      testFilesSha256: tests,
    }),
    /fields changed/iu,
  );
});

test("Attempt149 protocol, marker, failure, and retained diagnosis are exact public evidence", async () => {
  const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url));
  const [protocolBytes, legacyProtocolBytes, markerBytes, failureBytes, diagnosisBytes] =
    await Promise.all([
      read(INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RELATIVE_PATH),
      read(INDUSTRY_VM_G4_ATTEMPT149_LEGACY_PROTOCOL_RELATIVE_PATH),
      read(INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RELATIVE_PATH),
      read(INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RELATIVE_PATH),
      read(INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RELATIVE_PATH),
    ]);
  assert.equal(rawSha256(protocolBytes), INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RAW_SHA256);
  assert.deepEqual(legacyProtocolBytes, protocolBytes);
  assert.equal(rawSha256(markerBytes), INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RAW_SHA256);
  assert.equal(rawSha256(failureBytes), INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RAW_SHA256);
  assert.equal(rawSha256(diagnosisBytes), INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RAW_SHA256);

  const predecessor = JSON.parse(protocolBytes);
  const marker = JSON.parse(markerBytes);
  const failure = JSON.parse(failureBytes);
  const diagnosis = JSON.parse(diagnosisBytes);
  const without = (value, key) => Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  );
  assert.equal(sha256(without(predecessor, "protocol_sha256")),
    INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_SHA256);
  assert.equal(sha256(without(marker, "run_start_marker_sha256")),
    INDUSTRY_VM_G4_ATTEMPT149_RUN_START_MARKER_SHA256);
  assert.equal(sha256(without(failure, "failure_receipt_sha256")),
    INDUSTRY_VM_G4_ATTEMPT149_FAILURE_SHA256);
  assert.equal(sha256(without(diagnosis, "diagnosis_sha256")),
    INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_SHA256);
  assert.equal(failure.protocol_sha256, predecessor.protocol_sha256);
  assert.equal(failure.run_start_marker_sha256, marker.run_start_marker_sha256);
  assert.equal(failure.outcomes_observed, false);
  assert.equal(diagnosis.predecessor_outcomes_observed, false);
  assert.ok(diagnosis.probes.every((item) => (
    item.body_reader_attached === false
      && item.body_bytes_read_by_process === 0
      && item.archive_persisted === false
  )));
  assert.doesNotMatch(
    Buffer.concat([protocolBytes, markerBytes, failureBytes, diagnosisBytes]).toString("utf8"),
    /(?:api[_-]?key|authorization\s*:|bearer\s+|password\s*:|private[_-]?key)/iu,
  );
});

test("Attempt150 semantic delta is limited to provenance, transport Accept, and N201", async () => {
  const predecessor = JSON.parse(await readFile(new URL(
    "../research/industry_vm_g4_external/attempt149_frozen_protocol.json",
    import.meta.url,
  )));
  const successor = protocol();
  assert.deepEqual(successor.factor_binding, predecessor.factor_binding);
  assert.deepEqual(successor.policy_binding, predecessor.policy_binding);
  assert.deepEqual(successor.execution_protocol, predecessor.execution_protocol);
  assert.deepEqual(successor.authority, predecessor.authority);

  const predecessorSource = structuredClone(predecessor.source_freeze);
  const successorSource = structuredClone(successor.source_freeze);
  delete predecessorSource.acquisition_state;
  delete successorSource.acquisition_state;
  delete successorSource.http.accept;
  assert.deepEqual(successorSource, predecessorSource);

  assert.deepEqual(successor.gates.exact_gate_names, predecessor.gates.exact_gate_names);
  assert.equal(successor.gates.all_nine_required, predecessor.gates.all_nine_required);
  for (const name of successor.gates.exact_gate_names.filter(
    (gateName) => gateName !== "statistical_evidence",
  )) {
    assert.equal(successor.gates[name], predecessor.gates[name]);
  }
  assert.equal(
    successor.gates.statistical_evidence.replace("0.05/201", "0.00025"),
    predecessor.gates.statistical_evidence,
  );

  for (const name of [
    "stationary_bootstrap_seed",
    "stationary_bootstrap_resamples",
    "stationary_bootstrap_expected_block_sessions",
    "nominal_alpha",
    "deflated_sharpe_method",
    "empirical_trial_sharpe_distribution_used",
    "deflated_sharpe_probability_minimum",
  ]) {
    assert.equal(successor.inference[name], predecessor.inference[name]);
  }
  assert.equal(predecessor.inference.inferential_effective_trial_count, 200);
  assert.equal(successor.inference.inferential_effective_trial_count, 201);
  assert.equal(predecessor.inference.bonferroni_threshold, 0.05 / 200);
  assert.equal(successor.inference.bonferroni_threshold, 0.05 / 201);

  const predecessorOutput = structuredClone(predecessor.output_contract);
  const successorOutput = structuredClone(successor.output_contract);
  successorOutput.atomic_run_start_relative_path = predecessorOutput.atomic_run_start_relative_path;
  successorOutput.fixed_ignored_private_output_relative_path =
    predecessorOutput.fixed_ignored_private_output_relative_path;
  assert.deepEqual(successorOutput, predecessorOutput);
});

test("Attempt150 trial ledger appends one transport-only attempt and preserves reserve 51", async () => {
  const ledgerBytes = await readFile(new URL(
    `../${INDUSTRY_VM_G4_TRIAL_LEDGER_RELATIVE_PATH}`,
    import.meta.url,
  ));
  assert.equal(rawSha256(ledgerBytes), INDUSTRY_VM_G4_TRIAL_LEDGER_RAW_SHA256);
  const ledger = JSON.parse(ledgerBytes);
  assert.equal(ledger.append_only_through, 150);
  assert.equal(ledger.block_count_sum, 150);
  assert.equal(ledger.operational_attempt_count, 150);
  assert.equal(ledger.inferential_multiplicity_reserve.additional_scratch_cells_charged, 51);
  assert.equal(ledger.inferential_cumulative_trial_count, 201);
  assert.equal(ledger.blocks.reduce((sum, block) => sum + block.count, 0), 150);
  const successor = ledger.blocks.at(-1);
  assert.equal(successor.range, "150");
  assert.equal(successor.predecessor.outcomes_observed, false);
  assert.equal(successor.transport_only_correction.changed_field,
    "HTTP Accept request header value");
  assert.equal(successor.transport_only_correction.attempt149_value,
    "application/zip, application/octet-stream");
  assert.equal(successor.transport_only_correction.attempt150_value, "*/*");
  assert.equal(successor.transport_only_correction.retained_diagnosis_raw_bytes_sha256,
    INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RAW_SHA256);
  assert.equal(
    successor.transport_only_correction.header_only_diagnostic
      .response_body_or_official_source_values_read,
    false,
  );
});
