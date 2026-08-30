import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { round, sha256 } from "../research/champion_engine.mjs";
import { CORE_SYMBOLS } from "../research/champion_strategies.mjs";
import {
  evaluateVolatilityManagedG4Panel,
  finalizeVolatilityManagedG4Evaluation,
  serializeVolatilityManagedG4EvaluationArtifact,
  validateVolatilityManagedG4EvaluationArtifact,
  validateVolatilityManagedG4Panel,
  VOLATILITY_MANAGED_G4_ANCHORS,
  VOLATILITY_MANAGED_G4_CANDIDATE_GENERATION_BOUNDARY,
  VOLATILITY_MANAGED_G4_COST_LEVELS_BPS,
  VOLATILITY_MANAGED_G4_PANEL,
  VOLATILITY_MANAGED_G4_SLICES,
} from "../research/run_volatility_managed_g4_candidate.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixturePanel(length = 900) {
  const start = Date.parse("2010-01-01T00:00:00Z");
  const prices = Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, 100]));
  const points = [];
  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      const common = 0.00025 + 0.0025 * Math.sin(index / 19);
      for (const [symbolIndex, symbol] of CORE_SYMBOLS.entries()) {
        const returnValue = symbol === "BIL"
          ? 0.00004
          : common + 0.00002 * Math.cos(index / (7 + symbolIndex))
            + 0.000001 * symbolIndex;
        prices[symbol] *= 1 + returnValue;
      }
    }
    points.push(Object.freeze({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      ...prices,
    }));
  }
  return Object.freeze(points);
}

function descriptorFor(points, extra = {}) {
  const panel = {
    schema_version: "fixture_panel.v1",
    normalized_panel_sha256: sha256(points.map((point) => [
      point.date,
      ...CORE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
    ])),
    points,
  };
  const raw = Buffer.from(JSON.stringify(panel));
  return {
    panel,
    raw,
    descriptor: {
      payload_sha256: sha256Bytes(raw),
      normalized_panel_sha256: panel.normalized_panel_sha256,
      schema_version: panel.schema_version,
      common_start: points[0].date,
      common_end: points.at(-1).date,
      common_sessions: points.length,
      ...extra,
    },
  };
}

test("runner pins the exact panel, slices, costs, anchors, and candidate-generation boundary", () => {
  assert.equal(VOLATILITY_MANAGED_G4_PANEL.payload_sha256,
    "91a53ac73e785d2ccb8db043cce6d808b9a851d7e95da7031bb227e8b40d1014");
  assert.equal(VOLATILITY_MANAGED_G4_PANEL.normalized_panel_sha256,
    "bef945fb53d56801d0d9f99d23a641d2ee7a7c14c515ddb3fec1acc79451e883");
  assert.deepEqual(VOLATILITY_MANAGED_G4_COST_LEVELS_BPS, [5, 10, 25]);
  assert.deepEqual(VOLATILITY_MANAGED_G4_ANCHORS, Array.from({ length: 21 }, (_, index) => index));
  assert.deepEqual(VOLATILITY_MANAGED_G4_SLICES, {
    development: { start: "2008-06-02", end: "2017-12-29" },
    validation: { start: "2018-01-02", end: "2024-12-31" },
    recent: { start: "2025-01-02", end: "2026-08-27" },
  });
  assert.equal(
    VOLATILITY_MANAGED_G4_CANDIDATE_GENERATION_BOUNDARY.public_or_marketing_claim_authorized,
    false,
  );
  assert.equal(
    VOLATILITY_MANAGED_G4_CANDIDATE_GENERATION_BOUNDARY.multiplicity
      .working_effective_trial_count_for_any_future_deflation,
    148,
  );
});

