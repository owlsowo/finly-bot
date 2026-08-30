import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEconomicStatisticalEvidence,
  circularBlockRealityCheckEvidence,
  probabilisticDeflatedSharpeEvidence,
} from "../lib/economic_statistics.mjs";

function economicRows(count = 320) {
  return Array.from({ length: count }, (_, index) => {
    const cashReturn = 0.0001 + 0.00001 * Math.sin(index / 13);
    const positiveExcess = 0.0012 + 0.0015 * Math.sin(index / 5) + 0.0007 * Math.cos(index / 17);
    const weakExcess = 0.00005 + 0.0018 * Math.sin(index / 4 + 0.3);
    return {
      execution_return_date: new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10),
      cash_return: cashReturn,
      strategies: {
        positive: { net_return: cashReturn + positiveExcess },
        weak: { net_return: cashReturn + weakExcess },
        zero: { net_return: cashReturn },
      },
    };
  });
}

test("probabilistic and deflated Sharpe evidence is deterministic, bounded, and explicit", () => {
  const rows = economicRows();
  const options = { fixedCandidateId: "positive", trialCount: 7, periodsPerYear: 252 };
  const left = probabilisticDeflatedSharpeEvidence(rows, ["positive", "weak", "zero"], options);
  const right = probabilisticDeflatedSharpeEvidence(structuredClone(rows), ["positive", "weak", "zero"], options);
  assert.deepEqual(left, right);
  assert.equal(left.trial_count, 7);
  assert.equal(left.observations, rows.length);
  assert.ok(left.observed_candidate.sharpe_annualized > 0);
  assert.ok(left.observed_candidate.pearson_kurtosis > 0);
  assert.ok(left.observed_candidate.non_normality_variance_factor > 0);
  assert.ok(left.probabilistic_sharpe.probability_observed_sharpe_exceeds_benchmark >= 0);
  assert.ok(left.probabilistic_sharpe.probability_observed_sharpe_exceeds_benchmark <= 1);
  assert.ok(left.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark >= 0);
  assert.ok(left.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark <= 1);
  assert.match(left.claim_boundary, /not formal proof/i);
  assert.match(left.reference_formulae.probabilistic_sharpe, /kurtosis/);
});

test("shared circular blocks give deterministic familywise and fixed-candidate p-values", () => {
  const rows = economicRows();
  const options = { fixedCandidateId: "positive", iterations: 999, blockLength: 12, seed: 42 };
  const left = circularBlockRealityCheckEvidence(rows, ["positive", "zero"], options);
  const right = circularBlockRealityCheckEvidence(structuredClone(rows), ["positive", "zero"], options);
  assert.deepEqual(left, right);
  assert.equal(left.observed_maximum_candidate_id, "positive");
  assert.equal(left.familywise_p_value, 0.001);
  assert.equal(left.fixed_candidate_one_sided_p_value, 0.001);
  assert.ok(left.familywise_p_value >= 0 && left.familywise_p_value <= 1);
  assert.ok(left.fixed_candidate_one_sided_p_value >= 0 && left.fixed_candidate_one_sided_p_value <= 1);
  assert.match(left.block_sampling, /identical sampled index path/);
  assert.match(left.claim_boundary, /not a formal proof/i);
});

test("a zero-excess fixed candidate is not mistaken for a positive result", () => {
  const evidence = circularBlockRealityCheckEvidence(economicRows(), ["positive", "zero"], {
    fixedCandidateId: "zero",
    iterations: 499,
    blockLength: 10,
    seed: 9,
  });
  assert.equal(evidence.observed_fixed_candidate_statistic, 0);
  assert.equal(evidence.fixed_candidate_one_sided_p_value, 1);
  assert.ok(evidence.familywise_p_value < 0.05);
});

test("combined evidence preserves the declared configuration", () => {
  const evidence = buildEconomicStatisticalEvidence(economicRows(), ["positive", "weak", "zero"], {
    fixedCandidateId: "positive",
    trialCount: 9,
    periodsPerYear: 252,
    iterations: 199,
    blockLength: 8,
    seed: 2026,
  });
  assert.equal(evidence.probabilistic_deflated_sharpe.trial_count, 9);
  assert.equal(evidence.circular_block_reality_check.iterations, 199);
  assert.equal(evidence.circular_block_reality_check.seed, 2026);
});

test("strict validation rejects malformed rows, candidate sets, and options", () => {
  const rows = economicRows();
  assert.throws(
    () => probabilisticDeflatedSharpeEvidence(rows, ["positive"], { fixedCandidateId: "positive", trialCount: 1 }),
    /at least 2 candidates/,
  );
  assert.throws(
    () => probabilisticDeflatedSharpeEvidence(rows, ["positive", "positive"], { fixedCandidateId: "positive", trialCount: 2 }),
    /duplicates/,
  );
  assert.throws(
    () => probabilisticDeflatedSharpeEvidence(rows, ["positive", "weak"], { fixedCandidateId: "positive", trialCount: 1 }),
    /from 2 through/,
  );
  assert.throws(
    () => probabilisticDeflatedSharpeEvidence(rows, ["positive", "weak"], { fixedCandidateId: "missing", trialCount: 2 }),
    /name one of candidateIds/,
  );
  assert.throws(
    () => probabilisticDeflatedSharpeEvidence(rows, ["positive", "weak"], { fixedCandidateId: "positive", trialCount: 2, guessedTrials: 99 }),
    /unsupported fields/,
  );
  const missingReturn = structuredClone(rows);
  delete missingReturn[10].strategies.positive.net_return;
  assert.throws(
    () => circularBlockRealityCheckEvidence(missingReturn, ["positive", "zero"], { fixedCandidateId: "positive" }),
    /net_return must be a finite number/,
  );
  const duplicateDate = structuredClone(rows);
  duplicateDate[5].execution_return_date = duplicateDate[4].execution_return_date;
  assert.throws(
    () => circularBlockRealityCheckEvidence(duplicateDate, ["positive", "zero"], { fixedCandidateId: "positive" }),
    /strictly chronological/,
  );
  assert.throws(
    () => circularBlockRealityCheckEvidence(rows, ["positive", "zero"], { fixedCandidateId: "positive", iterations: 99 }),
    /from 100 through/,
  );
  assert.throws(
    () => circularBlockRealityCheckEvidence(rows, ["positive", "zero"], { fixedCandidateId: "positive", blockLength: rows.length + 1 }),
    /from 1 through/,
  );
});

test("non-zero constant excess returns fail rather than fabricate a Sharpe ratio", () => {
  const rows = economicRows().map((row) => ({
    ...row,
    strategies: {
      ...row.strategies,
      constant: { net_return: row.cash_return + 0.001 },
    },
  }));
  assert.throws(
    () => probabilisticDeflatedSharpeEvidence(rows, ["constant", "weak"], {
      fixedCandidateId: "constant",
      trialCount: 2,
    }),
    /non-zero mean but zero variance/,
  );
});
