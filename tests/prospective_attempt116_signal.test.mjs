import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND,
  ATTEMPT116_SHADOW_INPUT_SCHEMA,
  ATTEMPT116_STANCES,
  ATTEMPT116_SYNTHETIC_EVIDENCE_KIND,
  buildAttempt116ShadowSignal,
  canonicalAttempt116ShadowSignalJson,
  classifyAttempt116RelativeGap,
  computeAttempt116BlendedRealizedVolatility,
  computeAttempt116CloseToCloseVolatility,
  computeAttempt116ParkinsonVolatility,
  hashAttempt116ShadowSignal,
  isAttempt116TermSlopeBlackout,
  normalizeAttempt116ShadowInput,
  selectAttempt116AtmImpliedVolatility,
  validateAttempt116ShadowSignal,
} from "../research/prospective_attempt116/signal.mjs";
import { ATTEMPT116_ID } from "../research/prospective_attempt116/protocol.mjs";

const DAY_MILLISECONDS = 86_400_000;
const TEST_DIGEST = `sha256:${"a".repeat(64)}`;
const RECEIPT_DIGEST = `sha256:${"b".repeat(64)}`;
const SNAPSHOT_AT = "2026-08-31T14:00:00.000Z";

function weekdayDates(count, start = "2026-07-30T00:00:00.000Z") {
  const dates = [];
  let timestamp = Date.parse(start);
  while (dates.length < count) {
    const date = new Date(timestamp);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) dates.push(date.toISOString().slice(0, 10));
    timestamp += DAY_MILLISECONDS;
  }
  return dates;
}

function bars() {
  let priorClose = 100;
  return weekdayDates(22).map((sessionDate, index) => {
    const logReturn = 0.003 + 0.022 * Math.sin(index * 1.31);
    const open = priorClose * (1 + 0.002 * Math.cos(index * 0.77));
    const close = priorClose * Math.exp(logReturn);
    const high = Math.max(open, close) * (1.025 + 0.003 * Math.sin(index));
    const low = Math.min(open, close) * (0.976 - 0.002 * Math.cos(index));
    priorClose = close;
    return { session_date: sessionDate, open, high, low, close };
  });
}

function quotes(frontIv, nextIv) {
  return [
    { underlying_symbol: "SPY", expiration: "2026-09-04", option_type: "CALL", strike: 99, implied_volatility: frontIv, observed_at: SNAPSHOT_AT },
    { underlying_symbol: "SPY", expiration: "2026-09-04", option_type: "CALL", strike: 101, implied_volatility: frontIv, observed_at: SNAPSHOT_AT },
    { underlying_symbol: "SPY", expiration: "2026-09-04", option_type: "PUT", strike: 100, implied_volatility: frontIv, observed_at: SNAPSHOT_AT },
    { underlying_symbol: "SPY", expiration: "2026-09-08", option_type: "CALL", strike: 100, implied_volatility: nextIv, observed_at: SNAPSHOT_AT },
    { underlying_symbol: "SPY", expiration: "2026-09-08", option_type: "PUT", strike: 100, implied_volatility: nextIv, observed_at: SNAPSHOT_AT },
  ];
}

function syntheticInput({ relativeGap = 0, termSlope = 0, omitNext = false } = {}) {
  const underlyingBars = bars();
  const realized = computeAttempt116BlendedRealizedVolatility(underlyingBars).blended;
  const frontIv = realized * (1 + relativeGap);
  const nextIv = frontIv - termSlope;
  const surfaceQuotes = quotes(frontIv, nextIv)
    .filter((quote) => !omitNext || quote.expiration !== "2026-09-08");
  return {
    schema_version: ATTEMPT116_SHADOW_INPUT_SCHEMA,
    attempt_id: ATTEMPT116_ID,
    evidence_kind: ATTEMPT116_SYNTHETIC_EVIDENCE_KIND,
    symbol: "SPY",
    observation: {
      session_date: "2026-08-31",
      observed_at: SNAPSHOT_AT,
      public_registration: null,
    },
    underlying_bars: underlyingBars,
    option_surface: {
      spot: 100,
      snapshot_as_of_utc: SNAPSHOT_AT,
      provider_origin_status: "CALLER_ASSERTED_SNAPSHOT_NOT_PROVIDER_ORIGIN_OR_TIMING_VERIFIED",
      eligible_surface_completeness_status:
        "CALLER_ASSERTED_COMPLETE_SPY_1_TO_9_DTE_SURFACE_NOT_VERIFIED",
      quotes: surfaceQuotes,
    },
    source_evidence_sha256: TEST_DIGEST,
  };
}

