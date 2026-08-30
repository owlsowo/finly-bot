import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { compareRollingMonthlyContributions } from "./recurring_contribution_complete_months.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const protocolPath = resolve(projectRoot, "research/recurring_contribution_protocol.json");
const jsonOutputPath = resolve(projectRoot, "research/output/recurring_contribution_analysis.json");
const markdownOutputPath = resolve(projectRoot, "research/output/recurring_contribution_analysis_report.md");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function dollars(value) {
  return `$${Number(value).toFixed(2)}`;
}

function percent(value) {
  return `${(100 * Number(value)).toFixed(1)}%`;
}

function compactSimulation(simulation) {
  return Object.freeze(Object.fromEntries(
    Object.entries(simulation).filter(([key]) => key !== "path"),
  ));
}

function compactWindow(window) {
  return Object.freeze({
    ...window,
    candidate: compactSimulation(window.candidate),
    benchmark: compactSimulation(window.benchmark),
  });
}

function compactAnalysis(analysis) {
  const horizons = {};
  for (const [months, horizon] of Object.entries(analysis.horizons)) {
    horizons[months] = Object.freeze({
      horizon_months: horizon.horizon_months,
      summary: horizon.summary,
      latest_window: compactWindow(horizon.latest_window),
      windows: Object.freeze(horizon.windows.map(compactWindow)),
    });
  }
  return Object.freeze({
    ...analysis,
    schema_version: "finly_rolling_monthly_contributions_compact.v3",
    detail_boundary: "Window-level account summaries are retained. Daily balance paths can be regenerated only from the content-addressed local gzip ledger, which is intentionally not redistributed; public verification therefore checks the frozen outputs and hashes rather than reconstructing the private source ledger.",
    horizons: Object.freeze(horizons),
  });
}

function renderMarkdown(report) {
  const table = Object.values(report.analysis.horizons).map((item) => {
    const summary = item.summary;
    const latest = item.latest_window;
    return `| ${item.horizon_months} | ${summary.windows} | ${percent(summary.candidate_beat_benchmark_fraction)} | ${dollars(summary.median_ending_value_advantage)} | ${dollars(summary.p05_ending_value_advantage)} | ${dollars(latest.ending_value_advantage)} |`;
  }).join("\n");
  const threeMonth = report.analysis.horizons["3"].latest_window;
  return `# Finly recurring-contribution replay\n\n## Answer first\n\nFor the latest complete three-calendar-month path, identical $300 monthly deposits ended at **${dollars(threeMonth.candidate.ending_value)}** in the frozen G4 nonproduction shadow allocation and **${dollars(threeMonth.benchmark.ending_value)}** in SPY, a retrospective difference of **${dollars(threeMonth.ending_value_advantage)}**. This number is a historical replay, not a forecast.\n\n| Horizon (months) | Rolling windows | G4 beat SPY | Median ending advantage | 5th-percentile advantage | Latest advantage |\n|---:|---:|---:|---:|---:|---:|\n${table}\n\n## What this does and does not test\n\nThe replay uses the exact frozen, causal Generation 4 ETF ledgers; starts each rolling account from cash; applies the declared 5 bp entry and later-deposit purchase costs; permits fractional ETF units; and ends mark-to-market. The one-month calendar windows do not overlap; longer horizons overlap heavily, and every summary shares the same consumed historical path. The analysis does **not** replay option premiums, predict the next three months, or convert these dependent windows into independent win probabilities.\n\nProtocol SHA-256: \`${report.input_integrity.protocol_sha256}\`  \nLedger SHA-256: \`${report.input_integrity.ledger_gzip_sha256}\`\n`;
}

async function main() {
  const protocolBytes = await readFile(protocolPath);
  const protocol = JSON.parse(protocolBytes.toString("utf8"));
  invariant(protocol.schema_version === "finly_recurring_contribution_protocol.v2", "protocol schema mismatch");
  invariant(protocol.status === "amended_after_completeness_audit_before_release", "protocol amendment status mismatch");

  const outputBytes = await readFile(resolve(projectRoot, protocol.inputs.generation_4_output.path));
  invariant(sha256(outputBytes) === protocol.inputs.generation_4_output.sha256, "Generation 4 output hash mismatch");
  const championOutput = JSON.parse(outputBytes.toString("utf8"));
  invariant(championOutput.raw_return_track?.selected_id_before_recent_and_robustness === protocol.inputs.candidate_id,
    "protocol candidate is not the frozen Generation 4 selection");

  const moduleBytes = await readFile(resolve(projectRoot, protocol.inputs.cash_flow_module.path));
  invariant(sha256(moduleBytes) === protocol.inputs.cash_flow_module.sha256, "cash-flow module hash mismatch");
  const wrapperBytes = await readFile(resolve(projectRoot, protocol.inputs.complete_month_wrapper.path));
  invariant(sha256(wrapperBytes) === protocol.inputs.complete_month_wrapper.sha256, "complete-month wrapper hash mismatch");

  const ledgerBytes = await readFile(resolve(projectRoot, protocol.inputs.generation_4_private_ledger.path));
  invariant(sha256(ledgerBytes) === protocol.inputs.generation_4_private_ledger.gzip_sha256, "ledger gzip hash mismatch");
  const ledger = JSON.parse(gunzipSync(ledgerBytes).toString("utf8"));
  const candidateRows = ledger.simulations?.[protocol.inputs.candidate_id];
  const benchmarkRows = ledger.simulations?.[protocol.inputs.benchmark_id];
  invariant(Array.isArray(candidateRows) && Array.isArray(benchmarkRows), "required ledgers are absent");

  const analysis = compareRollingMonthlyContributions(candidateRows, benchmarkRows, {
    horizonsMonths: protocol.scenario.horizons_calendar_months,
    monthlyContribution: protocol.scenario.monthly_contribution_usd,
    cashSymbol: "BIL",
    oneWayCostBps: protocol.scenario.one_way_cost_bps,
    minimumStartDate: protocol.scenario.minimum_start_date,
  });
  const compact = compactAnalysis(analysis);
  const report = Object.freeze({
    schema_version: "finly_recurring_contribution_analysis.v3",
    protocol_originally_frozen_at: protocol.created_at,
    protocol_amended_at: protocol.amended_at,
    amendment: protocol.amendment,
    candidate_id: protocol.inputs.candidate_id,
    benchmark_id: protocol.inputs.benchmark_id,
    input_integrity: Object.freeze({
      protocol_sha256: sha256(protocolBytes),
      generation_4_output_sha256: sha256(outputBytes),
      cash_flow_module_sha256: sha256(moduleBytes),
      complete_month_wrapper_sha256: sha256(wrapperBytes),
      ledger_gzip_sha256: sha256(ledgerBytes),
    }),
    claim_boundary: protocol.claim_boundary,
    analysis: compact,
  });
  await atomicWrite(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(markdownOutputPath, renderMarkdown(report));
  process.stdout.write(`${JSON.stringify({
    output: jsonOutputPath,
    report: markdownOutputPath,
    latest_three_month: compact.horizons["3"].latest_window,
  }, null, 2)}\n`);
}

if (process.argv[1] === modulePath) await main();
