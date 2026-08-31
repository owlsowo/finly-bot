import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { competitionWindowState } from "./autonomous_paper_agent.mjs";

const READINESS_LEAD_MS = 60 * 60 * 1_000;
const FINAL_GRACE_MS = 2 * 60 * 60 * 1_000;

export function evaluateCloudRunGate({
  environment = process.env,
  eventName = "workflow_dispatch",
  initializeRequested = false,
  now = new Date(),
} = {}) {
  const window = competitionWindowState(environment, now);
  const observedMs = new Date(window.observed_at).getTime();
  const startMs = new Date(window.start_at).getTime();
  const endMs = new Date(window.end_at).getTime();
  if (initializeRequested) {
    if (eventName !== "workflow_dispatch") throw new Error("cloud state initialization requires a manual workflow run");
    if (window.status !== "WAITING_FOR_COMPETITION_WINDOW") throw new Error("cloud state initialization is locked after the competition begins");
    return { should_run: true, mode: "initialize", mutation_enabled: false, window_status: window.status };
  }
  if (window.status === "COMPETITION_WINDOW_OPEN") {
    return { should_run: true, mode: "live", mutation_enabled: true, window_status: window.status };
  }
  if (window.status === "WAITING_FOR_COMPETITION_WINDOW" && startMs - observedMs <= READINESS_LEAD_MS) {
    return { should_run: true, mode: "readiness", mutation_enabled: false, window_status: window.status };
  }
  if (window.status === "COMPETITION_WINDOW_ENDED" && observedMs - endMs <= FINAL_GRACE_MS) {
    return { should_run: true, mode: "final", mutation_enabled: false, window_status: window.status };
  }
  return { should_run: false, mode: "idle", mutation_enabled: false, window_status: window.status };
}

async function main() {
  const result = evaluateCloudRunGate({
    eventName: process.env.GITHUB_EVENT_NAME,
    initializeRequested: process.env.INITIALIZE_REQUESTED === "true",
  });
  const output = process.env.GITHUB_OUTPUT;
  if (typeof output !== "string" || output.length < 1) throw new Error("GitHub output path is unavailable");
  await appendFile(output, [
    `should_run=${String(result.should_run)}`,
    `mode=${result.mode}`,
    `mutation_enabled=${String(result.mutation_enabled)}`,
    `window_status=${result.window_status}`,
    "",
  ].join("\n"));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch(() => {
    process.stderr.write("Finly cloud window gate rejected this run.\n");
    process.exitCode = 1;
  });
}
