import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCausalSystematicBetaSpyDiagnostic,
  assessCausalVolatilityMatchedSpyComparator,
  assessCausalVolatilityMatchedSpySlices,
  assessGeneration6AnchorSensitivity,
  assessGeneration6CostSensitivity,
  buildCausalSystematicBetaSpyDiagnostic,
  buildCausalVolatilityMatchedSpyComparator,
  buildGeneration6PairedRows,
  buildGeneration6StatisticalEvidence,
  canonicalEvidenceJson,
  GENERATION6_BLOCK_LENGTHS,
  GENERATION6_BOOTSTRAP_SEEDS,
  GENERATION6_COST_LEVELS_BPS,
  GENERATION6_CUMULATIVE_TRIALS,
  GENERATION6_REBALANCE_ANCHORS,
  GENERATION6_VOLATILITY_MATCH_SPECIFICATION,
  hashGeneration6RobustnessEvidence,
  summarizeGeneration6PostSelectionRobustness,
} from "../research/champion_generation6_robustness.mjs";

function syntheticPairedRows(count = 420) {
  return Array.from({ length: count }, (_, index) => {
    const bil = 0.00004 + 0.00001 * Math.cos(index / 31);
    const spy = bil + 0.00025 + 0.006 * Math.sin(index / 9) + 0.003 * Math.cos(index / 23);
    const commonResidual = 0.0012 * Math.sin(index / 4.7) + 0.0007 * Math.cos(index / 17);
    return {
      execution_return_date: new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10),
      strategies: {
        spy_buy_hold: { net_return: spy },
        bil_cash: { net_return: bil },
        strong: { net_return: bil + 0.58 * (spy - bil) + 0.00075 + commonResidual },
        weak: { net_return: bil + 0.72 * (spy - bil) + 0.00008 - 0.0009 * Math.cos(index / 6.2) },
        negative: { net_return: bil + 0.45 * (spy - bil) - 0.00035 + 0.001 * Math.sin(index / 5.3) },
      },
    };
  });
}

function standaloneRows(id, pairedRows) {
  return pairedRows.map((row) => ({
    execution_return_date: row.execution_return_date,
    net_return: row.strategies[id].net_return,
  }));
}

function costRecord(cost, developmentEdge = 0.02, validationEdge = 0.015) {
  return {
    candidate_id: "strong",
    benchmark_id: "spy_buy_hold",
    cost_bps: cost,
    development_spy_annualized_log_growth_edge: developmentEdge,
    validation_spy_annualized_log_growth_edge: validationEdge,
  };
}

function anchorRecord(anchor, developmentEdge = 0.02, validationEdge = 0.015) {
  return {
    candidate_id: "strong",
    benchmark_id: "spy_buy_hold",
    rebalance_anchor: anchor,
    development_spy_annualized_log_growth_edge: developmentEdge,
    validation_spy_annualized_log_growth_edge: validationEdge,
  };
}

test("paired-row construction aligns already-scored strategies and fails on date drift", () => {
  const source = syntheticPairedRows(80);
  const rowsById = {
    strong: standaloneRows("strong", source),
    spy_buy_hold: standaloneRows("spy_buy_hold", source),
    bil_cash: standaloneRows("bil_cash", source),
  };
  const paired = buildGeneration6PairedRows(rowsById, ["strong", "spy_buy_hold", "bil_cash"]);
  assert.equal(paired.length, source.length);
  assert.equal(paired[12].strategies.strong.net_return, source[12].strategies.strong.net_return);
  assert.ok(Object.isFrozen(paired));
  const shifted = structuredClone(rowsById);
  shifted.spy_buy_hold[12].execution_return_date = "2030-01-01";
  assert.throws(
    () => buildGeneration6PairedRows(shifted, ["strong", "spy_buy_hold", "bil_cash"]),
    /date-misaligned/,
  );
});

