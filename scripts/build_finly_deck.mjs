import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeModules = process.env.RUNTIME_NODE_MODULES;
if (!runtimeModules) throw new Error("RUNTIME_NODE_MODULES is required");
const { Presentation, PresentationFile } = await import(pathToFileURL(
  path.join(runtimeModules, "@oai/artifact-tool/dist/artifact_tool.mjs"),
).href);

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
const optionReceipt = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/latest_receipt.json"), "utf8"));
const externalEvidence = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/attempt150_public_evidence.json"), "utf8"));

const asset = (name) => path.join(ROOT, "public", name);
const assets = {
  mark: { svg: await fs.readFile(asset("brand/finly-mark.svg"), "utf8") },
  home: { blob: await fs.readFile(asset("judge/finly-product-home.png")), contentType: "image/png" },
  aligned: { blob: await fs.readFile(asset("judge/video-controls-aligned.jpg")), contentType: "image/jpeg" },
  conflict: { blob: await fs.readFile(asset("judge/video-controls-conflict.jpg")), contentType: "image/jpeg" },
  live: { blob: await fs.readFile(asset("judge/finly-live-account.png")), contentType: "image/png" },
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

function addImage(slide, imageAsset, x, y, width, height, options = {}) {
  if (options.frame !== false) {
    addShape(slide, x - 5, y - 5, width + 10, height + 10, options.frameFill || C.white, {
      geometry: "roundRect", borderRadius: "rounded-xl",
      line: { style: "solid", fill: options.frameLine || C.rule, width: 1 },
      shadow: options.shadow || "shadow-sm",
    });
  }
  return slide.images.add({
    ...(imageAsset.svg ? { svg: imageAsset.svg } : { blob: imageAsset.blob, contentType: imageAsset.contentType }),
    alt: options.alt || "Finly product screenshot", fit: options.fit || "cover",
    position: { left: x, top: y, width, height }, geometry: "roundRect", borderRadius: "rounded-lg",
    ...(options.crop ? { crop: options.crop } : {}),
  });
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
  slide.images.add({ svg: assets.mark.svg, alt: "Finly bull-horn mark", fit: "contain", position: { left: 64, top: 40, width: 54, height: 54 } });
  addText(slide, "FINLY", 130, 50, 180, 36, { fontSize: 24, bold: true, color: C.white });
  addKicker(slide, "AI research with checked execution", C.mint, 64, 126);
  addText(slide, "Finly turns AI research into a checked Alpaca paper order.", 64, 170, 500, 222, { fontSize: 44, bold: true, color: C.white });
  addText(slide, "The model explains the market. Code fixes the risk, builds the order, and can still stop it.", 64, 418, 470, 92, { fontSize: 24, color: "#D7E3E5" });
  addImage(slide, assets.home, 604, 102, 612, 344, { alt: "Finly homepage showing the historical comparison and live-account call to action", fit: "contain", frameFill: C.cream, frameLine: C.mint, shadow: "shadow-lg" });
  addShape(slide, 64, 530, 1152, 1, C.mint);
  addMetric(slide, "$106,711", "historical ending wealth", 64, 552, 250, { valueSize: 38, valueColor: C.gold, labelColor: "#C5D4D8" });
  addMetric(slide, "+$38,629", "versus SPY", 360, 552, 220, { valueSize: 38, valueColor: C.white, labelColor: "#C5D4D8" });
  addMetric(slide, "$100,000", "verified paper account", 650, 552, 250, { valueSize: 38, valueColor: C.mint, labelColor: "#C5D4D8" });
  addMetric(slide, "$500", "per-trade ceiling", 980, 552, 210, { valueSize: 38, valueColor: C.coral, labelColor: "#C5D4D8" });
  addText(slide, "Bruce Wen  ·  Brandeis University", 64, 652, 430, 22, { fontSize: 16, color: "#AFC2C8" });
  addFooter(slide, 1, true);
  setNotes(slide, [
    "Live product: https://owlsowo.github.io/finly-bot/",
    "Historical series: https://owlsowo.github.io/finly-bot/data/g4_wealth_drawdown.json",
    "Sanitized paper account: https://owlsowo.github.io/finly-bot/data/competition_live.json",
    "Product screenshot and bull-horn mark are project-owned.",
  ]);
}

// 2 — The authority problem.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.cream;
  addKicker(slide, "The problem");
  addText(slide, "Trading agents break when one model researches, sizes, and sends.", 64, 82, 1120, 112, { fontSize: 46, bold: true });
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
  addText(slide, "Useful AI insight without giving the model unchecked control of the account.", 80, 500, 1080, 68, { fontSize: 32, bold: true, color: C.green });
  addText(slide, "Finly keeps exposure, option legs, broker fields, and execution permission in deterministic code.", 80, 582, 1040, 58, { fontSize: 24, color: C.gray });
  addFooter(slide, 2);
  setNotes(slide, [
    "Decision trace: https://owlsowo.github.io/finly-bot/data/llama_decision_trace.json",
    "Positive decision receipt: https://owlsowo.github.io/finly-bot/data/latest_receipt.json",
    "Conflict receipt: https://owlsowo.github.io/finly-bot/data/no_trade_receipt.json",
  ]);
}

