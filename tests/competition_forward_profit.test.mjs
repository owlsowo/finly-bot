import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256 } from "../lib/canonical.mjs";
import {
  assertCompetitionForwardProfitContract,
  buildCompetitionForwardProfitMeasurement,
} from "../lib/competition_forward_profit.mjs";

const contract = JSON.parse(await readFile(new URL("../config/competition-forward-profit.json", import.meta.url), "utf8"));
const productionProtocol = JSON.parse(await readFile(new URL("../config/g4-official-production.json", import.meta.url), "utf8"));
const AT_1330 = "2026-08-31T13:30:00.000Z";
const AT_1331 = "2026-08-31T13:31:00.000Z";
const AT_1332 = "2026-08-31T13:32:00.000Z";
const OBSERVED_AT = "2026-08-31T13:32:30.000Z";
const COMPLETE_ACTIVITY_SNAPSHOT = Object.freeze({
  pagination_exhausted: true,
  bounded_snapshot_stable: true,
  all_rows_classified: true,
  economic_activity_final: false,
});

function point(windowStartAt, valueKey, value) {
  return {
    window_start_at: windowStartAt,
    valued_at: new Date(Date.parse(windowStartAt) + 60_000).toISOString(),
    [valueKey]: value,
  };
}

function fill(eventAt) {
  return { kind: "FILL", event_at: eventAt, time_basis: "EXECUTION", effective_date: null, net_amount: null };
}

function nontrade(kind, eventAt, netAmount) {
  return {
    kind,
    event_at: eventAt,
    time_basis: "PUBLICATION",
    effective_date: "2026-08-31",
    net_amount: netAmount,
  };
}

function baseInput(overrides = {}) {
  return {
    contract,
    observedAt: OBSERVED_AT,
    activityCoverageThrough: OBSERVED_AT,
    accountPoints: [
      point(AT_1330, "equity", 100_050),
      point(AT_1331, "equity", 100_200),
    ],
    spyAnchor: {
      window_start_at: AT_1330,
      valued_at: AT_1331,
      open_price: 100,
    },
    spyPoints: [
      point(AT_1330, "price", 100.05),
      point(AT_1331, "price", 100.1),
    ],
    activities: [
      fill(AT_1331),
      nontrade("FEE", AT_1331, -5),
    ],
    activityCompleteness: COMPLETE_ACTIVITY_SNAPSHOT,
    ...overrides,
  };
}

test("frozen KPI contract authenticates and binds the exact production protocol", () => {
  assert.equal(assertCompetitionForwardProfitContract(contract), contract);
  assert.equal(contract.production_protocol.protocol_id, productionProtocol.protocol_id);
  assert.equal(contract.production_protocol.protocol_hash, productionProtocol.protocol_hash);
  assert.equal(contract.competition_window.start_at, productionProtocol.competition_window.start_at);
  assert.equal(contract.competition_window.end_at, productionProtocol.competition_window.end_at);
  assert.equal(contract.competition_window.baseline_equity_dollars,
    productionProtocol.allocation.baseline_equity_dollars);
  assert.ok(Date.parse(contract.frozen_at) < Date.parse(contract.competition_window.start_at));
  const body = structuredClone(contract);
  delete body.contract_hash;
  assert.equal(contract.contract_hash, sha256(body));

  const changed = structuredClone(contract);
  changed.primary_kpi.success_threshold = "-1.00";
  assert.throws(() => assertCompetitionForwardProfitContract(changed), /hash|drift/u);
  const recomputedWrong = structuredClone(changed);
  const wrongBody = structuredClone(recomputedWrong);
  delete wrongBody.contract_hash;
  recomputedWrong.contract_hash = sha256(wrongBody);
  assert.throws(() => assertCompetitionForwardProfitContract(recomputedWrong), /hash|drift/u);
});

test("measures positive net profit and SPY outperformance at the latest exact common valued-at", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput());
  assert.equal(result.status, "MEASURED");
  assert.equal(result.common_valued_at, AT_1332);
  assert.deepEqual(result.primary_kpi, {
    aligned_broker_equity_dollars: 100_200,
    net_pnl_dollars: 200,
    return_fraction: 0.002,
    profitable: true,
  });
  assert.deepEqual(result.secondary_kpi, {
    excess_return_fraction: 0.001,
    excess_pnl_dollars: 100,
    outperformed_spy: true,
  });
  assert.equal(result.integrity.claim_publishable, true);
  assert.equal(result.authority.broker_mutation_authorized, false);
});

