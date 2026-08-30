import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, stableStringify } from "../../lib/canonical.mjs";
import {
  ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256,
  ATTEMPT115_ACTIVATION_RELATIVE_PATH,
  ATTEMPT115_ACTIVATION_SHA256,
  loadProspectiveAttempt115Activation,
  validateProspectiveAttempt115Activation,
} from "./activation.mjs";
import {
  ATTEMPT115_FIRST_SIGNAL_CLOSE_AT,
  ATTEMPT115_ID,
  ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
  ATTEMPT115_PROTOCOL_RELATIVE_PATH,
  ATTEMPT115_PROTOCOL_SHA256,
  loadProspectiveAttempt115Protocol,
} from "./protocol.mjs";

export const ATTEMPT115_RUNTIME_MANIFEST_SCHEMA = "finly_attempt115_runtime_manifest.v1";
export const ATTEMPT115_RUNTIME_MANIFEST_RELATIVE_PATH =
  "research/prospective_attempt115/runtime_manifest.json";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export const ATTEMPT115_FROZEN_REFERENCE_SOURCE_HASHES = Object.freeze({
  ".github/workflows/ci.yml":
    "sha256:f23196c2cd6e070455395490e7fde6ad14b8ae31016771188269d85cb75e70e5",
  "lib/canonical.mjs":
    "sha256:05d7803cff866893f3c97e3b15ee49cbd46eb2376c63a06fe142f8589a7e0904",
  "lib/economic_research.mjs":
    "sha256:efde15977d43fb5556683ce7ba5ca7fe29fa82a1cc6acd9632d8f6e6fc5c1256",
  "lib/forward_market_data.mjs":
    "sha256:a7d8597f3733817fed3420b07ca2a51fece15f4b37b69d5b4e462ec6e9dfc053",
  "research/champion_trial_ledger_generation6.json":
    "sha256:f1b35f0b6ff50888b4ca7dbb6c1bb46258af081c09cf344d44adc88753991ecf",
  "research/downside_semivolatility_challenger.mjs":
    "sha256:ec9f9422471901ed933cbd2f5dac08ec8c4915fc1b724806437ec0d2083f9a83",
  "research/downside_semivolatility_challenger_protocol.json":
    ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
  "research/equity_execution_realism.mjs":
    "sha256:12212bbecb3b6d11033ec7289be624405b56c42cdbd4659034fefe24487d79f6",
  "research/forward_trial_live/activation.json":
    "sha256:ecf7a16fbe84061799b8df6db7b58e8b8b0f028e8d7a4c4147b08b20d45a6180",
  "research/forward_trial_live/runtime_manifest.json":
    "sha256:c5df20d6bc9908d89cfef46b0d3c1901688a25835e22fa87f14e7c73cf6c3d1c",
  "research/forward_trial_live_core.mjs":
    "sha256:ef8651fe4ada18045dd8765f30746936254917f599d89d1bd89f514c9e43f523",
  "research/prospective_attempt114/inference.mjs":
    "sha256:62f64a60797500d35191fa7a7d53e31d93e0c5b125a0b9533cc8d43372b0f88f",
  "research/prospective_attempt114/protocol.json":
    "sha256:794bb93d578b4b4766daac1c27d7fa0a68f730fbeda853b208aa98ad501572ff",
  "research/prospective_attempt114/runtime.mjs":
    "sha256:c6eeefccdf26f50f20a5fec781809e525009f63a40ee4d7a964cb866f305079f",
  "research/prospective_attempt114/runtime_manifest.json":
    "sha256:c3fbcb985385ef9dcbc118824a6e318b1e39f45b290e180a6a1f1f0865ea9966",
  "research/prospective_attempt114/settlement.mjs":
    "sha256:3c6c5eeaf864bccbbb7afa0346bc4bbfe1d9532f4c56541a2a64139c84a29079",
  "research/run_forward_trial_live.mjs":
    "sha256:221fd0f6a2ce17041f5984cfc68baa6b68648337ccf678e758640d929d318fea",
  "scripts/verify_forward_live_github_publication.mjs":
    "sha256:424716274d2b304d0197964bd4d0f5efc28147912aa4f032d2a2ff4491472af5",
});

