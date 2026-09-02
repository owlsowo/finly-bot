import react from "@vitejs/plugin-react";
import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const hostedDataAllowlist = new Set([
  "attempt150_public_evidence.json",
  "competition-deployment-record.json",
  "competition_forward_profit_2026_08_31.json",
  "competition_forward_profit_2026_09_02.json",
  "competition_live.json",
  "latest_receipt.json",
  "no_trade_receipt.json",
  "options_live_decision_funnel_2026_09_02.json",
  "options_policy_calibration.json",
  "quantitative_release_gate.json",
]);

const pruneInternalResearchData = {
  name: "prune-internal-research-data",
  apply: "build" as const,
  async closeBundle() {
    const dataDirectory = resolve(import.meta.dirname, "dist/data");
    const entries = await readdir(dataDirectory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || hostedDataAllowlist.has(entry.name)) return;
      await rm(resolve(dataDirectory, entry.name));
    }));
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(), pruneInternalResearchData],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
