import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  PINNED_ALPACA_MCP_METADATA,
  runPinnedMcpBridge,
} from "../lib/alpaca_mcp_client.mjs";

const projection = Object.freeze({
  client_order_id: "finly-0123456789abcdefabcd",
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
    },
    {
      symbol: "SPY260904P00550000",
      ratio_qty: "1",
      side: "sell",
      position_intent: "sell_to_open",
    },
  ],
});

const exitProjection = Object.freeze({
  client_order_id: "finly-exit-0123456789abcdefabcd",
  order_class: "mleg",
  qty: "1",
  type: "limit",
  time_in_force: "day",
  limit_price: "-1.25",
  legs: [
    {
      symbol: "SPY260904P00560000",
      ratio_qty: "1",
      side: "sell",
      position_intent: "sell_to_close",
    },
    {
      symbol: "SPY260904P00550000",
      ratio_qty: "1",
      side: "buy",
      position_intent: "buy_to_close",
    },
  ],
});

function successfulSpawn(expectedEnvironment, capture) {
  return (command, args, options) => {
    assert.equal(command, "/private/fake/python");
    assert.deepEqual(args, ["/private/fake/bridge.py", "--server-command", "/private/fake/alpaca-mcp-server"]);
    assert.equal(options.shell, false);
    for (const [name, value] of Object.entries(expectedEnvironment)) assert.equal(options.env[name], value);
    assert.equal(options.env.UNRELATED_SECRET, undefined);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    let input = "";
    child.stdin.on("data", (chunk) => { input += chunk.toString("utf8"); });
    child.stdin.on("finish", () => {
      capture.input = JSON.parse(input);
      child.stdout.write(JSON.stringify({
        schema_version: "alpaca_mcp_mutation_ack.v1",
        isError: false,
        content: [{ type: "text" }],
        structuredContent: {},
        ...PINNED_ALPACA_MCP_METADATA,
        raw_response_retained: false,
      }));
      child.stdout.end();
      queueMicrotask(() => child.emit("close", 0));
    });
    return child;
  };
}

test("pinned MCP bridge forwards only allowlisted local configuration and never serializes credentials", async () => {
  const environment = {
    PATH: "/usr/bin",
    FINLY_EXECUTION_ENABLED: "true",
    FINLY_EXECUTION_TRANSPORT: "mcp",
    FINLY_PAPER_MUTATION_ACK: "paper-ack",
    ALPACA_PAPER_TRADE: "true",
    ALPACA_API_KEY: "local-api-key-value",
    ALPACA_SECRET_KEY: "local-secret-key-value",
    APCA_API_KEY_ID: "alternate-api-key-value",
    APCA_API_SECRET_KEY: "alternate-secret-key-value",
    UNRELATED_SECRET: "must-not-cross-the-process-boundary",
  };
  const forwardedEnvironment = Object.fromEntries(
    Object.entries(environment).filter(([name]) => name !== "UNRELATED_SECRET"),
  );
  const capture = {};
  const result = await runPinnedMcpBridge(projection, {
    pythonCommand: "/private/fake/python",
    serverCommand: "/private/fake/alpaca-mcp-server",
    bridgePath: "/private/fake/bridge.py",
    environment,
    accessImpl: async () => {},
    spawnImpl: successfulSpawn(forwardedEnvironment, capture),
  });
  assert.deepEqual(capture.input, projection);
  assert.equal(result.isError, false);
  assert.equal(result.raw_response_retained, false);
});

test("pinned MCP bridge rejects a mutated order projection before spawning a process", async () => {
  let spawned = false;
  await assert.rejects(
    () => runPinnedMcpBridge({ ...projection, qty: "5" }, {
      pythonCommand: "/private/fake/python",
      serverCommand: "/private/fake/alpaca-mcp-server",
      bridgePath: "/private/fake/bridge.py",
      accessImpl: async () => {},
      spawnImpl: () => { spawned = true; },
    }),
    /quantity is invalid/,
  );
  assert.equal(spawned, false);
});

test("pinned MCP bridge accepts only an explicit negative-credit closing projection for exits", async () => {
  const environment = {
    FINLY_EXECUTION_ENABLED: "true",
    FINLY_EXECUTION_TRANSPORT: "mcp",
    FINLY_PAPER_MUTATION_ACK: "paper-ack",
    ALPACA_PAPER_TRADE: "true",
  };
  const capture = {};
  const result = await runPinnedMcpBridge(exitProjection, {
    pythonCommand: "/private/fake/python",
    serverCommand: "/private/fake/alpaca-mcp-server",
    bridgePath: "/private/fake/bridge.py",
    environment,
    orderKind: "exit",
    accessImpl: async () => {},
    spawnImpl: successfulSpawn(environment, capture),
  });
  assert.deepEqual(capture.input, exitProjection);
  assert.equal(result.isError, false);
  await assert.rejects(
    () => runPinnedMcpBridge({ ...exitProjection, limit_price: "1.25" }, {
      orderKind: "exit",
      accessImpl: async () => {},
      spawnImpl: () => { throw new Error("must not spawn"); },
    }),
    /exit credit limit is invalid/,
  );
});

test("pinned MCP bridge never propagates untrusted subprocess diagnostics", async () => {
  const fakeSecret = "alpaca-secret-that-must-never-cross";
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    child.stdin.on("finish", () => {
      child.stderr.write(`${JSON.stringify({ status: "ERROR", error: "paper mutation bridge rejected the request" })}\n`);
      child.stderr.write(`untrusted diagnostic ${fakeSecret}\n`);
      child.stderr.end();
      queueMicrotask(() => child.emit("close", 1));
    });
    return child;
  };
  await assert.rejects(
    () => runPinnedMcpBridge(projection, {
      pythonCommand: "/private/fake/python",
      serverCommand: "/private/fake/alpaca-mcp-server",
      bridgePath: "/private/fake/bridge.py",
      accessImpl: async () => {},
      spawnImpl,
    }),
    (error) => {
      assert.match(error.message, /paper mutation bridge rejected the request/);
      assert.equal(error.message.includes(fakeSecret), false);
      assert.equal(error.message.includes("untrusted diagnostic"), false);
      return true;
    },
  );
});
