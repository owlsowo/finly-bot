import { sha256, stableStringify } from "../../lib/canonical.mjs";

export const INDUSTRY_VM_G4_PROTOCOL_SCHEMA =
  "finly_industry_vm_g4_external_protocol.v2";
export const INDUSTRY_VM_G4_EVALUATION_ID =
  "industry_vm_g4_external_replay_attempt150";
export const INDUSTRY_VM_G4_PROTOCOL_STATUS = "FROZEN_BEFORE_OFFICIAL_SOURCE_ACQUISITION";
export const INDUSTRY_VM_G4_OPERATIONAL_ATTEMPT_NUMBER = 150;
export const INDUSTRY_VM_G4_LEDGER_ATTEMPT_COUNT = 150;
export const INDUSTRY_VM_G4_UNLOGGED_SCRATCH_RESERVE = 51;
export const INDUSTRY_VM_G4_INFERENTIAL_EFFECTIVE_TRIAL_COUNT = 201;
export const INDUSTRY_VM_G4_BONFERRONI_THRESHOLD =
  0.05 / INDUSTRY_VM_G4_INFERENTIAL_EFFECTIVE_TRIAL_COUNT;
export const INDUSTRY_VM_G4_REQUIRED_NODE_VERSION = "v26.7.0";
export const INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV = Object.freeze([
  "--max-old-space-size=256",
]);

export const INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL =
  "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/10_Industry_Portfolios_daily_CSV.zip";
export const INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_MEMBER =
  "10_Industry_Portfolios_Daily.CSV";
export const INDUSTRY_VM_G4_HTTP_ACCEPT = "*/*";
export const INDUSTRY_VM_G4_OFFICIAL_SOURCE_OBSERVATIONS = 26_274;
export const INDUSTRY_VM_G4_OFFICIAL_SOURCE_FIRST_DATE = "1926-07-01";
export const INDUSTRY_VM_G4_OFFICIAL_SOURCE_LAST_DATE = "2026-06-30";
export const INDUSTRY_VM_G4_EXPECTED_DATE_SEQUENCE_SHA256 =
  "sha256:4d0b141f05d01b5b4028060a11081d5fc983bc0133c69325d994a469c5ff1eba";

export const INDUSTRY_VM_G4_FACTOR_ARTIFACT_RELATIVE_PATH =
  "research/industry_vm_g4_external/canonical_daily_factors.csv";
export const INDUSTRY_VM_G4_FACTOR_ARTIFACT_RAW_SHA256 =
  "sha256:156d6bc8396e6c1cc3c680016f132304c09491f077881f5ae932d1ca0610d603";
export const INDUSTRY_VM_G4_TRIAL_LEDGER_RELATIVE_PATH =
  "research/industry_vm_g4_external/trial_ledger.json";
export const INDUSTRY_VM_G4_TRIAL_LEDGER_RAW_SHA256 =
  "sha256:997a8da73450d7c49de67f8a1e509a9ced8dccfe6fd0f58ab9a48af01e88ab5b";

export const INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RELATIVE_PATH =
  "research/industry_vm_g4_external/attempt149_frozen_protocol.json";
export const INDUSTRY_VM_G4_ATTEMPT149_LEGACY_PROTOCOL_RELATIVE_PATH =
  "research/industry_vm_g4_external/frozen_protocol.json";
export const INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RAW_SHA256 =
  "sha256:c935a3c2f719fc0202c8820a39bffb4d87b70dd672a40d59ccf7ff1c7e154f2b";
export const INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_BYTES = 12_072;
export const INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_SHA256 =
  "sha256:6e5764b40949f3693f75c3bb18a851073c0c0a08b9ad704228b9c14aa6eb6763";
export const INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RELATIVE_PATH =
  "research/industry_vm_g4_external/attempt149_run_start.json";
export const INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RAW_SHA256 =
  "sha256:82a0d0cf9413ea5e436019da7da1f4d3d5debef5693e14665f3b45e1d3f37e35";
export const INDUSTRY_VM_G4_ATTEMPT149_RUN_START_BYTES = 555;
export const INDUSTRY_VM_G4_ATTEMPT149_RUN_START_MARKER_SHA256 =
  "sha256:f789f01b780c030561dde553c4bbae86a5998d4e8fb6ffdbd53649e865879dea";
