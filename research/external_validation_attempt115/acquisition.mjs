import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve } from "node:path";

import { sha256 } from "../../lib/canonical.mjs";
import {
  canonicalizeKennethFrenchDailyFactorZipMember,
  parseKennethFrenchDailyFactorCsv,
} from "./kenneth_french_daily_factor_adapter.mjs";
import {
  EXTERNAL_ATTEMPT115_EVALUATION_ID,
  EXTERNAL_ATTEMPT115_PROTOCOL_STATUS,
  EXTERNAL_ATTEMPT115_SOURCE_URL,
  validateExternalAttempt115Protocol,
} from "./protocol.mjs";
import { extractExternalAttempt115SingleZipMember } from "./strict_zip.mjs";

export const EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA =
  "finly_attempt115_french_source_acquisition_receipt.v2";
export const EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER =
  "F-F_Research_Data_Factors_daily.CSV";
export const EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
export const EXTERNAL_ATTEMPT115_MAX_MEMBER_BYTES = 16 * 1024 * 1024;
export const EXTERNAL_ATTEMPT115_FETCH_TIMEOUT_MS = 30_000;

const MINIMUM_PARSED_ROWS = 255;
const ACCEPTED_CONTENT_TYPES = Object.freeze([
  "application/octet-stream",
  "application/x-zip-compressed",
  "application/zip",
]);
const OUTPUT_FILENAMES = Object.freeze({
  archive: "source_archive.zip",
  headers: "response_headers.json",
  member: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
  canonical: "canonical_daily_factors.csv",
  receipt: "acquisition_receipt.json",
});
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const NativeDate = globalThis.Date;
const nativeDateGetTime = NativeDate.prototype.getTime;
const nativeDateToISOString = NativeDate.prototype.toISOString;
const nativeReflectApply = Reflect.apply;
const nativeAbortSignalTimeout = globalThis.AbortSignal.timeout.bind(globalThis.AbortSignal);

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
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalSort(item)]),
  );
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalSort(value), null, 2)}\n`;
}

function rawSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactByteCopy(value, label) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ));
  }
  fail(`${label} must be supplied as bytes`);
}

function canonicalInstant(value, label) {
  const date = value instanceof NativeDate ? value : new NativeDate(value);
  if (!Number.isFinite(nativeReflectApply(nativeDateGetTime, date, []))) {
    fail(`${label} must be a valid instant`);
  }
  const instant = nativeReflectApply(nativeDateToISOString, date, []);
  if (typeof value === "string" && value !== instant) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return instant;
}

function canonicalDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${label} must be an ISO calendar date`);
  }
  const parsed = new NativeDate(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(nativeReflectApply(nativeDateGetTime, parsed, []))
    || nativeReflectApply(nativeDateToISOString, parsed, []).slice(0, 10) !== value) {
    fail(`${label} must be a valid ISO calendar date`);
  }
  return value;
}

function normalizeResponseHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    fail("Kenneth French response headers are required");
  }
  let entries;
  if (typeof headers.entries === "function") {
    entries = [...headers.entries()];
  } else if (Object.getPrototypeOf(headers) === Object.prototype) {
    entries = Object.entries(headers);
  } else {
    fail("Kenneth French response headers must be iterable or a plain object");
  }
  if (entries.length === 0) fail("Kenneth French response headers are empty");

  const observedNames = new Set();
  const normalized = entries.map(([rawName, rawValue]) => {
    const name = String(rawName).trim().toLowerCase();
    const value = String(rawValue).trim();
    if (!HEADER_NAME_PATTERN.test(name)) fail("Kenneth French response header name is invalid");
    if (/\r|\n|\0/u.test(value)) fail(`Kenneth French response header ${name} is invalid`);
    if (observedNames.has(name)) fail(`Kenneth French response header ${name} is ambiguous`);
    observedNames.add(name);
    return { name, value };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return normalized;
}

function uniqueHeader(headers, name, { required = false } = {}) {
  const matches = headers.filter((header) => header.name === name);
  if (matches.length > 1) fail(`Kenneth French response header ${name} is ambiguous`);
  if (required && matches.length !== 1) fail(`Kenneth French response header ${name} is required`);
  return matches[0]?.value ?? null;
}

function validateTransportMetadata(response, headers) {
  if (!response || typeof response !== "object") {
    fail("Kenneth French acquisition returned no response");
  }
  if (response.status !== 200 || response.ok !== true) {
    fail(`Kenneth French acquisition requires an exact HTTP 200 response`);
  }
  if (response.redirected !== false) {
    fail("Kenneth French acquisition must not follow or report a redirect");
  }
  if (response.url !== EXTERNAL_ATTEMPT115_SOURCE_URL) {
    fail("Kenneth French acquisition response URL changed");
  }

  const contentTypeRaw = uniqueHeader(headers, "content-type", { required: true });
  const contentType = contentTypeRaw.split(";", 1)[0].trim().toLowerCase();
  if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) {
    fail("Kenneth French acquisition response is not an accepted ZIP content type");
  }
  const contentEncoding = uniqueHeader(headers, "content-encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") {
    fail("Kenneth French acquisition requires an identity-encoded response");
  }

  const declaredLengthRaw = uniqueHeader(headers, "content-length");
  if (declaredLengthRaw === null) return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(declaredLengthRaw)) {
    fail("Kenneth French acquisition content-length is invalid");
  }
  const declaredLength = Number(declaredLengthRaw);
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    fail("Kenneth French acquisition content-length must be a positive safe integer");
  }
  if (declaredLength > EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES) {
    fail("Kenneth French acquisition archive exceeds the fixed byte limit");
  }
  return declaredLength;
}

async function readBoundedResponseBody(response, declaredLength) {
  if (!response.body || typeof response.body.getReader !== "function") {
    fail("Kenneth French acquisition requires a streaming response body");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let observedLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = exactByteCopy(value, "Kenneth French response chunk");
      if (bytes.byteLength === 0) continue;
      observedLength += bytes.byteLength;
      if (observedLength > EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES) {
        await reader.cancel("fixed archive byte limit exceeded").catch(() => {});
        fail("Kenneth French acquisition archive exceeds the fixed byte limit");
      }
      if (declaredLength !== null && observedLength > declaredLength) {
        await reader.cancel("declared content-length exceeded").catch(() => {});
        fail("Kenneth French acquisition body exceeds its declared content-length");
      }
      chunks.push(bytes);
    }
  } finally {
    reader.releaseLock();
  }
  if (observedLength === 0) fail("Kenneth French acquisition returned an empty archive");
  if (declaredLength !== null && observedLength !== declaredLength) {
    fail("Kenneth French acquisition body does not match its declared content-length");
  }
  const archive = new Uint8Array(observedLength);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (archive.byteLength < 4
    || archive[0] !== 0x50
    || archive[1] !== 0x4b
    || archive[2] !== 0x03
    || archive[3] !== 0x04) {
    fail("Kenneth French acquisition body is not a ZIP archive with a local file header");
  }
  return archive;
}

function traversalLikeMemberName(name) {
  return name.length === 0
    || name.includes("\0")
    || name.includes("/")
    || name.includes("\\")
    || name === "."
    || name === ".."
    || /^[A-Za-z]:/u.test(name)
    || name.startsWith("~")
    || name.normalize("NFC") !== name;
}

function asciiCaseFoldedMemberBasename(name, label) {
  if (typeof name !== "string" || traversalLikeMemberName(name)) {
    fail(`${label} must be a traversal-safe ASCII basename`);
  }
  let folded = "";
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code > 0x7f) fail(`${label} must be a traversal-safe ASCII basename`);
    folded += code >= 0x41 && code <= 0x5a
      ? String.fromCharCode(code + 0x20)
      : name[index];
  }
  return folded;
}

const EXPECTED_ARCHIVE_MEMBER_ASCII_FOLD = asciiCaseFoldedMemberBasename(
  EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
  "Kenneth French logical ZIP member name",
);

