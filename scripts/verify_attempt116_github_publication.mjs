import { createHash, randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sha256, stableStringify } from "../lib/canonical.mjs";

export const ATTEMPT116_ID = "finly_prospective_options_shadow_attempt_116";
export const ATTEMPT116_PUBLICATION_RECEIPT_SCHEMA =
  "finly_attempt116_github_public_registration_receipt.v1";
export const ATTEMPT116_PUBLICATION_DEADLINE = "2026-08-31T13:30:00.000Z";
export const ATTEMPT116_PUBLICATION_HEAD_SHA =
  "a46ee3d2f9fc4ecbf1fc159fb20e56b0708a009f";
export const ATTEMPT116_PUBLICATION_PARENT_SHA =
  "8cf491958e26e9da7e35c9c5c1d0d9dce2680b6a";
export const ATTEMPT116_PUBLICATION_TREE_SHA =
  "e3f5e9f71d3a9fb387ec81605e75fcd0c845bd91";
export const ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID = 33_300_509_077;
export const ATTEMPT116_PUBLICATION_RECEIPT_DIRECTORY =
  "research/prospective_attempt116/publication_receipts";
export const ATTEMPT116_PROTOCOL_SHA256 =
  "sha256:8703b78afabe6cfe39d981ed1399878ba219b8f92100982c43e2c88e24c5a677";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const ATTEMPT116_ARTIFACTS = deepFreeze([
  {
    path: "research/prospective_attempt116/SOURCE_ATTRIBUTION.md",
    git_blob_sha: "1ae70e2edf69c6e7e1cfa43ff00b9aa1f159b034",
    raw_bytes_sha256:
      "sha256:7aa465ae3565c5a9670aa8287ed0add1e96aace83870ec6aa919ff4212a14d26",
  },
  {
    path: "research/prospective_attempt116/UPSTREAM_LICENSE.txt",
    git_blob_sha: "6da5b634b3a2a4fb9e3455fd6a7db02dbc81e692",
    raw_bytes_sha256:
      "sha256:97ed157640064056357c7edceb8aeed5db11577dbdd381bdb556759d80ef9935",
  },
  {
    path: "research/prospective_attempt116/protocol.json",
    git_blob_sha: "2f73bfd6eb3ef880c533fa263e032c423a1652eb",
    raw_bytes_sha256:
      "sha256:3baa380e02f982d1c0c892357cded0e24ad311c2e73c1c1cc38d1d1b5d1501a2",
  },
  {
    path: "research/prospective_attempt116/protocol.mjs",
    git_blob_sha: "2d0998d6d72d478ecb7f05de502fe70190029431",
    raw_bytes_sha256:
      "sha256:780ddb8aa3e3e8d48c7d75e8796db49aed8f111c9ad2eec271df6d09a390a27c",
  },
  {
    path: "research/prospective_attempt116/signal.mjs",
    git_blob_sha: "da898cc83ab6d23dbb58917fe9d447baf083f902",
    raw_bytes_sha256:
      "sha256:0028e1dc7965776d3bc4e0e79727eeb4fa4107f8496c677f7ad77b3511326dfb",
  },
  {
    path: "tests/prospective_attempt116_protocol.test.mjs",
    git_blob_sha: "fc275ad3e97ae147812196764aaba5b35a7ce09b",
    raw_bytes_sha256:
      "sha256:b8c07d139f96be622c7e22fc3977f4ab207b338bd7059d1dd522028f9736025f",
  },
  {
    path: "tests/prospective_attempt116_signal.test.mjs",
    git_blob_sha: "79962c510be16902e17608b83383093bd6cbdc33",
    raw_bytes_sha256:
      "sha256:805a53cdaa77b03e573c34c80210e6028446d20d0371e540d9b379c8ae34643b",
  },
]);

export const ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES = deepFreeze([
  {
    path: "lib/canonical.mjs",
    git_blob_sha: "d1765487f84bc94f55046a0a9ba6bf5f04f45899",
    raw_bytes_sha256:
      "sha256:05d7803cff866893f3c97e3b15ee49cbd46eb2376c63a06fe142f8589a7e0904",
  },
]);

const ATTEMPT116_FIXED_RAW_BYTE_LENGTHS = deepFreeze({
  workflow_file: 614,
  "artifact:research/prospective_attempt116/SOURCE_ATTRIBUTION.md": 4_511,
  "artifact:research/prospective_attempt116/UPSTREAM_LICENSE.txt": 1_182,
  "artifact:research/prospective_attempt116/protocol.json": 8_993,
  "artifact:research/prospective_attempt116/protocol.mjs": 16_577,
  "artifact:research/prospective_attempt116/signal.mjs": 24_101,
  "artifact:tests/prospective_attempt116_protocol.test.mjs": 6_307,
  "artifact:tests/prospective_attempt116_signal.test.mjs": 17_645,
  "additional_dependency:lib/canonical.mjs": 1_465,
});

