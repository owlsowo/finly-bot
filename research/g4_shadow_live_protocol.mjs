import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../lib/canonical.mjs";
import { G4_SHADOW_SYMBOLS } from "./g4_shadow_signal.mjs";

export const G4_SHADOW_LIVE_ID = "finly_g4_shadow_live_1";
export const G4_SHADOW_LIVE_PROTOCOL_SCHEMA = "finly_g4_shadow_live_protocol.v1";
export const G4_SHADOW_LIVE_PROTOCOL_PATH = "research/g4_shadow_live/protocol.json";
export const G4_SHADOW_LIVE_PROTOCOL_SHA256 = "sha256:51a636dfaadfb283651f8735695a0594fc78421189eb8abf2a7fe0eb01036a35";
export const G4_SHADOW_LIVE_PROTOCOL_RAW_BYTES_SHA256 = "sha256:e4e20e131f955c0d9bb30307d42a6d4e78d66927567d942f244b447be006333b";
export const G4_SHADOW_LIVE_FIRST_SIGNAL_SESSION = "2026-08-31";
export const G4_SHADOW_LIVE_FIRST_SIGNAL_ELIGIBLE_AT = "2026-08-31T20:15:00.000Z";
export const G4_SHADOW_LIVE_FIRST_EXECUTION_SESSION = "2026-09-01";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

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

function instant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function protocolBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "protocol_sha256"));
}

export function hashG4ShadowLiveProtocol(value) {
  return sha256(protocolBody(value));
}

export function canonicalG4ShadowLiveProtocolJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateG4ShadowLiveProtocol(value) {
  exactKeys(value, [
    "schema_version", "trial_id", "status", "registered_at", "hindsight_boundary",
    "upstream_capture", "frozen_strategy", "signal_chronology", "shadow_account",
    "comparison", "publication", "authority", "claim_policy", "protocol_sha256",
  ], "G4 shadow live protocol");
  if (value.schema_version !== G4_SHADOW_LIVE_PROTOCOL_SCHEMA
    || value.trial_id !== G4_SHADOW_LIVE_ID
    || value.status !== "FROZEN_BEFORE_FIRST_SIGNAL") {
    fail("G4 shadow live protocol envelope changed");
  }
  if (instant(value.registered_at, "G4 shadow registered_at") >= G4_SHADOW_LIVE_FIRST_SIGNAL_ELIGIBLE_AT) {
    fail("G4 shadow live protocol was not frozen before the first signal became eligible");
  }
  if (!SHA256.test(value.protocol_sha256)
    || value.protocol_sha256 !== G4_SHADOW_LIVE_PROTOCOL_SHA256
    || hashG4ShadowLiveProtocol(value) !== G4_SHADOW_LIVE_PROTOCOL_SHA256) {
    fail("G4 shadow live protocol hash changed");
  }

  const boundary = plainObject(value.hindsight_boundary, "G4 shadow hindsight boundary");
  if (boundary.last_consumed_session !== "2026-08-28"
    || boundary.first_eligible_signal_session !== G4_SHADOW_LIVE_FIRST_SIGNAL_SESSION
    || boundary.first_eligible_execution_session !== G4_SHADOW_LIVE_FIRST_EXECUTION_SESSION
    || boundary.no_backfill !== true
    || boundary.strategy_revision_after_freeze_permitted !== false) {
    fail("G4 shadow hindsight boundary changed");
  }

  const upstream = plainObject(value.upstream_capture, "G4 shadow upstream capture");
  if (upstream.trial_id !== "finly_forward_trial_live_1a"
    || upstream.activation_sha256 !== "sha256:a9ad429e2094d7cb59300bab18727306121554b62ac112a8e297ce9e12b2800d"
    || upstream.runtime_manifest_sha256 !== "sha256:9ab2b2d7b3e788880db9d6de1212fa485967472b1f0fae5963c6c51f88912457"
    || upstream.market_data_provider !== "Alpaca Market Data API"
    || upstream.feed !== "iex"
    || upstream.adjusted_signal_book !== "all"
    || upstream.raw_shadow_book !== "raw"
    || sha256(upstream.symbols) !== sha256(G4_SHADOW_SYMBOLS)) {
    fail("G4 shadow upstream capture binding changed");
  }

  const strategy = plainObject(value.frozen_strategy, "G4 shadow strategy");
  if (strategy.strategy_id !== "qqq_core_sector_12_6"
    || strategy.technology_core_symbol !== "QQQ"
    || strategy.technology_core_weight !== 0.5
    || strategy.sector_satellite_count !== 3
    || strategy.weight_per_selected_sector !== 1 / 6
    || strategy.momentum_start_sessions !== 252
    || strategy.momentum_end_sessions !== 126
    || strategy.lookback_sessions !== 252
    || strategy.rebalance_interval_sessions !== 21
    || strategy.rebalance_anchor !== 0
    || strategy.long_only !== true
    || strategy.maximum_risky_gross !== 1) {
    fail("G4 shadow frozen strategy changed");
  }

  const chronology = plainObject(value.signal_chronology, "G4 shadow chronology");
  if (chronology.signal_time !== "COMPLETED_SESSION_CLOSE"
    || chronology.capture_delay_minutes !== 15
    || chronology.execution_time !== "NEXT_COMPLETED_SESSION_CLOSE"
    || chronology.first_return_interval !== "EXECUTION_CLOSE_TO_FOLLOWING_CLOSE"
    || chronology.hold_between_scheduled_rebalances !== true) {
    fail("G4 shadow signal chronology changed");
  }

  const account = plainObject(value.shadow_account, "G4 shadow account");
  if (account.currency !== "USD"
    || account.initial_cash_usd !== 300
    || account.monthly_contribution_usd !== 300
    || account.first_additional_contribution_month !== "2026-10"
    || account.fractional_shares !== true
    || account.minimum_order_notional_usd !== 1
    || account.sell_before_buy !== true
    || account.self_financing !== true
    || account.one_way_transaction_cost_bps !== 5
    || account.slippage_bps !== 0
    || account.no_margin !== true) {
    fail("G4 shadow account specification changed");
  }

  const comparison = plainObject(value.comparison, "G4 shadow comparison");
  if (comparison.benchmark !== "SPY"
    || comparison.identical_contribution_schedule !== true
    || comparison.identical_cost_model !== true
    || comparison.primary_metric !== "ENDING_WEALTH_DIFFERENCE_USD"
    || comparison.secondary_metrics.join("|") !== "TIME_WEIGHTED_RETURN|MAXIMUM_DRAWDOWN|REALIZED_VOLATILITY|TOTAL_MODELED_COST") {
    fail("G4 shadow comparison changed");
  }

  const publication = plainObject(value.publication, "G4 shadow publication");
  if (publication.write_once !== true
    || publication.hash_chained !== true
    || publication.publish_before_outcome_interval !== true
    || publication.public_fields.join("|")
      !== "signal_session_date|captured_at|strategy_id|target_weights|selected_sectors|modeled_orders|shadow_equity|spy_shadow_equity|contributions_to_date|modeled_costs_to_date|source_panel_sha256|previous_record_sha256|record_sha256") {
    fail("G4 shadow publication contract changed");
  }

  const authority = plainObject(value.authority, "G4 shadow authority");
  if (authority.market_data_read_only !== true
    || authority.shadow_only !== true
    || authority.broker_mutation_authorized !== false
    || authority.order_submission_permitted !== false
    || authority.real_money_permitted !== false) {
    fail("G4 shadow authority changed");
  }

  const claims = plainObject(value.claim_policy, "G4 shadow claim policy");
  if (claims.operational_claim_permitted !== true
    || claims.live_profitability_claim_before_252_returns !== false
    || claims.historical_result_relabeling_permitted !== false
    || claims.competitor_rank_claim_permitted !== false) {
    fail("G4 shadow claim policy changed");
  }
  return value;
}

