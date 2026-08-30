import assert from "node:assert/strict";
import test from "node:test";
import {
  BROKER_ARTIFACT_PRIVACY_POLICY,
  sanitizeBrokerMutationAcknowledgment,
  sanitizeBrokerOrderArtifact,
  sanitizeMcpTransportMetadata,
} from "../lib/broker_artifact.mjs";

const secrets = Object.freeze({
  account: "account-PA-should-never-publish",
  order: "broker-order-should-never-publish",
  childOrder: "broker-leg-order-should-never-publish",
  clientOrder: "finly-client-order-should-never-publish",
  apiKey: "PK-PAPER-KEY-ID-should-never-publish",
  secretKey: "paper-secret-key-should-never-publish",
  unknown: "unknown-raw-field-should-never-publish",
});

function assertNoSensitiveValue(value) {
  const serialized = JSON.stringify(value);
  for (const sensitive of Object.values(secrets)) {
    assert.equal(serialized.includes(sensitive), false, `artifact leaked ${sensitive}`);
  }
  assert.equal(serialized.includes("authorization-value-should-never-publish"), false);
  assert.equal(serialized.includes("Bearer should-never-publish"), false);
}

test("broker order artifacts retain only status, order shape, fills, and safe timestamps", () => {
  const artifact = sanitizeBrokerOrderArtifact({
    id: secrets.order,
    account_id: secrets.account,
    client_order_id: secrets.clientOrder,
    api_key_id: secrets.apiKey,
    secret_key: secrets.secretKey,
    asset_id: "asset-id-should-never-publish",
    status: "partially_filled",
    order_class: "mleg",
    qty: "1",
    type: "limit",
    time_in_force: "day",
    limit_price: "3.66",
    filled_qty: "0.5",
    filled_avg_price: "3.61",
    submitted_at: "2026-08-28T15:30:00.000Z",
    unknown_raw: secrets.unknown,
    headers: { authorization: "Bearer should-never-publish" },
    legs: [
      {
        id: secrets.childOrder,
        account_id: secrets.account,
        symbol: "SPY260904P00560000",
        ratio_qty: "1",
        side: "buy",
        position_intent: "buy_to_open",
        status: "partially_filled",
        filled_qty: "0.5",
        filled_avg_price: "7.20",
        raw: secrets.unknown,
      },
      {
        id: secrets.childOrder,
        symbol: "SPY260904P00550000",
        qty: "1",
        side: "sell",
        position_intent: "sell_to_open",
        status: "new",
      },
    ],
  });

  assert.equal(artifact.schema_version, "sanitized_broker_order.v1");
  assert.equal(artifact.status, "partially_filled");
  assert.deepEqual(artifact.order_shape, {
    order_class: "mleg",
    qty: "1",
    type: "limit",
    time_in_force: "day",
    limit_price: "3.66",
    legs: [
      {
        symbol: "SPY260904P00560000",
        ratio_qty: "1",
        side: "buy",
        position_intent: "buy_to_open",
        status: "partially_filled",
        filled_qty: "0.5",
        filled_avg_price: "7.20",
      },
      {
        symbol: "SPY260904P00550000",
        ratio_qty: "1",
        side: "sell",
        position_intent: "sell_to_open",
        status: "new",
      },
    ],
  });
  assert.deepEqual(artifact.execution, {
    filled_qty: "0.5",
    filled_avg_price: "3.61",
    submitted_at: "2026-08-28T15:30:00.000Z",
  });
  assert.deepEqual(artifact.privacy, BROKER_ARTIFACT_PRIVACY_POLICY);
  assertNoSensitiveValue(artifact);
});

test("values in allowlisted fields must pass strict value allowlists", () => {
  const artifact = sanitizeBrokerOrderArtifact({
    status: `accepted-${secrets.secretKey}`,
    order_class: `mleg-${secrets.apiKey}`,
    qty: `1-${secrets.account}`,
    type: `limit-${secrets.order}`,
    time_in_force: `day-${secrets.unknown}`,
    limit_price: `3.66-${secrets.secretKey}`,
    submitted_at: `2026-08-28T15:30:00.000Z-${secrets.apiKey}`,
    legs: [{
      symbol: `SPY260904P00560000-${secrets.secretKey}`,
      ratio_qty: `1-${secrets.apiKey}`,
      side: `buy-${secrets.order}`,
      position_intent: `buy_to_open-${secrets.account}`,
      status: `new-${secrets.unknown}`,
    }],
  });

  assert.equal(artifact.status, "unrecognized");
  assert.deepEqual(artifact.order_shape, { legs: [{}] });
  assert.deepEqual(artifact.execution, {});
  assertNoSensitiveValue(artifact);
});

test("mutation acknowledgments never retain MCP text or structured response bodies", () => {
  const artifact = sanitizeBrokerMutationAcknowledgment({
    isError: false,
    status: "accepted",
    id: secrets.order,
    account_id: secrets.account,
    api_key_id: secrets.apiKey,
    content: [
      { type: "text", text: `created ${secrets.order} with ${secrets.secretKey}` },
      { type: "image", data: secrets.unknown },
      { type: `text-${secrets.apiKey}`, text: secrets.account },
    ],
    structuredContent: {
      status: "accepted",
      raw_order: secrets.order,
      authorization: "authorization-value-should-never-publish",
    },
    unknown: secrets.unknown,
  });

  assert.deepEqual(artifact, {
    schema_version: "sanitized_broker_mutation_ack.v1",
    acknowledged: true,
    is_error: false,
    status: "accepted",
    content_types: ["image", "text"],
    structured_content_present: true,
    privacy: BROKER_ARTIFACT_PRIVACY_POLICY,
  });
  assertNoSensitiveValue(artifact);
});

test("raw scalar mutation responses are reduced to an acknowledgment bit", () => {
  const artifact = sanitizeBrokerMutationAcknowledgment(`${secrets.secretKey}:${secrets.order}`);
  assert.equal(artifact.acknowledged, true);
  assert.deepEqual(artifact.content_types, []);
  assert.equal(artifact.structured_content_present, false);
  assertNoSensitiveValue(artifact);
});

test("MCP transport metadata is a positive allowlist and drops credential fields", () => {
  const metadata = sanitizeMcpTransportMetadata({
    server: "alpaca-mcp-server",
    version: "2.2.1",
    tool: "place_option_order",
    schema_sha256: `sha256:${"a".repeat(64)}`,
    api_key_id: secrets.apiKey,
    account_id: secrets.account,
    broker_order_id: secrets.order,
    unknown: secrets.unknown,
  });
  assert.deepEqual(metadata, {
    server: "alpaca-mcp-server",
    version: "2.2.1",
    tool: "place_option_order",
    schema_sha256: `sha256:${"a".repeat(64)}`,
    privacy: BROKER_ARTIFACT_PRIVACY_POLICY,
  });
  assertNoSensitiveValue(metadata);
});

test("unknown fields are not inspected while allowlisted fields are copied", () => {
  const order = { status: "accepted", order_class: "mleg", legs: [] };
  Object.defineProperty(order, "unknown", {
    enumerable: true,
    get() {
      throw new Error("an unknown-field getter must never be evaluated");
    },
  });
  assert.doesNotThrow(() => sanitizeBrokerOrderArtifact(order));
});
