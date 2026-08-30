import { createHash } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, realpath, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { stableStringify } from "../lib/canonical.mjs";
import { buildCurrentEconomicDecision } from "../lib/economic_research.mjs";
import { CORE_SYMBOLS } from "./champion_strategies.mjs";
import { createGeneration4Strategies } from "./champion_strategies_generation4.mjs";

export const FORWARD_TRIAL1_ID = "finly_forward_trial_1";
export const FORWARD_TRIAL1_PROTOCOL_SCHEMA = "finly_forward_trial1_protocol.v2";
export const FORWARD_TRIAL1_GENESIS_SCHEMA = "finly_forward_trial1_genesis.v2";
export const FORWARD_TRIAL1_COMMITMENT_SCHEMA = "finly_forward_trial1_signal_commitment.v1";
export const FORWARD_TRIAL1_SETTLEMENT_SCHEMA = "finly_forward_trial1_outcome_settlement.v1";
export const FORWARD_TRIAL1_SIGNAL_INPUT_SCHEMA = "finly_forward_trial1_signal_input.v1";
export const FORWARD_TRIAL1_SETTLEMENT_INPUT_SCHEMA = "finly_forward_trial1_settlement_input.v1";
export const FORWARD_TRIAL1_STRATEGY_IDS = Object.freeze([
  "finly_production_v1", "g4_shadow_qqq_core_sector_12_6", "benchmark_spy_buy_hold",
  "benchmark_qqq_buy_hold", "benchmark_spy_qqq_50_50", "benchmark_bil_cash",
  "benchmark_spy_vol_target_10",
]);
export const FORWARD_TRIAL1_SYMBOLS = Object.freeze([...CORE_SYMBOLS]);

const defaultProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FROZEN_AT = "2026-08-29T15:42:30.000Z";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const FILE = /^(\d{8})_([0-9a-f]{64})\.json$/;
const SECRET_KEY = /(^|_)(api_?key|secret|token|password|authorization|credential|raw_?header)(_|$)/i;
const SECRET_VALUE = /(Bearer\s+[A-Za-z0-9._~-]+|APCA-[A-Za-z0-9_-]{8,}|(?:sk|pk)[-_][A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/i;
const EXPECTED_FROZEN_ARTIFACTS = Object.freeze([
  ["lib/economic_research.mjs", "production_v1_and_volatility_baseline_formula"],
  ["research/champion_strategies_generation4.mjs", "unchanged_g4_shadow_formula"],
  ["research/champion_engine.mjs", "g4_signal_execution_and_weight_semantics"],
  ["lib/canonical.mjs", "canonical_serialization_and_hash_semantics"],
  ["research/champion_strategies.mjs", "core_and_sector_symbol_registries"],
  ["research/forward_trial1.mjs", "forward_trial_validation_and_accounting_engine"],
  ["research/run_forward_trial1.mjs", "fail_closed_verify_or_explicit_append_cli"],
  ["public/data/current_economic_decision.json", "last_completed_production_v1_decision_used_at_freeze"],
  ["research/output/quant_champion_generation4.json", "g4_selection_and_panel_identity"],
  ["research/champion_search_generation4_result_receipt.json", "g4_result_receipt"],
  ["research/alpaca_adjustment_all_panel_generation6_result_receipt.json", "authenticated_seed_acquisition_receipt"],
  ["research/forward_trial1_bridge_2026-08-28.json", "authenticated_adjustment_all_pretrial_bridge_point"],
]);
const EXPECTED_TIMING = Object.freeze({
  lifecycle: "Commit completed close t after its provider response is available; anchor commitment before queued close t+1; reconcile return from committed close t+1 to committed close t+2.",
  first_signal_session: "2026-08-31",
  first_return_start_session: "2026-09-01",
  commitment_deadline: "strictly before the queued execution close",
  commitment_cadence: "Each commitment signal session equals the prior commitment's queued execution session.",
  settlement_sources: "Settlement N is derived only from immutable commitments N, N+1, and N+2.",
  no_unsettled_outcome_dependency: true,
});
const EXPECTED_FORMULA_DEFINITIONS = Object.freeze({
  finly_production_v1: "Frozen tsmom_ensemble_vol: equal-weight positive fraction of 21/63/252-session SPY-minus-BIL log trends multiplied by the unlevered 10% target over lagged 20-session SPY realized volatility; five-session cadence; residual in BIL.",
  g4_shadow_qqq_core_sector_12_6: "Unchanged G4 qqq_core_sector_12_6: fresh-start allocation at the first eligible signal, then 50% QQQ plus 50% equally divided among the top three sector ETFs ranked by 252-to-126-session (12-minus-6) log return; 21-session cadence; long-only gross one.",
  benchmark_spy_buy_hold: "Static 100% SPY benchmark.",
  benchmark_qqq_buy_hold: "Static 100% QQQ benchmark.",
  benchmark_spy_qqq_50_50: "Target 50% SPY and 50% QQQ at the first settlement and every 21 accepted sessions thereafter; holdings drift between scheduled rebalances.",
  benchmark_bil_cash: "Static 100% BIL cash-proxy benchmark.",
  benchmark_spy_vol_target_10: "Existing long-only SPY/BIL volatility baseline: min(1, 10% / lagged 20-session annualized SPY realized volatility), five-session cadence; residual in BIL.",
});
const EXPECTED_FORMULA_SOURCES = Object.freeze({
  finly_production_v1: ["lib/economic_research.mjs", "lib/canonical.mjs"],
  g4_shadow_qqq_core_sector_12_6: ["research/champion_strategies_generation4.mjs", "research/champion_engine.mjs", "research/champion_strategies.mjs"],
  benchmark_spy_buy_hold: ["research/forward_trial1.mjs"],
  benchmark_qqq_buy_hold: ["research/forward_trial1.mjs"],
  benchmark_spy_qqq_50_50: ["research/forward_trial1.mjs"],
  benchmark_bil_cash: ["research/forward_trial1.mjs"],
  benchmark_spy_vol_target_10: ["lib/economic_research.mjs", "lib/canonical.mjs"],
});
const EXPECTED_INFERENCE = Object.freeze({
  engineering_only_through_settlement: 60,
  minimum_settlements: 252,
  primary_book: "finly_production_v1",
  primary_comparator: "benchmark_spy_buy_hold",
  primary_endpoint: "mean daily log-return difference after the common 5 bp turnover cost",
  null_hypothesis: "primary mean daily log-return difference is less than or equal to zero",
  test: "one-sided null-centered stationary block bootstrap",
  sample_definition: "The first 252 accepted daily settlements only; no rolling, best-window, or repeat confirmatory test.",
  bootstrap_seed_uint32: 20260829,
  bootstrap_resamples: 4999,
  expected_block_sessions: 20,
  p_value_construction: "(1 + count of null-centered bootstrap means greater than or equal to the observed mean) / 5000",
  alpha: 0.05,
  secondary_comparators: ["g4_shadow_qqq_core_sector_12_6", "benchmark_qqq_buy_hold", "benchmark_spy_qqq_50_50", "benchmark_bil_cash", "benchmark_spy_vol_target_10"],
  multiplicity: "Primary claim is SPY-only. All other comparator and metric results are descriptive; no confirmatory claim may be selected from them.",
  external_anchor_requirement: "ALL_FIRST_254_SIGNAL_COMMITMENTS_INDEPENDENTLY_VERIFIED_BEFORE_THEIR_EXECUTION_CLOSES",
});
const EXPECTED_EXTERNAL_ANCHORING = Object.freeze({
  required: true,
  manifest_directory: "research/forward_trial1_anchor_manifests",
  accepted_future_mechanisms: ["public GitHub Actions/commit publication", "RFC 3161 or OpenTimestamps receipt", "trusted append service signature"],
  local_verifier_status: "NOT_CONFIGURED_ZERO_ROW_FREEZE",
  settlement_gate: "CLOSED_UNTIL_INDEPENDENT_ANCHOR_AND_OUTCOME_PRICE_VERIFIERS_ARE_CONFIGURED",
  inference_gate: "CLOSED_UNTIL_ALL_REQUIRED_PRE_EXECUTION_ANCHORS_AND_OUTCOME_PRICES_VERIFY",
  future_free_path: "A later version may verify a free public GitHub publication or cryptographic timestamp receipt without storing credentials.",
  forbidden_claim: "A local timestamp, hash chain, source label, or unverified manifest does not prove prospectivity or provider origin.",
});
const EXPECTED_CLAIM_BOUNDARY = "The zero-row two-phase artifact freezes rules and exposes synthetic TEST_ONLY mechanics. It proves neither prospectivity nor live signal capture, Alpaca origin, execution, performance, future profit, or guaranteed alpha. Production commitments, settlements, and inference remain closed until the exact private seed, a vintage-stable corporate-action method, independent pre-execution anchors, and independently reconciled outcome-price lineage are all available.";

function fail(message) { throw new Error(message); }
export function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value))).digest("hex")}`;
}
export function hashForwardTrialEntryBody(value) { return sha256Bytes(stableStringify(value)); }
function same(left, right) { return stableStringify(left) === stableStringify(right); }
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!same(actual, expected)) fail(`${label} must contain exactly: ${expected.join(", ")}`);
  return value;
}
function instant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(`${label} must be a canonical UTC timestamp`);
  return value;
}
function number(value, label, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} is outside its finite range`);
  }
  return value;
}
function close(left, right, tolerance = 1e-8) { return Math.abs(left - right) <= tolerance; }
function digest(value, label) { if (!SHA256.test(value)) fail(`${label} must be a prefixed SHA-256`); return value; }
function noSecrets(value, path = "artifact") {
  if (Array.isArray(value)) return value.forEach((item, index) => noSecrets(item, `${path}[${index}]`));
  if (typeof value === "string") { if (SECRET_VALUE.test(value)) fail(`${path} contains a credential-like value`); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) fail(`${path}.${key} is a credential-like field`);
    noSecrets(item, `${path}.${key}`);
  }
}

