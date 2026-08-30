import { sha256 } from "../../lib/canonical.mjs";
import {
  KENNETH_FRENCH_ATTEMPT115_ADAPTER_SCHEMA,
  KENNETH_FRENCH_DAILY_PROXY_LABELS,
  adaptKennethFrenchDailyFactorsToAttempt115,
} from "./kenneth_french_daily_factor_adapter.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
  attempt115DownsideSemivolatilityTarget,
  attempt115IncumbentTarget,
} from "../prospective_attempt115/policy.mjs";

export const EXTERNAL_ATTEMPT115_REPLAY_SCHEMA =
  "finly_attempt115_external_mechanism_replay.v1";
export const EXTERNAL_ATTEMPT115_REPLAY_GRID_SCHEMA =
  "finly_attempt115_external_mechanism_replay_grid.v1";
export const EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS = 253;
export const EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION = 254;
export const EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION = 255;
export const EXTERNAL_ATTEMPT115_REBALANCE_INTERVAL = 5;
export const EXTERNAL_ATTEMPT115_PRIMARY_END_DATE = "2007-05-29";
export const EXTERNAL_ATTEMPT115_OVERLAP_START_DATE = "2007-05-30";
export const EXTERNAL_ATTEMPT115_PRIMARY_PARTITION_ID =
  "PRE_ETF_OVERLAP_EXTERNAL_MECHANISM";
export const EXTERNAL_ATTEMPT115_OVERLAP_PARTITION_ID =
  "POST_2007_OVERLAP_DIAGNOSTIC";
export const EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS = 5;
export const EXTERNAL_ATTEMPT115_PRIMARY_ANCHOR = 0;
export const EXTERNAL_ATTEMPT115_COST_BPS = Object.freeze([1, 5, 10, 25]);
export const EXTERNAL_ATTEMPT115_CADENCE_ANCHORS = Object.freeze([0, 1, 2, 3, 4]);

const TRADING_DAYS = 252;
const MARKET = "MARKET_PROXY";
const RF = "RF_PROXY";
const POLICY_IDS = Object.freeze([
  ATTEMPT115_INCUMBENT_POLICY_ID,
  ATTEMPT115_CHALLENGER_POLICY_ID,
]);

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

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be finite`);
  }
  return value;
}

function positive(value, label) {
  const checked = finite(value, label);
  if (!(checked > 0)) fail(`${label} must be positive`);
  return checked;
}

function isoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${label} must be an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be an ISO date`);
  }
  return value;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0,
  ) / (values.length - 1);
  return Math.sqrt(variance);
}

function validateReplayOptions({ policyId, oneWayCostBps, rebalanceAnchor }) {
  if (!POLICY_IDS.includes(policyId)) {
    fail("external Attempt115 replay policy is not registered");
  }
  if (!EXTERNAL_ATTEMPT115_COST_BPS.includes(oneWayCostBps)) {
    fail("external Attempt115 one-way cost must be one of 1, 5, 10, or 25 bps");
  }
  if (!EXTERNAL_ATTEMPT115_CADENCE_ANCHORS.includes(rebalanceAnchor)) {
    fail("external Attempt115 cadence anchor must be an integer from 0 through 4");
  }
}

function optionBag(value, allowedKeys, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) fail(`${label} contains unknown option: ${unknown.join(", ")}`);
  return value;
}

