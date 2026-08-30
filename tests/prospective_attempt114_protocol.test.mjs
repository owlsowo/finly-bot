import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ATTEMPT114_FIRST_SIGNAL_CLOSE_AT,
  ATTEMPT114_PROTOCOL,
  ATTEMPT114_PROTOCOL_ID,
  ATTEMPT114_PROTOCOL_RELATIVE_PATH,
  ATTEMPT114_PROTOCOL_SCHEMA,
  ATTEMPT114_PROTOCOL_SHA256,
  ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256,
  canonicalProspectiveAttempt114ProtocolJson,
  loadProspectiveAttempt114Protocol,
  validateProspectiveAttempt114Protocol,
  verifyProspectiveAttempt114UpstreamBytes,
} from "../research/prospective_attempt114/protocol.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROTOCOL_PATH = path.join(PROJECT_ROOT, ATTEMPT114_PROTOCOL_RELATIVE_PATH);
const EXPECTED_PROTOCOL_RAW_BYTES_SHA256 =
  "sha256:794bb93d578b4b4766daac1c27d7fa0a68f730fbeda853b208aa98ad501572ff";
const EXPECTED_UPSTREAM = {
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
};

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
  const bytes = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : independentStableStringify(value);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function independentProtocolHash(value) {
  const body = structuredClone(value);
  delete body.protocol_sha256;
  return independentHash(body);
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

async function makeTemporaryProject(t, paths = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "finly-attempt114-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relativePath of paths) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(PROJECT_ROOT, relativePath), destination);
  }
  return root;
}

