import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../../lib/canonical.mjs";

export const ATTEMPT116_ID = "finly_prospective_options_shadow_attempt_116";
export const ATTEMPT116_PROTOCOL_SCHEMA = "finly_attempt116_vrp_shadow_protocol.v1";
export const ATTEMPT116_PROTOCOL_RELATIVE_PATH =
  "research/prospective_attempt116/protocol.json";
export const ATTEMPT116_PROTOCOL_SHA256 =
  "sha256:8703b78afabe6cfe39d981ed1399878ba219b8f92100982c43e2c88e24c5a677";
export const ATTEMPT116_PROTOCOL_RAW_BYTES_SHA256 =
  "sha256:3baa380e02f982d1c0c892357cded0e24ad311c2e73c1c1cc38d1d1b5d1501a2";
export const ATTEMPT116_PUBLICATION_DEADLINE = "2026-08-31T13:30:00.000Z";
export const ATTEMPT116_FIRST_ELIGIBLE_INPUT_AT = "2026-08-31T13:30:00.000Z";
export const ATTEMPT116_FIRST_ELIGIBLE_SESSION = "2026-08-31";
export const ATTEMPT116_LAST_PRE_REGISTRATION_HISTORY_SESSION = "2026-08-28";

export const ATTEMPT116_SIGNAL_SPECIFICATION = Object.freeze({
  symbol: "SPY",
  annualization_sessions: 252,
  required_completed_underlying_bars: 22,
  short_close_return_window: 10,
  long_close_return_window: 21,
  parkinson_bar_window: 21,
  close_to_close_10_weight: 0.4,
  close_to_close_21_weight: 0.2,
  parkinson_21_weight: 0.4,
  sell_vol_shadow_minimum_inclusive: 0.15,
  buy_vol_shadow_maximum_inclusive: -0.15,
  term_slope_blackout_threshold: 0.08,
  option_expiry_calendar_dte_minimum_inclusive: 1,
  option_expiry_calendar_dte_maximum_inclusive: 9,
});

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "attempt_id",
  "attempt_number",
  "status",
  "draft_frozen_at",
  "trial_accounting",
  "publication_boundary",
  "first_eligible_input",
  "source_basis",
  "signal_specification",
  "adaptation_safety_deltas",
  "excluded_surfaces",
  "authority",
  "evaluation_gates",
  "claim_boundary",
  "protocol_sha256",
]);

const REQUIRED_ARTIFACT_PATHS = Object.freeze([
  "research/prospective_attempt116/SOURCE_ATTRIBUTION.md",
  "research/prospective_attempt116/UPSTREAM_LICENSE.txt",
  "research/prospective_attempt116/protocol.json",
  "research/prospective_attempt116/protocol.mjs",
  "research/prospective_attempt116/signal.mjs",
  "tests/prospective_attempt116_protocol.test.mjs",
  "tests/prospective_attempt116_signal.test.mjs",
]);

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

function canonicalInstant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function exactBooleanMap(value, expectedKeys, label) {
  exactKeys(value, expectedKeys, label);
  for (const key of expectedKeys) {
    if (value[key] !== true) fail(`${label}.${key} must remain true`);
  }
}

function rawBytesSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readRegularFileWithoutSymlink(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.startsWith("../") || relativePath.includes("/../")) {
    fail(`unsafe repository-relative path: ${relativePath}`);
  }
  const rootStatus = await lstat(projectRoot);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("Attempt 116 project root must be a real directory");
  }
  const root = await realpath(projectRoot);
  let cursor = root;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) fail(`${relativePath} traverses a symbolic link`);
    if (index < parts.length - 1 && !metadata.isDirectory()) {
      fail(`${relativePath} has a non-directory parent`);
    }
    if (index === parts.length - 1 && !metadata.isFile()) {
      fail(`${relativePath} is not a regular file`);
    }
  }
  let handle;
  try {
    handle = await open(cursor, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile()) fail(`${relativePath} did not open as a regular file`);
    const bytes = await handle.readFile();
    const finalStatus = await lstat(cursor);
    if (finalStatus.isSymbolicLink() || !finalStatus.isFile()
      || finalStatus.dev !== openedStatus.dev || finalStatus.ino !== openedStatus.ino
      || await realpath(cursor) !== cursor) {
      fail(`${relativePath} changed identity while it was read`);
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function prospectiveAttempt116ProtocolBody(value) {
  plainObject(value, "Attempt 116 protocol");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "protocol_sha256"));
}

