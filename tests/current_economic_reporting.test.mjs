import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import { buildEconomicOptionsExecutionGuard } from "../lib/economic_research.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);

test("current authenticated economic receipt is identical, hashed, redacted, and non-mutating", async () => {
  const paths = [
    resolve(projectRoot, "public/data/current_economic_decision.json"),
    resolve(projectRoot, "evidence/current_economic_decision.json"),
    resolve(projectRoot, "src/data/current_economic_decision.json"),
  ];
  const texts = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  assert.ok(texts.every((text) => text === texts[0]));
  const bundle = JSON.parse(texts[0]);
  const { artifact_sha256: artifactHash, ...bundleBody } = bundle;
  assert.equal(artifactHash, sha256(bundleBody));
  const { receipt_sha256: baseHash, ...baseBody } = bundle.deterministic_decision;
  assert.equal(baseHash, sha256(baseBody));
  const { receipt_sha256: committeeHash, ...committeeBody } = bundle.risk_committee_decision;
  assert.equal(committeeHash, sha256(committeeBody));
  assert.equal(bundle.risk_committee_decision.base_receipt_sha256, baseHash);
  assert.equal(bundle.risk_committee_decision.non_amplification.passed, true);
  assert.equal(bundle.data.daily_bar_availability_delay_minutes, 15);
  assert.equal(bundle.data.source_fetch_completed_at, bundle.deterministic_decision.source_available_at);
  assert.equal(bundle.data.observed_end, bundle.data.completed_session_boundary.session_date);
  assert.equal(bundle.deterministic_decision.point_in_time_controls.incomplete_current_session_rejected, true);
  assert.equal(bundle.deterministic_decision.point_in_time_controls.daily_bar_timestamp_not_used_as_availability, true);
  assert.equal(bundle.deterministic_decision.authorization.broker_mutation_authorized, false);
  assert.equal(bundle.risk_committee_decision.authorization.broker_mutation_authorized, false);
  assert.equal(bundle.mutation_requested, false);
  const bullishGuard = buildEconomicOptionsExecutionGuard(bundle, {
    asOf: new Date(new Date(bundle.generated_at).getTime() + 60_000).toISOString(),
    intentDirection: "bullish",
  });
  assert.equal(bullishGuard.entry_gate_passed, true);
  assert.equal(bullishGuard.authorization_boundary.broker_mutation_authorized_by_this_guard, false);
  const bearishGuard = buildEconomicOptionsExecutionGuard(bundle, {
    asOf: new Date(new Date(bundle.generated_at).getTime() + 60_000).toISOString(),
    intentDirection: "bearish",
  });
  assert.equal(bearishGuard.entry_gate_passed, false);
  assert.ok(bearishGuard.reason_codes.includes("LONG_ONLY_ECONOMIC_DIRECTION_MISMATCH"));
  assert.doesNotMatch(texts[0], /(?:APCA-API|api[_-]?key|secret|account[_-]?id)/i);
});
