import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../lib/canonical.mjs";
import {
  ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES,
  ATTEMPT116_ARTIFACTS,
  ATTEMPT116_GITHUB_PUBLICATION_POLICY,
  ATTEMPT116_PUBLICATION_DEADLINE,
  ATTEMPT116_PUBLICATION_HEAD_SHA,
  ATTEMPT116_PUBLICATION_PARENT_SHA,
  ATTEMPT116_PUBLICATION_RECEIPT_SCHEMA,
  ATTEMPT116_PUBLICATION_TREE_SHA,
  ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID,
  attempt116GitHubPublicationRequestPlan,
  canonicalAttempt116GitHubPublicationReceiptJson,
  collectAttempt116GitHubPublicationEvidence,
  parseAttempt116GitHubPublicationCli,
  publishAttempt116GitHubPublicationReceiptWriteOnce,
  validateAttempt116GitHubPublicationReceipt,
} from "../scripts/verify_attempt116_github_publication.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HTTP_DATE = "Sun, 30 Aug 2026 08:05:00 GMT";
const PUBLIC_RECEIPT_SHA256 =
  "sha256:934e52a583893e2720a0962195efd56b5f4b2a0554a1b8f8dfa9ab5951191362";
const PUBLIC_RECEIPT_RAW_BYTES_SHA256 =
  "sha256:1f959fd4245b7abd0c8eeeef2c4034623f93f68a691a9f80e0570c97ceab16ec";
const PUBLIC_RECEIPT_PATH = `research/prospective_attempt116/publication_receipts/${PUBLIC_RECEIPT_SHA256.slice(7)}.json`;

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

function repositoryFixture() {
  return {
    id: ATTEMPT116_GITHUB_PUBLICATION_POLICY.repository.id,
    full_name: ATTEMPT116_GITHUB_PUBLICATION_POLICY.repository.full_name,
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
    id: ATTEMPT116_GITHUB_PUBLICATION_POLICY.repository.id,
    full_name: ATTEMPT116_GITHUB_PUBLICATION_POLICY.repository.full_name,
    private: false,
  };
}

function commitFixture() {
  const commit = ATTEMPT116_GITHUB_PUBLICATION_POLICY.publication_commit;
  return {
    sha: ATTEMPT116_PUBLICATION_HEAD_SHA,
    html_url: `https://github.com/owlsowo/finly-bot/commit/${ATTEMPT116_PUBLICATION_HEAD_SHA}`,
    parents: [{ sha: ATTEMPT116_PUBLICATION_PARENT_SHA }],
    commit: {
      tree: { sha: ATTEMPT116_PUBLICATION_TREE_SHA },
      author: { date: commit.authored_at },
      committer: { date: commit.committed_at },
      message: commit.message,
    },
    files: ATTEMPT116_ARTIFACTS.map((artifact) => ({
      filename: artifact.path,
      sha: artifact.git_blob_sha,
      status: "added",
    })),
  };
}

function workflowRunFixture() {
  const workflow = ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow;
  return {
    id: ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID,
    workflow_id: workflow.id,
    name: workflow.name,
    path: workflow.path,
    event: "push",
    head_branch: "main",
    head_sha: ATTEMPT116_PUBLICATION_HEAD_SHA,
    run_attempt: workflow.run_attempt,
    status: "completed",
    conclusion: "success",
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
    html_url: `https://github.com/owlsowo/finly-bot/actions/runs/${workflow.run_id}`,
    repository: runRepositoryFixture(),
    head_repository: runRepositoryFixture(),
  };
}

function workflowJobsFixture() {
  const expected = ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.job;
  return {
    total_count: 1,
    jobs: [{
      id: expected.id,
      name: expected.name,
      head_sha: ATTEMPT116_PUBLICATION_HEAD_SHA,
      status: "completed",
      conclusion: "success",
      started_at: expected.started_at,
      completed_at: expected.completed_at,
      steps: expected.required_successful_steps.map((step) => ({
        ...step,
        status: "completed",
        conclusion: "success",
      })),
    }],
  };
}

async function responseBodies() {
  const values = {
    repository: repositoryFixture(),
    publication_commit: commitFixture(),
    workflow_run: workflowRunFixture(),
    workflow_jobs: workflowJobsFixture(),
    workflow_file: await readFile(path.join(
      PROJECT_ROOT,
      ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.path,
    )),
  };
  for (const artifact of ATTEMPT116_ARTIFACTS) {
    values[`artifact:${artifact.path}`] = await readFile(path.join(PROJECT_ROOT, artifact.path));
  }
  for (const dependency of ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES) {
    values[`additional_dependency:${dependency.path}`] = await readFile(
      path.join(PROJECT_ROOT, dependency.path),
    );
  }
  return values;
}

