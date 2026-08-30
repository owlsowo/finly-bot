import { inflateRawSync } from "node:zlib";

export const EXTERNAL_ATTEMPT115_ZIP_SCHEMA =
  "finly_attempt115_strict_single_member_zip.v2";

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const MINIMUM_EOCD_BYTES = 22;
const MAXIMUM_ZIP_COMMENT_BYTES = 65_535;
const MAXIMUM_ENTRY_METADATA_BYTES = 16_384;
const MAXIMUM_COMPRESSION_RATIO = 200;
const UTF8_FLAG = 0x0800;
const LOGICAL_MEMBER_NAME = "F-F_Research_Data_Factors_daily.CSV";

function fail(message) {
  throw new TypeError(message);
}

function bytes(value, label) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ));
  }
  fail(`${label} must be supplied as bytes`);
}

function viewAt(value) {
  return new DataView(value.buffer, value.byteOffset, value.byteLength);
}

function ensureRange(value, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset + length > value.byteLength) {
    fail(`ZIP ${label} exceeds the archive bounds`);
  }
}

function uint16(view, offset, label) {
  ensureRange(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset, 2, label);
  return view.getUint16(offset, true);
}

function uint32(view, offset, label) {
  ensureRange(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset, 4, label);
  return view.getUint32(offset, true);
}

function decodeName(value, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    fail(`ZIP ${label} is not valid UTF-8`);
  }
}

function traversalLike(name) {
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

function asciiCaseFoldedBasename(name, label) {
  if (typeof name !== "string" || traversalLike(name)) {
    fail(`ZIP ${label} must be a traversal-safe ASCII basename`);
  }
  let folded = "";
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code > 0x7f) {
      fail(`ZIP ${label} must be a traversal-safe ASCII basename`);
    }
    folded += code >= 0x41 && code <= 0x5a
      ? String.fromCharCode(code + 0x20)
      : name[index];
  }
  return folded;
}

function equalBytes(left, right) {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function externalAttempt115Crc32(value) {
  const input = bytes(value, "CRC input");
  let crc = 0xffffffff;
  for (const byte of input) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function locateEndOfCentralDirectory(archive, view) {
  const first = Math.max(
    0,
    archive.byteLength - MINIMUM_EOCD_BYTES - MAXIMUM_ZIP_COMMENT_BYTES,
  );
  for (let offset = archive.byteLength - MINIMUM_EOCD_BYTES; offset >= first; offset -= 1) {
    if (uint32(view, offset, "end-of-central-directory signature")
      !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = uint16(view, offset + 20, "ZIP comment length");
    if (offset + MINIMUM_EOCD_BYTES + commentLength === archive.byteLength) return offset;
  }
  fail("ZIP has no unique terminal end-of-central-directory record");
}

function exactOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.getPrototypeOf(options) !== Object.prototype) {
    fail("strict ZIP options must be a plain object");
  }
  const keys = Object.keys(options).sort();
  const expected = [
    "expected_member_name",
    "maximum_entry_count",
    "maximum_uncompressed_member_bytes",
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)
    || options.expected_member_name !== LOGICAL_MEMBER_NAME
    || options.maximum_entry_count !== 1
    || !Number.isSafeInteger(options.maximum_uncompressed_member_bytes)
    || options.maximum_uncompressed_member_bytes <= 0) {
    fail("strict ZIP options changed from the single-member boundary");
  }
  asciiCaseFoldedBasename(LOGICAL_MEMBER_NAME, "expected member name");
  return options;
}

function validateUnixAndDosType(versionMadeBy, externalAttributes) {
  const host = versionMadeBy >>> 8;
  const dosAttributes = externalAttributes & 0xffff;
  if ((dosAttributes & 0x10) !== 0) fail("ZIP member is a directory");
  if (host !== 3) return;
  const mode = externalAttributes >>> 16;
  const kind = mode & 0o170000;
  if (kind !== 0 && kind !== 0o100000) {
    fail("ZIP member is not a regular Unix file");
  }
}

/**
 * Extract one exact regular ZIP member in memory. ZIP64, encryption, data
 * descriptors, multi-disk archives, extra entries, paths, and trailing bytes
 * are deliberately unsupported and fail closed.
 */
