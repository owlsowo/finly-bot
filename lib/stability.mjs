import { compileIntent, evaluateCandidate } from "./compiler.mjs";
import { POLICY } from "./policy.mjs";
import { aggregateSignals, leaveOneFamilyOut } from "./signals.mjs";

function halton(index, base) {
  let result = 0;
  let fraction = 1 / base;
  let current = index;
  while (current > 0) {
    result += fraction * (current % base);
    current = Math.floor(current / base);
    fraction /= base;
  }
  return result;
}

export function perturbationReport(signals, optionChain, fixedCandidate, market, options = {}) {
  const baseIntent = aggregateSignals(signals, options);
  const rows = [];
  for (let index = 1; index <= POLICY.perturbationCount; index += 1) {
    const perturbed = signals.map((signal, signalIndex) => {
      const directionShock = (halton(index + signalIndex * 7, 2 + (signalIndex % 3)) - 0.5) * 0.10;
      const qualityShock = (halton(index + signalIndex * 11, 5) - 0.5) * 0.06;
      const freshnessShock = (halton(index + signalIndex * 13, 7) - 0.5) * 0.04;
      const calibrationShock = (halton(index + signalIndex * 17, 11) - 0.5) * 0.04;
      const independenceShock = (halton(index + signalIndex * 19, 13) - 0.5) * 0.03;
      return {
        ...signal,
        direction_score: clip(signal.direction_score + directionShock, -1, 1),
        quality: clip(signal.quality + qualityShock, 0, 1),
        freshness: clip(signal.freshness + freshnessShock, 0, 1),
        calibration: clip(signal.calibration + calibrationShock, 0, 1),
        independence: clip(signal.independence + independenceShock, 0, 1),
      };
    });
    const spotShock = (halton(index, 17) - 0.5) * 0.004;
    const longIvShock = (halton(index, 19) - 0.5) * 0.08;
    const shortIvShock = (halton(index, 23) - 0.5) * 0.08;
    const debitShock = Math.max(0, (halton(index, 29) - 0.35) * 0.06);
    const historyScale = 0.94 + halton(index, 31) * 0.12;
    const rateShock = (halton(index, 37) - 0.5) * 0.01;
    const horizonShock = halton(index, 41) < 0.33 ? -1 : halton(index, 41) > 0.66 ? 1 : 0;
    const aggregated = aggregateSignals(perturbed, options);
    const intent = { ...aggregated, horizon_sessions: clip(aggregated.horizon_sessions + horizonShock, 1, 20) };
    const perturbedMarket = {
      ...market,
      spot: market.spot * (1 + spotShock),
      interest_rate: POLICY.interestRate + rateShock,
      historical_log_returns: market.historical_log_returns?.map((value) => value * historyScale),
    };
    const perturbedCandidate = {
      ...fixedCandidate,
      entry_debit: round(fixedCandidate.entry_debit + debitShock, 2),
      max_loss: round((fixedCandidate.entry_debit + debitShock) * 100, 2),
      max_gain: round((fixedCandidate.width - fixedCandidate.entry_debit - debitShock) * 100, 2),
      long_leg: { ...fixedCandidate.long_leg, iv: fixedCandidate.long_leg.iv * (1 + longIvShock) },
      short_leg: { ...fixedCandidate.short_leg, iv: fixedCandidate.short_leg.iv * (1 + shortIvShock) },
    };
    perturbedCandidate.reward_risk = round(perturbedCandidate.max_gain / perturbedCandidate.max_loss, 4);
    const perturbedChain = optionChain.map((quote) => ({
      ...quote,
      iv: quote.iv * (1 + (quote.symbol === fixedCandidate.long_leg.symbol ? longIvShock : shortIvShock)),
    }));
    const evaluated = evaluateCandidate(perturbedCandidate, intent, perturbedMarket);
    const recompiled = compileIntent(intent, perturbedChain, perturbedMarket);
    rows.push({
      run: index,
      direction: intent.direction,
      direction_score: intent.direction_score,
      conservative_ev: evaluated.conservative_ev,
      passes_ev: evaluated.passes_ev,
      passes_probability: evaluated.passes_probability,
      compiled_action: recompiled.action,
      same_structure: recompiled.action === fixedCandidate.action,
      shocks: {
        spot_fraction: round(spotShock, 6),
        long_iv_fraction: round(longIvShock, 6),
        short_iv_fraction: round(shortIvShock, 6),
        entry_debit_dollars: round(debitShock, 4),
        history_scale: round(historyScale, 6),
        rate: round(rateShock, 6),
        horizon_sessions: horizonShock,
      },
    });
  }
  const sortedEv = rows.map((row) => row.conservative_ev).sort((a, b) => a - b);
  // Nearest-rank percentile: the p-th percentile is the value at rank
  // ceil(p * n), using one-based ranks. For 32 perturbations, p=0.05 must
  // therefore select the second-smallest observation, not the minimum.
  const p5Rank = Math.max(1, Math.ceil(sortedEv.length * 0.05));
  const p5 = sortedEv[p5Rank - 1];
  const nonzeroDirectionRate = rows.filter((row) => row.direction !== "neutral").length / rows.length;
  const tradeRate = rows.filter((row) => row.passes_ev && row.passes_probability).length / rows.length;
  const sameStructureRate = rows.filter((row) => row.same_structure).length / rows.length;
  const directionFlips = rows.filter((row) => row.direction !== baseIntent.direction).length;
  return {
    count: rows.length,
    base_direction: baseIntent.direction,
    direction_flips: directionFlips,
    rejected_variants: rows.filter((row) => !(row.passes_ev && row.passes_probability)).length,
    fifth_percentile_conservative_ev: p5,
    nonzero_direction_rate: round(nonzeroDirectionRate, 4),
    trade_rate: round(tradeRate, 4),
    same_structure_rate: round(sameStructureRate, 4),
    passed: directionFlips === 0 && nonzeroDirectionRate >= 0.90 && tradeRate >= 0.80 && sameStructureRate >= 0.75 && p5 > 0,
    rows,
  };
}

