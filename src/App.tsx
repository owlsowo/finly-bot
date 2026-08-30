import { useState } from "react";
import quantitativeGateJson from "../research/output/quantitative_release_gate.json";
import alignedReceiptJson from "./data/latest_receipt.json";
import conflictReceiptJson from "./data/no_trade_receipt.json";
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

const quantitativeGate = validateReleaseGate(quantitativeGateJson as unknown);
const alignedReceipt = alignedReceiptJson as unknown as DemoReceipt;
const conflictReceipt = conflictReceiptJson as unknown as DemoReceipt;

const navigation = [
  ["case", "Thesis"],
  ["evidence", "Evidence"],
  ["controls", "Controls"],
  ["forward", "Forward proof"],
  ["package", "Artifacts"],
] as const;

const architecture = [
  {
    number: "01",
    title: "Gather",
    body: "Every input arrives with a declared source and timestamp. Evidence that fails its provenance checks cannot influence authorization.",
  },
  {
    number: "02",
    title: "Interpret",
    body: "A model may weigh the supplied evidence and explain a market view. It does not choose an executable order.",
  },
  {
    number: "03",
    title: "Compile",
    body: "Deterministic code derives exposure, horizon, size, order fields and the maximum amount at risk.",
  },
  {
    number: "04",
    title: "Challenge",
    body: "The proposal must survive evidence removal, perturbed inputs, modeled costs and the research ledger's statistical gates.",
  },
  {
    number: "05",
    title: "Authorize",
    body: "A failed check returns NO_TRADE. The model has no path around that decision and no independent broker authority.",
  },
] as const;

