import assert from "node:assert/strict";
import test from "node:test";

import {
  KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA,
  parseKennethFrenchDailyFactorCsv,
} from "../research/external_validation_attempt115/kenneth_french_daily_factor_adapter.mjs";
import {
  EXTERNAL_ATTEMPT115_CADENCE_ANCHORS,
  EXTERNAL_ATTEMPT115_COST_BPS,
  EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION,
  EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION,
  EXTERNAL_ATTEMPT115_PRIMARY_END_DATE,
  EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS,
  replayExternalAttempt115Cell,
  replayExternalAttempt115Grid,
} from "../research/external_validation_attempt115/replay.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
} from "../research/prospective_attempt115/policy.mjs";

const DAY_MILLISECONDS = 86_400_000;
const MARKET = "MARKET_PROXY";
const RF = "RF_PROXY";
const POLICIES = [
  ATTEMPT115_INCUMBENT_POLICY_ID,
  ATTEMPT115_CHALLENGER_POLICY_ID,
];

function weekdayDates(count, start = "2005-12-01T00:00:00.000Z") {
  const dates = [];
  let timestamp = Date.parse(start);
  while (dates.length < count) {
    const date = new Date(timestamp);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) dates.push(date.toISOString().slice(0, 10));
    timestamp += DAY_MILLISECONDS;
  }
  return dates;
}

function compactDate(value) {
  return value.replaceAll("-", "");
}

function syntheticParsed({
  count = 600,
  start,
  returnOverride = null,
} = {}) {
  const dates = weekdayDates(count, start);
  const rows = dates.map((date, index) => {
    const baseline = {
      marketExcessPercent:
        0.09 + 0.58 * Math.sin(index / 6.7) + 0.17 * Math.cos(index / 19.1),
      rfPercent: 0.012 + 0.002 * Math.cos(index / 47),
    };
    const selected = returnOverride?.(baseline, index) ?? baseline;
    return [
      compactDate(date),
      selected.marketExcessPercent.toFixed(8),
      (0.04 * Math.sin(index / 11)).toFixed(8),
      (0.03 * Math.cos(index / 13)).toFixed(8),
      selected.rfPercent.toFixed(8),
    ].join(",");
  });
  return parseKennethFrenchDailyFactorCsv([
    KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA,
    ...rows,
  ].join("\n"));
}

function primaryPolicy(result, policyId) {
  return result.partitions.primary_pre_overlap.policies[policyId];
}

test("replay pins observations 253, 254, and 255 to signal, execution, and first outcome", () => {
  const parsed = syntheticParsed();
  const replay = replayExternalAttempt115Cell(parsed);

  assert.equal(EXTERNAL_ATTEMPT115_WARMUP_OBSERVATIONS, 253);
  assert.equal(EXTERNAL_ATTEMPT115_FIRST_EXECUTION_OBSERVATION, 254);
  assert.equal(EXTERNAL_ATTEMPT115_FIRST_SCORED_OBSERVATION, 255);
  assert.deepEqual(replay.timing.initial_allocation, { [MARKET]: 0, [RF]: 1 });

  for (const policyId of POLICIES) {
    const first = primaryPolicy(replay, policyId).rows[0];
    assert.equal(first.signal_date, parsed.rows[252].date);
    assert.equal(first.execution_date, parsed.rows[253].date);
    assert.equal(first.outcome_observation_date, parsed.rows[254].date);
    assert.equal(first.rebalanced, true);
    assert.equal(first.standalone_entry, true);
  }

  const tooShort = syntheticParsed({ count: 254 });
  assert.throws(
    () => replayExternalAttempt115Cell(tooShort),
    /at least 255 aligned factor observations/iu,
  );
});

test("the first target is unchanged by every observation after its signal", () => {
  const baseline = syntheticParsed();
  const mutated = syntheticParsed({
    returnOverride: (value, index) => index <= 252 ? value : {
      marketExcessPercent: index % 2 === 0 ? 4.5 : -3.7,
      rfPercent: 0.08,
    },
  });
  const before = replayExternalAttempt115Cell(baseline);
  const after = replayExternalAttempt115Cell(mutated);

  for (const policyId of POLICIES) {
    const beforeFirst = primaryPolicy(before, policyId).rows[0];
    const afterFirst = primaryPolicy(after, policyId).rows[0];
    assert.equal(beforeFirst.signal_date, afterFirst.signal_date);
    assert.deepEqual(beforeFirst.start_weights, afterFirst.start_weights);
    assert.notDeepEqual(beforeFirst.proxy_returns, afterFirst.proxy_returns);
  }
});

test("cadence anchors delay the first rebalance by exactly zero through four scored rows", () => {
  const parsed = syntheticParsed();
  for (const anchor of EXTERNAL_ATTEMPT115_CADENCE_ANCHORS) {
    const replay = replayExternalAttempt115Cell(parsed, { rebalanceAnchor: anchor });
    for (const policyId of POLICIES) {
      const rows = primaryPolicy(replay, policyId).rows;
      assert.equal(rows.findIndex((row) => row.rebalanced), anchor);
      assert.equal(rows[anchor].signal_date, parsed.rows[252 + anchor].date);
      assert.equal(rows[anchor].execution_date, parsed.rows[253 + anchor].date);
    }
  }
});

