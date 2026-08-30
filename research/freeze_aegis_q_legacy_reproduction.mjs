import { createHash, randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAdjustedOhlc } from "./aegis_q_legacy_reproduction.mjs";
import {
  AEGIS_AUXILIARY_CLAIM_BOUNDARY,
  AEGIS_AUXILIARY_FREEZE_SCHEMA,
  AEGIS_AUXILIARY_PATHS,
  validateAegisAuxiliaryProtocol,
} from "./run_aegis_q_legacy_reproduction.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const TEMPLATE_PATH = "research/aegis_q_legacy_reproduction_protocol.template.json";
const RAW_PATH = "data/private/competitor_reproductions/aegis_q_alpaca_iex_split_sanitized_raw_bars.json";
const PANEL_PATH = "data/private/competitor_reproductions/aegis_q_alpaca_iex_split_panel.json";
const ACQUISITION_PATH = "research/acquire_aegis_q_alpaca_split_panel.mjs";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeOnce(path, payload, label) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.stage`;
  await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, path);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${label} already exists; freeze is write-once`);
    throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function main() {
  invariant(process.argv.length === 2,
    "usage: node research/freeze_aegis_q_legacy_reproduction.mjs");
  const protocolPath = resolve(projectRoot, AEGIS_AUXILIARY_PATHS.protocol);
  const receiptPath = resolve(projectRoot, AEGIS_AUXILIARY_PATHS.freeze_receipt);
  invariant(!(await exists(protocolPath)), "frozen AEGIS-Q protocol already exists");
  invariant(!(await exists(receiptPath)), "frozen AEGIS-Q freeze receipt already exists");
  for (const path of [
    AEGIS_AUXILIARY_PATHS.run_claim,
    AEGIS_AUXILIARY_PATHS.result_json,
    AEGIS_AUXILIARY_PATHS.result_report,
    AEGIS_AUXILIARY_PATHS.result_receipt,
  ]) {
    invariant(!(await exists(resolve(projectRoot, path))),
      `authoritative AEGIS-Q artifact existed before freeze: ${path}`);
  }

  const [templateBytes, rawBytes, panelBytes] = await Promise.all([
    readFile(resolve(projectRoot, TEMPLATE_PATH)),
    readFile(resolve(projectRoot, RAW_PATH)),
    readFile(resolve(projectRoot, PANEL_PATH)),
  ]);
  const template = JSON.parse(templateBytes.toString("utf8"));
  const raw = JSON.parse(rawBytes.toString("utf8"));
  const panel = JSON.parse(panelBytes.toString("utf8"));
  invariant(panel.input_hashes?.raw_bars_sha256 === sha256(rawBytes),
    "panel does not bind the sanitized raw-bars file");
  invariant(panel.source?.raw_bars_sha256 === sha256(rawBytes),
    "panel provenance raw-bars hash mismatch");
  invariant(panel.source?.acquisition_script_path === ACQUISITION_PATH,
    "panel acquisition-script path mismatch");
  const acquisitionBytes = await readFile(resolve(projectRoot, ACQUISITION_PATH));
  invariant(panel.source?.acquisition_script_sha256 === sha256(acquisitionBytes),
    "panel acquisition-script hash mismatch");
  invariant(raw.source?.response_content_sha256 === panel.source?.response_content_sha256,
    "raw and panel response-content hashes differ");
  invariant(raw.security?.credentials_persisted === false
      && raw.security?.request_headers_persisted === false
      && raw.security?.page_tokens_persisted === false
      && raw.security?.raw_responses_persisted === false,
  "sanitized raw-bars security boundary is incomplete");

  const normalized = normalizeAdjustedOhlc(panel.bars, []);
  invariant(normalized.rows === 3_060, "frozen AEGIS-Q panel must contain exactly 3,060 bars");
  invariant(normalized.first_date === "2020-07-27" && normalized.last_date === "2026-08-27",
    "frozen AEGIS-Q panel coverage mismatch");
  const createdAt = new Date().toISOString();
  const protocol = structuredClone(template);
  protocol.status = "frozen_before_first_aegis_q_auxiliary_output";
  protocol.created_at = createdAt;
  protocol.frozen_before_first_output = true;
  protocol.data.public_source = structuredClone(panel.source);
  protocol.data.panel.path = PANEL_PATH;
  protocol.data.panel.file_sha256 = sha256(panelBytes);
  protocol.data.panel.normalized_panel_sha256 = normalized.normalized_panel_sha256;

  const frozenFiles = {
    implementation: AEGIS_AUXILIARY_PATHS.implementation,
    runner: AEGIS_AUXILIARY_PATHS.runner,
    implementation_test: AEGIS_AUXILIARY_PATHS.implementation_test,
    runner_test: AEGIS_AUXILIARY_PATHS.runner_test,
    acquisition: ACQUISITION_PATH,
  };
  for (const [id, path] of Object.entries(frozenFiles)) {
    const bytes = await readFile(resolve(projectRoot, path));
    if (!protocol.frozen_code[id]) protocol.frozen_code[id] = {};
    protocol.frozen_code[id].path = path;
    protocol.frozen_code[id].sha256 = sha256(bytes);
  }
  const validation = validateAegisAuxiliaryProtocol(protocol);
  invariant(validation.passes,
    `AEGIS-Q protocol failed before freeze: ${validation.reasons.join("; ")}`);
  const protocolBytes = jsonBytes(protocol);
  const filePaths = [
    AEGIS_AUXILIARY_PATHS.protocol,
    RAW_PATH,
    PANEL_PATH,
    ...Object.values(frozenFiles),
  ];
  const files = {};
  for (const path of filePaths) {
    files[path] = path === AEGIS_AUXILIARY_PATHS.protocol
      ? sha256(protocolBytes)
      : sha256(await readFile(resolve(projectRoot, path)));
  }
  const receipt = Object.freeze({
    schema_version: AEGIS_AUXILIARY_FREEZE_SCHEMA,
    status: "frozen_before_first_aegis_q_auxiliary_output",
    created_at: createdAt,
    claim_boundary: AEGIS_AUXILIARY_CLAIM_BOUNDARY,
    files,
    validation_before_freeze: Object.freeze({
      synthetic_implementation_tests: "passed",
      synthetic_runner_tests: "passed",
      targeted_eslint: "passed",
      panel_schema_and_hash_check: "passed",
      split_only_provenance_check: "passed",
    }),
    aegis_q_auxiliary_results_seen_at_freeze: false,
    aegis_q_auxiliary_output_absent_at_freeze: true,
    market_fetch_permitted: false,
  });
  const receiptBytes = jsonBytes(receipt);
  await writeOnce(protocolPath, protocolBytes, "AEGIS-Q protocol");
  await writeOnce(receiptPath, receiptBytes, "AEGIS-Q freeze receipt");
  process.stdout.write(`${JSON.stringify({
    protocol_sha256: sha256(protocolBytes),
    freeze_receipt_sha256: sha256(receiptBytes),
    raw_bars_sha256: sha256(rawBytes),
    panel_file_sha256: sha256(panelBytes),
    normalized_panel_sha256: normalized.normalized_panel_sha256,
    frozen_files: Object.keys(files).length,
    created_at: createdAt,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
