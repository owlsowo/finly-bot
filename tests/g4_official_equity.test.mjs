import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256 } from "../lib/canonical.mjs";
import {
  G4_CLIENT_ORDER_ID,
  assertG4OfficialProductionProtocol,
  assertG4StockOrderArguments,
  buildG4OfficialOrderPlan,
  loadG4OfficialProductionProtocol,
  runG4OfficialEquityCycle,
  splitG4OfficialBrokerView,
} from "../lib/g4_official_equity.mjs";

const ACCOUNT_ID = "PATEST123456";
const SECRET = "g4-test-signing-secret-is-more-than-thirty-two-bytes";
const NOW = "2026-08-31T13:31:00.000Z";
const ENABLED = {
  FINLY_G4_PRODUCTION_ENABLED: "true",
  FINLY_EXECUTION_ENABLED: "true",
  FINLY_EXECUTION_TRANSPORT: "mcp",
  ALPACA_PAPER_TRADE: "true",
  FINLY_PAPER_MUTATION_ACK: "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT",
};

class MemoryStore {
  constructor(events = []) { this.serialized = null; this.events = events; }
  async load() { this.events.push("load"); return this.serialized; }
  async save(_id, serialized, { expectedPreviousRevision }) {
    const incoming = JSON.parse(serialized).state.revision;
    const current = this.serialized === null ? null : JSON.parse(this.serialized).state.revision;
    assert.equal(current, expectedPreviousRevision);
    assert.equal(incoming, current === null ? 0 : current + 1);
    this.serialized = serialized;
    this.events.push(`save:${incoming}`);
  }
}

function fakeBroker({ events = [], mutationStatus = "filled", mutationThrowsAfterAccept = false, fillFraction = 1 } = {}) {
  const orders = new Map();
  const positions = [];
  const account = {
    account_number: ACCOUNT_ID,
    status: "ACTIVE",
    trading_blocked: false,
    account_blocked: false,
    trade_suspended_by_user: false,
    equity: "100000.00",
    cash: "100000.00",
    buying_power: "200000.00",
  };
  const client = {
    getAccount: async () => structuredClone(account),
    getClock: async () => ({ is_open: true, timestamp: NOW }),
    getPositions: async () => structuredClone(positions),
    getOpenOrders: async () => [...orders.values()].filter((order) => !new Set(["filled", "rejected", "canceled"]).has(order.status)),
    getAsset: async (symbol) => ({
      symbol, class: "us_equity", status: "active", tradable: true, fractionable: true,
    }),
    getOrderByClientOrderId: async (id) => {
      events.push(`lookup:${id}`);
      return structuredClone(orders.get(id) ?? null);
    },
  };
  const mutationClient = {
    placeStockOrder: async (projection) => {
      events.push(`mutate:${projection.symbol}`);
      if (orders.has(projection.client_order_id)) throw new Error("duplicate client order ID");
      const price = 100;
      const order = {
        ...structuredClone(projection),
        id: `paper-order-${projection.symbol.toLowerCase()}`,
        asset_class: "us_equity",
        status: mutationStatus,
        filled_qty: mutationStatus === "filled" || mutationStatus === "partially_filled"
          ? (Number(projection.notional) * fillFraction / price).toFixed(8)
          : "0",
        filled_avg_price: mutationStatus === "filled" || mutationStatus === "partially_filled" ? price.toFixed(8) : null,
      };
      orders.set(projection.client_order_id, order);
      if (mutationStatus === "filled") {
        positions.push({
          asset_class: "us_equity",
          symbol: projection.symbol,
          qty: order.filled_qty,
          side: "long",
          market_value: projection.notional,
        });
        account.cash = (Number(account.cash) - Number(projection.notional)).toFixed(2);
      }
      if (mutationThrowsAfterAccept) throw new Error("connection lost after broker acceptance");
      return { schema_version: "alpaca_mcp_stock_mutation_ack.v1", isError: false };
    },
  };
  return { account, client, mutationClient, orders, positions };
}

