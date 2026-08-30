import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  calculatePortfolioMetrics,
  rebaseRowsForStandalonePeriod,
  round,
  rowsWithin,
  sha256,
  simulateStrategy,
} from "./champion_engine.mjs";
import { CORE_SYMBOLS, createPrimaryStrategies } from "./champion_strategies.mjs";
import { createGeneration4Strategies } from "./champion_strategies_generation4.mjs";
import {
  createGeneration5Strategies,
  GENERATION5_METADATA,
  GENERATION5_REQUIRED_SYMBOLS,
} from "./champion_strategies_generation5.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const protocolPath = resolve(projectRoot, "research/champion_search_generation5_protocol.json");
const trialLedgerPath = resolve(projectRoot, "research/champion_trial_ledger_generation5.json");
const freezeReceiptPath = resolve(projectRoot, "research/champion_search_generation5_freeze_receipt.json");
const outputDirectory = resolve(projectRoot, "research/output");
const privateDirectory = resolve(projectRoot, "data/private/champion_search");
const jsonOutputPath = resolve(outputDirectory, "quant_champion_generation5.json");
const markdownOutputPath = resolve(outputDirectory, "quant_champion_generation5_report.md");

export const GENERATION5_ALL_IDS = Object.freeze(createGeneration5Strategies().map((strategy) => strategy.id));
export const GENERATION5_CONTROL_IDS = Object.freeze(GENERATION5_ALL_IDS.filter(
  (id) => GENERATION5_METADATA[id].eligible === false,
));
export const GENERATION5_CANDIDATE_IDS = Object.freeze(GENERATION5_ALL_IDS.filter(
  (id) => GENERATION5_METADATA[id].eligible === true,
));
export const GENERATION5_COMPARATOR_IDS = Object.freeze([
  "spy_buy_hold",
  "qqq_buy_hold",
  "static_spy_qqq_50_50_control",
  "static_qqq_equal_sectors_control",
  "qqq_core_sector_12_6",
  "frozen_finly",
  "spy_vol_target_15",
  "bil_cash",
]);

export const GENERATION5_SLICES = Object.freeze({
  development: Object.freeze({ start: "2008-06-02", end: "2017-12-29" }),
  validation: Object.freeze({ start: "2018-01-02", end: "2024-12-31" }),
  recent_veto_only: Object.freeze({ start: "2025-01-02", end: "2026-08-28" }),
});

export const GENERATION5_BASE_OPTIONS = Object.freeze({
  cashSymbol: "BIL",
  lookbackSessions: 252,
  rebalanceIntervalSessions: 21,
  rebalanceAnchor: 0,
  oneWayCostBps: 5,
  annualBorrowSpread: 0.005,
  maximumRiskyGross: 1,
  terminalLiquidation: true,
});

