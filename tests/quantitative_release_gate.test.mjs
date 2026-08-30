import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertNoInternalMatchupLeakage,
  buildQuantitativeReleaseGate,
  canonicalQuantitativeReleaseGateJson,
  EXACT_ALLOWED_CLAIMS,
  EXACT_FORBIDDEN_CLAIMS,
  hashQuantitativeReleaseGate,
  loadFrozenQuantitativeReleaseGateSources,
  OUTPUT_PATHS,
  QUANTITATIVE_RELEASE_GATE_SCHEMA,
  quantitativeReleaseGateBody,
  renderQuantitativeReleaseGateMarkdown,
  SOURCE_REGISTRY,
  validateQuantitativeReleaseGate,
  writeQuantitativeReleaseGate,
} from "../research/build_quantitative_release_gate.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("quantitative release gate binds the required conclusions and dual go/no-go decision", async () => {
  const { artifact, markdown } = await buildQuantitativeReleaseGate({ rootDir: projectRoot });

  assert.equal(artifact.schema_version, QUANTITATIVE_RELEASE_GATE_SCHEMA);
  assert.equal(artifact.evidence_as_of, "2026-08-30T08:10:52.000Z");
  assert.equal(artifact.release_decision.status,
    "GO_BOUNDED_RELEASE_NO_GO_PERFORMANCE_MATCHUP");
  assert.equal(artifact.release_decision.bounded_release, "GO");
  assert.equal(artifact.release_decision.finly_vs_competitor_return_matchup, "NO_GO");
  assert.equal(artifact.release_decision.competitor_rank_claim, "NO_GO");
  assert.deepEqual(Object.keys(artifact.release_decision.downstream_surfaces).sort(),
    ["deck", "paper", "site", "video"]);

  const g4 = artifact.conclusions.g4_rejected_post_selection;
  assert.equal(g4.evidence_class, "CONSUMED_POST_SELECTED_RETROSPECTIVE_REPLAY");
  assert.equal(g4.g4_total_return, 9.6710597833);
  assert.equal(g4.spy_total_return, 5.8081746189);
  assert.equal(g4.deflated_sharpe_probability, 0.037478432287);
  assert.equal(g4.worst_familywise_adjusted_p_value, 0.371814092954);
  assert.equal(g4.disposition, "REJECTED_NOT_PROMOTED");

  const v1 = artifact.conclusions.production_v1_execution_realism;
  assert.equal(v1.total_return_at_5bp_per_leg, 0.1538759778);
  assert.equal(v1.total_return_at_25bp_per_leg, 0.1055891073);
  assert.equal(v1.spy_total_return, 0.3352366407);
  assert.equal(v1.annualized_volatility_at_5bp, 0.0812194739);
  assert.equal(v1.maximum_drawdown_at_5bp, -0.0544710489);
  assert.equal(v1.market_beating_on_total_return, false);
  assert.equal(v1.broker_fill_replay, false);
  assert.equal(v1.risk_characterization,
    "UNLEVERED_SPY_BIL_POLICY_TARGETING_10_PERCENT_ANNUALIZED_VOLATILITY");

  assert.deepEqual(
    artifact.conclusions.registered_future_only_tests.map((item) => ({
      attempt: item.attempt_number,
      outcomes: item.observed_outcome_count,
      performance: item.performance_claim_authorized,
    })),
    [
      { attempt: 115, outcomes: 0, performance: false },
      { attempt: 116, outcomes: 0, performance: false },
    ],
  );
  const competitors = artifact.conclusions.competitor_evidence_availability;
  assert.equal(competitors.visible_project_count, 20);
  assert.equal(competitors.exact_same_panel_submitted_options_comparator_count, 0);
  assert.equal(competitors.missing_pnl_treatment, "UNKNOWN_NEVER_ZERO");
  assert.equal(competitors.finly_vs_competitor_return_matchup_authorized, false);
  assert.equal(competitors.competitor_rank_claim_authorized, false);

  assert.deepEqual(artifact.allowed_claims, EXACT_ALLOWED_CLAIMS);
  assert.deepEqual(artifact.forbidden_claims, EXACT_FORBIDDEN_CLAIMS);
  assert.equal(artifact.source_integrity.source_count, 7);
  assert.equal(artifact.source_integrity.all_hashes_verified, true);
  assert.equal(renderQuantitativeReleaseGateMarkdown(artifact), markdown);
});

test("artifact self-hash, canonical JSON, and checked-in outputs are deterministic", async () => {
  const first = await buildQuantitativeReleaseGate({ rootDir: projectRoot });
  const second = await buildQuantitativeReleaseGate({ rootDir: projectRoot });
  const json = canonicalQuantitativeReleaseGateJson(first.artifact);
  const [checkedJson, checkedMarkdown, checkedPublicJson] = await Promise.all([
    readFile(resolve(projectRoot, OUTPUT_PATHS.json), "utf8"),
    readFile(resolve(projectRoot, OUTPUT_PATHS.markdown), "utf8"),
    readFile(resolve(projectRoot, OUTPUT_PATHS.public_json), "utf8"),
  ]);

  assert.deepEqual(first, second);
  assert.equal(first.artifact.artifact_sha256,
    hashQuantitativeReleaseGate(first.artifact));
  assert.equal(first.artifact.artifact_sha256,
    hashQuantitativeReleaseGate(quantitativeReleaseGateBody(first.artifact)));
  assert.equal(json, canonicalQuantitativeReleaseGateJson(second.artifact));
  assert.equal(checkedJson, json);
  assert.equal(checkedPublicJson, json);
  assert.equal(checkedMarkdown, first.markdown);
  assert.doesNotThrow(() => validateQuantitativeReleaseGate(first.artifact));
});

