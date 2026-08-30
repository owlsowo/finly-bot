import { sha256, stableStringify } from "../lib/canonical.mjs";
import {
  buildCurrentEconomicDecision,
  CURRENT_ECONOMIC_DECISION_PROTOCOL,
} from "../lib/economic_research.mjs";

export const FORWARD_TRIAL_LIVE_ID = "finly_forward_trial_live_1a";
export const FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION = "2026-08-31";
export const FORWARD_TRIAL_LIVE_ACTIVATION_SCHEMA = "finly_forward_trial_live_activation.v1";
export const FORWARD_TRIAL_LIVE_ACQUISITION_SCHEMA = "finly_forward_trial_live_acquisition.v1";
export const FORWARD_TRIAL_LIVE_COMMITMENT_SCHEMA = "finly_forward_trial_live_commitment.v1";
export const FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA = "finly_forward_trial_live_public_anchor.v1";

export const FORWARD_TRIAL_LIVE_SYMBOLS = Object.freeze([
  "SPY", "BIL", "QQQ", "IWM", "EFA", "EEM", "IEF", "TLT", "GLD", "DBC", "VNQ",
  "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
]);

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SECRET_KEY = /(^|_)(api_?key|secret|token|password|authorization|credential|raw_?header)(_|$)/i;
const SECRET_VALUE = /(Bearer\s+[A-Za-z0-9._~-]+|APCA-[A-Za-z0-9_-]{8,}|(?:sk|pk)[-_][A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/i;
const SAFE_SECURITY_KEYS = new Set(["authorization", "credentials_persisted"]);
const CALENDAR_PROVIDER = "Alpaca Trading API";
const CALENDAR_ENDPOINT = "/v2/calendar";
const MARKET_PROVIDER = "Alpaca Market Data API";
const CORPORATE_ACTION_METHOD = "canonical digest of the same-vintage all-adjusted/raw two-close comparison";
const INDEX_METHOD = "append prior index level multiplied by the last-two-close gross return from this acquisition's single adjustment=all vintage";

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function only(value, keys, required, label) {
  object(value, label);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} contains unsupported key ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label} omits ${key}`);
}

function noSecrets(value, label = "value") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => noSecrets(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key) && !SAFE_SECURITY_KEYS.has(key)) fail(`${label} contains a credential-like key`);
      noSecrets(item, `${label}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SECRET_VALUE.test(value)) fail(`${label} contains a credential-like value`);
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a canonical SHA-256 digest`);
  return value;
}

function date(value, label) {
  if (typeof value !== "string" || !DATE.test(value)) fail(`${label} must be an ISO calendar date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label} is invalid`);
  return value;
}

function instant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(`${label} must be a canonical UTC timestamp`);
  return value;
}

function positive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${label} must be positive and finite`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function frozenClone(value) {
  return deepFreeze(structuredClone(value));
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}

export function hashForwardTrialLiveValue(value) {
  return sha256(value);
}

function symbols(value, label) {
  exact(value, FORWARD_TRIAL_LIVE_SYMBOLS, label);
  return value;
}

function validateWeights(value, label) {
  exact(value, ["SPY", "BIL"], label);
  const spy = value.SPY;
  const bil = value.BIL;
  if (![spy, bil].every((weight) => typeof weight === "number" && Number.isFinite(weight) && weight >= 0 && weight <= 1)) {
    fail(`${label} weights must be finite numbers from zero to one`);
  }
  if (Math.abs(spy + bil - 1) > 1e-10) fail(`${label} weights must sum to one`);
  return value;
}

function validateIndexLevels(value, label) {
  symbols(value, label);
  for (const symbol of FORWARD_TRIAL_LIVE_SYMBOLS) positive(value[symbol], `${label}.${symbol}`);
  return value;
}

function expectedEligibleAt(marketCloseAt) {
  return new Date(new Date(marketCloseAt).getTime() + 15 * 60_000).toISOString();
}