test("Attempt 114 canonical freeze independently verifies every bound hash and before-close timestamp", async () => {
  const bytes = await readFile(PROTOCOL_PATH);
  const value = JSON.parse(bytes.toString("utf8"));

  assert.equal(independentHash(bytes), EXPECTED_PROTOCOL_RAW_BYTES_SHA256);
  assert.equal(bytes.toString("utf8"), `${JSON.stringify(value, null, 2)}\n`);
  assert.equal(value.schema_version, ATTEMPT114_PROTOCOL_SCHEMA);
  assert.equal(value.attempt_id, ATTEMPT114_PROTOCOL_ID);
  assert.equal(value.attempt_number, 114);
  assert.equal(value.entry_kind, "PRE_SIGNAL_EVALUATION_FREEZE");
  assert.equal(value.status, "FROZEN_PRE_SIGNAL_RUNTIME_MANIFEST_REQUIRED");
  assert.equal(value.frozen_at, "2026-08-30T04:02:23.484Z");
  assert.equal(new Date(value.frozen_at).toISOString(), value.frozen_at);
  assert.ok(value.frozen_at < ATTEMPT114_FIRST_SIGNAL_CLOSE_AT);
  assert.equal(ATTEMPT114_FIRST_SIGNAL_CLOSE_AT, "2026-08-31T20:00:00.000Z");
  assert.equal(independentProtocolHash(value), ATTEMPT114_PROTOCOL_SHA256);
  assert.equal(value.protocol_sha256, ATTEMPT114_PROTOCOL_SHA256);
  assert.equal(ATTEMPT114_PROTOCOL_SHA256,
    "sha256:a1eb1b3304920f72606d2bb710adb9e5580a213cda1df51a776aa55940f7f311");
  assert.deepEqual(ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256, EXPECTED_UPSTREAM);

  assert.deepEqual(value.research_attempt_registration, {
    prior_ledger_path: "research/champion_trial_ledger_generation6.json",
    prior_ledger_raw_bytes_sha256: EXPECTED_UPSTREAM["research/champion_trial_ledger_generation6.json"],
    prior_append_only_through: 113,
    attempt_role: "PROSPECTIVE_CONFIRMATORY_EVALUATION_OF_FROZEN_INCUMBENT",
    new_policy_introduced: false,
    candidate_count: 1,
  });
  assert.equal(value.upstream_capture_binding.source_trial_id, "finly_forward_trial_live_1a");
  assert.deepEqual(value.upstream_capture_binding.activation, {
    path: "research/forward_trial_live/activation.json",
    raw_bytes_sha256: EXPECTED_UPSTREAM["research/forward_trial_live/activation.json"],
    activation_sha256: "sha256:a9ad429e2094d7cb59300bab18727306121554b62ac112a8e297ce9e12b2800d",
    first_signal_session: "2026-08-31",
    first_signal_market_close_at: "2026-08-31T20:00:00.000Z",
    initial_state_sha256: "sha256:9739a30cb105b3a97f2ff942437fd747373c7eb65f056dd242e8a38628816ee0",
    evaluation_gates: { settlement_enabled: false, inference_enabled: false },
  });
  assert.equal(value.upstream_capture_binding.runtime_manifest.raw_bytes_sha256,
    EXPECTED_UPSTREAM["research/forward_trial_live/runtime_manifest.json"]);
  assert.equal(value.upstream_capture_binding.runtime_manifest.manifest_sha256,
    "sha256:9ab2b2d7b3e788880db9d6de1212fa485967472b1f0fae5963c6c51f88912457");
  assert.equal(value.upstream_capture_binding.runtime_manifest.runtime_source_files_sha256,
    "sha256:16994805d9d7bd2d8912290d7782c00bbf8ab5d5e43e0c807e69ac097dc25d94");
  assert.deepEqual(value.upstream_capture_binding.runtime_manifest.runtime_source_files,
    Object.fromEntries(Object.entries(EXPECTED_UPSTREAM).slice(3, 8)));
  assert.deepEqual(value.upstream_capture_binding.formula, {
    implementation: "buildCurrentEconomicDecision",
    policy_id: "tsmom_ensemble_vol",
    protocol_sha256: "sha256:215505acbe654021c792321e1fcd1bc4045b88c361d035cda3771bb08febb3ee",
  });
  assert.deepEqual(value.upstream_capture_binding.supporting_source_files, {
    "lib/equity_shadow_execution.mjs": EXPECTED_UPSTREAM["lib/equity_shadow_execution.mjs"],
    "research/champion_generation6_robustness.mjs":
      EXPECTED_UPSTREAM["research/champion_generation6_robustness.mjs"],
    "research/forward_trial1.mjs": EXPECTED_UPSTREAM["research/forward_trial1.mjs"],
  });
  assert.deepEqual(value.upstream_capture_binding.pre_signal_head, {
    observed_at: value.frozen_at,
    status: "ACTIVATION_VERIFIED_AWAITING_FIRST_SIGNAL",
    public_signal_anchors: 0,
    private_signal_commitments_available: 0,
    public_chain_sha256: "sha256:4d4377d1e236c88b1f7d03de68a6157586ad124b22242c4680ca3828cd83eff4",
    local_snapshot_only: true,
  });
  assertDeepFrozen(ATTEMPT114_PROTOCOL);
});

