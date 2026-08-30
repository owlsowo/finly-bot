import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);

test("published economic research is hashed, identical, bounded, and candid", async () => {
  const paths = [
    resolve(projectRoot, "public/data/economic_research.json"),
    resolve(projectRoot, "evidence/economic_research.json"),
    resolve(projectRoot, "src/data/economic_research.json"),
  ];
  const texts = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  assert.ok(texts.every((text) => text === texts[0]));
  const report = JSON.parse(texts[0]);
  const { artifact_sha256: artifactHash, ...body } = report;
  assert.equal(artifactHash, sha256(body));
  const { selection_sha256: selectionHash, ...selectionBody } = report.selection_receipt;
  assert.equal(selectionHash, sha256(selectionBody));
  assert.equal(report.protocol.selectable_candidate_count, 1);
  assert.equal(report.selection_receipt.selection.preregistered_id, "tsmom_ensemble_vol");
  assert.equal(report.final_holdout.selected_candidate_id, "tsmom_ensemble_vol");
  assert.ok(report.final_holdout.selected_candidate_metrics.total_return > 0);
  assert.ok(report.final_holdout.one_way_per_leg_cost_bps_sensitivity["10"].total_return > 0);
  assert.ok(report.final_holdout.quarter_fold_evidence.largest_positive_fold_share < 0.5);
  assert.ok(report.longitudinal_stability.post_training_quarter_folds.positive_fold_fraction > 0.5);
  const holdoutStatistics = report.final_holdout.statistical_falsification;
  const psr = holdoutStatistics.probabilistic_deflated_sharpe.probabilistic_sharpe
    .probability_observed_sharpe_exceeds_benchmark;
  const dsr = holdoutStatistics.probabilistic_deflated_sharpe.deflated_sharpe
    .probability_observed_sharpe_exceeds_deflated_benchmark;
  const familywiseP = holdoutStatistics.circular_block_reality_check.familywise_p_value;
  const fixedCandidateP = holdoutStatistics.circular_block_reality_check.fixed_candidate_one_sided_p_value;
  for (const probability of [psr, dsr, familywiseP, fixedCandidateP]) {
    assert.ok(Number.isFinite(probability) && probability >= 0 && probability <= 1);
  }
  assert.ok(psr > 0.5);
  assert.ok(dsr < 0.95);
  assert.ok(familywiseP > 0.05);
  assert.deepEqual(report.profitability_evidence_gate, {
    fixed_holdout_positive_after_modeled_costs: true,
    fixed_holdout_positive_above_bil: true,
    bil_excess_sharpe_exceeds_volatility_target_only: true,
    maximum_drawdown_shallower_than_volatility_target_only: true,
    positive_median_holdout_quarter: true,
    no_single_positive_holdout_quarter_supplies_half_of_positive_log_return: true,
    positive_under_ten_bps_per_traded_leg: true,
    deflated_sharpe_probability_at_least_95_percent: false,
    white_style_familywise_p_value_at_most_5_percent: false,
    prospective_paper_forward_complete: false,
    options_execution_pilot_has_at_least_50_completed_trades: false,
    all_durable_profitability_gates_pass: false,
  });
  assert.deepEqual({
    mutation_authorized: report.mutation_authorized,
    future_profitability_guaranteed: report.future_profitability_guaranteed,
    durable_alpha_proven: report.durable_alpha_proven,
    live_options_profitability_proven: report.live_options_profitability_proven,
  }, {
    mutation_authorized: false,
    future_profitability_guaranteed: false,
    durable_alpha_proven: false,
    live_options_profitability_proven: false,
  });
});
