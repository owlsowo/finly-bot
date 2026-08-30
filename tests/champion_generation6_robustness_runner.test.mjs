import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireExclusiveGeneration6RobustnessClaim,
  assessGeneration6AnnualOriginConsistency,
  assessGeneration6SourceReconciliation,
  benchmarkScopeForGeneration6Candidate,
  buildGeneration6AnnualOriginConsistency,
  GENERATION6_ANNUAL_ORIGIN_REBASE_SPECIFICATION,
  GENERATION6_ANNUAL_ORIGIN_HORIZONS,
  GENERATION6_ROBUSTNESS_PATHS,
  GENERATION6_ROBUSTNESS_PERSISTENCE_SPECIFICATION,
  GENERATION6_SOURCE_RECONCILIATION_SCHEMA,
  GENERATION6_SOURCE_EVIDENCE_SCHEMA,
  GENERATION6_SOURCE_SYMBOLS_BY_CANDIDATE,
  GENERATION6_STATISTICAL_INTERPRETATION,
  independentlyRebasedGeneration6AnnualOriginSummaries,
  persistImmutableGeneration6RobustnessArtifacts,
  rebaseGeneration6AnnualOriginWindow,
  releaseGeneration6RobustnessClaim,
  selectGeneration6RobustnessCandidates,
  summarizeGeneration6CandidateRobustness,
  validateGeneration6CombinedSourceArtifactContract,
  validateGeneration6FrozenSelection,
  validateGeneration6RobustnessProtocol,
} from "../research/run_quant_champion_generation6_robustness.mjs";
import {
  rebaseRowsForStandalonePeriod,
  sha256,
} from "../research/champion_engine.mjs";
import {
  GENERATION6_BLOCK_LENGTHS,
  GENERATION6_BOOTSTRAP_ITERATIONS,
  GENERATION6_BOOTSTRAP_SEEDS,
  GENERATION6_COST_LEVELS_BPS,
  GENERATION6_CUMULATIVE_TRIALS,
  GENERATION6_REBALANCE_ANCHORS,
  GENERATION6_VOLATILITY_MATCH_SPECIFICATION,
} from "../research/champion_generation6_robustness.mjs";
import {
  GENERATION6_GROWTH_STATISTICS_SPECIFICATION,
} from "../research/champion_generation6_growth_statistics.mjs";
import {
  GENERATION6_CANDIDATE_IDS,
  GENERATION6_GROWTH_CONTROL_IDS,
  GENERATION6_SLICES,
} from "../research/run_quant_champion_generation6.mjs";
import {
  buildGeneration6SourceReconciliation,
  generation6SeriesBySymbolFromPoints,
  GENERATION6_SOURCE_SIMULATION_OPTIONS,
  GENERATION6_SOURCE_SERIES_CONTRACT,
  GENERATION6_SOURCE_SYMBOLS,
  GENERATION6_SOURCE_THRESHOLDS,
} from "../research/source_overlap_reconciliation_generation6.mjs";
import {
  createGeneration6Strategies,
  GENERATION6_METADATA,
} from "../research/champion_strategies_generation6.mjs";
import {
  generation6AlpacaSeriesIntegrityBySymbol,
  generation6AlpacaSeriesIntegritySha256,
  GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA,
  GENERATION6_SOURCE_FREEZE_REQUIRED_FILES,
  GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS,
} from "../research/run_source_overlap_reconciliation_generation6.mjs";

const PRIMARY = GENERATION6_CANDIDATE_IDS[0];
const GROWTH = GENERATION6_CANDIDATE_IDS[1];
const HASH = "a".repeat(64);

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function generation6Output(primary = PRIMARY, growth = GROWTH) {
  const assessments = Object.fromEntries(GENERATION6_CANDIDATE_IDS.map((id) => [id, {
    eligible_for_spy_post_selection_robustness: id === primary || id === growth,
    eligible_for_growth_challenge_post_selection_robustness: id === growth,
  }]));
  return {
    schema_version: "finly_quant_champion_generation6.v1",
    disposition: "GENERATION6_POST_SELECTION_ROBUSTNESS_PENDING",
    selection: {
      selected_id_before_post_selection_robustness: primary,
      primary_spy_track: { selected_id_before_post_selection_robustness: primary },
      growth_control_challenge_track: {
        selected_id_before_post_selection_robustness: growth,
      },
    },
    assessments,
  };
}

