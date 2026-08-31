import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FeatherlessEvidenceExtractor, validateEvidenceAssessment } from "../lib/evidence_extractor.mjs";
import { createCanonicalEvidenceRecord } from "../lib/live_signals.mjs";

const FIXTURE_TEXT = "A scheduled macroeconomic release is expected tomorrow; this is a synthetic connectivity fixture.";

export function buildFeatherlessReadinessDocument(now = new Date()) {
  const observedAt = new Date(now).toISOString();
  const record = createCanonicalEvidenceRecord({
    family: "events",
    underlying: "SPY",
    sourceKind: "synthetic_fixture",
    sourceUri: "urn:finly:featherless-readiness",
    originId: "finly.featherless.readiness.v1",
    publishedAt: observedAt,
    receivedAt: observedAt,
    content: FIXTURE_TEXT,
  });
  return { record, text: FIXTURE_TEXT, asOf: observedAt };
}

export async function runFeatherlessReadinessCheck({
  extractor = new FeatherlessEvidenceExtractor(),
  now = new Date(),
} = {}) {
  const { record, text, asOf } = buildFeatherlessReadinessDocument(now);
  const result = validateEvidenceAssessment(
    await extractor.assessDocuments([{ record, text }], { underlying: "SPY", asOf }),
    [record.evidence_id],
  );
  if (result.schema_version !== "evidence_assessment.v1"
    || result.assessments.length !== 1
    || result.assessments[0].evidence_id !== record.evidence_id) {
    throw new Error("hosted evidence readiness response differs from the exact fixture contract");
  }
  return { status: "HOSTED_EVIDENCE_READY", model: "NousResearch/Hermes-4-14B" };
}

async function main() {
  await runFeatherlessReadinessCheck();
  process.stdout.write('{"status":"HOSTED_EVIDENCE_READY","model":"NousResearch/Hermes-4-14B"}\n');
}

function readinessFailureCode(error) {
  const message = String(error?.message ?? "");
  const httpStatus = message.match(/HTTP ([1-5][0-9]{2})$/u)?.[1];
  if (httpStatus) return `HTTP_${httpStatus}`;
  if (message === "Featherless evidence response model differs from the requested model") {
    return "MODEL_MISMATCH";
  }
  if (message.includes("response is missing or oversized")) return "RESPONSE_SHAPE";
  if (error instanceof SyntaxError) return "RESPONSE_JSON";
  if (message.startsWith("evidence assessment contains")) return "ASSESSMENT_TOP_LEVEL_KEYS";
  if (message === "unsupported evidence assessment schema") return "ASSESSMENT_VERSION";
  if (message === "evidence assessment count differs from request") return "ASSESSMENT_COUNT";
  if (message === "assessment row must be an object") return "ASSESSMENT_ROW_SHAPE";
  if (message.startsWith("assessment row contains")) return "ASSESSMENT_ROW_KEYS";
  if (message === "assessment evidence IDs differ from request") return "ASSESSMENT_IDS";
  if (message.startsWith("direction_score") || message.startsWith("volatility_score")) return "ASSESSMENT_SCORES";
  if (message.startsWith("assessment rationale")) return "ASSESSMENT_RATIONALE";
  return "INTEGRATION_FAILURE";
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`Finly hosted evidence readiness check failed safely (${readinessFailureCode(error)}).\n`);
    process.exitCode = 1;
  });
}
