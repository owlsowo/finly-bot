import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD,
  EXTERNAL_ATTEMPT115_BOOTSTRAP_RESAMPLES,
  EXTERNAL_ATTEMPT115_CUMULATIVE_TRIAL_COUNT,
  EXTERNAL_ATTEMPT115_NOMINAL_ALPHA,
  runExternalAttempt115StationaryBootstrap,
} from "../research/external_validation_attempt115/inference.mjs";
import { runAttempt115FrozenPrimaryBootstrap } from "../research/prospective_attempt115/inference.mjs";

function oscillatingFixture(count, shift = 0) {
  return Array.from({ length: count }, (_, index) => (
    shift
    + 0.00018 * Math.sin(index / 7)
    + 0.00007 * Math.cos(index / 23)
  ));
}

test("external stationary bootstrap is deterministic for arbitrary windows longer than 40 sessions", () => {
  const values = oscillatingFixture(731, 0.001);
  const first = runExternalAttempt115StationaryBootstrap(values);
  const second = runExternalAttempt115StationaryBootstrap(structuredClone(values));

  assert.deepEqual(first, second);
  assert.equal(first.observations, 731);
  assert.equal(first.bootstrap.resamples, 4_999);
  assert.equal(first.bootstrap.seed_uint32, 20260829);
  assert.equal(first.bootstrap.expected_block_sessions, 20);
  assert.equal(first.bootstrap.restart_probability, 0.05);
  assert.equal(first.bootstrap.exceedances, 0);
  assert.equal(first.bootstrap.nominal_one_sided_p_value, 0.0002);
  assert.equal(
    first.observed_mean_paired_daily_net_log_return_difference,
    0.0010038498476716154,
  );
  assert.equal(
    first.bootstrap.nominal_one_sided_p_value,
    (1 + first.bootstrap.exceedances) / 5_000,
  );
  assert.equal(first.decision.passes_nominal_gate, true);
  assert.equal(first.decision.passes_bonferroni_gate, true);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.bootstrap));
});

test("252-session synthetic input exactly aligns with the frozen Attempt115 bootstrap", () => {
  const values = oscillatingFixture(252, 0.00008);
  const generic = runExternalAttempt115StationaryBootstrap(values);
  const frozen = runAttempt115FrozenPrimaryBootstrap(values);

  assert.equal(
    generic.observed_sum_paired_net_log_return_difference,
    frozen.observed_sum,
  );
  assert.equal(
    generic.observed_mean_paired_daily_net_log_return_difference,
    frozen.observed_mean,
  );
  assert.equal(generic.bootstrap.exceedances, frozen.exceedances);
  assert.equal(
    generic.bootstrap.nominal_one_sided_p_value,
    frozen.one_sided_p_value,
  );
  assert.equal(generic.decision.passes_nominal_gate, frozen.supports_positive_edge);
});

test("equality counts as exceedance for an identically zero paired series", () => {
  const result = runExternalAttempt115StationaryBootstrap(Array(127).fill(0));

  assert.equal(result.bootstrap.equality_counts_as_exceedance, true);
  assert.equal(result.bootstrap.exceedances, EXTERNAL_ATTEMPT115_BOOTSTRAP_RESAMPLES);
  assert.equal(result.bootstrap.nominal_one_sided_p_value, 1);
  assert.equal(result.decision.positive_observed_edge, false);
  assert.equal(result.decision.passes_nominal_gate, false);
  assert.equal(result.decision.passes_bonferroni_gate, false);
});

test("Bonferroni reporting is fixed to alpha 0.05 across all 118 disclosed trials", () => {
  const result = runExternalAttempt115StationaryBootstrap(
    oscillatingFixture(401, 0.001),
  );

  assert.equal(EXTERNAL_ATTEMPT115_CUMULATIVE_TRIAL_COUNT, 118);
  assert.equal(EXTERNAL_ATTEMPT115_NOMINAL_ALPHA, 0.05);
  assert.equal(EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD, 0.05 / 118);
  assert.equal(result.multiple_testing.cumulative_trial_count, 118);
  assert.equal(result.multiple_testing.per_test_threshold, 0.05 / 118);
  assert.equal(result.decision.bonferroni_threshold, 0.05 / 118);
  assert.equal(
    result.multiple_testing.adjusted_p_value,
    Math.min(1, result.bootstrap.nominal_one_sided_p_value * 118),
  );
  assert.equal(
    result.decision.passes_bonferroni_gate,
    result.decision.positive_observed_edge
      && result.bootstrap.nominal_one_sided_p_value <= 0.05 / 118,
  );
});

test("input validation requires more than 40 finite paired daily values", () => {
  const minimum = runExternalAttempt115StationaryBootstrap(oscillatingFixture(41));
  assert.equal(minimum.observations, 41);

  assert.throws(
    () => runExternalAttempt115StationaryBootstrap(oscillatingFixture(40)),
    /at least 41 paired daily values/iu,
  );
  assert.throws(
    () => runExternalAttempt115StationaryBootstrap("not-an-array"),
    /at least 41 paired daily values/iu,
  );
  const malformed = oscillatingFixture(60);
  malformed[17] = Number.NaN;
  assert.throws(
    () => runExternalAttempt115StationaryBootstrap(malformed),
    /paired daily value 18 must be finite/iu,
  );
  assert.throws(
    () => runExternalAttempt115StationaryBootstrap(Array(41).fill(Number.MAX_VALUE)),
    /observed endpoint exceeds the finite numeric range/iu,
  );
});