export function hashProspectiveAttempt116Protocol(value) {
  return sha256(prospectiveAttempt116ProtocolBody(value));
}

export function canonicalProspectiveAttempt116ProtocolJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateProspectiveAttempt116Protocol(value) {
  exactKeys(value, TOP_LEVEL_KEYS, "Attempt 116 protocol");
  if (value.schema_version !== ATTEMPT116_PROTOCOL_SCHEMA
    || value.attempt_id !== ATTEMPT116_ID
    || value.attempt_number !== 116
    || value.status !== "PROSPECTIVE_ONLY_SHADOW_COMPILER_REAL_DATA_RUNNER_DISABLED") {
    fail("Attempt 116 protocol envelope changed");
  }
  if (canonicalInstant(value.draft_frozen_at, "Attempt 116 draft_frozen_at")
    >= ATTEMPT116_PUBLICATION_DEADLINE) {
    fail("Attempt 116 draft was not frozen before the publication deadline");
  }
  if (value.protocol_sha256 !== ATTEMPT116_PROTOCOL_SHA256
    || hashProspectiveAttempt116Protocol(value) !== ATTEMPT116_PROTOCOL_SHA256) {
    fail("Attempt 116 protocol self-hash changed");
  }

  const accounting = plainObject(value.trial_accounting, "Attempt 116 trial accounting");
  if (accounting.prior_registered_attempt_count !== 115
    || accounting.additional_registered_attempt_count !== 1
    || accounting.registered_attempt_count_after_publication !== 116
    || accounting.historical_or_pre_registration_scoring_permitted !== false
    || accounting.performance_family_membership
      !== "SEPARATE_UNSCORED_OPTIONS_SHADOW_CHALLENGER") {
    fail("Attempt 116 trial accounting changed");
  }

  const publication = plainObject(value.publication_boundary, "Attempt 116 publication boundary");
  if (publication.platform !== "github"
    || publication.public_commit_must_include_exact_protocol_and_implementation !== true
    || publication.public_registration_receipt_required_before_prospective_input !== true
    || publication.public_registration_receipt_observation_required_before_prospective_input
      !== true
    || publication.public_registration_receipt_verified_by_this_pure_compiler !== false
    || canonicalInstant(publication.publication_deadline, "Attempt 116 publication deadline")
      !== ATTEMPT116_PUBLICATION_DEADLINE
    || publication.publication_deadline_exclusive !== true
    || publication.separate_per_signal_anchor_required !== false
    || JSON.stringify(publication.required_artifact_paths) !== JSON.stringify(REQUIRED_ARTIFACT_PATHS)) {
    fail("Attempt 116 publication boundary changed");
  }

  const first = plainObject(value.first_eligible_input, "Attempt 116 first eligible input");
  if (first.session_date !== ATTEMPT116_FIRST_ELIGIBLE_SESSION
    || canonicalInstant(first.not_before, "Attempt 116 first eligible input time")
      !== ATTEMPT116_FIRST_ELIGIBLE_INPUT_AT
    || first.completed_underlying_history_last_session_on_or_before
      !== ATTEMPT116_LAST_PRE_REGISTRATION_HISTORY_SESSION
    || first.must_be_strictly_after_public_registration !== true
    || first.pre_registration_market_snapshot_eligible !== false
    || first.pre_registration_signal_eligible !== false
    || first.pre_registration_outcome_eligible !== false
    || first.existing_historical_bundle_eligible_for_scoring !== false
    || first.retrospective_runner_permitted !== false) {
    fail("Attempt 116 first eligible input or hindsight boundary changed");
  }

  const source = plainObject(value.source_basis, "Attempt 116 source basis");
  if (source.repository !== "https://github.com/Ander-IbBi/alpaca-vrp-engine"
    || source.commit !== "84d6bff500b53a27cb2743a870b9533fc7d5c098"
    || source.tree !== "bf92ba65ec09efdcc276ca07687887912a06b107"
    || source.license !== "MIT"
    || source.license_notice_raw_bytes_sha256
      !== "sha256:97ed157640064056357c7edceb8aeed5db11577dbdd381bdb556759d80ef9935"
    || source.pinned_source_raw_bytes_sha256?.["src/vrp_engine/strategy/signals.py"]
      !== "sha256:85047bb266ac75d18c055a90568a3c8de811583405e26c076b90b81581f97d99"
    || source.principal_signal_source_blob !== "d5c6a8c8764ce7dda74e54b28971c3656f6c4e10"
    || source.independent_implementation !== true) {
    fail("Attempt 116 pinned source identity changed");
  }

  const spec = plainObject(value.signal_specification, "Attempt 116 signal specification");
  if (spec.symbol !== ATTEMPT116_SIGNAL_SPECIFICATION.symbol
    || spec.option_expiry_calendar_dte_minimum_inclusive !== 1
    || spec.option_expiry_calendar_dte_maximum_inclusive !== 9
    || spec.annualization_sessions !== 252
    || spec.required_completed_underlying_bars !== 22
    || spec.close_to_close?.short_window_returns !== 10
    || spec.close_to_close?.long_window_returns !== 21
    || spec.close_to_close?.degrees_of_freedom !== 1
    || spec.parkinson?.window_bars !== 21
    || spec.realized_volatility_blend?.close_to_close_10_weight !== 0.4
    || spec.realized_volatility_blend?.close_to_close_21_weight !== 0.2
    || spec.realized_volatility_blend?.parkinson_21_weight !== 0.4
    || spec.realized_volatility_blend?.missing_component_weight_renormalization_permitted
      !== false
    || spec.atm_implied_volatility?.equal_distance_tie_break !== "lower_strike"
    || spec.atm_implied_volatility?.one_valid_side_permitted !== true
    || spec.atm_implied_volatility?.selected_quotes_are_analytical_references_not_tradable_legs
      !== true
    || spec.relative_gap?.sell_vol_shadow_minimum_inclusive !== 0.15
    || spec.relative_gap?.buy_vol_shadow_maximum_inclusive !== -0.15
    || spec.relative_gap?.statistical_z_score !== false
    || spec.term_slope_blackout?.blackout_threshold !== 0.08
    || spec.term_slope_blackout?.comparison !== "strict_raw_ieee754_greater_than"
    || spec.term_slope_blackout?.equality_blackout !== false
    || spec.term_slope_blackout?.missing_front_or_next_atm_iv_action !== "STAND_DOWN"
    || spec.term_slope_blackout?.overrides_buy_and_sell_shadow_stances !== true
    || spec.market_snapshot_timing?.surface_snapshot_as_of_utc_required !== true
    || spec.market_snapshot_timing?.per_quote_observed_at_required !== true
    || spec.market_snapshot_timing?.per_quote_observed_at_must_equal_surface_snapshot !== true
    || spec.market_snapshot_timing?.prospective_snapshot_not_before_first_eligible_input !== true
    || spec.market_snapshot_timing
      ?.prospective_snapshot_at_or_after_public_registration_receipt_observation !== true
    || spec.market_snapshot_timing?.snapshot_not_after_signal_observation !== true
    || spec.market_snapshot_timing?.surface_and_quote_provider_origin_verified_by_pure_compiler
      !== false
    || spec.market_snapshot_timing?.caller_asserted_source_receipt_hash_required !== true
    || spec.market_snapshot_timing?.quote_underlying_symbol_required !== true
    || spec.market_snapshot_timing?.eligible_expiries_derived_from_sorted_distinct_quote_expiries
      !== true
    || spec.market_snapshot_timing?.caller_asserted_complete_1_to_9_dte_surface_required !== true
    || spec.market_snapshot_timing?.surface_completeness_verified_by_pure_compiler !== false) {
    fail("Attempt 116 signal specification changed");
  }

  exactBooleanMap(value.adaptation_safety_deltas, [
    "complete_windows_required_instead_of_three_observation_minimum",
    "malformed_bars_rejected_instead_of_filtered",
    "missing_component_renormalization_disabled",
    "equal_distance_strike_tie_break_made_deterministic",
    "missing_term_structure_stands_down_instead_of_failing_open",
  ], "Attempt 116 adaptation safety deltas");
  exactBooleanMap(value.excluded_surfaces, [
    "fractional_kelly_excluded",
    "probability_wedge_excluded",
    "expected_value_gate_excluded",
    "option_structure_selection_excluded",
    "tradable_leg_or_order_contract_selection_excluded",
    "quantity_or_notional_sizing_excluded",
    "historical_scoring_excluded",
    "broker_reads_excluded",
    "broker_mutation_excluded",
    "order_construction_excluded",
    "production_integration_excluded",
    "attempt115_modification_excluded",
  ], "Attempt 116 excluded surfaces");

  const authority = plainObject(value.authority, "Attempt 116 authority");
  if (authority.real_data_runner_enabled !== false
    || authority.network_requests_permitted !== false
    || authority.broker_reads_permitted !== false
    || authority.broker_mutation_authorized !== false
    || authority.order_construction_authorized !== false
    || authority.contract_selection_authorized !== false
    || authority.quantity_or_notional_sizing_authorized !== false
    || authority.capital_allocation_authorized !== false
    || authority.retrospective_evaluation_authorized !== false
    || authority.performance_inference_authorized !== false
    || authority.production_policy_modification_authorized !== false
    || authority.attempt115_modification_authorized !== false) {
    fail("Attempt 116 authority changed");
  }
  if (Object.values(authority).some((flag) => flag !== false)) {
    fail("Every Attempt 116 authority flag must remain false");
  }
  const gates = plainObject(value.evaluation_gates, "Attempt 116 evaluation gates");
  if (Object.values(gates).some((gate) => gate !== false)) {
    fail("Attempt 116 evaluation gates must remain false at registration");
  }
  if (typeof value.claim_boundary !== "string"
    || !value.claim_boundary.includes("establishes no profitability")) {
    fail("Attempt 116 claim boundary changed");
  }
  return value;
}

