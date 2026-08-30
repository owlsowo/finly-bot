import { createHash } from "node:crypto";

export const ALPACA_DATA_ORIGIN = "https://data.alpaca.markets";
export const ALPACA_PAPER_ORIGIN = "https://paper-api.alpaca.markets";

export const FORWARD_TRIAL_1_SYMBOLS = Object.freeze([
  "SPY",
  "BIL",
  "QQQ",
  "IWM",
  "EFA",
  "EEM",
  "IEF",
  "TLT",
  "GLD",
  "DBC",
  "VNQ",
  "XLK",
  "XLF",
  "XLE",
  "XLY",
  "XLP",
  "XLI",
  "XLB",
  "XLV",
  "XLU",
]);

const ALLOWED_ORIGINS = new Set([ALPACA_DATA_ORIGIN, ALPACA_PAPER_ORIGIN]);
const ALLOWED_SYMBOLS = new Set(FORWARD_TRIAL_1_SYMBOLS);
const BAR_ADJUSTMENTS = Object.freeze(["raw", "all"]);
const CORPORATE_ACTION_TYPES = Object.freeze(["Dividend", "Merger", "Spinoff", "Split"]);
const CORPORATE_ACTION_TYPE_SET = new Set(CORPORATE_ACTION_TYPES.map((value) => value.toLowerCase()));
const MAX_REMOTE_PAGES = 100;
const MAX_PAGE_SIZE = 10_000;
const MAX_CREDENTIAL_LENGTH = 512;
const MAX_ORIGIN_CLOCK_SKEW_MILLIS = 5 * 60_000;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MARKET_TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const DAY_MILLIS = 86_400_000;

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireText(value, label, { maximum = 1_024 } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function requireFiniteNumber(value, label, { minimum = -Infinity, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} is outside its numeric bounds`);
  }
  return value;
}

function normalizeOptionalDecimal(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return requireFiniteNumber(value, label, { minimum: 0 });
  if (typeof value !== "string" || !UNSIGNED_DECIMAL.test(value)) throw new Error(`${label} must be a finite decimal`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a finite decimal`);
  return number;
}

function assertIsoDate(value, label) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new Error(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return value;
}

function dateOrdinal(value) {
  return Date.parse(`${value}T00:00:00.000Z`) / DAY_MILLIS;
}

function assertDateRange(start, end, { label, maximumDays } = {}) {
  assertIsoDate(start, `${label} start`);
  assertIsoDate(end, `${label} end`);
  const span = dateOrdinal(end) - dateOrdinal(start);
  if (span < 0) throw new Error(`${label} bounds are inverted`);
  if (maximumDays !== undefined && span > maximumDays) {
    throw new Error(`${label} must not exceed ${maximumDays} days`);
  }
}

function assertSymbol(symbol) {
  if (typeof symbol !== "string" || !ALLOWED_SYMBOLS.has(symbol)) {
    throw new Error("symbol is outside the Forward Trial 1 allowlist");
  }
  return symbol;
}

function assertLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error(`page limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
}

function hasUnsafeCredentialCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (/\s/u.test(character) || codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function requireCredentials(credentials) {
  const record = requireRecord(credentials, "Alpaca credentials");
  const keyId = record.keyId;
  const secretKey = record.secretKey;
  if (typeof keyId !== "string" || keyId.length < 8 || keyId.length > MAX_CREDENTIAL_LENGTH || hasUnsafeCredentialCharacters(keyId)) {
    throw new Error("missing or malformed Alpaca paper key ID");
  }
  if (typeof secretKey !== "string" || secretKey.length < 12 || secretKey.length > MAX_CREDENTIAL_LENGTH || hasUnsafeCredentialCharacters(secretKey)) {
    throw new Error("missing or malformed Alpaca paper secret key");
  }
  return { keyId, secretKey };
}

function normalizeTimestamp(value, label) {
  requireText(value, label, { maximum: 64 });
  if (!RFC3339.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be RFC-3339`);
  assertIsoDate(value.slice(0, 10), `${label} date`);
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const offset = value.endsWith("Z") ? null : value.slice(-5).split(":").map(Number);
  if (hour > 23 || minute > 59 || second > 59 || (offset !== null && (offset[0] > 23 || offset[1] > 59))) {
    throw new Error(`${label} must be RFC-3339`);
  }
  return new Date(value).toISOString();
}

