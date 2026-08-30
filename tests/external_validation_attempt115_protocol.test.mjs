import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXTERNAL_ATTEMPT115_ARTIFACT_PATHS,
  EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RAW_SHA256,
  EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH,
  EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RAW_SHA256,
  EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH,
  EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY,
  EXTERNAL_ATTEMPT115_EVALUATION_ID,
  EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
  EXTERNAL_ATTEMPT115_OVERLAP_START,
  EXTERNAL_ATTEMPT115_PRIMARY_END,
  EXTERNAL_ATTEMPT115_PROTOCOL_SCHEMA,
  EXTERNAL_ATTEMPT115_PROTOCOL_STATUS,
  EXTERNAL_ATTEMPT115_SOURCE_URL,
  canonicalExternalAttempt115ProtocolJson,
  createExternalAttempt115ProtocolBody,
  externalAttempt115ProtocolBody,
  hashExternalAttempt115Protocol,
  sealExternalAttempt115Protocol,
  validateExternalAttempt115Protocol,
  verifyExternalAttempt115ProtocolBytes,
} from "../research/external_validation_attempt115/protocol.mjs";

function independentStableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(independentStableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => (
    `${JSON.stringify(key)}:${independentStableStringify(item)}`
  )).join(",")}}`;
}

function independentHash(value) {
  return `sha256:${createHash("sha256").update(independentStableStringify(value)).digest("hex")}`;
}

function digestForPath(path) {
  if (path === EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH) {
    return EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RAW_SHA256;
  }
  if (path === EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH) {
    return EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RAW_SHA256;
  }
  return `sha256:${createHash("sha256").update(`synthetic:${path}`).digest("hex")}`;
}

function hashMap(paths) {
  return Object.fromEntries(paths.map((path) => [path, digestForPath(path)]));
}

function validBody() {
  return createExternalAttempt115ProtocolBody({
    frozenAt: "2026-08-30T12:34:56.000Z",
    sourceFilesSha256: hashMap(EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files),
    testFilesSha256: hashMap(EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files),
  });
}

function validProtocol() {
  return sealExternalAttempt115Protocol(validBody());
}

function rehash(protocol) {
  protocol.protocol_sha256 = independentHash(externalAttempt115ProtocolBody(protocol));
  return protocol;
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

test("external Attempt115 preregistration is canonical, self-hashed, and no-I/O", () => {
  const protocol = validProtocol();
  assert.equal(protocol.schema_version, EXTERNAL_ATTEMPT115_PROTOCOL_SCHEMA);
  assert.equal(protocol.evaluation_id, EXTERNAL_ATTEMPT115_EVALUATION_ID);
  assert.equal(protocol.status, EXTERNAL_ATTEMPT115_PROTOCOL_STATUS);
  assert.equal(protocol.protocol_sha256, independentHash(externalAttempt115ProtocolBody(protocol)));
  assert.equal(hashExternalAttempt115Protocol(protocol), protocol.protocol_sha256);
  assert.equal(protocol.source_freeze.official_archive_url, EXTERNAL_ATTEMPT115_SOURCE_URL);
  assert.equal(
    protocol.source_freeze.source_acquisition_state,
    "NOT_ACQUIRED_FOR_ATTEMPT_118",
  );
  assert.equal(protocol.source_freeze.network_or_file_io_performed_by_protocol_module, false);
  assert.equal(protocol.authority.protocol_module_network_access_authorized, false);
  assert.equal(protocol.authority.protocol_module_file_io_authorized, false);
  assert.equal(protocol.claim_boundary, EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY);
  assertDeepFrozen(protocol);

  const canonical = canonicalExternalAttempt115ProtocolJson(protocol);
  assert.equal(canonical.endsWith("\n"), true);
  assert.deepEqual(verifyExternalAttempt115ProtocolBytes(canonical), protocol);
  assert.deepEqual(verifyExternalAttempt115ProtocolBytes(Buffer.from(canonical)), protocol);
});

test("external Attempt115 freezes exact 253/254/255 chronology without a fabricated proxy point", () => {
  const protocol = validProtocol();
  const sample = protocol.sample_partition;
  assert.equal(sample.source_observation_ordinal_origin, 1);
  assert.equal(sample.warmup_valid_factor_observations, 253);
  assert.equal(sample.first_signal_observation_ordinal, 253);
  assert.equal(sample.first_rebalance_observation_ordinal, 254);
  assert.equal(sample.first_scored_outcome_observation_ordinal, 255);
  assert.equal(protocol.proxy_definition.fabricated_prior_proxy_point_permitted, false);
  assert.equal(
    protocol.execution_protocol.first_earned_return_timing,
    "the target rebalanced at observation t+1 first earns the observation t+1 to t+2 return",
  );
  assert.deepEqual(protocol.execution_protocol.initial_weights, {
    MARKET_PROXY: 0,
    RF_PROXY: 1,
  });
  assert.equal(protocol.execution_protocol.entry_cost_included, true);
  assert.equal(protocol.execution_protocol.terminal_liquidation.required, true);
  assert.equal(protocol.execution_protocol.terminal_liquidation.costed, true);
});

test("external Attempt115 pins the current revised French vintage rather than an immutable tape", () => {
  const source = validProtocol().source_freeze;
  assert.equal(source.expected_source_first_date, "1926-07-01");
  assert.equal(source.current_vintage_reconstructed_history, true);
  assert.equal(source.historical_returns_may_change_with_crsp_revisions, true);
  assert.equal(source.market_return_definition_changed_in_2012, true);
  assert.equal(source.daily_portfolio_treatment_changed_in_2015, true);
  assert.equal(source.current_us_returns_use_crsp_ciz_beginning, "2025-01");
  assert.equal(source.immutable_historical_tape_claim_permitted, false);
  assert.equal(source.source_acquisition_state, "NOT_ACQUIRED_FOR_ATTEMPT_118");
  assert.equal(source.attempt117_archive_downloaded_in_memory_before_attempt118_freeze, true);
  assert.equal(source.attempt117_factor_values_parsed, false);
  assert.equal(source.attempt117_performance_result_observed, false);
  assert.equal(
    source.archive_member_match_rule,
    "SINGLE_TRAVERSAL_SAFE_ASCII_BASENAME_WITH_ASCII_CASE_FOLD_EQUAL_TO_LOGICAL_MEMBER",
  );
  assert.equal(source.archive_member_path_components_permitted, false);
  assert.equal(source.archive_member_non_ascii_permitted, false);
  assert.match(source.vintage_binding, /acquired_at.*hashes define the tested current-provider vintage/iu);
  assert.match(EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY, /revised\/reconstructed factor-return proxies/iu);
  assert.match(EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY, /not an immutable historical tape/iu);
});

test("external Attempt115 freezes the sole pair, endpoint, bootstrap, and 118-attempt correction", () => {
  const protocol = validProtocol();
  assert.equal(EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT, 118);
  assert.deepEqual(protocol.policy_binding.sole_primary_pair, [
    "tsmom_ensemble_downside_semivol",
    "tsmom_ensemble_vol",
  ]);
  assert.equal(protocol.registration.candidate_count, 1);
  assert.equal(protocol.registration.packaging_only_successor_to_registered_attempt, 117);
  assert.equal(protocol.registration.attempt117_failure_receipt_bound_before_freeze, true);
  assert.equal(
    protocol.registration.global_registered_attempt_count,
    EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
  );
  assert.equal(
    protocol.primary_inference.sole_endpoint,
    "mean paired daily net log-return difference, challenger minus incumbent",
  );
  assert.equal(
    protocol.primary_inference.bootstrap.test,
    "one-sided null-centered stationary circular block bootstrap",
  );
  assert.equal(protocol.primary_inference.bootstrap.seed_uint32, 20260829);
  assert.equal(protocol.primary_inference.bootstrap.resamples, 4_999);
  assert.equal(protocol.primary_inference.bootstrap.expected_block_valid_observations, 20);
  assert.equal(protocol.primary_inference.bootstrap.restart_probability, 0.05);
  assert.equal(protocol.primary_inference.multiple_testing.per_test_threshold, 0.05 / 118);
  assert.deepEqual(
    protocol.primary_inference.multiple_testing.passing_attainable_raw_p_values,
    [0.0002, 0.0004],
  );
  const dsr = protocol.primary_inference.deflated_sharpe;
  assert.equal(dsr.input_series, "the sole primary paired daily net log-return difference series");
  assert.equal(
    dsr.sample_standard_deviation_convention,
    "square root of sum((x - mean(x))^2) / (n - 1)",
  );
  assert.equal(dsr.trial_sharpe_mean_periodic, 0);
  assert.equal(dsr.trial_sharpe_standard_deviation_periodic, "1 / sqrt(n - 1)");
  assert.equal(
    dsr.expected_maximum_coefficient_formula,
    "(1 - EulerGamma) * Phi^-1(1 - 1 / N) + EulerGamma * Phi^-1(1 - 1 / (N * e))",
  );
  assert.equal(dsr.euler_mascheroni_constant, 0.5772156649015329);
  assert.equal(dsr.probability_formula, "Phi(z_score)");
  assert.equal(dsr.minimum_probability, 0.95);
  assert.equal(dsr.degenerate_or_nonfinite_disposition, "GATE_FAILS_CLOSED");
  assert.match(dsr.calibration_assumption, /no outcome-derived.*moments may be substituted/iu);
  assert.equal(protocol.primary_inference.interim_or_repeat_inference_permitted, false);
});

test("Attempt118 binds the exact frozen Attempt117 protocol and failure receipt bytes", () => {
  const protocolBytes = readFileSync(EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH);
  const failureBytes = readFileSync(
    EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH,
  );
  const rawHash = (bytes) => (
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  );
  assert.equal(rawHash(protocolBytes), EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RAW_SHA256);
  assert.equal(
    rawHash(failureBytes),
    EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RAW_SHA256,
  );
  const receipt = JSON.parse(failureBytes);
  const receiptBody = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "failure_receipt_sha256"),
  );
  assert.equal(receipt.registered_attempt_number, 117);
  assert.equal(receipt.disposition, "ATTEMPT_117_CONSUMED_NO_RETRY");
  assert.equal(receipt.outcome_observation.factor_values_parsed, false);
  assert.equal(receipt.outcome_observation.performance_result_observed, false);
  assert.equal(receipt.failure_receipt_sha256, independentHash(receiptBody));
  const next = validProtocol();
  assert.equal(
    next.artifact_binding.source_files_sha256[
      EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH
    ],
    EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RAW_SHA256,
  );
  assert.equal(
    next.artifact_binding.source_files_sha256[
      EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH
    ],
    EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RAW_SHA256,
  );
  assert.equal(
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files.includes(
      "research/external_validation_attempt115/attempt118_frozen_protocol.json",
    ),
    false,
  );
});

test("Attempt118 changes only packaging acceptance and registered-trial accounting", () => {
  const prior = JSON.parse(readFileSync(
    EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH,
    "utf8",
  ));
  const next = validProtocol();
  const priorSource = structuredClone(prior.source_freeze);
  const nextSource = structuredClone(next.source_freeze);
  for (const key of [
    "archive_member_match_rule",
    "archive_member_path_components_permitted",
    "archive_member_non_ascii_permitted",
    "attempt117_frozen_protocol_relative_path",
    "attempt117_failure_receipt_relative_path",
    "attempt117_archive_downloaded_in_memory_before_attempt118_freeze",
    "attempt117_factor_values_parsed",
    "attempt117_performance_result_observed",
  ]) delete nextSource[key];
  nextSource.source_acquisition_state = priorSource.source_acquisition_state;
  assert.deepEqual(nextSource, priorSource, "source endpoints or data semantics changed");

  const priorRegistration = structuredClone(prior.registration);
  const nextRegistration = structuredClone(next.registration);
  for (const key of [
    "packaging_only_successor_to_registered_attempt",
    "attempt117_failure_receipt_bound_before_freeze",
    "only_member_matching_and_multiplicity_accounting_changed_from_attempt117",
  ]) delete nextRegistration[key];
  nextRegistration.registered_attempt_number = priorRegistration.registered_attempt_number;
  nextRegistration.prior_registered_attempt_count =
    priorRegistration.prior_registered_attempt_count;
  nextRegistration.global_registered_attempt_count =
    priorRegistration.global_registered_attempt_count;
  assert.deepEqual(
    nextRegistration,
    priorRegistration,
    "registration changed beyond one disclosed successor attempt",
  );

  for (const key of [
    "proxy_definition",
    "sample_partition",
    "policy_binding",
    "execution_protocol",
    "result_disposition",
    "authority",
    "claim_boundary",
  ]) {
    assert.deepEqual(next[key], prior[key], `${key} changed beyond the packaging repair`);
  }
  for (const key of [
    "partition_id",
    "challenger",
    "comparator",
    "cadence_anchor",
    "one_way_cost_bps",
    "sole_endpoint",
    "daily_value_formula",
    "null_hypothesis",
    "alternative_hypothesis",
    "bootstrap",
    "interim_or_repeat_inference_permitted",
  ]) {
    assert.deepEqual(
      next.primary_inference[key],
      prior.primary_inference[key],
      `primary_inference.${key} changed beyond multiplicity accounting`,
    );
  }
  const priorInference = structuredClone(prior.primary_inference);
  const nextInference = structuredClone(next.primary_inference);
  nextInference.multiple_testing.global_registered_attempt_count =
    priorInference.multiple_testing.global_registered_attempt_count;
  nextInference.multiple_testing.per_test_threshold =
    priorInference.multiple_testing.per_test_threshold;
  nextInference.deflated_sharpe.global_registered_attempt_count =
    priorInference.deflated_sharpe.global_registered_attempt_count;
  nextInference.deflated_sharpe.calibration_assumption =
    priorInference.deflated_sharpe.calibration_assumption;
  assert.deepEqual(
    nextInference,
    priorInference,
    "primary inference changed beyond 118-attempt multiplicity accounting",
  );
  const nextGates = structuredClone(next.mechanism_gates);
  const priorGates = structuredClone(prior.mechanism_gates);
  priorGates.statistical_evidence.bonferroni_raw_p_value_maximum =
    nextGates.statistical_evidence.bonferroni_raw_p_value_maximum;
  assert.deepEqual(nextGates, priorGates);
});

test("external Attempt115 makes pre-overlap primary and later overlap non-rescuing", () => {
  const partition = validProtocol().sample_partition;
  assert.equal(partition.primary_partition.last_scored_outcome_date_inclusive, EXTERNAL_ATTEMPT115_PRIMARY_END);
  assert.equal(partition.overlap_diagnostic.first_outcome_date_inclusive, EXTERNAL_ATTEMPT115_OVERLAP_START);
  assert.equal(
    partition.overlap_diagnostic.role,
    "DESCRIPTIVE_ONLY_CANNOT_RESCUE_OR_REVERSE_PRIMARY",
  );
  assert.equal(partition.diagnostics_can_rescue_primary, false);
  assert.equal(partition.alternate_start_or_end_date_permitted, false);
});

test("external Attempt115 requires every prespecified mechanism gate without outcome-dependent rescue", () => {
  const protocol = validProtocol();
  const gates = protocol.mechanism_gates;
  assert.deepEqual(gates.default_measurement_cell, {
    partition_id: "PRE_ETF_OVERLAP_EXTERNAL_MECHANISM",
    cadence_anchor: 0,
    one_way_cost_bps: 5,
  });
  assert.equal(gates.unqualified_metrics_use_default_measurement_cell, true);
  assert.equal(gates.primary_direction.operator, ">");
  assert.equal(gates.primary_direction.threshold, 0);
  assert.equal(gates.statistical_evidence.all_required, true);
  assert.equal(gates.statistical_evidence.nominal_bootstrap_p_value_maximum, 0.05);
  assert.equal(gates.statistical_evidence.bonferroni_raw_p_value_maximum, 0.05 / 118);
  assert.equal(gates.statistical_evidence.deflated_sharpe_probability_minimum, 0.95);
  assert.equal(gates.absolute_and_rf_proxy_performance.both_policies_positive_net_log_growth, true);
  assert.equal(gates.absolute_and_rf_proxy_performance.both_policies_beat_rf_proxy_net_log_growth, true);
  assert.deepEqual(gates.cost_stress.required_positive_edge_bps, [5, 10]);
  assert.equal(gates.cadence_robustness.anchor_zero_positive_required, true);
  assert.equal(gates.cadence_robustness.minimum_positive_anchors, 4);
  assert.deepEqual(gates.complete_decades.expected_complete_decade_start_years, [
    1930,
    1940,
    1950,
    1960,
    1970,
    1980,
    1990,
  ]);
  assert.equal(gates.complete_decades.minimum_complete_decade_count, 7);
  assert.equal(
    gates.complete_decades.decade_edge_formula,
    "sum of challenger-minus-incumbent paired daily net log-return differences whose outcome_observation_date falls within the calendar decade",
  );
  assert.equal(gates.complete_decades.zero_edge_counts_as_positive, false);
  assert.match(gates.complete_decades.complete_decade_eligibility_rule, /ten calendar years/iu);
  assert.match(gates.complete_decades.decade_edge_formula, /sum of challenger-minus-incumbent/iu);
  assert.equal(gates.complete_decades.minimum_positive_decade_share, 0.6);
  assert.equal(gates.drawdown_guardrail.maximum_worsening_percentage_points, 5);
  assert.equal(gates.volatility_guardrail.maximum_ratio, 1.1);
  assert.equal(gates.integrity.all_required, true);
  assert.equal(protocol.result_disposition.all_mechanism_gates_required, true);
  assert.equal(protocol.result_disposition.diagnostic_or_overlap_result_can_rescue, false);
  assert.equal(protocol.result_disposition.incumbent_policy_changes, false);
  assert.equal(protocol.result_disposition.public_claim_changes, false);
});

test("validator rejects independently re-hashed semantic weakening", () => {
  const mutations = [
    (value) => { value.registration.global_registered_attempt_count = 1; },
    (value) => { value.source_freeze.official_archive_url = "https://example.test/data.zip"; },
    (value) => { value.source_freeze.immutable_historical_tape_claim_permitted = true; },
    (value) => { value.proxy_definition.market_proxy_formula = "Mkt-RF / 100"; },
    (value) => { value.proxy_definition.fabricated_prior_proxy_point_permitted = true; },
    (value) => { value.sample_partition.warmup_valid_factor_observations = 252; },
    (value) => { value.sample_partition.first_scored_outcome_observation_ordinal = 254; },
    (value) => { value.sample_partition.primary_partition.last_scored_outcome_date_inclusive = "2026-08-28"; },
    (value) => { value.policy_binding.challenger.policy_id = "post_outcome_winner"; },
    (value) => { value.execution_protocol.first_earned_return_timing = "earn return at t+1"; },
    (value) => { value.execution_protocol.entry_cost_included = false; },
    (value) => { value.execution_protocol.terminal_liquidation.costed = false; },
    (value) => { value.primary_inference.sole_endpoint = "maximum total return"; },
    (value) => { value.primary_inference.bootstrap.nominal_alpha = 0.10; },
    (value) => { value.primary_inference.multiple_testing.per_test_threshold = 0.05; },
    (value) => { value.primary_inference.deflated_sharpe.input_series = "challenger returns"; },
    (value) => { value.primary_inference.deflated_sharpe.sample_standard_deviation_convention = "population"; },
    (value) => { value.primary_inference.deflated_sharpe.trial_sharpe_mean_periodic = -1; },
    (value) => { value.primary_inference.deflated_sharpe.trial_sharpe_standard_deviation_periodic = "fit from results"; },
    (value) => { value.primary_inference.deflated_sharpe.euler_mascheroni_constant = 0.57; },
    (value) => { value.primary_inference.deflated_sharpe.minimum_probability = 0.50; },
    (value) => { value.mechanism_gates.default_measurement_cell.one_way_cost_bps = 0; },
    (value) => { value.mechanism_gates.unqualified_metrics_use_default_measurement_cell = false; },
    (value) => { value.mechanism_gates.cadence_robustness.minimum_positive_anchors = 1; },
    (value) => { value.mechanism_gates.complete_decades.expected_complete_decade_start_years = [2000]; },
    (value) => { value.mechanism_gates.complete_decades.decade_edge_formula = "mean daily edge"; },
    (value) => { value.result_disposition.diagnostic_or_overlap_result_can_rescue = true; },
    (value) => { value.authority.public_performance_claim_authorized = true; },
  ];

  for (const mutate of mutations) {
    const changed = structuredClone(validProtocol());
    mutate(changed);
    rehash(changed);
    assert.throws(
      () => validateExternalAttempt115Protocol(changed),
      /changed|widened|boundary/iu,
    );
  }
});

test("validator rejects any claim that source data was acquired before freeze", () => {
  const changed = structuredClone(validProtocol());
  changed.source_freeze.source_acquisition_state = "ACQUIRED";
  changed.source_freeze.source_acquired_before_freeze = true;
  changed.source_freeze.source_values_observed_before_freeze = true;
  changed.source_freeze.source_archive_sha256 = digestForPath("archive");
  changed.source_freeze.source_member_sha256 = digestForPath("member");
  rehash(changed);
  assert.throws(
    () => validateExternalAttempt115Protocol(changed),
    /acquisition-after-freeze boundary changed/iu,
  );
});

test("validator rejects unknown fields at top level and inside nested controls", () => {
  const top = structuredClone(validProtocol());
  top.unregistered_result_override = true;
  rehash(top);
  assert.throws(
    () => validateExternalAttempt115Protocol(top),
    /must contain exactly/iu,
  );

  const nested = structuredClone(validProtocol());
  nested.mechanism_gates.primary_direction.pass_if_otherwise_impressive = true;
  rehash(nested);
  assert.throws(
    () => validateExternalAttempt115Protocol(nested),
    /must contain exactly/iu,
  );

  const sourceValue = structuredClone(validProtocol());
  sourceValue.source_freeze.observed_market_return = 0.42;
  rehash(sourceValue);
  assert.throws(
    () => validateExternalAttempt115Protocol(sourceValue),
    /must contain exactly/iu,
  );
});

test("validator rejects stale hashes, malformed artifact maps, and noncanonical bytes", () => {
  const stale = structuredClone(validProtocol());
  stale.frozen_at = "2026-08-30T12:35:00.000Z";
  assert.throws(
    () => validateExternalAttempt115Protocol(stale),
    /self-hash changed/iu,
  );

  const missingHash = structuredClone(validBody());
  delete missingHash.artifact_binding.source_files_sha256[
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files[0]
  ];
  assert.throws(
    () => sealExternalAttempt115Protocol(missingHash),
    /must contain exactly/iu,
  );

  const invalidHash = structuredClone(validBody());
  invalidHash.artifact_binding.test_files_sha256[
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files[0]
  ] = "sha256:not-a-digest";
  assert.throws(
    () => sealExternalAttempt115Protocol(invalidHash),
    /must be a sha256 digest/iu,
  );

  const protocol = validProtocol();
  const noncanonical = `${JSON.stringify(protocol, null, 4)}\n`;
  assert.throws(
    () => verifyExternalAttempt115ProtocolBytes(noncanonical),
    /not canonical/iu,
  );
});
