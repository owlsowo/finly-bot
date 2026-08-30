import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReturnsBySymbol,
  logReturn,
  mean,
  staticPortfolioVolatility,
} from "../research/champion_engine.mjs";
import {
  CORE_SYMBOLS,
  SECTOR_SYMBOLS,
} from "../research/champion_strategies.mjs";
import { laggedEwmaAnnualizedVolatility } from "../research/champion_strategies_generation5.mjs";
import {
  buildGeneration6RawG4Weights,
  createGeneration6Strategies,
  GENERATION6_ALL_IDS,
  GENERATION6_CANDIDATE_IDS,
  GENERATION6_CONTROL_IDS,
  GENERATION6_CROSS_ASSET_UNIVERSE,
  GENERATION6_METADATA,
  GENERATION6_REQUIRED_SYMBOLS,
  generation6HierarchicalRiskParityWeights,
  generation6ResidualSectorScore,
} from "../research/champion_strategies_generation6.mjs";

const CASH_SYMBOL = "BIL";

function syntheticPanel(length) {
  const start = Date.parse("2004-01-01T00:00:00Z");
  const prices = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, 100]));
  const points = [];
  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      const cashReturn = 0.000025 + 0.000003 * Math.sin(index / 37);
      const market = 0.00022 + 0.0012 * Math.sin(index / 9) + 0.0007 * Math.cos(index / 23);
      const growth = 0.00010 + 0.0008 * Math.sin(index / 6) - 0.0005 * Math.cos(index / 15);
      for (let symbolIndex = 0; symbolIndex < CORE_SYMBOLS.length; symbolIndex += 1) {
        const symbol = CORE_SYMBOLS[symbolIndex];
        let dailyLogReturn;
        if (symbol === CASH_SYMBOL) {
          dailyLogReturn = cashReturn;
        } else if (symbol === "SPY") {
          dailyLogReturn = cashReturn + market;
        } else if (symbol === "QQQ") {
          dailyLogReturn = cashReturn + market + growth;
        } else {
          const sectorIndex = SECTOR_SYMBOLS.indexOf(symbol);
          const alpha = sectorIndex >= 0 ? (sectorIndex - 2) * 0.000012 : 0.00001 * ((symbolIndex % 5) - 1);
          const marketBeta = 0.25 + 0.055 * (symbolIndex % 10);
          const growthBeta = -0.20 + 0.065 * (symbolIndex % 7);
          const idiosyncratic = 0.00045 * Math.sin(index / (4.5 + symbolIndex * 0.37))
            + 0.00022 * Math.cos(index / (10 + symbolIndex));
          dailyLogReturn = cashReturn + alpha + marketBeta * market + growthBeta * growth + idiosyncratic;
        }
        prices[symbol] *= Math.exp(dailyLogReturn);
      }
    }
    points.push(Object.freeze({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      ...Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, prices[symbol]])),
    }));
  }
  return Object.freeze(points);
}

function factorAlphaPanel(length) {
  const start = Date.parse("2004-01-01T00:00:00Z");
  const prices = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, 100]));
  const points = [];
  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      const cash = 0.00002;
      const market = 0.0009 * Math.sin(index / 7) + 0.0005 * Math.cos(index / 19);
      const growth = 0.0007 * Math.cos(index / 5) - 0.00035 * Math.sin(index / 13);
      for (let symbolIndex = 0; symbolIndex < CORE_SYMBOLS.length; symbolIndex += 1) {
        const symbol = CORE_SYMBOLS[symbolIndex];
        let value = cash + 0.00002 * Math.sin(index / (4 + symbolIndex));
        if (symbol === CASH_SYMBOL) value = cash;
        if (symbol === "SPY") value = cash + market;
        if (symbol === "QQQ") value = cash + market + growth;
        if (symbol === "XLK") {
          value = cash + 0.00050 + 0.80 * market + 0.40 * growth + 0.00012 * Math.sin(index / 3);
        }
        prices[symbol] *= Math.exp(value);
      }
    }
    points.push(Object.freeze({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      ...Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, prices[symbol]])),
    }));
  }
  return Object.freeze(points);
}

function byId(id) {
  const item = createGeneration6Strategies().find((strategy) => strategy.id === id);
  assert.ok(item, id);
  return item;
}

function decide(strategyOrId, points, signalIndex) {
  const strategy = typeof strategyOrId === "string" ? byId(strategyOrId) : strategyOrId;
  return strategy.decide(Object.freeze({
    points,
    symbols: CORE_SYMBOLS,
    returnsBySymbol: buildReturnsBySymbol(points, CORE_SYMBOLS),
    signalIndex,
    signalDate: points[signalIndex].date,
    priorWeights: Object.freeze({ BIL: 1 }),
    rows: Object.freeze([]),
  }));
}

