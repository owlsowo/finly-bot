import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeModules = process.env.RUNTIME_NODE_MODULES;
if (!runtimeModules) throw new Error("RUNTIME_NODE_MODULES is required");
const { Presentation, PresentationFile } = await import(pathToFileURL(
  path.join(runtimeModules, "@oai/artifact-tool/dist/artifact_tool.mjs"),
).href);
const sharp = (await import(pathToFileURL(
  path.join(runtimeModules, "sharp/dist/index.mjs"),
).href)).default;

const outputPath = path.resolve(process.argv[2] || path.join(ROOT, "public/judge/Finly_Consulting_Deck.pptx"));
const evidenceDir = path.resolve(process.argv[3] || path.join(ROOT, "tmp/deck_build_v2"));
await fs.mkdir(evidenceDir, { recursive: true });

const C = {
  navy: "#0B2942", navy2: "#153A55", ink: "#122A3E", cream: "#F6F1E8", paper: "#FFFCF6",
  green: "#2F7D68", mint: "#B9DFD2", paleMint: "#E3F0EA", coral: "#E56B5D",
  paleCoral: "#F7DED8", gold: "#F2C66D", gray: "#627078", gray2: "#9AABA9",
  rule: "#CAD4CE", white: "#FFFFFF",
};
const FONT = "Arial";
const W = 1280;
const H = 720;

const wealthEvidence = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/g4_wealth_drawdown.json"), "utf8"));
const liveEvidence = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/competition_live.json"), "utf8"));
const firstCloseEvidence = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/competition_forward_profit_2026_08_31.json"), "utf8"));
const optionReceipt = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/latest_receipt.json"), "utf8"));
const externalEvidence = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/attempt150_public_evidence.json"), "utf8"));

const asset = (name) => path.join(ROOT, "public", name);
const finlyMarkPng = await sharp(await fs.readFile(asset("brand/finly-mark.svg")))
  .resize({ width: 1024, height: 1024, fit: "contain" })
  .png()
  .toBuffer();
const assets = {
  // Embed the mark as a real high-resolution PNG. Some PowerPoint viewers do
  // not render SVG media and otherwise fall back to a transparent 1x1 image.
  mark: { blob: finlyMarkPng, contentType: "image/png" },
};

const presentation = Presentation.create({ slideSize: { width: W, height: H } });

function addShape(slide, x, y, width, height, fill, options = {}) {
  return slide.shapes.add({
    geometry: options.geometry || "rect", name: options.name,
    position: { left: x, top: y, width, height }, fill,
    line: options.line || { style: "solid", fill: "none", width: 0 },
    ...(options.borderRadius ? { borderRadius: options.borderRadius } : {}),
    ...(options.shadow ? { shadow: options.shadow } : {}),
  });
}

function addText(slide, text, x, y, width, height, options = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox", name: options.name,
    position: { left: x, top: y, width, height }, fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontFamily: options.fontFamily || FONT, fontSize: options.fontSize || 24,
    bold: options.bold || false, italic: options.italic || false,
    color: options.color || C.ink, alignment: options.alignment || "left",
  };
  return shape;
}

function addLinkedText(slide, text, uri, x, y, width, height, options = {}) {
  const shape = addText(slide, text, x, y, width, height, options);
  shape.text.set([{
    runs: [{
      run: text,
      textStyle: {
        typeface: options.fontFamily || FONT,
        fontSize: `${options.fontSize || 24}px`,
        bold: options.bold || false,
        color: options.color || C.ink,
        ...(options.underline === false ? {} : { underline: "sng" }),
      },
      link: { uri, isExternal: true },
    }],
    paragraphStyle: { alignment: options.alignment || "left" },
  }]);
  return shape;
}

function addKicker(slide, text, color = C.green, x = 64, y = 36) {
  addText(slide, text.toUpperCase(), x, y, 760, 26, { fontSize: 15, bold: true, color });
}

function addFooter(slide, page, dark = false) {
  const color = dark ? "#AFC2C8" : C.gray;
  addText(slide, "FINLY  /  ALPACA AI TRADING AGENTS", 64, 686, 440, 18, { fontSize: 11, bold: true, color });
  addText(slide, String(page).padStart(2, "0"), 1168, 686, 48, 18, { fontSize: 11, bold: true, color, alignment: "right" });
}

function addMetric(slide, value, label, x, y, width, options = {}) {
  addText(slide, value, x, y, width, options.valueHeight || 60, {
    fontSize: options.valueSize || 44, bold: true, color: options.valueColor || C.green,
    alignment: options.alignment || "left",
  });
  addText(slide, label.toUpperCase(), x, y + (options.labelOffset || 55), width, 34, {
    fontSize: options.labelSize || 15, bold: true, color: options.labelColor || C.gray,
    alignment: options.alignment || "left",
  });
}

function setNotes(slide, lines) {
  slide.speakerNotes.textFrame.setText(["[Sources]", ...lines.map((line) => `- ${line}`)].join("\n"));
  slide.speakerNotes.setVisible(true);
}

