import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  annualizedVolatility,
  buildReturnsBySymbol,
  mean,
  simulateStrategy,
} from "../research/champion_engine.mjs";
import { CORE_SYMBOLS, SECTOR_SYMBOLS } from "../research/champion_strategies.mjs";
import {
  createGeneration5Strategies,
  GENERATION5_FLEX_UNIVERSE,
  GENERATION5_METADATA,
  GENERATION5_REQUIRED_SYMBOLS,
  GENERATION5_TSMOM_UNIVERSE,
  laggedEwmaAnnualizedVolatility,
} from "../research/champion_strategies_generation5.mjs";
import {
  buildGeneration5Assessments,
  GENERATION5_ALL_IDS,
  GENERATION5_CANDIDATE_IDS,
  GENERATION5_COMPARATOR_IDS,
  selectGeneration5Track,
  validateGeneration5Protocol,
} from "../research/run_quant_champion_generation5.mjs";

function syntheticPanel(length) {
  const start = Date.parse("2007-01-01T00:00:00Z");
  return Object.freeze(Array.from({ length }, (_, index) => Object.freeze({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    ...Object.fromEntries(CORE_SYMBOLS.map((symbol, symbolIndex) => {
      const cash = symbol === "BIL";
      const drift = cash ? 0.000015 : 0.00006 + 0.000004 * symbolIndex;
      const cycle = cash
        ? 0.0002 * Math.sin(index / 31)
        : 0.014 * Math.sin(index / (9 + symbolIndex)) + 0.006 * Math.cos(index / (17 + 2 * symbolIndex));
      return [symbol, 100 * Math.exp(drift * index + cycle)];
    })),
  })));
}

function byId(id) {
  const strategy = createGeneration5Strategies().find((item) => item.id === id);
  assert.ok(strategy, id);
  return strategy;
}

