import { assertPaperHost } from "./alpaca.mjs";
import { POLICY } from "./policy.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

const DATA_ORIGIN = "https://data.alpaca.markets";
const MAX_REMOTE_PAGES = 10_000;
const OPTION_STATUSES = Object.freeze(["active", "inactive"]);
const OPTION_TYPES = new Set(["call", "put"]);
const RESEARCH_STOCK_SYMBOLS = new Set(["SPY", "BIL", "TLT", "GLD"]);
const STOCK_ADJUSTMENTS = new Set(["raw", "split", "dividend", "spin-off", "all"]);
const STOCK_FEEDS = new Set(["iex", "sip"]);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireFinite(value, label, { minimum = -Infinity, integer = false } = {}) {
  if (value === null || value === "" || typeof value === "boolean") throw new Error(`${label} must be numeric`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} is outside its numeric bounds`);
  }
  return number;
}

function assertIsoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a valid calendar date`);
  return value;
}

function assertTimeBound(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be YYYY-MM-DD or RFC-3339`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return assertIsoDate(value, label);
  if (!RFC3339.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be YYYY-MM-DD or RFC-3339`);
  return value;
}

function boundMillis(value) {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
}

function assertDateRange(start, end, { dateOnly = false, label = "historical range" } = {}) {
  const validate = dateOnly ? assertIsoDate : assertTimeBound;
  validate(start, `${label} start`);
  validate(end, `${label} end`);
  if (boundMillis(start) > boundMillis(end)) throw new Error(`${label} bounds are inverted`);
}

function assertLimit(value, maximum, label) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${label} must be an integer from 1 to ${maximum}`);
}

function assertTimeframe(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is unsupported`);
  const valid = /^(?:[1-9]|[1-5]\d)(?:Min|T)$/.test(value)
    || /^(?:[1-9]|1\d|2[0-3])(?:Hour|H)$/.test(value)
    || /^(?:1Day|1D|1Week|1W)$/.test(value)
    || /^(?:1|2|3|4|6|12)(?:Month|M)$/.test(value);
  if (!valid) throw new Error(`${label} is unsupported`);
}

function exactDataOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Alpaca data origin is not allowlisted");
  }
  const expected = new URL(DATA_ORIGIN);
  if (parsed.origin !== expected.origin
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Alpaca data origin is not allowlisted");
  }
  return expected.origin;
}

function assertUnderlying(underlying) {
  if (underlying !== "SPY" || !POLICY.underlyings.includes(underlying)) throw new Error("historical underlying must be SPY");
}

function assertResearchStockSymbol(symbol) {
  if (!RESEARCH_STOCK_SYMBOLS.has(symbol)) throw new Error("historical stock symbol must be SPY, BIL, TLT, or GLD");
}

function assertPositiveOptional(value, label) {
  if (value !== undefined) requireFinite(value, label, { minimum: Number.EPSILON });
}

