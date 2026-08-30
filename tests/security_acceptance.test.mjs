import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GuardedPaperExecutor } from "../lib/alpaca.mjs";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { sha256 } from "../lib/canonical.mjs";
import { runDecision } from "../lib/pipeline.mjs";
import { POLICY } from "../lib/policy.mjs";
import { MemoryPermitLedger } from "../lib/permit_ledger.mjs";
import { SYNTHETIC_REPLAY_SIGNING_SECRET, verifyCertificate } from "../lib/risk.mjs";
import { validateOptionQuote } from "../lib/schema.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const decisionTime = fixture.decision_time;
const paperSigningSecret = "security-acceptance-paper-signing-secret-0123456789";
const wrongSigningSecret = "security-acceptance-wrong-signing-secret-0123456789";
const mcpMetadata = Object.freeze({
  server: "alpaca-mcp-server",
  version: POLICY.alpacaMcpVersion,
  tool: "place_option_order",
  schema_sha256: POLICY.placeOptionOrderSchemaSha256,
});

async function paperDecision(overrides = {}) {
  const liveFixture = structuredClone(fixture);
  liveFixture.data_mode = "alpaca_paper_live";
  Object.assign(liveFixture, overrides.fixture ?? {});
  return runDecision({
    fixture: liveFixture,
    planner: new DeterministicReplayPlanner(),
    now: overrides.now ?? liveFixture.decision_time,
    signingSecret: overrides.signingSecret ?? paperSigningSecret,
    certificateScope: "paper_submit",
  });
}

function freshPreflight(candidate, now = decisionTime) {
  return {
    trading_base_url: POLICY.paperHost,
    data_base_url: "https://data.alpaca.markets",
    observed_at: now,
    account: {
      status: "ACTIVE",
      trading_blocked: false,
      account_blocked: false,
      competition_account_match: true,
      equity: 100000,
      options_buying_power: 100000,
      options_trading_level: POLICY.minimumOptionsLevel,
    },
    clock: { is_open: true, timestamp: now },
    underlying_quote: { symbol: candidate.underlying, bid: 559.99, ask: 560.01, observed_at: now, feed: "iex" },
    positions: [],
    open_orders: [],
    open_defined_risk: 0,
    contracts: [candidate.long_leg, candidate.short_leg].map((leg) => ({
      symbol: leg.symbol,
      status: "active",
      tradable: true,
      multiplier: 100,
      adjusted: false,
      deliverable: "standard",
    })),
    quotes: [candidate.long_leg, candidate.short_leg].map((leg) => ({
      symbol: leg.symbol,
      feed: leg.feed,
      bid: leg.bid,
      ask: leg.ask,
      observed_at: now,
    })),
  };
}

async function executorHarness({
  candidate,
  certificate,
  signingSecret = paperSigningSecret,
  now = decisionTime,
  preflight = freshPreflight(candidate, now),
  issueCertificate = true,
  nowFactory,
  reconciledStatus = "accepted",
} = {}) {
  const ledger = new MemoryPermitLedger();
  if (issueCertificate) await ledger.issue(certificate);
  const counters = { preflight: 0, mutation: 0, reconciliation: 0 };
  let submittedArguments;
  const executor = new GuardedPaperExecutor({
    baseUrl: POLICY.paperHost,
    transport: "mcp",
    enabled: true,
    signingSecret,
    permitLedger: ledger,
    now: nowFactory ?? (() => new Date(now)),
    mcpMetadata,
    preflight: async () => {
      counters.preflight += 1;
      return structuredClone(preflight);
    },
    placeOptionOrder: async (toolArguments) => {
      counters.mutation += 1;
      submittedArguments = structuredClone(toolArguments);
      return { id: "paper-order-security-test", status: "accepted" };
    },
    getOrderByClientOrderId: async () => {
      counters.reconciliation += 1;
      return { ...submittedArguments, id: "paper-order-security-test", status: reconciledStatus };
    },
  });
  return { executor, counters, ledger };
}

