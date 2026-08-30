import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../../lib/canonical.mjs";

export const ATTEMPT115_ID = "finly_prospective_profitability_attempt_115";
export const ATTEMPT115_PROTOCOL_SCHEMA =
  "finly_downside_semivolatility_challenger_protocol.v1";
export const ATTEMPT115_PROTOCOL_ID = "downside_semivolatility_challenger_v1";
export const ATTEMPT115_PROTOCOL_RELATIVE_PATH =
  "research/downside_semivolatility_challenger_protocol.json";
export const ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256 =
  "sha256:34d30a46e70c07b27fad637b1948262f953662b43e30cbbaf86b84927dbe0e53";
export const ATTEMPT115_PROTOCOL_SHA256 =
  "sha256:340ba21e8e3404bd42adcd8e4e30ea5f0f327ee2d891988564ca3f0654657619";
export const ATTEMPT115_FIRST_SIGNAL_SESSION = "2026-08-31";
export const ATTEMPT115_FIRST_SIGNAL_CLOSE_AT = "2026-08-31T20:00:00.000Z";
export const ATTEMPT115_FIRST_SIGNAL_ELIGIBLE_AT = "2026-08-31T20:15:00.000Z";
export const ATTEMPT115_FIRST_EXECUTION_SESSION = "2026-09-01";
export const ATTEMPT115_FIRST_EXECUTION_OPEN_AT = "2026-09-01T13:30:00.000Z";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "protocol_id",
  "attempt_number",
  "status",
  "registered_at",
  "evidence_class",
  "primary_specification_count",
  "trial_accounting",
  "hindsight_boundary",
  "incumbent_binding",
  "primary_specification",
  "prospective_comparison_design",
  "primary_inference",
  "sensitivity_and_finalization",
  "literature_basis",
  "authority_and_disposition",
  "claim_boundary",
  "protocol_sha256",
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

function canonicalInstant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
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

export function prospectiveAttempt115ProtocolBody(value) {
  plainObject(value, "Attempt 115 protocol");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "protocol_sha256"));
}

export function hashProspectiveAttempt115Protocol(value) {
  return sha256(prospectiveAttempt115ProtocolBody(value));
}