export const INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RELATIVE_PATH =
  "research/industry_vm_g4_external/attempt149_failure_receipt.json";
export const INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RAW_SHA256 =
  "sha256:32327d421625eadfc93038b990d3ff058450d27447a2deb3c09f6870d59721e6";
export const INDUSTRY_VM_G4_ATTEMPT149_FAILURE_BYTES = 813;
export const INDUSTRY_VM_G4_ATTEMPT149_FAILURE_SHA256 =
  "sha256:c07fb5405f351fd74188c0999af97c3fbe47d6ca27cb1049036d81420d322135";
export const INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RELATIVE_PATH =
  "research/industry_vm_g4_external/attempt149_transport_diagnosis.json";
export const INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RAW_SHA256 =
  "sha256:38eddfea6e232091be44b9f1d14dfd44006eadbea56e9ca4b2f84a31a5f461e8";
export const INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_BYTES = 2_589;
export const INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_SHA256 =
  "sha256:bc9ac712292af2515d1f91c8ef908f3378e192ef9057a354926afa1a88cc72c5";

export const INDUSTRY_VM_G4_FIXED_OUTPUT_RELATIVE_PATH =
  "data/private/industry_vm_g4_external/attempt150";
export const INDUSTRY_VM_G4_RUN_START_RELATIVE_PATH =
  "data/private/industry_vm_g4_external/attempt150.run-start.json";
export const INDUSTRY_VM_G4_FROZEN_PROTOCOL_RELATIVE_PATH =
  "research/industry_vm_g4_external/attempt150_frozen_protocol.json";
export const INDUSTRY_VM_G4_RUN_ONCE_RELATIVE_PATH =
  "research/industry_vm_g4_external/run_once.mjs";

export const INDUSTRY_VM_G4_ARTIFACT_PATHS = Object.freeze({
  source_files: Object.freeze([
    "package.json",
    "package-lock.json",
    "lib/canonical.mjs",
    "lib/quant.mjs",
    "research/champion_engine.mjs",
    "research/external_validation_attempt115/kenneth_french_daily_factor_adapter.mjs",
    "research/industry_vm_g4_external/source.mjs",
    "research/industry_vm_g4_external/strategy.mjs",
    "research/industry_vm_g4_external/evaluation.mjs",
    INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RELATIVE_PATH,
    INDUSTRY_VM_G4_ATTEMPT149_LEGACY_PROTOCOL_RELATIVE_PATH,
    INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RELATIVE_PATH,
    INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RELATIVE_PATH,
    INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RELATIVE_PATH,
    "research/industry_vm_g4_external/protocol.mjs",
    INDUSTRY_VM_G4_RUN_ONCE_RELATIVE_PATH,
    INDUSTRY_VM_G4_TRIAL_LEDGER_RELATIVE_PATH,
  ]),
  test_files: Object.freeze([
    "tests/industry_vm_g4_external_source.test.mjs",
    "tests/industry_vm_g4_external_strategy.test.mjs",
    "tests/industry_vm_g4_external_evaluation.test.mjs",
    "tests/industry_vm_g4_external_protocol.test.mjs",
    "tests/industry_vm_g4_external_run_once.test.mjs",
  ]),
});

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "evaluation_id",
  "status",
  "frozen_at",
  "registration",
  "predecessor_attempt",
  "source_freeze",
  "factor_binding",
  "policy_binding",
  "execution_protocol",
  "inference",
  "gates",
  "output_contract",
  "artifact_binding",
  "authority",
  "claim_boundary",
  "protocol_sha256",
]);

function fail(message) {
  throw new TypeError(message);
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
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalSort(item)]));
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
    fail(`${label} fields changed`);
  }
}

function canonicalInstant(value) {
  if (typeof value !== "string") fail("industry protocol frozen_at must be a canonical UTC timestamp");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("industry protocol frozen_at must be a canonical UTC timestamp");
  }
}

function validateShaMap(value, paths, label) {
  exactKeys(value, paths, label);
  paths.forEach((path) => {
    if (typeof value[path] !== "string" || !SHA256_PATTERN.test(value[path])) {
      fail(`${label}.${path} must be a SHA-256 digest`);
    }
  });
}