function validateCalendarSession(value, label = "official calendar session") {
  exact(value, [
    "calendar_provider", "calendar_endpoint", "calendar_request_sha256", "calendar_response_sha256",
    "provider_signature_verified", "session_date", "market_open_at", "market_close_at", "bar_eligible_at",
    "next_session_date", "next_market_open_at", "next_market_close_at",
  ], label);
  if (value.calendar_provider !== CALENDAR_PROVIDER || value.calendar_endpoint !== CALENDAR_ENDPOINT) {
    fail(`${label} does not identify the official Alpaca calendar route`);
  }
  digest(value.calendar_request_sha256, `${label} request hash`);
  digest(value.calendar_response_sha256, `${label} response hash`);
  if (value.provider_signature_verified !== false) fail(`${label} overclaims provider authentication`);
  date(value.session_date, `${label}.session_date`);
  date(value.next_session_date, `${label}.next_session_date`);
  const open = instant(value.market_open_at, `${label}.market_open_at`);
  const close = instant(value.market_close_at, `${label}.market_close_at`);
  const eligible = instant(value.bar_eligible_at, `${label}.bar_eligible_at`);
  const nextOpen = instant(value.next_market_open_at, `${label}.next_market_open_at`);
  const nextClose = instant(value.next_market_close_at, `${label}.next_market_close_at`);
  if (open.slice(0, 10) !== value.session_date || close.slice(0, 10) !== value.session_date || open >= close) {
    fail(`${label} current-session timestamps are inconsistent`);
  }
  if (eligible !== expectedEligibleAt(close)) fail(`${label} must use the fixed close-plus-15-minute boundary`);
  if (value.next_session_date <= value.session_date
    || nextOpen.slice(0, 10) !== value.next_session_date
    || nextClose.slice(0, 10) !== value.next_session_date
    || nextOpen >= nextClose
    || close >= nextOpen) {
    fail(`${label} next-session timestamps are inconsistent`);
  }
  return value;
}

function validateInitialState(value) {
  exact(value, ["current_allocation", "last_rebalance_date", "last_signal_session_date", "adjusted_return_index_levels"], "activation initial state");
  validateWeights(value.current_allocation, "activation current allocation");
  if (!same(value.current_allocation, { SPY: 0, BIL: 1 })
    || value.last_rebalance_date !== null
    || value.last_signal_session_date !== null) {
    fail("activation must begin from the frozen all-BIL fresh-start state");
  }
  validateIndexLevels(value.adjusted_return_index_levels, "activation index levels");
  if (FORWARD_TRIAL_LIVE_SYMBOLS.some((symbol) => value.adjusted_return_index_levels[symbol] !== 1)) {
    fail("activation index levels must all begin at one");
  }
}

const FORMULA_BINDING = deepFreeze({
  implementation: "buildCurrentEconomicDecision",
  policy_id: CURRENT_ECONOMIC_DECISION_PROTOCOL.policy_id,
  protocol_sha256: sha256(CURRENT_ECONOMIC_DECISION_PROTOCOL),
});

const AUTHORITY = deepFreeze({
  research_only: true,
  broker_mutation_authorized: false,
  order_payload: null,
});

const CLOSED_GATES = deepFreeze({
  settlement_enabled: false,
  inference_enabled: false,
});

function activationBody(value) {
  return {
    schema_version: value.schema_version,
    trial_id: value.trial_id,
    entry_kind: value.entry_kind,
    payload: value.payload,
  };
}

export function buildForwardTrialLiveActivation(input = {}) {
  exact(input, ["frozen_at", "activation_mode", "session"], "activation input");
  const session = frozenClone(input.session);
  validateCalendarSession(session, "activation calendar session");
  const mode = input.activation_mode;
  const sessionDate = session.session_date;
  if (sessionDate < FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION) fail("activation cannot backfill before the pinned first eligible session");
  const expectedMode = sessionDate === FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION
    ? "PINNED_FIRST_ELIGIBLE"
    : "EXPLICIT_LATER_ACTIVATION";
  if (mode !== expectedMode) fail("activation mode does not explicitly freeze the selected first session");
  const frozenAt = instant(input.frozen_at, "activation frozen_at");
  if (frozenAt >= session.market_close_at) fail("activation must be frozen before its selected session closes; retrospective activation is forbidden");
  const body = {
    schema_version: FORWARD_TRIAL_LIVE_ACTIVATION_SCHEMA,
    trial_id: FORWARD_TRIAL_LIVE_ID,
    entry_kind: "LIVE_ACTIVATION",
    payload: {
      frozen_at: frozenAt,
      pinned_first_eligible_session: FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION,
      activation_mode: mode,
      activation_session: session,
      formula_binding: frozenClone(FORMULA_BINDING),
      initial_state: {
        current_allocation: { SPY: 0, BIL: 1 },
        last_rebalance_date: null,
        last_signal_session_date: null,
        adjusted_return_index_levels: Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => [symbol, 1])),
      },
      controls: {
        no_backfill: true,
        clock_override_permitted: false,
        same_vintage_interval_chaining_required: true,
        write_once_commitments_required: true,
      },
      authority: frozenClone(AUTHORITY),
      evaluation_gates: frozenClone(CLOSED_GATES),
    },
  };
  return validateForwardTrialLiveActivation(deepFreeze({ ...body, activation_sha256: sha256(body) }));
}