function validateAdaptedSource(adapted) {
  if (!adapted || typeof adapted !== "object" || Array.isArray(adapted)
    || adapted.schema_version !== KENNETH_FRENCH_ATTEMPT115_ADAPTER_SCHEMA) {
    fail("external Attempt115 replay requires the registered factor adapter envelope");
  }
  if (adapted.source_proxy_labels?.[MARKET]
      !== KENNETH_FRENCH_DAILY_PROXY_LABELS[MARKET]
    || adapted.source_proxy_labels?.[RF]
      !== KENNETH_FRENCH_DAILY_PROXY_LABELS[RF]) {
    fail("external Attempt115 replay proxy labels are invalid");
  }
  if (!Number.isSafeInteger(adapted.source_return_rows)
    || adapted.source_return_rows !== adapted.proxy_points?.length
    || adapted.source_return_rows !== adapted.frozen_target_points?.length
    || adapted.source_return_rows < EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION) {
    fail(
      `external Attempt115 replay requires at least ${EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION} aligned factor observations`,
    );
  }

  let priorDate = "";
  adapted.proxy_points.forEach((point, index) => {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      fail(`external Attempt115 proxy observation ${index + 1} must be an object`);
    }
    const date = isoDate(point.date, `external Attempt115 proxy observation ${index + 1} date`);
    if (date <= priorDate) {
      fail("external Attempt115 proxy observations must be strictly chronological");
    }
    priorDate = date;
    positive(point[MARKET], `external Attempt115 ${MARKET} level ${index + 1}`);
    positive(point[RF], `external Attempt115 ${RF} level ${index + 1}`);

    const targetPoint = adapted.frozen_target_points[index];
    if (!targetPoint || targetPoint.date !== point.date
      || targetPoint.SPY !== point[MARKET] || targetPoint.BIL !== point[RF]) {
      fail("external Attempt115 target alias boundary is misaligned");
    }
  });
}

function policyWeights(policyId, frozenTargetPoints, signalIndex) {
  const first = signalIndex - EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS + 1;
  if (first < 0) fail("external Attempt115 signal lacks 253 causal observations");
  const causalPoints = frozenTargetPoints.slice(first, signalIndex + 1);
  if (causalPoints.length !== EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS) {
    fail("external Attempt115 signal window is incomplete");
  }
  const target = policyId === ATTEMPT115_INCUMBENT_POLICY_ID
    ? attempt115IncumbentTarget(causalPoints)
    : attempt115DownsideSemivolatilityTarget(causalPoints);
  const marketWeight = finite(target?.SPY, `external Attempt115 ${MARKET} target`);
  const rfWeight = finite(target?.BIL, `external Attempt115 ${RF} target`);
  if (marketWeight < -1e-12 || marketWeight > 1 + 1e-12
    || rfWeight < -1e-12 || rfWeight > 1 + 1e-12
    || Math.abs(marketWeight + rfWeight - 1) > 1e-10) {
    fail("external Attempt115 target violates long-only unlevered proxy bounds");
  }
  return deepFreeze({
    [MARKET]: Math.min(1, Math.max(0, marketWeight)),
    [RF]: Math.min(1, Math.max(0, rfWeight)),
  });
}

function dueAtSignal(signalIndex, rebalanceAnchor) {
  const firstSignalIndex = EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS - 1;
  const step = signalIndex - firstSignalIndex;
  return step >= 0
    && ((step - rebalanceAnchor) % EXTERNAL_ATTEMPT115_REBALANCE_INTERVAL
      + EXTERNAL_ATTEMPT115_REBALANCE_INTERVAL)
      % EXTERNAL_ATTEMPT115_REBALANCE_INTERVAL === 0;
}

function absoluteLegTurnover(before, after) {
  const turnover = Math.abs(after[MARKET] - before[MARKET])
    + Math.abs(after[RF] - before[RF]);
  return finite(turnover, "external Attempt115 absolute-leg turnover");
}

function executionAtClose({
  policyId,
  frozenTargetPoints,
  signalIndex,
  beforeWeights,
  rebalanceAnchor,
  oneWayCostBps,
}) {
  const rebalanced = dueAtSignal(signalIndex, rebalanceAnchor);
  const weights = rebalanced
    ? policyWeights(policyId, frozenTargetPoints, signalIndex)
    : beforeWeights;
  const turnover = rebalanced ? absoluteLegTurnover(beforeWeights, weights) : 0;
  const costFraction = turnover * oneWayCostBps / 10_000;
  if (!Number.isFinite(costFraction) || costFraction < 0 || costFraction >= 1) {
    fail("external Attempt115 transaction cost is invalid");
  }
  return deepFreeze({
    signal_date: frozenTargetPoints[signalIndex].date,
    rebalanced,
    weights,
    absolute_leg_turnover: turnover,
    transaction_cost_fraction: costFraction,
  });
}

