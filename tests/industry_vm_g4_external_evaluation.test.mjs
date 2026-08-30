import assert from "node:assert/strict";
import test from "node:test";

import {
  INDUSTRY_VM_G4_BONFERRONI_THRESHOLD,
  INDUSTRY_VM_G4_BOOTSTRAP_RESAMPLES,
  INDUSTRY_VM_G4_BOOTSTRAP_SEED,
  INDUSTRY_VM_G4_CADENCE_ANCHORS,
  INDUSTRY_VM_G4_COST_BPS,
  INDUSTRY_VM_G4_EXPECTED_BLOCK_SESSIONS,
  INDUSTRY_VM_G4_EXTERNAL_INTEGRITY_INPUTS,
  INDUSTRY_VM_G4_GATE_NAMES,
  INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT,
  INDUSTRY_VM_G4_MAX_AGGREGATE_BYTES,
  INDUSTRY_VM_G4_MAX_PRIMARY_SERIES_BYTES,
  INDUSTRY_VM_G4_OVERLAP_START,
  INDUSTRY_VM_G4_PRIMARY_END,
  evaluateIndustryVmG4External,
  industryVmG4DeflatedSharpe,
  runIndustryVmG4StationaryBootstrap,
} from "../research/industry_vm_g4_external/evaluation.mjs";
import {
  KENNETH_FRENCH_10_INDUSTRY_FACTOR_ADAPTER_SCHEMA,
  KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS,
} from "../research/industry_vm_g4_external/source.mjs";

function oscillatingFixture(count, shift = 0) {
  return Array.from({ length: count }, (_, index) => (
    shift
    + 0.00018 * Math.sin(index / 7)
    + 0.00007 * Math.cos(index / 23)
  ));
}