test("keeps positive profit and SPY outperformance as separate questions", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1331, "equity", 100_100)],
    spyPoints: [point(AT_1331, "price", 100.2)],
  }));
  assert.equal(result.primary_kpi.profitable, true);
  assert.equal(result.primary_kpi.net_pnl_dollars, 100);
  assert.equal(result.secondary_kpi.outperformed_spy, false);
  assert.equal(result.secondary_kpi.excess_pnl_dollars, -100);
});

test("can lose money while beating a falling SPY without calling the account profitable", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1331, "equity", 99_950)],
    spyPoints: [point(AT_1331, "price", 99.8)],
  }));
  assert.equal(result.primary_kpi.profitable, false);
  assert.equal(result.primary_kpi.net_pnl_dollars, -50);
  assert.equal(result.secondary_kpi.outperformed_spy, true);
  assert.equal(result.secondary_kpi.excess_pnl_dollars, 150);
});

test("reports simultaneous absolute and relative losses", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1331, "equity", 99_900)],
    spyPoints: [point(AT_1331, "price", 100.05)],
  }));
  assert.equal(result.primary_kpi.profitable, false);
  assert.equal(result.secondary_kpi.outperformed_spy, false);
});

test("zero is the frozen boundary for both KPIs", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1331, "equity", 100_000)],
    spyPoints: [point(AT_1331, "price", 100)],
  }));
  assert.equal(result.primary_kpi.net_pnl_dollars, 0);
  assert.equal(result.primary_kpi.profitable, false);
  assert.equal(result.secondary_kpi.excess_return_fraction, 0);
  assert.equal(result.secondary_kpi.outperformed_spy, false);
});

test("published precision and success booleans can never contradict one another", () => {
  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1331, "equity", 100_000.001)],
  })), /cent precision/u);

  const tiny = buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1331, "equity", 100_000)],
    spyPoints: [point(AT_1331, "price", 99.99999999999999)],
  }));
  assert.equal(tiny.secondary_kpi.excess_return_fraction, 0);
  assert.equal(tiny.secondary_kpi.excess_pnl_dollars, 0);
  assert.equal(tiny.secondary_kpi.outperformed_spy, false);
});

test("returns UNOBSERVED before an official SPY anchor exists", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    observedAt: "2026-08-31T13:00:00.000Z",
    activityCoverageThrough: "2026-08-31T13:00:00.000Z",
    accountPoints: [],
    spyAnchor: null,
    spyPoints: [],
    activities: [],
  }));
  assert.equal(result.status, "UNOBSERVED");
  assert.equal(result.withheld_reason, "SPY_ANCHOR_NOT_OBSERVED");
  assert.equal(result.primary_kpi, null);
  assert.equal(result.integrity.claim_publishable, false);
});

test("left-labelled 09:30 windows align at 09:31 and never forward-fill", () => {
  const exact = buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1330, "equity", 100_050), point(AT_1331, "equity", 100_200)],
    spyPoints: [point(AT_1330, "price", 100.05)],
  }));
  assert.equal(exact.common_valued_at, AT_1331);
  assert.equal(exact.primary_kpi.net_pnl_dollars, 50);

  const noIntersection = buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1330, "equity", 100_050)],
    spyPoints: [point(AT_1331, "price", 100.1)],
  }));
  assert.equal(noIntersection.status, "UNOBSERVED");
  assert.equal(noIntersection.withheld_reason, "NO_EXACT_COMMON_COMPLETED_MINUTE");
});

test("rejects malformed, future, end-boundary, duplicate, unsorted, and misnormalized points", () => {
  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [{ window_start_at: AT_1330, valued_at: AT_1330, equity: 100_200 }],
  })), /left-labelled minute/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point("2026-08-31T13:32:00.000Z", "equity", 100_200)],
  })), /future/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point("2026-09-04T13:29:00.000Z", "equity", 100_200)],
    observedAt: "2026-09-04T14:00:00.000Z",
    activityCoverageThrough: "2026-09-04T14:00:00.000Z",
  })), /outside/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [{ window_start_at: "not-a-date", valued_at: AT_1331, equity: 100_200 }],
  })), /invalid/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [{ window_start_at: AT_1330, valued_at: "2026-08-31T13:31:00Z", equity: 100_200 }],
  })), /invalid/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1330, "equity", 100_050), point(AT_1330, "equity", 100_200)],
  })), /ordered|duplicate/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1331, "equity", 100_200), point(AT_1330, "equity", 100_050)],
  })), /strictly ordered/u);
});