function prospectiveInput() {
  const value = syntheticInput({ relativeGap: 0.2 });
  value.evidence_kind = ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND;
  value.observation.public_registration = {
    platform: "github",
    platform_record_kind: "GITHUB_COMMIT",
    public_commit_sha: "c".repeat(40),
    published_at: "2026-08-30T12:00:00.000Z",
    receipt_observed_at: "2026-08-30T12:05:00.000Z",
    receipt_sha256: RECEIPT_DIGEST,
    verification_status: "CALLER_ASSERTED_PUBLIC_PLATFORM_RECEIPT_NOT_VERIFIED_BY_PURE_COMPILER",
  };
  return value;
}

function sampleDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + ((value - mean) ** 2), 0)
      / (values.length - 1),
  );
}

function oracleCloseVolatility(inputBars, returnCount) {
  const closes = inputBars.slice(-(returnCount + 1)).map((bar) => bar.close);
  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  return sampleDeviation(returns) * Math.sqrt(252);
}

function oracleParkinson(inputBars) {
  const selected = inputBars.slice(-21);
  const sum = selected.reduce(
    (total, bar) => total + (Math.log(bar.high / bar.low) ** 2),
    0,
  );
  return Math.sqrt((252 * sum) / (4 * selected.length * Math.log(2)));
}

test("realized-volatility implementation equals an independent 10/21/21 oracle", () => {
  const inputBars = bars();
  const expected10 = oracleCloseVolatility(inputBars, 10);
  const expected21 = oracleCloseVolatility(inputBars, 21);
  const expectedParkinson = oracleParkinson(inputBars);
  const expectedBlend = 0.4 * expected10 + 0.2 * expected21 + 0.4 * expectedParkinson;
  const observed = computeAttempt116BlendedRealizedVolatility(inputBars);
  assert.equal(computeAttempt116CloseToCloseVolatility(inputBars, 10), expected10);
  assert.equal(computeAttempt116CloseToCloseVolatility(inputBars, 21), expected21);
  assert.equal(computeAttempt116ParkinsonVolatility(inputBars), expectedParkinson);
  assert.deepEqual(observed, {
    close_to_close_10: expected10,
    close_to_close_21: expected21,
    parkinson_21: expectedParkinson,
    blended: expectedBlend,
  });
});

test("relative-gap boundaries are inclusive and their strict interior stands down", () => {
  assert.equal(classifyAttempt116RelativeGap(0.15), ATTEMPT116_STANCES.SELL);
  assert.equal(classifyAttempt116RelativeGap(0.15000000000000002), ATTEMPT116_STANCES.SELL);
  assert.equal(classifyAttempt116RelativeGap(0.14999999999999997), ATTEMPT116_STANCES.STAND_DOWN);
  assert.equal(classifyAttempt116RelativeGap(-0.15), ATTEMPT116_STANCES.BUY);
  assert.equal(classifyAttempt116RelativeGap(-0.15000000000000002), ATTEMPT116_STANCES.BUY);
  assert.equal(classifyAttempt116RelativeGap(-0.14999999999999997), ATTEMPT116_STANCES.STAND_DOWN);
  assert.equal(classifyAttempt116RelativeGap(null), ATTEMPT116_STANCES.STAND_DOWN);
});

test("term slope uses the pinned strict raw IEEE-754 greater-than convention", () => {
  assert.equal(isAttempt116TermSlopeBlackout(0.08), false);
  assert.equal(isAttempt116TermSlopeBlackout(0.08000000000000002), true);
  assert.equal(isAttempt116TermSlopeBlackout(0.07999999999999999), false);
  assert.equal(isAttempt116TermSlopeBlackout(-0.5), false);
  assert.equal(isAttempt116TermSlopeBlackout(null), false);
});