function businessDates(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function syntheticAdaptedPanel() {
  const dates = businessDates("2004-01-02", "2009-12-31");
  const levels = Object.fromEntries(
    KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.map((symbol) => [symbol, 100]),
  );
  const industryDrifts = {
    NoDur: 0.00022,
    Durbl: 0.00040,
    Manuf: 0.00031,
    Enrgy: 0.00036,
    HiTec: 0.00072,
    Telcm: 0.00028,
    Shops: 0.00048,
    Hlth: 0.00044,
    Utils: 0.00016,
    Other: 0.00025,
    MARKET: 0.00020,
    RF: 0.00003,
  };
  const points = dates.map((date, index) => {
    for (const [symbol, drift] of Object.entries(industryDrifts)) {
      const commonShock = 0.00035 * Math.sin(index / 9)
        + 0.00020 * Math.cos(index / 31);
      const idiosyncratic = symbol === "RF"
        ? 0
        : 0.00012 * Math.sin((index + symbol.length * 11) / (5 + symbol.length));
      const dailyReturn = symbol === "RF"
        ? drift
        : drift + commonShock + idiosyncratic;
      levels[symbol] *= 1 + dailyReturn;
    }
    return Object.freeze({ date, ...levels });
  });
  return Object.freeze({
    schema_version: KENNETH_FRENCH_10_INDUSTRY_FACTOR_ADAPTER_SCHEMA,
    source_return_units: "percent simple daily returns",
    panel_level_units: "synthetic positive compounded indices",
    market_identity: "MARKET = (Mkt-RF + RF) / 100",
    cash_and_financing_symbol: "RF",
    symbols: Object.freeze([...KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS]),
    exact_date_rows: points.length,
    points: Object.freeze(points),
  });
}

function integrityInputs(value = true) {
  return Object.fromEntries(INDUSTRY_VM_G4_EXTERNAL_INTEGRITY_INPUTS.map((name) => [name, value]));
}

test("industry external bootstrap is deterministic and frozen to effective N=200", () => {
  const values = oscillatingFixture(731, 0.001);
  const first = runIndustryVmG4StationaryBootstrap(values);
  const second = runIndustryVmG4StationaryBootstrap(structuredClone(values));

  assert.deepEqual(first, second);
  assert.equal(INDUSTRY_VM_G4_BOOTSTRAP_SEED, 20260830);
  assert.equal(INDUSTRY_VM_G4_BOOTSTRAP_RESAMPLES, 4_999);
  assert.equal(INDUSTRY_VM_G4_EXPECTED_BLOCK_SESSIONS, 20);
  assert.equal(INDUSTRY_VM_G4_GLOBAL_TRIAL_COUNT, 200);
  assert.equal(INDUSTRY_VM_G4_BONFERRONI_THRESHOLD, 0.05 / 200);
  assert.equal(first.seed_uint32, 20260830);
  assert.equal(first.resamples, 4_999);
  assert.equal(first.expected_block_sessions, 20);
  assert.equal(first.restart_probability, 0.05);
  assert.equal(first.nominal_one_sided_p_value, 0.0002);
  assert.equal(first.passes_nominal_gate, true);
  assert.equal(first.passes_bonferroni_gate, true);
  assert.ok(Object.isFrozen(first));
});

test("bootstrap equality fails closed and DSR uses the same 200-trial family", () => {
  const zero = runIndustryVmG4StationaryBootstrap(Array(127).fill(0));
  assert.equal(zero.exceedances, 4_999);
  assert.equal(zero.nominal_one_sided_p_value, 1);
  assert.equal(zero.passes_nominal_gate, false);
  assert.equal(zero.passes_bonferroni_gate, false);

  const dsr = industryVmG4DeflatedSharpe(oscillatingFixture(731, 0.001));
  assert.equal(dsr.global_trial_count, 200);
  assert.equal(dsr.empirical_trial_sharpe_distribution_used, false);
  assert.match(dsr.method, /parametric null-maximum/iu);
  assert.equal(dsr.disposition, "FINITE");
  assert.equal(dsr.passes_gate, true);
  assert.ok(dsr.probability >= 0.95 && dsr.probability <= 1);

  const constant = industryVmG4DeflatedSharpe(Array(80).fill(0.001));
  assert.equal(constant.probability, null);
  assert.equal(constant.passes_gate, false);
  assert.equal(constant.disposition, "GATE_FAILS_CLOSED");
});

test("synthetic evaluation returns aggregates plus only the frozen primary pair", { timeout: 60_000 }, () => {
  const evaluated = evaluateIndustryVmG4External(syntheticAdaptedPanel(), {
    integrityInputs: integrityInputs(true),
  });

  assert.deepEqual(Object.keys(evaluated).sort(), [
    "aggregate",
    "output_size_guard",
    "primary_paired_series",
  ]);
  assert.equal(evaluated.aggregate.primary_cost_cells.length, INDUSTRY_VM_G4_COST_BPS.length);
  assert.equal(
    evaluated.aggregate.cadence_5bp_cells.length,
    INDUSTRY_VM_G4_CADENCE_ANCHORS.length,
  );
  assert.deepEqual(
    Object.keys(evaluated.aggregate.gates),
    [...INDUSTRY_VM_G4_GATE_NAMES],
  );
  assert.deepEqual(Object.keys(evaluated.aggregate.comparators).sort(), [
    "mapping_b_non_rescuing",
    "rf_cash",
    "unscaled_primary_a",
    "volatility_matched_market",
  ]);
  assert.equal(evaluated.aggregate.diagnostic_mapping_b_role, "NON_RESCUING");
  assert.ok(evaluated.aggregate.primary_cost_cells.every((cell) => (
    cell.benchmark.rebalanced_observations === 1
  )));
  const marketPath = evaluated.aggregate.cadence_5bp_cells[0].benchmark_path_sha256;
  assert.ok(evaluated.aggregate.cadence_5bp_cells.every((cell) => (
    cell.benchmark_path_sha256 === marketPath
    && cell.benchmark.rebalanced_observations === 1
  )));
  assert.equal(
    evaluated.primary_paired_series.rows.length,
    evaluated.aggregate.partitions.primary_unseen.candidate.observations,
  );
  assert.ok(evaluated.primary_paired_series.rows.every((row) => (
    row.outcome_date <= INDUSTRY_VM_G4_PRIMARY_END
  )));
  assert.ok(evaluated.aggregate.partitions.overlap_diagnostic_non_rescuing.candidate.start_date
    >= INDUSTRY_VM_G4_OVERLAP_START);
  assert.equal(evaluated.output_size_guard.full_cartesian_grid_persisted, false);
  assert.equal(evaluated.output_size_guard.passed, true);
  assert.equal(
    evaluated.aggregate.gates.integrity.checks.exact_terminal_liquidation,
    true,
  );
  assert.ok(evaluated.output_size_guard.aggregate_bytes <= INDUSTRY_VM_G4_MAX_AGGREGATE_BYTES);
  assert.ok(
    evaluated.output_size_guard.primary_series_bytes
      <= INDUSTRY_VM_G4_MAX_PRIMARY_SERIES_BYTES,
  );
  assert.equal("rows" in evaluated.aggregate.partitions.primary_unseen, false);
  assert.ok(Object.isFrozen(evaluated));
  assert.ok(Object.isFrozen(evaluated.aggregate));
  assert.ok(Object.isFrozen(evaluated.primary_paired_series.rows));
});

test("an externally failed integrity check cannot be rescued by performance", { timeout: 60_000 }, () => {
  const checks = integrityInputs(true);
  checks.official_source_identity_and_receipt = false;
  const evaluated = evaluateIndustryVmG4External(syntheticAdaptedPanel(), {
    integrityInputs: checks,
  });

  assert.equal(
    evaluated.aggregate.gates.integrity.checks.official_source_identity_and_receipt,
    false,
  );
  assert.equal(evaluated.aggregate.gates.integrity.passed, false);
  assert.equal(evaluated.aggregate.all_nine_gates_passed, false);
});

test("evaluation and inference reject malformed synthetic inputs", () => {
  assert.throws(
    () => runIndustryVmG4StationaryBootstrap(Array(40).fill(0)),
    /at least 41 values/iu,
  );
  const malformed = oscillatingFixture(60);
  malformed[11] = Number.NaN;
  assert.throws(
    () => runIndustryVmG4StationaryBootstrap(malformed),
    /paired value 12 must be finite/iu,
  );
  assert.throws(
    () => evaluateIndustryVmG4External(syntheticAdaptedPanel(), {
      integrityInputs: { protocol_self_hash: true },
    }),
    /must contain exactly/iu,
  );
});
