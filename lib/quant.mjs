import { POLICY } from "./policy.mjs";

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

export function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

export function inverseNormal(probability) {
  if (!(probability > 0 && probability < 1)) throw new RangeError("probability must be between zero and one");
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function blackScholesPrice({ type, spot, strike, timeYears, volatility, rate = POLICY.interestRate, dividend = POLICY.dividendYield }) {
  if (timeYears <= 0) return type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const sigmaRootT = volatility * Math.sqrt(timeYears);
  const d1 = (Math.log(spot / strike) + (rate - dividend + volatility ** 2 / 2) * timeYears) / sigmaRootT;
  const d2 = d1 - sigmaRootT;
  if (type === "call") {
    return spot * Math.exp(-dividend * timeYears) * normalCdf(d1)
      - strike * Math.exp(-rate * timeYears) * normalCdf(d2);
  }
  return strike * Math.exp(-rate * timeYears) * normalCdf(-d2)
    - spot * Math.exp(-dividend * timeYears) * normalCdf(-d1);
}

function seededRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleStandardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  return { mean, standardDeviation: Math.sqrt(variance) };
}

export function scenarioPrices({
  spot,
  intent,
  iv,
  horizonSessions,
  model,
  count = POLICY.scenarioPathCount,
  historicalLogReturns = [],
  seed = "finly",
}) {
  const timeYears = horizonSessions / 252;
  if (model === "vol_scaled_block_bootstrap") {
    if (!Array.isArray(historicalLogReturns) || historicalLogReturns.length < Math.max(20, POLICY.bootstrapBlockSessions * 4)) {
      throw new Error("block bootstrap requires at least 20 historical log returns");
    }
    if (!historicalLogReturns.every(Number.isFinite)) throw new Error("historical log returns must be finite");
    const statistics = sampleStandardDeviation(historicalLogReturns);
    if (statistics.standardDeviation <= 0) throw new Error("historical returns have zero variance");
    const targetDailyVolatility = (0.55 * statistics.standardDeviation + 0.45 * iv / Math.sqrt(252))
      * (1 + 0.12 * intent.volatility_score);
    const scale = targetDailyVolatility / statistics.standardDeviation;
    const directionalTiltPerSession = intent.direction_score * 0.00115;
    const random = seededRandom(`${seed}:${model}:${horizonSessions}:${count}`);
    const values = [];
    for (let path = 0; path < count; path += 1) {
      let logReturn = 0;
      let consumed = 0;
      while (consumed < horizonSessions) {
        const start = Math.floor(random() * historicalLogReturns.length);
        for (let offset = 0; offset < POLICY.bootstrapBlockSessions && consumed < horizonSessions; offset += 1) {
          const raw = historicalLogReturns[(start + offset) % historicalLogReturns.length];
          logReturn += (raw - statistics.mean) * scale + statistics.mean + directionalTiltPerSession;
          consumed += 1;
        }
      }
      values.push(spot * Math.exp(logReturn));
    }
    return values;
  }
  if (model !== "tilted_implied_distribution") throw new Error(`unknown scenario model: ${model}`);
  const annualizedDirectionalDrift = intent.direction_score * 0.38;
  const annualizedVolatility = Math.max(0.08, iv * (1 + 0.12 * intent.volatility_score));
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const z = inverseNormal((index + 0.5) / count);
    const logReturn = (annualizedDirectionalDrift - annualizedVolatility ** 2 / 2) * timeYears
      + annualizedVolatility * Math.sqrt(timeYears) * z;
    values.push(spot * Math.exp(logReturn));
  }
  return values;
}

export function summarize(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const sorted = [...values].sort((left, right) => left - right);
  const tailCount = Math.max(1, Math.ceil(sorted.length * 0.05));
  const expectedShortfall95 = sorted.slice(0, tailCount).reduce((sum, value) => sum + value, 0) / tailCount;
  return {
    mean,
    standardDeviation: Math.sqrt(variance),
    standardError: Math.sqrt(variance / values.length),
    probabilityPositive: values.filter((value) => value > 0).length / values.length,
    expectedShortfall95,
  };
}

export function normalPdf(value) {
  return Math.exp(-(value ** 2) / 2) / SQRT_TWO_PI;
}
