import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AlpacaPaperRestClient } from "../lib/alpaca_rest.mjs";
import { buildFreshCurrentEconomicBundle } from "../lib/current_economic_bundle.mjs";
import {
  alpacaHistoricalCredentialsFromEnv,
  HistoricalAlpacaClient,
} from "../lib/historical_alpaca.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destinations = [
  resolve(projectRoot, "public/data/current_economic_decision.json"),
  resolve(projectRoot, "evidence/current_economic_decision.json"),
  resolve(projectRoot, "src/data/current_economic_decision.json"),
];

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function writeCurrentEconomicBundleCopies(bundle, paths = destinations) {
  for (const destination of paths) await atomicJson(destination, bundle);
  return paths;
}

export async function runCurrentEconomicDecision({
  environment = process.env,
  now = () => new Date(),
  writeArtifacts = environment.FINLY_CURRENT_DECISION_WRITE_ARTIFACTS !== "false",
} = {}) {
  const credentials = alpacaHistoricalCredentialsFromEnv(environment);
  const historicalClient = new HistoricalAlpacaClient(credentials);
  const paperClient = new AlpacaPaperRestClient({
    keyId: credentials.keyId,
    secretKey: credentials.secretKey,
  });
  const bundle = await buildFreshCurrentEconomicBundle({
    historicalClient,
    paperClient,
    now,
    lastRebalanceDate: environment.FINLY_LAST_ECONOMIC_REBALANCE_DATE ?? null,
  });
  const outputs = writeArtifacts ? await writeCurrentEconomicBundleCopies(bundle) : [];
  return { bundle, outputs };
}

async function main() {
  const { bundle, outputs } = await runCurrentEconomicDecision();
  if (process.env.FINLY_CURRENT_DECISION_PRINT_FULL === "true") {
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    return;
  }
  console.log(JSON.stringify({
    artifact_sha256: bundle.artifact_sha256,
    observed_end: bundle.data.observed_end,
    completed_session_boundary: bundle.data.completed_session_boundary,
    source_fetch_completed_at: bundle.data.source_fetch_completed_at,
    current_spy_weight: bundle.paper_account_boundary.current_spy_weight,
    decision: bundle.risk_committee_decision.decision,
    target: bundle.risk_committee_decision.final_allocation,
    mutation_requested: bundle.mutation_requested,
    output: outputs.map((path) => path.slice(projectRoot.length + 1)),
  }, null, 2));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`Current economic decision failed: ${String(error?.message ?? error).slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}