function proxyReturns(points, outcomeIndex) {
  if (outcomeIndex < 1 || outcomeIndex >= points.length) {
    fail("external Attempt115 outcome index is invalid");
  }
  const returns = {
    [MARKET]: points[outcomeIndex][MARKET] / points[outcomeIndex - 1][MARKET] - 1,
    [RF]: points[outcomeIndex][RF] / points[outcomeIndex - 1][RF] - 1,
  };
  for (const [label, value] of Object.entries(returns)) {
    finite(value, `external Attempt115 ${label} return`);
    if (value <= -1) fail(`external Attempt115 ${label} return must exceed -1`);
  }
  return deepFreeze(returns);
}

function driftWeights(weights, returns, grossGrowth) {
  const drifted = {
    [MARKET]: weights[MARKET] * (1 + returns[MARKET]) / grossGrowth,
    [RF]: weights[RF] * (1 + returns[RF]) / grossGrowth,
  };
  const sum = drifted[MARKET] + drifted[RF];
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-10
    || drifted[MARKET] < -1e-12 || drifted[RF] < -1e-12) {
    fail("external Attempt115 self-financing drift produced invalid weights");
  }
  return deepFreeze({
    [MARKET]: Math.min(1, Math.max(0, drifted[MARKET])),
    [RF]: Math.min(1, Math.max(0, drifted[RF])),
  });
}

/**
 * Produce the causal, cost-free portfolio path plus scheduled execution costs.
 *
 * Observations 1-253 form the first signal. That signal is executed at close
 * 254, and the first returned row is close 254 to close 255. No value at or
 * after observation 254 enters the first target.
 */
function rawPolicyRows(adapted, options) {
  const { policyId, oneWayCostBps, rebalanceAnchor } = options;
  const points = adapted.proxy_points;
  const targets = adapted.frozen_target_points;
  const firstSignalIndex = EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS - 1;
  const firstExecutionIndex = EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION - 1;
  const firstOutcomeIndex = EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION - 1;

  let closeWeights = deepFreeze({ [MARKET]: 0, [RF]: 1 });
  let execution = executionAtClose({
    policyId,
    frozenTargetPoints: targets,
    signalIndex: firstSignalIndex,
    beforeWeights: closeWeights,
    rebalanceAnchor,
    oneWayCostBps,
  });
  closeWeights = execution.weights;
  const rows = [];

  for (let outcomeIndex = firstOutcomeIndex; outcomeIndex < points.length; outcomeIndex += 1) {
    if (outcomeIndex - 1 < firstExecutionIndex) {
      fail("external Attempt115 scored a return before the first execution close");
    }
    const returns = proxyReturns(points, outcomeIndex);
    const grossGrowth = closeWeights[MARKET] * (1 + returns[MARKET])
      + closeWeights[RF] * (1 + returns[RF]);
    positive(grossGrowth, "external Attempt115 gross portfolio growth");
    const endWeights = driftWeights(closeWeights, returns, grossGrowth);
    rows.push({
      policy_id: policyId,
      signal_date: execution.signal_date,
      execution_date: points[outcomeIndex - 1].date,
      outcome_observation_date: points[outcomeIndex].date,
      rebalanced: execution.rebalanced,
      start_weights: closeWeights,
      end_weights: endWeights,
      proxy_returns: returns,
      gross_growth: grossGrowth,
      gross_return: grossGrowth - 1,
      absolute_leg_turnover: execution.absolute_leg_turnover,
      transaction_cost_fraction: execution.transaction_cost_fraction,
    });

    closeWeights = endWeights;
    if (outcomeIndex < points.length - 1) {
      execution = executionAtClose({
        policyId,
        frozenTargetPoints: targets,
        signalIndex: outcomeIndex - 1,
        beforeWeights: closeWeights,
        rebalanceAnchor,
        oneWayCostBps,
      });
      closeWeights = execution.weights;
    }
  }
  if (rows.length === 0) fail("external Attempt115 replay produced no scored outcomes");
  return rows;
}

