import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { sha256 } from "../lib/canonical.mjs";
import {
  applyEconomicRiskCommitteeVeto,
  buildCurrentEconomicDecision,
} from "../lib/economic_research.mjs";
import { FilePermitLedger } from "../lib/permit_ledger.mjs";
import { runDecision } from "../lib/pipeline.mjs";
import {
  buildExitStrategyContext,
  buildGuardedLocalPaperExecutor,
  runAutonomousPaperCycle,
} from "../scripts/autonomous_paper_agent.mjs";
import fixture from "../fixtures/spy_bearish_replay.json" with { type: "json" };

const signingSecret = "autonomous-integration-signing-secret-0123456789";
const asOf = fixture.decision_time;

function bullishEconomicBundle() {
  const dailyBars = (cash) => {
    let close = cash ? 90 : 100;
    return Array.from({ length: 300 }, (_, index) => {
      close *= cash ? 1.0001 : 1.0008 + 0.002 * Math.sin(index * 0.7);
      return { t: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(), c: close };
    });
  };
  const deterministicDecision = buildCurrentEconomicDecision({
    spyBars: dailyBars(false),
    cashBars: dailyBars(true),
    decisionTimestamp: asOf,
    sourceAvailableAt: "2026-08-28T17:30:05.000Z",
    completedSessionBoundary: {
      sessionDate: "2025-10-27",
      marketCloseAt: "2025-10-27T20:00:00.000Z",
      eligibleAt: "2025-10-27T20:15:00.000Z",
      availabilityDelayMinutes: 15,
    },
    currentAllocation: { spyWeight: 0, bilWeight: 1 },
    lastRebalanceDate: null,
  });
  const riskCommitteeDecision = applyEconomicRiskCommitteeVeto(deterministicDecision, {
    assessedAt: asOf,
    disposition: "SCALE",
    spyExposureMultiplier: 1,
    reasonCodes: ["NO_AGENT_RISK_REDUCTION"],
  });
  const body = {
    schema_version: "finly_current_economic_bundle.v1",
    generated_at: asOf,
    data: { read_only: true },
    paper_account_boundary: { authenticated_read_succeeded: true },
    deterministic_decision: deterministicDecision,
    risk_committee_decision: riskCommitteeDecision,
    mutation_requested: false,
  };
  return { ...body, artifact_sha256: sha256(body) };
}

function nestedOrder(projection, {
  id,
  status = "accepted",
  filled = 0,
} = {}) {
  return {
    ...structuredClone(projection),
    id,
    status,
    filled_qty: String(filled),
    legs: projection.legs.map((leg) => ({ ...leg, filled_qty: String(filled) })),
  };
}

test("exit strategy context accepts only a current HMAC-bound deterministic intent", async () => {
  const receipt = await runDecision({
    fixture: { ...fixture, run_id: "exit_strategy_context", data_mode: "alpaca_paper_live" },
    planner: new DeterministicReplayPlanner(),
    signingSecret,
    certificateScope: "paper_submit",
  });
  const context = buildExitStrategyContext(receipt, { signingSecret, now: new Date(asOf) });
  assert.equal(context.intent.direction, receipt.intent.direction);
  assert.equal(context.certificate.intent_sha256, receipt.certificate.intent_sha256);
  assert.throws(
    () => buildExitStrategyContext(
      { ...receipt, intent: { ...receipt.intent, direction: "bullish" } },
      { signingSecret, now: new Date(asOf) },
    ),
    /not bound/,
  );
  assert.throws(
    () => buildExitStrategyContext(receipt, { signingSecret: "wrong-strategy-context-secret-0123456789", now: new Date(asOf) }),
    /signature mismatch/,
  );
});

