import {
  GENERATION6_BLOCK_LENGTHS,
  GENERATION6_BOOTSTRAP_ITERATIONS,
  GENERATION6_BOOTSTRAP_SEEDS,
  GENERATION6_CUMULATIVE_TRIALS,
} from "./champion_generation6_robustness.mjs";

const MAX_UINT32 = 0xffff_ffff;
const FAMILYWISE_ALPHA = 0.05;

export const GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS = Object.freeze([
  "g6_trend_guard_g4",
  "g6_vol_target_g4",
  "g6_breadth_scaled_g4",
  "g6_residual_sector",
  "g6_long_only_tsmom_1_3_12",
  "g6_hrp_trend",
  "g6_equal_evidence_ensemble",
]);

export const GENERATION6_GROWTH_STATISTICS_CONTROL_IDS = Object.freeze([
  "qqq_buy_hold",
  "static_spy_qqq_50_50_control",
  "static_qqq_equal_sectors_control",
]);

export const GENERATION6_GROWTH_STATISTICS_SPECIFICATION = Object.freeze({
  candidate_ids: GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS,
  control_ids: GENERATION6_GROWTH_STATISTICS_CONTROL_IDS,
  cumulative_effective_trials: GENERATION6_CUMULATIVE_TRIALS,
  bootstrap_iterations_per_test: GENERATION6_BOOTSTRAP_ITERATIONS,
  block_lengths_sessions: GENERATION6_BLOCK_LENGTHS,
  methods: Object.freeze(["circular", "moving"]),
  frozen_seeds: GENERATION6_BOOTSTRAP_SEEDS,
  familywise_alpha: FAMILYWISE_ALPHA,
});

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value;
}

function strictOptions(value, allowedKeys, path = "options") {
  const options = plainObject(value, path);
  const unexpected = Object.keys(options).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) fail(`${path} contains unsupported fields: ${unexpected.join(", ")}`);
  return options;
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a finite number`);
  return value;
}

function integerInRange(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${path} must be a safe integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function calendarDate(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${path} must be a YYYY-MM-DD date`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    fail(`${path} is not a valid calendar date`);
  }
  return value;
}

function round(value, places = 12) {
  if (!Number.isFinite(value)) fail("statistical output must be finite");
  const scale = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function kahanSum(values) {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const adjusted = value - compensation;
    const next = sum + adjusted;
    compensation = (next - sum) - adjusted;
    sum = next;
  }
  if (!Number.isFinite(sum)) fail("statistical sum exceeds the finite numeric range");
  return sum;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) fail("mean requires at least one value");
  return kahanSum(values) / values.length;
}

function quantile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function validateFixedCandidateId(value) {
  if (!GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS.includes(value)) {
    fail("fixedCandidateId must name one of the seven frozen Generation 6 growth candidates");
  }
  return value;
}

function validateRows(rows) {
  const requiredIds = [
    ...GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS,
    ...GENERATION6_GROWTH_STATISTICS_CONTROL_IDS,
  ];
  const minimumRows = Math.max(...GENERATION6_BLOCK_LENGTHS);
  if (!Array.isArray(rows) || rows.length < minimumRows) {
    fail(`rows must contain at least ${minimumRows} exactly aligned observations`);
  }
  const dates = [];
  const logReturns = Object.fromEntries(requiredIds.map((id) => [id, []]));
  let priorDate = "";
  rows.forEach((rowValue, rowIndex) => {
    const row = plainObject(rowValue, `rows[${rowIndex}]`);
    const date = calendarDate(row.execution_return_date, `rows[${rowIndex}].execution_return_date`);
    if (date <= priorDate) fail("rows must be strictly chronological by execution_return_date");
    priorDate = date;
    dates.push(date);
    const strategies = plainObject(row.strategies, `rows[${rowIndex}].strategies`);
    for (const id of requiredIds) {
      const record = plainObject(strategies[id], `rows[${rowIndex}].strategies.${id}`);
      const netReturn = finiteNumber(record.net_return, `rows[${rowIndex}].strategies.${id}.net_return`);
      if (netReturn <= -1) fail(`rows[${rowIndex}].strategies.${id}.net_return must be greater than -1`);
      logReturns[id].push(Math.log1p(netReturn));
    }
  });
  return { dates, logReturns };
}

