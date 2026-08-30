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

test("submission claims lock binds the final retrospective and zero-row boundaries", async () => {
  const lock = await buildSubmissionClaimsLock({ rootDir: projectRoot });
  assert.equal(lock.schema_version, "finly_submission_claims_lock.v1");
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
});
