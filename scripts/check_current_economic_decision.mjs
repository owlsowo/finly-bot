import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256 } from "../lib/canonical.mjs";
import { buildEconomicOptionsExecutionGuard } from "../lib/economic_research.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const paths = [
  resolve(projectRoot, "public/data/current_economic_decision.json"),
  resolve(projectRoot, "evidence/current_economic_decision.json"),
  resolve(projectRoot, "src/data/current_economic_decision.json"),
];
const texts = await Promise.all(paths.map((path) => readFile(path, "utf8")));
assert.ok(texts.every((text) => text === texts[0]), "current economic decision copies diverged");
const bundle = JSON.parse(texts[0]);
const { artifact_sha256: artifactHash, ...bundleBody } = bundle;
assert.equal(artifactHash, sha256(bundleBody));
const { receipt_sha256: baseHash, ...baseBody } = bundle.deterministic_decision;
assert.equal(baseHash, sha256(baseBody));
const { receipt_sha256: committeeHash, ...committeeBody } = bundle.risk_committee_decision;
assert.equal(committeeHash, sha256(committeeBody));
assert.equal(bundle.risk_committee_decision.base_receipt_sha256, baseHash);
assert.equal(bundle.data.read_only, true);
assert.equal(bundle.data.raw_bars_embedded, false);
assert.equal(bundle.data.daily_bar_timestamp_semantics,
  "session label only; availability is established by official close plus delay and authenticated fetch completion");
assert.equal(bundle.data.daily_bar_availability_delay_minutes, 15);
assert.equal(bundle.data.source_fetch_completed_at, bundle.deterministic_decision.source_available_at);
assert.ok(bundle.data.completed_session_boundary.eligible_at <= bundle.data.source_fetch_completed_at);
assert.equal(bundle.data.observed_end, bundle.data.completed_session_boundary.session_date);
assert.equal(bundle.paper_account_boundary.raw_account_embedded, false);
assert.equal(bundle.paper_account_boundary.raw_positions_embedded, false);
assert.equal(bundle.deterministic_decision.policy_id, "tsmom_ensemble_vol");
assert.equal(bundle.deterministic_decision.authorization.broker_mutation_authorized, false);
assert.equal(bundle.deterministic_decision.authorization.order_payload, null);
assert.equal(bundle.deterministic_decision.point_in_time_controls.incomplete_current_session_rejected, true);
assert.equal(bundle.deterministic_decision.point_in_time_controls.daily_bar_timestamp_not_used_as_availability, true);
assert.equal(bundle.deterministic_decision.latest_observation.timestamp_semantics,
  "daily bar timestamp is a session label, not an availability timestamp");
assert.equal(bundle.risk_committee_decision.authorization.broker_mutation_authorized, false);
assert.equal(bundle.risk_committee_decision.authorization.order_payload, null);
assert.equal(bundle.risk_committee_decision.non_amplification.passed, true);
if (bundle.risk_committee_decision.final_allocation) {
  assert.ok(bundle.risk_committee_decision.final_allocation.spy_weight
    <= bundle.deterministic_decision.proposed_allocation.spy_weight);
}
assert.equal(bundle.mutation_requested, false);
const guard = buildEconomicOptionsExecutionGuard(bundle, {
  asOf: new Date(new Date(bundle.generated_at).getTime() + 60_000).toISOString(),
  intentDirection: "bullish",
});
assert.equal(guard.entry_gate_passed, true);
assert.equal(guard.authorization_boundary.broker_mutation_authorized_by_this_guard, false);
assert.doesNotMatch(texts[0], /(?:APCA-API|api[_-]?key|secret|account[_-]?id|authorization[^\n]*true)/i);
console.log(JSON.stringify({
  ok: true,
  artifact_sha256: artifactHash,
  base_receipt_sha256: baseHash,
  committee_receipt_sha256: committeeHash,
  observed_end: bundle.data.observed_end,
  decision: bundle.risk_committee_decision.decision,
  final_allocation: bundle.risk_committee_decision.final_allocation,
  bullish_options_entry_gate: guard.decision,
  mutation_requested: bundle.mutation_requested,
  copies_verified: paths.length,
}, null, 2));
