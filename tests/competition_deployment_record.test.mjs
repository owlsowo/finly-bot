import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../lib/canonical.mjs";
import { assertCompetitionForwardProfitContract } from "../lib/competition_forward_profit.mjs";
import { assertG4OfficialProductionProtocol } from "../lib/g4_official_equity.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function raw(path) {
  return readFile(resolve(projectRoot, path), "utf8");
}

function exactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function bodyHash(value, hashKey) {
  const body = structuredClone(value);
  delete body[hashKey];
  return sha256(body);
}

async function sourceFiles(directory) {
  const root = resolve(projectRoot, directory);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath ?? entry.path, entry.name))
    .filter((path) => [".js", ".mjs", ".cjs", ".ts", ".tsx", ".yml", ".yaml"].includes(extname(path)));
}

test("competition deployment record is an exact, mirrored, non-authorizing scope declaration", async () => {
  const [canonicalBytes, publicBytes] = await Promise.all([
    raw("config/competition-deployment-record.json"),
    raw("public/data/competition-deployment-record.json"),
  ]);
  assert.equal(publicBytes, canonicalBytes);

  const record = JSON.parse(canonicalBytes);
  exactKeys(record, [
    "schema_version", "record_id", "recorded_at", "record_character", "decision",
    "scope_boundary", "evidence", "authority", "record_hash",
  ]);
  exactKeys(record.decision, [
    "selected_by_role", "decision_class", "selected_protocol_id", "paper_only", "window",
  ]);
  exactKeys(record.decision.window, ["start_at", "end_at"]);
  exactKeys(record.scope_boundary, [
    "research_claim_authority", "g4_research_disposition", "general_production_v1_policy_id",
    "general_production_v1_superseded", "operator_selection_is_research_promotion",
    "outside_window_authority", "forward_performance_status",
  ]);
  exactKeys(record.evidence, [
    "repository_commit", "repository_commit_at", "research_gate", "competition_protocol",
    "forward_score_contract",
  ]);
  exactKeys(record.evidence.research_gate, [
    "path", "public_mirror_path", "schema_version", "artifact_sha256", "raw_bytes_sha256",
    "evidence_as_of",
  ]);
  exactKeys(record.evidence.competition_protocol, [
    "path", "schema_version", "protocol_id", "protocol_hash", "raw_bytes_sha256",
  ]);
  exactKeys(record.evidence.forward_score_contract, [
    "path", "schema_version", "contract_id", "contract_hash", "raw_bytes_sha256",
  ]);
  exactKeys(record.authority, ["claim_override", "runtime_configuration", "broker_mutation"]);

  assert.equal(record.schema_version, "finly_competition_deployment_record.v1");
  assert.equal(record.record_character, "PRE_WINDOW_SCOPE_DECLARATION");
  assert.equal(record.record_hash, bodyHash(record, "record_hash"));
  assert.equal(record.decision.selected_by_role, "HUMAN_OPERATOR");
  assert.equal(record.decision.decision_class, "TIME_BOUNDED_PAPER_COMPETITION_DEPLOYMENT");
  assert.equal(record.decision.paper_only, true);
  assert.deepEqual(record.authority, {
    claim_override: false,
    runtime_configuration: false,
    broker_mutation: false,
  });
  assert.equal(record.scope_boundary.general_production_v1_superseded, false);
  assert.equal(record.scope_boundary.operator_selection_is_research_promotion, false);
  assert.equal(record.scope_boundary.outside_window_authority, "NONE");
  assert.equal(record.scope_boundary.forward_performance_status, "UNOBSERVED_AT_RECORDING");

  const forbiddenPayload = /\b(?:allocations?|returns?|p[_-]?values?|account[_-]?ids?|order[_-]?ids?|credentials?|api[_-]?keys?|secrets?|tokens?|passwords?)\b/iu;
  assert.doesNotMatch(canonicalBytes, forbiddenPayload);
});

