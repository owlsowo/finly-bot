#!/usr/bin/env node

/**
 * Build the public, range-selectable Generation 4 evidence artifact.
 *
 * The private ledger contains adjusted-close source returns, asset weights,
 * and per-asset observations that may not be redistributed. This export keeps
 * only derived strategy/benchmark returns and the four cost inputs required to
 * reproduce the frozen standalone-window boundary semantics at 5 bp.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import {
  calculatePortfolioMetrics,
  compareMetrics,
  mean,
  quantile,
  rebaseRowsForStandalonePeriod,
  round,
  rowsWithin,
  sampleStandardDeviation,
} from "./champion_engine.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");

export const SCHEMA_VERSION = "finly_public_g4_window_explorer.v1";
export const OUTPUT_PATH = "public/data/g4_window_explorer.json";
export const CANDIDATE_ID = "qqq_core_sector_12_6";
export const BENCHMARK_ID = "spy_buy_hold";
export const DEFAULT_START = "2013-01-02";
export const DEFAULT_END = "2026-08-27";
export const INITIAL_CAPITAL = 100_000;
export const ONE_WAY_COST_BPS = 5;
export const EXPECTED_LEDGER_SHA256 = "6f656b79d7a4e836eda3b85d35bfca34841e80c0da16a2afdef30e862d8a23e1";
export const LEDGER_PATH = `data/private/champion_search/generation4_ledger_${EXPECTED_LEDGER_SHA256}.json.gz`;

const SOURCE_PATHS = Object.freeze({
  freeze_receipt: "research/champion_search_generation4_freeze_receipt.json",
  result_receipt: "research/champion_search_generation4_result_receipt.json",
  protocol: "research/champion_search_generation4_protocol.json",
  engine: "research/champion_engine.mjs",
  frozen_output: "research/output/quant_champion_generation4.json",
  claims_lock: "public/data/submission_claims_lock.json",
  private_ledger: LEDGER_PATH,
});

const PUBLIC_BOOK_FIELDS = Object.freeze([
  "gross_return",
  "financing_spread_cost",
  "base_transaction_cost",
  "entry_notional",
  "terminal_liquidation_notional",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function resolveWithin(rootDir, relativePath) {
  const root = resolve(rootDir);
  const absolute = resolve(root, relativePath);
  const fromRoot = relative(root, absolute);
  invariant(fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !fromRoot.startsWith(sep),
    `path escapes project root: ${relativePath}`);
  return absolute;
}

async function readSource(rootDir, path) {
  const bytes = await readFile(resolveWithin(rootDir, path));
  return Object.freeze({ path, bytes, sha256: sha256(bytes) });
}

function parseJson(source) {
  try {
    return JSON.parse(source.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${source.path} is not valid JSON: ${error.message}`);
  }
}

function deriveEntryNotional(row, cashSymbol = "BIL") {
  const symbols = Object.keys(row.weights ?? {});
  invariant(symbols.includes(cashSymbol), `${row.execution_return_date} omits ${cashSymbol} weights`);
  return round(symbols.reduce((sum, symbol) => (
    sum + Math.abs(Number(row.weights[symbol] ?? 0) - (symbol === cashSymbol ? 1 : 0))
  ), 0));
}

function deriveTerminalLiquidationNotional(row, cashSymbol = "BIL") {
  const symbols = Object.keys(row.weights ?? {});
  invariant(symbols.includes(cashSymbol), `${row.execution_return_date} omits ${cashSymbol} weights`);
  invariant(row.asset_returns && typeof row.asset_returns === "object",
    `${row.execution_return_date} omits per-asset returns`);
  const grossMultiplier = 1 + Number(row.gross_return);
  invariant(Number.isFinite(grossMultiplier) && grossMultiplier > 0,
    `${row.execution_return_date} has an invalid gross return`);
  return round(symbols.filter((symbol) => symbol !== cashSymbol).reduce((sum, symbol) => {
    const weight = Number(row.weights[symbol] ?? 0);
    const assetReturn = Number(row.asset_returns[symbol]);
    invariant(Number.isFinite(weight) && Number.isFinite(assetReturn),
      `${row.execution_return_date} has an invalid ${symbol} position`);
    return sum + Math.abs(weight * (1 + assetReturn) / grossMultiplier);
  }, 0));
}

function derivePublicBookRow(row) {
  const priorTerminalCost = Number(row.terminal_liquidation_cost ?? 0);
  const baseTransactionCost = Number(row.transaction_cost) - priorTerminalCost;
  const values = {
    gross_return: round(Number(row.gross_return)),
    financing_spread_cost: round(Number(row.financing_spread_cost)),
    base_transaction_cost: round(baseTransactionCost),
    entry_notional: deriveEntryNotional(row),
    terminal_liquidation_notional: deriveTerminalLiquidationNotional(row),
  };
  invariant(Object.values(values).every(Number.isFinite), `${row.execution_return_date} has a non-finite derived field`);
  invariant(values.financing_spread_cost >= 0 && values.base_transaction_cost >= -1e-12
    && values.entry_notional >= 0 && values.terminal_liquidation_notional >= 0,
  `${row.execution_return_date} has a negative derived cost or notional`);
  return Object.freeze(values);
}

function alignConsumedRows(candidateRows, spyRows) {
  const candidate = rowsWithin(candidateRows, DEFAULT_START, DEFAULT_END);
  const spy = rowsWithin(spyRows, DEFAULT_START, DEFAULT_END);
  invariant(candidate.length === 3434 && spy.length === candidate.length,
    "claims-lock window does not contain 3,434 aligned observations");
  invariant(candidate[0].execution_return_date === DEFAULT_START && candidate.at(-1).execution_return_date === DEFAULT_END,
    "candidate claims-lock dates changed");
  for (let index = 0; index < candidate.length; index += 1) {
    invariant(candidate[index].execution_return_date === spy[index].execution_return_date,
      `candidate/SPY date mismatch at row ${index}`);
  }
  return Object.freeze({ candidate: Object.freeze(candidate), spy: Object.freeze(spy) });
}

export function buildPublicRows(candidateRows, spyRows) {
  const aligned = alignConsumedRows(candidateRows, spyRows);
  return Object.freeze(aligned.candidate.map((candidateRow, index) => Object.freeze({
    date: candidateRow.execution_return_date,
    g4: derivePublicBookRow(candidateRow),
    spy: derivePublicBookRow(aligned.spy[index]),
  })));
}

/**
 * Reconstruct the frozen standalone net-return path from public derived rows.
 * The first row replaces inherited native cost with entry cost; the final row
 * adds liquidation cost. Interior rows retain their native base cost.
 */
