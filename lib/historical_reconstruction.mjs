import { POLICY } from "./policy.mjs";
import { blackScholesPrice } from "./quant.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_YEAR = 365 * 86_400_000;
const NEW_YORK = "America/New_York";
const PRICE_BASES = new Set(["open", "close", "vwap", "explicit_midpoint"]);

export const HISTORICAL_RECONSTRUCTION_LABELS = Object.freeze({
  quote_source: "RECONSTRUCTED_FROM_HISTORICAL_BAR_NOT_NBBO",
  volatility_source: "SOLVED_FROM_RECONSTRUCTED_MIDPOINT_NOT_REPORTED_IV",
  liquidity_source: "DETERMINISTIC_PROXY_NOT_HISTORICAL_ORDER_BOOK",
  missing_exit_policy: "FULL_DEBIT_LOSS_WHEN_EITHER_REQUIRED_EXIT_QUOTE_IS_UNUSABLE",
});

/**
 * Public methodology metadata. Reports should retain these labels verbatim so
 * reconstructed bars are never presented as historical bid/ask or IV data.
 *
 * The full synthetic spread is:
 *
 *   max($0.02, 5% of midpoint, 50% of observed range)
 *     * (1 + 1/sqrt(volume) + 1/sqrt(trade count)).
 *
 * Bid is rounded down and ask up to the nearest cent. Current-bar liquidity is
 * usable only for a completed close/VWAP bar. Open and explicit-midpoint paths
 * require a separately timestamped, already-available liquidity observation.
 */
export const HISTORICAL_RECONSTRUCTION_METHOD = Object.freeze({
  schema_version: "finly_historical_option_reconstruction_method.v1",
  method_id: "alpaca_bar_conservative_spread_iv_bisection_v1",
  default_bar_duration_seconds: 60,
  supported_price_bases: Object.freeze([...PRICE_BASES]),
  minimum_reference_price: 0.05,
  minimum_bar_volume: 10,
  minimum_bar_trade_count: 3,
  minimum_full_spread_dollars: 0.02,
  midpoint_fraction_full_spread: 0.05,
  range_fraction_full_spread: 0.5,
  maximum_relative_reconstructed_spread: 0.25,
  maximum_spot_distance_seconds: 60,
  implied_volatility_bounds: Object.freeze({ minimum: 0.0001, maximum: 4.999 }),
  expiry_time_assumption: "16:00 America/New_York on the contract expiration date",
  labels: HISTORICAL_RECONSTRUCTION_LABELS,
  limitations: Object.freeze([
    "Alpaca historical option OHLC/VWAP bars do not contain the true contemporaneous bid and ask.",
    "Alpaca historical option OHLC/VWAP bars do not contain a reported contemporaneous implied volatility.",
    "The reconstructed spread is a deterministic conservative proxy, not an estimate of historical NBBO execution.",
    "An open-price reconstruction never uses that bar's later high, low, volume, VWAP, close, or trade count.",
  ]),
});

function failure(reason, detail = {}) {
  return { ok: false, reason, ...detail };
}

function finiteNumber(value, label, { minimum = -Infinity, maximum = Infinity, integer = false } = {}) {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isInteger(parsed))) {
    throw new TypeError(`${label} is outside its numeric bounds`);
  }
  return parsed;
}