export function validateForwardTrialLiveActivation(value) {
  noSecrets(value, "activation");
  exact(value, ["schema_version", "trial_id", "entry_kind", "payload", "activation_sha256"], "activation");
  if (value.schema_version !== FORWARD_TRIAL_LIVE_ACTIVATION_SCHEMA
    || value.trial_id !== FORWARD_TRIAL_LIVE_ID
    || value.entry_kind !== "LIVE_ACTIVATION") fail("activation envelope is invalid");
  exact(value.payload, ["frozen_at", "pinned_first_eligible_session", "activation_mode", "activation_session", "formula_binding", "initial_state", "controls", "authority", "evaluation_gates"], "activation payload");
  const session = validateCalendarSession(value.payload.activation_session, "activation calendar session");
  instant(value.payload.frozen_at, "activation frozen_at");
  if (value.payload.pinned_first_eligible_session !== FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION
    || session.session_date < FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION
    || value.payload.frozen_at >= session.market_close_at) {
    fail("activation is retrospective or changes the pinned boundary");
  }
  const expectedMode = session.session_date === FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION
    ? "PINNED_FIRST_ELIGIBLE"
    : "EXPLICIT_LATER_ACTIVATION";
  if (value.payload.activation_mode !== expectedMode) fail("activation mode is invalid");
  exact(value.payload.formula_binding, ["implementation", "policy_id", "protocol_sha256"], "activation formula binding");
  if (!same(value.payload.formula_binding, FORMULA_BINDING)) fail("activation substitutes the frozen production formula");
  validateInitialState(value.payload.initial_state);
  exact(value.payload.controls, ["no_backfill", "clock_override_permitted", "same_vintage_interval_chaining_required", "write_once_commitments_required"], "activation controls");
  if (!same(value.payload.controls, {
    no_backfill: true,
    clock_override_permitted: false,
    same_vintage_interval_chaining_required: true,
    write_once_commitments_required: true,
  })) fail("activation weakens its point-in-time or write-once controls");
  exact(value.payload.authority, ["research_only", "broker_mutation_authorized", "order_payload"], "activation authority");
  if (!same(value.payload.authority, AUTHORITY)) fail("activation crosses the research-only authority boundary");
  exact(value.payload.evaluation_gates, ["settlement_enabled", "inference_enabled"], "activation evaluation gates");
  if (!same(value.payload.evaluation_gates, CLOSED_GATES)) fail("activation opens settlement or inference prematurely");
  digest(value.activation_sha256, "activation hash");
  if (value.activation_sha256 !== sha256(activationBody(value))) fail("activation hash is invalid");
  return value;
}

function validateCloseRow(row, label, signalSessionDate) {
  exact(row, ["session_date", "bar_timestamp", "close"], label);
  date(row.session_date, `${label}.session_date`);
  const timestamp = instant(row.bar_timestamp, `${label}.bar_timestamp`);
  positive(row.close, `${label}.close`);
  if (timestamp.slice(0, 10) !== row.session_date) fail(`${label} timestamp/date mismatch`);
  if (row.session_date > signalSessionDate) fail(`${label} contains a future session after the completed-session boundary`);
  return row;
}

function validateCloseRowsMap(value, expectedLength, signalSessionDate, label) {
  symbols(value, label);
  let canonicalDates = null;
  for (const symbol of FORWARD_TRIAL_LIVE_SYMBOLS) {
    const rows = value[symbol];
    if (!Array.isArray(rows) || rows.length !== expectedLength) fail(`${label}.${symbol} must contain exactly ${expectedLength} close rows`);
    let priorDate = null;
    rows.forEach((row, index) => {
      validateCloseRow(row, `${label}.${symbol}[${index}]`, signalSessionDate);
      if (priorDate !== null && row.session_date <= priorDate) fail(`${label}.${symbol} rows must be strictly chronological`);
      priorDate = row.session_date;
    });
    const dates = rows.map((row) => row.session_date);
    if (canonicalDates === null) canonicalDates = dates;
    else if (!same(dates, canonicalDates)) fail(`${label} symbols must contain exactly aligned sessions`);
  }
  if (canonicalDates.at(-1) !== signalSessionDate) fail(`${label} does not end on the completed signal session`);
  return canonicalDates;
}

