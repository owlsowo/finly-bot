import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  buildDecisionPlan,
  failClosedManagementOutcome,
  fixedPerformanceBoundary,
  historicalReplayClocks,
  simulatePortfolio,
  validatePublishedHistoricalArtifact,
} from "../scripts/run_historical_backtest.mjs";

function session(index) {
  return {
    index,
    date: `2025-01-${String(index + 1).padStart(2, "0")}`,
    open: "09:30",
    close: "16:00",
  };
}

test("counterfactual policy and shadow portfolios use one fixed performance boundary", () => {
  const sessions = Array.from({ length: 8 }, (_, index) => session(index));
  const stockBarsByDate = new Map(sessions.map((item, index) => [item.date, {
    o: 100 + index,
    c: 100.5 + index,
  }]));
  const boundary = fixedPerformanceBoundary({
    sessions,
    decisionStartIndex: 1,
    decisionEndIndex: 2,
    horizonSessions: 3,
  });
  const decisions = [{
    date: sessions[2].date,
    session_index: 2,
    status: "NO_CANDIDATE",
    direction: "bullish",
    candidate: null,
    policy_counterfactual_outcome: null,
    shadow_candidate: { candidate_id: "shadow-1", action: "BULL_CALL_DEBIT_SPREAD" },
    shadow_outcome: {
      fillable: true,
      entry_at: "2025-01-04T14:30:00.000Z",
      exit_at: "2025-01-05T21:00:00.000Z",
      entry_session_index: 3,
      exit_session_index: 4,
      entry_debit: 1,
      exit_credit: 1.5,
      pnl_per_contract: 50,
      max_capital_at_risk_per_contract: 100,
      status: "RECONSTRUCTED_EXIT",
    },
  }];
  const common = { decisions, sessions, stockBarsByDate, startingEquity: 100_000, boundary };
  const policyCounterfactual = simulatePortfolio({ ...common, mode: "policy_counterfactual" });
  const shadow = simulatePortfolio({ ...common, mode: "shadow" });

  assert.deepEqual(policyCounterfactual.boundary, shadow.boundary);
  assert.equal(boundary.decision_start_index, 1);
  assert.equal(boundary.decision_end_index, 2);
  assert.equal(boundary.performance_end_index, 5);
  assert.equal(policyCounterfactual.equity_curve[0].timestamp, shadow.equity_curve[0].timestamp);
  assert.equal(policyCounterfactual.equity_curve.at(-1).timestamp, shadow.equity_curve.at(-1).timestamp);
  assert.deepEqual(policyCounterfactual.benchmark_curve, shadow.benchmark_curve);
  assert.equal(policyCounterfactual.metrics.data_coverage.equity_observations, 5);
  assert.equal(shadow.metrics.data_coverage.equity_observations, 5);
});

