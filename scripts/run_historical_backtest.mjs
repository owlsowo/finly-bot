import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { calculateBacktestMetrics } from "../lib/backtest_metrics.mjs";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { LocalLlamaEvidenceExtractor } from "../lib/evidence_extractor.mjs";
import {
  buildHistoricalSignals,
  evaluateHistoricalDecision,
  HISTORICAL_BACKTEST_POLICY,
} from "../lib/historical_backtest.mjs";
import {
  alpacaHistoricalCredentialsFromEnv,
  HistoricalAlpacaClient,
} from "../lib/historical_alpaca.mjs";
import {
  HISTORICAL_RECONSTRUCTION_METHOD,
  reconstructHistoricalOptionQuote,
} from "../lib/historical_reconstruction.mjs";
import {
  HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
  selectAlignedIntradaySpreadBars,
} from "../lib/historical_bar_alignment.mjs";
import { POLICY } from "../lib/policy.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = resolve(projectRoot, "data/private/historical-backtest-cache");
const privateOutput = resolve(projectRoot, "outputs/historical_backtest_full.json");
const publicOutput = resolve(projectRoot, "public/data/historical_backtest.json");
const evidenceOutput = resolve(projectRoot, "evidence/historical_backtest.json");
const siteDataOutput = resolve(projectRoot, "src/data/historical_backtest.json");
const DAY_MS = 86_400_000;
const DEFAULT_STARTING_EQUITY = 100_000;
const STOCK_ADJUSTMENT = "raw";
const CACHE_SCHEMA_VERSION = "finly_historical_cache.v3_counterfactual_clocks_raw";
const DAILY_BAR_SCHEMA_SHIM_QUOTE_AGE_SECONDS = 0;
const INDICATIVE_DAILY_BAR_AVAILABILITY_DELAY_MINUTES = 15;
const WINDOW_DEFINITIONS = Object.freeze([
  { id: "one_week", label: "1 week", marketSessions: 5, sampling: "daily" },
  { id: "one_month", label: "1 month", marketSessions: 21, sampling: "daily" },
  { id: "one_year", label: "1 year", marketSessions: 252, sampling: "weekly" },
]);

export function historicalReplayClocks(holdingHorizonSessions) {
  if (!Number.isInteger(holdingHorizonSessions) || holdingHorizonSessions < 1 || holdingHorizonSessions > 20) {
    throw new TypeError("holding horizon must be an integer from one to twenty sessions");
  }
  return Object.freeze({
    holding_horizon_sessions: holdingHorizonSessions,
    forecast_horizon_sessions: holdingHorizonSessions + 1,
    outcome_session_offset_from_decision: holdingHorizonSessions + 1,
    management_session_count: holdingHorizonSessions + 1,
  });
}

function exactBoolean(value) {
  return value === true || value === "true";
}

function finiteInteger(value, label, { minimum, maximum }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function money(value) {
  return round(value, 2);
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function sleep(milliseconds) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function shiftUtcDate(date, days) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function dateOrdinal(date) {
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
}

function newYorkDate(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function zonedNewYorkInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new TypeError("market calendar date/time is invalid");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desiredAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const byType = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const renderedAsUtc = Date.UTC(byType.year, byType.month - 1, byType.day, byType.hour, byType.minute, byType.second);
    candidate += desiredAsUtc - renderedAsUtc;
  }
  return new Date(candidate).toISOString();
}

function cacheDigest(key) {
  return createHash("sha256").update(stableStringify({ cache_schema_version: CACHE_SCHEMA_VERSION, ...key })).digest("hex");
}

async function readOrFetch(key, fetcher) {
  const path = resolve(cacheRoot, `${cacheDigest(key)}.json`);
  try {
    return { value: JSON.parse(await readFile(path, "utf8")), cache_hit: true };
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  const value = await fetcher();
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  return { value, cache_hit: false };
}

class CachedEvidenceExtractor {
  constructor(inner) {
    this.inner = inner;
    this.model = inner.model;
  }

  async assessDocuments(documents, options) {
    const key = {
      kind: "llama_evidence_assessment_v1",
      model: this.model,
      options,
      documents: documents.map(({ record, text }) => ({
        evidence_id: record.evidence_id,
        published_at: record.published_at,
        content_sha256: sha256(text),
      })),
    };
    return (await readOrFetch(key, () => this.inner.assessDocuments(documents, options))).value;
  }
}

function barMap(bars) {
  return new Map(bars.map((bar) => [newYorkDate(bar.t), bar]));
}

function optionCompilerQuote(reconstruction, contract, decisionDate) {
  if (!reconstruction?.ok) return null;
  const quote = reconstruction.quote;
  const dte = dateOrdinal(quote.expiry) - dateOrdinal(decisionDate);
  const observedVolume = reconstruction.spread_model.volume;
  return {
    underlying: "SPY",
    symbol: quote.symbol,
    type: quote.type,
    expiry: quote.expiry,
    strike: quote.strike,
    bid: quote.reconstructed_bid,
    ask: quote.reconstructed_ask,
    iv: quote.reconstructed_iv,
    dte,
    feed: "indicative",
    quote_age_seconds: DAILY_BAR_SCHEMA_SHIM_QUOTE_AGE_SECONDS,
    open_interest: observedVolume,
    tradable: contract.status === "active" || contract.status === "inactive",
  };
}

function compactDecision(record, context) {
  return {
    date: context.date,
    decision_time: record.created_at,
    session_index: context.sessionIndex,
    window_ids: context.windowIds,
    status: record.status,
    eligibility_scope: "COUNTERFACTUAL_RESEARCH_ONLY_NOT_BROKER_AUTHORIZATION",
    reasons: record.reasons,
    direction: record.intent?.direction ?? null,
    direction_score: record.intent?.direction_score ?? null,
    coverage: record.intent?.coverage ?? null,
    agreement: record.intent?.agreement ?? null,
    source_families: record.source_families,
    option_count: record.option_count,
    candidate: record.candidate,
    quantity: record.quantity,
    sizing_reference_equity: record.sizing_reference_equity,
    sizing_risk_fraction: record.sizing_risk_fraction,
    shadow_candidate: record.shadow_candidate,
    shadow_waived_gates: record.shadow_waived_gates,
    stability: record.stability,
    compiler_diagnostics: record.compiler_diagnostics,
    omissions: record.omissions,
    reconstruction: context.reconstruction,
    policy_counterfactual_outcome: context.policyCounterfactualOutcome ?? null,
    shadow_outcome: context.shadowOutcome ?? null,
  };
}

function reconstructionFailureCounts(results) {
  const counts = {};
  for (const result of results) {
    if (!result.ok) counts[result.reason] = (counts[result.reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => left[0].localeCompare(right[0])));
}

function selectArticles(news, decisionTime, maximumArticles) {
  const decision = Date.parse(decisionTime);
  const earliest = decision - 72 * 3_600_000;
  return news.filter((article) => {
    const created = Date.parse(article.created_at);
    const updated = Date.parse(article.updated_at);
    return created >= earliest && created <= decision && updated <= decision;
  }).sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)).slice(0, maximumArticles);
}

export function buildDecisionPlan(lastDecisionIndex, requestedMarketSessions) {
  const eligibleWindows = WINDOW_DEFINITIONS.filter((window) => window.marketSessions <= requestedMarketSessions);
  const byIndex = new Map();
  for (const window of eligibleWindows) {
    const startIndex = lastDecisionIndex - window.marketSessions + 1;
    const indexes = [];
    if (window.sampling === "daily") {
      for (let index = startIndex; index <= lastDecisionIndex; index += 1) indexes.push(index);
    } else {
      for (let index = lastDecisionIndex; index >= startIndex; index -= 5) indexes.push(index);
      indexes.sort((left, right) => left - right);
    }
    for (const index of indexes) {
      const memberships = byIndex.get(index) ?? new Set();
      memberships.add(window.id);
      byIndex.set(index, memberships);
    }
  }
  return [...byIndex.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, memberships]) => ({ index, window_ids: [...memberships].sort() }));
}

