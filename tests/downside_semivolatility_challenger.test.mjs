import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { stableStringify } from "../lib/canonical.mjs";
import {
  importImmutableOhlc,
} from "../research/equity_execution_realism.mjs";
import {
  canonicalDownsideSemivolatilityProtocolJson,
  compareProspectiveDownsideSemivolatility,
  DOWNSIDE_SEMIVOLATILITY_ATTEMPT_NUMBER,
  DOWNSIDE_SEMIVOLATILITY_POLICY_ID,
  DOWNSIDE_SEMIVOLATILITY_PROTOCOL_SHA256,
  downsideSemivolatilityTarget,
  estimateDownsideSemivolatility,
  FIRST_ELIGIBLE_EXECUTION_SESSION,
  FIRST_ELIGIBLE_SIGNAL_SESSION,
  FROZEN_INCUMBENT_POLICY_ID,
  hashDownsideSemivolatilityProtocol,
  incumbentTotalVolatilityEstimate,
  LAST_CONSUMED_SESSION,
  REQUIRED_PROSPECTIVE_RETURNS,
  simulateProspectivePolicyNextOpen,
  validateDownsideSemivolatilityProtocol,
} from "../research/downside_semivolatility_challenger.mjs";

const DAY_MILLISECONDS = 86_400_000;

function weekdayDates(count, start = "2025-08-01T00:00:00.000Z") {
  const dates = [];
  let timestamp = Date.parse(start);
  while (dates.length < count) {
    const current = new Date(timestamp);
    const weekday = current.getUTCDay();
    if (weekday >= 1 && weekday <= 5) dates.push(current.toISOString().slice(0, 10));
    timestamp += DAY_MILLISECONDS;
  }
  return dates;
}

function syntheticSeries(dates, symbol, { raw = false } = {}) {
  let priorClose = symbol === "SPY" ? 100 : 91;
  return dates.map((date, index) => {
    const gap = symbol === "SPY"
      ? 0.0014 * Math.sin(index / 3.7)
      : 0.00004 * Math.cos(index / 8.3);
    const cycle = symbol === "SPY" ? 0.005 * Math.sin(index / 5.1) : 0;
    const base = symbol === "SPY" ? 0.00075 : 0.00009;
    const rawDrag = raw ? (symbol === "SPY" ? 0.00002 : 0.00004) : 0;
    const open = priorClose * (1 + gap);
    const close = open * (1 + base + cycle - rawDrag);
    priorClose = close;
    return { date, open, close };
  });
}

function syntheticPayload(count = 620) {
  const dates = weekdayDates(count);
  return {
    adjusted: {
      SPY: syntheticSeries(dates, "SPY"),
      BIL: syntheticSeries(dates, "BIL"),
    },
    raw: {
      SPY: syntheticSeries(dates, "SPY", { raw: true }),
      BIL: syntheticSeries(dates, "BIL", { raw: true }),
    },
    provenance: { provider: "synthetic-future-test-only" },
  };
}

function expectedExecutionSessions(imported) {
  const dates = imported.adjusted.points.map((point) => point.date);
  const first = dates.indexOf(FIRST_ELIGIBLE_EXECUTION_SESSION);
  assert.ok(first >= 0);
  return dates.slice(first, first + REQUIRED_PROSPECTIVE_RETURNS);
}

function sampleDeviation(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0)
    / (values.length - 1));
}

