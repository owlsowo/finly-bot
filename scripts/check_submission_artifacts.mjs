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
const paper = requirePdf("public/judge/Finly_Technical_Proposal.pdf", 8);
const deck = requirePdf("public/judge/Finly_Consulting_Deck.pdf", 9);
requireFile("public/judge/Finly_Judge_Proposal.docx", 20_000);
requireFile("public/judge/Finly_Technical_Paper.docx", 40_000);
requireFile("public/judge/Finly_Consulting_Deck.pptx", 100_000);

const video = requireFile("public/judge/Finly_Demo_Video.mp4", 1_000_000);
assert.ok(video.size < 300 * 1024 * 1024, "demo video must be under 300 MB");
const probe = JSON.parse(execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration,size",
  "-of", "json", video.path,
], { encoding: "utf8" }));
const videoStream = probe.streams.find((stream) => stream.width && stream.height);
const audioStream = probe.streams.find((stream) => stream.codec_name === "aac");
assert.equal(videoStream?.codec_name, "h264", "demo video must use H.264");
assert.deepEqual([videoStream?.width, videoStream?.height], [1920, 1080],
  "demo video must be 1920×1080");
assert.ok(audioStream, "demo video must contain AAC narration");
assert.ok(Number(probe.format.duration) > 60 && Number(probe.format.duration) <= 300,
  "demo video must run between one and five minutes");

assert.deepEqual(pngDimensions("public/brand/finly-cover-16x9.png"), { width: 1920, height: 1080 });
assert.deepEqual(pngDimensions("public/brand/finly-social-cover.png"), { width: 1200, height: 630 });
assert.deepEqual(pngDimensions("public/judge/finly-product-home.png"), { width: 1280, height: 720 });

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

for (const obsolete of [
  "public/data/submission_claims_lock.json",
  "public/data/g4_window_explorer.json",
  "docs/COMPETITOR_BENCHMARK.md",
  "evidence/competitor_benchmark.json",
]) requireAbsent(obsolete);

assert.deepEqual(
  readdirSync(pathFor("dist/data"), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort(),
  ["latest_receipt.json", "no_trade_receipt.json", "quantitative_release_gate.json"],
  "hosted data bundle must contain only the two synthetic receipts and exact release gate",
);

const g4Patterns = [
  /2013-01-02.{0,100}2026-08-27/iu,
  /\+967\.11%/u,
  /\+580\.82%/u,
  /3\.75%/u,
  /37\.18%/u,
  /rejected/iu,
];
const productionPatterns = [
  /2025-01-02.{0,100}2026-08-28/iu,
  /\+15\.39%/u,
  /\+10\.56%/u,
  /\+33\.52%/u,
  /8\.12%/u,
  /-5\.45%/u,
  /(?:not market-beating|did not beat|below SPY)/iu,
];
const futurePatterns = [
  /Attempts 115 and 116/iu,
  /(?:zero|0) observed outcomes/iu,
  /neither supports a performance claim/iu,
];
const documentPatterns = [...g4Patterns, ...productionPatterns, ...futurePatterns];
const productMetadataPatterns = [
  /From market evidence to a bounded options decision/iu,
  /deterministic code owns the contract, maximum loss, stress tests, and final authorization outcome/iu,
];

requireSourcePdfParity({
  label: "one-page proposal",
  sourcePath: "docs/paper/one_page_writeup.md",
  pdfPath: "public/judge/Finly_Judge_Brief.pdf",
  patterns: documentPatterns,
});
requireSourcePdfParity({
  label: "technical paper",
  sourcePath: "docs/paper/finly_technical_paper.md",
  pdfPath: "public/judge/Finly_Technical_Proposal.pdf",
  patterns: documentPatterns,
});
requireSourcePdfParity({
  label: "consulting deck",
  sourcePath: "scripts/build_finly_deck.mjs",
  pdfPath: "public/judge/Finly_Consulting_Deck.pdf",
  patterns: documentPatterns,
});

const captions = readFileSync(requireFile("public/judge/Finly_Demo_Video.srt", 500).path, "utf8");
requirePatterns("video captions", captions, [
  /967\.11 percent/iu,
  /580\.82 percent/iu,
  /3\.75 percent/iu,
  /37\.18 percent/iu,
  /15\.39 percent/iu,
  /10\.56 percent/iu,
  /33\.52 percent/iu,
  /Attempts 115 and 116/iu,
  /zero observed outcomes/iu,
  /llama still does not get the keys/iu,
]);

const machineSummary = readFileSync(requireFile("public/llms.txt", 1_000).path, "utf8");
requirePatterns("machine-readable summary", machineSummary, documentPatterns);
assert.doesNotMatch(normalizedText(machineSummary), /Finly (?:will|is likely to) beat SPY/iu);

const indexHtml = readFileSync(pathFor("index.html"), "utf8");
requirePatterns("social metadata", indexHtml, productMetadataPatterns);
assert.doesNotMatch(normalizedText(indexHtml), /A backtest returned \+967\.11%.{0,40}Finly rejected it/iu);

for (const [label, file] of [["one-page", onePage], ["paper", paper], ["deck", deck]]) {
  assert.ok(file.size < 20 * 1024 * 1024, `${label} PDF is unexpectedly large`);
}

console.log(
  `submission artifacts verified: 1-page essay; 8-page paper; 9-slide deck; `
  + `${Number(probe.format.duration).toFixed(1)}s video; exact public release gate; `
  + `obsolete public claim surfaces absent`,
);