test("pre-rebalance observations remain fully allocated to the RF proxy", () => {
  const parsed = syntheticParsed();
  const replay = replayExternalAttempt115Cell(parsed, { rebalanceAnchor: 4 });
  const firstRfReturn = parsed.rows[254].RF_PROXY;

  for (const policyId of POLICIES) {
    const first = primaryPolicy(replay, policyId).rows[0];
    assert.deepEqual(first.start_weights, { [MARKET]: 0, [RF]: 1 });
    assert.equal(first.rebalanced, false);
    assert.ok(Math.abs(first.gross_return - firstRfReturn) < 1e-12);
    assert.equal(first.entry_absolute_leg_turnover, 0);
    assert.equal(first.transaction_cost_fraction, 0);
  }
});

test("weights drift self-financing between scheduled rebalances", () => {
  const replay = replayExternalAttempt115Cell(syntheticParsed());
  for (const policyId of POLICIES) {
    const rows = primaryPolicy(replay, policyId).rows;
    const first = rows[0];
    const second = rows[1];
    assert.equal(second.rebalanced, false);
    assert.deepEqual(second.start_weights, first.end_weights);
    const expectedMarket = first.start_weights[MARKET]
      * (1 + first.proxy_returns[MARKET]) / first.gross_growth;
    const expectedRf = first.start_weights[RF]
      * (1 + first.proxy_returns[RF]) / first.gross_growth;
    assert.ok(Math.abs(first.end_weights[MARKET] - expectedMarket) < 1e-12);
    assert.ok(Math.abs(first.end_weights[RF] - expectedRf) < 1e-12);
    assert.ok(Math.abs(first.end_weights[MARKET] + first.end_weights[RF] - 1) < 1e-12);
  }
});

test("absolute-leg entry and terminal costs are charged in every standalone partition", () => {
  const replay = replayExternalAttempt115Cell(syntheticParsed());
  for (const partition of Object.values(replay.partitions)) {
    for (const policyId of POLICIES) {
      const { rows, metrics } = partition.policies[policyId];
      const first = rows[0];
      const last = rows.at(-1);
      const expectedEntry = Math.abs(first.start_weights[MARKET])
        + Math.abs(first.start_weights[RF] - 1);
      assert.ok(Math.abs(first.entry_absolute_leg_turnover - expectedEntry) < 1e-12);
      assert.equal(last.standalone_terminal_liquidation, true);
      assert.equal(
        last.terminal_liquidation_absolute_leg_turnover,
        Math.abs(last.end_weights[MARKET]) + Math.abs(last.end_weights[RF] - 1),
      );
      assert.ok(last.terminal_liquidation_cost_fraction >= 0);
      assert.ok(metrics.cumulative_absolute_leg_turnover >= expectedEntry);
      assert.ok(metrics.modeled_cost_paid_initial_wealth >= 0);
      assert.ok(Math.abs(metrics.total_return - (last.wealth_index - 1)) < 1e-12);
      assert.equal(
        metrics.net_log_growth,
        rows.reduce((sum, row) => sum + Math.log1p(row.net_return), 0),
      );
    }
  }
});

test("higher registered cost stress preserves the gross path and lowers net wealth", () => {
  const parsed = syntheticParsed();
  const low = replayExternalAttempt115Cell(parsed, { oneWayCostBps: 1 });
  const high = replayExternalAttempt115Cell(parsed, { oneWayCostBps: 25 });

  for (const policyId of POLICIES) {
    const lowPolicy = primaryPolicy(low, policyId);
    const highPolicy = primaryPolicy(high, policyId);
    assert.ok(lowPolicy.metrics.cumulative_absolute_leg_turnover > 0);
    assert.equal(lowPolicy.metrics.gross_total_return, highPolicy.metrics.gross_total_return);
    assert.ok(highPolicy.metrics.total_return < lowPolicy.metrics.total_return);
    assert.ok(
      highPolicy.metrics.modeled_cost_drag_simple_sum
        > lowPolicy.metrics.modeled_cost_drag_simple_sum,
    );
    assert.deepEqual(
      lowPolicy.rows.map((row) => row.start_weights),
      highPolicy.rows.map((row) => row.start_weights),
    );
  }
});

