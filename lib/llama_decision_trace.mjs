import { sha256, stableStringify } from "./canonical.mjs";
import { validateEvidenceAssessment } from "./evidence_extractor.mjs";
import { runDecision } from "./pipeline.mjs";
import { validateIntent } from "./schema.mjs";
import { aggregateSignals } from "./signals.mjs";

export const LLAMA_TRACE_SCHEMA_VERSION = "llama_decision_trace.v2";
export const LLAMA_TRACE_RUN_ID = "decision_demo_spy_llama_20260828_183005";
export const LLAMA_TRACE_INPUT_DISCLOSURE = "One canonical synthetic event document was assessed. The schema-echo call received four synthetic signal summaries and a deterministic intent. No live market, news, account, or broker data was used.";
export const LLAMA_TRACE_AUTHORITY_BOUNDARY = Object.freeze({
  model_may_output: Object.freeze([
    "bounded evidence assessment",
    "schema echo of deterministic intent",
  ]),
  deterministic_code_owns: Object.freeze([
    "intent aggregation",
    "contract",
    "symbol",
    "strike",
    "expiry",
    "quantity",
    "price",
    "maximum loss",
    "broker arguments",
    "execution permit",
  ]),
});

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const TRACE_KEYS = [
  "authority_boundary",
  "created_at",
  "data_mode",
  "deterministic_compiler",
  "deterministic_intent",
  "endpoint_scope",
  "evidence_assessment",
  "fixture",
  "input_disclosure",
  "llama_schema_echo",
  "model",
  "model_calls",
  "model_runtime",
  "receipt_sha256",
  "requests",
  "schema_version",
  "trace_id",
];
const FIXTURE_KEYS = ["decision_time", "fixture_sha256", "horizon_sessions", "run_id", "underlying"];
const REQUEST_KEYS = [
  "assessed_signals_sha256",
  "evidence_documents",
  "evidence_input_sha256",
  "planner_options",
  "schema_echo_input_sha256",
];
const DOCUMENT_KEYS = ["record", "text", "text_sha256"];
const MODEL_CALLS_KEYS = ["evidence_assessment", "schema_echo"];
const MODEL_CALL_KEYS = ["created", "response_id", "response_model"];
const MODEL_RUNTIME_KEYS = ["manifest_digest", "ollama_version", "provider"];
const COMPILER_KEYS = [
  "authorization_scope",
  "authorized_maximum_loss",
  "candidate_maximum_gain",
  "candidate_maximum_loss",
  "candidate_structure",
  "decision",
  "mutation_requested",
  "order_projection",
  "perturbations_passed",
  "source_removals_passed",
];

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${label} contains missing or unknown fields`,
  );
}

function exactValue(actual, expected, label) {
  assert(stableStringify(actual) === stableStringify(expected), `${label} differs from deterministic reconstruction`);
}

function validHash(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function validateModelCall(call, model, label) {
  exactKeys(call, MODEL_CALL_KEYS, label);
  assert(call.response_model === model, `${label} response model differs from the requested model`);
  assert(typeof call.response_id === "string" && call.response_id.length >= 8, `${label} response ID is missing`);
  assert(Number.isInteger(call.created) && call.created > 0, `${label} response timestamp is invalid`);
}

export async function readOllamaRuntimeIdentity(baseUrl, model, fetchImpl = fetch) {
  const parsed = new URL(baseUrl);
  assert(parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname), "Ollama runtime identity endpoint is not loopback-only");
  const origin = parsed.origin;
  const requestOptions = { redirect: "error", signal: AbortSignal.timeout(5_000) };
  const [versionResponse, tagsResponse] = await Promise.all([
    fetchImpl(`${origin}/api/version`, requestOptions),
    fetchImpl(`${origin}/api/tags`, requestOptions),
  ]);
  assert(versionResponse.ok && tagsResponse.ok, "Ollama runtime identity request failed");
  const [versionBody, tagsBody] = await Promise.all([versionResponse.json(), tagsResponse.json()]);
  const listedModel = Array.isArray(tagsBody.models)
    ? tagsBody.models.find((entry) => entry?.name === model || entry?.model === model)
    : null;
  assert(listedModel && typeof listedModel.digest === "string", "requested Ollama model is not installed");
  const digest = listedModel.digest.startsWith("sha256:") ? listedModel.digest : `sha256:${listedModel.digest}`;
  assert(/^sha256:[a-f0-9]{64}$/.test(digest), "Ollama model manifest digest is invalid");
  assert(typeof versionBody.version === "string" && /^\d+\.\d+\.\d+/.test(versionBody.version), "Ollama version is invalid");
  return {
    provider: "ollama",
    ollama_version: versionBody.version,
    manifest_digest: digest,
  };
}

export function buildBoundEvidenceDocuments(fixture) {
  const eventSignal = fixture.signals.find((signal) => signal.family === "events");
  assert(eventSignal, "fixture has no event evidence");
  assert(typeof eventSignal.explanation === "string", "fixture event explanation is missing");
  const textSha256 = sha256(eventSignal.explanation);
  return eventSignal.evidence.map((record) => {
    assert(record.content_sha256 === textSha256, "fixture event text differs from the canonical content hash");
    return { record, text: eventSignal.explanation, text_sha256: textSha256 };
  });
}

export function applyEvidenceAssessment(fixture, assessment) {
  const eventSignal = fixture.signals.find((signal) => signal.family === "events");
  assert(eventSignal && eventSignal.evidence.length === 1, "Llama decision control requires exactly one event evidence record");
  const evidenceId = eventSignal.evidence[0].evidence_id;
  const eventAssessment = assessment.assessments.find((row) => row.evidence_id === evidenceId);
  assert(eventAssessment, "Llama assessment omitted the fixture event evidence");
  return fixture.signals.map((signal) => (
    signal.family === "events"
      ? {
          ...signal,
          direction_score: eventAssessment.direction_score,
          volatility_score: eventAssessment.volatility_score,
          explanation: `Local Llama assessment: ${eventAssessment.rationale}`,
        }
      : signal
  ));
}

export function plannerOptionsForFixture(fixture) {
  return {
    underlying: fixture.market.underlying,
    horizonSessions: fixture.horizon_sessions,
    asOf: fixture.decision_time,
  };
}

export function summarizeCompiler(receipt) {
  const selected = receipt.compilation.selected;
  const structure = selected?.long_leg.type === "put" ? "bear-put" : "bull-call";
  return {
    decision: receipt.certificate.decision,
    candidate_structure: selected
      ? `${selected.underlying} ${selected.long_leg.strike}/${selected.short_leg.strike} ${structure} debit spread`
      : null,
    candidate_maximum_loss: selected?.max_loss ?? null,
    candidate_maximum_gain: selected?.max_gain ?? null,
    authorized_maximum_loss: receipt.certificate.reserved_max_loss,
    source_removals_passed: receipt.source_removal.passed,
    perturbations_passed: receipt.perturbations?.passed ?? false,
    authorization_scope: receipt.certificate.authorization_scope,
    order_projection: receipt.alpaca_payload ? "synthetic_projection_only" : "null",
    mutation_requested: false,
  };
}

export function buildTraceRequests({ fixture, evidenceDocuments, assessedSignals, deterministicIntent, plannerOptions }) {
  const modelDocuments = evidenceDocuments.map(({ record, text }) => ({ record, text }));
  const evidenceInput = {
    underlying: fixture.market.underlying,
    as_of: fixture.decision_time,
    documents: modelDocuments,
  };
  const schemaEchoInput = {
    signals: assessedSignals,
    options: plannerOptions,
    deterministic_intent: deterministicIntent,
  };
  return {
    evidence_documents: evidenceDocuments,
    evidence_input_sha256: sha256(evidenceInput),
    assessed_signals_sha256: sha256(assessedSignals),
    planner_options: plannerOptions,
    schema_echo_input_sha256: sha256(schemaEchoInput),
  };
}

export async function verifyLlamaDecisionTrace(trace, fixture) {
  exactKeys(trace, TRACE_KEYS, "Llama decision trace");
  assert(trace.schema_version === LLAMA_TRACE_SCHEMA_VERSION, "unsupported Llama decision trace schema");
  assert(Number.isFinite(new Date(trace.created_at).getTime()), "Llama trace created_at is invalid");
  assert(trace.endpoint_scope === "loopback_only", "Llama trace is not loopback-only");
  assert(trace.data_mode === "synthetic_replay", "Llama trace is not labeled synthetic");
  assert(typeof trace.model === "string" && trace.model.toLowerCase().includes("llama"), "Llama model is missing");
  assert(trace.input_disclosure === LLAMA_TRACE_INPUT_DISCLOSURE, "Llama trace input disclosure is invalid");
  exactValue(trace.authority_boundary, LLAMA_TRACE_AUTHORITY_BOUNDARY, "Llama authority boundary");

  exactKeys(trace.fixture, FIXTURE_KEYS, "Llama trace fixture");
  const expectedFixture = {
    run_id: LLAMA_TRACE_RUN_ID,
    decision_time: fixture.decision_time,
    underlying: fixture.market.underlying,
    horizon_sessions: fixture.horizon_sessions,
    fixture_sha256: sha256(fixture),
  };
  exactValue(trace.fixture, expectedFixture, "Llama trace fixture");

  exactKeys(trace.model_calls, MODEL_CALLS_KEYS, "Llama model calls");
  validateModelCall(trace.model_calls.evidence_assessment, trace.model, "evidence-assessment call");
  validateModelCall(trace.model_calls.schema_echo, trace.model, "schema-echo call");
  const traceCreatedSeconds = Math.floor(new Date(trace.created_at).getTime() / 1_000);
  assert(
    trace.model_calls.evidence_assessment.created <= trace.model_calls.schema_echo.created
      && trace.model_calls.schema_echo.created <= traceCreatedSeconds,
    "Llama model-call timestamps are causally invalid",
  );
  exactKeys(trace.model_runtime, MODEL_RUNTIME_KEYS, "Llama model runtime");
  assert(trace.model_runtime.provider === "ollama", "Llama trace provider is not Ollama");
  assert(/^\d+\.\d+\.\d+/.test(trace.model_runtime.ollama_version), "Llama trace Ollama version is invalid");
  assert(/^sha256:[a-f0-9]{64}$/.test(trace.model_runtime.manifest_digest), "Llama trace model manifest digest is invalid");

  exactKeys(trace.requests, REQUEST_KEYS, "Llama trace requests");
  assert(Array.isArray(trace.requests.evidence_documents), "Llama evidence documents must be an array");
  for (const document of trace.requests.evidence_documents) {
    exactKeys(document, DOCUMENT_KEYS, "Llama evidence document");
    assert(document.text_sha256 === sha256(document.text), "Llama evidence text hash mismatch");
    assert(document.record.content_sha256 === document.text_sha256, "Llama evidence text is not bound to its canonical record");
  }
  const expectedDocuments = buildBoundEvidenceDocuments(fixture);
  exactValue(trace.requests.evidence_documents, expectedDocuments, "Llama evidence documents");
  const modelDocuments = expectedDocuments.map(({ record, text }) => ({ record, text }));
  const expectedEvidenceInput = {
    underlying: fixture.market.underlying,
    as_of: fixture.decision_time,
    documents: modelDocuments,
  };
  assert(trace.requests.evidence_input_sha256 === sha256(expectedEvidenceInput), "Llama evidence input hash mismatch");

  const expectedIds = expectedDocuments.map(({ record }) => record.evidence_id);
  validateEvidenceAssessment(trace.evidence_assessment, expectedIds);
  const assessedSignals = applyEvidenceAssessment(fixture, trace.evidence_assessment);
  assert(trace.requests.assessed_signals_sha256 === sha256(assessedSignals), "Llama assessed-signals hash mismatch");
  const plannerOptions = plannerOptionsForFixture(fixture);
  exactValue(trace.requests.planner_options, plannerOptions, "Llama planner options");

  const deterministicIntent = aggregateSignals(assessedSignals, plannerOptions);
  validateIntent(trace.deterministic_intent);
  exactValue(trace.deterministic_intent, deterministicIntent, "deterministic intent");
  validateIntent(trace.llama_schema_echo);
  exactValue(trace.llama_schema_echo, deterministicIntent, "Llama schema echo");
  const expectedSchemaEchoInput = {
    signals: assessedSignals,
    options: plannerOptions,
    deterministic_intent: deterministicIntent,
  };
  assert(trace.requests.schema_echo_input_sha256 === sha256(expectedSchemaEchoInput), "Llama schema-echo input hash mismatch");

  const assessedFixture = {
    ...fixture,
    run_id: LLAMA_TRACE_RUN_ID,
    signals: assessedSignals,
  };
  const receipt = await runDecision({
    fixture: assessedFixture,
    planner: { async proposeIntent() { return deterministicIntent; } },
  });
  assert(trace.receipt_sha256 === receipt.receipt_id, "Llama trace receipt hash mismatch");
  exactKeys(trace.deterministic_compiler, COMPILER_KEYS, "Llama deterministic compiler");
  exactValue(trace.deterministic_compiler, summarizeCompiler(receipt), "Llama deterministic compiler");
  assert(trace.deterministic_compiler.decision === "NO_TRADE", "Llama negative control did not end in NO_TRADE");
  assert(
    !(trace.deterministic_compiler.source_removals_passed && trace.deterministic_compiler.perturbations_passed),
    "Llama challenge suite unexpectedly passed",
  );
  assert(trace.deterministic_compiler.perturbations_passed === false, "Llama perturbation gate unexpectedly passed");
  assert(trace.deterministic_compiler.authorized_maximum_loss === 0, "Llama negative control authorized loss");
  assert(trace.deterministic_compiler.authorization_scope === "synthetic_replay", "Llama authorization scope is invalid");
  assert(trace.deterministic_compiler.order_projection === "null", "Llama negative control contains an order projection");
  assert(trace.deterministic_compiler.mutation_requested === false, "Llama negative control requested mutation");

  assert(validHash(trace.receipt_sha256), "Llama receipt hash is invalid");
  const { trace_id: traceId, ...traceBody } = trace;
  assert(validHash(traceId) && sha256(traceBody) === traceId, "Llama decision trace hash mismatch");
  const serialized = stableStringify(trace);
  assert(!/APCA-|secret|api[_-]?key|buying_power|portfolio_value|"cash"/i.test(serialized), "trace contains sensitive account data");
  return { trace_id: traceId, receipt, assessedSignals };
}

export function assertTraceCopiesEqual(serializedCopies) {
  assert(Array.isArray(serializedCopies) && serializedCopies.length === 3, "exactly three Llama trace copies are required");
  assert(serializedCopies.every((copy) => typeof copy === "string"), "Llama trace copy must be serialized text");
  assert(serializedCopies.every((copy) => copy === serializedCopies[0]), "Llama trace copies differ");
  const parsed = JSON.parse(serializedCopies[0]);
  assert(serializedCopies[0] === `${stableStringify(parsed)}\n`, "Llama trace is not canonical JSON");
  return parsed;
}
