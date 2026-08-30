import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { round } from "./champion_engine.mjs";
import { CORE_SYMBOLS } from "./champion_strategies.mjs";
import {
  createGeneration5Strategies,
  GENERATION5_METADATA,
  GENERATION5_REQUIRED_SYMBOLS,
} from "./champion_strategies_generation5.mjs";
import {
  GENERATION5_BASE_OPTIONS,
  GENERATION5_CANDIDATE_IDS,
} from "./run_quant_champion_generation5.mjs";
import {
  AlpacaGeneration5ReconciliationClient,
  buildGeneration5SourceReconciliation,
  generation5CredentialsFromEnvironment,
  GENERATION5_SOURCE_SIMULATION_OPTIONS,
  GENERATION5_SOURCE_SYMBOLS,
  GENERATION5_SOURCE_THRESHOLDS,
} from "./source_overlap_reconciliation_generation5.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const protocolPath = resolve(projectRoot, "research/source_overlap_reconciliation_generation5_protocol.json");
const freezeReceiptPath = resolve(projectRoot, "research/source_overlap_reconciliation_generation5_freeze_receipt.json");
const generation4OutputPath = resolve(projectRoot, "research/output/quant_champion_generation4.json");
const outputPath = resolve(projectRoot, "research/output/source_overlap_reconciliation_generation5.json");
const reportPath = resolve(projectRoot, "research/output/source_overlap_reconciliation_generation5_report.md");
export const SOURCE_FREEZE_REQUIRED_FILES = Object.freeze([
  "research/source_overlap_reconciliation_generation5_protocol.json",
  "research/source_overlap_reconciliation_generation5.mjs",
  "research/run_source_overlap_reconciliation_generation5.mjs",
  "tests/source_overlap_reconciliation_generation5.test.mjs",
]);
export const GENERATION5_FREEZE_REQUIRED_FILES = Object.freeze([
  "research/champion_search_generation5_protocol.json",
  "research/champion_trial_ledger_generation5.json",
  "research/champion_engine.mjs",
  "research/champion_strategies.mjs",
  "research/champion_strategies_generation4.mjs",
  "research/champion_strategies_generation5.mjs",
  "research/run_quant_champion_generation5.mjs",
  "research/champion_statistics.mjs",
  "tests/champion_engine.test.mjs",
  "tests/champion_generation4.test.mjs",
  "tests/champion_generation5.test.mjs",
  "tests/champion_statistics.test.mjs",
  "research/champion_search_generation4_protocol.json",
  "research/champion_trial_ledger_generation4.json",
  "research/output/quant_champion_generation4.json",
  "data/private/champion_search/generation4_panel_91a53ac73e785d2ccb8db043cce6d808b9a851d7e95da7031bb227e8b40d1014.json",
]);
export const GENERATION5_LOCK_REQUIRED_FILES = Object.freeze([
  ...GENERATION5_FREEZE_REQUIRED_FILES,
  "research/champion_search_generation5_freeze_receipt.json",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function hasExactManifestKeys(object, required) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return false;
  return JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...required].sort());
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function redact(message, secrets) {
  let safe = String(message ?? "unknown Generation 5 source-reconciliation error");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) safe = safe.split(secret).join("[REDACTED]");
  }
  return safe;
}

function formatNumber(value, places = 4) {
  return Number.isFinite(value) ? value.toFixed(places) : "n/a";
}

