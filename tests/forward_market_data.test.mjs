import assert from "node:assert/strict";
import test from "node:test";
import {
  ALPACA_DATA_ORIGIN,
  ALPACA_PAPER_ORIGIN,
  FORWARD_TRIAL_1_SYMBOLS,
  ForwardMarketDataClient,
} from "../lib/forward_market_data.mjs";

const CREDENTIALS = Object.freeze({
  keyId: "paper-key-id-123",
  secretKey: "paper-secret-key-456",
});

function response(body, { status = 200, url, redirected = false } = {}) {
  const value = {
    ok: status >= 200 && status < 300,
    status,
    redirected,
    json: async () => structuredClone(body),
  };
  if (url !== undefined) value.url = String(url);
  return value;
}

function bar(date, close = 500) {
  return {
    t: `${date}T04:00:00Z`,
    o: close - 1,
    h: close + 2,
    l: close - 2,
    c: close,
    v: 1_000,
    n: 20,
    vw: close - 0.25,
  };
}

function announcement({
  id = "announcement-1",
  type = "dividend",
  symbol = "SPY",
  exDate = "2026-08-03",
} = {}) {
  const normalizedType = type.toLowerCase();
  return {
    id,
    corporate_action_id: `corporate-${id}`,
    ca_type: type,
    ca_sub_type: normalizedType === "dividend" ? "cash" : normalizedType,
    initiating_symbol: symbol,
    initiating_original_cusip: "78462F103",
    target_symbol: null,
    target_original_cusip: null,
    declaration_date: "2026-07-20",
    ex_date: exDate,
    record_date: exDate,
    payable_date: "2026-08-10",
    cash: normalizedType === "dividend" ? "1.25" : "0",
    old_rate: normalizedType === "split" ? "1" : "0",
    new_rate: normalizedType === "split" ? "2" : "0",
  };
}

function assertNoCredentialLeak(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(CREDENTIALS.keyId), false);
  assert.equal(serialized.includes(CREDENTIALS.secretKey), false);
  assert.equal(serialized.toLowerCase().includes("headers"), false);
}

test("Forward Trial 1 symbol allowlist is exact and immutable", () => {
  assert.deepEqual(FORWARD_TRIAL_1_SYMBOLS, [
    "SPY", "BIL", "QQQ", "IWM", "EFA", "EEM", "IEF", "TLT", "GLD", "DBC", "VNQ",
    "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
  ]);
  assert.equal(Object.isFrozen(FORWARD_TRIAL_1_SYMBOLS), true);
});

test("daily bars exhaust raw and all pagination using only fixed HTTPS GET reads", async () => {
  const calls = [];
  const fetchImpl = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    calls.push({ url, options });
    assert.equal(url.origin, ALPACA_DATA_ORIGIN);
    assert.equal(url.pathname, "/v2/stocks/SPY/bars");
    assert.equal(url.searchParams.get("timeframe"), "1Day");
    assert.equal(url.searchParams.get("feed"), "iex");
    assert.equal(url.searchParams.get("sort"), "asc");
    assert.equal(url.searchParams.get("limit"), "1");
    const adjustment = url.searchParams.get("adjustment");
    const token = url.searchParams.get("page_token");
    const shift = adjustment === "all" ? -10 : 0;
    return token === null
      ? response({
        symbol: "SPY",
        bars: [bar("2026-08-03", 500 + shift)],
        next_page_token: `${adjustment}-page-2`,
      }, { url })
      : response({
        symbol: "SPY",
        bars: [bar("2026-08-04", 505 + shift)],
        next_page_token: null,
      }, { url });
  };
  const client = new ForwardMarketDataClient({ fetchImpl, maxPages: 4 });
  const result = await client.getDailyBars("SPY", {
    start: "2026-08-03",
    end: "2026-08-04",
    limit: 1,
    credentials: CREDENTIALS,
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(({ url }) => url.searchParams.get("adjustment")), ["raw", "raw", "all", "all"]);
  assert.deepEqual(calls.map(({ url }) => url.searchParams.get("page_token")), [null, "raw-page-2", null, "all-page-2"]);
  assert.ok(calls.every(({ url }) => url.protocol === "https:" && url.origin === ALPACA_DATA_ORIGIN));
  assert.ok(calls.every(({ options }) => options.method === "GET" && options.redirect === "error"));
  assert.ok(calls.every(({ options }) => options.headers["APCA-API-KEY-ID"] === CREDENTIALS.keyId));
  assert.ok(calls.every(({ options }) => options.headers["APCA-API-SECRET-KEY"] === CREDENTIALS.secretKey));
  assert.deepEqual(result.raw.bars.map(({ session_date }) => session_date), ["2026-08-03", "2026-08-04"]);
  assert.deepEqual(result.all.bars.map(({ session_date }) => session_date), ["2026-08-03", "2026-08-04"]);
  assert.equal(result.raw.provenance.page_count, 2);
  assert.equal(result.all.provenance.page_count, 2);
  assert.equal(result.raw.provenance.request.adjustment, "raw");
  assert.equal(result.all.provenance.request.adjustment, "all");
  assert.match(result.raw.content_hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.all.content_hash, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(result.raw.content_hash, result.all.content_hash);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.raw.bars), true);
  assertNoCredentialLeak(result);
  assert.deepEqual(JSON.parse(JSON.stringify(client)), {});
});

