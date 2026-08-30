import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  parseKennethFrenchDailyFactorCsv,
} from "../research/external_validation_attempt115/kenneth_french_daily_factor_adapter.mjs";
import {
  INDUSTRY_VM_G4_ARTIFACT_PATHS,
  INDUSTRY_VM_G4_FACTOR_ARTIFACT_RELATIVE_PATH,
  INDUSTRY_VM_G4_FIXED_OUTPUT_RELATIVE_PATH,
  INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV,
  INDUSTRY_VM_G4_REQUIRED_NODE_VERSION,
  INDUSTRY_VM_G4_RUN_ONCE_RELATIVE_PATH,
  createIndustryVmG4ProtocolBody,
  sealIndustryVmG4Protocol,
} from "../research/industry_vm_g4_external/protocol.mjs";
import {
  assertIndustryVmG4Runtime,
  buildIndustryVmG4FailureReceipt,
  claimIndustryVmG4RunStart,
  computeIndustryVmG4ArtifactHashes,
  proveIndustryVmG4SyntheticPipeline,
  validateIndustryVmG4ArchiveMemberName,
} from "../research/industry_vm_g4_external/run_once.mjs";
import * as runOnceModule from "../research/industry_vm_g4_external/run_once.mjs";

const REPOSITORY_ROOT = resolve(".");
const MEMORY_PROBE_ENV = "FINLY_INDUSTRY_VM_G4_OFFICIAL_SCALE_HEAP_PROOF";
const IS_MEMORY_PROBE = process.env[MEMORY_PROBE_ENV] === "1";

function ordinaryTest(...args) {
  return IS_MEMORY_PROBE ? test.skip(...args) : test(...args);
}

function memoryProbeTest(...args) {
  return IS_MEMORY_PROBE ? test(...args) : test.skip(...args);
}

async function temporaryProject(context) {
  const alias = await mkdtemp(join(tmpdir(), "finly-industry-attempt149-"));
  const root = await realpath(alias);
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const relativePath of [
    ...INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files,
    ...INDUSTRY_VM_G4_ARTIFACT_PATHS.test_files,
    INDUSTRY_VM_G4_FACTOR_ARTIFACT_RELATIVE_PATH,
  ]) {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(REPOSITORY_ROOT, relativePath), destination);
  }
  const hashes = await computeIndustryVmG4ArtifactHashes({ projectRoot: root });
  const protocol = sealIndustryVmG4Protocol(createIndustryVmG4ProtocolBody({
    frozenAt: "2026-08-30T12:00:00.000Z",
    sourceFilesSha256: hashes.source_files_sha256,
    testFilesSha256: hashes.test_files_sha256,
  }));
  return { root, hashes, protocol };
}

