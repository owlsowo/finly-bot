import assert from "node:assert/strict";
import test from "node:test";

import { buildReturnsBySymbol } from "../research/champion_engine.mjs";
import {
  KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS,
  KENNETH_FRENCH_10_INDUSTRY_SYMBOLS,
} from "../research/industry_vm_g4_external/source.mjs";
import {
  buildIndustryVmG4DiagnosticRawWeights,
  buildIndustryVmG4DiagnosticWeights,
  buildIndustryVmG4PrimaryRawWeights,
  buildIndustryVmG4PrimaryWeights,
  INDUSTRY_VM_G4_ANNUALIZED_VOLATILITY_TARGET,
  INDUSTRY_VM_G4_DIAGNOSTIC_STRATEGY,
  INDUSTRY_VM_G4_EXTERNAL_SPECIFICATION,
  INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
  INDUSTRY_VM_G4_PRIMARY_STRATEGY,
  INDUSTRY_VM_G4_UNSCALED_PRIMARY_STRATEGY,
  INDUSTRY_VM_G4_VOLATILITY_LOOKBACK_SESSIONS,
  simulateIndustryVmG4Primary,
  simulateIndustryVmG4UnscaledPrimary,
} from "../research/industry_vm_g4_external/strategy.mjs";

const DAILY_SLOPES = Object.freeze({
  NoDur: 0.00001,
  Durbl: 0.00002,
  Manuf: 0.00003,
  Enrgy: 0.00004,
  Telcm: 0.00005,
  Shops: 0.00006,
  Hlth: 0.00007,
  Utils: 0.00008,
  Other: 0.00009,
  HiTec: 0.00010,
  MARKET: 0.000055,
  RF: -0.00001,
});

