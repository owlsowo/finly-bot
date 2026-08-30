import { sha256 } from "./canonical.mjs";
import { FAMILY_BASE_WEIGHTS, POLICY } from "./policy.mjs";
import { validateIntent, validateSourceSignal } from "./schema.mjs";

export function effectiveWeight(signal) {
  validateSourceSignal(signal);
  return FAMILY_BASE_WEIGHTS[signal.family]
    * signal.quality
    * signal.freshness
    * signal.calibration
    * signal.independence;
}

export function assertEvidenceSeparation(signals) {
  const seenEvidence = new Map();
  const seenDuplicateGroups = new Map();
  const seenOrigins = new Map();
  for (const signal of signals) {
    for (const record of signal.evidence) {
      for (const [value, seen, label] of [
        [record.evidence_id, seenEvidence, "evidence ID"],
        [record.duplicate_group, seenDuplicateGroups, "duplicate group"],
        [record.origin_id, seenOrigins, "origin"],
      ]) {
        const priorFamily = seen.get(value);
        if (priorFamily && priorFamily !== signal.family) throw new Error(`cross-family ${label} overlap violates provenance separation`);
        seen.set(value, signal.family);
      }
    }
  }
  return true;
}

function validateEconomicDirectionAuthority(authority) {
  if (authority === null || authority === undefined) return null;
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
    throw new TypeError("economic direction authority must be an object");
  }
  const expected = [
    "schema_version",
    "decision",
    "direction",
    "maximum_direction_score",
    "authority_weight",
    "economic_bundle_sha256",
    "economic_guard_receipt_sha256",
    "reduction_only",
    "broker_mutation_authorized",
    "authority_sha256",
  ].sort();
  const actual = Object.keys(authority).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError("economic direction authority contains missing or unknown fields");
  }
  const { authority_sha256: authoritySha256, ...body } = authority;
  if (authority.schema_version !== "finly_economic_options_direction_authority.v1"
    || authoritySha256 !== sha256(body)) {
    throw new TypeError("economic direction authority hash is invalid");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(authority.economic_bundle_sha256)
    || !/^sha256:[a-f0-9]{64}$/.test(authority.economic_guard_receipt_sha256)) {
    throw new TypeError("economic direction authority is not bound to checked receipts");
  }
  if (authority.reduction_only !== true || authority.broker_mutation_authorized !== false) {
    throw new TypeError("economic direction authority crosses its authorization boundary");
  }
  if (!Number.isFinite(authority.maximum_direction_score)
    || authority.maximum_direction_score < 0
    || authority.maximum_direction_score > 1
    || !Number.isFinite(authority.authority_weight)
    || authority.authority_weight <= 0
    || authority.authority_weight > 1) {
    throw new TypeError("economic direction authority contains invalid bounds");
  }
  const enabled = authority.decision === "ALLOW_BULLISH_DIRECTION_ONLY"
    && authority.direction === "bullish"
    && authority.maximum_direction_score > 0;
  const disabled = authority.decision === "NO_TRADE"
    && authority.direction === "neutral"
    && authority.maximum_direction_score === 0;
  if (!enabled && !disabled) throw new TypeError("economic direction authority state is invalid");
  return authority;
}

function aggregateUnderEconomicAuthority(rows, valid, authority, {
  underlying,
  horizonSessions,
}) {
  // The event family is the only live family whose score may come from the
  // local language model. It is excluded from the forecast inputs and can
  // only subtract from the deterministic market/options support below.
  const deterministicRows = rows.filter((row) => row.family !== "events");
  const deterministicWeight = deterministicRows.reduce((sum, row) => sum + row.weight, 0);
  const deterministicDirection = deterministicWeight === 0 ? 0 : deterministicRows.reduce(
    (sum, row) => sum + row.weight * row.direction,
    0,
  ) / deterministicWeight;
  const deterministicVolatility = deterministicWeight === 0 ? 0 : deterministicRows.reduce(
    (sum, row) => sum + row.weight * row.volatility,
    0,
  ) / deterministicWeight;
  const directionalWeight = deterministicRows.reduce((sum, row) => sum + row.weight * Math.abs(row.direction), 0);
  const supportiveWeight = deterministicRows.reduce(
    (sum, row) => sum + (row.direction > 0 ? row.weight * Math.abs(row.direction) : 0),
    0,
  );
  const deterministicAgreement = directionalWeight === 0 ? 0 : supportiveWeight / directionalWeight;
  const modelRiskPenalty = rows.filter((row) => row.family === "events" && row.direction < 0).reduce(
    (sum, row) => sum + (-row.direction) * row.weight / FAMILY_BASE_WEIGHTS.events,
    0,
  );
  const modelRiskMultiplier = clip(1 - modelRiskPenalty, 0, 1);
  const supportedDirectionScore = authority.direction === "bullish"
    ? Math.min(authority.maximum_direction_score, Math.max(0, deterministicDirection)) * modelRiskMultiplier
    : 0;
  const direction = supportedDirectionScore < POLICY.directionThreshold ? "neutral" : "bullish";
  const activeWeight = Math.min(1, authority.authority_weight + deterministicWeight);
  return validateIntent({
    schema_version: "finly_intent.v1",
    underlying,
    direction,
    direction_score: round(supportedDirectionScore, 6),
    volatility_score: round(clip(deterministicVolatility, -1, 1), 6),
    coverage: round(activeWeight, 6),
    agreement: round(Math.min(deterministicAgreement, modelRiskMultiplier), 6),
    active_weight: round(activeWeight, 6),
    horizon_sessions: horizonSessions,
    source_families: rows.map((row) => row.family).sort(),
    evidence_root: sha256({
      economic_direction_authority_sha256: authority.authority_sha256,
      evidence: valid.flatMap((signal) => signal.evidence)
        .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id)),
    }),
  });
}