async function fetchOptionBarsComplete(client, symbols, options, requestDelayMs) {
  const merged = Object.fromEntries(symbols.map((symbol) => [symbol, []]));
  for (const group of chunk(symbols, 100)) {
    const key = { kind: "option_bars", symbols: group, ...options };
    const result = await readOrFetch(key, () => client.getHistoricalOptionBars(group, options));
    for (const symbol of group) merged[symbol].push(...(result.value.bars[symbol] ?? []));
    if (!result.cache_hit) await sleep(requestDelayMs);
  }
  return merged;
}

function reconstructedQuote({ bar, contract, stockPrice, observedAt, priceBasis, liquidityObservation }) {
  if (!bar) return { ok: false, reason: "OPTION_BAR_MISSING" };
  const barStart = Date.parse(bar.t);
  const availableAt = Date.parse(observedAt);
  const duration = Math.max(1, Math.round((availableAt - barStart) / 1000));
  return reconstructHistoricalOptionQuote({
    bar,
    contract,
    underlying: { symbol: "SPY", price: stockPrice, observed_at: observedAt },
    asOf: observedAt,
    priceBasis,
    ...(priceBasis === "open" ? { priceAvailableAt: observedAt, liquidityObservation } : {}),
    barDurationSeconds: Math.min(86_400, duration),
  });
}

export function failClosedManagementOutcome({
  status,
  failureReason,
  entrySession,
  finalSession,
  alignedEntry,
  declaredFinalExitAt,
  entryDebit,
  naturalEntryDebit,
  managementChecks,
}) {
  if (!(entryDebit > 0) || !entrySession || !finalSession || !alignedEntry?.available_at) {
    throw new TypeError("fail-closed management outcome requires a valid reconstructed entry and final boundary");
  }
  return {
    status,
    fillable: true,
    entry_date: entrySession.date,
    entry_at: alignedEntry.available_at,
    exit_date: finalSession.date,
    exit_at: declaredFinalExitAt,
    entry_session_index: entrySession.index,
    exit_session_index: finalSession.index,
    entry_debit: entryDebit,
    reconstructed_natural_entry_debit: naturalEntryDebit,
    exit_credit: 0,
    pnl_per_contract: money(-entryDebit * 100),
    max_capital_at_risk_per_contract: money(entryDebit * 100),
    entry_spy_price: alignedEntry.spy_bar?.c ?? null,
    exit_spy_price: null,
    exit_trigger: "required_management_proxy_missing_full_debit_loss",
    management_path_complete: false,
    management_failure_reason: failureReason,
    management_checks: managementChecks,
    strategy_invalidation_replayed: false,
    price_equivalence_claimed: false,
    fill_equivalence_claimed: false,
    methodology: {
      alignment: HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
      reconstruction: HISTORICAL_RECONSTRUCTION_METHOD,
    },
  };
}