export const ATTEMPT115_LOCAL_RUNTIME_SOURCE_PATHS = Object.freeze([
  ATTEMPT115_ACTIVATION_RELATIVE_PATH,
  "research/prospective_attempt115/activation.mjs",
  "research/prospective_attempt115/inference.mjs",
  "research/prospective_attempt115/policy.mjs",
  "research/prospective_attempt115/protocol.mjs",
  "research/prospective_attempt115/runtime.mjs",
  "research/prospective_attempt115/settlement.mjs",
  "scripts/verify_attempt115_forward_anchor.mjs",
  "scripts/verify_attempt115_github_publication.mjs",
]);

export const ATTEMPT115_RUNTIME_SOURCE_PATHS = Object.freeze(
  [...new Set([
    ...Object.keys(ATTEMPT115_FROZEN_REFERENCE_SOURCE_HASHES),
    ...ATTEMPT115_LOCAL_RUNTIME_SOURCE_PATHS,
  ])].sort((left, right) => left.localeCompare(right)),
);

export const ATTEMPT115_EXECUTABLE_RUNTIME_ENTRY_PATHS = Object.freeze([
  "research/prospective_attempt115/activation.mjs",
  "research/prospective_attempt115/inference.mjs",
  "research/prospective_attempt115/policy.mjs",
  "research/prospective_attempt115/protocol.mjs",
  "research/prospective_attempt115/runtime.mjs",
  "research/prospective_attempt115/settlement.mjs",
  "scripts/verify_attempt115_forward_anchor.mjs",
  "scripts/verify_attempt115_github_publication.mjs",
]);

const AUTHORITY = Object.freeze({
  research_only: true,
  alpaca_or_broker_network_requests_permitted: false,
  public_github_get_verification_permitted: true,
  broker_reads_permitted: false,
  broker_mutation_authorized: false,
  order_payload: null,
  content_addressed_local_evidence_persistence_permitted: true,
  retrospective_scoring_permitted: false,
  public_claim_mutation_authorized: false,
});

const EVALUATION_GATES = Object.freeze({
  protocol_activation_runtime_publication_verified: false,
  input_commitment_replay_enabled: false,
  settlement_enabled: false,
  inference_enabled: false,
});

const ASSURANCE = Object.freeze({
  github_publication_before_first_signal_close_required: true,
  separate_attempt115_signal_anchor_required: false,
  frozen_function_over_preopen_forward_input_hash_required: true,
  all_first_252_forward_input_publication_runs_complete_before_committed_next_open_required: true,
  all_first_253_forward_private_bundles_and_public_anchors_required: true,
  all_first_252_outcome_price_lineages_required: true,
  independent_cryptographic_timestamp_verified: false,
  provider_origin_verified: false,
  broker_execution_verified: false,
  performance_inference_permitted: false,
});

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function same(actual, expected, label) {
  if (stableStringify(actual) !== stableStringify(expected)) fail(`${label} changed`);
}

function instant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function rawBytesSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readRegularFileWithoutSymlink(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.startsWith("../") || relativePath.includes("/../")) {
    fail(`unsafe repository-relative path: ${relativePath}`);
  }
  const rootStatus = await lstat(projectRoot);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("Attempt 115 project root must be a real directory");
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

function localStaticImports(sourcePath, bytes) {
  if (!sourcePath.endsWith(".mjs")) return [];
  const text = bytes.toString("utf8");
  const specifiers = [];
  const fromPattern = /\bfrom\s+["'](\.[^"']+)["']/gu;
  const sideEffectPattern = /^\s*import\s+["'](\.[^"']+)["']/gmu;
  const dynamicPattern = /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/gu;
  for (const pattern of [fromPattern, sideEffectPattern, dynamicPattern]) {
    let match = pattern.exec(text);
    while (match !== null) {
      specifiers.push(match[1]);
      match = pattern.exec(text);
    }
  }
  return [...new Set(specifiers.map((specifier) => {
    let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
    if (path.posix.extname(resolved) === "") resolved += ".mjs";
    return resolved;
  }))];
}

function validateStaticImportClosure(sourceBytes) {
  const allowed = new Set(ATTEMPT115_RUNTIME_SOURCE_PATHS);
  const pending = [...ATTEMPT115_EXECUTABLE_RUNTIME_ENTRY_PATHS];
  const visited = new Set();
  while (pending.length > 0) {
    const sourcePath = pending.shift();
    if (visited.has(sourcePath)) continue;
    if (!allowed.has(sourcePath) || !Buffer.isBuffer(sourceBytes[sourcePath])) {
      fail(`Attempt 115 executable import is absent from the source closure: ${sourcePath}`);
    }
    visited.add(sourcePath);
    for (const importedPath of localStaticImports(sourcePath, sourceBytes[sourcePath])) {
      if (!allowed.has(importedPath)) {
        fail(`Attempt 115 source closure omits local import ${importedPath} from ${sourcePath}`);
      }
      pending.push(importedPath);
    }
  }
  return [...visited].sort((left, right) => left.localeCompare(right));
}

