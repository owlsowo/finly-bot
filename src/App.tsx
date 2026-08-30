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
    selected: null | { long_leg: { strike: number }; short_leg: { strike: number } };
  };
  source_removal: { passed: boolean };
  perturbations: null | { passed: boolean };
  certificate: {
    certified: boolean;
    rejection_codes: string[];
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
  ["01", "One-page proposal", "The argument in a concise essay for the first judging pass.", "./judge/Finly_Judge_Brief.pdf"],
  ["02", "Technical paper", "Method, evidence, falsification and the limits of each result.", "./judge/Finly_Technical_Proposal.pdf"],
  ["03", "Presentation", "The judge-facing case in a compact consulting narrative.", "./judge/Finly_Consulting_Deck.pdf"],
  ["04", "Demo film", "A short walkthrough of the product and its proof boundary.", "./judge/Finly_Demo_Video.mp4"],
  ["05", "Repository", "Code, tests, research ledger and reproduction commands.", "https://github.com/owlsowo/finly-bot"],
] as const;

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${pct(value, digits)}`;

function titleCaseEvidenceClass(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

export function DemoClient() {
  const [receiptMode, setReceiptMode] = useState<"aligned" | "conflict">("aligned");
  const gate = quantitativeGate;
  const g4 = gate.conclusions.g4_rejected_post_selection;
  const production = gate.conclusions.production_v1_execution_realism;
  const futureTests = gate.conclusions.registered_future_only_tests;
  const receipt = receiptMode === "aligned" ? alignedReceipt : conflictReceipt;
  const futureOutcomeCount = futureTests.reduce((sum, test) => sum + test.observed_outcome_count, 0);

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
            <p className="kicker">Historical result / governance decision</p>
            <h1>A backtest returned {signedPct(g4.g4_total_return)}. Finly rejected it.</h1>
            <p className="hero-deck">{gate.allowed_claims[0]}</p>
            <div className="hero-actions">
              <a className="primary-action" href="#evidence">Follow the evidence</a>
              <a className="text-action" href="#controls">Test the authorization boundary <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-thesis">
              Finly's claim is not that a large backtest deserves belief. Its claim is that a trading agent should be able to
              withdraw authority from the result that looks most persuasive.
            </p>
          </div>

          <figure className="hero-figure">
            <div className="figure-labels">
              <span>Consumed retrospective replay</span>
              <strong>Modeled {g4.modeled_one_way_cost_bps} bp one-way</strong>
            </div>
            <div
              className="hero-result hero-result-rejected"
              role="img"
              aria-label={`G4 returned ${pct(g4.g4_total_return)} and SPY returned ${pct(g4.spy_total_return)} from ${g4.start_date} through ${g4.end_date}; G4 was rejected and not promoted.`}
            >
              <div>
                <span>G4 shadow</span>
                <strong>{signedPct(g4.g4_total_return)}</strong>
                <small>{g4.start_date} — {g4.end_date}</small>
              </div>
              <div>
                <span>SPY</span>
                <strong>{signedPct(g4.spy_total_return)}</strong>
                <small>Same consumed interval</small>
              </div>
              <p>The larger result did not clear the statistical promotion gates.</p>
              <em className="rejection-stamp">Rejected</em>
            </div>
            <figcaption>
              This is a post-selected ETF replay, not options P&amp;L, broker fills or evidence of future market superiority.
              The rejection is the result of the audit—not a footnote to it.
            </figcaption>
          </figure>

          <dl className="hero-metrics" aria-label="Release-gated quantitative findings">
            <div>
              <dt>Deflated Sharpe probability</dt>
              <dd>{pct(g4.deflated_sharpe_probability)}</dd>
              <p>The strongest-looking replay did not survive selection adjustment.</p>
            </div>
            <div>
              <dt>Worst familywise p-value</dt>
              <dd>{pct(g4.worst_familywise_adjusted_p_value)}</dd>
              <p>The multiple-testing evidence did not justify promotion.</p>
            </div>
            <div>
              <dt>Production v1 · modeled 5 bp</dt>
              <dd>{signedPct(production.total_return_at_5bp_per_leg)}</dd>
              <p>Positive, but below SPY's {signedPct(production.spy_total_return)} total return.</p>
            </div>
            <div>
              <dt>Future-only outcomes</dt>
              <dd>{futureOutcomeCount}</dd>
              <p>Attempts 115 and 116 had no observed outcomes as of the gate.</p>
            </div>
          </dl>
        </section>

        <section className="argument-band" aria-label="Core proposition">
          <div className="shell argument-grid">
            <p className="argument-number">01</p>
            <div>
              <p className="kicker">The governing idea</p>
              <h2>Financial agents do not need more confidence. They need less authority.</h2>
            </div>
            <div className="argument-copy">
              <p>
                A fluent model can interpret evidence, but fluency is not a risk control. Finly therefore separates the
                market assessment from the code that determines exposure and from the gateway that decides whether a
                proposal may proceed.
              </p>
              <p>
                That separation matters most when the evidence is exciting. G4's retrospective return was large enough to
                invite a victory lap; its statistical record instead required a refusal.
              </p>
            </div>
          </div>
        </section>

        <section className="evidence-section" id="evidence">
          <div className="shell">
            <div className="section-intro evidence-intro">
              <div>
                <p className="kicker">The evidence hearing</p>
                <h2>The headline survived arithmetic. It did not survive adjudication.</h2>
              </div>
              <p>
                The consumed replay is deliberately shown at full scale. The adjacent decision view then applies the two
                release-gated statistical findings that prevented a post-selected result from becoming the production policy.
              </p>
            </div>

            <HistoricalExplorer
              candidateReturn={g4.g4_total_return}
              spyReturn={g4.spy_total_return}
              startDate={g4.start_date}
              endDate={g4.end_date}
              oneWayCostBps={g4.modeled_one_way_cost_bps}
              deflatedSharpeProbability={g4.deflated_sharpe_probability}
              worstFamilywisePValue={g4.worst_familywise_adjusted_p_value}
              disposition={g4.disposition}
            />

            <div className="research-note research-note-tight">
              <p>
                White (2000) motivates the familywise test, while Bailey and López de Prado (2014) motivate the Deflated
                Sharpe diagnostic. The momentum and volatility-management literature informs candidate design; it does not
                validate Finly's retrospective result.
              </p>
              <div>
                {references.map(([label, href]) => <a key={href} href={href}>{label} <span aria-hidden="true">↗</span></a>)}
              </div>
            </div>

            <div className="section-intro evidence-intro production-intro">
              <div>
                <p className="kicker">What entered production research instead</p>
                <h2>Production v1 is smaller, frozen and honest about what it did not beat.</h2>
              </div>
              <p>{gate.allowed_claims[1]}</p>
            </div>

            <aside className="production-clarifier" aria-labelledby="production-title">
              <div className="production-copy">
                <p className="kicker">Frozen production v1</p>
                <h3 id="production-title">An unlevered SPY/BIL policy targeting 10% annualized volatility.</h3>
                <p>
                  Production v1 is distinct from the rejected G4 shadow. The consumed study models signals formed before
                  next-open execution and applies costs to each traded leg; it is an adjusted-OHLC ledger, not a broker-fill
                  replay or an options-profitability result.
                </p>
              </div>
              <dl className="production-metrics">
                <div>
                  <dt>Total return · modeled 5 bp / leg</dt>
                  <dd>{signedPct(production.total_return_at_5bp_per_leg)}</dd>
                  <p>{production.start_date} — {production.end_date}</p>
                </div>
                <div>
                  <dt>SPY total return · same study</dt>
                  <dd>{signedPct(production.spy_total_return)}</dd>
                  <p>Production v1 did not beat SPY on total return.</p>
                </div>
                <div>
                  <dt>Annualized volatility · modeled 5 bp</dt>
                  <dd>{pct(production.annualized_volatility_at_5bp)}</dd>
                  <p>The policy targeted 10% annualized volatility.</p>
                </div>
                <div>
                  <dt>Maximum drawdown · modeled 5 bp</dt>
                  <dd>{signedPct(production.maximum_drawdown_at_5bp)}</dd>
                  <p>{production.observations} consumed observations.</p>
                </div>
              </dl>
              <p className="production-status">
                At 25 basis points per traded leg, the modeled total return was {signedPct(production.total_return_at_25bp_per_leg)}.
                The result supports the description “risk-controlled but not market-beating on total return”; it does not authorize a forecast.
              </p>
            </aside>
          </div>
        </section>

        <section className="system shell" id="system">
          <div className="section-intro">
            <div>
              <p className="kicker">Operating model</p>
              <h2>Five stages separate interpretation from authority.</h2>
            </div>
            <p>
              The design assumes that model outputs can be wrong, unstable or persuasive for the wrong reason. They are
              confined to typed assessments; deterministic code retains the fields that determine exposure and records the
              decision made at each boundary.
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
                <p className="kicker">Interactive authorization boundary</p>
                <h2>The same pipeline can compile a bounded proposal or refuse to trade.</h2>
              </div>
              <p>
                These are recorded synthetic fixtures, not market observations. Switching the evidence changes the
                deterministic record below, but it does not contact Alpaca, transmit an order or add a performance result.
              </p>
            </div>

            <div className="receipt-controls" role="group" aria-label="Choose a recorded decision fixture">
              <button type="button" aria-pressed={receiptMode === "aligned"} onClick={() => setReceiptMode("aligned")}>
                <strong>Aligned evidence</strong>
                <span>Inspect a synthetic proposal that reaches the final authorization boundary.</span>
              </button>
              <button type="button" aria-pressed={receiptMode === "conflict"} onClick={() => setReceiptMode("conflict")}>
                <strong>Conflicting evidence</strong>
                <span>Inspect the same pipeline when the evidence cannot support an order.</span>
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
                    <dd>Interpretive only</dd>
                    <p>The model explains the supplied evidence but cannot set exposure or broker fields.</p>
                  </div>
                  <div>
                    <dt>Deterministic compilation</dt>
                    <dd>{receipt.compilation.selected ? "A candidate was constructed" : "No candidate was constructed"}</dd>
                    <p>The compiler, rather than the model, owns the executable shape.</p>
                  </div>
                  <div>
                    <dt>Challenge result</dt>
                    <dd>{receipt.source_removal.passed && receipt.perturbations?.passed ? "The recorded checks passed" : "A required check failed"}</dd>
                    <p>A fragile result stops here; the system does not ask the model to reconsider its own permission.</p>
                  </div>
                  <div>
                    <dt>Authorization result</dt>
                    <dd>{receipt.certificate.certified ? "Synthetic payload compiled" : "NO_TRADE"}</dd>
                    <p>{receipt.certificate.certified ? "The payload remained local and was not transmitted." : "No order payload survived the gateway."}</p>
                  </div>
                </dl>
              </div>
            </div>

            <div className={`receipt-decision ${receipt.certificate.certified ? "receipt-permit" : "receipt-refusal"}`}>
              <div>
                <p className="kicker">Recorded conclusion</p>
                <h3>{receipt.certificate.certified ? "The fixture supports a bounded proposal." : "The fixture does not support a trade."}</h3>
              </div>
              <p>
                {receipt.certificate.certified
                  ? "Deterministic code compiled an Alpaca-shaped paper-order payload, but the demonstration did not transmit it. This tests mechanics, not profitability."
                  : `The compiler returned ${receipt.compilation.action}. The failed evidence challenge left the broker payload null.`}
              </p>
              <a href={receiptMode === "aligned" ? "./data/latest_receipt.json" : "./data/no_trade_receipt.json"}>
                Read the recorded fixture <span aria-hidden="true">↗</span>
              </a>
            </div>

            <p className="receipt-disclosure">
              Scope: {receipt.market.feed_disclosure} The local record begins {receipt.receipt_id.slice(0, 18)}… and exists so judges can inspect the authorization mechanism without credentials.
            </p>
          </div>
        </section>

        <section className="forward shell" id="forward">
          <div className="forward-stamp" aria-label={`Attempts 115 and 116 each had zero observed outcomes as of ${gate.evidence_as_of}`}>
            <p>Future-only evidence as of the release gate</p>
            <strong>0 + 0</strong>
            <span>observed outcomes across Attempts 115 and 116</span>
            <small>Both tests were publicly registered before their first eligible session.</small>
          </div>
          <div className="forward-copy">
            <p className="kicker">The next proof begins after publication</p>
            <h2>Two tests are frozen. Neither has earned a performance sentence.</h2>
            <p>{gate.allowed_claims[2]}</p>
            <ol className="forward-trials">
              {futureTests.map((test) => (
                <li key={test.attempt_number}>
                  <div>
                    <strong>Attempt {test.attempt_number}</strong>
                    <span>First eligible session {test.first_eligible_signal_session ?? test.first_eligible_input_session}</span>
                  </div>
                  <p>
                    The public registration is present and canonically validated. With {test.observed_outcome_count} observed outcomes,
                    a performance claim is {test.performance_claim_authorized ? "authorized" : "not authorized"}.
                  </p>
                </li>
              ))}
            </ol>
            <p className="boundary-note">
              Public GitHub receipts establish a reproducible platform record; they are not independent cryptographic timestamps,
              broker executions or outcome evidence.
            </p>
          </div>
        </section>

        <section className="broker-band">
          <div className="shell broker-grid">
            <div>
              <p className="kicker">The product boundary</p>
              <h2>The model may interpret. The gateway alone may permit.</h2>
            </div>
            <div className="broker-copy">
              <p>
                A model can summarize evidence and propose a bounded view. Deterministic code retains direction, exposure,
                order fields and the final permission decision, so a confident explanation cannot silently enlarge the risk.
              </p>
              <p>
                Finly is an educational paper-trading research prototype. The historical studies are consumed modeled
                ledgers; they are neither broker fills nor verified options P&amp;L.
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
              <p className="kicker">Judge package</p>
              <h2>The same bounded case is available at five levels of detail.</h2>
            </div>
            <p>
              Every quantitative sentence on this page is governed by the source-hashed release gate. The package preserves
              the distinction between a rejected retrospective result, a risk-controlled production study and future tests
              that have not yet produced outcomes.
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
          <p>Educational paper-trading research prototype.</p>
          <p>Bruce Wen · <a href="mailto:bwen412@brandeis.edu">bwen412@brandeis.edu</a></p>
          <p>Evidence as of {gate.evidence_as_of} · {titleCaseEvidenceClass(g4.evidence_class)}</p>
        </div>
      </footer>
    </>
  );
}
