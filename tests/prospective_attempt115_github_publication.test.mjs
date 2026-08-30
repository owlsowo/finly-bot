import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildProspectiveAttempt115RuntimeManifest,
} from "../research/prospective_attempt115/runtime.mjs";
import {
  ATTEMPT115_GITHUB_PUBLICATION_POLICY,
  ATTEMPT115_PROTOCOL_REGISTRATION_HEAD_SHA,
  ATTEMPT115_PUBLICATION_DEADLINE,
  ATTEMPT115_RUNTIME_MANIFEST_PATH,
  attempt115GitHubPublicationRequestPlan,
  canonicalAttempt115GitHubPublicationReceiptJson,
  collectAttempt115GitHubPublicationEvidence,
  parseAttempt115GitHubPublicationCli,
  publishAttempt115GitHubPublicationReceiptWriteOnce,
  validateAttempt115GitHubPublicationReceipt,
} from "../scripts/verify_attempt115_github_publication.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HEAD_SHA = "a".repeat(40);
const RUN_ID = 33_300_000_115;
const HTTP_DATE = "Sun, 30 Aug 2026 10:00:00 GMT";

async function runtimeFixture() {
  return buildProspectiveAttempt115RuntimeManifest({
    frozen_at: "2026-08-30T09:00:00.000Z",
  }, { projectRoot: PROJECT_ROOT });
}

function repositoryFixture() {
  return {
    id: ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository.id,
    full_name: ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository.full_name,
    private: false,
    visibility: "public",
    default_branch: "main",
    fork: false,
    archived: false,
    disabled: false,
  };
}

function runRepositoryFixture() {
  return {
    id: ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository.id,
    full_name: ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository.full_name,
    private: false,
  };
}

function workflowRunFixture() {
  return {
    id: RUN_ID,
    workflow_id: ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.id,
    name: ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.name,
    path: ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path,
    event: "push",
    head_branch: "main",
    head_sha: HEAD_SHA,
    status: "completed",
    conclusion: "success",
    html_url: `https://github.com/owlsowo/finly-bot/actions/runs/${RUN_ID}`,
    run_attempt: 1,
    created_at: "2026-08-30T09:30:00Z",
    updated_at: "2026-08-30T09:40:00Z",
    repository: runRepositoryFixture(),
    head_repository: runRepositoryFixture(),
  };
}

function workflowJobsFixture() {
  return {
    total_count: 1,
    jobs: [{
      id: 99_300_000_115,
      name: ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.job_name,
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-30T09:30:01Z",
      completed_at: "2026-08-30T09:39:59Z",
      steps: [{
        name: ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps[0],
        number: 6,
        status: "completed",
        conclusion: "success",
        started_at: "2026-08-30T09:31:00Z",
        completed_at: "2026-08-30T09:39:00Z",
      }, {
        name: ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps[1],
        number: 7,
        status: "completed",
        conclusion: "success",
        started_at: "2026-08-30T09:39:01Z",
        completed_at: "2026-08-30T09:39:58Z",
      }],
    }],
  };
}

async function fixtureBytes(manifest) {
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const values = {
    repository: repositoryFixture(),
    publication_commit: {
      sha: HEAD_SHA,
      html_url: `https://github.com/owlsowo/finly-bot/commit/${HEAD_SHA}`,
      parents: [{ sha: ATTEMPT115_PROTOCOL_REGISTRATION_HEAD_SHA }],
      commit: { tree: { sha: "b".repeat(40) } },
    },
    workflow_run: workflowRunFixture(),
    workflow_jobs: workflowJobsFixture(),
    workflow_file: await readFile(path.join(
      PROJECT_ROOT,
      ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path,
    )),
    runtime_manifest: manifestBytes,
  };
  for (const sourcePath of Object.keys(manifest.runtime_source_files)) {
    if (sourcePath === ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path) continue;
    values[`runtime_source:${sourcePath}`] = await readFile(path.join(PROJECT_ROOT, sourcePath));
  }
  return values;
}

