import { createHmac, timingSafeEqual } from "node:crypto";
import { sha256, stableStringify } from "./canonical.mjs";
import { assertPinnedMcpArguments } from "./alpaca.mjs";
import { POLICY } from "./policy.mjs";

const SCHEMA_VERSION = "paper_order_lifecycle.v1";
const CHECKPOINT_VERSION = "paper_order_lifecycle_checkpoint.v1";
const PHASES = new Set([
  "CREATED",
  "ENTRY_ACCEPTED",
  "ENTRY_CANCEL_PENDING",
  "ENTRY_REPLACE_PENDING",
  "POSITION_OPEN",
  "EXIT_REQUIRED",
  "EXIT_ACCEPTED",
  "ENTRY_PARTIAL_FROZEN",
  "EXIT_PARTIAL_FROZEN",
  "ERROR_FROZEN",
  "CLOSED",
]);
const WORKING_STATUSES = new Set(["accepted", "pending_new", "accepted_for_bidding", "new", "held", "stopped"]);
const KNOWN_STATUSES = new Set([
  ...WORKING_STATUSES,
  "partially_filled",
  "filled",
  "done_for_day",
  "canceled",
  "expired",
  "replaced",
  "pending_cancel",
  "pending_replace",
  "rejected",
  "suspended",
  "calculated",
]);
const EXIT_TRIGGERS = new Set(["profit_target", "risk_limit", "time_stop", "expiry_guard", "manual_paper", "strategy_invalidation", "competition_end_guard"]);
const STATE_KEYS = [
  "schema_version",
  "lifecycle_id",
  "certificate_id",
  "authorization_scope",
  "certified_entry_projection",
  "active_entry_projection",
  "max_entry_debit",
  "phase",
  "revision",
  "created_at",
  "updated_at",
  "active_entry",
  "entry_fill_qty",
  "exit_required",
  "exit_trigger",
  "exit_projection",
  "active_exit",
  "cancel_operation",
  "replace_operation",
  "exit_operation",
  "freeze_reason",
  "last_error",
  "closed_reason",
  "last_observation_sha256",
  "history",
];

function clone(value) {
  return structuredClone(value);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || !actual.every((key, index) => key === wanted[index])) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function isoNow(now) {
  const value = now();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("lifecycle clock returned an invalid time");
  return parsed.toISOString();
}

function positiveInteger(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) throw new Error(`${label} must be a nonnegative integer quantity`);
  return number;
}

