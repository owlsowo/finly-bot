import { sha256 } from "./canonical.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";
import {
  applyEconomicRiskCommitteeVeto,
  buildCurrentEconomicDecision,
} from "./economic_research.mjs";

export const CURRENT_DAILY_BAR_AVAILABILITY_DELAY_MINUTES = 15;
export const OFFICIAL_G4_EQUITY_SYMBOLS = Object.freeze(["QQQ", "XLB", "XLE", "XLV"]);

function isoInstant(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${label} is invalid`);
  return parsed.toISOString();
}

function currentInstant(now, label) {
  if (typeof now !== "function") throw new TypeError("current economic clock must be a function");
  return isoInstant(now(), label);
}

export function newYorkMarketDate(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError("market-date instant is invalid");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function shiftCalendarDays(date, days) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError("calendar shift date is invalid");
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function zonedNewYorkInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new TypeError("market calendar date/time is invalid");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day
    || hour > 23
    || minute > 59) {
    throw new TypeError("market calendar date/time is invalid");
  }
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
    const byType = Object.fromEntries(parts.filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]));
    const renderedAsUtc = Date.UTC(
      byType.year,
      byType.month - 1,
      byType.day,
      byType.hour,
      byType.minute,
      byType.second,
    );
    candidate += desiredAsUtc - renderedAsUtc;
  }
  return new Date(candidate).toISOString();
}

/**
 * Daily-bar timestamps label sessions; they do not prove that a closing value
 * was observable. This boundary uses the official Alpaca calendar and admits a
 * session only after its regular close plus an explicit conservative delay.
 */
export function resolveCompletedDailyBarBoundary(calendar, {
  asOf,
  availabilityDelayMinutes = CURRENT_DAILY_BAR_AVAILABILITY_DELAY_MINUTES,
} = {}) {
  if (!Array.isArray(calendar) || calendar.length === 0) throw new TypeError("market calendar is empty");
  if (!Number.isInteger(availabilityDelayMinutes)
    || availabilityDelayMinutes < 1
    || availabilityDelayMinutes > 120) {
    throw new TypeError("daily-bar availability delay must be an integer from 1 to 120 minutes");
  }
  const evaluatedAt = isoInstant(asOf, "completed-session boundary asOf");
  let priorDate = "";
  const sessions = calendar.map((session, index) => {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      throw new TypeError(`market calendar session ${index} is invalid`);
    }
    const { date, close } = session;
    if (typeof date !== "string" || typeof close !== "string" || date <= priorDate) {
      throw new TypeError("market calendar sessions are invalid or out of order");
    }
    priorDate = date;
    const marketCloseAt = zonedNewYorkInstant(date, close);
    const eligibleAt = new Date(
      new Date(marketCloseAt).getTime() + availabilityDelayMinutes * 60_000,
    ).toISOString();
    return { date, marketCloseAt, eligibleAt };
  });
  const completed = sessions.filter((session) => session.eligibleAt <= evaluatedAt).at(-1);
  if (!completed) throw new Error("market calendar contains no daily bar eligible at the evaluation time");
  return Object.freeze({
    sessionDate: completed.date,
    marketCloseAt: completed.marketCloseAt,
    eligibleAt: completed.eligibleAt,
    availabilityDelayMinutes,
  });
}

function finiteNonnegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${label} must be finite and nonnegative`);
  return number;
}

