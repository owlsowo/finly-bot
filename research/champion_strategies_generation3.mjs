import {
  annualizedVolatility,
  logReturn,
  mean,
  normalizeLongWeights,
  quantile,
  sampleStandardDeviation,
} from "./champion_engine.mjs";
import { SECTOR_SYMBOLS } from "./champion_strategies.mjs";

const CASH_SYMBOL = "BIL";
const BROAD_GROWTH_SYMBOLS = Object.freeze(["SPY", "QQQ", "IWM", "EFA", "VWO", "VNQ"]);
const STYLE_SYMBOLS = Object.freeze(["VUG", "VTV", "VO", "VB"]);

export const GENERATION3_ADDITIONAL_SYMBOLS = Object.freeze(["VWO", "RSP", "VUG", "VTV", "VO", "VB"]);

function requireLogReturn(points, symbol, startIndex, endIndex) {
  const value = logReturn(points, symbol, startIndex, endIndex);
  return Number.isFinite(value) ? value : null;
}

function momentum12Minus1(points, symbol, signalIndex) {
  return requireLogReturn(points, symbol, signalIndex - 252, signalIndex - 21);
}

function momentum12Minus6(points, symbol, signalIndex) {
  return requireLogReturn(points, symbol, signalIndex - 252, signalIndex - 126);
}

function rankedSymbols(points, symbols, signalIndex, scorer, count) {
  const scored = symbols.map((symbol) => ({ symbol, score: scorer(points, symbol, signalIndex) }));
  if (!scored.every((item) => Number.isFinite(item.score))) return [];
  return scored.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
    .slice(0, count)
    .map((item) => item.symbol);
}

