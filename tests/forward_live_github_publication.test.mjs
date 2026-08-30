import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA,
  buildForwardTrialLiveActivation,
  hashForwardTrialLiveValue,
} from "../research/forward_trial_live_core.mjs";
import {
  GITHUB_PUBLICATION_POLICY,
  GITHUB_PUBLICATION_RECEIPT_DIRECTORY,
  canonicalJson,
  fetchAndValidateGitHubPublication,
  githubPublicApiRequestPlan,
  githubPublicationReceiptPlan,
  parseGitHubPublicationCli,
  publishGitHubPublicationReceiptWriteOnce,
  sha256Bytes,
  sha256Canonical,
  validateGitHubPublicationEvidence,
  validateGitHubPublicationReceipt,
} from "../scripts/verify_forward_live_github_publication.mjs";

const HEAD_SHA = "1".repeat(40);
const PARENT_SHA = "2".repeat(40);
const RUN_ID = 33_287_101_805;
const PARENT_RUN_ID = 33_286_999_004;
const WORKFLOW_BYTES = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const ACTIVATION_BYTES = await readFile(
  new URL("../research/forward_trial_live/activation.json", import.meta.url),
  "utf8",
);
const ACTIVATION = JSON.parse(ACTIVATION_BYTES);
const RUNTIME_MANIFEST_BYTES = await readFile(
  new URL("../research/forward_trial_live/runtime_manifest.json", import.meta.url),
  "utf8",
);
const RUNTIME_MANIFEST = JSON.parse(RUNTIME_MANIFEST_BYTES);
const VERIFIER_SCRIPT_BYTES = await readFile(
  new URL("../scripts/verify_forward_live_github_publication.mjs", import.meta.url),
  "utf8",
);
const digest = (character) => `sha256:${character.repeat(64)}`;
const canonicalRepositoryJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const RUNTIME_PATHS = [...GITHUB_PUBLICATION_POLICY.runtime_source_paths];
const RUNTIME_SOURCE_BYTES = Object.freeze(Object.fromEntries(await Promise.all(
  RUNTIME_PATHS.map(async (path) => [
    path,
    await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
  ]),
)));

function buildRuntimeManifest(activation = ACTIVATION) {
  const runtimeManifest = structuredClone(RUNTIME_MANIFEST);
  runtimeManifest.activation_sha256 = activation.activation_sha256;
  return rehashRuntimeManifest(runtimeManifest);
}

function rehashAnchor(anchor) {
  const body = { ...anchor };
  delete body.manifest_sha256;
  anchor.manifest_sha256 = hashForwardTrialLiveValue(body);
  return anchor;
}

function rehashRuntimeManifest(runtimeManifest) {
  const body = { ...runtimeManifest };
  delete body.manifest_sha256;
  runtimeManifest.manifest_sha256 = hashForwardTrialLiveValue(body);
  return runtimeManifest;
}

function buildAnchor({ activation = ACTIVATION, runtimeManifest = buildRuntimeManifest(activation) } = {}) {
  const session = activation.payload.activation_session;
  return rehashAnchor({
    schema_version: FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA,
    trial_id: activation.trial_id,
    manifest_kind: "PUBLIC_HASH_ONLY_SIGNAL_ANCHOR",
    commitment_sequence: 1,
    signal_session_date: session.session_date,
    timing: {
      captured_at: "2026-08-31T20:16:00.123Z",
      market_close_at: session.market_close_at,
      bar_eligible_at: session.bar_eligible_at,
      next_session_date: session.next_session_date,
      next_market_close_at: session.next_market_close_at,
      anchor_deadline: session.next_market_close_at,
    },
    formula: {
      ...structuredClone(activation.payload.formula_binding),
      implementation_binding_sha256: runtimeManifest.manifest_sha256,
      decision_receipt_sha256: digest("a"),
    },
    action: "REBALANCE",
    target_weights: { SPY: 0.4, BIL: 0.6 },
    private_bundle_sha256: digest("b"),
    previous_private_bundle_sha256: activation.activation_sha256,
    authority: structuredClone(activation.payload.authority),
    evaluation_gates: structuredClone(activation.payload.evaluation_gates),
  });
}

function anchorPath(anchor) {
  return `${GITHUB_PUBLICATION_POLICY.anchor_directory}/${String(anchor.commitment_sequence).padStart(8, "0")}_${anchor.manifest_sha256.slice(7)}.json`;
}

function laterActivation() {
  return buildForwardTrialLiveActivation({
    frozen_at: "2026-08-30T02:30:00.000Z",
    activation_mode: "EXPLICIT_LATER_ACTIVATION",
    session: {
      ...structuredClone(ACTIVATION.payload.activation_session),
      session_date: "2026-09-01",
      market_open_at: "2026-09-01T13:30:00.000Z",
      market_close_at: "2026-09-01T20:00:00.000Z",
      bar_eligible_at: "2026-09-01T20:15:00.000Z",
      next_session_date: "2026-09-02",
      next_market_open_at: "2026-09-02T13:30:00.000Z",
      next_market_close_at: "2026-09-02T20:00:00.000Z",
    },
  });
}