function finiteSigned(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

export function currentPaperAllocation(account, positions) {
  if (!account || account.status !== "ACTIVE" || account.trading_blocked !== false || account.account_blocked !== false) {
    throw new Error("paper account is not active and unblocked");
  }
  if (!Array.isArray(positions)) throw new TypeError("paper positions response must be an array");
  const allocationSymbols = new Set(["SPY", "BIL"]);
  const officialG4Symbols = new Set(OFFICIAL_G4_EQUITY_SYMBOLS);
  const allocationPositions = [];
  const officialG4Positions = [];
  const excludedOptionPositions = [];
  const unsupported = [];
  for (const position of positions) {
    if (allocationSymbols.has(position?.symbol)) {
      if (position?.asset_class !== "us_equity") unsupported.push(position);
      else allocationPositions.push(position);
      continue;
    }
    if (officialG4Symbols.has(position?.symbol)) {
      if (position?.asset_class !== "us_equity") unsupported.push(position);
      else officialG4Positions.push(position);
      continue;
    }
    try {
      const occ = parseOccOptionSymbol(position?.symbol);
      if (position?.asset_class !== "us_option" || occ.underlying !== "SPY") throw new Error("unsupported position");
      excludedOptionPositions.push(position);
    } catch {
      unsupported.push(position);
    }
  }
  if (unsupported.length > 0) throw new Error("paper account contains positions outside the SPY/BIL economic policy");
  const equity = finiteNonnegative(account.equity, "paper equity");
  if (equity <= 0) throw new Error("paper equity must be positive");
  const spyMarketValue = allocationPositions.filter((position) => position.symbol === "SPY")
    .reduce((sum, position) => sum + finiteNonnegative(position.market_value, "SPY market value"), 0);
  allocationPositions.filter((position) => position.symbol === "BIL")
    .forEach((position) => finiteNonnegative(position.market_value, "BIL market value"));
  const officialG4EquityMarketValue = officialG4Positions
    .reduce((sum, position) => sum + finiteNonnegative(position.market_value, "official G4 equity market value"), 0);
  const optionNetMarketValue = excludedOptionPositions
    .reduce((sum, position) => sum + finiteSigned(position.market_value, "SPY option market value"), 0);
  const rawEconomicSleeveEquity = equity - officialG4EquityMarketValue - optionNetMarketValue;
  if (rawEconomicSleeveEquity < -Math.max(0.01, equity * 0.000001)) {
    throw new Error("excluded position value exceeds paper equity");
  }
  const economicSleeveEquity = Math.max(0, rawEconomicSleeveEquity);
  if (spyMarketValue > economicSleeveEquity * 1.000001) throw new Error("SPY market value exceeds the economic sleeve equity");
  const spyWeight = economicSleeveEquity === 0 ? 0 : Math.min(1, spyMarketValue / economicSleeveEquity);
  const round = (value) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
  return Object.freeze({
    spyWeight: round(spyWeight),
    bilWeight: round(1 - spyWeight),
    defensive_weight_includes_uninvested_paper_cash: true,
    option_positions_excluded_from_spy_bil_allocation_count: excludedOptionPositions.length,
    option_net_market_value_excluded: round(optionNetMarketValue),
    official_g4_equity_position_count: officialG4Positions.length,
    official_g4_equity_market_value: round(officialG4EquityMarketValue),
    economic_sleeve_equity: round(economicSleeveEquity),
  });
}

export async function buildFreshCurrentEconomicBundle({
  historicalClient,
  paperClient,
  now = () => new Date(),
  lastRebalanceDate = null,
  availabilityDelayMinutes = CURRENT_DAILY_BAR_AVAILABILITY_DELAY_MINUTES,
} = {}) {
  if (!historicalClient || typeof historicalClient.getMarketCalendar !== "function"
    || typeof historicalClient.getStockBars !== "function") {
    throw new TypeError("fresh economic bundle requires the bounded historical Alpaca client");
  }
  if (!paperClient || typeof paperClient.getAccount !== "function" || typeof paperClient.getPositions !== "function") {
    throw new TypeError("fresh economic bundle requires the read-only Alpaca paper client");
  }
  const fetchStartedAt = currentInstant(now, "current economic fetch start");
  const marketDate = newYorkMarketDate(fetchStartedAt);
  const calendarStart = shiftCalendarDays(marketDate, -14);
  const calendarResult = await historicalClient.getMarketCalendar({ start: calendarStart, end: marketDate });
  const boundary = resolveCompletedDailyBarBoundary(calendarResult.calendar, {
    asOf: fetchStartedAt,
    availabilityDelayMinutes,
  });
  const barRequest = {
    start: "2016-01-01",
    end: boundary.eligibleAt,
    timeframe: "1Day",
    feed: "sip",
    adjustment: "all",
    limit: 10_000,
  };
  const [spyResponse, cashResponse, account, positions] = await Promise.all([
    historicalClient.getStockBars("SPY", barRequest),
    historicalClient.getStockBars("BIL", barRequest),
    paperClient.getAccount(),
    paperClient.getPositions(),
  ]);
  if (!Array.isArray(spyResponse?.bars)
    || !Array.isArray(cashResponse?.bars)
    || spyResponse.bars.length !== cashResponse.bars.length
    || spyResponse.bars.length < 253) {
    throw new Error("current economic data does not contain a complete aligned history");
  }
  const sourceAvailableAt = currentInstant(now, "current economic fetch completion");
  const decisionTimestamp = currentInstant(now, "current economic decision");
  const allocation = currentPaperAllocation(account, positions);
  const base = buildCurrentEconomicDecision({
    spyBars: spyResponse.bars,
    cashBars: cashResponse.bars,
    decisionTimestamp,
    sourceAvailableAt,
    completedSessionBoundary: boundary,
    currentAllocation: { spyWeight: allocation.spyWeight, bilWeight: allocation.bilWeight },
    lastRebalanceDate,
  });
  const committee = applyEconomicRiskCommitteeVeto(base, {
    assessedAt: decisionTimestamp,
    disposition: "SCALE",
    spyExposureMultiplier: 1,
    reasonCodes: ["NO_AGENT_RISK_REDUCTION"],
  });
  const body = {
    schema_version: "finly_current_economic_bundle.v1",
    generated_at: decisionTimestamp,
    data: {
      provider: "Alpaca",
      feed: "sip",
      adjustment: "all",
      read_only: true,
      request_started_at: fetchStartedAt,
      source_fetch_completed_at: sourceAvailableAt,
      daily_bar_timestamp_semantics: "session label only; availability is established by official close plus delay and authenticated fetch completion",
      daily_bar_availability_delay_minutes: availabilityDelayMinutes,
      completed_session_boundary: {
        session_date: boundary.sessionDate,
        market_close_at: boundary.marketCloseAt,
        eligible_at: boundary.eligibleAt,
      },
      aligned_session_count: spyResponse.bars.length,
      observed_start: spyResponse.bars[0].t.slice(0, 10),
      observed_end: spyResponse.bars.at(-1).t.slice(0, 10),
      spy_bars_sha256: sha256(spyResponse.bars),
      bil_bars_sha256: sha256(cashResponse.bars),
      raw_bars_embedded: false,
    },
    paper_account_boundary: {
      authenticated_read_succeeded: true,
      raw_account_embedded: false,
      raw_positions_embedded: false,
      supported_positions_only: true,
      current_spy_weight: allocation.spyWeight,
      current_defensive_weight: allocation.bilWeight,
      defensive_weight_includes_uninvested_paper_cash: allocation.defensive_weight_includes_uninvested_paper_cash,
      option_positions_excluded_from_spy_bil_allocation_count: allocation.option_positions_excluded_from_spy_bil_allocation_count,
      option_net_market_value_excluded: allocation.option_net_market_value_excluded,
      official_g4_equity_position_count: allocation.official_g4_equity_position_count,
      official_g4_equity_market_value: allocation.official_g4_equity_market_value,
      economic_sleeve_equity: allocation.economic_sleeve_equity,
    },
    deterministic_decision: base,
    risk_committee_decision: committee,
    mutation_requested: false,
  };
  return Object.freeze({ ...body, artifact_sha256: sha256(body) });
}