function corePlusEqualSatellites(selected, coreWeight = 0.5) {
  if (!Array.isArray(selected) || selected.length === 0) {
    return normalizeLongWeights({ SPY: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
  }
  const raw = { SPY: coreWeight };
  const satelliteWeight = (1 - coreWeight) / selected.length;
  for (const symbol of selected) raw[symbol] = (raw[symbol] ?? 0) + satelliteWeight;
  return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
}

function sectorCoreStrategy(id, scorer) {
  return Object.freeze({
    id,
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      return corePlusEqualSatellites(rankedSymbols(points, SECTOR_SYMBOLS, signalIndex, scorer, 3));
    },
  });
}

function dailyLogReturn(points, symbol, endIndex) {
  return requireLogReturn(points, symbol, endIndex - 1, endIndex);
}

function residualSectorScore(points, symbol, signalIndex) {
  if (signalIndex < 756) return null;
  const training = [];
  for (let endIndex = signalIndex - 755; endIndex <= signalIndex - 252; endIndex += 1) {
    const asset = dailyLogReturn(points, symbol, endIndex);
    const market = dailyLogReturn(points, "SPY", endIndex);
    if (!Number.isFinite(asset) || !Number.isFinite(market)) return null;
    training.push([asset, market]);
  }
  const assetMean = mean(training.map(([asset]) => asset));
  const marketMean = mean(training.map(([, market]) => market));
  const marketVariance = training.reduce((sum, [, market]) => sum + ((market - marketMean) ** 2), 0);
  if (!(marketVariance > 0)) return null;
  const covariance = training.reduce(
    (sum, [asset, market]) => sum + (asset - assetMean) * (market - marketMean),
    0,
  );
  const beta = covariance / marketVariance;
  const alpha = assetMean - beta * marketMean;
  const residuals = [];
  for (let endIndex = signalIndex - 251; endIndex <= signalIndex - 21; endIndex += 1) {
    const asset = dailyLogReturn(points, symbol, endIndex);
    const market = dailyLogReturn(points, "SPY", endIndex);
    if (!Number.isFinite(asset) || !Number.isFinite(market)) return null;
    residuals.push(asset - alpha - beta * market);
  }
  const deviation = sampleStandardDeviation(residuals);
  return Number.isFinite(deviation) && deviation > 0 ? mean(residuals) / deviation : null;
}

function residualSectorCoreStrategy() {
  return Object.freeze({
    id: "spy_core_residual_sector_momentum",
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      if (signalIndex < 756) {
        return normalizeLongWeights({ SPY: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      return corePlusEqualSatellites(rankedSymbols(points, SECTOR_SYMBOLS, signalIndex, residualSectorScore, 3));
    },
  });
}

function percentileRanks(scored) {
  const ranked = [...scored].sort((left, right) => right.value - left.value || left.symbol.localeCompare(right.symbol));
  return Object.fromEntries(ranked.map((item, index) => [item.symbol, (ranked.length - 1 - index) / (ranked.length - 1)]));
}

function fourSignalSectorCoreStrategy() {
  return Object.freeze({
    id: "spy_core_four_signal_sector_rank",
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      if (signalIndex < 756) {
        return normalizeLongWeights({ SPY: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const features = [
        SECTOR_SYMBOLS.map((symbol) => ({ symbol, value: momentum12Minus1(points, symbol, signalIndex) })),
        SECTOR_SYMBOLS.map((symbol) => ({ symbol, value: momentum12Minus6(points, symbol, signalIndex) })),
        SECTOR_SYMBOLS.map((symbol) => ({ symbol, value: residualSectorScore(points, symbol, signalIndex) })),
        SECTOR_SYMBOLS.map((symbol) => ({
          symbol,
          value: points[signalIndex][symbol]
            / Math.max(...points.slice(signalIndex - 251, signalIndex + 1).map((point) => point[symbol])),
        })),
      ];
      if (features.some((feature) => feature.some((item) => !Number.isFinite(item.value)))) {
        return normalizeLongWeights({ SPY: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const ranks = features.map(percentileRanks);
      const selected = SECTOR_SYMBOLS.map((symbol) => ({
        symbol,
        score: mean(ranks.map((rank) => rank[symbol])),
      })).sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
        .slice(0, 3)
        .map((item) => item.symbol);
      return corePlusEqualSatellites(selected);
    },
  });
}

function coreRotationStrategy(id, symbols) {
  return Object.freeze({
    id,
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      return corePlusEqualSatellites(rankedSymbols(points, symbols, signalIndex, momentum12Minus1, 2));
    },
  });
}

function breadthSpyRspStrategy() {
  return Object.freeze({
    id: "breadth_conditioned_spy_rsp_switch",
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      const broad = SECTOR_SYMBOLS.filter((symbol) => {
        const average = mean(points.slice(signalIndex - 199, signalIndex + 1).map((point) => point[symbol]));
        return Number.isFinite(average) && points[signalIndex][symbol] > average;
      }).length >= 6;
      return normalizeLongWeights({ [broad ? "RSP" : "SPY"]: 1 }, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function industryMomentumWeights(points, signalIndex) {
  return corePlusEqualSatellites(rankedSymbols(points, SECTOR_SYMBOLS, signalIndex, momentum12Minus1, 3));
}

function panicNeutralizedIndustryMomentum() {
  return Object.freeze({
    id: "panic_neutralized_industry_momentum",
    rebalanceIntervalSessions: 21,
    decide({ points, returnsBySymbol, signalIndex }) {
      if (signalIndex < 504) return industryMomentumWeights(points, signalIndex);
      const currentVolatility = annualizedVolatility(returnsBySymbol.SPY, signalIndex, 20);
      const historicalVolatility = [];
      for (let endIndex = signalIndex - 252; endIndex < signalIndex; endIndex += 1) {
        const volatility = annualizedVolatility(returnsBySymbol.SPY, endIndex, 20);
        if (!Number.isFinite(volatility)) return industryMomentumWeights(points, signalIndex);
        historicalVolatility.push(volatility);
      }
      const threshold = quantile(historicalVolatility, 0.80);
      const twoYearMomentum = requireLogReturn(points, "SPY", signalIndex - 504, signalIndex);
      const panic = Number.isFinite(currentVolatility) && Number.isFinite(threshold)
        && Number.isFinite(twoYearMomentum) && twoYearMomentum < 0 && currentVolatility > threshold;
      return panic
        ? normalizeLongWeights({ SPY: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 })
        : industryMomentumWeights(points, signalIndex);
    },
  });
}

export function createGeneration3Strategies() {
  return Object.freeze([
    sectorCoreStrategy("spy_core_industry_momentum_12_1", momentum12Minus1),
    sectorCoreStrategy("spy_core_industry_momentum_12_6", momentum12Minus6),
    residualSectorCoreStrategy(),
    fourSignalSectorCoreStrategy(),
    coreRotationStrategy("spy_core_broad_equity_growth_rotation", BROAD_GROWTH_SYMBOLS),
    coreRotationStrategy("spy_core_us_style_rotation", STYLE_SYMBOLS),
    breadthSpyRspStrategy(),
    panicNeutralizedIndustryMomentum(),
  ]);
}

export const GENERATION3_METADATA = Object.freeze({
  spy_core_industry_momentum_12_1: {
    family: "generation_3_primary",
    mechanism: "50% SPY plus equal weights in the top three original sectors by 12-minus-1-month momentum",
  },
  spy_core_industry_momentum_12_6: {
    family: "generation_3_primary",
    mechanism: "50% SPY plus equal weights in the top three original sectors by 12-minus-6-month intermediate momentum",
  },
  spy_core_residual_sector_momentum: {
    family: "generation_3_primary",
    mechanism: "50% SPY plus the top three sectors by market-model residual momentum; SPY-only until the 756-session estimation history exists",
  },
  spy_core_four_signal_sector_rank: {
    family: "generation_3_primary",
    mechanism: "50% SPY plus top-three sectors by equal percentile ranks of 12-1, 12-6, residual momentum, and 52-week-high proximity",
  },
  spy_core_broad_equity_growth_rotation: {
    family: "generation_3_primary",
    mechanism: "50% SPY plus 25% each in the top two of SPY/QQQ/IWM/EFA/VWO/VNQ by 12-minus-1 momentum",
  },
  spy_core_us_style_rotation: {
    family: "generation_3_primary",
    mechanism: "50% SPY plus 25% each in the top two of VUG/VTV/VO/VB by 12-minus-1 momentum",
  },
  breadth_conditioned_spy_rsp_switch: {
    family: "generation_3_primary",
    mechanism: "Hold RSP when at least six of nine sectors are above inclusive SMA200; otherwise hold SPY",
  },
  panic_neutralized_industry_momentum: {
    family: "generation_3_primary",
    mechanism: "Use the 50%-core 12-1 sector strategy except when SPY two-year momentum is negative and 20-day volatility exceeds its trailing one-year 80th percentile, then hold SPY",
  },
});