function assertBar(raw, label) {
  const bar = requireRecord(raw, label);
  const timestamp = requireText(bar.t, `${label} timestamp`);
  if (!RFC3339.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error(`${label} timestamp is not RFC-3339`);
  const open = requireFinite(bar.o, `${label} open`, { minimum: 0 });
  const high = requireFinite(bar.h, `${label} high`, { minimum: 0 });
  const low = requireFinite(bar.l, `${label} low`, { minimum: 0 });
  const close = requireFinite(bar.c, `${label} close`, { minimum: 0 });
  requireFinite(bar.v, `${label} volume`, { minimum: 0 });
  if (high < Math.max(open, low, close) || low > Math.min(open, high, close)) throw new Error(`${label} has inconsistent OHLC values`);
  if (Object.hasOwn(bar, "n")) requireFinite(bar.n, `${label} trade count`, { minimum: 0, integer: true });
  if (Object.hasOwn(bar, "vw") && bar.vw !== null) requireFinite(bar.vw, `${label} volume-weighted price`, { minimum: 0 });
  return bar;
}

function assertChronologicalBars(bars, label) {
  let prior = -Infinity;
  for (let index = 0; index < bars.length; index += 1) {
    const bar = assertBar(bars[index], `${label} ${index}`);
    const timestamp = Date.parse(bar.t);
    if (timestamp <= prior) throw new Error(`${label} are duplicated or out of order`);
    prior = timestamp;
  }
}

function assertOptionSymbol(symbol) {
  let parsed;
  try {
    parsed = parseOccOptionSymbol(symbol);
  } catch {
    throw new Error("historical option symbol is outside Finly's allowlist");
  }
  if (parsed.underlying !== "SPY") throw new Error("historical option symbol is outside Finly's allowlist");
  return parsed;
}

function provenance(origin, path, pageCount, details = {}) {
  return Object.freeze({
    provider: "Alpaca",
    origin,
    path,
    transport: "HTTPS GET",
    read_only: true,
    complete: true,
    page_count: pageCount,
    ...details,
  });
}

/**
 * A historical-data-only Alpaca boundary. Every public operation is an HTTPS
 * GET against an exact paper/data origin, exhausts remote pagination, and
 * rejects incomplete or malformed responses rather than fabricating history.
 */
export class HistoricalAlpacaClient {
  #fetchImpl;
  #headers;
  #maxPages;

  constructor({
    keyId,
    secretKey,
    paperBase = POLICY.paperHost,
    dataBase = DATA_ORIGIN,
    fetchImpl = globalThis.fetch,
    maxPages = MAX_REMOTE_PAGES,
  } = {}) {
    if (typeof keyId !== "string" || keyId.length < 8) throw new Error("missing Alpaca paper key ID");
    if (typeof secretKey !== "string" || secretKey.length < 12) throw new Error("missing Alpaca paper secret key");
    if (typeof fetchImpl !== "function") throw new Error("historical Alpaca fetch implementation is required");
    assertLimit(maxPages, MAX_REMOTE_PAGES, "historical page safety limit");
    this.paperBase = assertPaperHost(paperBase);
    this.dataBase = exactDataOrigin(dataBase);
    this.#fetchImpl = fetchImpl;
    this.#maxPages = maxPages;
    this.#headers = Object.freeze({
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey,
      accept: "application/json",
    });
  }

  async getMarketCalendar({ start, end } = {}) {
    assertDateRange(start, end, { dateOnly: true, label: "market-calendar range" });
    const path = "/v2/calendar";
    const response = await this.#getJson(this.paperBase, path, { start, end, date_type: "TRADING" }, "market calendar");
    const calendar = requireArray(response, "market-calendar response");
    let prior = "";
    for (let index = 0; index < calendar.length; index += 1) {
      const session = requireRecord(calendar[index], `market-calendar session ${index}`);
      const date = assertIsoDate(session.date, `market-calendar session ${index} date`);
      requireText(session.open, `market-calendar session ${index} open`);
      requireText(session.close, `market-calendar session ${index} close`);
      if (date < start || date > end) throw new Error("market-calendar response escaped the requested date bounds");
      if (date <= prior) throw new Error("market-calendar response is duplicated or out of order");
      prior = date;
    }
    return {
      calendar,
      provenance: provenance(this.paperBase, path, 1, { start, end, date_type: "TRADING" }),
    };
  }

  async getStockBars(underlying, {
    start,
    end,
    timeframe = "1Day",
    feed = "iex",
    adjustment = "raw",
    limit = 10_000,
  } = {}) {
    assertResearchStockSymbol(underlying);
    assertDateRange(start, end, { label: "stock-bar range" });
    assertTimeframe(timeframe, "stock-bar timeframe");
    if (!STOCK_FEEDS.has(feed)) throw new Error("stock-bar feed is unsupported");
    if (!STOCK_ADJUSTMENTS.has(adjustment)) throw new Error("stock-bar adjustment is unsupported");
    assertLimit(limit, 10_000, "stock-bar page limit");
    const path = `/v2/stocks/${underlying}/bars`;
    const pages = await this.#readAllPages(this.dataBase, path, {
      start,
      end,
      timeframe,
      feed,
      adjustment,
      sort: "asc",
      limit: String(limit),
    }, "stock bars");
    const bars = [];
    for (const [index, page] of pages.entries()) {
      if (Object.hasOwn(page, "symbol") && page.symbol !== underlying) throw new Error(`stock-bar page ${index + 1} has the wrong symbol`);
      bars.push(...requireArray(page.bars, `stock-bar page ${index + 1} bars`));
    }
    assertChronologicalBars(bars, "stock bars");
    return {
      symbol: underlying,
      bars,
      next_page_token: null,
      provenance: provenance(this.dataBase, path, pages.length, { underlying, start, end, timeframe, feed, adjustment }),
    };
  }

  async getHistoricalNews(underlying, {
    start,
    end,
    includeContent = false,
    limit = 50,
  } = {}) {
    assertUnderlying(underlying);
    assertDateRange(start, end, { label: "historical-news range" });
    if (typeof includeContent !== "boolean") throw new Error("includeContent must be boolean");
    assertLimit(limit, 50, "historical-news page limit");
    const path = "/v1beta1/news";
    const pages = await this.#readAllPages(this.dataBase, path, {
      symbols: underlying,
      start,
      end,
      sort: "asc",
      limit: String(limit),
      include_content: String(includeContent),
    }, "historical news");
    const news = pages.flatMap((page, index) => requireArray(page.news, `historical-news page ${index + 1} news`));
    const ids = new Set();
    for (let index = 0; index < news.length; index += 1) {
      const article = requireRecord(news[index], `historical-news article ${index}`);
      const id = String(article.id ?? "");
      if (id.length === 0) throw new Error(`historical-news article ${index} is missing id`);
      if (ids.has(id)) throw new Error("historical-news response contains duplicate article IDs");
      ids.add(id);
      requireText(article.headline, `historical-news article ${id} headline`);
      const created = requireText(article.created_at, `historical-news article ${id} created_at`);
      const updated = requireText(article.updated_at, `historical-news article ${id} updated_at`);
      if (!RFC3339.test(created) || !Number.isFinite(Date.parse(created)) || !RFC3339.test(updated) || !Number.isFinite(Date.parse(updated))) {
        throw new Error(`historical-news article ${id} has invalid timestamps`);
      }
      const symbols = requireArray(article.symbols, `historical-news article ${id} symbols`);
      if (!symbols.includes(underlying)) throw new Error(`historical-news article ${id} does not match SPY`);
    }
    return {
      news,
      next_page_token: null,
      provenance: provenance(this.dataBase, path, pages.length, { underlying, start, end, include_content: includeContent }),
    };
  }

  async getOptionContracts(underlying, {
    status = "all",
    expirationDateGte,
    expirationDateLte,
    type,
    strikePriceGte,
    strikePriceLte,
    limit = 10_000,
  } = {}) {
    assertUnderlying(underlying);
    assertDateRange(expirationDateGte, expirationDateLte, { dateOnly: true, label: "option-contract expiration range" });
    if (![...OPTION_STATUSES, "all"].includes(status)) throw new Error("option-contract status is unsupported");
    if (type !== undefined && !OPTION_TYPES.has(type)) throw new Error("option-contract type is unsupported");
    assertPositiveOptional(strikePriceGte, "minimum option-contract strike");
    assertPositiveOptional(strikePriceLte, "maximum option-contract strike");
    if (strikePriceGte !== undefined && strikePriceLte !== undefined && Number(strikePriceGte) > Number(strikePriceLte)) {
      throw new Error("option-contract strike bounds are inverted");
    }
    assertLimit(limit, 10_000, "option-contract page limit");
    const path = "/v2/options/contracts";
    const statuses = status === "all" ? OPTION_STATUSES : [status];
    const pageGroups = await Promise.all(statuses.map((requestedStatus) => this.#readAllPages(this.paperBase, path, {
      underlying_symbols: underlying,
      status: requestedStatus,
      expiration_date_gte: expirationDateGte,
      expiration_date_lte: expirationDateLte,
      type,
      strike_price_gte: strikePriceGte,
      strike_price_lte: strikePriceLte,
      show_deliverables: "true",
      limit: String(limit),
    }, `${requestedStatus} option contracts`)));
    const optionContracts = [];
    const symbols = new Set();
    for (let groupIndex = 0; groupIndex < pageGroups.length; groupIndex += 1) {
      const requestedStatus = statuses[groupIndex];
      for (const [pageIndex, page] of pageGroups[groupIndex].entries()) {
        const records = requireArray(page.option_contracts, `${requestedStatus} option-contract page ${pageIndex + 1} option_contracts`);
        for (const raw of records) {
          const contract = requireRecord(raw, `${requestedStatus} option contract`);
          const symbol = requireText(contract.symbol, "option contract symbol");
          const parsed = assertOptionSymbol(symbol);
          if (symbols.has(symbol)) throw new Error(`duplicate option contract: ${symbol}`);
          symbols.add(symbol);
          if (contract.underlying_symbol !== underlying || parsed.underlying !== underlying) throw new Error(`option contract ${symbol} has the wrong underlying`);
          if (contract.status !== requestedStatus) throw new Error(`option contract ${symbol} has the wrong status`);
          const expiration = assertIsoDate(contract.expiration_date, `option contract ${symbol} expiration`);
          if (expiration !== parsed.expiry || expiration < expirationDateGte || expiration > expirationDateLte) {
            throw new Error(`option contract ${symbol} has invalid expiration metadata`);
          }
          if (!OPTION_TYPES.has(contract.type) || contract.type !== parsed.type || (type !== undefined && contract.type !== type)) {
            throw new Error(`option contract ${symbol} has invalid type metadata`);
          }
          const strike = requireFinite(contract.strike_price, `option contract ${symbol} strike`, { minimum: Number.EPSILON });
          if (Math.abs(strike - parsed.strike) >= 0.0001
            || (strikePriceGte !== undefined && strike < Number(strikePriceGte))
            || (strikePriceLte !== undefined && strike > Number(strikePriceLte))) {
            throw new Error(`option contract ${symbol} has invalid strike metadata`);
          }
          optionContracts.push(contract);
        }
      }
    }
    optionContracts.sort((left, right) => left.expiration_date.localeCompare(right.expiration_date)
      || left.type.localeCompare(right.type)
      || Number(left.strike_price) - Number(right.strike_price)
      || left.symbol.localeCompare(right.symbol));
    const pageCount = pageGroups.reduce((sum, pages) => sum + pages.length, 0);
    return {
      option_contracts: optionContracts,
      next_page_token: null,
      provenance: provenance(this.paperBase, path, pageCount, {
        underlying,
        statuses: [...statuses],
        expiration_date_gte: expirationDateGte,
        expiration_date_lte: expirationDateLte,
        type: type ?? null,
        strike_price_gte: strikePriceGte ?? null,
        strike_price_lte: strikePriceLte ?? null,
      }),
    };
  }

  async getHistoricalOptionBars(symbols, {
    start,
    end,
    timeframe = "1Hour",
    limit = 10_000,
  } = {}) {
    if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > 100) throw new Error("one to 100 historical option symbols are required");
    if (new Set(symbols).size !== symbols.length) throw new Error("historical option symbols must be unique");
    for (const symbol of symbols) assertOptionSymbol(symbol);
    assertDateRange(start, end, { label: "historical option-bar range" });
    assertTimeframe(timeframe, "historical option-bar timeframe");
    assertLimit(limit, 10_000, "historical option-bar page limit");
    const path = "/v1beta1/options/bars";
    const pages = await this.#readAllPages(this.dataBase, path, {
      symbols: symbols.join(","),
      start,
      end,
      timeframe,
      sort: "asc",
      limit: String(limit),
    }, "historical option bars");
    const requested = new Set(symbols);
    const bars = Object.fromEntries(symbols.map((symbol) => [symbol, []]));
    for (const [pageIndex, page] of pages.entries()) {
      const pageBars = requireRecord(page.bars, `historical option-bar page ${pageIndex + 1} bars`);
      for (const [symbol, records] of Object.entries(pageBars)) {
        if (!requested.has(symbol)) throw new Error(`historical option-bar response contains unrequested symbol ${symbol}`);
        bars[symbol].push(...requireArray(records, `historical option bars for ${symbol}`));
      }
    }
    for (const symbol of symbols) assertChronologicalBars(bars[symbol], `historical option bars for ${symbol}`);
    return {
      bars,
      next_page_token: null,
      provenance: provenance(this.dataBase, path, pages.length, { symbols: [...symbols], start, end, timeframe }),
    };
  }

  async #readAllPages(origin, path, query, label) {
    const pages = [];
    const seenTokens = new Set();
    let pageToken;
    while (true) {
      const page = requireRecord(
        await this.#getJson(origin, path, { ...query, page_token: pageToken }, label),
        `${label} response page ${pages.length + 1}`,
      );
      if (!Object.hasOwn(page, "next_page_token")) throw new Error(`${label} response is missing next_page_token`);
      const next = page.next_page_token;
      if (next !== null && (typeof next !== "string" || next.length === 0)) throw new Error(`${label} response has an invalid next_page_token`);
      pages.push(page);
      if (next === null) return pages;
      if (seenTokens.has(next)) throw new Error(`${label} response repeated a page token`);
      if (pages.length >= this.#maxPages) throw new Error(`${label} response exceeded the page safety limit`);
      seenTokens.add(next);
      pageToken = next;
    }
  }

  async #getJson(origin, path, query, label) {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("invalid Alpaca historical path");
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error("historical request escaped the allowlisted origin");
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await this.#fetchImpl(url, {
      method: "GET",
      headers: this.#headers,
      redirect: "error",
    });
    if (!response || typeof response.ok !== "boolean" || !Number.isInteger(response.status) || typeof response.json !== "function") {
      throw new Error(`Alpaca ${label} transport returned a malformed response`);
    }
    if (!response.ok) throw new Error(`Alpaca ${label} read failed with HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error(`Alpaca ${label} response was not valid JSON`);
    }
  }
}

export function alpacaHistoricalCredentialsFromEnv(environment = process.env) {
  return {
    keyId: environment.APCA_API_KEY_ID ?? environment.ALPACA_API_KEY,
    secretKey: environment.APCA_API_SECRET_KEY ?? environment.ALPACA_SECRET_KEY,
  };
}