export const ATTEMPT116_GITHUB_PUBLICATION_POLICY = deepFreeze({
  api_origin: "https://api.github.com",
  raw_origin: "https://raw.githubusercontent.com",
  api_version: "2022-11-28",
  repository: {
    id: 1_350_112_497,
    full_name: "owlsowo/finly-bot",
    default_branch: "main",
  },
  publication_commit: {
    sha: ATTEMPT116_PUBLICATION_HEAD_SHA,
    parent_sha: ATTEMPT116_PUBLICATION_PARENT_SHA,
    tree_sha: ATTEMPT116_PUBLICATION_TREE_SHA,
    authored_at: "2026-08-30T08:00:10Z",
    committed_at: "2026-08-30T08:00:10Z",
    message: "research: preregister volatility-risk-premium shadow",
  },
  workflow: {
    id: 344_996_171,
    name: "Verify Finly",
    path: ".github/workflows/ci.yml",
    file_sha256:
      "sha256:f23196c2cd6e070455395490e7fde6ad14b8ae31016771188269d85cb75e70e5",
    run_id: ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID,
    run_attempt: 1,
    created_at: "2026-08-30T08:00:16Z",
    updated_at: "2026-08-30T08:02:00Z",
    job: {
      id: 99_227_644_173,
      name: "verify",
      started_at: "2026-08-30T08:00:19Z",
      completed_at: "2026-08-30T08:01:59Z",
      required_successful_steps: [
        {
          name: "Run npm run verify",
          number: 6,
          started_at: "2026-08-30T08:00:44Z",
          completed_at: "2026-08-30T08:01:57Z",
        },
        {
          name: "Generated receipts are committed and reproducible",
          number: 7,
          started_at: "2026-08-30T08:01:57Z",
          completed_at: "2026-08-30T08:01:58Z",
        },
      ],
    },
  },
});

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const RECEIPT_FILENAME = /^([0-9a-f]{64})\.json$/u;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_RAW_BYTES = 4 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exact(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function commitSha(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(`${label} must be a lowercase 40-character commit SHA`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive safe integer`);
  }
  return value;
}

function githubInstant(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be a canonical GitHub UTC timestamp`);
  }
  const normalized = new Date(value).toISOString();
  if (value !== normalized && value !== normalized.replace(".000Z", "Z")) {
    fail(`${label} must be a canonical GitHub UTC timestamp`);
  }
  return value;
}

function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail(`${label} must be a canonical UTC instant`);
  }
  return value;
}

function githubHttpDate(value, label) {
  if (typeof value !== "string" || value.length > 64) fail(`${label} must be an HTTP Date`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toUTCString() !== value) {
    fail(`${label} must be a canonical HTTP Date`);
  }
  return value;
}

function rawBytesSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function boundedBytes(value, label, maximum = MAX_RAW_BYTES) {
  if (!Buffer.isBuffer(value) && typeof value !== "string") {
    fail(`${label} must be bytes or text`);
  }
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (bytes.length < 1 || bytes.length > maximum) {
    fail(`${label} must contain between 1 and ${maximum} bytes`);
  }
  return bytes;
}

function safeRepositoryPath(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512
    || path.posix.isAbsolute(value) || path.posix.normalize(value) !== value
    || value.startsWith("../") || value.includes("/../") || value.includes("//")) {
    fail(`${label} must be a safe repository-relative path`);
  }
  return value;
}

function encodeRepositoryPath(value) {
  return value.split("/").map((component) => encodeURIComponent(component)).join("/");
}

function apiUrl(route) {
  const url = new URL(route, ATTEMPT116_GITHUB_PUBLICATION_POLICY.api_origin);
  if (url.origin !== ATTEMPT116_GITHUB_PUBLICATION_POLICY.api_origin
    || url.protocol !== "https:") {
    fail("Attempt 116 GitHub API route escaped the fixed HTTPS origin");
  }
  return url.href;
}

function rawUrl(sourcePath) {
  safeRepositoryPath(sourcePath, "Attempt 116 public raw path");
  const encoded = encodeRepositoryPath(sourcePath);
  const route = `/owlsowo/finly-bot/${ATTEMPT116_PUBLICATION_HEAD_SHA}/${encoded}`;
  const url = new URL(route, ATTEMPT116_GITHUB_PUBLICATION_POLICY.raw_origin);
  if (url.origin !== ATTEMPT116_GITHUB_PUBLICATION_POLICY.raw_origin
    || url.protocol !== "https:") {
    fail("Attempt 116 raw GitHub route escaped the fixed HTTPS origin");
  }
  return url.href;
}

function assertFrozenIdentifiers(headSha, workflowRunId) {
  if (headSha !== ATTEMPT116_PUBLICATION_HEAD_SHA
    || workflowRunId !== ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID) {
    fail("Attempt 116 accepts only the frozen publication commit and workflow run");
  }
}

function fixedRequests() {
  return [
    {
      request_id: "repository",
      response_type: "json",
      canonical_url: apiUrl("/repos/owlsowo/finly-bot"),
    },
    {
      request_id: "publication_commit",
      response_type: "json",
      canonical_url: apiUrl(
        `/repos/owlsowo/finly-bot/commits/${ATTEMPT116_PUBLICATION_HEAD_SHA}?per_page=100&page=1`,
      ),
    },
    {
      request_id: "workflow_run",
      response_type: "json",
      canonical_url: apiUrl(
        `/repos/owlsowo/finly-bot/actions/runs/${ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID}`,
      ),
    },
    {
      request_id: "workflow_jobs",
      response_type: "json",
      canonical_url: apiUrl(
        `/repos/owlsowo/finly-bot/actions/runs/${ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID}/jobs?per_page=100`,
      ),
    },
    {
      request_id: "workflow_file",
      response_type: "raw",
      canonical_url: rawUrl(ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.path),
    },
    ...ATTEMPT116_ARTIFACTS.map((artifact) => ({
      request_id: `artifact:${artifact.path}`,
      response_type: "raw",
      canonical_url: rawUrl(artifact.path),
    })),
    ...ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES.map((dependency) => ({
      request_id: `additional_dependency:${dependency.path}`,
      response_type: "raw",
      canonical_url: rawUrl(dependency.path),
    })),
  ];
}

export function attempt116GitHubPublicationRequestPlan({
  headSha = ATTEMPT116_PUBLICATION_HEAD_SHA,
  workflowRunId = ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID,
} = {}) {
  assertFrozenIdentifiers(headSha, workflowRunId);
  return deepFreeze(fixedRequests().map((request) => ({ ...request })));
}

