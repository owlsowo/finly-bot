import { createHash } from "node:crypto";

import { sha256, stableStringify } from "../../lib/canonical.mjs";
import { inverseNormal, normalCdf } from "../../lib/quant.mjs";
import {
  EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY,
  EXTERNAL_ATTEMPT115_EVALUATION_ID,
  EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
  EXTERNAL_ATTEMPT115_OVERLAP_START,
  EXTERNAL_ATTEMPT115_PRIMARY_END,
  validateExternalAttempt115Protocol,
} from "./protocol.mjs";
import {
  EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA,
  extractExternalAttempt115ArchiveMember,
  validateExternalAttempt115AcquisitionReceipt,
} from "./acquisition.mjs";
import {
  EXTERNAL_ATTEMPT115_CADENCE_ANCHORS,
  EXTERNAL_ATTEMPT115_COST_BPS,
  EXTERNAL_ATTEMPT115_PRIMARY_ANCHOR,
  EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS,
  EXTERNAL_ATTEMPT115_PRIMARY_PARTITION_ID,
  EXTERNAL_ATTEMPT115_OVERLAP_PARTITION_ID,
  EXTERNAL_ATTEMPT115_REPLAY_GRID_SCHEMA,
  EXTERNAL_ATTEMPT115_REPLAY_SCHEMA,
  replayExternalAttempt115Cell,
  replayExternalAttempt115Grid,
} from "./replay.mjs";
import {
  KENNETH_FRENCH_DAILY_PROXY_LABELS,
  canonicalizeKennethFrenchDailyFactorZipMember,
  parseKennethFrenchDailyFactorCsv,
} from "./kenneth_french_daily_factor_adapter.mjs";
import {
  EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD,
  EXTERNAL_ATTEMPT115_INFERENCE_SCHEMA,
  runExternalAttempt115StationaryBootstrap,
} from "./inference.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
} from "../prospective_attempt115/policy.mjs";

export const EXTERNAL_ATTEMPT115_EVALUATION_SCHEMA =
  "finly_attempt115_external_mechanism_evaluation.v1";

export const EXTERNAL_ATTEMPT115_GATE_NAMES = Object.freeze([
  "primary_direction",
  "statistical_evidence",
  "absolute_and_rf_proxy_performance",
  "cost_stress",
  "cadence_robustness",
  "complete_decades",
  "drawdown_guardrail",
  "volatility_guardrail",
  "integrity",
]);

export const EXTERNAL_ATTEMPT115_INTEGRITY_CHECK_NAMES = Object.freeze([
  "protocol_self_hash",
  "artifact_hash_binding",
  "official_source_identity_and_receipt",
  "strict_parser_schema_and_row_order",
  "source_transform_identity",
  "warmup_signal_rebalance_outcome_chronology",
  "future_observation_mutation_invariance",
  "cost_monotonicity_and_exact_entry_cost",
  "exact_terminal_liquidation",
]);

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const EULER_MASCHERONI = 0.5772156649015329;
const MARKET = "MARKET_PROXY";
const RF = "RF_PROXY";
const INCUMBENT = ATTEMPT115_INCUMBENT_POLICY_ID;
const CHALLENGER = ATTEMPT115_CHALLENGER_POLICY_ID;
const EXPECTED_COMPLETE_DECADE_START_YEARS = Object.freeze([
  1930, 1940, 1950, 1960, 1970, 1980, 1990,
]);
const COMPLETE_DECADE_DEFINITION = "UTC calendar years YYYY0 through YYYY9 inclusive";
const COMPLETE_DECADE_ELIGIBILITY_RULE =
  "the primary partition starts on or before YYYY0-01-01, ends on or after YYYY9-12-31, and contains at least one outcome observation in each of the ten calendar years";
const DECADE_EDGE_FORMULA =
  "sum of challenger-minus-incumbent paired daily net log-return differences whose outcome_observation_date falls within the calendar decade";