function addChevron(slide, x, y, color = C.green) {
  addText(slide, "›", x, y, 28, 52, { fontSize: 46, bold: true, color, alignment: "center" });
}

// 1 — Product first.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.navy;
  slide.images.add({ blob: assets.mark.blob, contentType: assets.mark.contentType, alt: "Finly bull-horn mark", fit: "contain", position: { left: 64, top: 40, width: 54, height: 54 } });
  addText(slide, "FINLY", 130, 50, 180, 36, { fontSize: 24, bold: true, color: C.white });
  addKicker(slide, "One autonomous strategy · two coordinated sleeves", C.mint, 64, 126);
  addText(slide, "Finly pairs a tested allocation with capped-risk AI options.", 64, 170, 540, 222, { fontSize: 48, bold: true, color: C.white });
  addText(slide, "The allocation keeps the account invested. AI studies small options trades; fixed rules cap the risk and can still stop them.", 64, 416, 520, 92, { fontSize: 22, color: "#D7E3E5" });
  addShape(slide, 654, 132, 1, 344, "#406278");
  slide.images.add({ blob: assets.mark.blob, contentType: assets.mark.contentType, alt: "Finly bull-horn mark", fit: "contain", position: { left: 824, top: 132, width: 240, height: 240 } });
  addText(slide, "ALLOCATION  +  OPTIONS", 690, 386, 454, 42, { fontSize: 24, bold: true, color: C.white, alignment: "center" });
  addText(slide, "One account  ·  one risk policy", 720, 436, 394, 30, { fontSize: 18, color: C.mint, alignment: "center" });
  addShape(slide, 64, 530, 1152, 1, C.mint);
  addMetric(slide, "$106,711", "historical ending wealth", 64, 552, 250, { valueSize: 38, valueColor: C.gold, labelColor: "#C5D4D8" });
  addMetric(slide, "+$38,629", "versus the S&P 500 tracker", 360, 552, 240, { valueSize: 38, valueColor: C.white, labelColor: "#C5D4D8", labelSize: 12 });
  addMetric(slide, "+$153.31", "First paper session vs SPY", 650, 552, 250, { valueSize: 38, valueColor: C.mint, labelColor: "#C5D4D8", labelSize: 12 });
  addMetric(slide, "$500", "max loss / options trade", 980, 552, 210, { valueSize: 38, valueColor: C.coral, labelColor: "#C5D4D8", labelSize: 13 });
  addText(slide, "Bruce Wen  ·  Brandeis University", 64, 652, 430, 22, { fontSize: 16, color: "#AFC2C8" });
  addFooter(slide, 1, true);
  setNotes(slide, [
    "Live product: https://owlsowo.github.io/finly-bot/",
    "Historical series: https://owlsowo.github.io/finly-bot/data/g4_wealth_drawdown.json",
    "Sanitized paper account: https://owlsowo.github.io/finly-bot/data/competition_live.json",
    "The bull-horn mark is project-owned.",
  ]);
}

// 2 — The authority problem.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.cream;
  addKicker(slide, "The problem");
  addText(slide, "A trading bot is hard to trust when one model can research, size, and send.", 64, 82, 1120, 112, { fontSize: 44, bold: true });
  addText(slide, "COMMON AGENT", 80, 226, 220, 28, { fontSize: 17, bold: true, color: C.coral });
  addShape(slide, 80, 272, 220, 114, C.paleCoral, { geometry: "roundRect", borderRadius: "rounded-xl", line: { style: "solid", fill: C.coral, width: 2 } });
  addText(slide, "ONE MODEL", 94, 302, 192, 34, { fontSize: 23, bold: true, alignment: "center" });
  addText(slide, "reads · sizes · writes", 100, 348, 180, 25, { fontSize: 17, color: C.gray, alignment: "center" });
  addChevron(slide, 310, 300, C.coral);
  addShape(slide, 350, 272, 180, 114, C.white, { geometry: "roundRect", borderRadius: "rounded-xl", line: { style: "solid", fill: C.coral, width: 2 } });
  addText(slide, "ACCOUNT", 362, 305, 156, 34, { fontSize: 23, bold: true, alignment: "center" });
  addText(slide, "one confident error", 362, 344, 156, 24, { fontSize: 16, color: C.coral, alignment: "center" });
  addText(slide, "FINLY", 652, 226, 220, 28, { fontSize: 17, bold: true, color: C.green });
  const finlySteps = [[652, "AI", "interprets"], [818, "CODE", "fixes risk"], [984, "TEST", "permits"]];
  for (let i = 0; i < finlySteps.length; i += 1) {
    const [x, title, sub] = finlySteps[i];
    addShape(slide, x, 272, 138, 114, i === 0 ? C.paleMint : C.white, { geometry: "roundRect", borderRadius: "rounded-xl", line: { style: "solid", fill: C.green, width: 2 } });
    addText(slide, title, x + 10, 300, 118, 34, { fontSize: 25, bold: true, color: C.green, alignment: "center" });
    addText(slide, sub, x + 10, 341, 118, 24, { fontSize: 17, color: C.gray, alignment: "center" });
    if (i < finlySteps.length - 1) addChevron(slide, x + 140, 300, C.green);
  }
  addChevron(slide, 1130, 300, C.green);
  addShape(slide, 1150, 272, 74, 114, C.navy, { geometry: "roundRect", borderRadius: "rounded-xl" });
  addText(slide, "SEND", 1156, 314, 62, 26, { fontSize: 14, bold: true, color: C.white, alignment: "center" });
  addShape(slide, 80, 466, 1144, 2, C.rule);
  addText(slide, "Useful AI judgment—without handing the model the account keys.", 80, 500, 1080, 58, { fontSize: 32, bold: true, color: C.green });
  addText(slide, "Finly's rules choose the maximum risk, the exact option pair, the order details, and whether a trade may be sent.", 80, 582, 1040, 58, { fontSize: 23, color: C.gray });
  addFooter(slide, 2);
  setNotes(slide, [
    "Deployed Qwen3-32B evidence path: https://github.com/owlsowo/finly-bot/blob/main/lib/evidence_extractor.mjs",
    "Cloud model runner: https://github.com/owlsowo/finly-bot/blob/main/.github/workflows/paper-agent-cloud.yml",
    "Positive decision receipt: https://owlsowo.github.io/finly-bot/data/latest_receipt.json",
    "Conflict receipt: https://owlsowo.github.io/finly-bot/data/no_trade_receipt.json",
  ]);
}

