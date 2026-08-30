import {
  logReturn,
  normalizeLongWeights,
  round,
  scaleRiskyWeightsToTarget,
  simulateStrategy,
} from "../champion_engine.mjs";
import {
  KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS,
  KENNETH_FRENCH_10_INDUSTRY_SYMBOLS,
} from "./source.mjs";

export const INDUSTRY_VM_G4_CASH_SYMBOL = "RF";
export const INDUSTRY_VM_G4_MARKET_SYMBOL = "MARKET";
export const INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS = 21;
export const INDUSTRY_VM_G4_SIGNAL_LOOKBACK_SESSIONS = 252;
export const INDUSTRY_VM_G4_MOMENTUM_START_SESSIONS = 252;
export const INDUSTRY_VM_G4_MOMENTUM_END_SESSIONS = 126;
export const INDUSTRY_VM_G4_VOLATILITY_LOOKBACK_SESSIONS = 22;
export const INDUSTRY_VM_G4_ANNUALIZED_VOLATILITY_TARGET = 0.20;
export const INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS = 1.5;
export const INDUSTRY_VM_G4_ANNUAL_BORROW_SPREAD = 0.005;
export const INDUSTRY_VM_G4_DEFAULT_ONE_WAY_COST_BPS = 5;
export const INDUSTRY_VM_G4_TRANSACTION_COST_SYMBOLS = Object.freeze(
  KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.filter(
    (symbol) => symbol !== INDUSTRY_VM_G4_CASH_SYMBOL,
  ),
);

export const INDUSTRY_VM_G4_PRIMARY_ID = "industry_vm_g4_primary_hitec";
export const INDUSTRY_VM_G4_DIAGNOSTIC_ID = "industry_vm_g4_diagnostic_market";
export const INDUSTRY_VM_G4_UNSCALED_PRIMARY_ID = "industry_g4_primary_hitec_unscaled";

export const INDUSTRY_VM_G4_PRIMARY_SELECTION_UNIVERSE = Object.freeze(
  KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.filter((symbol) => symbol !== "HiTec"),
);
export const INDUSTRY_VM_G4_DIAGNOSTIC_SELECTION_UNIVERSE = Object.freeze([
  ...KENNETH_FRENCH_10_INDUSTRY_SYMBOLS,
]);

export const INDUSTRY_VM_G4_EXTERNAL_SPECIFICATION = Object.freeze({
  research_only: true,
  symbols: KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS,
  cash_and_financing_symbol: INDUSTRY_VM_G4_CASH_SYMBOL,
  primary: "50% HiTec plus one-sixth in each of the top three remaining industries",
  diagnostic: "50% MARKET plus one-sixth in each of the top three industries",
  momentum_window: "log price change from t-252 through t-126 inclusive of both endpoints",
  rebalance_interval_sessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
  volatility_estimator: "sample standard deviation of the selected static raw portfolio's 22 trailing simple daily returns, annualized by sqrt(252)",
  volatility_lookback_sessions: INDUSTRY_VM_G4_VOLATILITY_LOOKBACK_SESSIONS,
  annualized_volatility_target: INDUSTRY_VM_G4_ANNUALIZED_VOLATILITY_TARGET,
  maximum_target_risky_gross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
  transaction_cost_basis:
    "one-way risky-asset L1 turnover at entry, executed rebalances, and terminal liquidation; RF cash/financing weight excluded",
  annual_borrow_spread: INDUSTRY_VM_G4_ANNUAL_BORROW_SPREAD,
  borrow_spread_accounting:
    "negative RF financing is charged separately from risky-asset transaction costs",
  execution: "signal at close t; rebalance at close t+1; first earned return is close t+1 to close t+2",
});

function fail(message) {
  throw new TypeError(message);
}

function validateIndustryCostOptions(oneWayCostBps, terminalLiquidation) {
  if (!Number.isFinite(oneWayCostBps) || oneWayCostBps < 0) {
    fail("oneWayCostBps must be finite and nonnegative");
  }
  if (typeof terminalLiquidation !== "boolean") fail("terminalLiquidation must be boolean");
}

function industryEndWeights(row) {
  if (!row?.weights || !row?.asset_returns) {
    fail("industry accounting rows require weights and per-asset returns");
  }
  const grossMultiplier = 1 + Number(row.gross_return);
  if (!Number.isFinite(grossMultiplier) || grossMultiplier <= 0) {
    fail("industry accounting row has an invalid gross return");
  }
  return Object.freeze(Object.fromEntries(
    KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.map((symbol) => {
      const weight = Number(row.weights[symbol]);
      const assetReturn = Number(row.asset_returns[symbol]);
      if (!Number.isFinite(weight) || !Number.isFinite(assetReturn)) {
        fail(`industry accounting row has invalid ${symbol} values`);
      }
      return [symbol, weight * (1 + assetReturn) / grossMultiplier];
    }),
  ));
}