function decide(strategy, points, signalIndex) {
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

function inclusiveSma(points, symbol, signalIndex, lookback) {
  return mean(points.slice(signalIndex - lookback + 1, signalIndex + 1).map((point) => point[symbol]));
}

test("Generation 5 registers one counted control and four eligible candidates in trials 101-105", () => {
  assert.deepEqual(GENERATION5_REQUIRED_SYMBOLS, CORE_SYMBOLS);
  assert.deepEqual(GENERATION5_ALL_IDS, [
    "static_qqq_equal_sectors_control",
    "flex_top5_voladj_momentum_trend",
    "sector_12_1_top3_individual_trend",
    "qqq_vs_two_factor_residual_sector_basket",
    "long_only_tsmom_ewma60",
  ]);
  assert.deepEqual(GENERATION5_CANDIDATE_IDS, GENERATION5_ALL_IDS.slice(1));
  assert.equal(createGeneration5Strategies().filter((strategy) => GENERATION5_METADATA[strategy.id].eligible).length, 4);
  assert.equal(createGeneration5Strategies().filter((strategy) => !GENERATION5_METADATA[strategy.id].eligible).length, 1);
});

test("every Generation 5 rule is causal, monthly, long-only, fully funded, and unlevered", () => {
  const points = syntheticPanel(920);
  const cutoff = 865;
  const perturbed = Object.freeze(points.map((point, index) => Object.freeze(index <= cutoff ? point : {
    ...point,
    ...Object.fromEntries(CORE_SYMBOLS.filter((symbol) => symbol !== "BIL").map((symbol) => [
      symbol,
      point[symbol] * (1 + (index - cutoff) * 0.25),
    ])),
  })));
  for (const strategy of createGeneration5Strategies()) {
    assert.equal(strategy.rebalanceIntervalSessions, 21, strategy.id);
    const options = { lookbackSessions: 252, oneWayCostBps: 5, maximumRiskyGross: 1, terminalLiquidation: false };
    const simulation = simulateStrategy(points, CORE_SYMBOLS, strategy, options);
    assert.ok(simulation.rows.length > 600, strategy.id);
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

test("the static QQQ plus equal-sector control is exact", () => {
  const weights = decide(byId("static_qqq_equal_sectors_control"), syntheticPanel(300), 252);
  assert.equal(weights.QQQ, 0.5);
  for (const symbol of SECTOR_SYMBOLS) assert.ok(Math.abs(weights[symbol] - 0.5 / 9) < 1e-12, symbol);
  assert.equal(weights.BIL, 0);
});

test("flex assigns only five fixed 20% slots and routes failed trends to BIL", () => {
  const points = syntheticPanel(520);
  const signalIndex = 500;
  const weights = decide(byId("flex_top5_voladj_momentum_trend"), points, signalIndex);
  const risky = Object.entries(weights).filter(([symbol, weight]) => symbol !== "BIL" && weight > 0);
  assert.ok(risky.length <= 5);
  for (const [symbol, weight] of risky) {
    assert.equal(weight, 0.2);
    assert.ok(points[signalIndex][symbol] > inclusiveSma(points, symbol, signalIndex, 210));
  }
  assert.ok(Math.abs(weights.BIL - (1 - 0.2 * risky.length)) < 1e-12);
  assert.equal(GENERATION5_FLEX_UNIVERSE.length, 19);
});

test("sector 12-minus-1 assigns only three fixed one-third slots with individual trend gates", () => {
  const points = syntheticPanel(520);
  const signalIndex = 500;
  const weights = decide(byId("sector_12_1_top3_individual_trend"), points, signalIndex);
  const risky = Object.entries(weights).filter(([symbol, weight]) => symbol !== "BIL" && weight > 0);
  assert.ok(risky.length <= 3);
  for (const [symbol, weight] of risky) {
    assert.ok(SECTOR_SYMBOLS.includes(symbol));
    assert.ok(Math.abs(weight - 1 / 3) < 1e-12);
    assert.ok(points[signalIndex][symbol] > inclusiveSma(points, symbol, signalIndex, 210));
  }
  assert.ok(Math.abs(weights.BIL - (1 - risky.length / 3)) < 1e-12);
});

test("two-factor residual sector strategy uses QQQ before full history and only its frozen binary allocations afterward", () => {
  const points = syntheticPanel(900);
  const strategy = byId("qqq_vs_two_factor_residual_sector_basket");
  assert.deepEqual(decide(strategy, points, 755), Object.freeze({ BIL: 0, QQQ: 1 }));
  const weights = decide(strategy, points, 820);
  const risky = Object.entries(weights).filter(([symbol, weight]) => symbol !== "BIL" && weight > 0);
  const qqqFallback = risky.length === 1 && risky[0][0] === "QQQ" && risky[0][1] === 1;
  const sectorBasket = risky.length === 3 && risky.every(([symbol, weight]) => (
    SECTOR_SYMBOLS.includes(symbol) && Math.abs(weight - 1 / 3) < 1e-12
  ));
  assert.ok(qqqFallback || sectorBasket);
  assert.equal(weights.BIL, 0);
});

test("lagged EWMA volatility uses normalized delta=60/61 weights and only information through the signal", () => {
  const returns = [null, 0.01, -0.02, 0.03, -0.01];
  const delta = 60 / 61;
  const values = returns.slice(1);
  const weights = values.map((_, index) => delta ** (values.length - 1 - index));
  const denominator = weights.reduce((sum, value) => sum + value, 0);
  const weightedMean = values.reduce((sum, value, index) => sum + value * weights[index], 0) / denominator;
  const variance = values.reduce((sum, value, index) => sum + weights[index] * value ** 2, 0) / denominator - weightedMean ** 2;
  const expected = Math.sqrt(252 * variance);
  assert.ok(Math.abs(laggedEwmaAnnualizedVolatility(returns, 4) - expected) < 1e-12);
  assert.equal(laggedEwmaAnnualizedVolatility([...returns, 99], 4), laggedEwmaAnnualizedVolatility(returns, 4));
});

test("long-only TSMOM admits only positive 252-session BIL-relative assets and inverse-volatility normalizes to unit gross", () => {
  const points = syntheticPanel(520);
  const signalIndex = 500;
  const weights = decide(byId("long_only_tsmom_ewma60"), points, signalIndex);
  const cashLog = Math.log(points[signalIndex].BIL / points[signalIndex - 252].BIL);
  const risky = Object.entries(weights).filter(([symbol, weight]) => symbol !== "BIL" && weight > 0);
  for (const [symbol] of risky) {
    assert.ok(GENERATION5_TSMOM_UNIVERSE.includes(symbol));
    assert.ok(Math.log(points[signalIndex][symbol] / points[signalIndex - 252][symbol]) > cashLog);
  }
  assert.ok(Math.abs(Object.values(weights).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
  assert.ok(Math.abs(risky.reduce((sum, [, weight]) => sum + weight, 0) - (1 - weights.BIL)) < 1e-12);
});

test("protocol, ledger, comparator registry, and exact DOI pins agree with executable code", async () => {
  const protocol = JSON.parse(await readFile(new URL("../research/champion_search_generation5_protocol.json", import.meta.url), "utf8"));
  const ledger = JSON.parse(await readFile(new URL("../research/champion_trial_ledger_generation5.json", import.meta.url), "utf8"));
  const validation = validateGeneration5Protocol(protocol, ledger);
  assert.deepEqual(validation, { passes: true, reasons: [] });
  assert.deepEqual(protocol.comparators, GENERATION5_COMPARATOR_IDS);
  const dois = new Set(Object.values(GENERATION5_METADATA).flatMap((item) => item.source_pins.map((source) => source.doi)));
  assert.deepEqual([...dois].sort(), [
    "10.1016/j.finmar.2016.05.003",
    "10.1016/j.jbef.2016.01.002",
    "10.1016/j.jempfin.2011.01.003",
    "10.1016/j.jfineco.2011.11.003",
    "10.1111/0022-1082.00146",
    "10.3905/joi.2010.19.3.080",
  ]);
});

function metric(annualizedLogRate, {
  drawdown = -0.15,
  turnover = 2,
} = {}) {
  return Object.freeze({
    observations: 252,
    total_return: Math.exp(annualizedLogRate) - 1,
    maximum_drawdown: drawdown,
    annualized_turnover_notional: turnover,
  });
}

function syntheticMetrics() {
  const developmentRates = {
    spy_buy_hold: 0.10,
    qqq_buy_hold: 0.12,
    static_spy_qqq_50_50_control: 0.11,
    static_qqq_equal_sectors_control: 0.115,
    qqq_core_sector_12_6: 0.118,
    frozen_finly: 0.06,
    spy_vol_target_15: 0.09,
    bil_cash: 0.02,
    flex_top5_voladj_momentum_trend: 0.126,
    sector_12_1_top3_individual_trend: 0.132,
    qqq_vs_two_factor_residual_sector_basket: 0.15,
    long_only_tsmom_ewma60: 0.105,
  };
  const validationRates = {
    ...developmentRates,
    flex_top5_voladj_momentum_trend: 0.127,
    sector_12_1_top3_individual_trend: 0.134,
    qqq_vs_two_factor_residual_sector_basket: 0.151,
  };
  const slice = (rates) => Object.fromEntries(Object.entries(rates).map(([id, rate]) => [id, metric(rate, {
    drawdown: id === "spy_buy_hold" ? -0.20 : id === "qqq_vs_two_factor_residual_sector_basket" ? -0.19 : -0.15,
    turnover: id === "sector_12_1_top3_individual_trend" ? 3 : 2,
  })]));
  const recent = slice(validationRates);
  recent.qqq_vs_two_factor_residual_sector_basket = metric(0.151, { drawdown: -0.25, turnover: 2 });
  return Object.freeze({ development: slice(developmentRates), validation: slice(validationRates), recent_veto_only: recent });
}

test("track selection maximizes the frozen minimum edge and applies the recent veto without using recent history to rank", () => {
  const assessments = buildGeneration5Assessments(syntheticMetrics());
  assert.equal(assessments.qqq_vs_two_factor_residual_sector_basket.recent_veto.hard_safety_veto, true);
  assert.equal(assessments.long_only_tsmom_ewma60.raw_spy_gates.development_spy_edge_strictly_above_50bp, false);
  const raw = selectGeneration5Track(assessments, "raw_spy");
  const growth = selectGeneration5Track(assessments, "growth_control");
  assert.equal(raw.ranked_candidate_ids[0], "qqq_vs_two_factor_residual_sector_basket");
  assert.equal(raw.selected_id_before_post_selection_robustness, "sector_12_1_top3_individual_trend");
  assert.equal(growth.selected_id_before_post_selection_robustness, "sector_12_1_top3_individual_trend");
});

test("selection tie breaks use shallower validation drawdown, then turnover, then identifier", () => {
  const base = {
    raw_spy_score: 0.02,
    growth_control_score: 0.01,
    raw_spy_eligible_before_robustness: true,
    growth_control_eligible_before_robustness: true,
  };
  const assessments = {
    zeta: { ...base, id: "zeta", validation_maximum_drawdown: -0.20, validation_annualized_turnover_notional: 1 },
    beta: { ...base, id: "beta", validation_maximum_drawdown: -0.15, validation_annualized_turnover_notional: 3 },
    alpha: { ...base, id: "alpha", validation_maximum_drawdown: -0.15, validation_annualized_turnover_notional: 2 },
  };
  assert.deepEqual(selectGeneration5Track(assessments, "raw_spy").ranked_candidate_ids, ["alpha", "beta", "zeta"]);
});

test("the 252-session flex volatility input is the engine's causal annualized estimator", () => {
  const points = syntheticPanel(520);
  const returnsBySymbol = buildReturnsBySymbol(points, CORE_SYMBOLS);
  for (const symbol of GENERATION5_FLEX_UNIVERSE) {
    assert.ok(Number.isFinite(annualizedVolatility(returnsBySymbol[symbol], 500, 252)));
  }
});
