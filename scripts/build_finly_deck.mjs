import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeModules = process.env.RUNTIME_NODE_MODULES;
if (!runtimeModules) throw new Error("RUNTIME_NODE_MODULES is required to rebuild the deck");
const { FileBlob, PresentationFile } = await import(pathToFileURL(
  path.join(runtimeModules, "@oai/artifact-tool/dist/artifact_tool.mjs"),
).href);
const inputPath = path.resolve(process.argv[2] || path.join(ROOT, "public/judge/Finly_Consulting_Deck.pptx"));
const outputPath = path.resolve(process.argv[3] || path.join(ROOT, "public/judge/Finly_Consulting_Deck.pptx"));
const liveScreenshotPath = path.resolve(process.argv[4] || path.join(ROOT, "public/judge/finly-live-account.png"));
const evidenceDir = path.resolve(process.argv[5] || path.join(ROOT, "tmp/deck_build"));
const distPath = path.join(ROOT, "dist/judge/Finly_Consulting_Deck.pptx");

await fs.mkdir(evidenceDir, { recursive: true });
const presentation = await PresentationFile.importPptx(await FileBlob.load(inputPath));

async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

function setText(id, value, style) {
  const shape = presentation.resolve(id);
  shape.text = value;
  if (style) shape.text.style = style;
}

function setNotes(id, lines) {
  const notes = presentation.resolve(id);
  notes.setText(["[Sources]", ...lines.map((line) => `- ${line}`)].join("\n"));
  notes.setVisible(true);
}

for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `before-slide-${String(index + 1).padStart(2, "0")}`;
  await writeBlob(`${evidenceDir}/${stem}.png`, await presentation.export({ slide, format: "png", scale: 1 }));
  await fs.writeFile(`${evidenceDir}/${stem}.layout.json`, await (await slide.export({ format: "layout" })).text());
}
await writeBlob(`${evidenceDir}/before-montage.webp`, await presentation.export({ format: "webp", montage: true, scale: 1 }));

const footer = "FINLY  /  AI TRADING WITH BUILT-IN CHECKS";
for (const id of [
  "sh/wn6dc7eh", "sh/b29kza94", "sh/298ryl4v", "sh/rm1k7yt4", "sh/z2tcnm5s",
  "sh/87ipkzal", "sh/ydkbm5sv", "sh/ri9g7uhw", "sh/nex4jq5k",
]) setText(id, footer);

// Slide 1 — promise and immediate proof.
setText("sh/65g3298r", "AI TRADING WITH BUILT-IN RISK CHECKS", { color: "#2F7D68", bold: true });
setText("sh/ts7md4r2", "Finly shows its work before it trades.");
setText(
  "sh/fu94fe98",
  "It reads market evidence, builds a defined-risk paper trade, and lets code—not the model—decide whether the order reaches Alpaca. In our historical test, $10,000 became $106,711—$38,629 more than SPY.",
);
setText("sh/utg3698n", "Bruce Wen  |  Brandeis University  |  owlsowo.github.io/finly-bot");
setNotes("nt/y90nupkv", [
  "Historical evidence: https://owlsowo.github.io/finly-bot/data/g4_wealth_drawdown.json",
  "Sanitized live account: https://owlsowo.github.io/finly-bot/data/competition_live.json",
  "Historical simulation with modeled 5 bp one-way costs; not live performance.",
  "Finly bull-horn mark is project-owned.",
]);