function renderMarkdown(report) {
  const symbolRows = Object.values(report.reconciliation.per_symbol).map((item) => {
    const metrics = item.primary_log_return_metrics;
    const correlationOrBilMean = item.symbol === "BIL"
      ? `${formatNumber(metrics.annualized_mean_log_return_difference_bps, 2)} bp/yr mean gap`
      : formatNumber(metrics.daily_log_return_correlation, 5);
    return `| ${item.symbol} | ${item.common_sessions} | ${(100 * item.yahoo_coverage_of_alpaca_dates).toFixed(2)}% | ${correlationOrBilMean} | ${(100 * metrics.annualized_log_return_tracking_error).toFixed(3)}% | ${formatNumber(metrics.median_absolute_daily_log_return_difference_bps, 2)} | ${formatNumber(metrics.p99_absolute_daily_log_return_difference_bps, 2)} | ${item.passed ? "PASS" : "FAIL"} |`;
  }).join("\n");
  const candidateRows = Object.values(report.reconciliation.candidate_comparison.candidates).map((item) => (
    `| ${item.id} | ${(100 * item.decision_comparison.exact_decision_agreement_fraction).toFixed(2)}% | ${formatNumber(item.return_comparison.daily_log_return_correlation, 6)} | ${(100 * item.return_comparison.annualized_log_return_tracking_error).toFixed(3)}% | ${formatNumber(item.candidate_vs_spy_edge.absolute_edge_difference_bps_per_year, 2)} | ${item.passed ? "PASS" : "FAIL"} |`
  )).join("\n");
  const reasons = report.reconciliation.blocking_reasons.length > 0
    ? report.reconciliation.blocking_reasons.join("; ")
    : "No frozen gate failed.";
  return `# Generation 5 authenticated source reconciliation v2

Protocol: \`${report.protocol_sha256}\`
Freeze receipt: \`${report.freeze_receipt_sha256}\`

## Answer first

**${report.disposition}** as of ${report.generated_at}. The protocol was designed after the Generation 4 \`FAIL_CLOSED\` result was observed. It compares already-seen history and is not fresh out-of-sample evidence.

## Primary per-symbol comparison

The primary source-concordance comparison is the stored Generation 4 Yahoo adjusted-close panel versus fresh authenticated Alpaca IEX \`adjustment=all\` daily closes. No session is excluded based on \`all\` versus \`split\` differences.

| Symbol | Common sessions | Yahoo coverage of Alpaca dates | Daily correlation / BIL mean gap | Tracking error | Median gap (bp) | P99 gap (bp) | Result |
|---|---:|---:|---:|---:|---:|---:|---|
${symbolRows}

BIL uses its separately frozen near-zero-return gates and has no correlation requirement.

## Every eligible Generation 5 candidate

| Candidate | Exact canonical decision agreement | Daily return correlation | Tracking error | Edge difference vs SPY | Result |
|---|---:|---:|---:|---:|---|
${candidateRows}

The full decision vector is rounded to the engine's canonical ten decimal places before exact comparison. Every eligible candidate must pass every candidate gate, and every one of the 20 symbols must pass its own primary gate family.

## Split-adjusted diagnostic boundary

Alpaca IEX \`adjustment=split\` is retained only as a disclosed diagnostic. Alpaca documents \`split\` as forward/reverse split adjustment and \`all\` as split, cash-dividend, and spin-off adjustment. Split/all differences are not classified as corporate-action dates and do not remove any observation. IEX is Investors Exchange, one exchange rather than the consolidated SIP feed.

Official Alpaca references: [historical bars](https://docs.alpaca.markets/us/reference/stockbars), [IEX versus SIP](https://docs.alpaca.markets/us/docs/market-data-faq).

## Decision boundary

${reasons}

Even a pass supports only source concordance over authenticated overlap. It does not prove future profitability, independent alpha, or permission for live capital.
`;
}

