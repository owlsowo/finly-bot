import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  EXTERNAL_ATTEMPT115_ARTIFACT_PATHS,
  EXTERNAL_ATTEMPT115_SOURCE_URL,
  canonicalExternalAttempt115ProtocolJson,
  createExternalAttempt115ProtocolBody,
  sealExternalAttempt115Protocol,
} from "../research/external_validation_attempt115/protocol.mjs";
import { createExternalAttempt115OfficialTransport } from "../research/external_validation_attempt115/official_transport.mjs";
import * as runnerModule from "../research/external_validation_attempt115/runner.mjs";
import {
  EXTERNAL_ATTEMPT115_CLI_RELATIVE_PATH,
  EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH,
  EXTERNAL_ATTEMPT115_FROZEN_PROTOCOL_RELATIVE_PATH,
  EXTERNAL_ATTEMPT115_REQUIRED_NODE_VERSION,
  EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH,
  EXTERNAL_ATTEMPT115_RUN_START_SCHEMA,
  claimExternalAttempt115RunStart,
  computeExternalAttempt115ArtifactHashes,
  validateExternalAttempt115Runtime,
} from "../research/external_validation_attempt115/runner.mjs";

const REPOSITORY_ROOT = resolve(".");

function canonicalJson(value) {
  const sort = (item) => {
    if (Array.isArray(item)) return item.map(sort);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sort(child)]));
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

async function temporaryProject(context, { withProtocol = true } = {}) {
  const alias = await mkdtemp(join(tmpdir(), "finly-attempt115-runner-"));
  const root = await realpath(alias);
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const relativePath of [
    ...EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files,
    ...EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files,
  ]) {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(REPOSITORY_ROOT, relativePath), destination);
  }
  const hashes = await computeExternalAttempt115ArtifactHashes({ projectRoot: root });
  let protocol = null;
  if (withProtocol) {
    protocol = sealExternalAttempt115Protocol(createExternalAttempt115ProtocolBody({
      frozenAt: "2026-08-29T14:00:00.000Z",
      sourceFilesSha256: hashes.source_files_sha256,
      testFilesSha256: hashes.test_files_sha256,
    }));
    const protocolPath = join(root, EXTERNAL_ATTEMPT115_FROZEN_PROTOCOL_RELATIVE_PATH);
    await mkdir(dirname(protocolPath), { recursive: true });
    await writeFile(protocolPath, canonicalExternalAttempt115ProtocolJson(protocol), {
      flag: "wx",
      mode: 0o600,
    });
  }
  return { root, protocol, hashes };
}

function sanitizedEnvironment(extra = {}) {
  return { ...extra };
}

test("runtime validator rejects a Node or package-engine drift", async () => {
  const packageJsonBytes = await readFile(join(REPOSITORY_ROOT, "package.json"));
  const packageLockBytes = await readFile(join(REPOSITORY_ROOT, "package-lock.json"));
  const valid = validateExternalAttempt115Runtime({
    packageJsonBytes,
    packageLockBytes,
    observedNodeVersion: EXTERNAL_ATTEMPT115_REQUIRED_NODE_VERSION,
  });
  assert.equal(valid.node_version, EXTERNAL_ATTEMPT115_REQUIRED_NODE_VERSION);
  assert.throws(() => validateExternalAttempt115Runtime({
    packageJsonBytes,
    packageLockBytes,
    observedNodeVersion: "v0.0.0",
  }), /requires exact Node v26\.7\.0/u);
});

test("official native transport rejects any caller-shaped request before networking", async () => {
  const transport = createExternalAttempt115OfficialTransport();
  await assert.rejects(transport.fetch("https://example.test/data.zip", {}),
    /request envelope changed/u);
  await assert.rejects(transport.fetch(EXTERNAL_ATTEMPT115_SOURCE_URL, {
    method: "POST",
  }), /request controls changed/u);
  assert.throws(() => transport.evidence(), /no single completed response evidence/u);
});

test("artifact hashing binds every frozen raw source and test byte", async (context) => {
  const { root, hashes } = await temporaryProject(context, { withProtocol: false });
  assert.equal(Object.keys(hashes.source_files_sha256).length,
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files.length);
  assert.equal(Object.keys(hashes.test_files_sha256).length,
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files.length);
  await writeFile(join(root, "research/external_validation_attempt115/inference.mjs"),
    "// changed after hash\n");
  const changed = await computeExternalAttempt115ArtifactHashes({ projectRoot: root });
  assert.notEqual(changed.artifact_set_sha256, hashes.artifact_set_sha256);
});

