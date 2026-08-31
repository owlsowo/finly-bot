import { sha256, stableStringify } from "./canonical.mjs";
import {
  assertCompetitionForwardProfitContract,
  buildCompetitionForwardProfitMeasurement,
} from "./competition_forward_profit.mjs";

const PAPER_ORIGIN = "https://paper-api.alpaca.markets";
const DATA_ORIGIN = "https://data.alpaca.markets";
const WINDOW_DURATION_MS = 60_000;
const ACTIVITY_PAGE_SIZE = 100;
const BAR_PAGE_SIZE = 10_000;
const MAX_ACTIVITY_PAGES = 100;
const MAX_BAR_PAGES = 10;
const MAX_FILL_ORDER_PROOFS = 100;
const ACTIVITY_BASELINE_SCHEMA = "finly_forward_profit_activity_baseline.v1";
const ACTIVITY_BASELINE_ID = "official-paper-activity-baseline-2026-08-31";
const G4_ORDER_PLAN = Object.freeze([
  Object.freeze({ sequence: 0, symbol: "QQQ", notional: "48500.00" }),
  Object.freeze({ sequence: 1, symbol: "XLB", notional: "16166.66" }),
  Object.freeze({ sequence: 2, symbol: "XLE", notional: "16166.66" }),
  Object.freeze({ sequence: 3, symbol: "XLV", notional: "16166.66" }),
]);

export const ALPACA_EXTERNAL_ACTIVITY_TYPES = Object.freeze([
  "ACATC", "ACATS", "CSD", "CSW", "FOPT", "JNL", "JNLC", "JNLS", "OCT", "TRANS",
]);

export const ALPACA_ENDOGENOUS_ACTIVITY_TYPES = Object.freeze([
  "CFEE", "CGD", "DIV", "DIVCGL", "DIVCGS", "DIVFEE", "DIVFT", "DIVNRA", "DIVROC",
  "DIVTW", "DIVTXEX", "FEE", "FILL", "INT", "INTNRA", "INTTW", "MA", "NC", "OPASN",
  "OPCA", "OPCSH", "OPEXC", "OPEXP", "OPXRC", "OPTRD", "PTC", "PTR", "REO", "REORG",
  "SC", "SPIN", "SPLIT", "SSO", "SSP",
]);

const FEE_ACTIVITY_TYPES = new Set(["CFEE", "DIVFEE", "FEE", "PTC", "PTR"]);
const EXTERNAL_ACTIVITY_TYPES = new Set(ALPACA_EXTERNAL_ACTIVITY_TYPES);
const ENDOGENOUS_ACTIVITY_TYPES = new Set(ALPACA_ENDOGENOUS_ACTIVITY_TYPES);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || stableStringify(Object.keys(value).sort()) !== stableStringify([...keys].sort())) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function allowedKeys(value, required, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function exactObservedInstant(value, label) {
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (parsed === null || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function clockInstant(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed.toISOString();
}

function parseBrokerInstant(value, label) {
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
    : null;
  if (match === null) throw new Error(`${label} is invalid`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone,
    sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, "0").slice(0, 3));
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] ?? 0)
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0) || (sign === "-" && offsetHour === 0 && offsetMinute === 0)) {
    throw new Error(`${label} is invalid`);
  }
  const wallClock = new Date(0);
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, millisecond);
  const offsetMilliseconds = (offsetHour * 60 + offsetMinute) * 60_000;
  const milliseconds = wallClock.getTime() + (sign === "-" ? offsetMilliseconds : -offsetMilliseconds);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid`);
  return milliseconds;
}

function canonicalBrokerInstant(value, label) {
  return new Date(parseBrokerInstant(value, label)).toISOString();
}

function exactDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`${label} is invalid`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function finitePositive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} is invalid`);
  return value;
}

function finiteNonnegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} is invalid`);
  return value;
}

function parseDecimal(value, label) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} is invalid`);
  return number;
}

function exactOrigin(value, expected, label) {
  const parsed = new URL(value);
  const allowed = new URL(expected);
  if (parsed.origin !== allowed.origin || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error(`${label} origin is not allowlisted`);
  }
  return allowed.origin;
}

function safeToken(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 || /[^\x20-\x7e]/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function safeActivityId(value, label) {
  safeToken(value, label);
  if (!value.includes("::")) throw new Error(`${label} is invalid`);
  return value;
}

function safeOrderId(value, label) {
  if (typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function hasControlOrWhitespace(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 32 || code === 127;
  });
}

function signedBaseline(baseline) {
  const body = structuredClone(baseline);
  delete body.baseline_hash;
  return body;
}

export function assertAlpacaPreWindowOrderGuard(rawOrders, activityBaseline, contract) {
  assertCompetitionActivityBaseline(activityBaseline, contract);
  if (!Array.isArray(rawOrders) || rawOrders.length > 1) {
    throw new Error("Alpaca pre-window order guard response is invalid");
  }
  if (rawOrders.length === 0) return true;
  const order = rawOrders[0];
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    throw new Error("Alpaca pre-window order guard response is invalid");
  }
  safeOrderId(order.id, "Alpaca pre-window order ID");
  const createdAt = canonicalBrokerInstant(order.created_at, "Alpaca pre-window order creation time");
  const submittedAt = canonicalBrokerInstant(order.submitted_at, "Alpaca pre-window order submission time");
  if (createdAt >= activityBaseline.captured_at || submittedAt >= activityBaseline.captured_at) {
    throw new Error("Alpaca pre-window order invalidates the frozen flat-account baseline");
  }
  if (createdAt >= contract.competition_window.start_at
    || submittedAt >= contract.competition_window.start_at) {
    throw new Error("Alpaca pre-window order guard exceeded the competition boundary");
  }
  return true;
}