function apiResponseFixture(value) {
  const plan = githubPublicApiRequestPlan({
    runId: value.runId,
    headSha: value.run.head_sha,
    parentSha: value.expectedParentSha,
    anchorPath: value.anchorPath,
  });
  const responseValues = {
    repository: value.repository,
    anchor_workflow_run: value.run,
    anchor_workflow_jobs: value.jobs,
    publication_commit: value.commit,
    activation_at_parent: value.activationBytes,
    runtime_manifest_at_parent: value.runtimeManifestBytes,
    ...Object.fromEntries(RUNTIME_PATHS.map((path) => [
      `runtime_source:${path}`,
      value.runtimeSourceBytes[path],
    ])),
    parent_freeze_workflow_runs: value.parentFreezeRuns,
    anchor_at_head: value.anchorBytes,
    workflow_at_parent: value.workflowBytes,
    verifier_at_parent: value.verifierScriptBytes,
  };
  return plan.map((request) => ({
    request_id: request.request_id,
    canonical_url: request.canonical_url,
    github_http_date: "Mon, 31 Aug 2026 20:25:00 GMT",
    response_bytes: request.response_type === "json"
      ? Buffer.from(JSON.stringify(responseValues[request.request_id]), "utf8")
      : Buffer.from(responseValues[request.request_id], "utf8"),
  }));
}

function rehashReceipt(receipt) {
  const body = { ...receipt };
  delete body.receipt_sha256;
  receipt.receipt_sha256 = sha256Canonical(body);
  return receipt;
}

function fixture(overrides = {}) {
  const activation = overrides.activation ?? structuredClone(ACTIVATION);
  const runtimeManifest = overrides.runtimeManifest ?? buildRuntimeManifest(activation);
  const anchor = overrides.anchor ?? buildAnchor({ activation, runtimeManifest });
  const publicAnchorPath = overrides.anchorPath ?? anchorPath(anchor);
  const repository = {
    id: GITHUB_PUBLICATION_POLICY.repository.id,
    full_name: GITHUB_PUBLICATION_POLICY.repository.full_name,
    private: false,
    visibility: "public",
    default_branch: "main",
    fork: false,
    archived: false,
    disabled: false,
    ...overrides.repository,
  };
  const runRepository = {
    id: GITHUB_PUBLICATION_POLICY.repository.id,
    full_name: GITHUB_PUBLICATION_POLICY.repository.full_name,
    private: false,
  };
  const run = {
    id: RUN_ID,
    workflow_id: GITHUB_PUBLICATION_POLICY.workflow.id,
    name: GITHUB_PUBLICATION_POLICY.workflow.name,
    path: GITHUB_PUBLICATION_POLICY.workflow.path,
    event: "push",
    head_branch: "main",
    head_sha: HEAD_SHA,
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-31T20:20:00Z",
    run_started_at: "2026-08-31T20:20:01Z",
    updated_at: "2026-08-31T20:24:31Z",
    run_attempt: 1,
    html_url: `https://github.com/owlsowo/finly-bot/actions/runs/${RUN_ID}`,
    repository: runRepository,
    head_repository: structuredClone(runRepository),
    ...overrides.run,
  };
  const parentRun = {
    ...structuredClone(run),
    id: PARENT_RUN_ID,
    head_sha: PARENT_SHA,
    created_at: "2026-08-30T04:05:00Z",
    run_started_at: "2026-08-30T04:05:01Z",
    updated_at: "2026-08-30T04:10:00Z",
    html_url: `https://github.com/owlsowo/finly-bot/actions/runs/${PARENT_RUN_ID}`,
    ...overrides.parentRun,
  };
  const jobs = {
    total_count: 1,
    jobs: [{
      id: 99_192_087_329,
      name: "verify",
      run_id: RUN_ID,
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "success",
      steps: [
        {
          name: "Run npm run verify",
          number: 5,
          status: "completed",
          conclusion: "success",
          started_at: "2026-08-31T20:20:02Z",
          completed_at: "2026-08-31T20:24:00Z",
        },
        {
          name: "Generated receipts are committed and reproducible",
          number: 6,
          status: "completed",
          conclusion: "success",
          started_at: "2026-08-31T20:24:01Z",
          completed_at: "2026-08-31T20:24:30Z",
        },
      ],
    }],
    ...overrides.jobs,
  };
  const commit = {
    sha: HEAD_SHA,
    parents: [{ sha: PARENT_SHA }],
    files: [{
      filename: publicAnchorPath,
      status: "added",
      additions: 64,
      deletions: 0,
      changes: 64,
    }],
    ...overrides.commit,
  };
  const runtimeManifestBytes = overrides.runtimeManifestBytes ?? canonicalRepositoryJson(runtimeManifest);
  const runtimeSourceBytes = overrides.runtimeSourceBytes ?? structuredClone(RUNTIME_SOURCE_BYTES);
  const value = {
    repository,
    run,
    jobs,
    commit,
    parentFreezeRuns: overrides.parentFreezeRuns ?? {
      total_count: 1,
      workflow_runs: [parentRun],
    },
    activationBytes: overrides.activationBytes ?? canonicalRepositoryJson(activation),
    runtimeManifestBytes,
    runtimeSourceBytes,
    anchorBytes: overrides.anchorBytes ?? canonicalRepositoryJson(anchor),
    workflowBytes: overrides.workflowBytes ?? WORKFLOW_BYTES,
    verifierScriptBytes: overrides.verifierScriptBytes ?? VERIFIER_SCRIPT_BYTES,
    executingVerifierBytes: overrides.executingVerifierBytes ?? VERIFIER_SCRIPT_BYTES,
    executingRuntimeManifestBytes: overrides.executingRuntimeManifestBytes ?? runtimeManifestBytes,
    executingRuntimeSourceBytes: overrides.executingRuntimeSourceBytes ?? structuredClone(runtimeSourceBytes),
    runId: RUN_ID,
    anchorPath: publicAnchorPath,
    expectedParentSha: PARENT_SHA,
  };
  value.apiResponses = overrides.apiResponses ?? apiResponseFixture(value);
  return value;
}