function normalizeMarketTime(value, label) {
  requireText(value, label, { maximum: 8 });
  const match = MARKET_TIME.exec(value);
  if (!match) throw new Error(`${label} must be HH:MM or HH:MM:SS`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`${label} is not a valid market time`);
  return {
    value: `${match[1]}:${match[2]}:${String(second).padStart(2, "0")}`,
    seconds: hour * 3_600 + minute * 60 + second,
  };
}

function normalizeBar(raw, { label, start, end }) {
  const bar = requireRecord(raw, label);
  const timestamp = normalizeTimestamp(bar.t, `${label} timestamp`);
  const sessionDate = timestamp.slice(0, 10);
  if (sessionDate < start || sessionDate > end) throw new Error(`${label} escaped the requested date bounds`);
  const open = requireFiniteNumber(bar.o, `${label} open`, { minimum: Number.MIN_VALUE });
  const high = requireFiniteNumber(bar.h, `${label} high`, { minimum: Number.MIN_VALUE });
  const low = requireFiniteNumber(bar.l, `${label} low`, { minimum: Number.MIN_VALUE });
  const close = requireFiniteNumber(bar.c, `${label} close`, { minimum: Number.MIN_VALUE });
  const volume = requireFiniteNumber(bar.v, `${label} volume`, { minimum: 0, integer: true });
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
    throw new Error(`${label} has inconsistent OHLC values`);
  }
  const tradeCount = Object.hasOwn(bar, "n") && bar.n !== null
    ? requireFiniteNumber(bar.n, `${label} trade count`, { minimum: 0, integer: true })
    : null;
  const vwap = Object.hasOwn(bar, "vw") && bar.vw !== null
    ? requireFiniteNumber(bar.vw, `${label} volume-weighted price`, { minimum: Number.MIN_VALUE })
    : null;
  return {
    timestamp,
    session_date: sessionDate,
    open,
    high,
    low,
    close,
    volume,
    trade_count: tradeCount,
    vwap,
  };
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot hash non-finite content");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = requireRecord(value, "hash content");
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function contentHash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeHttpDate(value, label) {
  requireText(value, label, { maximum: 64 });
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== value) {
    throw new Error(`${label} must be a canonical HTTP Date`);
  }
  return new Date(timestamp).toISOString();
}

function makeTransportReceipt(response, { requestStartedAt, responseReceivedAt, label }) {
  if (!response.headers || typeof response.headers.get !== "function") {
    throw new Error(`Alpaca ${label} response is missing HTTP headers`);
  }
  const originHttpDate = normalizeHttpDate(response.headers.get("date"), `Alpaca ${label} Date header`);
  const requestStartedMillis = Date.parse(requestStartedAt);
  const responseReceivedMillis = Date.parse(responseReceivedAt);
  const originHttpDateMillis = Date.parse(originHttpDate);
  if (responseReceivedMillis < requestStartedMillis) {
    throw new Error(`Alpaca ${label} local clock moved backward during the read`);
  }
  if (Math.abs(originHttpDateMillis - responseReceivedMillis) > MAX_ORIGIN_CLOCK_SKEW_MILLIS) {
    throw new Error(`Alpaca ${label} Date header is stale or materially ahead of the local receipt time`);
  }
  return deepFreeze({
    request_started_at: requestStartedAt,
    response_received_at: responseReceivedAt,
    origin_http_date: originHttpDate,
    origin_http_date_source: "HTTPS_RESPONSE_DATE_HEADER",
    maximum_origin_clock_skew_seconds: MAX_ORIGIN_CLOCK_SKEW_MILLIS / 1_000,
    local_clock_verified: false,
    provider_signature_verified: false,
  });
}

function makeProvenance({ origin, path, pageCount, request, transportReceipts }) {
  if (!Array.isArray(transportReceipts) || transportReceipts.length !== pageCount || pageCount < 1) {
    throw new Error("Alpaca provenance must bind every completed response page");
  }
  const requestStartedAt = transportReceipts[0].request_started_at;
  const responseReceivedAt = transportReceipts.at(-1).response_received_at;
  return deepFreeze({
    provider: "Alpaca",
    origin,
    path,
    method: "GET",
    transport: "HTTPS",
    read_only: true,
    complete: true,
    authentication: "caller-supplied; redacted",
    page_count: pageCount,
    request,
    request_started_at: requestStartedAt,
    response_received_at: responseReceivedAt,
    transport_receipts: transportReceipts,
    transport_receipts_sha256: contentHash(transportReceipts),
  });
}

