import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  alignSeriesByDate,
  calculatePortfolioMetrics,
  compareMetrics,
  fetchYahooAdjustedSeries,
  quantile,
  rebaseRowsForStandalonePeriod,
  round,
  rowsWithin,
  sha256,
  simulateStrategy,
} from "./champion_engine.mjs";
import {
  buildEnsembleStrategies,
  CORE_SYMBOLS,
  createPrimaryStrategies,
  STRATEGY_METADATA,
} from "./champion_strategies.mjs";
import {
  createAegisLegacyProxyStrategies,
  createGeneration2LongOnlyStrategies,
  GENERATION2_METADATA,
} from "./champion_strategies_generation2.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolPath = resolve(projectRoot, "research/champion_search_corrected_protocol.json");
const trialLedgerPath = resolve(projectRoot, "research/champion_trial_ledger.json");
const outputDirectory = resolve(projectRoot, "research/output");
const privateDirectory = resolve(projectRoot, "data/private/champion_search");
const jsonOutput = resolve(outputDirectory, "quant_champion_corrected.json");
const reportOutput = resolve(outputDirectory, "quant_champion_corrected_report.md");
const GENERATION1_PANEL_SHA256 = "bff8cf19de33f6dfc511afee870d2ccd3c9da25c7a071888092707abecd80def";

const CANDIDATE_IDS = Object.freeze([
  ...Object.entries(STRATEGY_METADATA).filter(([, metadata]) => metadata.role === "candidate").map(([id]) => id),
  ...createGeneration2LongOnlyStrategies().map((strategy) => strategy.id),
]);

const BASELINE_IDS = Object.freeze([
  "bil_cash",
  "spy_buy_hold",
  "qqq_buy_hold",
  "spy_levered_150",
  "sixty_forty",
  "spy_vol_target_15",
  "frozen_finly",
]);

const SLICES = Object.freeze({
  development: Object.freeze({ start: "2008-06-02", end: "2017-12-29" }),
  validation_selection: Object.freeze({ start: "2018-01-02", end: "2024-12-31" }),
  consumed_recent_diagnostic: Object.freeze({ start: "2025-01-02", end: "2026-08-28" }),
  requested_2013_2015: Object.freeze({ start: "2013-01-01", end: "2015-12-31" }),
  post_2013_full_history: Object.freeze({ start: "2013-01-01", end: "2026-08-28" }),
  gfc: Object.freeze({ start: "2008-06-02", end: "2009-12-31" }),
  covid_2020: Object.freeze({ start: "2020-01-01", end: "2020-12-31" }),
  inflation_2022: Object.freeze({ start: "2022-01-01", end: "2022-12-31" }),
});

const BASE_OPTIONS = Object.freeze({
  cashSymbol: "BIL",
  lookbackSessions: 252,
  rebalanceIntervalSessions: 21,
  rebalanceAnchor: 0,
  oneWayCostBps: 5,
  annualBorrowSpread: 0.005,
  maximumRiskyGross: 1.5,
  terminalLiquidation: true,
});

function annualizedLogGrowth(metrics) {
  if (!metrics || metrics.observations < 2 || metrics.total_return <= -1) return null;
  return Math.log1p(metrics.total_return) * 252 / metrics.observations;
}

function median(values) {
  return values.length > 0 ? quantile(values, 0.5) : null;
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function atomicWriteBuffer(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { mode: 0o600 });
  await rename(temporary, path);
}

function sha256Bytes(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

async function fetchWithRetry(symbol, range, attempts = 3) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchYahooAdjustedSeries(symbol, range);
    } catch (error) {
      failure = error;
      if (attempt === attempts) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 500));
    }
  }
  throw failure;
}

async function fetchInBatches(symbols, range, batchSize = 5) {
  const results = [];
  for (let index = 0; index < symbols.length; index += batchSize) {
    results.push(...await Promise.all(symbols.slice(index, index + batchSize).map((symbol) => fetchWithRetry(symbol, range))));
  }
  return results;
}

