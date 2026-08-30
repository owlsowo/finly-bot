import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeneration6RawG4Weights,
  createGeneration6Strategies,
  generation6HierarchicalRiskParityWeights,
  generation6ResidualSectorScore,
} from "../research/champion_strategies_generation6.mjs";
import {
  CORE_SYMBOLS,
  SECTOR_SYMBOLS,
} from "../research/champion_strategies.mjs";

const TWO_PI = 2 * Math.PI;

function assertApproximately(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`,
  );
}

function knownTwoFactorPanel(length, {
  alpha = 0.0004,
  marketBeta = 0.70,
  growthBeta = -0.35,
  residualAmplitude = 0.00015,
} = {}) {
  const prices = { BIL: 100, QQQ: 100, SPY: 100, XLK: 100 };
  const points = [];
  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      const cash = 0.00002;
      const phase = TWO_PI * (index % 7) / 7;
      const market = 0.0012 * Math.sin(phase);
      const growth = 0.0009 * Math.cos(phase);
      const residual = residualAmplitude * Math.sin(2 * phase);
      const logReturns = {
        BIL: cash,
        SPY: cash + market,
        QQQ: cash + market + growth,
        XLK: cash + alpha + marketBeta * market + growthBeta * growth + residual,
      };
      for (const [symbol, value] of Object.entries(logReturns)) prices[symbol] *= Math.exp(value);
    }
    points.push(Object.freeze({ index, ...prices }));
  }
  return Object.freeze(points);
}

function completeMomentumPanel(length) {
  const points = [];
  for (let index = 0; index < length; index += 1) {
    const values = {};
    for (const [symbolIndex, symbol] of CORE_SYMBOLS.entries()) {
      const sectorIndex = SECTOR_SYMBOLS.indexOf(symbol);
      const slope = sectorIndex >= 0 ? (sectorIndex + 1) * 0.0001 : symbolIndex * 0.000001;
      values[symbol] = 100 * Math.exp(slope * index);
    }
    points.push(Object.freeze({ index, ...values }));
  }
  return Object.freeze(points);
}

function periodicReturns(scales, length = 260) {
  const result = Object.fromEntries(Object.keys(scales).map((symbol) => [symbol, [null]]));
  for (let index = 1; index < length; index += 1) {
    const phase = TWO_PI * (index % 7) / 7;
    const bases = {
      A: Math.sin(phase),
      B: Math.sin(phase),
      C: Math.cos(phase),
      D: Math.cos(phase),
    };
    for (const [symbol, scale] of Object.entries(scales)) result[symbol].push(scale * bases[symbol]);
  }
  return result;
}

test("independent two-factor process recovers the closed-form residual alpha score", () => {
  // Both windows contain a whole number of seven-session cycles at t=776:
  // 735 fitting observations and 231 scoring observations. The market, growth,
  // and residual sinusoids are mutually orthogonal, so OLS recovers the known
  // betas exactly and the stripped return is alpha + residual.
  const signalIndex = 776;
  const alpha = 0.0004;
  const residualAmplitude = 0.00015;
  const scoringObservations = 231;
  const points = knownTwoFactorPanel(800, { alpha, residualAmplitude });
  const expectedSampleDeviation = residualAmplitude * Math.sqrt(
    (scoringObservations / 2) / (scoringObservations - 1),
  );
  const expectedScore = scoringObservations * alpha / expectedSampleDeviation;
  const actualScore = generation6ResidualSectorScore(points, "XLK", signalIndex);

  assertApproximately(actualScore, expectedScore, 1e-6);
});

test("252/755/756 history boundaries are exact and future observations are never read", () => {
  const momentumPoints = completeMomentumPanel(800);
  assert.deepEqual(buildGeneration6RawG4Weights(momentumPoints, 251), { BIL: 0.5, QQQ: 0.5 });

  const firstCompleteMomentum = buildGeneration6RawG4Weights(momentumPoints, 252);
  assert.deepEqual(
    Object.keys(firstCompleteMomentum).filter((symbol) => SECTOR_SYMBOLS.includes(symbol)).sort(),
    SECTOR_SYMBOLS.slice(-3).sort(),
  );
  const changedAfterMomentumEndpoint = Object.freeze(momentumPoints.map((point, index) => Object.freeze(
    index <= 126 ? point : { ...point, XLB: point.XLB * 1_000 },
  )));
  assert.deepEqual(
    buildGeneration6RawG4Weights(changedAfterMomentumEndpoint, 252),
    firstCompleteMomentum,
    "the t=252 signal must stop its frozen momentum window at t-126",
  );

  const factorPoints = knownTwoFactorPanel(800);
  assert.equal(generation6ResidualSectorScore(factorPoints, "XLK", 755), null);
  const firstResidualScore = generation6ResidualSectorScore(factorPoints, "XLK", 756);
  assert.ok(Number.isFinite(firstResidualScore));

  const changedAfterResidualEndpoint = Object.freeze(factorPoints.map((point, index) => Object.freeze(
    index <= 735 ? point : { ...point, XLK: point.XLK * (10 + index) },
  )));
  assert.equal(
    generation6ResidualSectorScore(changedAfterResidualEndpoint, "XLK", 756),
    firstResidualScore,
    "the first residual signal must ignore t-20 and every later point",
  );

  const returns = periodicReturns({ A: 0.01, B: 0.02, C: 0.03, D: 0.04 });
  assert.deepEqual(generation6HierarchicalRiskParityWeights(["A", "B", "C", "D"], returns, 251), {});
  const firstHrpWeights = generation6HierarchicalRiskParityWeights(["A", "B", "C", "D"], returns, 252);
  const changedFuture = Object.fromEntries(Object.entries(returns).map(([symbol, values]) => [
    symbol,
    values.map((value, index) => (index === 253 ? 100 + (value ?? 0) : value)),
  ]));
  assert.deepEqual(
    generation6HierarchicalRiskParityWeights(["A", "B", "C", "D"], changedFuture, 252),
    firstHrpWeights,
    "the first HRP signal must ignore return t+1",
  );
  const changedPresent = { ...returns, A: [...returns.A] };
  changedPresent.A[252] += 0.20;
  assert.notDeepEqual(
    generation6HierarchicalRiskParityWeights(["A", "B", "C", "D"], changedPresent, 252),
    firstHrpWeights,
    "the first HRP signal must include return t",
  );
});

test("four-asset block covariance has deterministic alphabetical ties and closed-form HRP weights", () => {
  // A/B share one factor and C/D share an orthogonal factor. Both within-block
  // correlations are one, so the equal-distance merge is resolved A/B first.
  const returns = periodicReturns({ A: 0.01, B: 0.02, C: 0.03, D: 0.04 }, 253);
  const actual = generation6HierarchicalRiskParityWeights(["D", "B", "C", "A"], returns, 252);
  const leftClusterVariance = 1.2 ** 2;
  const rightClusterVariance = 3.36 ** 2;
  const leftAllocation = rightClusterVariance / (leftClusterVariance + rightClusterVariance);
  const expected = {
    A: leftAllocation * 0.80,
    B: leftAllocation * 0.20,
    C: (1 - leftAllocation) * 0.64,
    D: (1 - leftAllocation) * 0.36,
  };

  assert.deepEqual(Object.keys(actual), ["A", "B", "C", "D"]);
  for (const symbol of Object.keys(expected)) assertApproximately(actual[symbol], expected[symbol], 1e-12);
  assert.deepEqual(
    generation6HierarchicalRiskParityWeights(["A", "B", "C", "D"], returns, 252),
    actual,
    "input order must not alter a covariance-tie result",
  );
});

test("HRP fails closed to an empty risky sleeve when any eligible asset has zero variance", () => {
  const signalIndex = 252;
  const variable = [null, ...Array.from({ length: signalIndex }, (_, index) => (
    index % 2 === 0 ? 0.01 : -0.01
  ))];
  const zeroVariance = [null, ...Array.from({ length: signalIndex }, () => 0.001)];
  assert.deepEqual(
    generation6HierarchicalRiskParityWeights(["A", "B"], { A: variable, B: zeroVariance }, signalIndex),
    {},
  );
  assert.deepEqual(
    generation6HierarchicalRiskParityWeights(["B"], { B: zeroVariance }, signalIndex),
    {},
  );

  const prices = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, 100]));
  const points = Object.freeze(Array.from({ length: signalIndex + 1 }, (_, index) => Object.freeze({
    index,
    ...prices,
    SPY: 100 * Math.exp(0.001 * index),
  })));
  const returnsBySymbol = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [
    symbol,
    symbol === "SPY" ? zeroVariance : [null, ...Array(signalIndex).fill(0)],
  ]));
  const strategy = createGeneration6Strategies().find(({ id }) => id === "g6_hrp_trend");
  const decision = strategy.decide({ points, returnsBySymbol, signalIndex });
  assert.deepEqual(decision, { BIL: 1 });
});
