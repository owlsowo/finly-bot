import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import {
  BENCHMARK_ID,
  buildG4WindowExplorer,
  calculateExplorerMetrics,
  CANDIDATE_ID,
  DEFAULT_END,
  DEFAULT_START,
  EXPECTED_LEDGER_SHA256,
  LEDGER_PATH,
  ONE_WAY_COST_BPS,
  OUTPUT_PATH,
  rebaseExplorerRows,
  SCHEMA_VERSION,
} from "../research/build_g4_window_explorer.mjs";
import { rebaseRowsForStandalonePeriod, rowsWithin } from "../research/champion_engine.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");

async function loadArtifact() {
  return JSON.parse(await readFile(resolve(projectRoot, OUTPUT_PATH), "utf8"));
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

test("window explorer is claims-lock aligned and exposes the stable UI schema", async () => {
  const [artifact, claims] = await Promise.all([
    loadArtifact(),
    readFile(resolve(projectRoot, "public/data/submission_claims_lock.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(artifact.schema_version, SCHEMA_VERSION);
  assert.equal(artifact.initial_capital, 100000);
  assert.equal(artifact.one_way_cost_bps, ONE_WAY_COST_BPS);
  assert.equal(artifact.default_window.start, DEFAULT_START);
  assert.equal(artifact.default_window.end, DEFAULT_END);
  assert.equal(artifact.default_window.observations, 3434);
  assert.equal(artifact.default_window.exact_submission_claims_lock_match, true);
  assert.equal(artifact.default_window.g4.total_return, claims.retrospective_result.candidate_total_return);
  assert.equal(artifact.default_window.spy.total_return, claims.retrospective_result.spy_total_return);
  assert.equal(artifact.default_window.g4.annualized_return, claims.retrospective_result.candidate_annualized_return);
  assert.equal(artifact.default_window.spy.annualized_return, claims.retrospective_result.spy_annualized_return);
  assert.equal(artifact.default_window.g4.annualized_volatility, claims.retrospective_result.candidate_annualized_volatility);
  assert.equal(artifact.default_window.spy.annualized_volatility, claims.retrospective_result.spy_annualized_volatility);
  assert.equal(artifact.default_window.g4.maximum_drawdown, claims.retrospective_result.candidate_maximum_drawdown);
  assert.equal(artifact.default_window.spy.maximum_drawdown, claims.retrospective_result.spy_maximum_drawdown);
  assert.equal(artifact.default_window.g4.annualized_turnover_notional, claims.retrospective_result.candidate_annualized_turnover);
  assert.equal(artifact.default_window.spy.annualized_turnover_notional, claims.retrospective_result.spy_annualized_turnover);
  assert.deepEqual(artifact.default_window.ending_values, {
    starting_value_usd: 100000,
    g4_ending_value_usd: 1067105.98,
    spy_ending_value_usd: 680817.46,
    g4_minus_spy_ending_value_usd: 386288.52,
  });
  assert.equal(artifact.claim_boundary, claims.retrospective_result.boundary);
});

test("public rows are derived, aligned, range-bounded, and contain no source prices or weights", async () => {
  const artifact = await loadArtifact();
  assert.equal(artifact.rows.length, 3434);
  assert.equal(artifact.rows[0].date, DEFAULT_START);
  assert.equal(artifact.rows.at(-1).date, DEFAULT_END);
  const bookFields = [
    "base_transaction_cost",
    "entry_notional",
    "financing_spread_cost",
    "gross_return",
    "terminal_liquidation_notional",
  ];
  let priorDate = "";
  for (const row of artifact.rows) {
    assert.deepEqual(Object.keys(row).sort(), ["date", "g4", "spy"]);
    assert.ok(row.date > priorDate);
    assert.ok(row.date >= DEFAULT_START && row.date <= DEFAULT_END);
    for (const book of ["g4", "spy"]) {
      assert.deepEqual(Object.keys(row[book]).sort(), bookFields);
      assert.ok(Object.values(row[book]).every(Number.isFinite));
      assert.ok(row[book].base_transaction_cost >= 0);
      assert.ok(row[book].entry_notional >= 0);
      assert.ok(row[book].terminal_liquidation_notional >= 0);
    }
    const serialized = JSON.stringify(row);
    assert.doesNotMatch(serialized, /asset_returns|signal_weights|weights|adjusted_close|price/i);
    priorDate = row.date;
  }
  assert.equal(artifact.source_receipts.private_generation4_ledger.redistributed, false);
  assert.equal(artifact.source_receipts.private_generation4_ledger.gzip_sha256, EXPECTED_LEDGER_SHA256);
  assert.match(artifact.assumptions.source, /not redistributed/i);
});

test("public rows reproduce exact standalone core metrics for default and losing ranges", async () => {
  const artifact = await loadArtifact();
  for (const [start, end, expectedG4, expectedSpy] of [
    [DEFAULT_START, DEFAULT_END, artifact.default_window.g4, artifact.default_window.spy],
    ["2016-01-01", "2018-12-31", artifact.robustness.known_losing_window.g4, artifact.robustness.known_losing_window.spy],
  ]) {
    const g4 = calculateExplorerMetrics(rebaseExplorerRows(artifact.rows, "g4", { start, end }));
    const spy = calculateExplorerMetrics(rebaseExplorerRows(artifact.rows, "spy", { start, end }));
    for (const field of [
      "observations",
      "start_date",
      "end_date",
      "total_return",
      "annualized_return",
      "annualized_volatility",
      "maximum_drawdown",
      "maximum_drawdown_peak_date",
      "maximum_drawdown_valley_date",
      "worst_day_return",
      "modeled_transaction_cost_simple_sum",
      "modeled_financing_spread_simple_sum",
    ]) {
      assert.equal(g4[field], expectedG4[field], `G4 ${field} differs for ${start}–${end}`);
      assert.equal(spy[field], expectedSpy[field], `SPY ${field} differs for ${start}–${end}`);
    }
  }
  assert.equal(artifact.robustness.known_losing_window.observed_start, "2016-01-04");
  assert.equal(artifact.robustness.known_losing_window.observed_end, "2018-12-31");
  assert.ok(artifact.robustness.known_losing_window.g4.total_return
    < artifact.robustness.known_losing_window.spy.total_return);
  assert.match(artifact.robustness.known_losing_window.selection_boundary, /after viewing/i);
});

test("entry and terminal costs follow the frozen additive-return algebra", async () => {
  const artifact = await loadArtifact();
  const selected = artifact.rows.slice(400, 403);
  const start = selected[0].date;
  const end = selected.at(-1).date;
  const rate = artifact.one_way_cost_bps / 10_000;
  for (const book of ["g4", "spy"]) {
    const rebased = rebaseExplorerRows(artifact.rows, book, { start, end });
    const firstExpectedCost = Number((selected[0][book].entry_notional * rate).toFixed(10));
    const lastExpectedCost = Number((
      selected.at(-1)[book].base_transaction_cost
      + selected.at(-1)[book].terminal_liquidation_notional * rate
    ).toFixed(10));
    assert.equal(rebased[0].transaction_cost, firstExpectedCost);
    assert.equal(rebased.at(-1).transaction_cost, lastExpectedCost);
    assert.equal(rebased[0].net_return, Number((
      selected[0][book].gross_return
      - selected[0][book].financing_spread_cost
      - firstExpectedCost
    ).toFixed(10)));
    assert.equal(rebased.at(-1).net_return, Number((
      selected.at(-1)[book].gross_return
      - selected.at(-1)[book].financing_spread_cost
      - lastExpectedCost
    ).toFixed(10)));
  }
  assert.match(artifact.field_definitions.terminal_liquidation_notional, /additive return deduction/i);
  assert.match(artifact.field_definitions.terminal_liquidation_notional, /not multiplied against closing wealth/i);
});

test("overlapping robustness summaries are explicit descriptive 1/3/5-year checks", async () => {
  const artifact = await loadArtifact();
  assert.deepEqual(artifact.robustness.windows.map((item) => item.years), [1, 3, 5]);
  assert.deepEqual(artifact.robustness.windows.map((item) => item.sessions), [252, 756, 1260]);
  for (const item of artifact.robustness.windows) {
    assert.equal(item.wins + item.losses + item.ties, item.total);
    assert.equal(item.total, artifact.rows.length - item.sessions + 1);
    assert.ok(item.win_rate >= 0 && item.win_rate <= 1);
    assert.ok(item.first_window.start >= DEFAULT_START);
    assert.ok(item.last_window.end <= DEFAULT_END);
    assert.ok(item.g4_minus_spy_total_return.minimum <= item.g4_minus_spy_total_return.median);
    assert.ok(item.g4_minus_spy_total_return.median <= item.g4_minus_spy_total_return.maximum);
  }
  assert.match(artifact.robustness.boundary, /overlap heavily/i);
  assert.match(artifact.robustness.boundary, /not independent trials/i);
});

test("five-year win count independently reproduces from every public-row starting point", async () => {
  const artifact = await loadArtifact();
  const sessions = 5 * 252;
  let wins = 0;
  let losses = 0;
  for (let index = 0; index + sessions <= artifact.rows.length; index += 1) {
    const start = artifact.rows[index].date;
    const end = artifact.rows[index + sessions - 1].date;
    const g4 = calculateExplorerMetrics(rebaseExplorerRows(artifact.rows, "g4", { start, end }));
    const spy = calculateExplorerMetrics(rebaseExplorerRows(artifact.rows, "spy", { start, end }));
    if (g4.total_return > spy.total_return) wins += 1;
    else if (g4.total_return < spy.total_return) losses += 1;
  }
  assert.deepEqual({ wins, losses, total: wins + losses }, { wins: 2175, losses: 0, total: 2175 });
  assert.equal(artifact.robustness.windows.find((item) => item.years === 5).wins, wins);
});

test("checked-in artifact is byte-equivalent to a fresh private-ledger build", {
  skip: !existsSync(resolve(projectRoot, LEDGER_PATH)) && "private Generation 4 ledger is not present in this clone",
}, async () => {
  const artifact = await buildG4WindowExplorer({ rootDir: projectRoot });
  const checkedIn = await readFile(resolve(projectRoot, OUTPUT_PATH), "utf8");
  assert.equal(checkedIn, `${JSON.stringify(artifact, null, 2)}\n`);
});

test("derived public boundary fields match the canonical private standalone engine", {
  skip: !existsSync(resolve(projectRoot, LEDGER_PATH)) && "private Generation 4 ledger is not present in this clone",
}, async () => {
  const [artifact, ledgerBytes] = await Promise.all([
    loadArtifact(),
    readFile(resolve(projectRoot, LEDGER_PATH)),
  ]);
  assert.equal(sha256(ledgerBytes), EXPECTED_LEDGER_SHA256);
  const ledger = JSON.parse(gunzipSync(ledgerBytes).toString("utf8"));
  for (const [book, id] of [["g4", CANDIDATE_ID], ["spy", BENCHMARK_ID]]) {
    for (const [start, end] of [
      [DEFAULT_START, DEFAULT_END],
      ["2016-01-01", "2018-12-31"],
      ["2020-02-19", "2020-03-23"],
      ["2024-03-01", "2025-07-31"],
    ]) {
      const canonical = rebaseRowsForStandalonePeriod(rowsWithin(ledger.simulations[id], start, end), {
        cashSymbol: "BIL",
        oneWayCostBps: ONE_WAY_COST_BPS,
      });
      const derived = rebaseExplorerRows(artifact.rows, book, { start, end });
      assert.deepEqual(derived.map((row) => [row.date, row.transaction_cost, row.net_return]),
        canonical.map((row) => [row.execution_return_date, row.transaction_cost, row.net_return]));
    }
  }
});
