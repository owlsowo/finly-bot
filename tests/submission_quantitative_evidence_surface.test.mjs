import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertSafePublicLanguage,
  buildEvidenceSurface,
  loadFrozenArtifacts,
  OUTPUT_PATHS,
  renderMarkdown,
  SOURCE_REGISTRY,
  writeEvidenceSurface,
} from "../research/build_submission_quantitative_evidence_surface.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");

test("submission evidence surface reports exact bounded results from all six frozen artifacts", async () => {
  const { publicArtifact, markdown } = await buildEvidenceSurface({ rootDir: projectRoot });
  const recurringDescriptor = SOURCE_REGISTRY.find((item) => item.id === "recurring_contribution");
  const recurringArtifact = JSON.parse(await readFile(resolve(projectRoot, recurringDescriptor.path), "utf8"));

  assert.equal(recurringArtifact.schema_version, "finly_recurring_contribution_analysis.v3");
  assert.equal(recurringArtifact.analysis.schema_version, "finly_rolling_monthly_contributions_compact.v3");
  for (const horizon of Object.values(recurringArtifact.analysis.horizons)) {
    assert.ok(horizon.windows.length > 0);
    assert.equal("path" in horizon.latest_window.candidate, false);
    assert.equal("path" in horizon.latest_window.benchmark, false);
    assert.ok(horizon.windows.every((window) => !("path" in window.candidate) && !("path" in window.benchmark)));
  }

  assert.equal(publicArtifact.source_integrity.artifact_count, 6);
  assert.equal(publicArtifact.source_integrity.all_six_hashes_verified, true);
  const accounting = publicArtifact.selection_audit.research_attempt_accounting;
  assert.equal(accounting.conservatively_counted_effective_research_attempts, 113);
  assert.equal(accounting.composition.reduce((sum, item) => sum + item.count, 0), 113);
  assert.deepEqual(accounting.composition.map((item) => item.count), [53, 12, 1, 9, 3, 5, 8, 1, 8, 5, 8]);
  assert.equal(accounting.independent_viable_strategy_count, false);
  assert.match(accounting.statement, /^113 conservatively counted effective research attempts/);
  assert.match(accounting.statement, /not 113 independent viable strategies/);
  assert.equal(publicArtifact.schema_version, "finly_submission_quantitative_evidence_surface.v2");
  assert.equal(publicArtifact.selection_audit.promoted_replacement_challenger_count, 0);
  assert.equal(publicArtifact.selection_audit.generation6.assessed_candidate_count, 7);
  assert.equal(publicArtifact.selection_audit.generation6.primary_spy_selected_id, null);
  assert.equal(publicArtifact.selection_audit.generation6.growth_control_selected_id, null);

  const g4 = publicArtifact.g4_consumed_2013_2026_replay;
  assert.equal(g4.candidate.start_date, "2013-01-02");
  assert.equal(g4.candidate.end_date, "2026-08-27");
  assert.equal(g4.candidate.annualized_return, 0.1897447215);
  assert.equal(g4.spy.annualized_return, 0.1511474737);
  assert.equal(g4.candidate.maximum_drawdown, -0.2898521154);
  assert.equal(g4.spy.maximum_drawdown, -0.3371726114);
  assert.equal(g4.candidate_minus_spy.annualized_return, 0.0385972478);

  const horizons = publicArtifact.recurring_contribution_replay.horizons;
  assert.deepEqual(Object.keys(horizons), ["1", "3", "6", "12"]);
  assert.equal(horizons["1"].candidate_beat_spy_fraction, 0.6257668712);
  assert.equal(horizons["3"].candidate_beat_spy_fraction, 0.6583850932);
  assert.equal(horizons["6"].candidate_beat_spy_fraction, 0.6898734177);
  assert.equal(horizons["12"].candidate_beat_spy_fraction, 0.7434210526);
  assert.ok(horizons["3"].worst_ending_value_advantage_usd < 0);
  assert.equal(horizons["3"].latest_window.candidate_exceeded_spy, false);

  assert.equal(publicArtifact.g4_falsification.promotion_eligible, false);
  assert.equal(publicArtifact.g4_falsification.deflated_sharpe_probability, 0.037478432287);
  assert.equal(publicArtifact.g4_falsification.worst_familywise_adjusted_p_value, 0.371814092954);
  assert.equal(publicArtifact.aegis_q_auxiliary.apples_to_apples_with_finly, false);
  assert.equal(publicArtifact.aegis_q_auxiliary.published_bundle_verified, false);
  assert.equal(publicArtifact.aegis_q_auxiliary.eligible_for_finly_selection_or_rank, false);

  assertSafePublicLanguage(publicArtifact);
  assertSafePublicLanguage(markdown);
  assert.match(markdown, /113 conservatively counted effective research attempts, zero new challenger was promoted to replace frozen v1/);
  assert.match(markdown, /53 prior research attempts/);
  assert.match(markdown, /12 invalidated G1 attempts/);
  assert.match(markdown, /1 aborted attempt/);
  assert.match(markdown, /9 invalidated G2 attempts/);
  assert.match(markdown, /3 competitor suggestions/);
  assert.match(markdown, /5 literature suggestions/);
  assert.match(markdown, /8 G3 formulas/);
  assert.match(markdown, /1 correction rerun/);
  assert.match(markdown, /8 G4 attempts: 7 eligible formulas and 1 control/);
  assert.match(markdown, /5 G5 attempts: 4 eligible formulas and 1 control/);
  assert.match(markdown, /8 G6 attempts: 7 eligible formulas and 1 control/);
  assert.doesNotMatch(markdown, /113 (?:disclosed )?effective trials/i);
  assert.doesNotMatch(markdown, /113 independent viable strategies(?!\.)/i);
  assert.match(markdown, /not described as fully preregistered/);
  assert.match(markdown, /excess-Sharpe selection rule and later inference corrections changed afterward/);
  assert.match(markdown, /negative worst-window values are retained/);
});