export function assertCompetitionActivityBaseline(baseline, contract) {
  assertCompetitionForwardProfitContract(contract);
  exactKeys(baseline, [
    "account_binding_verified", "account_id_hash", "account_snapshot", "account_snapshot_query",
    "activity_count", "activity_records",
    "activity_type_counts", "baseline_hash", "baseline_id", "bounded_snapshot_stable", "captured_at",
    "competition_window_start_at", "page_counts", "pagination_exhausted", "preexisting_fill_count",
    "production_protocol_hash", "query", "raw_identifiers_persisted", "read_only", "sanitized",
    "schema_version", "sweep_count",
  ], "Forward-profit activity baseline");
  exactKeys(baseline.query, [
    "activity_type_filter", "direction", "endpoint", "page_size", "time_filter",
  ], "Forward-profit activity-baseline query");
  exactKeys(baseline.account_snapshot, [
    "cash_dollars", "equity_dollars", "open_order_count", "position_count",
  ], "Forward-profit baseline account snapshot");
  exactKeys(baseline.account_snapshot_query, [
    "account_endpoint", "open_orders_endpoint", "positions_endpoint",
  ], "Forward-profit baseline account-snapshot query");
  if (baseline.schema_version !== ACTIVITY_BASELINE_SCHEMA || baseline.baseline_id !== ACTIVITY_BASELINE_ID
    || baseline.competition_window_start_at !== contract.competition_window.start_at
    || baseline.production_protocol_hash !== contract.production_protocol.protocol_hash
    || baseline.baseline_hash !== contract.activity_baseline.baseline_hash
    || baseline.baseline_hash !== sha256(signedBaseline(baseline))
    || baseline.sanitized !== true || baseline.raw_identifiers_persisted !== false || baseline.read_only !== true
    || baseline.account_binding_verified !== true || !/^sha256:[a-f0-9]{64}$/u.test(baseline.account_id_hash)
    || baseline.pagination_exhausted !== true
    || baseline.bounded_snapshot_stable !== true || baseline.sweep_count !== 2
    || stableStringify(baseline.account_snapshot) !== stableStringify({
      equity_dollars: "100000.00", cash_dollars: "100000.00", position_count: 0, open_order_count: 0,
    })
    || stableStringify(baseline.account_snapshot_query) !== stableStringify({
      account_endpoint: "/v2/account",
      positions_endpoint: "/v2/positions",
      open_orders_endpoint: "/v2/orders?status=open&nested=true&limit=500",
    })
    || stableStringify(baseline.activity_type_counts) !== stableStringify({ JNLC: 1 })
    || baseline.preexisting_fill_count !== 0
    || stableStringify(baseline.query) !== stableStringify({
      endpoint: "/v2/account/activities",
      direction: "asc",
      page_size: 100,
      activity_type_filter: null,
      time_filter: null,
    })) {
    throw new Error("Forward-profit activity baseline identity or hash is invalid");
  }
  const capturedAt = exactObservedInstant(baseline.captured_at, "Forward-profit activity baseline capture time");
  if (Date.parse(capturedAt) >= Date.parse(contract.competition_window.start_at)) {
    throw new Error("Forward-profit activity baseline was not captured before the competition window");
  }
  if (!Number.isSafeInteger(baseline.activity_count) || baseline.activity_count < 0
    || !Array.isArray(baseline.activity_records)
    || baseline.activity_records.length !== baseline.activity_count
    || !Array.isArray(baseline.page_counts) || baseline.page_counts.length !== 2
    || baseline.page_counts.some((count) => !Number.isSafeInteger(count) || count < 1)) {
    throw new Error("Forward-profit activity baseline count is invalid");
  }
  let priorHash = "";
  for (const record of baseline.activity_records) {
    exactKeys(record, ["id_hash", "payload_hash"], "Forward-profit activity-baseline record");
    if (!/^sha256:[a-f0-9]{64}$/u.test(record.id_hash)
      || !/^sha256:[a-f0-9]{64}$/u.test(record.payload_hash) || record.id_hash <= priorHash) {
      throw new Error("Forward-profit activity baseline hashes are invalid or unordered");
    }
    priorHash = record.id_hash;
  }
  return baseline;
}

export function assertAlpacaActivityMappingMatchesContract(contract) {
  assertCompetitionForwardProfitContract(contract);
  if (stableStringify(contract.guardrails.external_cashflow_activity_types)
      !== stableStringify(ALPACA_EXTERNAL_ACTIVITY_TYPES)
    || stableStringify(contract.guardrails.endogenous_activity_types)
      !== stableStringify(ALPACA_ENDOGENOUS_ACTIVITY_TYPES)) {
    throw new Error("Alpaca activity mapping drifted from the frozen KPI contract");
  }
  return contract;
}

function newYorkMarketDate(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function zonedNewYorkInstant(date, time) {
  exactDate(date, "Alpaca calendar date");
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(time);
  if (match === null) throw new Error("Alpaca calendar time is invalid");
  const [year, month, day] = date.split("-").map(Number);
  const [, hourText, minuteText, secondText = "00"] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) throw new Error("Alpaca calendar time is invalid");
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = desiredAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const byType = Object.fromEntries(parts.filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]));
    candidate += desiredAsUtc - Date.UTC(
      byType.year, byType.month - 1, byType.day, byType.hour, byType.minute, byType.second,
    );
  }
  return new Date(candidate).toISOString();
}

function normalizeCalendar(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) throw new Error("Alpaca calendar is invalid");
  const sessions = new Map();
  let priorDate = "";
  for (let index = 0; index < raw.length; index += 1) {
    const session = raw[index];
    allowedKeys(session, ["close", "date", "open"], [
      "close", "date", "open", "session_close", "session_open", "settlement_date",
    ], `Alpaca calendar session ${index + 1}`);
    const date = exactDate(session.date, `Alpaca calendar session ${index + 1} date`);
    if (date <= priorDate) throw new Error("Alpaca calendar sessions are duplicated or unordered");
    priorDate = date;
    if (session.settlement_date !== undefined) exactDate(session.settlement_date, "Alpaca settlement date");
    const openAt = zonedNewYorkInstant(date, session.open);
    const closeAt = zonedNewYorkInstant(date, session.close);
    if (Date.parse(closeAt) <= Date.parse(openAt)) throw new Error("Alpaca calendar session is inverted");
    sessions.set(date, Object.freeze({ date, open_at: openAt, close_at: closeAt }));
  }
  return sessions;
}

function regularSessionForWindow(windowStartAt, valuedAt, sessions, label) {
  const session = sessions.get(newYorkMarketDate(windowStartAt));
  if (!session) throw new Error(`${label} has no official trading session`);
  return windowStartAt >= session.open_at && valuedAt <= session.close_at;
}

function assertWithinMeasurementWindow(at, contract, maximumAt, label) {
  const milliseconds = Date.parse(at);
  if (milliseconds < Date.parse(contract.competition_window.start_at)
    || milliseconds >= Date.parse(contract.competition_window.end_at)
    || milliseconds > Date.parse(maximumAt)) {
    throw new Error(`${label} is outside the completed measurement window`);
  }
}