test("calendar and action reads use the exact paper origin and return normalized hashed data", async () => {
  const calls = [];
  const client = new ForwardMarketDataClient({
    fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl);
      calls.push({ url, options });
      if (url.pathname === "/v2/calendar") {
        assert.deepEqual(Object.fromEntries(url.searchParams), {
          start: "2026-08-03",
          end: "2026-08-04",
          date_type: "TRADING",
        });
        return response([
          { date: "2026-08-03", open: "09:30", close: "16:00" },
          { date: "2026-08-04", open: "09:30:00", close: "16:00:00" },
        ], { url });
      }
      if (url.pathname === "/v2/corporate_actions/announcements") {
        assert.equal(url.searchParams.get("ca_types"), "Dividend,Merger,Spinoff,Split");
        assert.equal(url.searchParams.get("since"), "2026-08-01");
        assert.equal(url.searchParams.get("until"), "2026-08-05");
        assert.equal(url.searchParams.get("symbol"), "SPY");
        assert.equal(url.searchParams.get("date_type"), "ex_date");
        return response([
          announcement({ id: "div-1", type: "Dividend", exDate: "2026-08-03" }),
          announcement({ id: "split-1", type: "split", exDate: "2026-08-04" }),
        ], { url });
      }
      throw new Error("unexpected test URL");
    },
  });

  const calendar = await client.getMarketCalendar({
    start: "2026-08-03",
    end: "2026-08-04",
    credentials: CREDENTIALS,
  });
  const actions = await client.getCorporateActionAnnouncements("SPY", {
    start: "2026-08-01",
    end: "2026-08-05",
    credentials: CREDENTIALS,
  });

  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ url }) => url.origin === ALPACA_PAPER_ORIGIN && url.protocol === "https:"));
  assert.ok(calls.every(({ options }) => options.method === "GET" && options.redirect === "error"));
  assert.deepEqual(calendar.sessions, [
    { date: "2026-08-03", open: "09:30:00", close: "16:00:00" },
    { date: "2026-08-04", open: "09:30:00", close: "16:00:00" },
  ]);
  assert.deepEqual(actions.announcements.map(({ id, ca_type }) => [id, ca_type]), [
    ["div-1", "dividend"],
    ["split-1", "split"],
  ]);
  assert.equal(actions.announcements[0].cash, 1.25);
  assert.equal(actions.announcements[1].new_rate, 2);
  assert.match(calendar.content_hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(actions.content_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(calendar.provenance.authentication, "caller-supplied; redacted");
  assert.equal(actions.provenance.request.date_type, "ex_date");
  assert.deepEqual(actions.provenance.request.ca_types, ["Dividend", "Merger", "Spinoff", "Split"]);
  assertNoCredentialLeak(calendar);
  assertNoCredentialLeak(actions);
});