function withoutPriorBoundaryCosts(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => ![
    "standalone_entry",
    "standalone_entry_notional",
    "standalone_entry_cost",
    "standalone_terminal_liquidation",
    "standalone_terminal_liquidation_notional",
    "standalone_terminal_liquidation_cost",
    "terminal_liquidation",
    "terminal_liquidation_notional",
    "terminal_liquidation_cost",
  ].includes(key)));
}

function applyIndustryRiskyOnlyCosts(rows, {
  oneWayCostBps,
  standalone,
  terminalLiquidation,
}) {
  validateIndustryCostOptions(oneWayCostBps, terminalLiquidation);
  if (!Array.isArray(rows)) fail("industry accounting rows must be an array");
  if (typeof standalone !== "boolean") fail("standalone must be boolean");
  if (rows.length === 0) return Object.freeze([]);

  const cashWeights = Object.freeze(Object.fromEntries(
    KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.map((symbol) => [
      symbol,
      symbol === INDUSTRY_VM_G4_CASH_SYMBOL ? 1 : 0,
    ]),
  ));
  let priorEndWeights = cashWeights;
  const costRate = oneWayCostBps / 10_000;
  const costed = rows.map((rawRow, index) => {
    const row = withoutPriorBoundaryCosts(rawRow);
    const establishStandalone = standalone && index === 0;
    const chargeRebalance = row.rebalanced === true && !establishStandalone;
    const turnoverNotional = establishStandalone || chargeRebalance
      ? INDUSTRY_VM_G4_TRANSACTION_COST_SYMBOLS.reduce(
        (sum, symbol) => sum + Math.abs(
          Number(row.weights?.[symbol] ?? 0) - Number(priorEndWeights[symbol] ?? 0),
        ),
        0,
      )
      : 0;
    const transactionCost = turnoverNotional * costRate;
    const grossReturn = Number(row.gross_return);
    const financingSpreadCost = Number(row.financing_spread_cost);
    if (!Number.isFinite(grossReturn) || !Number.isFinite(financingSpreadCost)) {
      fail("industry accounting row has invalid return or financing cost");
    }
    const netReturn = grossReturn - transactionCost - financingSpreadCost;
    if (!Number.isFinite(netReturn) || netReturn <= -1) {
      fail("industry accounting row has an invalid net return");
    }
    const updated = {
      ...row,
      ...(establishStandalone ? {
        standalone_entry: true,
        standalone_entry_notional: round(turnoverNotional),
        standalone_entry_cost: round(transactionCost),
      } : {}),
      turnover_notional: round(turnoverNotional),
      transaction_cost: round(transactionCost),
      net_return: round(netReturn),
    };
    priorEndWeights = industryEndWeights(row);
    return updated;
  });

  if (terminalLiquidation) {
    const lastIndex = costed.length - 1;
    const last = costed[lastIndex];
    const liquidationNotional = INDUSTRY_VM_G4_TRANSACTION_COST_SYMBOLS.reduce(
      (sum, symbol) => sum + Math.abs(priorEndWeights[symbol] ?? 0),
      0,
    );
    const liquidationCost = liquidationNotional * costRate;
    const terminalFields = standalone ? {
      standalone_terminal_liquidation: true,
      standalone_terminal_liquidation_notional: round(liquidationNotional),
      standalone_terminal_liquidation_cost: round(liquidationCost),
    } : {
      terminal_liquidation: true,
      terminal_liquidation_notional: round(liquidationNotional),
      terminal_liquidation_cost: round(liquidationCost),
    };
    costed[lastIndex] = {
      ...last,
      ...terminalFields,
      turnover_notional: round(last.turnover_notional + liquidationNotional),
      transaction_cost: round(last.transaction_cost + liquidationCost),
      net_return: round(last.net_return - liquidationCost),
    };
  }
  return Object.freeze(costed.map((row) => Object.freeze(row)));
}

/**
 * Price the zero-cost causal ledger without changing the frozen shared engine.
 * RF borrowing is deliberately excluded here and remains in financing_spread_cost.
 */