// 3 — Meaningful AI and the actual workflow.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.navy;
  addKicker(slide, "How the product works", C.mint);
  addText(slide, "Finly gives AI the judgment; deterministic code keeps the keys.", 64, 80, 1120, 105, { fontSize: 46, bold: true, color: C.white });
  addImage(slide, assets.aligned, 590, 206, 626, 352, { alt: "Finly interactive decision screen with aligned evidence", fit: "contain", frameFill: C.cream, frameLine: C.mint, shadow: "shadow-lg" });
  const steps = [["01", "MODEL", "Assess the evidence", C.mint], ["02", "CODE", "Aggregate, size, and build", C.gold], ["03", "GATE", "Send to Alpaca—or stop", C.coral]];
  steps.forEach(([num, label, body, color], i) => {
    const y = 210 + i * 116;
    addText(slide, num, 68, y, 48, 32, { fontSize: 18, bold: true, color });
    addText(slide, label, 128, y, 110, 28, { fontSize: 16, bold: true, color });
    addText(slide, body, 128, y + 34, 390, 48, { fontSize: 26, bold: true, color: C.white });
    if (i < 2) addShape(slide, 128, y + 96, 360, 1, "#406278");
  });
  addShape(slide, 64, 592, 480, 3, C.green);
  addText(slide, "The model may explain or veto. It never writes broker fields.", 64, 610, 500, 58, { fontSize: 24, bold: true, color: C.mint });
  addFooter(slide, 3, true);
  setNotes(slide, [
    "Interactive product: https://owlsowo.github.io/finly-bot/#demo",
    "Model trace: https://owlsowo.github.io/finly-bot/data/llama_decision_trace.json",
    "Compiled order receipt: https://owlsowo.github.io/finly-bot/data/latest_receipt.json",
    "Screenshot is project-owned.",
  ]);
}

