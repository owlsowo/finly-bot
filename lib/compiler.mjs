import { computeCandidateId } from "./candidate.mjs";
import { POLICY } from "./policy.mjs";
import { blackScholesPrice, scenarioPrices, summarize } from "./quant.mjs";
import { validateIntent, validateOptionQuote } from "./schema.mjs";
import { intentCanTrade } from "./signals.mjs";

function cents(dollars) {
  return Math.round(dollars * 100);
}

function dollars(valueInCents) {
  return Math.round(valueInCents) / 100;
}

export function verticalPayoff({ action, longStrike, shortStrike, debit, terminalPrice, multiplier = 100 }) {
  const width = Math.abs(longStrike - shortStrike);
  const intrinsic = action === "BULL_CALL_DEBIT_SPREAD"
    ? Math.min(width, Math.max(0, terminalPrice - longStrike))
    : Math.min(width, Math.max(0, longStrike - terminalPrice));
  const payoff = Math.round((intrinsic - debit) * multiplier * 100) / 100;
  return payoff === 0 ? 0 : payoff;
}

export function enumerateVerticals(intent, optionChain, { alphaPolicy = POLICY } = {}) {
  validateIntent(intent);
  const tradeGate = intentCanTrade(intent, alphaPolicy);
  if (!tradeGate.ok) return { accepted: [], rejected: [{ code: tradeGate.reason }] };
  const action = intent.direction === "bullish" ? "BULL_CALL_DEBIT_SPREAD" : "BEAR_PUT_DEBIT_SPREAD";
  const requiredType = action === "BULL_CALL_DEBIT_SPREAD" ? "call" : "put";
  const valid = [];
  const rejected = [];
  for (const quote of optionChain) {
    try {
      validateOptionQuote(quote);
      if (quote.type === requiredType) valid.push(quote);
    } catch (error) {
      rejected.push({ symbol: quote?.symbol ?? "unknown", code: "QUOTE_REJECTED", detail: error.message });
    }
  }
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
      const debit = longLeg.ask - shortLeg.bid + POLICY.slippagePerLegDollars * 2;
      if (debit <= 0 || debit >= width) {
        rejected.push({ symbols: [longLeg.symbol, shortLeg.symbol], code: "INVALID_DEBIT" });
        continue;
      }
      const maxLoss = dollars(cents(debit * 100));
      const maxGain = dollars(cents((width - debit) * 100));
      const rewardRisk = maxGain / maxLoss;
      if (rewardRisk < alphaPolicy.minimumRewardRisk) {
        rejected.push({ symbols: [longLeg.symbol, shortLeg.symbol], code: "REWARD_RISK" });
        continue;
      }
      const candidate = {
        schema_version: "option_candidate.v1",
        action,
        underlying: longLeg.underlying,
        expiry: longLeg.expiry,
        dte: longLeg.dte,
        long_leg: pickQuote(longLeg),
        short_leg: pickQuote(shortLeg),
        width: round(width, 2),
        entry_debit: round(debit, 2),
        max_loss: maxLoss,
        max_gain: maxGain,
        reward_risk: round(rewardRisk, 4),
      };
      candidate.candidate_id = computeCandidateId(candidate);
      candidates.push(candidate);
    }
  }
  return { accepted: candidates, rejected };
}

