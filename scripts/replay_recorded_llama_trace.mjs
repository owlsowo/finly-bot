import { mkdir, readFile, writeFile } from "node:fs/promises";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { validateEvidenceAssessment } from "../lib/evidence_extractor.mjs";
import {
  applyEvidenceAssessment,
  buildBoundEvidenceDocuments,
  buildTraceRequests,
  plannerOptionsForFixture,
  summarizeCompiler,
  verifyLlamaDecisionTrace,
} from "../lib/llama_decision_trace.mjs";
import { runDecision } from "../lib/pipeline.mjs";
import { aggregateSignals } from "../lib/signals.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/spy_llama_negative_control.json", import.meta.url), "utf8"),
);
const traceUrl = new URL("../evidence/llama_decision_trace.json", import.meta.url);
const recordedTrace = JSON.parse(await readFile(traceUrl, "utf8"));

const evidenceDocuments = buildBoundEvidenceDocuments(fixture);
const evidenceIds = evidenceDocuments.map(({ record }) => record.evidence_id);
validateEvidenceAssessment(recordedTrace.evidence_assessment, evidenceIds);

const assessedSignals = applyEvidenceAssessment(fixture, recordedTrace.evidence_assessment);
const plannerOptions = plannerOptionsForFixture(fixture);
const deterministicIntent = aggregateSignals(assessedSignals, plannerOptions);
if (stableStringify(recordedTrace.llama_schema_echo) !== stableStringify(deterministicIntent)) {
  throw new Error("recorded Llama schema echo differs from the current deterministic intent");
}

const requests = buildTraceRequests({
  fixture,
  evidenceDocuments,
  assessedSignals,
  deterministicIntent,
  plannerOptions,
});
if (stableStringify(recordedTrace.requests) !== stableStringify(requests)) {
  throw new Error("recorded Llama request bindings differ from deterministic reconstruction");
}

const assessedFixture = {
  ...fixture,
  run_id: recordedTrace.fixture.run_id,
  signals: assessedSignals,
};
const receipt = await runDecision({
  fixture: assessedFixture,
  planner: { async proposeIntent() { return deterministicIntent; } },
});

const recordedBody = structuredClone(recordedTrace);
delete recordedBody.trace_id;
const traceBody = {
  ...recordedBody,
  created_at: new Date().toISOString(),
  deterministic_intent: deterministicIntent,
  deterministic_compiler: summarizeCompiler(receipt),
  receipt_sha256: receipt.receipt_id,
  requests,
};
const trace = { ...traceBody, trace_id: sha256(traceBody) };
await verifyLlamaDecisionTrace(trace, fixture);

const serialized = `${stableStringify(trace)}\n`;
const traceUrls = [
  traceUrl,
  new URL("../public/data/llama_decision_trace.json", import.meta.url),
  new URL("../src/data/llama_decision_trace.json", import.meta.url),
];
for (const destination of traceUrls) {
  await mkdir(new URL("./", destination), { recursive: true });
  await writeFile(destination, serialized, { mode: 0o644 });
}

process.stdout.write(`${stableStringify({
  status: "PASS",
  mode: "recorded_model_output_replay",
  trace_id: trace.trace_id,
  receipt_sha256: trace.receipt_sha256,
  decision: trace.deterministic_compiler.decision,
  mutation_requested: false,
})}\n`);
