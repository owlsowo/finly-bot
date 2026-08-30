import { sha256, stableStringify } from "../../lib/canonical.mjs";
import {
  validateForwardTrialLiveActivation,
  validateForwardTrialLiveAnchorManifest,
  validateForwardTrialLiveCommitment,
} from "../forward_trial_live_core.mjs";
import { validateGitHubPublicationReceipt } from "../../scripts/verify_forward_live_github_publication.mjs";
import {
  buildAttempt115SettlementSourceProjection,
  validateAttempt115ForwardAnchorAssuranceReceipt,
  validateAttempt115SettlementSourceProjection,
} from "../../scripts/verify_attempt115_forward_anchor.mjs";
import { ATTEMPT115_ACTIVATION } from "./activation.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
  buildAttempt115PairedPolicyDecision,
  validateAttempt115PairedPolicyDecision,
} from "./policy.mjs";
import {
  ATTEMPT115_FIRST_EXECUTION_SESSION,
  ATTEMPT115_FIRST_SIGNAL_SESSION,
  ATTEMPT115_ID,
  ATTEMPT115_PROTOCOL_SHA256,
} from "./protocol.mjs";

export { ATTEMPT115_ID };

export const ATTEMPT115_REQUIRED_SOURCE_BUNDLES = 253;
export const ATTEMPT115_REQUIRED_INTERVALS = 252;
export const ATTEMPT115_SOURCE_PROJECTION_SCHEMA =
  "finly_attempt115_validated_forward_source_projection.v1";
export const ATTEMPT115_SETTLEMENT_WINDOW_SCHEMA =
  "finly_attempt115_paired_next_open_settlement_window.v1";

const SYMBOLS = Object.freeze(["SPY", "BIL"]);
const EXECUTION_BOOKS = Object.freeze(["adjusted", "raw"]);
const CADENCE_ANCHORS = Object.freeze([0, 1, 2, 3, 4]);
const COST_STRESS_BPS = Object.freeze([1, 5, 10, 25]);
const PRIMARY_BOOK = "adjusted";
const PRIMARY_ANCHOR = 0;
const PRIMARY_COST_BPS = 5;
const TRADING_DAYS = 252;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const AUTHORITY = Object.freeze({
  research_only: true,
  broker_mutation_authorized: false,
  order_payload: null,
  performance_inference_permitted: false,
});

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function isoDate(value, label) {
  if (typeof value !== "string" || !DATE.test(value)) fail(`${label} must be an ISO date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be an ISO date`);
  }
  return value;
}

function instant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function finite(value, label, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)
    || value < minimum || value > maximum) {
    fail(`${label} must be finite and between ${minimum} and ${maximum}`);
  }
  return value;
}

function positive(value, label) {
  return finite(value, label, { minimum: Number.MIN_VALUE });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function round(value, places = 10) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  const result = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0,
  ) / (values.length - 1));
}

function maximumDrawdown(returns) {
  let wealth = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of returns) {
    wealth *= 1 + value;
    peak = Math.max(peak, wealth);
    drawdown = Math.min(drawdown, wealth / peak - 1);
  }
  return drawdown;
}

function calculateExecutionMetrics(rows) {
  if (!Array.isArray(rows) || rows.length < 2) fail("execution metrics require at least two rows");
  const returns = rows.map((row) => Number(row.net_return));
  if (returns.some((value) => !Number.isFinite(value) || value <= -1)) {
    fail("execution rows contain an invalid net return");
  }
  const growth = returns.reduce((value, item) => value * (1 + item), 1);
  const spyGrowth = rows.reduce((value, row) => value * (1 + Number(row.spy_return)), 1);
  const bilGrowth = rows.reduce((value, row) => value * (1 + Number(row.bil_return)), 1);
  const deviation = sampleStandardDeviation(returns);
  return Object.freeze({
    observations: rows.length,
    start_date: rows[0].execution_date ?? rows[0].return_date,
    end_date: rows.at(-1).execution_date ?? rows.at(-1).return_date,
    total_return: round(growth - 1),
    annualized_return: round(growth ** (TRADING_DAYS / rows.length) - 1),
    annualized_volatility: round(deviation === null ? null : deviation * Math.sqrt(TRADING_DAYS)),
    maximum_drawdown: round(maximumDrawdown(returns)),
    spy_total_return: round(spyGrowth - 1),
    bil_total_return: round(bilGrowth - 1),
    total_return_minus_bil: round(growth - bilGrowth),
    cumulative_gross_two_leg_turnover: round(rows.reduce(
      (sum, row) => sum + Number(row.gross_two_leg_turnover ?? 0),
      0,
    )),
    modeled_cost_drag_simple_sum: round(rows.reduce(
      (sum, row) => sum + Number(row.transaction_cost_fraction ?? 0),
      0,
    )),
    rebalance_days: rows.filter((row) => row.rebalanced).length,
    traded_days: rows.filter(
      (row) => Number(row.gross_two_leg_turnover ?? 0) > 1e-12,
    ).length,
  });
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function weights(value, label) {
  exact(value, SYMBOLS, label);
  for (const symbol of SYMBOLS) finite(value[symbol], `${label}.${symbol}`, { minimum: 0, maximum: 1 });
  if (Math.abs(value.SPY + value.BIL - 1) > 1e-12) fail(`${label} must sum to one`);
  return value;
}

function projectionBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "projection_sha256"));
}

function settlementBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "window_sha256"));
}

function normalizedTarget(value, label) {
  weights(value, label);
  return Object.freeze({ SPY: value.SPY, BIL: value.BIL });
}

function projectTargetPoints(commitment) {
  const spy = commitment.payload.acquisition.adjusted_close_rows.SPY;
  const bil = commitment.payload.acquisition.adjusted_close_rows.BIL;
  if (!Array.isArray(spy) || !Array.isArray(bil) || spy.length !== 253 || bil.length !== 253) {
    fail("forward source must contain exactly 253 aligned SPY/BIL adjusted closes");
  }
  return spy.map((row, index) => {
    const cash = bil[index];
    if (row.session_date !== cash?.session_date || row.bar_timestamp !== cash?.bar_timestamp) {
      fail(`forward target inputs are not aligned at index ${index}`);
    }
    return Object.freeze({
      date: isoDate(row.session_date, `target input ${index + 1} date`),
      SPY: positive(row.close, `target input ${index + 1} SPY close`),
      BIL: positive(cash.close, `target input ${index + 1} BIL close`),
    });
  });
}

function normalizedOhlc(bar, expectedDate, label) {
  object(bar, label);
  if (bar.session_date !== expectedDate) fail(`${label} has the wrong session`);
  return Object.freeze({
    date: isoDate(bar.session_date, `${label}.date`),
    open: positive(bar.open, `${label}.open`),
    high: positive(bar.high, `${label}.high`),
    low: positive(bar.low, `${label}.low`),
    close: positive(bar.close, `${label}.close`),
  });
}

function projectFinalTwoOhlc(commitment, book) {
  const source = commitment.payload.acquisition.source[book];
  const result = {};
  for (const symbol of SYMBOLS) {
    const evidence = source.provenance_by_symbol[symbol];
    const bars = evidence.bars;
    if (!Array.isArray(bars) || bars.length !== 253) {
      fail(`${book} ${symbol} source does not contain exactly 253 bars`);
    }
    const finalTwo = bars.slice(-2);
    result[symbol] = Object.freeze(finalTwo.map((bar) => normalizedOhlc(
      bar,
      bar.session_date,
      `${book} ${symbol} outcome bar`,
    )));
  }
  const dates = result.SPY.map(({ date }) => date);
  if (!same(dates, result.BIL.map(({ date }) => date))) {
    fail(`${book} SPY/BIL final-two outcome sessions are not aligned`);
  }
  return Object.freeze({
    dates: Object.freeze(dates),
    SPY: result.SPY,
    BIL: result.BIL,
    source_response_content_sha256: digest(
      source.response_content_sha256,
      `${book} response-content hash`,
    ),
    source_request_parameters_sha256: digest(
      source.request_parameters_sha256,
      `${book} request-parameters hash`,
    ),
    spy_content_sha256: digest(
      source.provenance_by_symbol.SPY.content_hash,
      `${book} SPY content hash`,
    ),
    bil_content_sha256: digest(
      source.provenance_by_symbol.BIL.content_hash,
      `${book} BIL content hash`,
    ),
  });
}

function validateForwardSourceEvidence({
  commitment,
  anchor,
  forwardReceipt,
  previousCommitment,
}) {
  validateGitHubPublicationReceipt(forwardReceipt);
  const activation = validateForwardTrialLiveActivation(
    forwardReceipt.frozen_context.activation,
  );
  validateForwardTrialLiveCommitment(commitment, { activation, previousCommitment });
  validateForwardTrialLiveAnchorManifest(anchor, commitment, { activation, previousCommitment });
  if (forwardReceipt.commitment_sequence !== commitment.sequence
    || forwardReceipt.manifest_sha256 !== anchor.manifest_sha256
    || !same(forwardReceipt.anchor_at_head, anchor)
    || !same(forwardReceipt.public_anchor_chain.at(-1), anchor)
    || forwardReceipt.anchor_at_head.private_bundle_sha256 !== commitment.commitment_sha256) {
    fail("Attempt 115 forward receipt does not bind the exact source commitment and anchor");
  }
  return forwardReceipt;
}

