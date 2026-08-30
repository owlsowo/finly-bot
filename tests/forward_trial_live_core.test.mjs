import assert from "node:assert/strict";
import test from "node:test";

import { buildCurrentEconomicDecision } from "../lib/economic_research.mjs";
import {
  buildForwardTrialLiveAcquisition,
  buildForwardTrialLiveActivation,
  buildForwardTrialLiveAnchorManifest,
  buildForwardTrialLiveCommitment,
  FORWARD_TRIAL_LIVE_SYMBOLS,
  forwardTrialLiveCommitmentFilename,
  hashForwardTrialLiveValue,
  validateForwardTrialLiveAcquisition,
  validateForwardTrialLiveActivation,
  validateForwardTrialLiveAnchorManifest,
  validateForwardTrialLiveCommitment,
} from "../research/forward_trial_live_core.mjs";

const clone = structuredClone;
const digest = (character) => `sha256:${character.repeat(64)}`;

function weekdaysEnding(endDate, count) {
  const result = [];
  const cursor = new Date(`${endDate}T12:00:00.000Z`);
  while (result.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return result.reverse();
}

function calendarSession({
  sessionDate = "2026-08-31",
  nextSessionDate = "2026-09-01",
  requestHash = digest("a"),
  responseHash = digest("b"),
} = {}) {
  return {
    calendar_provider: "Alpaca Trading API",
    calendar_endpoint: "/v2/calendar",
    calendar_request_sha256: requestHash,
    calendar_response_sha256: responseHash,
    provider_signature_verified: false,
    session_date: sessionDate,
    market_open_at: `${sessionDate}T13:30:00.000Z`,
    market_close_at: `${sessionDate}T20:00:00.000Z`,
    bar_eligible_at: `${sessionDate}T20:15:00.000Z`,
    next_session_date: nextSessionDate,
    next_market_open_at: `${nextSessionDate}T13:30:00.000Z`,
    next_market_close_at: `${nextSessionDate}T20:00:00.000Z`,
  };
}

function adjustedRows(endDate, scale = 1) {
  const dates = weekdaysEnding(endDate, 253);
  return Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol, symbolIndex) => {
    const base = 60 + symbolIndex * 7;
    const trend = symbol === "BIL" ? 0.00008 : 0.00055 + symbolIndex / 1_000_000;
    const rows = dates.map((sessionDate, index) => {
      const wave = symbol === "BIL" ? 0.00002 * Math.sin(index * 0.61) : 0.0025 * Math.sin(index * 0.73 + symbolIndex);
      return {
        session_date: sessionDate,
        bar_timestamp: `${sessionDate}T04:00:00.000Z`,
        close: Number((scale * base * (1 + trend * index) * (1 + wave)).toFixed(8)),
      };
    });
    return [symbol, rows];
  }));
}

function rawTail(adjusted) {
  return Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol, symbolIndex) => [
    symbol,
    adjusted[symbol].slice(-2).map((row) => ({
      ...row,
      close: Number((row.close * (1 + (symbolIndex + 1) / 10_000)).toFixed(8)),
    })),
  ]));
}

function acquisitionInput({
  session = calendarSession(),
  retrievedAt = `${session.session_date}T20:16:00.000Z`,
  scale = 1,
  hashOffset = 0,
} = {}) {
  const adjusted = adjustedRows(session.session_date, scale);
  const raw = rawTail(adjusted);
  const adjustedDates = adjusted.SPY.map((row) => row.session_date);
  const rawDates = raw.SPY.map((row) => row.session_date);
  const chars = "cdef0123456789abcdef0123456789ab";
  return {
    retrieved_at: retrievedAt,
    session,
    source: {
      provider: "Alpaca Market Data API",
      feed: "iex",
      timeframe: "1Day",
      currency: "USD",
      asof: session.session_date,
      adjusted: {
        adjustment: "all",
        window_start_session_date: adjustedDates[0],
        window_end_session_date: adjustedDates.at(-1),
        request_parameters_sha256: digest(chars[hashOffset]),
        response_content_sha256: digest(chars[hashOffset + 1]),
      },
      raw: {
        adjustment: "raw",
        window_start_session_date: rawDates[0],
        window_end_session_date: rawDates.at(-1),
        request_parameters_sha256: digest(chars[hashOffset + 2]),
        response_content_sha256: digest(chars[hashOffset + 3]),
      },
      provider_signature_verified: false,
      credentials_persisted: false,
      raw_response_body_persisted: false,
    },
    adjusted_close_rows: adjusted,
    raw_close_rows: raw,
  };
}

