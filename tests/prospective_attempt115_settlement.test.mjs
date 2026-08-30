import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import { importImmutableOhlc } from "../research/equity_execution_realism.mjs";
import { simulateProspectivePolicyNextOpen } from "../research/downside_semivolatility_challenger.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
} from "../research/prospective_attempt115/policy.mjs";
import {
  ATTEMPT115_REQUIRED_INTERVALS,
  ATTEMPT115_REQUIRED_SOURCE_BUNDLES,
  buildAttempt115PairedSettlementWindow,
  validateAttempt115PairedSettlementWindow,
  validateAttempt115PairedSettlementWindowAgainstProjections,
  validateAttempt115SourceProjection,
} from "../research/prospective_attempt115/settlement.mjs";
import {
  makeAttempt115SourceProjections,
  rehashProjection,
} from "./prospective_attempt115_fixtures.mjs";

const SOURCES = makeAttempt115SourceProjections();
const WINDOW = buildAttempt115PairedSettlementWindow({ sources: SOURCES });

function round(value, places = 10) {
  const scale = 10 ** places;
  const result = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function importedSyntheticWindow() {
  const adjusted = Object.fromEntries(["SPY", "BIL"].map((symbol) => {
    const history = SOURCES[0].target_input_points.map((point) => ({
      date: point.date,
      open: point[symbol],
      close: point[symbol],
    }));
    const outcomes = SOURCES.slice(1).map((source) => {
      const bar = source.outcome_ohlc.adjusted[symbol][1];
      return { date: bar.date, open: bar.open, close: bar.close };
    });
    return [symbol, [...history, ...outcomes]];
  }));
  return importImmutableOhlc({
    adjusted,
    raw: structuredClone(adjusted),
    provenance: { source: "Attempt 115 deterministic fixture" },
  });
}

test("Attempt 115 accepts only the exact 253-source prospective chain", () => {
  assert.equal(SOURCES.length, ATTEMPT115_REQUIRED_SOURCE_BUNDLES);
  assert.equal(SOURCES[0].signal_session_date, "2026-08-31");
  assert.equal(SOURCES[1].signal_session_date, "2026-09-01");
  assert.throws(
    () => buildAttempt115PairedSettlementWindow({ sources: SOURCES.slice(0, -1) }),
    /exactly 253/iu,
  );

  const reordered = [...SOURCES];
  [reordered[20], reordered[21]] = [reordered[21], reordered[20]];
  assert.throws(
    () => buildAttempt115PairedSettlementWindow({ sources: reordered }),
    /missing, duplicated, or reordered|skips, backfills/iu,
  );

  const forked = SOURCES.map((item) => structuredClone(item));
  forked[40].source.previous_private_bundle_sha256 = sha256("fork");
  forked[40] = rehashProjection(forked[40]);
  assert.throws(
    () => buildAttempt115PairedSettlementWindow({ sources: forked }),
    /skips, backfills, forks, or rewrites/iu,
  );
});

test("every policy target is rederived from the committed close inputs with zero override", () => {
  const source = structuredClone(SOURCES[15]);
  source.policy_targets[ATTEMPT115_CHALLENGER_POLICY_ID].SPY *= 0.5;
  source.policy_targets[ATTEMPT115_CHALLENGER_POLICY_ID].BIL =
    1 - source.policy_targets[ATTEMPT115_CHALLENGER_POLICY_ID].SPY;
  const forged = rehashProjection(source);
  assert.throws(
    () => validateAttempt115SourceProjection(forged),
    /target override/iu,
  );

  const laterChanged = structuredClone(SOURCES[16]);
  laterChanged.target_input_points[0].SPY *= 2;
  const wrongHash = rehashProjection(laterChanged);
  assert.throws(
    () => validateAttempt115SourceProjection(wrongHash),
    /target-input hash|target override|diagnostics changed/iu,
  );
});

test("paired next-open accounting is complete, fixed, and identically anchored", () => {
  validateAttempt115PairedSettlementWindow(WINDOW);
  assert.equal(WINDOW.sample.source_bundles, ATTEMPT115_REQUIRED_SOURCE_BUNDLES);
  assert.equal(WINDOW.sample.paired_intervals, ATTEMPT115_REQUIRED_INTERVALS);
  assert.equal(WINDOW.matrix.cell_count, 40);
  assert.equal(WINDOW.cells.length, 40);
  assert.equal(WINDOW.primary_cell_id, "adjusted_anchor0_cost5bps");
  assert.equal(WINDOW.inference, null);
  assert.equal(WINDOW.interim_inference_permitted, false);
  assert.equal(WINDOW.incumbent_modification_or_promotion_permitted, false);

  for (const cell of WINDOW.cells) {
    const incumbent = cell.rows[ATTEMPT115_INCUMBENT_POLICY_ID];
    const challenger = cell.rows[ATTEMPT115_CHALLENGER_POLICY_ID];
    assert.equal(incumbent.length, ATTEMPT115_REQUIRED_INTERVALS);
    assert.equal(challenger.length, ATTEMPT115_REQUIRED_INTERVALS);
    for (let index = 0; index < ATTEMPT115_REQUIRED_INTERVALS; index += 1) {
      assert.equal(incumbent[index].signal_date, challenger[index].signal_date);
      assert.equal(incumbent[index].execution_date, challenger[index].execution_date);
      assert.equal(incumbent[index].rebalanced, challenger[index].rebalanced);
      assert.equal(incumbent[index].spy_return, challenger[index].spy_return);
      assert.equal(incumbent[index].bil_return, challenger[index].bil_return);
    }
  }
});

test("the primary cell uses self-financing drift and exactly five bps per absolute leg", () => {
  const primary = WINDOW.cells.find(({ cell_id: id }) => id === WINDOW.primary_cell_id);
  for (const policyId of [ATTEMPT115_INCUMBENT_POLICY_ID, ATTEMPT115_CHALLENGER_POLICY_ID]) {
    const rows = primary.rows[policyId];
    assert.equal(rows[0].rebalanced, true);
    assert.equal(rows[1].rebalanced, false);
    assert.equal(rows[4].rebalanced, false);
    assert.equal(rows[5].rebalanced, true);
    for (const row of rows) {
      const turnover = row.absolute_traded_leg_weights.SPY
        + row.absolute_traded_leg_weights.BIL;
      const cost = row.absolute_traded_leg_cost_returns.SPY
        + row.absolute_traded_leg_cost_returns.BIL;
      assert.ok(Math.abs(turnover - row.gross_two_leg_turnover) <= 2e-12);
      assert.ok(Math.abs(cost - row.transaction_cost_fraction) <= 2e-12);
      assert.ok(Math.abs(cost - turnover * 5 / 10_000) <= 2e-12);
      if (!row.rebalanced) {
        assert.ok(Math.abs(row.execution_target_weights.SPY
          - row.open_drifted_weights.SPY) <= 1e-12);
        assert.equal(row.gross_two_leg_turnover, 0);
        assert.equal(row.transaction_cost_fraction, 0);
      }
    }
  }
});

test("adjusted and raw books share dates but never share their price arithmetic", () => {
  const adjusted = WINDOW.cells.find((cell) => (
    cell.execution_book === "adjusted"
      && cell.rebalance_anchor === 0
      && cell.one_way_cost_bps === 5
  ));
  const raw = WINDOW.cells.find((cell) => (
    cell.execution_book === "raw"
      && cell.rebalance_anchor === 0
      && cell.one_way_cost_bps === 5
  ));
  const adjustedRows = adjusted.rows[ATTEMPT115_CHALLENGER_POLICY_ID];
  const rawRows = raw.rows[ATTEMPT115_CHALLENGER_POLICY_ID];
  assert.deepEqual(
    adjustedRows.map((row) => [row.signal_date, row.execution_date, row.rebalanced]),
    rawRows.map((row) => [row.signal_date, row.execution_date, row.rebalanced]),
  );
  assert.notDeepEqual(
    adjustedRows.map(({ net_return: value }) => value),
    rawRows.map(({ net_return: value }) => value),
  );

  const corrupted = structuredClone(WINDOW);
  corrupted.cells[0].rows[ATTEMPT115_INCUMBENT_POLICY_ID][0].transaction_cost_fraction = 0;
  const body = Object.fromEntries(
    Object.entries(corrupted).filter(([key]) => key !== "window_sha256"),
  );
  corrupted.window_sha256 = sha256(body);
  assert.throws(
    () => validateAttempt115PairedSettlementWindow(corrupted),
    /cost or return arithmetic|ledger is incomplete or changed/iu,
  );
});

test("input-bound replay rejects an attacker-rehashed outcome and settlement", () => {
  const mutatedSources = SOURCES.map((source) => structuredClone(source));
  const changed = mutatedSources[50];
  changed.outcome_ohlc.adjusted.SPY[1].open *= 1.25;
  mutatedSources[50] = rehashProjection(changed);
  const attackerWindow = buildAttempt115PairedSettlementWindow({ sources: mutatedSources });
  validateAttempt115PairedSettlementWindow(attackerWindow);
  assert.throws(
    () => validateAttempt115PairedSettlementWindowAgainstProjections(
      attackerWindow,
      { sources: SOURCES },
    ),
    /differs from its ordered source projections/iu,
  );
});

test("exact primary ledger agrees with the frozen prospective next-open simulator", () => {
  const imported = importedSyntheticWindow();
  const primary = WINDOW.cells.find(({ cell_id: id }) => id === WINDOW.primary_cell_id);
  for (const policyId of [ATTEMPT115_INCUMBENT_POLICY_ID, ATTEMPT115_CHALLENGER_POLICY_ID]) {
    const oracle = simulateProspectivePolicyNextOpen(imported, {
      policyId,
      executionBook: "adjusted",
      oneWayCostBps: 5,
      rebalanceAnchor: 0,
      evaluationStart: "2026-09-01",
      maximumRows: 252,
    });
    const actual = primary.rows[policyId].map((row) => ({
      policy_id: row.policy_id,
      signal_date: row.signal_date,
      execution_date: row.execution_date,
      rebalanced: row.rebalanced,
      target_spy_weight: round(row.execution_target_weights.SPY),
      target_bil_weight: round(row.execution_target_weights.BIL),
      close_spy_weight: row.close_spy_weight,
      close_bil_weight: row.close_bil_weight,
      gross_two_leg_turnover: round(row.gross_two_leg_turnover),
      transaction_cost_fraction: round(row.transaction_cost_fraction),
      net_return: row.net_return,
      spy_return: row.spy_return,
      bil_return: row.bil_return,
    }));
    assert.deepEqual(actual, oracle);
  }
});
