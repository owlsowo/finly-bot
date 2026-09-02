import {
  createCipheriv,
  createHash,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { stableStringify } from "../lib/canonical.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const STATE_BRANCH = "finly-cloud-state";
const STATE_FILE = "private-state.enc.json";
const SNAPSHOT_FILE = "competition_live.json";
// Decision records include the evidence used by each cycle. A full market
// session can legitimately exceed the original 64 MiB raw-file ceiling even
// though the encrypted gzip envelope remains small. Bound the raw payload for
// memory safety and independently cap the Git-published envelope below
// GitHub's 100 MiB blob limit.
const MAX_FILE_BYTES = 192 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 90 * 1024 * 1024;
const MAX_FILES = 1_024;
const STATE_ROOTS = Object.freeze([
  "data/ledger",
  "data/private/g4-official-equity",
  "data/private/paper-lifecycle",
  "data/private/paper-sessions",
]);
const STATE_FILES = Object.freeze([
  "outputs/autonomous_decisions.jsonl",
  "outputs/g4_official_equity.jsonl",
]);

function assertStateSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new Error("cloud state secret must contain at least 32 bytes");
  }
}

function bytesSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function portablePath(value) {
  return value.split(sep).join("/");
}

function allowedStatePath(value) {
  if (typeof value !== "string" || value.length < 1 || value.startsWith("/") || value.includes("\\")) return false;
  const parts = value.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) return false;
  return STATE_FILES.includes(value) || STATE_ROOTS.some((root) => value.startsWith(`${root}/`));
}

function absoluteInside(root, path) {
  if (!allowedStatePath(path)) throw new Error("encrypted cloud state contains a path outside the allowlist");
  const absolute = resolve(root, path);
  const boundary = `${resolve(root)}${sep}`;
  if (!absolute.startsWith(boundary)) throw new Error("encrypted cloud state escaped the project root");
  return absolute;
}

async function collectDirectory(root, directory, files) {
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("cloud state directory must be a real directory");
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("cloud state must not contain symbolic links");
    if (entry.isDirectory()) await collectDirectory(root, absolute, files);
    else if (entry.isFile()) await collectFile(root, absolute, files);
    else throw new Error("cloud state contains an unsupported filesystem entry");
  }
}

async function collectFile(root, absolute, files) {
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("cloud state file must be a regular file");
  if (metadata.size > MAX_FILE_BYTES) throw new Error("cloud state file exceeds its size limit");
  const path = portablePath(relative(root, absolute));
  if (!allowedStatePath(path)) throw new Error("cloud state file is outside the allowlist");
  const data = await readFile(absolute);
  files.push({
    path,
    mode: 0o600,
    size: data.length,
    sha256: bytesSha256(data),
    data_b64: data.toString("base64"),
  });
}

