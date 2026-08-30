import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";

const RESEARCH_PATH = new URL("../research/output/attempt150_public_evidence.json", import.meta.url);
const PUBLIC_PATH = new URL("../public/data/attempt150_public_evidence.json", import.meta.url);

function body(value) {
  const clone = structuredClone(value);
  delete clone.artifact_sha256;
  return clone;
}

test("sanitized Attempt150 evidence is identical, self-hashed, and numerically coherent", async () => {
  const [researchBytes, publicBytes] = await Promise.all([
    readFile(RESEARCH_PATH, "utf8"),
    readFile(PUBLIC_PATH, "utf8"),
  ]);
  assert.equal(researchBytes, publicBytes);
  const evidence = JSON.parse(researchBytes);
  assert.equal(evidence.schema_version, "finly_attempt150_public_evidence.v1");
  assert.equal(evidence.artifact_sha256, sha256(body(evidence)));
  assert.equal(evidence.primary_window.observations, 21218);
  assert.equal(evidence.robustness.positive_rebalance_anchors, 21);
  assert.equal(evidence.robustness.tested_rebalance_anchors, 21);
  assert.deepEqual(evidence.robustness.positive_at_modeled_cost_bps, [5, 10, 25]);
  assert.ok(Math.abs(
    evidence.headline.finly_annualized_return
      - evidence.headline.market_annualized_return
      - evidence.headline.annualized_return_advantage,
  ) < 1e-15);
  assert.ok(Math.abs(
    evidence.headline.finly_maximum_drawdown
      - evidence.headline.market_maximum_drawdown
      - evidence.headline.drawdown_improvement_percentage_points,
  ) < 1e-15);
  assert.equal(evidence.audit.precommitted_gates_passed, 8);
  assert.equal(evidence.audit.precommitted_gates_total, 9);
  assert.equal(evidence.audit.statistical_gate_passed, false);
});
