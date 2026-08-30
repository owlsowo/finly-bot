import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFreshCurrentEconomicBundle,
  resolveCompletedDailyBarBoundary,
} from "../lib/current_economic_bundle.mjs";

const FRIDAY = { date: "2026-08-28", open: "09:30", close: "16:00" };
const MONDAY = { date: "2026-08-31", open: "09:30", close: "16:00" };

function dailyBars({ incompleteMonday = false, cash = false } = {}) {
  const end = Date.UTC(2026, 7, 28, 4);
  const start = end - 299 * 86_400_000;
  let close = cash ? 90 : 100;
  const bars = Array.from({ length: 300 }, (_, index) => {
    close *= cash ? 1.0001 : 1.0007 + 0.001 * Math.sin(index * 0.4);
    return { t: new Date(start + index * 86_400_000).toISOString(), c: close };
  });
  if (incompleteMonday) bars.at(-1).t = "2026-08-31T04:00:00.000Z";
  return bars;
}

function clients({ incompleteMonday = false } = {}) {
  const requests = [];
  const historicalClient = {
    getMarketCalendar: async (request) => {
      requests.push({ kind: "calendar", request });
      return { calendar: [FRIDAY, MONDAY] };
    },
    getStockBars: async (symbol, request) => {
      requests.push({ kind: "bars", symbol, request });
      return { bars: dailyBars({ incompleteMonday, cash: symbol === "BIL" }) };
    },
  };
  const paperClient = {
    getAccount: async () => ({
      status: "ACTIVE",
      equity: "100000",
      trading_blocked: false,
      account_blocked: false,
    }),
    getPositions: async () => [],
  };
  return { historicalClient, paperClient, requests };
}

test("daily-bar boundary excludes the open and just-closed session until the declared delay elapses", () => {
  const calendar = [FRIDAY, MONDAY];
  const intraday = resolveCompletedDailyBarBoundary(calendar, { asOf: "2026-08-31T18:00:00.000Z" });
  assert.equal(intraday.sessionDate, "2026-08-28");
  assert.equal(intraday.marketCloseAt, "2026-08-28T20:00:00.000Z");
  assert.equal(intraday.eligibleAt, "2026-08-28T20:15:00.000Z");

  const fourteenMinutesAfterClose = resolveCompletedDailyBarBoundary(calendar, { asOf: "2026-08-31T20:14:59.999Z" });
  assert.equal(fourteenMinutesAfterClose.sessionDate, "2026-08-28");

  const eligible = resolveCompletedDailyBarBoundary(calendar, { asOf: "2026-08-31T20:15:00.000Z" });
  assert.equal(eligible.sessionDate, "2026-08-31");
  assert.equal(eligible.marketCloseAt, "2026-08-31T20:00:00.000Z");
});

test("calendar close conversion respects the New York DST boundary", () => {
  const calendar = [
    { date: "2026-10-30", open: "09:30", close: "16:00" },
    { date: "2026-11-02", open: "09:30", close: "16:00" },
  ];
  const beforeFallBack = resolveCompletedDailyBarBoundary(calendar, { asOf: "2026-10-30T20:15:00.000Z" });
  assert.equal(beforeFallBack.marketCloseAt, "2026-10-30T20:00:00.000Z");
  const afterFallBack = resolveCompletedDailyBarBoundary(calendar, { asOf: "2026-11-02T21:15:00.000Z" });
  assert.equal(afterFallBack.marketCloseAt, "2026-11-02T21:00:00.000Z");
});

test("fresh bundle uses fetch completion as availability and bounds the query to a completed session", async () => {
  const { historicalClient, paperClient, requests } = clients();
  const asOf = "2026-08-31T18:00:00.000Z";
  const bundle = await buildFreshCurrentEconomicBundle({
    historicalClient,
    paperClient,
    now: () => new Date(asOf),
  });
  assert.equal(bundle.generated_at, asOf);
  assert.equal(bundle.deterministic_decision.source_available_at, asOf);
  assert.equal(bundle.data.source_fetch_completed_at, asOf);
  assert.equal(bundle.data.completed_session_boundary.session_date, "2026-08-28");
  assert.equal(bundle.deterministic_decision.latest_observation.completed_session_boundary.session_date, "2026-08-28");
  assert.equal(bundle.deterministic_decision.point_in_time_controls.daily_bar_timestamp_not_used_as_availability, true);
  assert.equal(bundle.deterministic_decision.point_in_time_controls.incomplete_current_session_rejected, true);
  assert.notEqual(bundle.deterministic_decision.source_available_at, bundle.deterministic_decision.latest_observation.spy_observed_at);
  const barRequests = requests.filter((request) => request.kind === "bars");
  assert.equal(barRequests.length, 2);
  assert.ok(barRequests.every(({ request }) => request.end === "2026-08-28T20:15:00.000Z"));
  assert.equal(bundle.mutation_requested, false);
});

test("an incomplete current-session daily bar is rejected even when returned by the provider", async () => {
  const { historicalClient, paperClient } = clients({ incompleteMonday: true });
  await assert.rejects(
    () => buildFreshCurrentEconomicBundle({
      historicalClient,
      paperClient,
      now: () => new Date("2026-08-31T18:00:00.000Z"),
    }),
    /incomplete session after the completed-session boundary/,
  );
});
