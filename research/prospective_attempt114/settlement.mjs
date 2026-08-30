import { sha256, stableStringify } from "../../lib/canonical.mjs";
import { buildEquityShadowExecution } from "../../lib/equity_shadow_execution.mjs";
import {
  FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA,
  FORWARD_TRIAL_LIVE_ID,
} from "../forward_trial_live_core.mjs";
import {
  ATTEMPT114_PROTOCOL,
  ATTEMPT114_PROTOCOL_ID,
  ATTEMPT114_PROTOCOL_SHA256,
} from "./protocol.mjs";

export const ATTEMPT114_SETTLEMENT_INPUT_SCHEMA = "finly_attempt114_settlement_window_input.v1";
export const ATTEMPT114_SETTLEMENT_WINDOW_SCHEMA = "finly_attempt114_settlement_window.v1";
export const ATTEMPT114_PRICE_LINEAGE_SCHEMA = "finly_attempt114_outcome_price_lineage.v1";
export const ATTEMPT114_ANCHOR_RECEIPT_SCHEMA =
  "finly_attempt114_independent_anchor_verification_receipt.v1";
export const ATTEMPT114_ADJUSTED_SETTLEMENT_SCHEMA =
  ATTEMPT114_PROTOCOL.ledgers.adjusted_theoretical.future_schema_version;
export const ATTEMPT114_PAPER_ENTRY_SCHEMA =
  ATTEMPT114_PROTOCOL.ledgers.alpaca_paper_cash_equity.future_schema_version;
export const ATTEMPT114_INTERVAL_BUNDLE_SCHEMA =
  ATTEMPT114_PROTOCOL.ledgers.joint_interval_bundle.future_schema_version;

export const ATTEMPT114_BOOK_IDS = Object.freeze([
  "incumbent_tsmom_ensemble_vol",
  "spy_buy_hold",
  "bil_cash",
]);

const SYMBOLS = Object.freeze(["SPY", "BIL"]);
const REQUIRED_COMMITMENTS = 254;
const REQUIRED_SETTLEMENTS = 252;
const INITIAL_EQUITY = 100_000;
const COST_BPS = 5;
const QUANTITY_SCALE = 1_000_000_000;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const ACCEPTED_ANCHOR_MECHANISMS = new Set([
  "public GitHub Actions/commit publication",
  "RFC 3161 or OpenTimestamps receipt",
  "trusted append service signature",
]);
const AUTHORITY = Object.freeze({
  research_only: true,
  broker_mutation_authorized: false,
  order_payload: null,
  persistence_authorized: false,
});
const RECEIPT_EVIDENCE_CLASS = "INDEPENDENT_EXTERNAL_VERIFICATION_RECEIPT";
const LINEAGE_EVIDENCE_CLASS = "INDEPENDENT_OUTCOME_PRICE_LINEAGE_RECONCILIATION";
const EXPECTED_SAMPLE_CONTRACT = Object.freeze({
  first_commitment_sequence: 1,
  last_commitment_sequence: REQUIRED_COMMITMENTS,
  commitment_count: REQUIRED_COMMITMENTS,
  first_settlement_sequence: 1,
  last_settlement_sequence: REQUIRED_SETTLEMENTS,
  settlement_count: REQUIRED_SETTLEMENTS,
  consecutive_official_sessions_required: true,
  replacement_window_permitted: false,
  backfill_permitted: false,
  optional_stopping_permitted: false,
});

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a canonical SHA-256 digest`);
  return value;
}

function finite(value, label, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} must be finite and between ${minimum} and ${maximum}`);
  }
  return value;
}

function positive(value, label) {
  return finite(value, label, { minimum: Number.MIN_VALUE });
}

function date(value, label) {
  if (typeof value !== "string" || !DATE.test(value)) fail(`${label} must be an ISO date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label} is invalid`);
  return value;
}

