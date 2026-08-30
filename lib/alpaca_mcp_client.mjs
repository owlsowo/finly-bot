import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPinnedMcpArguments, assertPinnedMcpExitArguments } from "./alpaca.mjs";
import { POLICY } from "./policy.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPython = resolve(projectRoot, ".venv-alpaca-mcp/bin/python");
const defaultServer = resolve(projectRoot, ".venv-alpaca-mcp/bin/alpaca-mcp-server");
const defaultBridge = resolve(projectRoot, "scripts/alpaca_mcp_bridge.py");
const maximumOutputBytes = 32_768;

export const PINNED_ALPACA_MCP_METADATA = Object.freeze({
  server: "alpaca-mcp-server",
  version: POLICY.alpacaMcpVersion,
  tool: "place_option_order",
  schema_sha256: POLICY.placeOptionOrderSchemaSha256,
});

function executablePath(value, fallback, label) {
  const selected = value || fallback;
  if (typeof selected !== "string" || !isAbsolute(selected)) throw new Error(`${label} must be an absolute local path`);
  return selected;
}

function boundedAppend(current, chunk, label) {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next) > maximumOutputBytes) throw new Error(`${label} exceeded the bounded output size`);
  return next;
}

function safeChildEnvironment(environment) {
  const allowed = [
    "PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE", "NO_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
    "FINLY_EXECUTION_ENABLED", "FINLY_EXECUTION_TRANSPORT", "FINLY_PAPER_MUTATION_ACK",
    "ALPACA_PAPER_TRADE", "ALPACA_API_KEY", "ALPACA_SECRET_KEY", "APCA_API_KEY_ID", "APCA_API_SECRET_KEY",
  ];
  return Object.fromEntries(allowed
    .filter((name) => typeof environment[name] === "string")
    .map((name) => [name, environment[name]]));
}

export async function runPinnedMcpBridge(arguments_, {
  pythonCommand = defaultPython,
  serverCommand = defaultServer,
  bridgePath = defaultBridge,
  environment = process.env,
  spawnImpl = spawn,
  accessImpl = access,
  timeoutMs = 40_000,
  orderKind = "entry",
} = {}) {
  if (orderKind === "entry") assertPinnedMcpArguments(arguments_);
  else if (orderKind === "exit") assertPinnedMcpExitArguments(arguments_);
  else throw new Error("MCP bridge order kind is outside policy");
  const python = executablePath(pythonCommand, defaultPython, "MCP Python command");
  const server = executablePath(serverCommand, defaultServer, "MCP server command");
  const bridge = executablePath(bridgePath, defaultBridge, "MCP bridge path");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error("MCP bridge timeout is outside policy");
  await Promise.all([
    accessImpl(python, constants.X_OK),
    accessImpl(server, constants.X_OK),
    accessImpl(bridge, constants.R_OK),
  ]);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(python, [bridge, "--server-command", server], {
      cwd: projectRoot,
      env: safeChildEnvironment(environment),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Alpaca MCP bridge timed out"));
    }, timeoutMs);
    child.once("error", (error) => finish(new Error(`Alpaca MCP bridge failed to start: ${error.message}`)));
    child.stdout.on("data", (chunk) => {
      try { stdout = boundedAppend(stdout, chunk, "Alpaca MCP stdout"); } catch (error) { child.kill("SIGKILL"); finish(error); }
    });
    child.stderr.on("data", (chunk) => {
      try { stderr = boundedAppend(stderr, chunk, "Alpaca MCP stderr"); } catch (error) { child.kill("SIGKILL"); finish(error); }
    });
    child.once("close", (code) => {
      if (code !== 0) {
        finish(new Error("Alpaca MCP bridge failed: paper mutation bridge rejected the request"));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const exactMetadata = parsed?.server === PINNED_ALPACA_MCP_METADATA.server
          && parsed?.version === PINNED_ALPACA_MCP_METADATA.version
          && parsed?.tool === PINNED_ALPACA_MCP_METADATA.tool
          && parsed?.schema_sha256 === PINNED_ALPACA_MCP_METADATA.schema_sha256;
        if (parsed?.schema_version !== "alpaca_mcp_mutation_ack.v1"
          || parsed?.isError !== false
          || parsed?.raw_response_retained !== false
          || !exactMetadata) {
          throw new Error("Alpaca MCP bridge returned an invalid acknowledgement");
        }
        finish(null, parsed);
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.end(`${JSON.stringify(arguments_)}\n`);
  });
}

export class AlpacaMcpMutationClient {
  constructor(options = {}) {
    this.options = options;
  }

  async placeOptionOrder(arguments_) {
    return runPinnedMcpBridge(arguments_, { ...this.options, orderKind: "entry" });
  }

  async placeExitOrder(arguments_) {
    return runPinnedMcpBridge(arguments_, { ...this.options, orderKind: "exit" });
  }
}
