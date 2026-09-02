import { createHmac, timingSafeEqual } from "node:crypto";
import { stableStringify, sha256 } from "./canonical.mjs";
import { orderProjectionHash } from "./order_projection.mjs";
import { LIVE_EXECUTION_SAFETY_POLICY, POLICY } from "./policy.mjs";

// This key can authenticate published synthetic fixtures only. The executor
// rejects its scope. Real paper permits require a separate local 32+ byte key.
export const SYNTHETIC_REPLAY_SIGNING_SECRET = "finly-synthetic-replay-only-v1-not-an-execution-key";

function assertSigningSecret(signingSecret) {
  if (typeof signingSecret !== "string" || Buffer.byteLength(signingSecret) < 32) {
    throw new Error("certificate signing secret must be at least 32 bytes");
  }
}

function signatureFor(body, signingSecret) {
  assertSigningSecret(signingSecret);
  return `hmac-sha256:${createHmac("sha256", signingSecret).update(stableStringify(body)).digest("hex")}`;
}

export function calculateQuantity(candidate, account, {
  halfRisk = false,
  maximumContracts = POLICY.maxContracts,
} = {}) {
  if (!Number.isInteger(maximumContracts) || maximumContracts < 1 || maximumContracts > POLICY.maxContracts) {
    throw new TypeError("maximumContracts is outside policy");
  }
  const fraction = halfRisk ? POLICY.halfRiskFraction : POLICY.riskPerTradeFraction;
  const riskBudget = Math.min(account.equity * fraction, POLICY.riskPerTradeDollarCap);
  return Math.max(0, Math.min(maximumContracts, Math.floor(riskBudget / candidate.max_loss)));
}

