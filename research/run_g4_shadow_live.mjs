import { randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  link, lstat, mkdir, open, readFile, readdir, realpath, rmdir, unlink,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORWARD_TRIAL_LIVE_ACTIVATION_PATH,
  loadPrivateCommitmentChain,
} from "./run_forward_trial_live.mjs";
import { validateForwardTrialLiveActivation } from "./forward_trial_live_core.mjs";
import {
  buildG4ShadowLivePrivateRecord,
  canonicalG4ShadowLiveRecordJson,
  g4ShadowLivePrivateFilename,
  g4ShadowLivePublicationReceiptFilename,
  g4ShadowLivePublicFilename,
  validateG4ShadowLivePrivateRecord,
  validateG4ShadowLivePublicationReceipt,
  validateG4ShadowLivePublicRecord,
  validateG4ShadowLiveRecordChains,
} from "./g4_shadow_live_core.mjs";
import { loadG4ShadowLiveProtocol } from "./g4_shadow_live_protocol.mjs";

export const G4_SHADOW_LIVE_PRIVATE_RECORD_DIRECTORY = "data/private/g4_shadow_live/records";
export const G4_SHADOW_LIVE_PUBLIC_RECORD_DIRECTORY = "research/g4_shadow_live/records";
export const G4_SHADOW_LIVE_PUBLICATION_RECEIPT_DIRECTORY =
  "research/g4_shadow_live/publication_receipts";
export const G4_SHADOW_LIVE_APPEND_LOCK_PATH = "data/private/g4_shadow_live/.append.lock";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAX_RECORDS = 10_000;
const RECORD_FILENAME = /^\d{8}_[0-9a-f]{64}\.json$/u;

function fail(message) {
  throw new Error(message);
}

