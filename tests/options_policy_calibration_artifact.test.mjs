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

test("517 sampled signals abstain on the fair surface and only three pass the favorable sensitivity surface", () => {
  assert.equal(checkedIn.sampling.sample_count, 517);
  assert.deepEqual(checkedIn.results.fair_surface, { eligible_count: 0, eligible_rate: 0 });
  assert.equal(checkedIn.results.favorable_surface.eligible_count, 3);
  assert.equal(checkedIn.results.favorable_surface.eligible_rate, 0.00580271);
  assert.deepEqual(
    checkedIn.results.favorable_surface.eligible_windows.map((row) => row.session),
    ["2020-08-27", "2023-12-14", "2024-07-09"],
  );
});

test("representative 2023 window reports conservative output without relabeling one model bound", () => {
  const representative = checkedIn.results.favorable_surface.eligible_windows.find((row) => row.session === "2023-12-14");
  assert.equal(representative.max_loss_dollars, 426);
  assert.equal(representative.conservative_ev_dollars, 9.5);
  assert.equal(representative.probability_profit, 0.5127);
  assert.equal(representative.model_lower_confidence_bounds.tilted_implied_distribution, 10.16);
  assert.equal(representative.model_lower_confidence_bounds.vol_scaled_block_bootstrap, 9.5);
});
