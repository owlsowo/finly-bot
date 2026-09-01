import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AlpacaPaperRestClient, alpacaCredentialsFromEnv } from "../lib/alpaca_rest.mjs";
import {
  G4_EQUITY_SYMBOLS,
  G4_MUTATION_ACK,
  parseG4BrokerInstant,
} from "../lib/g4_official_equity.mjs";
import { FilePaperSessionRegistry } from "../lib/paper_session_registry.mjs";
import { POLICY } from "../lib/policy.mjs";
import { parseOccOptionSymbol } from "../lib/schema.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_EQUITY = 100_000;
const OFFICIAL_START = "2026-08-31T13:30:00.000Z";
const OFFICIAL_END = "2026-09-04T13:30:00.000Z";
const OFFICIAL_G4_SYMBOLS = new Set(G4_EQUITY_SYMBOLS);
const G4_CLIENT_ORDER_ID = /^finly-g4-[a-f0-9]{20}$/;
const OPTION_CLIENT_ORDER_ID = /^finly-(?:exit-)?[a-f0-9]{20}$/;

function finiteMoney(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) throw new Error(`${label} is invalid`);
  return Math.round(number * 100) / 100;
}

function safeIso(value, label) {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed.toISOString();
}

function boundedCode(value, fallback) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(value) ? value : fallback;
}

function summarizeJournalEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { event: "NO_CLOUD_CYCLE_YET", decision: "NO_TRADE", code: "WAITING_FOR_FIRST_CYCLE", submitted: false };
  }
  const allowedDecisions = new Set(["NO_TRADE", "BULL_CALL_DEBIT_SPREAD", "BEAR_PUT_DEBIT_SPREAD"]);
  return {
    event: boundedCode(entry.event, "CYCLE_RECORDED"),
    decision: allowedDecisions.has(entry.decision) ? entry.decision : "NO_TRADE",
    code: boundedCode(entry.execution?.status ?? entry.management?.status ?? entry.status, "CYCLE_RECORDED"),
    submitted: entry.execution?.submitted === true,
    certifiedRisk: Number(entry.receipt?.certificate?.reserved_max_loss),
  };
}

function decisionPresentation({
  phase,
  equityPositions,
  optionPositions,
  equityOpenOrders,
  optionOpenOrders,
  journal,
}) {
  if (phase === "READY") return {
    status: "WAITING",
    code: "WAITING_FOR_COMPETITION_WINDOW",
    headline: "The full paper account is ready for the opening bell.",
    explanation: "Finly has verified the official Alpaca paper account and will not place an order before the scoring window opens.",
  };
  if (phase === "COMPLETE") return {
    status: "COMPLETE",
    code: "OFFICIAL_WINDOW_COMPLETE",
    headline: "The official trading window is complete.",
    explanation: "This is the latest public account summary from the same virtual-money account scored by the judges.",
  };
  if (optionPositions > 0) {
    const closing = /EXIT|CLOS/i.test(journal.code);
    return {
      status: "HOLDING",
      code: journal.code,
      headline: closing ? "Finly is closing a position under its risk rules." : "Finly is managing an options position with a fixed maximum loss.",
      explanation: closing
        ? "The exit gate fired, and Finly is reconciling the closing paper order before it can take another action."
        : "The position remains inside Finly's certified loss ceiling while the exit policy checks profit, loss, and time-to-expiry conditions.",
    };
  }
  if (optionOpenOrders > 0 || journal.submitted) return {
    status: "PROPOSING",
    code: journal.code,
    headline: "A risk-checked paper order is awaiting broker confirmation.",
    explanation: "Finly will not submit another trade until the existing order has been read back and reconciled against the approved strategy.",
  };
  if (equityPositions > 0) return {
    status: "MONITORING",
    code: journal.code,
    headline: "Finly Core's four-fund portfolio is invested and being monitored.",
    explanation: "The base portfolio remains invested while the separate options assistant waits for a setup that passes every risk check.",
  };
  if (equityOpenOrders > 0) return {
    status: "PROPOSING",
    code: journal.code,
    headline: "Finly is establishing its four-fund base portfolio.",
    explanation: "The virtual-money broker is processing the base allocation. The options assistant remains separate and cannot trade without passing its own checks.",
  };
  if (journal.decision === "BULL_CALL_DEBIT_SPREAD") return {
    status: "PROPOSING",
    code: journal.code,
    headline: "Finly found a bullish setup that passed its trading gates.",
    explanation: "The market view, option structure, and fixed loss limit agreed; the paper broker record determines whether the trade is accepted.",
  };
  if (journal.decision === "BEAR_PUT_DEBIT_SPREAD") return {
    status: "PROPOSING",
    code: journal.code,
    headline: "Finly found a bearish setup that passed its trading gates.",
    explanation: "The market view, option structure, and fixed loss limit agreed; the paper broker record determines whether the trade is accepted.",
  };
  if (/FAIL|NO_TRADE|GUARD|REJECT|FROZEN/.test(journal.code)) return {
    status: "NO_TRADE",
    code: journal.code,
    headline: "Finly checked the market and kept the account protected.",
    explanation: "At least one evidence, stability, broker, or risk check did not clear, so Finly left the paper account unchanged.",
  };
  return {
    status: "MONITORING",
    code: journal.code,
    headline: "Finly is monitoring the market for a setup worth taking.",
    explanation: "The assistant is reading the latest market and options evidence while hard rules keep the broker account locked.",
  };
}