test("withholds claims for incomplete activity pages or coverage that precedes valuation", () => {
  const incomplete = buildCompetitionForwardProfitMeasurement(baseInput({
    activityCompleteness: {
      ...COMPLETE_ACTIVITY_SNAPSHOT,
      pagination_exhausted: false,
      bounded_snapshot_stable: false,
    },
  }));
  assert.equal(incomplete.status, "WITHHELD_ACTIVITIES_INCOMPLETE");
  assert.equal(incomplete.primary_kpi, null);
  assert.equal(incomplete.drivers.fill_event_count, null);

  const stale = buildCompetitionForwardProfitMeasurement(baseInput({
    activityCoverageThrough: AT_1331,
  }));
  assert.equal(stale.status, "WITHHELD_ACTIVITIES_INCOMPLETE");
  assert.equal(stale.withheld_reason, "ACTIVITY_COVERAGE_PRECEDES_VALUATION");

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    activityCoverageThrough: AT_1331,
    activities: [fill(AT_1332)],
  })), /exceeds declared activity coverage/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    activityCoverageThrough: "2026-08-31T13:33:00.000Z",
  })), /coverage time is in the future/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    activities: [fill("2026-08-31T13:33:00.000Z")],
  })), /future/u);
});

test("deposit and withdrawal events cannot cancel their way around the cashflow guardrail", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    activities: [
      nontrade("EXTERNAL_CASHFLOW", AT_1331, 1_000),
      nontrade("EXTERNAL_CASHFLOW", AT_1332, -1_000),
    ],
  }));
  assert.equal(result.status, "WITHHELD_EXTERNAL_CASHFLOW");
  assert.equal(result.withheld_reason, "EXTERNAL_ACTIVITY_PRESENT");
  assert.equal(result.drivers.external_cashflow_event_count, 2);
  assert.equal(result.drivers.external_cashflow_gross_absolute_dollars, 2_000);
  assert.equal(result.drivers.external_cashflow_net_dollars, 0);
  assert.equal(result.integrity.claim_publishable, false);
});

test("unknown classifications and missing external amounts fail closed", () => {
  const unknown = buildCompetitionForwardProfitMeasurement(baseInput({
    activities: [nontrade("UNKNOWN", AT_1331, 0)],
    activityCompleteness: { ...COMPLETE_ACTIVITY_SNAPSHOT, all_rows_classified: false },
  }));
  assert.equal(unknown.status, "WITHHELD_ACTIVITIES_INCOMPLETE");
  assert.equal(unknown.withheld_reason, "ACCOUNT_ACTIVITY_CLASSIFICATION_INCOMPLETE");
  assert.equal(unknown.primary_kpi, null);

  const missing = buildCompetitionForwardProfitMeasurement(baseInput({
    activities: [nontrade("EXTERNAL_CASHFLOW", AT_1331, null)],
  }));
  assert.equal(missing.status, "WITHHELD_EXTERNAL_CASHFLOW");
  assert.equal(missing.withheld_reason, "EXTERNAL_ACTIVITY_PRESENT");
});

test("an unclassified bounded snapshot cannot publish even when no UNKNOWN row is passed", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    activities: [],
    activityCompleteness: { ...COMPLETE_ACTIVITY_SNAPSHOT, all_rows_classified: false },
  }));
  assert.equal(result.status, "WITHHELD_ACTIVITIES_INCOMPLETE");
  assert.equal(result.withheld_reason, "ACCOUNT_ACTIVITY_CLASSIFICATION_INCOMPLETE");
  assert.equal(result.primary_kpi, null);
  assert.equal(result.drivers.fill_event_count, null);
  assert.equal(result.integrity.claim_publishable, false);
});

test("zero-dollar security transfers still withhold the fixed-baseline profit claim", () => {
  for (const amount of [0, null, 100, -100]) {
    const result = buildCompetitionForwardProfitMeasurement(baseInput({
      activities: [nontrade("EXTERNAL_CASHFLOW", AT_1331, amount)],
    }));
    assert.equal(result.status, "WITHHELD_EXTERNAL_CASHFLOW");
    assert.equal(result.withheld_reason, "EXTERNAL_ACTIVITY_PRESENT");
    assert.equal(result.drivers.external_cashflow_event_count, 1);
  }
});