export async function extractExternalAttempt115SingleZipMember(input, options) {
  const checked = exactOptions(options);
  const archive = bytes(input, "archive");
  if (archive.byteLength < 30 + 46 + MINIMUM_EOCD_BYTES) {
    fail("ZIP archive is too short for one complete member");
  }
  const view = viewAt(archive);
  const eocdOffset = locateEndOfCentralDirectory(archive, view);
  const diskNumber = uint16(view, eocdOffset + 4, "disk number");
  const centralDisk = uint16(view, eocdOffset + 6, "central-directory disk number");
  const entriesOnDisk = uint16(view, eocdOffset + 8, "entry count");
  const entryCount = uint16(view, eocdOffset + 10, "total entry count");
  const centralSize = uint32(view, eocdOffset + 12, "central-directory size");
  const centralOffset = uint32(view, eocdOffset + 16, "central-directory offset");
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== 1 || entryCount !== 1
    || checked.maximum_entry_count !== 1) {
    fail("ZIP must be a single-disk archive containing exactly one member");
  }
  if (centralSize === 0xffffffff || centralOffset === 0xffffffff
    || centralOffset + centralSize !== eocdOffset) {
    fail("ZIP64, overlapping, or nonterminal central-directory layout is unsupported");
  }
  ensureRange(archive, centralOffset, centralSize, "central directory");
  if (uint32(view, centralOffset, "central file signature") !== CENTRAL_FILE_SIGNATURE) {
    fail("ZIP central file header signature changed");
  }
  ensureRange(archive, centralOffset, 46, "central file header");

  const versionMadeBy = uint16(view, centralOffset + 4, "version made by");
  const flags = uint16(view, centralOffset + 8, "general-purpose flags");
  const method = uint16(view, centralOffset + 10, "compression method");
  const expectedCrc = uint32(view, centralOffset + 16, "CRC-32");
  const compressedSize = uint32(view, centralOffset + 20, "compressed size");
  const uncompressedSize = uint32(view, centralOffset + 24, "uncompressed size");
  const nameLength = uint16(view, centralOffset + 28, "member-name length");
  const extraLength = uint16(view, centralOffset + 30, "central extra length");
  const commentLength = uint16(view, centralOffset + 32, "member-comment length");
  const diskStart = uint16(view, centralOffset + 34, "member disk start");
  const externalAttributes = uint32(view, centralOffset + 38, "external attributes");
  const localOffset = uint32(view, centralOffset + 42, "local-header offset");
  if ((flags & ~UTF8_FLAG) !== 0) {
    fail("ZIP encryption, data descriptors, or unsupported general-purpose flags are forbidden");
  }
  if (![0, 8].includes(method)) fail("ZIP compression method must be stored or raw DEFLATE");
  if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
    || localOffset === 0xffffffff || diskStart !== 0) {
    fail("ZIP64 or multi-disk member metadata is unsupported");
  }
  if (localOffset !== 0) {
    fail("ZIP member must begin at archive byte zero with no hidden prefix");
  }
  if (nameLength === 0 || nameLength + extraLength + commentLength > MAXIMUM_ENTRY_METADATA_BYTES) {
    fail("ZIP member metadata exceeds the fixed bound");
  }
  if (uncompressedSize <= 0
    || uncompressedSize > checked.maximum_uncompressed_member_bytes) {
    fail("ZIP member violates the fixed uncompressed byte limit");
  }
  if (compressedSize <= 0 || compressedSize > archive.byteLength) {
    fail("ZIP member compressed byte count is invalid");
  }
  if (uncompressedSize / compressedSize > MAXIMUM_COMPRESSION_RATIO) {
    fail("ZIP member exceeds the fixed compression-ratio limit");
  }
  validateUnixAndDosType(versionMadeBy, externalAttributes);

  const centralVariableLength = nameLength + extraLength + commentLength;
  if (46 + centralVariableLength !== centralSize) {
    fail("ZIP central directory contains hidden or ambiguous records");
  }
  const centralNameStart = centralOffset + 46;
  ensureRange(archive, centralNameStart, centralVariableLength, "central member metadata");
  const centralNameBytes = archive.subarray(centralNameStart, centralNameStart + nameLength);
  const centralName = decodeName(
    centralNameBytes,
    "central member name",
  );
  if (asciiCaseFoldedBasename(centralName, "central member name")
    !== asciiCaseFoldedBasename(LOGICAL_MEMBER_NAME, "expected member name")) {
    fail("ZIP member name differs from the ASCII case-folded logical name");
  }

  ensureRange(archive, localOffset, 30, "local file header");
  if (uint32(view, localOffset, "local file signature") !== LOCAL_FILE_SIGNATURE) {
    fail("ZIP local file header signature changed");
  }
  const localFlags = uint16(view, localOffset + 6, "local flags");
  const localMethod = uint16(view, localOffset + 8, "local compression method");
  const localCrc = uint32(view, localOffset + 14, "local CRC-32");
  const localCompressedSize = uint32(view, localOffset + 18, "local compressed size");
  const localUncompressedSize = uint32(view, localOffset + 22, "local uncompressed size");
  const localNameLength = uint16(view, localOffset + 26, "local member-name length");
  const localExtraLength = uint16(view, localOffset + 28, "local extra length");
  if (localFlags !== flags || localMethod !== method || localCrc !== expectedCrc
    || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize
    || localNameLength !== nameLength
    || localNameLength + localExtraLength > MAXIMUM_ENTRY_METADATA_BYTES) {
    fail("ZIP local and central member metadata disagree");
  }
  const localNameStart = localOffset + 30;
  ensureRange(archive, localNameStart, localNameLength + localExtraLength, "local metadata");
  const localNameBytes = archive.subarray(localNameStart, localNameStart + localNameLength);
  if (!equalBytes(localNameBytes, centralNameBytes)) {
    fail("ZIP local and central member-name bytes disagree");
  }
  const localName = decodeName(
    localNameBytes,
    "local member name",
  );
  if (localName !== centralName) fail("ZIP local and central member names disagree");
  const compressedStart = localNameStart + localNameLength + localExtraLength;
  const compressedEnd = compressedStart + compressedSize;
  if (compressedEnd !== centralOffset) {
    fail("ZIP local data does not end exactly at the central directory");
  }
  ensureRange(archive, compressedStart, compressedSize, "compressed member data");
  const compressed = archive.subarray(compressedStart, compressedEnd);
  let member;
  try {
    member = method === 0
      ? new Uint8Array(compressed)
      : new Uint8Array(inflateRawSync(compressed, {
        maxOutputLength: checked.maximum_uncompressed_member_bytes,
      }));
  } catch (error) {
    throw new TypeError(`ZIP DEFLATE extraction failed: ${error?.message ?? "unknown error"}`);
  }
  if (member.byteLength !== uncompressedSize) {
    fail("ZIP extracted member size differs from its frozen metadata");
  }
  if (externalAttempt115Crc32(member) !== expectedCrc) {
    fail("ZIP extracted member failed its CRC-32 check");
  }
  return Object.freeze([Object.freeze({
    schema_version: EXTERNAL_ATTEMPT115_ZIP_SCHEMA,
    name: centralName,
    bytes: member,
    compressedSize,
    uncompressedSize,
    directory: false,
  })]);
}
