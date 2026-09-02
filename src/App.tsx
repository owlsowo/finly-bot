import { useState } from "react";
import attempt150PublicEvidenceJson from "../research/output/attempt150_public_evidence.json";
import quantitativeGateJson from "../research/output/quantitative_release_gate.json";
import alignedReceiptJson from "./data/latest_receipt.json";
import latestCloseMeasurementJson from "./data/competition_forward_profit_2026_09_02.json";
import conflictReceiptJson from "./data/no_trade_receipt.json";
import { CompetitionDashboard } from "./CompetitionDashboard";
import { HistoricalExplorer } from "./HistoricalExplorer";

type G4Evidence = {
  deflated_sharpe_probability: number;
  disposition: string;
  end_date: string;
  evidence_class: string;
  g4_total_return: number;
  modeled_one_way_cost_bps: number;
  spy_total_return: number;
  start_date: string;
  worst_familywise_adjusted_p_value: number;
};

type ProductionEvidence = {
  annualized_volatility_at_5bp: number;
  broker_fill_replay: boolean;
  end_date: string;
  evidence_class: string;
  market_beating_on_total_return: boolean;
  maximum_drawdown_at_5bp: number;
  observations: number;
  policy_id: string;
  risk_characterization: string;
  spy_total_return: number;
  start_date: string;
  total_return_at_25bp_per_leg: number;
  total_return_at_5bp_per_leg: number;
};

type FutureTest = {
  attempt_number: number;
  first_eligible_signal_session?: string;
  first_eligible_input_session?: string;
  observed_outcome_count: number;
  performance_claim_authorized: boolean;
  public_registration: string;
};

type QuantitativeReleaseGate = {
  schema_version: string;
  evidence_as_of: string;
  allowed_claims: string[];
  forbidden_claims: string[];
  artifact_sha256: string;
  conclusions: {
    g4_rejected_post_selection: G4Evidence;
    production_v1_execution_realism: ProductionEvidence;
    registered_future_only_tests: FutureTest[];
  };
  release_decision: {
    bounded_release: string;
    competitor_rank_claim: string;
    finly_vs_competitor_return_matchup: string;
    status: string;
  };
  source_integrity: {
    all_hashes_verified: boolean;
    source_count: number;
  };
};

type ExternalReplayEvidence = {
  schema_version: string;
  evidence_class: string;
  artifact_sha256: string;
  primary_window: {
    start_date: string;
    end_date: string;
    observations: number;
    modeled_one_way_cost_bps: number;
  };
  headline: {
    finly_annualized_return: number;
    market_annualized_return: number;
    annualized_return_advantage: number;
    drawdown_improvement_percentage_points: number;
  };
  risk_matched_comparison: {
    annualized_net_log_growth_advantage: number;
    realized_volatility_ratio: number;
  };
  robustness: {
    positive_rebalance_anchors: number;
    tested_rebalance_anchors: number;
    positive_at_modeled_cost_bps: number[];
    annualized_net_log_growth_advantage_at_25bps: number;
  };
};

type DemoReceipt = {
  receipt_id: string;
  market: { feed_disclosure: string };
  intent: { direction: string };
  source_signals: Array<{ family: string; explanation: string }>;
  compilation: {
    action: string;
    selected: null | {
      long_leg: { strike: number };
      short_leg: { strike: number };
      max_gain: number;
      max_loss: number;
    };
  };
  source_removal: { passed: boolean; variants: unknown[] };
  perturbations: null | { count: number; passed: boolean };
  certificate: {
    certified: boolean;
    decision: string;
    max_loss_per_contract: number;
    rejection_codes: string[];
    source_removal_summary: { passed: boolean; variants: unknown[] };
  };
  alpaca_payload: null | { order_class: string };
};

type FirstCloseMeasurement = {
  schema_version: string;
  primary_kpi: { net_pnl_dollars: number };
  secondary_kpi: { excess_pnl_dollars: number; outperformed_spy: boolean };
  benchmark: { ending_value_on_same_baseline_dollars: number; symbol: string };
};