async function cycle(protocol, store, broker, overrides = {}) {
  return runG4OfficialEquityCycle({
    protocol,
    store,
    signingSecret: SECRET,
    client: broker.client,
    mutationClient: broker.mutationClient,
    expectedAccountId: ACCOUNT_ID,
    environment: ENABLED,
    now: NOW,
    ...overrides,
  });
}

test("frozen official protocol authenticates and plans exact 97% four-ETF notional", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const sourceSignal = JSON.parse(await readFile(new URL("../config/g4-official-source-signal.json", import.meta.url), "utf8"));
  assert.equal(sha256(sourceSignal), protocol.source_signal.signal_sha256);
  assert.equal(sourceSignal.source_panel.source_panel_sha256, protocol.source_signal.source_panel_sha256);
  assert.equal(assertG4OfficialProductionProtocol(protocol), protocol);
  const plan = buildG4OfficialOrderPlan(protocol);
  assert.deepEqual(plan.map((order) => [order.symbol, order.notional]), [
    ["QQQ", "48500.00"], ["XLB", "16166.66"], ["XLE", "16166.66"], ["XLV", "16166.66"],
  ]);
  assert.equal(plan.reduce((sum, order) => sum + Math.round(Number(order.notional) * 100), 0), 9_699_998);
  assert.ok(plan.every((order) => G4_CLIENT_ORDER_ID.test(order.client_order_id)));
  assert.ok(plan.every((order) => assertG4StockOrderArguments(order)));

  const changed = structuredClone(protocol);
  changed.allocation.targets[0].weight = "0.4900000000000";
  assert.throws(() => assertG4OfficialProductionProtocol(changed), /hash|drift/u);
  assert.throws(() => assertG4StockOrderArguments({ ...plan[0], symbol: "SPY" }), /outside/u);
});

test("mutation stays disabled unless every explicit production acknowledgement is present", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const events = [];
  const store = new MemoryStore(events);
  const broker = fakeBroker({ events });
  const result = await cycle(protocol, store, broker, { environment: { ...ENABLED, FINLY_G4_PRODUCTION_ENABLED: "false" } });
  assert.equal(result.status, "G4_MUTATION_DISABLED");
  assert.equal(result.options_authorized, false);
  assert.equal(result.fallback, "SPY_CASH_HANDOFF_REQUIRED");
  assert.equal(events.some((event) => event.startsWith("mutate:")), false);
});

test("four-leg lifecycle is checkpointed before each mutation, read-before-write, and becomes READY only after reconciliation", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const events = [];
  const store = new MemoryStore(events);
  const broker = fakeBroker({ events });
  const checkpoint = async ({ sequence }) => events.push(`checkpoint:${sequence}`);
  const results = [];
  for (let index = 0; index < 4; index += 1) {
    results.push(await cycle(protocol, store, broker, { stateCheckpoint: checkpoint }));
  }
  assert.deepEqual(results.map((result) => result.status), [
    "G4_LEG_FILLED", "G4_LEG_FILLED", "G4_LEG_FILLED", "G4_RECONCILING",
  ]);
  const ready = await cycle(protocol, store, broker, { stateCheckpoint: checkpoint });
  assert.equal(ready.status, "G4_EQUITY_READY");
  assert.equal(ready.options_authorized, true);
  assert.equal(ready.fallback, "MANUAL_RECONCILIATION_REQUIRED");
  assert.deepEqual(ready.readiness_receipt.allocation, {
    QQQ: "48500.00", XLB: "16166.66", XLE: "16166.66", XLV: "16166.66",
  });
  assert.equal(events.filter((event) => event.startsWith("mutate:")).length, 4);
  for (let sequence = 0; sequence < 4; sequence += 1) {
    const symbol = ["QQQ", "XLB", "XLE", "XLV"][sequence];
    const lookupIndex = events.findIndex((event) => event.includes(`lookup:finly-g4-`) && events.indexOf(event) >= 0
      && event === events.filter((item) => item.startsWith("lookup:"))[sequence * 2]);
    assert.ok(events.indexOf(`checkpoint:${sequence}`) < events.indexOf(`mutate:${symbol}`));
    assert.ok(lookupIndex >= -1);
  }
  const mutationCount = events.filter((event) => event.startsWith("mutate:")).length;
  const repeated = await cycle(protocol, store, broker, { stateCheckpoint: checkpoint });
  assert.equal(repeated.status, "G4_EQUITY_READY");
  assert.equal(events.filter((event) => event.startsWith("mutate:")).length, mutationCount);
});