test("systematic-beta diagnostic uses only trailing rows and charges deterministic turnover", () => {
  const rows = syntheticPairedRows(180);
  const options = {
    candidateId: "strong",
    lookbackSessions: 20,
    rebalanceIntervalSessions: 5,
    rebalanceAnchor: 0,
    oneWayCostBps: 5,
  };
  const evidence = buildCausalSystematicBetaSpyDiagnostic(rows, options);
  const repeated = buildCausalSystematicBetaSpyDiagnostic(structuredClone(rows), options);
  assert.equal(evidence.role, "systematic_beta_diagnostic_not_primary_risk_match");
  assert.deepEqual(evidence, repeated);
  assert.equal(evidence.rows.length, rows.length);
  assert.equal(evidence.rows[19].risk_match.rebalanced, false);
  assert.equal(evidence.rows[20].risk_match.rebalanced, true);
  assert.equal(evidence.rows[20].risk_match.estimation_start_date, rows[0].execution_return_date);
  assert.equal(evidence.rows[20].risk_match.estimation_end_date, rows[19].execution_return_date);
  assert.ok(evidence.rows[20].strategies[evidence.comparator_id].transaction_cost > 0);
  assert.equal(evidence.rows.at(-1).strategies[evidence.comparator_id].terminal_liquidation, true);

  const currentCandidateShock = structuredClone(rows);
  currentCandidateShock[20].strategies.strong.net_return += 0.25;
  const shocked = buildCausalSystematicBetaSpyDiagnostic(currentCandidateShock, options);
  assert.equal(shocked.rows[20].risk_match.estimated_beta, evidence.rows[20].risk_match.estimated_beta);
  assert.equal(
    shocked.rows[20].strategies[evidence.comparator_id].net_return,
    evidence.rows[20].strategies[evidence.comparator_id].net_return,
  );
  assert.notEqual(shocked.rows[25].risk_match.estimated_beta, evidence.rows[25].risk_match.estimated_beta);
});

test("systematic-beta assessment honors explicit post-warmup scoring dates", () => {
  const source = syntheticPairedRows(360);
  const evidence = buildCausalSystematicBetaSpyDiagnostic(source, {
    candidateId: "strong",
  });
  const assessment = assessCausalSystematicBetaSpyDiagnostic(evidence);
  assert.equal(assessment.start_date, source[63].execution_return_date);
  assert.equal(assessment.scored_observations, source.length - 63);
  assert.equal(assessment.gates.at_least_one_trailing_estimate, true);
  assert.equal(assessment.gates.every_estimate_precedes_its_earned_return, true);
  assert.equal(assessment.gates.every_estimate_respects_frozen_beta_bounds, true);
  assert.ok(assessment.annualized_log_growth_edge > 0);
  assert.equal(assessment.passes, true);
  assert.match(assessment.interpretation, /not the primary risk-matched gate/);
  const bounded = assessCausalSystematicBetaSpyDiagnostic(evidence, {
    scoringStartDate: source[100].execution_return_date,
    scoringEndDate: source[300].execution_return_date,
  });
  assert.equal(bounded.start_date, source[100].execution_return_date);
  assert.equal(bounded.end_date, source[300].execution_return_date);
  assert.equal(bounded.scored_observations, 201);
  assert.match(bounded.scoring_boundary, /warmed/);
});

test("primary volatility match is causal, deterministic, drifted, and financing-aware", () => {
  const source = syntheticPairedRows(220);
  const options = {
    candidateId: "strong",
    lookbackSessions: 20,
    rebalanceIntervalSessions: 5,
    oneWayCostBps: 5,
  };
  const evidence = buildCausalVolatilityMatchedSpyComparator(source, options);
  const repeated = buildCausalVolatilityMatchedSpyComparator(structuredClone(source), options);
  assert.deepEqual(evidence, repeated);
  assert.equal(evidence.role, "primary_risk_matched_gate");
  assert.equal(evidence.specification.annual_borrow_spread, 0.005);
  assert.equal(evidence.rows[20].volatility_match.rebalanced, true);
  assert.equal(evidence.rows[20].volatility_match.estimation_start_date, source[0].execution_return_date);
  assert.equal(evidence.rows[20].volatility_match.estimation_end_date, source[19].execution_return_date);
  assert.ok(evidence.rows[20].strategies[evidence.comparator_id].transaction_cost > 0);
  assert.notEqual(
    evidence.rows[21].strategies[evidence.comparator_id].start_spy_weight,
    evidence.rows[20].strategies[evidence.comparator_id].start_spy_weight,
  );

  const currentCandidateShock = structuredClone(source);
  currentCandidateShock[20].strategies.strong.net_return += 0.25;
  const shocked = buildCausalVolatilityMatchedSpyComparator(currentCandidateShock, options);
  assert.equal(
    shocked.rows[20].volatility_match.target_spy_weight,
    evidence.rows[20].volatility_match.target_spy_weight,
  );
  assert.equal(
    shocked.rows[20].strategies[evidence.comparator_id].net_return,
    evidence.rows[20].strategies[evidence.comparator_id].net_return,
  );
  assert.notEqual(
    shocked.rows[25].volatility_match.target_spy_weight,
    evidence.rows[25].volatility_match.target_spy_weight,
  );

  const levered = structuredClone(source);
  for (let index = 0; index < levered.length; index += 1) {
    const bil = levered[index].strategies.bil_cash.net_return;
    const spy = levered[index].strategies.spy_buy_hold.net_return;
    levered[index].strategies.strong.net_return = bil + 1.35 * (spy - bil)
      + 0.0003 + 0.0002 * Math.sin(index / 3.7);
  }
  const leveredEvidence = buildCausalVolatilityMatchedSpyComparator(levered, options);
  const firstLevered = leveredEvidence.rows.find((row) => (
    row.volatility_match.rebalanced && row.volatility_match.target_spy_weight > 1
  ));
  assert.ok(firstLevered);
  assert.ok(firstLevered.strategies[leveredEvidence.comparator_id].start_cash_weight < 0);
  assert.ok(firstLevered.strategies[leveredEvidence.comparator_id].financing_spread_cost > 0);
  assert.ok(firstLevered.volatility_match.target_spy_weight <= 1.5);
});

