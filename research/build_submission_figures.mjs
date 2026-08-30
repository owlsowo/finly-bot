#!/usr/bin/env node

/**
 * Build judge-facing quantitative figures from frozen Finly artifacts.
 *
 * The script reads the hash-pinned Generation 4 private ledger, exports only
 * derived strategy/benchmark series, and labels every visual as consumed
 * retrospective evidence. It makes no forward-performance claim.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { calculatePortfolioMetrics, rebaseRowsForStandalonePeriod } from "./champion_engine.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedLedgerSha256 = "6f656b79d7a4e836eda3b85d35bfca34841e80c0da16a2afdef30e862d8a23e1";
const ledgerPath = resolve(
  projectRoot,
  "data/private/champion_search",
  `generation4_ledger_${expectedLedgerSha256}.json.gz`,
);
const publicDataPath = resolve(projectRoot, "public/data/g4_wealth_drawdown.json");
const publicFigurePath = resolve(projectRoot, "public/figures/g4_wealth_drawdown.png");
const docsFigurePath = resolve(projectRoot, "docs/figures/g4_wealth_drawdown.png");
const startDate = "2013-01-02";
const endDate = "2026-08-27";

const colors = Object.freeze({
  paper: "#FAF8F2",
  ink: "#102A43",
  green: "#287A61",
  muted: "#66788A",
  grid: "#D9E1E8",
});

function hash(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadCanvasFactory() {
  try {
    return (await import("@napi-rs/canvas")).createCanvas;
  } catch (packageError) {
    const runtimeNodeModules = process.env.RUNTIME_NODE_MODULES;
    invariant(runtimeNodeModules, `@napi-rs/canvas is unavailable and RUNTIME_NODE_MODULES is unset: ${packageError.message}`);
    const moduleUrl = pathToFileURL(resolve(runtimeNodeModules, "@napi-rs/canvas/index.js")).href;
    return (await import(moduleUrl)).createCanvas;
  }
}

function consumedRows(rows) {
  const selected = rows.filter((row) => (
    row.execution_return_date >= startDate && row.execution_return_date <= endDate
  ));
  invariant(selected.length > 0, "No consumed rows found");
  invariant(selected[0].execution_return_date === startDate, "Unexpected first consumed date");
  invariant(selected.at(-1).execution_return_date === endDate, "Unexpected last consumed date");
  return rebaseRowsForStandalonePeriod(selected, { cashSymbol: "BIL", oneWayCostBps: 5 });
}

function deriveSeries(rows) {
  let wealth = 1;
  let peak = 1;
  return rows.map((row) => {
    wealth *= 1 + Number(row.net_return);
    peak = Math.max(peak, wealth);
    return Object.freeze({
      date: row.execution_return_date,
      wealth,
      drawdown: wealth / peak - 1,
    });
  });
}

function rounded(value) {
  return Number(value.toFixed(8));
}

function buildDataset(candidate, spy) {
  invariant(candidate.length === spy.length, "Candidate/SPY length mismatch");
  const rows = candidate.map((candidateRow, index) => {
    const spyRow = spy[index];
    invariant(candidateRow.date === spyRow.date, "Candidate/SPY date mismatch");
    return Object.freeze({
      date: candidateRow.date,
      g4_wealth: rounded(candidateRow.wealth),
      spy_wealth: rounded(spyRow.wealth),
      g4_drawdown: rounded(candidateRow.drawdown),
      spy_drawdown: rounded(spyRow.drawdown),
    });
  });
  return Object.freeze({
    schema_version: "finly_public_g4_wealth_drawdown.v1",
    evidence_class: "CONSUMED_RETROSPECTIVE_ETF_REPLAY",
    candidate_id: "qqq_core_sector_12_6",
    benchmark_id: "spy_buy_hold",
    date_range: Object.freeze({ start: startDate, end: endDate }),
    one_way_cost_bps: 5,
    initial_wealth: 1,
    observations: rows.length,
    source_private_ledger_gzip_sha256: expectedLedgerSha256,
    claim_boundary: "Consumed adjusted-close ETF replay selected after viewing history; descriptive only, not promoted, not an options P&L, and not a forecast.",
    rows,
  });
}

function line(ctx, points, color, width, dash = []) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  points.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.stroke();
  ctx.restore();
}

function text(ctx, value, x, y, options = {}) {
  const {
    color = colors.ink,
    font = "28px Arial",
    align = "left",
    baseline = "alphabetic",
  } = options;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(value, x, y);
  ctx.restore();
}

function renderFigure(dataset, createCanvas) {
  const width = 2400;
  const height = 1500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, width, height);

  const left = 190;
  const right = 90;
  const plotWidth = width - left - right;
  const wealthTop = 275;
  const wealthHeight = 620;
  const drawdownTop = 1015;
  const drawdownHeight = 285;
  const rows = dataset.rows;
  const startMs = Date.parse(`${rows[0].date}T00:00:00Z`);
  const endMs = Date.parse(`${rows.at(-1).date}T00:00:00Z`);
  const xFor = (date) => left + ((Date.parse(`${date}T00:00:00Z`) - startMs) / (endMs - startMs)) * plotWidth;

  const allWealth = rows.flatMap((row) => [row.g4_wealth * 10_000, row.spy_wealth * 10_000]);
  const minimumWealth = Math.min(...allWealth) * 0.92;
  const maximumWealth = Math.max(...allWealth) * 1.08;
  const logMinimum = Math.log(minimumWealth);
  const logMaximum = Math.log(maximumWealth);
  const yWealth = (value) => wealthTop + wealthHeight * (1 - ((Math.log(value) - logMinimum) / (logMaximum - logMinimum)));
  const minimumDrawdown = Math.min(...rows.flatMap((row) => [row.g4_drawdown, row.spy_drawdown]));
  const yDrawdown = (value) => drawdownTop + drawdownHeight * (value / minimumDrawdown);

  text(ctx, "Consumed retrospective ETF replay", left, 95, { font: "bold 52px Arial" });
  text(
    ctx,
    "2013-01-02 to 2026-08-27  ·  adjusted-close ledger  ·  5 bp one-way costs  ·  selected after viewing history",
    left,
    155,
    { color: colors.muted, font: "25px Arial" },
  );

  const wealthTicks = [10_000, 20_000, 50_000, 100_000].filter((value) => value >= minimumWealth && value <= maximumWealth);
  for (const tick of wealthTicks) {
    const y = yWealth(tick);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    text(ctx, `$${tick.toLocaleString("en-US")}`, left - 25, y, {
      color: colors.muted,
      font: "22px Arial",
      align: "right",
      baseline: "middle",
    });
  }

  const g4WealthPoints = rows.map((row) => [xFor(row.date), yWealth(row.g4_wealth * 10_000)]);
  const spyWealthPoints = rows.map((row) => [xFor(row.date), yWealth(row.spy_wealth * 10_000)]);
  line(ctx, g4WealthPoints, colors.green, 6);
  line(ctx, spyWealthPoints, colors.ink, 5, [18, 12]);

  text(ctx, "Value of $10,000 · log scale", left, wealthTop - 32, { color: colors.muted, font: "23px Arial" });
  line(ctx, [[left + 10, wealthTop - 82], [left + 85, wealthTop - 82]], colors.green, 6);
  text(ctx, "Finly G4 shadow", left + 105, wealthTop - 74, { font: "24px Arial" });
  line(ctx, [[left + 390, wealthTop - 82], [left + 465, wealthTop - 82]], colors.ink, 5, [18, 12]);
  text(ctx, "SPY buy-and-hold", left + 485, wealthTop - 74, { font: "24px Arial" });

  const last = rows.at(-1);
  text(ctx, `$${Math.round(last.g4_wealth * 10_000).toLocaleString("en-US")}`, width - right, yWealth(last.g4_wealth * 10_000) - 18, {
    color: colors.green,
    font: "bold 25px Arial",
    align: "right",
  });
  text(ctx, `$${Math.round(last.spy_wealth * 10_000).toLocaleString("en-US")}`, width - right, yWealth(last.spy_wealth * 10_000) + 34, {
    color: colors.ink,
    font: "bold 25px Arial",
    align: "right",
  });

  const yZero = yDrawdown(0);
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, yZero);
  ctx.lineTo(width - right, yZero);
  ctx.stroke();
  for (const tick of [0, -0.1, -0.2, -0.3]) {
    if (tick < minimumDrawdown) continue;
    const y = yDrawdown(tick);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    text(ctx, `${Math.round(tick * 100)}%`, left - 25, y, {
      color: colors.muted,
      font: "22px Arial",
      align: "right",
      baseline: "middle",
    });
  }
  text(ctx, "Drawdown", left, drawdownTop - 30, { color: colors.muted, font: "23px Arial" });
  const g4DrawdownPoints = rows.map((row) => [xFor(row.date), yDrawdown(row.g4_drawdown)]);
  const spyDrawdownPoints = rows.map((row) => [xFor(row.date), yDrawdown(row.spy_drawdown)]);

  ctx.save();
  ctx.fillStyle = "rgba(40, 122, 97, 0.13)";
  ctx.beginPath();
  ctx.moveTo(g4DrawdownPoints[0][0], yZero);
  for (const [x, y] of g4DrawdownPoints) ctx.lineTo(x, y);
  ctx.lineTo(g4DrawdownPoints.at(-1)[0], yZero);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  line(ctx, g4DrawdownPoints, colors.green, 4);
  line(ctx, spyDrawdownPoints, colors.ink, 3.5, [18, 12]);

  for (let year = 2014; year <= 2026; year += 2) {
    const date = `${year}-01-01`;
    const x = xFor(date);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, drawdownTop + drawdownHeight);
    ctx.lineTo(x, drawdownTop + drawdownHeight + 12);
    ctx.stroke();
    text(ctx, String(year), x, drawdownTop + drawdownHeight + 48, {
      color: colors.muted,
      font: "22px Arial",
      align: "center",
    });
  }

  text(
    ctx,
    "G4 was not promoted: multiple-testing, growth-control independence, and source-validation gates failed.",
    left,
    1400,
    { color: colors.muted, font: "22px Arial" },
  );
  text(
    ctx,
    "Not options P&L or a forecast.",
    left,
    1438,
    { color: colors.muted, font: "22px Arial" },
  );

  return canvas.toBuffer("image/png");
}

async function main() {
  const createCanvas = await loadCanvasFactory();
  const compressed = await readFile(ledgerPath);
  invariant(hash(compressed) === expectedLedgerSha256, "Generation 4 ledger hash mismatch");
  const ledger = JSON.parse(gunzipSync(compressed));
  const candidate = deriveSeries(consumedRows(ledger.simulations.qqq_core_sector_12_6));
  const spy = deriveSeries(consumedRows(ledger.simulations.spy_buy_hold));
  const candidateMetrics = calculatePortfolioMetrics(consumedRows(ledger.simulations.qqq_core_sector_12_6));
  const spyMetrics = calculatePortfolioMetrics(consumedRows(ledger.simulations.spy_buy_hold));
  invariant(candidateMetrics.total_return === 9.6710597833, "Candidate total return differs from frozen evidence surface");
  invariant(candidateMetrics.annualized_return === 0.1897447215, "Candidate annualized return differs from frozen evidence surface");
  invariant(candidateMetrics.maximum_drawdown === -0.2898521154, "Candidate drawdown differs from frozen evidence surface");
  invariant(spyMetrics.total_return === 5.8081746189, "SPY total return differs from frozen evidence surface");
  invariant(spyMetrics.annualized_return === 0.1511474737, "SPY annualized return differs from frozen evidence surface");
  invariant(spyMetrics.maximum_drawdown === -0.3371726114, "SPY drawdown differs from frozen evidence surface");
  const dataset = buildDataset(candidate, spy);
  const figure = renderFigure(dataset, createCanvas);

  for (const path of [publicDataPath, publicFigurePath, docsFigurePath]) {
    await mkdir(dirname(path), { recursive: true });
  }
  await writeFile(publicDataPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await Promise.all([
    writeFile(publicFigurePath, figure),
    writeFile(docsFigurePath, figure),
  ]);

  process.stdout.write(`${JSON.stringify({
    dataset: "public/data/g4_wealth_drawdown.json",
    figure: "public/figures/g4_wealth_drawdown.png",
    observations: dataset.observations,
    last_g4_wealth: dataset.rows.at(-1).g4_wealth,
    last_spy_wealth: dataset.rows.at(-1).spy_wealth,
    min_g4_drawdown: Math.min(...dataset.rows.map((row) => row.g4_drawdown)),
    min_spy_drawdown: Math.min(...dataset.rows.map((row) => row.spy_drawdown)),
  }, null, 2)}\n`);
}

await main();