async function assertRejectedBeforeMutation({
  candidate,
  certificate,
  signingSecret,
  now,
  nowFactory,
  preflight,
  issueCertificate,
  pattern,
}) {
  const harness = await executorHarness({ candidate, certificate, signingSecret, now, nowFactory, preflight, issueCertificate });
  await assert.rejects(() => harness.executor.submit(candidate, certificate), pattern);
  assert.equal(harness.counters.mutation, 0, "rejected input reached the Alpaca mutation callback");
  assert.equal(harness.counters.reconciliation, 0, "rejected input reached broker reconciliation");
  return harness.counters;
}

test("self-hashed certificate forgery and the wrong HMAC key are rejected before mutation", async (t) => {
  const receipt = await paperDecision();
  const candidate = receipt.compilation.selected;

  await t.test("attacker can recompute the public hash but cannot forge the HMAC", async () => {
    const forgedBody = { ...receipt.certificate, quantity: Math.min(POLICY.maxContracts, receipt.certificate.quantity + 1) };
    delete forgedBody.certificate_id;
    delete forgedBody.signature;
    const forged = {
      ...forgedBody,
      certificate_id: sha256(forgedBody),
      signature: `hmac-sha256:${"0".repeat(64)}`,
    };
    await assertRejectedBeforeMutation({ candidate, certificate: forged, pattern: /signature mismatch/ });
  });

  await t.test("a valid certificate checked with the wrong key fails", async () => {
    await assertRejectedBeforeMutation({
      candidate,
      certificate: receipt.certificate,
      signingSecret: wrongSigningSecret,
      pattern: /signature mismatch/,
    });
  });
});

test("scope and data-mode boundaries reject synthetic replay permits before mutation", async (t) => {
  const replayReceipt = await runDecision({ fixture, planner: new DeterministicReplayPlanner() });
  const candidate = replayReceipt.compilation.selected;

  await t.test("the executor rejects a correctly signed synthetic permit", async () => {
    await assertRejectedBeforeMutation({
      candidate,
      certificate: replayReceipt.certificate,
      signingSecret: SYNTHETIC_REPLAY_SIGNING_SECRET,
      pattern: /scope is not authorized/,
    });
  });

  await t.test("the pipeline cannot mint paper-submit scope from synthetic data", async () => {
    await assert.rejects(
      () => runDecision({
        fixture,
        planner: new DeterministicReplayPlanner(),
        signingSecret: paperSigningSecret,
        certificateScope: "paper_submit",
      }),
      /synthetic replay cannot mint a paper-submit certificate/,
    );
  });
});

test("expired and not-yet-valid certificates are rejected before preflight or mutation", async (t) => {
  const receipt = await paperDecision();
  const candidate = receipt.compilation.selected;

  for (const scenario of [
    { name: "expired", now: new Date(Date.parse(receipt.certificate.expires_at) + 1).toISOString() },
    { name: "not yet valid", now: new Date(Date.parse(receipt.certificate.created_at) - 1).toISOString() },
  ]) {
    await t.test(scenario.name, async () => {
      const counters = await assertRejectedBeforeMutation({
        candidate,
        certificate: receipt.certificate,
        now: scenario.now,
        pattern: /expired or not yet valid/,
      });
      assert.equal(counters.preflight, 0, "invalid certificate reached fresh broker preflight");
    });
  }
});

test("a correctly signed but unissued certificate is rejected before preflight or mutation", async () => {
  const receipt = await paperDecision();
  const counters = await assertRejectedBeforeMutation({
    candidate: receipt.compilation.selected,
    certificate: receipt.certificate,
    issueCertificate: false,
    pattern: /not an exact trusted-ledger member/,
  });
  assert.equal(counters.preflight, 0);
});

