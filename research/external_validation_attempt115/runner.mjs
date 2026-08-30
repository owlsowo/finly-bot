import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import nodeProcess from "node:process";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, stableStringify } from "../../lib/canonical.mjs";
import {
  EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA,
  acquireExternalAttempt115KennethFrenchSource,
  canonicalExternalAttempt115AcquisitionReceiptJson,
  validateExternalAttempt115AcquisitionReceipt,
} from "./acquisition.mjs";
import {
  EXTERNAL_ATTEMPT115_EVALUATION_SCHEMA,
  EXTERNAL_ATTEMPT115_INTEGRITY_CHECK_NAMES,
  canonicalExternalAttempt115EvaluationJson,
  evaluateExternalAttempt115,
} from "./evaluation.mjs";
import {
  KENNETH_FRENCH_ATTEMPT115_ADAPTER_SCHEMA,
  KENNETH_FRENCH_DAILY_FACTOR_PARSE_SCHEMA,
  KENNETH_FRENCH_DAILY_PROXY_LABELS,
  adaptKennethFrenchDailyFactorsToAttempt115,
  parseKennethFrenchDailyFactorCsv,
} from "./kenneth_french_daily_factor_adapter.mjs";
import {
  EXTERNAL_ATTEMPT115_ARTIFACT_PATHS,
  EXTERNAL_ATTEMPT115_EVALUATION_ID,
  canonicalExternalAttempt115ProtocolJson,
  verifyExternalAttempt115ProtocolBytes,
} from "./protocol.mjs";
import { createExternalAttempt115OfficialTransport } from "./official_transport.mjs";
import {
  EXTERNAL_ATTEMPT115_CADENCE_ANCHORS,
  EXTERNAL_ATTEMPT115_COST_BPS,
  EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION,
  EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION,
  EXTERNAL_ATTEMPT115_PRIMARY_ANCHOR,
  EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS,
  EXTERNAL_ATTEMPT115_REPLAY_GRID_SCHEMA,
  EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS,
  replayExternalAttempt115Cell,
  replayExternalAttempt115Grid,
} from "./replay.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
} from "../prospective_attempt115/policy.mjs";

export const EXTERNAL_ATTEMPT115_FROZEN_PROTOCOL_RELATIVE_PATH =
  "research/external_validation_attempt115/frozen_protocol.json";
export const EXTERNAL_ATTEMPT115_INTEGRITY_EVIDENCE_SCHEMA =
  "finly_attempt115_external_integrity_evidence.v1";
export const EXTERNAL_ATTEMPT115_ONE_TIME_RUN_RECEIPT_SCHEMA =
  "finly_attempt115_external_one_time_run_receipt.v1";
export const EXTERNAL_ATTEMPT115_REQUIRED_NODE_VERSION = "v26.7.0";
export const EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH =
  "data/external_validation_attempt115/attempt117";
export const EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH =
  "data/external_validation_attempt115/attempt117.run-start.json";
export const EXTERNAL_ATTEMPT115_CLI_RELATIVE_PATH =
  "research/external_validation_attempt115/runner.mjs";
export const EXTERNAL_ATTEMPT115_RUN_START_SCHEMA =
  "finly_attempt115_external_run_start.v1";

const MARKET = "MARKET_PROXY";
const RF = "RF_PROXY";
const POLICY_IDS = Object.freeze([
  ATTEMPT115_INCUMBENT_POLICY_ID,
  ATTEMPT115_CHALLENGER_POLICY_ID,
]);
const ADDITIONAL_OUTPUT_FILENAMES = Object.freeze({
  frozen_protocol: "frozen_protocol.json",
  replay_grid: "replay_grid.json",
  integrity_evidence: "integrity_evidence.json",
  evaluation: "evaluation.json",
  run_receipt: "run_receipt.json",
});
const ACQUISITION_OUTPUT_FILENAMES = Object.freeze({
  source_archive: "source_archive.zip",
  response_headers: "response_headers.json",
  source_member: "F-F_Research_Data_Factors_daily.CSV",
  canonical_member: "canonical_daily_factors.csv",
  acquisition_receipt: "acquisition_receipt.json",
});
const MAXIMUM_BOUND_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PROTOCOL_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PACKAGE_JSON_PATH = "package.json";
const PACKAGE_LOCK_PATH = "package-lock.json";
const NativeDate = globalThis.Date;
const initialDateNow = NativeDate.now;
const initialDateGetTime = NativeDate.prototype.getTime;
const initialDateToISOString = NativeDate.prototype.toISOString;
const nativeReflectApply = Reflect.apply;
const nativeDateNow = initialDateNow.bind(NativeDate);
const initialGlobalFetch = globalThis.fetch;
const initialAbortSignal = globalThis.AbortSignal;
const initialAbortSignalTimeout = globalThis.AbortSignal?.timeout;
export const EXTERNAL_ATTEMPT115_FORBIDDEN_PROCESS_ENVIRONMENT_KEYS = Object.freeze([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_SYSTEM_CA",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "OPENSSL_CONF",
  "SSLKEYLOGFILE",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_ICU_DATA",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
]);
const PERMITTED_OS_INSERTED_ENVIRONMENT_KEYS = Object.freeze([
  "__CF_USER_TEXT_ENCODING",
]);
const MAXIMUM_EXECUTABLE_BYTES = 512 * 1024 * 1024;

