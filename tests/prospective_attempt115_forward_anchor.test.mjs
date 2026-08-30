import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  ATTEMPT115_PROVIDER_CALENDAR_RECONCILIATION_SCHEMA,
  buildAttempt115ProviderCalendarReconciliation,
  reconcileAttempt115ProviderCalendar,
  validateAttempt115ForwardAnchorAssuranceReceipt,
  validateAttempt115ProviderCalendarReconciliation,
  validateAttempt115StrictPreOpenTiming,
} from "../scripts/verify_attempt115_forward_anchor.mjs";

const digest = (value) => sha256({ fixture: value });

function sessionFixture() {
  return {
    calendar_provider: "Alpaca Trading API",
    calendar_endpoint: "/v2/calendar",
    calendar_request_sha256: digest("calendar-request"),
    calendar_response_sha256: digest("calendar-response"),
    provider_signature_verified: false,
    session_date: "2026-08-31",
    market_open_at: "2026-08-31T13:30:00.000Z",
    market_close_at: "2026-08-31T20:00:00.000Z",
    bar_eligible_at: "2026-08-31T20:15:00.000Z",
    next_session_date: "2026-09-01",
    next_market_open_at: "2026-09-01T13:30:00.000Z",
    next_market_close_at: "2026-09-01T20:00:00.000Z",
  };
}

function persistedCalendarFixture(session = sessionFixture()) {
  const request = { start: "2025-09-01", end: session.next_session_date, date_type: "TRADING" };
  session.calendar_request_sha256 = sha256(request);
  const contentHash = session.calendar_response_sha256;
  return {
    start: "2025-09-01",
    end: session.next_session_date,
    sessions: [{ date: session.session_date }, { date: session.next_session_date }],
    content_hash: contentHash,
    retrieved_at: "2026-08-31T20:15:59.000Z",
    provenance: {
      provider: "Alpaca",
      origin: "https://paper-api.alpaca.markets",
      path: "/v2/calendar",
      method: "GET",
      transport: "HTTPS",
      read_only: true,
      complete: true,
      authentication: "caller-supplied; redacted",
      page_count: 1,
      request,
      request_started_at: "2026-08-31T20:15:58.000Z",
      response_received_at: "2026-08-31T20:15:59.000Z",
      transport_receipts: [],
      transport_receipts_sha256: digest("transport-receipts"),
    },
  };
}

function forwardTimingFixture({ completedAt, observedAt } = {}) {
  return {
    run: {
      created_at: "2026-09-01T13:00:00.000Z",
      updated_at: completedAt ?? "2026-09-01T13:20:00.000Z",
      required_job_steps: [{ completed_at: "2026-09-01T13:19:59.000Z" }],
    },
    verification_observed_at: observedAt ?? "2026-09-01T13:25:00.000Z",
  };
}

test("Attempt 115 provider-calendar receipt is a narrow exact echo of persisted evidence", async () => {
  const session = sessionFixture();
  const persistedCalendar = persistedCalendarFixture(session);
  const expected = buildAttempt115ProviderCalendarReconciliation({ session, persistedCalendar });
  assert.equal(expected.schema_version, ATTEMPT115_PROVIDER_CALENDAR_RECONCILIATION_SCHEMA);
  assert.equal(expected.reconciliation_scope, "PERSISTED_PROVIDER_CALENDAR_EVIDENCE_ONLY");
  assert.equal(expected.independently_fetched, false);
  assert.equal(expected.independent_origin_verified, false);
  assert.equal(expected.provider_signature_verified, false);
  assert.equal(validateAttempt115ProviderCalendarReconciliation(expected, {
    expectedSession: session,
    persistedCalendar,
  }), expected);

  const reconciled = await reconcileAttempt115ProviderCalendar({ session, persistedCalendar },
    async () => structuredClone(expected));
  assert.deepEqual(reconciled, expected);
  await assert.rejects(reconcileAttempt115ProviderCalendar({ session, persistedCalendar }),
    /requires a persisted provider-calendar reconciliation hook/iu);
});

test("Attempt 115 rejects a rehashed arbitrary calendar claim from the hook", async () => {
  const session = sessionFixture();
  const persistedCalendar = persistedCalendarFixture(session);
  const expected = buildAttempt115ProviderCalendarReconciliation({ session, persistedCalendar });
  const arbitrary = structuredClone(expected);
  arbitrary.provider.name = "self-asserted calendar";
  const body = { ...arbitrary };
  delete body.receipt_sha256;
  arbitrary.receipt_sha256 = sha256(body);

  await assert.rejects(reconcileAttempt115ProviderCalendar({ session, persistedCalendar },
    async () => arbitrary), /differs from the persisted acquisition evidence/iu);
});

test("Attempt 115 platform completion is pre-open while later observation stays admissible", () => {
  const nextOpen = "2026-09-01T13:30:00.000Z";
  assert.deepEqual(validateAttempt115StrictPreOpenTiming(forwardTimingFixture(), nextOpen), {
    workflow_created_at: "2026-09-01T13:00:00.000Z",
    workflow_completed_at: "2026-09-01T13:20:00.000Z",
    latest_required_step_completed_at: "2026-09-01T13:19:59.000Z",
    forward_publication_observed_at: "2026-09-01T13:25:00.000Z",
    verification_observed_before_next_open: true,
  });
  assert.throws(() => validateAttempt115StrictPreOpenTiming(forwardTimingFixture({
    completedAt: nextOpen,
    observedAt: nextOpen,
  }), nextOpen), /not strictly before/iu);
  assert.equal(validateAttempt115StrictPreOpenTiming(forwardTimingFixture({
    observedAt: "2026-09-02T13:30:00.000Z",
  }), nextOpen).verification_observed_before_next_open, false);
  assert.throws(() => validateAttempt115StrictPreOpenTiming(forwardTimingFixture({
    observedAt: "2026-09-01T13:19:59.000Z",
  }), nextOpen), /not chronological/iu);
});

test("Attempt 115 exact assurance validator does not trust top-level success booleans", () => {
  const forged = {
    schema_version: "finly_attempt115_forward_anchor_assurance_receipt.v1",
    assurance: {
      private_bundle_revalidated: true,
      public_anchor_revalidated: true,
      workflow_completed_strictly_before_next_open: true,
      verification_observed_strictly_before_next_open: true,
      public_platform_record_reverified: true,
    },
  };
  assert.throws(() => validateAttempt115ForwardAnchorAssuranceReceipt(forged, {
    forwardReceipt: { schema_version: "finly_forward_trial_live_github_publication_receipt.v4" },
    commitment: { commitment_sha256: digest("forged-private") },
    officialCalendar: { reconciled: true },
  }), /must contain exactly|plain object/iu);
});
