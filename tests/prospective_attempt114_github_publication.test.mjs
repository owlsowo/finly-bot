import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../lib/canonical.mjs";
import {
  ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH,
  ATTEMPT114_RUNTIME_SOURCE_PATHS,
} from "../research/prospective_attempt114/runtime.mjs";
import {
  ATTEMPT114_PUBLICATION_COLLECTION_SCHEMA,
  ATTEMPT114_PUBLICATION_HEAD_SHA,
  ATTEMPT114_PUBLICATION_POLICY,
  ATTEMPT114_PUBLICATION_RECEIPT_DIRECTORY,
  ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
  attempt114GitHubPublicationRequestPlan,
  attempt114PublicationReceiptPlan,
  canonicalAttempt114PublicationCollectionReceiptJson,
  collectAttempt114GitHubPublicationEvidence,
  parseAttempt114GitHubPublicationCli,
  publishAttempt114GitHubPublicationReceiptWriteOnce,
  validateAttempt114GitHubPublicationCollectionReceipt,
} from "../scripts/verify_attempt114_github_publication.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HTTP_DATE = "Sun, 30 Aug 2026 05:00:00 GMT";
const PUBLIC_RECEIPT_SHA256 =
  "sha256:a10099fa3931c9ef6d40446486744dde72f1efb5538515d03c015cd7c1a87fbb";
const PUBLIC_RECEIPT_RAW_BYTES_SHA256 =
  "sha256:de45561738de7be69d4b6bfa5da8848919756fc29682c42aa60dddb26d029360";
const PUBLIC_RECEIPT_PATH = `${ATTEMPT114_PUBLICATION_RECEIPT_DIRECTORY}/${PUBLIC_RECEIPT_SHA256.slice(7)}.json`;

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

function rehashCollectionReceipt(value) {
  const body = structuredClone(value);
  delete body.receipt_sha256;
  value.receipt_sha256 = sha256(body);
  return value;
}

function repositoryFixture() {
  return {
    id: 1_350_112_497,
    full_name: "owlsowo/finly-bot",
    private: false,
    visibility: "public",
    default_branch: "main",
    fork: false,
    archived: false,
    disabled: false,
  };
}

function commitFixture() {
  return {
    sha: ATTEMPT114_PUBLICATION_HEAD_SHA,
    html_url: `https://github.com/owlsowo/finly-bot/commit/${ATTEMPT114_PUBLICATION_HEAD_SHA}`,
    parents: [{ sha: "8".repeat(40) }],
    commit: { tree: { sha: "9".repeat(40) } },
  };
}

function workflowRunFixture() {
  const repository = {
    id: 1_350_112_497,
    full_name: "owlsowo/finly-bot",
    private: false,
  };
  return {
    id: ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
    workflow_id: 344_996_171,
    name: "Verify Finly",
    path: ".github/workflows/ci.yml",
    event: "push",
    head_branch: "main",
    head_sha: ATTEMPT114_PUBLICATION_HEAD_SHA,
    status: "completed",
    conclusion: "success",
    html_url: `https://github.com/owlsowo/finly-bot/actions/runs/${ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID}`,
    run_attempt: 1,
    created_at: "2026-08-30T04:41:05Z",
    updated_at: "2026-08-30T04:43:05Z",
    repository,
    head_repository: { ...repository },
  };
}

function workflowJobsFixture() {
  return {
    total_count: 1,
    jobs: [{
      id: 99_207_888_057,
      name: "verify",
      head_sha: ATTEMPT114_PUBLICATION_HEAD_SHA,
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-30T04:41:08Z",
      completed_at: "2026-08-30T04:43:05Z",
      steps: [
        {
          name: "Run npm run verify",
          number: 6,
          status: "completed",
          conclusion: "success",
          started_at: "2026-08-30T04:41:50Z",
          completed_at: "2026-08-30T04:43:00Z",
        },
        {
          name: "Generated receipts are committed and reproducible",
          number: 7,
          status: "completed",
          conclusion: "success",
          started_at: "2026-08-30T04:43:00Z",
          completed_at: "2026-08-30T04:43:01Z",
        },
      ],
    }],
  };
}

