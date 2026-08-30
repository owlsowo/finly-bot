import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA,
  FORWARD_TRIAL_LIVE_ID,
} from "../research/forward_trial_live_core.mjs";
import {
  ATTEMPT114_PROTOCOL,
  ATTEMPT114_PROTOCOL_ID,
  ATTEMPT114_PROTOCOL_SHA256,
} from "../research/prospective_attempt114/protocol.mjs";
import {
  ATTEMPT114_ADJUSTED_SETTLEMENT_SCHEMA,
  ATTEMPT114_ANCHOR_RECEIPT_SCHEMA,
  ATTEMPT114_BOOK_IDS,
  ATTEMPT114_INTERVAL_BUNDLE_SCHEMA,
  ATTEMPT114_PAPER_ENTRY_SCHEMA,
  ATTEMPT114_PRICE_LINEAGE_SCHEMA,
  ATTEMPT114_SETTLEMENT_INPUT_SCHEMA,
  ATTEMPT114_SETTLEMENT_WINDOW_SCHEMA,
  buildProspectiveAttempt114SettlementWindow,
  canonicalProspectiveAttempt114SettlementWindowJson,
  validateProspectiveAttempt114SettlementInput,
} from "../research/prospective_attempt114/settlement.mjs";

const DAY_MILLISECONDS = 86_400_000;
const AUTHORITY = Object.freeze({
  research_only: true,
  broker_mutation_authorized: false,
  order_payload: null,
  persistence_authorized: false,
});
const SAMPLE = Object.freeze({
  first_commitment_sequence: 1,
  last_commitment_sequence: 254,
  commitment_count: 254,
  first_settlement_sequence: 1,
  last_settlement_sequence: 252,
  settlement_count: 252,
  consecutive_official_sessions_required: true,
  replacement_window_permitted: false,
  backfill_permitted: false,
  optional_stopping_permitted: false,
});

