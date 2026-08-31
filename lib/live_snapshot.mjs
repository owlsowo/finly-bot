import { POLICY } from "./policy.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

const DATA_ORIGIN = "https://data.alpaca.markets";
const DAY_MS = 86_400_000;
const OPTION_TYPES = Object.freeze(["call", "put"]);

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireOwn(record, field, label) {
  if (!Object.hasOwn(record, field)) throw new Error(`${label} is missing ${field}`);
  return record[field];
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireFinite(value, label, { minimum = -Infinity, maximum = Infinity, integer = false } = {}) {
  if (value === null || value === "" || typeof value === "boolean") throw new Error(`${label} must be numeric`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} is outside its numeric bounds`);
  }
  return number;
}

function parseTimestamp(value, label, asOf, maximumAgeSeconds) {
  requireText(value, label);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${label} is not RFC-3339 compatible`);
  const ageSeconds = (asOf.getTime() - timestamp.getTime()) / 1000;
  if (ageSeconds < 0) throw new Error(`${label} is in the future`);
  if (maximumAgeSeconds !== undefined && ageSeconds > maximumAgeSeconds) throw new Error(`${label} is stale`);
  return { iso: timestamp.toISOString(), ageSeconds: round(ageSeconds, 3) };
}

function normalizeAsOf(value) {
  const asOf = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(asOf.getTime())) throw new Error("live snapshot asOf is invalid");
  return asOf;
}

function marketDateOnly(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function shiftCalendarDays(date, days) {
  const shifted = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(shifted.getTime())) throw new Error(`invalid calendar date: ${date}`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function dateOrdinal(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`invalid calendar date: ${date}`);
  return parsed.getTime() / DAY_MS;
}

function assertPageComplete(page, itemsField, label) {
  requireRecord(page, label);
  if (!Object.hasOwn(page, "next_page_token")) throw new Error(`${label} is missing next_page_token`);
  if (page.next_page_token !== null) throw new Error(`${label} is incomplete because pagination remains`);
  return requireOwn(page, itemsField, label);
}

function normalizeStockSnapshot(response, { underlying, stockFeed, asOf, maximumAgeSeconds }) {
  const snapshot = requireRecord(response, "stock snapshot response");
  if (Object.hasOwn(snapshot, "symbol") && snapshot.symbol !== underlying) throw new Error("stock snapshot symbol differs from the request");
  if (Object.hasOwn(snapshot, "feed") && snapshot.feed !== stockFeed) throw new Error("stock snapshot feed differs from the request");
  const quote = requireRecord(requireOwn(snapshot, "latestQuote", "stock snapshot response"), "stock latestQuote");
  const bid = requireFinite(requireOwn(quote, "bp", "stock latestQuote"), "stock bid", { minimum: 0 });
  const ask = requireFinite(requireOwn(quote, "ap", "stock latestQuote"), "stock ask", { minimum: Number.EPSILON });
  if (ask <= bid) throw new Error("stock latestQuote is crossed or locked");
  const timestamp = parseTimestamp(requireOwn(quote, "t", "stock latestQuote"), "stock quote timestamp", asOf, maximumAgeSeconds);
  return { spot: round((bid + ask) / 2, 6), observedAt: timestamp.iso, quoteAgeSeconds: timestamp.ageSeconds };
}

function historicalReturns(response, { underlying, stockFeed, historySessions, historyEnd }) {
  const bars = requireArray(assertPageComplete(response, "bars", "stock daily-bars response"), "stock daily-bars response bars");
  if (requireText(requireOwn(response, "symbol", "stock daily-bars response"), "stock daily-bars response symbol") !== underlying) {
    throw new Error("stock daily-bars symbol differs from the request");
  }
  if (Object.hasOwn(response, "feed") && response.feed !== stockFeed) throw new Error("stock daily-bars feed differs from the request");
  if (bars.length < historySessions + 1) throw new Error(`stock daily-bars response needs at least ${historySessions + 1} bars`);
  const cutoff = new Date(`${historyEnd}T23:59:59.999Z`).getTime();
  const normalized = bars.map((raw, index) => {
    const bar = requireRecord(raw, `stock daily bar ${index}`);
    const timestamp = new Date(requireText(requireOwn(bar, "t", `stock daily bar ${index}`), `stock daily bar ${index} timestamp`));
    if (Number.isNaN(timestamp.getTime())) throw new Error(`stock daily bar ${index} timestamp is invalid`);
    if (timestamp.getTime() > cutoff) throw new Error(`stock daily bar ${index} is newer than the requested completed-history bound`);
    const close = requireFinite(requireOwn(bar, "c", `stock daily bar ${index}`), `stock daily bar ${index} close`, { minimum: Number.EPSILON });
    return { timestamp: timestamp.getTime(), close };
  });
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].timestamp <= normalized[index - 1].timestamp) throw new Error("stock daily bars are duplicated or out of order");
  }
  const closes = normalized.slice(-(historySessions + 1)).map((bar) => bar.close);
  return closes.slice(1).map((close, index) => round(Math.log(close / closes[index]), 8));
}

