import { sha256 } from "./canonical.mjs";
import { POLICY } from "./policy.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

const FLAT_PHASES = new Set([
  "CREATED",
  "ENTRY_ACCEPTED",
  "ENTRY_CANCEL_PENDING",
  "ENTRY_REPLACE_PENDING",
  "CLOSED",
]);
const SPREAD_PHASES = new Set(["POSITION_OPEN", "EXIT_REQUIRED", "EXIT_ACCEPTED"]);

export class BrokerPositionMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "BrokerPositionMismatchError";
    this.code = "BROKER_POSITION_MISMATCH";
  }
}

function mismatch(message) {
  throw new BrokerPositionMismatchError(message);
}

function quantity(value) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^-?\d+(?:\.0+)?$/.test(text)) mismatch("broker position quantity is ambiguous");
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed === 0 || Math.abs(parsed) > POLICY.maxContracts) {
    mismatch("broker position quantity is outside the managed spread boundary");
  }
  return Math.abs(parsed);
}

function expectedPositions(entryProjection) {
  if (!entryProjection || !Array.isArray(entryProjection.legs) || entryProjection.legs.length !== 2) {
    mismatch("certified spread projection is unavailable for position reconciliation");
  }
  const expectedQuantity = Number(entryProjection.qty);
  if (!Number.isInteger(expectedQuantity) || expectedQuantity < 1 || expectedQuantity > POLICY.maxContracts) {
    mismatch("certified spread quantity is invalid for position reconciliation");
  }
  const expected = entryProjection.legs.map((leg) => {
    try {
      parseOccOptionSymbol(leg.symbol);
    } catch {
      mismatch("certified spread contains an invalid option symbol");
    }
    const side = leg.side === "buy" && leg.position_intent === "buy_to_open"
      ? "long"
      : leg.side === "sell" && leg.position_intent === "sell_to_open"
        ? "short"
        : null;
    if (side === null) mismatch("certified spread contains an unsupported opening leg");
    return { symbol: leg.symbol, side, qty: expectedQuantity };
  });
  if (new Set(expected.map((position) => position.symbol)).size !== 2) {
    mismatch("certified spread contains duplicate position symbols");
  }
  return expected;
}

function normalizePosition(position) {
  if (!position || typeof position !== "object" || Array.isArray(position)) mismatch("broker position is malformed");
  if (typeof position.symbol !== "string") mismatch("broker position symbol is missing");
  try {
    parseOccOptionSymbol(position.symbol);
  } catch {
    mismatch("broker returned an unsupported holding");
  }
  if (position.asset_class !== undefined && position.asset_class !== "us_option") {
    mismatch("broker returned a non-option holding");
  }
  if (!new Set(["long", "short"]).has(position.side)) mismatch("broker position side is ambiguous");
  return { symbol: position.symbol, side: position.side, qty: quantity(position.qty) };
}

/**
 * Independently reconcile the broker's complete position inventory with the
 * lifecycle phase. The dedicated paper account must be either exactly flat or
 * contain exactly the certified two-leg vertical; all other holdings freeze
 * automation for manual review.
 */
export function reconcileBrokerPositions({ positions, entryProjection, lifecyclePhase } = {}) {
  if (!Array.isArray(positions)) mismatch("broker positions response is incomplete");
  if (!FLAT_PHASES.has(lifecyclePhase) && !SPREAD_PHASES.has(lifecyclePhase)) {
    mismatch("lifecycle phase is unsupported for broker-position reconciliation");
  }
  const normalized = positions.map(normalizePosition).sort((left, right) => left.symbol.localeCompare(right.symbol));
  if (new Set(normalized.map((position) => position.symbol)).size !== normalized.length) {
    mismatch("broker returned duplicate or ambiguous positions");
  }

  const expectedState = FLAT_PHASES.has(lifecyclePhase) ? "flat" : "certified_spread";
  if (expectedState === "flat") {
    if (normalized.length !== 0) mismatch("broker holdings disagree with a flat lifecycle state");
  } else {
    const expected = expectedPositions(entryProjection).sort((left, right) => left.symbol.localeCompare(right.symbol));
    if (normalized.length === 0) mismatch("certified spread is absent from the broker account");
    if (normalized.length !== expected.length) mismatch("broker holdings do not contain exactly the certified spread");
    for (let index = 0; index < expected.length; index += 1) {
      if (normalized[index].symbol !== expected[index].symbol
        || normalized[index].side !== expected[index].side
        || normalized[index].qty !== expected[index].qty) {
        mismatch("broker holdings differ from the certified spread");
      }
    }
  }

  return {
    schema_version: "finly_broker_position_reconciliation.v1",
    lifecycle_phase: lifecyclePhase,
    expected_state: expectedState,
    matched: true,
    position_count: normalized.length,
    positions_sha256: sha256(normalized),
  };
}
