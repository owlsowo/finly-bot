import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { round, sha256 } from "./champion_engine.mjs";
import {
  validateStoredGeneration6AlpacaPanel,
} from "./persist_alpaca_adjustment_all_panel_generation6.mjs";
import {
  createGeneration6Strategies,
  GENERATION6_CANDIDATE_IDS,
  GENERATION6_METADATA,
} from "./champion_strategies_generation6.mjs";
import {
  assertGeneration6PriceSeries,
  buildGeneration6SourceReconciliation,
  generation6SeriesBySymbolFromPoints,
  GENERATION6_SOURCE_SIMULATION_OPTIONS,
  GENERATION6_SOURCE_SERIES_CONTRACT,
  GENERATION6_SOURCE_SYMBOLS,
  GENERATION6_SOURCE_THRESHOLDS,
} from "./source_overlap_reconciliation_generation6.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const protocolPath = resolve(projectRoot, "research/source_overlap_reconciliation_generation6_protocol.json");
const freezeReceiptPath = resolve(projectRoot, "research/source_overlap_reconciliation_generation6_freeze_receipt.json");
const outputPath = resolve(projectRoot, "research/output/source_overlap_reconciliation_generation6.json");
const reportPath = resolve(projectRoot, "research/output/source_overlap_reconciliation_generation6_report.md");
const resultReceiptPath = resolve(projectRoot, "research/source_overlap_reconciliation_generation6_result_receipt.json");

export const GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA =
  "finly_generation6_alpaca_adjustment_all_panel.v2";

export const GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS = Object.freeze([
  "research/output/source_overlap_reconciliation_generation6.json",
  "research/output/source_overlap_reconciliation_generation6_report.md",
  "research/source_overlap_reconciliation_generation6_result_receipt.json",
]);

export const GENERATION6_SOURCE_FREEZE_REQUIRED_FILES = Object.freeze([
  "research/source_overlap_reconciliation_generation6_protocol.json",
  "research/source_overlap_reconciliation_generation6.mjs",
  "research/run_source_overlap_reconciliation_generation6.mjs",
  "tests/source_overlap_reconciliation_generation6.test.mjs",
  "research/champion_engine.mjs",
  "research/champion_strategies.mjs",
  "research/champion_strategies_generation6.mjs",
  "research/source_overlap_reconciliation_generation5.mjs",
  "research/persist_alpaca_adjustment_all_panel_generation6.mjs",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256Bytes(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function orderedEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasExactOrderedKeys(object, keys) {
  return object && typeof object === "object" && !Array.isArray(object)
    && orderedEqual(Object.keys(object), keys);
}

export function generation6AlpacaSeriesIntegrity(symbol, series) {
  assertGeneration6PriceSeries(symbol, series, "persisted Alpaca v2 raw per-symbol series");
  return Object.freeze({
    observations: series.length,
    start_date: series[0].date,
    end_date: series.at(-1).date,
    date_sha256: sha256(series.map((point) => point.date)),
    series_sha256: sha256(series.map((point) => [point.date, round(point.close, 10)])),
  });
}

export function generation6AlpacaSeriesIntegrityBySymbol(seriesBySymbol) {
  invariant(hasExactOrderedKeys(seriesBySymbol, GENERATION6_SOURCE_SYMBOLS),
    "Alpaca v2 series_by_symbol keys must exactly follow CORE_SYMBOLS order");
  return Object.freeze(Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol) => [
    symbol,
    generation6AlpacaSeriesIntegrity(symbol, seriesBySymbol[symbol]),
  ])));
}

