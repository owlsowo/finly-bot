import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  ATTEMPT115_FINALIZATION_GATE_SCHEMA,
  buildAttempt115FinalizationGate,
  buildAttempt115PrimaryInference,
  runAttempt115FrozenPrimaryBootstrap,
  validateAttempt115FinalizationGate,
} from "../research/prospective_attempt115/inference.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
} from "../research/prospective_attempt115/policy.mjs";
import {
  ATTEMPT115_ID,
  ATTEMPT115_PROTOCOL_SHA256,
} from "../research/prospective_attempt115/protocol.mjs";
import { buildAttempt115PairedSettlementWindow } from "../research/prospective_attempt115/settlement.mjs";
import { makeAttempt115SourceProjections } from "./prospective_attempt115_fixtures.mjs";

const SOURCES = makeAttempt115SourceProjections();
const WINDOW = buildAttempt115PairedSettlementWindow({ sources: SOURCES });

function forgedHash(label) {
  return sha256({ forged: label });
}

function forgedDigestOnlyGate() {
  const evidenceKeys = [
    "protocol_runtime_publication_receipt_sha256",
    "strict_open_receipt_chain_sha256",
    "source_projection_chain_sha256",
    "provider_calendar_reconciliation_sha256",
    "provider_price_lineage_reconciliation_sha256",
    "paired_settlement_window_sha256",
    "full_reopen_receipt_sha256",
  ];
  const body = {
    schema_version: ATTEMPT115_FINALIZATION_GATE_SCHEMA,
    attempt_id: ATTEMPT115_ID,
    protocol_sha256: ATTEMPT115_PROTOCOL_SHA256,
    state: "COMPLETE_FINALIZATION_VERIFIED",
    verified_counts: {
      validated_forward_source_bundles: 253,
      strict_open_assurance_receipts: 252,
      outcome_only_standard_forward_receipts: 1,
      target_commitments: 252,
      paired_next_open_intervals: 252,
    },
    verification: {
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
    },
    evidence_hashes: Object.fromEntries(evidenceKeys.map((key) => [key, forgedHash(key)])),
    authority: {
      research_only: true,
      broker_mutation_authorized: false,
      order_payload: null,
      inference_authorized_once: true,
      repeat_inference_authorized: false,
    },
  };
  return { ...body, gate_sha256: sha256(body) };
}

test("frozen 4,999-draw stationary bootstrap is deterministic", () => {
  const primary = WINDOW.cells.find(({ cell_id: id }) => id === WINDOW.primary_cell_id);
  const incumbent = primary.rows[ATTEMPT115_INCUMBENT_POLICY_ID];
  const challenger = primary.rows[ATTEMPT115_CHALLENGER_POLICY_ID];
  const values = incumbent.map((row, index) => (
    Math.log1p(challenger[index].net_return) - Math.log1p(row.net_return)
  ));
  const first = runAttempt115FrozenPrimaryBootstrap(values);
  const second = runAttempt115FrozenPrimaryBootstrap(values);
  assert.deepEqual(first, second);
  assert.equal(first.one_sided_p_value, (1 + first.exceedances) / 5_000);
  assert.equal(
    first.supports_positive_edge,
    first.observed_mean > 0 && first.one_sided_p_value <= 0.05,
  );
  assert.throws(
    () => runAttempt115FrozenPrimaryBootstrap(values.slice(0, -1)),
    /exactly 252/iu,
  );
});

test("digest-shaped assertions alone cannot open the finalization gate", () => {
  const forged = forgedDigestOnlyGate();
  assert.throws(
    () => validateAttempt115FinalizationGate(forged),
    /requires the actual input-bound evidence/iu,
  );
  assert.throws(
    () => buildAttempt115FinalizationGate({
      evidenceHashes: forged.evidence_hashes,
    }),
    /publication|plain object|receipt/iu,
  );
  assert.throws(
    () => buildAttempt115PrimaryInference({
      settlementWindow: WINDOW,
      finalizationGate: forged,
      publicationReceipt: {},
      sourceRecords: [],
    }),
    /publication|must contain exactly|plain object/iu,
  );
});