test("deployment record binds the unchanged research gate, competition protocol, and forward scorer", async () => {
  const record = JSON.parse(await raw("config/competition-deployment-record.json"));
  const gateEvidence = record.evidence.research_gate;
  const protocolEvidence = record.evidence.competition_protocol;
  const contractEvidence = record.evidence.forward_score_contract;

  const [gateBytes, gatePublicBytes, protocolBytes, contractBytes, sourceSignalBytes, baselineBytes] =
    await Promise.all([
      raw(gateEvidence.path),
      raw(gateEvidence.public_mirror_path),
      raw(protocolEvidence.path),
      raw(contractEvidence.path),
      raw("config/g4-official-source-signal.json"),
      raw("config/competition-forward-profit-activity-baseline.json"),
    ]);
  assert.equal(gateBytes, gatePublicBytes);
  assert.equal(sha256(gateBytes), gateEvidence.raw_bytes_sha256);
  assert.equal(sha256(protocolBytes), protocolEvidence.raw_bytes_sha256);
  assert.equal(sha256(contractBytes), contractEvidence.raw_bytes_sha256);

  const gate = JSON.parse(gateBytes);
  const protocol = JSON.parse(protocolBytes);
  const contract = JSON.parse(contractBytes);
  const sourceSignal = JSON.parse(sourceSignalBytes);
  const baseline = JSON.parse(baselineBytes);

  assert.equal(gate.schema_version, gateEvidence.schema_version);
  assert.equal(gate.artifact_sha256, gateEvidence.artifact_sha256);
  assert.equal(gate.artifact_sha256, bodyHash(gate, "artifact_sha256"));
  assert.equal(gate.evidence_as_of, gateEvidence.evidence_as_of);
  assert.equal(gate.conclusions.g4_rejected_post_selection.disposition, "REJECTED_NOT_PROMOTED");
  assert.equal(gate.conclusions.production_v1_execution_realism.policy_id, "tsmom_ensemble_vol");
  assert.ok(gate.allowed_claims.includes(
    "In the consumed, post-selected 2013-01-02–2026-08-27 retrospective replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%; promotion was rejected because the Deflated Sharpe probability was 3.75% and the worst familywise-adjusted p-value was 37.18%.",
  ));
  assert.ok(gate.forbidden_claims.includes("G4 is validated, promoted, or evidence of future market superiority."));

  assert.equal(assertG4OfficialProductionProtocol(protocol), protocol);
  assert.equal(protocol.schema_version, protocolEvidence.schema_version);
  assert.equal(protocol.protocol_id, protocolEvidence.protocol_id);
  assert.equal(protocol.protocol_hash, protocolEvidence.protocol_hash);
  assert.equal(sha256(sourceSignal), protocol.source_signal.signal_sha256);
  assert.equal(sourceSignal.source_panel.source_panel_sha256, protocol.source_signal.source_panel_sha256);

  assert.equal(assertCompetitionForwardProfitContract(contract), contract);
  assert.equal(contract.schema_version, contractEvidence.schema_version);
  assert.equal(contract.contract_id, contractEvidence.contract_id);
  assert.equal(contract.contract_hash, contractEvidence.contract_hash);
  assert.equal(contract.production_protocol.protocol_id, protocol.protocol_id);
  assert.equal(contract.production_protocol.protocol_hash, protocol.protocol_hash);

  assert.equal(baseline.baseline_id, contract.activity_baseline.baseline_id);
  assert.equal(baseline.baseline_hash, contract.activity_baseline.baseline_hash);
  assert.equal(baseline.baseline_hash, bodyHash(baseline, "baseline_hash"));
  assert.equal(sha256(baselineBytes),
    "sha256:140d64e3b078d7c18cfb4a9130b728357ca6fca8423b8c813501ed46fc40af0b");

  assert.equal(record.decision.selected_protocol_id, protocol.protocol_id);
  assert.deepEqual(record.decision.window, protocol.competition_window);
  assert.equal(record.decision.window.start_at, contract.competition_window.start_at);
  assert.equal(record.decision.window.end_at, contract.competition_window.end_at);
  assert.ok(Date.parse(gate.evidence_as_of) < Date.parse(protocol.frozen_at));
  assert.ok(Date.parse(protocol.frozen_at) < Date.parse(record.recorded_at));
  assert.ok(Date.parse(record.recorded_at) < Date.parse(record.decision.window.start_at));
});

test("runtime code and workflows do not consume the deployment record", async () => {
  const runtimeEntrypoints = [
    "scripts/autonomous_paper_agent.mjs",
    "scripts/build_competition_live_snapshot.mjs",
    "scripts/cloud_run_gate.mjs",
    "scripts/cloud_state.mjs",
    "scripts/featherless_readiness_check.mjs",
    "scripts/paper_healthcheck.mjs",
    "scripts/run_competition_forward_profit.mjs",
  ].map((path) => resolve(projectRoot, path));
  const paths = (await Promise.all([
    sourceFiles("lib"),
    sourceFiles(".github/workflows"),
  ])).flat().concat(runtimeEntrypoints);
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /competition-deployment-record/u, path);
  }
});
