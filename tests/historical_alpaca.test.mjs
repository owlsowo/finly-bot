import assert from "node:assert/strict";
import test from "node:test";
import {
  HistoricalAlpacaClient,
  alpacaHistoricalCredentialsFromEnv,
} from "../lib/historical_alpaca.mjs";

const KEY_ID = "paper-key-id";
const SECRET_KEY = "paper-secret-key";
const CALL = "SPY260918C00500000";
const PUT = "SPY260918P00500000";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(body),
  };
}

function bar(timestamp, close = 500) {
  return {
    t: timestamp,
    o: close - 1,
    h: close + 2,
    l: close - 2,
    c: close,
    v: 1000,
    n: 20,
    vw: close - 0.25,
  };
}

function article(id, timestamp) {
  return {
    id,
    headline: `SPY article ${id}`,
    created_at: timestamp,
    updated_at: timestamp,
    symbols: ["SPY"],
  };
}

function contract(symbol, status) {
  const isCall = symbol.includes("C00500000");
  return {
    symbol,
    underlying_symbol: "SPY",
    status,
    expiration_date: "2026-09-18",
    type: isCall ? "call" : "put",
    strike_price: "500",
  };
}

test("historical adapter exhausts pagination using only authenticated GET reads", async () => {
  const calls = [];
  const fetchImpl = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    calls.push({ url, options });
    const token = url.searchParams.get("page_token");
    if (url.pathname === "/v2/calendar") {
      return response([
        { date: "2026-08-03", open: "09:30", close: "16:00" },
        { date: "2026-08-04", open: "09:30", close: "16:00" },
      ]);
    }
    if (url.pathname === "/v2/stocks/SPY/bars") {
      return token === null
        ? response({ symbol: "SPY", bars: [bar("2026-08-03T04:00:00Z", 500)], next_page_token: "stock-2" })
        : response({ symbol: "SPY", bars: [bar("2026-08-04T04:00:00Z", 505)], next_page_token: null });
    }
    if (url.pathname === "/v1beta1/news") {
      return token === null
        ? response({ news: [article(1, "2026-08-03T14:00:00Z")], next_page_token: "news-2" })
        : response({ news: [article(2, "2026-08-04T14:00:00Z")], next_page_token: null });
    }
    if (url.pathname === "/v2/options/contracts") {
      const status = url.searchParams.get("status");
      if (status === "active" && token === null) {
        return response({ option_contracts: [], next_page_token: "active-2" });
      }
      if (status === "active") return response({ option_contracts: [contract(CALL, "active")], next_page_token: null });
      return response({ option_contracts: [contract(PUT, "inactive")], next_page_token: null });
    }
    if (url.pathname === "/v1beta1/options/bars") {
      return token === null
        ? response({ bars: { [CALL]: [bar("2026-08-03T14:00:00Z", 10)] }, next_page_token: "option-2" })
        : response({ bars: { [PUT]: [bar("2026-08-03T14:00:00Z", 8)] }, next_page_token: null });
    }
    throw new Error(`unexpected test URL: ${url}`);
  };
  const client = new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl });

  const calendar = await client.getMarketCalendar({ start: "2026-08-03", end: "2026-08-04" });
  const stocks = await client.getStockBars("SPY", { start: "2026-08-03", end: "2026-08-04" });
  const news = await client.getHistoricalNews("SPY", { start: "2026-08-03", end: "2026-08-04" });
  const contracts = await client.getOptionContracts("SPY", {
    expirationDateGte: "2026-09-18",
    expirationDateLte: "2026-09-18",
    strikePriceGte: 490,
    strikePriceLte: 510,
  });
  const options = await client.getHistoricalOptionBars([CALL, PUT], {
    start: "2026-08-03",
    end: "2026-08-04",
  });

  assert.equal(calendar.calendar.length, 2);
  assert.equal(calendar.provenance.read_only, true);
  assert.equal(stocks.bars.length, 2);
  assert.equal(stocks.provenance.page_count, 2);
  assert.deepEqual(news.news.map(({ id }) => id), [1, 2]);
  assert.deepEqual(contracts.option_contracts.map(({ symbol }) => symbol), [CALL, PUT]);
  assert.deepEqual(contracts.provenance.statuses, ["active", "inactive"]);
  assert.equal(contracts.provenance.page_count, 3);
  assert.equal(options.bars[CALL].length, 1);
  assert.equal(options.bars[PUT].length, 1);
  assert.equal(options.provenance.page_count, 2);
  assert.ok(calls.every(({ options: request }) => request.method === "GET" && request.redirect === "error"));
  assert.ok(calls.every(({ url }) => ["paper-api.alpaca.markets", "data.alpaca.markets"].includes(url.hostname)));
  assert.ok(calls.every(({ options: request }) => request.headers["APCA-API-KEY-ID"] === KEY_ID));
  assert.ok(calls.every(({ options: request }) => request.headers["APCA-API-SECRET-KEY"] === SECRET_KEY));
  assert.equal(calls.find(({ url }) => url.pathname.endsWith("/bars") && url.pathname.includes("stocks"))?.url.searchParams.get("adjustment"), "raw");
  assert.equal(stocks.provenance.adjustment, "raw");
  assert.equal(calls.find(({ url }) => url.pathname === "/v1beta1/news")?.url.searchParams.get("include_content"), "false");
});

