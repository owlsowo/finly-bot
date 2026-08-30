import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

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
import { createGeneration5Strategies } from "./champion_strategies_generation5.mjs";
import {
  createGeneration6Strategies,
  GENERATION6_REQUIRED_SYMBOLS,
} from "./champion_strategies_generation6.mjs";
import {
  evaluateGeneration6CandidateGates,
  evaluateGeneration6SymbolGates,
  GENERATION6_CANDIDATE_REQUIRED_SYMBOLS,
  GENERATION6_SOURCE_SIMULATION_OPTIONS,
  GENERATION6_SOURCE_SERIES_CONTRACT,
  GENERATION6_SOURCE_SYMBOLS,
  GENERATION6_SOURCE_THRESHOLDS,
} from "./source_overlap_reconciliation_generation6.mjs";
import {
  GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS,
  validateGeneration6SourceFreezeReceipt,
  validateGeneration6SourceProtocol,
} from "./run_source_overlap_reconciliation_generation6.mjs";
import {
  GENERATION6_BASE_OPTIONS,
  GENERATION6_CANDIDATE_IDS,
  GENERATION6_GROWTH_CONTROL_IDS,
  GENERATION6_SLICES,
  validateGeneration6Protocol,
} from "./run_quant_champion_generation6.mjs";
import {
  assessCausalVolatilityMatchedSpySlices,
  assessGeneration6AnchorSensitivity,
  assessGeneration6CostSensitivity,
  buildCausalVolatilityMatchedSpyComparator,
  buildGeneration6PairedRows,
  buildGeneration6StatisticalEvidence,
  GENERATION6_BLOCK_LENGTHS,
  GENERATION6_BOOTSTRAP_ITERATIONS,
  GENERATION6_BOOTSTRAP_SEEDS,
  GENERATION6_COST_LEVELS_BPS,
  GENERATION6_CUMULATIVE_TRIALS,
  GENERATION6_REBALANCE_ANCHORS,
  GENERATION6_VOLATILITY_MATCH_SPECIFICATION,
  summarizeGeneration6PostSelectionRobustness,
} from "./champion_generation6_robustness.mjs";
import {
  buildGeneration6GrowthJointStatisticalEvidence,
  GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS,
  GENERATION6_GROWTH_STATISTICS_CONTROL_IDS,
  GENERATION6_GROWTH_STATISTICS_SPECIFICATION,
} from "./champion_generation6_growth_statistics.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const privateDirectory = resolve(projectRoot, "data/private/champion_search");

export const GENERATION6_ROBUSTNESS_PATHS = Object.freeze({
  robustness_protocol: "research/champion_generation6_robustness_protocol.json",
  robustness_freeze_receipt: "research/champion_generation6_robustness_freeze_receipt.json",
  generation6_protocol: "research/champion_search_generation6_protocol.json",
  generation6_freeze_receipt: "research/champion_search_generation6_freeze_receipt.json",
  generation6_trial_ledger: "research/champion_trial_ledger_generation6.json",
  generation6_output: "research/output/quant_champion_generation6.json",
  generation6_result_receipt: "research/champion_generation6_result_receipt.json",
  robustness_output: "research/output/quant_champion_generation6_robustness.json",
  robustness_report: "research/output/quant_champion_generation6_robustness_report.md",
  robustness_result_receipt: "research/champion_generation6_robustness_result_receipt.json",
  robustness_claim: "research/output/.quant_champion_generation6_robustness.claim.json",
  source_protocol: "research/source_overlap_reconciliation_generation6_protocol.json",
  source_freeze_receipt: "research/source_overlap_reconciliation_generation6_freeze_receipt.json",
  source_output: GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS[0],
  source_report: GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS[1],
  source_result_receipt: GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS[2],
});

export const GENERATION6_ANNUAL_ORIGIN_HORIZONS = Object.freeze([252, 504, 756]);
export const GENERATION6_ANNUAL_ORIGIN_GATES = Object.freeze({
  median_annualized_log_growth_difference_strictly_above: 0,
  minimum_positive_fraction: 0.60,
});
export const GENERATION6_ANNUAL_ORIGIN_REBASE_SPECIFICATION = Object.freeze({
  origin: "FIRST_SCORED_SESSION_OF_EACH_VALIDATION_CALENDAR_YEAR",
  incomplete_trailing_windows_omitted: true,
  each_origin_horizon_rebased_independently: true,
  starting_portfolio: "100_PERCENT_BIL",
  cash_symbol: "BIL",
  one_way_cost_bps: 5,
  fresh_entry_required: true,
  terminal_liquidation_required: true,
  inherited_terminal_markers_removed_by_canonical_rebase: true,
});
export const GENERATION6_ROBUSTNESS_PERSISTENCE_SPECIFICATION = Object.freeze({
  first_run_claim: "EXCLUSIVE_WX_CLAIM_WITH_SERIALIZED_DEAD_PID_CRASH_RECOVERY",
  artifact_write: "FLAG_WX_OR_VERIFY_BYTE_IDENTICAL_PARTIAL_ARTIFACT",
  crash_resumable: true,
  rename_overwrite_permitted: false,
  verify_existing_cli_supported: true,
});
export const GENERATION6_SOURCE_RECONCILIATION_SCHEMA =
  "finly_source_overlap_reconciliation_generation6.v1";
export const GENERATION6_SOURCE_EVIDENCE_SCHEMA =
  "finly_generation6_source_overlap_reconciliation_evidence.v1";
export const GENERATION6_SOURCE_SYMBOLS_BY_CANDIDATE = Object.freeze(Object.fromEntries(
  GENERATION6_CANDIDATE_IDS.map((candidateId) => {
    const declared = GENERATION6_CANDIDATE_REQUIRED_SYMBOLS[candidateId] ?? [];
    const required = new Set(["SPY", "BIL", ...declared]);
    return [candidateId, Object.freeze(CORE_SYMBOLS.filter((symbol) => required.has(symbol)))];
  }),
));
export const GENERATION6_STATISTICAL_INTERPRETATION = Object.freeze({
  applies_only_to_primary_spy_track: true,
  growth_control_covered_by_this_spy_gate: false,
  growth_control_uses_separate_joint_statistical_gate: true,
  dsr_role: "HEURISTIC_MULTIPLE_TESTING_DIAGNOSTIC_USING_SEVEN_CURRENT_CANDIDATES_AND_113_CUMULATIVE_LEDGER_TRIALS",
  bootstrap_monte_carlo_iterations: GENERATION6_BOOTSTRAP_ITERATIONS,
  smallest_attainable_unadjusted_p_value: 1 / (GENERATION6_BOOTSTRAP_ITERATIONS + 1),
  smallest_attainable_113_trial_bonferroni_p_value:
    GENERATION6_CUMULATIVE_TRIALS / (GENERATION6_BOOTSTRAP_ITERATIONS + 1),
});

const robustnessProtocolPath = resolve(projectRoot, GENERATION6_ROBUSTNESS_PATHS.robustness_protocol);
const robustnessFreezeReceiptPath = resolve(
  projectRoot,
  GENERATION6_ROBUSTNESS_PATHS.robustness_freeze_receipt,
);
const jsonOutputPath = resolve(projectRoot, GENERATION6_ROBUSTNESS_PATHS.robustness_output);
const markdownOutputPath = resolve(projectRoot, GENERATION6_ROBUSTNESS_PATHS.robustness_report);
const resultReceiptPath = resolve(
  projectRoot,
  GENERATION6_ROBUSTNESS_PATHS.robustness_result_receipt,
);
const robustnessClaimPath = resolve(projectRoot, GENERATION6_ROBUSTNESS_PATHS.robustness_claim);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function presentedSourceMetrics(rawMetrics) {
  if (!rawMetrics || typeof rawMetrics !== "object" || Array.isArray(rawMetrics)) return null;
  return Object.fromEntries(Object.entries(rawMetrics).map(([key, value]) => [
    key,
    key === "observations" ? value : round(value),
  ]));
}