function template({ frozenAt, sourceFilesSha256, testFilesSha256 }) {
  return {
    schema_version: INDUSTRY_VM_G4_PROTOCOL_SCHEMA,
    evaluation_id: INDUSTRY_VM_G4_EVALUATION_ID,
    status: INDUSTRY_VM_G4_PROTOCOL_STATUS,
    frozen_at: frozenAt,
    registration: {
      operational_attempt_number: INDUSTRY_VM_G4_OPERATIONAL_ATTEMPT_NUMBER,
      trial_ledger_relative_path: INDUSTRY_VM_G4_TRIAL_LEDGER_RELATIVE_PATH,
      trial_ledger_raw_sha256: INDUSTRY_VM_G4_TRIAL_LEDGER_RAW_SHA256,
      ledger_attempt_count: INDUSTRY_VM_G4_LEDGER_ATTEMPT_COUNT,
      conservative_unlogged_scratch_reserve: INDUSTRY_VM_G4_UNLOGGED_SCRATCH_RESERVE,
      inferential_effective_trial_count: INDUSTRY_VM_G4_INFERENTIAL_EFFECTIVE_TRIAL_COUNT,
      candidate_count: 1,
      diagnostic_mapping_count: 1,
      diagnostic_mapping_selection_eligible: false,
      candidate_selected_before_external_outcomes: true,
      repeat_or_replacement_primary_permitted: false,
    },
    predecessor_attempt: {
      operational_attempt_number: 149,
      evaluation_id: "industry_vm_g4_external_replay_attempt149",
      disposition: "CONSUMED_HTTP_TRANSPORT_FAILURE_BEFORE_OFFICIAL_OUTCOMES",
      outcomes_observed: false,
      frozen_protocol: {
        relative_path: INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RELATIVE_PATH,
        legacy_relative_path: INDUSTRY_VM_G4_ATTEMPT149_LEGACY_PROTOCOL_RELATIVE_PATH,
        raw_bytes_sha256: INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_RAW_SHA256,
        bytes: INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_BYTES,
        protocol_sha256: INDUSTRY_VM_G4_ATTEMPT149_PROTOCOL_SHA256,
      },
      run_start: {
        relative_path: INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RELATIVE_PATH,
        raw_bytes_sha256: INDUSTRY_VM_G4_ATTEMPT149_RUN_START_RAW_SHA256,
        bytes: INDUSTRY_VM_G4_ATTEMPT149_RUN_START_BYTES,
        run_start_marker_sha256: INDUSTRY_VM_G4_ATTEMPT149_RUN_START_MARKER_SHA256,
      },
      failure_receipt: {
        relative_path: INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RELATIVE_PATH,
        raw_bytes_sha256: INDUSTRY_VM_G4_ATTEMPT149_FAILURE_RAW_SHA256,
        bytes: INDUSTRY_VM_G4_ATTEMPT149_FAILURE_BYTES,
        failure_receipt_sha256: INDUSTRY_VM_G4_ATTEMPT149_FAILURE_SHA256,
        error_message: "official response must be exact HTTP 200, non-redirected, and identity encoded",
      },
      successor_scope: "HTTP_ACCEPT_REQUEST_HEADER_ONLY",
      attempt149_accept: "application/zip, application/octet-stream",
      attempt150_accept: INDUSTRY_VM_G4_HTTP_ACCEPT,
      transport_diagnosis: {
        relative_path: INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RELATIVE_PATH,
        raw_bytes_sha256: INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_RAW_SHA256,
        bytes: INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_BYTES,
        diagnosis_sha256: INDUSTRY_VM_G4_ATTEMPT149_DIAGNOSIS_SHA256,
        response_body_or_official_source_values_read: false,
        narrow_accept: {
          status: 406,
          content_type: "text/html",
          content_length: 1346,
        },
        corrected_accept: {
          status: 200,
          location: null,
          content_encoding: null,
          content_type: "application/x-zip-compressed",
          content_length: 932676,
        },
      },
      same_official_url_method_redirect_policy_identity_encoding_caps_deadline_and_extractor: true,
      same_candidate_mapping_dates_comparators_cost_model_inference_seed_resamples_and_nine_gates: true,
    },
    source_freeze: {
      provider: "Kenneth R. French Data Library",
      dataset: "10 Industry Portfolios daily",
      official_archive_url: INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL,
      logical_archive_member: INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_MEMBER,
      member_match_rule: "SINGLE_TRAVERSAL_SAFE_ASCII_BASENAME_CASE_FOLDED_TO_LOGICAL_MEMBER",
      archive_member_path_components_permitted: false,
      archive_member_non_ascii_permitted: false,
      exact_value_weighted_section: "Average Value Weighted Returns -- Daily",
      exact_equal_weighted_section: "Average Equal Weighted Returns -- Daily",
      equal_weighted_values_enter_evaluation: false,
      expected_columns: [
        "date", "NoDur", "Durbl", "Manuf", "Enrgy", "HiTec",
        "Telcm", "Shops", "Hlth", "Utils", "Other",
      ],
      expected_observations: INDUSTRY_VM_G4_OFFICIAL_SOURCE_OBSERVATIONS,
      expected_first_date: INDUSTRY_VM_G4_OFFICIAL_SOURCE_FIRST_DATE,
      expected_last_date: INDUSTRY_VM_G4_OFFICIAL_SOURCE_LAST_DATE,
      expected_iso_date_sequence_sha256: INDUSTRY_VM_G4_EXPECTED_DATE_SEQUENCE_SHA256,
      date_sequence_hash_definition: "sha256(stable JSON array of ISO dates in source order)",
      acquisition_state: "NOT_ACQUIRED_FOR_ATTEMPT150",
      source_values_observed_before_freeze: false,
      source_archive_sha256: null,
      source_member_sha256: null,
      http: {
        method: "GET",
        accept: INDUSTRY_VM_G4_HTTP_ACCEPT,
        exact_status: 200,
        redirects_permitted: false,
        accept_encoding: "identity",
        timeout_ms: 30_000,
        maximum_archive_bytes: 16 * 1024 * 1024,
      },
      extractor: {
        executable: "/usr/bin/unzip",
        implementation: "Info-ZIP UnZip",
        exact_major_minor_version: "6.00",
        crc_test_required_before_extraction: true,
      },
    },
    factor_binding: {
      relative_path: INDUSTRY_VM_G4_FACTOR_ARTIFACT_RELATIVE_PATH,
      raw_bytes_sha256: INDUSTRY_VM_G4_FACTOR_ARTIFACT_RAW_SHA256,
      csv_schema: "date,Mkt-RF,SMB,HML,RF",
      expected_observations: INDUSTRY_VM_G4_OFFICIAL_SOURCE_OBSERVATIONS,
      expected_first_date: INDUSTRY_VM_G4_OFFICIAL_SOURCE_FIRST_DATE,
      expected_last_date: INDUSTRY_VM_G4_OFFICIAL_SOURCE_LAST_DATE,
      expected_iso_date_sequence_sha256: INDUSTRY_VM_G4_EXPECTED_DATE_SEQUENCE_SHA256,
      market_formula: "MARKET = (Mkt-RF + RF) / 100",
      rf_formula: "RF / 100",
      exact_date_join_required: true,
    },
    policy_binding: {
      sole_primary_candidate: {
        id: "industry_vm_g4_primary_hitec",
        formula: "50% HiTec plus 1/6 each in the top three remaining industries by t-252 to t-126 log momentum",
        volatility_lookback_sessions: 22,
        annualized_volatility_target: 0.20,
        maximum_target_risky_gross: 1.5,
      },
      diagnostic_mapping_b: {
        id: "industry_vm_g4_diagnostic_market",
        formula: "50% MARKET plus 1/6 each in the top three industries under the same volatility overlay",
        role: "NON_RESCUING_DIAGNOSTIC_ONLY",
        selection_eligible: false,
        enters_any_primary_gate: false,
        can_rescue_reverse_or_modify_primary: false,
      },
      comparators: [
        "MARKET_BUY_HOLD",
        "MARKET_VOL20_CAP15",
        "UNSCALED_A",
        "RF_CASH",
      ],
      alternate_candidate_or_parameter_variant_permitted: false,
      mutation_after_freeze_permitted: false,
    },
    execution_protocol: {
      signal_lookback_sessions: 252,
      signal_at_close: "t",
      rebalance_at_close: "t+1",
      first_earned_return: "t+1_to_t+2",
      rebalance_interval_sessions: 21,
      primary_rebalance_anchor: 0,
      cadence_anchors: Array.from({ length: 21 }, (_, index) => index),
      primary_one_way_cost_bps: 5,
      cost_stress_one_way_bps: [5, 10, 25],
      transaction_cost_basis: "one-way risky-asset L1 turnover at entry, executed rebalances, and terminal liquidation; RF cash/financing excluded",
      transaction_cost_symbols: [
        "NoDur", "Durbl", "Manuf", "Enrgy", "HiTec", "Telcm",
        "Shops", "Hlth", "Utils", "Other", "MARKET",
      ],
      annual_borrow_spread: 0.005,
      borrow_spread_accounting: "negative RF financing is charged separately from risky-asset transaction costs",
      terminal_liquidation: true,
      primary_end_date_inclusive: "2007-05-29",
      overlap_diagnostic_start_date_inclusive: "2007-05-30",
      overlap_diagnostic_can_rescue_primary: false,
      runtime: {
        exact_node_version: INDUSTRY_VM_G4_REQUIRED_NODE_VERSION,
        exact_process_exec_argv: [...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV],
        node_options_permitted: false,
        v8_old_space_limit_mib: 256,
        unlisted_node_exec_argv_permitted: false,
        official_scale_synthetic_pipeline_proof_required_before_freeze: true,
      },
    },
    inference: {
      stationary_bootstrap_seed: 20260830,
      stationary_bootstrap_resamples: 4999,
      stationary_bootstrap_expected_block_sessions: 20,
      nominal_alpha: 0.05,
      inferential_effective_trial_count: INDUSTRY_VM_G4_INFERENTIAL_EFFECTIVE_TRIAL_COUNT,
      bonferroni_threshold: INDUSTRY_VM_G4_BONFERRONI_THRESHOLD,
      deflated_sharpe_method: "parametric null-maximum deflated Sharpe probability",
      empirical_trial_sharpe_distribution_used: false,
      deflated_sharpe_probability_minimum: 0.95,
    },
    gates: {
      exact_gate_names: [
        "primary_direction",
        "statistical_evidence",
        "absolute_and_rf_performance",
        "cost_stress",
        "cadence_robustness",
        "complete_decades",
        "drawdown_guardrail",
        "volatility_matched_control",
        "integrity",
      ],
      all_nine_required: true,
      primary_direction: "anchor-0 5bp candidate net-log-growth edge over MARKET_BUY_HOLD > 0",
      statistical_evidence: "bootstrap p<=0.05 and p<=0.05/201, plus parametric null-maximum deflated Sharpe probability>=0.95",
      absolute_and_rf_performance: "candidate net log growth > 0 and candidate beats RF_CASH",
      cost_stress: "candidate edge positive at 5bp, 10bp, and 25bp",
      cadence_robustness: "anchor 0 positive, median of 21 positive, and at least 17 of 21 positive",
      complete_decades: "exact complete 1930s through 1990s, median edge positive, at least 5 of 7 positive",
      drawdown_guardrail: "candidate maximum drawdown no more than 5 percentage points worse than market",
      volatility_matched_control: "candidate beats causal MARKET_VOL20_CAP15 and realized volatility ratio is 0.90 through 1.10",
      integrity: "all bound provenance, chronology, cost, liquidation, parser, date-join, and future-mutation checks pass",
    },
    output_contract: {
      fixed_ignored_private_output_relative_path: INDUSTRY_VM_G4_FIXED_OUTPUT_RELATIVE_PATH,
      atomic_run_start_relative_path: INDUSTRY_VM_G4_RUN_START_RELATIVE_PATH,
      official_archive_filename: "official_source_archive.zip",
      official_member_filename: "official_source_member.csv",
      canonical_source_filename: "canonical_10_industry_value_weighted.csv",
      aggregate_filename: "aggregate_evaluation.json",
      primary_series_filename: "primary_pair_series.json",
      acquisition_receipt_filename: "acquisition_receipt.json",
      completion_receipt_filename: "run_receipt.json",
      consumed_failure_receipt_filename: "failure_receipt.json",
      frozen_protocol_copy_filename: "frozen_protocol.json",
      official_archive_maximum_bytes: 16 * 1024 * 1024,
      official_member_maximum_bytes: 16 * 1024 * 1024,
      canonical_source_maximum_bytes: 16 * 1024 * 1024,
      full_grid_persistence_permitted: false,
      aggregate_maximum_bytes: 2 * 1024 * 1024,
      primary_series_maximum_bytes: 8 * 1024 * 1024,
      each_receipt_maximum_bytes: 512 * 1024,
      total_output_maximum_bytes: 64 * 1024 * 1024,
      same_marker_retry_permitted: false,
      fixed_output_directory_creation_is_preclaim: true,
      orphan_preclaim_directory_retry_permitted: false,
      orphan_preclaim_directory_requires_new_preregistered_protocol: true,
      run_start_permanently_consumes_operational_attempt: true,
      failure_receipt_required_after_run_start: true,
      consumed_failure_receipt_required_after_outcomes_observed: true,
    },
    artifact_binding: {
      source_files_sha256: sourceFilesSha256,
      test_files_sha256: testFilesSha256,
      artifact_set_sha256: sha256({ sourceFilesSha256, testFilesSha256 }),
      hash_type: "RAW_FILE_BYTES_SHA256",
    },
    authority: {
      broker_or_capital_authority: "NONE",
      public_claim_mutation_authority: "NONE",
      rerun_or_parameter_mutation_authority: "NONE",
    },
    claim_boundary: "Attempt150 is a transport-only successor after Attempt149 failed before official outcomes. Retrospective external industry-proxy mechanism evidence only. It is not live or forward performance, an ETF or options P&L, a profitability promise, broker authorization, or competitor rank. Mapping B and post-2007 overlap are non-rescuing diagnostics.",
  };
}

