import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { normalizeLongWeights, round, sha256 } from "../research/champion_engine.mjs";
import {
  createGeneration6Strategies,
  GENERATION6_CANDIDATE_IDS,
  GENERATION6_METADATA,
} from "../research/champion_strategies_generation6.mjs";
import { GENERATION5_SOURCE_THRESHOLDS } from "../research/source_overlap_reconciliation_generation5.mjs";
import {
  buildGeneration6AlpacaAdjustmentAllPanel,
  GENERATION6_ALPACA_PANEL_REQUEST,
} from "../research/persist_alpaca_adjustment_all_panel_generation6.mjs";
import {
  buildGeneration6SourceReconciliation,
  compareGeneration6CandidatesAcrossSources,
  compareGeneration6DecisionRecords,
  evaluateGeneration6CandidateGates,
  evaluateGeneration6SymbolGates,
  extractGeneration6SelectedCandidates,
  generation6DecisionStateSpecification,
  generation6SeriesBySymbolFromPoints,
  GENERATION6_CANDIDATE_REQUIRED_SYMBOLS,
  GENERATION6_PER_SYMBOL_THRESHOLDS,
  GENERATION6_SOURCE_SIMULATION_OPTIONS,
  GENERATION6_SOURCE_SERIES_CONTRACT,
  GENERATION6_SOURCE_SYMBOLS,
  GENERATION6_SOURCE_THRESHOLDS,
} from "../research/source_overlap_reconciliation_generation6.mjs";
import {
  generation6AlpacaSeriesIntegritySha256,
  GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA,
  GENERATION6_SOURCE_FREEZE_REQUIRED_FILES,
  GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS,
  hasExactManifestKeys,
  persistImmutableGeneration6SourceArtifacts,
  validateGeneration6SourceFreezeReceipt,
  validateGeneration6SourceProtocol,
  validateGeneration6AlpacaSourcePanelV2,
} from "../research/run_source_overlap_reconciliation_generation6.mjs";

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function weekdayDates(length, start = "2018-01-01") {
  const dates = [];
  let timestamp = Date.parse(`${start}T00:00:00Z`);
  while (dates.length < length) {
    const date = new Date(timestamp);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(date.toISOString().slice(0, 10));
    timestamp += 86_400_000;
  }
  return dates;
}