function validateSource(value, adjustedDates, rawDates, sessionDate) {
  exact(value, [
    "provider", "feed", "timeframe", "currency", "asof", "adjusted", "raw",
    "provider_signature_verified", "credentials_persisted", "raw_response_body_persisted",
  ], "acquisition source");
  if (value.provider !== MARKET_PROVIDER || value.feed !== "iex" || value.timeframe !== "1Day" || value.currency !== "USD" || value.asof !== sessionDate) {
    fail("acquisition source metadata is not the fixed IEX daily-bar method");
  }
  for (const [key, expectedAdjustment, dates] of [["adjusted", "all", adjustedDates], ["raw", "raw", rawDates]]) {
    exact(value[key], ["adjustment", "window_start_session_date", "window_end_session_date", "request_parameters_sha256", "response_content_sha256"], `acquisition source ${key}`);
    if (value[key].adjustment !== expectedAdjustment
      || value[key].window_start_session_date !== dates[0]
      || value[key].window_end_session_date !== dates.at(-1)) {
      fail(`acquisition source ${key} window or adjustment is invalid`);
    }
    digest(value[key].request_parameters_sha256, `acquisition source ${key} request hash`);
    digest(value[key].response_content_sha256, `acquisition source ${key} response hash`);
  }
  if (value.provider_signature_verified !== false
    || value.credentials_persisted !== false
    || value.raw_response_body_persisted !== false) {
    fail("acquisition source overclaims provider authentication or persists forbidden material");
  }
}

function deriveCorporateActionDigests(adjusted, raw, source) {
  const perSymbol = Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => {
    const adjustedTail = adjusted[symbol].slice(-2);
    const rawTail = raw[symbol];
    return [symbol, sha256({
      symbol,
      session_dates: adjustedTail.map((row) => row.session_date),
      adjusted_closes: adjustedTail.map((row) => row.close),
      raw_closes: rawTail.map((row) => row.close),
      adjusted_request_parameters_sha256: source.adjusted.request_parameters_sha256,
      adjusted_response_content_sha256: source.adjusted.response_content_sha256,
      raw_request_parameters_sha256: source.raw.request_parameters_sha256,
      raw_response_content_sha256: source.raw.response_content_sha256,
    })];
  }));
  return {
    method: CORPORATE_ACTION_METHOD,
    per_symbol: perSymbol,
    panel_sha256: sha256(perSymbol),
  };
}

function acquisitionBody(value) {
  return {
    schema_version: value.schema_version,
    trial_id: value.trial_id,
    retrieved_at: value.retrieved_at,
    session: value.session,
    source: value.source,
    adjusted_close_rows: value.adjusted_close_rows,
    raw_close_rows: value.raw_close_rows,
    corporate_action_digests: value.corporate_action_digests,
  };
}

function validateAcquisitionBody(body) {
  exact(body, ["schema_version", "trial_id", "retrieved_at", "session", "source", "adjusted_close_rows", "raw_close_rows", "corporate_action_digests"], "acquisition body");
  if (body.schema_version !== FORWARD_TRIAL_LIVE_ACQUISITION_SCHEMA || body.trial_id !== FORWARD_TRIAL_LIVE_ID) fail("acquisition envelope is invalid");
  const session = validateCalendarSession(body.session, "acquisition official calendar session");
  const retrievedAt = instant(body.retrieved_at, "acquisition retrieved_at");
  if (retrievedAt < session.bar_eligible_at) fail("acquisition is backdated before the close-plus-15-minute eligibility boundary");
  if (retrievedAt >= session.next_market_close_at) fail("acquisition occurs at or after the next official close");
  const adjustedDates = validateCloseRowsMap(body.adjusted_close_rows, 253, session.session_date, "adjustment=all close rows");
  const rawDates = validateCloseRowsMap(body.raw_close_rows, 2, session.session_date, "adjustment=raw close rows");
  if (!same(rawDates, adjustedDates.slice(-2))) fail("raw and all-adjusted closes must cover the same final two sessions");
  validateSource(body.source, adjustedDates, rawDates, session.session_date);
  exact(body.corporate_action_digests, ["method", "per_symbol", "panel_sha256"], "corporate-action digests");
  symbols(body.corporate_action_digests.per_symbol, "corporate-action per-symbol digests");
  for (const symbol of FORWARD_TRIAL_LIVE_SYMBOLS) digest(body.corporate_action_digests.per_symbol[symbol], `corporate-action digest ${symbol}`);
  digest(body.corporate_action_digests.panel_sha256, "corporate-action panel digest");
  const expected = deriveCorporateActionDigests(body.adjusted_close_rows, body.raw_close_rows, body.source);
  if (!same(body.corporate_action_digests, expected)) fail("corporate-action digests do not bind the same-vintage all/raw comparison");
  return body;
}

