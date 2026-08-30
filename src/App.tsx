import { useEffect, useState } from "react";
import alignedReceiptJson from "./data/latest_receipt.json";
import conflictReceiptJson from "./data/no_trade_receipt.json";
import { HistoricalExplorer } from "./HistoricalExplorer";

type ClaimsLock = {
  evidence_as_of: string;
  central_distinction: string;
  judge_proposition: string;
  retrospective_result: {
    window: { start: string; end: string };
    one_way_cost_bps: number;
    candidate_total_return: number;
    spy_total_return: number;
    candidate_annualized_return: number;
    spy_annualized_return: number;
    candidate_annualized_volatility: number;
    spy_annualized_volatility: number;
    candidate_maximum_drawdown: number;
    spy_maximum_drawdown: number;
    candidate_annualized_turnover: number;
    spy_annualized_turnover: number;
    promotion_status: string;
    boundary: string;
  };
  falsification: {
    deflated_sharpe_probability: number;
    required_deflated_sharpe_probability: number;
    worst_familywise_adjusted_p_value: number;
    maximum_permitted_familywise_p_value: number;
    cost_sign_stable_at_5_10_25_bps: boolean;
    all_21_offsets_positive_spy_edges: boolean;
    growth_control_independence_supported: boolean;
    authenticated_source_overlap_passed: boolean;
    replacement_challengers_promoted: number;
    generation6_challengers_assessed: number;
  };
  research_attempt_accounting: {
    conservatively_counted_effective_attempts: number;
    exact_claim: string;
  };
  hindsight_boundary: {
    fully_preregistered_claim_permitted: boolean;
    all_historical_intervals_consumed: boolean;
  };
  production_policy: {
    policy_id: string;
    evidence_class: string;
    distinct_from_g4_shadow: boolean;
    window: { start: string; end: string; observations: number };
    candidate: {
      total_return: number;
      annualized_return: number;
      annualized_volatility: number;
      maximum_drawdown: number;
    };
    spy: {
      total_return: number;
      annualized_return: number;
      annualized_volatility: number;
      maximum_drawdown: number;
    };
    interpretation: string;
    latest_research_proposal: {
      spy_weight: number;
      bil_weight: number;
      paper_account_spy_weight_before_proposal: number;
      paper_account_defensive_weight_before_proposal: number;
      broker_mutation_authorized: boolean;
      mutation_requested: boolean;
    };
  };
  forward_trial: {
    commitments: number;
    settlements: number;
    first_signal_session: string;
    minimum_settlements_for_primary_calculation: number;
    production_commitment_enabled: boolean;
    production_settlement_enabled: boolean;
    performance_inference_enabled: boolean;
    broker_authority: boolean;
    exact_safe_claim: string;
  };
  options_and_broker_boundary: {
    historical_g4_is_options_pnl: boolean;
    options_contribution: string;
    authenticated_read_only_paper_account_check: boolean;
    order_submitted_or_filled_as_evidence: boolean;
    live_capital_authorized: boolean;
  };
  source_integrity: {
    all_hashes_verified: boolean;
    artifacts: Array<{ id: string; path: string; sha256: string }>;
  };
};

type DemoReceipt = {
  receipt_id: string;
  data_mode: string;
  market: {
    underlying: string;
    spot: number;
    feed_disclosure: string;
  };
  intent: {
    direction: string;
    direction_score: number;
    agreement: number;
    coverage: number;
    source_families: string[];
  };
  source_signals: Array<{
    family: string;
    direction_score: number;
    explanation: string;
  }>;
  compilation: {
    action: string;
    reason: string | null;
    selected: null | {
      expiry: string;
      entry_debit: number;
      max_loss: number;
      max_gain: number;
      reward_risk: number;
      long_leg: { strike: number; symbol: string };
      short_leg: { strike: number; symbol: string };
    };
  };
  source_removal: {
    passed: boolean;
    variants: Array<{ removed_family: string; direction: string; stable_direction: boolean }>;
  };
  perturbations: null | {
    count: number;
    direction_flips: number;
    rejected_variants: number;
    passed: boolean;
  };
  certificate: {
    decision: string;
    certified: boolean;
    rejection_codes: string[];
    quantity: number;
    reserved_max_loss: number;
  };
  alpaca_payload: null | {
    order_class: string;
    qty: string;
    type: string;
    time_in_force: string;
    limit_price: string;
    legs: Array<{ side: string; symbol: string; position_intent: string }>;
  };
};

