import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  assessCostStressRecords,
  assessSourceOverlapEvidence,
  buildPairedRows,
  COMPARATOR_IDS,
  COST_LEVELS_BPS,
  distinguishFromStaticControl,
  FIXED_CANDIDATE_ID,
  GENERATION4_ELIGIBLE_IDS,
  REQUIRED_SOURCE_OVERLAP_SYMBOLS,
  validateRobustnessProtocol,
  validateFrozenSelection,
} from "../research/run_quant_champion_generation4_robustness.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

function costRecord(cost, development = true, validation = true) {
  return {
    cost_bps: cost,
    gates: {
      development_spy_edge_positive: development,
      validation_spy_edge_positive: validation,
    },
  };
}

function syntheticSimulation(id, returns, weights = { SPY: 1, BIL: 0 }) {
  return {
    id,
    rows: returns.map((netReturn, index) => ({
      signal_date: `2020-01-${String(index + 1).padStart(2, "0")}`,
      rebalance_date: `2020-01-${String(index + 2).padStart(2, "0")}`,
      execution_return_date: `2020-01-${String(index + 3).padStart(2, "0")}`,
      rebalanced: true,
      signal_weights: weights,
      weights,
      asset_returns: { SPY: netReturn, BIL: 0 },
      cash_return: 0,
      gross_return: netReturn,
      transaction_cost: 0,
      financing_spread_cost: 0,
      turnover_notional: 0,
      net_return: netReturn,
    })),
  };
}

test("frozen selection validation pins the only permitted post-selection candidate", () => {
  assert.equal(GENERATION4_ELIGIBLE_IDS.length, 7);
  assert.equal(GENERATION4_ELIGIBLE_IDS.includes("static_spy_qqq_50_50_control"), false);
  const report = {
    schema_version: "finly_quant_champion_generation4.v1",
    raw_return_track: {
      selected_id_before_recent_and_robustness: FIXED_CANDIDATE_ID,
      recent_veto: { applicable: true, hard_safety_veto: false },
    },
    balanced_track: { selected_id_before_recent_and_robustness: null },
    disposition: "RAW_RETURN_ROBUSTNESS_PENDING",
  };
  const protocol = { trial_accounting: { cumulative_effective_trials: 100 } };
  const ledger = { append_only_through: 100 };
  assert.equal(validateFrozenSelection(report, protocol, ledger).passes, true);
  assert.equal(validateFrozenSelection({
    ...report,
    raw_return_track: { ...report.raw_return_track, selected_id_before_recent_and_robustness: "another_candidate" },
  }, protocol, ledger).passes, false);
  assert.equal(validateFrozenSelection({ ...report, disposition: "RAW_RETURN_SHADOW_ONLY" }, protocol, ledger).passes, false);
});

test("post-selection protocol locks every cost, anchor, statistical, comparator, and consumed-data definition", async () => {
  const protocol = JSON.parse(await readFile(
    resolve(projectRoot, "research/champion_generation4_robustness_protocol.json"),
    "utf8",
  ));
  assert.deepEqual(validateRobustnessProtocol(protocol), { passes: true, reasons: [] });
  assert.equal(validateRobustnessProtocol({
    ...protocol,
    statistical_gate: { ...protocol.statistical_gate, slice: "development_and_validation" },
  }).passes, false);
  assert.equal(validateRobustnessProtocol({
    ...protocol,
    data_and_execution: { ...protocol.data_and_execution, cost_levels_bps: [5, 25] },
  }).passes, false);
  assert.deepEqual(COMPARATOR_IDS, [
    "spy_buy_hold",
    "qqq_buy_hold",
    "frozen_finly",
    "spy_vol_target_15",
    "static_spy_qqq_50_50_control",
  ]);
  assert.deepEqual(protocol.comparators, COMPARATOR_IDS);
  assert.deepEqual(protocol.source_overlap.required_symbols, REQUIRED_SOURCE_OVERLAP_SYMBOLS);
  assert.equal(protocol.source_overlap.result_known_at_robustness_refreeze, true);
  assert.equal(protocol.source_overlap.known_result_disposition, "FAIL_CLOSED");
});

test("cost stress requires 5/10/25 bp coverage and fails if either consumed selection slice loses its sign", () => {
  const passing = assessCostStressRecords(COST_LEVELS_BPS.map((cost) => costRecord(cost)));
  assert.equal(passing.complete_coverage, true);
  assert.equal(passing.raw_spy_edge_keeps_sign_at_every_cost, true);

  const signFailure = assessCostStressRecords([
    costRecord(5),
    costRecord(10),
    costRecord(25, true, false),
  ]);
  assert.equal(signFailure.complete_coverage, true);
  assert.equal(signFailure.raw_spy_edge_keeps_sign_at_every_cost, false);

  const missing = assessCostStressRecords([costRecord(5), costRecord(10)]);
  assert.equal(missing.complete_coverage, false);
  assert.deepEqual(missing.missing_costs_bps, [25]);
  assert.equal(missing.raw_spy_edge_keeps_sign_at_every_cost, false);
});