export function buildAttempt115ValidatedSourceProjection({
  commitment,
  anchor,
  forwardReceipt,
  strictOpenReceipt,
  previousCommitment = null,
}) {
  validateForwardSourceEvidence({ commitment, anchor, forwardReceipt, previousCommitment });
  const targetEligible = commitment.sequence <= ATTEMPT115_REQUIRED_INTERVALS;
  if (targetEligible) {
    validateAttempt115ForwardAnchorAssuranceReceipt(strictOpenReceipt, {
      commitment,
      previousCommitment,
      anchor,
      forwardReceipt,
    });
  } else if (commitment.sequence === ATTEMPT115_REQUIRED_SOURCE_BUNDLES
    && strictOpenReceipt !== null && strictOpenReceipt !== undefined) {
    fail("Attempt 115 outcome-only source 253 must not claim strict-open input assurance");
  }
  const acquisition = commitment.payload.acquisition;
  const points = projectTargetPoints(commitment);
  const sourceProjection = buildAttempt115SettlementSourceProjection(commitment);
  validateAttempt115SettlementSourceProjection(sourceProjection);
  const decision = targetEligible
    ? buildAttempt115PairedPolicyDecision({
      acquisition,
      commitmentSequence: commitment.sequence,
    })
    : null;
  if (decision !== null) {
    validateAttempt115PairedPolicyDecision(decision, {
      acquisition,
      commitmentSequence: commitment.sequence,
    });
  }
  const body = {
    schema_version: ATTEMPT115_SOURCE_PROJECTION_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    sequence: commitment.sequence,
    source_role: targetEligible ? "TARGET_AND_OUTCOME_SOURCE" : "OUTCOME_ONLY_SOURCE",
    signal_session_date: acquisition.session.session_date,
    next_session_date: acquisition.session.next_session_date,
    next_market_open_at: acquisition.session.next_market_open_at,
    source: {
      forward_trial_id: commitment.trial_id,
      private_bundle_sha256: commitment.commitment_sha256,
      previous_private_bundle_sha256: commitment.previous_commitment_sha256,
      forward_anchor_manifest_sha256: anchor.manifest_sha256,
      forward_receipt_sha256: forwardReceipt.receipt_sha256,
      strict_open_receipt_sha256: strictOpenReceipt?.receipt_sha256 ?? null,
      acquisition_sha256: acquisition.acquisition_sha256,
      settlement_source_projection_sha256: sourceProjection.projection_sha256,
    },
    target_input_points: points,
    target_input_points_sha256: sha256(points),
    paired_policy_decision: decision,
    policy_targets: decision === null ? null : {
      [ATTEMPT115_INCUMBENT_POLICY_ID]: normalizedTarget(
        decision.policies[ATTEMPT115_INCUMBENT_POLICY_ID],
        "incumbent target",
      ),
      [ATTEMPT115_CHALLENGER_POLICY_ID]: normalizedTarget(
        decision.policies[ATTEMPT115_CHALLENGER_POLICY_ID],
        "challenger target",
      ),
    },
    policy_target_diagnostics_sha256: decision === null ? null : {
      [ATTEMPT115_INCUMBENT_POLICY_ID]: sha256(
        decision.policies[ATTEMPT115_INCUMBENT_POLICY_ID].diagnostics,
      ),
      [ATTEMPT115_CHALLENGER_POLICY_ID]: sha256(
        decision.policies[ATTEMPT115_CHALLENGER_POLICY_ID].diagnostics,
      ),
    },
    outcome_ohlc: {
      adjusted: projectFinalTwoOhlc(commitment, "adjusted"),
      raw: projectFinalTwoOhlc(commitment, "raw"),
    },
    authority: { ...AUTHORITY },
  };
  return deepFreeze(validateAttempt115SourceProjection({
    ...body,
    projection_sha256: sha256(body),
  }));
}

