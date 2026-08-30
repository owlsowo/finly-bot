import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/judge/Finly_Consulting_Deck.pptx");
const DIST = path.join(ROOT, "dist/judge/Finly_Consulting_Deck.pptx");
const PREVIEW = path.join(ROOT, "tmp/deck_video_final/final-preview");
const GATE_PATH = path.join(ROOT, "research/output/quantitative_release_gate.json");
const SOURCE = path.resolve(process.env.FINLY_DECK_SOURCE || path.join(ROOT, "tmp/deck_video_final/template-starter.pptx"));
const COMMIT = "c953d74444bd0cee1bc884701d98ff510cc4db80";
const REPO = `https://github.com/owlsowo/finly-bot/blob/${COMMIT}`;

function close(actual, expected, label) {
  if (Math.abs(Number(actual) - expected) > 1e-10) {
    throw new Error(`Quantitative release gate changed: ${label}`);
  }
}

async function loadGate() {
  const gate = JSON.parse(await fs.readFile(GATE_PATH, "utf8"));
  if (gate.artifact_sha256 !== "sha256:1550d4fa7956138074dd08b98b8836811e6bd9adfd635e1378598efd81d0d5f1") {
    throw new Error("Quantitative release gate hash changed");
  }
  if (gate.release_decision?.status !== "GO_BOUNDED_RELEASE_NO_GO_PERFORMANCE_MATCHUP") {
    throw new Error("Quantitative release decision changed");
  }
  const g4 = gate.conclusions.g4_rejected_post_selection;
  close(g4.g4_total_return, 9.6710597833, "G4 total return");
  close(g4.spy_total_return, 5.8081746189, "G4 SPY total return");
  close(g4.deflated_sharpe_probability, 0.037478432287, "G4 DSR probability");
  close(g4.worst_familywise_adjusted_p_value, 0.371814092954, "G4 familywise p-value");
  if (g4.disposition !== "REJECTED_NOT_PROMOTED") throw new Error("G4 disposition changed");
  const v1 = gate.conclusions.production_v1_execution_realism;
  close(v1.total_return_at_5bp_per_leg, 0.1538759778, "v1 5 bp return");
  close(v1.total_return_at_25bp_per_leg, 0.1055891073, "v1 25 bp return");
  close(v1.spy_total_return, 0.3352366407, "v1 SPY return");
  close(v1.annualized_volatility_at_5bp, 0.0812194739, "v1 volatility");
  close(v1.maximum_drawdown_at_5bp, -0.0544710489, "v1 drawdown");
  if (v1.market_beating_on_total_return !== false || v1.broker_fill_replay !== false) {
    throw new Error("Production-v1 claim boundary changed");
  }
  const future = gate.conclusions.registered_future_only_tests;
  if (future.length !== 2 || future.some((item) => item.observed_outcome_count !== 0 || item.performance_claim_authorized !== false)) {
    throw new Error("Future-only attempt boundary changed");
  }
  if (future.map((item) => item.attempt_number).join(",") !== "115,116") {
    throw new Error("Future-only attempt identities changed");
  }
  return gate;
}

const gate = await loadGate();
const deck = await PresentationFile.importPptx(await FileBlob.load(SOURCE));
if (deck.slides.items.length !== 9) throw new Error("Expected the nine-slide Finly starter deck");

