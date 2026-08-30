import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { normalizeAdjustedOhlc } from "../research/aegis_q_legacy_reproduction.mjs";
import {
  AEGIS_AUXILIARY_FREEZE_SCHEMA,
  AEGIS_AUXILIARY_CLAIM_BOUNDARY,
  AEGIS_AUXILIARY_EXECUTION,
  AEGIS_AUXILIARY_PANEL_SCHEMA,
  AEGIS_AUXILIARY_PANEL_SEMANTICS,
  AEGIS_AUXILIARY_PATHS,
  buildAegisAuxiliaryArtifacts,
  loadFrozenAegisAuxiliaryInputs,
  prepareAegisNativePanel,
  runAegisAuxiliary,
  validateAegisAuxiliaryProtocol,
  verifyExistingAegisAuxiliaryArtifacts,
  withExclusiveAegisRunLock,
  writeAegisArtifactOnceOrVerify,
  writeAegisAuxiliaryArtifactsOnce,
} from "../research/run_aegis_q_legacy_reproduction.mjs";

const templateUrl = new URL("../research/aegis_q_legacy_reproduction_protocol.template.json", import.meta.url);
const runnerUrl = new URL("../research/run_aegis_q_legacy_reproduction.mjs", import.meta.url);
const DAY = 86_400_000;
const NATIVE_START_MILLIS = Date.parse("2021-05-12T00:00:00Z");
const NATIVE_END = "2026-08-27";
const RAW_BARS_PATH = "data/private/competitor_reproductions/aegis_q_synthetic_raw_bars.json";
const RAW_BARS_PAYLOAD = Buffer.from("synthetic split-adjusted raw-bars response\n", "utf8");

