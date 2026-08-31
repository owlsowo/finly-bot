import { createHmac, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, stableStringify } from "./canonical.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const G4_OFFICIAL_PROTOCOL_PATH = resolve(projectRoot, "config/g4-official-production.json");
export const G4_OFFICIAL_SOURCE_SIGNAL_PATH = resolve(projectRoot, "config/g4-official-source-signal.json");
export const G4_OFFICIAL_STATE_DIRECTORY = "data/private/g4-official-equity";
export const G4_OFFICIAL_LOG_PATH = "outputs/g4_official_equity.jsonl";
export const G4_EQUITY_SYMBOLS = Object.freeze(["QQQ", "XLB", "XLE", "XLV"]);
const G4_SOURCE_SYMBOLS = Object.freeze(["QQQ", "XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY"]);
export const G4_CLIENT_ORDER_ID = /^finly-g4-[a-f0-9]{20}$/;

const READY_STATUS = "G4_EQUITY_READY";
const KNOWN_OPEN_STATUSES = new Set(["accepted", "accepted_for_bidding", "held", "new", "pending_new"]);
const TERMINAL_FAILURE_STATUSES = new Set([
  "canceled", "done_for_day", "expired", "rejected", "replaced", "stopped", "suspended",
]);
const STATE_PHASES = new Set(["PLANNED", "ORDER_PENDING", "RECONCILING", "READY", "FROZEN"]);
const MUTATION_ACK = "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT";
const BASELINE_TOLERANCE_DOLLARS = 0.01;
const CASH_FLOOR_TOLERANCE_DOLLARS = 5;

function clone(value) { return structuredClone(value); }

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || stableStringify(Object.keys(value).sort()) !== stableStringify([...keys].sort())) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function exactInstant(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error(`${label} is invalid`);
  return value;
}