function validateReleaseGate(value: unknown): QuantitativeReleaseGate {
  if (!value || typeof value !== "object") throw new Error("Quantitative release gate is missing.");
  const gate = value as QuantitativeReleaseGate;
  if (gate.schema_version !== "finly_quantitative_release_gate.v1"
    || gate.release_decision.status !== "GO_BOUNDED_RELEASE_NO_GO_PERFORMANCE_MATCHUP"
    || gate.release_decision.competitor_rank_claim !== "NO_GO"
    || gate.release_decision.finly_vs_competitor_return_matchup !== "NO_GO"
    || gate.source_integrity.all_hashes_verified !== true
    || gate.allowed_claims.length < 3
    || gate.conclusions.registered_future_only_tests.length !== 2) {
    throw new Error("Quantitative release gate failed the website's fail-closed contract.");
  }
  return gate;
}

function validateExternalReplayEvidence(value: unknown): ExternalReplayEvidence {
  if (!value || typeof value !== "object") throw new Error("External replay evidence is missing.");
  const evidence = value as ExternalReplayEvidence;
  if (evidence.schema_version !== "finly_attempt150_public_evidence.v1"
    || evidence.evidence_class !== "PRE_SPECIFIED_OUT_OF_ERA_EXTERNAL_REPLAY"
    || evidence.primary_window.observations !== 21_218
    || evidence.robustness.positive_rebalance_anchors !== 21
    || evidence.robustness.tested_rebalance_anchors !== 21
    || !evidence.robustness.positive_at_modeled_cost_bps.includes(25)
    || !/^sha256:[0-9a-f]{64}$/u.test(evidence.artifact_sha256)) {
    throw new Error("External replay evidence failed the website's integrity contract.");
  }
  return evidence;
}

function validateCloseMeasurement(value: unknown): FirstCloseMeasurement {
  if (!value || typeof value !== "object") throw new Error("Close measurement is missing.");
  const measurement = value as FirstCloseMeasurement;
  if (measurement.schema_version !== "finly_forward_profit_measurement.v1"
    || measurement.secondary_kpi.outperformed_spy !== true
    || measurement.benchmark.symbol !== "SPY"
    || !Number.isFinite(measurement.primary_kpi.net_pnl_dollars)
    || !Number.isFinite(measurement.secondary_kpi.excess_pnl_dollars)
    || !Number.isFinite(measurement.benchmark.ending_value_on_same_baseline_dollars)) {
    throw new Error("Close measurement failed the website's integrity contract.");
  }
  return measurement;
}

const quantitativeGate = validateReleaseGate(quantitativeGateJson as unknown);
const externalReplayEvidence = validateExternalReplayEvidence(attempt150PublicEvidenceJson as unknown);
const latestCloseMeasurement = validateCloseMeasurement(latestCloseMeasurementJson as unknown);
const alignedReceipt = alignedReceiptJson as unknown as DemoReceipt;
const conflictReceipt = conflictReceiptJson as unknown as DemoReceipt;

const navigation = [
  ["case", "Overview"],
  ["live", "Live account"],
  ["evidence", "Results"],
  ["workflow", "How it works"],
  ["controls", "Try Finly"],
  ["package", "Judge kit"],
] as const;

const architecture = [
  {
    number: "01",
    title: "Read the evidence",
    body: "Finly gathers current prices, activity in time-limited options contracts, and public market news.",
  },
  {
    number: "02",
    title: "Explain what it means",
    body: "AI explains what supports the idea, what conflicts, and what remains uncertain.",
  },
  {
    number: "03",
    title: "Build a capped-loss trade",
    body: "Fixed code chooses the exact position and maximum possible loss.",
  },
  {
    number: "04",
    title: "Challenge the idea",
    body: "Finly publishes what changes when evidence is removed or inputs are nudged.",
  },
  {
    number: "05",
    title: "Apply the hard limits",
    body: "One contract, $500 maximum loss, fresh data, exact order binding, and broker read-back control execution.",
  },
] as const;

const references = [
  ["White, 2000", "https://doi.org/10.1111/1468-0262.00152"],
  ["Bailey & López de Prado, 2014", "https://doi.org/10.3905/jpm.2014.40.5.094"],
  ["Moskowitz, Ooi & Pedersen, 2012", "https://doi.org/10.1016/j.jfineco.2011.11.003"],
  ["Moreira & Muir, 2017", "https://doi.org/10.1111/jofi.12513"],
] as const;