function fakeResponse(url, bytes, date = HTTP_DATE) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    url,
    headers: { get(name) { return name.toLowerCase() === "date" ? date : null; } },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function fetchFixture(manifest, {
  calls = [],
  date = HTTP_DATE,
  mutateResponseBytes = null,
} = {}) {
  const plan = attempt115GitHubPublicationRequestPlan({
    headSha: HEAD_SHA,
    workflowRunId: RUN_ID,
    runtimeManifest: manifest,
  });
  const values = await fixtureBytes(manifest);
  const requests = Object.fromEntries(plan.map((request) => [request.canonical_url, request]));
  return async (url, options) => {
    calls.push({ url, options });
    const request = requests[url];
    assert.ok(request, `unexpected URL ${url}`);
    const value = values[request.request_id];
    let bytes = request.response_type === "json"
      ? Buffer.from(JSON.stringify(value), "utf8")
      : Buffer.from(value);
    if (typeof mutateResponseBytes === "function") {
      bytes = Buffer.from(mutateResponseBytes(request, bytes));
    }
    return fakeResponse(url, bytes, date);
  };
}

async function temporaryProject(t, manifest) {
  const root = await mkdtemp(path.join(os.tmpdir(), "finly-attempt115-publication-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const required = new Set([
    ATTEMPT115_RUNTIME_MANIFEST_PATH,
    ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path,
    ...Object.keys(manifest.runtime_source_files),
  ]);
  for (const sourcePath of required) {
    const destination = path.join(root, sourcePath);
    await mkdir(path.dirname(destination), { recursive: true });
    const bytes = sourcePath === ATTEMPT115_RUNTIME_MANIFEST_PATH
      ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      : await readFile(path.join(PROJECT_ROOT, sourcePath));
    await writeFile(destination, bytes);
  }
  return root;
}

test("Attempt 115 request plan is immutable, exact, and unauthenticated GET-only", async () => {
  const manifest = await runtimeFixture();
  const plan = attempt115GitHubPublicationRequestPlan({
    headSha: HEAD_SHA,
    workflowRunId: RUN_ID,
    runtimeManifest: manifest,
  });
  assert.equal(plan.length, 5 + Object.keys(manifest.runtime_source_files).length);
  assert.equal(new Set(plan.map(({ request_id: requestId }) => requestId)).size, plan.length);
  assert.equal(new Set(plan.map(({ canonical_url: url }) => url)).size, plan.length);
  assert.deepEqual(new Set(plan.map(({ canonical_url: url }) => new URL(url).origin)), new Set([
    "https://api.github.com",
    "https://raw.githubusercontent.com",
  ]));
  assert.ok(plan.every(Object.isFrozen));
});

test("Attempt 115 collector binds the executing closure and refuses any remote mutation", async (t) => {
  const manifest = await runtimeFixture();
  const projectRoot = await temporaryProject(t, manifest);
  const calls = [];
  const receipt = await collectAttempt115GitHubPublicationEvidence({
    headSha: HEAD_SHA,
    workflowRunId: RUN_ID,
    projectRoot,
    fetchImpl: await fetchFixture(manifest, { calls }),
  });
  validateAttempt115GitHubPublicationReceipt(receipt);
  assert.equal(receipt.exclusive_deadline, ATTEMPT115_PUBLICATION_DEADLINE);
  assert.equal(receipt.publication_commit.parent_sha,
    ATTEMPT115_PROTOCOL_REGISTRATION_HEAD_SHA);
  assert.equal(receipt.executing_local_closure.executing_verifier_matches_public_head, true);
  assert.equal(receipt.assurance.performance_inference_permitted, false);
  assert.equal(calls.length, 5 + Object.keys(manifest.runtime_source_files).length);
  for (const { options } of calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(Object.keys(options.headers).some((key) => /auth|cookie|token/iu.test(key)), false);
  }
  assert.equal(canonicalAttempt115GitHubPublicationReceiptJson(receipt),
    `${JSON.stringify(receipt, null, 2)}\n`);
});