async function createOfficialScaleSyntheticArchive(root) {
  const factors = parseKennethFrenchDailyFactorCsv(await readFile(
    join(root, INDUSTRY_VM_G4_FACTOR_ARTIFACT_RELATIVE_PATH),
    "utf8",
  ));
  const rows = factors.rows.map(({ date }, index) => {
    const values = Array.from({ length: 10 }, (_, symbolIndex) => (
      0.025
      + 0.018 * Math.sin((index + symbolIndex * 17) / (8 + symbolIndex))
      + 0.006 * Math.cos((index + symbolIndex * 31) / (27 + symbolIndex))
      + (symbolIndex === 4 ? 0.035 : symbolIndex * 0.001)
    ).toFixed(6));
    return `${date.replaceAll("-", "")},${values.join(",")}`;
  });
  const header = ",NoDur,Durbl,Manuf,Enrgy,HiTec,Telcm,Shops,Hlth,Utils,Other";
  const memberPath = join(root, "10_Industry_Portfolios_Daily.CSV");
  await writeFile(memberPath, [
    "Synthetic official-scale memory proof; no official industry values.",
    "Average Value Weighted Returns -- Daily",
    header,
    ...rows,
    "",
    "Average Equal Weighted Returns -- Daily",
    header,
    ...rows,
    "",
  ].join("\n"), { flag: "wx", mode: 0o600 });
  const archivePath = join(root, "synthetic-official-scale.zip");
  const zipped = spawnSync("/usr/bin/zip", ["-q", "-j", "-X", archivePath, memberPath], {
    cwd: root,
    env: {},
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(zipped.status, 0, zipped.stderr);
  return readFile(archivePath);
}

ordinaryTest("archive member matching is ASCII case-folded and traversal-safe", () => {
  assert.equal(
    validateIndustryVmG4ArchiveMemberName("10_Industry_Portfolios_Daily.CSV"),
    "10_Industry_Portfolios_Daily.CSV",
  );
  assert.equal(
    validateIndustryVmG4ArchiveMemberName("10_industry_portfolios_daily.csv"),
    "10_industry_portfolios_daily.csv",
  );
  for (const name of [
    "folder/10_Industry_Portfolios_Daily.CSV",
    "../10_Industry_Portfolios_Daily.CSV",
    "10_Industry_Portfolios_Daily.CSV/",
    "10_Industry_Portfolios_Daíly.CSV",
    "wrong.csv",
  ]) {
    assert.throws(() => validateIndustryVmG4ArchiveMemberName(name), /member|ASCII/iu);
  }
});

ordinaryTest("the consuming Attempt149 runner is not an injectable module export", () => {
  assert.equal(Object.hasOwn(runOnceModule, "runIndustryVmG4ExternalOnce"), false);
  assert.equal(typeof runOnceModule.proveIndustryVmG4SyntheticPipeline, "function");
});

ordinaryTest("raw artifact hash binding detects any byte change", async (context) => {
  const { root, hashes } = await temporaryProject(context);
  assert.equal(Object.keys(hashes.source_files_sha256).length,
    INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files.length);
  await copyFile(
    join(root, "package-lock.json"),
    join(root, "package.json"),
  );
  const changed = await computeIndustryVmG4ArtifactHashes({ projectRoot: root });
  assert.notEqual(changed.artifact_set_sha256, hashes.artifact_set_sha256);
});

ordinaryTest("one atomic run-start marker wins and permanently rejects the same attempt", async (context) => {
  const { root, hashes, protocol } = await temporaryProject(context);
  const options = {
    projectRoot: root,
    protocol,
    artifactBinding: hashes,
    now: new Date("2026-08-30T12:01:00.000Z"),
  };
  const attempts = await Promise.allSettled([
    claimIndustryVmG4RunStart(options),
    claimIndustryVmG4RunStart(options),
  ]);
  assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
  assert.match(
    attempts.find(({ status }) => status === "rejected").reason.message,
    /already claimed|retry is forbidden/iu,
  );
  await assert.rejects(claimIndustryVmG4RunStart(options), /already claimed|retry is forbidden/iu);
});

ordinaryTest("runtime is exact Node 26.7.0 with only the bound 256 MiB old-space argument", () => {
  assert.equal(assertIndustryVmG4Runtime({
    nodeVersion: INDUSTRY_VM_G4_REQUIRED_NODE_VERSION,
    execArgv: [...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV],
    nodeOptions: undefined,
  }), true);
  for (const invalid of [
    { nodeVersion: "v26.7.1", execArgv: [...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV] },
    { nodeVersion: INDUSTRY_VM_G4_REQUIRED_NODE_VERSION, execArgv: [] },
    {
      nodeVersion: INDUSTRY_VM_G4_REQUIRED_NODE_VERSION,
      execArgv: [...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV, "--trace-warnings"],
    },
    { nodeVersion: INDUSTRY_VM_G4_REQUIRED_NODE_VERSION, execArgv: ["--max-old-space-size=512"] },
    {
      nodeVersion: INDUSTRY_VM_G4_REQUIRED_NODE_VERSION,
      execArgv: [...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV],
      nodeOptions: "--trace-warnings",
    },
  ]) {
    assert.throws(() => assertIndustryVmG4Runtime(invalid), /exact Node|execArgv|NODE_OPTIONS/iu);
  }
});

ordinaryTest("failure receipts distinguish observed outcomes while every marker consumes the attempt", () => {
  const sourceFilesSha256 = Object.fromEntries(
    INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files.map((path) => [path, sha256(`source:${path}`)]),
  );
  const testFilesSha256 = Object.fromEntries(
    INDUSTRY_VM_G4_ARTIFACT_PATHS.test_files.map((path) => [path, sha256(`test:${path}`)]),
  );
  const protocol = sealIndustryVmG4Protocol(createIndustryVmG4ProtocolBody({
    frozenAt: "2026-08-30T12:00:00.000Z",
    sourceFilesSha256,
    testFilesSha256,
  }));
  const marker = { run_start_marker_sha256: sha256("marker") };
  for (const outcomesObserved of [false, true]) {
    const receipt = buildIndustryVmG4FailureReceipt({
      protocol,
      marker,
      error: new Error("synthetic failure"),
      outcomesObserved,
      failedAt: "2026-08-30T12:05:00.000Z",
    });
    assert.equal(receipt.outcomes_observed, outcomesObserved);
    assert.equal(receipt.one_time_attempt_consumed, true);
    assert.equal(receipt.run_start_permanently_consumed_operational_attempt, true);
    assert.equal(receipt.retry_permitted, false);
    assert.equal(receipt.same_attempt_retry_permitted, false);
    assert.equal(receipt.successor_requires_new_preregistered_protocol, true);
    const body = Object.fromEntries(
      Object.entries(receipt).filter(([key]) => key !== "failure_receipt_sha256"),
    );
    assert.equal(receipt.failure_receipt_sha256, sha256(body));
  }
});

ordinaryTest("direct CLI rejects arguments before any acquisition", () => {
  const result = spawnSync(process.execPath, [
    ...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV,
    join(REPOSITORY_ROOT, INDUSTRY_VM_G4_RUN_ONCE_RELATIVE_PATH),
    "unexpected",
  ], {
    cwd: REPOSITORY_ROOT,
    env: {},
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /accepts no arguments/iu);
});

ordinaryTest("direct CLI rejects missing, extra, or environment-injected Node options", () => {
  const script = join(REPOSITORY_ROOT, INDUSTRY_VM_G4_RUN_ONCE_RELATIVE_PATH);
  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== "NODE_OPTIONS"),
  );
  const cases = [
    { args: [script], env: cleanEnvironment, expected: /execArgv/iu },
    {
      args: [...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV, "--trace-warnings", script],
      env: cleanEnvironment,
      expected: /execArgv/iu,
    },
    {
      args: [...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV, script],
      env: { ...cleanEnvironment, NODE_OPTIONS: "--trace-warnings" },
      expected: /NODE_OPTIONS/iu,
    },
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
    assert.doesNotMatch(result.stderr, /frozen_protocol\.json/iu);
  }
});

ordinaryTest("official-scale parser, adapter, and evaluator fit the exact 256 MiB old-space policy", {
  timeout: 120_000,
}, () => {
  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => (
      name !== "NODE_OPTIONS" && name !== MEMORY_PROBE_ENV
    )),
  );
  const result = spawnSync(process.execPath, [
    ...INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV,
    resolve("tests/industry_vm_g4_external_run_once.test.mjs"),
  ], {
    cwd: REPOSITORY_ROOT,
    env: { ...cleanEnvironment, [MEMORY_PROBE_ENV]: "1" },
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /official-scale synthetic pipeline proof passed/iu);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /heap out of memory|fatal error/iu);
});

memoryProbeTest("official-scale synthetic pipeline proof passed", { timeout: 110_000 }, async (context) => {
  assert.equal(process.version, INDUSTRY_VM_G4_REQUIRED_NODE_VERSION);
  assert.deepEqual(process.execArgv, INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV);
  assert.equal(process.env.NODE_OPTIONS, undefined);
  const { root } = await temporaryProject(context);
  const syntheticArchiveBytes = await createOfficialScaleSyntheticArchive(root);
  const result = await proveIndustryVmG4SyntheticPipeline({
    projectRoot: root,
    syntheticArchiveBytes,
  });
  assert.equal(result.synthetic_proof_only, true);
  assert.equal(result.consumes_attempt149, false);
  assert.equal(result.outcomes_observed, true);
  assert.equal(result.source_observations, 26_274);
  assert.equal(result.primary_observations, 21_218);
  await assert.rejects(
    readFile(join(root, INDUSTRY_VM_G4_FIXED_OUTPUT_RELATIVE_PATH)),
    /ENOENT/iu,
  );
});
