import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateScheduleOffsets,
  annualOriginWindowSummaries,
  CHAMPION_BLOCK_LENGTHS,
  deflatedSharpeAcrossTrials,
  FROZEN_BOOTSTRAP_SEEDS,
  pairedBlockBootstrap,
  pairedBlockBootstrapSuite,
} from "../research/champion_statistics.mjs";

function syntheticRows(count = 1_200) {
  return Array.from({ length: count }, (_, index) => {
    const benchmark = 0.0002 + 0.0007 * Math.sin(index / 11) + 0.0003 * Math.cos(index / 29);
    const strongDifference = 0.0008 + 0.0014 * Math.sin(index / 7) + 0.0005 * Math.cos(index / 19);
    const weakDifference = 0.00004 + 0.0016 * Math.sin(index / 5 + 0.2);
    const negativeDifference = -0.0003 + 0.0012 * Math.cos(index / 9);
    return {
      execution_return_date: new Date(Date.UTC(2018, 0, 1 + index)).toISOString().slice(0, 10),
      strategies: {
        benchmark: { net_return: benchmark },
        strong: { net_return: benchmark + strongDifference },
        weak: { net_return: benchmark + weakDifference },
        negative: { net_return: benchmark + negativeDifference },
        zero: { net_return: benchmark },
      },
    };
  });
}

test("deflated Sharpe uses paired returns and the declared cumulative trial count", () => {
  const rows = syntheticRows();
  const options = {
    benchmarkId: "benchmark",
    fixedCandidateId: "strong",
    cumulativeTrialCount: 66,
    periodsPerYear: 252,
  };
  const evidence = deflatedSharpeAcrossTrials(rows, ["strong", "weak", "negative"], options);
  const repeated = deflatedSharpeAcrossTrials(structuredClone(rows), ["strong", "weak", "negative"], options);
  const onlyCurrentTrials = deflatedSharpeAcrossTrials(rows, ["strong", "weak", "negative"], {
    ...options,
    cumulativeTrialCount: 3,
  });

  assert.deepEqual(evidence, repeated);
  assert.equal(evidence.cumulative_trial_count, 66);
  assert.equal(evidence.supplied_trial_distribution_size, 3);
  assert.equal(evidence.benchmark_id, "benchmark");
  assert.ok(evidence.observed_candidate.mean_daily_paired_return > 0);
  assert.ok(evidence.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark >= 0);
  assert.ok(evidence.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark <= 1);
  assert.ok(
    evidence.deflated_sharpe.benchmark_sharpe_periodic
      >= onlyCurrentTrials.deflated_sharpe.benchmark_sharpe_periodic,
  );
  assert.ok(
    evidence.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark
      <= onlyCurrentTrials.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark,
  );
  assert.ok(Object.isFrozen(evidence));
});

test("paired bootstrap suite is deterministic across frozen circular and moving blocks", () => {
  const rows = syntheticRows(360);
  const options = {
    benchmarkId: "benchmark",
    fixedCandidateId: "strong",
    iterations: 299,
  };
  const left = pairedBlockBootstrapSuite(rows, ["strong", "weak", "negative"], options);
  const right = pairedBlockBootstrapSuite(structuredClone(rows), ["strong", "weak", "negative"], options);

  assert.deepEqual(left, right);
  assert.deepEqual(left.block_lengths_sessions, CHAMPION_BLOCK_LENGTHS);
  for (const method of ["circular", "moving"]) {
    for (const blockLength of CHAMPION_BLOCK_LENGTHS) {
      const evidence = left.evidence[method][blockLength];
      assert.equal(evidence.bootstrap_method, method);
      assert.equal(evidence.block_length_sessions, blockLength);
      assert.equal(evidence.seed, FROZEN_BOOTSTRAP_SEEDS[method][blockLength]);
      assert.equal(evidence.iterations, 299);
      assert.ok(evidence.familywise_p_value >= 0 && evidence.familywise_p_value <= 1);
      assert.ok(evidence.fixed_candidate_familywise_adjusted_p_value >= 0);
      assert.ok(evidence.fixed_candidate_familywise_adjusted_p_value <= 1);
      assert.ok(evidence.fixed_candidate_one_sided_p_value >= 0 && evidence.fixed_candidate_one_sided_p_value <= 1);
      assert.match(evidence.block_sampling, /identical index path/);
    }
  }
  assert.notEqual(
    left.evidence.circular[20].bootstrap_quantiles.maximum_statistic_p95,
    left.evidence.moving[20].bootstrap_quantiles.maximum_statistic_p95,
  );
});