function finiteMoney(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} is invalid`);
  return number;
}

function signedBody(protocol) {
  const body = clone(protocol);
  delete body.protocol_hash;
  return body;
}

export function assertG4OfficialProductionProtocol(protocol) {
  exactKeys(protocol, [
    "allocation", "authority", "competition_window", "frozen_at", "protocol_hash", "protocol_id",
    "schema_version", "source_signal", "transport",
  ], "G4 production protocol");
  if (protocol.schema_version !== "finly_g4_official_production_protocol.v1"
    || protocol.protocol_id !== "g4-official-production-2026-08-31"
    || protocol.protocol_hash !== sha256(signedBody(protocol))) {
    throw new Error("G4 production protocol identity or hash is invalid");
  }
  exactInstant(protocol.frozen_at, "G4 protocol freeze time");
  exactKeys(protocol.authority, [
    "account_binding_environment_variable", "broker_mutation_default", "paper_only", "purpose",
    "separate_from_shadow_protocol",
  ], "G4 protocol authority");
  if (protocol.authority.purpose !== "official_alpaca_hackathon_paper_account"
    || protocol.authority.paper_only !== true
    || protocol.authority.broker_mutation_default !== false
    || protocol.authority.account_binding_environment_variable !== "FINLY_COMPETITION_ACCOUNT_ID"
    || protocol.authority.separate_from_shadow_protocol !== true) {
    throw new Error("G4 production authority is invalid");
  }
  exactKeys(protocol.competition_window, ["end_at", "start_at"], "G4 competition window");
  exactInstant(protocol.competition_window.start_at, "G4 competition start");
  exactInstant(protocol.competition_window.end_at, "G4 competition end");
  if (protocol.competition_window.start_at !== "2026-08-31T13:30:00.000Z"
    || protocol.competition_window.end_at !== "2026-09-04T13:30:00.000Z") {
    throw new Error("G4 production window drifted");
  }
  exactKeys(protocol.source_signal, [
    "artifact_path", "provider", "selected_sector_symbols", "signal_session_date", "signal_sha256",
    "source_panel_sha256", "strategy_id",
  ], "G4 source signal");
  if (protocol.source_signal.strategy_id !== "qqq_core_sector_12_6"
    || protocol.source_signal.signal_session_date !== "2026-08-28"
    || protocol.source_signal.signal_sha256 !== "sha256:6dd31d795c210e2e8363718c180cf201cf07a77a31d9a634b1421f304a69375f"
    || protocol.source_signal.source_panel_sha256 !== "sha256:668d13fbf850b69266f5ef474ec1810364f43745496e5e559dac5bdde456e455"
    || protocol.source_signal.artifact_path !== "config/g4-official-source-signal.json"
    || protocol.source_signal.provider !== "Alpaca Market Data API / IEX / adjustment=all"
    || stableStringify(protocol.source_signal.selected_sector_symbols) !== stableStringify(["XLB", "XLE", "XLV"])) {
    throw new Error("G4 source signal drifted");
  }
  exactKeys(protocol.allocation, [
    "baseline_equity_dollars", "cash_floor_fraction", "in_contest_reoptimization",
    "invested_ceiling_fraction", "rebalance_policy", "targets",
  ], "G4 allocation");
  if (protocol.allocation.baseline_equity_dollars !== "100000.00"
    || protocol.allocation.invested_ceiling_fraction !== "0.9700000000000"
    || protocol.allocation.cash_floor_fraction !== "0.0300000000000"
    || protocol.allocation.rebalance_policy !== "one_initial_rebalance_only"
    || protocol.allocation.in_contest_reoptimization !== false
    || !Array.isArray(protocol.allocation.targets)
    || protocol.allocation.targets.length !== 4) {
    throw new Error("G4 allocation policy drifted");
  }
  const expectedWeights = ["0.4850000000000", "0.1616666666667", "0.1616666666667", "0.1616666666667"];
  protocol.allocation.targets.forEach((target, index) => {
    exactKeys(target, ["symbol", "weight"], `G4 target ${index + 1}`);
    if (target.symbol !== G4_EQUITY_SYMBOLS[index] || target.weight !== expectedWeights[index]) {
      throw new Error("G4 target allocation drifted");
    }
  });
  exactKeys(protocol.transport, [
    "idempotency_namespace", "paper_host", "server", "tool", "tool_schema_sha256", "version",
  ], "G4 transport");
  if (protocol.transport.paper_host !== "https://paper-api.alpaca.markets"
    || protocol.transport.server !== "alpaca-mcp-server"
    || protocol.transport.version !== "2.2.1"
    || protocol.transport.tool !== "place_stock_order"
    || protocol.transport.tool_schema_sha256 !== "sha256:3826d0d06bf6c48e77897fa2a833431a42287b34c4bb9a3a303db7b726759288"
    || protocol.transport.idempotency_namespace !== "finly-g4-[a-f0-9]{20}") {
    throw new Error("G4 pinned transport drifted");
  }
  return protocol;
}

export function assertG4OfficialSourceSignal(sourceSignal, protocol) {
  assertG4OfficialProductionProtocol(protocol);
  exactKeys(sourceSignal, [
    "schema_version", "selected_sectors", "signal_session_date", "source_panel", "strategy_id", "target_weights",
  ], "G4 source-signal artifact");
  if (sourceSignal.schema_version !== "finly_g4_official_source_signal.v1"
    || sourceSignal.strategy_id !== protocol.source_signal.strategy_id
    || sourceSignal.signal_session_date !== protocol.source_signal.signal_session_date
    || sha256(sourceSignal) !== protocol.source_signal.signal_sha256
    || stableStringify(sourceSignal.selected_sectors) !== stableStringify(protocol.source_signal.selected_sector_symbols)) {
    throw new Error("G4 source-signal artifact identity or hash is invalid");
  }
  exactKeys(sourceSignal.source_panel, [
    "adjustment", "feed", "lookback_sessions", "provider", "retained_sessions", "source_panel_sha256",
  ], "G4 source-signal panel");
  if (sourceSignal.source_panel.provider !== "Alpaca Market Data API"
    || sourceSignal.source_panel.feed !== "iex"
    || sourceSignal.source_panel.adjustment !== "all"
    || sourceSignal.source_panel.lookback_sessions !== 252
    || sourceSignal.source_panel.retained_sessions !== 253
    || sourceSignal.source_panel.source_panel_sha256 !== protocol.source_signal.source_panel_sha256) {
    throw new Error("G4 source-signal panel binding is invalid");
  }
  exactKeys(sourceSignal.target_weights, G4_SOURCE_SYMBOLS, "G4 source-signal weights");
  const positive = Object.entries(sourceSignal.target_weights)
    .filter(([symbol, weight]) => symbol !== "QQQ" && Number(weight) > 0)
    .map(([symbol]) => symbol)
    .sort();
  const total = Object.values(sourceSignal.target_weights).reduce((sum, weight) => sum + Number(weight), 0);
  if (sourceSignal.target_weights.QQQ !== 0.5
    || stableStringify(positive) !== stableStringify(["XLB", "XLE", "XLV"])
    || positive.some((symbol) => sourceSignal.target_weights[symbol] !== 1 / 6)
    || Math.abs(total - 1) > 1e-12) {
    throw new Error("G4 source-signal full weights are invalid");
  }
  return sourceSignal;
}

export async function loadG4OfficialProductionProtocol(path = G4_OFFICIAL_PROTOCOL_PATH) {
  const protocol = JSON.parse(await readFile(path, "utf8"));
  assertG4OfficialProductionProtocol(protocol);
  const sourceSignal = JSON.parse(await readFile(G4_OFFICIAL_SOURCE_SIGNAL_PATH, "utf8"));
  assertG4OfficialSourceSignal(sourceSignal, protocol);
  return protocol;
}

function decimalFraction(value) {
  if (typeof value !== "string" || !/^0\.\d{13}$/.test(value)) throw new Error("G4 target weight is invalid");
  return BigInt(value.slice(2));
}

export function buildG4OfficialOrderPlan(protocol, baselineEquity = 100_000) {
  assertG4OfficialProductionProtocol(protocol);
  if (!Number.isFinite(baselineEquity)
    || Math.abs(baselineEquity - Number(protocol.allocation.baseline_equity_dollars)) > BASELINE_TOLERANCE_DOLLARS) {
    throw new Error("G4 baseline equity does not match the official account baseline");
  }
  const baselineCents = BigInt(Math.round(baselineEquity * 100));
  const denominator = 10n ** 13n;
  const orders = protocol.allocation.targets.map((target, sequence) => {
    const cents = baselineCents * decimalFraction(target.weight) / denominator;
    const notional = `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
    const clientOrderId = `finly-g4-${sha256({
      protocol_hash: protocol.protocol_hash, sequence, symbol: target.symbol, notional,
    }).slice(-20)}`;
    return Object.freeze({
      client_order_id: clientOrderId,
      notional,
      side: "buy",
      symbol: target.symbol,
      time_in_force: "day",
      type: "market",
    });
  });
  const investedCents = orders.reduce((sum, order) => sum + BigInt(order.notional.replace(".", "")), 0n);
  const ceilingCents = baselineCents * 97n / 100n;
  const cashFloorCents = baselineCents * 3n / 100n;
  if (investedCents > ceilingCents || baselineCents - investedCents < cashFloorCents) {
    throw new Error("G4 plan violates its capital ceiling or cash floor");
  }
  return Object.freeze(orders);
}

