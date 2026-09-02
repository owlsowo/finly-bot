import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { buildOptionsPolicyCalibration } from "../lib/options_policy_calibration.mjs";

const input = JSON.parse(await readFile(new URL("../fixtures/spy_adjusted_closes_20160104_20260828.json", import.meta.url)));
const checkedIn = JSON.parse(await readFile(new URL("../evidence/options_policy_calibration.json", import.meta.url)));

test("options policy calibration is deterministic, input-bound, and explicitly not an options P&L backtest", () => {
  const rebuilt = buildOptionsPolicyCalibration(input);
  assert.equal(stableStringify(rebuilt), stableStringify(checkedIn));
  const { artifact_sha256: supplied, ...body } = checkedIn;
  assert.equal(supplied, sha256(body));
  assert.equal(checkedIn.input.input_sha256, sha256(input));
  assert.equal(checkedIn.claim_boundary.historical_options_pnl_measured, false);
  assert.equal(checkedIn.claim_boundary.historical_option_quotes_used, false);
  assert.equal(checkedIn.claim_boundary.broker_orders_or_fills_used, false);
});

test("prospective v3 admits exactly eleven balanced-direction signals on the ordinary fair surface", () => {
  assert.equal(checkedIn.schema_version, "finly_options_policy_calibration.v2");
  assert.equal(checkedIn.sampling.sample_count, 517);
  assert.equal(checkedIn.results.fair_surface.eligible_count, 11);
  assert.equal(checkedIn.results.fair_surface.eligible_rate, 0.0212766);
  assert.deepEqual(checkedIn.results.fair_surface.direction_mix, { bearish: 4, bullish: 7 });
  assert.deepEqual(checkedIn.results.fair_surface.ranges, {
    conservative_ev_dollars: { maximum: 22.26, minimum: 10.08 },
    max_loss_dollars: { maximum: 455, minimum: 440 },
    probability_profit: { maximum: 0.4771, minimum: 0.4512 },
    reward_risk: { maximum: 2.4091, minimum: 2.2967 },
  });
  assert.deepEqual(
    checkedIn.results.fair_surface.eligible_windows.map((row) => row.session),
    ["2017-02-14", "2017-03-01", "2017-10-03", "2018-01-05", "2018-01-22", "2018-12-19", "2020-08-27", "2022-01-25", "2022-10-12", "2024-07-09", "2025-03-13"],
  );
  assert.equal(checkedIn.results.favorable_surface.eligible_count, 24);
  assert.equal(checkedIn.results.favorable_surface.eligible_rate, 0.04642166);
});

test("representative 2023 window reports conservative output without relabeling one model bound", () => {
  const representative = checkedIn.results.favorable_surface.eligible_windows.find((row) => row.session === "2023-12-14");
  assert.equal(representative.max_loss_dollars, 451);
  assert.equal(representative.conservative_ev_dollars, 10.44);
  assert.equal(representative.probability_profit, 0.481);
  assert.equal(representative.reward_risk, 2.3259);
  assert.equal(representative.model_lower_confidence_bounds.tilted_implied_distribution, 19.5);
  assert.equal(representative.model_lower_confidence_bounds.vol_scaled_block_bootstrap, 10.44);
});