function digest(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function serialized(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isoDate(milliseconds) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function syntheticPanelDocument() {
  const warmupDates = Array.from({ length: 200 }, (_, index) => (
    isoDate(NATIVE_START_MILLIS - (200 - index) * DAY)
  ));
  const nativeDates = [
    ...Array.from({ length: 1_329 }, (_, index) => isoDate(NATIVE_START_MILLIS + index * DAY)),
    NATIVE_END,
  ];
  const dates = [...warmupDates, ...nativeDates];
  const bars = [];
  for (let index = 0; index < dates.length; index += 1) {
    const qqqClose = 100 * (1.0005 ** index);
    const tqqqClose = 50 * (1.0015 ** index);
    bars.push({
      date: dates[index],
      symbol: "QQQ",
      open: qqqClose,
      high: qqqClose * 1.001,
      low: qqqClose * 0.999,
      close: qqqClose,
    });
    bars.push({
      date: dates[index],
      symbol: "TQQQ",
      open: tqqqClose,
      high: tqqqClose * 1.001,
      low: tqqqClose * 0.999,
      close: tqqqClose,
    });
  }
  return {
    schema_version: AEGIS_AUXILIARY_PANEL_SCHEMA,
    source: {
      provider: "Synthetic public-data fixture",
      url: "https://example.test/qqq-tqqq",
      retrieved_at: "2026-08-29T12:00:00Z",
      feed: "iex",
      timeframe: "1Day",
      adjustment: "split",
      request_start: warmupDates[0],
      request_end: NATIVE_END,
      raw_bars_path: RAW_BARS_PATH,
      raw_bars_sha256: digest(RAW_BARS_PAYLOAD),
      corporate_actions_applied_separately: false,
    },
    input_hashes: {
      raw_bars_sha256: digest(RAW_BARS_PAYLOAD),
      corporate_actions_sha256: null,
    },
    semantics: structuredClone(AEGIS_AUXILIARY_PANEL_SEMANTICS),
    bars,
  };
}

async function protocolTemplate() {
  return JSON.parse(await readFile(templateUrl, "utf8"));
}

async function frozenProtocol(panelDocument, {
  panelPath = "data/private/competitor_reproductions/aegis_q_synthetic_panel.json",
  codeHashes = null,
} = {}) {
  const protocol = await protocolTemplate();
  const panelPayload = serialized(panelDocument);
  const normalized = normalizeAdjustedOhlc(panelDocument.bars, []);
  protocol.status = "frozen_before_first_aegis_q_auxiliary_output";
  protocol.created_at = "2026-08-29T12:01:00Z";
  protocol.frozen_before_first_output = true;
  protocol.data.public_source = { ...panelDocument.source };
  protocol.data.panel.path = panelPath;
  protocol.data.panel.file_sha256 = digest(panelPayload);
  protocol.data.panel.normalized_panel_sha256 = normalized.normalized_panel_sha256;
  const defaults = Object.fromEntries(Object.values(AEGIS_AUXILIARY_PATHS)
    .filter((path) => path.endsWith(".mjs"))
    .map((path) => [path, "a".repeat(64)]));
  const hashes = { ...defaults, ...codeHashes };
  for (const descriptor of Object.values(protocol.frozen_code)) {
    descriptor.sha256 = hashes[descriptor.path];
  }
  return { protocol, panelPayload };
}

test("the protocol template is deliberately unfrozen and local-path validation rejects URL acquisition", async () => {
  const template = await protocolTemplate();
  const templateValidation = validateAegisAuxiliaryProtocol(template);
  assert.equal(templateValidation.passes, false);
  assert.ok(templateValidation.reasons.some((reason) => reason.includes("not frozen")));
  assert.ok(templateValidation.reasons.some((reason) => reason.includes("panel file SHA-256")));

  const panelDocument = syntheticPanelDocument();
  const { protocol } = await frozenProtocol(panelDocument);
  protocol.data.panel.path = "https://example.test/panel.json";
  const urlValidation = validateAegisAuxiliaryProtocol(protocol);
  assert.equal(urlValidation.passes, false);
  assert.ok(urlValidation.reasons.some((reason) => reason.includes("network URLs are forbidden")));

  const claimDrift = (await frozenProtocol(panelDocument)).protocol;
  claimDrift.claim_boundary.future_profitability_proven = true;
  assert.ok(validateAegisAuxiliaryProtocol(claimDrift).reasons.includes(
    "claim boundary does not match the pinned implementation",
  ));
  const executionDrift = (await frozenProtocol(panelDocument)).protocol;
  executionDrift.execution.fractional_shares = false;
  assert.ok(validateAegisAuxiliaryProtocol(executionDrift).reasons.includes(
    "execution boundary does not match the pinned implementation",
  ));
  const sourceDrift = (await frozenProtocol(panelDocument)).protocol;
  sourceDrift.data.public_source.adjustment = "all";
  assert.ok(validateAegisAuxiliaryProtocol(sourceDrift).reasons.includes(
    "public panel adjustment must be split only",
  ));
  const semanticsDrift = (await frozenProtocol(panelDocument)).protocol;
  semanticsDrift.data.panel_semantics.total_return_adjustment = true;
  assert.ok(validateAegisAuxiliaryProtocol(semanticsDrift).reasons.includes(
    "panel semantics does not match the pinned implementation",
  ));
  assert.deepEqual(executionDrift.execution, { ...AEGIS_AUXILIARY_EXECUTION, fractional_shares: false });

  const source = await readFile(runnerUrl, "utf8");
  assert.doesNotMatch(source, /from ["']node:https?["']/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
});

test("a frozen synthetic adjusted-OHLC panel is cropped to the exact native window without future acquisition", async () => {
  const panelDocument = syntheticPanelDocument();
  const { protocol } = await frozenProtocol(panelDocument);
  const validation = validateAegisAuxiliaryProtocol(protocol);
  assert.deepEqual(validation, { passes: true, reasons: [] });

  const prepared = prepareAegisNativePanel(panelDocument, protocol);
  assert.equal(prepared.warmup_sessions, 200);
  assert.equal(prepared.native_sessions, 1_330);
  assert.equal(prepared.selected_common_sessions, 1_530);
  assert.equal(prepared.selected_last_date, NATIVE_END);
  assert.equal(prepared.bars.length, 3_060);

  const changed = structuredClone(panelDocument);
  changed.bars[0].open += 1;
  assert.throws(
    () => prepareAegisNativePanel(changed, protocol),
    /normalized panel SHA-256 differs/u,
  );
});

test("the deterministic artifact builder reproduces agent, QQQ, and TQQQ metrics but reports a synthetic mismatch honestly", async () => {
  const panelDocument = syntheticPanelDocument();
  const { protocol } = await frozenProtocol(panelDocument);
  const frozenInputHashes = {
    protocol_sha256: "1".repeat(64),
    freeze_receipt_sha256: "2".repeat(64),
    panel_file_sha256: protocol.data.panel.file_sha256,
    implementation_sha256: "3".repeat(64),
    runner_sha256: "4".repeat(64),
    implementation_test_sha256: "5".repeat(64),
    runner_test_sha256: "6".repeat(64),
  };
  const bundle = buildAegisAuxiliaryArtifacts({ protocol, panelDocument, frozenInputHashes });

  assert.deepEqual(Object.keys(bundle.result.metrics), ["agent", "QQQ", "TQQQ"]);
  assert.equal(bundle.result.metrics.agent.start, "2021-05-12");
  assert.equal(bundle.result.metrics.agent.end, NATIVE_END);
  assert.equal(bundle.result.metrics.agent.observations, 1_330);
  assert.equal(bundle.result.published_bundle_verification.verified, false);
  assert.equal(bundle.result.claim_boundary.submitted_options_pnl, false);
  assert.match(bundle.report.toString("utf8"), /not the submitted AEGIS-Q options strategy/u);
});

test("the local loader requires panel, code, protocol, and freeze-receipt hashes to agree", async (context) => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), "finly-aegis-loader-"));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const panelDocument = syntheticPanelDocument();
  const panelPath = "data/private/competitor_reproductions/aegis_q_synthetic_panel.json";
  const codePayloads = Object.fromEntries([
    AEGIS_AUXILIARY_PATHS.implementation,
    AEGIS_AUXILIARY_PATHS.runner,
    AEGIS_AUXILIARY_PATHS.implementation_test,
    AEGIS_AUXILIARY_PATHS.runner_test,
  ].map((path) => [path, Buffer.from(`synthetic frozen file: ${path}\n`, "utf8")]));
  const codeHashes = Object.fromEntries(Object.entries(codePayloads).map(([path, payload]) => [path, digest(payload)]));
  const { protocol, panelPayload } = await frozenProtocol(panelDocument, { panelPath, codeHashes });
  const protocolPayload = serialized(protocol);

  const files = {
    [AEGIS_AUXILIARY_PATHS.protocol]: protocolPayload,
    [RAW_BARS_PATH]: RAW_BARS_PAYLOAD,
    [panelPath]: panelPayload,
    ...codePayloads,
  };
  for (const [path, payload] of Object.entries(files)) {
    const absolute = resolve(projectRoot, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, payload);
  }
  const receipt = {
    schema_version: AEGIS_AUXILIARY_FREEZE_SCHEMA,
    status: "frozen_before_first_aegis_q_auxiliary_output",
    created_at: "2026-08-29T12:02:00Z",
    claim_boundary: structuredClone(AEGIS_AUXILIARY_CLAIM_BOUNDARY),
    files: Object.fromEntries(Object.entries(files).map(([path, payload]) => [path, digest(payload)])),
    validation_before_freeze: {
      synthetic_implementation_tests: "passed",
      synthetic_runner_tests: "passed",
      targeted_eslint: "passed",
      panel_schema_and_hash_check: "passed",
      split_only_provenance_check: "passed",
    },
    aegis_q_auxiliary_results_seen_at_freeze: false,
    aegis_q_auxiliary_output_absent_at_freeze: true,
    market_fetch_permitted: false,
  };
  const receiptPath = resolve(projectRoot, AEGIS_AUXILIARY_PATHS.freeze_receipt);
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, serialized(receipt));

  const loaded = await loadFrozenAegisAuxiliaryInputs({ projectRoot });
  assert.equal(loaded.hashes.panel_file_sha256, protocol.data.panel.file_sha256);
  assert.equal(loaded.protocol.claim_boundary.submitted_options_pnl, false);

  const firstRun = await runAegisAuxiliary({ projectRoot });
  assert.equal(firstRun.written, true);
  assert.deepEqual(firstRun.write_statuses, ["created", "created", "created"]);
  const runClaim = JSON.parse(await readFile(
    resolve(projectRoot, AEGIS_AUXILIARY_PATHS.run_claim),
    "utf8",
  ));
  assert.equal(runClaim.status,
    "claimed_before_first_official_aegis_q_auxiliary_computation");
  assert.equal(runClaim.published_target_metrics_known_before_claim, true);
  assert.equal(runClaim.claim_boundary.apples_to_apples_with_finly, false);
  assert.match(runClaim.process_attestation_boundary, /not cryptographic proof/u);
  const recovered = await runAegisAuxiliary({ projectRoot });
  assert.deepEqual(recovered.write_statuses,
    ["verified_existing", "verified_existing", "verified_existing"]);
  const verifiedRun = await runAegisAuxiliary({ projectRoot, verifyExisting: true });
  assert.equal(verifiedRun.verified, true);

  const tampered = Buffer.from(`${panelPayload.toString("utf8")} `, "utf8");
  await writeFile(resolve(projectRoot, panelPath), tampered);
  await assert.rejects(
    loadFrozenAegisAuxiliaryInputs({ projectRoot }),
    /local panel file SHA-256 differs/u,
  );
});

