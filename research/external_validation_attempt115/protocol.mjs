import { sha256 } from "../../lib/canonical.mjs";

export const EXTERNAL_ATTEMPT115_PROTOCOL_SCHEMA =
  "finly_attempt115_external_french_mechanism_protocol.v2";
export const EXTERNAL_ATTEMPT115_EVALUATION_ID =
  "finly_attempt115_french_century_mechanism_replay.v2";
export const EXTERNAL_ATTEMPT115_PROTOCOL_STATUS =
  "FROZEN_BEFORE_SOURCE_ACQUISITION";
export const EXTERNAL_ATTEMPT115_SOURCE_URL =
  "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip";
export const EXTERNAL_ATTEMPT115_PRIMARY_END = "2007-05-29";
export const EXTERNAL_ATTEMPT115_OVERLAP_START = "2007-05-30";
export const EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH =
  "research/external_validation_attempt115/frozen_protocol.json";
export const EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH =
  "research/external_validation_attempt115/attempt117_failure_receipt.json";
export const EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RAW_SHA256 =
  "sha256:29e467273c9d6a9c958da5cb0ce1621f04da4cad5c303773d61e5f7b005345eb";
export const EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RAW_SHA256 =
  "sha256:5a5c213ad4a218920ad6dba1a87d7bbd7676494383f98caec8e4434fd9b286e8";
// Attempt 117 was consumed by a preregistered packaging mismatch before parsing
// or evaluation. This packaging-only successor is the 118th disclosed attempt.
export const EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT = 118;
export const EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY =
  "External fixed-sample mechanism portability evidence only on the acquisition-date current Kenneth French vintage. MARKET_PROXY and RF_PROXY are revised/reconstructed factor-return proxies, not an immutable historical tape and not SPY or BIL ETF histories. This replay is retrospective, not a pristine holdout, and cannot establish future alpha, live profitability, options profitability, policy superiority, or competitor rank; authorize capital or broker activity; change the frozen incumbent; or modify any public, site, deck, paper, video, or release claim.";

export const EXTERNAL_ATTEMPT115_ARTIFACT_PATHS = Object.freeze({
  source_files: Object.freeze([
    "package.json",
    "package-lock.json",
    "lib/canonical.mjs",
    "lib/policy.mjs",
    "lib/quant.mjs",
    EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH,
    EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH,
    "research/external_validation_attempt115/protocol.mjs",
    "research/external_validation_attempt115/kenneth_french_daily_factor_adapter.mjs",
    "research/external_validation_attempt115/inference.mjs",
    "research/external_validation_attempt115/replay.mjs",
    "research/external_validation_attempt115/strict_zip.mjs",
    "research/external_validation_attempt115/acquisition.mjs",
    "research/external_validation_attempt115/official_transport.mjs",
    "research/external_validation_attempt115/evaluation.mjs",
    "research/external_validation_attempt115/runner.mjs",
    "research/external_validation_attempt115/run_once.mjs",
    "research/prospective_attempt115/protocol.mjs",
    "research/prospective_attempt115/policy.mjs",
  ]),
  test_files: Object.freeze([
    "tests/external_validation_attempt115_protocol.test.mjs",
    "tests/external_validation_attempt115_french_factor_adapter.test.mjs",
    "tests/external_validation_attempt115_inference.test.mjs",
    "tests/external_validation_attempt115_replay.test.mjs",
    "tests/external_validation_attempt115_strict_zip.test.mjs",
    "tests/external_validation_attempt115_acquisition.test.mjs",
    "tests/external_validation_attempt115_evaluation.test.mjs",
    "tests/external_validation_attempt115_runner.test.mjs",
  ]),
});

const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "evaluation_id",
  "status",
  "frozen_at",
  "registration",
  "source_freeze",
  "proxy_definition",
  "sample_partition",
  "policy_binding",
  "execution_protocol",
  "primary_inference",
  "mechanism_gates",
  "result_disposition",
  "authority",
  "artifact_binding",
  "claim_boundary",
  "protocol_sha256",
]);

const BODY_KEYS = Object.freeze(
  TOP_LEVEL_KEYS.filter((key) => key !== "protocol_sha256"),
);

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(`${label} changed`);
  }
}

function canonicalInstant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
}