function candidateMinimumEdges(strategyMeans) {
  const maximumControlMean = Math.max(
    ...GENERATION6_GROWTH_STATISTICS_CONTROL_IDS.map((id) => strategyMeans[id]),
  );
  return Object.fromEntries(GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS.map((id) => [
    id,
    strategyMeans[id] - maximumControlMean,
  ]));
}

function candidateControlEdges(strategyMeans, candidateId) {
  return Object.fromEntries(GENERATION6_GROWTH_STATISTICS_CONTROL_IDS.map((controlId) => [
    controlId,
    strategyMeans[candidateId] - strategyMeans[controlId],
  ]));
}

function prepareBlockSums(centeredSeries, observations, blockLength, method) {
  const circular = method === "circular";
  const startCount = circular ? observations : observations - blockLength + 1;
  const remainder = observations % blockLength;
  const fullBlocks = Math.floor(observations / blockLength);
  const sumAt = (start, width) => centeredSeries.map((series) => {
    let sum = 0;
    for (let offset = 0; offset < width; offset += 1) {
      const index = circular ? (start + offset) % observations : start + offset;
      sum += series[index];
    }
    return sum;
  });
  return {
    startCount,
    fullBlocks,
    remainder,
    full: Array.from({ length: startCount }, (_, start) => sumAt(start, blockLength)),
    partial: remainder === 0
      ? null
      : Array.from({ length: startCount }, (_, start) => sumAt(start, remainder)),
  };
}

function sampledCenteredMeans(prepared, seriesCount, observations, random) {
  const sums = Array(seriesCount).fill(0);
  for (let block = 0; block < prepared.fullBlocks; block += 1) {
    const start = Math.floor(random() * prepared.startCount);
    const blockSums = prepared.full[start];
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      sums[seriesIndex] += blockSums[seriesIndex];
    }
  }
  if (prepared.remainder > 0) {
    const start = Math.floor(random() * prepared.startCount);
    const blockSums = prepared.partial[start];
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      sums[seriesIndex] += blockSums[seriesIndex];
    }
  }
  return sums.map((value) => value / observations);
}

function roundedRecord(ids, values) {
  return Object.fromEntries(ids.map((id) => [id, round(values[id])]));
}

function blockMethodLabel(method) {
  return method === "circular"
    ? "circular blocks with wraparound"
    : "moving blocks without wraparound";
}

/**
 * Evaluate one frozen shared-block specification. The candidate score is its
 * weakest mean log-return edge across the three controls. The family statistic
 * is the strongest of those seven candidate scores.
 */