test("Attempt 114 freezes policy, 254/252 timing, five-basis-point books, and separated ledgers", () => {
  const value = ATTEMPT114_PROTOCOL;
  assert.deepEqual(value.policy_binding.symbols, ["SPY", "BIL"]);
  assert.deepEqual(value.policy_binding.trend_horizons_sessions, [21, 63, 252]);
  assert.equal(value.policy_binding.volatility_lookback_sessions, 20);
  assert.equal(value.policy_binding.target_annualized_volatility, 0.1);
  assert.equal(value.policy_binding.rebalance_interval_sessions, 5);
  assert.equal(value.policy_binding.minimum_spy_weight, 0);
  assert.equal(value.policy_binding.maximum_spy_weight, 1);
  assert.equal(value.policy_binding.policy_change_permitted, false);
  assert.equal(value.policy_binding.result_can_change_policy, false);

  assert.equal(value.sample.required_signal_commitments, 254);
  assert.equal(value.sample.required_settlements, 252);
  assert.equal(value.sample.first_signal_commitment_sequence, 1);
  assert.equal(value.sample.first_return_start_session, "2026-09-01");
  assert.match(value.sample.settlement_mapping, /N\+1.*N\+2/);
  assert.match(value.sample.earned_return_mapping, /S_N\+1.*S_N\+2/);
  assert.equal(value.sample.consecutive_official_sessions_required, true);
  assert.equal(value.sample.no_skips, true);
  assert.equal(value.sample.no_backfill, true);
  assert.equal(value.sample.replacement_window_permitted, false);
  assert.equal(value.sample.optional_stopping_permitted, false);
  assert.equal(value.sample.settlements_after_252_used_by_primary, false);

  assert.equal(value.prospectivity_evidence.local_timestamp_hash_chain_or_unverified_manifest_sufficient,
    false);
  assert.equal(value.prospectivity_evidence.protocol_and_runtime_pre_signal_independent_publication_required,
    true);
  assert.equal(value.prospectivity_evidence.protocol_and_runtime_independent_publication_verified_at_freeze,
    false);
  assert.equal(value.prospectivity_evidence.commitment_anchor_requirement,
    "ALL_FIRST_254_SIGNAL_COMMITMENTS_INDEPENDENTLY_VERIFIED_BEFORE_THEIR_EXECUTION_CLOSES");
  assert.equal(value.prospectivity_evidence.commitment_anchor_count_required, 254);
  assert.equal(value.prospectivity_evidence.commitment_anchor_sequence, "1 through 254 inclusive");
  assert.equal(value.prospectivity_evidence.one_to_one_anchor_to_commitment_required, true);
  assert.deepEqual(value.prospectivity_evidence.anchor_must_bind, [
    "commitment_sequence",
    "signal_session_date",
    "private_bundle_sha256",
    "previous_private_bundle_sha256",
    "formula_and_runtime_binding",
    "decision_receipt_sha256",
    "action",
    "target_weights",
    "captured_at",
    "execution_close_deadline",
  ]);
  assert.equal(value.prospectivity_evidence.anchor_publication_deadline,
    "strictly before each commitment's execution close S_N+1");
  assert.deepEqual(value.prospectivity_evidence.accepted_independent_mechanisms, [
    "public GitHub Actions/commit publication",
    "RFC 3161 or OpenTimestamps receipt",
    "trusted append service signature",
  ]);
  assert.equal(value.prospectivity_evidence.external_verification_receipt_required, true);
  assert.equal(value.prospectivity_evidence.local_public_anchor_file_alone_sufficient, false);
  assert.equal(value.prospectivity_evidence.provider_origin_verified_at_freeze, false);
  assert.equal(value.prospectivity_evidence.outcome_price_lineage_independent_reconciliation_required, true);
  assert.equal(value.prospectivity_evidence.outcome_price_lineage_status_at_freeze,
    "NOT_YET_AVAILABLE_ZERO_SIGNAL");
  assert.equal(value.prospectivity_evidence.settlement_gate,
    "CLOSED_UNTIL_EACH_PRE_EXECUTION_ANCHOR_AND_CORRESPONDING_OUTCOME_PRICE_LINEAGE_VERIFY");
  assert.equal(value.prospectivity_evidence.inference_gate,
    "CLOSED_UNTIL_ALL_FIRST_254_PRE_EXECUTION_ANCHORS_AND_ALL_FIRST_252_OUTCOME_PRICE_LINEAGES_VERIFY");

  assert.deepEqual(value.accounting.initial_weights, { SPY: 0, BIL: 1 });
  assert.equal(value.accounting.initial_equity_per_book, 100000);
  assert.equal(value.accounting.one_way_cost_bps_per_absolute_traded_notional, 5);
  assert.equal(value.accounting.modeled_cost_return_formula, "turnover_notional * 5 / 10000");
  assert.equal(value.accounting.spy_initial_entry_turnover_notional, 2);
  assert.equal(value.accounting.spy_initial_entry_cost_return, 0.001);
  assert.equal(value.accounting.terminal_liquidation, false);

  assert.equal(value.ledgers.adjusted_theoretical.available_in_this_release, false);
  assert.equal(value.ledgers.adjusted_theoretical.primary_inference_source, true);
  assert.equal(value.ledgers.adjusted_theoretical.raw_broker_prices_permitted, false);
  assert.equal(value.ledgers.alpaca_paper_cash_equity.available_in_this_release, false);
  assert.equal(value.ledgers.alpaca_paper_cash_equity.builder_raw_bytes_sha256,
    EXPECTED_UPSTREAM["lib/equity_shadow_execution.mjs"]);
  assert.equal(value.ledgers.alpaca_paper_cash_equity.valuation_basis,
    "cash_plus_quantity_times_broker_raw_price");
  assert.equal(value.ledgers.alpaca_paper_cash_equity.adjusted_theoretical_return_used_for_order_sizing, false);
  assert.equal(value.ledgers.alpaca_paper_cash_equity.adjusted_theoretical_return_used_for_broker_cash_equity,
    false);
  assert.equal(value.ledgers.alpaca_paper_cash_equity.primary_inference_source, false);
  assert.equal(value.ledgers.alpaca_paper_cash_equity.preview_only, true);
  assert.equal(value.ledgers.alpaca_paper_cash_equity.broker_execution_verified, false);
  assert.equal(value.ledgers.joint_interval_bundle.binds_both_independent_ledger_heads, true);
});