export function assertG4StockOrderArguments(value) {
  exactKeys(value, ["client_order_id", "notional", "side", "symbol", "time_in_force", "type"], "G4 stock order");
  if (!G4_EQUITY_SYMBOLS.includes(value.symbol)
    || value.side !== "buy"
    || value.type !== "market"
    || value.time_in_force !== "day"
    || !/^\d{1,6}\.\d{2}$/.test(value.notional)
    || Number(value.notional) <= 0
    || Number(value.notional) > 50_000
    || !G4_CLIENT_ORDER_ID.test(value.client_order_id)) {
    throw new Error("G4 stock order is outside the frozen production policy");
  }
  return true;
}

function assertSigningSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new Error("G4 checkpoint signing secret must be at least 32 bytes");
  }
}

function stateHmac(state, secret) {
  return `sha256:${createHmac("sha256", secret).update(stableStringify(state)).digest("hex")}`;
}

function parseSignedState(serialized, secret, protocol) {
  assertSigningSecret(secret);
  let envelope;
  try { envelope = JSON.parse(serialized); } catch { throw new Error("G4 state contains invalid JSON"); }
  exactKeys(envelope, ["hmac_sha256", "schema_version", "state"], "G4 signed state");
  if (envelope.schema_version !== "finly_g4_signed_state.v1" || !/^sha256:[a-f0-9]{64}$/.test(envelope.hmac_sha256)) {
    throw new Error("G4 signed state metadata is invalid");
  }
  const expected = Buffer.from(stateHmac(envelope.state, secret));
  const observed = Buffer.from(envelope.hmac_sha256);
  if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) throw new Error("G4 state authentication failed");
  assertState(envelope.state, protocol);
  return envelope.state;
}

function serializeSignedState(state, secret) {
  assertSigningSecret(secret);
  return stableStringify({
    schema_version: "finly_g4_signed_state.v1",
    state,
    hmac_sha256: stateHmac(state, secret),
  });
}

function stateFileName(protocolId) {
  if (!/^[a-z0-9-]{8,64}$/.test(protocolId)) throw new Error("G4 protocol ID is invalid for state storage");
  return `${protocolId}.json`;
}

export class FileG4OfficialCheckpointStore {
  constructor(directory = resolve(projectRoot, G4_OFFICIAL_STATE_DIRECTORY)) {
    this.directory = resolve(directory);
  }

  pathFor(protocolId) { return join(this.directory, stateFileName(protocolId)); }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      throw new Error("G4 checkpoint directory is not a private real directory");
    }
  }

  async load(protocolId) {
    await this.initialize();
    try { return await readFile(this.pathFor(protocolId), "utf8"); }
    catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new Error("G4 checkpoint could not be read");
    }
  }

  async save(protocolId, serialized, { expectedPreviousRevision }) {
    if (typeof serialized !== "string" || Buffer.byteLength(serialized) > 256_000) throw new Error("G4 checkpoint is invalid");
    const incoming = JSON.parse(serialized);
    const incomingRevision = incoming?.state?.revision;
    await this.initialize();
    const path = this.pathFor(protocolId);
    const lock = `${path}.lock`;
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (error) {
      if (error?.code === "EEXIST") throw new Error("G4 checkpoint is locked; fail closed");
      throw error;
    }
    let temporary = null;
    try {
      let existing = null;
      try { existing = await readFile(path, "utf8"); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (existing === serialized) return { written: false, revision: incomingRevision };
      if (existing === null) {
        if (expectedPreviousRevision !== null || incomingRevision !== 0) throw new Error("G4 checkpoint creation revision is inconsistent");
      } else {
        const current = JSON.parse(existing);
        if (!Number.isInteger(expectedPreviousRevision)
          || current?.state?.revision !== expectedPreviousRevision
          || incomingRevision !== expectedPreviousRevision + 1) {
          throw new Error("G4 checkpoint compare-and-swap conflict");
        }
      }
      temporary = `${path}.${process.pid}.${sha256(serialized).slice(-12)}.tmp`;
      await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
      temporary = null;
      return { written: true, revision: incomingRevision };
    } finally {
      if (temporary !== null) await unlink(temporary).catch(() => {});
      await rmdir(lock).catch(() => {});
    }
  }
}

