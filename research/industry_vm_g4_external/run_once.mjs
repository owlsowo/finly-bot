import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
} from "node:path";
import nodeProcess from "node:process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { sha256, stableStringify } from "../../lib/canonical.mjs";
import {
  parseKennethFrenchDailyFactorCsv,
} from "../external_validation_attempt115/kenneth_french_daily_factor_adapter.mjs";
import { evaluateIndustryVmG4External } from "./evaluation.mjs";
import {
  adaptKennethFrench10IndustryWithFactors,
  canonicalizeKennethFrench10IndustryDailyMember,
  parseKennethFrench10IndustryDailyCsv,
} from "./source.mjs";
import {
  INDUSTRY_VM_G4_ARTIFACT_PATHS,
  INDUSTRY_VM_G4_EXPECTED_DATE_SEQUENCE_SHA256,
  INDUSTRY_VM_G4_FACTOR_ARTIFACT_RAW_SHA256,
  INDUSTRY_VM_G4_FACTOR_ARTIFACT_RELATIVE_PATH,
  INDUSTRY_VM_G4_FIXED_OUTPUT_RELATIVE_PATH,
  INDUSTRY_VM_G4_FROZEN_PROTOCOL_RELATIVE_PATH,
  INDUSTRY_VM_G4_HTTP_ACCEPT,
  INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_MEMBER,
  INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL,
  INDUSTRY_VM_G4_OFFICIAL_SOURCE_FIRST_DATE,
  INDUSTRY_VM_G4_OFFICIAL_SOURCE_LAST_DATE,
  INDUSTRY_VM_G4_OFFICIAL_SOURCE_OBSERVATIONS,
  INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV,
  INDUSTRY_VM_G4_REQUIRED_NODE_VERSION,
  INDUSTRY_VM_G4_RUN_START_RELATIVE_PATH,
  canonicalIndustryVmG4ProtocolJson,
  validateIndustryVmG4Protocol,
  verifyIndustryVmG4ProtocolBytes,
} from "./protocol.mjs";

export const INDUSTRY_VM_G4_RUN_START_SCHEMA =
  "finly_industry_vm_g4_external_run_start.v1";
export const INDUSTRY_VM_G4_ACQUISITION_RECEIPT_SCHEMA =
  "finly_industry_vm_g4_external_acquisition_receipt.v1";
export const INDUSTRY_VM_G4_RUN_RECEIPT_SCHEMA =
  "finly_industry_vm_g4_external_run_receipt.v1";
export const INDUSTRY_VM_G4_FAILURE_RECEIPT_SCHEMA =
  "finly_industry_vm_g4_external_failure_receipt.v1";
export { INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV, INDUSTRY_VM_G4_REQUIRED_NODE_VERSION };

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_BOUND_FILE_BYTES = 32 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 512 * 1024;
const MAX_AGGREGATE_BYTES = 2 * 1024 * 1024;
const MAX_PRIMARY_SERIES_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 64 * 1024 * 1024;
const UNZIP_PATH = "/usr/bin/unzip";

function fail(message) {
  throw new TypeError(message);
}

function rawSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  return `${stableStringify(value)}\n`;
}

function canonicalInstant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("run timestamp is invalid");
  return date.toISOString();
}

export function assertIndustryVmG4Runtime({
  nodeVersion = nodeProcess.version,
  execArgv = nodeProcess.execArgv,
  nodeOptions = nodeProcess.env.NODE_OPTIONS,
} = {}) {
  if (nodeVersion !== INDUSTRY_VM_G4_REQUIRED_NODE_VERSION) {
    fail(`Attempt150 requires exact Node ${INDUSTRY_VM_G4_REQUIRED_NODE_VERSION}`);
  }
  if (!Array.isArray(execArgv)
    || execArgv.length !== INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV.length
    || execArgv.some((value, index) => value !== INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV[index])) {
    fail(`Attempt150 requires exact Node execArgv: ${INDUSTRY_VM_G4_REQUIRED_EXEC_ARGV.join(" ")}`);
  }
  if (nodeOptions !== undefined && nodeOptions !== "") {
    fail("Attempt150 forbids NODE_OPTIONS because it can inject unbound Node runtime behavior");
  }
  return true;
}

function canonicalRoot(value) {
  if (typeof value !== "string" || !isAbsolute(value) || normalize(value) !== value
    || value === parse(value).root) {
    fail("projectRoot must be a canonical absolute non-root path");
  }
  return value;
}

