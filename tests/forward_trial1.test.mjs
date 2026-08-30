import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  appendForwardTrialSignalCommitment,
  appendForwardTrialSettlement,
  buildForwardTrialSettlementForTest,
  buildForwardTrialSettlementInputForTest,
  buildForwardTrialSignalCommitment,
  buildForwardTrialSignalCommitmentInput,
  forwardTrialExpectedMarketCloseAt,
  FORWARD_TRIAL1_STRATEGY_IDS,
  FORWARD_TRIAL1_SYMBOLS,
  hashForwardTrialEntryBody,
  inferencePhaseForSettledSessions,
  sha256Bytes,
  validateForwardTrialGenesis,
  validateForwardTrialProtocol,
  validateForwardTrialSettlementInputForTest,
  validateForwardTrialSignalCommitment,
  validateForwardTrialSignalCommitmentInput,
  verifyForwardTrialLedger,
} from "../research/forward_trial1.mjs";
import { parseForwardTrial1Cli, runForwardTrial1Cli } from "../research/run_forward_trial1.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const protocolPath = resolve(projectRoot, "research/forward_trial1_protocol.json");
const genesisPath = resolve(projectRoot, "research/forward_trial1_genesis.json");
const BRIDGE = JSON.parse(await readFile(resolve(projectRoot, "research/forward_trial1_bridge_2026-08-28.json"))).normalized_point;
const FAR_CLOCK = () => new Date("2028-01-01T00:00:00.000Z");
const hash = (character) => `sha256:${character.repeat(64)}`;
const clone = structuredClone;

async function frozen() {
  const protocolRaw = await readFile(protocolPath);
  return { protocolRaw, protocol: JSON.parse(protocolRaw), genesis: JSON.parse(await readFile(genesisPath)) };
}

function nextSession(date) {
  const value = new Date(`${date}T12:00:00.000Z`);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    value.setUTCDate(value.getUTCDate() + 1);
    const candidate = value.toISOString().slice(0, 10);
    try { forwardTrialExpectedMarketCloseAt(candidate); return candidate; } catch (error) {
      if (!/not a supported/.test(String(error?.message))) throw error;
    }
  }
  throw new Error("no next test market session");
}
function syntheticSeed() {
  const points = []; let date = "2025-08-26";
  for (let index = 0; index < 253; index += 1) {
    const progress = index / 252;
    points.push({
      date,
      closes: Object.fromEntries(FORWARD_TRIAL1_SYMBOLS.map((symbol, symbolIndex) => [
        symbol,
        BRIDGE.closes[symbol] * (0.85 + 0.149 * progress + symbolIndex / 1_000_000),
      ])),
    });
    if (index < 252) date = nextSession(date);
  }
  if (points.at(-1).date !== "2026-08-27") throw new Error("synthetic seed calendar drifted");
  return points;
}
const SEED = syntheticSeed();