function assertState(state, protocol) {
  exactKeys(state, [
    "account_binding_sha256", "baseline_equity", "created_at", "legs", "mutation_started", "phase",
    "protocol_hash", "revision", "updated_at",
  ], "G4 lifecycle state");
  if (state.protocol_hash !== protocol.protocol_hash
    || !/^sha256:[a-f0-9]{64}$/.test(state.account_binding_sha256)
    || !Number.isInteger(state.revision)
    || state.revision < 0
    || !STATE_PHASES.has(state.phase)
    || typeof state.mutation_started !== "boolean"
    || state.baseline_equity !== "100000.00"
    || !Array.isArray(state.legs)
    || state.legs.length !== 4) {
    throw new Error("G4 lifecycle state metadata is invalid");
  }
  exactInstant(state.created_at, "G4 state creation time");
  exactInstant(state.updated_at, "G4 state update time");
  const plan = buildG4OfficialOrderPlan(protocol, Number(state.baseline_equity));
  state.legs.forEach((leg, index) => {
    exactKeys(leg, [
      "attempts", "broker_order_id_sha256", "filled_avg_price", "filled_notional", "filled_qty",
      "order", "status",
    ], `G4 state leg ${index + 1}`);
    const filled = leg.status === "FILLED";
    const filledQtyValid = typeof leg.filled_qty === "string"
      && /^(?:0|[1-9]\d*)\.\d{8}$/.test(leg.filled_qty)
      && Number.isFinite(Number(leg.filled_qty))
      && Number(leg.filled_qty) > 0;
    const filledAvgPriceValid = typeof leg.filled_avg_price === "string"
      && /^(?:0|[1-9]\d*)\.\d{8}$/.test(leg.filled_avg_price)
      && Number.isFinite(Number(leg.filled_avg_price))
      && Number(leg.filled_avg_price) > 0;
    const filledNotionalValid = typeof leg.filled_notional === "string"
      && /^(?:0|[1-9]\d*)\.\d{2}$/.test(leg.filled_notional)
      && Number.isFinite(Number(leg.filled_notional))
      && Number(leg.filled_notional) > 0;
    const fillFieldsAreNull = leg.filled_qty === null
      && leg.filled_avg_price === null
      && leg.filled_notional === null;
    const observedNotional = Number(leg.filled_notional);
    const computedNotional = Number(leg.filled_qty) * Number(leg.filled_avg_price);
    const authorizedNotional = Number(plan[index].notional);
    const fillTolerance = Math.max(5, authorizedNotional * 0.001);
    if (stableStringify(leg.order) !== stableStringify(plan[index])
      || !Number.isInteger(leg.attempts)
      || leg.attempts < 0
      || !new Set(["PLANNED", "MUTATION_PENDING", "BROKER_PENDING", "FILLED", "FAILED"]).has(leg.status)
      || (leg.broker_order_id_sha256 !== null && !/^sha256:[a-f0-9]{64}$/.test(leg.broker_order_id_sha256))
      || (filled && (leg.broker_order_id_sha256 === null
        || !filledQtyValid
        || !filledAvgPriceValid
        || !filledNotionalValid
        || Math.abs(computedNotional - observedNotional) > 0.011
        || Math.abs(observedNotional - authorizedNotional) > fillTolerance))
      || (!filled && !fillFieldsAreNull)) {
      throw new Error("G4 lifecycle leg is invalid");
    }
  });
  return state;
}

function initialState(protocol, expectedAccountId, observedAt, baselineEquity) {
  return {
    protocol_hash: protocol.protocol_hash,
    account_binding_sha256: sha256(expectedAccountId),
    baseline_equity: baselineEquity.toFixed(2),
    phase: "PLANNED",
    mutation_started: false,
    revision: 0,
    created_at: observedAt,
    updated_at: observedAt,
    legs: buildG4OfficialOrderPlan(protocol, baselineEquity).map((order) => ({
      order: clone(order),
      status: "PLANNED",
      attempts: 0,
      broker_order_id_sha256: null,
      filled_qty: null,
      filled_avg_price: null,
      filled_notional: null,
    })),
  };
}

function mutationEnvironmentEnabled(environment) {
  return environment?.FINLY_G4_PRODUCTION_ENABLED === "true"
    && environment?.FINLY_EXECUTION_ENABLED === "true"
    && environment?.FINLY_EXECUTION_TRANSPORT === "mcp"
    && environment?.ALPACA_PAPER_TRADE === "true"
    && environment?.FINLY_PAPER_MUTATION_ACK === MUTATION_ACK;
}

function competitionWindow(protocol, observedAt) {
  const time = Date.parse(observedAt);
  if (time < Date.parse(protocol.competition_window.start_at)) return "BEFORE";
  if (time >= Date.parse(protocol.competition_window.end_at)) return "ENDED";
  return "OPEN";
}

