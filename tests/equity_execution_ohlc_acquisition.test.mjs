import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";

import {
  acquireEquityExecutionOhlc,
  buildEquityExecutionOhlcBundle,
  canonicalEquityExecutionOhlcJson,
  EQUITY_EXECUTION_OHLC_REQUEST,
  equityExecutionOhlcStdoutSummary,
  hashEquityExecutionOhlcBundle,
  persistEquityExecutionOhlcBundle,
  validateEquityExecutionOhlcBundle,
  validateEquityExecutionOhlcResponses,
} from "../research/acquire_equity_execution_ohlc.mjs";

const DAY_MILLISECONDS = 86_400_000;

function frozenRangeWeekdays() {
  const dates = [];
  for (
    let current = Date.parse("2016-01-04T05:00:00.000Z");
    current <= Date.parse("2026-08-28T05:00:00.000Z");
    current += DAY_MILLISECONDS
  ) {
    const weekday = new Date(current).getUTCDay();
    if (weekday >= 1 && weekday <= 5) dates.push(new Date(current).toISOString());
  }
  return dates;
}

const TIMESTAMPS = frozenRangeWeekdays();

function barsFor(symbol, adjustment) {
  const initial = symbol === "SPY" ? 200 : 50;
  return TIMESTAMPS.map((timestamp, index) => {
    const rawClose = initial + index * (symbol === "SPY" ? 0.13 : 0.01);
    const adjustmentFactor = adjustment === "all" ? 0.82 + 0.17 * index / (TIMESTAMPS.length - 1) : 1;
    const close = rawClose * adjustmentFactor;
    return {
      t: timestamp,
      o: close - 0.2,
      h: close + 0.5,
      l: close - 0.5,
      c: close,
      v: 1_000 + index,
      n: 100 + index,
      vw: close - 0.05,
    };
  });
}

function clientResult(symbol, adjustment) {
  return {
    symbol,
    bars: barsFor(symbol, adjustment),
    next_page_token: null,
    provenance: {
      provider: "Alpaca",
      origin: "https://data.alpaca.markets",
      path: `/v2/stocks/${symbol}/bars`,
      transport: "HTTPS GET",
      read_only: true,
      complete: true,
      page_count: 2,
      underlying: symbol,
      start: EQUITY_EXECUTION_OHLC_REQUEST.start,
      end: EQUITY_EXECUTION_OHLC_REQUEST.end,
      timeframe: EQUITY_EXECUTION_OHLC_REQUEST.timeframe,
      feed: EQUITY_EXECUTION_OHLC_REQUEST.feed,
      adjustment,
    },
  };
}

function fixtureResponses() {
  return {
    all: {
      SPY: clientResult("SPY", "all"),
      BIL: clientResult("BIL", "all"),
    },
    raw: {
      SPY: clientResult("SPY", "raw"),
      BIL: clientResult("BIL", "raw"),
    },
  };
}

test("the frozen acquisition request and canonical sanitized bundle are exact and deterministic", () => {
  assert.deepEqual(EQUITY_EXECUTION_OHLC_REQUEST, {
    symbols: ["SPY", "BIL"],
    start: "2016-01-01",
    end: "2026-08-28T20:15:00.000Z",
    timeframe: "1Day",
    feed: "sip",
    adjustments: ["all", "raw"],
    limit: 10_000,
  });

  const responses = fixtureResponses();
  const validated = validateEquityExecutionOhlcResponses(responses);
  assert.equal(validated.coverage.aligned_session_count, TIMESTAMPS.length);
  assert.equal(validated.coverage.first_session, "2016-01-04");
  assert.equal(validated.coverage.last_session, "2026-08-28");
  assert.deepEqual(validated.page_counts, {
    all: { SPY: 2, BIL: 2 },
    raw: { SPY: 2, BIL: 2 },
  });

  const bundle = buildEquityExecutionOhlcBundle(responses);
  assert.equal(validateEquityExecutionOhlcBundle(bundle), true);
  assert.equal(Object.isFrozen(bundle), true);
  assert.deepEqual(Object.keys(bundle.series.all.SPY[0]), ["t", "o", "h", "l", "c"]);
  assert.equal("v" in bundle.series.all.SPY[0], false);
  assert.equal("next_page_token" in bundle, false);
  assert.equal(bundle.acquisition_boundary.transport, "HTTPS GET");
  assert.equal(bundle.acquisition_boundary.broker_mutation_authorized, false);

  const canonical = canonicalEquityExecutionOhlcJson(bundle);
  assert.match(canonical, /^\{"acquisition_boundary":/u);
  assert.equal(canonical.endsWith("\n"), true);
  const expectedHash = createHash("sha256").update(canonical).digest("hex");
  assert.equal(hashEquityExecutionOhlcBundle(bundle), expectedHash);
  assert.match(expectedHash, /^[0-9a-f]{64}$/u);

  const reordered = {
    raw: { BIL: responses.raw.BIL, SPY: responses.raw.SPY },
    all: { BIL: responses.all.BIL, SPY: responses.all.SPY },
  };
  const reorderedBundle = buildEquityExecutionOhlcBundle(reordered);
  assert.equal(canonicalEquityExecutionOhlcJson(reorderedBundle), canonical);
  assert.equal(hashEquityExecutionOhlcBundle(reorderedBundle), expectedHash);
});

test("validation fails closed on missing, partial, misaligned, malformed, or adjustment-confused responses", () => {
  {
    const responses = fixtureResponses();
    delete responses.raw.BIL;
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /fields are incomplete or expanded/u);
  }
  {
    const responses = fixtureResponses();
    responses.raw.BIL.bars.pop();
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /partial or misaligned/u);
  }
  {
    const responses = fixtureResponses();
    for (const adjustment of ["all", "raw"]) {
      for (const symbol of ["SPY", "BIL"]) responses[adjustment][symbol].bars.pop();
    }
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /missing the last frozen-range session/u);
  }
  {
    const responses = fixtureResponses();
    responses.all.BIL.bars[100].t = "2016-06-01T04:59:00.000Z";
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /duplicated or out of order|misaligned at index/u);
  }
  {
    const responses = fixtureResponses();
    responses.raw.SPY.bars[10].h = responses.raw.SPY.bars[10].c - 1;
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /violates OHLC bounds/u);
  }
  {
    const responses = fixtureResponses();
    responses.all.SPY.provenance.complete = false;
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /is partial/u);
  }
  {
    const responses = fixtureResponses();
    responses.all.SPY.next_page_token = "not-exhausted";
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /page token or is partial/u);
  }
  {
    const responses = fixtureResponses();
    responses.raw.BIL.provenance.feed = "iex";
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /feed mismatch/u);
  }
  {
    const responses = fixtureResponses();
    responses.all.SPY.bars[0].authorization = "Bearer should-never-persist";
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /unsupported field authorization/u);
  }
  {
    const responses = fixtureResponses();
    for (const symbol of ["SPY", "BIL"]) {
      responses.raw[symbol].bars = structuredClone(responses.all[symbol].bars);
    }
    assert.throws(() => validateEquityExecutionOhlcResponses(responses), /indistinguishable/u);
  }
});