export function validateAttempt115SourceProjection(value) {
  exact(value, [
    "schema_version", "attempt_id", "protocol_sha256", "sequence", "source_role",
    "signal_session_date", "next_session_date", "next_market_open_at", "source",
    "target_input_points", "target_input_points_sha256", "paired_policy_decision", "policy_targets",
    "policy_target_diagnostics_sha256", "outcome_ohlc", "authority", "projection_sha256",
  ], "Attempt 115 source projection");
  if (value.schema_version !== ATTEMPT115_SOURCE_PROJECTION_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || value.protocol_sha256 !== ATTEMPT115_PROTOCOL_SHA256
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 1
    || value.sequence > ATTEMPT115_REQUIRED_SOURCE_BUNDLES) {
    fail("Attempt 115 source projection envelope is invalid");
  }
  const targetEligible = value.sequence <= ATTEMPT115_REQUIRED_INTERVALS;
  if (value.source_role !== (targetEligible
    ? "TARGET_AND_OUTCOME_SOURCE"
    : "OUTCOME_ONLY_SOURCE")) {
    fail("Attempt 115 source role differs from its frozen sequence role");
  }
  isoDate(value.signal_session_date, "source projection signal session");
  isoDate(value.next_session_date, "source projection next session");
  instant(value.next_market_open_at, "source projection next market open");
  if (value.next_market_open_at.slice(0, 10) !== value.next_session_date) {
    fail("source projection next-market-open session is inconsistent");
  }
  exact(value.source, [
    "forward_trial_id", "private_bundle_sha256", "previous_private_bundle_sha256",
    "forward_anchor_manifest_sha256", "forward_receipt_sha256",
    "strict_open_receipt_sha256", "acquisition_sha256",
    "settlement_source_projection_sha256",
  ], "source projection binding");
  if (value.source.forward_trial_id !== "finly_forward_trial_live_1a") {
    fail("source projection changes the forward trial");
  }
  for (const [key, item] of Object.entries(value.source).filter(
    ([key]) => key !== "forward_trial_id" && key !== "strict_open_receipt_sha256",
  )) {
    digest(item, `source projection ${key}`);
  }
  if (targetEligible) {
    digest(value.source.strict_open_receipt_sha256, "source projection strict-open receipt hash");
  } else if (value.source.strict_open_receipt_sha256 !== null) {
    fail("Attempt 115 outcome-only source must have no strict-open input receipt");
  }
  if (!Array.isArray(value.target_input_points) || value.target_input_points.length !== 253) {
    fail("source projection must retain exactly 253 target input points");
  }
  let priorDate = "";
  value.target_input_points.forEach((point, index) => {
    exact(point, ["date", "SPY", "BIL"], `target input point ${index + 1}`);
    const date = isoDate(point.date, `target input point ${index + 1} date`);
    if (date <= priorDate) fail("target input points are duplicated or out of order");
    priorDate = date;
    positive(point.SPY, `target input point ${index + 1} SPY`);
    positive(point.BIL, `target input point ${index + 1} BIL`);
  });
  if (value.target_input_points.at(-1).date !== value.signal_session_date) {
    fail("source projection target inputs do not end at the signal session");
  }
  digest(value.target_input_points_sha256, "target-input hash");
  if (value.target_input_points_sha256 !== sha256(value.target_input_points)) {
    fail("source projection target-input hash is invalid");
  }
  const replayAcquisition = {
    adjusted_close_rows: {
      SPY: value.target_input_points.map((point) => ({
        session_date: point.date,
        close: point.SPY,
      })),
      BIL: value.target_input_points.map((point) => ({
        session_date: point.date,
        close: point.BIL,
      })),
    },
    session: { session_date: value.signal_session_date },
  };
  if (targetEligible) {
    validateAttempt115PairedPolicyDecision(value.paired_policy_decision, {
      acquisition: replayAcquisition,
      commitmentSequence: value.sequence,
    });
    const expectedTargets = value.paired_policy_decision.policies;
    exact(value.policy_targets, [
      ATTEMPT115_INCUMBENT_POLICY_ID,
      ATTEMPT115_CHALLENGER_POLICY_ID,
    ], "source projection policy targets");
    for (const policyId of Object.keys(expectedTargets)) {
      weights(value.policy_targets[policyId], `source projection target ${policyId}`);
      if (!same(value.policy_targets[policyId], {
        SPY: expectedTargets[policyId].SPY,
        BIL: expectedTargets[policyId].BIL,
      })) {
        fail(`source projection target override detected for ${policyId}`);
      }
    }
    exact(value.policy_target_diagnostics_sha256, Object.keys(expectedTargets),
      "source projection target diagnostics hashes");
    for (const policyId of Object.keys(expectedTargets)) {
      digest(value.policy_target_diagnostics_sha256[policyId], `${policyId} diagnostics hash`);
      if (value.policy_target_diagnostics_sha256[policyId]
        !== sha256(expectedTargets[policyId].diagnostics)) {
        fail(`source projection diagnostics changed for ${policyId}`);
      }
    }
  } else if (value.paired_policy_decision !== null
    || value.policy_targets !== null
    || value.policy_target_diagnostics_sha256 !== null) {
    fail("Attempt 115 outcome-only source 253 must not contain a policy target");
  }
  exact(value.outcome_ohlc, EXECUTION_BOOKS, "source projection outcome OHLC");
  for (const book of EXECUTION_BOOKS) {
    const outcome = value.outcome_ohlc[book];
    exact(outcome, [
      "dates", "SPY", "BIL", "source_response_content_sha256",
      "source_request_parameters_sha256", "spy_content_sha256", "bil_content_sha256",
    ], `${book} outcome OHLC`);
    if (!Array.isArray(outcome.dates) || outcome.dates.length !== 2
      || !Array.isArray(outcome.SPY) || outcome.SPY.length !== 2
      || !Array.isArray(outcome.BIL) || outcome.BIL.length !== 2) {
      fail(`${book} outcome OHLC must contain exactly two aligned sessions`);
    }
    for (const [index, expectedDate] of outcome.dates.entries()) {
      isoDate(expectedDate, `${book} outcome date ${index + 1}`);
      for (const symbol of SYMBOLS) {
        exact(outcome[symbol][index], ["date", "open", "high", "low", "close"],
          `${book} ${symbol} outcome bar ${index + 1}`);
        if (outcome[symbol][index].date !== expectedDate) {
          fail(`${book} outcome OHLC is not aligned`);
        }
        for (const key of ["open", "high", "low", "close"]) {
          positive(outcome[symbol][index][key], `${book} ${symbol} ${key}`);
        }
      }
    }
    for (const key of [
      "source_response_content_sha256", "source_request_parameters_sha256",
      "spy_content_sha256", "bil_content_sha256",
    ]) digest(outcome[key], `${book} outcome ${key}`);
  }
  exact(value.authority, Object.keys(AUTHORITY), "source projection authority");
  if (!same(value.authority, AUTHORITY)) fail("source projection crosses its authority boundary");
  digest(value.projection_sha256, "source projection hash");
  if (value.projection_sha256 !== sha256(projectionBody(value))) {
    fail("source projection self-hash is invalid");
  }
  return value;
}

function cadenceDue(sequence, anchor) {
  return ((sequence - 1 - anchor) % 5 + 5) % 5 === 0;
}

function priceTriplet(source, book, symbol, signalDate, executionDate) {
  const outcome = source.outcome_ohlc[book];
  if (!same(outcome.dates, [signalDate, executionDate])) {
    fail(`${book} outcome vintage does not cover the exact signal/execution pair`);
  }
  const prior = outcome[symbol][0];
  const current = outcome[symbol][1];
  return { signal_close: prior.close, execution_open: current.open, execution_close: current.close };
}