function parseJson(value, label) {
  try {
    return JSON.parse(value.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function safeProjectPath(relativePath, label) {
  invariant(typeof relativePath === "string" && relativePath.length > 0, `${label} path is missing`);
  invariant(!relativePath.startsWith("/"), `${label} path must be project-relative`);
  const path = resolve(projectRoot, relativePath);
  invariant(path.startsWith(`${projectRoot}/`), `${label} path escaped the project root`);
  return path;
}

function safePrivateLedgerPath(filename) {
  invariant(typeof filename === "string" && basename(filename) === filename, "private-ledger filename is invalid");
  invariant(/^generation6_ledger_[0-9a-f]{64}\.json\.gz$/.test(filename), "private-ledger filename is not content-addressed");
  const path = resolve(privateDirectory, filename);
  invariant(path.startsWith(`${privateDirectory}/`), "private ledger escaped its fixed directory");
  return path;
}

function annualizedLogGrowth(metrics) {
  invariant(metrics && Number.isSafeInteger(metrics.observations) && metrics.observations > 0, "metrics observations are invalid");
  invariant(Number.isFinite(metrics.total_return) && metrics.total_return > -1, "metrics total return is invalid");
  return Math.log1p(metrics.total_return) * 252 / metrics.observations;
}

function annualizedLogGrowthEdge(candidateMetrics, benchmarkMetrics) {
  return round(annualizedLogGrowth(candidateMetrics) - annualizedLogGrowth(benchmarkMetrics));
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function selectGeneration6RobustnessCandidates(report) {
  invariant(report?.schema_version === "finly_quant_champion_generation6.v1", "Generation 6 output schema is invalid");
  const primarySpy = report?.selection?.primary_spy_track
    ?.selected_id_before_post_selection_robustness ?? null;
  const growthControl = report?.selection?.growth_control_challenge_track
    ?.selected_id_before_post_selection_robustness ?? null;
  invariant(report?.selection?.selected_id_before_post_selection_robustness === primarySpy,
    "Generation 6 primary selection alias disagrees with the primary track");
  for (const [track, id, eligibilityField] of [
    ["primary_spy", primarySpy, "eligible_for_spy_post_selection_robustness"],
    ["growth_control_challenge", growthControl, "eligible_for_growth_challenge_post_selection_robustness"],
  ]) {
    if (id === null) continue;
    invariant(GENERATION6_CANDIDATE_IDS.includes(id), `${track} selected an unknown Generation 6 candidate`);
    invariant(report?.assessments?.[id]?.[eligibilityField] === true,
      `${track} selected a candidate that did not pass its frozen pre-robustness gates`);
  }
  const trackSelectedIds = Object.freeze({
    primary_spy: primarySpy,
    growth_control_challenge: growthControl,
  });
  const uniqueCandidateIds = Object.freeze([...new Set(
    Object.values(trackSelectedIds).filter((id) => id !== null),
  )]);
  const tracksByCandidate = Object.freeze(Object.fromEntries(uniqueCandidateIds.map((id) => [
    id,
    Object.freeze(Object.entries(trackSelectedIds)
      .filter(([, selectedId]) => selectedId === id)
      .map(([track]) => track)),
  ])));
  return Object.freeze({
    track_selected_ids: trackSelectedIds,
    unique_candidate_ids: uniqueCandidateIds,
    tracks_by_candidate: tracksByCandidate,
    deduplicated_candidate_count: uniqueCandidateIds.length,
  });
}

export function benchmarkScopeForGeneration6Candidate(selection, candidateId) {
  invariant(selection?.unique_candidate_ids?.includes(candidateId), `candidate ${candidateId} is not in the frozen selection`);
  const growthTrack = selection.tracks_by_candidate[candidateId].includes("growth_control_challenge");
  return Object.freeze([
    "spy_buy_hold",
    ...(growthTrack ? GENERATION6_GROWTH_CONTROL_IDS : []),
  ]);
}

function sourceDescriptor(protocol) {
  return protocol?.source_reconciliation?.combined_artifact ?? null;
}

export function validateGeneration6RobustnessProtocol(protocol, selection, bindings = {}) {
  const reasons = [];
  if (protocol?.schema_version !== "finly_champion_generation6_robustness_protocol.v1") {
    reasons.push("unexpected robustness protocol schema");
  }
  if (protocol?.status !== "frozen_before_first_post_selection_robustness_output") {
    reasons.push("robustness protocol is not frozen before first output");
  }
  if (protocol?.runner_market_fetch_permitted !== false) reasons.push("robustness runner market fetch is not forbidden");
  if (!sameJson(protocol?.frozen_selection, selection?.track_selected_ids)) {
    reasons.push("protocol selection differs from the frozen Generation 6 output");
  }
  const execution = protocol?.data_and_execution;
  if (!sameJson(execution?.cost_levels_bps, GENERATION6_COST_LEVELS_BPS)) reasons.push("cost levels differ from 5/10/25 bp");
  if (!sameJson(execution?.native_rebalance_anchors, GENERATION6_REBALANCE_ANCHORS)) reasons.push("rebalance anchors differ from 0 through 20");
  if (execution?.native_rebalance_interval_sessions !== 21) reasons.push("native rebalance interval is not 21 sessions");
  if (execution?.anchor_cost_bps !== 5) reasons.push("anchor cost is not 5 bp");
  if (execution?.cash_symbol !== "BIL") reasons.push("cash symbol is not BIL");
  if (execution?.maximum_risky_gross !== 1) reasons.push("maximum risky gross is not one");
  if (execution?.annual_borrow_spread !== 0.005) reasons.push("annual borrowing spread is not 50 bp");
  if (execution?.terminal_liquidation !== true) reasons.push("terminal liquidation is not required");
  for (const sliceId of ["development", "validation"]) {
    const actual = protocol?.slices?.[sliceId];
    const expected = GENERATION6_SLICES[sliceId];
    if (actual?.start !== expected.start || actual?.end !== expected.end) reasons.push(`${sliceId} slice differs`);
  }
  const statistical = protocol?.statistical_gate;
  if (statistical?.slice !== "validation_only") reasons.push("statistical gate is not validation-only");
  if (statistical?.benchmark_id !== "spy_buy_hold") reasons.push("statistical benchmark is not SPY");
  if (!sameJson(statistical?.eligible_candidate_ids, GENERATION6_CANDIDATE_IDS)) reasons.push("statistical family is not the seven Generation 6 candidates");
  if (statistical?.cumulative_effective_trials !== GENERATION6_CUMULATIVE_TRIALS) reasons.push("statistical trial count is not 113");
  if (statistical?.deflated_sharpe_probability_minimum !== 0.95) reasons.push("DSR gate is not 0.95");
  if (statistical?.bootstrap_iterations_per_test !== GENERATION6_BOOTSTRAP_ITERATIONS) reasons.push("bootstrap count is not 4,999");
  if (!sameJson(statistical?.block_lengths_sessions, GENERATION6_BLOCK_LENGTHS)) reasons.push("bootstrap block lengths differ");
  if (!sameJson(statistical?.methods, ["circular", "moving"])) reasons.push("bootstrap methods differ");
  if (!sameJson(statistical?.frozen_seeds, GENERATION6_BOOTSTRAP_SEEDS)) reasons.push("bootstrap seeds differ");
  if (statistical?.cumulative_trial_familywise_p_value_maximum !== 0.05) reasons.push("familywise gate is not 0.05");
  if (!sameJson(statistical?.interpretation, GENERATION6_STATISTICAL_INTERPRETATION)) {
    reasons.push("statistical interpretation or Monte Carlo resolution disclosure differs");
  }
  const risk = protocol?.causal_volatility_matched_spy_gate;
  if (!sameJson(risk?.specification, GENERATION6_VOLATILITY_MATCH_SPECIFICATION)) reasons.push("causal volatility-match specification differs");
  if (!sameJson(risk?.required_slices, ["development", "validation"])) reasons.push("risk match does not require both slices");
  if (risk?.annualized_log_growth_edge_strictly_positive !== true) reasons.push("risk-match growth edge is not strictly positive");
  if (risk?.realized_volatility_ratio_minimum !== 0.90
      || risk?.realized_volatility_ratio_maximum !== 1.10) reasons.push("risk-match realized-volatility band differs");
  const annual = protocol?.annual_origin_consistency_gate;
  if (annual?.slice !== "validation_only") reasons.push("annual-origin gate is not validation-only");
  if (!sameJson(annual?.horizons_sessions, GENERATION6_ANNUAL_ORIGIN_HORIZONS)) reasons.push("annual-origin horizons differ");
  if (annual?.median_annualized_log_growth_difference_strictly_above !== 0) reasons.push("annual-origin median gate differs");
  if (annual?.minimum_positive_fraction !== 0.60) reasons.push("annual-origin win-fraction gate differs");
  if (!sameJson(annual?.independent_window_rebase, GENERATION6_ANNUAL_ORIGIN_REBASE_SPECIFICATION)) {
    reasons.push("annual-origin independent boundary rebase specification differs");
  }
  if (!sameJson(
    protocol?.immutable_persistence,
    GENERATION6_ROBUSTNESS_PERSISTENCE_SPECIFICATION,
  )) {
    reasons.push("robustness immutable persistence specification differs");
  }
  const growthControl = protocol?.growth_control_challenge;
  if (!sameJson(growthControl?.benchmark_ids, GENERATION6_GROWTH_CONTROL_IDS)) {
    reasons.push("growth-control benchmark family differs");
  }
  if (growthControl?.evidence_class
      !== "PENALIZED_RETROSPECTIVE_JOINT_MEAN_LOG_GROWTH_TEST"
      || growthControl?.statistical_superiority_tested !== true
      || growthControl?.claim_scope
        !== "RETROSPECTIVE_MEAN_LOG_GROWTH_OVER_ALL_THREE_CONTROLS_ONLY") {
    reasons.push("growth-control challenge statistical claim scope differs");
  }
  if (!sameJson(
    growthControl?.joint_statistical_specification,
    GENERATION6_GROWTH_STATISTICS_SPECIFICATION,
  )) {
    reasons.push("growth-control joint statistical specification differs");
  }
  if (protocol?.source_reconciliation?.runner_fetch_permitted !== false
      || protocol?.source_reconciliation?.fail_closed !== true) {
    reasons.push("source reconciliation is not no-fetch and fail-closed");
  }
  if (protocol?.source_reconciliation?.artifact_schema !== GENERATION6_SOURCE_RECONCILIATION_SCHEMA) {
    reasons.push("source-reconciliation artifact schema differs");
  }
  if (protocol?.source_reconciliation?.evidence_schema !== GENERATION6_SOURCE_EVIDENCE_SCHEMA) {
    reasons.push("source-reconciliation inner evidence schema differs");
  }
  const selectedIds = selection?.unique_candidate_ids ?? [];
  const descriptor = sourceDescriptor(protocol);
  if (selectedIds.length === 0) {
    if (descriptor !== null || protocol?.source_reconciliation?.not_applicable_without_selected_candidate !== true) {
      reasons.push("source reconciliation without a selected candidate is not explicitly not applicable");
    }
  } else {
    if (protocol?.source_reconciliation?.not_applicable_without_selected_candidate !== false) {
      reasons.push("source reconciliation is incorrectly marked not applicable despite a selection");
    }
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
      reasons.push("combined source descriptor is missing");
    } else {
      const exactPaths = {
        path: GENERATION6_ROBUSTNESS_PATHS.source_output,
        report_path: GENERATION6_ROBUSTNESS_PATHS.source_report,
        protocol_path: GENERATION6_ROBUSTNESS_PATHS.source_protocol,
        freeze_receipt_path: GENERATION6_ROBUSTNESS_PATHS.source_freeze_receipt,
        result_receipt_path: GENERATION6_ROBUSTNESS_PATHS.source_result_receipt,
      };
      for (const [field, expectedPath] of Object.entries(exactPaths)) {
        if (descriptor[field] !== expectedPath) reasons.push(`combined source descriptor ${field} differs`);
      }
      for (const field of [
        "sha256",
        "report_sha256",
        "protocol_sha256",
        "freeze_receipt_sha256",
        "result_receipt_sha256",
      ]) {
        if (!isSha256(descriptor[field])) reasons.push(`combined source descriptor has invalid ${field}`);
      }
      if (!sameJson(descriptor.selected_candidate_ids, selectedIds)) {
        reasons.push("combined source descriptor selected ids differ from the frozen selection");
      }
      if (!sameJson(descriptor.required_symbols_for_overall_gate, GENERATION6_SOURCE_SYMBOLS)) {
        reasons.push("combined source descriptor does not require all 20 CORE symbols");
      }
      const expectedCandidateSymbols = Object.fromEntries(selectedIds.map((candidateId) => [
        candidateId,
        GENERATION6_SOURCE_SYMBOLS_BY_CANDIDATE[candidateId],
      ]));
      if (!sameJson(descriptor.candidate_required_symbols, expectedCandidateSymbols)) {
        reasons.push("combined source descriptor candidate symbol registry differs");
      }
    }
  }
  const expectedFrozenPaths = {
    generation6_output: GENERATION6_ROBUSTNESS_PATHS.generation6_output,
    generation6_result_receipt: GENERATION6_ROBUSTNESS_PATHS.generation6_result_receipt,
    generation6_protocol: GENERATION6_ROBUSTNESS_PATHS.generation6_protocol,
    generation6_freeze_receipt: GENERATION6_ROBUSTNESS_PATHS.generation6_freeze_receipt,
    generation6_trial_ledger: GENERATION6_ROBUSTNESS_PATHS.generation6_trial_ledger,
  };
  for (const [id, expectedPath] of Object.entries(expectedFrozenPaths)) {
    const descriptor = protocol?.frozen_inputs?.[id];
    if (descriptor?.path !== expectedPath) reasons.push(`frozen input ${id} path differs`);
    if (!isSha256(descriptor?.sha256)) reasons.push(`frozen input ${id} hash is invalid`);
    if (bindings[id] && descriptor?.sha256 !== bindings[id]) reasons.push(`frozen input ${id} hash differs from loaded bytes`);
  }
  for (const id of ["generation6_private_ledger", "private_panel"]) {
    const descriptor = protocol?.frozen_inputs?.[id];
    if (typeof descriptor?.path !== "string" || descriptor.path.length === 0) reasons.push(`frozen input ${id} path is missing`);
    if (!isSha256(descriptor?.sha256)) reasons.push(`frozen input ${id} hash is invalid`);
    if (bindings[id] && descriptor?.sha256 !== bindings[id]) reasons.push(`frozen input ${id} hash differs from loaded bytes`);
  }
  if (!isSha256(protocol?.frozen_inputs?.private_panel?.normalized_panel_sha256)) {
    reasons.push("frozen private-panel normalized hash is invalid");
  } else if (bindings.normalized_panel_sha256
      && protocol.frozen_inputs.private_panel.normalized_panel_sha256 !== bindings.normalized_panel_sha256) {
    reasons.push("frozen private-panel normalized hash differs from loaded panel");
  }
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function validateGeneration6FrozenSelection(report, receipt, privateLedger) {
  const reasons = [];
  let selection = null;
  try {
    selection = selectGeneration6RobustnessCandidates(report);
  } catch (error) {
    reasons.push(error.message);
  }
  if (receipt?.schema_version !== "finly_champion_generation6_result_receipt.v1") reasons.push("Generation 6 result-receipt schema is invalid");
  if (receipt?.disposition !== report?.disposition) reasons.push("Generation 6 result receipt and output disagree on disposition");
  if (selection && !sameJson(receipt?.selected_ids_before_post_selection_robustness, selection.track_selected_ids)) {
    reasons.push("Generation 6 result receipt and output disagree on selected ids");
  }
  if (privateLedger?.schema_version !== "finly_generation6_private_ledger.v1") reasons.push("Generation 6 private-ledger schema is invalid");
  for (const id of [...GENERATION6_CANDIDATE_IDS, "spy_buy_hold", "bil_cash", ...GENERATION6_GROWTH_CONTROL_IDS]) {
    if (!Array.isArray(privateLedger?.simulations?.[id])) reasons.push(`Generation 6 private ledger omits ${id}`);
  }
  return Object.freeze({
    passes: reasons.length === 0,
    reasons: Object.freeze(reasons),
    selection,
  });
}

export function assessGeneration6SourceReconciliation(evidence, expected) {
  const requiredSymbols = GENERATION6_SOURCE_SYMBOLS;
  if (!evidence) {
    return Object.freeze({
      status: "NOT_RUN",
      passes: false,
      candidate_id: expected?.candidate_id ?? null,
      required_symbols: requiredSymbols,
      missing_symbols: requiredSymbols,
      failed_symbols: Object.freeze([]),
      reasons: Object.freeze(["combined external source-reconciliation artifact is absent"]),
    });
  }
  const reasons = [];
  if (evidence.schema_version !== GENERATION6_SOURCE_RECONCILIATION_SCHEMA) reasons.push("unexpected source-reconciliation schema");
  if (evidence.no_network_performed !== true) reasons.push("source reconciliation does not attest no network activity");
  if (evidence.disposition !== "PASS_SOURCE_RECONCILIATION") {
    reasons.push(`source-reconciliation disposition is ${evidence.disposition ?? "missing"}, not PASS_SOURCE_RECONCILIATION`);
  }
  if (evidence.input_integrity?.protocol_sha256 !== expected.source_protocol_sha256) {
    reasons.push("source-reconciliation source-protocol hash mismatch");
  }
  if (evidence.input_integrity?.freeze_receipt_sha256 !== expected.source_freeze_receipt_sha256) {
    reasons.push("source-reconciliation source-freeze hash mismatch");
  }
  if (evidence.input_integrity?.generation6_selection_output_sha256
      !== expected.generation6_output_sha256) {
    reasons.push("source-reconciliation Generation 6 output hash mismatch");
  }
  if (evidence.input_integrity?.yahoo_panel_normalized_sha256
      !== expected.normalized_panel_sha256) {
    reasons.push("source-reconciliation normalized Yahoo panel hash mismatch");
  }
  const reconciliation = evidence.reconciliation;
  if (reconciliation?.schema_version !== GENERATION6_SOURCE_EVIDENCE_SCHEMA) {
    reasons.push("unexpected source-reconciliation evidence schema");
  }
  if (!sameJson(reconciliation?.selection?.tracks, expected.track_selected_ids)) {
    reasons.push("source-reconciliation track selection mismatch");
  }
  if (!sameJson(reconciliation?.selection?.selected_candidate_ids, expected.selected_candidate_ids)) {
    reasons.push("source-reconciliation selected candidate ids mismatch");
  }
  if (!sameJson(reconciliation?.thresholds, GENERATION6_SOURCE_THRESHOLDS)) {
    reasons.push("source-reconciliation threshold registry drifted");
  }
  if (!sameJson(reconciliation?.simulation_options, GENERATION6_SOURCE_SIMULATION_OPTIONS)) {
    reasons.push("source-reconciliation simulation registry drifted");
  }
  if (!sameJson(reconciliation?.source_series_contract, GENERATION6_SOURCE_SERIES_CONTRACT)) {
    reasons.push("source-reconciliation raw-versus-intersection series contract drifted");
  }
  if (!sameJson(reconciliation?.required_symbols_for_overall_gate, requiredSymbols)) {
    reasons.push("source reconciliation does not require all 20 CORE symbols");
  }
  if (reconciliation?.all_20_symbols_reported !== true) {
    reasons.push("source reconciliation does not attest all 20 symbols");
  }
  const perSymbol = evidence.reconciliation?.per_symbol && typeof evidence.reconciliation.per_symbol === "object"
    ? evidence.reconciliation.per_symbol
    : {};
  if (!sameJson(Object.keys(perSymbol), requiredSymbols)) {
    reasons.push("source reconciliation per-symbol registry differs from CORE symbol order");
  }
  const missingSymbols = requiredSymbols.filter((symbol) => !perSymbol[symbol]);
  const failedSymbols = [];
  for (const symbol of requiredSymbols) {
    const item = perSymbol[symbol];
    if (!item) continue;
    const raw = item.raw;
    const sessionCounts = [
      item.yahoo_sessions_in_overlap,
      item.alpaca_all_sessions_in_overlap,
      item.common_sessions,
      item.yahoo_only_date_count,
      item.alpaca_all_only_date_count,
    ];
    if (!sessionCounts.every((value) => Number.isSafeInteger(value) && value >= 0)
        || item.alpaca_all_sessions_in_overlap === 0
        || item.yahoo_sessions_in_overlap === 0
        || item.common_sessions + item.yahoo_only_date_count
          !== item.yahoo_sessions_in_overlap
        || item.common_sessions + item.alpaca_all_only_date_count
          !== item.alpaca_all_sessions_in_overlap) {
      reasons.push(`${symbol} source session counts are internally inconsistent`);
    }
    const coverageFromCounts = item.common_sessions / item.alpaca_all_sessions_in_overlap;
    if (!Number.isFinite(raw?.yahoo_coverage_of_alpaca_dates)
        || Math.abs(raw.yahoo_coverage_of_alpaca_dates - coverageFromCounts) > 1e-15
        || item.yahoo_coverage_of_alpaca_dates !== round(coverageFromCounts)
        || item.alpaca_coverage_of_yahoo_dates
          !== round(item.common_sessions / item.yahoo_sessions_in_overlap)) {
      reasons.push(`${symbol} source coverage differs from session-count recomputation`);
    }
    if (raw?.primary_log_return_metrics?.observations !== item.common_sessions - 1
        || !sameJson(
          item.primary_log_return_metrics,
          presentedSourceMetrics(raw?.primary_log_return_metrics),
        )) {
      reasons.push(`${symbol} presented source metrics differ from raw metrics or overlap count`);
    }
    const recomputedGates = evaluateGeneration6SymbolGates({
      symbol,
      commonSessions: item.common_sessions,
      yahooCoverageOfAlpaca: raw?.yahoo_coverage_of_alpaca_dates,
      rawMetrics: raw?.primary_log_return_metrics ?? {},
      thresholds: GENERATION6_SOURCE_THRESHOLDS,
    });
    const recomputedPass = Object.values(recomputedGates).every(Boolean);
    if (!sameJson(item.gates, recomputedGates)) reasons.push(`${symbol} reported gates differ from raw-metric recomputation`);
    if (item.passed !== recomputedPass) reasons.push(`${symbol} reported pass differs from raw-metric recomputation`);
    if (item.required_for_combined_generation6_gate !== true
        || item.blocks_overall_disposition !== !recomputedPass) {
      reasons.push(`${symbol} overall-gate scope or blocking flag differs from recomputation`);
    }
    if (!recomputedPass) failedSymbols.push(symbol);
  }
  const candidateMap = reconciliation?.candidate_comparison?.candidates;
  if (!sameJson(
    reconciliation?.candidate_comparison?.selected_candidate_ids,
    expected.selected_candidate_ids,
  )) {
    reasons.push("source reconciliation candidate-comparison selected ids differ");
  }
  if (!candidateMap || typeof candidateMap !== "object" || Array.isArray(candidateMap)) {
    reasons.push("source reconciliation candidate comparison is missing");
  } else if (!sameJson(Object.keys(candidateMap), expected.selected_candidate_ids)) {
    reasons.push("source reconciliation candidate comparison ids differ from the frozen selection");
  }
  for (const candidateId of expected.selected_candidate_ids) {
    const item = candidateMap?.[candidateId];
    if (!item) continue;
    if (!sameJson(item.required_symbols, GENERATION6_SOURCE_SYMBOLS_BY_CANDIDATE[candidateId])) {
      reasons.push(`${candidateId} candidate-comparison source symbols differ`);
    }
    const state = item.decision_comparison?.discrete_or_rank_state;
    const rawDecision = item.decision_comparison?.raw;
    const rawReturn = item.raw;
    if (!sameJson(item.return_comparison, presentedSourceMetrics(rawReturn?.return_comparison))) {
      reasons.push(`${candidateId} presented return metrics differ from raw return metrics`);
    }
    if (item.decision_comparison?.target_weight_l1_difference?.mean
          !== round(rawDecision?.mean_target_weight_l1_difference)
        || item.decision_comparison?.target_weight_l1_difference?.p99
          !== round(rawDecision?.p99_target_weight_l1_difference)) {
      reasons.push(`${candidateId} presented target-weight metrics differ from raw metrics`);
    }
    const decisionCount = item.decision_comparison?.decision_count;
    if (state?.applicable === true) {
      const exactFraction = state.exact_count / decisionCount;
      if (!Number.isSafeInteger(decisionCount) || decisionCount <= 0
          || !Number.isSafeInteger(state.exact_count) || state.exact_count < 0
          || state.exact_count > decisionCount
          || Math.abs(rawDecision?.exact_state_agreement_fraction - exactFraction) > 1e-15
          || state.exact_agreement_fraction !== round(exactFraction)) {
        reasons.push(`${candidateId} discrete/rank-state agreement differs from count recomputation`);
      }
    } else if (state?.applicable !== false || state?.exact_count !== null
        || state?.exact_agreement_fraction !== null
        || rawDecision?.exact_state_agreement_fraction !== null) {
      reasons.push(`${candidateId} non-applicable discrete/rank state is internally inconsistent`);
    }
    const yahooEdge = rawReturn?.yahoo_annualized_log_growth_edge;
    const alpacaEdge = rawReturn?.alpaca_annualized_log_growth_edge;
    const presentedEdge = item.candidate_vs_spy_edge;
    if (presentedEdge?.yahoo_annualized_log_growth_edge !== round(yahooEdge)
        || presentedEdge?.alpaca_annualized_log_growth_edge !== round(alpacaEdge)
        || presentedEdge?.absolute_edge_difference_bps_per_year
          !== round(Math.abs(yahooEdge - alpacaEdge) * 10_000)) {
      reasons.push(`${candidateId} presented candidate edge differs from raw edge recomputation`);
    }
    const recomputedGates = evaluateGeneration6CandidateGates({
      stateApplicable: state?.applicable,
      exactStateAgreement: rawDecision?.exact_state_agreement_fraction,
      meanTargetWeightL1Difference: rawDecision?.mean_target_weight_l1_difference,
      p99TargetWeightL1Difference: rawDecision?.p99_target_weight_l1_difference,
      rawReturnMetrics: rawReturn?.return_comparison ?? {},
      yahooEdge,
      alpacaEdge,
      thresholds: GENERATION6_SOURCE_THRESHOLDS,
    });
    const recomputedPass = Object.values(recomputedGates).every(Boolean);
    if (!sameJson(item.gates, recomputedGates)) {
      reasons.push(`${candidateId} reported candidate gates differ from raw-metric recomputation`);
    }
    if (item.passed !== recomputedPass) {
      reasons.push(`${candidateId} reported candidate pass differs from raw-metric recomputation`);
    }
    if (!recomputedPass) reasons.push(`${candidateId} failed recomputed candidate source gates`);
  }
  if (missingSymbols.length > 0) reasons.push(`missing symbols: ${missingSymbols.join(", ")}`);
  if (failedSymbols.length > 0) reasons.push(`failed symbols: ${failedSymbols.join(", ")}`);
  if (reconciliation?.candidate_comparison?.passed !== true) {
    reasons.push("source reconciliation candidate comparison did not pass overall");
  }
  if (!Array.isArray(reconciliation?.blocking_reasons)
      || reconciliation.blocking_reasons.length !== 0) {
    reasons.push("source reconciliation has blocking reasons");
  }
  if (reconciliation?.passed !== true) reasons.push("source reconciliation did not pass overall");
  return Object.freeze({
    status: reasons.length === 0 ? "PASS" : "INVALID_OR_FAILED",
    passes: reasons.length === 0,
    candidate_id: expected.candidate_id,
    required_symbols: Object.freeze([...requiredSymbols]),
    missing_symbols: Object.freeze(missingSymbols),
    failed_symbols: Object.freeze(failedSymbols),
    reasons: Object.freeze(reasons),
    evidence_generated_at: evidence.generated_at ?? null,
    frozen_result_disposition: evidence.disposition ?? null,
  });
}

export function validateGeneration6CombinedSourceArtifactContract({
  evidence,
  evidenceRaw,
  markdownRaw,
  sourceProtocol,
  sourceProtocolRaw,
  sourceFreezeReceipt,
  sourceFreezeReceiptRaw,
  sourceResultReceipt,
  sourceResultReceiptRaw,
  descriptor,
  expected,
}) {
  const reasons = [];
  const byteBindings = [
    [evidenceRaw, descriptor?.sha256, "combined source JSON"],
    [markdownRaw, descriptor?.report_sha256, "combined source Markdown report"],
    [sourceProtocolRaw, descriptor?.protocol_sha256, "combined source protocol"],
    [sourceFreezeReceiptRaw, descriptor?.freeze_receipt_sha256, "combined source freeze receipt"],
    [sourceResultReceiptRaw, descriptor?.result_receipt_sha256, "combined source result receipt"],
  ];
  for (const [raw, expectedHash, label] of byteBindings) {
    if (!Buffer.isBuffer(raw) || hashBytes(raw) !== expectedHash) reasons.push(`${label} byte hash mismatch`);
  }
  for (const [parsed, raw, label] of [
    [evidence, evidenceRaw, "combined source JSON"],
    [sourceProtocol, sourceProtocolRaw, "combined source protocol"],
    [sourceFreezeReceipt, sourceFreezeReceiptRaw, "combined source freeze receipt"],
    [sourceResultReceipt, sourceResultReceiptRaw, "combined source result receipt"],
  ]) {
    try {
      if (!sameJson(parsed, parseJson(raw, label))) reasons.push(`${label} parsed value differs from its bytes`);
    } catch (error) {
      reasons.push(error.message);
    }
  }
  const protocolValidation = validateGeneration6SourceProtocol(sourceProtocol);
  if (!protocolValidation.passes) {
    reasons.push(...protocolValidation.reasons.map((reason) => `source protocol: ${reason}`));
  }
  const freezeValidation = validateGeneration6SourceFreezeReceipt(
    sourceFreezeReceipt,
    sourceProtocolRaw,
  );
  if (!freezeValidation.passes) {
    reasons.push(...freezeValidation.reasons.map((reason) => `source freeze receipt: ${reason}`));
  }
  if (sourceProtocol?.frozen_inputs?.generation6_selection_output?.path
      !== GENERATION6_ROBUSTNESS_PATHS.generation6_output
      || sourceProtocol?.frozen_inputs?.generation6_selection_output?.payload_sha256
        !== expected.generation6_output_sha256) {
    reasons.push("source protocol does not bind the frozen Generation 6 output");
  }
  if (sourceProtocol?.frozen_inputs?.yahoo_generation4_panel?.normalized_panel_sha256
      !== expected.normalized_panel_sha256) {
    reasons.push("source protocol does not bind the frozen normalized Yahoo panel");
  }
  if (evidence?.input_integrity?.yahoo_panel_payload_sha256
      !== sourceProtocol?.frozen_inputs?.yahoo_generation4_panel?.payload_sha256
      || evidence?.input_integrity?.alpaca_all_panel_payload_sha256
        !== sourceProtocol?.frozen_inputs?.alpaca_adjustment_all_panel?.payload_sha256
      || evidence?.input_integrity?.alpaca_all_panel_series_integrity_sha256
        !== sourceProtocol?.frozen_inputs?.alpaca_adjustment_all_panel?.series_integrity_sha256
      || evidence?.input_integrity?.alpaca_all_panel_strategy_intersection_normalized_sha256
        !== sourceProtocol?.frozen_inputs?.alpaca_adjustment_all_panel
          ?.strategy_intersection_normalized_panel_sha256
      || !sameJson(
        evidence?.input_integrity?.alpaca_all_panel_series_integrity_by_symbol,
        sourceProtocol?.frozen_inputs?.alpaca_adjustment_all_panel?.series_integrity_by_symbol,
      )) {
    reasons.push("source report panel integrity differs from its source protocol");
  }
  const reportedAlpacaSource = evidence?.sources?.alpaca_adjustment_all_panel;
  if (reportedAlpacaSource?.schema_version
        !== sourceProtocol?.frozen_inputs?.alpaca_adjustment_all_panel?.schema_version
      || reportedAlpacaSource?.per_symbol_gate_input !== "series_by_symbol"
      || reportedAlpacaSource?.candidate_simulation_input !== "strategy_intersection.points"
      || !sameJson(
        reportedAlpacaSource?.series_integrity_by_symbol,
        sourceProtocol?.frozen_inputs?.alpaca_adjustment_all_panel?.series_integrity_by_symbol,
      )
      || reportedAlpacaSource?.series_integrity_sha256
        !== sourceProtocol?.frozen_inputs?.alpaca_adjustment_all_panel?.series_integrity_sha256
      || reportedAlpacaSource?.strategy_intersection_normalized_panel_sha256
        !== sourceProtocol?.frozen_inputs?.alpaca_adjustment_all_panel
          ?.strategy_intersection_normalized_panel_sha256) {
    reasons.push("source report does not attest the frozen Alpaca v2 raw/intersection inputs");
  }
  if (sourceResultReceipt?.schema_version
      !== "finly_source_overlap_reconciliation_generation6_result_receipt.v1") {
    reasons.push("source result-receipt schema differs");
  }
  if (!sameJson(sourceResultReceipt?.input_integrity, evidence?.input_integrity)) {
    reasons.push("source result receipt and report input integrity differ");
  }
  if (sourceResultReceipt?.files?.[GENERATION6_ROBUSTNESS_PATHS.source_output]
      !== hashBytes(evidenceRaw)
      || sourceResultReceipt?.files?.[GENERATION6_ROBUSTNESS_PATHS.source_report]
        !== hashBytes(markdownRaw)) {
    reasons.push("source result receipt does not pin the combined report artifacts");
  }
  if (sourceResultReceipt?.disposition !== evidence?.disposition
      || !sameJson(sourceResultReceipt?.selected_candidate_ids, expected.selected_candidate_ids)
      || sourceResultReceipt?.no_network_performed !== true
      || sourceResultReceipt?.prior_generation5_overall_disposition_inherited !== false) {
    reasons.push("source result receipt disposition, selection, or boundaries differ");
  }
  const candidateAssessments = Object.freeze(Object.fromEntries(
    expected.selected_candidate_ids.map((candidateId) => [candidateId,
      assessGeneration6SourceReconciliation(evidence, {
        ...expected,
        candidate_id: candidateId,
      })]),
  ));
  if (Object.values(candidateAssessments).some((assessment) => !assessment.passes)) {
    reasons.push("one or more selected candidates failed combined source reconciliation");
  }
  return Object.freeze({
    schema_version: "finly_generation6_combined_source_artifact_contract_assessment.v1",
    status: reasons.length === 0 ? "PASS" : "INVALID_OR_FAILED",
    passes: reasons.length === 0,
    reasons: Object.freeze(reasons),
    selected_candidate_ids: Object.freeze([...expected.selected_candidate_ids]),
    required_symbols_for_overall_gate: GENERATION6_SOURCE_SYMBOLS,
    candidate_assessments: candidateAssessments,
    protocol_validation: protocolValidation,
    freeze_receipt_validation: freezeValidation,
  });
}

function standaloneSliceRows(rows, slice, oneWayCostBps) {
  const selected = rowsWithin(rows, slice.start, slice.end);
  invariant(selected.length >= 2, `too few rows from ${slice.start} through ${slice.end}`);
  return rebaseRowsForStandalonePeriod(selected, {
    cashSymbol: GENERATION6_BASE_OPTIONS.cashSymbol,
    oneWayCostBps,
  });
}

function standaloneSliceMetrics(rows, slice, oneWayCostBps) {
  const metrics = calculatePortfolioMetrics(standaloneSliceRows(rows, slice, oneWayCostBps));
  invariant(metrics, `metrics are unavailable from ${slice.start} through ${slice.end}`);
  return metrics;
}

function strategyRegistry() {
  const strategies = [
    ...createPrimaryStrategies(),
    ...createGeneration4Strategies(),
    ...createGeneration5Strategies(),
    ...createGeneration6Strategies(),
  ];
  const registry = new Map();
  for (const strategy of strategies) {
    invariant(!registry.has(strategy.id), `strategy registry contains duplicate id ${strategy.id}`);
    registry.set(strategy.id, strategy);
  }
  return registry;
}

function createSimulationCache(points) {
  const registry = strategyRegistry();
  const cache = new Map();
  return (id, oneWayCostBps = 5, rebalanceAnchor = 0) => {
    const key = `${id}:${oneWayCostBps}:${rebalanceAnchor}`;
    if (!cache.has(key)) {
      const strategy = registry.get(id);
      invariant(strategy, `strategy registry omits ${id}`);
      cache.set(key, simulateStrategy(points, GENERATION6_REQUIRED_SYMBOLS, strategy, {
        ...GENERATION6_BASE_OPTIONS,
        oneWayCostBps,
        rebalanceAnchor,
      }));
    }
    return cache.get(key);
  };
}

function comparisonEdges(candidateRows, benchmarkRows, oneWayCostBps) {
  return Object.freeze(Object.fromEntries(["development", "validation"].map((sliceId) => {
    const slice = GENERATION6_SLICES[sliceId];
    const candidateMetrics = standaloneSliceMetrics(candidateRows, slice, oneWayCostBps);
    const benchmarkMetrics = standaloneSliceMetrics(benchmarkRows, slice, oneWayCostBps);
    return [sliceId, Object.freeze({
      candidate: candidateMetrics,
      benchmark: benchmarkMetrics,
      annualized_log_growth_edge: annualizedLogGrowthEdge(candidateMetrics, benchmarkMetrics),
    })];
  })));
}

function buildCostStressEvidence(simulate, candidateId, benchmarkIds) {
  const recordsByBenchmark = Object.fromEntries(benchmarkIds.map((benchmarkId) => [benchmarkId, []]));
  const records = GENERATION6_COST_LEVELS_BPS.map((costBps) => {
    const candidate = simulate(candidateId, costBps, 0);
    const comparisons = Object.fromEntries(benchmarkIds.map((benchmarkId) => {
      const benchmark = simulate(benchmarkId, costBps, 0);
      const slices = comparisonEdges(candidate.rows, benchmark.rows, costBps);
      recordsByBenchmark[benchmarkId].push(Object.freeze({
        candidate_id: candidateId,
        benchmark_id: benchmarkId,
        cost_bps: costBps,
        development_spy_annualized_log_growth_edge:
          slices.development.annualized_log_growth_edge,
        validation_spy_annualized_log_growth_edge:
          slices.validation.annualized_log_growth_edge,
      }));
      return [benchmarkId, Object.freeze({
        development: slices.development,
        validation: slices.validation,
        passes: slices.development.annualized_log_growth_edge > 0
          && slices.validation.annualized_log_growth_edge > 0,
      })];
    }));
    return Object.freeze({ cost_bps: costBps, comparisons: Object.freeze(comparisons) });
  });
  const assessments = Object.freeze(Object.fromEntries(benchmarkIds.map((benchmarkId) => [
    benchmarkId,
    assessGeneration6CostSensitivity(recordsByBenchmark[benchmarkId], {
      candidateId,
      benchmarkId,
      minimumAnnualizedLogGrowthEdge: 0,
    }),
  ])));
  return Object.freeze({
    required_cost_levels_bps: GENERATION6_COST_LEVELS_BPS,
    records: Object.freeze(records),
    assessments,
    all_required_comparators_pass: Object.values(assessments).every((item) => item.passes),
  });
}

function buildAnchorStressEvidence(simulate, candidateId, benchmarkIds) {
  const baseBenchmarks = Object.fromEntries(benchmarkIds.map((benchmarkId) => [
    benchmarkId,
    simulate(benchmarkId, 5, 0),
  ]));
  const recordsByBenchmark = Object.fromEntries(benchmarkIds.map((benchmarkId) => [benchmarkId, []]));
  const records = GENERATION6_REBALANCE_ANCHORS.map((anchor) => {
    const candidate = simulate(candidateId, 5, anchor);
    const comparisons = Object.fromEntries(benchmarkIds.map((benchmarkId) => {
      const slices = comparisonEdges(candidate.rows, baseBenchmarks[benchmarkId].rows, 5);
      recordsByBenchmark[benchmarkId].push(Object.freeze({
        candidate_id: candidateId,
        benchmark_id: benchmarkId,
        rebalance_anchor: anchor,
        development_spy_annualized_log_growth_edge:
          slices.development.annualized_log_growth_edge,
        validation_spy_annualized_log_growth_edge:
          slices.validation.annualized_log_growth_edge,
      }));
      return [benchmarkId, Object.freeze({
        development: slices.development,
        validation: slices.validation,
        passes: slices.development.annualized_log_growth_edge > 0
          && slices.validation.annualized_log_growth_edge > 0,
      })];
    }));
    return Object.freeze({ rebalance_anchor: anchor, comparisons: Object.freeze(comparisons) });
  });
  const assessments = Object.freeze(Object.fromEntries(benchmarkIds.map((benchmarkId) => [
    benchmarkId,
    assessGeneration6AnchorSensitivity(recordsByBenchmark[benchmarkId], {
      candidateId,
      benchmarkId,
      minimumAnnualizedLogGrowthEdge: 0,
    }),
  ])));
  return Object.freeze({
    required_rebalance_anchors: GENERATION6_REBALANCE_ANCHORS,
    base_one_way_cost_bps: 5,
    records: Object.freeze(records),
    assessments,
    all_required_comparators_pass: Object.values(assessments).every((item) => item.passes),
  });
}

export function assessGeneration6AnnualOriginConsistency(evidence) {
  invariant(evidence?.schema_version === "finly_champion_annual_origin_windows.v1",
    "annual-origin evidence schema is invalid");
  const horizons = Object.fromEntries(GENERATION6_ANNUAL_ORIGIN_HORIZONS.map((sessions) => {
    const item = evidence.horizons?.[String(sessions)];
    const gates = Object.freeze({
      at_least_one_complete_window: Number.isSafeInteger(item?.window_count) && item.window_count > 0,
      median_annualized_log_growth_difference_strictly_positive:
        Number.isFinite(item?.median_annualized_log_growth_difference)
        && item.median_annualized_log_growth_difference
          > GENERATION6_ANNUAL_ORIGIN_GATES.median_annualized_log_growth_difference_strictly_above,
      positive_fraction_at_least_0_60:
        Number.isFinite(item?.positive_fraction)
        && item.positive_fraction >= GENERATION6_ANNUAL_ORIGIN_GATES.minimum_positive_fraction,
    });
    return [String(sessions), Object.freeze({
      window_count: item?.window_count ?? 0,
      median_annualized_log_growth_difference:
        item?.median_annualized_log_growth_difference ?? null,
      positive_fraction: item?.positive_fraction ?? null,
      gates,
      passes: Object.values(gates).every(Boolean),
    })];
  }));
  return Object.freeze({
    schema_version: "finly_generation6_annual_origin_consistency_assessment.v1",
    candidate_id: evidence.candidate_id,
    benchmark_id: evidence.benchmark_id,
    slice: "validation_only",
    required_horizons_sessions: GENERATION6_ANNUAL_ORIGIN_HORIZONS,
    thresholds: GENERATION6_ANNUAL_ORIGIN_GATES,
    horizons: Object.freeze(horizons),
    passes: Object.values(horizons).every((item) => item.passes),
    interpretation: "Annual-origin validation windows may overlap. They are descriptive consistency checks, not independent trials or a restored holdout.",
  });
}

function compoundRows(rows) {
  return rows.reduce((equity, row) => equity * (1 + row.net_return), 1) - 1;
}

export function rebaseGeneration6AnnualOriginWindow(rows, startIndex, sessions, {
  cashSymbol = "BIL",
  oneWayCostBps = 5,
} = {}) {
  invariant(Array.isArray(rows), "annual-origin window rows are not an array");
  invariant(Number.isSafeInteger(startIndex) && startIndex >= 0,
    "annual-origin start index is invalid");
  invariant(Number.isSafeInteger(sessions) && sessions > 0,
    "annual-origin session count is invalid");
  invariant(startIndex + sessions <= rows.length, "annual-origin window is incomplete");
  return rebaseRowsForStandalonePeriod(rows.slice(startIndex, startIndex + sessions), {
    cashSymbol,
    oneWayCostBps,
  });
}

export function independentlyRebasedGeneration6AnnualOriginSummaries(
  candidateRows,
  benchmarkRows,
  {
    candidateId,
    benchmarkId,
    horizons = GENERATION6_ANNUAL_ORIGIN_HORIZONS,
    periodsPerYear = 252,
    cashSymbol = "BIL",
    oneWayCostBps = 5,
  },
) {
  invariant(Array.isArray(candidateRows) && Array.isArray(benchmarkRows),
    "annual-origin candidate and benchmark rows are required");
  invariant(candidateRows.length === benchmarkRows.length && candidateRows.length >= 2,
    "annual-origin candidate and benchmark rows differ in length");
  invariant(candidateId !== benchmarkId, "annual-origin candidate and benchmark ids must differ");
  const dates = candidateRows.map((row, index) => {
    invariant(row.execution_return_date === benchmarkRows[index]?.execution_return_date,
      `annual-origin rows differ in date at index ${index}`);
    return row.execution_return_date;
  });
  const firstIndexByYear = new Map();
  dates.forEach((date, index) => {
    const year = date.slice(0, 4);
    if (!firstIndexByYear.has(year)) firstIndexByYear.set(year, index);
  });
  const horizonsEvidence = Object.fromEntries(horizons.map((sessions) => {
    const windows = [...firstIndexByYear.entries()]
      .filter(([, startIndex]) => startIndex + sessions <= candidateRows.length)
      .map(([year, startIndex]) => {
        const candidateWindow = rebaseGeneration6AnnualOriginWindow(
          candidateRows,
          startIndex,
          sessions,
          { cashSymbol, oneWayCostBps },
        );
        const benchmarkWindow = rebaseGeneration6AnnualOriginWindow(
          benchmarkRows,
          startIndex,
          sessions,
          { cashSymbol, oneWayCostBps },
        );
        const candidateTotalReturn = compoundRows(candidateWindow);
        const benchmarkTotalReturn = compoundRows(benchmarkWindow);
        const candidateAnnualized = Math.log1p(candidateTotalReturn) * periodsPerYear / sessions;
        const benchmarkAnnualized = Math.log1p(benchmarkTotalReturn) * periodsPerYear / sessions;
        return Object.freeze({
          origin_year: Number(year),
          start_date: dates[startIndex],
          end_date: dates[startIndex + sessions - 1],
          start_index_within_validation: startIndex,
          sessions,
          candidate_total_return: round(candidateTotalReturn),
          benchmark_total_return: round(benchmarkTotalReturn),
          total_return_difference: round(candidateTotalReturn - benchmarkTotalReturn),
          candidate_annualized_log_growth: round(candidateAnnualized),
          benchmark_annualized_log_growth: round(benchmarkAnnualized),
          annualized_log_growth_difference: round(candidateAnnualized - benchmarkAnnualized),
          beats_benchmark: candidateAnnualized > benchmarkAnnualized,
          independent_boundary_rebase: Object.freeze({
            method: "FRESH_BIL_ENTRY_AND_TERMINAL_LIQUIDATION_FOR_EVERY_ORIGIN_HORIZON",
            cash_symbol: cashSymbol,
            one_way_cost_bps: oneWayCostBps,
            candidate_rows_sha256: sha256(candidateWindow),
            benchmark_rows_sha256: sha256(benchmarkWindow),
            candidate_entry_cost: candidateWindow[0].standalone_entry_cost,
            candidate_terminal_liquidation_cost:
              candidateWindow.at(-1).standalone_terminal_liquidation_cost,
            benchmark_entry_cost: benchmarkWindow[0].standalone_entry_cost,
            benchmark_terminal_liquidation_cost:
              benchmarkWindow.at(-1).standalone_terminal_liquidation_cost,
          }),
        });
      });
    const differences = windows.map((window) => window.annualized_log_growth_difference);
    const sortedDifferences = [...differences].sort((left, right) => left - right);
    const middle = Math.floor(sortedDifferences.length / 2);
    const median = sortedDifferences.length === 0
      ? null
      : sortedDifferences.length % 2 === 1
        ? sortedDifferences[middle]
        : (sortedDifferences[middle - 1] + sortedDifferences[middle]) / 2;
    const positiveCount = windows.filter((window) => window.beats_benchmark).length;
    const worst = windows.length === 0 ? null : windows.reduce((left, right) => (
      right.annualized_log_growth_difference < left.annualized_log_growth_difference ? right : left
    ));
    const best = windows.length === 0 ? null : windows.reduce((left, right) => (
      right.annualized_log_growth_difference > left.annualized_log_growth_difference ? right : left
    ));
    return [String(sessions), Object.freeze({
      window_sessions: sessions,
      window_count: windows.length,
      first_origin_year: windows[0]?.origin_year ?? null,
      last_origin_year: windows.at(-1)?.origin_year ?? null,
      median_annualized_log_growth_difference: median === null ? null : round(median),
      positive_fraction: windows.length === 0 ? null : round(positiveCount / windows.length),
      all_windows_beat_benchmark: windows.length > 0 && positiveCount === windows.length,
      worst_window: worst === null ? null : Object.freeze({
        origin_year: worst.origin_year,
        start_date: worst.start_date,
        end_date: worst.end_date,
        annualized_log_growth_difference: worst.annualized_log_growth_difference,
      }),
      best_window: best === null ? null : Object.freeze({
        origin_year: best.origin_year,
        start_date: best.start_date,
        end_date: best.end_date,
        annualized_log_growth_difference: best.annualized_log_growth_difference,
      }),
      windows: Object.freeze(windows),
    })];
  }));
  return Object.freeze({
    schema_version: "finly_champion_annual_origin_windows.v1",
    candidate_id: candidateId,
    benchmark_id: benchmarkId,
    periods_per_year: periodsPerYear,
    origin_definition: "First scored session in each validation calendar year; incomplete trailing windows are omitted.",
    boundary_cost_definition: "Every origin/horizon independently starts from BIL, pays a fresh 5 bp entry, and pays terminal liquidation; inherited terminal markers are removed by the canonical standalone rebase.",
    dependence_boundary: "Annual-origin windows can overlap and are descriptive robustness slices, not independent trials.",
    observations: candidateRows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    horizons: Object.freeze(horizonsEvidence),
  });
}

export function buildGeneration6AnnualOriginConsistency(rowsById, candidateId, benchmarkIds) {
  invariant(Array.isArray(rowsById?.[candidateId]), `annual-origin rows omit ${candidateId}`);
  const validationRows = Object.fromEntries([candidateId, ...benchmarkIds].map((id) => {
    invariant(Array.isArray(rowsById?.[id]), `annual-origin rows omit ${id}`);
    const rows = rowsWithin(
      rowsById[id],
      GENERATION6_SLICES.validation.start,
      GENERATION6_SLICES.validation.end,
    );
    invariant(rows.length >= 2, `annual-origin validation rows are insufficient for ${id}`);
    return [id, rows];
  }));
  const comparisons = Object.fromEntries(benchmarkIds.map((benchmarkId) => {
    const evidence = independentlyRebasedGeneration6AnnualOriginSummaries(
      validationRows[candidateId],
      validationRows[benchmarkId],
      {
      candidateId,
      benchmarkId,
      horizons: GENERATION6_ANNUAL_ORIGIN_HORIZONS,
      periodsPerYear: 252,
        cashSymbol: "BIL",
        oneWayCostBps: 5,
      },
    );
    return [benchmarkId, Object.freeze({
      evidence,
      assessment: assessGeneration6AnnualOriginConsistency(evidence),
    })];
  }));
  return Object.freeze({
    slice: "validation_only",
    comparisons: Object.freeze(comparisons),
    all_required_comparators_pass: Object.values(comparisons)
      .every((item) => item.assessment.passes),
  });
}

function buildValidationStatisticalEvidence(rowsById, fixedCandidateId) {
  const ids = [...GENERATION6_CANDIDATE_IDS, "spy_buy_hold"];
  const validationRows = Object.fromEntries(ids.map((id) => [
    id,
    standaloneSliceRows(rowsById[id], GENERATION6_SLICES.validation, 5),
  ]));
  const paired = buildGeneration6PairedRows(validationRows, ids);
  const evidence = buildGeneration6StatisticalEvidence(
    paired,
    GENERATION6_CANDIDATE_IDS,
    fixedCandidateId,
    {
      benchmarkId: "spy_buy_hold",
      cumulativeTrialCount: GENERATION6_CUMULATIVE_TRIALS,
      iterations: GENERATION6_BOOTSTRAP_ITERATIONS,
    },
  );
  return Object.freeze({
    slice: "validation_only",
    start_date: paired[0].execution_return_date,
    end_date: paired.at(-1).execution_return_date,
    evidence,
    passes: evidence.passes,
  });
}

function buildValidationGrowthJointStatisticalEvidence(rowsById, fixedCandidateId) {
  if (fixedCandidateId === null) {
    return buildGeneration6GrowthJointStatisticalEvidence(null, null);
  }
  const ids = [
    ...GENERATION6_GROWTH_STATISTICS_CANDIDATE_IDS,
    ...GENERATION6_GROWTH_STATISTICS_CONTROL_IDS,
  ];
  const validationRows = Object.fromEntries(ids.map((id) => {
    invariant(Array.isArray(rowsById?.[id]), `growth statistical rows omit ${id}`);
    return [id, standaloneSliceRows(rowsById[id], GENERATION6_SLICES.validation, 5)];
  }));
  const paired = buildGeneration6PairedRows(validationRows, ids);
  const evidence = buildGeneration6GrowthJointStatisticalEvidence(
    paired,
    fixedCandidateId,
    { iterations: GENERATION6_BOOTSTRAP_ITERATIONS },
  );
  return Object.freeze({
    ...evidence,
    slice: "validation_only",
    start_date: paired[0].execution_return_date,
    end_date: paired.at(-1).execution_return_date,
    boundary_cost_definition: "Each candidate and control is independently rebased for validation from BIL with a fresh 5 bp entry and terminal liquidation before exact date alignment.",
  });
}

function buildRiskMatchedSpyEvidence(rowsById, candidateId) {
  const paired = buildGeneration6PairedRows(rowsById, [candidateId, "spy_buy_hold", "bil_cash"]);
  const evidence = buildCausalVolatilityMatchedSpyComparator(paired, {
    candidateId,
    spyId: "spy_buy_hold",
    cashId: "bil_cash",
    lookbackSessions: GENERATION6_VOLATILITY_MATCH_SPECIFICATION.lookback_sessions,
    rebalanceIntervalSessions:
      GENERATION6_VOLATILITY_MATCH_SPECIFICATION.rebalance_interval_sessions,
    rebalanceAnchor: 0,
    minimumSpyWeight: GENERATION6_VOLATILITY_MATCH_SPECIFICATION.minimum_spy_weight,
    maximumSpyWeight: GENERATION6_VOLATILITY_MATCH_SPECIFICATION.maximum_spy_weight,
    oneWayCostBps: GENERATION6_VOLATILITY_MATCH_SPECIFICATION.base_one_way_cost_bps,
    annualBorrowSpread: GENERATION6_VOLATILITY_MATCH_SPECIFICATION.annual_borrow_spread,
    terminalLiquidation: true,
  });
  const firstEstimate = evidence.rows.find((row) => row.volatility_match.rebalanced)
    ?.execution_return_date;
  invariant(firstEstimate, `risk-matched SPY has no warmup-complete estimate for ${candidateId}`);
  const effectiveSlices = Object.freeze({
    development: Object.freeze({
      start: firstEstimate > GENERATION6_SLICES.development.start
        ? firstEstimate
        : GENERATION6_SLICES.development.start,
      end: GENERATION6_SLICES.development.end,
    }),
    validation: GENERATION6_SLICES.validation,
  });
  invariant(effectiveSlices.development.start <= effectiveSlices.development.end,
    `risk-matched warmup consumes the entire development slice for ${candidateId}`);
  const assessment = assessCausalVolatilityMatchedSpySlices(evidence, effectiveSlices);
  return Object.freeze({
    evidence,
    effective_scoring_slices_after_full_row_warmup: effectiveSlices,
    assessment,
    passes: assessment.passes,
  });
}

function verifyBaseReplay(rowsById, simulate, ids) {
  const evidence = Object.fromEntries(ids.map((id) => {
    const replayRows = simulate(id, 5, 0).rows;
    const frozenRows = rowsById[id];
    const replayHash = sha256(replayRows);
    const frozenHash = sha256(frozenRows);
    return [id, Object.freeze({
      exact_match: replayHash === frozenHash,
      replay_rows: replayRows.length,
      frozen_rows: frozenRows.length,
      replay_rows_sha256: replayHash,
      frozen_rows_sha256: frozenHash,
    })];
  }));
  return Object.freeze({
    strategies: Object.freeze(evidence),
    all_required_base_simulations_match_frozen_private_ledger_exactly:
      Object.values(evidence).every((item) => item.exact_match),
  });
}

export function summarizeGeneration6CandidateRobustness({
  candidateId,
  tracks,
  statistical,
  costStress,
  anchorStress,
  riskMatchedSpy,
  annualOrigin,
  sourceReconciliation,
  growthJointStatistical,
}) {
  invariant(Array.isArray(tracks) && tracks.length > 0, "candidate tracks are required");
  const spyCost = costStress?.assessments?.spy_buy_hold;
  const spyAnchor = anchorStress?.assessments?.spy_buy_hold;
  const spyAnnual = annualOrigin?.comparisons?.spy_buy_hold?.assessment;
  const coreSummary = summarizeGeneration6PostSelectionRobustness({
    statistical,
    costSensitivity: spyCost,
    anchorSensitivity: spyAnchor,
    riskMatchedSpy: riskMatchedSpy?.assessment,
    sourceReconciliationPasses: sourceReconciliation?.passes === true,
  });
  const primaryComponents = Object.freeze({
    helper_core_summary: coreSummary.passes,
    validation_annual_origin_consistency_vs_spy: spyAnnual?.passes === true,
  });
  const primaryPasses = Object.values(primaryComponents).every(Boolean);
  const growthApplicable = tracks.includes("growth_control_challenge");
  const growthByComparator = Object.freeze(Object.fromEntries(
    GENERATION6_GROWTH_CONTROL_IDS.map((benchmarkId) => [benchmarkId, Object.freeze({
      cost_sensitivity: costStress?.assessments?.[benchmarkId]?.passes === true,
      rebalance_anchor_sensitivity: anchorStress?.assessments?.[benchmarkId]?.passes === true,
      validation_annual_origin_consistency:
        annualOrigin?.comparisons?.[benchmarkId]?.assessment?.passes === true,
    })]),
  ));
  const growthComponents = Object.freeze({
    primary_spy_robustness: primaryPasses,
    joint_mean_log_growth_statistical_gate: !growthApplicable
      || growthJointStatistical?.passes === true,
    every_growth_control_cost_stress_passes: !growthApplicable
      || Object.values(growthByComparator).every((item) => item.cost_sensitivity),
    every_growth_control_anchor_stress_passes: !growthApplicable
      || Object.values(growthByComparator).every((item) => item.rebalance_anchor_sensitivity),
    every_growth_control_annual_origin_consistency_passes: !growthApplicable
      || Object.values(growthByComparator).every((item) => item.validation_annual_origin_consistency),
  });
  const growthPasses = growthApplicable && Object.values(growthComponents).every(Boolean);
  return Object.freeze({
    schema_version: "finly_generation6_candidate_post_selection_robustness_summary.v1",
    candidate_id: candidateId,
    tracks: Object.freeze([...tracks]),
    core_helper_summary: coreSummary,
    primary_spy: Object.freeze({ components: primaryComponents, passes: primaryPasses }),
    growth_control_challenge: Object.freeze({
      applicable: growthApplicable,
      evidence_class: "PENALIZED_RETROSPECTIVE_JOINT_MEAN_LOG_GROWTH_TEST",
      statistical_superiority_tested: growthApplicable,
      joint_statistical_evidence: growthApplicable ? growthJointStatistical : null,
      by_comparator: growthByComparator,
      components: growthComponents,
      passes: growthPasses,
    }),
    claim_boundary: "A pass is a hash-frozen retrospective robustness disposition only. It is not a guarantee of future profit, pristine out-of-sample evidence, exact options P&L, or proof against unreproducible competitors.",
  });
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

async function readPinned(relativePath, expectedHash, label) {
  invariant(isSha256(expectedHash), `${label} expected hash is invalid`);
  const raw = await readFile(safeProjectPath(relativePath, label));
  invariant(hashBytes(raw) === expectedHash, `${label} hash mismatch`);
  return raw;
}

async function verifyFileMap(files, label) {
  invariant(files && typeof files === "object" && !Array.isArray(files), `${label} file map is missing`);
  const verified = {};
  for (const [relativePath, expectedHash] of Object.entries(files)) {
    const raw = await readPinned(relativePath, expectedHash, `${label} file ${relativePath}`);
    verified[relativePath] = hashBytes(raw);
  }
  return Object.freeze(verified);
}

async function readCombinedSourceReconciliation(descriptor, expected) {
  try {
    const [artifactRaw, markdownRaw, protocolRaw, freezeReceiptRaw, resultReceiptRaw] = await Promise.all([
      readPinned(descriptor.path, descriptor.sha256, "combined source artifact"),
      readPinned(descriptor.report_path, descriptor.report_sha256, "combined source Markdown report"),
      readPinned(
        descriptor.protocol_path,
        descriptor.protocol_sha256,
        "combined source protocol",
      ),
      readPinned(
        descriptor.freeze_receipt_path,
        descriptor.freeze_receipt_sha256,
        "combined source freeze receipt",
      ),
      readPinned(
        descriptor.result_receipt_path,
        descriptor.result_receipt_sha256,
        "combined source result receipt",
      ),
    ]);
    const evidence = parseJson(artifactRaw, "combined source artifact");
    const sourceProtocol = parseJson(protocolRaw, "combined source protocol");
    const sourceFreezeReceipt = parseJson(freezeReceiptRaw, "combined source freeze receipt");
    const sourceResultReceipt = parseJson(resultReceiptRaw, "combined source result receipt");
    const verifiedFiles = await verifyFileMap(
      sourceFreezeReceipt.files,
      "combined source freeze receipt",
    );
    const contract = validateGeneration6CombinedSourceArtifactContract({
      evidence,
      evidenceRaw: artifactRaw,
      markdownRaw,
      sourceProtocol,
      sourceProtocolRaw: protocolRaw,
      sourceFreezeReceipt,
      sourceFreezeReceiptRaw: freezeReceiptRaw,
      sourceResultReceipt,
      sourceResultReceiptRaw: resultReceiptRaw,
      descriptor,
      expected,
    });
    return Object.freeze({
      ...contract,
      artifact_path: descriptor.path,
      artifact_sha256: hashBytes(artifactRaw),
      report_path: descriptor.report_path,
      report_sha256: hashBytes(markdownRaw),
      protocol_path: descriptor.protocol_path,
      protocol_sha256: hashBytes(protocolRaw),
      freeze_receipt_path: descriptor.freeze_receipt_path,
      freeze_receipt_sha256: hashBytes(freezeReceiptRaw),
      result_receipt_path: descriptor.result_receipt_path,
      result_receipt_sha256: hashBytes(resultReceiptRaw),
      verified_source_freeze_files: verifiedFiles,
      read_error: null,
    });
  } catch (error) {
    return Object.freeze({
      schema_version: "finly_generation6_combined_source_artifact_contract_assessment.v1",
      passes: false,
      status: "READ_ERROR_FAIL_CLOSED",
      reasons: Object.freeze([error.message]),
      selected_candidate_ids: Object.freeze([...expected.selected_candidate_ids]),
      required_symbols_for_overall_gate: GENERATION6_SOURCE_SYMBOLS,
      candidate_assessments: Object.freeze(Object.fromEntries(
        expected.selected_candidate_ids.map((candidateId) => [candidateId,
          assessGeneration6SourceReconciliation(null, { ...expected, candidate_id: candidateId })]),
      )),
      artifact_path: descriptor.path,
      artifact_sha256: null,
      report_path: descriptor.report_path,
      report_sha256: null,
      protocol_path: descriptor.protocol_path,
      protocol_sha256: null,
      freeze_receipt_path: descriptor.freeze_receipt_path,
      freeze_receipt_sha256: null,
      result_receipt_path: descriptor.result_receipt_path,
      result_receipt_sha256: null,
      verified_source_freeze_files: Object.freeze({}),
      read_error: error.message,
    });
  }
}

async function loadFrozenGeneration6RobustnessInputs() {
  const basePaths = {
    generation6_protocol: GENERATION6_ROBUSTNESS_PATHS.generation6_protocol,
    generation6_freeze_receipt: GENERATION6_ROBUSTNESS_PATHS.generation6_freeze_receipt,
    generation6_trial_ledger: GENERATION6_ROBUSTNESS_PATHS.generation6_trial_ledger,
    generation6_output: GENERATION6_ROBUSTNESS_PATHS.generation6_output,
    generation6_result_receipt: GENERATION6_ROBUSTNESS_PATHS.generation6_result_receipt,
  };
  const [robustnessProtocolRaw, robustnessReceiptRaw, ...baseRaws] = await Promise.all([
    readFile(robustnessProtocolPath),
    readFile(robustnessFreezeReceiptPath),
    ...Object.values(basePaths).map((relativePath) => readFile(safeProjectPath(relativePath, relativePath))),
  ]);
  const baseRawById = Object.fromEntries(Object.keys(basePaths).map((id, index) => [id, baseRaws[index]]));
  const robustnessProtocol = parseJson(robustnessProtocolRaw, "Generation 6 robustness protocol");
  const robustnessReceipt = parseJson(robustnessReceiptRaw, "Generation 6 robustness freeze receipt");
  const generation6Protocol = parseJson(baseRawById.generation6_protocol, "Generation 6 protocol");
  const generation6FreezeReceipt = parseJson(
    baseRawById.generation6_freeze_receipt,
    "Generation 6 freeze receipt",
  );
  const trialLedger = parseJson(baseRawById.generation6_trial_ledger, "Generation 6 trial ledger");
  const generation6Output = parseJson(baseRawById.generation6_output, "Generation 6 output");
  const generation6ResultReceipt = parseJson(
    baseRawById.generation6_result_receipt,
    "Generation 6 result receipt",
  );
  const generation6ProtocolValidation = validateGeneration6Protocol(generation6Protocol, trialLedger);
  invariant(generation6ProtocolValidation.passes,
    `Generation 6 protocol validation failed: ${generation6ProtocolValidation.reasons.join("; ")}`);
  invariant(generation6FreezeReceipt?.schema_version
    === "finly_champion_search_generation6_freeze_receipt.v1",
  "Generation 6 freeze-receipt schema mismatch");
  invariant(generation6FreezeReceipt?.generation_6_results_seen_at_freeze === false,
    "Generation 6 freeze receipt says results were seen");
  invariant(generation6FreezeReceipt?.generation_6_output_absent_at_freeze === true,
    "Generation 6 freeze receipt does not attest output absence");
  invariant(generation6FreezeReceipt?.market_fetch_permitted === false,
    "Generation 6 freeze receipt permits a market fetch");
  const verifiedGeneration6FreezeFiles = await verifyFileMap(
    generation6FreezeReceipt.files,
    "Generation 6 freeze receipt",
  );
  const baseHashes = Object.fromEntries(Object.entries(baseRawById).map(([id, raw]) => [id, hashBytes(raw)]));
  invariant(generation6Output?.input_integrity?.protocol_sha256 === baseHashes.generation6_protocol,
    "Generation 6 output protocol hash mismatch");
  invariant(generation6Output?.input_integrity?.trial_ledger_sha256
    === baseHashes.generation6_trial_ledger,
  "Generation 6 output trial-ledger hash mismatch");
  invariant(generation6Output?.input_integrity?.freeze_receipt_sha256
    === baseHashes.generation6_freeze_receipt,
  "Generation 6 output freeze-receipt hash mismatch");
  invariant(generation6ResultReceipt?.files?.[GENERATION6_ROBUSTNESS_PATHS.generation6_output]
    === baseHashes.generation6_output,
  "Generation 6 result receipt does not pin the output bytes");

  const ledgerFilename = generation6Output?.dataset?.private_generation_6_ledger_filename;
  const privateLedgerPath = safePrivateLedgerPath(ledgerFilename);
  const privateLedgerRaw = await readFile(privateLedgerPath);
  const privateLedgerRelativePath = `data/private/champion_search/${ledgerFilename}`;
  const privateLedgerHash = hashBytes(privateLedgerRaw);
  invariant(privateLedgerHash === generation6Output?.dataset?.private_generation_6_ledger_gzip_sha256,
    "Generation 6 private-ledger byte hash mismatch");
  invariant(ledgerFilename === `generation6_ledger_${privateLedgerHash}.json.gz`,
    "Generation 6 private ledger is not named by its byte hash");
  invariant(generation6ResultReceipt?.files?.[privateLedgerRelativePath] === privateLedgerHash,
    "Generation 6 result receipt does not pin the private ledger");
  const privateLedger = parseJson(gunzipSync(privateLedgerRaw), "Generation 6 private ledger");
  const selectionValidation = validateGeneration6FrozenSelection(
    generation6Output,
    generation6ResultReceipt,
    privateLedger,
  );
  invariant(selectionValidation.passes,
    `Generation 6 frozen selection validation failed: ${selectionValidation.reasons.join("; ")}`);
  const selection = selectionValidation.selection;

  const panelDescriptor = robustnessProtocol?.frozen_inputs?.private_panel;
  const panelRaw = await readPinned(panelDescriptor?.path, panelDescriptor?.sha256, "frozen private panel");
  const panel = parseJson(panelRaw, "frozen private panel");
  invariant(Array.isArray(panel?.points) && panel.points.length >= 756,
    "frozen private panel has insufficient rows");
  invariant(generation6Output?.dataset?.reused_private_panel_path === panelDescriptor.path,
    "Generation 6 output and robustness protocol disagree on private-panel path");
  invariant(generation6Output?.dataset?.normalized_panel_sha256 === panel.normalized_panel_sha256,
    "Generation 6 output and private panel disagree on normalized hash");
  const normalizedPanelHash = sha256(panel.points.map((point) => [
    point.date,
    ...GENERATION6_REQUIRED_SYMBOLS.map((symbol) => round(point[symbol], 10)),
  ]));
  invariant(normalizedPanelHash === panel.normalized_panel_sha256,
    "frozen private-panel normalized hash cannot be reproduced");
  let priorDate = "";
  for (const point of panel.points) {
    invariant(typeof point.date === "string" && point.date > priorDate,
      "frozen private-panel dates are not strictly chronological");
    priorDate = point.date;
    for (const symbol of GENERATION6_REQUIRED_SYMBOLS) {
      invariant(Number.isFinite(point[symbol]) && point[symbol] > 0,
        `frozen private panel has invalid ${symbol} at ${point.date}`);
    }
  }
  invariant(privateLedger.protocol_sha256 === baseHashes.generation6_protocol,
    "Generation 6 private ledger protocol hash mismatch");
  invariant(privateLedger.normalized_panel_sha256 === normalizedPanelHash,
    "Generation 6 private ledger panel hash mismatch");

  const bindings = Object.freeze({
    ...baseHashes,
    generation6_private_ledger: privateLedgerHash,
    private_panel: hashBytes(panelRaw),
    normalized_panel_sha256: normalizedPanelHash,
  });
  const robustnessProtocolValidation = validateGeneration6RobustnessProtocol(
    robustnessProtocol,
    selection,
    bindings,
  );
  invariant(robustnessProtocolValidation.passes,
    `Generation 6 robustness protocol validation failed: ${robustnessProtocolValidation.reasons.join("; ")}`);
  invariant(robustnessProtocol.frozen_inputs.generation6_private_ledger.path
    === privateLedgerRelativePath,
  "robustness protocol private-ledger path mismatch");
  invariant(robustnessReceipt?.schema_version
    === "finly_champion_generation6_robustness_freeze_receipt.v1",
  "Generation 6 robustness freeze-receipt schema mismatch");
  invariant(robustnessReceipt?.status === "frozen_before_first_post_selection_robustness_output",
    "Generation 6 robustness freeze receipt has the wrong status");
  invariant(robustnessReceipt?.robustness_results_seen_at_freeze === false,
    "Generation 6 robustness results were seen at freeze");
  invariant(robustnessReceipt?.robustness_output_absent_at_freeze === true,
    "Generation 6 robustness output was not absent at freeze");
  invariant(robustnessReceipt?.market_fetch_permitted === false,
    "Generation 6 robustness freeze receipt permits a market fetch");
  invariant(robustnessReceipt?.protocol_sha256 === hashBytes(robustnessProtocolRaw),
    "Generation 6 robustness freeze receipt does not pin its protocol");
  const requiredRobustnessFreezeFiles = [
    GENERATION6_ROBUSTNESS_PATHS.robustness_protocol,
    "research/champion_generation6_robustness.mjs",
    "research/champion_generation6_growth_statistics.mjs",
    "research/run_quant_champion_generation6_robustness.mjs",
    "tests/champion_generation6_growth_statistics.test.mjs",
    "tests/champion_generation6_robustness_runner.test.mjs",
    ...Object.values(basePaths),
    privateLedgerRelativePath,
    panelDescriptor.path,
    ...(sourceDescriptor(robustnessProtocol) === null ? [] : [
      sourceDescriptor(robustnessProtocol).path,
      sourceDescriptor(robustnessProtocol).report_path,
      sourceDescriptor(robustnessProtocol).protocol_path,
      sourceDescriptor(robustnessProtocol).freeze_receipt_path,
      sourceDescriptor(robustnessProtocol).result_receipt_path,
    ]),
  ];
  for (const relativePath of requiredRobustnessFreezeFiles) {
    invariant(robustnessReceipt?.files?.[relativePath],
      `Generation 6 robustness freeze receipt omits ${relativePath}`);
  }
  const verifiedRobustnessFreezeFiles = await verifyFileMap(
    robustnessReceipt.files,
    "Generation 6 robustness freeze receipt",
  );
  return Object.freeze({
    robustnessProtocol,
    robustnessReceipt,
    robustnessProtocolValidation,
    generation6Protocol,
    generation6FreezeReceipt,
    generation6ProtocolValidation,
    trialLedger,
    generation6Output,
    generation6ResultReceipt,
    privateLedger,
    panel,
    selection,
    hashes: Object.freeze({
      robustness_protocol_sha256: hashBytes(robustnessProtocolRaw),
      robustness_freeze_receipt_sha256: hashBytes(robustnessReceiptRaw),
      ...bindings,
    }),
    verifiedGeneration6FreezeFiles,
    verifiedRobustnessFreezeFiles,
  });
}

function compactRiskMatchedEvidence(value) {
  return Object.freeze({
    schema_version: value.evidence.schema_version,
    role: value.evidence.role,
    candidate_id: value.evidence.candidate_id,
    comparator_id: value.evidence.comparator_id,
    observations: value.evidence.observations,
    start_date: value.evidence.start_date,
    end_date: value.evidence.end_date,
    specification: value.evidence.specification,
    causality_boundary: value.evidence.causality_boundary,
    financing_boundary: value.evidence.financing_boundary,
    interpretation_boundary: value.evidence.interpretation_boundary,
    rows_sha256: sha256(value.evidence.rows),
    effective_scoring_slices_after_full_row_warmup:
      value.effective_scoring_slices_after_full_row_warmup,
    assessment: value.assessment,
    passes: value.passes,
  });
}

function candidateTrackDisposition(summary, track) {
  if (track === "primary_spy") return summary.primary_spy.passes;
  if (track === "growth_control_challenge") return summary.growth_control_challenge.passes;
  throw new Error(`unknown robustness track ${track}`);
}

function renderMarkdown(report) {
  const candidateRows = report.selection.unique_candidate_ids.map((candidateId) => {
    const candidate = report.candidates[candidateId];
    const statisticalProbability = candidate.statistical.evidence.deflated_sharpe
      .deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark;
    const riskDevelopment = candidate.causal_volatility_matched_spy.assessment
      .assessments.development;
    const riskValidation = candidate.causal_volatility_matched_spy.assessment
      .assessments.validation;
    return `| ${candidateId} | ${candidate.summary.primary_spy.passes ? "PASS" : "FAIL"} | ${candidate.summary.growth_control_challenge.applicable ? (candidate.summary.growth_control_challenge.passes ? "PASS" : "FAIL") : "n/a"} | ${(100 * statisticalProbability).toFixed(2)}% | ${(100 * riskDevelopment.annualized_log_growth_edge).toFixed(2)}% / ${riskDevelopment.realized_candidate_to_comparator_volatility_ratio.toFixed(3)} | ${(100 * riskValidation.annualized_log_growth_edge).toFixed(2)}% / ${riskValidation.realized_candidate_to_comparator_volatility_ratio.toFixed(3)} | ${candidate.source_reconciliation.status} |`;
  }).join("\n") || "| none | n/a | n/a | n/a | n/a | n/a | n/a |";
  const trackRows = Object.entries(report.track_results).map(([track, item]) => (
    `| ${track} | ${item.selected_id ?? "none"} | ${item.status} |`
  )).join("\n");
  return `# Finly Generation 6 post-selection robustness\n\n## Answer first\n\n**${report.disposition}**. This runner evaluated each deduplicated frozen winner without making a market request. A pass is retrospective shadow evidence, not a future-profit claim.\n\n| Candidate | SPY track | Joint growth-control track | Validation DSR vs SPY | Development risk-match edge / vol ratio | Validation risk-match edge / vol ratio | Source reconciliation |\n|---|---|---|---:|---:|---:|---|\n${candidateRows}\n\n## Frozen track results\n\n| Track | Selected candidate | Status |\n|---|---|---|\n${trackRows}\n\n## What was required\n\n- Positive development and validation annualized log-growth edge at 5, 10, and 25 bp.\n- Positive development and validation edge at every 21-session rebalance phase at 5 bp.\n- SPY-track validation DSR and six paired block-bootstrap tests using seven Generation 6 candidates, 113 disclosed trials, 4,999 iterations, and frozen seeds. The DSR label is a heuristic diagnostic relative to that disclosed family.\n- A separate growth-track shared-block max-over-seven/min-over-three intersection-union test against QQQ, static 50/50 SPY/QQQ, and static QQQ/equal-sector controls, also corrected across 113 trials under all six block specifications.\n- A causal 63-session volatility-matched SPY/BIL path with positive edge and a 0.90–1.10 realized-volatility ratio in development and validation after warmup.\n- Independently rebased validation annual-origin 252/504/756-session windows with positive median edge and at least a 60% win fraction.\n- One combined hash-pinned source-reconciliation artifact requiring all 20 CORE symbols; absence fails closed.\n\n## Claim boundary\n\n${report.claim_boundary}\n`;
}

function buildResultReceipt(report, jsonPayload, markdownPayload) {
  return Object.freeze({
    schema_version: "finly_champion_generation6_robustness_result_receipt.v1",
    generated_at: report.generated_at,
    execution_mode: "first_hash_frozen_generation_6_post_selection_robustness_run",
    input_integrity: report.input_integrity,
    files: Object.freeze({
      [GENERATION6_ROBUSTNESS_PATHS.robustness_output]: hashBytes(jsonPayload),
      [GENERATION6_ROBUSTNESS_PATHS.robustness_report]: hashBytes(markdownPayload),
    }),
    selected_ids: report.selection.track_selected_ids,
    track_results: report.track_results,
    disposition: report.disposition,
    claim_boundary: report.claim_boundary,
  });
}

export async function computeGeneration6RobustnessBundle({
  generatedAt = new Date().toISOString(),
} = {}) {
  invariant(Number.isFinite(Date.parse(generatedAt)), "generatedAt must be an ISO-compatible timestamp");
  const frozen = await loadFrozenGeneration6RobustnessInputs();
  const rowsById = frozen.privateLedger.simulations;
  const simulate = createSimulationCache(frozen.panel.points);
  const replayIds = sortedUnique([
    ...GENERATION6_CANDIDATE_IDS,
    "spy_buy_hold",
    "bil_cash",
    ...GENERATION6_GROWTH_CONTROL_IDS,
  ]);
  const baseReplay = verifyBaseReplay(rowsById, simulate, replayIds);
  invariant(baseReplay.all_required_base_simulations_match_frozen_private_ledger_exactly,
    "Generation 6 robustness base replay differs from the content-addressed ledger");

  const combinedSourceDescriptor = sourceDescriptor(frozen.robustnessProtocol);
  const combinedSource = frozen.selection.unique_candidate_ids.length === 0
    ? Object.freeze({
      schema_version: "finly_generation6_combined_source_artifact_contract_assessment.v1",
      status: "NOT_APPLICABLE_WITHOUT_SELECTED_CANDIDATE",
      passes: true,
      reasons: Object.freeze([]),
      selected_candidate_ids: Object.freeze([]),
      required_symbols_for_overall_gate: GENERATION6_SOURCE_SYMBOLS,
      candidate_assessments: Object.freeze({}),
    })
    : await readCombinedSourceReconciliation(combinedSourceDescriptor, {
      track_selected_ids: frozen.selection.track_selected_ids,
      selected_candidate_ids: frozen.selection.unique_candidate_ids,
      normalized_panel_sha256: frozen.hashes.normalized_panel_sha256,
      generation6_output_sha256: frozen.hashes.generation6_output,
      source_protocol_sha256: combinedSourceDescriptor.protocol_sha256,
      source_freeze_receipt_sha256: combinedSourceDescriptor.freeze_receipt_sha256,
    });
  const sourceByCandidate = Object.freeze(Object.fromEntries(
    frozen.selection.unique_candidate_ids.map((candidateId) => {
      const candidate = combinedSource.candidate_assessments[candidateId]
        ?? assessGeneration6SourceReconciliation(null, { candidate_id: candidateId });
      const passes = combinedSource.passes && candidate.passes;
      return [candidateId, Object.freeze({
        ...candidate,
        status: passes ? "PASS" : combinedSource.status,
        passes,
        combined_contract_passes: combinedSource.passes,
        combined_artifact_path: combinedSource.artifact_path ?? null,
        combined_artifact_sha256: combinedSource.artifact_sha256 ?? null,
        combined_protocol_sha256: combinedSource.protocol_sha256 ?? null,
        combined_freeze_receipt_sha256: combinedSource.freeze_receipt_sha256 ?? null,
        combined_result_receipt_sha256: combinedSource.result_receipt_sha256 ?? null,
        read_error: combinedSource.read_error ?? null,
      })];
    }),
  ));
  const growthJointStatistical = buildValidationGrowthJointStatisticalEvidence(
    rowsById,
    frozen.selection.track_selected_ids.growth_control_challenge,
  );

  const candidates = {};
  for (const candidateId of frozen.selection.unique_candidate_ids) {
    const tracks = frozen.selection.tracks_by_candidate[candidateId];
    const benchmarkIds = benchmarkScopeForGeneration6Candidate(frozen.selection, candidateId);
    const costStress = buildCostStressEvidence(simulate, candidateId, benchmarkIds);
    const anchorStress = buildAnchorStressEvidence(simulate, candidateId, benchmarkIds);
    const statistical = buildValidationStatisticalEvidence(rowsById, candidateId);
    const riskMatched = buildRiskMatchedSpyEvidence(rowsById, candidateId);
    const annualOrigin = buildGeneration6AnnualOriginConsistency(
      rowsById,
      candidateId,
      benchmarkIds,
    );
    const sourceReconciliation = sourceByCandidate[candidateId];
    const summary = summarizeGeneration6CandidateRobustness({
      candidateId,
      tracks,
      statistical,
      costStress,
      anchorStress,
      riskMatchedSpy: riskMatched,
      annualOrigin,
      sourceReconciliation,
      growthJointStatistical: tracks.includes("growth_control_challenge")
        ? growthJointStatistical
        : null,
    });
    candidates[candidateId] = Object.freeze({
      candidate_id: candidateId,
      tracks,
      required_benchmarks: benchmarkIds,
      statistical,
      cost_stress: costStress,
      rebalance_anchor_stress: anchorStress,
      causal_volatility_matched_spy: compactRiskMatchedEvidence(riskMatched),
      validation_annual_origin_consistency: annualOrigin,
      growth_control_joint_statistical_evidence: tracks.includes("growth_control_challenge")
        ? growthJointStatistical
        : null,
      source_reconciliation: sourceReconciliation,
      summary,
    });
  }

  const candidateEvidence = Object.freeze(candidates);
  const trackResults = Object.freeze(Object.fromEntries(Object.entries(
    frozen.selection.track_selected_ids,
  ).map(([track, candidateId]) => {
    if (candidateId === null) {
      return [track, Object.freeze({ selected_id: null, passes: false, status: `NO_${track.toUpperCase()}_CHALLENGER` })];
    }
    const passes = candidateTrackDisposition(candidateEvidence[candidateId].summary, track);
    const status = track === "growth_control_challenge"
      ? (passes
        ? "GROWTH_CONTROL_CHALLENGE_JOINT_STATISTICAL_ROBUSTNESS_PASS"
        : "GROWTH_CONTROL_CHALLENGE_JOINT_STATISTICAL_ROBUSTNESS_FAILED")
      : (passes
        ? "PRIMARY_SPY_RETROSPECTIVE_ROBUSTNESS_PASS"
        : "PRIMARY_SPY_RETROSPECTIVE_ROBUSTNESS_FAILED");
    return [track, Object.freeze({
      selected_id: candidateId,
      passes,
      evidence_class: track === "growth_control_challenge"
        ? "PENALIZED_RETROSPECTIVE_JOINT_MEAN_LOG_GROWTH_TEST"
        : "PENALIZED_RETROSPECTIVE_ROBUSTNESS",
      statistical_superiority_tested: true,
      status,
    })];
  })));
  const primaryPass = trackResults.primary_spy.passes;
  const growthPass = trackResults.growth_control_challenge.passes;
  const disposition = primaryPass && growthPass
    ? "GENERATION6_SPY_AND_JOINT_GROWTH_CHALLENGERS_RETROSPECTIVE_ROBUSTNESS_PASS"
    : primaryPass
      ? "GENERATION6_SPY_CHALLENGER_RETROSPECTIVE_ROBUSTNESS_PASS"
      : "KEEP_PRIOR_CHAMPION_GENERATION6_ROBUSTNESS_FAILED";
  const report = Object.freeze({
    schema_version: "finly_quant_champion_generation6_robustness.v1",
    generated_at: generatedAt,
    disposition,
    claim_boundary: "All model-development, validation, and recent intervals were already seen. Passing supports only a retrospective ETF-allocation shadow label; it does not establish future profit, exact options P&L, or superiority over a competitor that cannot be replayed under identical data, timing, cost, and capital assumptions.",
    consumed_data_disclosure: Object.freeze({
      development: "seen during retrospective model development",
      validation: "seen during frozen candidate selection and reused for penalized robustness",
      recent_2025_2026: "seen and consumed by the frozen safety veto; not used by these promotion gates",
      pristine_holdout_remaining: false,
    }),
    input_integrity: Object.freeze({
      hashes: frozen.hashes,
      generation6_protocol_validation: frozen.generation6ProtocolValidation,
      robustness_protocol_validation: frozen.robustnessProtocolValidation,
      verified_generation6_freeze_files: frozen.verifiedGeneration6FreezeFiles,
      verified_robustness_freeze_files: frozen.verifiedRobustnessFreezeFiles,
      normalized_panel_sha256: frozen.hashes.normalized_panel_sha256,
      common_sessions: frozen.panel.points.length,
      private_ledger_schema: frozen.privateLedger.schema_version,
      private_ledger_content_addressed: true,
      no_market_fetch_performed: true,
      base_replay: baseReplay,
      combined_source_reconciliation: combinedSource,
    }),
    frozen_blueprint: Object.freeze({
      cost_levels_bps: GENERATION6_COST_LEVELS_BPS,
      rebalance_anchors: GENERATION6_REBALANCE_ANCHORS,
      statistical_candidate_ids: GENERATION6_CANDIDATE_IDS,
      cumulative_effective_trials: GENERATION6_CUMULATIVE_TRIALS,
      bootstrap_iterations_per_test: GENERATION6_BOOTSTRAP_ITERATIONS,
      bootstrap_block_lengths_sessions: GENERATION6_BLOCK_LENGTHS,
      bootstrap_seeds: GENERATION6_BOOTSTRAP_SEEDS,
      statistical_interpretation: GENERATION6_STATISTICAL_INTERPRETATION,
      causal_volatility_match: GENERATION6_VOLATILITY_MATCH_SPECIFICATION,
      annual_origin_horizons_sessions: GENERATION6_ANNUAL_ORIGIN_HORIZONS,
      annual_origin_independent_rebase: GENERATION6_ANNUAL_ORIGIN_REBASE_SPECIFICATION,
      growth_control_ids: GENERATION6_GROWTH_CONTROL_IDS,
      growth_control_evidence_class:
        "PENALIZED_RETROSPECTIVE_JOINT_MEAN_LOG_GROWTH_TEST",
      growth_control_joint_statistical_specification:
        GENERATION6_GROWTH_STATISTICS_SPECIFICATION,
      growth_control_statistical_superiority_tested: true,
      source_reconciliation_fail_closed: true,
      immutable_persistence: GENERATION6_ROBUSTNESS_PERSISTENCE_SPECIFICATION,
    }),
    selection: frozen.selection,
    candidates: candidateEvidence,
    track_results: trackResults,
  });
  const jsonPayload = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  const markdownPayload = Buffer.from(renderMarkdown(report));
  const receipt = buildResultReceipt(report, jsonPayload, markdownPayload);
  const receiptPayload = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze({ report, jsonPayload, markdownPayload, receipt, receiptPayload });
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export async function acquireExclusiveGeneration6RobustnessClaim(path, {
  generatedAt,
  ownerPid = process.pid,
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  invariant(typeof path === "string" && path.length > 0, "robustness claim path is invalid");
  invariant(generatedAt === undefined || Number.isFinite(Date.parse(generatedAt)),
    "robustness claim generatedAt is invalid");
  invariant(Number.isSafeInteger(ownerPid) && ownerPid > 0, "robustness claim owner PID is invalid");
  invariant(typeof isProcessAlive === "function", "robustness claim liveness probe is invalid");
  await mkdir(dirname(path), { recursive: true });
  const recoveryPath = `${path}.recovery`;
  let recoveredGeneratedAt = generatedAt;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const claim = Object.freeze({
      schema_version: "finly_generation6_robustness_exclusive_claim.v1",
      claim_token: randomUUID(),
      owner_pid: ownerPid,
      generated_at: recoveredGeneratedAt ?? new Date().toISOString(),
    });
    const payload = Buffer.from(`${JSON.stringify(claim, null, 2)}\n`);
    try {
      await writeFile(path, payload, { flag: "wx", mode: 0o600 });
      return Object.freeze({ ...claim, path });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let prior;
      try {
        prior = parseJson(await readFile(path), "Generation 6 robustness claim");
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw readError;
      }
      invariant(prior?.schema_version === "finly_generation6_robustness_exclusive_claim.v1"
        && typeof prior.claim_token === "string"
        && Number.isSafeInteger(prior.owner_pid)
        && Number.isFinite(Date.parse(prior.generated_at)),
      "existing Generation 6 robustness claim is invalid");
      invariant(!isProcessAlive(prior.owner_pid),
        `Generation 6 robustness first run is already claimed by active process ${prior.owner_pid}`);
      if (generatedAt !== undefined) {
        invariant(prior.generated_at === generatedAt,
          "stale robustness claim generated_at differs from partial output");
      }
      recoveredGeneratedAt = prior.generated_at;
      const recoveredClaim = Object.freeze({
        schema_version: "finly_generation6_robustness_exclusive_claim.v1",
        claim_token: randomUUID(),
        owner_pid: ownerPid,
        generated_at: recoveredGeneratedAt,
      });
      const recoveredPayload = Buffer.from(`${JSON.stringify(recoveredClaim, null, 2)}\n`);
      const recovery = Object.freeze({
        schema_version: "finly_generation6_robustness_claim_recovery.v1",
        recovery_token: randomUUID(),
        stale_claim_token: prior.claim_token,
        owner_pid: ownerPid,
        generated_at: recoveredGeneratedAt,
      });
      const recoveryPayload = Buffer.from(`${JSON.stringify(recovery, null, 2)}\n`);
      try {
        await writeFile(recoveryPath, recoveryPayload, { flag: "wx", mode: 0o600 });
      } catch (recoveryError) {
        if (recoveryError?.code !== "EEXIST") throw recoveryError;
        throw new Error("Generation 6 robustness stale-claim recovery is already exclusively claimed");
      }
      try {
        let current;
        try {
          current = parseJson(await readFile(path), "Generation 6 robustness claim under recovery");
        } catch (readError) {
          if (readError?.code !== "ENOENT") throw readError;
        }
        if (current) {
          if (current.claim_token !== prior.claim_token) continue;
          invariant(!isProcessAlive(current.owner_pid),
            `Generation 6 robustness first run is already claimed by active process ${current.owner_pid}`);
          await unlink(path);
        }
        try {
          await writeFile(path, recoveredPayload, { flag: "wx", mode: 0o600 });
          return Object.freeze({ ...recoveredClaim, path });
        } catch (writeError) {
          if (writeError?.code !== "EEXIST") throw writeError;
        }
      } finally {
        const currentRecovery = parseJson(
          await readFile(recoveryPath),
          "Generation 6 robustness recovery claim",
        );
        invariant(currentRecovery.recovery_token === recovery.recovery_token,
          "refusing to release a Generation 6 robustness recovery claim owned by another process");
        await unlink(recoveryPath);
      }
    }
  }
  throw new Error("could not acquire the Generation 6 robustness claim after concurrent retries");
}

export async function releaseGeneration6RobustnessClaim(claim) {
  invariant(claim && typeof claim.path === "string" && typeof claim.claim_token === "string",
    "robustness claim release token is invalid");
  let current;
  try {
    current = parseJson(await readFile(claim.path), "Generation 6 robustness claim");
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ released: false, already_absent: true });
    throw error;
  }
  invariant(current.claim_token === claim.claim_token,
    "refusing to release a Generation 6 robustness claim owned by another process");
  await unlink(claim.path);
  return Object.freeze({ released: true, already_absent: false });
}

export async function persistImmutableGeneration6RobustnessArtifacts(
  artifacts,
  { verifyExisting = false } = {},
) {
  invariant(Array.isArray(artifacts) && artifacts.length > 0,
    "immutable robustness artifact list is empty");
  const paths = artifacts.map((artifact) => artifact?.path);
  invariant(paths.every((path) => typeof path === "string")
    && new Set(paths).size === paths.length,
  "immutable robustness artifact paths are invalid");
  for (const artifact of artifacts) {
    const payload = Buffer.from(artifact.payload);
    if (verifyExisting) {
      invariant(await pathExists(artifact.path),
        `cannot verify absent Generation 6 robustness artifact ${artifact.path}`);
      const actual = await readFile(artifact.path);
      invariant(actual.equals(payload),
        `Generation 6 robustness artifact differs from deterministic recomputation: ${artifact.path}`);
      continue;
    }
    await mkdir(dirname(artifact.path), { recursive: true });
    try {
      await writeFile(artifact.path, payload, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const actual = await readFile(artifact.path);
      invariant(actual.equals(payload),
        `existing partial Generation 6 robustness artifact differs from deterministic recomputation: ${artifact.path}`);
    }
  }
  return Object.freeze({
    mode: verifyExisting ? "VERIFIED_EXISTING" : "WROTE_ONCE_OR_VERIFIED_CRASH_RESUME",
    paths: Object.freeze(paths),
  });
}

function robustnessArtifacts(bundle) {
  return Object.freeze([
    Object.freeze({ path: jsonOutputPath, payload: bundle.jsonPayload }),
    Object.freeze({ path: markdownOutputPath, payload: bundle.markdownPayload }),
    Object.freeze({ path: resultReceiptPath, payload: bundle.receiptPayload }),
  ]);
}

async function firstRun() {
  const knownPaths = [jsonOutputPath, markdownOutputPath, resultReceiptPath];
  const existing = [];
  for (const path of knownPaths) if (await pathExists(path)) existing.push(path);
  invariant(existing.length !== knownPaths.length,
    `Generation 6 robustness output already exists; use --verify-existing and do not overwrite: ${existing.join(", ")}`);
  let generatedAt;
  if (existing.length > 0) {
    invariant(existing.includes(jsonOutputPath),
      "cannot resume partial Generation 6 robustness artifacts without the JSON output");
    const partial = parseJson(await readFile(jsonOutputPath), "partial Generation 6 robustness output");
    generatedAt = partial.generated_at;
    invariant(Number.isFinite(Date.parse(generatedAt)),
      "partial Generation 6 robustness output has invalid generated_at");
  }
  const claim = await acquireExclusiveGeneration6RobustnessClaim(robustnessClaimPath, {
    generatedAt,
  });
  try {
    const bundle = await computeGeneration6RobustnessBundle({ generatedAt: claim.generated_at });
    await persistImmutableGeneration6RobustnessArtifacts(robustnessArtifacts(bundle));
    return bundle;
  } finally {
    await releaseGeneration6RobustnessClaim(claim);
  }
}

async function assertByteEqual(path, expected, label) {
  const actual = await readFile(path);
  invariant(actual.equals(expected), `${label} differs from deterministic recomputation`);
}

async function verifyExisting() {
  for (const path of [jsonOutputPath, markdownOutputPath, resultReceiptPath]) {
    invariant(await pathExists(path), `cannot verify absent Generation 6 robustness artifact ${path}`);
  }
  const existingReport = parseJson(await readFile(jsonOutputPath), "Generation 6 robustness output");
  const bundle = await computeGeneration6RobustnessBundle({ generatedAt: existingReport.generated_at });
  await assertByteEqual(jsonOutputPath, bundle.jsonPayload, "Generation 6 robustness JSON output");
  await assertByteEqual(markdownOutputPath, bundle.markdownPayload, "Generation 6 robustness Markdown report");
  await assertByteEqual(resultReceiptPath, bundle.receiptPayload, "Generation 6 robustness result receipt");
  return bundle;
}

async function main() {
  const args = process.argv.slice(2);
  invariant(args.length <= 1 && (args.length === 0 || args[0] === "--verify-existing"),
    "usage: node research/run_quant_champion_generation6_robustness.mjs [--verify-existing]");
  const verification = args[0] === "--verify-existing";
  const bundle = verification ? await verifyExisting() : await firstRun();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: verification ? "verify-existing" : "first-run",
    disposition: bundle.report.disposition,
    track_results: bundle.report.track_results,
    json: jsonOutputPath,
    markdown: markdownOutputPath,
    receipt: resultReceiptPath,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