function canonicalInstant(value, label) {
  const parsed = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(parsed.getTime())
    || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

async function assertNoSymlinkBelowRoot(targetPath, projectRoot, label) {
  const root = resolve(projectRoot);
  const target = resolve(targetPath);
  const suffix = relative(root, target);
  if (suffix === ".." || suffix.startsWith(`..${sep}`) || suffix.startsWith(sep)) {
    fail(`${label} escapes the project root`);
  }
  let cursor = root;
  for (const component of suffix.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) fail(`${label} must not traverse a symbolic link`);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
}

async function ensureDirectory(path, projectRoot, label, mode) {
  await assertNoSymlinkBelowRoot(path, projectRoot, label);
  await mkdir(path, { recursive: true, mode });
  await assertNoSymlinkBelowRoot(path, projectRoot, label);
  const root = await realpath(projectRoot);
  const actual = await realpath(path);
  const suffix = relative(root, actual);
  if (suffix === ".." || suffix.startsWith(`..${sep}`) || suffix.startsWith(sep)) {
    fail(`${label} resolves outside the project root`);
  }
}

async function readCanonicalJson(path, projectRoot, label) {
  await assertNoSymlinkBelowRoot(path, projectRoot, label);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${label} must be a regular file`);
  let handle;
  try {
    handle = await open(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const bytes = await handle.readFile("utf8");
    let value;
    try {
      value = JSON.parse(bytes);
    } catch {
      fail(`${label} is not valid JSON`);
    }
    if (bytes !== canonicalG4ShadowLiveRecordJson(value)) fail(`${label} is not canonical JSON`);
    return value;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function existingRecordFiles(directory, projectRoot, label, mode = 0o755) {
  await ensureDirectory(directory, projectRoot, label, mode);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > MAX_RECORDS) fail(`${label} exceeds the bounded record count`);
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !RECORD_FILENAME.test(entry.name)) {
      fail(`${label} contains an unexpected entry`);
    }
  }
  return entries.map(({ name }) => resolve(directory, name)).sort();
}

async function publishCanonicalWriteOnce(path, value, {
  projectRoot,
  label,
  mode,
}) {
  const parent = dirname(path);
  await ensureDirectory(parent, projectRoot, `${label} parent`, mode === 0o600 ? 0o700 : 0o755);
  const bytes = canonicalG4ShadowLiveRecordJson(value);
  try {
    const prior = await readCanonicalJson(path, projectRoot, label);
    if (canonicalG4ShadowLiveRecordJson(prior) !== bytes) {
      fail(`${label} already exists with different bytes`);
    }
    return "verified";
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const stagePath = resolve(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    await assertNoSymlinkBelowRoot(stagePath, projectRoot, `${label} staging path`);
    handle = await open(stagePath, "wx", mode);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(stagePath, path);
    const directoryHandle = await open(parent, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (error?.code === "EEXIST") {
      const prior = await readFile(path, "utf8").catch(() => null);
      if (prior === bytes) return "verified";
      fail(`${label} was concurrently created with different bytes`);
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
    await unlink(stagePath).catch(() => {});
  }
  if (await readFile(path, "utf8") !== bytes) fail(`${label} durable write differs from canonical bytes`);
  return "created";
}

async function loadActivation(projectRoot) {
  const path = resolve(projectRoot, FORWARD_TRIAL_LIVE_ACTIVATION_PATH);
  const bytes = await readFile(path, "utf8");
  let activation;
  try {
    activation = JSON.parse(bytes);
  } catch {
    fail("forward-live activation is not valid JSON");
  }
  if (bytes !== canonicalG4ShadowLiveRecordJson(activation)) {
    fail("forward-live activation is not canonical JSON");
  }
  return validateForwardTrialLiveActivation(activation);
}

export async function loadG4ShadowLivePrivateRecords({
  projectRoot = PROJECT_ROOT,
  protocol: suppliedProtocol = null,
} = {}) {
  const protocol = suppliedProtocol ?? await loadG4ShadowLiveProtocol({ projectRoot });
  const directory = resolve(projectRoot, G4_SHADOW_LIVE_PRIVATE_RECORD_DIRECTORY);
  const files = await existingRecordFiles(directory, projectRoot, "G4 shadow private record directory", 0o700);
  const records = [];
  for (const [index, path] of files.entries()) {
    const record = await readCanonicalJson(path, projectRoot, `G4 shadow private record ${index + 1}`);
    validateG4ShadowLivePrivateRecord(record, {
      protocol,
      previousRecord: records.at(-1) ?? null,
    });
    if (path !== resolve(directory, g4ShadowLivePrivateFilename(record))) {
      fail("G4 shadow private record filename is not content addressed");
    }
    records.push(record);
  }
  return records;
}

export async function loadG4ShadowLivePublicRecords({
  projectRoot = PROJECT_ROOT,
  protocol: suppliedProtocol = null,
} = {}) {
  const protocol = suppliedProtocol ?? await loadG4ShadowLiveProtocol({ projectRoot });
  const directory = resolve(projectRoot, G4_SHADOW_LIVE_PUBLIC_RECORD_DIRECTORY);
  const files = await existingRecordFiles(directory, projectRoot, "G4 shadow public record directory");
  const records = [];
  for (const [index, path] of files.entries()) {
    const record = await readCanonicalJson(path, projectRoot, `G4 shadow public record ${index + 1}`);
    validateG4ShadowLivePublicRecord(record, {
      protocol,
      previousRecord: records.at(-1) ?? null,
    });
    if (path !== resolve(directory, g4ShadowLivePublicFilename(record))) {
      fail("G4 shadow public record filename is not content addressed");
    }
    records.push(record);
  }
  return records;
}

export async function loadG4ShadowLivePublicationReceipts({
  projectRoot = PROJECT_ROOT,
  protocol: suppliedProtocol = null,
  publicRecords: suppliedPublicRecords = null,
} = {}) {
  const protocol = suppliedProtocol ?? await loadG4ShadowLiveProtocol({ projectRoot });
  const publicRecords = suppliedPublicRecords
    ?? await loadG4ShadowLivePublicRecords({ projectRoot, protocol });
  const directory = resolve(projectRoot, G4_SHADOW_LIVE_PUBLICATION_RECEIPT_DIRECTORY);
  const files = await existingRecordFiles(directory, projectRoot, "G4 shadow publication receipt directory");
  if (files.length > publicRecords.length) fail("G4 shadow publication receipts exceed public records");
  const receipts = [];
  for (const [index, path] of files.entries()) {
    const receipt = await readCanonicalJson(path, projectRoot, `G4 shadow publication receipt ${index + 1}`);
    validateG4ShadowLivePublicationReceipt(receipt, {
      protocol,
      publicRecord: publicRecords[index],
      previousPublicRecord: publicRecords[index - 1] ?? null,
      previousReceipt: receipts.at(-1) ?? null,
    });
    if (path !== resolve(directory, g4ShadowLivePublicationReceiptFilename(receipt))) {
      fail("G4 shadow publication receipt filename is not content addressed");
    }
    receipts.push(receipt);
  }
  return receipts;
}

async function loadLocalState(projectRoot, protocol) {
  const privateRecords = await loadG4ShadowLivePrivateRecords({ projectRoot, protocol });
  const publicRecords = await loadG4ShadowLivePublicRecords({ projectRoot, protocol });
  const chains = validateG4ShadowLiveRecordChains({ protocol, privateRecords, publicRecords });
  const publicationReceipts = await loadG4ShadowLivePublicationReceipts({
    projectRoot,
    protocol,
    publicRecords,
  });
  return { ...chains, publicationReceipts };
}

export async function publishG4ShadowLivePublicationReceiptWriteOnce(receipt, {
  projectRoot = PROJECT_ROOT,
} = {}) {
  const protocol = await loadG4ShadowLiveProtocol({ projectRoot });
  const publicRecords = await loadG4ShadowLivePublicRecords({ projectRoot, protocol });
  const priorReceipts = await loadG4ShadowLivePublicationReceipts({
    projectRoot,
    protocol,
    publicRecords,
  });
  const index = receipt.sequence - 1;
  validateG4ShadowLivePublicationReceipt(receipt, {
    protocol,
    publicRecord: publicRecords[index],
    previousPublicRecord: publicRecords[index - 1] ?? null,
    previousReceipt: priorReceipts[index - 1] ?? null,
  });
  if (index > priorReceipts.length) fail("G4 shadow publication receipt skips the chain head");
  const path = resolve(
    projectRoot,
    G4_SHADOW_LIVE_PUBLICATION_RECEIPT_DIRECTORY,
    g4ShadowLivePublicationReceiptFilename(receipt),
  );
  const status = await publishCanonicalWriteOnce(path, receipt, {
    projectRoot,
    label: "G4 shadow publication receipt",
    mode: 0o644,
  });
  return { status, path: relative(projectRoot, path), receipt_sha256: receipt.receipt_sha256 };
}

async function withAppendLock(projectRoot, callback) {
  const lockPath = resolve(projectRoot, G4_SHADOW_LIVE_APPEND_LOCK_PATH);
  await ensureDirectory(dirname(lockPath), projectRoot, "G4 shadow append-lock parent", 0o700);
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("G4 shadow append lock already exists; inspect it manually");
    throw error;
  }
  const ownerPath = resolve(lockPath, "owner.json");
  try {
    await publishCanonicalWriteOnce(ownerPath, {
      schema_version: "finly_g4_shadow_live_append_lock.v1",
      pid: process.pid,
    }, { projectRoot, label: "G4 shadow append-lock owner", mode: 0o600 });
    return await callback();
  } finally {
    await unlink(ownerPath).catch(() => {});
    await rmdir(lockPath).catch(() => {});
  }
}

function enforceProspectivePublication(record, now) {
  const observedAt = canonicalInstant(now, "G4 shadow append time");
  if (observedAt < record.captured_at) fail("G4 shadow append time predates the validated acquisition");
  if (observedAt >= record.acquisition.session.next_market_close_at) {
    fail("G4 shadow target publication missed the next-close deadline; backfill is forbidden");
  }
}

async function publishRecordPairUnderLock({
  projectRoot,
  protocol,
  record,
  previousRecord,
}) {
  const state = await loadLocalState(projectRoot, protocol);
  const existing = state.privateRecords[record.sequence - 1] ?? null;
  if (existing !== null) {
    if (existing.private_record_sha256 !== record.private_record_sha256
      || record.sequence !== state.privateRecords.length) {
      fail("G4 shadow candidate reuses an existing sequence with different content");
    }
  } else if (record.sequence !== state.privateRecords.length + 1
    || state.privateRecords.length !== state.publicRecords.length) {
    fail("G4 shadow candidate does not extend the authoritative disk head");
  }
  const authoritativePrevious = state.privateRecords[record.sequence - 2] ?? null;
  if ((previousRecord?.private_record_sha256 ?? null)
    !== (authoritativePrevious?.private_record_sha256 ?? null)) {
    fail("G4 shadow candidate predecessor differs from the authoritative disk head");
  }
  validateG4ShadowLivePrivateRecord(record, { protocol, previousRecord: authoritativePrevious });
  validateG4ShadowLivePublicRecord(record.public_record, {
    protocol,
    previousRecord: authoritativePrevious?.public_record ?? null,
    privateRecord: record,
  });
  const privatePath = resolve(
    projectRoot,
    G4_SHADOW_LIVE_PRIVATE_RECORD_DIRECTORY,
    g4ShadowLivePrivateFilename(record),
  );
  const publicPath = resolve(
    projectRoot,
    G4_SHADOW_LIVE_PUBLIC_RECORD_DIRECTORY,
    g4ShadowLivePublicFilename(record.public_record),
  );
  const privateStatus = await publishCanonicalWriteOnce(privatePath, record, {
    projectRoot,
    label: "G4 shadow private record",
    mode: 0o600,
  });
  const publicStatus = await publishCanonicalWriteOnce(publicPath, record.public_record, {
    projectRoot,
    label: "G4 shadow public record",
    mode: 0o644,
  });
  const verified = await loadLocalState(projectRoot, protocol);
  if (verified.privateRecords.length !== verified.publicRecords.length
    || verified.privateRecords.at(-1)?.private_record_sha256 !== record.private_record_sha256
    || verified.publicRecords.at(-1)?.record_sha256 !== record.public_record.record_sha256) {
    fail("G4 shadow post-write chain verification did not reach the candidate head");
  }
  return {
    private_status: privateStatus,
    public_status: publicStatus,
    private_path: relative(projectRoot, privatePath),
    public_path: relative(projectRoot, publicPath),
  };
}

export async function publishG4ShadowLiveRecordWriteOnce(options) {
  const projectRoot = options?.projectRoot ?? PROJECT_ROOT;
  if (resolve(projectRoot) === resolve(PROJECT_ROOT)) {
    enforceProspectivePublication(options.record, new Date().toISOString());
  }
  return withAppendLock(projectRoot, () => publishRecordPairUnderLock({
    ...options,
    projectRoot,
  }));
}

export async function verifyExistingG4ShadowLive({ projectRoot = PROJECT_ROOT } = {}) {
  const protocol = await loadG4ShadowLiveProtocol({ projectRoot });
  const { privateRecords, publicRecords, publicationReceipts } = await loadLocalState(projectRoot, protocol);
  let upstreamCommitments = null;
  try {
    const activation = await loadActivation(projectRoot);
    upstreamCommitments = await loadPrivateCommitmentChain({ projectRoot, activation });
  } catch (error) {
    if (privateRecords.length > 0) throw error;
  }
  if (upstreamCommitments !== null) {
    if (upstreamCommitments.length < privateRecords.length) {
      fail("G4 shadow chain extends beyond the validated forward-live chain");
    }
    privateRecords.forEach((record, index) => {
      const commitment = upstreamCommitments[index];
      if (record.upstream.source !== "FORWARD_TRIAL_LIVE_COMMITMENT"
        || record.upstream.commitment_sha256 !== commitment.commitment_sha256
        || record.acquisition.acquisition_sha256 !== commitment.payload.acquisition.acquisition_sha256) {
        fail("G4 shadow private chain is not bound to the validated forward-live chain");
      }
    });
  }
  return {
    status: publicRecords.length === 0
      ? "FROZEN_AWAITING_FIRST_SIGNAL"
      : privateRecords.length === 0
        ? "PUBLIC_CHAIN_VERIFIED_PRIVATE_STATE_UNAVAILABLE"
        : "PRIVATE_AND_PUBLIC_CHAINS_VERIFIED",
    protocol_sha256: protocol.protocol_sha256,
    private_records: privateRecords.length,
    public_records: publicRecords.length,
    timely_github_publication_receipts: publicationReceipts.length,
    upstream_forward_commitments_available: upstreamCommitments?.length ?? null,
    latest_signal_session_date: publicRecords.at(-1)?.signal_session_date ?? null,
    latest_public_record_sha256: publicRecords.at(-1)?.record_sha256 ?? null,
    latest_publication_receipt_sha256: publicationReceipts.at(-1)?.receipt_sha256 ?? null,
    prospectivity_publication_verified:
      publicRecords.length > 0 && publicationReceipts.length === publicRecords.length,
    broker_mutation_authorized: false,
    order_submission_permitted: false,
  };
}

export async function appendG4ShadowFromForwardLive(options = {}) {
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  if (resolve(projectRoot) === resolve(PROJECT_ROOT) && Object.hasOwn(options, "now")) {
    fail("the production G4 shadow append clock cannot be caller supplied");
  }
  const now = options.now ?? new Date().toISOString();
  const suppliedAcquisition = options.suppliedAcquisition ?? null;
  return withAppendLock(projectRoot, async () => {
    const protocol = await loadG4ShadowLiveProtocol({ projectRoot });
    const state = await loadLocalState(projectRoot, protocol);
    if (state.privateRecords.length === state.publicRecords.length + 1) {
      const record = state.privateRecords.at(-1);
      enforceProspectivePublication(record, now);
      const persistence = await publishRecordPairUnderLock({
        projectRoot,
        protocol,
        record,
        previousRecord: state.privateRecords.at(-2) ?? null,
      });
      return {
        status: "RECOVERED_PUBLIC_RECORD_WRITE_ONCE",
        sequence: record.sequence,
        signal_session_date: record.signal.signal_session_date,
        execution_status: record.execution.status,
        broker_mutation_authorized: false,
        persistence,
      };
    }

    const previousRecord = state.privateRecords.at(-1) ?? null;
    if (previousRecord !== null
      && state.publicationReceipts.length !== state.publicRecords.length) {
      fail("the prior G4 shadow record lacks a timely verified GitHub publication receipt");
    }
    let record;
    if (suppliedAcquisition !== null) {
      if (resolve(projectRoot) === resolve(PROJECT_ROOT)) {
        fail("the production runner only consumes validated forward-live commitments");
      }
      record = buildG4ShadowLivePrivateRecord({
        protocol,
        acquisition: suppliedAcquisition,
        previousRecord,
      });
    } else {
      const activation = await loadActivation(projectRoot);
      const commitments = await loadPrivateCommitmentChain({ projectRoot, activation });
      if (commitments.length <= state.privateRecords.length) {
        fail("no new validated forward-live commitment is available");
      }
      if (commitments.length > state.privateRecords.length + 1) {
        fail("multiple unconsumed forward-live sessions exist; backfill is forbidden");
      }
      const commitment = commitments[state.privateRecords.length];
      record = buildG4ShadowLivePrivateRecord({
        protocol,
        forwardCommitment: commitment,
        previousRecord,
      });
    }
    enforceProspectivePublication(record, now);
    const persistence = await publishRecordPairUnderLock({
      projectRoot,
      protocol,
      record,
      previousRecord,
    });
    return {
      status: "G4_SHADOW_RECORD_WRITTEN_ONCE",
      sequence: record.sequence,
      signal_session_date: record.signal.signal_session_date,
      execution_status: record.execution.status,
      shadow_equity: record.state_after.finly.equity,
      spy_shadow_equity: record.state_after.spy.equity,
      public_record_sha256: record.public_record.record_sha256,
      broker_mutation_authorized: false,
      persistence,
    };
  });
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === "--verify-existing") {
    return verifyExistingG4ShadowLive();
  }
  if (argv.length === 1 && argv[0] === "--append-from-forward-live") {
    return appendG4ShadowFromForwardLive();
  }
  fail("usage: node research/run_g4_shadow_live.mjs [--verify-existing | --append-from-forward-live]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