function pinnedActivation() {
  return buildForwardTrialLiveActivation({
    frozen_at: "2026-08-29T16:00:00.000Z",
    activation_mode: "PINNED_FIRST_ELIGIBLE",
    session: calendarSession(),
  });
}

function rehashCommitment(value) {
  const body = {
    schema_version: value.schema_version,
    trial_id: value.trial_id,
    sequence: value.sequence,
    entry_kind: value.entry_kind,
    previous_commitment_sha256: value.previous_commitment_sha256,
    payload: value.payload,
  };
  value.commitment_sha256 = hashForwardTrialLiveValue(body);
  return value;
}

test("happy path yields a canonical private commitment and a price-free public anchor", () => {
  const activation = pinnedActivation();
  const acquisition = buildForwardTrialLiveAcquisition(acquisitionInput());
  const commitment = buildForwardTrialLiveCommitment({ activation, acquisition });
  const anchor = buildForwardTrialLiveAnchorManifest(commitment, { activation });

  assert.equal(commitment.sequence, 1);
  assert.equal(commitment.previous_commitment_sha256, activation.activation_sha256);
  assert.equal(commitment.payload.authority.research_only, true);
  assert.equal(commitment.payload.authority.broker_mutation_authorized, false);
  assert.equal(commitment.payload.authority.order_payload, null);
  assert.deepEqual(commitment.payload.evaluation_gates, { settlement_enabled: false, inference_enabled: false });
  assert.match(forwardTrialLiveCommitmentFilename(commitment), /^00000001_[0-9a-f]{64}\.json$/);
  assert.equal(anchor.private_bundle_sha256, commitment.commitment_sha256);
  assert.equal(anchor.signal_session_date, "2026-08-31");
  assert.deepEqual(anchor.target_weights, commitment.payload.formula_commitment.target_weights);
  assert.equal(anchor.timing.anchor_deadline, "2026-09-01T20:00:00.000Z");
  const serializedAnchor = JSON.stringify(anchor);
  for (const forbidden of ["adjusted_close_rows", "raw_close_rows", "corporate_action_digests", "response_content_sha256", "request_parameters_sha256", "bar_timestamp", "close\""]) {
    assert.equal(serializedAnchor.includes(forbidden), false);
  }
  assert.equal(Object.isFrozen(commitment), true);
  assert.equal(Object.isFrozen(commitment.payload.acquisition.adjusted_close_rows.SPY), true);
  validateForwardTrialLiveActivation(activation);
  validateForwardTrialLiveAcquisition(acquisition);
  validateForwardTrialLiveCommitment(commitment, { activation });
  validateForwardTrialLiveAnchorManifest(anchor, commitment, { activation });
});

test("production action is exactly the unchanged pure buildCurrentEconomicDecision result", () => {
  const activation = pinnedActivation();
  const acquisition = buildForwardTrialLiveAcquisition(acquisitionInput());
  const commitment = buildForwardTrialLiveCommitment({ activation, acquisition });
  const expected = buildCurrentEconomicDecision({
    spyBars: acquisition.adjusted_close_rows.SPY.map((row) => ({ t: row.bar_timestamp, c: row.close })),
    cashBars: acquisition.adjusted_close_rows.BIL.map((row) => ({ t: row.bar_timestamp, c: row.close })),
    decisionTimestamp: acquisition.retrieved_at,
    sourceAvailableAt: acquisition.retrieved_at,
    completedSessionBoundary: {
      sessionDate: acquisition.session.session_date,
      marketCloseAt: acquisition.session.market_close_at,
      eligibleAt: acquisition.session.bar_eligible_at,
      availabilityDelayMinutes: 15,
    },
    currentAllocation: { spyWeight: 0, bilWeight: 1 },
    lastRebalanceDate: null,
  });
  assert.deepEqual(commitment.payload.formula_commitment.decision_receipt, expected);
  assert.equal(commitment.payload.formula_commitment.action, "REBALANCE");
  assert.deepEqual(commitment.payload.formula_commitment.target_weights, {
    SPY: expected.proposed_allocation.spy_weight,
    BIL: expected.proposed_allocation.bil_weight,
  });
});

