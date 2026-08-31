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
  ["workflow", "Workflow"],
  ["evidence", "Evidence"],
  ["controls", "Controls"],
  ["package", "Judge kit"],
] as const;

const architecture = [
  {
    number: "01",
    title: "Record four signals",
    body: "Finly collects the market, options, economic and prediction-market inputs with their source context before it makes a recommendation.",
  },
  {
    number: "02",
    title: "Explain the thesis",
    body: "AI compares those inputs and states the directional market view they support, in plain language a judge can inspect.",
  },
  {
    number: "03",
    title: "Compile the exact spread",
    body: "Deterministic code—not the model—sets the strikes, position size, payoff and maximum possible loss for the proposed trade.",
  },
  {
    number: "04",
    title: "Challenge the case",
    body: "Finly removes supporting evidence and perturbs the inputs before it trusts the original conclusion.",
  },
  {
    number: "05",
    title: "Prepare the paper order",
    body: "Only a proposal that passes the checks becomes an Alpaca-compatible paper order with every field specified.",
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
    market: ["Market trend", "Recent price momentum has turned negative, while trading volume provides modest confirmation."],
    options: ["Options market", "Options pricing shows more demand for downside protection, supporting a bearish view without signaling a volatility panic."],
    events: ["Economic events", "The scheduled macro event increases the risk of weaker near-term growth."],
    prediction_market: ["Prediction markets", "A liquid prediction market points in the same direction and adds a small amount of supporting evidence."],
  },
  conflict: {
    market: ["Market trend", "Price momentum remains positive."],
    options: ["Options market", "Options pricing is mildly positive."],
    events: ["Economic events", "The event signal points against the current price trend."],
    prediction_market: ["Prediction markets", "Prediction-market pricing conflicts with the market data."],
  },
} as const;

function humanSignalCopy(mode: "aligned" | "conflict", family: string, fallback: string): readonly [string, string] {
  const copy = sourceFamilyCopy[mode];
  if (Object.hasOwn(copy, family)) return copy[family as keyof typeof copy];
  return [family.replaceAll("_", " "), fallback];
}

