import { sha256, stableStringify } from "../lib/canonical.mjs";
import {
  calculateExecutionMetrics,
  frozenPolicyTarget,
  round,
} from "./equity_execution_realism.mjs";

const TRADING_DAYS = 252;
const BASE_LOOKBACK = 20;
const EXTENDED_LOOKBACK = 40;
const MINIMUM_BASE_NEGATIVES = 3;
const TARGET_VOLATILITY = 0.10;
const REBALANCE_INTERVAL = 5;
const TREND_HORIZONS = Object.freeze([21, 63, 252]);
const COST_STRESS_BPS = Object.freeze([1, 5, 10, 25]);
const CADENCE_ANCHORS = Object.freeze([0, 1, 2, 3, 4]);
const EXECUTION_BOOKS = Object.freeze(["adjusted", "raw"]);

export const LAST_CONSUMED_SESSION = "2026-08-28";
export const FIRST_ELIGIBLE_SIGNAL_SESSION = "2026-08-31";
export const FIRST_ELIGIBLE_EXECUTION_SESSION = "2026-09-01";
export const REQUIRED_PROSPECTIVE_RETURNS = 252;
export const DOWNSIDE_SEMIVOLATILITY_PROTOCOL_SCHEMA =
  "finly_downside_semivolatility_challenger_protocol.v1";
export const DOWNSIDE_SEMIVOLATILITY_PROTOCOL_ID =
  "downside_semivolatility_challenger_v1";
export const DOWNSIDE_SEMIVOLATILITY_ATTEMPT_NUMBER = 115;
export const DOWNSIDE_SEMIVOLATILITY_PROTOCOL_SHA256 =
  "sha256:340ba21e8e3404bd42adcd8e4e30ea5f0f327ee2d891988564ca3f0654657619";
export const DOWNSIDE_SEMIVOLATILITY_POLICY_ID =
  "tsmom_ensemble_downside_semivol";
export const FROZEN_INCUMBENT_POLICY_ID = "tsmom_ensemble_vol";