function fixedPrice(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive finite price`);
  return number.toFixed(2);
}

function assertCheckpointSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new Error("checkpoint signing secret must be at least 32 bytes");
  }
}

function checkpointSignature(body, secret) {
  assertCheckpointSecret(secret);
  return `hmac-sha256:${createHmac("sha256", secret).update(stableStringify(body)).digest("hex")}`;
}

function assertRequestId(requestId, operation) {
  if (typeof requestId !== "string" || !new RegExp(`^finly-${operation}-[A-Za-z0-9_-]{8,64}$`).test(requestId)) {
    throw new Error(`invalid ${operation} request ID`);
  }
}

function brokerStatus(order) {
  const status = order?.status;
  if (!KNOWN_STATUSES.has(status)) throw new Error(`unknown broker order status: ${String(status)}`);
  return status;
}

function projectionCore(order) {
  return {
    client_order_id: order?.client_order_id,
    order_class: order?.order_class,
    qty: String(order?.qty),
    type: order?.type,
    time_in_force: order?.time_in_force,
    limit_price: fixedPrice(order?.limit_price, "order limit price"),
    legs: Array.isArray(order?.legs) ? order.legs.map((leg) => ({
      symbol: leg.symbol,
      ratio_qty: String(leg.ratio_qty ?? leg.qty),
      side: leg.side,
      position_intent: leg.position_intent,
    })) : [],
  };
}

function assertOrderMatchesProjection(order, projection, label) {
  if (typeof order?.id !== "string" || order.id.length < 8) throw new Error(`${label} is missing a broker order ID`);
  if (stableStringify(projectionCore(order)) !== stableStringify(projection)) {
    throw new Error(`${label} differs from the expected projection`);
  }
}

function fillAssessment(order, projection, label) {
  const quantity = positiveInteger(projection.qty, `${label} quantity`);
  const parentFill = positiveInteger(order?.filled_qty ?? 0, `${label} parent fill`, { allowZero: true });
  if (parentFill > quantity) throw new Error(`${label} parent fill exceeds ordered quantity`);
  if (!Array.isArray(order?.legs) || order.legs.length !== 2) throw new Error(`${label} must contain exactly two nested legs`);
  const fills = projection.legs.map((expectedLeg) => {
    const matches = order.legs.filter((leg) => leg.symbol === expectedLeg.symbol);
    if (matches.length !== 1) throw new Error(`${label} contains missing or duplicate nested legs`);
    return positiveInteger(matches[0].filled_qty ?? 0, `${label} leg fill`, { allowZero: true });
  });
  if (fills[0] !== fills[1] || fills[0] !== parentFill) throw new Error(`${label} leg fills do not match the parent spread fill`);
  return { quantity, filled: parentFill };
}

function assertCertifiedEntry(certificate, entryProjection) {
  if (certificate?.authorization_scope !== "paper_submit" || certificate.certified !== true || certificate.decision === "NO_TRADE") {
    throw new Error("lifecycle requires an already-certified paper-submit order");
  }
  if (certificate.mode !== "paper" || certificate.data_mode !== "alpaca_paper_live" || certificate.checks?.paper_endpoint_locked !== true) {
    throw new Error("lifecycle is locked to Alpaca paper mode");
  }
  assertPinnedMcpArguments(entryProjection);
  if (certificate.desired_order_projection_sha256 !== sha256(entryProjection)) {
    throw new Error("certified entry projection hash mismatch");
  }
  if (!Number.isFinite(certificate.max_entry_debit) || certificate.max_entry_debit <= 0) {
    throw new Error("certificate has no valid entry debit collar");
  }
}

function assertReplacementProjection(certified, proposed, maxEntryDebit) {
  assertPinnedMcpArguments(proposed);
  const certifiedWithoutPrice = { ...certified, limit_price: proposed.limit_price };
  if (stableStringify(certifiedWithoutPrice) !== stableStringify(proposed)) {
    throw new Error("replacement may change only the certified entry limit price");
  }
  if (Number(proposed.limit_price) > maxEntryDebit) throw new Error("replacement limit exceeds the certified debit collar");
}

function assertExitProjection(entry, exit) {
  const expectedKeys = ["client_order_id", "legs", "limit_price", "order_class", "qty", "time_in_force", "type"];
  exactKeys(exit, expectedKeys, "exit projection");
  if (!/^finly-exit-[a-f0-9]{20}$/.test(exit.client_order_id)) throw new Error("exit client order ID is invalid");
  if (exit.order_class !== "mleg" || exit.type !== "limit" || exit.time_in_force !== "day") throw new Error("exit parent fields violate policy");
  if (positiveInteger(exit.qty, "exit quantity") !== positiveInteger(entry.qty, "entry quantity")) throw new Error("exit quantity differs from the open spread quantity");
  fixedPrice(exit.limit_price, "exit limit price");
  if (!Array.isArray(exit.legs) || exit.legs.length !== 2) throw new Error("exit must have exactly two legs");
  const expectedLegs = entry.legs.map((leg) => ({
    symbol: leg.symbol,
    ratio_qty: "1",
    side: leg.side === "buy" ? "sell" : "buy",
    position_intent: leg.side === "buy" ? "sell_to_close" : "buy_to_close",
  }));
  if (stableStringify(exit.legs) !== stableStringify(expectedLegs)) throw new Error("exit legs do not exactly close the certified spread");
}

function operationRecord(requestId, requestHash, order) {
  return {
    request_id: requestId,
    request_sha256: requestHash,
    broker_order_id: order?.id ?? null,
    broker_status: order?.status ?? null,
  };
}

function canonicalFillTimestamp(value, label) {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} fill timestamp is invalid`);
  return parsed.toISOString();
}