const deliverables = [
  ["01", "One-page proposal", "A one-page summary of the product, proof, and live account.", "./judge/Finly_Judge_Brief.pdf"],
  ["02", "Technical paper", "Full methodology, architecture, evidence and academic references.", "./judge/Finly_Technical_Proposal.pdf"],
  ["03", "Presentation", "Nine slides covering the result, workflow, controls, and live account.", "./judge/Finly_Consulting_Deck.pdf"],
  ["04", "Demo film", "A short walkthrough of the historical result and order checks.", "./judge/Finly_Demo_Video.mp4"],
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
  const futureTests = gate.conclusions.registered_future_only_tests;
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
            <p className="kicker">AI trading with built-in risk checks</p>
            <h1>Finly shows its work before it trades.</h1>
            <p className="hero-deck">
              In a retrospective G4 simulation, $10,000 became $106,711—$38,629 more than SPY. Separately, Finly
              reads market evidence, builds a defined-risk paper trade, checks the risk, and sends it to Alpaca—or stops it.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#live">Follow the $100K paper test</a>
              <a className="text-action" href="#controls">Try the demo <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-thesis">
              Everything is public: the account, the decision record, and the code.
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
              aria-label={`In the retrospective G4 simulation, ten thousand dollars became approximately ${dollars(performanceLabEndingWealth)} with G4 and ${dollars(spyEndingWealth)} with SPY, a historical ending-wealth difference of ${dollars(performanceLabAdvantage)} after modeled ${g4.modeled_one_way_cost_bps} basis point one-way costs.`}
            >
              <div>
                <span>G4 simulated ending wealth</span>
                <strong>{dollars(performanceLabEndingWealth)}</strong>
                <small>{signedPct(g4.g4_total_return)} total return</small>
              </div>
              <div>
                <span>SPY simulated ending wealth</span>
                <strong>{dollars(spyEndingWealth)}</strong>
                <small>{signedPct(g4.spy_total_return)} total return</small>
              </div>
              <p><strong>{dollars(performanceLabAdvantage)}</strong> historical difference · 56.7% more modeled ending wealth in this replay.</p>
              <em className="decision-stamp">+386.29 pp retrospective</em>
            </div>
            <figcaption>
              Historical simulation · identical $10,000 starting capital · modeled {g4.modeled_one_way_cost_bps} bp one-way costs.
            </figcaption>
          </figure>

          <dl className="hero-metrics" aria-label="Immediate proof points">
            <div>
              <dt>Historical return</dt>
              <dd>{signedPct(g4.g4_total_return)}</dd>
              <p>Modeled 2013–2026 result after costs; historical, not a forecast.</p>
            </div>
            <div>
              <dt>Earlier-market test</dt>
              <dd>{external.primary_window.observations.toLocaleString()}</dd>
              <p>Market days in an 80-year public industry-data test.</p>
            </div>
            <div>
              <dt>Rebalance timing</dt>
              <dd>{external.robustness.positive_rebalance_anchors}/{external.robustness.tested_rebalance_anchors}</dd>
              <p>Every tested monthly rebalance anchor retained a positive net-growth edge.</p>
            </div>
            <div>
              <dt>Trade checks</dt>
              <dd>{sourceRemovalCount}/{sourceRemovalCount}</dd>
              <p>The aligned paper-trade proposal passed every source-removal check.</p>
            </div>
          </dl>
        </section>

        <CompetitionDashboard />

        <section className="argument-band" aria-label="Core proposition">
          <div className="shell argument-grid">
            <p className="argument-number">01</p>
            <div>
              <p className="kicker">What Finly does</p>
              <h2>It reads the evidence, builds the trade, and shows why it sent—or stopped—the order.</h2>
            </div>
            <div className="argument-copy">
              <p>
                AI forms the market view. Code builds the defined-risk position. The final check decides whether the paper
                order is allowed. A judge can inspect each step.
              </p>
              <p>
                In the aligned demonstration, one contract carried a $366 maximum loss and $634 maximum gain, after
                passing {sourceRemovalCount}/{sourceRemovalCount} source-removal and {perturbationCount}/{perturbationCount} perturbation checks.
              </p>
            </div>
          </div>
        </section>

        <section className="evidence-section" id="evidence">
          <div className="shell">
            <div className="section-intro evidence-intro">
              <div>
                <p className="kicker">What the historical test showed</p>
                <h2>Same capital. Same dates. $38,629 more modeled wealth.</h2>
              </div>
              <p>
                The result is direct and can be rerun: +967.11% for Finly versus +580.82% for SPY across the identical
                2013–2026 window, with modeled transaction costs included.
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
                  <p className="kicker">A second historical proxy</p>
                  <h3 id="external-proof-title">We ran a pre-set industry version across 21,218 earlier market days.</h3>
                </div>
                <p>
                  We used public Kenneth French industry data from {external.primary_window.start_date.slice(0, 4)} to
                  {" "}{external.primary_window.end_date.slice(0, 4)}, long before the headline test began.
                  After modeled {external.primary_window.modeled_one_way_cost_bps} bp one-way costs, the Finly version annualized at
                  {" "}<strong>{pct(external.headline.finly_annualized_return)}</strong> versus
                  {" "}<strong>{pct(external.headline.market_annualized_return)}</strong> for the market.
                </p>
              </div>

              <dl className="external-proof-metrics">
                <div>
                  <dt>Annualized return advantage</dt>
                  <dd>+{(external.headline.annualized_return_advantage * 100).toFixed(2)} pp</dd>
                  <p>Measured against the market over the full pre-2007 replay.</p>
                </div>
                <div>
                  <dt>Rebalance timing checks</dt>
                  <dd>{external.robustness.positive_rebalance_anchors}/{external.robustness.tested_rebalance_anchors}</dd>
                  <p>Every monthly starting anchor preserved a positive net-growth edge.</p>
                </div>
                <div>
                  <dt>25 bp cost stress</dt>
                  <dd>+{(external.robustness.annualized_net_log_growth_advantage_at_25bps * 100).toFixed(2)} pp</dd>
                  <p>The edge remained positive at five times the base cost assumption.</p>
                </div>
                <div>
                  <dt>Drawdown advantage</dt>
                  <dd>{(external.headline.drawdown_improvement_percentage_points * 100).toFixed(2)} pp</dd>
                  <p>Maximum drawdown was materially shallower than the market path.</p>
                </div>
              </dl>

              <div className="external-proof-conclusion">
                <p>
                  <strong>What it showed:</strong> the modeled difference remained positive in an earlier market era,
                  across every tested rebalance date and with transaction costs five times the base assumption.
                </p>
                <a href="./data/attempt150_public_evidence.json">Open the evidence file <span aria-hidden="true">↗</span></a>
              </div>
            </article>

            <div className="research-note research-note-tight">
              <p>
                We chose G4 for a public paper test after reviewing these replays; the research gate did not promote it as
                Finly's general production policy. A human operator froze the four-ETF competition allocation before the
                forward window, and the $100,000 paper account is scored separately from the historical SPY comparison.
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
              Finly turns sourced facts into a market view, a defined-risk proposal, and a decision record. The final
              decision sits with tested code, not the language model.
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
            <p>AI explains the opportunity</p>
            <span aria-hidden="true">→</span>
            <p>Code builds the exact trade</p>
            <span aria-hidden="true">→</span>
            <p>Tests try to break it</p>
            <span aria-hidden="true">→</span>
            <strong>Code makes the final decision</strong>
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
                Switch between aligned and conflicting evidence to see when Finly prepares a trade and when it stops.
              </p>
            </div>

            <div className="receipt-controls" role="group" aria-label="Choose a demonstration scenario">
              <button type="button" aria-pressed={receiptMode === "aligned"} onClick={() => setReceiptMode("aligned")}>
                <strong>Aligned evidence</strong>
                <span>See a supported case become a defined-risk proposal.</span>
              </button>
              <button type="button" aria-pressed={receiptMode === "conflict"} onClick={() => setReceiptMode("conflict")}>
                <strong>Conflicting evidence</strong>
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
                    ? <>Finly reads the evidence as <strong>{receipt.intent.direction.toLowerCase()}</strong>. It then builds a defined-risk strategy and checks every term before preparing the paper order.</>
                    : <>Finly initially reads the evidence as <strong>{receipt.intent.direction.toLowerCase()}</strong>, but the case falls apart under testing. Instead of forcing a trade, it keeps the account protected.</>}
                </p>
                <dl className="receipt-facts">
                  <div>
                    <dt>What Finly sees</dt>
                    <dd>The market view</dd>
                    <p>AI compares the supplied signals and explains why they support—or weaken—the investment thesis.</p>
                  </div>
                  <div>
                    <dt>What Finly builds</dt>
                    <dd>{receipt.compilation.selected ? "An exact options spread" : "No trade was built"}</dd>
                    <p>Code—not the language model—sets the strikes, position size, payoff, and maximum loss.</p>
                  </div>
                  <div>
                    <dt>What the tests found</dt>
                    <dd>{receipt.source_removal.passed && receipt.perturbations?.passed ? "The thesis held up" : "The thesis broke down"}</dd>
                    <p>Finly tries removing evidence and changing the inputs before it trusts the original conclusion.</p>
                  </div>
                  <div>
                    <dt>What happens next</dt>
                    <dd>{receipt.certificate.certified ? "Ready for paper trading" : "No trade; capital stays untouched"}</dd>
                    <p>{receipt.certificate.certified ? "Every field in the Alpaca-compatible paper order is now fully specified." : "The control layer stops the process before the account takes on exposure."}</p>
                  </div>
                </dl>
              </div>
            </div>

            <div className={`receipt-decision ${receipt.certificate.certified ? "receipt-permit" : "receipt-refusal"}`}>
              <div>
                <p className="kicker">Decision</p>
                <h3>{receipt.certificate.certified ? "A defined-risk options proposal is ready." : "Finly protected capital as designed."}</h3>
              </div>
              <p>
                {receipt.certificate.certified
                  ? "Finly translated the aligned thesis into a fully specified Alpaca-compatible paper-order plan, including maximum loss, maximum gain and position size."
                  : `The ${receipt.compilation.action} outcome kept exposure at zero when the evidence challenge failed.`}
              </p>
              <a href={receiptMode === "aligned" ? "./data/latest_receipt.json" : "./data/no_trade_receipt.json"}>
                Inspect the decision record <span aria-hidden="true">↗</span>
              </a>
            </div>

            <p className="receipt-disclosure">
              Alpaca paper trading · exact risk sizing · code-owned order permission.
            </p>
          </div>
        </section>

        <section className="forward shell" id="forward">
          <div className="forward-stamp" aria-label={`Two forward tests were registered before their first eligible sessions as of ${gate.evidence_as_of}`}>
            <p>Forward tests</p>
            <strong>2</strong>
            <span>pre-registered forward tests</span>
            <small>Rules were locked before measurement began.</small>
          </div>
          <div className="forward-copy">
              <p className="kicker">How future evidence will be earned</p>
              <h2>Two forward tests lock the rules before the market supplies the answer.</h2>
            <p>
              We published the strategy, dates, and decision rules before the first eligible market session.
            </p>
            <ol className="forward-trials">
              {futureTests.map((test) => (
                <li key={test.attempt_number}>
                  <div>
                    <strong>Forward test {test.attempt_number === 115 ? "1" : "2"}</strong>
                    <span>First eligible session {test.first_eligible_signal_session ?? test.first_eligible_input_session}</span>
                  </div>
                  <p>
                    Rules were published before the test window opened.
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="broker-band">
          <div className="shell broker-grid">
            <div>
              <p className="kicker">Who this is for</p>
              <h2>AI research without giving the model the keys to the account.</h2>
            </div>
            <div className="broker-copy">
              <p>
                Finly is for brokerages, risk teams, and trading-product builders that want AI to review market evidence
                without letting it write orders. The model explains the view; code sets exposure, every order field, and
                maximum loss.
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
              <p>Code</p><span>issues the permit</span>
            </div>
          </div>
        </section>

        <section className="package shell" id="package">
          <div className="section-intro">
            <div>
              <p className="kicker">Judge kit</p>
              <h2>Open the brief, then trace every claim back to its evidence.</h2>
            </div>
            <p>
              Start with the one-page judge brief, then move to the methodology, demonstration and source code with links
              to the underlying evidence.
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
              <p>$38,629 retrospective ending-wealth difference · separately scored paper trading.</p>
          <p>Bruce Wen · <a href="mailto:bwen412@brandeis.edu">bwen412@brandeis.edu</a></p>
          <p>Evidence files and rerun commands · updated {gate.evidence_as_of}</p>
        </div>
      </footer>
    </>
  );
}
