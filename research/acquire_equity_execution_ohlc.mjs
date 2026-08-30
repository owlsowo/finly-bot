import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  alpacaHistoricalCredentialsFromEnv,
  HistoricalAlpacaClient,
} from "../lib/historical_alpaca.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const defaultOutputDirectory = resolve(projectRoot, "data/private/equity_execution_realism");
const DATA_ORIGIN = "https://data.alpaca.markets";
const SCHEMA_VERSION = "finly_equity_execution_ohlc_bundle.v1";
const SYMBOLS = Object.freeze(["SPY", "BIL"]);
const ADJUSTMENTS = Object.freeze(["all", "raw"]);
const RETAINED_BAR_FIELDS = Object.freeze(["t", "o", "h", "l", "c"]);
const OFFICIAL_BAR_FIELDS = new Set(["t", "o", "h", "l", "c", "v", "n", "vw"]);
const REQUIRED_BAR_FIELDS = new Set(["t", "o", "h", "l", "c", "v"]);
const EXPECTED_FIRST_SESSION = "2016-01-04";
const EXPECTED_LAST_SESSION = "2026-08-28";
const MINIMUM_PLAUSIBLE_SESSION_COUNT = 2_500;
const MAXIMUM_PLAUSIBLE_SESSION_COUNT = 3_000;
const MAXIMUM_PLAUSIBLE_CALENDAR_GAP_DAYS = 7;
const DAY_MILLISECONDS = 86_400_000;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export const EQUITY_EXECUTION_OHLC_REQUEST = deepFreeze({
  symbols: [...SYMBOLS],
  start: "2016-01-01",
  end: "2026-08-28T20:15:00.000Z",
  timeframe: "1Day",
  feed: "sip",
  adjustments: [...ADJUSTMENTS],
  limit: 10_000,
});

const SOURCE = deepFreeze({
  provider: "Alpaca Market Data API",
  origin: DATA_ORIGIN,
  paths: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, `/v2/stocks/${symbol}/bars`])),
  request: EQUITY_EXECUTION_OHLC_REQUEST,
});

