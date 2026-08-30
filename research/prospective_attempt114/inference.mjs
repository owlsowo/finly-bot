import { sha256, stableStringify } from "../../lib/canonical.mjs";
import {
  ATTEMPT114_PROTOCOL,
  ATTEMPT114_PROTOCOL_ID,
  ATTEMPT114_PROTOCOL_SHA256,
} from "./protocol.mjs";

export const ATTEMPT114_ADJUSTED_RETURN_ROW_SCHEMA =
  "finly_attempt114_adjusted_theoretical_return_projection.v1";
export const ATTEMPT114_ADJUSTED_SETTLEMENT_SCHEMA =
  "finly_attempt114_adjusted_theoretical_settlement.v1";
export const ATTEMPT114_FINALIZATION_GATE_SCHEMA =
  "finly_attempt114_finalization_gate.v1";
export const ATTEMPT114_PRIMARY_INFERENCE_SCHEMA =
  "finly_attempt114_primary_inference.v1";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const BOOK_IDS = Object.freeze([
  "incumbent_tsmom_ensemble_vol",
  "spy_buy_hold",
  "bil_cash",
]);
const FINALIZATION_COUNTS = Object.freeze({
  signal_commitments: 254,
  independent_pre_execution_anchor_receipts: 254,
  adjusted_theoretical_settlements: 252,
  alpaca_paper_cash_equity_entries: 252,
  joint_interval_bundles: 252,
  independently_reconciled_outcome_price_lineages: 252,
});
const FINALIZATION_VERIFICATION = Object.freeze({
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
});
const FINALIZATION_EVIDENCE_HASH_KEYS = Object.freeze([
  "runtime_manifest_sha256",
  "protocol_runtime_publication_receipt_sha256",
  "anchor_receipt_chain_head_sha256",
  "outcome_price_lineage_chain_head_sha256",
  "adjusted_theoretical_ledger_head_sha256",
  "alpaca_paper_cash_equity_ledger_head_sha256",
  "joint_interval_bundle_head_sha256",
  "full_chain_reopen_receipt_sha256",
  "session_60_checkpoint_receipt_sha256",
]);
const ADJUSTED_BOOK_KEYS = Object.freeze([
  "book_id",
  "committed_action",
  "pretrade_weights",
  "evaluation_weights",
  "same_vintage_asset_gross_returns",
  "absolute_traded_leg_weights",
  "absolute_traded_leg_cost_returns",
  "turnover_notional",
  "modeled_cost_return",
  "opening_equity",
  "gross_simple_return",
  "net_simple_return",
  "closing_equity",
  "closing_weights",
]);
const SETTLEMENT_AUTHORITY = Object.freeze({
  research_only: true,
  broker_mutation_authorized: false,
  order_payload: null,
  persistence_authorized: false,
});

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