export function createRiskCertificate({
  runId,
  createdAt,
  stability,
  account,
  market,
  policyHash,
  codeVersion = "working-tree",
  signingSecret,
  authorizationScope = "synthetic_replay",
  dataMode,
}) {
  assertSigningSecret(signingSecret);
  if (!new Set(["synthetic_replay", "paper_submit"]).has(authorizationScope)) throw new Error("invalid certificate scope");
  const expectedDataMode = authorizationScope === "paper_submit" ? "alpaca_paper_live" : "synthetic_replay";
  if (dataMode !== expectedDataMode) throw new Error(`certificate scope requires data_mode=${expectedDataMode}`);
  const selected = stability.compilation.selected;
  const liveExecution = authorizationScope === "paper_submit";
  // Live stability challenges are alpha diagnostics; synthetic replay keeps
  // its frozen v2 certificate behavior for reproducibility.
  const halfRisk = !liveExecution && stability.perturbations?.rejected_variants > 0;
  const quantity = selected ? calculateQuantity(selected, account, {
    halfRisk,
    maximumContracts: liveExecution ? LIVE_EXECUTION_SAFETY_POLICY.maximumContracts : POLICY.maxContracts,
  }) : 0;
  const riskAfterOrder = account.open_defined_risk + (selected ? selected.max_loss * quantity : 0);
  const commonChecks = {
    paper_endpoint_locked: account.base_url === POLICY.paperHost,
    account_fresh: account.age_seconds <= 15,
    account_not_blocked: account.trading_blocked === false,
    option_feed_identified: ["indicative", "opra"].includes(market.option_feed),
    quote_fresh: market.quote_age_seconds <= POLICY.quoteMaxAgeSeconds[market.option_feed],
  };
  const checks = liveExecution ? {
    ...commonChecks,
    selected_candidate_available: selected !== null,
    quantity_exactly_one: quantity === 1,
    max_loss_within_cap: Boolean(selected
      && selected.max_loss > 0
      && selected.max_loss <= LIVE_EXECUTION_SAFETY_POLICY.maximumLossDollars),
    aggregate_risk_cap: riskAfterOrder <= account.equity * LIVE_EXECUTION_SAFETY_POLICY.maximumAggregateRiskFraction,
    execution_transport_mcp: account.execution_transport === "mcp",
  } : {
    ...commonChecks,
    source_removal_stable: stability.source_removal?.passed === true,
    perturbations_stable: stability.perturbations?.passed === true,
    conservative_ev_positive: Boolean(selected?.passes_ev),
    probability_gate: Boolean(selected?.passes_probability),
    quantity_positive: quantity > 0,
    aggregate_risk_cap: riskAfterOrder <= account.equity * POLICY.aggregateRiskFraction,
    execution_transport_mcp: account.execution_transport === "mcp",
  };
  const certified = Object.values(checks).every(Boolean);
  const proposedDecision = selected?.action ?? "NO_TRADE";
  const createdTime = new Date(createdAt);
  if (Number.isNaN(createdTime.getTime())) throw new Error("invalid certificate creation time");
  const body = {
    schema_version: liveExecution ? "risk_certificate.v3" : "risk_certificate.v2",
    run_id: runId,
    created_at: createdAt,
    expires_at: new Date(createdTime.getTime() + POLICY.certificateTtlSeconds * 1000).toISOString(),
    mode: account.mode,
    data_mode: dataMode,
    authorization_scope: authorizationScope,
    signer_key_id: sha256(`finly-signer:${authorizationScope}:${signingSecret}`),
    decision: certified ? proposedDecision : "NO_TRADE",
    proposed_decision: proposedDecision,
    intent_sha256: sha256(stability.base_intent),
    candidate_id: selected?.candidate_id ?? null,
    candidate_snapshot_sha256: selected ? sha256(selected) : null,
    desired_order_projection_sha256: selected ? orderProjectionHash(selected, quantity, runId) : null,
    policy_sha256: policyHash,
    code_version: codeVersion,
    evidence_root: stability.base_intent.evidence_root,
    horizon_sessions: stability.base_intent.horizon_sessions,
    account_snapshot_sha256: sha256(account),
    market_snapshot_sha256: sha256(market),
    market_spot: market.spot,
    market_observed_at: market.observed_at,
    option_feed: market.option_feed,
    quantity,
    max_loss_per_contract: selected?.max_loss ?? 0,
    reserved_max_loss: selected ? selected.max_loss * quantity : 0,
    max_entry_debit: selected ? Math.min(selected.width - 0.01, selected.entry_debit + POLICY.entryDebitDriftDollars) : 0,
    account_equity: account.equity,
    account_open_defined_risk: account.open_defined_risk,
    conservative_ev: selected?.conservative_ev ?? 0,
    probability_profit: selected?.probability_profit ?? 0,
    expected_shortfall_95: selected?.expected_shortfall_95 ?? 0,
    source_removal_summary: stability.source_removal,
    perturbation_summary: stability.perturbations ? {
      count: stability.perturbations.count,
      direction_flips: stability.perturbations.direction_flips,
      rejected_variants: stability.perturbations.rejected_variants,
      fifth_percentile_conservative_ev: stability.perturbations.fifth_percentile_conservative_ev,
      nonzero_direction_rate: stability.perturbations.nonzero_direction_rate,
      trade_rate: stability.perturbations.trade_rate,
      same_structure_rate: stability.perturbations.same_structure_rate,
    } : null,
    ...(liveExecution ? {
      alpha_confidence_diagnostics: {
        source_removal_passed: stability.source_removal?.passed === true,
        perturbations_passed: stability.perturbations?.passed === true,
        conservative_ev_passed: Boolean(selected?.passes_ev),
        probability_passed: Boolean(selected?.passes_probability),
      },
    } : {}),
    checks,
    certified,
    rejection_codes: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
    nonce: `permit:${sha256({ runId, createdAt, candidate: selected?.candidate_id ?? null, mutation: "ENTRY_PLACE" }).slice(7)}`,
  };
  const certificateId = sha256(body);
  return { ...body, certificate_id: certificateId, signature: signatureFor(body, signingSecret) };
}

export function verifyCertificate(certificate, {
  signingSecret,
  requiredScope,
  now = new Date(),
  enforceFreshness = true,
  requireCertified = true,
} = {}) {
  assertSigningSecret(signingSecret);
  const { certificate_id: supplied, signature, ...body } = certificate;
  if (sha256(body) !== supplied) throw new Error("certificate hash mismatch");
  const expectedSignature = Buffer.from(signatureFor(body, signingSecret));
  const suppliedSignature = Buffer.from(String(signature ?? ""));
  if (expectedSignature.length !== suppliedSignature.length || !timingSafeEqual(expectedSignature, suppliedSignature)) {
    throw new Error("certificate signature mismatch");
  }
  if (requireCertified && !certificate.certified) throw new Error("certificate is not authorized");
  if (certificate.mode !== "paper") throw new Error("certificate is not paper mode");
  if (certificate.checks.paper_endpoint_locked !== true) throw new Error("paper endpoint check failed");
  if (requiredScope && certificate.authorization_scope !== requiredScope) throw new Error("certificate scope is not authorized for this operation");
  const nowTime = new Date(now);
  const createdTime = new Date(certificate.created_at);
  const expiresTime = new Date(certificate.expires_at);
  if ([nowTime, createdTime, expiresTime].some((value) => Number.isNaN(value.getTime()))) throw new Error("invalid certificate timestamp");
  if (enforceFreshness && (nowTime < createdTime || nowTime > expiresTime)) throw new Error("certificate is expired or not yet valid");
  return true;
}