test("compiler emits buy, sell, and interior stand-down shadow stances", () => {
  const sell = buildAttempt116ShadowSignal(syntheticInput({ relativeGap: 0.2 }));
  const buy = buildAttempt116ShadowSignal(syntheticInput({ relativeGap: -0.2 }));
  const interior = buildAttempt116ShadowSignal(syntheticInput({ relativeGap: 0 }));
  assert.equal(sell.calculation.final_shadow_stance, ATTEMPT116_STANCES.SELL);
  assert.equal(buy.calculation.final_shadow_stance, ATTEMPT116_STANCES.BUY);
  assert.equal(interior.calculation.final_shadow_stance, ATTEMPT116_STANCES.STAND_DOWN);
  assert.equal(interior.calculation.decision_reason, "RELATIVE_GAP_STRICTLY_INSIDE_STAND_DOWN_BAND");
});

test("term blackout overrides both directional stances and missing next IV fails closed", () => {
  for (const relativeGap of [0.2, -0.2]) {
    const signal = buildAttempt116ShadowSignal(syntheticInput({ relativeGap, termSlope: 0.09 }));
    assert.notEqual(signal.calculation.raw_shadow_stance, ATTEMPT116_STANCES.STAND_DOWN);
    assert.equal(signal.calculation.term_slope_blackout, true);
    assert.equal(signal.calculation.final_shadow_stance, ATTEMPT116_STANCES.STAND_DOWN);
    assert.equal(signal.calculation.decision_reason, "TERM_SLOPE_STRICTLY_ABOVE_0_08_BLACKOUT");
  }
  const missing = buildAttempt116ShadowSignal(syntheticInput({ relativeGap: 0.2, omitNext: true }));
  assert.equal(missing.calculation.next_atm_iv.atm_iv, null);
  assert.equal(missing.calculation.final_shadow_stance, ATTEMPT116_STANCES.STAND_DOWN);
  assert.equal(missing.calculation.decision_reason, "MISSING_NEXT_ATM_IV_FAIL_CLOSED");
});

test("ATM selection is side-specific, permits one side, and breaks ties at lower strike", () => {
  const selected = selectAttempt116AtmImpliedVolatility({
    expiration: "2026-09-04",
    spot: 100,
    sessionDate: "2026-08-31",
    snapshotAsOfUtc: SNAPSHOT_AT,
    quotes: [
      { underlying_symbol: "SPY", expiration: "2026-09-04", option_type: "CALL", strike: 101, implied_volatility: 0.3, observed_at: SNAPSHOT_AT },
      { underlying_symbol: "SPY", expiration: "2026-09-04", option_type: "CALL", strike: 99, implied_volatility: 0.2, observed_at: SNAPSHOT_AT },
      { underlying_symbol: "SPY", expiration: "2026-09-04", option_type: "PUT", strike: 102, implied_volatility: 0.4, observed_at: SNAPSHOT_AT },
    ],
  });
  assert.equal(selected.selected_call_reference_quote.strike, 99);
  assert.equal(selected.selected_put_reference_quote.strike, 102);
  assert.equal(selected.atm_iv, (0.2 + 0.4) / 2);

  const oneSide = selectAttempt116AtmImpliedVolatility({
    expiration: "2026-09-04",
    spot: 100,
    sessionDate: "2026-08-31",
    snapshotAsOfUtc: SNAPSHOT_AT,
    quotes: [
      { underlying_symbol: "SPY", expiration: "2026-09-04", option_type: "PUT", strike: 101, implied_volatility: 0.27, observed_at: SNAPSHOT_AT },
    ],
  });
  assert.equal(oneSide.selected_call_reference_quote, null);
  assert.equal(oneSide.selected_side_count, 1);
  assert.equal(oneSide.atm_iv, 0.27);
});

