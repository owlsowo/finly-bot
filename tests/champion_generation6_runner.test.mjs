import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GENERATION6_METADATA } from "../research/champion_strategies_generation6.mjs";
import {
  annualizedLogGrowth,
  annualizedLogGrowthEdge,
  buildAnnualizedLogGrowthComparisons,
  buildGeneration6Assessments,
  buildGeneration6SliceMetrics,
  buildRecurringContributionEvidence,
  causalFourRegimeEvidence,
  concentrationStatistics,
  GENERATION6_ALL_IDS,
  GENERATION6_BASE_OPTIONS,
  GENERATION6_CANDIDATE_IDS,
  GENERATION6_COMPARATOR_IDS,
  GENERATION6_CONTROL_IDS,
  GENERATION6_GROWTH_CONTROL_IDS,
  GENERATION6_RUN_CLAIM_RELATIVE_PATH,
  GENERATION6_RECURRING_SPECIFICATION,
  GENERATION6_REGIME_SPECIFICATION,
  GENERATION6_ROLLING_HORIZONS,
  GENERATION6_SELECTION_THRESHOLDS,
  GENERATION6_SLICES,
  rollingSessionComparison,
  rollingStandaloneWindowReturns,
  selectGeneration6Candidate,
  validateGeneration6Protocol,
  withExclusiveDirectoryLock,
  writeOnceOrVerify,
} from "../research/run_quant_champion_generation6.mjs";
import { CORE_SYMBOLS } from "../research/champion_strategies.mjs";
import { rebaseRowsForStandalonePeriod } from "../research/champion_engine.mjs";
import {
  GENERATION6_BLOCK_LENGTHS,
  GENERATION6_BOOTSTRAP_ITERATIONS,
  GENERATION6_BOOTSTRAP_SEEDS,
  GENERATION6_COST_LEVELS_BPS,
  GENERATION6_CUMULATIVE_TRIALS,
  GENERATION6_REBALANCE_ANCHORS,
  GENERATION6_VOLATILITY_MATCH_SPECIFICATION,
} from "../research/champion_generation6_robustness.mjs";
import { GENERATION6_GROWTH_STATISTICS_SPECIFICATION } from "../research/champion_generation6_growth_statistics.mjs";
import {
  GENERATION6_CANDIDATE_REQUIRED_SYMBOLS,
  GENERATION6_SOURCE_SIMULATION_OPTIONS,
  GENERATION6_SOURCE_SYMBOLS,
  GENERATION6_SOURCE_THRESHOLDS,
} from "../research/source_overlap_reconciliation_generation6.mjs";
import {
  GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH,
  GENERATION6_ALPACA_PANEL_PROTOCOL_PATH,
  GENERATION6_ALPACA_PANEL_REQUEST,
  GENERATION6_ALPACA_PANEL_RESULT_RECEIPT_PATH,
  GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH,
} from "../research/persist_alpaca_adjustment_all_panel_generation6.mjs";

function isoDate(index, start = "2010-01-01T00:00:00Z") {
  return new Date(Date.parse(start) + index * 86_400_000).toISOString().slice(0, 10);
}

function row(date, netReturn, {
  spyReturn = netReturn,
  bilReturn = 0,
  weights = { SPY: 1, BIL: 0, QQQ: 0, XLK: 0 },
  turnover = 0,
  transactionCost = 0,
} = {}) {
  return Object.freeze({
    signal_date: date,
    rebalance_date: date,
    execution_return_date: date,
    rebalanced: false,
    signal_weights: Object.freeze({ ...weights }),
    weights: Object.freeze({ ...weights }),
    asset_returns: Object.freeze({
      ...Object.fromEntries(Object.keys(weights).map((symbol) => [symbol, 0])),
      SPY: spyReturn,
      BIL: bilReturn,
    }),
    cash_return: bilReturn,
    gross_return: netReturn + transactionCost,
    transaction_cost: transactionCost,
    financing_spread_cost: 0,
    turnover_notional: turnover,
    net_return: netReturn,
  });
}

function metric(logGrowth, {
  sharpe = 1,
  drawdown = -0.15,
  expectedShortfall = -0.02,
  turnover = 2,
} = {}) {
  return Object.freeze({
    observations: 252,
    total_return: Math.exp(logGrowth) - 1,
    cash_excess_sharpe: sharpe,
    maximum_drawdown: drawdown,
    daily_expected_shortfall_p05: expectedShortfall,
    annualized_turnover_notional: turnover,
  });
}