// Slide 2 — outcome, scale, and trust proof.
setText("sh/u94fqp4n", "WHAT THE BACKTEST SHOWED", { color: "#2F7D68", bold: true });
setText("sh/9072xkry", "$10,000 became $106,711—$38,629 more than SPY.");
setText("sh/w3i1sfa9", "2013–2026 HISTORICAL TEST", { color: "#2F7D68", bold: true });
setText("sh/r65knqtk", "+967.11%", { color: "#2F7D68", bold: true });
setText("sh/q5wjelsz", "FINLY MODELED TOTAL RETURN");
setText("sh/9wnqhczy", "SPY total return");
setText("sh/mtwrmxg7", "+580.82%");
setText("sh/nu58f2hs", "SPY", { color: "#2F7D68", bold: true });
setText("sh/xk7qlczu", "Ending-wealth advantage");
setText("sh/ahwrqhgj", "$38,629");
setText("sh/bip8jmho", "MORE", { color: "#2F7D68", bold: true });
setText("sh/do3q9szq", "Modeled one-way costs");
setText("sh/t8byxkn2", "5 bp");
setText("sh/s72xofmh", "COST", { color: "#2F7D68", bold: true });
setText("sh/65kfmpor", "Identical test window");
setText("sh/hcvy14ne", "2013–26");
setText("sh/gbmxszmt", "13Y", { color: "#2F7D68", bold: true });
setText(
  "sh/fadgzu58",
  "Same $10,000 · same dates · 2013-01-02–2026-08-27 · 5 bp modeled one-way costs · historical test, not live account results.",
  { color: "#5F6B66" },
);
const performanceChart = presentation.resolve("ch/xob6lwfi");
performanceChart.series.getItemAt(0).name = "Modeled total return";
performanceChart.series.getItemAt(0).categories = ["Finly", "SPY"];
performanceChart.series.getItemAt(0).values = [967.11, 580.82];
setNotes("nt/hwbqtkby", [
  "Historical series: https://owlsowo.github.io/finly-bot/data/g4_wealth_drawdown.json",
  "Method and evidence labels: https://owlsowo.github.io/finly-bot/data/quantitative_release_gate.json",
  "Historical simulation; modeled 5 bp one-way costs; not broker P&L or a forecast.",
]);

// Slide 3 — before/after trust boundary.
setText("sh/v6l4jq94", "WHY WE BUILT FINLY", { color: "#2F7D68", bold: true });
setText("sh/cza94vmx", "Most trading agents let one model do too much.");
setText("sh/obq90bml", "ONE MODEL", { color: "#8F3D37", bold: true });
setText("sh/pcjqtg36", "Researches, sizes, and sends the order.");
setText("sh/m5cra54z", "If the same model reads the evidence, picks the exposure, and writes the order, one confident mistake can put capital at risk.");
setText("sh/n2l4fq98", "FINLY", { color: "#2F7D68", bold: true });
setText("sh/m1c3mlsn", "AI researches. Code controls the order.");
setText("sh/943mhgre", "AI explains the market view. Code sets position size, maximum loss, option legs, and every broker field. A final check can still stop the trade.");
setText("sh/83ulovat", "The model can explain a trade. It cannot give itself permission to place one.");
setNotes("nt/ofy9wn61", [
  "Decision trace: https://owlsowo.github.io/finly-bot/data/llama_decision_trace.json",
  "Compiled options receipt: https://owlsowo.github.io/finly-bot/data/latest_receipt.json",
]);

// Slide 4 — out-of-era stress test.
setText("sh/x8vaxsfe", "WE TESTED IT AGAIN", { color: "#2F7D68", bold: true });
setText("sh/1cj2d8b6", "We reran the same rule on 80 years of earlier industry data.");
setText("sh/sna103ap", "1927–2007 HISTORICAL TEST", { color: "#2F7D68", bold: true });
setText("sh/3ihk3et8", "13.37%", { color: "#2F7D68", bold: true });
setText("sh/ih8ju9sn", "FINLY ANNUALIZED RETURN");
setText("sh/kbm987y5", "21/21", { color: "#2F7D68", bold: true });
setText("sh/5cva1cfq", "REBALANCE ANCHORS POSITIVE");
setText("sh/i94r6xgz", "+2.45 pp", { color: "#2F7D68", bold: true });
setText("sh/jadsz2xk", "EDGE AT 25 BP COST STRESS");
setText(
  "sh/w72947yt",
  "Public Kenneth French industry data · 21,218 trading days · 5 bp base cost · market return 9.48% annualized · maximum drawdown 16.31 points shallower.",
  { color: "#5F6B66" },
);
const eraChart = presentation.resolve("ch/upg3qlw3");
eraChart.series.getItemAt(0).name = "Finly";
eraChart.series.getItemAt(0).categories = ["Annualized return"];
eraChart.series.getItemAt(0).values = [13.37];
eraChart.series.getItemAt(1).name = "Market";
eraChart.series.getItemAt(1).categories = ["Annualized return"];
eraChart.series.getItemAt(1).values = [9.48];
setNotes("nt/jyx0ra1s", [
  "Source-backed replay: https://owlsowo.github.io/finly-bot/data/attempt150_public_evidence.json",
  "Official data source: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/10_Industry_Portfolios_daily_CSV.zip",
  "Industry-proxy historical stress test; separate from live broker performance.",
]);

