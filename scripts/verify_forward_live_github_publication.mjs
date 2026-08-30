import { createHash, randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  validateForwardTrialLiveActivation,
  validateForwardTrialLiveImplementationBinding,
} from "../research/forward_trial_live_core.mjs";
import {
  FORWARD_TRIAL_LIVE_ACTIVATION_PATH,
  FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING_PATH,
  FORWARD_TRIAL_LIVE_PUBLIC_ANCHOR_DIRECTORY,
  validateForwardTrialLivePublicAnchorChain,
} from "../research/run_forward_trial_live.mjs";

export const GITHUB_PUBLICATION_POLICY = Object.freeze({
  api_origin: "https://api.github.com",
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
  activation_path: FORWARD_TRIAL_LIVE_ACTIVATION_PATH,
  runtime_manifest_path: FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING_PATH,
  runtime_source_paths: Object.freeze([
    "lib/canonical.mjs",
    "lib/economic_research.mjs",
    "lib/forward_market_data.mjs",
    "research/forward_trial_live_core.mjs",
    "research/run_forward_trial_live.mjs",
  ]),
  verifier_path: "scripts/verify_forward_live_github_publication.mjs",
  receipt_directory: "research/forward_trial_live/github_receipts",
  anchor_directory: FORWARD_TRIAL_LIVE_PUBLIC_ANCHOR_DIRECTORY,
  evidence_class: "REPRODUCIBLE_PUBLIC_API_POINTER",
});

export const GITHUB_PUBLICATION_RECEIPT_SCHEMA =
  "finly_forward_trial_live_github_publication_receipt.v4";

export const GITHUB_PUBLICATION_RECEIPT_DIRECTORY =
  GITHUB_PUBLICATION_POLICY.receipt_directory;

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const ANCHOR_FILENAME = /^(\d{8})_([0-9a-f]{64})\.json$/;
const MAX_COMMITMENT_SEQUENCE = 254;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_RAW_BYTES = 1024 * 1024;
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));

function fail(message) {
  throw new Error(message);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exact(value, keys, label) {
  record(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value;
}

function boundedText(value, label, maximum = 2_048) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a canonical SHA-256 digest`);
  return value;
}

function commitSha(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) fail(`${label} must be a lowercase 40-character commit SHA`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
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
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
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
  if (typeof value !== "string" || value.length > 64) {
    fail(`${label} must be a canonical GitHub HTTP Date`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toUTCString() !== value) {
    fail(`${label} must be a canonical GitHub HTTP Date`);
  }
  return value;
}

function stableJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  record(value, "canonical JSON value");
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function sortedClone(value) {
  if (Array.isArray(value)) return value.map(sortedClone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortedClone(value[key])]),
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortedClone(value), null, 2)}\n`;
}

export function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

export function sha256Bytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function boundedBytes(value, label, maximum = MAX_RAW_BYTES) {
  if (!Buffer.isBuffer(value) && typeof value !== "string") {
    fail(`${label} must be bounded response bytes`);
  }
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (bytes.length < 1 || bytes.length > maximum) {
    fail(`${label} must be bounded response bytes`);
  }
  return bytes;
}

function anchorPathParts(path) {
  boundedText(path, "anchor path", 512);
  const prefix = `${GITHUB_PUBLICATION_POLICY.anchor_directory}/`;
  if (!path.startsWith(prefix) || path.includes("..") || path.includes("//")) {
    fail("anchor path is outside the fixed public anchor directory");
  }
  const filename = path.slice(prefix.length);
  if (filename.includes("/")) fail("anchor path must name one direct child of the public anchor directory");
  const match = ANCHOR_FILENAME.exec(filename);
  if (!match) fail("anchor filename is not content addressed");
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_COMMITMENT_SEQUENCE) {
    fail(`anchor sequence must be from 1 through ${MAX_COMMITMENT_SEQUENCE}`);
  }
  return {
    filename,
    sequence,
    manifestHex: match[2],
  };
}

function receiptPathParts(path) {
  boundedText(path, "previous receipt path", 512);
  const prefix = `${GITHUB_PUBLICATION_RECEIPT_DIRECTORY}/`;
  if (!path.startsWith(prefix) || path.includes("..") || path.includes("//")) {
    fail("previous receipt path is outside the fixed receipt directory");
  }
  const filename = path.slice(prefix.length);
  if (filename.includes("/")) fail("previous receipt path must name one direct child");
  const match = ANCHOR_FILENAME.exec(filename);
  if (!match) fail("previous receipt filename is not content addressed");
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= MAX_COMMITMENT_SEQUENCE) {
    fail(`previous receipt sequence must be from 1 through ${MAX_COMMITMENT_SEQUENCE - 1}`);
  }
  return { filename, sequence, receiptHex: match[2] };
}

function parseCanonicalRepositoryJson(bytes, label) {
  if (typeof bytes !== "string" || Buffer.byteLength(bytes, "utf8") > MAX_RAW_BYTES) {
    fail(`${label} bytes must be bounded UTF-8 text`);
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    fail(`${label} bytes are not valid JSON`);
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes) {
    fail(`${label} bytes are not canonical repository JSON`);
  }
  return value;
}

function validateRuntimeSourceBytes(runtimeSourceBytes, implementationBinding) {
  exact(
    runtimeSourceBytes,
    GITHUB_PUBLICATION_POLICY.runtime_source_paths,
    "runtime source bytes at frozen parent",
  );
  exact(
    implementationBinding.runtime_source_files,
    GITHUB_PUBLICATION_POLICY.runtime_source_paths,
    "runtime implementation source map",
  );
  for (const path of GITHUB_PUBLICATION_POLICY.runtime_source_paths) {
    const bytes = runtimeSourceBytes[path];
    if (typeof bytes !== "string" || Buffer.byteLength(bytes, "utf8") > MAX_RAW_BYTES) {
      fail(`runtime source bytes are missing or oversized: ${path}`);
    }
    if (sha256Bytes(bytes) !== implementationBinding.runtime_source_files[path]) {
      fail(`runtime source bytes differ from the frozen remote manifest: ${path}`);
    }
  }
}

function validateExecutingRuntimeClosure({
  runtimeManifestBytes,
  runtimeSourceBytes,
  executingRuntimeManifestBytes,
  executingRuntimeSourceBytes,
}) {
  const remoteManifest = boundedBytes(runtimeManifestBytes, "remote runtime manifest bytes");
  const localManifest = boundedBytes(executingRuntimeManifestBytes, "executing runtime manifest bytes");
  if (!remoteManifest.equals(localManifest)) {
    fail("GitHub parent runtime manifest differs from the executing local runtime manifest");
  }
  exact(
    executingRuntimeSourceBytes,
    GITHUB_PUBLICATION_POLICY.runtime_source_paths,
    "executing local runtime source bytes",
  );
  for (const path of GITHUB_PUBLICATION_POLICY.runtime_source_paths) {
    const remote = boundedBytes(runtimeSourceBytes[path], `remote runtime source ${path}`);
    const local = boundedBytes(executingRuntimeSourceBytes[path], `executing runtime source ${path}`);
    if (!remote.equals(local)) {
      fail(`GitHub parent runtime source differs from the executing local source: ${path}`);
    }
  }
}

function validateRepository(repository) {
  record(repository, "GitHub repository response");
  const expected = GITHUB_PUBLICATION_POLICY.repository;
  if (repository.id !== expected.id
    || repository.full_name !== expected.full_name
    || repository.private !== false
    || repository.visibility !== "public"
    || repository.default_branch !== expected.default_branch
    || repository.fork !== false
    || repository.archived !== false
    || repository.disabled !== false) {
    fail("GitHub repository identity or public-state gate failed");
  }
  return repository;
}

function validateRun(run, runId) {
  record(run, "GitHub workflow run response");
  positiveInteger(runId, "GitHub workflow run ID");
  const expectedRepository = GITHUB_PUBLICATION_POLICY.repository;
  const expectedWorkflow = GITHUB_PUBLICATION_POLICY.workflow;
  if (run.id !== runId
    || run.workflow_id !== expectedWorkflow.id
    || run.name !== expectedWorkflow.name
    || run.path !== expectedWorkflow.path
    || run.event !== "push"
    || run.head_branch !== expectedRepository.default_branch
    || run.status !== "completed"
    || run.conclusion !== "success") {
    fail("GitHub workflow run identity, trigger, branch, or conclusion gate failed");
  }
  commitSha(run.head_sha, "GitHub workflow run head SHA");
  githubInstant(run.created_at, "GitHub workflow run created_at");
  githubInstant(run.run_started_at, "GitHub workflow run run_started_at");
  githubInstant(run.updated_at, "GitHub workflow run updated_at");
  positiveInteger(run.run_attempt, "GitHub workflow run attempt");
  if (Date.parse(run.run_started_at) < Date.parse(run.created_at)
    || Date.parse(run.updated_at) < Date.parse(run.run_started_at)) {
    fail("GitHub workflow run timestamps are not chronological");
  }
  const expectedUrl = `https://github.com/${expectedRepository.full_name}/actions/runs/${runId}`;
  if (run.html_url !== expectedUrl) fail("GitHub workflow run URL is not canonical");
  for (const [label, repository] of [["repository", run.repository], ["head repository", run.head_repository]]) {
    record(repository, `GitHub workflow run ${label}`);
    if (repository.id !== expectedRepository.id
      || repository.full_name !== expectedRepository.full_name
      || repository.private !== false) {
      fail(`GitHub workflow run ${label} identity gate failed`);
    }
  }
  return run;
}

