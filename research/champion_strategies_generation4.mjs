import {
  logReturn,
  mean,
  normalizeLongWeights,
} from "./champion_engine.mjs";
import { SECTOR_SYMBOLS } from "./champion_strategies.mjs";

const CASH_SYMBOL = "BIL";
const DEFENSIVE_SYMBOLS = Object.freeze(["IEF", "TLT", "GLD"]);

function excessLogReturn(points, symbol, signalIndex, lookback) {
  const asset = logReturn(points, symbol, signalIndex - lookback, signalIndex);
  const cash = logReturn(points, CASH_SYMBOL, signalIndex - lookback, signalIndex);
  return Number.isFinite(asset) && Number.isFinite(cash) ? asset - cash : null;
}

function meanExcessScore(points, symbol, signalIndex, horizons) {
  const values = horizons.map((lookback) => excessLogReturn(points, symbol, signalIndex, lookback));
  return values.every(Number.isFinite) ? mean(values) : null;
}

function inclusiveSma(points, symbol, signalIndex, lookback) {
  if (signalIndex - lookback + 1 < 0) return null;
  return mean(points.slice(signalIndex - lookback + 1, signalIndex + 1).map((point) => point[symbol]));
}

function qqqRiskOn(points, signalIndex) {
  const average = inclusiveSma(points, "QQQ", signalIndex, 200);
  const momentum = logReturn(points, "QQQ", signalIndex - 63, signalIndex);
  return Number.isFinite(average) && Number.isFinite(momentum)
    && points[signalIndex].QQQ > average && momentum > 0;
}

function ranked(points, symbols, signalIndex, score) {
  const values = symbols.map((symbol) => ({ symbol, score: score(symbol) }));
  if (!values.every((item) => Number.isFinite(item.score))) return [];
  return values.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
}

