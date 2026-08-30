import { sha256, stableStringify } from "../../lib/canonical.mjs";
import {
  ATTEMPT115_ID,
  ATTEMPT115_PROTOCOL_SHA256,
} from "./protocol.mjs";

export const ATTEMPT115_POLICY_COMPILER_SCHEMA =
  "finly_attempt115_deterministic_paired_policy_decision.v1";
export const ATTEMPT115_CHALLENGER_POLICY_ID = "tsmom_ensemble_downside_semivol";
export const ATTEMPT115_INCUMBENT_POLICY_ID = "tsmom_ensemble_vol";
export const ATTEMPT115_REBALANCE_INTERVAL = 5;
export const ATTEMPT115_REBALANCE_ANCHOR = 0;

const TRADING_DAYS = 252;
const TREND_HORIZONS = Object.freeze([21, 63, 252]);
const BASE_LOOKBACK = 20;
const EXTENDED_LOOKBACK = 40;
const MINIMUM_BASE_NEGATIVES = 3;
const TARGET_VOLATILITY = 0.10;

function fail(message) {
  throw new TypeError(message);
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function positive(value, label) {
  const checked = finite(value, label);
  if (!(checked > 0)) fail(`${label} must be positive`);
  return checked;
}

function date(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${label} must be an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be an ISO date`);
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

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + ((value - average) ** 2), 0)
      / (values.length - 1),
  );
}

function validateCloseRows(rows, symbol) {
  if (!Array.isArray(rows) || rows.length !== 253) {
    fail(`${symbol} must contain exactly 253 completed adjusted-close rows`);
  }
  let previous = "";
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      fail(`${symbol} row ${index} must be an object`);
    }
    const sessionDate = date(row.session_date, `${symbol} row ${index} session_date`);
    if (sessionDate <= previous) fail(`${symbol} rows must be strictly chronological`);
    previous = sessionDate;
    return { date: sessionDate, close: positive(row.close, `${symbol} row ${index} close`) };
  });
}

export function attempt115PolicyPointsFromAcquisition(acquisition) {
  if (!acquisition || typeof acquisition !== "object" || Array.isArray(acquisition)) {
    fail("a validated forward acquisition is required");
  }
  const spy = validateCloseRows(acquisition.adjusted_close_rows?.SPY, "SPY");
  const bil = validateCloseRows(acquisition.adjusted_close_rows?.BIL, "BIL");
  const points = spy.map((row, index) => {
    if (row.date !== bil[index].date) fail("SPY and BIL adjusted-close sessions differ");
    return { date: row.date, SPY: row.close, BIL: bil[index].close };
  });
  if (points.at(-1).date !== acquisition.session?.session_date) {
    fail("policy input does not end at the completed signal session");
  }
  return deepFreeze(points);
}

function simpleReturns(points, lookback) {
  const end = points.length - 1;
  const values = [];
  for (let index = end - lookback + 1; index <= end; index += 1) {
    values.push(points[index].SPY / points[index - 1].SPY - 1);
  }
  return values;
}

function trendDiagnostics(points) {
  const end = points.length - 1;
  const excess = Object.fromEntries(TREND_HORIZONS.map((lookback) => {
    const start = end - lookback;
    return [String(lookback),
      Math.log(points[end].SPY / points[start].SPY)
      - Math.log(points[end].BIL / points[start].BIL)];
  }));
  return {
    excess_log_returns: excess,
    positive_trend_fraction:
      Object.values(excess).filter((value) => value > 0).length / TREND_HORIZONS.length,
  };
}

function targetFromVolatility(annualizedVolatility, diagnostics) {
  const scale = Number.isFinite(annualizedVolatility) && annualizedVolatility > 0
    ? Math.min(1, TARGET_VOLATILITY / annualizedVolatility)
    : 0;
  const spy = Math.min(1, Math.max(0, diagnostics.positive_trend_fraction * scale));
  return {
    target_weights: { SPY: spy, BIL: 1 - spy },
    volatility_scale: scale,
  };
}

export function attempt115IncumbentTarget(points) {
  if (!Array.isArray(points) || points.length < 253) fail("incumbent policy lacks 253 points");
  const returns = simpleReturns(points, BASE_LOOKBACK);
  const volatility = sampleStandardDeviation(returns) * Math.sqrt(TRADING_DAYS);
  const trends = trendDiagnostics(points);
  const target = targetFromVolatility(volatility, trends);
  return deepFreeze({
    ...target.target_weights,
    diagnostics: {
      positive_trend_fraction: trends.positive_trend_fraction,
      realized_spy_volatility: volatility,
      volatility_scale: target.volatility_scale,
      excess_log_returns: trends.excess_log_returns,
    },
  });
}

export function attempt115DownsideSemivolatilityTarget(points) {
  if (!Array.isArray(points) || points.length < 253) fail("challenger policy lacks 253 points");
  const latest40 = simpleReturns(points, EXTENDED_LOOKBACK);
  const latest20 = latest40.slice(-BASE_LOOKBACK);
  const baseNegativeCount = latest20.filter((value) => value < 0).length;
  const selectedLookback = baseNegativeCount < MINIMUM_BASE_NEGATIVES
    ? EXTENDED_LOOKBACK
    : BASE_LOOKBACK;
  const selected = latest40.slice(-selectedLookback);
  const negative = selected.filter((value) => value < 0);
  const downsideBeforeFallback = Math.sqrt(
    (2 * TRADING_DAYS / selectedLookback)
      * negative.reduce((sum, value) => sum + (value ** 2), 0),
  );
  const fallbackUsed = selectedLookback === EXTENDED_LOOKBACK
    && (downsideBeforeFallback === 0 || !Number.isFinite(downsideBeforeFallback));
  const volatility = fallbackUsed
    ? sampleStandardDeviation(latest20) * Math.sqrt(TRADING_DAYS)
    : downsideBeforeFallback;
  const trends = trendDiagnostics(points);
  const target = targetFromVolatility(volatility, trends);
  return deepFreeze({
    ...target.target_weights,
    diagnostics: {
      positive_trend_fraction: trends.positive_trend_fraction,
      selected_annualized_spy_volatility: volatility,
      volatility_scale: target.volatility_scale,
      downside_semivolatility: {
        annualized_volatility: volatility,
        selected_lookback_sessions: selectedLookback,
        base_negative_return_count: baseNegativeCount,
        selected_negative_return_count: negative.length,
        downside_semivolatility_before_fallback: downsideBeforeFallback,
        incumbent_total_volatility_fallback_used: fallbackUsed,
        fallback_reason: fallbackUsed
          ? (downsideBeforeFallback === 0
            ? "EXTENDED_40_SESSION_VALUE_ZERO"
            : "EXTENDED_40_SESSION_VALUE_NONFINITE")
          : null,
      },
      excess_log_returns: trends.excess_log_returns,
    },
  });
}

function decisionBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "decision_sha256"));
}

export function buildAttempt115PairedPolicyDecision({ acquisition, commitmentSequence }) {
  if (!Number.isSafeInteger(commitmentSequence)
    || commitmentSequence < 1 || commitmentSequence > 252) {
    fail("Attempt 115 commitment sequence must be 1 through 252");
  }
  const points = attempt115PolicyPointsFromAcquisition(acquisition);
  const incumbent = attempt115IncumbentTarget(points);
  const challenger = attempt115DownsideSemivolatilityTarget(points);
  const rebalanceDue = (commitmentSequence - 1) % ATTEMPT115_REBALANCE_INTERVAL
    === ATTEMPT115_REBALANCE_ANCHOR;
  const body = {
    schema_version: ATTEMPT115_POLICY_COMPILER_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    commitment_sequence: commitmentSequence,
    signal_session_date: points.at(-1).date,
    information_set_end_session: points.at(-1).date,
    adjusted_close_rows_consumed: points.length,
    rebalance_schedule: {
      interval_sessions: ATTEMPT115_REBALANCE_INTERVAL,
      anchor: ATTEMPT115_REBALANCE_ANCHOR,
      rebalance_due: rebalanceDue,
      action: rebalanceDue ? "REBALANCE" : "HOLD",
    },
    policies: {
      [ATTEMPT115_INCUMBENT_POLICY_ID]: incumbent,
      [ATTEMPT115_CHALLENGER_POLICY_ID]: challenger,
    },
    authority: {
      research_only: true,
      order_payload: null,
      broker_mutation_authorized: false,
    },
  };
  return deepFreeze({ ...body, decision_sha256: sha256(body) });
}

export function validateAttempt115PairedPolicyDecision(value, input) {
  const expected = buildAttempt115PairedPolicyDecision(input);
  if (sha256(decisionBody(value)) !== value?.decision_sha256
    || stableStringify(value) !== stableStringify(expected)) {
    fail("Attempt 115 paired decision is not the frozen deterministic replay");
  }
  return value;
}
