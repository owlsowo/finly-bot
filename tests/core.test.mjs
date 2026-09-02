import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildMlegPayload, GuardedPaperExecutor, assertPaperHost } from "../lib/alpaca.mjs";
import { DeterministicReplayPlanner, LocalLlamaPlanner } from "../lib/agent.mjs";
import { AlpacaPaperRestClient } from "../lib/alpaca_rest.mjs";
import { sha256, stableStringify } from "../lib/canonical.mjs";
import { enumerateVerticals, verticalPayoff } from "../lib/compiler.mjs";
import { runDecision } from "../lib/pipeline.mjs";
import { POLICY } from "../lib/policy.mjs";
import { MemoryPermitLedger } from "../lib/permit_ledger.mjs";
import { SYNTHETIC_REPLAY_SIGNING_SECRET, verifyCertificate } from "../lib/risk.mjs";
import { validateIntent } from "../lib/schema.mjs";
import { aggregateSignals } from "../lib/signals.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/spy_bearish_replay.json", import.meta.url), "utf8"));
const paperSigningSecret = "test-only-paper-certificate-secret-with-32-bytes";

async function paperDecision() {
  return runDecision({
    fixture: { ...fixture, data_mode: "alpaca_paper_live" },
    planner: new DeterministicReplayPlanner(),
    signingSecret: paperSigningSecret,
    certificateScope: "paper_submit",
  });
}

function freshPreflight(candidate, now = fixture.decision_time) {
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
      options_trading_level: 3,
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

test("canonical JSON and hashes are stable across key order", () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
});

test("aggregate intent is bearish, covered, and provenance-bound", () => {
  const intent = aggregateSignals(fixture.signals, { horizonSessions: 5 });
  assert.equal(intent.direction, "bearish");
  assert.ok(intent.direction_score < -POLICY.directionThreshold);
  assert.ok(intent.coverage >= POLICY.minCoverage);
  assert.match(intent.evidence_root, /^sha256:[a-f0-9]{64}$/);
});

test("planner rejects raw broker fields", async () => {
  const planner = new LocalLlamaPlanner({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          ...aggregateSignals(fixture.signals),
          quantity: 100,
        }) } }],
      }),
    }),
  });
  await assert.rejects(() => planner.proposeIntent(fixture.signals), /missing or unknown fields/);
});

test("planner rejects changes to every deterministic intent field", async () => {
  const computed = aggregateSignals(fixture.signals);
  for (const altered of [
    { ...computed, active_weight: 0 },
    { ...computed, source_families: computed.source_families.slice(1) },
  ]) {
    const planner = new LocalLlamaPlanner({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(altered) } }] }),
      }),
    });
    await assert.rejects(() => planner.proposeIntent(fixture.signals), /planner changed deterministic field/);
  }
  assert.throws(() => validateIntent({ ...computed, active_weight: 999 }), /active_weight/);
  assert.throws(() => validateIntent({ ...computed, source_families: [] }), /source families/);
  assert.throws(
    () => validateIntent({ ...computed, source_families: [computed.source_families[0], computed.source_families[0]] }),
    /source families/,
  );
});

test("local planner is loopback-only, time-bounded, and refuses redirects", async () => {
  assert.throws(
    () => new LocalLlamaPlanner({ baseUrl: "https://example.com/v1" }),
    /only loopback HTTP endpoints/,
  );
  assert.throws(
    () => new LocalLlamaPlanner({ timeoutMs: 99 }),
    /timeout must be an integer/,
  );
  let observed;
  const planner = new LocalLlamaPlanner({
    timeoutMs: 500,
    fetchImpl: async (_url, options) => {
      observed = options;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(aggregateSignals(fixture.signals)) } }],
        }),
      };
    },
  });
  await planner.proposeIntent(fixture.signals);
  assert.equal(observed.redirect, "error");
  assert.ok(observed.signal instanceof AbortSignal);
  const body = JSON.parse(observed.body);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
});

test("paper endpoint allowlist rejects live and lookalike hosts", () => {
  assert.equal(assertPaperHost(POLICY.paperHost), POLICY.paperHost);
  assert.throws(() => assertPaperHost("https://api.alpaca.markets"), /refusing non-paper/);
  assert.throws(() => assertPaperHost("https://paper-api.alpaca.markets.evil.test"), /refusing non-paper/);
  assert.throws(() => assertPaperHost("http://paper-api.alpaca.markets"), /refusing non-paper/);
});