function publicationRunRecord(run) {
  return {
    id: run.id,
    event: run.event,
    head_branch: run.head_branch,
    head_sha: run.head_sha,
    created_at: run.created_at,
    updated_at: run.updated_at,
    run_attempt: run.run_attempt,
    status: run.status,
    conclusion: run.conclusion,
    html_url: run.html_url,
  };
}

function validateParentPublicationRuns(
  runsResponse,
  expectedParentSha,
  activation,
  previousReceipt,
) {
  record(runsResponse, "GitHub parent-publication workflow-runs response");
  if (!Array.isArray(runsResponse.workflow_runs)
    || runsResponse.total_count !== 1
    || runsResponse.workflow_runs.length !== 1) {
    fail("GitHub parent-publication workflow run is absent, ambiguous, or paginated");
  }
  const run = validateRun(runsResponse.workflow_runs[0], runsResponse.workflow_runs[0]?.id);
  if (run.head_sha !== expectedParentSha) {
    fail("GitHub parent-publication workflow does not belong to the exact commit parent");
  }
  if (previousReceipt === null) {
    if (Date.parse(run.created_at) >= Date.parse(activation.payload.activation_session.market_close_at)
      || Date.parse(run.updated_at) >= Date.parse(activation.payload.activation_session.market_close_at)) {
      fail("GitHub parent-freeze workflow did not complete successfully before the activated first close");
    }
  } else if (stableJson(publicationRunRecord(run)) !== stableJson({
    id: previousReceipt.run.id,
    event: previousReceipt.run.event,
    head_branch: previousReceipt.run.head_branch,
    head_sha: previousReceipt.run.head_sha,
    created_at: previousReceipt.run.created_at,
    updated_at: previousReceipt.run.updated_at,
    run_attempt: previousReceipt.run.run_attempt,
    status: previousReceipt.run.status,
    conclusion: previousReceipt.run.conclusion,
    html_url: previousReceipt.run.html_url,
  })) {
    fail("GitHub immediate-parent workflow differs from the previous anchor publication receipt");
  }
  return run;
}

function validateJobs(jobsResponse, run) {
  record(jobsResponse, "GitHub jobs response");
  if (!Array.isArray(jobsResponse.jobs)
    || jobsResponse.total_count !== jobsResponse.jobs.length
    || jobsResponse.jobs.length < 1
    || jobsResponse.jobs.length > 100) {
    fail("GitHub jobs response is incomplete or unbounded");
  }
  const matches = jobsResponse.jobs.filter((job) => job?.name === GITHUB_PUBLICATION_POLICY.workflow.job_name);
  if (matches.length !== 1) fail("GitHub verification job is absent or ambiguous");
  const job = record(matches[0], "GitHub verification job");
  if (job.run_id !== run.id
    || job.head_sha !== run.head_sha
    || job.status !== "completed"
    || job.conclusion !== "success") {
    fail("GitHub verification job identity or conclusion gate failed");
  }
  if (!Array.isArray(job.steps)) fail("GitHub verification job steps are absent");
  const requiredSteps = [];
  for (const requiredName of GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps) {
    const steps = job.steps.filter((step) => step?.name === requiredName);
    if (steps.length !== 1 || steps[0].status !== "completed" || steps[0].conclusion !== "success") {
      fail(`GitHub verification step did not succeed exactly once: ${requiredName}`);
    }
    const step = steps[0];
    positiveInteger(step.number, `GitHub verification step number: ${requiredName}`);
    githubInstant(step.started_at, `GitHub verification step started_at: ${requiredName}`);
    githubInstant(step.completed_at, `GitHub verification step completed_at: ${requiredName}`);
    if (Date.parse(step.completed_at) < Date.parse(step.started_at)) {
      fail(`GitHub verification step completed before it started: ${requiredName}`);
    }
    requiredSteps.push({
      name: step.name,
      number: step.number,
      status: step.status,
      conclusion: step.conclusion,
      started_at: step.started_at,
      completed_at: step.completed_at,
    });
  }
  if (new Set(requiredSteps.map(({ number }) => number)).size !== requiredSteps.length) {
    fail("GitHub required verification steps reuse a step number");
  }
  return { job, requiredSteps };
}

function validateCommit(commit, headSha, expectedParentSha, anchorPath) {
  record(commit, "GitHub publication commit response");
  if (commit.sha !== headSha) fail("GitHub publication commit differs from the workflow head SHA");
  if (!Array.isArray(commit.parents)
    || commit.parents.length !== 1
    || commit.parents[0]?.sha !== expectedParentSha) {
    fail("GitHub publication commit is not a one-parent extension of the frozen public head");
  }
  if (!Array.isArray(commit.files) || commit.files.length !== 1) {
    fail("GitHub publication commit must change exactly one file");
  }
  const file = record(commit.files[0], "GitHub publication commit file");
  if (file.filename !== anchorPath
    || file.status !== "added"
    || !Number.isSafeInteger(file.additions)
    || file.additions < 1
    || file.deletions !== 0
    || file.changes !== file.additions) {
    fail("GitHub publication commit is not an anchor-only file addition");
  }
  return commit;
}

function receiptBody(receipt) {
  const body = { ...receipt };
  delete body.receipt_sha256;
  return body;
}

function validateReceiptApiEvidence(receipt) {
  const evidence = receipt.github_public_get_evidence;
  exact(evidence, ["request_count", "responses"], "GitHub publication receipt public-GET evidence");
  const requests = fixedGitHubRequests({
    runId: receipt.run.id,
    headSha: receipt.publication_commit.sha,
    parentSha: receipt.publication_commit.parent_sha,
    anchorPath: receipt.anchor_path,
    previousAnchorPath: receipt.previous_publication?.anchor_path ?? null,
  });
  if (evidence.request_count !== requests.length
    || !Array.isArray(evidence.responses)
    || evidence.responses.length !== requests.length) {
    fail("GitHub publication receipt must point to its exact bounded public GET plan");
  }
  evidence.responses.forEach((response, index) => {
    exact(response, [
      "request_id", "canonical_url", "github_http_date", "response_byte_length",
      "response_bytes_sha256",
    ], `GitHub publication receipt public-GET response ${index + 1}`);
    const expected = requests[index];
    if (response.request_id !== expected.request_id
      || response.canonical_url !== githubApiUrl(expected.path)) {
      fail(`GitHub publication receipt public-GET response ${index + 1} is reordered or points elsewhere`);
    }
    githubHttpDate(response.github_http_date, `GitHub publication receipt public-GET response ${index + 1} HTTP Date`);
    positiveInteger(response.response_byte_length, `GitHub publication receipt public-GET response ${index + 1} byte length`);
    const maximum = expected.response_type === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES;
    if (response.response_byte_length > maximum) {
      fail(`GitHub publication receipt public-GET response ${index + 1} exceeds its byte limit`);
    }
    digest(response.response_bytes_sha256, `GitHub publication receipt public-GET response ${index + 1} byte hash`);
  });
  if (new Set(evidence.responses.map(({ canonical_url: url }) => url)).size !== evidence.responses.length
    || latestApiObservation(evidence) !== receipt.verification_observed_at) {
    fail("GitHub publication receipt public-GET observations are duplicated or time-inconsistent");
  }
  const byId = Object.fromEntries(evidence.responses.map((response) => [response.request_id, response]));
  if (byId.activation_at_parent.response_bytes_sha256 !== receipt.activation_at_head.raw_bytes_sha256
    || byId.runtime_manifest_at_parent.response_bytes_sha256 !== receipt.runtime_manifest_at_head.raw_bytes_sha256
    || byId.anchor_at_head.response_bytes_sha256 !== receipt.anchor_at_head.raw_bytes_sha256
    || byId.workflow_at_parent.response_bytes_sha256 !== receipt.workflow.frozen_file_sha256
    || byId.verifier_at_parent.response_bytes_sha256 !== receipt.verifier_at_parent.raw_bytes_sha256) {
    fail("GitHub publication receipt raw artifact hashes differ from their public-GET observations");
  }
  if (receipt.previous_publication !== null
    && byId.previous_anchor_at_parent?.response_bytes_sha256
      !== receipt.previous_publication.anchor_raw_bytes_sha256) {
    fail("GitHub publication receipt previous anchor differs from its parent observation");
  }
  for (const path of GITHUB_PUBLICATION_POLICY.runtime_source_paths) {
    if (byId[`runtime_source:${path}`].response_bytes_sha256
      !== receipt.runtime_manifest_at_head.runtime_source_files[path]) {
      fail(`GitHub publication receipt runtime source observation differs from its manifest: ${path}`);
    }
  }
  return evidence;
}