// Slide 5 — the one-workflow demo.
setText("sh/qp4jm98v", "HERE'S HOW IT WORKS", { color: "#2F7D68", bold: true });
setText("sh/dgbulwnm", "A Finly trade goes through six steps before it reaches Alpaca.");
const workflow = [
  ["sh/l4bupwny", "DATA"], ["sh/n6dcr65o", "Read"], ["sh/w32dkbuh", "Timestamped market signals"],
  ["sh/ahkvi1cb", "AI"], ["sh/k7mxovud", "Explain"], ["sh/i54fmlc7", "Compare signals + state a view"],
  ["sh/sb6xsvu9", "CODE"], ["sh/hgrmpwj2", "Size"], ["sh/fe94nm1w", "Fix exposure + risk budget"],
  ["sh/pkr6tgjy", "CODE"], ["sh/3i94r61s", "Build"], ["sh/5o7mhcju", "Define legs + broker fields"],
  ["sh/atcjidg7", "TEST"], ["sh/wve1knyx", "Stress test"], ["sh/ihw3mxg3", "Remove sources + change inputs"],
  ["sh/kjelony9", "PERMIT"], ["sh/e1sjatgz", "Send or stop"], ["sh/fid07u98", "PAPER ORDER / NO TRADE"],
];
for (const [id, value] of workflow) setText(id, value);
setText("sh/1kvi94re", "AI", { color: "#2F7D68", bold: true });
setText("sh/gjmhgzqt", "READS + EXPLAINS");
setText("sh/3md0bu94", "CODE", { color: "#2F7D68", bold: true });
setText("sh/2l4zip8j", "SIZES + CONSTRUCTS");
setText("sh/povid4ra", "CODE", { color: "#2F7D68", bold: true });
setText("sh/onmhkzqp", "ISSUES THE PERMIT");
setText("sh/bqx0fe9g", "The model never writes the order.");
setNotes("nt/i107q5of", [
  "Model trace: https://owlsowo.github.io/finly-bot/data/llama_decision_trace.json",
  "Positive checked receipt: https://owlsowo.github.io/finly-bot/data/latest_receipt.json",
  "Conflict receipt: https://owlsowo.github.io/finly-bot/data/no_trade_receipt.json",
]);

