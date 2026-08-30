import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import { buildEconomicOptionsReplayArtifact } from "../lib/economic_options_replay.mjs";

test("public economic-options replay is deterministic, reduction-only, bounded, and non-mutating", async () => {
  const first = await buildEconomicOptionsReplayArtifact();
  const second = await buildEconomicOptionsReplayArtifact();
  assert.deepEqual(second, first);
  const { artifact_sha256: ignored, ...body } = first;
  void ignored;
  assert.equal(first.artifact_sha256, sha256(body));
  assert.ok(Object.values(first.checked_invariants).every(Boolean));
  const byName = Object.fromEntries(first.branches.map((branch) => [branch.name, branch]));
  assert.equal(byName.NO_MODEL_BASELINE.options_compilation.action, "BULL_CALL_DEBIT_SPREAD");
  assert.equal(
    byName.SUPPORTIVE_MODEL_CANNOT_AMPLIFY.intent.direction_score,
    byName.NO_MODEL_BASELINE.intent.direction_score,
  );
  assert.ok(byName.ADVERSE_MODEL_REDUCES.intent.direction_score
    < byName.NO_MODEL_BASELINE.intent.direction_score);
  assert.equal(byName.SEVERE_MODEL_VETOES.options_compilation.action, "NO_TRADE");
  assert.equal(byName.SEVERE_MODEL_VETOES.synthetic_certificate.certified, false);
  assert.ok(first.branches.every((branch) => branch.execution_boundary.executor_invoked === false));
});