function robustnessProtocol(selection) {
  const frozen = (path) => ({ path, sha256: HASH });
  const combinedSourceArtifact = selection.unique_candidate_ids.length === 0
    ? null
    : {
      path: GENERATION6_ROBUSTNESS_PATHS.source_output,
      sha256: HASH,
      report_path: GENERATION6_ROBUSTNESS_PATHS.source_report,
      report_sha256: HASH,
      protocol_path: GENERATION6_ROBUSTNESS_PATHS.source_protocol,
      protocol_sha256: HASH,
      freeze_receipt_path: GENERATION6_ROBUSTNESS_PATHS.source_freeze_receipt,
      freeze_receipt_sha256: HASH,
      result_receipt_path: GENERATION6_ROBUSTNESS_PATHS.source_result_receipt,
      result_receipt_sha256: HASH,
      selected_candidate_ids: [...selection.unique_candidate_ids],
      required_symbols_for_overall_gate: [...GENERATION6_SOURCE_SYMBOLS],
      candidate_required_symbols: Object.fromEntries(selection.unique_candidate_ids.map(
        (candidateId) => [candidateId, [...GENERATION6_SOURCE_SYMBOLS_BY_CANDIDATE[candidateId]]],
      )),
    };
  return {
    schema_version: "finly_champion_generation6_robustness_protocol.v1",
    status: "frozen_before_first_post_selection_robustness_output",
    runner_market_fetch_permitted: false,
    frozen_selection: structuredClone(selection.track_selected_ids),
    data_and_execution: {
      cost_levels_bps: [...GENERATION6_COST_LEVELS_BPS],
      native_rebalance_anchors: [...GENERATION6_REBALANCE_ANCHORS],
      native_rebalance_interval_sessions: 21,
      anchor_cost_bps: 5,
      cash_symbol: "BIL",
      maximum_risky_gross: 1,
      annual_borrow_spread: 0.005,
      terminal_liquidation: true,
    },
    slices: {
      development: structuredClone(GENERATION6_SLICES.development),
      validation: structuredClone(GENERATION6_SLICES.validation),
    },
    statistical_gate: {
      slice: "validation_only",
      benchmark_id: "spy_buy_hold",
      eligible_candidate_ids: [...GENERATION6_CANDIDATE_IDS],
      cumulative_effective_trials: GENERATION6_CUMULATIVE_TRIALS,
      deflated_sharpe_probability_minimum: 0.95,
      bootstrap_iterations_per_test: GENERATION6_BOOTSTRAP_ITERATIONS,
      block_lengths_sessions: [...GENERATION6_BLOCK_LENGTHS],
      methods: ["circular", "moving"],
      frozen_seeds: structuredClone(GENERATION6_BOOTSTRAP_SEEDS),
      cumulative_trial_familywise_p_value_maximum: 0.05,
      interpretation: structuredClone(GENERATION6_STATISTICAL_INTERPRETATION),
    },
    causal_volatility_matched_spy_gate: {
      specification: structuredClone(GENERATION6_VOLATILITY_MATCH_SPECIFICATION),
      required_slices: ["development", "validation"],
      annualized_log_growth_edge_strictly_positive: true,
      realized_volatility_ratio_minimum: 0.90,
      realized_volatility_ratio_maximum: 1.10,
    },
    annual_origin_consistency_gate: {
      slice: "validation_only",
      horizons_sessions: [...GENERATION6_ANNUAL_ORIGIN_HORIZONS],
      median_annualized_log_growth_difference_strictly_above: 0,
      minimum_positive_fraction: 0.60,
      independent_window_rebase:
        structuredClone(GENERATION6_ANNUAL_ORIGIN_REBASE_SPECIFICATION),
    },
    immutable_persistence:
      structuredClone(GENERATION6_ROBUSTNESS_PERSISTENCE_SPECIFICATION),
    growth_control_challenge: {
      benchmark_ids: [...GENERATION6_GROWTH_CONTROL_IDS],
      evidence_class: "PENALIZED_RETROSPECTIVE_JOINT_MEAN_LOG_GROWTH_TEST",
      statistical_superiority_tested: true,
      claim_scope: "RETROSPECTIVE_MEAN_LOG_GROWTH_OVER_ALL_THREE_CONTROLS_ONLY",
      joint_statistical_specification:
        structuredClone(GENERATION6_GROWTH_STATISTICS_SPECIFICATION),
    },
    source_reconciliation: {
      runner_fetch_permitted: false,
      fail_closed: true,
      artifact_schema: GENERATION6_SOURCE_RECONCILIATION_SCHEMA,
      evidence_schema: GENERATION6_SOURCE_EVIDENCE_SCHEMA,
      not_applicable_without_selected_candidate: selection.unique_candidate_ids.length === 0,
      combined_artifact: combinedSourceArtifact,
    },
    frozen_inputs: {
      generation6_output: frozen(GENERATION6_ROBUSTNESS_PATHS.generation6_output),
      generation6_result_receipt: frozen(
        GENERATION6_ROBUSTNESS_PATHS.generation6_result_receipt,
      ),
      generation6_protocol: frozen(GENERATION6_ROBUSTNESS_PATHS.generation6_protocol),
      generation6_freeze_receipt: frozen(
        GENERATION6_ROBUSTNESS_PATHS.generation6_freeze_receipt,
      ),
      generation6_trial_ledger: frozen(
        GENERATION6_ROBUSTNESS_PATHS.generation6_trial_ledger,
      ),
      generation6_private_ledger: frozen(
        "data/private/champion_search/generation6_ledger_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json.gz",
      ),
      private_panel: {
        ...frozen("data/private/champion_search/generation4_panel_immutable.json"),
        normalized_panel_sha256: HASH,
      },
    },
  };
}

