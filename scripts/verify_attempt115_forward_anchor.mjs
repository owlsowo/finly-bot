import { sha256, stableStringify } from "../lib/canonical.mjs";
import {
  validateForwardTrialLiveAnchorManifest,
  validateForwardTrialLiveCommitment,
} from "../research/forward_trial_live_core.mjs";
import {
  GITHUB_PUBLICATION_RECEIPT_SCHEMA,
  validateGitHubPublicationReceipt,
} from "./verify_forward_live_github_publication.mjs";

export const ATTEMPT115_FORWARD_ANCHOR_ASSURANCE_SCHEMA =
  "finly_attempt115_forward_anchor_assurance_receipt.v1";
export const ATTEMPT115_SETTLEMENT_SOURCE_PROJECTION_SCHEMA =
  "finly_attempt115_settlement_source_projection.v1";
export const ATTEMPT115_PROVIDER_CALENDAR_RECONCILIATION_SCHEMA =
  "finly_attempt115_provider_calendar_reconciliation.v1";
export const ATTEMPT115_ID = "finly_prospective_profitability_attempt_115";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function fail(message) {
  throw new Error(message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exact(value, keys, label) {
  plainObject(value, label);
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

function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail(`${label} must be a canonical UTC instant`);
  }
  return value;
}

function date(value, label) {
  if (typeof value !== "string" || !ISO_DATE.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    fail(`${label} must be an ISO date`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function withoutHash(value, hashField) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== hashField));
}

function latestRequiredStepCompletion(forwardReceipt) {
  return forwardReceipt.run.required_job_steps
    .map(({ completed_at: completedAt }) => completedAt)
    .reduce((latest, value) => value > latest ? value : latest);
}

export function validateAttempt115StrictPreOpenTiming(forwardReceipt, nextMarketOpenAt) {
  instant(nextMarketOpenAt, "Attempt 115 next market open");
  const platformTimestamps = {
    workflow_created_at: forwardReceipt.run.created_at,
    workflow_completed_at: forwardReceipt.run.updated_at,
    latest_required_step_completed_at: latestRequiredStepCompletion(forwardReceipt),
  };
  for (const [label, value] of Object.entries(platformTimestamps)) {
    instant(new Date(value).toISOString(), `Attempt 115 ${label}`);
    if (Date.parse(value) >= Date.parse(nextMarketOpenAt)) {
      fail(`Attempt 115 ${label} was not strictly before the committed next market open`);
    }
  }
  const observedAt = forwardReceipt.verification_observed_at;
  instant(new Date(observedAt).toISOString(),
    "Attempt 115 forward_publication_observed_at");
  if (Date.parse(observedAt) < Date.parse(platformTimestamps.workflow_completed_at)
    || Date.parse(platformTimestamps.workflow_completed_at)
      < Date.parse(platformTimestamps.workflow_created_at)) {
    fail("Attempt 115 forward publication timing is not chronological");
  }
  return {
    ...platformTimestamps,
    forward_publication_observed_at: observedAt,
    verification_observed_before_next_open:
      Date.parse(observedAt) < Date.parse(nextMarketOpenAt),
  };
}

function projectBookSource(book) {
  return {
    request_parameters_sha256: book.request_parameters_sha256,
    response_content_sha256: book.response_content_sha256,
    provenance_by_symbol: Object.fromEntries(["SPY", "BIL"].map((symbol) => {
      const evidence = book.provenance_by_symbol[symbol];
      return [symbol, {
        content_hash: evidence.content_hash,
        retrieved_at: evidence.retrieved_at,
        final_two_normalized_bars: structuredClone(evidence.bars.slice(-2)),
        request_sha256: sha256(evidence.provenance.request),
        transport_receipts_sha256: evidence.provenance.transport_receipts_sha256,
        provenance_sha256: sha256(evidence.provenance),
      }];
    })),
  };
}

function projectionBody(value) {
  return withoutHash(value, "projection_sha256");
}

export function validateAttempt115SettlementSourceProjection(value) {
  exact(value, [
    "schema_version", "attempt_id", "commitment_sequence", "signal_session_date",
    "source_acquisition_sha256", "session", "adjusted_close_rows", "source",
    "calendar_binding", "projection_sha256",
  ], "Attempt 115 settlement source projection");
  if (value.schema_version !== ATTEMPT115_SETTLEMENT_SOURCE_PROJECTION_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID) {
    fail("Attempt 115 settlement source projection envelope is invalid");
  }
  positiveInteger(value.commitment_sequence, "Attempt 115 projection sequence");
  date(value.signal_session_date, "Attempt 115 projection signal session");
  digest(value.source_acquisition_sha256, "Attempt 115 projection acquisition hash");
  plainObject(value.session, "Attempt 115 projection session");
  if (value.session.session_date !== value.signal_session_date) {
    fail("Attempt 115 projection session differs from its signal session");
  }
  instant(value.session.next_market_open_at, "Attempt 115 projection next market open");
  exact(value.adjusted_close_rows, ["SPY", "BIL"],
    "Attempt 115 projection adjusted close rows");
  for (const symbol of ["SPY", "BIL"]) {
    if (!Array.isArray(value.adjusted_close_rows[symbol])
      || value.adjusted_close_rows[symbol].length !== 253) {
      fail(`Attempt 115 projection ${symbol} adjusted rows must contain exactly 253 sessions`);
    }
  }
  exact(value.source, ["adjusted", "raw"], "Attempt 115 projection source books");
  for (const bookName of ["adjusted", "raw"]) {
    const book = value.source[bookName];
    exact(book, ["request_parameters_sha256", "response_content_sha256", "provenance_by_symbol"],
      `Attempt 115 projection ${bookName} source`);
    digest(book.request_parameters_sha256,
      `Attempt 115 projection ${bookName} request hash`);
    digest(book.response_content_sha256,
      `Attempt 115 projection ${bookName} response hash`);
    exact(book.provenance_by_symbol, ["SPY", "BIL"],
      `Attempt 115 projection ${bookName} symbol provenance`);
    for (const symbol of ["SPY", "BIL"]) {
      const evidence = book.provenance_by_symbol[symbol];
      exact(evidence, [
        "content_hash", "retrieved_at", "final_two_normalized_bars", "request_sha256",
        "transport_receipts_sha256", "provenance_sha256",
      ], `Attempt 115 projection ${bookName} ${symbol} evidence`);
      for (const field of ["content_hash", "request_sha256", "transport_receipts_sha256",
        "provenance_sha256"]) {
        digest(evidence[field], `Attempt 115 projection ${bookName} ${symbol} ${field}`);
      }
      instant(evidence.retrieved_at,
        `Attempt 115 projection ${bookName} ${symbol} retrieved_at`);
      if (!Array.isArray(evidence.final_two_normalized_bars)
        || evidence.final_two_normalized_bars.length !== 2) {
        fail(`Attempt 115 projection ${bookName} ${symbol} must retain exactly two bars`);
      }
    }
  }
  exact(value.calendar_binding, [
    "content_hash", "retrieved_at", "request_sha256", "transport_receipts_sha256",
    "signal_session", "next_session",
  ], "Attempt 115 projection calendar binding");
  for (const field of ["content_hash", "request_sha256", "transport_receipts_sha256"]) {
    digest(value.calendar_binding[field], `Attempt 115 projection calendar ${field}`);
  }
  instant(value.calendar_binding.retrieved_at,
    "Attempt 115 projection calendar retrieved_at");
  plainObject(value.calendar_binding.signal_session,
    "Attempt 115 projection calendar signal session");
  plainObject(value.calendar_binding.next_session,
    "Attempt 115 projection calendar next session");
  digest(value.projection_sha256, "Attempt 115 settlement source projection hash");
  if (value.projection_sha256 !== sha256(projectionBody(value))) {
    fail("Attempt 115 settlement source projection self-hash is invalid");
  }
  return value;
}

export function buildAttempt115SettlementSourceProjection(privateCommitment) {
  plainObject(privateCommitment, "Attempt 115 private commitment");
  const acquisition = privateCommitment.payload?.acquisition;
  plainObject(acquisition, "Attempt 115 commitment acquisition");
  const calendar = acquisition.source?.calendar;
  plainObject(calendar, "Attempt 115 acquisition calendar evidence");
  const sessionIndex = calendar.sessions.findIndex(
    ({ date: sessionDate }) => sessionDate === acquisition.session.session_date,
  );
  if (sessionIndex < 0 || !calendar.sessions[sessionIndex + 1]) {
    fail("Attempt 115 acquisition calendar does not contain the signal and successor sessions");
  }
  const body = {
    schema_version: ATTEMPT115_SETTLEMENT_SOURCE_PROJECTION_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    commitment_sequence: privateCommitment.sequence,
    signal_session_date: acquisition.session.session_date,
    source_acquisition_sha256: acquisition.acquisition_sha256,
    session: structuredClone(acquisition.session),
    adjusted_close_rows: {
      SPY: structuredClone(acquisition.adjusted_close_rows.SPY),
      BIL: structuredClone(acquisition.adjusted_close_rows.BIL),
    },
    source: {
      adjusted: projectBookSource(acquisition.source.adjusted),
      raw: projectBookSource(acquisition.source.raw),
    },
    calendar_binding: {
      content_hash: calendar.content_hash,
      retrieved_at: calendar.retrieved_at,
      request_sha256: sha256(calendar.provenance.request),
      transport_receipts_sha256: calendar.provenance.transport_receipts_sha256,
      signal_session: structuredClone(calendar.sessions[sessionIndex]),
      next_session: structuredClone(calendar.sessions[sessionIndex + 1]),
    },
  };
  return deepFreeze(validateAttempt115SettlementSourceProjection({
    ...body,
    projection_sha256: sha256(body),
  }));
}

function calendarReceiptBody(value) {
  return withoutHash(value, "receipt_sha256");
}

function expectedProviderCalendarReconciliation(expectedSession, persistedCalendar) {
  plainObject(expectedSession, "Attempt 115 expected provider-calendar session");
  plainObject(persistedCalendar, "Attempt 115 persisted provider calendar");
  plainObject(persistedCalendar.provenance,
    "Attempt 115 persisted provider-calendar provenance");
  const body = {
    schema_version: ATTEMPT115_PROVIDER_CALENDAR_RECONCILIATION_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    reconciliation_scope: "PERSISTED_PROVIDER_CALENDAR_EVIDENCE_ONLY",
    calendar_id: "ALPACA_US_EQUITY_CALENDAR",
    provider: {
      name: persistedCalendar.provenance.provider,
      origin: persistedCalendar.provenance.origin,
      path: persistedCalendar.provenance.path,
      method: persistedCalendar.provenance.method,
      read_only: persistedCalendar.provenance.read_only,
    },
    signal_session_date: expectedSession.session_date,
    market_open_at: expectedSession.market_open_at,
    market_close_at: expectedSession.market_close_at,
    next_session_date: expectedSession.next_session_date,
    next_market_open_at: expectedSession.next_market_open_at,
    next_market_close_at: expectedSession.next_market_close_at,
    persisted_calendar: {
      content_hash: persistedCalendar.content_hash,
      retrieved_at: persistedCalendar.retrieved_at,
      request_sha256: sha256(persistedCalendar.provenance.request),
      response_sha256: expectedSession.calendar_response_sha256,
      transport_receipts_sha256: persistedCalendar.provenance.transport_receipts_sha256,
    },
    reconciled: true,
    independently_fetched: false,
    independent_origin_verified: false,
    provider_signature_verified: false,
  };
  return { ...body, receipt_sha256: sha256(body) };
}

export function buildAttempt115ProviderCalendarReconciliation({
  session,
  persistedCalendar,
} = {}) {
  return deepFreeze(validateAttempt115ProviderCalendarReconciliation(
    expectedProviderCalendarReconciliation(session, persistedCalendar),
    { expectedSession: session, persistedCalendar },
  ));
}

export function validateAttempt115ProviderCalendarReconciliation(value, {
  expectedSession,
  persistedCalendar,
} = {}) {
  exact(value, [
    "schema_version", "attempt_id", "reconciliation_scope", "calendar_id", "provider",
    "signal_session_date", "market_open_at", "market_close_at", "next_session_date",
    "next_market_open_at", "next_market_close_at", "persisted_calendar", "reconciled",
    "independently_fetched", "independent_origin_verified", "provider_signature_verified",
    "receipt_sha256",
  ], "Attempt 115 provider-calendar reconciliation");
  if (value.schema_version !== ATTEMPT115_PROVIDER_CALENDAR_RECONCILIATION_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || value.reconciliation_scope !== "PERSISTED_PROVIDER_CALENDAR_EVIDENCE_ONLY"
    || value.calendar_id !== "ALPACA_US_EQUITY_CALENDAR"
    || value.reconciled !== true
    || value.independently_fetched !== false
    || value.independent_origin_verified !== false
    || value.provider_signature_verified !== false) {
    fail("Attempt 115 provider-calendar reconciliation overclaims its evidence");
  }
  date(value.signal_session_date, "Attempt 115 calendar signal session");
  date(value.next_session_date, "Attempt 115 calendar next session");
  for (const field of ["market_open_at", "market_close_at", "next_market_open_at",
    "next_market_close_at"]) {
    instant(value[field], `Attempt 115 calendar ${field}`);
  }
  exact(value.provider, ["name", "origin", "path", "method", "read_only"],
    "Attempt 115 provider-calendar identity");
  if (typeof value.provider.name !== "string" || value.provider.name.length < 1
    || typeof value.provider.origin !== "string" || value.provider.origin.length < 1
    || typeof value.provider.path !== "string" || value.provider.path.length < 1
    || value.provider.method !== "GET" || value.provider.read_only !== true) {
    fail("Attempt 115 provider-calendar identity is invalid");
  }
  exact(value.persisted_calendar, [
    "content_hash", "retrieved_at", "request_sha256", "response_sha256",
    "transport_receipts_sha256",
  ], "Attempt 115 persisted provider-calendar binding");
  for (const field of ["content_hash", "request_sha256", "response_sha256",
    "transport_receipts_sha256"]) {
    digest(value.persisted_calendar[field], `Attempt 115 persisted calendar ${field}`);
  }
  instant(value.persisted_calendar.retrieved_at,
    "Attempt 115 persisted calendar retrieved_at");
  digest(value.receipt_sha256, "Attempt 115 calendar reconciliation self-hash");
  if (value.receipt_sha256 !== sha256(calendarReceiptBody(value))) {
    fail("Attempt 115 provider-calendar reconciliation self-hash is invalid");
  }
  const expected = expectedProviderCalendarReconciliation(expectedSession, persistedCalendar);
  if (stableStringify(value) !== stableStringify(expected)) {
    fail("Attempt 115 provider calendar differs from the persisted acquisition evidence");
  }
  return value;
}

export async function reconcileAttempt115ProviderCalendar({
  session,
  persistedCalendar,
} = {}, providerCalendarReconcile) {
  if (typeof providerCalendarReconcile !== "function") {
    fail("Attempt 115 requires a persisted provider-calendar reconciliation hook");
  }
  const result = await providerCalendarReconcile(deepFreeze({
    attempt_id: ATTEMPT115_ID,
    reconciliation_scope: "PERSISTED_PROVIDER_CALENDAR_EVIDENCE_ONLY",
    session: structuredClone(session),
    persisted_calendar_evidence: structuredClone(persistedCalendar),
  }));
  return deepFreeze(validateAttempt115ProviderCalendarReconciliation(result, {
    expectedSession: session,
    persistedCalendar,
  }));
}

function assuranceReceiptBody(value) {
  return withoutHash(value, "receipt_sha256");
}

export function validateAttempt115ForwardAnchorAssuranceReceipt(value, options = {}) {
  plainObject(options, "Attempt 115 assurance validation options");
  const forwardReceipt = options.forwardReceipt;
  const privateCommitment = options.privateCommitment ?? options.commitment;
  const previousPrivateCommitment = options.previousPrivateCommitment
    ?? options.previousCommitment
    ?? null;
  const explicitAnchor = options.anchor ?? null;
  const explicitCalendar = options.providerCalendar ?? options.officialCalendar ?? null;
  validateGitHubPublicationReceipt(forwardReceipt);
  if (forwardReceipt.schema_version !== GITHUB_PUBLICATION_RECEIPT_SCHEMA) {
    fail("Attempt 115 requires the current v4 forward publication receipt");
  }
  const activation = forwardReceipt.frozen_context.activation;
  validateForwardTrialLiveCommitment(privateCommitment, {
    activation,
    previousCommitment: previousPrivateCommitment,
  });
  const sourceAnchor = forwardReceipt.public_anchor_chain.at(-1);
  validateForwardTrialLiveAnchorManifest(sourceAnchor, privateCommitment, {
    activation,
    previousCommitment: previousPrivateCommitment,
  });
  exact(value, [
    "schema_version", "attempt_id", "commitment_sequence", "source_forward_receipt",
    "source_private_commitment", "execution_timing", "provider_calendar_reconciliation",
    "settlement_source_projection_sha256", "forward_receipt_sha256",
    "forward_anchor_manifest_sha256", "private_bundle_sha256", "signal_session",
    "next_market_open_at", "verification_observed_at", "forward_workflow",
    "assurance", "receipt_sha256",
  ], "Attempt 115 forward-anchor assurance receipt");
  if (value.schema_version !== ATTEMPT115_FORWARD_ANCHOR_ASSURANCE_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID) {
    fail("Attempt 115 forward-anchor assurance envelope is invalid");
  }
  positiveInteger(value.commitment_sequence, "Attempt 115 assurance commitment sequence");
  if (value.commitment_sequence !== privateCommitment.sequence
    || value.commitment_sequence !== forwardReceipt.commitment_sequence) {
    fail("Attempt 115 assurance sequence differs across the public and private commitments");
  }
  exact(value.source_forward_receipt, [
    "schema_version", "receipt_sha256", "anchor_manifest_sha256", "publication_commit_sha",
    "workflow_run_id", "verification_observed_at",
  ], "Attempt 115 source forward receipt");
  if (stableStringify(value.source_forward_receipt) !== stableStringify({
    schema_version: forwardReceipt.schema_version,
    receipt_sha256: forwardReceipt.receipt_sha256,
    anchor_manifest_sha256: forwardReceipt.manifest_sha256,
    publication_commit_sha: forwardReceipt.publication_commit.sha,
    workflow_run_id: forwardReceipt.run.id,
    verification_observed_at: forwardReceipt.verification_observed_at,
  })) fail("Attempt 115 assurance changes the source forward receipt identity");
  exact(value.source_private_commitment, [
    "schema_version", "commitment_sha256", "previous_commitment_sha256",
    "source_acquisition_sha256", "signal_session_date",
  ], "Attempt 115 source private commitment");
  const acquisition = privateCommitment.payload.acquisition;
  if (stableStringify(value.source_private_commitment) !== stableStringify({
    schema_version: privateCommitment.schema_version,
    commitment_sha256: privateCommitment.commitment_sha256,
    previous_commitment_sha256: privateCommitment.previous_commitment_sha256,
    source_acquisition_sha256: acquisition.acquisition_sha256,
    signal_session_date: acquisition.session.session_date,
  })) fail("Attempt 115 assurance changes the source private commitment identity");
  if (privateCommitment.commitment_sha256 !== forwardReceipt.anchor_at_head.private_bundle_sha256
    || privateCommitment.commitment_sha256
      !== forwardReceipt.public_anchor_chain.at(-1)?.private_bundle_sha256
    || privateCommitment.previous_commitment_sha256
      !== forwardReceipt.anchor_at_head.previous_private_bundle_sha256) {
    fail("Attempt 115 private commitment does not open the published forward anchor hash");
  }
  if (value.forward_receipt_sha256 !== forwardReceipt.receipt_sha256
    || value.forward_anchor_manifest_sha256 !== forwardReceipt.manifest_sha256
    || value.private_bundle_sha256 !== privateCommitment.commitment_sha256
    || value.signal_session !== acquisition.session.session_date
    || value.next_market_open_at !== acquisition.session.next_market_open_at
    || value.verification_observed_at !== forwardReceipt.verification_observed_at) {
    fail("Attempt 115 flat settlement binding differs from the validated source evidence");
  }
  exact(value.forward_workflow, ["run_id", "head_sha", "completed_at"],
    "Attempt 115 forward workflow binding");
  if (stableStringify(value.forward_workflow) !== stableStringify({
    run_id: forwardReceipt.run.id,
    head_sha: forwardReceipt.run.head_sha,
    completed_at: forwardReceipt.run.updated_at,
  })) fail("Attempt 115 forward workflow binding changed");
  if (explicitAnchor !== null
    && stableStringify(explicitAnchor) !== stableStringify(sourceAnchor)) {
    fail("Attempt 115 explicit anchor differs from the validated v4 receipt anchor");
  }
  exact(value.execution_timing, [
    "signal_session_date", "next_session_date", "next_market_open_at", "strictly_before",
    "workflow_created_at", "workflow_completed_at", "latest_required_step_completed_at",
    "forward_publication_observed_at", "verification_observed_before_next_open",
  ], "Attempt 115 execution timing");
  const timing = validateAttempt115StrictPreOpenTiming(
    forwardReceipt,
    acquisition.session.next_market_open_at,
  );
  if (stableStringify(value.execution_timing) !== stableStringify({
    signal_session_date: acquisition.session.session_date,
    next_session_date: acquisition.session.next_session_date,
    next_market_open_at: acquisition.session.next_market_open_at,
    strictly_before: true,
    ...timing,
  })) fail("Attempt 115 execution timing differs from the committed next-open boundary");
  validateAttempt115ProviderCalendarReconciliation(
    value.provider_calendar_reconciliation,
    {
      expectedSession: acquisition.session,
      persistedCalendar: acquisition.source.calendar,
    },
  );
  if (explicitCalendar !== null
    && stableStringify(explicitCalendar)
      !== stableStringify(value.provider_calendar_reconciliation)) {
    fail("Attempt 115 explicit provider calendar differs from the assurance receipt");
  }
  const projection = buildAttempt115SettlementSourceProjection(privateCommitment);
  digest(value.settlement_source_projection_sha256,
    "Attempt 115 settlement source projection hash");
  if (value.settlement_source_projection_sha256 !== projection.projection_sha256) {
    fail("Attempt 115 settlement source projection differs from the validated private bundle");
  }
  exact(value.assurance, [
    "existing_forward_anchor_reused", "second_anchor_chain_created",
    "full_private_commitment_validated", "public_private_hash_binding_verified",
    "strict_pre_next_open_publication_verified", "persisted_provider_calendar_reconciled",
    "independent_official_calendar_verified",
    "private_bundle_revalidated", "public_anchor_revalidated",
    "workflow_completed_strictly_before_next_open",
    "verification_observed_strictly_before_next_open", "public_platform_record_reverified",
    "zero_target_override_surface",
    "provider_signature_verified", "broker_execution_verified", "performance_inference_permitted",
  ], "Attempt 115 forward-anchor assurance");
  const observedBeforeNextOpen = timing.verification_observed_before_next_open;
  if (stableStringify(value.assurance) !== stableStringify({
    existing_forward_anchor_reused: true,
    second_anchor_chain_created: false,
    full_private_commitment_validated: true,
    public_private_hash_binding_verified: true,
    strict_pre_next_open_publication_verified: true,
    persisted_provider_calendar_reconciled: true,
    independent_official_calendar_verified: false,
    private_bundle_revalidated: true,
    public_anchor_revalidated: true,
    workflow_completed_strictly_before_next_open: true,
    verification_observed_strictly_before_next_open: observedBeforeNextOpen,
    public_platform_record_reverified: true,
    zero_target_override_surface: true,
    provider_signature_verified: false,
    broker_execution_verified: false,
    performance_inference_permitted: false,
  })) fail("Attempt 115 forward-anchor assurance boundary is invalid");
  digest(value.receipt_sha256, "Attempt 115 forward-anchor assurance self-hash");
  if (value.receipt_sha256 !== sha256(assuranceReceiptBody(value))) {
    fail("Attempt 115 forward-anchor assurance self-hash is invalid");
  }
  return value;
}

export async function buildAttempt115ForwardAnchorAssuranceReceipt({
  forwardReceipt,
  privateCommitment,
  previousPrivateCommitment = null,
} = {}, {
  providerCalendarReconcile,
  officialCalendarReconcile,
} = {}) {
  validateGitHubPublicationReceipt(forwardReceipt);
  const calendarReconcile = providerCalendarReconcile ?? officialCalendarReconcile;
  const activation = forwardReceipt.frozen_context.activation;
  validateForwardTrialLiveCommitment(privateCommitment, {
    activation,
    previousCommitment: previousPrivateCommitment,
  });
  const acquisition = privateCommitment.payload.acquisition;
  const calendarReconciliation = await reconcileAttempt115ProviderCalendar({
    session: acquisition.session,
    persistedCalendar: acquisition.source.calendar,
  }, calendarReconcile);
  const timing = validateAttempt115StrictPreOpenTiming(
    forwardReceipt,
    acquisition.session.next_market_open_at,
  );
  const projection = buildAttempt115SettlementSourceProjection(privateCommitment);
  const body = {
    schema_version: ATTEMPT115_FORWARD_ANCHOR_ASSURANCE_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    commitment_sequence: privateCommitment.sequence,
    source_forward_receipt: {
      schema_version: forwardReceipt.schema_version,
      receipt_sha256: forwardReceipt.receipt_sha256,
      anchor_manifest_sha256: forwardReceipt.manifest_sha256,
      publication_commit_sha: forwardReceipt.publication_commit.sha,
      workflow_run_id: forwardReceipt.run.id,
      verification_observed_at: forwardReceipt.verification_observed_at,
    },
    source_private_commitment: {
      schema_version: privateCommitment.schema_version,
      commitment_sha256: privateCommitment.commitment_sha256,
      previous_commitment_sha256: privateCommitment.previous_commitment_sha256,
      source_acquisition_sha256: acquisition.acquisition_sha256,
      signal_session_date: acquisition.session.session_date,
    },
    execution_timing: {
      signal_session_date: acquisition.session.session_date,
      next_session_date: acquisition.session.next_session_date,
      next_market_open_at: acquisition.session.next_market_open_at,
      strictly_before: true,
      ...timing,
    },
    provider_calendar_reconciliation: structuredClone(calendarReconciliation),
    settlement_source_projection_sha256: projection.projection_sha256,
    forward_receipt_sha256: forwardReceipt.receipt_sha256,
    forward_anchor_manifest_sha256: forwardReceipt.manifest_sha256,
    private_bundle_sha256: privateCommitment.commitment_sha256,
    signal_session: acquisition.session.session_date,
    next_market_open_at: acquisition.session.next_market_open_at,
    verification_observed_at: forwardReceipt.verification_observed_at,
    forward_workflow: {
      run_id: forwardReceipt.run.id,
      head_sha: forwardReceipt.run.head_sha,
      completed_at: forwardReceipt.run.updated_at,
    },
    assurance: {
      existing_forward_anchor_reused: true,
      second_anchor_chain_created: false,
      full_private_commitment_validated: true,
      public_private_hash_binding_verified: true,
      strict_pre_next_open_publication_verified: true,
      persisted_provider_calendar_reconciled: true,
      independent_official_calendar_verified: false,
      private_bundle_revalidated: true,
      public_anchor_revalidated: true,
      workflow_completed_strictly_before_next_open: true,
      verification_observed_strictly_before_next_open:
        timing.verification_observed_before_next_open,
      public_platform_record_reverified: true,
      zero_target_override_surface: true,
      provider_signature_verified: false,
      broker_execution_verified: false,
      performance_inference_permitted: false,
    },
  };
  return deepFreeze(validateAttempt115ForwardAnchorAssuranceReceipt({
    ...body,
    receipt_sha256: sha256(body),
  }, {
    forwardReceipt,
    privateCommitment,
    previousPrivateCommitment,
  }));
}

export function canonicalAttempt115ForwardAnchorAssuranceReceiptJson(value, inputs) {
  validateAttempt115ForwardAnchorAssuranceReceipt(value, inputs);
  return `${JSON.stringify(value, null, 2)}\n`;
}