function simulateCorrectedFamily(points, options = BASE_OPTIONS) {
  const primary = createPrimaryStrategies().map((strategy) => simulateStrategy(points, CORE_SYMBOLS, strategy, options));
  const ensembles = buildEnsembleStrategies(primary, points, CORE_SYMBOLS);
  const ensembleSimulations = ensembles.strategies.map((strategy) => simulateStrategy(points, CORE_SYMBOLS, strategy, options));
  const generation2 = createGeneration2LongOnlyStrategies().map((strategy) => simulateStrategy(points, CORE_SYMBOLS, strategy, options));
  return Object.freeze({
    simulations: Object.freeze([...primary, ...ensembleSimulations, ...generation2]),
    online_probability_history: ensembles.online_probability_history,
  });
}

function standaloneSliceRows(rows, slice, options = BASE_OPTIONS) {
  return rebaseRowsForStandalonePeriod(rowsWithin(rows, slice.start, slice.end), {
    cashSymbol: options.cashSymbol,
    oneWayCostBps: options.oneWayCostBps,
  });
}

function metricsForSlice(simulations, slice) {
  return Object.fromEntries(simulations.map((simulation) => [
    simulation.id,
    calculatePortfolioMetrics(standaloneSliceRows(simulation.rows, slice)),
  ]));
}

function metricsBySlice(simulations) {
  return Object.fromEntries(Object.entries(SLICES).map(([id, slice]) => [id, metricsForSlice(simulations, slice)]));
}

function compareAllToSpy(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([id, values]) => [id, compareMetrics(values, metrics.spy_buy_hold)]));
}

function annualOriginWindows(candidateRows, benchmarkRows, sessions, slice) {
  const boundedCandidate = rowsWithin(candidateRows, slice.start, slice.end);
  const boundedBenchmark = rowsWithin(benchmarkRows, slice.start, slice.end);
  const benchmarkByDate = new Map(boundedBenchmark.map((row) => [row.execution_return_date, row]));
  const aligned = boundedCandidate.filter((row) => benchmarkByDate.has(row.execution_return_date));
  const starts = [];
  for (let index = 0; index < aligned.length; index += 1) {
    if (index === 0 || aligned[index].execution_return_date.slice(0, 4) !== aligned[index - 1].execution_return_date.slice(0, 4)) {
      starts.push(index);
    }
  }
  return Object.freeze(starts.filter((start) => start + sessions <= aligned.length).map((start) => {
    const rawCandidate = aligned.slice(start, start + sessions);
    const rawBenchmark = rawCandidate.map((row) => benchmarkByDate.get(row.execution_return_date));
    const candidate = calculatePortfolioMetrics(rebaseRowsForStandalonePeriod(rawCandidate, {
      cashSymbol: BASE_OPTIONS.cashSymbol,
      oneWayCostBps: BASE_OPTIONS.oneWayCostBps,
    }));
    const benchmark = calculatePortfolioMetrics(rebaseRowsForStandalonePeriod(rawBenchmark, {
      cashSymbol: BASE_OPTIONS.cashSymbol,
      oneWayCostBps: BASE_OPTIONS.oneWayCostBps,
    }));
    const candidateGrowth = annualizedLogGrowth(candidate);
    const benchmarkGrowth = annualizedLogGrowth(benchmark);
    return Object.freeze({
      start_date: candidate.start_date,
      end_date: candidate.end_date,
      candidate_annualized_log_growth: round(candidateGrowth),
      benchmark_annualized_log_growth: round(benchmarkGrowth),
      annualized_log_growth_difference: round(candidateGrowth - benchmarkGrowth),
      candidate_total_return: candidate.total_return,
      benchmark_total_return: benchmark.total_return,
      beats_benchmark: candidate.total_return > benchmark.total_return,
    });
  }));
}

function summarizeWindows(windows) {
  const differences = windows.map((window) => window.annualized_log_growth_difference);
  return Object.freeze({
    windows,
    count: windows.length,
    median_annualized_log_growth_difference: round(median(differences)),
    positive_fraction: windows.length > 0
      ? round(windows.filter((window) => window.beats_benchmark).length / windows.length)
      : null,
  });
}

