import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  appendForwardTrialSignalCommitment,
  verifyForwardTrialLedger,
} from "./forward_trial1.mjs";

export function parseForwardTrial1Cli(argv) {
  if (!Array.isArray(argv)) throw new TypeError("CLI arguments must be an array");
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--verify-existing")) {
    return Object.freeze({ mode: "verify" });
  }
  if (argv.length === 2 && argv[0] === "--append-signal-commitment") {
    if (typeof argv[1] !== "string" || argv[1].length === 0 || argv[1].startsWith("-")) {
      throw new Error("--append-signal-commitment requires one JSON path");
    }
    return Object.freeze({ mode: "append_signal_commitment", inputPath: argv[1] });
  }
  throw new Error("usage: node research/run_forward_trial1.mjs [--verify-existing | --append-signal-commitment <signal-input.json>]");
}

export async function runForwardTrial1Cli(argv = process.argv.slice(2), {
  environment = process.env,
  projectRoot,
} = {}) {
  const command = parseForwardTrial1Cli(argv);
  if (command.mode === "verify") return verifyForwardTrialLedger({ projectRoot });
  if (environment.FINLY_FORWARD_TRIAL1_WRITE_ACK !== "APPEND_SIGNAL_COMMITMENT_WRITE_ONCE") {
    throw new Error("append denied: set FINLY_FORWARD_TRIAL1_WRITE_ACK=APPEND_SIGNAL_COMMITMENT_WRITE_ONCE for this explicit local write");
  }
  const path = resolve(command.inputPath);
  const input = JSON.parse(await readFile(path, "utf8"));
  const result = await appendForwardTrialSignalCommitment(input, { projectRoot });
  return Object.freeze({
    mode: "append_signal_commitment",
    output_path: result.path,
    commitment_sha256: result.entry.commitment_sha256,
    verified_signal_commitments: result.verification.verified_signal_commitments,
    verified_settlements: result.verification.verified_settlements,
    phase: result.verification.phase,
    performance_inference_permitted: result.verification.performance_inference_permitted,
    broker_mutation_permitted_by_runner: false,
  });
}

async function main() {
  const result = await runForwardTrial1Cli();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`Forward Trial 1 failed closed: ${String(error?.message ?? error).slice(0, 800)}\n`);
    process.exitCode = 1;
  });
}