export function validateGitHubPublicationReceipt(receipt) {
  exact(receipt, [
    "schema_version", "trial_id", "commitment_sequence", "manifest_sha256", "anchor_path",
    "anchor_deadline", "repository", "publication_commit", "workflow", "run",
    "activation_at_head", "runtime_manifest_at_head", "parent_freeze_run", "anchor_at_head",
    "frozen_context", "public_anchor_chain", "public_anchor_chain_sha256",
    "previous_publication", "immediate_parent_run",
    "verifier_at_parent", "github_public_get_evidence", "verification_observed_at",
    "self_contained_offline_evidence", "external_anchor_verified",
    "public_pre_deadline_publication_observed", "assurance", "receipt_sha256",
  ], "GitHub publication receipt");
  if (receipt.schema_version !== GITHUB_PUBLICATION_RECEIPT_SCHEMA
    || receipt.trial_id !== "finly_forward_trial_live_1a") {
    fail("GitHub publication receipt envelope is invalid");
  }
  const sequence = positiveInteger(
    receipt.commitment_sequence,
    "GitHub publication receipt sequence",
  );
  if (sequence > MAX_COMMITMENT_SEQUENCE) {
    fail(`GitHub publication receipt sequence exceeds ${MAX_COMMITMENT_SEQUENCE}`);
  }
  digest(receipt.manifest_sha256, "GitHub publication receipt manifest hash");
  const pathParts = anchorPathParts(receipt.anchor_path);
  if (pathParts.sequence !== receipt.commitment_sequence
    || pathParts.manifestHex !== receipt.manifest_sha256.slice(7)) {
    fail("GitHub publication receipt anchor path differs from its sequence or manifest hash");
  }
  instant(receipt.anchor_deadline, "GitHub publication receipt deadline");
  instant(receipt.verification_observed_at, "GitHub publication receipt observation time");
  if (receipt.self_contained_offline_evidence !== false
    || receipt.external_anchor_verified !== false
    || receipt.public_pre_deadline_publication_observed !== true) {
    fail("GitHub publication receipt overclaims or withholds its narrow publication result");
  }
  exact(receipt.assurance, [
    "github_api_record_verified", "validation_workflow_succeeded", "evidence_class",
    "independent_cryptographic_timestamp_verified", "github_commit_timestamp_used",
    "self_contained_offline_evidence", "provider_origin_verified", "broker_execution_verified",
    "performance_inference_permitted", "hostile_preexecution_environment_excluded",
  ], "GitHub publication receipt assurance");
  if (receipt.assurance.github_api_record_verified !== true
    || receipt.assurance.validation_workflow_succeeded !== true
    || receipt.assurance.evidence_class !== GITHUB_PUBLICATION_POLICY.evidence_class
    || receipt.assurance.independent_cryptographic_timestamp_verified !== false
    || receipt.assurance.github_commit_timestamp_used !== false
    || receipt.assurance.self_contained_offline_evidence !== false
    || receipt.assurance.provider_origin_verified !== false
    || receipt.assurance.broker_execution_verified !== false
    || receipt.assurance.performance_inference_permitted !== false
    || receipt.assurance.hostile_preexecution_environment_excluded !== false) {
    fail("GitHub publication receipt assurance boundary is invalid");
  }

  exact(receipt.repository, ["id", "full_name", "public", "default_branch"], "GitHub publication receipt repository");
  if (receipt.repository.id !== GITHUB_PUBLICATION_POLICY.repository.id
    || receipt.repository.full_name !== GITHUB_PUBLICATION_POLICY.repository.full_name
    || receipt.repository.public !== true
    || receipt.repository.default_branch !== GITHUB_PUBLICATION_POLICY.repository.default_branch) {
    fail("GitHub publication receipt repository identity is invalid");
  }
  exact(receipt.publication_commit, ["sha", "parent_sha", "only_added_path"], "GitHub publication receipt commit");
  commitSha(receipt.publication_commit.sha, "GitHub publication receipt commit SHA");
  commitSha(receipt.publication_commit.parent_sha, "GitHub publication receipt parent SHA");
  if (receipt.publication_commit.only_added_path !== receipt.anchor_path) {
    fail("GitHub publication receipt commit is not anchor-only");
  }
  exact(receipt.workflow, ["id", "name", "path", "frozen_file_sha256"], "GitHub publication receipt workflow");
  if (receipt.workflow.id !== GITHUB_PUBLICATION_POLICY.workflow.id
    || receipt.workflow.name !== GITHUB_PUBLICATION_POLICY.workflow.name
    || receipt.workflow.path !== GITHUB_PUBLICATION_POLICY.workflow.path
    || receipt.workflow.frozen_file_sha256 !== GITHUB_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("GitHub publication receipt workflow identity is invalid");
  }
  exact(receipt.run, [
    "id", "event", "head_branch", "head_sha", "created_at", "updated_at", "run_attempt",
    "status", "conclusion", "html_url", "verification_job_id", "required_job_steps",
  ], "GitHub publication receipt run");
  positiveInteger(receipt.run.id, "GitHub publication receipt run ID");
  positiveInteger(receipt.run.run_attempt, "GitHub publication receipt run attempt");
  positiveInteger(receipt.run.verification_job_id, "GitHub publication receipt verification job ID");
  commitSha(receipt.run.head_sha, "GitHub publication receipt run head SHA");
  githubInstant(receipt.run.created_at, "GitHub publication receipt run created_at");
  githubInstant(receipt.run.updated_at, "GitHub publication receipt run updated_at");
  if (Date.parse(receipt.run.updated_at) > Date.parse(receipt.verification_observed_at)) {
    fail("GitHub publication receipt anchor workflow completion postdates its public API observation");
  }
  if (!Array.isArray(receipt.run.required_job_steps)
    || receipt.run.required_job_steps.length !== GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps.length) {
    fail("GitHub publication receipt required job-step evidence is incomplete");
  }
  receipt.run.required_job_steps.forEach((step, index) => {
    exact(step, [
      "name", "number", "status", "conclusion", "started_at", "completed_at",
    ], `GitHub publication receipt required job step ${index + 1}`);
    if (step.name !== GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps[index]
      || step.status !== "completed"
      || step.conclusion !== "success") {
      fail(`GitHub publication receipt required job step ${index + 1} is invalid`);
    }
    positiveInteger(step.number, `GitHub publication receipt required job step ${index + 1} number`);
    githubInstant(step.started_at, `GitHub publication receipt required job step ${index + 1} started_at`);
    githubInstant(step.completed_at, `GitHub publication receipt required job step ${index + 1} completed_at`);
    if (Date.parse(step.completed_at) < Date.parse(step.started_at)) {
      fail(`GitHub publication receipt required job step ${index + 1} completes before it starts`);
    }
    if (Date.parse(step.completed_at) > Date.parse(receipt.verification_observed_at)) {
      fail(`GitHub publication receipt required job step ${index + 1} completion postdates its public API observation`);
    }
  });
  if (new Set(receipt.run.required_job_steps.map(({ number }) => number)).size
    !== receipt.run.required_job_steps.length) {
    fail("GitHub publication receipt required job steps reuse a number");
  }
  if (receipt.run.event !== "push"
    || receipt.run.head_branch !== GITHUB_PUBLICATION_POLICY.repository.default_branch
    || receipt.run.head_sha !== receipt.publication_commit.sha
    || receipt.run.status !== "completed"
    || receipt.run.conclusion !== "success"
    || receipt.run.html_url !== `https://github.com/${GITHUB_PUBLICATION_POLICY.repository.full_name}/actions/runs/${receipt.run.id}`
    || Date.parse(receipt.run.created_at) >= Date.parse(receipt.anchor_deadline)
    || Date.parse(receipt.run.updated_at) < Date.parse(receipt.run.created_at)
    || Date.parse(receipt.verification_observed_at) < Date.parse(receipt.run.created_at)) {
    fail("GitHub publication receipt run linkage or timing is invalid");
  }
  exact(receipt.activation_at_head, [
    "path", "ref_sha", "raw_bytes_sha256", "activation_sha256", "frozen_at",
    "first_signal_market_close_at",
  ], "GitHub publication receipt activation content");
  if (receipt.activation_at_head.path !== GITHUB_PUBLICATION_POLICY.activation_path
    || receipt.activation_at_head.ref_sha !== receipt.publication_commit.parent_sha) {
    fail("GitHub publication receipt activation path is invalid");
  }
  commitSha(receipt.activation_at_head.ref_sha, "GitHub publication receipt activation ref SHA");
  digest(receipt.activation_at_head.raw_bytes_sha256, "GitHub publication receipt raw activation hash");
  digest(receipt.activation_at_head.activation_sha256, "GitHub publication receipt activation hash");
  instant(receipt.activation_at_head.frozen_at, "GitHub publication receipt activation freeze time");
  instant(receipt.activation_at_head.first_signal_market_close_at, "GitHub publication receipt first signal close");
  exact(receipt.runtime_manifest_at_head, [
    "path", "ref_sha", "raw_bytes_sha256", "manifest_sha256", "activation_sha256", "frozen_at",
    "runtime_source_files", "runtime_source_files_sha256", "runtime_source_bytes_verified",
    "matches_executing_runtime",
  ], "GitHub publication receipt runtime-manifest content");
  if (receipt.runtime_manifest_at_head.path !== GITHUB_PUBLICATION_POLICY.runtime_manifest_path
    || receipt.runtime_manifest_at_head.ref_sha !== receipt.publication_commit.parent_sha) {
    fail("GitHub publication receipt runtime-manifest path is invalid");
  }
  commitSha(receipt.runtime_manifest_at_head.ref_sha, "GitHub publication receipt runtime-manifest ref SHA");
  digest(receipt.runtime_manifest_at_head.raw_bytes_sha256, "GitHub publication receipt raw runtime-manifest hash");
  digest(receipt.runtime_manifest_at_head.manifest_sha256, "GitHub publication receipt runtime-manifest hash");
  digest(receipt.runtime_manifest_at_head.activation_sha256, "GitHub publication receipt runtime activation hash");
  exact(
    receipt.runtime_manifest_at_head.runtime_source_files,
    GITHUB_PUBLICATION_POLICY.runtime_source_paths,
    "GitHub publication receipt runtime source map",
  );
  for (const path of GITHUB_PUBLICATION_POLICY.runtime_source_paths) {
    digest(
      receipt.runtime_manifest_at_head.runtime_source_files[path],
      `GitHub publication receipt runtime source hash ${path}`,
    );
  }
  digest(receipt.runtime_manifest_at_head.runtime_source_files_sha256, "GitHub publication receipt runtime source-map hash");
  instant(receipt.runtime_manifest_at_head.frozen_at, "GitHub publication receipt runtime freeze time");
  if (receipt.runtime_manifest_at_head.activation_sha256 !== receipt.activation_at_head.activation_sha256
    || receipt.runtime_manifest_at_head.frozen_at < receipt.activation_at_head.frozen_at
    || receipt.runtime_manifest_at_head.frozen_at >= receipt.activation_at_head.first_signal_market_close_at
    || receipt.runtime_manifest_at_head.runtime_source_files_sha256
      !== sha256Canonical(receipt.runtime_manifest_at_head.runtime_source_files)
    || receipt.runtime_manifest_at_head.runtime_source_bytes_verified !== true
    || receipt.runtime_manifest_at_head.matches_executing_runtime !== true) {
    fail("GitHub publication receipt runtime manifest differs from the activation at the publication head");
  }
  exact(receipt.frozen_context, ["activation", "runtime_manifest"],
    "GitHub publication receipt frozen context");
  const frozenActivation = receipt.frozen_context.activation;
  const frozenRuntimeManifest = receipt.frozen_context.runtime_manifest;
  validateForwardTrialLiveActivation(frozenActivation);
  validateForwardTrialLiveImplementationBinding(frozenRuntimeManifest, {
    activation: frozenActivation,
  });
  if (frozenActivation.activation_sha256 !== receipt.activation_at_head.activation_sha256
    || frozenRuntimeManifest.manifest_sha256 !== receipt.runtime_manifest_at_head.manifest_sha256
    || frozenRuntimeManifest.runtime_source_files_sha256
      !== receipt.runtime_manifest_at_head.runtime_source_files_sha256
    || stableJson(frozenRuntimeManifest.runtime_source_files)
      !== stableJson(receipt.runtime_manifest_at_head.runtime_source_files)) {
    fail("GitHub publication receipt frozen context differs from the observed runtime closure");
  }
  if (!Array.isArray(receipt.public_anchor_chain)
    || receipt.public_anchor_chain.length !== sequence) {
    fail("GitHub publication receipt must carry the exact canonical anchor prefix");
  }
  const publicAnchorChain = validateForwardTrialLivePublicAnchorChain({
    activation: frozenActivation,
    implementationBinding: frozenRuntimeManifest,
    anchors: receipt.public_anchor_chain,
  });
  digest(receipt.public_anchor_chain_sha256,
    "GitHub publication receipt public anchor-chain hash");
  if (receipt.public_anchor_chain_sha256 !== sha256Canonical(publicAnchorChain)) {
    fail("GitHub publication receipt public anchor-chain hash is invalid");
  }
  const receiptAnchor = publicAnchorChain.at(-1);
  if (receiptAnchor.commitment_sequence !== sequence
    || receiptAnchor.manifest_sha256 !== receipt.manifest_sha256
    || receiptAnchor.timing.anchor_deadline !== receipt.anchor_deadline) {
    fail("GitHub publication receipt anchor prefix does not end at the published anchor");
  }
  let rootParentSha = receipt.publication_commit.parent_sha;
  if (sequence === 1) {
    if (receipt.previous_publication !== null || receipt.immediate_parent_run !== null
      || receiptAnchor.previous_private_bundle_sha256 !== frozenActivation.activation_sha256) {
      fail("GitHub first publication receipt must root directly in the pre-signal freeze");
    }
  } else {
    exact(receipt.previous_publication, [
      "receipt_path", "receipt_sha256", "commitment_sequence", "anchor_path",
      "anchor_raw_bytes_sha256", "anchor_manifest_sha256",
      "anchor_private_bundle_sha256", "publication_commit_sha", "workflow_run_id",
      "root_parent_sha",
    ], "GitHub publication receipt previous-publication link");
    const previous = receipt.previous_publication;
    digest(previous.receipt_sha256, "GitHub previous publication receipt hash");
    digest(previous.anchor_raw_bytes_sha256, "GitHub previous anchor raw-byte hash");
    digest(previous.anchor_manifest_sha256, "GitHub previous anchor manifest hash");
    digest(previous.anchor_private_bundle_sha256, "GitHub previous anchor private-bundle hash");
    commitSha(previous.publication_commit_sha, "GitHub previous publication commit SHA");
    commitSha(previous.root_parent_sha, "GitHub root publication parent SHA");
    positiveInteger(previous.workflow_run_id, "GitHub previous publication workflow run ID");
    const previousReceiptPath = receiptPathParts(previous.receipt_path);
    const previousAnchorPath = anchorPathParts(previous.anchor_path);
    const previousAnchor = publicAnchorChain.at(-2);
    if (previousReceiptPath.sequence !== sequence - 1
      || previousReceiptPath.receiptHex !== previous.receipt_sha256.slice(7)
      || previous.commitment_sequence !== sequence - 1
      || previousAnchorPath.sequence !== sequence - 1
      || previousAnchorPath.manifestHex !== previous.anchor_manifest_sha256.slice(7)
      || previousAnchor.manifest_sha256 !== previous.anchor_manifest_sha256
      || previousAnchor.private_bundle_sha256 !== previous.anchor_private_bundle_sha256
      || receiptAnchor.previous_private_bundle_sha256 !== previous.anchor_private_bundle_sha256
      || receipt.publication_commit.parent_sha !== previous.publication_commit_sha) {
      fail("GitHub publication receipt breaks the immediate previous-anchor/parent link");
    }
    exact(receipt.immediate_parent_run, [
      "id", "event", "head_branch", "head_sha", "created_at", "updated_at", "run_attempt",
      "status", "conclusion", "html_url",
    ], "GitHub publication receipt immediate-parent run");
    const immediateParentRun = receipt.immediate_parent_run;
    positiveInteger(immediateParentRun.id, "GitHub immediate-parent run ID");
    positiveInteger(immediateParentRun.run_attempt, "GitHub immediate-parent run attempt");
    commitSha(immediateParentRun.head_sha, "GitHub immediate-parent run head SHA");
    githubInstant(immediateParentRun.created_at, "GitHub immediate-parent run created_at");
    githubInstant(immediateParentRun.updated_at, "GitHub immediate-parent run updated_at");
    if (immediateParentRun.id !== previous.workflow_run_id
      || immediateParentRun.head_sha !== previous.publication_commit_sha
      || immediateParentRun.event !== "push"
      || immediateParentRun.head_branch !== GITHUB_PUBLICATION_POLICY.repository.default_branch
      || immediateParentRun.status !== "completed"
      || immediateParentRun.conclusion !== "success"
      || immediateParentRun.html_url
        !== `https://github.com/${GITHUB_PUBLICATION_POLICY.repository.full_name}/actions/runs/${immediateParentRun.id}`
      || Date.parse(immediateParentRun.updated_at) < Date.parse(immediateParentRun.created_at)
      || Date.parse(immediateParentRun.updated_at) > Date.parse(receipt.verification_observed_at)
      || Date.parse(immediateParentRun.updated_at) > Date.parse(receipt.run.created_at)) {
      fail("GitHub immediate-parent run is not the verified previous anchor publication");
    }
    rootParentSha = previous.root_parent_sha;
  }
  exact(receipt.parent_freeze_run, [
    "id", "event", "head_branch", "head_sha", "created_at", "updated_at", "run_attempt",
    "status", "conclusion", "html_url",
  ], "GitHub publication receipt parent-freeze run");
  positiveInteger(receipt.parent_freeze_run.id, "GitHub publication receipt parent-freeze run ID");
  positiveInteger(receipt.parent_freeze_run.run_attempt, "GitHub publication receipt parent-freeze run attempt");
  commitSha(receipt.parent_freeze_run.head_sha, "GitHub publication receipt parent-freeze head SHA");
  githubInstant(receipt.parent_freeze_run.created_at, "GitHub publication receipt parent-freeze created_at");
  githubInstant(receipt.parent_freeze_run.updated_at, "GitHub publication receipt parent-freeze updated_at");
  if (Date.parse(receipt.parent_freeze_run.updated_at) > Date.parse(receipt.verification_observed_at)) {
    fail("GitHub publication receipt parent-freeze completion postdates its public API observation");
  }
  if (receipt.parent_freeze_run.event !== "push"
    || receipt.parent_freeze_run.head_branch !== GITHUB_PUBLICATION_POLICY.repository.default_branch
    || receipt.parent_freeze_run.head_sha !== rootParentSha
    || receipt.parent_freeze_run.status !== "completed"
    || receipt.parent_freeze_run.conclusion !== "success"
    || receipt.parent_freeze_run.html_url !== `https://github.com/${GITHUB_PUBLICATION_POLICY.repository.full_name}/actions/runs/${receipt.parent_freeze_run.id}`
    || Date.parse(receipt.runtime_manifest_at_head.frozen_at) > Date.parse(receipt.parent_freeze_run.created_at)
    || Date.parse(receipt.parent_freeze_run.created_at) >= Date.parse(receipt.activation_at_head.first_signal_market_close_at)
    || Date.parse(receipt.parent_freeze_run.updated_at) < Date.parse(receipt.parent_freeze_run.created_at)
    || Date.parse(receipt.parent_freeze_run.updated_at) >= Date.parse(receipt.activation_at_head.first_signal_market_close_at)) {
    fail("GitHub publication receipt parent-freeze run is not valid pre-signal evidence");
  }
  exact(receipt.anchor_at_head, [
    "raw_bytes_sha256", "manifest_sha256", "implementation_binding_sha256",
    "private_bundle_sha256", "previous_private_bundle_sha256",
  ], "GitHub publication receipt anchored content");
  digest(receipt.anchor_at_head.raw_bytes_sha256, "GitHub publication receipt raw anchor hash");
  digest(receipt.anchor_at_head.manifest_sha256, "GitHub publication receipt anchored manifest hash");
  digest(receipt.anchor_at_head.implementation_binding_sha256, "GitHub publication receipt anchor implementation hash");
  digest(receipt.anchor_at_head.private_bundle_sha256, "GitHub publication receipt anchor private-bundle hash");
  digest(receipt.anchor_at_head.previous_private_bundle_sha256, "GitHub publication receipt anchor predecessor hash");
  if (receipt.anchor_at_head.manifest_sha256 !== receipt.manifest_sha256
    || receipt.anchor_at_head.private_bundle_sha256 !== receiptAnchor.private_bundle_sha256
    || receipt.anchor_at_head.previous_private_bundle_sha256
      !== receiptAnchor.previous_private_bundle_sha256) {
    fail("GitHub publication receipt anchored manifest hash is inconsistent");
  }
  if (receipt.anchor_at_head.implementation_binding_sha256 !== receipt.runtime_manifest_at_head.manifest_sha256
    || (sequence === 1
      && receipt.anchor_at_head.previous_private_bundle_sha256
        !== receipt.activation_at_head.activation_sha256)
    || (sequence > 1
      && receipt.anchor_at_head.previous_private_bundle_sha256
        !== receipt.previous_publication.anchor_private_bundle_sha256)) {
    fail("GitHub publication receipt anchor is not bound to the public activation and runtime manifest");
  }
  exact(receipt.verifier_at_parent, [
    "path", "ref_sha", "raw_bytes_sha256", "matches_executing_verifier_file_bytes",
    "execution_closure_verified",
  ], "GitHub publication receipt verifier content");
  if (receipt.verifier_at_parent.path !== GITHUB_PUBLICATION_POLICY.verifier_path
    || receipt.verifier_at_parent.ref_sha !== receipt.publication_commit.parent_sha
    || receipt.verifier_at_parent.matches_executing_verifier_file_bytes !== true
    || receipt.verifier_at_parent.execution_closure_verified !== true) {
    fail("GitHub publication receipt verifier is not bound to the executing verifier");
  }
  commitSha(receipt.verifier_at_parent.ref_sha, "GitHub publication receipt verifier ref SHA");
  digest(receipt.verifier_at_parent.raw_bytes_sha256, "GitHub publication receipt verifier byte hash");
  validateReceiptApiEvidence(receipt);
  digest(receipt.receipt_sha256, "GitHub publication receipt self-hash");
  if (receipt.receipt_sha256 !== sha256Canonical(receiptBody(receipt))) {
    fail("GitHub publication receipt self-hash is invalid");
  }
  return receipt;
}