function syntheticPoints(length = 1_300) {
  const dates = weekdayDates(length);
  return dates.map((date, index) => Object.freeze({
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

function selectedOutput(primary, growth = primary) {
  return {
    schema_version: "finly_quant_champion_generation6.v1",
    selection: {
      primary_spy_track: { selected_id_before_post_selection_robustness: primary },
      growth_control_challenge_track: { selected_id_before_post_selection_robustness: growth },
    },
  };
}

function declaredAlpacaSeriesIntegrity() {
  return Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol, index) => [symbol, {
    observations: 1_300 + index,
    start_date: "2018-01-01",
    end_date: "2023-01-01",
    date_sha256: sha256([symbol, "dates"]),
    series_sha256: sha256([symbol, "series"]),
  }]));
}

function protocolFixture() {
  const seriesIntegrityBySymbol = declaredAlpacaSeriesIntegrity();
  return {
    schema_version: "finly_source_overlap_reconciliation_generation6_protocol.v1",
    status: "FROZEN_BEFORE_FIRST_GENERATION6_SOURCE_RUN",
    symbols: [...GENERATION6_SOURCE_SYMBOLS],
    overall_gate: {
      scope: "ALL_20_CORE_SYMBOLS_INCLUDING_CANDIDATE_AND_COMPARATOR_INPUTS",
      required_symbols: [...GENERATION6_SOURCE_SYMBOLS],
      every_required_symbol_must_pass: true,
    },
    pass_thresholds: { ...GENERATION6_SOURCE_THRESHOLDS },
    simulation_options: { ...GENERATION6_SOURCE_SIMULATION_OPTIONS },
    source_series_contract: { ...GENERATION6_SOURCE_SERIES_CONTRACT },
    prior_generation5_boundary: {
      inherit_overall_disposition: false,
      reason: "Generation 5 tested a different candidate family.",
    },
    frozen_inputs: {
      generation6_selection_output: {
        path: "research/output/quant_champion_generation6.json",
        payload_sha256: "a".repeat(64),
        schema_version: "finly_quant_champion_generation6.v1",
      },
      yahoo_generation4_panel: {
        path: "data/private/champion_search/generation4_panel.json",
        payload_sha256: "b".repeat(64),
        normalized_panel_sha256: "c".repeat(64),
        role: "hash_pinned_generation4_yahoo_adjusted_close",
      },
      alpaca_adjustment_all_panel: {
        path: "data/private/champion_search/generation6_alpaca_all_panel.json",
        payload_sha256: "d".repeat(64),
        schema_version: GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA,
        series_integrity_by_symbol: seriesIntegrityBySymbol,
        series_integrity_sha256:
          generation6AlpacaSeriesIntegritySha256(seriesIntegrityBySymbol),
        strategy_intersection_normalized_panel_sha256: "e".repeat(64),
        role: "separately_persisted_hash_pinned_alpaca_adjustment_all",
        adjustment: "all",
      },
    },
    security: { runner_network_permitted: false },
    execution_status_at_freeze: { results_seen: false, all_outputs_absent: true },
    output_paths: [...GENERATION6_SOURCE_OUTPUT_RELATIVE_PATHS],
  };
}

function syntheticAlpacaV2Panel(points, { extraXlkDates = 0 } = {}) {
  const acquisitionPoints = points.map((point, index) => ({
    ...point,
    date: index === points.length - 1 ? GENERATION6_ALPACA_PANEL_REQUEST.end : point.date,
  }));
  const baseSeries = generation6SeriesBySymbolFromPoints(acquisitionPoints);
  const seriesBySymbol = Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol) => [
    symbol,
    baseSeries[symbol].map((point) => ({ ...point })),
  ]));
  if (extraXlkDates > 0) {
    const used = new Set(acquisitionPoints.map((point) => point.date));
    const extras = [];
    let timestamp = Date.parse(`${acquisitionPoints[0].date}T00:00:00Z`);
    const end = Date.parse(`${acquisitionPoints.at(-2).date}T00:00:00Z`);
    while (timestamp <= end && extras.length < extraXlkDates) {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      if (!used.has(date)) {
        extras.push({ date, close: seriesBySymbol.XLK[0].close });
      }
      timestamp += 86_400_000;
    }
    assert.equal(extras.length, extraXlkDates);
    seriesBySymbol.XLK = [...seriesBySymbol.XLK, ...extras]
      .sort((left, right) => left.date.localeCompare(right.date));
  }
  const panel = buildGeneration6AlpacaAdjustmentAllPanel(seriesBySymbol, {
    provider: "Alpaca Market Data API",
    origin: "https://data.alpaca.markets",
    path: "/v2/stocks/bars",
    request: structuredClone(GENERATION6_ALPACA_PANEL_REQUEST),
    page_count: 1,
    response_content_sha256: "9".repeat(64),
    adjustment_semantics: "forward/reverse splits, cash dividends, and spin-offs",
    security: {
      method: "GET",
      credentials_persisted: false,
      raw_responses_persisted: false,
      request_headers_persisted: false,
      page_tokens_persisted: false,
    },
  }, { generatedAt: "2026-08-29T14:00:00.000Z" });
  const seriesIntegrityBySymbol = panel.series_integrity_by_symbol;
  const descriptor = {
    schema_version: GENERATION6_ALPACA_SOURCE_PANEL_SCHEMA,
    series_integrity_by_symbol: seriesIntegrityBySymbol,
    series_integrity_sha256: generation6AlpacaSeriesIntegritySha256(seriesIntegrityBySymbol),
    strategy_intersection_normalized_panel_sha256:
      panel.strategy_intersection.normalized_panel_sha256,
  };
  return { panel, descriptor };
}

test("Generation 6 inherits every Generation 5 per-symbol threshold and adds continuous-target gates", () => {
  const expectedPerSymbol = Object.fromEntries(Object.keys(GENERATION6_PER_SYMBOL_THRESHOLDS).map((key) => [
    key,
    GENERATION5_SOURCE_THRESHOLDS[key],
  ]));
  assert.deepEqual(GENERATION6_PER_SYMBOL_THRESHOLDS, expectedPerSymbol);
  assert.deepEqual(GENERATION6_SOURCE_THRESHOLDS, {
    ...expectedPerSymbol,
    candidate_minimum_exact_discrete_or_rank_state_agreement: 0.99,
    candidate_maximum_mean_target_weight_l1_difference: 0.02,
    candidate_maximum_p99_target_weight_l1_difference: 0.10,
    candidate_minimum_daily_log_return_correlation: 0.995,
    candidate_maximum_annualized_log_return_tracking_error: 0.02,
    candidate_maximum_absolute_edge_difference_bps_per_year: 50,
  });
});

