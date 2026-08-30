import {
  logReturn,
  mean,
  normalizeLongWeights,
  sampleStandardDeviation,
  staticPortfolioVolatility,
} from "./champion_engine.mjs";
import {
  CORE_SYMBOLS,
  CROSS_ASSET_SYMBOLS,
  SECTOR_SYMBOLS,
} from "./champion_strategies.mjs";
import { laggedEwmaAnnualizedVolatility } from "./champion_strategies_generation5.mjs";

const CASH_SYMBOL = "BIL";
const MAXIMUM_RISKY_GROSS = 1;
const REBALANCE_INTERVAL_SESSIONS = 21;
const SMA_LOOKBACK = 210;
const G4_MOMENTUM_START = 252;
const G4_MOMENTUM_END = 126;
const G4_CORE_WEIGHT = 0.50;
const G4_SECTOR_SLOT_WEIGHT = 1 / 6;
const VOLATILITY_TARGET = 0.10;
const VOLATILITY_LOOKBACK = 22;
const RESIDUAL_MINIMUM_SIGNAL_INDEX = 756;
const TSMOM_HORIZONS = Object.freeze([21, 63, 252]);
const GTAA5_SYMBOLS = Object.freeze(["SPY", "EFA", "IEF", "VNQ", "DBC"]);

export const GENERATION6_REQUIRED_SYMBOLS = Object.freeze([...CORE_SYMBOLS]);
export const GENERATION6_CROSS_ASSET_UNIVERSE = Object.freeze([...CROSS_ASSET_SYMBOLS]);
export const GENERATION6_ALL_IDS = Object.freeze([
  "faber_gtaa5_trend",
  "g6_trend_guard_g4",
  "g6_vol_target_g4",
  "g6_breadth_scaled_g4",
  "g6_residual_sector",
  "g6_long_only_tsmom_1_3_12",
  "g6_hrp_trend",
  "g6_equal_evidence_ensemble",
]);
export const GENERATION6_CONTROL_IDS = Object.freeze([GENERATION6_ALL_IDS[0]]);
export const GENERATION6_CANDIDATE_IDS = Object.freeze(GENERATION6_ALL_IDS.slice(1));

function finiteLogReturn(points, symbol, startIndex, endIndex) {
  const value = logReturn(points, symbol, startIndex, endIndex);
  return Number.isFinite(value) ? value : null;
}

function dailyLogReturn(points, symbol, endIndex) {
  return finiteLogReturn(points, symbol, endIndex - 1, endIndex);
}

function inclusiveSma(points, symbol, signalIndex, lookback = SMA_LOOKBACK) {
  const startIndex = signalIndex - lookback + 1;
  if (startIndex < 0) return null;
  const values = points.slice(startIndex, signalIndex + 1).map((point) => point[symbol]);
  return values.length === lookback && values.every(Number.isFinite) ? mean(values) : null;
}

function aboveInclusiveSma(points, symbol, signalIndex) {
  const average = inclusiveSma(points, symbol, signalIndex);
  return Number.isFinite(average) && Number.isFinite(points[signalIndex]?.[symbol])
    && points[signalIndex][symbol] > average;
}

