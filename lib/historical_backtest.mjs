import { buildLiveSignals } from "./live_signals.mjs";
import { computeCandidateId } from "./candidate.mjs";
import { evaluateCandidate } from "./compiler.mjs";
import { POLICY } from "./policy.mjs";
import { calculateQuantity } from "./risk.mjs";
import { validateOptionQuote } from "./schema.mjs";
import { runStabilityGate } from "./stability.mjs";

const DECISION_STATUSES = new Set([
  "ELIGIBLE",
  "CHALLENGE_REJECTED",
  "NO_CANDIDATE",
  "INPUT_REJECTED",
]);

function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${label} must be positive and finite`);
  return number;
}

function isoTimestamp(value, label) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${label} must be a valid timestamp`);
  return parsed.toISOString();
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  return {
    candidate_id: candidate.candidate_id,
    action: candidate.action,
    underlying: candidate.underlying,
    expiry: candidate.expiry,
    dte: candidate.dte,
    long_symbol: candidate.long_leg.symbol,
    short_symbol: candidate.short_leg.symbol,
    long_strike: candidate.long_leg.strike,
    short_strike: candidate.short_leg.strike,
    width: candidate.width,
    entry_debit: candidate.entry_debit,
    max_loss: candidate.max_loss,
    max_gain: candidate.max_gain,
    reward_risk: candidate.reward_risk,
    conservative_ev: candidate.conservative_ev,
    probability_profit: candidate.probability_profit,
    expected_shortfall_95: candidate.expected_shortfall_95,
  };
}

function shadowLeg(quote) {
  return {
    symbol: quote.symbol,
    type: quote.type,
    strike: quote.strike,
    bid: quote.bid,
    ask: quote.ask,
    iv: quote.iv,
    feed: quote.feed,
    quote_age_seconds: quote.quote_age_seconds,
    open_interest: quote.open_interest,
  };
}

function shadowCandidates(intent, optionChain, market) {
  if (intent.direction === "neutral") return [];
  const action = intent.direction === "bullish" ? "BULL_CALL_DEBIT_SPREAD" : "BEAR_PUT_DEBIT_SPREAD";
  const requiredType = action === "BULL_CALL_DEBIT_SPREAD" ? "call" : "put";
  const valid = optionChain.filter((quote) => {
    try {
      validateOptionQuote(quote);
      return quote.type === requiredType;
    } catch {
      return false;
    }
  });
  const candidates = [];
  for (let left = 0; left < valid.length; left += 1) {
    for (let right = left + 1; right < valid.length; right += 1) {
      const first = valid[left];
      const second = valid[right];
      if (first.expiry !== second.expiry || first.underlying !== second.underlying) continue;
      const sorted = [first, second].sort((a, b) => a.strike - b.strike);
      const longLeg = action === "BULL_CALL_DEBIT_SPREAD" ? sorted[0] : sorted[1];
      const shortLeg = action === "BULL_CALL_DEBIT_SPREAD" ? sorted[1] : sorted[0];
      const width = Math.abs(longLeg.strike - shortLeg.strike);
      if (width < 1 || width > 15) continue;
      const entryDebit = round(longLeg.ask - shortLeg.bid + POLICY.slippagePerLegDollars * 2, 2);
      if (!(entryDebit > 0 && entryDebit < width)) continue;
      const maxLoss = round(entryDebit * 100, 2);
      if (maxLoss > POLICY.riskPerTradeDollarCap) continue;
      const maxGain = round((width - entryDebit) * 100, 2);
      const candidate = {
        schema_version: "option_candidate.v1",
        action,
        underlying: longLeg.underlying,
        expiry: longLeg.expiry,
        dte: longLeg.dte,
        long_leg: shadowLeg(longLeg),
        short_leg: shadowLeg(shortLeg),
        width: round(width, 2),
        entry_debit: entryDebit,
        max_loss: maxLoss,
        max_gain: maxGain,
        reward_risk: round(maxGain / maxLoss, 4),
      };
      candidate.candidate_id = computeCandidateId(candidate);
      candidates.push(evaluateCandidate(candidate, intent, market));
    }
  }
  return candidates;
}

function compactStability(stability) {
  return {
    passed: stability.passed,
    source_removal: {
      passed: stability.source_removal?.passed === true,
      checks: stability.source_removal?.variants?.length ?? 0,
      failed_families: (stability.source_removal?.variants ?? [])
        .filter((row) => !(row.stable_direction && row.trade_gate?.ok && row.action_stable && row.fixed_candidate_passes))
        .map((row) => row.removed_family),
    },
    perturbations: stability.perturbations ? {
      passed: stability.perturbations.passed,
      count: stability.perturbations.count,
      rejected_variants: stability.perturbations.rejected_variants,
      direction_flips: stability.perturbations.direction_flips,
      trade_rate: stability.perturbations.trade_rate,
      same_structure_rate: stability.perturbations.same_structure_rate,
      fifth_percentile_conservative_ev: stability.perturbations.fifth_percentile_conservative_ev,
    } : null,
  };
}