export function validateGitHubPublicationEvidence({
  repository,
  run,
  jobs,
  commit,
  parentFreezeRuns,
  activationBytes,
  runtimeManifestBytes,
  runtimeSourceBytes,
  anchorBytes,
  previousAnchorBytes = null,
  previousReceipt = null,
  workflowBytes,
  verifierScriptBytes,
  executingVerifierBytes,
  executingRuntimeManifestBytes,
  executingRuntimeSourceBytes,
  apiResponses,
  runId,
  anchorPath,
  expectedParentSha,
}) {
  positiveInteger(runId, "GitHub workflow run ID");
  commitSha(expectedParentSha, "expected publication parent SHA");
  const pathParts = anchorPathParts(anchorPath);
  if (pathParts.sequence === 1) {
    if (previousReceipt !== null || previousAnchorBytes !== null) {
      fail("GitHub first-anchor publication cannot claim a predecessor receipt or anchor");
    }
  } else {
    if (previousReceipt === null || previousAnchorBytes === null) {
      fail("GitHub successor publication requires the immediate previous receipt and parent anchor");
    }
    validateGitHubPublicationReceipt(previousReceipt);
    if (previousReceipt.commitment_sequence !== pathParts.sequence - 1
      || previousReceipt.publication_commit.sha !== expectedParentSha) {
      fail("GitHub successor publication does not directly extend the previous receipt commit");
    }
  }
  validateRepository(repository);
  validateRun(run, runId);
  const { job, requiredSteps } = validateJobs(jobs, run);
  validateCommit(commit, run.head_sha, expectedParentSha, anchorPath);
  const activation = parseCanonicalRepositoryJson(activationBytes, "activation");
  validateForwardTrialLiveActivation(activation);
  const parentPublicationRun = validateParentPublicationRuns(
    parentFreezeRuns,
    expectedParentSha,
    activation,
    previousReceipt,
  );
  const parentFreezeRun = previousReceipt?.parent_freeze_run ?? parentPublicationRun;
  const implementationBinding = parseCanonicalRepositoryJson(runtimeManifestBytes, "runtime manifest");
  validateForwardTrialLiveImplementationBinding(implementationBinding, { activation });
  validateRuntimeSourceBytes(runtimeSourceBytes, implementationBinding);
  validateExecutingRuntimeClosure({
    runtimeManifestBytes,
    runtimeSourceBytes,
    executingRuntimeManifestBytes,
    executingRuntimeSourceBytes,
  });
  if (implementationBinding.frozen_at < activation.payload.frozen_at
    || implementationBinding.frozen_at > new Date(parentFreezeRun.created_at).toISOString()) {
    fail("runtime manifest chronology is inconsistent with activation and public parent run");
  }
  const anchorCandidate = parseCanonicalRepositoryJson(anchorBytes, "public anchor");
  let previousAnchor = null;
  let priorAnchorChain = [];
  if (previousReceipt !== null) {
    previousAnchor = parseCanonicalRepositoryJson(previousAnchorBytes, "previous public anchor");
    const previousPath = anchorPathParts(previousReceipt.anchor_path);
    if (previousPath.sequence !== pathParts.sequence - 1
      || sha256Bytes(previousAnchorBytes) !== previousReceipt.anchor_at_head.raw_bytes_sha256
      || stableJson(previousAnchor)
        !== stableJson(previousReceipt.public_anchor_chain.at(-1))) {
      fail("GitHub parent anchor bytes differ from the immediate previous publication receipt");
    }
    priorAnchorChain = previousReceipt.public_anchor_chain;
  }
  const publicAnchorChain = validateForwardTrialLivePublicAnchorChain({
    activation,
    implementationBinding,
    anchors: [...priorAnchorChain, anchorCandidate],
  });
  const anchor = publicAnchorChain.at(-1);
  if (pathParts.sequence !== anchor.commitment_sequence
    || publicAnchorChain.length !== pathParts.sequence
    || pathParts.manifestHex !== anchor.manifest_sha256.slice(7)) {
    fail("public anchor path differs from its strict sequence or manifest hash");
  }
  if (typeof workflowBytes !== "string" || Buffer.byteLength(workflowBytes, "utf8") > MAX_RAW_BYTES) {
    fail("GitHub workflow bytes are missing or oversized");
  }
  const workflowSha256 = sha256Bytes(workflowBytes);
  if (workflowSha256 !== GITHUB_PUBLICATION_POLICY.workflow.file_sha256) {
    fail("GitHub publication commit changed the frozen verification workflow");
  }
  const remoteVerifierBytes = boundedBytes(verifierScriptBytes, "remote verifier script bytes");
  const localVerifierBytes = boundedBytes(executingVerifierBytes, "executing verifier script bytes");
  if (!remoteVerifierBytes.equals(localVerifierBytes)) {
    fail("GitHub parent verifier script differs from the executing local verifier");
  }
  if (run.head_sha !== commit.sha) fail("GitHub workflow run and publication commit disagree on head SHA");
  const runCreatedAt = Date.parse(run.created_at);
  if (runCreatedAt < Date.parse(anchor.timing.bar_eligible_at)
    || runCreatedAt <= Date.parse(anchor.timing.captured_at)
    || runCreatedAt >= Date.parse(anchor.timing.anchor_deadline)) {
    fail("GitHub workflow run was not platform-recorded inside the anchor publication window");
  }
  const responseValues = {
    repository,
    anchor_workflow_run: run,
    anchor_workflow_jobs: jobs,
    publication_commit: commit,
    activation_at_parent: activationBytes,
    runtime_manifest_at_parent: runtimeManifestBytes,
    ...Object.fromEntries(GITHUB_PUBLICATION_POLICY.runtime_source_paths.map((path) => [
      `runtime_source:${path}`,
      runtimeSourceBytes[path],
    ])),
    parent_publication_workflow_runs: parentFreezeRuns,
    ...(previousReceipt === null ? {} : {
      previous_anchor_at_parent: previousAnchorBytes,
    }),
    anchor_at_head: anchorBytes,
    workflow_at_parent: workflowBytes,
    verifier_at_parent: verifierScriptBytes,
  };
  const githubPublicGetEvidence = validateGitHubApiResponses(apiResponses, {
    runId,
    headSha: run.head_sha,
    parentSha: expectedParentSha,
    anchorPath,
    previousAnchorPath: previousReceipt?.anchor_path ?? null,
  }, responseValues);
  const verificationObservedAt = latestApiObservation(githubPublicGetEvidence);

  const body = {
    schema_version: GITHUB_PUBLICATION_RECEIPT_SCHEMA,
    trial_id: anchor.trial_id,
    commitment_sequence: anchor.commitment_sequence,
    manifest_sha256: anchor.manifest_sha256,
    anchor_path: anchorPath,
    anchor_deadline: anchor.timing.anchor_deadline,
    repository: {
      id: GITHUB_PUBLICATION_POLICY.repository.id,
      full_name: GITHUB_PUBLICATION_POLICY.repository.full_name,
      public: true,
      default_branch: GITHUB_PUBLICATION_POLICY.repository.default_branch,
    },
    publication_commit: {
      sha: run.head_sha,
      parent_sha: expectedParentSha,
      only_added_path: anchorPath,
    },
    workflow: {
      id: GITHUB_PUBLICATION_POLICY.workflow.id,
      name: GITHUB_PUBLICATION_POLICY.workflow.name,
      path: GITHUB_PUBLICATION_POLICY.workflow.path,
      frozen_file_sha256: workflowSha256,
    },
    run: {
      id: run.id,
      event: run.event,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      created_at: run.created_at,
      updated_at: run.updated_at,
      run_attempt: run.run_attempt,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      verification_job_id: job.id,
      required_job_steps: requiredSteps,
    },
    activation_at_head: {
      path: GITHUB_PUBLICATION_POLICY.activation_path,
      ref_sha: expectedParentSha,
      raw_bytes_sha256: sha256Bytes(activationBytes),
      activation_sha256: activation.activation_sha256,
      frozen_at: activation.payload.frozen_at,
      first_signal_market_close_at: activation.payload.activation_session.market_close_at,
    },
    runtime_manifest_at_head: {
      path: GITHUB_PUBLICATION_POLICY.runtime_manifest_path,
      ref_sha: expectedParentSha,
      raw_bytes_sha256: sha256Bytes(runtimeManifestBytes),
      manifest_sha256: implementationBinding.manifest_sha256,
      activation_sha256: implementationBinding.activation_sha256,
      frozen_at: implementationBinding.frozen_at,
      runtime_source_files: structuredClone(implementationBinding.runtime_source_files),
      runtime_source_files_sha256: implementationBinding.runtime_source_files_sha256,
      runtime_source_bytes_verified: true,
      matches_executing_runtime: true,
    },
    parent_freeze_run: {
      id: parentFreezeRun.id,
      event: parentFreezeRun.event,
      head_branch: parentFreezeRun.head_branch,
      head_sha: parentFreezeRun.head_sha,
      created_at: parentFreezeRun.created_at,
      updated_at: parentFreezeRun.updated_at,
      run_attempt: parentFreezeRun.run_attempt,
      status: parentFreezeRun.status,
      conclusion: parentFreezeRun.conclusion,
      html_url: parentFreezeRun.html_url,
    },
    immediate_parent_run: previousReceipt === null
      ? null
      : publicationRunRecord(parentPublicationRun),
    previous_publication: previousReceipt === null ? null : {
      receipt_path: githubPublicationReceiptPlan(previousReceipt).relativePath,
      receipt_sha256: previousReceipt.receipt_sha256,
      commitment_sequence: previousReceipt.commitment_sequence,
      anchor_path: previousReceipt.anchor_path,
      anchor_raw_bytes_sha256: previousReceipt.anchor_at_head.raw_bytes_sha256,
      anchor_manifest_sha256: previousReceipt.manifest_sha256,
      anchor_private_bundle_sha256: previousReceipt.anchor_at_head.private_bundle_sha256,
      publication_commit_sha: previousReceipt.publication_commit.sha,
      workflow_run_id: previousReceipt.run.id,
      root_parent_sha: parentFreezeRun.head_sha,
    },
    frozen_context: {
      activation: structuredClone(activation),
      runtime_manifest: structuredClone(implementationBinding),
    },
    public_anchor_chain: structuredClone(publicAnchorChain),
    public_anchor_chain_sha256: sha256Canonical(publicAnchorChain),
    anchor_at_head: {
      raw_bytes_sha256: sha256Bytes(anchorBytes),
      manifest_sha256: anchor.manifest_sha256,
      implementation_binding_sha256: anchor.formula.implementation_binding_sha256,
      private_bundle_sha256: anchor.private_bundle_sha256,
      previous_private_bundle_sha256: anchor.previous_private_bundle_sha256,
    },
    verifier_at_parent: {
      path: GITHUB_PUBLICATION_POLICY.verifier_path,
      ref_sha: expectedParentSha,
      raw_bytes_sha256: sha256Bytes(remoteVerifierBytes),
      matches_executing_verifier_file_bytes: true,
      execution_closure_verified: true,
    },
    github_public_get_evidence: githubPublicGetEvidence,
    verification_observed_at: verificationObservedAt,
    self_contained_offline_evidence: false,
    external_anchor_verified: false,
    public_pre_deadline_publication_observed: true,
    assurance: {
      github_api_record_verified: true,
      validation_workflow_succeeded: true,
      evidence_class: GITHUB_PUBLICATION_POLICY.evidence_class,
      independent_cryptographic_timestamp_verified: false,
      github_commit_timestamp_used: false,
      self_contained_offline_evidence: false,
      provider_origin_verified: false,
      broker_execution_verified: false,
      performance_inference_permitted: false,
      hostile_preexecution_environment_excluded: false,
    },
  };
  return validateGitHubPublicationReceipt(Object.freeze({
    ...body,
    receipt_sha256: sha256Canonical(body),
  }));
}