function validateSelectedMemberName(name) {
  if (asciiCaseFoldedMemberBasename(name, "Kenneth French ZIP member name")
    !== EXPECTED_ARCHIVE_MEMBER_ASCII_FOLD) {
    fail("Kenneth French ZIP archive member differs from the ASCII case-folded logical name");
  }
  return name;
}

async function extractExpectedMember(archiveBytes, zipExtractor) {
  if (typeof zipExtractor !== "function") {
    fail("Kenneth French acquisition requires an injected in-memory ZIP extractor");
  }
  const extractorArchive = exactByteCopy(archiveBytes, "Kenneth French archive");
  const archiveBefore = rawSha256(extractorArchive);
  let entries;
  try {
    entries = await zipExtractor(extractorArchive, {
      expected_member_name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
      maximum_entry_count: 1,
      maximum_uncompressed_member_bytes: EXTERNAL_ATTEMPT115_MAX_MEMBER_BYTES,
    });
  } catch (error) {
    throw new TypeError(`Kenneth French ZIP extraction failed: ${error?.message ?? "unknown error"}`);
  }
  if (rawSha256(extractorArchive) !== archiveBefore) {
    fail("Kenneth French ZIP extractor mutated the raw archive bytes");
  }
  if (!Array.isArray(entries) || entries.length !== 1) {
    fail("Kenneth French ZIP archive must contain exactly one member");
  }
  const entry = entries[0];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    fail("Kenneth French ZIP member metadata is invalid");
  }
  validateSelectedMemberName(entry.name);
  if (entry.directory === true || entry.isDirectory === true) {
    fail("Kenneth French ZIP archive member must be a regular file");
  }
  const bytes = exactByteCopy(entry.bytes, "Kenneth French ZIP member");
  if (bytes.byteLength === 0 || bytes.byteLength > EXTERNAL_ATTEMPT115_MAX_MEMBER_BYTES) {
    fail("Kenneth French ZIP member violates the fixed byte limit");
  }
  if (entry.uncompressedSize !== undefined
    && entry.uncompressedSize !== bytes.byteLength) {
    fail("Kenneth French ZIP member byte count disagrees with extractor metadata");
  }
  return Object.freeze({ name: entry.name, bytes });
}

/** Pure in-memory archive boundary retaining the archive's actual ASCII basename. */
export async function extractExternalAttempt115ArchiveMemberRecord(
  input,
  zipExtractor = extractExternalAttempt115SingleZipMember,
) {
  const archiveBytes = exactByteCopy(input, "Kenneth French archive");
  if (archiveBytes.byteLength < 4
    || archiveBytes.byteLength > EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES
    || archiveBytes[0] !== 0x50
    || archiveBytes[1] !== 0x4b
    || archiveBytes[2] !== 0x03
    || archiveBytes[3] !== 0x04) {
    fail("Kenneth French archive violates the fixed ZIP byte boundary");
  }
  return extractExpectedMember(archiveBytes, zipExtractor);
}

/** Backwards-compatible bytes-only view over the receipt-aware archive boundary. */
export async function extractExternalAttempt115ArchiveMember(
  input,
  zipExtractor = extractExternalAttempt115SingleZipMember,
) {
  return (await extractExternalAttempt115ArchiveMemberRecord(input, zipExtractor)).bytes;
}

function validateProtocolAcquisitionBoundary(protocol, acquisitionState) {
  const validated = validateExternalAttempt115Protocol(protocol);
  if (validated.status !== EXTERNAL_ATTEMPT115_PROTOCOL_STATUS
    || validated.source_freeze.source_acquisition_state !== "NOT_ACQUIRED_FOR_ATTEMPT_118"
    || validated.source_freeze.source_acquired_before_freeze !== false
    || validated.source_freeze.source_values_observed_before_freeze !== false
    || validated.source_freeze.official_archive_url !== EXTERNAL_ATTEMPT115_SOURCE_URL
    || validated.source_freeze.official_archive_member
      !== EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER) {
    fail("Kenneth French acquisition protocol is not frozen before source acquisition");
  }
  if (!acquisitionState
    || Object.getPrototypeOf(acquisitionState) !== Object.prototype
    || Object.keys(acquisitionState).length !== 1
    || acquisitionState.source_data_acquired !== false) {
    fail("Kenneth French acquisition requires explicit source_data_acquired false state");
  }
  return validated;
}