test("read client permits only exact Alpaca paper/data origins and GET", async () => {
  const calls = [];
  const client = new AlpacaPaperRestClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-key",
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), method: options.method, key: options.headers["APCA-API-KEY-ID"] });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  await client.getAccount();
  await client.getOptionChain("SPY");
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
  assert.equal(new URL(calls[0].url).origin, POLICY.paperHost);
  assert.equal(new URL(calls[1].url).origin, "https://data.alpaca.markets");
  assert.equal(calls[1].key, "paper-key-id");
  assert.throws(() => new AlpacaPaperRestClient({ keyId: "paper-key-id", secretKey: "paper-secret-key", dataBase: "https://data.alpaca.markets.evil.test" }), /not allowlisted/);
});

test("paper client cancel is an exact single-order DELETE and requires Alpaca's 204 acknowledgement", async () => {
  const calls = [];
  const client = new AlpacaPaperRestClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-key",
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), method: options.method, redirect: options.redirect });
      return { status: 204, ok: true };
    },
  });
  await client.cancelOrder("exit-order-00000001");
  assert.deepEqual(calls, [{
    url: "https://paper-api.alpaca.markets/v2/orders/exit-order-00000001",
    method: "DELETE",
    redirect: "error",
  }]);
  await assert.rejects(() => client.cancelOrder("../orders"), /invalid Alpaca order ID/);
});