test("first-run artifacts recover byte-identically and verify-existing checks hashes plus a fresh reproduction", async (context) => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), "finly-aegis-output-"));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const panelDocument = syntheticPanelDocument();
  const { protocol } = await frozenProtocol(panelDocument);
  const frozen = {
    hashes: {
      protocol_sha256: "1".repeat(64),
      freeze_receipt_sha256: "2".repeat(64),
      panel_file_sha256: protocol.data.panel.file_sha256,
      implementation_sha256: "3".repeat(64),
      runner_sha256: "4".repeat(64),
      implementation_test_sha256: "5".repeat(64),
      runner_test_sha256: "6".repeat(64),
    },
  };
  const bundle = buildAegisAuxiliaryArtifacts({
    protocol,
    panelDocument,
    frozenInputHashes: frozen.hashes,
  });
  const first = await writeAegisAuxiliaryArtifactsOnce({
    projectRoot,
    bundle,
    frozen,
    createdAt: "2026-08-29T12:03:00Z",
  });
  assert.deepEqual(first.statuses, ["created", "created", "created"]);
  const resumed = await writeAegisAuxiliaryArtifactsOnce({
    projectRoot,
    bundle,
    frozen,
    createdAt: "2026-08-29T12:03:00Z",
  });
  assert.deepEqual(resumed.statuses,
    ["verified_existing", "verified_existing", "verified_existing"]);
  const verified = await verifyExistingAegisAuxiliaryArtifacts({ projectRoot, bundle, frozen });
  assert.equal(verified.verified, true);

  const resultPath = resolve(projectRoot, AEGIS_AUXILIARY_PATHS.result_json);
  await writeFile(resultPath, Buffer.from("{}\n", "utf8"));
  await assert.rejects(
    verifyExistingAegisAuxiliaryArtifacts({ projectRoot, bundle, frozen }),
    /result JSON hash differs/u,
  );
});