// 3 — Meaningful AI and the actual workflow.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.navy;
  addKicker(slide, "How the product works", C.mint);
  addText(slide, "AI explains the opportunity. Rules decide whether money can move.", 64, 80, 1120, 105, { fontSize: 46, bold: true, color: C.white });
  const workflowCards = [
    { x: 64, width: 300, number: "01", label: "FINLY READS", title: "Bounded evidence", body: "Code reads prices and options; AI reads public Alpaca news.", color: C.mint },
    { x: 430, width: 300, number: "02", label: "CODE BUILDS", title: "Exact risk", body: "Position size, maximum loss, and every broker-order field.", color: C.gold },
  ];
  for (const card of workflowCards) {
    addShape(slide, card.x, 226, card.width, 280, C.navy2, { geometry: "roundRect", borderRadius: "rounded-xl", line: { style: "solid", fill: card.color, width: 2 } });
    addText(slide, card.number, card.x + 24, 248, 44, 28, { fontSize: 16, bold: true, color: card.color });
    addText(slide, card.label, card.x + 74, 248, 190, 28, { fontSize: 16, bold: true, color: card.color });
    addText(slide, card.title, card.x + 24, 302, card.width - 48, 48, { fontSize: 28, bold: true, color: C.white });
    addText(slide, card.body, card.x + 24, 372, card.width - 48, 86, { fontSize: 20, color: "#D7E3E5" });
  }
  addText(slide, "→", 370, 326, 54, 64, { fontSize: 44, bold: true, color: C.mint, alignment: "center" });
  addText(slide, "→", 736, 326, 54, 64, { fontSize: 44, bold: true, color: C.gold, alignment: "center" });
  addShape(slide, 796, 226, 420, 280, C.navy2, { geometry: "roundRect", borderRadius: "rounded-xl", line: { style: "solid", fill: C.coral, width: 2 } });
  addText(slide, "03", 820, 248, 44, 28, { fontSize: 16, bold: true, color: C.coral });
  addText(slide, "RULES DECIDE", 870, 248, 230, 28, { fontSize: 16, bold: true, color: C.coral });
  addText(slide, "Can money move?", 820, 294, 360, 42, { fontSize: 28, bold: true, color: C.white });
  addShape(slide, 820, 356, 172, 76, C.green, { geometry: "roundRect", borderRadius: "rounded-lg" });
  addText(slide, "PASS", 838, 370, 136, 24, { fontSize: 15, bold: true, color: C.white, alignment: "center" });
  addText(slide, "ORDER READY", 832, 398, 148, 24, { fontSize: 15, bold: true, color: C.white, alignment: "center" });
  addShape(slide, 1016, 356, 176, 76, C.coral, { geometry: "roundRect", borderRadius: "rounded-lg" });
  addText(slide, "FAIL", 1034, 370, 140, 24, { fontSize: 15, bold: true, color: C.white, alignment: "center" });
  addText(slide, "NO TRADE", 1028, 398, 152, 24, { fontSize: 18, bold: true, color: C.white, alignment: "center" });
  addShape(slide, 64, 552, 1152, 3, C.green);
  addText(slide, "One strategy, two sleeves: allocation carries exposure; options activate only when every extra gate passes.", 64, 574, 1152, 48, { fontSize: 24, bold: true, color: C.mint });
  addFooter(slide, 3, true);
  setNotes(slide, [
    "Interactive product: https://owlsowo.github.io/finly-bot/#controls",
    "Deployed Qwen3-32B evidence path: https://github.com/owlsowo/finly-bot/blob/main/lib/evidence_extractor.mjs",
    "Hosted-model readiness gate: https://github.com/owlsowo/finly-bot/blob/main/scripts/featherless_readiness_check.mjs",
    "Compiled order receipt: https://owlsowo.github.io/finly-bot/data/latest_receipt.json",
  ]);
}

