import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { createExitProjection, PaperOrderLifecycle } from "../lib/order_lifecycle.mjs";
import { runDecision } from "../lib/pipeline.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const signingSecret = "order-lifecycle-paper-certificate-secret-0123456789";
const checkpointSecret = "order-lifecycle-checkpoint-secret-0123456789";
const receipt = await runDecision({
  fixture: { ...fixture, data_mode: "alpaca_paper_live" },
  planner: new DeterministicReplayPlanner(),
  signingSecret,
  certificateScope: "paper_submit",
});
const certifiedEntry = structuredClone(receipt.alpaca_payload);
delete certifiedEntry.payload_sha256;

function inputs({ quantity = Number(certifiedEntry.qty) } = {}) {
  const entryProjection = { ...structuredClone(certifiedEntry), qty: String(quantity) };
  const certificate = {
    ...structuredClone(receipt.certificate),
    certificate_id: sha256({ base: receipt.certificate.certificate_id, quantity }),
    desired_order_projection_sha256: sha256(entryProjection),
    max_entry_debit: Math.max(receipt.certificate.max_entry_debit, Number(entryProjection.limit_price) + 0.10),
  };
  return { certificate, entryProjection };
}

function nestedOrder(projection, {
  id = "paper-entry-order-0001",
  status = "accepted",
  filled = 0,
  legFills = [filled, filled],
  overrides = {},
} = {}) {
  return {
    ...structuredClone(projection),
    id,
    status,
    filled_qty: String(filled),
    legs: projection.legs.map((leg, index) => ({ ...leg, filled_qty: String(legFills[index]) })),
    ...overrides,
  };
}

function lifecycle(options = {}, quantityOptions) {
  return new PaperOrderLifecycle({ ...inputs(quantityOptions), now: () => new Date(fixture.decision_time), ...options });
}

function signedCheckpoint(state, secret = checkpointSecret) {
  const body = { schema_version: "paper_order_lifecycle_checkpoint.v1", state };
  const signature = `hmac-sha256:${createHmac("sha256", secret).update(stableStringify(body)).digest("hex")}`;
  return stableStringify({ ...body, signature });
}

test("lifecycle requires an exact already-certified paper projection and disables mutations by default", async () => {
  const { certificate, entryProjection } = inputs();
  assert.throws(
    () => new PaperOrderLifecycle({ certificate: { ...certificate, authorization_scope: "synthetic_replay" }, entryProjection }),
    /already-certified paper-submit/,
  );
  assert.throws(
    () => new PaperOrderLifecycle({ certificate: { ...certificate, mode: "live" }, entryProjection }),
    /locked to Alpaca paper mode/,
  );
  assert.throws(
    () => new PaperOrderLifecycle({ certificate, entryProjection: { ...entryProjection, qty: "2" } }),
    /projection hash mismatch/,
  );

  const stateMachine = lifecycle();
  stateMachine.observeEntry(nestedOrder(certifiedEntry));
  await assert.rejects(
    () => stateMachine.cancelEntry({ requestId: "finly-cancel-disabled1" }),
    /mutations are disabled/,
  );
  await assert.rejects(
    () => stateMachine.replaceEntry({ requestId: "finly-replace-disabled1", limitPrice: certifiedEntry.limit_price }),
    /mutations are disabled/,
  );
  assert.equal(stateMachine.snapshot().phase, "ENTRY_ACCEPTED");
});

test("accepted entry observations are idempotent and a fully matched fill opens one defined-risk position", () => {
  const stateMachine = lifecycle();
  const accepted = nestedOrder(certifiedEntry);
  const first = stateMachine.observeEntry(accepted);
  assert.equal(first.phase, "ENTRY_ACCEPTED");
  assert.equal(stateMachine.observeEntry(accepted).revision, first.revision);

  const filled = nestedOrder(certifiedEntry, { status: "filled", filled: Number(certifiedEntry.qty) });
  const opened = stateMachine.observeEntry(filled);
  assert.equal(opened.phase, "POSITION_OPEN");
  assert.equal(opened.entry_fill_qty, Number(certifiedEntry.qty));
  assert.equal(opened.exit_required, false);
  assert.equal(stateMachine.observeEntry(filled).revision, opened.revision);

  const exitRequired = stateMachine.requireExit("risk_limit");
  assert.equal(exitRequired.phase, "EXIT_REQUIRED");
  assert.equal(exitRequired.exit_required, true);
  assert.equal(stateMachine.requireExit("risk_limit").revision, exitRequired.revision);
  assert.throws(() => stateMachine.requireExit("social_media_panic"), /unknown exit-required trigger/);
});