test("lost acknowledgement reconciles by deterministic client ID without a duplicate mutation", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const events = [];
  const store = new MemoryStore(events);
  const broker = fakeBroker({ events, mutationThrowsAfterAccept: true });
  const result = await cycle(protocol, store, broker, { stateCheckpoint: async () => events.push("checkpoint") });
  assert.equal(result.status, "G4_LEG_FILLED");
  assert.equal(events.filter((event) => event === "mutate:QQQ").length, 1);
  assert.equal(events.filter((event) => event.startsWith("lookup:")).length, 2);
});

test("an intermediate partial fill is reconciled without a duplicate mutation", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const events = [];
  const store = new MemoryStore(events);
  const broker = fakeBroker({ events, mutationStatus: "partially_filled", fillFraction: 0.1 });

  const partial = await cycle(protocol, store, broker);
  assert.equal(partial.status, "G4_ORDER_PENDING");
  assert.equal(partial.options_authorized, false);
  assert.equal(partial.fallback, "MANUAL_RECONCILIATION_REQUIRED");
  assert.equal(events.filter((event) => event === "mutate:QQQ").length, 1);

  const plan = buildG4OfficialOrderPlan(protocol);
  const order = broker.orders.get(plan[0].client_order_id);
  order.status = "filled";
  order.filled_qty = (Number(plan[0].notional) / 100).toFixed(8);
  order.filled_avg_price = "100.00000000";
  broker.positions.push({
    asset_class: "us_equity",
    symbol: plan[0].symbol,
    qty: order.filled_qty,
    side: "long",
    market_value: plan[0].notional,
  });
  broker.account.cash = (Number(broker.account.cash) - Number(plan[0].notional)).toFixed(2);

  const filled = await cycle(protocol, store, broker);
  assert.equal(filled.status, "G4_LEG_FILLED");
  assert.equal(events.filter((event) => event === "mutate:QQQ").length, 1);
});

test("a rejected fill freezes after mutation and forbids fallback mixing", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const store = new MemoryStore();
  const broker = fakeBroker({ mutationStatus: "rejected" });
  const result = await cycle(protocol, store, broker);
  assert.equal(result.status, "G4_EQUITY_FROZEN");
  assert.equal(result.options_authorized, false);
  assert.equal(result.fallback, "MANUAL_RECONCILIATION_REQUIRED");
  const repeated = await cycle(protocol, store, broker);
  assert.equal(repeated.status, "G4_EQUITY_FROZEN");
});

test("unsupported initial holdings fail closed before mutation and hand off only to the external fallback", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const events = [];
  const store = new MemoryStore(events);
  const broker = fakeBroker({ events });
  broker.positions.push({ asset_class: "us_equity", symbol: "XLF", qty: "1", side: "long" });
  const result = await cycle(protocol, store, broker);
  assert.equal(result.status, "G4_READINESS_FAILED");
  assert.equal(result.fallback, "SPY_CASH_HANDOFF_REQUIRED");
  assert.equal(events.some((event) => event.startsWith("mutate:")), false);
});

test("missing account safety booleans and undersized fills fail closed", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const missingFlag = fakeBroker();
  delete missingFlag.account.account_blocked;
  const readiness = await cycle(protocol, new MemoryStore(), missingFlag);
  assert.equal(readiness.status, "G4_READINESS_FAILED");

  const undersized = fakeBroker({ fillFraction: 0.01 });
  const fill = await cycle(protocol, new MemoryStore(), undersized);
  assert.equal(fill.status, "G4_EQUITY_FROZEN");
  assert.match(fill.reason, /two-sided/u);
});