export async function buildCloudStatePayload({ root = projectRoot, createdAt = new Date().toISOString() } = {}) {
  const resolvedRoot = resolve(root);
  const files = [];
  for (const stateRoot of STATE_ROOTS) await collectDirectory(resolvedRoot, resolve(resolvedRoot, stateRoot), files);
  for (const stateFile of STATE_FILES) {
    try {
      await collectFile(resolvedRoot, resolve(resolvedRoot, stateFile), files);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (files.length > MAX_FILES) throw new Error("cloud state contains too many files");
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("cloud state exceeds its total size limit");
  return {
    schema_version: "finly_cloud_state.v1",
    created_at: new Date(createdAt).toISOString(),
    total_bytes: totalBytes,
    files,
  };
}

export function encryptCloudState(payload, secret, { salt = randomBytes(16), iv = randomBytes(12) } = {}) {
  assertStateSecret(secret);
  const compressed = gzipSync(Buffer.from(stableStringify(payload)), { level: 9, mtime: 0 });
  const key = scryptSync(secret, salt, 32, { N: 16_384, r: 8, p: 1 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return {
    schema_version: "finly_cloud_state_envelope.v1",
    cipher: "aes-256-gcm",
    compression: "gzip",
    kdf: "scrypt-n16384-r8-p1",
    salt_b64: salt.toString("base64"),
    iv_b64: iv.toString("base64"),
    auth_tag_b64: cipher.getAuthTag().toString("base64"),
    ciphertext_b64: ciphertext.toString("base64"),
    plaintext_sha256: bytesSha256(Buffer.from(stableStringify(payload))),
  };
}

export function decryptCloudState(envelope, secret) {
  assertStateSecret(secret);
  const keys = [
    "auth_tag_b64", "cipher", "ciphertext_b64", "compression", "iv_b64", "kdf",
    "plaintext_sha256", "salt_b64", "schema_version",
  ];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
    || stableStringify(Object.keys(envelope).sort()) !== stableStringify(keys.sort())
    || envelope.schema_version !== "finly_cloud_state_envelope.v1"
    || envelope.cipher !== "aes-256-gcm"
    || envelope.compression !== "gzip"
    || envelope.kdf !== "scrypt-n16384-r8-p1") {
    throw new Error("cloud state envelope is invalid");
  }
  try {
    const salt = Buffer.from(envelope.salt_b64, "base64");
    const iv = Buffer.from(envelope.iv_b64, "base64");
    const tag = Buffer.from(envelope.auth_tag_b64, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext_b64, "base64");
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new Error();
    const key = scryptSync(secret, salt, 32, { N: 16_384, r: 8, p: 1 });
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const serialized = gunzipSync(compressed, { maxOutputLength: MAX_TOTAL_BYTES * 2 });
    if (bytesSha256(serialized) !== envelope.plaintext_sha256) throw new Error();
    return JSON.parse(serialized.toString("utf8"));
  } catch {
    throw new Error("cloud state authentication failed");
  }
}

function validateStatePayload(payload) {
  const keys = ["created_at", "files", "schema_version", "total_bytes"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || stableStringify(Object.keys(payload).sort()) !== stableStringify(keys.sort())
    || payload.schema_version !== "finly_cloud_state.v1"
    || new Date(payload.created_at).toISOString() !== payload.created_at
    || !Array.isArray(payload.files)
    || payload.files.length > MAX_FILES) {
    throw new Error("cloud state payload is invalid");
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const file of payload.files) {
    const fileKeys = ["data_b64", "mode", "path", "sha256", "size"];
    if (!file || typeof file !== "object" || Array.isArray(file)
      || stableStringify(Object.keys(file).sort()) !== stableStringify(fileKeys.sort())
      || !allowedStatePath(file.path)
      || seen.has(file.path)
      || file.mode !== 0o600
      || !Number.isInteger(file.size)
      || file.size < 0
      || file.size > MAX_FILE_BYTES) {
      throw new Error("cloud state file manifest is invalid");
    }
    const data = Buffer.from(file.data_b64, "base64");
    if (data.length !== file.size || bytesSha256(data) !== file.sha256) throw new Error("cloud state file authentication failed");
    seen.add(file.path);
    totalBytes += file.size;
  }
  if (totalBytes !== payload.total_bytes || totalBytes > MAX_TOTAL_BYTES) throw new Error("cloud state byte count is invalid");
  return payload;
}

export async function restoreCloudState({ root = projectRoot, envelope, secret } = {}) {
  const payload = validateStatePayload(decryptCloudState(envelope, secret));
  const resolvedRoot = resolve(root);
  for (const stateRoot of STATE_ROOTS) await rm(resolve(resolvedRoot, stateRoot), { recursive: true, force: true });
  for (const stateFile of STATE_FILES) await rm(resolve(resolvedRoot, stateFile), { force: true });
  for (const file of payload.files) {
    const absolute = absoluteInside(resolvedRoot, file.path);
    const data = Buffer.from(file.data_b64, "base64");
    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    const temporary = `${absolute}.${process.pid}.restore`;
    await writeFile(temporary, data, { flag: "wx", mode: file.mode });
    await rename(temporary, absolute);
  }
  return { files: payload.files.length, total_bytes: payload.total_bytes };
}

async function writeEnvelope({ root, output, secret }) {
  const payload = await buildCloudStatePayload({ root });
  const envelope = encryptCloudState(payload, secret);
  const serialized = `${JSON.stringify(envelope)}\n`;
  if (Buffer.byteLength(serialized) > MAX_ENVELOPE_BYTES) {
    throw new Error("encrypted cloud state exceeds its publication size limit");
  }
  const absolute = resolve(output);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
  await rename(temporary, absolute);
  return payload;
}

async function gitRun(publicationDirectory, arguments_, { allowNoDifference = false } = {}) {
  try {
    await execFileAsync("git", ["-C", publicationDirectory, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch (error) {
    if (allowNoDifference && error?.code === 1) return false;
    throw new Error("cloud state Git publication failed");
  }
}

function exactObjectKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || stableStringify(Object.keys(value).sort()) !== stableStringify([...expected].sort())) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function validatePublicSnapshot(snapshot) {
  exactObjectKeys(snapshot, [
    "account", "competition", "decision", "exposure", "integrity", "market", "schema_version", "snapshot_at",
  ], "public competition snapshot");
  exactObjectKeys(snapshot.competition, ["baseline_equity", "official_window_end", "official_window_start", "phase"], "public competition window");
  exactObjectKeys(snapshot.account, ["buying_power", "cash", "equity"], "public account totals");
  exactObjectKeys(snapshot.market, ["next_transition_at", "next_transition_label", "status"], "public market status");
  exactObjectKeys(snapshot.decision, ["code", "explanation", "headline", "status"], "public decision summary");
  exactObjectKeys(snapshot.exposure, [
    "aggregate_risk_limit_dollars", "g4_equity_market_value_dollars", "g4_equity_positions", "open_orders",
    "open_positions", "option_open_orders", "option_positions", "options_defined_risk_dollars",
    "per_trade_risk_limit_dollars", "position_status", "position_summary",
  ], "public exposure summary");
  exactObjectKeys(snapshot.integrity, ["account_verified", "paper_account", "sanitized", "source"], "public integrity summary");
  if (snapshot.schema_version !== "finly_competition_dashboard.v2"
    || snapshot.integrity.paper_account !== true
    || snapshot.integrity.sanitized !== true) {
    throw new Error("public competition snapshot is invalid");
  }
  return snapshot;
}

export async function checkpointCloudState({
  root = projectRoot,
  publicationDirectory,
  secret = process.env.FINLY_CLOUD_STATE_SECRET,
  branch = process.env.FINLY_CLOUD_STATE_BRANCH ?? STATE_BRANCH,
  snapshotPath = null,
} = {}) {
  if (branch !== STATE_BRANCH) throw new Error("cloud state branch is not allowlisted");
  const publication = resolve(publicationDirectory ?? "");
  const publicationMetadata = await lstat(publication);
  if (!publicationMetadata.isDirectory() || publicationMetadata.isSymbolicLink()) {
    throw new Error("cloud state publication directory is invalid");
  }
  const payload = await writeEnvelope({ root, output: join(publication, STATE_FILE), secret });
  const staged = [STATE_FILE];
  if (snapshotPath !== null) {
    const snapshot = validatePublicSnapshot(JSON.parse(await readFile(resolve(snapshotPath), "utf8")));
    await writeFile(join(publication, SNAPSHOT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o644 });
    staged.push(SNAPSHOT_FILE);
  }
  await gitRun(publication, ["add", "--", ...staged]);
  const changed = !await gitRun(publication, ["diff", "--cached", "--quiet"], { allowNoDifference: true });
  if (!changed) return { published: false, files: payload.files.length, total_bytes: payload.total_bytes };
  await gitRun(publication, ["commit", "-m", "Update encrypted Finly paper state"]);
  await gitRun(publication, ["push", "origin", `HEAD:refs/heads/${branch}`]);
  return { published: true, files: payload.files.length, total_bytes: payload.total_bytes };
}

function parseArguments(arguments_) {
  const [command, ...rest] = arguments_;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith("--") || rest[index + 1] === undefined) throw new Error("invalid cloud-state arguments");
    options[rest[index].slice(2)] = rest[index + 1];
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const secret = process.env.FINLY_CLOUD_STATE_SECRET;
  if (command === "restore" && options.input) {
    const envelope = JSON.parse(await readFile(resolve(options.input), "utf8"));
    await restoreCloudState({ root: projectRoot, envelope, secret });
  } else if (command === "checkpoint" && options["publication-dir"]) {
    await checkpointCloudState({ root: projectRoot, publicationDirectory: options["publication-dir"], secret });
  } else if (command === "publish" && options["publication-dir"] && options.snapshot) {
    await checkpointCloudState({
      root: projectRoot,
      publicationDirectory: options["publication-dir"],
      secret,
      snapshotPath: options.snapshot,
    });
  } else {
    throw new Error("usage: cloud_state.mjs restore|checkpoint|publish with the required paths");
  }
  process.stdout.write('{"status":"CLOUD_STATE_OPERATION_COMPLETE"}\n');
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch(() => {
    process.stderr.write("Finly cloud state operation failed safely.\n");
    process.exitCode = 1;
  });
}