function inclusiveSma(points, symbol, signalIndex, lookback = 210) {
  return mean(points.slice(signalIndex - lookback + 1, signalIndex + 1).map((point) => point[symbol]));
}

function assertWeights(actual, expected, tolerance = 1e-11) {
  const symbols = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const symbol of symbols) {
    assert.ok(Math.abs((actual[symbol] ?? 0) - (expected[symbol] ?? 0)) <= tolerance,
      `${symbol}: ${actual[symbol] ?? 0} != ${expected[symbol] ?? 0}`);
  }
}

function riskyOnly(weights) {
  return Object.fromEntries(Object.entries(weights).filter(([symbol, weight]) => symbol !== CASH_SYMBOL && weight > 1e-12));
}

test("Generation 6 registers the frozen control and seven candidates in exact order", () => {
  assert.deepEqual(GENERATION6_REQUIRED_SYMBOLS, CORE_SYMBOLS);
  assert.deepEqual(createGeneration6Strategies().map((strategy) => strategy.id), GENERATION6_ALL_IDS);
  assert.deepEqual(GENERATION6_ALL_IDS, [
    "faber_gtaa5_trend",
    "g6_trend_guard_g4",
    "g6_vol_target_g4",
    "g6_breadth_scaled_g4",
    "g6_residual_sector",
    "g6_long_only_tsmom_1_3_12",
    "g6_hrp_trend",
    "g6_equal_evidence_ensemble",
  ]);
  assert.deepEqual(GENERATION6_CONTROL_IDS, ["faber_gtaa5_trend"]);
  assert.deepEqual(GENERATION6_CANDIDATE_IDS, GENERATION6_ALL_IDS.slice(1));
  assert.equal(createGeneration6Strategies().filter((strategy) => GENERATION6_METADATA[strategy.id].eligible).length, 7);
  assert.equal(createGeneration6Strategies().filter((strategy) => !GENERATION6_METADATA[strategy.id].eligible).length, 1);
});

test("every Generation 6 rule is monthly, causal, finite, long-only, fully funded, and unlevered", () => {
  const points = syntheticPanel(880);
  const signalIndex = 820;
  const perturbed = Object.freeze(points.map((point, index) => Object.freeze(index <= signalIndex ? point : {
    ...point,
    ...Object.fromEntries(CORE_SYMBOLS.filter((symbol) => symbol !== CASH_SYMBOL).map((symbol, symbolIndex) => [
      symbol,
      point[symbol] * (1 + (index - signalIndex) * (0.2 + symbolIndex * 0.01)),
    ])),
  })));
  for (const strategy of createGeneration6Strategies()) {
    assert.equal(strategy.rebalanceIntervalSessions, 21, strategy.id);
    const before = decide(strategy, points, signalIndex);
    const after = decide(strategy, perturbed, signalIndex);
    assert.deepEqual(after, before, `${strategy.id} read future observations`);
    const weights = Object.values(before);
    assert.ok(weights.every((weight) => Number.isFinite(weight) && weight >= -1e-12), strategy.id);
    assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-10, strategy.id);
    const riskyGross = Object.entries(before).filter(([symbol]) => symbol !== CASH_SYMBOL)
      .reduce((sum, [, weight]) => sum + weight, 0);
    assert.ok(riskyGross <= 1 + 1e-10, strategy.id);
  }
});

test("Faber GTAA5 uses five fixed slots and sends each failed inclusive-SMA210 gate to BIL", () => {
  const points = syntheticPanel(840);
  const signalIndex = 820;
  const forcedDowntrend = Object.freeze(points.map((point, index) => Object.freeze({
    ...point,
    DBC: 400 - 0.20 * index,
  })));
  const weights = decide("faber_gtaa5_trend", forcedDowntrend, signalIndex);
  const symbols = ["SPY", "EFA", "IEF", "VNQ", "DBC"];
  let occupied = 0;
  for (const symbol of symbols) {
    const passes = forcedDowntrend[signalIndex][symbol] > inclusiveSma(forcedDowntrend, symbol, signalIndex);
    assert.equal(weights[symbol] ?? 0, passes ? 0.20 : 0, symbol);
    occupied += Number(passes);
  }
  assert.equal(weights.BIL, 1 - 0.20 * occupied);
  assert.equal(weights.DBC ?? 0, 0);
});