function normalizePortfolioHistory(raw, contract, maximumValuedAt, sessions) {
  allowedKeys(raw,
    ["base_value", "equity", "profit_loss", "profit_loss_pct", "timeframe", "timestamp"],
    ["base_value", "base_value_asof", "cashflow", "equity", "profit_loss", "profit_loss_pct", "timeframe", "timestamp"],
    "Alpaca portfolio history");
  if (raw.timeframe !== "1Min" || !Array.isArray(raw.timestamp) || !Array.isArray(raw.equity)
    || !Array.isArray(raw.profit_loss) || !Array.isArray(raw.profit_loss_pct)) {
    throw new Error("Alpaca portfolio history shape is invalid");
  }
  const arrays = [raw.timestamp, raw.equity, raw.profit_loss, raw.profit_loss_pct];
  const cashflowArrays = [];
  if (raw.cashflow !== undefined) {
    if (!raw.cashflow || typeof raw.cashflow !== "object" || Array.isArray(raw.cashflow)) {
      throw new Error("Alpaca portfolio cashflow is invalid");
    }
    for (const [activityType, values] of Object.entries(raw.cashflow)) {
      if (!/^[A-Z]{2,8}$/u.test(activityType) || !Array.isArray(values)) {
        throw new Error("Alpaca portfolio cashflow is invalid");
      }
      cashflowArrays.push([activityType, values]);
      arrays.push(values);
    }
  }
  if (new Set(arrays.map((array) => array.length)).size !== 1) {
    throw new Error("Alpaca portfolio history arrays are misaligned");
  }
  if (raw.base_value !== null && (typeof raw.base_value !== "number" || !Number.isFinite(raw.base_value))) {
    throw new Error("Alpaca portfolio-history base value is invalid");
  }
  if (raw.base_value_asof !== undefined && raw.base_value_asof !== null) {
    exactDate(raw.base_value_asof, "Alpaca portfolio-history base date");
  }
  const points = [];
  let previousWindowStart = null;
  for (let index = 0; index < raw.timestamp.length; index += 1) {
    const epochSeconds = raw.timestamp[index];
    if (!Number.isSafeInteger(epochSeconds) || epochSeconds <= 0) {
      throw new Error(`Alpaca portfolio timestamp ${index + 1} is invalid`);
    }
    const windowStartMs = epochSeconds * 1000;
    if (previousWindowStart !== null && windowStartMs <= previousWindowStart) {
      throw new Error("Alpaca portfolio timestamps are duplicated or unordered");
    }
    previousWindowStart = windowStartMs;
    const windowStartAt = new Date(windowStartMs).toISOString();
    const valuedAt = new Date(windowStartMs + WINDOW_DURATION_MS).toISOString();
    assertWithinMeasurementWindow(valuedAt, contract, maximumValuedAt, `Alpaca portfolio point ${index + 1}`);
    const equity = raw.equity[index];
    for (const [label, value] of [
      ["profit/loss", raw.profit_loss[index]], ["profit/loss percentage", raw.profit_loss_pct[index]],
    ]) {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(`Alpaca portfolio ${label} ${index + 1} is invalid`);
      }
    }
    for (const [activityType, values] of cashflowArrays) {
      if (typeof values[index] !== "number" || !Number.isFinite(values[index])) {
        throw new Error(`Alpaca portfolio cashflow ${activityType} ${index + 1} is invalid`);
      }
    }
    if (cashflowArrays.some(([activityType, values]) => values[index] !== null && values[index] !== 0
      && (EXTERNAL_ACTIVITY_TYPES.has(activityType) || !ENDOGENOUS_ACTIVITY_TYPES.has(activityType)))) {
      throw new Error("Alpaca portfolio cashflow crosscheck detected external or unknown activity");
    }
    if (equity === null) {
      if (raw.profit_loss[index] !== null || raw.profit_loss_pct[index] !== null) {
        throw new Error(`Alpaca portfolio null equity ${index + 1} contradicts its profit series`);
      }
      continue;
    }
    finitePositive(equity, `Alpaca portfolio equity ${index + 1}`);
    if (Math.abs(equity * 100 - Math.round(equity * 100)) > 1e-7) {
      throw new Error(`Alpaca portfolio equity ${index + 1} is not cent-denominated`);
    }
    if (regularSessionForWindow(windowStartAt, valuedAt, sessions, `Alpaca portfolio point ${index + 1}`)) {
      points.push({ window_start_at: windowStartAt, valued_at: valuedAt, equity });
    }
  }
  return points;
}

function flattenSpyBarPages(pages) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_BAR_PAGES) {
    throw new Error("Alpaca SPY page collection is invalid");
  }
  const bars = [];
  const seenPageTokens = new Set();
  let expectedRequestToken = null;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    exactKeys(page, ["request_page_token", "response"], `Alpaca SPY page ${pageIndex + 1}`);
    if (page.request_page_token !== expectedRequestToken) throw new Error("Alpaca SPY pagination chain is discontinuous");
    allowedKeys(page.response, ["bars", "next_page_token", "symbol"],
      ["bars", "currency", "next_page_token", "symbol"], `Alpaca SPY response ${pageIndex + 1}`);
    if (page.response.symbol !== "SPY" || (page.response.currency !== undefined && page.response.currency !== "USD")
      || !Array.isArray(page.response.bars) || page.response.bars.length > BAR_PAGE_SIZE) {
      throw new Error("Alpaca SPY response is invalid");
    }
    bars.push(...page.response.bars);
    const nextToken = page.response.next_page_token;
    if (nextToken === null) {
      if (pageIndex !== pages.length - 1) throw new Error("Alpaca SPY pagination continued after a terminal page");
      expectedRequestToken = null;
    } else {
      safeToken(nextToken, "Alpaca SPY continuation token");
      if (page.response.bars.length === 0 || seenPageTokens.has(nextToken)) {
        throw new Error("Alpaca SPY pagination token is empty-page or repeated");
      }
      seenPageTokens.add(nextToken);
      if (pageIndex === pages.length - 1) throw new Error("Alpaca SPY pagination is incomplete");
      expectedRequestToken = nextToken;
    }
  }
  return bars;
}

function normalizeSpyBarPages(pages, contract, maximumValuedAt, sessions) {
  const bars = flattenSpyBarPages(pages);
  const spyPoints = [];
  let spyAnchor = null;
  let previousWindowStart = null;
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    exactKeys(bar, ["c", "h", "l", "n", "o", "t", "v", "vw"], `Alpaca SPY bar ${index + 1}`);
    const windowStartAt = canonicalBrokerInstant(bar.t, `Alpaca SPY bar ${index + 1} timestamp`);
    const windowStartMs = Date.parse(windowStartAt);
    if (windowStartMs % WINDOW_DURATION_MS !== 0) throw new Error("Alpaca SPY bar is not minute-aligned");
    if (previousWindowStart !== null && windowStartMs <= previousWindowStart) {
      throw new Error("Alpaca SPY bars are duplicated or unordered");
    }
    previousWindowStart = windowStartMs;
    const valuedAt = new Date(windowStartMs + WINDOW_DURATION_MS).toISOString();
    assertWithinMeasurementWindow(valuedAt, contract, maximumValuedAt, `Alpaca SPY bar ${index + 1}`);
    const open = finitePositive(bar.o, `Alpaca SPY bar ${index + 1} open`);
    const high = finitePositive(bar.h, `Alpaca SPY bar ${index + 1} high`);
    const low = finitePositive(bar.l, `Alpaca SPY bar ${index + 1} low`);
    const close = finitePositive(bar.c, `Alpaca SPY bar ${index + 1} close`);
    finitePositive(bar.vw, `Alpaca SPY bar ${index + 1} VWAP`);
    finiteNonnegative(bar.v, `Alpaca SPY bar ${index + 1} volume`);
    finiteNonnegative(bar.n, `Alpaca SPY bar ${index + 1} trade count`);
    if (!Number.isInteger(bar.n) || high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      throw new Error(`Alpaca SPY bar ${index + 1} OHLC is invalid`);
    }
    if (!regularSessionForWindow(windowStartAt, valuedAt, sessions, `Alpaca SPY bar ${index + 1}`)) continue;
    if (windowStartAt === contract.competition_window.start_at) {
      spyAnchor = { window_start_at: windowStartAt, valued_at: valuedAt, open_price: open };
    }
    spyPoints.push({ window_start_at: windowStartAt, valued_at: valuedAt, price: close });
  }
  return spyAnchor === null ? { spyAnchor: null, spyPoints: [] } : { spyAnchor, spyPoints };
}

