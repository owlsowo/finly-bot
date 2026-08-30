import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../lib/canonical.mjs";
import {
  ATTEMPT114_FIRST_SIGNAL_CLOSE_AT,
  ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256,
} from "../research/prospective_attempt114/protocol.mjs";
import {
  ATTEMPT114_GITHUB_PUBLICATION_RECEIPT_SCHEMA,
  ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256,
  ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH,
  ATTEMPT114_RUNTIME_MANIFEST_SCHEMA,
  ATTEMPT114_RUNTIME_SOURCE_PATHS,
  buildProspectiveAttempt114GitHubPublicationReceipt,
  buildProspectiveAttempt114RuntimeManifest,
  canonicalProspectiveAttempt114RuntimeManifestJson,
  hashProspectiveAttempt114RuntimeManifest,
  validateProspectiveAttempt114GitHubPublicationReceipt,
  validateProspectiveAttempt114RuntimeManifest,
  verifyProspectiveAttempt114GitHubPublicationEvidence,
  verifyProspectiveAttempt114RuntimeManifestSources,
} from "../research/prospective_attempt114/runtime.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const FROZEN_AT = "2026-08-30T05:00:00.000Z";
const FROZEN_RUNTIME_MANIFEST_SHA256 =
  "sha256:29a4c21d2acaf01489f21546b3ca75e9b6203705bcd22a629f017bd3d0fb18e1";
const FROZEN_RUNTIME_MANIFEST_RAW_BYTES_SHA256 =
  "sha256:c3fbcb985385ef9dcbc118824a6e318b1e39f45b290e180a6a1f1f0865ea9966";

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

function rehashManifest(value) {
  value.manifest_sha256 = hashProspectiveAttempt114RuntimeManifest(value);
  return value;
}

function rehashReceipt(value) {
  const body = structuredClone(value);
  delete body.receipt_sha256;
  value.receipt_sha256 = sha256(body);
  return value;
}

async function sourceBytes() {
  return Object.fromEntries(await Promise.all(ATTEMPT114_RUNTIME_SOURCE_PATHS.map(async (sourcePath) => [
    sourcePath,
    await readFile(path.join(PROJECT_ROOT, sourcePath)),
  ])));
}

async function temporaryRuntimeProject(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "finly-attempt114-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const sourcePath of ATTEMPT114_RUNTIME_SOURCE_PATHS) {
    const destination = path.join(root, sourcePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(PROJECT_ROOT, sourcePath), destination);
  }
  return root;
}

function githubMetadata() {
  const headSha = "a".repeat(40);
  return {
    repository: {
      id: 1_350_112_497,
      full_name: "owlsowo/finly-bot",
      public: true,
      default_branch: "main",
    },
    publication_commit: {
      sha: headSha,
      parent_sha: "b".repeat(40),
      tree_sha: "c".repeat(40),
      html_url: `https://github.com/owlsowo/finly-bot/commit/${headSha}`,
    },
    workflow_run: {
      id: 33_292_162_176,
      workflow_id: 344_996_171,
      name: "Verify Finly",
      path: ".github/workflows/ci.yml",
      event: "push",
      head_branch: "main",
      head_sha: headSha,
      run_attempt: 1,
      status: "completed",
      conclusion: "success",
      created_at: "2026-08-30T05:00:10Z",
      updated_at: "2026-08-30T05:04:00Z",
      html_url: "https://github.com/owlsowo/finly-bot/actions/runs/33292162176",
      verification_job: {
        id: 94_400_001,
        name: "verify",
        head_sha: headSha,
        status: "completed",
        conclusion: "success",
        started_at: "2026-08-30T05:00:30Z",
        completed_at: "2026-08-30T05:03:50Z",
        required_steps: [
          {
            name: "Run npm run verify",
            number: 6,
            status: "completed",
            conclusion: "success",
            started_at: "2026-08-30T05:00:31Z",
            completed_at: "2026-08-30T05:03:00Z",
          },
          {
            name: "Generated receipts are committed and reproducible",
            number: 7,
            status: "completed",
            conclusion: "success",
            started_at: "2026-08-30T05:03:01Z",
            completed_at: "2026-08-30T05:03:49Z",
          },
        ],
      },
    },
    verification_observed_at: "2026-08-30T05:05:00.000Z",
  };
}