test("Attempt 114 freezes the single primary test, descriptive decomposition, checkpoint, authority, and gates", () => {
  const { primary_inference: primary } = ATTEMPT114_PROTOCOL;
  assert.equal(primary.book, "incumbent_tsmom_ensemble_vol");
  assert.equal(primary.comparator, "spy_buy_hold");
  assert.equal(primary.intervals, 252);
  assert.equal(primary.endpoint, "mean daily net log-return difference");
  assert.equal(primary.daily_value_formula,
    "log1p(incumbent_net_simple_return) - log1p(spy_net_simple_return)");
  assert.equal(primary.null_hypothesis, "mean daily net log-return difference <= 0");
  assert.equal(primary.test, "one-sided null-centered stationary block bootstrap");
  assert.equal(primary.bootstrap_seed_uint32, 20260829);
  assert.equal(primary.bootstrap_resamples, 4999);
  assert.equal(primary.expected_block_sessions, 20);
  assert.equal(primary.restart_probability, 0.05);
  assert.equal(primary.p_value_formula, "(1 + exceedances) / 5000");
  assert.equal(primary.equality_counts_as_exceedance, true);
  assert.equal(primary.alpha, 0.05);
  assert.equal(primary.repeat_confirmatory_test_permitted, false);

  const decomposition = ATTEMPT114_PROTOCOL.volatility_matched_spy_bil_decomposition;
  assert.equal(decomposition.role, "DESCRIPTIVE_CAUSAL_DECOMPOSITION_NOT_PRIMARY");
  assert.equal(decomposition.candidate_id, "incumbent_tsmom_ensemble_vol");
  assert.equal(decomposition.spy_id, "spy_buy_hold");
  assert.equal(decomposition.cash_id, "bil_cash");
  assert.equal(decomposition.comparator_id,
    "volatility_matched_spy_incumbent_tsmom_ensemble_vol");
  assert.equal(decomposition.input_return_field, "net_return");
  assert.equal(decomposition.input_returns_include_frozen_book_costs, true);
  assert.equal(decomposition.source_emitted_role, "primary_risk_matched_gate");
  assert.equal(decomposition.source_emitted_role_adopted_by_attempt_114, false);
  assert.equal(decomposition.future_descriptive_wrapper_output_role,
    "DESCRIPTIVE_CAUSAL_DECOMPOSITION_NOT_PRIMARY");
  assert.equal(decomposition.future_descriptive_wrapper_required, true);
  assert.equal(decomposition.lookback_sessions, 63);
  assert.equal(decomposition.rebalance_interval_sessions, 21);
  assert.equal(decomposition.rebalance_anchor, 0);
  assert.equal(decomposition.minimum_spy_weight, 0);
  assert.equal(decomposition.maximum_spy_weight, 1.5);
  assert.equal(decomposition.residual_asset, "BIL");
  assert.equal(decomposition.one_way_cost_bps_per_absolute_traded_notional, 5);
  assert.equal(decomposition.annual_borrow_spread, 0.005);
  assert.equal(decomposition.scoring_start_interval, 64);
  assert.equal(decomposition.scored_intervals, 189);
  assert.equal(decomposition.warmup_intervals, 63);
  assert.equal(decomposition.full_window_identity_units, "sums of net log returns");
  assert.equal(decomposition.full_window_identity,
    "sum[1..252](log1p(finly_net)-log1p(spy_net)) = sum[1..63](log1p(finly_net)-log1p(spy_net)) + sum[64..252](log1p(finly_net)-log1p(volatility_matched_net)) + sum[64..252](log1p(volatility_matched_net)-log1p(spy_net))");
  assert.equal(decomposition.maximum_absolute_identity_error, 1e-12);
  assert.equal(decomposition.p_value_permitted, false);
  assert.equal(decomposition.can_replace_primary_comparator, false);

  const checkpoint = ATTEMPT114_PROTOCOL.session_60_checkpoint;
  assert.equal(checkpoint.checkpoint_kind, "SESSION_60_ENGINEERING_ONLY");
  assert.equal(checkpoint.settlements_verified, 60);
  assert.equal(checkpoint.signal_commitments_required, 62);
  assert.equal(checkpoint.performance_fields_present, false);
  assert.deepEqual(checkpoint.allowed_outputs, [
    "structural_counts",
    "content_hashes",
    "chain_continuity_booleans",
    "deterministic_replay_booleans",
    "ledger_separation_booleans",
    "external_anchor_verification_booleans",
    "outcome_price_lineage_verification_booleans",
    "credential_scan_boolean",
    "broker_mutation_surface_absent_boolean",
  ]);
  assert.deepEqual(checkpoint.forbidden_outputs, [
    "equity_levels",
    "returns",
    "cumulative_profit_and_loss",
    "spy_return_differences",
    "volatility_decomposition",
    "p_values",
    "profitability_pass_fail_language",
  ]);
  assert.equal(checkpoint.fatal_problem_disposition,
    "TERMINATE_ATTEMPT_114_AND_REGISTER_ATTEMPT_115");

  assert.deepEqual(ATTEMPT114_PROTOCOL.authority, {
    research_only: true,
    broker_reads_permitted_by_protocol_validator: false,
    sanitized_read_only_broker_snapshot_ingest_permitted_in_future_ledger: true,
    broker_mutation_authorized: false,
    order_payload: null,
    place_cancel_replace_routes_permitted: false,
    credentials_may_be_persisted: false,
  });
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.status,
    "REQUIRED_NEXT_STEP_BEFORE_FIRST_SIGNAL");
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.future_path,
    "research/prospective_attempt114/runtime_manifest.json");
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.must_bind_protocol_raw_bytes, true);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.must_bind_protocol_sha256, true);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.must_bind_validator_source, true);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.must_bind_equity_shadow_source, true);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.must_bind_future_settlement_sources_before_they_run,
    true);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.must_bind_future_decomposition_wrapper_source,
    true);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.protocol_and_runtime_publication_deadline,
    ATTEMPT114_FIRST_SIGNAL_CLOSE_AT);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.publication_deadline_is_exclusive, true);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.independent_cryptographic_timestamp_verified, false);
  assert.equal(ATTEMPT114_PROTOCOL.runtime_freeze_requirement.inference_gate,
    "CLOSED_UNTIL_PROTOCOL_RUNTIME_PRE_SIGNAL_PUBLICATION_AND_ALL_254_INDEPENDENT_PRE_EXECUTION_ANCHORS_AND_ALL_252_OUTCOME_PRICE_LINEAGES_VERIFY");
});