function nextOpenRow({
  policyId,
  sequence,
  targetSource,
  outcomeSource,
  book,
  anchor,
  costBps,
  priorWeights,
}) {
  const signalDate = targetSource.signal_session_date;
  const executionDate = outcomeSource.signal_session_date;
  const spy = priceTriplet(outcomeSource, book, "SPY", signalDate, executionDate);
  const bil = priceTriplet(outcomeSource, book, "BIL", signalDate, executionDate);
  const spyOvernight = positive(spy.execution_open / spy.signal_close, "SPY overnight growth");
  const bilOvernight = positive(bil.execution_open / bil.signal_close, "BIL overnight growth");
  const overnightGrowth = positive(
    priorWeights.SPY * spyOvernight + priorWeights.BIL * bilOvernight,
    "portfolio overnight growth",
  );
  const openWeights = {
    SPY: priorWeights.SPY * spyOvernight / overnightGrowth,
    BIL: priorWeights.BIL * bilOvernight / overnightGrowth,
  };
  const rebalanced = cadenceDue(sequence, anchor);
  const target = rebalanced
    ? targetSource.policy_targets[policyId]
    : openWeights;
  weights(target, `${policyId} execution target`);
  const traded = {
    SPY: Math.abs(target.SPY - openWeights.SPY),
    BIL: Math.abs(target.BIL - openWeights.BIL),
  };
  const turnover = traded.SPY + traded.BIL;
  const costByLeg = {
    SPY: traded.SPY * costBps / 10_000,
    BIL: traded.BIL * costBps / 10_000,
  };
  const transactionCost = costByLeg.SPY + costByLeg.BIL;
  const intraday = {
    SPY: positive(spy.execution_close / spy.execution_open, "SPY intraday growth"),
    BIL: positive(bil.execution_close / bil.execution_open, "BIL intraday growth"),
  };
  const intradayGrowth = positive(
    target.SPY * intraday.SPY + target.BIL * intraday.BIL,
    "portfolio intraday growth",
  );
  if (!(transactionCost < 1)) fail("modeled transaction cost is not a valid return fraction");
  const netGrowth = positive(
    overnightGrowth * (1 - transactionCost) * intradayGrowth,
    "portfolio net growth",
  );
  const closingWeights = {
    SPY: target.SPY * intraday.SPY / intradayGrowth,
    BIL: target.BIL * intraday.BIL / intradayGrowth,
  };
  weights(closingWeights, `${policyId} closing weights`);
  const row = Object.freeze({
    policy_id: policyId,
    sequence,
    signal_date: signalDate,
    execution_date: executionDate,
    execution_book: book,
    rebalance_anchor: anchor,
    one_way_cost_bps: costBps,
    rebalanced,
    preclose_weights: Object.freeze({ ...priorWeights }),
    open_drifted_weights: Object.freeze(openWeights),
    committed_formula_target: Object.freeze({ ...targetSource.policy_targets[policyId] }),
    execution_target_weights: Object.freeze({ ...target }),
    absolute_traded_leg_weights: Object.freeze(traded),
    absolute_traded_leg_cost_returns: Object.freeze(costByLeg),
    gross_two_leg_turnover: round(turnover, 12),
    transaction_cost_fraction: round(transactionCost, 12),
    net_return: round(netGrowth - 1, 12),
    spy_return: round(spy.execution_close / spy.signal_close - 1, 12),
    bil_return: round(bil.execution_close / bil.signal_close - 1, 12),
    close_spy_weight: round(closingWeights.SPY),
    close_bil_weight: round(closingWeights.BIL),
    target_source_projection_sha256: targetSource.projection_sha256,
    outcome_source_projection_sha256: outcomeSource.projection_sha256,
  });
  return Object.freeze({
    row,
    nextWeights: Object.freeze(closingWeights),
  });
}

function metricsRow(row) {
  return {
    signal_date: row.signal_date,
    execution_date: row.execution_date,
    rebalanced: row.rebalanced,
    target_spy_weight: row.execution_target_weights.SPY,
    close_spy_weight: row.close_spy_weight,
    gross_two_leg_turnover: row.gross_two_leg_turnover,
    transaction_cost_fraction: row.transaction_cost_fraction,
    net_return: row.net_return,
    spy_return: row.spy_return,
    bil_return: row.bil_return,
  };
}

function validateSourceChain(sources) {
  if (!Array.isArray(sources) || sources.length !== ATTEMPT115_REQUIRED_SOURCE_BUNDLES) {
    fail(`Attempt 115 requires exactly ${ATTEMPT115_REQUIRED_SOURCE_BUNDLES} validated source bundles`);
  }
  sources.forEach((source, index) => {
    validateAttempt115SourceProjection(source);
    const expectedSequence = index + 1;
    if (source.sequence !== expectedSequence) {
      fail(`Attempt 115 source sequence ${expectedSequence} is missing, duplicated, or reordered`);
    }
    if (index === 0) {
      if (source.signal_session_date !== ATTEMPT115_FIRST_SIGNAL_SESSION
        || source.source.previous_private_bundle_sha256
          !== ATTEMPT115_ACTIVATION.upstream_capture.activation.activation_sha256) {
        fail("Attempt 115 source chain does not begin at the frozen first signal");
      }
    } else {
      const previous = sources[index - 1];
      if (source.signal_session_date !== previous.next_session_date
        || source.source.previous_private_bundle_sha256
          !== previous.source.private_bundle_sha256) {
        fail("Attempt 115 source chain skips, backfills, forks, or rewrites a commitment");
      }
    }
  });
  if (sources[1].signal_session_date !== ATTEMPT115_FIRST_EXECUTION_SESSION) {
    fail("Attempt 115 source chain misses the registered first execution session");
  }
  return sources;
}