export function rebaseExplorerRows(rows, book, {
  start,
  end,
  oneWayCostBps = ONE_WAY_COST_BPS,
} = {}) {
  invariant(Array.isArray(rows), "explorer rows must be an array");
  invariant(book === "g4" || book === "spy", "book must be g4 or spy");
  invariant(oneWayCostBps === ONE_WAY_COST_BPS, "public explorer rows are cost-bound to 5 bp");
  invariant(typeof start === "string" && typeof end === "string" && start <= end, "invalid explorer date range");
  const selected = rows.filter((row) => row.date >= start && row.date <= end);
  invariant(selected.length >= 2, "explorer range must contain at least two observations");
  const costRate = oneWayCostBps / 10_000;
  return Object.freeze(selected.map((row, index) => {
    const item = row[book];
    invariant(item && PUBLIC_BOOK_FIELDS.every((field) => Number.isFinite(item[field])),
      `${row.date} has an invalid ${book} record`);
    let transactionCost = item.base_transaction_cost;
    if (index === 0) transactionCost = item.entry_notional * costRate;
    if (index === selected.length - 1) transactionCost += item.terminal_liquidation_notional * costRate;
    transactionCost = round(transactionCost);
    return Object.freeze({
      date: row.date,
      gross_return: item.gross_return,
      financing_spread_cost: item.financing_spread_cost,
      transaction_cost: transactionCost,
      net_return: round(item.gross_return - item.financing_spread_cost - transactionCost),
    });
  }));
}

