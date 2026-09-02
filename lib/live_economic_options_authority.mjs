import { sha256 } from "./canonical.mjs";
import { buildEconomicOptionsExecutionGuard as buildFrozenBullishGuard } from "./economic_research.mjs";

function round(value, places = 8) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function receipt(body) {
  return Object.freeze({ ...body, receipt_sha256: sha256(body) });
}

/**
 * Execution-scope overlay for the frozen long-horizon economic receipt. The
 * frozen research module remains byte-identical; this v2 receipt reuses it as
 * an authenticated freshness/risk-on check, then lets fresh price momentum
 * choose a bounded bullish or bearish defined-risk options view.
 */
export function buildLiveEconomicOptionsExecutionGuard(bundle, {
  asOf,
  intentDirection,
  maximumDecisionAgeMinutes = 30,
  minimumDirectionalCapacity = 0.5,
} = {}) {
  if (!new Set(["bullish", "bearish", "neutral"]).has(intentDirection)) {
    throw new TypeError("intentDirection is invalid");
  }
  if (!Number.isFinite(minimumDirectionalCapacity)
    || minimumDirectionalCapacity < 0.5
    || minimumDirectionalCapacity > 1) {
    throw new TypeError("minimumDirectionalCapacity must be between 0.5 and one");
  }
  // Calling the frozen guard with its native bullish direction validates the
  // complete bundle, receipt hashes, point-in-time boundary, freshness, risk
  // committee result, and material economic exposure without changing it.
  const frozenGuard = buildFrozenBullishGuard(bundle, {
    asOf,
    intentDirection: "bullish",
    maximumDecisionAgeMinutes,
  });
  const finalSpyWeight = frozenGuard.final_spy_weight;
  const directionalCapacity = finalSpyWeight === null
    ? null
    : round(0.5 + 0.5 * Math.abs(finalSpyWeight - 0.5));
  const reasons = [...frozenGuard.reason_codes];
  if (directionalCapacity !== null && directionalCapacity < minimumDirectionalCapacity) {
    reasons.push("ECONOMIC_DIRECTIONAL_CAPACITY_BELOW_THRESHOLD");
  }
  if (intentDirection === "neutral") reasons.push("SHORT_HORIZON_DIRECTION_UNAVAILABLE");
  const reasonCodes = [...new Set(reasons)].sort();
  const entryGatePassed = reasonCodes.length === 0;
  return receipt({
    schema_version: "finly_economic_options_execution_guard.v2",
    evaluated_at: frozenGuard.evaluated_at,
    economic_bundle_sha256: frozenGuard.economic_bundle_sha256,
    frozen_guard_receipt_sha256: frozenGuard.receipt_sha256,
    economic_base_receipt_sha256: frozenGuard.economic_base_receipt_sha256,
    economic_committee_receipt_sha256: frozenGuard.economic_committee_receipt_sha256,
    economic_decision_age_minutes: frozenGuard.economic_decision_age_minutes,
    maximum_decision_age_minutes: maximumDecisionAgeMinutes,
    minimum_directional_capacity: minimumDirectionalCapacity,
    directional_capacity: directionalCapacity,
    final_spy_weight: finalSpyWeight,
    option_intent_direction: intentDirection,
    decision: entryGatePassed ? "ALLOW_BOUNDED_DEFINED_RISK_ENTRY_GATE" : "NO_TRADE",
    reason_codes: Object.freeze(reasonCodes),
    entry_gate_passed: entryGatePassed,
    authorization_boundary: Object.freeze({
      broker_mutation_authorized_by_this_guard: false,
      additional_option_certificate_required: true,
      fresh_broker_preflight_required: true,
    }),
  });
}

export function buildLiveEconomicOptionsDirectionAuthority(bundle, {
  asOf,
  maximumDecisionAgeMinutes = 30,
  minimumDirectionalCapacity = 0.5,
} = {}) {
  const guard = buildLiveEconomicOptionsExecutionGuard(bundle, {
    asOf,
    intentDirection: "bullish",
    maximumDecisionAgeMinutes,
    minimumDirectionalCapacity,
  });
  const enabled = guard.entry_gate_passed === true;
  const body = {
    schema_version: "finly_economic_options_direction_authority.v2",
    decision: enabled ? "ALLOW_BOUNDED_DIRECTION" : "NO_TRADE",
    direction: enabled ? "bidirectional" : "neutral",
    maximum_direction_score: enabled ? guard.directional_capacity : 0,
    authority_weight: 0.5,
    economic_bundle_sha256: bundle.artifact_sha256,
    economic_guard_receipt_sha256: guard.receipt_sha256,
    reduction_only: true,
    broker_mutation_authorized: false,
  };
  return Object.freeze({ ...body, authority_sha256: sha256(body) });
}
