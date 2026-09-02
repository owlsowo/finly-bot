import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DeterministicReplayPlanner } from "../lib/agent.mjs";
import { buildMlegPayload, GuardedPaperExecutor } from "../lib/alpaca.mjs";
import { AlpacaMcpMutationClient, PINNED_ALPACA_MCP_METADATA } from "../lib/alpaca_mcp_client.mjs";
import { createAlpacaPaperPreflight, getNestedOrderByClientId, getNestedOrderByClientIdOrNull } from "../lib/alpaca_preflight.mjs";
import { AlpacaPaperRestClient, alpacaCredentialsFromEnv } from "../lib/alpaca_rest.mjs";
import { reconcileBrokerPositions } from "../lib/broker_positions.mjs";
import { id, redactSecrets, sha256 } from "../lib/canonical.mjs";
import { buildFreshCurrentEconomicBundle } from "../lib/current_economic_bundle.mjs";
import { FeatherlessEvidenceExtractor, LocalLlamaEvidenceExtractor } from "../lib/evidence_extractor.mjs";
import { createG4OfficialEquityCoordinator } from "../lib/g4_official_coordinator.mjs";
import {
  buildLiveEconomicOptionsDirectionAuthority,
  buildLiveEconomicOptionsExecutionGuard,
} from "../lib/live_economic_options_authority.mjs";
import { evaluateDebitSpreadExit } from "../lib/exit_policy.mjs";
import { HistoricalAlpacaClient } from "../lib/historical_alpaca.mjs";
import { fetchAlpacaLiveSnapshot } from "../lib/live_snapshot.mjs";
import { buildAlpacaPaperLiveFixture, buildLiveSignals } from "../lib/live_signals.mjs";
import {
  ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
  AlpacaPaperLifecycleRuntime,
  FileLifecycleCheckpointStore,
} from "../lib/paper_lifecycle_runtime.mjs";
import { FilePaperSessionRegistry } from "../lib/paper_session_registry.mjs";
import { FilePermitLedger } from "../lib/permit_ledger.mjs";
import { runDecision } from "../lib/pipeline.mjs";
import { verifyCertificate } from "../lib/risk.mjs";
import { checkpointCloudState } from "./cloud_state.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LOG_PATH = resolve(projectRoot, "outputs/autonomous_decisions.jsonl");
const DEFAULT_LOCK_PATH = resolve(projectRoot, "data/private/autonomous-paper-agent.lock");
const DEFAULT_LEDGER_PATH = resolve(projectRoot, "data/ledger");
const DEFAULT_LIFECYCLE_PATH = resolve(projectRoot, "data/private/paper-lifecycle");
const DEFAULT_SESSION_PATH = resolve(projectRoot, "data/private/paper-sessions");
const PAPER_MUTATION_ACK = "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT";

function isoNow(now) {
  const value = new Date(now());
  if (Number.isNaN(value.getTime())) throw new TypeError("autonomous agent clock is invalid");
  return value.toISOString();
}

function exactBoolean(value) {
  return value === true || value === "true";
}