function validateRestoredState(state, certificate, expectedEntry) {
  exactKeys(state, STATE_KEYS, "lifecycle state");
  if (state.schema_version !== SCHEMA_VERSION) throw new Error("unsupported lifecycle state version");
  if (!PHASES.has(state.phase)) throw new Error("lifecycle state has an unknown phase");
  if (state.certificate_id !== certificate.certificate_id || state.authorization_scope !== "paper_submit") throw new Error("lifecycle state is bound to a different certificate");
  if (state.max_entry_debit !== certificate.max_entry_debit) throw new Error("lifecycle entry debit collar changed");
  if (stableStringify(state.certified_entry_projection) !== stableStringify(expectedEntry)) throw new Error("lifecycle certified entry projection changed");
  if (sha256(state.certified_entry_projection) !== certificate.desired_order_projection_sha256) throw new Error("lifecycle certified projection hash is invalid");
  assertReplacementProjection(state.certified_entry_projection, state.active_entry_projection, state.max_entry_debit);
  const expectedLifecycleId = sha256({ certificate_id: certificate.certificate_id, entry_sha256: certificate.desired_order_projection_sha256 });
  if (state.lifecycle_id !== expectedLifecycleId) throw new Error("lifecycle ID is invalid");
  if (!Number.isInteger(state.revision) || state.revision < 0) throw new Error("lifecycle revision is invalid");
  if (!Array.isArray(state.history) || state.history.length !== state.revision + 1) throw new Error("lifecycle history is incomplete");
  state.history.forEach((event, index) => {
    exactKeys(event, ["revision", "at", "event", "from", "to", "detail_sha256"], "lifecycle history event");
    if (event.revision !== index || !PHASES.has(event.to) || (event.from !== null && !PHASES.has(event.from))) throw new Error("lifecycle history transition is invalid");
    if (Number.isNaN(new Date(event.at).getTime()) || !/^sha256:[a-f0-9]{64}$/.test(event.detail_sha256)) throw new Error("lifecycle history event is invalid");
    if (index > 0 && event.from !== state.history[index - 1].to) throw new Error("lifecycle history chain is broken");
  });
  if (state.history.at(-1).to !== state.phase) throw new Error("lifecycle history does not end at the current phase");
  if (Number.isNaN(new Date(state.created_at).getTime()) || Number.isNaN(new Date(state.updated_at).getTime())) throw new Error("lifecycle timestamps are invalid");
  if (state.active_entry?.filled_at !== undefined && state.active_entry.filled_at !== null) {
    const filledAt = new Date(state.active_entry.filled_at);
    if (Number.isNaN(filledAt.getTime()) || filledAt.toISOString() !== state.active_entry.filled_at) {
      throw new Error("lifecycle entry fill timestamp is invalid");
    }
  }
  if (state.exit_projection !== null) assertExitProjection(state.active_entry_projection, state.exit_projection);
  if (state.phase === "CLOSED" && typeof state.closed_reason !== "string") throw new Error("closed lifecycle has no terminal reason");
  if (state.phase.endsWith("FROZEN") && typeof state.freeze_reason !== "string") throw new Error("frozen lifecycle has no reason");
}