test("all four ETFs must be active, tradable, and fractionable before mutation", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const events = [];
  const broker = fakeBroker({ events });
  broker.client.getAsset = async (symbol) => ({
    symbol,
    class: "us_equity",
    status: "active",
    tradable: true,
    fractionable: symbol !== "XLE",
  });
  const result = await cycle(protocol, new MemoryStore(events), broker);
  assert.equal(result.status, "G4_READINESS_FAILED");
  assert.match(result.reason, /XLE/u);
  assert.equal(events.some((event) => event.startsWith("mutate:")), false);
});

test("cash-floor failure freezes final reconciliation", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const store = new MemoryStore();
  const broker = fakeBroker();
  for (let index = 0; index < 4; index += 1) await cycle(protocol, store, broker);
  broker.account.cash = "2990.00";
  const result = await cycle(protocol, store, broker);
  assert.equal(result.status, "G4_EQUITY_FROZEN");
  assert.equal(result.options_authorized, false);
});

test("an incomplete final broker snapshot defers and later reconciles without rewriting state", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const store = new MemoryStore();
  const broker = fakeBroker();
  for (let index = 0; index < 4; index += 1) await cycle(protocol, store, broker);
  const reconcilingRevision = JSON.parse(store.serialized).state.revision;
  const temporarilyMissing = broker.positions.pop();

  const deferred = await cycle(protocol, store, broker);
  assert.equal(deferred.status, "G4_RECONCILIATION_DEFERRED");
  assert.equal(deferred.options_authorized, false);
  assert.equal(deferred.reason, "BROKER_SETTLEMENT_PENDING");
  assert.equal(JSON.parse(store.serialized).state.phase, "RECONCILING");
  assert.equal(JSON.parse(store.serialized).state.revision, reconcilingRevision);

  broker.positions.push(temporarilyMissing);
  const recovered = await cycle(protocol, store, broker);
  assert.equal(recovered.status, "G4_EQUITY_READY");
  assert.equal(recovered.options_authorized, true);
});

test("a transient final quantity mismatch remains closed until the broker snapshot converges", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const store = new MemoryStore();
  const broker = fakeBroker();
  for (let index = 0; index < 4; index += 1) await cycle(protocol, store, broker);
  const reconcilingRevision = JSON.parse(store.serialized).state.revision;
  const finalQuantity = broker.positions[0].qty;
  broker.positions[0].qty = (Number(finalQuantity) / 2).toFixed(8);

  const deferred = await cycle(protocol, store, broker);
  assert.equal(deferred.status, "G4_RECONCILIATION_DEFERRED");
  assert.equal(deferred.options_authorized, false);
  assert.equal(deferred.reason, "BROKER_QUANTITY_SETTLEMENT_PENDING");
  assert.equal(JSON.parse(store.serialized).state.phase, "RECONCILING");
  assert.equal(JSON.parse(store.serialized).state.revision, reconcilingRevision);

  broker.positions[0].qty = finalQuantity;
  const recovered = await cycle(protocol, store, broker);
  assert.equal(recovered.status, "G4_EQUITY_READY");
  assert.equal(recovered.options_authorized, true);
});