test("endogenous income remains performance while fees are reported but not double-subtracted", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    activities: [
      nontrade("ENDOGENOUS", AT_1331, 4),
      nontrade("FEE", AT_1331, -5),
      nontrade("FEE", AT_1332, 1),
    ],
  }));
  assert.equal(result.status, "MEASURED");
  assert.equal(result.primary_kpi.net_pnl_dollars, 200);
  assert.equal(result.drivers.broker_reported_fee_paid_dollars, 5);
  assert.equal(result.drivers.broker_reported_fee_rebate_dollars, 1);
  assert.equal(result.drivers.broker_reported_fee_net_effect_dollars, -4);
  assert.equal(result.integrity.fee_included_in_equity_not_subtracted, true);
});

test("counts fill events without labeling them orders or trades", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput({
    activities: [
      fill(AT_1331),
      fill(AT_1332),
    ],
  }));
  assert.equal(result.drivers.fill_event_count, 2);
  assert.equal("filled_order_count" in result.drivers, false);
});

test("normalized inputs cannot leak account, activity, order, or credential identifiers", () => {
  const input = baseInput();
  input.activities = [{ ...fill(AT_1331), order_id: "paper-order-sensitive" }];
  assert.throws(() => buildCompetitionForwardProfitMeasurement(input), /unknown fields/u);
  const resultText = JSON.stringify(buildCompetitionForwardProfitMeasurement(baseInput()));
  assert.doesNotMatch(resultText, /account_number|activity_id|order[_-]?id|credential|secret|token/iu);
});

test("measurement hashing is deterministic and insertion-order independent", () => {
  const result = buildCompetitionForwardProfitMeasurement(baseInput());
  const reorderedInput = baseInput();
  reorderedInput.activities = [
    { net_amount: null, effective_date: null, time_basis: "EXECUTION", event_at: AT_1331, kind: "FILL" },
    {
      net_amount: -5,
      effective_date: "2026-08-31",
      kind: "FEE",
      time_basis: "PUBLICATION",
      event_at: AT_1331,
    },
  ];
  const repeat = buildCompetitionForwardProfitMeasurement(reorderedInput);
  assert.equal(result.measurement_hash, repeat.measurement_hash);
  const changed = buildCompetitionForwardProfitMeasurement(baseInput({
    accountPoints: [point(AT_1331, "equity", 100_201)],
  }));
  assert.notEqual(changed.measurement_hash, result.measurement_hash);
  const body = structuredClone(result);
  delete body.measurement_hash;
  assert.equal(result.measurement_hash, sha256(body));
});

test("official SPY anchor is exact, completed, and mandatory for benchmark points", () => {
  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    spyAnchor: null,
  })), /cannot exist without/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    spyAnchor: { window_start_at: AT_1331, valued_at: AT_1332, open_price: 100 },
  })), /first completed official/u);

  assert.throws(() => buildCompetitionForwardProfitMeasurement(baseInput({
    observedAt: "2026-08-31T13:30:30.000Z",
    activityCoverageThrough: "2026-08-31T13:30:30.000Z",
    accountPoints: [],
    spyPoints: [],
    activities: [],
  })), /anchor is in the future/u);
});

test("calculator is pure and cannot reach execution, credentials, network, or persistence", async () => {
  const source = await readFile(new URL("../lib/competition_forward_profit.mjs", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .+ from "([^"]+)";/gmu)].map((match) => match[1]);
  assert.deepEqual(imports, ["./canonical.mjs"]);
  assert.doesNotMatch(source,
    /\bfetch\s*\(|node:https?|node:fs|process\.env|writeFile|appendFile|placeStockOrder|placeOptionOrder|cancelOrder|mutation_ack/u);

  const frozenTrader = await readFile(new URL("../lib/g4_official_equity.mjs", import.meta.url), "utf8");
  const coordinator = await readFile(new URL("../lib/g4_official_coordinator.mjs", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/paper-agent-cloud.yml", import.meta.url), "utf8");
  assert.doesNotMatch(frozenTrader, /competition_forward_profit/u);
  assert.doesNotMatch(coordinator, /competition_forward_profit/u);
  assert.doesNotMatch(workflow, /competition.forward.profit/u);
  assert.match(workflow, /FINLY_CODE_VERSION: 572b8a60e845fabd910f5d4843c51697abcc82ad/u);
});
