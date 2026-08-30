import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256 } from "../lib/canonical.mjs";
import { buildEconomicOptionsReplayArtifact } from "../lib/economic_options_replay.mjs";
import { POLICY } from "../lib/policy.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const paths = [
  resolve(projectRoot, "public/data/economic_options_overlay_replay.json"),
];
const texts = await Promise.all(paths.map((path) => readFile(path, "utf8")));
assert.ok(texts.every((text) => text === texts[0]), "economic options replay copy diverged");
const artifact = JSON.parse(texts[0]);
const expected = await buildEconomicOptionsReplayArtifact();
assert.equal(texts[0], `${JSON.stringify(expected, null, 2)}\n`, "economic options replay is not exactly reproducible");
const { artifact_sha256: artifactHash, ...body } = artifact;
assert.equal(artifactHash, sha256(body), "economic options replay hash is invalid");
assert.ok(Object.values(artifact.checked_invariants).every(Boolean), "economic options replay invariant failed");
assert.equal(artifact.scope, "PUBLIC_SYNTHETIC_NON_MUTATING_ARCHITECTURE_REPLAY");
assert.ok(artifact.branches.some((branch) => branch.options_compilation.action === "BULL_CALL_DEBIT_SPREAD"));
assert.ok(artifact.branches.some((branch) => branch.options_compilation.action === "NO_TRADE"));
assert.ok(artifact.branches.every((branch) => branch.synthetic_certificate.reserved_maximum_loss
  <= POLICY.riskPerTradeDollarCap));
assert.ok(artifact.branches.every((branch) => branch.execution_boundary.broker_mutation_requested === false
  && branch.execution_boundary.executor_invoked === false));
assert.doesNotMatch(texts[0], /(?:APCA-API|api[_-]?key|secret|account[_-]?id)/i);
console.log(JSON.stringify({
  ok: true,
  artifact_sha256: artifactHash,
  branches_verified: artifact.branches.length,
  invariants_verified: Object.keys(artifact.checked_invariants).length,
  copies_verified: paths.length,
  mutation_requested: false,
}, null, 2));