test("guarded autonomous runtime persists entry, manages risk exit, and releases only after a reconciled close", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-autonomous-execution-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const receipt = await runDecision({
    fixture: { ...fixture, data_mode: "alpaca_paper_live" },
    planner: new DeterministicReplayPlanner(),
    signingSecret,
    certificateScope: "paper_submit",
  });
  const candidate = receipt.compilation.selected;
  const ordersByClientId = new Map();
  const ordersById = new Map();
  let currentAt = asOf;
  let exitQuoteMode = "hold";
  let entryMutations = 0;
  let exitMutations = 0;
  let exitCancelMutations = 0;
  const optionQuotes = () => {
    if (exitQuoteMode === "risk") {
      return {
        [candidate.long_leg.symbol]: { bp: 1.10, ap: 1.15, t: asOf },
        [candidate.short_leg.symbol]: { bp: 0.90, ap: 0.95, t: asOf },
      };
    }
    return {
      [candidate.long_leg.symbol]: { bp: candidate.long_leg.bid, ap: candidate.long_leg.ask, t: currentAt },
      [candidate.short_leg.symbol]: { bp: candidate.short_leg.bid, ap: candidate.short_leg.ask, t: currentAt },
    };
  };
  const paperPositions = () => {
    const entryOrder = [...ordersByClientId.values()].find((order) => !order.client_order_id.startsWith("finly-exit-"));
    const exitOrders = [...ordersByClientId.values()].filter((order) => order.client_order_id.startsWith("finly-exit-"));
    if (entryOrder?.status !== "filled" || exitOrders.some((order) => order.status === "filled")) return [];
    return entryOrder.legs.map((leg) => ({
      symbol: leg.symbol,
      asset_class: "us_option",
      side: leg.side === "buy" ? "long" : "short",
      qty: entryOrder.qty,
    }));
  };
  const client = {
    tradingBase: "https://paper-api.alpaca.markets",
    dataBase: "https://data.alpaca.markets",
    getAccount: async () => ({
      account_number: "PAFIXTURE001",
      status: "ACTIVE",
      trading_blocked: false,
      account_blocked: false,
      trade_suspended_by_user: false,
      equity: "100000",
      options_buying_power: "100000",
      options_trading_level: 3,
      options_approved_level: 3,
    }),
    getAccountConfiguration: async () => ({ suspend_trade: false }),
    getClock: async () => ({ is_open: true, timestamp: currentAt }),
    getPositions: async () => paperPositions(),
    getOpenOrders: async () => [],
    getOptionContracts: async () => ({
      next_page_token: null,
      option_contracts: [candidate.long_leg, candidate.short_leg].map((leg) => ({
        symbol: leg.symbol,
        status: "active",
        tradable: true,
        multiplier: "100",
        size: "100",
        deliverables: [{ type: "equity", symbol: candidate.underlying, amount: "100", delayed_settlement: false }],
      })),
    }),
    getLatestOptionQuotes: async () => ({ quotes: optionQuotes() }),
    getStockLatestQuote: async () => ({ quote: { bp: 559.99, ap: 560.01, t: asOf } }),
    getOrderByClientOrderId: async (clientOrderId) => {
      const order = ordersByClientId.get(clientOrderId);
      return order ? { id: order.id } : null;
    },
    getOrderById: async (orderId) => structuredClone(ordersById.get(orderId)),
    cancelOrder: async (orderId) => {
      exitCancelMutations += 1;
      const order = ordersById.get(orderId);
      assert.ok(order, "cancel must target a known closing order");
      order.status = "canceled";
      ordersById.set(orderId, order);
      return { acknowledged: true };
    },
  };
  const mcpClient = {
    placeOptionOrder: async (projection) => {
      entryMutations += 1;
      const order = nestedOrder(projection, { id: "entry-order-00000001" });
      ordersByClientId.set(projection.client_order_id, order);
      ordersById.set(order.id, order);
      return { isError: false };
    },
    placeExitOrder: async (projection) => {
      exitMutations += 1;
      const order = nestedOrder(projection, { id: `exit-order-0000000${exitMutations}` });
      ordersByClientId.set(projection.client_order_id, order);
      ordersById.set(order.id, order);
      return { isError: false };
    },
  };
  const environment = {
    FINLY_EXECUTION_ENABLED: "true",
    FINLY_EXECUTION_TRANSPORT: "mcp",
    ALPACA_PAPER_TRADE: "true",
    FINLY_PAPER_MUTATION_ACK: "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT",
    FINLY_COMPETITION_ACCOUNT_ID: "PAFIXTURE001",
    FINLY_COMPETITION_START_AT: "2026-08-28T18:00:00.000Z",
    FINLY_COMPETITION_END_AT: "2026-08-28T19:00:00.000Z",
    FINLY_OPTIONS_ENTRY_CUTOFF_AT: "2026-08-28T18:40:00.000Z",
    FINLY_OPTIONS_FORCE_FLAT_AT: "2026-08-28T18:45:00.000Z",
    APCA_API_KEY_ID: "same-paper-key-id",
    APCA_API_SECRET_KEY: "same-paper-secret-key",
    FINLY_PERMIT_LEDGER_PATH: join(temporary, "ledger"),
    FINLY_LIFECYCLE_CHECKPOINT_PATH: join(temporary, "lifecycle"),
    FINLY_PAPER_SESSION_PATH: join(temporary, "sessions"),
  };
  const executor = buildGuardedLocalPaperExecutor({
    client,
    environment,
    signingSecret,
    now: () => new Date(currentAt),
    mcpClient,
  });

  const submitted = await executor.submit(candidate, receipt.certificate);
  assert.equal(submitted.lifecycle.status, "ACTIVE");
  assert.equal(submitted.lifecycle.phase, "ENTRY_ACCEPTED");
  assert.equal(entryMutations, 1);

  const entry = [...ordersByClientId.values()].find((order) => !order.client_order_id.startsWith("finly-exit-"));
  entry.status = "filled";
  entry.filled_qty = entry.qty;
  entry.filled_at = asOf;
  entry.legs.forEach((leg) => { leg.filled_qty = entry.qty; });
  ordersById.set(entry.id, entry);
  const held = await executor.positionManager.manageOpenSession();
  assert.equal(held.status, "POSITION_HELD_WITHIN_EXIT_GATES");
  assert.equal(held.phase, "POSITION_OPEN");
  assert.equal(held.assessment.holding_period_anchor_source, "broker_entry_filled_at");
  assert.equal(held.assessment.holding_period_anchor_at, asOf);
  assert.equal(exitMutations, 0);

  currentAt = environment.FINLY_OPTIONS_FORCE_FLAT_AT;
  let inputReads = 0;
  const managedCycle = await runAutonomousPaperCycle({
    client,
    executor,
    positionManager: executor.positionManager,
    economicBundleProvider: async () => bullishEconomicBundle(),
    environment,
    inputProvider: async () => {
      inputReads += 1;
      return {
        snapshot: {
          market: {
            ...structuredClone(fixture.market),
            history_mode: "alpaca_iex_adjusted_daily_bars",
            feed_disclosure: "Alpaca indicative options feed and IEX stock data.",
          },
          option_chain: structuredClone(fixture.option_chain),
        },
        newsResponse: { news: [] },
        account: await client.getAccount(),
        positions: paperPositions(),
        openOrders: [],
        clock: await client.getClock(),
        decisionTime: asOf,
      };
    },
    now: () => new Date(currentAt),
    signingSecret,
    logPath: join(temporary, "decisions.jsonl"),
    lockPath: join(temporary, "agent.lock"),
  });
  assert.equal(managedCycle.status, "EXIT_SUBMITTED_OR_RECONCILED");
  assert.equal(managedCycle.management.assessment.trigger, "competition_end_guard");
  assert.equal(managedCycle.management.strategy_context_status, "CURRENT_INTENT_UNAVAILABLE");
  assert.equal(inputReads, 1);
  assert.equal(exitMutations, 1);

  const firstExit = [...ordersByClientId.values()].find((order) => order.client_order_id.startsWith("finly-exit-"));
  assert.equal(Number(firstExit.limit_price) < 0, true);

  const repriced = await executor.positionManager.manageOpenSession();
  assert.equal(repriced.status, "EXIT_SUBMITTED_OR_RECONCILED");
  assert.equal(repriced.assessment.exit_attempt, 2);
  assert.equal(exitCancelMutations, 1);
  assert.equal(exitMutations, 2);
  const exits = [...ordersByClientId.values()].filter((order) => order.client_order_id.startsWith("finly-exit-"));
  assert.equal(exits[0].status, "canceled");
  assert.ok(Math.abs(Number(exits[1].limit_price)) < Math.abs(Number(exits[0].limit_price)));

  const exitOrder = exits[1];
  exitOrder.status = "filled";
  exitOrder.filled_qty = exitOrder.qty;
  exitOrder.filled_at = currentAt;
  exitOrder.legs.forEach((leg) => { leg.filled_qty = exitOrder.qty; });
  ordersById.set(exitOrder.id, exitOrder);
  const closed = await executor.positionManager.manageOpenSession();
  assert.equal(closed.terminal, true);
  assert.equal(closed.status, "CLOSED");
  const ledger = new FilePermitLedger(environment.FINLY_PERMIT_LEDGER_PATH);
  const released = await ledger.loadReservation(receipt.certificate.nonce);
  assert.equal(released.status, "closed");
  assert.equal(released.terminal_session_status, "CLOSED");
  assert.equal((await executor.positionManager.manageOpenSession()).active, false);
});