function syntheticProtocol(protocol) {
  const value = clone(protocol); value.data_boundary.seed_normalized_sha256 = hashForwardTrialEntryBody(SEED); return value;
}
function syntheticGenesis(genesis, protocol, protocolRaw) {
  const value = clone(genesis);
  value.payload.protocol_file_sha256 = sha256Bytes(protocolRaw);
  value.payload.freeze_boundary_sha256 = hashForwardTrialEntryBody(protocol.freeze);
  value.payload.formula_binding_sha256 = Object.fromEntries(FORWARD_TRIAL1_STRATEGY_IDS.map((id) => [id, protocol.formula_bindings[id].binding_sha256]));
  value.payload.initial_account_state_sha256 = hashForwardTrialEntryBody(protocol.genesis.initial_account_state);
  value.payload.initial_commitment_state_sha256 = hashForwardTrialEntryBody(protocol.genesis.initial_commitment_state);
  value.payload.signal_seed_sha256 = hashForwardTrialEntryBody(protocol.data_boundary);
  const body = { schema_version: value.schema_version, trial_id: value.trial_id, entry_kind: value.entry_kind, commitment_sequence: value.commitment_sequence, settlement_sequence: value.settlement_sequence, payload: value.payload };
  value.genesis_sha256 = hashForwardTrialEntryBody(body); return value;
}
async function syntheticFrozen() {
  const base = await frozen(); const protocol = syntheticProtocol(base.protocol); const protocolRaw = Buffer.from(`${JSON.stringify(protocol, null, 2)}\n`); const genesis = syntheticGenesis(base.genesis, protocol, protocolRaw); return { protocol, protocolRaw, genesis };
}
function after(timestamp, minutes) { return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString(); }
function nextPoint(date, prior, sequence) {
  return { date, closes: Object.fromEntries(FORWARD_TRIAL1_SYMBOLS.map((symbol, index) => [symbol, prior.closes[symbol] * (1 + 0.0001 + ((sequence + index) % 13) / 100_000)])) };
}
function signalInput({ protocol, previousCommitment = null, sequence = 1, now = FAR_CLOCK }) {
  const signalDate = previousCommitment?.payload.timeline.execution_session_date ?? protocol.timing.first_signal_session;
  const signalClose = forwardTrialExpectedMarketCloseAt(signalDate); const executionDate = nextSession(signalDate);
  const signalPanel = previousCommitment === null
    ? [...SEED, clone(BRIDGE), nextPoint(signalDate, BRIDGE, sequence)]
    : [...previousCommitment.payload.data.signal_panel, nextPoint(signalDate, previousCommitment.payload.data.signal_panel.at(-1), sequence)];
  return buildForwardTrialSignalCommitmentInput({
    protocol, previousCommitment, capturedAt: after(signalClose, 22), signalPanel,
    timeline: { signal_session_date: signalDate, signal_market_close_at: signalClose, signal_bar_eligible_at: after(signalClose, 15), availability_delay_minutes: 15, signal_source_available_at: after(signalClose, 18), signal_timestamp: after(signalClose, 20), execution_session_date: executionDate, execution_market_close_at: forwardTrialExpectedMarketCloseAt(executionDate) },
    sourceResponseSha256: hash((sequence % 10).toString()), sourceRequestSha256: hash(((sequence + 1) % 10).toString()), now,
  });
}
function commitment({ protocol, genesis, previousCommitment = null, sequence = 1, now = FAR_CLOCK }) {
  return buildForwardTrialSignalCommitment(signalInput({ protocol, previousCommitment, sequence, now }), { protocol, genesis, previousCommitment, now });
}
async function tempProject({ synthetic = false } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "finly-forward-v2-")); const base = await frozen();
  const active = synthetic ? await syntheticFrozen() : base; const { protocol } = active;
  for (const relative of new Set(["research/forward_trial1_protocol.json", "research/forward_trial1_genesis.json", ...protocol.freeze.frozen_artifacts.map((item) => item.path)])) {
    const destination = resolve(root, relative); await mkdir(dirname(destination), { recursive: true }); await copyFile(resolve(projectRoot, relative), destination);
  }
  if (synthetic) {
    await writeFile(resolve(root, "research/forward_trial1_protocol.json"), active.protocolRaw);
    await writeFile(resolve(root, "research/forward_trial1_genesis.json"), `${JSON.stringify(active.genesis, null, 2)}\n`);
  }
  return { root, ...active };
}
async function writeEntry(directory, entry, field) {
  await mkdir(directory, { recursive: true }); const filename = `${String(entry.sequence).padStart(8, "0")}_${entry[field].slice(7)}.json`; await writeFile(resolve(directory, filename), `${JSON.stringify(entry, null, 2)}\n`);
}

test("zero-row genesis freezes two-phase rules and permits neither settlement nor inference", async () => {
  const { protocolRaw, protocol, genesis } = await frozen(); validateForwardTrialProtocol(protocol); validateForwardTrialGenesis(genesis, protocol, sha256Bytes(protocolRaw));
  assert.deepEqual(protocol.books, FORWARD_TRIAL1_STRATEGY_IDS); assert.equal(genesis.payload.eligibility.historical_commitments, 0); assert.equal(genesis.payload.eligibility.historical_settlements, 0);
  const verification = await verifyForwardTrialLedger(); assert.equal(verification.environment, "PRODUCTION_ZERO_ROW"); assert.equal(verification.verified_signal_commitments, 0); assert.equal(verification.verified_settlements, 0); assert.equal(verification.live_pre_execution_capture_proven, false); assert.equal(verification.signal_commitment_append_permitted, false); assert.equal(verification.corporate_action_reconciliation_ready, false); assert.equal(verification.provider_outcome_price_reconciliation_ready, false); assert.equal(verification.performance_inference_permitted, false); assert.equal(verification.primary_inference, null);
});

