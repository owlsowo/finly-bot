import assert from "node:assert/strict";
import test from "node:test";
import { AlpacaPaperRestClient } from "../lib/alpaca_rest.mjs";
import { fetchAlpacaLiveSnapshot } from "../lib/live_snapshot.mjs";
import { POLICY } from "../lib/policy.mjs";
import { validateOptionQuote } from "../lib/schema.mjs";

const AS_OF = "2026-08-28T18:30:05.000Z";
const QUOTE_TIME = "2026-08-28T18:30:02.000Z";

const SYMBOLS = Object.freeze({
  call: ["SPY260904C00555000", "SPY260904C00560000"],
  put: ["SPY260904P00555000", "SPY260904P00560000"],
});

function bars(count = 100) {
  const start = Date.UTC(2026, 4, 1, 4);
  return Array.from({ length: count }, (_, index) => ({
    t: new Date(start + index * 86_400_000).toISOString(),
    c: 520 + index * 0.4 + Math.sin(index / 4),
  }));
}

function optionContract(symbol, type, strike) {
  return {
    symbol,
    status: "active",
    tradable: true,
    expiration_date: "2026-09-04",
    root_symbol: "SPY",
    underlying_symbol: "SPY",
    type,
    style: "american",
    strike_price: String(strike),
    multiplier: "100",
    size: "100",
    open_interest: "1200",
    deliverables: [{ type: "equity", symbol: "SPY", amount: "100", delayed_settlement: false }],
  };
}

function contractPage(type) {
  return {
    option_contracts: type === "call"
      ? [optionContract(SYMBOLS.call[0], type, 555), optionContract(SYMBOLS.call[1], type, 560)]
      : [optionContract(SYMBOLS.put[0], type, 555), optionContract(SYMBOLS.put[1], type, 560)],
    next_page_token: null,
  };
}

function optionSnapshot(symbol, index) {
  return {
    latestQuote: {
      t: QUOTE_TIME,
      bp: 4.8 + index * 0.5,
      ap: 4.9 + index * 0.5,
    },
    impliedVolatility: 0.21 + index * 0.005,
    greeks: { delta: 0.5 },
  };
}

function chainPage(type) {
  return {
    snapshots: Object.fromEntries(SYMBOLS[type].map((symbol, index) => [symbol, optionSnapshot(symbol, index)])),
    next_page_token: null,
  };
}

function mockClient(overrides = {}) {
  const calls = [];
  const client = {
    tradingBase: POLICY.paperHost,
    dataBase: "https://data.alpaca.markets",
    getStockSnapshot: async (underlying, options) => {
      calls.push(["stock_snapshot", underlying, options]);
      return { symbol: "SPY", feed: "iex", latestQuote: { t: QUOTE_TIME, bp: 559.99, ap: 560.01 } };
    },
    getStockDailyBars: async (underlying, options) => {
      calls.push(["daily_bars", underlying, options]);
      return { symbol: "SPY", feed: "iex", bars: bars(), next_page_token: null };
    },
    getOptionContracts: async (underlying, options) => {
      calls.push(["contracts", underlying, options]);
      return contractPage(options.type);
    },
    getOptionChain: async (underlying, options) => {
      calls.push(["chain", underlying, options]);
      return chainPage(options.type);
    },
    ...overrides,
  };
  return { client, calls };
}

test("live snapshot normalizes bounded Alpaca reads into compiler-shaped market data", async () => {
  const { client, calls } = mockClient();
  const result = await fetchAlpacaLiveSnapshot(client, { asOf: AS_OF });
  assert.equal(result.market.underlying, "SPY");
  assert.equal(result.market.spot, 560);
  assert.equal(result.market.observed_at, QUOTE_TIME);
  assert.equal(result.market.quote_age_seconds, 3);
  assert.equal(result.market.option_feed, "indicative");
  assert.equal(result.market.history_mode, "alpaca_iex_adjusted_daily_bars");
  assert.equal(result.market.historical_log_returns.length, 96);
  assert.equal(result.option_chain.length, 4);
  assert.ok(result.option_chain.every((quote) => validateOptionQuote(quote) === quote));
  assert.deepEqual(new Set(result.option_chain.map((quote) => quote.type)), new Set(["call", "put"]));

  const contracts = calls.filter(([name]) => name === "contracts");
  const snapshots = calls.filter(([name]) => name === "chain");
  assert.deepEqual(contracts.map(([, , options]) => options.type), ["call", "put"]);
  assert.deepEqual(snapshots.map(([, , options]) => options.type), ["call", "put"]);
  for (const [, underlying, options] of [...contracts, ...snapshots]) {
    assert.equal(underlying, "SPY");
    assert.equal(options.expirationDateGte, "2026-08-31");
    assert.equal(options.expirationDateLte, "2026-09-11");
    assert.equal(options.strikePriceGte, 532);
    assert.equal(options.strikePriceLte, 588);
    assert.equal(options.limit, 1000);
  }
  assert.ok(snapshots.every(([, , options]) => options.feed === "indicative"));
});

test("live snapshot rejects non-paper origins before making a read", async () => {
  let calls = 0;
  const { client } = mockClient({
    tradingBase: "https://api.alpaca.markets",
    getStockSnapshot: async () => { calls += 1; },
  });
  await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /not locked/);
  assert.equal(calls, 0);
});

