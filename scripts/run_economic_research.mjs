import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../lib/canonical.mjs";
import {
  blockBootstrapTerminalReturns,
  buildEconomicReturnRows,
  calculateEconomicMetrics,
  calendarQuarterFoldEvidence,
  ECONOMIC_CANDIDATES,
  economicDatasetFingerprint,
  ECONOMIC_RESEARCH_PROTOCOL,
  rollingWindowEvidence,
  rowsWithin,
  selectEconomicCandidate,
  validateAdjustedDailyBars,
} from "../lib/economic_research.mjs";
import { buildEconomicStatisticalEvidence } from "../lib/economic_statistics.mjs";
import {
  alpacaHistoricalCredentialsFromEnv,
  HistoricalAlpacaClient,
} from "../lib/historical_alpaca.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateOutput = resolve(projectRoot, "outputs/economic_research_full.json");
const destinations = [
  resolve(projectRoot, "public/data/economic_research.json"),
  resolve(projectRoot, "evidence/economic_research.json"),
  resolve(projectRoot, "src/data/economic_research.json"),
];

function round(value, places = 8) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function metricsByCandidate(rows) {
  return Object.fromEntries(ECONOMIC_CANDIDATES.map((candidate) => [candidate.id, calculateEconomicMetrics(rows, candidate.id)]));
}

function comparison(selected, baseline) {
  if (!selected || !baseline) return null;
  return {
    selected_minus_baseline_total_return: round(selected.total_return - baseline.total_return),
    selected_minus_baseline_annualized_return: round(selected.annualized_return - baseline.annualized_return),
    selected_minus_baseline_bil_excess_sharpe: round(selected.bil_excess_sharpe - baseline.bil_excess_sharpe),
    selected_minus_baseline_maximum_drawdown: round(selected.maximum_drawdown - baseline.maximum_drawdown),
    selected_to_baseline_volatility_ratio: round(selected.annualized_volatility / baseline.annualized_volatility),
  };
}

function evidenceStatus(selected, baseline, bootstrap) {
  if (!selected) return "NO_VALIDATION_CANDIDATE_SELECTED";
  if (selected.total_return <= 0) return "NEGATIVE_FIXED_HOLDOUT_RESULT";
  if (bootstrap.terminal_return_p05 > 0 && bootstrap.positive_terminal_return_fraction >= 0.95) {
    return "POSITIVE_FIXED_HOLDOUT_WITH_POSITIVE_BLOCK_BOOTSTRAP_P05_NOT_DURABLE_ALPHA_PROOF";
  }
  if (selected.maximum_drawdown > baseline.maximum_drawdown && selected.bil_excess_sharpe > 0) {
    return "POSITIVE_FIXED_HOLDOUT_WITH_SHALLOWER_DRAWDOWN_NOT_DURABLE_ALPHA_PROOF";
  }
  return "POSITIVE_FIXED_HOLDOUT_RESULT_NOT_DURABLE_ALPHA_PROOF";
}

const credentials = alpacaHistoricalCredentialsFromEnv();
const client = new HistoricalAlpacaClient(credentials);
const request = {
  start: ECONOMIC_RESEARCH_PROTOCOL.requested_start,
  end: ECONOMIC_RESEARCH_PROTOCOL.requested_end,
  timeframe: "1Day",
  feed: "sip",
  adjustment: ECONOMIC_RESEARCH_PROTOCOL.adjustment,
  limit: 10_000,
};
const [spyResponse, cashResponse] = await Promise.all([
  client.getStockBars("SPY", request),
  client.getStockBars("BIL", request),
]);
const points = validateAdjustedDailyBars(spyResponse.bars);
const cashPoints = validateAdjustedDailyBars(cashResponse.bars);
const rows = buildEconomicReturnRows(spyResponse.bars, { cashBars: cashResponse.bars });
const trainingRows = rowsWithin(rows, ECONOMIC_RESEARCH_PROTOCOL.development_start, ECONOMIC_RESEARCH_PROTOCOL.training_end);
const validationRows = rowsWithin(rows, ECONOMIC_RESEARCH_PROTOCOL.validation_start, ECONOMIC_RESEARCH_PROTOCOL.validation_end);
if (trainingRows.length < 252 || validationRows.length < 252) throw new Error("economic development partitions are too small");

