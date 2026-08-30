import { sha256, stableStringify } from "../../lib/canonical.mjs";
import { validateAttempt115GitHubPublicationReceipt } from "../../scripts/verify_attempt115_github_publication.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
} from "./policy.mjs";
import { ATTEMPT115_ID, ATTEMPT115_PROTOCOL_SHA256 } from "./protocol.mjs";
import {
  ATTEMPT115_REQUIRED_INTERVALS,
  ATTEMPT115_REQUIRED_SOURCE_BUNDLES,
  validateAttempt115PairedSettlementWindow,
  validateAttempt115PairedSettlementWindowAgainstInputs,
} from "./settlement.mjs";

export const ATTEMPT115_FINALIZATION_GATE_SCHEMA =
  "finly_attempt115_finalization_gate.v1";
export const ATTEMPT115_PRIMARY_INFERENCE_SCHEMA =
  "finly_attempt115_primary_inference.v1";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BOOTSTRAP_SEED = 20260829;
const BOOTSTRAP_RESAMPLES = 4_999;
const EXPECTED_BLOCK_SESSIONS = 20;
const RESTART_PROBABILITY = 1 / EXPECTED_BLOCK_SESSIONS;
const ALPHA = 0.05;
const FINALIZATION_COUNTS = Object.freeze({
  validated_forward_source_bundles: ATTEMPT115_REQUIRED_SOURCE_BUNDLES,
  strict_open_assurance_receipts: ATTEMPT115_REQUIRED_INTERVALS,
  outcome_only_standard_forward_receipts: 1,
  target_commitments: ATTEMPT115_REQUIRED_INTERVALS,
  paired_next_open_intervals: ATTEMPT115_REQUIRED_INTERVALS,
});
const FINALIZATION_VERIFICATION = Object.freeze({
  protocol_runtime_publication_verified_strictly_before_first_signal_close: true,
  all_source_private_bundles_reopened_and_revalidated: true,
  all_forward_public_anchors_revalidated: true,
  all_first_252_input_workflows_completed_strictly_before_their_next_market_opens: true,
  all_strict_open_receipts_revalidated: true,
  persisted_provider_calendar_sequence_reconciled: true,
  independent_official_calendar_verified: false,
  declared_provider_response_lineage_reconciled: true,
  cryptographic_provider_origin_verified: false,
  targets_rederived_from_frozen_sources_with_zero_overrides: true,
  adjusted_and_raw_execution_books_separated: true,
  paired_ledger_full_chain_reopened: true,
  exact_first_252_intervals_used: true,
  optional_stopping_used: false,
  replacement_window_used: false,
  interim_inference_used: false,
  repeat_confirmatory_test_used: false,
});
const FINALIZATION_EVIDENCE_KEYS = Object.freeze([
  "protocol_runtime_publication_receipt_sha256",
  "strict_open_receipt_chain_sha256",
  "source_projection_chain_sha256",
  "provider_calendar_reconciliation_sha256",
  "provider_price_lineage_reconciliation_sha256",
  "paired_settlement_window_sha256",
  "full_reopen_receipt_sha256",
]);

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
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function same(left, right, label) {
  if (stableStringify(left) !== stableStringify(right)) fail(`${label} changed`);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function gateBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "gate_sha256"));
}

function inferenceBody(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "result_sha256"));
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