async function verifyFreezeReceipt(protocolRaw) {
  const freezeRaw = await readFile(freezeReceiptPath, "utf8");
  const freeze = JSON.parse(freezeRaw);
  invariant(freeze.schema_version === "finly_source_overlap_reconciliation_generation5_freeze_receipt.v2", "source freeze schema mismatch");
  invariant(freeze.frozen_before_authenticated_read === true, "source freeze does not predate authenticated read by declaration");
  invariant(freeze.authenticated_result_seen_at_freeze === false, "source freeze says an authenticated result was seen");
  invariant(freeze.authenticated_output_absent_at_freeze === true, "source freeze does not declare authenticated output absence");
  invariant(freeze.generation5_results_seen_at_source_freeze === false, "source freeze says Generation 5 results were seen");
  invariant(freeze.generation5_output_absent_at_source_freeze === true, "source freeze does not declare Generation 5 output absence");
  invariant(hasExactManifestKeys(freeze.files, SOURCE_FREEZE_REQUIRED_FILES), "source freeze manifest is incomplete or contains unexpected files");
  for (const [relativePath, expectedHash] of Object.entries(freeze.files ?? {})) {
    const payload = await readFile(resolve(projectRoot, relativePath));
    invariant(sha256(payload) === expectedHash, `source freeze hash mismatch for ${relativePath}`);
  }
  invariant(freeze.files?.["research/source_overlap_reconciliation_generation5_protocol.json"] === sha256(protocolRaw), "protocol hash differs from source freeze receipt");
  return Object.freeze({ freeze, raw: freezeRaw });
}