function approximately(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`,
  );
}

function riskyGross(weights) {
  return Object.entries(weights).filter(([symbol]) => symbol !== "RF")
    .reduce((sum, [, weight]) => sum + Math.abs(weight), 0);
}

function fixturePanel(length = 280) {
  const start = Date.parse("2024-01-01T00:00:00.000Z");
  const levels = Object.fromEntries(KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.map((symbol) => [
    symbol,
    100,
  ]));
  const points = [];
  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      const commonNoise = index % 2 === 0 ? 0.0001 : -0.0001;
      for (const symbol of KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS) {
        const returnValue = DAILY_SLOPES[symbol] + (symbol === "RF" ? 0 : commonNoise);
        levels[symbol] *= 1 + returnValue;
      }
    }
    points.push(Object.freeze({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      ...levels,
    }));
  }
  return Object.freeze(points);
}

test("strategy specification and objects pin the two isolated external mechanisms", () => {
  assert.equal(INDUSTRY_VM_G4_EXTERNAL_SPECIFICATION.research_only, true);
  assert.equal(INDUSTRY_VM_G4_EXTERNAL_SPECIFICATION.cash_and_financing_symbol, "RF");
  assert.equal(INDUSTRY_VM_G4_EXTERNAL_SPECIFICATION.rebalance_interval_sessions, 21);
  assert.equal(INDUSTRY_VM_G4_VOLATILITY_LOOKBACK_SESSIONS, 22);
  assert.equal(INDUSTRY_VM_G4_ANNUALIZED_VOLATILITY_TARGET, 0.20);
  assert.equal(INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS, 1.5);
  assert.equal(INDUSTRY_VM_G4_PRIMARY_STRATEGY.id, "industry_vm_g4_primary_hitec");
  assert.equal(INDUSTRY_VM_G4_DIAGNOSTIC_STRATEGY.id, "industry_vm_g4_diagnostic_market");
  assert.equal(INDUSTRY_VM_G4_PRIMARY_STRATEGY.researchOnly, true);
  assert.equal(INDUSTRY_VM_G4_DIAGNOSTIC_STRATEGY.researchOnly, true);
  assert.equal(INDUSTRY_VM_G4_UNSCALED_PRIMARY_STRATEGY.comparatorOnly, true);
});

test("primary and diagnostic formulas select their exact 252-to-126 momentum leaders", () => {
  const points = fixturePanel();
  const signalIndex = 252;
  assert.deepEqual(buildIndustryVmG4PrimaryRawWeights(points, signalIndex), {
    HiTec: 0.5,
    Hlth: 1 / 6,
    Other: 1 / 6,
    Utils: 1 / 6,
  });
  assert.deepEqual(buildIndustryVmG4DiagnosticRawWeights(points, signalIndex), {
    HiTec: 1 / 6,
    MARKET: 0.5,
    Other: 1 / 6,
    Utils: 1 / 6,
  });

  const returnsBySymbol = buildReturnsBySymbol(points, KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS);
  const primary = buildIndustryVmG4PrimaryWeights(points, returnsBySymbol, signalIndex);
  const diagnostic = buildIndustryVmG4DiagnosticWeights(points, returnsBySymbol, signalIndex);
  const expectedPrimary = { HiTec: 0.75, Hlth: 0.25, Other: 0.25, RF: -0.5, Utils: 0.25 };
  const expectedDiagnostic = { HiTec: 0.25, MARKET: 0.75, Other: 0.25, RF: -0.5, Utils: 0.25 };
  assert.deepEqual(Object.keys(primary), Object.keys(expectedPrimary));
  assert.deepEqual(Object.keys(diagnostic), Object.keys(expectedDiagnostic));
  Object.entries(expectedPrimary).forEach(([symbol, expected]) => approximately(primary[symbol], expected));
  Object.entries(expectedDiagnostic).forEach(([symbol, expected]) => approximately(diagnostic[symbol], expected));
});

test("all 21 cadence anchors are accepted and shift the first causal signal exactly", () => {
  const points = fixturePanel(310);
  for (let rebalanceAnchor = 0; rebalanceAnchor < 21; rebalanceAnchor += 1) {
    const simulation = simulateIndustryVmG4Primary(points, {
      oneWayCostBps: 0,
      terminalLiquidation: false,
      rebalanceAnchor,
    });
    const firstRebalance = simulation.rows.find(({ rebalanced }) => rebalanced);
    assert.ok(firstRebalance);
    assert.equal(firstRebalance.signal_date, points[252 + rebalanceAnchor].date);
    assert.equal(firstRebalance.rebalance_date, points[253 + rebalanceAnchor].date);
    assert.equal(firstRebalance.execution_return_date, points[254 + rebalanceAnchor].date);
  }
  assert.throws(
    () => simulateIndustryVmG4Primary(points, { rebalanceAnchor: 21 }),
    /0 through 20/iu,
  );
  assert.throws(
    () => simulateIndustryVmG4Primary(points, { rebalanceAnchor: -1 }),
    /0 through 20/iu,
  );
});

test("unscaled primary comparator uses the same selection without leverage", () => {
  const points = fixturePanel();
  const simulation = simulateIndustryVmG4UnscaledPrimary(points, {
    oneWayCostBps: 0,
    terminalLiquidation: false,
    rebalanceAnchor: 0,
  });
  const weights = simulation.rows[0].signal_weights;
  approximately(riskyGross(weights), 1, 2e-10);
  approximately(weights.RF, 0);
  approximately(weights.HiTec, 0.5);
  approximately(weights.Hlth, 1 / 6);
  approximately(weights.Other, 1 / 6);
  approximately(weights.Utils, 1 / 6);
});

test("both weight builders are invariant to every price observation after the signal close", () => {
  const points = fixturePanel();
  const signalIndex = 252;
  const mutated = Object.freeze(points.map((point, index) => Object.freeze(index <= signalIndex ? point : {
    ...point,
    ...Object.fromEntries(KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.map((symbol, symbolIndex) => [
      symbol,
      point[symbol] * (10 + symbolIndex + index),
    ])),
  })));
  const beforeReturns = buildReturnsBySymbol(points, KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS);
  const afterReturns = buildReturnsBySymbol(mutated, KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS);

  assert.deepEqual(
    buildIndustryVmG4PrimaryWeights(mutated, afterReturns, signalIndex),
    buildIndustryVmG4PrimaryWeights(points, beforeReturns, signalIndex),
  );
  assert.deepEqual(
    buildIndustryVmG4DiagnosticWeights(mutated, afterReturns, signalIndex),
    buildIndustryVmG4DiagnosticWeights(points, beforeReturns, signalIndex),
  );
});

test("1.5 target cap creates explicit negative RF financing and the simulator charges it", () => {
  const points = fixturePanel();
  const returnsBySymbol = buildReturnsBySymbol(points, KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS);
  const weights = buildIndustryVmG4PrimaryWeights(points, returnsBySymbol, 252);
  approximately(riskyGross(weights), 1.5);
  approximately(weights.RF, -0.5);
  approximately(Object.values(weights).reduce((sum, weight) => sum + weight, 0), 1);
  assert.ok(KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.every((symbol) => (weights[symbol] ?? 0) >= 0));

  const oneWayCostBps = 7;
  const simulation = simulateIndustryVmG4Primary(points, {
    oneWayCostBps,
    terminalLiquidation: false,
  });
  const first = simulation.rows[0];
  assert.equal(first.signal_date, points[252].date);
  assert.equal(first.rebalance_date, points[253].date);
  assert.equal(first.execution_return_date, points[254].date);
  approximately(riskyGross(first.signal_weights), 1.5);
  approximately(first.signal_weights.RF, -0.5);
  approximately(first.turnover_notional, 3);
  approximately(first.transaction_cost, 3 * oneWayCostBps / 10_000);
  approximately(first.financing_spread_cost, 0.5 * 0.005 / 252);
  approximately(
    first.net_return,
    first.gross_return - first.transaction_cost - first.financing_spread_cost,
    2e-10,
  );
});