function deriveFinalizationEvidenceHashes({ publicationReceipt, sourceRecords, settlementWindow }) {
  validateAttempt115GitHubPublicationReceipt(publicationReceipt);
  validateAttempt115PairedSettlementWindowAgainstInputs(settlementWindow, { sourceRecords });
  if (!Array.isArray(sourceRecords)
    || sourceRecords.length !== ATTEMPT115_REQUIRED_SOURCE_BUNDLES) {
    fail("Attempt 115 finalization requires exactly 253 full source records");
  }
  const strictOpenHashes = sourceRecords.slice(0, ATTEMPT115_REQUIRED_INTERVALS)
    .map((record, index) => {
      const hash = record.strictOpenReceipt?.receipt_sha256;
      return digest(hash, `Attempt 115 strict-open receipt ${index + 1}`);
    });
  if (sourceRecords.at(-1)?.strictOpenReceipt !== null) {
    fail("Attempt 115 source 253 is outcome-only and must not claim strict-open assurance");
  }
  const calendarReceipts = sourceRecords.slice(0, ATTEMPT115_REQUIRED_INTERVALS)
    .map((record, index) => {
      const receipt = record.strictOpenReceipt?.provider_calendar_reconciliation;
      digest(receipt?.receipt_sha256, `Attempt 115 calendar receipt ${index + 1}`);
      return receipt;
    });
  const declaredProviderLineage = sourceRecords.map((record, index) => {
    const acquisition = record.commitment?.payload?.acquisition;
    const adjusted = acquisition?.source?.adjusted;
    const raw = acquisition?.source?.raw;
    for (const [book, evidence] of [["adjusted", adjusted], ["raw", raw]]) {
      digest(evidence?.request_parameters_sha256,
        `Attempt 115 source ${index + 1} ${book} request hash`);
      digest(evidence?.response_content_sha256,
        `Attempt 115 source ${index + 1} ${book} response hash`);
    }
    return {
      sequence: index + 1,
      acquisition_sha256: digest(
        acquisition?.acquisition_sha256,
        `Attempt 115 source ${index + 1} acquisition hash`,
      ),
      adjusted_request_sha256: adjusted.request_parameters_sha256,
      adjusted_response_sha256: adjusted.response_content_sha256,
      raw_request_sha256: raw.request_parameters_sha256,
      raw_response_sha256: raw.response_content_sha256,
    };
  });
  const reopenedSourceIdentity = sourceRecords.map((record, index) => ({
    sequence: index + 1,
    private_bundle_sha256: digest(
      record.commitment?.commitment_sha256,
      `Attempt 115 private bundle ${index + 1}`,
    ),
    public_anchor_manifest_sha256: digest(
      record.anchor?.manifest_sha256,
      `Attempt 115 public anchor ${index + 1}`,
    ),
    forward_receipt_sha256: digest(
      record.forwardReceipt?.receipt_sha256,
      `Attempt 115 forward receipt ${index + 1}`,
    ),
  }));
  return Object.freeze({
    protocol_runtime_publication_receipt_sha256: digest(
      publicationReceipt.receipt_sha256,
      "Attempt 115 protocol/runtime publication receipt",
    ),
    strict_open_receipt_chain_sha256: sha256(strictOpenHashes),
    source_projection_chain_sha256:
      settlementWindow.source_chain.ordered_projection_chain_sha256,
    provider_calendar_reconciliation_sha256: sha256(calendarReceipts),
    provider_price_lineage_reconciliation_sha256: sha256(declaredProviderLineage),
    paired_settlement_window_sha256: settlementWindow.window_sha256,
    full_reopen_receipt_sha256: sha256({
      reopened_source_identity: reopenedSourceIdentity,
      strict_open_receipt_chain_sha256: sha256(strictOpenHashes),
      provider_calendar_reconciliation_sha256: sha256(calendarReceipts),
      provider_price_lineage_reconciliation_sha256: sha256(declaredProviderLineage),
      paired_settlement_window_sha256: settlementWindow.window_sha256,
    }),
  });
}

function finalizationGateBody({ publicationReceipt, sourceRecords, settlementWindow }) {
  const evidenceHashes = deriveFinalizationEvidenceHashes({
    publicationReceipt,
    sourceRecords,
    settlementWindow,
  });
  const body = {
    schema_version: ATTEMPT115_FINALIZATION_GATE_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    state: "COMPLETE_FINALIZATION_VERIFIED",
    verified_counts: { ...FINALIZATION_COUNTS },
    verification: { ...FINALIZATION_VERIFICATION },
    evidence_hashes: { ...evidenceHashes },
    authority: {
      research_only: true,
      broker_mutation_authorized: false,
      order_payload: null,
      inference_authorized_once: true,
      repeat_inference_authorized: false,
    },
  };
  return body;
}

