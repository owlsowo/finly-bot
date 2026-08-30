import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { createAlpacaPaperPreflight, getNestedOrderByClientId, getNestedOrderByClientIdOrNull } from "../lib/alpaca_preflight.mjs";
import { AlpacaPaperRestClient } from "../lib/alpaca_rest.mjs";
import { runDecision } from "../lib/pipeline.mjs";
import { POLICY } from "../lib/policy.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const receipt = await runDecision({ fixture, planner: new DeterministicReplayPlanner() });
const candidate = receipt.compilation.selected;
const COMPETITION_ACCOUNT_ID = "PAFIXTURE001";

function paperPreflight(client) {
  return createAlpacaPaperPreflight(client, { expectedAccountId: COMPETITION_ACCOUNT_ID });
}

function standardContract(leg) {
  return {
    symbol: leg.symbol,
    status: "active",
    tradable: true,
    multiplier: "100",
    size: "100",
    deliverables: [{ type: "equity", symbol: candidate.underlying, amount: "100", delayed_settlement: false }],
  };
}

function mockClient(overrides = {}) {
  const quote = (leg) => ({ bp: leg.bid, ap: leg.ask, t: fixture.decision_time });
  return {
    tradingBase: POLICY.paperHost,
    dataBase: "https://data.alpaca.markets",
    getAccount: async () => ({ account_number: COMPETITION_ACCOUNT_ID, status: "ACTIVE", trading_blocked: false, account_blocked: false, equity: "100000", options_buying_power: "100000", options_trading_level: 3, options_approved_level: 3 }),
    getAccountConfiguration: async () => ({ suspend_trade: false }),
    getClock: async () => ({ is_open: true, timestamp: fixture.decision_time }),
    getPositions: async () => [],
    getOpenOrders: async () => [],
    getOptionContracts: async () => ({ option_contracts: [standardContract(candidate.long_leg), standardContract(candidate.short_leg)], next_page_token: null }),
    getLatestOptionQuotes: async () => ({ quotes: { [candidate.long_leg.symbol]: quote(candidate.long_leg), [candidate.short_leg.symbol]: quote(candidate.short_leg) } }),
    getStockLatestQuote: async () => ({ quote: { bp: 559.99, ap: 560.01, t: fixture.decision_time } }),
    ...overrides,
  };
}

test("Alpaca adapter normalizes a complete paper preflight without inventing broker fields", async () => {
  const preflight = await paperPreflight(mockClient())({ candidate, now: new Date(fixture.decision_time) });
  assert.equal(preflight.observed_at, fixture.decision_time);
  assert.equal(preflight.account.options_trading_level, 3);
  assert.equal(preflight.contracts.length, 2);
  assert.ok(preflight.contracts.every((contract) => contract.multiplier === 100 && contract.deliverable === "standard"));
  assert.deepEqual(preflight.quotes.map((quote) => quote.symbol), [candidate.long_leg.symbol, candidate.short_leg.symbol]);
  assert.equal(preflight.underlying_quote.symbol, "SPY");
});

test("Alpaca adapter rejects absent or malformed options levels instead of emitting NaN", async (t) => {
  const invalidLevels = [
    {
      name: "missing effective level",
      override: { getAccount: async () => ({ status: "ACTIVE", trading_blocked: false, account_blocked: false, equity: "100000", options_buying_power: "100000" }) },
    },
    {
      name: "missing approved level",
      override: { getAccount: async () => ({ status: "ACTIVE", trading_blocked: false, account_blocked: false, equity: "100000", options_buying_power: "100000", options_trading_level: 3 }) },
    },
    {
      name: "non-integer level",
      override: { getAccount: async () => ({ status: "ACTIVE", trading_blocked: false, account_blocked: false, equity: "100000", options_buying_power: "100000", options_trading_level: 2.5 }) },
    },
  ];
  for (const scenario of invalidLevels) {
    await t.test(scenario.name, async () => {
      await assert.rejects(
        () => paperPreflight(mockClient(scenario.override))({ candidate }),
        /options trading level is invalid/,
      );
    });
  }
});

test("Alpaca adapter fails closed on pagination and adjusted or absent deliverables", async () => {
  const paginated = mockClient({
    getOptionContracts: async () => ({ option_contracts: [standardContract(candidate.long_leg), standardContract(candidate.short_leg)], next_page_token: "more" }),
  });
  await assert.rejects(() => paperPreflight(paginated)({ candidate }), /pagination remains/);
  const adjusted = standardContract(candidate.long_leg);
  adjusted.deliverables = [{ type: "cash", symbol: "USD", amount: "5", delayed_settlement: false }];
  const adjustedClient = mockClient({
    getOptionContracts: async () => ({ option_contracts: [adjusted, standardContract(candidate.short_leg)], next_page_token: null }),
  });
  const preflight = await paperPreflight(adjustedClient)({ candidate });
  assert.equal(preflight.contracts[0].adjusted, true);
  const missingClient = mockClient({
    getOptionContracts: async () => ({ option_contracts: [{ ...standardContract(candidate.long_leg), deliverables: undefined }, standardContract(candidate.short_leg)], next_page_token: null }),
  });
  await assert.rejects(() => paperPreflight(missingClient)({ candidate }), /deliverables .* complete array/);
});