test("canonical protocol registers one future-only formula and preserves the hindsight boundary", async () => {
  const [bytes, incumbentBytes, priorLedgerBytes, attempt114Bytes] = await Promise.all([
    readFile(new URL("../research/downside_semivolatility_challenger_protocol.json", import.meta.url), "utf8"),
    readFile(new URL("../research/equity_execution_realism.mjs", import.meta.url)),
    readFile(new URL("../research/champion_trial_ledger_generation6.json", import.meta.url)),
    readFile(new URL("../research/prospective_attempt114/protocol.json", import.meta.url)),
  ]);
  const protocol = JSON.parse(bytes);

  assert.equal(bytes, canonicalDownsideSemivolatilityProtocolJson(protocol));
  assert.equal(validateDownsideSemivolatilityProtocol(protocol), protocol);
  assert.equal(hashDownsideSemivolatilityProtocol(protocol), DOWNSIDE_SEMIVOLATILITY_PROTOCOL_SHA256);
  assert.equal(protocol.primary_specification_count, 1);
  assert.equal(protocol.attempt_number, DOWNSIDE_SEMIVOLATILITY_ATTEMPT_NUMBER);
  assert.equal(protocol.primary_specification.id, DOWNSIDE_SEMIVOLATILITY_POLICY_ID);
  assert.equal(protocol.trial_accounting.prior_registered_attempt_count, 114);
  assert.equal(protocol.trial_accounting.additional_registered_attempt_count, 1);
  assert.equal(protocol.trial_accounting.registered_attempt_count_after_registration, 115);
  assert.equal(protocol.trial_accounting.new_policy_formula_count, 1);
  assert.equal(protocol.literature_basis.doi, "10.1016/j.jbankfin.2021.106198");
  assert.equal(protocol.hindsight_boundary.last_consumed_session, LAST_CONSUMED_SESSION);
  assert.equal(protocol.hindsight_boundary.existing_private_historical_bundle_targeted, false);
  assert.equal(protocol.hindsight_boundary.real_data_runner_available_in_this_scaffold, false);
  assert.equal(protocol.authority_and_disposition.retrospective_pass_can_promote, false);
  assert.equal(protocol.authority_and_disposition.prospective_result_can_modify_or_promote_incumbent, false);
  assert.equal(protocol.primary_inference.endpoint, "mean paired daily net log-return difference");
  assert.equal(protocol.primary_inference.input_return_field, "net_return");
  assert.equal(protocol.primary_inference.input_return_decimal_places, 12);
  assert.equal(protocol.primary_inference.bootstrap_resamples, 4999);
  assert.equal(protocol.primary_inference.expected_block_sessions, 20);
  assert.equal(protocol.primary_inference.interim_inference_permitted, false);
  assert.equal(protocol.sensitivity_and_finalization.descriptive_cell_or_metric_can_rescue_or_reverse_primary, false);
  assert.match(protocol.claim_boundary, /all existing history.+consumed/iu);
  assert.match(protocol.claim_boundary, /retrospective pass cannot promote/iu);
  assert.doesNotMatch(bytes, /data\/private|spy_bil_daily_ohlc/iu);
  assert.equal(
    `sha256:${createHash("sha256").update(incumbentBytes).digest("hex")}`,
    protocol.incumbent_binding.source_raw_bytes_sha256,
  );
  assert.equal(
    `sha256:${createHash("sha256").update(priorLedgerBytes).digest("hex")}`,
    protocol.trial_accounting.prior_retrospective_ledger_raw_bytes_sha256,
  );
  assert.equal(
    `sha256:${createHash("sha256").update(attempt114Bytes).digest("hex")}`,
    protocol.trial_accounting.immediate_prior_registered_attempt_raw_bytes_sha256,
  );
});