export function aggregateSignals(signals, {
  underlying = "SPY",
  horizonSessions = 5,
  asOf,
  economicDirectionAuthority = null,
} = {}) {
  const valid = signals.map((signal) => validateSourceSignal(signal, { asOf })).filter((item) => item.underlying === underlying);
  if (new Set(valid.map((item) => item.family)).size !== valid.length) throw new Error("multiple signals from one family would double count evidence");
  assertEvidenceSeparation(valid);
  const rows = valid.map((signal) => ({
    family: signal.family,
    direction: signal.direction_score,
    volatility: signal.volatility_score,
    weight: effectiveWeight(signal),
    evidence_ids: signal.evidence_ids,
  }));
  const authority = validateEconomicDirectionAuthority(economicDirectionAuthority);
  if (authority) return aggregateUnderEconomicAuthority(rows, valid, authority, { underlying, horizonSessions });
  const activeWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const directionScore = activeWeight === 0 ? 0 : rows.reduce((sum, row) => sum + row.weight * row.direction, 0) / activeWeight;
  const volatilityScore = activeWeight === 0 ? 0 : rows.reduce((sum, row) => sum + row.weight * row.volatility, 0) / activeWeight;
  const coverage = Math.min(1, activeWeight);
  const directionalWeight = rows.reduce((sum, row) => sum + row.weight * Math.abs(row.direction), 0);
  const majoritySign = Math.sign(directionScore);
  const alignedWeight = rows.reduce(
    (sum, row) => sum + (Math.sign(row.direction) === majoritySign ? row.weight * Math.abs(row.direction) : 0),
    0,
  );
  const agreement = directionalWeight === 0 ? 0 : alignedWeight / directionalWeight;
  const direction = Math.abs(directionScore) < POLICY.directionThreshold
    ? "neutral"
    : directionScore > 0 ? "bullish" : "bearish";
  const intent = {
    schema_version: "finly_intent.v1",
    underlying,
    direction,
    direction_score: round(directionScore, 6),
    volatility_score: round(volatilityScore, 6),
    coverage: round(coverage, 6),
    agreement: round(agreement, 6),
    active_weight: round(activeWeight, 6),
    horizon_sessions: horizonSessions,
    source_families: rows.map((row) => row.family).sort(),
    evidence_root: sha256(valid.flatMap((signal) => signal.evidence).sort((left, right) => left.evidence_id.localeCompare(right.evidence_id))),
  };
  return validateIntent(intent);
}

export function intentCanTrade(intent) {
  validateIntent(intent);
  if (intent.direction === "neutral") return { ok: false, reason: "DIRECTION_BELOW_THRESHOLD" };
  if (intent.coverage < POLICY.minCoverage) return { ok: false, reason: "INSUFFICIENT_COVERAGE" };
  if (intent.agreement < POLICY.minAgreement) return { ok: false, reason: "INSUFFICIENT_AGREEMENT" };
  return { ok: true };
}

export function leaveOneFamilyOut(signals, options) {
  const base = aggregateSignals(signals, options);
  const families = [...new Set(signals.map((signal) => signal.family))].sort();
  const variants = families.map((removed_family) => {
    const intent = aggregateSignals(signals.filter((signal) => signal.family !== removed_family), options);
    return {
      removed_family,
      direction: intent.direction,
      direction_score: intent.direction_score,
      coverage: intent.coverage,
      agreement: intent.agreement,
      stable_direction: intent.direction === base.direction && intent.direction !== "neutral",
      trade_gate: intentCanTrade(intent),
    };
  });
  return {
    base_direction: base.direction,
    variants,
    passed: variants.every((row) => row.stable_direction && row.trade_gate.ok),
  };
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function clip(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