async function validateExplicitUnusedOutputDirectory(outputDirectory) {
  if (typeof outputDirectory !== "string"
    || !isAbsolute(outputDirectory)
    || outputDirectory !== normalize(outputDirectory)
    || outputDirectory === parse(outputDirectory).root) {
    fail("Kenneth French acquisition output directory must be an explicit canonical absolute path");
  }
  const parent = dirname(outputDirectory);
  const parentStatus = await lstat(parent).catch((error) => {
    if (error?.code === "ENOENT") fail("Kenneth French acquisition output parent is missing");
    throw error;
  });
  if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) {
    fail("Kenneth French acquisition output parent must be a regular non-symlink directory");
  }
  if (await realpath(parent) !== parent) {
    fail("Kenneth French acquisition output parent must not traverse a symlink");
  }

  const root = parse(parent).root;
  let cursor = root;
  for (const segment of relative(root, parent).split("/").filter(Boolean)) {
    cursor = resolve(cursor, segment);
    const status = await lstat(cursor);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      fail("Kenneth French acquisition output path must not traverse a symlink");
    }
  }
  const existing = await lstat(outputDirectory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing !== null) fail("Kenneth French acquisition output directory already exists");
}

function acquisitionReceiptBody({
  protocol,
  acquiredAt,
  archiveBytes,
  responseHeadersBytes,
  memberName,
  memberBytes,
  canonicalBytes,
  parsed,
}) {
  const firstDate = parsed.rows[0]?.date;
  const lastDate = parsed.rows.at(-1)?.date;
  if (firstDate !== protocol.source_freeze.expected_source_first_date) {
    fail("Kenneth French parsed first date changed from the frozen source expectation");
  }
  if (parsed.rows.length < MINIMUM_PARSED_ROWS) {
    fail(`Kenneth French parsed source requires at least ${MINIMUM_PARSED_ROWS} valid rows`);
  }
  if (lastDate > acquiredAt.slice(0, 10)) {
    fail("Kenneth French parsed last date is later than its acquisition date");
  }
  if (lastDate < protocol.sample_partition.primary_partition.last_scored_outcome_date_inclusive) {
    fail("Kenneth French parsed source does not span the frozen primary partition");
  }
  return {
    schema_version: EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA,
    evaluation_id: EXTERNAL_ATTEMPT115_EVALUATION_ID,
    protocol_sha256: protocol.protocol_sha256,
    source_data_acquired: true,
    acquired_at: acquiredAt,
    official_archive_url: EXTERNAL_ATTEMPT115_SOURCE_URL,
    request: {
      method: "GET",
      redirects_permitted: false,
      credentials_sent: false,
      content_encoding_required: "identity",
    },
    source_vintage: {
      binding: "CURRENT_PROVIDER_VINTAGE_AT_ACQUISITION",
      acquired_at: acquiredAt,
      archive_raw_bytes_sha256: rawSha256(archiveBytes),
      selected_member_raw_bytes_sha256: rawSha256(memberBytes),
    },
    archive_raw_bytes_sha256: rawSha256(archiveBytes),
    archive_raw_byte_count: archiveBytes.byteLength,
    response_headers_sha256: rawSha256(responseHeadersBytes),
    response_headers_byte_count: responseHeadersBytes.byteLength,
    selected_member_name: memberName,
    selected_member_raw_bytes_sha256: rawSha256(memberBytes),
    selected_member_raw_byte_count: memberBytes.byteLength,
    canonical_member_sha256: rawSha256(canonicalBytes),
    canonical_member_byte_count: canonicalBytes.byteLength,
    parsed_first_date: firstDate,
    parsed_last_date: lastDate,
    parsed_valid_row_count: parsed.rows.length,
    preserved_artifacts: {
      raw_archive: OUTPUT_FILENAMES.archive,
      normalized_response_headers: OUTPUT_FILENAMES.headers,
      raw_selected_member: OUTPUT_FILENAMES.member,
      canonical_selected_member: OUTPUT_FILENAMES.canonical,
      acquisition_receipt: OUTPUT_FILENAMES.receipt,
    },
    claim_boundary:
      "Source acquisition metadata only; this receipt contains no factor values, returns, positions, policy outputs, evaluation result, performance claim, or authorization.",
  };
}

