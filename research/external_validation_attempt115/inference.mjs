export const EXTERNAL_ATTEMPT115_INFERENCE_SCHEMA =
  "finly_attempt115_external_mechanism_inference.v2";

export const EXTERNAL_ATTEMPT115_BOOTSTRAP_SEED = 20260829;
export const EXTERNAL_ATTEMPT115_BOOTSTRAP_RESAMPLES = 4_999;
export const EXTERNAL_ATTEMPT115_EXPECTED_BLOCK_SESSIONS = 20;
export const EXTERNAL_ATTEMPT115_RESTART_PROBABILITY =
  1 / EXTERNAL_ATTEMPT115_EXPECTED_BLOCK_SESSIONS;
export const EXTERNAL_ATTEMPT115_NOMINAL_ALPHA = 0.05;
export const EXTERNAL_ATTEMPT115_CUMULATIVE_TRIAL_COUNT = 118;
export const EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD =
  EXTERNAL_ATTEMPT115_NOMINAL_ALPHA
  / EXTERNAL_ATTEMPT115_CUMULATIVE_TRIAL_COUNT;

const MINIMUM_OBSERVATIONS = 41;

function fail(message) {
  throw new TypeError(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function validateDailyValues(dailyValues) {
  if (!Array.isArray(dailyValues) || dailyValues.length < MINIMUM_OBSERVATIONS) {
    fail(`external Attempt115 inference requires at least ${MINIMUM_OBSERVATIONS} paired daily values`);
  }
  dailyValues.forEach((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(`external Attempt115 paired daily value ${index + 1} must be finite`);
    }
  });
}

/**
 * Run the frozen one-sided inference for an arbitrary external replay window.
 *
 * Each input is one paired daily net-log-return difference:
 * challenger minus the frozen Attempt115 incumbent. The series is centered
 * under a zero-mean null and sampled with stationary circular blocks. This
 * function performs no acquisition, parsing, portfolio simulation, or I/O.
 */
export function runExternalAttempt115StationaryBootstrap(dailyValues) {
  validateDailyValues(dailyValues);

  const observedSum = dailyValues.reduce((sum, value) => sum + value, 0);
  const observedMean = observedSum / dailyValues.length;
  if (!Number.isFinite(observedSum) || !Number.isFinite(observedMean)) {
    fail("external Attempt115 observed endpoint exceeds the finite numeric range");
  }
  const centered = dailyValues.map((value) => value - observedMean);
  if (centered.some((value) => !Number.isFinite(value))) {
    fail("external Attempt115 null-centered endpoint exceeds the finite numeric range");
  }
  const random = mulberry32(EXTERNAL_ATTEMPT115_BOOTSTRAP_SEED);
  let exceedances = 0;

  for (let draw = 0; draw < EXTERNAL_ATTEMPT115_BOOTSTRAP_RESAMPLES; draw += 1) {
    let source = Math.floor(random() * centered.length);
    let bootstrapSum = 0;
    for (let index = 0; index < centered.length; index += 1) {
      bootstrapSum += centered[source];
      source = random() < EXTERNAL_ATTEMPT115_RESTART_PROBABILITY
        ? Math.floor(random() * centered.length)
        : (source + 1) % centered.length;
    }
    if (!Number.isFinite(bootstrapSum)) {
      fail("external Attempt115 bootstrap statistic exceeds the finite numeric range");
    }
    if (bootstrapSum / centered.length >= observedMean) exceedances += 1;
  }

  const nominalOneSidedPValue = (1 + exceedances)
    / (EXTERNAL_ATTEMPT115_BOOTSTRAP_RESAMPLES + 1);
  const positiveObservedEdge = observedMean > 0;
  const passesNominalGate = positiveObservedEdge
    && nominalOneSidedPValue <= EXTERNAL_ATTEMPT115_NOMINAL_ALPHA;
  const passesBonferroniGate = positiveObservedEdge
    && nominalOneSidedPValue <= EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD;

  return deepFreeze({
    schema_version: EXTERNAL_ATTEMPT115_INFERENCE_SCHEMA,
    endpoint: "mean paired daily net log-return difference, challenger minus incumbent",
    null_hypothesis: "mean paired daily net log-return difference <= 0",
    alternative_hypothesis: "mean paired daily net log-return difference > 0",
    observations: dailyValues.length,
    observed_sum_paired_net_log_return_difference: observedSum,
    observed_mean_paired_daily_net_log_return_difference: observedMean,
    bootstrap: {
      test: "one-sided null-centered stationary circular block bootstrap",
      null_centered: true,
      centering_formula: "daily_value - observed_mean",
      prng: "mulberry32_uint32",
      seed_uint32: EXTERNAL_ATTEMPT115_BOOTSTRAP_SEED,
      resamples: EXTERNAL_ATTEMPT115_BOOTSTRAP_RESAMPLES,
      expected_block_sessions: EXTERNAL_ATTEMPT115_EXPECTED_BLOCK_SESSIONS,
      restart_probability: EXTERNAL_ATTEMPT115_RESTART_PROBABILITY,
      restart_draw_consumed_after_final_observation: true,
      restart_index_draw_consumed_when_triggered_after_final_observation: true,
      circular_blocks: true,
      equality_counts_as_exceedance: true,
      exceedances,
      nominal_one_sided_p_value: nominalOneSidedPValue,
    },
    multiple_testing: {
      method: "Bonferroni per-test threshold across the disclosed cumulative trial count",
      familywise_alpha: EXTERNAL_ATTEMPT115_NOMINAL_ALPHA,
      cumulative_trial_count: EXTERNAL_ATTEMPT115_CUMULATIVE_TRIAL_COUNT,
      per_test_threshold: EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD,
      adjusted_p_value: Math.min(
        1,
        nominalOneSidedPValue * EXTERNAL_ATTEMPT115_CUMULATIVE_TRIAL_COUNT,
      ),
    },
    decision: {
      positive_observed_edge: positiveObservedEdge,
      nominal_alpha: EXTERNAL_ATTEMPT115_NOMINAL_ALPHA,
      nominal_one_sided_p_value: nominalOneSidedPValue,
      passes_nominal_gate: passesNominalGate,
      bonferroni_threshold: EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD,
      passes_bonferroni_gate: passesBonferroniGate,
    },
    claim_boundary:
      "External fixed-sample mechanism evidence only; this result cannot establish SPY/BIL execution, future alpha, or live profitability.",
  });
}
