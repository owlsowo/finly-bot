import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(projectRoot, "evidence/competitor_benchmark.json");
const reportPath = resolve(projectRoot, "docs/COMPETITOR_BENCHMARK.md");
const finlyClaimsPath = resolve(projectRoot, "public/data/submission_claims_lock.json");

const [manifestText, reportText, finlyClaimsText] = await Promise.all([
  readFile(manifestPath, "utf8"),
  readFile(reportPath, "utf8"),
  readFile(finlyClaimsPath, "utf8"),
]);

const manifest = JSON.parse(manifestText);
const finlyClaims = JSON.parse(finlyClaimsText);
const finlyClaimsSha256 = `sha256:${createHash("sha256").update(finlyClaimsText).digest("hex")}`;

assert.equal(manifest.schema_version, "finly_competitor_landscape.v3");
assert.equal(manifest.snapshot.submission_count_observed, 14);
assert.deepEqual(manifest.snapshot.late_additions_since_source_audit, ["pin-desk", "alphaguard-ai"]);
assert.ok(
  Date.parse(manifest.snapshot.roster_refreshed_at) >= Date.parse(manifest.snapshot.source_audit_captured_at),
  "roster refresh must be at or after source audit",
);
assert.ok(manifest.snapshot.live_dashboard_url.startsWith("https://lablab.ai/"));
assert.equal(manifest.projects.length, 14);
assert.deepEqual(manifest.criteria_context.lablab_criteria_observed, [
  "P&L Performance",
  "Technology Implementation",
  "Creativity & Originality",
  "Presentation & Execution",
]);
assert.equal(manifest.criteria_context.published_numerical_weights_observed, null);

const expectedIds = [
  "vibehedge",
  "tissue-regeneration",
  "options-sniper",
  "pin-desk",
  "alphaguard-ai",
  "continual-learning-agent",
  "vega",
  "odysseus",
  "newsflow-trader",
  "alphaswarm-sovereign",
  "alphapilot-ai",
  "spy-sentinel-ai",
  "babil",
  "aegis-q",
];
assert.deepEqual(manifest.projects.map((project) => project.id), expectedIds);
assert.equal(new Set(manifest.projects.map((project) => project.id)).size, 14);
assert.equal(new Set(manifest.projects.map((project) => project.pinned_source.commit_sha)).size, 14);
assert.equal(new Set(manifest.projects.map((project) => project.pinned_source.repository_url)).size, 14);
assert.equal(new Set(manifest.projects.map((project) => project.submission_url)).size, 14);

const allowedCheckStatuses = new Set(["PASS", "PARTIAL", "FAIL", "NOT_RUN", "EXCLUDED"]);
const allowedLevels = new Set([
  "SYNTAX",
  "BUILD",
  "RECONCILIATION",
  "TEST",
  "TEST_AND_DEMO",
  "NONE",
  "METADATA_ONLY",
]);
const allowedReplayStatuses = new Set(["NOT_AVAILABLE", "NOT_ASSESSED"]);
const executedStatuses = new Set(["PASS", "PARTIAL", "FAIL"]);

