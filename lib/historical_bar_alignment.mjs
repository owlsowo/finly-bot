import { parseOccOptionSymbol } from "./schema.mjs";

const MINUTE_MILLISECONDS = 60_000;
const MAXIMUM_ALIGNMENT_BOUND_SECONDS = 30 * 60;

export const HISTORICAL_INTRADAY_ALIGNMENT_METHOD = Object.freeze({
  schema_version: "finly_historical_intraday_alignment_method.v1",
  source_timeframe: "1Min",
  interval_seconds: 60,
  default_maximum_entry_delay_seconds: 300,
  default_maximum_exit_staleness_seconds: 300,
  entry_rule: "EARLIEST_COMPLETE_COMMON_INTERVAL_STARTING_AT_OR_AFTER_CEILING_OF_DECLARED_ENTRY",
  exit_rule: "LATEST_COMPLETE_COMMON_INTERVAL_ENDING_AT_OR_BEFORE_DECLARED_EXIT",
  alignment_rule: "EXACT_SAME_INTERVAL_START_FOR_SPY_LONG_LEG_AND_SHORT_LEG",
  price_semantics: "COMPLETED_OHLCV_BAR_RESEARCH_PROXY_NOT_QUOTE_NOT_FILL",
  limitations: Object.freeze([
    "The selected Alpaca one-minute OHLCV interval is not a historical bid, ask, NBBO, executable quote, or broker fill.",
    "Exact timestamp alignment prevents mixing intervals; it does not establish that both option legs were simultaneously executable.",
    "A missing common SPY and two-leg interval fails closed rather than carrying prices forward or interpolating them.",
  ]),
});

function failure(reason, detail = {}) {
  return {
    ok: false,
    schema_version: "finly_historical_intraday_alignment.v1",
    reason,
    ...detail,
    methodology: HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
  };
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function finite(value, label, { minimum = -Infinity, integer = false } = {}) {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isFinite(parsed) || parsed < minimum || (integer && !Number.isInteger(parsed))) {
    throw new TypeError(`${label} is outside its numeric bounds`);
  }
  return parsed;
}

