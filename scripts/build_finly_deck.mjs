import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/judge/Finly_Consulting_Deck.pptx");
const PREVIEW = path.join(ROOT, "tmp/presentation_build/output");
const LOGO = path.join(ROOT, "public/brand/finly-bull-512.png");
const CHART = path.join(ROOT, "docs/figures/g4_wealth_drawdown.png");
const PRODUCT = path.join(ROOT, "public/judge/finly-product-home.png");
const logoBytes = await fs.readFile(LOGO);
const chartBytes = await fs.readFile(CHART);
const productBytes = await fs.readFile(PRODUCT);

const W = 1280;
const H = 720;
const C = {
  paper: "#F6F3EC",
  white: "#FFFFFF",
  navy: "#0D2B43",
  green: "#2E6F5C",
  paleGreen: "#E8EFEA",
  red: "#8B3A3A",
  paleRed: "#F3E8E5",
  ink: "#263238",
  stone: "#68706F",
  rule: "#C8CCC7",
  faint: "#E4E1DA",
};

const deck = Presentation.create({ slideSize: { width: W, height: H } });

function box(slide, name, x, y, w, h, fill = "none", line = "none", radius = 0) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
    ...(radius ? { borderRadius: radius } : {}),
  });
}

function rule(slide, x, y, w, color = C.rule, weight = 1) {
  return slide.shapes.add({
    geometry: "line",
    position: { left: x, top: y, width: w, height: 0 },
    fill: "none",
    line: { style: "solid", fill: color, width: weight },
  });
}