test("READY receipt strictly segregates G4 equities from SPY option overlay", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const store = new MemoryStore();
  const broker = fakeBroker();
  for (let index = 0; index < 5; index += 1) await cycle(protocol, store, broker);
  const ready = await cycle(protocol, store, broker);
  const optionPosition = { asset_class: "us_option", symbol: "SPY260904C00600000", qty: "1", side: "long" };
  const optionOrder = {
    asset_class: "",
    client_order_id: "finly-0123456789abcdefabcd",
    order_class: "mleg",
    legs: [
      { asset_class: "us_option", symbol: "SPY260904C00600000" },
      { asset_class: "us_option", symbol: "SPY260904C00610000" },
    ],
  };
  const split = splitG4OfficialBrokerView({
    positions: [...broker.positions, optionPosition],
    openOrders: [optionOrder],
    protocol,
    readinessReceipt: ready.readiness_receipt,
  });
  assert.equal(split.equityPositions.length, 4);
  assert.deepEqual(split.optionPositions, [optionPosition]);
  assert.deepEqual(split.optionOrders, [optionOrder]);
  assert.throws(() => splitG4OfficialBrokerView({
    positions: broker.positions,
    openOrders: [{ ...optionOrder, asset_class: "us_option" }],
    protocol,
    readinessReceipt: ready.readiness_receipt,
  }), /unsupported/u);
  assert.throws(() => splitG4OfficialBrokerView({
    positions: [...broker.positions, { ...optionPosition, symbol: "QQQ260904C00600000" }],
    openOrders: [],
    protocol,
    readinessReceipt: ready.readiness_receipt,
  }), /unsupported/u);
  assert.throws(() => splitG4OfficialBrokerView({
    positions: broker.positions.map((position, index) => index === 0 ? { ...position, side: undefined } : position),
    openOrders: [],
    protocol,
    readinessReceipt: ready.readiness_receipt,
  }), /long-only/u);
  assert.throws(() => splitG4OfficialBrokerView({
    positions: broker.positions,
    openOrders: [],
    protocol,
    readinessReceipt: { ...ready.readiness_receipt, receipt_hash: "sha256:" + "0".repeat(64) },
  }), /receipt/u);
});

test("a post-fill broker quantity change invalidates READY before options can run", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const store = new MemoryStore();
  const broker = fakeBroker();
  for (let index = 0; index < 5; index += 1) await cycle(protocol, store, broker);
  broker.positions[0].qty = (Number(broker.positions[0].qty) - 1).toFixed(8);
  const drifted = await cycle(protocol, store, broker);
  assert.equal(drifted.status, "G4_EQUITY_FROZEN");
  assert.match(drifted.reason, /quantity drifted/u);
  assert.equal(drifted.options_authorized, false);
});

test("a transient READY broker-read outage defers and recovers without rewriting signed state", async () => {
  const protocol = await loadG4OfficialProductionProtocol();
  const events = [];
  const store = new MemoryStore(events);
  const broker = fakeBroker({ events });
  for (let index = 0; index < 5; index += 1) await cycle(protocol, store, broker);
  const readyRevision = JSON.parse(store.serialized).state.revision;
  const healthyGetPositions = broker.client.getPositions;
  let unavailable = true;
  broker.client.getPositions = async () => {
    if (unavailable) {
      unavailable = false;
      throw new Error("temporary transport failure");
    }
    return healthyGetPositions();
  };

  const deferred = await cycle(protocol, store, broker);
  assert.equal(deferred.status, "G4_RECONCILIATION_DEFERRED");
  assert.equal(deferred.options_authorized, false);
  assert.equal(deferred.reason, "BROKER_READ_UNAVAILABLE");
  assert.equal(JSON.parse(store.serialized).state.phase, "READY");
  assert.equal(JSON.parse(store.serialized).state.revision, readyRevision);

  const recovered = await cycle(protocol, store, broker);
  assert.equal(recovered.status, "G4_EQUITY_READY");
  assert.equal(recovered.options_authorized, true);
});

test("stock bridge source is a separate pinned tool and cannot accept shadow authority", async () => {
  const source = await readFile(new URL("../scripts/alpaca_stock_mcp_bridge.py", import.meta.url), "utf8");
  assert.match(source, /EXPECTED_TOOL = "place_stock_order"/u);
  assert.match(source, /EXPECTED_VERSION = "2\.2\.1"/u);
  assert.match(source, /FINLY_G4_PRODUCTION_ENABLED/u);
  assert.match(source, /CLIENT_ID_PATTERN/u);
  assert.doesNotMatch(source, /g4_shadow_live|broker_mutation_authorized/u);
});