export function applyIndustryVmG4RiskyOnlyTransactionCosts(simulation, {
  oneWayCostBps = INDUSTRY_VM_G4_DEFAULT_ONE_WAY_COST_BPS,
  terminalLiquidation = false,
} = {}) {
  if (!simulation || !Array.isArray(simulation.rows)) {
    fail("industry simulation must contain rows");
  }
  if (simulation.rows.some((row) => row.transaction_cost !== 0
    || Object.hasOwn(row, "terminal_liquidation"))) {
    fail("industry post-processor requires a zero-cost nonterminal simulation");
  }
  return Object.freeze({
    ...simulation,
    rows: applyIndustryRiskyOnlyCosts(simulation.rows, {
      oneWayCostBps,
      standalone: false,
      terminalLiquidation,
    }),
  });
}

/** Re-establish an independently funded evaluation window and liquidate it. */
export function rebaseIndustryVmG4RowsForStandalonePeriod(rows, {
  oneWayCostBps = INDUSTRY_VM_G4_DEFAULT_ONE_WAY_COST_BPS,
} = {}) {
  return applyIndustryRiskyOnlyCosts(rows, {
    oneWayCostBps,
    standalone: true,
    terminalLiquidation: true,
  });
}

function validateDecisionInputs(points, returnsBySymbol, signalIndex) {
  if (!Array.isArray(points)) fail("points must be an array");
  if (!returnsBySymbol || typeof returnsBySymbol !== "object" || Array.isArray(returnsBySymbol)) {
    fail("returnsBySymbol must be an object");
  }
  if (!Number.isSafeInteger(signalIndex) || signalIndex < 0 || signalIndex >= points.length) {
    fail("signalIndex is outside points");
  }
  for (const symbol of KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS) {
    if (!Array.isArray(returnsBySymbol[symbol]) || returnsBySymbol[symbol].length !== points.length) {
      fail(`returnsBySymbol is missing an exact ${symbol} series`);
    }
  }
}

function selectTopThree(points, signalIndex, universe) {
  if (signalIndex < INDUSTRY_VM_G4_MOMENTUM_START_SESSIONS) return Object.freeze([]);
  const scored = universe.map((symbol) => ({
    symbol,
    score: logReturn(
      points,
      symbol,
      signalIndex - INDUSTRY_VM_G4_MOMENTUM_START_SESSIONS,
      signalIndex - INDUSTRY_VM_G4_MOMENTUM_END_SESSIONS,
    ),
  }));
  if (scored.some(({ score }) => !Number.isFinite(score))) return Object.freeze([]);
  return Object.freeze(scored
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
    .slice(0, 3)
    .map(({ symbol }) => symbol));
}

