import assert from "node:assert/strict";
import test from "node:test";

import { simulateStrategy } from "../research/champion_engine.mjs";
import { CORE_SYMBOLS } from "../research/champion_strategies.mjs";
import {
  createGeneration3Strategies,
  GENERATION3_ADDITIONAL_SYMBOLS,
} from "../research/champion_strategies_generation3.mjs";

const SYMBOLS = [...CORE_SYMBOLS, ...GENERATION3_ADDITIONAL_SYMBOLS];

function syntheticPanel(length) {
  const start = Date.parse("2010-01-01T00:00:00Z");
  return Object.freeze(Array.from({ length }, (_, index) => Object.freeze({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    ...Object.fromEntries(SYMBOLS.map((symbol, symbolIndex) => [
      symbol,
      100 * Math.exp((0.00005 + symbolIndex * 0.000002) * index + 0.01 * Math.sin(index / (17 + symbolIndex))),
    ])),
  })));
}

test("every Generation 3 strategy remains fully funded, long-only, and bounded", () => {
  const points = syntheticPanel(840);
  for (const strategy of createGeneration3Strategies()) {
    const simulation = simulateStrategy(points, SYMBOLS, strategy, {
      lookbackSessions: 252,
      oneWayCostBps: 5,
      maximumRiskyGross: 1,
      terminalLiquidation: true,
    });
    assert.ok(simulation.rows.length > 500, strategy.id);
    for (const row of simulation.rows) {
      const weights = Object.values(row.weights);
      assert.ok(weights.every((weight) => Number.isFinite(weight) && weight >= -1e-10), strategy.id);
      assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-8, strategy.id);
      const riskyGross = Object.entries(row.weights)
        .filter(([symbol]) => symbol !== "BIL")
        .reduce((sum, [, weight]) => sum + weight, 0);
      assert.ok(riskyGross <= 1 + 1e-8, strategy.id);
      assert.ok(row.signal_date < row.rebalance_date, strategy.id);
      assert.ok(row.rebalance_date < row.execution_return_date, strategy.id);
    }
  }
});

test("future price perturbations do not change Generation 3 decisions already formed", () => {
  const original = syntheticPanel(840);
  const cutoff = 790;
  const perturbed = Object.freeze(original.map((point, index) => Object.freeze(index <= cutoff ? point : {
    ...point,
    ...Object.fromEntries(SYMBOLS.filter((symbol) => symbol !== "BIL").map((symbol) => [symbol, point[symbol] * (1 + (index - cutoff) * 0.5)])),
  })));

  for (const strategy of createGeneration3Strategies()) {
    const options = { lookbackSessions: 252, oneWayCostBps: 5, maximumRiskyGross: 1, terminalLiquidation: false };
    const before = simulateStrategy(original, SYMBOLS, strategy, options).rows
      .filter((row) => row.signal_date <= original[cutoff].date)
      .map((row) => ({ signal_date: row.signal_date, signal_weights: row.signal_weights }));
    const after = simulateStrategy(perturbed, SYMBOLS, strategy, options).rows
      .filter((row) => row.signal_date <= original[cutoff].date)
      .map((row) => ({ signal_date: row.signal_date, signal_weights: row.signal_weights }));
    assert.deepEqual(after, before, strategy.id);
  }
});