function classifyNontradeActivity(activityType) {
  if (EXTERNAL_ACTIVITY_TYPES.has(activityType)) return "EXTERNAL_CASHFLOW";
  if (FEE_ACTIVITY_TYPES.has(activityType)) return "FEE";
  if (ENDOGENOUS_ACTIVITY_TYPES.has(activityType) && activityType !== "FILL") return "ENDOGENOUS";
  return "UNKNOWN";
}

function baselineActivityPayloads(baseline) {
  return new Map(
    baseline.activity_records.map(({ id_hash: idHash, payload_hash: payloadHash }) => [idHash, payloadHash]),
  );
}

function isFrozenBaselineActivity(activity, baselineByIdHash, label) {
  const id = safeActivityId(activity?.id, `${label} ID`);
  const idHash = sha256(id);
  if (!baselineByIdHash.has(idHash)) return false;
  if (baselineByIdHash.get(idHash) !== sha256(activity)) {
    throw new Error("Alpaca baseline activity payload drifted");
  }
  return true;
}

function flattenActivityPages(pages) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_ACTIVITY_PAGES) {
    throw new Error("Alpaca activity page collection is invalid");
  }
  const byId = new Map();
  const seenRequestTokens = new Set();
  let expectedRequestToken = null;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    exactKeys(page, ["items", "request_page_token"], `Alpaca activity page ${pageIndex + 1}`);
    if (page.request_page_token !== expectedRequestToken || !Array.isArray(page.items)
      || page.items.length > ACTIVITY_PAGE_SIZE) {
      throw new Error("Alpaca activity pagination chain is invalid");
    }
    if (page.request_page_token !== null) {
      if (seenRequestTokens.has(page.request_page_token)) {
        throw new Error("Alpaca activity pagination token repeated");
      }
      seenRequestTokens.add(page.request_page_token);
    }
    if (pageIndex < pages.length - 1 && page.items.length === 0) {
      throw new Error("Alpaca activity pagination continued after a terminal page");
    }
    if (pageIndex === pages.length - 1 && page.items.length !== 0) {
      throw new Error("Alpaca activity pagination is incomplete");
    }
    for (const item of page.items) {
      const id = safeActivityId(item?.id, "Alpaca activity ID");
      const canonical = stableStringify(item);
      const prior = byId.get(id);
      if (prior !== undefined && prior.canonical !== canonical) {
        throw new Error("Alpaca activities contain a conflicting duplicate ID");
      }
      if (prior === undefined) byId.set(id, { canonical, item });
    }
    if (page.items.length > 0) {
      expectedRequestToken = safeActivityId(page.items.at(-1)?.id, "Alpaca activity continuation ID");
    }
  }
  return [...byId.values()].map(({ item }) => item);
}

export function assertAlpacaActivitySnapshotCoversBaseline(pages, baseline) {
  const rawActivities = flattenActivityPages(pages);
  if (!baseline || !Array.isArray(baseline.activity_records)
    || !Number.isSafeInteger(baseline.activity_count)
    || baseline.activity_records.length !== baseline.activity_count) {
    throw new Error("Alpaca activity baseline coverage input is invalid");
  }
  const baselineByIdHash = baselineActivityPayloads(baseline);
  const observed = new Set();
  for (let index = 0; index < rawActivities.length; index += 1) {
    const activity = rawActivities[index];
    const id = safeActivityId(activity?.id, `Alpaca activity ${index + 1} ID`);
    const idHash = sha256(id);
    if (!baselineByIdHash.has(idHash)) continue;
    if (baselineByIdHash.get(idHash) !== sha256(activity)) {
      throw new Error("Alpaca baseline activity payload drifted");
    }
    observed.add(idHash);
  }
  if (observed.size !== baselineByIdHash.size) {
    throw new Error("Alpaca activity snapshot is missing a frozen baseline row");
  }
  return true;
}

export function assertAlpacaScopedActivitySnapshotMatchesUnfiltered(
  scopedPages, unfilteredPages, baseline,
) {
  const scopedActivities = flattenActivityPages(scopedPages);
  const unfilteredActivities = flattenActivityPages(unfilteredPages);
  if (!baseline || !Array.isArray(baseline.activity_records)) {
    throw new Error("Alpaca activity scope baseline is invalid");
  }
  const baselineByIdHash = baselineActivityPayloads(baseline);
  const scopedByIdHash = new Map();
  for (const activity of scopedActivities) {
    const idHash = sha256(safeActivityId(activity?.id, "Alpaca scoped activity ID"));
    if (baselineByIdHash.has(idHash)) {
      throw new Error("Alpaca post-window activity scope contains a frozen baseline row");
    }
    scopedByIdHash.set(idHash, sha256(activity));
  }
  const expectedByIdHash = new Map();
  for (const activity of unfilteredActivities) {
    const idHash = sha256(safeActivityId(activity?.id, "Alpaca unfiltered activity ID"));
    if (baselineByIdHash.has(idHash)) continue;
    expectedByIdHash.set(idHash, sha256(activity));
  }
  if (stableStringify([...scopedByIdHash.entries()].sort())
      !== stableStringify([...expectedByIdHash.entries()].sort())) {
    throw new Error("Alpaca post-window activity scope does not match the unfiltered ledger delta");
  }
  return true;
}

