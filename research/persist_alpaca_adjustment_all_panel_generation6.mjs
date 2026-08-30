import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  readdir,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { round, sha256 } from "./champion_engine.mjs";
import { CORE_SYMBOLS } from "./champion_strategies.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const DATA_ORIGIN = "https://data.alpaca.markets";
const DATA_PATH = "/v2/stocks/bars";
const MAX_REMOTE_PAGES = 100;
const ADJUSTMENT_SEMANTICS = "forward/reverse splits, cash dividends, and spin-offs";
const PANEL_FILENAME_PATTERN = /^alpaca_adjustment_all_panel_generation6_[0-9a-f]{64}\.json$/;

export const GENERATION6_ALPACA_PANEL_PROTOCOL_PATH =
  "research/alpaca_adjustment_all_panel_generation6_protocol.json";
export const GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH =
  "research/alpaca_adjustment_all_panel_generation6_freeze_receipt.json";
export const GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH =
  "research/alpaca_adjustment_all_panel_generation6_run_claim.json";
export const GENERATION6_ALPACA_PANEL_RESULT_RECEIPT_PATH =
  "research/alpaca_adjustment_all_panel_generation6_result_receipt.json";

export const GENERATION6_ALPACA_PANEL_REQUEST = deepFreeze({
  symbols: [...CORE_SYMBOLS],
  start: "2007-05-30",
  end: "2026-08-27",
  feed: "iex",
  adjustment: "all",
  timeframe: "1Day",
  asof: "2026-08-27",
  currency: "USD",
  sort: "asc",
  limit: 10_000,
  minimum_common_sessions: 1_250,
});

export const GENERATION6_ALPACA_PANEL_SECURITY = Object.freeze({
  method: "GET",
  credentials_persisted: false,
  raw_responses_persisted: false,
  request_headers_persisted: false,
  page_tokens_persisted: false,
});

export const GENERATION6_ALPACA_PANEL_UNIVERSE_BOUNDARY = Object.freeze({
  universe_as_of: "2026-08-27",
  construction: "Fixed 20-ETF CORE_SYMBOLS menu selected before this authenticated acquisition.",
  point_in_time_membership_dataset: false,
  delisted_or_failed_funds_included: false,
  survivorship_bias_present: true,
  permitted_use: "Cross-provider reconciliation and sensitivity analysis on the disclosed fixed ETF menu.",
  forbidden_inference: "The panel is not evidence for a survivorship-free investable universe or an unbiased historical asset-selection process.",
});

export const GENERATION6_ALPACA_PANEL_OUTPUT_CONTRACT = Object.freeze({
  panel_schema_version: "finly_generation6_alpaca_adjustment_all_panel.v2",
  run_claim_path: GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH,
  result_receipt_path: GENERATION6_ALPACA_PANEL_RESULT_RECEIPT_PATH,
  private_panel_directory: "data/private/champion_search",
  panel_filename_prefix: "alpaca_adjustment_all_panel_generation6_",
});

export const GENERATION6_ALPACA_PANEL_REQUIRED_FREEZE_FILES = Object.freeze([
  GENERATION6_ALPACA_PANEL_PROTOCOL_PATH,
  "research/persist_alpaca_adjustment_all_panel_generation6.mjs",
  "research/champion_engine.mjs",
  "research/champion_strategies.mjs",
  "tests/alpaca_adjustment_all_panel_generation6.test.mjs",
]);

const PROTOCOL_KEYS = Object.freeze([
  "schema_version",
  "status",
  "frozen_at",
  "execution_status_at_freeze",
  "request",
  "security",
  "universe_boundary",
  "output_contract",
]);
const EXECUTION_STATUS_KEYS = Object.freeze([
  "authenticated_read_started",
  "run_claim_absent",
  "result_receipt_absent",
  "panel_artifacts_absent",
]);
const REQUEST_KEYS = Object.freeze(Object.keys(GENERATION6_ALPACA_PANEL_REQUEST));
const SECURITY_KEYS = Object.freeze(Object.keys(GENERATION6_ALPACA_PANEL_SECURITY));
const UNIVERSE_KEYS = Object.freeze(Object.keys(GENERATION6_ALPACA_PANEL_UNIVERSE_BOUNDARY));
const OUTPUT_CONTRACT_KEYS = Object.freeze(Object.keys(GENERATION6_ALPACA_PANEL_OUTPUT_CONTRACT));
const PROVENANCE_KEYS = Object.freeze([
  "provider",
  "origin",
  "path",
  "request",
  "page_count",
  "response_content_sha256",
  "adjustment_semantics",
  "security",
]);
const PANEL_KEYS = Object.freeze([
  "schema_version",
  "generated_at",
  "provider",
  "origin",
  "path",
  "request",
  "page_count",
  "response_content_sha256",
  "adjustment_semantics",
  "security",
  "symbols",
  "universe_boundary",
  "series_by_symbol",
  "series_integrity_by_symbol",
  "missing_date_diagnostics",
  "strategy_intersection",
  "claim_boundary",
]);
const RUN_CLAIM_KEYS = Object.freeze([
  "schema_version",
  "status",
  "claimed_at",
  "protocol_sha256",
  "freeze_receipt_sha256",
  "request",
  "request_sha256",
  "security",
]);
const RESULT_RECEIPT_KEYS = Object.freeze([
  "schema_version",
  "authenticated_read_started_at",
  "authenticated_read_completed_at",
  "protocol_sha256",
  "freeze_receipt_sha256",
  "run_claim_sha256",
  "request",
  "request_sha256",
  "response_content_sha256",
  "panel",
  "security",
  "universe_boundary",
  "claim_boundary",
]);
const RESULT_PANEL_KEYS = Object.freeze([
  "path",
  "payload_sha256",
  "schema_version",
  "series_integrity_sha256",
  "strategy_intersection_normalized_panel_sha256",
  "strategy_intersection_observations",
  "strategy_intersection_start_date",
  "strategy_intersection_end_date",
]);
const SAFE_CREDENTIAL_DECLARATION_KEYS = new Set([
  "credentials_persisted",
  "page_tokens_persisted",
]);
const FORBIDDEN_CREDENTIAL_KEY = /api.?key|secret|authorization|password|bearer|access.?token|refresh.?token/i;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sha256Bytes(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function orderedEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function hasExactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && orderedEqual(Object.keys(value).sort(), [...expected].sort());
}