export function createIndustryVmG4ProtocolBody({
  frozenAt,
  sourceFilesSha256,
  testFilesSha256,
}) {
  canonicalInstant(frozenAt);
  validateShaMap(
    sourceFilesSha256,
    INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files,
    "industry protocol source hash map",
  );
  validateShaMap(
    testFilesSha256,
    INDUSTRY_VM_G4_ARTIFACT_PATHS.test_files,
    "industry protocol test hash map",
  );
  return deepFreeze(template({ frozenAt, sourceFilesSha256, testFilesSha256 }));
}

export function sealIndustryVmG4Protocol(body) {
  plainObject(body, "industry protocol body");
  if (Object.hasOwn(body, "protocol_sha256")) fail("industry protocol body is already sealed");
  const checked = createIndustryVmG4ProtocolBody({
    frozenAt: body.frozen_at,
    sourceFilesSha256: body.artifact_binding?.source_files_sha256,
    testFilesSha256: body.artifact_binding?.test_files_sha256,
  });
  if (stableStringify(body) !== stableStringify(checked)) {
    fail("industry protocol body changed from the frozen template");
  }
  return deepFreeze({ ...checked, protocol_sha256: sha256(checked) });
}

export function validateIndustryVmG4Protocol(protocol) {
  exactKeys(protocol, TOP_LEVEL_KEYS, "industry protocol");
  if (typeof protocol.protocol_sha256 !== "string"
    || !SHA256_PATTERN.test(protocol.protocol_sha256)) {
    fail("industry protocol semantic self-hash is invalid");
  }
  const body = Object.fromEntries(
    Object.entries(protocol).filter(([key]) => key !== "protocol_sha256"),
  );
  const expected = sealIndustryVmG4Protocol(body);
  if (stableStringify(protocol) !== stableStringify(expected)) {
    fail("industry protocol fields changed from the frozen template");
  }
  return protocol;
}

export function canonicalIndustryVmG4ProtocolJson(protocol) {
  validateIndustryVmG4Protocol(protocol);
  return `${JSON.stringify(canonicalSort(protocol), null, 2)}\n`;
}

export function verifyIndustryVmG4ProtocolBytes(bytes) {
  let text;
  try {
    text = typeof bytes === "string"
      ? bytes
      : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("industry frozen protocol must be valid UTF-8 JSON");
  }
  let protocol;
  try {
    protocol = JSON.parse(text);
  } catch {
    fail("industry frozen protocol must be valid JSON");
  }
  validateIndustryVmG4Protocol(protocol);
  if (text !== canonicalIndustryVmG4ProtocolJson(protocol)) {
    fail("industry frozen protocol bytes are not canonical");
  }
  return deepFreeze(protocol);
}