test("primary and overlap results are strictly separated at the frozen cutoff", () => {
  const replay = replayExternalAttempt115Cell(syntheticParsed());
  const primary = replay.partitions.primary_pre_overlap;
  const overlap = replay.partitions.overlap_diagnostic_only;

  assert.equal(primary.end_date, EXTERNAL_ATTEMPT115_PRIMARY_END_DATE);
  assert.equal(overlap.start_date, "2007-05-30");
  assert.ok(primary.end_date <= EXTERNAL_ATTEMPT115_PRIMARY_END_DATE);
  assert.ok(overlap.start_date > EXTERNAL_ATTEMPT115_PRIMARY_END_DATE);
  assert.equal(
    primary.observations + overlap.observations,
    syntheticParsed().rows.length - 254,
  );
  assert.equal(primary.policies[ATTEMPT115_INCUMBENT_POLICY_ID].rows[0].standalone_entry, true);
  assert.equal(overlap.policies[ATTEMPT115_INCUMBENT_POLICY_ID].rows[0].standalone_entry, true);
});

test("paired daily endpoint is the exact challenger-minus-incumbent net-log difference", () => {
  const replay = replayExternalAttempt115Cell(syntheticParsed());
  for (const partition of Object.values(replay.partitions)) {
    const incumbent = partition.policies[ATTEMPT115_INCUMBENT_POLICY_ID].rows;
    const challenger = partition.policies[ATTEMPT115_CHALLENGER_POLICY_ID].rows;
    assert.equal(partition.paired_daily_net_log_returns.length, incumbent.length);
    assert.equal(
      partition.paired_daily_net_log_return_differences.length,
      incumbent.length,
    );
    partition.paired_daily_net_log_returns.forEach((paired, index) => {
      assert.equal(
        paired.outcome_observation_date,
        incumbent[index].outcome_observation_date,
      );
      assert.equal(
        paired.challenger_minus_incumbent_net_log_return,
        Math.log1p(challenger[index].net_return)
          - Math.log1p(incumbent[index].net_return),
      );
      assert.equal(
        partition.paired_daily_net_log_return_differences[index],
        paired.challenger_minus_incumbent_net_log_return,
      );
    });
  }
  assert.ok(Object.isFrozen(replay));
  assert.ok(Object.isFrozen(replay.partitions.primary_pre_overlap));
  assert.doesNotMatch(JSON.stringify(replay), /\b(?:SPY|BIL)\b/u);
});

test("grid fixes 5bp anchor zero as primary and covers every registered sensitivity", () => {
  const grid = replayExternalAttempt115Grid(syntheticParsed());
  assert.equal(grid.primary_cell.execution_model.one_way_cost_bps, 5);
  assert.equal(grid.primary_cell.execution_model.rebalance_anchor, 0);
  assert.equal(grid.sensitivity_cells.length, 20);
  assert.deepEqual(
    grid.sensitivity_cells.map((cell) => [cell.rebalance_anchor, cell.one_way_cost_bps]),
    EXTERNAL_ATTEMPT115_CADENCE_ANCHORS.flatMap((anchor) => (
      EXTERNAL_ATTEMPT115_COST_BPS.map((cost) => [anchor, cost])
    )),
  );
  assert.ok(grid.sensitivity_cells.every((cell) => !Object.hasOwn(cell, "partitions")));
  const primarySummary = grid.sensitivity_cells.find(
    (cell) => cell.rebalance_anchor === 0 && cell.one_way_cost_bps === 5,
  );
  assert.equal(primarySummary.replay_sha256, grid.primary_cell.replay_sha256);
  assert.doesNotMatch(JSON.stringify(grid), /\b(?:SPY|BIL)\b/u);
});

test("validation fails closed for unsupported costs, anchors, dates, and source envelopes", () => {
  const parsed = syntheticParsed();
  for (const value of [0, 2, 5.5, "5", Number.NaN]) {
    assert.throws(
      () => replayExternalAttempt115Cell(parsed, { oneWayCostBps: value }),
      /one-way cost must be one of/iu,
    );
  }
  for (const value of [-1, 1.5, 5, "0"]) {
    assert.throws(
      () => replayExternalAttempt115Cell(parsed, { rebalanceAnchor: value }),
      /cadence anchor must be an integer/iu,
    );
  }
  assert.throws(
    () => replayExternalAttempt115Cell(parsed, { primaryEndDate: "2007-05-29" }),
    /unknown option/iu,
  );
  assert.throws(
    () => replayExternalAttempt115Cell(null),
    /parsed Kenneth French daily factor source|factor adapter envelope/iu,
  );
  assert.throws(
    () => replayExternalAttempt115Cell(parsed, { extra: true }),
    /unknown option/iu,
  );
  assert.throws(
    () => replayExternalAttempt115Cell(parsed, null),
    /options must be a plain object/iu,
  );
  assert.throws(
    () => replayExternalAttempt115Cell(parsed, new Date()),
    /options must be a plain object/iu,
  );
  assert.throws(
    () => replayExternalAttempt115Grid(parsed, { primaryEndDate: "2007-05-29" }),
    /unknown option/iu,
  );
  const noOverlap = syntheticParsed({ count: 300, start: "2000-01-03T00:00:00.000Z" });
  assert.throws(
    () => replayExternalAttempt115Cell(noOverlap),
    /both primary and overlap partitions/iu,
  );
});