test("a broker-side manual closure freezes the active session and retains its risk reservation", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-autonomous-manual-close-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const receipt = await runDecision({
    fixture: { ...fixture, run_id: "autonomous_manual_close", data_mode: "alpaca_paper_live" },
    planner: new DeterministicReplayPlanner(),
    signingSecret,
    certificateScope: "paper_submit",
  });
  const candidate = receipt.compilation.selected;
  const ordersByClientId = new Map();
  const ordersById = new Map();
  const client = {
    tradingBase: "https://paper-api.alpaca.markets",
    dataBase: "https://data.alpaca.markets",
    getAccount: async () => ({
      account_number: "PAFIXTURE001",
      status: "ACTIVE",
      trading_blocked: false,
      account_blocked: false,
      trade_suspended_by_user: false,
      equity: "100000",
      options_buying_power: "100000",
      options_trading_level: 3,
      options_approved_level: 3,
    }),
    getAccountConfiguration: async () => ({ suspend_trade: false }),
    getClock: async () => ({ is_open: true, timestamp: asOf }),
    getPositions: async () => [],
    getOpenOrders: async () => [],
    getOptionContracts: async () => ({
      next_page_token: null,
      option_contracts: [candidate.long_leg, candidate.short_leg].map((leg) => ({
        symbol: leg.symbol,
        status: "active",
        tradable: true,
        multiplier: "100",
        size: "100",
        deliverables: [{ type: "equity", symbol: candidate.underlying, amount: "100", delayed_settlement: false }],
      })),
    }),
    getLatestOptionQuotes: async () => ({
      quotes: {
        [candidate.long_leg.symbol]: { bp: candidate.long_leg.bid, ap: candidate.long_leg.ask, t: asOf },
        [candidate.short_leg.symbol]: { bp: candidate.short_leg.bid, ap: candidate.short_leg.ask, t: asOf },
      },
    }),
    getStockLatestQuote: async () => ({ quote: { bp: 559.99, ap: 560.01, t: asOf } }),
    getOrderByClientOrderId: async (clientOrderId) => {
      const order = ordersByClientId.get(clientOrderId);
      return order ? { id: order.id } : null;
    },
    getOrderById: async (orderId) => structuredClone(ordersById.get(orderId)),
  };
  const mcpClient = {
    placeOptionOrder: async (projection) => {
      const order = nestedOrder(projection, {
        id: "manual-close-entry-order-0001",
        status: "filled",
        filled: Number(projection.qty),
      });
      order.filled_at = asOf;
      ordersByClientId.set(projection.client_order_id, order);
      ordersById.set(order.id, order);
      return { isError: false };
    },
    placeExitOrder: async () => { throw new Error("must not submit an exit after broker positions disappeared"); },
  };
  const environment = {
    FINLY_EXECUTION_ENABLED: "true",
    FINLY_EXECUTION_TRANSPORT: "mcp",
    ALPACA_PAPER_TRADE: "true",
    FINLY_PAPER_MUTATION_ACK: "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT",
    FINLY_COMPETITION_ACCOUNT_ID: "PAFIXTURE001",
    FINLY_COMPETITION_START_AT: "2026-08-28T18:00:00.000Z",
    FINLY_COMPETITION_END_AT: "2026-08-28T19:00:00.000Z",
    FINLY_OPTIONS_ENTRY_CUTOFF_AT: "2026-08-28T18:40:00.000Z",
    FINLY_OPTIONS_FORCE_FLAT_AT: "2026-08-28T18:45:00.000Z",
    APCA_API_KEY_ID: "same-paper-key-id",
    APCA_API_SECRET_KEY: "same-paper-secret-key",
    FINLY_PERMIT_LEDGER_PATH: join(temporary, "ledger"),
    FINLY_LIFECYCLE_CHECKPOINT_PATH: join(temporary, "lifecycle"),
    FINLY_PAPER_SESSION_PATH: join(temporary, "sessions"),
  };
  const executor = buildGuardedLocalPaperExecutor({ client, environment, signingSecret, now: () => new Date(asOf), mcpClient });
  const submitted = await executor.submit(candidate, receipt.certificate);
  assert.equal(submitted.lifecycle.phase, "POSITION_OPEN");

  const tamperedStrategyContext = buildExitStrategyContext(receipt, { signingSecret, now: new Date(asOf) });
  tamperedStrategyContext.intent.direction = "bullish";
  await assert.rejects(
    () => executor.positionManager.manageOpenSession({ strategyContext: tamperedStrategyContext }),
    /exit strategy context is invalid/,
  );

  await assert.rejects(
    () => executor.positionManager.manageOpenSession(),
    /certified spread is absent from the broker account/,
  );
  const frozen = await executor.positionManager.manageOpenSession();
  assert.equal(frozen.status, "FROZEN_REQUIRES_RECONCILIATION");
  const ledger = new FilePermitLedger(environment.FINLY_PERMIT_LEDGER_PATH);
  assert.equal((await ledger.loadReservation(receipt.certificate.nonce)).status, "accepted");
});