async function responseBodies() {
  const values = {
    repository: repositoryFixture(),
    publication_commit: commitFixture(),
    workflow_run: workflowRunFixture(),
    workflow_jobs: workflowJobsFixture(),
    workflow_file: await readFile(path.join(PROJECT_ROOT, ".github/workflows/ci.yml")),
    runtime_manifest: await readFile(path.join(PROJECT_ROOT,
      ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH)),
  };
  for (const sourcePath of ATTEMPT114_RUNTIME_SOURCE_PATHS) {
    values[`runtime_source:${sourcePath}`] = await readFile(path.join(PROJECT_ROOT, sourcePath));
  }
  return values;
}

function fakeResponse(url, bytes, { date = HTTP_DATE, responseUrl = url, status = 200 } = {}) {
  return {
    ok: status === 200,
    status,
    redirected: false,
    url: responseUrl,
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
  transformValues = (values) => values,
  transformResponse = (response) => response,
  calls = [],
} = {}) {
  const plan = attempt114GitHubPublicationRequestPlan();
  const original = await responseBodies();
  const values = transformValues(original);
  const byUrl = Object.fromEntries(plan.map((request) => [request.canonical_url, request]));
  return async (url, options) => {
    calls.push({ url, options });
    const request = byUrl[url];
    assert.ok(request, `unexpected URL: ${url}`);
    const value = values[request.request_id];
    const bytes = request.response_type === "json"
      ? Buffer.from(JSON.stringify(value), "utf8")
      : value;
    return transformResponse(fakeResponse(url, bytes), request);
  };
}

async function collectionFixture(options = {}) {
  return collectAttempt114GitHubPublicationEvidence({
    fetchImpl: await injectedFetch(options),
    projectRoot: PROJECT_ROOT,
  });
}

async function temporaryProject(t, prefix = "finly-attempt114-publication-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("checked-in Attempt 114 receipt is canonical, content-addressed, and independently revalidates", async () => {
  const bytes = await readFile(path.join(PROJECT_ROOT, PUBLIC_RECEIPT_PATH));
  const receipt = JSON.parse(bytes.toString("utf8"));
  validateAttempt114GitHubPublicationCollectionReceipt(receipt);
  assert.equal(receipt.receipt_sha256, PUBLIC_RECEIPT_SHA256);
  assert.equal(bytes.toString("utf8"),
    canonicalAttempt114PublicationCollectionReceiptJson(receipt));
  assert.equal(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    PUBLIC_RECEIPT_RAW_BYTES_SHA256,
  );
  assert.equal(receipt.github_public_get_evidence.request_count, 23);
  assert.equal(receipt.runtime_publication_receipt.workflow_run.created_at,
    "2026-08-30T04:41:05Z");
  assert.equal(receipt.runtime_publication_receipt.workflow_run.updated_at,
    "2026-08-30T04:43:05Z");
  assert.equal(receipt.runtime_publication_receipt.verification_observed_at,
    "2026-08-30T04:53:55.000Z");
  assert.equal(receipt.runtime_publication_receipt.assurance.independent_cryptographic_timestamp_verified,
    false);
  assert.equal(receipt.runtime_publication_receipt.assurance.provider_origin_verified, false);
});

