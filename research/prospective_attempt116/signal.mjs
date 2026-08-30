import { sha256, stableStringify } from "../../lib/canonical.mjs";
import {
  ATTEMPT116_FIRST_ELIGIBLE_INPUT_AT,
  ATTEMPT116_FIRST_ELIGIBLE_SESSION,
  ATTEMPT116_ID,
  ATTEMPT116_LAST_PRE_REGISTRATION_HISTORY_SESSION,
  ATTEMPT116_PROTOCOL_SHA256,
  ATTEMPT116_PUBLICATION_DEADLINE,
  ATTEMPT116_SIGNAL_SPECIFICATION,
} from "./protocol.mjs";

export const ATTEMPT116_SHADOW_INPUT_SCHEMA = "finly_attempt116_vrp_shadow_input.v1";
export const ATTEMPT116_SHADOW_SIGNAL_SCHEMA = "finly_attempt116_vrp_shadow_signal.v1";
export const ATTEMPT116_SYNTHETIC_EVIDENCE_KIND = "SYNTHETIC_TEST_FIXTURE";
export const ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND =
  "PROSPECTIVE_POST_PUBLIC_REGISTRATION_SHADOW";
export const ATTEMPT116_STANCES = Object.freeze({
  SELL: "SELL_VOL_SHADOW",
  BUY: "BUY_VOL_SHADOW",
  STAND_DOWN: "STAND_DOWN",
});

const DAY_MILLISECONDS = 86_400_000;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const INPUT_KEYS = Object.freeze([
  "schema_version",
  "attempt_id",
  "evidence_kind",
  "symbol",
  "observation",
  "underlying_bars",
  "option_surface",
  "source_evidence_sha256",
]);
const OBSERVATION_KEYS = Object.freeze([
  "session_date",
  "observed_at",
  "public_registration",
]);
const REGISTRATION_KEYS = Object.freeze([
  "platform",
  "platform_record_kind",
  "public_commit_sha",
  "published_at",
  "receipt_observed_at",
  "receipt_sha256",
  "verification_status",
]);
const BAR_KEYS = Object.freeze(["session_date", "open", "high", "low", "close"]);
const SURFACE_KEYS = Object.freeze([
  "spot",
  "snapshot_as_of_utc",
  "provider_origin_status",
  "eligible_surface_completeness_status",
  "quotes",
]);
const QUOTE_KEYS = Object.freeze([
  "underlying_symbol",
  "expiration",
  "option_type",
  "strike",
  "implied_volatility",
  "observed_at",
]);

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

function finiteNumber(value, label, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive && value <= 0)) {
    fail(`${label} must be a ${positive ? "positive " : ""}finite number`);
  }
  return value;
}

function canonicalInstant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function canonicalDate(value, label) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    fail(`${label} must be a canonical YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be a canonical YYYY-MM-DD date`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    fail(`${label} must be a lowercase sha256 digest`);
  }
  return value;
}