function normalizeContract(raw, { underlying, expectedType, minimumExpiry, maximumExpiry, minimumStrike, maximumStrike }) {
  const contract = requireRecord(raw, "option contract");
  const symbol = requireText(requireOwn(contract, "symbol", "option contract"), "option contract symbol");
  const status = requireText(requireOwn(contract, "status", `option contract ${symbol}`), `option contract ${symbol} status`);
  if (status !== "active") throw new Error(`option contract ${symbol} is not active`);
  const type = requireText(requireOwn(contract, "type", `option contract ${symbol}`), `option contract ${symbol} type`);
  const expiry = requireText(requireOwn(contract, "expiration_date", `option contract ${symbol}`), `option contract ${symbol} expiration`);
  const strike = requireFinite(requireOwn(contract, "strike_price", `option contract ${symbol}`), `option contract ${symbol} strike`, { minimum: Number.EPSILON });
  const multiplier = requireFinite(requireOwn(contract, "multiplier", `option contract ${symbol}`), `option contract ${symbol} multiplier`, { minimum: 1, integer: true });
  const size = requireFinite(requireOwn(contract, "size", `option contract ${symbol}`), `option contract ${symbol} size`, { minimum: 1, integer: true });
  const rawOpenInterest = requireOwn(contract, "open_interest", `option contract ${symbol}`);
  // Alpaca reports null open interest for some newly listed or unmeasured
  // contracts. Treat only that explicit provider state as zero so the contract
  // is deterministically ineligible instead of letting one unusable row poison
  // the complete bounded chain. All other malformed values still fail closed.
  const openInterest = rawOpenInterest === null
    ? 0
    : requireFinite(rawOpenInterest, `option contract ${symbol} open interest`, { minimum: 0, integer: true });
  const tradable = requireOwn(contract, "tradable", `option contract ${symbol}`);
  if (typeof tradable !== "boolean") throw new Error(`option contract ${symbol} tradable must be boolean`);
  const underlyingSymbol = requireText(requireOwn(contract, "underlying_symbol", `option contract ${symbol}`), `option contract ${symbol} underlying`);
  const rootSymbol = requireText(requireOwn(contract, "root_symbol", `option contract ${symbol}`), `option contract ${symbol} root symbol`);
  const style = requireText(requireOwn(contract, "style", `option contract ${symbol}`), `option contract ${symbol} style`);
  const deliverables = requireArray(requireOwn(contract, "deliverables", `option contract ${symbol}`), `option contract ${symbol} deliverables`);
  const occ = parseOccOptionSymbol(symbol);
  if (underlyingSymbol !== underlying || occ.underlying !== underlying) throw new Error(`option contract ${symbol} has the wrong underlying`);
  if (type !== expectedType || occ.type !== type) throw new Error(`option contract ${symbol} has the wrong type`);
  if (occ.expiry !== expiry) throw new Error(`option contract ${symbol} has inconsistent expiration metadata`);
  if (Math.abs(occ.strike - strike) >= 0.0001) throw new Error(`option contract ${symbol} has inconsistent strike metadata`);
  if (expiry < minimumExpiry || expiry > maximumExpiry) throw new Error(`option contract ${symbol} is outside the expiration bounds`);
  if (strike < minimumStrike || strike > maximumStrike) throw new Error(`option contract ${symbol} is outside the strike bounds`);
  const standardDeliverable = deliverables.length === 1
    && deliverables[0]?.type === "equity"
    && deliverables[0]?.symbol === underlying
    && Number(deliverables[0]?.amount) === 100
    && deliverables[0]?.delayed_settlement === false;
  return {
    symbol,
    type,
    expiry,
    strike,
    openInterest,
    tradable,
    structurallyEligible: tradable && rootSymbol === underlying && style === "american" && multiplier === 100 && size === 100 && standardDeliverable,
  };
}

