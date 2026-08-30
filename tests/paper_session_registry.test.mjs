import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import {
  FilePaperSessionRegistry,
  NONTERMINAL_PAPER_SESSION_STATUSES,
  PAPER_SESSION_STATUSES,
  TERMINAL_PAPER_SESSION_STATUSES,
} from "../lib/paper_session_registry.mjs";
import { runDecision } from "../lib/pipeline.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const certificateSecret = "paper-session-certificate-test-secret-01234567890123456789";
const registrySecret = "paper-session-registry-test-secret-012345678901234567890";
const fixedNow = new Date("2026-08-28T23:30:00.000Z");

async function paperSessionInputs(runId) {
  const receipt = await runDecision({
    fixture: { ...fixture, run_id: runId, data_mode: "alpaca_paper_live" },
    planner: new DeterministicReplayPlanner(),
    signingSecret: certificateSecret,
    certificateScope: "paper_submit",
  });
  const entryProjection = structuredClone(receipt.alpaca_payload);
  delete entryProjection.payload_sha256;
  return { certificate: receipt.certificate, entryProjection };
}

async function temporaryRegistry(t, suffix = "main") {
  const root = await mkdtemp(join(tmpdir(), `finly-session-registry-${suffix}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "registry");
  return {
    directory,
    registry: new FilePaperSessionRegistry(directory, registrySecret, {
      now: () => fixedNow,
      certificateSigningSecret: certificateSecret,
    }),
  };
}

function evidence(label) {
  return sha256({ sanitized_reconciliation: label });
}

function resignRegistry(value) {
  const body = {
    schema_version: value.schema_version,
    revision: value.revision,
    updated_at: value.updated_at,
    sessions: value.sessions,
  };
  return {
    ...body,
    signature: `hmac-sha256:${createHmac("sha256", registrySecret).update(stableStringify(body)).digest("hex")}`,
  };
}

test("PENDING is durably created before submission with the full certificate and exact entry projection", async (t) => {
  const { directory, registry } = await temporaryRegistry(t, "restart");
  const inputs = await paperSessionInputs("paper_session_registry_restart");
  const wrongCertificateKey = new FilePaperSessionRegistry(directory, registrySecret, {
    now: () => fixedNow,
    certificateSigningSecret: "wrong-paper-certificate-key-still-at-least-thirty-two-bytes",
  });
  await assert.rejects(() => wrongCertificateKey.createPending(inputs), /certificate HMAC authentication failed/);
  const pending = await registry.createPending(inputs);

  assert.equal(pending.status, PAPER_SESSION_STATUSES.PENDING);
  assert.equal(pending.revision, 0);
  assert.deepEqual(pending.certificate, inputs.certificate);
  assert.deepEqual(pending.entry_projection, inputs.entryProjection);
  assert.equal(pending.session_id, sha256({
    certificate_id: inputs.certificate.certificate_id,
    entry_projection_sha256: sha256(inputs.entryProjection),
  }));

  const filePath = join(directory, "paper-sessions.json");
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  const serialized = await readFile(filePath, "utf8");
  const stored = JSON.parse(serialized);
  assert.match(stored.signature, /^hmac-sha256:[a-f0-9]{64}$/);
  assert.equal(serialized, `${stableStringify(stored)}\n`);
  assert.equal(/APCA|api[_-]?key|account_id|account_number/i.test(serialized), false);

  const restarted = new FilePaperSessionRegistry(directory, registrySecret, {
    now: () => fixedNow,
    certificateSigningSecret: certificateSecret,
  });
  assert.deepEqual(await restarted.loadOpen(), pending);
  assert.deepEqual(await restarted.load(pending.session_id), pending);
  assert.deepEqual((await restarted.list()).sessions, [pending]);

  const idempotent = await restarted.createPending(inputs);
  assert.deepEqual(idempotent, pending);
  assert.equal((await restarted.list()).revision, 1);
});

test("CAS transitions preserve one open session through ACTIVE and FROZEN until evidenced closure", async (t) => {
  const { directory, registry } = await temporaryRegistry(t, "lifecycle");
  const firstInputs = await paperSessionInputs("paper_session_registry_first");
  const secondInputs = await paperSessionInputs("paper_session_registry_second");
  const pending = await registry.createPending(firstInputs);
  const activeEvidence = evidence("entry-accepted");
  const active = await registry.markActive(pending.session_id, {
    expectedRevision: 0,
    evidenceSha256: activeEvidence,
  });
  assert.equal(active.status, PAPER_SESSION_STATUSES.ACTIVE);
  assert.equal(active.revision, 1);
  assert.equal(active.ever_active, true);

  await assert.rejects(
    () => registry.markFrozen(active.session_id, {
      expectedRevision: 1,
      expectedRegistryRevision: 1,
      reason: "stale_registry_writer",
    }),
    /registry compare-and-swap conflict/,
  );
  await assert.rejects(
    () => registry.markFrozen(active.session_id, { expectedRevision: 0, reason: "stale_writer" }),
    /compare-and-swap conflict/,
  );
  const frozen = await registry.markFrozen(active.session_id, {
    expectedRevision: 1,
    expectedRegistryRevision: 2,
    reason: "readback_unavailable",
  });
  assert.equal(frozen.status, PAPER_SESSION_STATUSES.FROZEN);
  assert.deepEqual(await registry.loadOpen(), frozen);
  await assert.rejects(() => registry.createPending(secondInputs), /already open/);

  const restarted = new FilePaperSessionRegistry(directory, registrySecret, {
    now: () => fixedNow,
    certificateSigningSecret: certificateSecret,
  });
  const recovered = await restarted.markActive(frozen.session_id, {
    expectedRevision: 2,
    reason: "entry_reconciled_after_restart",
    evidenceSha256: evidence("recovered-entry"),
  });
  const closed = await restarted.markClosed(recovered.session_id, {
    expectedRevision: 3,
    reason: "exit_fill_reconciled",
    evidenceSha256: evidence("exit-filled"),
  });
  assert.equal(closed.status, PAPER_SESSION_STATUSES.CLOSED);
  assert.equal(closed.terminal_at, fixedNow.toISOString());
  assert.equal(await restarted.loadOpen(), null);

  const secondPending = await restarted.createPending(secondInputs);
  const absent = await restarted.markAbsent(secondPending.session_id, {
    expectedRevision: 0,
    reason: "pre_submit_order_absent",
    evidenceSha256: evidence("broker-query-absent"),
  });
  assert.equal(absent.status, PAPER_SESSION_STATUSES.ABSENT);
  assert.equal(absent.ever_active, false);
  assert.equal(await restarted.loadOpen(), null);

  const snapshot = await restarted.list();
  assert.equal(snapshot.revision, 7);
  assert.deepEqual(snapshot.sessions.map((session) => session.status), ["CLOSED", "ABSENT"]);
  assert.ok(snapshot.sessions.every((session) => TERMINAL_PAPER_SESSION_STATUSES.includes(session.status)));
  assert.ok(snapshot.sessions.every((session) => !NONTERMINAL_PAPER_SESSION_STATUSES.includes(session.status)));
});

test("terminal states require hashed proof and unsafe status claims never release the open-session lock", async (t) => {
  const { registry } = await temporaryRegistry(t, "terminals");
  const firstInputs = await paperSessionInputs("paper_session_registry_terminal_pending");
  const pending = await registry.createPending(firstInputs);

  await assert.rejects(
    () => registry.markClosed(pending.session_id, { expectedRevision: 0, evidenceSha256: evidence("not-active") }),
    /transition is unsafe/,
  );
  await assert.rejects(
    () => registry.markAbsent(pending.session_id, { expectedRevision: 0 }),
    /requires hashed reconciliation evidence/,
  );
  assert.equal((await registry.loadOpen()).status, "PENDING");

  const absent = await registry.markAbsent(pending.session_id, {
    expectedRevision: 0,
    evidenceSha256: evidence("confirmed-absent"),
  });
  await assert.rejects(
    () => registry.markActive(absent.session_id, { expectedRevision: 1, evidenceSha256: evidence("late-order") }),
    /transition is unsafe/,
  );

  const secondInputs = await paperSessionInputs("paper_session_registry_terminal_active");
  const second = await registry.createPending(secondInputs);
  const active = await registry.markActive(second.session_id, {
    expectedRevision: 0,
    evidenceSha256: evidence("accepted"),
  });
  await assert.rejects(
    () => registry.markAbsent(active.session_id, { expectedRevision: 1, evidenceSha256: evidence("unsafe-absence") }),
    /transition is unsafe/,
  );
  assert.equal((await registry.loadOpen()).status, "ACTIVE");
});

test("HMAC tampering, noncanonical storage, permission widening, and exact-schema violations fail closed", async (t) => {
  const { directory, registry } = await temporaryRegistry(t, "tamper");
  const inputs = await paperSessionInputs("paper_session_registry_tamper");
  await assert.rejects(
    () => registry.createPending({
      ...inputs,
      certificate: { ...inputs.certificate, account_id: "forbidden-account-identifier" },
    }),
    /missing or unknown fields/,
  );
  await assert.rejects(
    () => registry.createPending({
      ...inputs,
      entryProjection: { ...inputs.entryProjection, payload_sha256: sha256(inputs.entryProjection) },
    }),
    /missing or unknown fields/,
  );
  const pending = await registry.createPending(inputs);
  const filePath = join(directory, "paper-sessions.json");

  const tampered = JSON.parse(await readFile(filePath, "utf8"));
  tampered.sessions[0].status_reason = "forged_active";
  await writeFile(filePath, `${stableStringify(tampered)}\n`, { mode: 0o600 });
  await assert.rejects(() => registry.loadOpen(), /HMAC authentication failed/);

  const repaired = JSON.parse(await readFile(filePath, "utf8"));
  repaired.sessions[0].status_reason = pending.status_reason;
  repaired.sessions[0].unknown_field = "forged";
  const resigned = resignRegistry(repaired);
  await writeFile(filePath, `${stableStringify(resigned)}\n`, { mode: 0o600 });
  await assert.rejects(() => registry.loadOpen(), /missing or unknown fields/);

  delete repaired.sessions[0].unknown_field;
  const valid = resignRegistry(repaired);
  await writeFile(filePath, `${stableStringify(valid)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o644);
  await assert.rejects(() => registry.loadOpen(), /permissions are not owner-only/);
});

test("two creators racing on an empty registry can never create two nonterminal sessions", async (t) => {
  const { directory } = await temporaryRegistry(t, "race");
  const [leftInputs, rightInputs] = await Promise.all([
    paperSessionInputs("paper_session_registry_race_left"),
    paperSessionInputs("paper_session_registry_race_right"),
  ]);
  const left = new FilePaperSessionRegistry(directory, registrySecret, {
    now: () => fixedNow,
    certificateSigningSecret: certificateSecret,
  });
  const right = new FilePaperSessionRegistry(directory, registrySecret, {
    now: () => fixedNow,
    certificateSigningSecret: certificateSecret,
  });
  const outcomes = await Promise.allSettled([
    left.createPending(leftInputs),
    right.createPending(rightInputs),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const open = await new FilePaperSessionRegistry(directory, registrySecret, {
    now: () => fixedNow,
    certificateSigningSecret: certificateSecret,
  }).loadOpen();
  assert.ok(open);
  assert.equal((await left.list()).sessions.filter((session) => NONTERMINAL_PAPER_SESSION_STATUSES.includes(session.status)).length, 1);
});