// 4 — Historical wealth and drawdown.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.paper;
  addKicker(slide, "Historical replay");
  addText(slide, "$10,000 became $106,711—$38,629 ahead of SPY.", 64, 78, 1140, 66, { fontSize: 44, bold: true });
  addText(slide, "2013–2026 · identical starting capital · modeled 5 bp one-way costs", 66, 151, 800, 28, { fontSize: 19, color: C.gray });
  const rows = wealthEvidence.rows;
  const sampled = rows.filter((_, idx) => idx % 50 === 0 || idx === rows.length - 1);
  const categories = sampled.map((row) => row.date);
  const finlyWealth = sampled.map((row) => Math.round(row.g4_wealth * 10000));
  const spyWealth = sampled.map((row) => Math.round(row.spy_wealth * 10000));
  slide.charts.add("line", {
    position: { left: 64, top: 202, width: 910, height: 320 }, categories,
    series: [
      { name: "Finly G4", values: finlyWealth, line: { style: "solid", fill: C.green, width: 4 }, marker: { symbol: "none" } },
      { name: "SPY", values: spyWealth, line: { style: "dash", fill: C.navy, width: 3 }, marker: { symbol: "none" } },
    ],
    hasLegend: true, legend: { position: "top", overlay: false, textStyle: { fill: C.ink, fontSize: 16, bold: true } },
    xAxis: { visible: false, tickLabelPosition: "none", majorGridlines: null },
    yAxis: { visible: true, min: 0, max: 120000, majorUnit: 30000, numberFormatCode: "$#,##0", textStyle: { fill: C.gray, fontSize: 14 }, majorGridlines: { style: "solid", fill: "#DFE6E1", width: 1 } },
    chartFill: C.paper, chartLine: { style: "solid", fill: "none", width: 0 }, plotAreaFill: C.paper, plotAreaLine: { style: "solid", fill: "none", width: 0 },
  });
  addMetric(slide, "$106,711", "Finly ending wealth", 1000, 224, 210, { valueSize: 40 });
  addMetric(slide, "$68,082", "SPY ending wealth", 1000, 334, 210, { valueSize: 36, valueColor: C.navy });
  addMetric(slide, "+967.11%", "Finly total return", 1000, 444, 210, { valueSize: 34, valueColor: C.green });
  const finlyDrawdown = sampled.map((row) => row.g4_drawdown);
  const spyDrawdown = sampled.map((row) => row.spy_drawdown);
  slide.charts.add("line", {
    position: { left: 64, top: 540, width: 910, height: 102 }, categories,
    series: [
      { name: "Finly drawdown", values: finlyDrawdown, line: { style: "solid", fill: C.green, width: 2 }, marker: { symbol: "none" } },
      { name: "SPY drawdown", values: spyDrawdown, line: { style: "solid", fill: C.navy, width: 2 }, marker: { symbol: "none" } },
    ],
    hasLegend: false, xAxis: { visible: false, tickLabelPosition: "none", majorGridlines: null },
    yAxis: { visible: true, min: -0.4, max: 0, majorUnit: 0.2, numberFormatCode: "0%", textStyle: { fill: C.gray, fontSize: 12 }, majorGridlines: { style: "solid", fill: "#E2E7E3", width: 1 } },
    chartFill: C.paper, chartLine: { style: "solid", fill: "none", width: 0 }, plotAreaFill: C.paper, plotAreaLine: { style: "solid", fill: "none", width: 0 },
  });
  addText(slide, "DRAWDOWN", 184, 522, 120, 20, { fontSize: 12, bold: true, color: C.gray });
  addText(slide, "Retrospective simulation; the live paper score is measured separately.", 1000, 575, 220, 54, { fontSize: 16, color: C.gray });
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
  addKicker(slide, "Out-of-era stress test", C.gold);
  addText(slide, "The edge survived 80 earlier years, 21 timing choices, and 5× higher costs.", 64, 78, 1130, 110, { fontSize: 45, bold: true, color: C.white });
  addShape(slide, 100, 262, 1080, 4, "#527187");
  addShape(slide, 100, 252, 22, 22, C.gold, { geometry: "ellipse" });
  addShape(slide, 1158, 252, 22, 22, C.gold, { geometry: "ellipse" });
  addText(slide, "1927", 76, 286, 80, 28, { fontSize: 19, bold: true, color: C.gold, alignment: "center" });
  addText(slide, "2007", 1128, 286, 80, 28, { fontSize: 19, bold: true, color: C.gold, alignment: "center" });
  addText(slide, "21,218 public market days", 430, 224, 420, 42, { fontSize: 30, bold: true, color: C.white, alignment: "center" });
  addMetric(slide, "13.37%", "Finly annualized", 88, 352, 260, { valueSize: 48, valueColor: C.mint, labelColor: "#C4D4D8" });
  addText(slide, "vs 9.48% market", 88, 450, 260, 32, { fontSize: 22, color: C.white });
  addMetric(slide, "21 / 21", "rebalance anchors positive", 480, 352, 300, { valueSize: 48, valueColor: C.gold, labelColor: "#C4D4D8" });
  for (let i = 0; i < 21; i += 1) addShape(slide, 484 + (i % 11) * 23, 458 + Math.floor(i / 11) * 26, 13, 13, C.gold, { geometry: "ellipse" });
  addMetric(slide, "+2.45 pp", "edge at 25 bp costs", 890, 352, 280, { valueSize: 48, valueColor: C.gold, labelColor: "#C4D4D8" });
  addText(slide, "5 bp  →  10 bp  →  25 bp", 890, 450, 290, 34, { fontSize: 21, bold: true, color: C.white });
  addShape(slide, 890, 496, 232, 8, C.gold, { geometry: "roundRect", borderRadius: "rounded-xl" });
  addShape(slide, 890, 496, 78, 8, C.mint, { geometry: "roundRect", borderRadius: "rounded-xl" });
  addShape(slide, 64, 568, 1152, 1, "#527187");
  addText(slide, "Maximum drawdown was 16.31 percentage points shallower than the market proxy.", 64, 594, 1080, 48, { fontSize: 26, bold: true, color: C.mint });
  addFooter(slide, 5, true);
  setNotes(slide, [
    "External-era evidence: https://owlsowo.github.io/finly-bot/data/attempt150_public_evidence.json",
    "Kenneth French 10 Industry Portfolios: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/10_Industry_Portfolios_daily_CSV.zip",
    `Evidence record: ${externalEvidence.primary_window.observations} observations, ${externalEvidence.robustness.positive_rebalance_anchors}/${externalEvidence.robustness.tested_rebalance_anchors} positive anchors.`,
    "Industry-proxy historical stress test; separate from live broker performance.",
  ]);
}

