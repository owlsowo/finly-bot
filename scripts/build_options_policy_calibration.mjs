import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableStringify } from "../lib/canonical.mjs";
import { buildOptionsPolicyCalibration } from "../lib/options_policy_calibration.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inputPath = resolve(projectRoot, "fixtures/spy_adjusted_closes_20160104_20260828.json");
const defaultOutputPaths = [
  resolve(projectRoot, "evidence/options_policy_calibration.json"),
  resolve(projectRoot, "public/data/options_policy_calibration.json"),
];

export async function buildCalibrationArtifact({ outputPaths = defaultOutputPaths, verifyExisting = false } = {}) {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const artifact = buildOptionsPolicyCalibration(input);
  const serialized = `${stableStringify(artifact)}\n`;
  for (const outputPath of outputPaths) {
    if (verifyExisting) {
      const existing = await readFile(outputPath, "utf8");
      if (existing !== serialized) throw new Error("checked-in options policy calibration differs from deterministic rebuild");
    } else {
      await writeFile(outputPath, serialized, { flag: "w" });
    }
  }
  return artifact;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const verifyExisting = process.argv.slice(2).includes("--verify-existing");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--verify-existing");
  if (unknown.length > 0) throw new Error(`unknown arguments: ${unknown.join(", ")}`);
  const artifact = await buildCalibrationArtifact({ verifyExisting });
  process.stdout.write(`${JSON.stringify({
    artifact_sha256: artifact.artifact_sha256,
    sample_count: artifact.sampling.sample_count,
    fair_eligible: artifact.results.fair_surface.eligible_count,
    favorable_eligible: artifact.results.favorable_surface.eligible_count,
    claim_boundary: "signal/quote-surface eligibility; not options P&L",
  })}\n`);
}