function compilerDiagnostics(compilation) {
  const rejectionCounts = {};
  for (const rejection of compilation.rejected ?? []) {
    const code = rejection.code ?? "UNLABELED_REJECTION";
    rejectionCounts[code] = (rejectionCounts[code] ?? 0) + 1;
  }
  return {
    evaluated_candidates: compilation.candidates?.length ?? 0,
    rejection_counts: Object.fromEntries(Object.entries(rejectionCounts).sort((left, right) => left[0].localeCompare(right[0]))),
  };
}

/**
 * Builds the same bounded signal families used by the live paper reader, but
 * from a caller-supplied point-in-time historical snapshot. This function does
 * not fetch data, construct fills, or authorize a broker mutation.
 */
export async function buildHistoricalSignals({
  market,
  optionChain,
  newsResponse = { news: [] },
  extractor,
  decisionTime,
} = {}) {
  const asOf = isoTimestamp(decisionTime, "historical decision time");
  if (!market || market.history_mode !== "alpaca_historical_point_in_time") {
    throw new TypeError("historical replay requires explicitly labeled point-in-time market history");
  }
  if (!Array.isArray(optionChain)) throw new TypeError("historical option chain must be an array");
  return buildLiveSignals({ market, optionChain, newsResponse, extractor, asOf });
}

/**
 * Runs Finly's existing deterministic compiler and challenge suite without
 * minting an execution permit. A historical replay can be ELIGIBLE for the
 * simulated fill model, but can never produce a broker payload.
 */
export function evaluateHistoricalDecision({
  decisionTime,
  market,
  optionChain,
  signals,
  omissions = [],
  horizonSessions = 3,
  equity = 100_000,
  openDefinedRisk = 0,
} = {}) {
  const createdAt = isoTimestamp(decisionTime, "historical decision time");
  if (!market || market.history_mode !== "alpaca_historical_point_in_time") {
    throw new TypeError("historical replay refuses synthetic or unlabeled market history");
  }
  if (market.observed_at && new Date(market.observed_at) > new Date(createdAt)) {
    throw new TypeError("historical market observation is later than the decision");
  }
  if (!Array.isArray(optionChain) || optionChain.length === 0) {
    return historicalInputRejection({ createdAt, reason: "NO_POINT_IN_TIME_OPTION_CHAIN", omissions });
  }
  if (!Array.isArray(signals) || signals.length === 0) {
    return historicalInputRejection({ createdAt, reason: "NO_CANONICAL_SIGNALS", omissions });
  }
  if (!Number.isInteger(horizonSessions) || horizonSessions < 1 || horizonSessions > 20) {
    throw new TypeError("historical horizon must be an integer from one to twenty sessions");
  }
  const account = {
    equity: finitePositive(equity, "historical equity"),
    open_defined_risk: Number(openDefinedRisk),
  };
  if (!Number.isFinite(account.open_defined_risk) || account.open_defined_risk < 0) {
    throw new TypeError("historical open risk must be finite and nonnegative");
  }

  const stability = runStabilityGate(signals, optionChain, market, {
    underlying: market.underlying,
    horizonSessions,
    asOf: createdAt,
  });
  const candidate = stability.compilation.selected;
  const shadowIntent = stability.base_intent.direction === "neutral" ? null : {
    ...stability.base_intent,
    coverage: Math.max(stability.base_intent.coverage, POLICY.minCoverage),
    agreement: Math.max(stability.base_intent.agreement, POLICY.minAgreement),
  };
  const shadowCandidate = [...(shadowIntent ? shadowCandidates(shadowIntent, optionChain, market) : [])]
    .sort((left, right) => {
      const widthDistance = Math.abs(left.width - 5) - Math.abs(right.width - 5);
      const moneynessDistance = Math.abs(left.long_leg.strike - market.spot) - Math.abs(right.long_leg.strike - market.spot);
      return widthDistance || moneynessDistance || left.candidate_id.localeCompare(right.candidate_id);
    })[0] ?? null;
  const status = candidate ? (stability.passed ? "ELIGIBLE" : "CHALLENGE_REJECTED") : "NO_CANDIDATE";
  const halfRisk = (stability.perturbations?.rejected_variants ?? 0) > 0;
  const sizingRiskFraction = halfRisk ? POLICY.halfRiskFraction : POLICY.riskPerTradeFraction;
  const quantity = status === "ELIGIBLE" ? calculateQuantity(candidate, account, { halfRisk }) : 0;
  const finalStatus = status === "ELIGIBLE" && quantity === 0 ? "CHALLENGE_REJECTED" : status;
  const reasons = [];
  if (!candidate) reasons.push(stability.compilation.reason ?? "NO_CANDIDATE");
  if (candidate && !stability.source_removal?.passed) reasons.push("SOURCE_REMOVAL_FAILED");
  if (candidate && stability.perturbations && !stability.perturbations.passed) reasons.push("PERTURBATIONS_FAILED");
  if (candidate && stability.passed && quantity === 0) reasons.push("RISK_BUDGET_BELOW_ONE_CONTRACT");

  return {
    schema_version: "finly_historical_decision.v1",
    created_at: createdAt,
    mode: "historical_replay",
    mutation_authorized: false,
    status: finalStatus,
    reasons,
    intent: stability.base_intent,
    candidate: compactCandidate(candidate),
    shadow_candidate: compactCandidate(shadowCandidate),
    shadow_waived_gates: shadowCandidate ? [
      ...(stability.base_intent.coverage < POLICY.minCoverage ? ["MINIMUM_COVERAGE"] : []),
      ...(stability.base_intent.agreement < POLICY.minAgreement ? ["MINIMUM_AGREEMENT"] : []),
      ...(shadowCandidate.reward_risk < POLICY.minimumRewardRisk ? ["MINIMUM_REWARD_RISK"] : []),
      ...(!shadowCandidate.passes_ev ? ["CONSERVATIVE_EV"] : []),
      ...(!shadowCandidate.passes_probability ? ["PROBABILITY_OF_PROFIT"] : []),
      ...(stability.passed ? [] : ["SOURCE_REMOVAL_OR_PERTURBATION_STABILITY"]),
    ] : [],
    quantity,
    sizing_reference_equity: account.equity,
    sizing_risk_fraction: finalStatus === "ELIGIBLE" ? sizingRiskFraction : null,
    reserved_max_loss: candidate ? candidate.max_loss * quantity : 0,
    stability: compactStability(stability),
    compiler_diagnostics: compilerDiagnostics(stability.compilation),
    source_families: stability.base_intent.source_families,
    option_count: optionChain.length,
    omissions: Array.isArray(omissions) ? structuredClone(omissions) : [],
    data_disclosure: "Historical option bars are reconstructed into conservative research quotes; this record is not an Alpaca fill or execution permit.",
  };
}

