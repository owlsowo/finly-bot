import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import replay from "../fixtures/spy_bearish_replay.json" with { type: "json" };
import { sha256 } from "../lib/canonical.mjs";
import {
  applyEconomicRiskCommitteeVeto,
  buildCurrentEconomicDecision,
} from "../lib/economic_research.mjs";
import {
  buildAlpacaPaperLiveFixture,
  buildEventSignal,
  buildLiveSignals,
  buildMarketSignal,
  buildOptionsSignal,
  normalizeAlpacaNews,
} from "../lib/live_signals.mjs";
import { validateEvidenceRecord, validateSourceSignal } from "../lib/schema.mjs";
import {
  buildAutonomousPaperDecision,
  buildGuardedLocalPaperExecutor,
  eventEvidenceEntryGate,
  runAutonomousPaperCycle,
} from "../scripts/autonomous_paper_agent.mjs";

const AS_OF = "2026-08-28T18:30:05.000Z";
const SIGNING_SECRET = "test-paper-decision-signing-secret-at-least-32-bytes";
const EXECUTION_WINDOW = Object.freeze({
  FINLY_COMPETITION_START_AT: "2026-08-28T18:00:00.000Z",
  FINLY_COMPETITION_END_AT: "2026-08-28T19:00:00.000Z",
  FINLY_OPTIONS_ENTRY_CUTOFF_AT: "2026-08-28T18:40:00.000Z",
  FINLY_OPTIONS_FORCE_FLAT_AT: "2026-08-28T18:50:00.000Z",
});

function liveSnapshot() {
  const returns = Array.from({ length: 96 }, (_, index) => -0.0015 + Math.sin(index * 1.7) * 0.0007);
  return {
    market: {
      ...structuredClone(replay.market),
      observed_at: "2026-08-28T18:30:02.000Z",
      quote_age_seconds: 3,
      history_mode: "alpaca_iex_adjusted_daily_bars",
      feed_disclosure: "Alpaca indicative options feed and IEX stock data.",
      historical_log_returns: returns,
    },
    option_chain: structuredClone(replay.option_chain),
  };
}

function newsResponse() {
  return {
    news: [
      {
        id: 901,
        headline: "Growth outlook weakens before the next policy meeting",
        summary: "A new survey reports softer demand and elevated near-term uncertainty.",
        source: "Example Wire",
        url: "https://example.com/news/901",
        symbols: ["SPY"],
        created_at: "2026-08-28T16:30:00.000Z",
        updated_at: "2026-08-28T16:45:00.000Z",
      },
      {
        id: 902,
        headline: "Growth outlook weakens before the next policy meeting",
        summary: "A new survey reports softer demand and elevated near-term uncertainty.",
        source: "Syndicated Copy",
        url: "http://insecure.example/news/902",
        symbols: ["SPY"],
        created_at: "2026-08-28T16:35:00.000Z",
        updated_at: "2026-08-28T16:45:00.000Z",
      },
      {
        id: 903,
        headline: "Future article must not enter the decision",
        summary: "This item has a timestamp later than the decision cutoff.",
        source: "Example Wire",
        symbols: ["SPY"],
        created_at: "2026-08-28T19:30:00.000Z",
      },
    ],
  };
}

function extractor({ direction = -0.7, volatility = 0.4, fail = false } = {}) {
  return {
    assessDocuments: async (documents) => {
      if (fail) throw new Error("local model unavailable");
      return {
        schema_version: "evidence_assessment.v1",
        assessments: documents.map(({ record }) => ({
          evidence_id: record.evidence_id,
          direction_score: direction,
          volatility_score: volatility,
          rationale: "The timestamped article implies weaker near-term conditions.",
        })),
      };
    },
  };
}