// 6 — Defined-risk options receipt.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.cream;
  addKicker(slide, "Defined-risk options");
  addText(slide, "Every options proposal arrives with its worst case already fixed.", 64, 78, 1110, 92, { fontSize: 46, bold: true });
  const prices = [540, 545, 550, 555, 560, 565, 570, 575, 580];
  const payoff = prices.map((price) => Math.round((Math.min(Math.max(560 - price, 0), 10) * 100) - 366));
  slide.charts.add("line", {
    position: { left: 64, top: 202, width: 650, height: 354 }, categories: prices.map((price) => `$${price}`),
    series: [{ name: "Expiry payoff", values: payoff, line: { style: "solid", fill: C.green, width: 5 }, marker: { symbol: "circle", size: 5 } }],
    hasLegend: false, xAxis: { visible: true, textStyle: { fill: C.gray, fontSize: 14 }, majorGridlines: null },
    yAxis: { visible: true, min: -400, max: 700, majorUnit: 200, numberFormatCode: "$#,##0", textStyle: { fill: C.gray, fontSize: 14 }, majorGridlines: { style: "solid", fill: "#D8E0DB", width: 1 } },
    chartFill: C.cream, chartLine: { style: "solid", fill: "none", width: 0 }, plotAreaFill: C.cream, plotAreaLine: { style: "solid", fill: "none", width: 0 },
  });
  addText(slide, "PAYOFF AT EXPIRY", 84, 190, 220, 24, { fontSize: 14, bold: true, color: C.gray });
  addText(slide, "+$634", 164, 235, 150, 42, { fontSize: 28, bold: true, color: C.green });
  addText(slide, "−$366", 546, 442, 140, 42, { fontSize: 28, bold: true, color: C.coral });
  addShape(slide, 760, 194, 456, 374, C.navy, { geometry: "roundRect", borderRadius: "rounded-2xl", shadow: "shadow-md" });
  addText(slide, "ALPACA-COMPATIBLE PAPER ORDER", 794, 222, 382, 28, { fontSize: 16, bold: true, color: C.mint });
  addText(slide, "SPY bear-put vertical", 794, 270, 360, 42, { fontSize: 30, bold: true, color: C.white });
  const orderRows = [["BUY", "1 × SPY 560 PUT"], ["SELL", "1 × SPY 550 PUT"], ["LIMIT", "$3.66 debit"]];
  orderRows.forEach(([label, value], i) => {
    const y = 330 + i * 56;
    addText(slide, label, 794, y, 90, 30, { fontSize: 16, bold: true, color: i === 1 ? C.coral : C.gold });
    addText(slide, value, 900, y, 260, 34, { fontSize: 22, bold: true, color: C.white });
  });
  addShape(slide, 794, 500, 350, 1, "#527187");
  addText(slide, "Exact fields · one contract · synthetic fixture", 794, 518, 360, 32, { fontSize: 17, color: "#C4D4D8" });
  addMetric(slide, "$366", "maximum loss", 80, 582, 210, { valueSize: 38, valueColor: C.coral });
  addMetric(slide, "$634", "maximum gain", 346, 582, 210, { valueSize: 38, valueColor: C.green });
  addMetric(slide, "4 / 4", "source removals", 760, 582, 190, { valueSize: 36, valueColor: C.green });
  addMetric(slide, "32 / 32", "input shocks", 1000, 582, 210, { valueSize: 36, valueColor: C.green });
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
  addKicker(slide, "Separate forward score", C.mint);
  addText(slide, "A human froze the allocation; the $100,000 account supplies the forward score.", 64, 78, 1140, 105, { fontSize: 44, bold: true, color: C.white });
  addImage(slide, assets.live, 64, 214, 746, 418, { alt: "Finly live dashboard showing the verified Alpaca paper account", frameFill: C.cream, frameLine: C.mint, shadow: "shadow-lg" });
  const bridge = [["1", "REPLAY", "$10k → $106,711", C.gold], ["2", "FREEZE", "Human-selected rule", C.mint], ["3", "SCORE", "$100,000 baseline", C.coral]];
  bridge.forEach(([num, label, body, color], i) => {
    const y = 226 + i * 118;
    addShape(slide, 858, y, 54, 54, color, { geometry: "ellipse" });
    addText(slide, num, 871, y + 9, 28, 30, { fontSize: 22, bold: true, color: C.navy, alignment: "center" });
    addText(slide, label, 932, y - 2, 210, 26, { fontSize: 15, bold: true, color });
    addText(slide, body, 932, y + 28, 270, 42, { fontSize: 25, bold: true, color: C.white });
    if (i < 2) addShape(slide, 883, y + 62, 3, 48, "#527187");
  });
  addShape(slide, 858, 594, 344, 2, C.green);
  addText(slide, "Historical upside nominates the test. The account—not the backtest—settles it.", 858, 610, 344, 56, { fontSize: 20, bold: true, color: C.mint });
  addFooter(slide, 7, true);
  setNotes(slide, [
    "Sanitized live account: https://owlsowo.github.io/finly-bot/data/competition_live.json",
    "Public live dashboard: https://owlsowo.github.io/finly-bot/#live",
    "Human-frozen competition protocol: https://github.com/owlsowo/finly-bot/blob/main/config/g4-official-production.json",
    "Forward-score contract: https://github.com/owlsowo/finly-bot/blob/main/config/competition-forward-profit.json",
    `Verified starting equity: $${liveEvidence.account.equity.toLocaleString("en-US")}; per-trade risk ceiling: $${liveEvidence.exposure.per_trade_risk_limit_dollars}.`,
    "Screenshot is project-owned and records paper-account state.",
  ]);
}