test("selected primary and growth winners are deduplicated without inventing a winner", () => {
  const same = extractGeneration6SelectedCandidates(
    selectedOutput("g6_hrp_trend"),
    GENERATION6_CANDIDATE_IDS,
  );
  assert.deepEqual(same.selected_candidate_ids, ["g6_hrp_trend"]);
  assert.equal(same.deduplicated, true);

  const different = extractGeneration6SelectedCandidates(
    selectedOutput("g6_hrp_trend", "g6_residual_sector"),
    GENERATION6_CANDIDATE_IDS,
  );
  assert.deepEqual(different.selected_candidate_ids, ["g6_hrp_trend", "g6_residual_sector"]);
  assert.equal(different.deduplicated, false);

  assert.throws(
    () => extractGeneration6SelectedCandidates(selectedOutput(null, null), GENERATION6_CANDIDATE_IDS),
    /contains no selected/,
  );
  assert.throws(
    () => extractGeneration6SelectedCandidates(selectedOutput("faber_gtaa5_trend"), GENERATION6_CANDIDATE_IDS),
    /unknown or ineligible/,
  );
});

test("candidate symbol registries cover signal inputs and always add SPY/BIL at comparison time", () => {
  assert.deepEqual(GENERATION6_CANDIDATE_REQUIRED_SYMBOLS.g6_equal_evidence_ensemble, GENERATION6_SOURCE_SYMBOLS);
  assert.ok(GENERATION6_CANDIDATE_REQUIRED_SYMBOLS.g6_residual_sector.includes("SPY"));
  assert.ok(GENERATION6_CANDIDATE_REQUIRED_SYMBOLS.g6_residual_sector.includes("QQQ"));
  assert.ok(GENERATION6_CANDIDATE_REQUIRED_SYMBOLS.g6_residual_sector.includes("XLU"));
  assert.ok(GENERATION6_CANDIDATE_REQUIRED_SYMBOLS.g6_hrp_trend.includes("DBC"));
  assert.equal(GENERATION6_CANDIDATE_REQUIRED_SYMBOLS.g6_trend_guard_g4.includes("IWM"), false);
});

test("continuous targets use exact state plus mean/p99 L1 rather than exact full-vector equality", () => {
  const records = Array.from({ length: 100 }, (_, index) => {
    const spyWeight = 0.60 + 0.002 * Math.sin(index);
    return {
      signal_date: weekdayDates(100)[index],
      canonical_target_weights: Object.freeze(Object.fromEntries(GENERATION6_SOURCE_SYMBOLS.map((symbol) => [
        symbol,
        symbol === "SPY" ? spyWeight : symbol === "BIL" ? 1 - spyWeight : 0,
      ]))),
      discrete_or_rank_state: { support: ["SPY"] },
    };
  });
  const shifted = records.map((record, index) => {
    const delta = index === 99 ? 0.02 : 0.001;
    return {
      ...record,
      canonical_target_weights: Object.freeze({
        ...record.canonical_target_weights,
        SPY: record.canonical_target_weights.SPY + delta,
        BIL: record.canonical_target_weights.BIL - delta,
      }),
    };
  });
  const comparison = compareGeneration6DecisionRecords(records, shifted, {
    stateApplicable: true,
    stateKind: "active_target_universe",
  });
  assert.equal(comparison.discrete_or_rank_state.exact_agreement_fraction, 1);
  assert.ok(comparison.target_weight_l1_difference.mean > 0);
  assert.ok(comparison.target_weight_l1_difference.mean < 0.02);
  assert.ok(comparison.target_weight_l1_difference.p99 < 0.10);
  assert.notDeepEqual(records[0].canonical_target_weights, shifted[0].canonical_target_weights);
});