function historicalInputRejection({ createdAt, reason, omissions }) {
  return {
    schema_version: "finly_historical_decision.v1",
    created_at: createdAt,
    mode: "historical_replay",
    mutation_authorized: false,
    status: "INPUT_REJECTED",
    reasons: [reason],
    intent: null,
    candidate: null,
    shadow_candidate: null,
    shadow_waived_gates: [],
    quantity: 0,
    sizing_reference_equity: null,
    sizing_risk_fraction: null,
    reserved_max_loss: 0,
    stability: null,
    compiler_diagnostics: null,
    source_families: [],
    option_count: 0,
    omissions: Array.isArray(omissions) ? structuredClone(omissions) : [],
    data_disclosure: "Historical input was incomplete; Finly failed closed and simulated no trade.",
  };
}

export function validateHistoricalDecision(record) {
  if (!record || record.schema_version !== "finly_historical_decision.v1") throw new TypeError("invalid historical decision schema");
  if (!DECISION_STATUSES.has(record.status)) throw new TypeError("invalid historical decision status");
  if (record.mutation_authorized !== false) throw new TypeError("historical replay must never authorize mutation");
  return record;
}

export const HISTORICAL_BACKTEST_POLICY = Object.freeze({
  schema_version: "finly_historical_backtest_policy.v1",
  underlying: "SPY",
  research_scope: "counterfactual deterministic-policy research only; not a broker authorization replay, execution replication, or profitability claim",
  decision_frequency: "daily in the one-week and one-month windows; strictly every five market sessions, anchored on the latest decision session, in the one-year window",
  shadow_definition: "development-stage signal-only ablation: when the bounded aggregate crosses the direction threshold, choose the valid five-point vertical nearest SPY spot (deterministic tie-break), preserving option validation, the per-trade loss cap, exact debit-limit test, aligned outcome reconstruction, sizing, and one-position rule while waiving coverage, agreement, minimum reward-risk, conservative-EV, probability, source-removal, and perturbation research-policy gates",
  proxy_timing: "next-session first complete aligned one-minute SPY/two-leg research proxy within five minutes of the open; the decision-time debit limit must be reached by the reconstructed natural debit",
  forecast_clock: "decision close through the reconstructed exit endpoint",
  holding_clock: "next-session entry proxy through the reconstructed exit endpoint",
  default_forecast_horizon_sessions: 4,
  default_holding_horizon_sessions: 3,
  maximum_risk_per_trade_fraction: POLICY.riskPerTradeFraction,
  maximum_risk_per_trade_dollars: POLICY.riskPerTradeDollarCap,
  sizing_basis: "then-current realized equity at each decision; unrealized P&L is unavailable and therefore excluded",
  daily_bar_quote_freshness_valid_for_live: false,
  broker_policy_equivalence_claimed: false,
  execution_or_fill_equivalence_claimed: false,
  profitability_claimed: false,
  mutation_authorized: false,
});