// 8 — Fail closed and recover.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.paleMint;
  addKicker(slide, "Operational proof");
  addText(slide, "Finly can fail closed, restart, and prove what happened.", 64, 78, 1120, 90, { fontSize: 47, bold: true });
  addImage(slide, assets.conflict, 618, 208, 598, 336, { alt: "Finly interactive decision screen stopping when evidence conflicts", fit: "contain", frameFill: C.white, frameLine: C.coral, shadow: "shadow-lg" });
  const ops = [["PREPARE", "Build exact intent", C.green], ["CHECK", "Challenge evidence", C.gold], ["READ BACK", "Reconcile with broker", C.navy], ["RECEIPT", "Publish what happened", C.coral]];
  ops.forEach(([label, body, color], i) => {
    const y = 212 + i * 82;
    addShape(slide, 68, y, 12, 54, color, { geometry: "roundRect", borderRadius: "rounded-xl" });
    addText(slide, label, 98, y - 2, 178, 24, { fontSize: 14, bold: true, color });
    addText(slide, body, 98, y + 24, 400, 34, { fontSize: 24, bold: true });
  });
  addShape(slide, 64, 560, 490, 2, C.rule);
  addText(slide, "806", 64, 582, 110, 52, { fontSize: 46, bold: true, color: C.green });
  addText(slide, "tests discovered", 160, 592, 210, 30, { fontSize: 22, bold: true, color: C.gray });
  addText(slide, "804 passed  ·  0 failed  ·  2 skipped", 64, 640, 500, 30, { fontSize: 21, bold: true, color: C.ink });
  addShape(slide, 618, 594, 598, 64, C.navy, { geometry: "roundRect", borderRadius: "rounded-xl" });
  addText(slide, "Conflict → NO TRADE → $0 authorized loss", 640, 611, 554, 34, { fontSize: 21, bold: true, color: C.white, alignment: "center" });
  addFooter(slide, 8);
  setNotes(slide, [
    "Cloud runner: https://github.com/owlsowo/finly-bot/blob/main/docs/CLOUD_RUNNER.md",
    "Conflict receipt: https://owlsowo.github.io/finly-bot/data/no_trade_receipt.json",
    "Verified automated run: https://github.com/owlsowo/finly-bot/actions/runs/33369848292",
    "Public repository: https://github.com/owlsowo/finly-bot",
    "Screenshot is project-owned.",
  ]);
}

