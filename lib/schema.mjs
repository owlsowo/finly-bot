import { sha256 } from "./canonical.mjs";
import { FAMILY_BASE_WEIGHTS, POLICY } from "./policy.mjs";

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function finiteBetween(value, low, high, label) {
  assert(Number.isFinite(value) && value >= low && value <= high, `${label} must be in [${low}, ${high}]`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]), `${label} contains missing or unknown fields`);
}

function validHash(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

export function validateEvidenceRecord(record, { family, underlying, asOf } = {}) {
  assert(record && typeof record === "object" && !Array.isArray(record), "evidence record must be an object");
  assertExactKeys(record, [
    "schema_version", "family", "underlying", "source_kind", "source_uri", "origin_id",
    "published_at", "received_at", "available_at", "content_sha256", "duplicate_group", "evidence_id",
  ], "evidence record");
  assert(record.schema_version === "evidence_record.v1", "unsupported evidence schema");
  assert(Object.hasOwn(FAMILY_BASE_WEIGHTS, record.family), "invalid evidence family");
  assert(POLICY.underlyings.includes(record.underlying), "evidence underlying is outside the allowlist");
  if (family) assert(record.family === family, "evidence family differs from source signal");
  if (underlying) assert(record.underlying === underlying, "evidence underlying differs from source signal");
  assert(new Set(["alpaca_market", "alpaca_options", "official_event", "prediction_market", "news", "filing", "synthetic_fixture"]).has(record.source_kind), "unknown evidence source kind");
  assert(typeof record.source_uri === "string" && (/^https:\/\//.test(record.source_uri) || /^urn:finly:/.test(record.source_uri)), "evidence source URI must be HTTPS or a Finly fixture URN");
  assert(typeof record.origin_id === "string" && record.origin_id.length >= 8, "evidence origin ID is invalid");
  for (const field of ["content_sha256", "duplicate_group", "evidence_id"]) assert(validHash(record[field]), `${field} must be a SHA-256 hash`);
  const published = new Date(record.published_at).getTime();
  const received = new Date(record.received_at).getTime();
  const available = new Date(record.available_at).getTime();
  assert([published, received, available].every(Number.isFinite), "evidence timestamps are invalid");
  assert(published <= received && received <= available, "evidence timestamps are causally inverted");
  if (asOf) assert(available <= new Date(asOf).getTime(), "evidence was not available at decision time");
  const { evidence_id: evidenceId, ...body } = record;
  assert(sha256(body) === evidenceId, "evidence ID does not match canonical content");
  return record;
}

export function validateSourceSignal(signal, context = {}) {
  assert(signal && typeof signal === "object" && !Array.isArray(signal), "source signal must be an object");
  assertExactKeys(signal, [
    "schema_version", "family", "underlying", "direction_score", "volatility_score", "quality",
    "freshness", "calibration", "independence", "evidence_ids", "evidence", "explanation",
  ], "source signal");
  assert(signal.schema_version === "source_signal.v1", "unsupported source signal schema");
  assert(Object.hasOwn(FAMILY_BASE_WEIGHTS, signal.family), `unknown source family: ${signal.family}`);
  assert(POLICY.underlyings.includes(signal.underlying), "underlying is outside the policy allowlist");
  finiteBetween(signal.direction_score, -1, 1, "direction_score");
  finiteBetween(signal.volatility_score, -1, 1, "volatility_score");
  for (const key of ["quality", "freshness", "calibration", "independence"]) {
    finiteBetween(signal[key], 0, 1, key);
  }
  assert(Array.isArray(signal.evidence_ids), "evidence_ids must be an array");
  assert(signal.evidence_ids.length > 0 && signal.evidence_ids.every(validHash), "evidence IDs must be hashes");
  assert(Array.isArray(signal.evidence) && signal.evidence.length > 0, "source signal must embed its evidence records");
  const validatedEvidence = signal.evidence.map((record) => validateEvidenceRecord(record, { family: signal.family, underlying: signal.underlying, asOf: context.asOf }));
  assert(new Set(signal.evidence_ids).size === signal.evidence_ids.length, "source signal contains duplicate evidence IDs");
  assert(JSON.stringify([...signal.evidence_ids].sort()) === JSON.stringify(validatedEvidence.map((record) => record.evidence_id).sort()), "evidence_ids differ from embedded evidence records");
  assert(typeof signal.explanation === "string" && signal.explanation.length >= 12, "source explanation is missing");
  return signal;
}

export function validateIntent(intent) {
  assert(intent && typeof intent === "object" && !Array.isArray(intent), "intent must be an object");
  assertExactKeys(intent, [
    "schema_version", "underlying", "direction", "direction_score", "volatility_score", "coverage",
    "agreement", "active_weight", "horizon_sessions", "source_families", "evidence_root",
  ], "intent");
  assert(intent?.schema_version === "finly_intent.v1", "unsupported intent schema");
  assert(POLICY.underlyings.includes(intent.underlying), "intent underlying is outside the allowlist");
  assert(["bullish", "bearish", "neutral"].includes(intent.direction), "invalid direction");
  finiteBetween(intent.direction_score, -1, 1, "intent direction_score");
  finiteBetween(intent.volatility_score, -1, 1, "intent volatility_score");
  finiteBetween(intent.coverage, 0, 1, "intent coverage");
  finiteBetween(intent.agreement, 0, 1, "intent agreement");
  finiteBetween(intent.active_weight, 0, 1, "intent active_weight");
  assert(Number.isInteger(intent.horizon_sessions) && intent.horizon_sessions >= 1 && intent.horizon_sessions <= 20, "invalid horizon");
  assert(
    Array.isArray(intent.source_families)
      && intent.source_families.length >= 1
      && intent.source_families.length <= Object.keys(FAMILY_BASE_WEIGHTS).length
      && new Set(intent.source_families).size === intent.source_families.length
      && intent.source_families.every((family) => Object.hasOwn(FAMILY_BASE_WEIGHTS, family)),
    "intent source families are invalid",
  );
  assert(validHash(intent.evidence_root), "intent evidence root is invalid");
  return intent;
}

export function validateOptionQuote(quote) {
  assert(quote && typeof quote === "object" && !Array.isArray(quote), "option quote must be an object");
  assertExactKeys(quote, [
    "underlying", "symbol", "type", "expiry", "strike", "bid", "ask", "iv", "dte",
    "feed", "quote_age_seconds", "open_interest", "tradable",
  ], "option quote");
  assert(quote?.underlying && POLICY.underlyings.includes(quote.underlying), "quote underlying is outside the allowlist");
  assert(typeof quote.symbol === "string" && quote.symbol.length >= 12, "invalid option symbol");
  assert(typeof quote.expiry === "string", "missing option expiry");
  assert(["call", "put"].includes(quote.type), "invalid option type");
  assert(Number.isFinite(quote.strike) && quote.strike > 0, "invalid strike");
  assert(Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && quote.bid >= 0 && quote.ask > quote.bid, "crossed or invalid quote");
  assert(Number.isFinite(quote.iv) && quote.iv > 0 && quote.iv < 5, "invalid implied volatility");
  assert(Number.isInteger(quote.dte) && quote.dte >= POLICY.entryDte.min && quote.dte <= POLICY.entryDte.max, "DTE outside policy");
  assert(["indicative", "opra"].includes(quote.feed), "unidentified option feed");
  assert(Number.isFinite(quote.quote_age_seconds) && quote.quote_age_seconds >= 0, "invalid quote age");
  assert(quote.quote_age_seconds <= POLICY.quoteMaxAgeSeconds[quote.feed], "stale option quote");
  const midpoint = (quote.bid + quote.ask) / 2;
  assert((quote.ask - quote.bid) / midpoint <= POLICY.maxRelativeLegSpread, "option quote is too wide");
  assert(Number.isFinite(quote.open_interest) && quote.open_interest >= POLICY.minOpenInterest, "insufficient open interest");
  assert(quote.tradable === true, "contract is not tradable");
  const occ = parseOccOptionSymbol(quote.symbol);
  assert(occ.underlying === quote.underlying, "option symbol underlying differs from quote");
  assert(occ.type === quote.type, "option symbol type differs from quote");
  assert(occ.expiry === quote.expiry, "option symbol expiry differs from quote");
  assert(Math.abs(occ.strike - quote.strike) < 0.0001, "option symbol strike differs from quote");
  return quote;
}

export function parseOccOptionSymbol(symbol) {
  assert(typeof symbol === "string", "option symbol must be a string");
  const match = /^([A-Z0-9]{1,6})(\d{6})([CP])(\d{8})$/.exec(symbol);
  assert(match, "option symbol is not compact OCC/OSI format");
  const [, underlying, date, right, strikeDigits] = match;
  const year = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const day = Number(date.slice(4, 6));
  const fullYear = year >= 70 ? 1900 + year : 2000 + year;
  const expiry = `${String(fullYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${expiry}T00:00:00.000Z`);
  assert(!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() === fullYear && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day, "option symbol contains an invalid expiry");
  return {
    underlying,
    expiry,
    type: right === "C" ? "call" : "put",
    strike: Number(strikeDigits) / 1000,
  };
}