async function loadSourceHashes(projectRoot) {
  const hashes = {};
  const bytesByPath = {};
  for (const sourcePath of ATTEMPT115_RUNTIME_SOURCE_PATHS) {
    const bytes = await readRegularFileWithoutSymlink(projectRoot, sourcePath);
    bytesByPath[sourcePath] = bytes;
    hashes[sourcePath] = rawBytesSha256(bytes);
  }
  for (const [sourcePath, expected] of Object.entries(
    ATTEMPT115_FROZEN_REFERENCE_SOURCE_HASHES,
  )) {
    if (hashes[sourcePath] !== expected) {
      fail(`Attempt 115 frozen reference source changed: ${sourcePath}`);
    }
  }
  if (hashes[ATTEMPT115_PROTOCOL_RELATIVE_PATH] !== ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256
    || hashes[ATTEMPT115_ACTIVATION_RELATIVE_PATH]
      !== ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256) {
    fail("Attempt 115 protocol or activation raw bytes changed");
  }
  validateStaticImportClosure(bytesByPath);
  return hashes;
}

export function prospectiveAttempt115RuntimeManifestBody(value) {
  plainObject(value, "Attempt 115 runtime manifest");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "manifest_sha256"));
}

export function hashProspectiveAttempt115RuntimeManifest(value) {
  return sha256(prospectiveAttempt115RuntimeManifestBody(value));
}

export function canonicalProspectiveAttempt115RuntimeManifestJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateProspectiveAttempt115RuntimeManifest(value) {
  exactKeys(value, [
    "schema_version",
    "attempt_id",
    "manifest_kind",
    "frozen_at",
    "publication_deadline",
    "publication_deadline_exclusive",
    "protocol",
    "activation",
    "runtime_source_files",
    "runtime_source_files_sha256",
    "authority",
    "evaluation_gates",
    "assurance",
    "claim_boundary",
    "manifest_sha256",
  ], "Attempt 115 runtime manifest");
  if (value.schema_version !== ATTEMPT115_RUNTIME_MANIFEST_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || value.manifest_kind !== "PRE_SIGNAL_DETERMINISTIC_COMMIT_REVEAL_RUNTIME_FREEZE") {
    fail("Attempt 115 runtime manifest envelope changed");
  }
  if (instant(value.frozen_at, "Attempt 115 runtime frozen_at")
      >= ATTEMPT115_FIRST_SIGNAL_CLOSE_AT
    || value.publication_deadline !== ATTEMPT115_FIRST_SIGNAL_CLOSE_AT
    || value.publication_deadline_exclusive !== true) {
    fail("Attempt 115 runtime manifest is not strictly pre-signal");
  }
  same(value.protocol, {
    path: ATTEMPT115_PROTOCOL_RELATIVE_PATH,
    raw_bytes_sha256: ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
  }, "Attempt 115 runtime protocol binding");
  same(value.activation, {
    path: ATTEMPT115_ACTIVATION_RELATIVE_PATH,
    raw_bytes_sha256: ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256,
    activation_sha256: ATTEMPT115_ACTIVATION_SHA256,
  }, "Attempt 115 runtime activation binding");
  exactKeys(
    value.runtime_source_files,
    ATTEMPT115_RUNTIME_SOURCE_PATHS,
    "Attempt 115 runtime source map",
  );
  for (const [sourcePath, sourceHash] of Object.entries(value.runtime_source_files)) {
    digest(sourceHash, `Attempt 115 runtime source hash ${sourcePath}`);
  }
  for (const [sourcePath, expected] of Object.entries(
    ATTEMPT115_FROZEN_REFERENCE_SOURCE_HASHES,
  )) {
    if (value.runtime_source_files[sourcePath] !== expected) {
      fail(`Attempt 115 runtime changes frozen reference source: ${sourcePath}`);
    }
  }
  if (value.runtime_source_files[ATTEMPT115_PROTOCOL_RELATIVE_PATH]
      !== ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256
    || value.runtime_source_files[ATTEMPT115_ACTIVATION_RELATIVE_PATH]
      !== ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256) {
    fail("Attempt 115 runtime source map changes protocol or activation bytes");
  }
  if (value.runtime_source_files_sha256 !== sha256(value.runtime_source_files)) {
    fail("Attempt 115 runtime source-map hash changed");
  }
  same(value.authority, AUTHORITY, "Attempt 115 runtime authority");
  same(value.evaluation_gates, EVALUATION_GATES, "Attempt 115 runtime gates");
  same(value.assurance, ASSURANCE, "Attempt 115 runtime assurance");
  if (value.claim_boundary
      !== "This manifest binds the exact pre-signal Attempt 115 protocol, activation, deterministic policy compiler, input-hash verifier, settlement, inference, and frozen upstream source bytes. It does not itself prove public publication, open replay, settlement, or inference gates, verify provider origin or broker execution, authorize trading, or establish profitability.") {
    fail("Attempt 115 runtime claim boundary changed");
  }
  digest(value.manifest_sha256, "Attempt 115 runtime manifest hash");
  if (value.manifest_sha256 !== hashProspectiveAttempt115RuntimeManifest(value)) {
    fail("Attempt 115 runtime manifest self-hash changed");
  }
  return value;
}