function rebuildStandaloneRows(rawRows, oneWayCostBps) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    fail("external Attempt115 standalone partition has no rows");
  }
  let wealth = 1;
  let costPaid = 0;
  const rows = rawRows.map((raw, index) => {
    const first = index === 0;
    const last = index === rawRows.length - 1;
    const initialWeights = { [MARKET]: 0, [RF]: 1 };
    const entryTurnover = first
      ? absoluteLegTurnover(initialWeights, raw.start_weights)
      : raw.absolute_leg_turnover;
    const entryCostFraction = entryTurnover * oneWayCostBps / 10_000;
    if (!Number.isFinite(entryCostFraction)
      || entryCostFraction < 0 || entryCostFraction >= 1) {
      fail("external Attempt115 standalone entry cost is invalid");
    }
    const wealthBefore = wealth;
    const entryCostPaid = wealthBefore * entryCostFraction;
    const growthBeforeLiquidation = (1 - entryCostFraction) * raw.gross_growth;
    positive(growthBeforeLiquidation, "external Attempt115 pre-liquidation growth");
    const wealthBeforeLiquidation = wealthBefore * growthBeforeLiquidation;
    const terminalWeights = { [MARKET]: 0, [RF]: 1 };
    const terminalTurnover = last
      ? absoluteLegTurnover(raw.end_weights, terminalWeights)
      : 0;
    const terminalCostFraction = terminalTurnover * oneWayCostBps / 10_000;
    if (!Number.isFinite(terminalCostFraction)
      || terminalCostFraction < 0 || terminalCostFraction >= 1) {
      fail("external Attempt115 terminal-liquidation cost is invalid");
    }
    const terminalCostPaid = wealthBeforeLiquidation * terminalCostFraction;
    const netGrowth = growthBeforeLiquidation * (1 - terminalCostFraction);
    positive(netGrowth, "external Attempt115 net portfolio growth");
    const netReturn = netGrowth - 1;
    wealth = wealthBefore * netGrowth;
    costPaid += entryCostPaid + terminalCostPaid;
    if (!Number.isFinite(wealth) || !Number.isFinite(costPaid)) {
      fail("external Attempt115 wealth or cost path exceeds the finite numeric range");
    }
    return deepFreeze({
      ...raw,
      standalone_entry: first,
      standalone_terminal_liquidation: last,
      absolute_leg_turnover: entryTurnover + terminalTurnover,
      entry_absolute_leg_turnover: entryTurnover,
      terminal_liquidation_absolute_leg_turnover: terminalTurnover,
      transaction_cost_fraction: entryCostFraction,
      terminal_liquidation_cost_fraction: terminalCostFraction,
      modeled_cost_paid_initial_wealth: entryCostPaid + terminalCostPaid,
      net_growth: netGrowth,
      net_return: netReturn,
      net_log_return: Math.log1p(netReturn),
      wealth_index: wealth,
    });
  });
  return deepFreeze(rows);
}

function drawdown(wealthValues) {
  let peak = 1;
  let maximum = 0;
  for (const wealth of wealthValues) {
    peak = Math.max(peak, wealth);
    maximum = Math.min(maximum, wealth / peak - 1);
  }
  return maximum;
}

function metricsFromReturns(returns, dates, extras = {}) {
  if (!Array.isArray(returns) || returns.length === 0 || returns.length !== dates.length) {
    fail("external Attempt115 metrics require aligned nonempty returns and dates");
  }
  let wealth = 1;
  const wealthValues = returns.map((value, index) => {
    finite(value, `external Attempt115 metric return ${index + 1}`);
    if (value <= -1) fail("external Attempt115 metric returns must exceed -1");
    wealth *= 1 + value;
    if (!Number.isFinite(wealth) || !(wealth > 0)) {
      fail("external Attempt115 metric wealth exceeds the finite numeric range");
    }
    return wealth;
  });
  const deviation = sampleStandardDeviation(returns);
  const annualizedReturn = wealth ** (TRADING_DAYS / returns.length) - 1;
  const netLogGrowth = returns.reduce((sum, value) => sum + Math.log1p(value), 0);
  if (!Number.isFinite(annualizedReturn) || !Number.isFinite(netLogGrowth)) {
    fail("external Attempt115 annualized or net-log return exceeds the finite numeric range");
  }
  return deepFreeze({
    observations: returns.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    total_return: wealth - 1,
    net_log_growth: netLogGrowth,
    annualized_return: annualizedReturn,
    annualized_volatility: deviation === null ? null : deviation * Math.sqrt(TRADING_DAYS),
    maximum_drawdown: drawdown(wealthValues),
    ...extras,
  });
}