function canonicalInstant(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a canonical ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

export function competitionWindowState(environment = process.env, at = new Date()) {
  const startAt = canonicalInstant(environment.FINLY_COMPETITION_START_AT, "competition start");
  const endAt = canonicalInstant(environment.FINLY_COMPETITION_END_AT, "competition end");
  if (startAt >= endAt) throw new TypeError("competition window is empty or inverted");
  const observedAt = new Date(at);
  if (Number.isNaN(observedAt.getTime())) throw new TypeError("competition clock is invalid");
  const observedIso = observedAt.toISOString();
  const status = observedIso < startAt
    ? "WAITING_FOR_COMPETITION_WINDOW"
    : observedIso >= endAt
      ? "COMPETITION_WINDOW_ENDED"
      : "COMPETITION_WINDOW_OPEN";
  return Object.freeze({ status, observed_at: observedIso, start_at: startAt, end_at: endAt });
}

export function optionsCompetitionControls(environment = process.env, at = new Date()) {
  const window = competitionWindowState(environment, at);
  const entryCutoffAt = canonicalInstant(environment.FINLY_OPTIONS_ENTRY_CUTOFF_AT, "options entry cutoff");
  const forceFlatAt = canonicalInstant(environment.FINLY_OPTIONS_FORCE_FLAT_AT, "options force-flat time");
  if (!(window.start_at < entryCutoffAt && entryCutoffAt < forceFlatAt && forceFlatAt < window.end_at)) {
    throw new TypeError("options cutoff schedule must satisfy competition start < entry cutoff < force-flat < competition end");
  }
  const entryGatePassed = window.status === "COMPETITION_WINDOW_OPEN" && window.observed_at < entryCutoffAt;
  const forceFlatRequired = window.status === "COMPETITION_WINDOW_OPEN" && window.observed_at >= forceFlatAt;
  return Object.freeze({
    schema_version: "finly_options_competition_controls.v1",
    observed_at: window.observed_at,
    entry_cutoff_at: entryCutoffAt,
    force_flat_at: forceFlatAt,
    entry_gate_passed: entryGatePassed,
    force_flat_required: forceFlatRequired,
  });
}

function finiteInteger(value, label, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function resolvedPath(candidate, fallback) {
  if (!candidate) return fallback;
  return isAbsolute(candidate) ? candidate : resolve(projectRoot, candidate);
}

function safeError(error) {
  return redactSecrets(String(error?.message ?? error)).slice(0, 500);
}

export function buildExitStrategyContext(receipt, { signingSecret, now = new Date() } = {}) {
  if (!receipt?.intent || !receipt?.certificate) throw new Error("current strategy decision is incomplete");
  verifyCertificate(receipt.certificate, {
    signingSecret,
    requiredScope: "paper_submit",
    now,
    requireCertified: false,
  });
  const intentHash = sha256(receipt?.intent);
  if (receipt.certificate.intent_sha256 !== intentHash) {
    throw new Error("current strategy intent is not bound to its decision certificate");
  }
  if (!new Set(["bullish", "bearish", "neutral"]).has(receipt.intent?.direction)) {
    throw new Error("current strategy intent has an invalid direction");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(receipt.certificate.certificate_id ?? "")) {
    throw new Error("current strategy intent has no decision-certificate ID");
  }
  return {
    schema_version: "finly_exit_strategy_context.v1",
    intent: structuredClone(receipt.intent),
    certificate: structuredClone(receipt.certificate),
  };
}

function strategyDirectionFromContext(context, { signingSecret, now }) {
  if (context === null || context === undefined) return null;
  const expected = ["certificate", "intent", "schema_version"];
  const actual = Object.keys(context).sort();
  if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) {
    throw new Error("exit strategy context contains missing or unknown fields");
  }
  if (context.schema_version !== "finly_exit_strategy_context.v1") throw new Error("exit strategy context is invalid");
  verifyCertificate(context.certificate, {
    signingSecret,
    requiredScope: "paper_submit",
    now,
    requireCertified: false,
  });
  if (context.certificate.intent_sha256 !== sha256(context.intent)
    || !new Set(["bullish", "bearish", "neutral"]).has(context.intent?.direction)) {
    throw new Error("exit strategy context is invalid");
  }
  return context.intent.direction;
}

export async function appendDecisionLog(logPath, entry) {
  const safeEntry = redactSecrets(entry);
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
  await appendFile(logPath, `${JSON.stringify(safeEntry)}\n`, { encoding: "utf8", mode: 0o600 });
  return safeEntry;
}

async function acquireCycleLock(lockPath, at) {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ schema_version: "finly_agent_lock.v1", pid: process.pid, acquired_at: at })}\n`);
    return handle;
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }
}

async function releaseCycleLock(handle, lockPath) {
  if (!handle) return;
  await handle.close();
  try {
    await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function advanceSnapshotAges(snapshot, elapsedSeconds) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new TypeError("snapshot elapsed time is invalid");
  return {
    market: {
      ...snapshot.market,
      quote_age_seconds: Math.round((snapshot.market.quote_age_seconds + elapsedSeconds) * 1000) / 1000,
    },
    option_chain: snapshot.option_chain.map((quote) => ({
      ...quote,
      quote_age_seconds: Math.round((quote.quote_age_seconds + elapsedSeconds) * 1000) / 1000,
    })),
  };
}

export async function readAlpacaInputs(client, {
  now = () => new Date(),
  underlying = "SPY",
  optionFeed = "indicative",
  stockFeed = "iex",
  newsLookbackHours = 48,
} = {}) {
  const snapshotStartedAt = isoNow(now);
  const newsStart = new Date(new Date(snapshotStartedAt).getTime() - newsLookbackHours * 3_600_000).toISOString();
  const [snapshot, newsResponse, account, positions, openOrders, clock] = await Promise.all([
    fetchAlpacaLiveSnapshot(client, { underlying, asOf: snapshotStartedAt, optionFeed, stockFeed }),
    client.getNews(underlying, { start: newsStart, limit: 12 }),
    client.getAccount(),
    client.getPositions(),
    client.getOpenOrders(),
    client.getClock(),
  ]);
  const decisionTime = isoNow(now);
  const elapsedSeconds = (new Date(decisionTime).getTime() - new Date(snapshotStartedAt).getTime()) / 1000;
  return {
    snapshot: advanceSnapshotAges(snapshot, elapsedSeconds),
    newsResponse,
    account,
    positions,
    openOrders,
    clock,
    decisionTime,
  };
}

export async function buildAutonomousPaperDecision({
  inputs,
  extractor,
  signingSecret,
  codeVersion = "working-tree",
  horizonSessions = 5,
  runId = id("paper-decision"),
  economicBundle = null,
}) {
  const { signals, omissions } = await buildLiveSignals({
    market: inputs.snapshot.market,
    optionChain: inputs.snapshot.option_chain,
    newsResponse: inputs.newsResponse,
    extractor,
    asOf: inputs.decisionTime,
  });
  const fixture = buildAlpacaPaperLiveFixture({
    snapshot: inputs.snapshot,
    signals,
    account: inputs.account,
    positions: inputs.positions,
    openOrders: inputs.openOrders,
    clock: inputs.clock,
    decisionTime: inputs.decisionTime,
    runId,
    codeVersion,
    horizonSessions,
  });
  const economicDirectionAuthority = economicBundle === null
    ? null
    : buildLiveEconomicOptionsDirectionAuthority(economicBundle, { asOf: inputs.decisionTime });
  const receipt = await runDecision({
    fixture,
    planner: new DeterministicReplayPlanner(),
    signingSecret,
    certificateScope: "paper_submit",
    economicDirectionAuthority,
  });
  return { receipt, omissions, fixture_sha256: sha256(fixture) };
}

export function eventEvidenceEntryGate(omissions, environment = process.env) {
  if (!Array.isArray(omissions)) throw new TypeError("event evidence omissions must be an array");
  const deterministicFallbackAllowed = environment.FINLY_ALLOW_DETERMINISTIC_FALLBACK === "true";
  const modelEvidenceRequired = environment.FINLY_ALLOW_DETERMINISTIC_FALLBACK === "false";
  const blockingReasons = new Set([
    "LOCAL_EVENT_EXTRACTOR_UNAVAILABLE",
    "EVENT_EXTRACTION_FAILED",
    "NEWS_FEED_UNAVAILABLE",
  ]);
  const observedBlockingReasons = [...new Set(omissions
    .filter((row) => row?.family === "events" && blockingReasons.has(row.reason))
    .map((row) => row.reason))].sort();
  const passed = !modelEvidenceRequired || deterministicFallbackAllowed || observedBlockingReasons.length === 0;
  return Object.freeze({
    schema_version: "finly_event_evidence_entry_gate.v1",
    model_evidence_required: modelEvidenceRequired,
    deterministic_fallback_allowed: deterministicFallbackAllowed,
    blocking_reason_codes: Object.freeze(observedBlockingReasons),
    entry_gate_passed: passed,
  });
}

export function buildGuardedLocalPaperExecutor({
  client,
  environment = process.env,
  signingSecret,
  now = () => new Date(),
  mcpClient,
  stateCheckpoint,
  optionsBrokerViewFilter,
} = {}) {
  if (!client || client.tradingBase !== "https://paper-api.alpaca.markets") {
    throw new Error("guarded execution requires the exact Alpaca paper client");
  }
  if (environment.FINLY_EXECUTION_ENABLED !== "true") {
    throw new Error("guarded execution requires FINLY_EXECUTION_ENABLED=true");
  }
  if (environment.FINLY_EXECUTION_TRANSPORT !== "mcp") {
    throw new Error("guarded execution requires FINLY_EXECUTION_TRANSPORT=mcp");
  }
  if (environment.ALPACA_PAPER_TRADE !== "true") {
    throw new Error("guarded execution requires explicit Alpaca paper mode");
  }
  if (environment.FINLY_PAPER_MUTATION_ACK !== PAPER_MUTATION_ACK) {
    throw new Error("guarded execution requires the exact hackathon paper-account acknowledgement");
  }
  if (!/^PA[A-Z0-9]{10}$/.test(environment.FINLY_COMPETITION_ACCOUNT_ID ?? "")) {
    throw new Error("guarded execution requires the dedicated competition account ID");
  }
  competitionWindowState(environment, now());
  optionsCompetitionControls(environment, now());
  const restKeyId = environment.APCA_API_KEY_ID ?? environment.ALPACA_API_KEY;
  const mcpKeyId = environment.ALPACA_API_KEY ?? environment.APCA_API_KEY_ID;
  const restSecret = environment.APCA_API_SECRET_KEY ?? environment.ALPACA_SECRET_KEY;
  const mcpSecret = environment.ALPACA_SECRET_KEY ?? environment.APCA_API_SECRET_KEY;
  if (restKeyId !== mcpKeyId || restSecret !== mcpSecret) {
    throw new Error("REST preflight and MCP mutation credentials must be identical");
  }
  if (typeof signingSecret !== "string" || Buffer.byteLength(signingSecret) < 32) {
    throw new Error("guarded execution requires a persistent 32-byte signing secret");
  }
  if (stateCheckpoint !== undefined && typeof stateCheckpoint !== "function") {
    throw new Error("guarded execution state checkpoint must be callable");
  }
  if (environment.FINLY_G4_PRODUCTION_ENABLED === "true" && typeof optionsBrokerViewFilter !== "function") {
    throw new Error("G4 production requires a strict options-only broker-view filter");
  }
  const ledger = new FilePermitLedger(resolvedPath(environment.FINLY_PERMIT_LEDGER_PATH, DEFAULT_LEDGER_PATH));
  const lifecycleStore = new FileLifecycleCheckpointStore(
    resolvedPath(environment.FINLY_LIFECYCLE_CHECKPOINT_PATH, DEFAULT_LIFECYCLE_PATH),
  );
  const sessionRegistry = new FilePaperSessionRegistry(
    resolvedPath(environment.FINLY_PAPER_SESSION_PATH, DEFAULT_SESSION_PATH),
    signingSecret,
    { now },
  );
  const mutationClient = mcpClient ?? new AlpacaMcpMutationClient({
    environment,
    ...(environment.FINLY_MCP_PYTHON ? { pythonCommand: resolvedPath(environment.FINLY_MCP_PYTHON) } : {}),
    ...(environment.FINLY_MCP_SERVER_COMMAND ? { serverCommand: resolvedPath(environment.FINLY_MCP_SERVER_COMMAND) } : {}),
  });
  const guarded = new GuardedPaperExecutor({
    baseUrl: client.tradingBase,
    transport: "mcp",
    enabled: true,
    signingSecret,
    permitLedger: ledger,
    preflight: createAlpacaPaperPreflight(client, {
      expectedAccountId: environment.FINLY_COMPETITION_ACCOUNT_ID,
      brokerViewFilter: optionsBrokerViewFilter,
    }),
    placeOptionOrder: (arguments_) => mutationClient.placeOptionOrder(arguments_),
    getOrderByClientOrderId: (clientOrderId) => getNestedOrderByClientId(client, clientOrderId),
    beforeMutation: stateCheckpoint,
    now,
    mcpMetadata: PINNED_ALPACA_MCP_METADATA,
  });
  const lookupNestedOrder = (clientOrderId) => getNestedOrderByClientIdOrNull(client, clientOrderId);
  const openLifecycle = (session) => AlpacaPaperLifecycleRuntime.open({
    certificate: session.certificate,
    entryProjection: session.entry_projection,
    checkpointSigningSecret: signingSecret,
    checkpointStore: lifecycleStore,
    lookupNestedOrderByClientOrderId: lookupNestedOrder,
    mutationsEnabled: true,
    beforeClosingMutation: stateCheckpoint,
    placeClosingOptionOrder: (projection) => mutationClient.placeExitOrder(projection),
    closingCapability: ALPACA_MCP_CLOSING_CREDIT_CAPABILITY,
    runId: session.certificate.run_id,
    now,
  });

  async function inspectOpenSession() {
    const session = await sessionRegistry.loadOpen();
    return session
      ? { active: true, status: session.status, session_id: session.session_id }
      : { active: false, status: "NO_OPEN_PAPER_SESSION" };
  }

  async function readBrokerState(state) {
    const [account, rawPositions, rawOpenOrders] = await Promise.all([
      client.getAccount(), client.getPositions(), client.getOpenOrders(),
    ]);
    if (account?.account_number !== environment.FINLY_COMPETITION_ACCOUNT_ID) {
      throw new Error("position manager credentials do not belong to the dedicated competition account");
    }
    if (account.status !== "ACTIVE" || account.trading_blocked !== false || account.account_blocked === true) {
      throw new Error("position manager found the paper account blocked or inactive");
    }
    const brokerView = optionsBrokerViewFilter
      ? optionsBrokerViewFilter({ positions: rawPositions, openOrders: rawOpenOrders })
      : { positions: rawPositions, openOrders: rawOpenOrders };
    return reconcileBrokerPositions({
      positions: brokerView.positions,
      entryProjection: state.active_entry_projection,
      lifecyclePhase: state.phase,
    });
  }

  async function markLifecycleTerminal(session, state, brokerReconciliation, {
    terminalStatus = session.ever_active || session.status === "ACTIVE" ? "CLOSED" : "ABSENT",
    evidence = {},
  } = {}) {
    const evidenceSha256 = sha256({
      lifecycle_id: state.lifecycle_id,
      phase: state.phase,
      revision: state.revision,
      broker_position_reconciliation: brokerReconciliation,
      ...evidence,
    });
    const reservation = await ledger.loadReservation(session.certificate.nonce);
    if (reservation === null && terminalStatus === "CLOSED") {
      throw new Error("active terminal session has no durable permit reservation");
    }
    if (reservation !== null) {
      await ledger.close(session.certificate.nonce, {
        closed_at: terminalStatus === "ABSENT" && state.phase !== "CLOSED"
          ? session.certificate.expires_at
          : state.updated_at,
        lifecycle_id: state.lifecycle_id,
        lifecycle_revision: state.revision,
        session_id: session.session_id,
        terminal_evidence_sha256: evidenceSha256,
        terminal_session_status: terminalStatus,
      });
    }
    if (terminalStatus === "CLOSED") {
      return sessionRegistry.markClosed(session.session_id, {
        expectedRevision: session.revision,
        reason: "lifecycle_closed",
        evidenceSha256,
      });
    }
    return sessionRegistry.markAbsent(session.session_id, {
      expectedRevision: session.revision,
      reason: state.phase === "CLOSED" ? "entry_terminal_without_position" : "entry_absent_after_permit_expiry",
      evidenceSha256,
    });
  }

  async function manageOpenSession({ strategyContext = null } = {}) {
    let session = await sessionRegistry.loadOpen();
    if (!session) return { active: false, status: "NO_OPEN_PAPER_SESSION" };
    if (session.status === "FROZEN") {
      return { active: true, status: "FROZEN_REQUIRES_RECONCILIATION", session_id: session.session_id };
    }
    const strategyDirection = strategyDirectionFromContext(strategyContext, { signingSecret, now: now() });
    const runtime = await openLifecycle(session);
    let state = runtime.snapshot();
    try {
      if (new Set(["CREATED", "ENTRY_ACCEPTED", "ENTRY_CANCEL_PENDING", "ENTRY_REPLACE_PENDING"]).has(state.phase)) {
        const entryOrder = await lookupNestedOrder(session.entry_projection.client_order_id);
        if (entryOrder === null) {
          const brokerReconciliation = await readBrokerState(state);
          if (new Date(now()) > new Date(session.certificate.expires_at)) {
            const absent = await markLifecycleTerminal(session, state, brokerReconciliation, {
              terminalStatus: "ABSENT",
              evidence: {
                client_order_id_sha256: sha256(session.entry_projection.client_order_id),
                broker_order_absent: true,
              },
            });
            return { active: true, terminal: true, status: absent.status, session_id: absent.session_id };
          }
          return { active: true, status: "ENTRY_SUBMISSION_PENDING", session_id: session.session_id };
        }
        state = await runtime.reconcileEntry(entryOrder);
      }

      if (state.phase === "EXIT_ACCEPTED") state = await runtime.reconcileExit();

      if (state.phase.endsWith("FROZEN")) {
        const frozen = await sessionRegistry.markFrozen(session.session_id, {
          expectedRevision: session.revision,
          reason: "lifecycle_frozen",
          evidenceSha256: sha256({ lifecycle_id: state.lifecycle_id, phase: state.phase, revision: state.revision }),
        });
        return { active: true, status: frozen.status, phase: state.phase, session_id: session.session_id };
      }

      const brokerReconciliation = await readBrokerState(state);
      if (state.phase === "CLOSED") {
        const terminal = await markLifecycleTerminal(session, state, brokerReconciliation);
        return { active: true, terminal: true, status: terminal.status, phase: state.phase, session_id: session.session_id };
      }
      if (session.status === "PENDING" && new Set(["ENTRY_ACCEPTED", "POSITION_OPEN", "EXIT_REQUIRED", "EXIT_ACCEPTED"]).has(state.phase)) {
        session = await sessionRegistry.markActive(session.session_id, {
          expectedRevision: session.revision,
          reason: "entry_reconciled",
          evidenceSha256: sha256({ lifecycle_id: state.lifecycle_id, phase: state.phase, revision: state.revision }),
        });
      }

      if (state.phase === "POSITION_OPEN" || state.phase === "EXIT_REQUIRED") {
        const clock = await client.getClock();
        if (clock?.is_open !== true) {
          return {
            active: true,
            status: "MARKET_CLOSED_POSITION_HELD",
            phase: state.phase,
            session_id: session.session_id,
          };
        }
        const symbols = session.entry_projection.legs.map((leg) => leg.symbol);
        const response = await client.getLatestOptionQuotes(symbols, { feed: session.certificate.option_feed });
        if (!response?.quotes || typeof response.quotes !== "object") throw new Error("position manager received no complete exit quotes");
        const observedAt = isoNow(now);
        const assessment = evaluateDebitSpreadExit({
          certificate: session.certificate,
          entryProjection: session.entry_projection,
          quotes: response.quotes,
          observedAt,
          strategyDirection,
          entryFilledAt: state.active_entry?.filled_at ?? null,
          forceExitAt: optionsCompetitionControls(environment, now()).force_flat_at,
        });
        if (state.phase === "POSITION_OPEN" && assessment.decision === "HOLD") {
          return {
            active: true,
            status: "POSITION_HELD_WITHIN_EXIT_GATES",
            phase: state.phase,
            session_id: session.session_id,
            assessment,
          };
        }
        if (state.phase === "POSITION_OPEN") state = await runtime.requireExit(assessment.trigger);
        const [freshClock] = await Promise.all([client.getClock(), readBrokerState(state)]);
        if (freshClock?.is_open !== true) throw new Error("market closed before the certified paper exit could be submitted");
        const requestId = `finly-exit-${sha256({
          session_id: session.session_id,
          trigger: state.exit_trigger,
          lifecycle_revision: state.revision,
        }).slice(-20)}`;
        state = await runtime.submitCreditExit({
          requestId,
          creditLimit: assessment.executable_credit_limit,
        });
        return {
          active: true,
          status: "EXIT_SUBMITTED_OR_RECONCILED",
          phase: state.phase,
          session_id: session.session_id,
          assessment,
        };
      }

      return { active: true, status: "PAPER_SESSION_RECONCILED", phase: state.phase, session_id: session.session_id };
    } catch (error) {
      state = runtime.snapshot();
      const lifecycleFrozen = state.phase.endsWith("FROZEN");
      const brokerMismatch = error?.code === "BROKER_POSITION_MISMATCH";
      if ((lifecycleFrozen || brokerMismatch) && session.status !== "FROZEN") {
        await sessionRegistry.markFrozen(session.session_id, {
          expectedRevision: session.revision,
          reason: lifecycleFrozen ? "lifecycle_frozen" : "broker_position_mismatch",
          evidenceSha256: sha256({
            lifecycle_id: state.lifecycle_id,
            phase: state.phase,
            revision: state.revision,
            error_code: brokerMismatch ? error.code : "LIFECYCLE_FROZEN",
            error_detail_sha256: sha256(safeError(error)),
          }),
        });
      }
      throw error;
    }
  }

  const executor = {
    async submit(candidate, certificate) {
      const controls = optionsCompetitionControls(environment, now());
      if (!controls.entry_gate_passed) throw new Error("new options entries are closed by the official competition cutoff");
      const payload = buildMlegPayload(candidate, certificate, {
        signingSecret,
        requiredScope: "paper_submit",
        now: now(),
      });
      const entryProjection = { ...payload };
      delete entryProjection.payload_sha256;
      let session = await sessionRegistry.createPending({ certificate, entryProjection });
      const runtime = await openLifecycle(session);
      await ledger.issue(certificate);
      const brokerReceipt = await guarded.submit(candidate, certificate);
      const lifecycle = await runtime.reconcileEntry();
      if (session.status === "PENDING" && new Set(["ENTRY_ACCEPTED", "POSITION_OPEN"]).has(lifecycle.phase)) {
        session = await sessionRegistry.markActive(session.session_id, {
          expectedRevision: session.revision,
          reason: "entry_reconciled",
          evidenceSha256: sha256({ lifecycle_id: lifecycle.lifecycle_id, phase: lifecycle.phase, revision: lifecycle.revision }),
        });
      }
      return {
        ...brokerReceipt,
        lifecycle: {
          session_id: session.session_id,
          status: session.status,
          phase: lifecycle.phase,
          revision: lifecycle.revision,
        },
      };
    },
  };
  executor.positionManager = { inspectOpenSession, manageOpenSession };
  return executor;
}

/**
 * Runs one non-overlapping read/decide cycle. The first durable journal event
 * is always NO_TRADE. An order can be submitted only when both the explicit
 * execution flag and an injected guarded executor are present.
 */
export async function runAutonomousPaperCycle({
  client,
  extractor,
  executor,
  positionManager = executor?.positionManager,
  environment = process.env,
  inputProvider,
  now = () => new Date(),
  signingSecret,
  economicBundleProvider,
  equityCoordinator,
  logPath = resolvedPath(environment.FINLY_DECISION_LOG, DEFAULT_LOG_PATH),
  lockPath = resolvedPath(environment.FINLY_AGENT_LOCK_PATH, DEFAULT_LOCK_PATH),
  codeVersion = environment.FINLY_CODE_VERSION ?? "working-tree",
  horizonSessions = finiteInteger(environment.FINLY_HORIZON_SESSIONS ?? 3, "FINLY_HORIZON_SESSIONS", { minimum: 1, maximum: 20 }),
} = {}) {
  const executionEnabled = exactBoolean(environment.FINLY_EXECUTION_ENABLED);
  const g4ProductionEnabled = executionEnabled && environment.FINLY_G4_PRODUCTION_ENABLED === "true";
  if (executionEnabled && (!executor || typeof executor.submit !== "function")) {
    throw new Error("execution requires an explicitly injected guarded paper executor");
  }
  if (executionEnabled && (!positionManager
    || typeof positionManager.inspectOpenSession !== "function"
    || typeof positionManager.manageOpenSession !== "function")) {
    throw new Error("execution requires an explicitly injected paper position manager");
  }
  if (executionEnabled && typeof economicBundleProvider !== "function") {
    throw new Error("execution requires a fresh economic bundle provider for every cycle");
  }
  if (g4ProductionEnabled && (!equityCoordinator
    || typeof equityCoordinator.advance !== "function"
    || typeof equityCoordinator.splitOptionsBrokerView !== "function")) {
    throw new Error("G4 production requires an explicitly injected equity coordinator");
  }
  const suppliedSigningSecret = signingSecret ?? environment.FINLY_PAPER_SIGNING_SECRET;
  if (executionEnabled && (typeof suppliedSigningSecret !== "string" || Buffer.byteLength(suppliedSigningSecret) < 32)) {
    throw new Error("execution requires a persistent 32-byte FINLY_PAPER_SIGNING_SECRET");
  }
  const decisionSigningSecret = suppliedSigningSecret ?? randomBytes(32).toString("hex");
  const startedAt = isoNow(now);
  const cycleId = id("agent-cycle");
  const lockHandle = await acquireCycleLock(lockPath, startedAt);
  if (!lockHandle) {
    const entry = await appendDecisionLog(logPath, {
      schema_version: "autonomous_decision_log.v1",
      event: "CYCLE_SKIPPED",
      cycle_id: cycleId,
      created_at: startedAt,
      data_mode: "alpaca_paper_live",
      decision: "NO_TRADE",
      status: "PROCESS_LOCK_HELD",
    });
    return { ok: false, decision: "NO_TRADE", status: entry.status };
  }
  try {
    let optionsControls = null;
    if (executionEnabled) {
      const window = competitionWindowState(environment, startedAt);
      if (window.status !== "COMPETITION_WINDOW_OPEN") {
        const entry = await appendDecisionLog(logPath, {
          schema_version: "autonomous_decision_log.v1",
          event: "CYCLE_SKIPPED",
          cycle_id: cycleId,
          created_at: startedAt,
          data_mode: "alpaca_paper_live",
          decision: "NO_TRADE",
          status: window.status,
          competition_window: window,
        });
        return { ok: true, decision: "NO_TRADE", status: entry.status, competition_window: entry.competition_window };
      }
      optionsControls = optionsCompetitionControls(environment, startedAt);
    }
    await appendDecisionLog(logPath, {
      schema_version: "autonomous_decision_log.v1",
      event: "CYCLE_STARTED",
      cycle_id: cycleId,
      created_at: startedAt,
      data_mode: "alpaca_paper_live",
      decision: "NO_TRADE",
      status: "LOCKED_SAFE_DEFAULT",
      execution_enabled: executionEnabled,
    });
    try {
      let result = null;
      let economicBundle = null;
      let economicRefreshError = null;
      let g4EquityGate = null;
      if (g4ProductionEnabled) {
        g4EquityGate = await equityCoordinator.advance({ observedAt: startedAt });
        if (g4EquityGate.status !== "G4_EQUITY_READY"
          || g4EquityGate.equity_ready !== true
          || g4EquityGate.options_authorized !== true
          || g4EquityGate.readiness_receipt === null) {
          const entry = await appendDecisionLog(logPath, {
            schema_version: "autonomous_decision_log.v1",
            event: "G4_EQUITY_GATE",
            cycle_id: cycleId,
            created_at: isoNow(now),
            data_mode: "alpaca_paper_live",
            decision: "NO_TRADE",
            status: g4EquityGate.status,
            equity_gate: g4EquityGate,
          });
          return {
            ok: true,
            decision: "NO_TRADE",
            status: entry.status,
            equity_gate: entry.equity_gate,
          };
        }
      }
      if (executionEnabled) {
        try {
          economicBundle = await economicBundleProvider({ client, now });
          buildLiveEconomicOptionsDirectionAuthority(economicBundle, { asOf: isoNow(now) });
        } catch (error) {
          economicRefreshError = error;
        }
      }
      const buildCurrentDecision = async () => {
        if (executionEnabled && economicRefreshError) throw economicRefreshError;
        if (executionEnabled && economicBundle === null) throw new Error("fresh economic bundle provider returned no bundle");
        const rawInputs = inputProvider
          ? await inputProvider({ client, now })
          : await readAlpacaInputs(client, { now });
        const optionsView = g4ProductionEnabled
          ? equityCoordinator.splitOptionsBrokerView({
            positions: rawInputs.positions,
            openOrders: rawInputs.openOrders,
          })
          : { positions: rawInputs.positions, openOrders: rawInputs.openOrders };
        const inputs = {
          ...rawInputs,
          positions: optionsView.positions,
          openOrders: optionsView.openOrders,
        };
        return buildAutonomousPaperDecision({
          inputs,
          extractor,
          signingSecret: decisionSigningSecret,
          codeVersion,
          horizonSessions,
          economicBundle,
        });
      };
      if (executionEnabled) {
        const inspection = await positionManager.inspectOpenSession();
        if (inspection.active) {
          let strategyContext = null;
          let strategyContextStatus = inspection.status === "FROZEN"
            ? "NOT_EVALUATED_FROZEN"
            : "CURRENT_INTENT_UNAVAILABLE";
          let strategyInputError = null;
          if (inspection.status !== "FROZEN") {
            try {
              result = await buildCurrentDecision();
              strategyContext = buildExitStrategyContext(result.receipt, {
                signingSecret: decisionSigningSecret,
                now: now(),
              });
              strategyContextStatus = "CURRENT_DETERMINISTIC_INTENT_BOUND";
            } catch (error) {
              strategyInputError = error;
            }
          }
          const management = await positionManager.manageOpenSession({ strategyContext });
          if (management.active) {
            const managementWithContext = { ...management, strategy_context_status: strategyContextStatus };
            const entry = await appendDecisionLog(logPath, {
              schema_version: "autonomous_decision_log.v1",
              event: "POSITION_MANAGED",
              cycle_id: cycleId,
              created_at: isoNow(now),
              data_mode: "alpaca_paper_live",
              decision: "NO_TRADE",
              status: managementWithContext.status,
              management: managementWithContext,
            });
            return { ok: true, decision: "NO_TRADE", status: entry.status, management: entry.management };
          }
          if (strategyInputError) throw strategyInputError;
        }
      }
      if (result === null) result = await buildCurrentDecision();
      let execution = { status: "DISABLED", submitted: false };
      let economicGuard = null;
      if (executionEnabled) {
        if (economicBundle === null) throw new Error("execution requires a freshly checked economic guard bundle");
        economicGuard = buildLiveEconomicOptionsExecutionGuard(economicBundle, {
          asOf: isoNow(now),
          intentDirection: result.receipt.intent.direction,
        });
      }
      const eventEvidenceGate = executionEnabled
        ? eventEvidenceEntryGate(result.omissions, environment)
        : null;
      if (executionEnabled
        && economicGuard.entry_gate_passed
        && eventEvidenceGate.entry_gate_passed
        && optionsControls.entry_gate_passed
        && result.receipt.certificate.certified
        && result.receipt.compilation.selected) {
        const brokerResult = await executor.submit(result.receipt.compilation.selected, result.receipt.certificate);
        execution = {
          status: "SUBMITTED_BY_INJECTED_EXECUTOR",
          submitted: true,
          economic_guard: economicGuard,
          event_evidence_gate: eventEvidenceGate,
          options_competition_controls: optionsControls,
          broker_result: brokerResult,
        };
      } else if (executionEnabled && !economicGuard.entry_gate_passed) {
        execution = {
          status: "ECONOMIC_GUARD_NO_TRADE",
          submitted: false,
          economic_guard: economicGuard,
          event_evidence_gate: eventEvidenceGate,
          options_competition_controls: optionsControls,
        };
      } else if (executionEnabled && !eventEvidenceGate.entry_gate_passed) {
        execution = {
          status: "MODEL_EVIDENCE_NO_TRADE",
          submitted: false,
          economic_guard: economicGuard,
          event_evidence_gate: eventEvidenceGate,
          options_competition_controls: optionsControls,
        };
      } else if (executionEnabled && !optionsControls.entry_gate_passed) {
        execution = {
          status: "OPTIONS_ENTRY_CUTOFF_NO_TRADE",
          submitted: false,
          economic_guard: economicGuard,
          event_evidence_gate: eventEvidenceGate,
          options_competition_controls: optionsControls,
        };
      } else if (executionEnabled) {
        execution = {
          status: "NO_CERTIFIED_TRADE",
          submitted: false,
          economic_guard: economicGuard,
          event_evidence_gate: eventEvidenceGate,
          options_competition_controls: optionsControls,
        };
      }
      const entry = await appendDecisionLog(logPath, {
        schema_version: "autonomous_decision_log.v1",
        event: "DECISION_COMPLETED",
        cycle_id: cycleId,
        created_at: result.receipt.created_at,
        data_mode: "alpaca_paper_live",
        decision: result.receipt.certificate.decision,
        proposed_decision: result.receipt.certificate.proposed_decision,
        receipt_id: result.receipt.receipt_id,
        fixture_sha256: result.fixture_sha256,
        omissions: result.omissions,
        execution,
        signing_key_mode: suppliedSigningSecret ? "persistent_local" : "ephemeral_decision_only",
        receipt: result.receipt,
      });
      return { ok: true, receipt: result.receipt, omissions: result.omissions, execution: entry.execution };
    } catch (error) {
      const errorDetail = safeError(error);
      const entry = await appendDecisionLog(logPath, {
        schema_version: "autonomous_decision_log.v1",
        event: "CYCLE_FAILED",
        cycle_id: cycleId,
        created_at: isoNow(now),
        data_mode: "alpaca_paper_live",
        decision: "NO_TRADE",
        status: "FAIL_CLOSED",
        error_code: "CYCLE_INPUT_OR_DECISION_ERROR",
        error_detail_sha256: sha256(errorDetail),
      });
      return { ok: false, decision: "NO_TRADE", status: entry.status, error_code: entry.error_code };
    }
  } finally {
    await releaseCycleLock(lockHandle, lockPath);
  }
}

function waitForNextCycle(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(true), milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolvePromise(false);
    }, { once: true });
  });
}

export async function runAutonomousPaperLoop({
  intervalSeconds = 0,
  maximumCycles = Infinity,
  signal,
  onCycle,
  ...cycleOptions
} = {}) {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 0 || intervalSeconds > 86_400) {
    throw new TypeError("intervalSeconds must be an integer from zero to 86400");
  }
  if (!(maximumCycles === Infinity || (Number.isInteger(maximumCycles) && maximumCycles >= 1))) {
    throw new TypeError("maximumCycles must be a positive integer or Infinity");
  }
  const results = [];
  while (!signal?.aborted && results.length < maximumCycles) {
    const result = await runAutonomousPaperCycle(cycleOptions);
    results.push(result);
    await onCycle?.(result);
    if (intervalSeconds === 0 || results.length >= maximumCycles) break;
    if (!await waitForNextCycle(intervalSeconds * 1000, signal)) break;
  }
  return results;
}

async function main() {
  const credentials = alpacaCredentialsFromEnv(process.env);
  const client = new AlpacaPaperRestClient(credentials);
  const useLocalEvents = exactBoolean(process.env.FINLY_USE_LOCAL_LLAMA_EVENTS);
  const useHostedEvents = exactBoolean(process.env.FINLY_USE_FEATHERLESS_EVENTS);
  if (useLocalEvents && useHostedEvents) throw new Error("only one Finly event extractor may be enabled");
  const hostedKeyAvailable = typeof process.env.FEATHERLESS_API_KEY === "string"
    && /^\S{12,}$/.test(process.env.FEATHERLESS_API_KEY);
  const extractor = useLocalEvents
    ? new LocalLlamaEvidenceExtractor()
    : useHostedEvents && hostedKeyAvailable
      ? new FeatherlessEvidenceExtractor()
      : undefined;
  const signingSecret = process.env.FINLY_PAPER_SIGNING_SECRET;
  const executionEnabled = exactBoolean(process.env.FINLY_EXECUTION_ENABLED);
  const g4ProductionEnabled = executionEnabled && exactBoolean(process.env.FINLY_G4_PRODUCTION_ENABLED);
  const cloudPublicationDirectory = process.env.FINLY_CLOUD_STATE_PUBLICATION_DIR;
  const stateCheckpoint = cloudPublicationDirectory
    ? async () => checkpointCloudState({
      root: projectRoot,
      publicationDirectory: cloudPublicationDirectory,
      secret: process.env.FINLY_CLOUD_STATE_SECRET,
    })
    : undefined;
  const equityCoordinator = g4ProductionEnabled
    ? await createG4OfficialEquityCoordinator({
      client,
      environment: process.env,
      signingSecret,
      stateCheckpoint,
    })
    : undefined;
  const optionsBrokerViewFilter = equityCoordinator
    ? (brokerView) => equityCoordinator.splitOptionsBrokerView(brokerView)
    : undefined;
  const executor = executionEnabled
    ? buildGuardedLocalPaperExecutor({
      client,
      environment: process.env,
      signingSecret,
      stateCheckpoint,
      optionsBrokerViewFilter,
    })
    : undefined;
  const historicalClient = executionEnabled ? new HistoricalAlpacaClient(credentials) : null;
  const economicBundleProvider = executionEnabled
    ? async () => buildFreshCurrentEconomicBundle({
      historicalClient,
      paperClient: client,
      lastRebalanceDate: process.env.FINLY_LAST_ECONOMIC_REBALANCE_DATE ?? null,
    })
    : undefined;
  const intervalSeconds = finiteInteger(process.env.FINLY_AGENT_INTERVAL_SECONDS ?? 0, "FINLY_AGENT_INTERVAL_SECONDS", { minimum: 0, maximum: 86_400 });
  const maximumCycles = finiteInteger(process.env.FINLY_AGENT_MAXIMUM_CYCLES ?? 1, "FINLY_AGENT_MAXIMUM_CYCLES", { minimum: 1, maximum: 72 });
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await runAutonomousPaperLoop({
    client,
    extractor,
    executor,
    equityCoordinator,
    economicBundleProvider,
    signingSecret,
    intervalSeconds,
    maximumCycles,
    signal: controller.signal,
    onCycle: (result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        decision: result.receipt?.certificate?.decision ?? result.decision,
        receipt_id: result.receipt?.receipt_id ?? null,
        execution: result.execution?.status ?? result.management?.status ?? result.status ?? "DISABLED",
      })}\n`);
      if (result.status === "COMPETITION_WINDOW_ENDED") controller.abort();
    },
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`Finly autonomous paper agent stopped: ${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