test("Attempt 114 state machine is terminal, outcome-independent, and fail-closed", () => {
  const machine = ATTEMPT114_PROTOCOL.state_machine;
  assert.equal(machine.initial_state, "PRE_SIGNAL_FROZEN_LOCAL");
  assert.deepEqual(machine.nonterminal_states, [
    "PRE_SIGNAL_FROZEN_LOCAL",
    "PRE_SIGNAL_PUBLICATION_VERIFIED",
    "CAPTURING_ENGINEERING_ONLY",
    "SESSION_60_CHECKPOINT_DUE",
    "CAPTURING_OBSERVATION_ONLY",
    "FINALIZATION_DUE",
  ]);
  assert.deepEqual(machine.terminal_states, [
    "COMPLETED_PRIMARY_SUPPORT",
    "COMPLETED_PRIMARY_NOT_SUPPORTED",
    "TERMINAL_NOT_PROSPECTIVE",
    "TERMINAL_INCOMPLETE_INTEGRITY_FAILURE",
  ]);
  assert.deepEqual(machine.allowed_transitions, [
    "PRE_SIGNAL_FROZEN_LOCAL->PRE_SIGNAL_PUBLICATION_VERIFIED",
    "PRE_SIGNAL_FROZEN_LOCAL->TERMINAL_NOT_PROSPECTIVE",
    "PRE_SIGNAL_PUBLICATION_VERIFIED->CAPTURING_ENGINEERING_ONLY",
    "CAPTURING_ENGINEERING_ONLY->SESSION_60_CHECKPOINT_DUE",
    "SESSION_60_CHECKPOINT_DUE->CAPTURING_OBSERVATION_ONLY",
    "CAPTURING_OBSERVATION_ONLY->FINALIZATION_DUE",
    "FINALIZATION_DUE->COMPLETED_PRIMARY_SUPPORT",
    "FINALIZATION_DUE->COMPLETED_PRIMARY_NOT_SUPPORTED",
    "ANY_NONTERMINAL->TERMINAL_INCOMPLETE_INTEGRITY_FAILURE",
  ]);
  assert.deepEqual(Object.keys(machine.transition_guards), [
    "PRE_SIGNAL_FROZEN_LOCAL->PRE_SIGNAL_PUBLICATION_VERIFIED",
    "SESSION_60_CHECKPOINT_DUE->CAPTURING_OBSERVATION_ONLY",
    "CAPTURING_OBSERVATION_ONLY->FINALIZATION_DUE",
    "FINALIZATION_DUE->COMPLETED_*",
  ]);
  assert.match(machine.transition_guards["PRE_SIGNAL_FROZEN_LOCAL->PRE_SIGNAL_PUBLICATION_VERIFIED"],
    /strictly before the first signal close/);
  assert.match(machine.transition_guards["SESSION_60_CHECKPOINT_DUE->CAPTURING_OBSERVATION_ONLY"],
    /Exactly 60 settlements and 62.*no performance field/);
  assert.match(machine.transition_guards["CAPTURING_OBSERVATION_ONLY->FINALIZATION_DUE"],
    /Exactly the first 254.*exactly the first 252.*outcome-price lineage/);
  assert.match(machine.transition_guards["FINALIZATION_DUE->COMPLETED_*"],
    /one frozen primary test/);
  assert.equal(machine.fail_closed_conditions.length, 15);
  assert.equal(new Set(machine.fail_closed_conditions).size, 15);
  assert.equal(machine.terminal_restart_permitted, false);
  assert.equal(machine.integrity_failure_is_outcome_independent, true);
});

