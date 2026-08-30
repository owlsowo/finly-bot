import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  calculatePortfolioMetrics,
  compareMetrics,
  rebaseRowsForStandalonePeriod,
  round,
  rowsWithin,
  sha256,
  simulateStrategy,
} from "./champion_engine.mjs";
import { createPrimaryStrategies } from "./champion_strategies.mjs";
import { GENERATION6_REQUIRED_SYMBOLS } from "./champion_strategies_generation6.mjs";
import {
  VOLATILITY_MANAGED_G4_CANDIDATE,
  VOLATILITY_MANAGED_G4_CANDIDATE_ID,
  VOLATILITY_MANAGED_G4_SPECIFICATION,
} from "./volatility_managed_g4_candidate.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = resolve(dirname(MODULE_PATH), "..");
const CASH_SYMBOL = "BIL";
const LOOKBACK_SESSIONS = 252;
const REBALANCE_INTERVAL_SESSIONS = 21;
const ANNUAL_BORROW_SPREAD = 0.005;
const MAXIMUM_TARGET_RISKY_GROSS = 1.5;

export const VOLATILITY_MANAGED_G4_PANEL = Object.freeze({
  path: "data/private/champion_search/generation4_panel_91a53ac73e785d2ccb8db043cce6d808b9a851d7e95da7031bb227e8b40d1014.json",
  payload_sha256: "91a53ac73e785d2ccb8db043cce6d808b9a851d7e95da7031bb227e8b40d1014",
  normalized_panel_sha256: "bef945fb53d56801d0d9f99d23a641d2ee7a7c14c515ddb3fec1acc79451e883",
  schema_version: "finly_generation4_private_panel.v1",
  common_start: "2007-05-30",
  common_end: "2026-08-27",
  common_sessions: 4843,
});

export const VOLATILITY_MANAGED_G4_OUTPUT_PATH =
  "data/private/volatility_managed_g4_candidate_evaluation.json";

export const VOLATILITY_MANAGED_G4_SLICES = Object.freeze({
  development: Object.freeze({ start: "2008-06-02", end: "2017-12-29" }),
  validation: Object.freeze({ start: "2018-01-02", end: "2024-12-31" }),
  recent: Object.freeze({ start: "2025-01-02", end: "2026-08-27" }),
});

export const VOLATILITY_MANAGED_G4_COST_LEVELS_BPS = Object.freeze([5, 10, 25]);
export const VOLATILITY_MANAGED_G4_ANCHORS = Object.freeze(
  Array.from({ length: REBALANCE_INTERVAL_SESSIONS }, (_, index) => index),
);

export const VOLATILITY_MANAGED_G4_CANDIDATE_GENERATION_BOUNDARY = Object.freeze({
  evidence_class: "POST_SELECTION_CANDIDATE_GENERATION_ON_CONSUMED_HISTORY",
  public_or_marketing_claim_authorized: false,
  fresh_holdout_claim_authorized: false,
  forward_profitability_claim_authorized: false,
  history_status: Object.freeze({
    development: "previously_observed",
    validation: "previously_observed",
    recent: "previously_observed",
  }),
  formula_selection_status:
    "The formula emerged after inspecting an exploratory grid on this same ETF panel.",
  multiplicity: Object.freeze({
    formal_attempts_completed_before_this_candidate_generation_session: 118,
    working_effective_trial_count_for_any_future_deflation: 148,
    working_count_status:
      "PRELIMINARY_CONSERVATIVE_ACCOUNTING; a unified append-only ledger is still required before inference",
    statistical_probability_claim_authorized_from_this_artifact: false,
  }),
  permitted_use:
    "Internal reproducibility, implementation debugging, and selection of a separately frozen external replay only.",
});

const SOURCE_PATHS = Object.freeze([
  "research/champion_engine.mjs",
  "research/champion_strategies.mjs",
  "research/champion_strategies_generation6.mjs",
  "research/volatility_managed_g4_candidate.mjs",
  "research/run_volatility_managed_g4_candidate.mjs",
  "tests/volatility_managed_g4_candidate.test.mjs",
  "tests/volatility_managed_g4_candidate_runner.test.mjs",
]);

function fail(message) {
  throw new TypeError(message);
}

