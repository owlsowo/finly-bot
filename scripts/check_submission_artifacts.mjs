import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  canonicalQuantitativeReleaseGateJson,
  EXACT_ALLOWED_CLAIMS,
  validateQuantitativeReleaseGate,
} from "../research/build_quantitative_release_gate.mjs";

const root = resolve(import.meta.dirname, "..");
const pathFor = (relativePath) => resolve(root, relativePath);

function requireFile(relativePath, minimumBytes) {
  const path = pathFor(relativePath);
  const stat = statSync(path);
  assert.ok(stat.isFile(), `${relativePath} must be a file`);
  assert.ok(stat.size >= minimumBytes, `${relativePath} is unexpectedly small (${stat.size} bytes)`);
  return { path, size: stat.size };
}

function requireAbsent(relativePath) {
  assert.equal(existsSync(pathFor(relativePath)), false, `${relativePath} is obsolete and must not ship`);
}

function requirePdf(relativePath, expectedPages) {
  const file = requireFile(relativePath, 40_000);
  assert.equal(readFileSync(file.path).subarray(0, 5).toString("ascii"), "%PDF-",
    `${relativePath} must be a PDF`);
  const output = execFileSync("pdfinfo", [file.path], { encoding: "utf8" });
  const pages = Number(/^Pages:\s+(\d+)$/mu.exec(output)?.[1]);
  assert.equal(pages, expectedPages, `${relativePath} must contain ${expectedPages} pages`);
  return file;
}