test("a changed later vintage cannot rewrite a prior commitment and its index uses only its own final two closes", () => {
  const activation = pinnedActivation();
  const firstAcquisition = buildForwardTrialLiveAcquisition(acquisitionInput());
  const first = buildForwardTrialLiveCommitment({ activation, acquisition: firstAcquisition });
  const frozenFirst = JSON.stringify(first);
  const firstHash = first.commitment_sha256;

  const secondSession = calendarSession({
    sessionDate: "2026-09-01",
    nextSessionDate: "2026-09-02",
    requestHash: digest("1"),
    responseHash: digest("2"),
  });
  const secondAcquisition = buildForwardTrialLiveAcquisition(acquisitionInput({
    session: secondSession,
    retrievedAt: "2026-09-01T20:16:00.000Z",
    scale: 0.5,
    hashOffset: 8,
  }));
  const second = buildForwardTrialLiveCommitment({ activation, acquisition: secondAcquisition, previousCommitment: first });

  assert.equal(JSON.stringify(first), frozenFirst);
  assert.equal(first.commitment_sha256, firstHash);
  assert.equal(second.previous_commitment_sha256, firstHash);
  assert.equal(second.sequence, 2);
  const [sameVintageStart, sameVintageEnd] = secondAcquisition.adjusted_close_rows.SPY.slice(-2);
  const sameVintageGross = sameVintageEnd.close / sameVintageStart.close;
  const crossVintageGross = sameVintageEnd.close / firstAcquisition.adjusted_close_rows.SPY.at(-1).close;
  assert.equal(second.payload.same_vintage_adjusted_return_index.per_symbol.SPY.same_vintage_gross_return, sameVintageGross);
  assert.notEqual(sameVintageGross, crossVintageGross);
  assert.equal(
    second.payload.same_vintage_adjusted_return_index.per_symbol.SPY.index_level,
    first.payload.state_after.adjusted_return_index_levels.SPY * sameVintageGross,
  );
  validateForwardTrialLiveCommitment(second, { activation, previousCommitment: first });
});

test("a later activation is permitted only when explicitly frozen before that session closes", () => {
  const session = calendarSession({ sessionDate: "2026-09-01", nextSessionDate: "2026-09-02" });
  const activation = buildForwardTrialLiveActivation({
    frozen_at: "2026-09-01T19:59:59.000Z",
    activation_mode: "EXPLICIT_LATER_ACTIVATION",
    session,
  });
  assert.equal(activation.payload.activation_session.session_date, "2026-09-01");
  assert.throws(() => buildForwardTrialLiveActivation({
    frozen_at: "2026-09-01T20:00:00.000Z",
    activation_mode: "EXPLICIT_LATER_ACTIVATION",
    session,
  }), /retrospective|before its selected session closes/);
  assert.throws(() => buildForwardTrialLiveActivation({
    frozen_at: "2026-09-01T19:00:00.000Z",
    activation_mode: "PINNED_FIRST_ELIGIBLE",
    session,
  }), /explicitly freeze/);
});