function instant(value, label) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${label} is not a valid timestamp`);
  return parsed;
}

function alignmentBound(value, label, minimum) {
  const seconds = finite(value, label, { minimum, integer: true });
  if (seconds > MAXIMUM_ALIGNMENT_BOUND_SECONDS) throw new TypeError(`${label} exceeds the 30-minute safety bound`);
  return seconds;
}

function validateBar(raw, label) {
  const bar = record(raw, label);
  const observed = instant(bar.t, `${label} timestamp`);
  if (observed.getTime() % MINUTE_MILLISECONDS !== 0) throw new TypeError(`${label} timestamp is not aligned to a one-minute boundary`);
  const open = finite(bar.o, `${label} open`, { minimum: 0 });
  const high = finite(bar.h, `${label} high`, { minimum: 0 });
  const low = finite(bar.l, `${label} low`, { minimum: 0 });
  const close = finite(bar.c, `${label} close`, { minimum: 0 });
  finite(bar.v, `${label} volume`, { minimum: 0 });
  if (high < Math.max(open, low, close) || low > Math.min(open, high, close)) {
    throw new TypeError(`${label} has inconsistent OHLC values`);
  }
  if (Object.hasOwn(bar, "n")) finite(bar.n, `${label} trade count`, { minimum: 0, integer: true });
  if (Object.hasOwn(bar, "vw") && bar.vw !== null) finite(bar.vw, `${label} volume-weighted price`, { minimum: 0 });
  return { timestamp: observed.getTime(), bar };
}

function indexBars(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const indexed = new Map();
  let priorTimestamp = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const normalized = validateBar(values[index], `${label} ${index}`);
    if (normalized.timestamp <= priorTimestamp) throw new TypeError(`${label} are duplicated or out of order`);
    indexed.set(normalized.timestamp, normalized.bar);
    priorTimestamp = normalized.timestamp;
  }
  return indexed;
}

function optionBarsFor(optionBarsBySymbol, symbol) {
  if (optionBarsBySymbol instanceof Map) return optionBarsBySymbol.get(symbol);
  const bars = record(optionBarsBySymbol, "optionBarsBySymbol");
  return bars[symbol];
}

function validateVerticalSymbols(legSymbols) {
  if (!Array.isArray(legSymbols) || legSymbols.length !== 2 || new Set(legSymbols).size !== 2) {
    throw new TypeError("exactly two distinct option leg symbols are required");
  }
  const parsed = legSymbols.map((symbol) => {
    try {
      return parseOccOptionSymbol(symbol);
    } catch {
      throw new TypeError("option leg symbol is not valid compact OCC/OSI");
    }
  });
  if (parsed.some((item) => item.underlying !== "SPY")) throw new TypeError("option legs must have SPY as the underlying");
  if (parsed[0].expiry !== parsed[1].expiry || parsed[0].type !== parsed[1].type || parsed[0].strike === parsed[1].strike) {
    throw new TypeError("option legs do not describe one SPY vertical spread");
  }
  return parsed;
}

function commonTimestamps(spy, longLeg, shortLeg) {
  return [...spy.keys()].filter((timestamp) => longLeg.has(timestamp) && shortLeg.has(timestamp));
}

function alignedInterval(timestamp, declaredAt, spy, optionIndexes, legSymbols, kind) {
  const end = timestamp + MINUTE_MILLISECONDS;
  const relationSeconds = kind === "entry"
    ? (end - declaredAt) / 1000
    : (declaredAt - end) / 1000;
  return {
    declared_at: new Date(declaredAt).toISOString(),
    bar_start_at: new Date(timestamp).toISOString(),
    bar_end_at: new Date(end).toISOString(),
    available_at: new Date(end).toISOString(),
    ...(kind === "entry" ? { delay_seconds: relationSeconds } : { staleness_seconds: relationSeconds }),
    spy_bar: spy.get(timestamp),
    option_bars: Object.fromEntries(legSymbols.map((symbol, index) => [symbol, optionIndexes[index].get(timestamp)])),
    exact_three_series_alignment: true,
    price_semantics: HISTORICAL_INTRADAY_ALIGNMENT_METHOD.price_semantics,
  };
}

/**
 * Selects completed one-minute research proxies without interpolation or
 * carrying prices across timestamps. The first entry interval starts no
 * earlier than the declared entry; the last exit interval completes no later
 * than the declared exit. SPY and both option legs must share the exact start.
 */
export function selectAlignedIntradaySpreadBars({
  legSymbols,
  optionBarsBySymbol,
  spyBars,
  declaredEntryAt,
  declaredExitAt,
  timeframe = "1Min",
  maximumEntryDelaySeconds = HISTORICAL_INTRADAY_ALIGNMENT_METHOD.default_maximum_entry_delay_seconds,
  maximumExitStalenessSeconds = HISTORICAL_INTRADAY_ALIGNMENT_METHOD.default_maximum_exit_staleness_seconds,
} = {}) {
  if (timeframe !== "1Min") throw new TypeError("intraday alignment requires exact 1Min bars");
  validateVerticalSymbols(legSymbols);
  const entryAt = instant(declaredEntryAt, "declaredEntryAt").getTime();
  const exitAt = instant(declaredExitAt, "declaredExitAt").getTime();
  if (entryAt >= exitAt) throw new TypeError("declared entry must precede declared exit");
  const entryBound = alignmentBound(maximumEntryDelaySeconds, "maximumEntryDelaySeconds", 60);
  const exitBound = alignmentBound(maximumExitStalenessSeconds, "maximumExitStalenessSeconds", 0);
  const spy = indexBars(spyBars, "SPY one-minute bars");
  const optionIndexes = legSymbols.map((symbol) => indexBars(optionBarsFor(optionBarsBySymbol, symbol), `${symbol} one-minute bars`));
  const timestamps = commonTimestamps(spy, optionIndexes[0], optionIndexes[1]);
  const earliestEntryStart = Math.ceil(entryAt / MINUTE_MILLISECONDS) * MINUTE_MILLISECONDS;
  const latestEntryCompletion = entryAt + entryBound * 1000;
  const entryTimestamp = timestamps.find((timestamp) => timestamp >= earliestEntryStart
    && timestamp + MINUTE_MILLISECONDS <= latestEntryCompletion);
  if (entryTimestamp === undefined) {
    return failure("NO_ALIGNED_ENTRY_INTERVAL", {
      declared_entry_at: new Date(entryAt).toISOString(),
      maximum_entry_delay_seconds: entryBound,
    });
  }
  const entry = alignedInterval(entryTimestamp, entryAt, spy, optionIndexes, legSymbols, "entry");
  const earliestExitCompletion = exitAt - exitBound * 1000;
  const exitTimestamp = timestamps.findLast((timestamp) => timestamp + MINUTE_MILLISECONDS <= exitAt
    && timestamp + MINUTE_MILLISECONDS >= earliestExitCompletion);
  if (exitTimestamp === undefined) {
    return failure("NO_ALIGNED_EXIT_INTERVAL", {
      declared_exit_at: new Date(exitAt).toISOString(),
      maximum_exit_staleness_seconds: exitBound,
      entry,
    });
  }
  if (exitTimestamp <= entryTimestamp) {
    return failure("ALIGNED_EXIT_DOES_NOT_FOLLOW_ENTRY", {
      entry_bar_start_at: new Date(entryTimestamp).toISOString(),
      exit_bar_start_at: new Date(exitTimestamp).toISOString(),
    });
  }
  const exit = alignedInterval(exitTimestamp, exitAt, spy, optionIndexes, legSymbols, "exit");
  return {
    ok: true,
    schema_version: "finly_historical_intraday_alignment.v1",
    timeframe: "1Min",
    interval_seconds: 60,
    leg_symbols: [...legSymbols],
    entry,
    exit,
    price_equivalence_claimed: false,
    fill_equivalence_claimed: false,
    methodology: HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
  };
}
