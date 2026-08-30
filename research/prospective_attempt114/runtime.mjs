import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, stableStringify } from "../../lib/canonical.mjs";
import {
  ATTEMPT114_FIRST_SIGNAL_CLOSE_AT,
  ATTEMPT114_PROTOCOL_ID,
  ATTEMPT114_PROTOCOL_RELATIVE_PATH,
  ATTEMPT114_PROTOCOL_SHA256,
  ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256,
  canonicalProspectiveAttempt114ProtocolJson,
  validateProspectiveAttempt114Protocol,
} from "./protocol.mjs";

export const ATTEMPT114_RUNTIME_MANIFEST_SCHEMA = "finly_attempt114_runtime_manifest.v1";
export const ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH =
  "research/prospective_attempt114/runtime_manifest.json";
export const ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256 =
  "sha256:794bb93d578b4b4766daac1c27d7fa0a68f730fbeda853b208aa98ad501572ff";
export const ATTEMPT114_GITHUB_PUBLICATION_RECEIPT_SCHEMA =
  "finly_attempt114_github_publication_receipt.v1";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

const GITHUB_POLICY = Object.freeze({
  repository_id: 1_350_112_497,
  repository_full_name: "owlsowo/finly-bot",
  default_branch: "main",
  workflow_id: 344_996_171,
  workflow_name: "Verify Finly",
  workflow_path: ".github/workflows/ci.yml",
  verification_job_name: "verify",
  required_successful_steps: Object.freeze([
    "Run npm run verify",
    "Generated receipts are committed and reproducible",
  ]),
});

const RUNTIME_LOCAL_SOURCE_PATHS = Object.freeze([
  ATTEMPT114_PROTOCOL_RELATIVE_PATH,
  "research/prospective_attempt114/protocol.mjs",
  "research/prospective_attempt114/runtime.mjs",
  "research/prospective_attempt114/settlement.mjs",
  "research/prospective_attempt114/inference.mjs",
  "research/prospective_attempt114/decomposition.mjs",
  "lib/equity_shadow_execution.mjs",
  "lib/canonical.mjs",
]);

export const ATTEMPT114_RUNTIME_SOURCE_PATHS = Object.freeze(
  [...new Set([
    ...RUNTIME_LOCAL_SOURCE_PATHS,
    ...Object.keys(ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256),
  ])].sort((left, right) => left.localeCompare(right)),
);

const RUNTIME_AUTHORITY = Object.freeze({
  research_only: true,
  broker_reads_permitted: false,
  broker_mutation_authorized: false,
  network_requests_permitted: false,
  persistence_authorized: false,
  order_payload: null,
});

const RUNTIME_GATES = Object.freeze({
  protocol_runtime_publication_verified: false,
  settlement_enabled: false,
  inference_enabled: false,
});

const RUNTIME_ASSURANCE = Object.freeze({
  github_publication_before_first_signal_required: true,
  all_254_independent_pre_execution_anchors_required: true,
  all_252_outcome_price_lineages_required: true,
  independent_cryptographic_timestamp_verified: false,
  provider_origin_verified: false,
  broker_execution_verified: false,
  performance_inference_permitted: false,
});

const PUBLICATION_ASSURANCE = Object.freeze({
  github_public_api_record_verified: true,
  successful_workflow_observed: true,
  public_pre_deadline_publication_observed: true,
  evidence_class: "REPRODUCIBLE_PUBLIC_GITHUB_API_POINTER",
  github_platform_record_only: true,
  self_contained_offline_evidence: false,
  independent_cryptographic_timestamp_verified: false,
  provider_origin_verified: false,
  broker_execution_verified: false,
  performance_inference_permitted: false,
});

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
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

function same(actual, expected, label) {
  if (stableStringify(actual) !== stableStringify(expected)) fail(`${label} changed`);
  return actual;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
  return value;
}

function commitSha(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(`${label} must be a lowercase 40-character commit SHA`);
  }
  return value;
}