function buildRawWeights(points, signalIndex, { coreSymbol, selectionUniverse }) {
  if (!Array.isArray(points)) fail("points must be an array");
  if (!Number.isSafeInteger(signalIndex) || signalIndex < 0 || signalIndex >= points.length) {
    fail("signalIndex is outside points");
  }
  const selected = selectTopThree(points, signalIndex, selectionUniverse);
  if (selected.length !== 3) return Object.freeze({});
  const raw = { [coreSymbol]: 0.50 };
  selected.forEach((symbol) => {
    raw[symbol] = (raw[symbol] ?? 0) + 1 / 6;
  });
  return Object.freeze(Object.fromEntries(
    Object.entries(raw).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

/** Unscaled primary target, exported for a prespecified diagnostic comparator. */
export function buildIndustryVmG4PrimaryRawWeights(points, signalIndex) {
  return buildRawWeights(points, signalIndex, {
    coreSymbol: "HiTec",
    selectionUniverse: INDUSTRY_VM_G4_PRIMARY_SELECTION_UNIVERSE,
  });
}

/** Unscaled market-core target, exported for formula-level diagnostics. */
export function buildIndustryVmG4DiagnosticRawWeights(points, signalIndex) {
  return buildRawWeights(points, signalIndex, {
    coreSymbol: INDUSTRY_VM_G4_MARKET_SYMBOL,
    selectionUniverse: INDUSTRY_VM_G4_DIAGNOSTIC_SELECTION_UNIVERSE,
  });
}

function buildScaledWeights(points, returnsBySymbol, signalIndex, {
  coreSymbol,
  selectionUniverse,
}) {
  validateDecisionInputs(points, returnsBySymbol, signalIndex);
  const raw = buildRawWeights(points, signalIndex, { coreSymbol, selectionUniverse });
  if (Object.keys(raw).length === 0) {
    return scaleRiskyWeightsToTarget({}, {
      returnsBySymbol,
      signalIndex,
      targetVolatility: INDUSTRY_VM_G4_ANNUALIZED_VOLATILITY_TARGET,
      volatilityLookback: INDUSTRY_VM_G4_VOLATILITY_LOOKBACK_SESSIONS,
      cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
      maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
    });
  }
  return scaleRiskyWeightsToTarget(raw, {
    returnsBySymbol,
    signalIndex,
    targetVolatility: INDUSTRY_VM_G4_ANNUALIZED_VOLATILITY_TARGET,
    volatilityLookback: INDUSTRY_VM_G4_VOLATILITY_LOOKBACK_SESSIONS,
    cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
    maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
  });
}

/** Primary external mechanism: HiTec core plus momentum-selected industries. */
export function buildIndustryVmG4PrimaryWeights(points, returnsBySymbol, signalIndex) {
  return buildScaledWeights(points, returnsBySymbol, signalIndex, {
    coreSymbol: "HiTec",
    selectionUniverse: INDUSTRY_VM_G4_PRIMARY_SELECTION_UNIVERSE,
  });
}

/** Diagnostic mechanism: broad MARKET core plus momentum-selected industries. */
export function buildIndustryVmG4DiagnosticWeights(points, returnsBySymbol, signalIndex) {
  return buildScaledWeights(points, returnsBySymbol, signalIndex, {
    coreSymbol: INDUSTRY_VM_G4_MARKET_SYMBOL,
    selectionUniverse: INDUSTRY_VM_G4_DIAGNOSTIC_SELECTION_UNIVERSE,
  });
}

export const INDUSTRY_VM_G4_PRIMARY_STRATEGY = Object.freeze({
  id: INDUSTRY_VM_G4_PRIMARY_ID,
  researchOnly: true,
  rebalanceIntervalSessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
  decide({ points, returnsBySymbol, signalIndex }) {
    return buildIndustryVmG4PrimaryWeights(points, returnsBySymbol, signalIndex);
  },
});

export const INDUSTRY_VM_G4_DIAGNOSTIC_STRATEGY = Object.freeze({
  id: INDUSTRY_VM_G4_DIAGNOSTIC_ID,
  researchOnly: true,
  rebalanceIntervalSessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
  decide({ points, returnsBySymbol, signalIndex }) {
    return buildIndustryVmG4DiagnosticWeights(points, returnsBySymbol, signalIndex);
  },
});

export const INDUSTRY_VM_G4_UNSCALED_PRIMARY_STRATEGY = Object.freeze({
  id: INDUSTRY_VM_G4_UNSCALED_PRIMARY_ID,
  researchOnly: true,
  comparatorOnly: true,
  rebalanceIntervalSessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
  decide({ points, signalIndex }) {
    return normalizeLongWeights(
      buildIndustryVmG4PrimaryRawWeights(points, signalIndex),
      {
        cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
        maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
      },
    );
  },
});

function simulateIndustryVmG4(points, strategy, {
  oneWayCostBps = INDUSTRY_VM_G4_DEFAULT_ONE_WAY_COST_BPS,
  terminalLiquidation = true,
  rebalanceAnchor = 0,
} = {}) {
  validateIndustryCostOptions(oneWayCostBps, terminalLiquidation);
  if (!Number.isSafeInteger(rebalanceAnchor)
    || rebalanceAnchor < 0
    || rebalanceAnchor >= INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS) {
    fail("rebalanceAnchor must be an integer from 0 through 20");
  }
  const zeroCostSimulation = simulateStrategy(
    points,
    KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS,
    strategy,
    {
      cashSymbol: INDUSTRY_VM_G4_CASH_SYMBOL,
      lookbackSessions: INDUSTRY_VM_G4_SIGNAL_LOOKBACK_SESSIONS,
      rebalanceIntervalSessions: INDUSTRY_VM_G4_REBALANCE_INTERVAL_SESSIONS,
      rebalanceAnchor,
      oneWayCostBps: 0,
      annualBorrowSpread: INDUSTRY_VM_G4_ANNUAL_BORROW_SPREAD,
      maximumRiskyGross: INDUSTRY_VM_G4_MAXIMUM_TARGET_RISKY_GROSS,
      terminalLiquidation: false,
    },
  );
  return applyIndustryVmG4RiskyOnlyTransactionCosts(zeroCostSimulation, {
    oneWayCostBps,
    terminalLiquidation,
  });
}

export function simulateIndustryVmG4Primary(points, options) {
  return simulateIndustryVmG4(points, INDUSTRY_VM_G4_PRIMARY_STRATEGY, options);
}

export function simulateIndustryVmG4Diagnostic(points, options) {
  return simulateIndustryVmG4(points, INDUSTRY_VM_G4_DIAGNOSTIC_STRATEGY, options);
}

export function simulateIndustryVmG4UnscaledPrimary(points, options) {
  return simulateIndustryVmG4(points, INDUSTRY_VM_G4_UNSCALED_PRIMARY_STRATEGY, options);
}