function weekdays(count) {
  const dates = [];
  let timestamp = Date.parse("2026-08-31T00:00:00.000Z");
  while (dates.length < count) {
    const value = new Date(timestamp);
    if (value.getUTCDay() >= 1 && value.getUTCDay() <= 5) dates.push(value.toISOString().slice(0, 10));
    timestamp += DAY_MILLISECONDS;
  }
  return dates;
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

function receiptBody(value) {
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

function prices(index) {
  return {
    SPY: Number((500 * (1.0007 ** index)).toFixed(6)),
    BIL: Number((91 * (1.00008 ** index)).toFixed(6)),
  };
}

function makeAnchors(dates) {
  const anchors = [];
  let target = { SPY: 0, BIL: 1 };
  for (let index = 0; index < 254; index += 1) {
    const sequence = index + 1;
    const action = index % 5 === 0 ? "REBALANCE" : "HOLD";
    if (action === "REBALANCE") {
      const spy = index % 10 === 0 ? 0.6 : 0.35;
      target = { SPY: spy, BIL: 1 - spy };
    }
    const signal = dates[index];
    const next = dates[index + 1];
    const privateBundle = sha256({ private_bundle: sequence });
    const previousPrivateBundle = anchors.at(-1)?.private_bundle_sha256
      ?? ATTEMPT114_PROTOCOL.upstream_capture_binding.activation.activation_sha256;
    const body = {
      schema_version: FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA,
      trial_id: FORWARD_TRIAL_LIVE_ID,
      manifest_kind: "PUBLIC_HASH_ONLY_SIGNAL_ANCHOR",
      commitment_sequence: sequence,
      signal_session_date: signal,
      timing: {
        captured_at: `${signal}T20:16:00.000Z`,
        market_close_at: `${signal}T20:00:00.000Z`,
        bar_eligible_at: `${signal}T20:15:00.000Z`,
        next_session_date: next,
        next_market_close_at: `${next}T20:00:00.000Z`,
        anchor_deadline: `${next}T20:00:00.000Z`,
      },
      formula: {
        implementation: ATTEMPT114_PROTOCOL.policy_binding.implementation,
        policy_id: ATTEMPT114_PROTOCOL.policy_binding.policy_id,
        protocol_sha256: ATTEMPT114_PROTOCOL.policy_binding.protocol_sha256,
        implementation_binding_sha256:
          ATTEMPT114_PROTOCOL.upstream_capture_binding.runtime_manifest.manifest_sha256,
        decision_receipt_sha256: sha256({ decision: sequence }),
      },
      action,
      target_weights: { ...target },
      private_bundle_sha256: privateBundle,
      previous_private_bundle_sha256: previousPrivateBundle,
      authority: { research_only: true, broker_mutation_authorized: false, order_payload: null },
      evaluation_gates: { settlement_enabled: false, inference_enabled: false },
    };
    anchors.push({ ...body, manifest_sha256: sha256(body) });
  }
  return anchors;
}

function makeReceipts(anchors) {
  return anchors.map((anchor) => {
    const body = {
      schema_version: ATTEMPT114_ANCHOR_RECEIPT_SCHEMA,
      attempt_id: ATTEMPT114_PROTOCOL_ID,
      commitment_sequence: anchor.commitment_sequence,
      anchor_manifest_sha256: anchor.manifest_sha256,
      mechanism: "public GitHub Actions/commit publication",
      published_at: `${anchor.signal_session_date}T20:17:00.000Z`,
      anchor_deadline: anchor.timing.anchor_deadline,
      evidence_class: "INDEPENDENT_EXTERNAL_VERIFICATION_RECEIPT",
      verification_evidence_sha256: sha256({ external_anchor: anchor.commitment_sequence }),
      independently_verified: true,
    };
    return { ...body, receipt_sha256: sha256(body) };
  });
}

function makeLineages(anchors) {
  return Array.from({ length: 252 }, (_, index) => {
    const sequence = index + 1;
    const signal = anchors[index];
    const execution = anchors[index + 1];
    const outcome = anchors[index + 2];
    const signalPrices = prices(index);
    const executionPrices = prices(index + 1);
    const outcomePrices = prices(index + 2);
    const body = {
      schema_version: ATTEMPT114_PRICE_LINEAGE_SCHEMA,
      attempt_id: ATTEMPT114_PROTOCOL_ID,
      settlement_sequence: sequence,
      commitment_references: {
        signal_commitment_sequence: sequence,
        execution_close_commitment_sequence: sequence + 1,
        outcome_close_commitment_sequence: sequence + 2,
        signal_anchor_manifest_sha256: signal.manifest_sha256,
        execution_anchor_manifest_sha256: execution.manifest_sha256,
        outcome_anchor_manifest_sha256: outcome.manifest_sha256,
      },
      session_dates: {
        signal_session_date: signal.signal_session_date,
        execution_close_session_date: execution.signal_session_date,
        outcome_close_session_date: outcome.signal_session_date,
      },
      adjusted: {
        source_outcome_private_bundle_sha256: outcome.private_bundle_sha256,
        source_acquisition_sha256: sha256({ acquisition: sequence + 2 }),
        source_index_levels_sha256: sha256({ index_levels: sequence + 2 }),
        return_start_session_date: execution.signal_session_date,
        return_end_session_date: outcome.signal_session_date,
        same_vintage_gross_returns: {
          SPY: outcomePrices.SPY / executionPrices.SPY,
          BIL: outcomePrices.BIL / executionPrices.BIL,
        },
        raw_values_used_for_adjusted_theoretical: false,
      },
      raw: {
        prices: {
          signal: { session_date: signal.signal_session_date, prices: signalPrices },
          execution: { session_date: execution.signal_session_date, prices: executionPrices },
          outcome: { session_date: outcome.signal_session_date, prices: outcomePrices },
        },
        corporate_actions: {
          quantity_multipliers: { SPY: 1, BIL: 1 },
          cash_distributions_per_execution_share: { SPY: 0, BIL: 0 },
          reconciliation_receipt_sha256: sha256({ corporate_actions: sequence }),
        },
        adjusted_values_used_for_raw_cash_equity: false,
      },
      verification: {
        evidence_class: "INDEPENDENT_OUTCOME_PRICE_LINEAGE_RECONCILIATION",
        independently_reconciled: true,
        provider_origin_verified: true,
        verification_evidence_sha256: sha256({ price_lineage: sequence }),
      },
    };
    return { ...body, lineage_sha256: sha256(body) };
  });
}

function fixture() {
  const dates = weekdays(255);
  const anchors = makeAnchors(dates);
  return {
    schema_version: ATTEMPT114_SETTLEMENT_INPUT_SCHEMA,
    attempt_id: ATTEMPT114_PROTOCOL_ID,
    protocol_sha256: ATTEMPT114_PROTOCOL_SHA256,
    sample_contract: { ...SAMPLE },
    anchor_manifests: anchors,
    anchor_verification_receipts: makeReceipts(anchors),
    outcome_price_lineages: makeLineages(anchors),
    authority: { ...AUTHORITY },
  };
}

function rehashAnchor(value) {
  value.manifest_sha256 = sha256(anchorBody(value));
}

function rehashReceipt(value) {
  value.receipt_sha256 = sha256(receiptBody(value));
}

function rehashLineage(value) {
  value.lineage_sha256 = sha256(lineageBody(value));
}

test("settlement window uses exactly first 252 of 254 N/N+1/N+2 records and exact book IDs", () => {
  const input = fixture();
  validateProspectiveAttempt114SettlementInput(input);
  const first = buildProspectiveAttempt114SettlementWindow(input);
  const second = buildProspectiveAttempt114SettlementWindow(structuredClone(input));

  assert.deepEqual(second, first);
  assert.equal(first.schema_version, ATTEMPT114_SETTLEMENT_WINDOW_SCHEMA);
  assert.equal(first.adjusted_theoretical_settlements.length, 252);
  assert.equal(first.alpaca_paper_cash_equity_entries.length, 252);
  assert.equal(first.interval_bundles.length, 252);
  assert.equal(first.adjusted_theoretical_settlements.at(-1).sequence, 252);
  assert.equal(first.adjusted_theoretical_settlements.at(-1).lineage.outcome_close_commitment_sequence, 254);
  assert.equal(first.sample.commitments_after_254_used, false);
  assert.equal(first.sample.settlements_after_252_used, false);
  assert.equal(first.finalization_gate.inference_authorized, false);
  assert.equal(first.finalization_gate.settlement_persistence_authorized, false);
  assert.equal(first.authority.broker_mutation_authorized, false);
  assert.deepEqual(Object.keys(first.adjusted_theoretical_settlements[0].books).sort(), [...ATTEMPT114_BOOK_IDS].sort());
  assert.match(canonicalProspectiveAttempt114SettlementWindowJson(first), /finly_attempt114_settlement_window\.v1/u);
});

test("adjusted ledger implements absolute traded-leg costs and drifted HOLD semantics", () => {
  const result = buildProspectiveAttempt114SettlementWindow(fixture());
  const first = result.adjusted_theoretical_settlements[0];
  const second = result.adjusted_theoretical_settlements[1];
  const spyFirst = first.books.spy_buy_hold;
  const incumbentFirst = first.books.incumbent_tsmom_ensemble_vol;
  const incumbentHold = second.books.incumbent_tsmom_ensemble_vol;

  assert.equal(first.schema_version, ATTEMPT114_ADJUSTED_SETTLEMENT_SCHEMA);
  assert.deepEqual(spyFirst.absolute_traded_leg_weights, { SPY: 1, BIL: 1 });
  assert.deepEqual(spyFirst.absolute_traded_leg_cost_returns, { SPY: 0.0005, BIL: 0.0005 });
  assert.equal(spyFirst.turnover_notional, 2);
  assert.equal(spyFirst.modeled_cost_return, 0.001);
  assert.equal(incumbentFirst.turnover_notional, 1.2);
  assert.equal(incumbentFirst.modeled_cost_return, 0.0006);
  assert.equal(incumbentHold.committed_action, "HOLD");
  assert.deepEqual(incumbentHold.evaluation_weights, incumbentHold.pretrade_weights);
  assert.deepEqual(incumbentHold.absolute_traded_leg_weights, { SPY: 0, BIL: 0 });
  assert.equal(incumbentHold.modeled_cost_return, 0);
});

test("paper cash-equity ledger uses only raw prices, the frozen shadow executor, and no broker mutation", () => {
  const input = fixture();
  input.outcome_price_lineages[0].raw.corporate_actions.cash_distributions_per_execution_share.BIL = 0.01;
  rehashLineage(input.outcome_price_lineages[0]);
  const result = buildProspectiveAttempt114SettlementWindow(input);
  const first = result.alpaca_paper_cash_equity_entries[0];
  const incumbent = first.books.incumbent_tsmom_ensemble_vol;
  const hold = result.alpaca_paper_cash_equity_entries[1].books.incumbent_tsmom_ensemble_vol;

  assert.equal(first.schema_version, ATTEMPT114_PAPER_ENTRY_SCHEMA);
  assert.equal(first.evidence_class, "MODELED_PAPER_SHADOW_NOT_BROKER_EXECUTION");
  assert.equal(incumbent.shadow_execution_preview.schema_version, "equity_shadow_execution.v1");
  assert.equal(incumbent.shadow_execution_preview.broker_mutation_authorized, false);
  assert.equal(incumbent.adjusted_theoretical_value_used_for_order_sizing, false);
  assert.equal(incumbent.adjusted_theoretical_value_used_for_cash_equity, false);
  assert.equal(incumbent.broker_execution_verified, false);
  assert.ok(incumbent.corporate_action_cash_received > 0);
  assert.equal(hold.committed_action, "HOLD");
  assert.equal(hold.shadow_execution_preview, null);
  assert.deepEqual(hold.absolute_traded_leg_notional_usd, { SPY: 0, BIL: 0 });
  assert.equal(result.interval_bundles[0].schema_version, ATTEMPT114_INTERVAL_BUNDLE_SCHEMA);
  assert.equal(result.interval_bundles[0].ledgers_independently_accounted, true);
});

test("missing, duplicate, and out-of-order anchors, receipts, and lineages fail explicitly", () => {
  const missingAnchor = fixture();
  missingAnchor.anchor_manifests.pop();
  assert.throws(() => validateProspectiveAttempt114SettlementInput(missingAnchor), /exactly 254/u);

  const duplicateReceipt = fixture();
  duplicateReceipt.anchor_verification_receipts[1] = duplicateReceipt.anchor_verification_receipts[0];
  assert.throws(() => validateProspectiveAttempt114SettlementInput(duplicateReceipt), /duplicate sequence 1/u);

  const reorderedAnchor = fixture();
  [reorderedAnchor.anchor_manifests[1], reorderedAnchor.anchor_manifests[2]] = [
    reorderedAnchor.anchor_manifests[2], reorderedAnchor.anchor_manifests[1],
  ];
  assert.throws(() => validateProspectiveAttempt114SettlementInput(reorderedAnchor), /out of order/u);

  const missingLineage = fixture();
  missingLineage.outcome_price_lineages.splice(20, 1);
  assert.throws(() => validateProspectiveAttempt114SettlementInput(missingLineage), /exactly 252/u);

  const reorderedLineage = fixture();
  [reorderedLineage.outcome_price_lineages[0], reorderedLineage.outcome_price_lineages[1]] = [
    reorderedLineage.outcome_price_lineages[1], reorderedLineage.outcome_price_lineages[0],
  ];
  assert.throws(() => validateProspectiveAttempt114SettlementInput(reorderedLineage), /out of order/u);
});

test("replacement, backfill, optional stopping, late anchors, and lineage revision fail closed", () => {
  for (const flag of ["replacement_window_permitted", "backfill_permitted", "optional_stopping_permitted"]) {
    const changed = fixture();
    changed.sample_contract[flag] = true;
    assert.throws(() => validateProspectiveAttempt114SettlementInput(changed), /permits replacement/u);
  }

  const late = fixture();
  late.anchor_verification_receipts[0].published_at = late.anchor_verification_receipts[0].anchor_deadline;
  rehashReceipt(late.anchor_verification_receipts[0]);
  assert.throws(() => validateProspectiveAttempt114SettlementInput(late), /late/u);

  const wrongMapping = fixture();
  wrongMapping.outcome_price_lineages[0].commitment_references.outcome_close_commitment_sequence = 4;
  rehashLineage(wrongMapping.outcome_price_lineages[0]);
  assert.throws(() => validateProspectiveAttempt114SettlementInput(wrongMapping), /N\/N\+1\/N\+2/u);

  const revisedOverlap = fixture();
  revisedOverlap.outcome_price_lineages[1].raw.prices.execution.prices.SPY += 1;
  rehashLineage(revisedOverlap.outcome_price_lineages[1]);
  assert.throws(() => validateProspectiveAttempt114SettlementInput(revisedOverlap), /overlap/u);

  const changedAnchor = fixture();
  changedAnchor.anchor_manifests[3].signal_session_date = changedAnchor.anchor_manifests[2].signal_session_date;
  rehashAnchor(changedAnchor.anchor_manifests[3]);
  assert.throws(() => validateProspectiveAttempt114SettlementInput(changedAnchor), /skips, replaces, backfills, or reorders/u);
});
