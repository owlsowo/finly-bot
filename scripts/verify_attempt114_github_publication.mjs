import { createHash, randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sha256, stableStringify } from "../lib/canonical.mjs";
import {
  ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256,
  ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH,
  ATTEMPT114_RUNTIME_SOURCE_PATHS,
  buildProspectiveAttempt114GitHubPublicationReceipt,
  canonicalProspectiveAttempt114RuntimeManifestJson,
  validateProspectiveAttempt114GitHubPublicationReceipt,
  validateProspectiveAttempt114RuntimeManifest,
  verifyProspectiveAttempt114GitHubPublicationEvidence,
} from "../research/prospective_attempt114/runtime.mjs";

export const ATTEMPT114_PUBLICATION_HEAD_SHA =
  "38a999cdf5db98f3a831d137b799ff8a48248e71";
export const ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID = 33_293_038_439;
export const ATTEMPT114_PUBLICATION_COLLECTION_SCHEMA =
  "finly_attempt114_github_publication_collection_receipt.v1";
export const ATTEMPT114_PUBLICATION_RECEIPT_DIRECTORY =
  "research/prospective_attempt114/publication_receipts";

export const ATTEMPT114_PUBLICATION_POLICY = Object.freeze({
  api_origin: "https://api.github.com",
  raw_origin: "https://raw.githubusercontent.com",
  api_version: "2022-11-28",
  repository: Object.freeze({
    id: 1_350_112_497,
    full_name: "owlsowo/finly-bot",
    default_branch: "main",
  }),
  workflow: Object.freeze({
    id: 344_996_171,
    name: "Verify Finly",
    path: ".github/workflows/ci.yml",
    file_sha256: "sha256:f23196c2cd6e070455395490e7fde6ad14b8ae31016771188269d85cb75e70e5",
    job_name: "verify",
    required_successful_steps: Object.freeze([
      "Run npm run verify",
      "Generated receipts are committed and reproducible",
    ]),
  }),
  publication_head_sha: ATTEMPT114_PUBLICATION_HEAD_SHA,
  workflow_run_id: ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
  runtime_manifest_path: ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH,
  runtime_source_paths: ATTEMPT114_RUNTIME_SOURCE_PATHS,
  receipt_directory: ATTEMPT114_PUBLICATION_RECEIPT_DIRECTORY,
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

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function exact(value, keys, label) {
  object(value, label);
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
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
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

function githubHttpDate(value, label) {
  if (typeof value !== "string" || value.length > 64) fail(`${label} must be an HTTP Date`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toUTCString() !== value) {
    fail(`${label} must be a canonical HTTP Date`);
  }
  return value;
}

function boundedBytes(value, label, maximum = MAX_RAW_BYTES) {
  if (!Buffer.isBuffer(value) && typeof value !== "string") {
    fail(`${label} must be response bytes or text`);
  }
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (bytes.length < 1 || bytes.length > maximum) {
    fail(`${label} must contain between 1 and ${maximum} bytes`);
  }
  return bytes;
}

function rawBytesSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function encodeRepositoryPath(value) {
  return value.split("/").map((component) => encodeURIComponent(component)).join("/");
}

function apiUrl(route) {
  const url = new URL(route, ATTEMPT114_PUBLICATION_POLICY.api_origin);
  if (url.origin !== ATTEMPT114_PUBLICATION_POLICY.api_origin || url.protocol !== "https:") {
    fail("Attempt 114 GitHub API route escaped the fixed HTTPS origin");
  }
  return url.href;
}

function rawUrl(sourcePath) {
  const encoded = encodeRepositoryPath(sourcePath);
  const route = `/owlsowo/finly-bot/${ATTEMPT114_PUBLICATION_HEAD_SHA}/${encoded}`;
  const url = new URL(route, ATTEMPT114_PUBLICATION_POLICY.raw_origin);
  if (url.origin !== ATTEMPT114_PUBLICATION_POLICY.raw_origin || url.protocol !== "https:") {
    fail("Attempt 114 raw GitHub route escaped the fixed HTTPS origin");
  }
  return url.href;
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
      canonical_url: apiUrl(`/repos/owlsowo/finly-bot/commits/${ATTEMPT114_PUBLICATION_HEAD_SHA}?per_page=100&page=1`),
    },
    {
      request_id: "workflow_run",
      response_type: "json",
      canonical_url: apiUrl(`/repos/owlsowo/finly-bot/actions/runs/${ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID}`),
    },
    {
      request_id: "workflow_jobs",
      response_type: "json",
      canonical_url: apiUrl(`/repos/owlsowo/finly-bot/actions/runs/${ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID}/jobs?per_page=100`),
    },
    {
      request_id: "workflow_file",
      response_type: "raw",
      canonical_url: rawUrl(ATTEMPT114_PUBLICATION_POLICY.workflow.path),
    },
    {
      request_id: "runtime_manifest",
      response_type: "raw",
      canonical_url: rawUrl(ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH),
    },
    ...ATTEMPT114_RUNTIME_SOURCE_PATHS.map((sourcePath) => ({
      request_id: `runtime_source:${sourcePath}`,
      response_type: "raw",
      canonical_url: rawUrl(sourcePath),
    })),
  ];
}

export function attempt114GitHubPublicationRequestPlan({
  headSha = ATTEMPT114_PUBLICATION_HEAD_SHA,
  workflowRunId = ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
} = {}) {
  if (headSha !== ATTEMPT114_PUBLICATION_HEAD_SHA
    || workflowRunId !== ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID) {
    fail("Attempt 114 request plan accepts only the frozen publication head and workflow run");
  }
  return deepFreeze(fixedRequests().map((request) => ({ ...request })));
}

async function githubGet(request, fetchImpl) {
  exact(request, ["request_id", "response_type", "canonical_url"],
    "Attempt 114 fixed GitHub request");
  const expected = fixedRequests().find(({ request_id: requestId }) => (
    requestId === request.request_id
  ));
  if (!expected || stableStringify(request) !== stableStringify(expected)) {
    fail("Attempt 114 GitHub request differs from the fixed request registry");
  }
  const url = new URL(request.canonical_url);
  if (!new Set([
    ATTEMPT114_PUBLICATION_POLICY.api_origin,
    ATTEMPT114_PUBLICATION_POLICY.raw_origin,
  ]).has(url.origin) || url.protocol !== "https:") {
    fail("Attempt 114 GitHub request escaped the allowlisted HTTPS hosts");
  }
  const headers = {
    accept: request.response_type === "json"
      ? "application/vnd.github+json"
      : "application/octet-stream",
    "user-agent": "finly-attempt114-publication-verifier/1.0",
  };
  if (request.response_type === "json") {
    headers["x-github-api-version"] = ATTEMPT114_PUBLICATION_POLICY.api_version;
  }
  let response;
  try {
    response = await fetchImpl(request.canonical_url, {
      method: "GET",
      redirect: "error",
      headers,
    });
  } catch {
    fail(`Attempt 114 public GET failed: ${request.request_id}`);
  }
  if (!response || response.ok !== true || response.status !== 200) {
    fail(`Attempt 114 public GET did not return HTTP 200: ${request.request_id}`);
  }
  if (response.redirected === true || response.url !== request.canonical_url) {
    fail(`Attempt 114 public GET returned from an unexpected URL: ${request.request_id}`);
  }
  const dateHeader = response.headers?.get?.("date");
  githubHttpDate(dateHeader, `Attempt 114 public GET ${request.request_id} Date header`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const maximum = request.response_type === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES;
  boundedBytes(bytes, `Attempt 114 public GET ${request.request_id}`, maximum);
  let value = bytes;
  if (request.response_type === "json") {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(`Attempt 114 public GET is not valid JSON: ${request.request_id}`);
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
  object(value, "Attempt 114 GitHub repository response");
  const expected = ATTEMPT114_PUBLICATION_POLICY.repository;
  if (value.id !== expected.id
    || value.full_name !== expected.full_name
    || value.private !== false
    || value.visibility !== "public"
    || value.default_branch !== expected.default_branch
    || value.fork !== false
    || value.archived !== false
    || value.disabled !== false) {
    fail("Attempt 114 GitHub repository identity or public-state gate failed");
  }
  return value;
}

function validateCommit(value) {
  object(value, "Attempt 114 GitHub commit response");
  if (value.sha !== ATTEMPT114_PUBLICATION_HEAD_SHA
    || value.html_url
      !== `https://github.com/owlsowo/finly-bot/commit/${ATTEMPT114_PUBLICATION_HEAD_SHA}`
    || !Array.isArray(value.parents)
    || value.parents.length !== 1) {
    fail("Attempt 114 GitHub commit identity or parent gate failed");
  }
  commitSha(value.sha, "Attempt 114 GitHub commit SHA");
  const parentSha = commitSha(value.parents[0]?.sha, "Attempt 114 GitHub commit parent SHA");
  const treeSha = commitSha(value.commit?.tree?.sha, "Attempt 114 GitHub commit tree SHA");
  if (parentSha === value.sha) fail("Attempt 114 GitHub commit cannot parent itself");
  return { value, parentSha, treeSha };
}

function validateWorkflowRun(value) {
  object(value, "Attempt 114 GitHub workflow-run response");
  const expected = ATTEMPT114_PUBLICATION_POLICY;
  if (value.id !== expected.workflow_run_id
    || value.workflow_id !== expected.workflow.id
    || value.name !== expected.workflow.name
    || value.path !== expected.workflow.path
    || value.event !== "push"
    || value.head_branch !== expected.repository.default_branch
    || value.head_sha !== expected.publication_head_sha
    || value.status !== "completed"
    || value.conclusion !== "success"
    || value.html_url
      !== `https://github.com/owlsowo/finly-bot/actions/runs/${expected.workflow_run_id}`) {
    fail("Attempt 114 GitHub workflow identity, linkage, or success gate failed");
  }
  positiveInteger(value.run_attempt, "Attempt 114 GitHub workflow run attempt");
  githubInstant(value.created_at, "Attempt 114 GitHub workflow created_at");
  githubInstant(value.updated_at, "Attempt 114 GitHub workflow updated_at");
  if (Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    fail("Attempt 114 GitHub workflow timestamps are not chronological");
  }
  for (const label of ["repository", "head_repository"]) {
    const repository = object(value[label], `Attempt 114 GitHub workflow ${label}`);
    if (repository.id !== expected.repository.id
      || repository.full_name !== expected.repository.full_name
      || repository.private !== false) {
      fail(`Attempt 114 GitHub workflow ${label} identity gate failed`);
    }
  }
  return value;
}

function validateWorkflowJobs(value, run) {
  object(value, "Attempt 114 GitHub jobs response");
  if (!Array.isArray(value.jobs)
    || value.total_count !== value.jobs.length
    || value.jobs.length < 1
    || value.jobs.length > 100) {
    fail("Attempt 114 GitHub jobs response is incomplete or unbounded");
  }
  const matches = value.jobs.filter(({ name }) => (
    name === ATTEMPT114_PUBLICATION_POLICY.workflow.job_name
  ));
  if (matches.length !== 1) fail("Attempt 114 GitHub verification job is absent or ambiguous");
  const job = object(matches[0], "Attempt 114 GitHub verification job");
  if (job.head_sha !== run.head_sha
    || job.status !== "completed"
    || job.conclusion !== "success"
    || !Array.isArray(job.steps)) {
    fail("Attempt 114 GitHub verification job linkage or success gate failed");
  }
  positiveInteger(job.id, "Attempt 114 GitHub verification job id");
  githubInstant(job.started_at, "Attempt 114 GitHub verification job started_at");
  githubInstant(job.completed_at, "Attempt 114 GitHub verification job completed_at");
  if (Date.parse(job.started_at) < Date.parse(run.created_at)
    || Date.parse(job.completed_at) < Date.parse(job.started_at)
    || Date.parse(job.completed_at) > Date.parse(run.updated_at)) {
    fail("Attempt 114 GitHub verification job timestamps escape the workflow run");
  }
  const requiredSteps = ATTEMPT114_PUBLICATION_POLICY.workflow.required_successful_steps.map(
    (requiredName) => {
      const matchingSteps = job.steps.filter(({ name }) => name === requiredName);
      if (matchingSteps.length !== 1) {
        fail(`Attempt 114 GitHub workflow step is absent or ambiguous: ${requiredName}`);
      }
      const step = matchingSteps[0];
      if (step.status !== "completed" || step.conclusion !== "success") {
        fail(`Attempt 114 GitHub workflow step did not succeed: ${requiredName}`);
      }
      positiveInteger(step.number, `Attempt 114 GitHub workflow step number: ${requiredName}`);
      githubInstant(step.started_at, `Attempt 114 GitHub workflow step started_at: ${requiredName}`);
      githubInstant(step.completed_at, `Attempt 114 GitHub workflow step completed_at: ${requiredName}`);
      if (Date.parse(step.started_at) < Date.parse(job.started_at)
        || Date.parse(step.completed_at) < Date.parse(step.started_at)
        || Date.parse(step.completed_at) > Date.parse(job.completed_at)) {
        fail(`Attempt 114 GitHub workflow step timestamps are invalid: ${requiredName}`);
      }
      return {
        name: step.name,
        number: step.number,
        status: step.status,
        conclusion: step.conclusion,
        started_at: step.started_at,
        completed_at: step.completed_at,
      };
    },
  );
  if (new Set(requiredSteps.map(({ number }) => number)).size !== requiredSteps.length) {
    fail("Attempt 114 GitHub required workflow steps reuse a step number");
  }
  return { job, requiredSteps };
}

function parseRuntimeManifest(bytes, label) {
  const text = boundedBytes(bytes, label).toString("utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  if (text !== canonicalProspectiveAttempt114RuntimeManifestJson(value)) {
    fail(`${label} is not canonical pretty JSON with one trailing newline`);
  }
  validateProspectiveAttempt114RuntimeManifest(value);
  return value;
}

async function readRegularFileWithoutSymlink(projectRoot, relativePath) {
  if (typeof relativePath !== "string"
    || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.startsWith("../")
    || relativePath.includes("/../")) {
    fail(`unsafe repository-relative path: ${relativePath}`);
  }
  const rootStatus = await lstat(projectRoot).catch(() => fail("Attempt 114 project root is missing"));
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("Attempt 114 project root must be a real directory");
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
    if (finalStatus.isSymbolicLink()
      || !finalStatus.isFile()
      || finalStatus.dev !== openedStatus.dev
      || finalStatus.ino !== openedStatus.ino
      || await realpath(cursor) !== cursor) {
      fail(`${relativePath} changed identity while it was read`);
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function verifyExecutingLocalClosure(
  projectRoot,
  remoteManifestBytes,
  remoteSourceBytes,
  remoteWorkflowBytes,
) {
  const localManifestBytes = await readRegularFileWithoutSymlink(
    projectRoot,
    ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH,
  );
  if (!localManifestBytes.equals(remoteManifestBytes)) {
    fail("Attempt 114 public runtime manifest differs from the executing local manifest");
  }
  for (const sourcePath of ATTEMPT114_RUNTIME_SOURCE_PATHS) {
    const localBytes = await readRegularFileWithoutSymlink(projectRoot, sourcePath);
    if (!localBytes.equals(remoteSourceBytes[sourcePath])) {
      fail(`Attempt 114 public source differs from the executing local source: ${sourcePath}`);
    }
  }
  const localWorkflowBytes = await readRegularFileWithoutSymlink(
    projectRoot,
    ATTEMPT114_PUBLICATION_POLICY.workflow.path,
  );
  if (!localWorkflowBytes.equals(remoteWorkflowBytes)
    || rawBytesSha256(remoteWorkflowBytes)
      !== ATTEMPT114_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 114 public workflow differs from the exact executing local workflow");
  }
  return {
    runtime_manifest_matches_public_head: true,
    runtime_source_files_match_public_head: true,
    runtime_source_files_verified: ATTEMPT114_RUNTIME_SOURCE_PATHS.length,
    workflow_file_matches_public_head: true,
    workflow_file_sha256: ATTEMPT114_PUBLICATION_POLICY.workflow.file_sha256,
  };
}

function collectionReceiptBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receipt_sha256"));
}

function latestObservation(evidence) {
  return evidence.responses
    .map(({ github_http_date: dateHeader }) => new Date(dateHeader).toISOString())
    .reduce((latest, value) => value > latest ? value : latest);
}

export function validateAttempt114GitHubPublicationCollectionReceipt(value) {
  exact(value, [
    "schema_version",
    "attempt_id",
    "evidence_class",
    "publication_head_sha",
    "workflow_run_id",
    "runtime_publication_receipt",
    "github_public_get_evidence",
    "executing_local_closure",
    "assurance",
    "receipt_sha256",
  ], "Attempt 114 publication collection receipt");
  if (value.schema_version !== ATTEMPT114_PUBLICATION_COLLECTION_SCHEMA
    || value.attempt_id !== "finly_prospective_profitability_attempt_114"
    || value.evidence_class !== "PUBLIC_GITHUB_GET_COLLECTION_NOT_INDEPENDENT_TIMESTAMP"
    || value.publication_head_sha !== ATTEMPT114_PUBLICATION_HEAD_SHA
    || value.workflow_run_id !== ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID) {
    fail("Attempt 114 publication collection receipt envelope is invalid");
  }
  validateProspectiveAttempt114GitHubPublicationReceipt(value.runtime_publication_receipt);
  if (value.runtime_publication_receipt.publication_commit.sha !== value.publication_head_sha
    || value.runtime_publication_receipt.workflow_run.id !== value.workflow_run_id) {
    fail("Attempt 114 collection receipt disagrees with its runtime publication receipt");
  }
  exact(value.github_public_get_evidence, ["request_count", "responses"],
    "Attempt 114 GitHub public-GET evidence");
  const plan = fixedRequests();
  if (value.github_public_get_evidence.request_count !== plan.length
    || !Array.isArray(value.github_public_get_evidence.responses)
    || value.github_public_get_evidence.responses.length !== plan.length) {
    fail(`Attempt 114 receipt must cover exactly ${plan.length} fixed public GETs`);
  }
  value.github_public_get_evidence.responses.forEach((response, index) => {
    exact(response, [
      "request_id", "canonical_url", "github_http_date", "response_byte_length",
      "response_bytes_sha256",
    ], `Attempt 114 GitHub public-GET observation ${index + 1}`);
    const expected = plan[index];
    if (response.request_id !== expected.request_id
      || response.canonical_url !== expected.canonical_url) {
      fail(`Attempt 114 GitHub public-GET observation ${index + 1} is reordered or escaped`);
    }
    githubHttpDate(response.github_http_date,
      `Attempt 114 GitHub public-GET observation ${index + 1} Date`);
    positiveInteger(response.response_byte_length,
      `Attempt 114 GitHub public-GET observation ${index + 1} byte length`);
    const maximum = expected.response_type === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES;
    if (response.response_byte_length > maximum) {
      fail(`Attempt 114 GitHub public-GET observation ${index + 1} is oversized`);
    }
    digest(response.response_bytes_sha256,
      `Attempt 114 GitHub public-GET observation ${index + 1} byte hash`);
  });
  if (new Set(value.github_public_get_evidence.responses.map(({ canonical_url: url }) => url)).size
      !== plan.length
    || latestObservation(value.github_public_get_evidence)
      !== value.runtime_publication_receipt.verification_observed_at) {
    fail("Attempt 114 GitHub public-GET evidence is duplicated or time-inconsistent");
  }
  if (latestObservation(value.github_public_get_evidence)
      >= value.runtime_publication_receipt.exclusive_deadline) {
    fail("Attempt 114 GitHub public-state observation was not strictly before the exclusive deadline");
  }
  const observations = Object.fromEntries(value.github_public_get_evidence.responses.map(
    (response) => [response.request_id, response],
  ));
  if (observations.runtime_manifest.response_bytes_sha256
      !== value.runtime_publication_receipt.published_artifacts.runtime_manifest.raw_bytes_sha256
    || observations.workflow_file.response_bytes_sha256
      !== ATTEMPT114_PUBLICATION_POLICY.workflow.file_sha256
    || observations["runtime_source:research/prospective_attempt114/protocol.json"]
      .response_bytes_sha256 !== ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256) {
    fail("Attempt 114 GitHub observations do not bind the runtime manifest or protocol bytes");
  }
  for (const sourcePath of ATTEMPT114_RUNTIME_SOURCE_PATHS) {
    if (observations[`runtime_source:${sourcePath}`].response_bytes_sha256
        !== value.runtime_publication_receipt.published_artifacts.runtime_source_files[sourcePath]) {
      fail(`Attempt 114 GitHub source observation differs from the runtime receipt: ${sourcePath}`);
    }
  }
  exact(value.executing_local_closure, [
    "runtime_manifest_matches_public_head",
    "runtime_source_files_match_public_head",
    "runtime_source_files_verified",
    "workflow_file_matches_public_head",
    "workflow_file_sha256",
  ], "Attempt 114 executing local closure");
  if (value.executing_local_closure.runtime_manifest_matches_public_head !== true
    || value.executing_local_closure.runtime_source_files_match_public_head !== true
    || value.executing_local_closure.runtime_source_files_verified
      !== ATTEMPT114_RUNTIME_SOURCE_PATHS.length
    || value.executing_local_closure.workflow_file_matches_public_head !== true
    || value.executing_local_closure.workflow_file_sha256
      !== ATTEMPT114_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 114 executing local closure is incomplete");
  }
  exact(value.assurance, [
    "fixed_unauthenticated_get_requests",
    "no_credentials_sent",
    "network_mutation_authorized",
    "public_github_platform_record_only",
    "self_contained_offline_evidence",
    "independent_cryptographic_timestamp_verified",
    "provider_origin_verified",
    "broker_execution_verified",
    "performance_inference_permitted",
    "hostile_local_filesystem_race_resistant",
  ], "Attempt 114 collection assurance");
  if (stableStringify(value.assurance) !== stableStringify({
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
  })) {
    fail("Attempt 114 collection assurance boundary is invalid");
  }
  digest(value.receipt_sha256, "Attempt 114 publication collection receipt hash");
  if (value.receipt_sha256 !== sha256(collectionReceiptBody(value))) {
    fail("Attempt 114 publication collection receipt self-hash is invalid");
  }
  return value;
}

export async function collectAttempt114GitHubPublicationEvidence({
  fetchImpl = globalThis.fetch,
  projectRoot = PROJECT_ROOT,
  headSha = ATTEMPT114_PUBLICATION_HEAD_SHA,
  workflowRunId = ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
} = {}) {
  if (typeof fetchImpl !== "function") fail("Attempt 114 publication collector requires fetch");
  const plan = attempt114GitHubPublicationRequestPlan({ headSha, workflowRunId });
  const fetched = [];
  for (const request of plan) fetched.push(await githubGet(request, fetchImpl));
  const byId = Object.fromEntries(fetched.map((entry) => [entry.request.request_id, entry]));
  const repository = validateRepository(byId.repository.value);
  const commit = validateCommit(byId.publication_commit.value);
  const run = validateWorkflowRun(byId.workflow_run.value);
  const { job, requiredSteps } = validateWorkflowJobs(byId.workflow_jobs.value, run);
  const manifestBytes = byId.runtime_manifest.bytes;
  const manifest = parseRuntimeManifest(manifestBytes, "Attempt 114 public runtime manifest");
  const workflowBytes = byId.workflow_file.bytes;
  if (rawBytesSha256(workflowBytes) !== ATTEMPT114_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 114 public workflow bytes differ from the frozen verification workflow");
  }
  const runtimeSourceBytes = Object.fromEntries(ATTEMPT114_RUNTIME_SOURCE_PATHS.map(
    (sourcePath) => [sourcePath, byId[`runtime_source:${sourcePath}`].bytes],
  ));
  const localClosure = await verifyExecutingLocalClosure(
    projectRoot,
    manifestBytes,
    runtimeSourceBytes,
    workflowBytes,
  );
  const evidence = {
    request_count: fetched.length,
    responses: fetched.map(({ observation }) => observation),
  };
  const verificationObservedAt = latestObservation(evidence);
  const runtimeReceipt = buildProspectiveAttempt114GitHubPublicationReceipt({
    repository: {
      id: repository.id,
      full_name: repository.full_name,
      public: true,
      default_branch: repository.default_branch,
    },
    publication_commit: {
      sha: commit.value.sha,
      parent_sha: commit.parentSha,
      tree_sha: commit.treeSha,
      html_url: commit.value.html_url,
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
    verification_observed_at: verificationObservedAt,
    protocol_bytes: runtimeSourceBytes["research/prospective_attempt114/protocol.json"],
    runtime_manifest_bytes: manifestBytes,
    runtime_source_bytes: runtimeSourceBytes,
  });
  verifyProspectiveAttempt114GitHubPublicationEvidence({
    receipt: runtimeReceipt,
    protocol_bytes: runtimeSourceBytes["research/prospective_attempt114/protocol.json"],
    runtime_manifest_bytes: manifestBytes,
    runtime_source_bytes: runtimeSourceBytes,
  });
  if (runtimeReceipt.published_artifacts.runtime_manifest.manifest_sha256
      !== manifest.manifest_sha256) {
    fail("Attempt 114 runtime receipt differs from the fetched manifest");
  }
  const body = {
    schema_version: ATTEMPT114_PUBLICATION_COLLECTION_SCHEMA,
    attempt_id: "finly_prospective_profitability_attempt_114",
    evidence_class: "PUBLIC_GITHUB_GET_COLLECTION_NOT_INDEPENDENT_TIMESTAMP",
    publication_head_sha: ATTEMPT114_PUBLICATION_HEAD_SHA,
    workflow_run_id: ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
    runtime_publication_receipt: runtimeReceipt,
    github_public_get_evidence: evidence,
    executing_local_closure: localClosure,
    assurance: {
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
    },
  };
  return deepFreeze(validateAttempt114GitHubPublicationCollectionReceipt({
    ...body,
    receipt_sha256: sha256(body),
  }));
}

export function canonicalAttempt114PublicationCollectionReceiptJson(value) {
  validateAttempt114GitHubPublicationCollectionReceipt(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function attempt114PublicationReceiptPlan(value) {
  const bytes = Buffer.from(canonicalAttempt114PublicationCollectionReceiptJson(value), "utf8");
  const filename = `${value.receipt_sha256.slice(7)}.json`;
  if (!RECEIPT_FILENAME.test(filename)) fail("Attempt 114 publication receipt filename is invalid");
  return Object.freeze({
    filename,
    relativePath: `${ATTEMPT114_PUBLICATION_RECEIPT_DIRECTORY}/${filename}`,
    bytes,
  });
}

async function ensureSafeReceiptDirectory(projectRoot) {
  const rootStatus = await lstat(projectRoot).catch(() => fail("receipt project root is missing"));
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("receipt project root must be a real directory");
  }
  const root = await realpath(projectRoot);
  let current = root;
  for (const component of ATTEMPT114_PUBLICATION_RECEIPT_DIRECTORY.split("/")) {
    if (!/^[a-z0-9_]+$/iu.test(component)) fail("receipt directory policy is invalid");
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
      fail("receipt directory contains a symlink or non-directory component");
    }
  }
  if (await realpath(current) !== current) {
    fail("receipt directory realpath is not fixed beneath the project root");
  }
  return current;
}

async function syncDirectory(directory) {
  const handle = await open(directory, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function verifyExistingReceipt(receiptPath, expectedBytes) {
  let handle;
  try {
    handle = await open(
      receiptPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW | FS_CONSTANTS.O_NONBLOCK,
    );
    const status = await handle.stat();
    if (!status.isFile() || status.size !== expectedBytes.length || status.size > MAX_RAW_BYTES) {
      fail("existing Attempt 114 receipt is non-regular, oversized, or incorrectly addressed");
    }
    const observed = await handle.readFile();
    if (!observed.equals(expectedBytes)) {
      fail("existing Attempt 114 receipt differs at the same content address");
    }
    const finalStatus = await lstat(receiptPath);
    if (finalStatus.isSymbolicLink()
      || !finalStatus.isFile()
      || finalStatus.dev !== status.dev
      || finalStatus.ino !== status.ino
      || await realpath(receiptPath) !== receiptPath) {
      fail("existing Attempt 114 receipt changed identity while it was verified");
    }
  } catch (error) {
    if (error?.message?.startsWith("existing Attempt 114 receipt")) throw error;
    fail("existing Attempt 114 receipt cannot be safely verified");
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function publishAttempt114GitHubPublicationReceiptWriteOnce(value, {
  projectRoot = PROJECT_ROOT,
} = {}) {
  const plan = attempt114PublicationReceiptPlan(value);
  const directory = await ensureSafeReceiptDirectory(projectRoot);
  const directoryStatus = await lstat(directory);
  const finalPath = path.resolve(directory, plan.filename);
  const stagePath = path.resolve(directory, `.receipt-${process.pid}-${randomUUID()}.tmp`);
  let stageHandle;
  let disposition;
  try {
    stageHandle = await open(
      stagePath,
      FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_NOFOLLOW,
      0o600,
    );
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
  const finalDirectoryStatus = await lstat(directory);
  if (finalDirectoryStatus.isSymbolicLink()
    || !finalDirectoryStatus.isDirectory()
    || finalDirectoryStatus.dev !== directoryStatus.dev
    || finalDirectoryStatus.ino !== directoryStatus.ino
    || await realpath(directory) !== directory) {
    fail("Attempt 114 receipt directory changed identity during publication");
  }
  await syncDirectory(directory);
  return Object.freeze({
    disposition,
    path: plan.relativePath,
    receipt_sha256: value.receipt_sha256,
  });
}

export function parseAttempt114GitHubPublicationCli(argv) {
  if (!Array.isArray(argv)) fail("CLI arguments must be an array");
  if (argv.length === 0) {
    return Object.freeze({
      headSha: ATTEMPT114_PUBLICATION_HEAD_SHA,
      workflowRunId: ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
    });
  }
  if (argv.length !== 4) {
    fail("usage: node scripts/verify_attempt114_github_publication.mjs --head-sha <frozen-sha> --run-id <frozen-id>");
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!new Set(["--head-sha", "--run-id"]).has(key)
      || typeof value !== "string"
      || value.length === 0
      || values.has(key)) {
      fail("usage: node scripts/verify_attempt114_github_publication.mjs --head-sha <frozen-sha> --run-id <frozen-id>");
    }
    values.set(key, value);
  }
  if (values.get("--head-sha") !== ATTEMPT114_PUBLICATION_HEAD_SHA
    || values.get("--run-id") !== String(ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID)) {
    fail("CLI accepts only the frozen Attempt 114 publication head and workflow run");
  }
  return Object.freeze({
    headSha: ATTEMPT114_PUBLICATION_HEAD_SHA,
    workflowRunId: ATTEMPT114_PUBLICATION_WORKFLOW_RUN_ID,
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseAttempt114GitHubPublicationCli(argv);
  const receipt = await collectAttempt114GitHubPublicationEvidence(options);
  const publication = await publishAttempt114GitHubPublicationReceiptWriteOnce(receipt);
  process.stdout.write(`${JSON.stringify(publication, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