function isoDate(index) {
  return new Date(Date.UTC(2018, 0, 2 + index)).toISOString().slice(0, 10);
}

function simulationRow(index, netReturn) {
  const date = isoDate(index);
  return {
    signal_date: date,
    rebalance_date: date,
    execution_return_date: date,
    rebalanced: index % 21 === 0,
    signal_weights: { SPY: 1, BIL: 0 },
    weights: { SPY: 1, BIL: 0 },
    asset_returns: { SPY: netReturn, BIL: 0 },
    cash_return: 0,
    gross_return: netReturn,
    transaction_cost: 0,
    financing_spread_cost: 0,
    turnover_notional: 0,
    net_return: netReturn,
  };
}

function weekdayDates(length, start = "2018-01-01") {
  const dates = [];
  let timestamp = Date.parse(`${start}T00:00:00Z`);
  while (dates.length < length) {
    const date = new Date(timestamp);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      dates.push(date.toISOString().slice(0, 10));
    }
    timestamp += 86_400_000;
  }
  return dates;
}

function syntheticSourcePoints(length = 1_300) {
  return weekdayDates(length).map((date, index) => ({
    date,
    ...Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol, symbolIndex) => {
      if (symbol === "BIL") return [symbol, 100 * Math.exp(index * 0.00002)];
      const drift = 0.00012 + symbolIndex * 0.000003;
      const cycle = 0.018 * Math.sin(index / (11 + symbolIndex))
        + 0.009 * Math.cos(index / (29 + symbolIndex));
      return [symbol, (45 + symbolIndex) * Math.exp(index * drift + cycle)];
    })),
  }));
}

function sourceProtocolFixture(generation6OutputSha256, normalizedPanelSha256) {
  const alpacaSeriesIntegrity = generation6AlpacaSeriesIntegrityBySymbol(
    generation6SeriesBySymbolFromPoints(syntheticSourcePoints()),
  );
  return {
    schema_version: "finly_source_overlap_reconciliation_generation6_protocol.v1",
    status: "FROZEN_BEFORE_FIRST_GENERATION6_SOURCE_RUN",
    symbols: [...GENERATION6_SOURCE_SYMBOLS],
    overall_gate: {
      scope: "ALL_20_CORE_SYMBOLS_INCLUDING_CANDIDATE_AND_COMPARATOR_INPUTS",
      required_symbols: [...GENERATION6_SOURCE_SYMBOLS],
      every_required_symbol_must_pass: true,
    },
    pass_thresholds: structuredClone(GENERATION6_SOURCE_THRESHOLDS),
    simulation_options: structuredClone(GENERATION6_SOURCE_SIMULATION_OPTIONS),
    source_series_contract: structuredClone(GENERATION6_SOURCE_SERIES_CONTRACT),
    prior_generation5_boundary: {
      inherit_overall_disposition: false,
      reason: "Generation 5 tested a different candidate family.",
    },
    frozen_inputs: {
      generation6_selection_output: {
        path: GENERATION6_ROBUSTNESS_PATHS.generation6_output,
        payload_sha256: generation6OutputSha256,
        schema_version: "finly_quant_champion_generation6.v1",
      },
      yahoo_generation4_panel: {
        path: "data/private/champion_search/generation4_panel.json",
        payload_sha256: "b".repeat(64),
        normalized_panel_sha256: normalizedPanelSha256,
        role: "hash_pinned_generation4_yahoo_adjusted_close",
      },
      alpaca_adjustment_all_panel: {
        path: "data/private/champion_search/generation6_alpaca_all_panel.json",
        payload_sha256: "c".repeat(64),
        schema_version: GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA,
        series_integrity_by_symbol: alpacaSeriesIntegrity,
        series_integrity_sha256:
          generation6AlpacaSeriesIntegritySha256(alpacaSeriesIntegrity),
        strategy_intersection_normalized_panel_sha256: "d".repeat(64),
        role: "separately_persisted_hash_pinned_alpaca_adjustment_all",
        adjustment: "all",
      },
    },
    security: { runner_network_permitted: false },
    execution_status_at_freeze: { results_seen: false, all_outputs_absent: true },
    output_paths: [...GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS],
  };
}