function exactSha256Map(value, expectedPaths, label) {
  exactKeys(value, expectedPaths, label);
  for (const path of expectedPaths) {
    if (typeof value[path] !== "string" || !SHA256_PATTERN.test(value[path])) {
      fail(`${label}.${path} must be a sha256 digest`);
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function canonicalSort(value) {
  if (Array.isArray(value)) return value.map(canonicalSort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalSort(item)]),
  );
}

function validateRegistration(value) {
  exactKeys(value, [
    "registered_attempt_number",
    "prior_registered_attempt_count",
    "additional_registered_attempt_count",
    "global_registered_attempt_count",
    "candidate_count",
    "candidate_selected_before_external_outcomes",
    "external_replay_is_new_attempt",
    "repeat_or_replacement_primary_permitted",
    "packaging_only_successor_to_registered_attempt",
    "attempt117_failure_receipt_bound_before_freeze",
    "only_member_matching_and_multiplicity_accounting_changed_from_attempt117",
  ], "external Attempt115 registration");
  if (value.registered_attempt_number !== 118
    || value.prior_registered_attempt_count !== 117
    || value.additional_registered_attempt_count !== 1
    || value.global_registered_attempt_count !== EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT
    || value.candidate_count !== 1
    || value.candidate_selected_before_external_outcomes !== true
    || value.external_replay_is_new_attempt !== true
    || value.repeat_or_replacement_primary_permitted !== false
    || value.packaging_only_successor_to_registered_attempt !== 117
    || value.attempt117_failure_receipt_bound_before_freeze !== true
    || value.only_member_matching_and_multiplicity_accounting_changed_from_attempt117
      !== true) {
    fail("external Attempt115 registration or multiplicity boundary changed");
  }
}

function validateSourceFreeze(value) {
  exactKeys(value, [
    "provider",
    "dataset",
    "official_archive_url",
    "official_archive_member",
    "archive_member_match_rule",
    "archive_member_path_components_permitted",
    "archive_member_non_ascii_permitted",
    "attempt117_frozen_protocol_relative_path",
    "attempt117_failure_receipt_relative_path",
    "attempt117_archive_downloaded_in_memory_before_attempt118_freeze",
    "attempt117_factor_values_parsed",
    "attempt117_performance_result_observed",
    "official_data_library_documentation_url",
    "official_factor_description_url",
    "expected_source_first_date",
    "vintage_binding",
    "current_vintage_reconstructed_history",
    "historical_returns_may_change_with_crsp_revisions",
    "market_return_definition_changed_in_2012",
    "daily_portfolio_treatment_changed_in_2015",
    "current_us_returns_use_crsp_ciz_beginning",
    "immutable_historical_tape_claim_permitted",
    "source_acquisition_state",
    "source_acquired_before_freeze",
    "source_values_observed_before_freeze",
    "source_archive_sha256",
    "source_member_sha256",
    "acquisition_permitted_only_after_protocol_and_bound_artifacts_freeze",
    "acquisition_receipt_must_be_separate",
    "acquisition_receipt_required_fields",
    "network_or_file_io_performed_by_protocol_module",
  ], "external Attempt115 source freeze");
  if (value.provider !== "Kenneth R. French Data Library"
    || value.dataset !== "Fama/French 3 Factors daily"
    || value.official_archive_url !== EXTERNAL_ATTEMPT115_SOURCE_URL
    || value.official_archive_member !== "F-F_Research_Data_Factors_daily.CSV"
    || value.archive_member_match_rule
      !== "SINGLE_TRAVERSAL_SAFE_ASCII_BASENAME_WITH_ASCII_CASE_FOLD_EQUAL_TO_LOGICAL_MEMBER"
    || value.archive_member_path_components_permitted !== false
    || value.archive_member_non_ascii_permitted !== false
    || value.attempt117_frozen_protocol_relative_path
      !== EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH
    || value.attempt117_failure_receipt_relative_path
      !== EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH
    || value.attempt117_archive_downloaded_in_memory_before_attempt118_freeze !== true
    || value.attempt117_factor_values_parsed !== false
    || value.attempt117_performance_result_observed !== false
    || value.official_data_library_documentation_url
      !== "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.HTML"
    || value.official_factor_description_url
      !== "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library/f-f_factors.html"
    || value.expected_source_first_date !== "1926-07-01"
    || value.vintage_binding
      !== "The separate acquisition receipt's acquired_at and raw archive/member hashes define the tested current-provider vintage."
    || value.current_vintage_reconstructed_history !== true
    || value.historical_returns_may_change_with_crsp_revisions !== true
    || value.market_return_definition_changed_in_2012 !== true
    || value.daily_portfolio_treatment_changed_in_2015 !== true
    || value.current_us_returns_use_crsp_ciz_beginning !== "2025-01"
    || value.immutable_historical_tape_claim_permitted !== false
    || value.source_acquisition_state !== "NOT_ACQUIRED_FOR_ATTEMPT_118"
    || value.source_acquired_before_freeze !== false
    || value.source_values_observed_before_freeze !== false
    || value.source_archive_sha256 !== null
    || value.source_member_sha256 !== null
    || value.acquisition_permitted_only_after_protocol_and_bound_artifacts_freeze !== true
    || value.acquisition_receipt_must_be_separate !== true
    || value.network_or_file_io_performed_by_protocol_module !== false) {
    fail("external Attempt115 source identity or acquisition-after-freeze boundary changed");
  }
  exactArray(value.acquisition_receipt_required_fields, [
    "acquired_at",
    "official_archive_url",
    "archive_raw_bytes_sha256",
    "selected_member_name",
    "selected_member_raw_bytes_sha256",
    "parsed_first_date",
    "parsed_last_date",
    "parsed_valid_row_count",
  ], "external Attempt115 acquisition receipt fields");
}

function validateProxyDefinition(value) {
  exactKeys(value, [
    "source_columns",
    "source_return_units",
    "proxy_return_units",
    "market_proxy_label",
    "market_proxy_formula",
    "rf_proxy_label",
    "rf_proxy_formula",
    "policy_input_aliases",
    "aliases_are_internal_only",
    "fabricated_prior_proxy_point_permitted",
    "result_labels_must_remain",
  ], "external Attempt115 proxy definition");
  exactArray(
    value.source_columns,
    ["date", "Mkt-RF", "SMB", "HML", "RF"],
    "external Attempt115 source columns",
  );
  exactKeys(value.policy_input_aliases, ["SPY", "BIL"], "external Attempt115 policy aliases");
  exactArray(
    value.result_labels_must_remain,
    ["MARKET_PROXY", "RF_PROXY"],
    "external Attempt115 result labels",
  );
  if (value.source_return_units !== "percent"
    || value.proxy_return_units !== "decimal"
    || value.market_proxy_label !== "MARKET_PROXY"
    || value.market_proxy_formula !== "(Mkt-RF + RF) / 100"
    || value.rf_proxy_label !== "RF_PROXY"
    || value.rf_proxy_formula !== "RF / 100"
    || value.policy_input_aliases.SPY !== "MARKET_PROXY"
    || value.policy_input_aliases.BIL !== "RF_PROXY"
    || value.aliases_are_internal_only !== true
    || value.fabricated_prior_proxy_point_permitted !== false) {
    fail("external Attempt115 proxy transform, labels, or no-fabrication rule changed");
  }
}

function validateSamplePartition(value) {
  exactKeys(value, [
    "source_observation_ordinal_origin",
    "warmup_valid_factor_observations",
    "first_signal_observation_ordinal",
    "first_rebalance_observation_ordinal",
    "first_scored_outcome_observation_ordinal",
    "primary_partition",
    "overlap_diagnostic",
    "diagnostics_can_rescue_primary",
    "alternate_start_or_end_date_permitted",
  ], "external Attempt115 sample partition");
  exactKeys(value.primary_partition, [
    "id",
    "first_scored_outcome",
    "last_scored_outcome_date_inclusive",
    "date_field",
  ], "external Attempt115 primary partition");
  exactKeys(value.overlap_diagnostic, [
    "id",
    "first_outcome_date_inclusive",
    "last_outcome_date_inclusive",
    "role",
  ], "external Attempt115 overlap diagnostic");
  if (value.source_observation_ordinal_origin !== 1
    || value.warmup_valid_factor_observations !== 253
    || value.first_signal_observation_ordinal !== 253
    || value.first_rebalance_observation_ordinal !== 254
    || value.first_scored_outcome_observation_ordinal !== 255
    || value.primary_partition.id !== "PRE_ETF_OVERLAP_EXTERNAL_MECHANISM"
    || value.primary_partition.first_scored_outcome !== "VALID_FACTOR_OBSERVATION_255"
    || value.primary_partition.last_scored_outcome_date_inclusive
      !== EXTERNAL_ATTEMPT115_PRIMARY_END
    || value.primary_partition.date_field !== "outcome_observation_date"
    || value.overlap_diagnostic.id !== "POST_2007_OVERLAP_DIAGNOSTIC"
    || value.overlap_diagnostic.first_outcome_date_inclusive
      !== EXTERNAL_ATTEMPT115_OVERLAP_START
    || value.overlap_diagnostic.last_outcome_date_inclusive !== "SOURCE_LAST_VALID_DATE"
    || value.overlap_diagnostic.role !== "DESCRIPTIVE_ONLY_CANNOT_RESCUE_OR_REVERSE_PRIMARY"
    || value.diagnostics_can_rescue_primary !== false
    || value.alternate_start_or_end_date_permitted !== false) {
    fail("external Attempt115 warmup, scoring, or partition boundary changed");
  }
}

function validatePolicyBinding(value) {
  exactKeys(value, [
    "incumbent",
    "challenger",
    "sole_primary_pair",
    "additional_policy_or_parameter_variant_permitted",
    "policy_mutation_after_freeze_permitted",
  ], "external Attempt115 policy binding");
  exactKeys(value.incumbent, ["policy_id", "role"], "external Attempt115 incumbent");
  exactKeys(value.challenger, ["policy_id", "role"], "external Attempt115 challenger");
  exactArray(value.sole_primary_pair, [
    "tsmom_ensemble_downside_semivol",
    "tsmom_ensemble_vol",
  ], "external Attempt115 sole primary pair");
  if (value.incumbent.policy_id !== "tsmom_ensemble_vol"
    || value.incumbent.role !== "FROZEN_ATTEMPT115_INCUMBENT"
    || value.challenger.policy_id !== "tsmom_ensemble_downside_semivol"
    || value.challenger.role !== "SOLE_FROZEN_CHALLENGER"
    || value.additional_policy_or_parameter_variant_permitted !== false
    || value.policy_mutation_after_freeze_permitted !== false) {
    fail("external Attempt115 sole challenger or incumbent binding changed");
  }
}

function validateExecutionProtocol(value) {
  exactKeys(value, [
    "signal_timing",
    "target_timing",
    "rebalance_timing",
    "first_earned_return_timing",
    "rebalance_interval_valid_observations",
    "primary_cadence_anchor",
    "cadence_sensitivity_anchors",
    "initial_weights",
    "holdings_drift_between_rebalances",
    "one_way_cost_bps_primary",
    "one_way_cost_bps_sensitivities",
    "turnover_definition",
    "cost_formula",
    "entry_cost_included",
    "terminal_liquidation",
    "same_dates_costs_anchors_and_partition_required_for_both_policies",
  ], "external Attempt115 execution protocol");
  exactKeys(value.initial_weights, ["MARKET_PROXY", "RF_PROXY"], "external Attempt115 initial weights");
  exactArray(value.cadence_sensitivity_anchors, [0, 1, 2, 3, 4], "external Attempt115 anchors");
  exactArray(value.one_way_cost_bps_sensitivities, [1, 10, 25], "external Attempt115 cost sensitivities");
  exactKeys(value.terminal_liquidation, [
    "required",
    "target_weights",
    "costed",
  ], "external Attempt115 terminal liquidation");
  exactKeys(
    value.terminal_liquidation.target_weights,
    ["MARKET_PROXY", "RF_PROXY"],
    "external Attempt115 terminal target weights",
  );
  if (value.signal_timing !== "observe proxy levels through factor observation t close only"
    || value.target_timing !== "derive both frozen policy targets after factor observation t close"
    || value.rebalance_timing !== "rebalance at factor observation t+1 close"
    || value.first_earned_return_timing
      !== "the target rebalanced at observation t+1 first earns the observation t+1 to t+2 return"
    || value.rebalance_interval_valid_observations !== 5
    || value.primary_cadence_anchor !== 0
    || value.initial_weights.MARKET_PROXY !== 0
    || value.initial_weights.RF_PROXY !== 1
    || value.holdings_drift_between_rebalances !== true
    || value.one_way_cost_bps_primary !== 5
    || value.turnover_definition
      !== "abs(target_MARKET_PROXY - drifted_MARKET_PROXY) + abs(target_RF_PROXY - drifted_RF_PROXY)"
    || value.cost_formula !== "turnover * one_way_cost_bps / 10000"
    || value.entry_cost_included !== true
    || value.terminal_liquidation.required !== true
    || value.terminal_liquidation.target_weights.MARKET_PROXY !== 0
    || value.terminal_liquidation.target_weights.RF_PROXY !== 1
    || value.terminal_liquidation.costed !== true
    || value.same_dates_costs_anchors_and_partition_required_for_both_policies !== true) {
    fail("external Attempt115 timing, cadence, state, or cost accounting changed");
  }
}

function validatePrimaryInference(value) {
  exactKeys(value, [
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
    "multiple_testing",
    "deflated_sharpe",
    "interim_or_repeat_inference_permitted",
  ], "external Attempt115 primary inference");
  exactKeys(value.bootstrap, [
    "test",
    "null_centered",
    "circular",
    "seed_uint32",
    "resamples",
    "expected_block_valid_observations",
    "restart_probability",
    "p_value_formula",
    "equality_counts_as_exceedance",
    "nominal_alpha",
  ], "external Attempt115 bootstrap");
  exactKeys(value.multiple_testing, [
    "method",
    "global_registered_attempt_count",
    "familywise_alpha",
    "per_test_threshold",
    "minimum_attainable_raw_p_value",
    "passing_attainable_raw_p_values",
  ], "external Attempt115 multiple-testing correction");
  exactKeys(value.deflated_sharpe, [
    "required",
    "method",
    "input_series",
    "observed_periodic_sharpe",
    "sample_standard_deviation_convention",
    "skewness_convention",
    "pearson_kurtosis_convention",
    "global_registered_attempt_count",
    "trial_sharpe_mean_periodic",
    "trial_sharpe_standard_deviation_periodic",
    "expected_maximum_coefficient_formula",
    "euler_mascheroni_constant",
    "deflated_benchmark_sharpe_formula",
    "non_normality_variance_factor_formula",
    "z_score_formula",
    "probability_formula",
    "minimum_probability",
    "degenerate_or_nonfinite_disposition",
    "calibration_assumption",
  ], "external Attempt115 deflated Sharpe gate");
  exactArray(
    value.multiple_testing.passing_attainable_raw_p_values,
    [0.0002, 0.0004],
    "external Attempt115 passing attainable p-values",
  );
  if (value.partition_id !== "PRE_ETF_OVERLAP_EXTERNAL_MECHANISM"
    || value.challenger !== "tsmom_ensemble_downside_semivol"
    || value.comparator !== "tsmom_ensemble_vol"
    || value.cadence_anchor !== 0
    || value.one_way_cost_bps !== 5
    || value.sole_endpoint !== "mean paired daily net log-return difference, challenger minus incumbent"
    || value.daily_value_formula
      !== "log1p(challenger_net_simple_return) - log1p(incumbent_net_simple_return)"
    || value.null_hypothesis !== "mean paired daily net log-return difference <= 0"
    || value.alternative_hypothesis !== "mean paired daily net log-return difference > 0"
    || value.bootstrap.test !== "one-sided null-centered stationary circular block bootstrap"
    || value.bootstrap.null_centered !== true
    || value.bootstrap.circular !== true
    || value.bootstrap.seed_uint32 !== 20260829
    || value.bootstrap.resamples !== 4_999
    || value.bootstrap.expected_block_valid_observations !== 20
    || value.bootstrap.restart_probability !== 0.05
    || value.bootstrap.p_value_formula !== "(1 + exceedances) / 5000"
    || value.bootstrap.equality_counts_as_exceedance !== true
    || value.bootstrap.nominal_alpha !== 0.05
    || value.multiple_testing.method !== "Bonferroni"
    || value.multiple_testing.global_registered_attempt_count
      !== EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT
    || value.multiple_testing.familywise_alpha !== 0.05
    || value.multiple_testing.per_test_threshold
      !== 0.05 / EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT
    || value.multiple_testing.minimum_attainable_raw_p_value !== 1 / 5000
    || value.deflated_sharpe.required !== true
    || value.deflated_sharpe.method
      !== "Bailey-Lopez de Prado deflated Sharpe probability with a preregistered independent-null-trial benchmark"
    || value.deflated_sharpe.input_series
      !== "the sole primary paired daily net log-return difference series"
    || value.deflated_sharpe.observed_periodic_sharpe
      !== "sample_mean(input_series) / sample_standard_deviation(input_series)"
    || value.deflated_sharpe.sample_standard_deviation_convention
      !== "square root of sum((x - mean(x))^2) / (n - 1)"
    || value.deflated_sharpe.skewness_convention
      !== "uncorrected third central moment divided by population_variance^(3/2), each central moment using denominator n"
    || value.deflated_sharpe.pearson_kurtosis_convention
      !== "uncorrected fourth central moment divided by population_variance^2, each central moment using denominator n; not excess kurtosis"
    || value.deflated_sharpe.global_registered_attempt_count
      !== EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT
    || value.deflated_sharpe.trial_sharpe_mean_periodic !== 0
    || value.deflated_sharpe.trial_sharpe_standard_deviation_periodic !== "1 / sqrt(n - 1)"
    || value.deflated_sharpe.expected_maximum_coefficient_formula
      !== "(1 - EulerGamma) * Phi^-1(1 - 1 / N) + EulerGamma * Phi^-1(1 - 1 / (N * e))"
    || value.deflated_sharpe.euler_mascheroni_constant !== 0.5772156649015329
    || value.deflated_sharpe.deflated_benchmark_sharpe_formula
      !== "0 + (1 / sqrt(n - 1)) * expected_maximum_coefficient"
    || value.deflated_sharpe.non_normality_variance_factor_formula
      !== "1 - skewness * observed_SR + ((Pearson_kurtosis - 1) / 4) * observed_SR^2"
    || value.deflated_sharpe.z_score_formula
      !== "(observed_SR - deflated_benchmark_SR) * sqrt(n - 1) / sqrt(non_normality_variance_factor)"
    || value.deflated_sharpe.probability_formula !== "Phi(z_score)"
    || value.deflated_sharpe.minimum_probability !== 0.95
    || value.deflated_sharpe.degenerate_or_nonfinite_disposition !== "GATE_FAILS_CLOSED"
    || value.deflated_sharpe.calibration_assumption
      !== "All N=118 registered trials are treated as independent draws from a zero-mean unit-variance normal-return null solely to predeclare the expected-maximum Sharpe benchmark; no outcome-derived cross-strategy Sharpe moments may be substituted."
    || value.interim_or_repeat_inference_permitted !== false) {
    fail("external Attempt115 endpoint, bootstrap, or multiple-testing plan changed");
  }
}

function validateMechanismGates(value) {
  exactKeys(value, [
    "default_measurement_cell",
    "unqualified_metrics_use_default_measurement_cell",
    "primary_direction",
    "statistical_evidence",
    "absolute_and_rf_proxy_performance",
    "cost_stress",
    "cadence_robustness",
    "complete_decades",
    "drawdown_guardrail",
    "volatility_guardrail",
    "integrity",
  ], "external Attempt115 mechanism gates");
  exactKeys(value.default_measurement_cell, [
    "partition_id",
    "cadence_anchor",
    "one_way_cost_bps",
  ], "mechanism-gate default cell");
  exactKeys(value.primary_direction, ["metric", "operator", "threshold"], "primary direction gate");
  exactKeys(value.statistical_evidence, [
    "nominal_bootstrap_p_value_maximum",
    "bonferroni_raw_p_value_maximum",
    "deflated_sharpe_probability_minimum",
    "all_required",
  ], "statistical evidence gate");
  exactKeys(value.absolute_and_rf_proxy_performance, [
    "both_policies_positive_net_log_growth",
    "both_policies_beat_rf_proxy_net_log_growth",
  ], "absolute and RF proxy gate");
  exactKeys(value.cost_stress, ["required_positive_edge_bps", "metric"], "cost stress gate");
  exactKeys(value.cadence_robustness, [
    "anchor_zero_positive_required",
    "minimum_positive_anchors",
    "anchors_evaluated",
    "cost_bps",
  ], "cadence robustness gate");
  exactKeys(value.complete_decades, [
    "incomplete_decades_excluded",
    "calendar_decade_definition",
    "complete_decade_eligibility_rule",
    "expected_complete_decade_start_years",
    "minimum_complete_decade_count",
    "decade_edge_formula",
    "zero_edge_counts_as_positive",
    "median_challenger_minus_incumbent_edge_operator",
    "median_challenger_minus_incumbent_edge_threshold",
    "minimum_positive_decade_share",
  ], "complete-decades gate");
  exactKeys(value.drawdown_guardrail, ["formula", "maximum_worsening_percentage_points"], "drawdown gate");
  exactKeys(value.volatility_guardrail, ["formula", "maximum_ratio"], "volatility gate");
  exactKeys(value.integrity, ["all_required", "required_checks"], "integrity gate");
  exactArray(value.cost_stress.required_positive_edge_bps, [5, 10], "cost-stress cells");
  exactArray(value.cadence_robustness.anchors_evaluated, [0, 1, 2, 3, 4], "cadence-gate anchors");
  exactArray(
    value.complete_decades.expected_complete_decade_start_years,
    [1930, 1940, 1950, 1960, 1970, 1980, 1990],
    "complete-decade start years",
  );
  exactArray(value.integrity.required_checks, [
    "protocol_self_hash",
    "artifact_hash_binding",
    "official_source_identity_and_receipt",
    "strict_parser_schema_and_row_order",
    "source_transform_identity",
    "warmup_signal_rebalance_outcome_chronology",
    "future_observation_mutation_invariance",
    "cost_monotonicity_and_exact_entry_cost",
    "exact_terminal_liquidation",
  ], "integrity checks");
  if (value.default_measurement_cell.partition_id !== "PRE_ETF_OVERLAP_EXTERNAL_MECHANISM"
    || value.default_measurement_cell.cadence_anchor !== 0
    || value.default_measurement_cell.one_way_cost_bps !== 5
    || value.unqualified_metrics_use_default_measurement_cell !== true
    || value.primary_direction.metric !== "primary mean paired daily net log-return difference"
    || value.primary_direction.operator !== ">"
    || value.primary_direction.threshold !== 0
    || value.statistical_evidence.nominal_bootstrap_p_value_maximum !== 0.05
    || value.statistical_evidence.bonferroni_raw_p_value_maximum
      !== 0.05 / EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT
    || value.statistical_evidence.deflated_sharpe_probability_minimum !== 0.95
    || value.statistical_evidence.all_required !== true
    || value.absolute_and_rf_proxy_performance.both_policies_positive_net_log_growth !== true
    || value.absolute_and_rf_proxy_performance.both_policies_beat_rf_proxy_net_log_growth !== true
    || value.cost_stress.metric !== "paired net log-return edge, challenger minus incumbent"
    || value.cadence_robustness.anchor_zero_positive_required !== true
    || value.cadence_robustness.minimum_positive_anchors !== 4
    || value.cadence_robustness.cost_bps !== 5
    || value.complete_decades.incomplete_decades_excluded !== true
    || value.complete_decades.calendar_decade_definition
      !== "UTC calendar years YYYY0 through YYYY9 inclusive"
    || value.complete_decades.complete_decade_eligibility_rule
      !== "the primary partition starts on or before YYYY0-01-01, ends on or after YYYY9-12-31, and contains at least one outcome observation in each of the ten calendar years"
    || value.complete_decades.minimum_complete_decade_count !== 7
    || value.complete_decades.decade_edge_formula
      !== "sum of challenger-minus-incumbent paired daily net log-return differences whose outcome_observation_date falls within the calendar decade"
    || value.complete_decades.zero_edge_counts_as_positive !== false
    || value.complete_decades.median_challenger_minus_incumbent_edge_operator !== ">"
    || value.complete_decades.median_challenger_minus_incumbent_edge_threshold !== 0
    || value.complete_decades.minimum_positive_decade_share !== 0.6
    || value.drawdown_guardrail.formula
      !== "challenger_maximum_drawdown >= incumbent_maximum_drawdown - 0.05"
    || value.drawdown_guardrail.maximum_worsening_percentage_points !== 5
    || value.volatility_guardrail.formula
      !== "challenger_annualized_volatility <= 1.10 * incumbent_annualized_volatility"
    || value.volatility_guardrail.maximum_ratio !== 1.1
    || value.integrity.all_required !== true) {
    fail("external Attempt115 mechanism pass gates changed");
  }
}

function validateResultDisposition(value) {
  exactKeys(value, [
    "all_mechanism_gates_required",
    "any_failure_disposition",
    "pass_label",
    "pass_supports_only",
    "diagnostic_or_overlap_result_can_rescue",
    "incumbent_policy_changes",
    "public_claim_changes",
  ], "external Attempt115 result disposition");
  if (value.all_mechanism_gates_required !== true
    || value.any_failure_disposition !== "EXTERNAL_MECHANISM_PORTABILITY_NOT_ESTABLISHED"
    || value.pass_label !== "EXTERNAL_MECHANISM_PORTABILITY_ESTABLISHED_ON_FROZEN_FACTOR_PROXY_REPLAY"
    || value.pass_supports_only
      !== "The sole frozen challenger mechanism ported to an external factor-return proxy under the preregistered replay."
    || value.diagnostic_or_overlap_result_can_rescue !== false
    || value.incumbent_policy_changes !== false
    || value.public_claim_changes !== false) {
    fail("external Attempt115 result disposition or claim role changed");
  }
}

function validateAuthority(value) {
  exactKeys(value, [
    "research_only",
    "protocol_module_network_access_authorized",
    "protocol_module_file_io_authorized",
    "broker_reads_authorized",
    "broker_mutation_authorized",
    "orders_authorized",
    "capital_authorized",
    "production_policy_mutation_authorized",
    "site_or_release_mutation_authorized",
    "public_performance_claim_authorized",
  ], "external Attempt115 authority");
  if (value.research_only !== true
    || Object.entries(value)
      .filter(([key]) => key !== "research_only")
      .some(([, permission]) => permission !== false)) {
    fail("external Attempt115 protocol authority widened");
  }
}

function validateArtifactBinding(value) {
  exactKeys(value, [
    "hashes_computed_before_source_acquisition",
    "source_files_sha256",
    "test_files_sha256",
  ], "external Attempt115 artifact binding");
  if (value.hashes_computed_before_source_acquisition !== true) {
    fail("external Attempt115 artifact hashes must precede source acquisition");
  }
  exactSha256Map(
    value.source_files_sha256,
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files,
    "external Attempt115 source file hashes",
  );
  exactSha256Map(
    value.test_files_sha256,
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files,
    "external Attempt115 test file hashes",
  );
  if (value.source_files_sha256[EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH]
      !== EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RAW_SHA256
    || value.source_files_sha256[
      EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH
    ] !== EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RAW_SHA256) {
    fail("external Attempt115 predecessor protocol or failure receipt binding changed");
  }
}

function validateSemantics(value, includeHash) {
  exactKeys(value, includeHash ? TOP_LEVEL_KEYS : BODY_KEYS, "external Attempt115 protocol");
  if (value.schema_version !== EXTERNAL_ATTEMPT115_PROTOCOL_SCHEMA
    || value.evaluation_id !== EXTERNAL_ATTEMPT115_EVALUATION_ID
    || value.status !== EXTERNAL_ATTEMPT115_PROTOCOL_STATUS) {
    fail("external Attempt115 protocol envelope changed");
  }
  canonicalInstant(value.frozen_at, "external Attempt115 frozen_at");
  validateRegistration(value.registration);
  validateSourceFreeze(value.source_freeze);
  validateProxyDefinition(value.proxy_definition);
  validateSamplePartition(value.sample_partition);
  validatePolicyBinding(value.policy_binding);
  validateExecutionProtocol(value.execution_protocol);
  validatePrimaryInference(value.primary_inference);
  validateMechanismGates(value.mechanism_gates);
  validateResultDisposition(value.result_disposition);
  validateAuthority(value.authority);
  validateArtifactBinding(value.artifact_binding);
  if (value.claim_boundary !== EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY) {
    fail("external Attempt115 claim boundary changed");
  }
}

/**
 * Construct the exact semantic preregistration body after the caller has
 * computed the frozen artifact hashes, but before any provider data is read.
 */
export function createExternalAttempt115ProtocolBody({
  frozenAt,
  sourceFilesSha256,
  testFilesSha256,
}) {
  const body = {
    schema_version: EXTERNAL_ATTEMPT115_PROTOCOL_SCHEMA,
    evaluation_id: EXTERNAL_ATTEMPT115_EVALUATION_ID,
    status: EXTERNAL_ATTEMPT115_PROTOCOL_STATUS,
    frozen_at: frozenAt,
    registration: {
      registered_attempt_number: 118,
      prior_registered_attempt_count: 117,
      additional_registered_attempt_count: 1,
      global_registered_attempt_count: EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
      candidate_count: 1,
      candidate_selected_before_external_outcomes: true,
      external_replay_is_new_attempt: true,
      repeat_or_replacement_primary_permitted: false,
      packaging_only_successor_to_registered_attempt: 117,
      attempt117_failure_receipt_bound_before_freeze: true,
      only_member_matching_and_multiplicity_accounting_changed_from_attempt117: true,
    },
    source_freeze: {
      provider: "Kenneth R. French Data Library",
      dataset: "Fama/French 3 Factors daily",
      official_archive_url: EXTERNAL_ATTEMPT115_SOURCE_URL,
      official_archive_member: "F-F_Research_Data_Factors_daily.CSV",
      archive_member_match_rule:
        "SINGLE_TRAVERSAL_SAFE_ASCII_BASENAME_WITH_ASCII_CASE_FOLD_EQUAL_TO_LOGICAL_MEMBER",
      archive_member_path_components_permitted: false,
      archive_member_non_ascii_permitted: false,
      attempt117_frozen_protocol_relative_path:
        EXTERNAL_ATTEMPT115_ATTEMPT117_PROTOCOL_RELATIVE_PATH,
      attempt117_failure_receipt_relative_path:
        EXTERNAL_ATTEMPT115_ATTEMPT117_FAILURE_RECEIPT_RELATIVE_PATH,
      attempt117_archive_downloaded_in_memory_before_attempt118_freeze: true,
      attempt117_factor_values_parsed: false,
      attempt117_performance_result_observed: false,
      official_data_library_documentation_url:
        "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.HTML",
      official_factor_description_url:
        "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library/f-f_factors.html",
      expected_source_first_date: "1926-07-01",
      vintage_binding:
        "The separate acquisition receipt's acquired_at and raw archive/member hashes define the tested current-provider vintage.",
      current_vintage_reconstructed_history: true,
      historical_returns_may_change_with_crsp_revisions: true,
      market_return_definition_changed_in_2012: true,
      daily_portfolio_treatment_changed_in_2015: true,
      current_us_returns_use_crsp_ciz_beginning: "2025-01",
      immutable_historical_tape_claim_permitted: false,
      source_acquisition_state: "NOT_ACQUIRED_FOR_ATTEMPT_118",
      source_acquired_before_freeze: false,
      source_values_observed_before_freeze: false,
      source_archive_sha256: null,
      source_member_sha256: null,
      acquisition_permitted_only_after_protocol_and_bound_artifacts_freeze: true,
      acquisition_receipt_must_be_separate: true,
      acquisition_receipt_required_fields: [
        "acquired_at",
        "official_archive_url",
        "archive_raw_bytes_sha256",
        "selected_member_name",
        "selected_member_raw_bytes_sha256",
        "parsed_first_date",
        "parsed_last_date",
        "parsed_valid_row_count",
      ],
      network_or_file_io_performed_by_protocol_module: false,
    },
    proxy_definition: {
      source_columns: ["date", "Mkt-RF", "SMB", "HML", "RF"],
      source_return_units: "percent",
      proxy_return_units: "decimal",
      market_proxy_label: "MARKET_PROXY",
      market_proxy_formula: "(Mkt-RF + RF) / 100",
      rf_proxy_label: "RF_PROXY",
      rf_proxy_formula: "RF / 100",
      policy_input_aliases: {
        SPY: "MARKET_PROXY",
        BIL: "RF_PROXY",
      },
      aliases_are_internal_only: true,
      fabricated_prior_proxy_point_permitted: false,
      result_labels_must_remain: ["MARKET_PROXY", "RF_PROXY"],
    },
    sample_partition: {
      source_observation_ordinal_origin: 1,
      warmup_valid_factor_observations: 253,
      first_signal_observation_ordinal: 253,
      first_rebalance_observation_ordinal: 254,
      first_scored_outcome_observation_ordinal: 255,
      primary_partition: {
        id: "PRE_ETF_OVERLAP_EXTERNAL_MECHANISM",
        first_scored_outcome: "VALID_FACTOR_OBSERVATION_255",
        last_scored_outcome_date_inclusive: EXTERNAL_ATTEMPT115_PRIMARY_END,
        date_field: "outcome_observation_date",
      },
      overlap_diagnostic: {
        id: "POST_2007_OVERLAP_DIAGNOSTIC",
        first_outcome_date_inclusive: EXTERNAL_ATTEMPT115_OVERLAP_START,
        last_outcome_date_inclusive: "SOURCE_LAST_VALID_DATE",
        role: "DESCRIPTIVE_ONLY_CANNOT_RESCUE_OR_REVERSE_PRIMARY",
      },
      diagnostics_can_rescue_primary: false,
      alternate_start_or_end_date_permitted: false,
    },
    policy_binding: {
      incumbent: {
        policy_id: "tsmom_ensemble_vol",
        role: "FROZEN_ATTEMPT115_INCUMBENT",
      },
      challenger: {
        policy_id: "tsmom_ensemble_downside_semivol",
        role: "SOLE_FROZEN_CHALLENGER",
      },
      sole_primary_pair: [
        "tsmom_ensemble_downside_semivol",
        "tsmom_ensemble_vol",
      ],
      additional_policy_or_parameter_variant_permitted: false,
      policy_mutation_after_freeze_permitted: false,
    },
    execution_protocol: {
      signal_timing: "observe proxy levels through factor observation t close only",
      target_timing: "derive both frozen policy targets after factor observation t close",
      rebalance_timing: "rebalance at factor observation t+1 close",
      first_earned_return_timing:
        "the target rebalanced at observation t+1 first earns the observation t+1 to t+2 return",
      rebalance_interval_valid_observations: 5,
      primary_cadence_anchor: 0,
      cadence_sensitivity_anchors: [0, 1, 2, 3, 4],
      initial_weights: {
        MARKET_PROXY: 0,
        RF_PROXY: 1,
      },
      holdings_drift_between_rebalances: true,
      one_way_cost_bps_primary: 5,
      one_way_cost_bps_sensitivities: [1, 10, 25],
      turnover_definition:
        "abs(target_MARKET_PROXY - drifted_MARKET_PROXY) + abs(target_RF_PROXY - drifted_RF_PROXY)",
      cost_formula: "turnover * one_way_cost_bps / 10000",
      entry_cost_included: true,
      terminal_liquidation: {
        required: true,
        target_weights: {
          MARKET_PROXY: 0,
          RF_PROXY: 1,
        },
        costed: true,
      },
      same_dates_costs_anchors_and_partition_required_for_both_policies: true,
    },
    primary_inference: {
      partition_id: "PRE_ETF_OVERLAP_EXTERNAL_MECHANISM",
      challenger: "tsmom_ensemble_downside_semivol",
      comparator: "tsmom_ensemble_vol",
      cadence_anchor: 0,
      one_way_cost_bps: 5,
      sole_endpoint: "mean paired daily net log-return difference, challenger minus incumbent",
      daily_value_formula:
        "log1p(challenger_net_simple_return) - log1p(incumbent_net_simple_return)",
      null_hypothesis: "mean paired daily net log-return difference <= 0",
      alternative_hypothesis: "mean paired daily net log-return difference > 0",
      bootstrap: {
        test: "one-sided null-centered stationary circular block bootstrap",
        null_centered: true,
        circular: true,
        seed_uint32: 20260829,
        resamples: 4_999,
        expected_block_valid_observations: 20,
        restart_probability: 0.05,
        p_value_formula: "(1 + exceedances) / 5000",
        equality_counts_as_exceedance: true,
        nominal_alpha: 0.05,
      },
      multiple_testing: {
        method: "Bonferroni",
        global_registered_attempt_count: EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
        familywise_alpha: 0.05,
        per_test_threshold: 0.05 / EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
        minimum_attainable_raw_p_value: 1 / 5000,
        passing_attainable_raw_p_values: [0.0002, 0.0004],
      },
      deflated_sharpe: {
        required: true,
        method:
          "Bailey-Lopez de Prado deflated Sharpe probability with a preregistered independent-null-trial benchmark",
        input_series: "the sole primary paired daily net log-return difference series",
        observed_periodic_sharpe:
          "sample_mean(input_series) / sample_standard_deviation(input_series)",
        sample_standard_deviation_convention:
          "square root of sum((x - mean(x))^2) / (n - 1)",
        skewness_convention:
          "uncorrected third central moment divided by population_variance^(3/2), each central moment using denominator n",
        pearson_kurtosis_convention:
          "uncorrected fourth central moment divided by population_variance^2, each central moment using denominator n; not excess kurtosis",
        global_registered_attempt_count: EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
        trial_sharpe_mean_periodic: 0,
        trial_sharpe_standard_deviation_periodic: "1 / sqrt(n - 1)",
        expected_maximum_coefficient_formula:
          "(1 - EulerGamma) * Phi^-1(1 - 1 / N) + EulerGamma * Phi^-1(1 - 1 / (N * e))",
        euler_mascheroni_constant: 0.5772156649015329,
        deflated_benchmark_sharpe_formula:
          "0 + (1 / sqrt(n - 1)) * expected_maximum_coefficient",
        non_normality_variance_factor_formula:
          "1 - skewness * observed_SR + ((Pearson_kurtosis - 1) / 4) * observed_SR^2",
        z_score_formula:
          "(observed_SR - deflated_benchmark_SR) * sqrt(n - 1) / sqrt(non_normality_variance_factor)",
        probability_formula: "Phi(z_score)",
        minimum_probability: 0.95,
        degenerate_or_nonfinite_disposition: "GATE_FAILS_CLOSED",
        calibration_assumption:
          "All N=118 registered trials are treated as independent draws from a zero-mean unit-variance normal-return null solely to predeclare the expected-maximum Sharpe benchmark; no outcome-derived cross-strategy Sharpe moments may be substituted.",
      },
      interim_or_repeat_inference_permitted: false,
    },
    mechanism_gates: {
      default_measurement_cell: {
        partition_id: "PRE_ETF_OVERLAP_EXTERNAL_MECHANISM",
        cadence_anchor: 0,
        one_way_cost_bps: 5,
      },
      unqualified_metrics_use_default_measurement_cell: true,
      primary_direction: {
        metric: "primary mean paired daily net log-return difference",
        operator: ">",
        threshold: 0,
      },
      statistical_evidence: {
        nominal_bootstrap_p_value_maximum: 0.05,
        bonferroni_raw_p_value_maximum:
          0.05 / EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
        deflated_sharpe_probability_minimum: 0.95,
        all_required: true,
      },
      absolute_and_rf_proxy_performance: {
        both_policies_positive_net_log_growth: true,
        both_policies_beat_rf_proxy_net_log_growth: true,
      },
      cost_stress: {
        required_positive_edge_bps: [5, 10],
        metric: "paired net log-return edge, challenger minus incumbent",
      },
      cadence_robustness: {
        anchor_zero_positive_required: true,
        minimum_positive_anchors: 4,
        anchors_evaluated: [0, 1, 2, 3, 4],
        cost_bps: 5,
      },
      complete_decades: {
        incomplete_decades_excluded: true,
        calendar_decade_definition: "UTC calendar years YYYY0 through YYYY9 inclusive",
        complete_decade_eligibility_rule:
          "the primary partition starts on or before YYYY0-01-01, ends on or after YYYY9-12-31, and contains at least one outcome observation in each of the ten calendar years",
        expected_complete_decade_start_years: [
          1930,
          1940,
          1950,
          1960,
          1970,
          1980,
          1990,
        ],
        minimum_complete_decade_count: 7,
        decade_edge_formula:
          "sum of challenger-minus-incumbent paired daily net log-return differences whose outcome_observation_date falls within the calendar decade",
        zero_edge_counts_as_positive: false,
        median_challenger_minus_incumbent_edge_operator: ">",
        median_challenger_minus_incumbent_edge_threshold: 0,
        minimum_positive_decade_share: 0.6,
      },
      drawdown_guardrail: {
        formula: "challenger_maximum_drawdown >= incumbent_maximum_drawdown - 0.05",
        maximum_worsening_percentage_points: 5,
      },
      volatility_guardrail: {
        formula: "challenger_annualized_volatility <= 1.10 * incumbent_annualized_volatility",
        maximum_ratio: 1.1,
      },
      integrity: {
        all_required: true,
        required_checks: [
          "protocol_self_hash",
          "artifact_hash_binding",
          "official_source_identity_and_receipt",
          "strict_parser_schema_and_row_order",
          "source_transform_identity",
          "warmup_signal_rebalance_outcome_chronology",
          "future_observation_mutation_invariance",
          "cost_monotonicity_and_exact_entry_cost",
          "exact_terminal_liquidation",
        ],
      },
    },
    result_disposition: {
      all_mechanism_gates_required: true,
      any_failure_disposition: "EXTERNAL_MECHANISM_PORTABILITY_NOT_ESTABLISHED",
      pass_label:
        "EXTERNAL_MECHANISM_PORTABILITY_ESTABLISHED_ON_FROZEN_FACTOR_PROXY_REPLAY",
      pass_supports_only:
        "The sole frozen challenger mechanism ported to an external factor-return proxy under the preregistered replay.",
      diagnostic_or_overlap_result_can_rescue: false,
      incumbent_policy_changes: false,
      public_claim_changes: false,
    },
    authority: {
      research_only: true,
      protocol_module_network_access_authorized: false,
      protocol_module_file_io_authorized: false,
      broker_reads_authorized: false,
      broker_mutation_authorized: false,
      orders_authorized: false,
      capital_authorized: false,
      production_policy_mutation_authorized: false,
      site_or_release_mutation_authorized: false,
      public_performance_claim_authorized: false,
    },
    artifact_binding: {
      hashes_computed_before_source_acquisition: true,
      source_files_sha256: structuredClone(sourceFilesSha256),
      test_files_sha256: structuredClone(testFilesSha256),
    },
    claim_boundary: EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY,
  };
  validateSemantics(body, false);
  return deepFreeze(body);
}

export function externalAttempt115ProtocolBody(value) {
  plainObject(value, "external Attempt115 protocol");
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "protocol_sha256"),
  );
}