test("balanced partial entries freeze with exit required, while mismatched leg fills freeze as reconciliation errors", () => {
  const { entryProjection } = inputs({ quantity: 2 });
  const balanced = lifecycle({}, { quantity: 2 });
  assert.throws(
    () => balanced.observeEntry(nestedOrder(entryProjection, { status: "partially_filled", filled: 1 })),
    /partial multi-leg entry/,
  );
  assert.equal(balanced.snapshot().phase, "ENTRY_PARTIAL_FROZEN");
  assert.equal(balanced.snapshot().exit_required, true);

  const mismatched = lifecycle({}, { quantity: 2 });
  assert.throws(
    () => mismatched.observeEntry(nestedOrder(entryProjection, { status: "partially_filled", filled: 1, legFills: [1, 0] })),
    /leg fills do not match/,
  );
  assert.equal(mismatched.snapshot().phase, "ERROR_FROZEN");
  assert.equal(mismatched.snapshot().freeze_reason, "ENTRY_RECONCILIATION_ERROR");
});

test("unknown and ambiguous entry statuses fail closed, while zero-fill rejection closes without exposure", () => {
  const unknown = lifecycle();
  assert.throws(
    () => unknown.observeEntry(nestedOrder(certifiedEntry, { status: "teleported" })),
    /unknown broker order status/,
  );
  assert.equal(unknown.snapshot().phase, "ERROR_FROZEN");

  const ambiguous = lifecycle();
  assert.throws(
    () => ambiguous.observeEntry(nestedOrder(certifiedEntry, { status: "suspended" })),
    /requires manual reconciliation/,
  );
  assert.equal(ambiguous.snapshot().phase, "ERROR_FROZEN");

  const rejected = lifecycle();
  const closed = rejected.observeEntry(nestedOrder(certifiedEntry, { status: "rejected" }));
  assert.equal(closed.phase, "CLOSED");
  assert.equal(closed.closed_reason, "entry_rejected");
  assert.throws(() => rejected.observeEntry(nestedOrder(certifiedEntry, { status: "accepted" })), /closed lifecycle is terminal/);
  assert.equal(rejected.snapshot().phase, "CLOSED");
});

test("entry cancellation is injectable, paper-only, and idempotent", async () => {
  let calls = 0;
  const stateMachine = lifecycle({
    enabled: true,
    cancelOrder: async ({ order_id: orderId }) => {
      calls += 1;
      assert.equal(orderId, "paper-entry-order-0001");
      return { status: "pending_cancel" };
    },
  });
  stateMachine.observeEntry(nestedOrder(certifiedEntry));
  const request = { requestId: "finly-cancel-request001" };
  const pending = await stateMachine.cancelEntry(request);
  assert.equal(pending.phase, "ENTRY_CANCEL_PENDING");
  assert.equal((await stateMachine.cancelEntry(request)).revision, pending.revision);
  assert.equal(calls, 1);
  await assert.rejects(
    () => stateMachine.cancelEntry({ requestId: "finly-cancel-request002" }),
    /different entry cancel request/,
  );
  const closed = stateMachine.observeEntry(nestedOrder(certifiedEntry, { status: "canceled" }));
  assert.equal(closed.phase, "CLOSED");
  assert.equal(closed.closed_reason, "entry_canceled");
});

test("entry replacement changes only price within the certificate collar and deduplicates retries", async () => {
  let calls = 0;
  const replacementPrice = (Number(certifiedEntry.limit_price) + 0.05).toFixed(2);
  const stateMachine = lifecycle({
    enabled: true,
    replaceOrder: async ({ projection }) => {
      calls += 1;
      return nestedOrder(projection, { id: "paper-replacement-order-0001", status: "accepted" });
    },
  });
  stateMachine.observeEntry(nestedOrder(certifiedEntry));
  const request = { requestId: "finly-replace-request001", limitPrice: replacementPrice };
  const replaced = await stateMachine.replaceEntry(request);
  assert.equal(replaced.phase, "ENTRY_ACCEPTED");
  assert.equal(replaced.active_entry_projection.limit_price, replacementPrice);
  assert.equal((await stateMachine.replaceEntry(request)).revision, replaced.revision);
  assert.equal(calls, 1);

  await assert.rejects(
    () => stateMachine.replaceEntry({ requestId: request.requestId, limitPrice: Number(replacementPrice) + 0.01 }),
    /idempotency conflict/i,
  );
  assert.equal(stateMachine.snapshot().phase, "ERROR_FROZEN");

  const overCollar = lifecycle({ enabled: true, replaceOrder: async () => assert.fail("adapter must not be called") });
  overCollar.observeEntry(nestedOrder(certifiedEntry));
  await assert.rejects(
    () => overCollar.replaceEntry({ requestId: "finly-replace-overcollar", limitPrice: receipt.certificate.max_entry_debit + 1 }),
    /exceeds the certified debit collar/,
  );
});