for (const project of manifest.projects) {
  const { pinned_source: source, safe_local_check: check, submitted_strategy_replay: replay } = project;

  assert.match(source.commit_sha, /^[0-9a-f]{40}$/, `${project.name}: malformed commit SHA`);
  assert.ok(source.repository_url.startsWith("https://github.com/"), `${project.name}: repository URL must be GitHub HTTPS`);
  assert.ok(project.submission_url.startsWith("https://lablab.ai/"), `${project.name}: submission URL must be Lablab HTTPS`);
  assert.equal(typeof source.contents_inspected, "boolean");
  if (source.commit_time !== null) {
    assert.ok(Number.isFinite(Date.parse(source.commit_time)), `${project.name}: malformed commit timestamp`);
  }

  assert.ok(allowedCheckStatuses.has(check.status), `${project.name}: unknown local-check status`);
  assert.ok(allowedLevels.has(check.verification_level), `${project.name}: unknown verification level`);
  assert.equal(typeof check.bounded_check_runnable, "boolean");
  assert.equal(typeof check.safe_without_credentials_or_external_mutation, "boolean");
  assert.ok(Array.isArray(check.commands));
  assert.ok(Array.isArray(check.reason_codes) && check.reason_codes.length > 0);

  if (executedStatuses.has(check.status)) {
    assert.equal(check.bounded_check_runnable, true, `${project.name}: executed check marked non-runnable`);
    assert.equal(check.safe_without_credentials_or_external_mutation, true, `${project.name}: executed check lacks safety boundary`);
    assert.ok(check.commands.length > 0, `${project.name}: executed status has no command`);
  }
  if (check.status === "NOT_RUN") {
    assert.equal(check.bounded_check_runnable, false, `${project.name}: unrun check marked runnable`);
    assert.equal(check.verification_level, "NONE", `${project.name}: unrun project has a verification level`);
    assert.equal(check.commands.length, 0, `${project.name}: unrun project records an executed command`);
  }
  if (check.status === "EXCLUDED") {
    assert.equal(check.bounded_check_runnable, false);
    assert.equal(check.verification_level, "METADATA_ONLY");
    assert.equal(source.contents_inspected, false);
    assert.equal(check.safe_without_credentials_or_external_mutation, false);
  }

  for (const command of check.commands) {
    assert.equal(typeof command, "string");
    assert.doesNotMatch(command, /(?:^|\s)(?:rm|sudo|curl|wget)\b/, `${project.name}: unsafe command published`);
    if (command.startsWith("npm ci")) {
      assert.match(command, /--ignore-scripts/, `${project.name}: npm install did not disable lifecycle scripts`);
    }
  }

  assert.ok(allowedReplayStatuses.has(replay.status), `${project.name}: replay status implies unsupported comparability`);
  assert.equal(replay.runnable_without_credentials_or_external_mutation, false, `${project.name}: unsupported replay marked runnable`);
  assert.ok(Array.isArray(replay.reason_codes) && replay.reason_codes.length > 0);

  const competitionPnl = project.economic_evidence.competition_account_pnl;
  assert.equal(competitionPnl.status, "UNKNOWN", `${project.name}: competition P&L must remain unknown`);
  assert.equal(competitionPnl.value, null, `${project.name}: missing competition P&L must not be encoded as zero`);
  assert.equal(competitionPnl.reason_code, "NO_VERIFIED_COMPETITION_ACCOUNT_ARTIFACT");

  const historicalPnl = project.economic_evidence.submitted_strategy_historical_pnl;
  assert.equal(historicalPnl.status, "UNKNOWN", `${project.name}: submitted-strategy historical P&L must remain unknown`);
  assert.equal(historicalPnl.value, null, `${project.name}: missing historical P&L must not be encoded as zero`);
  for (const requiredField of ["data_window", "baseline", "cost_assumptions", "reason_codes"]) {
    assert.ok(Object.hasOwn(historicalPnl, requiredField), `${project.name}: missing ${requiredField}`);
  }
  assert.ok(Array.isArray(historicalPnl.reason_codes) && historicalPnl.reason_codes.length > 0);

  const contextOnly = project.economic_evidence.context_only;
  if (contextOnly !== null) {
    for (const requiredField of ["kind", "data_window", "baseline", "cost_assumptions", "comparability"]) {
      assert.ok(Object.hasOwn(contextOnly, requiredField), `${project.name}: context-only evidence missing ${requiredField}`);
    }
    assert.match(contextOnly.comparability, /^NOT_/, `${project.name}: context-only evidence lacks a non-comparability label`);
  }

  assert.ok(reportText.includes(project.name), `${project.name}: project absent from public report`);
  assert.ok(reportText.includes(source.commit_sha.slice(0, 7)), `${project.name}: pinned SHA absent from public report`);
}

const safeBoundedChecks = manifest.projects.filter((project) =>
  executedStatuses.has(project.safe_local_check.status),
);
assert.equal(safeBoundedChecks.length, 10);
assert.equal(safeBoundedChecks.filter((project) => project.safe_local_check.status === "PASS").length, 8);
assert.equal(safeBoundedChecks.filter((project) => project.safe_local_check.status === "PARTIAL").length, 1);
assert.equal(safeBoundedChecks.filter((project) => project.safe_local_check.status === "FAIL").length, 1);
assert.equal(manifest.projects.filter((project) => project.safe_local_check.status === "NOT_RUN").length, 3);
assert.equal(manifest.projects.filter((project) => project.safe_local_check.status === "EXCLUDED").length, 1);

assert.equal(manifest.common_historical_replay.status, "NOT_RUN");
assert.equal(manifest.common_historical_replay.eligible, false);
assert.equal(manifest.common_historical_replay.comparable_pnl_generated, false);
assert.ok(manifest.common_historical_replay.reason_codes.length >= 6);
assert.ok(manifest.common_historical_replay.minimum_future_contract.length >= 7);

const aegis = manifest.projects.find((project) => project.id === "aegis-q");
assert.equal(aegis.economic_evidence.context_only.kind, "LEGACY_EQUITY_REGIME_RESULT");
assert.equal(aegis.economic_evidence.context_only.comparability, "NOT_SUBMITTED_OPTIONS_PNL");
assert.deepEqual(aegis.economic_evidence.context_only.data_window, {
  start: "2021-05-12",
  end: "2026-08-27",
  observations: 1330,
});
assert.equal(aegis.economic_evidence.context_only.baseline, "QQQ buy-and-hold");
assert.equal(aegis.economic_evidence.context_only.cost_assumptions.one_way_slippage_bps, 5);

