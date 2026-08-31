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
  ["case", "Thesis"],
  ["live", "Live account"],
  ["evidence", "Evidence"],
  ["controls", "Controls"],
  ["forward", "Forward proof"],
  ["package", "Artifacts"],
] as const;

const architecture = [
  {
    number: "01",
    title: "Collect the evidence",
    body: "Finly gathers each market input with its source and timestamp, so every investment decision begins with facts a judge can trace.",
  },
  {
    number: "02",
    title: "Understand the market",
    body: "AI compares the evidence, explains what it means, and identifies the market view that the facts support.",
  },
  {
    number: "03",
    title: "Build the trade",
    body: "Code turns that view into an exact position, including the time horizon, order details, position size, and maximum possible loss.",
  },
  {
    number: "04",
    title: "Try to break it",
    body: "Finly removes evidence, perturbs the inputs, and raises transaction costs to see whether the investment case still holds together.",
  },
  {
    number: "05",
    title: "Approve the plan",
    body: "Only a trade that passes every check becomes an Alpaca-compatible paper order. If a check fails, the account stays protected.",
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
        <a className="header-cta" href="https://github.com/owlsowo/finly-bot">View repository <span aria-hidden="true">↗</span></a>
      </header>

      <main id="main-content">
        <section className="hero shell" id="case">
          <div className="hero-copy">
            <p className="kicker">386-point historical lead / controlled agentic execution</p>
            <h1>Finly grew a modeled $10,000 to $106,711—$38,629 more than SPY.</h1>
            <p className="hero-deck">
              Across the same cost-adjusted 2013–2026 simulation, Finly delivered +967.11% versus SPY's +580.82%.
              Its advantage is architectural as well as financial: AI interprets the evidence, deterministic code defines
              the trade, and a risk gateway protects every dollar before an order can reach the broker.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#evidence">See the $38,629 advantage</a>
              <a className="text-action" href="#controls">Test the execution gateway <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-thesis">
              The investment case: a measurable market edge, scaled through disciplined agentic execution.
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
              aria-label={`In the historical simulation, ten thousand dollars became approximately ${dollars(performanceLabEndingWealth)} with Finly and ${dollars(spyEndingWealth)} with SPY, an ending-wealth advantage of ${dollars(performanceLabAdvantage)} after modeled ${g4.modeled_one_way_cost_bps} basis point one-way costs.`}
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
              <em className="decision-stamp">+386.29 pp lead</em>
            </div>
            <figcaption>
              2013–2026 historical simulation · identical $10,000 starting capital · modeled {g4.modeled_one_way_cost_bps} bp one-way costs.
            </figcaption>
          </figure>

          <dl className="hero-metrics" aria-label="Demonstrated product capabilities">
            <div>
              <dt>Finly total return</dt>
              <dd>{signedPct(g4.g4_total_return)}</dd>
              <p>Measured across the full 2013–2026 simulation after modeled costs.</p>
            </div>
            <div>
              <dt>SPY total return</dt>
              <dd>{signedPct(g4.spy_total_return)}</dd>
              <p>Identical starting capital and comparison window.</p>
            </div>
            <div>
              <dt>Source-removal checks</dt>
              <dd>{sourceRemovalCount}/{sourceRemovalCount}</dd>
              <p>The proposal passed every source-removal test.</p>
            </div>
            <div>
              <dt>Perturbation checks</dt>
              <dd>{perturbationCount}/{perturbationCount}</dd>
              <p>The proposal remained stable across all {perturbationCount} input shocks.</p>
            </div>
          </dl>
        </section>

        <CompetitionDashboard />

        <section className="argument-band" aria-label="Core proposition">
          <div className="shell argument-grid">
            <p className="argument-number">01</p>
            <div>
              <p className="kicker">Why Finly wins</p>
              <h2>More intelligence at the top. More control at the point of execution.</h2>
            </div>
            <div className="argument-copy">
              <p>
                Finly separates research, trade construction and execution: AI forms the thesis, deterministic code builds
                the defined-risk position, and the gateway verifies maximum loss before authorizing a paper order.
              </p>
              <p>
                In the paper-trading demonstration, a one-contract spread carried a $366 maximum loss and $634 maximum
                gain, passing {sourceRemovalCount}/{sourceRemovalCount} source-removal and {perturbationCount}/{perturbationCount} perturbation tests.
              </p>
            </div>
          </div>
        </section>

        <section className="evidence-section" id="evidence">
          <div className="shell">
            <div className="section-intro evidence-intro">
              <div>
                <p className="kicker">The quantified investment case</p>
                <h2>Same capital. Same dates. $38,629 more modeled wealth.</h2>
              </div>
              <p>
                The result is direct and reproducible: +967.11% for Finly versus +580.82% for SPY across the identical
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

        <section className="system shell" id="system">
          <div className="section-intro">
            <div>
              <p className="kicker">Controlled agentic execution</p>
              <h2>Finly lets AI read the market, while code keeps every trade inside a hard risk limit.</h2>
            </div>
            <p>
              Finly uses AI for the work that requires interpretation and deterministic code for the work that must be exact.
              The result is a market thesis that can be explained, tested, and converted into a trade without letting a
              language model improvise with the account.
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
                <h2>See Finly turn aligned evidence into a $366-risk, $634-upside proposal.</h2>
              </div>
              <p>
                Switch the evidence case to see how the same architecture identifies an opportunity, stress-tests the
                thesis and either advances a defined-risk structure or protects capital.
              </p>
            </div>

            <div className="receipt-controls" role="group" aria-label="Choose a demonstration scenario">
              <button type="button" aria-pressed={receiptMode === "aligned"} onClick={() => setReceiptMode("aligned")}>
                <strong>Aligned evidence</strong>
                <span>See a high-conviction case become a defined-risk proposal.</span>
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
              <p className="kicker">Proof designed before outcomes</p>
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
              <p className="kicker">Design advantage</p>
              <h2>Agents can be ambitious in research and conservative in authority.</h2>
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
              <p className="kicker">Evidence you can trace</p>
              <h2>Every headline number links to the code and evidence behind it.</h2>
            </div>
            <p>
              Move from the executive case to methodology, demonstration and source code without breaking the evidence chain.
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