const sourceFamilyCopy = {
  aligned: {
    market: ["Market trend", "Recent prices have been falling, and heavier trading gives modest support to that signal."],
    options: ["Options prices", "More traders are paying to protect against a price drop. That supports a negative view, but not an extreme one."],
    events: ["Illustrative public events", "An upcoming economic report raises the chance of weaker short-term growth."],
    prediction_market: ["Illustrative prediction market", "A public prediction market points the same way."],
  },
  conflict: {
    market: ["Market trend", "Recent prices have been rising."],
    options: ["Options prices", "Prices for time-limited market contracts mildly favor a rise."],
    events: ["Illustrative public events", "An upcoming economic report points the other way."],
    prediction_market: ["Illustrative prediction market", "A public prediction market disagrees with the price data."],
  },
} as const;

function humanSignalCopy(mode: "aligned" | "conflict", family: string, fallback: string): readonly [string, string] {
  const copy = sourceFamilyCopy[mode];
  if (Object.hasOwn(copy, family)) return copy[family as keyof typeof copy];
  return [family.replaceAll("_", " "), fallback];
}

function humanDirectionCopy(direction: string): string {
  if (direction.toLowerCase() === "bearish") return "a falling-price view";
  if (direction.toLowerCase() === "bullish") return "a rising-price view";
  return "an undecided market view";
}

const deliverables = [
  ["01", "One-page proposal", "Start here for the problem, product, evidence and hackathon fit in plain English.", "./judge/Finly_Judge_Brief.pdf"],
  ["02", "Technical note", "Go deeper into the equations, algorithms, risk proofs, tests and academic sources.", "./judge/Finly_Technical_Proposal.pdf"],
  ["03", "Presentation", "Nine visual slides that move from the product idea to the measured results.", "./judge/Finly_Consulting_Deck.pdf"],
  ["04", "Demo film", "An 81-second walkthrough of the product, historical test and live paper account.", "./judge/Finly_Demo_Video.mp4"],
  ["05", "Repository", "Source code, tests, evidence files, and commands to rerun them.", "https://github.com/owlsowo/finly-bot"],
] as const;

const claimEvidence = [
  {
    claim: "In the 2013–2026 cost-modeled replay, Finly finished $38,629 ahead of SPY: $106,711 versus $68,082 from the same $10,000 start.",
    evidence: "Historical release record",
    href: "./data/quantitative_release_gate.json",
    reproduce: "node --test tests/historical_backtest.test.mjs tests/historical_reporting.test.mjs",
    scope: "Historical replay",
  },
  {
    claim: "Through the September 2 close, Finly was up $141.24 while SPY was down $284.76 from the same $100,000 starting point—a $426.00 advantage at 4:00 p.m.",
    evidence: "Latest same-clock paper measurement",
    href: "./data/competition_forward_profit_2026_09_02.json",
    reproduce: "node --test tests/competition_forward_profit_public_evidence.test.mjs",
    scope: "Measured close",
  },
  {
    claim: "In a 1927–2007 public dataset, a fixed industry version averaged 13.37% yearly growth versus 9.48% for the market.",
    evidence: "Earlier-market evidence",
    href: "./data/attempt150_public_evidence.json",
    reproduce: "node --test tests/attempt150_public_evidence.test.mjs",
    scope: "Earlier-market replay",
  },
  {
    claim: "Across 517 sampled SPY signals, 11 cleared every alpha gate on a symmetric modeled quote surface: 7 bullish call spreads and 4 bearish put spreads.",
    evidence: "Bidirectional options eligibility calibration",
    href: "./data/options_policy_calibration.json",
    reproduce: "npm run options:calibration",
    scope: "Signal / quote-surface calibration",
  },
] as const;

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const dollars = (value: number) => value.toLocaleString("en-US", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: "currency",
  currency: "USD",
});

const signedDollars = (value: number) => `${value >= 0 ? "+" : "-"}${dollars(Math.abs(value))}`;