test("downside estimator uses the exact 20/40 formula and only the registered fallback", () => {
  const base20 = Array(40).fill(0.001);
  base20[20] = -0.01;
  base20[27] = -0.02;
  base20[39] = -0.03;
  const baseResult = estimateDownsideSemivolatility(base20);
  const expected20 = Math.sqrt((2 * 252 / 20) * ((0.01 ** 2) + (0.02 ** 2) + (0.03 ** 2)));
  assert.equal(baseResult.selected_lookback_sessions, 20);
  assert.equal(baseResult.base_negative_return_count, 3);
  assert.equal(baseResult.annualized_volatility, expected20);
  assert.equal(baseResult.incumbent_total_volatility_fallback_used, false);

  const extended40 = Array(40).fill(0.001);
  extended40[1] = -0.04;
  extended40[9] = -0.05;
  extended40[22] = -0.01;
  extended40[39] = -0.02;
  const extendedResult = estimateDownsideSemivolatility(extended40);
  const expected40 = Math.sqrt(
    (2 * 252 / 40) * ((0.04 ** 2) + (0.05 ** 2) + (0.01 ** 2) + (0.02 ** 2)),
  );
  assert.equal(extendedResult.selected_lookback_sessions, 40);
  assert.equal(extendedResult.base_negative_return_count, 2);
  assert.equal(extendedResult.annualized_volatility, expected40);
  assert.equal(extendedResult.incumbent_total_volatility_fallback_used, false);

  const allPositive = Array.from({ length: 40 }, (_, index) => 0.0005 + index * 0.00003);
  const fallbackResult = estimateDownsideSemivolatility(allPositive);
  const latest20 = allPositive.slice(-20);
  const expectedFallback = sampleDeviation(latest20) * Math.sqrt(252);
  assert.equal(fallbackResult.selected_lookback_sessions, 40);
  assert.equal(fallbackResult.downside_semivolatility_before_fallback, 0);
  assert.equal(fallbackResult.incumbent_total_volatility_fallback_used, true);
  assert.equal(fallbackResult.fallback_reason, "EXTENDED_40_SESSION_VALUE_ZERO");
  assert.equal(fallbackResult.annualized_volatility, expectedFallback);
  assert.equal(incumbentTotalVolatilityEstimate(allPositive), expectedFallback);
});

test("signal target is causal and unchanged by every later synthetic price", () => {
  const payload = syntheticPayload();
  const before = importImmutableOhlc(payload);
  const signalIndex = before.adjusted.points.findIndex(
    (point) => point.date === FIRST_ELIGIBLE_SIGNAL_SESSION,
  );
  assert.ok(signalIndex >= 252);
  const beforeTarget = downsideSemivolatilityTarget(before.adjusted.points, signalIndex);

  const changed = structuredClone(payload);
  for (let index = signalIndex + 1; index < changed.adjusted.SPY.length; index += 1) {
    changed.adjusted.SPY[index].open *= 7;
    changed.adjusted.SPY[index].close *= 11;
    changed.adjusted.BIL[index].open *= 0.4;
    changed.adjusted.BIL[index].close *= 0.6;
  }
  const after = importImmutableOhlc(changed);
  const afterTarget = downsideSemivolatilityTarget(after.adjusted.points, signalIndex);
  assert.deepEqual(afterTarget, beforeTarget);
});

test("prospective scorer rejects consumed dates and never emits a historical execution", () => {
  const imported = importImmutableOhlc(syntheticPayload());
  const common = {
    policyId: DOWNSIDE_SEMIVOLATILITY_POLICY_ID,
    maximumRows: 5,
  };
  assert.throws(
    () => simulateProspectivePolicyNextOpen(imported, {
      ...common,
      evaluationStart: LAST_CONSUMED_SESSION,
    }),
    /after the consumed-history cutoff/iu,
  );
  assert.throws(
    () => simulateProspectivePolicyNextOpen(imported, {
      ...common,
      evaluationStart: "2026-08-31",
    }),
    /must equal the registered prospective clock/iu,
  );

  const rows = simulateProspectivePolicyNextOpen(imported, common);
  assert.equal(rows[0].signal_date, FIRST_ELIGIBLE_SIGNAL_SESSION);
  assert.equal(rows[0].execution_date, FIRST_ELIGIBLE_EXECUTION_SESSION);
  assert.ok(rows.every((row) => row.signal_date > LAST_CONSUMED_SESSION));
  assert.ok(rows.every((row) => row.execution_date > LAST_CONSUMED_SESSION));
});