async function buildOutcome({
  client,
  candidate,
  contractsBySymbol,
  decisionSpot,
  entrySession,
  managementSessions,
  holdingHorizonSessions,
  requestDelayMs,
}) {
  if (!candidate) return null;
  const symbols = [candidate.long_symbol, candidate.short_symbol];
  const contracts = symbols.map((symbol) => contractsBySymbol.get(symbol));
  if (contracts.some((contract) => !contract)) return { status: "CONTRACT_METADATA_MISSING", fillable: false };
  if (!Array.isArray(managementSessions) || managementSessions.length !== holdingHorizonSessions + 1) {
    throw new TypeError("management sessions must include entry day through the fill-anchored horizon");
  }
  const declaredEntryAt = zonedNewYorkInstant(entrySession.date, entrySession.open);
  const finalSession = managementSessions.at(-1);
  const declaredFinalExitAt = zonedNewYorkInstant(finalSession.date, finalSession.close);
  const optionBars = await fetchOptionBarsComplete(client, symbols, {
    start: declaredEntryAt,
    end: declaredFinalExitAt,
    timeframe: "1Min",
  }, requestDelayMs);
  const stockKey = {
    kind: "stock_bars",
    symbol: "SPY",
    start: declaredEntryAt,
    end: declaredFinalExitAt,
    timeframe: "1Min",
    feed: "iex",
    adjustment: STOCK_ADJUSTMENT,
  };
  const stockResult = await readOrFetch(stockKey, () => client.getStockBars("SPY", {
    start: declaredEntryAt,
    end: declaredFinalExitAt,
    timeframe: "1Min",
    feed: "iex",
    adjustment: STOCK_ADJUSTMENT,
  }));
  if (!stockResult.cache_hit) await sleep(requestDelayMs);
  const alignments = managementSessions.map((session) => selectAlignedIntradaySpreadBars({
    legSymbols: symbols,
    optionBarsBySymbol: optionBars,
    spyBars: stockResult.value.bars,
    declaredEntryAt,
    declaredExitAt: zonedNewYorkInstant(session.date, session.close),
    timeframe: "1Min",
  }));
  const alignedEntry = alignments[0]?.entry;
  if (!alignedEntry) {
    return {
      status: "NO_ALIGNED_INTRADAY_ENTRY_PROXY",
      fillable: false,
      alignment_failure: alignments[0]?.reason ?? "NO_ALIGNMENT_RESULT",
      methodology: HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
    };
  }
  const reconstructedEntries = symbols.map((symbol, index) => reconstructedQuote({
      bar: alignedEntry.option_bars[symbol],
      contract: contracts[index],
      stockPrice: alignedEntry.spy_bar.c,
      observedAt: alignedEntry.available_at,
      priceBasis: "close",
    }));
  if (reconstructedEntries.some((entry) => !entry.ok)) {
    return {
      status: "ENTRY_RECONSTRUCTION_FAILED",
      fillable: false,
      entry_failures: reconstructedEntries.filter((entry) => !entry.ok).map((entry) => entry.reason),
      methodology: HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
    };
  }
  const longEntry = reconstructedEntries[0].quote;
  const shortEntry = reconstructedEntries[1].quote;
  const naturalEntryDebit = money(longEntry.reconstructed_ask - shortEntry.reconstructed_bid + POLICY.slippagePerLegDollars * 2);
  const width = Math.abs(candidate.long_strike - candidate.short_strike);
  if (!(naturalEntryDebit > 0 && naturalEntryDebit < width)) {
    return { status: "INVALID_RECONSTRUCTED_ENTRY_DEBIT", fillable: false, reconstructed_natural_debit: naturalEntryDebit };
  }
  const entrySpotDrift = Math.abs(alignedEntry.spy_bar.c / decisionSpot - 1);
  if (entrySpotDrift > POLICY.maxUnderlyingDriftFraction) {
    return {
      status: "UNDERLYING_PREFLIGHT_DRIFT_REJECTED",
      fillable: false,
      reconstructed_entry_spot: alignedEntry.spy_bar.c,
      decision_spot: decisionSpot,
      drift_fraction: round(entrySpotDrift, 8),
      maximum_permitted_drift_fraction: POLICY.maxUnderlyingDriftFraction,
    };
  }
  if (naturalEntryDebit > candidate.entry_debit) {
    return {
      status: "ENTRY_LIMIT_NOT_REACHED_BY_PROXY",
      fillable: false,
      reconstructed_natural_debit: naturalEntryDebit,
      submitted_limit_debit: candidate.entry_debit,
      methodology: HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
    };
  }
  const entryDebit = candidate.entry_debit;
  const profitTarget = money(entryDebit + POLICY.profitTargetMaxGainFraction * (width - entryDebit));
  const stopThreshold = money(entryDebit * POLICY.stopLossRemainingDebitFraction);
  const managementChecks = [];
  for (let index = 0; index < managementSessions.length; index += 1) {
    const session = managementSessions[index];
    const alignment = alignments[index];
    if (!alignment.ok) {
      managementChecks.push({ date: session.date, status: "ALIGNMENT_UNAVAILABLE", reason: alignment.reason });
      return failClosedManagementOutcome({
        status: "INCOMPLETE_REQUIRED_MANAGEMENT_PROXY_FULL_DEBIT_LOSS",
        failureReason: alignment.reason,
        entrySession,
        finalSession,
        alignedEntry,
        declaredFinalExitAt,
        entryDebit,
        naturalEntryDebit,
        managementChecks,
      });
    }
    const reconstructedExits = symbols.map((symbol, legIndex) => reconstructedQuote({
      bar: alignment.exit.option_bars[symbol],
      contract: contracts[legIndex],
      stockPrice: alignment.exit.spy_bar.c,
      observedAt: alignment.exit.available_at,
      priceBasis: "close",
    }));
    if (reconstructedExits.some((entry) => !entry.ok)) {
      managementChecks.push({
        date: session.date,
        status: "RECONSTRUCTION_UNAVAILABLE",
        reasons: reconstructedExits.filter((entry) => !entry.ok).map((entry) => entry.reason),
      });
      return failClosedManagementOutcome({
        status: "INCOMPLETE_REQUIRED_MANAGEMENT_RECONSTRUCTION_FULL_DEBIT_LOSS",
        failureReason: reconstructedExits.filter((entry) => !entry.ok).map((entry) => entry.reason).join(","),
        entrySession,
        finalSession,
        alignedEntry,
        declaredFinalExitAt,
        entryDebit,
        naturalEntryDebit,
        managementChecks,
      });
    }
    const rawExitCredit = reconstructedExits[0].quote.reconstructed_bid - reconstructedExits[1].quote.reconstructed_ask;
    const exitCredit = money(Math.min(width, Math.max(0, rawExitCredit - POLICY.exitSlippagePerLegDollars * 2)));
    const dte = dateOrdinal(candidate.expiry) - dateOrdinal(session.date);
    const sessionsElapsed = session.index - entrySession.index;
    let trigger = null;
    if (dte <= POLICY.expiryGuardDte) trigger = "expiry_guard";
    else if (exitCredit <= stopThreshold) trigger = "risk_limit";
    else if (exitCredit >= profitTarget) trigger = "profit_target";
    else if (sessionsElapsed >= holdingHorizonSessions) trigger = "time_stop";
    managementChecks.push({ date: session.date, status: trigger ? "EXIT" : "HOLD", trigger, exit_credit: exitCredit, dte, sessions_elapsed: sessionsElapsed });
    if (!trigger) continue;
    return {
      status: `RECONSTRUCTED_${trigger.toUpperCase()}_EXIT`,
      fillable: true,
      entry_date: entrySession.date,
      entry_at: alignedEntry.available_at,
      exit_date: session.date,
      exit_at: alignment.exit.available_at,
      entry_session_index: entrySession.index,
      exit_session_index: session.index,
      entry_debit: entryDebit,
      reconstructed_natural_entry_debit: naturalEntryDebit,
      exit_credit: exitCredit,
      pnl_per_contract: money((exitCredit - entryDebit) * 100),
      max_capital_at_risk_per_contract: money(entryDebit * 100),
      entry_spy_price: alignedEntry.spy_bar.c,
      exit_spy_price: alignment.exit.spy_bar.c,
      exit_trigger: trigger,
      management_path_complete: true,
      management_checks: managementChecks,
      strategy_invalidation_replayed: false,
      price_equivalence_claimed: false,
      fill_equivalence_claimed: false,
      methodology: {
        alignment: HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
        reconstruction: HISTORICAL_RECONSTRUCTION_METHOD,
      },
    };
  }
  return failClosedManagementOutcome({
    status: "MANAGEMENT_TIME_STOP_NOT_REACHED_FULL_DEBIT_LOSS",
    failureReason: "REQUIRED_TIME_STOP_WAS_NOT_RECONSTRUCTED",
    entrySession,
    finalSession,
    alignedEntry,
    declaredFinalExitAt,
    entryDebit,
    naturalEntryDebit,
    managementChecks,
  });
}

