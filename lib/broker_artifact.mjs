import { parseOccOptionSymbol } from "./schema.mjs";

const ORDER_STATUSES = new Set([
  "accepted",
  "accepted_for_bidding",
  "calculated",
  "canceled",
  "done_for_day",
  "expired",
  "filled",
  "held",
  "new",
  "partially_filled",
  "pending_cancel",
  "pending_new",
  "pending_replace",
  "rejected",
  "replaced",
  "stopped",
  "suspended",
]);

const ORDER_CLASSES = new Set(["mleg"]);
const ORDER_TYPES = new Set(["limit"]);
const TIME_IN_FORCE_VALUES = new Set(["day"]);
const SIDES = new Set(["buy", "sell"]);
const POSITION_INTENTS = new Set(["buy_to_open", "sell_to_open", "buy_to_close", "sell_to_close"]);
const CONTENT_TYPES = new Set(["audio", "image", "resource", "resource_link", "text"]);

const PRIVACY_POLICY = Object.freeze({
  account_identifiers_retained: false,
  broker_order_identifiers_retained: false,
  client_order_identifiers_retained: false,
  credential_identifiers_retained: false,
  raw_payload_retained: false,
  unknown_fields_retained: false,
});

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function safeEnum(value, values, fallback) {
  return typeof value === "string" && values.has(value) ? value : fallback;
}

function safeDecimal(value) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,12}(?:\.\d{1,8})?$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? text : undefined;
}

function safeTimestamp(value) {
  if (typeof value !== "string" || value.length > 40) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function safeOptionSymbol(value) {
  if (typeof value !== "string") return undefined;
  try {
    parseOccOptionSymbol(value);
    return value;
  } catch {
    return undefined;
  }
}

function sanitizeLeg(value) {
  const leg = record(value);
  if (!leg) return null;
  return compact({
    symbol: safeOptionSymbol(leg.symbol),
    ratio_qty: safeDecimal(leg.ratio_qty ?? leg.qty),
    side: safeEnum(leg.side, SIDES),
    position_intent: safeEnum(leg.position_intent, POSITION_INTENTS),
    status: safeEnum(leg.status, ORDER_STATUSES),
    filled_qty: safeDecimal(leg.filled_qty),
    filled_avg_price: safeDecimal(leg.filled_avg_price),
  });
}

function firstSafeStatus(...values) {
  for (const value of values) {
    const status = safeEnum(value, ORDER_STATUSES);
    if (status !== undefined) return status;
  }
  return undefined;
}

/**
 * Produces a publishable proof artifact from an Alpaca order readback.
 *
 * This is intentionally a positive allowlist, not recursive redaction. Broker,
 * account, client-order, asset, and credential identifiers never enter the
 * returned object; neither do unknown fields or raw text payloads.
 */
export function sanitizeBrokerOrderArtifact(value) {
  const order = record(value) ?? {};
  const legs = Array.isArray(order.legs)
    ? order.legs.map(sanitizeLeg).filter((leg) => leg !== null)
    : [];
  return {
    schema_version: "sanitized_broker_order.v1",
    status: safeEnum(order.status, ORDER_STATUSES, "unrecognized"),
    order_shape: compact({
      order_class: safeEnum(order.order_class, ORDER_CLASSES),
      qty: safeDecimal(order.qty),
      type: safeEnum(order.type, ORDER_TYPES),
      time_in_force: safeEnum(order.time_in_force, TIME_IN_FORCE_VALUES),
      limit_price: safeDecimal(order.limit_price),
      legs,
    }),
    execution: compact({
      filled_qty: safeDecimal(order.filled_qty),
      filled_avg_price: safeDecimal(order.filled_avg_price),
      submitted_at: safeTimestamp(order.submitted_at),
      filled_at: safeTimestamp(order.filled_at),
      canceled_at: safeTimestamp(order.canceled_at),
      expired_at: safeTimestamp(order.expired_at),
    }),
    privacy: { ...PRIVACY_POLICY },
  };
}

/**
 * Summarizes an MCP mutation response without retaining any response body.
 * The reconciled order artifact is the source of truth for order shape.
 */
export function sanitizeBrokerMutationAcknowledgment(value) {
  const response = record(value);
  const structured = record(response?.structuredContent);
  const nestedOrder = record(response?.order);
  const contentTypes = Array.isArray(response?.content)
    ? [...new Set(response.content
      .map((item) => safeEnum(record(item)?.type, CONTENT_TYPES))
      .filter((type) => type !== undefined))].sort()
    : [];
  return compact({
    schema_version: "sanitized_broker_mutation_ack.v1",
    acknowledged: value !== null && value !== undefined,
    is_error: typeof response?.isError === "boolean" ? response.isError : undefined,
    status: firstSafeStatus(response?.status, nestedOrder?.status, structured?.status),
    content_types: contentTypes,
    structured_content_present: structured !== null,
    privacy: { ...PRIVACY_POLICY },
  });
}

/** Allowlisted public metadata for the pinned Alpaca MCP transport. */
export function sanitizeMcpTransportMetadata(value) {
  const metadata = record(value) ?? {};
  return compact({
    server: metadata.server === "alpaca-mcp-server" ? metadata.server : undefined,
    version: typeof metadata.version === "string" && /^\d+\.\d+\.\d+$/.test(metadata.version) ? metadata.version : undefined,
    tool: metadata.tool === "place_option_order" ? metadata.tool : undefined,
    schema_sha256: typeof metadata.schema_sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(metadata.schema_sha256)
      ? metadata.schema_sha256
      : undefined,
    privacy: { ...PRIVACY_POLICY },
  });
}

export const BROKER_ARTIFACT_PRIVACY_POLICY = PRIVACY_POLICY;