function drawdownEvidence(returns, dates) {
  let equity = 1;
  let peak = 1;
  let peakDate = dates[0] ?? null;
  let maximum = 0;
  let maximumPeakDate = peakDate;
  let valleyDate = dates[0] ?? null;
  for (let index = 0; index < returns.length; index += 1) {
    equity *= 1 + returns[index];
    if (equity > peak) {
      peak = equity;
      peakDate = dates[index];
    }
    const drawdown = equity / peak - 1;
    if (drawdown < maximum) {
      maximum = drawdown;
      maximumPeakDate = peakDate;
      valleyDate = dates[index];
    }
  }
  return Object.freeze({ maximum_drawdown: maximum, peak_date: maximumPeakDate, valley_date: valleyDate });
}

export function calculateExplorerMetrics(rebasedRows) {
  invariant(Array.isArray(rebasedRows) && rebasedRows.length >= 2, "metrics require at least two rows");
  const dates = rebasedRows.map((row) => row.date);
  const returns = rebasedRows.map((row) => row.net_return);
  const growth = returns.reduce((value, item) => value * (1 + item), 1);
  const volatility = sampleStandardDeviation(returns);
  const drawdown = drawdownEvidence(returns, dates);
  return Object.freeze({
    observations: rebasedRows.length,
    start_date: dates[0],
    end_date: dates.at(-1),
    total_return: round(growth - 1),
    annualized_return: round(growth ** (252 / rebasedRows.length) - 1),
    annualized_volatility: round(volatility * Math.sqrt(252)),
    maximum_drawdown: round(drawdown.maximum_drawdown),
    maximum_drawdown_peak_date: drawdown.peak_date,
    maximum_drawdown_valley_date: drawdown.valley_date,
    worst_day_return: round(Math.min(...returns)),
    modeled_transaction_cost_simple_sum: round(rebasedRows.reduce((sum, row) => sum + row.transaction_cost, 0)),
    modeled_financing_spread_simple_sum: round(rebasedRows.reduce((sum, row) => sum + row.financing_spread_cost, 0)),
  });
}

function distribution(values) {
  invariant(Array.isArray(values) && values.length > 0, "distribution is empty");
  return Object.freeze({
    mean: round(mean(values)),
    minimum: round(Math.min(...values)),
    p05: round(quantile(values, 0.05)),
    p25: round(quantile(values, 0.25)),
    median: round(quantile(values, 0.5)),
    p75: round(quantile(values, 0.75)),
    p95: round(quantile(values, 0.95)),
    maximum: round(Math.max(...values)),
  });
}

function summarizeOverlappingWindows(publicRows, years) {
  const sessions = years * 252;
  invariant(Number.isSafeInteger(sessions) && sessions >= 2 && sessions <= publicRows.length,
    `invalid ${years}-year window`);
  const differences = [];
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (let index = 0; index + sessions <= publicRows.length; index += 1) {
    const start = publicRows[index].date;
    const end = publicRows[index + sessions - 1].date;
    const g4 = calculateExplorerMetrics(rebaseExplorerRows(publicRows, "g4", { start, end }));
    const spy = calculateExplorerMetrics(rebaseExplorerRows(publicRows, "spy", { start, end }));
    const difference = g4.total_return - spy.total_return;
    differences.push(difference);
    if (difference > 1e-14) wins += 1;
    else if (difference < -1e-14) losses += 1;
    else ties += 1;
  }
  const total = differences.length;
  return Object.freeze({
    years,
    sessions,
    wins,
    losses,
    ties,
    total,
    win_rate: round(wins / total),
    first_window: Object.freeze({ start: publicRows[0].date, end: publicRows[sessions - 1].date }),
    last_window: Object.freeze({
      start: publicRows[publicRows.length - sessions].date,
      end: publicRows.at(-1).date,
    }),
    g4_minus_spy_total_return: distribution(differences),
  });
}

function standaloneMetrics(rows, start, end) {
  const selected = rowsWithin(rows, start, end);
  invariant(selected.length >= 2, `${start} through ${end} has too few observations`);
  return calculatePortfolioMetrics(rebaseRowsForStandalonePeriod(selected, {
    cashSymbol: "BIL",
    oneWayCostBps: ONE_WAY_COST_BPS,
  }));
}