test("real v2 activation/runtime/anchor evidence yields a narrow self-hashed receipt", () => {
  const receipt = validateGitHubPublicationEvidence(fixture());
  assert.equal(receipt.commitment_sequence, 1);
  assert.equal(receipt.public_pre_deadline_publication_observed, true);
  assert.equal(receipt.external_anchor_verified, false);
  assert.equal(receipt.assurance.independent_cryptographic_timestamp_verified, false);
  assert.equal(receipt.assurance.github_commit_timestamp_used, false);
  assert.equal(receipt.assurance.provider_origin_verified, false);
  assert.equal(receipt.assurance.broker_execution_verified, false);
  assert.equal(receipt.assurance.performance_inference_permitted, false);
  assert.equal(receipt.assurance.evidence_class, "REPRODUCIBLE_PUBLIC_API_POINTER");
  assert.equal(receipt.assurance.self_contained_offline_evidence, false);
  assert.equal(receipt.assurance.hostile_preexecution_environment_excluded, false);
  assert.equal(receipt.self_contained_offline_evidence, false);
  assert.equal(receipt.activation_at_head.activation_sha256, ACTIVATION.activation_sha256);
  assert.equal(receipt.parent_freeze_run.head_sha, PARENT_SHA);
  assert.equal(receipt.runtime_manifest_at_head.runtime_source_bytes_verified, true);
  assert.equal(receipt.runtime_manifest_at_head.matches_executing_runtime, true);
  assert.equal(receipt.verifier_at_parent.matches_executing_verifier_file_bytes, true);
  assert.equal(receipt.verifier_at_parent.execution_closure_verified, true);
  assert.deepEqual(
    receipt.runtime_manifest_at_head.runtime_source_files,
    RUNTIME_MANIFEST.runtime_source_files,
  );
  assert.deepEqual(
    receipt.run.required_job_steps.map(({ name, status, conclusion }) => ({ name, status, conclusion })),
    GITHUB_PUBLICATION_POLICY.workflow.required_successful_steps.map((name) => ({
      name,
      status: "completed",
      conclusion: "success",
    })),
  );
  assert.equal(receipt.github_public_get_evidence.request_count, 15);
  assert.equal(receipt.github_public_get_evidence.responses.length, 15);
  assert.equal(
    receipt.anchor_at_head.implementation_binding_sha256,
    receipt.runtime_manifest_at_head.manifest_sha256,
  );
  assert.match(receipt.receipt_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(validateGitHubPublicationReceipt(receipt), receipt);
  assert.equal(canonicalJson(receipt), canonicalJson(JSON.parse(canonicalJson(receipt))));
});

test("repository and workflow identity gates reject lookalikes, tags, other SHAs, and unsuccessful runs", () => {
  const cases = [
    fixture({ repository: { id: 7 } }),
    fixture({ repository: { visibility: "private", private: true } }),
    fixture({ run: { workflow_id: 7 } }),
    fixture({ run: { path: ".github/workflows/lookalike.yml" } }),
    fixture({ run: { event: "workflow_dispatch" } }),
    fixture({ run: { head_branch: "v0.4.2" } }),
    fixture({ run: { head_sha: "3".repeat(40) } }),
    fixture({ run: { status: "in_progress", conclusion: null } }),
    fixture({ run: { conclusion: "failure" } }),
    fixture({ run: { head_repository: { id: 7, full_name: "owlsowo/finly-bot", private: false } } }),
  ];
  for (const value of cases) {
    assert.throws(() => validateGitHubPublicationEvidence(value), /gate failed|disagree/);
  }
});

test("parent runtime freeze requires one successful public push run strictly before the first close", () => {
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({
      parentFreezeRuns: { total_count: 0, workflow_runs: [] },
    })),
    /absent, ambiguous, or paginated/,
  );
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({
      parentRun: {
        created_at: "2026-08-31T20:00:00Z",
        run_started_at: "2026-08-31T20:00:01Z",
        updated_at: "2026-08-31T20:00:02Z",
      },
    })),
    /did not complete successfully before the activated first close/,
  );
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({ parentRun: { head_sha: HEAD_SHA } })),
    /did not complete successfully before the activated first close/,
  );
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({
      parentRun: {
        created_at: "2026-08-31T19:59:58Z",
        run_started_at: "2026-08-31T19:59:59Z",
        updated_at: "2026-08-31T20:00:01Z",
      },
    })),
    /did not complete successfully before the activated first close/,
  );

  const futureManifest = buildRuntimeManifest();
  futureManifest.frozen_at = "2026-08-30T05:00:00.000Z";
  rehashRuntimeManifest(futureManifest);
  const futureAnchor = buildAnchor({ runtimeManifest: futureManifest });
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({
      runtimeManifest: futureManifest,
      anchor: futureAnchor,
    })),
    /runtime manifest chronology/,
  );
});