export function hashExternalAttempt115AcquisitionReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("Kenneth French acquisition receipt must be an object");
  }
  const body = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "acquisition_receipt_sha256"),
  );
  return sha256(body);
}

export function canonicalExternalAttempt115AcquisitionReceiptJson(receipt) {
  return canonicalJson(receipt);
}

export function validateExternalAttempt115AcquisitionReceipt(receipt, protocol) {
  const validatedProtocol = validateExternalAttempt115Protocol(protocol);
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("Kenneth French acquisition receipt must be an object");
  }
  const exactReceiptKeys = [
    "schema_version",
    "evaluation_id",
    "protocol_sha256",
    "source_data_acquired",
    "acquired_at",
    "official_archive_url",
    "request",
    "source_vintage",
    "archive_raw_bytes_sha256",
    "archive_raw_byte_count",
    "response_headers_sha256",
    "response_headers_byte_count",
    "selected_member_name",
    "selected_member_raw_bytes_sha256",
    "selected_member_raw_byte_count",
    "canonical_member_sha256",
    "canonical_member_byte_count",
    "parsed_first_date",
    "parsed_last_date",
    "parsed_valid_row_count",
    "preserved_artifacts",
    "claim_boundary",
    "acquisition_receipt_sha256",
  ].sort();
  if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(exactReceiptKeys)) {
    fail("Kenneth French acquisition receipt fields changed");
  }
  const exactNestedKeys = (value, expected, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
      fail(`${label} fields changed`);
    }
  };
  exactNestedKeys(receipt.request, [
    "method",
    "redirects_permitted",
    "credentials_sent",
    "content_encoding_required",
  ], "Kenneth French acquisition request receipt");
  exactNestedKeys(receipt.source_vintage, [
    "binding",
    "acquired_at",
    "archive_raw_bytes_sha256",
    "selected_member_raw_bytes_sha256",
  ], "Kenneth French acquisition source vintage");
  exactNestedKeys(receipt.preserved_artifacts, [
    "raw_archive",
    "normalized_response_headers",
    "raw_selected_member",
    "canonical_selected_member",
    "acquisition_receipt",
  ], "Kenneth French acquisition preserved artifacts");
  if (receipt.schema_version !== EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA
    || receipt.evaluation_id !== EXTERNAL_ATTEMPT115_EVALUATION_ID
    || receipt.protocol_sha256 !== validatedProtocol.protocol_sha256
    || receipt.source_data_acquired !== true
    || receipt.official_archive_url !== EXTERNAL_ATTEMPT115_SOURCE_URL
    || receipt.parsed_first_date !== validatedProtocol.source_freeze.expected_source_first_date
    || !Number.isSafeInteger(receipt.parsed_valid_row_count)
    || receipt.parsed_valid_row_count < MINIMUM_PARSED_ROWS
    || !SHA256_PATTERN.test(receipt.archive_raw_bytes_sha256 ?? "")
    || !SHA256_PATTERN.test(receipt.selected_member_raw_bytes_sha256 ?? "")
    || !SHA256_PATTERN.test(receipt.response_headers_sha256 ?? "")
    || !SHA256_PATTERN.test(receipt.canonical_member_sha256 ?? "")
    || !SHA256_PATTERN.test(receipt.acquisition_receipt_sha256 ?? "")
    || !Number.isSafeInteger(receipt.archive_raw_byte_count)
    || receipt.archive_raw_byte_count <= 0
    || receipt.archive_raw_byte_count > EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES
    || !Number.isSafeInteger(receipt.response_headers_byte_count)
    || receipt.response_headers_byte_count <= 0
    || !Number.isSafeInteger(receipt.selected_member_raw_byte_count)
    || receipt.selected_member_raw_byte_count <= 0
    || receipt.selected_member_raw_byte_count > EXTERNAL_ATTEMPT115_MAX_MEMBER_BYTES
    || !Number.isSafeInteger(receipt.canonical_member_byte_count)
    || receipt.canonical_member_byte_count <= 0
    || receipt.request.method !== "GET"
    || receipt.request.redirects_permitted !== false
    || receipt.request.credentials_sent !== false
    || receipt.request.content_encoding_required !== "identity"
    || receipt.source_vintage.binding !== "CURRENT_PROVIDER_VINTAGE_AT_ACQUISITION"
    || receipt.preserved_artifacts.raw_archive !== OUTPUT_FILENAMES.archive
    || receipt.preserved_artifacts.normalized_response_headers !== OUTPUT_FILENAMES.headers
    || receipt.preserved_artifacts.raw_selected_member !== OUTPUT_FILENAMES.member
    || receipt.preserved_artifacts.canonical_selected_member !== OUTPUT_FILENAMES.canonical
    || receipt.preserved_artifacts.acquisition_receipt !== OUTPUT_FILENAMES.receipt
    || receipt.claim_boundary
      !== "Source acquisition metadata only; this receipt contains no factor values, returns, positions, policy outputs, evaluation result, performance claim, or authorization."
    || receipt.acquisition_receipt_sha256 !== hashExternalAttempt115AcquisitionReceipt(receipt)) {
    fail("Kenneth French acquisition receipt identity or self-hash is invalid");
  }
  validateSelectedMemberName(receipt.selected_member_name);
  canonicalInstant(receipt.acquired_at, "Kenneth French receipt acquired_at");
  canonicalDate(receipt.parsed_first_date, "Kenneth French receipt parsed_first_date");
  canonicalDate(receipt.parsed_last_date, "Kenneth French receipt parsed_last_date");
  if (receipt.acquired_at <= validatedProtocol.frozen_at
    || receipt.parsed_last_date > receipt.acquired_at.slice(0, 10)
    || receipt.parsed_last_date
      < validatedProtocol.sample_partition.primary_partition.last_scored_outcome_date_inclusive) {
    fail("Kenneth French acquisition receipt source date range is invalid");
  }
  if (receipt.source_vintage?.acquired_at !== receipt.acquired_at
    || receipt.source_vintage?.archive_raw_bytes_sha256 !== receipt.archive_raw_bytes_sha256
    || receipt.source_vintage?.selected_member_raw_bytes_sha256
      !== receipt.selected_member_raw_bytes_sha256) {
    fail("Kenneth French acquisition receipt vintage binding is invalid");
  }
  return deepFreeze(structuredClone(receipt));
}

