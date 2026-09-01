import { useCallback, useEffect, useMemo, useState } from "react";
import firstCloseMeasurement from "./data/competition_forward_profit_2026_08_31.json";

type MarketStatus = "OPEN" | "CLOSED" | "PRE_OPEN" | "HALTED";
type CompetitionPhase = "READY" | "LIVE" | "COMPLETE";
type DecisionStatus = "WAITING" | "MONITORING" | "PROPOSING" | "HOLDING" | "NO_TRADE" | "COMPLETE";
type PositionStatus = "FLAT" | "PENDING" | "OPEN" | "CLOSING";

type CompetitionSnapshot = {
  schema_version: "finly_competition_dashboard.v2";
  snapshot_at: string;
  competition: {
    phase: CompetitionPhase;
    baseline_equity: number;
    official_window_start: string;
    official_window_end: string;
  };
  account: {
    equity: number;
    cash: number;
    buying_power: number;
  };
  market: {
    status: MarketStatus;
    next_transition_at: string | null;
    next_transition_label: string;
  };
  decision: {
    status: DecisionStatus;
    code: string;
    headline: string;
    explanation: string;
  };
  exposure: {
    position_status: PositionStatus;
    position_summary: string;
    open_positions: number;
    open_orders: number;
    g4_equity_positions: number;
    g4_equity_market_value_dollars: number;
    option_positions: number;
    option_open_orders: number;
    options_defined_risk_dollars: number;
    per_trade_risk_limit_dollars: number;
    aggregate_risk_limit_dollars: number;
  };
  integrity: {
    paper_account: true;
    account_verified: boolean;
    sanitized: true;
    source: string;
  };
};

type SnapshotOrigin = "live" | "fallback" | "unavailable";

const REMOTE_SNAPSHOT_URL = "https://raw.githubusercontent.com/owlsowo/finly-bot/finly-cloud-state/competition_live.json";
const LOCAL_SNAPSHOT_URL = "./data/competition_live.json";
const REFRESH_INTERVAL_MS = 60_000;
const FRESH_FOR_MS = 15 * 60_000;
const easternFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

const money = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: "currency",
});

const moneyExact = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const signedMoney = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  signDisplay: "always",
  style: "currency",
});

const signedMoneyExact = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  signDisplay: "always",
  style: "currency",
});

const signedPercent = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  signDisplay: "always",
  style: "percent",
});