function fail(message) {
  throw new TypeError(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function canonicalSort(value) {
  if (Array.isArray(value)) return value.map(canonicalSort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalSort(child)]));
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalSort(value), null, 2)}\n`;
}

function rawSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function exactOptions(value, allowed, required, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    fail(`${label} option set changed`);
  }
  return value;
}

function canonicalInstant(value, label) {
  const date = value instanceof NativeDate ? value : new NativeDate(value);
  if (!Number.isFinite(nativeReflectApply(initialDateGetTime, date, []))) {
    fail(`${label} must be a valid instant`);
  }
  const instant = nativeReflectApply(initialDateToISOString, date, []);
  if (typeof value === "string" && value !== instant) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return instant;
}

function officialNow() {
  return new NativeDate(nativeDateNow());
}

async function canonicalProjectRoot(projectRoot) {
  if (typeof projectRoot !== "string" || !isAbsolute(projectRoot)
    || normalize(projectRoot) !== projectRoot || projectRoot === parse(projectRoot).root) {
    fail("external Attempt115 project root must be a canonical absolute path");
  }
  const status = await lstat(projectRoot).catch((error) => {
    if (error?.code === "ENOENT") fail("external Attempt115 project root is missing");
    throw error;
  });
  if (!status.isDirectory() || status.isSymbolicLink()
    || await realpath(projectRoot) !== projectRoot) {
    fail("external Attempt115 project root must be a regular non-symlink directory");
  }
  return projectRoot;
}

function absoluteProjectPath(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || isAbsolute(relativePath) || normalize(relativePath) !== relativePath
    || relativePath.split("/").some((segment) => segment === "" || segment === "..")) {
    fail("external Attempt115 bound artifact path is not canonical and relative");
  }
  const absolute = resolve(projectRoot, relativePath);
  const scoped = relative(projectRoot, absolute);
  if (scoped.length === 0 || scoped.startsWith("..") || isAbsolute(scoped)) {
    fail("external Attempt115 bound artifact escaped the project root");
  }
  return absolute;
}

async function assertNoSymlinkTraversal(projectRoot, absolutePath) {
  const parent = dirname(absolutePath);
  let cursor = projectRoot;
  const scopedParent = relative(projectRoot, parent);
  for (const segment of scopedParent.split("/").filter(Boolean)) {
    cursor = resolve(cursor, segment);
    const status = await lstat(cursor).catch((error) => {
      if (error?.code === "ENOENT") fail("external Attempt115 bound artifact parent is missing");
      throw error;
    });
    if (!status.isDirectory() || status.isSymbolicLink()) {
      fail("external Attempt115 bound artifact path traverses a symlink or non-directory");
    }
  }
}

async function readRegularFile(projectRoot, relativePath, maximumBytes) {
  const absolutePath = absoluteProjectPath(projectRoot, relativePath);
  await assertNoSymlinkTraversal(projectRoot, absolutePath);
  let handle;
  try {
    handle = await open(
      absolutePath,
      FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink()
      || !Number.isSafeInteger(before.size) || before.size <= 0 || before.size > maximumBytes) {
      fail(`external Attempt115 bound artifact ${relativePath} is not a bounded regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || bytes.byteLength !== after.size) {
      fail(`external Attempt115 bound artifact ${relativePath} changed while being read`);
    }
    if (await realpath(absolutePath) !== absolutePath) {
      fail(`external Attempt115 bound artifact ${relativePath} traverses a symlink`);
    }
    return new Uint8Array(bytes);
  } catch (error) {
    if (error?.code === "ELOOP") {
      fail(`external Attempt115 bound artifact ${relativePath} is a symlink`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function artifactHashes(projectRoot, paths) {
  return Object.fromEntries(await Promise.all(paths.map(async (relativePath) => [
    relativePath,
    rawSha256(await readRegularFile(
      projectRoot,
      relativePath,
      MAXIMUM_BOUND_ARTIFACT_BYTES,
    )),
  ])));
}

function parsePackageJson(bytes, label) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(`${label} must be valid UTF-8 JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must contain a JSON object`);
  }
  return value;
}

/** Pure validator for the package/runtime boundary used by the one-time runner. */
export function validateExternalAttempt115Runtime({
  packageJsonBytes,
  packageLockBytes,
  observedNodeVersion,
}) {
  const manifest = parsePackageJson(packageJsonBytes, "external Attempt115 package.json");
  const lock = parsePackageJson(packageLockBytes, "external Attempt115 package-lock.json");
  const requiredEngine = EXTERNAL_ATTEMPT115_REQUIRED_NODE_VERSION.slice(1);
  const lockRoot = lock.packages?.[""];
  if (manifest.engines?.node !== requiredEngine
    || lockRoot?.engines?.node !== requiredEngine
    || observedNodeVersion !== EXTERNAL_ATTEMPT115_REQUIRED_NODE_VERSION) {
    fail(`external Attempt115 requires exact Node ${EXTERNAL_ATTEMPT115_REQUIRED_NODE_VERSION}`);
  }
  return deepFreeze({
    node_version: observedNodeVersion,
    package_engine_node: manifest.engines.node,
    package_lock_engine_node: lockRoot.engines.node,
    package_json_raw_bytes_sha256: rawSha256(packageJsonBytes),
    package_lock_raw_bytes_sha256: rawSha256(packageLockBytes),
  });
}

async function verifyRuntime(projectRoot) {
  const [packageJsonBytes, packageLockBytes] = await Promise.all([
    readRegularFile(projectRoot, PACKAGE_JSON_PATH, MAXIMUM_BOUND_ARTIFACT_BYTES),
    readRegularFile(projectRoot, PACKAGE_LOCK_PATH, MAXIMUM_BOUND_ARTIFACT_BYTES),
  ]);
  return validateExternalAttempt115Runtime({
    packageJsonBytes,
    packageLockBytes,
    observedNodeVersion: nodeProcess.version,
  });
}

async function executableEvidence() {
  const executablePath = await realpath(nodeProcess.execPath);
  if (executablePath !== nodeProcess.execPath || nodeProcess.argv[0] !== executablePath) {
    fail("external Attempt115 Node executable path is not canonical");
  }
  let handle;
  try {
    handle = await open(
      executablePath,
      FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0
      || before.size > MAXIMUM_EXECUTABLE_BYTES) {
      fail("external Attempt115 Node executable is not a bounded regular file");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, before.size - position),
        position,
      );
      if (bytesRead <= 0) fail("external Attempt115 Node executable read ended early");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      fail("external Attempt115 Node executable changed while being hashed");
    }
    return {
      exec_path: executablePath,
      exec_path_raw_bytes_sha256: `sha256:${hash.digest("hex")}`,
      exec_path_byte_count: before.size,
    };
  } finally {
    await handle?.close();
  }
}

function assertRuntimePrimordialsUnchanged() {
  if (globalThis.Date !== NativeDate || NativeDate.now !== initialDateNow
    || NativeDate.prototype.getTime !== initialDateGetTime
    || NativeDate.prototype.toISOString !== initialDateToISOString
    || globalThis.fetch !== initialGlobalFetch
    || globalThis.AbortSignal !== initialAbortSignal
    || globalThis.AbortSignal?.timeout !== initialAbortSignalTimeout) {
    fail("external Attempt115 runtime primordial identity changed after module load");
  }
}