function invariant(condition, message) {
  if (!condition) fail(message);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function safeProjectPath(projectRoot, relativePath) {
  const root = resolve(projectRoot);
  const absolute = resolve(root, relativePath);
  invariant(absolute.startsWith(`${root}${sep}`), `${relativePath} escapes the project root`);
  return absolute;
}

function riskyGross(weights) {
  return Object.entries(weights ?? {})
    .filter(([symbol]) => symbol !== CASH_SYMBOL)
    .reduce((sum, [, weight]) => sum + Math.abs(Number(weight)), 0);
}

function postReturnRiskyGross(row) {
  const denominator = 1 + row.gross_return;
  invariant(finitePositive(denominator), "row has an invalid post-return denominator");
  return Object.entries(row.weights)
    .filter(([symbol]) => symbol !== CASH_SYMBOL)
    .reduce((sum, [symbol, weight]) => (
      sum + Math.abs(weight * (1 + row.asset_returns[symbol]) / denominator)
    ), 0);
}

function summarizeGross(rows) {
  invariant(Array.isArray(rows) && rows.length > 0, "gross summary requires rows");
  const targetValues = rows.filter((row) => row.rebalanced)
    .map((row) => riskyGross(row.signal_weights));
  const realizedStartValues = rows.map((row) => riskyGross(row.weights));
  const realizedEndValues = rows.map(postReturnRiskyGross);
  return Object.freeze({
    target_at_native_rebalances: Object.freeze({
      observations: targetValues.length,
      average: round(targetValues.length > 0
        ? targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length
        : null),
      maximum: round(targetValues.length > 0 ? Math.max(...targetValues) : null),
      above_1_5_cap_count: targetValues.filter((value) => value > MAXIMUM_TARGET_RISKY_GROSS + 1e-8).length,
    }),
    realized_start_of_return: Object.freeze({
      observations: realizedStartValues.length,
      average: round(realizedStartValues.reduce((sum, value) => sum + value, 0)
        / realizedStartValues.length),
      maximum: round(Math.max(...realizedStartValues)),
    }),
    realized_end_of_return: Object.freeze({
      observations: realizedEndValues.length,
      average: round(realizedEndValues.reduce((sum, value) => sum + value, 0)
        / realizedEndValues.length),
      maximum: round(Math.max(...realizedEndValues)),
    }),
    interpretation:
      "The 1.5 cap applies to native rebalance targets; self-financing holdings may drift above it between rebalances.",
  });
}

function annualizedLogGrowth(metrics) {
  invariant(metrics && Number.isSafeInteger(metrics.observations) && metrics.observations > 0,
    "annualized log growth requires metrics");
  invariant(Number.isFinite(metrics.total_return) && metrics.total_return > -1,
    "metrics total return is invalid");
  return round(Math.log1p(metrics.total_return) * 252 / metrics.observations);
}

function standaloneSlice(rows, slice, oneWayCostBps) {
  const selected = rowsWithin(rows, slice.start, slice.end);
  invariant(selected.length >= 2, `too few rows from ${slice.start} through ${slice.end}`);
  invariant(selected[0].execution_return_date === slice.start,
    `slice starts on ${selected[0].execution_return_date}, not ${slice.start}`);
  invariant(selected.at(-1).execution_return_date === slice.end,
    `slice ends on ${selected.at(-1).execution_return_date}, not ${slice.end}`);
  const standaloneRows = rebaseRowsForStandalonePeriod(selected, {
    cashSymbol: CASH_SYMBOL,
    oneWayCostBps,
  });
  const metrics = calculatePortfolioMetrics(standaloneRows);
  invariant(metrics, `metrics are unavailable from ${slice.start} through ${slice.end}`);
  return Object.freeze({ rows: standaloneRows, metrics });
}

function sliceComparison(candidateRows, benchmarkRows, slice, oneWayCostBps) {
  const candidate = standaloneSlice(candidateRows, slice, oneWayCostBps);
  const benchmark = standaloneSlice(benchmarkRows, slice, oneWayCostBps);
  invariant(candidate.metrics.observations === benchmark.metrics.observations,
    "candidate and SPY standalone observations differ");
  return Object.freeze({
    candidate: candidate.metrics,
    spy_buy_hold: benchmark.metrics,
    comparison: Object.freeze({
      ...compareMetrics(candidate.metrics, benchmark.metrics),
      candidate_annualized_log_growth: annualizedLogGrowth(candidate.metrics),
      spy_annualized_log_growth: annualizedLogGrowth(benchmark.metrics),
      annualized_log_growth_edge: round(
        annualizedLogGrowth(candidate.metrics) - annualizedLogGrowth(benchmark.metrics),
      ),
    }),
    candidate_gross: summarizeGross(candidate.rows),
  });
}

function spyBuyHoldStrategy() {
  const strategy = createPrimaryStrategies().find((item) => item.id === "spy_buy_hold");
  invariant(strategy, "primary strategy registry omits spy_buy_hold");
  return strategy;
}

function simulate(points, strategy, oneWayCostBps, rebalanceAnchor) {
  return simulateStrategy(points, GENERATION6_REQUIRED_SYMBOLS, strategy, {
    cashSymbol: CASH_SYMBOL,
    lookbackSessions: LOOKBACK_SESSIONS,
    rebalanceIntervalSessions: REBALANCE_INTERVAL_SESSIONS,
    rebalanceAnchor,
    oneWayCostBps,
    annualBorrowSpread: ANNUAL_BORROW_SPREAD,
    maximumRiskyGross: strategy.id === VOLATILITY_MANAGED_G4_CANDIDATE_ID
      ? MAXIMUM_TARGET_RISKY_GROSS
      : 1,
    terminalLiquidation: true,
  });
}

function validateEvaluationArguments({ costLevelsBps, anchors, slices }) {
  invariant(Array.isArray(costLevelsBps) && costLevelsBps.length > 0,
    "cost levels are required");
  invariant(costLevelsBps.every((value) => Number.isFinite(value) && value >= 0),
    "cost levels must be finite and nonnegative");
  invariant(Array.isArray(anchors) && anchors.length > 0, "anchors are required");
  invariant(anchors.every((value) => Number.isSafeInteger(value)
    && value >= 0 && value < REBALANCE_INTERVAL_SESSIONS), "anchors are invalid");
  invariant(new Set(anchors).size === anchors.length, "anchors contain duplicates");
  invariant(slices && Object.keys(slices).length > 0, "slices are required");
  for (const [sliceId, slice] of Object.entries(slices)) {
    invariant(typeof sliceId === "string" && sliceId.length > 0, "slice id is invalid");
    invariant(typeof slice?.start === "string" && typeof slice?.end === "string"
      && slice.start <= slice.end, `${sliceId} slice is invalid`);
  }
}

/**
 * Evaluate the candidate on an already validated panel. Optional arguments
 * exist only so focused tests can exercise the accounting on small fixtures;
 * the CLI always supplies the exported fixed costs, anchors, and slices.
 */
export function evaluateVolatilityManagedG4Panel(points, {
  costLevelsBps = VOLATILITY_MANAGED_G4_COST_LEVELS_BPS,
  anchors = VOLATILITY_MANAGED_G4_ANCHORS,
  slices = VOLATILITY_MANAGED_G4_SLICES,
} = {}) {
  invariant(Array.isArray(points) && points.length > LOOKBACK_SESSIONS + 3,
    "evaluation panel is too short");
  validateEvaluationArguments({ costLevelsBps, anchors, slices });
  const spy = spyBuyHoldStrategy();
  const byCost = {};
  for (const costBps of costLevelsBps) {
    // Once SPY is established, its buy-and-hold path is independent of the
    // monthly anchor. All scored slices begin long after the first rebalance.
    const benchmarkSimulation = simulate(points, spy, costBps, 0);
    const benchmarkSlices = Object.freeze(Object.fromEntries(
      Object.entries(slices).map(([sliceId, slice]) => {
        const standalone = standaloneSlice(benchmarkSimulation.rows, slice, costBps);
        return [sliceId, standalone.metrics];
      }),
    ));
    const anchorResults = [];
    for (const anchor of anchors) {
      const candidateSimulation = simulate(
        points,
        VOLATILITY_MANAGED_G4_CANDIDATE,
        costBps,
        anchor,
      );
      const sliceResults = Object.freeze(Object.fromEntries(
        Object.entries(slices).map(([sliceId, slice]) => [
          sliceId,
          sliceComparison(candidateSimulation.rows, benchmarkSimulation.rows, slice, costBps),
        ]),
      ));
      anchorResults.push(Object.freeze({
        rebalance_anchor: anchor,
        slices: sliceResults,
        full_scored_history_candidate_gross: summarizeGross(candidateSimulation.rows),
      }));
    }
    const positiveBySlice = Object.freeze(Object.fromEntries(
      Object.keys(slices).map((sliceId) => [sliceId, anchorResults.filter((record) => (
        record.slices[sliceId].comparison.annualized_log_growth_edge > 0
      )).length]),
    ));
    byCost[String(costBps)] = Object.freeze({
      one_way_cost_bps_per_absolute_traded_notional: costBps,
      benchmark_anchor_invariance:
        "SPY buy-and-hold is established before every scored slice, so one anchor-zero benchmark path is shared.",
      spy_buy_hold_standalone_metrics: benchmarkSlices,
      anchor_results: Object.freeze(anchorResults),
      positive_annualized_log_growth_edge_anchor_counts: Object.freeze({
        denominator: anchors.length,
        by_slice: positiveBySlice,
        development_and_validation: anchorResults.filter((record) => (
          record.slices.development?.comparison.annualized_log_growth_edge > 0
          && record.slices.validation?.comparison.annualized_log_growth_edge > 0
        )).length,
        all_reported_slices: anchorResults.filter((record) => Object.keys(slices).every((sliceId) => (
          record.slices[sliceId].comparison.annualized_log_growth_edge > 0
        ))).length,
      }),
    });
  }
  return Object.freeze(byCost);
}

/** Validate the fixed panel using the same byte and normalized-point checks as Generation 6. */
export function validateVolatilityManagedG4Panel(panelRaw, descriptor = VOLATILITY_MANAGED_G4_PANEL) {
  invariant(Buffer.isBuffer(panelRaw) || panelRaw instanceof Uint8Array,
    "panel raw bytes are required");
  const payloadSha256 = sha256Bytes(panelRaw);
  invariant(payloadSha256 === descriptor.payload_sha256, "private panel payload hash mismatch");
  let panel;
  try {
    panel = JSON.parse(Buffer.from(panelRaw).toString("utf8"));
  } catch {
    fail("private panel is not valid JSON");
  }
  invariant(panel?.schema_version === descriptor.schema_version, "private panel schema mismatch");
  invariant(Array.isArray(panel.points) && panel.points.length === descriptor.common_sessions,
    "private panel session count mismatch");
  invariant(panel.points[0]?.date === descriptor.common_start, "private panel common-start mismatch");
  invariant(panel.points.at(-1)?.date === descriptor.common_end, "private panel common-end mismatch");
  invariant(panel.normalized_panel_sha256 === descriptor.normalized_panel_sha256,
    "private panel normalized hash declaration mismatch");
  let priorDate = "";
  for (const point of panel.points) {
    invariant(typeof point.date === "string" && point.date > priorDate,
      "private panel dates are not strictly increasing");
    priorDate = point.date;
    for (const symbol of GENERATION6_REQUIRED_SYMBOLS) {
      invariant(finitePositive(point[symbol]), `private panel has invalid ${symbol} at ${point.date}`);
    }
  }
  const normalizedPanelSha256 = sha256(panel.points.map((point) => [
    point.date,
    ...GENERATION6_REQUIRED_SYMBOLS.map((symbol) => round(point[symbol], 10)),
  ]));
  invariant(normalizedPanelSha256 === descriptor.normalized_panel_sha256,
    "private panel normalized hash cannot be reproduced");
  return Object.freeze({
    panel: Object.freeze(panel),
    payload_sha256: payloadSha256,
    normalized_panel_sha256: normalizedPanelSha256,
  });
}

export function finalizeVolatilityManagedG4Evaluation(body) {
  invariant(body && typeof body === "object" && !Array.isArray(body),
    "evaluation body must be an object");
  invariant(!Object.hasOwn(body, "artifact_sha256"), "evaluation body already has a self-hash");
  return Object.freeze({ ...body, artifact_sha256: sha256(body) });
}

export function validateVolatilityManagedG4EvaluationArtifact(artifact) {
  invariant(artifact && typeof artifact === "object" && !Array.isArray(artifact),
    "evaluation artifact must be an object");
  const { artifact_sha256: claimed, ...body } = artifact;
  invariant(typeof claimed === "string" && /^[a-f0-9]{64}$/u.test(claimed),
    "evaluation artifact self-hash is invalid");
  invariant(claimed === sha256(body), "evaluation artifact self-hash mismatch");
  return true;
}

async function sourceHashes(projectRoot) {
  return Object.freeze(Object.fromEntries(await Promise.all(SOURCE_PATHS.map(async (relativePath) => {
    const raw = await readFile(safeProjectPath(projectRoot, relativePath));
    return [relativePath, sha256Bytes(raw)];
  }))));
}

export async function buildVolatilityManagedG4EvaluationArtifact({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  const raw = await readFile(safeProjectPath(projectRoot, VOLATILITY_MANAGED_G4_PANEL.path));
  const validated = validateVolatilityManagedG4Panel(raw);
  const sources = await sourceHashes(projectRoot);
  const resultsByCost = evaluateVolatilityManagedG4Panel(validated.panel.points);
  const anchorZeroByCost = Object.freeze(Object.fromEntries(
    Object.entries(resultsByCost).map(([costBps, evidence]) => {
      const record = evidence.anchor_results.find((item) => item.rebalance_anchor === 0);
      invariant(record, `cost ${costBps} omits anchor zero`);
      return [costBps, record];
    }),
  ));
  const body = Object.freeze({
    schema_version: "finly_volatility_managed_g4_candidate_evaluation.v1",
    status: "INTERNAL_POST_SELECTION_CANDIDATE_GENERATION",
    deterministic_timestamp_policy:
      "No wall-clock timestamp is recorded; the immutable panel end date is the evidence boundary.",
    evidence_as_of: VOLATILITY_MANAGED_G4_PANEL.common_end,
    candidate_id: VOLATILITY_MANAGED_G4_CANDIDATE_ID,
    candidate_specification: VOLATILITY_MANAGED_G4_SPECIFICATION,
    candidate_generation_boundary: VOLATILITY_MANAGED_G4_CANDIDATE_GENERATION_BOUNDARY,
    data_integrity: Object.freeze({
      descriptor: VOLATILITY_MANAGED_G4_PANEL,
      symbols_in_normalized_hash_order: GENERATION6_REQUIRED_SYMBOLS,
      verified_payload_sha256: validated.payload_sha256,
      verified_normalized_panel_sha256: validated.normalized_panel_sha256,
    }),
    execution_and_accounting: Object.freeze({
      signal_lookback_sessions: LOOKBACK_SESSIONS,
      rebalance_interval_sessions: REBALANCE_INTERVAL_SESSIONS,
      anchor_zero_primary: 0,
      all_evaluated_anchors: VOLATILITY_MANAGED_G4_ANCHORS,
      one_way_cost_levels_bps: VOLATILITY_MANAGED_G4_COST_LEVELS_BPS,
      annual_borrow_spread: ANNUAL_BORROW_SPREAD,
      terminal_liquidation: true,
      standalone_slice_accounting:
        "Each slice starts from 100% BIL, pays a fresh entry cost, and pays terminal liquidation; inherited terminal markers are removed.",
      timing:
        "Signal at close t; rebalance at close t+1; first earned return is close t+1 to close t+2.",
      positive_edge_definition:
        "Candidate annualized log growth minus SPY annualized log growth is strictly greater than zero.",
    }),
    slices: VOLATILITY_MANAGED_G4_SLICES,
    anchor_zero_primary_evidence_by_cost_bps: anchorZeroByCost,
    all_anchor_sensitivity_by_cost_bps: resultsByCost,
    hashes: Object.freeze({
      private_panel_payload_sha256: validated.payload_sha256,
      normalized_panel_sha256: validated.normalized_panel_sha256,
      source_files_sha256: sources,
    }),
  });
  return finalizeVolatilityManagedG4Evaluation(body);
}

export function serializeVolatilityManagedG4EvaluationArtifact(artifact) {
  validateVolatilityManagedG4EvaluationArtifact(artifact);
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function runVolatilityManagedG4Evaluation({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  const artifact = await buildVolatilityManagedG4EvaluationArtifact({ projectRoot });
  const serialized = serializeVolatilityManagedG4EvaluationArtifact(artifact);
  const outputPath = safeProjectPath(projectRoot, VOLATILITY_MANAGED_G4_OUTPUT_PATH);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
  return Object.freeze({
    artifact,
    output_path: outputPath,
    output_bytes_sha256: sha256Bytes(serialized),
  });
}

function isDirectExecution() {
  return Boolean(process.argv[1])
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  if (process.argv.length !== 2) fail("runner accepts no command-line arguments");
  const result = await runVolatilityManagedG4Evaluation();
  const counts = Object.fromEntries(Object.entries(
    result.artifact.all_anchor_sensitivity_by_cost_bps,
  ).map(([cost, evidence]) => [cost, evidence.positive_annualized_log_growth_edge_anchor_counts]));
  process.stdout.write(`${JSON.stringify({
    status: result.artifact.status,
    output_path: result.output_path,
    artifact_sha256: result.artifact.artifact_sha256,
    output_bytes_sha256: result.output_bytes_sha256,
    positive_edge_anchor_counts_by_cost_bps: counts,
  }, null, 2)}\n`);
}
