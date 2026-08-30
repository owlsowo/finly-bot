import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import {
  applyEconomicRiskCommitteeVeto,
  buildCurrentEconomicDecision,
  buildEconomicOptionsExecutionGuard,
  CURRENT_ECONOMIC_DECISION_PROTOCOL,
} from "../lib/economic_research.mjs";

function marketBars(count = 300, { cash = false } = {}) {
  let close = cash ? 90 : 100;
  return Array.from({ length: count }, (_, index) => {
    const dailyReturn = cash
      ? 0.0001
      : 0.0008 + 0.004 * Math.sin(index * 0.73) + 0.0015 * Math.cos(index * 0.17);
    close *= 1 + dailyReturn;
    return {
      t: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
      c: close,
    };
  });
}

function input(overrides = {}) {
  const spyBars = marketBars();
  const cashBars = marketBars(300, { cash: true });
  const sessionDate = spyBars.at(-1).t.slice(0, 10);
  return {
    spyBars,
    cashBars,
    decisionTimestamp: "2025-10-28T22:00:00.000Z",
    sourceAvailableAt: "2025-10-28T21:00:00.000Z",
    completedSessionBoundary: {
      sessionDate,
      marketCloseAt: `${sessionDate}T20:00:00.000Z`,
      eligibleAt: `${sessionDate}T20:15:00.000Z`,
      availabilityDelayMinutes: 15,
    },
    currentAllocation: { spyWeight: 0.4, bilWeight: 0.6 },
    lastRebalanceDate: spyBars.at(-6).t.slice(0, 10),
    ...overrides,
  };
}

function receiptBody(value) {
  const { receipt_sha256: ignored, ...body } = value;
  void ignored;
  return body;
}

function economicBundle({ multiplier = 1, disposition = "SCALE" } = {}) {
  const deterministicDecision = buildCurrentEconomicDecision(input());
  const riskCommitteeDecision = applyEconomicRiskCommitteeVeto(deterministicDecision, {
    assessedAt: "2025-10-28T22:01:00.000Z",
    disposition,
    spyExposureMultiplier: multiplier,
    reasonCodes: disposition === "VETO" ? ["EVENT_RISK"] : ["NO_AGENT_RISK_REDUCTION"],
  });
  const body = {
    schema_version: "finly_current_economic_bundle.v1",
    generated_at: "2025-10-28T22:01:00.000Z",
    data: { read_only: true },
    paper_account_boundary: { authenticated_read_succeeded: true },
    deterministic_decision: deterministicDecision,
    risk_committee_decision: riskCommitteeDecision,
    mutation_requested: false,
  };
  return { ...body, artifact_sha256: sha256(body) };
}

test("current decision implements the exact preregistered trend and volatility formula", () => {
  const request = input();
  const result = buildCurrentEconomicDecision(request);
  const last = request.spyBars.length - 1;
  const horizonReturns = [21, 63, 252].map((lookback) => (
    Math.log(request.spyBars[last].c / request.spyBars[last - lookback].c)
      - Math.log(request.cashBars[last].c / request.cashBars[last - lookback].c)
  ));
  const positiveFraction = horizonReturns.filter((value) => value > 0).length / 3;
  const volatilityBars = request.spyBars.slice(last - 20, last + 1);
  const dailyReturns = volatilityBars.slice(1)
    .map((bar, index) => bar.c / volatilityBars[index].c - 1);
  const average = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (dailyReturns.length - 1);
  const annualizedVolatility = Math.sqrt(variance) * Math.sqrt(252);
  const expectedScale = Math.min(1, 0.10 / annualizedVolatility);
  const expectedSpyWeight = Math.round((positiveFraction * expectedScale + Number.EPSILON) * 1e8) / 1e8;

  assert.deepEqual(
    result.signal.horizon_returns.map((item) => item.sessions),
    CURRENT_ECONOMIC_DECISION_PROTOCOL.trend_horizons_sessions,
  );
  result.signal.horizon_returns.forEach((item, index) => {
    assert.ok(Math.abs(item.spy_minus_bil_log_return - horizonReturns[index]) < 1e-11);
  });
  assert.equal(result.signal.positive_trend_fraction, positiveFraction);
  assert.equal(result.signal.indicated_spy_weight, expectedSpyWeight);
  assert.deepEqual(result.proposed_allocation, {
    spy_weight: expectedSpyWeight,
    bil_weight: Math.round((1 - expectedSpyWeight + Number.EPSILON) * 1e8) / 1e8,
  });
  assert.equal(result.schedule.rebalance_due, true);
  assert.equal(result.decision, "PROPOSE_REBALANCE");
  assert.equal(result.authorization.broker_mutation_authorized, false);
  assert.equal(result.authorization.order_payload, null);
});