test("raw values infinitesimally outside candidate boundaries fail without favorable rounding", () => {
  const epsilon = 4e-11;
  const outside = evaluateGeneration6CandidateGates({
    stateApplicable: true,
    exactStateAgreement: 0.99 - epsilon,
    meanTargetWeightL1Difference: 0.02 + epsilon,
    p99TargetWeightL1Difference: 0.10 + epsilon,
    rawReturnMetrics: {
      daily_log_return_correlation: 0.995 - epsilon,
      annualized_log_return_tracking_error: 0.02 + epsilon,
    },
    yahooEdge: 0.01,
    alpacaEdge: 0.005 - epsilon,
  });
  assert.equal(outside.exact_discrete_or_rank_state_agreement, false);
  assert.equal(outside.mean_target_weight_l1_difference, false);
  assert.equal(outside.p99_target_weight_l1_difference, false);
  assert.equal(outside.daily_log_return_correlation, false);
  assert.equal(outside.annualized_log_return_tracking_error, false);
  assert.equal(outside.candidate_vs_spy_edge_same_sign, true);
  assert.equal(outside.candidate_vs_spy_edge_difference, false);

  const notApplicable = evaluateGeneration6CandidateGates({
    stateApplicable: false,
    exactStateAgreement: null,
    meanTargetWeightL1Difference: 0,
    p99TargetWeightL1Difference: 0,
    rawReturnMetrics: { daily_log_return_correlation: 1, annualized_log_return_tracking_error: 0 },
    yahooEdge: 0.01,
    alpacaEdge: 0.01,
  });
  assert.equal(notApplicable.exact_discrete_or_rank_state_agreement, true);
  assert.ok(Object.values(notApplicable).every(Boolean));
});

test("per-symbol raw gate predicates exactly preserve the Generation 5 risky and BIL rules", () => {
  const epsilon = 4e-11;
  const risky = evaluateGeneration6SymbolGates({
    symbol: "SPY",
    commonSessions: 1_250,
    yahooCoverageOfAlpaca: 0.99,
    rawMetrics: {
      daily_log_return_correlation: 0.995 - epsilon,
      annualized_log_return_tracking_error: 0.03 + epsilon,
      median_absolute_daily_log_return_difference_bps: 5 + epsilon,
      p99_absolute_daily_log_return_difference_bps: 50 + epsilon,
    },
  });
  assert.equal(risky.minimum_common_sessions, true);
  assert.equal(risky.yahoo_covers_alpaca_dates, true);
  assert.ok(Object.values(risky).slice(2).every((value) => value === false));
  const bil = evaluateGeneration6SymbolGates({
    symbol: "BIL",
    commonSessions: 1_250,
    yahooCoverageOfAlpaca: 0.99,
    rawMetrics: {
      annualized_mean_log_return_difference_bps: 25 + epsilon,
      annualized_log_return_tracking_error: 0.01 + epsilon,
      median_absolute_daily_log_return_difference_bps: 1 + epsilon,
      p99_absolute_daily_log_return_difference_bps: 5 + epsilon,
    },
  });
  assert.equal("daily_log_return_correlation" in bil, false);
  assert.ok(Object.values(bil).slice(2).every((value) => value === false));
});

test("identical hash-ready panels pass, report all 20, and deduplicate one selected G6 candidate", () => {
  const points = syntheticPoints();
  const series = generation6SeriesBySymbolFromPoints(points);
  const result = buildGeneration6SourceReconciliation({
    selectionOutput: selectedOutput("g6_trend_guard_g4"),
    allowedCandidateIds: GENERATION6_CANDIDATE_IDS,
    yahooSeriesBySymbol: series,
    alpacaAllSeriesBySymbol: series,
    createStrategies: createGeneration6Strategies,
    metadata: GENERATION6_METADATA,
  });
  assert.equal(result.passed, true);
  assert.equal(result.all_20_symbols_reported, true);
  assert.equal(Object.keys(result.per_symbol).length, 20);
  assert.deepEqual(result.selection.selected_candidate_ids, ["g6_trend_guard_g4"]);
  assert.equal(result.candidate_comparison.candidates.g6_trend_guard_g4.passed, true);
  assert.equal(result.prior_generation5_boundary.inherited, false);
});