function instant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
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

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function boundedBytes(value, label) {
  if (!Buffer.isBuffer(value) && typeof value !== "string") {
    fail(`${label} must be UTF-8 bytes or text`);
  }
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (bytes.length < 1 || bytes.length > MAX_SOURCE_BYTES) {
    fail(`${label} must contain between 1 and ${MAX_SOURCE_BYTES} bytes`);
  }
  return bytes;
}

function rawBytesSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function readRegularFileWithoutSymlink(projectRoot, relativePath) {
  if (typeof relativePath !== "string"
    || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.startsWith("../")
    || relativePath.includes("/../")) {
    fail(`unsafe repository-relative path: ${relativePath}`);
  }
  const root = await realpath(projectRoot);
  let cursor = root;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) fail(`${relativePath} traverses a symbolic link`);
    if (index < parts.length - 1 && !metadata.isDirectory()) {
      fail(`${relativePath} has a non-directory parent`);
    }
    if (index === parts.length - 1 && !metadata.isFile()) {
      fail(`${relativePath} is not a regular file`);
    }
  }
  return readFile(cursor);
}

function parseCanonicalJson(bytes, canonicalizer, label) {
  const text = boundedBytes(bytes, label).toString("utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  if (text !== canonicalizer(value)) fail(`${label} is not canonical pretty JSON with one trailing newline`);
  return value;
}

export function prospectiveAttempt114RuntimeManifestBody(value) {
  object(value, "Attempt 114 runtime manifest");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "manifest_sha256"));
}

export function hashProspectiveAttempt114RuntimeManifest(value) {
  return sha256(prospectiveAttempt114RuntimeManifestBody(value));
}

export function canonicalProspectiveAttempt114RuntimeManifestJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateProspectiveAttempt114RuntimeManifest(value) {
  exact(value, [
    "schema_version",
    "attempt_id",
    "manifest_kind",
    "frozen_at",
    "publication_deadline",
    "publication_deadline_exclusive",
    "protocol",
    "runtime_source_files",
    "runtime_source_files_sha256",
    "authority",
    "evaluation_gates",
    "assurance",
    "claim_boundary",
    "manifest_sha256",
  ], "Attempt 114 runtime manifest");
  if (value.schema_version !== ATTEMPT114_RUNTIME_MANIFEST_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.manifest_kind !== "PRE_SIGNAL_SETTLEMENT_INFERENCE_RUNTIME_FREEZE") {
    fail("Attempt 114 runtime manifest envelope is invalid");
  }
  instant(value.frozen_at, "Attempt 114 runtime manifest frozen_at");
  if (value.frozen_at >= ATTEMPT114_FIRST_SIGNAL_CLOSE_AT
    || value.publication_deadline !== ATTEMPT114_FIRST_SIGNAL_CLOSE_AT
    || value.publication_deadline_exclusive !== true) {
    fail("Attempt 114 runtime manifest was not frozen strictly before the exclusive first-close deadline");
  }
  exact(value.protocol, ["path", "raw_bytes_sha256", "protocol_sha256"],
    "Attempt 114 runtime protocol binding");
  if (value.protocol.path !== ATTEMPT114_PROTOCOL_RELATIVE_PATH
    || value.protocol.raw_bytes_sha256 !== ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256
    || value.protocol.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256) {
    fail("Attempt 114 runtime manifest changes the frozen protocol identity");
  }
  exact(value.runtime_source_files, ATTEMPT114_RUNTIME_SOURCE_PATHS,
    "Attempt 114 runtime source map");
  for (const [sourcePath, sourceHash] of Object.entries(value.runtime_source_files)) {
    digest(sourceHash, `Attempt 114 runtime source hash ${sourcePath}`);
  }
  if (value.runtime_source_files[ATTEMPT114_PROTOCOL_RELATIVE_PATH]
      !== ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256) {
    fail("Attempt 114 runtime source map does not bind the exact protocol bytes");
  }
  for (const [sourcePath, expectedHash] of Object.entries(ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256)) {
    if (value.runtime_source_files[sourcePath] !== expectedHash) {
      fail(`Attempt 114 runtime source map changes frozen upstream bytes: ${sourcePath}`);
    }
  }
  digest(value.runtime_source_files_sha256, "Attempt 114 runtime source-map hash");
  if (value.runtime_source_files_sha256 !== sha256(value.runtime_source_files)) {
    fail("Attempt 114 runtime source-map hash is invalid");
  }
  exact(value.authority, Object.keys(RUNTIME_AUTHORITY), "Attempt 114 runtime authority");
  same(value.authority, RUNTIME_AUTHORITY, "Attempt 114 runtime authority");
  exact(value.evaluation_gates, Object.keys(RUNTIME_GATES), "Attempt 114 runtime gates");
  same(value.evaluation_gates, RUNTIME_GATES, "Attempt 114 runtime gates");
  exact(value.assurance, Object.keys(RUNTIME_ASSURANCE), "Attempt 114 runtime assurance");
  same(value.assurance, RUNTIME_ASSURANCE, "Attempt 114 runtime assurance");
  if (typeof value.claim_boundary !== "string"
    || value.claim_boundary !== "This manifest binds research-only settlement, inference, decomposition, and validation bytes. It does not itself prove public prospectivity, open either evaluation gate, verify provider origin, authorize broker or network mutation, or permit performance inference.") {
    fail("Attempt 114 runtime claim boundary is invalid");
  }
  digest(value.manifest_sha256, "Attempt 114 runtime manifest hash");
  if (value.manifest_sha256 !== hashProspectiveAttempt114RuntimeManifest(value)) {
    fail("Attempt 114 runtime manifest self-hash is invalid");
  }
  return value;
}

