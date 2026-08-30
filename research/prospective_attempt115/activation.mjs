import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, stableStringify } from "../../lib/canonical.mjs";
import activationJson from "./activation.json" with { type: "json" };
import {
  ATTEMPT115_FIRST_EXECUTION_OPEN_AT,
  ATTEMPT115_FIRST_EXECUTION_SESSION,
  ATTEMPT115_FIRST_SIGNAL_CLOSE_AT,
  ATTEMPT115_FIRST_SIGNAL_ELIGIBLE_AT,
  ATTEMPT115_FIRST_SIGNAL_SESSION,
  ATTEMPT115_ID,
  ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
  ATTEMPT115_PROTOCOL_RELATIVE_PATH,
  ATTEMPT115_PROTOCOL_SHA256,
} from "./protocol.mjs";

export const ATTEMPT115_ACTIVATION_SCHEMA = "finly_attempt115_activation.v1";
export const ATTEMPT115_ACTIVATION_RELATIVE_PATH =
  "research/prospective_attempt115/activation.json";
export const ATTEMPT115_ACTIVATION_SHA256 =
  "sha256:96f03b0a592f7f8358507ffa04e04ba28f8f51fdbe916975982ce8b00f6afc51";
export const ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256 =
  "sha256:6519ccca48848b8b8d20593c011a11bd2b3f98c608cf4c1fbd61bf2347841255";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "attempt_id",
  "entry_kind",
  "frozen_at",
  "publication_deadline",
  "protocol",
  "upstream_capture",
  "deterministic_commitment",
  "sample",
  "initial_state",
  "authority",
  "evaluation_gates",
  "assurance",
  "claim_boundary",
  "activation_sha256",
]);

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

export function prospectiveAttempt115ActivationBody(value) {
  plainObject(value, "Attempt 115 activation");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "activation_sha256"));
}

export function hashProspectiveAttempt115Activation(value) {
  return sha256(prospectiveAttempt115ActivationBody(value));
}