test("point-in-time controls reject lookahead and decisions ignore unprovided future observations", () => {
  const request = input();
  const truncated = {
    ...request,
    spyBars: request.spyBars.slice(0, 280),
    cashBars: request.cashBars.slice(0, 280),
    lastRebalanceDate: request.spyBars[274].t.slice(0, 10),
  };
  const first = buildCurrentEconomicDecision(truncated);
  request.spyBars[290].c *= 10;
  request.cashBars[295].c /= 2;
  const second = buildCurrentEconomicDecision(truncated);
  assert.deepEqual(second, first);

  const futureSpy = structuredClone(truncated.spyBars);
  futureSpy.at(-1).t = "2025-12-31T00:00:00.000Z";
  assert.throws(
    () => buildCurrentEconomicDecision({ ...truncated, spyBars: futureSpy }),
    /incomplete session/,
  );
});

test("five-session schedule fails closed between rebalances", () => {
  const request = input();
  const latest = request.spyBars.length - 1;
  const notDue = buildCurrentEconomicDecision({
    ...request,
    lastRebalanceDate: request.spyBars[latest - 4].t.slice(0, 10),
  });
  assert.equal(notDue.schedule.sessions_since_last_rebalance, 4);
  assert.equal(notDue.schedule.rebalance_due, false);
  assert.equal(notDue.decision, "NO_TRADE");
  assert.equal(notDue.proposed_allocation, null);
  const due = buildCurrentEconomicDecision({
    ...request,
    lastRebalanceDate: request.spyBars[latest - 5].t.slice(0, 10),
  });
  assert.equal(due.schedule.sessions_since_last_rebalance, 5);
  assert.equal(due.schedule.rebalance_due, true);
});

test("committee multipliers are monotonically non-amplifying for arbitrary values", () => {
  const base = buildCurrentEconomicDecision(input());
  let state = 0xC0FFEE;
  const multipliers = [0, 1];
  for (let index = 0; index < 250; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    multipliers.push(state / 2 ** 32);
  }
  for (const multiplier of multipliers) {
    const assessed = applyEconomicRiskCommitteeVeto(base, {
      assessedAt: "2025-10-28T22:01:00.000Z",
      disposition: "SCALE",
      spyExposureMultiplier: multiplier,
      reasonCodes: ["AGENT_RISK_REVIEW"],
    });
    assert.equal(assessed.non_amplification.passed, true);
    assert.ok(assessed.final_allocation.spy_weight <= base.proposed_allocation.spy_weight);
    assert.ok(Math.abs(
      assessed.final_allocation.spy_weight
        - Math.round((base.proposed_allocation.spy_weight * multiplier + Number.EPSILON) * 1e8) / 1e8,
    ) < 1e-12);
    assert.equal(assessed.authorization.broker_mutation_authorized, false);
    assert.equal(assessed.authorization.order_payload, null);
  }
  assert.throws(() => applyEconomicRiskCommitteeVeto(base, {
    assessedAt: "2025-10-28T22:01:00.000Z",
    disposition: "SCALE",
    spyExposureMultiplier: 1.0000001,
    reasonCodes: [],
  }), /between zero and one/);
});

test("committee veto produces NO_TRADE and cannot revive an off-cycle decision", () => {
  const base = buildCurrentEconomicDecision(input());
  const vetoed = applyEconomicRiskCommitteeVeto(base, {
    assessedAt: "2025-10-28T22:01:00.000Z",
    disposition: "VETO",
    spyExposureMultiplier: 0,
    reasonCodes: ["EVENT_RISK", "EVENT_RISK"],
  });
  assert.equal(vetoed.decision, "NO_TRADE");
  assert.equal(vetoed.final_allocation, null);
  assert.deepEqual(vetoed.reason_codes, ["EVENT_RISK"]);

  const request = input();
  const offCycle = buildCurrentEconomicDecision({
    ...request,
    lastRebalanceDate: request.spyBars.at(-3).t.slice(0, 10),
  });
  const reviewed = applyEconomicRiskCommitteeVeto(offCycle, {
    assessedAt: "2025-10-28T22:01:00.000Z",
    disposition: "SCALE",
    spyExposureMultiplier: 1,
    reasonCodes: [],
  });
  assert.equal(reviewed.decision, "NO_TRADE");
  assert.equal(reviewed.final_allocation, null);
});

