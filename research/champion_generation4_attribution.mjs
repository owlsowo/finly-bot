import {
  calculatePortfolioMetrics,
  mean,
  quantile,
  rebaseRowsForStandalonePeriod,
  round,
  sampleStandardDeviation,
  rowsWithin,
} from "./champion_engine.mjs";

export const ATTRIBUTION_CANDIDATE_ID = "qqq_core_sector_12_6";
export const ATTRIBUTION_COMPARATOR_IDS = Object.freeze([
  "spy_buy_hold",
  "static_spy_qqq_50_50_control",
  "qqq_buy_hold",
]);
export const ATTRIBUTION_SECTOR_SYMBOLS = Object.freeze([
  "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
]);
export const ATTRIBUTION_ROLLING_HORIZONS = Object.freeze([5, 21, 63, 252]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function compound(returns) {
  return returns.reduce((growth, value) => growth * (1 + value), 1) - 1;
}

function correlation(left, right) {
  invariant(left.length === right.length && left.length >= 2, "correlation series are misaligned");
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const leftScale = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0));
  const rightScale = Math.sqrt(right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0));
  return leftScale > 0 && rightScale > 0 ? numerator / (leftScale * rightScale) : null;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    invariant(Math.abs(augmented[pivot][column]) > 1e-14, "regression design is singular");
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function fitDescriptiveOls(response, predictors) {
  const names = Object.keys(predictors);
  invariant(response.length >= names.length + 3, "regression has too few observations");
  invariant(names.length >= 1, "regression requires at least one predictor");
  for (const name of names) {
    invariant(predictors[name].length === response.length, `regression predictor ${name} is misaligned`);
  }
  const design = response.map((_, index) => [1, ...names.map((name) => predictors[name][index])]);
  invariant(design.flat().every(Number.isFinite) && response.every(Number.isFinite), "regression contains a non-finite value");
  const width = names.length + 1;
  const xtx = Array.from({ length: width }, () => Array(width).fill(0));
  const xty = Array(width).fill(0);
  for (let row = 0; row < design.length; row += 1) {
    for (let left = 0; left < width; left += 1) {
      xty[left] += design[row][left] * response[row];
      for (let right = 0; right < width; right += 1) {
        xtx[left][right] += design[row][left] * design[row][right];
      }
    }
  }
  const coefficients = solveLinearSystem(xtx, xty);
  const fitted = design.map((row) => row.reduce((sum, value, index) => sum + value * coefficients[index], 0));
  const responseMean = mean(response);
  const residuals = response.map((value, index) => value - fitted[index]);
  const residualSumSquares = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const totalSumSquares = response.reduce((sum, value) => sum + (value - responseMean) ** 2, 0);
  return Object.freeze({
    observations: response.length,
    intercept_daily: round(coefficients[0]),
    intercept_annualized_linearized: round(coefficients[0] * 252),
    coefficients: Object.freeze(Object.fromEntries(names.map((name, index) => [name, round(coefficients[index + 1])]))),
    r_squared: round(totalSumSquares > 0 ? 1 - residualSumSquares / totalSumSquares : null),
    residual_annualized_volatility: round(sampleStandardDeviation(residuals) * Math.sqrt(252)),
    inference: "Descriptive OLS only; no standard errors, p-values, or causal/factor-alpha interpretation.",
  });
}

export function validateAlignedRows(rowsById, requiredIds = [ATTRIBUTION_CANDIDATE_ID, ...ATTRIBUTION_COMPARATOR_IDS]) {
  for (const id of requiredIds) invariant(Array.isArray(rowsById[id]) && rowsById[id].length >= 2, `missing rows for ${id}`);
  const reference = rowsById[requiredIds[0]];
  for (const id of requiredIds.slice(1)) {
    invariant(rowsById[id].length === reference.length, `${id} row count is misaligned`);
    for (let index = 0; index < reference.length; index += 1) {
      invariant(
        rowsById[id][index].execution_return_date === reference[index].execution_return_date,
        `${id} execution date is misaligned at row ${index}`,
      );
    }
  }
  return Object.freeze({
    observations: reference.length,
    first_execution_return_date: reference[0].execution_return_date,
    last_execution_return_date: reference.at(-1).execution_return_date,
    aligned: true,
  });
}