function normalizeAnnouncement(raw, { index, symbol, start, end }) {
  const label = `corporate-action announcement ${index}`;
  const action = requireRecord(raw, label);
  const id = requireText(action.id, `${label} id`, { maximum: 256 });
  const corporateActionId = requireText(action.corporate_action_id, `${label} corporate_action_id`, { maximum: 256 });
  const rawType = requireText(action.ca_type, `${label} ca_type`, { maximum: 32 });
  const caType = rawType.toLowerCase();
  if (!CORPORATE_ACTION_TYPE_SET.has(caType)) throw new Error(`${label} contains an unrequested corporate-action type`);
  const caSubType = requireText(action.ca_sub_type, `${label} ca_sub_type`, { maximum: 64 });
  const initiatingSymbol = requireText(action.initiating_symbol, `${label} initiating_symbol`, { maximum: 32 });
  if (initiatingSymbol !== symbol) throw new Error(`${label} contains an unrequested symbol`);
  const initiatingOriginalCusip = requireText(
    action.initiating_original_cusip,
    `${label} initiating_original_cusip`,
    { maximum: 32 },
  );
  const exDate = assertIsoDate(action.ex_date, `${label} ex_date`);
  if (exDate < start || exDate > end) throw new Error(`${label} escaped the requested date bounds`);
  const optionalDate = (field) => {
    if (action[field] === null || action[field] === undefined) return null;
    return assertIsoDate(action[field], `${label} ${field}`);
  };
  const optionalText = (field) => {
    if (action[field] === null || action[field] === undefined) return null;
    return requireText(action[field], `${label} ${field}`, { maximum: 64 });
  };
  return {
    id,
    corporate_action_id: corporateActionId,
    ca_type: caType,
    ca_sub_type: caSubType,
    initiating_symbol: initiatingSymbol,
    initiating_original_cusip: initiatingOriginalCusip,
    target_symbol: optionalText("target_symbol"),
    target_original_cusip: optionalText("target_original_cusip"),
    declaration_date: optionalDate("declaration_date"),
    ex_date: exDate,
    record_date: optionalDate("record_date"),
    payable_date: optionalDate("payable_date"),
    cash: normalizeOptionalDecimal(action.cash, `${label} cash`),
    old_rate: normalizeOptionalDecimal(action.old_rate, `${label} old_rate`),
    new_rate: normalizeOptionalDecimal(action.new_rate, `${label} new_rate`),
  };
}

/**
 * Read-only data boundary for Forward Trial 1.
 *
 * Credentials are deliberately method-scoped: the client retains only its
 * fetch implementation and page bound. Returned values contain normalized
 * fields, canonical content hashes, and credential-free provenance.
 */
export class ForwardMarketDataClient {
  #fetchImpl;
  #maxPages;