function portfolioMetrics(rows) {
  const metrics = metricsFromReturns(
    rows.map((row) => row.net_return),
    rows.map((row) => row.outcome_observation_date),
  );
  const turnover = rows.reduce((sum, row) => sum + row.absolute_leg_turnover, 0);
  const simpleCost = rows.reduce(
    (sum, row) => sum + row.transaction_cost_fraction
      + row.terminal_liquidation_cost_fraction,
    0,
  );
  const paidCost = rows.reduce(
    (sum, row) => sum + row.modeled_cost_paid_initial_wealth,
    0,
  );
  return deepFreeze({
    ...metrics,
    gross_total_return: rows.reduce(
      (growth, row) => growth * row.gross_growth,
      1,
    ) - 1,
    cumulative_absolute_leg_turnover: turnover,
    annualized_absolute_leg_turnover: turnover * TRADING_DAYS / rows.length,
    modeled_cost_drag_simple_sum: simpleCost,
    modeled_cost_paid_initial_wealth: paidCost,
  });
}

function benchmarkMetrics(rows, label) {
  if (![MARKET, RF].includes(label)) fail("external Attempt115 benchmark label is invalid");
  return metricsFromReturns(
    rows.map((row) => row.proxy_returns[label]),
    rows.map((row) => row.outcome_observation_date),
    {
      cumulative_absolute_leg_turnover: 0,
      annualized_absolute_leg_turnover: 0,
      modeled_cost_drag_simple_sum: 0,
      modeled_cost_paid_initial_wealth: 0,
    },
  );
}

function differenceMetrics(challenger, incumbent) {
  const keys = [
    "total_return",
    "net_log_growth",
    "annualized_return",
    "annualized_volatility",
    "maximum_drawdown",
    "gross_total_return",
    "cumulative_absolute_leg_turnover",
    "annualized_absolute_leg_turnover",
    "modeled_cost_drag_simple_sum",
    "modeled_cost_paid_initial_wealth",
  ];
  return deepFreeze(Object.fromEntries(keys.map((key) => [
    key,
    Number.isFinite(challenger[key]) && Number.isFinite(incumbent[key])
      ? challenger[key] - incumbent[key]
      : null,
  ])));
}

function buildPartition(rawRowsByPolicy, oneWayCostBps, partitionId) {
  const incumbentRows = rebuildStandaloneRows(
    rawRowsByPolicy[ATTEMPT115_INCUMBENT_POLICY_ID],
    oneWayCostBps,
  );
  const challengerRows = rebuildStandaloneRows(
    rawRowsByPolicy[ATTEMPT115_CHALLENGER_POLICY_ID],
    oneWayCostBps,
  );
  if (incumbentRows.length !== challengerRows.length) {
    fail("external Attempt115 paired policy row counts differ");
  }
  const paired = incumbentRows.map((incumbent, index) => {
    const challenger = challengerRows[index];
    if (incumbent.signal_date !== challenger.signal_date
      || incumbent.execution_date !== challenger.execution_date
      || incumbent.outcome_observation_date !== challenger.outcome_observation_date
      || incumbent.rebalanced !== challenger.rebalanced
      || incumbent.proxy_returns[MARKET] !== challenger.proxy_returns[MARKET]
      || incumbent.proxy_returns[RF] !== challenger.proxy_returns[RF]) {
      fail(`external Attempt115 paired policy alignment differs at row ${index + 1}`);
    }
    return deepFreeze({
      outcome_observation_date: incumbent.outcome_observation_date,
      incumbent_net_log_return: incumbent.net_log_return,
      challenger_net_log_return: challenger.net_log_return,
      challenger_minus_incumbent_net_log_return:
        challenger.net_log_return - incumbent.net_log_return,
    });
  });
  const incumbentMetrics = portfolioMetrics(incumbentRows);
  const challengerMetrics = portfolioMetrics(challengerRows);
  const dates = incumbentRows.map((row) => row.outcome_observation_date);
  const body = {
    partition_id: partitionId,
    observations: incumbentRows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    outcome_observation_dates_sha256: sha256(dates),
    policies: {
      [ATTEMPT115_INCUMBENT_POLICY_ID]: {
        rows: incumbentRows,
        metrics: incumbentMetrics,
      },
      [ATTEMPT115_CHALLENGER_POLICY_ID]: {
        rows: challengerRows,
        metrics: challengerMetrics,
      },
    },
    benchmarks: {
      [MARKET]: benchmarkMetrics(incumbentRows, MARKET),
      [RF]: benchmarkMetrics(incumbentRows, RF),
    },
    paired_daily_net_log_returns: paired,
    paired_daily_net_log_return_differences: paired.map(
      (row) => row.challenger_minus_incumbent_net_log_return,
    ),
    challenger_minus_incumbent: differenceMetrics(
      challengerMetrics,
      incumbentMetrics,
    ),
  };
  return deepFreeze(body);
}