test("exit acceptance, retry deduplication, matched fill, and closed terminal state are explicit", async () => {
  let calls = 0;
  const stateMachine = lifecycle({
    enabled: true,
    submitExitOrder: async ({ projection }) => {
      calls += 1;
      return nestedOrder(projection, { id: "paper-exit-order-0001", status: "accepted" });
    },
  });
  stateMachine.observeEntry(nestedOrder(certifiedEntry, { status: "filled", filled: Number(certifiedEntry.qty) }));
  stateMachine.requireExit("time_stop");
  const exitProjection = createExitProjection(certifiedEntry, { runId: fixture.run_id, limitPrice: 1.25 });
  const request = { requestId: "finly-exit-request001", projection: exitProjection };
  const accepted = await stateMachine.submitExit(request);
  assert.equal(accepted.phase, "EXIT_ACCEPTED");
  assert.equal((await stateMachine.submitExit(request)).revision, accepted.revision);
  assert.equal(calls, 1);

  const closed = stateMachine.observeExit(nestedOrder(exitProjection, {
    id: "paper-exit-order-0001",
    status: "filled",
    filled: Number(exitProjection.qty),
  }));
  assert.equal(closed.phase, "CLOSED");
  assert.equal(closed.closed_reason, "spread_closed");
  assert.equal(closed.exit_required, false);
  assert.throws(
    () => stateMachine.observeExit(nestedOrder(exitProjection, { id: "paper-exit-order-0001", status: "accepted" })),
    /closed lifecycle is terminal/,
  );
});

test("partial or mismatched exit fills freeze instead of claiming the spread is closed", async (t) => {
  const { entryProjection } = inputs({ quantity: 2 });
  const exitProjection = createExitProjection(entryProjection, { runId: "two-lot-exit", limitPrice: 1.25 });

  for (const scenario of [
    { name: "balanced partial", legFills: [1, 1], expectedPhase: "EXIT_PARTIAL_FROZEN", pattern: /partial multi-leg exit/ },
    { name: "mismatched legs", legFills: [1, 0], expectedPhase: "ERROR_FROZEN", pattern: /leg fills do not match/ },
  ]) {
    await t.test(scenario.name, async () => {
      const stateMachine = lifecycle({
        enabled: true,
        submitExitOrder: async ({ projection }) => nestedOrder(projection, { id: "paper-two-lot-exit", status: "accepted" }),
      }, { quantity: 2 });
      stateMachine.observeEntry(nestedOrder(entryProjection, { status: "filled", filled: 2 }));
      stateMachine.requireExit("expiry_guard");
      await stateMachine.submitExit({ requestId: `finly-exit-${scenario.name.replaceAll(" ", "_")}`, projection: exitProjection });
      assert.throws(
        () => stateMachine.observeExit(nestedOrder(exitProjection, { id: "paper-two-lot-exit", status: "partially_filled", filled: 1, legFills: scenario.legFills })),
        scenario.pattern,
      );
      assert.equal(stateMachine.snapshot().phase, scenario.expectedPhase);
      assert.equal(stateMachine.snapshot().exit_required, true);
    });
  }
});

test("authenticated checkpoints restore exactly and reject tampering or invalid serialized state", () => {
  const source = lifecycle();
  source.observeEntry(nestedOrder(certifiedEntry));
  const checkpoint = source.checkpoint(checkpointSecret);
  const restored = PaperOrderLifecycle.restore(checkpoint, {
    ...inputs(),
    checkpointSigningSecret: checkpointSecret,
  });
  assert.deepEqual(restored.snapshot(), source.snapshot());
  assert.equal(restored.snapshot().phase, "ENTRY_ACCEPTED");

  const tampered = JSON.parse(checkpoint);
  tampered.state.phase = "CLOSED";
  assert.throws(
    () => PaperOrderLifecycle.restore(stableStringify(tampered), { ...inputs(), checkpointSigningSecret: checkpointSecret }),
    /signature mismatch/,
  );

  const invalidPhase = source.snapshot();
  invalidPhase.phase = "BROKER_MAGIC";
  invalidPhase.history.at(-1).to = "BROKER_MAGIC";
  assert.throws(
    () => PaperOrderLifecycle.restore(signedCheckpoint(invalidPhase), { ...inputs(), checkpointSigningSecret: checkpointSecret }),
    /unknown phase/,
  );

  const unknownField = source.snapshot();
  unknownField.untrusted = true;
  assert.throws(
    () => PaperOrderLifecycle.restore(signedCheckpoint(unknownField), { ...inputs(), checkpointSigningSecret: checkpointSecret }),
    /missing or unknown fields/,
  );
});