function staticSpyQqqControl() {
  return Object.freeze({
    id: "static_spy_qqq_50_50_control",
    rebalanceIntervalSessions: 21,
    decide() {
      return normalizeLongWeights({ SPY: 0.50, QQQ: 0.50 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function qqqVsSpyRelativeRegime() {
  return Object.freeze({
    id: "qqq_vs_spy_relative_regime_fully_invested",
    rebalanceIntervalSessions: 5,
    decide({ points, signalIndex }) {
      const qqqScore = meanExcessScore(points, "QQQ", signalIndex, [63, 126, 252]);
      const spyScore = meanExcessScore(points, "SPY", signalIndex, [63, 126, 252]);
      const qqqAverage = inclusiveSma(points, "QQQ", signalIndex, 200);
      const chooseQqq = Number.isFinite(qqqScore) && Number.isFinite(spyScore) && Number.isFinite(qqqAverage)
        && qqqScore > spyScore && points[signalIndex].QQQ > qqqAverage;
      return normalizeLongWeights({ [chooseQqq ? "QQQ" : "SPY"]: 1 }, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function sector12Minus6(points, symbol, signalIndex) {
  const score = logReturn(points, symbol, signalIndex - 252, signalIndex - 126);
  return Number.isFinite(score) ? score : null;
}

function topSectors(points, signalIndex) {
  return ranked(points, SECTOR_SYMBOLS, signalIndex, (symbol) => sector12Minus6(points, symbol, signalIndex))
    .slice(0, 3)
    .map((item) => item.symbol);
}

function coreSectorStrategy(id, { spyWeight, qqqWeight }) {
  return Object.freeze({
    id,
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      const selected = topSectors(points, signalIndex);
      if (selected.length !== 3) {
        return normalizeLongWeights({ SPY: spyWeight, QQQ: qqqWeight }, {
          cashSymbol: CASH_SYMBOL,
          maximumRiskyGross: 1,
        });
      }
      const raw = { SPY: spyWeight, QQQ: qqqWeight };
      const satelliteWeight = (1 - spyWeight - qqqWeight) / selected.length;
      for (const symbol of selected) raw[symbol] = (raw[symbol] ?? 0) + satelliteWeight;
      return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
    },
  });
}

function bestPositiveDefensive(points, signalIndex, horizons) {
  const ranking = ranked(points, DEFENSIVE_SYMBOLS, signalIndex, (symbol) => (
    meanExcessScore(points, symbol, signalIndex, horizons)
  ));
  return ranking[0]?.score > 0 ? ranking[0] : null;
}

function qqqDefensiveDualMomentum() {
  return Object.freeze({
    id: "qqq_defensive_dual_momentum",
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      const qqqScore = excessLogReturn(points, "QQQ", signalIndex, 252);
      if (Number.isFinite(qqqScore) && qqqScore > 0) {
        return normalizeLongWeights({ QQQ: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const defensive = bestPositiveDefensive(points, signalIndex, [252]);
      return normalizeLongWeights(defensive ? { [defensive.symbol]: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function qqqRegimeDefensiveRotation() {
  return Object.freeze({
    id: "qqq_regime_defensive_rotation",
    rebalanceIntervalSessions: 5,
    decide({ points, signalIndex }) {
      if (qqqRiskOn(points, signalIndex)) {
        return normalizeLongWeights({ QQQ: 1 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const defensive = bestPositiveDefensive(points, signalIndex, [126, 252]);
      return normalizeLongWeights(defensive ? { [defensive.symbol]: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function equityDefensiveRelativeStrength() {
  return Object.freeze({
    id: "equity_defensive_relative_strength",
    rebalanceIntervalSessions: 21,
    decide({ points, signalIndex }) {
      const ranking = ranked(points, ["QQQ", "SPY", "IWM", ...DEFENSIVE_SYMBOLS], signalIndex, (symbol) => (
        meanExcessScore(points, symbol, signalIndex, [63, 126, 252])
      ));
      const selected = ranking[0]?.score > 0 ? ranking[0].symbol : null;
      return normalizeLongWeights(selected ? { [selected]: 1 } : {}, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

function spyQqqDefensiveSleeves() {
  return Object.freeze({
    id: "spy_qqq_defensive_sleeves",
    rebalanceIntervalSessions: 5,
    decide({ points, signalIndex }) {
      if (qqqRiskOn(points, signalIndex)) {
        return normalizeLongWeights({ SPY: 0.50, QQQ: 0.50 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: 1 });
      }
      const defensive = bestPositiveDefensive(points, signalIndex, [126, 252]);
      return normalizeLongWeights({ SPY: 0.50, ...(defensive ? { [defensive.symbol]: 0.50 } : {}) }, {
        cashSymbol: CASH_SYMBOL,
        maximumRiskyGross: 1,
      });
    },
  });
}

export function createGeneration4Strategies() {
  return Object.freeze([
    staticSpyQqqControl(),
    qqqVsSpyRelativeRegime(),
    coreSectorStrategy("spy_core_qqq_sector_12_6", { spyWeight: 0.50, qqqWeight: 0.25 }),
    coreSectorStrategy("qqq_core_sector_12_6", { spyWeight: 0, qqqWeight: 0.50 }),
    qqqDefensiveDualMomentum(),
    qqqRegimeDefensiveRotation(),
    equityDefensiveRelativeStrength(),
    spyQqqDefensiveSleeves(),
  ]);
}

export const GENERATION4_METADATA = Object.freeze({
  static_spy_qqq_50_50_control: {
    role: "growth_tilt_control",
    mechanism: "Static 50% SPY / 50% QQQ; ineligible to become the agentic champion",
  },
  qqq_vs_spy_relative_regime_fully_invested: {
    role: "candidate",
    mechanism: "Every five sessions choose QQQ only when it has stronger 63/126/252 BIL-excess momentum than SPY and is above SMA200; otherwise SPY",
  },
  spy_core_qqq_sector_12_6: {
    role: "candidate",
    mechanism: "50% SPY, 25% QQQ, and 25% divided among the top three sectors by 12-minus-6 momentum",
  },
  qqq_core_sector_12_6: {
    role: "candidate",
    mechanism: "50% QQQ and 50% divided among the top three sectors by 12-minus-6 momentum",
  },
  qqq_defensive_dual_momentum: {
    role: "candidate",
    mechanism: "Monthly QQQ when its 252-session BIL-excess momentum is positive; otherwise strongest positive IEF/TLT/GLD or BIL",
  },
  qqq_regime_defensive_rotation: {
    role: "candidate",
    mechanism: "Five-session QQQ SMA200/63d risk-on rule; otherwise strongest positive IEF/TLT/GLD by 126/252 BIL-excess momentum or BIL",
  },
  equity_defensive_relative_strength: {
    role: "candidate",
    mechanism: "Monthly strongest positive QQQ/SPY/IWM/IEF/TLT/GLD by mean 63/126/252 BIL-excess momentum or BIL",
  },
  spy_qqq_defensive_sleeves: {
    role: "candidate",
    mechanism: "When QQQ is risk-on hold 50% SPY/50% QQQ; otherwise retain 50% SPY and place the other half in the strongest positive TLT/GLD/IEF or BIL",
  },
});