test("quote input order cannot change the deterministic compiled signal", () => {
  const input = syntheticInput({ relativeGap: 0.2 });
  const reversed = structuredClone(input);
  reversed.option_surface.quotes.reverse();
  assert.deepEqual(
    buildAttempt116ShadowSignal(reversed),
    buildAttempt116ShadowSignal(input),
  );
});

test("compiler rejects incomplete history, malformed OHLC, duplicate quotes, and bad expiries", () => {
  const incomplete = syntheticInput();
  incomplete.underlying_bars = incomplete.underlying_bars.slice(1);
  assert.throws(() => buildAttempt116ShadowSignal(incomplete), /at least 22 completed bars/iu);

  const malformed = syntheticInput();
  malformed.underlying_bars.at(-1).high = malformed.underlying_bars.at(-1).low - 1;
  assert.throws(() => buildAttempt116ShadowSignal(malformed), /incoherent OHLC/iu);

  const duplicate = syntheticInput();
  duplicate.option_surface.quotes.push(structuredClone(duplicate.option_surface.quotes[0]));
  assert.throws(() => buildAttempt116ShadowSignal(duplicate), /duplicate option quote/iu);

  const badExpiry = syntheticInput();
  for (const quote of badExpiry.option_surface.quotes) {
    if (quote.expiration === "2026-09-08") quote.expiration = "2026-09-15";
  }
  assert.throws(() => buildAttempt116ShadowSignal(badExpiry), /1-to-9 calendar-DTE/iu);
});

test("prospective inputs are allowed only after the frozen public-registration boundary", () => {
  const valid = prospectiveInput();
  const signal = buildAttempt116ShadowSignal(valid);
  assert.equal(signal.evidence_kind, ATTEMPT116_PROSPECTIVE_EVIDENCE_KIND);
  assert.match(signal.evidence_assurance, /CALLER_ASSERTED/iu);
  assert.match(signal.evidence_assurance, /NOT_VERIFIED/iu);

  const earlyInput = prospectiveInput();
  earlyInput.option_surface.snapshot_as_of_utc = "2026-08-31T13:29:59.999Z";
  for (const quote of earlyInput.option_surface.quotes) {
    quote.observed_at = earlyInput.option_surface.snapshot_as_of_utc;
  }
  assert.throws(() => buildAttempt116ShadowSignal(earlyInput), /snapshot predates the first-eligible boundary/iu);

  const lateRegistration = prospectiveInput();
  lateRegistration.observation.public_registration.published_at = "2026-08-31T13:30:00.000Z";
  assert.throws(() => buildAttempt116ShadowSignal(lateRegistration), /strictly before the frozen deadline/iu);

  const syntheticClaim = syntheticInput();
  syntheticClaim.observation.public_registration = prospectiveInput().observation.public_registration;
  assert.throws(() => buildAttempt116ShadowSignal(syntheticClaim), /must set public_registration to null/iu);
});

test("snapshot and quote timing are exact, input-bound, and never overstated", () => {
  const beforeReceipt = prospectiveInput();
  beforeReceipt.observation.public_registration.receipt_observed_at = "2026-08-31T14:00:00.001Z";
  assert.throws(
    () => buildAttempt116ShadowSignal(beforeReceipt),
    /snapshot predates public-registration receipt observation/iu,
  );

  const afterSignal = prospectiveInput();
  afterSignal.observation.observed_at = "2026-08-31T13:59:59.999Z";
  assert.throws(
    () => buildAttempt116ShadowSignal(afterSignal),
    /snapshot cannot occur after signal observation/iu,
  );

  const quoteMismatch = prospectiveInput();
  quoteMismatch.option_surface.quotes[0].observed_at = "2026-08-31T13:59:59.999Z";
  assert.throws(
    () => buildAttempt116ShadowSignal(quoteMismatch),
    /must equal snapshot_as_of_utc/iu,
  );

  const wrongUnderlying = prospectiveInput();
  wrongUnderlying.option_surface.quotes[0].underlying_symbol = "QQQ";
  assert.throws(
    () => buildAttempt116ShadowSignal(wrongUnderlying),
    /underlying_symbol must be SPY/iu,
  );

  const signal = buildAttempt116ShadowSignal(prospectiveInput());
  assert.equal(signal.market_snapshot_assurance.snapshot_as_of_utc, SNAPSHOT_AT);
  assert.equal(signal.market_snapshot_assurance.provider_origin_verified, false);
  assert.equal(signal.market_snapshot_assurance.independent_timing_verified, false);
  assert.equal(signal.market_snapshot_assurance.surface_completeness_verified, false);
  assert.match(signal.evidence_assurance, /SURFACE_COMPLETENESS_NOT_VERIFIED/iu);
});