test("invalid inputs fail before network access", async (t) => {
  let calls = 0;
  const client = new ForwardMarketDataClient({
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
  });
  const cases = [
    ["unallowlisted symbol", () => client.getDailyBars("AAPL", { start: "2026-08-01", end: "2026-08-02", credentials: CREDENTIALS }), /allowlist/],
    ["lowercase alias", () => client.getDailyBars("spy", { start: "2026-08-01", end: "2026-08-02", credentials: CREDENTIALS }), /allowlist/],
    ["invalid date", () => client.getMarketCalendar({ start: "2026-02-30", end: "2026-03-01", credentials: CREDENTIALS }), /valid calendar date/],
    ["inverted range", () => client.getDailyBars("SPY", { start: "2026-08-02", end: "2026-08-01", credentials: CREDENTIALS }), /inverted/],
    ["oversized page", () => client.getDailyBars("SPY", { start: "2026-08-01", end: "2026-08-02", limit: 10_001, credentials: CREDENTIALS }), /page limit/],
    ["over-90-day action range", () => client.getCorporateActionAnnouncements("SPY", { start: "2026-01-01", end: "2026-04-02", credentials: CREDENTIALS }), /must not exceed 90 days/],
    ["missing credentials", () => client.getMarketCalendar({ start: "2026-08-01", end: "2026-08-02" }), /credentials/],
    ["control character in credentials", () => client.getMarketCalendar({ start: "2026-08-01", end: "2026-08-02", credentials: { ...CREDENTIALS, keyId: "bad-key\nvalue" } }), /key ID/],
  ];
  for (const [name, operation, expected] of cases) {
    await t.test(name, async () => assert.rejects(operation, expected));
  }
  assert.equal(calls, 0);
});

test("paginated bar reads fail closed on incomplete or unsafe page chains", async (t) => {
  const options = { start: "2026-08-03", end: "2026-08-04", credentials: CREDENTIALS };

  await t.test("missing token sentinel", async () => {
    const client = new ForwardMarketDataClient({
      fetchImpl: async () => response({ symbol: "SPY", bars: [] }),
    });
    await assert.rejects(() => client.getDailyBars("SPY", options), /missing next_page_token/);
  });

  await t.test("malformed token", async () => {
    const client = new ForwardMarketDataClient({
      fetchImpl: async () => response({ symbol: "SPY", bars: [], next_page_token: 42 }),
    });
    await assert.rejects(() => client.getDailyBars("SPY", options), /invalid next_page_token/);
  });

  await t.test("repeated token", async () => {
    const client = new ForwardMarketDataClient({
      fetchImpl: async () => response({ symbol: "SPY", bars: [], next_page_token: "same-token" }),
    });
    await assert.rejects(() => client.getDailyBars("SPY", options), /repeated a page token/);
  });

  await t.test("page bound", async () => {
    const client = new ForwardMarketDataClient({
      maxPages: 1,
      fetchImpl: async () => response({ symbol: "SPY", bars: [], next_page_token: "more" }),
    });
    await assert.rejects(() => client.getDailyBars("SPY", options), /page safety limit/);
  });
});

test("bar schema, range, chronology, symbol, and cross-adjustment checks fail closed", async (t) => {
  const options = { start: "2026-08-03", end: "2026-08-04", credentials: CREDENTIALS };
  const run = async (bodyFactory) => {
    const client = new ForwardMarketDataClient({
      fetchImpl: async (rawUrl) => response(bodyFactory(new URL(rawUrl))),
    });
    return client.getDailyBars("SPY", options);
  };

  await t.test("unrequested response symbol", async () => {
    await assert.rejects(() => run(() => ({ symbol: "QQQ", bars: [], next_page_token: null })), /unrequested symbol/);
  });

  await t.test("out-of-range date", async () => {
    await assert.rejects(() => run(() => ({ symbol: "SPY", bars: [bar("2026-08-05")], next_page_token: null })), /date bounds/);
  });

  await t.test("duplicate timestamp", async () => {
    await assert.rejects(() => run(() => ({
      symbol: "SPY",
      bars: [bar("2026-08-03"), bar("2026-08-03")],
      next_page_token: null,
    })), /duplicated or out of chronological order/);
  });

  await t.test("malformed OHLC", async () => {
    const malformed = bar("2026-08-03");
    malformed.h = malformed.l - 1;
    await assert.rejects(() => run(() => ({ symbol: "SPY", bars: [malformed], next_page_token: null })), /inconsistent OHLC/);
  });

  await t.test("invalid RFC-3339 calendar components", async () => {
    const malformed = bar("2026-02-30");
    await assert.rejects(
      () => run(() => ({ symbol: "SPY", bars: [malformed], next_page_token: null })),
      /valid calendar date/,
    );
  });

  await t.test("different raw and all sessions", async () => {
    await assert.rejects(() => run((url) => ({
      symbol: "SPY",
      bars: [bar(url.searchParams.get("adjustment") === "raw" ? "2026-08-03" : "2026-08-04")],
      next_page_token: null,
    })), /identical sessions/);
  });
});