async function persistAcquisitionWriteOnce({
  outputDirectory,
  archiveBytes,
  headersBytes,
  memberBytes,
  canonicalBytes,
  receiptBytes,
}) {
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  const createdStatus = await lstat(outputDirectory);
  if (!createdStatus.isDirectory() || createdStatus.isSymbolicLink()
    || await realpath(outputDirectory) !== outputDirectory) {
    fail("Kenneth French acquisition output directory is not a fixed regular directory");
  }
  const syncDirectory = async (path) => {
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
  };
  await syncDirectory(outputDirectory);
  await syncDirectory(dirname(outputDirectory));
  const artifacts = [
    [OUTPUT_FILENAMES.archive, archiveBytes],
    [OUTPUT_FILENAMES.headers, headersBytes],
    [OUTPUT_FILENAMES.member, memberBytes],
    [OUTPUT_FILENAMES.canonical, canonicalBytes],
    [OUTPUT_FILENAMES.receipt, receiptBytes],
  ];
  for (const [filename, bytes] of artifacts) {
    let handle;
    try {
      handle = await open(
        join(outputDirectory, filename),
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
  }
  await syncDirectory(outputDirectory);
  return Object.freeze(Object.fromEntries(
    Object.entries(OUTPUT_FILENAMES).map(([key, filename]) => [key, join(outputDirectory, filename)]),
  ));
}

/**
 * Perform the single post-freeze source acquisition without evaluating either
 * policy. The ZIP extractor is injected and must return in-memory entries; the
 * acquisition layer never delegates filesystem paths to it.
 */
export async function acquireExternalAttempt115KennethFrenchSource({
  protocol,
  acquisitionState,
  outputDirectory,
  fetchImpl = globalThis.fetch,
  zipExtractor = extractExternalAttempt115SingleZipMember,
  now = () => new NativeDate(),
}) {
  const validatedProtocol = validateProtocolAcquisitionBoundary(protocol, acquisitionState);
  await validateExplicitUnusedOutputDirectory(outputDirectory);
  if (typeof fetchImpl !== "function") fail("Kenneth French acquisition fetch implementation is required");
  if (typeof now !== "function") fail("Kenneth French acquisition clock must be a function");

  let response;
  try {
    response = await fetchImpl(EXTERNAL_ATTEMPT115_SOURCE_URL, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        accept: "application/zip, application/x-zip-compressed, application/octet-stream",
        "accept-encoding": "identity",
      },
      signal: nativeAbortSignalTimeout(EXTERNAL_ATTEMPT115_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TypeError(`Kenneth French acquisition transport failed: ${error?.message ?? "unknown error"}`);
  }
  let responseHeaders;
  let declaredLength;
  try {
    responseHeaders = normalizeResponseHeaders(response.headers);
    declaredLength = validateTransportMetadata(response, responseHeaders);
  } catch (error) {
    try {
      await response?.body?.cancel?.("response metadata rejected before body read");
    } catch {
      // Preserve the original metadata failure while still making a best-effort cancellation.
    }
    throw error;
  }
  const archiveBytes = await readBoundedResponseBody(response, declaredLength);
  const selectedMember = await extractExternalAttempt115ArchiveMemberRecord(
    archiveBytes,
    zipExtractor,
  );
  const memberBytes = selectedMember.bytes;

  const canonicalText = canonicalizeKennethFrenchDailyFactorZipMember(memberBytes);
  const canonicalBytes = new TextEncoder().encode(canonicalText);
  const parsed = parseKennethFrenchDailyFactorCsv(canonicalBytes);
  const acquiredAt = canonicalInstant(now(), "Kenneth French acquisition clock");
  if (acquiredAt <= validatedProtocol.frozen_at) {
    fail("Kenneth French acquisition must occur after the protocol freeze");
  }
  const headersPayload = {
    schema_version: "finly_fetch_normalized_response_headers.v1",
    note: "Fetch exposes normalized response headers rather than raw HTTP header bytes.",
    headers: responseHeaders,
  };
  const headersBytes = new TextEncoder().encode(canonicalJson(headersPayload));
  const receiptBody = acquisitionReceiptBody({
    protocol: validatedProtocol,
    acquiredAt,
    archiveBytes,
    responseHeadersBytes: headersBytes,
    memberName: selectedMember.name,
    memberBytes,
    canonicalBytes,
    parsed,
  });
  const receipt = validateExternalAttempt115AcquisitionReceipt({
    ...receiptBody,
    acquisition_receipt_sha256: sha256(receiptBody),
  }, validatedProtocol);
  const receiptBytes = new TextEncoder().encode(canonicalJson(receipt));
  const paths = await persistAcquisitionWriteOnce({
    outputDirectory,
    archiveBytes,
    headersBytes,
    memberBytes,
    canonicalBytes,
    receiptBytes,
  });

  return deepFreeze({
    receipt,
    paths,
    receipt_bytes_sha256: rawSha256(receiptBytes),
  });
}