test("anchor run creation must follow capture and strictly precede the deadline", () => {
  for (const createdAt of [
    "2026-08-31T20:14:59.000Z",
    "2026-08-31T20:15:59.000Z",
    "2026-08-31T20:16:00Z",
    "2026-09-01T20:00:00.000Z",
    "2026-09-01T20:00:01.000Z",
  ]) {
    assert.throws(
      () => validateGitHubPublicationEvidence(fixture({
        run: { created_at: createdAt, run_started_at: createdAt, updated_at: createdAt },
      })),
      /publication window/,
    );
  }
  assert.doesNotThrow(() => validateGitHubPublicationEvidence(fixture({
    run: {
      created_at: "2026-08-31T20:16:01Z",
      run_started_at: "2026-08-31T20:16:01Z",
      updated_at: "2026-08-31T20:16:01Z",
    },
  })));
});

test("job and named verification-step evidence must be complete and successful", () => {
  const wrongJob = fixture();
  wrongJob.jobs.jobs[0].name = "deploy";
  assert.throws(() => validateGitHubPublicationEvidence(wrongJob), /absent or ambiguous/);

  const failedJob = fixture();
  failedJob.jobs.jobs[0].conclusion = "failure";
  assert.throws(() => validateGitHubPublicationEvidence(failedJob), /job identity or conclusion/);

  const missingStep = fixture();
  missingStep.jobs.jobs[0].steps.pop();
  assert.throws(() => validateGitHubPublicationEvidence(missingStep), /did not succeed exactly once/);

  const incomplete = fixture();
  incomplete.jobs.total_count = 2;
  assert.throws(() => validateGitHubPublicationEvidence(incomplete), /incomplete or unbounded/);
});

test("publication commit must be one anchor-only addition atop the frozen parent", () => {
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({ commit: { parents: [{ sha: "4".repeat(40) }] } })),
    /one-parent extension/,
  );
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({
      commit: { parents: [{ sha: PARENT_SHA }, { sha: "4".repeat(40) }] },
    })),
    /one-parent extension/,
  );

  const extraFile = fixture();
  extraFile.commit.files.push({ filename: "README.md", status: "modified", additions: 1, deletions: 1, changes: 2 });
  assert.throws(() => validateGitHubPublicationEvidence(extraFile), /exactly one file/);

  const modifiedAnchor = fixture();
  modifiedAnchor.commit.files[0].status = "modified";
  assert.throws(() => validateGitHubPublicationEvidence(modifiedAnchor), /anchor-only file addition/);
});

test("activation self-hash and exact sequence-one activation chain fail closed", () => {
  const corruptActivation = structuredClone(ACTIVATION);
  corruptActivation.activation_sha256 = digest("f");
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({ activation: corruptActivation })),
    /activation hash is invalid/,
  );

  const runtimeManifest = buildRuntimeManifest(ACTIVATION);
  const wrongActivationHash = buildAnchor({ activation: ACTIVATION, runtimeManifest });
  wrongActivationHash.previous_private_bundle_sha256 = digest("e");
  rehashAnchor(wrongActivationHash);
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({ runtimeManifest, anchor: wrongActivationHash })),
    /private-bundle hash chain is broken/,
  );
});

test("a valid but different activation session cannot authorize the first anchor", () => {
  const activation = laterActivation();
  const runtimeManifest = buildRuntimeManifest(activation);
  const anchor = buildAnchor({ activation: ACTIVATION, runtimeManifest: buildRuntimeManifest(ACTIVATION) });
  anchor.previous_private_bundle_sha256 = activation.activation_sha256;
  anchor.formula.implementation_binding_sha256 = runtimeManifest.manifest_sha256;
  rehashAnchor(anchor);
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({ activation, runtimeManifest, anchor })),
    /first public anchor differs from the frozen activation session/,
  );
});