test("authoritative runner exposes no caller-controlled one-shot API", () => {
  assert.equal(Object.hasOwn(runnerModule, "runExternalAttempt115Once"), false);
  assert.equal(
    EXTERNAL_ATTEMPT115_FROZEN_PROTOCOL_RELATIVE_PATH,
    "research/external_validation_attempt115/attempt118_frozen_protocol.json",
  );
  assert.equal(
    EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH,
    "data/external_validation_attempt115/attempt118",
  );
  assert.equal(
    EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH,
    "data/external_validation_attempt115/attempt118.run-start.json",
  );
});

test("one atomic marker wins and permanently blocks every same-protocol retry", async (context) => {
  const { root, protocol, hashes } = await temporaryProject(context);
  const options = {
    projectRoot: root,
    protocol,
    artifactBinding: hashes,
    processBoundary: {
      schema_version: "invented_process_boundary_for_claim_unit_test",
      authority: "NONE",
    },
  };
  const attempts = await Promise.allSettled([
    claimExternalAttempt115RunStart(options),
    claimExternalAttempt115RunStart(options),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  assert.match(attempts.find((item) => item.status === "rejected").reason.message,
    /claimed|retry is forbidden/u);
  const claim = attempts.find((item) => item.status === "fulfilled").value;
  assert.equal(claim.marker.schema_version, EXTERNAL_ATTEMPT115_RUN_START_SCHEMA);
  assert.equal(claim.marker.fixed_output_relative_path,
    EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH);
  assert.equal(claim.marker.run_start_marker_sha256,
    sha256(Object.fromEntries(Object.entries(claim.marker)
      .filter(([key]) => key !== "run_start_marker_sha256"))));
  assert.ok(Number.isInteger(claim.marker_identity.dev));
  assert.ok(Number.isInteger(claim.marker_identity.ino));
  const markerText = await readFile(join(root, EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH),
    "utf8");
  assert.equal(markerText, canonicalJson(JSON.parse(markerText)));
  await assert.rejects(
    claimExternalAttempt115RunStart(options),
    /claimed|retry is forbidden/u,
  );
  await assert.rejects(
    readFile(join(root, EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH)),
    { code: "ENOENT" },
  );
});

test("fixed CLI rejects arguments, execArgv, and injected environment before run claim", async () => {
  const cliPath = join(REPOSITORY_ROOT, EXTERNAL_ATTEMPT115_CLI_RELATIVE_PATH);
  const markerPath = join(REPOSITORY_ROOT, EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH);
  await assert.rejects(readFile(markerPath), { code: "ENOENT" });
  const cases = [
    { args: [cliPath, "unexpected"], env: sanitizedEnvironment(), expected: /no positional arguments/u },
    { args: ["--trace-warnings", cliPath], env: sanitizedEnvironment(), expected: /execArgv/u },
    {
      args: [
        "--import=data:text/javascript,globalThis.fetch=async()=>{};globalThis.Date.now=()=>0",
        cliPath,
      ],
      env: sanitizedEnvironment(),
      expected: /execArgv/u,
    },
    { args: ["--require=node:path", cliPath], env: sanitizedEnvironment(), expected: /execArgv/u },
    { args: [cliPath], env: sanitizedEnvironment({ NODE_OPTIONS: "--trace-warnings" }),
      expected: /NODE_OPTIONS/u },
    { args: [cliPath], env: sanitizedEnvironment({ HTTPS_PROXY: "http://127.0.0.1:1" }),
      expected: /HTTPS_PROXY/u },
    { args: [cliPath], env: sanitizedEnvironment({ LD_LIBRARY_PATH: "/invented" }),
      expected: /LD_LIBRARY_PATH/u },
  ];
  for (const item of cases) {
    const result = spawnSync(process.execPath, item.args, {
      cwd: REPOSITORY_ROOT,
      env: item.env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, item.expected);
  }
  await assert.rejects(readFile(markerPath), { code: "ENOENT" });
});

test("fixed launcher strips inherited Node options before starting the authoritative child", async (context) => {
  const { root } = await temporaryProject(context, { withProtocol: false });
  const launcherPath = join(
    root,
    "research/external_validation_attempt115/run_once.mjs",
  );
  const result = spawnSync(process.execPath, [launcherPath], {
    cwd: root,
    env: sanitizedEnvironment({ NODE_OPTIONS: "--trace-warnings" }),
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stderr, /execArgv|NODE_OPTIONS/u);
  assert.match(result.stderr, /frozen_protocol\.json|bound artifact/u);
  await assert.rejects(
    readFile(join(root, EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH)),
    { code: "ENOENT" },
  );
});