test("candidate content mutation is rejected even when candidate_id is retained", async (t) => {
  const receipt = await paperDecision();
  const original = receipt.compilation.selected;
  const attacks = [
    {
      name: "entry debit",
      mutate: (candidate) => { candidate.entry_debit += 0.01; },
      pattern: /candidate integrity mismatch/,
    },
    {
      name: "long-leg OCC symbol",
      mutate: (candidate) => { candidate.long_leg.symbol = "SPY260904P00561000"; },
      pattern: /candidate integrity mismatch/,
    },
    {
      name: "maximum loss",
      mutate: (candidate) => { candidate.max_loss += 1; },
      pattern: /candidate integrity mismatch/,
    },
    {
      name: "post-enumeration model result outside candidate_id fields",
      mutate: (candidate) => { candidate.conservative_ev += 1; },
      pattern: /candidate snapshot does not match/,
    },
  ];

  for (const attack of attacks) {
    await t.test(attack.name, async () => {
      const mutated = structuredClone(original);
      attack.mutate(mutated);
      assert.equal(mutated.candidate_id, original.candidate_id, "attack must retain the certified candidate_id");
      const counters = await assertRejectedBeforeMutation({
        candidate: mutated,
        certificate: receipt.certificate,
        pattern: attack.pattern,
      });
      assert.equal(counters.preflight, 0, "candidate mutation reached fresh broker preflight");
    });
  }
});

test("OCC/OSI symbol semantics must match claimed quote metadata", async (t) => {
  const base = structuredClone(fixture.option_chain.find((quote) => quote.symbol === "SPY260911P00560000"));
  const mismatches = [
    { name: "underlying", symbol: "AAPL260911P00560000", pattern: /underlying differs/ },
    { name: "right", symbol: "SPY260911C00560000", pattern: /type differs/ },
    { name: "expiry", symbol: "SPY260912P00560000", pattern: /expiry differs/ },
    { name: "strike", symbol: "SPY260911P00561000", pattern: /strike differs/ },
    { name: "invalid calendar date", symbol: "SPY260231P00560000", pattern: /invalid expiry/ },
  ];

  for (const mismatch of mismatches) {
    await t.test(mismatch.name, () => {
      assert.throws(() => validateOptionQuote({ ...base, symbol: mismatch.symbol }), mismatch.pattern);
    });
  }
});

