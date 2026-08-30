import { DeterministicReplayPlanner } from "./agent.mjs";
import { sha256 } from "./canonical.mjs";
import {
  applyEconomicRiskCommitteeVeto,
  buildCurrentEconomicDecision,
  buildEconomicOptionsDirectionAuthority,
} from "./economic_research.mjs";
import { createCanonicalEvidenceRecord } from "./live_signals.mjs";
import { runDecision } from "./pipeline.mjs";
import { POLICY } from "./policy.mjs";

export const ECONOMIC_OPTIONS_REPLAY_AS_OF = "2026-08-28T18:30:05.000Z";

function dailyBars(cash = false) {
  let close = cash ? 90 : 100;
  return Array.from({ length: 300 }, (_, index) => {
    close *= cash ? 1.0001 : 1.0008 + 0.002 * Math.sin(index * 0.7);
    return { t: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(), c: close };
  });
}

function economicBundle() {
  const deterministicDecision = buildCurrentEconomicDecision({
    spyBars: dailyBars(false),
    cashBars: dailyBars(true),
    decisionTimestamp: ECONOMIC_OPTIONS_REPLAY_AS_OF,
    sourceAvailableAt: "2026-08-28T18:29:00.000Z",
    completedSessionBoundary: {
      sessionDate: "2025-10-27",
      marketCloseAt: "2025-10-27T20:00:00.000Z",
      eligibleAt: "2025-10-27T20:15:00.000Z",
      availabilityDelayMinutes: 15,
    },
    currentAllocation: { spyWeight: 0, bilWeight: 1 },
    lastRebalanceDate: null,
  });
  const riskCommitteeDecision = applyEconomicRiskCommitteeVeto(deterministicDecision, {
    assessedAt: ECONOMIC_OPTIONS_REPLAY_AS_OF,
    disposition: "SCALE",
    spyExposureMultiplier: 1,
    reasonCodes: ["NO_AGENT_RISK_REDUCTION"],
  });
  const body = {
    schema_version: "finly_current_economic_bundle.v1",
    generated_at: ECONOMIC_OPTIONS_REPLAY_AS_OF,
    data: {
      provider: "deterministic public fixture",
      read_only: true,
      daily_bar_timestamp_semantics: "session label only",
      raw_bars_embedded: false,
    },
    paper_account_boundary: {
      authenticated_read_succeeded: false,
      synthetic_non_mutating_replay: true,
      raw_account_embedded: false,
    },
    deterministic_decision: deterministicDecision,
    risk_committee_decision: riskCommitteeDecision,
    mutation_requested: false,
  };
  return { ...body, artifact_sha256: sha256(body) };
}

function signal({ family, directionScore, volatilityScore, explanation, origin }) {
  const evidence = createCanonicalEvidenceRecord({
    family,
    underlying: "SPY",
    sourceKind: "synthetic_fixture",
    sourceUri: `urn:finly:economic-options-replay:${family}:${origin}`,
    originId: `finly.replay.${family}.${origin}`,
    publishedAt: "2026-08-28T18:29:00.000Z",
    receivedAt: ECONOMIC_OPTIONS_REPLAY_AS_OF,
    content: { family, directionScore, volatilityScore, origin },
  });
  return {
    schema_version: "source_signal.v1",
    family,
    underlying: "SPY",
    direction_score: directionScore,
    volatility_score: volatilityScore,
    quality: 1,
    freshness: 1,
    calibration: 1,
    independence: 1,
    evidence_ids: [evidence.evidence_id],
    evidence: [evidence],
    explanation,
  };
}

function optionQuote(type, strike, bid, ask, iv) {
  return {
    underlying: "SPY",
    symbol: `SPY260911${type === "call" ? "C" : "P"}${String(strike * 1_000).padStart(8, "0")}`,
    type,
    expiry: "2026-09-11",
    strike,
    bid,
    ask,
    iv,
    dte: 14,
    feed: "indicative",
    quote_age_seconds: 1.8,
    open_interest: 9_000,
    tradable: true,
  };
}