const allowedMarketStatuses = new Set<MarketStatus>(["OPEN", "CLOSED", "PRE_OPEN", "HALTED"]);
const allowedCompetitionPhases = new Set<CompetitionPhase>(["READY", "LIVE", "COMPLETE"]);
const allowedDecisionStatuses = new Set<DecisionStatus>(["WAITING", "MONITORING", "PROPOSING", "HOLDING", "NO_TRADE", "COMPLETE"]);
const allowedPositionStatuses = new Set<PositionStatus>(["FLAT", "PENDING", "OPEN", "CLOSING"]);

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isSafeSnapshot(value: unknown): value is CompetitionSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<CompetitionSnapshot>;
  if (snapshot.schema_version !== "finly_competition_dashboard.v2"
    || !isIsoTimestamp(snapshot.snapshot_at)
    || !snapshot.competition
    || !snapshot.account
    || !snapshot.market
    || !snapshot.decision
    || !snapshot.exposure
    || !snapshot.integrity) return false;

  return allowedCompetitionPhases.has(snapshot.competition.phase)
    && isFiniteNonNegative(snapshot.competition.baseline_equity)
    && snapshot.competition.baseline_equity > 0
    && isIsoTimestamp(snapshot.competition.official_window_start)
    && isIsoTimestamp(snapshot.competition.official_window_end)
    && isFiniteNonNegative(snapshot.account.equity)
    && isFiniteNonNegative(snapshot.account.cash)
    && isFiniteNonNegative(snapshot.account.buying_power)
    && allowedMarketStatuses.has(snapshot.market.status)
    && (snapshot.market.next_transition_at === null || isIsoTimestamp(snapshot.market.next_transition_at))
    && typeof snapshot.market.next_transition_label === "string"
    && allowedDecisionStatuses.has(snapshot.decision.status)
    && typeof snapshot.decision.code === "string"
    && typeof snapshot.decision.headline === "string"
    && snapshot.decision.headline.length > 0
    && typeof snapshot.decision.explanation === "string"
    && snapshot.decision.explanation.length > 0
    && allowedPositionStatuses.has(snapshot.exposure.position_status)
    && typeof snapshot.exposure.position_summary === "string"
    && Number.isInteger(snapshot.exposure.open_positions)
    && snapshot.exposure.open_positions >= 0
    && Number.isInteger(snapshot.exposure.open_orders)
    && snapshot.exposure.open_orders >= 0
    && Number.isInteger(snapshot.exposure.g4_equity_positions)
    && snapshot.exposure.g4_equity_positions >= 0
    && isFiniteNonNegative(snapshot.exposure.g4_equity_market_value_dollars)
    && Number.isInteger(snapshot.exposure.option_positions)
    && snapshot.exposure.option_positions >= 0
    && Number.isInteger(snapshot.exposure.option_open_orders)
    && snapshot.exposure.option_open_orders >= 0
    && isFiniteNonNegative(snapshot.exposure.options_defined_risk_dollars)
    && isFiniteNonNegative(snapshot.exposure.per_trade_risk_limit_dollars)
    && isFiniteNonNegative(snapshot.exposure.aggregate_risk_limit_dollars)
    && snapshot.integrity.paper_account === true
    && typeof snapshot.integrity.account_verified === "boolean"
    && snapshot.integrity.sanitized === true
    && typeof snapshot.integrity.source === "string"
    && snapshot.integrity.source.length > 0;
}

function withCacheBuster(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}finly_snapshot=${Date.now()}`;
}

async function fetchSnapshot(url: string): Promise<CompetitionSnapshot> {
  const response = await fetch(withCacheBuster(url), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Snapshot request returned ${response.status}.`);
  const candidate: unknown = await response.json();
  if (!isSafeSnapshot(candidate)) throw new Error("Snapshot did not pass the public dashboard contract.");
  return candidate;
}

function relativeFreshness(snapshotAt: string, now: number): { label: string; stale: boolean } {
  const elapsed = Math.max(0, now - Date.parse(snapshotAt));
  if (elapsed < 60_000) return { label: "Updated less than a minute ago", stale: false };
  if (elapsed < 60 * 60_000) {
    const minutes = Math.floor(elapsed / 60_000);
    return { label: `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`, stale: elapsed > FRESH_FOR_MS };
  }
  return { label: `Snapshot from ${easternFormatter.format(new Date(snapshotAt))} ET`, stale: true };
}

function marketStatusCopy(snapshot: CompetitionSnapshot): string {
  const nextTransition = snapshot.market.next_transition_at
    ? `${easternFormatter.format(new Date(snapshot.market.next_transition_at))} ET`
    : null;
  if (snapshot.market.status === "OPEN") return "The market is open and Finly is monitoring the official paper account.";
  if (snapshot.market.status === "PRE_OPEN") {
    return nextTransition
      ? `The market is not open yet. Finly's next paper-trading window begins ${nextTransition}.`
      : "The market is not open yet, so Finly is waiting in cash.";
  }
  if (snapshot.market.status === "HALTED") return "Trading is halted, so Finly will not authorize a new position.";
  return nextTransition
    ? `The market is closed. Finly will check again when the next regular session begins ${nextTransition}.`
    : "The market is closed, so Finly is waiting in cash.";
}