function rollingEvidence(simulations) {
  const byId = new Map(simulations.map((simulation) => [simulation.id, simulation]));
  const spy = byId.get("spy_buy_hold");
  return Object.fromEntries(CANDIDATE_IDS.map((id) => {
    const candidate = byId.get(id);
    return [id, Object.freeze(Object.fromEntries([252, 504, 756].map((sessions) => [
      sessions,
      summarizeWindows(annualOriginWindows(candidate.rows, spy.rows, sessions, SLICES.validation_selection)),
    ])))];
  }));
}

function selectionEvidence(metrics, rolling) {
  const development = metrics.development;
  const validation = metrics.validation_selection;
  const assessments = CANDIDATE_IDS.map((id) => {
    const dev = development[id];
    const val = validation[id];
    const devSpy = development.spy_buy_hold;
    const valSpy = validation.spy_buy_hold;
    const valFrozen = validation.frozen_finly;
    const valVolTarget = validation.spy_vol_target_15;
    const devRaw = annualizedLogGrowth(dev) - annualizedLogGrowth(devSpy);
    const valRaw = annualizedLogGrowth(val) - annualizedLogGrowth(valSpy);
    const rollingGates = Object.fromEntries([252, 504, 756].flatMap((sessions) => {
      const evidence = rolling[id][sessions];
      return [
        [`validation_rolling_${sessions}_median_raw_excess_positive`, evidence.median_annualized_log_growth_difference > 0],
        [`validation_rolling_${sessions}_positive_fraction_at_least_60pct`, evidence.positive_fraction >= 0.60],
      ];
    }));
    const gates = Object.freeze({
      development_raw_log_growth_exceeds_spy: devRaw > 0,
      validation_raw_log_growth_exceeds_spy: valRaw > 0,
      validation_raw_advantage_at_least_50bp: valRaw >= 0.005,
      validation_volatility_not_above_spy: val.annualized_volatility <= valSpy.annualized_volatility,
      validation_drawdown_not_over_2pp_worse_than_spy: val.maximum_drawdown >= valSpy.maximum_drawdown - 0.02,
      validation_sharpe_exceeds_frozen_by_10bp: val.cash_excess_sharpe >= valFrozen.cash_excess_sharpe + 0.10,
      validation_sharpe_exceeds_vol_target_by_10bp: val.cash_excess_sharpe >= valVolTarget.cash_excess_sharpe + 0.10,
      validation_drawdown_not_over_2pp_worse_than_frozen: val.maximum_drawdown >= valFrozen.maximum_drawdown - 0.02,
      validation_drawdown_not_worse_than_15pct: val.maximum_drawdown >= -0.15,
      ...rollingGates,
    });
    return Object.freeze({
      id,
      eligible_before_robustness: Object.values(gates).every(Boolean),
      development_annualized_log_growth_advantage_vs_spy: round(devRaw),
      validation_annualized_log_growth_advantage_vs_spy: round(valRaw),
      robust_raw_score: round(Math.min(devRaw, valRaw)),
      validation_sharpe_tiebreaker: val.cash_excess_sharpe,
      validation_drawdown_tiebreaker: val.maximum_drawdown,
      gates,
    });
  });
  const ranked = [...assessments].sort((left, right) => right.robust_raw_score - left.robust_raw_score
    || right.validation_sharpe_tiebreaker - left.validation_sharpe_tiebreaker
    || right.validation_drawdown_tiebreaker - left.validation_drawdown_tiebreaker
    || left.id.localeCompare(right.id));
  const eligible = ranked.filter((assessment) => assessment.eligible_before_robustness);
  return Object.freeze({
    selected_id_before_robustness: eligible[0]?.id ?? null,
    ranked_candidate_ids: Object.freeze(ranked.map((assessment) => assessment.id)),
    assessments: Object.freeze(Object.fromEntries(assessments.map((assessment) => [assessment.id, assessment]))),
    recent_interval_used_for_selection: false,
  });
}

function recentVeto(metrics, selection) {
  if (!selection.selected_id_before_robustness) {
    return Object.freeze({ applicable: false, hard_safety_veto: false, reasons: Object.freeze([]) });
  }
  const candidate = metrics.consumed_recent_diagnostic[selection.selected_id_before_robustness];
  const spy = metrics.consumed_recent_diagnostic.spy_buy_hold;
  const bil = metrics.consumed_recent_diagnostic.bil_cash;
  const reasons = [];
  if (candidate.maximum_drawdown < -0.20) reasons.push("recent maximum drawdown breached 20%");
  if (candidate.total_return < bil.total_return) reasons.push("recent return trailed BIL");
  if (candidate.maximum_drawdown < spy.maximum_drawdown - 0.05) reasons.push("recent drawdown was over five points worse than SPY");
  return Object.freeze({ applicable: true, hard_safety_veto: reasons.length > 0, reasons: Object.freeze(reasons) });
}