test("prospective scorer rejects forged importer envelopes, dates, and nonfinite growth", () => {
  const imported = importImmutableOhlc(syntheticPayload());
  const common = {
    policyId: DOWNSIDE_SEMIVOLATILITY_POLICY_ID,
    maximumRows: 2,
  };

  const noEnvelope = structuredClone(imported);
  delete noEnvelope.schema_version;
  assert.throws(
    () => simulateProspectivePolicyNextOpen(noEnvelope, common),
    /immutable OHLC importer envelope/iu,
  );

  const undefinedDate = structuredClone(imported);
  undefinedDate.adjusted.points[300].date = undefined;
  assert.throws(
    () => simulateProspectivePolicyNextOpen(undefinedDate, common),
    /must be an ISO date/iu,
  );

  const duplicateDate = structuredClone(imported);
  duplicateDate.adjusted.points[300].date = duplicateDate.adjusted.points[299].date;
  assert.throws(
    () => simulateProspectivePolicyNextOpen(duplicateDate, common),
    /duplicated or out of order/iu,
  );

  const nonfiniteGrowth = structuredClone(imported);
  const executionIndex = nonfiniteGrowth.adjusted.points.findIndex(
    (point) => point.date === FIRST_ELIGIBLE_EXECUTION_SESSION,
  );
  nonfiniteGrowth.adjusted.points[executionIndex].SPY.open = Number.MIN_VALUE;
  nonfiniteGrowth.adjusted.points[executionIndex].SPY.close = Number.MAX_VALUE;
  assert.throws(
    () => simulateProspectivePolicyNextOpen(nonfiniteGrowth, common),
    /must be positive|growth/iu,
  );
});

test("next-open mechanics preserve drift, exact cost algebra, and long-only bounds", () => {
  const imported = importImmutableOhlc(syntheticPayload());
  const options = {
    policyId: DOWNSIDE_SEMIVOLATILITY_POLICY_ID,
    oneWayCostBps: 5,
    rebalanceAnchor: 0,
    maximumRows: 7,
  };
  const rows = simulateProspectivePolicyNextOpen(imported, options);
  assert.equal(rows[0].rebalanced, true);
  assert.equal(rows[1].rebalanced, false);
  assert.equal(rows[4].rebalanced, false);
  assert.equal(rows[5].rebalanced, true);

  const first = rows[0];
  assert.ok(Math.abs(first.gross_two_leg_turnover - 2 * first.target_spy_weight) < 1e-9);
  assert.ok(Math.abs(first.transaction_cost_fraction
    - first.gross_two_leg_turnover * 5 / 10_000) < 1e-10);

  const nextPointIndex = imported.adjusted.points.findIndex(
    (point) => point.date === rows[1].execution_date,
  );
  const priorPoint = imported.adjusted.points[nextPointIndex - 1];
  const nextPoint = imported.adjusted.points[nextPointIndex];
  const spyOvernight = nextPoint.SPY.open / priorPoint.SPY.close;
  const bilOvernight = nextPoint.BIL.open / priorPoint.BIL.close;
  const openGrowth = rows[0].close_spy_weight * spyOvernight
    + rows[0].close_bil_weight * bilOvernight;
  const expectedHeldSpy = rows[0].close_spy_weight * spyOvernight / openGrowth;
  assert.ok(Math.abs(rows[1].target_spy_weight - expectedHeldSpy) < 2e-10);

  for (const row of rows) {
    for (const key of ["target_spy_weight", "target_bil_weight", "close_spy_weight", "close_bil_weight"]) {
      assert.ok(row[key] >= 0 && row[key] <= 1, `${key} escaped bounds`);
    }
    assert.ok(Math.abs(row.target_spy_weight + row.target_bil_weight - 1) < 1e-10);
    assert.ok(Math.abs(row.close_spy_weight + row.close_bil_weight - 1) < 1e-10);
  }

  const zeroCost = simulateProspectivePolicyNextOpen(imported, {
    ...options,
    oneWayCostBps: 0,
    maximumRows: 2,
  });
  const fiveBps = simulateProspectivePolicyNextOpen(imported, {
    ...options,
    maximumRows: 2,
  });
  assert.deepEqual(
    fiveBps.map((row) => [row.target_spy_weight, row.close_spy_weight]),
    zeroCost.map((row) => [row.target_spy_weight, row.close_spy_weight]),
  );
  const expectedCostedGrowth = (1 + zeroCost[0].net_return)
    * (1 - fiveBps[0].transaction_cost_fraction);
  assert.ok(Math.abs((1 + fiveBps[0].net_return) - expectedCostedGrowth) < 2e-12);
});