function combinedSourceContractFixture({ mutateEvidence } = {}) {
  const output = generation6Output(PRIMARY, PRIMARY);
  const selection = selectGeneration6RobustnessCandidates(output);
  const generation6OutputRaw = Buffer.from(`${JSON.stringify(output, null, 2)}\n`);
  const generation6OutputSha256 = hashBytes(generation6OutputRaw);
  const normalizedPanelSha256 = "e".repeat(64);
  const sourceProtocol = sourceProtocolFixture(generation6OutputSha256, normalizedPanelSha256);
  const sourceProtocolRaw = Buffer.from(`${JSON.stringify(sourceProtocol, null, 2)}\n`);
  const files = Object.fromEntries(GENERATION6_SOURCE_FREEZE_REQUIRED_FILES.map((path) => [
    path,
    "f".repeat(64),
  ]));
  files[GENERATION6_ROBUSTNESS_PATHS.source_protocol] = hashBytes(sourceProtocolRaw);
  const sourceFreezeReceipt = {
    schema_version: "finly_source_overlap_reconciliation_generation6_freeze_receipt.v1",
    frozen_before_first_source_run: true,
    source_results_seen_at_freeze: false,
    all_source_outputs_absent_at_freeze: true,
    runner_network_permitted: false,
    files,
  };
  const sourceFreezeReceiptRaw = Buffer.from(`${JSON.stringify(sourceFreezeReceipt, null, 2)}\n`);
  const points = syntheticSourcePoints();
  const series = generation6SeriesBySymbolFromPoints(points);
  const reconciliation = buildGeneration6SourceReconciliation({
    selectionOutput: output,
    allowedCandidateIds: GENERATION6_CANDIDATE_IDS,
    yahooSeriesBySymbol: series,
    alpacaAllSeriesBySymbol: series,
    createStrategies: createGeneration6Strategies,
    metadata: GENERATION6_METADATA,
  });
  let evidence = {
    schema_version: GENERATION6_SOURCE_RECONCILIATION_SCHEMA,
    generated_at: "2026-08-29T00:00:00.000Z",
    disposition: "PASS_SOURCE_RECONCILIATION",
    no_network_performed: true,
    input_integrity: {
      protocol_sha256: hashBytes(sourceProtocolRaw),
      freeze_receipt_sha256: hashBytes(sourceFreezeReceiptRaw),
      generation6_selection_output_sha256: generation6OutputSha256,
      yahoo_panel_payload_sha256:
        sourceProtocol.frozen_inputs.yahoo_generation4_panel.payload_sha256,
      yahoo_panel_normalized_sha256: normalizedPanelSha256,
      alpaca_all_panel_payload_sha256:
        sourceProtocol.frozen_inputs.alpaca_adjustment_all_panel.payload_sha256,
      alpaca_all_panel_series_integrity_sha256:
        sourceProtocol.frozen_inputs.alpaca_adjustment_all_panel.series_integrity_sha256,
      alpaca_all_panel_strategy_intersection_normalized_sha256:
        sourceProtocol.frozen_inputs.alpaca_adjustment_all_panel
          .strategy_intersection_normalized_panel_sha256,
      alpaca_all_panel_series_integrity_by_symbol:
        sourceProtocol.frozen_inputs.alpaca_adjustment_all_panel.series_integrity_by_symbol,
    },
    sources: {
      alpaca_adjustment_all_panel: {
        schema_version:
          sourceProtocol.frozen_inputs.alpaca_adjustment_all_panel.schema_version,
        per_symbol_gate_input: "series_by_symbol",
        candidate_simulation_input: "strategy_intersection.points",
        series_integrity_by_symbol:
          sourceProtocol.frozen_inputs.alpaca_adjustment_all_panel.series_integrity_by_symbol,
        series_integrity_sha256:
          sourceProtocol.frozen_inputs.alpaca_adjustment_all_panel.series_integrity_sha256,
        strategy_intersection_normalized_panel_sha256:
          sourceProtocol.frozen_inputs.alpaca_adjustment_all_panel
            .strategy_intersection_normalized_panel_sha256,
      },
    },
    reconciliation,
  };
  if (mutateEvidence) {
    evidence = structuredClone(evidence);
    mutateEvidence(evidence);
  }
  const evidenceRaw = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  const markdownRaw = Buffer.from("# synthetic combined source report\n");
  const sourceResultReceipt = {
    schema_version: "finly_source_overlap_reconciliation_generation6_result_receipt.v1",
    generated_at: evidence.generated_at,
    input_integrity: evidence.input_integrity,
    files: {
      [GENERATION6_ROBUSTNESS_PATHS.source_output]: hashBytes(evidenceRaw),
      [GENERATION6_ROBUSTNESS_PATHS.source_report]: hashBytes(markdownRaw),
    },
    disposition: evidence.disposition,
    selected_candidate_ids: selection.unique_candidate_ids,
    no_network_performed: true,
    prior_generation5_overall_disposition_inherited: false,
  };
  const sourceResultReceiptRaw = Buffer.from(`${JSON.stringify(sourceResultReceipt, null, 2)}\n`);
  const descriptor = {
    path: GENERATION6_ROBUSTNESS_PATHS.source_output,
    sha256: hashBytes(evidenceRaw),
    report_path: GENERATION6_ROBUSTNESS_PATHS.source_report,
    report_sha256: hashBytes(markdownRaw),
    protocol_path: GENERATION6_ROBUSTNESS_PATHS.source_protocol,
    protocol_sha256: hashBytes(sourceProtocolRaw),
    freeze_receipt_path: GENERATION6_ROBUSTNESS_PATHS.source_freeze_receipt,
    freeze_receipt_sha256: hashBytes(sourceFreezeReceiptRaw),
    result_receipt_path: GENERATION6_ROBUSTNESS_PATHS.source_result_receipt,
    result_receipt_sha256: hashBytes(sourceResultReceiptRaw),
    selected_candidate_ids: selection.unique_candidate_ids,
    required_symbols_for_overall_gate: GENERATION6_SOURCE_SYMBOLS,
    candidate_required_symbols: Object.fromEntries(selection.unique_candidate_ids.map((id) => [
      id,
      GENERATION6_SOURCE_SYMBOLS_BY_CANDIDATE[id],
    ])),
  };
  return {
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
    expected: {
      track_selected_ids: selection.track_selected_ids,
      selected_candidate_ids: selection.unique_candidate_ids,
      normalized_panel_sha256: normalizedPanelSha256,
      generation6_output_sha256: generation6OutputSha256,
      source_protocol_sha256: hashBytes(sourceProtocolRaw),
      source_freeze_receipt_sha256: hashBytes(sourceFreezeReceiptRaw),
    },
  };
}