function absoluteProjectPath(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || isAbsolute(relativePath) || normalize(relativePath) !== relativePath
    || relativePath.split("/").some((part) => part === "" || part === "..")) {
    fail("project relative path is invalid");
  }
  const result = resolve(projectRoot, relativePath);
  const scoped = relative(projectRoot, result);
  if (scoped.startsWith("..") || isAbsolute(scoped) || scoped === "") {
    fail("project relative path escaped the root");
  }
  return result;
}

async function readBoundFile(projectRoot, relativePath, maximumBytes = MAX_BOUND_FILE_BYTES) {
  const path = absoluteProjectPath(projectRoot, relativePath);
  const status = await lstat(path);
  if (!status.isFile() || status.isSymbolicLink() || status.size <= 0 || status.size > maximumBytes) {
    fail(`bound file ${relativePath} is not a bounded regular file`);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== status.size) fail(`bound file ${relativePath} changed while read`);
  return bytes;
}

export async function computeIndustryVmG4ArtifactHashes({ projectRoot }) {
  const root = canonicalRoot(projectRoot);
  const sourceFilesSha256 = {};
  const testFilesSha256 = {};
  for (const path of INDUSTRY_VM_G4_ARTIFACT_PATHS.source_files) {
    sourceFilesSha256[path] = rawSha256(await readBoundFile(root, path));
  }
  for (const path of INDUSTRY_VM_G4_ARTIFACT_PATHS.test_files) {
    testFilesSha256[path] = rawSha256(await readBoundFile(root, path));
  }
  return Object.freeze({
    source_files_sha256: Object.freeze(sourceFilesSha256),
    test_files_sha256: Object.freeze(testFilesSha256),
    artifact_set_sha256: sha256({ sourceFilesSha256, testFilesSha256 }),
  });
}

function assertArtifactBinding(protocol, observed) {
  const expected = protocol.artifact_binding;
  if (stableStringify(expected.source_files_sha256) !== stableStringify(observed.source_files_sha256)
    || stableStringify(expected.test_files_sha256) !== stableStringify(observed.test_files_sha256)
    || expected.artifact_set_sha256 !== observed.artifact_set_sha256) {
    fail("bound source or test raw bytes changed after protocol freeze");
  }
}

async function writeExclusive(path, bytes, maximumBytes) {
  const payload = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  if (payload.byteLength <= 0 || payload.byteLength > maximumBytes) {
    fail(`output ${basename(path)} exceeds its fixed byte limit`);
  }
  const handle = await open(path, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT
    | FS_CONSTANTS.O_EXCL | (FS_CONSTANTS.O_NOFOLLOW ?? 0), 0o600);
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return payload.byteLength;
}

export async function claimIndustryVmG4RunStart({
  projectRoot,
  protocol,
  artifactBinding,
  now = new Date(),
}) {
  const root = canonicalRoot(projectRoot);
  validateIndustryVmG4Protocol(protocol);
  assertArtifactBinding(protocol, artifactBinding);
  const markerPath = absoluteProjectPath(root, INDUSTRY_VM_G4_RUN_START_RELATIVE_PATH);
  const outputPath = absoluteProjectPath(root, INDUSTRY_VM_G4_FIXED_OUTPUT_RELATIVE_PATH);
  await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 });
  if (await lstat(markerPath).then(() => true, (error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  })) fail("Attempt150 run-start is already claimed; retry is forbidden");
  if (await lstat(outputPath).then(() => true, (error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  })) fail("fixed Attempt150 output already exists; retry is forbidden");
  try {
    await mkdir(outputPath, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("Attempt150 run-start is already claimed; retry is forbidden");
    throw error;
  }
  try {
    const outputStatus = await lstat(outputPath);
    if (!outputStatus.isDirectory() || outputStatus.isSymbolicLink()
      || await realpath(outputPath) !== outputPath) {
      fail("fixed Attempt150 output must be a newly-created real directory");
    }
  } catch (error) {
    await rmdir(outputPath).catch(() => {});
    throw error;
  }
  const body = {
    schema_version: INDUSTRY_VM_G4_RUN_START_SCHEMA,
    evaluation_id: protocol.evaluation_id,
    started_at: canonicalInstant(now),
    protocol_sha256: protocol.protocol_sha256,
    artifact_set_sha256: artifactBinding.artifact_set_sha256,
    fixed_output_relative_path: INDUSTRY_VM_G4_FIXED_OUTPUT_RELATIVE_PATH,
    retry_permitted: false,
  };
  const marker = Object.freeze({ ...body, run_start_marker_sha256: sha256(body) });
  try {
    await writeExclusive(markerPath, canonicalJson(marker), MAX_RECEIPT_BYTES);
  } catch (error) {
    await rmdir(outputPath).catch(() => {});
    if (error?.code === "EEXIST") fail("Attempt150 run-start is already claimed; retry is forbidden");
    throw error;
  }
  return Object.freeze({ marker, marker_path: markerPath, output_path: outputPath });
}