export function generation6GrowthJointBlockBootstrap(rows, fixedCandidateId, options = {}) {
  const normalized = strictOptions(
    options,
    new Set(["method", "iterations", "blockLength", "seed"]),
  );
  const fixed = validateFixedCandidateId(fixedCandidateId);
  if (!GENERATION6_GROWTH_STATISTICS_SPECIFICATION.methods.includes(normalized.method)) {
    fail('options.method must be either "circular" or "moving"');
  }
  const iterations = integerInRange(normalized.iterations, "options.iterations", 100, 100_000);
  const { dates, logReturns } = validateRows(rows);
  const blockLength = integerInRange(normalized.blockLength, "options.blockLength", 1, rows.length);
  if (!GENERATION6_BLOCK_LENGTHS.includes(blockLength)) {
    fail(`options.blockLength must be one of ${GENERATION6_BLOCK_LENGTHS.join(", ")}`);
  }
  const seed = integerInRange(normalized.seed, "options.seed", 0, MAX_UINT32);
  const requiredIds = [
    ...GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS,
    ...GENERATION6_GROWTH_STATISTICS_CONTROL_IDS,
  ];
  const observations = rows.length;
  const rootN = Math.sqrt(observations);
  const observedMeans = Object.fromEntries(requiredIds.map((id) => [id, mean(logReturns[id])]));
  const observedMinimumEdges = candidateMinimumEdges(observedMeans);
  const observedStatistics = Object.fromEntries(GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS.map((id) => [
    id,
    rootN * observedMinimumEdges[id],
  ]));
  const observedGlobalStatistic = Math.max(...Object.values(observedStatistics));
  const observedGlobalCandidateId = GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS.find(
    (id) => observedStatistics[id] === observedGlobalStatistic,
  );
  const observedFixedStatistic = observedStatistics[fixed];
  const observedFixedControlEdges = candidateControlEdges(observedMeans, fixed);
  const observedFixedControlStatistics = Object.fromEntries(
    GENERATION6_GROWTH_STATISTICS_CONTROL_IDS.map((controlId) => [
      controlId,
      rootN * observedFixedControlEdges[controlId],
    ]),
  );
  const centeredSeries = requiredIds.map((id) => (
    logReturns[id].map((value) => value - observedMeans[id])
  ));
  const prepared = prepareBlockSums(
    centeredSeries,
    observations,
    blockLength,
    normalized.method,
  );
  const random = mulberry32(seed);
  const bootstrapGlobalStatistics = [];
  const bootstrapFixedStatistics = [];
  let globalStatisticExceedances = 0;
  let fixedSelectionAdjustedExceedances = 0;
  let fixedUnadjustedExceedances = 0;
  const pairwiseExceedances = Object.fromEntries(
    GENERATION6_GROWTH_STATISTICS_CONTROL_IDS.map((controlId) => [controlId, 0]),
  );

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sampledMeansArray = sampledCenteredMeans(
      prepared,
      requiredIds.length,
      observations,
      random,
    );
    const sampledMeans = Object.fromEntries(
      requiredIds.map((id, index) => [id, sampledMeansArray[index]]),
    );
    const sampledMinimumEdges = candidateMinimumEdges(sampledMeans);
    const sampledStatistics = Object.fromEntries(
      GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS.map((id) => [
        id,
        rootN * sampledMinimumEdges[id],
      ]),
    );
    const sampledGlobalStatistic = Math.max(...Object.values(sampledStatistics));
    const sampledFixedStatistic = sampledStatistics[fixed];
    bootstrapGlobalStatistics.push(sampledGlobalStatistic);
    bootstrapFixedStatistics.push(sampledFixedStatistic);
    if (sampledGlobalStatistic >= observedGlobalStatistic) globalStatisticExceedances += 1;
    if (sampledGlobalStatistic >= observedFixedStatistic) fixedSelectionAdjustedExceedances += 1;
    if (sampledFixedStatistic >= observedFixedStatistic) fixedUnadjustedExceedances += 1;
    const sampledFixedControlEdges = candidateControlEdges(sampledMeans, fixed);
    for (const controlId of GENERATION6_GROWTH_STATISTICS_CONTROL_IDS) {
      if (rootN * sampledFixedControlEdges[controlId] >= observedFixedControlStatistics[controlId]) {
        pairwiseExceedances[controlId] += 1;
      }
    }
  }

  const pValue = (exceedances) => (exceedances + 1) / (iterations + 1);
  const pairwisePValues = Object.fromEntries(
    GENERATION6_GROWTH_STATISTICS_CONTROL_IDS.map((controlId) => [
      controlId,
      pValue(pairwiseExceedances[controlId]),
    ]),
  );
  const fixedCandidateIutPValue = Math.max(...Object.values(pairwisePValues));
  const selectionAdjustedJointPValue = pValue(fixedSelectionAdjustedExceedances);
  const conservativeJointIutPValue = Math.max(
    fixedCandidateIutPValue,
    selectionAdjustedJointPValue,
  );
  const cumulativeAdjustedPValue = Math.min(
    1,
    conservativeJointIutPValue * GENERATION6_CUMULATIVE_TRIALS,
  );

  return deepFreeze({
    schema_version: "finly_generation6_growth_joint_block_bootstrap.v1",
    method: "shared-block centered max-over-candidates/min-over-growth-controls bootstrap with an intersection-union safeguard",
    status: "TESTED",
    fixed_candidate_id: fixed,
    candidate_ids: [...GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS],
    control_ids: [...GENERATION6_GROWTH_STATISTICS_CONTROL_IDS],
    observations,
    start_date: dates[0],
    end_date: dates.at(-1),
    return_definition: "daily log1p(candidate net_return) minus daily log1p(control net_return) on the identical row",
    candidate_statistic: "sqrt(n) times the minimum mean daily log-return edge across the three controls",
    family_statistic: "the maximum candidate statistic across all seven frozen Generation 6 candidates",
    null_hypothesis: "No frozen Generation 6 candidate has a positive population mean log-return edge over every one of the three growth controls.",
    alternative_hypothesis: "At least one frozen Generation 6 candidate has a positive population mean log-return edge over all three growth controls.",
    bootstrap_method: normalized.method,
    block_sampling: `One identical index path is applied to every candidate and control in each draw; ${blockMethodLabel(normalized.method)}.`,
    iterations,
    block_length_sessions: blockLength,
    seed,
    observed_mean_daily_log_returns: roundedRecord(requiredIds, observedMeans),
    observed_minimum_daily_log_edges: roundedRecord(
      GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS,
      observedMinimumEdges,
    ),
    observed_candidate_statistics: roundedRecord(
      GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS,
      observedStatistics,
    ),
    observed_global_candidate_id: observedGlobalCandidateId,
    observed_global_statistic: round(observedGlobalStatistic),
    observed_fixed_candidate_statistic: round(observedFixedStatistic),
    fixed_candidate_is_observed_global_maximum: observedGlobalCandidateId === fixed,
    fixed_candidate_control_edges: Object.fromEntries(
      GENERATION6_GROWTH_STATISTICS_CONTROL_IDS.map((controlId) => [controlId, {
        mean_daily_log_edge: round(observedFixedControlEdges[controlId]),
        statistic: round(observedFixedControlStatistics[controlId]),
        exceedances: pairwiseExceedances[controlId],
        add_one_one_sided_p_value: round(pairwisePValues[controlId]),
      }]),
    ),
    global_statistic_exceedances: globalStatisticExceedances,
    global_family_p_value: round(pValue(globalStatisticExceedances)),
    fixed_candidate_selection_adjusted_exceedances: fixedSelectionAdjustedExceedances,
    fixed_candidate_selection_adjusted_joint_max_min_p_value: round(selectionAdjustedJointPValue),
    fixed_candidate_unadjusted_max_min_exceedances: fixedUnadjustedExceedances,
    fixed_candidate_unadjusted_max_min_p_value: round(pValue(fixedUnadjustedExceedances)),
    fixed_candidate_intersection_union_p_value: round(fixedCandidateIutPValue),
    conservative_joint_and_iut_raw_p_value: round(conservativeJointIutPValue),
    cumulative_113_trial_bonferroni_adjusted_p_value: round(cumulativeAdjustedPValue),
    passes_cumulative_113_trial_5_percent_gate: cumulativeAdjustedPValue <= FAMILYWISE_ALPHA,
    multiplicity: {
      candidate_selection: "The shared-block maximum ranges over all seven frozen Generation 6 candidates.",
      control_family: "Intersection-union testing uses the maximum of the three control-specific one-sided p-values; no times-three correction is required to claim superiority over all three controls.",
      cumulative_trials: "The conservative raw joint/IUT p-value is Bonferroni-multiplied by all 113 disclosed effective strategy trials, including the seven current candidates.",
      deliberately_not_used: "No naive 113-times-3 correction: the three controls define one intersection alternative rather than three interchangeable discoveries.",
    },
    bootstrap_quantiles: {
      global_max_min_p90: round(quantile(bootstrapGlobalStatistics, 0.90)),
      global_max_min_p95: round(quantile(bootstrapGlobalStatistics, 0.95)),
      global_max_min_p99: round(quantile(bootstrapGlobalStatistics, 0.99)),
      fixed_max_min_p90: round(quantile(bootstrapFixedStatistics, 0.90)),
      fixed_max_min_p95: round(quantile(bootstrapFixedStatistics, 0.95)),
      fixed_max_min_p99: round(quantile(bootstrapFixedStatistics, 0.99)),
    },
    interpretation: "Rejection means the fixed, previously selected challenger cleared all three mean log-growth controls under this block specification after a deliberately conservative 113-trial correction; it is not a risk-adjusted or forward-profitability claim.",
    caveats: [
      "The centered joint max-min bootstrap calibrates the global zero-mean boundary and relies on weak stationarity plus a subset-pivotal-style approximation for the composite null.",
      "The reported intersection-union safeguard is the maximum control-specific p-value, so one weak control comparison prevents rejection without multiplying by three.",
      "Bonferroni validity depends on the 113-trial ledger being complete; it cannot recreate an untouched holdout after the historical panel was inspected.",
      "The test concerns mean log growth only. It does not establish superior drawdown, tail risk, implementability, options P&L, or future profitability.",
    ],
  });
}