/** Verify the dedicated CLI and clean-process boundary before any run claim. */
export async function validateExternalAttempt115CleanProcess({ projectRoot }) {
  const root = await canonicalProjectRoot(projectRoot);
  assertRuntimePrimordialsUnchanged();
  if (nodeProcess.execArgv.length !== 0) {
    fail("external Attempt115 clean process forbids every Node execArgv option");
  }
  const presentEnvironmentKeys = EXTERNAL_ATTEMPT115_FORBIDDEN_PROCESS_ENVIRONMENT_KEYS.filter(
    (key) => Object.hasOwn(nodeProcess.env, key),
  );
  if (presentEnvironmentKeys.length > 0) {
    fail(`external Attempt115 clean process forbids environment key ${presentEnvironmentKeys[0]}`);
  }
  const observedEnvironmentKeys = Object.keys(nodeProcess.env).sort();
  const unexpectedEnvironmentKeys = observedEnvironmentKeys.filter(
    (key) => !PERMITTED_OS_INSERTED_ENVIRONMENT_KEYS.includes(key),
  );
  if (unexpectedEnvironmentKeys.length > 0) {
    fail(
      `external Attempt115 clean process requires an empty launcher environment; unexpected key ${unexpectedEnvironmentKeys[0]}`,
    );
  }
  if (Object.hasOwn(nodeProcess.env, "__CF_USER_TEXT_ENCODING")
    && !/^0x[0-9A-F]+:0x0:0x0$/u.test(nodeProcess.env.__CF_USER_TEXT_ENCODING)) {
    fail("external Attempt115 macOS-inserted text-encoding environment value is invalid");
  }
  if (nodeProcess.argv.length !== 2) {
    fail("external Attempt115 CLI accepts no positional arguments");
  }
  const cliPath = absoluteProjectPath(root, EXTERNAL_ATTEMPT115_CLI_RELATIVE_PATH);
  if (await realpath(nodeProcess.argv[1]).catch(() => null) !== cliPath
    || await realpath(nodeProcess.cwd()) !== root) {
    fail("external Attempt115 must run from the fixed CLI at the project root");
  }
  const executable = await executableEvidence();
  return deepFreeze({
    schema_version: "finly_attempt115_clean_process_boundary.v1",
    ...executable,
    node_version: nodeProcess.version,
    exec_argv: [],
    argv0: nodeProcess.argv0,
    cli_relative_path: EXTERNAL_ATTEMPT115_CLI_RELATIVE_PATH,
    working_directory: root,
    node_options_absent: true,
    launcher_environment_policy:
      "empty; only the macOS-inserted __CF_USER_TEXT_ENCODING process key is permitted",
    observed_environment: Object.fromEntries(
      observedEnvironmentKeys.map((key) => [key, nodeProcess.env[key]]),
    ),
    forbidden_environment_keys_absent: [
      ...EXTERNAL_ATTEMPT115_FORBIDDEN_PROCESS_ENVIRONMENT_KEYS,
    ],
    global_fetch_used_for_transport: false,
    captured_date_clock_used: true,
    hostile_code_executed_before_this_process_boundary_detectable: false,
  });
}

async function frozenArtifactBytes(projectRoot) {
  const readGroup = async (paths) => Object.fromEntries(await Promise.all(
    paths.map(async (relativePath) => [
      relativePath,
      await readRegularFile(
        projectRoot,
        relativePath,
        MAXIMUM_BOUND_ARTIFACT_BYTES,
      ),
    ]),
  ));
  return {
    source_files: await readGroup(EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files),
    test_files: await readGroup(EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files),
  };
}

/** Read and hash the complete frozen code/test surface without any source acquisition. */
export async function computeExternalAttempt115ArtifactHashes(options) {
  exactOptions(options, ["projectRoot"], ["projectRoot"], "artifact-hash input");
  const projectRoot = await canonicalProjectRoot(options.projectRoot);
  const sourceFilesSha256 = await artifactHashes(
    projectRoot,
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files,
  );
  const testFilesSha256 = await artifactHashes(
    projectRoot,
    EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files,
  );
  return deepFreeze({
    project_root: projectRoot,
    source_files_sha256: sourceFilesSha256,
    test_files_sha256: testFilesSha256,
    artifact_set_sha256: sha256({
      source_files_sha256: sourceFilesSha256,
      test_files_sha256: testFilesSha256,
    }),
  });
}

function exactArtifactBinding(protocol, actual) {
  if (stableStringify(protocol.artifact_binding.source_files_sha256)
      !== stableStringify(actual.source_files_sha256)
    || stableStringify(protocol.artifact_binding.test_files_sha256)
      !== stableStringify(actual.test_files_sha256)) {
    fail("external Attempt115 actual artifact hashes differ from the frozen protocol");
  }
}

async function loadFrozenProtocolFile(projectRoot) {
  const bytes = await readRegularFile(
    projectRoot,
    EXTERNAL_ATTEMPT115_FROZEN_PROTOCOL_RELATIVE_PATH,
    MAXIMUM_PROTOCOL_BYTES,
  );
  const protocol = verifyExternalAttempt115ProtocolBytes(bytes);
  if (new TextDecoder().decode(bytes) !== canonicalExternalAttempt115ProtocolJson(protocol)) {
    fail("external Attempt115 frozen protocol file is not canonical");
  }
  return { bytes, protocol };
}