function splitPositionsByAssetClass(records, label) {
  const equity = [];
  const options = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`${label} contains an invalid broker record`);
    }
    if (record.asset_class === "us_equity") {
      if (!OFFICIAL_G4_SYMBOLS.has(record.symbol)) {
        throw new Error(`${label} contains an equity outside the frozen G4 sleeve`);
      }
      equity.push(record);
    }
    else if (record.asset_class === "us_option") {
      let underlying;
      try { underlying = parseOccOptionSymbol(record.symbol).underlying; }
      catch { throw new Error(`${label} contains an invalid option symbol`); }
      if (underlying !== "SPY") throw new Error(`${label} contains an option outside the SPY overlay`);
      options.push(record);
    }
    else throw new Error(`${label} contains a non-allowlisted asset class`);
  }
  return { equity, options };
}

function isFinlySpyMlegOrder(order) {
  if (order.asset_class !== ""
    || order.order_class !== "mleg"
    || !OPTION_CLIENT_ORDER_ID.test(order.client_order_id ?? "")
    || !Array.isArray(order.legs)
    || order.legs.length !== 2) return false;
  return order.legs.every((leg) => {
    if (!leg || typeof leg !== "object" || Array.isArray(leg) || leg.asset_class !== "us_option") return false;
    try { return parseOccOptionSymbol(leg.symbol).underlying === "SPY"; }
    catch { return false; }
  });
}

function splitOpenOrders(records) {
  const equity = [];
  const options = [];
  for (const order of records) {
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      throw new Error("paper open orders contains an invalid broker record");
    }
    if (order.asset_class === "us_equity"
      && OFFICIAL_G4_SYMBOLS.has(order.symbol)
      && G4_CLIENT_ORDER_ID.test(order.client_order_id ?? "")) {
      equity.push(order);
    } else if (isFinlySpyMlegOrder(order)) options.push(order);
    else throw new Error("paper open orders contains an unsupported order shape");
  }
  return { equity, options };
}

function grossMarketValue(records, label) {
  return records.reduce((sum, record) => {
    const value = Number(record.market_value);
    if (!Number.isFinite(value)) throw new Error(`${label} contains an invalid market value`);
    return sum + Math.abs(value);
  }, 0);
}