async function githubGet(request, fetchImpl, registry) {
  exact(request, ["request_id", "response_type", "canonical_url"],
    "Attempt 116 fixed GitHub request");
  const expected = registry.find(({ request_id: requestId }) => requestId === request.request_id);
  if (!expected || stableStringify(expected) !== stableStringify(request)) {
    fail("Attempt 116 GitHub request differs from the fixed request registry");
  }
  const url = new URL(request.canonical_url);
  if (!new Set([
    ATTEMPT116_GITHUB_PUBLICATION_POLICY.api_origin,
    ATTEMPT116_GITHUB_PUBLICATION_POLICY.raw_origin,
  ]).has(url.origin) || url.protocol !== "https:") {
    fail("Attempt 116 GitHub request escaped the allowlisted HTTPS origins");
  }
  const headers = {
    accept: request.response_type === "json"
      ? "application/vnd.github+json"
      : "application/octet-stream",
    "user-agent": "finly-attempt116-publication-verifier/1.0",
  };
  if (request.response_type === "json") {
    headers["x-github-api-version"] = ATTEMPT116_GITHUB_PUBLICATION_POLICY.api_version;
  }
  let response;
  try {
    response = await fetchImpl(request.canonical_url, {
      method: "GET",
      redirect: "error",
      headers,
    });
  } catch {
    fail(`Attempt 116 public GET failed: ${request.request_id}`);
  }
  if (!response || response.ok !== true || response.status !== 200) {
    fail(`Attempt 116 public GET did not return HTTP 200: ${request.request_id}`);
  }
  if (response.redirected === true || response.url !== request.canonical_url) {
    fail(`Attempt 116 public GET returned from an unexpected URL: ${request.request_id}`);
  }
  const dateHeader = response.headers?.get?.("date");
  githubHttpDate(dateHeader, `Attempt 116 public GET ${request.request_id} Date header`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const maximum = request.response_type === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES;
  boundedBytes(bytes, `Attempt 116 public GET ${request.request_id}`, maximum);
  let value = bytes;
  if (request.response_type === "json") {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(`Attempt 116 public GET is not valid JSON: ${request.request_id}`);
    }
  }
  return {
    request,
    bytes,
    value,
    observation: {
      request_id: request.request_id,
      canonical_url: request.canonical_url,
      github_http_date: dateHeader,
      response_byte_length: bytes.length,
      response_bytes_sha256: rawBytesSha256(bytes),
    },
  };
}

function validateRepository(value) {
  plainObject(value, "Attempt 116 GitHub repository response");
  const expected = ATTEMPT116_GITHUB_PUBLICATION_POLICY.repository;
  if (value.id !== expected.id || value.full_name !== expected.full_name
    || value.private !== false || value.visibility !== "public"
    || value.default_branch !== expected.default_branch || value.fork !== false
    || value.archived !== false || value.disabled !== false) {
    fail("Attempt 116 GitHub repository identity or public-state gate failed");
  }
  return value;
}

function validateCommit(value) {
  plainObject(value, "Attempt 116 GitHub commit response");
  const expected = ATTEMPT116_GITHUB_PUBLICATION_POLICY.publication_commit;
  if (value.sha !== expected.sha
    || value.html_url !== `https://github.com/owlsowo/finly-bot/commit/${expected.sha}`
    || !Array.isArray(value.parents) || value.parents.length !== 1
    || value.parents[0]?.sha !== expected.parent_sha
    || value.commit?.tree?.sha !== expected.tree_sha
    || value.commit?.author?.date !== expected.authored_at
    || value.commit?.committer?.date !== expected.committed_at
    || value.commit?.message !== expected.message) {
    fail("Attempt 116 publication commit identity, parent, tree, or timestamp gate failed");
  }
  if (!Array.isArray(value.files) || value.files.length !== ATTEMPT116_ARTIFACTS.length) {
    fail("Attempt 116 publication commit does not contain exactly seven artifact changes");
  }
  const observedArtifacts = value.files.map((file) => ({
    path: file?.filename,
    git_blob_sha: file?.sha,
    status: file?.status,
  }));
  const expectedArtifacts = ATTEMPT116_ARTIFACTS.map((artifact) => ({
    path: artifact.path,
    git_blob_sha: artifact.git_blob_sha,
    status: "added",
  }));
  if (stableStringify(observedArtifacts) !== stableStringify(expectedArtifacts)) {
    fail("Attempt 116 publication commit artifact paths or Git blob identities differ");
  }
  commitSha(value.sha, "Attempt 116 publication commit SHA");
  commitSha(value.parents[0].sha, "Attempt 116 publication parent SHA");
  commitSha(value.commit.tree.sha, "Attempt 116 publication tree SHA");
  githubInstant(value.commit.author.date, "Attempt 116 publication authored_at");
  githubInstant(value.commit.committer.date, "Attempt 116 publication committed_at");
  if (Date.parse(value.commit.author.date) >= Date.parse(ATTEMPT116_PUBLICATION_DEADLINE)
    || Date.parse(value.commit.committer.date) >= Date.parse(ATTEMPT116_PUBLICATION_DEADLINE)) {
    fail("Attempt 116 publication commit timestamps do not precede the deadline");
  }
  return value;
}