function passingComparison() {
  return {
    assessment: {
      passes: true,
    },
  };
}

test("frozen selections are validated and identical track winners are deduplicated", () => {
  const distinct = selectGeneration6RobustnessCandidates(generation6Output());
  assert.deepEqual(distinct.track_selected_ids, {
    primary_spy: PRIMARY,
    growth_control_challenge: GROWTH,
  });
  assert.deepEqual(distinct.unique_candidate_ids, [PRIMARY, GROWTH]);
  assert.deepEqual(benchmarkScopeForGeneration6Candidate(distinct, PRIMARY), ["spy_buy_hold"]);
  assert.deepEqual(
    benchmarkScopeForGeneration6Candidate(distinct, GROWTH),
    ["spy_buy_hold", ...GENERATION6_GROWTH_CONTROL_IDS],
  );

  const shared = selectGeneration6RobustnessCandidates(generation6Output(GROWTH, GROWTH));
  assert.deepEqual(shared.unique_candidate_ids, [GROWTH]);
  assert.deepEqual(shared.tracks_by_candidate[GROWTH], [
    "primary_spy",
    "growth_control_challenge",
  ]);
  assert.equal(shared.deduplicated_candidate_count, 1);
});

test("robustness protocol binds every predeclared choice and future artifact path", () => {
  const selection = selectGeneration6RobustnessCandidates(generation6Output());
  const protocol = robustnessProtocol(selection);
  assert.deepEqual(
    validateGeneration6RobustnessProtocol(protocol, selection),
    { passes: true, reasons: [] },
  );
  const changed = structuredClone(protocol);
  changed.statistical_gate.bootstrap_iterations_per_test = 5_000;
  changed.causal_volatility_matched_spy_gate.specification.lookback_sessions = 64;
  changed.annual_origin_consistency_gate.independent_window_rebase.one_way_cost_bps = 0;
  changed.immutable_persistence.rename_overwrite_permitted = true;
  changed.source_reconciliation.combined_artifact.selected_candidate_ids.reverse();
  changed.growth_control_challenge.statistical_superiority_tested = false;
  const rejected = validateGeneration6RobustnessProtocol(changed, selection);
  assert.equal(rejected.passes, false);
  assert.ok(rejected.reasons.includes("bootstrap count is not 4,999"));
  assert.ok(rejected.reasons.includes("causal volatility-match specification differs"));
  assert.ok(rejected.reasons.includes(
    "annual-origin independent boundary rebase specification differs",
  ));
  assert.ok(rejected.reasons.includes(
    "robustness immutable persistence specification differs",
  ));
  assert.ok(rejected.reasons.includes(
    "combined source descriptor selected ids differ from the frozen selection",
  ));
  assert.ok(rejected.reasons.includes(
    "growth-control challenge statistical claim scope differs",
  ));

  const noSelection = selectGeneration6RobustnessCandidates(generation6Output(null, null));
  const noSelectionProtocol = robustnessProtocol(noSelection);
  assert.equal(noSelectionProtocol.source_reconciliation.combined_artifact, null);
  assert.equal(
    noSelectionProtocol.source_reconciliation.not_applicable_without_selected_candidate,
    true,
  );
  assert.deepEqual(
    validateGeneration6RobustnessProtocol(noSelectionProtocol, noSelection),
    { passes: true, reasons: [] },
  );
});