test("five-session cadence and remote runtime implementation binding are strict", () => {
  const cadence = buildAnchor();
  cadence.action = "HOLD";
  cadence.target_weights = structuredClone(ACTIVATION.payload.initial_state.current_allocation);
  rehashAnchor(cadence);
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({ anchor: cadence })),
    /five-session rebalance cadence/,
  );

  const implementation = buildAnchor();
  implementation.formula.implementation_binding_sha256 = digest("f");
  rehashAnchor(implementation);
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({ anchor: implementation })),
    /substitutes the frozen formula or source binding/,
  );
});

test("canonical activation, runtime-manifest, anchor bytes and workflow bytes fail closed", () => {
  for (const key of ["activationBytes", "runtimeManifestBytes", "anchorBytes"]) {
    const value = fixture();
    value[key] = JSON.stringify(JSON.parse(value[key]));
    assert.throws(() => validateGitHubPublicationEvidence(value), /not canonical repository JSON/);
  }

  const wrongFilename = fixture();
  wrongFilename.anchorPath = `${GITHUB_PUBLICATION_POLICY.anchor_directory}/00000001_${"f".repeat(64)}.json`;
  wrongFilename.commit.files[0].filename = wrongFilename.anchorPath;
  assert.throws(() => validateGitHubPublicationEvidence(wrongFilename), /strict sequence or manifest hash/);

  const workflowDrift = fixture({ workflowBytes: `${WORKFLOW_BYTES}\n# drift\n` });
  assert.throws(() => validateGitHubPublicationEvidence(workflowDrift), /changed the frozen verification workflow/);

  const sourceDrift = fixture();
  sourceDrift.runtimeSourceBytes["lib/forward_market_data.mjs"] += "// drift\n";
  assert.throws(
    () => validateGitHubPublicationEvidence(sourceDrift),
    /runtime source bytes differ from the frozen remote manifest/,
  );
});

test("executing verifier and complete local validator closure must byte-match the frozen parent", () => {
  assert.throws(
    () => validateGitHubPublicationEvidence(fixture({
      executingVerifierBytes: `${VERIFIER_SCRIPT_BYTES}\n// local verifier drift\n`,
    })),
    /parent verifier script differs from the executing local verifier/,
  );

  const remoteVerifierDrift = fixture({
    verifierScriptBytes: `${VERIFIER_SCRIPT_BYTES}\n// remote verifier drift\n`,
  });
  assert.throws(
    () => validateGitHubPublicationEvidence(remoteVerifierDrift),
    /parent verifier script differs from the executing local verifier/,
  );

  const localManifestDrift = fixture();
  localManifestDrift.executingRuntimeManifestBytes = `${localManifestDrift.runtimeManifestBytes} `;
  assert.throws(
    () => validateGitHubPublicationEvidence(localManifestDrift),
    /parent runtime manifest differs from the executing local runtime manifest/,
  );

  const localValidatorDrift = fixture();
  localValidatorDrift.executingRuntimeSourceBytes["research/forward_trial_live_core.mjs"] += "\n// drift\n";
  assert.throws(
    () => validateGitHubPublicationEvidence(localValidatorDrift),
    /parent runtime source differs from the executing local source/,
  );
});

test("fifteen public-GET observations bind fixed URLs, canonical HTTP Dates, and exact bodies", () => {
  const missing = fixture();
  missing.apiResponses.pop();
  assert.throws(
    () => validateGitHubPublicationEvidence(missing),
    /exactly fifteen fixed GETs/,
  );

  const reordered = fixture();
  [reordered.apiResponses[0], reordered.apiResponses[1]] = [
    reordered.apiResponses[1],
    reordered.apiResponses[0],
  ];
  assert.throws(
    () => validateGitHubPublicationEvidence(reordered),
    /differs from the fixed request registry/,
  );

  const wrongUrl = fixture();
  wrongUrl.apiResponses[0].canonical_url += "?redirected=1";
  assert.throws(
    () => validateGitHubPublicationEvidence(wrongUrl),
    /differs from the fixed request registry/,
  );

  const badDate = fixture();
  badDate.apiResponses[0].github_http_date = "2026-08-31T20:25:00Z";
  assert.throws(
    () => validateGitHubPublicationEvidence(badDate),
    /canonical GitHub HTTP Date/,
  );

  const bodyDrift = fixture();
  bodyDrift.apiResponses[0].response_bytes = Buffer.from(JSON.stringify({
    ...bodyDrift.repository,
    archived: true,
  }), "utf8");
  assert.throws(
    () => validateGitHubPublicationEvidence(bodyDrift),
    /body differs from the validated value/,
  );

  const rawBodyDrift = fixture();
  const workflowIndex = rawBodyDrift.apiResponses.findIndex(
    ({ request_id: requestId }) => requestId === "workflow_at_parent",
  );
  rawBodyDrift.apiResponses[workflowIndex].response_bytes = Buffer.from(`${WORKFLOW_BYTES}\n`, "utf8");
  assert.throws(
    () => validateGitHubPublicationEvidence(rawBodyDrift),
    /body differs from the validated bytes/,
  );

  const exactBytes = fixture();
  const repositoryBytes = Buffer.from(JSON.stringify(exactBytes.repository, null, 2), "utf8");
  exactBytes.apiResponses[0].response_bytes = repositoryBytes;
  exactBytes.apiResponses.at(-1).github_http_date = "Mon, 31 Aug 2026 20:26:00 GMT";
  const receipt = validateGitHubPublicationEvidence(exactBytes);
  assert.equal(receipt.github_public_get_evidence.responses[0].response_byte_length, repositoryBytes.length);
  assert.equal(receipt.github_public_get_evidence.responses[0].response_bytes_sha256, sha256Bytes(repositoryBytes));
  assert.equal(receipt.verification_observed_at, "2026-08-31T20:26:00.000Z");
});