export function fixedPerformanceBoundary({
  sessions,
  decisionStartIndex,
  decisionEndIndex,
  horizonSessions,
}) {
  if (!Array.isArray(sessions)) throw new TypeError("sessions must be an array");
  for (const [label, value] of Object.entries({ decisionStartIndex, decisionEndIndex, horizonSessions })) {
    if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  }
  if (horizonSessions < 1 || decisionStartIndex < 0 || decisionEndIndex < decisionStartIndex) {
    throw new RangeError("historical performance boundary is invalid");
  }
  const performanceEndIndex = decisionEndIndex + horizonSessions;
  const decisionStart = sessions[decisionStartIndex];
  const decisionEnd = sessions[decisionEndIndex];
  const performanceEnd = sessions[performanceEndIndex];
  if (!decisionStart || !decisionEnd || !performanceEnd) {
    throw new RangeError("market calendar does not cover the fixed performance boundary");
  }
  return Object.freeze({
    decision_start_index: decisionStartIndex,
    decision_end_index: decisionEndIndex,
    performance_start_index: decisionStartIndex,
    performance_end_index: performanceEndIndex,
    decision_start_session: decisionStart.date,
    decision_end_session: decisionEnd.date,
    performance_start_at: zonedNewYorkInstant(decisionStart.date, decisionStart.close),
    performance_end_at: zonedNewYorkInstant(performanceEnd.date, performanceEnd.close),
  });
}

function riskMatchedSpyContext({ trades, stockBarsByDate, startingEquity }) {
  const observations = [];
  for (const trade of trades) {
    const entryDate = newYorkDate(trade.entry_at);
    const exitDate = newYorkDate(trade.exit_at);
    const entrySpot = Number(trade.entry_spy_price ?? stockBarsByDate.get(entryDate)?.o);
    const exitSpot = Number(trade.exit_spy_price ?? stockBarsByDate.get(exitDate)?.c);
    if (!(entrySpot > 0) || !(exitSpot > 0)) {
      return {
        status: "UNAVAILABLE_MISSING_MATCHED_SPY_BAR",
        total_return: null,
        pnl: null,
        matched_trade_count: observations.length,
        reason: `raw SPY entry/exit price is unavailable for ${entryDate} through ${exitDate}`,
      };
    }
    const capital = trade.maxCapitalAtRisk;
    observations.push({
      capital,
      pnl: capital * (exitSpot / entrySpot - 1),
    });
  }
  const pnl = observations.reduce((sum, observation) => sum + observation.pnl, 0);
  const matchedCapital = observations.reduce((sum, observation) => sum + observation.capital, 0);
  return {
    status: observations.length === 0 ? "NO_CAPITAL_DEPLOYED" : "AVAILABLE",
    total_return: round(pnl / startingEquity, 10),
    pnl: money(pnl),
    matched_trade_count: observations.length,
    cumulative_matched_capital: money(matchedCapital),
    reason: observations.length === 0
      ? "No trade was executed, so the risk-matched SPY context is the same zero-return cash baseline."
      : null,
  };
}

function comparisonContext({ metrics, trades, stockBarsByDate, startingEquity }) {
  return {
    schema_version: "finly_backtest_comparison_context.v1",
    cash: {
      total_return: 0,
      assumption: "Uninvested cash earns zero interest in this descriptive replay.",
    },
    full_notional_spy: {
      total_return: metrics.benchmark_return,
      basis: "Raw/unadjusted IEX SPY close-to-close price return over the fixed performance boundary; dividends are not reinvested.",
      interpretation: "Context only: this deploys the full starting account and is not risk matched to Finly's bounded option exposure.",
    },
    risk_matched_spy: {
      ...riskMatchedSpyContext({ trades, stockBarsByDate, startingEquity }),
      basis: "For each executed Finly trade, the same dollars as that trade's maximum capital at risk are hypothetically allocated to SPY from the matched next-session open through matched exit close; remaining capital stays in zero-interest cash.",
      price_basis: "Raw/unadjusted IEX SPY price return; dividends and transaction costs are excluded.",
    },
  };
}