test("option-contract status can be pinned without querying the other status", async () => {
  const statuses = [];
  const client = new HistoricalAlpacaClient({
    keyId: KEY_ID,
    secretKey: SECRET_KEY,
    fetchImpl: async (rawUrl) => {
      const url = new URL(rawUrl);
      statuses.push(url.searchParams.get("status"));
      return response({ option_contracts: [contract(PUT, "inactive")], next_page_token: null });
    },
  });
  const result = await client.getOptionContracts("SPY", {
    status: "inactive",
    expirationDateGte: "2026-09-18",
    expirationDateLte: "2026-09-18",
    type: "put",
    strikePriceGte: 500,
    strikePriceLte: 500,
  });
  assert.deepEqual(statuses, ["inactive"]);
  assert.deepEqual(result.provenance.statuses, ["inactive"]);
  assert.equal(result.option_contracts.length, 1);
});

test("historical option bars enforce the documented 100-symbol request cap", async () => {
  const symbols = Array.from({ length: 100 }, (_, index) => `SPY260918C${String((400 + index) * 1000).padStart(8, "0")}`);
  let calls = 0;
  const client = new HistoricalAlpacaClient({
    keyId: KEY_ID,
    secretKey: SECRET_KEY,
    fetchImpl: async (rawUrl) => {
      calls += 1;
      assert.equal(new URL(rawUrl).searchParams.get("symbols")?.split(",").length, 100);
      return response({ bars: {}, next_page_token: null });
    },
  });
  const result = await client.getHistoricalOptionBars(symbols, { start: "2026-08-03", end: "2026-08-04" });
  assert.equal(Object.keys(result.bars).length, 100);
  assert.ok(Object.values(result.bars).every((records) => records.length === 0));
  assert.equal(calls, 1);
  await assert.rejects(
    () => client.getHistoricalOptionBars([...symbols, "SPY260918P00600000"], { start: "2026-08-03", end: "2026-08-04" }),
    /one to 100/,
  );
});

test("constructor locks credentials and origins before any request", () => {
  const noop = async () => response({});
  assert.throws(() => new HistoricalAlpacaClient({ keyId: "short", secretKey: SECRET_KEY, fetchImpl: noop }), /key ID/);
  assert.throws(() => new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: "short", fetchImpl: noop }), /secret key/);
  assert.throws(
    () => new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, paperBase: "https://api.alpaca.markets", fetchImpl: noop }),
    /non-paper/,
  );
  assert.throws(
    () => new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, dataBase: "https://data.alpaca.markets.evil.example", fetchImpl: noop }),
    /not allowlisted/,
  );
  assert.throws(
    () => new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, dataBase: "https://data.alpaca.markets/v2", fetchImpl: noop }),
    /not allowlisted/,
  );
});

test("public API contains no broker mutation methods", () => {
  assert.deepEqual(
    Object.getOwnPropertyNames(HistoricalAlpacaClient.prototype).sort(),
    [
      "constructor",
      "getHistoricalNews",
      "getHistoricalOptionBars",
      "getMarketCalendar",
      "getOptionContracts",
      "getStockBars",
    ].sort(),
  );
});

