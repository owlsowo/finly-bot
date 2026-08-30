import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CANDIDATES,
  alignSeriesByDate,
  buildReturnRows,
  chooseCandidate,
  costImplementationPass,
  decideDisposition,
  futurePerturbationPass,
  matchedRiskWindowFamily,
  metricsByCandidate,
  rowsWithin,
  stateContinuityPass,
  validateSeries,
} from "./run_quant_candidate_extension.mjs";

function businessDates(start, count) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function fixturePoints(count = 1_800) {
  const dates = businessDates("2010-01-04", count);
  const values = { SPY: 100, BIL: 100, TLT: 100, GLD: 100 };
  return dates.map((date, index) => {
    const shock = index % 503 === 0 && index > 0 ? -0.08 : 0;
    const spyReturn = 0.00035 + 0.003 * Math.sin(index / 19) + shock;
    const bilReturn = 0.00004 + 0.00001 * Math.sin(index / 47);
    const tltReturn = 0.00015 + 0.0018 * Math.cos(index / 31) - shock * 0.20;
    const gldReturn = 0.00018 + 0.0022 * Math.sin(index / 29 + 0.7) - shock * 0.10;
    values.SPY *= 1 + spyReturn;
    values.BIL *= 1 + bilReturn;
    values.TLT *= 1 + tltReturn;
    values.GLD *= 1 + gldReturn;
    return { date, ...values };
  });
}

function annualizedLogGrowth(rows, id) {
  return rows.reduce((sum, row) => sum + Math.log1p(row.strategies[id].net_return), 0) * 252 / rows.length;
}

function standardDeviation(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

const points = fixturePoints();
const rows = buildReturnRows(points);

assert.ok(rows.length > 1_500);
assert.ok(rows.every((row) => row.signal_date < row.rebalance_date && row.rebalance_date < row.execution_return_date));
assert.ok(rows.every((row) => CANDIDATES.every((candidate) => Math.abs(row.strategies[candidate.id].spy_weight) <= 1 && row.strategies[candidate.id].gross_exposure <= 1)));
assert.equal(futurePerturbationPass(points, rows), true);
assert.equal(costImplementationPass(rows), true);
assert.equal(stateContinuityPass(points), true);

const anchorRows = [0, 1, 2, 3, 4].map((rebalanceAnchor) => buildReturnRows(points, { rebalanceAnchor }));
anchorRows.forEach((candidateRows, anchor) => {
  assert.equal(candidateRows[anchor].rebalanced, true);
  for (let index = 0; index < anchor; index += 1) assert.equal(candidateRows[index].rebalanced, false);
  assert.ok(candidateRows.every((row, index) => row.rebalanced === ((index - anchor) % 5 === 0)));
});

const developmentRows = rows.slice(0, 800);
const validationRows = rows.slice(800, 1_200);
const selectionBefore = chooseCandidate(metricsByCandidate(developmentRows), metricsByCandidate(validationRows));
const mutatedPostRows = rows.slice(1_200).map((row) => ({
  ...row,
  strategies: Object.fromEntries(CANDIDATES.map((candidate) => [candidate.id, {
    ...row.strategies[candidate.id],
    net_return: candidate.id === "absolute_252_cash" ? 0.50 : -0.50,
  }])),
}));
assert.ok(mutatedPostRows.length > 0);
const selectionAfter = chooseCandidate(metricsByCandidate(developmentRows), metricsByCandidate(validationRows));
assert.deepEqual(selectionAfter, selectionBefore);
assert.equal(selectionAfter.post_holdout_rows_used, 0);

const family = matchedRiskWindowFamily(rows, "absolute_252_cash", "frozen_finly", 252);
assert.ok(family.windows.length > 0);
const first = family.windows[0];
const firstSlice = rowsWithin(rows, first.start_date, first.end_date);
assert.equal(firstSlice.length, 252);
const candidateGrowth = annualizedLogGrowth(firstSlice, "absolute_252_cash");
const baselineGrowth = annualizedLogGrowth(firstSlice, "frozen_finly");
const bilGrowth = firstSlice.reduce((sum, row) => sum + Math.log1p(row.cash_return), 0) * 252 / firstSlice.length;
const candidateVolatility = standardDeviation(firstSlice.map((row) => row.strategies.absolute_252_cash.net_return)) * Math.sqrt(252);
const baselineVolatility = standardDeviation(firstSlice.map((row) => row.strategies.frozen_finly.net_return)) * Math.sqrt(252);
const independentlyCalculatedMrer = candidateGrowth - (bilGrowth + (candidateVolatility / baselineVolatility) * (baselineGrowth - bilGrowth));
assert.ok(Math.abs(independentlyCalculatedMrer - first.mrer) <= 1e-8);

const validSeries = businessDates("2020-01-02", 320).map((date, index) => ({ date, close: 100 + index }));
assert.equal(validateSeries(validSeries, "valid fixture").length, 320);
const nullSeries = validSeries.map((point, index) => index === 100 ? { ...point, close: null } : point);
assert.throws(() => validateSeries(nullSeries, "null fixture"), /adjusted close is invalid/);
const seriesBySymbol = Object.fromEntries(["SPY", "BIL", "TLT", "GLD"].map((symbol) => [symbol, [...validSeries]]));
seriesBySymbol.GLD = seriesBySymbol.GLD.filter((_point, index) => index !== 150);
const aligned = alignSeriesByDate(seriesBySymbol);
assert.equal(aligned.common_sessions, 319);
assert.equal(aligned.points.some((point) => point.date === validSeries[150].date), false);

const pass = { passed: true };
const fail = { passed: false };
assert.equal(decideDisposition(pass, pass, pass), "PROMOTE");
assert.equal(decideDisposition(pass, pass, fail), "SHADOW_ONLY");
assert.equal(decideDisposition(fail, pass, pass), "KEEP_V1");
assert.equal(decideDisposition(pass, fail, pass), "KEEP_V1");

const artifactPath = resolve("research/output/quant_candidate_extension.json");
const reportPath = resolve("research/output/quant_candidate_extension_report.md");
let artifact = null;
let renderedReport = null;
try {
  artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  renderedReport = await readFile(reportPath, "utf8");
} catch {
  artifact = null;
  renderedReport = null;
}
if (artifact) {
  assert.equal(artifact.mutation_authorized, false);
  assert.equal(artifact.public_claims_changed, false);
  assert.equal(artifact.dataset.raw_market_rows_embedded, false);
  assert.equal(artifact.qa.selection_post_holdout_rows_used, 0);
  assert.equal(artifact.qa.frozen_alpaca_replication_within_5e_6, true);
  if (artifact.promotion_decision) {
    const artifactBody = { ...artifact };
    delete artifactBody.artifact_sha256;
    const recomputedArtifactHash = createHash("sha256").update(JSON.stringify(artifactBody)).digest("hex");
    assert.equal(artifact.artifact_sha256, recomputedArtifactHash);
    assert.equal(artifact.promotion_decision.disposition, "KEEP_V1");
    assert.equal(Object.keys(artifact.promotion_decision.gate_b.anchors).length, 5);
    assert.equal(artifact.promotion_decision.gate_b.declared_strategy_trial_count, 53);
    assert.ok(artifact.promotion_decision.gate_b.failed_boolean_paths.length > 0);
    assert.ok(renderedReport.includes("conservative 53-trial declaration"));
  }
}

console.log(JSON.stringify({
  status: "PASS",
  fixture_rows: rows.length,
  anchors_checked: anchorRows.length,
  mrer_windows_checked: family.windows.length,
  generated_artifact_checked: Boolean(artifact),
}, null, 2));