test("acquisition uses only the exact four HistoricalAlpacaClient reads and persists no transport secrets", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-equity-ohlc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDirectory = resolve(root, "data/private/equity_execution_realism");
  const fixture = fixtureResponses();
  const calls = [];
  const client = {
    async getStockBars(symbol, options) {
      calls.push({ symbol, options: structuredClone(options) });
      return structuredClone(fixture[options.adjustment][symbol]);
    },
  };

  const result = await acquireEquityExecutionOhlc({ client, outputDirectory });
  assert.equal(result.write_status, "created");
  assert.deepEqual(calls, [
    { symbol: "SPY", options: { start: "2016-01-01", end: "2026-08-28T20:15:00.000Z", timeframe: "1Day", feed: "sip", adjustment: "all", limit: 10_000 } },
    { symbol: "BIL", options: { start: "2016-01-01", end: "2026-08-28T20:15:00.000Z", timeframe: "1Day", feed: "sip", adjustment: "all", limit: 10_000 } },
    { symbol: "SPY", options: { start: "2016-01-01", end: "2026-08-28T20:15:00.000Z", timeframe: "1Day", feed: "sip", adjustment: "raw", limit: 10_000 } },
    { symbol: "BIL", options: { start: "2016-01-01", end: "2026-08-28T20:15:00.000Z", timeframe: "1Day", feed: "sip", adjustment: "raw", limit: 10_000 } },
  ]);
  assert.equal(basename(result.path), `spy_bil_daily_ohlc_${result.hash}.json`);
  assert.equal(result.count, TIMESTAMPS.length);

  const payload = await readFile(result.path, "utf8");
  assert.equal(createHash("sha256").update(payload).digest("hex"), result.hash);
  assert.doesNotMatch(payload, /APCA|API-KEY|SECRET|authorization|headers|page_token|next_page_token/iu);
  assert.doesNotMatch(payload, /"v"\s*:/u);
  const stored = JSON.parse(payload);
  assert.equal(validateEquityExecutionOhlcBundle(stored), true);
  assert.equal(hashEquityExecutionOhlcBundle(stored), result.hash);

  const summary = equityExecutionOhlcStdoutSummary(result, { rootDirectory: root });
  assert.deepEqual(Object.keys(summary), ["path", "hash", "count", "ranges"]);
  assert.equal(summary.path, `data/private/equity_execution_realism/${basename(result.path)}`);
  assert.equal(JSON.stringify(summary).includes(String(stored.series.raw.SPY[0].c)), false);

  const second = await acquireEquityExecutionOhlc({ client, outputDirectory });
  assert.equal(second.write_status, "verified_existing");
  assert.equal(second.hash, result.hash);
  assert.deepEqual((await readdir(outputDirectory)).filter((name) => name.endsWith(".stage")), []);
});

test("content-addressed persistence is atomic, idempotent, and refuses an existing-byte mismatch", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-equity-ohlc-write-once-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = buildEquityExecutionOhlcBundle(fixtureResponses());
  const first = await persistEquityExecutionOhlcBundle(bundle, { outputDirectory: root });
  const second = await persistEquityExecutionOhlcBundle(bundle, { outputDirectory: root });
  assert.equal(first.write_status, "created");
  assert.equal(second.write_status, "verified_existing");

  await writeFile(first.path, "tampered\n", "utf8");
  await assert.rejects(
    persistEquityExecutionOhlcBundle(bundle, { outputDirectory: root }),
    /exists with different bytes/u,
  );
  assert.equal(await readFile(first.path, "utf8"), "tampered\n");
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith(".stage")), []);
});

test("the acquisition module delegates networking to the GET-only historical client and cannot submit orders", async () => {
  const source = await readFile(new URL("../research/acquire_equity_execution_ohlc.mjs", import.meta.url), "utf8");
  assert.match(source, /HistoricalAlpacaClient/u);
  assert.match(source, /client\.getStockBars/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/iu);
  assert.doesNotMatch(source, /client_order_id|submitOrder|placeOrder|cancelOrder/iu);
});