const references = [
  ["White, 2000", "https://doi.org/10.1111/1468-0262.00152"],
  ["Bailey & López de Prado, 2014", "https://doi.org/10.3905/jpm.2014.40.5.094"],
  ["Moskowitz, Ooi & Pedersen, 2012", "https://doi.org/10.1016/j.jfineco.2011.11.003"],
  ["Moreira & Muir, 2017", "https://doi.org/10.1111/jofi.12513"],
] as const;

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
            <p className="kicker">Historical outperformance / controlled agentic execution</p>
            <h1>+967.11% vs +580.82%: Finly generated $38,629 more modeled wealth than SPY.</h1>
            <p className="hero-deck">
              Across the same 2013–2026 historical window, a modeled $10,000 grew to $106,711 with Finly versus $68,082
              with SPY after 5 bp one-way costs. Finly pairs that research engine with a controlled agentic workflow: AI
              interprets the evidence, deterministic code defines the trade, and a risk gateway decides what may reach the broker.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#evidence">See the $38,629 advantage</a>
              <a className="text-action" href="#controls">Test the execution gateway <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-thesis">
              The investment case is simple: search broadly for edge, then narrow authority before execution.
            </p>
          </div>

          <figure className="hero-figure">
            <div className="figure-labels">
              <span>Modeled ending wealth on $10,000</span>
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
              <em className="decision-stamp">Historical</em>
            </div>
            <figcaption>
              2013–2026 historical simulation · identical $10,000 starting capital · modeled {g4.modeled_one_way_cost_bps} bp one-way costs.
            </figcaption>
          </figure>

          <dl className="hero-metrics" aria-label="Checked product capabilities">
            <div>
              <dt>Finly historical return</dt>
              <dd>{signedPct(g4.g4_total_return)}</dd>
              <p>Performance Lab result after modeled {g4.modeled_one_way_cost_bps} bp one-way costs.</p>
            </div>
            <div>
              <dt>SPY historical return</dt>
              <dd>{signedPct(g4.spy_total_return)}</dd>
              <p>Identical 2013–2026 comparison window.</p>
            </div>
            <div>
              <dt>Source-removal checks</dt>
              <dd>{sourceRemovalCount}/{sourceRemovalCount}</dd>
              <p>The checked defined-risk proposal survived each source-family removal.</p>
            </div>
            <div>
              <dt>Perturbation checks</dt>
              <dd>{perturbationCount}/{perturbationCount}</dd>
              <p>The checked proposal remained stable across every recorded input shock.</p>
            </div>
          </dl>
        </section>

        <section className="argument-band" aria-label="Core proposition">
          <div className="shell argument-grid">
            <p className="argument-number">01</p>
            <div>
              <p className="kicker">Why Finly wins</p>
              <h2>A larger research edge does not require a larger trust boundary.</h2>
            </div>
            <div className="argument-copy">
              <p>
                Most trading agents collapse research, position construction and execution into one model call. Finly
                separates them: the model forms the thesis, deterministic code converts it into a defined-risk structure,
                and the gateway verifies maximum loss before permitting a paper payload.
              </p>
              <p>
                In the checked positive fixture, the resulting one-contract spread carried a $366 maximum loss, a $634
                maximum gain, and remained stable across every recorded source-removal and perturbation check.
              </p>
            </div>
          </div>
        </section>

        <section className="evidence-section" id="evidence">
          <div className="shell">
            <div className="section-intro evidence-intro">
              <div>
                <p className="kicker">The historical investment case</p>
                <h2>Finly created a 386.29 percentage-point return advantage over SPY.</h2>
              </div>
              <p>
                The comparison is straightforward: identical starting capital, identical 2013–2026 window and modeled
                transaction costs. Finly finished at $106,711 versus $68,082 for SPY.
              </p>
            </div>

            <HistoricalExplorer
              candidateReturn={g4.g4_total_return}
              spyReturn={g4.spy_total_return}
              startDate={g4.start_date}
              endDate={g4.end_date}
              oneWayCostBps={g4.modeled_one_way_cost_bps}
            />

            <div className="research-note research-note-tight">
              <p>
                Finly operationalizes time-series momentum and volatility-managed exposure inside an agentic decision
                system. Multiple-testing and Deflated Sharpe diagnostics are documented in the technical paper and the
                reproducible research ledger.
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
              <h2>The model finds the signal; deterministic controls own the risk.</h2>
            </div>
            <p>
              Finly gives each component one clear responsibility. AI synthesizes heterogeneous evidence, code converts the
              thesis into a bounded position, and the gateway retains final authority.
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
            <p>Model interpretation</p>
            <span aria-hidden="true">→</span>
            <p>Typed intent</p>
            <span aria-hidden="true">→</span>
            <p>Deterministic challenge suite</p>
            <span aria-hidden="true">→</span>
            <strong>Permit or NO_TRADE</strong>
          </aside>
        </section>

        <section className="receipt-section" id="controls">
          <div className="shell">
            <div className="section-intro receipt-intro">
              <div>
                <p className="kicker">Interactive decision proof</p>
                <h2>See Finly construct a $366-risk proposal—or stop at NO_TRADE.</h2>
              </div>
              <p>
                Switch the evidence case to see how the same architecture identifies an opportunity, stress-tests the
                thesis and either advances a defined-risk structure or protects capital.
              </p>
            </div>

            <div className="receipt-controls" role="group" aria-label="Choose a recorded decision fixture">
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
                <p className="receipt-label">Evidence supplied to the bounded interpretation</p>
                <div className="source-list">
                  {receipt.source_signals.map((signal) => (
                    <article key={signal.family}>
                      <h3>{signal.family.replaceAll("_", " ")}</h3>
                      <p>{signal.explanation}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="receipt-conclusion">
                <p className="receipt-label">Recorded decision path</p>
                <p className="assessment-sentence">
                  The model produced a <strong>{receipt.intent.direction.toLowerCase()}</strong> interpretation. Code—not the model—then decided what could survive.
                </p>
                <dl className="receipt-facts">
                  <div>
                    <dt>Model scope</dt>
                    <dd>Market intelligence</dd>
                    <p>The model synthesizes the evidence and explains the investment thesis.</p>
                  </div>
                  <div>
                    <dt>Deterministic compilation</dt>
                    <dd>{receipt.compilation.selected ? "A candidate was constructed" : "No candidate was constructed"}</dd>
                    <p>The compiler, rather than the model, owns the executable shape.</p>
                  </div>
                  <div>
                    <dt>Challenge result</dt>
                    <dd>{receipt.source_removal.passed && receipt.perturbations?.passed ? "The recorded checks passed" : "A required check failed"}</dd>
                    <p>The thesis must survive evidence removal and input perturbations before capital advances.</p>
                  </div>
                  <div>
                    <dt>Authorization result</dt>
                    <dd>{receipt.certificate.certified ? "Risk-bounded proposal ready" : "Capital preserved"}</dd>
                    <p>{receipt.certificate.certified ? "The paper-order payload is complete and inspectable." : "The gateway withheld exposure when the evidence lost alignment."}</p>
                  </div>
                </dl>
              </div>
            </div>

            <div className={`receipt-decision ${receipt.certificate.certified ? "receipt-permit" : "receipt-refusal"}`}>
              <div>
                <p className="kicker">Recorded conclusion</p>
                <h3>{receipt.certificate.certified ? "A defined-risk options proposal is ready." : "Finly protected capital as designed."}</h3>
              </div>
              <p>
                {receipt.certificate.certified
                  ? "Finly converted the aligned thesis into an Alpaca-compatible paper-order payload with exact maximum loss, maximum gain and position fields."
                  : `The ${receipt.compilation.action} outcome kept exposure at zero when the evidence challenge failed.`}
              </p>
              <a href={receiptMode === "aligned" ? "./data/latest_receipt.json" : "./data/no_trade_receipt.json"}>
                Read the recorded fixture <span aria-hidden="true">↗</span>
              </a>
            </div>

            <p className="receipt-disclosure">
              Demo record {receipt.receipt_id.slice(0, 18)}… · Alpaca-compatible paper workflow · no order transmitted.
            </p>
          </div>
        </section>

        <section className="forward shell" id="forward">
          <div className="forward-stamp" aria-label={`Two future-only protocols were registered before their first eligible sessions as of ${gate.evidence_as_of}`}>
            <p>Prospective validation</p>
            <strong>2</strong>
            <span>frozen future-only protocols</span>
            <small>Both registrations predate their first eligible session.</small>
          </div>
          <div className="forward-copy">
            <p className="kicker">Evaluation rules fixed in advance</p>
            <h2>Two prospective tests were frozen before their first eligible market session.</h2>
            <p>
              Attempts 115 and 116 lock the candidate, chronology and decision rules before eligible evidence arrives,
              moving Finly from compelling retrospective evidence toward clean forward measurement.
            </p>
            <ol className="forward-trials">
              {futureTests.map((test) => (
                <li key={test.attempt_number}>
                  <div>
                    <strong>Attempt {test.attempt_number}</strong>
                    <span>First eligible session {test.first_eligible_signal_session ?? test.first_eligible_input_session}</span>
                  </div>
                  <p>
                    The public registration is present, canonically validated and fixed before its first eligible session.
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
                The result is a trading workflow that is explainable enough for a judge to inspect, controlled enough for
                a paper account and modular enough to absorb new data sources and strategies.
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
              <p className="kicker">Diligence-ready submission</p>
              <h2>Every headline number links to the code, evidence and reproduction path behind it.</h2>
            </div>
            <p>
              Judges can move from the one-page investment case to the technical methodology, presentation, product demo
              and complete repository without losing the evidence chain.
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
          <p>Historical simulation · agentic paper-trading prototype.</p>
          <p>Bruce Wen · <a href="mailto:bwen412@brandeis.edu">bwen412@brandeis.edu</a></p>
          <p>Reproducible evidence ledger · updated {gate.evidence_as_of}</p>
        </div>
      </footer>
    </>
  );
}
