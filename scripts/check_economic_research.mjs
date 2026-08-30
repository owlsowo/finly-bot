import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256 } from "../lib/canonical.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const paths = [
  resolve(projectRoot, "public/data/economic_research.json"),
  resolve(projectRoot, "evidence/economic_research.json"),
  resolve(projectRoot, "src/data/economic_research.json"),
];
const texts = await Promise.all(paths.map((path) => readFile(path, "utf8")));
assert.ok(texts.every((text) => text === texts[0]), "economic research copies diverged");
const report = JSON.parse(texts[0]);
assert.equal(report.schema_version, "finly_economic_research.v1");
const { artifact_sha256: artifactHash, ...body } = report;
assert.equal(artifactHash, sha256(body), "economic research artifact hash is invalid");
assert.equal(report.mutation_authorized, false);
assert.equal(report.future_profitability_guaranteed, false);
assert.equal(report.durable_alpha_proven, false);
assert.equal(report.live_options_profitability_proven, false);
assert.equal(report.protocol.preregistered_candidate_id, "tsmom_ensemble_vol");
assert.equal(report.protocol.selectable_candidate_count, 1);
assert.equal(report.protocol.leverage_allowed, false);
assert.equal(report.protocol.shorting_allowed_by_selected_policy, false);
assert.equal(report.dataset.feed, "sip");
assert.equal(report.dataset.adjustment, "all");
assert.ok(report.dataset.bar_count >= 2_500);
assert.equal(report.dataset.bar_count, report.dataset.cash_bar_count);
assert.equal(report.dataset.raw_bars_embedded_publicly, false);
const { selection_sha256: selectionHash, ...selectionBody } = report.selection_receipt;
assert.equal(selectionHash, sha256(selectionBody), "economic selection receipt hash is invalid");
assert.equal(report.selection_receipt.selection.preregistered_id, "tsmom_ensemble_vol");
assert.equal(report.selection_receipt.selection.selected_id, "tsmom_ensemble_vol");
assert.deepEqual(report.final_holdout.evaluation_order, {
  full_date_range_fetched_before_in_memory_selection_receipt: true,
  training_and_validation_scored_before_final_holdout: true,
  final_holdout_metrics_computed_after_selection_receipt: true,
  selection_receipt_persisted_with_final_report: true,
  claim_boundary: "Control flow prevents final-holdout rows from entering training, validation, or selection. The separate git preregistration commits predate report generation; the in-memory receipt is not a cryptographic proof that a researcher never viewed the historical dates.",
});
assert.equal(report.final_holdout.selected_candidate_id, "tsmom_ensemble_vol");
assert.ok(report.final_holdout.selected_candidate_metrics.total_return > 0);
assert.ok(report.final_holdout.selected_candidate_metrics.maximum_drawdown < 0);
assert.ok(report.final_holdout.selected_candidate_metrics.maximum_absolute_exposure <= 1);
assert.ok(report.final_holdout.selected_candidate_metrics.bil_excess_sharpe > 0);
assert.ok(report.final_holdout.one_way_per_leg_cost_bps_sensitivity["10"].total_return > 0);
assert.ok(report.final_holdout.quarter_fold_evidence.positive_fold_fraction > 0.5);
assert.ok(report.longitudinal_stability.rolling_years.positive_window_fraction > 0.5);
const holdoutStatistics = report.final_holdout.statistical_falsification;
assert.equal(holdoutStatistics.schema_version, "finly_economic_statistical_evidence.v1");
const psr = holdoutStatistics.probabilistic_deflated_sharpe.probabilistic_sharpe
  .probability_observed_sharpe_exceeds_benchmark;
const dsr = holdoutStatistics.probabilistic_deflated_sharpe.deflated_sharpe
  .probability_observed_sharpe_exceeds_deflated_benchmark;
const familywiseP = holdoutStatistics.circular_block_reality_check.familywise_p_value;
const fixedCandidateP = holdoutStatistics.circular_block_reality_check.fixed_candidate_one_sided_p_value;
for (const probability of [psr, dsr, familywiseP, fixedCandidateP]) {
  assert.ok(Number.isFinite(probability) && probability >= 0 && probability <= 1);
}
assert.ok(dsr < 0.95, "deflated Sharpe gate unexpectedly passed");
assert.ok(familywiseP > 0.05, "familywise reality-check gate unexpectedly passed");
assert.equal(report.profitability_evidence_gate.deflated_sharpe_probability_at_least_95_percent, false);
assert.equal(report.profitability_evidence_gate.white_style_familywise_p_value_at_most_5_percent, false);
assert.equal(report.profitability_evidence_gate.prospective_paper_forward_complete, false);
assert.equal(report.profitability_evidence_gate.options_execution_pilot_has_at_least_50_completed_trades, false);
assert.equal(report.profitability_evidence_gate.all_durable_profitability_gates_pass, false);
assert.match(report.evidence_status, /^POSITIVE_FIXED_HOLDOUT_/);
assert.doesNotMatch(texts[0], /"(?:mutation_authorized|future_profitability_guaranteed|durable_alpha_proven|live_options_profitability_proven)"\s*:\s*true/);
console.log(JSON.stringify({
  ok: true,
  artifact_sha256: report.artifact_sha256,
  selection_sha256: report.selection_receipt.selection_sha256,
  selected_candidate_id: report.final_holdout.selected_candidate_id,
  holdout_total_return: report.final_holdout.selected_candidate_metrics.total_return,
  cost_stress_10_bps_total_return: report.final_holdout.one_way_per_leg_cost_bps_sensitivity["10"].total_return,
  deflated_sharpe_probability: dsr,
  white_style_familywise_p_value: familywiseP,
  all_durable_profitability_gates_pass: report.profitability_evidence_gate.all_durable_profitability_gates_pass,
  evidence_status: report.evidence_status,
  copies_verified: paths.length,
}, null, 2));