test("trend guard preserves frozen G4 slot sizes and independently gates every sleeve", () => {
  const points = syntheticPanel(840);
  const signalIndex = 820;
  const rawG4 = buildGeneration6RawG4Weights(points, signalIndex);
  assert.equal(rawG4.QQQ, 0.50);
  const sectorSlots = Object.entries(rawG4).filter(([symbol]) => SECTOR_SYMBOLS.includes(symbol));
  assert.equal(sectorSlots.length, 3);
  assert.ok(sectorSlots.every(([, weight]) => Math.abs(weight - 1 / 6) < 1e-12));
  const guarded = decide("g6_trend_guard_g4", points, signalIndex);
  let expectedGross = 0;
  for (const [symbol, weight] of Object.entries(rawG4)) {
    if (symbol === CASH_SYMBOL) continue;
    const passes = points[signalIndex][symbol] > inclusiveSma(points, symbol, signalIndex);
    assert.ok(Math.abs((guarded[symbol] ?? 0) - (passes ? weight : 0)) < 1e-12, symbol);
    if (passes) expectedGross += weight;
  }
  assert.ok(Math.abs(guarded.BIL - (1 - expectedGross)) < 1e-12);
});

test("volatility target scales the static frozen G4 target by the exact 22-return 10% cap", () => {
  const base = syntheticPanel(840);
  const signalIndex = 820;
  const points = Object.freeze(base.map((point, index) => Object.freeze(index < signalIndex - 25 ? point : {
    ...point,
    ...Object.fromEntries(CORE_SYMBOLS.filter((symbol) => symbol !== CASH_SYMBOL).map((symbol, symbolIndex) => [
      symbol,
      point[symbol] * Math.exp((index % 2 === 0 ? -1 : 1) * (0.030 + symbolIndex * 0.0002)),
    ])),
  })));
  const raw = riskyOnly(buildGeneration6RawG4Weights(points, signalIndex));
  const returnsBySymbol = buildReturnsBySymbol(points, CORE_SYMBOLS);
  const volatility = staticPortfolioVolatility(raw, returnsBySymbol, signalIndex, 22);
  const scale = Math.min(1, 0.10 / volatility);
  assert.ok(scale < 1);
  const actual = decide("g6_vol_target_g4", points, signalIndex);
  const expected = Object.fromEntries(Object.entries(raw).map(([symbol, weight]) => [symbol, weight * scale]));
  expected.BIL = 1 - Object.values(expected).reduce((sum, weight) => sum + weight, 0);
  assertWeights(actual, expected);
});

test("breadth overlay uses the exact fraction of sectors with positive 21-session BIL-excess log return", () => {
  const points = syntheticPanel(840);
  const signalIndex = 820;
  const raw = riskyOnly(buildGeneration6RawG4Weights(points, signalIndex));
  const cashReturn = logReturn(points, CASH_SYMBOL, signalIndex - 21, signalIndex);
  const breadth = SECTOR_SYMBOLS.filter((symbol) => (
    logReturn(points, symbol, signalIndex - 21, signalIndex) - cashReturn > 0
  )).length / SECTOR_SYMBOLS.length;
  const actual = decide("g6_breadth_scaled_g4", points, signalIndex);
  const expected = Object.fromEntries(Object.entries(raw).map(([symbol, weight]) => [symbol, weight * breadth]));
  expected.BIL = 1 - Object.values(expected).reduce((sum, weight) => sum + weight, 0);
  assertWeights(actual, expected);
});