test("all declared fresh-preflight failures stop before the Alpaca mutation callback", async (t) => {
  const receipt = await paperDecision();
  const candidate = receipt.compilation.selected;
  const staleTime = new Date(Date.parse(decisionTime) - (POLICY.preflightMaxAgeSeconds + 1) * 1000).toISOString();
  const attacks = [
    {
      name: "inactive account",
      mutate: (value) => { value.account.status = "INACTIVE"; },
      pattern: /account is not active and unblocked/,
    },
    {
      name: "trading-blocked account",
      mutate: (value) => { value.account.trading_blocked = true; },
      pattern: /account is not active and unblocked/,
    },
    {
      name: "different Alpaca paper account",
      mutate: (value) => { value.account.competition_account_match = false; },
      pattern: /dedicated competition account/,
    },
    {
      name: "insufficient options level",
      mutate: (value) => { value.account.options_trading_level = POLICY.minimumOptionsLevel - 1; },
      pattern: /options trading level is below policy/,
    },
    {
      name: "missing options level",
      mutate: (value) => { delete value.account.options_trading_level; },
      pattern: /options trading level is below policy/,
    },
    {
      name: "insufficient options buying power",
      mutate: (value) => { value.account.options_buying_power = receipt.certificate.reserved_max_loss - 0.01; },
      pattern: /options buying power is insufficient/,
    },
    {
      name: "closed broker clock",
      mutate: (value) => { value.clock.is_open = false; },
      pattern: /closed market/,
    },
    {
      name: "stale underlying quote",
      mutate: (value) => { value.underlying_quote.observed_at = staleTime; },
      pattern: /underlying quote snapshot is stale/,
    },
    {
      name: "unidentified underlying feed",
      mutate: (value) => { value.underlying_quote.feed = "mystery"; },
      pattern: /underlying quote feed is not allowlisted/,
    },
    {
      name: "implausibly wide underlying quote",
      mutate: (value) => { value.underlying_quote.bid = 1; value.underlying_quote.ask = 1119; },
      pattern: /underlying quote is too wide/,
    },
    {
      name: "underlying moved outside certified collar",
      mutate: (value) => {
        const movedSpot = receipt.certificate.market_spot * (1 + POLICY.maxUnderlyingDriftFraction + 0.001);
        value.underlying_quote.bid = movedSpot - 0.01;
        value.underlying_quote.ask = movedSpot + 0.01;
      },
      pattern: /underlying price moved beyond the certified collar/,
    },
    {
      name: "stale preflight snapshot",
      mutate: (value) => { value.observed_at = staleTime; },
      pattern: /preflight snapshot is stale/,
    },
    {
      name: "existing position",
      mutate: (value) => { value.positions = [{ symbol: "SPY" }]; },
      pattern: /rejects existing positions or open orders/,
    },
    {
      name: "existing open order",
      mutate: (value) => { value.open_orders = [{ id: "working-order" }]; },
      pattern: /rejects existing positions or open orders/,
    },
    {
      name: "nonstandard contract",
      mutate: (value) => { value.contracts[0].multiplier = 10; },
      pattern: /standard multiplier 100/,
    },
    {
      name: "stale leg quote",
      mutate: (value) => { value.quotes[0].observed_at = staleTime; },
      pattern: /quote .* snapshot is stale/,
    },
    {
      name: "natural debit beyond certificate collar",
      mutate: (value) => {
        const shortBid = value.quotes.find((quote) => quote.symbol === candidate.short_leg.symbol).bid;
        const longQuote = value.quotes.find((quote) => quote.symbol === candidate.long_leg.symbol);
        longQuote.ask = shortBid + receipt.certificate.max_entry_debit + 0.01;
        longQuote.bid = longQuote.ask - 0.10;
      },
      pattern: /natural debit exceeds the certified price collar/,
    },
    {
      name: "aggregate risk breach",
      mutate: (value) => { value.open_defined_risk = value.account.equity * POLICY.aggregateRiskFraction; },
      pattern: /fresh aggregate risk exceeds policy/,
    },
    {
      name: "lookalike data origin",
      mutate: (value) => { value.data_base_url = "https://data.alpaca.markets.evil.test"; },
      pattern: /data origin is not allowlisted/,
    },
  ];

  for (const attack of attacks) {
    await t.test(attack.name, async () => {
      const preflight = freshPreflight(candidate);
      attack.mutate(preflight);
      const counters = await assertRejectedBeforeMutation({
        candidate,
        certificate: receipt.certificate,
        preflight,
        pattern: attack.pattern,
      });
      assert.equal(counters.preflight, 1, "executor did not run exactly one fresh preflight");
    });
  }
});

test("executor validates broker snapshots at completion time and rechecks certificate freshness", async (t) => {
  const receipt = await paperDecision();
  const candidate = receipt.compilation.selected;

  await t.test("a one-second response is not rejected as future-dated", async () => {
    const completedAt = new Date(Date.parse(decisionTime) + 1000).toISOString();
    const times = [decisionTime, completedAt];
    const harness = await executorHarness({
      candidate,
      certificate: receipt.certificate,
      preflight: freshPreflight(candidate, completedAt),
      nowFactory: () => new Date(times.shift() ?? completedAt),
    });
    await harness.executor.submit(candidate, receipt.certificate);
    assert.deepEqual(harness.counters, { preflight: 1, mutation: 1, reconciliation: 1 });
  });

  await t.test("a response completing after permit expiry cannot mutate", async () => {
    const completedAt = new Date(Date.parse(receipt.certificate.expires_at) + 1).toISOString();
    const times = [decisionTime, completedAt];
    const counters = await assertRejectedBeforeMutation({
      candidate,
      certificate: receipt.certificate,
      preflight: freshPreflight(candidate, completedAt),
      nowFactory: () => new Date(times.shift() ?? completedAt),
      pattern: /expired or not yet valid/,
    });
    assert.equal(counters.preflight, 1);
  });
});