export function buildForwardTrialLiveAcquisition(input = {}) {
  noSecrets(input, "acquisition input");
  exact(input, ["retrieved_at", "session", "source", "adjusted_close_rows", "raw_close_rows"], "acquisition input");
  const base = {
    schema_version: FORWARD_TRIAL_LIVE_ACQUISITION_SCHEMA,
    trial_id: FORWARD_TRIAL_LIVE_ID,
    retrieved_at: input.retrieved_at,
    session: structuredClone(input.session),
    source: structuredClone(input.source),
    adjusted_close_rows: structuredClone(input.adjusted_close_rows),
    raw_close_rows: structuredClone(input.raw_close_rows),
  };
  const provisional = {
    ...base,
    corporate_action_digests: deriveCorporateActionDigests(base.adjusted_close_rows, base.raw_close_rows, base.source),
  };
  validateAcquisitionBody(provisional);
  return validateForwardTrialLiveAcquisition(deepFreeze({ ...provisional, acquisition_sha256: sha256(provisional) }));
}

export function validateForwardTrialLiveAcquisition(value) {
  noSecrets(value, "acquisition");
  exact(value, ["schema_version", "trial_id", "retrieved_at", "session", "source", "adjusted_close_rows", "raw_close_rows", "corporate_action_digests", "acquisition_sha256"], "acquisition");
  validateAcquisitionBody(acquisitionBody(value));
  digest(value.acquisition_sha256, "acquisition hash");
  if (value.acquisition_sha256 !== sha256(acquisitionBody(value))) fail("acquisition hash is invalid");
  return value;
}

function validateState(value, label) {
  exact(value, ["current_allocation", "last_rebalance_date", "last_signal_session_date", "adjusted_return_index_levels"], label);
  validateWeights(value.current_allocation, `${label}.current_allocation`);
  if (value.last_rebalance_date !== null) date(value.last_rebalance_date, `${label}.last_rebalance_date`);
  if (value.last_signal_session_date !== null) date(value.last_signal_session_date, `${label}.last_signal_session_date`);
  validateIndexLevels(value.adjusted_return_index_levels, `${label}.adjusted_return_index_levels`);
  return value;
}

function stateBefore(activation, previousCommitment) {
  return structuredClone(previousCommitment === null
    ? activation.payload.initial_state
    : previousCommitment.payload.state_after);
}

function validateSessionChain(activation, previousCommitment, acquisition) {
  const current = acquisition.session;
  if (previousCommitment === null) {
    const activated = activation.payload.activation_session;
    if (current.session_date !== activated.session_date
      || current.market_open_at !== activated.market_open_at
      || current.market_close_at !== activated.market_close_at
      || current.bar_eligible_at !== activated.bar_eligible_at
      || current.next_session_date !== activated.next_session_date
      || current.next_market_open_at !== activated.next_market_open_at
      || current.next_market_close_at !== activated.next_market_close_at) {
      fail("first commitment does not match the explicitly frozen activation session");
    }
    return;
  }
  const priorSession = previousCommitment.payload.acquisition.session;
  if (current.session_date !== priorSession.next_session_date
    || current.market_open_at !== priorSession.next_market_open_at
    || current.market_close_at !== priorSession.next_market_close_at) {
    fail("commitment skips or backfills the previously declared next official session");
  }
}

function deriveReturnIndex(acquisition, priorLevels, priorBindingSha256) {
  const perSymbol = Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => {
    const [start, end] = acquisition.adjusted_close_rows[symbol].slice(-2);
    const grossReturn = end.close / start.close;
    const priorIndexLevel = priorLevels[symbol];
    return [symbol, {
      start_session_date: start.session_date,
      end_session_date: end.session_date,
      same_vintage_gross_return: grossReturn,
      prior_index_level: priorIndexLevel,
      index_level: priorIndexLevel * grossReturn,
    }];
  }));
  return {
    method: INDEX_METHOD,
    acquisition_sha256: acquisition.acquisition_sha256,
    prior_index_binding_sha256: priorBindingSha256,
    per_symbol: perSymbol,
    index_levels_sha256: sha256(Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => [symbol, perSymbol[symbol].index_level]))),
  };
}

function expectedDecision(acquisition, priorState) {
  const session = acquisition.session;
  return buildCurrentEconomicDecision({
    spyBars: acquisition.adjusted_close_rows.SPY.map((row) => ({ t: row.bar_timestamp, c: row.close })),
    cashBars: acquisition.adjusted_close_rows.BIL.map((row) => ({ t: row.bar_timestamp, c: row.close })),
    decisionTimestamp: acquisition.retrieved_at,
    sourceAvailableAt: acquisition.retrieved_at,
    completedSessionBoundary: {
      sessionDate: session.session_date,
      marketCloseAt: session.market_close_at,
      eligibleAt: session.bar_eligible_at,
      availabilityDelayMinutes: 15,
    },
    currentAllocation: {
      spyWeight: priorState.current_allocation.SPY,
      bilWeight: priorState.current_allocation.BIL,
    },
    lastRebalanceDate: priorState.last_rebalance_date,
  });
}