const REQUIRED_PRIMARY_IDS = Object.freeze([
  "bil_cash",
  "spy_buy_hold",
  "qqq_buy_hold",
  "frozen_finly",
  "spy_vol_target_15",
]);
const REQUIRED_GENERATION4_IDS = Object.freeze([
  "static_spy_qqq_50_50_control",
  "qqq_core_sector_12_6",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256Bytes(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function atomicWriteBuffer(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { mode: 0o600 });
  await rename(temporary, path);
}

export function annualizedLogGrowth(metrics) {
  return Math.log1p(metrics.total_return) * 252 / metrics.observations;
}

function standalone(rows) {
  return rebaseRowsForStandalonePeriod(rows, {
    cashSymbol: GENERATION5_BASE_OPTIONS.cashSymbol,
    oneWayCostBps: GENERATION5_BASE_OPTIONS.oneWayCostBps,
  });
}

function metricsForSlice(simulations, slice) {
  return Object.fromEntries(simulations.map((simulation) => [
    simulation.id,
    calculatePortfolioMetrics(standalone(rowsWithin(simulation.rows, slice.start, slice.end))),
  ]));
}

function orderedEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

export function validateGeneration5Protocol(protocol, trialLedger) {
  const reasons = [];
  const registry = protocol?.registered_formulas ?? [];
  const registeredIds = registry.map((item) => item.id);
  const registeredTrials = registry.map((item) => item.trial);
  const ledgerBlock = trialLedger?.blocks?.find((block) => block.range === "101-105");
  if (protocol?.schema_version !== "finly_champion_search_generation5_protocol.v1") reasons.push("protocol schema mismatch");
  if (protocol?.frozen_before_first_generation_5_output !== true) reasons.push("protocol is not marked frozen before output");
  if (!orderedEqual(protocol?.data?.symbols, GENERATION5_REQUIRED_SYMBOLS)) reasons.push("protocol symbol order differs from the frozen Generation 4 panel");
  if (!orderedEqual(registeredIds, GENERATION5_ALL_IDS)) reasons.push("registered formula ids differ from strategy code");
  if (!orderedEqual(registeredTrials, [101, 102, 103, 104, 105])) reasons.push("registered trials are not exactly 101-105");
  for (const item of registry) {
    if (item.eligible !== GENERATION5_METADATA[item.id]?.eligible) reasons.push(`eligibility mismatch for ${item.id}`);
  }
  if (protocol?.execution?.rebalance_interval_sessions !== 21) reasons.push("protocol cadence is not 21 sessions");
  if (protocol?.execution?.base_one_way_cost_bps_per_absolute_traded_notional !== 5) reasons.push("protocol base cost is not 5 bp");
  if (protocol?.execution?.long_only !== true || protocol?.execution?.maximum_risky_gross !== 1) reasons.push("protocol long-only gross boundary mismatch");
  if (!orderedEqual(protocol?.comparators, GENERATION5_COMPARATOR_IDS)) reasons.push("protocol comparator registry mismatch");
  if (!orderedEqual(protocol?.selection_tracks?.raw_spy?.candidate_ids, GENERATION5_CANDIDATE_IDS)) reasons.push("raw track candidate registry mismatch");
  if (!orderedEqual(protocol?.selection_tracks?.growth_control?.candidate_ids, GENERATION5_CANDIDATE_IDS)) reasons.push("growth track candidate registry mismatch");
  if (protocol?.trial_accounting?.cumulative_effective_trials !== 105) reasons.push("protocol trial count is not 105");
  if (trialLedger?.append_only_through !== 105) reasons.push("trial ledger does not append through 105");
  if (trialLedger?.prior_ledger_sha256 !== protocol?.frozen_inputs?.generation_4_trial_ledger?.sha256) reasons.push("trial ledger prior hash mismatch");
  if (!ledgerBlock || ledgerBlock.count !== 5 || !orderedEqual(ledgerBlock.ids, GENERATION5_ALL_IDS)) reasons.push("trial ledger Generation 5 block mismatch");
  if ((trialLedger?.blocks ?? []).reduce((sum, block) => sum + block.count, 0) !== 105) reasons.push("trial ledger block counts do not sum to 105");
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function recentVetoFor(candidateId, metrics) {
  if (!candidateId) return Object.freeze({ applicable: false, hard_safety_veto: false, reasons: Object.freeze([]) });
  const recent = metrics.recent_veto_only[candidateId];
  const spy = metrics.recent_veto_only.spy_buy_hold;
  const bil = metrics.recent_veto_only.bil_cash;
  const reasons = [];
  if (recent.maximum_drawdown < -0.20) reasons.push("recent maximum drawdown below -20%");
  if (recent.total_return < bil.total_return) reasons.push("recent total return trailed BIL");
  if (recent.maximum_drawdown < spy.maximum_drawdown - 0.05) reasons.push("recent drawdown over five percentage points worse than SPY");
  return Object.freeze({
    applicable: true,
    hard_safety_veto: reasons.length > 0,
    reasons: Object.freeze(reasons),
    metrics: recent,
  });
}

function edge(candidateMetrics, comparatorMetrics) {
  return annualizedLogGrowth(candidateMetrics) - annualizedLogGrowth(comparatorMetrics);
}

export function buildGeneration5Assessments(metrics) {
  const development = metrics.development;
  const validation = metrics.validation;
  return Object.freeze(Object.fromEntries(GENERATION5_CANDIDATE_IDS.map((id) => {
    const recentVeto = recentVetoFor(id, metrics);
    const edges = Object.freeze({
      development: Object.freeze({
        spy_buy_hold: round(edge(development[id], development.spy_buy_hold)),
        qqq_buy_hold: round(edge(development[id], development.qqq_buy_hold)),
        static_spy_qqq_50_50_control: round(edge(development[id], development.static_spy_qqq_50_50_control)),
        static_qqq_equal_sectors_control: round(edge(development[id], development.static_qqq_equal_sectors_control)),
        qqq_core_sector_12_6: round(edge(development[id], development.qqq_core_sector_12_6)),
      }),
      validation: Object.freeze({
        spy_buy_hold: round(edge(validation[id], validation.spy_buy_hold)),
        qqq_buy_hold: round(edge(validation[id], validation.qqq_buy_hold)),
        static_spy_qqq_50_50_control: round(edge(validation[id], validation.static_spy_qqq_50_50_control)),
        static_qqq_equal_sectors_control: round(edge(validation[id], validation.static_qqq_equal_sectors_control)),
        qqq_core_sector_12_6: round(edge(validation[id], validation.qqq_core_sector_12_6)),
      }),
    });
    const rawGates = Object.freeze({
      development_spy_edge_strictly_above_50bp: edges.development.spy_buy_hold > 0.005,
      validation_spy_edge_strictly_above_50bp: edges.validation.spy_buy_hold > 0.005,
      development_drawdown_not_over_5pp_worse_than_spy:
        development[id].maximum_drawdown >= development.spy_buy_hold.maximum_drawdown - 0.05,
      validation_drawdown_not_over_5pp_worse_than_spy:
        validation[id].maximum_drawdown >= validation.spy_buy_hold.maximum_drawdown - 0.05,
      recent_hard_safety_veto_passes: recentVeto.hard_safety_veto === false,
    });
    const growthGates = Object.freeze({
      development_qqq_edge_positive: edges.development.qqq_buy_hold > 0,
      validation_qqq_edge_positive: edges.validation.qqq_buy_hold > 0,
      development_static_spy_qqq_edge_positive: edges.development.static_spy_qqq_50_50_control > 0,
      validation_static_spy_qqq_edge_positive: edges.validation.static_spy_qqq_50_50_control > 0,
      development_static_qqq_sectors_edge_positive: edges.development.static_qqq_equal_sectors_control > 0,
      validation_static_qqq_sectors_edge_positive: edges.validation.static_qqq_equal_sectors_control > 0,
      recent_hard_safety_veto_passes: recentVeto.hard_safety_veto === false,
    });
    return [id, Object.freeze({
      id,
      edges,
      raw_spy_score: round(Math.min(edges.development.spy_buy_hold, edges.validation.spy_buy_hold)),
      growth_control_score: round(Math.min(
        edges.development.qqq_buy_hold,
        edges.validation.qqq_buy_hold,
        edges.development.static_spy_qqq_50_50_control,
        edges.validation.static_spy_qqq_50_50_control,
        edges.development.static_qqq_equal_sectors_control,
        edges.validation.static_qqq_equal_sectors_control,
      )),
      validation_maximum_drawdown: validation[id].maximum_drawdown,
      validation_annualized_turnover_notional: validation[id].annualized_turnover_notional,
      raw_spy_gates: rawGates,
      growth_control_gates: growthGates,
      raw_spy_eligible_before_robustness: Object.values(rawGates).every(Boolean),
      growth_control_eligible_before_robustness: Object.values(growthGates).every(Boolean),
      recent_veto: recentVeto,
    })];
  })));
}

export function selectGeneration5Track(assessments, track) {
  const configuration = track === "raw_spy"
    ? Object.freeze({ score: "raw_spy_score", eligible: "raw_spy_eligible_before_robustness" })
    : track === "growth_control"
      ? Object.freeze({ score: "growth_control_score", eligible: "growth_control_eligible_before_robustness" })
      : null;
  invariant(configuration, `unknown Generation 5 selection track ${track}`);
  const ranked = Object.values(assessments).sort((left, right) => (
    right[configuration.score] - left[configuration.score]
    || Math.abs(left.validation_maximum_drawdown) - Math.abs(right.validation_maximum_drawdown)
    || left.validation_annualized_turnover_notional - right.validation_annualized_turnover_notional
    || left.id.localeCompare(right.id)
  ));
  return Object.freeze({
    track,
    ranked_candidate_ids: Object.freeze(ranked.map((item) => item.id)),
    selected_id_before_post_selection_robustness: ranked.find((item) => item[configuration.eligible])?.id ?? null,
    objective: track === "raw_spy"
      ? "maximize the smaller development/validation SPY edge among raw-SPY qualifiers"
      : "maximize the smallest development/validation edge across QQQ and both static growth controls among growth-control qualifiers",
    tie_breaks: Object.freeze([
      "shallower validation maximum drawdown",
      "lower validation annualized turnover",
      "alphabetical candidate identifier",
    ]),
  });
}

async function readAndVerify(path, expectedHash, label) {
  const payload = await readFile(path);
  invariant(sha256Bytes(payload) === expectedHash, `${label} hash mismatch`);
  return payload;
}

async function loadFrozenInputs() {
  const protocolRaw = await readFile(protocolPath, "utf8");
  const trialLedgerRaw = await readFile(trialLedgerPath, "utf8");
  const freezeReceiptRaw = await readFile(freezeReceiptPath, "utf8");
  const protocol = JSON.parse(protocolRaw);
  const trialLedger = JSON.parse(trialLedgerRaw);
  const freezeReceipt = JSON.parse(freezeReceiptRaw);
  const validation = validateGeneration5Protocol(protocol, trialLedger);
  invariant(validation.passes, `Generation 5 protocol validation failed: ${validation.reasons.join("; ")}`);
  invariant(freezeReceipt.schema_version === "finly_champion_search_generation5_freeze_receipt.v1", "Generation 5 freeze receipt schema mismatch");
  invariant(freezeReceipt.generation_5_results_seen_at_freeze === false, "freeze receipt says Generation 5 results were seen");
  for (const [relativePath, expectedHash] of Object.entries(freezeReceipt.files ?? {})) {
    await readAndVerify(resolve(projectRoot, relativePath), expectedHash, `freeze file ${relativePath}`);
  }
  const frozenPayloads = {};
  for (const [id, item] of Object.entries(protocol.frozen_inputs)) {
    if (!item.path) continue;
    const expectedHash = item.sha256 ?? item.payload_sha256;
    frozenPayloads[id] = await readAndVerify(resolve(projectRoot, item.path), expectedHash, `frozen input ${id}`);
  }
  const panel = JSON.parse(frozenPayloads.generation_4_private_panel.toString("utf8"));
  invariant(panel.schema_version === protocol.frozen_inputs.generation_4_private_panel.schema_version, "Generation 4 private panel schema mismatch");
  invariant(panel.normalized_panel_sha256 === protocol.frozen_inputs.generation_4_private_panel.normalized_panel_sha256, "Generation 4 normalized panel hash mismatch");
  invariant(Array.isArray(panel.points) && panel.points.length === protocol.frozen_inputs.generation_4_private_panel.common_sessions, "Generation 4 private panel row count mismatch");
  const normalizedHash = sha256(panel.points.map((point) => [
    point.date,
    ...CORE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
  ]));
  invariant(normalizedHash === panel.normalized_panel_sha256, "Generation 4 normalized panel cannot be reproduced");
  let priorDate = "";
  for (const point of panel.points) {
    invariant(typeof point.date === "string" && point.date > priorDate, "Generation 4 panel dates are not strictly increasing");
    priorDate = point.date;
    for (const symbol of CORE_SYMBOLS) invariant(Number.isFinite(point[symbol]) && point[symbol] > 0, `invalid ${symbol} value at ${point.date}`);
  }
  const generation4Output = JSON.parse(frozenPayloads.generation_4_output.toString("utf8"));
  invariant(generation4Output.dataset?.normalized_panel_sha256 === panel.normalized_panel_sha256, "Generation 4 output and panel hashes differ");
  invariant(generation4Output.raw_return_track?.selected_id_before_recent_and_robustness === "qqq_core_sector_12_6", "Generation 4 selected candidate changed");
  return Object.freeze({
    protocol,
    trialLedger,
    freezeReceipt,
    panel,
    generation4Output,
    hashes: Object.freeze({
      protocol_sha256: sha256(protocolRaw),
      trial_ledger_sha256: sha256(trialLedgerRaw),
      freeze_receipt_sha256: sha256(freezeReceiptRaw),
      generation_4_panel_payload_sha256: sha256Bytes(frozenPayloads.generation_4_private_panel),
      generation_4_normalized_panel_sha256: normalizedHash,
    }),
  });
}

function requiredStrategies() {
  const primary = createPrimaryStrategies().filter((strategy) => REQUIRED_PRIMARY_IDS.includes(strategy.id));
  const generation4 = createGeneration4Strategies().filter((strategy) => REQUIRED_GENERATION4_IDS.includes(strategy.id));
  const strategies = [...primary, ...generation4, ...createGeneration5Strategies()];
  const ids = strategies.map((strategy) => strategy.id);
  invariant(new Set(ids).size === ids.length, "Generation 5 simulation registry contains duplicate ids");
  for (const id of [...GENERATION5_COMPARATOR_IDS, ...GENERATION5_ALL_IDS]) invariant(ids.includes(id), `simulation registry omits ${id}`);
  return Object.freeze(strategies);
}

function renderReport(report) {
  const rows = report.raw_spy_track.ranked_candidate_ids.map((id) => {
    const item = report.assessments[id];
    const rawFailures = Object.entries(item.raw_spy_gates).filter(([, passed]) => !passed).map(([gate]) => gate).join(", ") || "none";
    const growthFailures = Object.entries(item.growth_control_gates).filter(([, passed]) => !passed).map(([gate]) => gate).join(", ") || "none";
    return `| ${id} | ${(100 * item.raw_spy_score).toFixed(2)}% | ${(100 * item.growth_control_score).toFixed(2)}% | ${rawFailures} | ${growthFailures} |`;
  }).join("\n");
  return `# Finly Generation 5 quantitative search\n\nProtocol: \`${report.input_integrity.protocol_sha256}\`  \nImmutable Generation 4 panel: \`${report.dataset.normalized_panel_sha256}\`\n\n## Answer first\n\nRaw-SPY candidate before robustness: **${report.raw_spy_track.selected_id_before_post_selection_robustness ?? "none"}**. Growth-control candidate: **${report.growth_control_track.selected_id_before_post_selection_robustness ?? "none"}**. Disposition: **${report.disposition}**.\n\n| Candidate | Minimum SPY edge | Minimum growth-control edge | Failed raw gates | Failed growth gates |\n|---|---:|---:|---|---|\n${rows}\n\nEvery interval was seen before this frozen run. A passing historical track remains retrospective and requires separate post-selection robustness and authenticated source reconciliation; it is not proof of future profit.\n`;
}

export async function runGeneration5() {
  const frozen = await loadFrozenInputs();
  const strategies = requiredStrategies();
  const simulations = strategies.map((strategy) => simulateStrategy(
    frozen.panel.points,
    CORE_SYMBOLS,
    strategy,
    GENERATION5_BASE_OPTIONS,
  ));
  const metrics = Object.fromEntries(Object.entries(GENERATION5_SLICES).map(([id, slice]) => [
    id,
    metricsForSlice(simulations, slice),
  ]));
  const assessments = buildGeneration5Assessments(metrics);
  const rawSpyTrack = selectGeneration5Track(assessments, "raw_spy");
  const growthControlTrack = selectGeneration5Track(assessments, "growth_control");
  const disposition = growthControlTrack.selected_id_before_post_selection_robustness
    ? "GROWTH_CONTROL_ROBUSTNESS_PENDING"
    : rawSpyTrack.selected_id_before_post_selection_robustness
      ? "RAW_SPY_ROBUSTNESS_PENDING"
      : "KEEP_V1";
  const privateLedgerPayload = gzipSync(JSON.stringify({
    schema_version: "finly_generation5_private_ledger.v1",
    protocol_sha256: frozen.hashes.protocol_sha256,
    normalized_panel_sha256: frozen.panel.normalized_panel_sha256,
    simulations: Object.fromEntries(simulations.map((simulation) => [simulation.id, simulation.rows])),
  }));
  const privateLedgerSha = sha256Bytes(privateLedgerPayload);
  const privateLedgerFilename = `generation5_ledger_${privateLedgerSha}.json.gz`;
  await atomicWriteBuffer(resolve(privateDirectory, privateLedgerFilename), privateLedgerPayload);
  const report = Object.freeze({
    schema_version: "finly_quant_champion_generation5.v1",
    generated_at: new Date().toISOString(),
    disposition,
    claim_boundary: frozen.protocol.claim_boundary,
    input_integrity: Object.freeze({
      ...frozen.hashes,
      generation_5_results_seen_at_freeze: frozen.freezeReceipt.generation_5_results_seen_at_freeze,
      no_market_fetch_performed: true,
    }),
    dataset: Object.freeze({
      symbols: CORE_SYMBOLS,
      common_start: frozen.panel.points[0].date,
      common_end: frozen.panel.points.at(-1).date,
      common_sessions: frozen.panel.points.length,
      normalized_panel_sha256: frozen.panel.normalized_panel_sha256,
      reused_generation_4_panel_path: frozen.protocol.frozen_inputs.generation_4_private_panel.path,
      private_generation_5_ledger_filename: privateLedgerFilename,
      private_generation_5_ledger_gzip_sha256: privateLedgerSha,
    }),
    execution: GENERATION5_BASE_OPTIONS,
    comparators: GENERATION5_COMPARATOR_IDS,
    strategy_metadata: GENERATION5_METADATA,
    metrics,
    assessments,
    raw_spy_track: rawSpyTrack,
    growth_control_track: growthControlTrack,
  });
  return report;
}

async function main() {
  const report = await runGeneration5();
  await atomicWrite(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(markdownOutputPath, renderReport(report));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    disposition: report.disposition,
    raw_spy_selected: report.raw_spy_track.selected_id_before_post_selection_robustness,
    growth_control_selected: report.growth_control_track.selected_id_before_post_selection_robustness,
    panel_sha256: report.dataset.normalized_panel_sha256,
    json: jsonOutputPath,
    report: markdownOutputPath,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