async function lstatOrNull(path) {
  return lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(
      path,
      FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_DIRECTORY ?? 0),
    );
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function ensureFixedDirectoryPath(projectRoot, relativeDirectory) {
  let cursor = projectRoot;
  for (const segment of relativeDirectory.split("/")) {
    const parent = cursor;
    cursor = resolve(cursor, segment);
    const existing = await lstatOrNull(cursor);
    if (existing === null) {
      await mkdir(cursor, { mode: 0o700 }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
      await syncDirectory(cursor);
      await syncDirectory(parent);
    }
    const status = await lstat(cursor);
    if (!status.isDirectory() || status.isSymbolicLink() || await realpath(cursor) !== cursor) {
      fail("external Attempt115 fixed run path traverses a symlink or non-directory");
    }
  }
}

function runStartMarkerBody({ protocol, artifactBinding, processBoundary, startedAt }) {
  return {
    schema_version: EXTERNAL_ATTEMPT115_RUN_START_SCHEMA,
    evaluation_id: EXTERNAL_ATTEMPT115_EVALUATION_ID,
    protocol_sha256: protocol.protocol_sha256,
    artifact_set_sha256: artifactBinding.artifact_set_sha256,
    started_at: startedAt,
    source_data_acquired_at_start: false,
    fixed_output_relative_path: EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH,
    process_boundary: processBoundary,
    durability_barriers_requested: {
      marker_file_fsync: true,
      marker_parent_directory_fsync: true,
      newly_created_parent_directories_fsync: true,
    },
    one_time_semantics:
      "This marker is an irreversible claim. Failure or interruption cannot be retried under this protocol.",
  };
}

/** Atomically claim the sole fixed run before source transport begins. */
export async function claimExternalAttempt115RunStart({
  projectRoot,
  protocol,
  artifactBinding,
  processBoundary,
}) {
  const root = await canonicalProjectRoot(projectRoot);
  if (!protocol || typeof protocol !== "object"
    || !artifactBinding || typeof artifactBinding !== "object"
    || !processBoundary || typeof processBoundary !== "object") {
    fail("external Attempt115 run claim requires bound protocol, artifacts, and process evidence");
  }
  const outputPath = absoluteProjectPath(
    root,
    EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH,
  );
  const markerPath = absoluteProjectPath(
    root,
    EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH,
  );
  if (await lstatOrNull(outputPath) !== null || await lstatOrNull(markerPath) !== null) {
    fail("external Attempt115 fixed run is already claimed or has output; retry is forbidden");
  }
  await ensureFixedDirectoryPath(root, dirname(
    EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH,
  ));
  const startedAt = canonicalInstant(officialNow(), "external Attempt115 run-start clock");
  if (startedAt <= protocol.frozen_at) {
    fail("external Attempt115 run claim must occur after protocol freeze");
  }
  const body = runStartMarkerBody({
    protocol,
    artifactBinding,
    processBoundary,
    startedAt,
  });
  const marker = deepFreeze({ ...body, run_start_marker_sha256: sha256(body) });
  const markerBytes = new TextEncoder().encode(canonicalJson(marker));
  let markerHandle;
  try {
    markerHandle = await open(
      markerPath,
      FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      0o600,
    );
    await markerHandle.writeFile(markerBytes);
    await markerHandle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("external Attempt115 fixed run was concurrently claimed; retry is forbidden");
    }
    throw error;
  } finally {
    await markerHandle?.close();
  }
  await syncDirectory(dirname(markerPath));
  const relativeMarker = EXTERNAL_ATTEMPT115_RUN_START_RELATIVE_PATH;
  const reopened = await readRegularFile(root, relativeMarker, MAXIMUM_PROTOCOL_BYTES);
  const markerStatus = await lstat(markerPath);
  if (rawSha256(reopened) !== rawSha256(markerBytes)
    || new TextDecoder().decode(reopened) !== canonicalJson(marker)
    || !markerStatus.isFile() || markerStatus.isSymbolicLink()
    || await realpath(markerPath) !== markerPath
    || await lstatOrNull(outputPath) !== null) {
    fail("external Attempt115 run-start marker changed or output appeared before transport");
  }
  return deepFreeze({
    marker,
    relative_path: relativeMarker,
    raw_bytes_sha256: rawSha256(markerBytes),
    byte_count: markerBytes.byteLength,
    marker_identity: { dev: markerStatus.dev, ino: markerStatus.ino },
    output_directory: outputPath,
  });
}

async function verifyRunStartMarker(projectRoot, claim) {
  const markerPath = absoluteProjectPath(projectRoot, claim.relative_path);
  const before = await lstat(markerPath);
  const bytes = await readRegularFile(
    projectRoot,
    claim.relative_path,
    MAXIMUM_PROTOCOL_BYTES,
  );
  const after = await lstat(markerPath);
  if (bytes.byteLength !== claim.byte_count || rawSha256(bytes) !== claim.raw_bytes_sha256
    || new TextDecoder().decode(bytes) !== canonicalJson(claim.marker)
    || !before.isFile() || before.isSymbolicLink()
    || before.dev !== claim.marker_identity.dev || before.ino !== claim.marker_identity.ino
    || after.dev !== before.dev || after.ino !== before.ino
    || await realpath(markerPath) !== markerPath) {
    fail("external Attempt115 run-start marker changed after its atomic claim");
  }
}

async function verifyOutputDirectory(
  projectRoot,
  outputDirectory,
  expectedFilenames,
  identity,
  expectedBytes,
) {
  const scoped = relative(projectRoot, outputDirectory);
  if (scoped !== EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH) {
    fail("external Attempt115 output directory differs from the sole fixed path");
  }
  const status = await lstat(outputDirectory);
  if (!status.isDirectory() || status.isSymbolicLink()
    || await realpath(outputDirectory) !== outputDirectory
    || (identity && (status.dev !== identity.dev || status.ino !== identity.ino))) {
    fail("external Attempt115 output directory identity changed");
  }
  const actual = (await readdir(outputDirectory)).sort();
  const expected = [...expectedFilenames].sort();
  if (stableStringify(actual) !== stableStringify(expected)) {
    fail("external Attempt115 output directory contains a missing or extra artifact");
  }
  if (expectedBytes
    && stableStringify(Object.keys(expectedBytes).sort()) !== stableStringify(expected)) {
    fail("external Attempt115 expected output byte manifest differs from the exact file set");
  }
  for (const filename of actual) {
    const bytes = await readRegularFile(
      projectRoot,
      `${scoped}/${filename}`,
      64 * 1024 * 1024,
    );
    if (expectedBytes && (bytes.byteLength !== expectedBytes[filename].byteLength
      || rawSha256(bytes) !== rawSha256(expectedBytes[filename]))) {
      fail(`external Attempt115 output artifact ${filename} changed after persistence`);
    }
  }
  const finalStatus = await lstat(outputDirectory);
  const finalNames = (await readdir(outputDirectory)).sort();
  if (!finalStatus.isDirectory() || finalStatus.isSymbolicLink()
    || finalStatus.dev !== status.dev || finalStatus.ino !== status.ino
    || await realpath(outputDirectory) !== outputDirectory
    || stableStringify(finalNames) !== stableStringify(expected)) {
    fail("external Attempt115 output directory changed during verification");
  }
  return { dev: finalStatus.dev, ino: finalStatus.ino };
}

function approximatelyEqual(left, right, tolerance = 1e-12) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function parserAndTransformEvidence(parsed, receipt) {
  const dates = [];
  let previous = "";
  let marketLevel = 100;
  let rfLevel = 100;
  const adapted = adaptKennethFrenchDailyFactorsToAttempt115(parsed);
  let transformsMatch = adapted.schema_version === KENNETH_FRENCH_ATTEMPT115_ADAPTER_SCHEMA
    && parsed.schema_version === KENNETH_FRENCH_DAILY_FACTOR_PARSE_SCHEMA
    && parsed.rows.length === adapted.source_return_rows;
  parsed.rows.forEach((row, index) => {
    dates.push(row.date);
    if (row.date <= previous) transformsMatch = false;
    previous = row.date;
    const expectedMarketReturn = (row["Mkt-RF"] + row.RF) / 100;
    const expectedRfReturn = row.RF / 100;
    if (row[MARKET] !== expectedMarketReturn || row[RF] !== expectedRfReturn) {
      transformsMatch = false;
    }
    marketLevel *= 1 + expectedMarketReturn;
    rfLevel *= 1 + expectedRfReturn;
    const point = adapted.proxy_points[index];
    const alias = adapted.frozen_target_points[index];
    if (point?.date !== row.date || point?.[MARKET] !== marketLevel || point?.[RF] !== rfLevel
      || alias?.date !== row.date || alias?.SPY !== marketLevel || alias?.BIL !== rfLevel) {
      transformsMatch = false;
    }
  });
  const parserPassed = parsed.rows.length === receipt.parsed_valid_row_count
    && parsed.rows[0].date === receipt.parsed_first_date
    && parsed.rows.at(-1).date === receipt.parsed_last_date
    && dates.every((date, index) => index === 0 || date > dates[index - 1]);
  return {
    parser: {
      passed: parserPassed,
      evidence: {
        schema_version: parsed.schema_version,
        valid_row_count: parsed.rows.length,
        first_date: parsed.rows[0].date,
        last_date: parsed.rows.at(-1).date,
        ordered_dates_sha256: sha256(dates),
      },
    },
    transform: {
      passed: transformsMatch,
      evidence: {
        transformed_row_count: parsed.rows.length,
        proxy_labels: KENNETH_FRENCH_DAILY_PROXY_LABELS,
        transformed_returns_sha256: sha256(parsed.rows.map((row) => ({
          date: row.date,
          [MARKET]: row[MARKET],
          [RF]: row[RF],
        }))),
        terminal_proxy_levels_sha256: sha256({ [MARKET]: marketLevel, [RF]: rfLevel }),
      },
    },
  };
}

