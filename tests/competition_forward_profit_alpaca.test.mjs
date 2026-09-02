import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256 } from "../lib/canonical.mjs";
import {
  ALPACA_ENDOGENOUS_ACTIVITY_TYPES,
  ALPACA_EXTERNAL_ACTIVITY_TYPES,
  AlpacaForwardProfitReadClient,
  assertAlpacaActivitySnapshotCoversBaseline,
  assertAlpacaScopedActivitySnapshotMatchesUnfiltered,
  assertAlpacaPreWindowOrderGuard,
  assertCompetitionActivityBaseline,
  buildAlpacaForwardProfitRequestPlan,
  collectAlpacaActivityPages,
  listAlpacaInWindowFillOrderIds,
  normalizeAlpacaForwardProfitEvidence,
} from "../lib/competition_forward_profit_alpaca.mjs";
import { buildG4OfficialOrderPlan } from "../lib/g4_official_equity.mjs";

const contract = JSON.parse(await readFile(
  new URL("../config/competition-forward-profit.json", import.meta.url), "utf8",
));
const activityBaseline = JSON.parse(await readFile(
  new URL("../config/competition-forward-profit-activity-baseline.json", import.meta.url), "utf8",
));
const productionProtocol = JSON.parse(await readFile(
  new URL("../config/g4-official-production.json", import.meta.url), "utf8",
));
const g4OrderPlan = buildG4OfficialOrderPlan(productionProtocol);
const AT_1330 = "2026-08-31T13:30:00.000Z";
const AT_1331 = "2026-08-31T13:31:00.000Z";
const OBSERVED_AT = "2026-08-31T13:32:30.000Z";
const ACTIVITY_COVERAGE = "2026-08-31T13:31:01.000Z";
const KEY = "paper-key-id";
const SECRET = "paper-secret-key";
const ACCOUNT = "paper-account-competition";

const marketCalendar = Object.freeze([
  { date: "2026-08-31", open: "09:30", close: "16:00" },
  { date: "2026-09-01", open: "09:30", close: "16:00" },
  { date: "2026-09-02", open: "09:30", close: "16:00" },
  { date: "2026-09-03", open: "09:30", close: "16:00" },
  { date: "2026-09-04", open: "09:30", close: "16:00" },
]);

function portfolioHistory(points = [{ at: AT_1330, equity: 100_100 }]) {
  return {
    base_value: 100_000,
    base_value_asof: "2026-08-31",
    cashflow: { CSD: points.map(() => 0), DIV: points.map(() => 0) },
    equity: points.map(({ equity }) => equity),
    profit_loss: points.map(({ equity }) => equity - 100_000),
    profit_loss_pct: points.map(({ equity }) => equity / 100_000 - 1),
    timeframe: "1Min",
    timestamp: points.map(({ at }) => Date.parse(at) / 1000),
  };
}

function bar(at = AT_1330, { open = 100, close = 100.05 } = {}) {
  return {
    c: close,
    h: Math.max(open, close) + 0.01,
    l: Math.min(open, close) - 0.01,
    n: 10,
    o: open,
    t: at.replace(".000Z", "Z"),
    v: 1000,
    vw: (open + close) / 2,
  };
}

function spyPages(bars = [bar()]) {
  return [{
    request_page_token: null,
    response: { bars, currency: "USD", next_page_token: null, symbol: "SPY" },
  }];
}

function accountActivityPages(items = []) {
  if (items.length === 0) return [{ request_page_token: null, items: [] }];
  return [
    { request_page_token: null, items },
    { request_page_token: items.at(-1).id, items: [] },
  ];
}

function nontrade(activityType, options = {}) {
  const {
    id = `${activityType.toLowerCase()}::00000000-0000-0000-0000-000000000001`,
    createdAt = "2026-08-31T13:30:30Z",
    date = "2026-08-31",
    currency = "USD",
    netAmount = "0",
    status = "executed",
  } = options;
  const activity = {
    activity_type: activityType,
    created_at: createdAt,
    currency,
    date,
    description: "sanitized test fixture",
    id,
    net_amount: netAmount,
    status,
  };
  if (Object.hasOwn(options, "currency") && options.currency === undefined) delete activity.currency;
  return activity;
}