export async function loadProspectiveAttempt116Protocol({
  projectRoot = REPOSITORY_ROOT,
} = {}) {
  const bytes = await readRegularFileWithoutSymlink(
    projectRoot,
    ATTEMPT116_PROTOCOL_RELATIVE_PATH,
  );
  if (rawBytesSha256(bytes) !== ATTEMPT116_PROTOCOL_RAW_BYTES_SHA256) {
    fail("Attempt 116 protocol raw bytes changed");
  }
  let protocol;
  try {
    protocol = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`Attempt 116 protocol is not valid JSON: ${error.message}`);
  }
  if (bytes.toString("utf8") !== canonicalProspectiveAttempt116ProtocolJson(protocol)) {
    fail("Attempt 116 protocol is not canonical pretty JSON with one trailing newline");
  }
  return validateProspectiveAttempt116Protocol(protocol);
}

export async function verifyProspectiveAttempt116ProtocolBytes(options = {}) {
  const protocol = await loadProspectiveAttempt116Protocol(options);
  const receiptBody = {
    attempt_id: ATTEMPT116_ID,
    path: ATTEMPT116_PROTOCOL_RELATIVE_PATH,
    raw_bytes_sha256: ATTEMPT116_PROTOCOL_RAW_BYTES_SHA256,
    protocol_sha256: protocol.protocol_sha256,
    canonical_bytes_verified: true,
    public_registration_verified: false,
    real_data_runner_enabled: false,
    broker_or_order_authority: false,
    historical_scoring_permitted: false,
  };
  return Object.freeze({ ...receiptBody, receipt_sha256: sha256(receiptBody) });
}