export function generation6AlpacaSeriesIntegritySha256(seriesIntegrityBySymbol) {
  invariant(hasExactOrderedKeys(seriesIntegrityBySymbol, GENERATION6_SOURCE_SYMBOLS),
    "Alpaca v2 series-integrity keys must exactly follow CORE_SYMBOLS order");
  for (const symbol of GENERATION6_SOURCE_SYMBOLS) {
    const item = seriesIntegrityBySymbol[symbol];
    invariant(Number.isSafeInteger(item?.observations) && item.observations > 0,
      `${symbol} Alpaca v2 integrity observation count is invalid`);
    invariant(typeof item?.start_date === "string" && typeof item?.end_date === "string",
      `${symbol} Alpaca v2 integrity date boundary is invalid`);
    invariant(isSha256(item?.date_sha256) && isSha256(item?.series_sha256),
      `${symbol} Alpaca v2 integrity hash is invalid`);
  }
  return sha256(seriesIntegrityBySymbol);
}

export function hasExactManifestKeys(object, required) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return false;
  return jsonEqual(Object.keys(object).sort(), [...required].sort());
}

function inputDescriptor(protocol, id) {
  return protocol?.frozen_inputs?.[id] ?? null;
}

export function validateGeneration6SourceProtocol(protocol) {
  const reasons = [];
  if (protocol?.schema_version !== "finly_source_overlap_reconciliation_generation6_protocol.v1") {
    reasons.push("protocol schema mismatch");
  }
  if (protocol?.status !== "FROZEN_BEFORE_FIRST_GENERATION6_SOURCE_RUN") reasons.push("protocol status is not frozen");
  if (protocol?.execution_status_at_freeze?.results_seen !== false) reasons.push("protocol says source results were seen");
  if (protocol?.execution_status_at_freeze?.all_outputs_absent !== true) reasons.push("protocol does not attest output absence");
  if (protocol?.security?.runner_network_permitted !== false) reasons.push("protocol permits runner network access");
  if (!orderedEqual(protocol?.symbols, GENERATION6_SOURCE_SYMBOLS)) reasons.push("protocol symbols differ from CORE_SYMBOLS");
  if (protocol?.overall_gate?.scope
      !== "ALL_20_CORE_SYMBOLS_INCLUDING_CANDIDATE_AND_COMPARATOR_INPUTS") {
    reasons.push("protocol overall gate does not cover candidate and comparator inputs");
  }
  if (!orderedEqual(protocol?.overall_gate?.required_symbols, GENERATION6_SOURCE_SYMBOLS)
      || protocol?.overall_gate?.every_required_symbol_must_pass !== true) {
    reasons.push("protocol overall gate does not require every CORE symbol to pass");
  }
  if (!jsonEqual(protocol?.pass_thresholds, GENERATION6_SOURCE_THRESHOLDS)) reasons.push("protocol thresholds differ from executable constants");
  if (!jsonEqual(protocol?.simulation_options, GENERATION6_SOURCE_SIMULATION_OPTIONS)) {
    reasons.push("protocol simulation options differ from executable constants");
  }
  if (!jsonEqual(protocol?.source_series_contract, GENERATION6_SOURCE_SERIES_CONTRACT)) {
    reasons.push("protocol source-series contract differs from executable constants");
  }
  if (protocol?.prior_generation5_boundary?.inherit_overall_disposition !== false) {
    reasons.push("protocol does not explicitly forbid inheritance of Generation 5 disposition");
  }
  if (typeof protocol?.prior_generation5_boundary?.reason !== "string"
    || !protocol.prior_generation5_boundary.reason.includes("different candidate")) {
    reasons.push("protocol omits the different-candidate Generation 5 boundary");
  }
  const selection = inputDescriptor(protocol, "generation6_selection_output");
  const yahoo = inputDescriptor(protocol, "yahoo_generation4_panel");
  const alpaca = inputDescriptor(protocol, "alpaca_adjustment_all_panel");
  for (const [id, descriptor] of Object.entries({ selection, yahoo, alpaca })) {
    if (!descriptor || typeof descriptor.path !== "string" || !isSha256(descriptor.payload_sha256)) {
      reasons.push(`${id} descriptor is missing a path or payload hash`);
    }
  }
  if (selection?.schema_version !== "finly_quant_champion_generation6.v1") {
    reasons.push("selection-output schema declaration mismatch");
  }
  if (yahoo?.role !== "hash_pinned_generation4_yahoo_adjusted_close") {
    reasons.push("Yahoo panel role declaration mismatch");
  }
  if (!isSha256(yahoo?.normalized_panel_sha256)) reasons.push("Yahoo panel normalized hash is invalid");
  if (alpaca?.role !== "separately_persisted_hash_pinned_alpaca_adjustment_all") {
    reasons.push("Alpaca panel role declaration mismatch");
  }
  if (alpaca?.adjustment !== "all") reasons.push("Alpaca panel is not declared adjustment=all");
  if (alpaca?.schema_version !== GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA) {
    reasons.push("Alpaca panel must use the lossless v2 schema");
  }
  if (!hasExactOrderedKeys(alpaca?.series_integrity_by_symbol, GENERATION6_SOURCE_SYMBOLS)) {
    reasons.push("Alpaca panel descriptor does not bind every ordered raw per-symbol integrity record");
  } else {
    const expectedIntegrityKeys = [
      "observations",
      "start_date",
      "end_date",
      "date_sha256",
      "series_sha256",
    ];
    for (const symbol of GENERATION6_SOURCE_SYMBOLS) {
      const item = alpaca.series_integrity_by_symbol[symbol];
      if (!item || !orderedEqual(Object.keys(item), expectedIntegrityKeys)
          || !Number.isSafeInteger(item.observations) || item.observations <= 0
          || typeof item.start_date !== "string" || typeof item.end_date !== "string"
          || item.start_date > item.end_date
          || !isSha256(item.date_sha256) || !isSha256(item.series_sha256)) {
        reasons.push(`Alpaca panel descriptor has invalid raw-series integrity for ${symbol}`);
      }
    }
    try {
      if (generation6AlpacaSeriesIntegritySha256(alpaca.series_integrity_by_symbol)
          !== alpaca.series_integrity_sha256) {
        reasons.push("Alpaca panel raw-series integrity hash is invalid");
      }
    } catch (error) {
      reasons.push(`Alpaca panel raw-series manifest is invalid: ${error.message}`);
    }
  }
  if (!isSha256(alpaca?.series_integrity_sha256)) {
    reasons.push("Alpaca panel raw-series integrity hash is missing");
  }
  if (!isSha256(alpaca?.strategy_intersection_normalized_panel_sha256)) {
    reasons.push("Alpaca panel strategy-intersection normalized hash is invalid");
  }
  if (!orderedEqual(protocol?.output_paths, GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS)) {
    reasons.push("protocol output paths differ from immutable runner paths");
  }
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function validateGeneration6SourceFreezeReceipt(freezeReceipt, protocolRaw) {
  const reasons = [];
  if (freezeReceipt?.schema_version !== "finly_source_overlap_reconciliation_generation6_freeze_receipt.v1") {
    reasons.push("freeze-receipt schema mismatch");
  }
  if (freezeReceipt?.frozen_before_first_source_run !== true) reasons.push("freeze receipt is not pre-run");
  if (freezeReceipt?.source_results_seen_at_freeze !== false) reasons.push("freeze receipt says source results were seen");
  if (freezeReceipt?.all_source_outputs_absent_at_freeze !== true) reasons.push("freeze receipt omits output-absence attestation");
  if (freezeReceipt?.runner_network_permitted !== false) reasons.push("freeze receipt permits runner network access");
  if (!hasExactManifestKeys(freezeReceipt?.files, GENERATION6_SOURCE_FREEZE_REQUIRED_FILES)) {
    reasons.push("freeze receipt has an incomplete or expanded file manifest");
  }
  if (freezeReceipt?.files?.["research/source_overlap_reconciliation_generation6_protocol.json"]
    !== sha256Bytes(protocolRaw)) {
    reasons.push("freeze receipt does not bind the protocol bytes");
  }
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function safeProjectPath(relativePath, label) {
  invariant(typeof relativePath === "string" && relativePath.length > 0, `${label} path is invalid`);
  const absolute = resolve(projectRoot, relativePath);
  invariant(absolute.startsWith(`${projectRoot}${sep}`), `${label} path escapes the project root`);
  return absolute;
}

async function readHashPinned(descriptor, label) {
  invariant(descriptor && isSha256(descriptor.payload_sha256), `${label} payload hash is invalid`);
  const payload = await readFile(safeProjectPath(descriptor.path, label));
  invariant(sha256Bytes(payload) === descriptor.payload_sha256, `${label} payload hash mismatch`);
  return payload;
}

function normalizedPanelHash(points) {
  return sha256(points.map((point) => [
    point.date,
    ...GENERATION6_SOURCE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
  ]));
}

function validateYahooStoredPanel(panel, descriptor, label) {
  invariant(panel && typeof panel === "object" && !Array.isArray(panel), `${label} payload is invalid`);
  invariant(Array.isArray(panel.points) && panel.points.length > 0, `${label} points are empty`);
  if (descriptor.schema_version) invariant(panel.schema_version === descriptor.schema_version, `${label} schema mismatch`);
  if (Array.isArray(panel.symbols)) invariant(orderedEqual(panel.symbols, GENERATION6_SOURCE_SYMBOLS), `${label} symbols differ`);
  generation6SeriesBySymbolFromPoints(panel.points);
  const normalized = normalizedPanelHash(panel.points);
  invariant(normalized === descriptor.normalized_panel_sha256, `${label} normalized panel hash mismatch`);
  if (panel.normalized_panel_sha256 !== undefined) {
    invariant(panel.normalized_panel_sha256 === normalized, `${label} embedded normalized hash mismatch`);
  }
  return normalized;
}

export function validateGeneration6AlpacaSourcePanelV2(panel, descriptor) {
  const label = "persisted Alpaca adjustment=all v2 panel";
  invariant(panel && typeof panel === "object" && !Array.isArray(panel), `${label} payload is invalid`);
  invariant(panel.schema_version === GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA,
    `${label} schema mismatch; intersection-only v1 panels are forbidden`);
  validateStoredGeneration6AlpacaPanel(panel);
  invariant(descriptor?.schema_version === GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA,
    `${label} descriptor schema mismatch`);
  invariant(orderedEqual(panel.symbols, GENERATION6_SOURCE_SYMBOLS), `${label} symbols differ`);
  invariant(panel.request?.adjustment === "all", `${label} payload is not adjustment=all`);
  invariant(typeof panel.provider === "string" && panel.provider.toLowerCase().includes("alpaca"),
    `${label} provider is not Alpaca`);

  const seriesIntegrityBySymbol = generation6AlpacaSeriesIntegrityBySymbol(panel.series_by_symbol);
  invariant(hasExactOrderedKeys(panel.series_integrity_by_symbol, GENERATION6_SOURCE_SYMBOLS),
    `${label} series_integrity_by_symbol keys differ`);
  invariant(jsonEqual(panel.series_integrity_by_symbol, seriesIntegrityBySymbol),
    `${label} embedded raw per-symbol integrity cannot be reproduced`);
  invariant(jsonEqual(descriptor.series_integrity_by_symbol, seriesIntegrityBySymbol),
    `${label} descriptor raw per-symbol integrity differs`);
  const seriesIntegritySha256 = generation6AlpacaSeriesIntegritySha256(seriesIntegrityBySymbol);
  invariant(descriptor.series_integrity_sha256 === seriesIntegritySha256,
    `${label} descriptor raw-series integrity hash mismatch`);

  const intersection = panel.strategy_intersection;
  invariant(intersection && typeof intersection === "object" && !Array.isArray(intersection),
    `${label} strategy_intersection is absent`);
  invariant(orderedEqual(intersection.symbols, GENERATION6_SOURCE_SYMBOLS),
    `${label} strategy-intersection symbols differ`);
  invariant(Array.isArray(intersection.points) && intersection.points.length > 0,
    `${label} strategy-intersection points are empty`);
  for (const [index, point] of intersection.points.entries()) {
    invariant(orderedEqual(Object.keys(point), ["date", ...GENERATION6_SOURCE_SYMBOLS]),
      `${label} strategy-intersection row ${index} fields differ`);
  }
  const strategySeriesBySymbol = generation6SeriesBySymbolFromPoints(intersection.points);
  invariant(Number.isSafeInteger(intersection.observations)
      && intersection.observations === intersection.points.length,
  `${label} strategy-intersection observation count differs`);
  invariant(intersection.start_date === intersection.points[0].date
      && intersection.end_date === intersection.points.at(-1).date,
  `${label} strategy-intersection date boundary differs`);
  const strategyIntersectionNormalizedSha256 = normalizedPanelHash(intersection.points);
  invariant(intersection.normalized_panel_sha256 === strategyIntersectionNormalizedSha256,
    `${label} embedded strategy-intersection normalized hash mismatch`);
  invariant(descriptor.strategy_intersection_normalized_panel_sha256
      === strategyIntersectionNormalizedSha256,
  `${label} descriptor strategy-intersection normalized hash mismatch`);

  const rawMaps = Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol) => [
    symbol,
    new Map(panel.series_by_symbol[symbol].map((point) => [point.date, point.close])),
  ]));
  const exactIntersectionDates = [...rawMaps[GENERATION6_SOURCE_SYMBOLS[0]].keys()]
    .filter((date) => GENERATION6_SOURCE_SYMBOLS.every((symbol) => rawMaps[symbol].has(date)))
    .sort();
  invariant(orderedEqual(
    intersection.points.map((point) => point.date),
    exactIntersectionDates,
  ), `${label} strategy_intersection is not the exact intersection of raw per-symbol dates`);
  for (const point of intersection.points) {
    for (const symbol of GENERATION6_SOURCE_SYMBOLS) {
      invariant(round(point[symbol], 10) === round(rawMaps[symbol].get(point.date), 10),
        `${label} strategy-intersection ${symbol} close differs from raw series at ${point.date}`);
    }
  }
  return Object.freeze({
    perSymbolSeriesBySymbol: panel.series_by_symbol,
    strategySeriesBySymbol,
    seriesIntegrityBySymbol,
    seriesIntegritySha256,
    strategyIntersectionNormalizedSha256,
  });
}

