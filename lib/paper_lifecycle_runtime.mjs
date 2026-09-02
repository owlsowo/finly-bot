import { lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertPinnedMcpExitArguments } from "./alpaca.mjs";
import { sha256, stableStringify } from "./canonical.mjs";
import { createExitProjection, PaperOrderLifecycle } from "./order_lifecycle.mjs";
import { POLICY } from "./policy.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

const CHECKPOINT_ID = /^sha256:[a-f0-9]{64}$/;
const BROKER_ORDER_ID = /^[A-Za-z0-9-]{8,80}$/;
const ENTRY_CLIENT_ORDER_ID = /^finly-[a-f0-9]{20}$/;
const EXIT_CLIENT_ORDER_ID = /^finly-exit-[a-f0-9]{20}$/;
const REQUEST_ID = /^finly-exit-[A-Za-z0-9_-]{8,64}$/;
const KNOWN_ORDER_STATUSES = new Set([
  "accepted",
  "accepted_for_bidding",
  "calculated",
  "canceled",
  "done_for_day",
  "expired",
  "filled",
  "held",
  "new",
  "partially_filled",
  "pending_cancel",
  "pending_new",
  "pending_replace",
  "rejected",
  "replaced",
  "stopped",
  "suspended",
]);

/**
 * Capability declaration required from a closing-order transport.
 *
 * The signed-price convention comes from alpaca-mcp-server==2.2.1's pinned
 * place_option_order schema: a multi-leg net debit is positive and a net
 * credit is negative. Finly's pinned bridge now validates this exact closing
 * shape; callers still declare the capability explicitly so a different or
 * stale transport cannot silently inherit exit authority.
 */
export const ALPACA_MCP_CLOSING_CREDIT_CAPABILITY = Object.freeze({
  schema_version: "finly_alpaca_mcp_closing_credit_capability.v1",
  paper_host: POLICY.paperHost,
  server: "alpaca-mcp-server",
  version: POLICY.alpacaMcpVersion,
  tool: "place_option_order",
  tool_schema_sha256: POLICY.placeOptionOrderSchemaSha256,
  order_class: "mleg",
  price_convention: "negative_is_net_credit",
  idempotency_key: "client_order_id",
});

function clone(value) {
  return structuredClone(value);
}

function allowedOptionKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains an unknown field`);
  }
}

function assertCheckpointSecret(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) < 32) {
    throw new Error("checkpoint signing secret must be at least 32 bytes");
  }
}

function parseCheckpoint(serialized, expectedLifecycleId) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("lifecycle checkpoint storage contains invalid JSON");
  }
  if (parsed?.state?.lifecycle_id !== expectedLifecycleId
    || !Number.isInteger(parsed?.state?.revision)
    || parsed.state.revision < 0) {
    throw new Error("lifecycle checkpoint storage contains invalid state metadata");
  }
  return parsed;
}

function checkpointPath(directory, lifecycleId) {
  if (!CHECKPOINT_ID.test(lifecycleId)) throw new Error("invalid lifecycle checkpoint ID");
  return join(directory, `${lifecycleId.slice("sha256:".length)}.json`);
}

/** Atomic, owner-only storage for lifecycle-authenticated checkpoints. */
export class FileLifecycleCheckpointStore {
  constructor(directory) {
    if (typeof directory !== "string" || directory.length < 2) throw new Error("lifecycle checkpoint directory is required");
    this.directory = resolve(directory);
  }

  pathFor(lifecycleId) {
    return checkpointPath(this.directory, lifecycleId);
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      throw new Error("lifecycle checkpoint directory is not a private real directory");
    }
  }

  async load(lifecycleId) {
    await this.initialize();
    try {
      return await readFile(this.pathFor(lifecycleId), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new Error("lifecycle checkpoint could not be read");
    }
  }

  async save(lifecycleId, serialized, { expectedPreviousRevision }) {
    if (typeof serialized !== "string" || Buffer.byteLength(serialized) > 1_000_000) {
      throw new Error("lifecycle checkpoint is absent or exceeds its size bound");
    }
    const incoming = parseCheckpoint(serialized, lifecycleId);
    await this.initialize();
    const path = this.pathFor(lifecycleId);
    const lock = `${path}.lock`;
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("lifecycle checkpoint is locked; fail closed");
      throw new Error("lifecycle checkpoint lock could not be acquired");
    }

    let temporary = null;
    try {
      let existing = null;
      try {
        existing = await readFile(path, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw new Error("lifecycle checkpoint could not be read under lock");
      }
      if (existing === serialized) return { written: false, revision: incoming.state.revision };

      if (existing === null) {
        if (expectedPreviousRevision !== null || incoming.state.revision !== 0) {
          throw new Error("lifecycle checkpoint creation revision is inconsistent");
        }
      } else {
        const current = parseCheckpoint(existing, lifecycleId);
        if (!Number.isInteger(expectedPreviousRevision)
          || current.state.revision !== expectedPreviousRevision
          || incoming.state.revision !== expectedPreviousRevision + 1) {
          throw new Error("lifecycle checkpoint compare-and-swap conflict");
        }
      }

      temporary = `${path}.${process.pid}.${sha256(serialized).slice(-12)}.tmp`;
      await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
      temporary = null;
      return { written: true, revision: incoming.state.revision };
    } finally {
      if (temporary !== null) await unlink(temporary).catch(() => {});
      await rmdir(lock).catch(() => {});
    }
  }
}

function fixedPositivePrice(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number >= 100_000) throw new Error(`${label} is invalid`);
  return number.toFixed(2);
}

function assertOptionSymbol(value) {
  let parsed;
  try {
    parsed = parseOccOptionSymbol(value);
  } catch {
    throw new Error("closing projection contains an invalid option symbol");
  }
  if (!POLICY.underlyings.includes(parsed.underlying)) throw new Error("closing projection is outside the underlying allowlist");
}

function assertClosingProjection(projection) {
  const keys = ["client_order_id", "legs", "limit_price", "order_class", "qty", "time_in_force", "type"];
  if (!projection || typeof projection !== "object" || Array.isArray(projection)
    || stableStringify(Object.keys(projection).sort()) !== stableStringify(keys.sort())) {
    throw new Error("closing projection contains missing or unknown fields");
  }
  if (!EXIT_CLIENT_ORDER_ID.test(projection.client_order_id)) throw new Error("closing projection has an invalid idempotency key");
  if (projection.order_class !== "mleg" || projection.type !== "limit" || projection.time_in_force !== "day") {
    throw new Error("closing projection violates the multi-leg limit-order policy");
  }
  if (!/^\d+$/.test(projection.qty) || Number(projection.qty) < 1 || Number(projection.qty) > POLICY.maxContracts) {
    throw new Error("closing projection quantity is outside policy");
  }
  const magnitude = fixedPositivePrice(projection.limit_price, "closing credit magnitude");
  if (projection.limit_price !== magnitude) throw new Error("closing credit magnitude must use two decimal places");
  if (!Array.isArray(projection.legs) || projection.legs.length !== 2) throw new Error("closing projection must contain exactly two legs");
  const intents = [];
  for (const leg of projection.legs) {
    const legKeys = ["position_intent", "ratio_qty", "side", "symbol"];
    if (!leg || typeof leg !== "object" || Array.isArray(leg)
      || stableStringify(Object.keys(leg).sort()) !== stableStringify(legKeys.sort())) {
      throw new Error("closing projection leg contains missing or unknown fields");
    }
    assertOptionSymbol(leg.symbol);
    if (leg.ratio_qty !== "1") throw new Error("closing projection leg ratio is outside policy");
    if (leg.position_intent === "sell_to_close" && leg.side !== "sell") throw new Error("closing projection sell leg is inconsistent");
    if (leg.position_intent === "buy_to_close" && leg.side !== "buy") throw new Error("closing projection buy leg is inconsistent");
    if (!new Set(["sell_to_close", "buy_to_close"]).has(leg.position_intent)) throw new Error("closing projection contains a non-closing intent");
    intents.push(leg.position_intent);
  }
  if (stableStringify([...intents].sort()) !== stableStringify(["buy_to_close", "sell_to_close"])) {
    throw new Error("closing projection must close one long and one short leg");
  }
  return true;
}

/** Convert lifecycle-domain positive credit magnitude to Alpaca's signed net price. */
export function toAlpacaClosingCreditProjection(projection) {
  assertClosingProjection(projection);
  const signed = { ...clone(projection), limit_price: `-${projection.limit_price}` };
  assertPinnedMcpExitArguments(signed);
  return signed;
}

function assertExactCapability(value) {
  if (stableStringify(value) !== stableStringify(ALPACA_MCP_CLOSING_CREDIT_CAPABILITY)) {
    throw new Error("closing-order transport has not declared Alpaca's pinned signed-credit capability");
  }
}

function integerQuantity(value, maximum, label) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^\d+(?:\.0+)?$/.test(text)) throw new Error(`${label} is invalid`);
  const number = Number(text);
  if (!Number.isInteger(number) || number < 0 || number > maximum) throw new Error(`${label} is invalid`);
  return String(number);
}

function brokerFillTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error();
  return parsed.toISOString();
}

/**
 * Allowlist and validate an Alpaca nested order before it reaches the state
 * machine. Unknown broker fields (including any accidental secrets) are never
 * retained in checkpoints or surfaced in exceptions.
 */
function normalizeBrokerOrder(raw, { brokerProjection, lifecycleProjection, label }) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    if (!BROKER_ORDER_ID.test(raw.id)) throw new Error();
    if (raw.client_order_id !== brokerProjection.client_order_id) throw new Error();
    if (raw.order_class !== brokerProjection.order_class || raw.type !== brokerProjection.type || raw.time_in_force !== brokerProjection.time_in_force) throw new Error();
    if (integerQuantity(raw.qty, POLICY.maxContracts, label) !== brokerProjection.qty) throw new Error();
    if (Number(raw.limit_price).toFixed(2) !== brokerProjection.limit_price) throw new Error();
    if (!KNOWN_ORDER_STATUSES.has(raw.status)) throw new Error();
    if (!Array.isArray(raw.legs) || raw.legs.length !== brokerProjection.legs.length) throw new Error();
    const filledQty = integerQuantity(raw.filled_qty ?? 0, Number(brokerProjection.qty), `${label} fill`);
    const legs = brokerProjection.legs.map((expected, index) => {
      const observed = raw.legs[index];
      if (!observed || observed.symbol !== expected.symbol
        || String(observed.ratio_qty ?? observed.qty) !== expected.ratio_qty
        || observed.side !== expected.side
        || observed.position_intent !== expected.position_intent) throw new Error();
      return {
        ...clone(lifecycleProjection.legs[index]),
        filled_qty: integerQuantity(observed.filled_qty ?? 0, Number(brokerProjection.qty), `${label} leg fill`),
      };
    });
    return {
      ...clone(lifecycleProjection),
      id: raw.id,
      status: raw.status,
      filled_qty: filledQty,
      filled_at: brokerFillTimestamp(raw.filled_at),
      legs,
    };
  } catch {
    throw new Error(`${label} failed strict structural reconciliation`);
  }
}

function normalizeEntryOrder(raw, projection) {
  if (!ENTRY_CLIENT_ORDER_ID.test(projection.client_order_id)) throw new Error("entry projection has an invalid client order ID");
  return normalizeBrokerOrder(raw, {
    brokerProjection: projection,
    lifecycleProjection: projection,
    label: "entry readback",
  });
}

function normalizeExitOrder(raw, lifecycleProjection) {
  const brokerProjection = toAlpacaClosingCreditProjection(lifecycleProjection);
  return normalizeBrokerOrder(raw, {
    brokerProjection,
    lifecycleProjection,
    label: "exit readback",
  });
}

function safeLookupFailure(label) {
  return new Error(`${label} is unavailable; lifecycle remains fail-closed`);
}

const OPEN_KEYS = new Set([
  "certificate",
  "entryProjection",
  "checkpointSigningSecret",
  "checkpointStore",
  "lookupNestedOrderByClientOrderId",
  "mutationsEnabled",
  "beforeClosingMutation",
  "placeClosingOptionOrder",
  "cancelOptionOrder",
  "closingCapability",
  "runId",
  "now",
]);

/**
 * Durable orchestration around PaperOrderLifecycle.
 *
 * No credentials are accepted. Network access is dependency-injected, and all
 * external errors/readbacks are reduced to fixed, allowlisted shapes before
 * they can enter an authenticated checkpoint.
 */
export class AlpacaPaperLifecycleRuntime {
  constructor({ lifecycle, checkpointSigningSecret, checkpointStore, lookupNestedOrderByClientOrderId, runId }) {
    this.lifecycle = lifecycle;
    this.checkpointSigningSecret = checkpointSigningSecret;
    this.checkpointStore = checkpointStore;
    this.lookupNestedOrderByClientOrderId = lookupNestedOrderByClientOrderId;
    this.runId = runId;
    this.usable = true;
  }

  static async open(options) {
    allowedOptionKeys(options, OPEN_KEYS, "paper lifecycle runtime options");
    const {
      certificate,
      entryProjection,
      checkpointSigningSecret,
      checkpointStore,
      lookupNestedOrderByClientOrderId,
      mutationsEnabled = false,
      beforeClosingMutation,
      placeClosingOptionOrder,
      cancelOptionOrder,
      closingCapability,
      runId = certificate?.run_id,
      now = () => new Date(),
    } = options;
    assertCheckpointSecret(checkpointSigningSecret);
    if (!checkpointStore || typeof checkpointStore.load !== "function" || typeof checkpointStore.save !== "function") {
      throw new Error("durable lifecycle checkpoint store is unavailable");
    }
    if (typeof lookupNestedOrderByClientOrderId !== "function") throw new Error("nested Alpaca order readback is unavailable");
    if (typeof runId !== "string" || runId.length < 4 || runId.length > 200) throw new Error("lifecycle run ID is invalid");
    if (mutationsEnabled === true) {
      assertExactCapability(closingCapability);
      if (typeof placeClosingOptionOrder !== "function") throw new Error("closing-order mutation adapter is unavailable");
      if (beforeClosingMutation !== undefined && typeof beforeClosingMutation !== "function") {
        throw new Error("closing pre-mutation checkpoint must be callable");
      }
    }

    const closingAdapter = async ({ projection }) => {
      const brokerProjection = toAlpacaClosingCreditProjection(projection);
      let existing;
      try {
        existing = await lookupNestedOrderByClientOrderId(brokerProjection.client_order_id);
      } catch {
        throw safeLookupFailure("pre-mutation exit idempotency readback");
      }
      if (existing !== null && existing !== undefined) return normalizeExitOrder(existing, projection);

      if (beforeClosingMutation) await beforeClosingMutation({
        kind: "exit",
        clientOrderId: brokerProjection.client_order_id,
      });

      try {
        await placeClosingOptionOrder(clone(brokerProjection));
      } catch {
        // A timeout is ambiguous. Reconcile by the exact deterministic client
        // order ID before deciding whether the mutation succeeded.
      }
      let reconciled;
      try {
        reconciled = await lookupNestedOrderByClientOrderId(brokerProjection.client_order_id);
      } catch {
        throw safeLookupFailure("post-mutation exit readback");
      }
      if (reconciled === null || reconciled === undefined) throw safeLookupFailure("post-mutation exit readback");
      return normalizeExitOrder(reconciled, projection);
    };

    const cancelExitAdapter = async ({ order_id: orderId, projection }) => {
      let before;
      try {
        before = await lookupNestedOrderByClientOrderId(projection.client_order_id);
      } catch {
        throw safeLookupFailure("pre-cancel exit readback");
      }
      if (before === null || before === undefined) throw safeLookupFailure("pre-cancel exit readback");
      const normalizedBefore = normalizeExitOrder(before, projection);
      if (new Set(["filled", "partially_filled", "canceled", "expired", "rejected", "done_for_day"]).has(normalizedBefore.status)) {
        return normalizedBefore;
      }
      if (typeof cancelOptionOrder !== "function") throw new Error("closing-order cancel adapter is unavailable");
      if (beforeClosingMutation) await beforeClosingMutation({
        kind: "exit_cancel",
        clientOrderId: projection.client_order_id,
      });
      try {
        await cancelOptionOrder(orderId);
      } catch {
        // DELETE acknowledgements can be lost or race a fill. Exact readback
        // below is authoritative and prevents a duplicate replacement.
      }
      let after;
      try {
        after = await lookupNestedOrderByClientOrderId(projection.client_order_id);
      } catch {
        throw safeLookupFailure("post-cancel exit readback");
      }
      if (after === null || after === undefined) throw safeLookupFailure("post-cancel exit readback");
      return normalizeExitOrder(after, projection);
    };

    const fresh = new PaperOrderLifecycle({
      certificate,
      entryProjection,
      enabled: mutationsEnabled === true,
      submitExitOrder: closingAdapter,
      cancelExitOrder: cancelExitAdapter,
      now,
    });
    const lifecycleId = fresh.snapshot().lifecycle_id;
    const serialized = await checkpointStore.load(lifecycleId);
    const lifecycle = serialized === null
      ? fresh
      : PaperOrderLifecycle.restore(serialized, {
        certificate,
        entryProjection,
        checkpointSigningSecret,
        enabled: mutationsEnabled === true,
        submitExitOrder: closingAdapter,
        cancelExitOrder: cancelExitAdapter,
        now,
      });
    if (serialized === null) {
      await checkpointStore.save(lifecycleId, lifecycle.checkpoint(checkpointSigningSecret), { expectedPreviousRevision: null });
    }
    return new AlpacaPaperLifecycleRuntime({
      lifecycle,
      checkpointSigningSecret,
      checkpointStore,
      lookupNestedOrderByClientOrderId,
      runId,
    });
  }

  snapshot() {
    return this.lifecycle.snapshot();
  }

  #assertUsable() {
    if (!this.usable) throw new Error("paper lifecycle runtime is frozen after a checkpoint persistence failure");
  }

  async #advance(action) {
    this.#assertUsable();
    const beforeRevision = this.lifecycle.snapshot().revision;
    let result;
    let actionError;
    try {
      result = await action();
    } catch (error) {
      actionError = error;
    }
    const afterRevision = this.lifecycle.snapshot().revision;
    if (afterRevision !== beforeRevision) {
      try {
        await this.checkpointStore.save(
          this.lifecycle.snapshot().lifecycle_id,
          this.lifecycle.checkpoint(this.checkpointSigningSecret),
          { expectedPreviousRevision: beforeRevision },
        );
      } catch {
        this.usable = false;
        throw new Error("lifecycle checkpoint persistence failed; runtime frozen");
      }
    }
    if (actionError) throw actionError;
    return result;
  }

  async reconcileEntry(order) {
    this.#assertUsable();
    const projection = this.lifecycle.snapshot().active_entry_projection;
    let readback = order;
    if (readback === undefined) {
      try {
        readback = await this.lookupNestedOrderByClientOrderId(projection.client_order_id);
      } catch {
        throw safeLookupFailure("entry readback");
      }
    }
    if (readback === null) throw safeLookupFailure("entry readback");
    const normalized = normalizeEntryOrder(readback, projection);
    return this.#advance(() => this.lifecycle.observeEntry(normalized));
  }

  async requireExit(trigger) {
    return this.#advance(() => this.lifecycle.requireExit(trigger));
  }

  async submitCreditExit({ requestId, creditLimit }) {
    if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) throw new Error("invalid exit request ID");
    const projection = createExitProjection(this.lifecycle.snapshot().active_entry_projection, {
      runId: sha256({ run_id: this.runId, request_id: requestId }),
      limitPrice: creditLimit,
    });
    return this.#advance(() => this.lifecycle.submitExit({ requestId, projection }));
  }

  async reconcileExit(order) {
    this.#assertUsable();
    const projection = this.lifecycle.snapshot().exit_projection;
    if (!projection) throw new Error("no submitted exit is available for reconciliation");
    let readback = order;
    if (readback === undefined) {
      try {
        readback = await this.lookupNestedOrderByClientOrderId(projection.client_order_id);
      } catch {
        throw safeLookupFailure("exit readback");
      }
    }
    if (readback === null) throw safeLookupFailure("exit readback");
    const normalized = normalizeExitOrder(readback, projection);
    return this.#advance(() => this.lifecycle.observeExit(normalized));
  }

  async cancelWorkingExit({ requestId }) {
    if (typeof requestId !== "string" || !/^finly-exitcancel-[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
      throw new Error("invalid exit cancel request ID");
    }
    return this.#advance(() => this.lifecycle.cancelExit({ requestId }));
  }

  exitSubmissionCount() {
    return this.lifecycle.snapshot().history.filter((event) => event.event === "EXIT_ACCEPTED" || event.event === "EXIT_FILLED").length;
  }
}
