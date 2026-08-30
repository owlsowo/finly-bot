import { sha256 } from "../lib/canonical.mjs";
import { CORE_SYMBOLS } from "./champion_strategies.mjs";
import { createGeneration4Strategies } from "./champion_strategies_generation4.mjs";

export const G4_SHADOW_STRATEGY_ID = "qqq_core_sector_12_6";
export const G4_SHADOW_LOOKBACK_SESSIONS = 252;
export const G4_SHADOW_REBALANCE_INTERVAL_SESSIONS = 21;
export const G4_SHADOW_SIGNAL_SCHEMA = "finly_g4_shadow_signal.v1";
export const G4_SHADOW_SYMBOLS = Object.freeze([...CORE_SYMBOLS]);

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const STRATEGY = createGeneration4Strategies()
  .find(({ id }) => id === G4_SHADOW_STRATEGY_ID);

if (!STRATEGY) throw new Error(`missing frozen strategy ${G4_SHADOW_STRATEGY_ID}`);
if (STRATEGY.rebalanceIntervalSessions !== G4_SHADOW_REBALANCE_INTERVAL_SESSIONS) {
  throw new Error("frozen G4 strategy cadence changed");
}
function fail(message) {
  throw new TypeError(message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function canonicalDate(value, label) {
  if (typeof value !== "string" || !DATE.test(value)) fail(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} is not a valid date`);
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function fullWeights(sparseWeights) {
  plainObject(sparseWeights, "strategy weights");
  const unknown = Object.keys(sparseWeights).filter((symbol) => !G4_SHADOW_SYMBOLS.includes(symbol));
  if (unknown.length > 0) fail(`strategy weights contain unsupported symbols: ${unknown.join(", ")}`);
  const result = Object.fromEntries(G4_SHADOW_SYMBOLS.map((symbol) => {
    const weight = Number(sparseWeights[symbol] ?? 0);
    if (!Number.isFinite(weight) || weight < -1e-12 || weight > 1 + 1e-12) {
      fail(`strategy weight for ${symbol} is invalid`);
    }
    return [symbol, Math.abs(weight) < 1e-12 ? 0 : weight];
  }));
  const total = Object.values(result).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > 1e-10) fail(`strategy weights sum to ${total}, not one`);
  return result;
}

function normalizeRows(adjustedCloseRows) {
  exactKeys(adjustedCloseRows, G4_SHADOW_SYMBOLS, "adjusted_close_rows");
  const expectedLength = G4_SHADOW_LOOKBACK_SESSIONS + 1;
  const dates = [];
  const values = {};

  for (const [symbolIndex, symbol] of G4_SHADOW_SYMBOLS.entries()) {
    const rows = adjustedCloseRows[symbol];
    if (!Array.isArray(rows) || rows.length !== expectedLength) {
      fail(`adjusted_close_rows.${symbol} must contain exactly ${expectedLength} sessions`);
    }
    values[symbol] = rows.map((row, index) => {
      plainObject(row, `adjusted_close_rows.${symbol}[${index}]`);
      const allowed = new Set(["session_date", "bar_timestamp", "close"]);
      if (Object.keys(row).some((key) => !allowed.has(key))) {
        fail(`adjusted_close_rows.${symbol}[${index}] contains an unsupported field`);
      }
      if (!Object.hasOwn(row, "session_date") || !Object.hasOwn(row, "close")) {
        fail(`adjusted_close_rows.${symbol}[${index}] omits session_date or close`);
      }
      const date = canonicalDate(row.session_date, `adjusted_close_rows.${symbol}[${index}].session_date`);
      const close = Number(row.close);
      if (!Number.isFinite(close) || close <= 0) {
        fail(`adjusted_close_rows.${symbol}[${index}].close must be positive and finite`);
      }
      if (index > 0 && date <= rows[index - 1].session_date) {
        fail(`adjusted_close_rows.${symbol} dates must be strictly increasing`);
      }
      if (symbolIndex === 0) dates.push(date);
      else if (date !== dates[index]) fail(`adjusted_close_rows.${symbol} dates do not align`);
      return close;
    });
  }

  const points = dates.map((date, index) => Object.freeze({
    date,
    ...Object.fromEntries(G4_SHADOW_SYMBOLS.map((symbol) => [symbol, values[symbol][index]])),
  }));
  return { dates, points };
}

function signalBody(value) {
  return {
    schema_version: value.schema_version,
    strategy_id: value.strategy_id,
    signal_session_date: value.signal_session_date,
    source_panel_sha256: value.source_panel_sha256,
    chronology: value.chronology,
    action: value.action,
    target_weights: value.target_weights,
    selected_sectors: value.selected_sectors,
    authority: value.authority,
  };
}

export function validateG4ShadowSignal(value) {
  exactKeys(value, [
    "schema_version", "strategy_id", "signal_session_date", "source_panel_sha256",
    "chronology", "action", "target_weights", "selected_sectors", "authority",
    "signal_sha256",
  ], "G4 shadow signal");
  if (value.schema_version !== G4_SHADOW_SIGNAL_SCHEMA
    || value.strategy_id !== G4_SHADOW_STRATEGY_ID) {
    fail("G4 shadow signal envelope changed");
  }
  canonicalDate(value.signal_session_date, "G4 shadow signal date");
  if (typeof value.source_panel_sha256 !== "string" || !SHA256.test(value.source_panel_sha256)) {
    fail("G4 shadow source panel hash is invalid");
  }
  exactKeys(value.chronology, [
    "lookback_sessions", "rebalance_interval_sessions", "session_number",
    "signal_at_completed_close", "earliest_execution_session",
  ], "G4 shadow chronology");
  if (value.chronology.lookback_sessions !== G4_SHADOW_LOOKBACK_SESSIONS
    || value.chronology.rebalance_interval_sessions !== G4_SHADOW_REBALANCE_INTERVAL_SESSIONS
    || !Number.isSafeInteger(value.chronology.session_number)
    || value.chronology.session_number < 0
    || value.chronology.signal_at_completed_close !== true
    || value.chronology.earliest_execution_session !== "NEXT_COMPLETED_SESSION") {
    fail("G4 shadow chronology changed");
  }
  const expectedAction = value.chronology.session_number % G4_SHADOW_REBALANCE_INTERVAL_SESSIONS === 0
    ? "REBALANCE"
    : "HOLD";
  if (value.action !== expectedAction) fail("G4 shadow action differs from the frozen cadence");
  const weights = fullWeights(value.target_weights);
  if (sha256(weights) !== sha256(value.target_weights)) fail("G4 shadow target weights are not canonical and complete");
  if (!Array.isArray(value.selected_sectors) || value.selected_sectors.length !== 3
    || new Set(value.selected_sectors).size !== 3
    || value.selected_sectors.some((symbol) => !["XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU"].includes(symbol))) {
    fail("G4 shadow selected sectors must contain three unique sector ETFs");
  }
  exactKeys(value.authority, ["shadow_only", "broker_mutation_authorized", "order_payload"], "G4 shadow authority");
  if (value.authority.shadow_only !== true
    || value.authority.broker_mutation_authorized !== false
    || value.authority.order_payload !== null) {
    fail("G4 shadow signal crossed its non-authorizing boundary");
  }
  if (typeof value.signal_sha256 !== "string" || !SHA256.test(value.signal_sha256)
    || value.signal_sha256 !== sha256(signalBody(value))) {
    fail("G4 shadow signal hash is invalid");
  }
  return value;
}

export function buildG4ShadowSignal({
  adjustedCloseRows,
  sessionNumber,
  previousTargetWeights = null,
} = {}) {
  if (!Number.isSafeInteger(sessionNumber) || sessionNumber < 0) {
    fail("sessionNumber must be a non-negative safe integer");
  }
  const { dates, points } = normalizeRows(adjustedCloseRows);
  const signalIndex = G4_SHADOW_LOOKBACK_SESSIONS;
  const rebalanced = sessionNumber % G4_SHADOW_REBALANCE_INTERVAL_SESSIONS === 0;
  let weights;
  if (rebalanced) {
    weights = fullWeights(STRATEGY.decide(Object.freeze({
      points: Object.freeze(points),
      symbols: G4_SHADOW_SYMBOLS,
      signalIndex,
      signalDate: dates.at(-1),
      priorWeights: previousTargetWeights === null ? null : fullWeights(previousTargetWeights),
      rows: Object.freeze([]),
    })));
  } else {
    if (previousTargetWeights === null) fail("a HOLD signal requires previousTargetWeights");
    weights = fullWeights(previousTargetWeights);
  }
  const selectedSectors = Object.entries(weights)
    .filter(([symbol, weight]) => symbol.startsWith("XL") && weight > 0)
    .map(([symbol]) => symbol)
    .sort();
  if (selectedSectors.length !== 3) fail("frozen G4 signal did not select exactly three sectors");
  const panelProjection = dates.map((date, index) => [
    date,
    ...G4_SHADOW_SYMBOLS.map((symbol) => adjustedCloseRows[symbol][index].close),
  ]);
  const body = {
    schema_version: G4_SHADOW_SIGNAL_SCHEMA,
    strategy_id: G4_SHADOW_STRATEGY_ID,
    signal_session_date: dates.at(-1),
    source_panel_sha256: sha256(panelProjection),
    chronology: {
      lookback_sessions: G4_SHADOW_LOOKBACK_SESSIONS,
      rebalance_interval_sessions: G4_SHADOW_REBALANCE_INTERVAL_SESSIONS,
      session_number: sessionNumber,
      signal_at_completed_close: true,
      earliest_execution_session: "NEXT_COMPLETED_SESSION",
    },
    action: rebalanced ? "REBALANCE" : "HOLD",
    target_weights: weights,
    selected_sectors: selectedSectors,
    authority: {
      shadow_only: true,
      broker_mutation_authorized: false,
      order_payload: null,
    },
  };
  return validateG4ShadowSignal(deepFreeze({ ...body, signal_sha256: sha256(body) }));
}