// 4 — Historical wealth and drawdown.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.paper;
  addKicker(slide, "Historical replay");
  addText(slide, "$10,000 became $106,711: $38,629 ahead of SPY.", 64, 78, 1140, 66, { fontSize: 44, bold: true });
  addText(slide, "Historical rule: 50% QQQ + 50% across three trend-selected sectors. Competition deployment: 97% of those weights + 3% cash.", 66, 148, 1100, 28, { fontSize: 16, color: C.gray });
  addText(slide, "2013–2026 · same $10,000 start · modeled 0.05% cost per buy or sell", 66, 176, 850, 24, { fontSize: 16, color: C.gray });
  const rows = wealthEvidence.rows;
  const sampled = rows.filter((_, idx) => idx % 50 === 0 || idx === rows.length - 1);
  const categories = sampled.map((row) => row.date);
  const finlyWealth = sampled.map((row) => Math.round(row.g4_wealth * 10000));
  const spyWealth = sampled.map((row) => Math.round(row.spy_wealth * 10000));
  slide.charts.add("line", {
    position: { left: 64, top: 210, width: 910, height: 410 }, categories,
    series: [
      { name: "Finly", values: finlyWealth, line: { style: "solid", fill: C.green, width: 4 }, marker: { symbol: "none" } },
      { name: "SPY · S&P 500 tracker", values: spyWealth, line: { style: "dash", fill: C.navy, width: 3 }, marker: { symbol: "none" } },
    ],
    hasLegend: true, legend: { position: "top", overlay: false, textStyle: { fill: C.ink, fontSize: 16, bold: true } },
    xAxis: { visible: false, tickLabelPosition: "none", majorGridlines: null },
    yAxis: { visible: true, min: 0, max: 120000, majorUnit: 30000, numberFormatCode: "$#,##0", textStyle: { fill: C.gray, fontSize: 14 }, majorGridlines: { style: "solid", fill: "#DFE6E1", width: 1 } },
    chartFill: C.paper, chartLine: { style: "solid", fill: "none", width: 0 }, plotAreaFill: C.paper, plotAreaLine: { style: "solid", fill: "none", width: 0 },
  });
  addMetric(slide, "$106,711", "Finly ending wealth", 1000, 224, 210, { valueSize: 40 });
  addMetric(slide, "$68,082", "SPY ending wealth", 1000, 334, 210, { valueSize: 36, valueColor: C.navy });
  addMetric(slide, "+967.11%", "Finly total return", 1000, 444, 210, { valueSize: 34, valueColor: C.green });
  addText(slide, "WORST DECLINE", 1000, 562, 220, 20, { fontSize: 13, bold: true, color: C.gray });
  addText(slide, "Finly −28.99%\nSPY −33.72%", 1000, 584, 220, 48, { fontSize: 18, bold: true, color: C.ink });
  addFooter(slide, 4);
  setNotes(slide, [
    "Historical wealth and drawdown series: https://owlsowo.github.io/finly-bot/data/g4_wealth_drawdown.json",
    "Quantitative claim boundary: https://owlsowo.github.io/finly-bot/data/quantitative_release_gate.json",
    "Historical simulation with modeled 5 bp one-way costs; not broker P&L or a forecast.",
  ]);
}