test("primary volatility gate requires positive growth and 0.90-1.10 realized-volatility match in both slices", () => {
  const source = syntheticPairedRows(420);
  const evidence = buildCausalVolatilityMatchedSpyComparator(source, { candidateId: "strong" });
  const full = assessCausalVolatilityMatchedSpyComparator(evidence);
  assert.equal(full.start_date, source[63].execution_return_date);
  assert.equal(full.scored_observations, source.length - 63);
  assert.equal(full.role, "primary_risk_matched_gate");
  assert.ok(full.annualized_log_growth_edge > 0);
  assert.ok(full.realized_candidate_to_comparator_volatility_ratio >= 0.90);
  assert.ok(full.realized_candidate_to_comparator_volatility_ratio <= 1.10);
  assert.equal(full.passes, true);

  const slices = assessCausalVolatilityMatchedSpySlices(evidence, {
    development: {
      start: source[63].execution_return_date,
      end: source[241].execution_return_date,
    },
    validation: {
      start: source[242].execution_return_date,
      end: source.at(-1).execution_return_date,
    },
  });
  assert.equal(slices.required_slices.length, 2);
  assert.equal(slices.gates.frozen_primary_specification_matches, true);
  assert.equal(slices.gates.development_primary_risk_match_passes, true);
  assert.equal(slices.gates.validation_primary_risk_match_passes, true);
  assert.equal(slices.passes, true);

  const deliberatelyUnderRiskedEvidence = buildCausalVolatilityMatchedSpyComparator(source, {
    candidateId: "strong",
    maximumSpyWeight: 0.2,
  });
  const deliberatelyUnderRisked = assessCausalVolatilityMatchedSpyComparator(
    deliberatelyUnderRiskedEvidence,
    {
      scoringStartDate: source[63].execution_return_date,
      scoringEndDate: source[241].execution_return_date,
    },
  );
  assert.equal(
    deliberatelyUnderRisked.gates.realized_candidate_to_comparator_volatility_ratio_at_most_1_10,
    false,
  );
  assert.equal(deliberatelyUnderRisked.passes, false);
  const nonFrozenSlices = assessCausalVolatilityMatchedSpySlices(
    deliberatelyUnderRiskedEvidence,
    {
      development: {
        start: source[63].execution_return_date,
        end: source[241].execution_return_date,
      },
      validation: {
        start: source[242].execution_return_date,
        end: source.at(-1).execution_return_date,
      },
    },
  );
  assert.equal(nonFrozenSlices.gates.frozen_primary_specification_matches, false);
  assert.equal(nonFrozenSlices.passes, false);
  assert.throws(
    () => assessCausalVolatilityMatchedSpyComparator(evidence, {
      minimumRealizedVolatilityRatio: 0.8,
      maximumRealizedVolatilityRatio: 1.2,
    }),
    /must remain 0.90 through 1.10/,
  );
  assert.deepEqual(GENERATION6_VOLATILITY_MATCH_SPECIFICATION, {
    lookback_sessions: 63,
    rebalance_interval_sessions: 21,
    minimum_spy_weight: 0,
    maximum_spy_weight: 1.5,
    base_one_way_cost_bps: 5,
    annual_borrow_spread: 0.005,
    realized_volatility_ratio_minimum: 0.90,
    realized_volatility_ratio_maximum: 1.10,
  });
});