export function hashExternalAttempt115Protocol(value) {
  return sha256(externalAttempt115ProtocolBody(value));
}

export function canonicalExternalAttempt115ProtocolJson(value) {
  return `${JSON.stringify(canonicalSort(value), null, 2)}\n`;
}

/**
 * Validate an already sealed preregistration. This function is pure: callers
 * supply the object, and no source, file, network, broker, or public artifact is
 * accessed or changed.
 */
export function validateExternalAttempt115Protocol(value) {
  validateSemantics(value, true);
  if (typeof value.protocol_sha256 !== "string"
    || !SHA256_PATTERN.test(value.protocol_sha256)
    || hashExternalAttempt115Protocol(value) !== value.protocol_sha256) {
    fail("external Attempt115 protocol self-hash changed");
  }
  return deepFreeze(structuredClone(value));
}

/** Seal a complete semantic body after all bound source and test hashes exist. */
export function sealExternalAttempt115Protocol(body) {
  validateSemantics(body, false);
  const sealed = {
    ...structuredClone(body),
    protocol_sha256: hashExternalAttempt115Protocol(body),
  };
  return validateExternalAttempt115Protocol(sealed);
}

/** Parse and verify canonical UTF-8 protocol bytes without performing I/O. */
export function verifyExternalAttempt115ProtocolBytes(input) {
  let text;
  if (typeof input === "string") {
    text = input;
  } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      fail("external Attempt115 protocol bytes must be valid UTF-8");
    }
  } else {
    fail("external Attempt115 protocol bytes must be a string or bytes");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("external Attempt115 protocol bytes must contain valid JSON");
  }
  const validated = validateExternalAttempt115Protocol(value);
  if (text !== canonicalExternalAttempt115ProtocolJson(validated)) {
    fail("external Attempt115 protocol bytes are not canonical");
  }
  return validated;
}
