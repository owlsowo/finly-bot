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

console.log(
  `submission artifacts verified: 1-page brief; 5-page paper; 9-slide deck; ` +
  `${Number(probe.format.duration).toFixed(1)}s video; 16:9 cover; claim boundary intact`,
);