function protocolFixture() {
  const priorHash = "a".repeat(64);
  const panelHash = "b".repeat(64);
  const normalizedPanelHash = "c".repeat(64);
  const alpacaPayloadHash = "d".repeat(64);
  const alpacaSeriesHash = "e".repeat(64);
  const alpacaStrategyHash = "f".repeat(64);
  const privatePanel = {
    path: "data/private/champion_search/generation4_panel_fixture.json",
    payload_sha256: panelHash,
    normalized_panel_sha256: normalizedPanelHash,
    schema_version: "finly_generation4_private_panel.v1",
    common_start: "2007-05-30",
    common_end: "2026-08-27",
    common_sessions: 4_843,
  };
  const protocol = {
    schema_version: "finly_champion_search_generation6_protocol.v1",
    status: "preregistered_before_first_generation_6_output",
    frozen_before_first_generation_6_output: true,
    maximum_permitted_status: "RETROSPECTIVE_PAPER_CHALLENGER",
    frozen_inputs: {
      generation_5_trial_ledger: { path: "research/prior.json", sha256: priorHash },
      generation_4_private_panel: privatePanel,
      generation_6_alpaca_acquisition_protocol: {
        path: GENERATION6_ALPACA_PANEL_PROTOCOL_PATH,
        sha256: "1".repeat(64),
      },
      generation_6_alpaca_acquisition_freeze_receipt: {
        path: GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH,
        sha256: "2".repeat(64),
      },
      generation_6_alpaca_acquisition_run_claim: {
        path: GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH,
        sha256: "3".repeat(64),
      },
      generation_6_alpaca_acquisition_result_receipt: {
        path: GENERATION6_ALPACA_PANEL_RESULT_RECEIPT_PATH,
        sha256: "4".repeat(64),
      },
      generation_6_alpaca_all_panel: {
        path: `data/private/champion_search/alpaca_adjustment_all_panel_generation6_${alpacaPayloadHash}.json`,
        payload_sha256: alpacaPayloadHash,
        schema_version: "finly_generation6_alpaca_adjustment_all_panel.v2",
        role: "preacquired_authenticated_cross_provider_reconciliation_only",
        adjustment: "all",
        request: GENERATION6_ALPACA_PANEL_REQUEST,
        series_integrity_sha256: alpacaSeriesHash,
        strategy_intersection_normalized_panel_sha256: alpacaStrategyHash,
        strategy_intersection_observations: 1_515,
        strategy_intersection_start_date: "2020-07-27",
        strategy_intersection_end_date: "2026-08-27",
      },
    },
    data: {
      runner_market_fetch_permitted: false,
      symbols: [...CORE_SYMBOLS],
      schema_version: privatePanel.schema_version,
      payload_sha256: privatePanel.payload_sha256,
      normalized_panel_sha256: privatePanel.normalized_panel_sha256,
      common_start: privatePanel.common_start,
      common_end: privatePanel.common_end,
      common_sessions: privatePanel.common_sessions,
    },
    execution: {
      signal_trade_return: "close-t information -> queued close-t+1 execution -> first t+1-to-t+2 return",
      lookback_sessions: GENERATION6_BASE_OPTIONS.lookbackSessions,
      rebalance_interval_sessions: GENERATION6_BASE_OPTIONS.rebalanceIntervalSessions,
      rebalance_anchor: GENERATION6_BASE_OPTIONS.rebalanceAnchor,
      base_one_way_cost_bps_per_absolute_traded_notional:
        GENERATION6_BASE_OPTIONS.oneWayCostBps,
      cost_stress_levels_bps: [...GENERATION6_COST_LEVELS_BPS],
      long_only: true,
      maximum_risky_gross: GENERATION6_BASE_OPTIONS.maximumRiskyGross,
      residual_cash_proxy: GENERATION6_BASE_OPTIONS.cashSymbol,
      annual_borrow_spread: GENERATION6_BASE_OPTIONS.annualBorrowSpread,
      terminal_liquidation: GENERATION6_BASE_OPTIONS.terminalLiquidation,
    },
    registered_formulas: GENERATION6_ALL_IDS.map((id, index) => ({
      trial: 106 + index,
      id,
      eligible: GENERATION6_METADATA[id].eligible,
      metadata: GENERATION6_METADATA[id],
    })),
    trial_accounting: {
      prior_cumulative_effective_trials: 105,
      cumulative_effective_trials: 113,
    },
    partitions: structuredClone(GENERATION6_SLICES),
    comparators: [...GENERATION6_COMPARATOR_IDS],
    selection_tracks: {
      primary_spy: {
        candidate_ids: [...GENERATION6_CANDIDATE_IDS],
        benchmark_id: "spy_buy_hold",
        pending_label: "SPY_CHALLENGER_ROBUSTNESS_PENDING",
      },
      growth_control_challenge: {
        candidate_ids: [...GENERATION6_CANDIDATE_IDS],
        benchmark_ids: [...GENERATION6_GROWTH_CONTROL_IDS],
        pending_label: "GROWTH_CONTROL_CHALLENGER_ROBUSTNESS_PENDING",
        can_veto_primary_spy: false,
      },
    },
    selection: {
      thresholds: { ...GENERATION6_SELECTION_THRESHOLDS },
    },
    diagnostics: {
      regime_specification: GENERATION6_REGIME_SPECIFICATION,
      recurring_contribution: GENERATION6_RECURRING_SPECIFICATION,
    },
    post_selection_robustness: {
      status: "preregistered_before_generation_6_selection_output",
      blocking_for_champion_claim: true,
      cost_sensitivity: {
        cost_levels_bps: [...GENERATION6_COST_LEVELS_BPS],
        minimum_spy_edge: 0,
      },
      anchor_sensitivity: {
        rebalance_anchors: [...GENERATION6_REBALANCE_ANCHORS],
        one_way_cost_bps: 5,
        minimum_spy_edge: 0,
      },
      statistical_validation: {
        slice: "validation",
        cumulative_effective_trials: GENERATION6_CUMULATIVE_TRIALS,
        bootstrap_iterations_per_test: GENERATION6_BOOTSTRAP_ITERATIONS,
        block_lengths_sessions: [...GENERATION6_BLOCK_LENGTHS],
        methods: ["circular", "moving"],
        frozen_seeds: structuredClone(GENERATION6_BOOTSTRAP_SEEDS),
        deflated_sharpe_probability_minimum: 0.95,
        cumulative_familywise_p_value_maximum: 0.05,
      },
      growth_control_joint_statistical_validation: {
        slice: "validation",
        specification: GENERATION6_GROWTH_STATISTICS_SPECIFICATION,
        all_six_tests_required: true,
        cumulative_familywise_p_value_maximum: 0.05,
      },
      causal_volatility_matched_spy: {
        specification: GENERATION6_VOLATILITY_MATCH_SPECIFICATION,
        required_slices: ["development", "validation"],
      },
      annual_origin_validation: {
        horizons_sessions: [...GENERATION6_ROLLING_HORIZONS],
        minimum_median_edge: 0,
        minimum_positive_window_fraction: 0.60,
      },
      source_reconciliation: {
        combined_artifact_required: true,
        runner_market_fetch_permitted: false,
        g5_overall_disposition_inherited: false,
        all_20_core_symbols_required: true,
        symbols: GENERATION6_SOURCE_SYMBOLS,
        thresholds: GENERATION6_SOURCE_THRESHOLDS,
        simulation_options: GENERATION6_SOURCE_SIMULATION_OPTIONS,
        candidate_required_symbols: GENERATION6_CANDIDATE_REQUIRED_SYMBOLS,
        preacquired_alpaca_panel: {
          schema_version: "finly_generation6_alpaca_adjustment_all_panel.v2",
          payload_sha256: alpacaPayloadHash,
          series_integrity_sha256: alpacaSeriesHash,
          strategy_intersection_normalized_panel_sha256: alpacaStrategyHash,
          strategy_intersection_start_date: "2020-07-27",
          strategy_intersection_end_date: "2026-08-27",
          strategy_intersection_observations: 1_515,
          full_history_certified: false,
          permitted_role: "RECENT_CROSS_PROVIDER_RECONCILIATION_ONLY",
        },
      },
    },
  };
  const ledger = {
    append_only_through: 113,
    prior_ledger_sha256: priorHash,
    blocks: [
      { range: "1-105", count: 105 },
      { range: "106-113", count: 8, ids: [...GENERATION6_ALL_IDS] },
    ],
  };
  return { protocol, ledger };
}