export function sectorSelectionAttribution(rows, sectorSymbols = ATTRIBUTION_SECTOR_SYMBOLS) {
  const decisions = rows.filter((row) => row.rebalanced);
  invariant(decisions.length > 0, "candidate has no executed rebalance decisions");
  const counts = Object.fromEntries(sectorSymbols.map((symbol) => [symbol, 0]));
  let slots = 0;
  for (const row of decisions) {
    const selected = sectorSymbols.filter((symbol) => (row.signal_weights?.[symbol] ?? 0) > 1e-10);
    invariant(selected.length === 3, `${ATTRIBUTION_CANDIDATE_ID} did not hold exactly three sector targets at ${row.signal_date}`);
    for (const symbol of selected) counts[symbol] += 1;
    slots += selected.length;
  }
  return Object.freeze({
    executed_rebalance_decisions: decisions.length,
    sector_slots: slots,
    expected_sectors_per_decision: 3,
    by_sector: Object.freeze(Object.fromEntries(sectorSymbols.map((symbol) => [symbol, Object.freeze({
      selected_decisions: counts[symbol],
      decision_frequency: round(counts[symbol] / decisions.length),
      share_of_sector_slots: round(counts[symbol] / slots),
    })]))),
    denominator_note: "Decision frequency divides by executed rebalance decisions; slot share divides by three sector slots per decision.",
  });
}

export function weightAttribution(rows, symbols) {
  invariant(rows.length > 0 && symbols.length > 0, "weight attribution requires rows and symbols");
  const decisions = rows.filter((row) => row.rebalanced);
  const realizedAverage = Object.fromEntries(symbols.map((symbol) => [symbol, round(mean(rows.map((row) => row.weights[symbol] ?? 0)))]));
  const targetAverage = Object.fromEntries(symbols.map((symbol) => [symbol, round(mean(decisions.map((row) => row.signal_weights[symbol] ?? 0)))]));
  const riskyHhi = rows.map((row) => symbols.filter((symbol) => symbol !== "BIL")
    .reduce((sum, symbol) => sum + (row.weights[symbol] ?? 0) ** 2, 0));
  return Object.freeze({
    time_weighted_realized_start_of_return_weights: Object.freeze(realizedAverage),
    decision_weighted_target_weights: Object.freeze(targetAverage),
    direct_concentration_proxies: Object.freeze({
      average_qqq_weight: realizedAverage.QQQ ?? 0,
      average_xlk_weight: realizedAverage.XLK ?? 0,
      average_qqq_plus_xlk_direct_weight: round((realizedAverage.QQQ ?? 0) + (realizedAverage.XLK ?? 0)),
      average_risky_weight_hhi: round(mean(riskyHhi)),
      effective_direct_positions_from_average_hhi: round(1 / mean(riskyHhi)),
      overlap_caveat: "QQQ is itself a diversified Nasdaq-100 fund with material technology exposure; QQQ plus XLK is a direct-position proxy, not a look-through industry weight.",
    }),
  });
}

export function grossReturnContributions(rows, symbols, sectorSymbols = ATTRIBUTION_SECTOR_SYMBOLS) {
  invariant(rows.length > 0, "gross contribution attribution requires rows");
  const contributions = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
  let grossWealth = 1;
  for (const row of rows) {
    for (const symbol of symbols) {
      contributions[symbol] += grossWealth * (row.weights[symbol] ?? 0) * (row.asset_returns[symbol] ?? 0);
    }
    grossWealth *= 1 + row.gross_return;
  }
  const total = grossWealth - 1;
  const contributionSum = Object.values(contributions).reduce((sum, value) => sum + value, 0);
  const records = Object.fromEntries(symbols.map((symbol) => [symbol, Object.freeze({
    initial_capital_return_contribution: round(contributions[symbol]),
    share_of_total_gross_return: round(Math.abs(total) > 1e-12 ? contributions[symbol] / total : null),
  })]));
  const sectorContribution = sectorSymbols.reduce((sum, symbol) => sum + contributions[symbol], 0);
  return Object.freeze({
    method: "Beginning-gross-wealth times start-of-return weight times asset return; additive contributions reconcile to compounded gross return.",
    by_asset: Object.freeze(records),
    grouped_initial_capital_return_contribution: Object.freeze({
      qqq_core: round(contributions.QQQ ?? 0),
      selected_sector_satellite: round(sectorContribution),
      direct_qqq_plus_xlk: round((contributions.QQQ ?? 0) + (contributions.XLK ?? 0)),
      other: round(contributionSum - (contributions.QQQ ?? 0) - sectorContribution),
    }),
    compounded_gross_total_return: round(total),
    summed_asset_contributions: round(contributionSum),
    reconciliation_error: round(contributionSum - total),
    caveat: "This is gross portfolio arithmetic, before trading costs; QQQ and XLK are separate positions but have overlapping underlying technology exposure.",
  });
}