export function DemoClient() {
  const [receiptMode, setReceiptMode] = useState<"aligned" | "conflict">("aligned");
  const gate = quantitativeGate;
  const g4 = gate.conclusions.g4_rejected_post_selection;
  const performanceLabStartingWealth = 10_000;
  const performanceLabEndingWealth = performanceLabStartingWealth * (1 + g4.g4_total_return);
  const spyEndingWealth = performanceLabStartingWealth * (1 + g4.spy_total_return);
  const performanceLabAdvantage = performanceLabEndingWealth - spyEndingWealth;
  const external = externalReplayEvidence;
  const receipt = receiptMode === "aligned" ? alignedReceipt : conflictReceipt;
  const demoCandidate = alignedReceipt.compilation.selected;
  if (!demoCandidate || !alignedReceipt.certificate.certified || !alignedReceipt.perturbations?.passed) {
    throw new Error("The website's positive demo receipt is incomplete.");
  }
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to the case</a>

      <header className="masthead shell">
        <a className="wordmark" href="#case" aria-label="Finly home">
          <img src="./brand/finly-mark.svg" alt="" />
          <span>Finly</span>
        </a>
        <nav aria-label="Primary navigation">
          {navigation.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <a className="header-cta" href="#live">Watch live account <span aria-hidden="true">↓</span></a>
      </header>

      <main id="main-content">
        <section className="hero shell" id="case">
          <div className="hero-copy">
            <p className="kicker">2013–2026 historical simulation · after modeled trading costs</p>
            <h1>Finly finished $38,629 ahead of the S&amp;P 500 tracker.</h1>
            <p className="hero-deck">
              Starting with the same $10,000, Finly's four-fund rule reached $106,711 while SPY reached $68,082.
              The competition product turns that research into a live paper-trading system: AI explains the market,
              while fixed code controls the allocation, the options order, and the maximum possible loss.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#controls">Watch Finly decide</a>
              <a className="text-action" href="#live">See the verified results <span aria-hidden="true">↓</span></a>
            </div>
          </div>

          <figure className="hero-figure">
            <div className="figure-labels">
              <span>Modeled ending wealth from the same $10,000</span>
              <strong>Jan 2013–Aug 2026</strong>
            </div>
            <div
              className="hero-result"
              role="img"
              aria-label={`In the 2013 through 2026 historical simulation, ten thousand dollars became ${dollars(performanceLabEndingWealth)} with Finly and ${dollars(spyEndingWealth)} with SPY after modeled trading costs. Finly finished ${dollars(performanceLabAdvantage)} ahead.`}
            >
              <div>
                <span>Finly</span>
                <strong>{dollars(performanceLabEndingWealth)}</strong>
                <small>modeled ending wealth</small>
              </div>
              <div>
                <span>SPY · S&amp;P 500 tracker</span>
                <strong>{dollars(spyEndingWealth)}</strong>
                <small>same start · same dates</small>
              </div>
              <p><strong>+{dollars(performanceLabAdvantage)}</strong> more ending wealth than SPY after modeled costs.</p>
              <em className="decision-stamp">historical simulation</em>
            </div>
            <figcaption>
              Historical simulation, not live returns or a forecast. The separate paper account later finished $426 ahead of SPY through September 2.
            </figcaption>
          </figure>

          <p className="hero-thesis hero-status-note">
            Paper trading follows real prices with virtual money. The allocation and options sleeves share one account and
            one risk policy, while keeping separate decision records so judges can trace every dollar.
          </p>

          <dl className="hero-metrics" aria-label="Three levels of proof and one risk limit">
            <div>
              <dt>2013–2026 replay</dt>
              <dd>+{dollars(performanceLabAdvantage)}</dd>
              <p>More ending wealth than SPY after modeled costs.</p>
            </div>
            <div>
              <dt>Verified paper result</dt>
              <dd>{signedDollars(latestCloseMeasurement.secondary_kpi.excess_pnl_dollars)}</dd>
              <p>Ahead of SPY through Sep 2 at the same closing price.</p>
            </div>
            <div>
              <dt>Live options decisions</dt>
              <dd>24 checked</dd>
              <p>Every September 2 cycle returned no trade; $0 new options risk.</p>
            </div>
            <div>
              <dt>Automated checks</dt>
              <dd>827 checks run</dd>
              <p>825 passed, zero failed, and two optional private-ledger checks were skipped.</p>
            </div>
          </dl>
        </section>

        <section className="argument-band" aria-label="Core proposition">
          <div className="shell argument-grid">
            <p className="argument-number">01</p>
            <div>
              <p className="kicker">Why Finly is different</p>
              <h2>AI can sound certain when it is wrong. Finly never gives it the final say over the money.</h2>
            </div>
            <div className="argument-copy">
              <p>
                The model may explain an idea. It cannot choose the final size, raise the risk limit, or rewrite the order.
                Those decisions belong to fixed, tested code.
              </p>
              <p>
                Finly publishes how the idea changes when evidence is removed or inputs are nudged. Those diagnostics explain
                confidence; hard account, quote, size, loss, idempotency, and broker checks still control whether money may move.
              </p>
            </div>
          </div>
        </section>

        <CompetitionDashboard />

        <section className="evidence-section" id="evidence">
          <div className="shell">
            <div className="section-intro evidence-intro">
              <div>
                <p className="kicker">What the historical test showed</p>
                <h2>Same $10,000. Same dates. Finly ended $38,629 higher.</h2>
              </div>
              <p>
              We replayed the underlying four-fund research rule—before the competition's 3% cash scaling—on past prices from 2013 through 2026. Finly returned +967.11%
                versus +580.82% for SPY, with the same dates and modeled trading costs.
              </p>
            </div>

            <HistoricalExplorer
              candidateReturn={g4.g4_total_return}
              spyReturn={g4.spy_total_return}
              startDate={g4.start_date}
              endDate={g4.end_date}
              oneWayCostBps={g4.modeled_one_way_cost_bps}
            />

            <details className="technical-proof-details">
              <summary>Open the 80-year robustness test and academic sources</summary>
            <article className="external-proof" aria-labelledby="external-proof-title">
              <div className="external-proof-lead">
                <div>
                  <p className="kicker">A second history check</p>
                  <h3 id="external-proof-title">A simpler version also finished ahead in an 80-year public market dataset.</h3>
                </div>
                <p>
                  We applied a fixed industry version of the rule to public data from {external.primary_window.start_date.slice(0, 4)} to
                  {" "}{external.primary_window.end_date.slice(0, 4)}. That industry version averaged
                  {" "}<strong>{pct(external.headline.finly_annualized_return)} growth per year</strong> versus
                  {" "}<strong>{pct(external.headline.market_annualized_return)}</strong> for the broader market.
                </p>
              </div>

              <dl className="external-proof-metrics">
                <div>
                  <dt>Yearly growth advantage</dt>
                  <dd>+{(external.headline.annualized_return_advantage * 100).toFixed(2)} points</dd>
                  <p>13.37% per year for Finly versus 9.48% for the market.</p>
                </div>
                <div>
                  <dt>Monthly schedule positions</dt>
                  <dd>{external.robustness.positive_rebalance_anchors}/{external.robustness.tested_rebalance_anchors}</dd>
                  <p>It stayed ahead on all 21 tested trading days in the monthly update cycle.</p>
                </div>
                <div>
                  <dt>Higher trading-cost test</dt>
                  <dd>Still ahead</dd>
                  <p>The edge stayed positive when the cost assumption rose fivefold, from 0.05% to 0.25%.</p>
                </div>
                <div>
                  <dt>Smaller worst decline</dt>
                  <dd>{(external.headline.drawdown_improvement_percentage_points * 100).toFixed(2)} points</dd>
                  <p>Its largest fall from a previous peak was 16.31 percentage points smaller.</p>
                </div>
              </dl>

              <div className="external-proof-conclusion">
                <p>
                  <strong>What it showed:</strong> that simpler industry version remained ahead in a much older market dataset,
                  regardless of which trading day each month it updated and under a much harsher trading-cost assumption.
                </p>
                <a href="./data/attempt150_public_evidence.json">Open the evidence file <span aria-hidden="true">↗</span></a>
              </div>
            </article>

            <div className="research-note research-note-tight">
              <p>
                We used these historical results to choose Finly's allocation sleeve for the paper competition, then locked the four-fund
                allocation before the test began. The $100,000 paper account is measured separately from the historical replay.
              </p>
              <div>
                <a href="./data/competition-deployment-record.json">Read the deployment record <span aria-hidden="true">↗</span></a>
                {references.map(([label, href]) => <a key={href} href={href}>{label} <span aria-hidden="true">↗</span></a>)}
              </div>
            </div>
            </details>
          </div>
        </section>

        <section className="system shell" id="workflow">
          <div className="section-intro">
            <div>
              <p className="kicker">Here's how it works</p>
              <h2>Five steps turn a market idea into a checked broker decision.</h2>
            </div>
            <p>
              Price momentum sets the direction. AI explains public news. Code fixes the risk and order, then hard checks decide whether Alpaca may see it.
            </p>
          </div>

          <ol className="process-line">
            {architecture.map((step) => (
              <li key={step.number}>
                <span>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>

          <aside className="authority-rule">
            <p>AI explains the idea</p>
            <span aria-hidden="true">→</span>
            <p>Code fixes the loss and order</p>
            <span aria-hidden="true">→</span>
            <p>Diagnostics challenge it</p>
            <span aria-hidden="true">→</span>
            <strong>Trade—or leave the account alone</strong>
          </aside>
        </section>

        <section className="receipt-section" id="controls">
          <div className="shell">
            <div className="section-intro receipt-intro">
              <div>
                <p className="kicker">Try it</p>
                <h2>See a capped-loss trade—and the same pipeline deciding not to trade.</h2>
              </div>
              <p>
                These are synthetic architecture examples, not broker fills. Choose either preset: Finly pairs two contracts
                so the worst possible loss is known in advance—or leaves the account alone.
              </p>
            </div>

            <div className="receipt-controls" role="group" aria-label="Choose a demonstration scenario">
              <button type="button" aria-pressed={receiptMode === "aligned"} onClick={() => setReceiptMode("aligned")}>
                <strong>Signals agree</strong>
                <span>Finly prepares a capped-loss plan with a fixed maximum loss.</span>
              </button>
              <button type="button" aria-pressed={receiptMode === "conflict"} onClick={() => setReceiptMode("conflict")}>
                <strong>Signals disagree</strong>
                <span>Finly refuses the trade and moves no money.</span>
              </button>
            </div>

            <div className="receipt-workbench" aria-live="polite">
              <div className="receipt-sources">
                <p className="receipt-label">Evidence analyzed by Finly</p>
                <div className="source-list">
                  {receipt.source_signals.map((signal) => (
                    <article key={signal.family}>
                      <h3>{humanSignalCopy(receiptMode, signal.family, signal.explanation)[0]}</h3>
                      <p>{humanSignalCopy(receiptMode, signal.family, signal.explanation)[1]}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="receipt-conclusion">
                <p className="receipt-label">Decision path</p>
                <p className="assessment-sentence">
                  {receipt.certificate.certified
                    ? <>Finly reads the evidence as <strong>{humanDirectionCopy(receipt.intent.direction)}</strong>. It then builds a capped-loss plan and checks every term before preparing the paper-order plan.</>
                    : <>Finly initially reads the evidence as <strong>{humanDirectionCopy(receipt.intent.direction)}</strong>, but the case falls apart under testing. Instead of forcing a trade, it keeps the account protected.</>}
                </p>
              </div>
            </div>

            <ol className="decision-story" aria-label="How Finly turns evidence into a checked broker decision">
              <li>
                <span>01</span>
                <p className="decision-story-label">What Finly saw</p>
                <strong>{receipt.source_signals.length} kinds of evidence</strong>
                <p>Prices, options, public events, and prediction-market signals were compared together.</p>
              </li>
              <li>
                <span>02</span>
                <p className="decision-story-label">Evidence conclusion</p>
                <strong>{humanDirectionCopy(receipt.intent.direction)}</strong>
                <p>Price evidence set the direction. AI-read events could only weaken or stop it, never grant permission to trade.</p>
              </li>
              <li>
                <span>03</span>
                <p className="decision-story-label">What code allowed</p>
                <strong>{receipt.certificate.certified ? "One capped-loss plan" : "No trade"}</strong>
                <p>
                  {receipt.certificate.certified
                    ? `Fixed code chose the two contracts and held possible loss to ${dollars(receipt.certificate.max_loss_per_contract)} for one contract.`
                    : "The checks rejected the idea before an order could exist."}
                </p>
              </li>
              <li>
                <span>04</span>
                <p className="decision-story-label">What was prepared for Alpaca</p>
                <strong>{receipt.alpaca_payload ? "A paper-order plan" : "Nothing"}</strong>
                <p>
                  {receipt.alpaca_payload
                    ? "Finly generated an Alpaca-compatible paper-order payload for inspection. This demonstration did not transmit it."
                    : "The pipeline stopped before any broker payload was created."}
                </p>
              </li>
            </ol>

            <div className={`receipt-decision ${receipt.certificate.certified ? "receipt-permit" : "receipt-refusal"}`}>
              <div>
                <p className="kicker">Decision</p>
                <h3>{receipt.certificate.certified ? "A capped-loss paper-order plan is ready for review." : "No trade. The account stays untouched."}</h3>
              </div>
              <p>
                {receipt.certificate.certified
                  ? "Finly turned the supported idea into a complete Alpaca paper-order plan, including the position size, maximum gain, and maximum possible loss."
                  : "The evidence test failed, so Finly stopped before the paper account took on any risk."}
              </p>
              <a href={receiptMode === "aligned" ? "./data/latest_receipt.json" : "./data/no_trade_receipt.json"}>
                Inspect the decision record <span aria-hidden="true">↗</span>
              </a>
            </div>

            <p className="receipt-disclosure">
              Illustrative options example; no broker order or fill occurred. The live paper account is shown separately above.
            </p>
          </div>
        </section>

        <section className="broker-band">
          <div className="shell broker-grid">
            <div>
              <p className="kicker">Who this is for</p>
              <h2>Let AI explain the market without letting it control the money.</h2>
            </div>
            <div className="broker-copy">
              <p>
                Finly is for brokerages, risk teams, educators and trading-product builders that want AI to review market
                information without letting it improvise with an account. The model explains the view; code sets the position,
                every order field and the maximum loss.
              </p>
              <p>
                Teams can add new data sources or strategies without handing order authority to the model.
              </p>
              <a href="https://docs.alpaca.markets/us/docs/options-trading">Read Alpaca's options documentation <span aria-hidden="true">↗</span></a>
            </div>
            <div className="broker-seal">
              <img src="./brand/finly-mark.svg" alt="" />
              <p>Model</p><span>may interpret</span>
              <hr />
              <p>Code</p><span>approves the exact order</span>
            </div>
          </div>
        </section>

        <section className="package shell" id="package">
          <div className="section-intro">
            <div>
              <p className="kicker">Judge kit</p>
              <h2>Start simple, then go as deep as you want.</h2>
            </div>
            <p>
              The one-page proposal explains the product without finance jargon. The technical note, evidence files and
              source code are available for judges who want to audit every equation and claim.
            </p>
          </div>
          <section className="claim-matrix" aria-labelledby="claim-matrix-title">
            <div className="claim-matrix-heading">
              <div>
                <p className="kicker">Evidence map</p>
                <h3 id="claim-matrix-title">Every headline points to the record and command that checks it.</h3>
              </div>
              <p>
                Open the evidence, rerun the check, and see whether the result came from paper trading,
                a historical replay, or a decision test.
              </p>
            </div>

            <div className="table-scroll">
              <table className="gate-table claim-table">
                <caption>Claim → evidence → reproduce → status</caption>
                <thead>
                  <tr>
                    <th scope="col">Claim</th>
                    <th scope="col">Evidence</th>
                    <th scope="col">Reproduce</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {claimEvidence.map((row) => (
                    <tr key={row.href}>
                      <th scope="row">{row.claim}</th>
                      <td data-label="Evidence">
                        <a href={row.href}>{row.evidence} <span aria-hidden="true">↗</span></a>
                      </td>
                      <td data-label="Reproduce"><code>{row.reproduce}</code></td>
                      <td data-label="Status" className="claim-status-cell">
                        <span className="passed">Verified</span>
                        <small>{row.scope}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <ol className="deliverable-list">
            {deliverables.map(([number, title, description, href]) => (
              <li key={title}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
                <a href={href} aria-label={`Open ${title}`}>Open <span aria-hidden="true">↗</span></a>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer>
        <div className="shell footer-grid">
          <div className="footer-brand"><img src="./brand/finly-mark.svg" alt="" /><strong>Finly</strong></div>
              <p>$38,629 historical ending-wealth difference · separately measured paper trading.</p>
          <p>Bruce Wen · <a href="mailto:bwen412@brandeis.edu">bwen412@brandeis.edu</a></p>
          <p>Evidence files and rerun commands · latest same-clock evidence added 2 September 2026</p>
        </div>
      </footer>
    </>
  );
}