test("residual-sector rule uses its frozen fallback, positive fixed slots, and retains fitted intercept in score", () => {
  const points = syntheticPanel(840);
  assert.equal(generation6ResidualSectorScore(points, "XLK", 755), null);
  assert.ok(Number.isFinite(generation6ResidualSectorScore(points, "XLK", 756)));
  assert.deepEqual(decide("g6_residual_sector", points, 755), Object.freeze({ BIL: 0.5, SPY: 0.5 }));
  const signalIndex = 820;
  const actual = decide("g6_residual_sector", points, signalIndex);
  const rankedPositive = SECTOR_SYMBOLS.map((symbol) => ({
    symbol,
    score: generation6ResidualSectorScore(points, symbol, signalIndex),
  })).filter((item) => Number.isFinite(item.score) && item.score > 0)
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
    .slice(0, 3);
  assert.equal(actual.SPY, 0.50);
  for (const { symbol } of rankedPositive) assert.ok(Math.abs(actual[symbol] - 1 / 6) < 1e-12, symbol);
  assert.equal(Object.keys(riskyOnly(actual)).filter((symbol) => SECTOR_SYMBOLS.includes(symbol)).length, rankedPositive.length);
  assert.ok(Math.abs(actual.BIL - (0.50 - rankedPositive.length / 6)) < 1e-12);

  const alphaPoints = factorAlphaPanel(840);
  assert.ok(generation6ResidualSectorScore(alphaPoints, "XLK", 820) > 100,
    "a persistent factor-adjusted alpha should remain in the score rather than being demeaned away");

  const boundarySignal = 756;
  const baselineScore = generation6ResidualSectorScore(points, "XLK", boundarySignal);
  const outsideWindow = Object.freeze(points.map((point, index) => Object.freeze(index >= 736 ? {
    ...point,
    XLK: point.XLK * (1 + 0.5 * (index - 735)),
  } : point)));
  assert.equal(generation6ResidualSectorScore(outsideWindow, "XLK", boundarySignal), baselineScore,
    "observations after t-21 must not enter either residual window");
  const insideWindow = Object.freeze(points.map((point, index) => Object.freeze(index === 735 ? {
    ...point,
    XLK: point.XLK * 1.10,
  } : point)));
  assert.notEqual(generation6ResidualSectorScore(insideWindow, "XLK", boundarySignal), baselineScore,
    "the final t-21 endpoint must enter the frozen residual windows");
});

test("1/3/12 TSMOM exactly averages inverse-EWMA-volatility positive-excess sleeves", () => {
  const points = syntheticPanel(840);
  const signalIndex = 820;
  const returnsBySymbol = buildReturnsBySymbol(points, CORE_SYMBOLS);
  const expectedRisky = {};
  for (const horizon of [21, 63, 252]) {
    const cash = logReturn(points, CASH_SYMBOL, signalIndex - horizon, signalIndex);
    const eligible = GENERATION6_CROSS_ASSET_UNIVERSE.map((symbol) => ({
      symbol,
      score: logReturn(points, symbol, signalIndex - horizon, signalIndex) - cash,
      inverseVolatility: 1 / laggedEwmaAnnualizedVolatility(returnsBySymbol[symbol], signalIndex, 60 / 61),
    })).filter((item) => item.score > 0 && Number.isFinite(item.inverseVolatility));
    const denominator = eligible.reduce((sum, item) => sum + item.inverseVolatility, 0);
    if (!(denominator > 0)) continue;
    for (const item of eligible) {
      expectedRisky[item.symbol] = (expectedRisky[item.symbol] ?? 0) + item.inverseVolatility / denominator / 3;
    }
  }
  const expected = { ...expectedRisky };
  expected.BIL = 1 - Object.values(expectedRisky).reduce((sum, weight) => sum + weight, 0);
  assertWeights(decide("g6_long_only_tsmom_1_3_12", points, signalIndex), expected);
});

