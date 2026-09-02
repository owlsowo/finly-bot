import { compileIntent } from "./compiler.mjs";
import { sha256 } from "./canonical.mjs";
import { LIVE_ALPHA_CONFIDENCE_POLICY, POLICY } from "./policy.mjs";
import { blackScholesPrice } from "./quant.mjs";

export const CALIBRATION_SCHEMA = "finly_options_policy_calibration.v2";
const SPOT = 560;
const OBSERVED_AT = "2026-08-28T18:30:03.000Z";
const EXPIRY = "2026-09-11";
const LOOKBACK_RETURNS = 96;
const STRIDE_SESSIONS = 5;

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function standardDeviation(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function momentumScore(returns) {
  const recent = returns.slice(-20);
  const sigma = Math.max(standardDeviation(recent), 0.001);
  const momentum5 = returns.slice(-5).reduce((sum, value) => sum + value, 0);
  const momentum20 = recent.reduce((sum, value) => sum + value, 0);
  return Math.tanh((0.65 * momentum5 / (sigma * Math.sqrt(5))
    + 0.35 * momentum20 / (sigma * Math.sqrt(20))) / 2);
}

function optionSymbol(type, strike) {
  return `SPY260911${type === "call" ? "C" : "P"}${String(strike * 1_000).padStart(8, "0")}`;
}

function modeledChain({ askImprovement = 0 } = {}) {
  const rows = [];
  for (let strike = 520; strike <= 600; strike += 5) {
    for (const type of ["call", "put"]) {
      const midpoint = blackScholesPrice({
        type,
        spot: SPOT,
        strike,
        timeYears: 14 / 365,
        volatility: 0.20,
        rate: POLICY.interestRate,
      });
      const bid = Math.max(0.01, Math.round((midpoint - 0.05) * 100) / 100);
      const ask = Math.max(bid + 0.01, Math.round((midpoint + 0.05 - askImprovement) * 100) / 100);
      rows.push({
        underlying: "SPY",
        symbol: optionSymbol(type, strike),
        type,
        expiry: EXPIRY,
        strike,
        bid,
        ask,
        iv: 0.20,
        dte: 14,
        feed: "indicative",
        quote_age_seconds: 2,
        open_interest: 1_000,
        tradable: true,
      });
    }
  }
  return rows;
}

function validateInput(input) {
  assert(input?.schema_version === "finly_spy_adjusted_close_calibration_input.v1", "calibration input schema is invalid");
  assert(input.source?.provider === "Alpaca Market Data" && input.source?.adjustment === "all", "calibration source is invalid");
  assert(/^sha256:[a-f0-9]{64}$/.test(input.source.source_artifact_sha256), "calibration source hash is invalid");
  assert(Array.isArray(input.rows) && input.rows.length >= LOOKBACK_RETURNS + 1, "calibration rows are insufficient");
  let prior = null;
  for (const row of input.rows) {
    assert(Object.keys(row).sort().join(",") === "adjusted_close,timestamp", "calibration row shape is invalid");
    assert(typeof row.timestamp === "string" && Number.isFinite(new Date(row.timestamp).getTime()), "calibration timestamp is invalid");
    assert(Number.isFinite(row.adjusted_close) && row.adjusted_close > 0, "calibration close is invalid");
    assert(prior === null || row.timestamp > prior, "calibration timestamps are not strictly increasing");
    prior = row.timestamp;
  }
  assert(input.rows[0].timestamp.startsWith(input.source.first_session), "calibration first session is invalid");
  assert(input.rows.at(-1).timestamp.startsWith(input.source.last_session), "calibration last session is invalid");
}

function returnsEndingAt(rows, index) {
  const returns = [];
  for (let cursor = index - LOOKBACK_RETURNS + 1; cursor <= index; cursor += 1) {
    returns.push(Math.log(rows[cursor].adjusted_close / rows[cursor - 1].adjusted_close));
  }
  return returns;
}

function intentFor(inputSha256, row, returns) {
  const directionScore = momentumScore(returns);
  return {
    schema_version: "finly_intent.v1",
    underlying: "SPY",
    direction: directionScore > 0 ? "bullish" : "bearish",
    direction_score: directionScore,
    volatility_score: 0,
    coverage: 0.55,
    agreement: 0.65,
    active_weight: 0.55,
    horizon_sessions: 3,
    source_families: ["market", "options"],
    evidence_root: sha256({ input_sha256: inputSha256, session: row.timestamp, returns }),
  };
}

function summarizeSelection(row, intent, selected) {
  return Object.freeze({
    session: row.timestamp.slice(0, 10),
    direction: intent.direction,
    direction_score: round(intent.direction_score, 8),
    action: selected.action,
    long_strike: selected.long_leg.strike,
    short_strike: selected.short_leg.strike,
    max_loss_dollars: selected.max_loss,
    reward_risk: selected.reward_risk,
    conservative_ev_dollars: selected.conservative_ev,
    probability_profit: selected.probability_profit,
    required_ev_dollars: selected.required_ev,
    model_lower_confidence_bounds: Object.freeze(Object.fromEntries(
      selected.model_results.map((model) => [model.model, model.lower_confidence_bound]),
    )),
  });
}

function range(windows, field) {
  if (windows.length === 0) return { minimum: null, maximum: null };
  const values = windows.map((window) => window[field]);
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function summarizeSurface(windows, sampleCount) {
  return {
    eligible_count: windows.length,
    eligible_rate: round(windows.length / sampleCount, 8),
    direction_mix: {
      bullish: windows.filter((window) => window.direction === "bullish").length,
      bearish: windows.filter((window) => window.direction === "bearish").length,
    },
    ranges: {
      max_loss_dollars: range(windows, "max_loss_dollars"),
      conservative_ev_dollars: range(windows, "conservative_ev_dollars"),
      probability_profit: range(windows, "probability_profit"),
      reward_risk: range(windows, "reward_risk"),
    },
    eligible_windows: windows,
  };
}

export function buildOptionsPolicyCalibration(input) {
  validateInput(input);
  const inputSha256 = sha256(input);
  const fairChain = modeledChain();
  const improvedChain = modeledChain({ askImprovement: 0.04 });
  let sampleCount = 0;
  const fairEligibleWindows = [];
  const improvedEligibleWindows = [];
  for (let index = LOOKBACK_RETURNS; index < input.rows.length; index += STRIDE_SESSIONS) {
    const row = input.rows[index];
    const historicalLogReturns = returnsEndingAt(input.rows, index);
    const intent = intentFor(inputSha256, row, historicalLogReturns);
    const market = {
      spot: SPOT,
      observed_at: OBSERVED_AT,
      historical_log_returns: historicalLogReturns,
      interest_rate: POLICY.interestRate,
    };
    const compilerOptions = {
      maxLossBudget: 500,
      alphaPolicy: LIVE_ALPHA_CONFIDENCE_POLICY,
    };
    const fair = compileIntent(intent, fairChain, market, compilerOptions);
    const improved = compileIntent(intent, improvedChain, market, compilerOptions);
    sampleCount += 1;
    if (fair.selected) fairEligibleWindows.push(summarizeSelection(row, intent, fair.selected));
    if (improved.selected) improvedEligibleWindows.push(summarizeSelection(row, intent, improved.selected));
  }
  const body = {
    schema_version: CALIBRATION_SCHEMA,
    artifact_kind: "signal_and_quote_surface_eligibility_calibration",
    claim_boundary: {
      historical_options_pnl_measured: false,
      historical_option_quotes_used: false,
      broker_orders_or_fills_used: false,
      interpretation: "Measures how often historical SPY momentum signals pass the live compiler under two fixed modeled quote surfaces. It is not an options return backtest or evidence of realized profitability.",
    },
    input: {
      input_sha256: inputSha256,
      source_artifact_sha256: input.source.source_artifact_sha256,
      provider: input.source.provider,
      adjustment: input.source.adjustment,
      first_session: input.source.first_session,
      last_session: input.source.last_session,
      adjusted_close_count: input.rows.length,
    },
    sampling: {
      historical_return_lookback_sessions: LOOKBACK_RETURNS,
      stride_sessions: STRIDE_SESSIONS,
      sample_count: sampleCount,
      first_sample_session: input.rows[LOOKBACK_RETURNS].timestamp.slice(0, 10),
      last_sample_session: input.rows[LOOKBACK_RETURNS + (sampleCount - 1) * STRIDE_SESSIONS].timestamp.slice(0, 10),
    },
    modeled_quote_surface: {
      fixed_spot_dollars: SPOT,
      fixed_observed_at: OBSERVED_AT,
      dte: 14,
      annualized_implied_volatility: 0.20,
      strike_minimum: 520,
      strike_maximum: 600,
      strike_step: 5,
      fair_half_spread_dollars: 0.05,
      favorable_long_ask_improvement_dollars: 0.04,
      modeled_slippage_per_leg_dollars: POLICY.slippagePerLegDollars,
    },
    policy: {
      base_policy_sha256: sha256(POLICY),
      live_alpha_policy_sha256: sha256(LIVE_ALPHA_CONFIDENCE_POLICY),
      max_loss_budget_dollars: 500,
    },
    results: {
      fair_surface: summarizeSurface(fairEligibleWindows, sampleCount),
      favorable_surface: summarizeSurface(improvedEligibleWindows, sampleCount),
    },
  };
  return Object.freeze({ ...body, artifact_sha256: sha256(body) });
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