test("accepted-order reconciliation resolves client ID then fetches nested legs", async () => {
  const calls = [];
  const client = {
    getOrderByClientOrderId: async (clientOrderId) => { calls.push(["client", clientOrderId]); return { id: "deadbeef-dead-beef-dead-beefdeadbeef" }; },
    getOrderById: async (orderId, options) => { calls.push(["id", orderId, options]); return { id: orderId, legs: [{ symbol: "SPY" }] }; },
  };
  const result = await getNestedOrderByClientId(client, "finly-0123456789abcdef0123");
  assert.equal(result.legs.length, 1);
  assert.deepEqual(calls[1][2], { nested: true });
});

test("idempotency lookup preserves an exact absent-order result without a second read", async () => {
  let nestedReads = 0;
  const result = await getNestedOrderByClientIdOrNull({
    getOrderByClientOrderId: async () => null,
    getOrderById: async () => { nestedReads += 1; },
  }, "finly-exit-0123456789abcdef0123");
  assert.equal(result, null);
  assert.equal(nestedReads, 0);
});

test("latest-option quote reads reject ticker-prefix lookalikes before network access", async () => {
  let fetches = 0;
  const client = new AlpacaPaperRestClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-key",
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, json: async () => ({}) };
    },
  });
  await assert.rejects(
    () => client.getLatestOptionQuotes(["SPYWARE260904P00560000"]),
    /outside Finly's allowlist/,
  );
  assert.equal(fetches, 0);
});

test("paper REST adapter emits the pinned read-only Alpaca routes and parameters", async () => {
  const calls = [];
  const client = new AlpacaPaperRestClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-key",
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return { ok: true, json: async () => ({}) };
    },
  });
  await client.getAccountConfiguration();
  await client.getOptionContracts("SPY", {
    expirationDateGte: candidate.expiry,
    expirationDateLte: candidate.expiry,
  });
  await client.getStockLatestQuote("SPY", { feed: "iex" });
  await client.getLatestOptionQuotes([candidate.long_leg.symbol, candidate.short_leg.symbol], { feed: candidate.long_leg.feed });
  await client.getOrderByClientOrderId("finly-0123456789abcdef0123");
  await client.getOrderById("deadbeef-dead-beef-dead-beefdeadbeef", { nested: true });

  assert.deepEqual(calls.map(({ options }) => options.method), Array(6).fill("GET"));
  assert.deepEqual(calls.map(({ url }) => url.pathname), [
    "/v2/account/configurations",
    "/v2/options/contracts",
    "/v2/stocks/SPY/quotes/latest",
    "/v1beta1/options/quotes/latest",
    "/v2/orders:by_client_order_id",
    "/v2/orders/deadbeef-dead-beef-dead-beefdeadbeef",
  ]);
  assert.equal(calls[1].url.searchParams.get("show_deliverables"), "true");
  assert.equal(calls[1].url.searchParams.get("expiration_date_gte"), candidate.expiry);
  assert.equal(calls[2].url.searchParams.get("feed"), "iex");
  assert.equal(calls[3].url.searchParams.get("symbols"), `${candidate.long_leg.symbol},${candidate.short_leg.symbol}`);
  assert.equal(calls[4].url.searchParams.get("client_order_id"), "finly-0123456789abcdef0123");
  assert.equal(calls[5].url.searchParams.get("nested"), "true");
  assert.ok(calls.slice(0, 2).every(({ url }) => url.origin === POLICY.paperHost));
  assert.ok(calls.slice(2, 4).every(({ url }) => url.origin === "https://data.alpaca.markets"));
});

test("paper REST readback accepts the dedicated exit idempotency namespace", async () => {
  let observed;
  const client = new AlpacaPaperRestClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-key",
    fetchImpl: async (url, options) => {
      observed = { url: new URL(url), options };
      return { ok: true, json: async () => ({}) };
    },
  });
  const clientOrderId = "finly-exit-0123456789abcdef0123";
  await client.getOrderByClientOrderId(clientOrderId);
  assert.equal(observed.options.method, "GET");
  assert.equal(observed.url.origin, POLICY.paperHost);
  assert.equal(observed.url.pathname, "/v2/orders:by_client_order_id");
  assert.equal(observed.url.searchParams.get("client_order_id"), clientOrderId);
});

test("paper REST client-order lookup treats an exact 404 as an absent idempotency key", async () => {
  const client = new AlpacaPaperRestClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-key",
    fetchImpl: async () => ({ status: 404, ok: false, json: async () => ({}) }),
  });
  assert.equal(await client.getOrderByClientOrderId("finly-exit-0123456789abcdef0123"), null);
});