function validateAttempt115FinalizationGateStructure(value) {
  exact(value, [
    "schema_version", "attempt_id", "protocol_sha256", "state", "verified_counts",
    "verification", "evidence_hashes", "authority", "gate_sha256",
  ], "Attempt 115 finalization gate");
  if (value.schema_version !== ATTEMPT115_FINALIZATION_GATE_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || value.protocol_sha256 !== ATTEMPT115_PROTOCOL_SHA256
    || value.state !== "COMPLETE_FINALIZATION_VERIFIED") {
    fail("Attempt 115 finalization gate envelope is invalid");
  }
  same(value.verified_counts, FINALIZATION_COUNTS, "Attempt 115 finalization counts");
  same(value.verification, FINALIZATION_VERIFICATION, "Attempt 115 finalization verification");
  exact(value.evidence_hashes, FINALIZATION_EVIDENCE_KEYS,
    "Attempt 115 finalization evidence hashes");
  for (const key of FINALIZATION_EVIDENCE_KEYS) {
    digest(value.evidence_hashes[key], `Attempt 115 finalization ${key}`);
  }
  same(value.authority, {
    research_only: true,
    broker_mutation_authorized: false,
    order_payload: null,
    inference_authorized_once: true,
    repeat_inference_authorized: false,
  }, "Attempt 115 finalization authority");
  digest(value.gate_sha256, "Attempt 115 finalization gate hash");
  if (value.gate_sha256 !== sha256(gateBody(value))) {
    fail("Attempt 115 finalization gate self-hash is invalid");
  }
  return value;
}

export function buildAttempt115FinalizationGate({
  publicationReceipt,
  sourceRecords,
  settlementWindow,
}) {
  const body = finalizationGateBody({ publicationReceipt, sourceRecords, settlementWindow });
  const gate = {
    ...body,
    gate_sha256: sha256(body),
  };
  return deepFreeze(validateAttempt115FinalizationGateStructure(gate));
}

export function validateAttempt115FinalizationGate(value, {
  publicationReceipt,
  sourceRecords,
  settlementWindow,
} = {}) {
  validateAttempt115FinalizationGateStructure(value);
  if (publicationReceipt === undefined
    || sourceRecords === undefined
    || settlementWindow === undefined) {
    fail("Attempt 115 finalization gate requires the actual input-bound evidence");
  }
  const expectedBody = finalizationGateBody({
    publicationReceipt,
    sourceRecords,
    settlementWindow,
  });
  const expected = { ...expectedBody, gate_sha256: sha256(expectedBody) };
  same(value, expected, "Attempt 115 input-bound finalization gate");
  return value;
}

function primaryCell(window) {
  const matches = window.cells.filter((cell) => cell.cell_id === window.primary_cell_id);
  if (matches.length !== 1) fail("Attempt 115 settlement window has no unique primary cell");
  const cell = matches[0];
  if (cell.execution_book !== "adjusted"
    || cell.rebalance_anchor !== 0
    || cell.one_way_cost_bps !== 5) {
    fail("Attempt 115 primary cell differs from the frozen endpoint");
  }
  return cell;
}

function recomputePairedValues(cell) {
  const incumbent = cell.rows[ATTEMPT115_INCUMBENT_POLICY_ID];
  const challenger = cell.rows[ATTEMPT115_CHALLENGER_POLICY_ID];
  if (incumbent.length !== ATTEMPT115_REQUIRED_INTERVALS
    || challenger.length !== ATTEMPT115_REQUIRED_INTERVALS) {
    fail("Attempt 115 primary paired rows are incomplete");
  }
  return incumbent.map((incumbentRow, index) => {
    const challengerRow = challenger[index];
    if (incumbentRow.sequence !== index + 1 || challengerRow.sequence !== index + 1
      || incumbentRow.signal_date !== challengerRow.signal_date
      || incumbentRow.execution_date !== challengerRow.execution_date
      || incumbentRow.net_return <= -1 || challengerRow.net_return <= -1) {
      fail("Attempt 115 primary paired rows are not exactly aligned");
    }
    return Math.log1p(challengerRow.net_return) - Math.log1p(incumbentRow.net_return);
  });
}

