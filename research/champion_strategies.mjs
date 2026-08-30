import {
  annualizedVolatility,
  buildPlanStrategy,
  buildReturnsBySymbol,
  inverseVolatilityWeights,
  logReturn,
  mean,
  normalizeLongWeights,
  scaleRiskyWeightsToTarget,
} from "./champion_engine.mjs";

export const CASH_SYMBOL = "BIL";

export const CORE_SYMBOLS = Object.freeze([
  "SPY", "BIL", "QQQ", "IWM", "EFA", "EEM", "IEF", "TLT", "GLD", "DBC", "VNQ",
  "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
]);

export const SECTOR_SYMBOLS = Object.freeze(["XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU"]);
export const RISK_ON_SYMBOLS = Object.freeze(["SPY", "QQQ", "IWM", "EFA", "EEM"]);
export const DEFENSIVE_SYMBOLS = Object.freeze(["IEF", "TLT", "GLD"]);
export const CROSS_ASSET_SYMBOLS = Object.freeze(["SPY", "QQQ", "IWM", "EFA", "EEM", "VNQ", "IEF", "TLT", "GLD", "DBC"]);

const MOMENTUM_HORIZONS = Object.freeze([63, 126, 252]);

function fixedStrategy(id, rawWeights, maximumRiskyGross = 1) {
  return Object.freeze({
    id,
    decide() {
      return normalizeLongWeights(rawWeights, { cashSymbol: CASH_SYMBOL, maximumRiskyGross });
    },
  });
}

function excessLogReturn(points, symbol, signalIndex, lookback) {
  const asset = logReturn(points, symbol, signalIndex - lookback, signalIndex);
  const cash = logReturn(points, CASH_SYMBOL, signalIndex - lookback, signalIndex);
  return asset === null || cash === null ? null : asset - cash;
}

function multiHorizonMomentum(points, symbol, signalIndex) {
  const values = MOMENTUM_HORIZONS.map((lookback) => excessLogReturn(points, symbol, signalIndex, lookback));
  if (values.some((value) => value === null)) return null;
  return mean(values);
}

function rankedPositiveSymbols(points, symbols, signalIndex, maximum) {
  return symbols.map((symbol) => ({
    symbol,
    score: multiHorizonMomentum(points, symbol, signalIndex),
    absolute_252: excessLogReturn(points, symbol, signalIndex, 252),
  })).filter((item) => item.score > 0 && item.absolute_252 > 0)
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
    .slice(0, maximum)
    .map((item) => item.symbol);
}

function targetVolatilityStrategy(id, buildRawWeights, {
  targetVolatility = 0.15,
  maximumRiskyGross = 1,
  volatilityLookback = 63,
  rebalanceIntervalSessions = 21,
} = {}) {
  return Object.freeze({
    id,
    rebalanceIntervalSessions,
    decide(context) {
      const rawWeights = buildRawWeights(context);
      return scaleRiskyWeightsToTarget(rawWeights, {
        returnsBySymbol: context.returnsBySymbol,
        signalIndex: context.signalIndex,
        targetVolatility,
        volatilityLookback,
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross,
      });
    },
  });
}