test("HRP trend eligibility and single-linkage recursive allocation are deterministic", () => {
  const points = syntheticPanel(840);
  const signalIndex = 820;
  const returnsBySymbol = buildReturnsBySymbol(points, CORE_SYMBOLS);
  const cash252 = logReturn(points, CASH_SYMBOL, signalIndex - 252, signalIndex);
  const eligible = GENERATION6_CROSS_ASSET_UNIVERSE.filter((symbol) => (
    logReturn(points, symbol, signalIndex - 252, signalIndex) > cash252
      && points[signalIndex][symbol] > inclusiveSma(points, symbol, signalIndex)
  ));
  const first = generation6HierarchicalRiskParityWeights(eligible, returnsBySymbol, signalIndex);
  const second = generation6HierarchicalRiskParityWeights([...eligible].reverse(), returnsBySymbol, signalIndex);
  assert.deepEqual(second, first);
  const actual = decide("g6_hrp_trend", points, signalIndex);
  assertWeights(riskyOnly(actual), first);
  assert.deepEqual(Object.keys(riskyOnly(actual)).sort(), [...eligible].sort());
  assert.ok(Object.values(first).every((weight) => weight > 0));
  assert.ok(Math.abs(Object.values(first).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
});

test("HRP matches a closed-form two-asset allocation and fails closed on zero variance", () => {
  const signalIndex = 252;
  const assetA = Array.from({ length: signalIndex + 1 }, (_, index) => (
    index === 0 ? 0 : (index % 2 === 0 ? 0.01 : -0.01)
  ));
  const assetB = assetA.map((value) => value * 2);
  const weights = generation6HierarchicalRiskParityWeights(
    ["B", "A"],
    { A: assetA, B: assetB },
    signalIndex,
  );
  assert.ok(Math.abs(weights.A - 0.8) < 1e-12);
  assert.ok(Math.abs(weights.B - 0.2) < 1e-12);

  const constant = Array.from({ length: signalIndex + 1 }, () => 0.001);
  assert.deepEqual(
    generation6HierarchicalRiskParityWeights(["A", "B"], { A: assetA, B: constant }, signalIndex),
    {},
  );
});

test("equal-evidence ensemble is an exact quarter blend and keeps the unavailable residual quarter in BIL", () => {
  const points = syntheticPanel(840);
  for (const signalIndex of [500, 820]) {
    const componentIds = [
      "g6_trend_guard_g4",
      "g6_residual_sector",
      "g6_long_only_tsmom_1_3_12",
      "g6_hrp_trend",
    ];
    const vectors = componentIds.map((id) => decide(id, points, signalIndex));
    if (signalIndex < 756) vectors[1] = Object.freeze({ BIL: 1 });
    const expectedRisky = {};
    for (const vector of vectors) {
      for (const [symbol, weight] of Object.entries(vector)) {
        if (symbol !== CASH_SYMBOL) expectedRisky[symbol] = (expectedRisky[symbol] ?? 0) + weight / 4;
      }
    }
    const expected = { ...expectedRisky };
    expected.BIL = 1 - Object.values(expectedRisky).reduce((sum, weight) => sum + weight, 0);
    assertWeights(decide("g6_equal_evidence_ensemble", points, signalIndex), expected);
    if (signalIndex < 756) {
      const incorrectSpyQuarter = 0.25 * (decide("g6_residual_sector", points, signalIndex).SPY ?? 0);
      assert.ok(incorrectSpyQuarter > 0);
      const otherSpy = vectors.filter((_, index) => index !== 1)
        .reduce((sum, vector) => sum + (vector.SPY ?? 0) / 4, 0);
      assert.ok(Math.abs((expected.SPY ?? 0) - otherSpy) < 1e-12);
    }
  }
});

test("metadata pins executable parameters, roles, and source identifiers", () => {
  assert.deepEqual(Object.keys(GENERATION6_METADATA), GENERATION6_ALL_IDS);
  for (const id of GENERATION6_ALL_IDS) {
    const metadata = GENERATION6_METADATA[id];
    assert.equal(metadata.parameters.rebalance_interval_sessions, 21, id);
    assert.equal(metadata.eligible, id !== "faber_gtaa5_trend", id);
    assert.ok(Object.isFrozen(metadata) && Object.isFrozen(metadata.parameters) && Object.isFrozen(metadata.source_pins), id);
    for (const source of metadata.source_pins) {
      assert.match(source.doi, /^10\./, id);
      assert.equal(source.url, `https://doi.org/${source.doi}`, id);
      assert.ok(Object.isFrozen(source), id);
    }
  }
  assert.equal(GENERATION6_METADATA.g6_vol_target_g4.parameters.annualized_volatility_target, 0.10);
  assert.equal(GENERATION6_METADATA.g6_vol_target_g4.parameters.volatility_lookback_sessions, 22);
  assert.deepEqual(GENERATION6_METADATA.g6_long_only_tsmom_1_3_12.parameters.horizons_sessions, [21, 63, 252]);
  assert.equal(GENERATION6_METADATA.g6_long_only_tsmom_1_3_12.parameters.ewma_delta, 60 / 61);
  assert.equal(GENERATION6_METADATA.g6_residual_sector.parameters.subtract_fitted_intercept_in_score, false);
  assert.equal(GENERATION6_METADATA.g6_hrp_trend.parameters.linkage, "single");
  assert.equal(GENERATION6_METADATA.g6_hrp_trend.parameters.tie_break, "alphabetical");
  assert.deepEqual(GENERATION6_METADATA.g6_breadth_scaled_g4.source_pins.map((source) => source.doi), [
    "10.1016/j.econmod.2020.04.006",
  ]);
  assert.deepEqual(GENERATION6_METADATA.g6_equal_evidence_ensemble.source_pins.map((source) => source.doi), [
    "10.1093/rfs/hhm075",
  ]);
  assert.deepEqual(GENERATION6_METADATA.g6_equal_evidence_ensemble.parameters.components, GENERATION6_CANDIDATE_IDS.filter((id) => [
    "g6_trend_guard_g4",
    "g6_residual_sector",
    "g6_long_only_tsmom_1_3_12",
    "g6_hrp_trend",
  ].includes(id)));
});