function inWindowFillOrderExpectations(pages, contract, baseline) {
  const rawActivities = flattenActivityPages(pages);
  const baselineByIdHash = baselineActivityPayloads(baseline);
  const expectations = new Map();
  for (let index = 0; index < rawActivities.length; index += 1) {
    const activity = rawActivities[index];
    if (isFrozenBaselineActivity(activity, baselineByIdHash, `Alpaca activity ${index + 1}`)) continue;
    if (activity.activity_type !== "FILL") continue;
    const eventAt = canonicalBrokerInstant(activity.transaction_time, `Alpaca fill activity ${index + 1} time`);
    if (eventAt < contract.competition_window.start_at) {
      throw new Error("Alpaca pre-window fill invalidates the frozen competition baseline");
    }
    if (eventAt >= contract.competition_window.end_at) continue;
    const orderId = safeOrderId(activity.order_id, `Alpaca fill activity ${index + 1} order ID`);
    if (typeof activity.symbol !== "string" || !/^[A-Z0-9 ]{1,32}$/u.test(activity.symbol)
      || !new Set(["buy", "sell"]).has(activity.side)) {
      throw new Error(`Alpaca fill activity ${index + 1} semantics are invalid`);
    }
    const prior = expectations.get(orderId) ?? { earliest_fill_at: eventAt, fills: new Map() };
    if (eventAt < prior.earliest_fill_at) prior.earliest_fill_at = eventAt;
    const fillKey = `${activity.symbol}\u0000${activity.side}`;
    const priorFillAt = prior.fills.get(fillKey);
    if (priorFillAt === undefined || eventAt < priorFillAt) prior.fills.set(fillKey, eventAt);
    expectations.set(orderId, prior);
  }
  if (expectations.size > MAX_FILL_ORDER_PROOFS) {
    throw new Error("Alpaca fill-order proof count exceeds its safety bound");
  }
  return expectations;
}

export function listAlpacaInWindowFillOrderIds(pages, contract, baseline) {
  assertAlpacaActivityMappingMatchesContract(contract);
  assertCompetitionActivityBaseline(baseline, contract);
  return [...inWindowFillOrderExpectations(pages, contract, baseline).keys()].sort();
}

function expectedG4ClientOrderId(contract, symbol) {
  const target = G4_ORDER_PLAN.find((candidate) => candidate.symbol === symbol);
  if (target === undefined) throw new Error("Alpaca fill is outside the frozen G4 symbols");
  return `finly-g4-${sha256({
    protocol_hash: contract.production_protocol.protocol_hash,
    sequence: target.sequence,
    symbol: target.symbol,
    notional: target.notional,
  }).slice(-20)}`;
}

function expectedG4Target(symbol) {
  const target = G4_ORDER_PLAN.find((candidate) => candidate.symbol === symbol);
  if (target === undefined) throw new Error("Alpaca fill is outside the frozen G4 symbols");
  return target;
}

function parseSpyOccSymbol(symbol) {
  const match = typeof symbol === "string" ? /^SPY(\d{6})([CP])(\d{8})$/u.exec(symbol) : null;
  if (match === null) return null;
  const [, date, right, strikeDigits] = match;
  const year = Number(date.slice(0, 2)) + 2000;
  const month = Number(date.slice(2, 4));
  const day = Number(date.slice(4, 6));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    return null;
  }
  return { expiry: date, right, strike: Number(strikeDigits) };
}

function expectedFillPairs(expectation) {
  return new Set([...expectation.fills.keys()]);
}

function assertSimpleG4OrderProof(order, expectation, contract) {
  const pairs = expectedFillPairs(expectation);
  const target = expectedG4Target(order.symbol);
  if (pairs.size !== 1 || !pairs.has(`${order.symbol}\u0000${order.side}`)
    || order.asset_class !== "us_equity" || order.side !== "buy"
    || order.type !== "market" || order.time_in_force !== "day"
    || !new Set(["", "simple"]).has(order.order_class)
    || order.extended_hours !== false
    || order.qty !== null || order.legs !== null
    || parseDecimal(order.notional, "Alpaca G4 order notional").toFixed(2) !== target.notional
    || order.client_order_id !== expectedG4ClientOrderId(contract, order.symbol)) {
    throw new Error("Alpaca equity fill-order proof is outside the frozen G4 plan");
  }
}

function assertMlegOptionOrderProof(order, expectation) {
  const closing = order.client_order_id?.startsWith("finly-exit-") === true;
  if (order.asset_class !== "" || order.order_class !== "mleg"
    || order.type !== "limit" || order.time_in_force !== "day"
    || order.extended_hours !== false
    || typeof order.qty !== "string" || !/^[1-4]$/u.test(order.qty)
    || order.symbol !== "" || order.side !== "" || order.notional !== null
    || typeof order.limit_price !== "string" || parseDecimal(order.limit_price, "Alpaca option limit price") === 0
    || !/^finly-(?:exit-)?[a-f0-9]{20}$/u.test(order.client_order_id)
    || !Array.isArray(order.legs) || order.legs.length !== 2) {
    throw new Error("Alpaca option fill-order proof is outside the frozen Finly spread policy");
  }
  const legPairs = new Set();
  const optionSeries = [];
  for (const leg of order.legs) {
    const option = parseSpyOccSymbol(leg?.symbol);
    if (!leg || typeof leg !== "object" || Array.isArray(leg)
      || leg.asset_class !== "us_option" || option === null
      || !new Set(["buy", "sell"]).has(leg.side)
      || leg.extended_hours !== false || leg.order_class !== "mleg"
      || leg.time_in_force !== "day" || leg.type !== ""
      || leg.ratio_qty !== "1" || leg.qty !== order.qty
      || leg.replaces !== null || leg.replaced_by !== null
      || (closing && !new Set(["sell_to_close", "buy_to_close"]).has(leg.position_intent))
      || (!closing && !new Set(["buy_to_open", "sell_to_open"]).has(leg.position_intent))
      || (leg.side === "buy" && !new Set(["buy_to_open", "buy_to_close"]).has(leg.position_intent))
      || (leg.side === "sell" && !new Set(["sell_to_open", "sell_to_close"]).has(leg.position_intent))) {
      throw new Error("Alpaca option fill-order proof contains an invalid SPY leg");
    }
    optionSeries.push(option);
    legPairs.add(`${leg.symbol}\u0000${leg.side}`);
  }
  if (legPairs.size !== 2 || optionSeries[0].expiry !== optionSeries[1].expiry
    || optionSeries[0].right !== optionSeries[1].right
    || optionSeries[0].strike === optionSeries[1].strike
    || new Set(order.legs.map(({ side }) => side)).size !== 2
    || [...expectedFillPairs(expectation)].some((pair) => !legPairs.has(pair))) {
    throw new Error("Alpaca option fills do not match the frozen Finly spread legs");
  }
}