function derivePayload(activation, previousCommitment, acquisition) {
  const priorState = stateBefore(activation, previousCommitment);
  const decision = expectedDecision(acquisition, priorState);
  const action = decision.decision === "PROPOSE_REBALANCE" ? "REBALANCE" : "HOLD";
  const targetWeights = action === "REBALANCE"
    ? { SPY: decision.proposed_allocation.spy_weight, BIL: decision.proposed_allocation.bil_weight }
    : structuredClone(priorState.current_allocation);
  const priorIndexBinding = previousCommitment?.commitment_sha256 ?? activation.activation_sha256;
  const returnIndex = deriveReturnIndex(acquisition, priorState.adjusted_return_index_levels, priorIndexBinding);
  const nextIndexLevels = Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => [symbol, returnIndex.per_symbol[symbol].index_level]));
  return {
    captured_at: acquisition.retrieved_at,
    acquisition: structuredClone(acquisition),
    same_vintage_adjusted_return_index: returnIndex,
    formula_commitment: {
      formula_binding: structuredClone(FORMULA_BINDING),
      decision_receipt: structuredClone(decision),
      action,
      target_weights: targetWeights,
    },
    state_before: priorState,
    state_after: {
      current_allocation: structuredClone(targetWeights),
      last_rebalance_date: action === "REBALANCE" ? acquisition.session.session_date : priorState.last_rebalance_date,
      last_signal_session_date: acquisition.session.session_date,
      adjusted_return_index_levels: nextIndexLevels,
    },
    persistence_contract: {
      canonical_hash_chain: true,
      append_only: true,
      write_once_required: true,
      caller_must_use_content_addressed_storage: true,
    },
    authority: structuredClone(AUTHORITY),
    evaluation_gates: structuredClone(CLOSED_GATES),
  };
}

function commitmentBody(value) {
  return {
    schema_version: value.schema_version,
    trial_id: value.trial_id,
    sequence: value.sequence,
    entry_kind: value.entry_kind,
    previous_commitment_sha256: value.previous_commitment_sha256,
    payload: value.payload,
  };
}

function validateReturnIndex(value, acquisition, priorState, priorBindingSha256) {
  exact(value, ["method", "acquisition_sha256", "prior_index_binding_sha256", "per_symbol", "index_levels_sha256"], "same-vintage adjusted return index");
  if (value.method !== INDEX_METHOD
    || value.acquisition_sha256 !== acquisition.acquisition_sha256
    || value.prior_index_binding_sha256 !== priorBindingSha256) {
    fail("adjusted return index changes its same-vintage source binding");
  }
  symbols(value.per_symbol, "adjusted return index symbols");
  for (const symbol of FORWARD_TRIAL_LIVE_SYMBOLS) {
    exact(value.per_symbol[symbol], ["start_session_date", "end_session_date", "same_vintage_gross_return", "prior_index_level", "index_level"], `adjusted return index ${symbol}`);
    for (const key of ["same_vintage_gross_return", "prior_index_level", "index_level"]) positive(value.per_symbol[symbol][key], `adjusted return index ${symbol}.${key}`);
  }
  digest(value.index_levels_sha256, "adjusted return index levels hash");
  const expected = deriveReturnIndex(acquisition, priorState.adjusted_return_index_levels, priorBindingSha256);
  if (!same(value, expected)) fail("adjusted return index is not derived solely from this bundle's final two same-vintage adjusted closes");
}

function validateFormulaCommitment(value, acquisition, priorState) {
  exact(value, ["formula_binding", "decision_receipt", "action", "target_weights"], "formula commitment");
  exact(value.formula_binding, ["implementation", "policy_id", "protocol_sha256"], "formula commitment binding");
  if (!same(value.formula_binding, FORMULA_BINDING)) fail("formula commitment substitutes the frozen production formula");
  const expected = expectedDecision(acquisition, priorState);
  if (!same(value.decision_receipt, expected)) fail("formula decision differs from buildCurrentEconomicDecision");
  const expectedAction = expected.decision === "PROPOSE_REBALANCE" ? "REBALANCE" : "HOLD";
  if (value.action !== expectedAction) fail("formula action differs from buildCurrentEconomicDecision");
  validateWeights(value.target_weights, "formula target weights");
  const expectedWeights = expectedAction === "REBALANCE"
    ? { SPY: expected.proposed_allocation.spy_weight, BIL: expected.proposed_allocation.bil_weight }
    : priorState.current_allocation;
  if (!same(value.target_weights, expectedWeights)) fail("formula target weights differ from buildCurrentEconomicDecision");
}