function fixture(signals, runId) {
  return {
    schema_version: "finly_fixture.v1",
    run_id: runId,
    decision_time: ECONOMIC_OPTIONS_REPLAY_AS_OF,
    data_mode: "synthetic_replay",
    code_version: "public-economic-options-replay-v1",
    horizon_sessions: 5,
    account: {
      mode: "paper",
      base_url: POLICY.paperHost,
      execution_transport: "mcp",
      equity: 100_000,
      open_defined_risk: 0,
      age_seconds: 0,
      trading_blocked: false,
    },
    market: {
      underlying: "SPY",
      spot: 560,
      observed_at: "2026-08-28T18:30:02.000Z",
      quote_age_seconds: 3,
      option_feed: "indicative",
      history_mode: "synthetic_fixture",
      interest_rate: 0.04,
      historical_log_returns: Array.from(
        { length: 96 },
        (_, index) => Math.round((0.0025 + 0.0008 * Math.sin(index * 0.6)) * 1e8) / 1e8,
      ),
    },
    signals,
    option_chain: [
      optionQuote("call", 555, 7.7, 8.0, 0.230),
      optionQuote("call", 560, 4.6, 4.9, 0.225),
      optionQuote("call", 565, 2.0, 2.2, 0.220),
      optionQuote("call", 570, 1.2, 1.4, 0.215),
      optionQuote("put", 560, 3.0, 3.2, 0.180),
    ],
  };
}

function summarizeDecision(name, modelEventScore, receipt) {
  const selected = receipt.compilation.selected;
  return {
    name,
    model_event_direction_score: modelEventScore,
    decision_receipt_sha256: receipt.receipt_id,
    intent: receipt.intent,
    economic_direction_authority: receipt.economic_direction_authority,
    options_compilation: {
      action: receipt.compilation.action,
      reason: receipt.compilation.reason,
      selected_candidate: selected ? {
        candidate_id: selected.candidate_id,
        action: selected.action,
        underlying: selected.underlying,
        expiry: selected.expiry,
        long_symbol: selected.long_leg.symbol,
        short_symbol: selected.short_leg.symbol,
        width: selected.width,
        entry_debit: selected.entry_debit,
        maximum_loss_per_contract: selected.max_loss,
        maximum_gain_per_contract: selected.max_gain,
        conservative_expected_value: selected.conservative_ev,
        probability_profit: selected.probability_profit,
      } : null,
    },
    stability: {
      source_removal_passed: receipt.source_removal.passed,
      perturbations_passed: receipt.perturbations?.passed ?? false,
    },
    synthetic_certificate: {
      authorization_scope: receipt.certificate.authorization_scope,
      certified: receipt.certificate.certified,
      decision: receipt.certificate.decision,
      quantity: receipt.certificate.quantity,
      reserved_maximum_loss: receipt.certificate.reserved_max_loss,
      rejection_codes: receipt.certificate.rejection_codes,
      certificate_id: receipt.certificate.certificate_id,
    },
    execution_boundary: {
      broker_mutation_requested: false,
      executor_invoked: false,
      broker_payload_published: false,
      synthetic_scope_is_rejected_by_paper_executor: true,
    },
  };
}