function strategyTable(metrics, comparisons, ids) {
  return ids.map((id) => {
    const value = metrics[id];
    const comparison = comparisons[id];
    return `| ${id} | ${(100 * value.total_return).toFixed(2)}% | ${(100 * value.annualized_return).toFixed(2)}% | ${(100 * value.annualized_volatility).toFixed(2)}% | ${value.cash_excess_sharpe?.toFixed(3) ?? "n/a"} | ${(100 * value.maximum_drawdown).toFixed(2)}% | ${(100 * comparison.total_return_difference).toFixed(2)}% |`;
  }).join("\n");
}

function renderReport(report) {
  const selected = report.selection.selected_id_before_robustness ?? "none";
  const ids = [...BASELINE_IDS, ...CANDIDATE_IDS];
  const shownSlices = ["development", "validation_selection", "consumed_recent_diagnostic", "requested_2013_2015", "post_2013_full_history"];
  const sections = shownSlices.map((sliceId) => `## ${sliceId.replaceAll("_", " ")}\n\n| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Return minus SPY |\n|---|---:|---:|---:|---:|---:|---:|\n${strategyTable(report.metrics[sliceId], report.comparisons_to_spy[sliceId], ids)}`).join("\n\n");
  const assessmentRows = report.selection.ranked_candidate_ids.map((id) => {
    const item = report.selection.assessments[id];
    const failures = Object.entries(item.gates).filter(([, passed]) => !passed).map(([gate]) => gate).join(", ") || "none";
    return `| ${id} | ${(100 * item.development_annualized_log_growth_advantage_vs_spy).toFixed(2)}% | ${(100 * item.validation_annualized_log_growth_advantage_vs_spy).toFixed(2)}% | ${item.eligible_before_robustness ? "yes" : "no"} | ${failures} |`;
  }).join("\n");
  return `# Finly corrected quantitative champion search\n\nGenerated: ${report.generated_at}\n\nProtocol SHA-256: \`${report.protocol_sha256}\`  \nTrial-ledger SHA-256: \`${report.trial_ledger_sha256}\`  \nPanel SHA-256: \`${report.dataset.normalized_panel_sha256}\`\n\n## Answer first\n\nThe audited pre-robustness selector chose **${selected}**. Historical disposition: **${report.disposition}**. Pre-correction outputs are invalid and excluded. These metrics use queued t→t+1 execution, naturally drifting holdings, turnover against drifted weights, signal-time ensemble weights, and standalone boundary costs.\n\n${sections}\n\n## Selection gates\n\n| Candidate | Development log-growth edge | Validation log-growth edge | Eligible | Failed gates |\n|---|---:|---:|---:|---|\n${assessmentRows}\n\nThe consumed 2025–2026 interval did not rank or break ties. Recent hard-safety veto: **${report.recent_veto.hard_safety_veto ? "yes" : "no"}**.\n\n## Claim boundary\n\nAll history is seen and revised. A retrospective pass can earn only SHADOW_ONLY after robustness; it cannot establish future profit, exact submitted-competitor P&L, or options profitability. QQQ, 1.5x SPY, and the separate TQQQ proxy remain visible diagnostics so a raw SPY beat cannot be passed off as hidden leverage or unexplained alpha.\n`;
}