function encodeRepositoryPath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function githubApiUrl(path) {
  return new URL(path, GITHUB_PUBLICATION_POLICY.api_origin).href;
}

function fixedGitHubRequests({
  runId,
  headSha,
  parentSha,
  anchorPath,
  previousAnchorPath = null,
}) {
  return [
    { request_id: "repository", response_type: "json", path: "/repos/owlsowo/finly-bot" },
    { request_id: "anchor_workflow_run", response_type: "json", path: `/repos/owlsowo/finly-bot/actions/runs/${runId}` },
    { request_id: "anchor_workflow_jobs", response_type: "json", path: `/repos/owlsowo/finly-bot/actions/runs/${runId}/jobs?per_page=100` },
    { request_id: "publication_commit", response_type: "json", path: `/repos/owlsowo/finly-bot/commits/${headSha}?per_page=100&page=1` },
    { request_id: "activation_at_parent", response_type: "raw", path: `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(GITHUB_PUBLICATION_POLICY.activation_path)}?ref=${parentSha}` },
    { request_id: "runtime_manifest_at_parent", response_type: "raw", path: `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(GITHUB_PUBLICATION_POLICY.runtime_manifest_path)}?ref=${parentSha}` },
    ...GITHUB_PUBLICATION_POLICY.runtime_source_paths.map((sourcePath) => ({
      request_id: `runtime_source:${sourcePath}`,
      response_type: "raw",
      path: `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(sourcePath)}?ref=${parentSha}`,
    })),
    { request_id: "parent_publication_workflow_runs", response_type: "json", path: `/repos/owlsowo/finly-bot/actions/workflows/${GITHUB_PUBLICATION_POLICY.workflow.id}/runs?branch=${GITHUB_PUBLICATION_POLICY.repository.default_branch}&event=push&status=success&head_sha=${parentSha}&per_page=10` },
    ...(previousAnchorPath === null ? [] : [{
      request_id: "previous_anchor_at_parent",
      response_type: "raw",
      path: `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(previousAnchorPath)}?ref=${parentSha}`,
    }]),
    { request_id: "anchor_at_head", response_type: "raw", path: `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(anchorPath)}?ref=${headSha}` },
    { request_id: "workflow_at_parent", response_type: "raw", path: `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(GITHUB_PUBLICATION_POLICY.workflow.path)}?ref=${parentSha}` },
    { request_id: "verifier_at_parent", response_type: "raw", path: `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(GITHUB_PUBLICATION_POLICY.verifier_path)}?ref=${parentSha}` },
  ];
}