function fakeResponse(url, bytes, date = HTTP_DATE) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    url,
    headers: {
      get(name) {
        return name.toLowerCase() === "date" ? date : null;
      },
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function injectedFetch({
  calls = [],
  date = HTTP_DATE,
  transformValues = (value) => value,
  transformBytes = (request, bytes) => bytes,
} = {}) {
  const plan = attempt116GitHubPublicationRequestPlan();
  const values = transformValues(await responseBodies());
  const requests = Object.fromEntries(plan.map((request) => [request.canonical_url, request]));
  return async (url, options) => {
    calls.push({ url, options });
    const request = requests[url];
    assert.ok(request, `unexpected URL ${url}`);
    const original = request.response_type === "json"
      ? Buffer.from(JSON.stringify(values[request.request_id]), "utf8")
      : Buffer.from(values[request.request_id]);
    return fakeResponse(url, Buffer.from(transformBytes(request, original)), date);
  };
}

async function collectionFixture(options = {}) {
  return collectAttempt116GitHubPublicationEvidence({
    fetchImpl: await injectedFetch(options),
    projectRoot: PROJECT_ROOT,
  });
}

async function temporaryProject(t, prefix = "finly-attempt116-publication-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = [
    ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.path,
    ...ATTEMPT116_ARTIFACTS.map(({ path: artifactPath }) => artifactPath),
    ...ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES.map(
      ({ path: dependencyPath }) => dependencyPath,
    ),
  ];
  for (const sourcePath of paths) {
    const destination = path.join(root, sourcePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(PROJECT_ROOT, sourcePath)));
  }
  return root;
}

test("checked-in Attempt 116 receipt is canonical, addressed, and structurally revalidates", async () => {
  const bytes = await readFile(path.join(PROJECT_ROOT, PUBLIC_RECEIPT_PATH));
  const receipt = JSON.parse(bytes.toString("utf8"));
  validateAttempt116GitHubPublicationReceipt(receipt);
  assert.equal(receipt.receipt_sha256, PUBLIC_RECEIPT_SHA256);
  assert.equal(bytes.toString("utf8"), canonicalAttempt116GitHubPublicationReceiptJson(receipt));
  assert.equal(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    PUBLIC_RECEIPT_RAW_BYTES_SHA256,
  );
  assert.equal(receipt.github_public_get_evidence.request_count, 13);
  assert.equal(receipt.verification_observed_at, "2026-08-30T08:10:52.000Z");
  assert.equal(receipt.assurance.provider_timing_independent, false);
  assert.equal(receipt.assurance.independent_cryptographic_timestamp_verified, false);
});

test("Attempt 116 freezes exactly the protocol-declared seven public artifacts", async () => {
  const protocol = JSON.parse(await readFile(
    path.join(PROJECT_ROOT, "research/prospective_attempt116/protocol.json"),
    "utf8",
  ));
  assert.deepEqual(
    ATTEMPT116_ARTIFACTS.map(({ path: artifactPath }) => artifactPath),
    protocol.publication_boundary.required_artifact_paths,
  );
  assert.equal(protocol.publication_boundary.publication_deadline,
    ATTEMPT116_PUBLICATION_DEADLINE);
  assert.equal(protocol.publication_boundary.publication_deadline_exclusive, true);
  for (const artifact of ATTEMPT116_ARTIFACTS) {
    const bytes = await readFile(path.join(PROJECT_ROOT, artifact.path));
    assert.equal(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      artifact.raw_bytes_sha256,
    );
  }
  assert.equal(ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES.length, 1);
  assert.equal(ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES[0].path,
    "lib/canonical.mjs");
  const dependencyBytes = await readFile(path.join(
    PROJECT_ROOT,
    ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES[0].path,
  ));
  assert.equal(
    `sha256:${createHash("sha256").update(dependencyBytes).digest("hex")}`,
    ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES[0].raw_bytes_sha256,
  );
  assert.equal(protocol.publication_boundary.required_artifact_paths.includes(
    ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES[0].path,
  ), false);
  assertDeepFrozen(ATTEMPT116_ARTIFACTS);
  assertDeepFrozen(ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES);
});