function normalizeContracts(pages, bounds) {
  const contracts = new Map();
  for (let index = 0; index < OPTION_TYPES.length; index += 1) {
    const expectedType = OPTION_TYPES[index];
    const records = requireArray(assertPageComplete(pages[index], "option_contracts", `${expectedType} option-contract response`), `${expectedType} option contracts`);
    for (const raw of records) {
      const contract = normalizeContract(raw, { ...bounds, expectedType });
      if (contracts.has(contract.symbol)) throw new Error(`duplicate option contract: ${contract.symbol}`);
      contracts.set(contract.symbol, contract);
    }
  }
  return contracts;
}

function mergeSnapshots(pages, optionFeed, contracts) {
  const snapshots = new Map();
  for (let index = 0; index < OPTION_TYPES.length; index += 1) {
    const type = OPTION_TYPES[index];
    const page = requireRecord(pages[index], `${type} option-chain response`);
    if (Object.hasOwn(page, "feed") && page.feed !== optionFeed) throw new Error(`${type} option-chain feed differs from the request`);
    const entries = requireRecord(assertPageComplete(page, "snapshots", `${type} option-chain response`), `${type} option-chain snapshots`);
    for (const [symbol, snapshot] of Object.entries(entries)) {
      const contract = contracts.get(symbol);
      if (!contract) throw new Error(`option snapshot ${symbol} has no matching contract metadata`);
      if (contract.type !== type) throw new Error(`option snapshot ${symbol} appeared in the wrong type page`);
      if (snapshots.has(symbol)) throw new Error(`duplicate option snapshot: ${symbol}`);
      snapshots.set(symbol, snapshot);
    }
  }
  return snapshots;
}

function normalizeOptionChain(contracts, snapshots, { underlying, optionFeed, asOf, marketDate }) {
  const chain = [];
  for (const contract of contracts.values()) {
    if (!contract.structurallyEligible) continue;
    // A bounded Alpaca page can legitimately contain newly listed contracts
    // whose individual snapshot is absent, null, crossed, or stale. Such a row
    // is not executable evidence. Exclude that contract only; never repair or
    // infer its market fields, and let the downstream gate abstain if the
    // remaining complete surface is insufficient.
    if (!snapshots.has(contract.symbol)) continue;
    try {
      const snapshot = requireRecord(snapshots.get(contract.symbol), `option snapshot ${contract.symbol}`);
      const quote = requireRecord(requireOwn(snapshot, "latestQuote", `option snapshot ${contract.symbol}`), `latest quote ${contract.symbol}`);
      const bid = requireFinite(requireOwn(quote, "bp", `latest quote ${contract.symbol}`), `bid ${contract.symbol}`, { minimum: 0 });
      const ask = requireFinite(requireOwn(quote, "ap", `latest quote ${contract.symbol}`), `ask ${contract.symbol}`, { minimum: Number.EPSILON });
      if (ask <= bid) throw new Error(`latest quote ${contract.symbol} is crossed or locked`);
      const observed = parseTimestamp(
        requireOwn(quote, "t", `latest quote ${contract.symbol}`),
        `quote timestamp ${contract.symbol}`,
        asOf,
        POLICY.quoteMaxAgeSeconds[optionFeed],
      );
      const impliedVolatility = requireFinite(
        requireOwn(snapshot, "impliedVolatility", `option snapshot ${contract.symbol}`),
        `implied volatility ${contract.symbol}`,
        { minimum: Number.EPSILON, maximum: 5 - Number.EPSILON },
      );
      const dte = dateOrdinal(contract.expiry) - dateOrdinal(marketDate);
      if (!Number.isInteger(dte) || dte < POLICY.entryDte.min || dte > POLICY.entryDte.max) throw new Error(`DTE is outside policy for ${contract.symbol}`);
      chain.push({
        underlying,
        symbol: contract.symbol,
        type: contract.type,
        expiry: contract.expiry,
        strike: contract.strike,
        bid,
        ask,
        iv: impliedVolatility,
        dte,
        feed: optionFeed,
        quote_age_seconds: observed.ageSeconds,
        open_interest: contract.openInterest,
        tradable: contract.tradable,
      });
    } catch {
      // Per-contract exclusion is fail-closed: the unusable row cannot reach
      // signal aggregation, candidate enumeration, or an order certificate.
    }
  }
  return chain.sort((left, right) => left.expiry.localeCompare(right.expiry) || left.type.localeCompare(right.type) || left.strike - right.strike);
}

