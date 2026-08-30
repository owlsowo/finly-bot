import { createHash, randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  AEGIS_Q_LEGACY_METADATA,
  AEGIS_Q_LEGACY_PARAMETERS,
  AEGIS_Q_PUBLISHED_METRICS,
  normalizeAdjustedOhlc,
  simulateAegisQLegacy,
  verifyPublishedMetrics,
} from "./aegis_q_legacy_reproduction.mjs";

const modulePath = fileURLToPath(import.meta.url);
const defaultProjectRoot = resolve(dirname(modulePath), "..");

export const AEGIS_AUXILIARY_PATHS = Object.freeze({
  protocol: "research/aegis_q_legacy_reproduction_protocol.json",
  freeze_receipt: "research/aegis_q_legacy_reproduction_freeze_receipt.json",
  implementation: "research/aegis_q_legacy_reproduction.mjs",
  runner: "research/run_aegis_q_legacy_reproduction.mjs",
  implementation_test: "tests/aegis_q_legacy_reproduction.test.mjs",
  runner_test: "tests/aegis_q_legacy_reproduction_runner.test.mjs",
  run_claim: "research/aegis_q_legacy_reproduction_run_claim.json",
  result_json: "research/output/aegis_q_legacy_reproduction.json",
  result_report: "research/output/aegis_q_legacy_reproduction_report.md",
  result_receipt: "research/aegis_q_legacy_reproduction_result_receipt.json",
});

export const AEGIS_AUXILIARY_PROTOCOL_SCHEMA = "finly_aegis_q_legacy_reproduction_protocol.v1";
export const AEGIS_AUXILIARY_PANEL_SCHEMA = "finly_aegis_q_public_adjusted_ohlc_panel.v1";
export const AEGIS_AUXILIARY_FREEZE_SCHEMA = "finly_aegis_q_legacy_reproduction_freeze_receipt.v1";
export const AEGIS_AUXILIARY_RESULT_SCHEMA = "finly_aegis_q_legacy_reproduction_result.v1";
export const AEGIS_AUXILIARY_RESULT_RECEIPT_SCHEMA = "finly_aegis_q_legacy_reproduction_result_receipt.v1";
export const AEGIS_AUXILIARY_RUN_CLAIM_SCHEMA = "finly_aegis_q_legacy_reproduction_run_claim.v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HTTPS_PATTERN = /^https:\/\//u;
const NATIVE_START = "2021-05-12";
const NATIVE_END = "2026-08-27";
const NATIVE_OBSERVATIONS = 1_330;
const WARMUP_SESSIONS = 200;
const INITIAL_CAPITAL = 100_000;
const ABSOLUTE_TOLERANCE = 1e-8;
const RELATIVE_TOLERANCE = 1e-10;
const runLockRelativePath = "research/.aegis_q_legacy_reproduction_run.lock";
const AEGIS_PROCESS_ATTESTATION = "This claim attests only that the official AEGIS-Q auxiliary runner persisted this claim before its own first local reproduction computation. The published target metrics, local panel, engine, and formulas are readable, so this is not cryptographic proof of an unseen outcome.";

export const AEGIS_AUXILIARY_CLAIM_BOUNDARY = Object.freeze({
  auxiliary_only: true,
  submitted_options_pnl: false,
  eligible_as_finly_champion: false,
  future_profitability_proven: false,
  apples_to_apples_with_finly: false,
  statement: "A match establishes reproducibility of the archived legacy equity metric bundle under the declared public-data and execution semantics. It does not reproduce the submitted AEGIS-Q options strategy, establish options P&L, prove future profitability, or provide an apples-to-apples financial comparison with Finly.",
});

export const AEGIS_AUXILIARY_PANEL_SEMANTICS = Object.freeze({
  adjusted_ohlc: true,
  split_adjusted_price_only: true,
  dividends_excluded: true,
  total_return_adjustment: false,
  already_split_adjusted_input: true,
  forward_splits_applied_by_runner: false,
  required_fields: Object.freeze(["date", "symbol", "open", "high", "low", "close"]),
  common_date_policy: "Exactly one QQQ and one TQQQ bar on every retained common session; no forward fill or provider splice.",
  warmup_policy: "Require at least 200 common sessions before 2021-05-12, select the last 200, then retain all 1,330 common sessions from 2021-05-12 through 2026-08-27.",
  minimum_available_common_sessions_before_native_start: WARMUP_SESSIONS,
  native_start: NATIVE_START,
  native_end: NATIVE_END,
  native_common_sessions: NATIVE_OBSERVATIONS,
});

export const AEGIS_AUXILIARY_EXECUTION = Object.freeze({
  signal_formation: "close_t",
  execution: "adjusted_open_t_plus_1",
  one_way_slippage_bps: 5,
  commission: 0,
  cash_return: 0,
  dividends: "excluded",
  rebalance_band_absolute_weight: 0.05,
  fractional_shares: true,
});

