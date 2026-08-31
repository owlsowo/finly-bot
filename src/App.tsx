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
  ["01", "One-page proposal", "An answer-first investment case built for the first judging pass.", "./judge/Finly_Judge_Brief.pdf"],
  ["02", "Technical paper", "Full methodology, architecture, evidence and academic references.", "./judge/Finly_Technical_Proposal.pdf"],
  ["03", "Presentation", "The quantified opportunity and product story in consulting format.", "./judge/Finly_Consulting_Deck.pdf"],
  ["04", "Demo film", "A concise walkthrough of the performance case and execution controls.", "./judge/Finly_Demo_Video.mp4"],
  ["05", "Repository", "Source code, tests, evidence ledger and reproduction commands.", "https://github.com/owlsowo/finly-bot"],
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
        <a className="header-cta" href="./judge/Finly_Judge_Brief.pdf">Open judge brief <span aria-hidden="true">↗</span></a>
      </header>

      <main id="main-content">
        <section className="hero shell" id="case">
          <div className="hero-copy">
            <p className="kicker">Agentic research / defined-risk paper trading</p>
            <h1>Turn market evidence into a defined-risk paper trade.</h1>
            <p className="hero-deck">
              Finly brings the market evidence, the proposed trade and the risk decision into one inspectable workflow.
              AI interprets the evidence; deterministic code sets exposure and the gateway authorizes each paper order.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="./judge/Finly_Judge_Brief.pdf">Open the judge brief <span aria-hidden="true">↗</span></a>
              <a className="text-action" href="#live">See the live paper account <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-thesis">
              Inspect what Finly sees, what it proposes and what the control layer permits—before a paper order is sent.
            </p>
          </div>

          <figure className="hero-figure">
            <div className="figure-labels">
              <span>Post-selected retrospective case</span>
              <strong>Not promoted</strong>
            </div>
            <div
              className="hero-result"
              role="img"
              aria-label={`In the post-selected retrospective replay, ten thousand dollars became approximately ${dollars(performanceLabEndingWealth)} with Finly and ${dollars(spyEndingWealth)} with SPY, an ending-wealth advantage of ${dollars(performanceLabAdvantage)} after modeled ${g4.modeled_one_way_cost_bps} basis point one-way costs. This case was not promoted.`}
            >
              <div>
                <span>Finly ending wealth</span>
                <strong>{dollars(performanceLabEndingWealth)}</strong>
                <small>{signedPct(g4.g4_total_return)} total return</small>
              </div>
              <div>
                <span>SPY ending wealth</span>
                <strong>{dollars(spyEndingWealth)}</strong>
                <small>{signedPct(g4.spy_total_return)} total return</small>
              </div>
              <p><strong>{dollars(performanceLabAdvantage)}</strong> advantage · 56.7% more modeled ending wealth than SPY.</p>
              <em className="decision-stamp">Retrospective only</em>
            </div>
            <figcaption>
              {g4.start_date.slice(0, 4)}–{g4.end_date.slice(0, 4)} · identical $10,000 starting capital · modeled {g4.modeled_one_way_cost_bps} bp one-way costs · post-selected result, not promoted as evidence of future market superiority.
            </figcaption>
          </figure>

          <dl className="hero-metrics" aria-label="Immediate proof points">
            <div>
              <dt>Outcome · historical case</dt>
              <dd>{signedPct(g4.g4_total_return)}</dd>
              <p>Modeled 2013–2026 return after costs; a post-selected retrospective, not a forecast.</p>
            </div>
            <div>
              <dt>Scale · out-of-era replay</dt>
              <dd>{external.primary_window.observations.toLocaleString()}</dd>
              <p>Market days in the pre-specified public industry-proxy replay.</p>
            </div>
            <div>
              <dt>Robustness · timing</dt>
              <dd>{external.robustness.positive_rebalance_anchors}/{external.robustness.tested_rebalance_anchors}</dd>
              <p>Every tested monthly rebalance anchor retained a positive net-growth edge.</p>
            </div>
            <div>
              <dt>Trust · trade checks</dt>
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
              <p className="kicker">What the product does</p>
              <h2>Research the market, propose the trade, show the decision record.</h2>
            </div>
            <div className="argument-copy">
              <p>
                Finly separates research, trade construction and execution so a judge can inspect each handoff: AI forms
                the thesis, code builds the defined-risk position, and the gateway decides whether a paper order is allowed.
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
                <p className="kicker">The quantified investment case</p>
                <h2>A retrospective result, disclosed with its limits.</h2>
              </div>
              <p>
                In the consumed, post-selected 2013–2026 replay with modeled transaction costs, Finly returned +967.11%
                versus SPY's +580.82%. Promotion was rejected; this result does not support a future-performance claim.
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
                  <p className="kicker">80 years of out-of-era evidence</p>
                  <h3 id="external-proof-title">One fixed strategy. 21,218 market days. A 3.89-point annualized advantage.</h3>
                </div>
                <p>
                  Finly's pre-specified industry proxy ran from {external.primary_window.start_date.slice(0, 4)} to
                  {" "}{external.primary_window.end_date.slice(0, 4)}—an entirely different market era from the headline case.
                  After modeled {external.primary_window.modeled_one_way_cost_bps} bp one-way costs, Finly annualized at
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
                  <strong>Bottom line:</strong> Finly's advantage survived a different market era, every tested rebalance
                  date and transaction costs five times the base assumption.
                </p>
                <a href="./data/attempt150_public_evidence.json">Inspect the source-backed evidence <span aria-hidden="true">↗</span></a>
              </div>
            </article>

            <div className="research-note research-note-tight">
              <p>
                Finly operationalizes time-series momentum and volatility-managed exposure inside an agentic decision
                system. The technical paper and reproducible evidence ledger connect the headline result to the strategy,
                cost model, risk controls and academic foundation behind it.
              </p>
              <div>
                {references.map(([label, href]) => <a key={href} href={href}>{label} <span aria-hidden="true">↗</span></a>)}
              </div>
            </div>
          </div>
        </section>

        <section className="system shell" id="workflow">
          <div className="section-intro">
            <div>
              <p className="kicker">One paper-trade walkthrough</p>
              <h2>Follow one market view from evidence to an exact paper order.</h2>
            </div>
            <p>
              This is the product loop: facts in, a clear thesis, a defined-risk proposal and an explicit decision record.
              The final authority sits with tested code, not the language model.
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
            <strong>The gateway makes the final call</strong>
          </aside>
        </section>

        <section className="receipt-section" id="controls">
          <div className="shell">
            <div className="section-intro receipt-intro">
              <div>
                <p className="kicker">Interactive execution proof</p>
                <h2>Inspect the control decision after Finly proposes a trade.</h2>
              </div>
              <p>
                Compare aligned and conflicting evidence to see how the same workflow advances a defined-risk proposal
                only when the supporting case holds up.
              </p>
            </div>

            <div className="receipt-controls" role="group" aria-label="Choose a demonstration scenario">
              <button type="button" aria-pressed={receiptMode === "aligned"} onClick={() => setReceiptMode("aligned")}>
                <strong>Aligned evidence</strong>
                <span>See a supported case become a defined-risk proposal.</span>
              </button>
              <button type="button" aria-pressed={receiptMode === "conflict"} onClick={() => setReceiptMode("conflict")}>
                <strong>Conflicting evidence</strong>
                <span>See the control layer preserve capital when the thesis breaks.</span>
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
                    <dd>The market story</dd>
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
              Alpaca-compatible paper-trading workflow · exact risk sizing · capital-preserving controls.
            </p>
          </div>
        </section>

        <section className="forward shell" id="forward">
          <div className="forward-stamp" aria-label={`Two forward tests were registered before their first eligible sessions as of ${gate.evidence_as_of}`}>
            <p>Forward proof in motion</p>
            <strong>2</strong>
            <span>pre-registered forward tests</span>
            <small>Rules were locked before measurement began.</small>
          </div>
          <div className="forward-copy">
              <p className="kicker">How future evidence will be earned</p>
              <h2>Two forward tests lock the rules before the market supplies the answer.</h2>
            <p>
              The tests lock the candidate, chronology and decision rules before eligible evidence arrives—moving Finly
              from compelling historical evidence toward clean forward measurement.
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
              <p className="kicker">Control comes after the proposal</p>
              <h2>The account stays in control, even when the research is ambitious.</h2>
            </div>
            <div className="broker-copy">
              <p>
                Finly captures the breadth of agentic analysis without surrendering capital discipline. The model synthesizes
                evidence; tested code converts that view into exact exposure, order fields and maximum loss.
              </p>
              <p>
                The result is an explainable, capital-bounded paper-trading workflow that can absorb new data sources and strategies.
              </p>
              <a href="https://docs.alpaca.markets/us/docs/options-trading">Read Alpaca's options documentation <span aria-hidden="true">↗</span></a>
            </div>
            <div className="broker-seal">
              <img src="./brand/finly-mark.svg" alt="" />
              <p>Model</p><span>may interpret</span>
              <hr />
              <p>Gateway</p><span>alone may permit</span>
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
              Start with the one-page judge brief, then move to the methodology, demonstration and source code without
              breaking the evidence chain.
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
              <p>386.29-point historical lead · controlled agentic paper trading.</p>
          <p>Bruce Wen · <a href="mailto:bwen412@brandeis.edu">bwen412@brandeis.edu</a></p>
          <p>Reproducible evidence ledger · updated {gate.evidence_as_of}</p>
        </div>
      </footer>
    </>
  );
}