function fail(message) {
  throw new TypeError(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (!(number > 0)) fail(`${label} must be positive`);
  return number;
}

function isoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${label} must be an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be an ISO date`);
  }
  return value;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function latestValidReturns(returns, count) {
  if (!Array.isArray(returns) || returns.length < count) {
    fail(`at least ${count} fully observed returns are required`);
  }
  const latest = returns.slice(-count);
  latest.forEach((value, index) => {
    finiteNumber(value, `return ${returns.length - count + index}`);
    if (value <= -1) fail("simple returns must exceed -1");
  });
  return latest;
}

export function incumbentTotalVolatilityEstimate(returns) {
  const latest = latestValidReturns(returns, BASE_LOOKBACK);
  return sampleStandardDeviation(latest) * Math.sqrt(TRADING_DAYS);
}

/**
 * Zero-threshold downside semivolatility motivated by Wang and Yan (2021).
 * n is always the full selected window length, not the negative-return count.
 */
export function estimateDownsideSemivolatility(returns) {
  const latest40 = latestValidReturns(returns, EXTENDED_LOOKBACK);
  const latest20 = latest40.slice(-BASE_LOOKBACK);
  const baseNegativeCount = latest20.filter((value) => value < 0).length;
  const selectedLookback = baseNegativeCount < MINIMUM_BASE_NEGATIVES
    ? EXTENDED_LOOKBACK
    : BASE_LOOKBACK;
  const selected = latest40.slice(-selectedLookback);
  const negativeReturns = selected.filter((value) => value < 0);
  const sumNegativeSquares = negativeReturns.reduce((sum, value) => sum + (value ** 2), 0);
  const downsideBeforeFallback = Math.sqrt(
    (2 * TRADING_DAYS / selectedLookback) * sumNegativeSquares,
  );
  const fallbackUsed = selectedLookback === EXTENDED_LOOKBACK
    && (downsideBeforeFallback === 0 || !Number.isFinite(downsideBeforeFallback));

  return deepFreeze({
    annualized_volatility: fallbackUsed
      ? incumbentTotalVolatilityEstimate(latest40)
      : downsideBeforeFallback,
    selected_lookback_sessions: selectedLookback,
    base_negative_return_count: baseNegativeCount,
    selected_negative_return_count: negativeReturns.length,
    downside_semivolatility_before_fallback: downsideBeforeFallback,
    incumbent_total_volatility_fallback_used: fallbackUsed,
    fallback_reason: fallbackUsed
      ? (downsideBeforeFallback === 0
        ? "EXTENDED_40_SESSION_VALUE_ZERO"
        : "EXTENDED_40_SESSION_VALUE_NONFINITE")
      : null,
  });
}

function closeValue(point, symbol) {
  const value = point?.[symbol];
  return positiveNumber(typeof value === "number" ? value : value?.close, `${symbol} close`);
}

function logCloseReturn(points, symbol, startIndex, endIndex) {
  if (startIndex < 0 || endIndex >= points.length || startIndex >= endIndex) {
    fail(`${symbol} close-return indices are invalid`);
  }
  return Math.log(closeValue(points[endIndex], symbol) / closeValue(points[startIndex], symbol));
}

function latestSimpleSpyReturns(points, signalIndex) {
  if (!Array.isArray(points) || signalIndex < EXTENDED_LOOKBACK || signalIndex >= points.length) {
    fail("signal index lacks 40 fully observed SPY returns");
  }
  const returns = [];
  for (let index = signalIndex - EXTENDED_LOOKBACK + 1; index <= signalIndex; index += 1) {
    returns.push(closeValue(points[index], "SPY") / closeValue(points[index - 1], "SPY") - 1);
  }
  return returns;
}

export function downsideSemivolatilityTarget(points, signalIndex) {
  if (!Array.isArray(points) || signalIndex < Math.max(...TREND_HORIZONS)
    || signalIndex >= points.length) {
    fail("signal index is outside the downside-semivolatility policy history");
  }
  const volatility = estimateDownsideSemivolatility(
    latestSimpleSpyReturns(points, signalIndex),
  );
  const excessTrends = TREND_HORIZONS.map((lookback) => (
    logCloseReturn(points, "SPY", signalIndex - lookback, signalIndex)
    - logCloseReturn(points, "BIL", signalIndex - lookback, signalIndex)
  ));
  const positiveTrendFraction = excessTrends.filter((value) => value > 0).length
    / excessTrends.length;
  const estimate = volatility.annualized_volatility;
  const volatilityScale = Number.isFinite(estimate) && estimate > 0
    ? Math.min(1, TARGET_VOLATILITY / estimate)
    : 0;
  const spyWeight = Math.min(1, Math.max(0, positiveTrendFraction * volatilityScale));

  return deepFreeze({
    SPY: spyWeight,
    BIL: 1 - spyWeight,
    diagnostics: {
      positive_trend_fraction: positiveTrendFraction,
      selected_annualized_spy_volatility: estimate,
      volatility_scale: volatilityScale,
      downside_semivolatility: volatility,
      excess_log_returns: Object.fromEntries(
        TREND_HORIZONS.map((lookback, index) => [String(lookback), excessTrends[index]]),
      ),
    },
  });
}

function sameDates(left, right) {
  return left.length === right.length
    && left.every((point, index) => point.date === right[index].date);
}

function validateImportedBook(book, label) {
  if (!book || !Array.isArray(book.points) || book.points.length < 255) {
    fail(`${label} imported OHLC book is incomplete`);
  }
  if (!Number.isSafeInteger(book.common_sessions)
    || book.common_sessions !== book.points.length
    || book.common_start !== book.points[0]?.date
    || book.common_end !== book.points.at(-1)?.date
    || typeof book.normalized_sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(book.normalized_sha256)) {
    fail(`${label} imported OHLC metadata is invalid`);
  }
  let priorDate = "";
  book.points.forEach((point, index) => {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      fail(`${label} imported OHLC point ${index} is invalid`);
    }
    const date = isoDate(point.date, `${label} imported OHLC point ${index} date`);
    if (date <= priorDate) fail(`${label} imported OHLC dates are duplicated or out of order`);
    priorDate = date;
    for (const symbol of ["SPY", "BIL"]) {
      if (!point[symbol] || typeof point[symbol] !== "object" || Array.isArray(point[symbol])) {
        fail(`${label} imported OHLC point ${index} omits ${symbol}`);
      }
      positiveNumber(point[symbol].open, `${label} ${symbol} open ${index}`);
      positiveNumber(point[symbol].close, `${label} ${symbol} close ${index}`);
    }
  });
}

function validateImportedEnvelope(imported, executionBook) {
  if (!imported || imported.schema_version !== "finly_immutable_ohlc_import.v1"
    || typeof imported.payload_sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(imported.payload_sha256)) {
    fail("prospective scorer requires the immutable OHLC importer envelope");
  }
  validateImportedBook(imported.adjusted, "adjusted");
  validateImportedBook(imported[executionBook], executionBook);
  if (!sameDates(imported.adjusted.points, imported[executionBook].points)) {
    fail("signal and execution OHLC dates are not aligned");
  }
}

function dueAt(step, anchor) {
  return ((step - anchor) % REBALANCE_INTERVAL + REBALANCE_INTERVAL) % REBALANCE_INTERVAL === 0;
}

function targetForPolicy(policyId, points, signalIndex) {
  if (policyId === DOWNSIDE_SEMIVOLATILITY_POLICY_ID) {
    return downsideSemivolatilityTarget(points, signalIndex);
  }
  if (policyId === FROZEN_INCUMBENT_POLICY_ID) return frozenPolicyTarget(points, signalIndex);
  fail(`unsupported comparison policy: ${policyId}`);
}

function validateSimulationOptions({
  policyId,
  executionBook,
  oneWayCostBps,
  rebalanceAnchor,
  evaluationStart,
  maximumRows,
}) {
  if (![FROZEN_INCUMBENT_POLICY_ID, DOWNSIDE_SEMIVOLATILITY_POLICY_ID].includes(policyId)) {
    fail("policyId must select the frozen incumbent or registered challenger");
  }
  if (!EXECUTION_BOOKS.includes(executionBook)) fail("executionBook must be adjusted or raw");
  finiteNumber(oneWayCostBps, "one-way cost");
  if (oneWayCostBps < 0 || oneWayCostBps > 1_000) fail("one-way cost must be between 0 and 1,000 bps");
  if (!Number.isSafeInteger(rebalanceAnchor) || !CADENCE_ANCHORS.includes(rebalanceAnchor)) {
    fail("rebalance anchor must be an integer from 0 through 4");
  }
  isoDate(evaluationStart, "evaluation start");
  if (evaluationStart <= LAST_CONSUMED_SESSION) {
    fail("prospective-only evaluation start must be after the consumed-history cutoff");
  }
  if (evaluationStart !== FIRST_ELIGIBLE_EXECUTION_SESSION) {
    fail("evaluation start must equal the registered prospective clock");
  }
  if (maximumRows !== null && (!Number.isSafeInteger(maximumRows) || maximumRows < 2)) {
    fail("maximumRows must be null or an integer of at least 2");
  }
}

/**
 * Pure prospective mechanics helper. It has no file, network, broker, or
 * persistence surface and rejects every scored execution in consumed history.
 */
export function simulateProspectivePolicyNextOpen(imported, {
  policyId,
  executionBook = "adjusted",
  oneWayCostBps = 5,
  rebalanceAnchor = 0,
  evaluationStart = FIRST_ELIGIBLE_EXECUTION_SESSION,
  maximumRows = null,
} = {}) {
  validateSimulationOptions({
    policyId,
    executionBook,
    oneWayCostBps,
    rebalanceAnchor,
    evaluationStart,
    maximumRows,
  });
  if (!imported?.adjusted?.points) fail("an imported adjusted OHLC book is required");
  validateImportedEnvelope(imported, executionBook);
  const signals = imported.adjusted.points;
  const prices = imported[executionBook]?.points;
  if (!prices) fail(`${executionBook} execution OHLC is unavailable`);

  let spyWeight = 0;
  let bilWeight = 1;
  let prospectiveStep = 0;
  const rows = [];
  for (let signalIndex = Math.max(...TREND_HORIZONS); signalIndex < signals.length - 1; signalIndex += 1) {
    const signalDate = signals[signalIndex].date;
    const executionDate = prices[signalIndex + 1].date;
    if (executionDate < evaluationStart) continue;
    if (signalDate <= LAST_CONSUMED_SESSION || executionDate <= LAST_CONSUMED_SESSION) {
      fail("consumed-history signal or execution reached the prospective scorer");
    }
    if (signalDate < FIRST_ELIGIBLE_SIGNAL_SESSION) {
      fail("scored signal precedes the separate prospective clock");
    }

    const spyOvernight = positiveNumber(
      prices[signalIndex + 1].SPY.open / prices[signalIndex].SPY.close,
      "SPY overnight growth",
    );
    const bilOvernight = positiveNumber(
      prices[signalIndex + 1].BIL.open / prices[signalIndex].BIL.close,
      "BIL overnight growth",
    );
    const overnightGrowth = spyWeight * spyOvernight + bilWeight * bilOvernight;
    positiveNumber(overnightGrowth, "portfolio overnight growth");
    const openSpyWeight = spyWeight * spyOvernight / overnightGrowth;
    const openBilWeight = bilWeight * bilOvernight / overnightGrowth;
    const rebalanced = dueAt(prospectiveStep, rebalanceAnchor);
    const target = rebalanced
      ? targetForPolicy(policyId, signals, signalIndex)
      : { SPY: openSpyWeight, BIL: openBilWeight };
    if (target.SPY < -1e-12 || target.BIL < -1e-12
      || target.SPY > 1 + 1e-12 || target.BIL > 1 + 1e-12
      || Math.abs(target.SPY + target.BIL - 1) > 1e-10) {
      fail("policy target violates long-only unlevered SPY/BIL bounds");
    }
    const turnover = Math.abs(target.SPY - openSpyWeight)
      + Math.abs(target.BIL - openBilWeight);
    const transactionCost = turnover * oneWayCostBps / 10_000;
    const spyIntraday = positiveNumber(
      prices[signalIndex + 1].SPY.close / prices[signalIndex + 1].SPY.open,
      "SPY intraday growth",
    );
    const bilIntraday = positiveNumber(
      prices[signalIndex + 1].BIL.close / prices[signalIndex + 1].BIL.open,
      "BIL intraday growth",
    );
    const intradayGrowth = target.SPY * spyIntraday + target.BIL * bilIntraday;
    if (!(intradayGrowth > 0) || !(transactionCost < 1)) {
      fail("portfolio intraday growth or transaction cost is invalid");
    }
    const netGrowth = positiveNumber(
      overnightGrowth * (1 - transactionCost) * intradayGrowth,
      "net portfolio growth",
    );
    const spyCloseGrowth = positiveNumber(
      prices[signalIndex + 1].SPY.close / prices[signalIndex].SPY.close,
      "SPY close-to-close growth",
    );
    const bilCloseGrowth = positiveNumber(
      prices[signalIndex + 1].BIL.close / prices[signalIndex].BIL.close,
      "BIL close-to-close growth",
    );
    spyWeight = target.SPY * spyIntraday / intradayGrowth;
    bilWeight = target.BIL * bilIntraday / intradayGrowth;
    rows.push(Object.freeze({
      policy_id: policyId,
      signal_date: signalDate,
      execution_date: executionDate,
      rebalanced,
      target_spy_weight: round(target.SPY),
      target_bil_weight: round(target.BIL),
      close_spy_weight: round(spyWeight),
      close_bil_weight: round(bilWeight),
      gross_two_leg_turnover: round(turnover),
      transaction_cost_fraction: round(transactionCost),
      net_return: round(netGrowth - 1, 12),
      spy_return: round(spyCloseGrowth - 1, 12),
      bil_return: round(bilCloseGrowth - 1, 12),
    }));
    prospectiveStep += 1;
    if (maximumRows !== null && rows.length === maximumRows) break;
  }
  if (rows.length < 2) fail("prospective evaluation produced fewer than two observations");
  if (rows[0].signal_date !== FIRST_ELIGIBLE_SIGNAL_SESSION
    || rows[0].execution_date !== FIRST_ELIGIBLE_EXECUTION_SESSION) {
    fail("prospective evaluation is missing the registered first signal or execution session");
  }
  if (rows.some((row) => row.execution_date <= LAST_CONSUMED_SESSION)) {
    fail("prospective evaluation emitted a consumed-history execution");
  }
  return Object.freeze(rows);
}

function assertPairedRows(incumbentRows, challengerRows) {
  if (incumbentRows.length !== challengerRows.length) fail("policy comparison row counts differ");
  incumbentRows.forEach((incumbent, index) => {
    const challenger = challengerRows[index];
    if (incumbent.signal_date !== challenger.signal_date
      || incumbent.execution_date !== challenger.execution_date
      || incumbent.rebalanced !== challenger.rebalanced
      || incumbent.spy_return !== challenger.spy_return
      || incumbent.bil_return !== challenger.bil_return) {
      fail(`policy comparison rows are not identically anchored at index ${index}`);
    }
  });
}

function comparisonDelta(challenger, incumbent) {
  const keys = [
    "total_return",
    "annualized_return",
    "annualized_volatility",
    "maximum_drawdown",
    "cumulative_gross_two_leg_turnover",
    "modeled_cost_drag_simple_sum",
  ];
  return Object.freeze(Object.fromEntries(keys.map((key) => [
    key,
    Number.isFinite(challenger[key]) && Number.isFinite(incumbent[key])
      ? round(challenger[key] - incumbent[key])
      : null,
  ])));
}

function validateExpectedExecutionSessions(value) {
  if (!Array.isArray(value) || value.length !== REQUIRED_PROSPECTIVE_RETURNS) {
    fail("expected execution sessions must contain exactly 252 dates");
  }
  const sessions = value.map((date, index) => isoDate(date, `expected execution session ${index + 1}`));
  if (sessions[0] !== FIRST_ELIGIBLE_EXECUTION_SESSION) {
    fail("expected execution sessions must begin at the registered first execution session");
  }
  for (let index = 1; index < sessions.length; index += 1) {
    if (sessions[index] <= sessions[index - 1]) {
      fail("expected execution sessions must be strictly increasing and unique");
    }
  }
  return Object.freeze(sessions);
}

function assertExpectedSessionChain(rows, expectedExecutionSessions) {
  const expectedSignalSessions = Object.freeze([
    FIRST_ELIGIBLE_SIGNAL_SESSION,
    ...expectedExecutionSessions.slice(0, -1),
  ]);
  const actualExecutionSessions = rows.map((row) => row.execution_date);
  const actualSignalSessions = rows.map((row) => row.signal_date);
  if (stableStringify(actualExecutionSessions) !== stableStringify(expectedExecutionSessions)
    || stableStringify(actualSignalSessions) !== stableStringify(expectedSignalSessions)) {
    fail("prospective rows do not match the complete expected signal and execution session chain");
  }
  return expectedSignalSessions;
}

/**
 * Fixed future-only comparison matrix. There is intentionally no historical
 * file runner: activation requires a later independently published runtime.
 */
export function compareProspectiveDownsideSemivolatility(imported, {
  protocolSha256 = DOWNSIDE_SEMIVOLATILITY_PROTOCOL_SHA256,
  expectedExecutionSessions,
} = {}) {
  if (protocolSha256 !== DOWNSIDE_SEMIVOLATILITY_PROTOCOL_SHA256) {
    fail("prospective comparison protocol hash changed");
  }
  if (!imported?.adjusted?.points || !imported?.raw?.points) {
    fail("prospective comparison requires aligned adjusted and raw OHLC books");
  }
  validateImportedEnvelope(imported, "adjusted");
  validateImportedEnvelope(imported, "raw");
  if (!sameDates(imported.adjusted.points, imported.raw.points)) {
    fail("adjusted and raw comparison dates are not aligned");
  }
  const expectedExecutions = validateExpectedExecutionSessions(expectedExecutionSessions);
  const expectedSignals = Object.freeze([
    FIRST_ELIGIBLE_SIGNAL_SESSION,
    ...expectedExecutions.slice(0, -1),
  ]);
  const cells = [];
  for (const executionBook of EXECUTION_BOOKS) {
    for (const rebalanceAnchor of CADENCE_ANCHORS) {
      for (const oneWayCostBps of COST_STRESS_BPS) {
        const shared = {
          executionBook,
          oneWayCostBps,
          rebalanceAnchor,
          evaluationStart: FIRST_ELIGIBLE_EXECUTION_SESSION,
          maximumRows: REQUIRED_PROSPECTIVE_RETURNS,
        };
        const incumbentRows = simulateProspectivePolicyNextOpen(imported, {
          ...shared,
          policyId: FROZEN_INCUMBENT_POLICY_ID,
        });
        const challengerRows = simulateProspectivePolicyNextOpen(imported, {
          ...shared,
          policyId: DOWNSIDE_SEMIVOLATILITY_POLICY_ID,
        });
        if (incumbentRows.length !== REQUIRED_PROSPECTIVE_RETURNS
          || challengerRows.length !== REQUIRED_PROSPECTIVE_RETURNS) {
          fail("prospective comparison requires exactly 252 consecutive future returns");
        }
        assertPairedRows(incumbentRows, challengerRows);
        assertExpectedSessionChain(incumbentRows, expectedExecutions);
        assertExpectedSessionChain(challengerRows, expectedExecutions);
        const incumbent = calculateExecutionMetrics(incumbentRows);
        const challenger = calculateExecutionMetrics(challengerRows);
        const executionDates = incumbentRows.map((row) => row.execution_date);
        cells.push(Object.freeze({
          partition_id: "prospective_only_clock",
          execution_book: executionBook,
          rebalance_anchor: rebalanceAnchor,
          one_way_cost_bps: oneWayCostBps,
          alignment: Object.freeze({
            observations_per_policy: incumbentRows.length,
            first_execution_date: executionDates[0],
            last_execution_date: executionDates.at(-1),
            execution_dates_sha256: sha256(executionDates),
            expected_execution_dates_sha256: sha256(expectedExecutions),
            expected_signal_dates_sha256: sha256(expectedSignals),
            identical_dates_and_rebalance_flags: true,
            complete_expected_session_chain: true,
            incumbent_rows_sha256: sha256(incumbentRows),
            challenger_rows_sha256: sha256(challengerRows),
          }),
          incumbent,
          challenger,
          challenger_minus_incumbent: comparisonDelta(challenger, incumbent),
        }));
      }
    }
  }
  const primary = cells.find((cell) => cell.execution_book === "adjusted"
    && cell.rebalance_anchor === 0
    && cell.one_way_cost_bps === 5);
  const body = {
    schema_version: "finly_prospective_downside_semivolatility_comparison.v1",
    evidence_class: "UNVERIFIED_PROSPECTIVE_MECHANICS_REPLAY",
    prospective_evidence_eligible: false,
    activation_verified: false,
    protocol_sha256: protocolSha256,
    policies: Object.freeze([FROZEN_INCUMBENT_POLICY_ID, DOWNSIDE_SEMIVOLATILITY_POLICY_ID]),
    hindsight_boundary: Object.freeze({
      last_consumed_session: LAST_CONSUMED_SESSION,
      first_scored_execution_session: FIRST_ELIGIBLE_EXECUTION_SESSION,
      consumed_history_scored: false,
    }),
    matrix_dimensions: Object.freeze({
      partition_id: "prospective_only_clock",
      required_consecutive_execution_returns: REQUIRED_PROSPECTIVE_RETURNS,
      execution_books: EXECUTION_BOOKS,
      one_way_cost_stress_bps: COST_STRESS_BPS,
      cadence_anchors: CADENCE_ANCHORS,
      cell_count: cells.length,
      policies_per_cell: 2,
    }),
    expected_session_binding: Object.freeze({
      expected_execution_sessions_sha256: sha256(expectedExecutions),
      expected_signal_sessions_sha256: sha256(expectedSignals),
      supplied_session_count: expectedExecutions.length,
      exact_match_to_supplied_session_sequence_enforced: true,
      official_calendar_no_skips_verified: false,
      official_calendar_origin_verified_by_this_scaffold: false,
    }),
    input_binding: Object.freeze({
      immutable_import_schema_version: imported.schema_version,
      imported_payload_sha256: imported.payload_sha256,
      adjusted_importer_normalized_sha256: imported.adjusted.normalized_sha256,
      raw_importer_normalized_sha256: imported.raw.normalized_sha256,
      adjusted_points_used_sha256: sha256(imported.adjusted.points),
      raw_points_used_sha256: sha256(imported.raw.points),
      provenance_sha256: sha256(imported.provenance ?? {}),
      source_binding_sha256: imported.source_binding == null
        ? null
        : sha256(imported.source_binding),
      provider_origin_verified_by_this_scaffold: false,
    }),
    primary_cell: primary,
    primary_cell_role: "DESCRIPTIVE_MECHANICS_ONLY_UNTIL_RUNTIME_AND_FINALIZATION_GATES_OPEN",
    primary_inference: null,
    primary_inference_permitted_by_this_scaffold: false,
    sensitivity_cells_can_rescue_or_reverse_primary: false,
    cells: Object.freeze(cells),
    incumbent_modification_or_promotion_permitted: false,
    disposition: "RESEARCH_ONLY_KEEP_FROZEN_INCUMBENT",
    claim_boundary: "This pure mechanics replay does not verify provider origin, official-calendar origin, independent activation, or prospectivity and cannot modify or promote the frozen incumbent.",
  };
  return deepFreeze({ ...body, output_sha256: sha256(body) });
}

export function downsideSemivolatilityProtocolBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("protocol must be an object");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "protocol_sha256"));
}

export function hashDownsideSemivolatilityProtocol(value) {
  return sha256(downsideSemivolatilityProtocolBody(value));
}

export function canonicalDownsideSemivolatilityProtocolJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateDownsideSemivolatilityProtocol(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("protocol must be an object");
  if (value.schema_version !== DOWNSIDE_SEMIVOLATILITY_PROTOCOL_SCHEMA
    || value.protocol_id !== DOWNSIDE_SEMIVOLATILITY_PROTOCOL_ID
    || value.attempt_number !== DOWNSIDE_SEMIVOLATILITY_ATTEMPT_NUMBER
    || value.status !== "PROSPECTIVE_ONLY_LOCAL_SCAFFOLD_RUNNER_DISABLED"
    || value.evidence_class !== "PROSPECTIVE_ONLY_CHALLENGER_SCAFFOLD"
    || value.primary_specification_count !== 1) {
    fail("downside-semivolatility protocol envelope is invalid");
  }
  const computed = hashDownsideSemivolatilityProtocol(value);
  if (value.protocol_sha256 !== computed || computed !== DOWNSIDE_SEMIVOLATILITY_PROTOCOL_SHA256) {
    fail("downside-semivolatility protocol hash is invalid or drifted");
  }
  const trial = value.trial_accounting;
  if (trial?.prior_retrospective_append_only_through !== 113
    || trial.immediate_prior_registered_attempt_path
      !== "research/prospective_attempt114/protocol.json"
    || trial.immediate_prior_registered_attempt_raw_bytes_sha256
      !== "sha256:794bb93d578b4b4766daac1c27d7fa0a68f730fbeda853b208aa98ad501572ff"
    || trial.immediate_prior_registered_attempt_protocol_sha256
      !== "sha256:a1eb1b3304920f72606d2bb710adb9e5580a213cda1df51a776aa55940f7f311"
    || trial.prior_registered_attempt_count !== 114
    || trial.additional_registered_attempt_count !== 1
    || trial.registered_attempt_count_after_registration !== 115
    || trial.new_policy_formula_count !== 1
    || trial.count_even_if_unrun_aborted_failed_or_ineligible !== true
    || trial.prospective_attempt_114_is_unchanged !== true) {
    fail("downside-semivolatility trial accounting changed");
  }
  const boundary = value.hindsight_boundary;
  if (boundary?.last_consumed_session !== LAST_CONSUMED_SESSION
    || boundary.first_eligible_signal_session !== FIRST_ELIGIBLE_SIGNAL_SESSION
    || boundary.first_eligible_execution_session !== FIRST_ELIGIBLE_EXECUTION_SESSION
    || boundary.existing_private_historical_bundle_targeted !== false
    || boundary.existing_private_historical_bundle_eligible_for_scoring !== false
    || boundary.execution_or_evaluation_date_on_or_before_cutoff_must_fail_closed !== true
    || boundary.retrospective_runner_permitted !== false
    || boundary.real_data_runner_available_in_this_scaffold !== false) {
    fail("downside-semivolatility hindsight boundary changed");
  }
  const spec = value.primary_specification;
  if (spec?.id !== DOWNSIDE_SEMIVOLATILITY_POLICY_ID
    || spec.base_lookback_sessions !== BASE_LOOKBACK
    || spec.minimum_negative_returns_in_base_window !== MINIMUM_BASE_NEGATIVES
    || spec.extended_lookback_sessions !== EXTENDED_LOOKBACK
    || spec.annualization_sessions !== TRADING_DAYS
    || stableStringify(spec.trend_horizons_sessions) !== stableStringify(TREND_HORIZONS)
    || spec.target_annualized_volatility !== TARGET_VOLATILITY
    || spec.maximum_spy_weight !== 1
    || spec.residual_asset !== "BIL"
    || spec.leverage_permitted !== false
    || spec.shorts_permitted !== false
    || spec.fallback_permitted_from_20_session_branch !== false) {
    fail("downside-semivolatility primary specification changed");
  }
  const design = value.prospective_comparison_design;
  if (design?.single_scored_partition?.first_eligible_execution_session
      !== FIRST_ELIGIBLE_EXECUTION_SESSION
    || design.single_scored_partition.required_consecutive_execution_returns
      !== REQUIRED_PROSPECTIVE_RETURNS
    || stableStringify(design.one_way_cost_stress_bps) !== stableStringify(COST_STRESS_BPS)
    || stableStringify(design.cadence_anchors) !== stableStringify(CADENCE_ANCHORS)
    || design.rebalance_interval_sessions !== REBALANCE_INTERVAL
    || design.same_dates_costs_anchors_and_partition_required_for_both_policies !== true
    || design.expected_execution_session_sequence_required !== true
    || design.official_calendar_origin_verified_by_this_scaffold !== false) {
    fail("downside-semivolatility prospective comparison design changed");
  }
  const inference = value.primary_inference;
  if (inference?.status_in_this_scaffold
      !== "NOT_COMPUTED_RUNTIME_AND_FINALIZATION_GATES_CLOSED"
    || inference.book !== DOWNSIDE_SEMIVOLATILITY_POLICY_ID
    || inference.comparator !== FROZEN_INCUMBENT_POLICY_ID
    || inference.execution_book !== "adjusted"
    || inference.rebalance_anchor !== 0
    || inference.one_way_cost_bps !== 5
    || inference.intervals !== REQUIRED_PROSPECTIVE_RETURNS
    || inference.input_return_field !== "net_return"
    || inference.input_return_decimal_places !== 12
    || inference.endpoint !== "mean paired daily net log-return difference"
    || inference.bootstrap_seed_uint32 !== 20260829
    || inference.bootstrap_rng !== "Mulberry32"
    || inference.bootstrap_resamples !== 4999
    || inference.expected_block_sessions !== 20
    || inference.restart_probability !== 0.05
    || inference.circular_continuation_modulo !== REQUIRED_PROSPECTIVE_RETURNS
    || inference.alpha !== 0.05
    || inference.within_attempt_multiplicity !== "ONE_PRIMARY_ENDPOINT"
    || inference.cross_attempt_familywise_claim_permitted !== false
    || inference.repeat_confirmatory_test_permitted !== false
    || inference.interim_inference_permitted !== false
    || inference.result_changes_incumbent_policy !== false) {
    fail("downside-semivolatility primary inference changed");
  }
  const finalization = value.sensitivity_and_finalization;
  if (finalization?.descriptive_cell_or_metric_can_rescue_or_reverse_primary !== false
    || finalization.replacement_window_cell_or_endpoint_permitted !== false
    || finalization.optional_stopping_permitted !== false
    || finalization.integrity_failure_disposition
      !== "TERMINAL_INCOMPLETE_INTEGRITY_FAILURE_REGISTER_NEW_ATTEMPT") {
    fail("downside-semivolatility sensitivity or finalization boundary changed");
  }
  const authority = value.authority_and_disposition;
  if (value.literature_basis?.doi !== "10.1016/j.jbankfin.2021.106198"
    || authority?.retrospective_evaluation_authorized !== false
    || authority.primary_inference_permitted_by_this_scaffold !== false
    || authority.interim_or_repeat_inference_permitted !== false
    || authority.sensitivity_cell_p_values_permitted !== false
    || authority.retrospective_pass_can_promote !== false
    || authority.prospective_result_can_modify_or_promote_incumbent !== false
    || authority.incumbent_after_every_outcome !== FROZEN_INCUMBENT_POLICY_ID
    || !/Attempt 115/iu.test(value.claim_boundary)
    || !/all existing history/iu.test(value.claim_boundary)
    || !/retrospective pass cannot promote/iu.test(value.claim_boundary)
    || !/does not verify the official-calendar origin/iu.test(value.claim_boundary)
    || !/no real-data runner is activated/iu.test(value.claim_boundary)) {
    fail("downside-semivolatility literature, authority, or claim boundary changed");
  }
  return value;
}