function validateWorkflowRun(value) {
  plainObject(value, "Attempt 116 GitHub workflow-run response");
  const expected = ATTEMPT116_GITHUB_PUBLICATION_POLICY;
  if (value.id !== expected.workflow.run_id || value.workflow_id !== expected.workflow.id
    || value.name !== expected.workflow.name || value.path !== expected.workflow.path
    || value.event !== "push" || value.head_branch !== expected.repository.default_branch
    || value.head_sha !== expected.publication_commit.sha || value.run_attempt !== 1
    || value.status !== "completed" || value.conclusion !== "success"
    || value.created_at !== expected.workflow.created_at
    || value.updated_at !== expected.workflow.updated_at
    || value.html_url
      !== `https://github.com/owlsowo/finly-bot/actions/runs/${expected.workflow.run_id}`) {
    fail("Attempt 116 GitHub workflow identity, linkage, timing, or success gate failed");
  }
  githubInstant(value.created_at, "Attempt 116 workflow created_at");
  githubInstant(value.updated_at, "Attempt 116 workflow updated_at");
  if (Date.parse(value.created_at) < Date.parse(expected.publication_commit.committed_at)
    || Date.parse(value.updated_at) < Date.parse(value.created_at)
    || Date.parse(value.updated_at) >= Date.parse(ATTEMPT116_PUBLICATION_DEADLINE)) {
    fail("Attempt 116 GitHub workflow timestamps are invalid");
  }
  for (const label of ["repository", "head_repository"]) {
    const repository = plainObject(value[label], `Attempt 116 workflow ${label}`);
    if (repository.id !== expected.repository.id
      || repository.full_name !== expected.repository.full_name
      || repository.private !== false) {
      fail(`Attempt 116 workflow ${label} identity gate failed`);
    }
  }
  return value;
}

function validateWorkflowJobs(value, run) {
  plainObject(value, "Attempt 116 GitHub jobs response");
  if (!Array.isArray(value.jobs) || value.total_count !== 1 || value.jobs.length !== 1) {
    fail("Attempt 116 GitHub jobs response must contain exactly one job");
  }
  const expected = ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.job;
  const job = plainObject(value.jobs[0], "Attempt 116 GitHub verification job");
  if (job.id !== expected.id || job.name !== expected.name || job.head_sha !== run.head_sha
    || job.status !== "completed" || job.conclusion !== "success"
    || job.started_at !== expected.started_at || job.completed_at !== expected.completed_at
    || !Array.isArray(job.steps)) {
    fail("Attempt 116 GitHub verification job identity, linkage, timing, or success gate failed");
  }
  githubInstant(job.started_at, "Attempt 116 verification job started_at");
  githubInstant(job.completed_at, "Attempt 116 verification job completed_at");
  if (Date.parse(job.started_at) < Date.parse(run.created_at)
    || Date.parse(job.completed_at) < Date.parse(job.started_at)
    || Date.parse(job.completed_at) > Date.parse(run.updated_at)) {
    fail("Attempt 116 GitHub verification job timestamps are invalid");
  }
  const requiredSteps = expected.required_successful_steps.map((required) => {
    const matches = job.steps.filter(({ name }) => name === required.name);
    if (matches.length !== 1) {
      fail(`Attempt 116 required workflow step is absent or ambiguous: ${required.name}`);
    }
    const step = plainObject(matches[0], `Attempt 116 required workflow step ${required.name}`);
    if (step.number !== required.number || step.status !== "completed"
      || step.conclusion !== "success" || step.started_at !== required.started_at
      || step.completed_at !== required.completed_at) {
      fail(`Attempt 116 required workflow step identity, timing, or success differs: ${required.name}`);
    }
    githubInstant(step.started_at, `Attempt 116 workflow step started_at: ${required.name}`);
    githubInstant(step.completed_at, `Attempt 116 workflow step completed_at: ${required.name}`);
    if (Date.parse(step.started_at) < Date.parse(job.started_at)
      || Date.parse(step.completed_at) < Date.parse(step.started_at)
      || Date.parse(step.completed_at) > Date.parse(job.completed_at)) {
      fail(`Attempt 116 required workflow step timing is invalid: ${required.name}`);
    }
    return {
      name: step.name,
      number: step.number,
      status: step.status,
      conclusion: step.conclusion,
      started_at: step.started_at,
      completed_at: step.completed_at,
    };
  });
  return { job, requiredSteps };
}

