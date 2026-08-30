import {
  mean,
  quantile,
  round,
} from "./champion_engine.mjs";

function fail(message) {
  throw new TypeError(message);
}

function monthKey(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("invalid return date");
  return date.slice(0, 7);
}

function baseTransactionCost(row) {
  const terminal = Number(row.terminal_liquidation_cost ?? 0)
    + Number(row.standalone_terminal_liquidation_cost ?? 0);
  const cost = Number(row.transaction_cost) - terminal;
  if (!Number.isFinite(cost) || cost < -1e-10) fail("invalid base transaction cost");
  return Math.max(0, cost);
}

function stripBoundaryFields(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => ![
    "terminal_liquidation",
    "terminal_liquidation_notional",
    "terminal_liquidation_cost",
    "standalone_entry",
    "standalone_entry_notional",
    "standalone_entry_cost",
    "standalone_terminal_liquidation",
    "standalone_terminal_liquidation_notional",
    "standalone_terminal_liquidation_cost",
  ].includes(key)));
}

/**
 * Convert a slice from a continuously running strategy into a fresh-account
 * mark-to-market path. The strategy may use pre-window history to form its
 * first target, but the new account starts in BIL, pays the declared entry
 * turnover, and is not liquidated at the end of the measurement window.
 */
export function rebaseRowsForFundedWindow(rows, {
  cashSymbol = "BIL",
  oneWayCostBps = 5,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return Object.freeze([]);
  if (!Number.isFinite(oneWayCostBps) || oneWayCostBps < 0) fail("one-way cost is invalid");
  const symbols = Object.keys(rows[0].weights ?? {});
  if (!symbols.includes(cashSymbol)) fail("funded-window rows omit the cash symbol");
  let priorDate = "";
  const normalized = rows.map((row) => {
    if (!row?.weights || !row?.asset_returns) fail("funded-window rows require weights and asset returns");
    if (row.execution_return_date <= priorDate) fail("funded-window dates are not strictly increasing");
    priorDate = row.execution_return_date;
    const transactionCost = baseTransactionCost(row);
    const base = stripBoundaryFields(row);
    return {
      ...base,
      transaction_cost: round(transactionCost),
      net_return: round(row.gross_return - transactionCost - row.financing_spread_cost),
    };
  });

  const first = normalized[0];
  const cashWeights = Object.fromEntries(symbols.map((symbol) => [symbol, symbol === cashSymbol ? 1 : 0]));
  const entryNotional = symbols.reduce(
    (sum, symbol) => sum + Math.abs((first.weights[symbol] ?? 0) - cashWeights[symbol]),
    0,
  );
  const entryCost = entryNotional * oneWayCostBps / 10_000;
  normalized[0] = {
    ...first,
    funded_window_entry: true,
    funded_window_entry_notional: round(entryNotional),
    funded_window_entry_cost: round(entryCost),
    transaction_cost: round(entryCost),
    net_return: round(first.gross_return - entryCost - first.financing_spread_cost),
  };

  return Object.freeze(normalized.map((row) => Object.freeze(row)));
}

/**
 * Deposit at the start of the first return interval in each calendar month.
 * The first deposit's implementation cost is already represented by the
 * funded-window entry return. Later deposits pay one-way purchases on the
 * row's non-cash target weights. Fractional units and mark-to-market exit are
 * assumed; no minimum lot and no terminal sale are modeled.
 */
export function simulateMonthlyContributions(rows, {
  monthlyContribution = 300,
  cashSymbol = "BIL",
  contributionPurchaseCostBps = 5,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) fail("contribution rows are required");
  if (!Number.isFinite(monthlyContribution) || monthlyContribution <= 0) fail("monthly contribution must be positive");
  if (!Number.isFinite(contributionPurchaseCostBps) || contributionPurchaseCostBps < 0) {
    fail("contribution purchase cost is invalid");
  }
  let balance = 0;
  let contributed = 0;
  let contributionCostDollars = 0;
  let priorMonth = null;
  let contributionCount = 0;
  let minimumSurplus = Number.POSITIVE_INFINITY;
  let maximumBalanceDrawdown = 0;
  let peakBalance = 0;
  const path = [];

  for (const row of rows) {
    const month = monthKey(row.execution_return_date);
    let contribution = 0;
    let contributionCost = 0;
    if (month !== priorMonth) {
      contribution = monthlyContribution;
      contributed += contribution;
      contributionCount += 1;
      if (contributionCount > 1) {
        const riskyGross = Object.entries(row.weights ?? {})
          .filter(([symbol]) => symbol !== cashSymbol)
          .reduce((sum, [, weight]) => sum + Math.abs(Number(weight)), 0);
        if (!Number.isFinite(riskyGross)) fail("row risky gross is invalid");
        contributionCost = contribution * riskyGross * contributionPurchaseCostBps / 10_000;
        contributionCostDollars += contributionCost;
      }
      balance += contribution - contributionCost;
      priorMonth = month;
    }
    if (!Number.isFinite(row.net_return) || row.net_return <= -1) fail("row net return is invalid");
    balance *= 1 + row.net_return;
    peakBalance = Math.max(peakBalance, balance);
    const balanceDrawdown = peakBalance > 0 ? balance / peakBalance - 1 : 0;
    maximumBalanceDrawdown = Math.min(maximumBalanceDrawdown, balanceDrawdown);
    const surplus = balance - contributed;
    minimumSurplus = Math.min(minimumSurplus, surplus);
    path.push(Object.freeze({
      date: row.execution_return_date,
      contribution: round(contribution, 2),
      contribution_purchase_cost: round(contributionCost, 8),
      cumulative_contributions: round(contributed, 2),
      end_value: round(balance, 8),
      surplus_over_contributions: round(surplus, 8),
    }));
  }

  const gain = balance - contributed;
  return Object.freeze({
    start_date: rows[0].execution_return_date,
    end_date: rows.at(-1).execution_return_date,
    calendar_months: contributionCount,
    monthly_contribution: round(monthlyContribution, 2),
    total_contributions: round(contributed, 2),
    contribution_purchase_cost_dollars: round(contributionCostDollars, 8),
    ending_value: round(balance, 8),
    dollar_gain: round(gain, 8),
    gain_over_contributions: round(gain / contributed),
    minimum_surplus_over_contributions: round(minimumSurplus, 8),
    maximum_balance_drawdown: round(maximumBalanceDrawdown),
    profitable: gain > 0,
    path: Object.freeze(path),
  });
}

function assertAligned(candidateRows, benchmarkRows) {
  if (!Array.isArray(candidateRows) || !Array.isArray(benchmarkRows) || candidateRows.length !== benchmarkRows.length) {
    fail("candidate and benchmark rows must have equal length");
  }
  for (let index = 0; index < candidateRows.length; index += 1) {
    if (candidateRows[index].execution_return_date !== benchmarkRows[index].execution_return_date) {
      fail("candidate and benchmark rows must share execution dates");
    }
  }
}

function summarizeWindows(windows) {
  if (windows.length === 0) return null;
  const advantages = windows.map((window) => window.ending_value_advantage);
  const candidateGains = windows.map((window) => window.candidate.dollar_gain);
  const benchmarkGains = windows.map((window) => window.benchmark.dollar_gain);
  return Object.freeze({
    windows: windows.length,
    first_start_month: windows[0].start_month,
    last_start_month: windows.at(-1).start_month,
    candidate_beat_benchmark_fraction: round(advantages.filter((value) => value > 0).length / windows.length),
    candidate_profitable_fraction: round(candidateGains.filter((value) => value > 0).length / windows.length),
    benchmark_profitable_fraction: round(benchmarkGains.filter((value) => value > 0).length / windows.length),
    mean_ending_value_advantage: round(mean(advantages), 8),
    median_ending_value_advantage: round(quantile(advantages, 0.50), 8),
    p05_ending_value_advantage: round(quantile(advantages, 0.05), 8),
    p95_ending_value_advantage: round(quantile(advantages, 0.95), 8),
    worst_ending_value_advantage: round(Math.min(...advantages), 8),
    best_ending_value_advantage: round(Math.max(...advantages), 8),
    mean_candidate_dollar_gain: round(mean(candidateGains), 8),
    mean_benchmark_dollar_gain: round(mean(benchmarkGains), 8),
  });
}

export function compareRollingMonthlyContributions(candidateRows, benchmarkRows, {
  horizonsMonths = [1, 3, 6, 12],
  monthlyContribution = 300,
  cashSymbol = "BIL",
  oneWayCostBps = 5,
  minimumStartDate = null,
} = {}) {
  assertAligned(candidateRows, benchmarkRows);
  if (!Array.isArray(horizonsMonths) || horizonsMonths.length === 0
    || horizonsMonths.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    fail("horizons must contain positive integer months");
  }
  const eligibleIndices = [];
  const months = [];
  for (let index = 0; index < candidateRows.length; index += 1) {
    const date = candidateRows[index].execution_return_date;
    if (minimumStartDate && date < minimumStartDate) continue;
    eligibleIndices.push(index);
    const key = monthKey(date);
    if (months.at(-1)?.key !== key) months.push({ key, first: index, last: index });
    else months.at(-1).last = index;
  }
  if (eligibleIndices.length === 0) fail("no eligible rows remain");

  const byHorizon = {};
  for (const horizon of [...new Set(horizonsMonths)].sort((left, right) => left - right)) {
    const windows = [];
    for (let startMonthIndex = 0; startMonthIndex + horizon <= months.length; startMonthIndex += 1) {
      const startMonth = months[startMonthIndex];
      const endMonth = months[startMonthIndex + horizon - 1];
      const candidateWindow = rebaseRowsForFundedWindow(
        candidateRows.slice(startMonth.first, endMonth.last + 1),
        { cashSymbol, oneWayCostBps },
      );
      const benchmarkWindow = rebaseRowsForFundedWindow(
        benchmarkRows.slice(startMonth.first, endMonth.last + 1),
        { cashSymbol, oneWayCostBps },
      );
      const candidate = simulateMonthlyContributions(candidateWindow, {
        monthlyContribution,
        cashSymbol,
        contributionPurchaseCostBps: oneWayCostBps,
      });
      const benchmark = simulateMonthlyContributions(benchmarkWindow, {
        monthlyContribution,
        cashSymbol,
        contributionPurchaseCostBps: oneWayCostBps,
      });
      windows.push(Object.freeze({
        start_month: startMonth.key,
        end_month: endMonth.key,
        start_date: candidate.start_date,
        end_date: candidate.end_date,
        total_contributions: candidate.total_contributions,
        candidate,
        benchmark,
        ending_value_advantage: round(candidate.ending_value - benchmark.ending_value, 8),
        candidate_beat_benchmark: candidate.ending_value > benchmark.ending_value,
      }));
    }
    byHorizon[String(horizon)] = Object.freeze({
      horizon_months: horizon,
      summary: summarizeWindows(windows),
      latest_window: windows.at(-1) ?? null,
      windows: Object.freeze(windows),
    });
  }

  return Object.freeze({
    schema_version: "finly_rolling_monthly_contributions.v1",
    contribution_timing: "Gross deposit at the start of the first modeled return interval in each calendar month.",
    cost_model: "Fresh-account entry uses the engine's full L1 turnover convention; later deposits pay one-way cost on non-BIL purchases; paths end mark-to-market without liquidation.",
    implementation_boundary: "Fractional ETF units; percentage-return paths remain the frozen causal ledgers; overlapping windows are descriptive and not independent probability estimates.",
    monthly_contribution: round(monthlyContribution, 2),
    one_way_cost_bps: oneWayCostBps,
    minimum_start_date: minimumStartDate,
    horizons: Object.freeze(byHorizon),
  });
}