test("receipt validation fails closed on public-pointer URL, observation-time, and artifact-hash drift", () => {
  const receipt = validateGitHubPublicationEvidence(fixture());

  const wrongUrl = structuredClone(receipt);
  wrongUrl.github_public_get_evidence.responses[0].canonical_url += "?elsewhere=1";
  rehashReceipt(wrongUrl);
  assert.throws(() => validateGitHubPublicationReceipt(wrongUrl), /reordered or points elsewhere/);

  const wrongObservation = structuredClone(receipt);
  wrongObservation.verification_observed_at = "2026-08-31T20:25:01.000Z";
  rehashReceipt(wrongObservation);
  assert.throws(() => validateGitHubPublicationReceipt(wrongObservation), /time-inconsistent/);

  const verifierHashDrift = structuredClone(receipt);
  const verifierObservation = verifierHashDrift.github_public_get_evidence.responses.find(
    ({ request_id: requestId }) => requestId === "verifier_at_parent",
  );
  verifierObservation.response_bytes_sha256 = digest("f");
  rehashReceipt(verifierHashDrift);
  assert.throws(
    () => validateGitHubPublicationReceipt(verifierHashDrift),
    /raw artifact hashes differ from their public-GET observations/,
  );
});

test("receipt observation time cannot precede any workflow or required-step completion", () => {
  const receipt = validateGitHubPublicationEvidence(fixture());

  const anchorRun = structuredClone(receipt);
  anchorRun.run.updated_at = "2026-08-31T20:25:01Z";
  rehashReceipt(anchorRun);
  assert.throws(
    () => validateGitHubPublicationReceipt(anchorRun),
    /anchor workflow completion postdates its public API observation/,
  );

  const requiredStep = structuredClone(receipt);
  requiredStep.run.required_job_steps[1].completed_at = "2026-08-31T20:25:01Z";
  rehashReceipt(requiredStep);
  assert.throws(
    () => validateGitHubPublicationReceipt(requiredStep),
    /required job step 2 completion postdates its public API observation/,
  );

  const parentFreeze = structuredClone(receipt);
  parentFreeze.parent_freeze_run.updated_at = "2026-08-31T20:25:01Z";
  rehashReceipt(parentFreeze);
  assert.throws(
    () => validateGitHubPublicationReceipt(parentFreeze),
    /parent-freeze completion postdates its public API observation/,
  );

  const equalBoundary = structuredClone(receipt);
  equalBoundary.run.updated_at = equalBoundary.verification_observed_at;
  equalBoundary.run.required_job_steps[1].completed_at = equalBoundary.verification_observed_at;
  rehashReceipt(equalBoundary);
  assert.equal(validateGitHubPublicationReceipt(equalBoundary), equalBoundary);
});

test("receipt validation detects later modification and preserves the assurance boundary", () => {
  const receipt = validateGitHubPublicationEvidence(fixture());
  const changed = structuredClone(receipt);
  changed.run.created_at = "2026-08-31T20:21:00.000Z";
  assert.throws(() => validateGitHubPublicationReceipt(changed), /self-hash/);

  const overclaim = structuredClone(receipt);
  overclaim.external_anchor_verified = true;
  const overclaimBody = { ...overclaim };
  delete overclaimBody.receipt_sha256;
  overclaim.receipt_sha256 = sha256Canonical(overclaimBody);
  assert.throws(() => validateGitHubPublicationReceipt(overclaim), /overclaims/);
});

function mockResponse(value, {
  url,
  accept,
  observedAt = "2026-08-31T20:25:00.000Z",
}) {
  const body = accept === "raw" ? value : JSON.stringify(value);
  return {
    ok: true,
    status: 200,
    redirected: false,
    url,
    headers: { get: (name) => name.toLowerCase() === "date" ? new Date(observedAt).toUTCString() : null },
    arrayBuffer: async () => Buffer.from(body, "utf8"),
  };
}