test("writer emits the same bytes under alternate output paths", async () => {
  const built = await buildQuantitativeReleaseGate({ rootDir: projectRoot });
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "finly-quant-release-gate-"));
  const outputPaths = {
    json: "generated/release_gate.json",
    markdown: "generated/release_gate.md",
  };
  const result = await writeQuantitativeReleaseGate({
    rootDir: projectRoot,
    outputRootDir: temporaryRoot,
    outputPaths,
  });
  const [json, markdown] = await Promise.all([
    readFile(result.json_path, "utf8"),
    readFile(result.markdown_path, "utf8"),
  ]);

  assert.equal(json, canonicalQuantitativeReleaseGateJson(built.artifact));
  assert.equal(markdown, built.markdown);
  assert.match(result.json_raw_bytes_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.markdown_raw_bytes_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.artifact_sha256, built.artifact.artifact_sha256);
});

test("source loading fails closed on missing, hash-drifted, duplicate, or escaping sources", async () => {
  const missing = SOURCE_REGISTRY.map((item, index) => index === 0
    ? { ...item, path: "research/output/not_present.json" }
    : item);
  await assert.rejects(
    loadFrozenQuantitativeReleaseGateSources({ rootDir: projectRoot, registry: missing }),
    /missing or unreadable/u,
  );

  const drifted = SOURCE_REGISTRY.map((item, index) => index === 0
    ? { ...item, raw_bytes_sha256: `sha256:${"0".repeat(64)}` }
    : item);
  await assert.rejects(
    loadFrozenQuantitativeReleaseGateSources({ rootDir: projectRoot, registry: drifted }),
    /source hash mismatch/u,
  );

  const duplicate = SOURCE_REGISTRY.map((item, index) => index === 1
    ? { ...item, id: SOURCE_REGISTRY[0].id }
    : item);
  await assert.rejects(
    loadFrozenQuantitativeReleaseGateSources({ rootDir: projectRoot, registry: duplicate }),
    /duplicate source id/u,
  );

  const escaping = SOURCE_REGISTRY.map((item, index) => index === 0
    ? { ...item, path: "../outside.json" }
    : item);
  await assert.rejects(
    loadFrozenQuantitativeReleaseGateSources({ rootDir: projectRoot, registry: escaping }),
    /escapes the project root/u,
  );
});

test("exact validator rejects rehashed claim, conclusion, and source forgeries", async () => {
  const { artifact } = await buildQuantitativeReleaseGate({ rootDir: projectRoot });
  function rehash(mutated) {
    mutated.artifact_sha256 = hashQuantitativeReleaseGate(mutated);
    return mutated;
  }

  const forgedClaim = structuredClone(artifact);
  forgedClaim.allowed_claims[0] = "Finly will beat SPY next month.";
  assert.throws(
    () => validateQuantitativeReleaseGate(rehash(forgedClaim)),
    /claim registry changed/u,
  );

  const forgedConclusion = structuredClone(artifact);
  forgedConclusion.conclusions.g4_rejected_post_selection.g4_total_return = 999;
  assert.throws(
    () => validateQuantitativeReleaseGate(rehash(forgedConclusion)),
    /conclusions changed/u,
  );

  const forgedSources = structuredClone(artifact);
  forgedSources.source_integrity.sources = SOURCE_REGISTRY.map((source, index) => ({
    id: `fake_${index}`,
    path: `research/fake_${index}.json`,
    schema_version: source.schema_version,
    raw_bytes_sha256: `sha256:${"0".repeat(64)}`,
  }));
  assert.throws(
    () => validateQuantitativeReleaseGate(rehash(forgedSources)),
    /source integrity changed/u,
  );
});

test("public artifacts contain no internal matchup material and carry every claim boundary", async () => {
  const { artifact, markdown } = await buildQuantitativeReleaseGate({ rootDir: projectRoot });
  const json = canonicalQuantitativeReleaseGateJson(artifact);

  assertNoInternalMatchupLeakage(artifact);
  assertNoInternalMatchupLeakage(json);
  assertNoInternalMatchupLeakage(markdown);
  assert.match(markdown, /GO for a bounded quantitative release; NO-GO/iu);
  assert.match(markdown, /\+967\.11% vs SPY \+580\.82%/u);
  assert.match(markdown, /DSR 3\.75%; familywise p 37\.18%/u);
  assert.match(markdown, /\+15\.39% at 5 bp\/leg; \+10\.56% at 25 bp\/leg; SPY \+33\.52%/u);
  assert.match(markdown, /2013-01-02–2026-08-27; modeled 5 bp one-way/u);
  assert.match(markdown, /2025-01-02–2026-08-28/u);
  assert.match(markdown, /targeting 10% annualized volatility/iu);
  assert.match(markdown, /Publicly registered, future-only, zero outcomes/iu);
  assert.match(markdown, /20 visible projects; 0 exact same-panel submitted-options comparators/iu);
  assert.match(markdown, /Missing P&L is unknown/iu);
  assert.match(markdown, /Finly will be profitable in the future\./u);
  assert.match(markdown, /Finly will beat SPY next month\./u);
  assert.match(markdown, /Finly has verified options P&L\./u);
  assert.match(markdown, /Any Finly-versus-competitor return or P&L matchup\./u);
});