const ACQUISITION_BOUNDARY = deepFreeze({
  transport: "HTTPS GET",
  authenticated_market_data_read_only: true,
  broker_mutation_authorized: false,
  raw_transport_envelope_retained: false,
  sensitive_request_material_retained: false,
  pagination_cursor_retained: false,
  retained_bar_fields: [...RETAINED_BAR_FIELDS],
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value, label) {
  invariant(isPlainObject(value), `${label} must be a plain object`);
  return value;
}

function exactKeys(value, expected, label) {
  record(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${label} fields are incomplete or expanded`);
}

function finite(value, label, { positive = false, minimum = -Infinity, integer = false } = {}) {
  invariant(value !== null && value !== "" && typeof value !== "boolean", `${label} must be numeric`);
  const number = Number(value);
  invariant(Number.isFinite(number), `${label} must be finite`);
  invariant(!positive || number > 0, `${label} must be positive`);
  invariant(number >= minimum, `${label} is below its minimum`);
  invariant(!integer || Number.isInteger(number), `${label} must be an integer`);
  return Object.is(number, -0) ? 0 : number;
}

function canonicalTimestamp(value, label) {
  invariant(typeof value === "string" && value.length > 0, `${label} must be a timestamp`);
  const milliseconds = Date.parse(value);
  invariant(Number.isFinite(milliseconds), `${label} must be RFC-3339`);
  const timestamp = new Date(milliseconds).toISOString();
  invariant(timestamp >= `${EQUITY_EXECUTION_OHLC_REQUEST.start}T00:00:00.000Z`
    && timestamp <= EQUITY_EXECUTION_OHLC_REQUEST.end,
  `${label} escaped the frozen request range`);
  const weekday = new Date(timestamp).getUTCDay();
  invariant(weekday >= 1 && weekday <= 5, `${label} is not a weekday market session`);
  return timestamp;
}

function sanitizeClientBar(value, label) {
  const bar = record(value, label);
  for (const key of Object.keys(bar)) invariant(OFFICIAL_BAR_FIELDS.has(key), `${label} contains unsupported field ${key}`);
  for (const key of REQUIRED_BAR_FIELDS) invariant(Object.hasOwn(bar, key), `${label} is missing ${key}`);
  const timestamp = canonicalTimestamp(bar.t, `${label}.t`);
  const open = finite(bar.o, `${label}.o`, { positive: true });
  const high = finite(bar.h, `${label}.h`, { positive: true });
  const low = finite(bar.l, `${label}.l`, { positive: true });
  const close = finite(bar.c, `${label}.c`, { positive: true });
  finite(bar.v, `${label}.v`, { minimum: 0 });
  if (Object.hasOwn(bar, "n")) finite(bar.n, `${label}.n`, { minimum: 0, integer: true });
  if (Object.hasOwn(bar, "vw") && bar.vw !== null) finite(bar.vw, `${label}.vw`, { positive: true });
  invariant(high >= Math.max(open, low, close) && low <= Math.min(open, high, close),
    `${label} violates OHLC bounds`);
  return { t: timestamp, o: open, h: high, l: low, c: close };
}

function validateSanitizedBar(value, label) {
  exactKeys(value, RETAINED_BAR_FIELDS, label);
  const timestamp = canonicalTimestamp(value.t, `${label}.t`);
  invariant(timestamp === value.t, `${label}.t is not canonical`);
  const open = finite(value.o, `${label}.o`, { positive: true });
  const high = finite(value.h, `${label}.h`, { positive: true });
  const low = finite(value.l, `${label}.l`, { positive: true });
  const close = finite(value.c, `${label}.c`, { positive: true });
  invariant(high >= Math.max(open, low, close) && low <= Math.min(open, high, close),
    `${label} violates OHLC bounds`);
  return { t: timestamp, o: open, h: high, l: low, c: close };
}

function validateChronology(bars, label) {
  let priorTimestamp = "";
  let priorSession = "";
  for (const [index, bar] of bars.entries()) {
    invariant(bar.t > priorTimestamp, `${label} bars are duplicated or out of order at ${index}`);
    const session = bar.t.slice(0, 10);
    invariant(session > priorSession, `${label} contains more than one bar for a session`);
    priorTimestamp = bar.t;
    priorSession = session;
  }
}

function exactClientProvenance(provenance, symbol, adjustment) {
  const label = `${adjustment}.${symbol} provenance`;
  exactKeys(provenance, [
    "provider",
    "origin",
    "path",
    "transport",
    "read_only",
    "complete",
    "page_count",
    "underlying",
    "start",
    "end",
    "timeframe",
    "feed",
    "adjustment",
  ], label);
  invariant(provenance.provider === "Alpaca", `${label} provider mismatch`);
  invariant(provenance.origin === DATA_ORIGIN, `${label} origin mismatch`);
  invariant(provenance.path === `/v2/stocks/${symbol}/bars`, `${label} path mismatch`);
  invariant(provenance.transport === "HTTPS GET" && provenance.read_only === true,
    `${label} is not an authenticated read-only GET`);
  invariant(provenance.complete === true, `${label} is partial`);
  invariant(Number.isInteger(provenance.page_count) && provenance.page_count >= 1,
    `${label} page count is invalid`);
  invariant(provenance.underlying === symbol, `${label} symbol mismatch`);
  for (const field of ["start", "end", "timeframe", "feed"]) {
    invariant(provenance[field] === EQUITY_EXECUTION_OHLC_REQUEST[field], `${label} ${field} mismatch`);
  }
  invariant(provenance.adjustment === adjustment, `${label} adjustment mismatch`);
  return provenance.page_count;
}

function sanitizeClientResult(value, symbol, adjustment) {
  const label = `${adjustment}.${symbol} response`;
  exactKeys(value, ["symbol", "bars", "next_page_token", "provenance"], label);
  invariant(value.symbol === symbol, `${label} symbol mismatch`);
  invariant(value.next_page_token === null, `${label} retained a page token or is partial`);
  invariant(Array.isArray(value.bars), `${label}.bars must be an array`);
  const pageCount = exactClientProvenance(record(value.provenance, `${label}.provenance`), symbol, adjustment);
  const bars = value.bars.map((bar, index) => sanitizeClientBar(bar, `${label}.bars[${index}]`));
  validateChronology(bars, label);
  return { bars, pageCount };
}

function validateSeriesRegistry(series, { sanitized = false } = {}) {
  exactKeys(series, ADJUSTMENTS, "series");
  const normalized = {};
  for (const adjustment of ADJUSTMENTS) {
    exactKeys(series[adjustment], SYMBOLS, `series.${adjustment}`);
    normalized[adjustment] = {};
    for (const symbol of SYMBOLS) {
      invariant(Array.isArray(series[adjustment][symbol]), `series.${adjustment}.${symbol} must be an array`);
      const bars = series[adjustment][symbol].map((bar, index) => (
        sanitized
          ? validateSanitizedBar(bar, `series.${adjustment}.${symbol}[${index}]`)
          : bar
      ));
      validateChronology(bars, `series.${adjustment}.${symbol}`);
      normalized[adjustment][symbol] = bars;
    }
  }
  return normalized;
}

function alignedCoverage(series) {
  const reference = series.all.SPY;
  invariant(reference.length >= MINIMUM_PLAUSIBLE_SESSION_COUNT,
    "daily OHLC response is implausibly short or partial");
  invariant(reference.length <= MAXIMUM_PLAUSIBLE_SESSION_COUNT,
    "daily OHLC response exceeds the plausible frozen-range session count");
  const firstSession = reference[0]?.t.slice(0, 10);
  const lastSession = reference.at(-1)?.t.slice(0, 10);
  invariant(firstSession === EXPECTED_FIRST_SESSION, "daily OHLC response is missing the first frozen-range session");
  invariant(lastSession === EXPECTED_LAST_SESSION, "daily OHLC response is missing the last frozen-range session");

  const referenceTimestamps = reference.map(({ t }) => t);
  for (const adjustment of ADJUSTMENTS) {
    for (const symbol of SYMBOLS) {
      const bars = series[adjustment][symbol];
      invariant(bars.length === reference.length, `${adjustment}.${symbol} daily OHLC response is partial or misaligned`);
      for (let index = 0; index < bars.length; index += 1) {
        invariant(bars[index].t === referenceTimestamps[index],
          `${adjustment}.${symbol} daily OHLC timestamps are misaligned at index ${index}`);
      }
    }
  }

  let maximumGapDays = 0;
  for (let index = 1; index < reference.length; index += 1) {
    const gapDays = Math.ceil((Date.parse(reference[index].t) - Date.parse(reference[index - 1].t)) / DAY_MILLISECONDS);
    maximumGapDays = Math.max(maximumGapDays, gapDays);
    invariant(gapDays <= MAXIMUM_PLAUSIBLE_CALENDAR_GAP_DAYS,
      `daily OHLC response has an implausible calendar gap ending ${reference[index].t}`);
  }

  const adjustmentDifferencesBySymbol = {};
  for (const symbol of SYMBOLS) {
    adjustmentDifferencesBySymbol[symbol] = series.all[symbol].some((bar, index) => {
      const raw = series.raw[symbol][index];
      return bar.o !== raw.o || bar.h !== raw.h || bar.l !== raw.l || bar.c !== raw.c;
    });
    invariant(adjustmentDifferencesBySymbol[symbol],
      `${symbol} all-adjusted and raw responses are indistinguishable`);
  }

  return {
    aligned_session_count: reference.length,
    total_sanitized_bar_count: reference.length * SYMBOLS.length * ADJUSTMENTS.length,
    first_timestamp: reference[0].t,
    last_timestamp: reference.at(-1).t,
    first_session: firstSession,
    last_session: lastSession,
    maximum_calendar_gap_days: maximumGapDays,
    all_series_exactly_aligned: true,
    adjustment_differences_by_symbol: adjustmentDifferencesBySymbol,
  };
}

function sensitiveKeyPaths(value, path = "bundle", output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => sensitiveKeyPaths(item, `${path}[${index}]`, output));
    return output;
  }
  if (!isPlainObject(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (/(?:authorization|api.?key|secret|credential|headers?|page.?tokens?)/iu.test(key)) output.push(nextPath);
    sensitiveKeyPaths(item, nextPath, output);
  }
  return output;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function sameJson(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export function validateEquityExecutionOhlcResponses(responses) {
  exactKeys(responses, ADJUSTMENTS, "responses");
  const series = {};
  const pageCounts = {};
  for (const adjustment of ADJUSTMENTS) {
    exactKeys(responses[adjustment], SYMBOLS, `responses.${adjustment}`);
    series[adjustment] = {};
    pageCounts[adjustment] = {};
    for (const symbol of SYMBOLS) {
      const sanitized = sanitizeClientResult(responses[adjustment][symbol], symbol, adjustment);
      series[adjustment][symbol] = sanitized.bars;
      pageCounts[adjustment][symbol] = sanitized.pageCount;
    }
  }
  const normalizedSeries = validateSeriesRegistry(series);
  const coverage = alignedCoverage(normalizedSeries);
  return deepFreeze({ series: normalizedSeries, coverage, page_counts: pageCounts });
}

export function buildEquityExecutionOhlcBundle(responses) {
  const validated = validateEquityExecutionOhlcResponses(responses);
  const bundle = {
    schema_version: SCHEMA_VERSION,
    source: SOURCE,
    acquisition_boundary: ACQUISITION_BOUNDARY,
    coverage: validated.coverage,
    series: validated.series,
  };
  validateEquityExecutionOhlcBundle(bundle);
  return deepFreeze(bundle);
}

export function validateEquityExecutionOhlcBundle(bundle) {
  exactKeys(bundle, ["schema_version", "source", "acquisition_boundary", "coverage", "series"], "bundle");
  invariant(bundle.schema_version === SCHEMA_VERSION, "equity execution OHLC bundle schema mismatch");
  invariant(sameJson(bundle.source, SOURCE), "equity execution OHLC bundle source/request mismatch");
  invariant(sameJson(bundle.acquisition_boundary, ACQUISITION_BOUNDARY),
    "equity execution OHLC acquisition boundary mismatch");
  invariant(sensitiveKeyPaths(bundle).length === 0,
    "equity execution OHLC bundle contains sensitive request or pagination fields");
  const normalizedSeries = validateSeriesRegistry(bundle.series, { sanitized: true });
  const coverage = alignedCoverage(normalizedSeries);
  invariant(sameJson(bundle.coverage, coverage), "equity execution OHLC bundle coverage is not reproducible");
  return true;
}

export function canonicalEquityExecutionOhlcJson(bundle) {
  validateEquityExecutionOhlcBundle(bundle);
  return `${stableStringify(bundle)}\n`;
}

export function hashEquityExecutionOhlcBundle(bundle) {
  return createHash("sha256").update(canonicalEquityExecutionOhlcJson(bundle), "utf8").digest("hex");
}

function bundleFilename(hash) {
  invariant(HASH_PATTERN.test(hash), "equity execution OHLC bundle hash is invalid");
  return `spy_bil_daily_ohlc_${hash}.json`;
}

async function writeOnceAtomic(path, payload) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.stage`;
  await writeFile(temporary, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    try {
      await link(temporary, path);
      return "created";
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readFile(path, "utf8");
      invariant(existing === payload, "content-addressed equity OHLC bundle exists with different bytes");
      return "verified_existing";
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function persistEquityExecutionOhlcBundle(bundle, {
  outputDirectory = defaultOutputDirectory,
} = {}) {
  invariant(typeof outputDirectory === "string" && outputDirectory.length > 0,
    "equity execution OHLC output directory is required");
  const payload = canonicalEquityExecutionOhlcJson(bundle);
  const hash = hashEquityExecutionOhlcBundle(bundle);
  const path = resolve(outputDirectory, bundleFilename(hash));
  const writeStatus = await writeOnceAtomic(path, payload);
  const coverage = bundle.coverage;
  return deepFreeze({
    path,
    hash,
    count: coverage.aligned_session_count,
    ranges: {
      first_timestamp: coverage.first_timestamp,
      last_timestamp: coverage.last_timestamp,
      first_session: coverage.first_session,
      last_session: coverage.last_session,
    },
    write_status: writeStatus,
  });
}

export async function acquireEquityExecutionOhlc({
  client,
  outputDirectory = defaultOutputDirectory,
} = {}) {
  invariant(client && typeof client.getStockBars === "function",
    "HistoricalAlpacaClient-compatible read-only client is required");
  const responses = Object.fromEntries(ADJUSTMENTS.map((adjustment) => [
    adjustment,
    Object.fromEntries(SYMBOLS.map((symbol) => [symbol, null])),
  ]));
  for (const adjustment of ADJUSTMENTS) {
    for (const symbol of SYMBOLS) {
      responses[adjustment][symbol] = await client.getStockBars(symbol, {
        start: EQUITY_EXECUTION_OHLC_REQUEST.start,
        end: EQUITY_EXECUTION_OHLC_REQUEST.end,
        timeframe: EQUITY_EXECUTION_OHLC_REQUEST.timeframe,
        feed: EQUITY_EXECUTION_OHLC_REQUEST.feed,
        adjustment,
        limit: EQUITY_EXECUTION_OHLC_REQUEST.limit,
      });
    }
  }
  const bundle = buildEquityExecutionOhlcBundle(responses);
  return persistEquityExecutionOhlcBundle(bundle, { outputDirectory });
}

export function equityExecutionOhlcStdoutSummary(result, {
  rootDirectory = projectRoot,
} = {}) {
  exactKeys(result, ["path", "hash", "count", "ranges", "write_status"], "acquisition result");
  invariant(HASH_PATTERN.test(result.hash), "acquisition result hash is invalid");
  return {
    path: relative(rootDirectory, result.path),
    hash: result.hash,
    count: result.count,
    ranges: result.ranges,
  };
}

async function main(argv = process.argv.slice(2)) {
  invariant(argv.length === 0,
    "usage: node --env-file=.env.local research/acquire_equity_execution_ohlc.mjs");
  const credentials = alpacaHistoricalCredentialsFromEnv(process.env);
  const client = new HistoricalAlpacaClient(credentials);
  const result = await acquireEquityExecutionOhlc({ client });
  process.stdout.write(`${JSON.stringify(equityExecutionOhlcStdoutSummary(result))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`Equity OHLC acquisition failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