test("Attempt 115 collector fails closed when public observation reaches the deadline", async (t) => {
  const manifest = await runtimeFixture();
  const projectRoot = await temporaryProject(t, manifest);
  await assert.rejects(collectAttempt115GitHubPublicationEvidence({
    headSha: HEAD_SHA,
    workflowRunId: RUN_ID,
    projectRoot,
    fetchImpl: await fetchFixture(manifest, {
      date: new Date(ATTEMPT115_PUBLICATION_DEADLINE).toUTCString(),
    }),
  }), /before the deadline|strict post-CI/iu);
});

test("Attempt 115 collector rejects remote or executing-local source-byte drift", async (t) => {
  const manifest = await runtimeFixture();
  const remoteRoot = await temporaryProject(t, manifest);
  await assert.rejects(collectAttempt115GitHubPublicationEvidence({
    headSha: HEAD_SHA,
    workflowRunId: RUN_ID,
    projectRoot: remoteRoot,
    fetchImpl: await fetchFixture(manifest, {
      mutateResponseBytes(request, bytes) {
        return request.request_id === "runtime_source:scripts/verify_attempt115_github_publication.mjs"
          ? Buffer.concat([bytes, Buffer.from("\n")])
          : bytes;
      },
    }),
  }), /public source differs/iu);

  const localRoot = await temporaryProject(t, manifest);
  await writeFile(path.join(localRoot, "scripts/verify_attempt115_github_publication.mjs"),
    "// local mutation\n", "utf8");
  await assert.rejects(collectAttempt115GitHubPublicationEvidence({
    headSha: HEAD_SHA,
    workflowRunId: RUN_ID,
    projectRoot: localRoot,
    fetchImpl: await fetchFixture(manifest),
  }), /executing local source differs/iu);
});

test("Attempt 115 receipt publication is content-addressed and idempotent", async (t) => {
  const manifest = await runtimeFixture();
  const projectRoot = await temporaryProject(t, manifest);
  const receipt = await collectAttempt115GitHubPublicationEvidence({
    headSha: HEAD_SHA,
    workflowRunId: RUN_ID,
    projectRoot,
    fetchImpl: await fetchFixture(manifest),
  });
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "finly-attempt115-receipt-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const first = await publishAttempt115GitHubPublicationReceiptWriteOnce(receipt, {
    projectRoot: outputRoot,
  });
  const second = await publishAttempt115GitHubPublicationReceiptWriteOnce(receipt, {
    projectRoot: outputRoot,
  });
  assert.equal(first.disposition, "created");
  assert.equal(second.disposition, "verified_existing");
  assert.equal(await readFile(path.join(outputRoot, first.path), "utf8"),
    canonicalAttempt115GitHubPublicationReceiptJson(receipt));
  await writeFile(path.join(outputRoot, first.path), "tampered\n", "utf8");
  await assert.rejects(publishAttempt115GitHubPublicationReceiptWriteOnce(receipt, {
    projectRoot: outputRoot,
  }), /same content address|incorrectly addressed/iu);
});

test("Attempt 115 receipt self-hash rejects post-collection success-flag mutation", async (t) => {
  const manifest = await runtimeFixture();
  const projectRoot = await temporaryProject(t, manifest);
  const receipt = await collectAttempt115GitHubPublicationEvidence({
    headSha: HEAD_SHA,
    workflowRunId: RUN_ID,
    projectRoot,
    fetchImpl: await fetchFixture(manifest),
  });
  const changed = structuredClone(receipt);
  changed.assurance.performance_inference_permitted = true;
  assert.throws(() => validateAttempt115GitHubPublicationReceipt(changed),
    /assurance boundary|self-hash/iu);
});

test("Attempt 115 CLI accepts dynamic immutable identifiers and rejects malformed input", () => {
  assert.deepEqual(parseAttempt115GitHubPublicationCli([
    "--head-sha", HEAD_SHA, "--run-id", String(RUN_ID),
  ]), { headSha: HEAD_SHA, workflowRunId: RUN_ID });
  assert.throws(() => parseAttempt115GitHubPublicationCli([]), /usage/iu);
  assert.throws(() => parseAttempt115GitHubPublicationCli([
    "--head-sha", "bad", "--run-id", String(RUN_ID),
  ]), /40-character/iu);
});
