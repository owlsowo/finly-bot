import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSubmissionClaimsLock,
  OUTPUT_PATH,
  SOURCE_REGISTRY,
} from "../research/build_submission_claims_lock.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");

test("submission claims lock binds retrospective, execution-realism, and prospective boundaries", async () => {
  const lock = await buildSubmissionClaimsLock({ rootDir: projectRoot });
  assert.equal(lock.schema_version, "finly_submission_claims_lock.v1");
  assert.equal(lock.evidence_as_of, "2026-08-30T04:53:55.000Z");
  assert.equal(lock.retrospective_result.candidate_annualized_return, 0.1897447215);
  assert.equal(lock.retrospective_result.spy_annualized_return, 0.1511474737);
  assert.equal(lock.retrospective_result.candidate_maximum_drawdown, -0.2898521154);
  assert.equal(lock.retrospective_result.spy_maximum_drawdown, -0.3371726114);
  assert.equal(lock.retrospective_result.promotion_status, "NOT_PROMOTED_DESCRIPTIVE_ONLY");
  assert.equal(lock.research_attempt_accounting.conservatively_counted_effective_attempts, 113);
  assert.equal(lock.falsification.replacement_challengers_promoted, 0);
  assert.equal(lock.hindsight_boundary.fully_preregistered_claim_permitted, false);
  assert.equal(lock.production_policy.policy_id, "tsmom_ensemble_vol");
  assert.equal(lock.production_policy.distinct_from_g4_shadow, true);
  assert.equal(lock.production_policy.candidate.annualized_return, 0.11133479);
  assert.equal(lock.production_policy.spy.annualized_return, 0.19190757);
  assert.equal(lock.production_policy.candidate.annualized_volatility, 0.08309429);
  assert.equal(lock.production_policy.spy.annualized_volatility, 0.17332678);
  assert.equal(lock.production_policy.latest_research_proposal.broker_mutation_authorized, false);
  assert.equal(lock.production_policy.latest_research_proposal.mutation_requested, false);

  assert.equal(lock.execution_realism.evidence_class, "CONSUMED_RETROSPECTIVE_EXECUTION_REALISM");
  assert.equal(lock.execution_realism.policy_id, "tsmom_ensemble_vol");
  assert.deepEqual(lock.execution_realism.window, {
    start: "2025-01-02",
    end: "2026-08-28",
    observations: 415,
  });
  assert.equal(lock.execution_realism.fill_assumption,
    "fractional market DAY orders at the next session open t+1");
  assert.deepEqual(lock.execution_realism.next_open_cost_stress.map((item) => item.bps_per_leg), [1, 5, 25]);
  assert.deepEqual(lock.execution_realism.next_open_cost_stress.map((item) => item.total_return), [
    0.1637768834,
    0.1538759778,
    0.1055891073,
  ]);
  assert.deepEqual(lock.execution_realism.next_open_cost_stress.map((item) => item.spy_total_return), [
    0.3352366407,
    0.3352366407,
    0.3352366407,
  ]);
  assert.equal(lock.execution_realism.next_open_cost_stress[1].maximum_drawdown, -0.0544710489);
  assert.equal(lock.execution_realism.raw_no_distribution_proxy.total_return, 0.12745684);
  assert.equal(lock.execution_realism.raw_no_distribution_proxy.spy_total_return, 0.3127047502);
  assert.equal(lock.execution_realism.small_account_proxy.initial_equity_usd, 300);
  assert.equal(lock.execution_realism.small_account_proxy.ending_equity_usd, 351.88433421);
  assert.equal(lock.execution_realism.small_account_proxy.total_return, 0.1729477807);
  assert.equal(lock.execution_realism.small_account_proxy.minimum_order_notional_usd, 1);
  assert.equal(lock.execution_realism.small_account_proxy.quantity_decimals, 9);
  assert.equal(lock.execution_realism.small_account_proxy.sell_day_fees_total_usd, 0.7);
  assert.equal(lock.execution_realism.small_account_proxy.skipped_minimum_orders, 12);
  assert.deepEqual(lock.execution_realism.assurance, {
    consumed_retrospective_only: true,
    raw_ohlc_redistributed: false,
    alpha_proven: false,
    future_profitability_proven: false,
    broker_fill_verified: false,
    broker_mutation_authorized: false,
  });
  assert.match(lock.execution_realism.exact_safe_claim, /underperformed SPY/);
  assert.match(lock.execution_realism.exact_safe_claim, /not alpha, a broker fill/);

  assert.equal(lock.prospective_attempt114.attempt_id, "finly_prospective_profitability_attempt_114");
  assert.equal(lock.prospective_attempt114.attempt_number, 114);
  assert.equal(lock.prospective_attempt114.publication_status,
    "PUBLIC_PRE_DEADLINE_GITHUB_WORKFLOW_VERIFIED");
  assert.equal(lock.prospective_attempt114.required_signal_commitments, 254);
  assert.equal(lock.prospective_attempt114.required_settlements, 252);
  assert.equal(lock.prospective_attempt114.primary_intervals, 252);
  assert.equal(lock.prospective_attempt114.exclusive_deadline, "2026-08-31T20:00:00.000Z");
  assert.deepEqual(lock.prospective_attempt114.publication_commit, {
    sha: "38a999cdf5db98f3a831d137b799ff8a48248e71",
    url: "https://github.com/owlsowo/finly-bot/commit/38a999cdf5db98f3a831d137b799ff8a48248e71",
  });
  assert.deepEqual(lock.prospective_attempt114.verification_workflow, {
    run_id: 33_293_038_439,
    url: "https://github.com/owlsowo/finly-bot/actions/runs/33293038439",
    conclusion: "success",
    created_at: "2026-08-30T04:41:05Z",
    completed_at: "2026-08-30T04:43:05Z",
  });
  assert.equal(lock.prospective_attempt114.bound_runtime_source_count, 17);
  assert.equal(lock.prospective_attempt114.public_get_count, 23);
  assert.deepEqual(lock.prospective_attempt114.assurance, {
    github_public_api_record_verified: true,
    successful_workflow_observed: true,
    public_pre_deadline_publication_observed: true,
    github_platform_record_only: true,
    independent_cryptographic_timestamp_verified: false,
    provider_origin_verified: false,
    broker_execution_verified: false,
    performance_inference_permitted: false,
    broker_mutation_authorized: false,
  });
  assert.deepEqual(lock.prospective_attempt114.sample_boundary, {
    consecutive_official_sessions_required: true,
    no_skips: true,
    no_backfill: true,
    replacement_window_permitted: false,
    optional_stopping_permitted: false,
    repeat_confirmatory_test_permitted: false,
  });
  assert.match(lock.prospective_attempt114.exact_safe_claim, /not an independent cryptographic timestamp/);
  assert.match(lock.prospective_attempt114.exact_safe_claim,
    /performance inference and broker mutation remain disabled/);

  assert.equal(lock.forward_trial.commitments, 0);
  assert.equal(lock.forward_trial.settlements, 0);
  assert.equal(lock.forward_trial.production_commitment_enabled, false);
  assert.equal(lock.forward_trial.production_settlement_enabled, false);
  assert.equal(lock.forward_trial.performance_inference_enabled, false);
  assert.equal(lock.forward_trial.broker_authority, false);
  assert.equal(lock.forward_trial.corporate_action_reconciliation_ready, false);
  assert.equal(lock.forward_trial.outcome_price_reconciliation_ready, false);
  assert.match(lock.forward_trial.exact_safe_claim, /zero-row, two-phase protocol/);
  assert.match(lock.forward_trial.exact_safe_claim, /does not prove prospectivity/);

  assert.equal(lock.options_and_broker_boundary.historical_g4_is_options_pnl, false);
  assert.equal(lock.options_and_broker_boundary.order_submitted_or_filled_as_evidence, false);
  assert.equal(lock.source_integrity.artifacts.length, SOURCE_REGISTRY.length);
  assert.equal(lock.source_integrity.all_hashes_verified, true);
  assert.deepEqual(lock.source_integrity.artifacts.slice(-4).map((item) => item.id), [
    "equity_execution_realism",
    "prospective_attempt114_protocol",
    "prospective_attempt114_runtime_manifest",
    "prospective_attempt114_publication_receipt",
  ]);
});

test("checked-in claims lock is byte-equivalent to a fresh deterministic build", async () => {
  const lock = await buildSubmissionClaimsLock({ rootDir: projectRoot });
  const checkedIn = await readFile(resolve(projectRoot, OUTPUT_PATH), "utf8");
  assert.equal(checkedIn, `${JSON.stringify(lock, null, 2)}\n`);
});

test("forbidden headline language remains explicit and separate from safe lines", async () => {
  const lock = await buildSubmissionClaimsLock({ rootDir: projectRoot });
  assert.ok(lock.public_claim_policy.forbidden_lines.includes("Finly consistently outperforms SPY."));
  assert.ok(lock.public_claim_policy.forbidden_lines.includes("Finly is proven profitable."));
  assert.ok(lock.public_claim_policy.forbidden_lines.includes("Finly is fully preregistered."));
  assert.ok(lock.public_claim_policy.safe_lines.every((line) => !/consistently outperforms|proven profitable|fully preregistered/i.test(line)));
  assert.doesNotMatch(lock.execution_realism.exact_safe_claim, /consistently outperforms|proven profitable/i);
  assert.doesNotMatch(lock.prospective_attempt114.exact_safe_claim,
    /independently timestamped|performance inference enabled/i);
});
