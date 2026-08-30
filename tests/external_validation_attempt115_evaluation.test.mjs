import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EXTERNAL_ATTEMPT115_ARTIFACT_PATHS,
  EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY,
  EXTERNAL_ATTEMPT115_EVALUATION_ID,
  createExternalAttempt115ProtocolBody,
  sealExternalAttempt115Protocol,
} from "../research/external_validation_attempt115/protocol.mjs";
import {
  EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA,
  EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
  hashExternalAttempt115AcquisitionReceipt,
} from "../research/external_validation_attempt115/acquisition.mjs";
import {
  canonicalizeKennethFrenchDailyFactorZipMember,
} from "../research/external_validation_attempt115/kenneth_french_daily_factor_adapter.mjs";
import { externalAttempt115Crc32 } from "../research/external_validation_attempt115/strict_zip.mjs";
import {
  EXTERNAL_ATTEMPT115_EVALUATION_SCHEMA,
  EXTERNAL_ATTEMPT115_GATE_NAMES,
  EXTERNAL_ATTEMPT115_INTEGRITY_CHECK_NAMES,
  canonicalExternalAttempt115EvaluationJson,
  evaluateExternalAttempt115,
  externalAttempt115DeflatedSharpe,
  hashExternalAttempt115Evaluation,
  validateExternalAttempt115Evaluation,
} from "../research/external_validation_attempt115/evaluation.mjs";