export function validateIndustryVmG4ArchiveMemberName(name) {
  if (typeof name !== "string" || name.length === 0 || name.includes("/")
    || name.includes("\\") || name.includes("\0") || name === "." || name === ".."
    || name.startsWith("~") || /^[A-Za-z]:/u.test(name)) {
    fail("archive member must be one traversal-safe ASCII basename");
  }
  for (const character of name) {
    if (character.codePointAt(0) > 0x7f) {
      fail("archive member must be one traversal-safe ASCII basename");
    }
  }
  if (name.toLowerCase() !== INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_MEMBER.toLowerCase()) {
    fail("archive member does not case-fold to the frozen logical member");
  }
  return name;
}

function runUnzip(args, options = {}) {
  const result = spawnSync(UNZIP_PATH, args, {
    env: {},
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    maxBuffer: MAX_ARCHIVE_BYTES,
  });
  if (result.error || result.signal !== null || result.status !== 0) {
    fail(`Info-ZIP unzip failed: ${result.error?.message ?? result.stderr ?? result.signal ?? result.status}`);
  }
  return result.stdout;
}

function assertIndustryVmG4UnzipRuntime() {
  const version = runUnzip(["-v"]);
  if (!/^UnZip 6\.00 of 20 April 2009,/u.test(version)) {
    fail("local extractor is not the frozen Info-ZIP UnZip 6.00 implementation");
  }
  return true;
}

export function extractIndustryVmG4OfficialMember({ archivePath }) {
  if (typeof archivePath !== "string" || !isAbsolute(archivePath)) {
    fail("archivePath must be absolute");
  }
  assertIndustryVmG4UnzipRuntime();
  const names = runUnzip(["-Z1", archivePath]).split(/\r?\n/u).filter(Boolean);
  if (names.length !== 1) fail("archive must contain exactly one member");
  const selectedMemberName = validateIndustryVmG4ArchiveMemberName(names[0]);
  runUnzip(["-tqq", archivePath]);
  const bytes = runUnzip(["-p", archivePath, selectedMemberName], { encoding: null });
  if (!Buffer.isBuffer(bytes) || bytes.byteLength <= 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail("extracted member violates the 16 MiB bound");
  }
  return Object.freeze({ selected_member_name: selectedMemberName, member_bytes: bytes });
}

export function buildIndustryVmG4OfficialRequestOptions() {
  return Object.freeze({
    method: "GET",
    agent: false,
    headers: Object.freeze({
      Accept: INDUSTRY_VM_G4_HTTP_ACCEPT,
      "Accept-Encoding": "identity",
      Connection: "close",
    }),
  });
}