async function loadAndVerifyInputs() {
  const [protocolRaw, freezeRaw] = await Promise.all([
    readFile(protocolPath),
    readFile(freezeReceiptPath),
  ]);
  const protocol = JSON.parse(protocolRaw.toString("utf8"));
  const freezeReceipt = JSON.parse(freezeRaw.toString("utf8"));
  const protocolValidation = validateGeneration6SourceProtocol(protocol);
  invariant(protocolValidation.passes, `Generation 6 source protocol is invalid: ${protocolValidation.reasons.join("; ")}`);
  const freezeValidation = validateGeneration6SourceFreezeReceipt(freezeReceipt, protocolRaw);
  invariant(freezeValidation.passes, `Generation 6 source freeze receipt is invalid: ${freezeValidation.reasons.join("; ")}`);
  for (const [relativePath, expectedHash] of Object.entries(freezeReceipt.files)) {
    invariant(isSha256(expectedHash), `freeze hash for ${relativePath} is invalid`);
    const payload = await readFile(safeProjectPath(relativePath, `freeze file ${relativePath}`));
    invariant(sha256Bytes(payload) === expectedHash, `freeze file ${relativePath} hash mismatch`);
  }
  const selectionDescriptor = inputDescriptor(protocol, "generation6_selection_output");
  const yahooDescriptor = inputDescriptor(protocol, "yahoo_generation4_panel");
  const alpacaDescriptor = inputDescriptor(protocol, "alpaca_adjustment_all_panel");
  const [selectionRaw, yahooRaw, alpacaRaw] = await Promise.all([
    readHashPinned(selectionDescriptor, "Generation 6 selection output"),
    readHashPinned(yahooDescriptor, "Yahoo Generation 4 panel"),
    readHashPinned(alpacaDescriptor, "persisted Alpaca adjustment=all panel"),
  ]);
  const selectionOutput = JSON.parse(selectionRaw.toString("utf8"));
  const yahooPanel = JSON.parse(yahooRaw.toString("utf8"));
  const alpacaPanel = JSON.parse(alpacaRaw.toString("utf8"));
  invariant(selectionOutput.schema_version === selectionDescriptor.schema_version, "selection-output payload schema mismatch");
  const yahooNormalizedHash = validateYahooStoredPanel(
    yahooPanel,
    yahooDescriptor,
    "Yahoo Generation 4 panel",
  );
  const alpacaValidation = validateGeneration6AlpacaSourcePanelV2(alpacaPanel, alpacaDescriptor);
  return Object.freeze({
    protocol,
    protocolRaw,
    freezeReceipt,
    freezeRaw,
    selectionOutput,
    selectionRaw,
    yahooPanel,
    yahooRaw,
    alpacaPanel,
    alpacaRaw,
    alpacaValidation,
    hashes: Object.freeze({
      protocol_sha256: sha256Bytes(protocolRaw),
      freeze_receipt_sha256: sha256Bytes(freezeRaw),
      generation6_selection_output_sha256: sha256Bytes(selectionRaw),
      yahoo_panel_payload_sha256: sha256Bytes(yahooRaw),
      yahoo_panel_normalized_sha256: yahooNormalizedHash,
      alpaca_all_panel_payload_sha256: sha256Bytes(alpacaRaw),
      alpaca_all_panel_series_integrity_sha256: alpacaValidation.seriesIntegritySha256,
      alpaca_all_panel_strategy_intersection_normalized_sha256:
        alpacaValidation.strategyIntersectionNormalizedSha256,
      alpaca_all_panel_series_integrity_by_symbol: alpacaValidation.seriesIntegrityBySymbol,
    }),
  });
}