function noSelectionEvidence(iterations) {
  const minimumRawPValue = 1 / (iterations + 1);
  const minimumAdjustedPValue = Math.min(
    1,
    minimumRawPValue * GENERATION6_CUMULATIVE_TRIALS,
  );
  return deepFreeze({
    schema_version: "finly_generation6_growth_joint_statistical_suite.v1",
    status: "NOT_TESTED_NO_FIXED_GROWTH_CHALLENGER",
    fixed_candidate_id: null,
    candidate_ids: [...GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS],
    control_ids: [...GENERATION6_GROWTH_STATISTICS_CONTROL_IDS],
    cumulative_effective_trials: GENERATION6_CUMULATIVE_TRIALS,
    bootstrap_iterations_per_test: iterations,
    bootstrap_resolution: {
      add_one_p_value_correction: true,
      minimum_attainable_raw_p_value: round(minimumRawPValue),
      minimum_attainable_cumulative_113_trial_adjusted_p_value: round(minimumAdjustedPValue),
      can_resolve_5_percent_gate: minimumAdjustedPValue <= FAMILYWISE_ALPHA,
    },
    evidence: null,
    gates: {
      fixed_growth_challenger_exists: false,
      all_six_block_tests_pass_cumulative_113_trial_gate: false,
    },
    passes: false,
    interpretation: "No growth-control candidate was fixed before post-selection testing, so the procedure fails closed without examining returns.",
  });
}

