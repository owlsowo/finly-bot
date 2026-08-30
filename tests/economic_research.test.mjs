import assert from "node:assert/strict";
import test from "node:test";

import {
  blockBootstrapTerminalReturns,
  buildEconomicReturnRows,
  calculateEconomicMetrics,
  calendarQuarterFoldEvidence,
  ECONOMIC_CANDIDATES,
  economicDatasetFingerprint,
  rollingWindowEvidence,
  rowsWithin,
  selectEconomicCandidate,
  validateAdjustedDailyBars,
} from "../lib/economic_research.mjs";

function risingBars(count = 620) {
  let close = 100;
  return Array.from({ length: count }, (_, index) => {
    const dailyReturn = 0.0007 + 0.002 * Math.sin(index / 9);
    close *= 1 + dailyReturn;
    return {
      t: new Date(Date.UTC(2020, 0, 1 + index)).toISOString(),
      o: close,
      h: close,
      l: close,
      c: close,
      v: 1_000_000,
    };
  });
}

function cashBars(count = 620) {
  let close = 90;
  return Array.from({ length: count }, (_, index) => {
    close *= 1.00012;
    return {
      t: new Date(Date.UTC(2020, 0, 1 + index)).toISOString(),
      o: close,
      h: close,
      l: close,
      c: close,
      v: 500_000,
    };
  });
}

test("adjusted daily bars are validated and fingerprinted deterministically", () => {
  const bars = risingBars();
  assert.equal(validateAdjustedDailyBars(bars).length, bars.length);
  assert.match(economicDatasetFingerprint(bars), /^sha256:[a-f0-9]{64}$/);
  assert.equal(economicDatasetFingerprint(bars), economicDatasetFingerprint(structuredClone(bars)));
  const reversed = structuredClone(bars);
  [reversed[10], reversed[11]] = [reversed[11], reversed[10]];
  assert.throws(() => validateAdjustedDailyBars(reversed), /strictly chronological/);
  const invalid = structuredClone(bars);
  invalid[4].c = 0;
  assert.throws(() => validateAdjustedDailyBars(invalid), /positive and finite/);
});

test("economic rows lag signals and never use observations after the realized return", () => {
  const bars = risingBars();
  const cash = cashBars();
  const rows = buildEconomicReturnRows(bars, { cashBars: cash });
  assert.equal(rows.length, bars.length - 254);
  assert.equal(rows[0].signal_date, bars[252].t.slice(0, 10));
  assert.equal(rows[0].rebalance_date, bars[253].t.slice(0, 10));
  assert.equal(rows[0].execution_return_date, bars[254].t.slice(0, 10));
  const changedFuture = structuredClone(bars);
  changedFuture[500].c *= 2;
  const changedRows = buildEconomicReturnRows(changedFuture, { cashBars: cash });
  assert.deepEqual(changedRows[100], rows[100]);
  const changedFutureCash = structuredClone(cash);
  changedFutureCash[500].c *= 2;
  const changedCashRows = buildEconomicReturnRows(bars, { cashBars: changedFutureCash });
  assert.deepEqual(changedCashRows[100], rows[100]);
  assert.throws(() => buildEconomicReturnRows(bars, { cashBars: cash.slice(1) }), /cash proxy omits/);
  assert.ok(Object.values(rows[0].strategies).every((record) => record.transaction_cost >= 0));
  assert.ok(Math.abs(rows[0].strategies.tsmom_ensemble_vol.exposure) <= 1);
});

test("metrics, dated slices, rolling evidence, and bootstrap remain bounded", () => {
  const rows = buildEconomicReturnRows(risingBars(), { cashBars: cashBars() });
  const metrics = calculateEconomicMetrics(rows, "tsmom_ensemble_vol");
  assert.ok(metrics.total_return > 0);
  assert.ok(metrics.maximum_absolute_exposure <= 1);
  assert.ok(metrics.modeled_cost_drag_simple_sum >= 0);
  const slice = rowsWithin(rows, rows[20].execution_return_date, rows[300].execution_return_date);
  assert.equal(slice.length, 281);
  const rolling = rollingWindowEvidence(rows, "tsmom_ensemble_vol", 252);
  assert.equal(rolling.window_count, rows.length - 251);
  assert.ok(rolling.positive_window_fraction >= 0 && rolling.positive_window_fraction <= 1);
  const quarters = calendarQuarterFoldEvidence(rows, "tsmom_ensemble_vol");
  assert.ok(quarters.fold_count >= 2);
  assert.ok(quarters.positive_fold_fraction >= 0 && quarters.positive_fold_fraction <= 1);
  const left = blockBootstrapTerminalReturns(slice, "tsmom_ensemble_vol", { iterations: 200, blockLength: 20, seed: 42 });
  const right = blockBootstrapTerminalReturns(slice, "tsmom_ensemble_vol", { iterations: 200, blockLength: 20, seed: 42 });
  assert.deepEqual(left, right);
  assert.ok(left.positive_terminal_return_fraction >= 0 && left.positive_terminal_return_fraction <= 1);
});

test("selection can only advance the preregistered policy", () => {
  const metric = (overrides = {}) => ({
    observations: 500,
    total_return: 0.2,
    annualized_return: 0.1,
    annualized_volatility: 0.1,
    bil_excess_sharpe: 1,
    maximum_drawdown: -0.1,
    average_exposure: 0.5,
    ...overrides,
  });
  const validation = Object.fromEntries(ECONOMIC_CANDIDATES.map((candidate) => [candidate.id, metric()]));
  validation.buy_hold = metric({ annualized_volatility: 0.2, maximum_drawdown: -0.3, bil_excess_sharpe: 0.8 });
  validation.vol_target_long = metric({ bil_excess_sharpe: 9, annualized_return: 0.9 });
  validation.tsmom_ensemble_vol = metric({ bil_excess_sharpe: 0.6 });
  const selected = selectEconomicCandidate(validation);
  assert.equal(selected.preregistered_id, "tsmom_ensemble_vol");
  assert.equal(selected.selected_id, "tsmom_ensemble_vol");
  assert.equal(selected.selection_failed_closed, false);
  validation.tsmom_ensemble_vol = metric({ total_return: -0.01, bil_excess_sharpe: -0.1 });
  const rejected = selectEconomicCandidate(validation);
  assert.equal(rejected.selected_id, null);
  assert.equal(rejected.selection_failed_closed, true);
});