function inputs() {
  return {
    snapshot: liveSnapshot(),
    newsResponse: newsResponse(),
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

function bullishInputs() {
  const quote = (symbol, type, strike, bid, ask, iv) => ({
    underlying: "SPY",
    symbol,
    type,
    expiry: "2026-09-11",
    strike,
    bid,
    ask,
    iv,
    dte: 14,
    feed: "indicative",
    quote_age_seconds: 2,
    open_interest: 500,
    tradable: true,
  });
  return {
    ...inputs(),
    snapshot: {
      market: {
        underlying: "SPY",
        spot: 560,
        observed_at: "2026-08-28T18:30:03.000Z",
        quote_age_seconds: 2,
        option_feed: "indicative",
        feed_disclosure: "Alpaca indicative options feed and IEX stock data.",
        history_mode: "alpaca_iex_adjusted_daily_bars",
        historical_log_returns: Array.from({ length: 96 }, (_, index) => 0.0015 + 0.0005 * Math.sin(index)),
      },
      option_chain: [
        quote("SPY260911C00555000", "call", 555, 5.8, 6.0, 0.255),
        quote("SPY260911C00560000", "call", 560, 4.0, 4.2, 0.25),
        quote("SPY260911C00565000", "call", 565, 2.4, 2.6, 0.245),
        quote("SPY260911C00570000", "call", 570, 1.3, 1.5, 0.24),
        quote("SPY260911P00560000", "put", 560, 2.8, 3.0, 0.18),
        quote("SPY260911P00555000", "put", 555, 1.8, 2.0, 0.175),
      ],
    },
  };
}

function bullishEconomicBundle() {
  const dailyBars = (cash) => {
    let close = cash ? 90 : 100;
    return Array.from({ length: 300 }, (_, index) => {
      close *= cash ? 1.0001 : 1.0008 + 0.002 * Math.sin(index * 0.7);
      return { t: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(), c: close };
    });
  };
  const deterministicDecision = buildCurrentEconomicDecision({
    spyBars: dailyBars(false),
    cashBars: dailyBars(true),
    decisionTimestamp: AS_OF,
    sourceAvailableAt: "2026-08-28T17:30:05.000Z",
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
    disposition: "SCALE",
    spyExposureMultiplier: 1,
    reasonCodes: ["NO_AGENT_RISK_REDUCTION"],
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

test("live market and options scores are deterministic, transparent, and provenance-valid", () => {
  const snapshot = liveSnapshot();
  const firstMarket = buildMarketSignal(snapshot.market, { asOf: AS_OF });
  const secondMarket = buildMarketSignal(snapshot.market, { asOf: AS_OF });
  const firstOptions = buildOptionsSignal(snapshot.market, snapshot.option_chain, { asOf: AS_OF });
  const secondOptions = buildOptionsSignal(snapshot.market, snapshot.option_chain, { asOf: AS_OF });

  assert.deepEqual(firstMarket, secondMarket);
  assert.deepEqual(firstOptions, secondOptions);
  assert.ok(firstMarket.direction_score < 0);
  assert.ok(firstOptions.direction_score < 0);
  assert.match(firstMarket.explanation, /5\/20-session/);
  assert.match(firstOptions.explanation, /put-minus-call IV skew/);
  assert.equal(validateSourceSignal(firstMarket, { asOf: AS_OF }), firstMarket);
  assert.equal(validateSourceSignal(firstOptions, { asOf: AS_OF }), firstOptions);
  assert.equal(firstMarket.evidence[0].source_kind, "alpaca_market");
  assert.equal(firstOptions.evidence[0].source_kind, "alpaca_options");
});

test("Alpaca news is timestamp-bounded, deduplicated, and converted by deterministic event aggregation", async () => {
  const normalized = normalizeAlpacaNews(newsResponse(), { asOf: AS_OF });
  assert.equal(normalized.length, 1, "syndicated duplicate and future article must be omitted");
  assert.equal(validateEvidenceRecord(normalized[0].record, { family: "events", underlying: "SPY", asOf: AS_OF }), normalized[0].record);
  assert.equal(normalized[0].record.source_kind, "news");

  const signal = await buildEventSignal(newsResponse(), { extractor: extractor(), asOf: AS_OF });
  assert.equal(signal.direction_score, -0.455, "the deterministic boundary applies fixed 0.65 shrinkage");
  assert.equal(signal.volatility_score, 0.26);
  assert.equal(signal.evidence.length, 1);
  assert.match(signal.explanation, /deterministic age weighting/);
  assert.equal(validateSourceSignal(signal, { asOf: AS_OF }), signal);
});

test("unavailable evidence families are omitted instead of fabricated", async () => {
  const snapshot = liveSnapshot();
  const withoutModel = await buildLiveSignals({
    market: snapshot.market,
    optionChain: snapshot.option_chain.filter((quote) => quote.type === "put"),
    newsResponse: newsResponse(),
    asOf: AS_OF,
  });
  assert.deepEqual(withoutModel.signals.map((signal) => signal.family), ["market"]);
  assert.deepEqual(withoutModel.omissions.map((row) => row.family), ["options", "events"]);

  const failedModel = await buildLiveSignals({
    market: snapshot.market,
    optionChain: snapshot.option_chain,
    newsResponse: newsResponse(),
    extractor: extractor({ fail: true }),
    asOf: AS_OF,
  });
  assert.deepEqual(failedModel.signals.map((signal) => signal.family), ["market", "options"]);
  assert.equal(failedModel.omissions[0].reason, "EVENT_EXTRACTION_FAILED");
  assert.match(failedModel.omissions[0].detail_sha256, /^sha256:[a-f0-9]{64}$/);
});

test("judged entries fail closed when required model evidence is unavailable or fails", () => {
  const judged = { FINLY_ALLOW_DETERMINISTIC_FALLBACK: "false" };
  const unavailable = eventEvidenceEntryGate([
    { family: "events", reason: "LOCAL_EVENT_EXTRACTOR_UNAVAILABLE" },
  ], judged);
  assert.equal(unavailable.entry_gate_passed, false);
  assert.deepEqual(unavailable.blocking_reason_codes, ["LOCAL_EVENT_EXTRACTOR_UNAVAILABLE"]);

  const failed = eventEvidenceEntryGate([
    { family: "events", reason: "EVENT_EXTRACTION_FAILED" },
  ], judged);
  assert.equal(failed.entry_gate_passed, false);

  const unavailableFeed = eventEvidenceEntryGate([
    { family: "events", reason: "NEWS_FEED_UNAVAILABLE" },
  ], judged);
  assert.equal(unavailableFeed.entry_gate_passed, false);

  const noUsableNews = eventEvidenceEntryGate([
    { family: "events", reason: "NO_USABLE_TIMESTAMPED_NEWS" },
  ], judged);
  assert.equal(noUsableNews.entry_gate_passed, true, "an empty canonical news set is not a model outage");

  const explicitFallback = eventEvidenceEntryGate([
    { family: "events", reason: "LOCAL_EVENT_EXTRACTOR_UNAVAILABLE" },
  ], { FINLY_ALLOW_DETERMINISTIC_FALLBACK: "true" });
  assert.equal(explicitFallback.entry_gate_passed, true);
});

test("a malformed Alpaca news envelope is unavailable evidence, not an empty news set", async () => {
  const current = inputs();
  const malformed = await buildLiveSignals({
    market: current.snapshot.market,
    optionChain: current.snapshot.option_chain,
    newsResponse: {},
    extractor: { assessDocuments: async () => { throw new Error("must not run"); } },
    asOf: current.decisionTime,
  });
  assert.equal(malformed.signals.some((signal) => signal.family === "events"), false);
  assert.deepEqual(malformed.omissions.filter((row) => row.family === "events"), [
    { family: "events", reason: "NEWS_FEED_UNAVAILABLE" },
  ]);

  const validEmpty = await buildLiveSignals({
    market: current.snapshot.market,
    optionChain: current.snapshot.option_chain,
    newsResponse: { news: [], next_page_token: null },
    extractor: { assessDocuments: async () => { throw new Error("must not run"); } },
    asOf: current.decisionTime,
  });
  assert.deepEqual(validEmpty.omissions.filter((row) => row.family === "events"), [
    { family: "events", reason: "NO_USABLE_TIMESTAMPED_NEWS" },
  ]);
});

test("a certified bullish options entry is not submitted when judged model evidence is unavailable", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-required-event-evidence-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let executorCalls = 0;
  const executor = {
    submit: async () => { executorCalls += 1; },
    positionManager: {
      inspectOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
      manageOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
    },
  };
  const result = await runAutonomousPaperCycle({
    client: {},
    executor,
    economicBundleProvider: async () => bullishEconomicBundle(),
    environment: {
      ...EXECUTION_WINDOW,
      FINLY_EXECUTION_ENABLED: "true",
      FINLY_ALLOW_DETERMINISTIC_FALLBACK: "false",
      FINLY_PAPER_SIGNING_SECRET: SIGNING_SECRET,
    },
    inputProvider: async () => bullishInputs(),
    now: () => new Date(AS_OF),
    signingSecret: SIGNING_SECRET,
    logPath: join(temporary, "decisions.jsonl"),
    lockPath: join(temporary, "agent.lock"),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.certificate.certified, true, "the fixture isolates the event-model entry gate");
  assert.equal(result.execution.status, "MODEL_EVIDENCE_NO_TRADE");
  assert.equal(result.execution.event_evidence_gate.entry_gate_passed, false);
  assert.deepEqual(result.execution.event_evidence_gate.blocking_reason_codes, ["LOCAL_EVENT_EXTRACTOR_UNAVAILABLE"]);
  assert.equal(executorCalls, 0);
});

test("a certified bullish options entry is not submitted at the exact official entry cutoff", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-options-entry-cutoff-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let executorCalls = 0;
  const executor = {
    submit: async () => { executorCalls += 1; },
    positionManager: {
      inspectOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
      manageOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
    },
  };
  const result = await runAutonomousPaperCycle({
    client: {},
    executor,
    economicBundleProvider: async () => bullishEconomicBundle(),
    environment: {
      FINLY_EXECUTION_ENABLED: "true",
      FINLY_ALLOW_DETERMINISTIC_FALLBACK: "true",
      FINLY_PAPER_SIGNING_SECRET: SIGNING_SECRET,
      FINLY_COMPETITION_START_AT: "2026-08-28T18:00:00.000Z",
      FINLY_COMPETITION_END_AT: "2026-08-28T19:00:00.000Z",
      FINLY_OPTIONS_ENTRY_CUTOFF_AT: AS_OF,
      FINLY_OPTIONS_FORCE_FLAT_AT: "2026-08-28T18:50:00.000Z",
    },
    inputProvider: async () => bullishInputs(),
    now: () => new Date(AS_OF),
    signingSecret: SIGNING_SECRET,
    logPath: join(temporary, "decisions.jsonl"),
    lockPath: join(temporary, "agent.lock"),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.certificate.certified, true, "the fixture isolates the official entry cutoff");
  assert.equal(result.execution.status, "OPTIONS_ENTRY_CUTOFF_NO_TRADE");
  assert.equal(result.execution.options_competition_controls.entry_gate_passed, false);
  assert.equal(executorCalls, 0);
});

test("live fixture is explicitly alpaca_paper_live and fails safe for account state", async () => {
  const currentInputs = inputs();
  const { signals } = await buildLiveSignals({
    market: currentInputs.snapshot.market,
    optionChain: currentInputs.snapshot.option_chain,
    newsResponse: currentInputs.newsResponse,
    extractor: extractor(),
    asOf: AS_OF,
  });
  const fixture = buildAlpacaPaperLiveFixture({
    snapshot: currentInputs.snapshot,
    signals,
    account: currentInputs.account,
    positions: [{ symbol: "SPY" }],
    openOrders: [],
    clock: currentInputs.clock,
    decisionTime: AS_OF,
  });
  assert.equal(fixture.data_mode, "alpaca_paper_live");
  assert.equal(fixture.account.mode, "paper");
  assert.equal(fixture.account.trading_blocked, true, "existing positions must force the certificate to NO_TRADE");
  assert.throws(
    () => buildAlpacaPaperLiveFixture({ ...fixture, snapshot: { ...currentInputs.snapshot, market: { ...currentInputs.snapshot.market, history_mode: "synthetic_fixture" } }, signals }),
    /refuses synthetic/,
  );
});

test("current pipeline consumes the live fixture without relabeling its data", async () => {
  const result = await buildAutonomousPaperDecision({
    inputs: inputs(),
    extractor: extractor(),
    signingSecret: SIGNING_SECRET,
    runId: "paper-decision-live-signals-test",
  });
  assert.equal(result.receipt.data_mode, "alpaca_paper_live");
  assert.equal(result.receipt.certificate.authorization_scope, "paper_submit");
  assert.equal(result.receipt.certificate.schema_version, "risk_certificate.v3");
  assert.equal(result.receipt.sanitized_decision_diagnostics.schema_version, "finly_sanitized_decision_diagnostics.v1");
  assert.ok(result.receipt.sanitized_decision_diagnostics.compiler_rejection_counts);
  assert.deepEqual(result.receipt.source_signals.map((signal) => signal.family), ["market", "options", "events"]);
  assert.match(result.fixture_sha256, /^sha256:[a-f0-9]{64}$/);
});

test("autonomous cycle journals NO_TRADE first and never invokes an executor by default", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-live-signals-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const logPath = join(temporary, "decisions.jsonl");
  const lockPath = join(temporary, "agent.lock");
  let executorCalls = 0;
  const result = await runAutonomousPaperCycle({
    client: {},
    extractor: extractor(),
    executor: { submit: async () => { executorCalls += 1; } },
    environment: {
      FINLY_EXECUTION_ENABLED: "false",
      APCA_API_KEY_ID: "SHOULD_NOT_APPEAR",
      APCA_API_SECRET_KEY: "ALSO_SHOULD_NOT_APPEAR",
    },
    inputProvider: async () => inputs(),
    now: () => new Date(AS_OF),
    signingSecret: SIGNING_SECRET,
    logPath,
    lockPath,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(executorCalls, 0);
  const raw = await readFile(logPath, "utf8");
  const lines = raw.trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].decision, "NO_TRADE");
  assert.equal(lines[0].status, "LOCKED_SAFE_DEFAULT");
  assert.equal(lines[1].event, "DECISION_COMPLETED");
  assert.equal(lines[1].data_mode, "alpaca_paper_live");
  assert.equal(lines[1].execution.status, "DISABLED");
  assert.equal(raw.includes("SHOULD_NOT_APPEAR"), false);
  assert.equal(raw.includes("ALSO_SHOULD_NOT_APPEAR"), false);
});

test("bounded economic authority permits a checked bearish entry", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-economic-entry-gate-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let executorCalls = 0;
  const executor = {
    submit: async () => { executorCalls += 1; },
    positionManager: {
      inspectOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
      manageOpenSession: async () => ({ active: false, status: "NO_OPEN_PAPER_SESSION" }),
    },
  };
  const result = await runAutonomousPaperCycle({
    client: {},
    extractor: extractor(),
    executor,
    economicBundleProvider: async () => bullishEconomicBundle(),
    environment: {
      ...EXECUTION_WINDOW,
      FINLY_EXECUTION_ENABLED: "true",
      FINLY_PAPER_SIGNING_SECRET: SIGNING_SECRET,
    },
    inputProvider: async () => inputs(),
    now: () => new Date(AS_OF),
    signingSecret: SIGNING_SECRET,
    logPath: join(temporary, "decisions.jsonl"),
    lockPath: join(temporary, "agent.lock"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.execution.status, "SUBMITTED_BY_INJECTED_EXECUTOR");
  assert.equal(result.execution.economic_guard.entry_gate_passed, true);
  assert.equal(result.receipt.certificate.decision, "BEAR_PUT_DEBIT_SPREAD");
  assert.equal(executorCalls, 1);
});

test("process lock and explicit-executor gate fail closed", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-live-lock-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const logPath = join(temporary, "decisions.jsonl");
  const lockPath = join(temporary, "agent.lock");
  await writeFile(lockPath, "occupied\n", { mode: 0o600 });
  const locked = await runAutonomousPaperCycle({
    client: {},
    environment: { FINLY_EXECUTION_ENABLED: "false" },
    inputProvider: async () => { throw new Error("must not read while another cycle owns the lock"); },
    now: () => new Date(AS_OF),
    logPath,
    lockPath,
  });
  assert.equal(locked.decision, "NO_TRADE");
  assert.equal(locked.status, "PROCESS_LOCK_HELD");

  await assert.rejects(
    () => runAutonomousPaperCycle({
      client: {},
      environment: { FINLY_EXECUTION_ENABLED: "true", FINLY_PAPER_SIGNING_SECRET: SIGNING_SECRET },
      inputProvider: async () => inputs(),
      now: () => new Date(AS_OF),
      logPath,
      lockPath: join(temporary, "second.lock"),
    }),
    /explicitly injected guarded paper executor/,
  );
});

test("local paper executor requires every explicit mutation gate before construction", () => {
  const client = {
    tradingBase: "https://paper-api.alpaca.markets",
    dataBase: "https://data.alpaca.markets",
  };
  const acknowledged = {
    FINLY_EXECUTION_ENABLED: "true",
    FINLY_EXECUTION_TRANSPORT: "mcp",
    ALPACA_PAPER_TRADE: "true",
    FINLY_PAPER_MUTATION_ACK: "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT",
    FINLY_COMPETITION_ACCOUNT_ID: "PAFIXTURE001",
    FINLY_COMPETITION_START_AT: "2026-08-28T18:00:00.000Z",
    FINLY_COMPETITION_END_AT: "2026-08-28T19:00:00.000Z",
    FINLY_OPTIONS_ENTRY_CUTOFF_AT: "2026-08-28T18:30:00.000Z",
    FINLY_OPTIONS_FORCE_FLAT_AT: "2026-08-28T18:45:00.000Z",
  };
  const options = {
    client,
    signingSecret: SIGNING_SECRET,
    mcpClient: { placeOptionOrder: async () => { throw new Error("not invoked during construction"); } },
  };

  assert.throws(
    () => buildGuardedLocalPaperExecutor({ ...options, environment: { ...acknowledged, FINLY_EXECUTION_ENABLED: "false" } }),
    /FINLY_EXECUTION_ENABLED=true/,
  );
  assert.throws(
    () => buildGuardedLocalPaperExecutor({ ...options, environment: { ...acknowledged, FINLY_EXECUTION_TRANSPORT: "rest" } }),
    /FINLY_EXECUTION_TRANSPORT=mcp/,
  );
  assert.throws(
    () => buildGuardedLocalPaperExecutor({ ...options, environment: { ...acknowledged, ALPACA_PAPER_TRADE: "false" } }),
    /explicit Alpaca paper mode/,
  );
  assert.throws(
    () => buildGuardedLocalPaperExecutor({ ...options, environment: { ...acknowledged, FINLY_PAPER_MUTATION_ACK: "close enough" } }),
    /exact hackathon paper-account acknowledgement/,
  );
  assert.throws(
    () => buildGuardedLocalPaperExecutor({
      ...options,
      environment: {
        ...acknowledged,
        APCA_API_KEY_ID: "rest-paper-key",
        ALPACA_API_KEY: "different-mcp-paper-key",
      },
    }),
    /REST preflight and MCP mutation credentials must be identical/,
  );
  assert.throws(
    () => buildGuardedLocalPaperExecutor({ ...options, client: { tradingBase: "https://api.alpaca.markets" }, environment: acknowledged }),
    /exact Alpaca paper client/,
  );
  const executor = buildGuardedLocalPaperExecutor({ ...options, environment: acknowledged });
  assert.equal(typeof executor.submit, "function");
});