function validateCommitmentShape(value) {
  noSecrets(value, "private commitment");
  exact(value, ["schema_version", "trial_id", "sequence", "entry_kind", "previous_commitment_sha256", "payload", "commitment_sha256"], "private commitment");
  if (value.schema_version !== FORWARD_TRIAL_LIVE_COMMITMENT_SCHEMA
    || value.trial_id !== FORWARD_TRIAL_LIVE_ID
    || value.entry_kind !== "SIGNAL_COMMITMENT"
    || !Number.isInteger(value.sequence)
    || value.sequence < 1) fail("private commitment envelope is invalid");
  digest(value.previous_commitment_sha256, "previous commitment hash");
  digest(value.commitment_sha256, "commitment hash");
  if (value.commitment_sha256 !== sha256(commitmentBody(value))) fail("private commitment hash is invalid");
  exact(value.payload, ["captured_at", "acquisition", "same_vintage_adjusted_return_index", "formula_commitment", "state_before", "state_after", "persistence_contract", "authority", "evaluation_gates"], "private commitment payload");
  instant(value.payload.captured_at, "commitment captured_at");
  validateForwardTrialLiveAcquisition(value.payload.acquisition);
  validateState(value.payload.state_before, "commitment state_before");
  validateState(value.payload.state_after, "commitment state_after");
  exact(value.payload.persistence_contract, ["canonical_hash_chain", "append_only", "write_once_required", "caller_must_use_content_addressed_storage"], "commitment persistence contract");
  if (!same(value.payload.persistence_contract, {
    canonical_hash_chain: true,
    append_only: true,
    write_once_required: true,
    caller_must_use_content_addressed_storage: true,
  })) fail("private commitment weakens its write-once contract");
  exact(value.payload.authority, ["research_only", "broker_mutation_authorized", "order_payload"], "commitment authority");
  if (!same(value.payload.authority, AUTHORITY)) fail("private commitment crosses the research-only authority boundary");
  exact(value.payload.evaluation_gates, ["settlement_enabled", "inference_enabled"], "commitment evaluation gates");
  if (!same(value.payload.evaluation_gates, CLOSED_GATES)) fail("private commitment opens settlement or inference prematurely");
  return value;
}

export function buildForwardTrialLiveCommitment(options = {}) {
  only(options, ["activation", "acquisition", "previousCommitment"], ["activation", "acquisition"], "commitment builder options");
  const { activation, acquisition } = options;
  const previousCommitment = options.previousCommitment ?? null;
  validateForwardTrialLiveActivation(activation);
  validateForwardTrialLiveAcquisition(acquisition);
  if (previousCommitment !== null) validateCommitmentShape(previousCommitment);
  validateSessionChain(activation, previousCommitment, acquisition);
  const body = {
    schema_version: FORWARD_TRIAL_LIVE_COMMITMENT_SCHEMA,
    trial_id: FORWARD_TRIAL_LIVE_ID,
    sequence: (previousCommitment?.sequence ?? 0) + 1,
    entry_kind: "SIGNAL_COMMITMENT",
    previous_commitment_sha256: previousCommitment?.commitment_sha256 ?? activation.activation_sha256,
    payload: derivePayload(activation, previousCommitment, acquisition),
  };
  return validateForwardTrialLiveCommitment(deepFreeze({ ...body, commitment_sha256: sha256(body) }), {
    activation,
    previousCommitment,
  });
}

export function validateForwardTrialLiveCommitment(value, options = {}) {
  only(options, ["activation", "previousCommitment"], ["activation"], "commitment validator options");
  const previousCommitment = options.previousCommitment ?? null;
  const activation = options.activation;
  validateForwardTrialLiveActivation(activation);
  validateCommitmentShape(value);
  if (previousCommitment !== null) validateCommitmentShape(previousCommitment);
  if (value.sequence !== (previousCommitment?.sequence ?? 0) + 1
    || value.previous_commitment_sha256 !== (previousCommitment?.commitment_sha256 ?? activation.activation_sha256)) {
    fail("canonical commitment hash chain is broken");
  }
  validateSessionChain(activation, previousCommitment, value.payload.acquisition);
  if (value.payload.captured_at !== value.payload.acquisition.retrieved_at) fail("commitment capture time must equal the immutable acquisition time");
  const expectedStateBefore = stateBefore(activation, previousCommitment);
  if (!same(value.payload.state_before, expectedStateBefore)) fail("commitment state_before breaks the prior commitment chain");
  const priorBinding = previousCommitment?.commitment_sha256 ?? activation.activation_sha256;
  validateReturnIndex(value.payload.same_vintage_adjusted_return_index, value.payload.acquisition, expectedStateBefore, priorBinding);
  validateFormulaCommitment(value.payload.formula_commitment, value.payload.acquisition, expectedStateBefore);
  const expectedPayload = derivePayload(activation, previousCommitment, value.payload.acquisition);
  if (!same(value.payload, expectedPayload)) fail("private commitment payload differs from the canonical derivation");
  return value;
}