function text(slide, name, value, x, y, w, h, opts = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name,
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = value;
  shape.text.style = {
    typeface: opts.typeface ?? "Arial",
    fontSize: opts.size ?? 22,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.vAlign ?? "top",
    lineSpacing: opts.lineSpacing ?? 1.05,
    autoFit: "shrinkText",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return shape;
}

function label(slide, value, x, y, w, color = C.green) {
  return text(slide, `label-${value}-${x}-${y}`, value.toUpperCase(), x, y, w, 24, {
    size: 13,
    bold: true,
    color,
    typeface: "Arial",
  });
}

function metric(slide, value, caption, x, y, w, color = C.navy, typeface = "Georgia") {
  text(slide, `metric-${caption}`, value, x, y, w, 60, {
    size: 44,
    bold: true,
    color,
    typeface,
  });
  text(slide, `metric-caption-${caption}`, caption.toUpperCase(), x, y + 59, w, 38, {
    size: 13,
    bold: true,
    color: C.stone,
  });
}

function baseSlide(number, actionTitle, sectionLabel, opts = {}) {
  const slide = deck.slides.add();
  slide.background.fill = opts.dark ? C.navy : C.paper;
  const fg = opts.dark ? C.white : C.navy;
  const muted = opts.dark ? "#C5D0D4" : C.stone;

  if (!opts.noHeader) {
    label(slide, sectionLabel, 58, 32, 520, opts.dark ? "#8EB8A7" : C.green);
    text(slide, `slide-title-${number}`, actionTitle, 58, 62, 1164, 104, {
      size: 42,
      bold: true,
      color: fg,
      typeface: "Georgia",
      lineSpacing: 0.96,
    });
    rule(slide, 58, 171, 1164, opts.dark ? "#5E7482" : C.navy, 1.2);
  }

  text(slide, `footer-${number}`, "FINLY  /  PROOF BEFORE AUTHORITY", 58, 682, 440, 18, {
    size: 11,
    bold: true,
    color: muted,
  });
  text(slide, `page-${number}`, String(number).padStart(2, "0"), 1160, 682, 62, 18, {
    size: 11,
    bold: true,
    color: muted,
    align: "right",
  });
  return slide;
}

function notes(slide, lines) {
  slide.speakerNotes.textFrame.setText(["[Sources]", ...lines]);
}

// 1 — title
{
  const slide = baseSlide(1, "", "", { dark: true, noHeader: true });
  slide.images.add({ blob: logoBytes, contentType: "image/png", alt: "Finly bull-horn mark", fit: "contain", position: { left: 62, top: 55, width: 76, height: 76 } });
  text(slide, "title-wordmark", "FINLY", 158, 68, 280, 48, { size: 26, bold: true, color: C.white });
  label(slide, "Execution-realistic controlled delegation", 62, 169, 650, "#8EB8A7");
  text(slide, "title", "Positive after next-open execution.\nStill honest about what is unproven.", 62, 214, 1050, 202, {
    size: 58,
    bold: true,
    color: C.white,
    typeface: "Georgia",
    lineSpacing: 0.94,
  });
  rule(slide, 62, 444, 900, "#8EB8A7", 3);
  text(slide, "subtitle", "Finly returned 15.39% across 415 consumed sessions at next-open fills and five basis points per traded leg. Deterministic code—not an AI model—owns exposure, order fields, maximum loss, and permission to trade.", 62, 475, 948, 112, {
    size: 23,
    color: "#D5DDDF",
    lineSpacing: 1.14,
  });
  text(slide, "author", "Bruce Wen · Brandeis University · Alpaca AI Trading Agents Hackathon", 62, 625, 820, 24, {
    size: 15,
    color: "#9FB1B8",
  });
  notes(slide, [
    "- Finly execution-realism result and claim boundaries: public/data/submission_claims_lock.json",
    "- The 15.39% result is a consumed adjusted-OHLC replay, not a broker fill, options P&L, alpha claim, forecast, or proof of future profit.",
    "- Finly bull-horn mark is project-owned.",
  ]);
}

// 2 — core problem
{
  const slide = baseSlide(2, "Most trading agents collapse judgment, sizing, and execution into one opaque action.", "The design problem");
  label(slide, "Typical agent", 74, 215, 300, C.red);
  text(slide, "judgment-question", "A persuasive answer becomes an order.", 74, 249, 450, 82, { size: 33, bold: true, color: C.navy, typeface: "Georgia" });
  text(slide, "judgment-copy", "The same probabilistic component interprets evidence, chooses direction, sizes risk, writes order fields, and explains itself after the fact.", 74, 350, 430, 128, { size: 22, color: C.ink, lineSpacing: 1.18 });
  box(slide, "divider", 584, 210, 2, 356, C.green, "none");
  label(slide, "Finly", 654, 215, 300, C.green);
  text(slide, "authority-question", "Interpretation can inform capital without controlling it.", 654, 249, 500, 94, { size: 33, bold: true, color: C.navy, typeface: "Georgia" });
  text(slide, "authority-copy", "The model may score bounded evidence, explain uncertainty, or veto. Deterministic code owns exposure, costs, option structure, order fields, and the final permit decision.", 654, 363, 486, 148, { size: 21, color: C.ink, lineSpacing: 1.18 });
  text(slide, "core-thesis", "Finly’s edge is not a larger forecast. It is a smaller, testable trust boundary.", 74, 548, 1066, 70, { size: 27, bold: true, color: C.green, typeface: "Georgia" });
  notes(slide, [
    "- Finly technical paper, Sections 1 and 3.",
    "- Authority and claim boundaries: public/data/submission_claims_lock.json.",
  ]);
}

// 3 — product surface
{
  const slide = baseSlide(3, "Judges can inspect the evidence instead of taking a demo’s word for it.", "The product");
  box(slide, "product-frame", 58, 196, 806, 418, C.white, C.rule);
  slide.images.add({
    blob: productBytes,
    contentType: "image/png",
    alt: "Finly website showing the execution-realism audit and bounded claims",
    fit: "cover",
    position: { left: 72, top: 210, width: 778, height: 390 },
  });
  label(slide, "Visible on the site", 904, 214, 280, C.green);
  metric(slide, "+15.39%", "next-open · 5 bp per leg", 904, 250, 286, C.navy);
  metric(slide, "415", "consumed sessions", 904, 366, 286, C.green);
  metric(slide, "+10.56%", "at 25 bp per leg", 904, 482, 286, C.navy);
  text(slide, "product-boundary", "The same page states that SPY returned 33.52% and that the result is not a broker fill, options P&L, alpha claim, or forecast.", 904, 590, 288, 58, { size: 15, color: C.stone, lineSpacing: 1.12 });
  notes(slide, [
    "- Project-owned product capture from the current local Finly build.",
    "- Exact values and boundaries: public/data/submission_claims_lock.json.",
  ]);
}

// 4 — operating model
{
  const slide = baseSlide(4, "The model can interpret evidence; only deterministic code can authorize capital.", "Controlled delegation");
  const stages = [
    ["1", "Evidence", "Four labeled families", "INPUT"],
    ["2", "Model", "Scores + rationale", "MODEL"],
    ["3", "Aggregate", "Code derives intent", "CODE"],
    ["4", "Compile", "Code owns order fields", "CODE"],
    ["5", "Challenge", "Removals + shocks", "CODE"],
    ["6", "Decide", "PERMIT / NO_TRADE", "GATE"],
  ];
  const x0 = 58;
  const gap = 10;
  const sw = 185;
  stages.forEach(([n, titleValue, copy, owner], i) => {
    const x = x0 + i * (sw + gap);
    if (i > 0) text(slide, `chevron-${i}`, "→", x - 20, 318, 28, 34, { size: 24, color: C.green, align: "center" });
    label(slide, owner, x, 218, sw, owner === "MODEL" ? C.red : C.green);
    text(slide, `stage-number-${i}`, n, x, 252, sw, 30, { size: 15, bold: true, color: C.stone });
    text(slide, `stage-title-${i}`, titleValue, x, 287, sw, 42, { size: 24, bold: true, color: C.navy, typeface: "Georgia" });
    rule(slide, x, 340, sw - 10, owner === "MODEL" ? C.red : C.green, owner === "MODEL" ? 3 : 1.5);
    text(slide, `stage-copy-${i}`, copy, x, 360, sw - 8, 70, { size: 16, color: C.ink, lineSpacing: 1.14 });
  });
  rule(slide, 58, 474, 1164, C.navy, 1.2);
  metric(slide, "$366", "exact max loss in checked fixture", 74, 502, 280, C.navy);
  metric(slide, "4/4", "source-removal challenges", 416, 502, 250, C.green);
  metric(slide, "32/32", "perturbation challenges", 728, 502, 250, C.green);
  text(slide, "authority-close", "Any mismatch returns NO_TRADE; the model never writes the Alpaca payload.", 1010, 520, 190, 84, { size: 17, bold: true, color: C.red, lineSpacing: 1.13 });
  notes(slide, [
    "- Finly technical paper, controlled-delegation architecture and checked fixture.",
    "- Exact checked results: public/data/submission_claims_lock.json.",
    "- Alpaca order interface: https://docs.alpaca.markets/reference/postorder",
  ]);
}

// 5 — execution realism
{
  const slide = baseSlide(5, "Returns stayed positive through 25 bp per leg; SPY still won on raw return.", "Execution realism");
  slide.charts.add("bar", {
    position: { left: 58, top: 214, width: 760, height: 350 },
    categories: ["1 bp", "5 bp", "10 bp", "25 bp"],
    series: [
      { name: "Finly", values: [16.38, 15.39, 14.16, 10.56], fill: C.green },
      { name: "SPY", values: [33.52, 33.52, 33.52, 33.52], fill: C.navy },
    ],
    hasLegend: true,
    dataLabels: { showValue: true, position: "outEnd" },
    xAxis: { majorGridlines: { style: "solid", fill: C.faint, width: 1 } },
  });
  label(slide, "What survived", 872, 216, 280, C.green);
  metric(slide, "+15.39%", "next-open · 5 bp per leg", 872, 250, 310, C.navy);
  metric(slide, "−5.45%", "maximum drawdown", 872, 366, 310, C.green, "Arial");
  metric(slide, "+10.56%", "at 25 bp per leg", 872, 482, 310, C.navy);
  text(slide, "execution-boundary", "Consumed 2025-01-02 to 2026-08-28 · 415 sessions · adjusted OHLC · fractional next-open DAY-order assumption. SPY returned 33.52% on the same adjusted path.", 58, 596, 1128, 48, { size: 15, color: C.stone, lineSpacing: 1.1 });
  notes(slide, [
    "- Execution-realism artifact: research/output/equity_execution_realism.json.",
    "- Exact safe claim and underperformance boundary: public/data/submission_claims_lock.json.",
    "- Result is a consumed retrospective theoretical ledger, not a broker fill, options P&L, alpha claim, forecast, or proof of future profit.",
  ]);
}

// 6 — small-account feasibility
{
  const slide = baseSlide(6, "A $300 shadow ended at $351.88 without rounding tiny adjustments into fake fills.", "Small-account feasibility");
  label(slide, "Starting equity", 86, 226, 250, C.stone);
  text(slide, "start-equity", "$300.00", 84, 266, 320, 86, { size: 64, bold: true, color: C.navy, typeface: "Georgia" });
  text(slide, "equity-arrow", "→", 431, 278, 120, 72, { size: 54, color: C.green, align: "center" });
  label(slide, "Ending equity", 580, 226, 250, C.green);
  text(slide, "end-equity", "$351.88", 578, 266, 360, 86, { size: 64, bold: true, color: C.green, typeface: "Georgia" });
  text(slide, "equity-return", "+17.29% modeled total return", 578, 356, 390, 40, { size: 23, bold: true, color: C.navy });
  rule(slide, 84, 430, 1110, C.navy, 1.4);
  metric(slide, "$1", "minimum order notional", 108, 468, 240, C.navy);
  metric(slide, "$0.70", "sell-day fee proxy", 466, 468, 250, C.green);
  metric(slide, "12", "sub-minimum orders skipped", 836, 468, 300, C.navy);
  text(slide, "small-account-boundary", "Sell-first fractional preview · nine-decimal truncation · one-basis-point traded-leg cost · adjusted-OHLC shadow. Tests affordability and order mechanics; not an Alpaca fill or a promise of future profit.", 108, 596, 1028, 38, { size: 14, color: C.stone, italic: true, lineSpacing: 1.1 });
  notes(slide, [
    "- Small-account shadow and execution assumptions: research/output/equity_execution_realism.json.",
    "- Exact summary and assurance boundary: public/data/submission_claims_lock.json.",
  ]);
}

// 7 — rejected G4
{
  const slide = baseSlide(7, "Finly rejected the backtest that looked best—and kept the weaker-looking production policy.", "Research discipline");
  slide.images.add({ blob: chartBytes, contentType: "image/png", alt: "Historical wealth and drawdown comparison for rejected G4 and SPY", fit: "contain", position: { left: 50, top: 206, width: 690, height: 390 } });
  label(slide, "Rejected shadow · G4", 782, 214, 330, C.red);
  text(slide, "g4-return", "18.97%", 782, 252, 250, 66, { size: 50, bold: true, color: C.green, typeface: "Georgia" });
  text(slide, "g4-return-caption", "annualized vs. SPY 15.11%", 784, 320, 330, 28, { size: 17, color: C.stone });
  const gates = [
    ["Deflated Sharpe probability", "3.75%", "FAIL"],
    ["Worst familywise p-value", "0.3718", "FAIL"],
    ["Static growth-control independence", "Unsupported", "FAIL"],
    ["Authenticated source overlap", "Not passed", "FAIL"],
  ];
  gates.forEach(([name, value, status], i) => {
    const y = 382 + i * 52;
    rule(slide, 782, y - 9, 408, C.faint, 1);
    text(slide, `g4-gate-${i}`, name, 782, y, 250, 32, { size: 16, bold: true, color: C.navy });
    text(slide, `g4-value-${i}`, value, 1038, y, 108, 32, { size: 16, color: C.ink, align: "right" });
    text(slide, `g4-status-${i}`, status, 1150, y, 40, 32, { size: 13, bold: true, color: C.red, align: "right" });
  });
  text(slide, "g4-boundary", "G4 remains a selected-after-history descriptive shadow. It is not the production policy and never received authority to trade.", 58, 616, 1120, 36, { size: 16, bold: true, color: C.red });
  notes(slide, [
    "- Locked G4 series: public/data/g4_wealth_drawdown.json.",
    "- Promotion-gate evidence: public/data/submission_claims_lock.json.",
    "- White (2000) and Bailey & López de Prado (2014) motivate the multiple-testing and deflated-Sharpe controls cited in the technical paper.",
  ]);
}

// 8 — Attempt 114
{
  const slide = baseSlide(8, "Attempt 114 turns the next profitability claim into a pre-committed test.", "Forward proof", { dark: true });
  label(slide, "Public before the first signal", 64, 210, 430, "#8EB8A7");
  text(slide, "attempt-title", "The protocol and executable runtime are already frozen.", 64, 248, 590, 112, { size: 38, bold: true, color: C.white, typeface: "Georgia", lineSpacing: 1.0 });
  text(slide, "attempt-copy", "A successful public GitHub workflow observed the exact bytes before the exclusive deadline. The rule set forbids skipped sessions, replacement windows, backfill, optional stopping, and a repeat confirmatory test.", 64, 384, 560, 142, { size: 20, color: "#CBD4D6", lineSpacing: 1.17 });
  rule(slide, 664, 206, 0, "#5E7482", 1);
  metric(slide, "17/17", "runtime-bound files matched", 704, 218, 260, C.white);
  metric(slide, "23", "fixed public GET checks", 986, 218, 230, "#8EB8A7");
  metric(slide, "254", "timely signal anchors required", 704, 354, 260, C.white);
  metric(slide, "252", "reconciled settlements required", 986, 354, 230, "#8EB8A7");
  box(slide, "attempt-gate", 704, 500, 512, 100, "#173B55", "#527087");
  text(slide, "attempt-gate-copy", "TODAY: 0 anchors · 0 settlements\nPerformance inference and broker mutation remain disabled.", 730, 524, 460, 58, { size: 20, bold: true, color: C.white, lineSpacing: 1.1 });
  text(slide, "attempt-boundary", "GitHub provides a public platform record—not an independent cryptographic timestamp, provider-origin proof, broker fill, or profitability result.", 64, 578, 560, 56, { size: 15, italic: true, color: "#9AB0B6", lineSpacing: 1.1 });
  notes(slide, [
    "- Attempt 114 publication receipt: research/prospective_attempt114/publication_receipts/a10099fa3931c9ef6d40446486744dde72f1efb5538515d03c015cd7c1a87fbb.json.",
    "- Public commit: https://github.com/owlsowo/finly-bot/commit/38a999cdf5db98f3a831d137b799ff8a48248e71",
    "- Successful workflow: https://github.com/owlsowo/finly-bot/actions/runs/33293038439",
    "- Exact safe claim and current zero-observation boundary: public/data/submission_claims_lock.json.",
  ]);
}

// 9 — close
{
  const slide = baseSlide(9, "Finly gives judges evidence they can verify—and a future claim they can falsify.", "Why Finly", { dark: true });
  const columns = [
    ["P&L evidence", "+15.39% at next-open fills and 5 bp per leg; +10.56% at 25 bp. SPY returned +33.52%."],
    ["Technology", "An implemented authority boundary keeps models away from exposure, order fields, maximum loss, and broker permission."],
    ["Originality", "Finly makes correction, rejection, and NO_TRADE observable product behavior—not a disclaimer added after the trade."],
    ["Forward proof", "Attempt 114 freezes 17 runtime files and requires 254 anchors plus 252 reconciled settlements before inference."],
  ];
  columns.forEach(([heading, copy], i) => {
    const x = 58 + i * 292;
    label(slide, heading, x, 220, 250, i === 0 ? "#D49B91" : "#8EB8A7");
    rule(slide, x, 255, 246, i === 0 ? C.red : "#5E7482", 2);
    text(slide, `criterion-${i}`, copy, x, 282, 246, 196, { size: 20, color: C.white, lineSpacing: 1.17 });
  });
  text(slide, "closing-line", "The proposition is simple: let AI interpret more, authorize less, and earn every stronger profitability claim in public.", 58, 514, 1116, 106, { size: 38, bold: true, color: C.white, typeface: "Georgia", lineSpacing: 1.0 });
  notes(slide, [
    "- Official Alpaca AI Trading Agents Hackathon judging criteria: P&L Performance, Technology Implementation, Creativity & Originality, and Presentation & Execution.",
    "- Event page: https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon",
    "- Finly claim registry: public/data/submission_claims_lock.json.",
  ]);
}

await fs.mkdir(PREVIEW, { recursive: true });
for (const [index, slide] of deck.slides.items.entries()) {
  const name = `slide-${String(index + 1).padStart(2, "0")}`;
  const png = await deck.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(PREVIEW, `${name}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(PREVIEW, `${name}.layout.json`), await layout.text());
}

const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(path.join(PREVIEW, "deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(OUT);
console.log(OUT);