test("panel validation binds raw bytes, normalized point order, chronology, and required symbols", () => {
  const points = fixturePanel(300);
  const fixture = descriptorFor(points);
  const validated = validateVolatilityManagedG4Panel(fixture.raw, fixture.descriptor);
  assert.equal(validated.payload_sha256, fixture.descriptor.payload_sha256);
  assert.equal(validated.normalized_panel_sha256, fixture.descriptor.normalized_panel_sha256);

  assert.throws(() => validateVolatilityManagedG4Panel(
    Buffer.concat([fixture.raw, Buffer.from("\n")]),
    fixture.descriptor,
  ), /payload hash mismatch/u);

  const mutated = structuredClone(fixture.panel);
  mutated.points[100].SPY *= 2;
  const mutatedRaw = Buffer.from(JSON.stringify(mutated));
  assert.throws(() => validateVolatilityManagedG4Panel(mutatedRaw, {
    ...fixture.descriptor,
    payload_sha256: sha256Bytes(mutatedRaw),
  }), /normalized hash cannot be reproduced/u);

  const reordered = structuredClone(fixture.panel);
  [reordered.points[100], reordered.points[101]] = [reordered.points[101], reordered.points[100]];
  const reorderedRaw = Buffer.from(JSON.stringify(reordered));
  assert.throws(() => validateVolatilityManagedG4Panel(reorderedRaw, {
    ...fixture.descriptor,
    payload_sha256: sha256Bytes(reorderedRaw),
  }), /dates are not strictly increasing/u);
});

test("focused fixture evaluation uses standalone slices and counts every requested anchor", () => {
  const points = fixturePanel();
  const slices = Object.freeze({
    development: Object.freeze({ start: points[300].date, end: points[499].date }),
    validation: Object.freeze({ start: points[500].date, end: points[699].date }),
    recent: Object.freeze({ start: points[700].date, end: points[899].date }),
  });
  const result = evaluateVolatilityManagedG4Panel(points, {
    costLevelsBps: [5],
    anchors: [0, 1],
    slices,
  });
  assert.deepEqual(Object.keys(result), ["5"]);
  assert.equal(result[5].anchor_results.length, 2);
  assert.deepEqual(result[5].anchor_results.map((record) => record.rebalance_anchor), [0, 1]);
  assert.equal(result[5].positive_annualized_log_growth_edge_anchor_counts.denominator, 2);
  for (const count of Object.values(
    result[5].positive_annualized_log_growth_edge_anchor_counts.by_slice,
  )) assert.ok(count >= 0 && count <= 2);
  for (const record of result[5].anchor_results) {
    for (const [sliceId, slice] of Object.entries(slices)) {
      const evidence = record.slices[sliceId];
      assert.equal(evidence.candidate.start_date, slice.start);
      assert.equal(evidence.candidate.end_date, slice.end);
      assert.equal(evidence.spy_buy_hold.start_date, slice.start);
      assert.equal(evidence.spy_buy_hold.end_date, slice.end);
      assert.equal(evidence.candidate.observations, evidence.spy_buy_hold.observations);
      assert.equal(evidence.candidate_gross.target_at_native_rebalances.above_1_5_cap_count, 0);
      assert.ok(Number.isFinite(evidence.comparison.annualized_log_growth_edge));
    }
  }
});

test("artifact serialization is deterministic and fails closed on self-hash drift", () => {
  const artifact = finalizeVolatilityManagedG4Evaluation({
    schema_version: "fixture.v1",
    status: "INTERNAL_POST_SELECTION_CANDIDATE_GENERATION",
    nested: { value: 1 },
  });
  assert.equal(validateVolatilityManagedG4EvaluationArtifact(artifact), true);
  assert.equal(
    serializeVolatilityManagedG4EvaluationArtifact(artifact),
    serializeVolatilityManagedG4EvaluationArtifact(artifact),
  );
  assert.throws(() => validateVolatilityManagedG4EvaluationArtifact({
    ...artifact,
    nested: { value: 2 },
  }), /self-hash mismatch/u);
});

test("the local fixed private panel passes the frozen byte and normalized integrity contract", async (context) => {
  let raw;
  try {
    raw = await readFile(resolve(PROJECT_ROOT, VOLATILITY_MANAGED_G4_PANEL.path));
  } catch (error) {
    if (error?.code === "ENOENT") {
      context.skip("ignored private panel is unavailable in this clone");
      return;
    }
    throw error;
  }
  const validated = validateVolatilityManagedG4Panel(raw);
  assert.equal(validated.panel.points.length, 4843);
  assert.equal(validated.panel.points[0].date, "2007-05-30");
  assert.equal(validated.panel.points.at(-1).date, "2026-08-27");
});