function timestamp(value, label) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${label} is not a valid timestamp`);
  return parsed;
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function floorCent(value) {
  return Math.floor((value + Number.EPSILON) * 100) / 100;
}

function ceilCent(value) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function timeZoneParts(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

function zonedMarketClose(expiry) {
  if (typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    throw new TypeError("contract expiration is not YYYY-MM-DD");
  }
  const [year, month, day] = expiry.split("-").map(Number);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) {
    throw new TypeError("contract expiration is not a valid calendar date");
  }
  const desiredAsUtc = Date.UTC(year, month - 1, day, 16, 0, 0);
  let candidate = desiredAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = timeZoneParts(new Date(candidate), NEW_YORK);
    const renderedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate += desiredAsUtc - renderedAsUtc;
  }
  return new Date(candidate);
}

function noArbitrageBounds({ type, spot, strike, timeYears, rate, dividend }) {
  const discountedSpot = spot * Math.exp(-dividend * timeYears);
  const discountedStrike = strike * Math.exp(-rate * timeYears);
  return type === "call"
    ? { minimum: Math.max(0, discountedSpot - discountedStrike), maximum: discountedSpot }
    : { minimum: Math.max(0, discountedStrike - discountedSpot), maximum: discountedStrike };
}

/**
 * Pure bisection implied-volatility solver. Economically impossible prices and
 * prices not bracketed by the disclosed volatility interval return `ok:false`;
 * they are never coerced to a boundary volatility.
 */
export function solveImpliedVolatility({
  type,
  spot,
  strike,
  timeYears,
  marketPrice,
  rate = POLICY.interestRate,
  dividend = POLICY.dividendYield,
  minimumVolatility = HISTORICAL_RECONSTRUCTION_METHOD.implied_volatility_bounds.minimum,
  maximumVolatility = HISTORICAL_RECONSTRUCTION_METHOD.implied_volatility_bounds.maximum,
  priceTolerance = 0.000001,
  volatilityTolerance = 0.0000001,
  maximumIterations = 100,
} = {}) {
  if (!new Set(["call", "put"]).has(type)) throw new TypeError("option type must be call or put");
  const normalized = {
    type,
    spot: finiteNumber(spot, "spot", { minimum: Number.EPSILON }),
    strike: finiteNumber(strike, "strike", { minimum: Number.EPSILON }),
    timeYears: finiteNumber(timeYears, "timeYears", { minimum: Number.EPSILON }),
    marketPrice: finiteNumber(marketPrice, "marketPrice", { minimum: 0 }),
    rate: finiteNumber(rate, "rate"),
    dividend: finiteNumber(dividend, "dividend"),
  };
  const low = finiteNumber(minimumVolatility, "minimumVolatility", { minimum: Number.EPSILON });
  const high = finiteNumber(maximumVolatility, "maximumVolatility", { minimum: low + Number.EPSILON });
  const priceEpsilon = finiteNumber(priceTolerance, "priceTolerance", { minimum: Number.EPSILON });
  const volatilityEpsilon = finiteNumber(volatilityTolerance, "volatilityTolerance", { minimum: Number.EPSILON });
  finiteNumber(maximumIterations, "maximumIterations", { minimum: 1, maximum: 1_000, integer: true });

  const bounds = noArbitrageBounds(normalized);
  if (normalized.marketPrice < bounds.minimum - priceEpsilon || normalized.marketPrice > bounds.maximum + priceEpsilon) {
    return failure("PRICE_OUTSIDE_NO_ARBITRAGE_BOUNDS", {
      no_arbitrage_bounds: { minimum: round(bounds.minimum, 8), maximum: round(bounds.maximum, 8) },
      market_price: normalized.marketPrice,
    });
  }

  const priceAtLow = blackScholesPrice({ ...normalized, volatility: low });
  const priceAtHigh = blackScholesPrice({ ...normalized, volatility: high });
  if (normalized.marketPrice < priceAtLow - priceEpsilon || normalized.marketPrice > priceAtHigh + priceEpsilon) {
    return failure("PRICE_NOT_BRACKETED_BY_VOLATILITY_BOUNDS", {
      volatility_bounds: { minimum: low, maximum: high },
      model_price_bounds: { minimum: round(priceAtLow, 8), maximum: round(priceAtHigh, 8) },
      market_price: normalized.marketPrice,
    });
  }
  if (Math.abs(normalized.marketPrice - priceAtLow) <= priceEpsilon) {
    return { ok: true, volatility: low, iterations: 0, repriced: round(priceAtLow, 8) };
  }
  if (Math.abs(normalized.marketPrice - priceAtHigh) <= priceEpsilon) {
    return { ok: true, volatility: high, iterations: 0, repriced: round(priceAtHigh, 8) };
  }

  let left = low;
  let right = high;
  let midpoint = (left + right) / 2;
  let modelPrice = blackScholesPrice({ ...normalized, volatility: midpoint });
  for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
    midpoint = (left + right) / 2;
    modelPrice = blackScholesPrice({ ...normalized, volatility: midpoint });
    if (Math.abs(modelPrice - normalized.marketPrice) <= priceEpsilon || right - left <= volatilityEpsilon) {
      return {
        ok: true,
        volatility: round(midpoint, 8),
        iterations: iteration,
        repriced: round(modelPrice, 8),
      };
    }
    if (modelPrice < normalized.marketPrice) left = midpoint;
    else right = midpoint;
  }
  return failure("IMPLIED_VOLATILITY_DID_NOT_CONVERGE", {
    volatility_bounds: { minimum: left, maximum: right },
    market_price: normalized.marketPrice,
    last_model_price: round(modelPrice, 8),
  });
}

function normalizeContract(contract, asOf) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return failure("INVALID_CONTRACT_METADATA");
  }
  let occ;
  try {
    occ = parseOccOptionSymbol(contract.symbol);
  } catch {
    return failure("INVALID_CONTRACT_METADATA");
  }
  const underlying = contract.underlying_symbol ?? contract.underlying ?? occ.underlying;
  const expiry = contract.expiration_date ?? contract.expiry ?? occ.expiry;
  const type = contract.type ?? occ.type;
  const strike = Number(contract.strike_price ?? contract.strike ?? occ.strike);
  if (underlying !== "SPY" || occ.underlying !== underlying || expiry !== occ.expiry || type !== occ.type
    || !Number.isFinite(strike) || Math.abs(strike - occ.strike) >= 0.0001) {
    return failure("CONTRACT_METADATA_MISMATCH");
  }
  if (contract.multiplier !== undefined && Number(contract.multiplier) !== 100) {
    return failure("NONSTANDARD_CONTRACT_MULTIPLIER");
  }
  let availableAt = null;
  if (contract.available_at !== undefined) {
    try {
      availableAt = timestamp(contract.available_at, "contract available_at");
    } catch {
      return failure("INVALID_CONTRACT_AVAILABILITY_TIMESTAMP");
    }
    if (availableAt > asOf) return failure("CONTRACT_METADATA_NOT_AVAILABLE_AT_AS_OF");
  }
  return {
    ok: true,
    contract: { symbol: contract.symbol, underlying, expiry, type, strike },
    availableAt,
  };
}

function normalizeLiquidity(observation, priceAvailableAt, asOf) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    return failure("LIQUIDITY_EVIDENCE_UNAVAILABLE");
  }
  let availableAt;
  try {
    availableAt = timestamp(observation.available_at ?? observation.observed_at, "liquidity available_at");
  } catch {
    return failure("INVALID_LIQUIDITY_TIMESTAMP");
  }
  if (availableAt > asOf || availableAt > priceAvailableAt) {
    return failure("LIQUIDITY_EVIDENCE_NOT_AVAILABLE_AT_PRICE_TIME");
  }
  let volume;
  let tradeCount;
  let range;
  try {
    volume = finiteNumber(observation.volume ?? observation.v, "liquidity volume", { minimum: 0, integer: true });
    tradeCount = finiteNumber(observation.trade_count ?? observation.n, "liquidity trade count", { minimum: 0, integer: true });
    if (observation.range !== undefined) {
      range = finiteNumber(observation.range, "liquidity range", { minimum: 0 });
    } else {
      const high = finiteNumber(observation.high ?? observation.h, "liquidity high", { minimum: 0 });
      const low = finiteNumber(observation.low ?? observation.l, "liquidity low", { minimum: 0 });
      if (high < low) return failure("INVALID_LIQUIDITY_RANGE");
      range = high - low;
    }
  } catch {
    return failure("INVALID_LIQUIDITY_OBSERVATION");
  }
  if (volume < HISTORICAL_RECONSTRUCTION_METHOD.minimum_bar_volume
    || tradeCount < HISTORICAL_RECONSTRUCTION_METHOD.minimum_bar_trade_count) {
    return failure("ILLIQUID_OPTION_BAR", { observed_volume: volume, observed_trade_count: tradeCount });
  }
  return { ok: true, volume, tradeCount, range, availableAt };
}

function selectPriceAndAvailability({
  bar,
  priceBasis,
  explicitMidpoint,
  priceAvailableAt,
  barDurationSeconds,
  asOf,
}) {
  if (!PRICE_BASES.has(priceBasis)) throw new TypeError("unsupported historical option price basis");
  if (priceBasis === "explicit_midpoint") {
    const midpointRecord = typeof explicitMidpoint === "object" && explicitMidpoint !== null
      ? explicitMidpoint
      : { price: explicitMidpoint, observed_at: priceAvailableAt };
    let availableAt;
    let price;
    try {
      price = finiteNumber(midpointRecord.price, "explicit midpoint", { minimum: 0 });
      availableAt = timestamp(midpointRecord.observed_at ?? midpointRecord.available_at ?? priceAvailableAt, "explicit midpoint observed_at");
    } catch {
      return failure("INVALID_EXPLICIT_MIDPOINT");
    }
    if (availableAt > asOf) return failure("PRICE_NOT_AVAILABLE_AT_AS_OF");
    return {
      ok: true,
      price,
      availableAt,
      barStart: null,
      barEnd: null,
      sameBarLiquidityAllowed: false,
      sourceField: "explicit_midpoint",
    };
  }

  if (!bar || typeof bar !== "object" || Array.isArray(bar)) return failure("OPTION_BAR_MISSING");
  let barStart;
  let barEnd;
  let availableAt;
  let price;
  try {
    barStart = timestamp(bar.t ?? bar.timestamp, "option bar timestamp");
    barEnd = new Date(barStart.getTime() + barDurationSeconds * MILLISECONDS_PER_SECOND);
    const candidate = priceBasis === "open" ? bar.o ?? bar.open
      : priceBasis === "close" ? bar.c ?? bar.close
        : bar.vw ?? bar.vwap;
    price = finiteNumber(candidate, `option bar ${priceBasis}`, { minimum: 0 });
    if (priceBasis === "open") {
      if (priceAvailableAt === undefined && bar.open_available_at === undefined) {
        return failure("OPEN_PRICE_REQUIRES_EXPLICIT_AVAILABILITY_TIMESTAMP");
      }
      availableAt = timestamp(priceAvailableAt ?? bar.open_available_at, "open price available_at");
      if (availableAt < barStart) return failure("PRICE_AVAILABILITY_PRECEDES_BAR");
    } else {
      const declared = priceAvailableAt ?? bar.available_at ?? bar.end_at;
      availableAt = declared === undefined ? barEnd : timestamp(declared, `${priceBasis} price available_at`);
      if (availableAt < barEnd) return failure("COMPLETED_BAR_PRICE_DECLARED_AVAILABLE_TOO_EARLY");
    }
  } catch {
    return failure("INVALID_OPTION_BAR");
  }
  if (barStart > asOf || availableAt > asOf) return failure("PRICE_NOT_AVAILABLE_AT_AS_OF");
  return {
    ok: true,
    price,
    availableAt,
    barStart,
    barEnd,
    sameBarLiquidityAllowed: priceBasis !== "open",
    sourceField: priceBasis,
  };
}

/**
 * Reconstructs a conservative point-in-time quote from information that was
 * already available at `asOf`. `priceBasis` may be `open`, `close`, or `vwap`.
 * Supplying `explicitMidpoint` selects `explicit_midpoint` automatically unless
 * a conflicting basis is explicitly requested.
 */
export function reconstructHistoricalOptionQuote({
  bar = null,
  contract,
  underlying,
  asOf,
  priceBasis,
  explicitMidpoint,
  priceAvailableAt,
  liquidityObservation = null,
  barDurationSeconds = HISTORICAL_RECONSTRUCTION_METHOD.default_bar_duration_seconds,
  rate = POLICY.interestRate,
  dividend = POLICY.dividendYield,
} = {}) {
  const decisionTime = timestamp(asOf, "historical reconstruction asOf");
  const duration = finiteNumber(barDurationSeconds, "barDurationSeconds", { minimum: 1, maximum: 86_400, integer: true });
  const selectedBasis = priceBasis ?? (explicitMidpoint !== undefined ? "explicit_midpoint" : "vwap");
  if (explicitMidpoint !== undefined && selectedBasis !== "explicit_midpoint") {
    throw new TypeError("explicitMidpoint conflicts with priceBasis");
  }

  const normalizedContract = normalizeContract(contract, decisionTime);
  if (!normalizedContract.ok) return { ...normalizedContract, methodology: HISTORICAL_RECONSTRUCTION_LABELS };
  const selected = selectPriceAndAvailability({
    bar,
    priceBasis: selectedBasis,
    explicitMidpoint,
    priceAvailableAt,
    barDurationSeconds: duration,
    asOf: decisionTime,
  });
  if (!selected.ok) return { ...selected, methodology: HISTORICAL_RECONSTRUCTION_LABELS };
  if (normalizedContract.availableAt && normalizedContract.availableAt > selected.availableAt) {
    return failure("CONTRACT_METADATA_NOT_AVAILABLE_AT_PRICE_TIME", {
      methodology: HISTORICAL_RECONSTRUCTION_LABELS,
    });
  }

  if (!underlying || typeof underlying !== "object" || Array.isArray(underlying)) {
    return failure("CONTEMPORANEOUS_SPOT_MISSING", { methodology: HISTORICAL_RECONSTRUCTION_LABELS });
  }
  let spot;
  let spotObservedAt;
  try {
    if ((underlying.symbol ?? "SPY") !== "SPY") return failure("SPOT_UNDERLYING_MISMATCH", { methodology: HISTORICAL_RECONSTRUCTION_LABELS });
    spot = finiteNumber(underlying.price ?? underlying.spot, "underlying spot", { minimum: Number.EPSILON });
    spotObservedAt = timestamp(underlying.observed_at ?? underlying.available_at, "underlying observed_at");
  } catch {
    return failure("INVALID_CONTEMPORANEOUS_SPOT", { methodology: HISTORICAL_RECONSTRUCTION_LABELS });
  }
  if (spotObservedAt > decisionTime || spotObservedAt > selected.availableAt) {
    return failure("SPOT_NOT_AVAILABLE_AT_PRICE_TIME", { methodology: HISTORICAL_RECONSTRUCTION_LABELS });
  }
  const spotDistanceSeconds = Math.abs(selected.availableAt.getTime() - spotObservedAt.getTime()) / MILLISECONDS_PER_SECOND;
  if (spotDistanceSeconds > HISTORICAL_RECONSTRUCTION_METHOD.maximum_spot_distance_seconds) {
    return failure("SPOT_NOT_CONTEMPORANEOUS", {
      spot_distance_seconds: spotDistanceSeconds,
      methodology: HISTORICAL_RECONSTRUCTION_LABELS,
    });
  }

  let liquidity;
  let liquidityBasis;
  if (selected.sameBarLiquidityAllowed) {
    if (!bar || typeof bar !== "object") return failure("OPTION_BAR_MISSING", { methodology: HISTORICAL_RECONSTRUCTION_LABELS });
    liquidity = normalizeLiquidity({
      volume: bar.v ?? bar.volume,
      trade_count: bar.n ?? bar.trade_count,
      high: bar.h ?? bar.high,
      low: bar.l ?? bar.low,
      available_at: selected.availableAt,
    }, selected.availableAt, decisionTime);
    liquidityBasis = "same_completed_bar";
  } else {
    liquidity = normalizeLiquidity(liquidityObservation, selected.availableAt, decisionTime);
    liquidityBasis = "prior_or_contemporaneous_external_observation";
  }
  if (!liquidity.ok) return { ...liquidity, methodology: HISTORICAL_RECONSTRUCTION_LABELS };

  const referencePrice = selected.price;
  if (referencePrice < HISTORICAL_RECONSTRUCTION_METHOD.minimum_reference_price) {
    return failure("OPTION_PRICE_BELOW_RECONSTRUCTION_FLOOR", {
      reference_price: referencePrice,
      methodology: HISTORICAL_RECONSTRUCTION_LABELS,
    });
  }
  const fullSpreadBase = Math.max(
    HISTORICAL_RECONSTRUCTION_METHOD.minimum_full_spread_dollars,
    referencePrice * HISTORICAL_RECONSTRUCTION_METHOD.midpoint_fraction_full_spread,
    liquidity.range * HISTORICAL_RECONSTRUCTION_METHOD.range_fraction_full_spread,
  );
  const liquidityMultiplier = 1 + 1 / Math.sqrt(liquidity.volume) + 1 / Math.sqrt(liquidity.tradeCount);
  const modeledFullSpread = fullSpreadBase * liquidityMultiplier;
  const bid = floorCent(referencePrice - modeledFullSpread / 2);
  const ask = ceilCent(referencePrice + modeledFullSpread / 2);
  const reconstructedMidpoint = (bid + ask) / 2;
  const relativeSpread = (ask - bid) / reconstructedMidpoint;
  if (bid <= 0 || ask <= bid || relativeSpread > HISTORICAL_RECONSTRUCTION_METHOD.maximum_relative_reconstructed_spread) {
    return failure("RECONSTRUCTED_SPREAD_TOO_WIDE", {
      reference_price: referencePrice,
      reconstructed_relative_spread: round(relativeSpread, 6),
      methodology: HISTORICAL_RECONSTRUCTION_LABELS,
    });
  }

  const expiryAt = zonedMarketClose(normalizedContract.contract.expiry);
  const timeMilliseconds = expiryAt.getTime() - selected.availableAt.getTime();
  if (timeMilliseconds <= 0) {
    return failure("OPTION_EXPIRED_AT_PRICE_TIME", { methodology: HISTORICAL_RECONSTRUCTION_LABELS });
  }
  const timeYears = timeMilliseconds / MILLISECONDS_PER_YEAR;
  const iv = solveImpliedVolatility({
    type: normalizedContract.contract.type,
    spot,
    strike: normalizedContract.contract.strike,
    timeYears,
    marketPrice: referencePrice,
    rate,
    dividend,
  });
  if (!iv.ok) {
    return failure("IMPLIED_VOLATILITY_RECONSTRUCTION_FAILED", {
      implied_volatility_failure: iv,
      methodology: HISTORICAL_RECONSTRUCTION_LABELS,
    });
  }

  const availableAt = new Date(Math.max(selected.availableAt.getTime(), spotObservedAt.getTime(), liquidity.availableAt.getTime()));
  return {
    ok: true,
    schema_version: "finly_reconstructed_option_quote.v1",
    quote: {
      underlying: normalizedContract.contract.underlying,
      symbol: normalizedContract.contract.symbol,
      type: normalizedContract.contract.type,
      expiry: normalizedContract.contract.expiry,
      strike: normalizedContract.contract.strike,
      reconstructed_bid: bid,
      reconstructed_ask: ask,
      reconstructed_midpoint: round(reconstructedMidpoint, 4),
      reconstructed_iv: iv.volatility,
      reference_price: referencePrice,
      available_at: availableAt.toISOString(),
    },
    provenance: {
      source: selectedBasis === "explicit_midpoint" ? "explicit_point_in_time_midpoint" : "alpaca_option_ohlcv_bar",
      price_basis: selectedBasis,
      price_source_field: selected.sourceField,
      price_available_at: selected.availableAt.toISOString(),
      bar_start_at: selected.barStart?.toISOString() ?? null,
      bar_end_at: selected.barEnd?.toISOString() ?? null,
      bar_duration_seconds: selected.barStart ? duration : null,
      spot_observed_at: spotObservedAt.toISOString(),
      spot_distance_seconds: round(spotDistanceSeconds, 3),
      liquidity_basis: liquidityBasis,
      liquidity_available_at: liquidity.availableAt.toISOString(),
      contract_metadata_available_at: normalizedContract.availableAt?.toISOString() ?? null,
      decision_as_of: decisionTime.toISOString(),
      information_cutoff_respected: availableAt <= decisionTime,
    },
    spread_model: {
      full_spread_base: round(fullSpreadBase, 6),
      liquidity_multiplier: round(liquidityMultiplier, 6),
      modeled_full_spread_before_tick_rounding: round(modeledFullSpread, 6),
      reconstructed_relative_spread: round(relativeSpread, 6),
      volume: liquidity.volume,
      trade_count: liquidity.tradeCount,
      observed_range: round(liquidity.range, 6),
    },
    implied_volatility_solver: {
      volatility: iv.volatility,
      iterations: iv.iterations,
      repriced: iv.repriced,
      time_years: round(timeYears, 10),
      rate,
      dividend,
    },
    methodology: HISTORICAL_RECONSTRUCTION_METHOD,
  };
}

function quoteOrNull(value) {
  if (value === null || value === undefined) return null;
  if (value.ok === false) return null;
  const quote = value.ok === true && value.quote ? value.quote : value;
  if (!quote || typeof quote !== "object") return null;
  return quote;
}

/**
 * Conservative realized P&L for a debit vertical. The exit credit is the long
 * reconstructed bid less the short reconstructed ask, floored at zero and
 * capped at spread width. If either required exit reconstruction is absent or
 * failed, the entire entry debit is charged as a loss.
 */
export function computeDebitSpreadRealizedExitPnl({
  entryDebit,
  quantity = 1,
  multiplier = 100,
  longExitQuote,
  shortExitQuote,
} = {}) {
  const debit = finiteNumber(entryDebit, "entryDebit", { minimum: Number.EPSILON });
  const contracts = finiteNumber(quantity, "quantity", { minimum: 1, integer: true });
  const contractMultiplier = finiteNumber(multiplier, "multiplier", { minimum: 1, integer: true });
  const longQuote = quoteOrNull(longExitQuote);
  const shortQuote = quoteOrNull(shortExitQuote);
  if (!longQuote || !shortQuote) {
    return {
      schema_version: "finly_historical_spread_pnl.v1",
      status: "FULL_DEBIT_LOSS_FALLBACK",
      reason: "REQUIRED_EXIT_BAR_ABSENT_OR_UNUSABLE",
      entry_debit: debit,
      exit_credit: 0,
      quantity: contracts,
      multiplier: contractMultiplier,
      realized_pnl: money(-debit * contracts * contractMultiplier),
      methodology: HISTORICAL_RECONSTRUCTION_LABELS.missing_exit_policy,
    };
  }
  for (const [label, value] of [["long", longQuote], ["short", shortQuote]]) {
    if (value.underlying !== "SPY" || !new Set(["call", "put"]).has(value.type)
      || typeof value.expiry !== "string" || !Number.isFinite(value.strike)) {
      throw new TypeError(`${label} exit quote has incompatible contract metadata`);
    }
  }
  if (longQuote.underlying !== shortQuote.underlying || longQuote.type !== shortQuote.type
    || longQuote.expiry !== shortQuote.expiry || longQuote.symbol === shortQuote.symbol) {
    throw new TypeError("exit quotes do not describe one vertical spread");
  }
  const longBid = finiteNumber(longQuote.reconstructed_bid ?? longQuote.bid, "long exit bid", { minimum: 0 });
  const shortAsk = finiteNumber(shortQuote.reconstructed_ask ?? shortQuote.ask, "short exit ask", { minimum: 0 });
  const width = Math.abs(longQuote.strike - shortQuote.strike);
  if (!(width > debit)) throw new TypeError("entry debit must be below vertical spread width");
  const rawCredit = Math.max(0, longBid - shortAsk);
  const exitCredit = money(Math.min(width, rawCredit));
  return {
    schema_version: "finly_historical_spread_pnl.v1",
    status: "RECONSTRUCTED_EXIT",
    reason: null,
    entry_debit: debit,
    raw_reconstructed_exit_credit: money(rawCredit),
    exit_credit: exitCredit,
    spread_width: money(width),
    quantity: contracts,
    multiplier: contractMultiplier,
    realized_pnl: money((exitCredit - debit) * contracts * contractMultiplier),
    methodology: "LONG_RECONSTRUCTED_BID_MINUS_SHORT_RECONSTRUCTED_ASK_CAPPED_AT_WIDTH",
  };
}
