import { createHash, randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sha256, stableStringify } from "../lib/canonical.mjs";
import {
  ATTEMPT115_RUNTIME_SOURCE_PATHS,
  validateProspectiveAttempt115RuntimeManifest,
} from "../research/prospective_attempt115/runtime.mjs";

export const ATTEMPT115_ID = "finly_prospective_profitability_attempt_115";
export const ATTEMPT115_RUNTIME_MANIFEST_SCHEMA = "finly_attempt115_runtime_manifest.v1";
export const ATTEMPT115_PUBLICATION_RECEIPT_SCHEMA =
  "finly_attempt115_github_publication_receipt.v1";
export const ATTEMPT115_PUBLICATION_DEADLINE = "2026-08-31T20:00:00.000Z";
export const ATTEMPT115_PROTOCOL_PATH =
  "research/downside_semivolatility_challenger_protocol.json";
export const ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256 =
  "sha256:34d30a46e70c07b27fad637b1948262f953662b43e30cbbaf86b84927dbe0e53";
export const ATTEMPT115_PROTOCOL_SHA256 =
  "sha256:340ba21e8e3404bd42adcd8e4e30ea5f0f327ee2d891988564ca3f0654657619";
export const ATTEMPT115_ACTIVATION_PATH = "research/prospective_attempt115/activation.json";
export const ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256 =
  "sha256:6519ccca48848b8b8d20593c011a11bd2b3f98c608cf4c1fbd61bf2347841255";
export const ATTEMPT115_ACTIVATION_SHA256 =
  "sha256:96f03b0a592f7f8358507ffa04e04ba28f8f51fdbe916975982ce8b00f6afc51";
export const ATTEMPT115_RUNTIME_MANIFEST_PATH =
  "research/prospective_attempt115/runtime_manifest.json";
export const ATTEMPT115_VERIFIER_PATH = "scripts/verify_attempt115_github_publication.mjs";
export const ATTEMPT115_PUBLICATION_RECEIPT_DIRECTORY =
  "research/prospective_attempt115/publication_receipts";
export const ATTEMPT115_PROTOCOL_REGISTRATION_HEAD_SHA =
  "db342858a1014900a61d52fe7d759483c893a932";

export const ATTEMPT115_GITHUB_PUBLICATION_POLICY = Object.freeze({
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
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
  return value;
}

function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail(`${label} must be a canonical UTC instant`);
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
  if (!Buffer.isBuffer(value) && typeof value !== "string") fail(`${label} must be bytes or text`);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (bytes.length < 1 || bytes.length > maximum) {
    fail(`${label} must contain between 1 and ${maximum} bytes`);
  }
  return bytes;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function safeRepositoryPath(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512
    || path.posix.isAbsolute(value) || path.posix.normalize(value) !== value
    || value.startsWith("../") || value.includes("/../") || value.includes("//")) {
    fail(`${label} must be a safe repository-relative path`);
  }
  return value;
}

function canonicalPrettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function manifestBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "manifest_sha256"));
}

export function validateAttempt115RuntimeManifest(value) {
  exact(value, [
    "schema_version", "attempt_id", "manifest_kind", "frozen_at", "publication_deadline",
    "publication_deadline_exclusive", "protocol", "activation", "runtime_source_files",
    "runtime_source_files_sha256", "authority", "evaluation_gates", "assurance",
    "claim_boundary", "manifest_sha256",
  ], "Attempt 115 runtime manifest");
  if (value.schema_version !== ATTEMPT115_RUNTIME_MANIFEST_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || typeof value.manifest_kind !== "string" || value.manifest_kind.length < 1) {
    fail("Attempt 115 runtime manifest envelope is invalid");
  }
  instant(value.frozen_at, "Attempt 115 runtime manifest frozen_at");
  if (value.frozen_at >= ATTEMPT115_PUBLICATION_DEADLINE
    || value.publication_deadline !== ATTEMPT115_PUBLICATION_DEADLINE
    || value.publication_deadline_exclusive !== true) {
    fail("Attempt 115 runtime manifest does not preserve its exclusive pre-signal deadline");
  }
  exact(value.protocol, ["path", "raw_bytes_sha256", "protocol_sha256"],
    "Attempt 115 runtime protocol binding");
  if (value.protocol.path !== ATTEMPT115_PROTOCOL_PATH
    || value.protocol.raw_bytes_sha256 !== ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256
    || value.protocol.protocol_sha256 !== ATTEMPT115_PROTOCOL_SHA256) {
    fail("Attempt 115 runtime manifest changes the registered protocol identity");
  }
  exact(value.activation, ["path", "raw_bytes_sha256", "activation_sha256"],
    "Attempt 115 runtime activation binding");
  if (value.activation.path !== ATTEMPT115_ACTIVATION_PATH) {
    fail("Attempt 115 runtime manifest changes the activation path");
  }
  digest(value.activation.raw_bytes_sha256, "Attempt 115 activation raw-byte hash");
  digest(value.activation.activation_sha256, "Attempt 115 activation self-hash");
  if (value.activation.raw_bytes_sha256 !== ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256
    || value.activation.activation_sha256 !== ATTEMPT115_ACTIVATION_SHA256) {
    fail("Attempt 115 runtime manifest changes the registered activation identity");
  }
  plainObject(value.runtime_source_files, "Attempt 115 runtime source map");
  const sourcePaths = Object.keys(value.runtime_source_files);
  if (sourcePaths.length < 1
    || stableStringify(sourcePaths) !== stableStringify([...sourcePaths].sort((a, b) => a.localeCompare(b)))) {
    fail("Attempt 115 runtime source paths must be non-empty and lexicographically ordered");
  }
  for (const sourcePath of sourcePaths) {
    safeRepositoryPath(sourcePath, `Attempt 115 runtime source path ${sourcePath}`);
    digest(value.runtime_source_files[sourcePath], `Attempt 115 runtime source hash ${sourcePath}`);
  }
  for (const requiredPath of [ATTEMPT115_PROTOCOL_PATH, ATTEMPT115_ACTIVATION_PATH,
    ATTEMPT115_VERIFIER_PATH]) {
    if (!Object.hasOwn(value.runtime_source_files, requiredPath)) {
      fail(`Attempt 115 runtime source map omits required path: ${requiredPath}`);
    }
  }
  if (Object.hasOwn(value.runtime_source_files, ATTEMPT115_RUNTIME_MANIFEST_PATH)) {
    fail("Attempt 115 runtime manifest cannot recursively bind its own bytes");
  }
  if (value.runtime_source_files[ATTEMPT115_PROTOCOL_PATH]
      !== ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256
    || value.runtime_source_files[ATTEMPT115_ACTIVATION_PATH]
      !== value.activation.raw_bytes_sha256) {
    fail("Attempt 115 source map disagrees with the protocol or activation binding");
  }
  digest(value.runtime_source_files_sha256, "Attempt 115 runtime source-map hash");
  if (value.runtime_source_files_sha256 !== sha256(value.runtime_source_files)) {
    fail("Attempt 115 runtime source-map hash is invalid");
  }
  for (const [label, objectValue] of [["authority", value.authority],
    ["evaluation gates", value.evaluation_gates], ["assurance", value.assurance]]) {
    plainObject(objectValue, `Attempt 115 runtime ${label}`);
  }
  if (value.authority.broker_mutation_authorized !== false
    || value.evaluation_gates.protocol_activation_runtime_publication_verified !== false
    || value.evaluation_gates.inference_enabled !== false
    || value.assurance.performance_inference_permitted !== false
    || typeof value.claim_boundary !== "string" || value.claim_boundary.length < 1) {
    fail("Attempt 115 runtime manifest opens authority or evaluation gates prematurely");
  }
  digest(value.manifest_sha256, "Attempt 115 runtime manifest self-hash");
  if (value.manifest_sha256 !== sha256(manifestBody(value))) {
    fail("Attempt 115 runtime manifest self-hash is invalid");
  }
  validateProspectiveAttempt115RuntimeManifest(value);
  if (stableStringify(sourcePaths) !== stableStringify(ATTEMPT115_RUNTIME_SOURCE_PATHS)) {
    fail("Attempt 115 runtime manifest differs from the authoritative frozen source list");
  }
  return value;
}