function assertAccount(account, expectedAccountId, { initial }) {
  if (!account || account.account_number !== expectedAccountId || account.status !== "ACTIVE"
    || account.trading_blocked !== false || account.account_blocked !== false
    || account.trade_suspended_by_user !== false) {
    throw new Error("official G4 account identity or trading status failed");
  }
  const equity = finiteMoney(account.equity, "G4 account equity");
  const cash = finiteMoney(account.cash, "G4 account cash");
  finiteMoney(account.buying_power, "G4 account buying power");
  if (initial && (Math.abs(equity - 100_000) > BASELINE_TOLERANCE_DOLLARS
    || Math.abs(cash - 100_000) > BASELINE_TOLERANCE_DOLLARS)) {
    throw new Error("official G4 account does not match the exact untouched $100,000 baseline");
  }
  return { equity, cash };
}

function assertClock(clock, observedAt) {
  if (!clock || clock.is_open !== true) throw new Error("G4 equity mutation is allowed only while the market is open");
  const clockAt = Date.parse(exactInstant(clock.timestamp, "Alpaca clock timestamp"));
  if (Math.abs(clockAt - Date.parse(observedAt)) > 180_000) throw new Error("Alpaca clock is stale or inconsistent");
}

function optionUnderlying(symbol) {
  try { return parseOccOptionSymbol(symbol).underlying; } catch { return null; }
}

function isG4EquityPosition(position) {
  return position?.asset_class === "us_equity" && G4_EQUITY_SYMBOLS.includes(position.symbol);
}

function isSpyOptionPosition(position) {
  return position?.asset_class === "us_option" && optionUnderlying(position.symbol) === "SPY";
}

function isG4EquityOrder(order) {
  return G4_EQUITY_SYMBOLS.includes(order?.symbol) && G4_CLIENT_ORDER_ID.test(order?.client_order_id ?? "");
}

function isSpyOptionOrder(order) {
  if (!/^finly-(?:exit-)?[a-f0-9]{20}$/.test(order?.client_order_id ?? "")) return false;
  if (order?.asset_class !== "" || order.order_class !== "mleg"
    || !Array.isArray(order.legs) || order.legs.length !== 2) return false;
  return order.legs.every((leg) => leg?.asset_class === "us_option" && optionUnderlying(leg.symbol) === "SPY");
}

function assertG4EquityOrderShape(order) {
  if (!isG4EquityOrder(order)
    || order.side !== "buy"
    || order.type !== "market"
    || order.time_in_force !== "day"
    || (order.asset_class !== undefined && order.asset_class !== "us_equity")) {
    throw new Error("broker contains a malformed G4 equity order");
  }
}

function classifyBrokerView({ positions, openOrders, allowOptions }) {
  if (!Array.isArray(positions) || !Array.isArray(openOrders)) throw new Error("broker positions/orders are incomplete");
  const view = { equityPositions: [], equityOrders: [], optionPositions: [], optionOrders: [] };
  for (const position of positions) {
    if (isG4EquityPosition(position)) {
      if (Number(position.qty) <= 0 || position.side !== "long") throw new Error("G4 equity position is not long-only");
      view.equityPositions.push(position);
    } else if (allowOptions && isSpyOptionPosition(position)) view.optionPositions.push(position);
    else throw new Error("broker contains an unsupported holding");
  }
  for (const order of openOrders) {
    if (isG4EquityOrder(order)) {
      assertG4EquityOrderShape(order);
      view.equityOrders.push(order);
    } else if (allowOptions && isSpyOptionOrder(order)) view.optionOrders.push(order);
    else throw new Error("broker contains an unsupported open order");
  }
  return view;
}

function assertReadyEquityQuantities(view, state) {
  if (view.equityPositions.length !== 4) throw new Error("READY G4 sleeve must contain exactly four equity positions");
  const bySymbol = new Map();
  for (const position of view.equityPositions) {
    if (bySymbol.has(position.symbol)) throw new Error("READY G4 sleeve contains a duplicate equity position");
    bySymbol.set(position.symbol, position);
  }
  for (const leg of state.legs) {
    if (leg.status !== "FILLED" || leg.filled_qty === null) throw new Error("READY G4 state lacks a signed filled quantity");
    const observed = Number(bySymbol.get(leg.order.symbol)?.qty);
    const expected = Number(leg.filled_qty);
    const tolerance = Math.max(1e-7, expected * 1e-8);
    if (!Number.isFinite(observed) || observed <= 0 || Math.abs(observed - expected) > tolerance) {
      throw new Error(`READY G4 broker quantity drifted for ${leg.order.symbol}`);
    }
  }
}

function assertReadyReceipt(receipt, protocol) {
  exactKeys(receipt, [
    "allocation", "equity_ready", "protocol_hash", "receipt_hash", "schema_version", "state_hash", "status",
  ], "G4 readiness receipt");
  const body = clone(receipt);
  delete body.receipt_hash;
  if (receipt.schema_version !== "finly_g4_equity_readiness.v1"
    || receipt.status !== READY_STATUS
    || receipt.equity_ready !== true
    || receipt.protocol_hash !== protocol.protocol_hash
    || receipt.receipt_hash !== sha256(body)) throw new Error("G4 readiness receipt is invalid");
  return receipt;
}