  constructor({ fetchImpl = globalThis.fetch, maxPages = 32 } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("forward market-data fetch implementation is required");
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_REMOTE_PAGES) {
      throw new Error(`page safety limit must be an integer from 1 to ${MAX_REMOTE_PAGES}`);
    }
    this.#fetchImpl = fetchImpl;
    this.#maxPages = maxPages;
  }

  async getDailyBars(symbol, {
    start,
    end,
    limit = MAX_PAGE_SIZE,
    credentials,
  } = {}) {
    assertSymbol(symbol);
    assertDateRange(start, end, { label: "daily-bar range" });
    assertLimit(limit);
    requireCredentials(credentials);

    const adjustments = {};
    for (const adjustment of BAR_ADJUSTMENTS) {
      const path = `/v2/stocks/${symbol}/bars`;
      const request = {
        symbol,
        start,
        end,
        timeframe: "1Day",
        feed: "iex",
        adjustment,
        sort: "asc",
        limit,
      };
      const pageReads = await this.#readAllPages({
        origin: ALPACA_DATA_ORIGIN,
        path,
        query: {
          start,
          end,
          timeframe: "1Day",
          feed: "iex",
          adjustment,
          sort: "asc",
          limit,
        },
        credentials,
        label: `${adjustment}-adjusted daily bars`,
      });
      const bars = [];
      for (const [pageIndex, { body: page }] of pageReads.entries()) {
        if (page.symbol !== symbol) throw new Error(`${adjustment}-adjusted daily-bar page ${pageIndex + 1} contains an unrequested symbol`);
        const pageBars = requireArray(page.bars, `${adjustment}-adjusted daily-bar page ${pageIndex + 1} bars`);
        for (const rawBar of pageBars) {
          bars.push(normalizeBar(rawBar, {
            label: `${adjustment}-adjusted daily bar ${bars.length}`,
            start,
            end,
          }));
        }
      }
      let prior = -Infinity;
      for (const bar of bars) {
        const current = Date.parse(bar.timestamp);
        if (current <= prior) throw new Error(`${adjustment}-adjusted daily bars are duplicated or out of chronological order`);
        prior = current;
      }
      const normalizedEnvelope = {
        schema: "finly.forward-daily-bars.v1",
        symbol,
        adjustment,
        start,
        end,
        bars,
      };
      const provenance = makeProvenance({
        origin: ALPACA_DATA_ORIGIN,
        path,
        pageCount: pageReads.length,
        request,
        transportReceipts: pageReads.map(({ transportReceipt }) => transportReceipt),
      });
      adjustments[adjustment] = deepFreeze({
        bars,
        content_hash: contentHash(normalizedEnvelope),
        retrieved_at: provenance.response_received_at,
        provenance,
      });
    }

    const rawTimestamps = adjustments.raw.bars.map((bar) => bar.timestamp);
    const allTimestamps = adjustments.all.bars.map((bar) => bar.timestamp);
    if (canonicalJson(rawTimestamps) !== canonicalJson(allTimestamps)) {
      throw new Error("raw and all-adjusted daily bars do not cover identical sessions");
    }

    return deepFreeze({
      symbol,
      start,
      end,
      retrieved_at: adjustments.all.retrieved_at,
      raw: adjustments.raw,
      all: adjustments.all,
    });
  }

  async getMarketCalendar({ start, end, credentials } = {}) {
    assertDateRange(start, end, { label: "market-calendar range" });
    requireCredentials(credentials);
    const path = "/v2/calendar";
    const read = await this.#getJson({
      origin: ALPACA_PAPER_ORIGIN,
      path,
      query: { start, end, date_type: "TRADING" },
      credentials,
      label: "market calendar",
    });
    const calendar = requireArray(read.body, "market-calendar response").map((entry, index) => {
      const label = `market-calendar session ${index}`;
      const session = requireRecord(entry, label);
      const date = assertIsoDate(session.date, `${label} date`);
      if (date < start || date > end) throw new Error(`${label} escaped the requested date bounds`);
      const open = normalizeMarketTime(session.open, `${label} open`);
      const close = normalizeMarketTime(session.close, `${label} close`);
      if (open.seconds >= close.seconds) throw new Error(`${label} has invalid market hours`);
      return { date, open: open.value, close: close.value };
    });
    let prior = "";
    for (const session of calendar) {
      if (session.date <= prior) throw new Error("market-calendar sessions are duplicated or out of chronological order");
      prior = session.date;
    }
    const normalizedEnvelope = {
      schema: "finly.market-calendar.v1",
      start,
      end,
      sessions: calendar,
    };
    const provenance = makeProvenance({
      origin: ALPACA_PAPER_ORIGIN,
      path,
      pageCount: 1,
      request: { start, end, date_type: "TRADING" },
      transportReceipts: [read.transportReceipt],
    });
    return deepFreeze({
      start,
      end,
      sessions: calendar,
      content_hash: contentHash(normalizedEnvelope),
      retrieved_at: provenance.response_received_at,
      provenance,
    });
  }

  async getCorporateActionAnnouncements(symbol, { start, end, credentials } = {}) {
    assertSymbol(symbol);
    assertDateRange(start, end, { label: "corporate-action range", maximumDays: 90 });
    requireCredentials(credentials);
    const path = "/v2/corporate_actions/announcements";
    const read = await this.#getJson({
      origin: ALPACA_PAPER_ORIGIN,
      path,
      query: {
        ca_types: CORPORATE_ACTION_TYPES.join(","),
        since: start,
        until: end,
        symbol,
        date_type: "ex_date",
      },
      credentials,
      label: "corporate-action announcements",
    });
    const announcements = requireArray(read.body, "corporate-action response").map((action, index) => normalizeAnnouncement(action, {
      index,
      symbol,
      start,
      end,
    }));
    const ids = new Set();
    let priorDate = "";
    for (const action of announcements) {
      if (ids.has(action.id)) throw new Error("corporate-action response contains duplicate announcement IDs");
      ids.add(action.id);
      if (action.ex_date < priorDate) throw new Error("corporate-action announcements are out of chronological order");
      priorDate = action.ex_date;
    }
    const request = {
      symbol,
      start,
      end,
      ca_types: [...CORPORATE_ACTION_TYPES],
      date_type: "ex_date",
    };
    const normalizedEnvelope = {
      schema: "finly.corporate-action-announcements.v1",
      ...request,
      announcements,
    };
    const provenance = makeProvenance({
      origin: ALPACA_PAPER_ORIGIN,
      path,
      pageCount: 1,
      request,
      transportReceipts: [read.transportReceipt],
    });
    return deepFreeze({
      symbol,
      start,
      end,
      announcements,
      content_hash: contentHash(normalizedEnvelope),
      retrieved_at: provenance.response_received_at,
      provenance,
    });
  }

  async #readAllPages({ origin, path, query, credentials, label }) {
    const pages = [];
    const seenTokens = new Set();
    let pageToken;
    while (true) {
      const read = await this.#getJson({
        origin,
        path,
        query: { ...query, page_token: pageToken },
        credentials,
        label,
      });
      const page = requireRecord(read.body, `${label} response page ${pages.length + 1}`);
      if (!Object.hasOwn(page, "next_page_token")) throw new Error(`${label} response is missing next_page_token`);
      const next = page.next_page_token;
      if (next !== null && (typeof next !== "string" || next.length === 0 || next.length > 2_048)) {
        throw new Error(`${label} response has an invalid next_page_token`);
      }
      pages.push({ body: page, transportReceipt: read.transportReceipt });
      if (next === null) return pages;
      if (seenTokens.has(next)) throw new Error(`${label} response repeated a page token`);
      if (pages.length >= this.#maxPages) throw new Error(`${label} response exceeded the page safety limit`);
      seenTokens.add(next);
      pageToken = next;
    }
  }

  async #getJson({ origin, path, query, credentials, label }) {
    if (!ALLOWED_ORIGINS.has(origin)) throw new Error("Alpaca request origin is not allowlisted");
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) throw new Error("invalid Alpaca read path");
    const url = new URL(path, origin);
    if (url.protocol !== "https:" || url.origin !== origin || !ALLOWED_ORIGINS.has(url.origin)) {
      throw new Error("Alpaca request escaped the HTTPS origin allowlist");
    }
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const { keyId, secretKey } = requireCredentials(credentials);
    const requestStartedAt = new Date().toISOString();
    let response;
    try {
      response = await this.#fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "APCA-API-KEY-ID": keyId,
          "APCA-API-SECRET-KEY": secretKey,
        },
        redirect: "error",
      });
    } catch {
      throw new Error(`Alpaca ${label} HTTPS GET failed`);
    }
    if (!response || typeof response !== "object" || typeof response.ok !== "boolean"
      || !Number.isInteger(response.status) || typeof response.json !== "function") {
      throw new Error(`Alpaca ${label} transport returned a malformed response`);
    }
    if (Object.hasOwn(response, "redirected") && typeof response.redirected !== "boolean") {
      throw new Error(`Alpaca ${label} transport returned malformed redirect metadata`);
    }
    if (response.redirected === true) throw new Error(`Alpaca ${label} response was redirected`);
    if (typeof response.url === "string" && response.url.length > 0) {
      let responseUrl;
      try {
        responseUrl = new URL(response.url);
      } catch {
        throw new Error(`Alpaca ${label} transport returned a malformed response URL`);
      }
      if (responseUrl.href !== url.href || !ALLOWED_ORIGINS.has(responseUrl.origin)) {
        throw new Error(`Alpaca ${label} response escaped the allowlisted request URL`);
      }
    }
    if (!response.ok || response.status !== 200) throw new Error(`Alpaca ${label} read failed with HTTP ${response.status}`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`Alpaca ${label} response was not valid JSON`);
    }
    const responseReceivedAt = new Date().toISOString();
    const transportReceipt = makeTransportReceipt(response, {
      requestStartedAt,
      responseReceivedAt,
      label,
    });
    return { body, transportReceipt };
  }
}