export function evaluateCandidate(candidate, intent, market, { alphaPolicy = POLICY } = {}) {
  const iv = (candidate.long_leg.iv + candidate.short_leg.iv) / 2;
  const modelNames = ["tilted_implied_distribution", "vol_scaled_block_bootstrap"];
  const modelResults = modelNames.map((model) => {
    const prices = scenarioPrices({
      spot: market.spot,
      intent,
      iv,
      horizonSessions: intent.horizon_sessions,
      model,
      count: POLICY.scenarioPathCount,
      historicalLogReturns: market.historical_log_returns,
      seed: `${candidate.candidate_id}:${market.observed_at ?? "unknown"}`,
    });
    // Contract DTE is measured in calendar days, while the signal horizon is
    // measured in trading sessions. Convert each on its own clock before
    // subtracting; mixing both on a 252-session denominator overstates time.
    const remainingTimeYears = Math.max(1 / 365, candidate.dte / 365 - intent.horizon_sessions / 252);
    const profits = prices.map((scenarioSpot) => {
      const longValue = blackScholesPrice({
        type: candidate.long_leg.type,
        spot: scenarioSpot,
        strike: candidate.long_leg.strike,
        timeYears: remainingTimeYears,
        volatility: candidate.long_leg.iv,
        rate: market.interest_rate ?? POLICY.interestRate,
      });
      const shortValue = blackScholesPrice({
        type: candidate.short_leg.type,
        spot: scenarioSpot,
        strike: candidate.short_leg.strike,
        timeYears: remainingTimeYears,
        volatility: candidate.short_leg.iv,
        rate: market.interest_rate ?? POLICY.interestRate,
      });
      const closeValue = Math.min(candidate.width, Math.max(0, longValue - shortValue - POLICY.exitSlippagePerLegDollars * 2));
      return (closeValue - candidate.entry_debit) * 100;
    });
    const summary = summarize(profits);
    return {
      model,
      path_count: prices.length,
      expected_value: round(summary.mean, 2),
      probability_profit: round(summary.probabilityPositive, 4),
      expected_shortfall_95: round(summary.expectedShortfall95, 2),
      standard_error: round(summary.standardError, 2),
      lower_confidence_bound: round(summary.mean - 1.645 * summary.standardError, 2),
    };
  });
  const conservativeEv = Math.min(...modelResults.map((item) => item.lower_confidence_bound));
  const probabilityProfit = Math.min(...modelResults.map((item) => item.probability_profit));
  const expectedShortfall95 = Math.min(...modelResults.map((item) => item.expected_shortfall_95));
  const requiredEv = Math.max(alphaPolicy.minimumEvDollars, alphaPolicy.minimumEvToMaxLoss * candidate.max_loss);
  return {
    ...candidate,
    model_results: modelResults,
    conservative_ev: round(conservativeEv, 2),
    probability_profit: round(probabilityProfit, 4),
    expected_shortfall_95: round(expectedShortfall95, 2),
    expected_shortfall_95_loss: round(Math.max(0, -expectedShortfall95), 2),
    required_ev: round(requiredEv, 2),
    passes_ev: conservativeEv >= requiredEv,
    passes_probability: probabilityProfit >= alphaPolicy.minimumProbabilityOfProfit,
  };
}

export function compileIntent(intent, optionChain, market, {
  maxLossBudget = null,
  alphaPolicy = POLICY,
} = {}) {
  if (maxLossBudget !== null
    && (!Number.isFinite(maxLossBudget) || maxLossBudget < 0 || maxLossBudget > POLICY.riskPerTradeDollarCap)) {
    throw new TypeError("compiler max-loss budget is invalid");
  }
  const enumeration = enumerateVerticals(intent, optionChain, { alphaPolicy });
  const affordable = enumeration.accepted.filter((candidate) => {
    if (maxLossBudget === null || candidate.max_loss <= maxLossBudget) return true;
    enumeration.rejected.push({ symbols: [candidate.long_leg.symbol, candidate.short_leg.symbol], code: "RISK_BUDGET" });
    return false;
  });
  const evaluated = affordable.map((candidate) => evaluateCandidate(candidate, intent, market, { alphaPolicy }));
  const eligible = evaluated
    .filter((candidate) => candidate.passes_ev
      && candidate.passes_probability
      && (maxLossBudget !== null || candidate.max_loss <= POLICY.riskPerTradeDollarCap))
    .sort((left, right) => {
      const utilityDifference = (right.conservative_ev / right.max_loss) - (left.conservative_ev / left.max_loss);
      return utilityDifference || left.candidate_id.localeCompare(right.candidate_id);
    });
  const selected = eligible[0] ?? null;
  return {
    action: selected?.action ?? "NO_TRADE",
    selected,
    candidates: evaluated,
    rejected: enumeration.rejected,
    reason: selected ? null : "NO_CANDIDATE_SURVIVED_CONSERVATIVE_GATES",
  };
}

function pickQuote(quote) {
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

function round(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
