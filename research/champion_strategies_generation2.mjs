import {
  annualizedVolatility,
  logReturn,
  mean,
  normalizeLongWeights,
} from "./champion_engine.mjs";
import { SECTOR_SYMBOLS } from "./champion_strategies.mjs";

const CASH_SYMBOL = "BIL";

function simpleMovingAverage(points, symbol, signalIndex, lookback) {
  const start = signalIndex - lookback + 1;
  if (start < 0) return null;
  return mean(points.slice(start, signalIndex + 1).map((point) => point[symbol]));
}

function excessLogReturn(points, symbol, signalIndex, lookback) {
  const asset = logReturn(points, symbol, signalIndex - lookback, signalIndex);
  const cash = logReturn(points, CASH_SYMBOL, signalIndex - lookback, signalIndex);
  return asset === null || cash === null ? null : asset - cash;
}

function multiHorizonScore(points, symbol, signalIndex) {
  const values = [63, 126, 252].map((lookback) => excessLogReturn(points, symbol, signalIndex, lookback));
  return values.every(Number.isFinite) ? mean(values) : null;
}

function qqqRegimeIsRiskOn(points, signalIndex) {
  const average = simpleMovingAverage(points, "QQQ", signalIndex, 200);
  const momentum = logReturn(points, "QQQ", signalIndex - 63, signalIndex);
  return Number.isFinite(average) && Number.isFinite(momentum)
    && points[signalIndex].QQQ > average && momentum > 0;
}