// 5 — Robustness.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.navy;
  addKicker(slide, "A second historical stress test", C.gold);
  addText(slide, "An 80-year market test stayed ahead across all 21 tested monthly rebalance schedules.", 64, 78, 1130, 110, { fontSize: 41, bold: true, color: C.white });
  addShape(slide, 100, 262, 1080, 4, "#527187");
  addShape(slide, 100, 252, 22, 22, C.gold, { geometry: "ellipse" });
  addShape(slide, 1158, 252, 22, 22, C.gold, { geometry: "ellipse" });
  addText(slide, "1927", 76, 286, 80, 28, { fontSize: 19, bold: true, color: C.gold, alignment: "center" });
  addText(slide, "2007", 1128, 286, 80, 28, { fontSize: 19, bold: true, color: C.gold, alignment: "center" });
  addText(slide, "21,218 public market days", 430, 224, 420, 42, { fontSize: 30, bold: true, color: C.white, alignment: "center" });
  addText(slide, "PUBLIC INDUSTRY DATASET", 430, 280, 420, 24, { fontSize: 13, bold: true, color: C.gold, alignment: "center" });
  addMetric(slide, "13.37%", "Finly growth per year", 88, 352, 260, { valueSize: 48, valueColor: C.mint, labelColor: "#C4D4D8" });
  addText(slide, "vs 9.48% market", 88, 450, 260, 32, { fontSize: 22, color: C.white });
  addMetric(slide, "21 / 21", "tested monthly rebalance schedules", 480, 352, 300, { valueSize: 48, valueColor: C.gold, labelColor: "#C4D4D8" });
  for (let i = 0; i < 21; i += 1) addShape(slide, 484 + (i % 11) * 23, 458 + Math.floor(i / 11) * 26, 13, 13, C.gold, { geometry: "ellipse" });
  addMetric(slide, "+2.45 points", "annualized growth edge after 0.25% costs", 890, 352, 280, { valueSize: 40, valueColor: C.gold, labelColor: "#C4D4D8" });
  addText(slide, "0.05%  →  0.10%  →  0.25%", 880, 450, 320, 34, { fontSize: 18, bold: true, color: C.white });
  addShape(slide, 890, 496, 232, 8, C.gold, { geometry: "roundRect", borderRadius: "rounded-xl" });
  addShape(slide, 890, 496, 78, 8, C.mint, { geometry: "roundRect", borderRadius: "rounded-xl" });
  addShape(slide, 64, 568, 1152, 1, "#527187");
  addText(slide, "Its worst decline was 16.31 percentage points smaller than the market proxy.", 64, 594, 1080, 48, { fontSize: 26, bold: true, color: C.mint });
  addFooter(slide, 5, true);
  setNotes(slide, [
    "External-era evidence: https://owlsowo.github.io/finly-bot/data/attempt150_public_evidence.json",
    "Kenneth French 10 Industry Portfolios: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/10_Industry_Portfolios_daily_CSV.zip",
    `Evidence record: ${externalEvidence.primary_window.observations} observations, ${externalEvidence.robustness.positive_rebalance_anchors}/${externalEvidence.robustness.tested_rebalance_anchors} positive schedule offsets.`,
    "Industry-proxy reconstruction; separate from live broker performance and not independent validation. It passed 8/9 precommitted gates but failed the multiple-testing-adjusted statistical gate.",
  ]);
}

// 6 — Defined-risk options receipt.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.cream;
  addKicker(slide, "Illustrative options proof");
  addText(slide, "Before Finly prepares an options order, it fixes the most the trade can lose.", 64, 78, 1110, 92, { fontSize: 44, bold: true });
  const prices = [540, 545, 550, 555, 560, 565, 570, 575, 580];
  const payoff = prices.map((price) => Math.round((Math.min(Math.max(560 - price, 0), 10) * 100) - 366));
  slide.charts.add("line", {
    position: { left: 64, top: 202, width: 650, height: 354 }, categories: prices.map((price) => `$${price}`),
    series: [{ name: "Expiry payoff", values: payoff, line: { style: "solid", fill: C.green, width: 5 }, marker: { symbol: "circle", size: 5 } }],
    lineOptions: { smooth: false },
    hasLegend: false, xAxis: { visible: true, textStyle: { fill: C.gray, fontSize: 14 }, majorGridlines: null },
    yAxis: { visible: true, min: -400, max: 700, majorUnit: 200, numberFormatCode: "$#,##0", textStyle: { fill: C.gray, fontSize: 14 }, majorGridlines: { style: "solid", fill: "#D8E0DB", width: 1 } },
    chartFill: C.cream, chartLine: { style: "solid", fill: "none", width: 0 }, plotAreaFill: C.cream, plotAreaLine: { style: "solid", fill: "none", width: 0 },
  });
  addText(slide, "PAYOFF AT EXPIRY", 84, 190, 220, 24, { fontSize: 14, bold: true, color: C.gray });
  addText(slide, "+$634", 164, 235, 150, 42, { fontSize: 28, bold: true, color: C.green });
  addText(slide, "−$366", 546, 442, 140, 42, { fontSize: 28, bold: true, color: C.coral });
  addShape(slide, 760, 194, 456, 374, C.navy, { geometry: "roundRect", borderRadius: "rounded-2xl", shadow: "shadow-md" });
  addText(slide, "ILLUSTRATIVE TWO-OPTION TRADE", 794, 222, 382, 28, { fontSize: 16, bold: true, color: C.mint });
  addText(slide, "SPY falling-price plan", 794, 270, 360, 42, { fontSize: 30, bold: true, color: C.white });
  const orderRows = [["BUY", "1 × SPY 560 PUT"], ["SELL", "1 × SPY 550 PUT"], ["LIMIT", "$3.66 debit"]];
  orderRows.forEach(([label, value], i) => {
    const y = 330 + i * 56;
    addText(slide, label, 794, y, 90, 30, { fontSize: 16, bold: true, color: i === 1 ? C.coral : C.gold });
    addText(slide, value, 900, y, 260, 34, { fontSize: 22, bold: true, color: C.white });
  });
  addShape(slide, 794, 500, 350, 1, "#527187");
  addText(slide, "Simulated plan · no broker order or fill", 794, 518, 360, 32, { fontSize: 17, color: "#C4D4D8" });
  addMetric(slide, "$366", "maximum loss", 80, 582, 210, { valueSize: 38, valueColor: C.coral });
  addMetric(slide, "$634", "maximum gain", 346, 582, 210, { valueSize: 38, valueColor: C.green });
  addMetric(slide, "4 / 4", "same decision after each source removal", 760, 578, 200, { valueSize: 36, valueColor: C.green, labelSize: 11, labelOffset: 54 });
  addMetric(slide, "32 / 32", "same decision after small input changes", 1000, 578, 210, { valueSize: 36, valueColor: C.green, labelSize: 11, labelOffset: 54 });
  addFooter(slide, 6);
  setNotes(slide, [
    "Positive options receipt: https://owlsowo.github.io/finly-bot/data/latest_receipt.json",
    "Conflict receipt: https://owlsowo.github.io/finly-bot/data/no_trade_receipt.json",
    `Receipt: ${optionReceipt.compilation.selected.long_leg.symbol} / ${optionReceipt.compilation.selected.short_leg.symbol}, $${optionReceipt.compilation.selected.entry_debit} debit.`,
    "The checked options fixture is synthetic paper-trading evidence, not realized options P&L.",
  ]);
}