test("Generation 6 runner registry separates the sole literature control from seven candidates", () => {
  assert.deepEqual(GENERATION6_CONTROL_IDS, ["faber_gtaa5_trend"]);
  assert.equal(GENERATION6_CANDIDATE_IDS.length, 7);
  assert.deepEqual(GENERATION6_ALL_IDS, [
    "faber_gtaa5_trend",
    "g6_trend_guard_g4",
    "g6_vol_target_g4",
    "g6_breadth_scaled_g4",
    "g6_residual_sector",
    "g6_long_only_tsmom_1_3_12",
    "g6_hrp_trend",
    "g6_equal_evidence_ensemble",
  ]);
});

test("protocol validation binds formulas, trials, slices, costs, gates, comparators, and the prior ledger", () => {
  const { protocol, ledger } = protocolFixture();
  assert.deepEqual(validateGeneration6Protocol(protocol, ledger), { passes: true, reasons: [] });

  const changed = structuredClone(protocol);
  changed.selection.thresholds.maximum_annualized_turnover_notional = 5;
  changed.partitions.validation.end = "2025-01-01";
  changed.execution.rebalance_anchor = 7;
  changed.execution.residual_cash_proxy = "SPY";
  changed.execution.annual_borrow_spread = 0;
  changed.execution.terminal_liquidation = false;
  changed.data.normalized_panel_sha256 = "d".repeat(64);
  const rejected = validateGeneration6Protocol(changed, ledger);
  assert.equal(rejected.passes, false);
  assert.ok(rejected.reasons.includes("selection threshold mismatch for maximum_annualized_turnover_notional"));
  assert.ok(rejected.reasons.includes("validation partition mismatch"));
  assert.ok(rejected.reasons.includes("protocol rebalance anchor differs"));
  assert.ok(rejected.reasons.includes("protocol residual cash proxy differs"));
  assert.ok(rejected.reasons.includes("protocol annual borrow spread differs"));
  assert.ok(rejected.reasons.includes("protocol terminal-liquidation boundary differs"));
  assert.ok(rejected.reasons.includes(
    "protocol top-level panel normalized hash differs from frozen descriptor",
  ));
});

