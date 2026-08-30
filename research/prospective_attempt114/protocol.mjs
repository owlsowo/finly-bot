import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, stableStringify } from "../../lib/canonical.mjs";
import { CURRENT_ECONOMIC_DECISION_PROTOCOL } from "../../lib/economic_research.mjs";
import {
  validateForwardTrialLiveActivation,
  validateForwardTrialLiveImplementationBinding,
} from "../forward_trial_live_core.mjs";
import protocolJson from "./protocol.json" with { type: "json" };

export const ATTEMPT114_PROTOCOL_SCHEMA = "finly_attempt114_prospective_profitability_protocol.v1";
export const ATTEMPT114_PROTOCOL_ID = "finly_prospective_profitability_attempt_114";
export const ATTEMPT114_PROTOCOL_RELATIVE_PATH = "research/prospective_attempt114/protocol.json";
export const ATTEMPT114_FIRST_SIGNAL_CLOSE_AT = "2026-08-31T20:00:00.000Z";
export const ATTEMPT114_PROTOCOL_SHA256 =
  "sha256:a1eb1b3304920f72606d2bb710adb9e5580a213cda1df51a776aa55940f7f311";

export const ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256 = Object.freeze({
  "research/champion_trial_ledger_generation6.json":
    "sha256:f1b35f0b6ff50888b4ca7dbb6c1bb46258af081c09cf344d44adc88753991ecf",
  "research/forward_trial_live/activation.json":
    "sha256:ecf7a16fbe84061799b8df6db7b58e8b8b0f028e8d7a4c4147b08b20d45a6180",
  "research/forward_trial_live/runtime_manifest.json":
    "sha256:c5df20d6bc9908d89cfef46b0d3c1901688a25835e22fa87f14e7c73cf6c3d1c",
  "lib/canonical.mjs":
    "sha256:05d7803cff866893f3c97e3b15ee49cbd46eb2376c63a06fe142f8589a7e0904",
  "lib/economic_research.mjs":
    "sha256:efde15977d43fb5556683ce7ba5ca7fe29fa82a1cc6acd9632d8f6e6fc5c1256",
  "lib/forward_market_data.mjs":
    "sha256:a7d8597f3733817fed3420b07ca2a51fece15f4b37b69d5b4e462ec6e9dfc053",
  "research/forward_trial_live_core.mjs":
    "sha256:ef8651fe4ada18045dd8765f30746936254917f599d89d1bd89f514c9e43f523",
  "research/run_forward_trial_live.mjs":
    "sha256:221fd0f6a2ce17041f5984cfc68baa6b68648337ccf678e758640d929d318fea",
  "lib/equity_shadow_execution.mjs":
    "sha256:0bac7898f61acdcef9ace0807ffc0376c37bee8d2d8d886672de38de645ff5d0",
  "research/champion_generation6_robustness.mjs":
    "sha256:a3cce0a77537495d9599b5a7c58da9d0f052c67bcbfa65b3626a655add2144ba",
  "research/forward_trial1.mjs":
    "sha256:acd6b07f61a37624534c98472c315f732bf51bc4bdf50764cfacb4c0d8224528",
});

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "attempt_id",
  "attempt_number",
  "entry_kind",
  "status",
  "frozen_at",
  "research_attempt_registration",
  "upstream_capture_binding",
  "policy_binding",
  "sample",
  "prospectivity_evidence",
  "authority",
  "accounting",
  "ledgers",
  "session_60_checkpoint",
  "primary_inference",
  "volatility_matched_spy_bil_decomposition",
  "persistence",
  "runtime_freeze_requirement",
  "state_machine",
  "claim_boundary",
  "protocol_sha256",
]);

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exactKeys(value, expected, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}

