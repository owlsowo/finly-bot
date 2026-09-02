import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { LIVE_ALPHA_CONFIDENCE_POLICY } from "../lib/policy.mjs";

const implementationCommit = "318c94379af14595e09f414504be8080bc822048";
const priorBytes = await readFile(new URL("../config/options-policy-revision-2026-09-01.json", import.meta.url));
const revision = JSON.parse(await readFile(new URL("../config/options-policy-revision-v3-2026-09-02.json", import.meta.url)));
const calibration = JSON.parse(await readFile(new URL("../evidence/options_policy_calibration.json", import.meta.url)));
const workflow = await readFile(new URL("../.github/workflows/paper-agent-cloud.yml", import.meta.url), "utf8");

test("prospective v3 is additive and preserves the exact dated v2 record", () => {
  assert.equal(createHash("sha256").update(priorBytes).digest("hex"), "e286323b38e2c686b7713c4b83b3da2c68183bb9128741d93aa261b7f40348e4");
  assert.equal(revision.revision_id, "live-options-v3-2026-09-02");
  assert.equal(revision.provenance.previous_revision_record, "config/options-policy-revision-2026-09-01.json");
  assert.equal(revision.activation.status, "PREPARED_NOT_PUSHED");
});

test("v3 changes only the approved alpha thresholds and pins their implementation commit", () => {
  assert.equal(LIVE_ALPHA_CONFIDENCE_POLICY.minimumProbabilityOfProfit, 0.45);
  assert.equal(LIVE_ALPHA_CONFIDENCE_POLICY.minimumRewardRisk, 1.25);
  assert.equal(LIVE_ALPHA_CONFIDENCE_POLICY.minimumEvDollars, 5);
  assert.equal(LIVE_ALPHA_CONFIDENCE_POLICY.minimumEvToMaxLoss, 0.02);
  assert.equal(revision.activation.implementation_commit, implementationCommit);
  assert.equal(revision.activation.workflow_pin_target, implementationCommit);
  assert.match(workflow, new RegExp(`FINLY_CODE_VERSION:\\s*${implementationCommit}`));
});

test("v3 record and deterministic artifact agree on the exact fair-surface evidence", () => {
  const fair = calibration.results.fair_surface;
  assert.equal(calibration.artifact_sha256, revision.provenance.calibration_artifact_sha256);
  assert.equal(fair.eligible_count, revision.verification.ordinary_symmetric_five_cent_half_spread.eligible_count);
  assert.equal(fair.eligible_rate, revision.verification.ordinary_symmetric_five_cent_half_spread.eligible_rate);
  assert.deepEqual(fair.direction_mix, revision.verification.ordinary_symmetric_five_cent_half_spread.direction_mix);
  assert.deepEqual(fair.ranges.max_loss_dollars, revision.verification.ordinary_symmetric_five_cent_half_spread.maximum_loss_dollars);
  assert.deepEqual(fair.ranges.conservative_ev_dollars, revision.verification.ordinary_symmetric_five_cent_half_spread.conservative_ev_dollars);
  assert.deepEqual(fair.ranges.probability_profit, revision.verification.ordinary_symmetric_five_cent_half_spread.probability_profit);
  assert.deepEqual(fair.ranges.reward_risk, revision.verification.ordinary_symmetric_five_cent_half_spread.reward_risk);
});