test("Attempt 116 request plan and collection are fixed, unauthenticated, and GET-only", async () => {
  const plan = attempt116GitHubPublicationRequestPlan();
  assert.equal(plan.length, 13);
  assert.equal(new Set(plan.map(({ request_id: requestId }) => requestId)).size, plan.length);
  assert.equal(new Set(plan.map(({ canonical_url: url }) => url)).size, plan.length);
  assert.deepEqual(new Set(plan.map(({ canonical_url: url }) => new URL(url).origin)), new Set([
    "https://api.github.com",
    "https://raw.githubusercontent.com",
  ]));
  assert.equal(plan.filter(({ response_type: type }) => type === "json").length, 4);
  assert.equal(plan.filter(({ response_type: type }) => type === "raw").length, 9);
  assert.throws(() => attempt116GitHubPublicationRequestPlan({ headSha: "a".repeat(40) }),
    /only the frozen publication commit/u);
  assertDeepFrozen(plan);

  const calls = [];
  const receipt = await collectionFixture({ calls });
  assert.equal(calls.length, plan.length);
  calls.forEach(({ url, options }, index) => {
    assert.equal(url, plan[index].canonical_url);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(Object.keys(options.headers).some((key) => /auth|cookie|token/iu.test(key)), false);
  });
  assert.equal(receipt.github_public_get_evidence.request_count, plan.length);
});

test("Attempt 116 collector binds commit, CI, bytes, Date observations, and narrow assurance", async () => {
  const receipt = await collectionFixture();
  validateAttempt116GitHubPublicationReceipt(receipt);
  assert.equal(receipt.schema_version, ATTEMPT116_PUBLICATION_RECEIPT_SCHEMA);
  assert.equal(receipt.publication_commit.parent_sha, ATTEMPT116_PUBLICATION_PARENT_SHA);
  assert.equal(receipt.publication_commit.tree_sha, ATTEMPT116_PUBLICATION_TREE_SHA);
  assert.equal(receipt.publication_commit.committed_at, "2026-08-30T08:00:10Z");
  assert.equal(receipt.workflow_run.id, ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID);
  assert.equal(receipt.workflow_run.verification_job.id, 99_227_644_173);
  assert.equal(receipt.published_artifacts.length, 7);
  assert.equal(receipt.additional_commit_bound_dependencies.length, 1);
  assert.equal(receipt.additional_commit_bound_dependencies[0].path, "lib/canonical.mjs");
  assert.equal(receipt.verification_observed_at, "2026-08-30T08:05:00.000Z");
  assert.equal(receipt.executing_local_closure.required_artifacts_verified, 7);
  assert.equal(receipt.executing_local_closure.additional_dependencies_verified, 1);
  assert.equal(receipt.assurance.network_access_limited_to_public_github_gets, true);
  assert.equal(receipt.assurance.broker_or_market_data_network_accessed, false);
  assert.equal(receipt.assurance.provider_timing_independent, false);
  assert.equal(receipt.assurance.performance_inference_permitted, false);
  assert.equal(receipt.receipt_sha256, sha256(Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receipt_sha256"),
  )));
  const canonical = canonicalAttempt116GitHubPublicationReceiptJson(receipt);
  assert.deepEqual(JSON.parse(canonical), receipt);
  assert.equal(
    canonicalAttempt116GitHubPublicationReceiptJson(JSON.parse(canonical)),
    canonical,
  );
  assertDeepFrozen(receipt);
});

test("Attempt 116 collector fails closed on metadata, deadline, remote-byte, and local-byte drift", async (t) => {
  await assert.rejects(collectionFixture({
    transformValues(values) {
      return {
        ...values,
        publication_commit: {
          ...values.publication_commit,
          parents: [{ sha: "a".repeat(40) }],
        },
      };
    },
  }), /identity, parent, tree, or timestamp gate/u);

  await assert.rejects(collectionFixture({
    date: new Date(ATTEMPT116_PUBLICATION_DEADLINE).toUTCString(),
  }), /after CI and before the exclusive deadline/u);

  await assert.rejects(collectionFixture({
    transformBytes(request, bytes) {
      return request.request_id === `artifact:${ATTEMPT116_ARTIFACTS[0].path}`
        ? Buffer.concat([bytes, Buffer.from("\n")])
        : bytes;
    },
  }), /public artifact differs from executing local bytes/u);

  await assert.rejects(collectionFixture({
    transformBytes(request, bytes) {
      const dependency = ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES[0];
      return request.request_id === `additional_dependency:${dependency.path}`
        ? Buffer.concat([bytes, Buffer.from("\n")])
        : bytes;
    },
  }), /public additional dependency differs from executing local bytes/u);

  const projectRoot = await temporaryProject(t);
  await writeFile(path.join(projectRoot, ATTEMPT116_ARTIFACTS[0].path), "local drift\n", "utf8");
  await assert.rejects(collectAttempt116GitHubPublicationEvidence({
    projectRoot,
    fetchImpl: await injectedFetch(),
  }), /executing local artifact differs from its frozen hash/u);
});