async function loadAndValidateRuntimeClosure(projectRoot) {
  const sourceBytes = {};
  const sourceHashes = {};
  for (const sourcePath of ATTEMPT114_RUNTIME_SOURCE_PATHS) {
    const bytes = await readRegularFileWithoutSymlink(projectRoot, sourcePath);
    sourceBytes[sourcePath] = bytes;
    sourceHashes[sourcePath] = rawBytesSha256(bytes);
  }
  const protocolBytes = sourceBytes[ATTEMPT114_PROTOCOL_RELATIVE_PATH];
  const protocol = parseCanonicalJson(
    protocolBytes,
    canonicalProspectiveAttempt114ProtocolJson,
    "Attempt 114 protocol bytes",
  );
  validateProspectiveAttempt114Protocol(protocol);
  if (sourceHashes[ATTEMPT114_PROTOCOL_RELATIVE_PATH]
      !== ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256
    || protocol.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256) {
    fail("Attempt 114 protocol raw-byte or self-hash identity changed");
  }
  for (const [sourcePath, expectedHash] of Object.entries(ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256)) {
    if (sourceHashes[sourcePath] !== expectedHash) {
      fail(`Attempt 114 upstream raw bytes changed: ${sourcePath}`);
    }
  }
  return { protocol, sourceBytes, sourceHashes };
}

export async function buildProspectiveAttempt114RuntimeManifest(
  input,
  { projectRoot = REPOSITORY_ROOT } = {},
) {
  exact(input, ["frozen_at"], "Attempt 114 runtime-manifest build input");
  const frozenAt = instant(input.frozen_at, "Attempt 114 runtime-manifest build frozen_at");
  if (frozenAt >= ATTEMPT114_FIRST_SIGNAL_CLOSE_AT) {
    fail("Attempt 114 runtime manifest must be built strictly before its first signal close");
  }
  const { sourceHashes } = await loadAndValidateRuntimeClosure(projectRoot);
  const body = {
    schema_version: ATTEMPT114_RUNTIME_MANIFEST_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    manifest_kind: "PRE_SIGNAL_SETTLEMENT_INFERENCE_RUNTIME_FREEZE",
    frozen_at: frozenAt,
    publication_deadline: ATTEMPT114_FIRST_SIGNAL_CLOSE_AT,
    publication_deadline_exclusive: true,
    protocol: {
      path: ATTEMPT114_PROTOCOL_RELATIVE_PATH,
      raw_bytes_sha256: ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256,
      protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    },
    runtime_source_files: sourceHashes,
    runtime_source_files_sha256: sha256(sourceHashes),
    authority: structuredClone(RUNTIME_AUTHORITY),
    evaluation_gates: structuredClone(RUNTIME_GATES),
    assurance: structuredClone(RUNTIME_ASSURANCE),
    claim_boundary: "This manifest binds research-only settlement, inference, decomposition, and validation bytes. It does not itself prove public prospectivity, open either evaluation gate, verify provider origin, authorize broker or network mutation, or permit performance inference.",
  };
  return deepFreeze(validateProspectiveAttempt114RuntimeManifest({
    ...body,
    manifest_sha256: sha256(body),
  }));
}

