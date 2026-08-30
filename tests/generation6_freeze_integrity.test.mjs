import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("every Generation 6 freeze-receipt byte remains available at its pinned path", async () => {
  const receipt = JSON.parse(await readFile(
    resolve(projectRoot, "research/champion_search_generation6_freeze_receipt.json"),
    "utf8",
  ));

  assert.equal(receipt.schema_version, "finly_champion_search_generation6_freeze_receipt.v1");
  assert.equal(receipt.generation_6_results_seen_at_freeze, false);
  assert.equal(receipt.generation_6_output_absent_at_freeze, true);
  assert.ok(Object.keys(receipt.files).length > 0);

  for (const [relativePath, expectedHash] of Object.entries(receipt.files)) {
    const bytes = await readFile(resolve(projectRoot, relativePath));
    assert.equal(sha256(bytes), expectedHash, `${relativePath} differs from the Generation 6 freeze receipt`);
  }
});