export class PaperOrderLifecycle {
  constructor({
    certificate,
    entryProjection,
    enabled = false,
    cancelOrder,
    replaceOrder,
    submitExitOrder,
    cancelExitOrder,
    now = () => new Date(),
    restoredState,
  }) {
    assertCertifiedEntry(certificate, entryProjection);
    this.certificate = clone(certificate);
    this.enabled = enabled === true;
    this.cancelOrder = cancelOrder;
    this.replaceOrder = replaceOrder;
    this.submitExitOrder = submitExitOrder;
    this.cancelExitOrder = cancelExitOrder;
    this.now = now;
    if (restoredState) {
      validateRestoredState(restoredState, certificate, entryProjection);
      this.state = clone(restoredState);
      return;
    }
    const at = isoNow(this.now);
    const lifecycleId = sha256({ certificate_id: certificate.certificate_id, entry_sha256: certificate.desired_order_projection_sha256 });
    this.state = {
      schema_version: SCHEMA_VERSION,
      lifecycle_id: lifecycleId,
      certificate_id: certificate.certificate_id,
      authorization_scope: "paper_submit",
      certified_entry_projection: clone(entryProjection),
      active_entry_projection: clone(entryProjection),
      max_entry_debit: certificate.max_entry_debit,
      phase: "CREATED",
      revision: 0,
      created_at: at,
      updated_at: at,
      active_entry: null,
      entry_fill_qty: 0,
      exit_required: false,
      exit_trigger: null,
      exit_projection: null,
      active_exit: null,
      cancel_operation: null,
      replace_operation: null,
      exit_operation: null,
      freeze_reason: null,
      last_error: null,
      closed_reason: null,
      last_observation_sha256: null,
      history: [{ revision: 0, at, event: "INITIALIZED", from: null, to: "CREATED", detail_sha256: sha256({}) }],
    };
  }

  snapshot() {
    return clone(this.state);
  }