test("a signal commitment is formula-bound, captured after data availability, and strictly before execution", async () => {
  const { protocol, genesis } = await syntheticFrozen(); const input = signalInput({ protocol }); validateForwardTrialSignalCommitmentInput(input, { protocol, now: FAR_CLOCK }); const entry = buildForwardTrialSignalCommitment(input, { protocol, genesis, now: FAR_CLOCK }); validateForwardTrialSignalCommitment(entry, { protocol, genesis, now: FAR_CLOCK });
  assert.equal(entry.sequence, 1); assert.equal(entry.payload.timeline.signal_session_date, "2026-08-31"); assert.equal(entry.payload.timeline.execution_session_date, "2026-09-01"); assert.equal(entry.payload.strategy_commitments.g4_shadow_qqq_core_sector_12_6.action, "REBALANCE"); assert.equal(entry.payload.authority.broker_mutation_authorized, false);
});

test("backdated, post-execution, mutated, secret-bearing, and formula-substituted signals fail closed", async () => {
  const { protocol } = await syntheticFrozen(); const valid = signalInput({ protocol });
  const postExecution = clone(valid); postExecution.captured_at = postExecution.timeline.execution_market_close_at; assert.throws(() => validateForwardTrialSignalCommitmentInput(postExecution, { protocol, now: FAR_CLOCK }), /before execution/);
  const mutated = clone(valid); mutated.data.signal_panel.at(-1).closes.SPY *= 2; assert.throws(() => validateForwardTrialSignalCommitmentInput(mutated, { protocol, now: FAR_CLOCK }), /panel hash mismatch/);
  const wrongFormula = clone(valid); wrongFormula.strategy_commitments.benchmark_spy_buy_hold.committed_target_weights = Object.fromEntries(FORWARD_TRIAL1_SYMBOLS.map((symbol) => [symbol, symbol === "BIL" ? 1 : 0])); assert.throws(() => validateForwardTrialSignalCommitmentInput(wrongFormula, { protocol, now: FAR_CLOCK }), /differs from frozen formula/);
  const secret = clone(valid); secret.data.source_evidence.response_content_sha256 = "Bearer abcdefghijklmnopqrstuvwxyz"; assert.throws(() => validateForwardTrialSignalCommitmentInput(secret, { protocol, now: FAR_CLOCK }), /credential-like value/);
  const future = clone(valid); future.captured_at = "2099-01-01T00:00:00.000Z"; assert.throws(() => validateForwardTrialSignalCommitmentInput(future, { protocol, now: FAR_CLOCK }), /future/);
});

test("settlement math is derived only from prior N/N+1/N+2 commitments and remains TEST_ONLY", async () => {
  const { protocol, genesis } = await syntheticFrozen(); const first = commitment({ protocol, genesis }); const second = commitment({ protocol, genesis, previousCommitment: first, sequence: 2 }); const third = commitment({ protocol, genesis, previousCommitment: second, sequence: 3 });
  const input = buildForwardTrialSettlementInputForTest({ protocol, signalCommitment: first, startPriceCommitment: second, endPriceCommitment: third, capturedAt: after(third.payload.timeline.signal_bar_eligible_at, 5), now: FAR_CLOCK }); validateForwardTrialSettlementInputForTest(input, { protocol, signalCommitment: first, startPriceCommitment: second, endPriceCommitment: third, now: FAR_CLOCK });
  assert.equal(input.evidence_class, "TEST_ONLY_SYNTHETIC_UNANCHORED"); assert.equal(input.external_anchor_gate.performance_claim_permitted, false);
  const forged = clone(input); forged.data.asset_returns.BIL += 0.5; assert.throws(() => validateForwardTrialSettlementInputForTest(forged, { protocol, signalCommitment: first, startPriceCommitment: second, endPriceCommitment: third, now: FAR_CLOCK }), /returns differ/);
  await assert.rejects(() => appendForwardTrialSettlement(input), /disabled until an independent/);
});