test("malformed current inputs fail closed", () => {
  const request = input();
  const malformed = [
    () => buildCurrentEconomicDecision({ ...request, unexpected: true }),
    () => buildCurrentEconomicDecision({ ...request, decisionTimestamp: "2025-10-28" }),
    () => buildCurrentEconomicDecision({ ...request, sourceAvailableAt: "2025-10-28T23:00:00.000Z" }),
    () => buildCurrentEconomicDecision({ ...request, currentAllocation: { spyWeight: 0.7, bilWeight: 0.4 } }),
    () => buildCurrentEconomicDecision({ ...request, spyBars: request.spyBars.slice(0, 252) }),
    () => buildCurrentEconomicDecision({ ...request, cashBars: request.cashBars.slice(1) }),
    () => buildCurrentEconomicDecision({ ...request, lastRebalanceDate: "2024-01-01" }),
  ];
  for (const invoke of malformed) assert.throws(invoke, TypeError);
});

test("identical decision and committee inputs produce stable verified hashes", () => {
  const request = input();
  const first = buildCurrentEconomicDecision(request);
  const second = buildCurrentEconomicDecision(structuredClone(request));
  assert.deepEqual(first, second);
  assert.equal(first.receipt_sha256, sha256(receiptBody(first)));
  const assessment = {
    assessedAt: "2025-10-28T22:01:00.000Z",
    disposition: "SCALE",
    spyExposureMultiplier: 0.5,
    reasonCodes: ["VOLATILITY_RISK", "EVENT_RISK"],
  };
  const left = applyEconomicRiskCommitteeVeto(first, assessment);
  const right = applyEconomicRiskCommitteeVeto(second, {
    ...structuredClone(assessment),
    reasonCodes: ["EVENT_RISK", "VOLATILITY_RISK"],
  });
  assert.deepEqual(left, right);
  assert.equal(left.receipt_sha256, sha256(receiptBody(left)));

  const tampered = structuredClone(first);
  tampered.proposed_allocation.spy_weight = first.proposed_allocation.spy_weight === 0 ? 0.5 : 0;
  assert.throws(() => applyEconomicRiskCommitteeVeto(tampered, assessment), /receipt hash is invalid/);
});

test("economic options guard permits only a fresh materially risk-on bullish intent", () => {
  const bundle = economicBundle();
  const allowed = buildEconomicOptionsExecutionGuard(bundle, {
    asOf: "2025-10-28T22:02:00.000Z",
    intentDirection: "bullish",
  });
  assert.equal(allowed.entry_gate_passed, true);
  assert.equal(allowed.decision, "ALLOW_BULLISH_DEFINED_RISK_ENTRY_GATE");
  assert.equal(allowed.authorization_boundary.broker_mutation_authorized_by_this_guard, false);
  assert.equal(allowed.receipt_sha256, sha256(receiptBody(allowed)));

  const mismatched = buildEconomicOptionsExecutionGuard(bundle, {
    asOf: "2025-10-28T22:02:00.000Z",
    intentDirection: "bearish",
  });
  assert.equal(mismatched.entry_gate_passed, false);
  assert.deepEqual(mismatched.reason_codes, ["LONG_ONLY_ECONOMIC_DIRECTION_MISMATCH"]);

  const stale = buildEconomicOptionsExecutionGuard(bundle, {
    asOf: "2025-10-28T22:32:00.000Z",
    intentDirection: "bullish",
  });
  assert.equal(stale.entry_gate_passed, false);
  assert.ok(stale.reason_codes.includes("ECONOMIC_DECISION_STALE"));

  const vetoed = buildEconomicOptionsExecutionGuard(economicBundle({ multiplier: 0, disposition: "VETO" }), {
    asOf: "2025-10-28T22:02:00.000Z",
    intentDirection: "bullish",
  });
  assert.equal(vetoed.entry_gate_passed, false);
  assert.ok(vetoed.reason_codes.includes("ECONOMIC_POLICY_NO_TRADE"));

  const tampered = structuredClone(bundle);
  tampered.risk_committee_decision.final_allocation.spy_weight = 0.12345678;
  assert.throws(
    () => buildEconomicOptionsExecutionGuard(tampered, {
      asOf: "2025-10-28T22:02:00.000Z",
      intentDirection: "bullish",
    }),
    /artifact hash is invalid/,
  );
});