export function forwardTrialLiveCommitmentFilename(commitment) {
  validateCommitmentShape(commitment);
  return `${String(commitment.sequence).padStart(8, "0")}_${commitment.commitment_sha256.slice(7)}.json`;
}

function anchorBody(value) {
  return {
    schema_version: value.schema_version,
    trial_id: value.trial_id,
    manifest_kind: value.manifest_kind,
    commitment_sequence: value.commitment_sequence,
    signal_session_date: value.signal_session_date,
    timing: value.timing,
    formula: value.formula,
    action: value.action,
    target_weights: value.target_weights,
    private_bundle_sha256: value.private_bundle_sha256,
    previous_private_bundle_sha256: value.previous_private_bundle_sha256,
    authority: value.authority,
    evaluation_gates: value.evaluation_gates,
  };
}

function expectedAnchor(commitment) {
  const acquisition = commitment.payload.acquisition;
  const decision = commitment.payload.formula_commitment;
  return {
    schema_version: FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA,
    trial_id: FORWARD_TRIAL_LIVE_ID,
    manifest_kind: "PUBLIC_HASH_ONLY_SIGNAL_ANCHOR",
    commitment_sequence: commitment.sequence,
    signal_session_date: acquisition.session.session_date,
    timing: {
      captured_at: commitment.payload.captured_at,
      market_close_at: acquisition.session.market_close_at,
      bar_eligible_at: acquisition.session.bar_eligible_at,
      next_session_date: acquisition.session.next_session_date,
      next_market_close_at: acquisition.session.next_market_close_at,
      anchor_deadline: acquisition.session.next_market_close_at,
    },
    formula: {
      implementation: decision.formula_binding.implementation,
      policy_id: decision.formula_binding.policy_id,
      protocol_sha256: decision.formula_binding.protocol_sha256,
      decision_receipt_sha256: decision.decision_receipt.receipt_sha256,
    },
    action: decision.action,
    target_weights: structuredClone(decision.target_weights),
    private_bundle_sha256: commitment.commitment_sha256,
    previous_private_bundle_sha256: commitment.previous_commitment_sha256,
    authority: structuredClone(AUTHORITY),
    evaluation_gates: structuredClone(CLOSED_GATES),
  };
}

export function buildForwardTrialLiveAnchorManifest(commitment, options = {}) {
  validateForwardTrialLiveCommitment(commitment, options);
  const body = expectedAnchor(commitment);
  return validateForwardTrialLiveAnchorManifest(deepFreeze({ ...body, manifest_sha256: sha256(body) }), commitment, options);
}

export function validateForwardTrialLiveAnchorManifest(value, commitment, options = {}) {
  validateForwardTrialLiveCommitment(commitment, options);
  noSecrets(value, "public anchor manifest");
  exact(value, ["schema_version", "trial_id", "manifest_kind", "commitment_sequence", "signal_session_date", "timing", "formula", "action", "target_weights", "private_bundle_sha256", "previous_private_bundle_sha256", "authority", "evaluation_gates", "manifest_sha256"], "public anchor manifest");
  exact(value.timing, ["captured_at", "market_close_at", "bar_eligible_at", "next_session_date", "next_market_close_at", "anchor_deadline"], "public anchor timing");
  exact(value.formula, ["implementation", "policy_id", "protocol_sha256", "decision_receipt_sha256"], "public anchor formula");
  validateWeights(value.target_weights, "public anchor target weights");
  exact(value.authority, ["research_only", "broker_mutation_authorized", "order_payload"], "public anchor authority");
  exact(value.evaluation_gates, ["settlement_enabled", "inference_enabled"], "public anchor evaluation gates");
  digest(value.private_bundle_sha256, "public anchor private bundle hash");
  digest(value.previous_private_bundle_sha256, "public anchor previous bundle hash");
  digest(value.formula.protocol_sha256, "public anchor protocol hash");
  digest(value.formula.decision_receipt_sha256, "public anchor decision hash");
  digest(value.manifest_sha256, "public anchor manifest hash");
  const expected = expectedAnchor(commitment);
  if (!same(anchorBody(value), expected)) fail("public anchor differs from the private commitment's permitted disclosure");
  if (value.manifest_sha256 !== sha256(anchorBody(value))) fail("public anchor manifest hash is invalid");
  const serialized = stableStringify(value);
  for (const forbidden of ["adjusted_close_rows", "raw_close_rows", "corporate_action_digests", "response_content_sha256", "request_parameters_sha256", "bar_timestamp", "acquisition_sha256"]) {
    if (serialized.includes(forbidden)) fail(`public anchor leaks private acquisition field ${forbidden}`);
  }
  return value;
}