test("calendar and phase boundaries are pinned", () => {
  assert.equal(forwardTrialExpectedMarketCloseAt("2027-07-02"), "2027-07-02T17:00:00.000Z"); assert.equal(forwardTrialExpectedMarketCloseAt("2026-11-27"), "2026-11-27T18:00:00.000Z");
  assert.equal(inferencePhaseForSettledSessions(60), "ENGINEERING_RECONCILIATION_ONLY"); assert.equal(inferencePhaseForSettledSessions(61), "FORWARD_OBSERVATION_NO_PERFORMANCE_INFERENCE"); assert.equal(inferencePhaseForSettledSessions(252), "PRIMARY_CALCULATION_REQUIRES_VERIFIED_EXTERNAL_ANCHORS");
});

test("CLI defaults verify-only and exposes only acknowledged signal commitment append", async () => {
  assert.deepEqual(parseForwardTrial1Cli([]), { mode: "verify" }); assert.deepEqual(parseForwardTrial1Cli(["--verify-existing"]), { mode: "verify" }); assert.throws(() => parseForwardTrial1Cli(["--append-record", "x"]), /usage/); assert.throws(() => parseForwardTrial1Cli(["--append-settlement", "x"]), /usage/);
  await assert.rejects(() => runForwardTrial1Cli(["--append-signal-commitment", "unused.json"], { environment: {} }), /append denied/);
  await assert.rejects(() => verifyForwardTrialLedger({ projectRoot, now: FAR_CLOCK }), /clock override is forbidden/);
  await assert.rejects(() => appendForwardTrialSignalCommitment({}, { projectRoot }), /production signal commitment append is disabled|private seed artifact/);
});

test("clean public clone verifies the zero-row manifest without the ignored private seed", async () => {
  const { root } = await tempProject();
  try {
    const verification = await verifyForwardTrialLedger({ projectRoot: root, now: FAR_CLOCK });
    assert.equal(verification.environment, "TEST_ONLY"); assert.equal(verification.production_seed_available, false);
    assert.equal(verification.verified_signal_commitments, 0); assert.equal(verification.verified_settlements, 0);
    assert.equal(verification.signal_commitment_append_permitted, false); assert.equal(verification.performance_inference_permitted, false);
  } finally { await rm(root, { recursive: true }); }
});

test("semantic timing, inference, data gates, and formula definitions are executable pins", async () => {
  const { protocol } = await frozen(); const mutations = [
    (value) => { value.freeze.frozen_at = "2099-01-01T00:00:00.000Z"; },
    (value) => { value.freeze.production_v1_observation_end = "2026-08-27"; },
    (value) => { value.timing.lifecycle = "changed"; },
    (value) => { value.timing.commitment_cadence = "changed"; },
    (value) => { value.timing.settlement_sources = "changed"; },
    (value) => { value.data_boundary.panel_construction = "changed"; },
    (value) => { value.data_boundary.corporate_action_reconciliation_ready = true; },
    (value) => { value.data_boundary.provider_outcome_price_reconciliation_ready = true; },
    (value) => { value.inference.primary_endpoint = "changed"; },
    (value) => { value.inference.null_hypothesis = "changed"; },
    (value) => { value.inference.test = "changed"; },
    (value) => { value.inference.sample_definition = "changed"; },
    (value) => { value.inference.p_value_construction = "changed"; },
    (value) => { value.inference.secondary_comparators.reverse(); },
    (value) => { value.inference.multiplicity = "changed"; },
    (value) => { value.external_anchoring.settlement_gate = "OPEN"; },
  ];
  for (const mutate of mutations) { const value = clone(protocol); mutate(value); assert.throws(() => validateForwardTrialProtocol(value)); }
  const formula = clone(protocol); formula.formula_bindings.benchmark_spy_buy_hold.definition = "Changed definition."; formula.formula_bindings.benchmark_spy_buy_hold.binding_sha256 = hashForwardTrialEntryBody({ formula_id: "benchmark_spy_buy_hold", definition: formula.formula_bindings.benchmark_spy_buy_hold.definition, source_files: formula.formula_bindings.benchmark_spy_buy_hold.source_files }); assert.throws(() => validateForwardTrialProtocol(formula), /formula benchmark_spy_buy_hold metadata mismatch/);
});