test("public REST orchestration performs exactly fifteen fixed unauthenticated GETs and no mutation", async () => {
  const value = fixture();
  const calls = [];
  const responses = new Map();
  const base = "https://api.github.com";
  responses.set(`${base}/repos/owlsowo/finly-bot`, [value.repository, "json"]);
  responses.set(`${base}/repos/owlsowo/finly-bot/actions/runs/${RUN_ID}`, [value.run, "json"]);
  responses.set(`${base}/repos/owlsowo/finly-bot/actions/runs/${RUN_ID}/jobs?per_page=100`, [value.jobs, "json"]);
  responses.set(`${base}/repos/owlsowo/finly-bot/commits/${HEAD_SHA}?per_page=100&page=1`, [value.commit, "json"]);
  responses.set(
    `${base}/repos/owlsowo/finly-bot/contents/${GITHUB_PUBLICATION_POLICY.activation_path}?ref=${PARENT_SHA}`,
    [value.activationBytes, "raw"],
  );
  responses.set(
    `${base}/repos/owlsowo/finly-bot/contents/${GITHUB_PUBLICATION_POLICY.runtime_manifest_path}?ref=${PARENT_SHA}`,
    [value.runtimeManifestBytes, "raw"],
  );
  for (const path of GITHUB_PUBLICATION_POLICY.runtime_source_paths) {
    responses.set(
      `${base}/repos/owlsowo/finly-bot/contents/${path}?ref=${PARENT_SHA}`,
      [value.runtimeSourceBytes[path], "raw"],
    );
  }
  responses.set(
    `${base}/repos/owlsowo/finly-bot/actions/workflows/${GITHUB_PUBLICATION_POLICY.workflow.id}/runs?branch=main&event=push&status=success&head_sha=${PARENT_SHA}&per_page=10`,
    [value.parentFreezeRuns, "json"],
  );
  responses.set(`${base}/repos/owlsowo/finly-bot/contents/${value.anchorPath}?ref=${HEAD_SHA}`, [value.anchorBytes, "raw"]);
  responses.set(`${base}/repos/owlsowo/finly-bot/contents/.github/workflows/ci.yml?ref=${PARENT_SHA}`, [WORKFLOW_BYTES, "raw"]);
  responses.set(
    `${base}/repos/owlsowo/finly-bot/contents/${GITHUB_PUBLICATION_POLICY.verifier_path}?ref=${PARENT_SHA}`,
    [VERIFIER_SCRIPT_BYTES, "raw"],
  );

  const fetchImpl = async (url, options) => {
    calls.push({ url: url.href, options: structuredClone(options) });
    const selected = responses.get(url.href);
    assert.ok(selected, `unexpected URL ${url.href}`);
    return mockResponse(selected[0], { url: url.href, accept: selected[1] });
  };
  const receipt = await fetchAndValidateGitHubPublication({
    runId: RUN_ID,
    anchorPath: value.anchorPath,
    expectedParentSha: PARENT_SHA,
    fetchImpl,
  });
  assert.equal(receipt.public_pre_deadline_publication_observed, true);
  assert.equal(receipt.github_public_get_evidence.request_count, 15);
  assert.equal(calls.length, 15);
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.redirect, "error");
    assert.equal(Object.keys(call.options.headers).some((key) => /authorization|token/i.test(key)), false);
    assert.ok(call.url === "https://api.github.com/repos/owlsowo/finly-bot"
      || call.url.startsWith("https://api.github.com/repos/owlsowo/finly-bot/"));
  }
});

test("CLI parser accepts exactly the three bounded publication identifiers", () => {
  assert.deepEqual(parseGitHubPublicationCli([
    "--anchor-path", `${GITHUB_PUBLICATION_POLICY.anchor_directory}/00000001_${"a".repeat(64)}.json`,
    "--expected-parent-sha", PARENT_SHA,
    "--run-id", String(RUN_ID),
  ]), {
    runId: RUN_ID,
    anchorPath: `${GITHUB_PUBLICATION_POLICY.anchor_directory}/00000001_${"a".repeat(64)}.json`,
    expectedParentSha: PARENT_SHA,
  });
  assert.throws(() => parseGitHubPublicationCli([]), /usage/);
  assert.throws(() => parseGitHubPublicationCli(["--run-id", "nope"]), /usage|positive integer/);
  assert.throws(() => parseGitHubPublicationCli([
    "--run-id", String(RUN_ID),
    "--anchor-path", "../secret.json",
    "--expected-parent-sha", PARENT_SHA,
  ]), /fixed public anchor directory/);
});