async function publicationInput() {
  const manifest = await buildProspectiveAttempt114RuntimeManifest({ frozen_at: FROZEN_AT });
  return {
    ...githubMetadata(),
    protocol_bytes: await readFile(path.join(
      PROJECT_ROOT,
      "research/prospective_attempt114/protocol.json",
    )),
    runtime_manifest_bytes: Buffer.from(
      canonicalProspectiveAttempt114RuntimeManifestJson(manifest),
      "utf8",
    ),
    runtime_source_bytes: await sourceBytes(),
  };
}

test("Attempt 114 checked-in runtime manifest has canonical bytes, exact self-hash, and exact source closure", async () => {
  const manifestBytes = await readFile(path.join(PROJECT_ROOT, ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifestBytes.toString("utf8"),
    canonicalProspectiveAttempt114RuntimeManifestJson(manifest));
  validateProspectiveAttempt114RuntimeManifest(manifest);
  assert.equal(manifest.manifest_sha256, FROZEN_RUNTIME_MANIFEST_SHA256);
  assert.equal(
    `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
    FROZEN_RUNTIME_MANIFEST_RAW_BYTES_SHA256,
  );
  const independentlyRebuilt = await buildProspectiveAttempt114RuntimeManifest({
    frozen_at: manifest.frozen_at,
  });
  assert.deepEqual(independentlyRebuilt, manifest);
  const receipt = await verifyProspectiveAttempt114RuntimeManifestSources(manifest);
  assert.equal(receipt.manifest_sha256, FROZEN_RUNTIME_MANIFEST_SHA256);
  assert.equal(manifest.evaluation_gates.protocol_runtime_publication_verified, false);
  assert.equal(manifest.assurance.independent_cryptographic_timestamp_verified, false);
  assert.equal(manifest.assurance.provider_origin_verified, false);
});

test("Attempt 114 runtime builder binds the exact protocol, complete source closure, and closed authority", async () => {
  const first = await buildProspectiveAttempt114RuntimeManifest({ frozen_at: FROZEN_AT });
  const second = await buildProspectiveAttempt114RuntimeManifest({ frozen_at: FROZEN_AT });
  assert.deepEqual(first, second);
  assert.equal(first.schema_version, ATTEMPT114_RUNTIME_MANIFEST_SCHEMA);
  assert.equal(first.frozen_at, FROZEN_AT);
  assert.equal(first.publication_deadline, ATTEMPT114_FIRST_SIGNAL_CLOSE_AT);
  assert.equal(first.publication_deadline_exclusive, true);
  assert.equal(first.protocol.raw_bytes_sha256, ATTEMPT114_PROTOCOL_RAW_BYTES_SHA256);
  assert.deepEqual(Object.keys(first.runtime_source_files).sort(),
    [...ATTEMPT114_RUNTIME_SOURCE_PATHS].sort());
  assert.equal(first.runtime_source_files_sha256, sha256(first.runtime_source_files));
  for (const [sourcePath, expectedHash] of Object.entries(
    ATTEMPT114_UPSTREAM_RAW_BYTES_SHA256,
  )) {
    assert.equal(first.runtime_source_files[sourcePath], expectedHash);
  }
  assert.deepEqual(first.authority, {
    research_only: true,
    broker_reads_permitted: false,
    broker_mutation_authorized: false,
    network_requests_permitted: false,
    persistence_authorized: false,
    order_payload: null,
  });
  assert.deepEqual(first.evaluation_gates, {
    protocol_runtime_publication_verified: false,
    settlement_enabled: false,
    inference_enabled: false,
  });
  assertDeepFrozen(first);
  const receipt = await verifyProspectiveAttempt114RuntimeManifestSources(first);
  assert.equal(receipt.source_files_verified, ATTEMPT114_RUNTIME_SOURCE_PATHS.length);
  assert.equal(receipt.source_bytes_verified, true);
  assert.equal(receipt.broker_or_network_mutation_authorized, false);
  assertDeepFrozen(receipt);
});

test("Attempt 114 runtime validation rejects unknown, missing, late, and semantically weakened fields", async () => {
  const manifest = await buildProspectiveAttempt114RuntimeManifest({ frozen_at: FROZEN_AT });
  const unknown = structuredClone(manifest);
  unknown.surprise = true;
  assert.throws(() => validateProspectiveAttempt114RuntimeManifest(unknown), /must contain exactly/u);

  const missingSource = structuredClone(manifest);
  delete missingSource.runtime_source_files["research/prospective_attempt114/inference.mjs"];
  missingSource.runtime_source_files_sha256 = sha256(missingSource.runtime_source_files);
  rehashManifest(missingSource);
  assert.throws(() => validateProspectiveAttempt114RuntimeManifest(missingSource),
    /source map must contain exactly/u);

  const late = structuredClone(manifest);
  late.frozen_at = ATTEMPT114_FIRST_SIGNAL_CLOSE_AT;
  rehashManifest(late);
  assert.throws(() => validateProspectiveAttempt114RuntimeManifest(late), /strictly before/u);

  const openGate = structuredClone(manifest);
  openGate.evaluation_gates.inference_enabled = true;
  rehashManifest(openGate);
  assert.throws(() => validateProspectiveAttempt114RuntimeManifest(openGate), /runtime gates changed/u);

  const falseOriginClaim = structuredClone(manifest);
  falseOriginClaim.assurance.provider_origin_verified = true;
  rehashManifest(falseOriginClaim);
  assert.throws(() => validateProspectiveAttempt114RuntimeManifest(falseOriginClaim),
    /runtime assurance changed/u);
});

test("Attempt 114 executing-source verification fails closed on tampering, absence, and symlinks", async (t) => {
  const manifest = await buildProspectiveAttempt114RuntimeManifest({ frozen_at: FROZEN_AT });

  const tamperedRoot = await temporaryRuntimeProject(t);
  const settlementPath = path.join(
    tamperedRoot,
    "research/prospective_attempt114/settlement.mjs",
  );
  await writeFile(settlementPath, `${await readFile(settlementPath, "utf8")}\n`, "utf8");
  await assert.rejects(
    verifyProspectiveAttempt114RuntimeManifestSources(manifest, { projectRoot: tamperedRoot }),
    /executing source bytes differ/u,
  );

  const missingRoot = await temporaryRuntimeProject(t);
  await unlink(path.join(missingRoot, "research/prospective_attempt114/decomposition.mjs"));
  await assert.rejects(
    verifyProspectiveAttempt114RuntimeManifestSources(manifest, { projectRoot: missingRoot }),
    /ENOENT/u,
  );

  const symlinkRoot = await temporaryRuntimeProject(t);
  const linkedPath = path.join(symlinkRoot, "research/prospective_attempt114/inference.mjs");
  await unlink(linkedPath);
  await symlink(
    path.join(PROJECT_ROOT, "research/prospective_attempt114/inference.mjs"),
    linkedPath,
  );
  await assert.rejects(
    verifyProspectiveAttempt114RuntimeManifestSources(manifest, { projectRoot: symlinkRoot }),
    /traverses a symbolic link/u,
  );
});

test("Attempt 114 GitHub receipt verifies public pre-deadline publication without overstating assurance", async () => {
  const input = await publicationInput();
  const receipt = buildProspectiveAttempt114GitHubPublicationReceipt(input);
  assert.equal(receipt.schema_version, ATTEMPT114_GITHUB_PUBLICATION_RECEIPT_SCHEMA);
  assert.equal(receipt.exclusive_deadline, ATTEMPT114_FIRST_SIGNAL_CLOSE_AT);
  assert.equal(receipt.assurance.public_pre_deadline_publication_observed, true);
  assert.equal(receipt.assurance.github_platform_record_only, true);
  assert.equal(receipt.assurance.self_contained_offline_evidence, false);
  assert.equal(receipt.assurance.independent_cryptographic_timestamp_verified, false);
  assert.equal(receipt.assurance.provider_origin_verified, false);
  assert.equal(receipt.assurance.broker_execution_verified, false);
  assert.equal(receipt.assurance.performance_inference_permitted, false);
  assert.equal(receipt.published_artifacts.runtime_manifest.path,
    ATTEMPT114_RUNTIME_MANIFEST_RELATIVE_PATH);
  assertDeepFrozen(receipt);
  const verified = verifyProspectiveAttempt114GitHubPublicationEvidence({
    receipt,
    protocol_bytes: input.protocol_bytes,
    runtime_manifest_bytes: input.runtime_manifest_bytes,
    runtime_source_bytes: input.runtime_source_bytes,
  });
  assert.equal(verified.receipt_sha256, receipt.receipt_sha256);
  assertDeepFrozen(verified);
});

test("Attempt 114 GitHub receipt rejects deadline equality, linkage drift, false assurance, and byte drift", async () => {
  const input = await publicationInput();
  const receipt = buildProspectiveAttempt114GitHubPublicationReceipt(input);

  const atDeadline = structuredClone(receipt);
  atDeadline.workflow_run.updated_at = ATTEMPT114_FIRST_SIGNAL_CLOSE_AT;
  atDeadline.workflow_run.verification_job.completed_at = ATTEMPT114_FIRST_SIGNAL_CLOSE_AT;
  atDeadline.workflow_run.verification_job.required_steps[1].completed_at =
    ATTEMPT114_FIRST_SIGNAL_CLOSE_AT;
  atDeadline.verification_observed_at = "2026-09-01T00:00:00.000Z";
  rehashReceipt(atDeadline);
  assert.throws(() => validateProspectiveAttempt114GitHubPublicationReceipt(atDeadline),
    /strict pre-deadline|successful pre-deadline/u);

  const wrongHead = structuredClone(receipt);
  wrongHead.workflow_run.head_sha = "d".repeat(40);
  wrongHead.workflow_run.verification_job.head_sha = "d".repeat(40);
  rehashReceipt(wrongHead);
  assert.throws(() => validateProspectiveAttempt114GitHubPublicationReceipt(wrongHead),
    /strict pre-deadline run/u);

  for (const field of ["independent_cryptographic_timestamp_verified", "provider_origin_verified"]) {
    const overclaim = structuredClone(receipt);
    overclaim.assurance[field] = true;
    rehashReceipt(overclaim);
    assert.throws(() => validateProspectiveAttempt114GitHubPublicationReceipt(overclaim),
      /publication assurance changed/u);
  }

  const driftedSources = { ...input.runtime_source_bytes };
  driftedSources["research/prospective_attempt114/inference.mjs"] = Buffer.from("tampered\n");
  assert.throws(() => buildProspectiveAttempt114GitHubPublicationReceipt({
    ...input,
    runtime_source_bytes: driftedSources,
  }), /published runtime source bytes differ/u);

  const driftedManifestBytes = Buffer.concat([input.runtime_manifest_bytes, Buffer.from(" ")]);
  assert.throws(() => buildProspectiveAttempt114GitHubPublicationReceipt({
    ...input,
    runtime_manifest_bytes: driftedManifestBytes,
  }), /not canonical pretty JSON/u);
});

test("Attempt 114 runtime validator contains no broker, network, order, or write mutation surface", async () => {
  const source = await readFile(path.join(
    PROJECT_ROOT,
    "research/prospective_attempt114/runtime.mjs",
  ), "utf8");
  for (const forbidden of [
    /\bfetch\s*\(/u,
    /node:https/u,
    /https\.request/u,
    /\bwriteFile\s*\(/u,
    /\bappendFile\s*\(/u,
    /\blink\s*\(/u,
    /\brename\s*\(/u,
    /place_order/u,
    /cancel_order/u,
    /replace_order/u,
    /submitOrder/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