test("input validation rejects unbounded, malformed, non-SPY, and unsupported reads before fetch", async (t) => {
  let calls = 0;
  const client = new HistoricalAlpacaClient({
    keyId: KEY_ID,
    secretKey: SECRET_KEY,
    fetchImpl: async () => {
      calls += 1;
      return response({});
    },
  });
  const cases = [
    [() => client.getMarketCalendar({ start: "2026-02-30", end: "2026-03-01" }), /valid calendar date/],
    [() => client.getStockBars("AAPL", { start: "2026-01-01", end: "2026-01-02" }), /must be SPY/],
    [() => client.getStockBars("SPY", { start: "2026-01-02", end: "2026-01-01" }), /inverted/],
    [() => client.getStockBars("SPY", { start: "2026-01-01", end: "2026-01-02", timeframe: "60Min" }), /timeframe/],
    [() => client.getStockBars("SPY", { start: "2026-01-01", end: "2026-01-02", adjustment: "future-adjusted" }), /adjustment/],
    [() => client.getStockBars("SPY", { start: "2026-01-01", end: "2026-01-02", limit: 10_001 }), /page limit/],
    [() => client.getHistoricalNews("SPY", { start: "nope", end: "2026-01-02" }), /YYYY-MM-DD or RFC-3339/],
    [() => client.getHistoricalNews("SPY", { start: "2026-01-01", end: "2026-01-02", includeContent: "yes" }), /must be boolean/],
    [() => client.getOptionContracts("SPY", { expirationDateGte: "2026-09-18", expirationDateLte: "2026-09-18", status: "expired" }), /status/],
    [() => client.getOptionContracts("SPY", { expirationDateGte: "2026-09-18", expirationDateLte: "2026-09-18", strikePriceGte: 510, strikePriceLte: 500 }), /strike bounds/],
    [() => client.getHistoricalOptionBars(["AAPL260918C00500000"], { start: "2026-01-01", end: "2026-01-02" }), /outside Finly's allowlist/],
    [() => client.getHistoricalOptionBars([CALL, CALL], { start: "2026-01-01", end: "2026-01-02" }), /must be unique/],
  ];
  for (const [index, [operation, pattern]] of cases.entries()) {
    await t.test(String(index), async () => assert.rejects(operation, pattern));
  }
  assert.equal(calls, 0);
});

test("paginated reads fail closed on missing, malformed, repeated, or endless page tokens", async (t) => {
  const args = ["SPY", { start: "2026-08-03", end: "2026-08-04" }];
  await t.test("missing token sentinel", async () => {
    const client = new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: async () => response({ bars: [] }) });
    await assert.rejects(() => client.getStockBars(...args), /missing next_page_token/);
  });
  await t.test("malformed token", async () => {
    const client = new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: async () => response({ bars: [], next_page_token: 42 }) });
    await assert.rejects(() => client.getStockBars(...args), /invalid next_page_token/);
  });
  await t.test("repeated token", async () => {
    const client = new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: async () => response({ bars: [], next_page_token: "same" }) });
    await assert.rejects(() => client.getStockBars(...args), /repeated a page token/);
  });
  await t.test("safety limit", async () => {
    let page = 0;
    const client = new HistoricalAlpacaClient({
      keyId: KEY_ID,
      secretKey: SECRET_KEY,
      maxPages: 2,
      fetchImpl: async () => response({ bars: [], next_page_token: `token-${page += 1}` }),
    });
    await assert.rejects(() => client.getStockBars(...args), /page safety limit/);
  });
});

test("malformed payloads and escaped symbols fail closed", async (t) => {
  await t.test("bar shape", async () => {
    const malformed = bar("2026-08-03T04:00:00Z");
    delete malformed.c;
    const client = new HistoricalAlpacaClient({
      keyId: KEY_ID,
      secretKey: SECRET_KEY,
      fetchImpl: async () => response({ symbol: "SPY", bars: [malformed], next_page_token: null }),
    });
    await assert.rejects(() => client.getStockBars("SPY", { start: "2026-08-03", end: "2026-08-04" }), /close.*numeric/);
  });
  await t.test("unrequested option symbol", async () => {
    const client = new HistoricalAlpacaClient({
      keyId: KEY_ID,
      secretKey: SECRET_KEY,
      fetchImpl: async () => response({ bars: { [PUT]: [] }, next_page_token: null }),
    });
    await assert.rejects(
      () => client.getHistoricalOptionBars([CALL], { start: "2026-08-03", end: "2026-08-04" }),
      /unrequested symbol/,
    );
  });
  await t.test("calendar shape", async () => {
    const client = new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: async () => response({ calendar: [] }) });
    await assert.rejects(() => client.getMarketCalendar({ start: "2026-08-03", end: "2026-08-04" }), /must be an array/);
  });
});

test("transport and JSON failures reveal neither injected credential", async (t) => {
  await t.test("HTTP error", async () => {
    const client = new HistoricalAlpacaClient({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: async () => response({}, 403) });
    let error;
    try {
      await client.getMarketCalendar({ start: "2026-08-03", end: "2026-08-04" });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(KEY_ID), false);
    assert.equal(error.message.includes(SECRET_KEY), false);
  });
  await t.test("invalid JSON", async () => {
    const client = new HistoricalAlpacaClient({
      keyId: KEY_ID,
      secretKey: SECRET_KEY,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }),
    });
    let error;
    try {
      await client.getMarketCalendar({ start: "2026-08-03", end: "2026-08-04" });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error);
    assert.match(error.message, /not valid JSON/);
    assert.equal(error.message.includes(KEY_ID), false);
    assert.equal(error.message.includes(SECRET_KEY), false);
  });
});

test("historical credential helper supports Alpaca's documented and legacy env names", () => {
  assert.deepEqual(
    alpacaHistoricalCredentialsFromEnv({ APCA_API_KEY_ID: "id", APCA_API_SECRET_KEY: "secret" }),
    { keyId: "id", secretKey: "secret" },
  );
  assert.deepEqual(
    alpacaHistoricalCredentialsFromEnv({ ALPACA_API_KEY: "legacy-id", ALPACA_SECRET_KEY: "legacy-secret" }),
    { keyId: "legacy-id", secretKey: "legacy-secret" },
  );
});