function describe(values) {
  invariant(values.length > 0, "distribution is empty");
  const wins = values.filter((value) => value > 0).length;
  const ties = values.filter((value) => Math.abs(value) <= 1e-14).length;
  return Object.freeze({
    count: values.length,
    mean: round(mean(values)),
    standard_deviation: round(sampleStandardDeviation(values)),
    minimum: round(Math.min(...values)),
    p05: round(quantile(values, 0.05)),
    p25: round(quantile(values, 0.25)),
    median: round(quantile(values, 0.50)),
    p75: round(quantile(values, 0.75)),
    p95: round(quantile(values, 0.95)),
    maximum: round(Math.max(...values)),
    positive_fraction: round(wins / values.length),
    tie_fraction: round(ties / values.length),
  });
}

export function rollingReturnDifferenceAttribution(candidateRows, spyRows, horizons = ATTRIBUTION_ROLLING_HORIZONS) {
  validateAlignedRows({ candidate: candidateRows, spy: spyRows }, ["candidate", "spy"]);
  return Object.freeze({
    construction: "Every overlapping window compounds the already-recorded continuous-strategy net returns; no synthetic entry or exit cost is added to each window.",
    dependence_caveat: "Windows overlap heavily and are autocorrelated. Counts and win fractions are descriptive, not independent trials or statistical significance evidence.",
    by_sessions: Object.freeze(Object.fromEntries(horizons.map((sessions) => {
      invariant(Number.isSafeInteger(sessions) && sessions > 0 && sessions <= candidateRows.length, `invalid rolling horizon ${sessions}`);
      const differences = [];
      for (let start = 0; start + sessions <= candidateRows.length; start += 1) {
        const candidateReturn = compound(candidateRows.slice(start, start + sessions).map((row) => row.net_return));
        const spyReturn = compound(spyRows.slice(start, start + sessions).map((row) => row.net_return));
        differences.push(candidateReturn - spyReturn);
      }
      return [String(sessions), Object.freeze({
        sessions,
        first_window_start: candidateRows[0].execution_return_date,
        first_window_end: candidateRows[sessions - 1].execution_return_date,
        last_window_start: candidateRows[candidateRows.length - sessions].execution_return_date,
        last_window_end: candidateRows.at(-1).execution_return_date,
        candidate_minus_spy_total_return_difference: describe(differences),
      })];
    }))),
  });
}

function standaloneRows(rows, start, end, oneWayCostBps = 5) {
  const selected = rowsWithin(rows, start, end);
  invariant(selected.length >= 2, `standalone slice ${start} through ${end} has too few rows`);
  return rebaseRowsForStandalonePeriod(selected, { cashSymbol: "BIL", oneWayCostBps });
}

export function standaloneComparison(rowsById, start, end, ids = [ATTRIBUTION_CANDIDATE_ID, ...ATTRIBUTION_COMPARATOR_IDS]) {
  const metrics = Object.fromEntries(ids.map((id) => [id, calculatePortfolioMetrics(standaloneRows(rowsById[id], start, end))]));
  const candidate = metrics[ATTRIBUTION_CANDIDATE_ID];
  return Object.freeze({
    requested_start: start,
    requested_end: end,
    observed_start: candidate.start_date,
    observed_end: candidate.end_date,
    standalone_boundary_costs_bps_one_way: 5,
    metrics: Object.freeze(metrics),
    candidate_total_return_difference: Object.freeze(Object.fromEntries(ATTRIBUTION_COMPARATOR_IDS.map((id) => [
      id,
      round(candidate.total_return - metrics[id].total_return),
    ]))),
  });
}

export function calendarYearAttribution(rowsById) {
  validateAlignedRows(rowsById);
  const candidateRows = rowsById[ATTRIBUTION_CANDIDATE_ID];
  const years = [...new Set(candidateRows.map((row) => row.execution_return_date.slice(0, 4)))];
  return Object.freeze(years.map((year) => {
    const comparison = standaloneComparison(rowsById, `${year}-01-01`, `${year}-12-31`);
    const hasOpeningTradingWeek = comparison.observed_start.slice(5) <= "01-07";
    const hasClosingTradingWeek = comparison.observed_end.slice(5) >= "12-24";
    return Object.freeze({
      year,
      partial_year: !(hasOpeningTradingWeek && hasClosingTradingWeek),
      observed_start: comparison.observed_start,
      observed_end: comparison.observed_end,
      total_returns: Object.freeze(Object.fromEntries(Object.entries(comparison.metrics).map(([id, metrics]) => [id, metrics.total_return]))),
      candidate_minus: comparison.candidate_total_return_difference,
    });
  }));
}