export function canonicalProspectiveAttempt115ProtocolJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateProspectiveAttempt115Protocol(value) {
  exactKeys(value, TOP_LEVEL_KEYS, "Attempt 115 protocol");
  if (value.schema_version !== ATTEMPT115_PROTOCOL_SCHEMA
    || value.protocol_id !== ATTEMPT115_PROTOCOL_ID
    || value.attempt_number !== 115
    || value.status !== "PROSPECTIVE_ONLY_LOCAL_SCAFFOLD_RUNNER_DISABLED"
    || value.evidence_class !== "PROSPECTIVE_ONLY_CHALLENGER_SCAFFOLD"
    || value.primary_specification_count !== 1) {
    fail("Attempt 115 protocol envelope changed");
  }
  if (canonicalInstant(value.registered_at, "Attempt 115 registered_at")
      >= ATTEMPT115_FIRST_SIGNAL_CLOSE_AT) {
    fail("Attempt 115 was not registered strictly before its first signal close");
  }
  if (value.protocol_sha256 !== ATTEMPT115_PROTOCOL_SHA256
    || hashProspectiveAttempt115Protocol(value) !== ATTEMPT115_PROTOCOL_SHA256) {
    fail("Attempt 115 protocol self-hash changed");
  }
  const boundary = plainObject(value.hindsight_boundary, "Attempt 115 hindsight boundary");
  if (boundary.last_consumed_session !== "2026-08-28"
    || boundary.first_eligible_signal_session !== ATTEMPT115_FIRST_SIGNAL_SESSION
    || boundary.first_eligible_execution_session !== ATTEMPT115_FIRST_EXECUTION_SESSION
    || boundary.existing_private_historical_bundle_eligible_for_scoring !== false
    || boundary.retrospective_runner_permitted !== false
    || boundary.execution_or_evaluation_date_on_or_before_cutoff_must_fail_closed !== true) {
    fail("Attempt 115 hindsight boundary changed");
  }
  const comparison = plainObject(
    value.prospective_comparison_design,
    "Attempt 115 comparison design",
  );
  if (comparison.single_scored_partition?.required_consecutive_execution_returns !== 252
    || comparison.single_scored_partition?.first_eligible_execution_session
      !== ATTEMPT115_FIRST_EXECUTION_SESSION
    || comparison.single_scored_partition?.no_skips !== true
    || comparison.single_scored_partition?.no_backfill !== true
    || comparison.single_scored_partition?.optional_stopping_permitted !== false
    || comparison.primary_cell?.execution_book !== "adjusted"
    || comparison.primary_cell?.rebalance_anchor !== 0
    || comparison.primary_cell?.one_way_cost_bps !== 5
    || comparison.rebalance_interval_sessions !== 5) {
    fail("Attempt 115 sample, primary cell, or cadence changed");
  }
  const inference = plainObject(value.primary_inference, "Attempt 115 primary inference");
  if (inference.intervals !== 252
    || inference.book !== "tsmom_ensemble_downside_semivol"
    || inference.comparator !== "tsmom_ensemble_vol"
    || inference.bootstrap_seed_uint32 !== 20260829
    || inference.bootstrap_resamples !== 4999
    || inference.expected_block_sessions !== 20
    || inference.restart_probability !== 0.05
    || inference.alpha !== 0.05
    || inference.interim_inference_permitted !== false
    || inference.repeat_confirmatory_test_permitted !== false
    || inference.result_changes_incumbent_policy !== false) {
    fail("Attempt 115 primary inference changed");
  }
  const authority = plainObject(
    value.authority_and_disposition,
    "Attempt 115 authority",
  );
  if (authority.research_only !== true
    || authority.network_authorized !== false
    || authority.broker_mutation_authorized !== false
    || authority.retrospective_evaluation_authorized !== false
    || authority.primary_inference_permitted_by_this_scaffold !== false
    || authority.prospective_result_can_modify_or_promote_incumbent !== false
    || authority.incumbent_after_every_outcome !== "tsmom_ensemble_vol") {
    fail("Attempt 115 authority or incumbent disposition changed");
  }
  return value;
}

export async function loadProspectiveAttempt115Protocol({
  projectRoot = REPOSITORY_ROOT,
} = {}) {
  const bytes = await readRegularFileWithoutSymlink(
    projectRoot,
    ATTEMPT115_PROTOCOL_RELATIVE_PATH,
  );
  if (rawBytesSha256(bytes) !== ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256) {
    fail("Attempt 115 protocol raw bytes changed");
  }
  let protocol;
  try {
    protocol = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`Attempt 115 protocol is not valid JSON: ${error.message}`);
  }
  if (bytes.toString("utf8") !== canonicalProspectiveAttempt115ProtocolJson(protocol)) {
    fail("Attempt 115 protocol is not canonical pretty JSON with one trailing newline");
  }
  return validateProspectiveAttempt115Protocol(protocol);
}

export async function verifyProspectiveAttempt115ProtocolBytes(options = {}) {
  const protocol = await loadProspectiveAttempt115Protocol(options);
  return Object.freeze({
    attempt_id: ATTEMPT115_ID,
    path: ATTEMPT115_PROTOCOL_RELATIVE_PATH,
    raw_bytes_sha256: ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
    protocol_sha256: protocol.protocol_sha256,
    canonical_bytes_verified: true,
    hindsight_boundary_verified: true,
    retrospective_scoring_permitted: false,
    receipt_sha256: sha256({
      attempt_id: ATTEMPT115_ID,
      path: ATTEMPT115_PROTOCOL_RELATIVE_PATH,
      raw_bytes_sha256: ATTEMPT115_PROTOCOL_RAW_BYTES_SHA256,
      protocol_sha256: protocol.protocol_sha256,
      canonical_bytes_verified: true,
      hindsight_boundary_verified: true,
      retrospective_scoring_permitted: false,
    }),
  });
}