function qqqRegimeLongOnly() {
  return Object.freeze({
    id: "qqq_regime_momentum_long_only",
    rebalanceIntervalSessions: 1,
    decide({ points, signalIndex }) {
      return normalizeLongWeights(qqqRegimeIsRiskOn(points, signalIndex) ? { QQQ: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function qqqSpyRegimeRotation() {
  return Object.freeze({
    id: "qqq_spy_regime_rotation",
    rebalanceIntervalSessions: 5,
    decide({ points, signalIndex }) {
      const qqqScore = multiHorizonScore(points, "QQQ", signalIndex);
      const spyScore = multiHorizonScore(points, "SPY", signalIndex);
      const qqqAverage = simpleMovingAverage(points, "QQQ", signalIndex, 200);
      const spyAverage = simpleMovingAverage(points, "SPY", signalIndex, 200);
      const qqqEligible = Number.isFinite(qqqAverage) && Number.isFinite(qqqScore)
        && points[signalIndex].QQQ > qqqAverage && qqqScore > 0;
      const spyEligible = Number.isFinite(spyAverage) && Number.isFinite(spyScore)
        && points[signalIndex].SPY > spyAverage && spyScore > 0;
      const selected = qqqEligible && (!spyEligible || qqqScore >= spyScore) ? "QQQ" : spyEligible ? "SPY" : null;
      return normalizeLongWeights(selected ? { [selected]: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function equityRelativeStrength(id, { absoluteGate }) {
  return Object.freeze({
    id,
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      const ranked = ["SPY", "QQQ", "IWM"].map((symbol) => ({
        symbol,
        score: multiHorizonScore(points, symbol, signalIndex),
        absolute: excessLogReturn(points, symbol, signalIndex, 252),
      })).filter((item) => Number.isFinite(item.score) && Number.isFinite(item.absolute))
        .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
      const selected = ranked[0];
      const permitted = selected && (!absoluteGate || (selected.score > 0 && selected.absolute > 0));
      return normalizeLongWeights(permitted ? { [selected.symbol]: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function sectorTopOne(id, { absoluteGate }) {
  return Object.freeze({
    id,
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      const ranked = SECTOR_SYMBOLS.map((symbol) => ({
        symbol,
        score: multiHorizonScore(points, symbol, signalIndex),
        absolute: excessLogReturn(points, symbol, signalIndex, 252),
      })).filter((item) => Number.isFinite(item.score) && Number.isFinite(item.absolute))
        .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
      const selected = ranked[0];
      const permitted = selected && (!absoluteGate || (selected.score > 0 && selected.absolute > 0));
      return normalizeLongWeights(permitted ? { [selected.symbol]: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function aegisDirectionProxySpy() {
  return Object.freeze({
    id: "aegis_direction_proxy_spy",
    rebalanceIntervalSessions: 1,
    decide({ points, signalIndex }) {
      const fiveDay = logReturn(points, "SPY", signalIndex - 5, signalIndex);
      const twentyDay = logReturn(points, "SPY", signalIndex - 20, signalIndex);
      const sma50 = simpleMovingAverage(points, "SPY", signalIndex, 50);
      const sma200 = simpleMovingAverage(points, "SPY", signalIndex, 200);
      const features = [
        fiveDay,
        twentyDay,
        points[signalIndex].SPY / sma50 - 1,
        points[signalIndex].SPY / sma200 - 1,
      ];
      if (!features.every(Number.isFinite)) {
        return normalizeLongWeights({}, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const score = features.reduce((sum, value) => sum + (value > 0 ? 1 : -1), 0);
      return normalizeLongWeights(score >= 2 ? { SPY: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function alphaPilotDailyGateProxy() {
  return Object.freeze({
    id: "alphapilot_daily_gate_proxy",
    rebalanceIntervalSessions: 1,
    decide({ points, returnsBySymbol, signalIndex }) {
      const sma20 = simpleMovingAverage(points, "SPY", signalIndex, 20);
      const sma50 = simpleMovingAverage(points, "SPY", signalIndex, 50);
      const fiveDaySimpleReturn = points[signalIndex].SPY / points[signalIndex - 5].SPY - 1;
      const dailyReturns = returnsBySymbol.SPY.slice(signalIndex - 9, signalIndex + 1);
      if (![sma20, sma50, fiveDaySimpleReturn, ...dailyReturns].every(Number.isFinite) || dailyReturns.length !== 10) {
        return normalizeLongWeights({}, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const average = mean(dailyReturns);
      const dailyVolatility = Math.sqrt(dailyReturns.reduce((sum, value) => sum + ((value - average) ** 2), 0) / 9);
      const riskOn = points[signalIndex].SPY > sma20
        && sma20 > sma50
        && fiveDaySimpleReturn > 0.01
        && dailyVolatility < 0.05;
      return normalizeLongWeights(riskOn ? { SPY: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

export function createGeneration2LongOnlyStrategies() {
  return Object.freeze([
    qqqRegimeLongOnly(),
    qqqSpyRegimeRotation(),
    equityRelativeStrength("equity_relative_strength_always", { absoluteGate: false }),
    equityRelativeStrength("equity_relative_strength_absolute", { absoluteGate: true }),
    sectorTopOne("sector_top1_always", { absoluteGate: false }),
    sectorTopOne("sector_top1_absolute", { absoluteGate: true }),
    aegisDirectionProxySpy(),
    alphaPilotDailyGateProxy(),
  ]);
}

export function createAegisLegacyProxyStrategies() {
  return Object.freeze([
    Object.freeze({
      id: "aegis_legacy_tqqq_regime_proxy",
      rebalanceBand: 0.05,
      rebalanceIntervalSessions: 1,
      decide({ points, returnsBySymbol, signalIndex }) {
        if (!qqqRegimeIsRiskOn(points, signalIndex)) {
          return normalizeLongWeights({}, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
        }
        const qqqVolatility = annualizedVolatility(returnsBySymbol.QQQ, signalIndex, 20);
        if (!Number.isFinite(qqqVolatility)) {
          return normalizeLongWeights({}, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
        }
        const raw = qqqVolatility <= 0.25 ? { TQQQ: 0.70 } : { QQQ: 1 };
        return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      },
    }),
  ]);
}

export const GENERATION2_METADATA = Object.freeze({
  qqq_regime_momentum_long_only: {
    family: "primary_long_only",
    mechanism: "QQQ only when price is above its inclusive 200-session simple average and 63-session momentum is positive; otherwise BIL",
  },
  qqq_spy_regime_rotation: {
    family: "primary_long_only",
    mechanism: "Choose QQQ or SPY by 63/126/252 relative strength only when the asset is above its own 200-session average and BIL-excess score is positive",
  },
  equity_relative_strength_always: {
    family: "primary_long_only",
    mechanism: "Always hold the strongest of SPY/QQQ/IWM by mean 63/126/252-session BIL-excess momentum",
  },
  equity_relative_strength_absolute: {
    family: "primary_long_only",
    mechanism: "Hold the strongest of SPY/QQQ/IWM only when both mean multi-horizon and 252-session BIL-excess momentum are positive; otherwise BIL",
  },
  sector_top1_always: {
    family: "primary_long_only",
    mechanism: "Always hold the strongest original-nine sector ETF by mean 63/126/252-session BIL-excess momentum",
  },
  sector_top1_absolute: {
    family: "primary_long_only",
    mechanism: "Hold the strongest original-nine sector ETF only when its mean and 252-session BIL-excess momentum are positive; otherwise BIL",
  },
  aegis_direction_proxy_spy: {
    family: "competitor_derived_primary_proxy",
    mechanism: "Clean-room MIT adaptation of AEGIS-Q's deterministic fallback: score SPY five- and 20-session returns plus distances from SMA50/SMA200 as +/-1; hold SPY at score >=2, otherwise BIL",
  },
  alphapilot_daily_gate_proxy: {
    family: "competitor_derived_primary_proxy",
    mechanism: "Clean-room proxy of AlphaPilot's public daily rule: SPY only when close>SMA20>SMA50, five-session return exceeds 1%, and 10-session daily volatility is below 5%; otherwise BIL",
  },
  aegis_legacy_tqqq_regime_proxy: {
    family: "leveraged_instrument_diagnostic",
    mechanism: "Clean-room proxy of the MIT-licensed AEGIS-Q legacy regime baseline: when QQQ is above its 200-session average and 63-session momentum is positive, hold 70% TQQQ if 20-session QQQ volatility is at most 25%, otherwise 100% QQQ; else BIL",
  },
});