test("read client rejects symbols and feeds outside policy", async () => {
  const client = new AlpacaPaperRestClient({
    keyId: "paper-key-id",
    secretKey: "paper-secret-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  await assert.rejects(() => client.getOptionChain("TSLA"), /outside Finly's allowlist/);
  await assert.rejects(() => client.getOptionChain("SPY", { feed: "mystery" }), /unsupported option feed/);
});

test("vertical payoff oracle matches bounded-risk endpoints", () => {
  const spread = { action: "BEAR_PUT_DEBIT_SPREAD", longStrike: 560, shortStrike: 550, debit: 3.66 };
  assert.equal(verticalPayoff({ ...spread, terminalPrice: 600 }), -366);
  assert.equal(verticalPayoff({ ...spread, terminalPrice: 540 }), 634);
  assert.equal(verticalPayoff({ ...spread, terminalPrice: 556.34 }), 0);
});

test("compiler rejects stale or unidentified quotes before enumeration", () => {
  const intent = aggregateSignals(fixture.signals);
  const badChain = fixture.option_chain.map((item, index) => index === 0 ? { ...item, feed: "mystery" } : item);
  const result = enumerateVerticals(intent, badChain);
  assert.ok(result.rejected.some((item) => item.code === "QUOTE_REJECTED" && /unidentified/.test(item.detail)));
});

test("replay produces a certified, stable, defined-risk MCP payload", async () => {
  const receipt = await runDecision({ fixture, planner: new DeterministicReplayPlanner() });
  assert.equal(receipt.certificate.certified, true, receipt.certificate.rejection_codes.join(", "));
  assert.equal(receipt.source_removal.passed, true);
  assert.ok(receipt.source_removal.variants.every((variant) => variant.action_stable));
  assert.equal(receipt.perturbations.passed, true);
  const sortedPerturbationEv = receipt.perturbations.rows
    .map((row) => row.conservative_ev)
    .sort((left, right) => left - right);
  const nearestRankP5Index = Math.ceil(sortedPerturbationEv.length * 0.05) - 1;
  assert.equal(
    receipt.perturbations.fifth_percentile_conservative_ev,
    sortedPerturbationEv[nearestRankP5Index],
  );
  assert.equal(receipt.certificate.decision, "BEAR_PUT_DEBIT_SPREAD");
  assert.equal(receipt.alpaca_payload.order_class, "mleg");
  assert.equal(receipt.alpaca_payload.type, "limit");
  assert.equal(Object.hasOwn(receipt.alpaca_payload, "extended_hours"), false);
  assert.ok(receipt.compilation.selected.expected_shortfall_95 >= -receipt.compilation.selected.max_loss);
  assert.deepEqual(receipt.alpaca_payload.legs.map((leg) => leg.position_intent), ["buy_to_open", "sell_to_open"]);
});

test("an uncertified proposed trade is recorded as NO_TRADE and has no payload", async () => {
  const unsafeAccountFixture = {
    ...fixture,
    run_id: "unsafe-account-test",
    account: { ...fixture.account, age_seconds: 99 },
  };
  const receipt = await runDecision({ fixture: unsafeAccountFixture, planner: new DeterministicReplayPlanner() });
  assert.equal(receipt.certificate.proposed_decision, "BEAR_PUT_DEBIT_SPREAD");
  assert.equal(receipt.certificate.decision, "NO_TRADE");
  assert.equal(receipt.certificate.certified, false);
  assert.equal(receipt.alpaca_payload, null);
});

test("identical replay inputs produce an identical receipt hash", async () => {
  const first = await runDecision({ fixture, planner: new DeterministicReplayPlanner() });
  const second = await runDecision({ fixture, planner: new DeterministicReplayPlanner() });
  assert.equal(first.receipt_id, second.receipt_id);
  assert.equal(first.certificate.certificate_id, second.certificate.certificate_id);
  assert.equal(first.alpaca_payload.payload_sha256, second.alpaca_payload.payload_sha256);
});

test("conflicting evidence terminates in NO_TRADE with no payload", async () => {
  const conflict = {
    ...fixture,
    run_id: "conflict-test",
    signals: fixture.signals.map((signal) => signal.family === "market"
      ? { ...signal, direction_score: 0.75 }
      : { ...signal, direction_score: -0.75 }),
  };
  const receipt = await runDecision({ fixture: conflict, planner: new DeterministicReplayPlanner() });
  assert.equal(receipt.certificate.certified, false);
  assert.equal(receipt.certificate.decision, "NO_TRADE");
  assert.equal(receipt.alpaca_payload, null);
});

test("certificate tampering and replayed nonces are rejected", async () => {
  const replayReceipt = await runDecision({ fixture, planner: new DeterministicReplayPlanner() });
  assert.equal(verifyCertificate(replayReceipt.certificate, {
    signingSecret: SYNTHETIC_REPLAY_SIGNING_SECRET,
    requiredScope: "synthetic_replay",
    now: fixture.decision_time,
  }), true);
  assert.throws(() => verifyCertificate({ ...replayReceipt.certificate, quantity: 99 }, {
    signingSecret: SYNTHETIC_REPLAY_SIGNING_SECRET,
    requiredScope: "synthetic_replay",
    now: fixture.decision_time,
  }), /hash mismatch/);
  const receipt = await paperDecision();
  const calls = [];
  const ledger = new MemoryPermitLedger();
  await ledger.issue(receipt.certificate);
  let submitted;
  const mutationSequence = [];
  const executor = new GuardedPaperExecutor({
    baseUrl: POLICY.paperHost,
    transport: "mcp",
    enabled: true,
    signingSecret: paperSigningSecret,
    permitLedger: ledger,
    now: () => new Date(fixture.decision_time),
    mcpMetadata: { server: "alpaca-mcp-server", version: POLICY.alpacaMcpVersion, tool: "place_option_order", schema_sha256: POLICY.placeOptionOrderSchemaSha256 },
    preflight: async () => freshPreflight(receipt.compilation.selected),
    beforeMutation: async () => { mutationSequence.push("durable-checkpoint"); },
    placeOptionOrder: async (payload) => {
      mutationSequence.push("broker-mutation");
      submitted = payload;
      calls.push(payload);
      return { id: "paper-order-1", status: "accepted" };
    },
    getOrderByClientOrderId: async () => ({ ...submitted, id: "paper-order-1", status: "accepted" }),
  });
  await executor.submit(receipt.compilation.selected, receipt.certificate);
  await assert.rejects(() => executor.submit(receipt.compilation.selected, receipt.certificate), /already reserved|consumed/);
  assert.equal(calls.length, 1);
  assert.deepEqual(mutationSequence, ["durable-checkpoint", "broker-mutation"]);
  assert.equal(Object.hasOwn(calls[0], "payload_sha256"), false);
});

test("execution is disabled by default even with a valid permit", async () => {
  const receipt = await paperDecision();
  const executor = new GuardedPaperExecutor({ signingSecret: paperSigningSecret, now: () => new Date(fixture.decision_time) });
  await assert.rejects(() => executor.submit(receipt.compilation.selected, receipt.certificate), /execution is disabled/);
});

test("payload is bound to the selected candidate", async () => {
  const receipt = await runDecision({ fixture, planner: new DeterministicReplayPlanner() });
  const changed = {
    ...receipt.compilation.selected,
    entry_debit: 99.99,
    long_leg: { ...receipt.compilation.selected.long_leg, symbol: "SPY260911P00001000" },
  };
  assert.throws(() => buildMlegPayload(changed, receipt.certificate, {
    signingSecret: SYNTHETIC_REPLAY_SIGNING_SECRET,
    requiredScope: "synthetic_replay",
    now: fixture.decision_time,
  }), /integrity mismatch/);
});
