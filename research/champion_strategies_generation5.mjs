import {
  annualizedVolatility,
  logReturn,
  mean,
  normalizeLongWeights,
  sampleStandardDeviation,
} from "./champion_engine.mjs";
import { CORE_SYMBOLS, SECTOR_SYMBOLS } from "./champion_strategies.mjs";

const CASH_SYMBOL = "BIL";
const TRADING_DAYS = 252;

export const GENERATION5_REQUIRED_SYMBOLS = Object.freeze([...CORE_SYMBOLS]);
export const GENERATION5_FLEX_UNIVERSE = Object.freeze(CORE_SYMBOLS.filter((symbol) => symbol !== CASH_SYMBOL));
export const GENERATION5_TSMOM_UNIVERSE = Object.freeze([
  "SPY", "IWM", "EFA", "EEM", "IEF", "TLT", "GLD", "DBC", "VNQ",
]);

function finiteLogReturn(points, symbol, startIndex, endIndex) {
  const value = logReturn(points, symbol, startIndex, endIndex);
  return Number.isFinite(value) ? value : null;
}

function simpleTotalReturn(points, symbol, startIndex, endIndex) {
  if (startIndex < 0 || endIndex >= points.length || startIndex >= endIndex) return null;
  const start = points[startIndex]?.[symbol];
  const end = points[endIndex]?.[symbol];
  return start > 0 && end > 0 ? end / start - 1 : null;
}

function inclusiveSma(points, symbol, signalIndex, lookback) {
  const startIndex = signalIndex - lookback + 1;
  if (startIndex < 0) return null;
  const values = points.slice(startIndex, signalIndex + 1).map((point) => point[symbol]);
  return values.length === lookback && values.every(Number.isFinite) ? mean(values) : null;
}

function descendingRank(items) {
  return [...items].sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
}

