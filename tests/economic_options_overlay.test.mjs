import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import replay from "../fixtures/spy_bearish_replay.json" with { type: "json" };
import { sha256 } from "../lib/canonical.mjs";
import {
  applyEconomicRiskCommitteeVeto,
  buildCurrentEconomicDecision,
  buildEconomicOptionsDirectionAuthority,
} from "../lib/economic_research.mjs";
import { POLICY } from "../lib/policy.mjs";
import { aggregateSignals } from "../lib/signals.mjs";
import { runAutonomousPaperCycle } from "../scripts/autonomous_paper_agent.mjs";

const AS_OF = replay.decision_time;
const SIGNING_SECRET = "economic-overlay-test-signing-secret-at-least-32-bytes";

function marketBars(cash = false) {
  let close = cash ? 90 : 100;
  return Array.from({ length: 300 }, (_, index) => {
    close *= cash ? 1.0001 : 1.0008 + 0.002 * Math.sin(index * 0.7);
    return { t: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(), c: close };
  });
}

function economicBundle({ disposition = "SCALE", multiplier = 1 } = {}) {
  const deterministicDecision = buildCurrentEconomicDecision({
    spyBars: marketBars(false),
    cashBars: marketBars(true),
    decisionTimestamp: AS_OF,
    sourceAvailableAt: new Date(new Date(AS_OF).getTime() - 3_600_000).toISOString(),
    completedSessionBoundary: {
      sessionDate: "2025-10-27",
      marketCloseAt: "2025-10-27T20:00:00.000Z",
      eligibleAt: "2025-10-27T20:15:00.000Z",
      availabilityDelayMinutes: 15,
    },
    currentAllocation: { spyWeight: 0, bilWeight: 1 },
    lastRebalanceDate: null,
  });
  const riskCommitteeDecision = applyEconomicRiskCommitteeVeto(deterministicDecision, {
    assessedAt: AS_OF,
    disposition,
    spyExposureMultiplier: multiplier,
    reasonCodes: disposition === "VETO" ? ["MODEL_EVENT_RISK"] : ["NO_AGENT_RISK_REDUCTION"],
  });
  const body = {
    schema_version: "finly_current_economic_bundle.v1",
    generated_at: AS_OF,
    data: { read_only: true },
    paper_account_boundary: { authenticated_read_succeeded: true },
    deterministic_decision: deterministicDecision,
    risk_committee_decision: riskCommitteeDecision,
    mutation_requested: false,
  };
  return { ...body, artifact_sha256: sha256(body) };
}

function optionQuote(type, strike, bid, ask, iv) {
  return {
    underlying: "SPY",
    symbol: `SPY260911${type === "call" ? "C" : "P"}${String(strike * 1_000).padStart(8, "0")}`,
    type,
    expiry: "2026-09-11",
    strike,
    bid,
    ask,
    iv,
    dte: 14,
    feed: "indicative",
    quote_age_seconds: 1.8,
    open_interest: 9_000,
    tradable: true,
  };
}

function supportiveInputs() {
  return {
    snapshot: {
      market: {
        ...structuredClone(replay.market),
        observed_at: new Date(new Date(AS_OF).getTime() - 3_000).toISOString(),
        quote_age_seconds: 3,
        history_mode: "alpaca_iex_adjusted_daily_bars",
        historical_log_returns: Array.from(
          { length: 96 },
          (_, index) => 0.0025 + 0.0008 * Math.sin(index * 0.6),
        ),
      },
      option_chain: [
        optionQuote("call", 555, 7.7, 8.0, 0.230),
        optionQuote("call", 560, 4.6, 4.9, 0.225),
        optionQuote("call", 565, 2.0, 2.2, 0.220),
        optionQuote("call", 570, 1.2, 1.4, 0.215),
        optionQuote("put", 560, 3.0, 3.2, 0.180),
      ],
    },
    newsResponse: { news: [] },
    account: {
      status: "ACTIVE",
      equity: "100000",
      trading_blocked: false,
      account_blocked: false,
      trade_suspended_by_user: false,
    },
    positions: [],
    openOrders: [],
    clock: { is_open: true, timestamp: AS_OF },
    decisionTime: AS_OF,
  };
}

test("checked economic authority can permit only bullish direction and never broker mutation", () => {
  const allowed = buildEconomicOptionsDirectionAuthority(economicBundle(), { asOf: AS_OF });
  assert.equal(allowed.direction, "bullish");
  assert.equal(allowed.decision, "ALLOW_BULLISH_DIRECTION_ONLY");
  assert.ok(allowed.maximum_direction_score >= POLICY.directionThreshold);
  assert.equal(allowed.reduction_only, true);
  assert.equal(allowed.broker_mutation_authorized, false);
  const { authority_sha256: ignored, ...body } = allowed;
  void ignored;
  assert.equal(allowed.authority_sha256, sha256(body));

  const vetoed = buildEconomicOptionsDirectionAuthority(
    economicBundle({ disposition: "VETO", multiplier: 0 }),
    { asOf: AS_OF },
  );
  assert.equal(vetoed.direction, "neutral");
  assert.equal(vetoed.maximum_direction_score, 0);
  assert.equal(vetoed.decision, "NO_TRADE");
});