export function parseAttempt115RuntimeManifestBytes(value, label = "Attempt 115 runtime manifest") {
  const text = boundedBytes(value, label).toString("utf8");
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  if (text !== canonicalPrettyJson(manifest)) {
    fail(`${label} is not canonical pretty JSON with one trailing newline`);
  }
  return validateAttempt115RuntimeManifest(manifest);
}

function encodeRepositoryPath(value) {
  return value.split("/").map((component) => encodeURIComponent(component)).join("/");
}

function apiUrl(route) {
  const url = new URL(route, ATTEMPT115_GITHUB_PUBLICATION_POLICY.api_origin);
  if (url.origin !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.api_origin || url.protocol !== "https:") {
    fail("Attempt 115 GitHub API route escaped the fixed HTTPS origin");
  }
  return url.href;
}

function rawUrl(headSha, sourcePath) {
  commitSha(headSha, "Attempt 115 raw-file head SHA");
  safeRepositoryPath(sourcePath, "Attempt 115 raw-file path");
  const route = `/owlsowo/finly-bot/${headSha}/${encodeRepositoryPath(sourcePath)}`;
  const url = new URL(route, ATTEMPT115_GITHUB_PUBLICATION_POLICY.raw_origin);
  if (url.origin !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.raw_origin
    || url.protocol !== "https:") {
    fail("Attempt 115 raw GitHub route escaped the fixed HTTPS origin");
  }
  return url.href;
}

function fixedRequests({
  headSha,
  workflowRunId,
  runtimeManifest = null,
  runtimeSourcePaths = null,
}) {
  commitSha(headSha, "Attempt 115 publication head SHA");
  positiveInteger(workflowRunId, "Attempt 115 workflow run ID");
  if (runtimeManifest !== null) validateAttempt115RuntimeManifest(runtimeManifest);
  const sourcePaths = runtimeManifest === null
    ? runtimeSourcePaths
    : Object.keys(runtimeManifest.runtime_source_files);
  if (!Array.isArray(sourcePaths) || sourcePaths.length < 1
    || sourcePaths.some((sourcePath) => {
      safeRepositoryPath(sourcePath, "Attempt 115 runtime source request path");
      return false;
    })
    || stableStringify(sourcePaths)
      !== stableStringify([...sourcePaths].sort((a, b) => a.localeCompare(b)))) {
    fail("Attempt 115 request plan requires ordered frozen runtime source paths");
  }
  return [
    { request_id: "repository", response_type: "json", canonical_url: apiUrl("/repos/owlsowo/finly-bot") },
    { request_id: "publication_commit", response_type: "json", canonical_url: apiUrl(`/repos/owlsowo/finly-bot/commits/${headSha}?per_page=100&page=1`) },
    { request_id: "workflow_run", response_type: "json", canonical_url: apiUrl(`/repos/owlsowo/finly-bot/actions/runs/${workflowRunId}`) },
    { request_id: "workflow_jobs", response_type: "json", canonical_url: apiUrl(`/repos/owlsowo/finly-bot/actions/runs/${workflowRunId}/jobs?per_page=100`) },
    { request_id: "workflow_file", response_type: "raw", canonical_url: rawUrl(headSha, ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path) },
    { request_id: "runtime_manifest", response_type: "raw", canonical_url: rawUrl(headSha, ATTEMPT115_RUNTIME_MANIFEST_PATH) },
    ...sourcePaths.filter((sourcePath) => (
      sourcePath !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path
    )).map((sourcePath) => ({
      request_id: `runtime_source:${sourcePath}`,
      response_type: "raw",
      canonical_url: rawUrl(headSha, sourcePath),
    })),
  ];
}