const trainingMetrics = metricsByCandidate(trainingRows);
const validationMetrics = metricsByCandidate(validationRows);
const selection = selectEconomicCandidate(validationMetrics);
const selectionReceiptBody = {
  schema_version: "finly_economic_selection.v1",
  protocol: ECONOMIC_RESEARCH_PROTOCOL,
  candidate_definitions: ECONOMIC_CANDIDATES,
  dataset_fingerprints: {
    SPY: economicDatasetFingerprint(spyResponse.bars),
    BIL: economicDatasetFingerprint(cashResponse.bars),
  },
  development_partition: {
    training: { start: ECONOMIC_RESEARCH_PROTOCOL.development_start, end: ECONOMIC_RESEARCH_PROTOCOL.training_end },
    validation: { start: ECONOMIC_RESEARCH_PROTOCOL.validation_start, end: ECONOMIC_RESEARCH_PROTOCOL.validation_end },
  },
  training_metrics: trainingMetrics,
  validation_metrics: validationMetrics,
  selection,
};
const selectionReceipt = {
  ...selectionReceiptBody,
  selection_sha256: sha256(selectionReceiptBody),
};

// The holdout is sliced and evaluated only after the deterministic selection
// receipt above has been instantiated from training/validation information.
const holdoutRows = rowsWithin(rows, ECONOMIC_RESEARCH_PROTOCOL.final_holdout_start, ECONOMIC_RESEARCH_PROTOCOL.final_holdout_end);
if (holdoutRows.length < 252) throw new Error("economic final holdout is too small");
const holdoutMetrics = metricsByCandidate(holdoutRows);
const selectedHoldout = selection.selected_id ? holdoutMetrics[selection.selected_id] : null;
const holdoutBaseline = holdoutMetrics.buy_hold;
const bootstrap = selection.selected_id
  ? blockBootstrapTerminalReturns(holdoutRows, selection.selected_id)
  : null;

const sensitivity = selection.selected_id ? Object.fromEntries([0.08, 0.10, 0.12].map((targetVolatility) => {
  const sensitivityRows = buildEconomicReturnRows(spyResponse.bars, { cashBars: cashResponse.bars, targetVolatility });
  const slice = rowsWithin(sensitivityRows, ECONOMIC_RESEARCH_PROTOCOL.final_holdout_start, ECONOMIC_RESEARCH_PROTOCOL.final_holdout_end);
  return [targetVolatility.toFixed(2), calculateEconomicMetrics(slice, selection.selected_id)];
})) : null;
const costSensitivity = selection.selected_id ? Object.fromEntries([1, 5, 10].map((oneWayTurnoverCostBps) => {
  const stressedRows = buildEconomicReturnRows(spyResponse.bars, { cashBars: cashResponse.bars, oneWayTurnoverCostBps });
  const slice = rowsWithin(stressedRows, ECONOMIC_RESEARCH_PROTOCOL.final_holdout_start, ECONOMIC_RESEARCH_PROTOCOL.final_holdout_end);
  return [String(oneWayTurnoverCostBps), calculateEconomicMetrics(slice, selection.selected_id)];
})) : null;

const fullSelectedRows = selection.selected_id ? rows : null;
const statisticalCandidateIds = ECONOMIC_CANDIDATES
  .filter((candidate) => candidate.id !== "buy_hold")
  .map((candidate) => candidate.id);
const holdoutStatisticalEvidence = selection.selected_id ? buildEconomicStatisticalEvidence(
  holdoutRows,
  statisticalCandidateIds,
  {
    fixedCandidateId: selection.selected_id,
    trialCount: ECONOMIC_RESEARCH_PROTOCOL.economic_candidate_count,
    periodsPerYear: 252,
    iterations: 2_000,
    blockLength: 20,
    seed: 20_260_829,
  },
) : null;
const postTrainingRows = rowsWithin(
  rows,
  ECONOMIC_RESEARCH_PROTOCOL.validation_start,
  ECONOMIC_RESEARCH_PROTOCOL.final_holdout_end,
);
const postTrainingStatisticalEvidence = selection.selected_id ? buildEconomicStatisticalEvidence(
  postTrainingRows,
  statisticalCandidateIds,
  {
    fixedCandidateId: selection.selected_id,
    trialCount: ECONOMIC_RESEARCH_PROTOCOL.economic_candidate_count,
    periodsPerYear: 252,
    iterations: 2_000,
    blockLength: 20,
    seed: 20_260_829,
  },
) : null;
const holdoutFolds = selection.selected_id
  ? calendarQuarterFoldEvidence(holdoutRows, selection.selected_id)
  : null;
