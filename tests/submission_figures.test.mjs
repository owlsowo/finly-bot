import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

test("submission wealth/drawdown data is aligned to the frozen G4 evidence", async () => {
  const dataset = JSON.parse(await readFile(resolve(projectRoot, "public/data/g4_wealth_drawdown.json"), "utf8"));
  assert.equal(dataset.schema_version, "finly_public_g4_wealth_drawdown.v1");
  assert.equal(dataset.evidence_class, "CONSUMED_RETROSPECTIVE_ETF_REPLAY");
  assert.equal(dataset.observations, 3434);
  assert.equal(dataset.rows.length, 3434);
  assert.equal(dataset.rows[0].date, "2013-01-02");
  assert.equal(dataset.rows.at(-1).date, "2026-08-27");
  assert.equal(dataset.rows.at(-1).g4_wealth, 10.67105978);
  assert.equal(dataset.rows.at(-1).spy_wealth, 6.80817462);
  assert.equal(Math.min(...dataset.rows.map((row) => row.g4_drawdown)), -0.28985212);
  assert.equal(Math.min(...dataset.rows.map((row) => row.spy_drawdown)), -0.33717261);
  assert.equal(
    dataset.source_private_ledger_gzip_sha256,
    "6f656b79d7a4e836eda3b85d35bfca34841e80c0da16a2afdef30e862d8a23e1",
  );
  assert.match(dataset.claim_boundary, /Consumed adjusted-close ETF replay/);
  assert.match(dataset.claim_boundary, /not promoted/);
  assert.match(dataset.claim_boundary, /not an options P&L/);
  assert.match(dataset.claim_boundary, /not a forecast/);
});

test("public and document figure copies are identical nontrivial PNGs", async () => {
  const [publicFigure, docsFigure] = await Promise.all([
    readFile(resolve(projectRoot, "public/figures/g4_wealth_drawdown.png")),
    readFile(resolve(projectRoot, "docs/figures/g4_wealth_drawdown.png")),
  ]);
  assert.ok(publicFigure.length > 100_000);
  assert.equal(publicFigure.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(sha256(publicFigure), sha256(docsFigure));
});