export function runAttempt115FrozenPrimaryBootstrap(dailyValues) {
  if (!Array.isArray(dailyValues)
    || dailyValues.length !== ATTEMPT115_REQUIRED_INTERVALS) {
    fail("Attempt 115 frozen bootstrap requires exactly 252 paired daily values");
  }
  dailyValues.forEach((value, index) => finite(value, `Attempt 115 daily value ${index + 1}`));
  const observedSum = dailyValues.reduce((sum, value) => sum + value, 0);
  const observedMean = observedSum / dailyValues.length;
  const centered = dailyValues.map((value) => value - observedMean);
  const random = mulberry32(BOOTSTRAP_SEED);
  let exceedances = 0;
  for (let draw = 0; draw < BOOTSTRAP_RESAMPLES; draw += 1) {
    let source = Math.floor(random() * centered.length);
    let bootstrapSum = 0;
    for (let index = 0; index < centered.length; index += 1) {
      bootstrapSum += centered[source];
      source = random() < RESTART_PROBABILITY
        ? Math.floor(random() * centered.length)
        : (source + 1) % centered.length;
    }
    if (bootstrapSum / centered.length >= observedMean) exceedances += 1;
  }
  const oneSidedPValue = (1 + exceedances) / (BOOTSTRAP_RESAMPLES + 1);
  return deepFreeze({
    observed_sum: observedSum,
    observed_mean: observedMean,
    exceedances,
    one_sided_p_value: oneSidedPValue,
    supports_positive_edge: observedMean > 0 && oneSidedPValue <= ALPHA,
  });
}

