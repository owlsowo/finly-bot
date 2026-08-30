import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { assertTraceCopiesEqual, verifyLlamaDecisionTrace } from "../lib/llama_decision_trace.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/spy_llama_negative_control.json", import.meta.url), "utf8"),
);
const serializedCopies = await Promise.all([
  new URL("../evidence/llama_decision_trace.json", import.meta.url),
  new URL("../public/data/llama_decision_trace.json", import.meta.url),
  new URL("../src/data/llama_decision_trace.json", import.meta.url),
].map((traceUrl) => readFile(traceUrl, "utf8")));
const checkedTrace = JSON.parse(serializedCopies[0]);

function rehash(trace) {
  const body = structuredClone(trace);
  delete body.trace_id;
  return { ...body, trace_id: sha256(body) };
}

test("v2 Llama trace copies are byte-identical, canonical, and semantically reconstructable", async () => {
  const trace = assertTraceCopiesEqual(serializedCopies);
  const result = await verifyLlamaDecisionTrace(trace, fixture);
  assert.equal(result.trace_id, trace.trace_id);
  assert.equal(result.receipt.certificate.decision, "NO_TRADE");
  assert.equal(trace.deterministic_intent.direction, "bearish");
  assert.deepEqual(trace.llama_schema_echo, trace.deterministic_intent);
});

test("v2 Llama trace rejects rehashed semantic forgeries", async () => {
  const forgeries = [
    {
      label: "compiler decision",
      pattern: /deterministic compiler/,
      mutate(trace) { trace.deterministic_compiler.decision = "TRADE"; },
    },
    {
      label: "authorized loss",
      pattern: /deterministic compiler/,
      mutate(trace) { trace.deterministic_compiler.authorized_maximum_loss = 999_999; },
    },
    {
      label: "nested order payload",
      pattern: /missing or unknown fields/,
      mutate(trace) { trace.deterministic_compiler.order = { side: "buy", qty: 999 }; },
    },
    {
      label: "out-of-range active weight",
      pattern: /active_weight/,
      mutate(trace) { trace.deterministic_intent.active_weight = 999; },
    },
    {
      label: "empty source families",
      pattern: /source families/,
      mutate(trace) { trace.deterministic_intent.source_families = []; },
    },
    {
      label: "unbound assessed text",
      pattern: /text hash|canonical record|deterministic reconstruction/,
      mutate(trace) {
        trace.requests.evidence_documents[0].text += " tampered";
        trace.requests.evidence_documents[0].text_sha256 = sha256(trace.requests.evidence_documents[0].text);
      },
    },
    {
      label: "assessment score",
      pattern: /assessed-signals hash|deterministic intent/,
      mutate(trace) { trace.evidence_assessment.assessments[0].direction_score = -0.5; },
    },
    {
      label: "receipt hash",
      pattern: /receipt hash/,
      mutate(trace) { trace.receipt_sha256 = `sha256:${"0".repeat(64)}`; },
    },
    {
      label: "model manifest digest",
      pattern: /manifest digest/,
      mutate(trace) { trace.model_runtime.manifest_digest = "mutable-tag-only"; },
    },
  ];
  for (const forgery of forgeries) {
    const trace = structuredClone(checkedTrace);
    forgery.mutate(trace);
    await assert.rejects(
      () => verifyLlamaDecisionTrace(rehash(trace), fixture),
      forgery.pattern,
      forgery.label,
    );
  }
});

test("v2 Llama trace rejects copy divergence and noncanonical serialization", () => {
  assert.throws(
    () => assertTraceCopiesEqual([serializedCopies[0], serializedCopies[1], `${serializedCopies[2]} `]),
    /copies differ/,
  );
  const pretty = `${JSON.stringify(checkedTrace, null, 2)}\n`;
  assert.throws(() => assertTraceCopiesEqual([pretty, pretty, pretty]), /not canonical JSON/);
  assert.equal(serializedCopies[0], `${stableStringify(checkedTrace)}\n`);
});
