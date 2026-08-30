import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAdjustedOhlc } from "./aegis_q_legacy_reproduction.mjs";
import { AEGIS_AUXILIARY_PANEL_SEMANTICS } from "./run_aegis_q_legacy_reproduction.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const DATA_ORIGIN = "https://data.alpaca.markets";
const DATA_PATH = "/v2/stocks/bars";
const SOURCE_URL = `${DATA_ORIGIN}${DATA_PATH}`;
const RAW_PATH = "data/private/competitor_reproductions/aegis_q_alpaca_iex_split_sanitized_raw_bars.json";
const PANEL_PATH = "data/private/competitor_reproductions/aegis_q_alpaca_iex_split_panel.json";
const RAW_SCHEMA = "finly_aegis_q_alpaca_sanitized_raw_bars.v1";
const PANEL_SCHEMA = "finly_aegis_q_public_adjusted_ohlc_panel.v1";
const MAX_PAGES = 10;

export const AEGIS_ALPACA_SPLIT_REQUEST = Object.freeze({
  symbols: Object.freeze(["QQQ", "TQQQ"]),
  timeframe: "1Day",
  start: "2019-01-01",
  end: "2026-08-27",
  adjustment: "split",
  feed: "iex",
  sort: "asc",
  limit: 10_000,
  asof: "2026-08-27",
  currency: "USD",
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isoDate(value, label) {
  invariant(typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(value),
    `${label} timestamp is invalid`);
  const date = value.slice(0, 10);
  invariant(Number.isFinite(Date.parse(`${date}T00:00:00Z`)), `${label} date is invalid`);
  return date;
}

function positive(value, label) {
  const number = Number(value);
  invariant(Number.isFinite(number) && number > 0, `${label} must be positive and finite`);
  return number;
}

async function writeOnce(path, payload, label) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.stage`;
  await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
  try {
    try {
      await link(temporary, path);
      return "created";
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readFile(path);
      invariant(existing.equals(payload), `${label} already exists with different bytes`);
      return "verified_existing";
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function safeBars(payload, requestedSymbols) {
  invariant(payload && typeof payload === "object" && !Array.isArray(payload),
    "Alpaca response must be an object");
  invariant(payload.bars && typeof payload.bars === "object" && !Array.isArray(payload.bars),
    "Alpaca response bars must be an object");
  const rows = [];
  for (const [symbol, bars] of Object.entries(payload.bars)) {
    invariant(requestedSymbols.includes(symbol), `unexpected Alpaca symbol ${symbol}`);
    invariant(Array.isArray(bars), `${symbol} bars must be an array`);
    for (const [index, bar] of bars.entries()) {
      invariant(bar && typeof bar === "object" && !Array.isArray(bar),
        `${symbol} bar ${index} is invalid`);
      const date = isoDate(bar.t, `${symbol} bar ${index}`);
      const open = positive(bar.o, `${symbol} ${date} open`);
      const high = positive(bar.h, `${symbol} ${date} high`);
      const low = positive(bar.l, `${symbol} ${date} low`);
      const close = positive(bar.c, `${symbol} ${date} close`);
      const volume = Number(bar.v);
      invariant(Number.isFinite(volume) && volume >= 0, `${symbol} ${date} volume is invalid`);
      invariant(high >= Math.max(open, close), `${symbol} ${date} high violates OHLC bounds`);
      invariant(low <= Math.min(open, close), `${symbol} ${date} low violates OHLC bounds`);
      rows.push({ date, symbol, open, high, low, close, volume });
    }
  }
  return rows;
}

function validateExactPanel(rows) {
  const seen = new Set();
  const dates = Object.fromEntries(AEGIS_ALPACA_SPLIT_REQUEST.symbols.map((symbol) => [symbol, []]));
  for (const row of rows) {
    const key = `${row.date}\u0000${row.symbol}`;
    invariant(!seen.has(key), `duplicate sanitized bar ${row.symbol} ${row.date}`);
    seen.add(key);
    dates[row.symbol].push(row.date);
  }
  for (const symbol of AEGIS_ALPACA_SPLIT_REQUEST.symbols) {
    dates[symbol].sort();
    invariant(dates[symbol].length === 1_530, `${symbol} must contain exactly 1,530 bars`);
    invariant(dates[symbol][0] === "2020-07-27", `${symbol} first date must be 2020-07-27`);
    invariant(dates[symbol].at(-1) === "2026-08-27", `${symbol} last date must be 2026-08-27`);
  }
  invariant(JSON.stringify(dates.QQQ) === JSON.stringify(dates.TQQQ),
    "QQQ and TQQQ session calendars differ");
  const warmup = dates.QQQ.filter((date) => date < "2021-05-12");
  const native = dates.QQQ.filter((date) => date >= "2021-05-12" && date <= "2026-08-27");
  invariant(warmup.length === 200, "panel must provide exactly 200 common warm-up sessions");
  invariant(native.length === 1_330, "panel must provide exactly 1,330 native sessions");
  invariant(native[0] === "2021-05-12" && native.at(-1) === "2026-08-27",
    "native AEGIS-Q date bounds differ from the pinned comparison");
  return Object.freeze({
    common_sessions: dates.QQQ.length,
    first_date: dates.QQQ[0],
    last_date: dates.QQQ.at(-1),
    warmup_sessions: warmup.length,
    native_sessions: native.length,
  });
}

function requestUrl(pageToken) {
  const url = new URL(DATA_PATH, DATA_ORIGIN);
  for (const [key, value] of Object.entries(AEGIS_ALPACA_SPLIT_REQUEST)) {
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  if (pageToken) url.searchParams.set("page_token", pageToken);
  invariant(url.origin === DATA_ORIGIN && url.pathname === DATA_PATH,
    "Alpaca request escaped the allowlisted endpoint");
  return url;
}

async function acquire({ fetchImpl = globalThis.fetch, environment = process.env } = {}) {
  invariant(typeof fetchImpl === "function", "fetch implementation is required");
  const keyId = environment.APCA_API_KEY_ID ?? environment.ALPACA_API_KEY;
  const secretKey = environment.APCA_API_SECRET_KEY ?? environment.ALPACA_SECRET_KEY;
  invariant(typeof keyId === "string" && keyId.length >= 8, "missing Alpaca key ID");
  invariant(typeof secretKey === "string" && secretKey.length >= 12, "missing Alpaca secret key");
  const headers = Object.freeze({
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secretKey,
    accept: "application/json",
  });
  const rows = [];
  const responseHashes = [];
  const seenTokens = new Set();
  let pageToken;
  let pageCount = 0;
  do {
    invariant(pageCount < MAX_PAGES, "Alpaca pagination exceeded the fail-closed limit");
    let response;
    try {
      response = await fetchImpl(requestUrl(pageToken), {
        method: "GET",
        redirect: "error",
        headers,
      });
    } catch {
      throw new Error("Alpaca AEGIS-Q panel transport failed");
    }
    invariant(response && typeof response.ok === "boolean", "Alpaca returned an invalid response");
    invariant(response.ok, `Alpaca AEGIS-Q panel read failed with HTTP ${response.status}`);
    const body = await response.text();
    responseHashes.push(sha256(body));
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error("Alpaca AEGIS-Q response was not valid JSON");
    }
    rows.push(...safeBars(payload, AEGIS_ALPACA_SPLIT_REQUEST.symbols));
    pageCount += 1;
    const next = payload.next_page_token;
    if (next === null || next === undefined || next === "") pageToken = null;
    else {
      invariant(typeof next === "string" && !seenTokens.has(next),
        "Alpaca pagination token is invalid or repeated");
      seenTokens.add(next);
      pageToken = next;
    }
  } while (pageToken);

  rows.sort((left, right) => left.date.localeCompare(right.date)
    || left.symbol.localeCompare(right.symbol));
  const coverage = validateExactPanel(rows);
  const retrievedAt = new Date().toISOString();
  const acquisitionScriptSha256 = sha256(await readFile(modulePath));
  const responseContentSha256 = sha256(responseHashes.join("\n"));
  const security = Object.freeze({
    method: "GET",
    authenticated_read_only: true,
    credentials_persisted: false,
    request_headers_persisted: false,
    page_tokens_persisted: false,
    raw_responses_persisted: false,
    sanitized_ohlc_only: true,
  });
  const rawDocument = Object.freeze({
    schema_version: RAW_SCHEMA,
    source: Object.freeze({
      provider: "Alpaca Market Data API",
      url: SOURCE_URL,
      retrieved_at: retrievedAt,
      request: AEGIS_ALPACA_SPLIT_REQUEST,
      page_count: pageCount,
      response_content_sha256: responseContentSha256,
      acquisition_script_path: "research/acquire_aegis_q_alpaca_split_panel.mjs",
      acquisition_script_sha256: acquisitionScriptSha256,
    }),
    security,
    coverage,
    bars: rows,
  });
  const rawPayload = jsonBytes(rawDocument);
  invariant(!rawPayload.includes(Buffer.from(keyId, "utf8"))
      && !rawPayload.includes(Buffer.from(secretKey, "utf8")),
  "credential material reached the sanitized raw-bars payload");
  const rawSha256 = sha256(rawPayload);
  const publicSource = Object.freeze({
    provider: "Alpaca Market Data API",
    url: SOURCE_URL,
    retrieved_at: retrievedAt,
    feed: AEGIS_ALPACA_SPLIT_REQUEST.feed,
    timeframe: AEGIS_ALPACA_SPLIT_REQUEST.timeframe,
    adjustment: AEGIS_ALPACA_SPLIT_REQUEST.adjustment,
    request_start: AEGIS_ALPACA_SPLIT_REQUEST.start,
    request_end: AEGIS_ALPACA_SPLIT_REQUEST.end,
    asof: AEGIS_ALPACA_SPLIT_REQUEST.asof,
    currency: AEGIS_ALPACA_SPLIT_REQUEST.currency,
    sort: AEGIS_ALPACA_SPLIT_REQUEST.sort,
    limit: AEGIS_ALPACA_SPLIT_REQUEST.limit,
    page_count: pageCount,
    response_content_sha256: responseContentSha256,
    raw_bars_path: RAW_PATH,
    raw_bars_sha256: rawSha256,
    corporate_actions_applied_separately: false,
    acquisition_script_path: "research/acquire_aegis_q_alpaca_split_panel.mjs",
    acquisition_script_sha256: acquisitionScriptSha256,
    credentials_persisted: false,
    request_headers_persisted: false,
    page_tokens_persisted: false,
    raw_responses_persisted: false,
  });
  const panelDocument = Object.freeze({
    schema_version: PANEL_SCHEMA,
    source: publicSource,
    input_hashes: Object.freeze({
      raw_bars_sha256: rawSha256,
      corporate_actions_sha256: null,
    }),
    semantics: AEGIS_AUXILIARY_PANEL_SEMANTICS,
    bars: rows,
  });
  const panelPayload = jsonBytes(panelDocument);
  const normalized = normalizeAdjustedOhlc(rows, []);

  const rawStatus = await writeOnce(resolve(projectRoot, RAW_PATH), rawPayload,
    "AEGIS-Q sanitized raw bars");
  const panelStatus = await writeOnce(resolve(projectRoot, PANEL_PATH), panelPayload,
    "AEGIS-Q normalized input panel");
  return Object.freeze({
    paths: Object.freeze({ raw: RAW_PATH, panel: PANEL_PATH }),
    write_statuses: Object.freeze({ raw: rawStatus, panel: panelStatus }),
    hashes: Object.freeze({
      raw_file_sha256: rawSha256,
      panel_file_sha256: sha256(panelPayload),
      normalized_panel_sha256: normalized.normalized_panel_sha256,
      acquisition_script_sha256: acquisitionScriptSha256,
      response_content_sha256: responseContentSha256,
    }),
    coverage,
    public_source: publicSource,
  });
}

async function main() {
  invariant(process.argv.length === 2,
    "usage: node --env-file=.env.local research/acquire_aegis_q_alpaca_split_panel.mjs");
  const result = await acquire();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