function chronologyEvidence(parsed, grid) {
  const expected = {
    signal_date: parsed.rows[EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS - 1].date,
    execution_date: parsed.rows[EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION - 1].date,
    outcome_observation_date: parsed.rows[EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION - 1].date,
  };
  const primary = grid.primary_cell.partitions.primary_pre_overlap;
  let rowsChecked = 0;
  let passed = grid.primary_cell.timing.warmup_observations
      === EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS
    && grid.primary_cell.timing.first_execution_observation
      === EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION
    && grid.primary_cell.timing.first_scored_observation
      === EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION;
  for (const policyId of POLICY_IDS) {
    const allRows = Object.values(grid.primary_cell.partitions)
      .flatMap((partition) => partition.policies[policyId].rows);
    const first = primary.policies[policyId].rows[0];
    passed &&= first.signal_date === expected.signal_date
      && first.execution_date === expected.execution_date
      && first.outcome_observation_date === expected.outcome_observation_date;
    let priorOutcome = "";
    for (const row of allRows) {
      passed &&= row.signal_date < row.execution_date
        && row.execution_date < row.outcome_observation_date
        && row.outcome_observation_date > priorOutcome;
      priorOutcome = row.outcome_observation_date;
      rowsChecked += 1;
    }
  }
  return {
    passed,
    evidence: {
      expected_first_scored_chronology: expected,
      policy_rows_checked: rowsChecked,
      ordinal_rule: "253 signal / 254 execution / 255 first scored outcome",
    },
  };
}

function futureMutationEvidence(parsed, grid) {
  const mutated = structuredClone(parsed);
  for (let index = EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION - 1;
    index < mutated.rows.length;
    index += 1) {
    const marketReturn = index % 2 === 0 ? 0.025 : -0.02;
    const rfPercent = 0.005;
    mutated.rows[index].RF = rfPercent;
    mutated.rows[index]["Mkt-RF"] = marketReturn * 100 - rfPercent;
    mutated.rows[index][MARKET] = marketReturn;
    mutated.rows[index][RF] = rfPercent / 100;
  }
  const replay = replayExternalAttempt115Cell(mutated, {
    oneWayCostBps: EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS,
    rebalanceAnchor: EXTERNAL_ATTEMPT115_PRIMARY_ANCHOR,
  });
  const comparisons = POLICY_IDS.map((policyId) => {
    const baseline = grid.primary_cell.partitions.primary_pre_overlap
      .policies[policyId].rows[0];
    const changed = replay.partitions.primary_pre_overlap.policies[policyId].rows[0];
    return {
      policy_id: policyId,
      same_signal_date: baseline.signal_date === changed.signal_date,
      same_first_start_weights:
        stableStringify(baseline.start_weights) === stableStringify(changed.start_weights),
      future_outcome_changed:
        stableStringify(baseline.proxy_returns) !== stableStringify(changed.proxy_returns),
    };
  });
  return {
    passed: comparisons.every((item) => item.same_signal_date
      && item.same_first_start_weights && item.future_outcome_changed),
    evidence: {
      first_future_observation_ordinal_mutated:
        EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION,
      future_observations_mutated: mutated.rows.length
        - (EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION - 1),
      comparisons,
    },
  };
}

function costEvidence(grid) {
  const cells = new Map(grid.sensitivity_cells.map((cell) => [
    `${cell.rebalance_anchor}:${cell.one_way_cost_bps}`,
    cell,
  ]));
  let monotonic = true;
  for (const anchor of EXTERNAL_ATTEMPT115_CADENCE_ANCHORS) {
    for (const policyId of POLICY_IDS) {
      const ordered = EXTERNAL_ATTEMPT115_COST_BPS.map((cost) => (
        cells.get(`${anchor}:${cost}`).primary_pre_overlap.policy_metrics[policyId]
      ));
      const gross = ordered[0].gross_total_return;
      for (let index = 0; index < ordered.length; index += 1) {
        monotonic &&= approximatelyEqual(ordered[index].gross_total_return, gross);
        if (index > 0) {
          monotonic &&= ordered[index].total_return <= ordered[index - 1].total_return + 1e-15
            && ordered[index].modeled_cost_drag_simple_sum
              >= ordered[index - 1].modeled_cost_drag_simple_sum - 1e-15;
        }
      }
    }
  }
  let costRowsChecked = 0;
  for (const partition of Object.values(grid.primary_cell.partitions)) {
    for (const policyId of POLICY_IDS) {
      for (const row of partition.policies[policyId].rows) {
        monotonic &&= approximatelyEqual(
          row.transaction_cost_fraction,
          row.entry_absolute_leg_turnover * EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS / 10_000,
        );
        costRowsChecked += 1;
      }
    }
  }
  return {
    passed: monotonic,
    evidence: {
      sensitivity_cells_checked: cells.size,
      cadence_anchors_checked: [...EXTERNAL_ATTEMPT115_CADENCE_ANCHORS],
      cost_bps_checked: [...EXTERNAL_ATTEMPT115_COST_BPS],
      exact_cost_rows_checked: costRowsChecked,
      exact_cost_formula: "absolute leg turnover * one-way bps / 10000",
    },
  };
}