test("statistical scaffold is deterministic and Bonferroni-corrects across all 113 trials", () => {
  const rows = syntheticPairedRows(360);
  const options = { iterations: 199 };
  const left = buildGeneration6StatisticalEvidence(
    rows,
    ["strong", "weak", "negative"],
    "strong",
    options,
  );
  const right = buildGeneration6StatisticalEvidence(
    structuredClone(rows),
    ["strong", "weak", "negative"],
    "strong",
    options,
  );
  assert.deepEqual(left, right);
  assert.equal(left.cumulative_effective_trials, GENERATION6_CUMULATIVE_TRIALS);
  assert.deepEqual(left.block_lengths_sessions, GENERATION6_BLOCK_LENGTHS);
  assert.deepEqual(left.fixed_seeds, GENERATION6_BOOTSTRAP_SEEDS);
  assert.equal(left.deflated_sharpe.cumulative_trial_count, 113);
  assert.equal(
    left.gates.bootstrap_resolution_can_resolve_cumulative_113_trial_5_percent_gate,
    false,
  );
  assert.equal(left.bootstrap_resolution.minimum_attainable_raw_p_value, 0.005);
  for (const method of ["circular", "moving"]) {
    for (const blockLength of GENERATION6_BLOCK_LENGTHS) {
      const raw = left.paired_block_bootstrap.evidence[method][blockLength]
        .fixed_candidate_one_sided_p_value;
      const corrected = left.cumulative_trial_familywise_correction.evidence[method][blockLength]
        .cumulative_113_trial_bonferroni_adjusted_p_value;
      assert.equal(corrected, Math.min(1, raw * 113));
    }
  }
  assert.match(left.cumulative_trial_familywise_correction.boundary, /without inventing/);
  assert.throws(
    () => buildGeneration6StatisticalEvidence(rows, ["strong", "weak"], "strong", {
      cumulativeTrialCount: 112,
      iterations: 100,
    }),
    /must remain 113/,
  );
});

test("cost sensitivity requires exact 5/10/25 bp coverage and both frozen slices", () => {
  const passing = assessGeneration6CostSensitivity(
    GENERATION6_COST_LEVELS_BPS.map((cost) => costRecord(cost)),
    { candidateId: "strong" },
  );
  assert.equal(passing.complete_coverage, true);
  assert.equal(passing.passes, true);
  const failed = assessGeneration6CostSensitivity([
    costRecord(5),
    costRecord(10),
    costRecord(25, 0.01, -0.0001),
  ], { candidateId: "strong" });
  assert.equal(failed.complete_coverage, true);
  assert.equal(failed.evidence[25].gates.validation_edge_exceeds_minimum, false);
  assert.equal(failed.passes, false);
  const incomplete = assessGeneration6CostSensitivity([costRecord(5), costRecord(10)], {
    candidateId: "strong",
  });
  assert.deepEqual(incomplete.missing_cost_levels_bps, [25]);
  assert.equal(incomplete.passes, false);
});

test("rebalance-anchor sensitivity covers every native 21-session phase and fails closed", () => {
  const records = GENERATION6_REBALANCE_ANCHORS.map((anchor) => anchorRecord(
    anchor,
    0.02 + anchor / 100_000,
    0.015 + anchor / 100_000,
  ));
  const passing = assessGeneration6AnchorSensitivity(records, { candidateId: "strong" });
  assert.equal(passing.complete_coverage, true);
  assert.equal(passing.aggregation.complete_offset_coverage, true);
  assert.equal(passing.aggregation.all_gates_pass_across_every_expected_offset, true);
  assert.equal(passing.passes, true);
  const failedRecords = structuredClone(records);
  failedRecords[11].validation_spy_annualized_log_growth_edge = -0.001;
  const failed = assessGeneration6AnchorSensitivity(failedRecords, { candidateId: "strong" });
  assert.deepEqual(
    failed.aggregation.gate_summaries.validation_edge_exceeds_minimum.failed_offsets,
    [11],
  );
  assert.equal(failed.passes, false);
  const incomplete = assessGeneration6AnchorSensitivity(records.slice(1), { candidateId: "strong" });
  assert.deepEqual(incomplete.missing_rebalance_anchors, [0]);
  assert.equal(incomplete.passes, false);
});

test("canonical evidence hashes are key-order independent and summary fails closed", () => {
  const left = { z: [3, { b: true, a: "x" }], a: 1 };
  const right = { a: 1, z: [3, { a: "x", b: true }] };
  assert.equal(canonicalEvidenceJson(left), canonicalEvidenceJson(right));
  assert.equal(hashGeneration6RobustnessEvidence(left), hashGeneration6RobustnessEvidence(right));
  assert.match(hashGeneration6RobustnessEvidence(left), /^[0-9a-f]{64}$/);
  assert.throws(() => canonicalEvidenceJson({ missing: undefined }), /undefined/);

  const summary = summarizeGeneration6PostSelectionRobustness({
    statistical: { passes: true },
    costSensitivity: { passes: true },
    anchorSensitivity: { passes: true },
    riskMatchedSpy: {
      schema_version: "finly_generation6_causal_volatility_matched_spy_slice_assessment.v1",
      passes: true,
    },
    sourceReconciliationPasses: false,
  });
  assert.equal(summary.passes, false);
  assert.deepEqual(summary.failure_reasons, ["independent_source_reconciliation"]);
  assert.match(summary.deterministic_payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    summary.deterministic_payload_sha256,
    hashGeneration6RobustnessEvidence(Object.fromEntries(
      Object.entries(summary).filter(([key]) => key !== "deterministic_payload_sha256"),
    )),
  );
});
