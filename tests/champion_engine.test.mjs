import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeLongWeights,
  rebaseRowsForStandalonePeriod,
  simulateStrategy,
} from "../research/champion_engine.mjs";

function datedPoints(length, buildPrices) {
  const start = Date.parse("2020-01-01T00:00:00Z");
  return Object.freeze(Array.from({ length }, (_, index) => Object.freeze({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    ...buildPrices(index),
  })));
}

test("champion engine lets holdings drift between scheduled rebalances", () => {
  const points = datedPoints(280, (index) => ({
    SPY: index < 254 ? 100 : 110 * (1.01 ** (index - 254)),
    BIL: 100,
  }));
  const simulation = simulateStrategy(points, ["SPY", "BIL"], {
    id: "half_spy",
    rebalanceIntervalSessions: 21,
    decide() {
      return normalizeLongWeights({ SPY: 0.5 }, { cashSymbol: "BIL", maximumRiskyGross: 1 });
    },
  }, {
    lookbackSessions: 252,
    oneWayCostBps: 0,
    maximumRiskyGross: 1,
    terminalLiquidation: false,
  });

  assert.equal(simulation.rows[0].signal_date, points[252].date);
  assert.equal(simulation.rows[0].rebalance_date, points[253].date);
  assert.equal(simulation.rows[0].execution_return_date, points[254].date);
  assert.equal(simulation.rows[0].weights.SPY, 0.5);
  assert.equal(simulation.rows[1].rebalanced, false);
  assert.equal(simulation.rows[1].signal_weights.SPY, 0.5);
  assert.ok(Math.abs(simulation.rows[1].weights.SPY - (0.55 / 1.05)) < 1e-9);
});

test("a strategy never observes a return dated after its signal close", () => {
  const points = datedPoints(280, (index) => ({
    SPY: 100 + index,
    BIL: 100 + index * 0.01,
  }));
  const observationsAtDecision = [];
  const simulation = simulateStrategy(points, ["SPY", "BIL"], {
    id: "causal_observer",
    rebalanceIntervalSessions: 1,
    decide({ signalDate, rows }) {
      assert.ok(rows.every((row) => row.execution_return_date <= signalDate));
      observationsAtDecision.push({ signalDate, rowCount: rows.length });
      return normalizeLongWeights({ SPY: 1 }, { cashSymbol: "BIL", maximumRiskyGross: 1 });
    },
  }, {
    lookbackSessions: 252,
    oneWayCostBps: 0,
    maximumRiskyGross: 1,
    terminalLiquidation: false,
  });

  assert.equal(observationsAtDecision[0].rowCount, 0);
  assert.equal(observationsAtDecision[1].rowCount, 0);
  assert.equal(observationsAtDecision[2].rowCount, 1);
  assert.equal(simulation.rows[0].execution_return_date, observationsAtDecision[2].signalDate);
});

test("turnover is charged against drifted pretrade holdings, not stale targets", () => {
  const points = datedPoints(280, (index) => ({
    SPY: index < 254 ? 100 : 100 * (1.02 ** (index - 253)),
    BIL: 100,
  }));
  const simulation = simulateStrategy(points, ["SPY", "BIL"], {
    id: "daily_half_spy",
    rebalanceIntervalSessions: 1,
    decide() {
      return normalizeLongWeights({ SPY: 0.5 }, { cashSymbol: "BIL", maximumRiskyGross: 1 });
    },
  }, {
    lookbackSessions: 252,
    oneWayCostBps: 5,
    maximumRiskyGross: 1,
    terminalLiquidation: false,
  });

  assert.equal(simulation.rows[0].turnover_notional, 1);
  assert.ok(simulation.rows[1].turnover_notional > 0);
  assert.ok(simulation.rows[1].turnover_notional < 0.02);
});

test("an execution-time rebalance band compares the target with then-drifted holdings", () => {
  const points = datedPoints(280, (index) => ({
    SPY: index < 254 ? 100 : 100 * (1.01 ** (index - 253)),
    BIL: 100,
  }));
  const simulation = simulateStrategy(points, ["SPY", "BIL"], {
    id: "banded_half_spy",
    rebalanceIntervalSessions: 1,
    rebalanceBand: 0.05,
    decide() {
      return normalizeLongWeights({ SPY: 0.5 }, { cashSymbol: "BIL", maximumRiskyGross: 1 });
    },
  }, {
    lookbackSessions: 252,
    oneWayCostBps: 5,
    maximumRiskyGross: 1,
    terminalLiquidation: false,
  });

  assert.equal(simulation.rows[0].rebalanced, true);
  assert.equal(simulation.rows[1].rebalanced, false);
  assert.equal(simulation.rows[1].turnover_notional, 0);
  assert.ok(simulation.rows[1].weights.SPY > 0.5);
});

test("standalone windows replace inherited costs and charge entry plus terminal exit", () => {
  const points = datedPoints(280, (index) => ({
    SPY: 100 * (1.001 ** index),
    BIL: 100,
  }));
  const simulation = simulateStrategy(points, ["SPY", "BIL"], {
    id: "buy_hold",
    decide() {
      return normalizeLongWeights({ SPY: 1 }, { cashSymbol: "BIL", maximumRiskyGross: 1 });
    },
  }, {
    lookbackSessions: 252,
    oneWayCostBps: 5,
    maximumRiskyGross: 1,
    terminalLiquidation: true,
  });
  const window = rebaseRowsForStandalonePeriod(simulation.rows.slice(3, 8), {
    cashSymbol: "BIL",
    oneWayCostBps: 5,
  });

  assert.equal(window[0].standalone_entry_notional, 2);
  assert.equal(window[0].standalone_entry_cost, 0.001);
  assert.ok(window.at(-1).standalone_terminal_liquidation_notional > 0.999);
  assert.ok(window.at(-1).standalone_terminal_liquidation_cost >= 0.000499);
  assert.equal(window.filter((row) => row.standalone_entry).length, 1);
  assert.equal(window.filter((row) => row.standalone_terminal_liquidation).length, 1);
});