async function readRegularFileWithoutSymlink(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.startsWith("../") || relativePath.includes("/../")) {
    fail(`unsafe repository-relative path: ${relativePath}`);
  }
  const rootStatus = await lstat(projectRoot);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) fail("repository root must be a real directory");
  const root = await realpath(projectRoot);
  const absolute = path.join(root, relativePath);
  let cursor = root;
  for (const [index, part] of relativePath.split("/").entries()) {
    cursor = path.join(cursor, part);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) fail(`${relativePath} traverses a symbolic link`);
    if (index < relativePath.split("/").length - 1 && !metadata.isDirectory()) fail(`${relativePath} parent is not a directory`);
    if (index === relativePath.split("/").length - 1 && !metadata.isFile()) fail(`${relativePath} is not a regular file`);
  }
  let handle;
  try {
    handle = await open(absolute, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const bytes = await handle.readFile();
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== G4_SHADOW_LIVE_PROTOCOL_RAW_BYTES_SHA256) {
      fail("G4 shadow live protocol raw bytes changed");
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function loadG4ShadowLiveProtocol({ projectRoot = REPOSITORY_ROOT } = {}) {
  const bytes = await readRegularFileWithoutSymlink(projectRoot, G4_SHADOW_LIVE_PROTOCOL_PATH);
  let protocol;
  try {
    protocol = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`G4 shadow live protocol is invalid JSON: ${error.message}`);
  }
  if (bytes.toString("utf8") !== canonicalG4ShadowLiveProtocolJson(protocol)) {
    fail("G4 shadow live protocol is not canonical pretty JSON with one trailing newline");
  }
  return validateG4ShadowLiveProtocol(protocol);
}