function iso(date) { return date.toISOString().slice(0, 10); }
function plus(date, days) { const value = new Date(`${date}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return iso(value); }
function nth(year, month, weekday, occurrence) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  return iso(new Date(Date.UTC(year, month - 1, 1 + ((weekday - first.getUTCDay() + 7) % 7) + 7 * (occurrence - 1), 12)));
}
function last(year, month, weekday) {
  const value = new Date(Date.UTC(year, month, 0, 12));
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() - weekday + 7) % 7));
  return iso(value);
}
function observed(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  if (value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() - 1);
  if (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1);
  return iso(value);
}
function easter(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100; const d = Math.floor(b / 4);
  const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(Date.UTC(year, month - 1, day, 12)));
}
function holidays(year) {
  const values = new Set([
    observed(year, 1, 1), nth(year, 1, 1, 3), nth(year, 2, 1, 3), plus(easter(year), -2),
    last(year, 5, 1), observed(year, 7, 4), nth(year, 9, 1, 1), nth(year, 11, 4, 4),
    observed(year, 12, 25), observed(year + 1, 1, 1),
  ]);
  if (year >= 2022) values.add(observed(year, 6, 19));
  return values;
}
function session(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T12:00:00.000Z`); const day = value.getUTCDay();
  return iso(value) === date && day !== 0 && day !== 6 && !holidays(value.getUTCFullYear()).has(date);
}
function nextSession(date) {
  let value = date;
  for (let attempt = 0; attempt < 10; attempt += 1) { value = plus(value, 1); if (session(value)) return value; }
  fail(`no next supported market session after ${date}`);
}
function previousSession(date) {
  let value = date;
  for (let attempt = 0; attempt < 10; attempt += 1) { value = plus(value, -1); if (session(value)) return value; }
  fail(`no previous supported market session before ${date}`);
}
function early(date) {
  const year = Number(date.slice(0, 4)); const thanksgiving = nth(year, 11, 4, 4);
  return session(date) && (date === previousSession(observed(year, 7, 4)) || date === plus(thanksgiving, 1) || date === `${year}-12-24`);
}
function closeAt(date) {
  if (!session(date)) fail(`${date} is not a supported U.S. equity market session`);
  const year = Number(date.slice(0, 4)); const dst = date >= nth(year, 3, 0, 2) && date < nth(year, 11, 0, 1);
  const hour = (dst ? 20 : 21) - (early(date) ? 3 : 0);
  return `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}
export function forwardTrialExpectedMarketCloseAt(date) { return closeAt(date); }

function weights(raw, label = "weights") {
  exact(raw, FORWARD_TRIAL1_SYMBOLS, label); let total = 0;
  for (const symbol of FORWARD_TRIAL1_SYMBOLS) total += number(raw[symbol], `${label}.${symbol}`, 0, 1);
  if (!close(total, 1)) fail(`${label} must sum to one`);
  return raw;
}
function full(raw = {}) {
  const value = Object.fromEntries(FORWARD_TRIAL1_SYMBOLS.map((symbol) => [symbol, Number(raw[symbol] ?? 0)]));
  return weights(value);
}
function weightsClose(left, right, tolerance = 1e-10) {
  return FORWARD_TRIAL1_SYMBOLS.every((symbol) => close(left?.[symbol], right?.[symbol], tolerance));
}
function pricePoint(value, label) {
  exact(value, ["date", "closes"], label); if (!session(value.date)) fail(`${label}.date is not a market session`);
  exact(value.closes, FORWARD_TRIAL1_SYMBOLS, `${label}.closes`);
  for (const symbol of FORWARD_TRIAL1_SYMBOLS) number(value.closes[symbol], `${label}.${symbol}`, Number.MIN_VALUE, 1e9);
  return value;
}
function symbolHashes(points) {
  return Object.fromEntries(FORWARD_TRIAL1_SYMBOLS.map((symbol) => [symbol, hashForwardTrialEntryBody(points.map((point) => [point.date, point.closes[symbol]]))]));
}
function hashMap(value, label) { exact(value, FORWARD_TRIAL1_SYMBOLS, label); FORWARD_TRIAL1_SYMBOLS.forEach((symbol) => digest(value[symbol], `${label}.${symbol}`)); }

function commitmentState(value, label) {
  exact(value, ["last_rebalance_signal_date", "sessions_since_last_rebalance", "last_committed_target_weights"], label);
  if (value.last_rebalance_signal_date !== null && !session(value.last_rebalance_signal_date)) fail(`${label} last date is invalid`);
  if (value.sessions_since_last_rebalance !== null
    && (!Number.isSafeInteger(value.sessions_since_last_rebalance) || value.sessions_since_last_rebalance < 0)) fail(`${label} counter is invalid`);
  weights(value.last_committed_target_weights, `${label} target`);
}

export function inferencePhaseForSettledSessions(count) {
  if (!Number.isSafeInteger(count) || count < 1) fail("settled count must be positive");
  if (count <= 60) return "ENGINEERING_RECONCILIATION_ONLY";
  if (count < 252) return "FORWARD_OBSERVATION_NO_PERFORMANCE_INFERENCE";
  return "PRIMARY_CALCULATION_REQUIRES_VERIFIED_EXTERNAL_ANCHORS";
}

export function validateForwardTrialProtocol(protocol) {
  exact(protocol, ["schema_version", "trial_id", "status", "freeze", "authorization_boundary", "timing", "data_boundary", "books", "formula_bindings", "accounting", "inference", "external_anchoring", "genesis", "claim_boundary"], "protocol");
  if (protocol.schema_version !== FORWARD_TRIAL1_PROTOCOL_SCHEMA || protocol.trial_id !== FORWARD_TRIAL1_ID || protocol.status !== "FROZEN_TWO_PHASE_ZERO_ROW") fail("protocol envelope mismatch");
  exact(protocol.freeze, ["frozen_at", "latest_market_observation_used", "production_v1_observation_end", "g4_shadow_observation_end", "frozen_artifacts"], "freeze");
  instant(protocol.freeze.frozen_at, "freeze time");
  if (protocol.freeze.frozen_at !== FROZEN_AT
    || protocol.freeze.latest_market_observation_used !== "2026-08-28"
    || protocol.freeze.production_v1_observation_end !== "2026-08-28"
    || protocol.freeze.g4_shadow_observation_end !== "2026-08-27") fail("freeze boundary differs from the executable pin");
  if (!Array.isArray(protocol.freeze.frozen_artifacts)
    || !same(protocol.freeze.frozen_artifacts.map(({ path, role }) => [path, role]), EXPECTED_FROZEN_ARTIFACTS)) fail("frozen dependency closure is incomplete or reordered");
  const frozen = new Map();
  for (const item of protocol.freeze.frozen_artifacts) {
    exact(item, ["path", "sha256", "role"], "frozen artifact"); digest(item.sha256, "frozen artifact hash");
    if (typeof item.path !== "string" || item.path.startsWith("/") || item.path.includes("..") || frozen.has(item.path)) fail("frozen artifact path is invalid or duplicated");
    frozen.set(item.path, item.sha256);
  }
  exact(protocol.authorization_boundary, ["default_mode", "network_fetch_permitted", "broker_reads_permitted", "broker_mutation_permitted", "signal_commitment_write_enabled", "signal_commitment_write_requires_ack", "settlement_write_enabled", "credentials_may_be_persisted"], "authorization boundary");
  if (!same(protocol.authorization_boundary, { default_mode: "VERIFY_ONLY", network_fetch_permitted: false, broker_reads_permitted: false, broker_mutation_permitted: false, signal_commitment_write_enabled: false, signal_commitment_write_requires_ack: true, settlement_write_enabled: false, credentials_may_be_persisted: false })) fail("authorization boundary is not fail closed");
  exact(protocol.timing, ["lifecycle", "first_signal_session", "first_return_start_session", "commitment_deadline", "commitment_cadence", "settlement_sources", "no_unsettled_outcome_dependency"], "timing");
  if (!same(protocol.timing, EXPECTED_TIMING)
    || protocol.timing.first_signal_session !== nextSession(protocol.freeze.latest_market_observation_used)
    || protocol.timing.first_return_start_session !== nextSession(protocol.timing.first_signal_session)) fail("two-phase timing mismatch");
  exact(protocol.data_boundary, ["provider", "feed", "adjustment", "currency", "market_calendar", "market_timezone", "regular_close_local_time", "availability_delay_minutes", "symbols", "seed_sessions", "seed_start", "seed_end", "seed_normalized_sha256", "private_seed_artifact_path", "private_seed_artifact_sha256", "private_seed_redistributed", "private_seed_required_for_production_commitment", "bridge_session", "bridge_artifact_path", "bridge_normalized_sha256", "panel_construction", "provider_signatures_available", "production_market_data_method", "corporate_action_reconciliation_ready", "provider_outcome_price_reconciliation_ready", "production_commitment_gate"], "data boundary");
  const expectedDataBoundary = {
    provider: "Alpaca Market Data API", feed: "iex", adjustment: "all", currency: "USD",
    market_calendar: "XNYS_US_EQUITIES_RULES_V1", market_timezone: "America/New_York", regular_close_local_time: "16:00", availability_delay_minutes: 15,
    symbols: FORWARD_TRIAL1_SYMBOLS, seed_sessions: 253, seed_start: "2025-08-26", seed_end: "2026-08-27",
    seed_normalized_sha256: protocol.data_boundary.seed_normalized_sha256,
    private_seed_artifact_path: "data/private/champion_search/alpaca_adjustment_all_panel_generation6_aa2075c1989da7194f1de0f455fab83a4035ee878b5b410088d11aa39c0baaa2.json",
    private_seed_artifact_sha256: "sha256:aa2075c1989da7194f1de0f455fab83a4035ee878b5b410088d11aa39c0baaa2",
    private_seed_redistributed: false, private_seed_required_for_production_commitment: true,
    bridge_session: "2026-08-28", bridge_artifact_path: "research/forward_trial1_bridge_2026-08-28.json",
    bridge_normalized_sha256: "sha256:6ee58a999f5b368ba819545cb116c0e875d0c1acd496f7ca034065d838283b0d",
    panel_construction: "TEST_ONLY mechanics bind a synthetic 253-session seed, the frozen 2026-08-28 bridge, and consecutive closes. Production construction is disabled until a vintage-stable corporate-action method and independently reconciled outcome-price lineage are implemented.",
    provider_signatures_available: false, production_market_data_method: "NOT_CONFIGURED_ZERO_ROW_FREEZE",
    corporate_action_reconciliation_ready: false, provider_outcome_price_reconciliation_ready: false,
    production_commitment_gate: "CLOSED_UNTIL_PRIVATE_SEED_CORPORATE_ACTION_AND_OUTCOME_PRICE_GATES_PASS",
  };
  if (!same(protocol.data_boundary, expectedDataBoundary)) fail("data boundary mismatch");
  digest(protocol.data_boundary.seed_normalized_sha256, "seed hash"); digest(protocol.data_boundary.bridge_normalized_sha256, "bridge hash");
  if (!same(protocol.books, FORWARD_TRIAL1_STRATEGY_IDS)) fail("book registry mismatch");
  exact(protocol.formula_bindings, FORWARD_TRIAL1_STRATEGY_IDS, "formula bindings");
  for (const id of FORWARD_TRIAL1_STRATEGY_IDS) {
    const binding = protocol.formula_bindings[id]; exact(binding, ["formula_id", "definition", "source_files", "binding_sha256"], `formula ${id}`);
    if (binding.formula_id !== id || binding.definition !== EXPECTED_FORMULA_DEFINITIONS[id]
      || !same(binding.source_files.map(({ path }) => path), EXPECTED_FORMULA_SOURCES[id])) fail(`formula ${id} metadata mismatch`);
    for (const source of binding.source_files) { exact(source, ["path", "sha256"], `formula ${id} source`); if (frozen.get(source.path) !== source.sha256) fail(`formula ${id} dependency is not frozen`); }
    if (binding.binding_sha256 !== hashForwardTrialEntryBody({ formula_id: id, definition: binding.definition, source_files: binding.source_files })) fail(`formula ${id} binding hash mismatch`);
  }
  exact(protocol.accounting, ["initial_equity_per_book", "initial_asset", "cost_bps_per_absolute_traded_notional", "reported_paper_fees_treatment", "fractional_units"], "accounting");
  if (protocol.accounting.initial_equity_per_book !== 100000 || protocol.accounting.initial_asset !== "BIL" || protocol.accounting.cost_bps_per_absolute_traded_notional !== 5 || protocol.accounting.reported_paper_fees_treatment !== "RECORDED_SEPARATELY_NOT_DOUBLE_COUNTED" || protocol.accounting.fractional_units !== true) fail("accounting mismatch");
  exact(protocol.inference, ["engineering_only_through_settlement", "minimum_settlements", "primary_book", "primary_comparator", "primary_endpoint", "null_hypothesis", "test", "sample_definition", "bootstrap_seed_uint32", "bootstrap_resamples", "expected_block_sessions", "p_value_construction", "alpha", "secondary_comparators", "multiplicity", "external_anchor_requirement"], "inference");
  if (!same(protocol.inference, EXPECTED_INFERENCE)) fail("inference plan mismatch");
  exact(protocol.external_anchoring, ["required", "manifest_directory", "accepted_future_mechanisms", "local_verifier_status", "settlement_gate", "inference_gate", "future_free_path", "forbidden_claim"], "external anchoring");
  if (!same(protocol.external_anchoring, EXPECTED_EXTERNAL_ANCHORING)) fail("anchor gates are not closed");
  exact(protocol.genesis, ["path", "commitment_directory", "settlement_directory", "initial_account_state", "initial_commitment_state"], "genesis config");
  if (protocol.genesis.path !== "research/forward_trial1_genesis.json" || protocol.genesis.commitment_directory !== "research/forward_trial1_signal_commitments" || protocol.genesis.settlement_directory !== "research/forward_trial1_ledger") fail("genesis paths mismatch");
  exact(protocol.genesis.initial_account_state, FORWARD_TRIAL1_STRATEGY_IDS, "initial accounts"); exact(protocol.genesis.initial_commitment_state, FORWARD_TRIAL1_STRATEGY_IDS, "initial commitment states");
  for (const id of FORWARD_TRIAL1_STRATEGY_IDS) {
    const account = protocol.genesis.initial_account_state[id]; exact(account, ["equity", "weights"], `account ${id}`); weights(account.weights, `account ${id}`); if (account.equity !== 100000 || account.weights.BIL !== 1) fail(`account ${id} is not initial BIL`);
    commitmentState(protocol.genesis.initial_commitment_state[id], `commitment state ${id}`);
    if (protocol.genesis.initial_commitment_state[id].last_rebalance_signal_date !== null
      || protocol.genesis.initial_commitment_state[id].sessions_since_last_rebalance !== null
      || protocol.genesis.initial_commitment_state[id].last_committed_target_weights.BIL !== 1) fail(`commitment state ${id} is not a fresh-start BIL state`);
  }
  if (protocol.claim_boundary !== EXPECTED_CLAIM_BOUNDARY) fail("claim boundary is incomplete");
  return protocol;
}

function safePath(root, relative, label) {
  if (typeof relative !== "string" || relative.startsWith("/") || relative.includes("..")) fail(`${label} path is invalid`);
  const value = resolve(root, relative); if (!value.startsWith(`${resolve(root)}${sep}`)) fail(`${label} escapes project root`); return value;
}
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
async function localDirectory(root, relative, label, allowMissing = false) {
  const rootReal = await realpath(resolve(root)); let current = resolve(root); const pieces = relative.split("/").filter(Boolean);
  for (let index = 0; index < pieces.length; index += 1) {
    current = resolve(current, pieces[index]); let info;
    try { info = await lstat(current); } catch (error) { if (allowMissing && index === pieces.length - 1 && error?.code === "ENOENT") return; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) fail(`${label} must be a local non-symlink directory`);
  }
  const actual = await realpath(current); if (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) fail(`${label} resolves outside project root`);
}
async function topology(root) {
  await localDirectory(root, "research", "research directory");
  await localDirectory(root, "research/forward_trial1_signal_commitments", "commitment directory", true);
  await localDirectory(root, "research/forward_trial1_ledger", "settlement directory", true);
  await localDirectory(root, "research/forward_trial1_anchor_manifests", "anchor manifest directory", true);
}
async function environment(root, override) {
  await topology(root); const [actual, expected] = await Promise.all([realpath(resolve(root)), realpath(defaultProjectRoot)]);
  const [a, b] = await Promise.all([stat(actual), stat(expected)]); const production = actual === expected || (a.dev === b.dev && a.ino === b.ino);
  if (production && override !== undefined) fail("clock override is forbidden for the production forward trial");
  if (override !== undefined && typeof override !== "function") fail("test clock must be a function");
  return { classification: production ? "PRODUCTION_ZERO_ROW" : "TEST_ONLY", now: override ?? (() => new Date()) };
}

export async function verifyFrozenForwardTrialArtifacts(protocol, root = defaultProjectRoot) {
  for (const item of protocol.freeze.frozen_artifacts) {
    const path = safePath(root, item.path, `frozen ${item.path}`); const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || sha256Bytes(await readFile(path)) !== item.sha256) fail(`frozen artifact mismatch: ${item.path}`);
  }
  const bridge = JSON.parse(await readFile(resolve(root, protocol.data_boundary.bridge_artifact_path), "utf8")); noSecrets(bridge, "bridge");
  pricePoint(bridge.normalized_point, "bridge point");
  if (bridge.normalized_point_sha256 !== hashForwardTrialEntryBody(bridge.normalized_point) || bridge.normalized_point_sha256 !== protocol.data_boundary.bridge_normalized_sha256 || bridge.normalized_point.date !== protocol.data_boundary.bridge_session || bridge.request_completed_at > protocol.freeze.frozen_at) fail("bridge is not frozen before trial");
  const seedPath = safePath(root, protocol.data_boundary.private_seed_artifact_path, "private seed"); let seedInfo;
  try { seedInfo = await lstat(seedPath); } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ production_seed_available: false });
    throw error;
  }
  if (!seedInfo.isFile() || seedInfo.isSymbolicLink()) fail("private seed must be a local regular file");
  const seedRaw = await readFile(seedPath);
  if (sha256Bytes(seedRaw) !== protocol.data_boundary.private_seed_artifact_sha256) fail("private seed artifact hash mismatch");
  const source = JSON.parse(seedRaw); const rawPoints = source?.strategy_intersection?.points;
  if (!Array.isArray(rawPoints) || rawPoints.length < protocol.data_boundary.seed_sessions) fail("private seed panel is incomplete");
  const seed = rawPoints.slice(-protocol.data_boundary.seed_sessions).map((point) => ({
    date: point.date,
    closes: Object.fromEntries(FORWARD_TRIAL1_SYMBOLS.map((symbol) => [symbol, point[symbol]])),
  }));
  seed.forEach((point, index) => pricePoint(point, `private seed ${index}`));
  for (let index = 1; index < seed.length; index += 1) if (seed[index].date !== nextSession(seed[index - 1].date)) fail("private seed omits a market session");
  if (seed[0].date !== protocol.data_boundary.seed_start || seed.at(-1).date !== protocol.data_boundary.seed_end
    || hashForwardTrialEntryBody(seed) !== protocol.data_boundary.seed_normalized_sha256) fail("private seed normalized panel mismatch");
  return Object.freeze({ production_seed_available: true });
}

function genesisBody(value) { return { schema_version: value.schema_version, trial_id: value.trial_id, entry_kind: value.entry_kind, commitment_sequence: value.commitment_sequence, settlement_sequence: value.settlement_sequence, payload: value.payload }; }
export function validateForwardTrialGenesis(value, protocol, protocolHash) {
  exact(value, ["schema_version", "trial_id", "entry_kind", "commitment_sequence", "settlement_sequence", "payload", "genesis_sha256"], "genesis");
  if (value.schema_version !== FORWARD_TRIAL1_GENESIS_SCHEMA || value.trial_id !== FORWARD_TRIAL1_ID || value.entry_kind !== "GENESIS" || value.commitment_sequence !== 0 || value.settlement_sequence !== 0) fail("genesis envelope mismatch");
  exact(value.payload, ["created_at", "protocol_path", "protocol_file_sha256", "freeze_boundary_sha256", "formula_binding_sha256", "initial_account_state_sha256", "initial_commitment_state_sha256", "signal_seed_sha256", "eligibility", "anchor_gate"], "genesis payload"); instant(value.payload.created_at, "genesis created_at");
  if (value.payload.created_at < protocol.freeze.frozen_at
    || value.payload.protocol_path !== "research/forward_trial1_protocol.json"
    || value.payload.protocol_file_sha256 !== protocolHash
    || value.payload.freeze_boundary_sha256 !== hashForwardTrialEntryBody(protocol.freeze)
    || value.payload.initial_account_state_sha256 !== hashForwardTrialEntryBody(protocol.genesis.initial_account_state)
    || value.payload.initial_commitment_state_sha256 !== hashForwardTrialEntryBody(protocol.genesis.initial_commitment_state)
    || value.payload.signal_seed_sha256 !== hashForwardTrialEntryBody(protocol.data_boundary)) fail("genesis protocol binding mismatch");
  exact(value.payload.formula_binding_sha256, FORWARD_TRIAL1_STRATEGY_IDS, "genesis formula bindings");
  for (const id of FORWARD_TRIAL1_STRATEGY_IDS) if (value.payload.formula_binding_sha256[id] !== protocol.formula_bindings[id].binding_sha256) fail(`genesis formula mismatch ${id}`);
  exact(value.payload.eligibility, ["first_signal_session", "first_return_start_session", "historical_commitments", "historical_settlements"], "genesis eligibility");
  if (value.payload.eligibility.first_signal_session !== protocol.timing.first_signal_session || value.payload.eligibility.first_return_start_session !== protocol.timing.first_return_start_session || value.payload.eligibility.historical_commitments !== 0 || value.payload.eligibility.historical_settlements !== 0 || value.payload.anchor_gate !== "CLOSED_PENDING_INDEPENDENT_PRE_EXECUTION_ANCHOR_VERIFIER") fail("genesis eligibility mismatch");
  if (value.genesis_sha256 !== hashForwardTrialEntryBody(genesisBody(value))) fail("genesis hash mismatch"); return value;
}

function validatePanel(points, { protocol, previousCommitment, signalDate }) {
  if (!Array.isArray(points) || points.length < protocol.data_boundary.seed_sessions + 2) fail("signal panel is too short");
  points.forEach((point, index) => pricePoint(point, `signal panel ${index}`));
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].date !== nextSession(points[index - 1].date)) fail("signal panel omits or duplicates a market session");
  }
  const seed = points.slice(0, protocol.data_boundary.seed_sessions); const bridge = points[protocol.data_boundary.seed_sessions];
  if (seed[0].date !== protocol.data_boundary.seed_start || seed.at(-1).date !== protocol.data_boundary.seed_end || hashForwardTrialEntryBody(seed) !== protocol.data_boundary.seed_normalized_sha256) fail("signal panel changes the frozen seed");
  if (bridge.date !== protocol.data_boundary.bridge_session || hashForwardTrialEntryBody(bridge) !== protocol.data_boundary.bridge_normalized_sha256) fail("signal panel changes the frozen bridge");
  if (points.at(-1).date !== signalDate) fail("signal panel does not end on signal date");
  if (previousCommitment === null) {
    if (points.length !== protocol.data_boundary.seed_sessions + 2 || signalDate !== protocol.timing.first_signal_session) fail("first forward signal is not pinned");
  } else if (points.length !== previousCommitment.payload.data.signal_panel.length + 1 || !same(points.slice(0, -1), previousCommitment.payload.data.signal_panel) || signalDate !== previousCommitment.payload.timeline.execution_session_date) {
    fail("signal commitment does not append exactly the next observed close");
  }
  return points;
}

function stateBefore(protocol, previous, id) {
  return previous === null ? protocol.genesis.initial_commitment_state[id] : previous.payload.strategy_commitments[id].state_after_commitment;
}
function advancedState(prior, rebalanced, signalDate, target) {
  return {
    last_rebalance_signal_date: rebalanced ? signalDate : prior.last_rebalance_signal_date,
    sessions_since_last_rebalance: rebalanced ? 0 : (prior.sessions_since_last_rebalance === null ? null : prior.sessions_since_last_rebalance + 1),
    last_committed_target_weights: rebalanced ? full(target) : full(prior.last_committed_target_weights),
  };
}
function action(protocol, id, kind, target, reasons, state) {
  return { formula_binding_sha256: protocol.formula_bindings[id].binding_sha256, action: kind, committed_target_weights: target === null ? null : full(target), reason_codes: reasons, state_after_commitment: state };
}

export function deriveForwardTrialCommitmentActions({ protocol, previousCommitment = null, timeline, signalPanel }) {
  const signalDate = timeline.signal_session_date; const points = signalPanel.map((point) => ({ date: point.date, ...point.closes })); const signalIndex = points.length - 1;
  const productionId = "finly_production_v1"; const productionPrior = stateBefore(protocol, previousCommitment, productionId);
  const decision = buildCurrentEconomicDecision({
    spyBars: signalPanel.map((point) => ({ t: `${point.date}T04:00:00.000Z`, c: point.closes.SPY })),
    cashBars: signalPanel.map((point) => ({ t: `${point.date}T04:00:00.000Z`, c: point.closes.BIL })),
    decisionTimestamp: timeline.signal_timestamp,
    sourceAvailableAt: timeline.signal_source_available_at,
    completedSessionBoundary: { sessionDate: signalDate, marketCloseAt: timeline.signal_market_close_at, eligibleAt: timeline.signal_bar_eligible_at, availabilityDelayMinutes: timeline.availability_delay_minutes },
    currentAllocation: { spyWeight: productionPrior.last_committed_target_weights.SPY, bilWeight: productionPrior.last_committed_target_weights.BIL },
    lastRebalanceDate: productionPrior.last_rebalance_signal_date,
  });
  const productionDue = decision.decision === "PROPOSE_REBALANCE";
  const productionTarget = productionDue ? full({ SPY: decision.proposed_allocation.spy_weight, BIL: decision.proposed_allocation.bil_weight }) : null;
  const g4Id = "g4_shadow_qqq_core_sector_12_6"; const g4Prior = stateBefore(protocol, previousCommitment, g4Id);
  const g4Due = previousCommitment === null || g4Prior.sessions_since_last_rebalance + 1 >= 21;
  const g4Strategy = createGeneration4Strategies().find((item) => item.id === "qqq_core_sector_12_6");
  if (!g4Strategy) fail("frozen G4 strategy is missing");
  const g4Target = g4Due ? full(g4Strategy.decide({ points, symbols: FORWARD_TRIAL1_SYMBOLS, signalIndex, signalDate, priorWeights: g4Prior.last_committed_target_weights, rows: [] })) : null;
  const first = previousCommitment === null;
  const fixed = (id, firstTarget, interval = null) => {
    const prior = stateBefore(protocol, previousCommitment, id); const counter = prior.sessions_since_last_rebalance === null ? null : prior.sessions_since_last_rebalance + 1;
    const due = first || (interval !== null && counter >= interval); const target = due ? full(firstTarget) : null;
    return action(protocol, id, due ? "REBALANCE" : "HOLD", target, due ? [] : [interval === null ? "BUY_HOLD_NO_REBALANCE" : "NO_REBALANCE_DUE"], advancedState(prior, due, signalDate, target));
  };
  const bilId = "benchmark_bil_cash"; const bilPrior = stateBefore(protocol, previousCommitment, bilId);
  const volId = "benchmark_spy_vol_target_10"; const volPrior = stateBefore(protocol, previousCommitment, volId); const volDue = first || volPrior.sessions_since_last_rebalance + 1 >= 5;
  const volTarget = volDue ? full({ SPY: decision.signal.volatility_target_scale, BIL: 1 - decision.signal.volatility_target_scale }) : null;
  return {
    [productionId]: action(protocol, productionId, productionDue ? "REBALANCE" : "HOLD", productionTarget, productionDue ? [] : ["NO_REBALANCE_DUE"], advancedState(productionPrior, productionDue, signalDate, productionTarget)),
    [g4Id]: action(protocol, g4Id, g4Due ? "REBALANCE" : "HOLD", g4Target, g4Due ? [] : ["NO_REBALANCE_DUE"], advancedState(g4Prior, g4Due, signalDate, g4Target)),
    benchmark_spy_buy_hold: fixed("benchmark_spy_buy_hold", { SPY: 1 }),
    benchmark_qqq_buy_hold: fixed("benchmark_qqq_buy_hold", { QQQ: 1 }),
    benchmark_spy_qqq_50_50: fixed("benchmark_spy_qqq_50_50", { SPY: 0.5, QQQ: 0.5 }, 21),
    [bilId]: action(protocol, bilId, "HOLD", null, ["ALREADY_AT_STATIC_TARGET"], advancedState(bilPrior, false, signalDate, null)),
    [volId]: action(protocol, volId, volDue ? "REBALANCE" : "HOLD", volTarget, volDue ? [] : ["NO_REBALANCE_DUE"], advancedState(volPrior, volDue, signalDate, volTarget)),
  };
}

function signalTimeline(value, protocol, previous) {
  exact(value, ["signal_session_date", "signal_market_close_at", "signal_bar_eligible_at", "availability_delay_minutes", "signal_source_available_at", "signal_timestamp", "execution_session_date", "execution_market_close_at"], "signal timeline");
  ["signal_market_close_at", "signal_bar_eligible_at", "signal_source_available_at", "signal_timestamp", "execution_market_close_at"].forEach((key) => instant(value[key], `timeline ${key}`));
  const eligible = new Date(new Date(value.signal_market_close_at).getTime() + 15 * 60_000).toISOString();
  if (value.availability_delay_minutes !== 15 || value.signal_market_close_at !== closeAt(value.signal_session_date) || value.signal_bar_eligible_at !== eligible || value.signal_source_available_at < eligible || value.signal_timestamp < value.signal_source_available_at || value.signal_timestamp.slice(0, 10) !== value.signal_session_date || value.signal_source_available_at.slice(0, 10) !== value.signal_session_date || value.execution_session_date !== nextSession(value.signal_session_date) || value.execution_market_close_at !== closeAt(value.execution_session_date) || value.signal_timestamp >= value.execution_market_close_at) fail("signal timeline is not point-in-time safe");
  if (previous === null ? value.signal_session_date !== protocol.timing.first_signal_session : value.signal_session_date !== previous.payload.timeline.execution_session_date) fail("signal commitments are not consecutive from the pinned first session");
}
function validateAction(value, expected, id) {
  exact(value, ["formula_binding_sha256", "action", "committed_target_weights", "reason_codes", "state_after_commitment"], `action ${id}`);
  if (value.formula_binding_sha256 !== expected.formula_binding_sha256 || value.action !== expected.action || !same(value.reason_codes, expected.reason_codes)) fail(`action ${id} differs from frozen formula`);
  if (expected.committed_target_weights === null ? value.committed_target_weights !== null : !weightsClose(weights(value.committed_target_weights, `target ${id}`), expected.committed_target_weights)) fail(`target ${id} differs from frozen formula`);
  commitmentState(value.state_after_commitment, `state ${id}`); if (!same(value.state_after_commitment, expected.state_after_commitment)) fail(`state ${id} breaks commitment-only chain`);
}

export function buildForwardTrialSignalCommitmentInput({ protocol, previousCommitment = null, capturedAt, timeline, signalPanel, sourceResponseSha256, sourceRequestSha256, now = () => new Date() } = {}) {
  const input = {
    schema_version: FORWARD_TRIAL1_SIGNAL_INPUT_SCHEMA, trial_id: FORWARD_TRIAL1_ID, captured_at: capturedAt, timeline: structuredClone(timeline),
    data: { provider: protocol.data_boundary.provider, feed: protocol.data_boundary.feed, adjustment: protocol.data_boundary.adjustment, currency: protocol.data_boundary.currency, signal_panel_sha256: hashForwardTrialEntryBody(signalPanel), per_symbol_signal_sha256: symbolHashes(signalPanel), signal_panel: structuredClone(signalPanel), source_evidence: { request_parameters_sha256: sourceRequestSha256, response_content_sha256: sourceResponseSha256, retrieved_at: timeline.signal_source_available_at, provider_signature_verified: false, credentials_persisted: false, raw_response_persisted: false } },
    strategy_commitments: structuredClone(deriveForwardTrialCommitmentActions({ protocol, previousCommitment, timeline, signalPanel })),
    authority: { research_only: true, broker_mutation_authorized: false, order_payload: null },
    external_anchor: { required_before_execution: true, deadline: timeline.execution_market_close_at, locally_verified: false, manifest_sha256: null },
  };
  return validateForwardTrialSignalCommitmentInput(input, { protocol, previousCommitment, now });
}

export function validateForwardTrialSignalCommitmentInput(input, { protocol, previousCommitment = null, now = () => new Date() } = {}) {
  validateForwardTrialProtocol(protocol); noSecrets(input, "signal input");
  exact(input, ["schema_version", "trial_id", "captured_at", "timeline", "data", "strategy_commitments", "authority", "external_anchor"], "signal input");
  if (input.schema_version !== FORWARD_TRIAL1_SIGNAL_INPUT_SCHEMA || input.trial_id !== FORWARD_TRIAL1_ID) fail("signal input envelope mismatch");
  const captured = instant(input.captured_at, "signal captured_at"); const current = new Date(now()); if (!Number.isFinite(current.getTime()) || captured > current.toISOString()) fail("signal capture is in future");
  signalTimeline(input.timeline, protocol, previousCommitment); if (captured < input.timeline.signal_timestamp || captured >= input.timeline.execution_market_close_at) fail("signal was not committed after decision and before execution");
  exact(input.data, ["provider", "feed", "adjustment", "currency", "signal_panel_sha256", "per_symbol_signal_sha256", "signal_panel", "source_evidence"], "signal data");
  if (input.data.provider !== protocol.data_boundary.provider || input.data.feed !== protocol.data_boundary.feed || input.data.adjustment !== protocol.data_boundary.adjustment || input.data.currency !== protocol.data_boundary.currency) fail("signal data provenance label mismatch");
  const panel = validatePanel(input.data.signal_panel, { protocol, previousCommitment, signalDate: input.timeline.signal_session_date });
  if (input.data.signal_panel_sha256 !== hashForwardTrialEntryBody(panel)) fail("signal panel hash mismatch"); hashMap(input.data.per_symbol_signal_sha256, "signal symbol hashes"); if (!same(input.data.per_symbol_signal_sha256, symbolHashes(panel))) fail("signal symbol hash mismatch");
  exact(input.data.source_evidence, ["request_parameters_sha256", "response_content_sha256", "retrieved_at", "provider_signature_verified", "credentials_persisted", "raw_response_persisted"], "source evidence"); digest(input.data.source_evidence.request_parameters_sha256, "request hash"); digest(input.data.source_evidence.response_content_sha256, "response hash"); instant(input.data.source_evidence.retrieved_at, "retrieved_at");
  if (input.data.source_evidence.retrieved_at !== input.timeline.signal_source_available_at || input.data.source_evidence.provider_signature_verified !== false || input.data.source_evidence.credentials_persisted !== false || input.data.source_evidence.raw_response_persisted !== false) fail("source evidence overclaims provider authentication or persists forbidden data");
  exact(input.strategy_commitments, FORWARD_TRIAL1_STRATEGY_IDS, "strategy commitments"); const expected = deriveForwardTrialCommitmentActions({ protocol, previousCommitment, timeline: input.timeline, signalPanel: panel }); for (const id of FORWARD_TRIAL1_STRATEGY_IDS) validateAction(input.strategy_commitments[id], expected[id], id);
  exact(input.authority, ["research_only", "broker_mutation_authorized", "order_payload"], "authority"); if (!same(input.authority, { research_only: true, broker_mutation_authorized: false, order_payload: null })) fail("commitment crosses broker boundary");
  exact(input.external_anchor, ["required_before_execution", "deadline", "locally_verified", "manifest_sha256"], "anchor status"); if (input.external_anchor.required_before_execution !== true || input.external_anchor.deadline !== input.timeline.execution_market_close_at || input.external_anchor.locally_verified !== false || input.external_anchor.manifest_sha256 !== null) fail("new commitment must make no anchor claim");
  return input;
}

function commitmentBody(value) { return { schema_version: value.schema_version, trial_id: value.trial_id, sequence: value.sequence, entry_kind: value.entry_kind, previous_commitment_sha256: value.previous_commitment_sha256, payload: value.payload }; }
export function buildForwardTrialSignalCommitment(input, { protocol, genesis, previousCommitment = null, now = () => new Date() } = {}) {
  validateForwardTrialSignalCommitmentInput(input, { protocol, previousCommitment, now }); const body = { schema_version: FORWARD_TRIAL1_COMMITMENT_SCHEMA, trial_id: FORWARD_TRIAL1_ID, sequence: (previousCommitment?.sequence ?? 0) + 1, entry_kind: "SIGNAL_COMMITMENT", previous_commitment_sha256: previousCommitment?.commitment_sha256 ?? genesis.genesis_sha256, payload: input }; return Object.freeze({ ...body, commitment_sha256: hashForwardTrialEntryBody(body) });
}
export function validateForwardTrialSignalCommitment(value, { protocol, genesis, previousCommitment = null, now = () => new Date() } = {}) {
  exact(value, ["schema_version", "trial_id", "sequence", "entry_kind", "previous_commitment_sha256", "payload", "commitment_sha256"], "commitment");
  if (value.schema_version !== FORWARD_TRIAL1_COMMITMENT_SCHEMA || value.trial_id !== FORWARD_TRIAL1_ID || value.entry_kind !== "SIGNAL_COMMITMENT" || value.sequence !== (previousCommitment?.sequence ?? 0) + 1 || value.previous_commitment_sha256 !== (previousCommitment?.commitment_sha256 ?? genesis.genesis_sha256)) fail("commitment chain is broken");
  validateForwardTrialSignalCommitmentInput(value.payload, { protocol, previousCommitment, now }); if (value.commitment_sha256 !== hashForwardTrialEntryBody(commitmentBody(value))) fail("commitment hash mismatch"); return value;
}

function accountBefore(protocol, previous, id) {
  if (previous === null) return protocol.genesis.initial_account_state[id];
  const accounting = previous.payload.strategies[id].accounting;
  return { equity: accounting.closing_equity, weights: accounting.closing_weights };
}
function returns(start, end) { return Object.fromEntries(FORWARD_TRIAL1_SYMBOLS.map((symbol) => [symbol, end.closes[symbol] / start.closes[symbol] - 1])); }
function drift(active, assetReturns) {
  const gross = FORWARD_TRIAL1_SYMBOLS.reduce((sum, symbol) => sum + active[symbol] * assetReturns[symbol], 0);
  return Object.fromEntries(FORWARD_TRIAL1_SYMBOLS.map((symbol) => [symbol, active[symbol] * (1 + assetReturns[symbol]) / (1 + gross)]));
}

export function buildForwardTrialSettlementInputForTest({ protocol, previousSettlement = null, signalCommitment, startPriceCommitment, endPriceCommitment, capturedAt, now = () => new Date() } = {}) {
  const start = structuredClone(startPriceCommitment.payload.data.signal_panel.at(-1)); const end = structuredClone(endPriceCommitment.payload.data.signal_panel.at(-1)); const assetReturns = returns(start, end);
  const strategies = Object.fromEntries(FORWARD_TRIAL1_STRATEGY_IDS.map((id) => {
    const prior = accountBefore(protocol, previousSettlement, id); const committed = signalCommitment.payload.strategy_commitments[id]; const active = committed.action === "REBALANCE" ? committed.committed_target_weights : prior.weights;
    const turnover = FORWARD_TRIAL1_SYMBOLS.reduce((sum, symbol) => sum + Math.abs(active[symbol] - prior.weights[symbol]), 0); const cost = turnover * protocol.accounting.cost_bps_per_absolute_traded_notional / 10_000; const gross = FORWARD_TRIAL1_SYMBOLS.reduce((sum, symbol) => sum + active[symbol] * assetReturns[symbol], 0); const net = gross - cost;
    return [id, { formula_binding_sha256: protocol.formula_bindings[id].binding_sha256, committed_action: committed.action, pretrade_weights: structuredClone(prior.weights), evaluation_weights: structuredClone(active), turnover_notional: turnover, modeled_transaction_cost_return: cost, reported_paper_fees_currency: 0, paper_evidence: { order_receipt_sha256: null, fill_receipt_sha256: null, reconciliation_receipt_sha256: null }, accounting: { opening_equity: prior.equity, gross_return: gross, net_return: net, closing_equity: prior.equity * (1 + net), closing_weights: drift(active, assetReturns) } }];
  }));
  const sequence = (previousSettlement?.sequence ?? 0) + 1;
  const input = {
    schema_version: FORWARD_TRIAL1_SETTLEMENT_INPUT_SCHEMA, trial_id: FORWARD_TRIAL1_ID, evidence_class: "TEST_ONLY_SYNTHETIC_UNANCHORED", captured_at: capturedAt,
    commitment_references: { signal_commitment_sha256: signalCommitment.commitment_sha256, start_price_commitment_sha256: startPriceCommitment.commitment_sha256, end_price_commitment_sha256: endPriceCommitment.commitment_sha256 },
    timeline: { signal_session_date: signalCommitment.payload.timeline.signal_session_date, execution_session_date: start.date, return_start_session_date: start.date, return_end_session_date: end.date, return_end_market_close_at: endPriceCommitment.payload.timeline.signal_market_close_at, outcome_eligible_at: endPriceCommitment.payload.timeline.signal_bar_eligible_at },
    data: { outcome_prices: [start, end], outcome_prices_sha256: hashForwardTrialEntryBody([start, end]), per_symbol_outcome_sha256: symbolHashes([start, end]), asset_returns: assetReturns },
    strategies, phase: inferencePhaseForSettledSessions(sequence), external_anchor_gate: { signal_commitment_independently_verified: false, settlement_append_permitted: false, performance_claim_permitted: false },
  };
  return validateForwardTrialSettlementInputForTest(input, { protocol, previousSettlement, signalCommitment, startPriceCommitment, endPriceCommitment, now });
}

function validateSettlementStrategy(value, { id, protocol, previousSettlement, commitmentAction, assetReturns }) {
  exact(value, ["formula_binding_sha256", "committed_action", "pretrade_weights", "evaluation_weights", "turnover_notional", "modeled_transaction_cost_return", "reported_paper_fees_currency", "paper_evidence", "accounting"], `settlement strategy ${id}`);
  if (value.formula_binding_sha256 !== protocol.formula_bindings[id].binding_sha256 || value.committed_action !== commitmentAction.action) fail(`settlement ${id} changes commitment`);
  const prior = accountBefore(protocol, previousSettlement, id); weights(value.pretrade_weights, `${id} pretrade`); weights(value.evaluation_weights, `${id} evaluation`); if (!weightsClose(value.pretrade_weights, prior.weights)) fail(`${id} breaks account continuity`);
  const active = commitmentAction.action === "REBALANCE" ? commitmentAction.committed_target_weights : prior.weights; if (!weightsClose(value.evaluation_weights, active)) fail(`${id} changes committed action`);
  const turnover = FORWARD_TRIAL1_SYMBOLS.reduce((sum, symbol) => sum + Math.abs(active[symbol] - prior.weights[symbol]), 0); const cost = turnover * protocol.accounting.cost_bps_per_absolute_traded_notional / 10_000; const gross = FORWARD_TRIAL1_SYMBOLS.reduce((sum, symbol) => sum + active[symbol] * assetReturns[symbol], 0); const net = gross - cost;
  if (!close(value.turnover_notional, turnover) || !close(value.modeled_transaction_cost_return, cost, 1e-10) || value.reported_paper_fees_currency !== 0) fail(`${id} cost arithmetic differs`);
  exact(value.paper_evidence, ["order_receipt_sha256", "fill_receipt_sha256", "reconciliation_receipt_sha256"], `${id} paper evidence`); if (Object.values(value.paper_evidence).some((item) => item !== null)) fail("test settlement cannot claim paper execution");
  exact(value.accounting, ["opening_equity", "gross_return", "net_return", "closing_equity", "closing_weights"], `${id} accounting`);
  if (!close(value.accounting.opening_equity, prior.equity, 1e-6) || !close(value.accounting.gross_return, gross, 1e-10) || !close(value.accounting.net_return, net, 1e-10) || !close(value.accounting.closing_equity, prior.equity * (1 + net), 1e-5)) fail(`${id} accounting differs`);
  weights(value.accounting.closing_weights, `${id} closing weights`); if (!weightsClose(value.accounting.closing_weights, drift(active, assetReturns), 1e-8)) fail(`${id} closing weights differ`);
}

export function validateForwardTrialSettlementInputForTest(input, { protocol, previousSettlement = null, signalCommitment, startPriceCommitment, endPriceCommitment, now = () => new Date() } = {}) {
  validateForwardTrialProtocol(protocol); noSecrets(input, "test settlement"); exact(input, ["schema_version", "trial_id", "evidence_class", "captured_at", "commitment_references", "timeline", "data", "strategies", "phase", "external_anchor_gate"], "test settlement input");
  if (input.schema_version !== FORWARD_TRIAL1_SETTLEMENT_INPUT_SCHEMA || input.trial_id !== FORWARD_TRIAL1_ID || input.evidence_class !== "TEST_ONLY_SYNTHETIC_UNANCHORED") fail("settlement is not explicitly test-only");
  const captured = instant(input.captured_at, "settlement captured_at"); const current = new Date(now()); if (!Number.isFinite(current.getTime()) || captured > current.toISOString()) fail("settlement capture is in future");
  if (!signalCommitment || !startPriceCommitment || !endPriceCommitment) fail("settlement requires three prior commitments"); const sequence = (previousSettlement?.sequence ?? 0) + 1;
  if (signalCommitment.sequence !== sequence || startPriceCommitment.sequence !== sequence + 1 || endPriceCommitment.sequence !== sequence + 2) fail("settlement commitments must be N/N+1/N+2");
  exact(input.commitment_references, ["signal_commitment_sha256", "start_price_commitment_sha256", "end_price_commitment_sha256"], "commitment references"); if (!same(input.commitment_references, { signal_commitment_sha256: signalCommitment.commitment_sha256, start_price_commitment_sha256: startPriceCommitment.commitment_sha256, end_price_commitment_sha256: endPriceCommitment.commitment_sha256 })) fail("settlement commitment hashes differ");
  const start = startPriceCommitment.payload.data.signal_panel.at(-1); const end = endPriceCommitment.payload.data.signal_panel.at(-1);
  exact(input.timeline, ["signal_session_date", "execution_session_date", "return_start_session_date", "return_end_session_date", "return_end_market_close_at", "outcome_eligible_at"], "settlement timeline");
  if (!same(input.timeline, { signal_session_date: signalCommitment.payload.timeline.signal_session_date, execution_session_date: start.date, return_start_session_date: start.date, return_end_session_date: end.date, return_end_market_close_at: endPriceCommitment.payload.timeline.signal_market_close_at, outcome_eligible_at: endPriceCommitment.payload.timeline.signal_bar_eligible_at }) || captured < input.timeline.outcome_eligible_at) fail("settlement timeline differs from commitments");
  exact(input.data, ["outcome_prices", "outcome_prices_sha256", "per_symbol_outcome_sha256", "asset_returns"], "settlement data"); if (!same(input.data.outcome_prices, [start, end]) || input.data.outcome_prices_sha256 !== hashForwardTrialEntryBody([start, end])) fail("settlement prices differ from commitments"); hashMap(input.data.per_symbol_outcome_sha256, "outcome symbol hashes"); if (!same(input.data.per_symbol_outcome_sha256, symbolHashes([start, end]))) fail("outcome symbol hashes differ");
  const assetReturns = returns(start, end); exact(input.data.asset_returns, FORWARD_TRIAL1_SYMBOLS, "asset returns"); if (!FORWARD_TRIAL1_SYMBOLS.every((symbol) => close(input.data.asset_returns[symbol], assetReturns[symbol], 1e-12))) fail("asset returns differ from committed prices");
  exact(input.strategies, FORWARD_TRIAL1_STRATEGY_IDS, "settlement strategies"); for (const id of FORWARD_TRIAL1_STRATEGY_IDS) validateSettlementStrategy(input.strategies[id], { id, protocol, previousSettlement, commitmentAction: signalCommitment.payload.strategy_commitments[id], assetReturns });
  if (input.phase !== inferencePhaseForSettledSessions(sequence)) fail("settlement phase differs"); exact(input.external_anchor_gate, ["signal_commitment_independently_verified", "settlement_append_permitted", "performance_claim_permitted"], "test anchor gate"); if (Object.values(input.external_anchor_gate).some(Boolean)) fail("test settlement cannot claim anchor, append, or performance permission"); return input;
}

function settlementBody(value) { return { schema_version: value.schema_version, trial_id: value.trial_id, sequence: value.sequence, entry_kind: value.entry_kind, previous_settlement_sha256: value.previous_settlement_sha256, payload: value.payload }; }
export function buildForwardTrialSettlementForTest(input, { protocol, genesis, previousSettlement = null, signalCommitment, startPriceCommitment, endPriceCommitment, now = () => new Date() } = {}) {
  validateForwardTrialSettlementInputForTest(input, { protocol, previousSettlement, signalCommitment, startPriceCommitment, endPriceCommitment, now }); const body = { schema_version: FORWARD_TRIAL1_SETTLEMENT_SCHEMA, trial_id: FORWARD_TRIAL1_ID, sequence: (previousSettlement?.sequence ?? 0) + 1, entry_kind: "OUTCOME_SETTLEMENT_TEST_ONLY", previous_settlement_sha256: previousSettlement?.settlement_sha256 ?? genesis.genesis_sha256, payload: input }; return Object.freeze({ ...body, settlement_sha256: hashForwardTrialEntryBody(body) });
}
function validateSettlementForTest(value, context) {
  exact(value, ["schema_version", "trial_id", "sequence", "entry_kind", "previous_settlement_sha256", "payload", "settlement_sha256"], "test settlement"); const prior = context.previousSettlement;
  if (value.schema_version !== FORWARD_TRIAL1_SETTLEMENT_SCHEMA || value.trial_id !== FORWARD_TRIAL1_ID || value.entry_kind !== "OUTCOME_SETTLEMENT_TEST_ONLY" || value.sequence !== (prior?.sequence ?? 0) + 1 || value.previous_settlement_sha256 !== (prior?.settlement_sha256 ?? context.genesis.genesis_sha256)) fail("test settlement chain is broken");
  validateForwardTrialSettlementInputForTest(value.payload, context); if (value.settlement_sha256 !== hashForwardTrialEntryBody(settlementBody(value))) fail("settlement hash mismatch"); return value;
}

function mulberry32(seed) {
  let state = seed >>> 0; return () => { state = (state + 0x6D2B79F5) >>> 0; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296; };
}
function diagnostic(settlements, protocol) {
  const selected = settlements.slice(0, 252); const values = selected.map((item) => Math.log1p(item.payload.strategies.finly_production_v1.accounting.net_return) - Math.log1p(item.payload.strategies.benchmark_spy_buy_hold.accounting.net_return)); const observed = values.reduce((sum, value) => sum + value, 0) / values.length; const centered = values.map((value) => value - observed); const random = mulberry32(protocol.inference.bootstrap_seed_uint32); const restart = 1 / protocol.inference.expected_block_sessions; let exceedances = 0;
  for (let draw = 0; draw < protocol.inference.bootstrap_resamples; draw += 1) { let source = Math.floor(random() * centered.length); let sum = 0; for (let index = 0; index < centered.length; index += 1) { sum += centered[source]; source = random() < restart ? Math.floor(random() * centered.length) : (source + 1) % centered.length; } if (sum / centered.length >= observed) exceedances += 1; }
  const body = { schema_version: "finly_forward_trial1_test_only_diagnostic.v1", evidence_class: "TEST_ONLY_UNANCHORED_NOT_PERFORMANCE_INFERENCE", sessions_used: 252, first_settlement_sha256: selected[0].settlement_sha256, last_settlement_sha256: selected.at(-1).settlement_sha256, observed_mean_daily_log_return_difference: observed, bootstrap_seed_uint32: protocol.inference.bootstrap_seed_uint32, bootstrap_resamples: protocol.inference.bootstrap_resamples, expected_block_sessions: protocol.inference.expected_block_sessions, exceedances, one_sided_p_value: (1 + exceedances) / (protocol.inference.bootstrap_resamples + 1), performance_claim_permitted: false };
  return { ...body, result_sha256: hashForwardTrialEntryBody(body) };
}

async function loadFrozen(root) {
  const [protocolRaw, genesisRaw] = await Promise.all([readFile(resolve(root, "research/forward_trial1_protocol.json")), readFile(resolve(root, "research/forward_trial1_genesis.json"))]);
  const protocol = JSON.parse(protocolRaw); const genesis = JSON.parse(genesisRaw); validateForwardTrialProtocol(protocol); const artifactStatus = await verifyFrozenForwardTrialArtifacts(protocol, root); validateForwardTrialGenesis(genesis, protocol, sha256Bytes(protocolRaw)); return { protocol, genesis, ...artifactStatus };
}
async function sequenced(directory, hashField, label) {
  let names = []; try { names = (await readdir(directory)).sort(); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const result = [];
  for (let index = 0; index < names.length; index += 1) {
    const match = FILE.exec(names[index]); if (!match || Number(match[1]) !== index + 1) fail(`${label} files contain an unknown file, gap, or duplicate`);
    const path = resolve(directory, names[index]); const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) fail(`${label} is not a regular local file`);
    const value = JSON.parse(await readFile(path, "utf8")); if (value.sequence !== index + 1 || value[hashField]?.slice(7) !== match[2]) fail(`${label} filename does not bind entry`); result.push(value);
  }
  return result;
}

export async function verifyForwardTrialLedger({ projectRoot = defaultProjectRoot, now } = {}) {
  const runtime = await environment(projectRoot, now); const { protocol, genesis, production_seed_available: productionSeedAvailable } = await loadFrozen(projectRoot); await topology(projectRoot);
  const commitments = await sequenced(resolve(projectRoot, protocol.genesis.commitment_directory), "commitment_sha256", "signal commitment"); let previousCommitment = null;
  for (const item of commitments) { validateForwardTrialSignalCommitment(item, { protocol, genesis, previousCommitment, now: runtime.now }); previousCommitment = item; }
  const settlements = await sequenced(resolve(projectRoot, protocol.genesis.settlement_directory), "settlement_sha256", "settlement");
  if (runtime.classification === "PRODUCTION_ZERO_ROW" && commitments.length > 0) {
    if (!productionSeedAvailable) fail("production commitment requires the exact private seed artifact");
    fail("production commitment gate is closed until corporate-action and outcome-price reconciliation are implemented");
  }
  if (runtime.classification === "PRODUCTION_ZERO_ROW" && settlements.length > 0) fail("production settlement gate is closed until independent anchors and outcome prices verify");
  let previousSettlement = null;
  for (const item of settlements) {
    const index = item.sequence - 1; if (!commitments[index] || !commitments[index + 1] || !commitments[index + 2]) fail("settlement lacks three prior signal commitments");
    validateSettlementForTest(item, { protocol, genesis, previousSettlement, signalCommitment: commitments[index], startPriceCommitment: commitments[index + 1], endPriceCommitment: commitments[index + 2], now: runtime.now }); previousSettlement = item;
  }
  return Object.freeze({
    schema_version: "finly_forward_trial1_verification.v2", trial_id: FORWARD_TRIAL1_ID, environment: runtime.classification,
    verified_signal_commitments: commitments.length, verified_settlements: settlements.length,
    latest_commitment_sha256: previousCommitment?.commitment_sha256 ?? genesis.genesis_sha256,
    latest_settlement_sha256: previousSettlement?.settlement_sha256 ?? genesis.genesis_sha256,
    phase: settlements.length === 0 ? "NOT_STARTED_ZERO_SETTLEMENTS" : inferencePhaseForSettledSessions(settlements.length),
    frozen_rule_forward_evaluation_available: settlements.length > 0,
    production_seed_available: productionSeedAvailable,
    private_seed_redistributed: false,
    production_market_data_method_configured: false,
    corporate_action_reconciliation_ready: false,
    provider_outcome_price_reconciliation_ready: false,
    live_pre_execution_capture_proven: false,
    local_clock_is_prospectivity_evidence: false,
    external_anchor_verifier_configured: false,
    signal_commitment_append_permitted: false,
    settlement_append_permitted: false,
    performance_inference_permitted: false,
    primary_inference: null,
    test_only_diagnostic_calculation: runtime.classification === "TEST_ONLY" && settlements.length >= 252 ? diagnostic(settlements, protocol) : null,
    broker_mutation_permitted_by_runner: false,
    claim_boundary: "Zero-row genesis claims neither performance nor live capture. Synthetic mechanics are TEST_ONLY. Local hashes do not prove provider origin, prospectivity, execution, or future profit.",
  });
}

async function lock(path) {
  try { await mkdir(path); } catch (error) { if (error?.code === "EEXIST") fail("append lock exists; fail closed and inspect manually"); throw error; }
  await writeFile(resolve(path, "owner.json"), `${JSON.stringify({ pid: process.pid }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}
async function unlock(path) { await unlink(resolve(path, "owner.json")); await rmdir(path); }
async function writeOnce(path, payload) {
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.tmp`; const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(payload, "utf8"); await handle.sync(); } finally { await handle.close(); }
  try { await link(temporary, path); } catch (error) { if (error?.code === "EEXIST") fail("write-once destination exists"); throw error; } finally { if (await exists(temporary)) await unlink(temporary); }
}

export async function appendForwardTrialSignalCommitment(input, { projectRoot = defaultProjectRoot, now } = {}) {
  const runtime = await environment(projectRoot, now); const loaded = await loadFrozen(projectRoot);
  if (runtime.classification === "PRODUCTION_ZERO_ROW") {
    if (!loaded.production_seed_available) fail("production commitment requires the exact private seed artifact");
    fail("production signal commitment append is disabled until corporate-action and outcome-price reconciliation are implemented");
  }
  const lockPath = resolve(projectRoot, "research/.forward_trial1_commitment_append.lock"); await lock(lockPath);
  try {
    const { protocol, genesis } = loaded; const options = now === undefined ? { projectRoot } : { projectRoot, now: runtime.now }; const before = await verifyForwardTrialLedger(options); await topology(projectRoot);
    const directory = resolve(projectRoot, protocol.genesis.commitment_directory); const entries = await sequenced(directory, "commitment_sha256", "signal commitment"); const previousCommitment = entries.at(-1) ?? null;
    if ((previousCommitment?.commitment_sha256 ?? genesis.genesis_sha256) !== before.latest_commitment_sha256) fail("commitment chain changed during append");
    const entry = buildForwardTrialSignalCommitment(input, { protocol, genesis, previousCommitment, now: runtime.now }); const path = resolve(directory, `${String(entry.sequence).padStart(8, "0")}_${entry.commitment_sha256.slice(7)}.json`); await writeOnce(path, `${JSON.stringify(entry, null, 2)}\n`);
    const after = await verifyForwardTrialLedger(options); if (after.latest_commitment_sha256 !== entry.commitment_sha256 || after.verified_signal_commitments !== before.verified_signal_commitments + 1) fail("commitment append did not verify"); return Object.freeze({ entry, path, verification: after });
  } finally { await unlock(lockPath); }
}

export async function appendForwardTrialSettlement() {
  fail("production settlement append is disabled until an independent pre-execution anchor verifier is configured");
}