/** Run the frozen circular/moving 5/20/60-session joint growth tests. */
export function buildGeneration6GrowthJointStatisticalEvidence(
  rows,
  fixedCandidateId,
  options = {},
) {
  const normalized = strictOptions(options, new Set(["iterations"]));
  const iterations = integerInRange(
    normalized.iterations ?? GENERATION6_BOOTSTRAP_ITERATIONS,
    "options.iterations",
    100,
    100_000,
  );
  if (fixedCandidateId === null) {
    if (rows !== null) fail("rows must be null when fixedCandidateId is null");
    return noSelectionEvidence(iterations);
  }
  const fixed = validateFixedCandidateId(fixedCandidateId);
  validateRows(rows);
  const evidence = {};
  for (const method of GENERATION6_GROWTH_STATISTICS_SPECIFICATION.methods) {
    evidence[method] = Object.fromEntries(GENERATION6_BLOCK_LENGTHS.map((blockLength) => [
      String(blockLength),
      generation6GrowthJointBlockBootstrap(rows, fixed, {
        method,
        iterations,
        blockLength,
        seed: GENERATION6_BOOTSTRAP_SEEDS[method][blockLength],
      }),
    ]));
  }
  const tests = Object.values(evidence).flatMap((method) => Object.values(method));
  const minimumRawPValue = 1 / (iterations + 1);
  const minimumAdjustedPValue = Math.min(
    1,
    minimumRawPValue * GENERATION6_CUMULATIVE_TRIALS,
  );
  const gates = {
    fixed_growth_challenger_exists: true,
    bootstrap_resolution_can_resolve_5_percent_gate:
      minimumAdjustedPValue <= FAMILYWISE_ALPHA,
    all_six_block_tests_pass_cumulative_113_trial_gate:
      tests.every((test) => test.passes_cumulative_113_trial_5_percent_gate),
  };
  return deepFreeze({
    schema_version: "finly_generation6_growth_joint_statistical_suite.v1",
    status: "TESTED",
    fixed_candidate_id: fixed,
    candidate_ids: [...GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS],
    control_ids: [...GENERATION6_GROWTH_STATISTICS_CONTROL_IDS],
    cumulative_effective_trials: GENERATION6_CUMULATIVE_TRIALS,
    bootstrap_iterations_per_test: iterations,
    block_lengths_sessions: [...GENERATION6_BLOCK_LENGTHS],
    frozen_seeds: GENERATION6_BOOTSTRAP_SEEDS,
    bootstrap_resolution: {
      add_one_p_value_correction: true,
      minimum_attainable_raw_p_value: round(minimumRawPValue),
      minimum_attainable_cumulative_113_trial_adjusted_p_value: round(minimumAdjustedPValue),
      can_resolve_5_percent_gate: minimumAdjustedPValue <= FAMILYWISE_ALPHA,
      disclosure: `With ${iterations.toLocaleString("en-US")} draws, the minimum add-one raw p-value is 1/${(iterations + 1).toLocaleString("en-US")} = ${round(minimumRawPValue)} and the minimum 113-trial Bonferroni value is ${round(minimumAdjustedPValue)}.`,
    },
    evidence,
    gates,
    passes: Object.values(gates).every(Boolean),
    interpretation: "All six frozen dependence specifications must agree before the growth-control challenge passes.",
    claim_boundary: "This is a retrospective, selection-penalized mean-log-growth comparison on a consumed panel, not untouched out-of-sample evidence or a promise of future profit.",
  });
}
