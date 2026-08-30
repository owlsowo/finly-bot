import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  FORWARD_TRIAL_LIVE_ACTIVATION_PATH,
  FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING_PATH,
  FORWARD_TRIAL_LIVE_PRIVATE_COMMITMENT_DIRECTORY,
  FORWARD_TRIAL_LIVE_PUBLIC_ANCHOR_DIRECTORY,
  buildLiveAcquisitionFromMarketData,
  buildLiveActivationFromCalendar,
  calendarResultToActivationSession,
  loadPrivateCommitmentChain,
  loadPublicAnchors,
  newYorkMarketInstant,
  publishActivationWriteOnce,
  publishSignalBundleWriteOnce,
  verifyFrozenImplementationSources,
  verifyFrozenRuntimeEnvironment,
  verifyExistingLiveActivation,
} from "../research/run_forward_trial_live.mjs";
import {
  FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING,
  FORWARD_TRIAL_LIVE_SYMBOLS,
  buildForwardTrialLiveAcquisition,
  buildForwardTrialLiveAnchorManifest,
  buildForwardTrialLiveCommitment,
  forwardTrialLiveCommitmentFilename,
  hashForwardTrialLiveValue,
} from "../research/forward_trial_live_core.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const canonicalBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;
const LIVE_ACTIVATION = JSON.parse(await readFile(
  new URL("../research/forward_trial_live/activation.json", import.meta.url),
  "utf8",
));
const TEST_RUNTIME_ENVIRONMENT_INPUTS = Object.freeze({
  execArgv: [],
  environment: {},
  versions: process.versions,
  fetchFunction: globalThis.fetch,
});

async function seedRuntimeFreeze(root) {
  for (const path of [
    FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING_PATH,
    ...Object.keys(FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING.runtime_source_files),
  ]) {
    const destination = resolve(root, path);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await copyFile(new URL(`../${path}`, import.meta.url), destination);
  }
}

function rehashAnchor(anchor) {
  const body = { ...anchor };
  delete body.manifest_sha256;
  anchor.manifest_sha256 = hashForwardTrialLiveValue(body);
  return anchor;
}

function anchorFilename(anchor) {
  return `${String(anchor.commitment_sequence).padStart(8, "0")}_${anchor.manifest_sha256.slice(7)}.json`;
}

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

function weekdaysEnding(endDate, count) {
  const dates = [];
  const cursor = new Date(`${endDate}T12:00:00.000Z`);
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function fullCalendarResult() {
  const sessions = weekdaysEnding("2026-08-31", 253)
    .map((date) => ({ date, open: "09:30:00", close: "16:00:00" }));
  sessions.push({ date: "2026-09-01", open: "09:30:00", close: "16:00:00" });
  const start = "2025-06-27";
  const end = "2026-09-14";
  const requestStartedAt = "2026-08-31T20:15:29.000Z";
  const responseReceivedAt = "2026-08-31T20:15:30.000Z";
  const transportReceipts = [{
    request_started_at: requestStartedAt,
    response_received_at: responseReceivedAt,
    origin_http_date: responseReceivedAt,
    origin_http_date_source: "HTTPS_RESPONSE_DATE_HEADER",
    maximum_origin_clock_skew_seconds: 300,
    local_clock_verified: false,
    provider_signature_verified: false,
  }];
  return {
    start,
    end,
    sessions,
    content_hash: hashForwardTrialLiveValue({ schema: "finly.market-calendar.v1", start, end, sessions }),
    retrieved_at: responseReceivedAt,
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
      request: { start, end, date_type: "TRADING" },
      request_started_at: requestStartedAt,
      response_received_at: responseReceivedAt,
      transport_receipts: transportReceipts,
      transport_receipts_sha256: hashForwardTrialLiveValue(transportReceipts),
    },
  };
}