export function runStabilityGate(signals, optionChain, market, options = {}) {
  const baseIntent = aggregateSignals(signals, options);
  const compilation = compileIntent(baseIntent, optionChain, market);
  const sourceRemoval = leaveOneFamilyOut(signals, options);
  if (!compilation.selected) {
    return { passed: false, base_intent: baseIntent, compilation, source_removal: sourceRemoval, perturbations: null };
  }
  const sourceRows = sourceRemoval.variants.map((variant) => {
    const variantIntent = aggregateSignals(signals.filter((signal) => signal.family !== variant.removed_family), options);
    const variantCompilation = compileIntent(variantIntent, optionChain, market);
    const fixedCandidate = evaluateCandidate(compilation.selected, variantIntent, market);
    return {
      ...variant,
      compiled_action: variantCompilation.action,
      compiled_candidate_id: variantCompilation.selected?.candidate_id ?? null,
      compiled_candidate_ev: variantCompilation.selected?.conservative_ev ?? null,
      action_stable: variantCompilation.action === compilation.action,
      fixed_candidate_ev: fixedCandidate.conservative_ev,
      fixed_candidate_passes: fixedCandidate.passes_ev && fixedCandidate.passes_probability,
    };
  });
  const sourcePassed = sourceRows.every((row) => row.stable_direction && row.trade_gate.ok && row.action_stable && row.fixed_candidate_passes);
  const perturbations = perturbationReport(signals, optionChain, compilation.selected, market, options);
  return {
    passed: sourcePassed && perturbations.passed,
    base_intent: baseIntent,
    compilation,
    source_removal: { ...sourceRemoval, variants: sourceRows, passed: sourcePassed },
    perturbations,
  };
}

function clip(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
