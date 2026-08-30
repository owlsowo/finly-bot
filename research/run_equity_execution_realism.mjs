import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EQUITY_EXECUTION_REALISM_PROTOCOL,
  EQUITY_EXECUTION_REALISM_PUBLICATION_BOUNDARY,
  importImmutableClosePanel,
  importImmutableOhlc,
  round,
  runCloseOnlySensitivity,
  runCompleteNextOpenStudy,
} from "./equity_execution_realism.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");
const receiptPath = resolve(projectRoot, "research/alpaca_adjustment_all_panel_generation6_result_receipt.json");
const economicPath = resolve(projectRoot, "outputs/economic_research_full.json");
const jsonOutputPath = resolve(projectRoot, "research/output/equity_execution_realism.json");
const markdownOutputPath = resolve(projectRoot, "research/output/equity_execution_realism_report.md");
const evaluationStart = "2025-01-01";

const missingOhlcExperiment = Object.freeze({
  status: "UNAVAILABLE_IMMUTABLE_ADJUSTED_AND_RAW_OHLC_REQUIRED",
  reason: "The immutable Alpaca artifact available to this runner contains adjusted closes, but no opens and no raw/distribution-excluded OHLC book. A close-derived proxy is not relabeled as next-open execution.",
  required_fields: Object.freeze([
    "adjusted.SPY[].date/open/close",
    "adjusted.BIL[].date/open/close",
    "raw.SPY[].date/open/close",
    "raw.BIL[].date/open/close",
  ]),
  excluded_prior_aggregate: "A prior authenticated in-memory scratch read was not persisted. Its aggregate result is excluded because it cannot be reproduced from immutable OHLC.",
  credential_free_acquisition_recipe: Object.freeze({
    method: "GET",
    endpoints: Object.freeze([
      "https://data.alpaca.markets/v2/stocks/SPY/bars",
      "https://data.alpaca.markets/v2/stocks/BIL/bars",
    ]),
    shared_parameters: Object.freeze({
      start: "2016-01-01",
      end: "2026-08-28T20:15:00.000Z",
      timeframe: "1Day",
      feed: "sip",
      sort: "asc",
      limit: 10000,
    }),
    acquire_twice_with_adjustment: Object.freeze(["all", "raw"]),
    persistence_rule: "Persist only credential-free normalized date/open/close rows plus a content hash; never persist request headers or credentials.",
  }),
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function bytesSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function parseArguments(argv) {
  let ohlcPath = process.env.FINLY_EXECUTION_REALISM_OHLC_PATH ?? null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--ohlc") throw new Error(`unknown argument: ${argument}`);
    invariant(index + 1 < argv.length, "--ohlc requires a local JSON path");
    ohlcPath = argv[index + 1];
    index += 1;
  }
  return Object.freeze({ ohlcPath });
}

function verifyPolicyLock(economic) {
  const protocol = economic?.protocol;
  invariant(protocol?.schema_version === "finly_economic_research_protocol.v1", "economic protocol schema mismatch");
  invariant(protocol.preregistered_candidate_id === "tsmom_ensemble_vol", "frozen candidate mismatch");
  invariant(economic?.final_holdout?.selected_candidate_id === "tsmom_ensemble_vol", "final selected candidate mismatch");
  invariant(protocol.rebalance_frequency === "every five market sessions", "frozen rebalance frequency mismatch");
  invariant(protocol.target_annualized_volatility === 0.1, "frozen target volatility mismatch");
  invariant(protocol.maximum_gross_exposure === 1, "frozen maximum exposure mismatch");
  invariant(protocol.leverage_allowed === false, "frozen leverage rule mismatch");
  invariant(protocol.shorting_allowed_by_selected_policy === false, "frozen shorting rule mismatch");
  invariant(protocol.cash_proxy === "BIL adjusted daily return", "frozen cash proxy mismatch");
  invariant(protocol.preregistered_candidate_definition === "Equal-weight positive-trend fraction across 21-, 63-, and 252-session SPY-minus-BIL return horizons, multiplied by an unlevered 10% 20-session SPY realized-volatility target; unallocated exposure earns the observed BIL return.", "frozen candidate definition mismatch");
  return Object.freeze({
    selected_policy_id: protocol.preregistered_candidate_id,
    definition: protocol.preregistered_candidate_definition,
    rebalance_frequency: protocol.rebalance_frequency,
    source_execution_lag: protocol.execution_lag,
    execution_realism_change: "Signal definition and five-session cadence remain fixed; this private audit changes the assumed fill from next close to next open when immutable OHLC is supplied.",
  });
}

function closeBookFromPanel(panel) {
  const points = panel?.strategy_intersection?.points;
  invariant(Array.isArray(points), "Alpaca panel omits strategy intersection points");
  return Object.freeze({
    SPY: Object.freeze(points.map((point) => Object.freeze({ date: point.date, close: point.SPY }))),
    BIL: Object.freeze(points.map((point) => Object.freeze({ date: point.date, close: point.BIL }))),
  });
}

function closeDiagnostics(panel) {
  const points = panel.points;
  const symbolDiagnostics = {};
  for (const symbol of ["SPY", "BIL"]) {
    let unchanged = 0;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
      const value = points[index][symbol];
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      if (index > 0 && value === points[index - 1][symbol]) unchanged += 1;
    }
    symbolDiagnostics[symbol] = Object.freeze({
      observations: points.length,
      unchanged_close_transitions: unchanged,
      unchanged_close_transition_fraction: round(unchanged / (points.length - 1)),
      minimum_close: minimum,
      maximum_close: maximum,
    });
  }
  return Object.freeze(symbolDiagnostics);
}

