import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AlpacaStockMcpMutationClient } from "./alpaca_stock_mcp_client.mjs";
import {
  FileG4OfficialCheckpointStore,
  G4_OFFICIAL_STATE_DIRECTORY,
  loadG4OfficialProductionProtocol,
  runG4OfficialEquityCycle,
  splitG4OfficialBrokerView,
} from "./g4_official_equity.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolvedPath(candidate, fallback) {
  if (!candidate) return resolve(projectRoot, fallback);
  return isAbsolute(candidate) ? candidate : resolve(projectRoot, candidate);
}

/**
 * Process-local coordinator for the signed one-time G4 allocation. The READY
 * receipt is deliberately ephemeral: every fresh process must first reconcile
 * the durable lifecycle state against the broker before options can see data.
 */
export async function createG4OfficialEquityCoordinator({
  client,
  environment = process.env,
  signingSecret,
  stateCheckpoint,
  mutationClient,
  store,
  now = () => new Date(),
} = {}) {
  if (!client || client.tradingBase !== "https://paper-api.alpaca.markets") {
    throw new Error("G4 coordinator requires the exact Alpaca paper client");
  }
  const protocol = await loadG4OfficialProductionProtocol();
  const checkpointStore = store ?? new FileG4OfficialCheckpointStore(
    resolvedPath(environment.FINLY_G4_CHECKPOINT_PATH, G4_OFFICIAL_STATE_DIRECTORY),
  );
  const stockMutationClient = mutationClient ?? new AlpacaStockMcpMutationClient({
    environment,
    ...(environment.FINLY_MCP_PYTHON
      ? { pythonCommand: resolvedPath(environment.FINLY_MCP_PYTHON) }
      : {}),
    ...(environment.FINLY_MCP_SERVER_COMMAND
      ? { serverCommand: resolvedPath(environment.FINLY_MCP_SERVER_COMMAND) }
      : {}),
  });
  let latestReadinessReceipt = null;

  const coordinator = {
    protocol_hash: protocol.protocol_hash,
    async advance({ observedAt = now() } = {}) {
      latestReadinessReceipt = null;
      const result = await runG4OfficialEquityCycle({
        protocol,
        store: checkpointStore,
        signingSecret,
        client,
        mutationClient: stockMutationClient,
        expectedAccountId: environment.FINLY_COMPETITION_ACCOUNT_ID,
        environment,
        now: observedAt,
        stateCheckpoint,
      });
      latestReadinessReceipt = result.status === "G4_EQUITY_READY" ? result.readiness_receipt : null;
      return result;
    },
    splitOptionsBrokerView({ positions, openOrders }) {
      if (latestReadinessReceipt === null) throw new Error("G4 equity READY receipt is absent in this process");
      const split = splitG4OfficialBrokerView({
        positions,
        openOrders,
        protocol,
        readinessReceipt: latestReadinessReceipt,
      });
      return Object.freeze({
        positions: Object.freeze([...split.optionPositions]),
        openOrders: Object.freeze([...split.optionOrders]),
      });
    },
  };
  return Object.freeze(coordinator);
}
