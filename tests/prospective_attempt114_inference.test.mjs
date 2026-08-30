import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../lib/canonical.mjs";
import {
  ATTEMPT114_DECOMPOSITION_SCHEMA,
  buildAttempt114VolatilityMatchedDecomposition,
  buildAttempt114VolatilityMatchedDecompositionFromSettlements,
  validateAttempt114VolatilityMatchedDecomposition,
} from "../research/prospective_attempt114/decomposition.mjs";
import {
  ATTEMPT114_ADJUSTED_RETURN_ROW_SCHEMA,
  ATTEMPT114_ADJUSTED_SETTLEMENT_SCHEMA,
  ATTEMPT114_FINALIZATION_GATE_SCHEMA,
  ATTEMPT114_PRIMARY_INFERENCE_SCHEMA,
  buildAttempt114PrimaryInference,
  buildAttempt114PrimaryInferenceFromSettlements,
  hashAttempt114AdjustedReturnRows,
  projectAttempt114AdjustedTheoreticalSettlements,
  validateAttempt114AdjustedReturnRows,
  validateAttempt114FinalizationGate,
  validateAttempt114PrimaryInference,
} from "../research/prospective_attempt114/inference.mjs";
import {
  ATTEMPT114_PROTOCOL_ID,
  ATTEMPT114_PROTOCOL_SHA256,
} from "../research/prospective_attempt114/protocol.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BOOK_IDS = ["incumbent_tsmom_ensemble_vol", "spy_buy_hold", "bil_cash"];

