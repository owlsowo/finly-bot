import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { sha256 } from "../lib/canonical.mjs";
import { FilePermitLedger } from "../lib/permit_ledger.mjs";
import { runDecision } from "../lib/pipeline.mjs";
import { POLICY } from "../lib/policy.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const signingSecret = "file-ledger-test-paper-secret-at-least-32-bytes";

async function paperReceipt(runId) {
  return runDecision({
    fixture: { ...fixture, run_id: runId, data_mode: "alpaca_paper_live" },
    planner: new DeterministicReplayPlanner(),
    signingSecret,
    certificateScope: "paper_submit",
  });
}

function reservationContext(certificate) {
  return {
    client_order_id: `test-${certificate.run_id}`,
    equity: 20000,
    openDefinedRisk: 0,
    aggregateRiskFraction: POLICY.aggregateRiskFraction,
    reserved_at: fixture.decision_time,
  };
}

test("file permit ledger persists exact issuance and nonce consumption across instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finly-ledger-restart-"));
  try {
    const receipt = await paperReceipt("ledger_restart_a");
    const first = new FilePermitLedger(directory);
    await first.issue(receipt.certificate);
    await first.assertIssued(receipt.certificate);
    await first.reserve(receipt.certificate, reservationContext(receipt.certificate));
    const restarted = new FilePermitLedger(directory);
    await restarted.assertIssued(receipt.certificate);
    await assert.rejects(() => restarted.reserve(receipt.certificate, reservationContext(receipt.certificate)), /already reserved or consumed/);
    await assert.rejects(() => restarted.assertIssued({ ...receipt.certificate, quantity: 2 }), /differs from trusted/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("100 two-worker races never allocate more than the durable aggregate budget", async () => {
  const [leftReceipt, rightReceipt] = await Promise.all([paperReceipt("ledger_race_left"), paperReceipt("ledger_race_right")]);
  assert.ok(leftReceipt.certificate.reserved_max_loss + rightReceipt.certificate.reserved_max_loss > 20000 * POLICY.aggregateRiskFraction);
  const root = await mkdtemp(join(tmpdir(), "finly-ledger-races-"));
  try {
    for (let run = 0; run < 100; run += 1) {
      const directory = join(root, `run-${run}`);
      const issuer = new FilePermitLedger(directory);
      await issuer.issue(leftReceipt.certificate);
      await issuer.issue(rightReceipt.certificate);
      const workerA = new FilePermitLedger(directory);
      const workerB = new FilePermitLedger(directory);
      const outcomes = await Promise.allSettled([
        workerA.reserve(leftReceipt.certificate, reservationContext(leftReceipt.certificate)),
        workerB.reserve(rightReceipt.certificate, reservationContext(rightReceipt.certificate)),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1, `race ${run} over- or under-allocated`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidenced terminal close is atomic, idempotent, and releases aggregate risk", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "finly-ledger-close-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const [firstReceipt, secondReceipt] = await Promise.all([
    paperReceipt("ledger_terminal_close_a"),
    paperReceipt("ledger_terminal_close_b"),
  ]);
  assert.ok(
    firstReceipt.certificate.reserved_max_loss + secondReceipt.certificate.reserved_max_loss
      > reservationContext(firstReceipt.certificate).equity * POLICY.aggregateRiskFraction,
    "fixture must require the first terminal reservation to be released",
  );
  const ledger = new FilePermitLedger(directory);
  await ledger.issue(firstReceipt.certificate);
  await ledger.issue(secondReceipt.certificate);
  await ledger.reserve(firstReceipt.certificate, reservationContext(firstReceipt.certificate));
  await ledger.mark(firstReceipt.certificate.nonce, "accepted", { broker_order_id: "paper-order-terminal-close" });
  const detail = {
    closed_at: fixture.decision_time,
    lifecycle_id: sha256("terminal-lifecycle"),
    lifecycle_revision: 7,
    session_id: sha256("terminal-session"),
    terminal_evidence_sha256: sha256("flat-broker-position-proof"),
    terminal_session_status: "CLOSED",
  };
  const closed = await ledger.close(firstReceipt.certificate.nonce, detail);
  assert.equal(closed.status, "closed");
  assert.deepEqual(await ledger.close(firstReceipt.certificate.nonce, detail), closed);
  await assert.rejects(
    () => ledger.close(firstReceipt.certificate.nonce, { ...detail, terminal_evidence_sha256: sha256("conflict") }),
    /evidence conflicts/,
  );

  const restarted = new FilePermitLedger(directory);
  assert.equal((await restarted.loadReservation(firstReceipt.certificate.nonce)).status, "closed");
  const replacement = await restarted.reserve(secondReceipt.certificate, reservationContext(secondReceipt.certificate));
  assert.equal(replacement.status, "reserved");
});