// 7 — Historical-to-forward bridge.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.navy;
  addKicker(slide, "Verified $100,000 paper account / first close", C.mint);
  addText(slide, "Finly closed its first paper session $153.31 ahead of SPY.", 64, 78, 1140, 105, { fontSize: 44, bold: true, color: C.white });
  addShape(slide, 64, 230, 746, 280, C.cream, { geometry: "roundRect", borderRadius: "rounded-2xl", line: { style: "solid", fill: C.mint, width: 2 }, shadow: "shadow-lg" });
  addText(slide, "SAME $100,000 START", 102, 258, 650, 24, { fontSize: 15, bold: true, color: C.green, alignment: "center" });
  addText(slide, "9:30 A.M.", 104, 304, 180, 30, { fontSize: 18, bold: true, color: C.gray, alignment: "center" });
  addText(slide, "$100,000", 102, 342, 184, 48, { fontSize: 34, bold: true, color: C.navy, alignment: "center" });
  addChevron(slide, 316, 338, C.green);
  addText(slide, "4:00 P.M.", 392, 286, 190, 30, { fontSize: 18, bold: true, color: C.green, alignment: "center" });
  addText(slide, "Finly", 392, 326, 190, 24, { fontSize: 16, bold: true, color: C.green, alignment: "center" });
  addText(slide, "$100,095.32", 370, 356, 234, 44, { fontSize: 29, bold: true, color: C.navy, alignment: "center" });
  addText(slide, "SPY", 612, 326, 150, 24, { fontSize: 16, bold: true, color: C.coral, alignment: "center" });
  addText(slide, "$99,942.01", 586, 356, 202, 44, { fontSize: 29, bold: true, color: C.navy, alignment: "center" });
  addShape(slide, 102, 420, 660, 1, C.rule);
  addText(slide, "15 ETF fill events built the allocation sleeve · no options position was open at the close", 102, 446, 660, 34, { fontSize: 17, color: C.gray, alignment: "center" });
  addShape(slide, 64, 548, 746, 2, C.green);
  addText(slide, "One start, one close, one fair comparison.", 64, 568, 746, 30, { fontSize: 22, bold: true, color: C.mint });
  addText(slide, "One strategy made both decisions: the allocation traded; the options sleeve was flat at the close rather than forcing a trade.", 64, 606, 746, 46, { fontSize: 18, color: C.white });
  addText(slide, "FINLY", 858, 226, 180, 24, { fontSize: 15, bold: true, color: C.mint });
  addText(slide, `+$${firstCloseEvidence.primary_kpi.net_pnl_dollars.toFixed(2)}`, 858, 256, 300, 52, { fontSize: 34, bold: true, color: C.white });
  addText(slide, "virtual-money account profit", 858, 306, 300, 24, { fontSize: 16, color: "#C4D4D8" });
  addShape(slide, 858, 344, 344, 1, "#527187");
  addText(slide, "SPY · S&P 500 TRACKER", 858, 370, 260, 24, { fontSize: 15, bold: true, color: C.coral });
  addText(slide, `−$${Math.abs(firstCloseEvidence.benchmark.ending_value_on_same_baseline_dollars - 100000).toFixed(2)}`, 858, 400, 300, 52, { fontSize: 34, bold: true, color: C.white });
  addText(slide, "same-clock price benchmark", 858, 450, 300, 24, { fontSize: 16, color: "#C4D4D8" });
  addShape(slide, 858, 490, 344, 2, C.gold);
  addText(slide, "FINLY ADVANTAGE", 858, 512, 250, 24, { fontSize: 15, bold: true, color: C.gold });
  addText(slide, `+$${firstCloseEvidence.secondary_kpi.excess_pnl_dollars.toFixed(2)}`, 858, 542, 300, 52, { fontSize: 34, bold: true, color: C.gold });
  addText(slide, "Same $100k start · same 4:00 p.m. price · no deposits", 858, 606, 344, 52, { fontSize: 16, bold: true, color: C.mint });
  addFooter(slide, 7, true);
  setNotes(slide, [
    "Sanitized live account: https://owlsowo.github.io/finly-bot/data/competition_live.json",
    "Public live dashboard: https://owlsowo.github.io/finly-bot/#live",
    "Human-frozen competition protocol: https://github.com/owlsowo/finly-bot/blob/main/config/g4-official-production.json",
    "Forward-score contract: https://github.com/owlsowo/finly-bot/blob/main/config/competition-forward-profit.json",
    "First-close measurement: https://owlsowo.github.io/finly-bot/data/competition_forward_profit_2026_08_31.json",
    `Verified starting equity: $${liveEvidence.account.equity.toLocaleString("en-US")}; per-trade risk ceiling: $${liveEvidence.exposure.per_trade_risk_limit_dollars}.`,
    `Exact first-close result: Finly +$${firstCloseEvidence.primary_kpi.net_pnl_dollars.toFixed(2)}, SPY -$${Math.abs(firstCloseEvidence.benchmark.ending_value_on_same_baseline_dollars - 100000).toFixed(2)}, excess +$${firstCloseEvidence.secondary_kpi.excess_pnl_dollars.toFixed(2)}.`,
    "Screenshot is project-owned and records the public paper-account dashboard.",
  ]);
}