test("Attempt 114 request plan is an exact, fixed, unauthenticated GET-only closure", async () => {
  const plan = attempt114GitHubPublicationRequestPlan();
  assert.equal(plan.length, 6 + ATTEMPT114_RUNTIME_SOURCE_PATHS.length);
  assert.equal(new Set(plan.map(({ request_id: requestId }) => requestId)).size, plan.length);
  assert.equal(new Set(plan.map(({ canonical_url: url }) => url)).size, plan.length);
  assert.deepEqual(new Set(plan.map(({ canonical_url: value }) => new URL(value).origin)), new Set([
    "https://api.github.com",
    "https://raw.githubusercontent.com",
  ]));
  assert.equal(plan.filter(({ response_type: responseType }) => responseType === "json").length, 4);
  assert.equal(plan.filter(({ response_type: responseType }) => responseType === "raw").length,
    2 + ATTEMPT114_RUNTIME_SOURCE_PATHS.length);
  assert.throws(() => attempt114GitHubPublicationRequestPlan({ headSha: "a".repeat(40) }),
    /only the frozen publication head/u);
  assertDeepFrozen(plan);

  const calls = [];
  const receipt = await collectionFixture({ calls });
  assert.equal(calls.length, plan.length);
  calls.forEach(({ url, options }, index) => {
    assert.equal(url, plan[index].canonical_url);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(Object.keys(options.headers).some((key) => /auth|token|cookie/iu.test(key)), false);
  });
  assert.equal(receipt.github_public_get_evidence.request_count, plan.length);
});

test("Attempt 114 collector verifies the remote runtime closure and preserves narrow assurance", async () => {
  const receipt = await collectionFixture();
  assert.equal(receipt.schema_version, ATTEMPT114_PUBLICATION_COLLECTION_SCHEMA);
  assert.equal(receipt.publication_head_sha, ATTEMPT114_PUBLICATION_HEAD_SHA);
  assert.equal(receipt.workflow_run_id, ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID);
  assert.equal(receipt.runtime_publication_receipt.verification_observed_at,
    "2026-08-30T05:00:00.000Z");
  assert.equal(receipt.runtime_publication_receipt.assurance.public_pre_deadline_publication_observed,
    true);
  assert.equal(receipt.runtime_publication_receipt.assurance.independent_cryptographic_timestamp_verified,
    false);
  assert.equal(receipt.runtime_publication_receipt.assurance.provider_origin_verified, false);
  assert.deepEqual(receipt.executing_local_closure, {
    runtime_manifest_matches_public_head: true,
    runtime_source_files_match_public_head: true,
    runtime_source_files_verified: ATTEMPT114_RUNTIME_SOURCE_PATHS.length,
    workflow_file_matches_public_head: true,
    workflow_file_sha256:
      "sha256:f23196c2cd6e070455395490e7fde6ad14b8ae31016771188269d85cb75e70e5",
  });
  assert.deepEqual(receipt.assurance, {
    fixed_unauthenticated_get_requests: true,
    no_credentials_sent: true,
    network_mutation_authorized: false,
    public_github_platform_record_only: true,
    self_contained_offline_evidence: false,
    independent_cryptographic_timestamp_verified: false,
    provider_origin_verified: false,
    broker_execution_verified: false,
    performance_inference_permitted: false,
    hostile_local_filesystem_race_resistant: false,
  });
  assert.equal(receipt.receipt_sha256, sha256(Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receipt_sha256"),
  )));
  assertDeepFrozen(receipt);
});

test("Attempt 114 collector fails closed on endpoint escape, metadata drift, and source drift", async () => {
  await assert.rejects(collectionFixture({
    transformResponse(response, request) {
      return request.request_id === "repository"
        ? { ...response, url: "https://example.com/repos/owlsowo/finly-bot" }
        : response;
    },
  }), /unexpected URL/u);

  await assert.rejects(collectionFixture({
    transformValues(values) {
      return {
        ...values,
        workflow_run: { ...values.workflow_run, head_sha: "a".repeat(40) },
      };
    },
  }), /workflow identity, linkage, or success gate/u);

  await assert.rejects(collectionFixture({
    transformValues(values) {
      return {
        ...values,
        workflow_jobs: {
          ...values.workflow_jobs,
          jobs: values.workflow_jobs.jobs.map((job) => ({ ...job, conclusion: "failure" })),
        },
      };
    },
  }), /verification job linkage or success gate/u);

  await assert.rejects(collectionFixture({
    transformValues(values) {
      return {
        ...values,
        "runtime_source:research/prospective_attempt114/inference.mjs": Buffer.from("tampered\n"),
      };
    },
  }), /public source differs from the executing local source/u);

  await assert.rejects(collectionFixture({
    transformValues(values) {
      return {
        ...values,
        workflow_file: Buffer.from("name: lookalike\n"),
      };
    },
  }), /public workflow bytes differ from the frozen verification workflow/u);
});