  #transition(event, to, detail = {}, patch = {}) {
    if (!PHASES.has(to)) throw new Error("invalid lifecycle transition target");
    const from = this.state.phase;
    const at = isoNow(this.now);
    const revision = this.state.revision + 1;
    this.state = {
      ...this.state,
      ...patch,
      phase: to,
      revision,
      updated_at: at,
      history: [...this.state.history, { revision, at, event, from, to, detail_sha256: sha256(detail) }],
    };
    return this.snapshot();
  }

  #freeze(reason, error, { phase = "ERROR_FROZEN", exitRequired = this.state.exit_required } = {}) {
    this.#transition("FROZEN", phase, { reason, error }, {
      freeze_reason: reason,
      last_error: error,
      exit_required: exitRequired,
    });
    throw new Error(`paper order lifecycle frozen: ${error}`);
  }

  observeEntry(order) {
    const observationHash = sha256(order);
    if (observationHash === this.state.last_observation_sha256) return this.snapshot();
    if (this.state.phase === "CLOSED") throw new Error("closed lifecycle is terminal");
    if (this.state.phase === "ERROR_FROZEN") throw new Error("error-frozen lifecycle requires manual reconciliation");
    let status;
    try {
      status = brokerStatus(order);
      assertOrderMatchesProjection(order, this.state.active_entry_projection, "entry order");
      const fills = fillAssessment(order, this.state.active_entry_projection, "entry order");
      if (new Set(["POSITION_OPEN", "EXIT_REQUIRED", "EXIT_ACCEPTED", "EXIT_PARTIAL_FROZEN"]).has(this.state.phase)) {
        if (status === "filled" && fills.filled === fills.quantity && order.id === this.state.active_entry?.order_id) return this.snapshot();
        throw new Error("entry observation conflicts with an advanced position lifecycle");
      }
      if (this.state.phase === "ENTRY_PARTIAL_FROZEN" && status === "filled" && fills.filled === fills.quantity) {
        const filledAt = canonicalFillTimestamp(order.filled_at, "entry order");
        return this.#transition("ENTRY_FULLY_RECONCILED", "EXIT_REQUIRED", { order_id: order.id }, {
          active_entry: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: fills.filled, filled_at: filledAt },
          entry_fill_qty: fills.filled,
          exit_required: true,
          exit_trigger: "partial_fill",
          last_observation_sha256: observationHash,
        });
      }
      if (status === "partially_filled") {
        if (fills.filled <= 0 || fills.filled >= fills.quantity) throw new Error("partial entry status is inconsistent with fill quantities");
        this.#transition("ENTRY_PARTIAL", "ENTRY_PARTIAL_FROZEN", { status, filled: fills.filled }, {
          active_entry: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: fills.filled },
          entry_fill_qty: fills.filled,
          exit_required: true,
          exit_trigger: "partial_fill",
          freeze_reason: "PARTIAL_ENTRY_FILL",
          last_error: "partial multi-leg entry requires explicit reconciliation and exit",
          last_observation_sha256: observationHash,
        });
        throw new Error("paper order lifecycle frozen: partial multi-leg entry requires explicit reconciliation and exit");
      }
      if (status === "filled") {
        if (fills.filled !== fills.quantity) throw new Error("filled entry does not have complete matching leg fills");
        const filledAt = canonicalFillTimestamp(order.filled_at, "entry order");
        return this.#transition("ENTRY_FILLED", "POSITION_OPEN", { order_id: order.id }, {
          active_entry: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: fills.filled, filled_at: filledAt },
          entry_fill_qty: fills.filled,
          last_observation_sha256: observationHash,
        });
      }
      if (WORKING_STATUSES.has(status) || status === "pending_cancel" || status === "pending_replace") {
        if (fills.filled !== 0) throw new Error("working entry reports nonzero fills");
        const phase = status === "pending_cancel" ? "ENTRY_CANCEL_PENDING" : status === "pending_replace" ? "ENTRY_REPLACE_PENDING" : "ENTRY_ACCEPTED";
        return this.#transition("ENTRY_STATUS", phase, { order_id: order.id, status }, {
          active_entry: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: 0 },
          last_observation_sha256: observationHash,
        });
      }
      if (new Set(["canceled", "expired", "rejected", "done_for_day"]).has(status)) {
        if (fills.filled !== 0) throw new Error(`terminal ${status} entry reports a nonzero fill`);
        return this.#transition("ENTRY_TERMINAL", "CLOSED", { order_id: order.id, status }, {
          active_entry: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: 0 },
          closed_reason: `entry_${status}`,
          last_observation_sha256: observationHash,
        });
      }
      throw new Error(`entry status ${status} requires manual reconciliation`);
    } catch (error) {
      if (this.state.phase === "ENTRY_PARTIAL_FROZEN") throw error;
      return this.#freeze("ENTRY_RECONCILIATION_ERROR", error.message, { exitRequired: this.state.entry_fill_qty > 0 });
    }
  }

  requireExit(trigger) {
    if (!EXIT_TRIGGERS.has(trigger)) throw new Error("unknown exit-required trigger");
    if (this.state.phase === "EXIT_REQUIRED" && this.state.exit_trigger === trigger) return this.snapshot();
    if (this.state.phase !== "POSITION_OPEN") throw new Error("exit can be required only for a reconciled open position");
    return this.#transition("EXIT_REQUIRED", "EXIT_REQUIRED", { trigger }, { exit_required: true, exit_trigger: trigger });
  }

  async cancelEntry({ requestId }) {
    assertRequestId(requestId, "cancel");
    const requestHash = sha256({ requestId, order_id: this.state.active_entry?.order_id });
    if (this.state.cancel_operation) {
      if (this.state.cancel_operation.request_sha256 === requestHash) return this.snapshot();
      throw new Error("a different entry cancel request is already recorded");
    }
    if (!this.enabled) throw new Error("paper lifecycle mutations are disabled");
    if (this.state.phase !== "ENTRY_ACCEPTED" || !this.state.active_entry?.order_id) throw new Error("entry is not cancelable in its current phase");
    if (typeof this.cancelOrder !== "function") throw new Error("paper cancel adapter is unavailable");
    let response;
    try {
      response = await this.cancelOrder({ order_id: this.state.active_entry.order_id, request_id: requestId });
      if (!new Set(["pending_cancel", "canceled"]).has(response?.status)) throw new Error("cancel adapter returned an unrecognized status");
    } catch (error) {
      return this.#freeze("CANCEL_AMBIGUOUS", error.message);
    }
    const operation = operationRecord(requestId, requestHash, { id: this.state.active_entry.order_id, status: response.status });
    if (response.status === "canceled") {
      return this.#transition("ENTRY_CANCEL_CONFIRMED", "CLOSED", { requestId }, {
        cancel_operation: operation,
        closed_reason: "entry_canceled",
      });
    }
    return this.#transition("ENTRY_CANCEL_REQUESTED", "ENTRY_CANCEL_PENDING", { requestId }, { cancel_operation: operation });
  }

  async replaceEntry({ requestId, limitPrice }) {
    assertRequestId(requestId, "replace");
    const proposed = { ...this.state.active_entry_projection, limit_price: fixedPrice(limitPrice, "replacement limit") };
    const requestHash = sha256({ requestId, projection: proposed });
    if (this.state.replace_operation) {
      if (this.state.replace_operation.request_sha256 === requestHash) return this.snapshot();
      if (this.state.replace_operation.request_id === requestId) return this.#freeze("IDEMPOTENCY_CONFLICT", "idempotency conflict: replacement request ID was reused with different parameters");
      throw new Error("a different entry replacement request is already recorded");
    }
    assertReplacementProjection(this.state.certified_entry_projection, proposed, this.state.max_entry_debit);
    if (!this.enabled) throw new Error("paper lifecycle mutations are disabled");
    if (this.state.phase !== "ENTRY_ACCEPTED" || !this.state.active_entry?.order_id) throw new Error("entry is not replaceable in its current phase");
    if (typeof this.replaceOrder !== "function") throw new Error("paper replace adapter is unavailable");
    let response;
    try {
      response = await this.replaceOrder({ order_id: this.state.active_entry.order_id, request_id: requestId, projection: clone(proposed) });
      const status = brokerStatus(response);
      if (!WORKING_STATUSES.has(status)) throw new Error("replacement order is not in a working status");
      assertOrderMatchesProjection(response, proposed, "replacement order");
      const fills = fillAssessment(response, proposed, "replacement order");
      if (fills.filled !== 0) throw new Error("replacement order unexpectedly reports fills");
    } catch (error) {
      return this.#freeze("REPLACE_AMBIGUOUS", error.message);
    }
    const operation = operationRecord(requestId, requestHash, response);
    return this.#transition("ENTRY_REPLACED", "ENTRY_ACCEPTED", { requestId, order_id: response.id }, {
      active_entry_projection: proposed,
      active_entry: { order_id: response.id, client_order_id: response.client_order_id, status: response.status, filled_qty: 0 },
      replace_operation: operation,
      last_observation_sha256: sha256(response),
    });
  }

  async submitExit({ requestId, projection }) {
    assertRequestId(requestId, "exit");
    assertExitProjection(this.state.active_entry_projection, projection);
    const requestHash = sha256({ requestId, projection });
    if (this.state.exit_operation) {
      if (this.state.exit_operation.request_sha256 === requestHash) return this.snapshot();
      if (this.state.exit_operation.request_id === requestId) return this.#freeze("IDEMPOTENCY_CONFLICT", "idempotency conflict: exit request ID was reused with different parameters", { exitRequired: true });
      throw new Error("a different exit request is already recorded");
    }
    if (!this.enabled) throw new Error("paper lifecycle mutations are disabled");
    if (this.state.phase !== "EXIT_REQUIRED") throw new Error("an exit order requires an explicit reconciled exit trigger");
    if (typeof this.submitExitOrder !== "function") throw new Error("paper exit adapter is unavailable");
    let response;
    try {
      response = await this.submitExitOrder({ request_id: requestId, projection: clone(projection) });
      const status = brokerStatus(response);
      if (!WORKING_STATUSES.has(status) && status !== "filled") throw new Error("exit adapter returned a non-working order");
      assertOrderMatchesProjection(response, projection, "exit order");
      const fills = fillAssessment(response, projection, "exit order");
      if (status === "filled" && fills.filled !== fills.quantity) throw new Error("filled exit does not have complete matching leg fills");
      if (status !== "filled" && fills.filled !== 0) throw new Error("working exit unexpectedly reports fills");
    } catch (error) {
      return this.#freeze("EXIT_SUBMISSION_AMBIGUOUS", error.message, { exitRequired: true });
    }
    const operation = operationRecord(requestId, requestHash, response);
    if (response.status === "filled") {
      return this.#transition("EXIT_FILLED", "CLOSED", { requestId, order_id: response.id }, {
        exit_projection: clone(projection),
        active_exit: { order_id: response.id, client_order_id: response.client_order_id, status: response.status, filled_qty: Number(response.filled_qty) },
        exit_operation: operation,
        exit_required: false,
        closed_reason: "spread_closed",
        last_observation_sha256: sha256(response),
      });
    }
    return this.#transition("EXIT_ACCEPTED", "EXIT_ACCEPTED", { requestId, order_id: response.id }, {
      exit_projection: clone(projection),
      active_exit: { order_id: response.id, client_order_id: response.client_order_id, status: response.status, filled_qty: 0 },
      exit_operation: operation,
      last_observation_sha256: sha256(response),
    });
  }

  async cancelExit({ requestId }) {
    assertRequestId(requestId, "exitcancel");
    if (!this.enabled) throw new Error("paper lifecycle mutations are disabled");
    if (this.state.phase !== "EXIT_ACCEPTED" || !this.state.active_exit?.order_id || !this.state.exit_projection) {
      throw new Error("exit is not cancelable in its current phase");
    }
    if (typeof this.cancelExitOrder !== "function") throw new Error("paper exit cancel adapter is unavailable");
    const requestHash = sha256({ requestId, order_id: this.state.active_exit.order_id });
    if (this.state.cancel_operation?.request_sha256 === requestHash) return this.snapshot();
    let response;
    try {
      response = await this.cancelExitOrder({
        order_id: this.state.active_exit.order_id,
        request_id: requestId,
        projection: clone(this.state.exit_projection),
      });
      const status = brokerStatus(response);
      assertOrderMatchesProjection(response, this.state.exit_projection, "exit cancel readback");
      const fills = fillAssessment(response, this.state.exit_projection, "exit cancel readback");
      if (status === "partially_filled" || status === "filled" || status === "canceled" || status === "expired" || status === "rejected" || status === "done_for_day") {
        return this.observeExit(response);
      }
      if (!WORKING_STATUSES.has(status) && status !== "pending_cancel") throw new Error("exit cancel returned an unsupported order status");
      if (fills.filled !== 0) throw new Error("working exit cancel readback reports nonzero fills");
    } catch (error) {
      if (this.state.phase.endsWith("FROZEN") || this.state.phase === "CLOSED" || this.state.phase === "EXIT_REQUIRED") throw error;
      return this.#freeze("EXIT_CANCEL_AMBIGUOUS", error.message, { exitRequired: true });
    }
    const operation = operationRecord(requestId, requestHash, response);
    return this.#transition("EXIT_CANCEL_REQUESTED", "EXIT_ACCEPTED", { requestId, order_id: response.id, status: response.status }, {
      active_exit: { order_id: response.id, client_order_id: response.client_order_id, status: response.status, filled_qty: 0 },
      cancel_operation: operation,
      last_observation_sha256: sha256(response),
    });
  }

  observeExit(order) {
    if (!this.state.exit_projection) throw new Error("no exit projection has been submitted");
    const observationHash = sha256(order);
    if (observationHash === this.state.last_observation_sha256) return this.snapshot();
    if (this.state.phase === "CLOSED") throw new Error("closed lifecycle is terminal");
    if (this.state.phase === "ERROR_FROZEN") throw new Error("error-frozen lifecycle requires manual reconciliation");
    try {
      const status = brokerStatus(order);
      assertOrderMatchesProjection(order, this.state.exit_projection, "exit order");
      const fills = fillAssessment(order, this.state.exit_projection, "exit order");
      if (status === "partially_filled") {
        if (fills.filled <= 0 || fills.filled >= fills.quantity) throw new Error("partial exit status is inconsistent with fill quantities");
        this.#transition("EXIT_PARTIAL", "EXIT_PARTIAL_FROZEN", { status, filled: fills.filled }, {
          active_exit: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: fills.filled },
          exit_required: true,
          freeze_reason: "PARTIAL_EXIT_FILL",
          last_error: "partial multi-leg exit requires manual reconciliation",
          last_observation_sha256: observationHash,
        });
        throw new Error("paper order lifecycle frozen: partial multi-leg exit requires manual reconciliation");
      }
      if (status === "filled") {
        if (fills.filled !== fills.quantity) throw new Error("filled exit does not have complete matching leg fills");
        return this.#transition("EXIT_FILLED", "CLOSED", { order_id: order.id }, {
          active_exit: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: fills.filled },
          exit_required: false,
          closed_reason: "spread_closed",
          last_observation_sha256: observationHash,
        });
      }
      if (WORKING_STATUSES.has(status) || status === "pending_cancel" || status === "pending_replace") {
        if (fills.filled !== 0) throw new Error("working exit reports nonzero fills");
        return this.#transition("EXIT_STATUS", "EXIT_ACCEPTED", { order_id: order.id, status }, {
          active_exit: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: 0 },
          last_observation_sha256: observationHash,
        });
      }
      if (new Set(["canceled", "expired", "rejected", "done_for_day"]).has(status)) {
        if (fills.filled !== 0) throw new Error(`terminal ${status} exit reports a nonzero fill`);
        return this.#transition("EXIT_RETRY_REQUIRED", "EXIT_REQUIRED", { order_id: order.id, status }, {
          active_exit: { order_id: order.id, client_order_id: order.client_order_id, status, filled_qty: 0 },
          exit_projection: null,
          exit_operation: null,
          cancel_operation: null,
          exit_required: true,
          last_observation_sha256: observationHash,
        });
      }
      throw new Error(`exit status ${status} requires manual reconciliation`);
    } catch (error) {
      if (this.state.phase === "EXIT_PARTIAL_FROZEN") throw error;
      return this.#freeze("EXIT_RECONCILIATION_ERROR", error.message, { exitRequired: true });
    }
  }

  checkpoint(signingSecret) {
    const body = { schema_version: CHECKPOINT_VERSION, state: this.snapshot() };
    return stableStringify({ ...body, signature: checkpointSignature(body, signingSecret) });
  }

  static restore(serialized, { certificate, entryProjection, checkpointSigningSecret, ...adapters }) {
    assertCheckpointSecret(checkpointSigningSecret);
    let checkpoint;
    try {
      checkpoint = typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized);
    } catch {
      throw new Error("lifecycle checkpoint is not valid JSON");
    }
    exactKeys(checkpoint, ["schema_version", "state", "signature"], "lifecycle checkpoint");
    if (checkpoint.schema_version !== CHECKPOINT_VERSION) throw new Error("unsupported lifecycle checkpoint version");
    const body = { schema_version: checkpoint.schema_version, state: checkpoint.state };
    const expected = Buffer.from(checkpointSignature(body, checkpointSigningSecret));
    const supplied = Buffer.from(String(checkpoint.signature));
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("lifecycle checkpoint signature mismatch");
    return new PaperOrderLifecycle({ certificate, entryProjection, ...adapters, restoredState: checkpoint.state });
  }
}

export function createExitProjection(entryProjection, { runId, limitPrice }) {
  const clientOrderId = `finly-exit-${sha256({ runId, entry: entryProjection.client_order_id }).slice(-20)}`;
  return {
    client_order_id: clientOrderId,
    order_class: "mleg",
    qty: String(entryProjection.qty),
    type: "limit",
    time_in_force: "day",
    limit_price: fixedPrice(limitPrice, "exit limit price"),
    legs: entryProjection.legs.map((leg) => ({
      symbol: leg.symbol,
      ratio_qty: "1",
      side: leg.side === "buy" ? "sell" : "buy",
      position_intent: leg.side === "buy" ? "sell_to_close" : "buy_to_close",
    })),
  };
}

export const ORDER_LIFECYCLE_POLICY = Object.freeze({
  paper_host: POLICY.paperHost,
  mutation_default: false,
  phases: Object.freeze([...PHASES]),
  exit_triggers: Object.freeze([...EXIT_TRIGGERS]),
});
