import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { round, sha256 } from "./champion_engine.mjs";
import { CORE_SYMBOLS } from "./champion_strategies.mjs";
import {
  ATTRIBUTION_CANDIDATE_ID,
  ATTRIBUTION_COMPARATOR_IDS,
  calendarYearAttribution,
  factorLikeExposureAttribution,
  grossReturnContributions,
  rollingReturnDifferenceAttribution,
  sectorSelectionAttribution,
  standaloneComparison,
  turnoverAndCostAttribution,
  validateAlignedRows,
  weightAttribution,
} from "./champion_generation4_attribution.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateDirectory = resolve(projectRoot, "data/private/champion_search");
const outputDirectory = resolve(projectRoot, "research/output");
const panelFilename = "generation4_panel_91a53ac73e785d2ccb8db043cce6d808b9a851d7e95da7031bb227e8b40d1014.json";
const ledgerFilename = "generation4_ledger_6f656b79d7a4e836eda3b85d35bfca34841e80c0da16a2afdef30e862d8a23e1.json.gz";
const jsonOutputPath = resolve(outputDirectory, "quant_champion_generation4_attribution.json");
const markdownOutputPath = resolve(outputDirectory, "quant_champion_generation4_attribution_report.md");

const CRISIS_SLICES = Object.freeze({
  gfc_available_peak_to_trough: Object.freeze({
    start: "2008-06-02",
    end: "2009-03-09",
    label: "GFC, available-ledger start to the March 2009 trough",
  }),
  euro_debt_us_downgrade_drawdown: Object.freeze({
    start: "2011-04-29",
    end: "2011-10-03",
    label: "2011 euro-area debt / U.S. downgrade drawdown",
  }),
  covid_crash: Object.freeze({
    start: "2020-02-19",
    end: "2020-03-23",
    label: "COVID crash, prior SPY peak to trough",
  }),
  inflation_tightening_bear: Object.freeze({
    start: "2022-01-03",
    end: "2022-10-12",
    label: "2022 inflation / tightening bear-market drawdown",
  }),
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function expectedHashFromFilename(filename) {
  const match = filename.match(/_([a-f0-9]{64})\.json(?:\.gz)?$/);
  invariant(match, `content-addressed filename is malformed: ${filename}`);
  return match[1];
}

function topEntries(record, key, count = 5) {
  return Object.entries(record).sort((left, right) => right[1][key] - left[1][key]).slice(0, count);
}

function percent(value, digits = 2) {
  return `${(100 * value).toFixed(digits)}%`;
}

function renderReport(report) {
  const targetWeights = report.weights.decision_weighted_target_weights;
  const realizedWeights = report.weights.time_weighted_realized_start_of_return_weights;
  const selectionRows = topEntries(report.sector_selection.by_sector, "decision_frequency", 9)
    .map(([symbol, item]) => `| ${symbol} | ${item.selected_decisions} | ${percent(item.decision_frequency)} | ${percent(targetWeights[symbol])} | ${percent(realizedWeights[symbol])} |`)
    .join("\n");
  const yearRows = report.calendar_years.map((item) => `| ${item.year}${item.partial_year ? "*" : ""} | ${percent(item.total_returns[ATTRIBUTION_CANDIDATE_ID])} | ${percent(item.total_returns.spy_buy_hold)} | ${percent(item.total_returns.static_spy_qqq_50_50_control)} | ${percent(item.total_returns.qqq_buy_hold)} |`)
    .join("\n");
  const crisisRows = Object.values(report.crisis_slices).map((item) => `| ${item.label} | ${percent(item.comparison.metrics[ATTRIBUTION_CANDIDATE_ID].total_return)} | ${percent(item.comparison.metrics.spy_buy_hold.total_return)} | ${percent(item.comparison.metrics.static_spy_qqq_50_50_control.total_return)} | ${percent(item.comparison.metrics.qqq_buy_hold.total_return)} |`)
    .join("\n");
  const rollingRows = Object.values(report.rolling_candidate_vs_spy.by_sessions).map((item) => {
    const stats = item.candidate_minus_spy_total_return_difference;
    return `| ${item.sessions} | ${stats.count} | ${percent(stats.mean)} | ${percent(stats.median)} | ${percent(stats.p05)} | ${percent(stats.p95)} | ${percent(stats.positive_fraction)} |`;
  }).join("\n");
  const contributionRows = topEntries(report.gross_return_contributions.by_asset, "initial_capital_return_contribution", CORE_SYMBOLS.length)
    .filter(([, item]) => Math.abs(item.initial_capital_return_contribution) > 1e-10)
    .map(([symbol, item]) => `| ${symbol} | ${item.initial_capital_return_contribution.toFixed(3)} | ${percent(item.share_of_total_gross_return)} |`)
    .join("\n");
  const weights = report.weights.direct_concentration_proxies;
  const factors = report.factor_like_exposure_proxies;
  const full = report.standalone_summaries.post_2013_full_history.metrics;
  const candidate = full[ATTRIBUTION_CANDIDATE_ID];
  const spy = full.spy_buy_hold;
  const control = full.static_spy_qqq_50_50_control;
  const qqq = full.qqq_buy_hold;
  const periodRows = Object.entries(report.standalone_summaries).map(([id, item]) => `| ${id === "requested_2013_2015" ? "2013–2015" : `2013–${item.observed_end}`} | ${percent(item.metrics[ATTRIBUTION_CANDIDATE_ID].total_return)} | ${percent(item.metrics.spy_buy_hold.total_return)} | ${percent(item.metrics.static_spy_qqq_50_50_control.total_return)} | ${percent(item.metrics.qqq_buy_hold.total_return)} |`)
    .join("\n");
  const qqqContributionShare = report.gross_return_contributions.by_asset.QQQ.share_of_total_gross_return;
  const qqqXlkContributionShare = qqqContributionShare
    + report.gross_return_contributions.by_asset.XLK.share_of_total_gross_return;
  return `# Finly Generation 4 selected-candidate attribution\n\n## Boundary\n\n**Post-selection, descriptive diagnostic only.** Candidate \`${ATTRIBUTION_CANDIDATE_ID}\` was fixed before this analysis. Nothing here is a search criterion, validation gate, fresh out-of-sample test, or permission to change the selected strategy. Inputs are the content-addressed frozen Generation 4 private panel and ledger only.\n\n## Answer first\n\nFrom 2013 through ${candidate.end_date}, standalone net return was ${percent(candidate.total_return)} for the candidate, versus ${percent(spy.total_return)} for SPY, ${percent(control.total_return)} for the static 50/50 SPY/QQQ control, and ${percent(qqq.total_return)} for QQQ. The candidate's direct average start-of-return exposure was ${percent(weights.average_qqq_weight)} QQQ and ${percent(weights.average_xlk_weight)} XLK; QQQ plus XLK averaged ${percent(weights.average_qqq_plus_xlk_direct_weight)}, but that is not a look-through technology weight. Daily gross-return correlation was ${factors.correlations.candidate_gross_with_qqq.toFixed(3)} with QQQ and ${factors.correlations.candidate_gross_with_static_spy_qqq_control.toFixed(3)} with the static control. These numbers show substantial growth/technology exposure; they do not by themselves decide whether all gains came from that exposure.\n\n## Sector selection and average weights\n\n${report.sector_selection.executed_rebalance_decisions} executed monthly rebalance decisions, with three sector slots per decision. QQQ's average target and realized weights were ${percent(targetWeights.QQQ)} and ${percent(realizedWeights.QQQ)}, respectively.\n\n| Sector | Decisions selected | Decision frequency | Average target weight | Average realized weight |\n|---|---:|---:|---:|---:|\n${selectionRows}\n\n## Gross-return contribution\n\nContributions are in terminal initial-capital return points and reconcile to compounded gross return before costs.\n\n| Position | Gross contribution | Share of gross return |\n|---|---:|---:|\n${contributionRows}\n\nDirect QQQ produced ${percent(qqqContributionShare)} of gross return; direct QQQ plus XLK produced ${percent(qqqXlkContributionShare)}. Reconciliation error: \`${report.gross_return_contributions.reconciliation_error}\`. Modeled transaction-cost simple sum was ${percent(report.turnover_and_costs.modeled_transaction_cost_simple_sum)} of contemporaneous portfolio value across the full path; annualized turnover was ${report.turnover_and_costs.annualized_turnover_notional_including_terminal_liquidation.toFixed(2)}x.\n\n## Standalone requested periods\n\nEach period charges a fresh 5 bp one-way entry and terminal exit.\n\n| Period | Candidate | SPY | Static 50/50 | QQQ |\n|---|---:|---:|---:|---:|\n${periodRows}\n\n## Standalone calendar years\n\nEach row charges a new 5 bp one-way entry and exit boundary. Asterisks denote partial years.\n\n| Year | Candidate | SPY | Static 50/50 | QQQ |\n|---|---:|---:|---:|---:|\n${yearRows}\n\n## Conventional crisis slices\n\nThese are hindsight-labeled, standalone peak/trough windows and are descriptive—not independent stress tests.\n\n| Slice | Candidate | SPY | Static 50/50 | QQQ |\n|---|---:|---:|---:|---:|\n${crisisRows}\n\n## Overlapping rolling candidate-minus-SPY differences\n\nThese compound the already-recorded continuous net returns without adding artificial boundary trades to every window.\n\n| Sessions | Windows | Mean | Median | P05 | P95 | Win fraction |\n|---:|---:|---:|---:|---:|---:|---:|\n${rollingRows}\n\nThe windows overlap heavily and are autocorrelated; counts and win fractions are not independent trials or p-values.\n\n## Exposure proxies and caveats\n\nThe market-plus-growth proxy regression has SPY-minus-BIL beta ${factors.regressions.market_and_growth_proxy.coefficients.spy_minus_bil.toFixed(3)}, QQQ-minus-SPY beta ${factors.regressions.market_and_growth_proxy.coefficients.qqq_minus_spy.toFixed(3)}, and R² ${factors.regressions.market_and_growth_proxy.r_squared.toFixed(3)}. The static-control-plus-XLK proxy regression has R² ${factors.regressions.static_control_and_tech_proxy.r_squared.toFixed(3)}. The exposure pattern explains most daily variation and QQQ/XLK supplied most gross return, while the candidate still exceeded the static control by ${(100 * (candidate.total_return - control.total_return)).toFixed(2)} cumulative percentage points since 2013 and trailed all-QQQ by ${(100 * (qqq.total_return - candidate.total_return)).toFixed(2)} cumulative percentage points. That combination is consistent with a dominant growth exposure plus a smaller sector-rotation difference; it is not proof that rotation generated persistent alpha. These are ETF proxies, not academic factors, and their in-sample linearized intercepts are not alpha claims. Gross contribution omits trading costs, crisis endpoints are chosen with hindsight, QQQ overlaps technology holdings, the ETF menu is fixed and limited, all evidence was consumed during strategy development, and 2026 is partial.\n`;
}

const panelPath = resolve(privateDirectory, panelFilename);
const ledgerPath = resolve(privateDirectory, ledgerFilename);
const [panelRaw, ledgerGzip] = await Promise.all([readFile(panelPath), readFile(ledgerPath)]);
const panelPayloadHash = hashBytes(panelRaw);
const ledgerGzipHash = hashBytes(ledgerGzip);
invariant(panelPayloadHash === expectedHashFromFilename(panelFilename), "frozen Generation 4 panel payload hash mismatch");
invariant(ledgerGzipHash === expectedHashFromFilename(ledgerFilename), "frozen Generation 4 ledger gzip hash mismatch");
const panel = JSON.parse(panelRaw.toString("utf8"));
const ledgerRaw = gunzipSync(ledgerGzip);
const ledger = JSON.parse(ledgerRaw.toString("utf8"));
invariant(panel.schema_version === "finly_generation4_private_panel.v1", "unexpected frozen panel schema");
invariant(ledger.schema_version === "finly_generation4_private_ledger.v1", "unexpected frozen ledger schema");
invariant(panel.normalized_panel_sha256 === ledger.normalized_panel_sha256, "frozen panel and ledger lineage mismatch");
const recomputedNormalizedPanelHash = sha256(panel.points.map((point) => [
  point.date,
  ...CORE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
]));
invariant(recomputedNormalizedPanelHash === panel.normalized_panel_sha256, "frozen panel normalized hash mismatch");

const requiredIds = [ATTRIBUTION_CANDIDATE_ID, ...ATTRIBUTION_COMPARATOR_IDS];
const rowsById = Object.fromEntries(requiredIds.map((id) => {
  invariant(Array.isArray(ledger.simulations[id]), `frozen ledger omits ${id}`);
  return [id, ledger.simulations[id]];
}));
const alignment = validateAlignedRows(rowsById);
const candidateRows = rowsById[ATTRIBUTION_CANDIDATE_ID];
const firstDate = candidateRows[0].execution_return_date;
const lastDate = candidateRows.at(-1).execution_return_date;

const report = Object.freeze({
  schema_version: "finly_generation4_selected_candidate_attribution.v1",
  generated_at: new Date().toISOString(),
  boundary: Object.freeze({
    classification: "post_selection_descriptive_diagnostic",
    fixed_candidate_id: ATTRIBUTION_CANDIDATE_ID,
    may_change_candidate_selection: false,
    creates_new_validation_gate: false,
    fresh_out_of_sample_evidence: false,
    statement: "The candidate was selected before this diagnostic. This output can explain exposures and failure modes but cannot alter the frozen search, selection, or trial count.",
  }),
  frozen_inputs: Object.freeze({
    panel_filename: panelFilename,
    panel_payload_sha256: panelPayloadHash,
    normalized_panel_sha256: panel.normalized_panel_sha256,
    panel_protocol_sha256: panel.protocol_sha256,
    panel_points: panel.points.length,
    panel_start: panel.points[0].date,
    panel_end: panel.points.at(-1).date,
    ledger_filename: ledgerFilename,
    ledger_gzip_sha256: ledgerGzipHash,
    ledger_uncompressed_sha256: hashBytes(ledgerRaw),
    selected_row_count: candidateRows.length,
    selected_row_start: firstDate,
    selected_row_end: lastDate,
  }),
  alignment,
  sector_selection: sectorSelectionAttribution(candidateRows),
  weights: weightAttribution(candidateRows, CORE_SYMBOLS),
  gross_return_contributions: grossReturnContributions(candidateRows, CORE_SYMBOLS),
  turnover_and_costs: turnoverAndCostAttribution(candidateRows),
  standalone_summaries: Object.freeze({
    requested_2013_2015: standaloneComparison(rowsById, "2013-01-01", "2015-12-31"),
    post_2013_full_history: standaloneComparison(rowsById, "2013-01-01", lastDate),
  }),
  calendar_years: calendarYearAttribution(rowsById),
  crisis_slices: Object.freeze(Object.fromEntries(Object.entries(CRISIS_SLICES).map(([id, slice]) => [id, Object.freeze({
    label: slice.label,
    hindsight_labeled: true,
    comparison: standaloneComparison(rowsById, slice.start, slice.end),
  })]))),
  rolling_candidate_vs_spy: rollingReturnDifferenceAttribution(candidateRows, rowsById.spy_buy_hold),
  factor_like_exposure_proxies: factorLikeExposureAttribution(candidateRows, rowsById.static_spy_qqq_50_50_control),
  limitations: Object.freeze([
    "All rows were consumed before this post-selection diagnostic; none is fresh out-of-sample evidence.",
    "Overlapping rolling windows are dependent and must not be read as independent observations or significance tests.",
    "Conventional crisis dates are selected with hindsight and standalone boundary trades are modeled, not historical fills.",
    "ETF regressions are factor-like exposure proxies, not academic factor tests; no p-values or causal alpha claims are supplied.",
    "QQQ and XLK overlap economically, so direct-position sums understate look-through complexity and cannot identify pure technology exposure.",
    "Gross-return contribution excludes costs; turnover and transaction costs are reported separately under the frozen 5 bp one-way model.",
    "The fixed ETF universe may embed availability, construction, and survivorship-like menu bias; 2026 is partial.",
  ]),
});

await atomicWrite(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(markdownOutputPath, renderReport(report));
process.stdout.write(`${JSON.stringify({
  ok: true,
  classification: report.boundary.classification,
  candidate: ATTRIBUTION_CANDIDATE_ID,
  panel_sha256: panelPayloadHash,
  ledger_sha256: ledgerGzipHash,
  rows: candidateRows.length,
  json: jsonOutputPath,
  report: markdownOutputPath,
}, null, 2)}\n`);