export function githubPublicApiRequestPlan({
  runId,
  headSha,
  parentSha,
  anchorPath,
  previousAnchorPath = null,
}) {
  positiveInteger(runId, "GitHub request plan run ID");
  commitSha(headSha, "GitHub request plan head SHA");
  commitSha(parentSha, "GitHub request plan parent SHA");
  const { sequence } = anchorPathParts(anchorPath);
  if ((sequence === 1) !== (previousAnchorPath === null)) {
    fail("GitHub request plan requires exactly one previous anchor for every sequence after one");
  }
  if (previousAnchorPath !== null
    && anchorPathParts(previousAnchorPath).sequence !== sequence - 1) {
    fail("GitHub request plan previous anchor is not the immediate predecessor");
  }
  return Object.freeze(fixedGitHubRequests({
    runId,
    headSha,
    parentSha,
    anchorPath,
    previousAnchorPath,
  }).map((request) => Object.freeze({
    request_id: request.request_id,
    canonical_url: githubApiUrl(request.path),
    response_type: request.response_type,
  })));
}

function validateGitHubApiResponses(apiResponses, context, responseValues) {
  const requests = fixedGitHubRequests(context);
  if (![15, 16].includes(requests.length)
    || !Array.isArray(apiResponses)
    || apiResponses.length !== requests.length) {
    fail("GitHub public API response evidence must cover the exact bounded GET plan");
  }
  exact(responseValues, requests.map(({ request_id: requestId }) => requestId), "GitHub public API response values");
  const observations = requests.map((request, index) => {
    const response = apiResponses[index];
    exact(response, [
      "request_id", "canonical_url", "github_http_date", "response_bytes",
    ], `GitHub public API response ${index + 1}`);
    const expectedUrl = githubApiUrl(request.path);
    if (response.request_id !== request.request_id || response.canonical_url !== expectedUrl) {
      fail(`GitHub public API response ${index + 1} differs from the fixed request registry`);
    }
    githubHttpDate(response.github_http_date, `GitHub public API response ${index + 1} HTTP Date`);
    const maximum = request.response_type === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES;
    const bytes = boundedBytes(response.response_bytes, `GitHub public API response ${index + 1}`, maximum);
    if (request.response_type === "json") {
      let parsed;
      try {
        parsed = JSON.parse(bytes.toString("utf8"));
      } catch {
        fail(`GitHub public API response ${index + 1} is not valid JSON`);
      }
      if (stableJson(parsed) !== stableJson(responseValues[request.request_id])) {
        fail(`GitHub public API response ${index + 1} body differs from the validated value`);
      }
    } else {
      const expectedBytes = boundedBytes(
        responseValues[request.request_id],
        `GitHub public API response value ${index + 1}`,
        maximum,
      );
      if (!bytes.equals(expectedBytes)) {
        fail(`GitHub public API response ${index + 1} body differs from the validated bytes`);
      }
    }
    return {
      request_id: request.request_id,
      canonical_url: expectedUrl,
      github_http_date: response.github_http_date,
      response_byte_length: bytes.length,
      response_bytes_sha256: sha256Bytes(bytes),
    };
  });
  return {
    request_count: observations.length,
    responses: observations,
  };
}