function fill(index = 1, type = "fill", overrides = {}) {
  return {
    activity_type: "FILL",
    cum_qty: "1",
    id: `fill::${String(index).padStart(12, "0")}`,
    leaves_qty: "0",
    order_id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(index).padStart(12, "0")}`,
    price: "100.00",
    qty: "1",
    side: "buy",
    symbol: "QQQ",
    transaction_time: "2026-08-31T13:30:30Z",
    type,
    ...overrides,
  };
}

function g4OrderProof(activity = fill()) {
  const projection = g4OrderPlan.find(({ symbol }) => symbol === activity.symbol);
  if (projection === undefined) throw new Error("test fill is not a G4 equity symbol");
  return {
    id: activity.order_id,
    asset_class: "us_equity",
    client_order_id: projection.client_order_id,
    created_at: "2026-08-31T13:30:01Z",
    extended_hours: false,
    legs: null,
    notional: projection.notional,
    order_class: "",
    qty: null,
    replaced_by: null,
    replaces: null,
    side: activity.side,
    submitted_at: "2026-08-31T13:30:02Z",
    symbol: activity.symbol,
    time_in_force: "day",
    type: "market",
  };
}

function proofsForPages(pages) {
  const byOrderId = new Map();
  for (const activity of pages.flatMap(({ items }) => items)) {
    if (activity.activity_type === "FILL" && !byOrderId.has(activity.order_id)) {
      byOrderId.set(activity.order_id, g4OrderProof(activity));
    }
  }
  return [...byOrderId.values()];
}

function normalize(overrides = {}) {
  const activityPages = overrides.activityPages ?? accountActivityPages();
  return normalizeAlpacaForwardProfitEvidence({
    contract,
    activityBaseline,
    observedAt: OBSERVED_AT,
    maximumValuedAt: AT_1331,
    activityCoverageThrough: ACTIVITY_COVERAGE,
    marketCalendar,
    portfolioHistory: portfolioHistory(),
    activityPages,
    fillOrderProofs: overrides.fillOrderProofs ?? proofsForPages(activityPages),
    spyBarPages: spyPages(),
    accountCurrency: "USD",
    activityCreationBoundsVerified: true,
    ...overrides,
  });
}

function ok(body) {
  return { ok: true, status: 200, json: async () => structuredClone(body) };
}

function activeAccount(accountNumber = ACCOUNT) {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    account_number: accountNumber,
    currency: "USD",
    status: "ACTIVE",
    trading_blocked: false,
    account_blocked: false,
    trade_suspended_by_user: false,
  };
}

test("baseline and KPI contract form a placeholder-free authenticated chain", async () => {
  assert.equal(assertCompetitionActivityBaseline(activityBaseline, contract), activityBaseline);
  const baselineBody = structuredClone(activityBaseline);
  delete baselineBody.baseline_hash;
  assert.equal(activityBaseline.baseline_hash, sha256(baselineBody));
  const contractBody = structuredClone(contract);
  delete contractBody.contract_hash;
  assert.equal(contract.contract_hash, sha256(contractBody));
  assert.equal(contract.activity_baseline.baseline_hash, activityBaseline.baseline_hash);
  assert.match(activityBaseline.account_id_hash, /^sha256:[a-f0-9]{64}$/u);
  const text = await Promise.all([
    readFile(new URL("../config/competition-forward-profit.json", import.meta.url), "utf8"),
    readFile(new URL("../config/competition-forward-profit-activity-baseline.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/competition_forward_profit.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(text.join("\n"), /PLACEHOLDER/u);
  assert.equal(activityBaseline.raw_identifiers_persisted, false);
});

test("the authoritative client requires every frozen baseline row with an identical payload", () => {
  const prior = nontrade("JNLC", {
    id: "jnlc::00000000-0000-0000-0000-000000000099",
    createdAt: "2026-08-30T12:00:00Z",
    date: "2026-08-30",
  });
  const syntheticBaseline = {
    activity_count: 1,
    activity_records: [{ id_hash: sha256(prior.id), payload_hash: sha256(prior) }],
  };
  assert.equal(assertAlpacaActivitySnapshotCoversBaseline(
    accountActivityPages([prior]), syntheticBaseline,
  ), true);
  assert.throws(() => assertAlpacaActivitySnapshotCoversBaseline(
    accountActivityPages(), syntheticBaseline,
  ), /missing a frozen baseline row/u);
  assert.throws(() => assertAlpacaActivitySnapshotCoversBaseline(
    accountActivityPages([{ ...prior, net_amount: "1" }]), syntheticBaseline,
  ), /payload drifted/u);
});

test("the server-bounded activity scope exactly equals the unfiltered ledger delta", () => {
  const prior = nontrade("JNLC", {
    id: "jnlc::00000000-0000-0000-0000-000000000099",
    createdAt: "2026-08-30T12:00:00Z",
    date: "2026-08-30",
  });
  const current = nontrade("DIV");
  const syntheticBaseline = {
    activity_records: [{ id_hash: sha256(prior.id), payload_hash: sha256(prior) }],
  };
  assert.equal(assertAlpacaScopedActivitySnapshotMatchesUnfiltered(
    accountActivityPages([current]), accountActivityPages([prior, current]), syntheticBaseline,
  ), true);
  assert.throws(() => assertAlpacaScopedActivitySnapshotMatchesUnfiltered(
    accountActivityPages(), accountActivityPages([prior, current]), syntheticBaseline,
  ), /does not match the unfiltered ledger delta/u);
  assert.throws(() => assertAlpacaScopedActivitySnapshotMatchesUnfiltered(
    accountActivityPages([prior, current]), accountActivityPages([prior, current]), syntheticBaseline,
  ), /contains a frozen baseline row/u);
});

test("normalizes documented left labels, optional fields, and exact common-minute profit", () => {
  const result = normalize();
  assert.equal(result.status, "MEASURED");
  assert.equal(result.common_valued_at, AT_1331);
  assert.equal(result.primary_kpi.net_pnl_dollars, 100);
  assert.equal(result.benchmark.anchor_open_price, 100);
  assert.equal(result.integrity.activities_bounded_snapshot_stable, true);
  assert.equal(result.integrity.economic_activity_final, false);
  assert.equal(result.drivers.fee_settlement_status, "provisional_as_of_activity_publication_coverage");
});

test("portfolio cashflow object is shape-checked and independently catches contributed cash", () => {
  const external = portfolioHistory();
  external.cashflow.CSD[0] = 10;
  assert.throws(() => normalize({ portfolioHistory: external }), /cashflow crosscheck detected/u);

  const unknown = portfolioHistory();
  unknown.cashflow.NEWTYPE = [10];
  assert.throws(() => normalize({ portfolioHistory: unknown }), /cashflow crosscheck detected/u);

  const malformed = portfolioHistory();
  malformed.cashflow.DIV = [];
  assert.throws(() => normalize({ portfolioHistory: malformed }), /arrays are misaligned/u);

  const nullCashflow = portfolioHistory();
  nullCashflow.cashflow.CSD[0] = null;
  assert.throws(() => normalize({ portfolioHistory: nullCashflow }), /cashflow CSD 1 is invalid/u);

  const nullable = portfolioHistory();
  nullable.base_value_asof = null;
  nullable.equity[0] = null;
  nullable.profit_loss[0] = null;
  nullable.profit_loss_pct[0] = null;
  assert.equal(normalize({ portfolioHistory: nullable }).status, "UNOBSERVED");
});

test("official calendar removes extended-hours and the 16:00 closing sentinel", () => {
  const closeSentinel = "2026-08-31T20:00:00.000Z";
  const result = normalize({
    observedAt: "2026-08-31T20:02:30.000Z",
    maximumValuedAt: "2026-08-31T20:01:00.000Z",
    activityCoverageThrough: "2026-08-31T20:01:01.000Z",
    portfolioHistory: portfolioHistory([
      { at: AT_1330, equity: 100_100 },
      { at: closeSentinel, equity: 100_500 },
    ]),
    spyBarPages: spyPages([bar(), bar(closeSentinel, { open: 101, close: 102 })]),
  });
  assert.equal(result.common_valued_at, AT_1331);
  assert.equal(result.primary_kpi.net_pnl_dollars, 100);
});

test("final scoring uses Thursday's regular close rather than Friday premarket", () => {
  const thursdayLastMinute = "2026-09-03T19:59:00.000Z";
  const result = normalize({
    observedAt: "2026-09-04T13:30:30.000Z",
    maximumValuedAt: "2026-09-04T13:29:00.000Z",
    activityCoverageThrough: "2026-09-04T13:30:29.999Z",
    portfolioHistory: portfolioHistory([
      { at: AT_1330, equity: 100_100 },
      { at: thursdayLastMinute, equity: 100_500 },
    ]),
    spyBarPages: spyPages([
      bar(),
      bar(thursdayLastMinute, { open: 101, close: 102 }),
    ]),
  });
  assert.equal(result.status, "MEASURED");
  assert.equal(result.common_valued_at, "2026-09-03T20:00:00.000Z");
  assert.equal(result.primary_kpi.net_pnl_dollars, 500);
});

test("pre-open measurement performs no network I/O and keeps credentials non-enumerable", async () => {
  let calls = 0;
  const client = new AlpacaForwardProfitReadClient({
    keyId: KEY,
    secretKey: SECRET,
    expectedAccountId: ACCOUNT,
    now: () => "2026-08-31T13:00:00.000Z",
    fetchImpl: async () => { calls += 1; throw new Error("not expected"); },
  });
  assert.equal(JSON.stringify(client), "{}");
  assert.doesNotMatch(JSON.stringify(client), new RegExp(`${KEY}|${SECRET}|${ACCOUNT}`, "u"));
  const result = await client.measure({ contract, activityBaseline });
  assert.equal(calls, 0);
  assert.equal(result.status, "UNOBSERVED");
});

test("request plan fixes the safe cutoff and every exact GET query", () => {
  const plan = buildAlpacaForwardProfitRequestPlan(contract, OBSERVED_AT);
  assert.equal(plan.observed_at, OBSERVED_AT);
  assert.equal(plan.maximum_valued_at, AT_1331);
  assert.equal(plan.activity_coverage_through, "2026-08-31T13:31:00.999Z");
  assert.deepEqual(plan.pre_window_order_guard, {
    path: "/v2/orders",
    query: {
      status: "all", until: AT_1330, direction: "desc", limit: "1", nested: "false",
    },
  });
  assert.equal(plan.portfolio.path, "/v2/account/portfolio/history");
  assert.equal(plan.portfolio.query.end, AT_1330);
  assert.equal(plan.portfolio.query.cashflow_types, "ALL");
  assert.equal(plan.portfolio.query.intraday_reporting, "market_hours");
  assert.equal("after" in plan.activity_baseline_recheck.query, false);
  assert.equal(plan.activity_baseline_recheck.query.until, ACTIVITY_COVERAGE);
  assert.equal(plan.activities.query.after, AT_1330);
  assert.equal(plan.activities.query.until, ACTIVITY_COVERAGE);
  assert.equal(plan.activities.query.page_size, "100");
  assert.equal(plan.spy.query.end, AT_1330);
  assert.equal(plan.spy.query.currency, "USD");
  assert.equal(buildAlpacaForwardProfitRequestPlan(contract, "2026-08-31T13:31:59.999Z"), null);

  const finalPlan = buildAlpacaForwardProfitRequestPlan(contract, "2026-09-04T13:31:30.000Z");
  assert.equal(finalPlan.maximum_valued_at, "2026-09-04T13:29:00.000Z");
  assert.equal(finalPlan.portfolio.query.end, "2026-09-04T13:28:00.000Z");
  assert.equal(finalPlan.spy.query.end, "2026-09-04T13:28:00.000Z");

  const openingPlan = buildAlpacaForwardProfitRequestPlan(
    contract, "2026-09-01T13:31:05.000Z", marketCalendar,
  );
  assert.equal(openingPlan.maximum_valued_at, "2026-09-01T13:30:00.000Z");
  assert.equal(openingPlan.portfolio.query.end, "2026-08-31T19:59:00.000Z");
  assert.equal(openingPlan.spy.query.end, "2026-08-31T19:59:00.000Z");

  const firstSessionPlan = buildAlpacaForwardProfitRequestPlan(contract, OBSERVED_AT, marketCalendar);
  assert.equal(firstSessionPlan.portfolio.query.end, AT_1330);
  assert.equal(firstSessionPlan.spy.query.end, AT_1330);

  const intradayPlan = buildAlpacaForwardProfitRequestPlan(
    contract, "2026-09-01T13:37:30.000Z", marketCalendar,
  );
  assert.equal(intradayPlan.portfolio.query.end, "2026-09-01T13:35:00.000Z");
  assert.equal(intradayPlan.spy.query.end, "2026-09-01T13:35:00.000Z");

  const afterClosePlan = buildAlpacaForwardProfitRequestPlan(
    contract, "2026-08-31T20:02:30.000Z", marketCalendar,
  );
  assert.equal(afterClosePlan.portfolio.query.end, "2026-08-31T19:59:00.000Z");
  assert.equal(afterClosePlan.spy.query.end, "2026-08-31T19:59:00.000Z");
});

test("account mismatch aborts before calendar, history, activity, or market-data reads", async () => {
  let calls = 0;
  const client = new AlpacaForwardProfitReadClient({
    keyId: KEY,
    secretKey: SECRET,
    expectedAccountId: ACCOUNT,
    now: () => OBSERVED_AT,
    fetchImpl: async () => { calls += 1; return ok(activeAccount("wrong-account")); },
  });
  await assert.rejects(() => client.measure({ contract, activityBaseline }), /account verification failed/u);
  assert.equal(calls, 1);
});

test("changed duplicate activity sweeps fail closed instead of publishing P&L", () => {
  const result = normalize({ boundedActivitySnapshotStable: false });
  assert.equal(result.status, "WITHHELD_ACTIVITIES_INCOMPLETE");
  assert.equal(result.integrity.activities_bounded_snapshot_stable, false);
  assert.equal(result.integrity.claim_publishable, false);
});

test("all external activity types with zero cash still withhold", async (context) => {
  for (const type of ALPACA_EXTERNAL_ACTIVITY_TYPES) {
    await context.test(type, () => {
      const result = normalize({
        activityPages: accountActivityPages([nontrade(type)]),
      });
      assert.equal(result.status, "WITHHELD_EXTERNAL_CASHFLOW");
      assert.equal(result.withheld_reason, "EXTERNAL_ACTIVITY_PRESENT");
      assert.equal(result.drivers.external_cashflow_event_count, 1);
    });
  }
});

test("external settlement dates outside the competition dates cannot hide contributed value", () => {
  const result = normalize({
    activityPages: accountActivityPages([nontrade("CSD", {
      date: "2026-09-05",
      netAmount: "1000",
    })]),
  });
  assert.equal(result.status, "WITHHELD_EXTERNAL_CASHFLOW");
  assert.equal(result.withheld_reason, "EXTERNAL_ACTIVITY_PRESENT");
  assert.equal(result.drivers.external_cashflow_event_count, 1);
});

test("a new pre-open fill invalidates the frozen flat-account baseline", () => {
  const preopenFill = fill();
  preopenFill.transaction_time = "2026-08-31T13:29:59Z";
  assert.throws(() => normalize({
    activityPages: accountActivityPages([preopenFill]),
  }), /pre-window fill invalidates/u);
});

test("every new pre-window activity invalidates the exact $100,000 baseline", () => {
  assert.throws(() => normalize({
    activityPages: accountActivityPages([nontrade("DIV", {
      createdAt: "2026-08-31T13:29:59Z",
    })]),
  }), /pre-window activity invalidates/u);
  assert.throws(() => normalize({
    activityPages: accountActivityPages([nontrade("FEE", {
      createdAt: "2026-08-31T13:30:30Z",
      date: "2026-08-30",
      netAmount: "-1",
    })]),
  }), /pre-window activity invalidates/u);
});

test("latest-order guard proves no order was introduced after the flat baseline capture", () => {
  assert.equal(assertAlpacaPreWindowOrderGuard([], activityBaseline, contract), true);
  const oldOrder = {
    id: "11111111-1111-1111-1111-111111111111",
    created_at: "2026-08-30T12:00:00Z",
    submitted_at: "2026-08-30T12:00:00Z",
  };
  assert.equal(assertAlpacaPreWindowOrderGuard([oldOrder], activityBaseline, contract), true);
  assert.throws(() => assertAlpacaPreWindowOrderGuard([{
    ...oldOrder,
    id: "22222222-2222-2222-2222-222222222222",
    created_at: "2026-08-31T08:00:00Z",
    submitted_at: "2026-08-31T08:00:00Z",
  }], activityBaseline, contract), /order invalidates/u);
});

test("fill provenance is mandatory and bound to the exact frozen G4 order", () => {
  const observedFill = fill();
  const pages = accountActivityPages([observedFill]);
  assert.deepEqual(listAlpacaInWindowFillOrderIds(pages, contract, activityBaseline), [observedFill.order_id]);
  assert.throws(() => normalize({ activityPages: pages, fillOrderProofs: [] }), /proof is missing/u);
  assert.throws(() => normalize({
    activityPages: pages,
    fillOrderProofs: [{ ...g4OrderProof(observedFill), replaces: "33333333-3333-3333-3333-333333333333" }],
  }), /outside the frozen G4 order plan/u);
  assert.throws(() => normalize({
    activityPages: pages,
    fillOrderProofs: [{ ...g4OrderProof(observedFill), notional: "48499.99" }],
  }), /outside the frozen G4 plan/u);
  assert.throws(() => normalize({
    activityPages: pages,
    fillOrderProofs: [{ ...g4OrderProof(observedFill), extended_hours: true }],
  }), /outside the frozen G4 plan/u);
  assert.equal(normalize({
    activityPages: pages,
    fillOrderProofs: [g4OrderProof(observedFill)],
  }).drivers.fill_event_count, 1);
});

test("nested SPY spread fills share one parent proof without weakening provenance", () => {
  const parentOrderId = "44444444-4444-4444-4444-444444444444";
  const longSymbol = "SPY260904P00600000";
  const shortSymbol = "SPY260904P00590000";
  const fills = [
    fill(1, "fill", { order_id: parentOrderId, symbol: longSymbol, side: "buy" }),
    fill(2, "fill", { order_id: parentOrderId, symbol: shortSymbol, side: "sell" }),
  ];
  const proof = {
    id: parentOrderId,
    asset_class: "",
    client_order_id: "finly-0123456789abcdefabcd",
    created_at: "2026-08-31T13:30:01Z",
    extended_hours: false,
    legs: [
      {
        asset_class: "us_option", symbol: longSymbol, side: "buy", position_intent: "buy_to_open",
        extended_hours: false, order_class: "mleg", qty: "1", ratio_qty: "1",
        replaces: null, replaced_by: null, time_in_force: "day", type: "",
      },
      {
        asset_class: "us_option", symbol: shortSymbol, side: "sell", position_intent: "sell_to_open",
        extended_hours: false, order_class: "mleg", qty: "1", ratio_qty: "1",
        replaces: null, replaced_by: null, time_in_force: "day", type: "",
      },
    ],
    order_class: "mleg",
    limit_price: "1.25",
    notional: null,
    qty: "1",
    replaced_by: null,
    replaces: null,
    side: "",
    submitted_at: "2026-08-31T13:30:02Z",
    symbol: "",
    time_in_force: "day",
    type: "limit",
  };
  const result = normalize({
    activityPages: accountActivityPages(fills),
    fillOrderProofs: [proof],
  });
  assert.equal(result.status, "MEASURED");
  assert.equal(result.drivers.fill_event_count, 2);

  assert.throws(() => normalize({
    activityPages: accountActivityPages(fills),
    fillOrderProofs: [{ ...proof, order_class: "bracket" }],
  }), /equity fill-order proof|outside the frozen/u);

  const straddleProof = structuredClone(proof);
  straddleProof.legs[1].symbol = "SPY260904C00590000";
  const straddleFills = [fills[0], { ...fills[1], symbol: straddleProof.legs[1].symbol }];
  assert.throws(() => normalize({
    activityPages: accountActivityPages(straddleFills),
    fillOrderProofs: [straddleProof],
  }), /spread legs/u);

  const twoBuyProof = structuredClone(proof);
  twoBuyProof.legs[1].side = "buy";
  twoBuyProof.legs[1].position_intent = "buy_to_open";
  const twoBuyFills = [fills[0], { ...fills[1], side: "buy" }];
  assert.throws(() => normalize({
    activityPages: accountActivityPages(twoBuyFills),
    fillOrderProofs: [twoBuyProof],
  }), /spread legs/u);
});

test("current and legacy nonexternal mappings are exhaustive and fail closed on MISC", async (context) => {
  const currentTypes = new Set([
    "ACATC", "ACATS", "CFEE", "CGD", "CSD", "CSW", "DIV", "DIVCGL", "DIVCGS", "DIVFEE",
    "DIVFT", "DIVNRA", "DIVROC", "DIVTW", "DIVTXEX", "FEE", "FILL", "FOPT", "INT", "INTNRA",
    "INTTW", "JNL", "JNLC", "JNLS", "MA", "MISC", "NC", "OCT", "OPASN", "OPCA", "OPCSH",
    "OPEXC", "OPEXP", "OPTRD", "PTC", "PTR", "REO", "REORG", "SPIN", "SPLIT", "TRANS",
  ]);
  const mapped = new Set([...ALPACA_EXTERNAL_ACTIVITY_TYPES, ...ALPACA_ENDOGENOUS_ACTIVITY_TYPES, "MISC"]);
  for (const type of currentTypes) assert.ok(mapped.has(type), `missing current type ${type}`);
  assert.equal(currentTypes.size, 41);
  for (const alias of ["OPXRC", "SC", "SSO", "SSP"]) assert.ok(mapped.has(alias));

  const feeTypes = new Set(["CFEE", "DIVFEE", "FEE", "PTC", "PTR"]);
  const endogenous = ALPACA_ENDOGENOUS_ACTIVITY_TYPES
    .filter((type) => type !== "FILL" && !feeTypes.has(type));
  for (const type of feeTypes) {
    await context.test(`fee-${type}`, () => {
      const result = normalize({
        activityPages: accountActivityPages([nontrade(type, { netAmount: "-1" })]),
      });
      assert.equal(result.status, "MEASURED");
      assert.equal(result.drivers.broker_reported_fee_paid_dollars, 1);
    });
  }
  for (const type of endogenous) {
    await context.test(`endogenous-${type}`, () => {
      const result = normalize({
        activityPages: accountActivityPages([nontrade(type)]),
      });
      assert.equal(result.status, "MEASURED");
    });
  }
  const filled = normalize({ activityPages: accountActivityPages([fill()]) });
  assert.equal(filled.drivers.fill_event_count, 1);
  const unknown = normalize({ activityPages: accountActivityPages([nontrade("MISC")]) });
  assert.equal(unknown.status, "WITHHELD_ACTIVITIES_INCOMPLETE");
  assert.equal(unknown.integrity.activities_all_rows_classified, false);
});

test("account USD provenance supports legacy NTA currency omission; conflicts fail closed", () => {
  const legacyFee = nontrade("FEE", { currency: undefined, netAmount: "-1" });
  delete legacyFee.created_at;
  delete legacyFee.status;
  const measured = normalize({ activityPages: accountActivityPages([legacyFee]) });
  assert.equal(measured.status, "MEASURED");
  assert.equal(measured.drivers.broker_reported_fee_paid_dollars, 1);

  for (const type of ["FEE", "TRANS"]) {
    const result = normalize({
      activityPages: accountActivityPages([nontrade(type, { currency: "EUR", netAmount: "50" })]),
    });
    assert.equal(result.status, "WITHHELD_ACTIVITIES_INCOMPLETE");
    assert.equal(result.integrity.activities_all_rows_classified, false);
    assert.equal(result.drivers.broker_reported_fee_paid_dollars, null);
    assert.equal(result.drivers.external_cashflow_net_dollars, null);
  }
  assert.throws(() => normalize({ accountCurrency: "EUR" }), /account currency is not USD/u);
  assert.throws(() => normalize({
    activityPages: accountActivityPages([legacyFee]),
    activityCreationBoundsVerified: false,
  }), /pre-window activity invalidates/u);
});

test("post-window fee publication retains its economic date without inventing an execution time", () => {
  const result = normalize({
    observedAt: "2026-09-05T12:00:00.000Z",
    maximumValuedAt: AT_1331,
    activityCoverageThrough: "2026-09-05T12:00:00.000Z",
    activityPages: accountActivityPages([nontrade("FEE", {
      createdAt: "2026-09-05T11:00:00Z",
      date: "2026-09-04",
      netAmount: "-2",
    })]),
  });
  assert.equal(result.status, "MEASURED");
  assert.equal(result.drivers.broker_reported_fee_paid_dollars, 2);
  assert.equal(result.integrity.economic_activity_final, false);
});

test("exact-multiple activity pagination requests a terminal empty page and preserves partial fills", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => fill(
    index + 1,
    index === 0 ? "partial_fill" : "fill",
    { order_id: "aaaaaaaa-aaaa-aaaa-aaaa-000000000001" },
  ));
  const calls = [];
  const pages = await collectAlpacaActivityPages(async (pageToken) => {
    calls.push(pageToken);
    return pageToken === null ? rows : [];
  });
  assert.deepEqual(calls, [null, rows.at(-1).id]);
  assert.equal(pages.at(-1).items.length, 0);
  const result = normalize({
    activityPages: pages,
    fillOrderProofs: [g4OrderProof(rows[0])],
  });
  assert.equal(result.status, "MEASURED");
  assert.equal(result.drivers.fill_event_count, 100);
});

test("malformed pages, future points, and unsafe identities fail closed without leaking inputs", async () => {
  assert.throws(() => normalize({
    spyBarPages: [{ request_page_token: null, response: {
      bars: [bar("2026-08-31T13:31:00.000Z")], currency: "USD", next_page_token: null, symbol: "SPY",
    } }],
  }), /outside the completed measurement window/u);
  assert.throws(() => normalize({
    activityPages: accountActivityPages([nontrade("DIV", { id: "unsafe" })]),
  }), /ID is invalid/u);
  const repeated = Array.from({ length: 100 }, (_, index) => fill(index + 1));
  assert.throws(() => normalize({
    activityPages: [
      { request_page_token: null, items: repeated },
      { request_page_token: repeated.at(-1).id, items: repeated },
      { request_page_token: repeated.at(-1).id, items: [] },
    ],
  }), /token repeated/u);
  assert.throws(() => new AlpacaForwardProfitReadClient({
    keyId: KEY, secretKey: SECRET, expectedAccountId: ACCOUNT, tradingBase: "https://api.alpaca.markets",
  }), /not allowlisted/u);

  const client = new AlpacaForwardProfitReadClient({
    keyId: KEY,
    secretKey: SECRET,
    expectedAccountId: ACCOUNT,
    now: () => OBSERVED_AT,
    fetchImpl: async () => { throw new Error(`${KEY}-${SECRET}-${ACCOUNT}`); },
  });
  await assert.rejects(async () => client.measure({ contract, activityBaseline }), (error) => {
    assert.equal(error.message, "Alpaca forward-profit read transport failed");
    assert.doesNotMatch(error.message, new RegExp(`${KEY}|${SECRET}|${ACCOUNT}`, "u"));
    return true;
  });
});

test("measurement adapter is GET-only and isolated from the pinned trader", async () => {
  const source = await readFile(new URL("../lib/competition_forward_profit_alpaca.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source,
    /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']|placeStockOrder|placeOptionOrder|cancelOrder|mutation_ack/iu);
  const workflow = await readFile(new URL("../.github/workflows/paper-agent-cloud.yml", import.meta.url), "utf8");
  assert.match(workflow, /FINLY_CODE_VERSION: 572b8a60e845fabd910f5d4843c51697abcc82ad/u);
  assert.doesNotMatch(workflow, /competition_forward_profit_alpaca/u);
  const runner = await readFile(new URL("../scripts/run_competition_forward_profit.mjs", import.meta.url), "utf8");
  assert.match(runner, /AlpacaForwardProfitReadClient/u);
  assert.match(runner, /RUNNER_TEMP/u);
  assert.doesNotMatch(runner,
    /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']|placeStockOrder|placeOptionOrder|cancelOrder|mutation_ack/iu);
});

test("measurement workflow is separately pinned, read-only, scheduled, and artifact-only", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/competition-forward-profit.yml", import.meta.url), "utf8",
  );
  assert.match(workflow, /FINLY_MEASUREMENT_CODE_VERSION: 2e648aa1f98e883032e97d7069b3ed5974638abe/u);
  assert.match(workflow, /permissions:\n {2}contents: read/u);
  assert.match(workflow, /node scripts\/run_competition_forward_profit\.mjs/u);
  assert.match(workflow, /actions\/upload-artifact@v6\.0\.0/u);
  assert.match(workflow, /cron: "32,37,52 13 31 8 \*"/u);
  assert.doesNotMatch(workflow,
    /contents:\s*write|FINLY_PAPER_MUTATION_ACK|FINLY_EXECUTION_ENABLED|FEATHERLESS|\b(?:POST|PUT|PATCH|DELETE)\b/iu);

  const traderWorkflow = await readFile(
    new URL("../.github/workflows/paper-agent-cloud.yml", import.meta.url), "utf8",
  );
  assert.match(traderWorkflow, /FINLY_CODE_VERSION: 572b8a60e845fabd910f5d4843c51697abcc82ad/u);
  assert.doesNotMatch(traderWorkflow, /FINLY_MEASUREMENT_CODE_VERSION|competition_forward_profit/u);
});