export function attempt115GitHubPublicationRequestPlan({
  headSha,
  workflowRunId,
  runtimeManifest,
}) {
  return deepFreeze(fixedRequests({ headSha, workflowRunId, runtimeManifest })
    .map((request) => ({ ...request })));
}

async function readRegularFileWithoutSymlink(projectRoot, relativePath) {
  safeRepositoryPath(relativePath, "Attempt 115 local source path");
  const rootStatus = await lstat(projectRoot).catch(() => fail("Attempt 115 project root is missing"));
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("Attempt 115 project root must be a real directory");
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

async function loadLocalClosure(projectRoot) {
  const manifestBytes = await readRegularFileWithoutSymlink(
    projectRoot,
    ATTEMPT115_RUNTIME_MANIFEST_PATH,
  );
  const manifest = parseAttempt115RuntimeManifestBytes(manifestBytes);
  const sourceBytes = {};
  for (const [sourcePath, expectedHash] of Object.entries(manifest.runtime_source_files)) {
    const bytes = await readRegularFileWithoutSymlink(projectRoot, sourcePath);
    if (rawBytesSha256(bytes) !== expectedHash) {
      fail(`Attempt 115 executing local source differs from its manifest: ${sourcePath}`);
    }
    sourceBytes[sourcePath] = bytes;
  }
  const workflowBytes = await readRegularFileWithoutSymlink(
    projectRoot,
    ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path,
  );
  if (rawBytesSha256(workflowBytes)
      !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 115 executing workflow differs from its frozen hash");
  }
  return { manifest, manifestBytes, sourceBytes, workflowBytes };
}

async function githubGet(request, fetchImpl, registry) {
  exact(request, ["request_id", "response_type", "canonical_url"],
    "Attempt 115 fixed GitHub request");
  const expected = registry.find(({ request_id: requestId }) => requestId === request.request_id);
  if (!expected || stableStringify(expected) !== stableStringify(request)) {
    fail("Attempt 115 GitHub request differs from the fixed request registry");
  }
  const url = new URL(request.canonical_url);
  if (!new Set([ATTEMPT115_GITHUB_PUBLICATION_POLICY.api_origin,
    ATTEMPT115_GITHUB_PUBLICATION_POLICY.raw_origin]).has(url.origin)
    || url.protocol !== "https:") {
    fail("Attempt 115 GitHub request escaped the allowlisted HTTPS origins");
  }
  const headers = {
    accept: request.response_type === "json"
      ? "application/vnd.github+json"
      : "application/octet-stream",
    "user-agent": "finly-attempt115-publication-verifier/1.0",
  };
  if (request.response_type === "json") {
    headers["x-github-api-version"] = ATTEMPT115_GITHUB_PUBLICATION_POLICY.api_version;
  }
  let response;
  try {
    response = await fetchImpl(request.canonical_url, {
      method: "GET",
      redirect: "error",
      headers,
    });
  } catch {
    fail(`Attempt 115 public GET failed: ${request.request_id}`);
  }
  if (!response || response.ok !== true || response.status !== 200) {
    fail(`Attempt 115 public GET did not return HTTP 200: ${request.request_id}`);
  }
  if (response.redirected === true || response.url !== request.canonical_url) {
    fail(`Attempt 115 public GET returned from an unexpected URL: ${request.request_id}`);
  }
  const dateHeader = response.headers?.get?.("date");
  githubHttpDate(dateHeader, `Attempt 115 public GET ${request.request_id} Date header`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const maximum = request.response_type === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES;
  boundedBytes(bytes, `Attempt 115 public GET ${request.request_id}`, maximum);
  let value = bytes;
  if (request.response_type === "json") {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(`Attempt 115 public GET is not valid JSON: ${request.request_id}`);
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
  plainObject(value, "Attempt 115 GitHub repository response");
  const expected = ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository;
  if (value.id !== expected.id || value.full_name !== expected.full_name
    || value.private !== false || value.visibility !== "public"
    || value.default_branch !== expected.default_branch || value.fork !== false
    || value.archived !== false || value.disabled !== false) {
    fail("Attempt 115 GitHub repository identity or public-state gate failed");
  }
  return value;
}

function validateCommit(value, headSha) {
  plainObject(value, "Attempt 115 GitHub publication commit response");
  if (value.sha !== headSha
    || value.html_url !== `https://github.com/owlsowo/finly-bot/commit/${headSha}`
    || !Array.isArray(value.parents) || value.parents.length !== 1
    || value.parents[0]?.sha !== ATTEMPT115_PROTOCOL_REGISTRATION_HEAD_SHA) {
    fail("Attempt 115 publication commit is not a direct extension of its registered protocol");
  }
  commitSha(value.sha, "Attempt 115 GitHub publication commit SHA");
  const treeSha = commitSha(value.commit?.tree?.sha, "Attempt 115 GitHub publication tree SHA");
  return { treeSha };
}

function validateWorkflowRun(value, workflowRunId, headSha) {
  plainObject(value, "Attempt 115 GitHub workflow-run response");
  const expected = ATTEMPT115_GITHUB_PUBLICATION_POLICY;
  if (value.id !== workflowRunId || value.workflow_id !== expected.workflow.id
    || value.name !== expected.workflow.name || value.path !== expected.workflow.path
    || value.event !== "push" || value.head_branch !== expected.repository.default_branch
    || value.head_sha !== headSha || value.status !== "completed" || value.conclusion !== "success"
    || value.html_url !== `https://github.com/owlsowo/finly-bot/actions/runs/${workflowRunId}`) {
    fail("Attempt 115 GitHub workflow identity, linkage, or success gate failed");
  }
  positiveInteger(value.run_attempt, "Attempt 115 GitHub workflow run attempt");
  githubInstant(value.created_at, "Attempt 115 GitHub workflow created_at");
  githubInstant(value.updated_at, "Attempt 115 GitHub workflow updated_at");
  if (Date.parse(value.updated_at) < Date.parse(value.created_at)
    || Date.parse(value.created_at) >= Date.parse(ATTEMPT115_PUBLICATION_DEADLINE)
    || Date.parse(value.updated_at) >= Date.parse(ATTEMPT115_PUBLICATION_DEADLINE)) {
    fail("Attempt 115 GitHub workflow did not complete strictly before the deadline");
  }
  for (const label of ["repository", "head_repository"]) {
    const repository = plainObject(value[label], `Attempt 115 workflow ${label}`);
    if (repository.id !== expected.repository.id
      || repository.full_name !== expected.repository.full_name
      || repository.private !== false) {
      fail(`Attempt 115 workflow ${label} identity gate failed`);
    }
  }
  return value;
}

function validateWorkflowJobs(value, run) {
  plainObject(value, "Attempt 115 GitHub jobs response");
  if (!Array.isArray(value.jobs) || value.total_count !== value.jobs.length
    || value.jobs.length < 1 || value.jobs.length > 100) {
    fail("Attempt 115 GitHub jobs response is incomplete or unbounded");
  }
  const matches = value.jobs.filter(({ name }) => (
    name === ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.job_name
  ));
  if (matches.length !== 1) fail("Attempt 115 GitHub verification job is absent or ambiguous");
  const job = plainObject(matches[0], "Attempt 115 GitHub verification job");
  if (job.head_sha !== run.head_sha || job.status !== "completed"
    || job.conclusion !== "success" || !Array.isArray(job.steps)) {
    fail("Attempt 115 GitHub verification job linkage or success gate failed");
  }
  positiveInteger(job.id, "Attempt 115 GitHub verification job id");
  githubInstant(job.started_at, "Attempt 115 GitHub verification job started_at");
  githubInstant(job.completed_at, "Attempt 115 GitHub verification job completed_at");
  if (Date.parse(job.started_at) < Date.parse(run.created_at)
    || Date.parse(job.completed_at) < Date.parse(job.started_at)
    || Date.parse(job.completed_at) > Date.parse(run.updated_at)
    || Date.parse(job.completed_at) >= Date.parse(ATTEMPT115_PUBLICATION_DEADLINE)) {
    fail("Attempt 115 GitHub verification job timing is invalid");
  }
  const requiredSteps = ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps
    .map((requiredName) => {
      const matchesForName = job.steps.filter(({ name }) => name === requiredName);
      if (matchesForName.length !== 1) {
        fail(`Attempt 115 required workflow step is absent or ambiguous: ${requiredName}`);
      }
      const step = matchesForName[0];
      if (step.status !== "completed" || step.conclusion !== "success") {
        fail(`Attempt 115 required workflow step did not succeed: ${requiredName}`);
      }
      positiveInteger(step.number, `Attempt 115 workflow step number: ${requiredName}`);
      githubInstant(step.started_at, `Attempt 115 workflow step started_at: ${requiredName}`);
      githubInstant(step.completed_at, `Attempt 115 workflow step completed_at: ${requiredName}`);
      if (Date.parse(step.started_at) < Date.parse(job.started_at)
        || Date.parse(step.completed_at) < Date.parse(step.started_at)
        || Date.parse(step.completed_at) > Date.parse(job.completed_at)
        || Date.parse(step.completed_at) >= Date.parse(ATTEMPT115_PUBLICATION_DEADLINE)) {
        fail(`Attempt 115 required workflow step timing is invalid: ${requiredName}`);
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
  if (new Set(requiredSteps.map(({ number }) => number)).size !== requiredSteps.length) {
    fail("Attempt 115 required workflow steps reuse a step number");
  }
  return { job, requiredSteps };
}

function latestObservation(evidence) {
  return evidence.responses
    .map(({ github_http_date: value }) => new Date(value).toISOString())
    .reduce((latest, value) => value > latest ? value : latest);
}

function receiptBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receipt_sha256"));
}

export function validateAttempt115GitHubPublicationReceipt(value) {
  exact(value, [
    "schema_version", "attempt_id", "evidence_class", "exclusive_deadline", "repository",
    "publication_commit", "workflow_run", "published_artifacts", "github_public_get_evidence",
    "executing_local_closure", "verification_observed_at", "assurance", "receipt_sha256",
  ], "Attempt 115 GitHub publication receipt");
  if (value.schema_version !== ATTEMPT115_PUBLICATION_RECEIPT_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || value.evidence_class !== "PUBLIC_GITHUB_GET_COLLECTION_NOT_INDEPENDENT_TIMESTAMP"
    || value.exclusive_deadline !== ATTEMPT115_PUBLICATION_DEADLINE) {
    fail("Attempt 115 publication receipt envelope is invalid");
  }
  exact(value.repository, ["id", "full_name", "public", "default_branch"],
    "Attempt 115 publication receipt repository");
  if (stableStringify(value.repository) !== stableStringify({
    id: ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository.id,
    full_name: ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository.full_name,
    public: true,
    default_branch: ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository.default_branch,
  })) fail("Attempt 115 publication receipt repository identity is invalid");
  exact(value.publication_commit, ["sha", "parent_sha", "tree_sha", "html_url"],
    "Attempt 115 publication receipt commit");
  commitSha(value.publication_commit.sha, "Attempt 115 receipt commit SHA");
  commitSha(value.publication_commit.parent_sha, "Attempt 115 receipt parent SHA");
  commitSha(value.publication_commit.tree_sha, "Attempt 115 receipt tree SHA");
  if (value.publication_commit.parent_sha !== ATTEMPT115_PROTOCOL_REGISTRATION_HEAD_SHA
    || value.publication_commit.html_url
      !== `https://github.com/owlsowo/finly-bot/commit/${value.publication_commit.sha}`) {
    fail("Attempt 115 publication receipt commit linkage is invalid");
  }
  exact(value.workflow_run, [
    "id", "workflow_id", "name", "path", "event", "head_branch", "head_sha",
    "run_attempt", "status", "conclusion", "created_at", "updated_at", "html_url",
    "verification_job",
  ], "Attempt 115 publication receipt workflow run");
  positiveInteger(value.workflow_run.id, "Attempt 115 receipt workflow run id");
  positiveInteger(value.workflow_run.run_attempt, "Attempt 115 receipt workflow run attempt");
  commitSha(value.workflow_run.head_sha, "Attempt 115 receipt workflow head SHA");
  githubInstant(value.workflow_run.created_at, "Attempt 115 receipt workflow created_at");
  githubInstant(value.workflow_run.updated_at, "Attempt 115 receipt workflow updated_at");
  exact(value.workflow_run.verification_job, [
    "id", "name", "head_sha", "status", "conclusion", "started_at", "completed_at",
    "required_steps",
  ], "Attempt 115 receipt verification job");
  positiveInteger(value.workflow_run.verification_job.id,
    "Attempt 115 receipt verification job id");
  commitSha(value.workflow_run.verification_job.head_sha,
    "Attempt 115 receipt verification job head SHA");
  githubInstant(value.workflow_run.verification_job.started_at,
    "Attempt 115 receipt verification job started_at");
  githubInstant(value.workflow_run.verification_job.completed_at,
    "Attempt 115 receipt verification job completed_at");
  if (!Array.isArray(value.workflow_run.verification_job.required_steps)
    || value.workflow_run.verification_job.required_steps.length
      !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps.length) {
    fail("Attempt 115 receipt required workflow steps are incomplete");
  }
  value.workflow_run.verification_job.required_steps.forEach((step, index) => {
    exact(step, ["name", "number", "status", "conclusion", "started_at", "completed_at"],
      `Attempt 115 receipt workflow step ${index + 1}`);
    positiveInteger(step.number, `Attempt 115 receipt workflow step ${index + 1} number`);
    githubInstant(step.started_at, `Attempt 115 receipt workflow step ${index + 1} started_at`);
    githubInstant(step.completed_at, `Attempt 115 receipt workflow step ${index + 1} completed_at`);
    if (step.name
        !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps[index]
      || step.status !== "completed" || step.conclusion !== "success"
      || Date.parse(step.started_at)
        < Date.parse(value.workflow_run.verification_job.started_at)
      || Date.parse(step.completed_at) < Date.parse(step.started_at)
      || Date.parse(step.completed_at)
        > Date.parse(value.workflow_run.verification_job.completed_at)
      || Date.parse(step.completed_at)
        >= Date.parse(ATTEMPT115_PUBLICATION_DEADLINE)) {
      fail(`Attempt 115 receipt workflow step ${index + 1} is invalid`);
    }
  });
  if (new Set(value.workflow_run.verification_job.required_steps.map(({ number }) => number)).size
      !== value.workflow_run.verification_job.required_steps.length) {
    fail("Attempt 115 receipt workflow steps reuse a number");
  }
  if (value.workflow_run.head_sha !== value.publication_commit.sha
    || value.workflow_run.workflow_id !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.id
    || value.workflow_run.name !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.name
    || value.workflow_run.path !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path
    || value.workflow_run.event !== "push"
    || value.workflow_run.head_branch
      !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.repository.default_branch
    || value.workflow_run.status !== "completed" || value.workflow_run.conclusion !== "success"
    || value.workflow_run.html_url
      !== `https://github.com/owlsowo/finly-bot/actions/runs/${value.workflow_run.id}`
    || value.workflow_run.verification_job.name
      !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.job_name
    || value.workflow_run.verification_job.head_sha !== value.workflow_run.head_sha
    || value.workflow_run.verification_job.status !== "completed"
    || value.workflow_run.verification_job.conclusion !== "success"
    || Date.parse(value.workflow_run.updated_at) < Date.parse(value.workflow_run.created_at)
    || Date.parse(value.workflow_run.verification_job.started_at)
      < Date.parse(value.workflow_run.created_at)
    || Date.parse(value.workflow_run.verification_job.completed_at)
      > Date.parse(value.workflow_run.updated_at)
    || value.workflow_run.updated_at >= ATTEMPT115_PUBLICATION_DEADLINE
    || value.workflow_run.verification_job?.completed_at >= ATTEMPT115_PUBLICATION_DEADLINE) {
    fail("Attempt 115 receipt workflow does not bind a strict pre-deadline publication");
  }
  exact(value.published_artifacts,
    ["protocol", "activation", "runtime_manifest", "runtime_source_files"],
    "Attempt 115 receipt published artifacts");
  exact(value.published_artifacts.protocol,
    ["path", "raw_bytes_sha256", "protocol_sha256"], "Attempt 115 published protocol");
  if (value.published_artifacts.protocol.path !== ATTEMPT115_PROTOCOL_PATH
    || value.published_artifacts.protocol.raw_bytes_sha256
      !== ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256
    || value.published_artifacts.protocol.protocol_sha256 !== ATTEMPT115_PROTOCOL_SHA256) {
    fail("Attempt 115 published protocol identity is invalid");
  }
  exact(value.published_artifacts.activation,
    ["path", "raw_bytes_sha256", "activation_sha256"], "Attempt 115 published activation");
  exact(value.published_artifacts.runtime_manifest,
    ["path", "raw_bytes_sha256", "manifest_sha256", "runtime_source_files_sha256"],
    "Attempt 115 published runtime manifest");
  if (value.published_artifacts.activation.path !== ATTEMPT115_ACTIVATION_PATH
    || value.published_artifacts.activation.raw_bytes_sha256
      !== ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256
    || value.published_artifacts.activation.activation_sha256
      !== ATTEMPT115_ACTIVATION_SHA256
    || value.published_artifacts.runtime_manifest.path !== ATTEMPT115_RUNTIME_MANIFEST_PATH) {
    fail("Attempt 115 published activation or runtime-manifest path is invalid");
  }
  for (const [label, digestValue] of [
    ["activation raw hash", value.published_artifacts.activation.raw_bytes_sha256],
    ["activation self hash", value.published_artifacts.activation.activation_sha256],
    ["runtime manifest raw hash", value.published_artifacts.runtime_manifest.raw_bytes_sha256],
    ["runtime manifest self hash", value.published_artifacts.runtime_manifest.manifest_sha256],
    ["runtime source-map hash", value.published_artifacts.runtime_manifest.runtime_source_files_sha256],
  ]) digest(digestValue, `Attempt 115 published ${label}`);
  plainObject(value.published_artifacts.runtime_source_files,
    "Attempt 115 published runtime source map");
  const sourcePaths = Object.keys(value.published_artifacts.runtime_source_files);
  if (sourcePaths.length < 1
    || stableStringify(sourcePaths)
      !== stableStringify([...sourcePaths].sort((a, b) => a.localeCompare(b)))
    || stableStringify(sourcePaths) !== stableStringify(ATTEMPT115_RUNTIME_SOURCE_PATHS)) {
    fail("Attempt 115 published runtime source paths are not ordered and complete");
  }
  sourcePaths.forEach((sourcePath) => digest(
    value.published_artifacts.runtime_source_files[sourcePath],
    `Attempt 115 published runtime source ${sourcePath}`,
  ));
  if (value.published_artifacts.runtime_source_files_sha256 !== undefined) {
    fail("Attempt 115 source-map hash belongs inside the runtime-manifest binding");
  }
  if (value.published_artifacts.runtime_manifest.runtime_source_files_sha256
      !== sha256(value.published_artifacts.runtime_source_files)
    || value.published_artifacts.runtime_source_files[ATTEMPT115_PROTOCOL_PATH]
      !== value.published_artifacts.protocol.raw_bytes_sha256
    || value.published_artifacts.runtime_source_files[ATTEMPT115_ACTIVATION_PATH]
      !== value.published_artifacts.activation.raw_bytes_sha256
    || !Object.hasOwn(value.published_artifacts.runtime_source_files, ATTEMPT115_VERIFIER_PATH)) {
    fail("Attempt 115 published source map does not bind its activation, protocol, or verifier");
  }
  exact(value.github_public_get_evidence, ["request_count", "responses"],
    "Attempt 115 receipt public-GET evidence");
  const plan = fixedRequests({
    headSha: value.publication_commit.sha,
    workflowRunId: value.workflow_run.id,
    runtimeSourcePaths: sourcePaths,
  });
  if (value.github_public_get_evidence.request_count !== plan.length
    || !Array.isArray(value.github_public_get_evidence.responses)
    || value.github_public_get_evidence.responses.length !== plan.length) {
    fail("Attempt 115 receipt does not cover its exact public-GET plan");
  }
  value.github_public_get_evidence.responses.forEach((response, index) => {
    exact(response, ["request_id", "canonical_url", "github_http_date",
      "response_byte_length", "response_bytes_sha256"],
    `Attempt 115 public-GET observation ${index + 1}`);
    if (response.request_id !== plan[index].request_id
      || response.canonical_url !== plan[index].canonical_url) {
      fail(`Attempt 115 public-GET observation ${index + 1} is reordered or escaped`);
    }
    githubHttpDate(response.github_http_date,
      `Attempt 115 public-GET observation ${index + 1} Date`);
    positiveInteger(response.response_byte_length,
      `Attempt 115 public-GET observation ${index + 1} byte length`);
    const maximum = plan[index].response_type === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES;
    if (response.response_byte_length > maximum) {
      fail(`Attempt 115 public-GET observation ${index + 1} exceeds its byte limit`);
    }
    digest(response.response_bytes_sha256,
      `Attempt 115 public-GET observation ${index + 1} byte hash`);
  });
  if (new Set(value.github_public_get_evidence.responses.map(({ canonical_url: url }) => url)).size
      !== plan.length) {
    fail("Attempt 115 public-GET observations contain duplicate URLs");
  }
  const observations = Object.fromEntries(value.github_public_get_evidence.responses.map(
    (response) => [response.request_id, response],
  ));
  if (observations.workflow_file.response_bytes_sha256
      !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.file_sha256
    || observations.runtime_manifest.response_bytes_sha256
      !== value.published_artifacts.runtime_manifest.raw_bytes_sha256) {
    fail("Attempt 115 public-GET observations do not bind the workflow or runtime manifest");
  }
  for (const sourcePath of sourcePaths) {
    const observation = sourcePath === ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path
      ? observations.workflow_file
      : observations[`runtime_source:${sourcePath}`];
    if (observation.response_bytes_sha256
        !== value.published_artifacts.runtime_source_files[sourcePath]) {
      fail(`Attempt 115 public-GET source observation differs: ${sourcePath}`);
    }
  }
  instant(value.verification_observed_at, "Attempt 115 receipt verification observation");
  if (latestObservation(value.github_public_get_evidence) !== value.verification_observed_at
    || value.verification_observed_at >= ATTEMPT115_PUBLICATION_DEADLINE
    || value.verification_observed_at < value.workflow_run.updated_at) {
    fail("Attempt 115 public-state observation is not a strict post-CI, pre-deadline observation");
  }
  exact(value.executing_local_closure, [
    "runtime_manifest_matches_public_head", "runtime_source_files_match_public_head",
    "runtime_source_files_verified", "executing_verifier_matches_public_head",
    "workflow_file_matches_public_head", "workflow_file_sha256",
  ], "Attempt 115 executing local closure");
  if (value.executing_local_closure.runtime_manifest_matches_public_head !== true
    || value.executing_local_closure.runtime_source_files_match_public_head !== true
    || value.executing_local_closure.runtime_source_files_verified !== sourcePaths.length
    || value.executing_local_closure.executing_verifier_matches_public_head !== true
    || value.executing_local_closure.workflow_file_matches_public_head !== true
    || value.executing_local_closure.workflow_file_sha256
      !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 115 executing local closure is incomplete");
  }
  exact(value.assurance, [
    "fixed_unauthenticated_get_requests", "no_credentials_sent", "network_mutation_authorized",
    "public_github_platform_record_only", "self_contained_offline_evidence",
    "independent_cryptographic_timestamp_verified", "provider_origin_verified",
    "broker_execution_verified", "performance_inference_permitted",
  ], "Attempt 115 publication assurance");
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
  })) fail("Attempt 115 publication assurance boundary is invalid");
  digest(value.receipt_sha256, "Attempt 115 publication receipt self-hash");
  if (value.receipt_sha256 !== sha256(receiptBody(value))) {
    fail("Attempt 115 publication receipt self-hash is invalid");
  }
  return value;
}

export async function collectAttempt115GitHubPublicationEvidence({
  headSha,
  workflowRunId,
  fetchImpl = globalThis.fetch,
  projectRoot = PROJECT_ROOT,
} = {}) {
  if (typeof fetchImpl !== "function") fail("Attempt 115 publication collector requires fetch");
  commitSha(headSha, "Attempt 115 publication head SHA");
  positiveInteger(workflowRunId, "Attempt 115 workflow run ID");
  const local = await loadLocalClosure(projectRoot);
  const registry = fixedRequests({ headSha, workflowRunId, runtimeManifest: local.manifest });
  const fetched = [];
  for (const request of registry) fetched.push(await githubGet(request, fetchImpl, registry));
  const byId = Object.fromEntries(fetched.map((entry) => [entry.request.request_id, entry]));
  const repository = validateRepository(byId.repository.value);
  const { treeSha } = validateCommit(byId.publication_commit.value, headSha);
  const run = validateWorkflowRun(byId.workflow_run.value, workflowRunId, headSha);
  const { job, requiredSteps } = validateWorkflowJobs(byId.workflow_jobs.value, run);
  if (!byId.runtime_manifest.bytes.equals(local.manifestBytes)) {
    fail("Attempt 115 public runtime manifest differs from the executing local manifest");
  }
  const remoteManifest = parseAttempt115RuntimeManifestBytes(
    byId.runtime_manifest.bytes,
    "Attempt 115 public runtime manifest",
  );
  if (stableStringify(remoteManifest) !== stableStringify(local.manifest)) {
    fail("Attempt 115 public runtime manifest value differs from local execution");
  }
  if (!byId.workflow_file.bytes.equals(local.workflowBytes)
    || rawBytesSha256(byId.workflow_file.bytes)
      !== ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("Attempt 115 public workflow differs from the executing frozen workflow");
  }
  for (const sourcePath of Object.keys(local.manifest.runtime_source_files)) {
    const remoteBytes = sourcePath === ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.path
      ? byId.workflow_file.bytes
      : byId[`runtime_source:${sourcePath}`].bytes;
    if (!remoteBytes.equals(local.sourceBytes[sourcePath])
      || rawBytesSha256(remoteBytes) !== local.manifest.runtime_source_files[sourcePath]) {
      fail(`Attempt 115 public source differs from executing local source: ${sourcePath}`);
    }
  }
  const evidence = {
    request_count: fetched.length,
    responses: fetched.map(({ observation }) => observation),
  };
  const verificationObservedAt = latestObservation(evidence);
  if (verificationObservedAt >= ATTEMPT115_PUBLICATION_DEADLINE
    || Date.parse(verificationObservedAt) < Date.parse(run.updated_at)) {
    fail("Attempt 115 publication was not publicly observed after CI and before the deadline");
  }
  const runObservation = byId.workflow_run.observation.github_http_date;
  const jobsObservation = byId.workflow_jobs.observation.github_http_date;
  if (Date.parse(runObservation) < Date.parse(run.updated_at)
    || Date.parse(jobsObservation) < Date.parse(job.completed_at)) {
    fail("Attempt 115 workflow metadata claims completion after its GitHub observation");
  }
  const workflowRun = {
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
  };
  const body = {
    schema_version: ATTEMPT115_PUBLICATION_RECEIPT_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    evidence_class: "PUBLIC_GITHUB_GET_COLLECTION_NOT_INDEPENDENT_TIMESTAMP",
    exclusive_deadline: ATTEMPT115_PUBLICATION_DEADLINE,
    repository: {
      id: repository.id,
      full_name: repository.full_name,
      public: true,
      default_branch: repository.default_branch,
    },
    publication_commit: {
      sha: headSha,
      parent_sha: ATTEMPT115_PROTOCOL_REGISTRATION_HEAD_SHA,
      tree_sha: treeSha,
      html_url: byId.publication_commit.value.html_url,
    },
    workflow_run: workflowRun,
    published_artifacts: {
      protocol: structuredClone(local.manifest.protocol),
      activation: structuredClone(local.manifest.activation),
      runtime_manifest: {
        path: ATTEMPT115_RUNTIME_MANIFEST_PATH,
        raw_bytes_sha256: rawBytesSha256(local.manifestBytes),
        manifest_sha256: local.manifest.manifest_sha256,
        runtime_source_files_sha256: local.manifest.runtime_source_files_sha256,
      },
      runtime_source_files: structuredClone(local.manifest.runtime_source_files),
    },
    github_public_get_evidence: evidence,
    executing_local_closure: {
      runtime_manifest_matches_public_head: true,
      runtime_source_files_match_public_head: true,
      runtime_source_files_verified: Object.keys(local.manifest.runtime_source_files).length,
      executing_verifier_matches_public_head:
        byId[`runtime_source:${ATTEMPT115_VERIFIER_PATH}`].bytes
          .equals(local.sourceBytes[ATTEMPT115_VERIFIER_PATH]),
      workflow_file_matches_public_head: true,
      workflow_file_sha256: ATTEMPT115_GITHUB_PUBLICATION_POLICY.workflow.file_sha256,
    },
    verification_observed_at: verificationObservedAt,
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
    },
  };
  return deepFreeze(validateAttempt115GitHubPublicationReceipt({
    ...body,
    receipt_sha256: sha256(body),
  }));
}

export function canonicalAttempt115GitHubPublicationReceiptJson(value) {
  validateAttempt115GitHubPublicationReceipt(value);
  return canonicalPrettyJson(value);
}

export function attempt115PublicationReceiptPlan(value) {
  const bytes = Buffer.from(canonicalAttempt115GitHubPublicationReceiptJson(value), "utf8");
  const filename = `${value.receipt_sha256.slice(7)}.json`;
  if (!RECEIPT_FILENAME.test(filename)) fail("Attempt 115 receipt filename is invalid");
  return Object.freeze({
    filename,
    relativePath: `${ATTEMPT115_PUBLICATION_RECEIPT_DIRECTORY}/${filename}`,
    bytes,
  });
}

async function ensureSafeReceiptDirectory(projectRoot) {
  const rootStatus = await lstat(projectRoot).catch(() => fail("Attempt 115 receipt root is missing"));
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("Attempt 115 receipt root must be a real directory");
  }
  const root = await realpath(projectRoot);
  let current = root;
  for (const component of ATTEMPT115_PUBLICATION_RECEIPT_DIRECTORY.split("/")) {
    if (!/^[a-z0-9_]+$/iu.test(component)) fail("Attempt 115 receipt directory policy is invalid");
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
      fail("Attempt 115 receipt directory contains a symlink or non-directory component");
    }
  }
  if (await realpath(current) !== current) fail("Attempt 115 receipt directory escaped its root");
  return current;
}