test("no-trade results are cash context, while shadow risk metrics disclose realized-only scope", () => {
  const sessions = Array.from({ length: 8 }, (_, index) => session(index));
  const stockBarsByDate = new Map(sessions.map((item, index) => [item.date, {
    o: 100 + index,
    c: 100.5 + index,
  }]));
  const boundary = fixedPerformanceBoundary({
    sessions,
    decisionStartIndex: 1,
    decisionEndIndex: 2,
    horizonSessions: 3,
  });
  const decisions = [{
    date: sessions[2].date,
    session_index: 2,
    status: "NO_CANDIDATE",
    direction: "bullish",
    candidate: null,
    policy_counterfactual_outcome: null,
    shadow_candidate: { candidate_id: "shadow-1", action: "BULL_CALL_DEBIT_SPREAD" },
    shadow_outcome: {
      fillable: true,
      entry_at: "2025-01-04T14:30:00.000Z",
      exit_at: "2025-01-05T21:00:00.000Z",
      entry_session_index: 3,
      exit_session_index: 4,
      entry_debit: 1,
      exit_credit: 1.5,
      pnl_per_contract: 50,
      max_capital_at_risk_per_contract: 100,
      status: "RECONSTRUCTED_EXIT",
    },
  }];
  const common = { decisions, sessions, stockBarsByDate, startingEquity: 100_000, boundary };
  const policyCounterfactual = simulatePortfolio({ ...common, mode: "policy_counterfactual" });
  const shadow = simulatePortfolio({ ...common, mode: "shadow" });

  assert.equal(policyCounterfactual.metrics.trade_count, 0);
  assert.equal(policyCounterfactual.metrics.excess_return, null);
  assert.match(policyCounterfactual.metrics.unavailable_reasons.excess_return, /no-trade window/);
  assert.equal(policyCounterfactual.comparison_context.cash.total_return, 0);
  assert.equal(policyCounterfactual.comparison_context.risk_matched_spy.status, "NO_CAPITAL_DEPLOYED");
  assert.equal(policyCounterfactual.comparison_context.risk_matched_spy.total_return, 0);

  assert.equal(shadow.metrics.trade_count, 1);
  assert.equal(shadow.metrics.equity_curve_basis, "realized_exit_only");
  assert.equal(shadow.metrics.annualized_volatility, null);
  assert.match(shadow.metrics.unavailable_reasons.annualized_volatility, /daily mark-to-market/);
  assert.equal(shadow.comparison_context.risk_matched_spy.status, "AVAILABLE");
  assert.equal(shadow.comparison_context.risk_matched_spy.matched_trade_count, 1);
  assert.match(shadow.comparison_context.risk_matched_spy.price_basis, /Raw\/unadjusted/);
});

test("trade outcomes cannot extend beyond the declared performance end", () => {
  const sessions = Array.from({ length: 8 }, (_, index) => session(index));
  const stockBarsByDate = new Map(sessions.map((item, index) => [item.date, { o: 100 + index, c: 101 + index }]));
  const boundary = fixedPerformanceBoundary({ sessions, decisionStartIndex: 1, decisionEndIndex: 2, horizonSessions: 2 });
  assert.throws(() => simulatePortfolio({
    sessions,
    stockBarsByDate,
    startingEquity: 100_000,
    mode: "shadow",
    boundary,
    decisions: [{
      session_index: 2,
      status: "NO_CANDIDATE",
      direction: "bullish",
      shadow_candidate: { candidate_id: "shadow-1", action: "BULL_CALL_DEBIT_SPREAD" },
      shadow_outcome: {
        fillable: true,
        entry_session_index: 3,
        exit_session_index: 5,
      },
    }],
  }), /escapes the fixed performance boundary/);
});

test("one-year sampling is strictly every five sessions with no adjacent appended endpoint", () => {
  const yearlyIndexes = buildDecisionPlan(1_000, 252)
    .filter((item) => item.window_ids.includes("one_year"))
    .map((item) => item.index);
  assert.equal(yearlyIndexes.length, 51);
  assert.equal(yearlyIndexes.at(-1), 1_000);
  assert.ok(yearlyIndexes.every((index, offset) => offset === 0 || index - yearlyIndexes[offset - 1] === 5));
});

test("forecast and holding clocks terminate at the same outcome session", () => {
  const clocks = historicalReplayClocks(3);
  assert.deepEqual(clocks, {
    holding_horizon_sessions: 3,
    forecast_horizon_sessions: 4,
    outcome_session_offset_from_decision: 4,
    management_session_count: 4,
  });
  assert.throws(() => historicalReplayClocks(0), /holding horizon/);
});

test("a missing required management proxy fails closed to full debit loss through the final boundary", () => {
  const result = failClosedManagementOutcome({
    status: "INCOMPLETE_REQUIRED_MANAGEMENT_PROXY_FULL_DEBIT_LOSS",
    failureReason: "NO_ALIGNED_EXIT_INTERVAL",
    entrySession: { index: 3, date: "2025-01-04" },
    finalSession: { index: 6, date: "2025-01-07" },
    alignedEntry: { available_at: "2025-01-04T14:32:00.000Z", spy_bar: { c: 560 } },
    declaredFinalExitAt: "2025-01-07T21:00:00.000Z",
    entryDebit: 2.5,
    naturalEntryDebit: 2.4,
    managementChecks: [{ date: "2025-01-05", status: "ALIGNMENT_UNAVAILABLE" }],
  });
  assert.equal(result.fillable, true);
  assert.equal(result.pnl_per_contract, -250);
  assert.equal(result.exit_session_index, 6);
  assert.equal(result.management_path_complete, false);
  assert.equal(result.management_failure_reason, "NO_ALIGNED_EXIT_INTERVAL");
});