function dateDifferenceInCalendarDays(later, earlier) {
  return (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`))
    / DAY_MILLISECONDS;
}

function normalizeBars(value) {
  if (!Array.isArray(value)
    || value.length < ATTEMPT116_SIGNAL_SPECIFICATION.required_completed_underlying_bars) {
    fail(`underlying_bars must contain at least ${ATTEMPT116_SIGNAL_SPECIFICATION.required_completed_underlying_bars} completed bars`);
  }
  const bars = value.map((candidate, index) => {
    exactKeys(candidate, BAR_KEYS, `underlying_bars[${index}]`);
    const sessionDate = canonicalDate(candidate.session_date, `underlying_bars[${index}].session_date`);
    const open = finiteNumber(candidate.open, `underlying_bars[${index}].open`, { positive: true });
    const high = finiteNumber(candidate.high, `underlying_bars[${index}].high`, { positive: true });
    const low = finiteNumber(candidate.low, `underlying_bars[${index}].low`, { positive: true });
    const close = finiteNumber(candidate.close, `underlying_bars[${index}].close`, { positive: true });
    if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
      fail(`underlying_bars[${index}] has incoherent OHLC bounds`);
    }
    return { session_date: sessionDate, open, high, low, close };
  });
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index - 1].session_date >= bars[index].session_date) {
      fail("underlying_bars must have unique, strictly increasing session dates");
    }
  }
  return bars;
}

function normalizeQuotes(value, sessionDate, snapshotAsOfUtc) {
  if (!Array.isArray(value)) fail("option_surface.quotes must be an array");
  const seen = new Set();
  const quotes = value.map((candidate, index) => {
    exactKeys(candidate, QUOTE_KEYS, `option_surface.quotes[${index}]`);
    if (candidate.underlying_symbol !== ATTEMPT116_SIGNAL_SPECIFICATION.symbol) {
      fail(`option_surface.quotes[${index}].underlying_symbol must be SPY`);
    }
    const expiration = canonicalDate(
      candidate.expiration,
      `option_surface.quotes[${index}].expiration`,
    );
    const dte = dateDifferenceInCalendarDays(expiration, sessionDate);
    if (!Number.isInteger(dte)
      || dte < ATTEMPT116_SIGNAL_SPECIFICATION.option_expiry_calendar_dte_minimum_inclusive
      || dte > ATTEMPT116_SIGNAL_SPECIFICATION.option_expiry_calendar_dte_maximum_inclusive) {
      fail(`option_surface.quotes[${index}] expiration must be within the frozen inclusive 1-to-9 calendar-DTE window`);
    }
    if (candidate.option_type !== "CALL" && candidate.option_type !== "PUT") {
      fail(`option_surface.quotes[${index}].option_type must be CALL or PUT`);
    }
    const strike = finiteNumber(
      candidate.strike,
      `option_surface.quotes[${index}].strike`,
      { positive: true },
    );
    const impliedVolatility = finiteNumber(
      candidate.implied_volatility,
      `option_surface.quotes[${index}].implied_volatility`,
      { positive: true },
    );
    const observedAt = canonicalInstant(
      candidate.observed_at,
      `option_surface.quotes[${index}].observed_at`,
    );
    if (observedAt !== snapshotAsOfUtc) {
      fail(`option_surface.quotes[${index}].observed_at must equal snapshot_as_of_utc`);
    }
    const identity = `${expiration}|${candidate.option_type}|${strike}`;
    if (seen.has(identity)) fail(`duplicate option quote identity: ${identity}`);
    seen.add(identity);
    return {
      underlying_symbol: ATTEMPT116_SIGNAL_SPECIFICATION.symbol,
      expiration,
      option_type: candidate.option_type,
      strike,
      implied_volatility: impliedVolatility,
      observed_at: observedAt,
    };
  });
  return quotes.sort((left, right) => (
    left.expiration.localeCompare(right.expiration)
    || left.option_type.localeCompare(right.option_type)
    || left.strike - right.strike
  ));
}

function normalizeRegistration(value, evidenceKind, observedAt) {
  if (evidenceKind === ATTEMPT116_SYNTHETIC_EVIDENCE_KIND) {
    if (value !== null) fail("synthetic fixtures must set public_registration to null");
    return null;
  }
  exactKeys(value, REGISTRATION_KEYS, "observation.public_registration");
  if (value.platform !== "github" || value.platform_record_kind !== "GITHUB_COMMIT"
    || typeof value.public_commit_sha !== "string"
    || !COMMIT_PATTERN.test(value.public_commit_sha)
    || value.verification_status
      !== "CALLER_ASSERTED_PUBLIC_PLATFORM_RECEIPT_NOT_VERIFIED_BY_PURE_COMPILER") {
    fail("prospective public-registration assertion changed or is malformed");
  }
  const publishedAt = canonicalInstant(
    value.published_at,
    "observation.public_registration.published_at",
  );
  if (publishedAt >= ATTEMPT116_PUBLICATION_DEADLINE) {
    fail("prospective public registration must be strictly before the frozen deadline");
  }
  if (publishedAt >= observedAt) {
    fail("prospective input must be observed strictly after public registration");
  }
  const receiptObservedAt = canonicalInstant(
    value.receipt_observed_at,
    "observation.public_registration.receipt_observed_at",
  );
  if (receiptObservedAt < publishedAt) {
    fail("public-registration receipt observation cannot precede platform publication");
  }
  return {
    platform: value.platform,
    platform_record_kind: value.platform_record_kind,
    public_commit_sha: value.public_commit_sha,
    published_at: publishedAt,
    receipt_observed_at: receiptObservedAt,
    receipt_sha256: digest(
      value.receipt_sha256,
      "observation.public_registration.receipt_sha256",
    ),
    verification_status: value.verification_status,
  };
}

export function normalizeAttempt116ShadowInput(value) {
  exactKeys(value, INPUT_KEYS, "Attempt 116 shadow input");
  if (value.schema_version !== ATTEMPT116_SHADOW_INPUT_SCHEMA
    || value.attempt_id !== ATTEMPT116_ID
    || value.symbol !== ATTEMPT116_SIGNAL_SPECIFICATION.symbol
    || ![ATTEMPT116_SYNTHETIC_EVIDENCE_KIND, ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND]
      .includes(value.evidence_kind)) {
    fail("Attempt 116 shadow input envelope changed");
  }
  exactKeys(value.observation, OBSERVATION_KEYS, "observation");
  const sessionDate = canonicalDate(value.observation.session_date, "observation.session_date");
  const observedAt = canonicalInstant(value.observation.observed_at, "observation.observed_at");
  if (observedAt.slice(0, 10) !== sessionDate) {
    fail("observation.observed_at UTC date must equal observation.session_date");
  }
  if (value.evidence_kind === ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND
    && (sessionDate < ATTEMPT116_FIRST_ELIGIBLE_SESSION
      || observedAt < ATTEMPT116_FIRST_ELIGIBLE_INPUT_AT)) {
    fail("prospective input predates the registered first-eligible boundary");
  }
  const registration = normalizeRegistration(
    value.observation.public_registration,
    value.evidence_kind,
    observedAt,
  );

  const allBars = normalizeBars(value.underlying_bars);
  const bars = allBars.slice(-ATTEMPT116_SIGNAL_SPECIFICATION.required_completed_underlying_bars);
  if (bars.some((bar) => bar.session_date >= sessionDate)) {
    fail("underlying bars must be completed strictly before the observation session");
  }
  if (value.evidence_kind === ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND
    && sessionDate === ATTEMPT116_FIRST_ELIGIBLE_SESSION
    && bars.at(-1).session_date > ATTEMPT116_LAST_PRE_REGISTRATION_HISTORY_SESSION) {
    fail("first eligible input may use completed history only through the frozen cutoff");
  }

  exactKeys(value.option_surface, SURFACE_KEYS, "option_surface");
  const spot = finiteNumber(value.option_surface.spot, "option_surface.spot", { positive: true });
  const snapshotAsOfUtc = canonicalInstant(
    value.option_surface.snapshot_as_of_utc,
    "option_surface.snapshot_as_of_utc",
  );
  if (snapshotAsOfUtc.slice(0, 10) !== sessionDate) {
    fail("option_surface.snapshot_as_of_utc UTC date must equal observation.session_date");
  }
  if (snapshotAsOfUtc > observedAt) {
    fail("option surface snapshot cannot occur after signal observation");
  }
  if (value.option_surface.provider_origin_status
      !== "CALLER_ASSERTED_SNAPSHOT_NOT_PROVIDER_ORIGIN_OR_TIMING_VERIFIED"
    || value.option_surface.eligible_surface_completeness_status
      !== "CALLER_ASSERTED_COMPLETE_SPY_1_TO_9_DTE_SURFACE_NOT_VERIFIED") {
    fail("option surface assurance labels changed or overstate verification");
  }
  if (value.evidence_kind === ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND
    && snapshotAsOfUtc < ATTEMPT116_FIRST_ELIGIBLE_INPUT_AT) {
    fail("prospective option surface snapshot predates the first-eligible boundary");
  }
  if (value.evidence_kind === ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND
    && snapshotAsOfUtc <= registration.published_at) {
    fail("prospective option surface snapshot must be strictly after public registration");
  }
  if (value.evidence_kind === ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND
    && snapshotAsOfUtc < registration.receipt_observed_at) {
    fail("prospective option surface snapshot predates public-registration receipt observation");
  }
  const quotes = normalizeQuotes(value.option_surface.quotes, sessionDate, snapshotAsOfUtc);
  const expiries = [...new Set(quotes.map((quote) => quote.expiration))].sort();
  const frontExpiry = expiries[0] ?? null;
  const nextExpiry = expiries[1] ?? null;

  return {
    schema_version: ATTEMPT116_SHADOW_INPUT_SCHEMA,
    attempt_id: ATTEMPT116_ID,
    evidence_kind: value.evidence_kind,
    symbol: ATTEMPT116_SIGNAL_SPECIFICATION.symbol,
    observation: {
      session_date: sessionDate,
      observed_at: observedAt,
      public_registration: registration,
    },
    underlying_bars: bars,
    option_surface: {
      spot,
      snapshot_as_of_utc: snapshotAsOfUtc,
      provider_origin_status: value.option_surface.provider_origin_status,
      eligible_surface_completeness_status:
        value.option_surface.eligible_surface_completeness_status,
      front_expiry: frontExpiry,
      next_expiry: nextExpiry,
      quotes,
    },
    source_evidence_sha256: digest(value.source_evidence_sha256, "source_evidence_sha256"),
  };
}

function sampleStandardDeviation(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squaredDeviations = values.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0,
  );
  return Math.sqrt(squaredDeviations / (values.length - 1));
}

function closeToCloseVolatilityFromNormalizedBars(bars, windowReturns) {
  const closes = bars.slice(-(windowReturns + 1)).map((bar) => bar.close);
  const returns = Array.from({ length: windowReturns }, (_, index) => (
    Math.log(closes[index + 1] / closes[index])
  ));
  return sampleStandardDeviation(returns)
    * Math.sqrt(ATTEMPT116_SIGNAL_SPECIFICATION.annualization_sessions);
}

export function computeAttempt116CloseToCloseVolatility(bars, windowReturns) {
  if (![ATTEMPT116_SIGNAL_SPECIFICATION.short_close_return_window,
    ATTEMPT116_SIGNAL_SPECIFICATION.long_close_return_window].includes(windowReturns)) {
    fail("Attempt 116 close-to-close window must be exactly 10 or 21 returns");
  }
  return closeToCloseVolatilityFromNormalizedBars(normalizeBars(bars), windowReturns);
}

function parkinsonVolatilityFromNormalizedBars(bars) {
  const selected = bars.slice(-ATTEMPT116_SIGNAL_SPECIFICATION.parkinson_bar_window);
  const squaredLogRanges = selected.reduce(
    (sum, bar) => sum + (Math.log(bar.high / bar.low) ** 2),
    0,
  );
  return Math.sqrt(
    (ATTEMPT116_SIGNAL_SPECIFICATION.annualization_sessions * squaredLogRanges)
      / (4 * selected.length * Math.log(2)),
  );
}

export function computeAttempt116ParkinsonVolatility(bars) {
  return parkinsonVolatilityFromNormalizedBars(normalizeBars(bars));
}

function realizedVolatilityComponentsFromNormalizedBars(bars) {
  const closeToClose10 = closeToCloseVolatilityFromNormalizedBars(
    bars,
    ATTEMPT116_SIGNAL_SPECIFICATION.short_close_return_window,
  );
  const closeToClose21 = closeToCloseVolatilityFromNormalizedBars(
    bars,
    ATTEMPT116_SIGNAL_SPECIFICATION.long_close_return_window,
  );
  const parkinson21 = parkinsonVolatilityFromNormalizedBars(bars);
  const blended = (
    ATTEMPT116_SIGNAL_SPECIFICATION.close_to_close_10_weight * closeToClose10
    + ATTEMPT116_SIGNAL_SPECIFICATION.close_to_close_21_weight * closeToClose21
    + ATTEMPT116_SIGNAL_SPECIFICATION.parkinson_21_weight * parkinson21
  );
  return {
    close_to_close_10: closeToClose10,
    close_to_close_21: closeToClose21,
    parkinson_21: parkinson21,
    blended,
  };
}

export function computeAttempt116BlendedRealizedVolatility(bars) {
  return realizedVolatilityComponentsFromNormalizedBars(normalizeBars(bars));
}

function nearestQuote(quotes, expiration, optionType, spot) {
  return quotes
    .filter((quote) => quote.expiration === expiration && quote.option_type === optionType)
    .sort((left, right) => (
      Math.abs(left.strike - spot) - Math.abs(right.strike - spot)
      || left.strike - right.strike
    ))[0] ?? null;
}

function atmIvFromNormalizedQuotes(quotes, expiration, spot) {
  const selectedCall = nearestQuote(quotes, expiration, "CALL", spot);
  const selectedPut = nearestQuote(quotes, expiration, "PUT", spot);
  const selected = [selectedCall, selectedPut].filter(Boolean);
  return {
    expiration,
    selected_call_reference_quote: selectedCall,
    selected_put_reference_quote: selectedPut,
    selected_side_count: selected.length,
    atm_iv: selected.length === 0
      ? null
      : selected.reduce((sum, quote) => sum + quote.implied_volatility, 0) / selected.length,
  };
}

export function selectAttempt116AtmImpliedVolatility({
  quotes,
  expiration,
  spot,
  sessionDate,
  snapshotAsOfUtc,
}) {
  const normalizedExpiration = canonicalDate(expiration, "expiration");
  const normalizedSession = canonicalDate(sessionDate, "sessionDate");
  const normalizedSnapshot = canonicalInstant(snapshotAsOfUtc, "snapshotAsOfUtc");
  const normalizedSpot = finiteNumber(spot, "spot", { positive: true });
  const normalizedQuotes = normalizeQuotes(quotes, normalizedSession, normalizedSnapshot);
  return atmIvFromNormalizedQuotes(normalizedQuotes, normalizedExpiration, normalizedSpot);
}

export function classifyAttempt116RelativeGap(relativeGap) {
  if (relativeGap === null) return ATTEMPT116_STANCES.STAND_DOWN;
  finiteNumber(relativeGap, "relativeGap");
  if (relativeGap >= ATTEMPT116_SIGNAL_SPECIFICATION.sell_vol_shadow_minimum_inclusive) {
    return ATTEMPT116_STANCES.SELL;
  }
  if (relativeGap <= ATTEMPT116_SIGNAL_SPECIFICATION.buy_vol_shadow_maximum_inclusive) {
    return ATTEMPT116_STANCES.BUY;
  }
  return ATTEMPT116_STANCES.STAND_DOWN;
}

export function isAttempt116TermSlopeBlackout(termSlope) {
  if (termSlope === null) return false;
  finiteNumber(termSlope, "termSlope");
  return termSlope > ATTEMPT116_SIGNAL_SPECIFICATION.term_slope_blackout_threshold;
}

function signalBody(value) {
  plainObject(value, "Attempt 116 shadow signal");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "signal_sha256"));
}

export function hashAttempt116ShadowSignal(value) {
  return sha256(signalBody(value));
}

export function buildAttempt116ShadowSignal(input) {
  const normalized = normalizeAttempt116ShadowInput(input);
  const realized = realizedVolatilityComponentsFromNormalizedBars(normalized.underlying_bars);
  const front = atmIvFromNormalizedQuotes(
    normalized.option_surface.quotes,
    normalized.option_surface.front_expiry,
    normalized.option_surface.spot,
  );
  const next = atmIvFromNormalizedQuotes(
    normalized.option_surface.quotes,
    normalized.option_surface.next_expiry,
    normalized.option_surface.spot,
  );

  let relativeGap = null;
  let rawStance = ATTEMPT116_STANCES.STAND_DOWN;
  let termSlope = null;
  let blackout = false;
  let finalStance = ATTEMPT116_STANCES.STAND_DOWN;
  let decisionReason;

  if (front.atm_iv === null) {
    decisionReason = "MISSING_FRONT_ATM_IV";
  } else if (next.atm_iv === null) {
    decisionReason = "MISSING_NEXT_ATM_IV_FAIL_CLOSED";
  } else if (!(realized.blended > 0)) {
    decisionReason = "NON_POSITIVE_BLENDED_REALIZED_VOLATILITY";
  } else {
    relativeGap = (front.atm_iv - realized.blended) / realized.blended;
    rawStance = classifyAttempt116RelativeGap(relativeGap);
    termSlope = front.atm_iv - next.atm_iv;
    blackout = isAttempt116TermSlopeBlackout(termSlope);
    if (blackout) {
      decisionReason = "TERM_SLOPE_STRICTLY_ABOVE_0_08_BLACKOUT";
    } else if (rawStance === ATTEMPT116_STANCES.STAND_DOWN) {
      decisionReason = "RELATIVE_GAP_STRICTLY_INSIDE_STAND_DOWN_BAND";
    } else {
      finalStance = rawStance;
      decisionReason = "RELATIVE_GAP_THRESHOLD_MET_WITHOUT_TERM_BLACKOUT";
    }
  }

  const inputProjection = {
    ...normalized,
    protocol_sha256: ATTEMPT116_PROTOCOL_SHA256,
  };
  const body = {
    schema_version: ATTEMPT116_SHADOW_SIGNAL_SCHEMA,
    attempt_id: ATTEMPT116_ID,
    protocol_sha256: ATTEMPT116_PROTOCOL_SHA256,
    evidence_kind: normalized.evidence_kind,
    evidence_assurance: normalized.evidence_kind === ATTEMPT116_SYNTHETIC_EVIDENCE_KIND
      ? "SYNTHETIC_ONLY_NOT_PROSPECTIVE_EVIDENCE"
      : "CALLER_ASSERTED_POST_REGISTRATION_INPUT_PUBLIC_RECEIPT_PROVIDER_ORIGIN_TIMING_AND_SURFACE_COMPLETENESS_NOT_VERIFIED_BY_PURE_COMPILER",
    symbol: normalized.symbol,
    observation: normalized.observation,
    source_evidence_sha256: normalized.source_evidence_sha256,
    input_projection_sha256: sha256(inputProjection),
    market_snapshot_assurance: {
      snapshot_as_of_utc: normalized.option_surface.snapshot_as_of_utc,
      provider_origin_status: normalized.option_surface.provider_origin_status,
      eligible_surface_completeness_status:
        normalized.option_surface.eligible_surface_completeness_status,
      provider_origin_verified: false,
      independent_timing_verified: false,
      surface_completeness_verified: false,
      front_and_next_expiries_derived_from_sorted_distinct_quotes: true,
    },
    calculation: {
      selected_history_first_session: normalized.underlying_bars[0].session_date,
      selected_history_last_session: normalized.underlying_bars.at(-1).session_date,
      selected_history_bar_count: normalized.underlying_bars.length,
      annualization_sessions: ATTEMPT116_SIGNAL_SPECIFICATION.annualization_sessions,
      realized_volatility: realized,
      front_atm_iv: front,
      next_atm_iv: next,
      relative_iv_rv_gap: relativeGap,
      raw_shadow_stance: rawStance,
      term_slope_front_minus_next: termSlope,
      term_slope_blackout: blackout,
      final_shadow_stance: finalStance,
      decision_reason: decisionReason,
    },
    authority: {
      real_data_runner_enabled: false,
      network_requests_permitted: false,
      broker_reads_permitted: false,
      broker_mutation_authorized: false,
      order_construction_authorized: false,
      contract_selection_authorized: false,
      quantity_or_notional_sizing_authorized: false,
      capital_allocation_authorized: false,
      retrospective_evaluation_authorized: false,
      performance_inference_authorized: false,
      production_policy_modification_authorized: false,
      attempt115_modification_authorized: false,
    },
    claim_boundary: "A deterministic, research-only shadow stance from caller-supplied evidence. ATM reference quotes are analytical IV inputs, not tradable legs. No order contract, size, structure, broker action, historical score, performance inference, or profitability claim is authorized or produced.",
  };
  return Object.freeze({ ...body, signal_sha256: sha256(body) });
}

export function validateAttempt116ShadowSignal(value, input) {
  plainObject(value, "Attempt 116 shadow signal");
  if (input === undefined) {
    fail("Attempt 116 shadow signal validation requires its complete original input");
  }
  const expected = buildAttempt116ShadowSignal(input);
  if (stableStringify(value) !== stableStringify(expected)
    || value.signal_sha256 !== hashAttempt116ShadowSignal(value)) {
    fail("Attempt 116 shadow signal differs from the deterministic input-bound compiler");
  }
  return value;
}

export function canonicalAttempt116ShadowSignalJson(value, input) {
  return `${JSON.stringify(validateAttempt116ShadowSignal(value, input), null, 2)}\n`;
}
