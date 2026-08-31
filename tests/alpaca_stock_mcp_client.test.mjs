import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  PINNED_ALPACA_STOCK_MCP_METADATA,
  runPinnedStockMcpBridge,
} from "../lib/alpaca_stock_mcp_client.mjs";

const projection = Object.freeze({
  client_order_id: "finly-g4-14ea5e333d4a9075d7e1",
  notional: "48500.00",
  side: "buy",
  symbol: "QQQ",
  time_in_force: "day",
  type: "market",
});

function spawnSuccess(capture) {
  return (command, args, options) => {
    assert.equal(command, "/private/fake/python");
    assert.deepEqual(args, ["/private/fake/bridge.py", "--server-command", "/private/fake/alpaca-mcp-server"]);
    assert.equal(options.shell, false);
    assert.equal(options.env.UNRELATED_SECRET, undefined);
    assert.equal(options.env.FINLY_G4_PRODUCTION_ENABLED, "true");
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    let input = "";
    child.stdin.on("data", (chunk) => { input += chunk.toString("utf8"); });
    child.stdin.on("finish", () => {
      capture.input = JSON.parse(input);
      child.stdout.end(JSON.stringify({
        schema_version: "alpaca_mcp_stock_mutation_ack.v1",
        isError: false,
        ...PINNED_ALPACA_STOCK_MCP_METADATA,
        raw_response_retained: false,
      }));
      queueMicrotask(() => child.emit("close", 0));
    });
    return child;
  };
}

test("pinned stock MCP client forwards the exact G4 projection and a minimal environment", async () => {
  const capture = {};
  const result = await runPinnedStockMcpBridge(projection, {
    pythonCommand: "/private/fake/python",
    serverCommand: "/private/fake/alpaca-mcp-server",
    bridgePath: "/private/fake/bridge.py",
    accessImpl: async () => {},
    spawnImpl: spawnSuccess(capture),
    environment: {
      FINLY_G4_PRODUCTION_ENABLED: "true",
      FINLY_EXECUTION_ENABLED: "true",
      FINLY_EXECUTION_TRANSPORT: "mcp",
      ALPACA_PAPER_TRADE: "true",
      FINLY_PAPER_MUTATION_ACK: "ack",
      ALPACA_API_KEY: "paper-key",
      ALPACA_SECRET_KEY: "paper-secret",
      UNRELATED_SECRET: "must-not-cross",
    },
  });
  assert.deepEqual(capture.input, projection);
  assert.equal(result.isError, false);
});

test("pinned stock MCP client rejects symbol, side, and notional drift before spawning", async () => {
  for (const changed of [
    { ...projection, symbol: "SPY" },
    { ...projection, side: "sell" },
    { ...projection, notional: "50000.01" },
  ]) {
    let spawned = false;
    await assert.rejects(() => runPinnedStockMcpBridge(changed, {
      accessImpl: async () => {},
      spawnImpl: () => { spawned = true; },
    }), /outside/u);
    assert.equal(spawned, false);
  }
});