function portablePath(path) {
  const local = relative(projectRoot, path);
  return local.startsWith("..") ? "external-local-input.json" : local;
}

async function loadOptionalOhlc(path) {
  if (!path) return Object.freeze({ study: missingOhlcExperiment, integrity: null });
  const resolvedPath = resolve(projectRoot, path);
  const bytes = await readFile(resolvedPath);
  const payload = JSON.parse(bytes.toString("utf8"));
  const imported = importImmutableOhlc(payload, { minimumSessions: 255, requireRaw: true });
  if (imported.source_binding) {
    invariant(bytesSha256(bytes) === imported.source_binding.bundle_sha256,
      "content-addressed Finly OHLC bundle byte hash mismatch");
  }
  const study = runCompleteNextOpenStudy(imported, {
    evaluationStart,
    evaluationEnd: imported.adjusted.common_end,
  });
  return Object.freeze({
    study,
    integrity: Object.freeze({
      input_filename: basename(resolvedPath),
      file_sha256: bytesSha256(bytes),
      normalized_payload_sha256: imported.payload_sha256,
      adjusted_normalized_sha256: imported.adjusted.normalized_sha256,
      raw_normalized_sha256: imported.raw.normalized_sha256,
      common_start: imported.adjusted.common_start,
      common_end: imported.adjusted.common_end,
      common_sessions: imported.adjusted.common_sessions,
      source_binding: imported.source_binding,
    }),
  });
}

function percent(value, digits = 2) {
  return `${(100 * Number(value)).toFixed(digits)}%`;
}

function metricRow(label, metrics) {
  return `| ${label} | ${metrics.observations} | ${percent(metrics.total_return)} | ${percent(metrics.annualized_return)} | ${percent(metrics.annualized_volatility)} | ${percent(metrics.maximum_drawdown)} | ${percent(metrics.spy_total_return)} |`;
}

function costTable(study) {
  return Object.entries(study.cost_stress_bps_per_leg).map(([cost, metrics]) => metricRow(`${cost} bp`, metrics)).join("\n");
}

function cadenceTable(study) {
  return EQUITY_EXECUTION_REALISM_PROTOCOL.cadence_anchors.map((anchor) => {
    const continuous = study.continuous_cadence_anchors_at_1bp[String(anchor)];
    const fresh = study.fresh_start_cadence_anchors_at_1bp[String(anchor)];
    return `| ${anchor} | ${percent(continuous.total_return)} | ${percent(continuous.maximum_drawdown)} | ${percent(fresh.total_return)} | ${percent(fresh.maximum_drawdown)} |`;
  }).join("\n");
}

