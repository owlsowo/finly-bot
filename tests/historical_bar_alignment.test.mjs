import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
  selectAlignedIntradaySpreadBars,
} from "../lib/historical_bar_alignment.mjs";

const LONG = "SPY260918C00500000";
const SHORT = "SPY260918C00505000";

function bar(t, close = 10) {
  return {
    t,
    o: close - 0.1,
    h: close + 0.2,
    l: close - 0.2,
    c: close,
    v: 100,
    n: 20,
    vw: close - 0.02,
  };
}

function bars(times, base = 10) {
  return times.map((time, index) => bar(time, base + index * 0.1));
}

function alignedInput(overrides = {}) {
  const times = [
    "2026-08-31T13:30:00.000Z",
    "2026-08-31T13:31:00.000Z",
    "2026-09-03T19:57:00.000Z",
    "2026-09-03T19:58:00.000Z",
    "2026-09-03T19:59:00.000Z",
  ];
  return {
    legSymbols: [LONG, SHORT],
    optionBarsBySymbol: {
      [LONG]: bars(times, 10),
      [SHORT]: bars(times, 7),
    },
    spyBars: bars(times, 560),
    declaredEntryAt: "2026-08-31T13:30:15.000Z",
    declaredExitAt: "2026-09-03T20:00:00.000Z",
    ...overrides,
  };
}

test("selects the earliest safe entry interval and latest safe exit interval shared by SPY and both legs", () => {
  const result = selectAlignedIntradaySpreadBars(alignedInput());
  assert.equal(result.ok, true);
  assert.equal(result.entry.bar_start_at, "2026-08-31T13:31:00.000Z");
  assert.equal(result.entry.bar_end_at, "2026-08-31T13:32:00.000Z");
  assert.equal(result.entry.delay_seconds, 105);
  assert.equal(result.exit.bar_start_at, "2026-09-03T19:59:00.000Z");
  assert.equal(result.exit.bar_end_at, "2026-09-03T20:00:00.000Z");
  assert.equal(result.exit.staleness_seconds, 0);
  assert.equal(result.entry.spy_bar.t, result.entry.option_bars[LONG].t);
  assert.equal(result.entry.spy_bar.t, result.entry.option_bars[SHORT].t);
  assert.equal(result.exit.spy_bar.t, result.exit.option_bars[LONG].t);
  assert.equal(result.exit.spy_bar.t, result.exit.option_bars[SHORT].t);
  assert.equal(result.price_equivalence_claimed, false);
  assert.equal(result.fill_equivalence_claimed, false);
  assert.equal(result.methodology.price_semantics, "COMPLETED_OHLCV_BAR_RESEARCH_PROXY_NOT_QUOTE_NOT_FILL");
});

