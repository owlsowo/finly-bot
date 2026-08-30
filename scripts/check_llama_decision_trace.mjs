import { readFile } from "node:fs/promises";
import { stableStringify } from "../lib/canonical.mjs";
import { assertTraceCopiesEqual, verifyLlamaDecisionTrace } from "../lib/llama_decision_trace.mjs";

const traceUrls = [
  new URL("../evidence/llama_decision_trace.json", import.meta.url),
  new URL("../public/data/llama_decision_trace.json", import.meta.url),
  new URL("../src/data/llama_decision_trace.json", import.meta.url),
];
const serializedCopies = await Promise.all(traceUrls.map((traceUrl) => readFile(traceUrl, "utf8")));
const trace = assertTraceCopiesEqual(serializedCopies);
const fixture = JSON.parse(
  await readFile(new URL("../fixtures/spy_llama_negative_control.json", import.meta.url), "utf8"),
);
await verifyLlamaDecisionTrace(trace, fixture);

process.stdout.write(`${stableStringify({
  status: "PASS",
  schema_version: trace.schema_version,
  model: trace.model,
  trace_id: trace.trace_id,
  direction: trace.deterministic_intent.direction,
  decision: trace.deterministic_compiler.decision,
  mutation_requested: trace.deterministic_compiler.mutation_requested,
  copies_verified: serializedCopies.length,
})}\n`);