export async function verifyProspectiveAttempt114RuntimeManifestSources(
  manifest,
  { projectRoot = REPOSITORY_ROOT } = {},
) {
  validateProspectiveAttempt114RuntimeManifest(manifest);
  const { sourceHashes } = await loadAndValidateRuntimeClosure(projectRoot);
  if (stableStringify(sourceHashes) !== stableStringify(manifest.runtime_source_files)) {
    fail("Attempt 114 executing source bytes differ from the runtime manifest");
  }
  const body = {
    schema_version: "finly_attempt114_runtime_source_verification_receipt.v1",
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    manifest_sha256: manifest.manifest_sha256,
    protocol_raw_bytes_sha256: ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    runtime_source_files_sha256: manifest.runtime_source_files_sha256,
    source_files_verified: ATTEMPT114_RUNTIME_SOURCE_PATHS.length,
    source_bytes_verified: true,
    symlink_traversal_rejected: true,
    broker_or_network_mutation_authorized: false,
    settlement_enabled: false,
    inference_enabled: false,
  };
  return deepFreeze({ ...body, receipt_sha256: sha256(body) });
}

function runtimeManifestBytes(value, label) {
  const manifest = parseCanonicalJson(
    value,
    canonicalProspectiveAttempt114RuntimeManifestJson,
    label,
  );
  return validateProspectiveAttempt114RuntimeManifest(manifest);
}

function protocolBytes(value, label) {
  const protocol = parseCanonicalJson(value, canonicalProspectiveAttempt114ProtocolJson, label);
  validateProspectiveAttempt114Protocol(protocol);
  if (rawBytesSha256(boundedBytes(value, label)) !== ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256
    || protocol.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256) {
    fail(`${label} differs from the frozen protocol identity`);
  }
  return protocol;
}

function publicationReceiptBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receipt_sha256"));
}

function validatePublicationJob(value, headSha) {
  exact(value, [
    "id", "name", "head_sha", "status", "conclusion", "started_at", "completed_at",
    "required_steps",
  ], "Attempt 114 GitHub publication verification job");
  positiveInteger(value.id, "Attempt 114 GitHub publication verification job id");
  commitSha(value.head_sha, "Attempt 114 GitHub publication verification job head SHA");
  githubInstant(value.started_at, "Attempt 114 GitHub publication verification job started_at");
  githubInstant(value.completed_at, "Attempt 114 GitHub publication verification job completed_at");
  if (value.name !== GITHUB_POLICY.verification_job_name
    || value.head_sha !== headSha
    || value.status !== "completed"
    || value.conclusion !== "success"
    || Date.parse(value.completed_at) < Date.parse(value.started_at)
    || Date.parse(value.completed_at) >= Date.parse(ATTEMPT114_FIRST_SIGNAL_CLOSE_AT)) {
    fail("Attempt 114 GitHub publication verification job is not a successful pre-deadline run");
  }
  if (!Array.isArray(value.required_steps)
    || value.required_steps.length !== GITHUB_POLICY.required_successful_steps.length) {
    fail("Attempt 114 GitHub publication verification steps are incomplete");
  }
  value.required_steps.forEach((step, index) => {
    exact(step, ["name", "number", "status", "conclusion", "started_at", "completed_at"],
      `Attempt 114 GitHub publication verification step ${index + 1}`);
    positiveInteger(step.number, `Attempt 114 GitHub publication verification step ${index + 1} number`);
    githubInstant(step.started_at,
      `Attempt 114 GitHub publication verification step ${index + 1} started_at`);
    githubInstant(step.completed_at,
      `Attempt 114 GitHub publication verification step ${index + 1} completed_at`);
    if (step.name !== GITHUB_POLICY.required_successful_steps[index]
      || step.status !== "completed"
      || step.conclusion !== "success"
      || Date.parse(step.completed_at) < Date.parse(step.started_at)
      || Date.parse(step.started_at) < Date.parse(value.started_at)
      || Date.parse(step.completed_at) > Date.parse(value.completed_at)) {
      fail(`Attempt 114 GitHub publication verification step ${index + 1} is invalid`);
    }
  });
  if (new Set(value.required_steps.map(({ number }) => number)).size
      !== value.required_steps.length) {
    fail("Attempt 114 GitHub publication verification steps reuse a step number");
  }
  return value;
}

