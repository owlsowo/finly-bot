import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(projectRoot, "research/competitor_strategy_registry_generation7.json");
const reportPath = resolve(projectRoot, "research/competitor_strategy_registry_generation7_report.md");

async function loadRegistry() {
  return JSON.parse(await readFile(registryPath, "utf8"));
}

test("Generation 7 freezes the complete twenty-project live census and seven-project delta", async () => {
  const registry = await loadRegistry();

  assert.equal(registry.schema_version, "finly_competitor_strategy_registry_generation7.v1");
  assert.equal(registry.capture.visible_submission_count, 20);
  assert.equal(registry.capture.complete_visible_census, true);
  assert.equal(registry.projects.length, 20);
  assert.deepEqual(registry.projects.map((project) => project.rank), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(new Set(registry.projects.map((project) => project.id)).size, 20);

  const expectedNewIds = [
    "alphaguard-ai",
    "aura",
    "futarchists-options",
    "optionguard",
    "sogno-options-agent",
    "vermiliion",
    "vrp-engine",
  ];
  const observedNewIds = registry.projects
    .filter((project) => project.new_since_generation6_snapshot)
    .map((project) => project.id)
    .sort();
  assert.deepEqual(observedNewIds, expectedNewIds);
  assert.deepEqual([...registry.snapshot_delta.new_project_ids].sort(), expectedNewIds);
  assert.equal(registry.snapshot_delta.baseline_visible_submission_count, 13);
  assert.equal(registry.snapshot_delta.current_visible_submission_count, 20);
  assert.equal(registry.snapshot_delta.new_visible_submission_count, 7);
});

test("every project keeps financial evidence separate from mechanism evidence and binds sources to its commit", async () => {
  const registry = await loadRegistry();
  const financialClasses = new Set(Object.keys(registry.classification_definitions.financial_evidence));
  const mechanismClasses = new Set(Object.keys(registry.classification_definitions.mechanism_evidence));
  const eventPrefix = "https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/";

  for (const project of registry.projects) {
    assert.ok(project.submission_url.startsWith(eventPrefix), `${project.id} submission URL is outside the event`);
    assert.match(project.repository.commit_sha, /^[a-f0-9]{40}$/u, `${project.id} commit is not pinned`);
    assert.equal(
      project.repository.tree_url,
      `${project.repository.url}/tree/${project.repository.commit_sha}`,
      `${project.id} tree URL is not commit-bound`,
    );
    assert.ok(financialClasses.has(project.financial_evidence.classification), `${project.id} has an unknown financial class`);
    assert.ok(mechanismClasses.has(project.mechanism_evidence.classification), `${project.id} has an unknown mechanism class`);
    assert.equal(typeof project.financial_evidence.comparator_eligible, "boolean");
    assert.equal(typeof project.mechanism_evidence.strongest_new_engineering_mechanism, "boolean");
    assert.ok(project.financial_evidence.sources.length > 0, `${project.id} lacks financial-evidence sources`);
    assert.ok(project.mechanism_evidence.sources.length > 0, `${project.id} lacks mechanism-evidence sources`);

    for (const source of [...project.financial_evidence.sources, ...project.mechanism_evidence.sources]) {
      assert.ok(
        source.startsWith(`${project.repository.url}/blob/${project.repository.commit_sha}/`),
        `${project.id} source is not bound to the pinned repository commit: ${source}`,
      );
    }

    if (project.repository.access_status === "ACCESSIBLE") {
      assert.equal(project.repository.commit_basis, "LIVE_HEAD_VERIFIED");
    }
  }
});

test("no public financial comparator is designated and VRP remains mechanism evidence only", async () => {
  const registry = await loadRegistry();
  const financialComparators = registry.projects.filter((project) => project.financial_evidence.comparator_eligible);
  const strongestNewMechanisms = registry.projects.filter(
    (project) => project.mechanism_evidence.strongest_new_engineering_mechanism,
  );

  assert.deepEqual(financialComparators, []);
  assert.equal(registry.primary_comparators.financial.project_id, null);
  assert.equal(registry.primary_comparators.financial.eligible_project_count, 0);
  assert.equal(
    registry.primary_comparators.financial.status,
    "NO_PUBLIC_SAME_PANEL_SUBMITTED_OPTIONS_COMPARATOR",
  );
  assert.equal(registry.primary_comparators.financial.direct_submitted_options_pnl_comparison, false);
  assert.equal(registry.primary_comparators.financial.cross_project_financial_rank_supported, false);

  assert.deepEqual(strongestNewMechanisms.map((project) => project.id), ["vrp-engine"]);
  assert.equal(registry.primary_comparators.engineering.project_id, "vrp-engine");
  assert.equal(
    strongestNewMechanisms[0].financial_evidence.classification,
    "SYNTHETIC_OR_DEMO_NOT_FINANCIAL",
  );
  assert.equal(
    registry.primary_comparators.engineering.fractional_kelly_verdict,
    "WOULD_WEAKEN_CURRENT_RIGOR_WITHOUT_CALIBRATED_PROBABILITIES",
  );

  const optionGuard = registry.projects.find((project) => project.id === "optionguard");
  assert.equal(optionGuard.financial_evidence.classification, "SYNTHETIC_OR_DEMO_NOT_FINANCIAL");
  const futarchists = registry.projects.find((project) => project.id === "futarchists-options");
  assert.match(futarchists.mechanism_evidence.summary, /does not implement/iu);
});

test("license totals reconcile and missing license files never authorize code reuse", async () => {
  const registry = await loadRegistry();
  const projects = registry.projects;
  const mit = projects.filter((project) => project.license.spdx === "MIT" && project.license.file_status === "LICENSE_FILE_PRESENT");
  const apache = projects.filter((project) => project.license.spdx === "Apache-2.0" && project.license.file_status === "LICENSE_FILE_PRESENT");
  const noFile = projects.filter((project) => new Set([
    "NO_LICENSE_FILE",
    "README_CLAIM_ONLY_NO_LICENSE_FILE",
  ]).has(project.license.file_status));
  const unavailable = projects.filter((project) => project.license.file_status === "UNVERIFIABLE_REPOSITORY_UNAVAILABLE");

  assert.equal(mit.length, registry.license_summary.license_file_present_mit);
  assert.equal(apache.length, registry.license_summary.license_file_present_apache_2_0);
  assert.equal(noFile.length, registry.license_summary.no_license_file_or_readme_claim_only);
  assert.equal(unavailable.length, registry.license_summary.unverifiable_repository_unavailable);
  assert.equal(mit.length + apache.length + noFile.length + unavailable.length, 20);

  for (const project of noFile) {
    assert.match(project.license.reuse_rule, /do not copy/iu, `${project.id} missing-license rule is permissive`);
  }
});

test("Finly's public visibility failure and claim boundaries are impossible to omit", async () => {
  const registry = await loadRegistry();
  const warning = registry.finly_submission_visibility;

  assert.equal(warning.status, "NOT_VISIBLE_DRAFT_WARNING");
  assert.equal(warning.visible_in_twenty_project_submission_list, false);
  assert.equal(warning.visible_in_builder_leaderboard_association, true);
  assert.equal(warning.editor_step, 1);
  assert.equal(warning.editor_total_steps, 3);
  assert.equal(warning.editor_completion_percent, 26);
  assert.equal(warning.blank_social_post_link_fields, 5);
  assert.match(warning.required_action, /all three submission steps/iu);

  const boundaries = registry.claim_boundaries.join("\n");
  assert.match(boundaries, /unknown, never zero/iu);
  assert.match(boundaries, /no project exposes an exact same-panel submitted-options/iu);
  assert.match(boundaries, /VRP Engine is the strongest new engineering mechanism, not a verified financial winner/iu);
  assert.match(boundaries, /No source.*supports a promise.*beat SPY/iu);
});

test("the concise report carries the census, warning, evidence split, and recommendations", async () => {
  const report = await readFile(reportPath, "utf8");

  for (const heading of [
    "# Final live competitor audit",
    "## Technical summary",
    "## Twenty visible projects produce no public tournament comparator",
    "## No submission supports a public financial head-to-head",
    "## VRP contributes two credible shadow tests, not a Kelly upgrade",
    "## Scope and evidence definitions",
    "## Methodology binds each conclusion to a commit",
    "## Limitations keep the comparison from becoming a leaderboard claim",
    "## Recommended next steps",
    "## Further questions",
  ]) {
    assert.ok(report.includes(heading), `report omits required section: ${heading}`);
  }
  assert.match(report, /20 visible submissions/iu);
  assert.match(report, /seven more than/iu);
  assert.match(report, /step 1 of 3, 26%/iu);
  assert.match(report, /Financial evidence/iu);
  assert.match(report, /Mechanism evidence/iu);
  assert.match(report, /Adding fractional Kelly now.*weaken/isu);
});