export function buildAttempt115PrimaryInference({
  settlementWindow,
  finalizationGate,
  publicationReceipt,
  sourceRecords,
}) {
  exact(
    { settlementWindow, finalizationGate, publicationReceipt, sourceRecords },
    ["settlementWindow", "finalizationGate", "publicationReceipt", "sourceRecords"],
    "Attempt 115 primary inference input");
  validateAttempt115PairedSettlementWindow(settlementWindow);
  validateAttempt115FinalizationGate(finalizationGate, {
    publicationReceipt,
    sourceRecords,
    settlementWindow,
  });
  if (finalizationGate.evidence_hashes.paired_settlement_window_sha256
    !== settlementWindow.window_sha256
    || finalizationGate.evidence_hashes.source_projection_chain_sha256
      !== settlementWindow.source_chain.ordered_projection_chain_sha256) {
    fail("Attempt 115 finalization gate does not bind the settlement source and window");
  }
  const cell = primaryCell(settlementWindow);
  const dailyValues = recomputePairedValues(cell);
  if (cell.paired_daily_net_log_return_differences_sha256 !== sha256(dailyValues)
    || settlementWindow.primary_endpoint_values_sha256 !== sha256(dailyValues)) {
    fail("Attempt 115 stored endpoint differs from the paired policy ledgers");
  }
  const bootstrapResult = runAttempt115FrozenPrimaryBootstrap(dailyValues);
  const observedSum = bootstrapResult.observed_sum;
  const observedMean = bootstrapResult.observed_mean;
  const exceedances = bootstrapResult.exceedances;
  const pValue = bootstrapResult.one_sided_p_value;
  const supportsPositiveEdge = bootstrapResult.supports_positive_edge;
  const body = {
    schema_version: ATTEMPT115_PRIMARY_INFERENCE_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    evidence_class: "PROSPECTIVE_CONFIRMATORY_RESULT_CONDITIONAL_ON_COMPLETE_FINALIZATION",
    role: "SOLE_PRIMARY_CONFIRMATORY_ENDPOINT",
    endpoint: "mean paired daily net log-return difference",
    null_hypothesis: "mean paired daily net log-return difference <= 0",
    alternative_hypothesis: "mean paired daily net log-return difference > 0",
    sample: {
      intervals: dailyValues.length,
      first_signal_session: cell.rows[ATTEMPT115_INCUMBENT_POLICY_ID][0].signal_date,
      first_execution_session: cell.rows[ATTEMPT115_INCUMBENT_POLICY_ID][0].execution_date,
      last_signal_session: cell.rows[ATTEMPT115_INCUMBENT_POLICY_ID].at(-1).signal_date,
      last_execution_session: cell.rows[ATTEMPT115_INCUMBENT_POLICY_ID].at(-1).execution_date,
      settlement_window_sha256: settlementWindow.window_sha256,
      paired_daily_values_sha256: sha256(dailyValues),
    },
    observed: {
      sum_paired_net_log_return_difference: observedSum,
      mean_paired_daily_net_log_return_difference: observedMean,
    },
    bootstrap: {
      test: "one-sided null-centered stationary circular block bootstrap",
      null_centered: true,
      centering_formula: "daily_value - observed_mean",
      prng: "mulberry32_uint32",
      circular_blocks: true,
      seed_uint32: BOOTSTRAP_SEED,
      resamples: BOOTSTRAP_RESAMPLES,
      expected_block_sessions: EXPECTED_BLOCK_SESSIONS,
      restart_probability: RESTART_PROBABILITY,
      restart_draw_consumed_after_final_observation: true,
      restart_index_draw_consumed_when_triggered_after_final_observation: true,
      equality_counts_as_exceedance: true,
      exceedances,
      one_sided_p_value: pValue,
    },
    decision: {
      alpha: ALPHA,
      rejection_rule: "observed_mean > 0 and one_sided_p_value <= alpha",
      supports_positive_net_log_return_edge: supportsPositiveEdge,
      conclusion: supportsPositiveEdge
        ? "PRIMARY_SUPPORTS_POSITIVE_NET_LOG_RETURN_EDGE_OF_DOWNSIDE_SEMIVOL_OVER_FROZEN_INCUMBENT_ON_FROZEN_WINDOW"
        : "PRIMARY_DOES_NOT_SUPPORT_POSITIVE_NET_LOG_RETURN_EDGE_OVER_FROZEN_INCUMBENT",
      result_changes_or_promotes_incumbent: false,
    },
    assurance: {
      finalization_gate_sha256: finalizationGate.gate_sha256,
      source_projection_chain_sha256:
        settlementWindow.source_chain.ordered_projection_chain_sha256,
      adjusted_anchor_zero_five_bps_is_only_inference_source: true,
      raw_and_sensitivity_cells_excluded: true,
      interim_inference_used: false,
      repeat_confirmatory_test_permitted: false,
      broker_mutation_authorized: false,
    },
  };
  return deepFreeze(validateAttempt115PrimaryInference({
    ...body,
    result_sha256: sha256(body),
  }));
}

