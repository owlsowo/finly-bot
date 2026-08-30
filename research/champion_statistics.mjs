const DEFAULT_PERIODS_PER_YEAR = 252;
const DEFAULT_BOOTSTRAP_ITERATIONS = 2_000;
const EULER_MASCHERONI = 0.5772156649015329;
const MAX_UINT32 = 0xffff_ffff;

export const CHAMPION_BLOCK_LENGTHS = Object.freeze([5, 20, 60]);

export const FROZEN_BOOTSTRAP_SEEDS = Object.freeze({
  circular: Object.freeze({ 5: 20_260_905, 20: 20_260_920, 60: 20_260_960 }),
  moving: Object.freeze({ 5: 20_261_905, 20: 20_261_920, 60: 20_261_960 }),
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

function identifier(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    fail(`${path} must contain only letters, numbers, dots, underscores, or hyphens`);
  }
  return value;
}

function validateIdentifiers(values, path, { minimum = 1 } = {}) {
  if (!Array.isArray(values) || values.length < minimum) {
    fail(`${path} must contain at least ${minimum} identifier${minimum === 1 ? "" : "s"}`);
  }
  const normalized = values.map((value, index) => identifier(value, `${path}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${path} must not contain duplicates`);
  return normalized;
}

function validateCalendarDate(value, path) {
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

function roundedOrNull(value) {
  return value === null ? null : round(value);
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
  if (values.length === 0) fail("mean requires at least one value");
  return kahanSum(values) / values.length;
}

function sampleStandardDeviation(values, average = mean(values)) {
  if (values.length < 2) fail("sample standard deviation requires at least two observations");
  const squaredDeviations = values.map((value) => (value - average) ** 2);
  if (squaredDeviations.some((value) => !Number.isFinite(value))) fail("sample variance exceeds the finite numeric range");
  return Math.sqrt(kahanSum(squaredDeviations) / (values.length - 1));
}

function quantile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function validatePanelRows(rows, strategyIds, minimumObservations = 2) {
  if (!Array.isArray(rows) || rows.length < minimumObservations) {
    fail(`rows must contain at least ${minimumObservations} observations`);
  }
  const dates = [];
  const matrix = strategyIds.map(() => []);
  let priorDate = "";
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const rowPath = `rows[${rowIndex}]`;
    const row = plainObject(rows[rowIndex], rowPath);
    const date = validateCalendarDate(row.execution_return_date, `${rowPath}.execution_return_date`);
    if (date <= priorDate) fail("rows must be strictly chronological by execution_return_date");
    priorDate = date;
    dates.push(date);
    const strategies = plainObject(row.strategies, `${rowPath}.strategies`);
    strategyIds.forEach((strategyId, strategyIndex) => {
      const record = plainObject(strategies[strategyId], `${rowPath}.strategies.${strategyId}`);
      const netReturn = finiteNumber(record.net_return, `${rowPath}.strategies.${strategyId}.net_return`);
      if (netReturn <= -1) fail(`${rowPath}.strategies.${strategyId}.net_return must be greater than -1`);
      matrix[strategyIndex].push(netReturn);
    });
  }
  return { dates, matrix };
}

function pairedMatrix(rows, candidateIds, benchmarkId, minimumObservations = 2) {
  const candidates = validateIdentifiers(candidateIds, "candidateIds", { minimum: 1 });
  const benchmark = identifier(benchmarkId, "options.benchmarkId");
  if (candidates.includes(benchmark)) fail("options.benchmarkId must not also appear in candidateIds");
  const strategyIds = [...candidates, benchmark];
  const { dates, matrix } = validatePanelRows(rows, strategyIds, minimumObservations);
  const benchmarkReturns = matrix.at(-1);
  return {
    candidates,
    benchmark,
    dates,
    matrix: matrix.slice(0, -1).map((values) => values.map((value, index) => value - benchmarkReturns[index])),
  };
}

function sharpeEstimate(values, path) {
  const average = mean(values);
  const standardDeviation = sampleStandardDeviation(values, average);
  if (standardDeviation === 0) {
    if (average === 0) return { mean: 0, standardDeviation: 0, sharpe: 0, degenerateZeroSeries: true };
    fail(`${path} has non-zero mean but zero variance, so its Sharpe ratio is undefined`);
  }
  const sharpe = average / standardDeviation;
  if (!Number.isFinite(sharpe)) fail(`${path} Sharpe ratio exceeds the finite numeric range`);
  return { mean: average, standardDeviation, sharpe, degenerateZeroSeries: false };
}

function nonNormalMoments(values, average, standardDeviation, path) {
  if (standardDeviation === 0) {
    return { skewness: 0, pearsonKurtosis: 3, convention: "zero-series normal-moment convention" };
  }
  const populationVariance = kahanSum(values.map((value) => (value - average) ** 2)) / values.length;
  if (!(populationVariance > 0) || !Number.isFinite(populationVariance)) fail(`${path} population variance must be positive and finite`);
  const thirdMoment = kahanSum(values.map((value) => (value - average) ** 3)) / values.length;
  const fourthMoment = kahanSum(values.map((value) => (value - average) ** 4)) / values.length;
  const skewness = thirdMoment / (populationVariance ** 1.5);
  const pearsonKurtosis = fourthMoment / (populationVariance ** 2);
  if (!Number.isFinite(skewness) || !Number.isFinite(pearsonKurtosis)) fail(`${path} non-normality moments exceed the finite numeric range`);
  return { skewness, pearsonKurtosis, convention: "uncorrected central moments with denominator n" };
}

// Abramowitz-Stegun 26.2.17; absolute error is approximately below 7.5e-8.
function standardNormalCdf(value) {
  if (value === Infinity) return 1;
  if (value === -Infinity) return 0;
  if (!Number.isFinite(value)) fail("normal CDF input must be finite");
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const polynomial = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const upperTail = Math.exp(-0.5 * absolute * absolute) / Math.sqrt(2 * Math.PI) * polynomial;
  return Math.min(1, Math.max(0, value >= 0 ? 1 - upperTail : upperTail));
}

// Peter J. Acklam's rational approximation to the inverse standard-normal CDF.
function inverseStandardNormal(probability) {
  if (!(probability > 0 && probability < 1)) fail("inverse-normal probability must be strictly between zero and one");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lower = 0.02425;
  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > 1 - lower) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function sharpeProbability(observedSharpe, benchmarkSharpe, observations, skewness, pearsonKurtosis) {
  const varianceFactor = 1 - skewness * observedSharpe + ((pearsonKurtosis - 1) / 4) * (observedSharpe ** 2);
  if (!(varianceFactor > 0) || !Number.isFinite(varianceFactor)) {
    fail("Bailey-Lopez de Prado non-normality variance adjustment must be positive and finite");
  }
  const zScore = (observedSharpe - benchmarkSharpe) * Math.sqrt(observations - 1) / Math.sqrt(varianceFactor);
  if (!Number.isFinite(zScore)) fail("probabilistic Sharpe z-score exceeds the finite numeric range");
  return { varianceFactor, zScore, probability: standardNormalCdf(zScore) };
}

/**
 * Deflated Sharpe evidence for a fixed candidate's paired arithmetic returns
 * versus a benchmark. `cumulativeTrialCount` must include every prior and
 * current strategy trial, while `candidateIds` supplies the observable Sharpe
 * distribution used to estimate the trial-family mean and dispersion.
 */
export function deflatedSharpeAcrossTrials(rows, candidateIds, options = {}) {
  const normalized = strictOptions(
    options,
    new Set(["benchmarkId", "fixedCandidateId", "cumulativeTrialCount", "periodsPerYear"]),
  );
  const { candidates, benchmark, dates, matrix } = pairedMatrix(rows, candidateIds, normalized.benchmarkId, 4);
  if (candidates.length < 2) fail("candidateIds must contain at least 2 candidates for deflated Sharpe evidence");
  const fixedCandidateId = identifier(normalized.fixedCandidateId, "options.fixedCandidateId");
  if (!candidates.includes(fixedCandidateId)) fail("options.fixedCandidateId must name one of candidateIds");
  const cumulativeTrialCount = integerInRange(
    normalized.cumulativeTrialCount,
    "options.cumulativeTrialCount",
    candidates.length,
    1_000_000_000,
  );
  const periodsPerYear = normalized.periodsPerYear === undefined
    ? DEFAULT_PERIODS_PER_YEAR
    : finiteNumber(normalized.periodsPerYear, "options.periodsPerYear");
  if (!(periodsPerYear > 0 && periodsPerYear <= 366)) fail("options.periodsPerYear must be greater than zero and no greater than 366");

  const estimates = matrix.map((values, index) => ({
    id: candidates[index],
    values,
    ...sharpeEstimate(values, `candidate ${candidates[index]}`),
  }));
  const fixed = estimates.find((estimate) => estimate.id === fixedCandidateId);
  const moments = nonNormalMoments(fixed.values, fixed.mean, fixed.standardDeviation, `candidate ${fixedCandidateId}`);
  const trialSharpes = estimates.map((estimate) => estimate.sharpe);
  const trialSharpeMean = mean(trialSharpes);
  const trialSharpeDispersion = sampleStandardDeviation(trialSharpes, trialSharpeMean);
  const expectedMaximumCoefficient = (1 - EULER_MASCHERONI) * inverseStandardNormal(1 - 1 / cumulativeTrialCount)
    + EULER_MASCHERONI * inverseStandardNormal(1 - 1 / (cumulativeTrialCount * Math.E));
  const deflatedBenchmark = trialSharpeMean + trialSharpeDispersion * expectedMaximumCoefficient;
  const probabilistic = sharpeProbability(fixed.sharpe, 0, rows.length, moments.skewness, moments.pearsonKurtosis);
  const deflated = sharpeProbability(fixed.sharpe, deflatedBenchmark, rows.length, moments.skewness, moments.pearsonKurtosis);
  const annualization = Math.sqrt(periodsPerYear);

  return deepFreeze({
    schema_version: "finly_champion_deflated_sharpe.v1",
    method: "Bailey-Lopez de Prado probabilistic and deflated Sharpe ratios on paired candidate-minus-benchmark arithmetic returns",
    claim_boundary: "Model-based fixed-sample falsification evidence only; it neither proves independent trials nor future alpha.",
    fixed_candidate_id: fixedCandidateId,
    benchmark_id: benchmark,
    candidate_ids: [...candidates],
    cumulative_trial_count: cumulativeTrialCount,
    supplied_trial_distribution_size: candidates.length,
    trial_count_boundary: "The declared cumulative count corrects the expected maximum for all disclosed trials; the Sharpe-distribution moments can reflect only the candidate series supplied here.",
    observations: rows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    periods_per_year: round(periodsPerYear),
    paired_return_definition: "candidate daily net_return minus benchmark daily net_return on the identical row",
    observed_candidate: {
      mean_daily_paired_return: round(fixed.mean),
      sample_daily_paired_volatility: round(fixed.standardDeviation),
      sharpe_periodic: round(fixed.sharpe),
      sharpe_annualized: round(fixed.sharpe * annualization),
      skewness: round(moments.skewness),
      pearson_kurtosis: round(moments.pearsonKurtosis),
      moment_convention: moments.convention,
      degenerate_zero_series: fixed.degenerateZeroSeries,
    },
    supplied_candidate_periodic_sharpes: Object.fromEntries(estimates.map((estimate) => [estimate.id, round(estimate.sharpe)])),
    degenerate_zero_paired_candidates: estimates.filter((estimate) => estimate.degenerateZeroSeries).map((estimate) => estimate.id),
    probabilistic_sharpe: {
      benchmark_sharpe_periodic: 0,
      z_score: round(probabilistic.zScore),
      probability_observed_sharpe_exceeds_zero: round(probabilistic.probability),
      non_normality_variance_factor: round(probabilistic.varianceFactor),
    },
    deflated_sharpe: {
      supplied_trial_sharpe_mean_periodic: round(trialSharpeMean),
      supplied_trial_sharpe_sample_standard_deviation_periodic: round(trialSharpeDispersion),
      expected_maximum_coefficient: round(expectedMaximumCoefficient),
      benchmark_sharpe_periodic: round(deflatedBenchmark),
      benchmark_sharpe_annualized: round(deflatedBenchmark * annualization),
      z_score: round(deflated.zScore),
      probability_observed_sharpe_exceeds_deflated_benchmark: round(deflated.probability),
      passes_95_percent_gate: deflated.probability >= 0.95,
    },
  });
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

function sampledBlockIndexes(observations, blockLength, method, random) {
  const indexes = [];
  const possibleMovingStarts = observations - blockLength + 1;
  while (indexes.length < observations) {
    const startCount = method === "circular" ? observations : possibleMovingStarts;
    const start = Math.floor(random() * startCount);
    for (let offset = 0; offset < blockLength && indexes.length < observations; offset += 1) {
      indexes.push(method === "circular" ? (start + offset) % observations : start + offset);
    }
  }
  return indexes;
}

/**
 * Center paired candidate-minus-benchmark returns under a zero-mean null and
 * resample one shared block-index path across all candidates per iteration.
 */
export function pairedBlockBootstrap(rows, candidateIds, options = {}) {
  const normalized = strictOptions(
    options,
    new Set(["benchmarkId", "fixedCandidateId", "method", "iterations", "blockLength", "seed"]),
  );
  const { candidates, benchmark, dates, matrix } = pairedMatrix(rows, candidateIds, normalized.benchmarkId, 2);
  const fixedCandidateId = identifier(normalized.fixedCandidateId, "options.fixedCandidateId");
  if (!candidates.includes(fixedCandidateId)) fail("options.fixedCandidateId must name one of candidateIds");
  if (!new Set(["circular", "moving"]).has(normalized.method)) fail('options.method must be either "circular" or "moving"');
  const iterations = normalized.iterations === undefined
    ? DEFAULT_BOOTSTRAP_ITERATIONS
    : integerInRange(normalized.iterations, "options.iterations", 100, 100_000);
  const blockLength = integerInRange(normalized.blockLength, "options.blockLength", 1, rows.length);
  const seed = integerInRange(normalized.seed, "options.seed", 0, MAX_UINT32);
  const observedMeans = matrix.map((values) => mean(values));
  const observations = rows.length;
  const rootN = Math.sqrt(observations);
  const observedStatistics = observedMeans.map((average) => rootN * average);
  const observedMaximumStatistic = Math.max(...observedStatistics);
  const observedMaximumIndex = observedStatistics.indexOf(observedMaximumStatistic);
  const fixedIndex = candidates.indexOf(fixedCandidateId);
  const observedFixedStatistic = observedStatistics[fixedIndex];
  const centered = matrix.map((values, index) => values.map((value) => value - observedMeans[index]));
  const random = mulberry32(seed);
  const bootstrapMaximums = [];
  const bootstrapFixed = [];
  let familywiseExceedances = 0;
  let fixedFamilywiseExceedances = 0;
  let fixedExceedances = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sampledIndexes = sampledBlockIndexes(observations, blockLength, normalized.method, random);
    const statistics = centered.map((values) => rootN * kahanSum(sampledIndexes.map((index) => values[index])) / observations);
    const maximum = Math.max(...statistics);
    const fixed = statistics[fixedIndex];
    bootstrapMaximums.push(maximum);
    bootstrapFixed.push(fixed);
    if (maximum >= observedMaximumStatistic) familywiseExceedances += 1;
    if (maximum >= observedFixedStatistic) fixedFamilywiseExceedances += 1;
    if (fixed >= observedFixedStatistic) fixedExceedances += 1;
  }
  bootstrapMaximums.sort((left, right) => left - right);
  bootstrapFixed.sort((left, right) => left - right);
  const pValue = (exceedances) => (exceedances + 1) / (iterations + 1);
  const methodLabel = normalized.method === "circular" ? "circular blocks with wraparound" : "moving blocks without wraparound";

  return deepFreeze({
    schema_version: "finly_champion_paired_block_bootstrap.v1",
    method: `White-style centered paired ${normalized.method}-block maximum-statistic bootstrap`,
    block_sampling: `Each iteration applies one identical index path to every candidate; ${methodLabel}.`,
    claim_boundary: "Deterministic resampling evidence under the stated block and centering assumptions, not proof of stationarity, alpha, or future profitability.",
    null_hypothesis: "Every supplied candidate has population mean paired return versus the benchmark less than or equal to zero.",
    candidate_ids: [...candidates],
    fixed_candidate_id: fixedCandidateId,
    benchmark_id: benchmark,
    observations,
    start_date: dates[0],
    end_date: dates.at(-1),
    paired_return_definition: "candidate daily net_return minus benchmark daily net_return on the identical row",
    bootstrap_method: normalized.method,
    iterations,
    block_length_sessions: blockLength,
    seed,
    observed_mean_daily_paired_returns: Object.fromEntries(candidates.map((id, index) => [id, round(observedMeans[index])])),
    observed_statistics: Object.fromEntries(candidates.map((id, index) => [id, round(observedStatistics[index])])),
    observed_maximum_candidate_id: candidates[observedMaximumIndex],
    observed_maximum_statistic: round(observedMaximumStatistic),
    observed_fixed_candidate_statistic: round(observedFixedStatistic),
    familywise_exceedances: familywiseExceedances,
    familywise_p_value: round(pValue(familywiseExceedances)),
    fixed_candidate_familywise_exceedances: fixedFamilywiseExceedances,
    fixed_candidate_familywise_adjusted_p_value: round(pValue(fixedFamilywiseExceedances)),
    fixed_candidate_exceedances: fixedExceedances,
    fixed_candidate_one_sided_p_value: round(pValue(fixedExceedances)),
    passes_fixed_candidate_familywise_5_percent_gate: pValue(fixedFamilywiseExceedances) <= 0.05,
    bootstrap_quantiles: {
      maximum_statistic_p90: round(quantile(bootstrapMaximums, 0.90)),
      maximum_statistic_p95: round(quantile(bootstrapMaximums, 0.95)),
      maximum_statistic_p99: round(quantile(bootstrapMaximums, 0.99)),
      fixed_statistic_p90: round(quantile(bootstrapFixed, 0.90)),
      fixed_statistic_p95: round(quantile(bootstrapFixed, 0.95)),
      fixed_statistic_p99: round(quantile(bootstrapFixed, 0.99)),
    },
  });
}

/** Run the predeclared 5/20/60-session circular and moving-block checks. */
export function pairedBlockBootstrapSuite(rows, candidateIds, options = {}) {
  const normalized = strictOptions(
    options,
    new Set(["benchmarkId", "fixedCandidateId", "iterations", "seeds"]),
  );
  const seeds = normalized.seeds === undefined ? FROZEN_BOOTSTRAP_SEEDS : plainObject(normalized.seeds, "options.seeds");
  const byMethod = {};
  for (const method of ["circular", "moving"]) {
    const methodSeeds = plainObject(seeds[method], `options.seeds.${method}`);
    byMethod[method] = Object.fromEntries(CHAMPION_BLOCK_LENGTHS.map((blockLength) => [String(blockLength), pairedBlockBootstrap(
      rows,
      candidateIds,
      {
        benchmarkId: normalized.benchmarkId,
        fixedCandidateId: normalized.fixedCandidateId,
        method,
        iterations: normalized.iterations,
        blockLength,
        seed: integerInRange(methodSeeds[blockLength], `options.seeds.${method}.${blockLength}`, 0, MAX_UINT32),
      },
    )]));
  }
  const allTests = Object.values(byMethod).flatMap((method) => Object.values(method));
  return deepFreeze({
    schema_version: "finly_champion_paired_block_bootstrap_suite.v1",
    block_lengths_sessions: [...CHAMPION_BLOCK_LENGTHS],
    frozen_seeds: {
      circular: Object.fromEntries(CHAMPION_BLOCK_LENGTHS.map((length) => [String(length), seeds.circular[length]])),
      moving: Object.fromEntries(CHAMPION_BLOCK_LENGTHS.map((length) => [String(length), seeds.moving[length]])),
    },
    evidence: byMethod,
    all_six_fixed_candidate_familywise_p_values_at_most_5_percent: allTests.every(
      (item) => item.passes_fixed_candidate_familywise_5_percent_gate,
    ),
  });
}

function compoundedReturn(values) {
  const logGrowth = kahanSum(values.map((value) => Math.log1p(value)));
  const result = Math.expm1(logGrowth);
  if (!Number.isFinite(result)) fail("compounded return exceeds the finite numeric range");
  return result;
}

/** Summarize complete windows beginning at the first scored row of each year. */
export function annualOriginWindowSummaries(rows, options = {}) {
  const normalized = strictOptions(
    options,
    new Set(["candidateId", "benchmarkId", "horizons", "periodsPerYear"]),
  );
  const candidateId = identifier(normalized.candidateId, "options.candidateId");
  const benchmarkId = identifier(normalized.benchmarkId, "options.benchmarkId");
  if (candidateId === benchmarkId) fail("options.candidateId and options.benchmarkId must differ");
  const horizonValues = normalized.horizons === undefined ? [252, 504, 756] : normalized.horizons;
  if (!Array.isArray(horizonValues) || horizonValues.length === 0) fail("options.horizons must contain at least one session count");
  const checkedHorizons = horizonValues.map((value, index) => integerInRange(value, `options.horizons[${index}]`, 1, 1_000_000));
  if (new Set(checkedHorizons).size !== checkedHorizons.length) fail("options.horizons must not contain duplicates");
  const periodsPerYear = normalized.periodsPerYear === undefined
    ? DEFAULT_PERIODS_PER_YEAR
    : finiteNumber(normalized.periodsPerYear, "options.periodsPerYear");
  if (!(periodsPerYear > 0 && periodsPerYear <= 366)) fail("options.periodsPerYear must be greater than zero and no greater than 366");
  const { dates, matrix } = validatePanelRows(rows, [candidateId, benchmarkId], 2);
  const [candidateReturns, benchmarkReturns] = matrix;
  const firstIndexByYear = new Map();
  dates.forEach((date, index) => {
    const year = date.slice(0, 4);
    if (!firstIndexByYear.has(year)) firstIndexByYear.set(year, index);
  });

  const byHorizon = Object.fromEntries(checkedHorizons.map((sessions) => {
    const windows = [...firstIndexByYear.entries()].filter(([, start]) => start + sessions <= rows.length).map(([year, start]) => {
      const end = start + sessions;
      const candidateSlice = candidateReturns.slice(start, end);
      const benchmarkSlice = benchmarkReturns.slice(start, end);
      const candidateLogGrowth = kahanSum(candidateSlice.map((value) => Math.log1p(value)));
      const benchmarkLogGrowth = kahanSum(benchmarkSlice.map((value) => Math.log1p(value)));
      const candidateAnnualized = candidateLogGrowth * periodsPerYear / sessions;
      const benchmarkAnnualized = benchmarkLogGrowth * periodsPerYear / sessions;
      return {
        origin_year: Number(year),
        start_date: dates[start],
        end_date: dates[end - 1],
        sessions,
        candidate_total_return: round(compoundedReturn(candidateSlice)),
        benchmark_total_return: round(compoundedReturn(benchmarkSlice)),
        total_return_difference: round(compoundedReturn(candidateSlice) - compoundedReturn(benchmarkSlice)),
        candidate_annualized_log_growth: round(candidateAnnualized),
        benchmark_annualized_log_growth: round(benchmarkAnnualized),
        annualized_log_growth_difference: round(candidateAnnualized - benchmarkAnnualized),
        beats_benchmark: candidateLogGrowth > benchmarkLogGrowth,
      };
    });
    const differences = windows.map((window) => window.annualized_log_growth_difference);
    const positiveCount = windows.filter((window) => window.beats_benchmark).length;
    const worst = windows.length === 0 ? null : windows.reduce((left, right) => (
      right.annualized_log_growth_difference < left.annualized_log_growth_difference ? right : left
    ));
    const best = windows.length === 0 ? null : windows.reduce((left, right) => (
      right.annualized_log_growth_difference > left.annualized_log_growth_difference ? right : left
    ));
    return [String(sessions), {
      window_sessions: sessions,
      window_count: windows.length,
      first_origin_year: windows[0]?.origin_year ?? null,
      last_origin_year: windows.at(-1)?.origin_year ?? null,
      median_annualized_log_growth_difference: roundedOrNull(quantile(differences, 0.5)),
      positive_fraction: windows.length === 0 ? null : round(positiveCount / windows.length),
      all_windows_beat_benchmark: windows.length > 0 && positiveCount === windows.length,
      worst_window: worst === null ? null : {
        origin_year: worst.origin_year,
        start_date: worst.start_date,
        end_date: worst.end_date,
        annualized_log_growth_difference: worst.annualized_log_growth_difference,
      },
      best_window: best === null ? null : {
        origin_year: best.origin_year,
        start_date: best.start_date,
        end_date: best.end_date,
        annualized_log_growth_difference: best.annualized_log_growth_difference,
      },
      windows,
    }];
  }));

  return deepFreeze({
    schema_version: "finly_champion_annual_origin_windows.v1",
    candidate_id: candidateId,
    benchmark_id: benchmarkId,
    periods_per_year: round(periodsPerYear),
    origin_definition: "First scored session in each calendar year; incomplete trailing windows are omitted.",
    dependence_boundary: "Annual-origin windows can overlap and are descriptive robustness slices, not independent trials.",
    observations: rows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    horizons: byHorizon,
  });
}

function flattenLeaves(value, path, expectedType, prefix = "") {
  const object = plainObject(value, path);
  const entries = [];
  for (const [key, child] of Object.entries(object)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(key)) fail(`${path} contains invalid key ${key}`);
    const childPath = `${path}.${key}`;
    const outputPath = prefix ? `${prefix}.${key}` : key;
    if (expectedType === "number" && typeof child === "number") {
      entries.push([outputPath, finiteNumber(child, childPath)]);
    } else if (expectedType === "boolean" && typeof child === "boolean") {
      entries.push([outputPath, child]);
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      entries.push(...flattenLeaves(child, childPath, expectedType, outputPath));
    } else {
      fail(`${childPath} must be a ${expectedType} or nested object of ${expectedType} leaves`);
    }
  }
  if (entries.length === 0) fail(`${path} must contain at least one ${expectedType} leaf`);
  return entries;
}

function sameKeys(left, right) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/** Aggregate precomputed metrics and gates across every scheduled rebalance offset. */
export function aggregateScheduleOffsets(records, options = {}) {
  const normalized = strictOptions(options, new Set(["expectedOffsets"]));
  if (!Array.isArray(records) || records.length === 0) fail("records must contain at least one schedule offset");
  const expectedOffsets = normalized.expectedOffsets === undefined
    ? Array.from({ length: 21 }, (_, index) => index)
    : normalized.expectedOffsets;
  if (!Array.isArray(expectedOffsets) || expectedOffsets.length === 0) fail("options.expectedOffsets must contain at least one offset");
  const checkedExpected = expectedOffsets.map((offset, index) => integerInRange(offset, `options.expectedOffsets[${index}]`, 0, 1_000_000));
  if (new Set(checkedExpected).size !== checkedExpected.length) fail("options.expectedOffsets must not contain duplicates");

  const normalizedRecords = records.map((record, index) => {
    const item = plainObject(record, `records[${index}]`);
    const offset = integerInRange(item.offset, `records[${index}].offset`, 0, 1_000_000);
    return {
      offset,
      metrics: Object.fromEntries(flattenLeaves(item.metrics, `records[${index}].metrics`, "number")),
      gates: Object.fromEntries(flattenLeaves(item.gates, `records[${index}].gates`, "boolean")),
    };
  }).sort((left, right) => left.offset - right.offset);
  if (new Set(normalizedRecords.map((record) => record.offset)).size !== normalizedRecords.length) fail("records must not contain duplicate offsets");
  const metricKeys = Object.keys(normalizedRecords[0].metrics).sort();
  const gateKeys = Object.keys(normalizedRecords[0].gates).sort();
  normalizedRecords.forEach((record) => {
    if (!sameKeys(Object.keys(record.metrics).sort(), metricKeys)) fail("every record.metrics object must contain the same numeric leaf paths");
    if (!sameKeys(Object.keys(record.gates).sort(), gateKeys)) fail("every record.gates object must contain the same boolean leaf paths");
  });

  const observedOffsets = normalizedRecords.map((record) => record.offset);
  const expectedSet = new Set(checkedExpected);
  const observedSet = new Set(observedOffsets);
  const missingOffsets = checkedExpected.filter((offset) => !observedSet.has(offset));
  const unexpectedOffsets = observedOffsets.filter((offset) => !expectedSet.has(offset));
  const completeCoverage = missingOffsets.length === 0 && unexpectedOffsets.length === 0;
  const metricSummaries = Object.fromEntries(metricKeys.map((key) => {
    const values = normalizedRecords.map((record) => record.metrics[key]);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    return [key, {
      values_by_offset: Object.fromEntries(normalizedRecords.map((record) => [String(record.offset), round(record.metrics[key])])),
      minimum: round(minimum),
      minimum_offset: normalizedRecords[values.indexOf(minimum)].offset,
      maximum: round(maximum),
      maximum_offset: normalizedRecords[values.indexOf(maximum)].offset,
      mean: round(mean(values)),
      median: round(quantile(values, 0.5)),
      positive_fraction: round(values.filter((value) => value > 0).length / values.length),
      all_offsets_strictly_positive: completeCoverage && values.every((value) => value > 0),
    }];
  }));
  const gateSummaries = Object.fromEntries(gateKeys.map((key) => {
    const passed = normalizedRecords.filter((record) => record.gates[key]).map((record) => record.offset);
    const failed = normalizedRecords.filter((record) => !record.gates[key]).map((record) => record.offset);
    return [key, {
      passed_offsets: passed,
      failed_offsets: failed,
      pass_fraction_observed: round(passed.length / normalizedRecords.length),
      all_expected_offsets_pass: completeCoverage && failed.length === 0,
    }];
  }));

  return deepFreeze({
    schema_version: "finly_champion_schedule_offset_aggregation.v1",
    expected_offsets: [...checkedExpected],
    observed_offsets: observedOffsets,
    complete_offset_coverage: completeCoverage,
    missing_offsets: missingOffsets,
    unexpected_offsets: unexpectedOffsets,
    metric_summaries: metricSummaries,
    gate_summaries: gateSummaries,
    all_metrics_strictly_positive_across_every_expected_offset: completeCoverage
      && Object.values(metricSummaries).every((summary) => summary.all_offsets_strictly_positive),
    all_gates_pass_across_every_expected_offset: completeCoverage
      && Object.values(gateSummaries).every((summary) => summary.all_expected_offsets_pass),
  });
}