export async function readLatestDecisionEntry(logPath) {
  try {
    const serialized = await readFile(logPath, "utf8");
    const lines = serialized.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    return JSON.parse(lines.at(-1));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("cloud decision journal could not be summarized");
  }
}

export function isDedicatedActivePaperAccount(account, expectedAccountId) {
  return account !== null
    && typeof account === "object"
    && !Array.isArray(account)
    && /^PA[A-Z0-9]{10}$/.test(expectedAccountId ?? "")
    && account.account_number === expectedAccountId
    && account.status === "ACTIVE"
    && account.trading_blocked === false
    && account.account_blocked === false
    && account.trade_suspended_by_user === false;
}

export function assertOpeningControlPlaneReadiness({
  account,
  configuration,
  clock,
  positions,
  openOrders,
  assets,
  expectedAccountId,
  environment,
  observedAt = new Date().toISOString(),
} = {}) {
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) throw new Error("control-plane observation time is invalid");
  if (!isDedicatedActivePaperAccount(account, expectedAccountId)
    || configuration?.suspend_trade !== false) {
    throw new Error("control-plane account binding or trading status is invalid");
  }
  if (environment?.ALPACA_PAPER_TRADE !== "true"
    || environment?.FINLY_G4_PRODUCTION_ENABLED !== "true"
    || environment?.FINLY_EXECUTION_TRANSPORT !== "mcp"
    || environment?.FINLY_PAPER_MUTATION_ACK !== G4_MUTATION_ACK) {
    throw new Error("control-plane execution configuration is invalid");
  }
  const tradingLevel = Number(account.options_trading_level);
  const approvedLevel = Number(account.options_approved_level);
  const optionsLevel = Math.min(tradingLevel, approvedLevel);
  if (!Number.isInteger(tradingLevel)
    || !Number.isInteger(approvedLevel)
    || optionsLevel < POLICY.minimumOptionsLevel) {
    throw new Error("control-plane options level is insufficient");
  }
  const clockAt = parseG4BrokerInstant(clock?.timestamp, "control-plane broker clock");
  if (Math.abs(clockAt - observed.getTime()) > 180_000) throw new Error("control-plane broker clock is stale");
  if (!Array.isArray(assets) || assets.length !== G4_EQUITY_SYMBOLS.length) {
    throw new Error("control-plane asset snapshot is incomplete");
  }
  assets.forEach((asset, index) => {
    if (!asset
      || asset.symbol !== G4_EQUITY_SYMBOLS[index]
      || asset.class !== "us_equity"
      || asset.status !== "active"
      || asset.tradable !== true
      || asset.fractionable !== true) {
      throw new Error(`control-plane asset readiness failed for ${G4_EQUITY_SYMBOLS[index]}`);
    }
  });
  if (observed.getTime() < Date.parse(OFFICIAL_START)) {
    const equity = Number(account.equity);
    const cash = Number(account.cash);
    if (environment.FINLY_EXECUTION_ENABLED !== "false"
      || !Number.isFinite(equity) || equity !== BASELINE_EQUITY
      || !Number.isFinite(cash) || cash !== BASELINE_EQUITY
      || !Array.isArray(positions) || positions.length !== 0
      || !Array.isArray(openOrders) || openOrders.length !== 0
      || clock.is_open !== false
      || parseG4BrokerInstant(clock.next_open, "control-plane next open") !== Date.parse(OFFICIAL_START)) {
      throw new Error("control-plane pre-open account is not at the frozen baseline");
    }
  }
  return true;
}