function terminalEvidence(grid) {
  let passed = true;
  let terminalRowsChecked = 0;
  for (const partition of Object.values(grid.primary_cell.partitions)) {
    for (const policyId of POLICY_IDS) {
      const rows = partition.policies[policyId].rows;
      const last = rows.at(-1);
      const expectedTurnover = Math.abs(last.end_weights[MARKET])
        + Math.abs(last.end_weights[RF] - 1);
      const expectedCost = expectedTurnover * EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS / 10_000;
      const expectedNetGrowth = (1 - last.transaction_cost_fraction)
        * last.gross_growth * (1 - expectedCost);
      passed &&= last.standalone_terminal_liquidation === true
        && approximatelyEqual(last.terminal_liquidation_absolute_leg_turnover, expectedTurnover)
        && approximatelyEqual(last.terminal_liquidation_cost_fraction, expectedCost)
        && approximatelyEqual(last.net_growth, expectedNetGrowth)
        && rows.slice(0, -1).every((row) => row.standalone_terminal_liquidation === false
          && row.terminal_liquidation_absolute_leg_turnover === 0
          && row.terminal_liquidation_cost_fraction === 0);
      terminalRowsChecked += 1;
    }
  }
  return {
    passed,
    evidence: {
      standalone_partition_terminal_rows_checked: terminalRowsChecked,
      terminal_target: { [MARKET]: 0, [RF]: 1 },
      terminal_cost_bps: EXTERNAL_ATTEMPT115_PRIMARY_COST_BPS,
    },
  };
}

async function reopenedSourceEvidence(projectRoot, outputDirectory, acquisition, protocol) {
  const scoped = relative(projectRoot, outputDirectory);
  if (scoped.length === 0 || scoped.startsWith("..") || isAbsolute(scoped)) {
    fail("external Attempt115 output directory must remain inside the project root");
  }
  const readOutput = (filename, maximumBytes = 64 * 1024 * 1024) => readRegularFile(
    projectRoot,
    `${scoped}/${filename}`,
    maximumBytes,
  );
  const archive = await readOutput(ACQUISITION_OUTPUT_FILENAMES.source_archive);
  const headers = await readOutput(ACQUISITION_OUTPUT_FILENAMES.response_headers);
  const member = await readOutput(ACQUISITION_OUTPUT_FILENAMES.source_member);
  const canonical = await readOutput(ACQUISITION_OUTPUT_FILENAMES.canonical_member);
  const receiptBytes = await readOutput(ACQUISITION_OUTPUT_FILENAMES.acquisition_receipt);
  let receiptFromDisk;
  try {
    receiptFromDisk = JSON.parse(new TextDecoder().decode(receiptBytes));
  } catch {
    fail("external Attempt115 persisted acquisition receipt is not JSON");
  }
  const receipt = validateExternalAttempt115AcquisitionReceipt(receiptFromDisk, protocol);
  if (new TextDecoder().decode(receiptBytes)
      !== canonicalExternalAttempt115AcquisitionReceiptJson(receipt)
    || stableStringify(receipt) !== stableStringify(acquisition.receipt)
    || rawSha256(archive) !== receipt.archive_raw_bytes_sha256
    || archive.byteLength !== receipt.archive_raw_byte_count
    || rawSha256(headers) !== receipt.response_headers_sha256
    || headers.byteLength !== receipt.response_headers_byte_count
    || rawSha256(member) !== receipt.selected_member_raw_bytes_sha256
    || member.byteLength !== receipt.selected_member_raw_byte_count
    || rawSha256(canonical) !== receipt.canonical_member_sha256
    || canonical.byteLength !== receipt.canonical_member_byte_count) {
    fail("external Attempt115 persisted source artifacts differ from their acquisition receipt");
  }
  const parsed = parseKennethFrenchDailyFactorCsv(canonical);
  return {
    receipt,
    parsed,
    archive,
    headers,
    member,
    canonical,
    evidence: {
      passed: receipt.schema_version === EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA,
      evidence: {
        official_archive_url: receipt.official_archive_url,
        acquired_at: receipt.acquired_at,
        archive_raw_bytes_sha256: receipt.archive_raw_bytes_sha256,
        selected_member_raw_bytes_sha256: receipt.selected_member_raw_bytes_sha256,
        canonical_member_sha256: receipt.canonical_member_sha256,
        persisted_artifact_count: 5,
      },
    },
  };
}

function createIntegrityEvidence({
  protocol,
  protocolBytes,
  artifactBinding,
  source,
  grid,
}) {
  const parserTransform = parserAndTransformEvidence(source.parsed, source.receipt);
  const checks = {
    protocol_self_hash: {
      passed: rawSha256(protocolBytes).startsWith("sha256:")
        && verifyExternalAttempt115ProtocolBytes(protocolBytes).protocol_sha256
          === protocol.protocol_sha256,
      evidence: {
        protocol_sha256: protocol.protocol_sha256,
        protocol_raw_bytes_sha256: rawSha256(protocolBytes),
        canonical_protocol_bytes_verified: true,
      },
    },
    artifact_hash_binding: {
      passed: true,
      evidence: {
        artifact_set_sha256: artifactBinding.artifact_set_sha256,
        source_file_count: Object.keys(artifactBinding.source_files_sha256).length,
        test_file_count: Object.keys(artifactBinding.test_files_sha256).length,
        actual_hashes_equal_frozen_protocol: true,
      },
    },
    official_source_identity_and_receipt: source.evidence,
    strict_parser_schema_and_row_order: parserTransform.parser,
    source_transform_identity: parserTransform.transform,
    warmup_signal_rebalance_outcome_chronology: chronologyEvidence(source.parsed, grid),
    future_observation_mutation_invariance: futureMutationEvidence(source.parsed, grid),
    cost_monotonicity_and_exact_entry_cost: costEvidence(grid),
    exact_terminal_liquidation: terminalEvidence(grid),
  };
  if (stableStringify(Object.keys(checks).sort())
      !== stableStringify([...EXTERNAL_ATTEMPT115_INTEGRITY_CHECK_NAMES].sort())) {
    fail("external Attempt115 derived integrity check set changed");
  }
  const body = {
    schema_version: EXTERNAL_ATTEMPT115_INTEGRITY_EVIDENCE_SCHEMA,
    evaluation_id: EXTERNAL_ATTEMPT115_EVALUATION_ID,
    protocol_sha256: protocol.protocol_sha256,
    acquisition_receipt_sha256: source.receipt.acquisition_receipt_sha256,
    replay_grid_sha256: grid.grid_sha256,
    checks,
    all_checks_passed: Object.values(checks).every((check) => check.passed === true),
    caller_supplied_integrity_attestations_accepted: false,
    source_values_included: false,
    claim_boundary:
      "Derived run-integrity evidence only; it does not establish profitability, future alpha, broker execution, or authorization.",
  };
  return deepFreeze({ ...body, integrity_evidence_sha256: sha256(body) });
}