function format(value, places = 4) {
  return Number.isFinite(value) ? value.toFixed(places) : "n/a";
}

function renderMarkdown(report) {
  const symbolRows = GENERATION6_SOURCE_SYMBOLS.map((symbol) => {
    const item = report.reconciliation.per_symbol[symbol];
    const metrics = item.primary_log_return_metrics;
    const correlationOrMean = symbol === "BIL"
      ? `${format(metrics.annualized_mean_log_return_difference_bps, 2)} bp/yr mean gap`
      : format(metrics.daily_log_return_correlation, 5);
    return `| ${symbol} | ${item.required_for_selected_candidates_or_spy_bil ? "yes" : "no"} | ${item.common_sessions} | ${correlationOrMean} | ${(100 * metrics.annualized_log_return_tracking_error).toFixed(3)}% | ${item.passed ? "PASS" : "FAIL"} | ${item.blocks_overall_disposition ? "BLOCK" : "no"} |`;
  }).join("\n");
  const candidateRows = report.reconciliation.selection.selected_candidate_ids.map((id) => {
    const item = report.reconciliation.candidate_comparison.candidates[id];
    const state = item.decision_comparison.discrete_or_rank_state;
    const stateValue = state.applicable ? `${(100 * state.exact_agreement_fraction).toFixed(2)}%` : "n/a";
    return `| ${id} | ${stateValue} | ${format(item.decision_comparison.target_weight_l1_difference.mean, 4)} | ${format(item.decision_comparison.target_weight_l1_difference.p99, 4)} | ${format(item.return_comparison.daily_log_return_correlation, 6)} | ${(100 * item.return_comparison.annualized_log_return_tracking_error).toFixed(3)}% | ${format(item.candidate_vs_spy_edge.absolute_edge_difference_bps_per_year, 2)} | ${item.passed ? "PASS" : "FAIL"} |`;
  }).join("\n");
  const reasons = report.reconciliation.blocking_reasons.length > 0
    ? report.reconciliation.blocking_reasons.join("; ")
    : "No required symbol or selected-candidate gate failed.";
  return `# Generation 6 candidate-specific source reconciliation\n\n**${report.disposition}** as of ${report.generated_at}. This runner used only separately persisted, hash-pinned local inputs; it made no market-data request.\n\nPrimary and growth-control winners were deduplicated before simulation: ${report.reconciliation.selection.selected_candidate_ids.map((id) => `\`${id}\``).join(", ")}.\n\n## All 20 source series\n\n| Symbol | Required | Common sessions | Correlation / BIL mean gap | Tracking error | Series result | Overall |\n|---|---|---:|---:|---:|---|---|\n${symbolRows}\n\nEvery CORE symbol is required so selected-candidate and comparator inputs share one fail-closed source gate. Their predicates are the exact Generation 5 per-symbol thresholds.\n\n## Selected-candidate concordance\n\n| Candidate | Exact discrete/rank state | Mean target L1 | P99 target L1 | Return correlation | Tracking error | SPY-edge gap | Result |\n|---|---:|---:|---:|---:|---:|---:|---|\n${candidateRows}\n\nBlocking reasons: ${reasons}\n\n## Boundary\n\nGeneration 5's overall FAIL_CLOSED result is not inherited because it tested different candidates. A Generation 6 pass would establish cross-provider concordance on already-seen history only—not untouched out-of-sample alpha, future profitability, options P&L, or permission for live capital.\n`;
}