test("content-addressed receipt publication is canonical, idempotent, and race-safe", async () => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), "finly-github-receipt-"));
  try {
    const receipt = validateGitHubPublicationEvidence(fixture());
    const plan = githubPublicationReceiptPlan(receipt);
    assert.equal(plan.relativePath, `${GITHUB_PUBLICATION_RECEIPT_DIRECTORY}/${plan.filename}`);
    assert.deepEqual(plan.bytes, Buffer.from(canonicalJson(receipt), "utf8"));

    const first = await publishGitHubPublicationReceiptWriteOnce(receipt, { projectRoot });
    assert.equal(first.disposition, "created");
    assert.equal(first.path, plan.relativePath);
    assert.equal(first.receipt_sha256, receipt.receipt_sha256);
    assert.deepEqual(await readFile(resolve(projectRoot, first.path)), plan.bytes);

    const second = await publishGitHubPublicationReceiptWriteOnce(receipt, { projectRoot });
    assert.equal(second.disposition, "verified_existing");
    assert.equal(second.path, first.path);

    const directory = resolve(projectRoot, GITHUB_PUBLICATION_RECEIPT_DIRECTORY);
    assert.deepEqual(await readdir(directory), [plan.filename]);

    const concurrentRoot = await mkdtemp(resolve(tmpdir(), "finly-github-receipt-race-"));
    try {
      const outcomes = await Promise.all(Array.from({ length: 8 }, () => (
        publishGitHubPublicationReceiptWriteOnce(receipt, { projectRoot: concurrentRoot })
      )));
      assert.equal(outcomes.filter(({ disposition }) => disposition === "created").length, 1);
      assert.equal(outcomes.filter(({ disposition }) => disposition === "verified_existing").length, 7);
      assert.deepEqual(
        await readdir(resolve(concurrentRoot, GITHUB_PUBLICATION_RECEIPT_DIRECTORY)),
        [plan.filename],
      );
      assert.deepEqual(await readFile(resolve(concurrentRoot, plan.relativePath)), plan.bytes);
    } finally {
      await rm(concurrentRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("write-once publisher rejects collisions, symlinks, and receipt-controlled traversal without overwrite", async () => {
  const roots = [];
  try {
    const receipt = validateGitHubPublicationEvidence(fixture());
    const plan = githubPublicationReceiptPlan(receipt);

    const collisionRoot = await mkdtemp(resolve(tmpdir(), "finly-github-receipt-collision-"));
    roots.push(collisionRoot);
    const collisionDirectory = resolve(collisionRoot, GITHUB_PUBLICATION_RECEIPT_DIRECTORY);
    await mkdir(collisionDirectory, { recursive: true });
    const collisionPath = resolve(collisionDirectory, plan.filename);
    const collisionBytes = Buffer.from("different bytes\n", "utf8");
    await writeFile(collisionPath, collisionBytes, { flag: "wx" });
    await assert.rejects(
      publishGitHubPublicationReceiptWriteOnce(receipt, { projectRoot: collisionRoot }),
      /content-addressed incorrectly|differs at the same content address/,
    );
    assert.deepEqual(await readFile(collisionPath), collisionBytes);

    const symlinkRoot = await mkdtemp(resolve(tmpdir(), "finly-github-receipt-symlink-"));
    const outsideRoot = await mkdtemp(resolve(tmpdir(), "finly-github-receipt-outside-"));
    roots.push(symlinkRoot, outsideRoot);
    await mkdir(resolve(symlinkRoot, "research"));
    await symlink(outsideRoot, resolve(symlinkRoot, "research/forward_trial_live"), "dir");
    await assert.rejects(
      publishGitHubPublicationReceiptWriteOnce(receipt, { projectRoot: symlinkRoot }),
      /symlink or non-directory component/,
    );
    assert.deepEqual(await readdir(outsideRoot), []);

    const finalSymlinkRoot = await mkdtemp(resolve(tmpdir(), "finly-github-receipt-final-link-"));
    roots.push(finalSymlinkRoot);
    const finalDirectory = resolve(finalSymlinkRoot, GITHUB_PUBLICATION_RECEIPT_DIRECTORY);
    await mkdir(finalDirectory, { recursive: true });
    const outsideFile = resolve(outsideRoot, "outside.txt");
    const outsideBytes = Buffer.from("must remain unchanged\n", "utf8");
    await writeFile(outsideFile, outsideBytes, { flag: "wx" });
    const finalPath = resolve(finalDirectory, plan.filename);
    await symlink(outsideFile, finalPath, "file");
    assert.equal((await lstat(finalPath)).isSymbolicLink(), true);
    await assert.rejects(
      publishGitHubPublicationReceiptWriteOnce(receipt, { projectRoot: finalSymlinkRoot }),
      /cannot be safely verified/,
    );
    assert.deepEqual(await readFile(outsideFile), outsideBytes);

    const traversal = structuredClone(receipt);
    traversal.anchor_path = "../../outside.json";
    rehashReceipt(traversal);
    await assert.rejects(
      publishGitHubPublicationReceiptWriteOnce(traversal, { projectRoot: collisionRoot }),
      /fixed public anchor directory/,
    );
  } finally {
    await Promise.all(roots.map((path) => rm(path, { recursive: true, force: true })));
  }
});