const protocolRaw = await readFile(protocolPath, "utf8");
const trialLedgerRaw = await readFile(trialLedgerPath, "utf8");
const protocol = JSON.parse(protocolRaw);
const trialLedger = JSON.parse(trialLedgerRaw);
if (trialLedger.append_only_through < protocol.trial_accounting.minimum_cumulative_effective_trials) {
  throw new Error("trial ledger undercounts the corrected protocol");
}
const trialBlockCount = trialLedger.blocks.reduce((sum, block) => sum + block.count, 0);
if (trialBlockCount !== trialLedger.append_only_through) {
  throw new Error("trial ledger block counts do not sum to append_only_through");
}
const allSymbols = [...new Set([...CORE_SYMBOLS, "TQQQ"])];
const yahooResults = await fetchInBatches(allSymbols, {
  start: protocol.data.requested_start,
  end: protocol.data.requested_end,
});
const resultBySymbol = new Map(yahooResults.map((result) => [result.symbol, result]));
const primaryPanel = alignSeriesByDate(CORE_SYMBOLS.map((symbol) => resultBySymbol.get(symbol)), CORE_SYMBOLS);
const aegisSymbols = ["SPY", "BIL", "QQQ", "TQQQ"];
const aegisPanel = alignSeriesByDate(aegisSymbols.map((symbol) => resultBySymbol.get(symbol)), aegisSymbols);

const privatePanelsPayload = `${JSON.stringify({
  schema_version: "finly_private_normalized_panels.v2",
  retrieved_at: new Date().toISOString(),
  provider: protocol.data.provider,
  primary: {
    symbols: primaryPanel.symbols,
    common_start: primaryPanel.common_start,
    common_end: primaryPanel.common_end,
    normalized_panel_sha256: primaryPanel.normalized_panel_sha256,
    source_provenance: Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, resultBySymbol.get(symbol).provenance])),
    points: primaryPanel.points,
  },
  aegis_legacy_diagnostic: {
    symbols: aegisPanel.symbols,
    common_start: aegisPanel.common_start,
    common_end: aegisPanel.common_end,
    normalized_panel_sha256: aegisPanel.normalized_panel_sha256,
    source_provenance: Object.fromEntries(aegisSymbols.map((symbol) => [symbol, resultBySymbol.get(symbol).provenance])),
    points: aegisPanel.points,
  },
}, null, 2)}\n`;
const privatePanelsPayloadSha256 = sha256(privatePanelsPayload);
const privatePanelsFilename = `corrected_panels_${primaryPanel.normalized_panel_sha256}_${aegisPanel.normalized_panel_sha256}.json`;
await atomicWrite(resolve(privateDirectory, privatePanelsFilename), privatePanelsPayload);

const family = simulateCorrectedFamily(primaryPanel.points, BASE_OPTIONS);
const aegisBenchmarks = createPrimaryStrategies().filter((strategy) => ["spy_buy_hold", "qqq_buy_hold", "bil_cash"].includes(strategy.id));
const aegisSimulations = [...aegisBenchmarks, ...createAegisLegacyProxyStrategies()]
  .map((strategy) => simulateStrategy(aegisPanel.points, aegisSymbols, strategy, BASE_OPTIONS));
const privateLedgerBuffer = gzipSync(JSON.stringify({
  schema_version: "finly_private_daily_simulation_ledgers.v2",
  normalized_panel_sha256: primaryPanel.normalized_panel_sha256,
  aegis_normalized_panel_sha256: aegisPanel.normalized_panel_sha256,
  engine_protocol_sha256: sha256(protocolRaw),
  primary_simulations: Object.fromEntries(family.simulations.map((simulation) => [simulation.id, simulation.rows])),
  aegis_legacy_simulations: Object.fromEntries(aegisSimulations.map((simulation) => [simulation.id, simulation.rows])),
}));
const privateLedgerPayloadSha256 = sha256Bytes(privateLedgerBuffer);
const privateLedgerFilename = `corrected_ledgers_${primaryPanel.normalized_panel_sha256}_${sha256(protocolRaw)}.json.gz`;
await atomicWriteBuffer(resolve(privateDirectory, privateLedgerFilename), privateLedgerBuffer);
const metrics = metricsBySlice(family.simulations);
const comparisons = Object.fromEntries(Object.entries(metrics).map(([sliceId, values]) => [sliceId, compareAllToSpy(values)]));
const rolling = rollingEvidence(family.simulations);
const selection = selectionEvidence(metrics, rolling);
const veto = recentVeto(metrics, selection);
const disposition = selection.selected_id_before_robustness && !veto.hard_safety_veto ? "ROBUSTNESS_PENDING" : "KEEP_V1";