function cashOnly() {
  return normalizeLongWeights({}, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function descendingScoreThenAlphabetical(items) {
  return [...items].sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
}

function excessLogReturn(points, symbol, signalIndex, lookback) {
  const asset = finiteLogReturn(points, symbol, signalIndex - lookback, signalIndex);
  const cash = finiteLogReturn(points, CASH_SYMBOL, signalIndex - lookback, signalIndex);
  return Number.isFinite(asset) && Number.isFinite(cash) ? asset - cash : null;
}

function topThreeG4Sectors(points, signalIndex) {
  const scored = SECTOR_SYMBOLS.map((symbol) => ({
    symbol,
    score: finiteLogReturn(
      points,
      symbol,
      signalIndex - G4_MOMENTUM_START,
      signalIndex - G4_MOMENTUM_END,
    ),
  }));
  if (scored.some((item) => !Number.isFinite(item.score))) return Object.freeze([]);
  return Object.freeze(descendingScoreThenAlphabetical(scored).slice(0, 3).map((item) => item.symbol));
}

/** The frozen Generation 4 target before any Generation 6 overlay. */
export function buildGeneration6RawG4Weights(points, signalIndex) {
  const selected = topThreeG4Sectors(points, signalIndex);
  const raw = { QQQ: G4_CORE_WEIGHT };
  for (const symbol of selected) raw[symbol] = (raw[symbol] ?? 0) + G4_SECTOR_SLOT_WEIGHT;
  return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function faberGtaa5Weights(points, signalIndex) {
  const raw = {};
  for (const symbol of GTAA5_SYMBOLS) {
    if (aboveInclusiveSma(points, symbol, signalIndex)) raw[symbol] = 0.20;
  }
  return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function trendGuardG4Weights(points, signalIndex) {
  const rawG4 = buildGeneration6RawG4Weights(points, signalIndex);
  const raw = {};
  for (const [symbol, weight] of Object.entries(rawG4)) {
    if (symbol !== CASH_SYMBOL && aboveInclusiveSma(points, symbol, signalIndex)) raw[symbol] = weight;
  }
  return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function volatilityTargetG4Weights(points, returnsBySymbol, signalIndex) {
  const rawG4 = buildGeneration6RawG4Weights(points, signalIndex);
  const risky = Object.fromEntries(Object.entries(rawG4).filter(([symbol]) => symbol !== CASH_SYMBOL));
  const volatility = staticPortfolioVolatility(risky, returnsBySymbol, signalIndex, VOLATILITY_LOOKBACK);
  const scale = Number.isFinite(volatility) && volatility > 0
    ? Math.min(1, VOLATILITY_TARGET / volatility)
    : 0;
  return normalizeLongWeights(Object.fromEntries(Object.entries(risky).map(([symbol, weight]) => [
    symbol,
    weight * scale,
  ])), { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function breadthScaledG4Weights(points, signalIndex) {
  const positive = SECTOR_SYMBOLS.filter((symbol) => {
    const score = excessLogReturn(points, symbol, signalIndex, 21);
    return Number.isFinite(score) && score > 0;
  }).length;
  const scale = positive / SECTOR_SYMBOLS.length;
  const rawG4 = buildGeneration6RawG4Weights(points, signalIndex);
  const raw = Object.fromEntries(Object.entries(rawG4)
    .filter(([symbol]) => symbol !== CASH_SYMBOL)
    .map(([symbol, weight]) => [symbol, weight * scale]));
  return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function fitTwoFactorBetas(points, symbol, signalIndex) {
  if (signalIndex < RESIDUAL_MINIMUM_SIGNAL_INDEX) return null;
  const rows = [];
  // These daily-return observations use price endpoints t-756 through t-21.
  for (let endIndex = signalIndex - 755; endIndex <= signalIndex - 21; endIndex += 1) {
    const asset = dailyLogReturn(points, symbol, endIndex);
    const spy = dailyLogReturn(points, "SPY", endIndex);
    const qqq = dailyLogReturn(points, "QQQ", endIndex);
    const cash = dailyLogReturn(points, CASH_SYMBOL, endIndex);
    if (![asset, spy, qqq, cash].every(Number.isFinite)) return null;
    rows.push(Object.freeze({
      assetExcess: asset - cash,
      market: spy - cash,
      growth: qqq - spy,
    }));
  }
  const assetMean = mean(rows.map((row) => row.assetExcess));
  const marketMean = mean(rows.map((row) => row.market));
  const growthMean = mean(rows.map((row) => row.growth));
  let marketVariance = 0;
  let growthVariance = 0;
  let marketGrowthCovariance = 0;
  let marketAssetCovariance = 0;
  let growthAssetCovariance = 0;
  for (const row of rows) {
    const marketCentered = row.market - marketMean;
    const growthCentered = row.growth - growthMean;
    const assetCentered = row.assetExcess - assetMean;
    marketVariance += marketCentered ** 2;
    growthVariance += growthCentered ** 2;
    marketGrowthCovariance += marketCentered * growthCentered;
    marketAssetCovariance += marketCentered * assetCentered;
    growthAssetCovariance += growthCentered * assetCentered;
  }
  const determinant = marketVariance * growthVariance - marketGrowthCovariance ** 2;
  if (!(determinant > 1e-20)) return null;
  const marketBeta = (
    marketAssetCovariance * growthVariance - growthAssetCovariance * marketGrowthCovariance
  ) / determinant;
  const growthBeta = (
    growthAssetCovariance * marketVariance - marketAssetCovariance * marketGrowthCovariance
  ) / determinant;
  const intercept = assetMean - marketBeta * marketMean - growthBeta * growthMean;
  return Object.freeze({ marketBeta, growthBeta, intercept });
}

/**
 * Factor-stripped sector momentum. The fitted intercept is intentionally not
 * removed from the scoring window; this preserves the candidate's alpha term.
 */
export function generation6ResidualSectorScore(points, symbol, signalIndex) {
  const fit = fitTwoFactorBetas(points, symbol, signalIndex);
  if (!fit) return null;
  const stripped = [];
  // These daily returns use price endpoints t-252 through t-21.
  for (let endIndex = signalIndex - 251; endIndex <= signalIndex - 21; endIndex += 1) {
    const asset = dailyLogReturn(points, symbol, endIndex);
    const spy = dailyLogReturn(points, "SPY", endIndex);
    const qqq = dailyLogReturn(points, "QQQ", endIndex);
    const cash = dailyLogReturn(points, CASH_SYMBOL, endIndex);
    if (![asset, spy, qqq, cash].every(Number.isFinite)) return null;
    stripped.push((asset - cash) - fit.marketBeta * (spy - cash) - fit.growthBeta * (qqq - spy));
  }
  const deviation = sampleStandardDeviation(stripped);
  if (!Number.isFinite(deviation) || deviation <= 0) return null;
  return stripped.reduce((sum, value) => sum + value, 0) / deviation;
}

function residualSectorWeights(points, signalIndex, { ensembleComponent = false } = {}) {
  if (signalIndex < RESIDUAL_MINIMUM_SIGNAL_INDEX) {
    return ensembleComponent
      ? cashOnly()
      : normalizeLongWeights({ SPY: 0.50 }, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
  }
  const selected = descendingScoreThenAlphabetical(SECTOR_SYMBOLS.map((symbol) => ({
    symbol,
    score: generation6ResidualSectorScore(points, symbol, signalIndex),
  })).filter((item) => Number.isFinite(item.score) && item.score > 0)).slice(0, 3);
  const raw = { SPY: 0.50 };
  for (const { symbol } of selected) raw[symbol] = (raw[symbol] ?? 0) + G4_SECTOR_SLOT_WEIGHT;
  return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function longOnlyTsmomWeights(points, returnsBySymbol, signalIndex) {
  const raw = {};
  for (const horizon of TSMOM_HORIZONS) {
    const eligible = [];
    for (const symbol of GENERATION6_CROSS_ASSET_UNIVERSE) {
      const score = excessLogReturn(points, symbol, signalIndex, horizon);
      if (!(Number.isFinite(score) && score > 0)) continue;
      const volatility = laggedEwmaAnnualizedVolatility(returnsBySymbol[symbol], signalIndex, 60 / 61);
      if (Number.isFinite(volatility) && volatility > 0) {
        eligible.push(Object.freeze({ symbol, inverseVolatility: 1 / volatility }));
      }
    }
    const denominator = eligible.reduce((sum, item) => sum + item.inverseVolatility, 0);
    if (!(denominator > 0)) continue;
    for (const item of eligible) {
      raw[item.symbol] = (raw[item.symbol] ?? 0) + (item.inverseVolatility / denominator) / TSMOM_HORIZONS.length;
    }
  }
  return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function covarianceMatrix(symbols, returnsBySymbol, signalIndex, lookback = 252) {
  const startIndex = signalIndex - lookback + 1;
  if (startIndex < 1 || signalIndex >= returnsBySymbol[symbols[0]]?.length) return null;
  const means = {};
  for (const symbol of symbols) {
    const values = returnsBySymbol[symbol]?.slice(startIndex, signalIndex + 1);
    if (values?.length !== lookback || values.some((value) => !Number.isFinite(value))) return null;
    means[symbol] = mean(values);
  }
  const matrix = Object.fromEntries(symbols.map((left) => [left, {}]));
  for (let leftIndex = 0; leftIndex < symbols.length; leftIndex += 1) {
    const left = symbols[leftIndex];
    for (let rightIndex = leftIndex; rightIndex < symbols.length; rightIndex += 1) {
      const right = symbols[rightIndex];
      let sum = 0;
      for (let index = startIndex; index <= signalIndex; index += 1) {
        sum += (returnsBySymbol[left][index] - means[left]) * (returnsBySymbol[right][index] - means[right]);
      }
      const covariance = sum / (lookback - 1);
      if (!Number.isFinite(covariance)) return null;
      matrix[left][right] = covariance;
      matrix[right][left] = covariance;
    }
  }
  // Correlation distance and inverse-variance allocation are undefined for a
  // zero-variance input. Fail closed so the caller leaves the sleeve in BIL.
  if (symbols.some((symbol) => !(matrix[symbol][symbol] > 1e-20))) return null;
  return Object.freeze(Object.fromEntries(symbols.map((left) => [
    left,
    Object.freeze({ ...matrix[left] }),
  ])));
}

function correlationDistance(left, right, covariance) {
  const denominator = Math.sqrt(covariance[left][left] * covariance[right][right]);
  if (!(denominator > 0)) return left === right ? 0 : Math.SQRT1_2;
  const correlation = Math.max(-1, Math.min(1, covariance[left][right] / denominator));
  return Math.sqrt(0.5 * (1 - correlation));
}

function clusterKey(cluster) {
  return cluster.symbols.join("|");
}

function singleLinkageDistance(left, right, covariance) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const leftSymbol of left.symbols) {
    for (const rightSymbol of right.symbols) {
      minimum = Math.min(minimum, correlationDistance(leftSymbol, rightSymbol, covariance));
    }
  }
  return minimum;
}

function deterministicQuasiDiagonalOrder(symbols, covariance) {
  let clusters = [...symbols].sort().map((symbol) => Object.freeze({
    symbols: Object.freeze([symbol]),
    leaf: symbol,
  }));
  while (clusters.length > 1) {
    let best = null;
    for (let leftIndex = 0; leftIndex < clusters.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
        const first = clusters[leftIndex];
        const second = clusters[rightIndex];
        const ordered = clusterKey(first).localeCompare(clusterKey(second)) <= 0
          ? [first, second]
          : [second, first];
        const candidate = {
          leftIndex,
          rightIndex,
          left: ordered[0],
          right: ordered[1],
          distance: singleLinkageDistance(first, second, covariance),
          tieKey: `${clusterKey(ordered[0])}::${clusterKey(ordered[1])}`,
        };
        if (!best || candidate.distance < best.distance - 1e-15
          || (Math.abs(candidate.distance - best.distance) <= 1e-15
            && candidate.tieKey.localeCompare(best.tieKey) < 0)) best = candidate;
      }
    }
    const merged = Object.freeze({
      symbols: Object.freeze([...best.left.symbols, ...best.right.symbols].sort()),
      left: best.left,
      right: best.right,
    });
    clusters = clusters.filter((_, index) => index !== best.leftIndex && index !== best.rightIndex);
    clusters.push(merged);
    clusters.sort((left, right) => clusterKey(left).localeCompare(clusterKey(right)));
  }
  const order = [];
  const visit = (cluster) => {
    if (cluster.leaf) {
      order.push(cluster.leaf);
      return;
    }
    visit(cluster.left);
    visit(cluster.right);
  };
  visit(clusters[0]);
  return Object.freeze(order);
}

function inverseVarianceClusterVariance(symbols, covariance) {
  const inverseVariances = symbols.map((symbol) => {
    const variance = covariance[symbol][symbol];
    return Number.isFinite(variance) && variance > 1e-20 ? 1 / variance : 0;
  });
  const denominator = inverseVariances.reduce((sum, value) => sum + value, 0);
  const weights = denominator > 0
    ? inverseVariances.map((value) => value / denominator)
    : inverseVariances.map(() => 1 / inverseVariances.length);
  let variance = 0;
  for (let leftIndex = 0; leftIndex < symbols.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < symbols.length; rightIndex += 1) {
      variance += weights[leftIndex] * weights[rightIndex]
        * covariance[symbols[leftIndex]][symbols[rightIndex]];
    }
  }
  return Math.max(0, variance);
}

/** Deterministic single-linkage HRP weights for an already selected universe. */
export function generation6HierarchicalRiskParityWeights(symbols, returnsBySymbol, signalIndex) {
  const orderedSymbols = [...new Set(symbols)].sort();
  if (orderedSymbols.length === 0) return Object.freeze({});
  const covariance = covarianceMatrix(orderedSymbols, returnsBySymbol, signalIndex, 252);
  if (!covariance) return Object.freeze({});
  const quasiDiagonalOrder = deterministicQuasiDiagonalOrder(orderedSymbols, covariance);
  const weights = Object.fromEntries(quasiDiagonalOrder.map((symbol) => [symbol, 1]));
  let clusters = [quasiDiagonalOrder];
  while (clusters.length > 0) {
    const next = [];
    for (const cluster of clusters) {
      if (cluster.length <= 1) continue;
      const midpoint = Math.floor(cluster.length / 2);
      const left = Object.freeze(cluster.slice(0, midpoint));
      const right = Object.freeze(cluster.slice(midpoint));
      const leftVariance = inverseVarianceClusterVariance(left, covariance);
      const rightVariance = inverseVarianceClusterVariance(right, covariance);
      const totalVariance = leftVariance + rightVariance;
      const leftAllocation = totalVariance > 1e-20 ? rightVariance / totalVariance : 0.50;
      for (const symbol of left) weights[symbol] *= leftAllocation;
      for (const symbol of right) weights[symbol] *= 1 - leftAllocation;
      if (left.length > 1) next.push(left);
      if (right.length > 1) next.push(right);
    }
    clusters = next;
  }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || Object.values(weights).some((value) => !Number.isFinite(value) || value < 0)) {
    return Object.freeze({});
  }
  return Object.freeze(Object.fromEntries(Object.entries(weights)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, weight]) => [symbol, weight / total])));
}

function hrpTrendWeights(points, returnsBySymbol, signalIndex) {
  const eligible = GENERATION6_CROSS_ASSET_UNIVERSE.filter((symbol) => {
    const momentum = excessLogReturn(points, symbol, signalIndex, 252);
    return Number.isFinite(momentum) && momentum > 0 && aboveInclusiveSma(points, symbol, signalIndex);
  });
  if (eligible.length === 0) return cashOnly();
  const risky = generation6HierarchicalRiskParityWeights(eligible, returnsBySymbol, signalIndex);
  return normalizeLongWeights(risky, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function blendWeightVectors(vectors) {
  const raw = {};
  for (const vector of vectors) {
    for (const [symbol, weight] of Object.entries(vector)) {
      if (symbol !== CASH_SYMBOL) raw[symbol] = (raw[symbol] ?? 0) + weight / vectors.length;
    }
  }
  return normalizeLongWeights(raw, { cashSymbol: CASH_SYMBOL, maximumRiskyGross: MAXIMUM_RISKY_GROSS });
}

function strategy(id, decide) {
  return Object.freeze({ id, rebalanceIntervalSessions: REBALANCE_INTERVAL_SESSIONS, decide });
}

export function createGeneration6Strategies() {
  return Object.freeze([
    strategy("faber_gtaa5_trend", ({ points, signalIndex }) => faberGtaa5Weights(points, signalIndex)),
    strategy("g6_trend_guard_g4", ({ points, signalIndex }) => trendGuardG4Weights(points, signalIndex)),
    strategy("g6_vol_target_g4", ({ points, returnsBySymbol, signalIndex }) => (
      volatilityTargetG4Weights(points, returnsBySymbol, signalIndex)
    )),
    strategy("g6_breadth_scaled_g4", ({ points, signalIndex }) => breadthScaledG4Weights(points, signalIndex)),
    strategy("g6_residual_sector", ({ points, signalIndex }) => residualSectorWeights(points, signalIndex)),
    strategy("g6_long_only_tsmom_1_3_12", ({ points, returnsBySymbol, signalIndex }) => (
      longOnlyTsmomWeights(points, returnsBySymbol, signalIndex)
    )),
    strategy("g6_hrp_trend", ({ points, returnsBySymbol, signalIndex }) => (
      hrpTrendWeights(points, returnsBySymbol, signalIndex)
    )),
    strategy("g6_equal_evidence_ensemble", ({ points, returnsBySymbol, signalIndex }) => blendWeightVectors([
      trendGuardG4Weights(points, signalIndex),
      residualSectorWeights(points, signalIndex, { ensembleComponent: true }),
      longOnlyTsmomWeights(points, returnsBySymbol, signalIndex),
      hrpTrendWeights(points, returnsBySymbol, signalIndex),
    ])),
  ]);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const GENERATION6_METADATA = deepFreeze({
  faber_gtaa5_trend: {
    role: "literature_control",
    eligible: false,
    mechanism: "Five fixed 20% SPY/EFA/IEF/VNQ/DBC slots; each slot is invested only above its inclusive SMA210 and otherwise remains in BIL.",
    parameters: {
      rebalance_interval_sessions: 21,
      symbols: GTAA5_SYMBOLS,
      slot_weight: 0.20,
      inclusive_sma_sessions: 210,
    },
    source_pins: [{
      title: "A Quantitative Approach to Tactical Asset Allocation",
      authors: "Mebane T. Faber",
      doi: "10.2139/ssrn.962461",
      url: "https://doi.org/10.2139/ssrn.962461",
    }],
  },
  g6_trend_guard_g4: {
    role: "candidate",
    eligible: true,
    mechanism: "Apply an inclusive SMA210 gate independently to the frozen G4 allocation's 50% QQQ sleeve and three fixed one-sixth 12-minus-6 sector sleeves; failed slots remain in BIL.",
    parameters: {
      rebalance_interval_sessions: 21,
      core_symbol: "QQQ",
      core_weight: 0.50,
      sector_count: 3,
      sector_slot_weight: G4_SECTOR_SLOT_WEIGHT,
      momentum_start_sessions: 252,
      momentum_end_sessions: 126,
      inclusive_sma_sessions: 210,
    },
    source_pins: [{
      title: "A Quantitative Approach to Tactical Asset Allocation",
      authors: "Mebane T. Faber",
      doi: "10.2139/ssrn.962461",
      url: "https://doi.org/10.2139/ssrn.962461",
    }, {
      title: "Do Industries Explain Momentum?",
      authors: "Tobias J. Moskowitz, Mark Grinblatt",
      doi: "10.1111/0022-1082.00146",
      url: "https://doi.org/10.1111/0022-1082.00146",
    }],
  },
  g6_vol_target_g4: {
    role: "candidate",
    eligible: true,
    mechanism: "Scale the frozen G4 risky target by min(1, 10% divided by its static-target annualized volatility over the latest 22 daily returns); hold the residual in BIL.",
    parameters: {
      rebalance_interval_sessions: 21,
      annualized_volatility_target: VOLATILITY_TARGET,
      volatility_lookback_sessions: VOLATILITY_LOOKBACK,
      maximum_risky_gross: MAXIMUM_RISKY_GROSS,
    },
    source_pins: [{
      title: "Volatility-Managed Portfolios",
      authors: "Alan Moreira, Tyler Muir",
      doi: "10.1111/jofi.12513",
      url: "https://doi.org/10.1111/jofi.12513",
    }],
  },
  g6_breadth_scaled_g4: {
    role: "candidate",
    eligible: true,
    mechanism: "Scale every frozen G4 risky sleeve by the fraction of the original nine sectors with positive 21-session excess log return over BIL; hold the residual in BIL.",
    parameters: {
      rebalance_interval_sessions: 21,
      breadth_horizon_sessions: 21,
      breadth_symbols: SECTOR_SYMBOLS,
      maximum_risky_gross: MAXIMUM_RISKY_GROSS,
    },
    source_pins: [{
      title: "Herding for profits: Market breadth and the cross-section of global equity returns",
      authors: "Adam Zaremba, Adam Szyszka, Andreas Karathanasopoulos, Mateusz Mikutowski",
      doi: "10.1016/j.econmod.2020.04.006",
      url: "https://doi.org/10.1016/j.econmod.2020.04.006",
    }],
  },
  g6_residual_sector: {
    role: "candidate",
    eligible: true,
    mechanism: "Fit each sector's SPY-minus-BIL and QQQ-minus-SPY betas with an intercept over the t-756..t-21 price-endpoint window; rank t-252..t-21 factor-stripped return sum divided by sample deviation without subtracting the intercept, then hold 50% SPY plus fixed one-sixth slots for up to three positive sectors.",
    parameters: {
      rebalance_interval_sessions: 21,
      minimum_signal_index: RESIDUAL_MINIMUM_SIGNAL_INDEX,
      regression_price_endpoint_start: -756,
      regression_price_endpoint_end: -21,
      score_price_endpoint_start: -252,
      score_price_endpoint_end: -21,
      subtract_fitted_intercept_in_score: false,
      core_symbol: "SPY",
      core_weight: 0.50,
      maximum_positive_sectors: 3,
      sector_slot_weight: G4_SECTOR_SLOT_WEIGHT,
    },
    source_pins: [{
      title: "Residual Momentum",
      authors: "David Blitz, Joop Huij, Martin Martens",
      doi: "10.1016/j.jempfin.2011.01.003",
      url: "https://doi.org/10.1016/j.jempfin.2011.01.003",
    }, {
      title: "Do Industries Explain Momentum?",
      authors: "Tobias J. Moskowitz, Mark Grinblatt",
      doi: "10.1111/0022-1082.00146",
      url: "https://doi.org/10.1111/0022-1082.00146",
    }],
  },
  g6_long_only_tsmom_1_3_12: {
    role: "candidate",
    eligible: true,
    mechanism: "For each 21/63/252-session horizon, inverse-EWMA-volatility weight cross-asset ETFs with positive BIL-excess log return; average the three fully funded sleeves equally and leave empty sleeves in BIL.",
    parameters: {
      rebalance_interval_sessions: 21,
      horizons_sessions: TSMOM_HORIZONS,
      universe: GENERATION6_CROSS_ASSET_UNIVERSE,
      ewma_delta: 60 / 61,
      horizon_sleeve_weight: 1 / 3,
    },
    source_pins: [{
      title: "Time Series Momentum",
      authors: "Tobias J. Moskowitz, Yao Hua Ooi, Lasse Heje Pedersen",
      doi: "10.1016/j.jfineco.2011.11.003",
      url: "https://doi.org/10.1016/j.jfineco.2011.11.003",
    }, {
      title: "Time series momentum and volatility scaling",
      authors: "Abby Y. Kim, Yiuman Tse, John K. Wald",
      doi: "10.1016/j.finmar.2016.05.003",
      url: "https://doi.org/10.1016/j.finmar.2016.05.003",
    }],
  },
  g6_hrp_trend: {
    role: "candidate",
    eligible: true,
    mechanism: "Admit cross-asset ETFs only with positive 252-session BIL-excess momentum and price above inclusive SMA210, then allocate with deterministic single-linkage hierarchical risk parity from a 252-session covariance matrix.",
    parameters: {
      rebalance_interval_sessions: 21,
      universe: GENERATION6_CROSS_ASSET_UNIVERSE,
      momentum_horizon_sessions: 252,
      inclusive_sma_sessions: 210,
      covariance_lookback_sessions: 252,
      linkage: "single",
      correlation_distance: "sqrt(0.5*(1-rho))",
      leaf_order: "deterministic_quasi_diagonal",
      allocation: "recursive_bisection_inverse_variance_cluster_variance",
      tie_break: "alphabetical",
      degenerate_covariance_policy: "fail_closed_to_bil_if_any_eligible_asset_variance_is_not_strictly_above_1e-20",
    },
    source_pins: [{
      title: "Building Diversified Portfolios that Outperform Out of Sample",
      authors: "Marcos Lopez de Prado",
      doi: "10.2139/ssrn.2708678",
      url: "https://doi.org/10.2139/ssrn.2708678",
    }],
  },
  g6_equal_evidence_ensemble: {
    role: "candidate",
    eligible: true,
    mechanism: "Equal 25% weight-vector blend of the trend-guard, residual-sector, 1/3/12 TSMOM, and HRP-trend candidates; before residual history is available, that quarter remains entirely in BIL.",
    parameters: {
      rebalance_interval_sessions: 21,
      component_weight: 0.25,
      components: [
        "g6_trend_guard_g4",
        "g6_residual_sector",
        "g6_long_only_tsmom_1_3_12",
        "g6_hrp_trend",
      ],
      residual_component_before_756: "BIL",
    },
    source_pins: [{
      title: "Optimal Versus Naive Diversification: How Inefficient is the 1/N Portfolio Strategy?",
      authors: "Victor DeMiguel, Lorenzo Garlappi, Raman Uppal",
      doi: "10.1093/rfs/hhm075",
      url: "https://doi.org/10.1093/rfs/hhm075",
    }],
  },
});