test("validator rejects independently re-hashed mutation copies across all material boundaries", () => {
  const mutations = [
    (value) => { value.unrecognized = true; },
    (value) => { value.frozen_at = ATTEMPT114_FIRST_SIGNAL_CLOSE_AT; },
    (value) => { value.sample.required_signal_commitments = 253; },
    (value) => { value.sample.required_settlements = 251; },
    (value) => { value.sample.optional_stopping_permitted = true; },
    (value) => { value.prospectivity_evidence.external_verification_receipt_required = false; },
    (value) => { value.accounting.one_way_cost_bps_per_absolute_traded_notional = 4; },
    (value) => { value.ledgers.adjusted_theoretical.primary_inference_source = false; },
    (value) => { value.ledgers.alpaca_paper_cash_equity.adjusted_theoretical_return_used_for_order_sizing = true; },
    (value) => { value.session_60_checkpoint.performance_fields_present = true; },
    (value) => { value.primary_inference.endpoint = "mean simple return"; },
    (value) => { value.volatility_matched_spy_bil_decomposition.can_replace_primary_comparator = true; },
    (value) => { value.authority.broker_mutation_authorized = true; },
    (value) => { value.runtime_freeze_requirement.must_bind_validator_source = false; },
    (value) => { value.state_machine.fail_closed_conditions.pop(); },
    (value) => {
      value.upstream_capture_binding.supporting_source_files["lib/equity_shadow_execution.mjs"] =
        "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(ATTEMPT114_PROTOCOL);
    mutate(copy);
    copy.protocol_sha256 = independentProtocolHash(copy);
    assert.throws(() => validateProspectiveAttempt114Protocol(copy), TypeError);
  }
});

test("loader accepts a disposable exact copy, then rejects canonical mutation and symlink copies", async (t) => {
  const root = await makeTemporaryProject(t, [ATTEMPT114_PROTOCOL_RELATIVE_PATH]);
  const copiedPath = path.join(root, ATTEMPT114_PROTOCOL_RELATIVE_PATH);
  const loaded = await loadProspectiveAttempt114Protocol({ projectRoot: root });
  assert.equal(loaded.protocol_sha256, ATTEMPT114_PROTOCOL_SHA256);

  const changed = structuredClone(loaded);
  changed.primary_inference.bootstrap_resamples = 5001;
  changed.protocol_sha256 = independentProtocolHash(changed);
  await writeFile(copiedPath, `${JSON.stringify(changed, null, 2)}\n`);
  await assert.rejects(loadProspectiveAttempt114Protocol({ projectRoot: root }), TypeError);

  const realCopy = path.join(root, "real-protocol.json");
  await copyFile(PROTOCOL_PATH, realCopy);
  await unlink(copiedPath);
  await symlink(realCopy, copiedPath);
  await assert.rejects(loadProspectiveAttempt114Protocol({ projectRoot: root }), /symbolic link/);
});

test("upstream verifier independently proves frozen bytes and rejects a changed disposable source copy", async (t) => {
  for (const [relativePath, expectedHash] of Object.entries(EXPECTED_UPSTREAM)) {
    assert.equal(independentHash(await readFile(path.join(PROJECT_ROOT, relativePath))), expectedHash);
  }
  const receipt = await verifyProspectiveAttempt114UpstreamBytes({ projectRoot: PROJECT_ROOT });
  assert.equal(receipt.upstream_files_verified, 11);
  assert.deepEqual(receipt.upstream_raw_bytes_sha256, EXPECTED_UPSTREAM);
  assert.equal(receipt.frozen_before_first_signal_close, true);
  assert.equal(receipt.source_settlement_and_inference_gates_closed, true);
  assert.equal(receipt.attempt114_runtime_manifest_creation_required, true);
  assert.equal(receipt.all_254_independent_pre_execution_anchor_receipts_required, true);
  assert.equal(receipt.all_252_outcome_price_lineages_required, true);
  assert.equal(receipt.broker_mutation_authorized, false);

  const allPaths = [ATTEMPT114_PROTOCOL_RELATIVE_PATH, ...Object.keys(EXPECTED_UPSTREAM)];
  const root = await makeTemporaryProject(t, allPaths);
  await verifyProspectiveAttempt114UpstreamBytes({ projectRoot: root });
  const shadowCopy = path.join(root, "lib/equity_shadow_execution.mjs");
  const originalShadow = await readFile(shadowCopy, "utf8");
  await writeFile(shadowCopy, `${originalShadow}\n`);
  await assert.rejects(
    verifyProspectiveAttempt114UpstreamBytes({ projectRoot: root }),
    /equity_shadow_execution\.mjs raw bytes no longer match/,
  );
});

test("canonical serializer and imported freeze agree with the raw protocol file", async () => {
  const bytes = await readFile(PROTOCOL_PATH, "utf8");
  assert.equal(canonicalProspectiveAttempt114ProtocolJson(ATTEMPT114_PROTOCOL), bytes);
  assert.deepEqual(await loadProspectiveAttempt114Protocol(), ATTEMPT114_PROTOCOL);
});