test("calendar validation rejects malformed, escaped, duplicate, and impossible sessions", async (t) => {
  const run = (body) => new ForwardMarketDataClient({ fetchImpl: async () => response(body) }).getMarketCalendar({
    start: "2026-08-03",
    end: "2026-08-04",
    credentials: CREDENTIALS,
  });
  await t.test("wrong top-level schema", async () => assert.rejects(() => run({ sessions: [] }), /must be an array/));
  await t.test("date escaped bounds", async () => assert.rejects(
    () => run([{ date: "2026-08-05", open: "09:30", close: "16:00" }]),
    /date bounds/,
  ));
  await t.test("duplicate sessions", async () => assert.rejects(
    () => run([
      { date: "2026-08-03", open: "09:30", close: "16:00" },
      { date: "2026-08-03", open: "09:30", close: "16:00" },
    ]),
    /duplicated or out of chronological order/,
  ));
  await t.test("impossible hours", async () => assert.rejects(
    () => run([{ date: "2026-08-03", open: "16:00", close: "09:30" }]),
    /invalid market hours/,
  ));
});

test("corporate-action validation rejects unrequested, out-of-range, duplicate, and unordered records", async (t) => {
  const run = (body) => new ForwardMarketDataClient({ fetchImpl: async () => response(body) }).getCorporateActionAnnouncements("SPY", {
    start: "2026-08-01",
    end: "2026-08-05",
    credentials: CREDENTIALS,
  });
  await t.test("wrong top-level schema", async () => assert.rejects(() => run({ announcements: [] }), /must be an array/));
  await t.test("unrequested symbol", async () => assert.rejects(
    () => run([announcement({ symbol: "QQQ" })]),
    /unrequested symbol/,
  ));
  await t.test("unrequested type", async () => assert.rejects(
    () => run([announcement({ type: "reorg" })]),
    /unrequested corporate-action type/,
  ));
  await t.test("date escaped bounds", async () => assert.rejects(
    () => run([announcement({ exDate: "2026-08-06" })]),
    /date bounds/,
  ));
  await t.test("malformed decimal", async () => {
    const malformed = announcement();
    malformed.cash = "1.2 dollars";
    await assert.rejects(() => run([malformed]), /finite decimal/);
  });
  await t.test("duplicate ID", async () => assert.rejects(
    () => run([announcement({ id: "same", exDate: "2026-08-02" }), announcement({ id: "same", exDate: "2026-08-03" })]),
    /duplicate announcement IDs/,
  ));
  await t.test("chronology", async () => assert.rejects(
    () => run([announcement({ id: "later", exDate: "2026-08-04" }), announcement({ id: "earlier", exDate: "2026-08-03" })]),
    /out of chronological order/,
  ));
});

test("redirects, malformed responses, and transport errors fail without leaking credentials", async (t) => {
  const operation = (fetchImpl) => new ForwardMarketDataClient({ fetchImpl }).getMarketCalendar({
    start: "2026-08-03",
    end: "2026-08-04",
    credentials: CREDENTIALS,
  });
  const expectSafeFailure = async (fetchImpl, pattern) => {
    let error;
    try {
      await operation(fetchImpl);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error);
    assert.match(error.message, pattern);
    assert.equal(error.message.includes(CREDENTIALS.keyId), false);
    assert.equal(error.message.includes(CREDENTIALS.secretKey), false);
  };

  await t.test("redirect marker", async () => expectSafeFailure(
    async () => response([], { redirected: true }),
    /redirected/,
  ));
  await t.test("escaped final URL", async () => expectSafeFailure(
    async () => response([], { url: "https://evil.example/v2/calendar" }),
    /escaped the allowlisted request URL/,
  ));
  await t.test("malformed transport shape", async () => expectSafeFailure(
    async () => ({ ok: true, status: 200 }),
    /malformed response/,
  ));
  await t.test("invalid JSON", async () => expectSafeFailure(
    async () => ({
      ok: true,
      status: 200,
      redirected: false,
      json: async () => { throw new SyntaxError(`bad ${CREDENTIALS.secretKey}`); },
    }),
    /not valid JSON/,
  ));
  await t.test("credential-bearing thrown error", async () => expectSafeFailure(
    async () => { throw new Error(`${CREDENTIALS.keyId}:${CREDENTIALS.secretKey}`); },
    /HTTPS GET failed/,
  ));
});

test("the public client API contains no mutation or arbitrary request method", () => {
  assert.deepEqual(Object.getOwnPropertyNames(ForwardMarketDataClient.prototype).sort(), [
    "constructor",
    "getCorporateActionAnnouncements",
    "getDailyBars",
    "getMarketCalendar",
  ].sort());
});
