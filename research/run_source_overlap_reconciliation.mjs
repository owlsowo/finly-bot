import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AlpacaReconciliationClient,
  buildReconciliationReport,
  credentialsFromEnvironment,
  RECONCILIATION_SYMBOLS,
} from "./source_overlap_reconciliation.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolPath = resolve(projectRoot, "research/source_overlap_reconciliation_protocol.json");
const generation4OutputPath = resolve(projectRoot, "research/output/quant_champion_generation4.json");
const outputPath = resolve(projectRoot, "research/output/source_overlap_reconciliation.json");
const reportPath = resolve(projectRoot, "research/output/source_overlap_reconciliation_report.md");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function redact(message, secrets) {
  let safe = String(message ?? "unknown reconciliation error");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) safe = safe.split(secret).join("[REDACTED]");
  }
  return safe;
}

function renderMarkdown(report) {
  const rows = Object.values(report.reconciliation.per_symbol).map((item) => {
    const metric = item.ordinary_session_log_return_comparison;
    const adjustment = item.corporate_action_adjustment_diagnostic;
    return `| ${item.symbol} | ${item.common_sessions} | ${(100 * item.yahoo_date_coverage_by_alpaca).toFixed(2)}% | ${metric.log_return_correlation === null ? "n/a" : metric.log_return_correlation.toFixed(5)} | ${metric.median_absolute_log_return_difference_bps.toFixed(2)} | ${metric.p99_absolute_log_return_difference_bps.toFixed(2)} | ${adjustment.excluded_interval_count} (${(100 * adjustment.excluded_interval_fraction).toFixed(2)}%) | ${item.passed ? "PASS" : "FAIL"} |`;
  }).join("\n");
  const candidate = report.reconciliation.candidate;
  const exclusions = Object.values(report.reconciliation.per_symbol).map((item) => (
    `${item.symbol}: ${item.corporate_action_adjustment_diagnostic.excluded_interval_date_examples.join(", ") || "none"}`
  )).join("  \n");
  return `# Generation 4 source-overlap reconciliation\n\nProtocol: \`${report.protocol_sha256}\`  \n\n## Answer first\n\n**${report.disposition}** as of ${report.generated_at}. This is a source-concordance check against the exact content-addressed Yahoo panel used by Generation 4; it is not a second out-of-sample profitability test.\n\n| Symbol | Common sessions | Yahoo dates covered | Ordinary log-return corr. | Median gap (bp) | P99 gap (bp) | Distribution intervals excluded | Result |\n|---|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\n## Candidate-level result\n\n- Fully common panel: ${candidate.common_panel_start} to ${candidate.common_panel_end} (${candidate.common_panel_sessions} sessions).\n- Exact top-three sector agreement: ${(100 * candidate.candidate_signal_comparison.exact_top_three_agreement_fraction).toFixed(2)}%.\n- Mean top-three Jaccard agreement: ${(100 * candidate.candidate_signal_comparison.mean_top_three_jaccard).toFixed(2)}%.\n- Candidate daily log-return correlation: ${candidate.candidate_return_comparison.daily_log_return_correlation.toFixed(6)}.\n- Candidate annualized log-return tracking error: ${(100 * candidate.candidate_return_comparison.annualized_log_return_tracking_error).toFixed(3)}%.\n- Yahoo versus Alpaca candidate-minus-SPY log-growth edge difference: ${candidate.candidate_vs_spy_edge.absolute_edge_difference_bps_per_year.toFixed(2)} bp/year.\n\n## Disclosed distribution-interval exclusions\n\nYahoo adjusted close includes distributions; Alpaca \`adjustment=split\` does not. The protocol therefore identifies intervals where Alpaca \`all\` and \`split\` log returns differ by more than 0.01 bp, excludes only those intervals from the ordinary-session price-feed fidelity gate, discloses every date in JSON, and caps exclusions at 8% per symbol. Up to ten examples per symbol follow:\n\n${exclusions}\n\n## Boundary\n\nYahoo values are the stored adjusted-close points from the Generation 4 private panel. The ordinary-session feed check uses authenticated, read-only Alpaca IEX \`adjustment=split\` bars. The candidate-level total-return-like diagnostic uses Alpaca \`adjustment=all\`. IEX is a single-exchange feed, so exact close equality with Yahoo is not expected. Split-versus-all differences identify adjustment intervals but do not classify individual corporate actions.\n\nOfficial Alpaca references: [historical bars](https://docs.alpaca.markets/us/reference/stockbars), [IEX versus SIP](https://docs.alpaca.markets/us/docs/market-data-faq).\n\n${report.reconciliation.blocking_reasons.length > 0 ? `Blocking reasons: ${report.reconciliation.blocking_reasons.join("; ")}.` : "No source-concordance gate failed."}\n`;
}

const credentials = credentialsFromEnvironment();
const secrets = [credentials.keyId, credentials.secretKey];