// Slide 6 — authenticated paper-account proof.
setText("sh/j6dcr65c", "WATCH IT RUN", { color: "#2F7D68", bold: true });
setText("sh/yhg7epsj", "You can watch the $100,000 Alpaca paper account live.");
setText("sh/oryp8fah", "WHAT JUDGES CAN SEE", { color: "#2F7D68", bold: true });
setText("sh/pc76hkr2", "VERIFIED", { color: "#2F7D68", bold: true });
setText("sh/h4bupgn6", "ALPACA PAPER ACCOUNT");
setText("sh/w32twb6l", "$100,000", { color: "#2F7D68", bold: true });
setText("sh/v2tcn650", "STARTING EQUITY");
setText("sh/u1kbu1ov", "$500", { color: "#2F7D68", bold: true });
setText("sh/5svutgni", "PER-TRADE RISK CEILING");
setText("sh/47mt0b6x", "The dashboard shows equity, positions, risk, and the latest decision. It never publishes credentials or private account identifiers.");
const screenshot = presentation.resolve("im/lw3uh4be");
const screenshotBytes = await fs.readFile(liveScreenshotPath);
const screenshotFrame = screenshot.frame;
const screenshotCrop = screenshot.crop;
const screenshotFit = screenshot.fit;
const screenshotGeometry = screenshot.geometry;
const screenshotRadius = screenshot.borderRadius;
const screenshotRotation = screenshot.rotation;
const screenshotFlipH = screenshot.flipHorizontal;
const screenshotFlipV = screenshot.flipVertical;
const screenshotAspect = screenshot.lockAspectRatio;
screenshot.replace({
  blob: screenshotBytes.buffer.slice(screenshotBytes.byteOffset, screenshotBytes.byteOffset + screenshotBytes.byteLength),
  contentType: "image/png",
  alt: "Finly public dashboard showing the verified one-hundred-thousand-dollar Alpaca paper account",
  ...(screenshotFit ? { fit: screenshotFit } : {}),
});
screenshot.frame = screenshotFrame;
screenshot.crop = screenshotCrop;
screenshot.geometry = screenshotGeometry;
screenshot.borderRadius = screenshotRadius;
screenshot.rotation = screenshotRotation;
screenshot.flipHorizontal = screenshotFlipH;
screenshot.flipVertical = screenshotFlipV;
screenshot.lockAspectRatio = screenshotAspect;
setNotes("nt/x8f69ofe", [
  "Sanitized live account: https://owlsowo.github.io/finly-bot/data/competition_live.json",
  "Public dashboard: https://owlsowo.github.io/finly-bot/#live",
  "Screenshot is project-owned and records paper-account state, not a live-return claim.",
]);

// Slide 7 — options decision receipt.
setText("sh/id4ju1oz", "SEE THE RISK FIRST", { color: "#2F7D68", bold: true });
setText("sh/cb2tkvap", "Before Finly sends an order, it shows the exact downside.");
setText("sh/kzmdova1", "MAXIMUM LOSS", { color: "#2F7D68", bold: true });
setText("sh/l0vuh0rm", "$366", { color: "#17324D", bold: true });
setText("sh/eh0ba1sr", "VS");
setText("sh/fi9c369c", "MAXIMUM GAIN", { color: "#2F7D68", bold: true });
setText("sh/baxkjqlk", "$634", { color: "#17324D", bold: true });
setText("sh/a9ojq5kz", "One-contract SPY debit vertical");
setText("sh/cbq1sv25", "4/4", { color: "#2F7D68", bold: true });
setText("sh/n6x0fqlo", "SOURCE REMOVALS PASSED");
setText("sh/25ojml43", "32/32", { color: "#2F7D68", bold: true });
setText("sh/p8fih03e", "PERTURBATIONS PASSED");
setText("sh/o761ov2t", "EXACT", { color: "#2F7D68", bold: true });
setText("sh/f2d0b6lc", "ALPACA-COMPATIBLE FIELDS");
setText("sh/eh4jil4r", "If the evidence or the numbers change, Finly stops the trade.");
setNotes("nt/gnmp4jqx", [
  "Positive options receipt: https://owlsowo.github.io/finly-bot/data/latest_receipt.json",
  "Conflict receipt: https://owlsowo.github.io/finly-bot/data/no_trade_receipt.json",
  "The checked options fixture is synthetic paper-trading evidence, not realized options P&L.",
]);

