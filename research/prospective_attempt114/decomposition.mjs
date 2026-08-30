import { sha256, stableStringify } from "../../lib/canonical.mjs";
import { buildCausalVolatilityMatchedSpyComparator } from "../champion_generation6_robustness.mjs";
import {
  ATTEMPT114_PROTOCOL,
  ATTEMPT114_PROTOCOL_ID,
  ATTEMPT114_PROTOCOL_SHA256,
} from "./protocol.mjs";
import {
  projectAttempt114AdjustedTheoreticalSettlements,
  validateAttempt114AdjustedReturnRows,
  validateAttempt114FinalizationGate,
} from "./inference.mjs";

export const ATTEMPT114_DECOMPOSITION_SCHEMA =
  "finly_attempt114_descriptive_volatility_matched_spy_bil_decomposition.v1";

const SPECIFICATION = ATTEMPT114_PROTOCOL.volatility_matched_spy_bil_decomposition;

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value;
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function close(actual, expected, tolerance = 5e-12) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function decompositionBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "decomposition_sha256"));
}

export function buildAttempt114VolatilityMatchedDecomposition(input) {
  exact(input, ["adjusted_theoretical_return_rows", "finalization_gate"], "Attempt 114 decomposition input");
  const rows = validateAttempt114AdjustedReturnRows(input.adjusted_theoretical_return_rows);
  const gate = validateAttempt114FinalizationGate(input.finalization_gate);
  const pairedRows = rows.map((row) => ({
    execution_return_date: row.return_end_session,
    strategies: {
      [SPECIFICATION.candidate_id]: {
        net_return: row.books[SPECIFICATION.candidate_id].net_simple_return,
      },
      [SPECIFICATION.spy_id]: {
        net_return: row.books[SPECIFICATION.spy_id].net_simple_return,
      },
      [SPECIFICATION.cash_id]: {
        net_return: row.books[SPECIFICATION.cash_id].net_simple_return,
      },
    },
  }));
  const source = buildCausalVolatilityMatchedSpyComparator(pairedRows, {
    candidateId: SPECIFICATION.candidate_id,
    spyId: SPECIFICATION.spy_id,
    cashId: SPECIFICATION.cash_id,
    comparatorId: SPECIFICATION.comparator_id,
    lookbackSessions: SPECIFICATION.lookback_sessions,
    rebalanceIntervalSessions: SPECIFICATION.rebalance_interval_sessions,
    rebalanceAnchor: SPECIFICATION.rebalance_anchor,
    minimumSpyWeight: SPECIFICATION.minimum_spy_weight,
    maximumSpyWeight: SPECIFICATION.maximum_spy_weight,
    oneWayCostBps: SPECIFICATION.one_way_cost_bps_per_absolute_traded_notional,
    annualBorrowSpread: SPECIFICATION.annual_borrow_spread,
    terminalLiquidation: SPECIFICATION.terminal_liquidation,
  });
  if (source.role !== SPECIFICATION.source_emitted_role
    || source.candidate_id !== SPECIFICATION.candidate_id
    || source.spy_id !== SPECIFICATION.spy_id
    || source.cash_id !== SPECIFICATION.cash_id
    || source.comparator_id !== SPECIFICATION.comparator_id
    || source.observations !== 252
    || stableStringify(source.specification) !== stableStringify({
      estimator: "prior-window candidate-minus-BIL sample volatility divided by prior-window SPY-minus-BIL sample volatility",
      annualization_sessions: 252,
      lookback_sessions: SPECIFICATION.lookback_sessions,
      rebalance_interval_sessions: SPECIFICATION.rebalance_interval_sessions,
      rebalance_anchor: SPECIFICATION.rebalance_anchor,
      minimum_spy_weight: SPECIFICATION.minimum_spy_weight,
      maximum_spy_weight: SPECIFICATION.maximum_spy_weight,
      residual_asset: SPECIFICATION.cash_id,
      one_way_cost_bps_per_absolute_traded_notional:
        SPECIFICATION.one_way_cost_bps_per_absolute_traded_notional,
      annual_borrow_spread: SPECIFICATION.annual_borrow_spread,
      terminal_liquidation: SPECIFICATION.terminal_liquidation,
    })) {
    fail("Attempt 114 bound volatility-matched source changed its frozen output contract");
  }
  const firstRebalanceIndex = source.rows.findIndex((row) => row.volatility_match.rebalanced);
  if (firstRebalanceIndex !== SPECIFICATION.warmup_intervals) {
    fail("Attempt 114 volatility-matched comparator changes its frozen warmup boundary");
  }

  const outputRows = source.rows.map((sourceRow, index) => {
    const inputRow = rows[index];
    const comparator = sourceRow.strategies[SPECIFICATION.comparator_id];
    return {
      settlement_sequence: inputRow.settlement_sequence,
      return_start_session: inputRow.return_start_session,
      return_end_session: inputRow.return_end_session,
      net_returns: {
        [SPECIFICATION.candidate_id]: sourceRow.strategies[SPECIFICATION.candidate_id].net_return,
        [SPECIFICATION.spy_id]: sourceRow.strategies[SPECIFICATION.spy_id].net_return,
        [SPECIFICATION.cash_id]: sourceRow.strategies[SPECIFICATION.cash_id].net_return,
        [SPECIFICATION.comparator_id]: comparator.net_return,
      },
      comparator_accounting: {
        gross_return: comparator.gross_return,
        transaction_cost: comparator.transaction_cost,
        financing_spread_cost: comparator.financing_spread_cost,
        turnover_notional: comparator.turnover_notional,
        start_spy_weight: comparator.start_spy_weight,
        start_cash_weight: comparator.start_cash_weight,
        terminal_liquidation: comparator.terminal_liquidation ?? false,
      },
      volatility_match: structuredClone(sourceRow.volatility_match),
    };
  });
  const candidateId = SPECIFICATION.candidate_id;
  const spyId = SPECIFICATION.spy_id;
  const comparatorId = SPECIFICATION.comparator_id;
  const logDifference = (row, leftId, rightId) => (
    Math.log1p(row.net_returns[leftId]) - Math.log1p(row.net_returns[rightId])
  );
  const fullFinlyMinusSpy = outputRows.reduce(
    (sum, row) => sum + logDifference(row, candidateId, spyId),
    0,
  );
  const warmupRows = outputRows.slice(0, SPECIFICATION.warmup_intervals);
  const scoredRows = outputRows.slice(SPECIFICATION.warmup_intervals);
  const warmupFinlyMinusSpy = warmupRows.reduce(
    (sum, row) => sum + logDifference(row, candidateId, spyId),
    0,
  );
  const scoredFinlyMinusVolatilityMatched = scoredRows.reduce(
    (sum, row) => sum + logDifference(row, candidateId, comparatorId),
    0,
  );
  const scoredVolatilityMatchedMinusSpy = scoredRows.reduce(
    (sum, row) => sum + logDifference(row, comparatorId, spyId),
    0,
  );
  const bridgeSum = warmupFinlyMinusSpy
    + scoredFinlyMinusVolatilityMatched
    + scoredVolatilityMatchedMinusSpy;
  const identityError = fullFinlyMinusSpy - bridgeSum;
  if (Math.abs(identityError) > SPECIFICATION.maximum_absolute_identity_error) {
    fail("Attempt 114 volatility-matched net-log decomposition identity does not reconcile");
  }

  const body = {
    schema_version: ATTEMPT114_DECOMPOSITION_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    evidence_class: "DESCRIPTIVE_CAUSAL_DECOMPOSITION_CONDITIONAL_ON_BOUND_FINALIZATION_GATE",
    role: SPECIFICATION.future_descriptive_wrapper_output_role,
    source: {
      implementation: SPECIFICATION.implementation,
      path: SPECIFICATION.source_path,
      raw_bytes_sha256: SPECIFICATION.source_raw_bytes_sha256,
      emitted_role: source.role,
      emitted_role_adopted_by_attempt_114: false,
    },
    ids: {
      candidate_id: candidateId,
      spy_id: spyId,
      cash_id: SPECIFICATION.cash_id,
      comparator_id: comparatorId,
    },
    specification: {
      input_return_field: SPECIFICATION.input_return_field,
      input_returns_include_frozen_book_costs: true,
      lookback_sessions: SPECIFICATION.lookback_sessions,
      rebalance_interval_sessions: SPECIFICATION.rebalance_interval_sessions,
      rebalance_anchor: SPECIFICATION.rebalance_anchor,
      minimum_spy_weight: SPECIFICATION.minimum_spy_weight,
      maximum_spy_weight: SPECIFICATION.maximum_spy_weight,
      residual_asset: SPECIFICATION.residual_asset,
      one_way_cost_bps_per_absolute_traded_notional:
        SPECIFICATION.one_way_cost_bps_per_absolute_traded_notional,
      annual_borrow_spread: SPECIFICATION.annual_borrow_spread,
      terminal_liquidation: SPECIFICATION.terminal_liquidation,
    },
    sample: {
      intervals: outputRows.length,
      warmup_intervals: warmupRows.length,
      scoring_start_interval: SPECIFICATION.scoring_start_interval,
      scored_intervals: scoredRows.length,
      adjusted_theoretical_return_rows_sha256: sha256(rows),
    },
    net_log_return_sums: {
      full_finly_minus_spy: fullFinlyMinusSpy,
      warmup_finly_minus_spy: warmupFinlyMinusSpy,
      scored_finly_minus_volatility_matched: scoredFinlyMinusVolatilityMatched,
      scored_volatility_matched_minus_spy: scoredVolatilityMatchedMinusSpy,
    },
    identity: {
      units: SPECIFICATION.full_window_identity_units,
      formula: SPECIFICATION.full_window_identity,
      bridge_sum: bridgeSum,
      absolute_error: Math.abs(identityError),
      maximum_absolute_error: SPECIFICATION.maximum_absolute_identity_error,
      reconciles: true,
    },
    claim_boundary: {
      p_value: null,
      p_value_permitted: false,
      can_replace_primary_comparator: false,
      source_emitted_role_adopted: false,
      result_changes_incumbent_policy: false,
      broker_mutation_authorized: false,
    },
    assurance: {
      finalization_gate_sha256: sha256(gate),
      finalization_state: gate.state,
      adjusted_theoretical_is_only_input_source: true,
      alpaca_paper_cash_equity_excluded: true,
      independent_evidence_fetched_by_this_module: false,
    },
    rows: outputRows,
  };
  return deepFreeze(validateAttempt114VolatilityMatchedDecomposition({
    ...body,
    decomposition_sha256: sha256(body),
  }));
}