function same(actual, expected, label) {
  if (stableStringify(actual) !== stableStringify(expected)) fail(`${label} changes the frozen value`);
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a canonical SHA-256 digest`);
  return value;
}

function date(value, label) {
  if (typeof value !== "string" || !DATE.test(value)) fail(`${label} must be an ISO calendar date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be an ISO calendar date`);
  }
  return value;
}

function netReturn(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= -1) {
    fail(`${label} must be finite and greater than -1`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function close(actual, expected, tolerance = 1e-12) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected));
}

function symbolMap(value, label, validator = finiteNumber) {
  exact(value, ["SPY", "BIL"], label);
  return {
    SPY: validator(value.SPY, `${label}.SPY`),
    BIL: validator(value.BIL, `${label}.BIL`),
  };
}

function weights(value, label) {
  const result = symbolMap(value, label, (item, itemLabel) => {
    const checked = finiteNumber(item, itemLabel);
    if (checked < 0 || checked > 1) fail(`${itemLabel} must be between zero and one`);
    return checked;
  });
  if (!close(result.SPY + result.BIL, 1)) fail(`${label} must sum to one`);
  return result;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function validateAttempt114FinalizationGate(value) {
  exact(value, [
    "schema_version",
    "attempt_id",
    "protocol_sha256",
    "state",
    "verified_counts",
    "verification",
    "evidence_hashes",
    "primary_inference_runs_before_this",
    "terminal_state_written",
    "broker_mutation_authorized",
  ], "Attempt 114 finalization gate");
  if (value.schema_version !== ATTEMPT114_FINALIZATION_GATE_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256
    || value.state !== "FINALIZATION_DUE"
    || value.primary_inference_runs_before_this !== 0
    || value.terminal_state_written !== false
    || value.broker_mutation_authorized !== false) {
    fail("Attempt 114 finalization gate envelope is invalid or permits repeat inference");
  }
  exact(value.verified_counts, Object.keys(FINALIZATION_COUNTS), "Attempt 114 verified counts");
  same(value.verified_counts, FINALIZATION_COUNTS, "Attempt 114 verified counts");
  exact(value.verification, Object.keys(FINALIZATION_VERIFICATION), "Attempt 114 finalization verification");
  same(value.verification, FINALIZATION_VERIFICATION, "Attempt 114 finalization verification");
  exact(value.evidence_hashes, FINALIZATION_EVIDENCE_HASH_KEYS, "Attempt 114 finalization evidence hashes");
  for (const key of FINALIZATION_EVIDENCE_HASH_KEYS) {
    digest(value.evidence_hashes[key], `Attempt 114 finalization evidence ${key}`);
  }
  return deepFreeze(structuredClone(value));
}

export function validateAttempt114AdjustedReturnRows(value) {
  if (!Array.isArray(value) || value.length !== ATTEMPT114_PROTOCOL.primary_inference.intervals) {
    fail("Attempt 114 inference requires exactly the first 252 adjusted theoretical return rows");
  }
  let previousEnd = null;
  const normalized = value.map((candidate, index) => {
    const label = `Attempt 114 adjusted return row ${index + 1}`;
    exact(candidate, [
      "schema_version",
      "settlement_sequence",
      "signal_commitment_sequence",
      "execution_close_commitment_sequence",
      "outcome_close_commitment_sequence",
      "return_start_session",
      "return_end_session",
      "books",
    ], label);
    const sequence = index + 1;
    if (candidate.schema_version !== ATTEMPT114_ADJUSTED_RETURN_ROW_SCHEMA
      || candidate.settlement_sequence !== sequence
      || candidate.signal_commitment_sequence !== sequence
      || candidate.execution_close_commitment_sequence !== sequence + 1
      || candidate.outcome_close_commitment_sequence !== sequence + 2) {
      fail(`${label} violates the exact N/N+1/N+2 sequence`);
    }
    const start = date(candidate.return_start_session, `${label}.return_start_session`);
    const end = date(candidate.return_end_session, `${label}.return_end_session`);
    if (start >= end) fail(`${label} return boundary is not chronological`);
    if (index === 0 && start !== ATTEMPT114_PROTOCOL.sample.first_return_start_session) {
      fail(`${label} changes the frozen first return-start session`);
    }
    if (previousEnd !== null && start !== previousEnd) {
      fail(`${label} skips, overlaps, or replaces a frozen return interval`);
    }
    previousEnd = end;
    exact(candidate.books, BOOK_IDS, `${label}.books`);
    const books = Object.fromEntries(BOOK_IDS.map((bookId) => {
      exact(candidate.books[bookId], ["net_simple_return"], `${label}.books.${bookId}`);
      return [bookId, {
        net_simple_return: netReturn(
          candidate.books[bookId].net_simple_return,
          `${label}.books.${bookId}.net_simple_return`,
        ),
      }];
    }));
    return {
      schema_version: ATTEMPT114_ADJUSTED_RETURN_ROW_SCHEMA,
      settlement_sequence: sequence,
      signal_commitment_sequence: sequence,
      execution_close_commitment_sequence: sequence + 1,
      outcome_close_commitment_sequence: sequence + 2,
      return_start_session: start,
      return_end_session: end,
      books,
    };
  });
  return deepFreeze(normalized);
}

function adjustedSettlementBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "settlement_sha256"));
}

export function projectAttempt114AdjustedTheoreticalSettlements(value) {
  if (!Array.isArray(value) || value.length !== ATTEMPT114_PROTOCOL.primary_inference.intervals) {
    fail("Attempt 114 projection requires exactly 252 adjusted theoretical settlements");
  }
  const projected = value.map((settlement, index) => {
    const sequence = index + 1;
    const label = `Attempt 114 adjusted theoretical settlement ${sequence}`;
    exact(settlement, [
      "schema_version",
      "attempt_id",
      "protocol_sha256",
      "sequence",
      "entry_kind",
      "evidence_class",
      "lineage",
      "books",
      "authority",
      "settlement_sha256",
    ], label);
    if (settlement.schema_version !== ATTEMPT114_ADJUSTED_SETTLEMENT_SCHEMA
      || settlement.attempt_id !== ATTEMPT114_PROTOCOL_ID
      || settlement.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256
      || settlement.sequence !== sequence
      || settlement.entry_kind !== "ADJUSTED_THEORETICAL_SETTLEMENT"
      || settlement.evidence_class !== "PROSPECTIVE_ADJUSTED_THEORETICAL_ACCOUNTING") {
      fail(`${label} is not a frozen adjusted-theoretical settlement`);
    }
    exact(settlement.lineage, [
      "signal_commitment_sequence",
      "execution_close_commitment_sequence",
      "outcome_close_commitment_sequence",
      "signal_anchor_manifest_sha256",
      "execution_anchor_manifest_sha256",
      "outcome_anchor_manifest_sha256",
      "outcome_price_lineage_sha256",
      "signal_session_date",
      "return_start_session_date",
      "return_end_session_date",
    ], `${label}.lineage`);
    if (settlement.lineage.signal_commitment_sequence !== sequence
      || settlement.lineage.execution_close_commitment_sequence !== sequence + 1
      || settlement.lineage.outcome_close_commitment_sequence !== sequence + 2) {
      fail(`${label} breaks the N/N+1/N+2 lineage`);
    }
    for (const key of [
      "signal_anchor_manifest_sha256",
      "execution_anchor_manifest_sha256",
      "outcome_anchor_manifest_sha256",
      "outcome_price_lineage_sha256",
    ]) {
      digest(settlement.lineage[key], `${label}.lineage.${key}`);
    }
    date(settlement.lineage.signal_session_date, `${label}.lineage.signal_session_date`);
    date(settlement.lineage.return_start_session_date, `${label}.lineage.return_start_session_date`);
    date(settlement.lineage.return_end_session_date, `${label}.lineage.return_end_session_date`);
    exact(settlement.books, BOOK_IDS, `${label}.books`);
    const projectedBooks = {};
    for (const bookId of BOOK_IDS) {
      const book = settlement.books[bookId];
      const bookLabel = `${label}.books.${bookId}`;
      exact(book, ADJUSTED_BOOK_KEYS, bookLabel);
      if (book.book_id !== bookId || !new Set(["HOLD", "REBALANCE"]).has(book.committed_action)) {
        fail(`${bookLabel} identity or action is invalid`);
      }
      const pretrade = weights(book.pretrade_weights, `${bookLabel}.pretrade_weights`);
      const evaluation = weights(book.evaluation_weights, `${bookLabel}.evaluation_weights`);
      const grossMultipliers = symbolMap(
        book.same_vintage_asset_gross_returns,
        `${bookLabel}.same_vintage_asset_gross_returns`,
        (item, itemLabel) => {
          const checked = finiteNumber(item, itemLabel);
          if (!(checked > 0)) fail(`${itemLabel} must be positive`);
          return checked;
        },
      );
      const absoluteLegs = symbolMap(
        book.absolute_traded_leg_weights,
        `${bookLabel}.absolute_traded_leg_weights`,
      );
      const legCosts = symbolMap(
        book.absolute_traded_leg_cost_returns,
        `${bookLabel}.absolute_traded_leg_cost_returns`,
      );
      for (const symbol of ["SPY", "BIL"]) {
        if (absoluteLegs[symbol] < 0
          || !close(absoluteLegs[symbol], Math.abs(evaluation[symbol] - pretrade[symbol]))
          || !close(legCosts[symbol], absoluteLegs[symbol] * 5 / 10_000)) {
          fail(`${bookLabel}.${symbol} changes the frozen five-basis-point L1 accounting`);
        }
      }
      const turnover = finiteNumber(book.turnover_notional, `${bookLabel}.turnover_notional`);
      const cost = finiteNumber(book.modeled_cost_return, `${bookLabel}.modeled_cost_return`);
      const gross = finiteNumber(book.gross_simple_return, `${bookLabel}.gross_simple_return`);
      const net = netReturn(book.net_simple_return, `${bookLabel}.net_simple_return`);
      const opening = finiteNumber(book.opening_equity, `${bookLabel}.opening_equity`);
      const closing = finiteNumber(book.closing_equity, `${bookLabel}.closing_equity`);
      const closingWeights = weights(book.closing_weights, `${bookLabel}.closing_weights`);
      const expectedGross = evaluation.SPY * (grossMultipliers.SPY - 1)
        + evaluation.BIL * (grossMultipliers.BIL - 1);
      if (turnover < 0
        || cost < 0
        || opening <= 0
        || closing <= 0
        || !close(turnover, absoluteLegs.SPY + absoluteLegs.BIL)
        || !close(cost, legCosts.SPY + legCosts.BIL)
        || !close(gross, expectedGross)
        || !close(net, gross - cost)
        || !close(closing, opening * (1 + net))
        || !close(closingWeights.SPY, evaluation.SPY * grossMultipliers.SPY / (1 + gross))
        || !close(closingWeights.BIL, evaluation.BIL * grossMultipliers.BIL / (1 + gross))) {
        fail(`${bookLabel} arithmetic is inconsistent with the frozen accounting`);
      }
      if (book.committed_action === "HOLD"
        && (!close(turnover, 0) || !close(cost, 0)
          || stableStringify(pretrade) !== stableStringify(evaluation))) {
        fail(`${bookLabel} HOLD creates turnover or resets drifted weights`);
      }
      projectedBooks[bookId] = { net_simple_return: net };
    }
    exact(settlement.authority, Object.keys(SETTLEMENT_AUTHORITY), `${label}.authority`);
    same(settlement.authority, SETTLEMENT_AUTHORITY, `${label}.authority`);
    digest(settlement.settlement_sha256, `${label}.settlement_sha256`);
    if (settlement.settlement_sha256 !== sha256(adjustedSettlementBody(settlement))) {
      fail(`${label} self-hash is invalid`);
    }
    return {
      schema_version: ATTEMPT114_ADJUSTED_RETURN_ROW_SCHEMA,
      settlement_sequence: sequence,
      signal_commitment_sequence: settlement.lineage.signal_commitment_sequence,
      execution_close_commitment_sequence: settlement.lineage.execution_close_commitment_sequence,
      outcome_close_commitment_sequence: settlement.lineage.outcome_close_commitment_sequence,
      return_start_session: settlement.lineage.return_start_session_date,
      return_end_session: settlement.lineage.return_end_session_date,
      books: projectedBooks,
    };
  });
  return validateAttempt114AdjustedReturnRows(projected);
}

export function hashAttempt114AdjustedReturnRows(rows) {
  return sha256(validateAttempt114AdjustedReturnRows(rows));
}

function primaryBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "result_sha256"));
}

export function buildAttempt114PrimaryInference(input) {
  exact(input, ["adjusted_theoretical_return_rows", "finalization_gate"], "Attempt 114 inference input");
  const rows = validateAttempt114AdjustedReturnRows(input.adjusted_theoretical_return_rows);
  const gate = validateAttempt114FinalizationGate(input.finalization_gate);
  const specification = ATTEMPT114_PROTOCOL.primary_inference;
  const dailyValues = rows.map((row) => (
    Math.log1p(row.books.incumbent_tsmom_ensemble_vol.net_simple_return)
      - Math.log1p(row.books.spy_buy_hold.net_simple_return)
  ));
  const observedSum = dailyValues.reduce((sum, value) => sum + value, 0);
  const observedMean = observedSum / dailyValues.length;
  const centered = dailyValues.map((value) => value - observedMean);
  const random = mulberry32(specification.bootstrap_seed_uint32);
  let exceedances = 0;

  for (let draw = 0; draw < specification.bootstrap_resamples; draw += 1) {
    let source = Math.floor(random() * centered.length);
    let bootstrapSum = 0;
    for (let index = 0; index < centered.length; index += 1) {
      bootstrapSum += centered[source];
      source = random() < specification.restart_probability
        ? Math.floor(random() * centered.length)
        : (source + 1) % centered.length;
    }
    if (bootstrapSum / centered.length >= observedMean) exceedances += 1;
  }

  const pValue = (1 + exceedances) / (specification.bootstrap_resamples + 1);
  const supportsPositiveEdge = observedMean > 0 && pValue <= specification.alpha;
  const body = {
    schema_version: ATTEMPT114_PRIMARY_INFERENCE_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    evidence_class: "CONFIRMATORY_NUMERIC_RESULT_CONDITIONAL_ON_BOUND_FINALIZATION_GATE",
    role: "PRIMARY_CONFIRMATORY_ENDPOINT",
    endpoint: specification.endpoint,
    null_hypothesis: specification.null_hypothesis,
    sample: {
      intervals: rows.length,
      first_settlement_sequence: rows[0].settlement_sequence,
      last_settlement_sequence: rows.at(-1).settlement_sequence,
      first_return_start_session: rows[0].return_start_session,
      last_return_end_session: rows.at(-1).return_end_session,
      adjusted_theoretical_return_rows_sha256: sha256(rows),
    },
    observed: {
      sum_net_log_return_difference: observedSum,
      mean_daily_net_log_return_difference: observedMean,
    },
    bootstrap: {
      test: specification.test,
      null_centered: true,
      centering_formula: "daily_value - observed_mean",
      prng: "mulberry32_uint32",
      circular_blocks: true,
      seed_uint32: specification.bootstrap_seed_uint32,
      resamples: specification.bootstrap_resamples,
      expected_block_sessions: specification.expected_block_sessions,
      restart_probability: specification.restart_probability,
      restart_draw_consumed_after_final_observation: true,
      restart_index_draw_consumed_when_triggered_after_final_observation: true,
      equality_counts_as_exceedance: specification.equality_counts_as_exceedance,
      exceedances,
      one_sided_p_value: pValue,
    },
    decision: {
      alpha: specification.alpha,
      rejection_rule: "observed_mean > 0 and one_sided_p_value <= alpha",
      supports_positive_net_log_return_edge: supportsPositiveEdge,
      conclusion: supportsPositiveEdge
        ? specification.support_conclusion
        : specification.non_support_conclusion,
      result_changes_incumbent_policy: false,
    },
    assurance: {
      finalization_gate_sha256: sha256(gate),
      finalization_state: gate.state,
      adjusted_theoretical_is_only_inference_source: true,
      alpaca_paper_cash_equity_excluded: true,
      independent_evidence_fetched_by_this_module: false,
      broker_mutation_authorized: false,
      repeat_confirmatory_test_permitted: false,
    },
  };
  return deepFreeze(validateAttempt114PrimaryInference({ ...body, result_sha256: sha256(body) }));
}

export function buildAttempt114PrimaryInferenceFromSettlements(input) {
  exact(input, ["adjusted_theoretical_settlements", "finalization_gate"],
    "Attempt 114 settlement inference input");
  return buildAttempt114PrimaryInference({
    adjusted_theoretical_return_rows:
      projectAttempt114AdjustedTheoreticalSettlements(input.adjusted_theoretical_settlements),
    finalization_gate: input.finalization_gate,
  });
}

export function validateAttempt114PrimaryInference(value) {
  exact(value, [
    "schema_version",
    "attempt_id",
    "protocol_sha256",
    "evidence_class",
    "role",
    "endpoint",
    "null_hypothesis",
    "sample",
    "observed",
    "bootstrap",
    "decision",
    "assurance",
    "result_sha256",
  ], "Attempt 114 primary inference");
  exact(value.sample, [
    "intervals",
    "first_settlement_sequence",
    "last_settlement_sequence",
    "first_return_start_session",
    "last_return_end_session",
    "adjusted_theoretical_return_rows_sha256",
  ], "Attempt 114 primary inference sample");
  exact(value.observed, [
    "sum_net_log_return_difference",
    "mean_daily_net_log_return_difference",
  ], "Attempt 114 primary inference observed statistic");
  exact(value.bootstrap, [
    "test",
    "null_centered",
    "centering_formula",
    "prng",
    "circular_blocks",
    "seed_uint32",
    "resamples",
    "expected_block_sessions",
    "restart_probability",
    "restart_draw_consumed_after_final_observation",
    "restart_index_draw_consumed_when_triggered_after_final_observation",
    "equality_counts_as_exceedance",
    "exceedances",
    "one_sided_p_value",
  ], "Attempt 114 primary inference bootstrap");
  exact(value.decision, [
    "alpha",
    "rejection_rule",
    "supports_positive_net_log_return_edge",
    "conclusion",
    "result_changes_incumbent_policy",
  ], "Attempt 114 primary inference decision");
  exact(value.assurance, [
    "finalization_gate_sha256",
    "finalization_state",
    "adjusted_theoretical_is_only_inference_source",
    "alpaca_paper_cash_equity_excluded",
    "independent_evidence_fetched_by_this_module",
    "broker_mutation_authorized",
    "repeat_confirmatory_test_permitted",
  ], "Attempt 114 primary inference assurance");
  const observedSum = finiteNumber(
    value.observed.sum_net_log_return_difference,
    "Attempt 114 observed log-return sum",
  );
  const observedMean = finiteNumber(
    value.observed.mean_daily_net_log_return_difference,
    "Attempt 114 observed log-return mean",
  );
  const exceedances = value.bootstrap.exceedances;
  const pValue = value.bootstrap.one_sided_p_value;
  const expectedSupport = observedMean > 0 && pValue <= ATTEMPT114_PROTOCOL.primary_inference.alpha;
  if (value.schema_version !== ATTEMPT114_PRIMARY_INFERENCE_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256
    || value.evidence_class !== "CONFIRMATORY_NUMERIC_RESULT_CONDITIONAL_ON_BOUND_FINALIZATION_GATE"
    || value.role !== "PRIMARY_CONFIRMATORY_ENDPOINT"
    || value.endpoint !== ATTEMPT114_PROTOCOL.primary_inference.endpoint
    || value.null_hypothesis !== ATTEMPT114_PROTOCOL.primary_inference.null_hypothesis
    || value.sample?.intervals !== 252
    || value.sample?.first_settlement_sequence !== 1
    || value.sample?.last_settlement_sequence !== 252
    || value.sample?.first_return_start_session !== ATTEMPT114_PROTOCOL.sample.first_return_start_session
    || date(value.sample?.last_return_end_session, "Attempt 114 last return-end session")
      <= value.sample.first_return_start_session
    || observedMean !== observedSum / 252
    || value.bootstrap?.test !== ATTEMPT114_PROTOCOL.primary_inference.test
    || value.bootstrap?.null_centered !== true
    || value.bootstrap?.centering_formula !== "daily_value - observed_mean"
    || value.bootstrap?.prng !== "mulberry32_uint32"
    || value.bootstrap?.circular_blocks !== true
    || value.bootstrap?.seed_uint32 !== 20260829
    || value.bootstrap?.resamples !== 4999
    || value.bootstrap?.expected_block_sessions !== 20
    || value.bootstrap?.restart_probability !== 0.05
    || value.bootstrap?.restart_draw_consumed_after_final_observation !== true
    || value.bootstrap?.restart_index_draw_consumed_when_triggered_after_final_observation !== true
    || value.bootstrap?.equality_counts_as_exceedance !== true
    || !Number.isInteger(exceedances)
    || exceedances < 0
    || exceedances > 4999
    || pValue !== (1 + exceedances) / 5000
    || value.decision?.alpha !== 0.05
    || value.decision?.rejection_rule !== "observed_mean > 0 and one_sided_p_value <= alpha"
    || value.decision?.supports_positive_net_log_return_edge !== expectedSupport
    || value.decision?.conclusion !== (expectedSupport
      ? ATTEMPT114_PROTOCOL.primary_inference.support_conclusion
      : ATTEMPT114_PROTOCOL.primary_inference.non_support_conclusion)
    || value.decision?.result_changes_incumbent_policy !== false
    || value.assurance?.finalization_state !== "FINALIZATION_DUE"
    || value.assurance?.adjusted_theoretical_is_only_inference_source !== true
    || value.assurance?.alpaca_paper_cash_equity_excluded !== true
    || value.assurance?.independent_evidence_fetched_by_this_module !== false
    || value.assurance?.broker_mutation_authorized !== false
    || value.assurance?.repeat_confirmatory_test_permitted !== false) {
    fail("Attempt 114 primary inference changes the frozen endpoint or authority");
  }
  digest(value.sample.adjusted_theoretical_return_rows_sha256, "Attempt 114 inference input-row hash");
  digest(value.assurance.finalization_gate_sha256, "Attempt 114 inference finalization-gate hash");
  digest(value.result_sha256, "Attempt 114 primary inference result hash");
  if (value.result_sha256 !== sha256(primaryBody(value))) fail("Attempt 114 primary inference hash is invalid");
  return value;
}