test("Attempt 114 collection receipt validation detects hash, request, and assurance forgery", async () => {
  const receipt = await collectionFixture();
  const wrongRequest = structuredClone(receipt);
  wrongRequest.github_public_get_evidence.responses[0].canonical_url =
    "https://api.github.com/repos/owlsowo/lookalike";
  rehashCollectionReceipt(wrongRequest);
  assert.throws(() => validateAttempt114GitHubPublicationCollectionReceipt(wrongRequest),
    /reordered or escaped/u);

  const wrongSourceHash = structuredClone(receipt);
  const sourceObservation = wrongSourceHash.github_public_get_evidence.responses.find(
    ({ request_id: requestId }) => requestId.endsWith("/inference.mjs"),
  );
  sourceObservation.response_bytes_sha256 = `sha256:${"0".repeat(64)}`;
  rehashCollectionReceipt(wrongSourceHash);
  assert.throws(() => validateAttempt114GitHubPublicationCollectionReceipt(wrongSourceHash),
    /source observation differs/u);

  for (const field of ["independent_cryptographic_timestamp_verified", "provider_origin_verified"]) {
    const overclaim = structuredClone(receipt);
    overclaim.assurance[field] = true;
    rehashCollectionReceipt(overclaim);
    assert.throws(() => validateAttempt114GitHubPublicationCollectionReceipt(overclaim),
      /assurance boundary/u);
  }

  const lateObservation = structuredClone(receipt);
  for (const response of lateObservation.github_public_get_evidence.responses) {
    response.github_http_date = "Tue, 01 Sep 2026 00:00:00 GMT";
  }
  lateObservation.runtime_publication_receipt.verification_observed_at =
    "2026-09-01T00:00:00.000Z";
  const runtimeBody = structuredClone(lateObservation.runtime_publication_receipt);
  delete runtimeBody.receipt_sha256;
  lateObservation.runtime_publication_receipt.receipt_sha256 = sha256(runtimeBody);
  rehashCollectionReceipt(lateObservation);
  assert.throws(() => validateAttempt114GitHubPublicationCollectionReceipt(lateObservation),
    /public-state observation was not strictly before/u);

  const wrongSelfHash = structuredClone(receipt);
  wrongSelfHash.receipt_sha256 = `sha256:${"f".repeat(64)}`;
  assert.throws(() => validateAttempt114GitHubPublicationCollectionReceipt(wrongSelfHash),
    /self-hash is invalid/u);
});