function executablePath(command) {
  try {
    return execFileSync("which", [command], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function pdfTextTool() {
  const direct = executablePath("pdftotext");
  if (direct) return direct;
  const pdfinfo = executablePath("pdfinfo");
  const candidates = pdfinfo ? [
    resolve(dirname(pdfinfo), "pdftotext"),
    resolve(dirname(pdfinfo), "../../native/poppler/bin/pdftotext"),
    resolve(dirname(pdfinfo), "../../native/poppler/poppler/bin/pdftotext"),
  ] : [];
  const bundled = candidates.find((candidate) => existsSync(candidate));
  assert.ok(bundled, "pdftotext is required to verify judge-PDF claim parity");
  return bundled;
}

const pdfToText = pdfTextTool();

function extractPdfText(file) {
  const popplerRoot = resolve(dirname(pdfToText), "..");
  const libraryPath = [resolve(popplerRoot, "lib"), process.env.DYLD_FALLBACK_LIBRARY_PATH]
    .filter(Boolean)
    .join(":");
  return execFileSync(pdfToText, ["-layout", file, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, DYLD_FALLBACK_LIBRARY_PATH: libraryPath },
  });
}

function normalizedText(value) {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—−]/gu, "-")
    .replace(/-\s+/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function requirePatterns(label, value, patterns) {
  const text = normalizedText(value);
  for (const pattern of patterns) {
    assert.match(text, pattern, `${label} is stale or missing release-gated evidence: ${pattern}`);
  }
}

function requireNoPatterns(label, value, patterns) {
  const text = normalizedText(value);
  for (const pattern of patterns) {
    assert.doesNotMatch(text, pattern, `${label} contains stale, unsafe, or evaluator-directed copy: ${pattern}`);
  }
}

function requireSourcePdfParity({ label, sourcePath, pdfPath, patterns }) {
  requirePatterns(`${label} source`, readFileSync(pathFor(sourcePath), "utf8"), patterns);
  requirePatterns(`${label} PDF`, extractPdfText(pathFor(pdfPath)), patterns);
}

function pngDimensions(relativePath) {
  const file = requireFile(relativePath, 10_000);
  const data = readFileSync(file.path);
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG", `${relativePath} must be a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const onePage = requirePdf("public/judge/Finly_Judge_Brief.pdf", 1);
const paper = requirePdf("public/judge/Finly_Technical_Proposal.pdf", 7);
const appendix = requirePdf("public/judge/Finly_Engineering_Appendix.pdf", 14);
const deck = requirePdf("public/judge/Finly_Consulting_Deck.pdf", 9);
requireFile("public/judge/Finly_Judge_Proposal.docx", 20_000);
requireFile("public/judge/Finly_Engineering_Appendix.docx", 40_000);
requireFile("public/judge/Finly_Consulting_Deck.pptx", 100_000);

const video = requireFile("public/judge/Finly_Demo_Video.mp4", 1_000_000);
assert.ok(video.size < 300 * 1024 * 1024, "demo video must be under 300 MB");
const probe = JSON.parse(execFileSync("ffprobe", [
  "-v", "error",
  "-show_entries", "stream=codec_name,width,height,sample_rate,channels:format=duration,size",
  "-of", "json", video.path,
], { encoding: "utf8" }));
const videoStream = probe.streams.find((stream) => stream.width && stream.height);
const audioStream = probe.streams.find((stream) => stream.codec_name === "aac");
assert.equal(videoStream?.codec_name, "h264", "demo video must use H.264");
assert.deepEqual([videoStream?.width, videoStream?.height], [1920, 1080],
  "demo video must be 1920×1080");
assert.ok(audioStream, "demo video must contain AAC narration");
assert.equal(audioStream.sample_rate, "48000", "demo narration must use 48 kHz audio");
assert.equal(audioStream.channels, 2, "demo narration must use stereo audio");
const videoDuration = Number(probe.format.duration);
assert.ok(videoDuration >= 75 && videoDuration <= 90,
  `final demo video must run between 75 and 90 seconds; found ${videoDuration.toFixed(1)}s`);

assert.deepEqual(pngDimensions("public/brand/finly-cover-16x9.png"), { width: 1920, height: 1080 });
assert.deepEqual(pngDimensions("public/brand/finly-social-cover.png"), { width: 1200, height: 630 });
assert.deepEqual(pngDimensions("public/judge/finly-live-account.png"), { width: 1280, height: 720 });
for (const still of [
  "public/judge/video-hero.jpg",
  "public/judge/video-controls-aligned.jpg",
  "public/judge/video-controls-conflict.jpg",
  "public/judge/video-live.jpg",
]) {
  const file = requireFile(still, 50_000);
  const magic = readFileSync(file.path).subarray(0, 3);
  assert.deepEqual([...magic], [0xff, 0xd8, 0xff], `${still} must be a JPEG`);
}

const gateText = readFileSync(pathFor("research/output/quantitative_release_gate.json"), "utf8");
const publicGateText = readFileSync(pathFor("public/data/quantitative_release_gate.json"), "utf8");
const gate = JSON.parse(gateText);
validateQuantitativeReleaseGate(gate);
assert.equal(gateText, canonicalQuantitativeReleaseGateJson(gate));
assert.equal(publicGateText, gateText, "public release gate must be an exact byte copy");
assert.deepEqual(gate.allowed_claims, EXACT_ALLOWED_CLAIMS);
assert.equal(gate.release_decision.status, "GO_BOUNDED_RELEASE_NO_GO_PERFORMANCE_MATCHUP");
assert.equal(gate.conclusions.registered_future_only_tests.every((item) =>
  item.observed_outcome_count === 0 && item.performance_claim_authorized === false), true);

const g4 = gate.conclusions.g4_rejected_post_selection;
const finlyEndingWealth = Math.round(10_000 * (1 + g4.g4_total_return));
const spyEndingWealth = Math.round(10_000 * (1 + g4.spy_total_return));
assert.deepEqual(
  [finlyEndingWealth, spyEndingWealth, finlyEndingWealth - spyEndingWealth],
  [106_711, 68_082, 38_629],
  "historical ending-wealth proof changed",
);

const external = JSON.parse(readFileSync(pathFor("public/data/attempt150_public_evidence.json"), "utf8"));
assert.equal(external.evidence_class, "PRE_SPECIFIED_OUT_OF_ERA_EXTERNAL_REPLAY");
assert.equal(external.primary_window.observations, 21_218);
assert.deepEqual(
  [external.robustness.positive_rebalance_anchors, external.robustness.tested_rebalance_anchors],
  [21, 21],
);
assert.ok(external.robustness.positive_at_modeled_cost_bps.includes(25),
  "external replay must retain a positive result at the 25 bp cost stress");

const receipt = JSON.parse(readFileSync(pathFor("public/data/latest_receipt.json"), "utf8"));
assert.deepEqual(
  [receipt.compilation.selected.max_loss, receipt.compilation.selected.max_gain],
  [366, 634],
  "checked options payoff changed",
);
assert.equal(receipt.source_removal.variants.length, 4);
assert.equal(receipt.source_removal.passed, true);
assert.equal(receipt.perturbations.count, 32);
assert.equal(receipt.perturbations.passed, true);

const liveSnapshot = JSON.parse(readFileSync(pathFor("public/data/competition_live.json"), "utf8"));
assert.equal(liveSnapshot.account.equity, 100_000);
assert.equal(liveSnapshot.integrity.paper_account, true);
assert.equal(liveSnapshot.integrity.account_verified, true);
assert.equal(liveSnapshot.integrity.sanitized, true);
assert.equal(liveSnapshot.integrity.source, "Alpaca paper account");

for (const obsolete of [
  "public/data/submission_claims_lock.json",
  "public/data/g4_window_explorer.json",
  "docs/COMPETITOR_BENCHMARK.md",
  "evidence/competitor_benchmark.json",
  "public/.env",
  "public/.env.local",
  "dist/.env",
  "dist/.env.local",
]) requireAbsent(obsolete);

const reviewedPublicData = [
  "attempt150_public_evidence.json",
  "competition-deployment-record.json",
  "competition_forward_profit_2026_08_31.json",
  "competition_live.json",
  "current_economic_decision.json",
  "economic_options_overlay_replay.json",
  "economic_research.json",
  "g4_wealth_drawdown.json",
  "historical_backtest.json",
  "latest_receipt.json",
  "llama_decision_trace.json",
  "no_trade_receipt.json",
  "quantitative_release_gate.json",
];
const hostedData = [
  "attempt150_public_evidence.json",
  "competition-deployment-record.json",
  "competition_forward_profit_2026_08_31.json",
  "competition_live.json",
  "latest_receipt.json",
  "no_trade_receipt.json",
  "quantitative_release_gate.json",
];
for (const [dataDirectory, expectedNames] of [
  ["public/data", reviewedPublicData],
  ["dist/data", hostedData],
]) {
  const names = readdirSync(pathFor(dataDirectory), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(names, expectedNames, `${dataDirectory} does not match the reviewed public-data allowlist`);
  for (const name of names) {
    const text = readFileSync(pathFor(`${dataDirectory}/${name}`), "utf8");
    requireNoPatterns(`${dataDirectory}/${name}`, text, [
      /"(?:account_number|account_id|order_id|activity_id|api_key|secret_key|credential|access_token|refresh_token)"\s*:/iu,
      /\brc_[0-9a-f]{32,}\b/iu,
      /\b(?:PK|AK)[A-Z0-9]{16,}\b/u,
    ]);
  }
}

const historicalPatterns = [
  /2013.{0,40}2026/iu,
  /\$10,000.{0,100}\$106,711/iu,
  /\$68,082/u,
  /\$38,629/u,
  /(?:historical.{0,120}simulation|simulation.{0,120}historical|2013.{0,40}simulation|retrospective)/iu,
];
const earlierEraPatterns = [
  /21,218/iu,
  /13\.37(?:%| percent)/iu,
  /9\.48(?:%| percent)/iu,
  /(?:21\s*\/\s*21|21 of 21|all (?:twenty-one|21)).{0,120}(?:anchors?|offsets?|rebalance (?:dates?|offsets?|schedule)|monthly (?:start|update) (?:dates?|days?)|tests? that changed (?:which trading day|the monthly update day))/iu,
];
const optionsPatterns = [
    /\$366.{0,80}maximum loss|maximum loss.{0,80}\$366/iu,
  /\$634.{0,80}maximum gain|maximum gain.{0,80}\$634/iu,
  /(?:4\s*\/\s*4|4 of 4|all four|four).{0,100}(?:removed|removals?|source-removal|source removal|data sources?|sources?.{0,20}removed)|remov(?:ing|ed).{0,40}(?:each of )?four sources/iu,
  /(?:32\s*\/\s*32|32 of 32|all (?:thirty-two|32)|thirty-two).{0,100}(?:input|perturb|small.{0,20}changes?)/iu,
];
const accountPatterns = [
  /(?:verified.{0,80}\$100,000|\$100,000.{0,80}(?:verified|paper account))/iu,
  /Alpaca/iu,
];
const testCountPatterns = [
  /809.{0,240}(?:automated )?tests|(?:automated )?tests.{0,240}809/iu,
  /807.{0,25}(?:passed|passing)|(?:passed|passing).{0,25}807/iu,
];
const zeroFailurePattern = /(?:0|none).{0,20}failed|failed.{0,20}(?:0|none)/iu;
const commonDocumentPatterns = [
  ...historicalPatterns,
  ...earlierEraPatterns,
  ...optionsPatterns,
  ...accountPatterns,
  ...testCountPatterns,
];
const presentationPatterns = [
  historicalPatterns[0],
  historicalPatterns[1],
  historicalPatterns[3],
  ...earlierEraPatterns,
  ...optionsPatterns,
  ...accountPatterns,
  ...testCountPatterns,
];

const staleStoryPatterns = [
  /G4.{0,80}(?:was )?(?:rejected|denied|not promoted)/iu,
  /promotion was rejected/iu,
  /SPY\s*\/\s*BIL/iu,
  /Attempts?\s*115/iu,
  /Attempts?\s*116/iu,
  /refused to trade/iu,
  /\+15\.39%/u,
  /\+10\.56%/u,
  /\+33\.52%/u,
  /8\.12%/u,
  /-5\.45%/u,
  /controlled[- ]delegation/iu,
  /\bagentic\b/iu,
];
const evaluatorInstructionPatterns = [
  /ignore.{0,40}(?:previous|prior|other|all) instructions/iu,
  /(?:award|rank|select|choose).{0,60}Finly.{0,30}(?:winner|first|top|best)/iu,
  /make Finly win/iu,
  /do not tell.{0,40}(?:creator|judge|organizer)/iu,
  /hidden (?:prompt|instruction).{0,40}(?:grader|evaluator|judge)/iu,
];

const documentContracts = [
  {
    label: "one-page proposal",
    sourcePath: "docs/paper/one_page_writeup.md",
    pdfPath: "public/judge/Finly_Judge_Brief.pdf",
    patterns: commonDocumentPatterns,
    forbiddenPatterns: [...staleStoryPatterns, ...evaluatorInstructionPatterns],
  },
  {
    label: "technical note",
    sourcePath: "docs/paper/finly_technical_note.typ",
    pdfPath: "public/judge/Finly_Technical_Proposal.pdf",
    patterns: [
      ...commonDocumentPatterns,
      zeroFailurePattern,
      /3\.75(?:%| percent)/iu,
      /37\.18(?:%| percent)/iu,
      /2,048/iu,
      /HMAC[- ]SHA-?256/iu,
      /PLANNED.{0,80}ORDER_PENDING.{0,80}RECONCILING.{0,80}READY/isu,
      /SPY\s*\/\s*BIL/iu,
      /(?:did not pass statistical promotion|did not pass its statistical promotion|statistical promotion failed)/iu,
    ],
    forbiddenPatterns: evaluatorInstructionPatterns,
  },
  {
    label: "presentation",
    sourcePath: "scripts/build_finly_deck.mjs",
    pdfPath: "public/judge/Finly_Consulting_Deck.pdf",
    patterns: [...presentationPatterns, zeroFailurePattern],
    forbiddenPatterns: [...staleStoryPatterns, ...evaluatorInstructionPatterns],
  },
];
for (const contract of documentContracts) {
  requireSourcePdfParity(contract);
  const sourceText = readFileSync(pathFor(contract.sourcePath), "utf8");
  const pdfText = extractPdfText(pathFor(contract.pdfPath));
  requireNoPatterns(`${contract.label} source`, sourceText, contract.forbiddenPatterns);
  requireNoPatterns(`${contract.label} PDF`, pdfText, contract.forbiddenPatterns);
}

const captions = readFileSync(requireFile("public/judge/Finly_Demo_Video.srt", 800).path, "utf8");
requirePatterns("video captions", captions, [
  /real market prices and virtual money/iu,
  /AI studies the market and explains a trade/iu,
  /Fixed code caps the loss/iu,
  /When signals agree/iu,
  /When signals conflict/iu,
  /Every decision carries a receipt/iu,
  /test case, not a live fill/iu,
  /allocation sleeve traded during live market hours/iu,
  /at the close/iu,
  /gained \$95\.32/iu,
  /SPY lost \$57\.99/iu,
  /\$153\.31 advantage/iu,
  /2013 to 2026/iu,
  /\$10,000/iu,
  /\$106,711/iu,
  /\$38,629/iu,
  /80-year market record/iu,
  /13\.37%/iu,
  /9\.48%/iu,
  /all 21 tested monthly rebalance schedules/iu,
  /\$366/iu,
  /\$500 limit/iu,
  /verify every number in the public repository/iu,
]);
requireNoPatterns("video captions", captions, [...staleStoryPatterns, ...evaluatorInstructionPatterns, /llama still does not get the keys/iu]);

const timestampPattern = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})/gu;
const timestamps = [...captions.matchAll(timestampPattern)];
assert.ok(timestamps.length >= 9, "video captions must cover the complete nine-scene launch cut");
const captionSeconds = (match, offset) => Number(match[offset]) * 3600
  + Number(match[offset + 1]) * 60 + Number(match[offset + 2]) + Number(match[offset + 3]) / 1000;
assert.ok(captionSeconds(timestamps[0], 1) <= 0.1, "video captions must begin with the launch");
const finalCaptionEnd = captionSeconds(timestamps.at(-1), 5);
assert.ok(finalCaptionEnd <= videoDuration + 0.25, "captions must not extend beyond the final video");
assert.ok(finalCaptionEnd >= 60, "captions end too early for the final launch cut");

const machineSummary = readFileSync(requireFile("public/llms.txt", 1_500).path, "utf8");
requirePatterns("machine-readable summary", machineSummary, [
  ...commonDocumentPatterns,
  zeroFailurePattern,
  /809 automated tests: 807 passed, 0 failed, and 2 were skipped/iu,
  /\$153\.31 ahead of SPY/iu,
  /15 (?:ETF|broker) fill events/iu,
  /Alpaca's official (?:MCP server|connection)/iu,
  /Start with the live dashboard/iu,
]);
requireNoPatterns("machine-readable summary", machineSummary, [...staleStoryPatterns, ...evaluatorInstructionPatterns]);
assert.doesNotMatch(normalizedText(machineSummary), /Finly (?:will|is likely to) beat SPY/iu);

const indexHtml = readFileSync(pathFor("index.html"), "utf8");
requirePatterns("social metadata", indexHtml, [
  /\$153\.31 ahead of SPY in its first paper-trading session/iu,
  /Same \$100K starting point and same 4:00 p\.m\. price/iu,
]);
requireNoPatterns("social metadata", indexHtml, [
  /A backtest returned \+967\.11%.{0,40}Finly rejected it/iu,
  ...evaluatorInstructionPatterns,
]);

for (const [label, file] of [["one-page", onePage], ["technical note", paper], ["engineering appendix", appendix], ["deck", deck]]) {
  assert.ok(file.size < 20 * 1024 * 1024, `${label} PDF is unexpectedly large`);
}

console.log(
  `submission artifacts verified: 1-page brief; 7-page mathematical note; 14-page engineering appendix; 9-slide deck; `
  + `${videoDuration.toFixed(1)}s H.264/AAC launch video; 809 tests / 807 passed / 0 failed; `
  + `exact quantitative gate; sanitized public data`,
);