async function run() {
  const protocolRaw = await readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw);
  const generation4Raw = await readFile(generation4OutputPath, "utf8");
  const generation4 = JSON.parse(generation4Raw);
  if (protocol.status !== "FROZEN_BEFORE_AUTHENTICATED_READ"
    || protocol.generation4_lock?.generation4_output_sha256 !== sha256(generation4Raw)
    || JSON.stringify(protocol.symbols) !== JSON.stringify(RECONCILIATION_SYMBOLS)) {
    throw new Error("source-overlap protocol does not match the locked Generation 4 artifact or implementation");
  }
  if (generation4.raw_return_track?.selected_id_before_recent_and_robustness !== "qqq_core_sector_12_6") {
    throw new Error("Generation 4 output does not select qqq_core_sector_12_6 for raw-return robustness");
  }
  const panelFilename = generation4.dataset?.private_panel_filename;
  if (typeof panelFilename !== "string" || !/^generation4_panel_[a-f0-9]{64}\.json$/.test(panelFilename)) {
    throw new Error("Generation 4 private panel filename is invalid");
  }
  const privatePanelPath = resolve(projectRoot, "data/private/champion_search", panelFilename);
  const privatePanelRaw = await readFile(privatePanelPath, "utf8");
  if (sha256(privatePanelRaw) !== generation4.dataset.private_panel_payload_sha256) {
    throw new Error("Generation 4 private panel payload hash does not match the public receipt");
  }
  const privatePanel = JSON.parse(privatePanelRaw);
  if (privatePanel.normalized_panel_sha256 !== generation4.dataset.normalized_panel_sha256) {
    throw new Error("Generation 4 private panel normalized hash does not match the public receipt");
  }
  if (!Array.isArray(privatePanel.points) || privatePanel.points.length < 1_000) {
    throw new Error("Generation 4 private panel is missing or too short");
  }
  for (const symbol of RECONCILIATION_SYMBOLS) {
    if (!privatePanel.points.every((point) => Number.isFinite(point[symbol]) && point[symbol] > 0)) {
      throw new Error(`Generation 4 private panel is incomplete for ${symbol}`);
    }
  }
  const yahooSeriesBySymbol = Object.fromEntries(RECONCILIATION_SYMBOLS.map((symbol) => [symbol, privatePanel.points.map((point) => ({
    date: point.date,
    close: point[symbol],
  }))]));
  const start = protocol.dates?.requested_start;
  const end = protocol.dates?.requested_end;
  if (privatePanel.points[0].date !== start || privatePanel.points.at(-1).date !== end) {
    throw new Error("source-overlap protocol dates do not match the locked Generation 4 panel");
  }
  const client = new AlpacaReconciliationClient({ ...credentials });
  const split = await client.getDailyBars(RECONCILIATION_SYMBOLS, { start, end, feed: "iex", adjustment: "split" });
  const all = await client.getDailyBars(RECONCILIATION_SYMBOLS, { start, end, feed: "iex", adjustment: "all" });
  const reconciliation = buildReconciliationReport({
    yahooSeriesBySymbol,
    alpacaSplitSeriesBySymbol: split.series_by_symbol,
    alpacaAllSeriesBySymbol: all.series_by_symbol,
    thresholds: protocol.pass_thresholds,
  });
  const report = Object.freeze({
    schema_version: "finly_generation4_source_overlap_reconciliation.v1",
    generated_at: new Date().toISOString(),
    disposition: reconciliation.passed ? "PASS_SOURCE_RECONCILIATION" : "FAIL_CLOSED",
    candidate_id: "qqq_core_sector_12_6",
    protocol_sha256: sha256(protocolRaw),
    generation4_output_sha256: sha256(generation4Raw),
    generation4_protocol_sha256: generation4.protocol_sha256,
    generation4_panel_sha256: generation4.dataset.normalized_panel_sha256,
    generation4_private_panel_payload_sha256: generation4.dataset.private_panel_payload_sha256,
    stored_yahoo_source: Object.freeze({
      provider: "Yahoo Finance chart endpoint",
      field: "chart.result[0].indicators.adjclose[0].adjclose",
      snapshot: "exact content-addressed Generation 4 private panel",
      start,
      end,
    }),
    alpaca_split_source: split.provenance,
    alpaca_all_source: all.provenance,
    reconciliation,
    limitations: Object.freeze([
      "The Alpaca IEX feed represents one exchange, while Yahoo closing values may reflect a broader market-data construction.",
      "Both adjusted series can be revised retrospectively by their providers; the Yahoo side is frozen at the Generation 4 snapshot, while Alpaca is queried at the report timestamp.",
      "Split-versus-all log-return differences show where adjustment semantics change the series but do not identify specific corporate-action events.",
      "Passing this check supports source concordance only; it does not prove future profitability or remove universe-selection and survivorship bias.",
    ]),
  });
  await atomicWrite(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(reportPath, renderMarkdown(report));
  process.stdout.write(`${JSON.stringify({
    ok: reconciliation.passed,
    disposition: report.disposition,
    common_panel_sessions: reconciliation.candidate.common_panel_sessions,
    exact_signal_agreement: reconciliation.candidate.candidate_signal_comparison.exact_top_three_agreement_fraction,
    output: outputPath,
    report: reportPath,
  }, null, 2)}\n`);
  if (!reconciliation.passed) process.exitCode = 2;
}

try {
  await run();
} catch (error) {
  const message = redact(error?.message, secrets);
  const failure = Object.freeze({
    schema_version: "finly_generation4_source_overlap_reconciliation.v1",
    generated_at: new Date().toISOString(),
    disposition: "FAIL_CLOSED",
    candidate_id: "qqq_core_sector_12_6",
    execution_error: message,
    blocking_reasons: Object.freeze(["source-overlap reconciliation did not complete"]),
  });
  await atomicWrite(outputPath, `${JSON.stringify(failure, null, 2)}\n`);
  await atomicWrite(reportPath, `# Generation 4 source-overlap reconciliation\n\n**FAIL_CLOSED**: ${message}\n`);
  process.stderr.write(`Source-overlap reconciliation failed closed: ${message}\n`);
  process.exitCode = 1;
}