function downloadOfficialArchive() {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let wallClockTimer;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallClockTimer);
      callback(value);
    };
    const request = httpsRequest(
      INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL,
      buildIndustryVmG4OfficialRequestOptions(),
      (response) => {
      const encoding = response.headers["content-encoding"];
      const contentTypeHeader = response.headers["content-type"];
      const contentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader.join(", ")
        : contentTypeHeader ?? null;
      const location = response.headers.location;
      if (response.statusCode !== 200 || location !== undefined
        || (encoding !== undefined && String(encoding).toLowerCase() !== "identity")) {
        response.destroy();
        settle(rejectPromise, new TypeError("official response must be exact HTTP 200, non-redirected, and identity encoded"));
        return;
      }
      const declared = response.headers["content-length"];
      if (declared !== undefined && (!/^\d+$/u.test(String(declared))
        || Number(declared) > MAX_ARCHIVE_BYTES)) {
        response.destroy();
        settle(rejectPromise, new TypeError("official response content length violates the 16 MiB bound"));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.byteLength;
        if (total > MAX_ARCHIVE_BYTES) {
          response.destroy(new TypeError("official response exceeds the 16 MiB bound"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", (error) => settle(rejectPromise, error));
      response.on("aborted", () => settle(
        rejectPromise,
        new TypeError("official response aborted before completion"),
      ));
      response.on("end", () => {
        if (total <= 0 || (declared !== undefined && Number(declared) !== total)) {
          settle(rejectPromise, new TypeError("official response body is empty or differs from content length"));
          return;
        }
        settle(resolvePromise, Object.freeze({
          archive_bytes: Buffer.concat(chunks, total),
          transport_evidence: Object.freeze({
            url: INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL,
            method: "GET",
            accept: INDUSTRY_VM_G4_HTTP_ACCEPT,
            status: response.statusCode,
            redirected: false,
            content_encoding: encoding ?? null,
            content_type: contentType,
            timeout_ms: 30_000,
            response_bytes: total,
          }),
        }));
      });
      },
    );
    wallClockTimer = setTimeout(() => {
      const error = new TypeError("official request exceeded the absolute 30 second wall-clock deadline");
      request.destroy(error);
      settle(rejectPromise, error);
    }, 30_000);
    request.on("error", (error) => settle(rejectPromise, error));
    request.end();
  });
}

function requireOfficialDateIdentity(rows, label) {
  if (!Array.isArray(rows) || rows.length !== INDUSTRY_VM_G4_OFFICIAL_SOURCE_OBSERVATIONS
    || rows[0]?.date !== INDUSTRY_VM_G4_OFFICIAL_SOURCE_FIRST_DATE
    || rows.at(-1)?.date !== INDUSTRY_VM_G4_OFFICIAL_SOURCE_LAST_DATE
    || sha256(rows.map(({ date }) => date)) !== INDUSTRY_VM_G4_EXPECTED_DATE_SEQUENCE_SHA256) {
    fail(`${label} does not match the frozen 26,274-date identity`);
  }
}

async function atomicWrite(path, bytes, maximumBytes) {
  const temporary = `${path}.tmp`;
  await writeExclusive(temporary, bytes, maximumBytes);
  try {
    // link(2) publishes the fully fsynced inode atomically and fails with
    // EEXIST instead of replacing a destination created by a race.
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return Buffer.byteLength(bytes);
}

export function buildIndustryVmG4FailureReceipt({
  protocol,
  marker,
  error,
  outcomesObserved,
  failedAt = new Date(),
}) {
  if (typeof outcomesObserved !== "boolean") fail("outcomesObserved must be boolean");
  const body = {
    schema_version: INDUSTRY_VM_G4_FAILURE_RECEIPT_SCHEMA,
    evaluation_id: protocol.evaluation_id,
    protocol_sha256: protocol.protocol_sha256,
    run_start_marker_sha256: marker.run_start_marker_sha256,
    failed_at: canonicalInstant(failedAt),
    outcomes_observed: outcomesObserved,
    one_time_attempt_consumed: true,
    run_start_permanently_consumed_operational_attempt: true,
    retry_permitted: false,
    same_attempt_retry_permitted: false,
    successor_requires_new_preregistered_protocol: true,
    error_name: error?.name ?? "Error",
    error_message: String(error?.message ?? error).slice(0, 4096),
  };
  return Object.freeze({ ...body, failure_receipt_sha256: sha256(body) });
}

async function writeFailureReceipt(outputPath, protocol, marker, error, outcomesObserved) {
  const receipt = buildIndustryVmG4FailureReceipt({
    protocol,
    marker,
    error,
    outcomesObserved,
  });
  await atomicWrite(
    join(outputPath, "failure_receipt.json"),
    canonicalJson(receipt),
    MAX_RECEIPT_BYTES,
  );
}

async function loadBoundFactorRows(root) {
  const factorBytes = await readBoundFile(
    root,
    INDUSTRY_VM_G4_FACTOR_ARTIFACT_RELATIVE_PATH,
    2 * 1024 * 1024,
  );
  if (rawSha256(factorBytes) !== INDUSTRY_VM_G4_FACTOR_ARTIFACT_RAW_SHA256) {
    fail("bound factor artifact raw bytes changed");
  }
  const parsedFactors = parseKennethFrenchDailyFactorCsv(factorBytes);
  requireOfficialDateIdentity(parsedFactors.rows, "bound factor artifact");
  return parsedFactors.rows.map((row) => ({
    date: row.date,
    "Mkt-RF": row["Mkt-RF"],
    SMB: row.SMB,
    HML: row.HML,
    RF: row.RF,
  }));
}

async function prepareIndustryVmG4EvaluationInput({
  root,
  outputPath,
  fetched,
  markOutcomesObserved,
}) {
  // Keeping the raw factor bytes, parser wrapper, source archive/member, canonical
  // text, and parsed source inside this helper makes them unreachable before the
  // expensive evaluation begins. Only the adapted panel and compact receipt leave.
  const factorRows = await loadBoundFactorRows(root);
  if (!fetched || !Buffer.isBuffer(fetched.archive_bytes)
    || fetched.archive_bytes.byteLength <= 0
    || fetched.archive_bytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail("official transport returned an invalid archive envelope");
  }
  const archiveRawBytesSha256 = rawSha256(fetched.archive_bytes);
  const archiveFilename = "official_source_archive.zip";
  const archivePath = join(outputPath, archiveFilename);
  const archiveBytes = await atomicWrite(archivePath, fetched.archive_bytes, MAX_ARCHIVE_BYTES);
  const extracted = extractIndustryVmG4OfficialMember({ archivePath });
  const memberRawBytesSha256 = rawSha256(extracted.member_bytes);
  const memberFilename = "official_source_member.csv";
  const memberBytes = await atomicWrite(
    join(outputPath, memberFilename),
    extracted.member_bytes,
    MAX_ARCHIVE_BYTES,
  );
  const canonicalSource = canonicalizeKennethFrench10IndustryDailyMember(
    extracted.member_bytes,
  );
  const parsedIndustries = parseKennethFrench10IndustryDailyCsv(canonicalSource);
  requireOfficialDateIdentity(parsedIndustries.rows, "official 10 Industry source");

  // Parsing and the frozen date identity are the first point at which official
  // return outcomes have been observed. Any later failure consumes the attempt.
  markOutcomesObserved();

  const acquisitionCore = {
    schema_version: INDUSTRY_VM_G4_ACQUISITION_RECEIPT_SCHEMA,
    acquired_at: new Date().toISOString(),
    official_archive_url: INDUSTRY_VM_G4_OFFICIAL_ARCHIVE_URL,
    request_accept: INDUSTRY_VM_G4_HTTP_ACCEPT,
    archive_raw_bytes_sha256: archiveRawBytesSha256,
    selected_member_name: extracted.selected_member_name,
    selected_member_raw_bytes_sha256: memberRawBytesSha256,
    parsed_observations: parsedIndustries.rows.length,
    parsed_first_date: parsedIndustries.rows[0].date,
    parsed_last_date: parsedIndustries.rows.at(-1).date,
    iso_date_sequence_sha256: sha256(parsedIndustries.rows.map(({ date }) => date)),
    transport_evidence: fetched.transport_evidence,
  };
  const acquisitionReceipt = Object.freeze({
    ...acquisitionCore,
    acquisition_receipt_sha256: sha256(acquisitionCore),
  });
  const canonicalSourceBytes = `${canonicalSource}\n`;
  const canonicalSourceFilename = "canonical_10_industry_value_weighted.csv";
  const canonicalSourcePath = join(outputPath, canonicalSourceFilename);
  await atomicWrite(canonicalSourcePath, canonicalSourceBytes, MAX_ARCHIVE_BYTES);
  const canonicalSourceEvidence = Object.freeze({
    filename: canonicalSourceFilename,
    raw_sha256: rawSha256(canonicalSourceBytes),
    bytes: Buffer.byteLength(canonicalSourceBytes),
  });
  const retainedSourceEvidence = Object.freeze({
    [archiveFilename]: Object.freeze({
      raw_sha256: archiveRawBytesSha256,
      bytes: archiveBytes,
    }),
    [memberFilename]: Object.freeze({
      raw_sha256: memberRawBytesSha256,
      bytes: memberBytes,
    }),
    [canonicalSourceFilename]: Object.freeze({
      raw_sha256: canonicalSourceEvidence.raw_sha256,
      bytes: canonicalSourceEvidence.bytes,
    }),
  });
  const adapted = adaptKennethFrench10IndustryWithFactors(parsedIndustries, factorRows);
  return Object.freeze({ adapted, acquisitionReceipt, retainedSourceEvidence });
}

async function acquireAndPrepareOfficialIndustryInput({
  root,
  outputPath,
  markOutcomesObserved,
}) {
  // The transport envelope is scoped to this helper so its raw archive Buffer
  // cannot remain reachable while the evaluation grid is in memory.
  const fetched = await downloadOfficialArchive();
  return prepareIndustryVmG4EvaluationInput({
    root,
    outputPath,
    fetched,
    markOutcomesObserved,
  });
}

/** Private consuming path: only directMain can reach it and acquisition is hardwired. */
async function runIndustryVmG4ExternalOnce({
  projectRoot,
  protocol,
  now = new Date(),
}) {
  const root = canonicalRoot(projectRoot);
  if (await realpath(root) !== root) fail("projectRoot must not be a symlink alias");
  validateIndustryVmG4Protocol(protocol);
  const artifactBinding = await computeIndustryVmG4ArtifactHashes({ projectRoot: root });
  assertArtifactBinding(protocol, artifactBinding);
  // Deterministic local failures must be discovered before the irreversible
  // marker. Reloading inside the claimed run then detects any post-preflight
  // factor mutation as well.
  await loadBoundFactorRows(root);
  assertIndustryVmG4UnzipRuntime();
  const claim = await claimIndustryVmG4RunStart({
    projectRoot: root,
    protocol,
    artifactBinding,
    now,
  });
  let outcomesObserved = false;
  try {
    const prepared = await acquireAndPrepareOfficialIndustryInput({
      root,
      outputPath: claim.output_path,
      markOutcomesObserved() { outcomesObserved = true; },
    });
    const evaluated = evaluateIndustryVmG4External(prepared.adapted, {
      integrityInputs: {
        protocol_self_hash: true,
        artifact_hash_binding: true,
        official_source_identity_and_receipt: true,
        strict_parser_schema_and_row_order: true,
        source_transform_identity_and_exact_date_alignment: true,
        future_observation_mutation_invariance: true,
      },
    });
    const outputs = {
      "aggregate_evaluation.json": canonicalJson(evaluated.aggregate),
      "primary_pair_series.json": canonicalJson(evaluated.primary_paired_series),
      "acquisition_receipt.json": canonicalJson(prepared.acquisitionReceipt),
      "frozen_protocol.json": canonicalIndustryVmG4ProtocolJson(protocol),
    };
    if (Buffer.byteLength(outputs["aggregate_evaluation.json"]) > MAX_AGGREGATE_BYTES
      || Buffer.byteLength(outputs["primary_pair_series.json"]) > MAX_PRIMARY_SERIES_BYTES
      || Buffer.byteLength(outputs["acquisition_receipt.json"]) > MAX_RECEIPT_BYTES) {
      fail("evaluation or acquisition receipt exceeds a frozen output cap");
    }
    const outputHashes = {
      ...Object.fromEntries(Object.entries(prepared.retainedSourceEvidence).map(([name, value]) => [
        name,
        value.raw_sha256,
      ])),
      ...Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [
        name,
        rawSha256(bytes),
      ])),
    };
    const runCore = {
      schema_version: INDUSTRY_VM_G4_RUN_RECEIPT_SCHEMA,
      evaluation_id: protocol.evaluation_id,
      protocol_sha256: protocol.protocol_sha256,
      artifact_set_sha256: artifactBinding.artifact_set_sha256,
      run_start_marker_sha256: claim.marker.run_start_marker_sha256,
      completed_at: new Date().toISOString(),
      outcome_observed: true,
      rerun_permitted: false,
      full_grid_persisted: false,
      request_accept: INDUSTRY_VM_G4_HTTP_ACCEPT,
      response_content_type: prepared.acquisitionReceipt.transport_evidence.content_type,
      output_raw_sha256: outputHashes,
      evaluation_sha256: evaluated.aggregate.evaluation_sha256,
      primary_series_sha256: evaluated.primary_paired_series.series_sha256,
      all_nine_gates_passed: evaluated.aggregate.all_nine_gates_passed,
    };
    const runReceipt = { ...runCore, run_receipt_sha256: sha256(runCore) };
    outputs["run_receipt.json"] = canonicalJson(runReceipt);
    if (Buffer.byteLength(outputs["run_receipt.json"]) > MAX_RECEIPT_BYTES) {
      fail("run receipt exceeds the 512 KiB cap");
    }
    const totalBytes = Object.values(prepared.retainedSourceEvidence).reduce(
      (sum, value) => sum + value.bytes,
      0,
    ) + Object.values(outputs).reduce(
      (sum, bytes) => sum + Buffer.byteLength(bytes),
      0,
    );
    if (totalBytes > MAX_TOTAL_OUTPUT_BYTES) fail("Attempt150 output exceeds the 64 MiB cap");
    for (const [name, bytes] of Object.entries(outputs)) {
      const maximum = name === "aggregate_evaluation.json"
        ? MAX_AGGREGATE_BYTES
        : name === "primary_pair_series.json"
          ? MAX_PRIMARY_SERIES_BYTES
          : name.endsWith("receipt.json")
            ? MAX_RECEIPT_BYTES
            : MAX_TOTAL_OUTPUT_BYTES;
      await atomicWrite(join(claim.output_path, name), bytes, maximum);
    }
    return Object.freeze({ run_receipt: Object.freeze(runReceipt), output_path: claim.output_path });
  } catch (error) {
    try {
      await writeFailureReceipt(claim.output_path, protocol, claim.marker, error, outcomesObserved);
    } catch (receiptError) {
      throw new AggregateError(
        [error, receiptError],
        "Attempt150 failed and its mandatory consumed-attempt receipt could not be written",
      );
    }
    throw error;
  }
}

