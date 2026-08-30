import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { SYNTHETIC_REPLAY_SIGNING_SECRET, verifyCertificate } from "../lib/risk.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(projectRoot, process.argv[2] ?? "outputs/replay_receipt.json");
const receipt = JSON.parse(await readFile(path, "utf8"));
const { receipt_id: receiptId, ...receiptBody } = receipt;
assert.equal(sha256(receiptBody), receiptId, "receipt hash mismatch");
verifyCertificate(receipt.certificate, {
  signingSecret: SYNTHETIC_REPLAY_SIGNING_SECRET,
  requiredScope: "synthetic_replay",
  now: receipt.created_at,
});
const candidate = receipt.compilation.selected;
assert.ok(candidate, "checker expected a selected candidate");
assert.equal(candidate.max_loss, Math.round(candidate.entry_debit * 100 * 100) / 100, "max loss mismatch");
assert.equal(candidate.max_gain, Math.round((candidate.width - candidate.entry_debit) * 100 * 100) / 100, "max gain mismatch");
assert.ok(candidate.expected_shortfall_95 >= -candidate.max_loss, "ES95 exceeds exact max loss");
assert.ok(candidate.conservative_ev >= candidate.required_ev, "candidate fails conservative EV gate");
assert.ok(candidate.probability_profit >= 0.53, "candidate fails probability gate");
assert.equal(receipt.source_removal.passed, true, "source-removal gate failed");
assert.equal(receipt.perturbations.direction_flips, 0, "perturbation direction flip detected");
assert.equal(receipt.alpaca_payload.order_class, "mleg", "payload is not multi-leg");
assert.equal(receipt.alpaca_payload.limit_price, candidate.entry_debit.toFixed(2), "payload debit mismatch");
assert.deepEqual(
  receipt.alpaca_payload.legs.map((leg) => leg.symbol),
  [candidate.long_leg.symbol, candidate.short_leg.symbol],
  "payload legs differ from certified candidate",
);
const { payload_sha256: payloadHash, ...payloadBody } = receipt.alpaca_payload;
assert.equal(sha256(payloadBody), payloadHash, "payload hash mismatch");
process.stdout.write(`${stableStringify({
  status: "PASS",
  receipt_id: receiptId,
  certificate_id: receipt.certificate.certificate_id,
  checks: Object.keys(receipt.certificate.checks).length,
})}\n`);