// 8 — Fail closed and recover.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.paleMint;
  addKicker(slide, "What happens when a check fails");
  addText(slide, "Finly stops the trade—and records why.", 64, 78, 1120, 72, { fontSize: 47, bold: true });
  const refusalRows = [
    ["1", "EVIDENCE CONFLICTS", "One source points the other way.", C.coral],
    ["2", "TEST FAILS", "Finly retests the idea without each source.", C.gold],
    ["3", "ORDER BLOCKED", "No options instruction reaches Alpaca.", C.navy],
    ["4", "RECEIPT SAVED", "The refusal and its reason remain inspectable.", C.green],
  ];
  refusalRows.forEach(([number, label, body, color], index) => {
    const y = 188 + index * 88;
    addShape(slide, 64, y, 54, 54, color, { geometry: "ellipse" });
    addText(slide, number, 64, y + 10, 54, 28, { fontSize: 19, bold: true, color: C.white, alignment: "center" });
    addText(slide, label, 144, y - 2, 260, 24, { fontSize: 15, bold: true, color });
    addText(slide, body, 144, y + 28, 560, 34, { fontSize: 23, bold: true, color: C.ink });
    if (index < refusalRows.length - 1) addShape(slide, 90, y + 58, 2, 28, C.rule);
  });
  addShape(slide, 790, 188, 426, 326, C.navy, { geometry: "roundRect", borderRadius: "rounded-2xl", line: { style: "solid", fill: C.coral, width: 2 }, shadow: "shadow-md" });
  addText(slide, "DECISION", 826, 222, 354, 24, { fontSize: 15, bold: true, color: C.coral, alignment: "center" });
  addText(slide, "NO TRADE", 826, 268, 354, 58, { fontSize: 45, bold: true, color: C.white, alignment: "center" });
  addText(slide, "$0", 826, 346, 354, 76, { fontSize: 64, bold: true, color: C.mint, alignment: "center" });
  addText(slide, "NEW OPTIONS RISK", 826, 426, 354, 28, { fontSize: 17, bold: true, color: C.white, alignment: "center" });
  addText(slide, "The safest trade can be no trade.", 826, 470, 354, 30, { fontSize: 18, color: "#D7E3E5", alignment: "center" });
  addShape(slide, 64, 560, 1152, 82, C.white, { geometry: "roundRect", borderRadius: "rounded-xl", line: { style: "solid", fill: C.rule, width: 1 } });
  addText(slide, "809", 88, 576, 110, 44, { fontSize: 38, bold: true, color: C.green });
  addText(slide, "AUTOMATED TESTS", 190, 584, 210, 28, { fontSize: 17, bold: true, color: C.gray });
  addText(slide, "807 PASSED", 510, 584, 170, 28, { fontSize: 18, bold: true, color: C.green, alignment: "center" });
  addText(slide, "0 FAILED", 744, 584, 150, 28, { fontSize: 18, bold: true, color: C.navy, alignment: "center" });
  addText(slide, "2 SKIPPED", 978, 584, 170, 28, { fontSize: 18, bold: true, color: C.gray, alignment: "center" });
  addFooter(slide, 8);
  setNotes(slide, [
    "Cloud runner: https://github.com/owlsowo/finly-bot/blob/main/docs/CLOUD_RUNNER.md",
    "Conflict receipt: https://owlsowo.github.io/finly-bot/data/no_trade_receipt.json",
    "Verified automated run: https://github.com/owlsowo/finly-bot/actions/runs/33369848292",
    "Public repository: https://github.com/owlsowo/finly-bot",
  ]);
}