function renderMarkdown(report) {
  const nextOpen = report.next_open_execution_realism;
  const nextOpenAvailable = nextOpen.status === "AVAILABLE_CONSUMED_RETROSPECTIVE_EXECUTION_REALISM";
  const adjustedOneBp = nextOpenAvailable
    ? nextOpen.adjusted_theoretical_total_return.cost_stress_bps_per_leg["1"]
    : null;
  const adjustedTwentyFiveBp = nextOpenAvailable
    ? nextOpen.adjusted_theoretical_total_return.cost_stress_bps_per_leg["25"]
    : null;
  const answerFirst = nextOpenAvailable
    ? `The immutable, content-addressed Alpaca OHLC bundle reproduces a **${percent(adjustedOneBp.total_return)}** adjusted theoretical return at 1 bp per traded leg, versus **${percent(adjustedOneBp.spy_total_return)}** for SPY over the same consumed 2025–2026 path. At 25 bp per leg the result remains positive at **${percent(adjustedTwentyFiveBp.total_return)}**; the raw/no-distribution proxy is **${percent(nextOpen.raw_no_distribution_proxy.metrics_at_1bp.total_return)}**; and the $300 fractional proxy ends at **$${nextOpen.small_account_proxy.ending_equity_usd.toFixed(2)}**. Finly did **not** beat SPY on total return in this period, and these retrospective mechanics do not prove alpha or future profit.`
    : "The current immutable Alpaca input can support a **close-rebalance sensitivity only**. It cannot support a next-open fill claim because it contains no opens and no raw/distribution-excluded book. This audit therefore fails closed: it reports the close-only result under its true name and does not reproduce or publish the prior ephemeral +16.38% aggregate. None of the results below proves alpha or future profit.";
  const nextOpenSection = nextOpenAvailable
    ? `Immutable adjusted and raw OHLC were supplied. The table below is a theoretical next-open ledger, not a paper-fill receipt.\n\n| Cost per traded leg | Observations | Total return | Annualized return | Annualized volatility | Maximum drawdown | SPY total return |\n|---:|---:|---:|---:|---:|---:|---:|\n${costTable(nextOpen.adjusted_theoretical_total_return)}\n\nRaw/no-distribution proxy at 1 bp: **${percent(nextOpen.raw_no_distribution_proxy.metrics_at_1bp.total_return)}**. The $300 fractional proxy ended at **$${nextOpen.small_account_proxy.ending_equity_usd.toFixed(2)}**.`
    : `**Unavailable.** ${nextOpen.reason}\n\nThe earlier in-memory scratch aggregate is intentionally absent. To unlock this test, provide a credential-free immutable JSON snapshot with adjusted and raw SPY/BIL date/open/close rows using \`node research/run_equity_execution_realism.mjs --ohlc <local-json>\`.`;
  const smallAccountBoundary = nextOpenAvailable
    ? "Mathematically feasible in the shadow ledger; actual fractional eligibility, fills, and regulatory fees still require broker receipts"
    : "Unavailable until immutable opens exist; fractional eligibility and actual regulatory fees require broker receipts";
  return `# Finly equity execution-realism audit\n\n## Answer first\n\n${answerFirst}\n\n## Next-open experiment\n\n${nextOpenSection}\n\n## Available close-rebalance sensitivity — not execution realism\n\n${report.close_rebalance_sensitivity.warning}\n\n| Cost per traded leg | Observations | Total return | Annualized return | Annualized volatility | Maximum drawdown | SPY total return |\n|---:|---:|---:|---:|---:|---:|---:|\n${costTable(report.close_rebalance_sensitivity)}\n\nFive possible five-session cadence anchors at 1 bp show how much an arbitrary weekday-like phase changes the consumed path. “Fresh” starts the portfolio in BIL at the evaluation boundary instead of carrying pre-period state.\n\n| Anchor | Continuous return | Continuous max drawdown | Fresh-start return | Fresh-start max drawdown |\n|---:|---:|---:|---:|---:|\n${cadenceTable(report.close_rebalance_sensitivity)}\n\n## Execution assumptions that can erase paper profitability\n\n| Issue | Encoded treatment | Remaining boundary |\n|---|---|---|\n| Spread, slippage, market impact | Symmetric 1/5/10/25 bp per traded leg stress | Daily OHLC cannot reproduce quotes, queue position, halts, or price improvement |\n| Distributions and cash yield | Adjusted SPY/BIL OHLC plus a raw/no-distribution proxy when the immutable bundle is present | Alpaca paper equity and historical adjusted-return accounting are not identical |\n| Small-account feasibility | The generic OHLC engine supports $300, sell-first, $1 minimum, nine-decimal quantities, cash-capped buys, and a $0.01 sell-day fee proxy | ${smallAccountBoundary} |\n| Tax and borrow | No taxes; no borrow cost because the frozen policy is long-only and unlevered | Taxable-account after-tax performance is untested |\n| ETF universe | Only fixed SPY and BIL are consumed | The inherited 20-ETF source panel is a current-survivor menu and cannot support asset-selection claims |\n| BIL staleness/rounding | The pinned close panel has ${percent(report.close_data_quality.BIL.unchanged_close_transition_fraction)} unchanged BIL close transitions | Coarsely rounded closes can suppress daily cash-proxy variation |\n\n## Theory versus Alpaca paper\n\nAn adjusted-OHLC ledger is total-return theory. A raw/no-distribution ledger is only a closer proxy for paper-equity display. Neither is an Alpaca fill receipt. A paper round trip must preserve submitted order, broker acknowledgement, fill price and time, fees, fractional quantity, and exact account read-back without authorizing live-money execution.\n\n## Reproduction and claim boundary\n\nThis artifact consumed frozen historical evidence only; it made no network call and no broker mutation. Close panel SHA-256: \`${report.input_integrity.alpaca_close_panel_file_sha256}\`. Policy source SHA-256: \`${report.input_integrity.economic_research_file_sha256}\`.${report.input_integrity.optional_ohlc ? ` OHLC bundle SHA-256: \`${report.input_integrity.optional_ohlc.file_sha256}\`.` : ""}\n\n${report.claim_boundary}\n`;
}

async function main() {
  const { ohlcPath } = parseArguments(process.argv.slice(2));
  const receiptBytes = await readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  invariant(receipt.schema_version === "finly_generation6_alpaca_adjustment_all_panel_result_receipt.v2", "Alpaca receipt schema mismatch");
  invariant(receipt.request.adjustment === "all", "Alpaca close panel is not adjustment=all");
  invariant(receipt.request.timeframe === "1Day", "Alpaca close panel is not daily");
  invariant(receipt.request.symbols.includes("SPY") && receipt.request.symbols.includes("BIL"), "Alpaca close panel omits SPY or BIL");

  const panelPath = resolve(projectRoot, receipt.panel.path);
  invariant(!relative(projectRoot, panelPath).startsWith(".."), "receipt panel path escapes project root");
  const panelBytes = await readFile(panelPath);
  invariant(bytesSha256(panelBytes) === receipt.panel.payload_sha256, "Alpaca panel payload hash mismatch");
  const panel = JSON.parse(panelBytes.toString("utf8"));
  invariant(panel.schema_version === receipt.panel.schema_version, "Alpaca panel schema mismatch");
  invariant(panel.strategy_intersection.observations === receipt.panel.strategy_intersection_observations, "Alpaca panel observation count mismatch");
  invariant(panel.strategy_intersection.start_date === receipt.panel.strategy_intersection_start_date, "Alpaca panel start mismatch");
  invariant(panel.strategy_intersection.end_date === receipt.panel.strategy_intersection_end_date, "Alpaca panel end mismatch");

  const economicBytes = await readFile(economicPath);
  const economic = JSON.parse(economicBytes.toString("utf8"));
  const policyLock = verifyPolicyLock(economic);
  const closePanel = importImmutableClosePanel(closeBookFromPanel(panel), { minimumSessions: 255 });
  const evaluationEnd = closePanel.common_end;
  const closeSensitivity = runCloseOnlySensitivity(closePanel, { evaluationStart, evaluationEnd });
  const optionalOhlc = await loadOptionalOhlc(ohlcPath);

  const result = Object.freeze({
    schema_version: "finly_equity_execution_realism_evidence.v1",
    evidence_class: "CONSUMED_RETROSPECTIVE_EXECUTION_REALISM",
    artifact_scope: "Credential-free reproducible aggregate; raw OHLC remains private and the frozen public claim surface is unchanged.",
    evidence_as_of: receipt.authenticated_read_completed_at,
    mutation_authorized: false,
    network_used: false,
    broker_mutation: false,
    alpha_proven: false,
    future_profitability_proven: false,
    publication_boundary: EQUITY_EXECUTION_REALISM_PUBLICATION_BOUNDARY,
    protocol: EQUITY_EXECUTION_REALISM_PROTOCOL,
    policy_lock: policyLock,
    evaluation: Object.freeze({
      start: evaluationStart,
      close_sensitivity_end: evaluationEnd,
      next_open_end: optionalOhlc.integrity?.common_end ?? null,
    }),
    input_integrity: Object.freeze({
      alpaca_close_receipt_path: portablePath(receiptPath),
      alpaca_close_receipt_file_sha256: bytesSha256(receiptBytes),
      alpaca_close_panel_path: portablePath(panelPath),
      alpaca_close_panel_file_sha256: bytesSha256(panelBytes),
      alpaca_close_panel_declared_sha256: receipt.panel.payload_sha256,
      alpaca_close_panel_normalized_spy_bil_sha256: closePanel.normalized_sha256,
      alpaca_provider: panel.provider,
      alpaca_feed: panel.request.feed,
      alpaca_adjustment: panel.request.adjustment,
      alpaca_common_start: closePanel.common_start,
      alpaca_common_end: closePanel.common_end,
      alpaca_common_sessions: closePanel.common_sessions,
      economic_research_path: portablePath(economicPath),
      economic_research_file_sha256: bytesSha256(economicBytes),
      optional_ohlc: optionalOhlc.integrity,
    }),
    close_data_quality: closeDiagnostics(closePanel),
    next_open_execution_realism: optionalOhlc.study,
    close_rebalance_sensitivity: closeSensitivity,
    theory_vs_paper: Object.freeze({
      adjusted_theory: "Corporate-action-adjusted OHLC supports a theoretical total-return ledger, including distributions through adjustment semantics.",
      raw_no_distribution_proxy: "Raw OHLC can approximate a paper-equity display that does not credit distributions, but is not a fill replay.",
      alpaca_paper: "Requires broker order/fill/account receipts; historical OHLC does not encode bid/ask spread, queue position, latency, partial fills, rejections, regulatory fees, or price improvement.",
      live_money: "Not authorized or tested.",
    }),
    omitted_economics: Object.freeze({
      taxes: "omitted",
      borrow: "not applicable to the frozen long-only, unlevered policy",
      dividends: optionalOhlc.integrity
        ? "adjusted next-open theory includes corporate-action adjustment; the separately acquired raw OHLC book supplies the disclosed no-distribution proxy"
        : "represented only through adjustment=all in the available close sensitivity; next-open adjusted/raw comparison unavailable without immutable OHLC",
      fractional_share_eligibility: "encoded as a generic $1/nine-decimal constraint only when OHLC is supplied; actual symbol/account eligibility needs a broker receipt",
      regulatory_fees: "one-cent per-sell-day proxy in the generic $300 engine; exact fee schedule and executions unverified",
    }),
    claim_boundary: "This consumed retrospective audit tests mechanics and sensitivity under disclosed assumptions. It does not establish alpha, a next-month SPY-beating probability, live/options profitability, or a promise of future returns. Close-only results are not next-open execution evidence.",
  });

  await atomicWrite(jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  await atomicWrite(markdownOutputPath, renderMarkdown(result));
  process.stdout.write(`${JSON.stringify({
    output: portablePath(jsonOutputPath),
    report: portablePath(markdownOutputPath),
    next_open_status: result.next_open_execution_realism.status,
    close_only_status: result.close_rebalance_sensitivity.status,
  }, null, 2)}\n`);
}

if (process.argv[1] === modulePath) await main();