// Slide 8 — differentiation and implementation proof.
setText("sh/svydgb65", "WE BUILT THE CHECKS IN", { color: "#2F7D68", bold: true });
setText("sh/18byd4zy", "Every Finly decision comes with a receipt.");
setText("sh/tkby9kzm", "WHAT'S IN THE RECEIPT", { color: "#2F7D68", bold: true });
setText("sh/sjix0zy1", "The evidence, the trade, the risk, and the result.");
setText("sh/je9g3ahk", "A judge can see what the AI concluded, what code built, what changed during testing, and what happened next. The receipt links back to the data and code behind it.");
setText("sh/o7ydoret", "VIEW", { color: "#2F7D68", bold: true });
setText("sh/98rehwve", "WHAT THE AI CONCLUDED");
setText("sh/m5gvmhwn", "ORDER", { color: "#2F7D68", bold: true });
setText("sh/n6pwfmd8", "WHAT CODE BUILT");
setText("sh/0jydkreh", "TESTS", { color: "#2F7D68", bold: true });
setText("sh/1k7edwv2", "WHAT CHANGED UNDER STRESS");
setText("sh/ehgvihwr", "LOG", { color: "#2F7D68", bold: true });
setText("sh/zipwbmdc", "WHAT HAPPENED NEXT");
setText("sh/lgbepgvm", "803 TESTS DISCOVERED · 801 PASSED · 0 FAILED\nCloud run · exact revision · Alpaca paper account");
setText("sh/tw7e9gnq", "Open the receipt or run the tests yourself.");
setNotes("nt/fu1gfa1s", [
  "Cloud runner documentation: https://github.com/owlsowo/finly-bot/blob/main/docs/CLOUD_RUNNER.md",
  "Public repository and automated tests: https://github.com/owlsowo/finly-bot",
  "Verified test run: https://github.com/owlsowo/finly-bot/actions/runs/33369848292",
  "Sanitized account record: https://owlsowo.github.io/finly-bot/data/competition_live.json",
]);

// Slide 9 — judge takeaway and CTA.
setText("sh/lsn2h4fa", "TRY FINLY", { color: "#2F7D68", bold: true });
setText("sh/1cfmhgne", "Watch it trade. Check the numbers. Read the code.");
setText("sh/9gzml0nq", "BACKTEST", { color: "#2F7D68", bold: true });
setText("sh/bih4na5w", "Historical simulation: $10,000 became $106,711—$38,629 more than SPY after modeled costs.");
setText("sh/ah8nu54b", "STRESS TEST", { color: "#2F7D68", bold: true });
setText("sh/p0ji9kf2", "The out-of-era stress test stayed ahead across 21/21 timing anchors and a 25 bp cost assumption.");
setText("sh/2xsjepgb", "TRADE CHECKS", { color: "#2F7D68", bold: true });
setText("sh/cnu1kzyd", "$366 maximum loss, $634 maximum gain, 4/4 source removals, and 32/32 input shocks.");
setText("sh/do3id4fy", "LIVE ACCOUNT", { color: "#2F7D68", bold: true });
setText("sh/bml0buxs", "A verified $100,000 Alpaca paper account makes every new decision visible and inspectable.");
setText("sh/0ru1ozyp", "AI reads the market. Code guards the account.\nowlsowo.github.io/finly-bot");
setNotes("nt/udsvah03", [
  "Live product: https://owlsowo.github.io/finly-bot/",
  "Repository: https://github.com/owlsowo/finly-bot",
  "Contact: mailto:bwen412@brandeis.edu",
  "Historical metrics are simulations with modeled costs; live paper-account results are labeled separately.",
]);

for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `after-slide-${String(index + 1).padStart(2, "0")}`;
  await writeBlob(`${evidenceDir}/${stem}.png`, await presentation.export({ slide, format: "png", scale: 1 }));
  await fs.writeFile(`${evidenceDir}/${stem}.layout.json`, await (await slide.export({ format: "layout" })).text());
}
await writeBlob(`${evidenceDir}/after-montage.webp`, await presentation.export({ format: "webp", montage: true, scale: 1 }));

const snapshot = await presentation.inspect({
  kind: "slide,textbox,shape,image,chart,notes,layout",
  include: "id,slide,name,title,text,textPreview,bbox,chartType,alt",
  maxChars: 100000,
});
await fs.writeFile(`${evidenceDir}/after-inspect.ndjson`, snapshot.ndjson);

const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(outputPath);
await fs.mkdir(path.dirname(distPath), { recursive: true });
if (outputPath !== distPath) await fs.copyFile(outputPath, distPath);
console.log(outputPath);