test("future-only incumbent comparison is identically anchored and deterministic", () => {
  const imported = importImmutableOhlc(syntheticPayload());
  const expectedSessions = expectedExecutionSessions(imported);
  assert.equal(expectedSessions.length, REQUIRED_PROSPECTIVE_RETURNS);
  assert.throws(
    () => compareProspectiveDownsideSemivolatility(imported),
    /expected execution sessions must contain exactly 252 dates/iu,
  );
  assert.throws(
    () => compareProspectiveDownsideSemivolatility(imported, {
      protocolSha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      expectedExecutionSessions: expectedSessions,
    }),
    /protocol hash changed/iu,
  );
  const first = compareProspectiveDownsideSemivolatility(imported, {
    expectedExecutionSessions: expectedSessions,
  });
  const second = compareProspectiveDownsideSemivolatility(imported, {
    expectedExecutionSessions: expectedSessions,
  });

  assert.equal(first.matrix_dimensions.cell_count, 40);
  assert.equal(first.matrix_dimensions.required_consecutive_execution_returns,
    REQUIRED_PROSPECTIVE_RETURNS);
  assert.equal(first.cells.length, 40);
  assert.ok(first.cells.every((cell) => (
    cell.alignment.observations_per_policy === REQUIRED_PROSPECTIVE_RETURNS
      && cell.alignment.first_execution_date === FIRST_ELIGIBLE_EXECUTION_SESSION
      && cell.alignment.identical_dates_and_rebalance_flags === true
  )));
  assert.deepEqual(first.policies, [FROZEN_INCUMBENT_POLICY_ID, DOWNSIDE_SEMIVOLATILITY_POLICY_ID]);
  assert.equal(first.evidence_class, "UNVERIFIED_PROSPECTIVE_MECHANICS_REPLAY");
  assert.equal(first.prospective_evidence_eligible, false);
  assert.equal(first.activation_verified, false);
  assert.equal(first.primary_inference, null);
  assert.equal(first.primary_inference_permitted_by_this_scaffold, false);
  assert.equal(first.sensitivity_cells_can_rescue_or_reverse_primary, false);
  assert.equal(first.hindsight_boundary.consumed_history_scored, false);
  assert.equal(first.incumbent_modification_or_promotion_permitted, false);
  assert.equal(first.disposition, "RESEARCH_ONLY_KEEP_FROZEN_INCUMBENT");
  assert.equal(first.output_sha256, second.output_sha256);
  assert.equal(stableStringify(first), stableStringify(second));

  const missingFirstPayload = syntheticPayload();
  for (const book of [missingFirstPayload.adjusted, missingFirstPayload.raw]) {
    for (const symbol of ["SPY", "BIL"]) {
      book[symbol] = book[symbol].filter((row) => row.date !== FIRST_ELIGIBLE_EXECUTION_SESSION);
    }
  }
  const missingFirst = importImmutableOhlc(missingFirstPayload);
  assert.throws(
    () => compareProspectiveDownsideSemivolatility(missingFirst, {
      expectedExecutionSessions: expectedSessions,
    }),
    /missing the registered first signal or execution session|complete expected/iu,
  );

  const missingInternalDate = expectedSessions[20];
  const gapPayload = syntheticPayload();
  for (const book of [gapPayload.adjusted, gapPayload.raw]) {
    for (const symbol of ["SPY", "BIL"]) {
      book[symbol] = book[symbol].filter((row) => row.date !== missingInternalDate);
    }
  }
  const gap = importImmutableOhlc(gapPayload);
  assert.throws(
    () => compareProspectiveDownsideSemivolatility(gap, {
      expectedExecutionSessions: expectedSessions,
    }),
    /complete expected signal and execution session chain/iu,
  );
});