test("annualized log growth and slice metrics use standalone boundaries", () => {
  const candidateRows = Array.from({ length: 5 }, (_, index) => row(isoDate(index), 0.01));
  const benchmarkRows = Array.from({ length: 5 }, (_, index) => row(isoDate(index), 0.005));
  const metrics = buildGeneration6SliceMetrics([
    { id: "candidate", rows: candidateRows },
    { id: "benchmark", rows: benchmarkRows },
  ], { sample: { start: candidateRows[0].execution_return_date, end: candidateRows.at(-1).execution_return_date } });
  assert.equal(metrics.sample.candidate.observations, 5);
  assert.ok(annualizedLogGrowth(metrics.sample.candidate) > annualizedLogGrowth(metrics.sample.benchmark));
  assert.ok(annualizedLogGrowthEdge(metrics.sample.candidate, metrics.sample.benchmark) > 0);
});

function assessmentMetrics() {
  const development = {
    spy_buy_hold: metric(0.10, { sharpe: 0.80, drawdown: -0.20, expectedShortfall: -0.020 }),
    qqq_buy_hold: metric(0.12, { sharpe: 0.85 }),
    static_spy_qqq_50_50_control: metric(0.11, { sharpe: 0.84 }),
    static_qqq_equal_sectors_control: metric(0.115, { sharpe: 0.84 }),
    bil_cash: metric(0.02, { sharpe: 0, drawdown: 0, expectedShortfall: 0, turnover: 0 }),
    alpha: metric(0.14, { sharpe: 1.05, drawdown: -0.18, expectedShortfall: -0.021, turnover: 3 }),
    beta: metric(0.119, { sharpe: 1.05, drawdown: -0.18, expectedShortfall: -0.021, turnover: 3 }),
  };
  const validation = {
    ...development,
    alpha: metric(0.145, { sharpe: 1.02, drawdown: -0.19, expectedShortfall: -0.0215, turnover: 3.5 }),
    beta: metric(0.13, { sharpe: 1.02, drawdown: -0.19, expectedShortfall: -0.0215, turnover: 3.5 }),
  };
  const recent = {
    ...validation,
    spy_buy_hold: metric(0.08, { sharpe: 0.7, drawdown: -0.12 }),
    bil_cash: metric(0.03, { sharpe: 0, drawdown: 0, expectedShortfall: 0, turnover: 0 }),
    alpha: metric(0.09, { sharpe: 0.9, drawdown: -0.13 }),
    beta: metric(0.09, { sharpe: 0.9, drawdown: -0.21 }),
  };
  return Object.freeze({ development, validation, recent_veto_only: recent });
}