function partitionRawRows(rawRows, primaryEndDate) {
  const primary = rawRows.filter(
    (row) => row.outcome_observation_date <= primaryEndDate,
  );
  const overlap = rawRows.filter(
    (row) => row.outcome_observation_date > primaryEndDate,
  );
  if (primary.length < 2 || overlap.length < 2) {
    fail("external Attempt115 replay requires at least two outcomes in both primary and overlap partitions");
  }
  if (primary.at(-1).outcome_observation_date
      !== EXTERNAL_ATTEMPT115_PRIMARY_END_DATE
    || overlap[0].outcome_observation_date
      !== EXTERNAL_ATTEMPT115_OVERLAP_START_DATE) {
    fail("external Attempt115 replay is missing the frozen primary-to-overlap session boundary");
  }
  return { primary, overlap };
}

/**
 * Run one paired replay cell. This function is pure: it performs no acquisition,
 * filesystem access, network access, persistence, or public-claim mutation.
 */
export function replayExternalAttempt115Cell(parsed, options) {
  const checkedOptions = optionBag(
    options,
    ["oneWayCostBps", "rebalanceAnchor"],
    "external Attempt115 replay options",
  );
  const {
    oneWayCostBps = EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS,
    rebalanceAnchor = EXTERNAL_ATTEMPT115_PRIMARY_ANCHOR,
  } = checkedOptions;
  const primaryEndDate = EXTERNAL_ATTEMPT115_PRIMARY_END_DATE;
  validateReplayOptions({
    policyId: ATTEMPT115_INCUMBENT_POLICY_ID,
    oneWayCostBps,
    rebalanceAnchor,
  });
  const adapted = adaptKennethFrenchDailyFactorsToAttempt115(parsed);
  validateAdaptedSource(adapted);

  const rawRowsByPolicy = Object.fromEntries(POLICY_IDS.map((policyId) => [
    policyId,
    rawPolicyRows(adapted, { policyId, oneWayCostBps, rebalanceAnchor }),
  ]));
  const incumbentPartitions = partitionRawRows(
    rawRowsByPolicy[ATTEMPT115_INCUMBENT_POLICY_ID],
    primaryEndDate,
  );
  const challengerPartitions = partitionRawRows(
    rawRowsByPolicy[ATTEMPT115_CHALLENGER_POLICY_ID],
    primaryEndDate,
  );
  const body = {
    schema_version: EXTERNAL_ATTEMPT115_REPLAY_SCHEMA,
    source_proxy_labels: {
      [MARKET]: KENNETH_FRENCH_DAILY_PROXY_LABELS[MARKET],
      [RF]: KENNETH_FRENCH_DAILY_PROXY_LABELS[RF],
    },
    timing: {
      warmup_observations: EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS,
      first_signal_observation: EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS,
      first_execution_observation: EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION,
      first_scored_observation: EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION,
      execution_lag_sessions: 1,
      first_return_lag_sessions_after_signal: 2,
      initial_allocation: { [MARKET]: 0, [RF]: 1 },
    },
    execution_model: {
      rebalance_interval_sessions: EXTERNAL_ATTEMPT115_REBALANCE_INTERVAL,
      rebalance_anchor: rebalanceAnchor,
      one_way_cost_bps: oneWayCostBps,
      costs_apply_to_absolute_traded_legs: true,
      self_financing_drift_between_rebalances: true,
      standalone_entry_cost_included: true,
      terminal_target_allocation: { [MARKET]: 0, [RF]: 1 },
      terminal_reallocation_cost_included: true,
    },
    partition_rule: {
      primary_outcome_observation_date_on_or_before: primaryEndDate,
      overlap_diagnostic_outcome_observation_date_after: primaryEndDate,
      partitions_are_standalone_with_entry_and_terminal_costs: true,
    },
    partitions: {
      primary_pre_overlap: buildPartition({
        [ATTEMPT115_INCUMBENT_POLICY_ID]: incumbentPartitions.primary,
        [ATTEMPT115_CHALLENGER_POLICY_ID]: challengerPartitions.primary,
      }, oneWayCostBps, EXTERNAL_ATTEMPT115_PRIMARY_PARTITION_ID),
      overlap_diagnostic_only: buildPartition({
        [ATTEMPT115_INCUMBENT_POLICY_ID]: incumbentPartitions.overlap,
        [ATTEMPT115_CHALLENGER_POLICY_ID]: challengerPartitions.overlap,
      }, oneWayCostBps, EXTERNAL_ATTEMPT115_OVERLAP_PARTITION_ID),
    },
    claim_boundary:
      "External factor-proxy mechanism replay only; it is not ETF execution evidence, future-alpha evidence, or live-profitability evidence.",
  };
  return deepFreeze({ ...body, replay_sha256: sha256(body) });
}