function instant(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(`${label} must be a canonical UTC timestamp`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function rounded(value, places = 12) {
  if (!Number.isFinite(value)) fail("settlement arithmetic produced a non-finite value");
  const result = Number(value.toFixed(places));
  return Object.is(result, -0) ? 0 : result;
}

function floorQuantity(value) {
  if (!Number.isFinite(value) || value < 0) fail("paper quantity must be finite and non-negative");
  return Math.floor((value + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;
}

function quantityString(value) {
  return floorQuantity(value).toFixed(9);
}

function symbols(value, label, validator = positive) {
  exact(value, SYMBOLS, label);
  return Object.fromEntries(SYMBOLS.map((symbol) => [symbol, validator(value[symbol], `${label}.${symbol}`)]));
}

function weights(value, label) {
  const normalized = symbols(value, label, (item, itemLabel) => finite(item, itemLabel, { minimum: 0, maximum: 1 }));
  if (Math.abs(normalized.SPY + normalized.BIL - 1) > 1e-12) fail(`${label} must sum to one within 1e-12`);
  return normalized;
}

function exactBookIds(value, label) {
  exact(value, ATTEMPT114_BOOK_IDS, label);
  return value;
}

function anchorBody(value) {
  return {
    schema_version: value.schema_version,
    trial_id: value.trial_id,
    manifest_kind: value.manifest_kind,
    commitment_sequence: value.commitment_sequence,
    signal_session_date: value.signal_session_date,
    timing: value.timing,
    formula: value.formula,
    action: value.action,
    target_weights: value.target_weights,
    private_bundle_sha256: value.private_bundle_sha256,
    previous_private_bundle_sha256: value.previous_private_bundle_sha256,
    authority: value.authority,
    evaluation_gates: value.evaluation_gates,
  };
}

function validateAnchorManifest(value, sequence, previousAnchor) {
  const label = `anchor manifest ${sequence}`;
  exact(value, [
    "schema_version", "trial_id", "manifest_kind", "commitment_sequence", "signal_session_date",
    "timing", "formula", "action", "target_weights", "private_bundle_sha256",
    "previous_private_bundle_sha256", "authority", "evaluation_gates", "manifest_sha256",
  ], label);
  if (value.schema_version !== FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA
    || value.trial_id !== FORWARD_TRIAL_LIVE_ID
    || value.manifest_kind !== "PUBLIC_HASH_ONLY_SIGNAL_ANCHOR"
    || value.commitment_sequence !== sequence) fail(`${label} envelope or order is invalid`);
  date(value.signal_session_date, `${label}.signal_session_date`);
  if (sequence === 1
    ? value.signal_session_date !== ATTEMPT114_PROTOCOL.upstream_capture_binding.activation.first_signal_session
    : value.signal_session_date !== previousAnchor.timing.next_session_date) {
    fail(`${label} skips, replaces, backfills, or reorders the declared official session chain`);
  }

  exact(value.timing, [
    "captured_at", "market_close_at", "bar_eligible_at", "next_session_date",
    "next_market_close_at", "anchor_deadline",
  ], `${label}.timing`);
  for (const key of ["captured_at", "market_close_at", "bar_eligible_at", "next_market_close_at", "anchor_deadline"]) {
    instant(value.timing[key], `${label}.timing.${key}`);
  }
  date(value.timing.next_session_date, `${label}.timing.next_session_date`);
  if (value.timing.market_close_at.slice(0, 10) !== value.signal_session_date
    || value.timing.bar_eligible_at.slice(0, 10) !== value.signal_session_date
    || value.timing.next_market_close_at.slice(0, 10) !== value.timing.next_session_date
    || value.timing.anchor_deadline !== value.timing.next_market_close_at
    || value.timing.captured_at < value.timing.bar_eligible_at
    || value.timing.captured_at >= value.timing.anchor_deadline) {
    fail(`${label} timing is not a post-close, pre-execution commitment`);
  }

  exact(value.formula, [
    "implementation", "policy_id", "protocol_sha256", "implementation_binding_sha256",
    "decision_receipt_sha256",
  ], `${label}.formula`);
  if (value.formula.implementation !== ATTEMPT114_PROTOCOL.policy_binding.implementation
    || value.formula.policy_id !== ATTEMPT114_PROTOCOL.policy_binding.policy_id
    || value.formula.protocol_sha256 !== ATTEMPT114_PROTOCOL.policy_binding.protocol_sha256
    || value.formula.implementation_binding_sha256
      !== ATTEMPT114_PROTOCOL.upstream_capture_binding.runtime_manifest.manifest_sha256) {
    fail(`${label} changes the frozen formula or runtime binding`);
  }
  digest(value.formula.decision_receipt_sha256, `${label}.formula.decision_receipt_sha256`);
  if (!new Set(["REBALANCE", "HOLD"]).has(value.action)) fail(`${label}.action must be REBALANCE or HOLD`);
  weights(value.target_weights, `${label}.target_weights`);
  digest(value.private_bundle_sha256, `${label}.private_bundle_sha256`);
  digest(value.previous_private_bundle_sha256, `${label}.previous_private_bundle_sha256`);
  const expectedPrevious = previousAnchor?.private_bundle_sha256
    ?? ATTEMPT114_PROTOCOL.upstream_capture_binding.activation.activation_sha256;
  if (value.previous_private_bundle_sha256 !== expectedPrevious) fail(`${label} private commitment chain is broken`);
  exact(value.authority, ["research_only", "broker_mutation_authorized", "order_payload"], `${label}.authority`);
  if (!same(value.authority, { research_only: true, broker_mutation_authorized: false, order_payload: null })) {
    fail(`${label} crosses the broker authority boundary`);
  }
  exact(value.evaluation_gates, ["settlement_enabled", "inference_enabled"], `${label}.evaluation_gates`);
  if (!same(value.evaluation_gates, { settlement_enabled: false, inference_enabled: false })) {
    fail(`${label} alters the source trial's closed evaluation gates`);
  }
  digest(value.manifest_sha256, `${label}.manifest_sha256`);
  if (value.manifest_sha256 !== sha256(anchorBody(value))) fail(`${label} self-hash is invalid`);
  return value;
}

function anchorReceiptBody(value) {
  return {
    schema_version: value.schema_version,
    attempt_id: value.attempt_id,
    commitment_sequence: value.commitment_sequence,
    anchor_manifest_sha256: value.anchor_manifest_sha256,
    mechanism: value.mechanism,
    published_at: value.published_at,
    anchor_deadline: value.anchor_deadline,
    evidence_class: value.evidence_class,
    verification_evidence_sha256: value.verification_evidence_sha256,
    independently_verified: value.independently_verified,
  };
}

function validateAnchorReceipt(value, anchor, sequence) {
  const label = `independent anchor receipt ${sequence}`;
  exact(value, [
    "schema_version", "attempt_id", "commitment_sequence", "anchor_manifest_sha256",
    "mechanism", "published_at", "anchor_deadline", "evidence_class",
    "verification_evidence_sha256", "independently_verified", "receipt_sha256",
  ], label);
  if (value.schema_version !== ATTEMPT114_ANCHOR_RECEIPT_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.commitment_sequence !== sequence
    || value.anchor_manifest_sha256 !== anchor.manifest_sha256
    || value.anchor_deadline !== anchor.timing.anchor_deadline
    || value.evidence_class !== RECEIPT_EVIDENCE_CLASS
    || value.independently_verified !== true
    || !ACCEPTED_ANCHOR_MECHANISMS.has(value.mechanism)) {
    fail(`${label} does not prove the frozen one-to-one independent anchor requirement`);
  }
  instant(value.published_at, `${label}.published_at`);
  if (value.published_at < anchor.timing.captured_at || value.published_at >= anchor.timing.anchor_deadline) {
    fail(`${label} is late or predates its committed anchor`);
  }
  digest(value.verification_evidence_sha256, `${label}.verification_evidence_sha256`);
  digest(value.receipt_sha256, `${label}.receipt_sha256`);
  if (value.receipt_sha256 !== sha256(anchorReceiptBody(value))) fail(`${label} self-hash is invalid`);
  return value;
}

function lineageBody(value) {
  return {
    schema_version: value.schema_version,
    attempt_id: value.attempt_id,
    settlement_sequence: value.settlement_sequence,
    commitment_references: value.commitment_references,
    session_dates: value.session_dates,
    adjusted: value.adjusted,
    raw: value.raw,
    verification: value.verification,
  };
}

function validateRawPricePoint(value, label, expectedSession) {
  exact(value, ["session_date", "prices"], label);
  if (date(value.session_date, `${label}.session_date`) !== expectedSession) fail(`${label} session is not N, N+1, or N+2`);
  return symbols(value.prices, `${label}.prices`, (item, itemLabel) => {
    const price = positive(item, itemLabel);
    if (Math.abs(price - Number(price.toFixed(9))) > 1e-12) fail(`${itemLabel} exceeds nine decimals`);
    return price;
  });
}

function validatePriceLineage(value, sequence, anchors, previousLineage) {
  const label = `outcome price lineage ${sequence}`;
  exact(value, [
    "schema_version", "attempt_id", "settlement_sequence", "commitment_references",
    "session_dates", "adjusted", "raw", "verification", "lineage_sha256",
  ], label);
  if (value.schema_version !== ATTEMPT114_PRICE_LINEAGE_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.settlement_sequence !== sequence) fail(`${label} envelope or order is invalid`);
  const signalAnchor = anchors[sequence - 1];
  const executionAnchor = anchors[sequence];
  const outcomeAnchor = anchors[sequence + 1];

  exact(value.commitment_references, [
    "signal_commitment_sequence", "execution_close_commitment_sequence",
    "outcome_close_commitment_sequence", "signal_anchor_manifest_sha256",
    "execution_anchor_manifest_sha256", "outcome_anchor_manifest_sha256",
  ], `${label}.commitment_references`);
  const expectedReferences = {
    signal_commitment_sequence: sequence,
    execution_close_commitment_sequence: sequence + 1,
    outcome_close_commitment_sequence: sequence + 2,
    signal_anchor_manifest_sha256: signalAnchor.manifest_sha256,
    execution_anchor_manifest_sha256: executionAnchor.manifest_sha256,
    outcome_anchor_manifest_sha256: outcomeAnchor.manifest_sha256,
  };
  if (!same(value.commitment_references, expectedReferences)) fail(`${label} breaks N/N+1/N+2 commitment lineage`);

  exact(value.session_dates, [
    "signal_session_date", "execution_close_session_date", "outcome_close_session_date",
  ], `${label}.session_dates`);
  const expectedSessions = {
    signal_session_date: signalAnchor.signal_session_date,
    execution_close_session_date: executionAnchor.signal_session_date,
    outcome_close_session_date: outcomeAnchor.signal_session_date,
  };
  if (!same(value.session_dates, expectedSessions)) fail(`${label} breaks N/N+1/N+2 session lineage`);

  exact(value.adjusted, [
    "source_outcome_private_bundle_sha256", "source_acquisition_sha256",
    "source_index_levels_sha256", "return_start_session_date", "return_end_session_date",
    "same_vintage_gross_returns", "raw_values_used_for_adjusted_theoretical",
  ], `${label}.adjusted`);
  if (value.adjusted.source_outcome_private_bundle_sha256 !== outcomeAnchor.private_bundle_sha256
    || value.adjusted.return_start_session_date !== executionAnchor.signal_session_date
    || value.adjusted.return_end_session_date !== outcomeAnchor.signal_session_date
    || value.adjusted.raw_values_used_for_adjusted_theoretical !== false) {
    fail(`${label} adjusted return is not bound to the outcome commitment's N+1/N+2 same-vintage index`);
  }
  digest(value.adjusted.source_acquisition_sha256, `${label}.adjusted.source_acquisition_sha256`);
  digest(value.adjusted.source_index_levels_sha256, `${label}.adjusted.source_index_levels_sha256`);
  symbols(value.adjusted.same_vintage_gross_returns, `${label}.adjusted.same_vintage_gross_returns`);

  exact(value.raw, [
    "prices", "corporate_actions", "adjusted_values_used_for_raw_cash_equity",
  ], `${label}.raw`);
  exact(value.raw.prices, ["signal", "execution", "outcome"], `${label}.raw.prices`);
  validateRawPricePoint(value.raw.prices.signal, `${label}.raw.prices.signal`, signalAnchor.signal_session_date);
  validateRawPricePoint(value.raw.prices.execution, `${label}.raw.prices.execution`, executionAnchor.signal_session_date);
  validateRawPricePoint(value.raw.prices.outcome, `${label}.raw.prices.outcome`, outcomeAnchor.signal_session_date);
  if (value.raw.adjusted_values_used_for_raw_cash_equity !== false) fail(`${label} contaminates raw cash equity with adjusted values`);
  if (previousLineage) {
    if (!same(value.raw.prices.signal, previousLineage.raw.prices.execution)
      || !same(value.raw.prices.execution, previousLineage.raw.prices.outcome)) {
      fail(`${label} raw N/N+1 overlap is missing, duplicated, reordered, or revised`);
    }
  }
  exact(value.raw.corporate_actions, [
    "quantity_multipliers", "cash_distributions_per_execution_share",
    "reconciliation_receipt_sha256",
  ], `${label}.raw.corporate_actions`);
  symbols(value.raw.corporate_actions.quantity_multipliers, `${label}.raw.corporate_actions.quantity_multipliers`);
  symbols(
    value.raw.corporate_actions.cash_distributions_per_execution_share,
    `${label}.raw.corporate_actions.cash_distributions_per_execution_share`,
    (item, itemLabel) => finite(item, itemLabel, { minimum: 0 }),
  );
  digest(value.raw.corporate_actions.reconciliation_receipt_sha256,
    `${label}.raw.corporate_actions.reconciliation_receipt_sha256`);

  exact(value.verification, [
    "evidence_class", "independently_reconciled", "provider_origin_verified",
    "verification_evidence_sha256",
  ], `${label}.verification`);
  if (value.verification.evidence_class !== LINEAGE_EVIDENCE_CLASS
    || value.verification.independently_reconciled !== true
    || value.verification.provider_origin_verified !== true) {
    fail(`${label} lacks independently reconciled outcome price provenance`);
  }
  digest(value.verification.verification_evidence_sha256, `${label}.verification.verification_evidence_sha256`);
  digest(value.lineage_sha256, `${label}.lineage_sha256`);
  if (value.lineage_sha256 !== sha256(lineageBody(value))) fail(`${label} self-hash is invalid`);
  return value;
}

function validateOrderedArray(value, count, label, sequenceOf) {
  if (!Array.isArray(value) || value.length !== count) fail(`${label} must contain exactly ${count} entries`);
  const seen = new Set();
  value.forEach((item, index) => {
    const sequence = sequenceOf(item);
    if (seen.has(sequence)) fail(`${label} contains duplicate sequence ${sequence}`);
    seen.add(sequence);
    if (sequence !== index + 1) fail(`${label} is missing, duplicated, or out of order at sequence ${index + 1}`);
  });
}

export function validateProspectiveAttempt114SettlementInput(input) {
  exact(input, [
    "schema_version", "attempt_id", "protocol_sha256", "sample_contract",
    "anchor_manifests", "anchor_verification_receipts", "outcome_price_lineages", "authority",
  ], "Attempt 114 settlement input");
  if (input.schema_version !== ATTEMPT114_SETTLEMENT_INPUT_SCHEMA
    || input.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || input.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256) {
    fail("Attempt 114 settlement input envelope differs from the frozen protocol");
  }
  exact(input.sample_contract, Object.keys(EXPECTED_SAMPLE_CONTRACT), "Attempt 114 sample contract");
  if (!same(input.sample_contract, EXPECTED_SAMPLE_CONTRACT)) {
    fail("Attempt 114 sample contract permits replacement, backfill, optional stopping, or a non-first window");
  }
  exact(input.authority, Object.keys(AUTHORITY), "Attempt 114 settlement authority");
  if (!same(input.authority, AUTHORITY)) fail("Attempt 114 settlement input authorizes mutation or persistence");

  validateOrderedArray(input.anchor_manifests, REQUIRED_COMMITMENTS,
    "Attempt 114 anchor manifests", (item) => item?.commitment_sequence);
  validateOrderedArray(input.anchor_verification_receipts, REQUIRED_COMMITMENTS,
    "Attempt 114 anchor receipts", (item) => item?.commitment_sequence);
  validateOrderedArray(input.outcome_price_lineages, REQUIRED_SETTLEMENTS,
    "Attempt 114 outcome price lineages", (item) => item?.settlement_sequence);

  let previousAnchor = null;
  for (let index = 0; index < REQUIRED_COMMITMENTS; index += 1) {
    const anchor = validateAnchorManifest(input.anchor_manifests[index], index + 1, previousAnchor);
    validateAnchorReceipt(input.anchor_verification_receipts[index], anchor, index + 1);
    previousAnchor = anchor;
  }
  let previousLineage = null;
  for (let index = 0; index < REQUIRED_SETTLEMENTS; index += 1) {
    const lineage = validatePriceLineage(
      input.outcome_price_lineages[index],
      index + 1,
      input.anchor_manifests,
      previousLineage,
    );
    previousLineage = lineage;
  }
  return input;
}

function initialAdjustedState() {
  return Object.fromEntries(ATTEMPT114_BOOK_IDS.map((id) => [id, {
    equity: INITIAL_EQUITY,
    weights: { SPY: 0, BIL: 1 },
  }]));
}

function bookAction(bookId, sequence, anchor, priorWeights) {
  if (bookId === "incumbent_tsmom_ensemble_vol") {
    return anchor.action === "REBALANCE"
      ? { action: "REBALANCE", weights: { ...anchor.target_weights } }
      : { action: "HOLD", weights: { ...priorWeights } };
  }
  if (bookId === "spy_buy_hold") {
    return sequence === 1
      ? { action: "REBALANCE", weights: { SPY: 1, BIL: 0 } }
      : { action: "HOLD", weights: { ...priorWeights } };
  }
  return { action: "HOLD", weights: { ...priorWeights } };
}

function adjustedBookRow(bookId, sequence, anchor, lineage, prior) {
  const action = bookAction(bookId, sequence, anchor, prior.weights);
  const evaluationWeights = action.weights;
  const grossReturns = lineage.adjusted.same_vintage_gross_returns;
  const absoluteLegWeights = Object.fromEntries(SYMBOLS.map((symbol) => [
    symbol,
    Math.abs(evaluationWeights[symbol] - prior.weights[symbol]),
  ]));
  const costByLeg = Object.fromEntries(SYMBOLS.map((symbol) => [
    symbol,
    absoluteLegWeights[symbol] * COST_BPS / 10_000,
  ]));
  const turnover = absoluteLegWeights.SPY + absoluteLegWeights.BIL;
  const cost = costByLeg.SPY + costByLeg.BIL;
  const grossReturn = SYMBOLS.reduce(
    (sum, symbol) => sum + evaluationWeights[symbol] * (grossReturns[symbol] - 1),
    0,
  );
  const netReturn = grossReturn - cost;
  if (!(1 + grossReturn > 0) || !(1 + netReturn > 0)) fail(`${bookId} adjusted multiplier is nonpositive at ${sequence}`);
  if (action.action === "HOLD" && (turnover !== 0 || cost !== 0)) fail(`${bookId} HOLD creates turnover at ${sequence}`);
  const closingWeights = Object.fromEntries(SYMBOLS.map((symbol) => [
    symbol,
    evaluationWeights[symbol] * grossReturns[symbol] / (1 + grossReturn),
  ]));
  const closingEquity = prior.equity * (1 + netReturn);
  const row = {
    book_id: bookId,
    committed_action: action.action,
    pretrade_weights: { ...prior.weights },
    evaluation_weights: { ...evaluationWeights },
    same_vintage_asset_gross_returns: { ...grossReturns },
    absolute_traded_leg_weights: absoluteLegWeights,
    absolute_traded_leg_cost_returns: costByLeg,
    turnover_notional: turnover,
    modeled_cost_return: cost,
    opening_equity: prior.equity,
    gross_simple_return: grossReturn,
    net_simple_return: netReturn,
    closing_equity: closingEquity,
    closing_weights: closingWeights,
  };
  return { row, next: { equity: closingEquity, weights: closingWeights } };
}

function settlementLineageSummary(sequence, inputLineage, anchors) {
  return {
    signal_commitment_sequence: sequence,
    execution_close_commitment_sequence: sequence + 1,
    outcome_close_commitment_sequence: sequence + 2,
    signal_anchor_manifest_sha256: anchors[sequence - 1].manifest_sha256,
    execution_anchor_manifest_sha256: anchors[sequence].manifest_sha256,
    outcome_anchor_manifest_sha256: anchors[sequence + 1].manifest_sha256,
    outcome_price_lineage_sha256: inputLineage.lineage_sha256,
    signal_session_date: inputLineage.session_dates.signal_session_date,
    return_start_session_date: inputLineage.session_dates.execution_close_session_date,
    return_end_session_date: inputLineage.session_dates.outcome_close_session_date,
  };
}

function buildAdjustedSettlement(sequence, anchor, lineage, anchors, state) {
  const books = {};
  const nextState = {};
  for (const bookId of ATTEMPT114_BOOK_IDS) {
    const settled = adjustedBookRow(bookId, sequence, anchor, lineage, state[bookId]);
    books[bookId] = settled.row;
    nextState[bookId] = settled.next;
  }
  exactBookIds(books, `adjusted settlement ${sequence} books`);
  const body = {
    schema_version: ATTEMPT114_ADJUSTED_SETTLEMENT_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    sequence,
    entry_kind: "ADJUSTED_THEORETICAL_SETTLEMENT",
    evidence_class: "PROSPECTIVE_ADJUSTED_THEORETICAL_ACCOUNTING",
    lineage: settlementLineageSummary(sequence, lineage, anchors),
    books,
    authority: { ...AUTHORITY },
  };
  return {
    settlement: deepFreeze({ ...body, settlement_sha256: sha256(body) }),
    nextState,
  };
}

function initialPaperState(executionPrices) {
  return Object.fromEntries(ATTEMPT114_BOOK_IDS.map((id) => {
    const bilQuantity = floorQuantity(INITIAL_EQUITY / executionPrices.BIL);
    return [id, {
      holdings: { SPY: 0, BIL: bilQuantity },
      cash: rounded(INITIAL_EQUITY - bilQuantity * executionPrices.BIL, 9),
    }];
  }));
}

function rawEquity(state, prices) {
  return state.cash + state.holdings.SPY * prices.SPY + state.holdings.BIL * prices.BIL;
}

function holdingsStrings(holdings) {
  return Object.fromEntries(SYMBOLS.map((symbol) => [symbol, quantityString(holdings[symbol])]));
}

function rawPositionWeights(state, prices) {
  const equity = rawEquity(state, prices);
  return Object.fromEntries(SYMBOLS.map((symbol) => [symbol, state.holdings[symbol] * prices[symbol] / equity]));
}

function paperBookRow(bookId, sequence, anchor, lineage, prior) {
  const executionPrices = lineage.raw.prices.execution.prices;
  const outcomePrices = lineage.raw.prices.outcome.prices;
  const openingEquity = rawEquity(prior, executionPrices);
  if (!(openingEquity > 0)) fail(`${bookId} raw opening equity is nonpositive at ${sequence}`);
  const pretradeWeights = rawPositionWeights(prior, executionPrices);
  const theoreticalPriorWeights = {
    SPY: pretradeWeights.SPY,
    BIL: 1 - pretradeWeights.SPY,
  };
  const action = bookAction(bookId, sequence, anchor, theoreticalPriorWeights);
  let holdingsAfterExecution = { ...prior.holdings };
  let cashAfterExecution = prior.cash;
  let preview = null;
  if (action.action === "REBALANCE") {
    preview = buildEquityShadowExecution({
      holdings: holdingsStrings(prior.holdings),
      cash: rounded(prior.cash, 9),
      prices: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, rounded(executionPrices[symbol], 9)])),
      target_weights: action.weights,
      asset_eligibility: {
        SPY: { tradable: true, fractionable: true },
        BIL: { tradable: true, fractionable: true },
      },
      cost_model: {
        slippage_bps: 0,
        transaction_cost_bps: COST_BPS,
        regulatory_sell_fee_bps: 0,
      },
      reported_equity: rounded(openingEquity, 9),
    });
    if (!new Set(["ready", "ready_with_residual_drift", "no_trade", "no_executable_orders"]).has(preview.status)
      || preview.order_plan.broker_mutation_authorized !== false
      || preview.preview_only !== true
      || preview.non_broker_theory.used_for_order_sizing !== false
      || preview.non_broker_theory.used_for_broker_cash_equity !== false) {
      fail(`${bookId} raw shadow preview is blocked or contaminates ledger separation at ${sequence}`);
    }
    holdingsAfterExecution = Object.fromEntries(SYMBOLS.map((symbol) => [
      symbol,
      Number(preview.broker_cash_equity.holdings_after_preview[symbol]),
    ]));
    cashAfterExecution = preview.broker_cash_equity.cash_after_preview;
  }

  const absoluteNotional = { SPY: 0, BIL: 0 };
  const costByLeg = { SPY: 0, BIL: 0 };
  for (const order of preview?.order_plan.orders ?? []) {
    absoluteNotional[order.symbol] += order.modeled_execution_notional;
    costByLeg[order.symbol] += order.modeled_transaction_cost;
    const expectedCost = order.modeled_execution_notional * COST_BPS / 10_000;
    if (Math.abs(order.modeled_transaction_cost - expectedCost) > 1e-7) {
      fail(`${bookId} raw shadow cost is not five basis points per absolute traded leg at ${sequence}`);
    }
  }
  if (action.action === "HOLD" && preview !== null) fail(`${bookId} HOLD invoked a rebalance preview at ${sequence}`);

  const multipliers = lineage.raw.corporate_actions.quantity_multipliers;
  const distributions = lineage.raw.corporate_actions.cash_distributions_per_execution_share;
  const closingHoldings = Object.fromEntries(SYMBOLS.map((symbol) => [
    symbol,
    rounded(holdingsAfterExecution[symbol] * multipliers[symbol], 9),
  ]));
  const distributionCash = SYMBOLS.reduce(
    (sum, symbol) => sum + holdingsAfterExecution[symbol] * distributions[symbol],
    0,
  );
  const closingCash = rounded(cashAfterExecution + distributionCash, 9);
  const closingState = { holdings: closingHoldings, cash: closingCash };
  const closingEquity = rawEquity(closingState, outcomePrices);
  if (!(closingEquity > 0)) fail(`${bookId} raw closing equity is nonpositive at ${sequence}`);
  const rawNetReturn = closingEquity / openingEquity - 1;
  const row = {
    book_id: bookId,
    committed_action: action.action,
    valuation_basis: "cash_plus_quantity_times_broker_raw_price",
    opening_raw_prices: { ...executionPrices },
    outcome_raw_prices: { ...outcomePrices },
    holdings_before: holdingsStrings(prior.holdings),
    cash_before: prior.cash,
    calculated_opening_equity: openingEquity,
    raw_order_sizing_target_weights: action.action === "REBALANCE" ? { ...action.weights } : null,
    absolute_traded_leg_notional_usd: absoluteNotional,
    modeled_five_bp_cost_by_leg_usd: costByLeg,
    shadow_execution_preview: preview,
    holdings_after_execution: holdingsStrings(holdingsAfterExecution),
    cash_after_execution: cashAfterExecution,
    corporate_action_quantity_multipliers: { ...multipliers },
    corporate_action_cash_distributions_per_execution_share: { ...distributions },
    corporate_action_cash_received: distributionCash,
    closing_holdings: holdingsStrings(closingHoldings),
    closing_cash: closingCash,
    calculated_closing_equity: closingEquity,
    raw_net_simple_return: rawNetReturn,
    adjusted_theoretical_value_used_for_order_sizing: false,
    adjusted_theoretical_value_used_for_cash_equity: false,
    broker_execution_verified: false,
  };
  return { row, next: closingState };
}

function buildPaperEntry(sequence, anchor, lineage, anchors, state) {
  const books = {};
  const nextState = {};
  for (const bookId of ATTEMPT114_BOOK_IDS) {
    const settled = paperBookRow(bookId, sequence, anchor, lineage, state[bookId]);
    books[bookId] = settled.row;
    nextState[bookId] = settled.next;
  }
  exactBookIds(books, `paper entry ${sequence} books`);
  const body = {
    schema_version: ATTEMPT114_PAPER_ENTRY_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    sequence,
    entry_kind: "ALPACA_RAW_PAPER_CASH_EQUITY_PREVIEW",
    evidence_class: ATTEMPT114_PROTOCOL.ledgers.alpaca_paper_cash_equity.evidence_class,
    lineage: settlementLineageSummary(sequence, lineage, anchors),
    books,
    authority: { ...AUTHORITY },
  };
  return {
    entry: deepFreeze({ ...body, entry_sha256: sha256(body) }),
    nextState,
  };
}

function buildIntervalBundle(sequence, adjusted, paper, lineage) {
  const body = {
    schema_version: ATTEMPT114_INTERVAL_BUNDLE_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    sequence,
    entry_kind: "JOINT_INTERVAL_HASH_BINDING",
    outcome_price_lineage_sha256: lineage.lineage_sha256,
    adjusted_theoretical_settlement_sha256: adjusted.settlement_sha256,
    alpaca_paper_cash_equity_entry_sha256: paper.entry_sha256,
    ledgers_independently_accounted: true,
    broker_mutation_authorized: false,
  };
  return deepFreeze({ ...body, bundle_sha256: sha256(body) });
}

function settlementWindowBody(value) {
  return {
    schema_version: value.schema_version,
    attempt_id: value.attempt_id,
    protocol_sha256: value.protocol_sha256,
    entry_kind: value.entry_kind,
    sample: value.sample,
    adjusted_theoretical_settlements: value.adjusted_theoretical_settlements,
    alpaca_paper_cash_equity_entries: value.alpaca_paper_cash_equity_entries,
    interval_bundles: value.interval_bundles,
    finalization_gate: value.finalization_gate,
    authority: value.authority,
  };
}

export function buildProspectiveAttempt114SettlementWindow(input) {
  validateProspectiveAttempt114SettlementInput(input);
  let adjustedState = initialAdjustedState();
  let paperState = initialPaperState(input.outcome_price_lineages[0].raw.prices.execution.prices);
  const adjustedSettlements = [];
  const paperEntries = [];
  const bundles = [];
  for (let index = 0; index < REQUIRED_SETTLEMENTS; index += 1) {
    const sequence = index + 1;
    const anchor = input.anchor_manifests[index];
    const lineage = input.outcome_price_lineages[index];
    const adjusted = buildAdjustedSettlement(sequence, anchor, lineage, input.anchor_manifests, adjustedState);
    adjustedState = adjusted.nextState;
    const paper = buildPaperEntry(sequence, anchor, lineage, input.anchor_manifests, paperState);
    paperState = paper.nextState;
    adjustedSettlements.push(adjusted.settlement);
    paperEntries.push(paper.entry);
    bundles.push(buildIntervalBundle(sequence, adjusted.settlement, paper.entry, lineage));
  }
  const body = {
    schema_version: ATTEMPT114_SETTLEMENT_WINDOW_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    entry_kind: "COMPLETE_SETTLEMENT_ACCOUNTING_PREVIEW",
    sample: {
      ...EXPECTED_SAMPLE_CONTRACT,
      settlements_emitted: adjustedSettlements.length,
      commitments_after_254_used: false,
      settlements_after_252_used: false,
    },
    adjusted_theoretical_settlements: adjustedSettlements,
    alpaca_paper_cash_equity_entries: paperEntries,
    interval_bundles: bundles,
    finalization_gate: {
      exact_first_254_commitment_anchors_present: true,
      exact_first_252_settlements_present: true,
      independent_anchor_receipt_claims_complete: true,
      outcome_price_lineage_receipt_claims_complete: true,
      external_signature_reverification_performed_by_this_module: false,
      runtime_publication_independently_verified_by_this_module: false,
      adjusted_and_raw_ledgers_separated: true,
      complete_accounting_window: true,
      inference_authorized: false,
      settlement_persistence_authorized: false,
    },
    authority: { ...AUTHORITY },
  };
  return deepFreeze({ ...body, window_sha256: sha256(body) });
}

export function canonicalProspectiveAttempt114SettlementWindowJson(value) {
  exact(value, [
    "schema_version", "attempt_id", "protocol_sha256", "entry_kind", "sample",
    "adjusted_theoretical_settlements", "alpaca_paper_cash_equity_entries",
    "interval_bundles", "finalization_gate", "authority", "window_sha256",
  ], "Attempt 114 settlement window");
  if (value.schema_version !== ATTEMPT114_SETTLEMENT_WINDOW_SCHEMA
    || value.attempt_id !== ATTEMPT114_PROTOCOL_ID
    || value.protocol_sha256 !== ATTEMPT114_PROTOCOL_SHA256
    || value.entry_kind !== "COMPLETE_SETTLEMENT_ACCOUNTING_PREVIEW"
    || value.window_sha256 !== sha256(settlementWindowBody(value))) {
    fail("Attempt 114 settlement window envelope or self-hash is invalid");
  }
  return `${stableStringify(value)}\n`;
}