test("fresh preflight re-applies the per-trade risk budget to current equity", async () => {
  const receipt = await paperDecision();
  const candidate = receipt.compilation.selected;
  const preflight = freshPreflight(candidate);
  preflight.account.equity = 20000;
  preflight.account.options_buying_power = 20000;
  const currentTradeBudget = Math.min(preflight.account.equity * POLICY.riskPerTradeFraction, POLICY.riskPerTradeDollarCap);
  assert.ok(receipt.certificate.reserved_max_loss > currentTradeBudget, "fixture must exceed the fresh per-trade budget");
  const counters = await assertRejectedBeforeMutation({
    candidate,
    certificate: receipt.certificate,
    preflight,
    pattern: /fresh per-trade risk exceeds policy/,
  });
  assert.equal(counters.preflight, 1);
});

test("fresh preflight enforces the post-debit 25% equity buying-power floor", async () => {
  const receipt = await paperDecision();
  const candidate = receipt.compilation.selected;
  const preflight = freshPreflight(candidate);
  preflight.account.options_buying_power = 1000;
  assert.ok(preflight.account.options_buying_power >= receipt.certificate.reserved_max_loss);
  assert.ok(preflight.account.options_buying_power - receipt.certificate.reserved_max_loss < 0.25 * preflight.account.equity);
  const counters = await assertRejectedBeforeMutation({
    candidate,
    certificate: receipt.certificate,
    preflight,
    pattern: /post-trade buying power is below policy floor/,
  });
  assert.equal(counters.preflight, 1);
});

test("a valid preflight reaches MCP once, strips local hash metadata, and reconciles exactly", async () => {
  const receipt = await paperDecision();
  const candidate = receipt.compilation.selected;
  const harness = await executorHarness({ candidate, certificate: receipt.certificate });
  const orderReceipt = await harness.executor.submit(candidate, receipt.certificate);
  assert.deepEqual(harness.counters, { preflight: 1, mutation: 1, reconciliation: 1 });
  assert.equal(orderReceipt.schema_version, "order_receipt.v3");
  assert.equal(orderReceipt.accepted_order.status, "accepted");
  assert.equal(orderReceipt.accepted_order.order_shape.order_class, "mleg");
  assert.equal(orderReceipt.accepted_order.privacy.broker_order_identifiers_retained, false);
  assert.equal(JSON.stringify(orderReceipt).includes("paper-order-security-test"), false);
  assert.equal(orderReceipt.transport, "mcp");
});

test("a structurally matching but rejected broker order freezes the permit", async () => {
  const receipt = await paperDecision();
  const candidate = receipt.compilation.selected;
  const harness = await executorHarness({
    candidate,
    certificate: receipt.certificate,
    reconciledStatus: "rejected",
  });
  await assert.rejects(
    () => harness.executor.submit(candidate, receipt.certificate),
    /frozen pending reconciliation: broker order is not in an accepted working or filled status/,
  );
  assert.deepEqual(harness.counters, { preflight: 1, mutation: 1, reconciliation: 1 });
  await assert.rejects(
    () => harness.executor.submit(candidate, receipt.certificate),
    /already reserved|consumed/,
  );
});

test("signed certificate and receipt hashes remain valid after public-field redaction", async () => {
  const receipt = await paperDecision();
  assert.equal(receipt.certificate.authorization_scope, "paper_submit");
  assert.match(receipt.certificate.signer_key_id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(verifyCertificate(receipt.certificate, {
    signingSecret: paperSigningSecret,
    requiredScope: "paper_submit",
    now: decisionTime,
  }), true);
  const { receipt_id: receiptId, ...body } = receipt;
  assert.equal(sha256(body), receiptId);
});