export function buildAttempt115PairedSettlementWindow({ sources }) {
  exact({ sources }, ["sources"], "Attempt 115 settlement input");
  validateSourceChain(sources);
  const cells = [];
  for (const book of EXECUTION_BOOKS) {
    for (const anchor of CADENCE_ANCHORS) {
      for (const costBps of COST_STRESS_BPS) {
        const rows = {
          [ATTEMPT115_INCUMBENT_POLICY_ID]: [],
          [ATTEMPT115_CHALLENGER_POLICY_ID]: [],
        };
        const state = {
          [ATTEMPT115_INCUMBENT_POLICY_ID]: { SPY: 0, BIL: 1 },
          [ATTEMPT115_CHALLENGER_POLICY_ID]: { SPY: 0, BIL: 1 },
        };
        for (let index = 0; index < ATTEMPT115_REQUIRED_INTERVALS; index += 1) {
          const sequence = index + 1;
          const targetSource = sources[index];
          const outcomeSource = sources[index + 1];
          for (const policyId of Object.keys(rows)) {
            const { row, nextWeights } = nextOpenRow({
              policyId,
              sequence,
              targetSource,
              outcomeSource,
              book,
              anchor,
              costBps,
              priorWeights: state[policyId],
            });
            rows[policyId].push(row);
            state[policyId] = nextWeights;
          }
        }
        const incumbentRows = rows[ATTEMPT115_INCUMBENT_POLICY_ID];
        const challengerRows = rows[ATTEMPT115_CHALLENGER_POLICY_ID];
        const pairedDailyLogDifferences = incumbentRows.map((incumbent, index) => {
          const challenger = challengerRows[index];
          if (challenger.signal_date !== incumbent.signal_date
            || challenger.execution_date !== incumbent.execution_date
            || challenger.rebalanced !== incumbent.rebalanced
            || challenger.spy_return !== incumbent.spy_return
            || challenger.bil_return !== incumbent.bil_return) {
            fail("Attempt 115 policy ledgers are not exactly paired");
          }
          return Math.log1p(challenger.net_return) - Math.log1p(incumbent.net_return);
        });
        cells.push(deepFreeze({
          cell_id: `${book}_anchor${anchor}_cost${costBps}bps`,
          execution_book: book,
          rebalance_anchor: anchor,
          one_way_cost_bps: costBps,
          rows,
          row_hashes: {
            [ATTEMPT115_INCUMBENT_POLICY_ID]: sha256(incumbentRows),
            [ATTEMPT115_CHALLENGER_POLICY_ID]: sha256(challengerRows),
          },
          metrics: {
            [ATTEMPT115_INCUMBENT_POLICY_ID]: calculateExecutionMetrics(
              incumbentRows.map(metricsRow),
            ),
            [ATTEMPT115_CHALLENGER_POLICY_ID]: calculateExecutionMetrics(
              challengerRows.map(metricsRow),
            ),
          },
          paired_daily_net_log_return_differences: pairedDailyLogDifferences,
          paired_daily_net_log_return_differences_sha256: sha256(pairedDailyLogDifferences),
        }));
      }
    }
  }
  const primary = cells.find((cell) => cell.execution_book === PRIMARY_BOOK
    && cell.rebalance_anchor === PRIMARY_ANCHOR
    && cell.one_way_cost_bps === PRIMARY_COST_BPS);
  if (!primary) fail("Attempt 115 primary cell is missing");
  const sourceHashes = sources.map(({ projection_sha256: hash }) => hash);
  const body = {
    schema_version: ATTEMPT115_SETTLEMENT_WINDOW_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    entry_kind: "COMPLETE_PROSPECTIVE_PAIRED_NEXT_OPEN_ACCOUNTING",
    sample: {
      source_bundles: sources.length,
      target_commitments: ATTEMPT115_REQUIRED_INTERVALS,
      paired_intervals: ATTEMPT115_REQUIRED_INTERVALS,
      first_signal_session: sources[0].signal_session_date,
      first_execution_session: sources[1].signal_session_date,
      last_signal_session: sources[ATTEMPT115_REQUIRED_INTERVALS - 1].signal_session_date,
      last_execution_session: sources.at(-1).signal_session_date,
      no_skips: true,
      no_backfill: true,
      replacement_window_used: false,
      optional_stopping_used: false,
    },
    source_chain: {
      ordered_projection_sha256: sourceHashes,
      ordered_projection_chain_sha256: sha256(sourceHashes),
      targets_rederived_with_zero_overrides: true,
      strict_open_input_receipts: ATTEMPT115_REQUIRED_INTERVALS,
      outcome_only_standard_forward_receipts: 1,
      persisted_provider_session_chain_reconciled: true,
      independent_official_calendar_verified: false,
      structural_validation_is_not_input_bound: true,
      input_bound_reopen_required_for_finalization: true,
    },
    matrix: {
      execution_books: EXECUTION_BOOKS,
      cadence_anchors: CADENCE_ANCHORS,
      one_way_cost_stress_bps: COST_STRESS_BPS,
      cell_count: cells.length,
      policies_per_cell: 2,
    },
    primary_cell_id: primary.cell_id,
    primary_endpoint_values_sha256:
      primary.paired_daily_net_log_return_differences_sha256,
    cells,
    inference: null,
    interim_inference_permitted: false,
    incumbent_modification_or_promotion_permitted: false,
    authority: { ...AUTHORITY },
  };
  return deepFreeze(validateAttempt115PairedSettlementWindow({
    ...body,
    window_sha256: sha256(body),
  }));
}