function publicDecisionStory(snapshot: CompetitionSnapshot): { headline: string; explanation: string } {
  if (snapshot.exposure.option_positions > 0) return {
    headline: "Finly is managing an options trade with a fixed maximum loss.",
    explanation: "The trade remains inside its pre-calculated loss limit while Finly checks the exit rules.",
  };
  if (snapshot.exposure.option_open_orders > 0) return {
    headline: "A capped-loss options order is waiting for Alpaca to confirm it.",
    explanation: "Finly will not send another order until the broker reports what happened to this one.",
  };
  if (snapshot.exposure.g4_equity_positions > 0) return {
    headline: "Finly's four-fund base portfolio is invested and being monitored.",
    explanation: "The base portfolio remains invested. The separate options assistant will trade only when every evidence and risk check passes.",
  };
  if (snapshot.exposure.open_orders > 0) return {
    headline: "Finly is setting up its four-fund base portfolio.",
    explanation: "The virtual-money broker is processing the allocation. The options assistant remains locked until its own checks pass.",
  };
  if (snapshot.decision.status === "NO_TRADE") return {
    headline: "Finly checked the market and decided not to trade.",
    explanation: "At least one evidence, pricing, broker, or risk check did not pass, so the account stayed unchanged.",
  };
  return {
    headline: "Finly is watching for a trade worth taking.",
    explanation: "The assistant is reviewing market and options evidence. Hard rules keep the account locked until every check passes.",
  };
}