function buildKnownLosingWindow(candidateRows, spyRows) {
  const requestedStart = "2016-01-01";
  const requestedEnd = "2018-12-31";
  const g4 = standaloneMetrics(candidateRows, requestedStart, requestedEnd);
  const spy = standaloneMetrics(spyRows, requestedStart, requestedEnd);
  invariant(g4.start_date === "2016-01-04" && g4.end_date === requestedEnd,
    "known losing-window dates changed");
  invariant(g4.total_return < spy.total_return, "known losing window no longer trails SPY");
  return Object.freeze({
    label: "2016–2018 counterexample",
    selection_boundary: "Chosen after viewing the consumed history to make an observed failure visible; not preregistered or inferential.",
    requested_start: requestedStart,
    requested_end: requestedEnd,
    observed_start: g4.start_date,
    observed_end: g4.end_date,
    g4,
    spy,
    g4_minus_spy: compareMetrics(g4, spy),
  });
}

function assertClaimsLockMatch(claims, g4, spy) {
  const locked = claims.retrospective_result;
  invariant(claims.schema_version === "finly_submission_claims_lock.v1", "claims-lock schema changed");
  invariant(locked.window?.start === DEFAULT_START && locked.window?.end === DEFAULT_END,
    "claims-lock retrospective window changed");
  invariant(locked.one_way_cost_bps === ONE_WAY_COST_BPS, "claims-lock cost assumption changed");
  const comparisons = [
    [g4.total_return, locked.candidate_total_return, "candidate total return"],
    [spy.total_return, locked.spy_total_return, "SPY total return"],
    [g4.annualized_return, locked.candidate_annualized_return, "candidate annualized return"],
    [spy.annualized_return, locked.spy_annualized_return, "SPY annualized return"],
    [g4.annualized_volatility, locked.candidate_annualized_volatility, "candidate annualized volatility"],
    [spy.annualized_volatility, locked.spy_annualized_volatility, "SPY annualized volatility"],
    [g4.maximum_drawdown, locked.candidate_maximum_drawdown, "candidate maximum drawdown"],
    [spy.maximum_drawdown, locked.spy_maximum_drawdown, "SPY maximum drawdown"],
    [g4.annualized_turnover_notional, locked.candidate_annualized_turnover, "candidate annualized turnover"],
    [spy.annualized_turnover_notional, locked.spy_annualized_turnover, "SPY annualized turnover"],
  ];
  for (const [actual, expected, label] of comparisons) invariant(actual === expected, `${label} differs from claims lock`);
}

function endingValues(g4, spy) {
  const g4Ending = INITIAL_CAPITAL * (1 + g4.total_return);
  const spyEnding = INITIAL_CAPITAL * (1 + spy.total_return);
  return Object.freeze({
    starting_value_usd: INITIAL_CAPITAL,
    g4_ending_value_usd: round(g4Ending, 2),
    spy_ending_value_usd: round(spyEnding, 2),
    g4_minus_spy_ending_value_usd: round(g4Ending - spyEnding, 2),
  });
}