const pinDesk = manifest.projects.find((project) => project.id === "pin-desk");
assert.equal(pinDesk.safe_local_check.status, "PASS");
assert.equal(pinDesk.safe_local_check.verification_level, "SYNTAX");
assert.deepEqual(pinDesk.safe_local_check.commands, ["python3 -m compileall -q src tests"]);
assert.equal(pinDesk.economic_evidence.context_only.kind, "REPOSITORY_REPORTED_PAPER_ROUND_TRIP");
assert.equal(pinDesk.economic_evidence.context_only.reported_net_pnl_usd, -5.2);
assert.equal(pinDesk.economic_evidence.context_only.comparability, "NOT_COMPETITION_ACCOUNT_PNL_SNAPSHOT");

const alphaGuard = manifest.projects.find((project) => project.id === "alphaguard-ai");
assert.equal(alphaGuard.safe_local_check.status, "PASS");
assert.equal(alphaGuard.safe_local_check.verification_level, "SYNTAX");
assert.deepEqual(alphaGuard.safe_local_check.commands, ["python3 -m compileall -q ."]);
assert.equal(alphaGuard.economic_evidence.context_only, null);

assert.equal(manifest.finly_comparison_boundary.status, "NOT_RANKED_AND_NOT_CROSS_PROJECT_BACKTESTED");
assert.equal(manifest.finly_comparison_boundary.source_artifact, "public/data/submission_claims_lock.json");
assert.equal(manifest.finly_comparison_boundary.source_artifact_sha256, finlyClaimsSha256);
assert.equal(manifest.finly_comparison_boundary.competition_account_pnl, "UNKNOWN");
assert.match(manifest.finly_comparison_boundary.historical_scope, /not historical options P&L/i);
assert.match(manifest.finly_comparison_boundary.allowed_claim, /failed promotion/i);
assert.equal(manifest.finly_comparison_boundary.forbidden_claims.length, 5);
assert.equal(finlyClaims.retrospective_result.candidate_annualized_return, 0.1897447215);
assert.equal(finlyClaims.retrospective_result.spy_annualized_return, 0.1511474737);
assert.equal(finlyClaims.retrospective_result.candidate_maximum_drawdown, -0.2898521154);
assert.equal(finlyClaims.retrospective_result.spy_maximum_drawdown, -0.3371726114);
assert.equal(finlyClaims.retrospective_result.promotion_status, "NOT_PROMOTED_DESCRIPTIVE_ONLY");

const forbiddenPublicKeys = new Set([
  "score",
  "rank",
  "rubric",
  "observed_evidence_total",
  "claimed",
  "observed",
  "limitations",
]);
function rejectPrivateAuditKeys(value, path = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateAuditKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assert.equal(forbiddenPublicKeys.has(key), false, `${path}.${key}: private audit field leaked into public manifest`);
    rejectPrivateAuditKeys(entry, `${path}.${key}`);
  }
}
rejectPrivateAuditKeys(manifest);

for (const requiredPhrase of [
  "neutral evidence-availability map",
  "unknown, never zero",
  "all 14 projects",
  "Pin Desk and AlphaGuard AI were the two additions",
  "P&amp;L Performance",
  "No cross-project P&L was generated",
  "Why a common historical replay was not run",
  "Finly is not ranked here and was not cross-project backtested",
  "Its locked G4 evidence is a consumed adjusted-close ETF replay",
]) {
  assert.ok(reportText.includes(requiredPhrase), `public report missing claim boundary: ${requiredPhrase}`);
}

for (const forbiddenPattern of [
  /\b(?:economic|product) evidence\s*\/\s*\d+/i,
  /\bcoverage total\b/i,
  /\bstrongest projects?\b/i,
  /\bleads on\b/i,
  /\bsecurity defect\b/i,
  /data\/private\//i,
  /\bdetailed named (?:engineering )?audit\b/i,
]) {
  assert.equal(forbiddenPattern.test(reportText), false, `private ranking or defect language leaked: ${forbiddenPattern}`);
}

const combinedPublicDelivery = `${manifestText}\n${reportText}`;
const forbiddenSecretPatterns = [
  /\b(?:PK|AK)[A-Z0-9]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /https?:\/\/[^\s/:]+:[^\s/@]+@/,
];
for (const pattern of forbiddenSecretPatterns) {
  assert.equal(pattern.test(combinedPublicDelivery), false, `possible secret-bearing content matched ${pattern}`);
}

console.log("competitor landscape: PASS");
console.log("roster: 14/14; late additions: 2; bounded checks: 10; common replay: NOT_RUN; competition P&L: 14 UNKNOWN");