test("frozen selection validator requires all seven candidates and every comparator in the ledger", () => {
  const output = generation6Output();
  const selection = selectGeneration6RobustnessCandidates(output);
  const receipt = {
    schema_version: "finly_champion_generation6_result_receipt.v1",
    disposition: output.disposition,
    selected_ids_before_post_selection_robustness: selection.track_selected_ids,
  };
  const simulations = Object.fromEntries([
    ...GENERATION6_CANDIDATE_IDS,
    "spy_buy_hold",
    "bil_cash",
    ...GENERATION6_GROWTH_CONTROL_IDS,
  ].map((id) => [id, []]));
  const ledger = { schema_version: "finly_generation6_private_ledger.v1", simulations };
  assert.deepEqual(validateGeneration6FrozenSelection(output, receipt, ledger), {
    passes: true,
    reasons: [],
    selection,
  });
  delete simulations[GENERATION6_CANDIDATE_IDS.at(-1)];
  const rejected = validateGeneration6FrozenSelection(output, receipt, ledger);
  assert.equal(rejected.passes, false);
  assert.ok(rejected.reasons.some((reason) => reason.includes("private ledger omits")));
});

test("validation annual-origin gate requires positive median edge and at least 60 percent wins at all horizons", () => {
  const rowsById = {
    candidate: Array.from({ length: 2_400 }, (_, index) => simulationRow(
      index,
      0.00045 + 0.00003 * Math.sin(index / 17),
    )),
    benchmark: Array.from({ length: 2_400 }, (_, index) => simulationRow(
      index,
      0.00010 + 0.00003 * Math.sin(index / 17),
    )),
  };
  const evidence = buildGeneration6AnnualOriginConsistency(
    rowsById,
    "candidate",
    ["benchmark"],
  );
  assert.equal(evidence.all_required_comparators_pass, true);
  assert.equal(evidence.comparisons.benchmark.assessment.passes, true);
  for (const sessions of GENERATION6_ANNUAL_ORIGIN_HORIZONS) {
    const horizon = evidence.comparisons.benchmark.assessment.horizons[sessions];
    assert.ok(horizon.window_count > 0);
    assert.ok(horizon.median_annualized_log_growth_difference > 0);
    assert.ok(horizon.positive_fraction >= 0.60);
  }

  const failedRaw = structuredClone(evidence.comparisons.benchmark.evidence);
  failedRaw.horizons[504].positive_fraction = 0.59;
  const failed = assessGeneration6AnnualOriginConsistency(failedRaw);
  assert.equal(failed.horizons[504].gates.positive_fraction_at_least_0_60, false);
  assert.equal(failed.passes, false);
});

test("every annual origin independently matches canonical BIL entry and terminal rebase", () => {
  const candidateRows = Array.from({ length: 2_400 }, (_, index) => simulationRow(
    index,
    0.00045 + 0.00003 * Math.sin(index / 17),
  )).filter((row) => (
    row.execution_return_date >= GENERATION6_SLICES.validation.start
    && row.execution_return_date <= GENERATION6_SLICES.validation.end
  ));
  const benchmarkRows = Array.from({ length: 2_400 }, (_, index) => simulationRow(
    index,
    0.00010 + 0.00003 * Math.sin(index / 17),
  )).filter((row) => (
    row.execution_return_date >= GENERATION6_SLICES.validation.start
    && row.execution_return_date <= GENERATION6_SLICES.validation.end
  ));
  const secondOriginIndex = candidateRows.findIndex((row) => (
    row.execution_return_date.startsWith("2019-")
  ));
  assert.ok(secondOriginIndex > 0);
  for (const rows of [candidateRows, benchmarkRows]) {
    const row = rows[secondOriginIndex];
    rows[secondOriginIndex] = {
      ...row,
      terminal_liquidation: true,
      terminal_liquidation_notional: 1,
      terminal_liquidation_cost: 0.0005,
      transaction_cost: 0.0005,
      turnover_notional: 1,
      net_return: row.gross_return - 0.0005,
    };
  }
  const evidence = independentlyRebasedGeneration6AnnualOriginSummaries(
    candidateRows,
    benchmarkRows,
    {
      candidateId: "candidate",
      benchmarkId: "benchmark",
      horizons: [252],
      periodsPerYear: 252,
      cashSymbol: "BIL",
      oneWayCostBps: 5,
    },
  );
  const later = evidence.horizons[252].windows.find((window) => window.origin_year === 2019);
  assert.ok(later);
  const rebased = rebaseGeneration6AnnualOriginWindow(
    candidateRows,
    later.start_index_within_validation,
    252,
    { cashSymbol: "BIL", oneWayCostBps: 5 },
  );
  const canonical = rebaseRowsForStandalonePeriod(
    candidateRows.slice(later.start_index_within_validation,
      later.start_index_within_validation + 252),
    { cashSymbol: "BIL", oneWayCostBps: 5 },
  );
  assert.deepEqual(rebased, canonical);
  assert.equal(later.independent_boundary_rebase.candidate_rows_sha256, sha256(canonical));
  assert.equal(rebased[0].standalone_entry_cost, 0.001);
  assert.ok(rebased.at(-1).standalone_terminal_liquidation_cost >= 0.000499);
  assert.equal(rebased[0].transaction_cost, rebased[0].standalone_entry_cost);
  assert.equal(evidence.horizons[252].windows[0]
    .independent_boundary_rebase.candidate_entry_cost, 0.001);
  assert.equal(later.independent_boundary_rebase.candidate_entry_cost, 0.001);
});