const aegisMetrics = Object.fromEntries(aegisSimulations.map((simulation) => [
  simulation.id,
  calculatePortfolioMetrics(rebaseRowsForStandalonePeriod(simulation.rows, {
    cashSymbol: BASE_OPTIONS.cashSymbol,
    oneWayCostBps: BASE_OPTIONS.oneWayCostBps,
  })),
]));

const report = Object.freeze({
  schema_version: "finly_quant_champion_corrected.v1",
  generated_at: new Date().toISOString(),
  protocol_sha256: sha256(protocolRaw),
  trial_ledger_sha256: sha256(trialLedgerRaw),
  protocol,
  trial_count: trialLedger.append_only_through,
  dataset: Object.freeze({
    provider: protocol.data.provider,
    symbols: CORE_SYMBOLS,
    common_start: primaryPanel.common_start,
    common_end: primaryPanel.common_end,
    common_sessions: primaryPanel.common_sessions,
    scored_start: family.simulations[0].rows[0].execution_return_date,
    scored_end: family.simulations[0].rows.at(-1).execution_return_date,
    scored_sessions: family.simulations[0].rows.length,
    normalized_panel_sha256: primaryPanel.normalized_panel_sha256,
    generation_1_panel_sha256: GENERATION1_PANEL_SHA256,
    matches_generation_1_panel_sha256: primaryPanel.normalized_panel_sha256 === GENERATION1_PANEL_SHA256,
    vintage_difference_interpretation: primaryPanel.normalized_panel_sha256 === GENERATION1_PANEL_SHA256
      ? "The normalized price vintage matches Generation 1 exactly."
      : "This is a newly frozen retrieval vintage; differences may reflect an added completed session or provider revision, so cross-vintage metrics are not treated as exact reruns.",
    private_normalized_panel_persisted: true,
    private_daily_simulation_ledger_persisted: true,
    private_panels_filename: privatePanelsFilename,
    private_panels_payload_sha256: privatePanelsPayloadSha256,
    private_daily_ledgers_filename: privateLedgerFilename,
    private_daily_ledgers_gzip_sha256: privateLedgerPayloadSha256,
    private_panel_path_published: false,
    dropped_noncommon_sessions: primaryPanel.dropped_noncommon_sessions,
    source_provenance: Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, resultBySymbol.get(symbol).provenance])),
  }),
  execution: BASE_OPTIONS,
  strategy_metadata: Object.freeze({ ...STRATEGY_METADATA, ...GENERATION2_METADATA }),
  metrics,
  comparisons_to_spy: comparisons,
  rolling_annual_origin_evidence: rolling,
  selection,
  recent_veto: veto,
  online_probability_history: family.online_probability_history,
  aegis_legacy_diagnostic: Object.freeze({
    eligible_for_primary_champion: false,
    source_difference: "This proxy uses adjusted-close execution, BIL total return, and an extra traded BIL cost leg; the source uses split-adjusted prior-close to next-open timing, zero-return cash, and no ETF cash leg.",
    panel: Object.freeze({
      symbols: aegisSymbols,
      common_start: aegisPanel.common_start,
      common_end: aegisPanel.common_end,
      common_sessions: aegisPanel.common_sessions,
      normalized_panel_sha256: aegisPanel.normalized_panel_sha256,
    }),
    metrics: aegisMetrics,
  }),
  disposition,
  next_required_stage: disposition === "ROBUSTNESS_PENDING"
    ? "Run 10/25 bp costs, every native anchor, deflated statistics, paired 5/20/60-session block inference, and authenticated source reconciliation."
    : "No corrected Generation 1/2 candidate passed every gate; proceed only with a preregistered later family.",
});

await atomicWrite(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(reportOutput, renderReport(report));

process.stdout.write(`${JSON.stringify({
  ok: true,
  protocol_sha256: report.protocol_sha256,
  trial_ledger_sha256: report.trial_ledger_sha256,
  panel_sha256: primaryPanel.normalized_panel_sha256,
  selected_id_before_robustness: selection.selected_id_before_robustness,
  ranked_candidate_ids: selection.ranked_candidate_ids,
  disposition,
  private_panel_persisted: true,
  json: jsonOutput,
  report: reportOutput,
}, null, 2)}\n`);