function latestApiObservation(evidence) {
  return evidence.responses
    .map(({ github_http_date: dateHeader }) => new Date(dateHeader).toISOString())
    .reduce((latest, value) => value > latest ? value : latest);
}

async function readResponseBytes(response, label, maximum) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximum) fail(`${label} exceeded its response-size limit`);
  return bytes;
}

function responseObservation(response, label) {
  const dateHeader = response.headers?.get?.("date");
  if (typeof dateHeader !== "string") fail(`${label} omitted the GitHub HTTP Date header`);
  githubHttpDate(dateHeader, `${label} GitHub HTTP Date header`);
  return {
    githubHttpDate: dateHeader,
    observedAt: new Date(dateHeader).toISOString(),
  };
}

async function githubGet(path, {
  fetchImpl,
  accept = "application/vnd.github+json",
  responseType = "json",
  label,
  requestId,
}) {
  const repositoryRoute = "/repos/owlsowo/finly-bot";
  if (typeof path !== "string"
    || (path !== repositoryRoute && !path.startsWith(`${repositoryRoute}/`))
    || path.includes("..")) {
    fail("GitHub request escaped the fixed public repository route");
  }
  const url = new URL(path, GITHUB_PUBLICATION_POLICY.api_origin);
  if (url.origin !== GITHUB_PUBLICATION_POLICY.api_origin || url.protocol !== "https:") {
    fail("GitHub request escaped the fixed HTTPS API origin");
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        accept,
        "user-agent": "finly-forward-live-publication-verifier/4.0",
        "x-github-api-version": GITHUB_PUBLICATION_POLICY.api_version,
      },
    });
  } catch {
    fail(`${label} GitHub public GET failed`);
  }
  if (!response || response.ok !== true || response.status !== 200) {
    fail(`${label} GitHub public GET did not return HTTP 200`);
  }
  if (response.redirected === true) fail(`${label} GitHub public GET was redirected`);
  boundedText(requestId, "GitHub public GET request ID", 256);
  if (response.url !== url.href) {
    fail(`${label} GitHub public GET returned from an unexpected URL`);
  }
  const observation = responseObservation(response, label);
  const bytes = await readResponseBytes(
    response,
    label,
    responseType === "json" ? MAX_JSON_BYTES : MAX_RAW_BYTES,
  );
  const apiResponse = {
    request_id: requestId,
    canonical_url: url.href,
    github_http_date: observation.githubHttpDate,
    response_bytes: bytes,
  };
  if (responseType === "raw") {
    return { value: bytes.toString("utf8"), observedAt: observation.observedAt, apiResponse };
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} GitHub response was not valid JSON`);
  }
  return { value, observedAt: observation.observedAt, apiResponse };
}

export async function fetchAndValidateGitHubPublication({
  runId,
  anchorPath,
  expectedParentSha,
  previousReceipt = null,
  fetchImpl = globalThis.fetch,
}) {
  positiveInteger(runId, "GitHub workflow run ID");
  const { sequence } = anchorPathParts(anchorPath);
  commitSha(expectedParentSha, "expected publication parent SHA");
  if (sequence === 1) {
    if (previousReceipt !== null) fail("first-anchor publication cannot use a previous receipt");
  } else {
    if (previousReceipt === null) fail("successor publication requires a previous receipt");
    validateGitHubPublicationReceipt(previousReceipt);
    if (previousReceipt.commitment_sequence !== sequence - 1
      || previousReceipt.publication_commit.sha !== expectedParentSha) {
      fail("successor publication does not directly extend the previous receipt commit");
    }
  }
  if (typeof fetchImpl !== "function") fail("GitHub public fetch implementation is required");

  const repository = await githubGet("/repos/owlsowo/finly-bot", {
    fetchImpl,
    label: "repository",
    requestId: "repository",
  });
  validateRepository(repository.value);
  const run = await githubGet(`/repos/owlsowo/finly-bot/actions/runs/${runId}`, {
    fetchImpl,
    label: "workflow run",
    requestId: "anchor_workflow_run",
  });
  validateRun(run.value, runId);
  const jobs = await githubGet(`/repos/owlsowo/finly-bot/actions/runs/${runId}/jobs?per_page=100`, {
    fetchImpl,
    label: "workflow jobs",
    requestId: "anchor_workflow_jobs",
  });
  const commit = await githubGet(`/repos/owlsowo/finly-bot/commits/${run.value.head_sha}?per_page=100&page=1`, {
    fetchImpl,
    label: "publication commit",
    requestId: "publication_commit",
  });
  const activation = await githubGet(
    `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(GITHUB_PUBLICATION_POLICY.activation_path)}?ref=${expectedParentSha}`,
    {
      fetchImpl,
      accept: "application/vnd.github.raw+json",
      responseType: "raw",
      label: "activation content",
      requestId: "activation_at_parent",
    },
  );
  const runtimeManifest = await githubGet(
    `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(GITHUB_PUBLICATION_POLICY.runtime_manifest_path)}?ref=${expectedParentSha}`,
    {
      fetchImpl,
      accept: "application/vnd.github.raw+json",
      responseType: "raw",
      label: "runtime-manifest content",
      requestId: "runtime_manifest_at_parent",
    },
  );
  const runtimeSourceBytes = {};
  const runtimeSourceResponses = [];
  for (const path of GITHUB_PUBLICATION_POLICY.runtime_source_paths) {
    const source = await githubGet(
      `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(path)}?ref=${expectedParentSha}`,
      {
        fetchImpl,
        accept: "application/vnd.github.raw+json",
        responseType: "raw",
        label: `runtime source ${path}`,
        requestId: `runtime_source:${path}`,
      },
    );
    runtimeSourceBytes[path] = source.value;
    runtimeSourceResponses.push(source);
  }
  const parentFreezeRuns = await githubGet(
    `/repos/owlsowo/finly-bot/actions/workflows/${GITHUB_PUBLICATION_POLICY.workflow.id}/runs?branch=${GITHUB_PUBLICATION_POLICY.repository.default_branch}&event=push&status=success&head_sha=${expectedParentSha}&per_page=10`,
    {
      fetchImpl,
      label: "parent-publication workflow runs",
      requestId: "parent_publication_workflow_runs",
    },
  );
  const previousAnchor = previousReceipt === null ? null : await githubGet(
    `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(previousReceipt.anchor_path)}?ref=${expectedParentSha}`,
    {
      fetchImpl,
      accept: "application/vnd.github.raw+json",
      responseType: "raw",
      label: "previous anchor content",
      requestId: "previous_anchor_at_parent",
    },
  );
  const anchor = await githubGet(
    `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(anchorPath)}?ref=${run.value.head_sha}`,
    {
      fetchImpl,
      accept: "application/vnd.github.raw+json",
      responseType: "raw",
      label: "anchor content",
      requestId: "anchor_at_head",
    },
  );
  const workflow = await githubGet(
    `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(GITHUB_PUBLICATION_POLICY.workflow.path)}?ref=${expectedParentSha}`,
    {
      fetchImpl,
      accept: "application/vnd.github.raw+json",
      responseType: "raw",
      label: "workflow content",
      requestId: "workflow_at_parent",
    },
  );
  const verifierScript = await githubGet(
    `/repos/owlsowo/finly-bot/contents/${encodeRepositoryPath(GITHUB_PUBLICATION_POLICY.verifier_path)}?ref=${expectedParentSha}`,
    {
      fetchImpl,
      accept: "application/vnd.github.raw+json",
      responseType: "raw",
      label: "verifier content",
      requestId: "verifier_at_parent",
    },
  );
  const executingVerifierBytes = await readFile(fileURLToPath(import.meta.url));
  const executingRuntimeManifestBytes = await readFile(
    resolve(PROJECT_ROOT, GITHUB_PUBLICATION_POLICY.runtime_manifest_path),
  );
  const executingRuntimeSourceBytes = Object.fromEntries(await Promise.all(
    GITHUB_PUBLICATION_POLICY.runtime_source_paths.map(async (path) => [
      path,
      await readFile(resolve(PROJECT_ROOT, path)),
    ]),
  ));
  const apiResponses = [
    repository.apiResponse,
    run.apiResponse,
    jobs.apiResponse,
    commit.apiResponse,
    activation.apiResponse,
    runtimeManifest.apiResponse,
    ...runtimeSourceResponses.map(({ apiResponse }) => apiResponse),
    parentFreezeRuns.apiResponse,
    ...(previousAnchor === null ? [] : [previousAnchor.apiResponse]),
    anchor.apiResponse,
    workflow.apiResponse,
    verifierScript.apiResponse,
  ];
  return validateGitHubPublicationEvidence({
    repository: repository.value,
    run: run.value,
    jobs: jobs.value,
    commit: commit.value,
    parentFreezeRuns: parentFreezeRuns.value,
    activationBytes: activation.value,
    runtimeManifestBytes: runtimeManifest.value,
    runtimeSourceBytes,
    anchorBytes: anchor.value,
    previousAnchorBytes: previousAnchor?.value ?? null,
    previousReceipt,
    workflowBytes: workflow.value,
    verifierScriptBytes: verifierScript.value,
    executingVerifierBytes,
    executingRuntimeManifestBytes,
    executingRuntimeSourceBytes,
    apiResponses,
    runId,
    anchorPath,
    expectedParentSha,
  });
}

export function githubPublicationReceiptPlan(receipt) {
  validateGitHubPublicationReceipt(receipt);
  const filename = `${String(receipt.commitment_sequence).padStart(8, "0")}_${receipt.receipt_sha256.slice(7)}.json`;
  if (!ANCHOR_FILENAME.test(filename)) fail("GitHub publication receipt filename is not content addressed");
  const relativePath = `${GITHUB_PUBLICATION_RECEIPT_DIRECTORY}/${filename}`;
  return {
    bytes: Buffer.from(canonicalJson(receipt), "utf8"),
    filename,
    relativePath,
  };
}

async function ensureSafeReceiptDirectory(projectRoot) {
  const rootStatus = await lstat(projectRoot).catch(() => fail("receipt project root is missing"));
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("receipt project root must be a real directory");
  }
  const root = await realpath(projectRoot);
  let current = root;
  for (const component of GITHUB_PUBLICATION_RECEIPT_DIRECTORY.split("/")) {
    if (!/^[a-z0-9_]+$/i.test(component)) fail("receipt directory policy is invalid");
    current = resolve(current, component);
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
  if (await realpath(current) !== current) fail("receipt directory realpath is not fixed beneath the project root");
  return current;
}

async function syncDirectory(path) {
  const handle = await open(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function verifyExistingReceipt(path, expectedBytes) {
  let handle;
  try {
    handle = await open(
      path,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW | FS_CONSTANTS.O_NONBLOCK,
    );
    const status = await handle.stat();
    if (!status.isFile() || status.size !== expectedBytes.length || status.size > MAX_RAW_BYTES) {
      fail("existing GitHub publication receipt is non-regular, oversized, or content-addressed incorrectly");
    }
    const observed = await handle.readFile();
    if (!observed.equals(expectedBytes)) {
      fail("existing GitHub publication receipt differs at the same content address");
    }
  } catch (error) {
    if (error?.message?.startsWith("existing GitHub publication receipt")) throw error;
    fail("existing GitHub publication receipt cannot be safely verified");
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function publishGitHubPublicationReceiptWriteOnce(receipt, {
  projectRoot = PROJECT_ROOT,
} = {}) {
  const plan = githubPublicationReceiptPlan(receipt);
  const directory = await ensureSafeReceiptDirectory(projectRoot);
  const finalPath = resolve(directory, plan.filename);
  const stagePath = resolve(directory, `.receipt-${process.pid}-${randomUUID()}.tmp`);
  let stageHandle;
  let disposition;
  try {
    stageHandle = await open(
      stagePath,
      FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_NOFOLLOW,
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
  } finally {
    await stageHandle?.close().catch(() => {});
    await unlink(stagePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  await syncDirectory(directory);
  return Object.freeze({
    disposition,
    path: plan.relativePath,
    receipt_sha256: receipt.receipt_sha256,
  });
}

export async function loadGitHubPublicationReceipt(
  receiptPath,
  { projectRoot = PROJECT_ROOT } = {},
) {
  const parts = receiptPathParts(receiptPath);
  const rootStatus = await lstat(projectRoot).catch(() => fail("receipt project root is missing"));
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("receipt project root must be a real directory");
  }
  const root = await realpath(projectRoot);
  let current = root;
  for (const component of GITHUB_PUBLICATION_RECEIPT_DIRECTORY.split("/")) {
    current = resolve(current, component);
    const status = await lstat(current).catch(() => fail("previous receipt directory is missing"));
    if (status.isSymbolicLink() || !status.isDirectory()) {
      fail("previous receipt directory contains a symlink or non-directory component");
    }
  }
  if (await realpath(current) !== current) {
    fail("previous receipt directory realpath is not fixed beneath the project root");
  }
  const path = resolve(current, parts.filename);
  let handle;
  try {
    handle = await open(
      path,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW | FS_CONSTANTS.O_NONBLOCK,
    );
    const status = await handle.stat();
    if (!status.isFile() || status.size < 1 || status.size > MAX_RAW_BYTES) {
      fail("previous GitHub publication receipt is non-regular or oversized");
    }
    const bytes = await handle.readFile();
    let receipt;
    try {
      receipt = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("previous GitHub publication receipt is not valid JSON");
    }
    validateGitHubPublicationReceipt(receipt);
    if (!bytes.equals(Buffer.from(canonicalJson(receipt), "utf8"))
      || receipt.commitment_sequence !== parts.sequence
      || receipt.receipt_sha256.slice(7) !== parts.receiptHex) {
      fail("previous GitHub publication receipt path or canonical bytes are invalid");
    }
    return Object.freeze(receipt);
  } finally {
    await handle?.close().catch(() => {});
  }
}

const CLI_USAGE = "usage: node scripts/verify_forward_live_github_publication.mjs "
  + "--run-id <id> --anchor-path <path> --expected-parent-sha <sha> "
  + "[--previous-receipt-path <path>]";

export function parseGitHubPublicationCli(argv) {
  if (!Array.isArray(argv)) fail("CLI arguments must be an array");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--run-id", "--anchor-path", "--expected-parent-sha", "--previous-receipt-path"].includes(key)
      || typeof value !== "string"
      || value.length === 0
      || values.has(key)) {
      fail(CLI_USAGE);
    }
    values.set(key, value);
  }
  if (![3, 4].includes(values.size)) fail(CLI_USAGE);
  if (!/^\d+$/.test(values.get("--run-id"))) fail("--run-id must be a positive integer");
  const runId = Number(values.get("--run-id"));
  positiveInteger(runId, "--run-id");
  const anchorPath = values.get("--anchor-path");
  const anchor = anchorPathParts(anchorPath);
  const expectedParentSha = values.get("--expected-parent-sha");
  commitSha(expectedParentSha, "--expected-parent-sha");
  const previousReceiptPath = values.get("--previous-receipt-path") ?? null;
  if (anchor.sequence === 1) {
    if (previousReceiptPath !== null) fail("sequence one cannot use --previous-receipt-path");
  } else {
    if (previousReceiptPath === null) fail("sequences after one require --previous-receipt-path");
    if (receiptPathParts(previousReceiptPath).sequence !== anchor.sequence - 1) {
      fail("--previous-receipt-path must name the immediate prior sequence");
    }
  }
  return Object.freeze({ runId, anchorPath, expectedParentSha, previousReceiptPath });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseGitHubPublicationCli(argv);
  const previousReceipt = options.previousReceiptPath === null
    ? null
    : await loadGitHubPublicationReceipt(options.previousReceiptPath);
  const receipt = await fetchAndValidateGitHubPublication({
    runId: options.runId,
    anchorPath: options.anchorPath,
    expectedParentSha: options.expectedParentSha,
    previousReceipt,
  });
  const publication = await publishGitHubPublicationReceiptWriteOnce(receipt);
  process.stdout.write(canonicalJson(publication));
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`Forward-live GitHub publication verification failed closed: ${String(error?.message ?? error).slice(0, 800)}\n`);
    process.exitCode = 1;
  });
}
