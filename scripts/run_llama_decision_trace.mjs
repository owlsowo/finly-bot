import { mkdir, readFile, writeFile } from "node:fs/promises";
import { LocalLlamaPlanner } from "../lib/agent.mjs";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { LocalLlamaEvidenceExtractor } from "../lib/evidence_extractor.mjs";
import {
  LLAMA_TRACE_AUTHORITY_BOUNDARY,
  LLAMA_TRACE_INPUT_DISCLOSURE,
  LLAMA_TRACE_RUN_ID,
  LLAMA_TRACE_SCHEMA_VERSION,
  applyEvidenceAssessment,
  buildBoundEvidenceDocuments,
  buildTraceRequests,
  plannerOptionsForFixture,
  readOllamaRuntimeIdentity,
  summarizeCompiler,
  verifyLlamaDecisionTrace,
} from "../lib/llama_decision_trace.mjs";
import { runDecision } from "../lib/pipeline.mjs";
import { aggregateSignals } from "../lib/signals.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/spy_llama_negative_control.json", import.meta.url), "utf8"),
);
const evidenceDocuments = buildBoundEvidenceDocuments(fixture);
const modelDocuments = evidenceDocuments.map(({ record, text }) => ({ record, text }));

const extractor = new LocalLlamaEvidenceExtractor();
const evidenceAssessment = await extractor.assessDocuments(modelDocuments, {
  underlying: fixture.market.underlying,
  asOf: fixture.decision_time,
});
const assessedSignals = applyEvidenceAssessment(fixture, evidenceAssessment);
const plannerOptions = plannerOptionsForFixture(fixture);
const deterministicIntent = aggregateSignals(assessedSignals, plannerOptions);

const planner = new LocalLlamaPlanner();
const llamaSchemaEcho = await planner.proposeIntent(assessedSignals, plannerOptions);
const modelRuntime = await readOllamaRuntimeIdentity(planner.baseUrl, planner.model);
const assessedFixture = {
  ...fixture,
  run_id: LLAMA_TRACE_RUN_ID,
  signals: assessedSignals,
};
const receipt = await runDecision({
  fixture: assessedFixture,
  planner: { async proposeIntent() { return deterministicIntent; } },
});

const traceBody = {
  schema_version: LLAMA_TRACE_SCHEMA_VERSION,
  created_at: new Date().toISOString(),
  model: planner.model,
  endpoint_scope: "loopback_only",
  data_mode: fixture.data_mode,
  input_disclosure: LLAMA_TRACE_INPUT_DISCLOSURE,
  authority_boundary: LLAMA_TRACE_AUTHORITY_BOUNDARY,
  fixture: {
    run_id: LLAMA_TRACE_RUN_ID,
    decision_time: fixture.decision_time,
    underlying: fixture.market.underlying,
    horizon_sessions: fixture.horizon_sessions,
    fixture_sha256: sha256(fixture),
  },
  model_calls: {
    evidence_assessment: extractor.lastResponseMetadata,
    schema_echo: planner.lastResponseMetadata,
  },
  model_runtime: modelRuntime,
  requests: buildTraceRequests({
    fixture,
    evidenceDocuments,
    assessedSignals,
    deterministicIntent,
    plannerOptions,
  }),
  evidence_assessment: evidenceAssessment,
  deterministic_intent: deterministicIntent,
  llama_schema_echo: llamaSchemaEcho,
  deterministic_compiler: summarizeCompiler(receipt),
  receipt_sha256: receipt.receipt_id,
};
const trace = { ...traceBody, trace_id: sha256(traceBody) };
await verifyLlamaDecisionTrace(trace, fixture);
const serialized = `${stableStringify(trace)}\n`;

const traceUrls = [
  new URL("../evidence/llama_decision_trace.json", import.meta.url),
  new URL("../public/data/llama_decision_trace.json", import.meta.url),
  new URL("../src/data/llama_decision_trace.json", import.meta.url),
];
for (const traceUrl of traceUrls) {
  await mkdir(new URL("./", traceUrl), { recursive: true });
  await writeFile(traceUrl, serialized);
}
process.stdout.write(`${stableStringify({
  status: "PASS",
  schema_version: trace.schema_version,
  model: planner.model,
  trace_id: trace.trace_id,
  direction: deterministicIntent.direction,
  decision: receipt.certificate.decision,
  mutation_requested: false,
})}\n`);