async function writeOnce(path, bytes) {
  let handle;
  try {
    handle = await open(
      path,
      FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await syncDirectory(dirname(path));
}

function evaluationIntegrityBooleans(integrity) {
  return Object.fromEntries(EXTERNAL_ATTEMPT115_INTEGRITY_CHECK_NAMES.map((name) => [
    name,
    integrity.checks[name].passed,
  ]));
}

function runReceiptBody({
  protocol,
  source,
  grid,
  integrity,
  evaluation,
  runtime,
  processBoundary,
  claim,
  transport,
  persistedArtifactBytes,
  completedAt,
}) {
  const artifacts = Object.fromEntries(
    Object.entries(persistedArtifactBytes).map(([name, bytes]) => [name, {
      filename: name,
      raw_bytes_sha256: rawSha256(bytes),
      byte_count: bytes.byteLength,
    }]),
  );
  return {
    schema_version: EXTERNAL_ATTEMPT115_ONE_TIME_RUN_RECEIPT_SCHEMA,
    evaluation_id: EXTERNAL_ATTEMPT115_EVALUATION_ID,
    protocol_sha256: protocol.protocol_sha256,
    acquisition_receipt_sha256: source.receipt.acquisition_receipt_sha256,
    replay_grid_sha256: grid.grid_sha256,
    integrity_evidence_sha256: integrity.integrity_evidence_sha256,
    evaluation_sha256: evaluation.evaluation_sha256,
    completed_at: completedAt,
    provider_fetch_invocation_count: transport.api_invocation_count,
    evaluation_invocation_count: 1,
    runtime,
    process_boundary: processBoundary,
    run_start_marker: {
      relative_path: claim.relative_path,
      raw_bytes_sha256: claim.raw_bytes_sha256,
      byte_count: claim.byte_count,
      run_start_marker_sha256: claim.marker.run_start_marker_sha256,
      started_at: claim.marker.started_at,
    },
    fixed_output_relative_path: EXTERNAL_ATTEMPT115_FIXED_OUTPUT_RELATIVE_PATH,
    official_transport: transport,
    pre_completion_artifact_count: Object.keys(artifacts).length,
    artifacts,
    write_once: true,
    durability_barriers_requested: {
      acquisition_artifact_files_fsync: true,
      derived_artifact_files_fsync: true,
      output_directory_fsync_after_each_derived_artifact: true,
      run_receipt_file_and_output_directory_fsync: true,
    },
    completion_marker_role: "run_receipt.json is written last",
    authority: {
      research_only: true,
      broker_or_capital_action_authorized: false,
      public_claim_change_authorized: false,
    },
    residual_boundary: {
      standard_pki_only: true,
      provider_payload_signature_verified: false,
      physical_http_or_tcp_request_count_attested: false,
      hostile_pre_execution_code_excluded_by_in_process_evidence: false,
    },
  };
}

/**
 * Execute one complete post-freeze acquisition/replay/evaluation from this
 * module's fixed main entrypoint. It is deliberately not exported: output,
 * transport, clock, URL, protocol, extraction, replay, result, and integrity
 * are all fixed internally.
 */
async function runExternalAttempt115Once(options) {
  if (import.meta.main !== true) {
    fail("external Attempt115 authoritative runner is available only as the fixed main CLI");
  }
  const input = exactOptions(
    options,
    ["projectRoot"],
    ["projectRoot"],
    "one-time runner input",
  );
  const projectRoot = await canonicalProjectRoot(input.projectRoot);
  const processBoundary = await validateExternalAttempt115CleanProcess({ projectRoot });
  const runtime = await verifyRuntime(projectRoot);

  const frozen = await loadFrozenProtocolFile(projectRoot);
  const beforeArtifacts = await computeExternalAttempt115ArtifactHashes({ projectRoot });
  exactArtifactBinding(frozen.protocol, beforeArtifacts);
  const claim = await claimExternalAttempt115RunStart({
    projectRoot,
    protocol: frozen.protocol,
    artifactBinding: beforeArtifacts,
    processBoundary,
  });
  const outputDirectory = claim.output_directory;
  const officialTransport = createExternalAttempt115OfficialTransport();
  let providerFetchInvocationCount = 0;
  let acquisition;
  try {
    acquisition = await acquireExternalAttempt115KennethFrenchSource({
      protocol: frozen.protocol,
      acquisitionState: { source_data_acquired: false },
      outputDirectory,
      fetchImpl: async (...args) => {
        providerFetchInvocationCount += 1;
        if (providerFetchInvocationCount !== 1) {
          fail("external Attempt115 provider acquisition attempted more than once");
        }
        return officialTransport.fetch(...args);
      },
      now: officialNow,
    });
  } catch (error) {
    officialTransport.cancelIncompleteResponse();
    throw error;
  }
  if (providerFetchInvocationCount !== 1) {
    fail("external Attempt115 provider acquisition did not execute exactly once");
  }
  const transportEvidence = officialTransport.evidence();
  assertRuntimePrimordialsUnchanged();
  await verifyRunStartMarker(projectRoot, claim);

  const frozenAfterAcquisition = await loadFrozenProtocolFile(projectRoot);
  if (rawSha256(frozenAfterAcquisition.bytes) !== rawSha256(frozen.bytes)) {
    fail("external Attempt115 frozen protocol changed during acquisition");
  }
  const afterAcquisitionArtifacts = await computeExternalAttempt115ArtifactHashes({ projectRoot });
  exactArtifactBinding(frozen.protocol, afterAcquisitionArtifacts);
  if (beforeArtifacts.artifact_set_sha256 !== afterAcquisitionArtifacts.artifact_set_sha256) {
    fail("external Attempt115 bound artifacts changed during acquisition");
  }

  const source = await reopenedSourceEvidence(
    projectRoot,
    outputDirectory,
    acquisition,
    frozen.protocol,
  );
  if (source.receipt.acquired_at < claim.marker.started_at) {
    fail("external Attempt115 acquisition clock precedes the irreversible run claim");
  }
  const acquisitionOutputBytes = {
    [ACQUISITION_OUTPUT_FILENAMES.source_archive]: source.archive,
    [ACQUISITION_OUTPUT_FILENAMES.response_headers]: source.headers,
    [ACQUISITION_OUTPUT_FILENAMES.source_member]: source.member,
    [ACQUISITION_OUTPUT_FILENAMES.canonical_member]: source.canonical,
    [ACQUISITION_OUTPUT_FILENAMES.acquisition_receipt]: new TextEncoder().encode(
      canonicalExternalAttempt115AcquisitionReceiptJson(source.receipt),
    ),
  };
  const outputIdentity = await verifyOutputDirectory(
    projectRoot,
    outputDirectory,
    Object.values(ACQUISITION_OUTPUT_FILENAMES),
    undefined,
    acquisitionOutputBytes,
  );
  const grid = replayExternalAttempt115Grid(source.parsed);
  if (grid.schema_version !== EXTERNAL_ATTEMPT115_REPLAY_GRID_SCHEMA
    || !SHA256_PATTERN.test(grid.grid_sha256 ?? "")
    || grid.grid_sha256 !== sha256(withoutKey(grid, "grid_sha256"))) {
    fail("external Attempt115 regenerated replay grid failed its self-binding");
  }
  const integrity = createIntegrityEvidence({
    protocol: frozen.protocol,
    protocolBytes: frozen.bytes,
    artifactBinding: afterAcquisitionArtifacts,
    source,
    grid,
  });

  const evaluatorArtifactBytes = await frozenArtifactBytes(projectRoot);
  let evaluationInvocationCount = 0;
  evaluationInvocationCount += 1;
  const evaluation = await evaluateExternalAttempt115({
    protocol: frozen.protocol,
    acquisitionReceipt: source.receipt,
    sourceBytes: { archive: source.archive },
    artifactBytes: evaluatorArtifactBytes,
  });
  if (evaluationInvocationCount !== 1
    || evaluation.schema_version !== EXTERNAL_ATTEMPT115_EVALUATION_SCHEMA
    || evaluation.replay_binding.grid_sha256 !== grid.grid_sha256
    || stableStringify(evaluation.gates.integrity.checks)
      !== stableStringify(evaluationIntegrityBooleans(integrity))
    || evaluation.gates.integrity.passed !== integrity.all_checks_passed) {
    fail(
      `external Attempt115 evaluation was not derived exactly once from integrity evidence: count=${evaluationInvocationCount}, schema=${evaluation.schema_version}, evaluated_integrity=${evaluation.gates.integrity.passed}, derived_integrity=${integrity.all_checks_passed}`,
    );
  }

  const finalArtifacts = await computeExternalAttempt115ArtifactHashes({ projectRoot });
  exactArtifactBinding(frozen.protocol, finalArtifacts);
  if (finalArtifacts.artifact_set_sha256 !== beforeArtifacts.artifact_set_sha256) {
    fail("external Attempt115 bound artifacts changed during replay or evaluation");
  }
  assertRuntimePrimordialsUnchanged();
  await verifyRunStartMarker(projectRoot, claim);
  await verifyOutputDirectory(
    projectRoot,
    outputDirectory,
    Object.values(ACQUISITION_OUTPUT_FILENAMES),
    outputIdentity,
    acquisitionOutputBytes,
  );
  const protocolBytes = new TextEncoder().encode(canonicalExternalAttempt115ProtocolJson(
    frozen.protocol,
  ));
  const gridBytes = new TextEncoder().encode(canonicalJson(grid));
  const integrityBytes = new TextEncoder().encode(canonicalJson(integrity));
  const evaluationBytes = new TextEncoder().encode(
    canonicalExternalAttempt115EvaluationJson(evaluation),
  );
  const outputBytes = {
    [ADDITIONAL_OUTPUT_FILENAMES.frozen_protocol]: protocolBytes,
    [ADDITIONAL_OUTPUT_FILENAMES.replay_grid]: gridBytes,
    [ADDITIONAL_OUTPUT_FILENAMES.integrity_evidence]: integrityBytes,
    [ADDITIONAL_OUTPUT_FILENAMES.evaluation]: evaluationBytes,
  };
  for (const [filename, bytes] of Object.entries(outputBytes)) {
    await writeOnce(join(outputDirectory, filename), bytes);
  }
  const persistedArtifactBytes = { ...acquisitionOutputBytes, ...outputBytes };
  await verifyOutputDirectory(
    projectRoot,
    outputDirectory,
    [...Object.values(ACQUISITION_OUTPUT_FILENAMES), ...Object.keys(outputBytes)],
    outputIdentity,
    persistedArtifactBytes,
  );
  const completedAt = canonicalInstant(officialNow(), "external Attempt115 completion clock");
  if (completedAt < source.receipt.acquired_at) {
    fail("external Attempt115 completion clock precedes source acquisition");
  }
  const receiptBody = runReceiptBody({
    protocol: frozen.protocol,
    source,
    grid,
    integrity,
    evaluation,
    runtime,
    processBoundary,
    claim,
    transport: transportEvidence,
    persistedArtifactBytes,
    completedAt,
  });
  const runReceipt = deepFreeze({
    ...receiptBody,
    run_receipt_sha256: sha256(receiptBody),
  });
  const runReceiptBytes = new TextEncoder().encode(canonicalJson(runReceipt));
  await writeOnce(
    join(outputDirectory, ADDITIONAL_OUTPUT_FILENAMES.run_receipt),
    runReceiptBytes,
  );
  const completedArtifactBytes = {
    ...persistedArtifactBytes,
    [ADDITIONAL_OUTPUT_FILENAMES.run_receipt]: runReceiptBytes,
  };
  await verifyRunStartMarker(projectRoot, claim);
  await verifyOutputDirectory(
    projectRoot,
    outputDirectory,
    [
      ...Object.values(ACQUISITION_OUTPUT_FILENAMES),
      ...Object.keys(outputBytes),
      ADDITIONAL_OUTPUT_FILENAMES.run_receipt,
    ],
    outputIdentity,
    completedArtifactBytes,
  );

  return deepFreeze({
    protocol: frozen.protocol,
    acquisition_receipt: source.receipt,
    replay_grid: grid,
    integrity_evidence: integrity,
    evaluation,
    run_receipt: runReceipt,
    output_directory: outputDirectory,
  });
}

async function runFixedCli() {
  const runnerPath = await realpath(fileURLToPath(import.meta.url));
  const projectRoot = await realpath(resolve(dirname(runnerPath), "../.."));
  try {
    const result = await runExternalAttempt115Once({ projectRoot });
    nodeProcess.stdout.write(`${JSON.stringify({
      evaluation_id: result.protocol.evaluation_id,
      protocol_sha256: result.protocol.protocol_sha256,
      evaluation_sha256: result.evaluation.evaluation_sha256,
      run_receipt_sha256: result.run_receipt.run_receipt_sha256,
      output_directory: result.output_directory,
    }, null, 2)}\n`);
  } catch (error) {
    nodeProcess.stderr.write(
      `External Attempt115 one-shot failed closed: ${error?.message ?? "unknown error"}\n`,
    );
    nodeProcess.exitCode = 1;
  }
}

if (import.meta.main === true) await runFixedCli();