export function validateAttempt115PairedSettlementWindow(value) {
  exact(value, [
    "schema_version", "attempt_id", "protocol_sha256", "entry_kind", "sample",
    "source_chain", "matrix", "primary_cell_id", "primary_endpoint_values_sha256",
    "cells", "inference", "interim_inference_permitted",
    "incumbent_modification_or_promotion_permitted", "authority", "window_sha256",
  ], "Attempt 115 settlement window");
  if (value.schema_version !== ATTEMPT115_SETTLEMENT_WINDOW_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || value.protocol_sha256 !== ATTEMPT115_PROTOCOL_SHA256
    || value.entry_kind !== "COMPLETE_PROSPECTIVE_PAIRED_NEXT_OPEN_ACCOUNTING") {
    fail("Attempt 115 settlement window envelope is invalid");
  }
  if (value.sample?.source_bundles !== ATTEMPT115_REQUIRED_SOURCE_BUNDLES
    || value.sample?.target_commitments !== ATTEMPT115_REQUIRED_INTERVALS
    || value.sample?.paired_intervals !== ATTEMPT115_REQUIRED_INTERVALS
    || value.sample?.first_signal_session !== ATTEMPT115_FIRST_SIGNAL_SESSION
    || value.sample?.first_execution_session !== ATTEMPT115_FIRST_EXECUTION_SESSION
    || value.sample?.no_skips !== true
    || value.sample?.no_backfill !== true
    || value.sample?.replacement_window_used !== false
    || value.sample?.optional_stopping_used !== false) {
    fail("Attempt 115 settlement sample is incomplete or permits selection");
  }
  if (value.source_chain?.targets_rederived_with_zero_overrides !== true
    || value.source_chain?.strict_open_input_receipts !== ATTEMPT115_REQUIRED_INTERVALS
    || value.source_chain?.outcome_only_standard_forward_receipts !== 1
    || value.source_chain?.persisted_provider_session_chain_reconciled !== true
    || value.source_chain?.independent_official_calendar_verified !== false
    || value.source_chain?.structural_validation_is_not_input_bound !== true
    || value.source_chain?.input_bound_reopen_required_for_finalization !== true
    || !Array.isArray(value.source_chain?.ordered_projection_sha256)
    || value.source_chain.ordered_projection_sha256.length
      !== ATTEMPT115_REQUIRED_SOURCE_BUNDLES
    || value.source_chain.ordered_projection_chain_sha256
      !== sha256(value.source_chain.ordered_projection_sha256)) {
    fail("Attempt 115 source-chain evidence is incomplete");
  }
  for (const item of value.source_chain.ordered_projection_sha256) {
    digest(item, "Attempt 115 source projection hash");
  }
  if (!same(value.matrix, {
    execution_books: EXECUTION_BOOKS,
    cadence_anchors: CADENCE_ANCHORS,
    one_way_cost_stress_bps: COST_STRESS_BPS,
    cell_count: 40,
    policies_per_cell: 2,
  })) fail("Attempt 115 comparison matrix changed");
  if (!Array.isArray(value.cells) || value.cells.length !== 40) {
    fail("Attempt 115 settlement window must contain exactly 40 fixed cells");
  }
  const cellIds = new Set();
  for (const cell of value.cells) {
    if (cellIds.has(cell.cell_id)) fail("Attempt 115 settlement window repeats a cell");
    cellIds.add(cell.cell_id);
    if (!EXECUTION_BOOKS.includes(cell.execution_book)
      || !CADENCE_ANCHORS.includes(cell.rebalance_anchor)
      || !COST_STRESS_BPS.includes(cell.one_way_cost_bps)) {
      fail("Attempt 115 settlement cell escapes the frozen matrix");
    }
    for (const policyId of [ATTEMPT115_INCUMBENT_POLICY_ID, ATTEMPT115_CHALLENGER_POLICY_ID]) {
      const rows = cell.rows?.[policyId];
      if (!Array.isArray(rows) || rows.length !== ATTEMPT115_REQUIRED_INTERVALS
        || cell.row_hashes?.[policyId] !== sha256(rows)) {
        fail(`Attempt 115 ${policyId} ledger is incomplete or changed`);
      }
      rows.forEach((row, index) => {
        if (row.policy_id !== policyId || row.sequence !== index + 1
          || row.execution_book !== cell.execution_book
          || row.rebalance_anchor !== cell.rebalance_anchor
          || row.one_way_cost_bps !== cell.one_way_cost_bps
          || row.rebalanced !== cadenceDue(index + 1, cell.rebalance_anchor)) {
          fail(`Attempt 115 ${policyId} ledger order or cadence changed`);
        }
        weights(row.preclose_weights, `${policyId} preclose weights`);
        weights(row.open_drifted_weights, `${policyId} open weights`);
        weights(row.committed_formula_target, `${policyId} committed target`);
        weights(row.execution_target_weights, `${policyId} execution target`);
        exact(row.absolute_traded_leg_weights, SYMBOLS, `${policyId} traded leg weights`);
        exact(row.absolute_traded_leg_cost_returns, SYMBOLS, `${policyId} leg costs`);
        const turnover = SYMBOLS.reduce(
          (sum, symbol) => sum + row.absolute_traded_leg_weights[symbol],
          0,
        );
        const cost = SYMBOLS.reduce(
          (sum, symbol) => sum + row.absolute_traded_leg_cost_returns[symbol],
          0,
        );
        if (Math.abs(turnover - row.gross_two_leg_turnover) > 2e-12
          || Math.abs(cost - row.transaction_cost_fraction) > 2e-12
          || Math.abs(cost - turnover * cell.one_way_cost_bps / 10_000) > 2e-12
          || row.net_return <= -1) {
          fail(`Attempt 115 ${policyId} ledger cost or return arithmetic is invalid`);
        }
        digest(row.target_source_projection_sha256, `${policyId} target projection hash`);
        digest(row.outcome_source_projection_sha256, `${policyId} outcome projection hash`);
      });
    }
    if (!Array.isArray(cell.paired_daily_net_log_return_differences)
      || cell.paired_daily_net_log_return_differences.length !== ATTEMPT115_REQUIRED_INTERVALS
      || cell.paired_daily_net_log_return_differences_sha256
        !== sha256(cell.paired_daily_net_log_return_differences)) {
      fail("Attempt 115 paired endpoint rows are incomplete or changed");
    }
  }
  const primary = value.cells.find(({ cell_id: id }) => id === value.primary_cell_id);
  if (!primary
    || primary.execution_book !== PRIMARY_BOOK
    || primary.rebalance_anchor !== PRIMARY_ANCHOR
    || primary.one_way_cost_bps !== PRIMARY_COST_BPS
    || value.primary_endpoint_values_sha256
      !== primary.paired_daily_net_log_return_differences_sha256) {
    fail("Attempt 115 primary cell changed");
  }
  if (value.inference !== null
    || value.interim_inference_permitted !== false
    || value.incumbent_modification_or_promotion_permitted !== false) {
    fail("Attempt 115 settlement window runs inference or changes the incumbent prematurely");
  }
  if (!same(value.authority, AUTHORITY)) fail("Attempt 115 settlement crosses its authority boundary");
  digest(value.window_sha256, "Attempt 115 settlement window hash");
  if (value.window_sha256 !== sha256(settlementBody(value))) {
    fail("Attempt 115 settlement window self-hash is invalid");
  }
  return value;
}