function digest(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function nextWeekday(value) {
  const next = new Date(`${value}T00:00:00.000Z`);
  do next.setUTCDate(next.getUTCDate() + 1); while ([0, 6].includes(next.getUTCDay()));
  return next.toISOString().slice(0, 10);
}

function rowsFixture({ constantCandidate = null, constantSpy = null } = {}) {
  const rows = [];
  let start = "2026-09-01";
  for (let index = 0; index < 252; index += 1) {
    const end = nextWeekday(start);
    const candidate = constantCandidate ?? (
      0.00045 + Math.sin(index * 0.37) * 0.007 + Math.cos(index * 0.11) * 0.0015
    );
    const spy = constantSpy ?? (
      0.0002 + Math.sin(index * 0.29) * 0.0085 + Math.cos(index * 0.07) * 0.001
    );
    rows.push({
      schema_version: ATTEMPT114_ADJUSTED_RETURN_ROW_SCHEMA,
      settlement_sequence: index + 1,
      signal_commitment_sequence: index + 1,
      execution_close_commitment_sequence: index + 2,
      outcome_close_commitment_sequence: index + 3,
      return_start_session: start,
      return_end_session: end,
      books: {
        incumbent_tsmom_ensemble_vol: { net_simple_return: candidate },
        spy_buy_hold: { net_simple_return: spy },
        bil_cash: { net_simple_return: 0.00008 },
      },
    });
    start = end;
  }
  return rows;
}

function primaryGoldenRows(intercept = 0.00025) {
  const rows = rowsFixture();
  rows.forEach((row, index) => {
    row.books.incumbent_tsmom_ensemble_vol.net_simple_return = Math.expm1(
      intercept + 0.0012 * Math.sin(index / 7) + 0.0005 * Math.cos(index / 19),
    );
    row.books.spy_buy_hold.net_simple_return = 0;
    row.books.bil_cash.net_simple_return = 0;
  });
  return rows;
}

function decompositionRowsFixture() {
  const rows = rowsFixture();
  rows.forEach((row, index) => {
    const bil = 0.00004 + 0.00001 * Math.cos(index / 31);
    const spy = bil + 0.00025 + 0.006 * Math.sin(index / 9) + 0.003 * Math.cos(index / 23);
    const incumbent = bil + 0.58 * (spy - bil) + 0.00075
      + 0.0012 * Math.sin(index / 4.7) + 0.0007 * Math.cos(index / 17);
    row.books.incumbent_tsmom_ensemble_vol.net_simple_return = incumbent;
    row.books.spy_buy_hold.net_simple_return = spy;
    row.books.bil_cash.net_simple_return = bil;
  });
  return rows;
}

function adjustedSettlementsFixture(rows) {
  const equities = Object.fromEntries(BOOK_IDS.map((bookId) => [bookId, 100000]));
  return rows.map((row) => {
    const books = {};
    for (const bookId of BOOK_IDS) {
      const net = row.books[bookId].net_simple_return;
      const opening = equities[bookId];
      const closing = opening * (1 + net);
      books[bookId] = {
        book_id: bookId,
        committed_action: "HOLD",
        pretrade_weights: { SPY: 0, BIL: 1 },
        evaluation_weights: { SPY: 0, BIL: 1 },
        same_vintage_asset_gross_returns: { SPY: 1 + net, BIL: 1 + net },
        absolute_traded_leg_weights: { SPY: 0, BIL: 0 },
        absolute_traded_leg_cost_returns: { SPY: 0, BIL: 0 },
        turnover_notional: 0,
        modeled_cost_return: 0,
        opening_equity: opening,
        gross_simple_return: net,
        net_simple_return: net,
        closing_equity: closing,
        closing_weights: { SPY: 0, BIL: 1 },
      };
      equities[bookId] = closing;
    }
    const sequence = row.settlement_sequence;
    const body = {
      schema_version: ATTEMPT114_ADJUSTED_SETTLEMENT_SCHEMA,
      attempt_id: ATTEMPT114_PROTOCOL_ID,
      protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
      sequence,
      entry_kind: "ADJUSTED_THEORETICAL_SETTLEMENT",
      evidence_class: "PROSPECTIVE_ADJUSTED_THEORETICAL_ACCOUNTING",
      lineage: {
        signal_commitment_sequence: sequence,
        execution_close_commitment_sequence: sequence + 1,
        outcome_close_commitment_sequence: sequence + 2,
        signal_anchor_manifest_sha256: digest(`signal-${sequence}`),
        execution_anchor_manifest_sha256: digest(`execution-${sequence}`),
        outcome_anchor_manifest_sha256: digest(`outcome-${sequence}`),
        outcome_price_lineage_sha256: digest(`lineage-${sequence}`),
        signal_session_date: sequence === 1 ? "2026-08-31" : rows[sequence - 2].return_end_session,
        return_start_session_date: row.return_start_session,
        return_end_session_date: row.return_end_session,
      },
      books,
      authority: {
        research_only: true,
        broker_mutation_authorized: false,
        order_payload: null,
        persistence_authorized: false,
      },
    };
    return { ...body, settlement_sha256: sha256(body) };
  });
}

function gateFixture() {
  return {
    schema_version: ATTEMPT114_FINALIZATION_GATE_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    state: "FINALIZATION_DUE",
    verified_counts: {
      signal_commitments: 254,
      independent_pre_execution_anchor_receipts: 254,
      adjusted_theoretical_settlements: 252,
      alpaca_paper_cash_equity_entries: 252,
      joint_interval_bundles: 252,
      independently_reconciled_outcome_price_lineages: 252,
    },
    verification: {
      protocol_runtime_publication_verified_strictly_before_first_signal_close: true,
      consecutive_official_sessions_verified: true,
      n_n_plus_1_n_plus_2_links_verified: true,
      all_anchor_receipts_independently_verified: true,
      all_outcome_price_lineages_independently_reconciled: true,
      adjusted_theoretical_ledger_chain_verified: true,
      alpaca_paper_cash_equity_ledger_chain_verified: true,
      joint_interval_bundle_chain_verified: true,
      ledger_separation_verified: true,
      adjusted_theoretical_is_only_inference_source: true,
      paper_cash_equity_excluded_from_inference: true,
      session_60_checkpoint_engineering_only_verified: true,
      session_60_performance_fields_present: false,
      optional_stopping_used: false,
      replacement_window_used: false,
    },
    evidence_hashes: {
      runtime_manifest_sha256: digest("runtime"),
      protocol_runtime_publication_receipt_sha256: digest("publication"),
      anchor_receipt_chain_head_sha256: digest("anchors"),
      outcome_price_lineage_chain_head_sha256: digest("outcomes"),
      adjusted_theoretical_ledger_head_sha256: digest("adjusted"),
      alpaca_paper_cash_equity_ledger_head_sha256: digest("paper"),
      joint_interval_bundle_head_sha256: digest("bundles"),
      full_chain_reopen_receipt_sha256: digest("reopen"),
      session_60_checkpoint_receipt_sha256: digest("checkpoint"),
    },
    primary_inference_runs_before_this: 0,
    terminal_state_written: false,
    broker_mutation_authorized: false,
  };
}

function independentMulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function independentPrimary(rows) {
  const values = rows.map((row) => (
    Math.log1p(row.books.incumbent_tsmom_ensemble_vol.net_simple_return)
      - Math.log1p(row.books.spy_buy_hold.net_simple_return)
  ));
  const observedSum = values.reduce((sum, value) => sum + value, 0);
  const observedMean = observedSum / values.length;
  const centered = values.map((value) => value - observedMean);
  const random = independentMulberry32(20260829);
  let exceedances = 0;
  for (let draw = 0; draw < 4999; draw += 1) {
    let source = Math.floor(random() * centered.length);
    let sum = 0;
    for (let index = 0; index < centered.length; index += 1) {
      sum += centered[source];
      source = random() < 0.05
        ? Math.floor(random() * centered.length)
        : (source + 1) % centered.length;
    }
    if (sum / centered.length >= observedMean) exceedances += 1;
  }
  return {
    observedSum,
    observedMean,
    exceedances,
    pValue: (1 + exceedances) / 5000,
  };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

test("primary inference exactly reproduces the frozen null-centered stationary bootstrap", () => {
  const rows = primaryGoldenRows();
  const gate = gateFixture();
  const expected = independentPrimary(rows);
  const first = buildAttempt114PrimaryInference({
    adjusted_theoretical_return_rows: rows,
    finalization_gate: gate,
  });
  const second = buildAttempt114PrimaryInference({
    adjusted_theoretical_return_rows: structuredClone(rows),
    finalization_gate: structuredClone(gate),
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema_version, ATTEMPT114_PRIMARY_INFERENCE_SCHEMA);
  assert.equal(first.protocol_sha256, ATTEMPT114_PROTOCOL_SHA256);
  assert.equal(first.sample.intervals, 252);
  assert.equal(first.sample.adjusted_theoretical_return_rows_sha256,
    hashAttempt114AdjustedReturnRows(rows));
  assert.equal(first.observed.sum_net_log_return_difference, expected.observedSum);
  assert.equal(first.observed.mean_daily_net_log_return_difference, expected.observedMean);
  assert.deepEqual(first.bootstrap, {
    test: "one-sided null-centered stationary block bootstrap",
    null_centered: true,
    centering_formula: "daily_value - observed_mean",
    prng: "mulberry32_uint32",
    circular_blocks: true,
    seed_uint32: 20260829,
    resamples: 4999,
    expected_block_sessions: 20,
    restart_probability: 0.05,
    restart_draw_consumed_after_final_observation: true,
    restart_index_draw_consumed_when_triggered_after_final_observation: true,
    equality_counts_as_exceedance: true,
    exceedances: expected.exceedances,
    one_sided_p_value: expected.pValue,
  });
  assert.equal(first.observed.mean_daily_net_log_return_difference, 0.00031431508534423424);
  assert.equal(first.bootstrap.exceedances, 174);
  assert.equal(first.bootstrap.one_sided_p_value, 0.035);
  assert.equal(first.decision.supports_positive_net_log_return_edge,
    expected.pValue <= 0.05);
  assert.equal(first.assurance.adjusted_theoretical_is_only_inference_source, true);
  assert.equal(first.assurance.alpaca_paper_cash_equity_excluded, true);
  assert.equal(first.assurance.broker_mutation_authorized, false);
  assert.equal(validateAttempt114PrimaryInference(first), first);
  assertDeepFrozen(first);
});

test("alpha equality is support only for a strictly positive observed edge", () => {
  const result = buildAttempt114PrimaryInference({
    adjusted_theoretical_return_rows: primaryGoldenRows(0.000218),
    finalization_gate: gateFixture(),
  });
  assert.equal(result.observed.mean_daily_net_log_return_difference, 0.0002823150853442339);
  assert.equal(result.bootstrap.exceedances, 249);
  assert.equal(result.bootstrap.one_sided_p_value, 0.05);
  assert.equal(result.decision.rejection_rule,
    "observed_mean > 0 and one_sided_p_value <= alpha");
  assert.equal(result.decision.supports_positive_net_log_return_edge, true);
});

test("equality counts as an exceedance and a constant positive edge reaches add-one resolution", () => {
  const gate = gateFixture();
  const zero = buildAttempt114PrimaryInference({
    adjusted_theoretical_return_rows: rowsFixture({ constantCandidate: 0.001, constantSpy: 0.001 }),
    finalization_gate: gate,
  });
  assert.equal(zero.observed.mean_daily_net_log_return_difference, 0);
  assert.equal(zero.bootstrap.exceedances, 4999);
  assert.equal(zero.bootstrap.one_sided_p_value, 1);
  assert.equal(zero.decision.supports_positive_net_log_return_edge, false);

  const positive = buildAttempt114PrimaryInference({
    adjusted_theoretical_return_rows: rowsFixture({ constantCandidate: 0.002, constantSpy: 0 }),
    finalization_gate: gate,
  });
  assert.ok(positive.observed.mean_daily_net_log_return_difference > 0);
  assert.equal(positive.bootstrap.exceedances, 0);
  assert.equal(positive.bootstrap.one_sided_p_value, 0.0002);
  assert.equal(positive.decision.supports_positive_net_log_return_edge, true);
  assert.equal(positive.decision.conclusion,
    "PRIMARY_SUPPORTS_POSITIVE_NET_LOG_RETURN_EDGE_ON_FROZEN_WINDOW");
});

test("adjusted-return rows fail closed on sample, timing, schema, and return corruption", () => {
  const rows = rowsFixture();
  assert.equal(validateAttempt114AdjustedReturnRows(rows).length, 252);
  assert.throws(() => validateAttempt114AdjustedReturnRows(rows.slice(0, 251)), /exactly the first 252/);
  assert.throws(() => validateAttempt114AdjustedReturnRows([...rows, structuredClone(rows.at(-1))]),
    /exactly the first 252/);
  const mutations = [
    (value) => { value[0].extra = true; },
    (value) => { value[0].schema_version = "wrong"; },
    (value) => { value[7].settlement_sequence = 9; },
    (value) => { value[8].execution_close_commitment_sequence += 1; },
    (value) => { value[9].return_start_session = "2026-01-01"; },
    (value) => { value[10].return_end_session = value[10].return_start_session; },
    (value) => { value[11].books.spy_buy_hold.net_simple_return = -1; },
    (value) => { value[12].books.bil_cash.net_simple_return = Number.NaN; },
    (value) => { value[13].books.paper_cash_equity = { net_simple_return: 1 }; },
    (value) => { value[14].books.spy_buy_hold.raw_broker_price = 500; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(rows);
    mutate(copy);
    assert.throws(() => validateAttempt114AdjustedReturnRows(copy), TypeError);
  }
});

test("finalization gate rejects every route to early, repeat, optional, or contaminated inference", () => {
  const gate = gateFixture();
  assert.deepEqual(validateAttempt114FinalizationGate(gate), gate);
  const mutations = [
    (value) => { value.extra = true; },
    (value) => { value.state = "CAPTURING_OBSERVATION_ONLY"; },
    (value) => { value.verified_counts.signal_commitments = 253; },
    (value) => { value.verified_counts.adjusted_theoretical_settlements = 251; },
    (value) => { value.verified_counts.alpaca_paper_cash_equity_entries = 251; },
    (value) => { value.verification.all_anchor_receipts_independently_verified = false; },
    (value) => { value.verification.all_outcome_price_lineages_independently_reconciled = false; },
    (value) => { value.verification.ledger_separation_verified = false; },
    (value) => { value.verification.paper_cash_equity_excluded_from_inference = false; },
    (value) => { value.verification.session_60_performance_fields_present = true; },
    (value) => { value.verification.optional_stopping_used = true; },
    (value) => { value.primary_inference_runs_before_this = 1; },
    (value) => { value.terminal_state_written = true; },
    (value) => { value.broker_mutation_authorized = true; },
    (value) => { value.evidence_hashes.anchor_receipt_chain_head_sha256 = "bad"; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(gate);
    mutate(copy);
    assert.throws(() => validateAttempt114FinalizationGate(copy), TypeError);
  }
});

test("descriptive wrapper freezes exact IDs, causal warmup, costs, and net-log bridge", () => {
  const rows = decompositionRowsFixture();
  const gate = gateFixture();
  const first = buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows: rows,
    finalization_gate: gate,
  });
  const second = buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows: structuredClone(rows),
    finalization_gate: structuredClone(gate),
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema_version, ATTEMPT114_DECOMPOSITION_SCHEMA);
  assert.equal(first.role, "DESCRIPTIVE_CAUSAL_DECOMPOSITION_NOT_PRIMARY");
  assert.equal(first.source.emitted_role, "primary_risk_matched_gate");
  assert.equal(first.source.emitted_role_adopted_by_attempt_114, false);
  assert.deepEqual(first.ids, {
    candidate_id: "incumbent_tsmom_ensemble_vol",
    spy_id: "spy_buy_hold",
    cash_id: "bil_cash",
    comparator_id: "volatility_matched_spy_incumbent_tsmom_ensemble_vol",
  });
  assert.equal(first.specification.lookback_sessions, 63);
  assert.equal(first.specification.rebalance_interval_sessions, 21);
  assert.equal(first.specification.rebalance_anchor, 0);
  assert.equal(first.specification.minimum_spy_weight, 0);
  assert.equal(first.specification.maximum_spy_weight, 1.5);
  assert.equal(first.specification.one_way_cost_bps_per_absolute_traded_notional, 5);
  assert.equal(first.specification.annual_borrow_spread, 0.005);
  assert.equal(first.specification.terminal_liquidation, false);
  assert.equal(first.sample.warmup_intervals, 63);
  assert.equal(first.sample.scoring_start_interval, 64);
  assert.equal(first.sample.scored_intervals, 189);
  assert.deepEqual(first.rows
    .filter((row) => row.volatility_match.rebalanced)
    .map((row) => row.settlement_sequence), [64, 85, 106, 127, 148, 169, 190, 211, 232]);
  assert.equal(first.rows[63].volatility_match.target_spy_weight, 0.696948010272);
  assert.equal(first.rows[63].comparator_accounting.turnover_notional, 1.393896020545);
  assert.equal(first.rows[63].comparator_accounting.transaction_cost, 0.00069694801);
  assert.equal(first.rows.every((row) => row.comparator_accounting.terminal_liquidation === false), true);

  const sums = first.net_log_return_sums;
  assert.ok(Math.abs(sums.full_finly_minus_spy - 0.16950593448315648) <= 1e-15);
  assert.ok(Math.abs(sums.warmup_finly_minus_spy - 0.019488741858012585) <= 1e-15);
  assert.ok(Math.abs(sums.scored_finly_minus_volatility_matched - 0.16773608643779211) <= 1e-15);
  assert.ok(Math.abs(sums.scored_volatility_matched_minus_spy - (-0.017718893812648316)) <= 1e-15);
  const bridge = sums.warmup_finly_minus_spy
    + sums.scored_finly_minus_volatility_matched
    + sums.scored_volatility_matched_minus_spy;
  assert.equal(first.identity.bridge_sum, bridge);
  assert.equal(first.identity.absolute_error, Math.abs(sums.full_finly_minus_spy - bridge));
  assert.ok(first.identity.absolute_error <= 1e-12);
  assert.equal(first.identity.reconciles, true);
  assert.deepEqual(first.claim_boundary, {
    p_value: null,
    p_value_permitted: false,
    can_replace_primary_comparator: false,
    source_emitted_role_adopted: false,
    result_changes_incumbent_policy: false,
    broker_mutation_authorized: false,
  });
  assert.equal(first.assurance.alpaca_paper_cash_equity_excluded, true);
  assert.equal(validateAttempt114VolatilityMatchedDecomposition(first), first);
  assertDeepFrozen(first);
});

test("strict settlement adapters consume only adjusted-theoretical settlements", () => {
  const rows = decompositionRowsFixture();
  const settlements = adjustedSettlementsFixture(rows);
  const projected = projectAttempt114AdjustedTheoreticalSettlements(settlements);
  assert.deepEqual(projected, validateAttempt114AdjustedReturnRows(rows));

  const directPrimary = buildAttempt114PrimaryInference({
    adjusted_theoretical_return_rows: rows,
    finalization_gate: gateFixture(),
  });
  const settlementPrimary = buildAttempt114PrimaryInferenceFromSettlements({
    adjusted_theoretical_settlements: settlements,
    finalization_gate: gateFixture(),
  });
  assert.deepEqual(settlementPrimary, directPrimary);

  const directDecomposition = buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows: rows,
    finalization_gate: gateFixture(),
  });
  const settlementDecomposition = buildAttempt114VolatilityMatchedDecompositionFromSettlements({
    adjusted_theoretical_settlements: settlements,
    finalization_gate: gateFixture(),
  });
  assert.deepEqual(settlementDecomposition, directDecomposition);

  const changedHash = structuredClone(settlements);
  changedHash[0].books.spy_buy_hold.net_simple_return += 0.01;
  assert.throws(() => projectAttempt114AdjustedTheoreticalSettlements(changedHash), /arithmetic|self-hash/);
  const paperContaminated = structuredClone(settlements);
  paperContaminated[0].books.spy_buy_hold.raw_broker_price = 500;
  assert.throws(() => projectAttempt114AdjustedTheoreticalSettlements(paperContaminated), /must contain exactly/);
  assert.throws(() => buildAttempt114PrimaryInferenceFromSettlements({
    adjusted_theoretical_settlements: settlements,
    alpaca_paper_cash_equity_entries: [],
    finalization_gate: gateFixture(),
  }), /must contain exactly/);
});

