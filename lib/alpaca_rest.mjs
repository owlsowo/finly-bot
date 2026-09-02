import { POLICY } from "./policy.mjs";
import { assertPaperHost } from "./alpaca.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

const DATA_ORIGIN = "https://data.alpaca.markets";

function assertIsoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a valid calendar date`);
}

function assertPositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`);
}

function exactOrigin(value, expected, label) {
  const parsed = new URL(value);
  const allowed = new URL(expected);
  if (parsed.origin !== allowed.origin || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error(`${label} origin is not allowlisted`);
  }
  return allowed.origin;
}

export class AlpacaPaperRestClient {
  constructor({
    keyId,
    secretKey,
    tradingBase = POLICY.paperHost,
    dataBase = DATA_ORIGIN,
    fetchImpl = fetch,
  }) {
    if (typeof keyId !== "string" || keyId.length < 8) throw new Error("missing Alpaca paper key ID");
    if (typeof secretKey !== "string" || secretKey.length < 12) throw new Error("missing Alpaca paper secret key");
    this.tradingBase = assertPaperHost(tradingBase);
    this.dataBase = exactOrigin(dataBase, DATA_ORIGIN, "Alpaca data");
    this.fetchImpl = fetchImpl;
    this.headers = Object.freeze({
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey,
      accept: "application/json",
    });
  }

  async getAccount() { return this.#get(this.tradingBase, "/v2/account"); }
  async getAccountConfiguration() { return this.#get(this.tradingBase, "/v2/account/configurations"); }
  async getClock() { return this.#get(this.tradingBase, "/v2/clock"); }
  async getPositions() { return this.#get(this.tradingBase, "/v2/positions"); }
  async getOpenOrders() { return this.#get(this.tradingBase, "/v2/orders", { status: "open", nested: "true", limit: "500" }); }
  async getAsset(symbol) {
    if (typeof symbol !== "string" || !/^[A-Z]{1,5}$/.test(symbol)) throw new Error("invalid US equity symbol");
    return this.#get(this.tradingBase, `/v2/assets/${symbol}`);
  }

  async getOrderByClientOrderId(clientOrderId) {
    if (typeof clientOrderId !== "string" || !/^finly-(?:exit-|g4-)?[a-f0-9]{20}$/.test(clientOrderId)) throw new Error("invalid Finly client order ID");
    return this.#get(
      this.tradingBase,
      "/v2/orders:by_client_order_id",
      { client_order_id: clientOrderId },
      { notFound: "null" },
    );
  }

  async getOrderById(orderId, { nested = true } = {}) {
    if (typeof orderId !== "string" || !/^[a-f0-9-]{16,}$/i.test(orderId)) throw new Error("invalid Alpaca order ID");
    return this.#get(this.tradingBase, `/v2/orders/${orderId}`, { nested: String(nested) });
  }

  async cancelOrder(orderId) {
    if (typeof orderId !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(orderId)) throw new Error("invalid Alpaca order ID");
    const url = new URL(`/v2/orders/${orderId}`, this.tradingBase);
    if (url.origin !== this.tradingBase) throw new Error("request escaped the allowlisted origin");
    const response = await this.fetchImpl(url, { method: "DELETE", headers: this.headers, redirect: "error" });
    if (response.status !== 204) throw new Error(`Alpaca cancel failed with HTTP ${response.status}`);
    return { acknowledged: true };
  }

  async getOptionContracts(underlying, {
    expirationDateGte,
    expirationDateLte,
    type,
    strikePriceGte,
    strikePriceLte,
    limit = 1000,
    showDeliverables = true,
  } = {}) {
    this.#assertUnderlying(underlying);
    if (expirationDateGte !== undefined) assertIsoDate(expirationDateGte, "minimum expiration date");
    if (expirationDateLte !== undefined) assertIsoDate(expirationDateLte, "maximum expiration date");
    if (expirationDateGte !== undefined && expirationDateLte !== undefined && expirationDateGte > expirationDateLte) throw new Error("option expiration bounds are inverted");
    if (type !== undefined && !new Set(["call", "put"]).has(type)) throw new Error("unsupported option type");
    if (strikePriceGte !== undefined) assertPositiveFinite(strikePriceGte, "minimum strike price");
    if (strikePriceLte !== undefined) assertPositiveFinite(strikePriceLte, "maximum strike price");
    if (strikePriceGte !== undefined && strikePriceLte !== undefined && strikePriceGte > strikePriceLte) throw new Error("option strike bounds are inverted");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("option contract limit must be between 1 and 1000");
    if (typeof showDeliverables !== "boolean") throw new Error("showDeliverables must be boolean");
    return this.#get(this.tradingBase, "/v2/options/contracts", {
      underlying_symbols: underlying,
      status: "active",
      expiration_date_gte: expirationDateGte,
      expiration_date_lte: expirationDateLte,
      type,
      strike_price_gte: strikePriceGte,
      strike_price_lte: strikePriceLte,
      limit: String(limit),
      show_deliverables: String(showDeliverables),
    });
  }

  async getOptionChain(underlying, {
    feed = "indicative",
    limit = 1000,
    pageToken,
    type,
    strikePriceGte,
    strikePriceLte,
    expirationDateGte,
    expirationDateLte,
  } = {}) {
    this.#assertUnderlying(underlying);
    if (!new Set(["indicative", "opra"]).has(feed)) throw new Error("unsupported option feed");
    if (type !== undefined && !new Set(["call", "put"]).has(type)) throw new Error("unsupported option type");
    if (strikePriceGte !== undefined) assertPositiveFinite(strikePriceGte, "minimum strike price");
    if (strikePriceLte !== undefined) assertPositiveFinite(strikePriceLte, "maximum strike price");
    if (strikePriceGte !== undefined && strikePriceLte !== undefined && strikePriceGte > strikePriceLte) throw new Error("option strike bounds are inverted");
    if (expirationDateGte !== undefined) assertIsoDate(expirationDateGte, "minimum expiration date");
    if (expirationDateLte !== undefined) assertIsoDate(expirationDateLte, "maximum expiration date");
    if (expirationDateGte !== undefined && expirationDateLte !== undefined && expirationDateGte > expirationDateLte) throw new Error("option expiration bounds are inverted");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("option snapshot limit must be between 1 and 1000");
    return this.#get(this.dataBase, `/v1beta1/options/snapshots/${underlying}`, {
      feed,
      limit: String(limit),
      page_token: pageToken,
      type,
      strike_price_gte: strikePriceGte,
      strike_price_lte: strikePriceLte,
      expiration_date_gte: expirationDateGte,
      expiration_date_lte: expirationDateLte,
    });
  }