function rawDigest(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function uint16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function storedZip(member) {
  const name = new TextEncoder().encode(EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER);
  const crc = externalAttempt115Crc32(member);
  const local = concat(uint32(0x04034b50), uint16(20), uint16(0), uint16(0),
    uint16(0), uint16(0), uint32(crc), uint32(member.byteLength), uint32(member.byteLength),
    uint16(name.byteLength), uint16(0), name, member);
  const central = concat(uint32(0x02014b50), uint16(20), uint16(20), uint16(0), uint16(0),
    uint16(0), uint16(0), uint32(crc), uint32(member.byteLength), uint32(member.byteLength),
    uint16(name.byteLength), uint16(0), uint16(0), uint16(0), uint16(0), uint32(0),
    uint32(0), name);
  const end = concat(uint32(0x06054b50), uint16(0), uint16(0), uint16(1), uint16(1),
    uint32(central.byteLength), uint32(local.byteLength), uint16(0));
  return concat(local, central, end);
}

function hashMap(paths) {
  return Object.fromEntries(paths.map((path) => [path, rawDigest(path)]));
}

function protocolFixture() {
  return sealExternalAttempt115Protocol(createExternalAttempt115ProtocolBody({
    frozenAt: "2026-08-29T12:00:00.000Z",
    sourceFilesSha256: hashMap(EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files),
    testFilesSha256: hashMap(EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files),
  }));
}

function acquisitionFixture(protocol) {
  const archive = rawDigest("synthetic archive");
  const member = rawDigest("synthetic member");
  const body = {
    schema_version: EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA,
    evaluation_id: EXTERNAL_ATTEMPT115_EVALUATION_ID,
    protocol_sha256: protocol.protocol_sha256,
    source_data_acquired: true,
    acquired_at: "2026-08-30T12:00:00.000Z",
    official_archive_url:
      "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip",
    request: {
      method: "GET",
      redirects_permitted: false,
      credentials_sent: false,
      content_encoding_required: "identity",
    },
    source_vintage: {
      binding: "CURRENT_PROVIDER_VINTAGE_AT_ACQUISITION",
      acquired_at: "2026-08-30T12:00:00.000Z",
      archive_raw_bytes_sha256: archive,
      selected_member_raw_bytes_sha256: member,
    },
    archive_raw_bytes_sha256: archive,
    archive_raw_byte_count: 1000,
    response_headers_sha256: rawDigest("synthetic headers"),
    response_headers_byte_count: 100,
    selected_member_name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
    selected_member_raw_bytes_sha256: member,
    selected_member_raw_byte_count: 2000,
    canonical_member_sha256: rawDigest("synthetic canonical member"),
    canonical_member_byte_count: 1900,
    parsed_first_date: "1926-07-01",
    parsed_last_date: "2026-08-28",
    parsed_valid_row_count: 25_000,
    preserved_artifacts: {
      raw_archive: "source_archive.zip",
      normalized_response_headers: "response_headers.json",
      raw_selected_member: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
      canonical_selected_member: "canonical_daily_factors.csv",
      acquisition_receipt: "acquisition_receipt.json",
    },
    claim_boundary:
      "Source acquisition metadata only; this receipt contains no factor values, returns, positions, policy outputs, evaluation result, performance claim, or authorization.",
  };
  return { ...body, acquisition_receipt_sha256: hashExternalAttempt115AcquisitionReceipt(body) };
}

function provenanceInput({
  marketReturnPercent = (_date, index) => [-1, -1, 0.92, 0.92, 0.92][index % 5],
  omitYear = null,
  overlapReturnPercent = null,
} = {}) {
  const protocol = protocolFixture();
  const dates = [];
  let timestamp = Date.parse("1926-07-01T00:00:00.000Z");
  while (dates.length < 255) {
    const date = new Date(timestamp);
    if (date.getUTCDay() > 0 && date.getUTCDay() < 6) {
      dates.push(date.toISOString().slice(0, 10));
    }
    timestamp += 86_400_000;
  }
  for (let year = 1930; year <= 2006; year += 1) {
    if (year === omitYear) continue;
    for (let day = 1; day <= 12; day += 1) {
      dates.push(`${year}-01-${String(day).padStart(2, "0")}`);
    }
  }
  dates.push("2007-01-02", "2007-05-29", "2007-05-30", "2007-12-31", "2026-08-28");
  const rawMember = new TextEncoder().encode([
    "Invented Kenneth French-shaped source; no provider observations.",
    " , Mkt-RF, SMB, HML, RF",
    ...dates.map((date, index) => (
      `${date.replaceAll("-", "")},${(
        date >= "2007-05-30" && overlapReturnPercent !== null
          ? overlapReturnPercent(date, index)
          : marketReturnPercent(date, index)
      ).toFixed(8)},0,0,0.01`
    )),
  ].join("\n"));
  const canonicalBytes = new TextEncoder().encode(
    canonicalizeKennethFrenchDailyFactorZipMember(rawMember),
  );
  const archive = storedZip(rawMember);
  const receiptBody = {
    ...acquisitionFixture(protocol),
    archive_raw_bytes_sha256: rawDigest(archive),
    archive_raw_byte_count: archive.byteLength,
    selected_member_raw_bytes_sha256: rawDigest(rawMember),
    selected_member_raw_byte_count: rawMember.byteLength,
    canonical_member_sha256: rawDigest(canonicalBytes),
    canonical_member_byte_count: canonicalBytes.byteLength,
    parsed_first_date: dates[0],
    parsed_last_date: dates.at(-1),
    parsed_valid_row_count: dates.length,
  };
  receiptBody.source_vintage.archive_raw_bytes_sha256 = receiptBody.archive_raw_bytes_sha256;
  receiptBody.source_vintage.selected_member_raw_bytes_sha256
    = receiptBody.selected_member_raw_bytes_sha256;
  delete receiptBody.acquisition_receipt_sha256;
  const acquisitionReceipt = {
    ...receiptBody,
    acquisition_receipt_sha256: hashExternalAttempt115AcquisitionReceipt(receiptBody),
  };
  return {
    protocol,
    acquisitionReceipt,
    sourceBytes: { archive },
    artifactBytes: {
      source_files: Object.fromEntries(
        EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files.map((path) => [path, path]),
      ),
      test_files: Object.fromEntries(
        EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files.map((path) => [path, path]),
      ),
    },
  };
}

test("DSR uses N=117, sample SD, uncorrected skew, Pearson kurtosis, and fails closed", () => {
  const values = [0.001, 0.002, 0.004, 0.008, 0.016];
  const result = externalAttempt115DeflatedSharpe(values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const populationVariance = values.reduce((sum, value) => sum + (value - average) ** 2, 0)
    / values.length;
  const sampleDeviation = Math.sqrt(populationVariance * values.length / (values.length - 1));
  const skew = values.reduce((sum, value) => sum + (value - average) ** 3, 0)
    / values.length / populationVariance ** 1.5;
  const kurtosis = values.reduce((sum, value) => sum + (value - average) ** 4, 0)
    / values.length / populationVariance ** 2;
  assert.equal(result.global_registered_attempt_count, 117);
  assert.ok(Math.abs(result.sample_standard_deviation - sampleDeviation) < 1e-15);
  assert.ok(Math.abs(result.uncorrected_skewness - skew) < 1e-15);
  assert.ok(Math.abs(result.pearson_kurtosis - kurtosis) < 1e-15);
  const degenerate = externalAttempt115DeflatedSharpe(Array(50).fill(0.001));
  assert.equal(degenerate.passes_gate, false);
  assert.equal(degenerate.probability, null);
  assert.equal(degenerate.disposition, "GATE_FAILS_CLOSED");
});

test("receipt-bound fixtures cover pass and fail outcomes for every frozen gate", async () => {
  const passing = await evaluateExternalAttempt115(provenanceInput());
  assert.deepEqual(Object.keys(passing.gates), EXTERNAL_ATTEMPT115_GATE_NAMES);
  for (const name of EXTERNAL_ATTEMPT115_GATE_NAMES) {
    assert.equal(passing.gates[name].passed, true, `${name} pass fixture`);
  }
  assert.equal(passing.all_nine_mechanism_gates_passed, true);
  assert.equal(
    passing.disposition,
    "EXTERNAL_MECHANISM_PORTABILITY_ESTABLISHED_ON_FROZEN_FACTOR_PROXY_REPLAY",
  );
  assert.equal(passing.authority.public_claim_change_authorized, false);
  assert.equal(passing.authority.production_policy_mutation_authorized, false);
  assert.equal(passing.claim_boundary, EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY);

  const neutral = await evaluateExternalAttempt115(provenanceInput({
    marketReturnPercent: (_date, index) => 0.09 + 0.58 * Math.sin(index / 6.7),
  }));
  const absoluteFailure = await evaluateExternalAttempt115(provenanceInput({
    marketReturnPercent: () => -0.2,
  }));
  const incompleteDecade = await evaluateExternalAttempt115(provenanceInput({ omitYear: 1955 }));
  const crash = await evaluateExternalAttempt115(provenanceInput({
    marketReturnPercent: (date, index) => (
      date === "1970-01-10" ? -90 : [-1, -1, 0.92, 0.92, 0.92][index % 5]
    ),
  }));
  const highVolatilityRatio = await evaluateExternalAttempt115(provenanceInput({
    marketReturnPercent: (_date, index) => [-1, -1, 0.94, 0.94, 0.94][index % 5],
  }));
  const integrityInput = provenanceInput();
  integrityInput.artifactBytes.test_files[
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files[0]
  ] = "tampered artifact bytes";
  const integrityFailure = await evaluateExternalAttempt115(integrityInput);
  const failures = {
    primary_direction: neutral,
    statistical_evidence: neutral,
    absolute_and_rf_proxy_performance: absoluteFailure,
    cost_stress: neutral,
    cadence_robustness: neutral,
    complete_decades: incompleteDecade,
    drawdown_guardrail: crash,
    volatility_guardrail: highVolatilityRatio,
    integrity: integrityFailure,
  };
  for (const name of EXTERNAL_ATTEMPT115_GATE_NAMES) {
    assert.equal(failures[name].gates[name].passed, false, `${name} fail fixture`);
    assert.equal(failures[name].all_nine_mechanism_gates_passed, false, name);
    assert.equal(
      failures[name].disposition,
      "EXTERNAL_MECHANISM_PORTABILITY_NOT_ESTABLISHED",
      name,
    );
  }
});

test("complete-decade evidence uses exactly 1930-1990 and zero is not positive", async () => {
  const result = await evaluateExternalAttempt115(provenanceInput({
    marketReturnPercent: (date, index) => (
      date < "1940-01-01"
        ? 0.1 + 0.01 * Math.sin(index / 6.7)
        : [-1, -1, 0.92, 0.92, 0.92][index % 5]
    ),
  }));
  const evidence = result.gates.complete_decades.measurements;
  assert.deepEqual(evidence.expected_complete_decade_start_years, [
    1930, 1940, 1950, 1960, 1970, 1980, 1990,
  ]);
  assert.deepEqual(evidence.eligible_complete_decade_start_years, [
    1930, 1940, 1950, 1960, 1970, 1980, 1990,
  ]);
  assert.equal(evidence.minimum_complete_decade_count, 7);
  assert.match(evidence.decade_edge_formula, /outcome_observation_date/iu);
  assert.equal(evidence.zero_edge_counts_as_positive, false);
  const first = evidence.complete_decades.find((item) => item.decade === "1930s");
  assert.equal(first.challenger_minus_incumbent_net_log_growth, 0);
  assert.equal(evidence.positive_complete_decade_count, 6);
  assert.equal(evidence.positive_share, 6 / 7);
});

test("post-overlap observations cannot rescue or reverse primary gate results", async () => {
  const baseline = await evaluateExternalAttempt115(provenanceInput());
  const changedOverlap = await evaluateExternalAttempt115(provenanceInput({
    overlapReturnPercent: (_date, index) => (index % 2 === 0 ? -80 : 80),
  }));
  assert.deepEqual(changedOverlap.gates, baseline.gates);
  assert.equal(changedOverlap.replay_binding.overlap_is_descriptive_only_and_cannot_rescue, true);
  assert.notEqual(changedOverlap.replay_binding.grid_sha256, baseline.replay_binding.grid_sha256);
});

test("source-bound evaluation regenerates replay and rejects legacy booleans or source substitution", async () => {
  const input = provenanceInput();
  const result = await evaluateExternalAttempt115(input);
  assert.equal(result.schema_version, EXTERNAL_ATTEMPT115_EVALUATION_SCHEMA);
  assert.equal(result.claim_boundary, EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY);
  assert.equal(result.evaluation_sha256, hashExternalAttempt115Evaluation(result));
  assert.equal(result.gates.integrity.passed, true);
  assert.deepEqual(await validateExternalAttempt115Evaluation(result, input), result);
  await assert.rejects(
    () => validateExternalAttempt115Evaluation(result),
    /receipt-bound frozen inputs are required/iu,
  );
  assert.equal(canonicalExternalAttempt115EvaluationJson(result).endsWith("\n"), true);

  const hardcodedBooleans = { ...input, integrityChecks: Object.fromEntries(
    EXTERNAL_ATTEMPT115_INTEGRITY_CHECK_NAMES.map((name) => [name, true]),
  ) };
  await assert.rejects(() => evaluateExternalAttempt115(hardcodedBooleans), /must contain exactly/iu);
  await assert.rejects(
    () => evaluateExternalAttempt115({ ...input, replayGrid: {} }),
    /must contain exactly/iu,
  );

  const substituted = structuredClone(input);
  substituted.sourceBytes.archive[40] ^= 1;
  await assert.rejects(
    () => evaluateExternalAttempt115(substituted),
    /archive bytes do not match|ZIP/iu,
  );
});

test("semantic output tampering is rejected even after an attacker recomputes the hash", async () => {
  const input = provenanceInput();
  const result = await evaluateExternalAttempt115(input);
  const mutations = [
    (value) => { value.authority.public_claim_change_authorized = true; },
    (value) => { value.claim_boundary = "Policy and public claims may be promoted."; },
    (value) => { value.frozen_multiplicity.global_registered_attempt_count = 1; },
    (value) => {
      value.gates.primary_direction.measurements
        .mean_paired_daily_net_log_return_difference += 1;
    },
    (value) => { value.gates.cost_stress.passed = !value.gates.cost_stress.passed; },
    (value) => { value.disposition = "PROMOTE_CHALLENGER"; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(result);
    mutate(changed);
    changed.evaluation_sha256 = hashExternalAttempt115Evaluation(changed);
    await assert.rejects(
      () => validateExternalAttempt115Evaluation(changed, input),
      /changed|semantics|authority|reproduce/iu,
    );
  }
});