test("Alpaca v2 preserves raw missing-date evidence while candidate simulation uses only the exact intersection", () => {
  const points = syntheticPoints();
  const yahoo = generation6SeriesBySymbolFromPoints(points);
  const { panel, descriptor } = syntheticAlpacaV2Panel(points, { extraXlkDates: 20 });
  const validated = validateGeneration6AlpacaSourcePanelV2(panel, descriptor);
  assert.equal(validated.perSymbolSeriesBySymbol.XLK.length, points.length + 20);
  assert.equal(validated.strategySeriesBySymbol.XLK.length, points.length);

  const reconciliation = buildGeneration6SourceReconciliation({
    selectionOutput: selectedOutput("g6_trend_guard_g4"),
    allowedCandidateIds: GENERATION6_CANDIDATE_IDS,
    yahooPerSymbolSeriesBySymbol: yahoo,
    alpacaPerSymbolSeriesBySymbol: validated.perSymbolSeriesBySymbol,
    yahooStrategySeriesBySymbol: yahoo,
    alpacaStrategySeriesBySymbol: validated.strategySeriesBySymbol,
    createStrategies: createGeneration6Strategies,
    metadata: GENERATION6_METADATA,
  });
  assert.equal(reconciliation.candidate_comparison.candidates.g6_trend_guard_g4.passed, true);
  assert.equal(reconciliation.per_symbol.XLK.alpaca_all_sessions_in_overlap, points.length + 19);
  assert.equal(reconciliation.per_symbol.XLK.gates.yahoo_covers_alpaca_dates, false);
  assert.equal(reconciliation.per_symbol.XLK.passed, false);
  assert.equal(reconciliation.passed, false);
  assert.deepEqual(reconciliation.source_series_contract, {
    per_symbol_gates: "ORIGINAL_PER_SYMBOL_HISTORIES_WITHOUT_INTERSECTION_COLLAPSE",
    candidate_simulation: "EXACT_ALL_20_SYMBOL_STRATEGY_INTERSECTION_ONLY",
  });
});

test("Alpaca source validator rejects v1 intersection-only panels and forged raw-series integrity", () => {
  const points = syntheticPoints();
  const { panel, descriptor } = syntheticAlpacaV2Panel(points);
  assert.throws(
    () => validateGeneration6AlpacaSourcePanelV2({
      schema_version: "finly_generation6_alpaca_adjustment_all_panel.v1",
      provider: panel.provider,
      adjustment: "all",
      symbols: [...GENERATION6_SOURCE_SYMBOLS],
      points,
    }, descriptor),
    /intersection-only v1 panels are forbidden/,
  );
  const forged = structuredClone(panel);
  forged.series_integrity_by_symbol.XLK.observations += 1;
  assert.throws(
    () => validateGeneration6AlpacaSourcePanelV2(forged, descriptor),
    /cannot be fully reproduced|embedded raw per-symbol integrity cannot be reproduced/,
  );
  const truncatedIntersection = structuredClone(panel);
  truncatedIntersection.strategy_intersection.points.pop();
  truncatedIntersection.strategy_intersection.observations -= 1;
  truncatedIntersection.strategy_intersection.end_date =
    truncatedIntersection.strategy_intersection.points.at(-1).date;
  truncatedIntersection.strategy_intersection.normalized_panel_sha256 = sha256(
    truncatedIntersection.strategy_intersection.points.map((point) => [
      point.date,
      ...GENERATION6_SOURCE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
    ]),
  );
  const truncatedDescriptor = {
    ...descriptor,
    strategy_intersection_normalized_panel_sha256:
      truncatedIntersection.strategy_intersection.normalized_panel_sha256,
  };
  assert.throws(
    () => validateGeneration6AlpacaSourcePanelV2(truncatedIntersection, truncatedDescriptor),
    /cannot be fully reproduced|not the exact intersection/,
  );
});