// 9 — Live call to action.
{
  const slide = presentation.slides.add();
  slide.background.fill = C.cream;
  addKicker(slide, "Judge the product");
  addText(slide, "Judge the live system—not the slide deck.", 64, 80, 790, 118, { fontSize: 54, bold: true });
  addText(slide, "Watch the account. Challenge a decision. Inspect the code.", 64, 208, 780, 62, { fontSize: 28, color: C.gray });
  const qrUrl = "https://quickchart.io/qr?text=https%3A%2F%2Fowlsowo.github.io%2Ffinly-bot%2F&size=500&margin=1";
  const qrResponse = await fetch(qrUrl);
  if (!qrResponse.ok) throw new Error(`QR generation failed: ${qrResponse.status}`);
  const qrBytes = new Uint8Array(await qrResponse.arrayBuffer());
  addShape(slide, 890, 70, 326, 326, C.white, { geometry: "roundRect", borderRadius: "rounded-2xl", line: { style: "solid", fill: C.green, width: 2 }, shadow: "shadow-md" });
  slide.images.add({ blob: qrBytes, contentType: "image/png", alt: "QR code to the live Finly product", fit: "contain", position: { left: 918, top: 98, width: 270, height: 270 } });
  addText(slide, "SCAN TO OPEN FINLY", 922, 410, 264, 26, { fontSize: 15, bold: true, color: C.green, alignment: "center" });
  const actions = [["01", "WATCH", "Live $100k account", C.green], ["02", "CHALLENGE", "Aligned vs conflicting evidence", C.coral], ["03", "INSPECT", "Code, tests, and receipts", C.navy]];
  actions.forEach(([num, label, body, color], i) => {
    const y = 318 + i * 82;
    addText(slide, num, 66, y, 44, 30, { fontSize: 18, bold: true, color });
    addText(slide, label, 124, y, 160, 30, { fontSize: 18, bold: true, color });
    addText(slide, body, 292, y - 2, 470, 38, { fontSize: 25, bold: true });
    if (i < 2) addShape(slide, 124, y + 50, 638, 1, C.rule);
  });
  addShape(slide, 64, 594, 1152, 3, C.green);
  addText(slide, "Historical upside. Forward score. Every decision inspectable.", 64, 614, 930, 44, { fontSize: 30, bold: true, color: C.green });
  addText(slide, "owlsowo.github.io/finly-bot", 64, 660, 540, 26, { fontSize: 20, bold: true, color: C.navy });
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
  "- QR encodes https://owlsowo.github.io/finly-bot/.",
].join("\n"));
const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(outputPath);
console.log(outputPath);