async function loadAndVerifyInputs() {
  const protocolRaw = await readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw);
  invariant(protocol.schema_version === "finly_source_overlap_reconciliation_generation5_protocol.v2", "source protocol schema mismatch");
  invariant(protocol.status === "FROZEN_BEFORE_AUTHENTICATED_READ", "source protocol is not frozen");
  invariant(protocol.designed_after_generation4_fail_closed === true, "post-Generation-4 design disclosure is missing");
  invariant(protocol.generation5_lock.results_seen_at_source_protocol_freeze === false, "source protocol says Generation 5 results were seen");
  invariant(protocol.generation5_lock.outcome_output_absent_at_source_protocol_freeze === true, "source protocol does not declare Generation 5 output absence");
  invariant(JSON.stringify(protocol.symbols) === JSON.stringify(GENERATION5_SOURCE_SYMBOLS), "source protocol symbol order mismatch");
  invariant(JSON.stringify(GENERATION5_REQUIRED_SYMBOLS) === JSON.stringify(CORE_SYMBOLS), "Generation 5 required symbols differ from CORE_SYMBOLS");
  invariant(JSON.stringify(protocol.generation5_lock.eligible_candidate_ids) === JSON.stringify(GENERATION5_CANDIDATE_IDS), "eligible candidate registry mismatch");
  invariant(JSON.stringify(protocol.simulation_options) === JSON.stringify(GENERATION5_BASE_OPTIONS), "Generation 5 simulation options mismatch");
  invariant(JSON.stringify(protocol.simulation_options) === JSON.stringify(GENERATION5_SOURCE_SIMULATION_OPTIONS), "source module simulation options mismatch");
  invariant(JSON.stringify(protocol.pass_thresholds) === JSON.stringify(GENERATION5_SOURCE_THRESHOLDS), "source protocol thresholds mismatch");
  invariant(hasExactManifestKeys(protocol.generation5_lock.files, GENERATION5_LOCK_REQUIRED_FILES), "Generation 5 integration manifest is incomplete or contains unexpected files");

  const verifiedFreeze = await verifyFreezeReceipt(protocolRaw);
  invariant(
    verifiedFreeze.freeze.generation5_freeze_receipt_sha256
      === protocol.generation5_lock.files["research/champion_search_generation5_freeze_receipt.json"],
    "source freeze and protocol disagree on the Generation 5 freeze receipt hash",
  );
  for (const [relativePath, expectedHash] of Object.entries(protocol.generation5_lock.files ?? {})) {
    const payload = await readFile(resolve(projectRoot, relativePath));
    invariant(sha256(payload) === expectedHash, `Generation 5 integration hash mismatch for ${relativePath}`);
  }
  const generation5FreezeRaw = await readFile(resolve(projectRoot, "research/champion_search_generation5_freeze_receipt.json"), "utf8");
  const generation5Freeze = JSON.parse(generation5FreezeRaw);
  invariant(generation5Freeze.schema_version === "finly_champion_search_generation5_freeze_receipt.v1", "Generation 5 freeze schema mismatch");
  invariant(generation5Freeze.generation_5_results_seen_at_freeze === false, "Generation 5 freeze says results were seen");
  invariant(generation5Freeze.generation_5_output_absent_at_freeze === true, "Generation 5 freeze does not declare output absence");
  invariant(hasExactManifestKeys(generation5Freeze.files, GENERATION5_FREEZE_REQUIRED_FILES), "Generation 5 freeze manifest is incomplete or contains unexpected files");
  for (const [relativePath, expectedHash] of Object.entries(generation5Freeze.files)) {
    invariant(protocol.generation5_lock.files[relativePath] === expectedHash, `source protocol and Generation 5 freeze disagree for ${relativePath}`);
  }
  const generation4Raw = await readFile(generation4OutputPath, "utf8");
  invariant(sha256(generation4Raw) === protocol.generation4_lock.generation4_output_sha256, "Generation 4 output hash mismatch");
  const generation4 = JSON.parse(generation4Raw);
  invariant(generation4.dataset?.normalized_panel_sha256 === protocol.generation4_lock.normalized_panel_sha256, "Generation 4 normalized panel hash mismatch");
  invariant(generation4.dataset?.private_panel_payload_sha256 === protocol.generation4_lock.private_panel_payload_sha256, "Generation 4 private panel hash declaration mismatch");
  const panelFilename = generation4.dataset?.private_panel_filename;
  invariant(typeof panelFilename === "string" && /^generation4_panel_[a-f0-9]{64}\.json$/.test(panelFilename), "Generation 4 private panel filename is invalid");
  const panelPath = resolve(projectRoot, "data/private/champion_search", panelFilename);
  const panelRaw = await readFile(panelPath, "utf8");
  invariant(sha256(panelRaw) === protocol.generation4_lock.private_panel_payload_sha256, "Generation 4 private panel payload hash mismatch");
  const panel = JSON.parse(panelRaw);
  invariant(Array.isArray(panel.points) && panel.points.length === protocol.generation4_lock.common_sessions, "Generation 4 panel row count mismatch");
  const normalized = sha256(JSON.stringify(panel.points.map((point) => [
    point.date,
    ...CORE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
  ])));
  invariant(normalized === protocol.generation4_lock.normalized_panel_sha256, "Generation 4 normalized panel hash cannot be reproduced");
  invariant(panel.points[0].date === protocol.dates.requested_start, "source protocol start differs from panel");
  invariant(panel.points.at(-1).date === protocol.dates.requested_end, "source protocol end differs from panel");
  let priorDate = "";
  for (const point of panel.points) {
    invariant(typeof point.date === "string" && point.date > priorDate, "Generation 4 panel dates are not strictly increasing");
    priorDate = point.date;
    for (const symbol of CORE_SYMBOLS) invariant(Number.isFinite(point[symbol]) && point[symbol] > 0, `invalid ${symbol} panel value at ${point.date}`);
  }
  return Object.freeze({
    protocol,
    protocolRaw,
    freeze: verifiedFreeze.freeze,
    freezeRaw: verifiedFreeze.raw,
    generation4Raw,
    panel,
  });
}

const credentials = generation5CredentialsFromEnvironment();
const secrets = [credentials.keyId, credentials.secretKey];