function normalizeFillOrderProofs(rawOrders, expectations, contract, observedAt) {
  if (!Array.isArray(rawOrders) || rawOrders.length > MAX_FILL_ORDER_PROOFS) {
    throw new Error("Alpaca fill-order proofs are invalid");
  }
  const byId = new Map();
  for (let index = 0; index < rawOrders.length; index += 1) {
    const order = rawOrders[index];
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      throw new Error(`Alpaca fill-order proof ${index + 1} is invalid`);
    }
    const orderId = safeOrderId(order.id, `Alpaca fill-order proof ${index + 1} ID`);
    if (byId.has(orderId)) throw new Error("Alpaca fill-order proof ID is duplicated");
    const expectation = expectations.get(orderId);
    if (expectation === undefined) throw new Error("Alpaca fill-order proof is not required by an observed fill");
    const createdAt = canonicalBrokerInstant(order.created_at, `Alpaca fill-order proof ${index + 1} creation time`);
    const submittedAt = canonicalBrokerInstant(
      order.submitted_at, `Alpaca fill-order proof ${index + 1} submission time`,
    );
    if (createdAt < contract.competition_window.start_at
      || submittedAt < contract.competition_window.start_at
      || createdAt > expectation.earliest_fill_at
      || submittedAt > expectation.earliest_fill_at
      || createdAt > observedAt || submittedAt > observedAt
      || order.replaces !== null || order.replaced_by !== null) {
      throw new Error("Alpaca fill-order proof is outside the frozen G4 order plan");
    }
    if (order.order_class === "mleg") assertMlegOptionOrderProof(order, expectation);
    else assertSimpleG4OrderProof(order, expectation, contract);
    byId.set(orderId, true);
  }
  if (byId.size !== expectations.size) throw new Error("Alpaca fill-order proof is missing");
}

function normalizeActivityPages(
  pages, fillOrderProofs, contract, baseline, observedAt, activityCoverageThrough,
  accountCurrency, activityCreationBoundsVerified,
) {
  const rawActivities = flattenActivityPages(pages);
  const baselineByIdHash = baselineActivityPayloads(baseline);
  const fillOrderExpectations = inWindowFillOrderExpectations(pages, contract, baseline);
  normalizeFillOrderProofs(fillOrderProofs, fillOrderExpectations, contract, observedAt);
  const normalized = [];
  for (let index = 0; index < rawActivities.length; index += 1) {
    const activity = rawActivities[index];
    if (isFrozenBaselineActivity(activity, baselineByIdHash, `Alpaca activity ${index + 1}`)) continue;
    const activityType = activity.activity_type;
    if (typeof activityType !== "string" || !/^[A-Z]{2,8}$/u.test(activityType)) {
      throw new Error(`Alpaca activity ${index + 1} type is invalid`);
    }
    let normalizedActivity;
    if (activityType === "FILL") {
      for (const key of ["cum_qty", "leaves_qty", "order_id", "price", "qty", "side", "symbol", "transaction_time", "type"]) {
        if (!(key in activity)) throw new Error(`Alpaca fill activity ${index + 1} is incomplete`);
      }
      const eventAt = canonicalBrokerInstant(activity.transaction_time, `Alpaca fill activity ${index + 1} time`);
      if (eventAt < contract.competition_window.start_at) {
        throw new Error("Alpaca pre-window fill invalidates the frozen competition baseline");
      }
      if (eventAt >= contract.competition_window.end_at) continue;
      if (!new Set(["fill", "partial_fill"]).has(activity.type)
        || !new Set(["buy", "sell"]).has(activity.side)
        || typeof activity.symbol !== "string" || !/^[A-Z0-9 ]{1,32}$/u.test(activity.symbol)) {
        throw new Error(`Alpaca fill activity ${index + 1} semantics are invalid`);
      }
      safeOrderId(activity.order_id, `Alpaca fill activity ${index + 1} order ID`);
      parseDecimal(activity.cum_qty, `Alpaca fill activity ${index + 1} cumulative quantity`);
      parseDecimal(activity.leaves_qty, `Alpaca fill activity ${index + 1} leaves quantity`);
      if (parseDecimal(activity.price, `Alpaca fill activity ${index + 1} price`) <= 0
        || parseDecimal(activity.qty, `Alpaca fill activity ${index + 1} quantity`) <= 0) {
        throw new Error(`Alpaca fill activity ${index + 1} quantity or price is invalid`);
      }
      normalizedActivity = {
        kind: "FILL", event_at: eventAt, time_basis: "EXECUTION", effective_date: null, net_amount: null,
      };
    } else {
      const hasCreatedAt = activity.created_at !== undefined && activity.created_at !== null;
      const eventAt = hasCreatedAt
        ? canonicalBrokerInstant(activity.created_at, `Alpaca nontrade activity ${index + 1} creation time`)
        : activityCoverageThrough;
      const effectiveDate = exactDate(activity.date, `Alpaca nontrade activity ${index + 1} date`);
      if ((!hasCreatedAt && activityCreationBoundsVerified !== true)
        || eventAt < contract.competition_window.start_at
        || effectiveDate < contract.competition_window.start_at.slice(0, 10)) {
        throw new Error("Alpaca pre-window activity invalidates the frozen competition baseline");
      }
      let kind = activity.status === undefined || activity.status === "executed"
        ? classifyNontradeActivity(activityType)
        : "UNKNOWN";
      let netAmount = null;
      if (accountCurrency === "USD" && (activity.currency === undefined || activity.currency === "USD")) {
        if (activity.net_amount !== undefined && activity.net_amount !== null) {
          netAmount = parseDecimal(activity.net_amount, `Alpaca nontrade activity ${index + 1} net amount`);
        }
      } else {
        kind = "UNKNOWN";
      }
      if (kind === "FEE" && netAmount === null) kind = "UNKNOWN";
      if (kind === "ENDOGENOUS"
        && (effectiveDate < contract.competition_window.start_at.slice(0, 10)
          || effectiveDate > contract.competition_window.end_at.slice(0, 10))) continue;
      normalizedActivity = {
        kind, event_at: eventAt, time_basis: "PUBLICATION", effective_date: effectiveDate, net_amount: netAmount,
      };
    }
    if (Date.parse(normalizedActivity.event_at) > Date.parse(observedAt)) {
      throw new Error(`Alpaca activity ${index + 1} is in the future`);
    }
    normalized.push(normalizedActivity);
  }
  return normalized;
}