test("economic core owns the sign while model event evidence is monotonically reduction-only", () => {
  const authority = buildEconomicOptionsDirectionAuthority(economicBundle(), { asOf: AS_OF });
  const deterministic = replay.signals
    .filter((signal) => signal.family === "market" || signal.family === "options")
    .map((signal) => ({ ...signal, direction_score: Math.abs(signal.direction_score) }));
  const withoutModel = aggregateSignals(deterministic, { economicDirectionAuthority: authority });
  const positiveModel = aggregateSignals([
    ...deterministic,
    { ...replay.signals.find((signal) => signal.family === "events"), direction_score: 0.9, volatility_score: -1 },
  ], { economicDirectionAuthority: authority });
  const adverseModel = aggregateSignals([
    ...deterministic,
    { ...replay.signals.find((signal) => signal.family === "events"), direction_score: -0.9, volatility_score: 1 },
  ], { economicDirectionAuthority: authority });

  assert.equal(withoutModel.direction, "bullish");
  assert.equal(positiveModel.direction_score, withoutModel.direction_score, "positive model text cannot amplify direction");
  assert.equal(positiveModel.volatility_score, withoutModel.volatility_score, "model text cannot alter scenario volatility");
  assert.ok(adverseModel.direction_score < withoutModel.direction_score);
  assert.ok(adverseModel.agreement < withoutModel.agreement);
  assert.notEqual(adverseModel.direction, "bearish");

  const conflictingDeterministic = replay.signals.filter((signal) => signal.family !== "events");
  const constrained = aggregateSignals(conflictingDeterministic, { economicDirectionAuthority: authority });
  assert.equal(constrained.direction, "neutral", "bearish short-horizon evidence vetoes instead of reversing the long-only core");
  assert.equal(constrained.direction_score, 0);
});

test("tampered authority cannot enter the deterministic compiler", () => {
  const authority = structuredClone(buildEconomicOptionsDirectionAuthority(economicBundle(), { asOf: AS_OF }));
  authority.maximum_direction_score = 0.123456;
  assert.throws(
    () => aggregateSignals(replay.signals, { economicDirectionAuthority: authority }),
    /authority hash is invalid/,
  );
});

test("autonomous cycle can reach an injected executor with one bounded bullish SPY debit vertical", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-economic-overlay-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const submissions = [];
  const executor = {
    submit: async (candidate, certificate) => {
      submissions.push({ candidate, certificate });
      return { accepted: true, order_id_sha256: sha256("mock-paper-order") };
    },
    positionManager: {
      inspectOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
      manageOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
    },
  };
  const result = await runAutonomousPaperCycle({
    client: {},
    executor,
    economicBundleProvider: async () => economicBundle(),
    environment: {
      FINLY_EXECUTION_ENABLED: "true",
      FINLY_PAPER_SIGNING_SECRET: SIGNING_SECRET,
    },
    inputProvider: async () => supportiveInputs(),
    now: () => new Date(AS_OF),
    signingSecret: SIGNING_SECRET,
    logPath: join(temporary, "decisions.jsonl"),
    lockPath: join(temporary, "agent.lock"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.execution.status, "SUBMITTED_BY_INJECTED_EXECUTOR");
  assert.equal(result.execution.economic_guard.entry_gate_passed, true);
  assert.equal(submissions.length, 1);
  const [{ candidate, certificate }] = submissions;
  assert.equal(candidate.action, "BULL_CALL_DEBIT_SPREAD");
  assert.equal(candidate.underlying, "SPY");
  assert.ok(candidate.max_loss <= POLICY.riskPerTradeDollarCap);
  assert.ok(certificate.reserved_max_loss <= POLICY.riskPerTradeDollarCap);
  assert.equal(certificate.certified, true);
  assert.equal(result.receipt.economic_direction_authority.direction, "bullish");
  assert.equal(result.receipt.intent.direction, "bullish");

  const journal = (await readFile(join(temporary, "decisions.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(journal[0].decision, "NO_TRADE", "the durable journal still begins fail-closed");
});

test("every execution cycle refreshes and validates its economic bundle before reading trade inputs", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-economic-refresh-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let providerCalls = 0;
  let inputCalls = 0;
  const executor = {
    submit: async () => ({ accepted: true }),
    positionManager: {
      inspectOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
      manageOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
    },
  };
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const result = await runAutonomousPaperCycle({
      client: {},
      executor,
      economicBundleProvider: async () => {
        providerCalls += 1;
        return economicBundle();
      },
      environment: {
        FINLY_EXECUTION_ENABLED: "true",
        FINLY_PAPER_SIGNING_SECRET: SIGNING_SECRET,
      },
      inputProvider: async () => {
        inputCalls += 1;
        return supportiveInputs();
      },
      now: () => new Date(AS_OF),
      signingSecret: SIGNING_SECRET,
      logPath: join(temporary, "decisions.jsonl"),
      lockPath: join(temporary, `agent-${cycle}.lock`),
    });
    assert.equal(result.ok, true);
  }
  assert.equal(providerCalls, 2);
  assert.equal(inputCalls, 2);

  const invalid = structuredClone(economicBundle());
  invalid.generated_at = "2020-01-01T00:00:00.000Z";
  const failed = await runAutonomousPaperCycle({
    client: {},
    executor,
    economicBundleProvider: async () => invalid,
    environment: {
      FINLY_EXECUTION_ENABLED: "true",
      FINLY_PAPER_SIGNING_SECRET: SIGNING_SECRET,
    },
    inputProvider: async () => {
      inputCalls += 1;
      return supportiveInputs();
    },
    now: () => new Date(AS_OF),
    signingSecret: SIGNING_SECRET,
    logPath: join(temporary, "invalid-decisions.jsonl"),
    lockPath: join(temporary, "invalid-agent.lock"),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, "FAIL_CLOSED");
  assert.equal(inputCalls, 2, "invalid refreshed economics must fail before live trade inputs are read");
});