export function CompetitionDashboard() {
  const [snapshot, setSnapshot] = useState<CompetitionSnapshot | null>(null);
  const [origin, setOrigin] = useState<SnapshotOrigin>("unavailable");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const liveSnapshot = await fetchSnapshot(REMOTE_SNAPSHOT_URL);
      setSnapshot(liveSnapshot);
      setOrigin("live");
    } catch {
      try {
        const fallbackSnapshot = await fetchSnapshot(LOCAL_SNAPSHOT_URL);
        setSnapshot(fallbackSnapshot);
        setOrigin("fallback");
      } catch {
        setOrigin("unavailable");
      }
    } finally {
      setNow(Date.now());
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialRefreshId = window.setTimeout(() => { void refresh(); }, 0);
    const intervalId = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialRefreshId);
      window.clearInterval(intervalId);
    };
  }, [refresh]);

  const result = useMemo(() => {
    if (!snapshot) return null;
    const pnl = snapshot.account.equity - snapshot.competition.baseline_equity;
    return {
      pnl,
      pnlPercent: pnl / snapshot.competition.baseline_equity,
    };
  }, [snapshot]);

  if (!snapshot || !result) {
    return (
      <section className="live-competition" id="live" aria-labelledby="live-title">
        <div className="shell">
          <div className="live-section-heading">
            <div>
              <p className="kicker">Practice account / live competition</p>
              <h2 id="live-title">Watch Finly's $100,000 paper-trading account.</h2>
            </div>
            <p>A paper account follows real market prices without using real money. Finly publishes only a safe account summary; private broker details never reach this page.</p>
          </div>
          <div className="live-unavailable" role="status">
            <strong>{isRefreshing ? "Connecting to the latest published snapshot…" : "The latest snapshot is temporarily unavailable."}</strong>
            <p>{isRefreshing ? "The verified account result will appear here in a moment." : "The trading system remains independent of this display. Refresh to try the public feed again."}</p>
            {!isRefreshing && <button type="button" onClick={() => { void refresh(); }}>Try again</button>}
          </div>
        </div>
      </section>
    );
  }

  const freshness = relativeFreshness(snapshot.snapshot_at, now);
  const decisionStory = publicDecisionStory(snapshot);
  const resultTone = result.pnl > 0 ? "positive" : result.pnl < 0 ? "negative" : "neutral";
  const marketIsLive = snapshot.market.status === "OPEN" && snapshot.competition.phase === "LIVE";
  const feedLabel = origin === "live"
    ? (freshness.stale ? "Latest published account snapshot" : "Live published account snapshot")
    : "Verified launch snapshot";

  return (
    <section className="live-competition" id="live" aria-labelledby="live-title">
      <div className="shell">
        <div className="live-section-heading">
          <div>
              <p className="kicker">Practice account / live competition</p>
              <h2 id="live-title">Watch Finly's $100,000 paper-trading account.</h2>
          </div>
          <p>
            A paper account follows real market prices without using real money. This dashboard shows the latest safe
            Alpaca account summary. It starts at $100,000 and is separate from the historical replay below.
          </p>
        </div>

        <article className="competition-board" aria-label="Latest official paper-account result">
          <header className="competition-board-header">
            <div className="live-status-lockup">
              <span className={`live-status-dot ${marketIsLive && !freshness.stale ? "is-live" : ""}`} aria-hidden="true" />
              <div>
                <strong>{feedLabel}</strong>
                <span>{marketStatusCopy(snapshot)}</span>
              </div>
            </div>
            <div className="live-refresh-lockup">
              <time dateTime={snapshot.snapshot_at}>{freshness.label}</time>
              <button type="button" onClick={() => { void refresh(); }} disabled={isRefreshing}>
                {isRefreshing ? "Checking…" : "Refresh now"}
              </button>
            </div>
          </header>

          {origin === "fallback" && (
            <p className="live-fallback-note" role="status">
              The cloud feed is between updates, so this view is showing Finly's verified launch snapshot.
            </p>
          )}

          <section className="first-close-proof" aria-labelledby="first-close-proof-title">
            <div className="first-close-proof-copy">
              <p className="kicker">Official day-one score · locked at 4:00 p.m.</p>
              <h3 id="first-close-proof-title">
                Finly finished its first paper-trading session {moneyExact.format(firstCloseMeasurement.secondary_kpi.excess_pnl_dollars)} ahead of SPY.
              </h3>
              <p>
                Both started at $100,000 and were valued at the same closing-bell price. Finly gained $95.32;
                SPY, a fund that tracks the S&amp;P 500, lost $57.99. No options position was open at that close.
              </p>
              <a href="./data/competition_forward_profit_2026_08_31.json">
                Inspect the read-only measurement
              </a>
            </div>
            <dl className="first-close-proof-metrics">
              <div>
                <dt>Finly</dt>
                <dd>{signedMoneyExact.format(firstCloseMeasurement.primary_kpi.net_pnl_dollars)}</dd>
                <p>Virtual-money gain or loss</p>
              </div>
              <div>
                <dt>SPY</dt>
                <dd>{signedMoneyExact.format(firstCloseMeasurement.benchmark.ending_value_on_same_baseline_dollars - 100_000)}</dd>
                <p>S&amp;P 500 tracker at 4:00 p.m.</p>
              </div>
              <div className="first-close-proof-win">
                <dt>Finly advantage</dt>
                <dd>{signedMoneyExact.format(firstCloseMeasurement.secondary_kpi.excess_pnl_dollars)}</dd>
                <p>At the closing bell</p>
              </div>
            </dl>
            <p className="first-close-proof-note">
              Locked first-day paper result · 4:00 p.m. ET on August 31, 2026 · same starting balance and timestamp ·
              15 broker fill events · no deposits or withdrawals. This is the locked day-one score, not the changing account mark below.
            </p>
          </section>

          <div className="current-mark-heading">
            <div>
              <p className="kicker">Latest account mark · changes with market prices</p>
              <h3>Where the $100,000 paper account stands now.</h3>
            </div>
            <p>
              This later account value can move as Alpaca re-prices the four funds. It is not the locked day-one score above.
            </p>
          </div>

          <div className="live-scorecard">
            <div className="live-equity-block">
              <p>Latest published account value</p>
              <strong>{money.format(snapshot.account.equity)}</strong>
              <span>Measured against a {money.format(snapshot.competition.baseline_equity)} starting balance.</span>
            </div>
            <div className={`live-pnl-block live-pnl-${resultTone}`}>
              <p>Change since the $100,000 start</p>
              <div>
                <strong>{signedMoney.format(result.pnl)}</strong>
                <span>{signedPercent.format(result.pnlPercent)}</span>
              </div>
              <small>Changing account mark · separate from the locked first-session comparison above.</small>
            </div>
          </div>

          <div className="live-decision-story">
            <div>
              <p className="kicker">What Finly is doing now</p>
              <h3>{decisionStory.headline}</h3>
            </div>
            <p>{decisionStory.explanation}</p>
          </div>

          <dl className="live-operating-metrics">
            <div>
              <dt>Currently in the base portfolio</dt>
              <dd>{money.format(snapshot.exposure.g4_equity_market_value_dollars)}</dd>
              <p>{snapshot.exposure.g4_equity_positions === 0 ? "The core portfolio is waiting in cash." : `Across ${snapshot.exposure.g4_equity_positions} diversified fund position${snapshot.exposure.g4_equity_positions === 1 ? "" : "s"}.`}</p>
            </div>
            <div>
              <dt>Options maximum loss</dt>
              <dd>{money.format(snapshot.exposure.options_defined_risk_dollars)}</dd>
              <p>{snapshot.exposure.option_positions === 0 && snapshot.exposure.option_open_orders === 0 ? "No options trade is open right now." : "The open options trade has a fixed, pre-calculated maximum loss."}</p>
            </div>
            <div>
              <dt>Per-trade risk ceiling</dt>
              <dd>{money.format(snapshot.exposure.per_trade_risk_limit_dollars)}</dd>
              <p>Finly cannot authorize a new trade above this limit.</p>
            </div>
            <div>
              <dt>Cash available</dt>
              <dd>{money.format(snapshot.account.cash)}</dd>
              <p>{snapshot.exposure.open_orders === 0 ? "There are no open paper orders." : `${snapshot.exposure.open_orders} paper order${snapshot.exposure.open_orders === 1 ? " is" : "s are"} awaiting completion.`}</p>
            </div>
          </dl>

          <details className="live-technical-record">
            <summary>Technical details for judges</summary>
            <dl>
              <div>
                <dt>Data source</dt>
                <dd>{snapshot.integrity.source}</dd>
              </div>
              <div>
                <dt>Decision state</dt>
                <dd>{snapshot.decision.status.replaceAll("_", " ").toLowerCase()}</dd>
              </div>
              <div>
                <dt>Decision code</dt>
                <dd>{snapshot.decision.code}</dd>
              </div>
              <div>
                <dt>Market state</dt>
                <dd>{snapshot.market.status.toLowerCase()}</dd>
              </div>
              <div>
                <dt>Open positions / orders</dt>
                <dd>{snapshot.exposure.open_positions} / {snapshot.exposure.open_orders}</dd>
              </div>
              <div>
                <dt>Equity / options positions</dt>
                <dd>{snapshot.exposure.g4_equity_positions} / {snapshot.exposure.option_positions}</dd>
              </div>
              <div>
                <dt>Aggregate risk ceiling</dt>
                <dd>{money.format(snapshot.exposure.aggregate_risk_limit_dollars)}</dd>
              </div>
              <div>
                <dt>Account check</dt>
                <dd>{snapshot.integrity.account_verified ? "Verified and paper-only" : "Pending verification"}</dd>
              </div>
              <div>
                <dt>Published at</dt>
                <dd>{easternFormatter.format(new Date(snapshot.snapshot_at))} ET</dd>
              </div>
            </dl>
          </details>
        </article>

        <p className="live-privacy-note">
          This public view contains performance and risk totals only. It never publishes broker credentials, account numbers,
          order identifiers or the private execution log. <a href="./data/competition-deployment-record.json">Read the
          technical record showing when the competition portfolio was chosen and locked.</a>
        </p>
      </div>
    </section>
  );
}