export function simulatePortfolio({ decisions, sessions, stockBarsByDate, startingEquity, mode, boundary }) {
  if (!Array.isArray(decisions)) throw new TypeError("decisions must be an array");
  if (!(stockBarsByDate instanceof Map)) throw new TypeError("stockBarsByDate must be a Map");
  if (!boundary || !Number.isInteger(boundary.performance_start_index)
    || !Number.isInteger(boundary.performance_end_index)) {
    throw new TypeError("a fixed performance boundary is required");
  }
  if (!new Set(["policy_counterfactual", "shadow"]).has(mode)) throw new TypeError("portfolio mode is invalid");
  const include = mode === "policy_counterfactual"
    ? (decision) => decision.status === "ELIGIBLE"
    : (decision) => decision.shadow_candidate !== null;
  let sizingEquity = startingEquity;
  let settledThrough = boundary.performance_start_index - 1;
  let occupiedThrough = boundary.performance_start_index - 1;
  const trades = [];
  const realizedByIndex = new Map();
  for (const decision of decisions) {
    for (let index = settledThrough + 1; index <= decision.session_index; index += 1) {
      sizingEquity += realizedByIndex.get(index) ?? 0;
    }
    settledThrough = Math.max(settledThrough, decision.session_index);
    const outcome = mode === "policy_counterfactual" ? decision.policy_counterfactual_outcome : decision.shadow_outcome;
    if (!include(decision) || !outcome?.fillable || outcome.entry_session_index <= occupiedThrough) continue;
    if (outcome.entry_session_index <= boundary.decision_start_index
      || outcome.exit_session_index > boundary.performance_end_index) {
      throw new RangeError("trade outcome escapes the fixed performance boundary");
    }
    const tradeCandidate = mode === "policy_counterfactual" ? decision.candidate : decision.shadow_candidate;
    const riskFraction = mode === "policy_counterfactual"
      ? (decision.sizing_risk_fraction ?? POLICY.riskPerTradeFraction)
      : POLICY.riskPerTradeFraction;
    const riskBudget = Math.max(0, Math.min(sizingEquity * riskFraction, POLICY.riskPerTradeDollarCap));
    const quantity = Math.min(POLICY.maxContracts, Math.floor(riskBudget / outcome.max_capital_at_risk_per_contract));
    if (quantity < 1) continue;
    const pnl = money(outcome.pnl_per_contract * quantity);
    const trade = {
      mode: mode === "policy_counterfactual" ? "counterfactual_policy" : "development_shadow",
      decision_date: decision.date,
      direction: decision.direction,
      candidate_id: tradeCandidate.candidate_id,
      action: tradeCandidate.action,
      entry_at: outcome.entry_at,
      exit_at: outcome.exit_at,
      quantity,
      sizing_equity_at_decision: money(sizingEquity),
      risk_fraction_applied: riskFraction,
      risk_budget_at_decision: money(riskBudget),
      entry_debit: outcome.entry_debit,
      exit_credit: outcome.exit_credit,
      pnl,
      maxCapitalAtRisk: money(outcome.max_capital_at_risk_per_contract * quantity),
      entry_spy_price: outcome.entry_spy_price ?? null,
      exit_spy_price: outcome.exit_spy_price ?? null,
      outcome_status: outcome.status,
    };
    trades.push(trade);
    occupiedThrough = outcome.exit_session_index;
    realizedByIndex.set(outcome.exit_session_index, (realizedByIndex.get(outcome.exit_session_index) ?? 0) + pnl);
  }
  const startIndex = boundary.performance_start_index;
  const endIndex = boundary.performance_end_index;
  const equityCurve = [];
  const benchmarkCurve = [];
  let realizedEquity = startingEquity;
  const startingSpot = stockBarsByDate.get(sessions[startIndex].date)?.c;
  for (let index = startIndex; index <= endIndex; index += 1) {
    realizedEquity += realizedByIndex.get(index) ?? 0;
    const session = sessions[index];
    const timestamp = zonedNewYorkInstant(session.date, session.close);
    equityCurve.push({ timestamp, equity: money(realizedEquity) });
    const spot = stockBarsByDate.get(session.date)?.c;
    if (Number.isFinite(startingSpot) && Number.isFinite(spot)) {
      benchmarkCurve.push({ timestamp, value: startingEquity * spot / startingSpot });
    }
  }
  const metrics = calculateBacktestMetrics({
    equityCurve,
    benchmarkCurve,
    trades,
    decisions: { total: decisions.length, traded: trades.length, abstained: decisions.length - trades.length },
    equityCurveBasis: "realized_exit_only",
    annualization: { periodsPerYear: 252, riskFreeRateAnnual: POLICY.interestRate },
  });
  return {
    boundary,
    metrics,
    trades,
    comparison_context: comparisonContext({ metrics, trades, stockBarsByDate, startingEquity }),
    equity_curve: equityCurve,
    benchmark_curve: benchmarkCurve,
  };
}

function evidenceGrade(metrics) {
  if (metrics.trade_count < 5) return "INSUFFICIENT_COMPLETED_TRADES";
  if (metrics.trade_count < 30) return "EXPLORATORY_SMALL_SAMPLE";
  return "DESCRIPTIVE_BACKTEST_NOT_PROOF_OF_ALPHA";
}

function publicWindow(window, boundary, decisions, policyCounterfactual, shadow) {
  return {
    id: window.id,
    label: window.label,
    requested_market_sessions: window.marketSessions,
    decision_sampling: window.sampling,
    decision_observations: decisions.length,
    start_date: boundary.decision_start_session,
    end_date: boundary.decision_end_session,
    performance_boundary: boundary,
    evidence_grade: evidenceGrade(policyCounterfactual.metrics),
    performance_claim_status: policyCounterfactual.metrics.trade_count === 0
      ? "COUNTERFACTUAL_POLICY_ABSTENTION_NO_PROFITABILITY_CLAIM"
      : "COUNTERFACTUAL_ACCOUNTING_ONLY_NO_PROFITABILITY_OR_BROKER_POLICY_EQUIVALENCE_CLAIM",
    policy_counterfactual: {
      semantics: "Counterfactual deterministic research-policy path; not broker authorization, execution replication, or evidence of future profitability.",
      metrics: policyCounterfactual.metrics,
      trades: policyCounterfactual.trades,
      comparison_context: policyCounterfactual.comparison_context,
    },
    signal_shadow: {
      semantics: "Development-stage ablation reported separately from the counterfactual policy path; not a holdout result.",
      metrics: shadow.metrics,
      trades: shadow.trades,
      comparison_context: shadow.comparison_context,
    },
    decision_status_counts: Object.fromEntries([...new Set(decisions.map((decision) => decision.status))]
      .sort().map((status) => [status, decisions.filter((decision) => decision.status === status).length])),
  };
}