export async function buildProspectiveAttempt115RuntimeManifest(
  { frozen_at: frozenAt },
  { projectRoot = REPOSITORY_ROOT } = {},
) {
  if (instant(frozenAt, "Attempt 115 runtime frozen_at")
      >= ATTEMPT115_FIRST_SIGNAL_CLOSE_AT) {
    fail("Attempt 115 runtime must be frozen strictly before the first signal close");
  }
  await loadProspectiveAttempt115Protocol({ projectRoot });
  const activation = await loadProspectiveAttempt115Activation({ projectRoot });
  validateProspectiveAttempt115Activation(activation);
  const sourceHashes = await loadSourceHashes(projectRoot);
  const body = {
    schema_version: ATTEMPT115_RUNTIME_MANIFEST_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    manifest_kind: "PRE_SIGNAL_DETERMINISTIC_COMMIT_REVEAL_RUNTIME_FREEZE",
    frozen_at: frozenAt,
    publication_deadline: ATTEMPT115_FIRST_SIGNAL_CLOSE_AT,
    publication_deadline_exclusive: true,
    protocol: {
      path: ATTEMPT115_PROTOCOL_RELATIVE_PATH,
      raw_bytes_sha256: ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
      protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    },
    activation: {
      path: ATTEMPT115_ACTIVATION_RELATIVE_PATH,
      raw_bytes_sha256: ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256,
      activation_sha256: ATTEMPT115_ACTIVATION_SHA256,
    },
    runtime_source_files: sourceHashes,
    runtime_source_files_sha256: sha256(sourceHashes),
    authority: structuredClone(AUTHORITY),
    evaluation_gates: structuredClone(EVALUATION_GATES),
    assurance: structuredClone(ASSURANCE),
    claim_boundary: "This manifest binds the exact pre-signal Attempt 115 protocol, activation, deterministic policy compiler, input-hash verifier, settlement, inference, and frozen upstream source bytes. It does not itself prove public publication, open replay, settlement, or inference gates, verify provider origin or broker execution, authorize trading, or establish profitability.",
  };
  return Object.freeze(validateProspectiveAttempt115RuntimeManifest({
    ...body,
    manifest_sha256: sha256(body),
  }));
}

export async function verifyProspectiveAttempt115RuntimeManifestSources(
  manifest,
  { projectRoot = REPOSITORY_ROOT } = {},
) {
  validateProspectiveAttempt115RuntimeManifest(manifest);
  const actual = await loadSourceHashes(projectRoot);
  if (stableStringify(actual) !== stableStringify(manifest.runtime_source_files)) {
    fail("Attempt 115 executing source bytes differ from the runtime manifest");
  }
  const body = {
    schema_version: "finly_attempt115_runtime_source_verification_receipt.v1",
    attempt_id: ATTEMPT115_ID,
    manifest_sha256: manifest.manifest_sha256,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    activation_sha256: ATTEMPT115_ACTIVATION_SHA256,
    runtime_source_files_sha256: manifest.runtime_source_files_sha256,
    source_files_verified: ATTEMPT115_RUNTIME_SOURCE_PATHS.length,
    source_bytes_verified: true,
    symlink_traversal_rejected: true,
    separate_attempt115_signal_anchor_required: false,
    input_commitment_replay_enabled: false,
    settlement_enabled: false,
    inference_enabled: false,
    broker_mutation_authorized: false,
  };
  return Object.freeze({ ...body, receipt_sha256: sha256(body) });
}