/**
 * Read-only normalization boundary for Alpaca paper/data REST. It binds the
 * requested feeds and bounded query filters to compiler-shaped market data;
 * it does not score evidence, infer direction, or choose an option structure.
 */
export async function fetchAlpacaLiveSnapshot(client, {
  underlying = "SPY",
  asOf = new Date(),
  optionFeed = "indicative",
  stockFeed = "iex",
  historySessions = 96,
  strikeBandFraction = 0.05,
} = {}) {
  if (!client || client.tradingBase !== POLICY.paperHost || client.dataBase !== DATA_ORIGIN) {
    throw new Error("live snapshot client is not locked to Alpaca paper and data origins");
  }
  if (!POLICY.underlyings.includes(underlying)) throw new Error("live snapshot underlying is outside Finly's allowlist");
  if (!new Set(["indicative", "opra"]).has(optionFeed)) throw new Error("live snapshot option feed is unsupported");
  if (!new Set(["iex", "sip"]).has(stockFeed)) throw new Error("live snapshot stock feed must be current IEX or SIP data");
  if (!Number.isInteger(historySessions) || historySessions < 20 || historySessions > 252) throw new Error("historySessions must be an integer from 20 to 252");
  if (!Number.isFinite(strikeBandFraction) || strikeBandFraction < 0.01 || strikeBandFraction > 0.25) throw new Error("strikeBandFraction must be in [0.01, 0.25]");
  const observedAt = normalizeAsOf(asOf);
  const maximumAgeSeconds = POLICY.quoteMaxAgeSeconds[optionFeed];
  const marketDate = marketDateOnly(observedAt);
  const historyEnd = shiftCalendarDays(marketDate, -1);
  const historyStart = shiftCalendarDays(marketDate, -Math.ceil((historySessions + 1) * 2.25));
  const [stockSnapshot, barsResponse] = await Promise.all([
    client.getStockSnapshot(underlying, { feed: stockFeed }),
    client.getStockDailyBars(underlying, { start: historyStart, end: historyEnd, feed: stockFeed, limit: 1000 }),
  ]);
  const stock = normalizeStockSnapshot(stockSnapshot, { underlying, stockFeed, asOf: observedAt, maximumAgeSeconds });
  const logReturns = historicalReturns(barsResponse, { underlying, stockFeed, historySessions, historyEnd });
  const minimumExpiry = shiftCalendarDays(marketDate, POLICY.entryDte.min);
  const maximumExpiry = shiftCalendarDays(marketDate, POLICY.entryDte.max);
  const minimumStrike = round(stock.spot * (1 - strikeBandFraction), 2);
  const maximumStrike = round(stock.spot * (1 + strikeBandFraction), 2);
  const boundedFilters = {
    expirationDateGte: minimumExpiry,
    expirationDateLte: maximumExpiry,
    strikePriceGte: minimumStrike,
    strikePriceLte: maximumStrike,
    limit: 1000,
  };
  const contractPages = await Promise.all(OPTION_TYPES.map((type) => client.getOptionContracts(underlying, {
    ...boundedFilters,
    type,
    showDeliverables: true,
  })));
  const contracts = normalizeContracts(contractPages, { underlying, minimumExpiry, maximumExpiry, minimumStrike, maximumStrike });
  const snapshotPages = await Promise.all(OPTION_TYPES.map((type) => client.getOptionChain(underlying, {
    ...boundedFilters,
    type,
    feed: optionFeed,
  })));
  const snapshots = mergeSnapshots(snapshotPages, optionFeed, contracts);
  const optionChain = normalizeOptionChain(contracts, snapshots, { underlying, optionFeed, asOf: observedAt, marketDate });
  return {
    market: {
      underlying,
      spot: stock.spot,
      observed_at: stock.observedAt,
      quote_age_seconds: stock.quoteAgeSeconds,
      option_feed: optionFeed,
      feed_disclosure: optionFeed === "indicative"
        ? `Alpaca indicative options feed (modified quotes and delayed trades); ${stockFeed.toUpperCase()} stock snapshot and adjusted daily bars.`
        : `Alpaca OPRA options feed; ${stockFeed.toUpperCase()} stock snapshot and adjusted daily bars.`,
      history_mode: `alpaca_${stockFeed}_adjusted_daily_bars`,
      historical_log_returns: logReturns,
    },
    option_chain: optionChain,
  };
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