test("does not use the partial interval containing entry or an interval completing after exit", () => {
  const times = [
    "2026-08-31T13:30:00.000Z",
    "2026-08-31T13:31:00.000Z",
    "2026-08-31T19:58:00.000Z",
    "2026-08-31T19:59:00.000Z",
  ];
  const result = selectAlignedIntradaySpreadBars(alignedInput({
    optionBarsBySymbol: { [LONG]: bars(times), [SHORT]: bars(times) },
    spyBars: bars(times, 560),
    declaredEntryAt: "2026-08-31T13:30:30.000Z",
    declaredExitAt: "2026-08-31T19:59:30.000Z",
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entry.bar_start_at, "2026-08-31T13:31:00.000Z");
  assert.equal(result.exit.bar_start_at, "2026-08-31T19:58:00.000Z");
});

test("advances deterministically to the first later interval with exact three-series alignment", () => {
  const entryTimes = [
    "2026-08-31T13:31:00.000Z",
    "2026-08-31T13:32:00.000Z",
    "2026-09-03T19:59:00.000Z",
  ];
  const result = selectAlignedIntradaySpreadBars(alignedInput({
    optionBarsBySymbol: {
      [LONG]: bars(entryTimes),
      [SHORT]: bars(entryTimes.slice(1)),
    },
    spyBars: bars(entryTimes, 560),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entry.bar_start_at, "2026-08-31T13:32:00.000Z");
  assert.equal(result.entry.delay_seconds, 165);
});

test("uses a prior exit minute only when all three series share it within the staleness bound", () => {
  const allTimes = [
    "2026-08-31T13:31:00.000Z",
    "2026-09-03T19:57:00.000Z",
    "2026-09-03T19:58:00.000Z",
    "2026-09-03T19:59:00.000Z",
  ];
  const withoutLast = allTimes.slice(0, -1);
  const result = selectAlignedIntradaySpreadBars(alignedInput({
    optionBarsBySymbol: { [LONG]: bars(allTimes), [SHORT]: bars(allTimes) },
    spyBars: bars(withoutLast, 560),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exit.bar_start_at, "2026-09-03T19:58:00.000Z");
  assert.equal(result.exit.staleness_seconds, 60);
});

test("missing or too-distant common intervals fail closed without interpolation", () => {
  const distantEntry = "2026-08-31T13:35:00.000Z";
  const exit = "2026-09-03T19:59:00.000Z";
  const entryFailure = selectAlignedIntradaySpreadBars(alignedInput({
    optionBarsBySymbol: {
      [LONG]: bars([distantEntry, exit]),
      [SHORT]: bars([distantEntry, exit]),
    },
    spyBars: bars([distantEntry, exit], 560),
  }));
  assert.equal(entryFailure.ok, false);
  assert.equal(entryFailure.reason, "NO_ALIGNED_ENTRY_INTERVAL");
  assert.equal(entryFailure.methodology.price_semantics, "COMPLETED_OHLCV_BAR_RESEARCH_PROXY_NOT_QUOTE_NOT_FILL");

  const entry = "2026-08-31T13:31:00.000Z";
  const staleExit = "2026-09-03T19:53:00.000Z";
  const exitFailure = selectAlignedIntradaySpreadBars(alignedInput({
    optionBarsBySymbol: {
      [LONG]: bars([entry, staleExit]),
      [SHORT]: bars([entry, staleExit]),
    },
    spyBars: bars([entry, staleExit], 560),
  }));
  assert.equal(exitFailure.ok, false);
  assert.equal(exitFailure.reason, "NO_ALIGNED_EXIT_INTERVAL");
  assert.equal(exitFailure.entry.bar_start_at, entry);
});

test("an aligned exit interval must chronologically follow the entry interval", () => {
  const only = "2026-08-31T13:31:00.000Z";
  const result = selectAlignedIntradaySpreadBars(alignedInput({
    optionBarsBySymbol: { [LONG]: bars([only]), [SHORT]: bars([only]) },
    spyBars: bars([only], 560),
    declaredEntryAt: "2026-08-31T13:30:00.000Z",
    declaredExitAt: "2026-08-31T13:32:00.000Z",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ALIGNED_EXIT_DOES_NOT_FOLLOW_ENTRY");
});

test("rejects anything other than one SPY vertical and exact one-minute inputs", () => {
  assert.throws(() => selectAlignedIntradaySpreadBars(alignedInput({ timeframe: "1Day" })), /exact 1Min/);
  assert.throws(() => selectAlignedIntradaySpreadBars(alignedInput({ legSymbols: [LONG] })), /exactly two/);
  assert.throws(
    () => selectAlignedIntradaySpreadBars(alignedInput({ legSymbols: [LONG, "AAPL260918C00505000"] })),
    /SPY as the underlying/,
  );
  assert.throws(
    () => selectAlignedIntradaySpreadBars(alignedInput({ legSymbols: [LONG, "SPY260918P00505000"] })),
    /vertical spread/,
  );
  assert.throws(
    () => selectAlignedIntradaySpreadBars(alignedInput({ legSymbols: [LONG, "SPY260925C00505000"] })),
    /vertical spread/,
  );
  assert.throws(
    () => selectAlignedIntradaySpreadBars(alignedInput({ declaredEntryAt: "2026-09-04", declaredExitAt: "2026-09-03" })),
    /entry must precede/,
  );
});

test("rejects malformed, sub-minute, duplicate, and out-of-order bars", () => {
  const malformed = alignedInput();
  delete malformed.spyBars[0].c;
  assert.throws(() => selectAlignedIntradaySpreadBars(malformed), /close.*numeric bounds/);

  const subMinute = alignedInput();
  subMinute.spyBars[0].t = "2026-08-31T13:30:00.500Z";
  assert.throws(() => selectAlignedIntradaySpreadBars(subMinute), /one-minute boundary/);

  const duplicated = alignedInput();
  duplicated.optionBarsBySymbol[LONG] = [duplicated.optionBarsBySymbol[LONG][0], duplicated.optionBarsBySymbol[LONG][0]];
  assert.throws(() => selectAlignedIntradaySpreadBars(duplicated), /duplicated or out of order/);

  const outOfOrder = alignedInput();
  outOfOrder.spyBars = [...outOfOrder.spyBars].reverse();
  assert.throws(() => selectAlignedIntradaySpreadBars(outOfOrder), /duplicated or out of order/);
});

test("alignment bounds are explicit, finite, and capped at thirty minutes", () => {
  assert.throws(() => selectAlignedIntradaySpreadBars(alignedInput({ maximumEntryDelaySeconds: 59 })), /numeric bounds/);
  assert.throws(() => selectAlignedIntradaySpreadBars(alignedInput({ maximumExitStalenessSeconds: 1801 })), /30-minute/);
  assert.throws(() => selectAlignedIntradaySpreadBars(alignedInput({ maximumEntryDelaySeconds: 60.5 })), /numeric bounds/);
  const exactExit = selectAlignedIntradaySpreadBars(alignedInput({ maximumExitStalenessSeconds: 0 }));
  assert.equal(exactExit.ok, true);
  assert.equal(exactExit.exit.staleness_seconds, 0);
});

test("method disclosure categorically denies quote and fill equivalence", () => {
  assert.equal(HISTORICAL_INTRADAY_ALIGNMENT_METHOD.source_timeframe, "1Min");
  assert.match(HISTORICAL_INTRADAY_ALIGNMENT_METHOD.price_semantics, /NOT_QUOTE_NOT_FILL/);
  assert.ok(HISTORICAL_INTRADAY_ALIGNMENT_METHOD.limitations.some((line) => line.includes("not a historical bid")));
  assert.ok(HISTORICAL_INTRADAY_ALIGNMENT_METHOD.limitations.some((line) => line.includes("simultaneously executable")));
});
