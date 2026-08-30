import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeneration6GrowthJointStatisticalEvidence,
  GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS,
  GENERATION6_GROWTH_STATISTICS_CONTROL_IDS,
  GENERATION6_GROWTH_STATISTICS_SPECIFICATION,
  generation6GrowthJointBlockBootstrap,
} from "../research/champion_generation6_growth_statistics.mjs";

const FIXED_ID = "g6_equal_evidence_ensemble";

function syntheticRows(count = 90, { zero = false, strong = false } = {}) {
  const controlOffsets = {
    qqq_buy_hold: zero ? 0 : 0.00020,
    static_spy_qqq_50_50_control: zero ? 0 : 0.00010,
    static_qqq_equal_sectors_control: zero ? 0 : 0.00015,
  };
  const candidateOffsets = Object.fromEntries(
    GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS.map((id, index) => [
      id,
      zero ? 0 : -0.00020 + index * 0.00003,
    ]),
  );
  candidateOffsets[FIXED_ID] = zero ? 0 : strong ? 0.004 : 0.00055;
  return Array.from({ length: count }, (_, index) => {
    const commonLogReturn = zero
      ? 0
      : 0.00005 + 0.003 * Math.sin(index / 5.3) + 0.0015 * Math.cos(index / 11.7);
    const strategies = {};
    for (const [id, offset] of Object.entries({ ...candidateOffsets, ...controlOffsets })) {
      strategies[id] = { net_return: Math.expm1(commonLogReturn + offset) };
    }
    return {
      execution_return_date: new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10),
      strategies,
    };
  });
}

test("frozen growth family is exactly seven candidates, three controls, and six block specifications", () => {
  assert.deepEqual(GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS, [
    "g6_trend_guard_g4",
    "g6_vol_target_g4",
    "g6_breadth_scaled_g4",
    "g6_residual_sector",
    "g6_long_only_tsmom_1_3_12",
    "g6_hrp_trend",
    "g6_equal_evidence_ensemble",
  ]);
  assert.deepEqual(GENERATION6_GROWTH_STATISTICS_CONTROL_IDS, [
    "qqq_buy_hold",
    "static_spy_qqq_50_50_control",
    "static_qqq_equal_sectors_control",
  ]);
  assert.deepEqual(GENERATION6_GROWTH_STATISTICS_SPECIFICATION.block_lengths_sessions, [5, 20, 60]);
  assert.deepEqual(GENERATION6_GROWTH_STATISTICS_SPECIFICATION.methods, ["circular", "moving"]);
  assert.equal(GENERATION6_GROWTH_STATISTICS_SPECIFICATION.bootstrap_iterations_per_test, 4_999);
  assert.equal(GENERATION6_GROWTH_STATISTICS_SPECIFICATION.cumulative_effective_trials, 113);
  assert.ok(Object.isFrozen(GENERATION6_GROWTH_STATISTICS_SPECIFICATION));
});

test("joint suite is deterministic and uses the frozen shared-block seeds", () => {
  const rows = syntheticRows(90);
  const left = buildGeneration6GrowthJointStatisticalEvidence(rows, FIXED_ID, { iterations: 199 });
  const right = buildGeneration6GrowthJointStatisticalEvidence(
    structuredClone(rows),
    FIXED_ID,
    { iterations: 199 },
  );
  assert.deepEqual(left, right);
  assert.equal(left.status, "TESTED");
  assert.equal(left.evidence.circular[5].seed, 20_260_905);
  assert.equal(left.evidence.circular[20].seed, 20_260_920);
  assert.equal(left.evidence.circular[60].seed, 20_260_960);
  assert.equal(left.evidence.moving[5].seed, 20_261_905);
  assert.equal(left.evidence.moving[20].seed, 20_261_920);
  assert.equal(left.evidence.moving[60].seed, 20_261_960);
  assert.equal(
    left.evidence.circular[5].observed_minimum_daily_log_edges[FIXED_ID],
    0.00035,
  );
  for (const method of ["circular", "moving"]) {
    for (const blockLength of [5, 20, 60]) {
      const evidence = left.evidence[method][blockLength];
      assert.equal(evidence.bootstrap_method, method);
      assert.equal(evidence.block_length_sessions, blockLength);
      assert.equal(evidence.iterations, 199);
      assert.match(evidence.block_sampling, /identical index path/);
      assert.match(evidence.family_statistic, /maximum candidate statistic/);
      assert.equal(evidence.candidate_ids.length, 7);
      assert.equal(evidence.control_ids.length, 3);
    }
  }
  assert.ok(Object.isFrozen(left));
});