test("volatility matching is lagged, clipped, financing-aware, and trades from drifted weights", () => {
  const baselineRows = decompositionRowsFixture();
  const shockedRows = structuredClone(baselineRows);
  shockedRows[63].books.incumbent_tsmom_ensemble_vol.net_simple_return += 0.2;
  const baseline = buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows: baselineRows,
    finalization_gate: gateFixture(),
  });
  const shocked = buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows: shockedRows,
    finalization_gate: gateFixture(),
  });
  assert.equal(shocked.rows[63].volatility_match.target_spy_weight,
    baseline.rows[63].volatility_match.target_spy_weight);
  assert.equal(
    shocked.rows[63].net_returns.volatility_matched_spy_incumbent_tsmom_ensemble_vol,
    baseline.rows[63].net_returns.volatility_matched_spy_incumbent_tsmom_ensemble_vol,
  );
  assert.notEqual(shocked.rows[84].volatility_match.target_spy_weight,
    baseline.rows[84].volatility_match.target_spy_weight);

  const before = baseline.rows[83];
  const nextRebalance = baseline.rows[84];
  const pretradeSpy = before.comparator_accounting.start_spy_weight
    * (1 + before.net_returns.spy_buy_hold)
    / (1 + before.comparator_accounting.gross_return);
  const pretradeCash = before.comparator_accounting.start_cash_weight
    * (1 + before.net_returns.bil_cash)
    / (1 + before.comparator_accounting.gross_return);
  const expectedTurnover = Math.abs(nextRebalance.comparator_accounting.start_spy_weight - pretradeSpy)
    + Math.abs(nextRebalance.comparator_accounting.start_cash_weight - pretradeCash);
  assert.ok(Math.abs(nextRebalance.comparator_accounting.turnover_notional - expectedTurnover) <= 2e-12);

  const zeroDenominatorRows = rowsFixture();
  zeroDenominatorRows.forEach((row, index) => {
    const cash = 0.00005;
    row.books.bil_cash.net_simple_return = cash;
    row.books.spy_buy_hold.net_simple_return = cash;
    row.books.incumbent_tsmom_ensemble_vol.net_simple_return = cash + 0.01 * Math.sin(index / 3);
  });
  const zeroDenominator = buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows: zeroDenominatorRows,
    finalization_gate: gateFixture(),
  });
  assert.equal(zeroDenominator.rows
    .filter((row) => row.volatility_match.rebalanced)
    .every((row) => row.volatility_match.target_spy_weight === 0), true);

  const leveragedRows = rowsFixture();
  leveragedRows.forEach((row, index) => {
    const cash = 0.00004;
    row.books.bil_cash.net_simple_return = cash;
    row.books.spy_buy_hold.net_simple_return = cash + 0.0001 * Math.sin(index / 5);
    row.books.incumbent_tsmom_ensemble_vol.net_simple_return = cash + 0.02 * Math.sin(index / 5);
  });
  const leveraged = buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows: leveragedRows,
    finalization_gate: gateFixture(),
  });
  const firstLeveraged = leveraged.rows[63];
  assert.equal(firstLeveraged.volatility_match.target_spy_weight, 1.5);
  assert.equal(firstLeveraged.comparator_accounting.start_cash_weight, -0.5);
  assert.equal(firstLeveraged.comparator_accounting.financing_spread_cost,
    Number((0.5 * 0.005 / 252).toFixed(12)));
});

