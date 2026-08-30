import { compareRollingMonthlyContributions as compareLegacyRollingMonthlyContributions } from "./recurring_contribution.mjs";

function fail(message) {
  throw new TypeError(message);
}

function hasLaterWeekdayInCalendarMonth(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("invalid return date");
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let candidateDay = day + 1; candidateDay <= lastDay; candidateDay += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, candidateDay)).getUTCDay();
    if (weekday >= 1 && weekday <= 5) return true;
  }
  return false;
}

function withoutPartialTerminalMonth(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail("contribution rows are required");
  const terminalDate = rows.at(-1)?.execution_return_date;
  const terminalMonthExcluded = hasLaterWeekdayInCalendarMonth(terminalDate);
  if (!terminalMonthExcluded) {
    return Object.freeze({ rows, terminalDate, terminalMonthExcluded });
  }
  const terminalMonth = terminalDate.slice(0, 7);
  const completeRows = rows.filter((row) => row.execution_return_date.slice(0, 7) !== terminalMonth);
  if (completeRows.length === 0) fail("no observably complete calendar month remains");
  return Object.freeze({ rows: completeRows, terminalDate, terminalMonthExcluded });
}

/**
 * Audited wrapper around the frozen recurring-contribution engine. The first
 * report mistakenly treated a still-open terminal calendar month as complete.
 * This wrapper removes that month conservatively before invoking the otherwise
 * unchanged, content-addressed engine.
 */
export function compareRollingMonthlyContributions(candidateRows, benchmarkRows, options = {}) {
  if (!Array.isArray(candidateRows) || !Array.isArray(benchmarkRows)
    || candidateRows.length !== benchmarkRows.length) {
    fail("candidate and benchmark rows must have equal length");
  }
  for (let index = 0; index < candidateRows.length; index += 1) {
    if (candidateRows[index]?.execution_return_date !== benchmarkRows[index]?.execution_return_date) {
      fail("candidate and benchmark rows must share execution dates");
    }
  }
  const candidate = withoutPartialTerminalMonth(candidateRows);
  const benchmark = withoutPartialTerminalMonth(benchmarkRows);
  const result = compareLegacyRollingMonthlyContributions(candidate.rows, benchmark.rows, options);
  return Object.freeze({
    ...result,
    schema_version: "finly_rolling_monthly_contributions.v2",
    terminal_month_policy: "The final observed month is excluded when a later Monday-through-Friday calendar date remains; this conservatively prevents a partial terminal month from being labeled complete.",
    terminal_observation_date: candidate.terminalDate,
    terminal_month_excluded: candidate.terminalMonthExcluded,
  });
}