test("a zero paired-return candidate has a one-sided bootstrap p-value of one", () => {
  for (const method of ["circular", "moving"]) {
    const evidence = pairedBlockBootstrap(syntheticRows(180), ["strong", "zero"], {
      benchmarkId: "benchmark",
      fixedCandidateId: "zero",
      method,
      iterations: 199,
      blockLength: 20,
      seed: 42,
    });
    assert.equal(evidence.observed_fixed_candidate_statistic, 0);
    assert.equal(evidence.fixed_candidate_one_sided_p_value, 1);
  }
});

test("annual-origin summaries retain only complete 1/2/3-year session windows", () => {
  const evidence = annualOriginWindowSummaries(syntheticRows(), {
    candidateId: "strong",
    benchmarkId: "benchmark",
  });

  assert.equal(evidence.origin_definition, "First scored session in each calendar year; incomplete trailing windows are omitted.");
  assert.equal(evidence.horizons[252].window_count, 3);
  assert.equal(evidence.horizons[504].window_count, 2);
  assert.equal(evidence.horizons[756].window_count, 2);
  assert.equal(evidence.horizons[252].windows[0].start_date, "2018-01-01");
  assert.equal(evidence.horizons[252].windows[1].start_date, "2019-01-01");
  assert.equal(evidence.horizons[252].positive_fraction, 1);
  assert.ok(evidence.horizons[756].median_annualized_log_growth_difference > 0);
  assert.match(evidence.dependence_boundary, /not independent trials/);
});

test("schedule-offset aggregation preserves nested metrics and fails closed on a gate", () => {
  const records = [
    {
      offset: 0,
      metrics: { raw: { annualized_edge: 0.01 }, risk: { sharpe_edge: 0.20 } },
      gates: { raw: { positive: true }, risk: { acceptable: true } },
    },
    {
      offset: 1,
      metrics: { raw: { annualized_edge: -0.002 }, risk: { sharpe_edge: 0.10 } },
      gates: { raw: { positive: false }, risk: { acceptable: true } },
    },
    {
      offset: 2,
      metrics: { raw: { annualized_edge: 0.004 }, risk: { sharpe_edge: 0.15 } },
      gates: { raw: { positive: true }, risk: { acceptable: true } },
    },
  ];
  const evidence = aggregateScheduleOffsets(records, { expectedOffsets: [0, 1, 2] });

  assert.equal(evidence.complete_offset_coverage, true);
  assert.equal(evidence.metric_summaries["raw.annualized_edge"].minimum, -0.002);
  assert.equal(evidence.metric_summaries["raw.annualized_edge"].minimum_offset, 1);
  assert.equal(evidence.metric_summaries["risk.sharpe_edge"].median, 0.15);
  assert.deepEqual(evidence.gate_summaries["raw.positive"].failed_offsets, [1]);
  assert.equal(evidence.all_metrics_strictly_positive_across_every_expected_offset, false);
  assert.equal(evidence.all_gates_pass_across_every_expected_offset, false);

  const incomplete = aggregateScheduleOffsets(records.slice(0, 2), { expectedOffsets: [0, 1, 2] });
  assert.equal(incomplete.complete_offset_coverage, false);
  assert.deepEqual(incomplete.missing_offsets, [2]);
  assert.equal(incomplete.all_gates_pass_across_every_expected_offset, false);
});

test("validation rejects hidden trials, unpaired inputs, malformed seeds, and offset schema drift", () => {
  const rows = syntheticRows(180);
  assert.throws(
    () => deflatedSharpeAcrossTrials(rows, ["strong", "weak"], {
      benchmarkId: "benchmark",
      fixedCandidateId: "strong",
      cumulativeTrialCount: 1,
    }),
    /from 2 through/,
  );
  assert.throws(
    () => deflatedSharpeAcrossTrials(rows, ["strong", "benchmark"], {
      benchmarkId: "benchmark",
      fixedCandidateId: "strong",
      cumulativeTrialCount: 2,
    }),
    /must not also appear/,
  );
  const missing = structuredClone(rows);
  delete missing[12].strategies.strong.net_return;
  assert.throws(
    () => pairedBlockBootstrap(missing, ["strong"], {
      benchmarkId: "benchmark",
      fixedCandidateId: "strong",
      method: "moving",
      iterations: 100,
      blockLength: 5,
      seed: 1,
    }),
    /net_return must be a finite number/,
  );
  assert.throws(
    () => pairedBlockBootstrapSuite(rows, ["strong"], {
      benchmarkId: "benchmark",
      fixedCandidateId: "strong",
      iterations: 100,
      seeds: { circular: { 5: 1, 20: 2, 60: 3 }, moving: { 5: 4, 20: 5 } },
    }),
    /safe integer/,
  );
  assert.throws(
    () => aggregateScheduleOffsets([
      { offset: 0, metrics: { edge: 0.1 }, gates: { pass: true } },
      { offset: 1, metrics: { other: 0.1 }, gates: { pass: true } },
    ], { expectedOffsets: [0, 1] }),
    /same numeric leaf paths/,
  );
});