export function normalizeAlpacaForwardProfitEvidence({
  contract, activityBaseline, observedAt, maximumValuedAt, activityCoverageThrough, marketCalendar,
  portfolioHistory, activityPages, fillOrderProofs, spyBarPages, accountCurrency,
  activityCreationBoundsVerified = false, boundedActivitySnapshotStable = true,
}) {
  assertAlpacaActivityMappingMatchesContract(contract);
  assertCompetitionActivityBaseline(activityBaseline, contract);
  const normalizedObservedAt = exactObservedInstant(observedAt, "Alpaca measurement observation time");
  const normalizedMaximum = exactObservedInstant(maximumValuedAt, "Alpaca maximum valuation time");
  const normalizedCoverage = exactObservedInstant(activityCoverageThrough, "Alpaca activity coverage time");
  if (Date.parse(normalizedMaximum) > Date.parse(normalizedObservedAt)
    || Date.parse(normalizedCoverage) > Date.parse(normalizedObservedAt)) {
    throw new Error("Alpaca evidence boundary exceeds its observation time");
  }
  const sessions = normalizeCalendar(marketCalendar);
  const accountPoints = normalizePortfolioHistory(portfolioHistory, contract, normalizedMaximum, sessions);
  if (accountCurrency !== "USD") throw new Error("Alpaca account currency is not USD");
  const activities = normalizeActivityPages(
    activityPages, fillOrderProofs, contract, activityBaseline, normalizedObservedAt,
    normalizedCoverage, accountCurrency, activityCreationBoundsVerified,
  );
  const { spyAnchor, spyPoints } = normalizeSpyBarPages(spyBarPages, contract, normalizedMaximum, sessions);
  return buildCompetitionForwardProfitMeasurement({
    contract,
    observedAt: normalizedObservedAt,
    activityCoverageThrough: normalizedCoverage,
    accountPoints,
    spyAnchor,
    spyPoints,
    activities,
    activityCompleteness: {
      pagination_exhausted: true,
      bounded_snapshot_stable: boundedActivitySnapshotStable,
      all_rows_classified: activities.every(({ kind }) => kind !== "UNKNOWN"),
      economic_activity_final: false,
    },
  });
}

function emptyMeasurement(contract, observedAt) {
  return buildCompetitionForwardProfitMeasurement({
    contract,
    observedAt,
    activityCoverageThrough: observedAt,
    accountPoints: [],
    spyAnchor: null,
    spyPoints: [],
    activities: [],
    activityCompleteness: {
      pagination_exhausted: true,
      bounded_snapshot_stable: true,
      all_rows_classified: true,
      economic_activity_final: false,
    },
  });
}

function safeMeasurementBounds(contract, pollStartedAt) {
  const startMs = Date.parse(contract.competition_window.start_at);
  const endMs = Date.parse(contract.competition_window.end_at);
  const commonValuedAtMs = Math.min(
    Math.floor(Date.parse(pollStartedAt) / WINDOW_DURATION_MS) * WINDOW_DURATION_MS - WINDOW_DURATION_MS,
    endMs - WINDOW_DURATION_MS,
  );
  const lastWindowStartMs = commonValuedAtMs - WINDOW_DURATION_MS;
  if (lastWindowStartMs < startMs) return null;
  return {
    commonValuedAt: new Date(commonValuedAtMs).toISOString(),
    lastWindowStartAt: new Date(lastWindowStartMs).toISOString(),
    activityUntilExclusive: Date.parse(pollStartedAt) >= endMs
      ? pollStartedAt
      : new Date(commonValuedAtMs + 1_000).toISOString(),
  };
}

export function buildAlpacaForwardProfitRequestPlan(contract, pollStartedAt) {
  assertAlpacaActivityMappingMatchesContract(contract);
  const observedAt = exactObservedInstant(pollStartedAt, "Alpaca request-plan observation time");
  const bounds = safeMeasurementBounds(contract, observedAt);
  if (bounds === null) return null;
  return Object.freeze({
    observed_at: observedAt,
    maximum_valued_at: bounds.commonValuedAt,
    activity_coverage_through: new Date(Date.parse(bounds.activityUntilExclusive) - 1).toISOString(),
    calendar: Object.freeze({
      path: "/v2/calendar",
      query: Object.freeze({
        start: contract.competition_window.start_at.slice(0, 10),
        end: contract.competition_window.end_at.slice(0, 10),
        date_type: "TRADING",
      }),
    }),
    pre_window_order_guard: Object.freeze({
      path: "/v2/orders",
      query: Object.freeze({
        status: "all",
        until: contract.competition_window.start_at,
        direction: "desc",
        limit: "1",
        nested: "false",
      }),
    }),
    portfolio: Object.freeze({
      path: "/v2/account/portfolio/history",
      query: Object.freeze({
        start: contract.competition_window.start_at,
        end: bounds.lastWindowStartAt,
        timeframe: "1Min",
        intraday_reporting: "market_hours",
        pnl_reset: "no_reset",
        cashflow_types: "ALL",
      }),
    }),
    activity_baseline_recheck: Object.freeze({
      path: "/v2/account/activities",
      query: Object.freeze({
        until: bounds.activityUntilExclusive,
        direction: "asc",
        page_size: String(ACTIVITY_PAGE_SIZE),
      }),
    }),
    activities: Object.freeze({
      path: "/v2/account/activities",
      query: Object.freeze({
        after: new Date(Date.parse(contract.competition_window.start_at) - 1).toISOString(),
        until: bounds.activityUntilExclusive,
        direction: "asc",
        page_size: String(ACTIVITY_PAGE_SIZE),
      }),
    }),
    spy: Object.freeze({
      path: "/v2/stocks/SPY/bars",
      query: Object.freeze({
        timeframe: "1Min",
        start: contract.competition_window.start_at,
        end: bounds.lastWindowStartAt,
        adjustment: "raw",
        feed: "iex",
        sort: "asc",
        limit: String(BAR_PAGE_SIZE),
        currency: "USD",
      }),
    }),
  });
}

export async function collectAlpacaActivityPages(readPage) {
  if (typeof readPage !== "function") throw new Error("Alpaca activity page reader is invalid");
  const pages = [];
  const seenTokens = new Set();
  let pageToken = null;
  for (let page = 0; page < MAX_ACTIVITY_PAGES; page += 1) {
    const items = await readPage(pageToken);
    if (!Array.isArray(items) || items.length > ACTIVITY_PAGE_SIZE) {
      throw new Error("Alpaca activity page is invalid");
    }
    pages.push({ request_page_token: pageToken, items });
    if (items.length === 0) return pages;
    const nextToken = safeActivityId(items.at(-1)?.id, "Alpaca activity continuation ID");
    if (seenTokens.has(nextToken)) throw new Error("Alpaca activity pagination token repeated");
    seenTokens.add(nextToken);
    pageToken = nextToken;
  }
  throw new Error("Alpaca activity pagination exceeded its safety bound");
}

export class AlpacaForwardProfitReadClient {
  #tradingBase;
  #dataBase;
  #fetchImpl;
  #expectedAccountId;
  #headers;
  #now;