test("post-next-close, backdated, future-row, skipped-session, and clock-override inputs fail closed", () => {
  const activation = pinnedActivation();
  assert.throws(() => buildForwardTrialLiveAcquisition(acquisitionInput({
    retrievedAt: "2026-09-01T20:00:00.000Z",
  })), /at or after the next official close/);
  assert.throws(() => buildForwardTrialLiveAcquisition(acquisitionInput({
    retrievedAt: "2026-08-31T20:14:59.999Z",
  })), /backdated/);

  const future = acquisitionInput();
  future.adjusted_close_rows.SPY.at(-1).session_date = "2026-09-01";
  future.adjusted_close_rows.SPY.at(-1).bar_timestamp = "2026-09-01T04:00:00.000Z";
  assert.throws(() => buildForwardTrialLiveAcquisition(future), /future session/);

  const first = buildForwardTrialLiveCommitment({
    activation,
    acquisition: buildForwardTrialLiveAcquisition(acquisitionInput()),
  });
  const skippedSession = calendarSession({ sessionDate: "2026-09-02", nextSessionDate: "2026-09-03" });
  const skippedAcquisition = buildForwardTrialLiveAcquisition(acquisitionInput({
    session: skippedSession,
    retrievedAt: "2026-09-02T20:16:00.000Z",
    hashOffset: 4,
  }));
  assert.throws(() => buildForwardTrialLiveCommitment({
    activation,
    acquisition: skippedAcquisition,
    previousCommitment: first,
  }), /skips or backfills/);
  assert.throws(() => buildForwardTrialLiveCommitment({
    activation,
    acquisition: first.payload.acquisition,
    now: () => new Date("2026-08-31T20:16:00.000Z"),
  }), /unsupported key now/);
});

test("secret-bearing, malformed-schema, and invalid corporate-action acquisitions fail closed", () => {
  const secret = acquisitionInput();
  secret.source.adjusted.response_content_sha256 = "Bearer abcdefghijklmnopqrstuvwxyz";
  assert.throws(() => buildForwardTrialLiveAcquisition(secret), /credential-like value/);

  const malformed = acquisitionInput();
  malformed.source.unfrozen_field = true;
  assert.throws(() => buildForwardTrialLiveAcquisition(malformed), /must contain exactly/);

  const valid = buildForwardTrialLiveAcquisition(acquisitionInput());
  const badDigest = clone(valid);
  badDigest.corporate_action_digests.per_symbol.SPY = digest("f");
  badDigest.corporate_action_digests.panel_sha256 = hashForwardTrialLiveValue(badDigest.corporate_action_digests.per_symbol);
  badDigest.acquisition_sha256 = hashForwardTrialLiveValue({
    schema_version: badDigest.schema_version,
    trial_id: badDigest.trial_id,
    retrieved_at: badDigest.retrieved_at,
    session: badDigest.session,
    source: badDigest.source,
    adjusted_close_rows: badDigest.adjusted_close_rows,
    raw_close_rows: badDigest.raw_close_rows,
    corporate_action_digests: badDigest.corporate_action_digests,
  });
  assert.throws(() => validateForwardTrialLiveAcquisition(badDigest), /do not bind/);
});

test("formula and authority substitutions fail even when the attacker recomputes the outer hash", () => {
  const activation = pinnedActivation();
  const commitment = buildForwardTrialLiveCommitment({
    activation,
    acquisition: buildForwardTrialLiveAcquisition(acquisitionInput()),
  });

  const formula = clone(commitment);
  formula.payload.formula_commitment.formula_binding.protocol_sha256 = digest("9");
  rehashCommitment(formula);
  assert.throws(() => validateForwardTrialLiveCommitment(formula, { activation }), /substitutes the frozen production formula/);

  const authority = clone(commitment);
  authority.payload.authority.broker_mutation_authorized = true;
  rehashCommitment(authority);
  assert.throws(() => validateForwardTrialLiveCommitment(authority, { activation }), /research-only authority boundary/);

  const settlement = clone(commitment);
  settlement.payload.evaluation_gates.settlement_enabled = true;
  rehashCommitment(settlement);
  assert.throws(() => validateForwardTrialLiveCommitment(settlement, { activation }), /opens settlement or inference/);
});