test("source overlap fails closed when absent, mismatched, partial, or failed", () => {
  const symbols = ["SPY", "QQQ"];
  const panelHash = "a".repeat(64);
  const outputHash = "b".repeat(64);
  const generation4ProtocolHash = "c".repeat(64);
  assert.equal(assessSourceOverlapEvidence(
    null,
    panelHash,
    symbols,
    outputHash,
    generation4ProtocolHash,
  ).passes, false);
  const base = {
    schema_version: "finly_generation4_source_overlap_reconciliation.v1",
    protocol_sha256: "306f49f6632ed58c3e9ea446d87c1c28fc0a0d13b188cfa276f83f7cbbb0652d",
    generation4_panel_sha256: panelHash,
    generation4_output_sha256: outputHash,
    generation4_protocol_sha256: generation4ProtocolHash,
    candidate_id: FIXED_CANDIDATE_ID,
    disposition: "PASS",
    alpaca_split_source: {
      provider: "Alpaca Market Data API",
      origin: "https://data.alpaca.markets",
      path: "/v2/stocks/bars",
      feed: "iex",
      adjustment: "split",
      authenticated_read_only_get: true,
    },
    alpaca_all_source: {
      provider: "Alpaca Market Data API",
      origin: "https://data.alpaca.markets",
      path: "/v2/stocks/bars",
      feed: "iex",
      adjustment: "all",
      authenticated_read_only_get: true,
    },
    reconciliation: {
      passed: true,
      candidate: { passed: true },
      per_symbol: { SPY: { passed: true }, QQQ: { passed: true } },
    },
  };
  const assess = (evidence) => assessSourceOverlapEvidence(
    evidence,
    panelHash,
    symbols,
    outputHash,
    generation4ProtocolHash,
  );
  assert.equal(assess(base).passes, true);
  assert.equal(assess({ ...base, generation4_panel_sha256: "d".repeat(64) }).passes, false);
  assert.equal(assess({
    ...base,
    reconciliation: { ...base.reconciliation, per_symbol: { SPY: { passed: true } } },
  }).passes, false);
  assert.equal(assessSourceOverlapEvidence({
    ...base,
    reconciliation: {
      ...base.reconciliation,
      per_symbol: { SPY: { passed: true }, QQQ: { passed: false } },
    },
  }, panelHash, symbols, outputHash, generation4ProtocolHash).passes, false);
  assert.equal(assess({ ...base, disposition: "FAIL_CLOSED" }).passes, false);
  assert.equal(assess({ ...base, generation4_output_sha256: "e".repeat(64) }).passes, false);
  assert.equal(assess({
    ...base,
    alpaca_split_source: { ...base.alpaca_split_source, authenticated_read_only_get: false },
  }).passes, false);
});

test("paired rows are standalone, aligned, and reject a shifted comparison", () => {
  const candidate = syntheticSimulation("candidate", [0.01, -0.01, 0.02]);
  const benchmark = syntheticSimulation("benchmark", [0.005, -0.005, 0.01]);
  const simulations = new Map([[candidate.id, candidate], [benchmark.id, benchmark]]);
  const slice = { start: "2020-01-03", end: "2020-01-05" };
  const rows = buildPairedRows(simulations, [candidate.id, benchmark.id], slice, 5);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].strategies.candidate.net_return, 0.009);
  assert.equal(rows.at(-1).strategies.candidate.net_return, 0.0195);

  const shifted = structuredClone(benchmark);
  shifted.rows[1].execution_return_date = "2020-01-09";
  assert.throws(
    () => buildPairedRows(new Map([[candidate.id, candidate], [benchmark.id, shifted]]), [candidate.id, benchmark.id], slice, 5),
    /misaligned|too few rows|different length/,
  );
});

test("mechanical growth-control distinction requires changing targets and a noncore asset", () => {
  const dates = ["2020-01-01", "2020-02-01", "2020-03-01"];
  const controlRows = dates.map((signalDate) => ({
    signal_date: signalDate,
    rebalanced: true,
    signal_weights: { SPY: 0.5, QQQ: 0.5, BIL: 0, XLK: 0, XLF: 0 },
  }));
  const candidateRows = dates.map((signalDate, index) => ({
    signal_date: signalDate,
    rebalanced: true,
    signal_weights: index === 0
      ? { SPY: 0, QQQ: 0.5, BIL: 0, XLK: 0.5, XLF: 0 }
      : { SPY: 0, QQQ: 0.5, BIL: 0, XLK: 0, XLF: 0.5 },
  }));
  const evidence = distinguishFromStaticControl(candidateRows, controlRows);
  assert.equal(evidence.mechanically_distinct, true);
  assert.equal(evidence.unique_candidate_target_allocations, 2);
  assert.deepEqual(evidence.noncore_assets_used, ["XLF", "XLK"]);
  assert.ok(evidence.average_target_l1_distance_from_static_control > 0);
  assert.equal(distinguishFromStaticControl(controlRows, controlRows).mechanically_distinct, false);
});