const profitabilityEvidenceGate = selection.selected_id ? {
  fixed_holdout_positive_after_modeled_costs: selectedHoldout.total_return > 0,
  fixed_holdout_positive_above_bil: selectedHoldout.total_return_minus_bil > 0,
  bil_excess_sharpe_exceeds_volatility_target_only: selectedHoldout.bil_excess_sharpe > holdoutMetrics.vol_target_long.bil_excess_sharpe,
  maximum_drawdown_shallower_than_volatility_target_only: selectedHoldout.maximum_drawdown > holdoutMetrics.vol_target_long.maximum_drawdown,
  positive_median_holdout_quarter: holdoutFolds.median_fold_return > 0,
  no_single_positive_holdout_quarter_supplies_half_of_positive_log_return: holdoutFolds.largest_positive_fold_share < 0.5,
  positive_under_ten_bps_per_traded_leg: costSensitivity["10"].total_return > 0,
  deflated_sharpe_probability_at_least_95_percent: holdoutStatisticalEvidence.probabilistic_deflated_sharpe.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark >= 0.95,
  white_style_familywise_p_value_at_most_5_percent: holdoutStatisticalEvidence.circular_block_reality_check.familywise_p_value <= 0.05,
  prospective_paper_forward_complete: false,
  options_execution_pilot_has_at_least_50_completed_trades: false,
} : null;
if (profitabilityEvidenceGate) {
  profitabilityEvidenceGate.all_durable_profitability_gates_pass = Object.values(profitabilityEvidenceGate).every((value) => value === true);
}
const reportBody = {
  schema_version: "finly_economic_research.v1",
  generated_at: new Date().toISOString(),
  research_scope: "Long-horizon SPY direction and risk-scaling research; this is separate from the shorter historical options execution-proxy replay.",
  mutation_authorized: false,
  future_profitability_guaranteed: false,
  durable_alpha_proven: false,
  live_options_profitability_proven: false,
  protocol: ECONOMIC_RESEARCH_PROTOCOL,
  sources: [
    {
      title: "Time Series Momentum",
      authors: "Tobias J. Moskowitz, Yao Hua Ooi, and Lasse Heje Pedersen",
      url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2089463",
      design_use: "Fixed 1- to 12-month time-series trend horizons; Finly uses long-only, unlevered variants rather than claiming to reproduce the paper's diversified futures portfolio.",
    },
    {
      title: "A Century of Evidence on Trend-Following Investing",
      authors: "Brian Hurst, Yao Hua Ooi, and Lasse Heje Pedersen",
      url: "https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing",
      design_use: "Predeclared equal combination of 1-, 3-, and 12-month trend horizons with volatility scaling; Finly applies a long-only, unlevered single-index adaptation.",
    },
    {
      title: "Volatility-Managed Portfolios",
      authors: "Alan Moreira and Tyler Muir",
      url: "https://www.nber.org/papers/w22208",
      design_use: "Inverse-volatility risk scaling; Finly caps exposure at one and does not use leverage.",
    },
    {
      title: "The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality",
      authors: "David H. Bailey and Marcos López de Prado",
      url: "https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf",
      design_use: "Non-normality-aware probabilistic and deflated Sharpe falsification with an explicitly disclosed trial count.",
    },
    {
      title: "A Reality Check for Data Snooping",
      authors: "Halbert White",
      url: "https://users.ssc.wisc.edu/~behansen/718/White2000.pdf",
      design_use: "Centered shared-block maximum-statistic bootstrap across the disclosed economic candidate family.",
    },
    {
      title: "Alpaca Market Data API",
      authors: "Alpaca",
      url: "https://docs.alpaca.markets/docs/about-market-data-api",
      design_use: "Read-only adjusted daily delayed SIP bars and explicit data-plan boundary.",
    },
  ],
  dataset: {
    provider: spyResponse.provenance.provider,
    feed: "sip",
    adjustment: ECONOMIC_RESEARCH_PROTOCOL.adjustment,
    requested_start: ECONOMIC_RESEARCH_PROTOCOL.requested_start,
    requested_end: ECONOMIC_RESEARCH_PROTOCOL.requested_end,
    observed_start: points[0].date,
    observed_end: points.at(-1).date,
    bar_count: points.length,
    cash_observed_start: cashPoints[0].date,
    cash_observed_end: cashPoints.at(-1).date,
    cash_bar_count: cashPoints.length,
    page_count: spyResponse.provenance.page_count + cashResponse.provenance.page_count,
    dataset_sha256: sha256({
      SPY: economicDatasetFingerprint(spyResponse.bars),
      BIL: economicDatasetFingerprint(cashResponse.bars),
    }),
    symbol_sha256: {
      SPY: economicDatasetFingerprint(spyResponse.bars),
      BIL: economicDatasetFingerprint(cashResponse.bars),
    },
    raw_bars_embedded_publicly: false,
  },
  selection_receipt: selectionReceipt,
  final_holdout: {
    evaluation_order: {
      full_date_range_fetched_before_in_memory_selection_receipt: true,
      training_and_validation_scored_before_final_holdout: true,
      final_holdout_metrics_computed_after_selection_receipt: true,
      selection_receipt_persisted_with_final_report: true,
      claim_boundary: "Control flow prevents final-holdout rows from entering training, validation, or selection. The separate git preregistration commits predate report generation; the in-memory receipt is not a cryptographic proof that a researcher never viewed the historical dates.",
    },
    start: ECONOMIC_RESEARCH_PROTOCOL.final_holdout_start,
    end: ECONOMIC_RESEARCH_PROTOCOL.final_holdout_end,
    selected_candidate_id: selection.selected_id,
    selected_candidate_metrics: selectedHoldout,
    buy_hold_metrics: holdoutBaseline,
    volatility_target_only_metrics: holdoutMetrics.vol_target_long,
    comparison_to_buy_hold: comparison(selectedHoldout, holdoutBaseline),
    comparison_to_volatility_target_only: comparison(selectedHoldout, holdoutMetrics.vol_target_long),
    block_bootstrap: bootstrap,
    target_volatility_sensitivity: sensitivity,
    one_way_per_leg_cost_bps_sensitivity: costSensitivity,
    quarter_fold_evidence: holdoutFolds,
    statistical_falsification: holdoutStatisticalEvidence,
    diagnostic_candidate_metrics: holdoutMetrics,
  },
  longitudinal_stability: selection.selected_id ? {
    rolling_years: rollingWindowEvidence(fullSelectedRows, selection.selected_id, 252),
    post_training_quarter_folds: calendarQuarterFoldEvidence(fullSelectedRows, selection.selected_id, {
      start: ECONOMIC_RESEARCH_PROTOCOL.validation_start,
      end: ECONOMIC_RESEARCH_PROTOCOL.final_holdout_end,
    }),
    post_training_statistical_falsification: postTrainingStatisticalEvidence,
  } : null,
  profitability_evidence_gate: profitabilityEvidenceGate,
  evidence_status: evidenceStatus(selectedHoldout, holdoutBaseline, bootstrap),
  interpretation: selection.selected_id
    ? "The selected deterministic policy earned a fixed-sample historical result after modeled stock turnover costs. This can support a bounded direction/risk layer. It cannot establish live options fills, causal value from an LLM, persistent alpha, or future profitability."
    : "The development rule found no qualifying candidate, so Finly failed closed and did not designate an economic policy.",
  next_proof: "Run the frozen policy prospectively in Alpaca paper trading, keep the options execution overlay separately scored, and do not revise the policy using the dated final holdout.",
};
const report = { ...reportBody, artifact_sha256: sha256(reportBody) };
await atomicJson(privateOutput, { ...report, raw_rows: rows });
for (const destination of destinations) await atomicJson(destination, report);
console.log(JSON.stringify({
  artifact_sha256: report.artifact_sha256,
  dataset: report.dataset,
  selected_candidate_id: report.final_holdout.selected_candidate_id,
  evidence_status: report.evidence_status,
  holdout_selected: report.final_holdout.selected_candidate_metrics,
  holdout_buy_hold: report.final_holdout.buy_hold_metrics,
  output: destinations.map((path) => path.slice(projectRoot.length + 1)),
}, null, 2));