function marketDataClient({
  omitSessionFor = null,
  beforeEligibility = false,
  requestBeforeEligibility = false,
  priceNudge = 0,
} = {}) {
  const dates = weekdaysEnding("2026-08-31", 253);
  return {
    getMarketCalendar: async () => fullCalendarResult(),
    getDailyBars: async (symbol, options) => {
      const symbolIndex = FORWARD_TRIAL_LIVE_SYMBOLS.indexOf(symbol);
      assert.ok(symbolIndex >= 0);
      assert.equal(options.start, dates[0]);
      assert.equal(options.end, "2026-08-31");
      const selected = symbol === omitSessionFor ? dates.filter((_, index) => index !== 100) : dates;
      const rows = selected.map((date, index) => {
        const base = 50 + symbolIndex * 5;
        const close = (base * (1 + 0.0004 * index + 0.001 * Math.sin(index / 8 + symbolIndex))) + priceNudge;
        return {
          session_date: date,
          timestamp: `${date}T04:00:00.000Z`,
          open: close - 0.25,
          high: close + 0.5,
          low: close - 0.5,
          close,
          volume: 1_000 + index,
          trade_count: 10 + index,
          vwap: close - 0.05,
        };
      });
      const book = (adjustment) => {
        const orderIndex = symbolIndex * 2 + (adjustment === "raw" ? 0 : 1);
        const retrievedAt = beforeEligibility
          ? "2026-08-31T20:14:59.000Z"
          : new Date(Date.parse("2026-08-31T20:16:00.000Z") + orderIndex * 10 + 5).toISOString();
        const bars = rows.map((row) => ({ ...row }));
        const request = {
          symbol,
          start: options.start,
          end: options.end,
          timeframe: "1Day",
          feed: "iex",
          adjustment,
          sort: "asc",
          limit: 10_000,
        };
        const requestStartedAt = beforeEligibility || requestBeforeEligibility
          ? "2026-08-31T20:14:58.000Z"
          : new Date(Date.parse(retrievedAt) - 5).toISOString();
        const transportReceipts = [{
          request_started_at: requestStartedAt,
          response_received_at: retrievedAt,
          origin_http_date: beforeEligibility ? "2026-08-31T20:14:59.000Z" : retrievedAt.replace(/\.\d{3}Z$/, ".000Z"),
          origin_http_date_source: "HTTPS_RESPONSE_DATE_HEADER",
          maximum_origin_clock_skew_seconds: 300,
          local_clock_verified: false,
          provider_signature_verified: false,
        }];
        return {
          bars,
          content_hash: hashForwardTrialLiveValue({
            schema: "finly.forward-daily-bars.v1",
            symbol,
            adjustment,
            start: options.start,
            end: options.end,
            bars,
          }),
          retrieved_at: retrievedAt,
          provenance: {
            provider: "Alpaca",
            origin: "https://data.alpaca.markets",
            path: `/v2/stocks/${symbol}/bars`,
            method: "GET",
            transport: "HTTPS",
            read_only: true,
            complete: true,
            authentication: "caller-supplied; redacted",
            page_count: 1,
            request,
            request_started_at: requestStartedAt,
            response_received_at: retrievedAt,
            transport_receipts: transportReceipts,
            transport_receipts_sha256: hashForwardTrialLiveValue(transportReceipts),
          },
        };
      };
      const raw = book("raw");
      const all = book("all");
      return { symbol, start: options.start, end: options.end, retrieved_at: all.retrieved_at, raw, all };
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

test("live acquisition requires every official session and binds transport-fresh panel hashes", async () => {
  const activation = await buildLiveActivationFromCalendar({
    client: { getMarketCalendar: async () => calendarResult() },
    credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
    frozenAt: "2026-08-29T12:00:00.000Z",
  });
  const acquisition = await buildLiveAcquisitionFromMarketData({
    client: marketDataClient(),
    credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
    activation,
  });
  assert.equal(acquisition.session.session_date, "2026-08-31");
  assert.equal(acquisition.retrieved_at, "2026-08-31T20:16:00.395Z");
  assert.equal(acquisition.adjusted_close_rows.SPY.length, 253);
  assert.equal(acquisition.raw_close_rows.SPY.length, 2);
  assert.match(acquisition.source.adjusted.request_parameters_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(acquisition.source.adjusted.response_content_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(
    acquisition.source.adjusted.response_content_sha256,
    acquisition.source.raw.response_content_sha256,
  );
  assert.equal(acquisition.source.adjusted.provenance_by_symbol.SPY.provenance.transport_receipts.length, 1);
  assert.equal(acquisition.source.adjusted.provenance_by_symbol.SPY.bars.length, 253);
  assert.equal(JSON.stringify(acquisition).includes("paper-secret-key"), false);
});

test("live acquisition fails before commitment on a missing official session or pre-eligibility retrieval", async () => {
  const activation = await buildLiveActivationFromCalendar({
    client: { getMarketCalendar: async () => calendarResult() },
    credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
    frozenAt: "2026-08-29T12:00:00.000Z",
  });
  await assert.rejects(
    () => buildLiveAcquisitionFromMarketData({
      client: marketDataClient({ omitSessionFor: "SPY" }),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    }),
    /does not contain every official session/,
  );
  await assert.rejects(
    () => buildLiveAcquisitionFromMarketData({
      client: marketDataClient({ beforeEligibility: true }),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    }),
    /before the close-plus-15-minute boundary/,
  );
  await assert.rejects(
    () => buildLiveAcquisitionFromMarketData({
      client: marketDataClient({ requestBeforeEligibility: true }),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    }),
    /began before the close-plus-15-minute boundary/,
  );
});

test("activation publication is byte-identical, write-once, and clean-clone verifiable", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-runner-"));
  try {
    const activation = structuredClone(LIVE_ACTIVATION);
    await seedRuntimeFreeze(root);
    const path = resolve(root, "research/forward_trial_live/activation.json");
    assert.equal(await publishActivationWriteOnce(path, activation, { projectRoot: root }), "created");
    assert.equal(await publishActivationWriteOnce(path, activation, { projectRoot: root }), "verified");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), activation);
    const verification = await verifyExistingLiveActivation({
      projectRoot: root,
      runtimeEnvironmentInputs: TEST_RUNTIME_ENVIRONMENT_INPUTS,
    });
    assert.equal(verification.status, "ACTIVATION_VERIFIED_AWAITING_FIRST_SIGNAL");
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

test("activation publication refuses a symlinked destination file", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-file-symlink-"));
  const outside = await mkdtemp(resolve(tmpdir(), "finly-live-file-outside-"));
  try {
    const activation = await buildLiveActivationFromCalendar({
      client: { getMarketCalendar: async () => calendarResult() },
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      frozenAt: "2026-08-29T12:00:00.000Z",
    });
    const parent = resolve(root, "research/forward_trial_live");
    await mkdir(parent, { recursive: true });
    const outsideFile = resolve(outside, "activation.json");
    await writeFile(outsideFile, "outside\n");
    await symlink(outsideFile, resolve(parent, "activation.json"));
    await assert.rejects(
      () => publishActivationWriteOnce(resolve(parent, "activation.json"), activation, { projectRoot: root }),
      /regular non-symlink file/,
    );
    assert.equal(await readFile(outsideFile, "utf8"), "outside\n");
  } finally {
    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  }
});

test("signal publication keeps prices private, publishes only the anchor, and verifies the full chain", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-signal-"));
  try {
    const activation = structuredClone(LIVE_ACTIVATION);
    await seedRuntimeFreeze(root);
    await publishActivationWriteOnce(resolve(root, FORWARD_TRIAL_LIVE_ACTIVATION_PATH), activation, { projectRoot: root });
    const acquisition = await buildLiveAcquisitionFromMarketData({
      client: marketDataClient(),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    });
    const commitment = buildForwardTrialLiveCommitment({ activation, acquisition });
    const anchor = buildForwardTrialLiveAnchorManifest(commitment, { activation });
    const published = await publishSignalBundleWriteOnce({
      projectRoot: root,
      activation,
      commitment,
      anchor,
    });
    assert.equal(published.private_status, "created");
    assert.equal(published.public_status, "created");
    const privatePath = resolve(root, published.private_path);
    const publicPath = resolve(root, published.public_path);
    assert.ok(privatePath.startsWith(resolve(root, FORWARD_TRIAL_LIVE_PRIVATE_COMMITMENT_DIRECTORY)));
    assert.ok(publicPath.startsWith(resolve(root, FORWARD_TRIAL_LIVE_PUBLIC_ANCHOR_DIRECTORY)));
    assert.equal((await stat(privatePath)).mode & 0o777, 0o600);
    const publicBytes = await readFile(publicPath, "utf8");
    for (const forbidden of ["adjusted_close_rows", "raw_close_rows", "bar_timestamp", "response_content_sha256"]) {
      assert.equal(publicBytes.includes(forbidden), false);
    }
    assert.equal((await loadPrivateCommitmentChain({ projectRoot: root, activation })).length, 1);
    assert.equal((await loadPublicAnchors({ projectRoot: root })).length, 1);
    const verification = await verifyExistingLiveActivation({
      projectRoot: root,
      runtimeEnvironmentInputs: TEST_RUNTIME_ENVIRONMENT_INPUTS,
    });
    assert.equal(verification.public_signal_anchors, 1);
    assert.equal(verification.private_signal_commitments_available, 1);
    const replay = await publishSignalBundleWriteOnce({
      projectRoot: root,
      activation,
      commitment,
      anchor,
    });
    assert.equal(replay.private_status, "verified");
    assert.equal(replay.public_status, "verified");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("clean-clone verification rejects a recomputed forged public anchor and broken exposed chain", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-public-chain-"));
  try {
    const activation = structuredClone(LIVE_ACTIVATION);
    await seedRuntimeFreeze(root);
    await publishActivationWriteOnce(resolve(root, FORWARD_TRIAL_LIVE_ACTIVATION_PATH), activation, { projectRoot: root });
    const acquisition = await buildLiveAcquisitionFromMarketData({
      client: marketDataClient(),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    });
    const commitment = buildForwardTrialLiveCommitment({ activation, acquisition });
    const anchor = buildForwardTrialLiveAnchorManifest(commitment, { activation });
    const publicDirectory = resolve(root, FORWARD_TRIAL_LIVE_PUBLIC_ANCHOR_DIRECTORY);
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(resolve(publicDirectory, anchorFilename(anchor)), canonicalBytes(anchor));
    assert.equal((await loadPublicAnchors({ projectRoot: root, activation })).length, 1);
    const cleanClone = await verifyExistingLiveActivation({
      projectRoot: root,
      runtimeEnvironmentInputs: TEST_RUNTIME_ENVIRONMENT_INPUTS,
    });
    assert.equal(cleanClone.status, "STRUCTURE_VERIFIED_EXTERNAL_TIMESTAMP_PENDING");
    assert.equal(cleanClone.external_anchor_verified, false);
    assert.equal(cleanClone.prospectivity_verified, false);
    assert.equal(cleanClone.private_bundle_existence_verified, false);

    await rm(publicDirectory, { recursive: true });
    await mkdir(publicDirectory, { recursive: true });
    const forged = rehashAnchor({ ...structuredClone(anchor), schema_version: "evil" });
    await writeFile(resolve(publicDirectory, anchorFilename(forged)), canonicalBytes(forged));
    await assert.rejects(
      () => loadPublicAnchors({ projectRoot: root, activation }),
      /envelope is invalid/,
    );

    await rm(publicDirectory, { recursive: true });
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(resolve(publicDirectory, anchorFilename(anchor)), canonicalBytes(anchor));
    const second = structuredClone(anchor);
    second.commitment_sequence = 2;
    second.signal_session_date = anchor.timing.next_session_date;
    second.timing = {
      captured_at: "2026-09-01T20:16:00.000Z",
      market_close_at: anchor.timing.next_market_close_at,
      bar_eligible_at: "2026-09-01T20:15:00.000Z",
      next_session_date: "2026-09-02",
      next_market_close_at: "2026-09-02T20:00:00.000Z",
      anchor_deadline: "2026-09-02T20:00:00.000Z",
    };
    second.private_bundle_sha256 = digest("f");
    second.previous_private_bundle_sha256 = digest("e");
    rehashAnchor(second);
    await writeFile(resolve(publicDirectory, anchorFilename(second)), canonicalBytes(second));
    await assert.rejects(
      () => loadPublicAnchors({ projectRoot: root, activation }),
      /hash chain is broken/,
    );
    await rm(resolve(publicDirectory, anchorFilename(second)));
    second.previous_private_bundle_sha256 = anchor.private_bundle_sha256;
    second.timing.next_session_date = "2099-01-01";
    second.timing.next_market_close_at = "2099-01-01T21:00:00.000Z";
    second.timing.anchor_deadline = second.timing.next_market_close_at;
    rehashAnchor(second);
    await writeFile(resolve(publicDirectory, anchorFilename(second)), canonicalBytes(second));
    await assert.rejects(
      () => loadPublicAnchors({ projectRoot: root, activation }),
      /timing chain is invalid/,
    );
    await rm(resolve(publicDirectory, anchorFilename(second)));
    second.timing.next_session_date = "2026-09-02";
    second.timing.next_market_close_at = "2026-09-02T23:59:59.000Z";
    second.timing.anchor_deadline = second.timing.next_market_close_at;
    rehashAnchor(second);
    await writeFile(resolve(publicDirectory, anchorFilename(second)), canonicalBytes(second));
    await assert.rejects(
      () => loadPublicAnchors({ projectRoot: root, activation }),
      /timing chain is invalid/,
    );
    await rm(resolve(publicDirectory, anchorFilename(second)));
    second.timing.next_market_close_at = "2026-09-02T20:00:00.000Z";
    second.timing.anchor_deadline = second.timing.next_market_close_at;
    second.action = "REBALANCE";
    second.target_weights = { SPY: 0.99, BIL: 0.01 };
    rehashAnchor(second);
    await writeFile(resolve(publicDirectory, anchorFilename(second)), canonicalBytes(second));
    await assert.rejects(
      () => loadPublicAnchors({ projectRoot: root, activation }),
      /violates the frozen five-session rebalance cadence/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("disk-head compare-and-swap rejects a divergent same-sequence commitment", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-cas-"));
  try {
    const activation = structuredClone(LIVE_ACTIVATION);
    await seedRuntimeFreeze(root);
    await publishActivationWriteOnce(resolve(root, FORWARD_TRIAL_LIVE_ACTIVATION_PATH), activation, { projectRoot: root });
    const firstAcquisition = await buildLiveAcquisitionFromMarketData({
      client: marketDataClient(),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    });
    const divergentAcquisition = await buildLiveAcquisitionFromMarketData({
      client: marketDataClient({ priceNudge: 0.01 }),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    });
    const first = buildForwardTrialLiveCommitment({ activation, acquisition: firstAcquisition });
    const divergent = buildForwardTrialLiveCommitment({ activation, acquisition: divergentAcquisition });
    await publishSignalBundleWriteOnce({
      projectRoot: root,
      activation,
      commitment: first,
      anchor: buildForwardTrialLiveAnchorManifest(first, { activation }),
    });
    await assert.rejects(
      () => publishSignalBundleWriteOnce({
        projectRoot: root,
        activation,
        commitment: divergent,
        anchor: buildForwardTrialLiveAnchorManifest(divergent, { activation }),
      }),
      /reuses an existing commitment sequence/,
    );
    assert.equal((await loadPrivateCommitmentChain({ projectRoot: root, activation })).length, 1);
    assert.equal((await loadPublicAnchors({ projectRoot: root, activation })).length, 1);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("a public-invalid calendar candidate fails before either write-once file is created", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-prewrite-public-gate-"));
  try {
    const activation = structuredClone(LIVE_ACTIVATION);
    await seedRuntimeFreeze(root);
    await publishActivationWriteOnce(resolve(root, FORWARD_TRIAL_LIVE_ACTIVATION_PATH), activation, { projectRoot: root });
    const validAcquisition = await buildLiveAcquisitionFromMarketData({
      client: marketDataClient(),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    });
    const invalidInput = {
      retrieved_at: validAcquisition.retrieved_at,
      session: structuredClone(validAcquisition.session),
      source: structuredClone(validAcquisition.source),
      adjusted_close_rows: structuredClone(validAcquisition.adjusted_close_rows),
      raw_close_rows: structuredClone(validAcquisition.raw_close_rows),
    };
    invalidInput.session.next_market_close_at = "2026-09-01T23:59:59.000Z";
    assert.throws(
      () => buildForwardTrialLiveAcquisition(invalidInput),
      /next-session hours are outside the fixed US-equity schedule/,
    );
    assert.equal((await loadPrivateCommitmentChain({ projectRoot: root, activation })).length, 0);
    assert.equal((await loadPublicAnchors({ projectRoot: root, activation })).length, 0);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("private-first crash state recovers only the matching public anchor", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-recovery-"));
  try {
    const activation = structuredClone(LIVE_ACTIVATION);
    await seedRuntimeFreeze(root);
    await publishActivationWriteOnce(resolve(root, FORWARD_TRIAL_LIVE_ACTIVATION_PATH), activation, { projectRoot: root });
    const acquisition = await buildLiveAcquisitionFromMarketData({
      client: marketDataClient(),
      credentials: { keyId: "paper-key-id", secretKey: "paper-secret-key" },
      activation,
    });
    const commitment = buildForwardTrialLiveCommitment({ activation, acquisition });
    const anchor = buildForwardTrialLiveAnchorManifest(commitment, { activation });
    const privateDirectory = resolve(root, FORWARD_TRIAL_LIVE_PRIVATE_COMMITMENT_DIRECTORY);
    await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(privateDirectory, forwardTrialLiveCommitmentFilename(commitment)), canonicalBytes(commitment), { mode: 0o600 });
    const recovered = await publishSignalBundleWriteOnce({ projectRoot: root, activation, commitment, anchor });
    assert.equal(recovered.private_status, "verified");
    assert.equal(recovered.public_status, "created");
    assert.equal((await loadPublicAnchors({ projectRoot: root, activation })).length, 1);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("capture verifies the frozen implementation source bytes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-live-source-binding-"));
  try {
    await seedRuntimeFreeze(root);
    const verified = await verifyFrozenImplementationSources({
      sourceRoot: root,
      activation: LIVE_ACTIVATION,
    });
    assert.match(verified.implementation_binding_sha256, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(verified.runtime_source_files), [
      "lib/canonical.mjs",
      "lib/economic_research.mjs",
      "lib/forward_market_data.mjs",
      "research/forward_trial_live_core.mjs",
      "research/run_forward_trial_live.mjs",
    ]);
    await writeFile(resolve(root, "research/forward_trial_live_core.mjs"), "// drifted\n", "utf8");
    await assert.rejects(
      () => verifyFrozenImplementationSources({ sourceRoot: root, activation: LIVE_ACTIVATION }),
      /source drifted/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("capture rejects preload, loader, engine, TLS, and global-fetch environment drift", () => {
  const verified = verifyFrozenRuntimeEnvironment({
    implementationBinding: FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING,
    execArgv: [],
    environment: {},
    versions: process.versions,
    fetchFunction: globalThis.fetch,
  });
  assert.equal(verified.visible_runtime_configuration_matches_manifest, true);
  assert.equal(verified.hostile_preexecution_environment_excluded, false);
  assert.equal(verified.node, "26.7.0");
  assert.throws(
    () => verifyFrozenRuntimeEnvironment({ execArgv: ["--import=data:text/javascript,export{}"] }),
    /launch arguments/,
  );
  assert.throws(
    () => verifyFrozenRuntimeEnvironment({ execArgv: [], environment: { NODE_OPTIONS: "--no-warnings" } }),
    /environment variable is forbidden/,
  );
  assert.throws(
    () => verifyFrozenRuntimeEnvironment({ execArgv: [], environment: { NODE_EXTRA_CA_CERTS: "/tmp/ca.pem" } }),
    /environment variable is forbidden/,
  );
  assert.throws(
    () => verifyFrozenRuntimeEnvironment({
      execArgv: [],
      environment: {},
      versions: { ...process.versions, node: "99.0.0" },
    }),
    /engine version differs/,
  );
  assert.throws(
    () => verifyFrozenRuntimeEnvironment({
      execArgv: [],
      environment: {},
      fetchFunction: async function attackerControlledFetch() {},
    }),
    /global fetch differs/,
  );
});

test("runner source exposes no order or arbitrary-network surface", async () => {
  const source = await readFile(new URL("../research/run_forward_trial_live.mjs", import.meta.url), "utf8");
  assert.match(source, /getMarketCalendar/);
  assert.match(source, /getDailyBars/);
  for (const forbidden of ["submitOrder", "placeOrder", "cancelOrder", "replaceOrder", "fetch(", "--url", "--output"]) {
    assert.equal(source.includes(forbidden), false, `runner unexpectedly contains ${forbidden}`);
  }
});