test("combined source helper/runner contract binds hashes, selection, all symbols, and raw gates", () => {
  const fixture = combinedSourceContractFixture();
  const contract = validateGeneration6CombinedSourceArtifactContract(fixture);
  assert.equal(contract.passes, true);
  assert.equal(contract.status, "PASS");
  assert.deepEqual(contract.selected_candidate_ids, [PRIMARY]);
  assert.deepEqual(contract.required_symbols_for_overall_gate, GENERATION6_SOURCE_SYMBOLS);
  assert.equal(contract.candidate_assessments[PRIMARY].passes, true);

  const forgedPass = combinedSourceContractFixture({ mutateEvidence(evidence) {
    const candidate = evidence.reconciliation.candidate_comparison.candidates[PRIMARY];
    candidate.raw.return_comparison.daily_log_return_correlation = 0;
    candidate.passed = true;
    evidence.reconciliation.candidate_comparison.passed = true;
    evidence.reconciliation.passed = true;
  } });
  const rejectedForgedPass = validateGeneration6CombinedSourceArtifactContract(forgedPass);
  assert.equal(rejectedForgedPass.passes, false);
  assert.ok(rejectedForgedPass.candidate_assessments[PRIMARY].reasons.some(
    (reason) => reason.includes("reported candidate gates differ from raw-metric recomputation"),
  ));

  const thresholdDrift = combinedSourceContractFixture({ mutateEvidence(evidence) {
    evidence.reconciliation.thresholds.candidate_minimum_daily_log_return_correlation = 0;
  } });
  const rejectedDrift = validateGeneration6CombinedSourceArtifactContract(thresholdDrift);
  assert.equal(rejectedDrift.passes, false);
  assert.ok(rejectedDrift.candidate_assessments[PRIMARY].reasons.includes(
    "source-reconciliation threshold registry drifted",
  ));

  const forgedV2Binding = combinedSourceContractFixture({ mutateEvidence(evidence) {
    evidence.sources.alpaca_adjustment_all_panel.series_integrity_sha256 = "0".repeat(64);
  } });
  const rejectedV2Binding = validateGeneration6CombinedSourceArtifactContract(forgedV2Binding);
  assert.equal(rejectedV2Binding.passes, false);
  assert.ok(rejectedV2Binding.reasons.includes(
    "source report does not attest the frozen Alpaca v2 raw/intersection inputs",
  ));

  const missing = assessGeneration6SourceReconciliation(null, {
    candidate_id: PRIMARY,
  });
  assert.equal(missing.status, "NOT_RUN");
  assert.equal(missing.passes, false);
  assert.deepEqual(missing.missing_symbols, GENERATION6_SOURCE_SYMBOLS);
});

test("track summaries keep primary SPY and all-three-growth-control conclusions separate", () => {
  const passingCost = {
    assessments: Object.fromEntries([
      "spy_buy_hold",
      ...GENERATION6_GROWTH_CONTROL_IDS,
    ].map((id) => [id, { passes: true }])),
  };
  const passingAnchor = structuredClone(passingCost);
  const annualOrigin = {
    comparisons: Object.fromEntries([
      "spy_buy_hold",
      ...GENERATION6_GROWTH_CONTROL_IDS,
    ].map((id) => [id, passingComparison()])),
  };
  const riskMatchedSpy = {
    assessment: {
      schema_version: "finly_generation6_causal_volatility_matched_spy_slice_assessment.v1",
      passes: true,
    },
  };
  const growthJointStatistical = { passes: true };
  const summary = summarizeGeneration6CandidateRobustness({
    candidateId: PRIMARY,
    tracks: ["primary_spy", "growth_control_challenge"],
    statistical: { passes: true },
    costStress: passingCost,
    anchorStress: passingAnchor,
    riskMatchedSpy,
    annualOrigin,
    sourceReconciliation: { passes: true },
    growthJointStatistical,
  });
  assert.equal(summary.primary_spy.passes, true);
  assert.equal(summary.growth_control_challenge.passes, true);

  const growthFailure = structuredClone(passingCost);
  growthFailure.assessments.qqq_buy_hold.passes = false;
  const separated = summarizeGeneration6CandidateRobustness({
    candidateId: PRIMARY,
    tracks: ["primary_spy", "growth_control_challenge"],
    statistical: { passes: true },
    costStress: growthFailure,
    anchorStress: passingAnchor,
    riskMatchedSpy,
    annualOrigin,
    sourceReconciliation: { passes: true },
    growthJointStatistical,
  });
  assert.equal(separated.primary_spy.passes, true);
  assert.equal(separated.growth_control_challenge.passes, false);
  assert.equal(separated.growth_control_challenge.evidence_class,
    "PENALIZED_RETROSPECTIVE_JOINT_MEAN_LOG_GROWTH_TEST");
  assert.equal(separated.growth_control_challenge.statistical_superiority_tested, true);

  const statisticalFailure = summarizeGeneration6CandidateRobustness({
    candidateId: PRIMARY,
    tracks: ["primary_spy", "growth_control_challenge"],
    statistical: { passes: true },
    costStress: passingCost,
    anchorStress: passingAnchor,
    riskMatchedSpy,
    annualOrigin,
    sourceReconciliation: { passes: true },
    growthJointStatistical: { passes: false },
  });
  assert.equal(statisticalFailure.primary_spy.passes, true);
  assert.equal(statisticalFailure.growth_control_challenge.passes, false);
  assert.equal(
    statisticalFailure.growth_control_challenge.components
      .joint_mean_log_growth_statistical_gate,
    false,
  );
});