test("Attempt 114 receipt publisher is canonical, content-addressed, idempotent, and collision-safe", async (t) => {
  const receipt = await collectionFixture();
  const root = await temporaryProject(t);
  const first = await publishAttempt114GitHubPublicationReceiptWriteOnce(receipt, {
    projectRoot: root,
  });
  assert.equal(first.disposition, "created");
  assert.equal(first.receipt_sha256, receipt.receipt_sha256);
  const expectedPath = `${ATTEMPT114_PUBLICATION_RECEIPT_DIRECTORY}/${receipt.receipt_sha256.slice(7)}.json`;
  assert.equal(first.path, expectedPath);
  const absolutePath = path.join(root, first.path);
  assert.equal(await readFile(absolutePath, "utf8"),
    canonicalAttempt114PublicationCollectionReceiptJson(receipt));
  assert.equal((await lstat(absolutePath)).isFile(), true);
  const second = await publishAttempt114GitHubPublicationReceiptWriteOnce(receipt, {
    projectRoot: root,
  });
  assert.equal(second.disposition, "verified_existing");

  const collisionRoot = await temporaryProject(t, "finly-attempt114-collision-");
  const plan = attempt114PublicationReceiptPlan(receipt);
  const collisionPath = path.join(collisionRoot, plan.relativePath);
  await mkdir(path.dirname(collisionPath), { recursive: true });
  await writeFile(collisionPath, "different\n", "utf8");
  await assert.rejects(
    publishAttempt114GitHubPublicationReceiptWriteOnce(receipt, { projectRoot: collisionRoot }),
    /differs at the same content address|incorrectly addressed/u,
  );
});

test("Attempt 114 receipt publisher rejects symlinked directories and receipt targets", async (t) => {
  const receipt = await collectionFixture();
  const external = await temporaryProject(t, "finly-attempt114-external-");
  const directorySymlinkRoot = await temporaryProject(t, "finly-attempt114-dirlink-");
  await mkdir(path.join(directorySymlinkRoot, "research/prospective_attempt114"), {
    recursive: true,
  });
  await symlink(external, path.join(
    directorySymlinkRoot,
    ATTEMPT114_PUBLICATION_RECEIPT_DIRECTORY,
  ));
  await assert.rejects(
    publishAttempt114GitHubPublicationReceiptWriteOnce(receipt, {
      projectRoot: directorySymlinkRoot,
    }),
    /contains a symlink/u,
  );

  const targetSymlinkRoot = await temporaryProject(t, "finly-attempt114-targetlink-");
  const plan = attempt114PublicationReceiptPlan(receipt);
  const targetPath = path.join(targetSymlinkRoot, plan.relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const externalFile = path.join(external, "outside.json");
  await writeFile(externalFile, "outside\n", "utf8");
  await symlink(externalFile, targetPath);
  await assert.rejects(
    publishAttempt114GitHubPublicationReceiptWriteOnce(receipt, {
      projectRoot: targetSymlinkRoot,
    }),
    /cannot be safely verified/u,
  );
  assert.equal(await readFile(externalFile, "utf8"), "outside\n");
});

test("Attempt 114 CLI accepts only the frozen head/run and the collector exposes no remote mutation", async () => {
  assert.deepEqual(parseAttempt114GitHubPublicationCli([]), {
    headSha: ATTEMPT114_PUBLICATION_HEAD_SHA,
    workflowRunId: ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
  });
  assert.deepEqual(parseAttempt114GitHubPublicationCli([
    "--head-sha",
    ATTEMPT114_PUBLICATION_HEAD_SHA,
    "--run-id",
    String(ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID),
  ]), {
    headSha: ATTEMPT114_PUBLICATION_HEAD_SHA,
    workflowRunId: ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
  });
  assert.throws(() => parseAttempt114GitHubPublicationCli([
    "--head-sha", "a".repeat(40), "--run-id", String(ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID),
  ]), /only the frozen/u);
  assert.throws(() => parseAttempt114GitHubPublicationCli(["--run-id", "1"]), /usage/u);

  const source = await readFile(path.join(
    PROJECT_ROOT,
    "scripts/verify_attempt114_github_publication.mjs",
  ), "utf8");
  for (const forbidden of [
    /method:\s*["']POST["']/u,
    /method:\s*["']PUT["']/u,
    /method:\s*["']PATCH["']/u,
    /method:\s*["']DELETE["']/u,
    /authorization/iu,
    /place_order/u,
    /cancel_order/u,
    /replace_order/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.equal(ATTEMPT114_PUBLICATION_POLICY.publication_head_sha,
    ATTEMPT114_PUBLICATION_HEAD_SHA);
});
