import {
  scaleRiskyWeightsToTarget,
  simulateStrategy,
} from "./champion_engine.mjs";
import { buildGeneration6RawG4Weights } from "./champion_strategies_generation6.mjs";

const CASH_SYMBOL = "BIL";
const REBALANCE_INTERVAL_SESSIONS = 21;
const SIGNAL_LOOKBACK_SESSIONS = 252;
const VOLATILITY_LOOKBACK_SESSIONS = 22;
const ANNUALIZED_VOLATILITY_TARGET = 0.20;
const MAXIMUM_TARGET_RISKY_GROSS = 1.5;
const ANNUAL_BORROW_SPREAD = 0.005;
const DEFAULT_ONE_WAY_COST_BPS = 5;

export const VOLATILITY_MANAGED_G4_CANDIDATE_ID = "g4_volatility_managed_20_target_1_5_cap";

/**
 * Research-only candidate. This object deliberately is not registered in any
 * production or frozen-attempt strategy list.
 */
export const VOLATILITY_MANAGED_G4_SPECIFICATION = Object.freeze({
  id: VOLATILITY_MANAGED_G4_CANDIDATE_ID,
  research_only: true,
  base_allocation: "50% QQQ plus three fixed one-sixth 12-minus-6 sector-momentum sleeves",
  rebalance_interval_sessions: REBALANCE_INTERVAL_SESSIONS,
  rebalance_anchor: 0,
  signal_lookback_sessions: SIGNAL_LOOKBACK_SESSIONS,
  volatility_estimator: "sample standard deviation of 22 trailing simple daily returns of the then-selected static raw G4 risky portfolio, annualized by sqrt(252)",
  volatility_lookback_sessions: VOLATILITY_LOOKBACK_SESSIONS,
  annualized_volatility_target: ANNUALIZED_VOLATILITY_TARGET,
  maximum_target_risky_gross: MAXIMUM_TARGET_RISKY_GROSS,
  residual_cash_and_financing_symbol: CASH_SYMBOL,
  annual_borrow_spread: ANNUAL_BORROW_SPREAD,
  execution: "signal at close t; rebalance at close t+1; first earned return is close t+1 to close t+2",
  holdings_drift_between_rebalances: true,
  cap_scope: "rebalance targets only; self-financing holdings may drift above 1.5 gross between rebalances",
  default_one_way_cost_bps_per_absolute_traded_notional: DEFAULT_ONE_WAY_COST_BPS,
});

/**
 * Scale the exported frozen G4 risky target by its trailing realized volatility.
 * The selected sleeves and all 22 return observations end no later than
 * signalIndex, so later panel mutations cannot change the decision.
 */
export function buildVolatilityManagedG4Weights(points, returnsBySymbol, signalIndex) {
  if (!Array.isArray(points)) throw new TypeError("points must be an array");
  if (!returnsBySymbol || typeof returnsBySymbol !== "object") {
    throw new TypeError("returnsBySymbol must be an object");
  }
  if (!Number.isSafeInteger(signalIndex) || signalIndex < 0 || signalIndex >= points.length) {
    throw new TypeError("signalIndex is outside points");
  }
  const rawG4Weights = buildGeneration6RawG4Weights(points, signalIndex);
  return scaleRiskyWeightsToTarget(rawG4Weights, {
    returnsBySymbol,
    signalIndex,
    targetVolatility: ANNUALIZED_VOLATILITY_TARGET,
    volatilityLookback: VOLATILITY_LOOKBACK_SESSIONS,
    cashSymbol: CASH_SYMBOL,
    maximumRiskyGross: MAXIMUM_TARGET_RISKY_GROSS,
  });
}

export const VOLATILITY_MANAGED_G4_CANDIDATE = Object.freeze({
  id: VOLATILITY_MANAGED_G4_CANDIDATE_ID,
  researchOnly: true,
  rebalanceIntervalSessions: REBALANCE_INTERVAL_SESSIONS,
  decide({ points, returnsBySymbol, signalIndex }) {
    return buildVolatilityManagedG4Weights(points, returnsBySymbol, signalIndex);
  },
});

/**
 * Fixture/research simulator with the economic assumptions pinned here. The
 * only exposed sensitivity is the explicit one-way trading-cost assumption.
 */
export function simulateVolatilityManagedG4Candidate(points, symbols, {
  oneWayCostBps = DEFAULT_ONE_WAY_COST_BPS,
  terminalLiquidation = true,
} = {}) {
  if (!Number.isFinite(oneWayCostBps) || oneWayCostBps < 0) {
    throw new TypeError("oneWayCostBps must be finite and nonnegative");
  }
  if (typeof terminalLiquidation !== "boolean") {
    throw new TypeError("terminalLiquidation must be boolean");
  }
  return simulateStrategy(points, symbols, VOLATILITY_MANAGED_G4_CANDIDATE, {
    cashSymbol: CASH_SYMBOL,
    lookbackSessions: SIGNAL_LOOKBACK_SESSIONS,
    rebalanceIntervalSessions: REBALANCE_INTERVAL_SESSIONS,
    rebalanceAnchor: 0,
    oneWayCostBps,
    annualBorrowSpread: ANNUAL_BORROW_SPREAD,
    maximumRiskyGross: MAXIMUM_TARGET_RISKY_GROSS,
    terminalLiquidation,
  });
}
