import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReturnsBySymbol,
  sampleStandardDeviation,
} from "../research/champion_engine.mjs";
import { buildGeneration6RawG4Weights } from "../research/champion_strategies_generation6.mjs";
import {
  CORE_SYMBOLS,
  SECTOR_SYMBOLS,
} from "../research/champion_strategies.mjs";
import {
  buildVolatilityManagedG4Weights,
  simulateVolatilityManagedG4Candidate,
  VOLATILITY_MANAGED_G4_CANDIDATE,
  VOLATILITY_MANAGED_G4_SPECIFICATION,
} from "../research/volatility_managed_g4_candidate.mjs";

const TRADING_DAYS = 252;

function approximately(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`,
  );
}

function riskyGross(weights) {
  return Object.entries(weights).filter(([symbol]) => symbol !== "BIL")
    .reduce((sum, [, weight]) => sum + Math.abs(weight), 0);
}

function fixturePanel(length = 280, dailyCommonReturn = (index) => (
  index % 2 === 0 ? 0.0001 : -0.0001
)) {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const prices = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, 100]));
  const points = [];
  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      const common = dailyCommonReturn(index);
      for (const [symbolIndex, symbol] of CORE_SYMBOLS.entries()) {
        const sectorIndex = SECTOR_SYMBOLS.indexOf(symbol);
        const returnValue = symbol === "BIL"
          ? 0.00002
          : common + 0.000001 * symbolIndex + (sectorIndex >= 0 ? 0.00001 * sectorIndex : 0);
        assert.ok(returnValue > -1, `${symbol} fixture return is insolvent`);
        prices[symbol] *= 1 + returnValue;
      }
    }
    points.push(Object.freeze({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      ...prices,
    }));
  }
  return Object.freeze(points);
}

test("candidate pins the isolated 20%-target, 22-session, 1.5-gross research formula", () => {
  assert.equal(VOLATILITY_MANAGED_G4_CANDIDATE.researchOnly, true);
  assert.equal(VOLATILITY_MANAGED_G4_CANDIDATE.rebalanceIntervalSessions, 21);
  assert.equal(VOLATILITY_MANAGED_G4_SPECIFICATION.research_only, true);
  assert.equal(VOLATILITY_MANAGED_G4_SPECIFICATION.volatility_lookback_sessions, 22);
  assert.equal(VOLATILITY_MANAGED_G4_SPECIFICATION.annualized_volatility_target, 0.20);
  assert.equal(VOLATILITY_MANAGED_G4_SPECIFICATION.maximum_target_risky_gross, 1.5);
  assert.equal(VOLATILITY_MANAGED_G4_SPECIFICATION.annual_borrow_spread, 0.005);
});

test("formula scales the raw G4 vector by exactly 22 trailing static-portfolio returns", () => {
  const signalIndex = 252;
  const points = fixturePanel(280, (index) => (
    index >= signalIndex - 21 && index <= signalIndex
      ? (index % 2 === 0 ? 0.03 : -0.03)
      : 0.0001
  ));
  const returnsBySymbol = buildReturnsBySymbol(points, CORE_SYMBOLS);
  const raw = buildGeneration6RawG4Weights(points, signalIndex);
  const rawRisky = Object.fromEntries(Object.entries(raw).filter(([symbol]) => symbol !== "BIL"));
  const rawGross = riskyGross(raw);
  const trailingPortfolioReturns = [];
  for (let index = signalIndex - 21; index <= signalIndex; index += 1) {
    trailingPortfolioReturns.push(Object.entries(rawRisky).reduce((sum, [symbol, weight]) => (
      sum + weight * (points[index][symbol] / points[index - 1][symbol] - 1)
    ), 0));
  }
  assert.equal(trailingPortfolioReturns.length, 22);
  const realizedVolatility = sampleStandardDeviation(trailingPortfolioReturns) * Math.sqrt(TRADING_DAYS);
  const expectedScale = Math.min(1.5 / rawGross, 0.20 / realizedVolatility);
  assert.ok(expectedScale > 0 && expectedScale < 1.5);

  const actual = buildVolatilityManagedG4Weights(points, returnsBySymbol, signalIndex);
  for (const [symbol, weight] of Object.entries(rawRisky)) {
    approximately(actual[symbol], weight * expectedScale);
  }
  approximately(actual.BIL, 1 - rawGross * expectedScale);
});

test("decision is future-mutation invariant and its first return follows next-close execution", () => {
  const signalIndex = 252;
  const points = fixturePanel(280, (index) => (
    index >= signalIndex - 21 && index <= signalIndex
      ? (index % 2 === 0 ? 0.012 : -0.012)
      : 0.0001
  ));
  const mutatedFuture = Object.freeze(points.map((point, index) => Object.freeze(index <= signalIndex ? point : {
    ...point,
    ...Object.fromEntries(CORE_SYMBOLS.filter((symbol) => symbol !== "BIL").map((symbol, symbolIndex) => [
      symbol,
      point[symbol] * (2 + symbolIndex + index - signalIndex),
    ])),
  })));
  const before = buildVolatilityManagedG4Weights(
    points,
    buildReturnsBySymbol(points, CORE_SYMBOLS),
    signalIndex,
  );
  const after = buildVolatilityManagedG4Weights(
    mutatedFuture,
    buildReturnsBySymbol(mutatedFuture, CORE_SYMBOLS),
    signalIndex,
  );
  assert.deepEqual(after, before);

  const simulation = simulateVolatilityManagedG4Candidate(points, CORE_SYMBOLS, {
    oneWayCostBps: 0,
    terminalLiquidation: false,
  });
  assert.equal(simulation.rows[0].signal_date, points[signalIndex].date);
  assert.equal(simulation.rows[0].rebalance_date, points[signalIndex + 1].date);
  assert.equal(simulation.rows[0].execution_return_date, points[signalIndex + 2].date);
  const executedSignal = Object.fromEntries(Object.entries(simulation.rows[0].signal_weights)
    .filter(([, weight]) => Math.abs(weight) > 1e-12));
  assert.deepEqual(Object.keys(executedSignal).sort(), Object.keys(before).sort());
  for (const [symbol, weight] of Object.entries(before)) {
    approximately(executedSignal[symbol], weight);
  }
});

test("low volatility reaches the 1.5 target cap and uses negative BIL financing", () => {
  const points = fixturePanel();
  const weights = buildVolatilityManagedG4Weights(
    points,
    buildReturnsBySymbol(points, CORE_SYMBOLS),
    252,
  );
  approximately(riskyGross(weights), 1.5);
  approximately(weights.BIL, -0.5);
  approximately(Object.values(weights).reduce((sum, weight) => sum + weight, 0), 1);
  assert.ok(Object.entries(weights).filter(([symbol]) => symbol !== "BIL")
    .every(([, weight]) => weight >= 0));
});

test("simulation charges traded-notional cost and the pinned 50bp borrowing spread", () => {
  const oneWayCostBps = 7;
  const points = fixturePanel();
  const simulation = simulateVolatilityManagedG4Candidate(points, CORE_SYMBOLS, {
    oneWayCostBps,
    terminalLiquidation: false,
  });
  const entry = simulation.rows[0];
  approximately(riskyGross(entry.weights), 1.5);
  approximately(entry.weights.BIL, -0.5);
  approximately(entry.turnover_notional, 3);
  approximately(entry.transaction_cost, 3 * oneWayCostBps / 10_000);
  approximately(entry.financing_spread_cost, 0.5 * 0.005 / TRADING_DAYS);
  approximately(
    entry.net_return,
    entry.gross_return - entry.transaction_cost - entry.financing_spread_cost,
    2e-10,
  );

  const held = simulation.rows[1];
  assert.equal(held.rebalanced, false);
  assert.equal(held.transaction_cost, 0);
  assert.ok(held.financing_spread_cost > 0);
  approximately(
    held.net_return,
    held.gross_return - held.financing_spread_cost,
    2e-10,
  );
});

test("the 1.5 cap governs targets while losses may drift held gross above it", () => {
  const points = fixturePanel(280, (index) => (
    index === 254 ? -0.10 : (index % 2 === 0 ? 0.0001 : -0.0001)
  ));
  const simulation = simulateVolatilityManagedG4Candidate(points, CORE_SYMBOLS, {
    oneWayCostBps: 0,
    terminalLiquidation: false,
  });
  const initialTarget = simulation.rows[0];
  approximately(riskyGross(initialTarget.weights), 1.5);
  assert.equal(initialTarget.rebalanced, true);

  const driftedHold = simulation.rows[1];
  assert.equal(driftedHold.rebalanced, false);
  assert.ok(riskyGross(driftedHold.weights) > 1.5);
  assert.ok(driftedHold.weights.BIL < -0.5);

  const nextScheduledTarget = simulation.rows.find((row) => (
    row.rebalanced && row.signal_date === points[273].date
  ));
  assert.ok(nextScheduledTarget);
  assert.ok(riskyGross(nextScheduledTarget.signal_weights) <= 1.5 + 1e-10);
});
