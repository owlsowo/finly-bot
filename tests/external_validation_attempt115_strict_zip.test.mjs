import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";

import {
  EXTERNAL_ATTEMPT115_ZIP_SCHEMA,
  externalAttempt115Crc32,
  extractExternalAttempt115SingleZipMember,
} from "../research/external_validation_attempt115/strict_zip.mjs";
import { EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER } from "../research/external_validation_attempt115/acquisition.mjs";

function uint16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function zipFixture(memberBytes, {
  name = EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
  method = 0,
  flags = 0,
  crc = externalAttempt115Crc32(memberBytes),
  declaredUncompressedSize = memberBytes.byteLength,
  externalAttributes = 0,
  archiveComment = new Uint8Array(),
} = {}) {
  const encodedName = new TextEncoder().encode(name);
  const compressed = method === 8 ? new Uint8Array(deflateRawSync(memberBytes)) : memberBytes;
  const local = concat(
    uint32(0x04034b50),
    uint16(20),
    uint16(flags),
    uint16(method),
    uint16(0),
    uint16(0),
    uint32(crc),
    uint32(compressed.byteLength),
    uint32(declaredUncompressedSize),
    uint16(encodedName.byteLength),
    uint16(0),
    encodedName,
    compressed,
  );
  const central = concat(
    uint32(0x02014b50),
    uint16(20),
    uint16(20),
    uint16(flags),
    uint16(method),
    uint16(0),
    uint16(0),
    uint32(crc),
    uint32(compressed.byteLength),
    uint32(declaredUncompressedSize),
    uint16(encodedName.byteLength),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(externalAttributes),
    uint32(0),
    encodedName,
  );
  const eocd = concat(
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(1),
    uint16(1),
    uint32(central.byteLength),
    uint32(local.byteLength),
    uint16(archiveComment.byteLength),
    archiveComment,
  );
  return concat(local, central, eocd);
}

const OPTIONS = Object.freeze({
  expected_member_name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
  maximum_entry_count: 1,
  maximum_uncompressed_member_bytes: 1024 * 1024,
});

test("strict extractor accepts one exact stored or DEFLATE member and verifies its CRC", async () => {
  const member = new TextEncoder().encode("Invented ZIP member bytes only.\n".repeat(20));
  for (const method of [0, 8]) {
    const entries = await extractExternalAttempt115SingleZipMember(
      zipFixture(member, { method }),
      OPTIONS,
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].schema_version, EXTERNAL_ATTEMPT115_ZIP_SCHEMA);
    assert.equal(entries[0].name, EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER);
    assert.deepEqual(entries[0].bytes, member);
    assert.equal(entries[0].uncompressedSize, member.byteLength);
    assert.equal(entries[0].directory, false);
    assert.equal(Object.isFrozen(entries), true);
    assert.equal(Object.isFrozen(entries[0]), true);
  }
});

test("strict extractor rejects traversal, wrong names, directories, and unsupported flags", async () => {
  const member = new TextEncoder().encode("invented");
  const cases = [
    [zipFixture(member, { name: "../factors.csv" }), /traversal-like/u],
    [zipFixture(member, { name: "factors.csv" }), /exact frozen name/u],
    [zipFixture(member, { externalAttributes: 0x10 }), /directory/u],
    [zipFixture(member, { flags: 1 }), /encryption/u],
    [zipFixture(member, { flags: 8 }), /data descriptors/u],
    [zipFixture(member, { method: 12 }), /compression method/u],
  ];
  for (const [archive, expected] of cases) {
    await assert.rejects(
      extractExternalAttempt115SingleZipMember(archive, OPTIONS),
      expected,
    );
  }
});

test("strict extractor rejects CRC, size, layout, EOCD, and trailing-byte corruption", async () => {
  const member = new TextEncoder().encode("invented member bytes");
  const valid = zipFixture(member, { method: 8 });
  const badPayload = new Uint8Array(valid);
  badPayload[60] ^= 0xff;
  const trailing = concat(valid, Uint8Array.from([1]));
  const cases = [
    [zipFixture(member, { crc: 0 }), /CRC-32/u],
    [zipFixture(member, { declaredUncompressedSize: member.byteLength + 1 }), /size differs/u],
    [badPayload, /ZIP/u],
    [valid.slice(0, -22), /end-of-central-directory/u],
    [trailing, /end-of-central-directory/u],
  ];
  for (const [archive, expected] of cases) {
    await assert.rejects(
      extractExternalAttempt115SingleZipMember(archive, OPTIONS),
      expected,
    );
  }
});

test("strict extractor rejects a hidden prefix before the selected local member", async () => {
  const member = new TextEncoder().encode("invented member bytes");
  const valid = zipFixture(member);
  const prefixed = concat(uint32(0x04034b50), valid);
  const eocdOffset = prefixed.byteLength - 22;
  const centralOffset = new DataView(prefixed.buffer).getUint32(eocdOffset + 16, true) + 4;
  const view = new DataView(prefixed.buffer);
  view.setUint32(eocdOffset + 16, centralOffset, true);
  view.setUint32(centralOffset + 42, 4, true);
  await assert.rejects(
    extractExternalAttempt115SingleZipMember(prefixed, OPTIONS),
    /hidden prefix/u,
  );
});

test("strict extractor requires the exact fixed option envelope", async () => {
  const member = new TextEncoder().encode("invented");
  const archive = zipFixture(member);
  for (const options of [
    undefined,
    { ...OPTIONS, maximum_entry_count: 2 },
    { ...OPTIONS, maximum_uncompressed_member_bytes: 0 },
    { ...OPTIONS, extra: true },
  ]) {
    await assert.rejects(
      extractExternalAttempt115SingleZipMember(archive, options),
      /options/u,
    );
  }
});

export { zipFixture };
