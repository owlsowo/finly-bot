import assert from "node:assert/strict";
import test from "node:test";

import { simulateStrategy } from "../research/champion_engine.mjs";
import { CORE_SYMBOLS } from "../research/champion_strategies.mjs";
import {
  createGeneration4Strategies,
  GENERATION4_METADATA,
} from "../research/champion_strategies_generation4.mjs";

function syntheticPanel(length) {
  const start = Date.parse("2010-01-01T00:00:00Z");
  return Object.freeze(Array.from({ length }, (_, index) => Object.freeze({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    ...Object.fromEntries(CORE_SYMBOLS.map((symbol, symbolIndex) => [
      symbol,
      100 * Math.exp((0.00004 + symbolIndex * 0.000002) * index + 0.008 * Math.sin(index / (13 + symbolIndex))),
    ])),
  })));
}

test("Generation 4 contains one explanatory control and seven eligible candidates", () => {
  const strategies = createGeneration4Strategies();
  assert.equal(strategies.length, 8);
  assert.equal(strategies.filter((strategy) => GENERATION4_METADATA[strategy.id].role === "growth_tilt_control").length, 1);
  assert.equal(strategies.filter((strategy) => GENERATION4_METADATA[strategy.id].role === "candidate").length, 7);
});

test("every Generation 4 rule remains causal, fully funded, long-only, and unlevered", () => {
  const points = syntheticPanel(840);
  const cutoff = 790;
  const perturbed = Object.freeze(points.map((point, index) => Object.freeze(index <= cutoff ? point : {
    ...point,
    ...Object.fromEntries(CORE_SYMBOLS.filter((symbol) => symbol !== "BIL")
      .map((symbol) => [symbol, point[symbol] * (1 + (index - cutoff) * 0.4)])),
  })));
  for (const strategy of createGeneration4Strategies()) {
    const options = { lookbackSessions: 252, oneWayCostBps: 5, maximumRiskyGross: 1, terminalLiquidation: false };
    const simulation = simulateStrategy(points, CORE_SYMBOLS, strategy, options);
    assert.ok(simulation.rows.length > 500, strategy.id);
    for (const row of simulation.rows) {
      const weights = Object.values(row.weights);
      assert.ok(weights.every((weight) => Number.isFinite(weight) && weight >= -1e-10), strategy.id);
      assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-8, strategy.id);
      assert.ok(row.signal_date < row.rebalance_date && row.rebalance_date < row.execution_return_date, strategy.id);
    }
    const before = simulation.rows.filter((row) => row.signal_date <= points[cutoff].date)
      .map((row) => ({ signal_date: row.signal_date, signal_weights: row.signal_weights }));
    const after = simulateStrategy(perturbed, CORE_SYMBOLS, strategy, options).rows
      .filter((row) => row.signal_date <= points[cutoff].date)
      .map((row) => ({ signal_date: row.signal_date, signal_weights: row.signal_weights }));
    assert.deepEqual(after, before, strategy.id);
  }
});

test("the mandatory static growth control is exactly half SPY and half QQQ at review", () => {
  const points = syntheticPanel(300);
  const control = createGeneration4Strategies().find((strategy) => strategy.id === "static_spy_qqq_50_50_control");
  const row = simulateStrategy(points, CORE_SYMBOLS, control, {
    lookbackSessions: 252,
    oneWayCostBps: 0,
    maximumRiskyGross: 1,
    terminalLiquidation: false,
  }).rows[0];
  assert.equal(row.signal_weights.SPY, 0.5);
  assert.equal(row.signal_weights.QQQ, 0.5);
  assert.equal(row.signal_weights.BIL, 0);
});