test("economic and growth gates enforce SPY edge, Sharpe, drawdown, ES, turnover, and recent veto", () => {
  const metrics = assessmentMetrics();
  const comparisons = buildAnnualizedLogGrowthComparisons(metrics, ["alpha", "beta"]);
  assert.ok(comparisons.development.alpha.spy_buy_hold > 0.005);
  assert.ok(comparisons.validation.alpha.static_qqq_equal_sectors_control > 0);

  const assessments = buildGeneration6Assessments(metrics, ["alpha", "beta"]);
  assert.equal(assessments.alpha.eligible_for_spy_post_selection_robustness, true);
  assert.equal(assessments.alpha.eligible_for_growth_challenge_post_selection_robustness, true);
  assert.equal(assessments.alpha.expected_shortfall.development.passes, true);
  assert.equal(assessments.beta.eligible_for_spy_post_selection_robustness, false);
  assert.equal(assessments.beta.eligible_for_growth_challenge_post_selection_robustness, false);
  assert.equal(assessments.beta.recent_veto.hard_safety_veto, true);
  assert.ok(assessments.beta.recent_veto.reasons.some((reason) => reason.includes("absolute floor")));
});

test("selection keeps the primary SPY and secondary growth-control objectives separate", () => {
  const assessments = buildGeneration6Assessments(assessmentMetrics(), ["alpha", "beta"]);
  const selected = selectGeneration6Candidate(assessments);
  assert.equal(selected.ranked_candidate_ids[0], "alpha");
  assert.equal(selected.selected_id_before_post_selection_robustness, "alpha");
  assert.equal(selected.primary_spy_track.selected_id_before_post_selection_robustness, "alpha");
  assert.equal(selected.growth_control_challenge_track.selected_id_before_post_selection_robustness, "alpha");
  assert.match(selected.recent_data_use, /never rank/);

  const tied = {
    zeta: {
      id: "zeta",
      frozen_spy_minimum_edge_score: 0.02,
      frozen_growth_control_minimum_edge_score: -0.01,
      minimum_cash_excess_sharpe_difference: 0.1,
      validation_maximum_drawdown: -0.15,
      validation_annualized_turnover_notional: 2,
      eligible_for_spy_post_selection_robustness: true,
      eligible_for_growth_challenge_post_selection_robustness: false,
    },
    alpha: {
      id: "alpha",
      frozen_spy_minimum_edge_score: 0.02,
      frozen_growth_control_minimum_edge_score: 0.01,
      minimum_cash_excess_sharpe_difference: 0.1,
      validation_maximum_drawdown: -0.15,
      validation_annualized_turnover_notional: 2,
      eligible_for_spy_post_selection_robustness: true,
      eligible_for_growth_challenge_post_selection_robustness: true,
    },
  };
  const separated = selectGeneration6Candidate(tied);
  assert.equal(separated.ranked_candidate_ids[0], "alpha");
  assert.equal(separated.primary_spy_track.selected_id_before_post_selection_robustness, "alpha");
  assert.equal(separated.growth_control_challenge_track.selected_id_before_post_selection_robustness, "alpha");
  tied.zeta.minimum_cash_excess_sharpe_difference = 0.11;
  assert.equal(selectGeneration6Candidate(tied).ranked_candidate_ids[0], "zeta");
  assert.equal(
    selectGeneration6Candidate(tied).growth_control_challenge_track.selected_id_before_post_selection_robustness,
    "alpha",
  );

  const spyOnlyMetrics = structuredClone(assessmentMetrics());
  spyOnlyMetrics.recent_veto_only.beta = metric(0.09, { sharpe: 0.9, drawdown: -0.13 });
  const spyOnlySelection = selectGeneration6Candidate(buildGeneration6Assessments(spyOnlyMetrics, ["beta"]));
  assert.equal(spyOnlySelection.primary_spy_track.selected_id_before_post_selection_robustness, "beta");
  assert.equal(
    spyOnlySelection.growth_control_challenge_track.selected_id_before_post_selection_robustness,
    null,
  );
});