function partitionSummary(partition) {
  return deepFreeze({
    partition_id: partition.partition_id,
    observations: partition.observations,
    start_date: partition.start_date,
    end_date: partition.end_date,
    outcome_observation_dates_sha256: partition.outcome_observation_dates_sha256,
    policy_metrics: Object.fromEntries(POLICY_IDS.map((policyId) => [
      policyId,
      partition.policies[policyId].metrics,
    ])),
    benchmarks: partition.benchmarks,
    paired_mean_daily_net_log_return_difference: mean(
      partition.paired_daily_net_log_return_differences,
    ),
    challenger_minus_incumbent: partition.challenger_minus_incumbent,
  });
}

function cellSummary(cell) {
  return deepFreeze({
    schema_version: cell.schema_version,
    replay_sha256: cell.replay_sha256,
    rebalance_anchor: cell.execution_model.rebalance_anchor,
    one_way_cost_bps: cell.execution_model.one_way_cost_bps,
    primary_pre_overlap: partitionSummary(cell.partitions.primary_pre_overlap),
    overlap_diagnostic_only: partitionSummary(
      cell.partitions.overlap_diagnostic_only,
    ),
  });
}

/** Run the frozen 5-anchor by 4-cost grid while retaining rows only for 5bp/anchor 0. */
export function replayExternalAttempt115Grid(parsed, options) {
  const checkedOptions = optionBag(
    options,
    [],
    "external Attempt115 replay-grid options",
  );
  if (Object.keys(checkedOptions).length !== 0) {
    fail("external Attempt115 replay-grid options changed after validation");
  }
  let primary = null;
  const sensitivityCells = [];
  for (const rebalanceAnchor of EXTERNAL_ATTEMPT115_CADENCE_ANCHORS) {
    for (const oneWayCostBps of EXTERNAL_ATTEMPT115_COST_BPS) {
      const cell = replayExternalAttempt115Cell(parsed, {
        oneWayCostBps,
        rebalanceAnchor,
      });
      if (rebalanceAnchor === EXTERNAL_ATTEMPT115_PRIMARY_ANCHOR
        && oneWayCostBps === EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS) {
        primary = cell;
      }
      sensitivityCells.push(cellSummary(cell));
    }
  }
  if (primary === null || sensitivityCells.length !== 20) {
    fail("external Attempt115 replay grid is incomplete");
  }
  const body = {
    schema_version: EXTERNAL_ATTEMPT115_REPLAY_GRID_SCHEMA,
    primary_cell: primary,
    sensitivity_cells: sensitivityCells,
    claim_boundary: primary.claim_boundary,
  };
  return deepFreeze({ ...body, grid_sha256: sha256(body) });
}