test("symlink aliases and symlinked ledger parents cannot redirect persistent state", async () => {
  const aliasParent = await mkdtemp(resolve(tmpdir(), "finly-v2-alias-"));
  try { const alias = resolve(aliasParent, "alias"); await symlink(projectRoot, alias, "dir"); await assert.rejects(() => verifyForwardTrialLedger({ projectRoot: alias, now: FAR_CLOCK }), /clock override is forbidden/); } finally { await rm(aliasParent, { recursive: true }); }
  const { root } = await tempProject(); const outside = await mkdtemp(resolve(tmpdir(), "finly-v2-outside-"));
  try { await symlink(outside, resolve(root, "research/forward_trial1_ledger"), "dir"); await assert.rejects(() => verifyForwardTrialLedger({ projectRoot: root, now: FAR_CLOCK }), /settlement directory must be a local non-symlink/); } finally { await rm(root, { recursive: true }); await rm(outside, { recursive: true }); }
});

test("252 fully reconciled synthetic settlements yield only a stable TEST_ONLY diagnostic; row 253 cannot change it", async () => {
  const { root, protocol, genesis } = await tempProject({ synthetic: true }); const commitments = []; let previousCommitment = null;
  for (let sequence = 1; sequence <= 255; sequence += 1) { const entry = commitment({ protocol, genesis, previousCommitment, sequence }); commitments.push(entry); previousCommitment = entry; await writeEntry(resolve(root, protocol.genesis.commitment_directory), entry, "commitment_sha256"); }
  let previousSettlement = null;
  for (let sequence = 1; sequence <= 252; sequence += 1) { const input = buildForwardTrialSettlementInputForTest({ protocol, previousSettlement, signalCommitment: commitments[sequence - 1], startPriceCommitment: commitments[sequence], endPriceCommitment: commitments[sequence + 1], capturedAt: after(commitments[sequence + 1].payload.timeline.signal_bar_eligible_at, 5), now: FAR_CLOCK }); const entry = buildForwardTrialSettlementForTest(input, { protocol, genesis, previousSettlement, signalCommitment: commitments[sequence - 1], startPriceCommitment: commitments[sequence], endPriceCommitment: commitments[sequence + 1], now: FAR_CLOCK }); await writeEntry(resolve(root, protocol.genesis.settlement_directory), entry, "settlement_sha256"); previousSettlement = entry; }
  const first = await verifyForwardTrialLedger({ projectRoot: root, now: FAR_CLOCK }); assert.equal(first.environment, "TEST_ONLY"); assert.equal(first.production_seed_available, false); assert.equal(first.performance_inference_permitted, false); assert.equal(first.primary_inference, null); assert.equal(first.test_only_diagnostic_calculation.sessions_used, 252); assert.equal(first.test_only_diagnostic_calculation.performance_claim_permitted, false); assert.equal(first.test_only_diagnostic_calculation.observed_mean_daily_log_return_difference, -0.00008800086344987423); assert.equal(first.test_only_diagnostic_calculation.exceedances, 4999); assert.equal(first.test_only_diagnostic_calculation.one_sided_p_value, 1); assert.equal(first.test_only_diagnostic_calculation.result_sha256, "sha256:92dc0373e7fc872679f606caa0dbc2b02b8d25009c1c47e10995007b986420d0"); const frozenResult = first.test_only_diagnostic_calculation.result_sha256;
  const input = buildForwardTrialSettlementInputForTest({ protocol, previousSettlement, signalCommitment: commitments[252], startPriceCommitment: commitments[253], endPriceCommitment: commitments[254], capturedAt: after(commitments[254].payload.timeline.signal_bar_eligible_at, 5), now: FAR_CLOCK }); const entry = buildForwardTrialSettlementForTest(input, { protocol, genesis, previousSettlement, signalCommitment: commitments[252], startPriceCommitment: commitments[253], endPriceCommitment: commitments[254], now: FAR_CLOCK }); await writeEntry(resolve(root, protocol.genesis.settlement_directory), entry, "settlement_sha256");
  const second = await verifyForwardTrialLedger({ projectRoot: root, now: FAR_CLOCK }); assert.equal(second.verified_settlements, 253); assert.equal(second.test_only_diagnostic_calculation.result_sha256, frozenResult);
  await rm(root, { recursive: true });
});