async function verifyExistingReceipt(receiptPath, expectedBytes) {
  let handle;
  try {
    handle = await open(receiptPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW | FS_CONSTANTS.O_NONBLOCK);
    const status = await handle.stat();
    if (!status.isFile() || status.size !== expectedBytes.length || status.size > MAX_RAW_BYTES) {
      fail("existing Attempt 115 receipt is non-regular, oversized, or incorrectly addressed");
    }
    if (!(await handle.readFile()).equals(expectedBytes)) {
      fail("existing Attempt 115 receipt differs at the same content address");
    }
    const finalStatus = await lstat(receiptPath);
    if (finalStatus.isSymbolicLink() || !finalStatus.isFile()
      || finalStatus.dev !== status.dev || finalStatus.ino !== status.ino
      || await realpath(receiptPath) !== receiptPath) {
      fail("existing Attempt 115 receipt changed identity while verified");
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function publishAttempt115GitHubPublicationReceiptWriteOnce(value, {
  projectRoot = PROJECT_ROOT,
} = {}) {
  const plan = attempt115PublicationReceiptPlan(value);
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

export function parseAttempt115GitHubPublicationCli(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) {
    fail("usage: node scripts/verify_attempt115_github_publication.mjs --head-sha <sha> --run-id <id>");
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!new Set(["--head-sha", "--run-id"]).has(key)
      || typeof value !== "string" || value.length < 1 || values.has(key)) {
      fail("usage: node scripts/verify_attempt115_github_publication.mjs --head-sha <sha> --run-id <id>");
    }
    values.set(key, value);
  }
  const headSha = commitSha(values.get("--head-sha"), "Attempt 115 CLI head SHA");
  const workflowRunId = Number(values.get("--run-id"));
  positiveInteger(workflowRunId, "Attempt 115 CLI run ID");
  return Object.freeze({ headSha, workflowRunId });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseAttempt115GitHubPublicationCli(argv);
  const receipt = await collectAttempt115GitHubPublicationEvidence(options);
  const publication = await publishAttempt115GitHubPublicationReceiptWriteOnce(receipt);
  process.stdout.write(`${JSON.stringify(publication, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
