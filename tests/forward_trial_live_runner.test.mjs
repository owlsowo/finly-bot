import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildLiveActivationFromCalendar,
  calendarResultToActivationSession,
  newYorkMarketInstant,
  publishActivationWriteOnce,
  verifyExistingLiveActivation,
} from "../research/run_forward_trial_live.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

function calendarResult() {
  return {
    start: "2026-08-31",
    end: "2026-09-04",
    sessions: [
      { date: "2026-08-31", open: "09:30:00", close: "16:00:00" },
      { date: "2026-09-01", open: "09:30:00", close: "16:00:00" },
      { date: "2026-09-02", open: "09:30:00", close: "16:00:00" },
    ],
    content_hash: digest("a"),
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
      request: { start: "2026-08-31", end: "2026-09-04", date_type: "TRADING" },
    },
  };
}

test("New York session conversion handles daylight and standard time exactly", () => {
  assert.equal(newYorkMarketInstant("2026-08-31", "09:30:00"), "2026-08-31T13:30:00.000Z");
  assert.equal(newYorkMarketInstant("2026-08-31", "16:00:00"), "2026-08-31T20:00:00.000Z");
  assert.equal(newYorkMarketInstant("2026-11-30", "09:30:00"), "2026-11-30T14:30:00.000Z");
  assert.equal(newYorkMarketInstant("2026-11-30", "16:00:00"), "2026-11-30T21:00:00.000Z");
});

test("official read-only calendar maps to the pinned live activation session", () => {
  const session = calendarResultToActivationSession(calendarResult());
  assert.equal(session.session_date, "2026-08-31");
  assert.equal(session.market_close_at, "2026-08-31T20:00:00.000Z");
  assert.equal(session.bar_eligible_at, "2026-08-31T20:15:00.000Z");
  assert.equal(session.next_session_date, "2026-09-01");
  assert.equal(session.next_market_close_at, "2026-09-01T20:00:00.000Z");
  assert.match(session.calendar_request_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(session.calendar_response_sha256, digest("a"));
  assert.equal(session.provider_signature_verified, false);
});

test("live activation uses only the fixed calendar read and has no broker authority", async () => {
  const calls = [];
  const client = {
    async getMarketCalendar(options) {
      calls.push(structuredClone(options));
      return calendarResult();
    },
  };
  const activation = await buildLiveActivationFromCalendar({
    client,
    credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
    frozenAt: "2026-08-29T12:00:00.000Z",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].start, "2026-08-31");
  assert.equal(calls[0].end, "2026-09-04");
  assert.equal(activation.payload.activation_mode, "PINNED_FIRST_ELIGIBLE");
  assert.equal(activation.payload.authority.broker_mutation_authorized, false);
  assert.equal(activation.payload.authority.order_payload, null);
  assert.equal(JSON.stringify(activation).includes("paper-secret-key"), false);
});

test("activation publication is byte-identical, write-once, and clean-clone verifiable", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-runner-"));
  try {
    const activation = await buildLiveActivationFromCalendar({
      client: { getMarketCalendar: async () => calendarResult() },
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      frozenAt: "2026-08-29T12:00:00.000Z",
    });
    const path = resolve(root, "research/forward_trial_live/activation.json");
    assert.equal(await publishActivationWriteOnce(path, activation, { projectRoot: root }), "created");
    assert.equal(await publishActivationWriteOnce(path, activation, { projectRoot: root }), "verified");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), activation);
    const verification = await verifyExistingLiveActivation({ projectRoot: root });
    assert.equal(verification.status, "VERIFIED");
    assert.equal(verification.broker_mutation_authorized, false);

    const changed = structuredClone(activation);
    changed.payload.frozen_at = "2026-08-29T12:00:01.000Z";
    await assert.rejects(
      () => publishActivationWriteOnce(path, changed, { projectRoot: root }),
      /hash is invalid|different bytes/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("activation publication refuses a symlinked persistent parent", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-symlink-"));
  const outside = await mkdtemp(resolve(tmpdir(), "finly-live-outside-"));
  try {
    await writeFile(resolve(outside, "placeholder"), "safe\n");
    await symlink(outside, resolve(root, "linked"), "dir");
    const activation = await buildLiveActivationFromCalendar({
      client: { getMarketCalendar: async () => calendarResult() },
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      frozenAt: "2026-08-29T12:00:00.000Z",
    });
    await assert.rejects(
      () => publishActivationWriteOnce(resolve(root, "linked/activation.json"), activation, { projectRoot: root }),
      /must not traverse a symlink/,
    );
  } finally {
    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  }
});

test("runner source exposes no order or arbitrary-network surface", async () => {
  const source = await readFile(new URL("../research/run_forward_trial_live.mjs", import.meta.url), "utf8");
  assert.match(source, /getMarketCalendar/);
  for (const forbidden of ["submitOrder", "placeOrder", "cancelOrder", "replaceOrder", "fetch(", "--url", "--output"]) {
    assert.equal(source.includes(forbidden), false, `runner unexpectedly contains ${forbidden}`);
  }
});