function cashOnly() {
  return normalizeLongWeights({}, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
}

function staticQqqEqualSectorsControl() {
  return Object.freeze({
    id: "static_qqq_equal_sectors_control",
    rebalanceIntervalSessions: 21,
    decide() {
      const raw = { QQQ: 0.50 };
      const equalSectorWeight = 0.50 / SECTOR_SYMBOLS.length;
      let assignedSectorWeight = 0;
      for (const symbol of SECTOR_SYMBOLS.slice(0, -1)) {
        raw[symbol] = equalSectorWeight;
        assignedSectorWeight += equalSectorWeight;
      }
      // Conserve the sector sleeve exactly in binary floating point so the
      // fully invested control cannot acquire a microscopic negative cash leg.
      raw[SECTOR_SYMBOLS.at(-1)] = 0.50 - assignedSectorWeight;
      return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function flexTopFiveVolatilityAdjustedMomentumTrend() {
  return Object.freeze({
    id: "flex_top5_voladj_momentum_trend",
    rebalanceIntervalSessions: 21,
    decide({ points, returnsBySymbol, signalIndex }) {
      const scored = GENERATION5_FLEX_UNIVERSE.map((symbol) => {
        const totalReturn = simpleTotalReturn(points, symbol, signalIndex - 252, signalIndex);
        const volatility = annualizedVolatility(returnsBySymbol[symbol], signalIndex, 252);
        return {
          symbol,
          score: Number.isFinite(totalReturn) && Number.isFinite(volatility) && volatility > 0
            ? totalReturn / volatility
            : null,
        };
      });
      if (scored.some((item) => !Number.isFinite(item.score))) return cashOnly();
      const raw = {};
      for (const item of descendingRank(scored).slice(0, 5)) {
        const average = inclusiveSma(points, item.symbol, signalIndex, 210);
        if (Number.isFinite(average) && points[signalIndex][item.symbol] > average) raw[item.symbol] = 0.20;
      }
      return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function sectorTwelveMinusOneIndividualTrend() {
  return Object.freeze({
    id: "sector_12_1_top3_individual_trend",
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      const scored = SECTOR_SYMBOLS.map((symbol) => ({
        symbol,
        score: finiteLogReturn(points, symbol, signalIndex - 252, signalIndex - 21),
      }));
      if (scored.some((item) => !Number.isFinite(item.score))) return cashOnly();
      const raw = {};
      for (const item of descendingRank(scored).slice(0, 3)) {
        const average = inclusiveSma(points, item.symbol, signalIndex, 210);
        if (Number.isFinite(average) && points[signalIndex][item.symbol] > average) raw[item.symbol] = 1 / 3;
      }
      return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function dailyLogReturn(points, symbol, endIndex) {
  return finiteLogReturn(points, symbol, endIndex - 1, endIndex);
}

function twoFactorResidualScore(points, symbol, signalIndex) {
  if (signalIndex < 756) return null;
  const training = [];
  for (let endIndex = signalIndex - 755; endIndex <= signalIndex - 252; endIndex += 1) {
    const asset = dailyLogReturn(points, symbol, endIndex);
    const spy = dailyLogReturn(points, "SPY", endIndex);
    const qqq = dailyLogReturn(points, "QQQ", endIndex);
    const cash = dailyLogReturn(points, CASH_SYMBOL, endIndex);
    if (![asset, spy, qqq, cash].every(Number.isFinite)) return null;
    training.push(Object.freeze({ x: asset - cash, market: spy - cash, growth: qqq - spy }));
  }
  const xMean = mean(training.map((row) => row.x));
  const marketMean = mean(training.map((row) => row.market));
  const growthMean = mean(training.map((row) => row.growth));
  let marketVariance = 0;
  let growthVariance = 0;
  let marketGrowthCovariance = 0;
  let marketAssetCovariance = 0;
  let growthAssetCovariance = 0;
  for (const row of training) {
    const marketCentered = row.market - marketMean;
    const growthCentered = row.growth - growthMean;
    const assetCentered = row.x - xMean;
    marketVariance += marketCentered ** 2;
    growthVariance += growthCentered ** 2;
    marketGrowthCovariance += marketCentered * growthCentered;
    marketAssetCovariance += marketCentered * assetCentered;
    growthAssetCovariance += growthCentered * assetCentered;
  }
  const determinant = marketVariance * growthVariance - marketGrowthCovariance ** 2;
  if (!(determinant > 1e-20)) return null;
  const marketBeta = (marketAssetCovariance * growthVariance
    - growthAssetCovariance * marketGrowthCovariance) / determinant;
  const growthBeta = (growthAssetCovariance * marketVariance
    - marketAssetCovariance * marketGrowthCovariance) / determinant;
  const alpha = xMean - marketBeta * marketMean - growthBeta * growthMean;
  const residuals = [];
  for (let endIndex = signalIndex - 251; endIndex <= signalIndex - 21; endIndex += 1) {
    const asset = dailyLogReturn(points, symbol, endIndex);
    const spy = dailyLogReturn(points, "SPY", endIndex);
    const qqq = dailyLogReturn(points, "QQQ", endIndex);
    const cash = dailyLogReturn(points, CASH_SYMBOL, endIndex);
    if (![asset, spy, qqq, cash].every(Number.isFinite)) return null;
    residuals.push((asset - cash) - alpha - marketBeta * (spy - cash) - growthBeta * (qqq - spy));
  }
  const deviation = sampleStandardDeviation(residuals);
  return Number.isFinite(deviation) && deviation > 0 ? mean(residuals) / deviation : null;
}

function twelveMinusOneExcess(points, symbol, signalIndex) {
  const asset = finiteLogReturn(points, symbol, signalIndex - 252, signalIndex - 21);
  const cash = finiteLogReturn(points, CASH_SYMBOL, signalIndex - 252, signalIndex - 21);
  return Number.isFinite(asset) && Number.isFinite(cash) ? asset - cash : null;
}

function qqqVersusTwoFactorResidualSectorBasket() {
  return Object.freeze({
    id: "qqq_vs_two_factor_residual_sector_basket",
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      if (signalIndex < 756) {
        return normalizeLongWeights({ QQQ: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const scored = SECTOR_SYMBOLS.map((symbol) => ({
        symbol,
        score: twoFactorResidualScore(points, symbol, signalIndex),
      }));
      if (scored.some((item) => !Number.isFinite(item.score))) {
        return normalizeLongWeights({ QQQ: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const selected = descendingRank(scored).slice(0, 3).map((item) => item.symbol);
      const sectorMomentum = mean(selected.map((symbol) => twelveMinusOneExcess(points, symbol, signalIndex)));
      const qqqMomentum = twelveMinusOneExcess(points, "QQQ", signalIndex);
      if (!Number.isFinite(sectorMomentum) || !Number.isFinite(qqqMomentum) || sectorMomentum <= qqqMomentum) {
        return normalizeLongWeights({ QQQ: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      return normalizeLongWeights(Object.fromEntries(selected.map((symbol) => [symbol, 1 / 3])), {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

export function laggedEwmaAnnualizedVolatility(returns, endIndex, delta = 60 / 61) {
  if (!Array.isArray(returns) || endIndex < 1 || endIndex >= returns.length || !(delta > 0 && delta < 1)) return null;
  let weight = 1;
  let weightSum = 0;
  let weightedReturn = 0;
  let weightedSquaredReturn = 0;
  for (let index = endIndex; index >= 1; index -= 1) {
    const value = returns[index];
    if (!Number.isFinite(value)) return null;
    weightSum += weight;
    weightedReturn += weight * value;
    weightedSquaredReturn += weight * value ** 2;
    weight *= delta;
  }
  if (!(weightSum > 0)) return null;
  const weightedMean = weightedReturn / weightSum;
  const variance = Math.max(0, weightedSquaredReturn / weightSum - weightedMean ** 2);
  const volatility = Math.sqrt(TRADING_DAYS * variance);
  return Number.isFinite(volatility) && volatility > 0 ? volatility : null;
}

function longOnlyTimeSeriesMomentumEwma() {
  return Object.freeze({
    id: "long_only_tsmom_ewma60",
    rebalanceIntervalSessions: 21,
    decide({ points, returnsBySymbol, signalIndex }) {
      const cashMomentum = finiteLogReturn(points, CASH_SYMBOL, signalIndex - 252, signalIndex);
      if (!Number.isFinite(cashMomentum)) return cashOnly();
      const eligible = [];
      for (const symbol of GENERATION5_TSMOM_UNIVERSE) {
        const momentum = finiteLogReturn(points, symbol, signalIndex - 252, signalIndex);
        if (!Number.isFinite(momentum)) return cashOnly();
        if (momentum > cashMomentum) {
          const volatility = laggedEwmaAnnualizedVolatility(returnsBySymbol[symbol], signalIndex);
          if (!Number.isFinite(volatility) || volatility <= 0) return cashOnly();
          eligible.push(Object.freeze({ symbol, inverseVolatility: 1 / volatility }));
        }
      }
      const denominator = eligible.reduce((sum, item) => sum + item.inverseVolatility, 0);
      if (!(denominator > 0)) return cashOnly();
      return normalizeLongWeights(Object.fromEntries(eligible.map((item) => [
        item.symbol,
        item.inverseVolatility / denominator,
      ])), { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

export function createGeneration5Strategies() {
  return Object.freeze([
    staticQqqEqualSectorsControl(),
    flexTopFiveVolatilityAdjustedMomentumTrend(),
    sectorTwelveMinusOneIndividualTrend(),
    qqqVersusTwoFactorResidualSectorBasket(),
    longOnlyTimeSeriesMomentumEwma(),
  ]);
}

export const GENERATION5_METADATA = Object.freeze({
  static_qqq_equal_sectors_control: Object.freeze({
    role: "growth_and_sector_control",
    eligible: false,
    mechanism: "Every 21 sessions rebalance to 50% QQQ and 50% divided equally across the original nine sector ETFs.",
    source_pins: Object.freeze([]),
  }),
  flex_top5_voladj_momentum_trend: Object.freeze({
    role: "candidate",
    eligible: true,
    mechanism: "Rank all 19 non-BIL ETFs by 252-session total return divided by 252-session annualized volatility; assign five fixed 20% slots and place each failed inclusive-SMA210 slot in BIL.",
    source_pins: Object.freeze([
      Object.freeze({
        title: "The trend is our friend: Risk parity, momentum and trend following in global asset allocation",
        authors: "Andrew Clare, James Seaton, Peter N. Smith, Stephen Thomas",
        doi: "10.1016/j.jbef.2016.01.002",
        url: "https://doi.org/10.1016/j.jbef.2016.01.002",
      }),
      Object.freeze({
        title: "Price and Momentum as Robust Tactical Approaches to Global Equity Investing",
        authors: "Owain ap Gwilym, Andrew Clare, James Seaton, Stephen Thomas",
        doi: "10.3905/joi.2010.19.3.080",
        url: "https://doi.org/10.3905/joi.2010.19.3.080",
      }),
    ]),
  }),
  sector_12_1_top3_individual_trend: Object.freeze({
    role: "candidate",
    eligible: true,
    mechanism: "Rank the original nine sectors by 12-minus-1 momentum; assign three fixed one-third slots and place each failed inclusive-SMA210 slot in BIL.",
    source_pins: Object.freeze([
      Object.freeze({
        title: "Do Industries Explain Momentum?",
        authors: "Tobias J. Moskowitz, Mark Grinblatt",
        doi: "10.1111/0022-1082.00146",
        url: "https://doi.org/10.1111/0022-1082.00146",
      }),
      Object.freeze({
        title: "Price and Momentum as Robust Tactical Approaches to Global Equity Investing",
        authors: "Owain ap Gwilym, Andrew Clare, James Seaton, Stephen Thomas",
        doi: "10.3905/joi.2010.19.3.080",
        url: "https://doi.org/10.3905/joi.2010.19.3.080",
      }),
    ]),
  }),
  qqq_vs_two_factor_residual_sector_basket: Object.freeze({
    role: "candidate",
    eligible: true,
    mechanism: "Estimate each sector's older-window SPY/BIL market and QQQ-minus-SPY growth betas, rank recent fixed-beta residual information ratios, and hold the top-three sector basket only when its 12-minus-1 BIL-excess momentum exceeds QQQ; otherwise QQQ.",
    source_pins: Object.freeze([
      Object.freeze({
        title: "Residual Momentum",
        authors: "David Blitz, Joop Huij, Martin Martens",
        doi: "10.1016/j.jempfin.2011.01.003",
        url: "https://doi.org/10.1016/j.jempfin.2011.01.003",
      }),
      Object.freeze({
        title: "Do Industries Explain Momentum?",
        authors: "Tobias J. Moskowitz, Mark Grinblatt",
        doi: "10.1111/0022-1082.00146",
        url: "https://doi.org/10.1111/0022-1082.00146",
      }),
    ]),
  }),
  long_only_tsmom_ewma60: Object.freeze({
    role: "candidate",
    eligible: true,
    mechanism: "Among nine cross-asset ETFs with positive 252-session return over BIL, allocate inverse lagged EWMA volatility with delta=60/61, normalize risky gross to one, and put the residual in BIL.",
    source_pins: Object.freeze([
      Object.freeze({
        title: "Time Series Momentum",
        authors: "Tobias J. Moskowitz, Yao Hua Ooi, Lasse Heje Pedersen",
        doi: "10.1016/j.jfineco.2011.11.003",
        url: "https://doi.org/10.1016/j.jfineco.2011.11.003",
      }),
      Object.freeze({
        title: "Time series momentum and volatility scaling",
        authors: "Abby Y. Kim, Yiuman Tse, John K. Wald",
        doi: "10.1016/j.finmar.2016.05.003",
        url: "https://doi.org/10.1016/j.finmar.2016.05.003",
      }),
    ]),
  }),
});