  async getStockDailyBars(underlying, { start, end, feed = "iex", limit = 1000, pageToken } = {}) {
    this.#assertUnderlying(underlying);
    assertIsoDate(start, "stock-bar start date");
    assertIsoDate(end, "stock-bar end date");
    if (start > end) throw new Error("stock-bar date bounds are inverted");
    if (!new Set(["iex", "sip"]).has(feed)) throw new Error("unsupported historical stock feed");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("stock-bar limit must be between 1 and 1000");
    return this.#get(this.dataBase, `/v2/stocks/${underlying}/bars`, {
      timeframe: "1Day",
      start,
      end,
      adjustment: "all",
      feed,
      sort: "asc",
      limit: String(limit),
      page_token: pageToken,
    });
  }

  async getStockSnapshot(underlying, { feed = "iex" } = {}) {
    this.#assertUnderlying(underlying);
    if (!new Set(["iex", "sip", "delayed_sip"]).has(feed)) throw new Error("unsupported stock feed");
    return this.#get(this.dataBase, `/v2/stocks/${underlying}/snapshot`, { feed });
  }

  async getStockLatestQuote(underlying, { feed = "iex" } = {}) {
    this.#assertUnderlying(underlying);
    if (!new Set(["iex", "sip", "delayed_sip"]).has(feed)) throw new Error("unsupported stock feed");
    return this.#get(this.dataBase, `/v2/stocks/${underlying}/quotes/latest`, { feed });
  }

  async getLatestOptionQuotes(symbols, { feed = "indicative" } = {}) {
    if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > 100) throw new Error("one to 100 option symbols are required");
    for (const symbol of symbols) {
      let parsed;
      try {
        parsed = parseOccOptionSymbol(symbol);
      } catch {
        throw new Error("option symbol is outside Finly's allowlist");
      }
      if (!POLICY.underlyings.includes(parsed.underlying)) throw new Error("option symbol is outside Finly's allowlist");
    }
    if (!new Set(["indicative", "opra"]).has(feed)) throw new Error("unsupported option feed");
    return this.#get(this.dataBase, "/v1beta1/options/quotes/latest", { symbols: symbols.join(","), feed });
  }

  async getNews(underlying, { start, limit = 20 } = {}) {
    this.#assertUnderlying(underlying);
    return this.#get(this.dataBase, "/v1beta1/news", {
      symbols: underlying,
      start,
      sort: "desc",
      limit: String(limit),
      include_content: "false",
    });
  }

  #assertUnderlying(underlying) {
    if (!POLICY.underlyings.includes(underlying)) throw new Error("underlying is outside Finly's allowlist");
  }

  async #get(origin, path, query = {}, { notFound = "error" } = {}) {
    if (!new Set(["error", "null"]).has(notFound)) throw new Error("invalid Alpaca not-found policy");
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("invalid Alpaca path");
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error("request escaped the allowlisted origin");
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    }
    const response = await this.fetchImpl(url, { method: "GET", headers: this.headers, redirect: "error" });
    if (response.status === 404 && notFound === "null") return null;
    if (!response.ok) throw new Error(`Alpaca read failed with HTTP ${response.status}`);
    return response.json();
  }
}

export function alpacaCredentialsFromEnv(environment = process.env) {
  return {
    keyId: environment.APCA_API_KEY_ID ?? environment.ALPACA_API_KEY,
    secretKey: environment.APCA_API_SECRET_KEY ?? environment.ALPACA_SECRET_KEY,
  };
}