test("every CORE symbol blocks because the combined gate covers candidate and comparator inputs", () => {
  const points = syntheticPoints();
  const yahoo = generation6SeriesBySymbolFromPoints(points);
  const alpacaBase = generation6SeriesBySymbolFromPoints(points);
  const damagedIwm = {
    ...alpacaBase,
    IWM: alpacaBase.IWM.map((point, index) => ({
      ...point,
      close: point.close * (1 + 0.08 * Math.sin(index)),
    })),
  };
  const unusedFailure = buildGeneration6SourceReconciliation({
    selectionOutput: selectedOutput("g6_trend_guard_g4"),
    allowedCandidateIds: GENERATION6_CANDIDATE_IDS,
    yahooSeriesBySymbol: yahoo,
    alpacaAllSeriesBySymbol: damagedIwm,
    createStrategies: createGeneration6Strategies,
    metadata: GENERATION6_METADATA,
  });
  assert.equal(unusedFailure.per_symbol.IWM.passed, false);
  assert.equal(unusedFailure.per_symbol.IWM.required_for_selected_candidates_or_spy_bil, true);
  assert.equal(unusedFailure.per_symbol.IWM.required_for_combined_generation6_gate, true);
  assert.equal(unusedFailure.per_symbol.IWM.blocks_overall_disposition, true);
  assert.equal(unusedFailure.passed, false);

  const damagedXlk = {
    ...alpacaBase,
    XLK: alpacaBase.XLK.map((point, index) => ({
      ...point,
      close: point.close * (1 + 0.08 * Math.sin(index)),
    })),
  };
  const requiredFailure = buildGeneration6SourceReconciliation({
    selectionOutput: selectedOutput("g6_trend_guard_g4"),
    allowedCandidateIds: GENERATION6_CANDIDATE_IDS,
    yahooSeriesBySymbol: yahoo,
    alpacaAllSeriesBySymbol: damagedXlk,
    createStrategies: createGeneration6Strategies,
    metadata: GENERATION6_METADATA,
  });
  assert.equal(requiredFailure.per_symbol.XLK.required_for_selected_candidates_or_spy_bil, true);
  assert.equal(requiredFailure.per_symbol.XLK.required_for_combined_generation6_gate, true);
  assert.equal(requiredFailure.per_symbol.XLK.blocks_overall_disposition, true);
  assert.equal(requiredFailure.passed, false);
  assert.ok(requiredFailure.blocking_reasons.some((reason) => reason.startsWith("XLK failed")));
});

test("decision-state specifications distinguish observable discrete/rank state from the blended ensemble", () => {
  const hrp = generation6DecisionStateSpecification("g6_hrp_trend");
  assert.equal(hrp.applicable, true);
  assert.match(hrp.kind, /rank/);
  const ensemble = generation6DecisionStateSpecification("g6_equal_evidence_ensemble");
  assert.equal(ensemble.applicable, false);
  assert.equal(ensemble.extract, null);
});

test("protocol and freeze validators bind local inputs, thresholds, output absence, and exact code files", () => {
  const protocol = protocolFixture();
  assert.deepEqual(validateGeneration6SourceProtocol(protocol), { passes: true, reasons: [] });
  const networkEnabled = structuredClone(protocol);
  networkEnabled.security.runner_network_permitted = true;
  assert.ok(validateGeneration6SourceProtocol(networkEnabled).reasons.includes("protocol permits runner network access"));
  const inherited = structuredClone(protocol);
  inherited.prior_generation5_boundary.inherit_overall_disposition = true;
  assert.ok(validateGeneration6SourceProtocol(inherited).reasons.some((reason) => reason.includes("inheritance")));
  const legacyV1 = structuredClone(protocol);
  legacyV1.frozen_inputs.alpaca_adjustment_all_panel = {
    path: "data/private/champion_search/intersection-only.json",
    payload_sha256: "d".repeat(64),
    schema_version: "finly_generation6_alpaca_adjustment_all_panel.v1",
    normalized_panel_sha256: "e".repeat(64),
    role: "separately_persisted_hash_pinned_alpaca_adjustment_all",
    adjustment: "all",
  };
  const legacyValidation = validateGeneration6SourceProtocol(legacyV1);
  assert.equal(legacyValidation.passes, false);
  assert.ok(legacyValidation.reasons.includes("Alpaca panel must use the lossless v2 schema"));
  assert.ok(legacyValidation.reasons.some((reason) => reason.includes("raw per-symbol integrity")));
  const forgedIntegrity = structuredClone(protocol);
  forgedIntegrity.frozen_inputs.alpaca_adjustment_all_panel
    .series_integrity_by_symbol.XLK.observations += 1;
  assert.ok(validateGeneration6SourceProtocol(forgedIntegrity).reasons.includes(
    "Alpaca panel raw-series integrity hash is invalid",
  ));

  const protocolRaw = Buffer.from(`${JSON.stringify(protocol, null, 2)}\n`);
  const files = Object.fromEntries(GENERATION6_SOURCE_FREEZE_REQUIRED_FILES.map((path) => [path, "f".repeat(64)]));
  files["research/source_overlap_reconciliation_generation6_protocol.json"] = sha256Bytes(protocolRaw);
  const receipt = {
    schema_version: "finly_source_overlap_reconciliation_generation6_freeze_receipt.v1",
    frozen_before_first_source_run: true,
    source_results_seen_at_freeze: false,
    all_source_outputs_absent_at_freeze: true,
    runner_network_permitted: false,
    files,
  };
  assert.deepEqual(validateGeneration6SourceFreezeReceipt(receipt, protocolRaw), { passes: true, reasons: [] });
  assert.equal(hasExactManifestKeys(files, GENERATION6_SOURCE_FREEZE_REQUIRED_FILES), true);
  assert.equal(hasExactManifestKeys({ ...files, unexpected: "0".repeat(64) }, GENERATION6_SOURCE_FREEZE_REQUIRED_FILES), false);
});

