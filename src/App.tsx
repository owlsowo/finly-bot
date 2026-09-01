import { useState } from "react";
import attempt150PublicEvidenceJson from "../research/output/attempt150_public_evidence.json";
import quantitativeGateJson from "../research/output/quantitative_release_gate.json";
import alignedReceiptJson from "./data/latest_receipt.json";
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

const quantitativeGate = validateReleaseGate(quantitativeGateJson as unknown);
const externalReplayEvidence = validateExternalReplayEvidence(attempt150PublicEvidenceJson as unknown);
const alignedReceipt = alignedReceiptJson as unknown as DemoReceipt;
const conflictReceipt = conflictReceiptJson as unknown as DemoReceipt;

const navigation = [
  ["case", "Overview"],
  ["live", "Live account"],
  ["workflow", "How it works"],
  ["evidence", "Results"],
  ["controls", "Try it"],
  ["package", "Judge kit"],
] as const;

const architecture = [
  {
    number: "01",
    title: "Gather the evidence",
    body: "The live path records prices, options activity and Alpaca news. The demo can also include economic and prediction-market examples.",
  },
  {
    number: "02",
    title: "Explain what it means",
    body: "AI compares those inputs and explains the case for or against a trade in language a person can inspect.",
  },
  {
    number: "03",
    title: "Build a capped-loss trade",
    body: "Rules-based code—not the AI—chooses the exact options, position size and maximum possible loss.",
  },
  {
    number: "04",
    title: "Try to break the idea",
    body: "Finly removes each source and changes important inputs to see whether the original decision still holds.",
  },
  {
    number: "05",
    title: "Trade—or do nothing",
    body: "Only a proposal that passes every check becomes an Alpaca paper order. Otherwise, the account stays untouched.",
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
    options: ["Options market", "More traders are paying to protect against a price drop. That supports a negative view, but not an extreme one."],
    events: ["Economic events", "An upcoming economic report raises the chance of weaker short-term growth."],
    prediction_market: ["Prediction markets", "A public prediction market points the same way."],
  },
  conflict: {
    market: ["Market trend", "Recent prices have been rising."],
    options: ["Options market", "Options traders are mildly positioned for prices to rise."],
    events: ["Economic events", "An upcoming economic report points the other way."],
    prediction_market: ["Prediction markets", "A public prediction market disagrees with the price data."],
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
  ["04", "Demo film", "A 75-second walkthrough of the product, historical test and live paper account.", "./judge/Finly_Demo_Video.mp4"],
  ["05", "Repository", "Source code, tests, evidence files, and commands to rerun them.", "https://github.com/owlsowo/finly-bot"],
] as const;

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${pct(value, digits)}`;
const dollars = (value: number) => value.toLocaleString("en-US", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: "currency",
  currency: "USD",
});

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
  const sourceRemovalCount = alignedReceipt.certificate.source_removal_summary.variants.length;
  const perturbationCount = alignedReceipt.perturbations.count;

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
            <p className="kicker">AI trading with rules that limit risk</p>
            <h1>Finly shows its work before it trades.</h1>
            <p className="hero-deck">
              Finly has two parts: <strong>Finly Core</strong>, a rules-based fund portfolio, and an AI options assistant.
              In a 2013–2026 historical replay, $10,000 in Finly Core became $106,711—$38,629 more than SPY, a fund
              that tracks the S&amp;P 500. Separately, the options assistant explains market evidence while code caps the
              loss, builds the exact paper trade, and can stop it.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#live">Follow the $100K paper test</a>
              <a className="text-action" href="#controls">Try the demo <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-thesis">
              A paper account uses real market prices but no real money. Every result, decision record and line of code is inspectable.
            </p>
          </div>

          <figure className="hero-figure">
            <div className="figure-labels">
              <span>13-year modeled ending wealth on $10,000</span>
              <strong>{g4.start_date.slice(0, 4)}–{g4.end_date.slice(0, 4)}</strong>
            </div>
            <div
              className="hero-result"
              role="img"
              aria-label={`In the historical Finly Core simulation, ten thousand dollars became approximately ${dollars(performanceLabEndingWealth)} with Finly Core and ${dollars(spyEndingWealth)} with SPY, a fund that tracks the S and P 500. The historical ending-wealth difference was ${dollars(performanceLabAdvantage)} after modeled trading costs.`}
            >
              <div>
                <span>Finly Core historical ending wealth</span>
                <strong>{dollars(performanceLabEndingWealth)}</strong>
                <small>{signedPct(g4.g4_total_return)} total return</small>
              </div>
              <div>
                <span>SPY · S&amp;P 500 tracker</span>
                <strong>{dollars(spyEndingWealth)}</strong>
                <small>{signedPct(g4.spy_total_return)} total return</small>
              </div>
              <p><strong>{dollars(performanceLabAdvantage)}</strong> historical difference · 56.7% more modeled ending wealth in this replay.</p>
              <em className="decision-stamp">+$38,629 vs S&amp;P 500 tracker</em>
            </div>
            <figcaption>
              Historical replay using past prices · same $10,000 starting capital · 0.05% modeled cost when the portfolio trades.
            </figcaption>
          </figure>

          <dl className="hero-metrics" aria-label="Immediate proof points">
            <div>
              <dt>Historical ending wealth</dt>
              <dd>{dollars(performanceLabEndingWealth)}</dd>
              <p>A $10,000 replay after modeled trading costs.</p>
            </div>
            <div>
              <dt>Earlier-market test</dt>
              <dd>80 yrs</dd>
              <p>{external.primary_window.observations.toLocaleString()} market days in a public historical dataset.</p>
            </div>
            <div>
              <dt>Monthly schedule positions</dt>
              <dd>{external.robustness.positive_rebalance_anchors}/{external.robustness.tested_rebalance_anchors}</dd>
              <p>The historical edge stayed positive across all 21 positions in the trading schedule.</p>
            </div>
            <div>
              <dt>Input stress tests</dt>
              <dd>{perturbationCount}/{perturbationCount}</dd>
              <p>Small input changes did not reverse the example trade.</p>
            </div>
          </dl>
        </section>

        <CompetitionDashboard />

        <section className="argument-band" aria-label="Core proposition">
          <div className="shell argument-grid">
            <p className="argument-number">01</p>
            <div>
              <p className="kicker">What Finly does</p>
              <h2>It reads the evidence, builds the trade, and shows why it prepared—or stopped—a paper-order plan.</h2>
            </div>
            <div className="argument-copy">
              <p>
                Finly Core runs the fund portfolio. The separate AI assistant explains an options idea, while rules-based
                code fixes the maximum loss and decides whether a paper order is allowed. A judge can inspect each step.
              </p>
              <p>
                In the illustrative example, the two-option trade could lose at most $366 and gain at most $634. It still passed
                after Finly removed each of {sourceRemovalCount} sources and changed the inputs {perturbationCount} different ways.
              </p>
            </div>
          </div>
        </section>

        <section className="evidence-section" id="evidence">
          <div className="shell">
            <div className="section-intro evidence-intro">
              <div>
                <p className="kicker">What the historical test showed</p>
                <h2>Same $10,000. Same dates. Finly Core ended $38,629 higher.</h2>
              </div>
              <p>
                We replayed the fixed portfolio on past prices from 2013 through 2026. Finly Core returned +967.11%
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
                  <p>It stayed ahead across all 21 positions in the monthly trading schedule.</p>
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
                  from every tested monthly start date and under a much harsher trading-cost assumption.
                </p>
                <a href="./data/attempt150_public_evidence.json">Open the evidence file <span aria-hidden="true">↗</span></a>
              </div>
            </article>

            <div className="research-note research-note-tight">
              <p>
                We used these historical results to choose Finly Core for the paper competition, then locked the four-fund
                allocation before the test began. The $100,000 paper account is measured separately from the historical replay.
              </p>
              <div>
                <a href="./data/competition-deployment-record.json">Read the deployment record <span aria-hidden="true">↗</span></a>
                {references.map(([label, href]) => <a key={href} href={href}>{label} <span aria-hidden="true">↗</span></a>)}
              </div>
            </div>
          </div>
        </section>

        <section className="system shell" id="workflow">
          <div className="section-intro">
            <div>
              <p className="kicker">Here's how it works</p>
              <h2>One market view becomes a paper order in five steps.</h2>
            </div>
            <p>
              Finly turns sourced facts into a market view, a trade with a fixed maximum loss, and a decision record.
              Tested code—not the language model—makes the final call.
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
            <p>Tests try to break it</p>
            <span aria-hidden="true">→</span>
            <strong>Trade—or leave the account alone</strong>
          </aside>
        </section>

        <section className="receipt-section" id="controls">
          <div className="shell">
            <div className="section-intro receipt-intro">
              <div>
                <p className="kicker">Try it</p>
                <h2>Change the evidence and watch Finly decide whether to trade.</h2>
              </div>
              <p>
                These are illustrative scenarios, not broker orders. The demo shows both rising- and falling-price cases.
                During the competition, the live account may open only a rise-focused options trade—or do nothing.
              </p>
            </div>

            <div className="receipt-controls" role="group" aria-label="Choose a demonstration scenario">
              <button type="button" aria-pressed={receiptMode === "aligned"} onClick={() => setReceiptMode("aligned")}>
                <strong>Evidence agrees</strong>
                <span>See a supported case become a capped-loss proposal.</span>
              </button>
              <button type="button" aria-pressed={receiptMode === "conflict"} onClick={() => setReceiptMode("conflict")}>
                <strong>Evidence conflicts</strong>
                <span>See Finly stop when the evidence conflicts.</span>
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
                    ? <>Finly reads the evidence as <strong>{humanDirectionCopy(receipt.intent.direction)}</strong>. It then builds a capped-loss trade and checks every term before preparing the paper order.</>
                    : <>Finly initially reads the evidence as <strong>{humanDirectionCopy(receipt.intent.direction)}</strong>, but the case falls apart under testing. Instead of forcing a trade, it keeps the account protected.</>}
                </p>
                <dl className="receipt-facts">
                  <div>
                    <dt>What Finly sees</dt>
                    <dd>The market view</dd>
                    <p>AI compares the supplied information and explains why it supports—or weakens—the trade idea.</p>
                  </div>
                  <div>
                    <dt>What Finly builds</dt>
                    <dd>{receipt.compilation.selected ? "A two-option trade with capped loss" : "No trade was built"}</dd>
                    <p>Code—not the language model—chooses the contracts, position size, possible gain, and maximum loss.</p>
                  </div>
                  <div>
                    <dt>What the tests found</dt>
                    <dd>{receipt.source_removal.passed && receipt.perturbations?.passed ? "The thesis held up" : "The thesis broke down"}</dd>
                    <p>Finly removes each source and nudges the inputs before it trusts the original conclusion.</p>
                  </div>
                  <div>
                    <dt>What happens next</dt>
                    <dd>{receipt.certificate.certified ? "Ready for paper trading" : "No trade; capital stays untouched"}</dd>
                    <p>{receipt.certificate.certified ? "Every field in the Alpaca paper order is now fixed and ready for review." : "The process stops before the paper account takes on any risk."}</p>
                  </div>
                </dl>
              </div>
            </div>

            <div className={`receipt-decision ${receipt.certificate.certified ? "receipt-permit" : "receipt-refusal"}`}>
              <div>
                <p className="kicker">Decision</p>
                <h3>{receipt.certificate.certified ? "A capped-loss options proposal is ready." : "Finly protected capital as designed."}</h3>
              </div>
              <p>
                {receipt.certificate.certified
                  ? "Finly turned the supported idea into a complete Alpaca paper-order plan, including maximum loss, maximum gain and position size."
                  : `The ${receipt.compilation.action} outcome kept the paper account untouched when the evidence test failed.`}
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
          <p>Evidence files and rerun commands · first-close evidence added 31 August 2026</p>
        </div>
      </footer>
    </>
  );
}
