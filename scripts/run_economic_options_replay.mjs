import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEconomicOptionsReplayArtifact } from "../lib/economic_options_replay.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destinations = [
  resolve(projectRoot, "public/data/economic_options_overlay_replay.json"),
];

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

const artifact = await buildEconomicOptionsReplayArtifact();
for (const destination of destinations) await atomicJson(destination, artifact);
console.log(JSON.stringify({
  ok: true,
  artifact_sha256: artifact.artifact_sha256,
  branches: artifact.branches.map((branch) => ({
    name: branch.name,
    direction: branch.intent.direction,
    direction_score: branch.intent.direction_score,
    options_action: branch.options_compilation.action,
    certified_synthetic_scope: branch.synthetic_certificate.certified,
    reserved_maximum_loss: branch.synthetic_certificate.reserved_maximum_loss,
  })),
  checked_invariants: artifact.checked_invariants,
  mutation_requested: false,
  output: destinations.map((path) => path.slice(projectRoot.length + 1)),
}, null, 2));
