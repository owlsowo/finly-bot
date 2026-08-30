import { sha256 } from "../lib/canonical.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
  buildAttempt115PairedPolicyDecision,
} from "../research/prospective_attempt115/policy.mjs";
import { ATTEMPT115_PROTOCOL_SHA256 } from "../research/prospective_attempt115/protocol.mjs";
import activationJson from "../research/forward_trial_live/activation.json" with { type: "json" };
import { newYorkMarketInstant } from "../research/run_forward_trial_live.mjs";
import {
  ATTEMPT115_ID,
  ATTEMPT115_REQUIRED_SOURCE_BUNDLES,
  ATTEMPT115_SOURCE_PROJECTION_SCHEMA,
  validateAttempt115SourceProjection,
} from "../research/prospective_attempt115/settlement.mjs";

const DAY = 86_400_000;

function isWeekday(timestamp) {
  const day = new Date(timestamp).getUTCDay();
  return day >= 1 && day <= 5;
}

function dateAt(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function syntheticDates() {
  const first = Date.parse("2026-08-31T00:00:00.000Z");
  const prior = [];
  let cursor = first;
  while (prior.length < 253) {
    if (isWeekday(cursor)) prior.push(dateAt(cursor));
    cursor -= DAY;
  }
  prior.reverse();
  const later = [];
  cursor = first + DAY;
  while (later.length < ATTEMPT115_REQUIRED_SOURCE_BUNDLES) {
    if (isWeekday(cursor)) later.push(dateAt(cursor));
    cursor += DAY;
  }
  return [...prior, ...later];
}

function closeAt(index, symbol, book = "adjusted") {
  const base = symbol === "SPY" ? 100 : 92;
  const trend = symbol === "SPY" ? 0.00045 : 0.00008;
  const cycle = symbol === "SPY" ? 0.0035 * Math.sin(index / 7.3) : 0.00004 * Math.cos(index / 11);
  const rawAdjustment = book === "raw" ? (symbol === "SPY" ? 0.000001 * index : 0.0000003 * index) : 0;
  return base * Math.exp(trend * index + cycle + rawAdjustment);
}

function ohlcAt(index, symbol, book) {
  const close = closeAt(index, symbol, book);
  const open = close / (1 + (symbol === "SPY" ? 0.0015 * Math.sin(index / 4.1) : 0.00003));
  return Object.freeze({
    date: SYNTHETIC_DATES[index],
    open,
    high: Math.max(open, close) * 1.002,
    low: Math.min(open, close) * 0.998,
    close,
  });
}

function outcomeBook(signalIndex, book) {
  const SPY = Object.freeze([
    ohlcAt(signalIndex - 1, "SPY", book),
    ohlcAt(signalIndex, "SPY", book),
  ]);
  const BIL = Object.freeze([
    ohlcAt(signalIndex - 1, "BIL", book),
    ohlcAt(signalIndex, "BIL", book),
  ]);
  const dates = Object.freeze(SPY.map(({ date }) => date));
  return Object.freeze({
    dates,
    SPY,
    BIL,
    source_response_content_sha256: sha256({ book, signalIndex, kind: "response" }),
    source_request_parameters_sha256: sha256({ book, signalIndex, kind: "request" }),
    spy_content_sha256: sha256({ book, signalIndex, symbol: "SPY" }),
    bil_content_sha256: sha256({ book, signalIndex, symbol: "BIL" }),
  });
}

export const SYNTHETIC_DATES = Object.freeze(syntheticDates());

export function makeAttempt115SourceProjections() {
  const result = [];
  let priorPrivate = activationJson.activation_sha256;
  for (let index = 0; index < ATTEMPT115_REQUIRED_SOURCE_BUNDLES; index += 1) {
    const sequence = index + 1;
    const signalIndex = 252 + index;
    const signalSession = SYNTHETIC_DATES[signalIndex];
    const nextSession = SYNTHETIC_DATES[signalIndex + 1];
    const points = Object.freeze(SYNTHETIC_DATES.slice(signalIndex - 252, signalIndex + 1)
      .map((date, pointIndex) => {
        const globalIndex = signalIndex - 252 + pointIndex;
        return Object.freeze({
          date,
          SPY: closeAt(globalIndex, "SPY"),
          BIL: closeAt(globalIndex, "BIL"),
        });
      }));
    const acquisition = {
      adjusted_close_rows: {
        SPY: points.map((point) => ({ session_date: point.date, close: point.SPY })),
        BIL: points.map((point) => ({ session_date: point.date, close: point.BIL })),
      },
      session: { session_date: signalSession },
    };
    const decision = sequence <= 252
      ? buildAttempt115PairedPolicyDecision({ acquisition, commitmentSequence: sequence })
      : null;
    const privateHash = sha256({ schema: "synthetic-private", sequence, signalSession });
    const body = {
      schema_version: ATTEMPT115_SOURCE_PROJECTION_SCHEMA,
      attempt_id: ATTEMPT115_ID,
      protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
      sequence,
      source_role: sequence <= 252 ? "TARGET_AND_OUTCOME_SOURCE" : "OUTCOME_ONLY_SOURCE",
      signal_session_date: signalSession,
      next_session_date: nextSession,
      next_market_open_at: newYorkMarketInstant(nextSession, "09:30:00"),
      source: {
        forward_trial_id: "finly_forward_trial_live_1a",
        private_bundle_sha256: privateHash,
        previous_private_bundle_sha256: priorPrivate,
        forward_anchor_manifest_sha256: sha256({ schema: "synthetic-anchor", sequence }),
        forward_receipt_sha256: sha256({ schema: "synthetic-forward-receipt", sequence }),
        strict_open_receipt_sha256: sequence <= 252
          ? sha256({ schema: "synthetic-strict-open", sequence })
          : null,
        acquisition_sha256: sha256({ schema: "synthetic-acquisition", sequence }),
        settlement_source_projection_sha256: sha256({
          schema: "synthetic-settlement-source-projection",
          sequence,
        }),
      },
      target_input_points: points,
      target_input_points_sha256: sha256(points),
      paired_policy_decision: decision,
      policy_targets: decision === null ? null : {
        [ATTEMPT115_INCUMBENT_POLICY_ID]: {
          SPY: decision.policies[ATTEMPT115_INCUMBENT_POLICY_ID].SPY,
          BIL: decision.policies[ATTEMPT115_INCUMBENT_POLICY_ID].BIL,
        },
        [ATTEMPT115_CHALLENGER_POLICY_ID]: {
          SPY: decision.policies[ATTEMPT115_CHALLENGER_POLICY_ID].SPY,
          BIL: decision.policies[ATTEMPT115_CHALLENGER_POLICY_ID].BIL,
        },
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
        adjusted: outcomeBook(signalIndex, "adjusted"),
        raw: outcomeBook(signalIndex, "raw"),
      },
      authority: {
        research_only: true,
        broker_mutation_authorized: false,
        order_payload: null,
        performance_inference_permitted: false,
      },
    };
    const projection = Object.freeze({ ...body, projection_sha256: sha256(body) });
    validateAttempt115SourceProjection(projection);
    result.push(projection);
    priorPrivate = privateHash;
  }
  return Object.freeze(result);
}

export function rehashProjection(value) {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "projection_sha256"),
  );
  return { ...value, projection_sha256: sha256(body) };
}