export function buildCompetitionLiveSnapshot({
  account,
  positions,
  openOrders,
  clock,
  latestDecision = null,
  certifiedOptionsRisk = null,
  accountVerified = false,
  observedAt = new Date().toISOString(),
  baselineEquity = BASELINE_EQUITY,
} = {}) {
  if (!account || typeof account !== "object" || Array.isArray(account)) throw new Error("paper account snapshot is unavailable");
  if (!Array.isArray(positions) || !Array.isArray(openOrders)) throw new Error("paper position or order snapshot is incomplete");
  if (!clock || typeof clock !== "object" || Array.isArray(clock)) throw new Error("paper market clock is unavailable");
  const snapshotAt = safeIso(observedAt, "snapshot timestamp");
  const equity = finiteMoney(account.equity, "paper equity");
  const cash = finiteMoney(account.cash, "paper cash");
  const buyingPower = finiteMoney(account.options_buying_power ?? account.buying_power, "paper buying power");
  const baseline = finiteMoney(baselineEquity, "competition baseline");
  if (equity <= 0 || baseline <= 0) throw new Error("paper equity baseline is invalid");
  const observedMs = new Date(snapshotAt).getTime();
  const phase = observedMs < new Date(OFFICIAL_START).getTime()
    ? "READY"
    : observedMs >= new Date(OFFICIAL_END).getTime()
      ? "COMPLETE"
      : "LIVE";
  const journal = summarizeJournalEntry(latestDecision);
  const positionClasses = splitPositionsByAssetClass(positions, "paper positions");
  const orderClasses = splitOpenOrders(openOrders);
  const decision = decisionPresentation({
    phase,
    equityPositions: positionClasses.equity.length,
    optionPositions: positionClasses.options.length,
    equityOpenOrders: orderClasses.equity.length,
    optionOpenOrders: orderClasses.options.length,
    journal,
  });
  const nextTransitionAt = clock.is_open === true
    ? safeIso(clock.next_close, "next market close")
    : safeIso(clock.next_open, "next market open");
  const equityMarketValue = grossMarketValue(positionClasses.equity, "paper equity positions");
  const optionExposureExists = positionClasses.options.length > 0 || orderClasses.options.length > 0;
  const riskCandidate = certifiedOptionsRisk ?? journal.certifiedRisk;
  let optionsDefinedRisk = 0;
  if (optionExposureExists) {
    if (riskCandidate === null || riskCandidate === undefined) {
      throw new Error("certified options max loss is unavailable");
    }
    optionsDefinedRisk = finiteMoney(riskCandidate, "certified options max loss");
  }
  const positionStatus = positions.length > 0
    ? (positionClasses.options.length > 0 && /EXIT|CLOS/i.test(journal.code) ? "CLOSING" : "OPEN")
    : openOrders.length > 0
      ? "PENDING"
      : "FLAT";
  const positionSummary = positionStatus === "FLAT"
    ? "No paper capital is currently committed to a position."
    : positionStatus === "PENDING"
      ? optionExposureExists
        ? "A certified options order is waiting for broker confirmation."
        : "A four-fund base-portfolio order is waiting for broker confirmation."
      : positionStatus === "CLOSING"
        ? "Finly is checking the capped-loss position's closing order against the broker."
        : positionClasses.equity.length > 0 && positionClasses.options.length > 0
          ? "The four-fund base portfolio is invested alongside a capped-loss options position."
          : positionClasses.equity.length > 0
            ? "The four-fund base portfolio is invested; no options trade is open."
            : "Finly is managing an open options position with a fixed maximum loss.";
  return {
    schema_version: "finly_competition_dashboard.v2",
    snapshot_at: snapshotAt,
    competition: {
      phase,
      baseline_equity: baseline,
      official_window_start: OFFICIAL_START,
      official_window_end: OFFICIAL_END,
    },
    account: { equity, cash, buying_power: buyingPower },
    market: {
      status: clock.is_open === true ? "OPEN" : "CLOSED",
      next_transition_at: nextTransitionAt,
      next_transition_label: nextTransitionAt === null
        ? "The next regular-session transition is not yet available."
        : clock.is_open === true
          ? `The regular market is scheduled to close at ${nextTransitionAt}.`
          : `The next regular session is scheduled to open at ${nextTransitionAt}.`,
    },
    decision,
    exposure: {
      position_status: positionStatus,
      position_summary: positionSummary,
      open_positions: positions.length,
      open_orders: openOrders.length,
      g4_equity_positions: positionClasses.equity.length,
      g4_equity_market_value_dollars: Math.round(equityMarketValue * 100) / 100,
      option_positions: positionClasses.options.length,
      option_open_orders: orderClasses.options.length,
      options_defined_risk_dollars: Math.round(optionsDefinedRisk * 100) / 100,
      per_trade_risk_limit_dollars: Math.round(Math.min(
        POLICY.riskPerTradeDollarCap,
        equity * POLICY.riskPerTradeFraction,
      ) * 100) / 100,
      aggregate_risk_limit_dollars: Math.round(equity * POLICY.aggregateRiskFraction * 100) / 100,
    },
    integrity: {
      paper_account: true,
      account_verified: accountVerified === true,
      sanitized: true,
      source: "Alpaca official paper-trading API",
    },
  };
}

