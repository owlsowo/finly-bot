import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA,
  EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
  EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES,
  EXTERNAL_ATTEMPT115_MAX_MEMBER_BYTES,
  acquireExternalAttempt115KennethFrenchSource,
  canonicalExternalAttempt115AcquisitionReceiptJson,
  hashExternalAttempt115AcquisitionReceipt,
  validateExternalAttempt115AcquisitionReceipt,
} from "../research/external_validation_attempt115/acquisition.mjs";
import {
  EXTERNAL_ATTEMPT115_ARTIFACT_PATHS,
  EXTERNAL_ATTEMPT115_SOURCE_URL,
  createExternalAttempt115ProtocolBody,
  sealExternalAttempt115Protocol,
} from "../research/external_validation_attempt115/protocol.mjs";

const ACQUIRED_AT = "2026-08-30T10:00:00.000Z";
const ARCHIVE_BYTES = Uint8Array.from([
  0x50, 0x4b, 0x03, 0x04, 0x46, 0x49, 0x4e, 0x4c, 0x59,
]);

function digest(byte) {
  return `sha256:${byte.repeat(64)}`;
}

function frozenProtocol() {
  return sealExternalAttempt115Protocol(createExternalAttempt115ProtocolBody({
    frozenAt: "2026-08-30T09:00:00.000Z",
    sourceFilesSha256: Object.fromEntries(
      EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.source_files.map((path) => [path, digest("1")]),
    ),
    testFilesSha256: Object.fromEntries(
      EXTERNAL_ATTEMPT115_ARTIFACT_PATHS.test_files.map((path) => [path, digest("2")]),
    ),
  }));
}

function compactDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function inventedRawMember() {
  const laterStart = new Date("2006-09-20T00:00:00.000Z");
  const rows = ["19260701,0.10,0.01,-0.02,0.03"];
  for (let index = 0; index < 254; index += 1) {
    const date = new Date(laterStart);
    date.setUTCDate(date.getUTCDate() + index);
    rows.push(`${compactDate(date)},0.10,0.01,-0.02,0.03`);
  }
  return new TextEncoder().encode([
    "Invented Kenneth French-shaped fixture; no provider values.",
    " , Mkt-RF, SMB, HML, RF",
    ...rows,
  ].join("\n"));
}

function response({
  bytes = ARCHIVE_BYTES,
  status = 200,
  ok = status === 200,
  redirected = false,
  url = EXTERNAL_ATTEMPT115_SOURCE_URL,
  contentType = "application/zip",
  contentLength = bytes.byteLength,
  contentEncoding,
  chunks = [bytes],
  headers: additionalHeaders = {},
} = {}) {
  const headers = new Headers({
    "content-type": contentType,
    ...(contentLength === null ? {} : { "content-length": String(contentLength) }),
    ...(contentEncoding === undefined ? {} : { "content-encoding": contentEncoding }),
    etag: '"invented-etag"',
    ...additionalHeaders,
  });
  return {
    status,
    ok,
    redirected,
    url,
    headers,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}

function exactExtractor(memberBytes = inventedRawMember()) {
  return async () => [{
    name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
    bytes: memberBytes,
    uncompressedSize: memberBytes.byteLength,
  }];
}

async function temporaryRoot(context, prefix = "finly-attempt115-acquisition-") {
  const alias = await mkdtemp(join(tmpdir(), prefix));
  const root = await realpath(alias);
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function acquisitionArgs(outputDirectory, overrides = {}) {
  return {
    protocol: frozenProtocol(),
    acquisitionState: { source_data_acquired: false },
    outputDirectory,
    fetchImpl: async () => response(),
    zipExtractor: exactExtractor(),
    now: () => new Date(ACQUIRED_AT),
    ...overrides,
  };
}

function rawHash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

test("fixed acquisition preserves invented raw artifacts and emits a canonical metadata-only receipt", async (context) => {
  const root = await temporaryRoot(context);
  const outputDirectory = join(root, "frozen-source");
  const memberBytes = inventedRawMember();
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return response({
      chunks: [ARCHIVE_BYTES.slice(0, 4), ARCHIVE_BYTES.slice(4)],
      headers: { "last-modified": "Sat, 30 Aug 2026 09:30:00 GMT" },
    });
  };

  const result = await acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(
    outputDirectory,
    { fetchImpl, zipExtractor: exactExtractor(memberBytes) },
  ));

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], EXTERNAL_ATTEMPT115_SOURCE_URL);
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].redirect, "error");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].credentials, "omit");
  assert.equal(calls[0][1].referrerPolicy, "no-referrer");
  assert.equal(calls[0][1].headers["accept-encoding"], "identity");
  assert.ok(calls[0][1].signal instanceof AbortSignal);

  assert.deepEqual(await readFile(result.paths.archive), Buffer.from(ARCHIVE_BYTES));
  assert.deepEqual(await readFile(result.paths.member), Buffer.from(memberBytes));
  const canonical = await readFile(result.paths.canonical, "utf8");
  assert.match(canonical, /^date,Mkt-RF,SMB,HML,RF\n19260701,/u);
  assert.equal(canonical.trim().split("\n").length, 256);
  const preservedHeaders = JSON.parse(await readFile(result.paths.headers, "utf8"));
  assert.equal(preservedHeaders.schema_version, "finly_fetch_normalized_response_headers.v1");
  assert.deepEqual(
    preservedHeaders.headers.map(({ name }) => name),
    ["content-length", "content-type", "etag", "last-modified"],
  );

  const receiptText = await readFile(result.paths.receipt, "utf8");
  const receipt = JSON.parse(receiptText);
  assert.equal(receipt.schema_version, EXTERNAL_ATTEMPT115_ACQUISITION_RECEIPT_SCHEMA);
  assert.equal(receipt.source_data_acquired, true);
  assert.equal(receipt.archive_raw_bytes_sha256, rawHash(ARCHIVE_BYTES));
  assert.equal(receipt.selected_member_raw_bytes_sha256, rawHash(memberBytes));
  assert.equal(receipt.parsed_first_date, "1926-07-01");
  assert.equal(receipt.parsed_last_date, "2007-05-31");
  assert.equal(receipt.parsed_valid_row_count, 255);
  assert.equal(receipt.acquisition_receipt_sha256, hashExternalAttempt115AcquisitionReceipt(receipt));
  assert.equal(receiptText, canonicalExternalAttempt115AcquisitionReceiptJson(receipt));
  assert.deepEqual(
    validateExternalAttempt115AcquisitionReceipt(receipt, frozenProtocol()),
    receipt,
  );
  assert.doesNotMatch(receiptText, /Mkt-RF|MARKET_PROXY|RF_PROXY|source_returns|rows/u);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.receipt), true);
  assert.equal((await stat(outputDirectory)).mode & 0o777, 0o700);
  for (const path of Object.values(result.paths)) {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
});