export function buildAttempt114VolatilityMatchedDecompositionFromSettlements(input) {
  exact(input, ["adjusted_theoretical_settlements", "finalization_gate"],
    "Attempt 114 settlement decomposition input");
  return buildAttempt114VolatilityMatchedDecomposition({
    adjusted_theoretical_return_rows:
      projectAttempt114AdjustedTheoreticalSettlements(input.adjusted_theoretical_settlements),
    finalization_gate: input.finalization_gate,
  });
}

export function validateAttempt114VolatilityMatchedDecomposition(value) {
  exact(value, [
    "schema_version",
    "attempt_id",
    "protocol_sha256",
    "evidence_class",
    "role",
    "source",
    "ids",
    "specification",
    "sample",
    "net_log_return_sums",
    "identity",
    "claim_boundary",
    "assurance",
    "rows",
    "decomposition_sha256",
  ], "Attempt 114 volatility-matched decomposition");
  exact(value.source, [
    "implementation",
    "path",
    "raw_bytes_sha256",
    "emitted_role",
    "emitted_role_adopted_by_attempt_114",
  ], "Attempt 114 decomposition source");
  exact(value.ids, ["candidate_id", "spy_id", "cash_id", "comparator_id"],
    "Attempt 114 decomposition ids");
  exact(value.specification, [
    "input_return_field",
    "input_returns_include_frozen_book_costs",
    "lookback_sessions",
    "rebalance_interval_sessions",
    "rebalance_anchor",
    "minimum_spy_weight",
    "maximum_spy_weight",
    "residual_asset",
    "one_way_cost_bps_per_absolute_traded_notional",
    "annual_borrow_spread",
    "terminal_liquidation",
  ], "Attempt 114 decomposition specification");
  exact(value.sample, [
    "intervals",
    "warmup_intervals",
    "scoring_start_interval",
    "scored_intervals",
    "adjusted_theoretical_return_rows_sha256",
  ], "Attempt 114 decomposition sample");
  exact(value.net_log_return_sums, [
    "full_finly_minus_spy",
    "warmup_finly_minus_spy",
    "scored_finly_minus_volatility_matched",
    "scored_volatility_matched_minus_spy",
  ], "Attempt 114 decomposition log-return sums");
  exact(value.identity, [
    "units",
    "formula",
    "bridge_sum",
    "absolute_error",
    "maximum_absolute_error",
    "reconciles",
  ], "Attempt 114 decomposition identity");
  exact(value.claim_boundary, [
    "p_value",
    "p_value_permitted",
    "can_replace_primary_comparator",
    "source_emitted_role_adopted",
    "result_changes_incumbent_policy",
    "broker_mutation_authorized",
  ], "Attempt 114 decomposition claim boundary");
  exact(value.assurance, [
    "finalization_gate_sha256",
    "finalization_state",
    "adjusted_theoretical_is_only_input_source",
    "alpaca_paper_cash_equity_excluded",
    "independent_evidence_fetched_by_this_module",
  ], "Attempt 114 decomposition assurance");
  const expectedSpecification = {
    input_return_field: "net_return",
    input_returns_include_frozen_book_costs: true,
    lookback_sessions: 63,
    rebalance_interval_sessions: 21,
    rebalance_anchor: 0,
    minimum_spy_weight: 0,
    maximum_spy_weight: 1.5,
    residual_asset: "BIL",
    one_way_cost_bps_per_absolute_traded_notional: 5,
    annual_borrow_spread: 0.005,
    terminal_liquidation: false,
  };
  if (value.schema_version !== ATTEMPT114_DECOMPOSITION_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256
    || value.role !== "DESCRIPTIVE_CAUSAL_DECOMPOSITION_NOT_PRIMARY"
    || value.evidence_class
      !== "DESCRIPTIVE_CAUSAL_DECOMPOSITION_CONDITIONAL_ON_BOUND_FINALIZATION_GATE"
    || stableStringify(value.source) !== stableStringify({
      implementation: SPECIFICATION.implementation,
      path: SPECIFICATION.source_path,
      raw_bytes_sha256: SPECIFICATION.source_raw_bytes_sha256,
      emitted_role: SPECIFICATION.source_emitted_role,
      emitted_role_adopted_by_attempt_114: false,
    })
    || stableStringify(value.ids) !== stableStringify({
      candidate_id: SPECIFICATION.candidate_id,
      spy_id: SPECIFICATION.spy_id,
      cash_id: SPECIFICATION.cash_id,
      comparator_id: SPECIFICATION.comparator_id,
    })
    || stableStringify(value.specification) !== stableStringify(expectedSpecification)
    || value.sample?.intervals !== 252
    || value.sample?.warmup_intervals !== 63
    || value.sample?.scoring_start_interval !== 64
    || value.sample?.scored_intervals !== 189
    || value.identity?.units !== "sums of net log returns"
    || value.identity?.formula !== SPECIFICATION.full_window_identity
    || value.identity?.reconciles !== true
    || finite(value.identity?.absolute_error, "Attempt 114 decomposition identity error") > 1e-12
    || value.identity?.maximum_absolute_error !== 1e-12
    || value.claim_boundary?.p_value !== null
    || value.claim_boundary?.p_value_permitted !== false
    || value.claim_boundary?.can_replace_primary_comparator !== false
    || value.claim_boundary?.source_emitted_role_adopted !== false
    || value.claim_boundary?.result_changes_incumbent_policy !== false
    || value.claim_boundary?.broker_mutation_authorized !== false
    || value.assurance?.adjusted_theoretical_is_only_input_source !== true
    || value.assurance?.alpaca_paper_cash_equity_excluded !== true
    || value.assurance?.independent_evidence_fetched_by_this_module !== false
    || value.assurance?.finalization_state !== "FINALIZATION_DUE"
    || !Array.isArray(value.rows)
    || value.rows.length !== 252) {
    fail("Attempt 114 decomposition changes the frozen descriptive boundary");
  }
  const candidateId = SPECIFICATION.candidate_id;
  const spyId = SPECIFICATION.spy_id;
  const cashId = SPECIFICATION.cash_id;
  const comparatorId = SPECIFICATION.comparator_id;
  const projection = [];
  const scheduledSequences = [];
  for (const [index, row] of value.rows.entries()) {
    const label = `Attempt 114 decomposition row ${index + 1}`;
    exact(row, [
      "settlement_sequence",
      "return_start_session",
      "return_end_session",
      "net_returns",
      "comparator_accounting",
      "volatility_match",
    ], label);
    if (row.settlement_sequence !== index + 1) fail(`${label} sequence is invalid`);
    exact(row.net_returns, [candidateId, spyId, cashId, comparatorId], `${label}.net_returns`);
    for (const id of [candidateId, spyId, cashId, comparatorId]) {
      if (finite(row.net_returns[id], `${label}.net_returns.${id}`) <= -1) {
        fail(`${label}.net_returns.${id} must be greater than -1`);
      }
    }
    exact(row.comparator_accounting, [
      "gross_return",
      "transaction_cost",
      "financing_spread_cost",
      "turnover_notional",
      "start_spy_weight",
      "start_cash_weight",
      "terminal_liquidation",
    ], `${label}.comparator_accounting`);
    exact(row.volatility_match, [
      "rebalanced",
      "candidate_annualized_sample_volatility",
      "spy_minus_bil_annualized_sample_volatility",
      "target_spy_weight",
      "estimation_start_date",
      "estimation_end_date",
      "execution_return_date",
    ], `${label}.volatility_match`);
    const accounting = row.comparator_accounting;
    const turnover = finite(accounting.turnover_notional, `${label}.turnover_notional`);
    const cost = finite(accounting.transaction_cost, `${label}.transaction_cost`);
    const financing = finite(accounting.financing_spread_cost, `${label}.financing_spread_cost`);
    const spyWeight = finite(accounting.start_spy_weight, `${label}.start_spy_weight`);
    const cashWeight = finite(accounting.start_cash_weight, `${label}.start_cash_weight`);
    const gross = finite(accounting.gross_return, `${label}.gross_return`);
    if (accounting.terminal_liquidation !== false
      || turnover < 0
      || cost < 0
      || financing < 0
      || !close(spyWeight + cashWeight, 1)
      || !close(cost, turnover * 5 / 10_000)
      || !close(financing, Math.max(0, -cashWeight) * 0.005 / 252)
      || !close(gross, spyWeight * row.net_returns[spyId] + cashWeight * row.net_returns[cashId])
      || !close(row.net_returns[comparatorId], gross - cost - financing)) {
      fail(`${label} comparator accounting changes the frozen cost, financing, or weight algebra`);
    }
    if (row.volatility_match.execution_return_date !== row.return_end_session
      || typeof row.volatility_match.rebalanced !== "boolean") {
      fail(`${label} volatility-match timing is invalid`);
    }
    if (row.volatility_match.rebalanced) scheduledSequences.push(index + 1);
    projection.push({
      schema_version: "finly_attempt114_adjusted_theoretical_return_projection.v1",
      settlement_sequence: index + 1,
      signal_commitment_sequence: index + 1,
      execution_close_commitment_sequence: index + 2,
      outcome_close_commitment_sequence: index + 3,
      return_start_session: row.return_start_session,
      return_end_session: row.return_end_session,
      books: {
        [candidateId]: { net_simple_return: row.net_returns[candidateId] },
        [spyId]: { net_simple_return: row.net_returns[spyId] },
        [cashId]: { net_simple_return: row.net_returns[cashId] },
      },
    });
  }
  const validatedProjection = validateAttempt114AdjustedReturnRows(projection);
  if (value.sample.adjusted_theoretical_return_rows_sha256 !== sha256(validatedProjection)
    || stableStringify(scheduledSequences) !== stableStringify([64, 85, 106, 127, 148, 169, 190, 211, 232])) {
    fail("Attempt 114 decomposition input hash or causal rebalance schedule is invalid");
  }
  const logDifference = (row, leftId, rightId) => (
    Math.log1p(row.net_returns[leftId]) - Math.log1p(row.net_returns[rightId])
  );
  const full = value.rows.reduce((sum, row) => sum + logDifference(row, candidateId, spyId), 0);
  const warm = value.rows.slice(0, 63)
    .reduce((sum, row) => sum + logDifference(row, candidateId, spyId), 0);
  const residual = value.rows.slice(63)
    .reduce((sum, row) => sum + logDifference(row, candidateId, comparatorId), 0);
  const bridge = value.rows.slice(63)
    .reduce((sum, row) => sum + logDifference(row, comparatorId, spyId), 0);
  const bridgeSum = warm + residual + bridge;
  if (value.net_log_return_sums.full_finly_minus_spy !== full
    || value.net_log_return_sums.warmup_finly_minus_spy !== warm
    || value.net_log_return_sums.scored_finly_minus_volatility_matched !== residual
    || value.net_log_return_sums.scored_volatility_matched_minus_spy !== bridge
    || value.identity.bridge_sum !== bridgeSum
    || value.identity.absolute_error !== Math.abs(full - bridgeSum)) {
    fail("Attempt 114 decomposition log-sum bridge does not reproduce from its rows");
  }
  if (value.decomposition_sha256 !== sha256(decompositionBody(value))) {
    fail("Attempt 114 volatility-matched decomposition hash is invalid");
  }
  return value;
}