test("expiry DTE and query dates use the New York market date across a UTC-date boundary", async () => {
  const lateAsOf = "2026-08-29T00:30:05.000Z";
  const lateQuote = "2026-08-29T00:30:02.000Z";
  const seen = [];
  const { client } = mockClient({
    getStockSnapshot: async () => ({ symbol: "SPY", feed: "iex", latestQuote: { t: lateQuote, bp: 559.99, ap: 560.01 } }),
    getOptionContracts: async (_underlying, options) => {
      seen.push(options);
      return contractPage(options.type);
    },
    getOptionChain: async (_underlying, options) => ({
      snapshots: Object.fromEntries(SYMBOLS[options.type].map((symbol, index) => [symbol, {
        ...optionSnapshot(symbol, index),
        latestQuote: { ...optionSnapshot(symbol, index).latestQuote, t: lateQuote },
      }])),
      next_page_token: null,
    }),
  });
  const result = await fetchAlpacaLiveSnapshot(client, { asOf: lateAsOf });
  assert.ok(result.option_chain.every((quote) => quote.dte === 7));
  assert.ok(seen.every((options) => options.expirationDateGte === "2026-08-31" && options.expirationDateLte === "2026-09-11"));
});

test("live snapshot fails closed whenever any bounded Alpaca response is paginated", async (t) => {
  await t.test("daily bars", async () => {
    const { client } = mockClient({
      getStockDailyBars: async () => ({ symbol: "SPY", bars: bars(), next_page_token: "more" }),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /daily-bars.*pagination remains/);
  });
  await t.test("contracts", async () => {
    const { client } = mockClient({
      getOptionContracts: async (_underlying, options) => ({ ...contractPage(options.type), next_page_token: options.type === "put" ? "more" : null }),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /put option-contract.*pagination remains/);
  });
  await t.test("option chain", async () => {
    const { client } = mockClient({
      getOptionChain: async (_underlying, options) => ({ ...chainPage(options.type), next_page_token: options.type === "call" ? "more" : null }),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /call option-chain.*pagination remains/);
  });
});

test("live snapshot rejects missing required response fields rather than inventing values", async (t) => {
  await t.test("missing pagination sentinel", async () => {
    const { client } = mockClient({
      getStockDailyBars: async () => ({ symbol: "SPY", bars: bars() }),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /missing next_page_token/);
  });
  await t.test("missing contract open interest", async () => {
    const page = contractPage("call");
    delete page.option_contracts[0].open_interest;
    const { client } = mockClient({
      getOptionContracts: async (_underlying, options) => options.type === "call" ? page : contractPage("put"),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /missing open_interest/);
  });
  await t.test("missing snapshot implied volatility", async () => {
    const page = chainPage("put");
    delete page.snapshots[SYMBOLS.put[0]].impliedVolatility;
    const { client } = mockClient({
      getOptionChain: async (_underlying, options) => options.type === "put" ? page : chainPage("call"),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /missing impliedVolatility/);
  });
});

test("live snapshot binds feed and timestamps and rejects mismatches, future data, and stale data", async (t) => {
  await t.test("mismatched response feed", async () => {
    const { client } = mockClient({
      getOptionChain: async (_underlying, options) => ({ ...chainPage(options.type), feed: "opra" }),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /feed differs/);
  });
  await t.test("future quote", async () => {
    const page = chainPage("call");
    page.snapshots[SYMBOLS.call[0]].latestQuote.t = "2026-08-28T18:30:06.000Z";
    const { client } = mockClient({
      getOptionChain: async (_underlying, options) => options.type === "call" ? page : chainPage("put"),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /is in the future/);
  });
  await t.test("stale quote", async () => {
    const page = chainPage("put");
    page.snapshots[SYMBOLS.put[1]].latestQuote.t = "2026-08-28T18:28:00.000Z";
    const { client } = mockClient({
      getOptionChain: async (_underlying, options) => options.type === "put" ? page : chainPage("call"),
    });
    await assert.rejects(() => fetchAlpacaLiveSnapshot(client, { asOf: AS_OF }), /is stale/);
  });
});

test("read-only REST methods encode fixed daily-bar semantics and bounded option filters", async () => {
  const urls = [];
  const client = new AlpacaPaperRestClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-key",
    fetchImpl: async (url, options) => {
      urls.push({ url: new URL(url), method: options.method });
      return { ok: true, json: async () => ({}) };
    },
  });
  await client.getStockDailyBars("SPY", { start: "2026-01-01", end: "2026-08-27", feed: "iex", limit: 1000 });
  await client.getOptionContracts("SPY", {
    expirationDateGte: "2026-08-31",
    expirationDateLte: "2026-09-11",
    type: "put",
    strikePriceGte: 532,
    strikePriceLte: 588,
  });
  await client.getOptionChain("SPY", {
    feed: "indicative",
    expirationDateGte: "2026-08-31",
    expirationDateLte: "2026-09-11",
    type: "put",
    strikePriceGte: 532,
    strikePriceLte: 588,
  });
  assert.ok(urls.every(({ method }) => method === "GET"));
  assert.equal(urls[0].url.pathname, "/v2/stocks/SPY/bars");
  assert.equal(urls[0].url.searchParams.get("timeframe"), "1Day");
  assert.equal(urls[0].url.searchParams.get("adjustment"), "all");
  assert.equal(urls[0].url.searchParams.get("sort"), "asc");
  for (const { url } of urls.slice(1)) {
    assert.equal(url.searchParams.get("type"), "put");
    assert.equal(url.searchParams.get("strike_price_gte"), "532");
    assert.equal(url.searchParams.get("strike_price_lte"), "588");
    assert.equal(url.searchParams.get("expiration_date_gte"), "2026-08-31");
    assert.equal(url.searchParams.get("expiration_date_lte"), "2026-09-11");
  }
});