async function records() {
  const snapshot = await deck.inspect({
    kind: "slide,textbox,shape,image,chart,notes,layout",
    include: "id,slide,name,title,text,textPreview,bbox,chartType,alt",
    maxChars: 200000,
  });
  return snapshot.ndjson.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

let inventory = await records();

function findRecord(slideNumber, name) {
  const record = inventory.find((item) => item.slide === slideNumber && item.name === name);
  if (!record) throw new Error(`Missing inherited element on slide ${slideNumber}: ${name}`);
  return record;
}

function setText(slideNumber, name, value) {
  const record = findRecord(slideNumber, name);
  const target = deck.resolve(record.id);
  if (typeof record.text === "string" && record.text.length > 0 && !record.text.includes("\n")) target.text.replace(record.text, value);
  else target.text = value;
}

function setPage(slideNumber, sourcePageName) {
  setText(slideNumber, sourcePageName, String(slideNumber).padStart(2, "0"));
}

function setNotes(slideNumber, lines) {
  deck.slides.getItem(slideNumber - 1).speakerNotes.textFrame.setText(["[Sources]", ...lines]);
}

// 1 - Opening tension. The title remains deliberately spare.
setText(1, "label-Execution-realistic controlled delegation-62-169", "CONTROLLED-DELEGATION TRADING RESEARCH");
setText(1, "title", "We found +967.11% - and refused to trade it.");
setText(1, "subtitle", "In the consumed, post-selected 2013-01-02–2026-08-27 replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%. Finly rejected it because the statistical evidence did not earn authority.");
setText(1, "author", "Bruce Wen | Brandeis University | Alpaca AI Trading Agents Hackathon");
setPage(1, "page-1");
setNotes(1, [
  `- Quantitative release gate: ${REPO}/research/output/quantitative_release_gate.json`,
  "- G4 was rejected and not promoted; the retrospective result is not a forecast or validation claim.",
  "- Finly bull-horn mark is project-owned.",
]);

// 2 - Replace the inherited wealth image with a native, gate-safe return comparison.
setText(2, "label-Research discipline-58-32", "THE TEMPTING RESULT");
setText(2, "slide-title-7", "The strongest retrospective return was the easiest claim to overtrust.");
setText(2, "label-Rejected shadow · G4-782-214", "CONSUMED RETROSPECTIVE");
setText(2, "g4-return", "+967.11%");
setText(2, "g4-return-caption", "G4 MODELED TOTAL RETURN");
setText(2, "g4-gate-0", "SPY total return");
setText(2, "g4-value-0", "+580.82%");
setText(2, "g4-status-0", "HIST");
setText(2, "g4-gate-1", "Deflated Sharpe probability");
setText(2, "g4-value-1", "3.75%");
setText(2, "g4-status-1", "FAIL");
setText(2, "g4-gate-2", "Worst familywise p-value");
setText(2, "g4-value-2", "37.18%");
setText(2, "g4-status-2", "FAIL");
setText(2, "g4-gate-3", "Promotion decision");
setText(2, "g4-value-3", "REJECTED");
setText(2, "g4-status-3", "NO");
setText(2, "g4-boundary", "Consumed 2013-01-02–2026-08-27 | post-selected replay | modeled 5 bp one-way costs | rejected and not promoted.");
const oldG4ImageRecord = inventory.find((item) => item.slide === 2 && item.kind === "image");
if (!oldG4ImageRecord) throw new Error("Missing inherited G4 chart image");
deck.resolve(oldG4ImageRecord.id).delete();
deck.slides.getItem(1).charts.add("bar", {
  position: { left: 83, top: 206, width: 624, height: 390 },
  categories: ["G4", "SPY"],
  series: [{
    name: "Modeled total return",
    values: [967.11, 580.82],
    fill: "#2f7562",
    points: [
      { idx: 0, fill: "#2f7562" },
      { idx: 1, fill: "#17334d" },
    ],
    valuesFormatCode: "0.00\"%\"",
  }],
  barOptions: { direction: "bar", grouping: "clustered", varyColors: true, gapWidth: 54 },
  hasLegend: false,
  chartFill: "#f6f1e8",
  chartLine: { style: "solid", fill: "#f6f1e8", width: 0 },
  plotAreaFill: { type: "none" },
  plotAreaLine: { style: "solid", fill: "#f6f1e8", width: 0 },
  xAxis: {
    visible: true,
    minimumScale: 0,
    maximumScale: 1100,
    numberFormatCode: "0\"%\"",
    textStyle: { fill: "#69737a", fontSize: 11 },
    line: { style: "solid", fill: "#c8c4bb", width: 1 },
    majorGridlines: { style: "solid", fill: "#ddd8cf", width: 1 },
  },
  yAxis: {
    textStyle: { fill: "#17334d", fontSize: 15, bold: true },
    line: { style: "solid", fill: "#c8c4bb", width: 1 },
    majorGridlines: null,
  },
  dataLabels: {
    showValue: true,
    position: "outEnd",
    textStyle: { fill: "#17334d", fontSize: 15, bold: true },
  },
});
setPage(2, "page-7");
setNotes(2, [
  `- Locked release decision and G4 statistics: ${REPO}/research/output/quantitative_release_gate.json`,
  "- Consumed, post-selected ETF replay with modeled 5 bp one-way costs; not options P&L, validation, promotion, or a forecast.",
]);

// 3 - Explain why the attractive result did not survive adjudication.
setText(3, "label-The design problem-58-32", "THE EVIDENTIARY VERDICT");
setText(3, "slide-title-2", "The return survived the replay; the claim did not survive the test.");
setText(3, "label-Typical agent-74-215", "WHAT THE REPLAY SAID");
setText(3, "judgment-question", "The chart looked exceptional.");
setText(3, "judgment-copy", "In the consumed 2013-01-02–2026-08-27 replay, G4 returned +967.11% versus SPY +580.82% after modeled 5 bp one-way costs.");
setText(3, "label-Finly-654-215", "WHAT THE TESTS SAID");
setText(3, "authority-question", "The evidence was not promotable.");
setText(3, "authority-copy", "G4 was selected after history was visible. Its Deflated Sharpe probability was 3.75%, while the worst familywise-adjusted p-value was 37.18%.");
setText(3, "core-thesis", "Finly kept the result visible, labeled its evidence class, and denied it authority.");
setPage(3, "page-2");
setNotes(3, [
  `- Promotion decision, Deflated Sharpe probability, and familywise p-value: ${REPO}/research/output/quantitative_release_gate.json`,
  "- G4 is rejected, not promoted, and cannot support future profitability or market-superiority claims.",
]);

// 4 - Rebuild the inherited chart with only the claims authorized by the release gate.
setText(4, "label-Execution realism-58-32", "PRODUCTION V1");
setText(4, "slide-title-5", "The frozen policy was positive, risk-controlled — and did not beat SPY on return.");
setText(4, "label-What survived-872-216", "MODELED NEXT-OPEN STUDY");
setText(4, "metric-next-open · 5 bp per leg", "15.39%");
setText(4, "metric-caption-next-open · 5 bp per leg", "POSITIVE TOTAL RETURN - 5 BP PER LEG");
setText(4, "metric-maximum drawdown", "8.12%");
setText(4, "metric-caption-maximum drawdown", "ANNUALIZED VOLATILITY");
setText(4, "metric-at 25 bp per leg", "-5.45%");
setText(4, "metric-caption-at 25 bp per leg", "MAXIMUM DRAWDOWN - 5 BP");
setText(4, "execution-boundary", "Consumed 2025-01-02 to 2026-08-28 | 415 sessions | modeled next-open adjusted-OHLC ledger. Finly returned +10.56% at 25 bp per traded leg; SPY returned +33.52%.");
const oldChartRecord = inventory.find((item) => item.slide === 4 && item.kind === "chart");
if (!oldChartRecord) throw new Error("Missing inherited production chart");
const oldChart = deck.resolve(oldChartRecord.id);
oldChart.categories = ["5 bp", "25 bp"];
oldChart.series.getItemAt(0).categories = ["5 bp", "25 bp"];
oldChart.series.getItemAt(0).values = [15.39, 10.56];
oldChart.series.getItemAt(1).categories = ["5 bp", "25 bp"];
oldChart.series.getItemAt(1).values = [33.52, 33.52];
setPage(4, "page-5");
setNotes(4, [
  `- Production-v1 release claim: ${REPO}/research/output/quantitative_release_gate.json`,
  `- Modeled next-open execution-realism ledger: ${REPO}/research/output/equity_execution_realism.json`,
  "- This is consumed retrospective execution-mechanics evidence, not broker fills, options P&L, alpha, or a forecast.",
]);

// 5 - Preserve the six-stage authority sequence while simplifying the proof rail.
setText(5, "label-Controlled delegation-58-32", "CONTROLLED DELEGATION");
setText(5, "slide-title-4", "The model may interpret evidence; only deterministic code may authorize capital.");
for (let index = 1; index <= 5; index += 1) setText(5, `chevron-${index}`, ">");
setText(5, "metric-exact max loss in checked fixture", "MODEL");
setText(5, "metric-caption-exact max loss in checked fixture", "INTERPRETS EVIDENCE");
setText(5, "metric-source-removal challenges", "CODE");
setText(5, "metric-caption-source-removal challenges", "OWNS EXPOSURE AND ORDER FIELDS");
setText(5, "metric-perturbation challenges", "GATE");
setText(5, "metric-caption-perturbation challenges", "PERMIT OR NO_TRADE");
setText(5, "authority-close", "A disagreement cannot become an Alpaca payload.");
setPage(5, "page-4");
setNotes(5, [
  `- Project-owned authority trace: ${REPO}/public/data/llama_decision_trace.json`,
  `- Project-owned compiled-decision record: ${REPO}/public/data/latest_receipt.json`,
  "- The cited fixtures are synthetic research evidence; no broker mutation is authorized.",
]);

// 6 - Keep the inherited product capture and let the evidence rail carry the claim boundary.
setText(6, "label-The product-58-32", "THE INSPECTABLE PRODUCT");
setText(6, "slide-title-3", "Every headline number arrives with the reason it cannot yet control capital.");
setText(6, "label-Visible on the site-904-214", "VISIBLE TO JUDGES");
setText(6, "metric-next-open · 5 bp per leg", "15.39%");
setText(6, "metric-caption-next-open · 5 bp per leg", "POSITIVE V1 MODELED RETURN - 5 BP");
setText(6, "metric-consumed sessions", "REJECTED");
setText(6, "metric-caption-consumed sessions", "G4 PROMOTION DECISION");
setText(6, "metric-at 25 bp per leg", "0 + 0");
setText(6, "metric-caption-at 25 bp per leg", "OUTCOMES - ATTEMPTS 115 / 116");
setText(6, "product-boundary", "The interface keeps a modeled return, a rejected strategy, and two zero-outcome future tests in different evidence classes.");
const productImageRecord = inventory.find((item) => item.slide === 6 && item.kind === "image");
if (!productImageRecord) throw new Error("Missing inherited product screenshot");
const productImage = deck.resolve(productImageRecord.id);
const productFrame = productImage.frame;
const productGeometry = productImage.geometry;
const productBorderRadius = productImage.borderRadius;
productImage.replace({
  blob: await fs.readFile(path.join(ROOT, "public/judge/finly-product-home.png")),
  contentType: "image/png",
  alt: "Finly product home showing the rejected G4 retrospective result and promotion boundary",
  fit: "cover",
});
productImage.frame = productFrame;
productImage.crop = { left: 0, top: 0, right: 0, bottom: 0 };
productImage.geometry = productGeometry;
productImage.borderRadius = productBorderRadius;
setPage(6, "page-3");
setNotes(6, [
  `- Quantitative release gate behind the visible evidence classes: ${REPO}/research/output/quantitative_release_gate.json`,
  "- Product capture is a project-owned screenshot; it is evidence of the interface, not market performance.",
]);

// 7 - Convert the small-account page into a proof ladder without changing its inherited silhouette.
setText(7, "label-Small-account feasibility-58-32", "THE PROOF LADDER");
setText(7, "slide-title-6", "Finly's evidence gets harder - not louder - as a claim approaches capital.");
setText(7, "label-Starting equity-86-226", "EVIDENCE WE HAVE");
setText(7, "start-equity", "PAST");
setText(7, "equity-arrow", "TO");
setText(7, "label-Ending equity-580-226", "EVIDENCE WE NEED");
setText(7, "end-equity", "FUTURE");
setText(7, "equity-return", "0 observed outcomes today");
setText(7, "metric-minimum order notional", "G4");
setText(7, "metric-caption-minimum order notional", "REJECTED AFTER SELECTION");
setText(7, "metric-sell-day fee proxy", "V1");
setText(7, "metric-caption-sell-day fee proxy", "MODELED NEXT-OPEN LEDGER");
setText(7, "metric-sub-minimum orders skipped", "115 / 116");
setText(7, "metric-caption-sub-minimum orders skipped", "REGISTERED FUTURE-ONLY TESTS");
setText(7, "small-account-boundary", "A larger backtest never upgrades its own evidence class. Only a new test can.");
setPage(7, "page-6");
setNotes(7, [`- Evidence classes, retrospective limitations, and future-only status: ${REPO}/research/output/quantitative_release_gate.json`]);

// 8 - Replace the inherited forward-proof copy with the two current registered tests.
setText(8, "label-Forward proof-58-32", "FORWARD PROOF");
setText(8, "slide-title-8", "Attempts 115 and 116 begin with zero outcomes - not borrowed confidence.");
setText(8, "label-Public before the first signal-64-210", "PUBLICLY REGISTERED");
setText(8, "attempt-title", "Two tests ask two different questions.");
setText(8, "attempt-copy", "Attempt 115 freezes a downside-semivolatility challenger. Attempt 116 freezes a variance-risk-premium shadow. Each has zero observed outcomes. Neither supports a performance claim.");
setText(8, "metric-runtime-bound files matched", "115");
setText(8, "metric-caption-runtime-bound files matched", "DOWNSIDE-SEMIVOLATILITY TEST");
setText(8, "metric-fixed public GET checks", "116");
setText(8, "metric-caption-fixed public GET checks", "VARIANCE-RISK-PREMIUM SHADOW");
setText(8, "metric-timely signal anchors required", "0");
setText(8, "metric-caption-timely signal anchors required", "OBSERVED OUTCOMES - ATTEMPT 115");
setText(8, "metric-reconciled settlements required", "0");
setText(8, "metric-caption-reconciled settlements required", "OBSERVED OUTCOMES - ATTEMPT 116");
setText(8, "attempt-gate-copy", "AS OF 2026-08-30 08:10:52Z: 0 + 0 outcomes\nNo performance claim and no broker mutation authority.");
setText(8, "attempt-boundary", "GitHub records the registrations; it does not create outcome evidence, provider-origin proof, a broker fill, or future profitability.");
setPage(8, "page-8");
setNotes(8, [
  `- Attempt 115 protocol: ${REPO}/research/downside_semivolatility_challenger_protocol.json`,
  `- Attempt 115 public receipt: ${REPO}/research/prospective_attempt115/publication_receipts/4dd7720d25198702013ab10e582b37004515bed5e4466a56eca89192559d2cd9.json`,
  `- Attempt 116 protocol: ${REPO}/research/prospective_attempt116/protocol.json`,
  `- Attempt 116 public receipt: ${REPO}/research/prospective_attempt116/publication_receipts/934e52a583893e2720a0962195efd56b5f4b2a0554a1b8f8dfa9ab5951191362.json`,
  `- Zero-outcome boundary as of ${gate.evidence_as_of}: ${REPO}/research/output/quantitative_release_gate.json`,
]);

// 9 - Resolve the opening tension without claiming a cross-project comparison or a forecast.
setText(9, "label-Why Finly-58-32", "THE JUDGE TAKEAWAY");
setText(9, "slide-title-9", "Finly makes correction, rejection, and NO_TRADE part of the product.");
setText(9, "label-P&L evidence-58-220", "HISTORICAL SIGNAL");
setText(9, "criterion-0", "G4 returned +967.11% versus SPY +580.82%; Finly rejected it after the DSR and multiplicity tests.");
setText(9, "label-Technology-350-220", "PRODUCTION TRUTH");
setText(9, "criterion-1", "V1 returned +15.39% at 5 bp with 8.12% volatility and -5.45% drawdown; SPY returned +33.52%.");
setText(9, "label-Originality-642-220", "AUTHORITY DESIGN");
setText(9, "criterion-2", "The model interprets evidence. Code owns exposure, order fields, and the final permit decision.");
setText(9, "label-Forward proof-934-220", "NEXT EVIDENCE");
setText(9, "criterion-3", "Attempts 115 and 116 are registered future-only tests with zero outcomes and no performance claim.");
setText(9, "closing-line", "Publish the tempting result. Reject what has not earned authority. Make the next claim falsifiable.");
setPage(9, "page-9");
setNotes(9, [
  `- All quantitative statements and limitations: ${REPO}/research/output/quantitative_release_gate.json`,
  "- No cross-project performance comparison, future-profit claim, verified options P&L, or broker fill is asserted.",
]);

await fs.rm(PREVIEW, { recursive: true, force: true });
await fs.mkdir(PREVIEW, { recursive: true });
for (const [index, slide] of deck.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  const png = await deck.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(PREVIEW, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(PREVIEW, `${stem}.layout.json`), await layout.text());
}
const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(path.join(PREVIEW, "deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));

inventory = await records();
await fs.writeFile(path.join(PREVIEW, "final-inspect.ndjson"), `${inventory.map((record) => JSON.stringify(record)).join("\n")}\n`);

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.mkdir(path.dirname(DIST), { recursive: true });
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(OUT);
execFileSync("python3", [path.join(ROOT, "scripts/sanitize_presentation_metadata.py"), OUT], {
  stdio: "inherit",
});
await fs.copyFile(OUT, DIST);
await Promise.all([
  fs.rm(`${OUT}.inspect.ndjson`, { force: true }),
  fs.rm(`${DIST}.inspect.ndjson`, { force: true }),
]);
console.log(JSON.stringify({ output: OUT, mirror: DIST, slides: deck.slides.items.length, gate: gate.artifact_sha256 }, null, 2));
