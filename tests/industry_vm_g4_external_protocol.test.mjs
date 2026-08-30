import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  INDUSTRY_VM_G4_ARTIFACT_PATHS,
  INDUSTRY_VM_G4_BONFERRONI_THRESHOLD,
  INDUSTRY_VM_G4_FACTOR_ARTIFACT_RAW_SHA256,
  INDUSTRY_VM_G4_INFERENTIAL_EFFECTIVE_TRIAL_COUNT,
  INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_MEMBER,
  INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL,
  INDUSTRY_VM_G4_OPERATIONAL_ATTEMPT_NUMBER,
  INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV,
  INDUSTRY_VM_G4_REQUIRED_NODE_VERSION,
  canonicalIndustryVmG4ProtocolJson,
  createIndustryVmG4ProtocolBody,
  sealIndustryVmG4Protocol,
  validateIndustryVmG4Protocol,
  verifyIndustryVmG4ProtocolBytes,
} from "../research/industry_vm_g4_external/protocol.mjs";

function hashMap(paths, prefix) {
  return Object.fromEntries(paths.map((path) => [path, sha256(`${prefix}:${path}`)]));
}

function protocol() {
  return sealIndustryVmG4Protocol(createIndustryVmG4ProtocolBody({
    frozenAt: "2026-08-30T12:00:00.000Z",
    sourceFilesSha256: hashMap(INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files, "source"),
    testFilesSha256: hashMap(INDUSTRY_VM_G4_ARTIFACT_PATHS.test_files, "test"),
  }));
}

test("Attempt149 protocol freezes the effective N200 inference and source identities", () => {
  const frozen = protocol();
  assert.equal(INDUSTRY_VM_G4_OPERATIONAL_ATTEMPT_NUMBER, 149);
  assert.equal(INDUSTRY_VM_G4_INFERENTIAL_EFFECTIVE_TRIAL_COUNT, 200);
  assert.equal(INDUSTRY_VM_G4_BONFERRONI_THRESHOLD, 0.00025);
  assert.equal(frozen.registration.ledger_attempt_count, 149);
  assert.equal(frozen.registration.conservative_unlogged_scratch_reserve, 51);
  assert.equal(frozen.registration.inferential_effective_trial_count, 200);
  assert.equal(frozen.inference.inferential_effective_trial_count, 200);
  assert.equal(frozen.inference.bonferroni_threshold, 0.00025);
  assert.equal(frozen.source_freeze.official_archive_url, INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL);
  assert.equal(frozen.source_freeze.logical_archive_member, INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_MEMBER);
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
    () => verifyIndustryVmG4ProtocolBytes(text.replace("0.00025", "0.00026")),
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