export function canonicalAttempt115PairedSettlementWindowJson(value) {
  validateAttempt115PairedSettlementWindow(value);
  return `${stableStringify(value)}\n`;
}

function rebuildAttempt115SourceProjections(sourceRecords) {
  if (!Array.isArray(sourceRecords)
    || sourceRecords.length !== ATTEMPT115_REQUIRED_SOURCE_BUNDLES) {
    fail("Attempt 115 input-bound finalization requires exactly 253 source records");
  }
  let previousCommitment = null;
  const projections = sourceRecords.map((record, index) => {
    exact(record, [
      "commitment", "anchor", "forwardReceipt", "strictOpenReceipt",
    ], `Attempt 115 source record ${index + 1}`);
    const expectedSequence = index + 1;
    if (record.commitment?.sequence !== expectedSequence) {
      fail(`Attempt 115 source record ${expectedSequence} is missing or reordered`);
    }
    if (expectedSequence <= ATTEMPT115_REQUIRED_INTERVALS
      && record.strictOpenReceipt == null) {
      fail(`Attempt 115 source record ${expectedSequence} lacks strict-open assurance`);
    }
    if (expectedSequence === ATTEMPT115_REQUIRED_SOURCE_BUNDLES
      && record.strictOpenReceipt !== null) {
      fail("Attempt 115 outcome-only source 253 must carry a null strict-open receipt");
    }
    const projection = buildAttempt115ValidatedSourceProjection({
      ...record,
      previousCommitment,
    });
    previousCommitment = record.commitment;
    return projection;
  });
  return Object.freeze(projections);
}

/**
 * Final production path. Every projection is rebuilt from the full private
 * commitment, public anchor, v4 forward publication receipt, and (for the
 * first 252 inputs) the exact strict-pre-open assurance receipt.
 */
export function buildAttempt115InputBoundPairedSettlementWindow({ sourceRecords }) {
  exact({ sourceRecords }, ["sourceRecords"], "Attempt 115 input-bound settlement input");
  const sources = rebuildAttempt115SourceProjections(sourceRecords);
  return buildAttempt115PairedSettlementWindow({ sources });
}

export function validateAttempt115PairedSettlementWindowAgainstInputs(
  value,
  { sourceRecords },
) {
  validateAttempt115PairedSettlementWindow(value);
  const rebuilt = buildAttempt115InputBoundPairedSettlementWindow({ sourceRecords });
  if (!same(value, rebuilt)) {
    fail("Attempt 115 settlement window differs from the input-bound full-source replay");
  }
  return value;
}

/**
 * Focused deterministic replay check for already input-bound projections.
 * This is useful for offline audit, but finalization must use the full-input
 * validator above.
 */
export function validateAttempt115PairedSettlementWindowAgainstProjections(
  value,
  { sources },
) {
  validateAttempt115PairedSettlementWindow(value);
  const rebuilt = buildAttempt115PairedSettlementWindow({ sources });
  if (!same(value, rebuilt)) {
    fail("Attempt 115 settlement window differs from its ordered source projections");
  }
  return value;
}