// 9 — Live call to action.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.cream;
  addKicker(slide, "Judge the product");
  addText(slide, "Watch the account. Try the decision. Inspect the proof.", 64, 80, 790, 118, { fontSize: 50, bold: true });
  addText(slide, "$153.31 ahead after session one—and every headline links to evidence you can rerun.", 64, 208, 780, 62, { fontSize: 27, color: C.gray });
  const qrUrl = "https://quickchart.io/qr?text=https%3A%2F%2Fowlsowo.github.io%2Ffinly-bot%2F&size=500&margin=1";
  const qrResponse = await fetch(qrUrl);
  if (!qrResponse.ok) throw new Error(`QR generation failed: ${qrResponse.status}`);
  const qrBytes = new Uint8Array(await qrResponse.arrayBuffer());
  addShape(slide, 890, 70, 326, 326, C.white, { geometry: "roundRect", borderRadius: "rounded-2xl", line: { style: "solid", fill: C.green, width: 2 }, shadow: "shadow-md" });
  slide.images.add({ blob: qrBytes, contentType: "image/png", alt: "QR code to the live Finly product", fit: "contain", position: { left: 918, top: 98, width: 270, height: 270 } });
  addLinkedText(slide, "SCAN TO OPEN FINLY", "https://owlsowo.github.io/finly-bot/", 922, 410, 264, 26, { fontSize: 15, bold: true, color: C.green, alignment: "center" });
  const actions = [["01", "WATCH", "Live $100k paper account", C.green], ["02", "TRY", "Aligned decision vs refusal", C.coral], ["03", "INSPECT", "Code, tests, and decision records", C.navy]];
  actions.forEach(([num, label, body, color], i) => {
    const y = 318 + i * 82;
    addText(slide, num, 66, y, 44, 30, { fontSize: 18, bold: true, color });
    addText(slide, label, 124, y, 160, 30, { fontSize: 18, bold: true, color });
    addText(slide, body, 292, y - 2, 470, 38, { fontSize: 25, bold: true });
    if (i < 2) addShape(slide, 124, y + 50, 638, 1, C.rule);
  });
  addShape(slide, 64, 594, 1152, 3, C.green);
  addText(slide, "Historical results. First-session proof. Every decision inspectable.", 64, 614, 1130, 40, { fontSize: 29, bold: true, color: C.green });
  addLinkedText(slide, "owlsowo.github.io/finly-bot", "https://owlsowo.github.io/finly-bot/", 64, 660, 540, 26, { fontSize: 20, bold: true, color: C.navy });
  addText(slide, "Bruce Wen  ·  bwen412@brandeis.edu", 810, 658, 406, 28, { fontSize: 18, color: C.gray, alignment: "right" });
  addFooter(slide, 9);
  setNotes(slide, [
    "Live product: https://owlsowo.github.io/finly-bot/",
    "Repository: https://github.com/owlsowo/finly-bot",
    "Contact: mailto:bwen412@brandeis.edu",
    "QR encodes the live product URL and was generated by quickchart.io.",
    "Historical simulations and live paper-account results are labeled separately.",
  ]);
}

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  await writeBlob(path.join(evidenceDir, `${stem}.png`), await presentation.export({ slide, format: "png", scale: 1 }));
  await fs.writeFile(path.join(evidenceDir, `${stem}.layout.json`), await (await slide.export({ format: "layout" })).text());
}
await writeBlob(path.join(evidenceDir, "deck-montage.webp"), await presentation.export({ format: "webp", montage: true, scale: 1 }));
const snapshot = await presentation.inspect({ kind: "slide,textbox,shape,image,chart,notes,layout", include: "id,slide,name,title,text,textPreview,bbox,chartType,alt", maxChars: 120000 });
await fs.writeFile(path.join(evidenceDir, "after-inspect.ndjson"), snapshot.ndjson);
await fs.writeFile(path.join(evidenceDir, "source-notes.txt"), [
  "Finly deck v2 source ledger", "- All product screenshots and brand assets are project-owned.",
  "- Historical data: public/data/g4_wealth_drawdown.json.",
  "- External-era evidence: public/data/attempt150_public_evidence.json and Kenneth French Data Library.",
  "- Options evidence: public/data/latest_receipt.json and public/data/no_trade_receipt.json.",
  "- Live account evidence: public/data/competition_live.json.",
  "- First-close same-clock evidence: public/data/competition_forward_profit_2026_08_31.json.",
  "- QR encodes https://owlsowo.github.io/finly-bot/.",
].join("\n"));
const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(outputPath);
console.log(outputPath);