async function readRegularFileWithoutSymlink(projectRoot, relativePath) {
  safeRepositoryPath(relativePath, "Attempt 116 local artifact path");
  const rootStatus = await lstat(projectRoot).catch(() => fail("Attempt 116 project root is missing"));
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("Attempt 116 project root must be a real directory");
  }
  const root = await realpath(projectRoot);
  let cursor = root;
  const components = relativePath.split("/");
  for (const [index, component] of components.entries()) {
    cursor = path.join(cursor, component);
    const status = await lstat(cursor);
    if (status.isSymbolicLink()) fail(`${relativePath} traverses a symbolic link`);
    if (index < components.length - 1 && !status.isDirectory()) {
      fail(`${relativePath} has a non-directory parent`);
    }
    if (index === components.length - 1 && !status.isFile()) {
      fail(`${relativePath} is not a regular file`);
    }
  }
  let handle;
  try {
    handle = await open(cursor, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile()) fail(`${relativePath} did not open as a regular file`);
    const bytes = await handle.readFile();
    const finalStatus = await lstat(cursor);
    if (finalStatus.isSymbolicLink() || !finalStatus.isFile()
      || finalStatus.dev !== openedStatus.dev || finalStatus.ino !== openedStatus.ino
      || await realpath(cursor) !== cursor) {
      fail(`${relativePath} changed identity while it was read`);
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function validateProtocolArtifact(bytes) {
  let protocol;
  try {
    protocol = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Attempt 116 protocol artifact is not valid JSON");
  }
  const boundary = plainObject(protocol.publication_boundary,
    "Attempt 116 protocol publication boundary");
  if (protocol.attempt_id !== ATTEMPT116_ID
    || protocol.protocol_sha256 !== ATTEMPT116_PROTOCOL_SHA256
    || boundary.publication_deadline !== ATTEMPT116_PUBLICATION_DEADLINE
    || boundary.publication_deadline_exclusive !== true
    || stableStringify(boundary.required_artifact_paths)
      !== stableStringify(ATTEMPT116_ARTIFACTS.map(({ path: artifactPath }) => artifactPath))) {
    fail("Attempt 116 protocol does not bind the frozen artifact set and exclusive deadline");
  }
  return protocol;
}

async function loadLocalClosure(projectRoot) {
  const artifactBytes = {};
  for (const artifact of ATTEMPT116_ARTIFACTS) {
    const bytes = await readRegularFileWithoutSymlink(projectRoot, artifact.path);
    if (rawBytesSha256(bytes) !== artifact.raw_bytes_sha256) {
      fail(`Attempt 116 executing local artifact differs from its frozen hash: ${artifact.path}`);
    }
    artifactBytes[artifact.path] = bytes;
  }
  validateProtocolArtifact(artifactBytes["research/prospective_attempt116/protocol.json"]);
  const workflowBytes = await readRegularFileWithoutSymlink(
    projectRoot,
    ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.path,
  );
  if (rawBytesSha256(workflowBytes)
      !== ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 116 executing workflow differs from its frozen hash");
  }
  const dependencyBytes = {};
  for (const dependency of ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES) {
    const bytes = await readRegularFileWithoutSymlink(projectRoot, dependency.path);
    if (rawBytesSha256(bytes) !== dependency.raw_bytes_sha256) {
      fail(`Attempt 116 additional local dependency differs from its commit-bound hash: ${dependency.path}`);
    }
    dependencyBytes[dependency.path] = bytes;
  }
  return { artifactBytes, dependencyBytes, workflowBytes };
}

function expectedPublicationCommitReceipt() {
  const expected = ATTEMPT116_GITHUB_PUBLICATION_POLICY.publication_commit;
  return {
    sha: expected.sha,
    parent_sha: expected.parent_sha,
    tree_sha: expected.tree_sha,
    authored_at: expected.authored_at,
    committed_at: expected.committed_at,
    html_url: `https://github.com/owlsowo/finly-bot/commit/${expected.sha}`,
  };
}

function expectedWorkflowReceipt() {
  const policy = ATTEMPT116_GITHUB_PUBLICATION_POLICY;
  return {
    id: policy.workflow.run_id,
    workflow_id: policy.workflow.id,
    name: policy.workflow.name,
    path: policy.workflow.path,
    event: "push",
    head_branch: policy.repository.default_branch,
    head_sha: policy.publication_commit.sha,
    run_attempt: policy.workflow.run_attempt,
    status: "completed",
    conclusion: "success",
    created_at: policy.workflow.created_at,
    updated_at: policy.workflow.updated_at,
    html_url: `https://github.com/owlsowo/finly-bot/actions/runs/${policy.workflow.run_id}`,
    verification_job: {
      id: policy.workflow.job.id,
      name: policy.workflow.job.name,
      head_sha: policy.publication_commit.sha,
      status: "completed",
      conclusion: "success",
      started_at: policy.workflow.job.started_at,
      completed_at: policy.workflow.job.completed_at,
      required_steps: policy.workflow.job.required_successful_steps.map((step) => ({
        ...step,
        status: "completed",
        conclusion: "success",
      })),
    },
  };
}

function latestObservation(evidence) {
  return evidence.responses
    .map(({ github_http_date: value }) => new Date(value).toISOString())
    .reduce((latest, value) => value > latest ? value : latest);
}

function receiptBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receipt_sha256"));
}

function canonicalPrettyJson(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

export function validateAttempt116GitHubPublicationReceipt(value) {
  exact(value, [
    "schema_version", "attempt_id", "evidence_class", "exclusive_deadline", "repository",
    "publication_commit", "workflow_run", "published_artifacts",
    "additional_commit_bound_dependencies", "github_public_get_evidence",
    "executing_local_closure", "verification_observed_at", "assurance", "receipt_sha256",
  ], "Attempt 116 GitHub publication receipt");
  if (value.schema_version !== ATTEMPT116_PUBLICATION_RECEIPT_SCHEMA
    || value.attempt_id !== ATTEMPT116_ID
    || value.evidence_class !== "PUBLIC_GITHUB_GET_COLLECTION_NOT_INDEPENDENT_TIMESTAMP"
    || value.exclusive_deadline !== ATTEMPT116_PUBLICATION_DEADLINE) {
    fail("Attempt 116 publication receipt envelope is invalid");
  }
  exact(value.repository, ["id", "full_name", "public", "default_branch"],
    "Attempt 116 receipt repository");
  const expectedRepository = ATTEMPT116_GITHUB_PUBLICATION_POLICY.repository;
  if (stableStringify(value.repository) !== stableStringify({
    id: expectedRepository.id,
    full_name: expectedRepository.full_name,
    public: true,
    default_branch: expectedRepository.default_branch,
  })) fail("Attempt 116 receipt repository identity is invalid");
  exact(value.publication_commit,
    ["sha", "parent_sha", "tree_sha", "authored_at", "committed_at", "html_url"],
    "Attempt 116 receipt publication commit");
  for (const key of ["sha", "parent_sha", "tree_sha"]) {
    commitSha(value.publication_commit[key], `Attempt 116 receipt commit ${key}`);
  }
  githubInstant(value.publication_commit.authored_at, "Attempt 116 receipt authored_at");
  githubInstant(value.publication_commit.committed_at, "Attempt 116 receipt committed_at");
  if (stableStringify(value.publication_commit)
      !== stableStringify(expectedPublicationCommitReceipt())) {
    fail("Attempt 116 receipt commit identity, parent, tree, or timestamps are invalid");
  }
  const expectedWorkflow = expectedWorkflowReceipt();
  if (stableStringify(value.workflow_run) !== stableStringify(expectedWorkflow)) {
    fail("Attempt 116 receipt workflow run, job, steps, or timestamps are invalid");
  }
  exact(value.workflow_run, Object.keys(expectedWorkflow), "Attempt 116 receipt workflow run");
  exact(value.workflow_run.verification_job, Object.keys(expectedWorkflow.verification_job),
    "Attempt 116 receipt verification job");
  value.workflow_run.verification_job.required_steps.forEach((step, index) => {
    exact(step, Object.keys(expectedWorkflow.verification_job.required_steps[index]),
      `Attempt 116 receipt required workflow step ${index + 1}`);
  });
  if (!Array.isArray(value.published_artifacts)
    || stableStringify(value.published_artifacts) !== stableStringify(ATTEMPT116_ARTIFACTS)) {
    fail("Attempt 116 receipt must bind exactly the seven frozen artifact paths and hashes");
  }
  value.published_artifacts.forEach((artifact, index) => {
    exact(artifact, ["path", "git_blob_sha", "raw_bytes_sha256"],
      `Attempt 116 receipt artifact ${index + 1}`);
    safeRepositoryPath(artifact.path, `Attempt 116 receipt artifact ${index + 1} path`);
    commitSha(artifact.git_blob_sha, `Attempt 116 receipt artifact ${index + 1} Git blob`);
    digest(artifact.raw_bytes_sha256, `Attempt 116 receipt artifact ${index + 1} raw hash`);
  });
  if (!Array.isArray(value.additional_commit_bound_dependencies)
    || stableStringify(value.additional_commit_bound_dependencies)
      !== stableStringify(ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES)) {
    fail("Attempt 116 receipt additional dependency closure is invalid");
  }
  value.additional_commit_bound_dependencies.forEach((dependency, index) => {
    exact(dependency, ["path", "git_blob_sha", "raw_bytes_sha256"],
      `Attempt 116 receipt additional dependency ${index + 1}`);
    safeRepositoryPath(dependency.path,
      `Attempt 116 receipt additional dependency ${index + 1} path`);
    commitSha(dependency.git_blob_sha,
      `Attempt 116 receipt additional dependency ${index + 1} Git blob`);
    digest(dependency.raw_bytes_sha256,
      `Attempt 116 receipt additional dependency ${index + 1} raw hash`);
  });
  exact(value.github_public_get_evidence, ["request_count", "responses"],
    "Attempt 116 receipt public-GET evidence");
  const plan = fixedRequests();
  const responses = value.github_public_get_evidence.responses;
  if (value.github_public_get_evidence.request_count !== plan.length
    || !Array.isArray(responses) || responses.length !== plan.length) {
    fail(`Attempt 116 receipt must cover exactly ${plan.length} fixed public GETs`);
  }
  responses.forEach((response, index) => {
    exact(response, [
      "request_id", "canonical_url", "github_http_date", "response_byte_length",
      "response_bytes_sha256",
    ], `Attempt 116 public-GET observation ${index + 1}`);
    if (response.request_id !== plan[index].request_id
      || response.canonical_url !== plan[index].canonical_url) {
      fail(`Attempt 116 public-GET observation ${index + 1} is reordered or escaped`);
    }
    githubHttpDate(response.github_http_date,
      `Attempt 116 public-GET observation ${index + 1} Date`);
    positiveInteger(response.response_byte_length,
      `Attempt 116 public-GET observation ${index + 1} byte length`);
    const maximum = plan[index].response_type === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES;
    if (response.response_byte_length > maximum) {
      fail(`Attempt 116 public-GET observation ${index + 1} exceeds its byte limit`);
    }
    digest(response.response_bytes_sha256,
      `Attempt 116 public-GET observation ${index + 1} byte hash`);
    const observedAt = new Date(response.github_http_date).toISOString();
    if (observedAt <= new Date(value.workflow_run.updated_at).toISOString()
      || observedAt >= ATTEMPT116_PUBLICATION_DEADLINE) {
      fail("Attempt 116 public GET was not observed after CI and before the exclusive deadline");
    }
    const fixedRawLength = ATTEMPT116_FIXED_RAW_BYTE_LENGTHS[response.request_id];
    if (plan[index].response_type === "raw"
      && response.response_byte_length !== fixedRawLength) {
      fail(`Attempt 116 public raw byte length differs: ${response.request_id}`);
    }
  });
  if (new Set(responses.map(({ canonical_url: url }) => url)).size !== plan.length) {
    fail("Attempt 116 public-GET observations contain duplicate URLs");
  }
  const observations = Object.fromEntries(responses.map((response) => [response.request_id, response]));
  if (observations.workflow_file.response_bytes_sha256
      !== ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 116 public workflow bytes differ from the frozen workflow");
  }
  for (const artifact of ATTEMPT116_ARTIFACTS) {
    if (observations[`artifact:${artifact.path}`].response_bytes_sha256
        !== artifact.raw_bytes_sha256) {
      fail(`Attempt 116 public artifact bytes differ from the frozen hash: ${artifact.path}`);
    }
  }
  for (const dependency of ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES) {
    if (observations[`additional_dependency:${dependency.path}`].response_bytes_sha256
        !== dependency.raw_bytes_sha256) {
      fail(`Attempt 116 public additional dependency differs from its commit-bound hash: ${dependency.path}`);
    }
  }
  instant(value.verification_observed_at, "Attempt 116 receipt verification observation");
  if (value.verification_observed_at !== latestObservation(value.github_public_get_evidence)
    || value.verification_observed_at <= new Date(value.workflow_run.updated_at).toISOString()
    || value.verification_observed_at >= ATTEMPT116_PUBLICATION_DEADLINE) {
    fail("Attempt 116 public verification observation is not strict post-CI and pre-deadline");
  }
  exact(value.executing_local_closure, [
    "required_artifacts_match_public_head", "required_artifacts_verified",
    "additional_dependencies_match_public_head", "additional_dependencies_verified",
    "workflow_file_matches_public_head", "workflow_file_sha256",
  ], "Attempt 116 executing local closure");
  if (stableStringify(value.executing_local_closure) !== stableStringify({
    required_artifacts_match_public_head: true,
    required_artifacts_verified: ATTEMPT116_ARTIFACTS.length,
    additional_dependencies_match_public_head: true,
    additional_dependencies_verified: ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES.length,
    workflow_file_matches_public_head: true,
    workflow_file_sha256: ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.file_sha256,
  })) fail("Attempt 116 executing local closure is incomplete");
  exact(value.assurance, [
    "fixed_unauthenticated_get_requests", "no_credentials_sent",
    "network_access_limited_to_public_github_gets", "network_mutation_authorized",
    "broker_or_market_data_network_accessed", "public_github_platform_record_only",
    "self_contained_offline_evidence", "independent_cryptographic_timestamp_verified",
    "provider_timing_independent", "provider_origin_verified", "broker_execution_verified",
    "performance_inference_permitted",
  ], "Attempt 116 publication assurance");
  if (stableStringify(value.assurance) !== stableStringify({
    fixed_unauthenticated_get_requests: true,
    no_credentials_sent: true,
    network_access_limited_to_public_github_gets: true,
    network_mutation_authorized: false,
    broker_or_market_data_network_accessed: false,
    public_github_platform_record_only: true,
    self_contained_offline_evidence: false,
    independent_cryptographic_timestamp_verified: false,
    provider_timing_independent: false,
    provider_origin_verified: false,
    broker_execution_verified: false,
    performance_inference_permitted: false,
  })) fail("Attempt 116 publication assurance boundary is invalid");
  digest(value.receipt_sha256, "Attempt 116 publication receipt self-hash");
  if (value.receipt_sha256 !== sha256(receiptBody(value))) {
    fail("Attempt 116 publication receipt self-hash is invalid");
  }
  return value;
}

export async function collectAttempt116GitHubPublicationEvidence({
  headSha = ATTEMPT116_PUBLICATION_HEAD_SHA,
  workflowRunId = ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID,
  fetchImpl = globalThis.fetch,
  projectRoot = PROJECT_ROOT,
} = {}) {
  if (typeof fetchImpl !== "function") fail("Attempt 116 publication collector requires fetch");
  assertFrozenIdentifiers(headSha, workflowRunId);
  const local = await loadLocalClosure(projectRoot);
  const registry = fixedRequests();
  const fetched = [];
  for (const request of registry) fetched.push(await githubGet(request, fetchImpl, registry));
  const byId = Object.fromEntries(fetched.map((entry) => [entry.request.request_id, entry]));
  const repository = validateRepository(byId.repository.value);
  const commit = validateCommit(byId.publication_commit.value);
  const run = validateWorkflowRun(byId.workflow_run.value);
  const { job, requiredSteps } = validateWorkflowJobs(byId.workflow_jobs.value, run);
  if (!byId.workflow_file.bytes.equals(local.workflowBytes)
    || rawBytesSha256(byId.workflow_file.bytes)
      !== ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 116 public workflow differs from the executing frozen workflow");
  }
  for (const artifact of ATTEMPT116_ARTIFACTS) {
    const remoteBytes = byId[`artifact:${artifact.path}`].bytes;
    if (!remoteBytes.equals(local.artifactBytes[artifact.path])
      || rawBytesSha256(remoteBytes) !== artifact.raw_bytes_sha256) {
      fail(`Attempt 116 public artifact differs from executing local bytes: ${artifact.path}`);
    }
  }
  for (const dependency of ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES) {
    const remoteBytes = byId[`additional_dependency:${dependency.path}`].bytes;
    if (!remoteBytes.equals(local.dependencyBytes[dependency.path])
      || rawBytesSha256(remoteBytes) !== dependency.raw_bytes_sha256) {
      fail(`Attempt 116 public additional dependency differs from executing local bytes: ${dependency.path}`);
    }
  }
  validateProtocolArtifact(byId["artifact:research/prospective_attempt116/protocol.json"].bytes);
  const evidence = {
    request_count: fetched.length,
    responses: fetched.map(({ observation }) => observation),
  };
  const verificationObservedAt = latestObservation(evidence);
  const body = {
    schema_version: ATTEMPT116_PUBLICATION_RECEIPT_SCHEMA,
    attempt_id: ATTEMPT116_ID,
    evidence_class: "PUBLIC_GITHUB_GET_COLLECTION_NOT_INDEPENDENT_TIMESTAMP",
    exclusive_deadline: ATTEMPT116_PUBLICATION_DEADLINE,
    repository: {
      id: repository.id,
      full_name: repository.full_name,
      public: true,
      default_branch: repository.default_branch,
    },
    publication_commit: {
      sha: commit.sha,
      parent_sha: commit.parents[0].sha,
      tree_sha: commit.commit.tree.sha,
      authored_at: commit.commit.author.date,
      committed_at: commit.commit.committer.date,
      html_url: commit.html_url,
    },
    workflow_run: {
      id: run.id,
      workflow_id: run.workflow_id,
      name: run.name,
      path: run.path,
      event: run.event,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      run_attempt: run.run_attempt,
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      updated_at: run.updated_at,
      html_url: run.html_url,
      verification_job: {
        id: job.id,
        name: job.name,
        head_sha: job.head_sha,
        status: job.status,
        conclusion: job.conclusion,
        started_at: job.started_at,
        completed_at: job.completed_at,
        required_steps: requiredSteps,
      },
    },
    published_artifacts: structuredClone(ATTEMPT116_ARTIFACTS),
    additional_commit_bound_dependencies:
      structuredClone(ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES),
    github_public_get_evidence: evidence,
    executing_local_closure: {
      required_artifacts_match_public_head: true,
      required_artifacts_verified: ATTEMPT116_ARTIFACTS.length,
      additional_dependencies_match_public_head: true,
      additional_dependencies_verified:
        ATTEMPT116_ADDITIONAL_COMMIT_BOUND_DEPENDENCIES.length,
      workflow_file_matches_public_head: true,
      workflow_file_sha256: ATTEMPT116_GITHUB_PUBLICATION_POLICY.workflow.file_sha256,
    },
    verification_observed_at: verificationObservedAt,
    assurance: {
      fixed_unauthenticated_get_requests: true,
      no_credentials_sent: true,
      network_access_limited_to_public_github_gets: true,
      network_mutation_authorized: false,
      broker_or_market_data_network_accessed: false,
      public_github_platform_record_only: true,
      self_contained_offline_evidence: false,
      independent_cryptographic_timestamp_verified: false,
      provider_timing_independent: false,
      provider_origin_verified: false,
      broker_execution_verified: false,
      performance_inference_permitted: false,
    },
  };
  return deepFreeze(validateAttempt116GitHubPublicationReceipt({
    ...body,
    receipt_sha256: sha256(body),
  }));
}

export function canonicalAttempt116GitHubPublicationReceiptJson(value) {
  validateAttempt116GitHubPublicationReceipt(value);
  return canonicalPrettyJson(value);
}

export function attempt116PublicationReceiptPlan(value) {
  const bytes = Buffer.from(canonicalAttempt116GitHubPublicationReceiptJson(value), "utf8");
  const filename = `${value.receipt_sha256.slice(7)}.json`;
  if (!RECEIPT_FILENAME.test(filename)) fail("Attempt 116 receipt filename is invalid");
  return Object.freeze({
    filename,
    relativePath: `${ATTEMPT116_PUBLICATION_RECEIPT_DIRECTORY}/${filename}`,
    bytes,
  });
}

async function ensureSafeReceiptDirectory(projectRoot) {
  const rootStatus = await lstat(projectRoot).catch(() => fail("Attempt 116 receipt root is missing"));
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("Attempt 116 receipt root must be a real directory");
  }
  const root = await realpath(projectRoot);
  let current = root;
  for (const component of ATTEMPT116_PUBLICATION_RECEIPT_DIRECTORY.split("/")) {
    if (!/^[a-z0-9_]+$/iu.test(component)) {
      fail("Attempt 116 receipt directory policy is invalid");
    }
    current = path.resolve(current, component);
    let status;
    try {
      status = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      try {
        await mkdir(current, { mode: 0o755 });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") throw mkdirError;
      }
      status = await lstat(current);
    }
    if (status.isSymbolicLink() || !status.isDirectory()) {
      fail("Attempt 116 receipt directory contains a symlink or non-directory component");
    }
  }
  if (await realpath(current) !== current) fail("Attempt 116 receipt directory escaped its root");
  return current;
}

async function verifyExistingReceipt(receiptPath, expectedBytes) {
  let handle;
  try {
    handle = await open(receiptPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW | FS_CONSTANTS.O_NONBLOCK);
    const status = await handle.stat();
    if (!status.isFile() || status.size !== expectedBytes.length || status.size > MAX_RAW_BYTES) {
      fail("existing Attempt 116 receipt is non-regular, oversized, or incorrectly addressed");
    }
    if (!(await handle.readFile()).equals(expectedBytes)) {
      fail("existing Attempt 116 receipt differs at the same content address");
    }
    const finalStatus = await lstat(receiptPath);
    if (finalStatus.isSymbolicLink() || !finalStatus.isFile()
      || finalStatus.dev !== status.dev || finalStatus.ino !== status.ino
      || await realpath(receiptPath) !== receiptPath) {
      fail("existing Attempt 116 receipt changed identity while verified");
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function publishAttempt116GitHubPublicationReceiptWriteOnce(value, {
  projectRoot = PROJECT_ROOT,
} = {}) {
  const plan = attempt116PublicationReceiptPlan(value);
  const directory = await ensureSafeReceiptDirectory(projectRoot);
  const finalPath = path.resolve(directory, plan.filename);
  const stagePath = path.resolve(directory, `.receipt-${process.pid}-${randomUUID()}.tmp`);
  let stageHandle;
  let disposition;
  try {
    stageHandle = await open(stagePath,
      FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_NOFOLLOW,
      0o600);
    await stageHandle.writeFile(plan.bytes);
    await stageHandle.sync();
    await stageHandle.close();
    stageHandle = null;
    try {
      await link(stagePath, finalPath);
      disposition = "created";
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await verifyExistingReceipt(finalPath, plan.bytes);
      disposition = "verified_existing";
    }
    await verifyExistingReceipt(finalPath, plan.bytes);
  } finally {
    await stageHandle?.close().catch(() => {});
    await unlink(stagePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  const directoryHandle = await open(directory, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
  return Object.freeze({
    disposition,
    path: plan.relativePath,
    receipt_sha256: value.receipt_sha256,
  });
}

export function parseAttempt116GitHubPublicationCli(argv) {
  if (!Array.isArray(argv)) fail("Attempt 116 CLI arguments must be an array");
  if (argv.length === 0) {
    return Object.freeze({
      headSha: ATTEMPT116_PUBLICATION_HEAD_SHA,
      workflowRunId: ATTEMPT116_PUBLICATION_WORKFLOW_RUN_ID,
    });
  }
  const usage = "usage: node scripts/verify_attempt116_github_publication.mjs --head-sha <frozen-sha> --run-id <frozen-id>";
  if (argv.length !== 4) fail(usage);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!new Set(["--head-sha", "--run-id"]).has(key)
      || typeof value !== "string" || value.length < 1 || values.has(key)) {
      fail(usage);
    }
    values.set(key, value);
  }
  const headSha = values.get("--head-sha");
  const workflowRunId = Number(values.get("--run-id"));
  assertFrozenIdentifiers(headSha, workflowRunId);
  if (values.get("--run-id") !== String(workflowRunId)) {
    fail("Attempt 116 workflow run ID must be a canonical positive integer");
  }
  return Object.freeze({ headSha, workflowRunId });
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirect) {
  try {
    const identifiers = parseAttempt116GitHubPublicationCli(process.argv.slice(2));
    const receipt = await collectAttempt116GitHubPublicationEvidence(identifiers);
    const result = await publishAttempt116GitHubPublicationReceiptWriteOnce(receipt);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