test("rendering is deterministic and file generation emits the same bytes", async () => {
  const built = await buildEvidenceSurface({ rootDir: projectRoot });
  assert.equal(renderMarkdown(built.publicArtifact), built.markdown);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "finly-evidence-surface-"));
  const outputPaths = {
    json: "generated/evidence.json",
    markdown: "generated/evidence.md",
  };
  const result = await writeEvidenceSurface({
    rootDir: projectRoot,
    outputRootDir: temporaryRoot,
    outputPaths,
  });
  const [json, markdown] = await Promise.all([
    readFile(result.json_path, "utf8"),
    readFile(result.markdown_path, "utf8"),
  ]);
  assert.equal(json, `${JSON.stringify(built.publicArtifact, null, 2)}\n`);
  assert.equal(markdown, built.markdown);
});

test("source loading rejects a missing or hash-mismatched frozen artifact", async () => {
  const missing = SOURCE_REGISTRY.map((item, index) => index === 0
    ? { ...item, path: "research/output/does_not_exist.json" }
    : item);
  await assert.rejects(
    loadFrozenArtifacts({ rootDir: projectRoot, registry: missing }),
    /required frozen artifact is missing or unreadable/,
  );

  const mismatched = SOURCE_REGISTRY.map((item, index) => index === 0
    ? { ...item, sha256: "0".repeat(64) }
    : item);
  await assert.rejects(
    loadFrozenArtifacts({ rootDir: projectRoot, registry: mismatched }),
    /frozen artifact hash mismatch/,
  );
});

test("unsupported promotional language is rejected before publication", () => {
  assert.throws(() => assertSafePublicLanguage("Finly consistently beats SPY"), /forbidden unsupported language/);
  assert.throws(() => assertSafePublicLanguage("This is a proven profitable system"), /forbidden unsupported language/);
  assert.throws(() => assertSafePublicLanguage("Finly is the best submission"), /forbidden unsupported language/);
  assert.doesNotThrow(() => assertSafePublicLanguage(
    "The consumed retrospective replay had a higher annualized return than SPY, but the strategy failed promotion gates.",
  ));
});

test("default output names are isolated from website and document artifacts", () => {
  assert.equal(OUTPUT_PATHS.json, "research/output/submission_quantitative_evidence_surface.json");
  assert.equal(OUTPUT_PATHS.markdown, "research/output/submission_quantitative_evidence_surface_report.md");
});