export function validateProspectiveAttempt114GitHubPublicationReceipt(value) {
  exact(value, [
    "schema_version",
    "attempt_id",
    "evidence_class",
    "repository",
    "publication_commit",
    "workflow_run",
    "published_artifacts",
    "exclusive_deadline",
    "verification_observed_at",
    "assurance",
    "receipt_sha256",
  ], "Attempt 114 GitHub publication receipt");
  if (value.schema_version !== ATTEMPT114_GITHUB_PUBLICATION_RECEIPT_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.evidence_class !== "REPRODUCIBLE_PUBLIC_GITHUB_API_POINTER_NOT_INDEPENDENT_TIMESTAMP"
    || value.exclusive_deadline !== ATTEMPT114_FIRST_SIGNAL_CLOSE_AT) {
    fail("Attempt 114 GitHub publication receipt envelope is invalid");
  }
  exact(value.repository, ["id", "full_name", "public", "default_branch"],
    "Attempt 114 GitHub publication repository");
  if (value.repository.id !== GITHUB_POLICY.repository_id
    || value.repository.full_name !== GITHUB_POLICY.repository_full_name
    || value.repository.public !== true
    || value.repository.default_branch !== GITHUB_POLICY.default_branch) {
    fail("Attempt 114 GitHub publication repository identity is invalid");
  }
  exact(value.publication_commit, ["sha", "parent_sha", "tree_sha", "html_url"],
    "Attempt 114 GitHub publication commit");
  const headSha = commitSha(value.publication_commit.sha,
    "Attempt 114 GitHub publication commit SHA");
  const parentSha = commitSha(value.publication_commit.parent_sha,
    "Attempt 114 GitHub publication parent SHA");
  commitSha(value.publication_commit.tree_sha, "Attempt 114 GitHub publication tree SHA");
  if (headSha === parentSha
    || value.publication_commit.html_url
      !== `https://github.com/${GITHUB_POLICY.repository_full_name}/commit/${headSha}`) {
    fail("Attempt 114 GitHub publication commit linkage is invalid");
  }
  exact(value.workflow_run, [
    "id", "workflow_id", "name", "path", "event", "head_branch", "head_sha",
    "run_attempt", "status", "conclusion", "created_at", "updated_at", "html_url",
    "verification_job",
  ], "Attempt 114 GitHub publication workflow run");
  positiveInteger(value.workflow_run.id, "Attempt 114 GitHub publication workflow run id");
  positiveInteger(value.workflow_run.run_attempt,
    "Attempt 114 GitHub publication workflow run attempt");
  commitSha(value.workflow_run.head_sha, "Attempt 114 GitHub publication workflow head SHA");
  githubInstant(value.workflow_run.created_at,
    "Attempt 114 GitHub publication workflow created_at");
  githubInstant(value.workflow_run.updated_at,
    "Attempt 114 GitHub publication workflow updated_at");
  const expectedRunUrl = `https://github.com/${GITHUB_POLICY.repository_full_name}/actions/runs/${value.workflow_run.id}`;
  if (value.workflow_run.workflow_id !== GITHUB_POLICY.workflow_id
    || value.workflow_run.name !== GITHUB_POLICY.workflow_name
    || value.workflow_run.path !== GITHUB_POLICY.workflow_path
    || value.workflow_run.event !== "push"
    || value.workflow_run.head_branch !== GITHUB_POLICY.default_branch
    || value.workflow_run.head_sha !== headSha
    || value.workflow_run.status !== "completed"
    || value.workflow_run.conclusion !== "success"
    || value.workflow_run.html_url !== expectedRunUrl
    || Date.parse(value.workflow_run.updated_at) < Date.parse(value.workflow_run.created_at)
    || Date.parse(value.workflow_run.created_at) >= Date.parse(value.exclusive_deadline)
    || Date.parse(value.workflow_run.updated_at) >= Date.parse(value.exclusive_deadline)) {
    fail("Attempt 114 GitHub publication workflow is not a successful strict pre-deadline run");
  }
  validatePublicationJob(value.workflow_run.verification_job, headSha);
  if (Date.parse(value.workflow_run.verification_job.started_at)
      < Date.parse(value.workflow_run.created_at)
    || Date.parse(value.workflow_run.verification_job.completed_at)
      > Date.parse(value.workflow_run.updated_at)) {
    fail("Attempt 114 GitHub publication job falls outside its workflow run");
  }
  exact(value.published_artifacts, ["protocol", "runtime_manifest", "runtime_source_files"],
    "Attempt 114 GitHub published artifacts");
  exact(value.published_artifacts.protocol,
    ["path", "raw_bytes_sha256", "protocol_sha256"],
    "Attempt 114 GitHub published protocol");
  if (value.published_artifacts.protocol.path !== ATTEMPT114_PROTOCOL_RELATIVE_PATH
    || value.published_artifacts.protocol.raw_bytes_sha256
      !== ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256
    || value.published_artifacts.protocol.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256) {
    fail("Attempt 114 GitHub publication changes the protocol identity");
  }
  exact(value.published_artifacts.runtime_manifest, [
    "path", "raw_bytes_sha256", "manifest_sha256", "runtime_source_files_sha256",
  ], "Attempt 114 GitHub published runtime manifest");
  if (value.published_artifacts.runtime_manifest.path
      !== ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH) {
    fail("Attempt 114 GitHub publication uses the wrong runtime-manifest path");
  }
  digest(value.published_artifacts.runtime_manifest.raw_bytes_sha256,
    "Attempt 114 GitHub published runtime-manifest raw hash");
  digest(value.published_artifacts.runtime_manifest.manifest_sha256,
    "Attempt 114 GitHub published runtime-manifest self hash");
  digest(value.published_artifacts.runtime_manifest.runtime_source_files_sha256,
    "Attempt 114 GitHub published runtime source-map hash");
  exact(value.published_artifacts.runtime_source_files, ATTEMPT114_RUNTIME_SOURCE_PATHS,
    "Attempt 114 GitHub published runtime source map");
  for (const [sourcePath, sourceHash] of Object.entries(
    value.published_artifacts.runtime_source_files,
  )) {
    digest(sourceHash, `Attempt 114 GitHub published runtime source hash ${sourcePath}`);
  }
  instant(value.verification_observed_at,
    "Attempt 114 GitHub publication verification_observed_at");
  if (Date.parse(value.verification_observed_at) < Date.parse(value.workflow_run.updated_at)) {
    fail("Attempt 114 GitHub publication was observed before its workflow completed");
  }
  exact(value.assurance, Object.keys(PUBLICATION_ASSURANCE),
    "Attempt 114 GitHub publication assurance");
  same(value.assurance, PUBLICATION_ASSURANCE, "Attempt 114 GitHub publication assurance");
  digest(value.receipt_sha256, "Attempt 114 GitHub publication receipt hash");
  if (value.receipt_sha256 !== sha256(publicationReceiptBody(value))) {
    fail("Attempt 114 GitHub publication receipt self-hash is invalid");
  }
  return value;
}