  constructor({
    keyId, secretKey, expectedAccountId, tradingBase = PAPER_ORIGIN, dataBase = DATA_ORIGIN,
    fetchImpl = fetch, now = () => new Date(),
  }) {
    if (typeof keyId !== "string" || keyId.length < 8 || hasControlOrWhitespace(keyId)) {
      throw new Error("missing Alpaca paper key ID");
    }
    if (typeof secretKey !== "string" || secretKey.length < 12 || hasControlOrWhitespace(secretKey)) {
      throw new Error("missing Alpaca paper secret key");
    }
    if (typeof expectedAccountId !== "string" || expectedAccountId.length < 6
      || expectedAccountId.length > 128 || /[^\x21-\x7e]/u.test(expectedAccountId)) {
      throw new Error("missing expected Alpaca paper account ID");
    }
    if (typeof fetchImpl !== "function" || typeof now !== "function") {
      throw new Error("Alpaca forward-profit transport or clock is invalid");
    }
    this.#tradingBase = exactOrigin(tradingBase, PAPER_ORIGIN, "Alpaca paper");
    this.#dataBase = exactOrigin(dataBase, DATA_ORIGIN, "Alpaca data");
    this.#fetchImpl = fetchImpl;
    this.#expectedAccountId = expectedAccountId;
    this.#now = now;
    this.#headers = Object.freeze({
      "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey, accept: "application/json",
    });
  }

  async measure({ contract, activityBaseline }) {
    assertAlpacaActivityMappingMatchesContract(contract);
    assertCompetitionActivityBaseline(activityBaseline, contract);
    const pollStartedAt = clockInstant(this.#now(), "Alpaca measurement clock");
    if (Date.parse(pollStartedAt) < Date.parse(contract.competition_window.start_at)) {
      return emptyMeasurement(contract, pollStartedAt);
    }
    const account = await this.#get(this.#tradingBase, "/v2/account");
    if (account?.account_number !== this.#expectedAccountId || account?.status !== "ACTIVE"
      || account?.currency !== "USD"
      || account?.trading_blocked !== false || account?.account_blocked !== false
      || account?.trade_suspended_by_user !== false
      || sha256(`finly-forward-profit-account-uuid-v1:${account?.id}`) !== activityBaseline.account_id_hash) {
      throw new Error("Alpaca forward-profit account verification failed");
    }
    const plan = buildAlpacaForwardProfitRequestPlan(contract, pollStartedAt);
    if (plan === null) return emptyMeasurement(contract, pollStartedAt);
    const preWindowOrders = await this.#get(
      this.#tradingBase, plan.pre_window_order_guard.path, plan.pre_window_order_guard.query,
    );
    assertAlpacaPreWindowOrderGuard(preWindowOrders, activityBaseline, contract);
    const marketCalendar = await this.#get(this.#tradingBase, plan.calendar.path, plan.calendar.query);
    const portfolioHistory = await this.#get(this.#tradingBase, plan.portfolio.path, plan.portfolio.query);
    const firstUnfilteredActivityPages = await this.#collectActivityPages(plan.activity_baseline_recheck.query);
    const secondUnfilteredActivityPages = await this.#collectActivityPages(plan.activity_baseline_recheck.query);
    assertAlpacaActivitySnapshotCoversBaseline(firstUnfilteredActivityPages, activityBaseline);
    assertAlpacaActivitySnapshotCoversBaseline(secondUnfilteredActivityPages, activityBaseline);
    const firstActivityPages = await this.#collectActivityPages(plan.activities.query);
    const secondActivityPages = await this.#collectActivityPages(plan.activities.query);
    assertAlpacaScopedActivitySnapshotMatchesUnfiltered(
      firstActivityPages, firstUnfilteredActivityPages, activityBaseline,
    );
    assertAlpacaScopedActivitySnapshotMatchesUnfiltered(
      secondActivityPages, secondUnfilteredActivityPages, activityBaseline,
    );
    const boundedActivitySnapshotStable =
      stableStringify(firstUnfilteredActivityPages) === stableStringify(secondUnfilteredActivityPages)
      && stableStringify(firstActivityPages) === stableStringify(secondActivityPages);
    const fillOrderProofs = await Promise.all(
      listAlpacaInWindowFillOrderIds(firstActivityPages, contract, activityBaseline)
        .map((orderId) => this.#get(this.#tradingBase, `/v2/orders/${orderId}`, { nested: "true" })),
    );
    const spyBarPages = await this.#collectSpyBarPages(
      plan.spy.query.start, plan.spy.query.end,
    );
    return normalizeAlpacaForwardProfitEvidence({
      contract, activityBaseline, observedAt: pollStartedAt, maximumValuedAt: plan.maximum_valued_at,
      activityCoverageThrough: plan.activity_coverage_through,
      marketCalendar, portfolioHistory,
      activityPages: firstActivityPages, fillOrderProofs, spyBarPages, accountCurrency: account.currency,
      activityCreationBoundsVerified: true, boundedActivitySnapshotStable,
    });
  }

  async #collectActivityPages(query) {
    return collectAlpacaActivityPages((pageToken) => this.#get(
      this.#tradingBase,
      "/v2/account/activities",
      { ...query, page_token: pageToken },
    ));
  }

  async #collectSpyBarPages(start, end) {
    const pages = [];
    const seenTokens = new Set();
    let pageToken = null;
    for (let page = 0; page < MAX_BAR_PAGES; page += 1) {
      const response = await this.#get(this.#dataBase, "/v2/stocks/SPY/bars", {
        timeframe: "1Min", start, end, adjustment: "raw", feed: "iex", sort: "asc",
        limit: String(BAR_PAGE_SIZE), currency: "USD", page_token: pageToken,
      });
      pages.push({ request_page_token: pageToken, response });
      const nextToken = response?.next_page_token;
      if (nextToken === null) return pages;
      safeToken(nextToken, "Alpaca SPY continuation token");
      if (!Array.isArray(response?.bars) || response.bars.length === 0 || seenTokens.has(nextToken)) {
        throw new Error("Alpaca SPY pagination token is empty-page or repeated");
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }
    throw new Error("Alpaca SPY pagination exceeded its safety bound");
  }

  async #get(origin, path, query = {}) {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("invalid Alpaca read path");
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error("Alpaca forward-profit request escaped its allowlist");
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, value);
    }
    let response;
    try {
      response = await this.#fetchImpl(url, { method: "GET", headers: this.#headers, redirect: "error" });
    } catch {
      throw new Error("Alpaca forward-profit read transport failed");
    }
    if (!response || response.ok !== true || response.status !== 200) {
      throw new Error(`Alpaca forward-profit read failed with HTTP ${response?.status ?? "unknown"}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Alpaca forward-profit read returned invalid JSON");
    }
  }
}

export function alpacaForwardProfitCredentialsFromEnv(environment = process.env) {
  return {
    keyId: environment.APCA_API_KEY_ID ?? environment.ALPACA_API_KEY,
    secretKey: environment.APCA_API_SECRET_KEY ?? environment.ALPACA_SECRET_KEY,
    expectedAccountId: environment.FINLY_COMPETITION_ACCOUNT_ID,
  };
}