test("counterfactual policy sizing uses then-current realized equity, not reference quantity", () => {
  const sessions = Array.from({ length: 6 }, (_, index) => session(index));
  const stockBarsByDate = new Map(sessions.map((item) => [item.date, { o: 100, c: 100 }]));
  const boundary = fixedPerformanceBoundary({
    sessions,
    decisionStartIndex: 0,
    decisionEndIndex: 2,
    horizonSessions: 2,
  });
  const outcome = (entryIndex, exitIndex, pnlPerContract) => ({
    fillable: true,
    entry_at: `2025-01-${String(entryIndex + 1).padStart(2, "0")}T14:32:00.000Z`,
    exit_at: `2025-01-${String(exitIndex + 1).padStart(2, "0")}T21:00:00.000Z`,
    entry_session_index: entryIndex,
    exit_session_index: exitIndex,
    entry_debit: 2.5,
    exit_credit: pnlPerContract < 0 ? 0 : 2.5,
    pnl_per_contract: pnlPerContract,
    max_capital_at_risk_per_contract: 250,
    entry_spy_price: 100,
    exit_spy_price: 100,
    status: "RECONSTRUCTED_EXIT",
  });
  const candidate = (id) => ({ candidate_id: id, action: "BULL_CALL_DEBIT_SPREAD" });
  const decisions = [
    {
      date: sessions[0].date,
      session_index: 0,
      status: "ELIGIBLE",
      direction: "bullish",
      candidate: candidate("policy-1"),
      quantity: 4,
      sizing_risk_fraction: 0.005,
      policy_counterfactual_outcome: outcome(1, 1, -250),
      shadow_candidate: null,
      shadow_outcome: null,
    },
    {
      date: sessions[2].date,
      session_index: 2,
      status: "ELIGIBLE",
      direction: "bullish",
      candidate: candidate("policy-2"),
      quantity: 4,
      sizing_risk_fraction: 0.005,
      policy_counterfactual_outcome: outcome(3, 3, 0),
      shadow_candidate: null,
      shadow_outcome: null,
    },
  ];
  const result = simulatePortfolio({
    decisions,
    sessions,
    stockBarsByDate,
    startingEquity: 100_000,
    mode: "policy_counterfactual",
    boundary,
  });
  assert.deepEqual(result.trades.map((trade) => trade.quantity), [2, 1]);
  assert.deepEqual(result.trades.map((trade) => trade.sizing_equity_at_decision), [100_000, 99_500]);
  assert.deepEqual(result.trades.map((trade) => trade.risk_budget_at_decision), [500, 497.5]);
  assert.ok(result.trades.every((trade) => trade.mode === "counterfactual_policy"));
});

test("published v3 artifacts require counterfactual labels and the final one-year window", () => {
  const unsigned = {
    schema_version: "finly_historical_backtest_report.v3",
    report_scope: "COUNTERFACTUAL_POLICY_RESEARCH_ONLY",
    broker_policy_equivalence_claimed: false,
    profitability_claimed: false,
    windows: [{
      id: "one_year",
      requested_market_sessions: 252,
      decision_sampling: "weekly",
      policy_counterfactual: { metrics: {} },
    }],
  };
  const artifact = { ...unsigned, artifact_sha256: sha256(unsigned) };
  assert.equal(validatePublishedHistoricalArtifact(artifact, { requestedSessions: 252 }), artifact);
  const invalidUnsigned = {
    ...unsigned,
    windows: [{ ...unsigned.windows[0], authorized: { metrics: {} } }],
  };
  assert.throws(() => validatePublishedHistoricalArtifact({
    ...invalidUnsigned,
    artifact_sha256: sha256(invalidUnsigned),
  }, { requestedSessions: 252 }), /must not expose an authorized/);
});