function frozenFinlyStrategy() {
  return Object.freeze({
    id: "frozen_finly",
    rebalanceIntervalSessions: 5,
    decide({ points, returnsBySymbol, signalIndex }) {
      const trends = [21, 63, 252].map((lookback) => excessLogReturn(points, "SPY", signalIndex, lookback));
      const positiveFraction = trends.filter((value) => value > 0).length / trends.length;
      const volatility = annualizedVolatility(returnsBySymbol.SPY, signalIndex, 20);
      const scale = Number.isFinite(volatility) && volatility > 0 ? Math.min(1, 0.10 / volatility) : 0;
      return normalizeLongWeights({ SPY: positiveFraction * scale }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function trendSpyStrategy() {
  return Object.freeze({
    id: "trend_spy_vol15",
    rebalanceIntervalSessions: 5,
    decide({ points, returnsBySymbol, signalIndex }) {
      const trends = MOMENTUM_HORIZONS.map((lookback) => excessLogReturn(points, "SPY", signalIndex, lookback));
      const positiveFraction = trends.filter((value) => value > 0).length / trends.length;
      const volatility = annualizedVolatility(returnsBySymbol.SPY, signalIndex, 20);
      const volatilityScale = Number.isFinite(volatility) && volatility > 0 ? Math.min(1, 0.15 / volatility) : 0;
      return normalizeLongWeights({ SPY: positiveFraction * volatilityScale }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function topMomentumStrategy(id, universe, count, targetVolatility) {
  return targetVolatilityStrategy(id, ({ points, returnsBySymbol, signalIndex }) => {
    const selected = rankedPositiveSymbols(points, universe, signalIndex, count);
    return inverseVolatilityWeights(selected, returnsBySymbol, signalIndex, 63);
  }, { targetVolatility, maximumRiskyGross: 1, volatilityLookback: 63 });
}

function dualMomentumStrategy() {
  return targetVolatilityStrategy("equity_dual_momentum", ({ points, signalIndex }) => {
    const rankedRisk = RISK_ON_SYMBOLS.map((symbol) => ({
      symbol,
      score: excessLogReturn(points, symbol, signalIndex, 252),
    })).sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
    if (rankedRisk[0]?.score > 0) return { [rankedRisk[0].symbol]: 1 };
    const rankedDefensive = DEFENSIVE_SYMBOLS.map((symbol) => ({
      symbol,
      score: excessLogReturn(points, symbol, signalIndex, 252),
    })).sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
    return rankedDefensive[0]?.score > 0 ? { [rankedDefensive[0].symbol]: 1 } : {};
  }, { targetVolatility: 0.15, maximumRiskyGross: 1, volatilityLookback: 63 });
}

function multiAssetTrendStrategy() {
  return targetVolatilityStrategy("multi_asset_trend_ensemble", ({ points, returnsBySymbol, signalIndex }) => {
    const unnormalized = {};
    for (const symbol of ["SPY", "TLT", "GLD"]) {
      const positiveFraction = [21, 63, 252]
        .map((lookback) => excessLogReturn(points, symbol, signalIndex, lookback))
        .filter((value) => value > 0).length / 3;
      const volatility = annualizedVolatility(returnsBySymbol[symbol], signalIndex, 20);
      unnormalized[symbol] = Number.isFinite(volatility) && volatility > 0 ? positiveFraction / volatility : 0;
    }
    const denominator = Object.values(unnormalized).reduce((sum, value) => sum + value, 0);
    return denominator > 0
      ? Object.fromEntries(Object.entries(unnormalized).map(([symbol, value]) => [symbol, value / denominator]))
      : {};
  }, { targetVolatility: 0.10, maximumRiskyGross: 1, volatilityLookback: 63, rebalanceIntervalSessions: 5 });
}

function equityBondCrossSignalStrategy() {
  return targetVolatilityStrategy("equity_bond_cross_signal", ({ points, returnsBySymbol, signalIndex }) => {
    const equityTrend = excessLogReturn(points, "SPY", signalIndex, 252);
    const bondTrend = excessLogReturn(points, "TLT", signalIndex, 252);
    const equitySignal = 0.5 * Number(equityTrend > 0) + 0.5 * Number(bondTrend > 0);
    const bondSignal = 0.5 * Number(bondTrend > 0) + 0.5 * Number(equityTrend < 0);
    const equityVolatility = annualizedVolatility(returnsBySymbol.SPY, signalIndex, 20);
    const bondVolatility = annualizedVolatility(returnsBySymbol.TLT, signalIndex, 20);
    const unnormalized = {
      SPY: Number.isFinite(equityVolatility) && equityVolatility > 0 ? equitySignal / equityVolatility : 0,
      TLT: Number.isFinite(bondVolatility) && bondVolatility > 0 ? bondSignal / bondVolatility : 0,
    };
    const denominator = unnormalized.SPY + unnormalized.TLT;
    return denominator > 0
      ? { SPY: unnormalized.SPY / denominator, TLT: unnormalized.TLT / denominator }
      : {};
  }, { targetVolatility: 0.10, maximumRiskyGross: 1, volatilityLookback: 63, rebalanceIntervalSessions: 21 });
}

function defensiveSleeveRotationStrategy() {
  return Object.freeze({
    id: "defensive_sleeve_rotation",
    rebalanceIntervalSessions: 21,
    decide({ points, returnsBySymbol, signalIndex }) {
      const spyTrends = [21, 63, 252].map((lookback) => excessLogReturn(points, "SPY", signalIndex, lookback));
      const positiveFraction = spyTrends.filter((value) => value > 0).length / spyTrends.length;
      const spyVolatility = annualizedVolatility(returnsBySymbol.SPY, signalIndex, 20);
      const spyScale = Number.isFinite(spyVolatility) && spyVolatility > 0 ? Math.min(1, 0.10 / spyVolatility) : 0;
      const spyWeight = positiveFraction * spyScale;
      const defensive = ["TLT", "GLD"].map((symbol) => ({
        symbol,
        score: excessLogReturn(points, symbol, signalIndex, 252),
      })).sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))[0];
      const raw = { SPY: spyWeight };
      if (defensive?.score > 0) raw[defensive.symbol] = 1 - spyWeight;
      return scaleRiskyWeightsToTarget(raw, {
        returnsBySymbol,
        signalIndex,
        targetVolatility: 0.10,
        volatilityLookback: 63,
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function dualHorizonVolatilityStrategy() {
  return Object.freeze({
    id: "dual_horizon_volatility_finly",
    rebalanceIntervalSessions: 5,
    decide({ points, returnsBySymbol, signalIndex }) {
      const trends = [21, 63, 252].map((lookback) => excessLogReturn(points, "SPY", signalIndex, lookback));
      const positiveFraction = trends.filter((value) => value > 0).length / trends.length;
      const vol20 = annualizedVolatility(returnsBySymbol.SPY, signalIndex, 20);
      const vol63 = annualizedVolatility(returnsBySymbol.SPY, signalIndex, 63);
      const blendedVolatility = Number.isFinite(vol20) && Number.isFinite(vol63)
        ? Math.sqrt(0.5 * (vol20 ** 2) + 0.5 * (vol63 ** 2))
        : null;
      const scale = Number.isFinite(blendedVolatility) && blendedVolatility > 0 ? Math.min(1, 0.10 / blendedVolatility) : 0;
      return normalizeLongWeights({ SPY: positiveFraction * scale }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function sectorBreadthStrategy() {
  return Object.freeze({
    id: "sector_breadth_equity_rotation",
    decide({ points, returnsBySymbol, signalIndex }) {
      const breadth = SECTOR_SYMBOLS.filter((symbol) => {
        const trend = logReturn(points, symbol, signalIndex - 200, signalIndex);
        return trend !== null && trend > 0;
      }).length / SECTOR_SYMBOLS.length;
      const equity = ["SPY", "QQQ"].map((symbol) => ({
        symbol,
        score: excessLogReturn(points, symbol, signalIndex, 252),
      })).sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))[0];
      if (!equity || equity.score <= 0 || breadth < (4 / 9)) {
        return normalizeLongWeights({}, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const volatility = annualizedVolatility(returnsBySymbol[equity.symbol], signalIndex, 20);
      const volatilityScale = Number.isFinite(volatility) && volatility > 0 ? Math.min(1, 0.15 / volatility) : 0;
      const breadthScale = Math.min(1, Math.max(0, (breadth - (1 / 3)) / (2 / 3)));
      return normalizeLongWeights(
        { [equity.symbol]: volatilityScale * breadthScale },
        { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 },
      );
    },
  });
}

export function createPrimaryStrategies() {
  return Object.freeze([
    fixedStrategy("bil_cash", {}),
    fixedStrategy("spy_buy_hold", { SPY: 1 }),
    fixedStrategy("qqq_buy_hold", { QQQ: 1 }),
    fixedStrategy("spy_levered_150", { SPY: 1.5 }, 1.5),
    fixedStrategy("sixty_forty", { SPY: 0.60, IEF: 0.40 }),
    targetVolatilityStrategy("spy_vol_target_15", () => ({ SPY: 1 }), {
      targetVolatility: 0.15,
      maximumRiskyGross: 1,
      volatilityLookback: 20,
      rebalanceIntervalSessions: 5,
    }),
    frozenFinlyStrategy(),
    multiAssetTrendStrategy(),
    equityBondCrossSignalStrategy(),
    defensiveSleeveRotationStrategy(),
    dualHorizonVolatilityStrategy(),
    trendSpyStrategy(),
    topMomentumStrategy("sector_top3_momentum", SECTOR_SYMBOLS, 3, 0.15),
    topMomentumStrategy("cross_asset_top3_momentum", CROSS_ASSET_SYMBOLS, 3, 0.12),
    dualMomentumStrategy(),
    sectorBreadthStrategy(),
  ]);
}

export const ENSEMBLE_EXPERT_IDS = Object.freeze([
  "trend_spy_vol15",
  "sector_top3_momentum",
  "cross_asset_top3_momentum",
  "equity_dual_momentum",
  "sector_breadth_equity_rotation",
]);

function rebalanceRows(simulation) {
  return simulation.rows.filter((row) => row.rebalanced);
}

function aggregateWeights(rows, probabilities, symbols) {
  const raw = {};
  for (let expertIndex = 0; expertIndex < rows.length; expertIndex += 1) {
    for (const symbol of symbols) {
      if (symbol === CASH_SYMBOL) continue;
      raw[symbol] = (raw[symbol] ?? 0) + probabilities[expertIndex] * (rows[expertIndex].signal_weights[symbol] ?? 0);
    }
  }
  return raw;
}

function normalizeProbabilities(values) {
  const denominator = values.reduce((sum, value) => sum + value, 0);
  return denominator > 0 ? values.map((value) => value / denominator) : values.map(() => 1 / values.length);
}

export function buildEnsembleStrategies(primarySimulations, points, symbols) {
  const byId = new Map(primarySimulations.map((simulation) => [simulation.id, simulation]));
  const experts = ENSEMBLE_EXPERT_IDS.map((id) => {
    const simulation = byId.get(id);
    if (!simulation) throw new Error(`missing ensemble expert ${id}`);
    return simulation;
  });
  const rowsBySignal = experts.map((simulation) => new Map(simulation.rows.map((row) => [row.signal_date, row])));
  const rebalanceDates = rebalanceRows(experts[0]).map((row) => row.signal_date);
  const pointIndex = new Map(points.map((point, index) => [point.date, index]));
  const returnsBySymbol = buildReturnsBySymbol(points, symbols);
  const equalPlan = new Map();
  const onlinePlan = new Map();
  const onlineProbabilityHistory = [];
  const expertDailyRows = experts.map((simulation) => simulation.rows);
  let probabilities = experts.map(() => 1 / experts.length);
  let previousSignalDate = null;
  const fixedShare = 0.05;
  const learningRate = 1.0;

  for (const signalDate of rebalanceDates) {
    const currentExpertRows = rowsBySignal.map((map, index) => {
      const row = map.get(signalDate);
      if (!row) throw new Error(`expert ${experts[index].id} omits rebalance ${signalDate}`);
      return row;
    });
    if (previousSignalDate !== null) {
      const rewards = expertDailyRows.map((rows) => {
        const interval = rows.filter((row) => row.execution_return_date > previousSignalDate && row.execution_return_date <= signalDate);
        const expertLog = interval.reduce((sum, row) => sum + Math.log1p(row.net_return), 0);
        const cashLog = interval.reduce((sum, row) => sum + Math.log1p(row.cash_return), 0);
        return Math.max(-1, Math.min(1, (expertLog - cashLog) / 0.10));
      });
      const updated = normalizeProbabilities(probabilities.map((probability, index) => probability * Math.exp(learningRate * rewards[index])));
      probabilities = updated.map((probability) => (1 - fixedShare) * probability + fixedShare / experts.length);
    }
    const equalRaw = aggregateWeights(currentExpertRows, experts.map(() => 1 / experts.length), symbols);
    const onlineRaw = aggregateWeights(currentExpertRows, probabilities, symbols);
    const signalIndex = pointIndex.get(signalDate);
    equalPlan.set(signalDate, scaleRiskyWeightsToTarget(equalRaw, {
      returnsBySymbol,
      signalIndex,
      targetVolatility: 0.15,
      volatilityLookback: 63,
      cashSymbol: CASH_SYMBOL,
      maximumRiskyGross: 1,
    }));
    onlinePlan.set(signalDate, scaleRiskyWeightsToTarget(onlineRaw, {
      returnsBySymbol,
      signalIndex,
      targetVolatility: 0.15,
      volatilityLookback: 63,
      cashSymbol: CASH_SYMBOL,
      maximumRiskyGross: 1,
    }));
    onlineProbabilityHistory.push(Object.freeze({
      signal_date: signalDate,
      expert_probabilities: Object.freeze(Object.fromEntries(experts.map((expert, index) => [expert.id, probabilities[index]]))),
    }));
    previousSignalDate = signalDate;
  }

  const literatureExpertIds = ["frozen_finly", "multi_asset_trend_ensemble", "equity_bond_cross_signal"];
  const literatureExperts = literatureExpertIds.map((id) => {
    const simulation = byId.get(id);
    if (!simulation) throw new Error(`missing fixed literature expert ${id}`);
    return simulation;
  });
  const literatureRowsBySignal = literatureExperts.map((simulation) => new Map(simulation.rows.map((row) => [row.signal_date, row])));
  const fixedLiteraturePlan = new Map();
  for (const signalDate of rebalanceRows(byId.get("frozen_finly")).map((row) => row.signal_date)) {
    const currentRows = literatureRowsBySignal.map((map, index) => {
      const row = map.get(signalDate);
      if (!row) throw new Error(`fixed literature expert ${literatureExpertIds[index]} omits ${signalDate}`);
      return row;
    });
    fixedLiteraturePlan.set(
      signalDate,
      normalizeLongWeights(aggregateWeights(currentRows, literatureExperts.map(() => 1 / literatureExperts.length), symbols), {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      }),
    );
  }

  return Object.freeze({
    strategies: Object.freeze([
      buildPlanStrategy("fixed_literature_model_ensemble", fixedLiteraturePlan, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
        rebalanceIntervalSessions: 5,
      }),
      buildPlanStrategy("equal_weight_expert_ensemble", equalPlan, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
        rebalanceIntervalSessions: 5,
      }),
      buildPlanStrategy("online_mwu_expert_ensemble", onlinePlan, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
        rebalanceIntervalSessions: 5,
      }),
    ]),
    online_probability_history: Object.freeze(onlineProbabilityHistory),
  });
}

export const STRATEGY_METADATA = Object.freeze({
  bil_cash: { role: "baseline", mechanism: "BIL total-return cash proxy" },
  spy_buy_hold: { role: "baseline", mechanism: "100% SPY buy and hold" },
  qqq_buy_hold: { role: "baseline", mechanism: "100% QQQ buy and hold; exposes technology/growth tilt" },
  spy_levered_150: { role: "baseline", mechanism: "150% SPY financed through negative BIL plus a fixed borrowing spread" },
  sixty_forty: { role: "baseline", mechanism: "60% SPY / 40% IEF" },
  spy_vol_target_15: { role: "baseline", mechanism: "SPY scaled down to a 15% trailing 20-session volatility target; no leverage" },
  frozen_finly: { role: "incumbent", mechanism: "21/63/252 SPY-minus-BIL trend vote, 10% volatility target, no leverage" },
  multi_asset_trend_ensemble: { role: "candidate", mechanism: "SPY/TLT/GLD positive multi-horizon trend scores, inverse-volatility weights, 10% portfolio target" },
  equity_bond_cross_signal: { role: "candidate", mechanism: "252-session equity and bond trends cross-condition SPY/TLT inverse-volatility weights" },
  defensive_sleeve_rotation: { role: "candidate", mechanism: "Frozen Finly equity sleeve plus positive 252-session TLT/GLD rotation in residual capital" },
  dual_horizon_volatility_finly: { role: "candidate", mechanism: "Frozen Finly direction with an equal-variance blend of 20- and 63-session volatility" },
  trend_spy_vol15: { role: "candidate", mechanism: "63/126/252 SPY-minus-BIL trend vote with a 15% target and no leverage" },
  sector_top3_momentum: { role: "candidate", mechanism: "Top three positive-momentum sector ETFs, inverse-volatility weighted, 15% target" },
  cross_asset_top3_momentum: { role: "candidate", mechanism: "Top three positive-momentum cross-asset ETFs, inverse-volatility weighted, 12% target" },
  equity_dual_momentum: { role: "candidate", mechanism: "Best positive 12-month risk-on ETF; otherwise best positive defensive ETF or BIL" },
  sector_breadth_equity_rotation: { role: "candidate", mechanism: "SPY/QQQ relative momentum gated and scaled by nine-sector breadth" },
  fixed_literature_model_ensemble: { role: "candidate", mechanism: "Equal fixed combination of frozen Finly, multi-asset trend, and equity-bond cross-signal weights" },
  equal_weight_expert_ensemble: { role: "candidate", mechanism: "Equal blend of five non-redundant causal experts, re-volatilized to 15%" },
  online_mwu_expert_ensemble: { role: "candidate", mechanism: "Fixed-share multiplicative weighting of five experts using only realized prior-period excess returns" },
});