test("write-once publication rejects conflicting bytes and the owner lock rejects concurrency", async (context) => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), "finly-aegis-integrity-"));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const artifactPath = resolve(projectRoot, "artifact.json");
  assert.equal(await writeAegisArtifactOnceOrVerify(
    artifactPath,
    Buffer.from("same\n"),
    "synthetic AEGIS artifact",
  ), "created");
  assert.equal(await writeAegisArtifactOnceOrVerify(
    artifactPath,
    Buffer.from("same\n"),
    "synthetic AEGIS artifact",
  ), "verified_existing");
  await assert.rejects(
    writeAegisArtifactOnceOrVerify(
      artifactPath,
      Buffer.from("different\n"),
      "synthetic AEGIS artifact",
    ),
    /already exists with different bytes/u,
  );

  let releaseOwner;
  let ownerEntered;
  const entered = new Promise((resolveEntered) => { ownerEntered = resolveEntered; });
  const release = new Promise((resolveRelease) => { releaseOwner = resolveRelease; });
  const owner = withExclusiveAegisRunLock({ projectRoot }, async () => {
    const metadata = JSON.parse(await readFile(
      resolve(projectRoot, "research/.aegis_q_legacy_reproduction_run.lock/owner.json"),
      "utf8",
    ));
    assert.equal(metadata.schema_version,
      "finly_aegis_q_exclusive_directory_lock_owner.v1");
    assert.equal(metadata.pid, process.pid);
    assert.match(metadata.token, /^[0-9a-f-]{36}$/u);
    assert.match(metadata.recovery_instruction, /Do not remove/u);
    ownerEntered();
    await release;
    return "complete";
  });
  await entered;
  await assert.rejects(
    withExclusiveAegisRunLock({ projectRoot }, async () => "unexpected"),
    /run lock already exists/u,
  );
  releaseOwner();
  assert.equal(await owner, "complete");
  assert.equal(await withExclusiveAegisRunLock({ projectRoot }, async () => "reacquired"),
    "reacquired");
});
