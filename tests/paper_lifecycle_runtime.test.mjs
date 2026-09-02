import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { sha256 } from "../lib/canonical.mjs";
import { createExitProjection } from "../lib/order_lifecycle.mjs";
import {
  ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  AlpacaPaperLifecycleRuntime,
  FileLifecycleCheckpointStore,
  toAlpacaClosingCreditProjection,
} from "../lib/paper_lifecycle_runtime.mjs";
import { runDecision } from "../lib/pipeline.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const certificateSecret = "paper-runtime-certificate-secret-01234567890123456789";
const checkpointSecret = "paper-runtime-checkpoint-secret-01234567890123456789";
const receipt = await runDecision({
  fixture: { ...fixture, data_mode: "alpaca_paper_live" },
  planner: new DeterministicReplayPlanner(),
  signingSecret: certificateSecret,
  certificateScope: "paper_submit",
});
const entryProjection = structuredClone(receipt.alpaca_payload);
delete entryProjection.payload_sha256;
const certificate = receipt.certificate;

async function temporaryStore(t) {
  const directory = await mkdtemp(join(tmpdir(), "finly-lifecycle-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new FileLifecycleCheckpointStore(directory);
}

function nestedOrder(projection, {
  id = "deadbeef-dead-beef-dead-beefdeadbeef",
  status = "accepted",
  filled = 0,
  legFills = [filled, filled],
  extra = {},
} = {}) {
  return {
    ...structuredClone(projection),
    id,
    status,
    filled_qty: String(filled),
    legs: projection.legs.map((leg, index) => ({ ...leg, filled_qty: String(legFills[index]) })),
    ...extra,
  };
}

async function openRuntime({
  store,
  lookup,
  mutationsEnabled = false,
  placeClosingOptionOrder,
  closingCapability,
  beforeClosingMutation,
  cancelOptionOrder,
} = {}) {
  return AlpacaPaperLifecycleRuntime.open({
    certificate,
    entryProjection,
    checkpointSigningSecret: checkpointSecret,
    checkpointStore: store,
    lookupNestedOrderByClientOrderId: lookup,
    mutationsEnabled,
    beforeClosingMutation,
    placeClosingOptionOrder,
    cancelOptionOrder,
    closingCapability,
    runId: fixture.run_id,
    now: () => new Date(fixture.decision_time),
  });
}

function exitProjectionFor(requestId, creditLimit) {
  return createExitProjection(entryProjection, {
    runId: sha256({ run_id: fixture.run_id, request_id: requestId }),
    limitPrice: creditLimit,
  });
}

test("entry reconciliation is read-only, checkpointed with HMAC, and exactly restorable", async (t) => {
  const store = await temporaryStore(t);
  let lookups = 0;
  const lookup = async (clientOrderId) => {
    lookups += 1;
    assert.equal(clientOrderId, entryProjection.client_order_id);
    return nestedOrder(entryProjection);
  };
  const runtime = await openRuntime({ store, lookup });
  assert.equal(runtime.snapshot().phase, "CREATED");
  const accepted = await runtime.reconcileEntry();
  assert.equal(accepted.phase, "ENTRY_ACCEPTED");
  assert.equal(lookups, 1);

  const checkpointPath = store.pathFor(runtime.snapshot().lifecycle_id);
  const serialized = await readFile(checkpointPath, "utf8");
  const checkpoint = JSON.parse(serialized);
  assert.match(checkpoint.signature, /^hmac-sha256:[a-f0-9]{64}$/);
  assert.equal(checkpoint.state.revision, 1);
  assert.equal((await stat(checkpointPath)).mode & 0o777, 0o600);

  const restored = await openRuntime({ store, lookup });
  assert.deepEqual(restored.snapshot(), runtime.snapshot());
  assert.equal((await restored.reconcileEntry()).revision, accepted.revision);
  assert.equal(lookups, 2);
});

test("tampered durable checkpoints fail authentication instead of being overwritten", async (t) => {
  const store = await temporaryStore(t);
  const lookup = async () => nestedOrder(entryProjection);
  const runtime = await openRuntime({ store, lookup });
  await runtime.reconcileEntry();
  const path = store.pathFor(runtime.snapshot().lifecycle_id);
  const tampered = JSON.parse(await readFile(path, "utf8"));
  tampered.state.phase = "CLOSED";
  await writeFile(path, JSON.stringify(tampered), { mode: 0o600 });
  await assert.rejects(() => openRuntime({ store, lookup }), /checkpoint signature mismatch/);
});

test("Alpaca closing-credit boundary uses a negative signed price and exact close intents", () => {
  const lifecycleProjection = exitProjectionFor("finly-exit-signcheck01", 1.25);
  const brokerProjection = toAlpacaClosingCreditProjection(lifecycleProjection);
  assert.equal(lifecycleProjection.limit_price, "1.25");
  assert.equal(brokerProjection.limit_price, "-1.25");
  assert.deepEqual(brokerProjection.legs.map((leg) => [leg.side, leg.position_intent]), [
    ["sell", "sell_to_close"],
    ["buy", "buy_to_close"],
  ]);
});

test("ambiguous closing mutation reconciles by deterministic client ID, persists no credentials, and deduplicates retries", async (t) => {
  const store = await temporaryStore(t);
  const secretFromTransport = "APCA_SECRET_DO_NOT_PERSIST_123456789";
  let exitOrder = null;
  let mutationCalls = 0;
  let capturedProjection;
  const lookup = async (clientOrderId) => {
    if (clientOrderId === entryProjection.client_order_id) {
      return nestedOrder(entryProjection, { status: "filled", filled: Number(entryProjection.qty) });
    }
    return exitOrder;
  };
  const placeClosingOptionOrder = async (projection) => {
    mutationCalls += 1;
    capturedProjection = projection;
    exitOrder = nestedOrder(projection, { id: "feedface-feed-face-feed-facefeedface" });
    throw new Error(`socket timeout with ${secretFromTransport}`);
  };
  const runtime = await openRuntime({
    store,
    lookup,
    mutationsEnabled: true,
    placeClosingOptionOrder,
    closingCapability: ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  });
  await runtime.reconcileEntry();
  await runtime.requireExit("time_stop");

  const request = { requestId: "finly-exit-runtime001", creditLimit: 1.25 };
  const accepted = await runtime.submitCreditExit(request);
  assert.equal(accepted.phase, "EXIT_ACCEPTED");
  assert.equal(capturedProjection.limit_price, "-1.25");
  assert.ok(capturedProjection.legs.every((leg) => leg.position_intent.endsWith("_to_close")));
  assert.equal(mutationCalls, 1);

  const retried = await runtime.submitCreditExit(request);
  assert.equal(retried.revision, accepted.revision);
  assert.equal(mutationCalls, 1);
  const serialized = await readFile(store.pathFor(runtime.snapshot().lifecycle_id), "utf8");
  assert.equal(serialized.includes(secretFromTransport), false);
  assert.equal(serialized.includes("socket timeout"), false);

  await assert.rejects(
    () => runtime.submitCreditExit({ ...request, creditLimit: 1.20 }),
    /idempotency conflict/i,
  );
  assert.equal(runtime.snapshot().phase, "ERROR_FROZEN");
  const restored = await openRuntime({
    store,
    lookup,
    mutationsEnabled: true,
    placeClosingOptionOrder,
    closingCapability: ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  });
  assert.equal(restored.snapshot().phase, "ERROR_FROZEN");
});

test("crash-safe retry reconciles an existing exit before any second mutation", async (t) => {
  const store = await temporaryStore(t);
  const requestId = "finly-exit-crashretry01";
  const lifecycleExit = exitProjectionFor(requestId, 1.15);
  const signedExit = toAlpacaClosingCreditProjection(lifecycleExit);
  let mutationCalls = 0;
  const lookup = async (clientOrderId) => {
    if (clientOrderId === entryProjection.client_order_id) {
      return nestedOrder(entryProjection, { status: "filled", filled: Number(entryProjection.qty) });
    }
    if (clientOrderId === signedExit.client_order_id) return nestedOrder(signedExit);
    return null;
  };
  const runtime = await openRuntime({
    store,
    lookup,
    mutationsEnabled: true,
    placeClosingOptionOrder: async () => { mutationCalls += 1; },
    closingCapability: ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  });
  await runtime.reconcileEntry();
  await runtime.requireExit("expiry_guard");
  const accepted = await runtime.submitCreditExit({ requestId, creditLimit: 1.15 });
  assert.equal(accepted.phase, "EXIT_ACCEPTED");
  assert.equal(mutationCalls, 0);
});

test("a durable cloud checkpoint must finish before a new closing mutation", async (t) => {
  const store = await temporaryStore(t);
  const sequence = [];
  const lookup = async (clientOrderId) => {
    if (clientOrderId === entryProjection.client_order_id) {
      return nestedOrder(entryProjection, { status: "filled", filled: Number(entryProjection.qty) });
    }
    return null;
  };
  const runtime = await openRuntime({
    store,
    lookup,
    mutationsEnabled: true,
    beforeClosingMutation: async () => sequence.push("checkpoint"),
    placeClosingOptionOrder: async () => {
      sequence.push("mutation");
      throw new Error("simulated ambiguous close");
    },
    closingCapability: ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  });
  await runtime.reconcileEntry();
  await runtime.requireExit("expiry_guard");
  await assert.rejects(
    () => runtime.submitCreditExit({ requestId: "finly-exit-cloudcheck01", creditLimit: 1.15 }),
    /post-mutation exit readback is unavailable/,
  );
  assert.deepEqual(sequence, ["checkpoint", "mutation"]);
});

test("closing transport is disabled by default and requires an exact signed-credit capability", async (t) => {
  const store = await temporaryStore(t);
  const lookup = async () => nestedOrder(entryProjection);
  await assert.rejects(
    () => openRuntime({
      store,
      lookup,
      mutationsEnabled: true,
      placeClosingOptionOrder: async () => assert.fail("must not mutate"),
    }),
    /has not declared Alpaca's pinned signed-credit capability/,
  );
  await assert.rejects(
    () => openRuntime({
      store,
      lookup,
      mutationsEnabled: true,
      placeClosingOptionOrder: async () => assert.fail("must not mutate"),
      closingCapability: { ...ALPACA_MCP_CLOSING_CREDIT_CAPABILITY, price_convention: "positive_credit" },
    }),
    /has not declared Alpaca's pinned signed-credit capability/,
  );

  await assert.rejects(
    () => AlpacaPaperLifecycleRuntime.open({
      certificate,
      entryProjection,
      checkpointSigningSecret: checkpointSecret,
      checkpointStore: store,
      lookupNestedOrderByClientOrderId: lookup,
      APCA_API_SECRET_KEY: "must-not-be-accepted",
    }),
    /unknown field/,
  );
});

test("malformed broker data and external errors cannot enter durable checkpoints", async (t) => {
  const store = await temporaryStore(t);
  const leaked = "paper-secret-from-malformed-broker-object";
  const lookup = async () => nestedOrder(entryProjection, {
    status: leaked,
    extra: { credentials: leaked },
  });
  const runtime = await openRuntime({ store, lookup });
  await assert.rejects(() => runtime.reconcileEntry(), /failed strict structural reconciliation/);
  assert.equal(runtime.snapshot().phase, "CREATED");
  const serialized = await readFile(store.pathFor(runtime.snapshot().lifecycle_id), "utf8");
  assert.equal(serialized.includes(leaked), false);
});

test("checkpoint compare-and-swap freezes stale runtimes without corrupting the durable winner", async (t) => {
  const store = await temporaryStore(t);
  const acceptedLookup = async () => nestedOrder(entryProjection);
  const filledLookup = async () => nestedOrder(entryProjection, { status: "filled", filled: Number(entryProjection.qty) });
  const first = await openRuntime({ store, lookup: acceptedLookup });
  const stale = await openRuntime({ store, lookup: filledLookup });
  await first.reconcileEntry();
  await assert.rejects(() => stale.reconcileEntry(), /checkpoint persistence failed; runtime frozen/);
  await assert.rejects(() => stale.reconcileEntry(), /runtime is frozen/);

  const restored = await openRuntime({ store, lookup: acceptedLookup });
  assert.equal(restored.snapshot().phase, "ENTRY_ACCEPTED");
  assert.equal(restored.snapshot().revision, 1);
});

test("a terminal exit readback requires a new request ID and therefore a new Alpaca idempotency key", async (t) => {
  const store = await temporaryStore(t);
  const submitted = new Map();
  const lookup = async (clientOrderId) => {
    if (clientOrderId === entryProjection.client_order_id) {
      return nestedOrder(entryProjection, { status: "filled", filled: Number(entryProjection.qty) });
    }
    return submitted.get(clientOrderId) ?? null;
  };
  const place = async (projection) => {
    submitted.set(projection.client_order_id, nestedOrder(projection));
  };
  const runtime = await openRuntime({
    store,
    lookup,
    mutationsEnabled: true,
    placeClosingOptionOrder: place,
    closingCapability: ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  });
  await runtime.reconcileEntry();
  await runtime.requireExit("strategy_invalidation");
  await runtime.submitCreditExit({ requestId: "finly-exit-firsttry001", creditLimit: 1.10 });
  const firstId = runtime.snapshot().exit_projection.client_order_id;
  submitted.set(firstId, nestedOrder(toAlpacaClosingCreditProjection(runtime.snapshot().exit_projection), { status: "canceled" }));
  assert.equal((await runtime.reconcileExit()).phase, "EXIT_REQUIRED");

  await runtime.submitCreditExit({ requestId: "finly-exit-secondtry01", creditLimit: 1.05 });
  const secondId = runtime.snapshot().exit_projection.client_order_id;
  assert.notEqual(secondId, firstId);
  assert.equal(submitted.size, 2);
});

test("an accepted unfilled exit is canceled, reconciled, and replaced under a new idempotency key", async (t) => {
  const store = await temporaryStore(t);
  const submitted = new Map();
  let cancelCalls = 0;
  const lookup = async (clientOrderId) => {
    if (clientOrderId === entryProjection.client_order_id) {
      return nestedOrder(entryProjection, { status: "filled", filled: Number(entryProjection.qty) });
    }
    return submitted.get(clientOrderId) ?? null;
  };
  const runtime = await openRuntime({
    store,
    lookup,
    mutationsEnabled: true,
    placeClosingOptionOrder: async (projection) => {
      submitted.set(projection.client_order_id, nestedOrder(projection, { id: `exit-order-${submitted.size + 1}-00000000` }));
    },
    cancelOptionOrder: async (orderId) => {
      cancelCalls += 1;
      const order = [...submitted.values()].find((candidate) => candidate.id === orderId);
      order.status = "canceled";
    },
    closingCapability: ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  });
  await runtime.reconcileEntry();
  await runtime.requireExit("competition_end_guard");
  await runtime.submitCreditExit({ requestId: "finly-exit-reprice001", creditLimit: 3.39 });
  const firstId = runtime.snapshot().exit_projection.client_order_id;
  const canceled = await runtime.cancelWorkingExit({ requestId: "finly-exitcancel-reprice001" });
  assert.equal(canceled.phase, "EXIT_REQUIRED");
  assert.equal(cancelCalls, 1);

  await runtime.submitCreditExit({ requestId: "finly-exit-reprice002", creditLimit: 0.01 });
  assert.equal(runtime.snapshot().phase, "EXIT_ACCEPTED");
  assert.notEqual(runtime.snapshot().exit_projection.client_order_id, firstId);
  assert.equal(runtime.exitSubmissionCount(), 2);
  assert.equal(submitted.size, 2);
});

test("restart after a lost cancel acknowledgement reconciles the old order and cannot duplicate closing risk", async (t) => {
  const store = await temporaryStore(t);
  const submitted = new Map();
  let cancelCalls = 0;
  const lookup = async (clientOrderId) => {
    if (clientOrderId === entryProjection.client_order_id) {
      return nestedOrder(entryProjection, { status: "filled", filled: Number(entryProjection.qty) });
    }
    return submitted.get(clientOrderId) ?? null;
  };
  const open = () => openRuntime({
    store,
    lookup,
    mutationsEnabled: true,
    placeClosingOptionOrder: async (projection) => {
      submitted.set(projection.client_order_id, nestedOrder(projection, { id: "lost-ack-exit-order-000001" }));
    },
    cancelOptionOrder: async (orderId) => {
      cancelCalls += 1;
      const order = [...submitted.values()].find((candidate) => candidate.id === orderId);
      order.status = "pending_cancel";
      throw new Error("simulated lost DELETE acknowledgement");
    },
    closingCapability: ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  });
  let runtime = await open();
  await runtime.reconcileEntry();
  await runtime.requireExit("competition_end_guard");
  await runtime.submitCreditExit({ requestId: "finly-exit-lostack001", creditLimit: 1.00 });
  const pending = await runtime.cancelWorkingExit({ requestId: "finly-exitcancel-lostack001" });
  assert.equal(pending.phase, "EXIT_ACCEPTED");
  assert.equal(pending.active_exit.status, "pending_cancel");
  assert.equal(cancelCalls, 1);

  runtime = await open();
  assert.equal(runtime.snapshot().phase, "EXIT_ACCEPTED");
  const deduplicated = await runtime.cancelWorkingExit({ requestId: "finly-exitcancel-lostack001" });
  assert.equal(deduplicated.revision, pending.revision);
  assert.equal(cancelCalls, 1);
  assert.equal(submitted.size, 1);

  const working = [...submitted.values()][0];
  working.status = "filled";
  working.filled_qty = working.qty;
  working.filled_at = fixture.decision_time;
  working.legs.forEach((leg) => { leg.filled_qty = working.qty; });
  const closed = await runtime.reconcileExit();
  assert.equal(closed.phase, "CLOSED");
  assert.equal(submitted.size, 1);
});