test("inference and decomposition reject paper/raw values and incomplete gates before calculation", () => {
  const rows = rowsFixture();
  const paperContaminated = structuredClone(rows);
  paperContaminated[0].books.spy_buy_hold.raw_broker_price = 500;
  const incompleteGate = gateFixture();
  incompleteGate.verification.adjusted_theoretical_is_only_inference_source = false;
  for (const build of [buildAttempt114PrimaryInference, buildAttempt114VolatilityMatchedDecomposition]) {
    assert.throws(() => build({
      adjusted_theoretical_return_rows: paperContaminated,
      finalization_gate: gateFixture(),
    }), TypeError);
    assert.throws(() => build({
      adjusted_theoretical_return_rows: rows,
      finalization_gate: incompleteGate,
    }), TypeError);
    assert.throws(() => build({
      adjusted_theoretical_return_rows: rows.slice(0, 60),
      finalization_gate: gateFixture(),
    }), /exactly the first 252/);
  }
});

test("result validators reject independently re-hashed semantic and descriptive forgeries", () => {
  const primary = buildAttempt114PrimaryInference({
    adjusted_theoretical_return_rows: primaryGoldenRows(),
    finalization_gate: gateFixture(),
  });
  const primaryMutations = [
    (value) => { value.endpoint = "mean simple return"; },
    (value) => { value.bootstrap.prng = "different"; },
    (value) => { value.bootstrap.one_sided_p_value = 0; },
    (value) => { value.decision.supports_positive_net_log_return_edge = false; },
    (value) => { value.assurance.alpaca_paper_cash_equity_excluded = false; },
    (value) => { value.sample.extra = true; },
  ];
  for (const mutate of primaryMutations) {
    const copy = structuredClone(primary);
    mutate(copy);
    delete copy.result_sha256;
    copy.result_sha256 = sha256(copy);
    assert.throws(() => validateAttempt114PrimaryInference(copy), TypeError);
  }

  const decomposition = buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows: decompositionRowsFixture(),
    finalization_gate: gateFixture(),
  });
  const decompositionMutations = [
    (value) => { value.role = "primary_risk_matched_gate"; },
    (value) => { value.source.emitted_role_adopted_by_attempt_114 = true; },
    (value) => { value.claim_boundary.p_value = 0.01; },
    (value) => { value.claim_boundary.can_replace_primary_comparator = true; },
    (value) => { value.rows[63].net_returns.volatility_matched_spy_incumbent_tsmom_ensemble_vol += 0.01; },
    (value) => { value.rows[63].comparator_accounting.terminal_liquidation = true; },
  ];
  for (const mutate of decompositionMutations) {
    const copy = structuredClone(decomposition);
    mutate(copy);
    delete copy.decomposition_sha256;
    copy.decomposition_sha256 = sha256(copy);
    assert.throws(() => validateAttempt114VolatilityMatchedDecomposition(copy), TypeError);
  }
});

test("pure modules expose no market, broker, network, persistence, or mutation call surface", async () => {
  for (const relativePath of [
    "research/prospective_attempt114/inference.mjs",
    "research/prospective_attempt114/decomposition.mjs",
  ]) {
    const source = await readFile(`${PROJECT_ROOT}/${relativePath}`, "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /https?:\/\//);
    assert.doesNotMatch(source, /\b(?:readFile|writeFile|appendFile|open|rename|link|symlink|mkdir|rm)\s*\(/);
    assert.doesNotMatch(source, /\b(?:submit|place|cancel|replace)(?:Order)?\s*\(/i);
    assert.doesNotMatch(source, /(?:APCA_API|ALPACA_API|process\.env)/);
  }
  assert.deepEqual(BOOK_IDS, ["incumbent_tsmom_ensemble_vol", "spy_buy_hold", "bil_cash"]);
});