export function validateAttempt115PrimaryInference(value) {
  exact(value, [
    "schema_version", "attempt_id", "protocol_sha256", "evidence_class", "role",
    "endpoint", "null_hypothesis", "alternative_hypothesis", "sample", "observed",
    "bootstrap", "decision", "assurance", "result_sha256",
  ], "Attempt 115 primary inference");
  if (value.schema_version !== ATTEMPT115_PRIMARY_INFERENCE_SCHEMA
    || value.attempt_id !== ATTEMPT115_ID
    || value.protocol_sha256 !== ATTEMPT115_PROTOCOL_SHA256
    || value.evidence_class
      !== "PROSPECTIVE_CONFIRMATORY_RESULT_CONDITIONAL_ON_COMPLETE_FINALIZATION"
    || value.role !== "SOLE_PRIMARY_CONFIRMATORY_ENDPOINT"
    || value.endpoint !== "mean paired daily net log-return difference"
    || value.null_hypothesis !== "mean paired daily net log-return difference <= 0"
    || value.alternative_hypothesis !== "mean paired daily net log-return difference > 0") {
    fail("Attempt 115 primary inference envelope or endpoint changed");
  }
  if (value.sample?.intervals !== ATTEMPT115_REQUIRED_INTERVALS) {
    fail("Attempt 115 primary inference does not use exactly 252 intervals");
  }
  for (const key of ["settlement_window_sha256", "paired_daily_values_sha256"]) {
    digest(value.sample[key], `Attempt 115 primary inference ${key}`);
  }
  finite(value.observed?.sum_paired_net_log_return_difference,
    "Attempt 115 observed sum");
  finite(value.observed?.mean_paired_daily_net_log_return_difference,
    "Attempt 115 observed mean");
  const expectedMean = value.observed.sum_paired_net_log_return_difference
    / ATTEMPT115_REQUIRED_INTERVALS;
  if (Math.abs(expectedMean - value.observed.mean_paired_daily_net_log_return_difference)
    > 1e-15) {
    fail("Attempt 115 observed sum and mean disagree");
  }
  const bootstrap = value.bootstrap;
  if (bootstrap?.test !== "one-sided null-centered stationary circular block bootstrap"
    || bootstrap.null_centered !== true
    || bootstrap.centering_formula !== "daily_value - observed_mean"
    || bootstrap.prng !== "mulberry32_uint32"
    || bootstrap.circular_blocks !== true
    || bootstrap.seed_uint32 !== BOOTSTRAP_SEED
    || bootstrap.resamples !== BOOTSTRAP_RESAMPLES
    || bootstrap.expected_block_sessions !== EXPECTED_BLOCK_SESSIONS
    || bootstrap.restart_probability !== RESTART_PROBABILITY
    || bootstrap.restart_draw_consumed_after_final_observation !== true
    || bootstrap.restart_index_draw_consumed_when_triggered_after_final_observation !== true
    || bootstrap.equality_counts_as_exceedance !== true
    || !Number.isInteger(bootstrap.exceedances)
    || bootstrap.exceedances < 0
    || bootstrap.exceedances > BOOTSTRAP_RESAMPLES
    || bootstrap.one_sided_p_value !== (1 + bootstrap.exceedances) / 5_000) {
    fail("Attempt 115 bootstrap engine or result changed");
  }
  const supports = value.observed.mean_paired_daily_net_log_return_difference > 0
    && bootstrap.one_sided_p_value <= ALPHA;
  if (value.decision?.alpha !== ALPHA
    || value.decision.rejection_rule
      !== "observed_mean > 0 and one_sided_p_value <= alpha"
    || value.decision.supports_positive_net_log_return_edge !== supports
    || value.decision.result_changes_or_promotes_incumbent !== false
    || value.decision.conclusion !== (supports
      ? "PRIMARY_SUPPORTS_POSITIVE_NET_LOG_RETURN_EDGE_OF_DOWNSIDE_SEMIVOL_OVER_FROZEN_INCUMBENT_ON_FROZEN_WINDOW"
      : "PRIMARY_DOES_NOT_SUPPORT_POSITIVE_NET_LOG_RETURN_EDGE_OVER_FROZEN_INCUMBENT")) {
    fail("Attempt 115 primary decision changed");
  }
  if (value.assurance?.adjusted_anchor_zero_five_bps_is_only_inference_source !== true
    || value.assurance.raw_and_sensitivity_cells_excluded !== true
    || value.assurance.interim_inference_used !== false
    || value.assurance.repeat_confirmatory_test_permitted !== false
    || value.assurance.broker_mutation_authorized !== false) {
    fail("Attempt 115 inference assurance boundary changed");
  }
  for (const key of ["finalization_gate_sha256", "source_projection_chain_sha256"]) {
    digest(value.assurance[key], `Attempt 115 inference assurance ${key}`);
  }
  digest(value.result_sha256, "Attempt 115 primary inference hash");
  if (value.result_sha256 !== sha256(inferenceBody(value))) {
    fail("Attempt 115 primary inference self-hash is invalid");
  }
  return value;
}

export function validateAttempt115PrimaryInferenceAgainstInputs(value, inputs) {
  validateAttempt115PrimaryInference(value);
  const expected = buildAttempt115PrimaryInference(inputs);
  same(value, expected, "Attempt 115 input-bound primary inference");
  return value;
}

export function canonicalAttempt115PrimaryInferenceJson(value, inputs) {
  validateAttempt115PrimaryInferenceAgainstInputs(value, inputs);
  return `${stableStringify(value)}\n`;
}
