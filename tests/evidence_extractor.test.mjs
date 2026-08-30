import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../fixtures/spy_bearish_replay.json" with { type: "json" };
import { LocalLlamaEvidenceExtractor, validateEvidenceAssessment } from "../lib/evidence_extractor.mjs";

const source = fixture.signals.find((signal) => signal.family === "events");
const documents = source.evidence.map((record) => ({
  record,
  text: source.explanation,
}));

test("bounded local evidence extraction preserves canonical IDs and exposes no broker fields", async () => {
  let request;
  const extractor = new LocalLlamaEvidenceExtractor({
    timeoutMs: 500,
    fetchImpl: async (_url, options) => {
      request = options;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            schema_version: "evidence_assessment.v1",
            assessments: documents.map(({ record }) => ({
              evidence_id: record.evidence_id,
              direction_score: -0.25,
              volatility_score: 0.2,
              rationale: "The supplied event text implies a modest downside risk.",
            })),
          }) } }],
        }),
      };
    },
  });
  const result = await extractor.assessDocuments(documents, { underlying: "SPY", asOf: fixture.decision_time });
  assert.equal(result.assessments[0].evidence_id, documents[0].record.evidence_id);
  assert.equal(request.redirect, "error");
  assert.ok(request.signal instanceof AbortSignal);
  const prompt = JSON.parse(JSON.parse(request.body).messages[1].content);
  assert.deepEqual(Object.keys(prompt).sort(), [
    "as_of", "documents", "instruction", "required_count", "required_evidence_ids", "underlying",
  ]);
  assert.equal(JSON.stringify(prompt).includes("quantity"), false);
});

test("evidence assessment rejects ID substitution, extra fields, and out-of-range scores", () => {
  const evidenceId = documents[0].record.evidence_id;
  const valid = {
    schema_version: "evidence_assessment.v1",
    assessments: [{
      evidence_id: evidenceId,
      direction_score: 0,
      volatility_score: 0,
      rationale: "The document is directionally neutral for this horizon.",
    }],
  };
  assert.equal(validateEvidenceAssessment(valid, [evidenceId]), valid);
  assert.throws(
    () => validateEvidenceAssessment({ ...valid, assessments: [{ ...valid.assessments[0], evidence_id: `sha256:${"0".repeat(64)}` }] }, [evidenceId]),
    /IDs differ/,
  );
  assert.throws(
    () => validateEvidenceAssessment({ ...valid, assessments: [{ ...valid.assessments[0], quantity: 100 }] }, [evidenceId]),
    /unknown fields/,
  );
  assert.throws(
    () => validateEvidenceAssessment({ ...valid, assessments: [{ ...valid.assessments[0], direction_score: 1.1 }] }, [evidenceId]),
    /\[-1, 1\]/,
  );
  assert.throws(
    () => validateEvidenceAssessment({ ...valid, assessments: [{ ...valid.assessments[0], rationale: "Replace this example with a placeholder." }] }, [evidenceId]),
    /analyze the supplied evidence/,
  );
});

test("evidence extractor rejects remote endpoints and unavailable future evidence", async () => {
  assert.throws(
    () => new LocalLlamaEvidenceExtractor({ baseUrl: "https://example.com/v1" }),
    /only loopback HTTP endpoints/,
  );
  const extractor = new LocalLlamaEvidenceExtractor({
    fetchImpl: async () => { throw new Error("fetch should not be reached"); },
  });
  await assert.rejects(
    () => extractor.assessDocuments(documents, { underlying: "SPY", asOf: "2026-08-27T12:00:00.000Z" }),
    /not available at decision time/,
  );
  await assert.rejects(
    () => extractor.assessDocuments([{ ...documents[0], text: `${documents[0].text} tampered` }], {
      underlying: "SPY",
      asOf: fixture.decision_time,
    }),
    /differs from the canonical content hash/,
  );
});