const GATE_CHECK_NAMES = Object.freeze({
  primary_direction: Object.freeze(["primary_mean_strictly_positive"]),
  statistical_evidence: Object.freeze([
    "nominal_p_value_at_most_0_05",
    "bonferroni_raw_p_value_at_most_frozen_threshold",
    "deflated_sharpe_probability_at_least_0_95",
  ]),
  absolute_and_rf_proxy_performance: Object.freeze([
    "incumbent_positive_net_log_growth",
    "challenger_positive_net_log_growth",
    "incumbent_beats_rf_proxy",
    "challenger_beats_rf_proxy",
  ]),
  cost_stress: Object.freeze(["edge_positive_at_5_bps", "edge_positive_at_10_bps"]),
  cadence_robustness: Object.freeze([
    "anchor_zero_positive",
    "at_least_four_of_five_anchors_positive",
  ]),
  complete_decades: Object.freeze([
    "exact_expected_seven_complete_decades",
    "minimum_seven_complete_decades",
    "median_complete_decade_edge_strictly_positive",
    "positive_complete_decade_share_at_least_0_60",
  ]),
  drawdown_guardrail: Object.freeze(["challenger_drawdown_no_more_than_0_05_worse"]),
  volatility_guardrail: Object.freeze([
    "challenger_volatility_at_most_1_10_times_incumbent",
  ]),
  integrity: EXTERNAL_ATTEMPT115_INTEGRITY_CHECK_NAMES,
});

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be finite`);
  }
  return value;
}

function isoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${label} must be an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be an ISO date`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be a sha256 digest`);
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function rawSha256(value, label) {
  let bytes;
  if (typeof value === "string") bytes = new TextEncoder().encode(value);
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    fail(`${label} must be supplied as bytes or a string`);
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactBytes(value, label) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ));
  }
  fail(`${label} must be supplied as bytes`);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function sampleStandardDeviation(values, average) {
  return Math.sqrt(values.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0,
  ) / (values.length - 1));
}

function derivedPortfolioMetrics(rows, label) {
  let wealth = 1;
  let peak = 1;
  let maximumDrawdown = 0;
  const returns = rows.map((row, index) => {
    const netReturn = finite(row?.net_return, `${label} row ${index + 1} net_return`);
    const netLogReturn = finite(
      row?.net_log_return,
      `${label} row ${index + 1} net_log_return`,
    );
    if (netReturn <= -1 || netLogReturn !== Math.log1p(netReturn)) {
      fail(`${label} row ${index + 1} net return identity changed`);
    }
    wealth *= 1 + netReturn;
    peak = Math.max(peak, wealth);
    maximumDrawdown = Math.min(maximumDrawdown, wealth / peak - 1);
    return netReturn;
  });
  const average = mean(returns);
  return {
    netLogGrowth: rows.reduce((sum, row) => sum + row.net_log_return, 0),
    annualizedVolatility: sampleStandardDeviation(returns, average) * Math.sqrt(252),
    maximumDrawdown,
  };
}

function validateFullPartitionMetrics(partition, label) {
  const derived = {};
  for (const policyId of [INCUMBENT, CHALLENGER]) {
    const policy = plainObject(partition.policies?.[policyId], `${label} ${policyId}`);
    if (!Array.isArray(policy.rows) || policy.rows.length !== partition.observations) {
      fail(`${label} ${policyId} rows do not match partition observations`);
    }
    const calculated = derivedPortfolioMetrics(policy.rows, `${label} ${policyId}`);
    if (policy.metrics?.net_log_growth !== calculated.netLogGrowth
      || policy.metrics?.annualized_volatility !== calculated.annualizedVolatility
      || policy.metrics?.maximum_drawdown !== calculated.maximumDrawdown) {
      fail(`${label} ${policyId} metrics are not reproduced from rows`);
    }
    derived[policyId] = calculated;
  }
  partition.paired_daily_net_log_returns.forEach((paired, index) => {
    const incumbentLog = partition.policies[INCUMBENT].rows[index].net_log_return;
    const challengerLog = partition.policies[CHALLENGER].rows[index].net_log_return;
    if (paired.incumbent_net_log_return !== incumbentLog
      || paired.challenger_net_log_return !== challengerLog
      || paired.challenger_minus_incumbent_net_log_return
        !== challengerLog - incumbentLog) {
      fail(`${label} paired endpoint is not reproduced from policy rows`);
    }
  });
  return derived;
}

/** The exact frozen DSR convention for the sole paired primary series. */
export function externalAttempt115DeflatedSharpe(dailyValues) {
  if (!Array.isArray(dailyValues) || dailyValues.length < 2) {
    fail("external Attempt115 DSR requires at least two paired daily values");
  }
  dailyValues.forEach((value, index) => finite(
    value,
    `external Attempt115 DSR value ${index + 1}`,
  ));
  const observations = dailyValues.length;
  const average = mean(dailyValues);
  const sampleDeviation = sampleStandardDeviation(dailyValues, average);
  const populationVariance = dailyValues.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0,
  ) / observations;
  const constantSeries = dailyValues.every((value) => value === dailyValues[0]);
  if (constantSeries || !(sampleDeviation > 0) || !(populationVariance > 0)
    || !Number.isFinite(sampleDeviation) || !Number.isFinite(populationVariance)) {
    return deepFreeze({
      observations,
      sample_mean: average,
      sample_standard_deviation: sampleDeviation,
      observed_periodic_sharpe: null,
      uncorrected_skewness: null,
      pearson_kurtosis: null,
      global_registered_attempt_count: EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
      expected_maximum_coefficient: null,
      deflated_benchmark_sharpe_periodic: null,
      non_normality_variance_factor: null,
      z_score: null,
      probability: null,
      passes_gate: false,
      disposition: "GATE_FAILS_CLOSED",
    });
  }
  const thirdMoment = dailyValues.reduce(
    (sum, value) => sum + ((value - average) ** 3),
    0,
  ) / observations;
  const fourthMoment = dailyValues.reduce(
    (sum, value) => sum + ((value - average) ** 4),
    0,
  ) / observations;
  const observedSharpe = average / sampleDeviation;
  const skewness = thirdMoment / (populationVariance ** 1.5);
  const pearsonKurtosis = fourthMoment / (populationVariance ** 2);
  const expectedMaximumCoefficient = (1 - EULER_MASCHERONI)
    * inverseNormal(1 - 1 / EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT)
    + EULER_MASCHERONI
      * inverseNormal(1 - 1 / (EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT * Math.E));
  const benchmarkSharpe = expectedMaximumCoefficient / Math.sqrt(observations - 1);
  const varianceFactor = 1 - skewness * observedSharpe
    + ((pearsonKurtosis - 1) / 4) * (observedSharpe ** 2);
  const zScore = varianceFactor > 0 && Number.isFinite(varianceFactor)
    ? (observedSharpe - benchmarkSharpe) * Math.sqrt(observations - 1)
      / Math.sqrt(varianceFactor)
    : null;
  const probability = zScore !== null && Number.isFinite(zScore)
    ? normalCdf(zScore)
    : null;
  const valid = [average, sampleDeviation, observedSharpe, skewness, pearsonKurtosis,
    expectedMaximumCoefficient, benchmarkSharpe, varianceFactor, zScore, probability]
    .every((value) => typeof value === "number" && Number.isFinite(value))
    && varianceFactor > 0 && probability >= 0 && probability <= 1;
  return deepFreeze({
    observations,
    sample_mean: average,
    sample_standard_deviation: sampleDeviation,
    observed_periodic_sharpe: valid ? observedSharpe : null,
    uncorrected_skewness: valid ? skewness : null,
    pearson_kurtosis: valid ? pearsonKurtosis : null,
    global_registered_attempt_count: EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
    expected_maximum_coefficient: valid ? expectedMaximumCoefficient : null,
    deflated_benchmark_sharpe_periodic: valid ? benchmarkSharpe : null,
    non_normality_variance_factor: valid ? varianceFactor : null,
    z_score: valid ? zScore : null,
    probability: valid ? probability : null,
    passes_gate: valid && probability >= 0.95,
    disposition: valid ? "FINITE" : "GATE_FAILS_CLOSED",
  });
}

function validatePartitionSummary(partition, expectedId, label) {
  plainObject(partition, label);
  if (partition.partition_id !== expectedId) fail(`${label} partition id changed`);
  if (!Number.isSafeInteger(partition.observations) || partition.observations < 1) {
    fail(`${label} observations must be positive`);
  }
  const start = isoDate(partition.start_date, `${label} start_date`);
  const end = isoDate(partition.end_date, `${label} end_date`);
  if (start > end) fail(`${label} date range is reversed`);
  digest(partition.outcome_observation_dates_sha256, `${label} dates hash`);
  const policies = partition.policy_metrics ?? Object.fromEntries(
    [INCUMBENT, CHALLENGER].map((id) => [id, partition.policies?.[id]?.metrics]),
  );
  for (const policyId of [INCUMBENT, CHALLENGER]) {
    const metrics = plainObject(policies?.[policyId], `${label} ${policyId} metrics`);
    for (const key of ["net_log_growth", "annualized_volatility", "maximum_drawdown"]) {
      finite(metrics[key], `${label} ${policyId} ${key}`);
    }
    if (metrics.annualized_volatility < 0
      || metrics.maximum_drawdown < -1 || metrics.maximum_drawdown > 0) {
      fail(`${label} ${policyId} risk metrics are invalid`);
    }
  }
  const benchmark = plainObject(partition.benchmarks?.[RF], `${label} RF benchmark`);
  finite(benchmark.net_log_growth, `${label} RF net_log_growth`);
  const pairedMean = partition.paired_mean_daily_net_log_return_difference
    ?? mean(partition.paired_daily_net_log_return_differences ?? []);
  finite(pairedMean, `${label} paired mean`);
  const netLogDifference = policies[CHALLENGER].net_log_growth
    - policies[INCUMBENT].net_log_growth;
  if (partition.paired_mean_daily_net_log_return_difference !== undefined
    && (partition.challenger_minus_incumbent?.net_log_growth !== netLogDifference
      || Math.abs(pairedMean - netLogDifference / partition.observations) > 1e-14)) {
    fail(`${label} paired mean is not reproduced from policy net-log growth`);
  }
  return { policies, rf: benchmark, pairedMean };
}

function validateReplayGrid(grid) {
  plainObject(grid, "external Attempt115 replay grid");
  if (grid.schema_version !== EXTERNAL_ATTEMPT115_REPLAY_GRID_SCHEMA
    || grid.claim_boundary
      !== "External factor-proxy mechanism replay only; it is not ETF execution evidence, future-alpha evidence, or live-profitability evidence."
    || grid.grid_sha256 !== sha256(withoutKey(grid, "grid_sha256"))) {
    fail("external Attempt115 replay-grid identity or self-hash changed");
  }
  const primaryCell = plainObject(grid.primary_cell, "external Attempt115 primary replay cell");
  if (primaryCell.schema_version !== EXTERNAL_ATTEMPT115_REPLAY_SCHEMA
    || primaryCell.replay_sha256 !== sha256(withoutKey(primaryCell, "replay_sha256"))
    || primaryCell.execution_model?.rebalance_anchor !== EXTERNAL_ATTEMPT115_PRIMARY_ANCHOR
    || primaryCell.execution_model?.one_way_cost_bps !== EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS
    || primaryCell.partition_rule?.primary_outcome_observation_date_on_or_before
      !== EXTERNAL_ATTEMPT115_PRIMARY_END
    || primaryCell.source_proxy_labels?.[MARKET]
      !== KENNETH_FRENCH_DAILY_PROXY_LABELS[MARKET]
    || primaryCell.source_proxy_labels?.[RF]
      !== KENNETH_FRENCH_DAILY_PROXY_LABELS[RF]) {
    fail("external Attempt115 primary replay semantics or self-hash changed");
  }
  const primary = primaryCell.partitions?.primary_pre_overlap;
  const overlap = primaryCell.partitions?.overlap_diagnostic_only;
  validatePartitionSummary(primary, EXTERNAL_ATTEMPT115_PRIMARY_PARTITION_ID, "primary replay");
  validatePartitionSummary(overlap, EXTERNAL_ATTEMPT115_OVERLAP_PARTITION_ID, "overlap replay");
  validateFullPartitionMetrics(primary, "primary replay");
  validateFullPartitionMetrics(overlap, "overlap replay");
  if (primary.end_date !== EXTERNAL_ATTEMPT115_PRIMARY_END
    || overlap.start_date !== EXTERNAL_ATTEMPT115_OVERLAP_START
    || primary.end_date >= overlap.start_date) {
    fail("external Attempt115 primary-to-overlap boundary changed");
  }
  if (!Array.isArray(primary.paired_daily_net_log_return_differences)
    || primary.paired_daily_net_log_return_differences.length !== primary.observations
    || !Array.isArray(primary.paired_daily_net_log_returns)
    || primary.paired_daily_net_log_returns.length !== primary.observations) {
    fail("external Attempt115 primary paired endpoint is incomplete");
  }
  let priorDate = "";
  primary.paired_daily_net_log_returns.forEach((row, index) => {
    const date = isoDate(row?.outcome_observation_date, `primary paired row ${index + 1} date`);
    const value = finite(
      row?.challenger_minus_incumbent_net_log_return,
      `primary paired row ${index + 1} value`,
    );
    if (date <= priorDate || date > EXTERNAL_ATTEMPT115_PRIMARY_END
      || value !== primary.paired_daily_net_log_return_differences[index]) {
      fail("external Attempt115 primary paired endpoint alignment changed");
    }
    priorDate = date;
  });
  if (primary.start_date !== primary.paired_daily_net_log_returns[0].outcome_observation_date
    || primary.end_date !== primary.paired_daily_net_log_returns.at(-1).outcome_observation_date) {
    fail("external Attempt115 primary paired endpoint date range changed");
  }
  if (!Array.isArray(grid.sensitivity_cells) || grid.sensitivity_cells.length !== 20) {
    fail("external Attempt115 replay grid must contain exactly 20 sensitivity cells");
  }
  const cells = new Map();
  grid.sensitivity_cells.forEach((cell, index) => {
    plainObject(cell, `external Attempt115 sensitivity cell ${index + 1}`);
    if (cell.schema_version !== EXTERNAL_ATTEMPT115_REPLAY_SCHEMA) {
      fail("external Attempt115 sensitivity replay schema changed");
    }
    digest(cell.replay_sha256, `external Attempt115 sensitivity cell ${index + 1} hash`);
    const anchor = cell.rebalance_anchor;
    const cost = cell.one_way_cost_bps;
    if (!EXTERNAL_ATTEMPT115_CADENCE_ANCHORS.includes(anchor)
      || !EXTERNAL_ATTEMPT115_COST_BPS.includes(cost)) {
      fail("external Attempt115 sensitivity cost or anchor changed");
    }
    const key = `${anchor}:${cost}`;
    if (cells.has(key)) fail("external Attempt115 sensitivity grid contains a duplicate cell");
    const cellPrimary = cell.primary_pre_overlap;
    const cellOverlap = cell.overlap_diagnostic_only;
    validatePartitionSummary(cellPrimary, EXTERNAL_ATTEMPT115_PRIMARY_PARTITION_ID, `${key} primary`);
    validatePartitionSummary(cellOverlap, EXTERNAL_ATTEMPT115_OVERLAP_PARTITION_ID, `${key} overlap`);
    if (cellPrimary.start_date !== primary.start_date
      || cellPrimary.end_date !== EXTERNAL_ATTEMPT115_PRIMARY_END
      || cellPrimary.observations !== primary.observations
      || cellPrimary.outcome_observation_dates_sha256
        !== primary.outcome_observation_dates_sha256
      || cellOverlap.start_date !== EXTERNAL_ATTEMPT115_OVERLAP_START
      || cellOverlap.outcome_observation_dates_sha256
        !== overlap.outcome_observation_dates_sha256) {
      fail("external Attempt115 sensitivity partitions are not date-identical");
    }
    cells.set(key, cell);
  });
  for (const anchor of EXTERNAL_ATTEMPT115_CADENCE_ANCHORS) {
    for (const cost of EXTERNAL_ATTEMPT115_COST_BPS) {
      if (!cells.has(`${anchor}:${cost}`)) fail("external Attempt115 sensitivity grid is incomplete");
    }
  }
  const primarySummary = cells.get("0:5");
  if (primarySummary.replay_sha256 !== primaryCell.replay_sha256) {
    fail("external Attempt115 primary replay is not bound to its grid summary");
  }
  const primaryMean = mean(primary.paired_daily_net_log_return_differences);
  if (primarySummary.primary_pre_overlap.paired_mean_daily_net_log_return_difference
      !== primaryMean
    || stableStringify(primarySummary.primary_pre_overlap.policy_metrics)
      !== stableStringify(Object.fromEntries([INCUMBENT, CHALLENGER].map((id) => [
        id,
        primary.policies[id].metrics,
      ])))
    || stableStringify(primarySummary.primary_pre_overlap.benchmarks)
      !== stableStringify(primary.benchmarks)) {
    fail("external Attempt115 primary replay metrics differ from its grid summary");
  }
  return { primaryCell, primary, overlap, cells };
}

function artifactBindingVerified(value, protocol) {
  exactKeys(value, ["source_files", "test_files"], "external Attempt115 artifact bytes");
  const groups = [
    ["source_files", protocol.artifact_binding.source_files_sha256],
    ["test_files", protocol.artifact_binding.test_files_sha256],
  ];
  let verified = true;
  for (const [group, expected] of groups) {
    exactKeys(value[group], Object.keys(expected), `external Attempt115 ${group} bytes`);
    for (const [path, expectedDigest] of Object.entries(expected)) {
      verified = rawSha256(value[group][path], `${group}.${path}`) === expectedDigest && verified;
    }
  }
  return verified;
}

function replayIntegrityChecks(replay) {
  let chronology = replay.primaryCell.timing?.warmup_observations === 253
    && replay.primaryCell.timing?.first_signal_observation === 253
    && replay.primaryCell.timing?.first_execution_observation === 254
    && replay.primaryCell.timing?.first_scored_observation === 255;
  let exactEntryCost = true;
  let exactTerminal = true;
  for (const partition of [replay.primary, replay.overlap]) {
    for (const policyId of [INCUMBENT, CHALLENGER]) {
      const rows = partition.policies?.[policyId]?.rows;
      if (!Array.isArray(rows) || rows.length !== partition.observations) {
        chronology = false;
        exactEntryCost = false;
        exactTerminal = false;
        continue;
      }
      rows.forEach((row, index) => {
        if (row?.outcome_observation_date
            !== partition.paired_daily_net_log_returns?.[index]?.outcome_observation_date) {
          chronology = false;
        }
      });
      const first = rows[0];
      const last = rows.at(-1);
      const entryTurnover = Math.abs(first?.start_weights?.[MARKET] ?? Number.NaN)
        + Math.abs((first?.start_weights?.[RF] ?? Number.NaN) - 1);
      exactEntryCost = exactEntryCost
        && first?.standalone_entry === true
        && first?.entry_absolute_leg_turnover === entryTurnover
        && first?.transaction_cost_fraction
          === entryTurnover * replay.primaryCell.execution_model.one_way_cost_bps / 10_000;
      const terminalTurnover = Math.abs(last?.end_weights?.[MARKET] ?? Number.NaN)
        + Math.abs((last?.end_weights?.[RF] ?? Number.NaN) - 1);
      exactTerminal = exactTerminal
        && last?.standalone_terminal_liquidation === true
        && last?.terminal_liquidation_absolute_leg_turnover === terminalTurnover
        && last?.terminal_liquidation_cost_fraction
          === terminalTurnover * replay.primaryCell.execution_model.one_way_cost_bps / 10_000;
    }
  }
  let costMonotonic = true;
  for (const anchor of EXTERNAL_ATTEMPT115_CADENCE_ANCHORS) {
    for (const policyId of [INCUMBENT, CHALLENGER]) {
      const values = EXTERNAL_ATTEMPT115_COST_BPS.map((cost) => (
        replay.cells.get(`${anchor}:${cost}`).primary_pre_overlap
          .policy_metrics[policyId].net_log_growth
      ));
      if (values.some((value, index) => index > 0 && value > values[index - 1] + 1e-15)) {
        costMonotonic = false;
      }
    }
  }
  return {
    chronology,
    costAndEntry: costMonotonic && exactEntryCost,
    terminal: exactTerminal,
  };
}

async function replayFromReceiptBoundArchive(sourceBytes, receipt) {
  exactKeys(sourceBytes, ["archive"], "external Attempt115 source bytes");
  const archive = exactBytes(sourceBytes.archive, "external Attempt115 archive");
  if (archive.byteLength !== receipt.archive_raw_byte_count
    || rawSha256(archive, "external Attempt115 archive") !== receipt.archive_raw_bytes_sha256) {
    fail("external Attempt115 archive bytes do not match the acquisition receipt");
  }
  const member = await extractExternalAttempt115ArchiveMember(archive);
  if (member.byteLength !== receipt.selected_member_raw_byte_count
    || rawSha256(member, "external Attempt115 member")
      !== receipt.selected_member_raw_bytes_sha256) {
    fail("external Attempt115 extracted member does not match the acquisition receipt");
  }
  const canonicalText = canonicalizeKennethFrenchDailyFactorZipMember(member);
  const canonicalBytes = new TextEncoder().encode(canonicalText);
  if (canonicalBytes.byteLength !== receipt.canonical_member_byte_count
    || rawSha256(canonicalBytes, "external Attempt115 canonical member")
      !== receipt.canonical_member_sha256) {
    fail("external Attempt115 canonical member does not match the acquisition receipt");
  }
  const parsed = parseKennethFrenchDailyFactorCsv(canonicalBytes);
  if (parsed.rows.length !== receipt.parsed_valid_row_count
    || parsed.rows[0]?.date !== receipt.parsed_first_date
    || parsed.rows.at(-1)?.date !== receipt.parsed_last_date) {
    fail("external Attempt115 strict parse does not match the acquisition receipt");
  }
  const replayGrid = replayExternalAttempt115Grid(parsed);

  const mutated = structuredClone(parsed);
  const mutationIndex = 253;
  mutated.rows[mutationIndex]["Mkt-RF"] += 0.01;
  mutated.rows[mutationIndex].MARKET_PROXY = (
    mutated.rows[mutationIndex]["Mkt-RF"] + mutated.rows[mutationIndex].RF
  ) / 100;
  const mutatedCell = replayExternalAttempt115Cell(mutated);
  const baselineCell = replayGrid.primary_cell;
  const invariant = [INCUMBENT, CHALLENGER].every((policyId) => (
    stableStringify(
      baselineCell.partitions.primary_pre_overlap.policies[policyId].rows[0].start_weights,
    ) === stableStringify(
      mutatedCell.partitions.primary_pre_overlap.policies[policyId].rows[0].start_weights,
    )
  ));
  return { replayGrid, futureMutationInvariant: invariant };
}

function completeDecadeEvidence(rows) {
  const byDecade = new Map();
  for (const row of rows) {
    const year = Number(row.outcome_observation_date.slice(0, 4));
    const decade = Math.floor(year / 10) * 10;
    if (!byDecade.has(decade)) byDecade.set(decade, { years: new Set(), values: [] });
    byDecade.get(decade).years.add(year);
    byDecade.get(decade).values.push(row.challenger_minus_incumbent_net_log_return);
  }
  const firstDate = rows[0].outcome_observation_date;
  const lastDate = rows.at(-1).outcome_observation_date;
  const complete = [...byDecade.entries()]
    .filter(([decade, group]) => group.years.size === 10
      && firstDate <= `${decade}-01-01`
      && lastDate >= `${decade + 9}-12-31`)
    .sort(([left], [right]) => left - right)
    .map(([decade, group]) => ({
      decade: `${decade}s`,
      observations: group.values.length,
      challenger_minus_incumbent_net_log_growth: group.values.reduce(
        (sum, value) => sum + value,
        0,
      ),
    }));
  const completeStartYears = complete.map((item) => Number(item.decade.slice(0, 4)));
  const fixed = {
    calendar_decade_definition: COMPLETE_DECADE_DEFINITION,
    complete_decade_eligibility_rule: COMPLETE_DECADE_ELIGIBILITY_RULE,
    expected_complete_decade_start_years: [...EXPECTED_COMPLETE_DECADE_START_YEARS],
    minimum_complete_decade_count: 7,
    decade_edge_formula: DECADE_EDGE_FORMULA,
    zero_edge_counts_as_positive: false,
    eligible_complete_decade_start_years: completeStartYears,
  };
  if (complete.length === 0) {
    return {
      ...fixed,
      complete_decades: [],
      positive_complete_decade_count: 0,
      median_edge: null,
      positive_share: null,
    };
  }
  const edges = complete.map((item) => item.challenger_minus_incumbent_net_log_growth);
  const positiveCount = edges.filter((value) => value > 0).length;
  return {
    ...fixed,
    complete_decades: complete,
    positive_complete_decade_count: positiveCount,
    median_edge: median(edges),
    positive_share: positiveCount / edges.length,
  };
}

function gate(name, checks, measurements) {
  const passed = Object.values(checks).every((value) => value === true);
  return deepFreeze({ name, passed, checks, measurements });
}

function mechanismGates(replay, integrity) {
  const primaryValues = replay.primary.paired_daily_net_log_return_differences;
  const inference = runExternalAttempt115StationaryBootstrap(primaryValues);
  const dsr = externalAttempt115DeflatedSharpe(primaryValues);
  const primary = replay.cells.get("0:5").primary_pre_overlap;
  const incumbent = primary.policy_metrics[INCUMBENT];
  const challenger = primary.policy_metrics[CHALLENGER];
  const rf = primary.benchmarks[RF];
  const costEdges = Object.fromEntries([5, 10].map((cost) => [String(cost),
    replay.cells.get(`0:${cost}`).primary_pre_overlap
      .paired_mean_daily_net_log_return_difference]));
  const anchorEdges = Object.fromEntries(EXTERNAL_ATTEMPT115_CADENCE_ANCHORS.map((anchor) => [
    String(anchor), replay.cells.get(`${anchor}:5`).primary_pre_overlap
      .paired_mean_daily_net_log_return_difference,
  ]));
  const decades = completeDecadeEvidence(replay.primary.paired_daily_net_log_returns);
  return {
    primary_direction: gate("primary_direction", {
      primary_mean_strictly_positive: primary.paired_mean_daily_net_log_return_difference > 0,
    }, { partition_id: primary.partition_id, cadence_anchor: 0, one_way_cost_bps: 5,
      mean_paired_daily_net_log_return_difference:
        primary.paired_mean_daily_net_log_return_difference }),
    statistical_evidence: gate("statistical_evidence", {
      nominal_p_value_at_most_0_05: inference.bootstrap.nominal_one_sided_p_value <= 0.05,
      bonferroni_raw_p_value_at_most_frozen_threshold:
        inference.bootstrap.nominal_one_sided_p_value <= EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD,
      deflated_sharpe_probability_at_least_0_95: dsr.passes_gate,
    }, { nominal_one_sided_p_value: inference.bootstrap.nominal_one_sided_p_value,
      bonferroni_raw_p_value_maximum: EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD,
      global_registered_attempt_count: EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
      deflated_sharpe: dsr }),
    absolute_and_rf_proxy_performance: gate("absolute_and_rf_proxy_performance", {
      incumbent_positive_net_log_growth: incumbent.net_log_growth > 0,
      challenger_positive_net_log_growth: challenger.net_log_growth > 0,
      incumbent_beats_rf_proxy: incumbent.net_log_growth > rf.net_log_growth,
      challenger_beats_rf_proxy: challenger.net_log_growth > rf.net_log_growth,
    }, { incumbent_net_log_growth: incumbent.net_log_growth,
      challenger_net_log_growth: challenger.net_log_growth,
      rf_proxy_net_log_growth: rf.net_log_growth }),
    cost_stress: gate("cost_stress", { edge_positive_at_5_bps: costEdges["5"] > 0,
      edge_positive_at_10_bps: costEdges["10"] > 0 },
    { paired_mean_edges_by_one_way_cost_bps: costEdges, rebalance_anchor: 0 }),
    cadence_robustness: gate("cadence_robustness", {
      anchor_zero_positive: anchorEdges["0"] > 0,
      at_least_four_of_five_anchors_positive:
        Object.values(anchorEdges).filter((value) => value > 0).length >= 4,
    }, { paired_mean_edges_by_anchor: anchorEdges,
      positive_anchor_count: Object.values(anchorEdges).filter((value) => value > 0).length,
      one_way_cost_bps: 5 }),
    complete_decades: gate("complete_decades", {
      exact_expected_seven_complete_decades:
        stableStringify(decades.eligible_complete_decade_start_years)
          === stableStringify(EXPECTED_COMPLETE_DECADE_START_YEARS),
      minimum_seven_complete_decades: decades.complete_decades.length >= 7,
      median_complete_decade_edge_strictly_positive:
        decades.median_edge !== null && decades.median_edge > 0,
      positive_complete_decade_share_at_least_0_60:
        decades.positive_share !== null && decades.positive_share >= 0.6,
    }, decades),
    drawdown_guardrail: gate("drawdown_guardrail", {
      challenger_drawdown_no_more_than_0_05_worse:
        challenger.maximum_drawdown >= incumbent.maximum_drawdown - 0.05,
    }, { incumbent_maximum_drawdown: incumbent.maximum_drawdown,
      challenger_maximum_drawdown: challenger.maximum_drawdown,
      minimum_permitted_challenger_maximum_drawdown: incumbent.maximum_drawdown - 0.05 }),
    volatility_guardrail: gate("volatility_guardrail", {
      challenger_volatility_at_most_1_10_times_incumbent:
        challenger.annualized_volatility <= 1.1 * incumbent.annualized_volatility,
    }, { incumbent_annualized_volatility: incumbent.annualized_volatility,
      challenger_annualized_volatility: challenger.annualized_volatility,
      maximum_ratio: 1.1,
      observed_ratio: incumbent.annualized_volatility === 0
        ? (challenger.annualized_volatility === 0 ? 0 : null)
        : challenger.annualized_volatility / incumbent.annualized_volatility }),
    integrity: gate("integrity", integrity,
      { required_checks: [...EXTERNAL_ATTEMPT115_INTEGRITY_CHECK_NAMES] }),
  };
}

async function evaluationBody({ protocol, acquisitionReceipt, sourceBytes, artifactBytes }) {
  const validatedProtocol = validateExternalAttempt115Protocol(protocol);
  const validatedReceipt = validateExternalAttempt115AcquisitionReceipt(
    acquisitionReceipt,
    validatedProtocol,
  );
  const regenerated = await replayFromReceiptBoundArchive(sourceBytes, validatedReceipt);
  const replayGrid = regenerated.replayGrid;
  const replay = validateReplayGrid(replayGrid);
  const artifactBinding = artifactBindingVerified(artifactBytes, validatedProtocol);
  const replayIntegrity = replayIntegrityChecks(replay);
  const integrity = {
    protocol_self_hash: true,
    artifact_hash_binding: artifactBinding,
    official_source_identity_and_receipt: true,
    strict_parser_schema_and_row_order: true,
    source_transform_identity: true,
    warmup_signal_rebalance_outcome_chronology: replayIntegrity.chronology,
    future_observation_mutation_invariance: regenerated.futureMutationInvariant,
    cost_monotonicity_and_exact_entry_cost: replayIntegrity.costAndEntry,
    exact_terminal_liquidation: replayIntegrity.terminal,
  };
  const primaryValues = replay.primary.paired_daily_net_log_return_differences;
  const inference = runExternalAttempt115StationaryBootstrap(primaryValues);
  if (inference.schema_version !== EXTERNAL_ATTEMPT115_INFERENCE_SCHEMA
    || inference.observations !== replay.primary.observations
    || inference.multiple_testing.cumulative_trial_count
      !== EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT
    || inference.multiple_testing.per_test_threshold
      !== EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD) {
    fail("external Attempt115 frozen inference binding changed");
  }
  const gates = mechanismGates(replay, integrity);
  if (Object.keys(gates).length !== EXTERNAL_ATTEMPT115_GATE_NAMES.length
    || EXTERNAL_ATTEMPT115_GATE_NAMES.some((name) => !(name in gates))) {
    fail("external Attempt115 evaluation gate set changed");
  }
  const allPassed = EXTERNAL_ATTEMPT115_GATE_NAMES.every((name) => gates[name].passed);
  const disposition = allPassed
    ? validatedProtocol.result_disposition.pass_label
    : validatedProtocol.result_disposition.any_failure_disposition;
  return {
    schema_version: EXTERNAL_ATTEMPT115_EVALUATION_SCHEMA,
    evaluation_id: EXTERNAL_ATTEMPT115_EVALUATION_ID,
    protocol_sha256: validatedProtocol.protocol_sha256,
    acquisition_receipt: {
      schema_version: EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA,
      acquisition_receipt_sha256: validatedReceipt.acquisition_receipt_sha256,
      acquired_at: validatedReceipt.acquired_at,
      archive_raw_bytes_sha256: validatedReceipt.archive_raw_bytes_sha256,
      selected_member_raw_bytes_sha256: validatedReceipt.selected_member_raw_bytes_sha256,
    },
    replay_binding: {
      grid_sha256: replayGrid.grid_sha256,
      primary_replay_sha256: replay.primaryCell.replay_sha256,
      primary_partition_id: EXTERNAL_ATTEMPT115_PRIMARY_PARTITION_ID,
      primary_end_date_inclusive: EXTERNAL_ATTEMPT115_PRIMARY_END,
      overlap_partition_id: EXTERNAL_ATTEMPT115_OVERLAP_PARTITION_ID,
      overlap_start_date_inclusive: EXTERNAL_ATTEMPT115_OVERLAP_START,
      overlap_is_descriptive_only_and_cannot_rescue: true,
    },
    frozen_multiplicity: {
      global_registered_attempt_count: EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT,
      bonferroni_raw_p_value_maximum: EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD,
      deflated_sharpe_trial_mean_periodic: 0,
      deflated_sharpe_trial_standard_deviation_periodic_formula: "1 / sqrt(n - 1)",
    },
    gates,
    all_nine_mechanism_gates_passed: allPassed,
    disposition,
    pass_supports_only: validatedProtocol.result_disposition.pass_supports_only,
    authority: {
      research_only: true,
      incumbent_policy_change_authorized: false,
      production_policy_mutation_authorized: false,
      public_claim_change_authorized: false,
      site_or_release_mutation_authorized: false,
      broker_or_capital_action_authorized: false,
    },
    claim_boundary: EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY,
  };
}

export function hashExternalAttempt115Evaluation(value) {
  plainObject(value, "external Attempt115 evaluation artifact");
  return sha256(withoutKey(value, "evaluation_sha256"));
}

export function canonicalExternalAttempt115EvaluationJson(value) {
  const sort = (item) => {
    if (Array.isArray(item)) return item.map(sort);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sort(child)]));
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** Pure evaluation over receipt-bound in-memory source and frozen artifact bytes. */
export async function evaluateExternalAttempt115(input) {
  exactKeys(input, ["protocol", "acquisitionReceipt", "sourceBytes", "artifactBytes"],
    "external Attempt115 evaluation input");
  const body = await evaluationBody(input);
  return validateExternalAttempt115Evaluation({
    ...body,
    evaluation_sha256: sha256(body),
  }, input);
}

/** Validate and fully reproduce an evaluation from its receipt-bound frozen inputs. */
export async function validateExternalAttempt115Evaluation(value, input) {
  if (input === undefined) {
    fail("receipt-bound frozen inputs are required to validate an external Attempt115 evaluation");
  }
  exactKeys(value, [
    "schema_version", "evaluation_id", "protocol_sha256", "acquisition_receipt",
    "replay_binding", "frozen_multiplicity", "gates", "all_nine_mechanism_gates_passed",
    "disposition", "pass_supports_only", "authority", "claim_boundary", "evaluation_sha256",
  ], "external Attempt115 evaluation artifact");
  exactKeys(value.acquisition_receipt, [
    "schema_version", "acquisition_receipt_sha256", "acquired_at",
    "archive_raw_bytes_sha256", "selected_member_raw_bytes_sha256",
  ], "external Attempt115 evaluation acquisition binding");
  exactKeys(value.replay_binding, [
    "grid_sha256", "primary_replay_sha256", "primary_partition_id",
    "primary_end_date_inclusive", "overlap_partition_id", "overlap_start_date_inclusive",
    "overlap_is_descriptive_only_and_cannot_rescue",
  ], "external Attempt115 evaluation replay binding");
  exactKeys(value.frozen_multiplicity, [
    "global_registered_attempt_count", "bonferroni_raw_p_value_maximum",
    "deflated_sharpe_trial_mean_periodic",
    "deflated_sharpe_trial_standard_deviation_periodic_formula",
  ], "external Attempt115 evaluation multiplicity");
  exactKeys(value.authority, [
    "research_only", "incumbent_policy_change_authorized",
    "production_policy_mutation_authorized", "public_claim_change_authorized",
    "site_or_release_mutation_authorized", "broker_or_capital_action_authorized",
  ], "external Attempt115 evaluation authority");
  if (value.schema_version !== EXTERNAL_ATTEMPT115_EVALUATION_SCHEMA
    || value.evaluation_id !== EXTERNAL_ATTEMPT115_EVALUATION_ID
    || !SHA256_PATTERN.test(value.protocol_sha256 ?? "")
    || value.acquisition_receipt.schema_version
      !== EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA
    || !SHA256_PATTERN.test(value.acquisition_receipt.acquisition_receipt_sha256 ?? "")
    || !SHA256_PATTERN.test(value.acquisition_receipt.archive_raw_bytes_sha256 ?? "")
    || !SHA256_PATTERN.test(value.acquisition_receipt.selected_member_raw_bytes_sha256 ?? "")
    || !SHA256_PATTERN.test(value.replay_binding.grid_sha256 ?? "")
    || !SHA256_PATTERN.test(value.replay_binding.primary_replay_sha256 ?? "")
    || value.replay_binding.primary_partition_id !== EXTERNAL_ATTEMPT115_PRIMARY_PARTITION_ID
    || value.replay_binding.primary_end_date_inclusive !== EXTERNAL_ATTEMPT115_PRIMARY_END
    || value.replay_binding.overlap_partition_id !== EXTERNAL_ATTEMPT115_OVERLAP_PARTITION_ID
    || value.replay_binding.overlap_start_date_inclusive !== EXTERNAL_ATTEMPT115_OVERLAP_START
    || value.replay_binding.overlap_is_descriptive_only_and_cannot_rescue !== true
    || value.claim_boundary !== EXTERNAL_ATTEMPT115_CLAIM_BOUNDARY
    || value.frozen_multiplicity?.global_registered_attempt_count
      !== EXTERNAL_ATTEMPT115_GLOBAL_ATTEMPT_COUNT
    || value.frozen_multiplicity?.bonferroni_raw_p_value_maximum
      !== EXTERNAL_ATTEMPT115_BONFERRONI_THRESHOLD
    || value.frozen_multiplicity.deflated_sharpe_trial_mean_periodic !== 0
    || value.frozen_multiplicity.deflated_sharpe_trial_standard_deviation_periodic_formula
      !== "1 / sqrt(n - 1)"
    || value.authority?.research_only !== true
    || Object.entries(value.authority ?? {})
      .filter(([key]) => key !== "research_only")
      .some(([, permission]) => permission !== false)) {
    fail("external Attempt115 evaluation semantics or authority changed");
  }
  exactKeys(value.gates, EXTERNAL_ATTEMPT115_GATE_NAMES, "external Attempt115 evaluation gates");
  for (const name of EXTERNAL_ATTEMPT115_GATE_NAMES) {
    const result = value.gates[name];
    exactKeys(result, ["name", "passed", "checks", "measurements"], `${name} gate`);
    exactKeys(result.checks, GATE_CHECK_NAMES[name], `${name} checks`);
    plainObject(result.measurements, `${name} measurements`);
    if (result.name !== name || typeof result.passed !== "boolean"
      || result.passed !== Object.values(result.checks)
        .every((check) => check === true)) {
      fail(`external Attempt115 ${name} gate semantics changed`);
    }
  }
  const allPassed = EXTERNAL_ATTEMPT115_GATE_NAMES.every((name) => value.gates[name].passed);
  if (value.all_nine_mechanism_gates_passed !== allPassed
    || value.disposition !== (allPassed
      ? "EXTERNAL_MECHANISM_PORTABILITY_ESTABLISHED_ON_FROZEN_FACTOR_PROXY_REPLAY"
      : "EXTERNAL_MECHANISM_PORTABILITY_NOT_ESTABLISHED")
    || value.pass_supports_only
      !== "The sole frozen challenger mechanism ported to an external factor-return proxy under the preregistered replay."
    || value.evaluation_sha256 !== hashExternalAttempt115Evaluation(value)) {
    fail("external Attempt115 evaluation result or self-hash changed");
  }
  const expectedBody = await evaluationBody(input);
  if (stableStringify(withoutKey(value, "evaluation_sha256")) !== stableStringify(expectedBody)) {
    fail("external Attempt115 evaluation does not reproduce from its frozen inputs");
  }
  return deepFreeze(structuredClone(value));
}
