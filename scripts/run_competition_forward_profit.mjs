import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { stableStringify } from "../lib/canonical.mjs";
import {
  AlpacaForwardProfitReadClient,
  alpacaForwardProfitCredentialsFromEnv,
} from "../lib/competition_forward_profit_alpaca.mjs";

const runnerTemp = process.env.RUNNER_TEMP;
if (typeof runnerTemp !== "string" || !isAbsolute(runnerTemp)) {
  throw new Error("competition forward-profit runner requires an absolute RUNNER_TEMP");
}

const [contract, activityBaseline] = await Promise.all([
  readFile(new URL("../config/competition-forward-profit.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config/competition-forward-profit-activity-baseline.json", import.meta.url), "utf8")
    .then(JSON.parse),
]);

const client = new AlpacaForwardProfitReadClient({
  ...alpacaForwardProfitCredentialsFromEnv(),
});
const measurement = await client.measure({ contract, activityBaseline });
const serialized = `${stableStringify(measurement)}\n`;
if (/account_number|activity_id|order[_-]?id|api[_-]?key|secret|credential|token/iu.test(serialized)) {
  throw new Error("competition forward-profit output failed its privacy boundary");
}

const outputDirectory = join(runnerTemp, "finly-forward-profit");
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const outputPath = join(outputDirectory, "measurement.json");
await writeFile(outputPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });

console.log(stableStringify({
  status: measurement.status,
  observed_at: measurement.observed_at,
  common_valued_at: measurement.common_valued_at,
  profitable: measurement.primary_kpi?.profitable ?? null,
  outperformed_spy: measurement.secondary_kpi?.outperformed_spy ?? null,
  claim_publishable: measurement.integrity.claim_publishable,
}));