export function turnoverAndCostAttribution(rows) {
  invariant(rows.length > 0, "turnover attribution requires rows");
  const terminalNotional = rows.reduce((sum, row) => sum + Number(row.terminal_liquidation_notional ?? 0), 0);
  const terminalCost = rows.reduce((sum, row) => sum + Number(row.terminal_liquidation_cost ?? 0), 0);
  const executed = rows.filter((row) => row.rebalanced);
  const adjustedRebalanceTurnover = executed.map((row) => row.turnover_notional - Number(row.terminal_liquidation_notional ?? 0));
  const totalTurnover = rows.reduce((sum, row) => sum + row.turnover_notional, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.transaction_cost, 0);
  const grossTotalReturn = compound(rows.map((row) => row.gross_return));
  const netTotalReturn = compound(rows.map((row) => row.net_return));
  return Object.freeze({
    observations: rows.length,
    executed_rebalance_decisions: executed.length,
    cumulative_turnover_notional_including_terminal_liquidation: round(totalTurnover),
    cumulative_strategy_turnover_notional_excluding_terminal_liquidation: round(totalTurnover - terminalNotional),
    annualized_turnover_notional_including_terminal_liquidation: round(totalTurnover * 252 / rows.length),
    average_turnover_per_executed_rebalance_excluding_terminal_liquidation: round(mean(adjustedRebalanceTurnover)),
    rebalance_turnover_distribution_excluding_terminal_liquidation: describe(adjustedRebalanceTurnover),
    modeled_transaction_cost_simple_sum: round(totalCost),
    terminal_liquidation_notional: round(terminalNotional),
    terminal_liquidation_cost: round(terminalCost),
    transaction_cost_simple_sum_excluding_terminal_liquidation: round(totalCost - terminalCost),
    compounded_gross_total_return: round(grossTotalReturn),
    compounded_net_total_return: round(netTotalReturn),
    compounded_return_gap_gross_minus_net: round(grossTotalReturn - netTotalReturn),
    caveat: "Simple-sum costs are fractions of contemporaneous portfolio value; the gross-minus-net compounded return gap also includes compounding interactions.",
  });
}

export function factorLikeExposureAttribution(candidateRows, staticControlRows) {
  validateAlignedRows({ candidate: candidateRows, static: staticControlRows }, ["candidate", "static"]);
  const candidateExcess = [];
  const marketExcess = [];
  const growthMinusMarket = [];
  const techMinusMarket = [];
  const qqqExcess = [];
  const staticExcess = [];
  const candidateGross = [];
  const spyGross = [];
  const qqqGross = [];
  const staticGross = [];
  for (let index = 0; index < candidateRows.length; index += 1) {
    const row = candidateRows[index];
    const cash = row.asset_returns.BIL;
    const spy = row.asset_returns.SPY;
    const qqq = row.asset_returns.QQQ;
    const xlk = row.asset_returns.XLK;
    candidateExcess.push(row.gross_return - cash);
    marketExcess.push(spy - cash);
    growthMinusMarket.push(qqq - spy);
    techMinusMarket.push(xlk - spy);
    qqqExcess.push(qqq - cash);
    staticExcess.push(staticControlRows[index].gross_return - cash);
    candidateGross.push(row.gross_return);
    spyGross.push(spy);
    qqqGross.push(qqq);
    staticGross.push(staticControlRows[index].gross_return);
  }
  return Object.freeze({
    proxy_definition: "ETF-return proxies, not academic Fama-French factors: SPY-minus-BIL for market, QQQ-minus-SPY for growth/Nasdaq tilt, and XLK-minus-SPY for direct technology tilt.",
    correlations: Object.freeze({
      candidate_gross_with_spy: round(correlation(candidateGross, spyGross)),
      candidate_gross_with_qqq: round(correlation(candidateGross, qqqGross)),
      candidate_gross_with_static_spy_qqq_control: round(correlation(candidateGross, staticGross)),
      qqq_minus_spy_with_xlk_minus_spy: round(correlation(growthMinusMarket, techMinusMarket)),
    }),
    regressions: Object.freeze({
      market_and_growth_proxy: fitDescriptiveOls(candidateExcess, {
        spy_minus_bil: marketExcess,
        qqq_minus_spy: growthMinusMarket,
      }),
      static_control_and_tech_proxy: fitDescriptiveOls(candidateExcess, {
        static_spy_qqq_control_minus_bil: staticExcess,
        xlk_minus_spy: techMinusMarket,
      }),
      qqq_single_proxy: fitDescriptiveOls(candidateExcess, { qqq_minus_bil: qqqExcess }),
    }),
    interpretation_boundary: "High beta or R-squared identifies exposure resemblance, not causation. A positive fitted intercept is in-sample and post-selection; it is not investable alpha evidence.",
  });
}