export const AEGIS_AUXILIARY_FIRST_RUN_POLICY = Object.freeze({
  run_claim_path: AEGIS_AUXILIARY_PATHS.run_claim,
  lock_path: runLockRelativePath,
  process_attestation_only: true,
  published_target_known_before_claim: true,
  crash_recovery: "Every artifact is write-once. Repeated official invocations under the same claim finish missing files or verify byte-identical files and reject conflicting bytes.",
  output_paths: Object.freeze([
    AEGIS_AUXILIARY_PATHS.result_json,
    AEGIS_AUXILIARY_PATHS.result_report,
    AEGIS_AUXILIARY_PATHS.result_receipt,
  ]),
  overwrite_permitted: false,
  later_mode: "--verify-existing",
  failure_policy: "Write the frozen mismatch honestly; never tune semantics or replace the panel after observing the outcome.",
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function localRelativePath(value, label) {
  invariant(typeof value === "string" && value.length > 0, `${label} must be a non-empty path`);
  invariant(!isAbsolute(value), `${label} must be project-relative`);
  invariant(!value.includes("://"), `${label} must be local; network URLs are forbidden`);
  const normalized = value.replaceAll("\\", "/");
  invariant(!normalized.split("/").includes(".."), `${label} must not escape the project root`);
  return normalized;
}

function resolveLocal(projectRoot, value, label) {
  const relativePath = localRelativePath(value, label);
  const root = resolve(projectRoot);
  const path = resolve(root, relativePath);
  invariant(path === root || path.startsWith(`${root}${sep}`), `${label} escapes the project root`);
  return path;
}

function exactObject(actual, expected, label, reasons) {
  if (!isDeepStrictEqual(actual, expected)) reasons.push(`${label} does not match the pinned implementation`);
}

function filledHash(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function publicHttpsUrl(value) {
  return typeof value === "string" && HTTPS_PATTERN.test(value);
}

/**
 * Validate a proposed frozen protocol without touching market data. The template
 * intentionally fails until its local panel descriptors and hashes are filled.
 */
export function validateAegisAuxiliaryProtocol(protocol) {
  const reasons = [];
  if (protocol?.schema_version !== AEGIS_AUXILIARY_PROTOCOL_SCHEMA) reasons.push("protocol schema mismatch");
  if (protocol?.status !== "frozen_before_first_aegis_q_auxiliary_output") reasons.push("protocol status is not frozen");
  if (protocol?.frozen_before_first_output !== true) reasons.push("protocol is not marked frozen before first output");
  exactObject(protocol?.claim_boundary, AEGIS_AUXILIARY_CLAIM_BOUNDARY,
    "claim boundary", reasons);
  if (protocol?.source_pin?.pinned_commit !== AEGIS_Q_LEGACY_METADATA.pinned_commit) reasons.push("pinned competitor commit mismatch");
  if (protocol?.source_pin?.reproduction_id !== AEGIS_Q_LEGACY_METADATA.reproduction_id) reasons.push("pinned reproduction id mismatch");
  exactObject(protocol?.source_pin?.urls, AEGIS_Q_LEGACY_METADATA.source_urls, "source URL registry", reasons);
  exactObject(protocol?.strategy?.parameters, AEGIS_Q_LEGACY_PARAMETERS, "strategy parameters", reasons);
  exactObject(protocol?.strategy?.native_semantics, AEGIS_Q_LEGACY_METADATA.native_semantics, "native source semantics", reasons);
  exactObject(protocol?.published_comparison?.expected_metrics, AEGIS_Q_PUBLISHED_METRICS, "published metric bundle", reasons);

  if (protocol?.data?.runner_market_fetch_permitted !== false) reasons.push("protocol permits a runner market fetch");
  if (!isDeepStrictEqual(protocol?.data?.symbols, ["QQQ", "TQQQ"])) reasons.push("panel symbol registry must be exactly QQQ/TQQQ");
  if (protocol?.data?.panel?.schema_version !== AEGIS_AUXILIARY_PANEL_SCHEMA) reasons.push("panel schema mismatch");
  try {
    localRelativePath(protocol?.data?.panel?.path, "panel path");
  } catch (error) {
    reasons.push(error.message);
  }
  if (!filledHash(protocol?.data?.panel?.file_sha256)) reasons.push("panel file SHA-256 is missing or unfilled");
  if (!filledHash(protocol?.data?.panel?.normalized_panel_sha256)) reasons.push("normalized panel SHA-256 is missing or unfilled");
  if (!publicHttpsUrl(protocol?.data?.public_source?.url)) reasons.push("public panel source URL must be pinned to HTTPS");
  if (typeof protocol?.data?.public_source?.provider !== "string" || protocol.data.public_source.provider.length === 0) {
    reasons.push("public panel provider is missing");
  }
  if (!Number.isFinite(Date.parse(protocol?.data?.public_source?.retrieved_at ?? ""))) reasons.push("public panel retrieval timestamp is missing");
  const source = protocol?.data?.public_source ?? {};
  if (source.feed !== "iex") reasons.push("public panel feed must be IEX");
  if (source.timeframe !== "1Day") reasons.push("public panel timeframe must be 1Day");
  if (source.adjustment !== "split") reasons.push("public panel adjustment must be split only");
  const requestStartMillis = Date.parse(source.request_start ?? "");
  if (!Number.isFinite(requestStartMillis)
    || requestStartMillis >= Date.parse(`${NATIVE_START}T00:00:00Z`)) {
    reasons.push("public panel request start must precede the native start");
  }
  if (source.request_end !== NATIVE_END) reasons.push("public panel request end mismatch");
  try {
    localRelativePath(source.raw_bars_path, "raw bars path");
  } catch (error) {
    reasons.push(error.message);
  }
  if (source.raw_bars_path === protocol?.data?.panel?.path) {
    reasons.push("raw bars and normalized panel must be separately persisted inputs");
  }
  if (!filledHash(source.raw_bars_sha256)) reasons.push("public raw-bars SHA-256 is missing or unfilled");
  if (source.corporate_actions_applied_separately !== false) {
    reasons.push("public source must not apply corporate actions separately to split-adjusted bars");
  }
  exactObject(protocol?.data?.panel_semantics, AEGIS_AUXILIARY_PANEL_SEMANTICS,
    "panel semantics", reasons);

  const frozenCode = protocol?.frozen_code ?? {};
  for (const [id, expectedPath] of Object.entries({
    implementation: AEGIS_AUXILIARY_PATHS.implementation,
    runner: AEGIS_AUXILIARY_PATHS.runner,
    implementation_test: AEGIS_AUXILIARY_PATHS.implementation_test,
    runner_test: AEGIS_AUXILIARY_PATHS.runner_test,
  })) {
    if (frozenCode[id]?.path !== expectedPath) reasons.push(`frozen ${id} path mismatch`);
    if (!filledHash(frozenCode[id]?.sha256)) reasons.push(`frozen ${id} SHA-256 is missing or unfilled`);
  }

  const native = protocol?.published_comparison ?? {};
  if (native.start !== NATIVE_START || native.end !== NATIVE_END) reasons.push("native comparison dates mismatch");
  if (native.observations !== NATIVE_OBSERVATIONS) reasons.push("native observation count mismatch");
  if (native.warmup_sessions_before_start !== WARMUP_SESSIONS) reasons.push("native warmup-session count mismatch");
  if (native.initial_capital !== INITIAL_CAPITAL) reasons.push("native initial capital mismatch");
  if (native.tolerances?.absolute !== ABSOLUTE_TOLERANCE) reasons.push("published absolute tolerance mismatch");
  if (native.tolerances?.relative !== RELATIVE_TOLERANCE) reasons.push("published relative tolerance mismatch");
  if (native.tolerances?.integer_and_string_fields !== "exact") reasons.push("published discrete-field tolerance mismatch");

  exactObject(protocol?.execution, AEGIS_AUXILIARY_EXECUTION, "execution boundary", reasons);
  exactObject(protocol?.first_run_policy, AEGIS_AUXILIARY_FIRST_RUN_POLICY,
    "first-run policy", reasons);
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function assertProtocol(protocol) {
  const validation = validateAegisAuxiliaryProtocol(protocol);
  invariant(validation.passes, `AEGIS-Q auxiliary protocol failed closed: ${validation.reasons.join("; ")}`);
  return validation;
}

function validatePanelDocument(panelDocument, protocol) {
  invariant(panelDocument?.schema_version === AEGIS_AUXILIARY_PANEL_SCHEMA, "local panel schema mismatch");
  invariant(panelDocument?.source?.provider === protocol.data.public_source.provider, "local panel provider differs from protocol");
  invariant(panelDocument?.source?.url === protocol.data.public_source.url, "local panel source URL differs from protocol");
  invariant(isDeepStrictEqual(panelDocument?.source, protocol.data.public_source),
    "local panel source provenance differs from protocol");
  invariant(isDeepStrictEqual(panelDocument?.semantics, AEGIS_AUXILIARY_PANEL_SEMANTICS),
    "local panel semantics differ from the pinned split-only boundary");
  invariant(panelDocument?.input_hashes?.raw_bars_sha256
      === protocol.data.public_source.raw_bars_sha256,
  "local panel raw-bars input hash differs from protocol");
  invariant(panelDocument?.input_hashes?.corporate_actions_sha256 === null,
    "split-adjusted input must not declare a separately applied corporate-actions file");
  invariant(Array.isArray(panelDocument?.bars) && panelDocument.bars.length > 0, "local panel bars are required");
}

/**
 * Normalize a hash-verified local panel and select exactly 200 common sessions
 * before the native start plus the 1,330-session published comparison window.
 */
export function prepareAegisNativePanel(panelDocument, protocol) {
  assertProtocol(protocol);
  validatePanelDocument(panelDocument, protocol);
  const normalized = normalizeAdjustedOhlc(panelDocument.bars, []);
  invariant(isDeepStrictEqual(normalized.symbols, ["QQQ", "TQQQ"]), "normalized panel symbols must be exactly QQQ/TQQQ");
  invariant(
    normalized.normalized_panel_sha256 === protocol.data.panel.normalized_panel_sha256,
    "normalized panel SHA-256 differs from the frozen protocol",
  );

  const byDate = new Map();
  for (const bar of normalized.bars) {
    if (!byDate.has(bar.date)) byDate.set(bar.date, []);
    byDate.get(bar.date).push(bar);
  }
  const dates = [...byDate.keys()].sort();
  for (const date of dates) {
    const symbols = byDate.get(date).map((bar) => bar.symbol).sort();
    invariant(isDeepStrictEqual(symbols, ["QQQ", "TQQQ"]), `incomplete QQQ/TQQQ panel on ${date}`);
  }
  const availableWarmupDates = dates.filter((date) => date < NATIVE_START);
  invariant(availableWarmupDates.length >= WARMUP_SESSIONS,
    `panel needs at least ${WARMUP_SESSIONS} common sessions before ${NATIVE_START}`);
  const warmupDates = availableWarmupDates.slice(-WARMUP_SESSIONS);
  const nativeDates = dates.filter((date) => date >= NATIVE_START && date <= NATIVE_END);
  invariant(nativeDates[0] === NATIVE_START, `native panel does not begin on ${NATIVE_START}`);
  invariant(nativeDates.at(-1) === NATIVE_END, `native panel does not end on ${NATIVE_END}`);
  invariant(nativeDates.length === NATIVE_OBSERVATIONS, `native panel must contain exactly ${NATIVE_OBSERVATIONS} common sessions`);
  const selectedDateSet = new Set([...warmupDates, ...nativeDates]);
  const bars = normalized.bars.filter((bar) => selectedDateSet.has(bar.date));
  return Object.freeze({
    bars,
    normalized_panel_sha256: normalized.normalized_panel_sha256,
    source_first_date: normalized.first_date,
    source_last_date: normalized.last_date,
    selected_first_date: warmupDates[0],
    selected_last_date: nativeDates.at(-1),
    selected_common_sessions: warmupDates.length + nativeDates.length,
    warmup_sessions: warmupDates.length,
    native_sessions: nativeDates.length,
  });
}

function summarizeChecks(verification, portfolio) {
  return verification.checks
    .filter((check) => check.path.startsWith(`metrics.${portfolio}.`))
    .map((check) => ({
      field: check.path.split(".").at(-1),
      expected: check.expected,
      actual: check.actual,
      absolute_error: check.absolute_error,
      tolerance: check.tolerance,
      passed: check.passed,
    }));
}

function percent(value, digits = 2) {
  return `${(100 * value).toFixed(digits)}%`;
}

function dollars(value) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function markdownReport(result) {
  const lines = [
    "# AEGIS-Q legacy equity reproduction — auxiliary comparator",
    "",
    `**Disposition:** ${result.published_bundle_verification.verified ? "published metric bundle reproduced within the frozen tolerances" : "published metric bundle was not reproduced within the frozen tolerances"}`,
    "",
    "> This is an auxiliary reproduction of AEGIS-Q's archived legacy QQQ/TQQQ equity strategy. It is not the submitted AEGIS-Q options strategy, not options P&L, not a Finly champion candidate, not evidence of future profitability, and not an apples-to-apples financial comparison with Finly.",
    "",
    "## Native comparison",
    "",
    `The hash-pinned local public-data panel was evaluated from ${result.native_comparison.start} through ${result.native_comparison.end} (${result.native_comparison.observations.toLocaleString("en-US")} observations). Signals use close-*t* information and execute at split-adjusted open *t+1*. Cash earns zero, dividends are excluded, and each traded leg is charged 5 bp one way.`,
    "",
    "| Portfolio | Ending value | Total return | CAGR | Volatility | Sharpe | Max drawdown |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const id of ["agent", "QQQ", "TQQQ"]) {
    const metric = result.metrics[id];
    lines.push(`| ${id} | ${dollars(metric.ending_value)} | ${percent(metric.total_return)} | ${percent(metric.cagr)} | ${percent(metric.annual_volatility)} | ${metric.sharpe_0pct_cash.toFixed(3)} | ${percent(metric.max_drawdown)} |`);
  }
  lines.push(
    "",
    "## Published-bundle check",
    "",
    `${result.published_bundle_verification.compared_fields} published fields were compared. ${result.published_bundle_verification.failed_fields.length} failed. Numeric tolerances were absolute ${result.native_comparison.tolerances.absolute} plus relative ${result.native_comparison.tolerances.relative}; integers and strings required exact equality.`,
    "",
  );
  for (const id of ["agent", "QQQ", "TQQQ"]) {
    const failed = summarizeChecks(result.published_bundle_verification, id).filter((check) => !check.passed);
    lines.push(`- ${id}: ${failed.length === 0 ? "all published fields matched" : `failed ${failed.map((check) => check.field).join(", ")}`}`);
  }
  lines.push(
    "",
    "## Integrity boundary",
    "",
    `Panel file SHA-256: \`${result.frozen_inputs.panel_file_sha256}\``,
    "",
    `Normalized panel SHA-256: \`${result.frozen_inputs.normalized_panel_sha256}\``,
    "",
    `Pinned AEGIS-Q commit: \`${result.source_pin.pinned_commit}\``,
    "",
    "The runner has no network acquisition path. A different panel, source timestamp, code hash, protocol hash, or freeze receipt fails closed before simulation. The official runner persists a process-only claim before its own first computation; this is not cryptographic proof of an unseen outcome because the published target is already known. Partial writes resume only when bytes are identical; later checks use `--verify-existing` and never overwrite them.",
    "",
  );
  return Buffer.from(lines.join("\n"), "utf8");
}

/** Build deterministic result artifacts from already verified frozen inputs. */
export function buildAegisAuxiliaryArtifacts({
  protocol,
  panelDocument,
  frozenInputHashes,
}) {
  assertProtocol(protocol);
  const prepared = prepareAegisNativePanel(panelDocument, protocol);
  const reproduction = simulateAegisQLegacy(prepared, {
    initialCapital: protocol.published_comparison.initial_capital,
  });
  invariant(reproduction.metrics.agent.start === NATIVE_START, "reproduced agent period starts outside the native window");
  invariant(reproduction.metrics.agent.end === NATIVE_END, "reproduced agent period ends outside the native window");
  invariant(reproduction.metrics.agent.observations === NATIVE_OBSERVATIONS, "reproduced agent observation count differs from the native window");
  const verification = verifyPublishedMetrics(reproduction, {
    expected: protocol.published_comparison.expected_metrics,
    absoluteTolerance: protocol.published_comparison.tolerances.absolute,
    relativeTolerance: protocol.published_comparison.tolerances.relative,
  });
  const result = Object.freeze({
    schema_version: AEGIS_AUXILIARY_RESULT_SCHEMA,
    status: verification.verified ? "PUBLISHED_BUNDLE_REPRODUCED" : "PUBLISHED_BUNDLE_NOT_REPRODUCED",
    comparison_role: "AUXILIARY_LEGACY_EQUITY_COMPARISON_ONLY",
    claim_boundary: protocol.claim_boundary,
    source_pin: protocol.source_pin,
    native_comparison: {
      start: NATIVE_START,
      end: NATIVE_END,
      observations: NATIVE_OBSERVATIONS,
      warmup_sessions_before_start: WARMUP_SESSIONS,
      initial_capital: INITIAL_CAPITAL,
      tolerances: protocol.published_comparison.tolerances,
    },
    execution: protocol.execution,
    frozen_inputs: {
      ...frozenInputHashes,
      normalized_panel_sha256: prepared.normalized_panel_sha256,
      selected_first_date: prepared.selected_first_date,
      selected_last_date: prepared.selected_last_date,
      selected_common_sessions: prepared.selected_common_sessions,
    },
    metrics: reproduction.metrics,
    latest_signal: reproduction.latest_signal,
    activity: {
      decisions: reproduction.decisions.length,
      trade_events: reproduction.metrics.agent.trade_events,
      order_legs: reproduction.metrics.agent.order_legs,
      turnover_multiple: reproduction.metrics.agent.turnover_multiple,
      estimated_slippage_dollars: reproduction.metrics.agent.estimated_slippage_dollars,
    },
    published_bundle_verification: verification,
  });
  const resultJson = jsonBytes(result);
  const report = markdownReport(result);
  return Object.freeze({ result, resultJson, report });
}

function validateFreezeReceipt(receipt, protocol, actualHashes) {
  invariant(receipt?.schema_version === AEGIS_AUXILIARY_FREEZE_SCHEMA, "AEGIS-Q freeze receipt schema mismatch");
  invariant(receipt?.status === "frozen_before_first_aegis_q_auxiliary_output", "AEGIS-Q freeze receipt status mismatch");
  invariant(receipt?.aegis_q_auxiliary_results_seen_at_freeze === false, "freeze receipt says AEGIS-Q results were seen");
  invariant(receipt?.aegis_q_auxiliary_output_absent_at_freeze === true, "freeze receipt does not attest output absence");
  invariant(receipt?.market_fetch_permitted === false, "freeze receipt permits a market fetch");
  invariant(isDeepStrictEqual(receipt?.claim_boundary, AEGIS_AUXILIARY_CLAIM_BOUNDARY),
    "freeze receipt does not preserve the exact auxiliary claim boundary");
  invariant(isDeepStrictEqual(receipt?.validation_before_freeze, {
    synthetic_implementation_tests: "passed",
    synthetic_runner_tests: "passed",
    targeted_eslint: "passed",
    panel_schema_and_hash_check: "passed",
    split_only_provenance_check: "passed",
  }), "freeze receipt validation manifest is incomplete");
  for (const [relativePath, actualHash] of Object.entries(actualHashes)) {
    invariant(receipt?.files?.[relativePath] === actualHash, `freeze receipt hash mismatch for ${relativePath}`);
  }
  invariant(
    receipt.files[protocol.data.panel.path] === protocol.data.panel.file_sha256,
    "freeze receipt and protocol disagree on the panel file hash",
  );
}

async function readAndHash(projectRoot, relativePath) {
  const path = resolveLocal(projectRoot, relativePath, relativePath);
  const payload = await readFile(path);
  return { path, payload, sha256: sha256(payload) };
}

/**
 * Load only local, preexisting files. There is intentionally no URL, HTTP, or
 * provider adapter in this runner.
 */
export async function loadFrozenAegisAuxiliaryInputs({ projectRoot = defaultProjectRoot } = {}) {
  const protocolFile = await readAndHash(projectRoot, AEGIS_AUXILIARY_PATHS.protocol);
  const protocol = JSON.parse(protocolFile.payload.toString("utf8"));
  assertProtocol(protocol);
  const freezeFile = await readAndHash(projectRoot, AEGIS_AUXILIARY_PATHS.freeze_receipt);
  const rawBarsFile = await readAndHash(projectRoot, protocol.data.public_source.raw_bars_path);
  invariant(rawBarsFile.sha256 === protocol.data.public_source.raw_bars_sha256,
    "local raw-bars file SHA-256 differs from the protocol");
  const panelFile = await readAndHash(projectRoot, protocol.data.panel.path);
  invariant(panelFile.sha256 === protocol.data.panel.file_sha256, "local panel file SHA-256 differs from the protocol");
  const panelDocument = JSON.parse(panelFile.payload.toString("utf8"));

  const codeDescriptors = Object.values(protocol.frozen_code);
  const codeFiles = await Promise.all(codeDescriptors.map((descriptor) => readAndHash(projectRoot, descriptor.path)));
  const codeHashes = Object.fromEntries(codeDescriptors.map((descriptor, index) => {
    invariant(codeFiles[index].sha256 === descriptor.sha256, `current file hash differs from frozen protocol for ${descriptor.path}`);
    return [descriptor.path, codeFiles[index].sha256];
  }));
  const actualHashes = {
    [AEGIS_AUXILIARY_PATHS.protocol]: protocolFile.sha256,
    [protocol.data.public_source.raw_bars_path]: rawBarsFile.sha256,
    [protocol.data.panel.path]: panelFile.sha256,
    ...codeHashes,
  };
  const freezeReceipt = JSON.parse(freezeFile.payload.toString("utf8"));
  validateFreezeReceipt(freezeReceipt, protocol, actualHashes);
  return Object.freeze({
    protocol,
    panelDocument,
    freezeReceipt,
    hashes: Object.freeze({
      protocol_sha256: protocolFile.sha256,
      freeze_receipt_sha256: freezeFile.sha256,
      raw_bars_file_sha256: rawBarsFile.sha256,
      panel_file_sha256: panelFile.sha256,
      implementation_sha256: codeHashes[AEGIS_AUXILIARY_PATHS.implementation],
      runner_sha256: codeHashes[AEGIS_AUXILIARY_PATHS.runner],
      implementation_test_sha256: codeHashes[AEGIS_AUXILIARY_PATHS.implementation_test],
      runner_test_sha256: codeHashes[AEGIS_AUXILIARY_PATHS.runner_test],
    }),
  });
}

export async function writeAegisArtifactOnceOrVerify(path, payload, label = "AEGIS-Q artifact") {
  invariant(Buffer.isBuffer(payload), `${label} payload must be a Buffer`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.stage`;
  await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
  try {
    try {
      await link(temporary, path);
      return "created";
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const actual = await readFile(path);
      invariant(actual.equals(payload), `${label} already exists with different bytes`);
      return "verified_existing";
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function withExclusiveAegisRunLock({
  projectRoot = defaultProjectRoot,
} = {}, callback) {
  invariant(typeof callback === "function", "AEGIS-Q exclusive-lock callback is required");
  const lockPath = resolveLocal(projectRoot, runLockRelativePath, "AEGIS-Q run lock");
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`AEGIS-Q run lock already exists; another run is active or a stale lock needs audit: ${lockPath}`);
    }
    throw error;
  }
  const ownerPath = resolve(lockPath, "owner.json");
  const owner = Object.freeze({
    schema_version: "finly_aegis_q_exclusive_directory_lock_owner.v1",
    pid: process.pid,
    hostname: hostname(),
    token: randomUUID(),
    started_at: new Date().toISOString(),
    recovery_instruction: "Do not remove this lock while the recorded process may still be alive. Audit its owner and all authoritative artifacts before clearing a stale lock.",
  });
  try {
    await writeFile(ownerPath, jsonBytes(owner), { flag: "wx", mode: 0o600 });
    return await callback();
  } finally {
    await unlink(ownerPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await rmdir(lockPath);
  }
}

function resultReceipt(bundle, frozen, createdAt) {
  return Object.freeze({
    schema_version: AEGIS_AUXILIARY_RESULT_RECEIPT_SCHEMA,
    status: "immutable_first_run_recorded",
    created_at: createdAt,
    comparison_role: "AUXILIARY_LEGACY_EQUITY_COMPARISON_ONLY",
    published_bundle_verified: bundle.result.published_bundle_verification.verified,
    claim_boundary: bundle.result.claim_boundary,
    files: {
      [AEGIS_AUXILIARY_PATHS.result_json]: sha256(bundle.resultJson),
      [AEGIS_AUXILIARY_PATHS.result_report]: sha256(bundle.report),
    },
    frozen_inputs: frozen.hashes,
    write_policy: "First run writes once with exclusive creation. Verification mode never overwrites.",
  });
}

export async function writeAegisAuxiliaryArtifactsOnce({
  projectRoot = defaultProjectRoot,
  bundle,
  frozen,
  createdAt = new Date().toISOString(),
}) {
  invariant(Number.isFinite(Date.parse(createdAt)), "result receipt timestamp is invalid");
  const paths = [
    AEGIS_AUXILIARY_PATHS.result_json,
    AEGIS_AUXILIARY_PATHS.result_report,
    AEGIS_AUXILIARY_PATHS.result_receipt,
  ].map((relativePath) => resolveLocal(projectRoot, relativePath, relativePath));
  const receipt = resultReceipt(bundle, frozen, createdAt);
  const statuses = [];
  statuses.push(await writeAegisArtifactOnceOrVerify(paths[0], bundle.resultJson,
    "AEGIS-Q result JSON"));
  statuses.push(await writeAegisArtifactOnceOrVerify(paths[1], bundle.report,
    "AEGIS-Q result report"));
  statuses.push(await writeAegisArtifactOnceOrVerify(paths[2], jsonBytes(receipt),
    "AEGIS-Q result receipt"));
  return Object.freeze({
    receipt,
    paths: Object.freeze(paths),
    statuses: Object.freeze(statuses),
  });
}

export async function verifyExistingAegisAuxiliaryArtifacts({
  projectRoot = defaultProjectRoot,
  bundle,
  frozen,
}) {
  const resultFile = await readAndHash(projectRoot, AEGIS_AUXILIARY_PATHS.result_json);
  const reportFile = await readAndHash(projectRoot, AEGIS_AUXILIARY_PATHS.result_report);
  const receiptFile = await readAndHash(projectRoot, AEGIS_AUXILIARY_PATHS.result_receipt);
  const receipt = JSON.parse(receiptFile.payload.toString("utf8"));
  invariant(receipt.schema_version === AEGIS_AUXILIARY_RESULT_RECEIPT_SCHEMA, "result receipt schema mismatch");
  invariant(receipt.status === "immutable_first_run_recorded", "result receipt status mismatch");
  invariant(receipt.files?.[AEGIS_AUXILIARY_PATHS.result_json] === resultFile.sha256, "result JSON hash differs from the result receipt");
  invariant(receipt.files?.[AEGIS_AUXILIARY_PATHS.result_report] === reportFile.sha256, "result report hash differs from the result receipt");
  invariant(isDeepStrictEqual(receipt.frozen_inputs, frozen.hashes), "result receipt frozen-input manifest mismatch");
  invariant(resultFile.payload.equals(bundle.resultJson), "stored result JSON differs from a fresh frozen-input reproduction");
  invariant(reportFile.payload.equals(bundle.report), "stored report differs from a fresh frozen-input reproduction");
  invariant(receipt.published_bundle_verified === bundle.result.published_bundle_verification.verified, "result receipt verification disposition mismatch");
  return Object.freeze({ verified: true, receipt, result: bundle.result });
}

function validateAegisRunClaim(claim, frozenHashes) {
  invariant(claim?.schema_version === AEGIS_AUXILIARY_RUN_CLAIM_SCHEMA,
    "AEGIS-Q run-claim schema mismatch");
  invariant(claim?.status === "claimed_before_first_official_aegis_q_auxiliary_computation",
    "AEGIS-Q run-claim status mismatch");
  invariant(claim?.official_runner_results_seen_before_claim === false,
    "AEGIS-Q run claim says official-run results were seen");
  invariant(claim?.known_output_files_absent_before_claim === true,
    "AEGIS-Q run claim omits output-absence attestation");
  invariant(claim?.published_target_metrics_known_before_claim === true,
    "AEGIS-Q run claim does not acknowledge the already published target");
  invariant(claim?.process_attestation_boundary === AEGIS_PROCESS_ATTESTATION,
    "AEGIS-Q run-claim process boundary mismatch");
  invariant(isDeepStrictEqual(claim?.claim_boundary, AEGIS_AUXILIARY_CLAIM_BOUNDARY),
    "AEGIS-Q run claim does not preserve the exact auxiliary boundary");
  invariant(isDeepStrictEqual(claim?.frozen_inputs, frozenHashes),
    "AEGIS-Q run claim does not bind the frozen inputs");
  invariant(typeof claim?.generated_at === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(claim.generated_at)
      && new Date(claim.generated_at).toISOString() === claim.generated_at,
  "AEGIS-Q run-claim timestamp is invalid");
  return claim;
}

async function readAegisRunClaim(projectRoot, frozenHashes) {
  const claimFile = await readAndHash(projectRoot, AEGIS_AUXILIARY_PATHS.run_claim);
  const claim = JSON.parse(claimFile.payload.toString("utf8"));
  validateAegisRunClaim(claim, frozenHashes);
  return Object.freeze({
    claim,
    payload: claimFile.payload,
    sha256: claimFile.sha256,
  });
}

async function assertAegisOutputsAbsent(projectRoot) {
  const existing = [];
  for (const relativePath of [
    AEGIS_AUXILIARY_PATHS.result_json,
    AEGIS_AUXILIARY_PATHS.result_report,
    AEGIS_AUXILIARY_PATHS.result_receipt,
  ]) {
    if (await exists(resolveLocal(projectRoot, relativePath, relativePath))) existing.push(relativePath);
  }
  invariant(existing.length === 0,
    `AEGIS-Q output exists without a run claim; audit before continuing: ${existing.join(", ")}`);
}

async function createAegisRunClaim(projectRoot, frozenHashes) {
  const claim = Object.freeze({
    schema_version: AEGIS_AUXILIARY_RUN_CLAIM_SCHEMA,
    status: "claimed_before_first_official_aegis_q_auxiliary_computation",
    generated_at: new Date().toISOString(),
    official_runner_results_seen_before_claim: false,
    known_output_files_absent_before_claim: true,
    published_target_metrics_known_before_claim: true,
    process_attestation_boundary: AEGIS_PROCESS_ATTESTATION,
    claim_boundary: AEGIS_AUXILIARY_CLAIM_BOUNDARY,
    frozen_inputs: frozenHashes,
    recovery_boundary: "Repeated official invocations may only complete missing artifacts or verify byte-identical artifacts bound to this claim. They never replace conflicting bytes.",
  });
  const payload = jsonBytes(claim);
  const path = resolveLocal(projectRoot, AEGIS_AUXILIARY_PATHS.run_claim,
    "AEGIS-Q run claim");
  const status = await writeAegisArtifactOnceOrVerify(path, payload, "AEGIS-Q run claim");
  invariant(status === "created", "AEGIS-Q run claim appeared during exclusive claim creation");
  return Object.freeze({ claim, payload, sha256: sha256(payload) });
}

async function loadOrCreateAegisRunClaim(projectRoot, frozen, { verifyExisting }) {
  const claimPath = resolveLocal(projectRoot, AEGIS_AUXILIARY_PATHS.run_claim,
    "AEGIS-Q run claim");
  if (await exists(claimPath)) return readAegisRunClaim(projectRoot, frozen.hashes);
  invariant(!verifyExisting, "cannot verify AEGIS-Q artifacts without a persisted run claim");
  await assertAegisOutputsAbsent(projectRoot);
  return createAegisRunClaim(projectRoot, frozen.hashes);
}

export async function runAegisAuxiliary({
  projectRoot = defaultProjectRoot,
  verifyExisting = false,
} = {}) {
  return withExclusiveAegisRunLock({ projectRoot }, async () => {
    // Hash and schema validation may run before the claim, but the reproduction
    // simulation itself cannot begin until the claim is durably persisted.
    const frozen = await loadFrozenAegisAuxiliaryInputs({ projectRoot });
    const runClaim = await loadOrCreateAegisRunClaim(projectRoot, frozen, { verifyExisting });
    const claimedFrozen = Object.freeze({
      ...frozen,
      hashes: Object.freeze({
        ...frozen.hashes,
        run_claim_sha256: runClaim.sha256,
      }),
    });
    const bundle = buildAegisAuxiliaryArtifacts({
      protocol: claimedFrozen.protocol,
      panelDocument: claimedFrozen.panelDocument,
      frozenInputHashes: claimedFrozen.hashes,
    });
    if (verifyExisting) {
      return verifyExistingAegisAuxiliaryArtifacts({
        projectRoot,
        bundle,
        frozen: claimedFrozen,
      });
    }
    const written = await writeAegisAuxiliaryArtifactsOnce({
      projectRoot,
      bundle,
      frozen: claimedFrozen,
      createdAt: runClaim.claim.generated_at,
    });
    return Object.freeze({
      written: true,
      write_statuses: written.statuses,
      receipt: written.receipt,
      result: bundle.result,
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  invariant(
    args.length <= 1 && (args.length === 0 || args[0] === "--verify-existing"),
    "usage: node research/run_aegis_q_legacy_reproduction.mjs [--verify-existing]",
  );
  const response = await runAegisAuxiliary({ verifyExisting: args[0] === "--verify-existing" });
  const verified = response.result.published_bundle_verification.verified;
  process.stdout.write(`${JSON.stringify({
    mode: args[0] === "--verify-existing" ? "verify-existing" : "first-run",
    artifact_integrity_verified: response.verified ?? response.written,
    published_bundle_verified: verified,
    status: response.result.status,
  }, null, 2)}\n`);
  if (!verified) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