test("rolling evidence exposes the frozen 252/504/756-session horizons without treating windows as independent", () => {
  const candidate = Array.from({ length: 800 }, (_, index) => row(isoDate(index), 0.001));
  const benchmark = Array.from({ length: 800 }, (_, index) => row(isoDate(index), 0.0005));
  const result = rollingSessionComparison(candidate, benchmark);
  assert.equal(result.by_sessions["252"].windows, 549);
  assert.equal(result.by_sessions["504"].windows, 297);
  assert.equal(result.by_sessions["756"].windows, 45);
  assert.equal(result.by_sessions["756"].candidate_minus_benchmark.positive_fraction, 1);
  assert.match(result.construction, /independently rebased/);
  assert.match(result.inference_boundary, /not independent/);

  const inheritedLiquidation = [...candidate];
  inheritedLiquidation[inheritedLiquidation.length - 1] = Object.freeze({
    ...inheritedLiquidation.at(-1),
    terminal_liquidation: true,
    terminal_liquidation_notional: 1,
    terminal_liquidation_cost: 0.20,
    transaction_cost: 0.20,
    turnover_notional: 1,
    net_return: inheritedLiquidation.at(-1).net_return - 0.20,
  });
  assert.deepEqual(
    rollingSessionComparison(inheritedLiquidation, benchmark, [756]),
    rollingSessionComparison(candidate, benchmark, [756]),
  );
});

test("rolling standalone returns exactly reproduce the canonical boundary engine for every start", () => {
  const rows = Array.from({ length: 14 }, (_, index) => row(isoDate(index), 0.0007 + index * 0.000013, {
    spyReturn: 0.0011 - index * 0.000007,
    bilReturn: 0.00004,
    weights: {
      SPY: 0.19 + (index % 4) * 0.07,
      QQQ: 0.31 - (index % 3) * 0.04,
      XLK: 0.08 + (index % 2) * 0.03,
      BIL: 0.42 - (index % 4) * 0.07 + (index % 3) * 0.04 - (index % 2) * 0.03,
    },
    transactionCost: 0.00000137 * (index + 1),
    turnover: 0.017 * (index + 1),
  }));
  rows[rows.length - 1] = Object.freeze({
    ...rows.at(-1),
    terminal_liquidation: true,
    terminal_liquidation_notional: 0.1234567890123,
    terminal_liquidation_cost: 0.000061728394,
    transaction_cost: rows.at(-1).transaction_cost + 0.000061728394,
    turnover_notional: rows.at(-1).turnover_notional + 0.1234567890123,
    net_return: rows.at(-1).net_return - 0.000061728394,
  });

  for (const sessions of [1, 3, 7, 14]) {
    const actual = rollingStandaloneWindowReturns(rows, sessions);
    const expected = Array.from({ length: rows.length - sessions + 1 }, (_, start) => {
      const standalone = rebaseRowsForStandalonePeriod(rows.slice(start, start + sessions), {
        cashSymbol: "BIL",
        oneWayCostBps: 5,
      });
      return standalone.reduce((wealth, item) => wealth * (1 + item.net_return), 1) - 1;
    });
    assert.deepEqual(actual, expected);
  }
});

test("four-regime labels use only observations before the scored return", () => {
  const candidate = Array.from({ length: 253 }, (_, index) => row(isoDate(index), 0.001, {
    spyReturn: 0.0005,
    bilReturn: 0.00001,
  }));
  const spy = Array.from({ length: 253 }, (_, index) => row(isoDate(index), 0.0005, {
    spyReturn: 0.0005,
    bilReturn: 0.00001,
  }));
  const baseline = causalFourRegimeEvidence(candidate, spy);
  const mutated = [...spy];
  mutated[252] = row(isoDate(252), -0.50, { spyReturn: -0.50, bilReturn: 0.00001 });
  const afterCurrentReturnMutation = causalFourRegimeEvidence(candidate, mutated);
  assert.equal(baseline.regimes.up_low_vol.observations, 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(baseline.regimes).map(([id, value]) => [id, value.observations])),
    Object.fromEntries(Object.entries(afterCurrentReturnMutation.regimes).map(([id, value]) => [id, value.observations])),
  );
  assert.match(baseline.causality, /excluded/);
});

