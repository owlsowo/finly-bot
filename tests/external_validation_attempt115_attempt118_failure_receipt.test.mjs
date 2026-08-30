import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_RELATIVE_PATH =
  "research/external_validation_attempt115/attempt118_failure_receipt.json";
const PUBLIC_PROTOCOL_RELATIVE_PATH =
  "research/external_validation_attempt115/attempt118_frozen_protocol.json";
const PRIVATE_MARKER_RELATIVE_PATH =
  "data/external_validation_attempt115/attempt118.run-start.json";
const PRIVATE_OUTPUT_RELATIVE_PATH =
  "data/external_validation_attempt115/attempt118";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function absolute(relativePath) {
  return resolve(PROJECT_ROOT, relativePath);
}

function independentStableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(independentStableStringify).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => (
    `${JSON.stringify(key)}:${independentStableStringify(item)}`
  )).join(",")}}`;
}

function semanticHash(value, omittedField) {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== omittedField),
  );
  return `sha256:${createHash("sha256")
    .update(independentStableStringify(body))
    .digest("hex")}`;
}

function rawHash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(absolute(relativePath), "utf8"));
}

test("Attempt118 operational failure receipt is self-hashed and internally exact", () => {
  const receipt = readJson(RECEIPT_RELATIVE_PATH);
  assert.equal(
    receipt.schema_version,
    "finly_attempt115_external_attempt_failure_receipt.v2",
  );
  assert.equal(receipt.registered_attempt_number, 118);
  assert.equal(receipt.disposition, "ATTEMPT_118_CONSUMED_NO_RETRY");
  assert.equal(receipt.failure_receipt_sha256, semanticHash(
    receipt,
    "failure_receipt_sha256",
  ));
  assert.match(receipt.failure_receipt_sha256, SHA256_PATTERN);

  assert.equal(receipt.completion_state.authoritative_run_completed, false);
  assert.equal(receipt.completion_state.one_time_attempt_consumed, true);
  assert.equal(receipt.completion_state.rerun_permitted, false);
  assert.equal(receipt.completion_state.run_receipt_exists, false);
  assert.equal(receipt.completion_state.run_receipt_sha256, null);
  assert.equal(
    receipt.completion_state.run_receipt_relative_path,
    `${receipt.completion_state.fixed_output_relative_path}/run_receipt.json`,
  );

  const failure = receipt.failure;
  assert.equal(
    failure.failure_phase,
    "POST_EVALUATION_DURABLE_OUTPUT_VERIFICATION_BEFORE_RUN_RECEIPT",
  );
  assert.equal(failure.verification_maximum_mib, 64);
  assert.equal(failure.verification_maximum_byte_count, 64 * 1024 * 1024);
  assert.equal(
    failure.excess_byte_count,
    failure.failing_artifact_byte_count - failure.verification_maximum_byte_count,
  );
  assert.ok(failure.excess_byte_count > 0);
  assert.equal(failure.failing_artifact_is_regular_file, true);
  assert.equal(
    failure.failure_message,
    `external Attempt115 bound artifact ${failure.failing_artifact_relative_path} is not a bounded regular file`,
  );
  assert.equal(
    failure.cli_error_line,
    `External Attempt115 one-shot failed closed: ${failure.failure_message}`,
  );

  const artifacts = receipt.artifact_binding.persisted_artifacts;
  assert.equal(Object.keys(artifacts).length, receipt.artifact_binding.persisted_artifact_count);
  assert.equal(receipt.artifact_binding.persisted_artifact_count, 9);
  assert.equal(artifacts.replay_grid.relative_path, failure.failing_artifact_relative_path);
  assert.equal(artifacts.replay_grid.byte_count, failure.failing_artifact_byte_count);
  assert.equal(
    artifacts.acquisition_receipt.semantic_sha256,
    receipt.observed_outcome.acquisition_receipt_sha256,
  );
  assert.equal(
    artifacts.replay_grid.semantic_sha256,
    receipt.observed_outcome.replay_grid_sha256,
  );
  assert.equal(
    artifacts.evaluation.semantic_sha256,
    receipt.observed_outcome.evaluation_sha256,
  );
  assert.equal(
    artifacts.frozen_protocol.semantic_sha256,
    receipt.protocol_sha256,
  );
  assert.equal(
    receipt.artifact_binding.public_frozen_protocol.semantic_sha256,
    receipt.protocol_sha256,
  );
  assert.equal(
    receipt.artifact_binding.public_frozen_protocol.raw_bytes_sha256,
    artifacts.frozen_protocol.raw_bytes_sha256,
  );
  assert.equal(
    receipt.artifact_binding.public_frozen_protocol.byte_count,
    artifacts.frozen_protocol.byte_count,
  );
  assert.equal(
    receipt.run_start_marker.artifact_set_sha256,
    receipt.artifact_binding.artifact_set_sha256,
  );
  for (const artifact of Object.values(artifacts)) {
    assert.match(artifact.raw_bytes_sha256, SHA256_PATTERN);
    assert.ok(Number.isSafeInteger(artifact.byte_count) && artifact.byte_count > 0);
  }

  assert.equal(receipt.observed_outcome.source_data_acquired, true);
  assert.equal(receipt.observed_outcome.factor_values_parsed, true);
  assert.equal(receipt.observed_outcome.replay_generated, true);
  assert.equal(receipt.observed_outcome.evaluation_invoked, true);
  assert.equal(receipt.observed_outcome.performance_result_observed, true);
  assert.equal(receipt.observed_outcome.all_nine_mechanism_gates_passed, false);
  assert.deepEqual(receipt.observed_outcome.failed_mechanism_gates, [
    "statistical_evidence",
  ]);
  assert.equal(
    receipt.observed_outcome.evaluation_disposition,
    "EXTERNAL_MECHANISM_PORTABILITY_NOT_ESTABLISHED",
  );
  assert.match(receipt.claim_boundary, /outcome was observed/iu);
  assert.match(receipt.claim_boundary, /did not reach its completion receipt/iu);
});

test("Attempt118 receipt binds the public frozen protocol and its runner identity", () => {
  const receipt = readJson(RECEIPT_RELATIVE_PATH);
  const protocolBytes = readFileSync(absolute(PUBLIC_PROTOCOL_RELATIVE_PATH));
  const protocol = JSON.parse(protocolBytes);
  const publicBinding = receipt.artifact_binding.public_frozen_protocol;

  assert.equal(protocolBytes.byteLength, publicBinding.byte_count);
  assert.equal(rawHash(protocolBytes), publicBinding.raw_bytes_sha256);
  assert.equal(protocol.protocol_sha256, semanticHash(protocol, "protocol_sha256"));
  assert.equal(protocol.protocol_sha256, publicBinding.semantic_sha256);
  assert.equal(protocol.protocol_sha256, receipt.protocol_sha256);
  assert.equal(protocol.registration.global_registered_attempt_count, 118);
  assert.equal(
    protocol.artifact_binding.source_files_sha256[
      "research/external_validation_attempt115/runner.mjs"
    ],
    receipt.artifact_binding.frozen_runner_source_sha256,
  );
});

test("Attempt118 private evidence, when retained, exactly matches the public receipt", () => {
  const markerExists = existsSync(absolute(PRIVATE_MARKER_RELATIVE_PATH));
  const outputExists = existsSync(absolute(PRIVATE_OUTPUT_RELATIVE_PATH));
  if (!markerExists && !outputExists) return;
  assert.equal(markerExists, true, "retained Attempt118 evidence is missing its run marker");
  assert.equal(outputExists, true, "retained Attempt118 evidence is missing its output directory");

  const receipt = readJson(RECEIPT_RELATIVE_PATH);
  const markerBytes = readFileSync(absolute(PRIVATE_MARKER_RELATIVE_PATH));
  const marker = JSON.parse(markerBytes);
  assert.equal(markerBytes.byteLength, receipt.run_start_marker.byte_count);
  assert.equal(rawHash(markerBytes), receipt.run_start_marker.raw_bytes_sha256);
  assert.equal(
    marker.run_start_marker_sha256,
    semanticHash(marker, "run_start_marker_sha256"),
  );
  assert.equal(
    marker.run_start_marker_sha256,
    receipt.run_start_marker.run_start_marker_sha256,
  );
  assert.equal(marker.started_at, receipt.run_start_marker.started_at);
  assert.equal(marker.protocol_sha256, receipt.protocol_sha256);
  assert.equal(
    marker.artifact_set_sha256,
    receipt.artifact_binding.artifact_set_sha256,
  );

  const artifacts = receipt.artifact_binding.persisted_artifacts;
  const expectedNames = Object.values(artifacts).map(({ relative_path: path }) => (
    basename(path)
  )).sort();
  assert.deepEqual(readdirSync(absolute(PRIVATE_OUTPUT_RELATIVE_PATH)).sort(), expectedNames);
  for (const artifact of Object.values(artifacts)) {
    const path = absolute(artifact.relative_path);
    const status = lstatSync(path);
    assert.equal(status.isFile(), true, `${artifact.relative_path} is not a regular file`);
    assert.equal(status.isSymbolicLink(), false, `${artifact.relative_path} is a symbolic link`);
    const bytes = readFileSync(path);
    assert.equal(bytes.byteLength, artifact.byte_count);
    assert.equal(rawHash(bytes), artifact.raw_bytes_sha256);
  }
  assert.equal(
    existsSync(absolute(receipt.completion_state.run_receipt_relative_path)),
    false,
  );

  const acquisition = readJson(artifacts.acquisition_receipt.relative_path);
  assert.equal(
    acquisition.acquisition_receipt_sha256,
    semanticHash(acquisition, "acquisition_receipt_sha256"),
  );
  assert.equal(
    acquisition.acquisition_receipt_sha256,
    receipt.observed_outcome.acquisition_receipt_sha256,
  );
  assert.equal(acquisition.parsed_valid_row_count, receipt.observed_outcome.parsed_valid_row_count);
  assert.equal(acquisition.parsed_first_date, receipt.observed_outcome.parsed_first_date);
  assert.equal(acquisition.parsed_last_date, receipt.observed_outcome.parsed_last_date);
  assert.equal(
    acquisition.archive_raw_bytes_sha256,
    artifacts.source_archive.raw_bytes_sha256,
  );
  assert.equal(
    acquisition.selected_member_raw_bytes_sha256,
    artifacts.selected_source_member.raw_bytes_sha256,
  );
  assert.equal(
    acquisition.canonical_member_sha256,
    artifacts.canonical_daily_factors.raw_bytes_sha256,
  );
  assert.equal(
    acquisition.response_headers_sha256,
    artifacts.response_headers.raw_bytes_sha256,
  );

  const replay = readJson(artifacts.replay_grid.relative_path);
  assert.equal(replay.grid_sha256, semanticHash(replay, "grid_sha256"));
  assert.equal(replay.grid_sha256, receipt.observed_outcome.replay_grid_sha256);

  const evaluation = readJson(artifacts.evaluation.relative_path);
  assert.equal(evaluation.evaluation_sha256, semanticHash(evaluation, "evaluation_sha256"));
  assert.equal(evaluation.evaluation_sha256, receipt.observed_outcome.evaluation_sha256);
  assert.equal(evaluation.disposition, receipt.observed_outcome.evaluation_disposition);
  assert.equal(
    evaluation.all_nine_mechanism_gates_passed,
    receipt.observed_outcome.all_nine_mechanism_gates_passed,
  );
  assert.deepEqual(
    Object.entries(evaluation.gates)
      .filter(([, gate]) => gate.passed === false)
      .map(([name]) => name),
    receipt.observed_outcome.failed_mechanism_gates,
  );
  assert.equal(
    evaluation.acquisition_receipt.acquisition_receipt_sha256,
    receipt.observed_outcome.acquisition_receipt_sha256,
  );
  assert.equal(
    evaluation.replay_binding.grid_sha256,
    receipt.observed_outcome.replay_grid_sha256,
  );
});
