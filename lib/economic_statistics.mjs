const DEFAULT_PERIODS_PER_YEAR = 252;
const DEFAULT_BOOTSTRAP_ITERATIONS = 2_000;
const DEFAULT_BOOTSTRAP_SEED = 20_260_829;
const EULER_MASCHERONI = 0.5772156649015329;
const MAX_UINT32 = 0xffff_ffff;

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value;
}

function strictOptions(value, allowedKeys, path) {
  const options = plainObject(value, path);
  const unexpected = Object.keys(options).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) fail(`${path} contains unsupported fields: ${unexpected.join(", ")}`);
  return options;
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  return value;
}

function integerInRange(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${path} must be a safe integer from ${minimum} through ${maximum}`);
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

function validateCandidateIds(candidateIds, { minimum = 1 } = {}) {
  if (!Array.isArray(candidateIds) || candidateIds.length < minimum) {
    fail(`candidateIds must contain at least ${minimum} candidate${minimum === 1 ? "" : "s"}`);
  }
  const normalized = candidateIds.map((candidateId, index) => {
    if (typeof candidateId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(candidateId)) {
      fail(`candidateIds[${index}] must be a non-empty identifier containing only letters, numbers, dots, underscores, or hyphens`);
    }
    return candidateId;
  });
  if (new Set(normalized).size !== normalized.length) fail("candidateIds must not contain duplicates");
  return normalized;
}

function validateFixedCandidateId(value, candidateIds) {
  if (typeof value !== "string" || !candidateIds.includes(value)) {
    fail("options.fixedCandidateId must name one of candidateIds");
  }
  return value;
}

function validateRows(rows, candidateIds, minimumObservations) {
  if (!Array.isArray(rows) || rows.length < minimumObservations) {
    fail(`rows must contain at least ${minimumObservations} observations`);
  }
  let previousDate = "";
  const matrix = candidateIds.map(() => []);
  const dates = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const rowPath = `rows[${rowIndex}]`;
    const row = plainObject(rows[rowIndex], rowPath);
    if (typeof row.execution_return_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.execution_return_date)) {
      fail(`${rowPath}.execution_return_date must be a YYYY-MM-DD date`);
    }
    const milliseconds = Date.parse(`${row.execution_return_date}T00:00:00.000Z`);
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== row.execution_return_date) {
      fail(`${rowPath}.execution_return_date is not a valid calendar date`);
    }
    if (row.execution_return_date <= previousDate) {
      fail("rows must be strictly chronological by execution_return_date");
    }
    previousDate = row.execution_return_date;
    dates.push(row.execution_return_date);
    const cashReturn = finiteNumber(row.cash_return, `${rowPath}.cash_return`);
    if (cashReturn <= -1) fail(`${rowPath}.cash_return must be greater than -1`);
    const strategies = plainObject(row.strategies, `${rowPath}.strategies`);
    candidateIds.forEach((candidateId, candidateIndex) => {
      const record = plainObject(strategies[candidateId], `${rowPath}.strategies.${candidateId}`);
      const netReturn = finiteNumber(record.net_return, `${rowPath}.strategies.${candidateId}.net_return`);
      if (netReturn <= -1) fail(`${rowPath}.strategies.${candidateId}.net_return must be greater than -1`);
      const excessReturn = netReturn - cashReturn;
      if (!Number.isFinite(excessReturn)) fail(`${rowPath}.${candidateId} BIL-excess return exceeds the finite numeric range`);
      matrix[candidateIndex].push(excessReturn);
    });
  }
  return { dates, matrix };
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
  return kahanSum(values) / values.length;
}

function sampleStandardDeviation(values, average = mean(values)) {
  if (values.length < 2) fail("sample standard deviation requires at least two observations");
  const squaredDeviations = values.map((value) => (value - average) ** 2);
  if (squaredDeviations.some((value) => !Number.isFinite(value))) {
    fail("sample variance exceeds the finite numeric range");
  }
  const variance = kahanSum(squaredDeviations) / (values.length - 1);
  return Math.sqrt(variance);
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
  if (standardDeviation === 0) fail(`${path} has zero variance, so skewness and kurtosis are undefined`);
  const populationVariance = kahanSum(values.map((value) => (value - average) ** 2)) / values.length;
  if (!(populationVariance > 0) || !Number.isFinite(populationVariance)) {
    fail(`${path} population variance must be positive and finite`);
  }
  const thirdMoment = kahanSum(values.map((value) => (value - average) ** 3)) / values.length;
  const fourthMoment = kahanSum(values.map((value) => (value - average) ** 4)) / values.length;
  const skewness = thirdMoment / (populationVariance ** 1.5);
  const pearsonKurtosis = fourthMoment / (populationVariance ** 2);
  if (!Number.isFinite(skewness) || !Number.isFinite(pearsonKurtosis)) {
    fail(`${path} non-normality moments exceed the finite numeric range`);
  }
  return { skewness, pearsonKurtosis };
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
  const probability = value >= 0 ? 1 - upperTail : upperTail;
  return Math.min(1, Math.max(0, probability));
}

// Peter J. Acklam's rational approximation to the inverse standard-normal CDF.
function inverseStandardNormal(probability) {
  if (!(probability > 0 && probability < 1)) fail("inverse-normal probability must be strictly between zero and one");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lower = 0.02425;
  const upper = 1 - lower;
  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function baileyLopezDePradoProbability(observedSharpe, benchmarkSharpe, observations, skewness, pearsonKurtosis) {
  const nonNormalityVarianceFactor = 1
    - skewness * observedSharpe
    + ((pearsonKurtosis - 1) / 4) * (observedSharpe ** 2);
  if (!(nonNormalityVarianceFactor > 0) || !Number.isFinite(nonNormalityVarianceFactor)) {
    fail("Bailey-Lopez de Prado non-normality variance adjustment must be positive and finite");
  }
  const zScore = (observedSharpe - benchmarkSharpe) * Math.sqrt(observations - 1)
    / Math.sqrt(nonNormalityVarianceFactor);
  if (!Number.isFinite(zScore)) fail("probabilistic Sharpe z-score exceeds the finite numeric range");
  return {
    nonNormalityVarianceFactor,
    zScore,
    probability: standardNormalCdf(zScore),
  };
}

/**
 * Evaluate a fixed candidate's daily BIL-excess Sharpe using the
 * Bailey-Lopez de Prado probabilistic and deflated Sharpe formulas.
 *
 * The declared trial count is mandatory. The expected-maximum benchmark uses
 * the cross-candidate mean and sample standard deviation of periodic Sharpes
 * and the independent-trial approximation from the deflated Sharpe ratio.
 */
export function probabilisticDeflatedSharpeEvidence(rows, candidateIds, options = {}) {
  const candidates = validateCandidateIds(candidateIds, { minimum: 2 });
  const normalizedOptions = strictOptions(
    options,
    new Set(["fixedCandidateId", "trialCount", "periodsPerYear"]),
    "options",
  );
  const fixedCandidateId = validateFixedCandidateId(normalizedOptions.fixedCandidateId, candidates);
  const trialCount = integerInRange(normalizedOptions.trialCount, "options.trialCount", candidates.length, 1_000_000_000);
  const periodsPerYear = normalizedOptions.periodsPerYear === undefined
    ? DEFAULT_PERIODS_PER_YEAR
    : finiteNumber(normalizedOptions.periodsPerYear, "options.periodsPerYear");
  if (!(periodsPerYear > 0 && periodsPerYear <= 366)) {
    fail("options.periodsPerYear must be greater than zero and no greater than 366");
  }
  const { dates, matrix } = validateRows(rows, candidates, 4);
  const estimates = matrix.map((values, index) => ({
    id: candidates[index],
    values,
    ...sharpeEstimate(values, `candidate ${candidates[index]}`),
  }));
  const fixed = estimates.find((estimate) => estimate.id === fixedCandidateId);
  const moments = nonNormalMoments(
    fixed.values,
    fixed.mean,
    fixed.standardDeviation,
    `candidate ${fixedCandidateId}`,
  );
  const probabilistic = baileyLopezDePradoProbability(
    fixed.sharpe,
    0,
    rows.length,
    moments.skewness,
    moments.pearsonKurtosis,
  );
  const trialSharpes = estimates.map((estimate) => estimate.sharpe);
  const trialSharpeMean = mean(trialSharpes);
  const trialSharpeSampleStandardDeviation = sampleStandardDeviation(trialSharpes, trialSharpeMean);
  const expectedMaximumCoefficient = (1 - EULER_MASCHERONI) * inverseStandardNormal(1 - 1 / trialCount)
    + EULER_MASCHERONI * inverseStandardNormal(1 - 1 / (trialCount * Math.E));
  const deflatedBenchmarkSharpe = trialSharpeMean
    + trialSharpeSampleStandardDeviation * expectedMaximumCoefficient;
  const deflated = baileyLopezDePradoProbability(
    fixed.sharpe,
    deflatedBenchmarkSharpe,
    rows.length,
    moments.skewness,
    moments.pearsonKurtosis,
  );
  const annualizationScale = Math.sqrt(periodsPerYear);
  return deepFreeze({
    schema_version: "finly_probabilistic_deflated_sharpe_evidence.v1",
    method: "Bailey-Lopez de Prado probabilistic Sharpe ratio and deflated Sharpe ratio",
    claim_boundary: "These fixed-sample probabilities are model-based falsification evidence, not formal proof of alpha, independence, stationarity, or future profitability.",
    reference_formulae: {
      probabilistic_sharpe: "Phi((SR_hat - SR_benchmark) * sqrt(n - 1) / sqrt(1 - skewness * SR_hat + ((Pearson_kurtosis - 1) / 4) * SR_hat^2))",
      deflated_benchmark: "mean_trial_SR + sd_trial_SR * ((1 - EulerGamma) * Phi^-1(1 - 1 / N) + EulerGamma * Phi^-1(1 - 1 / (N * e)))",
    },
    fixed_candidate_id: fixedCandidateId,
    candidate_ids: [...candidates],
    trial_count: trialCount,
    trial_count_requirement: "Declared explicitly by the caller and no smaller than the candidate IDs supplied to this calculation.",
    observations: rows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    periods_per_year: round(periodsPerYear),
    excess_return_definition: "candidate daily net_return minus the same row's adjusted BIL cash_return",
    observed_candidate: {
      mean_daily_bil_excess_return: round(fixed.mean),
      sample_daily_bil_excess_volatility: round(fixed.standardDeviation),
      sharpe_periodic: round(fixed.sharpe),
      sharpe_annualized: round(fixed.sharpe * annualizationScale),
      skewness: round(moments.skewness),
      pearson_kurtosis: round(moments.pearsonKurtosis),
      moment_estimator: "uncorrected central moments with denominator n; kurtosis is Pearson kurtosis, not excess kurtosis",
      non_normality_variance_factor: round(probabilistic.nonNormalityVarianceFactor),
    },
    candidate_periodic_sharpes: Object.fromEntries(estimates.map((estimate) => [estimate.id, round(estimate.sharpe)])),
    degenerate_zero_excess_candidates: estimates.filter((estimate) => estimate.degenerateZeroSeries).map((estimate) => estimate.id),
    probabilistic_sharpe: {
      benchmark_sharpe_periodic: 0,
      benchmark_sharpe_annualized: 0,
      z_score: round(probabilistic.zScore),
      probability_observed_sharpe_exceeds_benchmark: round(probabilistic.probability),
    },
    deflated_sharpe: {
      trial_sharpe_mean_periodic: round(trialSharpeMean),
      trial_sharpe_sample_standard_deviation_periodic: round(trialSharpeSampleStandardDeviation),
      expected_maximum_coefficient: round(expectedMaximumCoefficient),
      benchmark_sharpe_periodic: round(deflatedBenchmarkSharpe),
      benchmark_sharpe_annualized: round(deflatedBenchmarkSharpe * annualizationScale),
      z_score: round(deflated.zScore),
      probability_observed_sharpe_exceeds_deflated_benchmark: round(deflated.probability),
    },
    assumptions: [
      "The probabilistic Sharpe approximation uses IID asymptotics after adjusting its variance for the fixed candidate's return skewness and Pearson kurtosis.",
      "The deflated benchmark treats the declared N trials as independent and estimates their Sharpe mean and dispersion from the supplied candidate IDs; it does not estimate an effective trial count from candidate correlation.",
      "Daily arithmetic BIL-excess returns and 252 periods per year are used unless the caller explicitly supplies another annualization frequency.",
    ],
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

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Center each candidate's BIL-excess returns under a zero-mean null, then use
 * one shared circular-block index sample per iteration. The maximum bootstrap
 * statistic gives a White-style familywise p-value; the fixed series gives a
 * separate, unadjusted one-sided p-value.
 */
export function circularBlockRealityCheckEvidence(rows, candidateIds, options = {}) {
  const candidates = validateCandidateIds(candidateIds);
  const normalizedOptions = strictOptions(
    options,
    new Set(["fixedCandidateId", "iterations", "blockLength", "seed"]),
    "options",
  );
  const fixedCandidateId = validateFixedCandidateId(normalizedOptions.fixedCandidateId, candidates);
  const { dates, matrix } = validateRows(rows, candidates, 2);
  const iterations = normalizedOptions.iterations === undefined
    ? DEFAULT_BOOTSTRAP_ITERATIONS
    : integerInRange(normalizedOptions.iterations, "options.iterations", 100, 100_000);
  const defaultBlockLength = Math.min(20, rows.length);
  const blockLength = normalizedOptions.blockLength === undefined
    ? defaultBlockLength
    : integerInRange(normalizedOptions.blockLength, "options.blockLength", 1, rows.length);
  const seed = normalizedOptions.seed === undefined
    ? DEFAULT_BOOTSTRAP_SEED
    : integerInRange(normalizedOptions.seed, "options.seed", 0, MAX_UINT32);
  const observations = rows.length;
  const rootN = Math.sqrt(observations);
  const observedMeans = matrix.map((values) => mean(values));
  const observedStatistics = observedMeans.map((average) => rootN * average);
  const centered = matrix.map((values, candidateIndex) => values.map((value) => value - observedMeans[candidateIndex]));
  const observedMaximumStatistic = Math.max(...observedStatistics);
  const observedMaximumIndex = observedStatistics.indexOf(observedMaximumStatistic);
  const fixedIndex = candidates.indexOf(fixedCandidateId);
  const observedFixedStatistic = observedStatistics[fixedIndex];
  const random = mulberry32(seed);
  const bootstrapMaximumStatistics = [];
  const bootstrapFixedStatistics = [];
  let familywiseExceedances = 0;
  let fixedExceedances = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sampledIndexes = [];
    while (sampledIndexes.length < observations) {
      const start = Math.floor(random() * observations);
      for (let offset = 0; offset < blockLength && sampledIndexes.length < observations; offset += 1) {
        sampledIndexes.push((start + offset) % observations);
      }
    }
    const bootstrapStatistics = centered.map((values) => {
      const bootstrapMean = kahanSum(sampledIndexes.map((index) => values[index])) / observations;
      return rootN * bootstrapMean;
    });
    const maximumStatistic = Math.max(...bootstrapStatistics);
    const fixedStatistic = bootstrapStatistics[fixedIndex];
    bootstrapMaximumStatistics.push(maximumStatistic);
    bootstrapFixedStatistics.push(fixedStatistic);
    if (maximumStatistic >= observedMaximumStatistic) familywiseExceedances += 1;
    if (fixedStatistic >= observedFixedStatistic) fixedExceedances += 1;
  }
  bootstrapMaximumStatistics.sort((left, right) => left - right);
  bootstrapFixedStatistics.sort((left, right) => left - right);
  return deepFreeze({
    schema_version: "finly_circular_block_reality_check_evidence.v1",
    method: "White-style centered circular-block bootstrap of the maximum BIL-excess sample mean",
    claim_boundary: "This deterministic resampling result is falsification evidence under the stated centering and block assumptions; it is not a formal proof of alpha, stationarity, or future profitability.",
    null_hypothesis: "Every supplied candidate has population mean daily BIL-excess return less than or equal to zero.",
    alternative: "At least one supplied candidate has positive population mean daily BIL-excess return.",
    fixed_candidate_alternative: `Candidate ${fixedCandidateId} has positive population mean daily BIL-excess return.`,
    statistic: "sqrt(n) multiplied by the arithmetic mean daily BIL-excess return; the familywise statistic is the maximum across candidates",
    centering: "Each candidate series is demeaned separately before bootstrap sampling to impose a zero-mean null.",
    block_sampling: "Every iteration draws circular blocks of row indexes and applies the identical sampled index path to all candidate series, preserving contemporaneous cross-candidate dependence within sampled blocks.",
    p_value_estimator: "(1 + bootstrap exceedances) / (iterations + 1); one-sided, with equality counted as an exceedance",
    candidate_ids: [...candidates],
    fixed_candidate_id: fixedCandidateId,
    observations,
    start_date: dates[0],
    end_date: dates.at(-1),
    excess_return_definition: "candidate daily net_return minus the same row's adjusted BIL cash_return",
    iterations,
    block_length_sessions: blockLength,
    seed,
    observed_mean_daily_bil_excess_returns: Object.fromEntries(candidates.map((id, index) => [id, round(observedMeans[index])])),
    observed_statistics: Object.fromEntries(candidates.map((id, index) => [id, round(observedStatistics[index])])),
    observed_maximum_candidate_id: candidates[observedMaximumIndex],
    observed_maximum_statistic: round(observedMaximumStatistic),
    observed_fixed_candidate_statistic: round(observedFixedStatistic),
    familywise_exceedances: familywiseExceedances,
    familywise_p_value: round((familywiseExceedances + 1) / (iterations + 1)),
    fixed_candidate_exceedances: fixedExceedances,
    fixed_candidate_one_sided_p_value: round((fixedExceedances + 1) / (iterations + 1)),
    bootstrap_quantiles: {
      maximum_statistic_p90: round(quantile(bootstrapMaximumStatistics, 0.90)),
      maximum_statistic_p95: round(quantile(bootstrapMaximumStatistics, 0.95)),
      maximum_statistic_p99: round(quantile(bootstrapMaximumStatistics, 0.99)),
      fixed_statistic_p90: round(quantile(bootstrapFixedStatistics, 0.90)),
      fixed_statistic_p95: round(quantile(bootstrapFixedStatistics, 0.95)),
      fixed_statistic_p99: round(quantile(bootstrapFixedStatistics, 0.99)),
    },
    assumptions: [
      "Circular blocks approximate serial dependence only up to the caller-selected block length.",
      "The same sampled blocks across candidates preserve their observed contemporaneous and within-block dependence rather than treating strategy trials as independent.",
      "The familywise p-value addresses the supplied candidate family only; omitted or undisclosed trials are not corrected.",
    ],
  });
}

export function buildEconomicStatisticalEvidence(rows, candidateIds, options = {}) {
  const normalizedOptions = strictOptions(
    options,
    new Set(["fixedCandidateId", "trialCount", "periodsPerYear", "iterations", "blockLength", "seed"]),
    "options",
  );
  const fixedCandidateId = normalizedOptions.fixedCandidateId;
  return deepFreeze({
    schema_version: "finly_economic_statistical_evidence.v1",
    probabilistic_deflated_sharpe: probabilisticDeflatedSharpeEvidence(rows, candidateIds, {
      fixedCandidateId,
      trialCount: normalizedOptions.trialCount,
      periodsPerYear: normalizedOptions.periodsPerYear,
    }),
    circular_block_reality_check: circularBlockRealityCheckEvidence(rows, candidateIds, {
      fixedCandidateId,
      iterations: normalizedOptions.iterations,
      blockLength: normalizedOptions.blockLength,
      seed: normalizedOptions.seed,
    }),
  });
}