test("immutable persistence writes once, verifies byte equality, and refuses overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finly-g6-source-"));
  try {
    const artifacts = [
      { path: join(directory, "one.json"), payload: Buffer.from("one\n") },
      { path: join(directory, "two.md"), payload: Buffer.from("two\n") },
    ];
    const written = await persistImmutableGeneration6SourceArtifacts(artifacts);
    assert.equal(written.mode, "WROTE_ONCE");
    assert.equal((await readFile(artifacts[0].path, "utf8")), "one\n");
    const verified = await persistImmutableGeneration6SourceArtifacts(artifacts, { verifyExisting: true });
    assert.equal(verified.mode, "VERIFIED_EXISTING");
    await assert.rejects(
      () => persistImmutableGeneration6SourceArtifacts(artifacts),
      /already exists/,
    );
    await writeFile(artifacts[1].path, "changed\n");
    await assert.rejects(
      () => persistImmutableGeneration6SourceArtifacts(artifacts, { verifyExisting: true }),
      /differs from deterministic recomputation/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runner source contains no market client or network call", async () => {
  const source = await readFile(new URL("../research/run_source_overlap_reconciliation_generation6.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /AlpacaGeneration\w*Client/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test("synthetic custom strategy exercises the generic continuous-weight source contract", () => {
  const points = syntheticPoints();
  const yahoo = generation6SeriesBySymbolFromPoints(points);
  const alpacaPoints = points.map((point, index) => ({
    ...point,
    QQQ: point.QQQ * Math.exp(0.00005 * Math.sin(index / 17)),
  }));
  const alpaca = generation6SeriesBySymbolFromPoints(alpacaPoints);
  const createStrategies = () => [{
    id: "custom_continuous",
    rebalanceIntervalSessions: 21,
    decide({ points: localPoints, signalIndex }) {
      const momentum = Math.log(localPoints[signalIndex].QQQ / localPoints[signalIndex - 21].QQQ);
      const spyWeight = Math.max(0.40, Math.min(0.60, 0.50 + momentum));
      return normalizeLongWeights({ SPY: spyWeight, QQQ: 0.40 }, { cashSymbol: "BIL", maximumRiskyGross: 1 });
    },
  }];
  const comparison = compareGeneration6CandidatesAcrossSources({
    yahooSeriesBySymbol: yahoo,
    alpacaAllSeriesBySymbol: alpaca,
    createStrategies,
    metadata: { custom_continuous: { eligible: true } },
    selectedCandidateIds: ["custom_continuous"],
    requiredSymbolsByCandidateId: { custom_continuous: ["SPY", "BIL", "QQQ"] },
    stateSpecificationForCandidate: () => ({
      applicable: true,
      kind: "active_target_universe",
      extract(weights, symbols) {
        return { support: symbols.filter((symbol) => symbol !== "BIL" && weights[symbol] > 1e-10) };
      },
    }),
  });
  const candidate = comparison.candidates.custom_continuous;
  assert.equal(candidate.decision_comparison.discrete_or_rank_state.exact_agreement_fraction, 1);
  assert.ok(candidate.decision_comparison.target_weight_l1_difference.mean > 0);
  assert.ok(candidate.decision_comparison.target_weight_l1_difference.mean < 0.02);
  assert.ok(candidate.decision_comparison.target_weight_l1_difference.p99 < 0.10);
  assert.equal(candidate.passed, true);
  assert.deepEqual(Object.keys(GENERATION6_CANDIDATE_REQUIRED_SYMBOLS).sort(), [...GENERATION6_CANDIDATE_IDS].sort());
});
