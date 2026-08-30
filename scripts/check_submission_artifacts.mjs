import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

function executablePath(command) {
  try {
    const path = execFileSync("which", [command], { encoding: "utf8" }).trim();
    return path || null;
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
    .replace(/\s+/gu, " ")
    .trim();
}

function requirePatterns(label, value, patterns) {
  const text = normalizedText(value);
  for (const pattern of patterns) {
    assert.match(text, pattern, `${label} is stale or missing the current evidence statement: ${pattern}`);
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

const execution = claims.execution_realism;
assert.equal(execution.evidence_class, "CONSUMED_RETROSPECTIVE_EXECUTION_REALISM");
assert.equal(execution.policy_id, "tsmom_ensemble_vol");
assert.deepEqual(execution.window, { start: "2025-01-02", end: "2026-08-28", observations: 415 });
assert.match(execution.fill_assumption, /next session open t\+1/i);
assert.equal(execution.cost_unit, "basis points per absolute traded-notional leg");
assert.deepEqual(execution.next_open_cost_stress.map(({ bps_per_leg }) => bps_per_leg), [1, 5, 25]);
assert.equal(execution.next_open_cost_stress.every(({ total_return }) => total_return > 0), true);
const fiveBasisPoint = execution.next_open_cost_stress.find(({ bps_per_leg }) => bps_per_leg === 5);
const twentyFiveBasisPoint = execution.next_open_cost_stress.find(({ bps_per_leg }) => bps_per_leg === 25);
assert.ok(fiveBasisPoint.total_return < fiveBasisPoint.spy_total_return,
  "production policy must not be presented as beating SPY in the execution-realism window");
assert.equal(execution.raw_no_distribution_proxy.bps_per_leg, 1);
assert.ok(execution.raw_no_distribution_proxy.total_return > 0);
assert.equal(execution.small_account_proxy.bps_per_leg, 1);
assert.equal(execution.small_account_proxy.initial_equity_usd, 300);
assert.equal(execution.small_account_proxy.minimum_order_notional_usd, 1);
assert.equal(execution.small_account_proxy.quantity_decimals, 9);
assert.equal(execution.small_account_proxy.skipped_minimum_orders, 12);
assert.equal(execution.assurance.consumed_retrospective_only, true);
assert.equal(execution.assurance.alpha_proven, false);
assert.equal(execution.assurance.future_profitability_proven, false);
assert.equal(execution.assurance.broker_fill_verified, false);
assert.equal(execution.assurance.broker_mutation_authorized, false);
assert.match(execution.exact_safe_claim, /underperformed SPY/i);

const attempt = claims.prospective_attempt114;
assert.equal(attempt.attempt_id, "finly_prospective_profitability_attempt_114");
assert.equal(attempt.attempt_number, 114);
assert.equal(attempt.publication_status, "PUBLIC_PRE_DEADLINE_GITHUB_WORKFLOW_VERIFIED");
assert.equal(attempt.required_signal_commitments, 254);
assert.equal(attempt.required_settlements, 252);
assert.equal(attempt.primary_intervals, 252);
assert.equal(attempt.exclusive_deadline, "2026-08-31T20:00:00.000Z");
assert.equal(attempt.publication_commit.sha, "38a999cdf5db98f3a831d137b799ff8a48248e71");
assert.equal(attempt.publication_commit.url,
  "https://github.com/owlsowo/finly-bot/commit/38a999cdf5db98f3a831d137b799ff8a48248e71");
assert.equal(attempt.verification_workflow.run_id, 33293038439);
assert.equal(attempt.verification_workflow.url,
  "https://github.com/owlsowo/finly-bot/actions/runs/33293038439");
assert.equal(attempt.bound_runtime_source_count, 17);
assert.equal(attempt.public_get_count, 23);
assert.equal(attempt.verification_workflow.conclusion, "success");
assert.ok(Date.parse(attempt.verification_workflow.completed_at) < Date.parse(attempt.exclusive_deadline));
assert.equal(attempt.assurance.public_pre_deadline_publication_observed, true);
assert.equal(attempt.assurance.independent_cryptographic_timestamp_verified, false);
assert.equal(attempt.assurance.provider_origin_verified, false);
assert.equal(attempt.assurance.broker_execution_verified, false);
assert.equal(attempt.assurance.performance_inference_permitted, false);
assert.equal(attempt.assurance.broker_mutation_authorized, false);
assert.deepEqual(attempt.sample_boundary, {
  consecutive_official_sessions_required: true,
  no_skips: true,
  no_backfill: true,
  replacement_window_permitted: false,
  optional_stopping_permitted: false,
  repeat_confirmatory_test_permitted: false,
});
assert.match(attempt.exact_safe_claim, /not an independent cryptographic timestamp/i);

const explorer = JSON.parse(readFileSync(requireFile("public/data/g4_window_explorer.json", 1_000_000).path, "utf8"));
assert.equal(explorer.schema_version, "finly_public_g4_window_explorer.v1");
assert.equal(explorer.rows.length, 3434);
assert.equal(explorer.default_window.exact_submission_claims_lock_match, true);
assert.equal(explorer.default_window.ending_values.g4_ending_value_usd, 1067105.98);
assert.equal(explorer.default_window.ending_values.spy_ending_value_usd, 680817.46);
assert.equal(explorer.default_window.ending_values.g4_minus_spy_ending_value_usd, 386288.52);

const machineSummary = readFileSync(requireFile("public/llms.txt", 1_000).path, "utf8");
assert.match(machineSummary, /\$1,067,106/);
assert.match(machineSummary, /Finly did not beat SPY's raw return/i);

const percent = (value) => `${(value * 100).toFixed(2)}%`;
const executionPatterns = [
  /415(?:\s*-\s*observation| next-open observations| consumed sessions| observations)/i,
  new RegExp(percent(fiveBasisPoint.total_return).replace(".", "\\.")),
  new RegExp(percent(fiveBasisPoint.spy_total_return).replace(".", "\\.")),
  new RegExp(percent(twentyFiveBasisPoint.total_return).replace(".", "\\.")),
  new RegExp(execution.small_account_proxy.ending_equity_usd.toFixed(2).replace(".", "\\.")),
  /(?:did not (?:beat|outperform) SPY|underperformed SPY|SPY (?:still )?won (?:on )?(?:raw )?return|not (?:claim )?(?:historical )?raw\s*-\s*return dominance)/i,
];
const prospectivePatterns = [
  /Attempt 114/i,
  /(?:17\s*-\s*file|17 named source files|17 runtime source files|Seventeen runtime source files)/i,
  /23 (?:fixed )?(?:unauthenticated )?(?:public )?(?:GET checks|GET requests|checks)/i,
  /254 (?:consecutive )?(?:(?:pre\s*-\s*execution|timely|public|signal) )*(?:commitments|commitment anchors|anchors)/i,
  /252 (?:settled returns|settlements|reconciled settlements)/i,
  /not an independent cryptographic timestamp/i,
];

requirePatterns("machine-readable summary", machineSummary, [...executionPatterns, ...prospectivePatterns]);
requireSourcePdfParity({
  label: "one-page proposal",
  sourcePath: "docs/paper/one_page_writeup.md",
  pdfPath: "public/judge/Finly_Judge_Brief.pdf",
  patterns: [...executionPatterns, ...prospectivePatterns],
});
requireSourcePdfParity({
  label: "technical paper",
  sourcePath: "docs/paper/finly_technical_paper.md",
  pdfPath: "public/judge/Finly_Technical_Proposal.pdf",
  patterns: [...executionPatterns, ...prospectivePatterns],
});
requireSourcePdfParity({
  label: "consulting deck",
  sourcePath: "scripts/build_finly_deck.mjs",
  pdfPath: "public/judge/Finly_Consulting_Deck.pdf",
  patterns: [
    /Attempt 114/i,
    new RegExp(percent(fiveBasisPoint.total_return).replace(".", "\\.")),
    new RegExp(percent(fiveBasisPoint.spy_total_return).replace(".", "\\.")),
    new RegExp(percent(twentyFiveBasisPoint.total_return).replace(".", "\\.")),
    /254 (?:consecutive )?(?:(?:pre\s*-\s*execution|timely|public|signal) )*(?:commitments|commitment anchors|anchors)/i,
    /252.{0,100}(?:settled returns|settlements|reconciled settlements)/i,
    /(?:did not (?:beat|outperform) SPY|underperformed SPY|SPY (?:still )?won (?:on )?(?:raw )?return|not (?:claim )?(?:historical )?raw\s*-\s*return dominance)/i,
  ],
});

console.log(
  `submission artifacts verified: 1-page brief; 5-page paper; 9-slide deck; ` +
  `${Number(probe.format.duration).toFixed(1)}s video; interactive 3,434-row replay; 16:9 cover; ` +
  `execution-realism and Attempt 114 claim boundaries intact`,
);