export function validatePublishedHistoricalArtifact(artifact, { requestedSessions } = {}) {
  if (!artifact || artifact.schema_version !== "finly_historical_backtest_report.v3") {
    throw new TypeError("published historical artifact must use the v3 counterfactual-research schema");
  }
  if (artifact.report_scope !== "COUNTERFACTUAL_POLICY_RESEARCH_ONLY"
    || artifact.broker_policy_equivalence_claimed !== false
    || artifact.profitability_claimed !== false) {
    throw new TypeError("published historical artifact is missing counterfactual-research claim boundaries");
  }
  if (!Array.isArray(artifact.windows) || artifact.windows.length === 0) {
    throw new TypeError("published historical artifact must contain at least one completed window");
  }
  for (const window of artifact.windows) {
    if (!window.policy_counterfactual || window.authorized !== undefined) {
      throw new TypeError("published windows must use policy_counterfactual and must not expose an authorized result arm");
    }
  }
  if (requestedSessions === 252) {
    const oneYear = artifact.windows.find((window) => window.id === "one_year");
    if (!oneYear || oneYear.requested_market_sessions !== 252 || oneYear.decision_sampling !== "weekly") {
      throw new TypeError("a final 252-session artifact must contain the completed one_year window");
    }
  }
  if (typeof artifact.artifact_sha256 !== "string") {
    throw new TypeError("published historical artifact must contain its artifact hash");
  }
  const { artifact_sha256: artifactSha256, ...unsigned } = artifact;
  if (artifactSha256 !== sha256(unsigned)) throw new TypeError("published historical artifact hash is invalid");
  return artifact;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function verifyIdenticalPublishedArtifacts(paths, expected) {
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
  for (const path of paths) {
    if (await readFile(path, "utf8") !== expectedText) {
      throw new Error(`published historical artifact differs from the validated payload: ${path}`);
    }
  }
}

async function main() {
  const requestedSessions = finiteInteger(process.env.FINLY_BACKTEST_SESSION_COUNT ?? 252, "FINLY_BACKTEST_SESSION_COUNT", { minimum: 5, maximum: 252 });
  const requestDelayMs = finiteInteger(process.env.FINLY_BACKTEST_REQUEST_DELAY_MS ?? 550, "FINLY_BACKTEST_REQUEST_DELAY_MS", { minimum: 0, maximum: 10_000 });
  const holdingHorizonSessions = finiteInteger(process.env.FINLY_HORIZON_SESSIONS ?? 3, "FINLY_HORIZON_SESSIONS", { minimum: 1, maximum: 5 });
  const clocks = historicalReplayClocks(holdingHorizonSessions);
  const outcomeSessionOffset = clocks.outcome_session_offset_from_decision;
  const maximumNewsArticles = finiteInteger(process.env.FINLY_BACKTEST_MAX_NEWS ?? 6, "FINLY_BACKTEST_MAX_NEWS", { minimum: 1, maximum: 12 });
  const useLlama = exactBoolean(process.env.FINLY_BACKTEST_USE_LOCAL_LLAMA ?? "true");
  const now = new Date();
  const today = newYorkDate(now);
  const calendarStart = shiftUtcDate(today, -650);
  const calendarEnd = shiftUtcDate(today, 35);
  const credentials = alpacaHistoricalCredentialsFromEnv(process.env);
  const client = new HistoricalAlpacaClient(credentials);
  const extractor = useLlama ? new CachedEvidenceExtractor(new LocalLlamaEvidenceExtractor({ timeoutMs: 60_000 })) : undefined;

  const calendarResult = await readOrFetch(
    { kind: "calendar", start: calendarStart, end: calendarEnd },
    () => client.getMarketCalendar({ start: calendarStart, end: calendarEnd }),
  );
  const sessions = calendarResult.value.calendar.map((session, index) => ({ ...session, index }));
  const completedSessionIndexes = sessions
    .filter((session) => zonedNewYorkInstant(session.date, session.close) <= now.toISOString())
    .map((session) => session.index);
  const latestCompletedIndex = completedSessionIndexes.at(-1);
  const lastDecisionIndex = latestCompletedIndex - outcomeSessionOffset;
  const firstDecisionIndex = lastDecisionIndex - requestedSessions + 1;
  if (firstDecisionIndex < 100 || lastDecisionIndex + outcomeSessionOffset >= sessions.length) throw new Error("market calendar does not cover the required lookback/forward range");
  const decisionPlan = buildDecisionPlan(lastDecisionIndex, requestedSessions);
  const decisionSessions = decisionPlan.map((item) => ({ ...sessions[item.index], window_ids: item.window_ids }));
  const stockStart = sessions[firstDecisionIndex - 100].date;
  const stockEnd = sessions[Math.min(sessions.length - 1, lastDecisionIndex + outcomeSessionOffset)].date;
  const stockResult = await readOrFetch(
    { kind: "stock_bars", start: stockStart, end: stockEnd, timeframe: "1Day", feed: "iex", adjustment: STOCK_ADJUSTMENT },
    () => client.getStockBars("SPY", {
      start: stockStart,
      end: stockEnd,
      timeframe: "1Day",
      feed: "iex",
      adjustment: STOCK_ADJUSTMENT,
    }),
  );
  const stockBarsByDate = barMap(stockResult.value.bars);
  const newsStart = shiftUtcDate(decisionSessions[0].date, -4);
  const newsEnd = decisionSessions.at(-1).date;
  const newsResult = await readOrFetch(
    { kind: "news", start: newsStart, end: newsEnd, includeContent: false },
    () => client.getHistoricalNews("SPY", { start: newsStart, end: newsEnd, includeContent: false }),
  );

  const decisions = [];
  for (let offset = 0; offset < decisionSessions.length; offset += 1) {
    const session = decisionSessions[offset];
    const sessionIndex = session.index;
    const sessionClose = zonedNewYorkInstant(session.date, session.close);
    const decisionTime = new Date(Date.parse(sessionClose)
      + INDICATIVE_DAILY_BAR_AVAILABILITY_DELAY_MINUTES * 60_000).toISOString();
    const stockBar = stockBarsByDate.get(session.date);
    if (!stockBar) {
      decisions.push({
        date: session.date,
        decision_time: decisionTime,
        session_index: sessionIndex,
        window_ids: session.window_ids,
        status: "INPUT_REJECTED",
        eligibility_scope: "COUNTERFACTUAL_RESEARCH_ONLY_NOT_BROKER_AUTHORIZATION",
        reasons: ["MISSING_RAW_SPY_BAR"],
        direction: null,
        direction_score: null,
        coverage: null,
        agreement: null,
        source_families: [],
        option_count: 0,
        candidate: null,
        quantity: 0,
        sizing_reference_equity: null,
        sizing_risk_fraction: null,
        shadow_candidate: null,
        shadow_waived_gates: [],
        stability: null,
        compiler_diagnostics: null,
        omissions: [{ family: "market", reason: "MISSING_RAW_SPY_BAR" }],
        reconstruction: null,
        policy_counterfactual_outcome: null,
        shadow_outcome: null,
      });
      process.stdout.write(`${JSON.stringify({ progress: offset + 1, total: decisionSessions.length, date: session.date, status: "MISSING_STOCK_BAR" })}\n`);
      continue;
    }
    const priorCloses = sessions.slice(sessionIndex - 96, sessionIndex + 1)
      .map((item) => stockBarsByDate.get(item.date)?.c)
      .filter(Number.isFinite);
    if (priorCloses.length < 97) throw new Error(`insufficient completed SPY history for ${session.date}`);
    const returns = priorCloses.slice(1).map((close, index) => round(Math.log(close / priorCloses[index]), 8));
    const targetExpiry = sessions[sessionIndex + outcomeSessionOffset + 1].date;
    const strikeFloor = Math.floor(stockBar.c * 0.98);
    const strikeCeiling = Math.ceil(stockBar.c * 1.02);
    const contractKey = {
      kind: "option_contracts",
      date: session.date,
      expirationDateGte: targetExpiry,
      expirationDateLte: targetExpiry,
      strikeFloor,
      strikeCeiling,
    };
    const contractResult = await readOrFetch(contractKey, () => client.getOptionContracts("SPY", {
      status: "all",
      expirationDateGte: targetExpiry,
      expirationDateLte: targetExpiry,
      strikePriceGte: strikeFloor,
      strikePriceLte: strikeCeiling,
    }));
    if (!contractResult.cache_hit) await sleep(requestDelayMs);
    const contracts = contractResult.value.option_contracts;
    const symbols = contracts.map((contract) => contract.symbol);
    const optionBars = symbols.length === 0 ? {} : await fetchOptionBarsComplete(client, symbols, {
      start: session.date,
      end: session.date,
      timeframe: "1Day",
    }, requestDelayMs);
    const reconstructionResults = contracts.map((contract) => reconstructedQuote({
      bar: barMap(optionBars[contract.symbol] ?? []).get(session.date),
      contract,
      stockPrice: stockBar.c,
      observedAt: decisionTime,
      priceBasis: "close",
    }));
    const optionChain = reconstructionResults.map((result, index) => optionCompilerQuote(result, contracts[index], session.date)).filter(Boolean);
    const market = {
      underlying: "SPY",
      spot: stockBar.c,
      observed_at: decisionTime,
      quote_age_seconds: DAILY_BAR_SCHEMA_SHIM_QUOTE_AGE_SECONDS,
      option_feed: "indicative",
      feed_disclosure: "Ex-post completed Alpaca historical option OHLCV bars reconstructed for counterfactual research. The zero quote-age value is an invalid-for-live schema shim, not an executable quote-freshness observation.",
      history_mode: "alpaca_historical_point_in_time",
      historical_log_returns: returns,
    };
    const articles = selectArticles(newsResult.value.news, decisionTime, maximumNewsArticles);
    const { signals, omissions } = await buildHistoricalSignals({
      market,
      optionChain,
      newsResponse: { news: articles },
      extractor,
      decisionTime,
    });
    const decision = evaluateHistoricalDecision({
      decisionTime,
      market,
      optionChain,
      signals,
      omissions,
      horizonSessions: clocks.forecast_horizon_sessions,
      equity: DEFAULT_STARTING_EQUITY,
    });
    const contractsBySymbol = new Map(contracts.map((contract) => [contract.symbol, contract]));
    const managementSessions = sessions.slice(sessionIndex + 1, sessionIndex + outcomeSessionOffset + 1);
    const policyCounterfactualOutcome = decision.candidate ? await buildOutcome({
      client,
      candidate: decision.candidate,
      contractsBySymbol,
      decisionSpot: stockBar.c,
      entrySession: sessions[sessionIndex + 1],
      managementSessions,
      holdingHorizonSessions,
      requestDelayMs,
    }) : null;
    const sameCandidate = decision.candidate?.candidate_id === decision.shadow_candidate?.candidate_id;
    const shadowOutcome = decision.shadow_candidate
      ? (sameCandidate ? policyCounterfactualOutcome : await buildOutcome({
        client,
        candidate: decision.shadow_candidate,
        contractsBySymbol,
        decisionSpot: stockBar.c,
        entrySession: sessions[sessionIndex + 1],
        managementSessions,
        holdingHorizonSessions,
        requestDelayMs,
      }))
      : null;
    decisions.push(compactDecision(decision, {
      date: session.date,
      sessionIndex,
      windowIds: session.window_ids,
      policyCounterfactualOutcome,
      shadowOutcome,
      reconstruction: {
        requested_contracts: contracts.length,
        usable_quotes: optionChain.length,
        rejected_quotes: contracts.length - optionChain.length,
        failure_counts: reconstructionFailureCounts(reconstructionResults),
        option_bar_liquidity_proxy_disclosure: "Same completed-bar volume is mapped to Finly's minimum-liquidity field because Alpaca historical bars do not expose point-in-time open interest.",
      },
    }));
    process.stdout.write(`${JSON.stringify({
      progress: offset + 1,
      total: decisionSessions.length,
      date: session.date,
      status: decision.status,
      direction: decision.intent?.direction ?? null,
      candidate: decision.candidate?.action ?? null,
      shadow_candidate: decision.shadow_candidate?.action ?? null,
      policy_counterfactual_outcome: policyCounterfactualOutcome?.status ?? null,
      shadow_outcome: shadowOutcome?.status ?? null,
      source_families: decision.source_families,
    })}\n`);
  }

  const windows = [];
  const privateWindows = [];
  for (const definition of WINDOW_DEFINITIONS.filter((item) => item.marketSessions <= requestedSessions)) {
    const selected = decisions.filter((decision) => decision.window_ids.includes(definition.id));
    const boundary = fixedPerformanceBoundary({
      sessions,
      decisionStartIndex: lastDecisionIndex - definition.marketSessions + 1,
      decisionEndIndex: lastDecisionIndex,
      horizonSessions: outcomeSessionOffset,
    });
    const policyCounterfactual = simulatePortfolio({
      decisions: selected,
      sessions,
      stockBarsByDate,
      startingEquity: DEFAULT_STARTING_EQUITY,
      mode: "policy_counterfactual",
      boundary,
    });
    const shadow = simulatePortfolio({
      decisions: selected,
      sessions,
      stockBarsByDate,
      startingEquity: DEFAULT_STARTING_EQUITY,
      mode: "shadow",
      boundary,
    });
    windows.push(publicWindow(definition, boundary, selected, policyCounterfactual, shadow));
    privateWindows.push({ definition, boundary, decisions: selected, policy_counterfactual: policyCounterfactual, signal_shadow: shadow });
  }
  const generatedAt = new Date().toISOString();
  const result = {
    schema_version: "finly_historical_backtest_report.v3",
    generated_at: generatedAt,
    report_scope: "COUNTERFACTUAL_POLICY_RESEARCH_ONLY",
    broker_policy_equivalence_claimed: false,
    profitability_claimed: false,
    as_of_session: sessions[latestCompletedIndex].date,
    last_decision_session: decisionSessions.at(-1).date,
    starting_equity: DEFAULT_STARTING_EQUITY,
    underlying: "SPY",
    data_provider: "Alpaca",
    data_access: {
      stock_feed: "IEX",
      stock_adjustment: STOCK_ADJUSTMENT,
      cache_schema_version: CACHE_SCHEMA_VERSION,
      option_source: "free historical option OHLCV bars (daily decisions; aligned one-minute outcome proxies)",
      indicative_daily_bar_assumed_availability_delay_minutes: INDICATIVE_DAILY_BAR_AVAILABILITY_DELAY_MINUTES,
      option_history_available_since: "2024-02",
      news_source: "Alpaca historical news",
      local_model: useLlama ? extractor.model : null,
      maximum_news_articles_per_decision: maximumNewsArticles,
      paid_services_used: false,
    },
    methodology: {
      backtest_policy: HISTORICAL_BACKTEST_POLICY,
      clocks,
      reconstruction: HISTORICAL_RECONSTRUCTION_METHOD,
      intraday_alignment: HISTORICAL_INTRADAY_ALIGNMENT_METHOD,
      decision_timing: "Daily features are ex-post completed regular-session bars and the counterfactual decision timestamp is delayed fifteen minutes after the close. Entry research uses the first complete common one-minute SPY/two-leg interval within five minutes of the next open; a decision-time debit limit is counted only when the reconstructed natural debit is at or below that exact limit.",
      management_timing: "Every actual market session from the entry day through the fill-anchored horizon is checked at a common one-minute interval ending within five minutes of the close. Expiry, loss, profit, and time-stop thresholds mirror the coded policy; strategy-invalidation exits are not replayed.",
      forecast_and_holding_clock_alignment: `The compiler forecasts ${clocks.forecast_horizon_sessions} decision-close-to-exit sessions; the reconstructed position is held for ${clocks.holding_horizon_sessions} entry-to-exit session intervals. Both clocks terminate at the same market-session close.`,
      sampling: "Daily decisions for one-week and one-month windows; strictly one decision every five market sessions, anchored on the latest decision, for the one-year window. No extra adjacent endpoint is appended.",
      signal_shadow_development: "The deterministic nearest-spot five-point-vertical shadow rule was fixed after inspecting the recent one-month feasibility run and before replaying older dates. It is a post-hoc development diagnostic, not a preregistered strategy or a clean holdout test; no further selection-rule changes were made before the older-data replay.",
      liquidity_proxy: "Completed same-day option volume is used only as a disclosed historical liquidity proxy; it is not called point-in-time open interest.",
      entry_costs: `reconstructed long ask minus short bid plus $${(POLICY.slippagePerLegDollars * 2).toFixed(2)} modeled two-leg slippage must reach the submitted decision-time debit limit; a counted entry is charged at that limit`,
      exit_costs: `reconstructed long bid minus short ask minus $${(POLICY.exitSlippagePerLegDollars * 2).toFixed(2)} modeled two-leg slippage`,
      missing_management_proxy: "After a reconstructed entry, any missing required management-session alignment or reconstruction fails closed: the entire entry debit is charged as a loss and capital remains occupied through the declared final boundary.",
      sizing: "Each counterfactual decision is re-sized from then-current realized equity after all exits known by that decision session, subject to the recorded full- or half-risk fraction, the $500 cap, four-contract cap, and one-position rule.",
      performance_boundaries: "The counterfactual policy and development shadow share the same decision start, decision end, performance start, and performance end for each window. The performance end includes the declared exit horizon after the final decision.",
      equity_curve: "Portfolio equity changes only when reconstructed trades exit. Drawdown is labeled realized-equity-only; volatility and Sharpe are suppressed until daily option mark-to-market is implemented.",
      benchmark: "Raw/unadjusted SPY IEX close-to-close price return over the fixed performance boundary; dividends are not reinvested. It is full-notional context, not a risk-matched alpha benchmark.",
      comparison_context: "Cash is shown at a zero-interest return. Risk-matched SPY uses each executed trade's maximum capital at risk over that trade's matched entry-open to exit-close interval, with remaining capital in cash.",
      daily_bar_quote_freshness_schema_shim: "The compiler-required quote_age_seconds field is set to zero only as a schema adapter for ex-post daily bars. This value is not a historical freshness measurement, is invalid for live authorization, and blocks broker-policy equivalence claims.",
      broker_policy_equivalence_claimed: false,
      profitability_claimed: false,
      mutation_authorized: false,
      quote_or_fill_equivalence_claimed: false,
    },
    windows,
    limitations: [
      "This is counterfactual policy research, not a broker-authorization replay, execution replication, or evidence of durable alpha or future profitability.",
      "Free historical option bars do not preserve contemporaneous bid/ask, Greeks, queue position, or market impact.",
      "The conservative quote reconstruction is deterministic and disclosed, but it is not historical NBBO execution.",
      "Even exact one-minute alignment does not show simultaneous two-leg executability; all entries and exits are explicitly research proxies, not broker fills.",
      "The replay checks expiry, loss, profit, and fill-anchored time exits, but does not replay the live strategy-invalidation trigger.",
      "The historical decision adapter supplies zero quote age only to satisfy the live compiler schema for ex-post completed daily bars. It is explicitly invalid for live use and does not establish that an executable quote existed or was fresh at the counterfactual decision time.",
      "Alpaca's contract catalog is queried without a historical as-of parameter; requiring a usable same-day bar helps bound the tradable universe but does not fully remove catalog survivorship risk.",
      "Model assessments are point-in-time bounded extractions over archived Alpaca headlines and summaries; external social/prediction-market histories are not included.",
      "Short windows are shown for consistency checks; the one-week and one-month samples cannot establish statistical significance.",
      "Equity is realized-exit-only rather than daily mark-to-market; intratrade drawdowns are absent, and annualized volatility and Sharpe are therefore not reported.",
      "A no-trade window is an abstention result. Its return relative to SPY is not reported as excess return or evidence of alpha.",
    ],
  };
  const publicArtifact = { ...result, artifact_sha256: sha256(result) };
  validatePublishedHistoricalArtifact(publicArtifact, { requestedSessions });
  await writeJson(privateOutput, { ...publicArtifact, private_windows: privateWindows });
  await writeJson(publicOutput, publicArtifact);
  await writeJson(evidenceOutput, publicArtifact);
  await writeJson(siteDataOutput, publicArtifact);
  await verifyIdenticalPublishedArtifacts([publicOutput, evidenceOutput, siteDataOutput], publicArtifact);
  process.stdout.write(`${JSON.stringify({ complete: true, output: publicOutput, artifact_sha256: publicArtifact.artifact_sha256, windows: windows.map((window) => ({ id: window.id, policy_counterfactual: window.policy_counterfactual.metrics.total_return, policy_counterfactual_trades: window.policy_counterfactual.metrics.trade_count, signal_shadow: window.signal_shadow.metrics.total_return, signal_shadow_trades: window.signal_shadow.metrics.trade_count })) })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Finly historical backtest stopped: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
