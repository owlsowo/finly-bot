import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { stableStringify } from "../lib/canonical.mjs";
import { runDecision } from "../lib/pipeline.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(projectRoot, "fixtures/spy_bearish_replay.json");
const publicPath = resolve(projectRoot, "public/data/latest_receipt.json");
const outputPath = resolve(projectRoot, "outputs/replay_receipt.json");
const abstainPublicPath = resolve(projectRoot, "public/data/no_trade_receipt.json");
const abstainOutputPath = resolve(projectRoot, "outputs/no_trade_receipt.json");
const sourcePath = resolve(projectRoot, "src/data/latest_receipt.json");
const abstainSourcePath = resolve(projectRoot, "src/data/no_trade_receipt.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const receipt = await runDecision({ fixture, planner: new DeterministicReplayPlanner() });
const conflictedFixture = {
  ...fixture,
  run_id: "decision_demo_spy_conflict_20260828_143505",
  decision_time: "2026-08-28T18:35:05.000Z",
  signals: fixture.signals.map((signal) => {
    if (signal.family === "market") return { ...signal, direction_score: 0.72, explanation: "Price trend is positive." };
    if (signal.family === "options") return { ...signal, direction_score: 0.20, explanation: "Options surface is weakly positive." };
    if (signal.family === "events") return { ...signal, direction_score: -0.88, explanation: "Event evidence points in the opposite direction." };
    return { ...signal, direction_score: -0.76, explanation: "Prediction evidence conflicts with price state." };
  }),
};
const abstainReceipt = await runDecision({ fixture: conflictedFixture, planner: new DeterministicReplayPlanner() });

await mkdir(dirname(publicPath), { recursive: true });
await mkdir(dirname(outputPath), { recursive: true });
const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
const abstainRendered = `${JSON.stringify(abstainReceipt, null, 2)}\n`;
await writeFile(publicPath, rendered, { mode: 0o644 });
await writeFile(outputPath, rendered, { mode: 0o644 });
await writeFile(abstainPublicPath, abstainRendered, { mode: 0o644 });
await writeFile(abstainOutputPath, abstainRendered, { mode: 0o644 });
await writeFile(sourcePath, rendered, { mode: 0o644 });
await writeFile(abstainSourcePath, abstainRendered, { mode: 0o644 });

const selected = receipt.compilation.selected;
process.stdout.write(`${stableStringify({
  receipt_id: receipt.receipt_id,
  decision: receipt.certificate.decision,
  certified: receipt.certificate.certified,
  quantity: receipt.certificate.quantity,
  max_loss: receipt.certificate.reserved_max_loss,
  conservative_ev: selected?.conservative_ev ?? null,
  source_removal_passed: receipt.source_removal.passed,
  perturbations_passed: receipt.perturbations?.passed ?? false,
  abstain_decision: abstainReceipt.certificate.decision,
  abstain_certified: abstainReceipt.certificate.certified,
})}\n`);