test("rows and options fail closed on missing alignment, bad chronology, or unfrozen choices", () => {
  const rows = syntheticRows(90);
  const missing = structuredClone(rows);
  delete missing[12].strategies.static_spy_qqq_50_50_control;
  assert.throws(
    () => buildGeneration6GrowthJointStatisticalEvidence(missing, FIXED_ID, { iterations: 199 }),
    /strategies\.static_spy_qqq_50_50_control must be an object/,
  );

  const duplicateDate = structuredClone(rows);
  duplicateDate[12].execution_return_date = duplicateDate[11].execution_return_date;
  assert.throws(
    () => buildGeneration6GrowthJointStatisticalEvidence(duplicateDate, FIXED_ID, { iterations: 199 }),
    /strictly chronological/,
  );
  assert.throws(
    () => buildGeneration6GrowthJointStatisticalEvidence(rows.slice(0, 59), FIXED_ID, { iterations: 199 }),
    /at least 60 exactly aligned observations/,
  );
  assert.throws(
    () => buildGeneration6GrowthJointStatisticalEvidence(rows, "unregistered_candidate", { iterations: 199 }),
    /seven frozen Generation 6 growth candidates/,
  );
  assert.throws(
    () => buildGeneration6GrowthJointStatisticalEvidence(rows, FIXED_ID, {
      iterations: 199,
      seed: 9,
    }),
    /unsupported fields: seed/,
  );
  assert.throws(
    () => generation6GrowthJointBlockBootstrap(rows, FIXED_ID, {
      method: "stationary",
      iterations: 199,
      blockLength: 20,
      seed: 9,
    }),
    /either "circular" or "moving"/,
  );
  assert.throws(
    () => generation6GrowthJointBlockBootstrap(rows, FIXED_ID, {
      method: "moving",
      iterations: 199,
      blockLength: 10,
      seed: 9,
    }),
    /must be one of 5, 20, 60/,
  );
});

test("zero edges produce p=1 and cannot pass any cumulative trial gate", () => {
  const evidence = buildGeneration6GrowthJointStatisticalEvidence(
    syntheticRows(70, { zero: true }),
    FIXED_ID,
    { iterations: 199 },
  );
  for (const method of ["circular", "moving"]) {
    for (const blockLength of [5, 20, 60]) {
      const item = evidence.evidence[method][blockLength];
      assert.equal(item.observed_fixed_candidate_statistic, 0);
      assert.equal(item.fixed_candidate_selection_adjusted_joint_max_min_p_value, 1);
      assert.equal(item.fixed_candidate_intersection_union_p_value, 1);
      assert.equal(item.conservative_joint_and_iut_raw_p_value, 1);
      assert.equal(item.cumulative_113_trial_bonferroni_adjusted_p_value, 1);
      assert.equal(item.passes_cumulative_113_trial_5_percent_gate, false);
    }
  }
  assert.equal(evidence.passes, false);
});

test("a null selection returns explicit fail-closed evidence without reading rows", () => {
  const evidence = buildGeneration6GrowthJointStatisticalEvidence(null, null);
  assert.equal(evidence.status, "NOT_TESTED_NO_FIXED_GROWTH_CHALLENGER");
  assert.equal(evidence.fixed_candidate_id, null);
  assert.equal(evidence.evidence, null);
  assert.equal(evidence.passes, false);
  assert.equal(evidence.bootstrap_resolution.minimum_attainable_raw_p_value, 0.0002);
  assert.equal(
    evidence.bootstrap_resolution.minimum_attainable_cumulative_113_trial_adjusted_p_value,
    0.0226,
  );
  assert.throws(
    () => buildGeneration6GrowthJointStatisticalEvidence(syntheticRows(70), null),
    /rows must be null/,
  );
});

test("strong joint alternative reaches the exact add-one resolution and passes all six tests", () => {
  const evidence = buildGeneration6GrowthJointStatisticalEvidence(
    syntheticRows(70, { strong: true }),
    FIXED_ID,
  );
  assert.equal(evidence.bootstrap_iterations_per_test, 4_999);
  assert.equal(evidence.bootstrap_resolution.minimum_attainable_raw_p_value, 0.0002);
  assert.equal(
    evidence.bootstrap_resolution.minimum_attainable_cumulative_113_trial_adjusted_p_value,
    0.0226,
  );
  assert.equal(evidence.bootstrap_resolution.can_resolve_5_percent_gate, true);
  for (const method of ["circular", "moving"]) {
    for (const blockLength of [5, 20, 60]) {
      const item = evidence.evidence[method][blockLength];
      const pairwise = Object.values(item.fixed_candidate_control_edges)
        .map((control) => control.add_one_one_sided_p_value);
      assert.equal(item.fixed_candidate_is_observed_global_maximum, true);
      assert.equal(item.fixed_candidate_selection_adjusted_joint_max_min_p_value, 0.0002);
      assert.equal(item.fixed_candidate_intersection_union_p_value, Math.max(...pairwise));
      assert.equal(item.conservative_joint_and_iut_raw_p_value, 0.0002);
      assert.equal(item.cumulative_113_trial_bonferroni_adjusted_p_value, 0.0226);
      assert.equal(item.passes_cumulative_113_trial_5_percent_gate, true);
      assert.match(item.multiplicity.control_family, /no times-three correction/);
      assert.match(item.multiplicity.deliberately_not_used, /No naive 113-times-3/);
    }
  }
  assert.equal(evidence.gates.all_six_block_tests_pass_cumulative_113_trial_gate, true);
  assert.equal(evidence.passes, true);
  assert.match(evidence.claim_boundary, /not untouched out-of-sample evidence/);
});

test("199 draws disclose that cumulative 113-trial significance is numerically unresolvable", () => {
  const evidence = buildGeneration6GrowthJointStatisticalEvidence(
    syntheticRows(70, { strong: true }),
    FIXED_ID,
    { iterations: 199 },
  );
  assert.equal(evidence.bootstrap_resolution.minimum_attainable_raw_p_value, 0.005);
  assert.equal(
    evidence.bootstrap_resolution.minimum_attainable_cumulative_113_trial_adjusted_p_value,
    0.565,
  );
  assert.equal(evidence.bootstrap_resolution.can_resolve_5_percent_gate, false);
  assert.match(evidence.bootstrap_resolution.disclosure, /With 199 draws/);
  assert.match(evidence.bootstrap_resolution.disclosure, /0\.565/);
  assert.equal(evidence.passes, false);
});