function validatePublishedSourceBytes(runtimeSourceBytes, manifest) {
  exact(runtimeSourceBytes, ATTEMPT114_RUNTIME_SOURCE_PATHS,
    "Attempt 114 published runtime source bytes");
  for (const sourcePath of ATTEMPT114_RUNTIME_SOURCE_PATHS) {
    const bytes = boundedBytes(runtimeSourceBytes[sourcePath],
      `Attempt 114 published runtime source ${sourcePath}`);
    if (rawBytesSha256(bytes) !== manifest.runtime_source_files[sourcePath]) {
      fail(`Attempt 114 published runtime source bytes differ from the manifest: ${sourcePath}`);
    }
  }
}

export function buildProspectiveAttempt114GitHubPublicationReceipt(input) {
  exact(input, [
    "repository",
    "publication_commit",
    "workflow_run",
    "verification_observed_at",
    "protocol_bytes",
    "runtime_manifest_bytes",
    "runtime_source_bytes",
  ], "Attempt 114 GitHub publication evidence input");
  const protocol = protocolBytes(input.protocol_bytes, "Attempt 114 published protocol bytes");
  const manifest = runtimeManifestBytes(
    input.runtime_manifest_bytes,
    "Attempt 114 published runtime-manifest bytes",
  );
  validatePublishedSourceBytes(input.runtime_source_bytes, manifest);
  const body = {
    schema_version: ATTEMPT114_GITHUB_PUBLICATION_RECEIPT_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    evidence_class: "REPRODUCIBLE_PUBLIC_GITHUB_API_POINTER_NOT_INDEPENDENT_TIMESTAMP",
    repository: structuredClone(input.repository),
    publication_commit: structuredClone(input.publication_commit),
    workflow_run: structuredClone(input.workflow_run),
    published_artifacts: {
      protocol: {
        path: ATTEMPT114_PROTOCOL_RELATIVE_PATH,
        raw_bytes_sha256: rawBytesSha256(boundedBytes(input.protocol_bytes,
          "Attempt 114 published protocol bytes")),
        protocol_sha256: protocol.protocol_sha256,
      },
      runtime_manifest: {
        path: ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH,
        raw_bytes_sha256: rawBytesSha256(boundedBytes(input.runtime_manifest_bytes,
          "Attempt 114 published runtime-manifest bytes")),
        manifest_sha256: manifest.manifest_sha256,
        runtime_source_files_sha256: manifest.runtime_source_files_sha256,
      },
      runtime_source_files: structuredClone(manifest.runtime_source_files),
    },
    exclusive_deadline: ATTEMPT114_FIRST_SIGNAL_CLOSE_AT,
    verification_observed_at: input.verification_observed_at,
    assurance: structuredClone(PUBLICATION_ASSURANCE),
  };
  return deepFreeze(validateProspectiveAttempt114GitHubPublicationReceipt({
    ...body,
    receipt_sha256: sha256(body),
  }));
}