async function loadInputs(rootDir) {
  const entries = await Promise.all(Object.entries(SOURCE_PATHS).map(async ([id, path]) => [id, await readSource(rootDir, path)]));
  const sources = Object.freeze(Object.fromEntries(entries));
  const freezeReceipt = parseJson(sources.freeze_receipt);
  const resultReceipt = parseJson(sources.result_receipt);
  const protocol = parseJson(sources.protocol);
  const frozenOutput = parseJson(sources.frozen_output);
  const claims = parseJson(sources.claims_lock);

  invariant(freezeReceipt.schema_version === "finly_champion_search_generation4_freeze_receipt.v1",
    "Generation 4 freeze-receipt schema changed");
  invariant(resultReceipt.schema_version === "finly_champion_search_generation4_result_receipt.v1",
    "Generation 4 result-receipt schema changed");
  invariant(protocol.schema_version === "finly_champion_search_generation4_protocol.v1",
    "Generation 4 protocol schema changed");
  invariant(frozenOutput.schema_version === "finly_quant_champion_generation4.v1",
    "Generation 4 output schema changed");
  invariant(sources.protocol.sha256 === resultReceipt.frozen_protocol_sha256,
    "protocol hash differs from result receipt");
  invariant(sources.protocol.sha256 === freezeReceipt.files[SOURCE_PATHS.protocol],
    "protocol hash differs from freeze receipt");
  invariant(sources.engine.sha256 === freezeReceipt.files[SOURCE_PATHS.engine],
    "standalone engine hash differs from freeze receipt");
  invariant(sources.frozen_output.sha256 === resultReceipt.files[SOURCE_PATHS.frozen_output],
    "frozen output hash differs from result receipt");
  invariant(sources.private_ledger.sha256 === EXPECTED_LEDGER_SHA256,
    "private ledger gzip hash changed");
  invariant(sources.private_ledger.sha256 === resultReceipt.files[SOURCE_PATHS.private_ledger],
    "private ledger hash differs from result receipt");

  let ledger;
  try {
    ledger = JSON.parse(gunzipSync(sources.private_ledger.bytes).toString("utf8"));
  } catch (error) {
    throw new Error(`private Generation 4 ledger is unreadable: ${error.message}`);
  }
  invariant(ledger.schema_version === "finly_generation4_private_ledger.v1", "private ledger schema changed");
  invariant(ledger.normalized_panel_sha256 === resultReceipt.normalized_panel_sha256,
    "private ledger panel hash differs from result receipt");
  invariant(Array.isArray(ledger.simulations?.[CANDIDATE_ID]) && Array.isArray(ledger.simulations?.[BENCHMARK_ID]),
    "private ledger omits candidate or SPY rows");
  invariant(frozenOutput.raw_return_track?.selected_id_before_recent_and_robustness === CANDIDATE_ID,
    "frozen candidate identity changed");

  return Object.freeze({ sources, freezeReceipt, resultReceipt, protocol, frozenOutput, claims, ledger });
}