export async function computeGeneration6SourceBundle({ generatedAt = new Date().toISOString() } = {}) {
  invariant(Number.isFinite(Date.parse(generatedAt)), "generatedAt must be an ISO-compatible timestamp");
  const frozen = await loadAndVerifyInputs();
  const yahooSeriesBySymbol = generation6SeriesBySymbolFromPoints(frozen.yahooPanel.points);
  const reconciliation = buildGeneration6SourceReconciliation({
    selectionOutput: frozen.selectionOutput,
    allowedCandidateIds: GENERATION6_CANDIDATE_IDS,
    yahooPerSymbolSeriesBySymbol: yahooSeriesBySymbol,
    alpacaPerSymbolSeriesBySymbol: frozen.alpacaValidation.perSymbolSeriesBySymbol,
    yahooStrategySeriesBySymbol: yahooSeriesBySymbol,
    alpacaStrategySeriesBySymbol: frozen.alpacaValidation.strategySeriesBySymbol,
    createStrategies: createGeneration6Strategies,
    metadata: GENERATION6_METADATA,
    thresholds: frozen.protocol.pass_thresholds,
    simulationOptions: frozen.protocol.simulation_options,
  });
  const report = Object.freeze({
    schema_version: "finly_source_overlap_reconciliation_generation6.v1",
    generated_at: generatedAt,
    disposition: reconciliation.passed ? "PASS_SOURCE_RECONCILIATION" : "FAIL_CLOSED",
    no_network_performed: true,
    input_integrity: frozen.hashes,
    sources: Object.freeze({
      yahoo_generation4_panel: Object.freeze({
        path: frozen.protocol.frozen_inputs.yahoo_generation4_panel.path,
        role: frozen.protocol.frozen_inputs.yahoo_generation4_panel.role,
      }),
      alpaca_adjustment_all_panel: Object.freeze({
        path: frozen.protocol.frozen_inputs.alpaca_adjustment_all_panel.path,
        role: frozen.protocol.frozen_inputs.alpaca_adjustment_all_panel.role,
        provider: frozen.alpacaPanel.provider,
        feed: frozen.alpacaPanel.request.feed,
        adjustment: frozen.alpacaPanel.request.adjustment,
        schema_version: frozen.alpacaPanel.schema_version,
        per_symbol_gate_input: "series_by_symbol",
        candidate_simulation_input: "strategy_intersection.points",
        series_integrity_by_symbol: frozen.alpacaValidation.seriesIntegrityBySymbol,
        series_integrity_sha256: frozen.alpacaValidation.seriesIntegritySha256,
        strategy_intersection_normalized_panel_sha256:
          frozen.alpacaValidation.strategyIntersectionNormalizedSha256,
      }),
    }),
    reconciliation,
  });
  const jsonPayload = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  const markdownPayload = Buffer.from(renderMarkdown(report));
  const receipt = Object.freeze({
    schema_version: "finly_source_overlap_reconciliation_generation6_result_receipt.v1",
    generated_at: generatedAt,
    input_integrity: frozen.hashes,
    files: Object.freeze({
      [GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS[0]]: sha256Bytes(jsonPayload),
      [GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS[1]]: sha256Bytes(markdownPayload),
    }),
    disposition: report.disposition,
    selected_candidate_ids: reconciliation.selection.selected_candidate_ids,
    no_network_performed: true,
    prior_generation5_overall_disposition_inherited: false,
  });
  const receiptPayload = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze({ report, jsonPayload, markdownPayload, receipt, receiptPayload });
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeNew(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, payload, { flag: "wx", mode: 0o600 });
}