test("Attempt 116 receipt publication is content-addressed, atomic, and write-once", async (t) => {
  const receipt = await collectionFixture();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "finly-attempt116-receipt-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const first = await publishAttempt116GitHubPublicationReceiptWriteOnce(receipt, {
    projectRoot: outputRoot,
  });
  const second = await publishAttempt116GitHubPublicationReceiptWriteOnce(receipt, {
    projectRoot: outputRoot,
  });
  assert.equal(first.disposition, "created");
  assert.equal(second.disposition, "verified_existing");
  assert.equal(first.receipt_sha256, receipt.receipt_sha256);
  assert.equal(await readFile(path.join(outputRoot, first.path), "utf8"),
    canonicalAttempt116GitHubPublicationReceiptJson(receipt));
  await writeFile(path.join(outputRoot, first.path), "tampered\n", "utf8");
  await assert.rejects(publishAttempt116GitHubPublicationReceiptWriteOnce(receipt, {
    projectRoot: outputRoot,
  }), /same content address|incorrectly addressed/u);
});

test("Attempt 116 receipt self-hash and CLI reject mutable or alternate identities", async () => {
  const receipt = await collectionFixture();
  const changed = structuredClone(receipt);
  changed.assurance.provider_timing_independent = true;
  assert.throws(() => validateAttempt116GitHubPublicationReceipt(changed),
    /assurance boundary|self-hash/u);
  assert.deepEqual(parseAttempt116GitHubPublicationCli([]), {
    headSha: ATTEMPT116_PUBLICATION_HEAD_SHA,
    workflowRunId: ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID,
  });
  assert.deepEqual(parseAttempt116GitHubPublicationCli([
    "--run-id", String(ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID),
    "--head-sha", ATTEMPT116_PUBLICATION_HEAD_SHA,
  ]), {
    headSha: ATTEMPT116_PUBLICATION_HEAD_SHA,
    workflowRunId: ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID,
  });
  assert.throws(() => parseAttempt116GitHubPublicationCli([
    "--head-sha", "a".repeat(40),
    "--run-id", String(ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID),
  ]), /only the frozen publication commit/u);
  assert.throws(() => parseAttempt116GitHubPublicationCli([
    "--head-sha", ATTEMPT116_PUBLICATION_HEAD_SHA,
    "--run-id", `0${ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID}`,
  ]), /canonical positive integer/u);
});

test("Attempt 116 canonical bytes are invariant to recursive key insertion order", async () => {
  const receipt = await collectionFixture();
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).reverse()
      .map(([key, item]) => [key, reverseKeys(item)]));
  };
  const reordered = reverseKeys(receipt);
  assert.equal(reordered.receipt_sha256, receipt.receipt_sha256);
  assert.equal(
    canonicalAttempt116GitHubPublicationReceiptJson(reordered),
    canonicalAttempt116GitHubPublicationReceiptJson(receipt),
  );
});

test("Attempt 116 receipt rejects CI-time equality and forged raw byte lengths after rehash", async () => {
  const receipt = await collectionFixture();
  const rehash = (value) => {
    value.receipt_sha256 = sha256(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "receipt_sha256"),
    ));
    return value;
  };
  const equalToCi = structuredClone(receipt);
  const ciDate = new Date(equalToCi.workflow_run.updated_at).toUTCString();
  for (const response of equalToCi.github_public_get_evidence.responses) {
    response.github_http_date = ciDate;
  }
  equalToCi.verification_observed_at = new Date(ciDate).toISOString();
  assert.throws(
    () => validateAttempt116GitHubPublicationReceipt(rehash(equalToCi)),
    /observed after CI/iu,
  );

  const badRawLength = structuredClone(receipt);
  const rawObservation = badRawLength.github_public_get_evidence.responses
    .find(({ request_id: requestId }) => requestId === "workflow_file");
  rawObservation.response_byte_length = 1;
  assert.throws(
    () => validateAttempt116GitHubPublicationReceipt(rehash(badRawLength)),
    /raw byte length differs/iu,
  );
});