function forbiddenCredentialKeyPaths(value, path = "protocol", found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_CREDENTIAL_KEY.test(key) && !SAFE_CREDENTIAL_DECLARATION_KEYS.has(key)) {
      found.push(childPath);
    }
    forbiddenCredentialKeyPaths(child, childPath, found);
  }
  return found;
}

function assertDate(value, label) {
  invariant(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    `${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  invariant(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
    `${label} is invalid`);
  return value;
}

function assertCanonicalTimestamp(value, label) {
  invariant(typeof value === "string" && Number.isFinite(Date.parse(value)),
    `${label} must be a timestamp`);
  invariant(new Date(value).toISOString() === value, `${label} must be canonical UTC ISO-8601`);
  return value;
}

function safeRequestProjection(request) {
  invariant(hasExactKeys(request, REQUEST_KEYS), "Alpaca request has missing or unsupported fields");
  invariant(sameJson(request, GENERATION6_ALPACA_PANEL_REQUEST),
    "Alpaca request differs from the frozen Generation 6 request");
  return deepFreeze({
    symbols: [...request.symbols],
    start: request.start,
    end: request.end,
    feed: request.feed,
    adjustment: request.adjustment,
    timeframe: request.timeframe,
    asof: request.asof,
    currency: request.currency,
    sort: request.sort,
    limit: request.limit,
    minimum_common_sessions: request.minimum_common_sessions,
  });
}

function validateNormalizedSeries(symbol, series, request) {
  invariant(CORE_SYMBOLS.includes(symbol), `unexpected panel symbol ${symbol}`);
  invariant(Array.isArray(series) && series.length > 0, `${symbol} series is empty`);
  let prior = "";
  for (const [index, point] of series.entries()) {
    invariant(hasExactKeys(point, ["date", "close"]), `${symbol} row ${index} shape is invalid`);
    assertDate(point.date, `${symbol} row ${index} date`);
    invariant(point.date > prior, `${symbol} dates are duplicated or out of order`);
    invariant(point.date >= request.start && point.date <= request.end,
      `${symbol} row ${index} date is outside the frozen request`);
    invariant(Number.isFinite(point.close) && point.close > 0,
      `${symbol} row ${index} close is invalid`);
    prior = point.date;
  }
  return series;
}

function normalizedSeriesIntegrity(series) {
  return Object.freeze({
    observations: series.length,
    start_date: series[0].date,
    end_date: series.at(-1).date,
    date_sha256: sha256(series.map((point) => point.date)),
    series_sha256: sha256(series.map((point) => [point.date, round(point.close, 10)])),
  });
}

function normalizeAlpacaBars(symbol, bars, request) {
  invariant(Array.isArray(bars) && bars.length > 0, `${symbol} Alpaca bars are empty`);
  const series = bars.map((bar, index) => {
    invariant(bar && typeof bar === "object" && !Array.isArray(bar),
      `${symbol} Alpaca bar ${index} is invalid`);
    invariant(typeof bar.t === "string", `${symbol} Alpaca bar ${index} timestamp is invalid`);
    const timestamp = new Date(bar.t);
    invariant(Number.isFinite(timestamp.getTime()), `${symbol} Alpaca bar ${index} timestamp is invalid`);
    const close = Number(bar.c);
    invariant(Number.isFinite(close) && close > 0, `${symbol} Alpaca bar ${index} close is invalid`);
    return Object.freeze({ date: timestamp.toISOString().slice(0, 10), close });
  });
  validateNormalizedSeries(symbol, series, request);
  return Object.freeze(series);
}

export class AlpacaGeneration6PanelClient {
  #fetchImpl;
  #headers;
  #maxPages;

  constructor({ keyId, secretKey, fetchImpl = globalThis.fetch, maxPages = MAX_REMOTE_PAGES } = {}) {
    invariant(typeof keyId === "string" && keyId.length >= 8, "missing Alpaca key ID");
    invariant(typeof secretKey === "string" && secretKey.length >= 12, "missing Alpaca secret key");
    invariant(typeof fetchImpl === "function", "Alpaca fetch implementation is required");
    invariant(Number.isSafeInteger(maxPages) && maxPages >= 1 && maxPages <= MAX_REMOTE_PAGES,
      "Alpaca maximum page count is invalid");
    this.#fetchImpl = fetchImpl;
    this.#maxPages = maxPages;
    this.#headers = Object.freeze({
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey,
      accept: "application/json",
    });
  }

  async getDailyBars(request = GENERATION6_ALPACA_PANEL_REQUEST) {
    const safeRequest = safeRequestProjection(request);
    const barsBySymbol = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, []]));
    const responseBodies = [];
    const seenTokens = new Set();
    let pageToken;
    let pageCount = 0;
    while (true) {
      invariant(pageCount < this.#maxPages,
        "Alpaca pagination exceeded the fail-closed safety limit");
      const url = new URL(DATA_PATH, DATA_ORIGIN);
      url.searchParams.set("symbols", safeRequest.symbols.join(","));
      url.searchParams.set("timeframe", safeRequest.timeframe);
      url.searchParams.set("start", safeRequest.start);
      url.searchParams.set("end", safeRequest.end);
      url.searchParams.set("adjustment", safeRequest.adjustment);
      url.searchParams.set("feed", safeRequest.feed);
      url.searchParams.set("asof", safeRequest.asof);
      url.searchParams.set("currency", safeRequest.currency);
      url.searchParams.set("sort", safeRequest.sort);
      url.searchParams.set("limit", String(safeRequest.limit));
      if (pageToken) url.searchParams.set("page_token", pageToken);
      invariant(url.origin === DATA_ORIGIN && url.pathname === DATA_PATH,
        "Alpaca request escaped the allowlisted endpoint");
      let response;
      try {
        response = await this.#fetchImpl(url, {
          method: "GET",
          redirect: "error",
          headers: this.#headers,
        });
      } catch {
        throw new Error("Alpaca Generation 6 panel transport failed");
      }
      invariant(response && typeof response.ok === "boolean", "Alpaca returned an invalid response");
      invariant(response.ok, `Alpaca Generation 6 panel read failed with HTTP ${response.status}`);
      let raw;
      try {
        raw = await response.text();
      } catch {
        throw new Error("Alpaca Generation 6 panel response-body read failed");
      }
      invariant(typeof raw === "string", "Alpaca response body is not text");
      responseBodies.push(raw);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error("Alpaca response was not valid JSON");
      }
      invariant(payload && typeof payload === "object" && !Array.isArray(payload)
        && payload.bars && typeof payload.bars === "object" && !Array.isArray(payload.bars),
      "Alpaca response has an invalid shape");
      for (const [symbol, bars] of Object.entries(payload.bars)) {
        invariant(CORE_SYMBOLS.includes(symbol) && Array.isArray(bars),
          "Alpaca response contains an unexpected symbol or bar shape");
        barsBySymbol[symbol].push(...bars);
      }
      pageCount += 1;
      const next = payload.next_page_token;
      if (next === null || next === undefined || next === "") break;
      invariant(typeof next === "string" && !seenTokens.has(next),
        "Alpaca pagination token is invalid or repeated");
      seenTokens.add(next);
      pageToken = next;
    }
    const seriesBySymbol = Object.freeze(Object.fromEntries(CORE_SYMBOLS.map((symbol) => [
      symbol,
      normalizeAlpacaBars(symbol, barsBySymbol[symbol], safeRequest),
    ])));
    return Object.freeze({
      series_by_symbol: seriesBySymbol,
      provenance: deepFreeze({
        provider: "Alpaca Market Data API",
        origin: DATA_ORIGIN,
        path: DATA_PATH,
        request: safeRequest,
        page_count: pageCount,
        response_content_sha256: sha256Bytes(responseBodies.join("\n--PAGE--\n")),
        adjustment_semantics: ADJUSTMENT_SEMANTICS,
        security: { ...GENERATION6_ALPACA_PANEL_SECURITY },
      }),
    });
  }
}

function credentialsFromEnvironment(environment) {
  const keyId = environment?.APCA_API_KEY_ID ?? environment?.ALPACA_API_KEY;
  const secretKey = environment?.APCA_API_SECRET_KEY ?? environment?.ALPACA_SECRET_KEY;
  return Object.freeze({ keyId, secretKey });
}

function validateProvenance(provenance) {
  invariant(hasExactKeys(provenance, PROVENANCE_KEYS),
    "Alpaca provenance has missing or unsupported fields");
  invariant(provenance.provider === "Alpaca Market Data API", "provider is not Alpaca");
  invariant(provenance.origin === DATA_ORIGIN, "data origin is not Alpaca");
  invariant(provenance.path === DATA_PATH, "data path is not the stock-bars endpoint");
  const request = safeRequestProjection(provenance.request);
  invariant(Number.isSafeInteger(provenance.page_count)
    && provenance.page_count >= 1 && provenance.page_count <= MAX_REMOTE_PAGES,
  "Alpaca provenance page_count is invalid");
  invariant(isSha256(provenance.response_content_sha256),
    "Alpaca provenance response_content_sha256 is invalid");
  invariant(provenance.adjustment_semantics === ADJUSTMENT_SEMANTICS,
    "Alpaca adjustment semantics differ from the frozen contract");
  invariant(hasExactKeys(provenance.security, SECURITY_KEYS)
    && sameJson(provenance.security, GENERATION6_ALPACA_PANEL_SECURITY),
  "Alpaca provenance security boundary differs");
  return request;
}

export function buildGeneration6AlpacaAdjustmentAllPanel(
  seriesBySymbol,
  provenance,
  { generatedAt } = {},
) {
  assertCanonicalTimestamp(generatedAt, "generatedAt");
  const request = validateProvenance(provenance);
  invariant(seriesBySymbol && typeof seriesBySymbol === "object" && !Array.isArray(seriesBySymbol),
    "seriesBySymbol is required");
  invariant(orderedEqual(Object.keys(seriesBySymbol), CORE_SYMBOLS),
    "seriesBySymbol keys must exactly follow CORE_SYMBOLS order");
  const preserved = Object.freeze(Object.fromEntries(CORE_SYMBOLS.map((symbol) => {
    validateNormalizedSeries(symbol, seriesBySymbol[symbol], request);
    return [symbol, Object.freeze(seriesBySymbol[symbol].map((point) => Object.freeze({
      date: point.date,
      close: point.close,
    })))];
  })));
  const seriesIntegrity = Object.freeze(Object.fromEntries(CORE_SYMBOLS.map((symbol) => [
    symbol,
    normalizedSeriesIntegrity(preserved[symbol]),
  ])));
  const dateSets = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [
    symbol,
    new Set(preserved[symbol].map((point) => point.date)),
  ]));
  const unionDates = [...new Set(CORE_SYMBOLS.flatMap((symbol) => (
    preserved[symbol].map((point) => point.date)
  )))].sort();
  const intersectionDates = unionDates.filter((date) => (
    CORE_SYMBOLS.every((symbol) => dateSets[symbol].has(date))
  ));
  invariant(intersectionDates.length >= request.minimum_common_sessions,
    `Alpaca all-adjusted panel has only ${intersectionDates.length} common sessions`);
  invariant(intersectionDates.at(-1) === request.end,
    "Alpaca strategy intersection does not reach the frozen request end date");
  const valueMaps = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [
    symbol,
    new Map(preserved[symbol].map((point) => [point.date, point.close])),
  ]));
  const intersectionPoints = Object.freeze(intersectionDates.map((date) => Object.freeze({
    date,
    ...Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, valueMaps[symbol].get(date)])),
  })));
  const normalizedPanelSha256 = sha256(intersectionPoints.map((point) => [
    point.date,
    ...CORE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
  ]));
  const missingBySymbol = Object.freeze(Object.fromEntries(CORE_SYMBOLS.map((symbol) => {
    const missingDates = Object.freeze(unionDates.filter((date) => !dateSets[symbol].has(date)));
    return [symbol, Object.freeze({
      missing_from_union_count: missingDates.length,
      missing_from_union_dates: missingDates,
      missing_from_union_dates_sha256: sha256(missingDates),
    })];
  })));
  const intersectionDateSet = new Set(intersectionDates);
  const datesExcludedFromIntersection = Object.freeze(unionDates.filter((date) => (
    !intersectionDateSet.has(date)
  )));
  return deepFreeze({
    schema_version: "finly_generation6_alpaca_adjustment_all_panel.v2",
    generated_at: generatedAt,
    provider: provenance.provider,
    origin: provenance.origin,
    path: provenance.path,
    request,
    page_count: provenance.page_count,
    response_content_sha256: provenance.response_content_sha256,
    adjustment_semantics: provenance.adjustment_semantics,
    security: { ...GENERATION6_ALPACA_PANEL_SECURITY },
    symbols: [...CORE_SYMBOLS],
    universe_boundary: { ...GENERATION6_ALPACA_PANEL_UNIVERSE_BOUNDARY },
    series_by_symbol: preserved,
    series_integrity_by_symbol: seriesIntegrity,
    missing_date_diagnostics: {
      union_observations: unionDates.length,
      union_date_sha256: sha256(unionDates),
      strategy_intersection_observations: intersectionDates.length,
      dates_excluded_from_strategy_intersection_count: datesExcludedFromIntersection.length,
      dates_excluded_from_strategy_intersection: datesExcludedFromIntersection,
      dates_excluded_from_strategy_intersection_sha256: sha256(datesExcludedFromIntersection),
      by_symbol: missingBySymbol,
    },
    strategy_intersection: {
      symbols: [...CORE_SYMBOLS],
      points: intersectionPoints,
      observations: intersectionPoints.length,
      start_date: intersectionPoints[0].date,
      end_date: intersectionPoints.at(-1).date,
      normalized_panel_sha256: normalizedPanelSha256,
    },
    claim_boundary: "Authenticated Alpaca IEX adjustment=all data are preserved per symbol and separately intersected for deterministic strategy simulation. The current-survivor ETF menu is not a point-in-time universe, an independent holdout, strategy P&L, or evidence of future profitability.",
  });
}

export function validateGeneration6AlpacaPanelProtocol(protocol) {
  const reasons = [];
  if (!hasExactKeys(protocol, PROTOCOL_KEYS)) reasons.push("protocol fields are incomplete or expanded");
  const forbidden = forbiddenCredentialKeyPaths(protocol);
  if (forbidden.length > 0) reasons.push(`protocol contains forbidden credential-like fields: ${forbidden.join(", ")}`);
  if (protocol?.schema_version !== "finly_generation6_alpaca_adjustment_all_panel_protocol.v2") {
    reasons.push("protocol schema mismatch");
  }
  if (protocol?.status !== "FROZEN_BEFORE_AUTHENTICATED_PANEL_READ") reasons.push("protocol status mismatch");
  try {
    assertCanonicalTimestamp(protocol?.frozen_at, "protocol frozen_at");
  } catch {
    reasons.push("protocol frozen_at is invalid");
  }
  if (!hasExactKeys(protocol?.execution_status_at_freeze, EXECUTION_STATUS_KEYS)
    || protocol?.execution_status_at_freeze?.authenticated_read_started !== false
    || protocol?.execution_status_at_freeze?.run_claim_absent !== true
    || protocol?.execution_status_at_freeze?.result_receipt_absent !== true
    || protocol?.execution_status_at_freeze?.panel_artifacts_absent !== true) {
    reasons.push("protocol execution status differs");
  }
  if (!hasExactKeys(protocol?.request, REQUEST_KEYS)
    || !sameJson(protocol?.request, GENERATION6_ALPACA_PANEL_REQUEST)) {
    reasons.push("protocol request differs");
  }
  if (!hasExactKeys(protocol?.security, SECURITY_KEYS)
    || !sameJson(protocol?.security, GENERATION6_ALPACA_PANEL_SECURITY)) {
    reasons.push("protocol security boundary differs");
  }
  if (!hasExactKeys(protocol?.universe_boundary, UNIVERSE_KEYS)
    || !sameJson(protocol?.universe_boundary, GENERATION6_ALPACA_PANEL_UNIVERSE_BOUNDARY)) {
    reasons.push("protocol survivorship boundary differs");
  }
  if (!hasExactKeys(protocol?.output_contract, OUTPUT_CONTRACT_KEYS)
    || !sameJson(protocol?.output_contract, GENERATION6_ALPACA_PANEL_OUTPUT_CONTRACT)) {
    reasons.push("protocol output contract differs");
  }
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function validateFreezeReceipt(receipt, protocolRaw, protocol) {
  const reasons = [];
  const requiredKeys = [
    "schema_version",
    "frozen_at",
    "frozen_before_authenticated_read",
    "authenticated_read_started_at_freeze",
    "run_claim_absent_at_freeze",
    "result_receipt_absent_at_freeze",
    "panel_artifacts_absent_at_freeze",
    "files",
  ];
  if (!hasExactKeys(receipt, requiredKeys)) reasons.push("freeze-receipt fields are incomplete or expanded");
  if (forbiddenCredentialKeyPaths(receipt, "freeze_receipt").length > 0) {
    reasons.push("freeze receipt contains forbidden credential-like fields");
  }
  if (receipt?.schema_version
    !== "finly_generation6_alpaca_adjustment_all_panel_freeze_receipt.v2") {
    reasons.push("freeze-receipt schema mismatch");
  }
  if (receipt?.frozen_at !== protocol?.frozen_at) reasons.push("freeze timestamp differs from protocol");
  if (receipt?.frozen_before_authenticated_read !== true
    || receipt?.authenticated_read_started_at_freeze !== false
    || receipt?.run_claim_absent_at_freeze !== true
    || receipt?.result_receipt_absent_at_freeze !== true
    || receipt?.panel_artifacts_absent_at_freeze !== true) reasons.push("freeze timing mismatch");
  if (receipt?.files?.[GENERATION6_ALPACA_PANEL_PROTOCOL_PATH] !== sha256Bytes(protocolRaw)) {
    reasons.push("freeze receipt does not bind the protocol");
  }
  if (!orderedEqual(
    Object.keys(receipt?.files ?? {}).sort(),
    [...GENERATION6_ALPACA_PANEL_REQUIRED_FREEZE_FILES].sort(),
  )) reasons.push("freeze manifest differs");
  return Object.freeze({ passes: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function acquisitionPaths(rootDirectory) {
  const root = resolve(rootDirectory);
  return Object.freeze({
    root,
    protocol: resolve(root, GENERATION6_ALPACA_PANEL_PROTOCOL_PATH),
    freezeReceipt: resolve(root, GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH),
    runClaim: resolve(root, GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH),
    resultReceipt: resolve(root, GENERATION6_ALPACA_PANEL_RESULT_RECEIPT_PATH),
    privateDirectory: resolve(root, "data/private/champion_search"),
    lock: resolve(root, "research/.alpaca_adjustment_all_panel_generation6.lock"),
  });
}

function safeProjectPath(root, relativePath, label) {
  invariant(typeof relativePath === "string" && relativePath.length > 0,
    `${label} path is invalid`);
  const absolute = resolve(root, relativePath);
  invariant(absolute.startsWith(`${root}${sep}`), `${label} path escapes the project root`);
  return absolute;
}

async function writeOnceOrVerify(path, payload, label) {
  invariant(Buffer.isBuffer(payload), `${label} payload must be a Buffer`);
  await mkdir(dirname(path), { recursive: true });
  const staged = `${path}.${process.pid}.${randomUUID()}.stage`;
  await writeFile(staged, payload, { flag: "wx", mode: 0o600 });
  try {
    try {
      await link(staged, path);
      return "created";
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const actual = await readFile(path);
      invariant(actual.equals(payload), `${label} already exists with different bytes`);
      return "verified_existing";
    }
  } finally {
    await unlink(staged).catch(() => {});
  }
}

async function withExclusiveDirectoryLock(path, callback) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Alpaca acquisition lock exists: ${path}`);
    throw error;
  }
  const ownerPath = resolve(path, "owner.json");
  try {
    await writeFile(ownerPath, `${JSON.stringify({
      schema_version: "finly_alpaca_acquisition_lock_owner.v1",
      pid: process.pid,
      hostname: hostname(),
      token: randomUUID(),
      started_at: new Date().toISOString(),
      recovery_instruction: "Audit the process, run claim, panel, and result receipt before removing a stale lock.",
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return await callback();
  } finally {
    await unlink(ownerPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await rmdir(path);
  }
}

async function readFrozenInputs(paths) {
  const [protocolRaw, receiptRaw] = await Promise.all([
    readFile(paths.protocol),
    readFile(paths.freezeReceipt),
  ]);
  const protocol = JSON.parse(protocolRaw.toString("utf8"));
  const receipt = JSON.parse(receiptRaw.toString("utf8"));
  const protocolValidation = validateGeneration6AlpacaPanelProtocol(protocol);
  invariant(protocolValidation.passes,
    `Alpaca-panel protocol validation failed: ${protocolValidation.reasons.join("; ")}`);
  const receiptValidation = validateFreezeReceipt(receipt, protocolRaw, protocol);
  invariant(receiptValidation.passes,
    `Alpaca-panel freeze validation failed: ${receiptValidation.reasons.join("; ")}`);
  for (const [relativePath, expectedHash] of Object.entries(receipt.files)) {
    invariant(isSha256(expectedHash), `invalid freeze hash for ${relativePath}`);
    const payload = await readFile(safeProjectPath(paths.root, relativePath, `freeze file ${relativePath}`));
    invariant(sha256Bytes(payload) === expectedHash, `freeze hash mismatch for ${relativePath}`);
  }
  return Object.freeze({ protocol, protocolRaw, receipt, receiptRaw });
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function matchingPanelNames(privateDirectory) {
  try {
    return (await readdir(privateDirectory)).filter((name) => PANEL_FILENAME_PATTERN.test(name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function panelFilename(payloadHash) {
  invariant(isSha256(payloadHash), "panel payload hash is invalid");
  return `alpaca_adjustment_all_panel_generation6_${payloadHash}.json`;
}

function validateRunClaim(claim, claimRaw, frozen) {
  invariant(hasExactKeys(claim, RUN_CLAIM_KEYS), "Alpaca run-claim fields are incomplete or expanded");
  invariant(forbiddenCredentialKeyPaths(claim, "run_claim").length === 0,
    "Alpaca run claim contains credential-like fields");
  invariant(claim.schema_version === "finly_generation6_alpaca_adjustment_all_panel_run_claim.v1",
    "Alpaca run-claim schema mismatch");
  invariant(claim.status === "CLAIMED_IMMEDIATELY_BEFORE_AUTHENTICATED_GET",
    "Alpaca run-claim status mismatch");
  assertCanonicalTimestamp(claim.claimed_at, "Alpaca run-claim claimed_at");
  invariant(claim.claimed_at >= frozen.protocol.frozen_at,
    "Alpaca run claim predates the freeze");
  invariant(claim.protocol_sha256 === sha256Bytes(frozen.protocolRaw),
    "Alpaca run claim protocol hash mismatch");
  invariant(claim.freeze_receipt_sha256 === sha256Bytes(frozen.receiptRaw),
    "Alpaca run claim freeze hash mismatch");
  invariant(hasExactKeys(claim.request, REQUEST_KEYS)
    && sameJson(claim.request, GENERATION6_ALPACA_PANEL_REQUEST),
  "Alpaca run-claim request mismatch");
  invariant(claim.request_sha256 === sha256(GENERATION6_ALPACA_PANEL_REQUEST),
    "Alpaca run-claim request hash mismatch");
  invariant(hasExactKeys(claim.security, SECURITY_KEYS)
    && sameJson(claim.security, GENERATION6_ALPACA_PANEL_SECURITY),
  "Alpaca run-claim security mismatch");
  return Object.freeze({ claim, claimRaw, claimSha256: sha256Bytes(claimRaw) });
}

function provenanceFromPanel(panel) {
  return {
    provider: panel.provider,
    origin: panel.origin,
    path: panel.path,
    request: panel.request,
    page_count: panel.page_count,
    response_content_sha256: panel.response_content_sha256,
    adjustment_semantics: panel.adjustment_semantics,
    security: panel.security,
  };
}

export function validateStoredGeneration6AlpacaPanel(panel) {
  invariant(hasExactKeys(panel, PANEL_KEYS), "persisted Alpaca panel fields are incomplete or expanded");
  invariant(forbiddenCredentialKeyPaths(panel, "panel").length === 0,
    "persisted Alpaca panel contains credential-like fields");
  invariant(panel.schema_version === "finly_generation6_alpaca_adjustment_all_panel.v2",
    "persisted Alpaca panel schema mismatch");
  invariant(orderedEqual(panel.symbols, CORE_SYMBOLS), "persisted Alpaca panel symbols differ");
  invariant(orderedEqual(Object.keys(panel.series_by_symbol ?? {}), CORE_SYMBOLS),
    "persisted Alpaca series registry differs");
  invariant(orderedEqual(Object.keys(panel.series_integrity_by_symbol ?? {}), CORE_SYMBOLS),
    "persisted Alpaca series-integrity registry differs");
  const rebuilt = buildGeneration6AlpacaAdjustmentAllPanel(
    panel.series_by_symbol,
    provenanceFromPanel(panel),
    { generatedAt: panel.generated_at },
  );
  invariant(sameJson(panel, rebuilt), "persisted Alpaca panel cannot be fully reproduced");
  return rebuilt;
}

function validateResultReceipt(receipt, frozen, claimEvidence, panel, panelPayloadHash) {
  invariant(hasExactKeys(receipt, RESULT_RECEIPT_KEYS),
    "Generation 6 Alpaca result-receipt fields are incomplete or expanded");
  invariant(forbiddenCredentialKeyPaths(receipt, "result_receipt").length === 0,
    "Generation 6 Alpaca result receipt contains credential-like fields");
  invariant(receipt.schema_version
    === "finly_generation6_alpaca_adjustment_all_panel_result_receipt.v2",
  "Generation 6 Alpaca panel result-receipt schema mismatch");
  assertCanonicalTimestamp(receipt.authenticated_read_started_at,
    "result authenticated_read_started_at");
  assertCanonicalTimestamp(receipt.authenticated_read_completed_at,
    "result authenticated_read_completed_at");
  invariant(receipt.authenticated_read_started_at === claimEvidence.claim.claimed_at,
    "result read start does not match the durable run claim");
  invariant(receipt.authenticated_read_completed_at >= receipt.authenticated_read_started_at,
    "result read completion predates its start");
  invariant(receipt.protocol_sha256 === sha256Bytes(frozen.protocolRaw),
    "result protocol hash mismatch");
  invariant(receipt.freeze_receipt_sha256 === sha256Bytes(frozen.receiptRaw),
    "result freeze-receipt hash mismatch");
  invariant(receipt.run_claim_sha256 === claimEvidence.claimSha256,
    "result run-claim hash mismatch");
  invariant(hasExactKeys(receipt.request, REQUEST_KEYS)
    && sameJson(receipt.request, GENERATION6_ALPACA_PANEL_REQUEST),
  "result request mismatch");
  invariant(receipt.request_sha256 === sha256(GENERATION6_ALPACA_PANEL_REQUEST),
    "result request hash mismatch");
  invariant(receipt.response_content_sha256 === panel.response_content_sha256,
    "result response-content hash mismatch");
  invariant(hasExactKeys(receipt.security, SECURITY_KEYS)
    && sameJson(receipt.security, GENERATION6_ALPACA_PANEL_SECURITY),
  "result security boundary mismatch");
  invariant(hasExactKeys(receipt.universe_boundary, UNIVERSE_KEYS)
    && sameJson(receipt.universe_boundary, GENERATION6_ALPACA_PANEL_UNIVERSE_BOUNDARY),
  "result survivorship boundary mismatch");
  invariant(hasExactKeys(receipt.panel, RESULT_PANEL_KEYS),
    "result panel descriptor is incomplete or expanded");
  invariant(receipt.panel.payload_sha256 === panelPayloadHash,
    "result panel payload hash mismatch");
  invariant(receipt.panel.schema_version === panel.schema_version,
    "result panel schema mismatch");
  invariant(receipt.panel.series_integrity_sha256 === sha256(panel.series_integrity_by_symbol),
    "result series-integrity hash mismatch");
  invariant(receipt.panel.strategy_intersection_normalized_panel_sha256
    === panel.strategy_intersection.normalized_panel_sha256,
  "result strategy normalized-panel hash mismatch");
  invariant(receipt.panel.strategy_intersection_observations
    === panel.strategy_intersection.observations
    && receipt.panel.strategy_intersection_start_date === panel.strategy_intersection.start_date
    && receipt.panel.strategy_intersection_end_date === panel.strategy_intersection.end_date,
  "result strategy-intersection metadata mismatch");
}

export function createGeneration6AlpacaPanelAcquisition({
  rootDirectory = projectRoot,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  maxPages = MAX_REMOTE_PAGES,
} = {}) {
  invariant(typeof now === "function", "acquisition clock is required");
  const paths = acquisitionPaths(rootDirectory);

  async function verifyExisting() {
    const frozen = await readFrozenInputs(paths);
    invariant(await pathExists(paths.runClaim), "Generation 6 Alpaca panel run claim is absent");
    invariant(await pathExists(paths.resultReceipt), "Generation 6 Alpaca panel result receipt is absent");
    const [claimRaw, receiptRaw] = await Promise.all([
      readFile(paths.runClaim),
      readFile(paths.resultReceipt),
    ]);
    const claim = JSON.parse(claimRaw.toString("utf8"));
    const receipt = JSON.parse(receiptRaw.toString("utf8"));
    const claimEvidence = validateRunClaim(claim, claimRaw, frozen);
    invariant(hasExactKeys(receipt?.panel, RESULT_PANEL_KEYS),
      "Generation 6 Alpaca result panel descriptor is invalid");
    const expectedRelativePanelPath = `data/private/champion_search/${panelFilename(receipt.panel.payload_sha256)}`;
    invariant(receipt.panel.path === expectedRelativePanelPath,
      "persisted Alpaca panel path is not the exact content-addressed private path");
    const panelPath = safeProjectPath(paths.root, receipt.panel.path, "persisted Alpaca panel");
    invariant(basename(panelPath) === panelFilename(receipt.panel.payload_sha256),
      "panel is not content-addressed by its byte hash");
    const panelRaw = await readFile(panelPath);
    invariant(sha256Bytes(panelRaw) === receipt.panel.payload_sha256,
      "persisted Alpaca panel payload hash mismatch");
    const panel = JSON.parse(panelRaw.toString("utf8"));
    validateStoredGeneration6AlpacaPanel(panel);
    validateResultReceipt(receipt, frozen, claimEvidence, panel, sha256Bytes(panelRaw));
    return Object.freeze({
      frozen,
      claim,
      claimRaw,
      receipt,
      receiptRaw,
      panel,
      panelRaw,
      panelPath,
    });
  }

  async function firstRun() {
    return withExclusiveDirectoryLock(paths.lock, async () => {
      invariant(!(await pathExists(paths.runClaim)),
        "Generation 6 Alpaca panel run claim already exists; refetch is forbidden and requires audit");
      invariant(!(await pathExists(paths.resultReceipt)),
        "Generation 6 Alpaca panel result receipt already exists; use --verify-existing");
      const existingPanels = await matchingPanelNames(paths.privateDirectory);
      invariant(existingPanels.length === 0,
        `unreceipted Generation 6 Alpaca panel already exists: ${existingPanels.join(", ")}`);
      const frozen = await readFrozenInputs(paths);
      const credentials = credentialsFromEnvironment(environment);
      const client = new AlpacaGeneration6PanelClient({
        ...credentials,
        fetchImpl,
        maxPages,
      });
      const claimedAt = now();
      assertCanonicalTimestamp(claimedAt, "run-claim timestamp");
      invariant(claimedAt >= frozen.protocol.frozen_at, "run claim predates protocol freeze");
      const claim = deepFreeze({
        schema_version: "finly_generation6_alpaca_adjustment_all_panel_run_claim.v1",
        status: "CLAIMED_IMMEDIATELY_BEFORE_AUTHENTICATED_GET",
        claimed_at: claimedAt,
        protocol_sha256: sha256Bytes(frozen.protocolRaw),
        freeze_receipt_sha256: sha256Bytes(frozen.receiptRaw),
        request: safeRequestProjection(frozen.protocol.request),
        request_sha256: sha256(GENERATION6_ALPACA_PANEL_REQUEST),
        security: { ...GENERATION6_ALPACA_PANEL_SECURITY },
      });
      const claimRaw = Buffer.from(`${JSON.stringify(claim, null, 2)}\n`);
      const claimDisposition = await writeOnceOrVerify(
        paths.runClaim,
        claimRaw,
        "Generation 6 Alpaca pre-GET run claim",
      );
      invariant(claimDisposition === "created",
        "Generation 6 Alpaca run claim was not newly created; refetch is forbidden");
      const response = await client.getDailyBars(claim.request);
      const completedAt = now();
      assertCanonicalTimestamp(completedAt, "authenticated read completion timestamp");
      invariant(completedAt >= claimedAt, "authenticated read completion predates its claim");
      const panel = buildGeneration6AlpacaAdjustmentAllPanel(
        response.series_by_symbol,
        response.provenance,
        { generatedAt: completedAt },
      );
      const panelRaw = Buffer.from(`${JSON.stringify(panel, null, 2)}\n`);
      const panelPayloadSha256 = sha256Bytes(panelRaw);
      const filename = panelFilename(panelPayloadSha256);
      const relativePanelPath = `data/private/champion_search/${filename}`;
      const absolutePanelPath = resolve(paths.privateDirectory, filename);
      const result = deepFreeze({
        schema_version: "finly_generation6_alpaca_adjustment_all_panel_result_receipt.v2",
        authenticated_read_started_at: claimedAt,
        authenticated_read_completed_at: completedAt,
        protocol_sha256: sha256Bytes(frozen.protocolRaw),
        freeze_receipt_sha256: sha256Bytes(frozen.receiptRaw),
        run_claim_sha256: sha256Bytes(claimRaw),
        request: safeRequestProjection(frozen.protocol.request),
        request_sha256: sha256(GENERATION6_ALPACA_PANEL_REQUEST),
        response_content_sha256: panel.response_content_sha256,
        panel: {
          path: relativePanelPath,
          payload_sha256: panelPayloadSha256,
          schema_version: panel.schema_version,
          series_integrity_sha256: sha256(panel.series_integrity_by_symbol),
          strategy_intersection_normalized_panel_sha256:
            panel.strategy_intersection.normalized_panel_sha256,
          strategy_intersection_observations: panel.strategy_intersection.observations,
          strategy_intersection_start_date: panel.strategy_intersection.start_date,
          strategy_intersection_end_date: panel.strategy_intersection.end_date,
        },
        security: { ...GENERATION6_ALPACA_PANEL_SECURITY },
        universe_boundary: { ...GENERATION6_ALPACA_PANEL_UNIVERSE_BOUNDARY },
        claim_boundary: panel.claim_boundary,
      });
      const resultRaw = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
      await writeOnceOrVerify(absolutePanelPath, panelRaw,
        "Generation 6 Alpaca all-adjusted v2 panel");
      await writeOnceOrVerify(paths.resultReceipt, resultRaw,
        "Generation 6 Alpaca all-adjusted v2 panel receipt");
      return Object.freeze({ result, panel, claim });
    });
  }

  return Object.freeze({ firstRun, verifyExisting, paths });
}

async function main() {
  const args = process.argv.slice(2);
  invariant(args.length <= 1 && (args.length === 0 || args[0] === "--verify-existing"),
    "usage: node research/persist_alpaca_adjustment_all_panel_generation6.mjs [--verify-existing]");
  const acquisition = createGeneration6AlpacaPanelAcquisition();
  const verification = args[0] === "--verify-existing";
  const bundle = verification
    ? await acquisition.verifyExisting()
    : await acquisition.firstRun();
  const result = verification ? bundle.receipt : bundle.result;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: verification ? "verify-existing" : "first-run",
    panel: result.panel.path,
    payload_sha256: result.panel.payload_sha256,
    strategy_intersection_normalized_panel_sha256:
      result.panel.strategy_intersection_normalized_panel_sha256,
    strategy_intersection_start_date: result.panel.strategy_intersection_start_date,
    strategy_intersection_end_date: result.panel.strategy_intersection_end_date,
    strategy_intersection_observations: result.panel.strategy_intersection_observations,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