test("concentration statistics report conditional HHI and direct ETF weights without look-through claims", () => {
  const rows = [
    row("2025-01-02", 0, { weights: { QQQ: 0.5, XLK: 0.5, SPY: 0, BIL: 0 } }),
    row("2025-01-03", 0, { weights: { QQQ: 1, XLK: 0, SPY: 0, BIL: 0 } }),
  ];
  const result = concentrationStatistics(rows);
  assert.equal(result.maximum_single_risky_position.average, 0.75);
  assert.equal(result.conditional_risky_weight_hhi.average, 0.75);
  assert.equal(result.conditional_effective_risky_positions.average, 1.5);
  assert.equal(result.direct_qqq_plus_xlk_average_weight, 1);
  assert.match(result.boundary, /not a technology look-through/);
});

test("the recurring-contribution hook compares equal $300 schedules and returns compact evidence", () => {
  const dates = Array.from({ length: 15 }, (_, index) => `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-02`);
  const candidate = dates.map((date) => row(date, 0.01));
  const spy = dates.map((date) => row(date, 0.005));
  const result = buildRecurringContributionEvidence(
    { candidate, spy_buy_hold: spy },
    "candidate",
    ["spy_buy_hold"],
    { horizonsMonths: [3], monthlyContribution: 300, oneWayCostBps: 5, minimumStartDate: "2024-01-01" },
  );
  const comparison = result.comparisons.spy_buy_hold;
  assert.equal(comparison.horizons["3"].summary.windows, 13);
  assert.equal(comparison.horizons["3"].latest_window.total_contributions, 900);
  assert.equal(comparison.horizons["3"].summary.candidate_beat_benchmark_fraction, 1);
  assert.equal("windows" in comparison.horizons["3"], false);
  assert.match(result.purpose, /not an options-P&L/);
});

test("the runner contains no market-fetch import and exposes only deterministic verify-existing overwrite behavior", async () => {
  const source = await readFile(new URL("../research/run_quant_champion_generation6.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetchYahooAdjustedSeries|fetch\s*\(/);
  assert.match(source, /--verify-existing/);
  assert.match(source, /differs from deterministic recomputation/);
  assert.match(source, /do not overwrite/);
  assert.doesNotMatch(source, /\brename\s*\(/);
  assert.match(source, /link\(staged, path\)/);
  assert.equal(GENERATION6_RUN_CLAIM_RELATIVE_PATH,
    "research/champion_generation6_run_claim.json");
});

test("exclusive hard-link publication is concurrent-safe and never replaces different bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finly-g6-write-once-"));
  try {
    const path = join(directory, "artifact.json");
    const payload = Buffer.from("same immutable bytes\n");
    const statuses = await Promise.all([
      writeOnceOrVerify(path, payload, "synthetic artifact"),
      writeOnceOrVerify(path, payload, "synthetic artifact"),
    ]);
    assert.deepEqual([...statuses].sort(), ["created", "verified_existing"]);
    assert.deepEqual(await readFile(path), payload);
    await assert.rejects(
      writeOnceOrVerify(path, Buffer.from("different bytes\n"), "synthetic artifact"),
      /already exists with different bytes/,
    );
    assert.deepEqual(await readFile(path), payload);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exclusive run lock rejects concurrency and releases after the owner completes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finly-g6-lock-"));
  try {
    const lockPath = join(directory, "run.lock");
    let releaseOwner;
    let ownerEntered;
    const entered = new Promise((resolve) => { ownerEntered = resolve; });
    const release = new Promise((resolve) => { releaseOwner = resolve; });
    const owner = withExclusiveDirectoryLock(lockPath, async () => {
      const metadata = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"));
      assert.equal(metadata.schema_version, "finly_exclusive_directory_lock_owner.v1");
      assert.equal(metadata.pid, process.pid);
      assert.match(metadata.token, /^[0-9a-f-]{36}$/);
      assert.match(metadata.started_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(metadata.recovery_instruction, /Do not delete/);
      ownerEntered();
      await release;
      return "owner-complete";
    });
    await entered;
    await assert.rejects(
      withExclusiveDirectoryLock(lockPath, async () => "unexpected"),
      /run lock already exists/,
    );
    releaseOwner();
    assert.equal(await owner, "owner-complete");
    assert.equal(await withExclusiveDirectoryLock(lockPath, async () => "reacquired"),
      "reacquired");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
