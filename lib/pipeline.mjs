import { buildMlegPayload } from "./alpaca.mjs";
import { id, redactSecrets, sha256 } from "./canonical.mjs";
import { POLICY } from "./policy.mjs";
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
    policyHash: sha256(POLICY),
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
    certificate,
    alpaca_payload: payload,
    disclaimer: "Educational paper-trading prototype. Not investment advice. Replay results and paper fills do not establish durable alpha.",
  };
  const redactedReceipt = redactSecrets(receipt);
  return { ...redactedReceipt, receipt_id: sha256(redactedReceipt) };
}