async function run() {
  const frozen = await loadAndVerifyInputs();
  const yahooSeriesBySymbol = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [
    symbol,
    frozen.panel.points.map((point) => ({ date: point.date, close: point[symbol] })),
  ]));
  const client = new AlpacaGeneration5ReconciliationClient({ ...credentials });
  const authenticatedReadStartedAt = new Date().toISOString();
  const all = await client.getDailyBars(CORE_SYMBOLS, {
    start: frozen.protocol.dates.requested_start,
    end: frozen.protocol.dates.requested_end,
    feed: "iex",
    adjustment: "all",
  });
  const split = await client.getDailyBars(CORE_SYMBOLS, {
    start: frozen.protocol.dates.requested_start,
    end: frozen.protocol.dates.requested_end,
    feed: "iex",
    adjustment: "split",
  });
  const authenticatedReadCompletedAt = new Date().toISOString();
  const reconciliation = buildGeneration5SourceReconciliation({
    yahooSeriesBySymbol,
    alpacaAllSeriesBySymbol: all.series_by_symbol,
    alpacaSplitSeriesBySymbol: split.series_by_symbol,
    createStrategies: createGeneration5Strategies,
    metadata: GENERATION5_METADATA,
    eligibleCandidateIds: GENERATION5_CANDIDATE_IDS,
    thresholds: frozen.protocol.pass_thresholds,
    simulationOptions: frozen.protocol.simulation_options,
  });
  const report = Object.freeze({
    schema_version: "finly_generation5_source_overlap_reconciliation.v2",
    generated_at: new Date().toISOString(),
    authenticated_read_started_at: authenticatedReadStartedAt,
    authenticated_read_completed_at: authenticatedReadCompletedAt,
    disposition: reconciliation.passed ? "PASS_SOURCE_RECONCILIATION" : "FAIL_CLOSED",
    protocol_sha256: sha256(frozen.protocolRaw),
    freeze_receipt_sha256: sha256(frozen.freezeRaw),
    generation4_output_sha256: sha256(frozen.generation4Raw),
    generation4_panel_sha256: frozen.protocol.generation4_lock.normalized_panel_sha256,
    generation4_private_panel_payload_sha256: frozen.protocol.generation4_lock.private_panel_payload_sha256,
    generation5_lock: frozen.protocol.generation5_lock,
    stored_yahoo_source: Object.freeze({
      provider: "Yahoo Finance chart endpoint",
      field: "chart.result[0].indicators.adjclose[0].adjclose",
      snapshot: "exact hash-pinned Generation 4 private panel",
      start: frozen.protocol.dates.requested_start,
      end: frozen.protocol.dates.requested_end,
    }),
    alpaca_all_source: all.provenance,
    alpaca_split_source: split.provenance,
    reconciliation,
    limitations: Object.freeze([
      "This v2 protocol was designed after the Generation 4 source-reconciliation failure was observed and is not fresh out-of-sample evidence.",
      "The primary series are Yahoo adjusted close and Alpaca IEX adjustment=all; provider adjustment and market-close construction can still differ.",
      "IEX represents one exchange rather than consolidated SIP data.",
      "Alpaca adjustment=split is diagnostic only; no split/all difference removes a primary observation.",
      "Both providers can revise historical adjusted data; only the Yahoo Generation 4 snapshot is immutable here.",
      "A pass cannot prove future profitability or eliminate universe-selection, survivorship, growth-tilt, or multiple-testing bias.",
    ]),
  });
  await atomicWrite(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(reportPath, renderMarkdown(report));
  process.stdout.write(`${JSON.stringify({
    ok: reconciliation.passed,
    disposition: report.disposition,
    symbols: CORE_SYMBOLS.length,
    eligible_candidates: GENERATION5_CANDIDATE_IDS.length,
    output: outputPath,
    report: reportPath,
  }, null, 2)}\n`);
  if (!reconciliation.passed) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  run().catch(async (error) => {
    const message = redact(error?.message, secrets);
    const failure = Object.freeze({
      schema_version: "finly_generation5_source_overlap_reconciliation.v2",
      generated_at: new Date().toISOString(),
      disposition: "FAIL_CLOSED",
      execution_error: message,
      blocking_reasons: Object.freeze(["Generation 5 source reconciliation did not complete"]),
    });
    await atomicWrite(outputPath, `${JSON.stringify(failure, null, 2)}\n`);
    await atomicWrite(reportPath, `# Generation 5 authenticated source reconciliation v2\n\n**FAIL_CLOSED**: ${message}\n`);
    process.stderr.write(`Generation 5 source reconciliation failed closed: ${message}\n`);
    process.exitCode = 1;
  });
}