test("acquisition refuses any non-frozen or previously acquired state before transport", async (context) => {
  const root = await temporaryRoot(context);
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return response();
  };

  for (const state of [undefined, {}, { source_data_acquired: true }, {
    source_data_acquired: false,
    extra: false,
  }]) {
    await assert.rejects(
      acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(
        join(root, `state-${fetchCount}-${String(state?.source_data_acquired)}`),
        { acquisitionState: state, fetchImpl },
      )),
      /source_data_acquired false/u,
    );
  }
  const mutated = structuredClone(frozenProtocol());
  mutated.status = "NOT_FROZEN";
  await assert.rejects(
    acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(
      join(root, "bad-protocol"),
      { protocol: mutated, fetchImpl },
    )),
    /protocol envelope|protocol/u,
  );
  assert.equal(fetchCount, 0);
});

test("request and response identity fail closed on status, redirects, URL, encoding, or media type", async (context) => {
  const root = await temporaryRoot(context);
  const cases = [
    ["status", response({ status: 206, ok: true }), /HTTP 200/u],
    ["ok", response({ ok: false }), /HTTP 200/u],
    ["redirect", response({ redirected: true }), /redirect/u],
    ["url", response({ url: `${EXTERNAL_ATTEMPT115_SOURCE_URL}?changed=1` }), /URL changed/u],
    ["type", response({ contentType: "text/html" }), /ZIP content type/u],
    ["encoding", response({ contentEncoding: "gzip" }), /identity-encoded/u],
  ];
  for (const [label, badResponse, expected] of cases) {
    const outputDirectory = join(root, label);
    await assert.rejects(
      acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(outputDirectory, {
        fetchImpl: async (url, options) => {
          assert.equal(url, EXTERNAL_ATTEMPT115_SOURCE_URL);
          assert.equal(options.method, "GET");
          assert.equal(options.redirect, "error");
          return badResponse;
        },
      })),
      expected,
    );
    await assert.rejects(lstat(outputDirectory), { code: "ENOENT" });
  }
});

test("response metadata rejection cancels an unread body before returning", async (context) => {
  const root = await temporaryRoot(context);
  let cancelled = false;
  const badResponse = response({ contentType: "text/html" });
  badResponse.body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(
      join(root, "metadata-rejected"),
      { fetchImpl: async () => badResponse },
    )),
    /ZIP content type/u,
  );
  assert.equal(cancelled, true);
});

test("archive streaming enforces declared and absolute byte limits before extraction", async (context) => {
  const root = await temporaryRoot(context);
  const cases = [
    [
      "declared-too-large",
      response({ contentLength: EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES + 1 }),
      /fixed byte limit/u,
    ],
    [
      "declared-too-small",
      response({ contentLength: 4 }),
      /exceeds its declared/u,
    ],
    [
      "declared-too-large-for-body",
      response({ contentLength: ARCHIVE_BYTES.byteLength + 1 }),
      /does not match/u,
    ],
    [
      "bad-length",
      response({ contentLength: null, headers: { "content-length": "1e3" } }),
      /content-length is invalid/u,
    ],
    [
      "not-zip",
      response({ bytes: Uint8Array.from([1, 2, 3, 4]) }),
      /not a ZIP archive/u,
    ],
  ];
  for (const [label, badResponse, expected] of cases) {
    let extracted = false;
    await assert.rejects(
      acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(join(root, label), {
        fetchImpl: async () => badResponse,
        zipExtractor: async () => {
          extracted = true;
          return [];
        },
      })),
      expected,
    );
    assert.equal(extracted, false);
  }

  const overLimit = new Uint8Array(EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES + 1);
  overLimit.set([0x50, 0x4b, 0x03, 0x04]);
  await assert.rejects(
    acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(join(root, "stream-limit"), {
      fetchImpl: async () => response({
        bytes: overLimit,
        contentLength: null,
      }),
    })),
    /fixed byte limit/u,
  );
});