export function verifyProspectiveAttempt114GitHubPublicationEvidence({
  receipt,
  protocol_bytes: publishedProtocolBytes,
  runtime_manifest_bytes: publishedRuntimeManifestBytes,
  runtime_source_bytes: publishedRuntimeSourceBytes,
}) {
  validateProspectiveAttempt114GitHubPublicationReceipt(receipt);
  protocolBytes(publishedProtocolBytes, "Attempt 114 reverified published protocol bytes");
  const manifest = runtimeManifestBytes(
    publishedRuntimeManifestBytes,
    "Attempt 114 reverified published runtime-manifest bytes",
  );
  validatePublishedSourceBytes(publishedRuntimeSourceBytes, manifest);
  if (receipt.published_artifacts.protocol.raw_bytes_sha256
      !== rawBytesSha256(boundedBytes(publishedProtocolBytes,
        "Attempt 114 reverified published protocol bytes"))
    || receipt.published_artifacts.runtime_manifest.raw_bytes_sha256
      !== rawBytesSha256(boundedBytes(publishedRuntimeManifestBytes,
        "Attempt 114 reverified published runtime-manifest bytes"))
    || receipt.published_artifacts.runtime_manifest.manifest_sha256 !== manifest.manifest_sha256
    || receipt.published_artifacts.runtime_manifest.runtime_source_files_sha256
      !== manifest.runtime_source_files_sha256
    || stableStringify(receipt.published_artifacts.runtime_source_files)
      !== stableStringify(manifest.runtime_source_files)) {
    fail("Attempt 114 GitHub publication receipt differs from the reverified public bytes");
  }
  return deepFreeze(receipt);
}