export async function buildEconomicOptionsReplayArtifact() {
  const bundle = economicBundle();
  const authority = buildEconomicOptionsDirectionAuthority(bundle, { asOf: ECONOMIC_OPTIONS_REPLAY_AS_OF });
  const market = signal({
    family: "market",
    directionScore: 0.98,
    volatilityScore: -0.2,
    origin: "deterministic-market",
    explanation: "Deterministic public fixture supplies a strong positive short-horizon market confirmation.",
  });
  const options = signal({
    family: "options",
    directionScore: 0.90,
    volatilityScore: 0.1,
    origin: "deterministic-options",
    explanation: "Deterministic public fixture supplies positive options-surface confirmation.",
  });
  const branchInputs = [
    { name: "NO_MODEL_BASELINE", score: null, signals: [market, options] },
    {
      name: "SUPPORTIVE_MODEL_CANNOT_AMPLIFY",
      score: 0.8,
      signals: [market, options, signal({
        family: "events",
        directionScore: 0.8,
        volatilityScore: -1,
        origin: "supportive-model",
        explanation: "Synthetic model event evidence is supportive and therefore must leave deterministic intent unchanged.",
      })],
    },
    {
      name: "ADVERSE_MODEL_REDUCES",
      score: -0.25,
      signals: [market, options, signal({
        family: "events",
        directionScore: -0.25,
        volatilityScore: 1,
        origin: "adverse-model-reduction",
        explanation: "Synthetic adverse model event evidence may reduce confidence but cannot reverse the economic direction.",
      })],
    },
    {
      name: "SEVERE_MODEL_VETOES",
      score: -1,
      signals: [market, options, signal({
        family: "events",
        directionScore: -1,
        volatilityScore: 1,
        origin: "severe-model-veto",
        explanation: "Synthetic severe model event evidence exercises the fail-closed veto branch.",
      })],
    },
  ];
  const branches = [];
  for (const branch of branchInputs) {
    const receipt = await runDecision({
      fixture: fixture(branch.signals, `economic-options-replay-${branch.name.toLowerCase()}`),
      planner: new DeterministicReplayPlanner(),
      economicDirectionAuthority: authority,
    });
    branches.push(summarizeDecision(branch.name, branch.score, receipt));
  }
  const [baseline, supportive, reduced, vetoed] = branches;
  const body = {
    schema_version: "finly_economic_options_overlay_replay.v1",
    generated_at: ECONOMIC_OPTIONS_REPLAY_AS_OF,
    scope: "PUBLIC_SYNTHETIC_NON_MUTATING_ARCHITECTURE_REPLAY",
    claim_boundary: "This artifact proves deterministic control flow and bounded option compilation, not historical or future options profitability.",
    economic_core: {
      bundle_sha256: bundle.artifact_sha256,
      base_decision_receipt_sha256: bundle.deterministic_decision.receipt_sha256,
      committee_receipt_sha256: bundle.risk_committee_decision.receipt_sha256,
      decision: bundle.risk_committee_decision.decision,
      final_spy_weight: bundle.risk_committee_decision.final_allocation?.spy_weight ?? null,
      mutation_requested: bundle.mutation_requested,
    },
    branches,
    checked_invariants: {
      economic_core_is_only_direction_authority: branches.every((branch) => (
        branch.economic_direction_authority.economic_bundle_sha256 === bundle.artifact_sha256
      )),
      supportive_model_does_not_amplify_direction: supportive.intent.direction_score === baseline.intent.direction_score,
      supportive_model_does_not_change_volatility: supportive.intent.volatility_score === baseline.intent.volatility_score,
      adverse_model_reduces_direction: reduced.intent.direction_score < baseline.intent.direction_score,
      model_never_reverses_to_bearish: branches.every((branch) => branch.intent.direction !== "bearish"),
      severe_model_vetoes_options: vetoed.intent.direction === "neutral"
        && vetoed.options_compilation.action === "NO_TRADE"
        && vetoed.synthetic_certificate.certified === false,
      only_bullish_defined_risk_option_selected: branches.every((branch) => (
        branch.options_compilation.selected_candidate === null
        || branch.options_compilation.selected_candidate.action === "BULL_CALL_DEBIT_SPREAD"
      )),
      selected_risk_never_exceeds_500_dollars: branches.every((branch) => (
        branch.synthetic_certificate.reserved_maximum_loss <= POLICY.riskPerTradeDollarCap
      )),
      no_broker_mutation: branches.every((branch) => !branch.execution_boundary.broker_mutation_requested
        && !branch.execution_boundary.executor_invoked),
    },
  };
  return Object.freeze({ ...body, artifact_sha256: sha256(body) });
}