function same(actual, expected, label) {
  if (stableStringify(actual) !== stableStringify(expected)) fail(`${label} changes the frozen protocol`);
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a canonical SHA-256 digest`);
  return value;
}

function instant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function rawBytesSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function prospectiveAttempt114ProtocolBody(value) {
  object(value, "Attempt 114 protocol");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "protocol_sha256"));
}

export function hashProspectiveAttempt114Protocol(value) {
  return sha256(prospectiveAttempt114ProtocolBody(value));
}

export function canonicalProspectiveAttempt114ProtocolJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateProspectiveAttempt114Protocol(value) {
  exactKeys(value, TOP_LEVEL_KEYS, "Attempt 114 protocol");
  if (value.schema_version !== ATTEMPT114_PROTOCOL_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.attempt_number !== 114
    || value.entry_kind !== "PRE_SIGNAL_EVALUATION_FREEZE"
    || value.status !== "FROZEN_PRE_SIGNAL_RUNTIME_MANIFEST_REQUIRED") {
    fail("Attempt 114 protocol envelope is invalid");
  }

  const frozenAt = instant(value.frozen_at, "Attempt 114 frozen_at");
  if (frozenAt >= ATTEMPT114_FIRST_SIGNAL_CLOSE_AT) {
    fail("Attempt 114 was not frozen strictly before its first signal close");
  }

  same(value.research_attempt_registration, {
    prior_ledger_path: "research/champion_trial_ledger_generation6.json",
    prior_ledger_raw_bytes_sha256:
      "sha256:f1b35f0b6ff50888b4ca7dbb6c1bb46258af081c09cf344d44adc88753991ecf",
    prior_append_only_through: 113,
    attempt_role: "PROSPECTIVE_CONFIRMATORY_EVALUATION_OF_FROZEN_INCUMBENT",
    new_policy_introduced: false,
    candidate_count: 1,
  }, "Attempt 114 registration");

  const capture = object(value.upstream_capture_binding, "Attempt 114 upstream binding");
  if (capture.source_trial_id !== "finly_forward_trial_live_1a") fail("Attempt 114 changes source trial");
  same(capture.activation, {
    path: "research/forward_trial_live/activation.json",
    raw_bytes_sha256:
      "sha256:ecf7a16fbe84061799b8df6db7b58e8b8b0f028e8d7a4c4147b08b20d45a6180",
    activation_sha256:
      "sha256:a9ad429e2094d7cb59300bab18727306121554b62ac112a8e297ce9e12b2800d",
    first_signal_session: "2026-08-31",
    first_signal_market_close_at: ATTEMPT114_FIRST_SIGNAL_CLOSE_AT,
    initial_state_sha256:
      "sha256:9739a30cb105b3a97f2ff942437fd747373c7eb65f056dd242e8a38628816ee0",
    evaluation_gates: { settlement_enabled: false, inference_enabled: false },
  }, "Attempt 114 activation binding");
  same(capture.runtime_manifest, {
    path: "research/forward_trial_live/runtime_manifest.json",
    raw_bytes_sha256:
      "sha256:c5df20d6bc9908d89cfef46b0d3c1901688a25835e22fa87f14e7c73cf6c3d1c",
    manifest_sha256:
      "sha256:9ab2b2d7b3e788880db9d6de1212fa485967472b1f0fae5963c6c51f88912457",
    runtime_source_files_sha256:
      "sha256:16994805d9d7bd2d8912290d7782c00bbf8ab5d5e43e0c807e69ac097dc25d94",
    runtime_source_files: {
      "lib/canonical.mjs": ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["lib/canonical.mjs"],
      "lib/economic_research.mjs": ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["lib/economic_research.mjs"],
      "lib/forward_market_data.mjs": ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["lib/forward_market_data.mjs"],
      "research/forward_trial_live_core.mjs":
        ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["research/forward_trial_live_core.mjs"],
      "research/run_forward_trial_live.mjs":
        ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["research/run_forward_trial_live.mjs"],
    },
  }, "Attempt 114 runtime binding");
  same(capture.formula, {
    implementation: "buildCurrentEconomicDecision",
    policy_id: "tsmom_ensemble_vol",
    protocol_sha256:
      "sha256:215505acbe654021c792321e1fcd1bc4045b88c361d035cda3771bb08febb3ee",
  }, "Attempt 114 formula binding");
  same(capture.supporting_source_files, {
    "lib/equity_shadow_execution.mjs":
      ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["lib/equity_shadow_execution.mjs"],
    "research/champion_generation6_robustness.mjs":
      ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["research/champion_generation6_robustness.mjs"],
    "research/forward_trial1.mjs":
      ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["research/forward_trial1.mjs"],
  }, "Attempt 114 supporting-source binding");
  same(capture.pre_signal_head, {
    observed_at: frozenAt,
    status: "ACTIVATION_VERIFIED_AWAITING_FIRST_SIGNAL",
    public_signal_anchors: 0,
    private_signal_commitments_available: 0,
    public_chain_sha256:
      "sha256:4d4377d1e236c88b1f7d03de68a6157586ad124b22242c4680ca3828cd83eff4",
    local_snapshot_only: true,
  }, "Attempt 114 pre-signal head");

  const policy = object(value.policy_binding, "Attempt 114 policy binding");
  if (policy.implementation !== "buildCurrentEconomicDecision"
    || policy.policy_id !== "tsmom_ensemble_vol"
    || policy.protocol_sha256 !== capture.formula.protocol_sha256
    || stableStringify(policy.symbols) !== stableStringify(["SPY", "BIL"])
    || stableStringify(policy.trend_horizons_sessions) !== stableStringify([21, 63, 252])
    || policy.volatility_lookback_sessions !== 20
    || policy.target_annualized_volatility !== 0.1
    || policy.rebalance_interval_sessions !== 5
    || policy.minimum_spy_weight !== 0
    || policy.maximum_spy_weight !== 1
    || policy.remaining_weight_asset !== "BIL"
    || policy.policy_change_permitted !== false
    || policy.result_can_change_policy !== false
    || policy.incumbent_after_every_terminal_state !== "tsmom_ensemble_vol") {
    fail("Attempt 114 changes the frozen incumbent policy");
  }

  const sample = object(value.sample, "Attempt 114 sample");
  if (sample.required_signal_commitments !== 254
    || sample.required_settlements !== 252
    || sample.first_signal_commitment_sequence !== 1
    || sample.first_return_start_session !== "2026-09-01"
    || sample.consecutive_official_sessions_required !== true
    || sample.no_skips !== true
    || sample.no_backfill !== true
    || sample.replacement_window_permitted !== false
    || sample.optional_stopping_permitted !== false
    || sample.settlements_after_252_used_by_primary !== false) {
    fail("Attempt 114 changes its exact 254/252 consecutive N/N+1/N+2 sample");
  }
  if (!sample.settlement_mapping.includes("N+1") || !sample.settlement_mapping.includes("N+2")
    || !sample.earned_return_mapping.includes("S_N+1")
    || !sample.earned_return_mapping.includes("S_N+2")) {
    fail("Attempt 114 omits its causal N/N+1/N+2 timing contract");
  }

  const prospectivity = object(value.prospectivity_evidence, "Attempt 114 prospectivity evidence");
  if (prospectivity.local_timestamp_hash_chain_or_unverified_manifest_sufficient !== false
    || prospectivity.protocol_and_runtime_pre_signal_independent_publication_required !== true
    || prospectivity.protocol_and_runtime_independent_publication_verified_at_freeze !== false
    || prospectivity.commitment_anchor_requirement
      !== "ALL_FIRST_254_SIGNAL_COMMITMENTS_INDEPENDENTLY_VERIFIED_BEFORE_THEIR_EXECUTION_CLOSES"
    || prospectivity.commitment_anchor_count_required !== 254
    || prospectivity.commitment_anchor_sequence !== "1 through 254 inclusive"
    || prospectivity.one_to_one_anchor_to_commitment_required !== true
    || prospectivity.anchor_must_bind.length !== 10
    || prospectivity.anchor_publication_deadline
      !== "strictly before each commitment's execution close S_N+1"
    || prospectivity.accepted_independent_mechanisms.length !== 3
    || prospectivity.local_public_anchor_file_alone_sufficient !== false
    || prospectivity.external_verification_receipt_required !== true
    || prospectivity.provider_origin_verified_at_freeze !== false
    || prospectivity.outcome_price_lineage_independent_reconciliation_required !== true
    || prospectivity.outcome_price_lineage_status_at_freeze !== "NOT_YET_AVAILABLE_ZERO_SIGNAL"
    || prospectivity.settlement_gate
      !== "CLOSED_UNTIL_EACH_PRE_EXECUTION_ANCHOR_AND_CORRESPONDING_OUTCOME_PRICE_LINEAGE_VERIFY"
    || prospectivity.inference_gate
      !== "CLOSED_UNTIL_ALL_FIRST_254_PRE_EXECUTION_ANCHORS_AND_ALL_FIRST_252_OUTCOME_PRICE_LINEAGES_VERIFY") {
    fail("Attempt 114 lacks independently verified prospective commitment and outcome-price evidence");
  }

  same(value.authority, {
    research_only: true,
    broker_reads_permitted_by_protocol_validator: false,
    sanitized_read_only_broker_snapshot_ingest_permitted_in_future_ledger: true,
    broker_mutation_authorized: false,
    order_payload: null,
    place_cancel_replace_routes_permitted: false,
    credentials_may_be_persisted: false,
  }, "Attempt 114 authority");

  const accounting = object(value.accounting, "Attempt 114 accounting");
  if (accounting.currency !== "USD"
    || accounting.initial_equity_per_book !== 100000
    || stableStringify(accounting.initial_weights) !== stableStringify({ SPY: 0, BIL: 1 })
    || accounting.fractional_units !== true
    || accounting.one_way_cost_bps_per_absolute_traded_notional !== 5
    || accounting.spy_initial_entry_turnover_notional !== 2
    || accounting.spy_initial_entry_cost_return !== 0.001
    || accounting.terminal_liquidation !== false
    || !accounting.hold_semantics.startsWith("HOLD uses drifted prior closing weights")
    || accounting.modeled_cost_return_formula !== "turnover_notional * 5 / 10000") {
    fail("Attempt 114 changes its frozen five-basis-point accounting");
  }

  const adjusted = object(value.ledgers?.adjusted_theoretical, "Attempt 114 adjusted ledger");
  const paper = object(value.ledgers?.alpaca_paper_cash_equity, "Attempt 114 paper ledger");
  const joint = object(value.ledgers?.joint_interval_bundle, "Attempt 114 joint ledger bundle");
  if (adjusted.available_in_this_release !== false
    || adjusted.primary_inference_source !== true
    || adjusted.raw_broker_prices_permitted !== false
    || adjusted.broker_fills_claimed !== false
    || paper.available_in_this_release !== false
    || paper.evidence_class !== "MODELED_PAPER_SHADOW_NOT_BROKER_EXECUTION"
    || paper.builder_raw_bytes_sha256
      !== ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["lib/equity_shadow_execution.mjs"]
    || paper.valuation_basis !== "cash_plus_quantity_times_broker_raw_price"
    || paper.used_for_order_sizing !== true
    || paper.adjusted_theoretical_return_used_for_order_sizing !== false
    || paper.adjusted_theoretical_return_used_for_broker_cash_equity !== false
    || paper.primary_inference_source !== false
    || paper.preview_only !== true
    || paper.broker_execution_verified !== false
    || joint.available_in_this_release !== false
    || joint.binds_both_independent_ledger_heads !== true) {
    fail("Attempt 114 mixes the adjusted theoretical and Alpaca paper cash-equity ledgers");
  }

  const checkpoint = object(value.session_60_checkpoint, "Attempt 114 session-60 checkpoint");
  if (checkpoint.checkpoint_kind !== "SESSION_60_ENGINEERING_ONLY"
    || checkpoint.settlements_verified !== 60
    || checkpoint.signal_commitments_required !== 62
    || checkpoint.performance_fields_present !== false
    || checkpoint.policy_change_permitted !== false
    || checkpoint.cost_change_permitted !== false
    || checkpoint.endpoint_change_permitted !== false
    || checkpoint.sample_change_permitted !== false
    || checkpoint.fatal_problem_disposition !== "TERMINATE_ATTEMPT_114_AND_REGISTER_ATTEMPT_115"
    || checkpoint.allowed_outputs.length !== 9
    || checkpoint.forbidden_outputs.length !== 7) {
    fail("Attempt 114 changes the engineering-only session-60 checkpoint");
  }

  const primary = object(value.primary_inference, "Attempt 114 primary inference");
  if (primary.book !== "incumbent_tsmom_ensemble_vol"
    || primary.comparator !== "spy_buy_hold"
    || primary.intervals !== 252
    || primary.endpoint !== "mean daily net log-return difference"
    || primary.daily_value_formula
      !== "log1p(incumbent_net_simple_return) - log1p(spy_net_simple_return)"
    || primary.null_hypothesis !== "mean daily net log-return difference <= 0"
    || primary.test !== "one-sided null-centered stationary block bootstrap"
    || primary.bootstrap_seed_uint32 !== 20260829
    || primary.bootstrap_resamples !== 4999
    || primary.expected_block_sessions !== 20
    || primary.restart_probability !== 0.05
    || primary.p_value_formula !== "(1 + exceedances) / 5000"
    || primary.equality_counts_as_exceedance !== true
    || primary.alpha !== 0.05
    || primary.within_trial_multiplicity !== "ONE_PRIMARY_ENDPOINT"
    || primary.repeat_confirmatory_test_permitted !== false
    || primary.result_changes_incumbent_policy !== false) {
    fail("Attempt 114 changes its single primary net-log-return test");
  }

  const decomposition = object(
    value.volatility_matched_spy_bil_decomposition,
    "Attempt 114 volatility-matched decomposition",
  );
  if (decomposition.role !== "DESCRIPTIVE_CAUSAL_DECOMPOSITION_NOT_PRIMARY"
    || decomposition.implementation !== "buildCausalVolatilityMatchedSpyComparator"
    || decomposition.candidate_id !== "incumbent_tsmom_ensemble_vol"
    || decomposition.spy_id !== "spy_buy_hold"
    || decomposition.cash_id !== "bil_cash"
    || decomposition.comparator_id !== "volatility_matched_spy_incumbent_tsmom_ensemble_vol"
    || decomposition.input_return_field !== "net_return"
    || decomposition.input_returns_include_frozen_book_costs !== true
    || decomposition.source_raw_bytes_sha256
      !== ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256["research/champion_generation6_robustness.mjs"]
    || decomposition.source_emitted_role !== "primary_risk_matched_gate"
    || decomposition.source_emitted_role_adopted_by_attempt_114 !== false
    || decomposition.future_descriptive_wrapper_output_role
      !== "DESCRIPTIVE_CAUSAL_DECOMPOSITION_NOT_PRIMARY"
    || decomposition.future_descriptive_wrapper_required !== true
    || decomposition.lookback_sessions !== 63
    || decomposition.rebalance_interval_sessions !== 21
    || decomposition.rebalance_anchor !== 0
    || decomposition.minimum_spy_weight !== 0
    || decomposition.maximum_spy_weight !== 1.5
    || decomposition.residual_asset !== "BIL"
    || decomposition.one_way_cost_bps_per_absolute_traded_notional !== 5
    || decomposition.annual_borrow_spread !== 0.005
    || decomposition.terminal_liquidation !== false
    || decomposition.scoring_start_interval !== 64
    || decomposition.scored_intervals !== 189
    || decomposition.warmup_intervals !== 63
    || decomposition.full_window_identity_units !== "sums of net log returns"
    || decomposition.full_window_identity
      !== "sum[1..252](log1p(finly_net)-log1p(spy_net)) = sum[1..63](log1p(finly_net)-log1p(spy_net)) + sum[64..252](log1p(finly_net)-log1p(volatility_matched_net)) + sum[64..252](log1p(volatility_matched_net)-log1p(spy_net))"
    || decomposition.maximum_absolute_identity_error !== 1e-12
    || decomposition.p_value_permitted !== false
    || decomposition.can_replace_primary_comparator !== false) {
    fail("Attempt 114 changes its descriptive volatility-matched SPY/BIL decomposition");
  }

  const persistence = object(value.persistence, "Attempt 114 persistence");
  if (persistence.canonicalization !== "lib/canonical.mjs stableStringify"
    || persistence.digest !== "SHA-256 with sha256: prefix"
    || persistence.protocol_hash_excludes_only !== "protocol_sha256"
    || persistence.append_only !== true
    || persistence.write_once_required !== true
    || persistence.content_addressed_filenames_required !== true
    || persistence.atomic_hard_link_publication_required !== true
    || persistence.fsync_before_link_required !== true
    || persistence.full_chain_reopen_after_write_required !== true
    || persistence.symlink_traversal_forbidden !== true
    || persistence.unknown_fields_forbidden !== true) {
    fail("Attempt 114 weakens its persistence contract");
  }

  const runtime = object(value.runtime_freeze_requirement, "Attempt 114 runtime-freeze requirement");
  if (runtime.status !== "REQUIRED_NEXT_STEP_BEFORE_FIRST_SIGNAL"
    || runtime.future_path !== "research/prospective_attempt114/runtime_manifest.json"
    || runtime.must_bind_protocol_raw_bytes !== true
    || runtime.must_bind_protocol_sha256 !== true
    || runtime.must_bind_validator_source !== true
    || runtime.must_bind_equity_shadow_source !== true
    || runtime.must_bind_future_settlement_sources_before_they_run !== true
    || runtime.must_bind_future_decomposition_wrapper_source !== true
    || runtime.protocol_and_runtime_publication_deadline !== ATTEMPT114_FIRST_SIGNAL_CLOSE_AT
    || runtime.publication_deadline_is_exclusive !== true
    || runtime.independent_cryptographic_timestamp_verified !== false
    || runtime.inference_gate
      !== "CLOSED_UNTIL_PROTOCOL_RUNTIME_PRE_SIGNAL_PUBLICATION_AND_ALL_254_INDEPENDENT_PRE_EXECUTION_ANCHORS_AND_ALL_252_OUTCOME_PRICE_LINEAGES_VERIFY") {
    fail("Attempt 114 opens its runtime gate before a separate pre-signal runtime freeze");
  }

  const machine = object(value.state_machine, "Attempt 114 state machine");
  if (machine.initial_state !== "PRE_SIGNAL_FROZEN_LOCAL"
    || machine.nonterminal_states.length !== 6
    || machine.terminal_states.length !== 4
    || machine.allowed_transitions.length !== 9
    || Object.keys(object(machine.transition_guards, "Attempt 114 transition guards")).length !== 4
    || machine.fail_closed_conditions.length !== 15
    || !machine.allowed_transitions.includes("ANY_NONTERMINAL->TERMINAL_INCOMPLETE_INTEGRITY_FAILURE")
    || machine.terminal_restart_permitted !== false
    || machine.integrity_failure_is_outcome_independent !== true) {
    fail("Attempt 114 changes its fail-closed state machine");
  }

  digest(value.protocol_sha256, "Attempt 114 protocol hash");
  const computed = hashProspectiveAttempt114Protocol(value);
  if (value.protocol_sha256 !== computed) fail("Attempt 114 protocol self-hash is invalid");
  if (computed !== ATTEMPT114_PROTOCOL_SHA256) fail("Attempt 114 protocol differs from the immutable freeze");
  return value;
}

async function readRegularFileWithoutSymlink(projectRoot, relativePath) {
  if (typeof relativePath !== "string"
    || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.startsWith("../")
    || relativePath.includes("/../")) {
    fail(`unsafe repository-relative path: ${relativePath}`);
  }
  const root = await realpath(projectRoot);
  let cursor = root;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) fail(`${relativePath} traverses a symbolic link`);
    if (index < parts.length - 1 && !metadata.isDirectory()) fail(`${relativePath} has a non-directory parent`);
    if (index === parts.length - 1 && !metadata.isFile()) fail(`${relativePath} is not a regular file`);
  }
  return readFile(cursor);
}

export async function loadProspectiveAttempt114Protocol({
  projectRoot = REPOSITORY_ROOT,
  protocolPath = ATTEMPT114_PROTOCOL_RELATIVE_PATH,
} = {}) {
  const bytes = await readRegularFileWithoutSymlink(projectRoot, protocolPath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`Attempt 114 protocol is not valid JSON: ${error.message}`);
  }
  validateProspectiveAttempt114Protocol(value);
  if (bytes.toString("utf8") !== canonicalProspectiveAttempt114ProtocolJson(value)) {
    fail("Attempt 114 protocol bytes are not canonical pretty JSON with one trailing newline");
  }
  return deepFreeze(value);
}

export async function verifyProspectiveAttempt114UpstreamBytes({ projectRoot = REPOSITORY_ROOT } = {}) {
  const protocol = await loadProspectiveAttempt114Protocol({ projectRoot });
  const verified = {};
  for (const [relativePath, expectedHash] of Object.entries(ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256)) {
    const bytes = await readRegularFileWithoutSymlink(projectRoot, relativePath);
    const actualHash = rawBytesSha256(bytes);
    if (actualHash !== expectedHash) fail(`${relativePath} raw bytes no longer match the Attempt 114 freeze`);
    verified[relativePath] = actualHash;
  }

  const activation = JSON.parse((await readRegularFileWithoutSymlink(
    projectRoot,
    protocol.upstream_capture_binding.activation.path,
  )).toString("utf8"));
  const runtimeManifest = JSON.parse((await readRegularFileWithoutSymlink(
    projectRoot,
    protocol.upstream_capture_binding.runtime_manifest.path,
  )).toString("utf8"));
  validateForwardTrialLiveActivation(activation);
  validateForwardTrialLiveImplementationBinding(runtimeManifest, { activation });
  if (activation.activation_sha256 !== protocol.upstream_capture_binding.activation.activation_sha256
    || runtimeManifest.manifest_sha256
      !== protocol.upstream_capture_binding.runtime_manifest.manifest_sha256
    || sha256(activation.payload.initial_state)
      !== protocol.upstream_capture_binding.activation.initial_state_sha256
    || stableStringify(runtimeManifest.runtime_source_files)
      !== stableStringify(protocol.upstream_capture_binding.runtime_manifest.runtime_source_files)
    || runtimeManifest.runtime_source_files_sha256
      !== protocol.upstream_capture_binding.runtime_manifest.runtime_source_files_sha256
    || sha256(CURRENT_ECONOMIC_DECISION_PROTOCOL)
      !== protocol.upstream_capture_binding.formula.protocol_sha256) {
    fail("Attempt 114 semantic upstream binding is invalid");
  }

  const priorLedger = JSON.parse((await readRegularFileWithoutSymlink(
    projectRoot,
    protocol.research_attempt_registration.prior_ledger_path,
  )).toString("utf8"));
  if (priorLedger.append_only_through !== 113) fail("Attempt 114 no longer follows the trial ledger through 113");

  const receiptBody = {
    schema_version: "finly_attempt114_protocol_verification_receipt.v1",
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    upstream_raw_bytes_sha256: verified,
    upstream_files_verified: Object.keys(verified).length,
    frozen_before_first_signal_close: protocol.frozen_at < ATTEMPT114_FIRST_SIGNAL_CLOSE_AT,
    source_settlement_and_inference_gates_closed: true,
    attempt114_runtime_manifest_creation_required: true,
    all_254_independent_pre_execution_anchor_receipts_required: true,
    all_252_outcome_price_lineages_required: true,
    broker_mutation_authorized: false,
  };
  return deepFreeze({ ...receiptBody, receipt_sha256: sha256(receiptBody) });
}

export const ATTEMPT114_PROTOCOL = deepFreeze(
  validateProspectiveAttempt114Protocol(structuredClone(protocolJson)),
);