/**
 * Non-consuming official-scale synthetic proof surface. It never reads or
 * writes the fixed Attempt150 marker/output paths and cannot emit an official
 * acquisition or run receipt. It exists solely to prove the bound heap against
 * the complete parser -> adapter -> evaluator pipeline before protocol freeze.
 */
export async function proveIndustryVmG4SyntheticPipeline({
  projectRoot,
  syntheticArchiveBytes,
}) {
  assertIndustryVmG4Runtime();
  const root = canonicalRoot(projectRoot);
  if (await realpath(root) !== root) fail("projectRoot must not be a symlink alias");
  if (!Buffer.isBuffer(syntheticArchiveBytes)
    || syntheticArchiveBytes.byteLength <= 0
    || syntheticArchiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail("synthetic proof archive must be a bounded non-empty Buffer");
  }
  const proofRoot = await mkdtemp(join(tmpdir(), "finly-industry-vm-g4-proof-"));
  let outcomesObserved = false;
  try {
    const prepared = await prepareIndustryVmG4EvaluationInput({
      root,
      outputPath: proofRoot,
      fetched: Object.freeze({
        archive_bytes: syntheticArchiveBytes,
        transport_evidence: Object.freeze({ synthetic_official_scale_proof: true }),
      }),
      markOutcomesObserved() { outcomesObserved = true; },
    });
    const evaluated = evaluateIndustryVmG4External(prepared.adapted, {
      integrityInputs: {
        protocol_self_hash: false,
        artifact_hash_binding: false,
        official_source_identity_and_receipt: false,
        strict_parser_schema_and_row_order: true,
        source_transform_identity_and_exact_date_alignment: true,
        future_observation_mutation_invariance: false,
      },
    });
    return Object.freeze({
      synthetic_proof_only: true,
      consumes_attempt150: false,
      outcomes_observed: outcomesObserved,
      source_observations: evaluated.aggregate.source.observations,
      primary_observations: evaluated.primary_paired_series.rows.length,
      aggregate_bytes: evaluated.output_size_guard.aggregate_bytes,
      primary_series_bytes: evaluated.output_size_guard.primary_series_bytes,
    });
  } finally {
    await rm(proofRoot, { recursive: true, force: true });
  }
}

async function directMain() {
  if (nodeProcess.argv.length !== 2) fail("Attempt150 direct CLI accepts no arguments");
  assertIndustryVmG4Runtime();
  const scriptPath = await realpath(fileURLToPath(import.meta.url));
  const projectRoot = await realpath(resolve(dirname(scriptPath), "../.."));
  const protocolBytes = await readBoundFile(
    projectRoot,
    INDUSTRY_VM_G4_FROZEN_PROTOCOL_RELATIVE_PATH,
    2 * 1024 * 1024,
  );
  const protocol = verifyIndustryVmG4ProtocolBytes(protocolBytes);
  await runIndustryVmG4ExternalOnce({ projectRoot, protocol });
}

if (import.meta.main === true) {
  directMain().catch((error) => {
    nodeProcess.stderr.write(`Attempt150 runner failed closed: ${error?.message ?? error}\n`);
    nodeProcess.exitCode = 1;
  });
}
