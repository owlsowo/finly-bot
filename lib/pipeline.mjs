import { buildMlegPayload } from "./alpaca.mjs";
import { id, redactSecrets, sha256 } from "./canonical.mjs";
import {
  LIVE_ALPHA_CONFIDENCE_POLICY,
  LIVE_EXECUTION_SAFETY_POLICY,
  POLICY,
} from "./policy.mjs";
import { createRiskCertificate, SYNTHETIC_REPLAY_SIGNING_SECRET } from "./risk.mjs";
import { runStabilityGate } from "./stability.mjs";

export async function runDecision({
  fixture,
  planner,
  now = fixture.decision_time,
  signingSecret = SYNTHETIC_REPLAY_SIGNING_SECRET,
  certificateScope = "synthetic_replay",
  economicDirectionAuthority = null,
}) {
  if (certificateScope === "paper_submit" && fixture.data_mode === "synthetic_replay") {
    throw new Error("synthetic replay cannot mint a paper-submit certificate");
  }
  const runId = fixture.run_id ?? id("decision");
  const intentOptions = {
    underlying: fixture.market.underlying,
    horizonSessions: fixture.horizon_sessions,
    asOf: now,
    economicDirectionAuthority,
    ...(certificateScope === "paper_submit" ? {
      maxLossBudget: Math.min(
        fixture.account.equity * POLICY.riskPerTradeFraction,
        POLICY.riskPerTradeDollarCap,
      ),
      alphaPolicy: LIVE_ALPHA_CONFIDENCE_POLICY,
      allowNeutralSourceRemoval: true,
      liveAlphaDiagnostics: true,
    } : {}),
  };
  const intent = await planner.proposeIntent(fixture.signals, intentOptions);
  const stability = runStabilityGate(fixture.signals, fixture.option_chain, fixture.market, intentOptions);
  if (sha256(intent) !== sha256(stability.base_intent)) throw new Error("planner intent differs from deterministic evidence aggregation");
  const certificate = createRiskCertificate({
    runId,
    createdAt: now,
    stability,
    account: fixture.account,
    market: fixture.market,
    policyHash: certificateScope === "paper_submit"
      ? sha256({
          base_policy: POLICY,
          live_alpha_confidence: LIVE_ALPHA_CONFIDENCE_POLICY,
          live_execution_safety: LIVE_EXECUTION_SAFETY_POLICY,
        })
      : sha256(POLICY),
    codeVersion: fixture.code_version ?? "working-tree",
    signingSecret,
    authorizationScope: certificateScope,
    dataMode: fixture.data_mode,
  });
  const payload = certificate.certified
    ? buildMlegPayload(stability.compilation.selected, certificate, {
      signingSecret,
      requiredScope: certificateScope,
      now,
      enforceFreshness: true,
    })
    : null;
  const receipt = {
    schema_version: "decision_receipt.v1",
    run_id: runId,
    created_at: now,
    mode: fixture.account.mode,
    data_mode: fixture.data_mode,
    market: fixture.market,
    intent,
    ...(economicDirectionAuthority ? { economic_direction_authority: economicDirectionAuthority } : {}),
    source_signals: fixture.signals,
    option_chain_hash: sha256(fixture.option_chain),
    compilation: stability.compilation,
    source_removal: stability.source_removal,
    perturbations: stability.perturbations,
    ...(certificateScope === "paper_submit" ? {
      sanitized_decision_diagnostics: buildSanitizedDecisionDiagnostics(stability, certificate),
    } : {}),
    certificate,
    alpaca_payload: payload,
    disclaimer: "Educational paper-trading prototype. Not investment advice. Replay results and paper fills do not establish durable alpha.",
  };
  const redactedReceipt = redactSecrets(receipt);
  return { ...redactedReceipt, receipt_id: sha256(redactedReceipt) };
}

function buildSanitizedDecisionDiagnostics(stability, certificate) {
  const rejectionCounts = {};
  for (const row of stability.compilation.rejected ?? []) {
    const code = row.code ?? "UNLABELED_REJECTION";
    rejectionCounts[code] = (rejectionCounts[code] ?? 0) + 1;
  }
  for (const candidate of stability.compilation.candidates ?? []) {
    if (!candidate.passes_ev) rejectionCounts.CONSERVATIVE_EV = (rejectionCounts.CONSERVATIVE_EV ?? 0) + 1;
    if (!candidate.passes_probability) rejectionCounts.PROBABILITY_OF_PROFIT = (rejectionCounts.PROBABILITY_OF_PROFIT ?? 0) + 1;
  }
  const blocking = certificate.certified
    ? []
    : certificate.rejection_codes.length > 0
      ? certificate.rejection_codes
      : [stability.compilation.reason ?? "NO_CANDIDATE"];
  return Object.freeze({
    schema_version: "finly_sanitized_decision_diagnostics.v1",
    evaluated_candidate_count: stability.compilation.candidates?.length ?? 0,
    compiler_rejection_counts: Object.freeze(Object.fromEntries(
      Object.entries(rejectionCounts).sort(([left], [right]) => left.localeCompare(right)),
    )),
    alpha_confidence: Object.freeze({
      source_removal_passed: stability.source_removal?.passed === true,
      perturbations_passed: stability.perturbations?.passed === true,
    }),
    hard_safety_blocking_reason_codes: Object.freeze([...blocking].sort()),
  });
}