test("robustness claim excludes live peers and recovers a stale crash claim", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finly-g6-robustness-claim-"));
  const path = join(directory, "claim.json");
  try {
    const first = await acquireExclusiveGeneration6RobustnessClaim(path, {
      generatedAt: "2026-08-29T01:00:00.000Z",
      ownerPid: 101,
      isProcessAlive: (pid) => pid === 101,
    });
    await assert.rejects(
      acquireExclusiveGeneration6RobustnessClaim(path, {
        ownerPid: 202,
        isProcessAlive: (pid) => pid === 101,
      }),
      /already claimed by active process 101/,
    );
    await releaseGeneration6RobustnessClaim(first);

    await acquireExclusiveGeneration6RobustnessClaim(path, {
      generatedAt: "2026-08-29T02:00:00.000Z",
      ownerPid: 303,
      isProcessAlive: () => false,
    });
    const recovered = await acquireExclusiveGeneration6RobustnessClaim(path, {
      ownerPid: 404,
      isProcessAlive: () => false,
    });
    assert.equal(recovered.generated_at, "2026-08-29T02:00:00.000Z");
    assert.equal(recovered.owner_pid, 404);
    await releaseGeneration6RobustnessClaim(recovered);
    await assert.rejects(readFile(`${path}.recovery`), { code: "ENOENT" });

    await acquireExclusiveGeneration6RobustnessClaim(path, {
      generatedAt: "2026-08-29T03:00:00.000Z",
      ownerPid: 505,
      isProcessAlive: () => false,
    });
    const contenders = await Promise.allSettled([
      acquireExclusiveGeneration6RobustnessClaim(path, {
        ownerPid: 606,
        isProcessAlive: (pid) => pid === 606 || pid === 707,
      }),
      acquireExclusiveGeneration6RobustnessClaim(path, {
        ownerPid: 707,
        isProcessAlive: (pid) => pid === 606 || pid === 707,
      }),
    ]);
    const winners = contenders.filter((result) => result.status === "fulfilled");
    const rejected = contenders.filter((result) => result.status === "rejected");
    assert.equal(winners.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason.message, /already exclusively claimed|already claimed by active process/);
    await releaseGeneration6RobustnessClaim(winners[0].value);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("robustness artifacts use wx and resume only byte-identical partial writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finly-g6-robustness-output-"));
  try {
    const artifacts = [
      { path: join(directory, "one.json"), payload: Buffer.from("one\n") },
      { path: join(directory, "two.md"), payload: Buffer.from("two\n") },
    ];
    await writeFile(artifacts[0].path, artifacts[0].payload, { flag: "wx" });
    const resumed = await persistImmutableGeneration6RobustnessArtifacts(artifacts);
    assert.equal(resumed.mode, "WROTE_ONCE_OR_VERIFIED_CRASH_RESUME");
    assert.equal(await readFile(artifacts[1].path, "utf8"), "two\n");
    const verified = await persistImmutableGeneration6RobustnessArtifacts(
      artifacts,
      { verifyExisting: true },
    );
    assert.equal(verified.mode, "VERIFIED_EXISTING");
    await assert.rejects(
      persistImmutableGeneration6RobustnessArtifacts([
        { path: artifacts[0].path, payload: Buffer.from("forged\n") },
      ]),
      /differs from deterministic recomputation/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runner is no-fetch, write-once, and byte-exact verification aware", async () => {
  const source = await readFile(new URL(
    "../research/run_quant_champion_generation6_robustness.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /--verify-existing/);
  assert.match(source, /output already exists/);
  assert.match(source, /differs from deterministic recomputation/);
  assert.match(source, /flag: "wx"/);
  assert.doesNotMatch(source, /\brename\s*\(/);
  assert.equal(
    GENERATION6_ROBUSTNESS_PATHS.robustness_protocol,
    "research/champion_generation6_robustness_protocol.json",
  );
  assert.equal(
    GENERATION6_ROBUSTNESS_PATHS.robustness_freeze_receipt,
    "research/champion_generation6_robustness_freeze_receipt.json",
  );
});
