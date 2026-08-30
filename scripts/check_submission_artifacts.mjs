import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pathFor = (relativePath) => resolve(root, relativePath);

function requireFile(relativePath, minimumBytes) {
  const path = pathFor(relativePath);
  const stat = statSync(path);
  assert.ok(stat.isFile(), `${relativePath} must be a file`);
  assert.ok(stat.size >= minimumBytes, `${relativePath} is unexpectedly small (${stat.size} bytes)`);
  return { path, size: stat.size };
}

function requirePdf(relativePath, expectedPages) {
  const file = requireFile(relativePath, 40_000);
  const header = readFileSync(file.path).subarray(0, 5).toString("ascii");
  assert.equal(header, "%PDF-", `${relativePath} must be a PDF`);
  const output = execFileSync("pdfinfo", [file.path], { encoding: "utf8" });
  const pages = Number(/^Pages:\s+(\d+)$/m.exec(output)?.[1]);
  assert.equal(pages, expectedPages, `${relativePath} must contain ${expectedPages} pages`);
  return file;
}

function pngDimensions(relativePath) {
  const file = requireFile(relativePath, 10_000);
  const data = readFileSync(file.path);
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG", `${relativePath} must be a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

requirePdf("public/judge/Finly_Judge_Brief.pdf", 1);
requirePdf("public/judge/Finly_Technical_Proposal.pdf", 5);
requirePdf("public/judge/Finly_Consulting_Deck.pdf", 9);
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
assert.deepEqual([videoStream?.width, videoStream?.height], [1920, 1080], "demo video must be 1920×1080");
assert.ok(audioStream, "demo video must contain AAC narration");
assert.ok(Number(probe.format.duration) > 60 && Number(probe.format.duration) <= 300, "demo video must run between one and five minutes");

const captions = readFileSync(requireFile("public/judge/Finly_Demo_Video.srt", 500).path, "utf8");
assert.match(captions, /Most trading demos begin/);
assert.match(captions, /llama still does not get the keys/);

assert.deepEqual(pngDimensions("public/brand/finly-cover-16x9.png"), { width: 1920, height: 1080 });
assert.deepEqual(pngDimensions("public/brand/finly-social-cover.png"), { width: 1200, height: 630 });

const claims = JSON.parse(readFileSync(pathFor("public/data/submission_claims_lock.json"), "utf8"));
assert.equal(claims.hindsight_boundary.fully_preregistered_claim_permitted, false);
assert.equal(claims.options_and_broker_boundary.historical_g4_is_options_pnl, false);
assert.equal(claims.options_and_broker_boundary.order_submitted_or_filled_as_evidence, false);
assert.equal(claims.forward_trial.settlements, 0);
assert.equal(claims.forward_trial.performance_inference_enabled, false);

const explorer = JSON.parse(readFileSync(requireFile("public/data/g4_window_explorer.json", 1_000_000).path, "utf8"));
assert.equal(explorer.schema_version, "finly_public_g4_window_explorer.v1");
assert.equal(explorer.rows.length, 3434);
assert.equal(explorer.default_window.exact_submission_claims_lock_match, true);
assert.equal(explorer.default_window.ending_values.g4_ending_value_usd, 1067105.98);
assert.equal(explorer.default_window.ending_values.spy_ending_value_usd, 680817.46);
assert.equal(explorer.default_window.ending_values.g4_minus_spy_ending_value_usd, 386288.52);
assert.deepEqual(explorer.robustness.windows.map(({ years, wins, total }) => ({ years, wins, total })), [
  { years: 1, wins: 2466, total: 3183 },
  { years: 3, wins: 2508, total: 2679 },
  { years: 5, wins: 2175, total: 2175 },
]);
assert.match(explorer.robustness.boundary, /overlap heavily/i);

function standaloneGrowth(rows, book, startIndex, sessions, costRate) {
  let growth = 1;
  for (let offset = 0; offset < sessions; offset += 1) {
    const item = rows[startIndex + offset][book];
    let transactionCost = offset === 0 ? item.entry_notional * costRate : item.base_transaction_cost;
    if (offset === sessions - 1) transactionCost += item.terminal_liquidation_notional * costRate;
    transactionCost = Math.round((transactionCost + Number.EPSILON) * 1e10) / 1e10;
    const netReturn = Math.round((item.gross_return - item.financing_spread_cost - transactionCost + Number.EPSILON) * 1e10) / 1e10;
    assert.ok(1 + netReturn > 0, `invalid ${book} return at window row ${startIndex + offset}`);
    growth *= 1 + netReturn;
  }
  return growth;
}

const fiveYearSessions = 5 * 252;
let recomputedFiveYearWins = 0;
for (let startIndex = 0; startIndex + fiveYearSessions <= explorer.rows.length; startIndex += 1) {
  const g4Growth = standaloneGrowth(explorer.rows, "g4", startIndex, fiveYearSessions, 5 / 10_000);
  const spyGrowth = standaloneGrowth(explorer.rows, "spy", startIndex, fiveYearSessions, 5 / 10_000);
  if (g4Growth - spyGrowth > 1e-14) recomputedFiveYearWins += 1;
}
assert.equal(recomputedFiveYearWins, 2175, "five-year wins must reproduce directly from public rows");

const machineSummary = readFileSync(requireFile("public/llms.txt", 1_000).path, "utf8");
assert.match(machineSummary, /\$1,067,106/);
assert.match(machineSummary, /2,175 overlapping five-year/i);

console.log(
  `submission artifacts verified: 1-page brief; 5-page paper; 9-slide deck; ` +
  `${Number(probe.format.duration).toFixed(1)}s video; interactive 3,434-row replay; 16:9 cover; claim boundary intact`,
);