export async function persistImmutableGeneration6SourceArtifacts(artifacts, { verifyExisting = false } = {}) {
  invariant(Array.isArray(artifacts) && artifacts.length > 0, "immutable artifact list is empty");
  const paths = artifacts.map((artifact) => artifact?.path);
  invariant(paths.every((path) => typeof path === "string") && new Set(paths).size === paths.length, "immutable artifact paths are invalid");
  if (verifyExisting) {
    for (const artifact of artifacts) {
      invariant(await pathExists(artifact.path), `cannot verify absent immutable artifact ${artifact.path}`);
      const actual = await readFile(artifact.path);
      invariant(actual.equals(Buffer.from(artifact.payload)), `immutable artifact differs from deterministic recomputation: ${artifact.path}`);
    }
    return Object.freeze({ mode: "VERIFIED_EXISTING", paths: Object.freeze(paths) });
  }
  const existing = [];
  for (const path of paths) {
    if (await pathExists(path)) existing.push(path);
  }
  invariant(existing.length === 0, `immutable Generation 6 source output already exists; use --verify-existing: ${existing.join(", ")}`);
  for (const artifact of artifacts) await writeNew(artifact.path, artifact.payload);
  return Object.freeze({ mode: "WROTE_ONCE", paths: Object.freeze(paths) });
}

