import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDebitSpreadRealizedExitPnl,
  HISTORICAL_RECONSTRUCTION_LABELS,
  HISTORICAL_RECONSTRUCTION_METHOD,
  reconstructHistoricalOptionQuote,
  solveImpliedVolatility,
} from "../lib/historical_reconstruction.mjs";
import { blackScholesPrice } from "../lib/quant.mjs";

const AS_OF = "2026-08-28T18:31:00.000Z";
const BAR_START = "2026-08-28T18:30:00.000Z";
const BAR_END = "2026-08-28T18:31:00.000Z";
const EXPIRY = "2026-09-04";

function symbol(type, strike) {
  return `SPY260904${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

function contract(type, strike) {
  return {
    symbol: symbol(type, strike),
    underlying_symbol: "SPY",
    expiration_date: EXPIRY,
    type,
    strike_price: String(strike),
    multiplier: "100",
    available_at: "2026-08-01T12:00:00.000Z",
  };
}

function completedBar(price, overrides = {}) {
  return {
    t: BAR_START,
    o: price * 0.99,
    h: price * 1.03,
    l: price * 0.97,
    c: price,
    vw: price * 1.001,
    v: 200,
    n: 40,
    ...overrides,
  };
}

function reconstruction(type, strike, priceBasis = "close", overrides = {}) {
  const spot = 560;
  const timeYears = (new Date("2026-09-04T20:00:00.000Z") - new Date(BAR_END)) / (365 * 86_400_000);
  const optionPrice = blackScholesPrice({ type, spot, strike, timeYears, volatility: 0.24 });
  return reconstructHistoricalOptionQuote({
    bar: completedBar(optionPrice),
    contract: contract(type, strike),
    underlying: { symbol: "SPY", price: spot, observed_at: BAR_END },
    asOf: AS_OF,
    priceBasis,
    ...overrides,
  });
}

test("bisection recovers call and put volatility and rejects impossible prices explicitly", () => {
  for (const type of ["call", "put"]) {
    const parameters = { type, spot: 100, strike: 102, timeYears: 0.25, volatility: 0.31, rate: 0.04, dividend: 0.012 };
    const marketPrice = blackScholesPrice(parameters);
    const solved = solveImpliedVolatility({ ...parameters, marketPrice });
    assert.equal(solved.ok, true);
    assert.ok(Math.abs(solved.volatility - 0.31) < 0.00001);
    assert.ok(Math.abs(solved.repriced - marketPrice) < 0.00001);
  }

  const impossibleCall = solveImpliedVolatility({
    type: "call",
    spot: 100,
    strike: 90,
    timeYears: 0.5,
    marketPrice: 1,
  });
  assert.equal(impossibleCall.ok, false);
  assert.equal(impossibleCall.reason, "PRICE_OUTSIDE_NO_ARBITRAGE_BOUNDS");

  const impossiblePut = solveImpliedVolatility({
    type: "put",
    spot: 100,
    strike: 100,
    timeYears: 0.5,
    marketPrice: 110,
  });
  assert.equal(impossiblePut.ok, false);
  assert.equal(impossiblePut.reason, "PRICE_OUTSIDE_NO_ARBITRAGE_BOUNDS");
});

test("completed call and put bars reconstruct conservative quotes with disclosed provenance", () => {
  const call = reconstruction("call", 560, "close");
  const put = reconstruction("put", 560, "vwap");
  for (const [result, basis, type] of [[call, "close", "call"], [put, "vwap", "put"]]) {
    assert.equal(result.ok, true);
    assert.equal(result.quote.type, type);
    assert.ok(result.quote.reconstructed_bid < result.quote.reconstructed_midpoint);
    assert.ok(result.quote.reconstructed_ask > result.quote.reconstructed_midpoint);
    assert.ok(result.quote.reconstructed_iv > 0 && result.quote.reconstructed_iv < 5);
    assert.equal(result.provenance.price_basis, basis);
    assert.equal(result.provenance.price_available_at, BAR_END);
    assert.equal(result.provenance.information_cutoff_respected, true);
    assert.equal(result.methodology.labels.quote_source, HISTORICAL_RECONSTRUCTION_LABELS.quote_source);
  }
  assert.match(HISTORICAL_RECONSTRUCTION_METHOD.limitations[0], /do not contain the true contemporaneous bid and ask/);
  assert.match(HISTORICAL_RECONSTRUCTION_METHOD.limitations[1], /do not contain a reported contemporaneous implied volatility/);
});

test("open and explicit-midpoint bases use only separately available liquidity evidence", () => {
  const spot = 560;
  const timeYears = (new Date("2026-09-04T20:00:00.000Z") - new Date(BAR_END)) / (365 * 86_400_000);
  const price = blackScholesPrice({ type: "call", spot, strike: 560, timeYears, volatility: 0.22 });
  const priorLiquidity = {
    volume: 150,
    trade_count: 30,
    range: 0.18,
    available_at: "2026-08-27T20:00:00.000Z",
  };
  const open = reconstructHistoricalOptionQuote({
    bar: {
      t: BAR_START,
      o: price,
      // These completed-bar fields are intentionally unusable. The open path
      // must neither validate nor consume them.
      h: -999,
      l: 999,
      c: 999,
      vw: 999,
      v: 0,
      n: 0,
    },
    contract: contract("call", 560),
    underlying: { symbol: "SPY", price: spot, observed_at: BAR_END },
    asOf: AS_OF,
    priceBasis: "open",
    priceAvailableAt: BAR_END,
    liquidityObservation: priorLiquidity,
  });
  assert.equal(open.ok, true);
  assert.equal(open.provenance.price_basis, "open");
  assert.equal(open.provenance.liquidity_basis, "prior_or_contemporaneous_external_observation");

  const explicit = reconstructHistoricalOptionQuote({
    contract: contract("call", 560),
    underlying: { symbol: "SPY", price: spot, observed_at: BAR_END },
    asOf: AS_OF,
    explicitMidpoint: { price, observed_at: BAR_END },
    liquidityObservation: priorLiquidity,
  });
  assert.equal(explicit.ok, true);
  assert.equal(explicit.provenance.price_basis, "explicit_midpoint");
  assert.equal(explicit.provenance.source, "explicit_point_in_time_midpoint");
});

test("cheap and illiquid option observations fail closed", () => {
  const cheap = reconstructHistoricalOptionQuote({
    bar: completedBar(0.03, { h: 0.04, l: 0.02, vw: 0.03 }),
    contract: contract("call", 600),
    underlying: { symbol: "SPY", price: 560, observed_at: BAR_END },
    asOf: AS_OF,
    priceBasis: "close",
  });
  assert.equal(cheap.ok, false);
  assert.equal(cheap.reason, "OPTION_PRICE_BELOW_RECONSTRUCTION_FLOOR");

  const illiquid = reconstructHistoricalOptionQuote({
    bar: completedBar(4, { v: 2, n: 1 }),
    contract: contract("call", 560),
    underlying: { symbol: "SPY", price: 560, observed_at: BAR_END },
    asOf: AS_OF,
    priceBasis: "close",
  });
  assert.equal(illiquid.ok, false);
  assert.equal(illiquid.reason, "ILLIQUID_OPTION_BAR");
});

test("bar, spot, contract, and liquidity timestamps cannot leak future information", () => {
  const incomplete = reconstruction("call", 560, "close", { asOf: "2026-08-28T18:30:30.000Z" });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.reason, "PRICE_NOT_AVAILABLE_AT_AS_OF");

  const futureSpot = reconstruction("put", 560, "close", {
    underlying: { symbol: "SPY", price: 560, observed_at: "2026-08-28T18:31:01.000Z" },
  });
  assert.equal(futureSpot.ok, false);
  assert.equal(futureSpot.reason, "SPOT_NOT_AVAILABLE_AT_PRICE_TIME");

  const futureContract = reconstruction("call", 560, "close", {
    contract: { ...contract("call", 560), available_at: "2026-08-29T12:00:00.000Z" },
  });
  assert.equal(futureContract.ok, false);
  assert.equal(futureContract.reason, "CONTRACT_METADATA_NOT_AVAILABLE_AT_AS_OF");

  const lateContract = reconstruction("call", 560, "close", {
    asOf: "2026-08-28T18:32:00.000Z",
    contract: { ...contract("call", 560), available_at: "2026-08-28T18:31:30.000Z" },
  });
  assert.equal(lateContract.ok, false);
  assert.equal(lateContract.reason, "CONTRACT_METADATA_NOT_AVAILABLE_AT_PRICE_TIME");

  const futureLiquidity = reconstructHistoricalOptionQuote({
    bar: { t: BAR_START, o: 4 },
    contract: contract("call", 560),
    underlying: { symbol: "SPY", price: 560, observed_at: BAR_END },
    asOf: AS_OF,
    priceBasis: "open",
    priceAvailableAt: BAR_END,
    liquidityObservation: { volume: 100, trade_count: 10, range: 0.1, available_at: "2026-08-28T18:31:01.000Z" },
  });
  assert.equal(futureLiquidity.ok, false);
  assert.equal(futureLiquidity.reason, "LIQUIDITY_EVIDENCE_NOT_AVAILABLE_AT_PRICE_TIME");
});

test("realized exit uses long bid minus short ask and missing bars charge full debit", () => {
  const normal = computeDebitSpreadRealizedExitPnl({
    entryDebit: 3.5,
    quantity: 2,
    longExitQuote: {
      underlying: "SPY",
      symbol: symbol("put", 560),
      type: "put",
      expiry: EXPIRY,
      strike: 560,
      reconstructed_bid: 6.2,
      reconstructed_ask: 6.4,
    },
    shortExitQuote: {
      underlying: "SPY",
      symbol: symbol("put", 550),
      type: "put",
      expiry: EXPIRY,
      strike: 550,
      reconstructed_bid: 1.8,
      reconstructed_ask: 2.0,
    },
  });
  assert.equal(normal.status, "RECONSTRUCTED_EXIT");
  assert.equal(normal.exit_credit, 4.2);
  assert.equal(normal.realized_pnl, 140);

  const missing = computeDebitSpreadRealizedExitPnl({
    entryDebit: 3.5,
    quantity: 2,
    longExitQuote: null,
    shortExitQuote: { ok: false, reason: "OPTION_BAR_MISSING" },
  });
  assert.equal(missing.status, "FULL_DEBIT_LOSS_FALLBACK");
  assert.equal(missing.exit_credit, 0);
  assert.equal(missing.realized_pnl, -700);
  assert.equal(missing.methodology, HISTORICAL_RECONSTRUCTION_LABELS.missing_exit_policy);
});