const alignedReceipt = alignedReceiptJson as unknown as DemoReceipt;
const conflictReceipt = conflictReceiptJson as unknown as DemoReceipt;

const navigation = [
  ["case", "The case"],
  ["system", "System"],
  ["receipt", "Decision record"],
  ["range", "Historical replay"],
  ["evidence", "Evidence"],
  ["forward", "Forward test"],
  ["package", "Submission"],
] as const;

const architecture = [
  {
    number: "01",
    title: "Gather",
    body: "The schema records a source label and timestamp for each input. An input cannot affect authorization unless its provenance checks pass.",
  },
  {
    number: "02",
    title: "Propose",
    body: "A model may score the evidence and explain a market view. It does not choose an executable order.",
  },
  {
    number: "03",
    title: "Compile",
    body: "Deterministic code owns direction, horizon, size, spread construction and maximum loss.",
  },
  {
    number: "04",
    title: "Challenge",
    body: "Code tests sensitivity to removed evidence, perturbed inputs, alternative controls, modeled costs and repeated strategy search.",
  },
  {
    number: "05",
    title: "Decide",
    body: "If any required check fails, the gateway returns NO_TRADE and broker authority remains disabled.",
  },
] as const;

const references = [
  ["White, 2000", "https://doi.org/10.1111/1468-0262.00152"],
  ["Bailey & López de Prado, 2014", "https://doi.org/10.3905/jpm.2014.40.5.094"],
  ["Moskowitz, Ooi & Pedersen, 2012", "https://doi.org/10.1016/j.jfineco.2011.11.003"],
  ["Moreira & Muir, 2017", "https://doi.org/10.1111/jofi.12513"],
] as const;