/** Strictly partitions G4 equity state from the SPY options overlay. */
export function splitG4OfficialBrokerView({ positions, openOrders, protocol, readinessReceipt }) {
  assertG4OfficialProductionProtocol(protocol);
  assertReadyReceipt(readinessReceipt, protocol);
  const view = classifyBrokerView({ positions, openOrders, allowOptions: true });
  if (view.equityOrders.length !== 0) throw new Error("READY G4 sleeve cannot retain open equity orders");
  const held = new Set(view.equityPositions.map((position) => position.symbol));
  if (held.size !== 4 || G4_EQUITY_SYMBOLS.some((symbol) => !held.has(symbol))) {
    throw new Error("READY G4 sleeve does not contain the exact four equity holdings");
  }
  return view;
}

function brokerOrderResult(order, projection) {
  if (!order || typeof order !== "object") throw new Error("G4 broker read-back is absent");
  assertG4EquityOrderShape(order);
  if (order.client_order_id !== projection.client_order_id || order.symbol !== projection.symbol) {
    throw new Error("G4 broker read-back does not match the frozen projection");
  }
  if (order.notional !== undefined && Number(order.notional).toFixed(2) !== projection.notional) {
    throw new Error("G4 broker read-back notional drifted");
  }
  const status = String(order.status ?? "").toLowerCase();
  // Alpaca paper trading can intentionally report an intermediate partial fill
  // before re-evaluating the remainder. Keep reconciling the same deterministic
  // client order ID; never submit a replacement or treat normal progress as a
  // terminal strategy failure.
  if (status === "partially_filled") return { kind: "PENDING" };
  if (TERMINAL_FAILURE_STATUSES.has(status)) return { kind: "FAILED", reason: `TERMINAL_${status.toUpperCase()}` };
  if (KNOWN_OPEN_STATUSES.has(status)) return { kind: "PENDING" };
  if (status !== "filled") throw new Error("G4 broker returned an unknown order status");
  const filledQty = finiteMoney(order.filled_qty, "G4 filled quantity");
  const filledAvgPrice = finiteMoney(order.filled_avg_price, "G4 filled average price");
  if (filledQty <= 0 || filledAvgPrice <= 0) throw new Error("G4 filled order lacks a positive fill");
  const filledNotional = filledQty * filledAvgPrice;
  const authorizedNotional = Number(projection.notional);
  const fillTolerance = Math.max(5, authorizedNotional * 0.001);
  if (Math.abs(filledNotional - authorizedNotional) > fillTolerance) {
    throw new Error("G4 fill is outside the two-sided frozen notional tolerance");
  }
  return {
    kind: "FILLED",
    brokerOrderIdHash: sha256(String(order.id)),
    filledQty: filledQty.toFixed(8),
    filledAvgPrice: filledAvgPrice.toFixed(8),
    filledNotional: filledNotional.toFixed(2),
  };
}

function readinessReceipt(state, protocol) {
  const allocation = Object.fromEntries(state.legs.map((leg) => [leg.order.symbol, leg.order.notional]));
  const body = {
    schema_version: "finly_g4_equity_readiness.v1",
    status: READY_STATUS,
    equity_ready: true,
    protocol_hash: protocol.protocol_hash,
    state_hash: sha256(state),
    allocation,
  };
  return Object.freeze({ ...body, receipt_hash: sha256(body) });
}

function publicResult(status, state, protocol, extras = {}) {
  const mutationStarted = state?.mutation_started === true;
  return {
    status,
    protocol_hash: protocol.protocol_hash,
    equity_ready: status === READY_STATUS,
    options_authorized: status === READY_STATUS,
    mutation_started: mutationStarted,
    fallback: mutationStarted ? "MANUAL_RECONCILIATION_REQUIRED" : "SPY_CASH_HANDOFF_REQUIRED",
    readiness_receipt: status === READY_STATUS ? readinessReceipt(state, protocol) : null,
    ...extras,
  };
}

async function loadState(store, secret, protocol) {
  const serialized = await store.load(protocol.protocol_id);
  return serialized === null ? null : parseSignedState(serialized, secret, protocol);
}

async function saveState(store, secret, protocol, state, expectedPreviousRevision) {
  assertState(state, protocol);
  await store.save(protocol.protocol_id, serializeSignedState(state, secret), { expectedPreviousRevision });
  return state;
}

function nextState(state, observedAt, patch) {
  return { ...clone(state), ...patch, revision: state.revision + 1, updated_at: observedAt };
}

function frozenState(state, observedAt, legIndex = null) {
  const copy = clone(state);
  if (legIndex !== null) copy.legs[legIndex].status = "FAILED";
  return nextState(copy, observedAt, { phase: "FROZEN" });
}

