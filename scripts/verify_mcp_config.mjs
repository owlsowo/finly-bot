import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { POLICY } from "../lib/policy.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(projectRoot, process.argv[2] ?? "config/alpaca-mcp.example.json");
const config = JSON.parse(await readFile(path, "utf8"));
const schema = JSON.parse(await readFile(resolve(projectRoot, "config/alpaca-mcp-place-option-order-2.2.1.json"), "utf8"));
const authenticatedReadText = await readFile(resolve(projectRoot, "evidence/alpaca_mcp_read_trace.json"), "utf8");
const authenticatedRead = JSON.parse(authenticatedReadText);
const server = config.mcpServers?.["alpaca-paper"];
assert.equal(server.command, "uvx");
assert.deepEqual(server.args, [`alpaca-mcp-server==${POLICY.alpacaMcpVersion}`]);
assert.equal(server.env.ALPACA_PAPER_TRADE, "true");
assert.equal(server.env.ALPACA_TOOLSETS, "account,trading,assets,stock-data,options-data,news,corporate-actions");
assert.equal(server.env.ALPACA_API_KEY, "REPLACE_LOCALLY_NEVER_COMMIT");
assert.equal(server.env.ALPACA_SECRET_KEY, "REPLACE_LOCALLY_NEVER_COMMIT");
assert.equal(schema.package, "alpaca-mcp-server");
assert.equal(schema.version, POLICY.alpacaMcpVersion);
assert.equal(schema.tool, "place_option_order");
assert.equal(schema.parameters.additionalProperties, false);
assert.deepEqual(schema.parameters.required, ["qty"]);
assert.equal(schema.parameters.properties.legs.anyOf[0].type, "array");
assert.equal(sha256(schema.parameters), POLICY.placeOptionOrderSchemaSha256);
assert.equal(Object.hasOwn(schema.parameters.properties, "extended_hours"), false);
assert.equal(authenticatedRead.status, "AUTHENTICATED_MCP_READ_SUCCEEDED");
assert.equal(authenticatedRead.server, "alpaca-mcp-server");
assert.equal(authenticatedRead.server_version, POLICY.alpacaMcpVersion);
assert.equal(authenticatedRead.protocol_transport, "stdio");
assert.equal(authenticatedRead.tool, "get_account_info");
assert.equal(authenticatedRead.paper, true);
assert.equal(authenticatedRead.authenticated_network_call, true);
assert.equal(authenticatedRead.mutation_requested, false);
assert.equal(authenticatedRead.account_id_redacted, true);
assert.equal(Object.hasOwn(authenticatedRead, "account_id"), false);
assert.doesNotMatch(authenticatedReadText, /"account_(?:id|number)"\s*:/u);
assert.doesNotMatch(authenticatedReadText, /\bPA[A-Z0-9]{10}\b/u);
assert.equal(authenticatedRead.safe_account_summary.status, "ACTIVE");
assert.equal(authenticatedRead.safe_account_summary.account_blocked, false);
assert.equal(authenticatedRead.safe_account_summary.trading_blocked, false);
assert.ok(authenticatedRead.safe_account_summary.options_approved_level >= 3);
assert.ok(authenticatedRead.safe_account_summary.options_trading_level >= 3);
assert.equal(authenticatedRead.safe_account_summary.required_starting_balance_matches, true);
assert.match(authenticatedRead.tool_schema_sha256, /^sha256:[a-f0-9]{64}$/);
assert.match(authenticatedRead.raw_response_sha256, /^sha256:[a-f0-9]{64}$/);
process.stdout.write(`${stableStringify({
  status: "PINNED_SCHEMA_AND_AUTHENTICATED_READ_VERIFIED",
  server: "alpaca-paper",
  version: POLICY.alpacaMcpVersion,
  paper: true,
  tool: schema.tool,
  schema_sha256: POLICY.placeOptionOrderSchemaSha256,
  authenticated_read: {
    transport: authenticatedRead.protocol_transport,
    tool: authenticatedRead.tool,
    account_id_redacted: authenticatedRead.account_id_redacted,
    mutation_requested: authenticatedRead.mutation_requested,
  },
  note: "This offline check validates the committed authenticated-read trace and pinned schema; it performs no fresh authentication, broker mutation, or paper order.",
})}\n`);