const deliverables = [
  ["01", "One-page proposal", "A concise essay for the first judging pass.", "./judge/Finly_Judge_Brief.pdf"],
  ["02", "Technical paper", "Method, evidence, falsification and limitations.", "./judge/Finly_Technical_Proposal.pdf"],
  ["03", "Presentation", "The judge-facing case in nine slides.", "./judge/Finly_Consulting_Deck.pdf"],
  ["04", "Demo film", "A short walkthrough of the product and proof boundary.", "./judge/Finly_Demo_Video.mp4"],
  ["05", "Repository", "Code, tests, research ledger and reproduction commands.", "https://github.com/owlsowo/finly-bot"],
] as const;

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${pct(value, digits)}`;
const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function EvidenceLoading({ error }: { error?: string }) {
  return (
    <main className="loading-shell">
      <img src="./brand/finly-mark.svg" alt="" />
      <p>{error ?? "Verifying the locked evidence file…"}</p>
    </main>
  );
}

export function DemoClient() {
  const [claims, setClaims] = useState<ClaimsLock | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [receiptMode, setReceiptMode] = useState<"aligned" | "conflict">("aligned");

  useEffect(() => {
    let active = true;
    fetch("./data/submission_claims_lock.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Evidence request failed (${response.status})`);
        return response.json() as Promise<ClaimsLock>;
      })
      .then((payload) => {
        if (active) setClaims(payload);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "Evidence could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  if (!claims) return <EvidenceLoading error={loadError} />;

  const result = claims.retrospective_result;
  const tests = claims.falsification;
  const forward = claims.forward_trial;
  const production = claims.production_policy;
  const receipt = receiptMode === "aligned" ? alignedReceipt : conflictReceipt;
  const selected = receipt.compilation.selected;
  const sourceRemovalCount = receipt.source_removal.variants.length;
  const initialReplayCapital = 100_000;
  const g4EndingValue = initialReplayCapital * (1 + result.candidate_total_return);
  const spyEndingValue = initialReplayCapital * (1 + result.spy_total_return);
  const historicalDollarGap = g4EndingValue - spyEndingValue;

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
            <p className="kicker">Controlled-delegation trading research</p>
            <h1>In a consumed historical replay, Finly's G4 shadow turned a modeled $100,000 into {compactUsd.format(g4EndingValue)}.</h1>
            <p className="hero-deck">
              The fourth-generation nonproduction shadow candidate (G4) finished a consumed 2013–2026 ETF replay at {compactUsd.format(g4EndingValue)},
              versus {compactUsd.format(spyEndingValue)} for SPY—a {compactUsd.format(historicalDollarGap)} historical lead after modeled trading costs.
              It also recorded the higher annualized return and the less severe drawdown. Select another period below and recompute the result yourself.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#range">Explore a historical period</a>
              <a className="text-action" href="#evidence">See why it was not promoted <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-thesis">{claims.central_distinction}</p>
          </div>

          <figure className="hero-figure">
            <div className="figure-labels">
              <span>Consumed retrospective replay</span>
              <strong>{result.one_way_cost_bps} bp costs applied</strong>
            </div>
            <div className="hero-result" role="img" aria-label={`A modeled $100,000 became ${Math.round(g4EndingValue).toLocaleString("en-US")} in the nonproduction G4 historical replay versus ${Math.round(spyEndingValue).toLocaleString("en-US")} in SPY, a historical difference of ${Math.round(historicalDollarGap).toLocaleString("en-US")}.`}>
              <div>
                <span>Modeled $100k ending value</span>
                <strong>{compactUsd.format(g4EndingValue)}</strong>
                <small>SPY {compactUsd.format(spyEndingValue)}</small>
              </div>
              <div>
                <span>Historical dollar gap</span>
                <strong>+{compactUsd.format(historicalDollarGap)}</strong>
                <small>After modeled {result.one_way_cost_bps} bp one-way costs</small>
              </div>
              <p>G4 beat SPY in this consumed replay. Every cost assumption, test result and claim boundary remains attached for inspection.</p>
            </div>
            <figcaption>
              2013-01-02 to 2026-08-27 · modeled 5 bp one-way turnover cost · selected after viewing history. Descriptive ETF replay—not options P&amp;L and not a forecast.
            </figcaption>
          </figure>

          <dl className="hero-metrics" aria-label="Headline historical results">
            <div>
              <dt>Modeled ending value</dt>
              <dd>{compactUsd.format(g4EndingValue)} <small>Finly G4</small></dd>
              <p>$100,000 initial capital</p>
            </div>
            <div>
              <dt>Historical lead</dt>
              <dd>+{compactUsd.format(historicalDollarGap)}</dd>
              <p>Versus SPY's {compactUsd.format(spyEndingValue)}</p>
            </div>
            <div>
              <dt>Annualized return</dt>
              <dd>{pct(result.candidate_annualized_return)} <small>Finly G4</small></dd>
              <p>SPY {pct(result.spy_annualized_return)}</p>
            </div>
            <div>
              <dt>Maximum drawdown</dt>
              <dd>{signedPct(result.candidate_maximum_drawdown)} <small>Finly G4</small></dd>
              <p>SPY {signedPct(result.spy_maximum_drawdown)}</p>
            </div>
          </dl>
        </section>

        <section className="argument-band" aria-label="Core proposition">
          <div className="shell argument-grid">
            <p className="argument-number">01</p>
            <div>
              <p className="kicker">The case</p>
              <h2>Finly assigns market assessment, order construction and authorization to different components.</h2>
            </div>
            <div className="argument-copy">
              <p>
                Many trading-agent workflows allow one model response to influence both the market view and the executable
                action. Finly restricts the model to a bounded assessment; deterministic code constructs the intent, and the
                gateway denies permission whenever a required check fails.
              </p>
              <p>
                The model may evaluate supplied evidence and explain a view. It cannot increase exposure, set broker fields
                or authorize an order.
              </p>
            </div>
          </div>
        </section>

        <section className="system shell" id="system">
          <div className="section-intro">
            <div>
              <p className="kicker">Operating model</p>
              <h2>Five stages separate evidence from authority.</h2>
            </div>
            <p>
              The design assumes model outputs can be wrong or unstable. They are therefore limited to typed assessments;
              deterministic code retains the fields that determine exposure, and the system records the normalized inputs
              and decisions used at each stage.
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
            <p>Model output</p>
            <span aria-hidden="true">→</span>
            <p>Typed intent</p>
            <span aria-hidden="true">→</span>
            <p>Deterministic challenge suite</p>
            <span aria-hidden="true">→</span>
            <strong>Permit or NO_TRADE</strong>
          </aside>
        </section>

        <section className="receipt-section" id="receipt">
          <div className="shell">
            <div className="section-intro receipt-intro">
              <div>
                <p className="kicker">Interactive decision record</p>
                <h2>The same pipeline can construct a bounded proposal or refuse to trade.</h2>
              </div>
              <p>
                These controls replay two recorded synthetic fixtures. The first contains four mutually reinforcing evidence
                families; the second introduces disagreement. Switching between them changes the deterministic record below,
                but it does not query a market, contact Alpaca or place an order.
              </p>
            </div>

            <div className="receipt-controls" role="group" aria-label="Choose a recorded decision fixture">
              <button type="button" aria-pressed={receiptMode === "aligned"} onClick={() => setReceiptMode("aligned")}>
                <strong>Aligned evidence</strong>
                <span>Inspect a synthetic proposal that survives the order-level checks.</span>
              </button>
              <button type="button" aria-pressed={receiptMode === "conflict"} onClick={() => setReceiptMode("conflict")}>
                <strong>Conflicting evidence</strong>
                <span>Inspect the same pipeline when the evidence does not support an order.</span>
              </button>
            </div>

            <div className="receipt-workbench" aria-live="polite">
              <div className="receipt-sources">
                <p className="receipt-label">1 · Evidence supplied to the bounded assessment</p>
                <div className="source-list">
                  {receipt.source_signals.map((signal) => (
                    <article key={signal.family}>
                      <div>
                        <h3>{signal.family.replace("_", " ")}</h3>
                        <strong>{signal.direction_score >= 0 ? "+" : ""}{signal.direction_score.toFixed(2)}</strong>
                      </div>
                      <p>{signal.explanation}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="receipt-conclusion">
                <p className="receipt-label">2 · Typed assessment</p>
                <p className="assessment-sentence">
                  The aggregate is <strong>{receipt.intent.direction}</strong> with a direction score of
                  <strong> {receipt.intent.direction_score >= 0 ? "+" : ""}{receipt.intent.direction_score.toFixed(2)}</strong>,
                  {" "}{pct(receipt.intent.agreement, 0)} agreement and {pct(receipt.intent.coverage, 0)} coverage.
                </p>

                <dl className="receipt-facts">
                  <div>
                    <dt>3 · Deterministic compilation</dt>
                    <dd>{selected ? `${selected.long_leg.strike}/${selected.short_leg.strike} bear-put debit spread` : "No candidate constructed"}</dd>
                    <p>{selected ? `$${selected.max_loss} exact maximum loss; $${selected.max_gain} maximum gain.` : "Direction remained below the required threshold."}</p>
                  </div>
                  <div>
                    <dt>4A · Evidence-removal challenge</dt>
                    <dd>{receipt.source_removal.passed ? `${sourceRemovalCount}/${sourceRemovalCount} removals retained the decision` : "The decision changed when evidence was removed"}</dd>
                    <p>{receipt.source_removal.passed ? "No single evidence family controlled the recorded outcome." : "The proposal is too dependent on which evidence family is present."}</p>
                  </div>
                  <div>
                    <dt>4B · Perturbation challenge</dt>
                    <dd>{receipt.perturbations ? `${receipt.perturbations.count - receipt.perturbations.rejected_variants}/${receipt.perturbations.count} variants survived` : "Not run after the earlier failure"}</dd>
                    <p>{receipt.perturbations ? `${receipt.perturbations.direction_flips} direction flips were recorded.` : "The fail-closed sequence stopped before this stage."}</p>
                  </div>
                  <div>
                    <dt>5 · Authorization result</dt>
                    <dd>{receipt.certificate.certified ? "Synthetic certificate created" : "NO_TRADE"}</dd>
                    <p>{receipt.certificate.certified ? "An Alpaca-shaped payload was compiled but not transmitted." : `${receipt.certificate.rejection_codes.length} failed checks left the payload null.`}</p>
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
                  ? `Code reserved $${receipt.certificate.reserved_max_loss} for one contract and constructed a ${receipt.alpaca_payload?.order_class === "mleg" ? "multi-leg" : receipt.alpaca_payload?.order_class ?? "multi-leg"} paper-order payload. This is a mechanics demonstration, not a broker fill or evidence of profitability.`
                  : `The compiler returned ${receipt.compilation.action}. Because the evidence-removal test failed, no option structure, quantity or Alpaca payload survived the gateway.`}
              </p>
              <a href={receiptMode === "aligned" ? "./data/latest_receipt.json" : "./data/no_trade_receipt.json"}>
                Read the complete recorded receipt <span aria-hidden="true">↗</span>
              </a>
            </div>

            <p className="receipt-disclosure">
              Scope: {receipt.market.feed_disclosure} The receipt is hash-identified as {receipt.receipt_id.slice(0, 21)}… and is provided so the judge can inspect the mechanism without credentials.
            </p>
          </div>
        </section>

        <section className="evidence-section" id="evidence">
          <div className="shell">
            <div className="section-intro evidence-intro">
              <div>
                <p className="kicker">The evidence</p>
                <h2>A $386,289 historical lead—tested harder than a screenshot.</h2>
              </div>
              <p>
                From {result.window.start} through {result.window.end}, G4 recorded a higher annualized return and a less
                severe maximum drawdown than SPY after the modeled {result.one_way_cost_bps}-basis-point one-way turnover cost.
                Because G4 was selected after the full interval had been examined, these are descriptive results that
                motivate further testing; they do not support deployment.
              </p>
            </div>

            <HistoricalExplorer />

            <aside className="production-clarifier" aria-labelledby="production-title">
              <div className="production-copy">
                <p className="kicker">What would actually trade</p>
                <h3 id="production-title">Production Finly is not G4.</h3>
                <p>
                  The frozen production book is a SPY/BIL trend-and-volatility policy. In its fixed, now-consumed holdout it
                  gave up raw return for materially lower volatility and drawdown. It has no forward observations, so the
                  evidence does not support saying it is more likely than not to beat SPY next month.
                </p>
              </div>
              <dl className="production-metrics">
                <div>
                  <dt>Annualized return</dt>
                  <dd>{pct(production.candidate.annualized_return)}</dd>
                  <p>SPY {pct(production.spy.annualized_return)}</p>
                </div>
                <div>
                  <dt>Annualized volatility</dt>
                  <dd>{pct(production.candidate.annualized_volatility)}</dd>
                  <p>SPY {pct(production.spy.annualized_volatility)}</p>
                </div>
                <div>
                  <dt>Maximum drawdown</dt>
                  <dd>{signedPct(production.candidate.maximum_drawdown)}</dd>
                  <p>SPY {signedPct(production.spy.maximum_drawdown)}</p>
                </div>
                <div>
                  <dt>Forward observations</dt>
                  <dd>{forward.settlements}</dd>
                  <p>Next-month inference unavailable</p>
                </div>
              </dl>
              <p className="production-status">
                Latest research-only proposal: {pct(production.latest_research_proposal.spy_weight)} SPY / {pct(production.latest_research_proposal.bil_weight)} BIL.
                The paper account remained in its prior defensive state; no broker mutation was authorized or requested.
              </p>
            </aside>

            <div className="evidence-ledger">
              <div className="ledger-summary">
                <p className="kicker">Promotion decision</p>
                <h3>Shadow only</h3>
                <p>
                  G4 retained a positive historical edge sign under the tested costs and rebalance offsets. It nevertheless
                  failed the Deflated Sharpe, adjusted familywise, static growth-control and authenticated source-overlap
                  requirements.
                </p>
                <a href="./data/submission_claims_lock.json">View the locked metrics and permitted claims <span aria-hidden="true">↗</span></a>
              </div>
              <div className="table-scroll" role="region" tabIndex={0} aria-label="G4 falsification results; scroll horizontally on narrow screens">
                <table className="gate-table">
                  <caption>G4 falsification ledger</caption>
                  <thead>
                    <tr><th scope="col">Gate</th><th scope="col">Observed</th><th scope="col">Required</th><th scope="col">Decision</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Deflated Sharpe probability</th>
                      <td data-label="Observed">{pct(tests.deflated_sharpe_probability)}</td>
                      <td data-label="Required">≥ {pct(tests.required_deflated_sharpe_probability, 0)}</td>
                      <td data-label="Decision"><span className="failed">Failed</span></td>
                    </tr>
                    <tr>
                      <th scope="row">Worst adjusted familywise p-value</th>
                      <td data-label="Observed">{tests.worst_familywise_adjusted_p_value.toFixed(3)}</td>
                      <td data-label="Required">≤ {tests.maximum_permitted_familywise_p_value.toFixed(2)}</td>
                      <td data-label="Decision"><span className="failed">Failed</span></td>
                    </tr>
                    <tr>
                      <th scope="row">Static growth-control independence</th>
                      <td data-label="Observed">{tests.growth_control_independence_supported ? "Supported" : "Unsupported"}</td>
                      <td data-label="Required">Supported</td>
                      <td data-label="Decision"><span className="failed">Failed</span></td>
                    </tr>
                    <tr>
                      <th scope="row">Authenticated source overlap</th>
                      <td data-label="Observed">{tests.authenticated_source_overlap_passed ? "Passed" : "Not passed"}</td>
                      <td data-label="Required">Passed</td>
                      <td data-label="Decision"><span className="failed">Failed</span></td>
                    </tr>
                    <tr>
                      <th scope="row">Cost sensitivity</th>
                      <td data-label="Observed">Historical edge sign remained positive at 5 / 10 / 25 bp</td>
                      <td data-label="Required">Stable sign</td>
                      <td data-label="Decision"><span className="passed">Passed</span></td>
                    </tr>
                    <tr>
                      <th scope="row">Rebalance offsets</th>
                      <td data-label="Observed">Historical edge sign remained positive at 21 / 21 offsets</td>
                      <td data-label="Required">Stable sign</td>
                      <td data-label="Decision"><span className="passed">Passed</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="research-note">
              <p>
                The statistical checks account for repeated strategy search. White (2000) motivates the familywise test,
                while Bailey and López de Prado (2014) motivate the Deflated Sharpe diagnostic. The momentum papers motivate
                candidate design; they do not validate Finly's result.
              </p>
              <div>
                {references.map(([label, href]) => <a key={href} href={href}>{label} <span aria-hidden="true">↗</span></a>)}
              </div>
            </div>
          </div>
        </section>

        <section className="forward shell" id="forward">
          <div className="forward-number" aria-label={`Zero of ${forward.minimum_settlements_for_primary_calculation} forward settlements`}>
            <strong>{forward.settlements}</strong>
            <span>/ {forward.minimum_settlements_for_primary_calculation}</span>
          </div>
          <div className="forward-copy">
            <p className="kicker">Forward Trial 1</p>
            <h2>Forward Trial 1 has not yet produced performance evidence.</h2>
            <p>
              Every interval used in the reported research has already been examined. Forward Trial 1 therefore starts with
              zero observations and separates a recorded signal commitment from its later outcome. Local timestamps and
              hashes do not prove when data were captured, so production writes and inference remain disabled until external
              anchoring and reconciliation are ready and at least {forward.minimum_settlements_for_primary_calculation} settlements exist.
            </p>
            <dl className="forward-facts">
              <div><dt>Signal commitments</dt><dd>{forward.commitments}</dd></div>
              <div><dt>Outcome settlements</dt><dd>{forward.settlements}</dd></div>
              <div><dt>Broker authority</dt><dd>{forward.broker_authority ? "Enabled" : "None"}</dd></div>
              <div><dt>Performance inference</dt><dd>{forward.performance_inference_enabled ? "Enabled" : "Disabled"}</dd></div>
            </dl>
            <p className="boundary-note">
              The local, hash-bound protocol demonstrates schema and accounting mechanics. It does not yet prove
              prospectivity, provider origin, execution quality, performance or future profit.
            </p>
          </div>
        </section>

        <section className="broker-band">
          <div className="shell broker-grid">
            <div>
              <p className="kicker">Alpaca boundary</p>
              <h2>Deterministic code—not the model—constructs the order intent.</h2>
            </div>
            <div className="broker-copy">
              <p>
                If all promotion and authorization gates pass, deterministic code constructs a defined-risk options intent
                and calculates maximum loss. A separate gateway must verify exact field agreement before an order could
                reach Alpaca's paper-trading interface.
              </p>
              <p>
                The authenticated Alpaca evidence is read-only. No order or fill is presented as performance evidence, and
                the long historical chart is an ETF allocation replay—not options profitability.
              </p>
              <a href="https://docs.alpaca.markets/us/docs/options-trading">Alpaca options documentation <span aria-hidden="true">↗</span></a>
            </div>
            <div className="broker-seal">
              <img src="./brand/finly-mark.svg" alt="" />
              <p>Model</p><span>may propose</span>
              <hr />
              <p>Gateway</p><span>alone may permit</span>
            </div>
          </div>
        </section>

        <section className="package shell" id="package">
          <div className="section-intro">
            <div>
              <p className="kicker">Judge package</p>
              <h2>The submission package presents the same claim at five levels of detail.</h2>
            </div>
            <p>{claims.judge_proposition}</p>
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
          <p>Evidence as of {claims.evidence_as_of}</p>
        </div>
      </footer>
    </>
  );
}