async function writeSnapshot(output, snapshot) {
  const absolute = resolve(output);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, absolute);
}

function outputArgument(arguments_) {
  const outputIndex = arguments_.indexOf("--output");
  if (outputIndex === -1 || outputIndex + 1 >= arguments_.length || arguments_.length !== 2) {
    throw new Error("usage: build_competition_live_snapshot.mjs --output PATH");
  }
  return arguments_[outputIndex + 1];
}

async function main() {
  const output = outputArgument(process.argv.slice(2));
  const credentials = alpacaCredentialsFromEnv(process.env);
  const client = new AlpacaPaperRestClient(credentials);
  const sessionRegistry = new FilePaperSessionRegistry(
    resolve(projectRoot, process.env.FINLY_PAPER_SESSION_PATH ?? "data/private/paper-sessions"),
    process.env.FINLY_PAPER_SIGNING_SECRET,
  );
  const observedAt = new Date().toISOString();
  const preopen = Date.parse(observedAt) < Date.parse(OFFICIAL_START);
  const [[account, positions, openOrders, clock, latestDecision, openSession], controlPlane] = await Promise.all([
    Promise.all([
      client.getAccount(),
      client.getPositions(),
      client.getOpenOrders(),
      client.getClock(),
      readLatestDecisionEntry(resolve(projectRoot, process.env.FINLY_DECISION_LOG ?? "outputs/autonomous_decisions.jsonl")),
      sessionRegistry.loadOpen(),
    ]),
    preopen
      ? Promise.all([
        client.getAccountConfiguration(),
        ...G4_EQUITY_SYMBOLS.map((symbol) => client.getAsset(symbol)),
      ])
      : Promise.resolve([]),
  ]);
  const accountVerified = isDedicatedActivePaperAccount(account, process.env.FINLY_COMPETITION_ACCOUNT_ID);
  if (!accountVerified) throw new Error("paper snapshot account differs from the dedicated active competition account");
  if (preopen) {
    const [configuration, ...assets] = controlPlane;
    assertOpeningControlPlaneReadiness({
      account,
      configuration,
      clock,
      positions,
      openOrders,
      assets,
      expectedAccountId: process.env.FINLY_COMPETITION_ACCOUNT_ID,
      environment: process.env,
      observedAt,
    });
  }
  const snapshot = buildCompetitionLiveSnapshot({
    account,
    positions,
    openOrders,
    clock,
    latestDecision,
    certifiedOptionsRisk: openSession?.certificate?.reserved_max_loss ?? null,
    accountVerified,
    observedAt,
  });
  await writeSnapshot(output, snapshot);
  process.stdout.write('{"status":"SANITIZED_COMPETITION_SNAPSHOT_WRITTEN"}\n');
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch(() => {
    process.stderr.write("Finly competition snapshot failed safely.\n");
    process.exitCode = 1;
  });
}