export async function buildG4WindowExplorer({ rootDir = projectRoot } = {}) {
  const loaded = await loadInputs(rootDir);
  const candidateRows = loaded.ledger.simulations[CANDIDATE_ID];
  const spyRows = loaded.ledger.simulations[BENCHMARK_ID];
  const publicRows = buildPublicRows(candidateRows, spyRows);
  const g4 = standaloneMetrics(candidateRows, DEFAULT_START, DEFAULT_END);
  const spy = standaloneMetrics(spyRows, DEFAULT_START, DEFAULT_END);
  assertClaimsLockMatch(loaded.claims, g4, spy);

  const sourceReceipts = Object.freeze({
    generation4_freeze_receipt: Object.freeze({
      path: SOURCE_PATHS.freeze_receipt,
      sha256: loaded.sources.freeze_receipt.sha256,
      local_time_is_not_independent_prospectivity_proof: true,
    }),
    generation4_result_receipt: Object.freeze({
      path: SOURCE_PATHS.result_receipt,
      sha256: loaded.sources.result_receipt.sha256,
    }),
    generation4_protocol: Object.freeze({ path: SOURCE_PATHS.protocol, sha256: loaded.sources.protocol.sha256 }),
    frozen_generation4_output: Object.freeze({
      path: SOURCE_PATHS.frozen_output,
      sha256: loaded.sources.frozen_output.sha256,
    }),
    standalone_engine: Object.freeze({ path: SOURCE_PATHS.engine, sha256: loaded.sources.engine.sha256 }),
    submission_claims_lock: Object.freeze({
      path: SOURCE_PATHS.claims_lock,
      sha256: loaded.sources.claims_lock.sha256,
    }),
    private_generation4_ledger: Object.freeze({
      path: SOURCE_PATHS.private_ledger,
      gzip_sha256: loaded.sources.private_ledger.sha256,
      schema_version: loaded.ledger.schema_version,
      normalized_panel_sha256: loaded.ledger.normalized_panel_sha256,
      redistributed: false,
    }),
  });

  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    evidence_class: "CONSUMED_RETROSPECTIVE_ETF_REPLAY",
    candidate_id: CANDIDATE_ID,
    benchmark_id: BENCHMARK_ID,
    initial_capital: INITIAL_CAPITAL,
    one_way_cost_bps: ONE_WAY_COST_BPS,
    claim_boundary: loaded.claims.retrospective_result.boundary,
    default_window: Object.freeze({
      start: DEFAULT_START,
      end: DEFAULT_END,
      observations: g4.observations,
      g4,
      spy,
      g4_minus_spy: compareMetrics(g4, spy),
      ending_values: endingValues(g4, spy),
      exact_submission_claims_lock_match: true,
    }),
    assumptions: Object.freeze({
      source: "Hash-pinned Yahoo Finance adjusted-close Generation 4 ledger; underlying prices, asset returns, and weights are not redistributed.",
      public_row_scope: "Only the defensible consumed comparison window in the submission claims lock is exported.",
      alignment: loaded.protocol.data.null_policy,
      execution_timing: loaded.protocol.execution.signal_trade_return,
      standalone_rebase: "Every selected range starts in BIL; its first inherited transaction cost is replaced by 5 bp entry cost, native interior costs remain, and 5 bp risky liquidation is added at the final row.",
      transaction_cost: "The frozen engine subtracts five basis points times absolute traded notional additively from the affected daily return. Terminal liquidation notional is derived from post-return risky weights, but its cost is still an additive return deduction—not an economically exact multiplicative cash flow against closing wealth.",
      capital_path: "Daily net returns compound after the frozen engine's additive cost deductions; no broker order, fill, tax, bid-ask spread, or market-impact observation.",
      universe_bias: loaded.protocol.data.bias_boundary,
      evidence_boundary: "All dates are consumed retrospective evidence selected with hindsight; this is an ETF allocation replay, not options P&L or a forecast.",
    }),
    field_definitions: Object.freeze({
      gross_return: "Strategy or SPY gross return for the recorded execution-return date.",
      financing_spread_cost: "Frozen engine additive daily financing-spread deduction.",
      base_transaction_cost: "Frozen engine native additive transaction-cost deduction after removing any inherited terminal liquidation; replaced by entry cost on the first selected row.",
      entry_notional: "Absolute notional required to move from 100% BIL to the row's start-of-return weights; its 5 bp cost replaces the first row's base transaction cost.",
      terminal_liquidation_notional: "Frozen engine post-return risky-weight notional; its 5 bp cost is added to the final row as an additive return deduction, not multiplied against closing wealth.",
    }),
    robustness: Object.freeze({
      windows: Object.freeze([1, 3, 5].map((years) => summarizeOverlappingWindows(publicRows, years))),
      known_losing_window: buildKnownLosingWindow(candidateRows, spyRows),
      boundary: "Every window is independently rebased, but the daily-start windows overlap heavily and are autocorrelated. Win counts are descriptive sensitivity summaries, not independent trials, p-values, or evidence of future profitability.",
    }),
    source_receipts: sourceReceipts,
    rows: publicRows,
  });
}

export async function writeG4WindowExplorer({ rootDir = projectRoot } = {}) {
  const artifact = await buildG4WindowExplorer({ rootDir });
  const outputPath = resolveWithin(rootDir, OUTPUT_PATH);
  const temporaryPath = `${outputPath}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o644 });
  await rename(temporaryPath, outputPath);
  return Object.freeze({ output_path: OUTPUT_PATH, bytes: Buffer.byteLength(`${JSON.stringify(artifact, null, 2)}\n`), artifact });
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  writeG4WindowExplorer().then(({ output_path: outputPath, bytes, artifact }) => {
    process.stdout.write(`${JSON.stringify({
      status: "BUILT",
      output_path: outputPath,
      bytes,
      rows: artifact.rows.length,
      default_window: { start: artifact.default_window.start, end: artifact.default_window.end },
      exact_submission_claims_lock_match: artifact.default_window.exact_submission_claims_lock_match,
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