function bundleArtifacts(bundle) {
  return Object.freeze([
    Object.freeze({ path: outputPath, payload: bundle.jsonPayload }),
    Object.freeze({ path: reportPath, payload: bundle.markdownPayload }),
    Object.freeze({ path: resultReceiptPath, payload: bundle.receiptPayload }),
  ]);
}

async function run() {
  const args = process.argv.slice(2);
  invariant(args.length === 0 || (args.length === 1 && args[0] === "--verify-existing"), "usage: node research/run_source_overlap_reconciliation_generation6.mjs [--verify-existing]");
  const verifyExisting = args[0] === "--verify-existing";
  let generatedAt;
  if (verifyExisting) {
    const existing = JSON.parse(await readFile(outputPath, "utf8"));
    generatedAt = existing.generated_at;
  }
  const bundle = await computeGeneration6SourceBundle({ generatedAt });
  const persistence = await persistImmutableGeneration6SourceArtifacts(bundleArtifacts(bundle), { verifyExisting });
  process.stdout.write(`${JSON.stringify({
    ok: bundle.report.reconciliation.passed,
    disposition: bundle.report.disposition,
    selected_candidate_ids: bundle.report.reconciliation.selection.selected_candidate_ids,
    persistence: persistence.mode,
    output: outputPath,
    report: reportPath,
    receipt: resultReceiptPath,
  }, null, 2)}\n`);
  if (!bundle.report.reconciliation.passed) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  run().catch((error) => {
    process.stderr.write(`Generation 6 source reconciliation failed closed without writing an output: ${error?.message ?? "unknown error"}\n`);
    process.exitCode = 1;
  });
}