test("front and next expiries are derived from sorted eligible quote expiries", () => {
  const input = syntheticInput({ relativeGap: 0.2 });
  const realized = computeAttempt116BlendedRealizedVolatility(input.underlying_bars).blended;
  input.option_surface.quotes.push(
    { underlying_symbol: "SPY", expiration: "2026-09-01", option_type: "CALL", strike: 100, implied_volatility: realized * 1.2, observed_at: SNAPSHOT_AT },
    { underlying_symbol: "SPY", expiration: "2026-09-01", option_type: "PUT", strike: 100, implied_volatility: realized * 1.2, observed_at: SNAPSHOT_AT },
  );
  const signal = buildAttempt116ShadowSignal(input);
  assert.equal(signal.calculation.front_atm_iv.expiration, "2026-09-01");
  assert.equal(signal.calculation.next_atm_iv.expiration, "2026-09-04");
});

test("signals are input-bound, self-hashed, canonical, and mutation-resistant", () => {
  const input = syntheticInput({ relativeGap: 0.2 });
  const signal = buildAttempt116ShadowSignal(input);
  assert.equal(validateAttempt116ShadowSignal(signal, input), signal);
  assert.equal(signal.signal_sha256, hashAttempt116ShadowSignal(signal));
  assert.equal(
    canonicalAttempt116ShadowSignalJson(signal, input),
    `${JSON.stringify(signal, null, 2)}\n`,
  );
  assert.throws(
    () => validateAttempt116ShadowSignal(signal),
    /requires its complete original input/iu,
  );

  const changed = structuredClone(signal);
  changed.calculation.final_shadow_stance = ATTEMPT116_STANCES.STAND_DOWN;
  changed.signal_sha256 = hashAttempt116ShadowSignal(changed);
  assert.throws(
    () => validateAttempt116ShadowSignal(changed, input),
    /differs from the deterministic input-bound compiler/iu,
  );

  const changedInput = structuredClone(input);
  changedInput.source_evidence_sha256 = sha256("different evidence");
  assert.throws(
    () => validateAttempt116ShadowSignal(signal, changedInput),
    /differs from the deterministic input-bound compiler/iu,
  );
});

test("compiled artifact carries no authority, order, sizing, or performance result", () => {
  const signal = buildAttempt116ShadowSignal(syntheticInput({ relativeGap: 0.2 }));
  assert.ok(Object.values(signal.authority).every((value) => value === false));
  assert.deepEqual(Object.keys(signal.calculation).filter((key) => (
    /order|contract|quantity|notional|kelly|probability|performance|profit/iu.test(key)
  )), []);
  assert.match(signal.claim_boundary, /ATM reference quotes are analytical IV inputs/iu);
  assert.match(signal.claim_boundary, /No order contract, size, structure, broker action/iu);
  assert.doesNotMatch(JSON.stringify(signal), /historical_return|backtest|sharpe|profit_factor/iu);
  assert.deepEqual(normalizeAttempt116ShadowInput(syntheticInput()).underlying_bars, bars());
});

test("pure signal implementation exposes no network, broker, persistence, or mutation surface", async () => {
  const source = await readFile("research/prospective_attempt116/signal.mjs", "utf8");
  assert.doesNotMatch(source, /node:(?:fs|http|https|net|tls|child_process)/u);
  assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|submit_order|replace_order|cancel_order/iu);
  assert.doesNotMatch(source, /strategy\/(?:pricing|sizing)|risk\/portfolio/iu);
});
