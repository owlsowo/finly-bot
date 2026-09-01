#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "public/figures/technical-paper");

function polyline(points) {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

function chartFrame({ width, height, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#171717">${body}</g>
</svg>\n`;
}

function authorityEnvelope() {
  const width = 860;
  const height = 390;
  const left = 78;
  const right = 28;
  const top = 34;
  const bottom = 64;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const x = (value) => left + ((value + 1) / 2) * innerWidth;
  const y = (value) => top + (1 - value) * innerHeight;
  const values = Array.from({ length: 201 }, (_, index) => -1 + index / 100);
  const line = (cap) => polyline(values.map((score) => [
    x(score),
    y(cap * (score < 0 ? Math.max(0, 1 + score) : 1)),
  ]));
  const vertical = [-1, -0.5, 0, 0.5, 1].map((value) => `
    <line x1="${x(value)}" y1="${top}" x2="${x(value)}" y2="${top + innerHeight}" stroke="#e1e1e1" stroke-width="1"/>
    <text x="${x(value)}" y="${top + innerHeight + 24}" font-size="14" text-anchor="middle">${value.toFixed(value === 0 ? 0 : 1)}</text>`).join("");
  const horizontal = [0, 0.25, 0.5, 0.75, 1].map((value) => `
    <line x1="${left}" y1="${y(value)}" x2="${left + innerWidth}" y2="${y(value)}" stroke="#e1e1e1" stroke-width="1"/>
    <text x="${left - 14}" y="${y(value) + 5}" font-size="14" text-anchor="end">${value.toFixed(value === 0 || value === 1 ? 0 : 2)}</text>`).join("");
  return chartFrame({
    width,
    height,
    body: `${vertical}${horizontal}
    <line x1="${left}" y1="${top + innerHeight}" x2="${left + innerWidth}" y2="${top + innerHeight}" stroke="#171717" stroke-width="1.4"/>
    <line x1="${left}" y1="${top}" x2="${left}" y2="${top + innerHeight}" stroke="#171717" stroke-width="1.4"/>
    <polyline points="${line(1)}" fill="none" stroke="#111111" stroke-width="3"/>
    <polyline points="${line(0.5)}" fill="none" stroke="#777777" stroke-width="2.5" stroke-dasharray="9 6"/>
    <text x="${x(0.62)}" y="${y(1) - 12}" font-size="15">deterministic cap u = 1.0</text>
    <text x="${x(0.62)}" y="${y(0.5) - 12}" font-size="15" fill="#555555">deterministic cap u = 0.5</text>
    <text x="${x(-0.55)}" y="${top + 26}" font-size="14" text-anchor="middle" fill="#555555">adverse event evidence reduces authority</text>
    <text x="${x(0.55)}" y="${top + 26}" font-size="14" text-anchor="middle" fill="#555555">supportive event evidence adds no authority</text>
    <text x="${left + innerWidth / 2}" y="${height - 18}" font-size="16" text-anchor="middle">normalized model event score</text>
    <text x="20" y="${top + innerHeight / 2}" font-size="16" text-anchor="middle" transform="rotate(-90 20 ${top + innerHeight / 2})">authorized direction score</text>`,
  });
}

function optionPayoff() {
  const width = 860;
  const height = 400;
  const left = 78;
  const right = 30;
  const top = 34;
  const bottom = 64;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const minimumSpot = 540;
  const maximumSpot = 570;
  const minimumProfit = -400;
  const maximumProfit = 700;
  const x = (spot) => left + ((spot - minimumSpot) / (maximumSpot - minimumSpot)) * innerWidth;
  const y = (profit) => top + ((maximumProfit - profit) / (maximumProfit - minimumProfit)) * innerHeight;
  const payoff = (spot) => 100 * (Math.min(10, Math.max(0, 560 - spot)) - 3.66);
  const values = Array.from({ length: 301 }, (_, index) => minimumSpot + index / 10);
  const spotTicks = [540, 545, 550, 555, 560, 565, 570];
  const profitTicks = [-366, 0, 200, 400, 634];
  const vertical = spotTicks.map((value) => `
    <line x1="${x(value)}" y1="${top}" x2="${x(value)}" y2="${top + innerHeight}" stroke="#e3e3e3" stroke-width="1"/>
    <text x="${x(value)}" y="${top + innerHeight + 24}" font-size="14" text-anchor="middle">${value}</text>`).join("");
  const horizontal = profitTicks.map((value) => `
    <line x1="${left}" y1="${y(value)}" x2="${left + innerWidth}" y2="${y(value)}" stroke="${value === 0 ? "#777777" : "#e3e3e3"}" stroke-width="${value === 0 ? 1.5 : 1}" ${value === 0 ? "stroke-dasharray=\"7 5\"" : ""}/>
    <text x="${left - 14}" y="${y(value) + 5}" font-size="14" text-anchor="end">${value >= 0 ? "+" : "−"}$${Math.abs(value)}</text>`).join("");
  return chartFrame({
    width,
    height,
    body: `${vertical}${horizontal}
    <line x1="${left}" y1="${top + innerHeight}" x2="${left + innerWidth}" y2="${top + innerHeight}" stroke="#171717" stroke-width="1.4"/>
    <line x1="${left}" y1="${top}" x2="${left}" y2="${top + innerHeight}" stroke="#171717" stroke-width="1.4"/>
    <polyline points="${polyline(values.map((spot) => [x(spot), y(payoff(spot))]))}" fill="none" stroke="#111111" stroke-width="3.2"/>
    <line x1="${x(556.34)}" y1="${top}" x2="${x(556.34)}" y2="${top + innerHeight}" stroke="#555555" stroke-width="1.5" stroke-dasharray="5 5"/>
    <text x="${x(556.34) + 7}" y="${top + 18}" font-size="14">breakeven $556.34</text>
    <text x="${x(542)}" y="${y(634) - 10}" font-size="14">maximum gain $634</text>
    <text x="${x(563)}" y="${y(-366) - 10}" font-size="14">maximum loss $366</text>
    <text x="${left + innerWidth / 2}" y="${height - 18}" font-size="16" text-anchor="middle">SPY price at expiration</text>
    <text x="20" y="${top + innerHeight / 2}" font-size="16" text-anchor="middle" transform="rotate(-90 20 ${top + innerHeight / 2})">profit per contract</text>`,
  });
}

function downsample(rows, maximumPoints = 950) {
  const stride = Math.max(1, Math.ceil(rows.length / maximumPoints));
  const sampled = rows.filter((_, index) => index % stride === 0);
  if (sampled.at(-1) !== rows.at(-1)) sampled.push(rows.at(-1));
  return sampled;
}

function wealthAndDrawdown(data) {
  const width = 960;
  const height = 520;
  const left = 82;
  const right = 34;
  const wealthTop = 30;
  const wealthHeight = 280;
  const drawdownTop = 365;
  const drawdownHeight = 100;
  const innerWidth = width - left - right;
  const rows = downsample(data.rows);
  const start = Date.parse(data.rows[0].date);
  const end = Date.parse(data.rows.at(-1).date);
  const x = (date) => left + ((Date.parse(date) - start) / (end - start)) * innerWidth;
  const maximumWealth = Math.max(...data.rows.flatMap((row) => [row.g4_wealth, row.spy_wealth]));
  const wealthY = (wealth) => wealthTop + (1 - Math.log(wealth) / Math.log(maximumWealth * 1.05)) * wealthHeight;
  const drawdownY = (drawdown) => drawdownTop + (-drawdown / 0.36) * drawdownHeight;
  const yearTicks = [2013, 2016, 2019, 2022, 2026];
  const vertical = yearTicks.map((year) => {
    const xx = x(`${year}-01-02`);
    return `
      <line x1="${xx}" y1="${wealthTop}" x2="${xx}" y2="${drawdownTop + drawdownHeight}" stroke="#e3e3e3" stroke-width="1"/>
      <text x="${xx}" y="${height - 18}" font-size="14" text-anchor="middle">${year}</text>`;
  }).join("");
  const wealthTicks = [1, 2, 5, 10].filter((value) => value <= maximumWealth * 1.05);
  const wealthGrid = wealthTicks.map((value) => `
    <line x1="${left}" y1="${wealthY(value)}" x2="${left + innerWidth}" y2="${wealthY(value)}" stroke="#dddddd" stroke-width="1"/>
    <text x="${left - 12}" y="${wealthY(value) + 5}" font-size="14" text-anchor="end">$${(value * 10000).toLocaleString("en-US")}</text>`).join("");
  const drawdownGrid = [0, -0.1, -0.2, -0.3].map((value) => `
    <line x1="${left}" y1="${drawdownY(value)}" x2="${left + innerWidth}" y2="${drawdownY(value)}" stroke="#dddddd" stroke-width="1"/>
    <text x="${left - 12}" y="${drawdownY(value) + 5}" font-size="14" text-anchor="end">${Math.round(value * 100)}%</text>`).join("");
  return chartFrame({
    width,
    height,
    body: `${vertical}${wealthGrid}${drawdownGrid}
    <polyline points="${polyline(rows.map((row) => [x(row.date), wealthY(row.g4_wealth)]))}" fill="none" stroke="#111111" stroke-width="2.6"/>
    <polyline points="${polyline(rows.map((row) => [x(row.date), wealthY(row.spy_wealth)]))}" fill="none" stroke="#777777" stroke-width="2.3" stroke-dasharray="8 5"/>
    <polyline points="${polyline(rows.map((row) => [x(row.date), drawdownY(row.g4_drawdown)]))}" fill="none" stroke="#111111" stroke-width="2.1"/>
    <polyline points="${polyline(rows.map((row) => [x(row.date), drawdownY(row.spy_drawdown)]))}" fill="none" stroke="#777777" stroke-width="1.9" stroke-dasharray="8 5"/>
    <line x1="${left}" y1="${wealthTop + wealthHeight}" x2="${left + innerWidth}" y2="${wealthTop + wealthHeight}" stroke="#171717" stroke-width="1.3"/>
    <line x1="${left}" y1="${drawdownTop}" x2="${left + innerWidth}" y2="${drawdownTop}" stroke="#171717" stroke-width="1.3"/>
    <text x="${left}" y="${wealthTop - 8}" font-size="15">wealth of $10,000 (log scale)</text>
    <text x="${left}" y="${drawdownTop - 10}" font-size="15">drawdown</text>
    <line x1="${left + 470}" y1="20" x2="${left + 510}" y2="20" stroke="#111111" stroke-width="2.6"/>
    <text x="${left + 520}" y="25" font-size="14">G4</text>
    <line x1="${left + 590}" y1="20" x2="${left + 630}" y2="20" stroke="#777777" stroke-width="2.3" stroke-dasharray="8 5"/>
    <text x="${left + 640}" y="25" font-size="14">SPY</text>`,
  });
}

await mkdir(outputDirectory, { recursive: true });
const wealthData = JSON.parse(await readFile(resolve(root, "public/data/g4_wealth_drawdown.json"), "utf8"));
await Promise.all([
  writeFile(resolve(outputDirectory, "authority-envelope.svg"), authorityEnvelope(), "utf8"),
  writeFile(resolve(outputDirectory, "options-payoff.svg"), optionPayoff(), "utf8"),
  writeFile(resolve(outputDirectory, "g4-wealth-drawdown.svg"), wealthAndDrawdown(wealthData), "utf8"),
]);

console.log(`technical-paper figures written to ${outputDirectory}`);