export function canonicalProspectiveAttempt115ActivationJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateProspectiveAttempt115Activation(value) {
  exactKeys(value, TOP_LEVEL_KEYS, "Attempt 115 activation");
  if (value.schema_version !== ATTEMPT115_ACTIVATION_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || value.entry_kind !== "PRE_SIGNAL_DETERMINISTIC_INPUT_COMMITMENT_ACTIVATION") {
    fail("Attempt 115 activation envelope changed");
  }
  if (instant(value.frozen_at, "Attempt 115 activation frozen_at")
      >= ATTEMPT115_FIRST_SIGNAL_CLOSE_AT
    || value.publication_deadline !== ATTEMPT115_FIRST_SIGNAL_CLOSE_AT) {
    fail("Attempt 115 activation is not strictly pre-signal");
  }
  same(value.protocol, {
    path: ATTEMPT115_PROTOCOL_RELATIVE_PATH,
    raw_bytes_sha256: ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
  }, "Attempt 115 activation protocol binding");
  const upstream = plainObject(value.upstream_capture, "Attempt 115 upstream capture");
  if (upstream.trial_id !== "finly_forward_trial_live_1a"
    || upstream.activation?.path !== "research/forward_trial_live/activation.json"
    || upstream.activation?.raw_bytes_sha256
      !== "sha256:ecf7a16fbe84061799b8df6db7b58e8b8b0f028e8d7a4c4147b08b20d45a6180"
    || upstream.activation?.activation_sha256
      !== "sha256:a9ad429e2094d7cb59300bab18727306121554b62ac112a8e297ce9e12b2800d"
    || upstream.runtime_manifest?.path !== "research/forward_trial_live/runtime_manifest.json"
    || upstream.runtime_manifest?.raw_bytes_sha256
      !== "sha256:c5df20d6bc9908d89cfef46b0d3c1901688a25835e22fa87f14e7c73cf6c3d1c"
    || upstream.runtime_manifest?.manifest_sha256
      !== "sha256:9ab2b2d7b3e788880db9d6de1212fa485967472b1f0fae5963c6c51f88912457"
    || upstream.commitment_schema !== "finly_forward_trial_live_commitment.v2"
    || upstream.public_anchor_schema !== "finly_forward_trial_live_public_anchor.v2"
    || upstream.github_publication_receipt_schema
      !== "finly_forward_trial_live_github_publication_receipt.v4"
    || upstream.required_adjusted_history_sessions !== 253
    || stableStringify(upstream.required_symbols) !== stableStringify(["SPY", "BIL"])) {
    fail("Attempt 115 upstream capture binding changed");
  }
  const commitment = plainObject(
    value.deterministic_commitment,
    "Attempt 115 deterministic commitment",
  );
  if (commitment.mechanism
      !== "PREPUBLISHED_DETERMINISTIC_FUNCTION_OVER_PREOPEN_PUBLIC_INPUT_HASH"
    || commitment.public_input_hash_field !== "forward_public_anchor.private_bundle_sha256"
    || commitment.separate_attempt115_signal_anchor_required !== false
    || commitment.forward_next_close_deadline_alone_sufficient !== false
    || commitment.timeliness_rule
      !== "The existing forward-anchor GitHub workflow and verification job must complete strictly before the reopened bundle's committed next_market_open_at."
    || commitment.github_commit_timestamp_used !== false
    || commitment.independent_cryptographic_timestamp_verified !== false) {
    fail("Attempt 115 deterministic input-commitment rule changed");
  }
  const sample = plainObject(value.sample, "Attempt 115 activation sample");
  if (sample.first_signal_session !== ATTEMPT115_FIRST_SIGNAL_SESSION
    || sample.first_signal_market_close_at !== ATTEMPT115_FIRST_SIGNAL_CLOSE_AT
    || sample.first_signal_bar_eligible_at !== ATTEMPT115_FIRST_SIGNAL_ELIGIBLE_AT
    || sample.first_execution_session !== ATTEMPT115_FIRST_EXECUTION_SESSION
    || sample.first_execution_market_open_at !== ATTEMPT115_FIRST_EXECUTION_OPEN_AT
    || sample.required_policy_signal_commitments !== 252
    || sample.required_upstream_source_bundles !== 253
    || sample.required_primary_settlements !== 252
    || sample.no_skips !== true || sample.no_backfill !== true
    || sample.replacement_window_permitted !== false
    || sample.optional_stopping_permitted !== false) {
    fail("Attempt 115 activation sample changed");
  }
  const state = plainObject(value.initial_state, "Attempt 115 initial state");
  same(state.both_books_initial_weights, { SPY: 0, BIL: 1 }, "Attempt 115 initial weights");
  if (state.incumbent_policy_id !== "tsmom_ensemble_vol"
    || state.challenger_policy_id !== "tsmom_ensemble_downside_semivol"
    || state.rebalance_interval_sessions !== 5
    || state.rebalance_anchor !== 0
    || state.first_commitment_sequence !== 1
    || state.first_commitment_rebalances !== true) {
    fail("Attempt 115 initial policy state changed");
  }
  same(value.authority, {
    research_only: true,
    alpaca_or_broker_network_requests_permitted: false,
    public_github_get_verification_permitted: true,
    broker_reads_permitted: false,
    broker_mutation_authorized: false,
    order_payload: null,
    retrospective_scoring_permitted: false,
    public_claim_mutation_authorized: false,
  }, "Attempt 115 activation authority");
  same(value.evaluation_gates, {
    protocol_activation_runtime_publication_verified: false,
    input_commitment_replay_enabled: false,
    settlement_enabled: false,
    inference_enabled: false,
  }, "Attempt 115 activation gates");
  if (value.assurance?.github_publication_before_first_signal_close_required !== true
    || value.assurance?.all_first_252_forward_input_hashes_verified_before_their_committed_next_opens_required !== true
    || value.assurance?.all_first_253_forward_private_bundles_reopened_and_verified_required !== true
    || value.assurance?.all_first_252_outcome_price_lineages_required !== true
    || value.assurance?.provider_origin_verified !== false
    || value.assurance?.broker_execution_verified !== false
    || value.assurance?.performance_inference_permitted !== false) {
    fail("Attempt 115 activation assurance changed");
  }
  digest(value.activation_sha256, "Attempt 115 activation hash");
  if (value.activation_sha256 !== ATTEMPT115_ACTIVATION_SHA256
    || hashProspectiveAttempt115Activation(value) !== ATTEMPT115_ACTIVATION_SHA256) {
    fail("Attempt 115 activation self-hash changed");
  }
  return value;
}

export async function loadProspectiveAttempt115Activation({
  projectRoot = REPOSITORY_ROOT,
} = {}) {
  const bytes = await readRegularFileWithoutSymlink(
    projectRoot,
    ATTEMPT115_ACTIVATION_RELATIVE_PATH,
  );
  if (rawBytesSha256(bytes) !== ATTEMPT115_ACTIVATION_RAW_BYTES_SHA256) {
    fail("Attempt 115 activation raw bytes changed");
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`Attempt 115 activation is not valid JSON: ${error.message}`);
  }
  if (bytes.toString("utf8") !== canonicalProspectiveAttempt115ActivationJson(value)) {
    fail("Attempt 115 activation is not canonical pretty JSON with one trailing newline");
  }
  return validateProspectiveAttempt115Activation(value);
}

export const ATTEMPT115_ACTIVATION = Object.freeze(
  validateProspectiveAttempt115Activation(activationJson),
);