async function readBroker(client) {
  const [account, clock, positions, openOrders] = await Promise.all([
    client.getAccount(), client.getClock(), client.getPositions(), client.getOpenOrders(),
  ]);
  return { account, clock, positions, openOrders };
}

async function assertTradableFractionalAssets(client) {
  const assets = await Promise.all(G4_EQUITY_SYMBOLS.map((symbol) => client.getAsset(symbol)));
  assets.forEach((asset, index) => {
    if (!asset || asset.symbol !== G4_EQUITY_SYMBOLS[index]
      || asset.class !== "us_equity"
      || asset.status !== "active"
      || asset.tradable !== true
      || asset.fractionable !== true) {
      throw new Error(`G4 asset readiness failed for ${G4_EQUITY_SYMBOLS[index]}`);
    }
  });
}

/**
 * Advance the one-time official G4 allocation by at most one broker mutation.
 * Every mutation follows durable intent -> cloud checkpoint -> MCP call -> REST read-back.
 */
export async function runG4OfficialEquityCycle({
  protocol,
  store,
  signingSecret,
  client,
  mutationClient,
  expectedAccountId,
  environment = process.env,
  now = new Date(),
  stateCheckpoint = async () => {},
} = {}) {
  assertG4OfficialProductionProtocol(protocol);
  assertSigningSecret(signingSecret);
  if (!store || typeof store.load !== "function" || typeof store.save !== "function") throw new Error("G4 checkpoint store is invalid");
  if (!client || typeof client.getAccount !== "function" || typeof client.getClock !== "function"
    || typeof client.getPositions !== "function" || typeof client.getOpenOrders !== "function"
    || typeof client.getOrderByClientOrderId !== "function" || typeof client.getAsset !== "function") {
    throw new Error("G4 read client is incomplete");
  }
  if (!mutationClient || typeof mutationClient.placeStockOrder !== "function") throw new Error("G4 mutation client is incomplete");
  if (typeof expectedAccountId !== "string" || !/^PA[A-Z0-9]{10}$/.test(expectedAccountId)) throw new Error("G4 expected account ID is invalid");
  if (typeof stateCheckpoint !== "function") throw new Error("G4 state checkpoint callback is invalid");
  const observedAt = new Date(now).toISOString();
  const window = competitionWindow(protocol, observedAt);
  let state = await loadState(store, signingSecret, protocol);
  if (state !== null && state.account_binding_sha256 !== sha256(expectedAccountId)) throw new Error("G4 state is bound to a different account");
  if (state?.phase === "READY") {
    let broker;
    try {
      broker = await readBroker(client);
    } catch {
      // A temporary read outage is not evidence that a previously reconciled
      // portfolio changed. Preserve the signed READY state and retry later.
      return publicResult("G4_RECONCILIATION_DEFERRED", state, protocol, {
        reason: "BROKER_READ_UNAVAILABLE",
      });
    }
    try {
      assertAccount(broker.account, expectedAccountId, { initial: false });
      const view = classifyBrokerView({ positions: broker.positions, openOrders: broker.openOrders, allowOptions: true });
      if (view.equityOrders.length !== 0) throw new Error("READY G4 broker state retained an equity order");
      assertReadyEquityQuantities(view, state);
      const receipt = readinessReceipt(state, protocol);
      splitG4OfficialBrokerView({ positions: broker.positions, openOrders: broker.openOrders, protocol, readinessReceipt: receipt });
      return publicResult(READY_STATUS, state, protocol);
    } catch (error) {
      state = frozenState(state, observedAt);
      await saveState(store, signingSecret, protocol, state, state.revision - 1);
      return publicResult("G4_EQUITY_FROZEN", state, protocol, { reason: error.message });
    }
  }
  if (state?.phase === "FROZEN") return publicResult("G4_EQUITY_FROZEN", state, protocol);
  if (window !== "OPEN") {
    return publicResult(window === "BEFORE" ? "G4_WAITING_FOR_WINDOW" : "G4_WINDOW_ENDED", state, protocol);
  }

  let broker;
  try {
    broker = await readBroker(client);
    assertClock(broker.clock, observedAt);
    const account = assertAccount(broker.account, expectedAccountId, { initial: state === null });
    classifyBrokerView({ positions: broker.positions, openOrders: broker.openOrders, allowOptions: false });
    if (state === null) {
      if (broker.positions.length !== 0 || broker.openOrders.length !== 0) throw new Error("G4 initial account is not flat");
      await assertTradableFractionalAssets(client);
      state = initialState(protocol, expectedAccountId, observedAt, account.equity);
      await saveState(store, signingSecret, protocol, state, null);
    }
  } catch (error) {
    if (state?.mutation_started) throw error;
    return publicResult("G4_READINESS_FAILED", state, protocol, { reason: error.message });
  }

  if (!mutationEnvironmentEnabled(environment)) {
    return publicResult("G4_MUTATION_DISABLED", state, protocol);
  }

  const nextLegIndex = state.legs.findIndex((leg) => leg.status !== "FILLED");
  if (nextLegIndex === -1) {
    const totalFilled = state.legs.reduce((sum, leg) => sum + Number(leg.filled_notional), 0);
    const authorizedTotal = buildG4OfficialOrderPlan(protocol, Number(state.baseline_equity))
      .reduce((sum, order) => sum + Number(order.notional), 0);
    const account = assertAccount(broker.account, expectedAccountId, { initial: false });
    const view = classifyBrokerView({ positions: broker.positions, openOrders: broker.openOrders, allowOptions: false });
    const held = new Set(view.equityPositions.map((position) => position.symbol));
    if (totalFilled < authorizedTotal - 20
      || totalFilled > Number(state.baseline_equity) * 0.97 + 0.01
      || account.cash < Number(state.baseline_equity) * 0.03 - CASH_FLOOR_TOLERANCE_DOLLARS) {
      state = frozenState(state, observedAt);
      await saveState(store, signingSecret, protocol, state, state.revision - 1);
      return publicResult("G4_EQUITY_FROZEN", state, protocol, { reason: "FINAL_RECONCILIATION_FAILED" });
    }
    // A filled order can become visible before the aggregate orders/positions
    // endpoints converge. Keep options closed and retry without rewriting the
    // signed RECONCILING state; only arithmetic/cash violations above freeze.
    if (view.equityOrders.length !== 0
      || held.size !== 4
      || G4_EQUITY_SYMBOLS.some((symbol) => !held.has(symbol))) {
      return publicResult("G4_RECONCILIATION_DEFERRED", state, protocol, {
        reason: "BROKER_SETTLEMENT_PENDING",
      });
    }
    try { assertReadyEquityQuantities(view, state); }
    catch {
      return publicResult("G4_RECONCILIATION_DEFERRED", state, protocol, {
        reason: "BROKER_QUANTITY_SETTLEMENT_PENDING",
      });
    }
    state = nextState(state, observedAt, { phase: "READY" });
    await saveState(store, signingSecret, protocol, state, state.revision - 1);
    return publicResult(READY_STATUS, state, protocol);
  }

  const leg = state.legs[nextLegIndex];
  let existing = await client.getOrderByClientOrderId(leg.order.client_order_id);
  if (existing === null || existing === undefined) {
    const pending = clone(state);
    pending.legs[nextLegIndex].status = "MUTATION_PENDING";
    pending.legs[nextLegIndex].attempts += 1;
    state = nextState(pending, observedAt, { phase: "ORDER_PENDING", mutation_started: true });
    await saveState(store, signingSecret, protocol, state, state.revision - 1);
    await stateCheckpoint({
      kind: "g4_equity_order",
      protocolHash: protocol.protocol_hash,
      sequence: nextLegIndex,
      clientOrderIdSha256: sha256(leg.order.client_order_id),
    });
    try { await mutationClient.placeStockOrder(clone(leg.order)); }
    catch {
      existing = await client.getOrderByClientOrderId(leg.order.client_order_id);
      if (existing === null || existing === undefined) {
        return publicResult("G4_ORDER_AMBIGUOUS", state, protocol, { sequence: nextLegIndex });
      }
    }
    if (existing === null || existing === undefined) existing = await client.getOrderByClientOrderId(leg.order.client_order_id);
    if (existing === null || existing === undefined) {
      return publicResult("G4_ORDER_AMBIGUOUS", state, protocol, { sequence: nextLegIndex });
    }
  }

  let result;
  try { result = brokerOrderResult(existing, leg.order); }
  catch (error) {
    state = frozenState(state, observedAt, nextLegIndex);
    await saveState(store, signingSecret, protocol, state, state.revision - 1);
    return publicResult("G4_EQUITY_FROZEN", state, protocol, { reason: error.message });
  }
  if (result.kind === "FAILED") {
    state = frozenState(state, observedAt, nextLegIndex);
    await saveState(store, signingSecret, protocol, state, state.revision - 1);
    return publicResult("G4_EQUITY_FROZEN", state, protocol, { reason: result.reason });
  }
  const updated = clone(state);
  updated.legs[nextLegIndex].broker_order_id_sha256 = sha256(String(existing.id));
  if (result.kind === "PENDING") {
    updated.legs[nextLegIndex].status = "BROKER_PENDING";
    state = nextState(updated, observedAt, { phase: "ORDER_PENDING" });
    await saveState(store, signingSecret, protocol, state, state.revision - 1);
    return publicResult("G4_ORDER_PENDING", state, protocol, { sequence: nextLegIndex });
  }
  updated.legs[nextLegIndex].status = "FILLED";
  updated.legs[nextLegIndex].filled_qty = result.filledQty;
  updated.legs[nextLegIndex].filled_avg_price = result.filledAvgPrice;
  updated.legs[nextLegIndex].filled_notional = result.filledNotional;
  const allFilled = updated.legs.every((item) => item.status === "FILLED");
  state = nextState(updated, observedAt, { phase: allFilled ? "RECONCILING" : "PLANNED" });
  await saveState(store, signingSecret, protocol, state, state.revision - 1);
  return publicResult(allFilled ? "G4_RECONCILING" : "G4_LEG_FILLED", state, protocol, { sequence: nextLegIndex });
}