test("ZIP boundary accepts only one exact regular member and detects extractor mutation", async (context) => {
  const root = await temporaryRoot(context);
  const member = inventedRawMember();
  const cases = [
    ["none", async () => [], /exactly one member/u],
    [
      "extra",
      async () => [
        { name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER, bytes: member },
        { name: "README.txt", bytes: new Uint8Array([1]) },
      ],
      /exactly one member/u,
    ],
    ["traversal", async () => [{ name: "../factor.csv", bytes: member }], /traversal-like/u],
    ["nested", async () => [{ name: `nested/${EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER}`, bytes: member }], /traversal-like/u],
    ["wrong-case", async () => [{ name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER.toLowerCase(), bytes: member }], /exact frozen member/u],
    ["directory", async () => [{ name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER, bytes: member, directory: true }], /regular file/u],
    ["size-mismatch", async () => [{ name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER, bytes: member, uncompressedSize: member.byteLength + 1 }], /disagrees/u],
    [
      "mutated-archive",
      async (archive) => {
        archive[4] ^= 0xff;
        return [{ name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER, bytes: member }];
      },
      /mutated/u,
    ],
  ];
  for (const [label, zipExtractor, expected] of cases) {
    await assert.rejects(
      acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(join(root, label), {
        zipExtractor,
      })),
      expected,
    );
  }

  const oversizedMember = new Uint8Array(EXTERNAL_ATTEMPT115_MAX_MEMBER_BYTES + 1);
  await assert.rejects(
    acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(join(root, "oversized-member"), {
      zipExtractor: async () => [{
        name: EXTERNAL_ATTEMPT115_EXPECTED_ARCHIVE_MEMBER,
        bytes: oversizedMember,
      }],
    })),
    /member violates the fixed byte limit/u,
  );
});

test("strict canonicalization and source coverage must pass before any output is created", async (context) => {
  const root = await temporaryRoot(context);
  const malformed = new TextEncoder().encode([
    "Invented malformed fixture.",
    " , Mkt-RF, SMB, HML, RF",
    "19260701,0.10,not-a-number,-0.02,0.03",
  ].join("\n"));
  await assert.rejects(
    acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(join(root, "malformed"), {
      zipExtractor: exactExtractor(malformed),
    })),
    /malformed numeric data row/u,
  );
  await assert.rejects(lstat(join(root, "malformed")), { code: "ENOENT" });

  const insufficient = new TextEncoder().encode([
    "Invented insufficient fixture.",
    " , Mkt-RF, SMB, HML, RF",
    "19260701,0.10,0.01,-0.02,0.03",
    "20070530,0.10,0.01,-0.02,0.03",
  ].join("\n"));
  await assert.rejects(
    acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(join(root, "insufficient"), {
      zipExtractor: exactExtractor(insufficient),
    })),
    /at least 255 valid rows/u,
  );
});

test("explicit output is write-once and rejects existing or symlinked destinations before transport", async (context) => {
  const root = await temporaryRoot(context);
  const outputDirectory = join(root, "one-shot");
  await acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(outputDirectory));
  let fetchCount = 0;
  await assert.rejects(
    acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(outputDirectory, {
      fetchImpl: async () => {
        fetchCount += 1;
        return response();
      },
    })),
    /already exists/u,
  );
  assert.equal(fetchCount, 0);

  const outside = await temporaryRoot(context, "finly-attempt115-outside-");
  const linkedParent = join(root, "linked-parent");
  await symlink(outside, linkedParent, "dir");
  await assert.rejects(
    acquireExternalAttempt115KennethFrenchSource(acquisitionArgs(join(linkedParent, "source"), {
      fetchImpl: async () => {
        fetchCount += 1;
        return response();
      },
    })),
    /symlink/u,
  );
  assert.equal(fetchCount, 0);
});

test("receipt verifier rejects added raw-value fields even under a recomputed self-hash", async (context) => {
  const root = await temporaryRoot(context);
  const result = await acquireExternalAttempt115KennethFrenchSource(
    acquisitionArgs(join(root, "receipt")),
  );
  const injected = structuredClone(result.receipt);
  injected.raw_factor_rows = [{ date: "1926-07-01", value: 1 }];
  injected.acquisition_receipt_sha256 = hashExternalAttempt115AcquisitionReceipt(injected);
  assert.throws(
    () => validateExternalAttempt115AcquisitionReceipt(injected, frozenProtocol()),
    /receipt fields changed/u,
  );
});
