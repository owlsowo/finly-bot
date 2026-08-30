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
  execution_realism: {
    evidence_class: string;
    evidence_as_of: string;
    policy_id: string;
    window: { start: string; end: string; observations: number };
    fill_assumption: string;
    cost_unit: string;
    next_open_cost_stress: Array<{
      bps_per_leg: number;
      total_return: number;
      annualized_return: number;
      annualized_volatility: number;
      maximum_drawdown: number;
      spy_total_return: number;
    }>;
    raw_no_distribution_proxy: {
      bps_per_leg: number;
      total_return: number;
      annualized_return: number;
      annualized_volatility: number;
      maximum_drawdown: number;
      spy_total_return: number;
    };
    small_account_proxy: {
      bps_per_leg: number;
      initial_equity_usd: number;
      ending_equity_usd: number;
      total_return: number;
      annualized_return: number;
      maximum_drawdown: number;
      minimum_order_notional_usd: number;
      quantity_decimals: number;
      sell_day_fees_total_usd: number;
      skipped_minimum_orders: number;
    };
    exact_safe_claim: string;
  };
  prospective_attempt114: {
    attempt_id: string;
    publication_status: string;
    required_signal_commitments: number;
    required_settlements: number;
    primary_intervals: number;
    exclusive_deadline: string;
    publication_commit: { sha: string; url: string };
    verification_workflow: {
      run_id: number;
      url: string;
      conclusion: string;
      created_at: string;
      completed_at: string;
    };
    verification_observed_at: string;
    bound_runtime_source_count: number;
    public_get_count: number;
    assurance: {
      github_public_api_record_verified: boolean;
      successful_workflow_observed: boolean;
      public_pre_deadline_publication_observed: boolean;
      github_platform_record_only: boolean;
      independent_cryptographic_timestamp_verified: boolean;
      provider_origin_verified: boolean;
      broker_execution_verified: boolean;
      performance_inference_permitted: boolean;
      broker_mutation_authorized: boolean;
    };
    sample_boundary: {
      consecutive_official_sessions_required: boolean;
      no_skips: boolean;
      no_backfill: boolean;
      replacement_window_permitted: boolean;
      optional_stopping_permitted: boolean;
      repeat_confirmatory_test_permitted: boolean;
    };
    exact_safe_claim: string;
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
  ["case", "Thesis"],
  ["evidence", "Evidence"],
  ["forward", "Forward proof"],
  ["package", "Artifacts"],
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
  const execution = claims.execution_realism;
  const attempt = claims.prospective_attempt114;
  const executionAt = (bps: number) => {
    const row = execution.next_open_cost_stress.find((item) => item.bps_per_leg === bps);
    if (!row) throw new Error(`Execution-realism evidence omits ${bps} bp stress`);
    return row;
  };
  const baseExecution = executionAt(5);
  const severeExecution = executionAt(25);
  const smallAccount = execution.small_account_proxy;
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
            <p className="kicker">Controlled-delegation trading agent</p>
            <h1>Finly stayed positive after next-open execution and 25-basis-point cost stress.</h1>
            <p className="hero-deck">
              The frozen SPY/BIL policy returned {signedPct(baseExecution.total_return)} across {execution.window.observations} consumed sessions
              under modeled next-open execution and five basis points per traded leg. At a severe 25-basis-point stress, the return remained
              {" "}{signedPct(severeExecution.total_return)}. The model may interpret evidence; deterministic code owns exposure, costs,
              order fields and the final permission to trade.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#evidence">Inspect the quantitative evidence</a>
              <a className="text-action" href="#receipt">Try the decision record <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-thesis">{claims.central_distinction}</p>
          </div>

          <figure className="hero-figure">
            <div className="figure-labels">
              <span>Consumed execution-realism audit</span>
              <strong>Next open · 5 bp / leg</strong>
            </div>
            <div className="hero-result" role="img" aria-label={`The frozen production policy recorded a modeled ${pct(baseExecution.total_return)} total return and ${pct(baseExecution.maximum_drawdown)} maximum drawdown under next-open execution and five basis points per traded leg.`}>
              <div>
                <span>Modeled total return</span>
                <strong>{signedPct(baseExecution.total_return)}</strong>
                <small>{execution.window.start} — {execution.window.end}</small>
              </div>
              <div>
                <span>Maximum drawdown</span>
                <strong>{signedPct(baseExecution.maximum_drawdown)}</strong>
                <small>Annualized volatility {pct(baseExecution.annualized_volatility)}</small>
              </div>
              <p>The same frozen policy remained positive at {signedPct(severeExecution.total_return)} when the modeled cost rose to 25 basis points per traded leg.</p>
            </div>
            <figcaption>
              Adjusted-OHLC theoretical ledger; fractional next-open DAY-order assumption. Consumed retrospective evidence—not a broker fill, options P&amp;L, alpha claim or forecast. SPY returned {signedPct(baseExecution.spy_total_return)} over the same adjusted path.
            </figcaption>
          </figure>

          <dl className="hero-metrics" aria-label="Headline execution and reproducibility results">
            <div>
              <dt>25 bp cost stress</dt>
              <dd>{signedPct(severeExecution.total_return)}</dd>
              <p>Positive after 25× the one-basis-point case</p>
            </div>
            <div>
              <dt>$300 shadow</dt>
              <dd>{compactUsd.format(smallAccount.ending_equity_usd)}</dd>
              <p>From {compactUsd.format(smallAccount.initial_equity_usd)} after minimum-order and fee constraints</p>
            </div>
            <div>
              <dt>Runtime closure</dt>
              <dd>{attempt.bound_runtime_source_count} <small>files</small></dd>
              <p>Hash-bound before the first eligible signal</p>
            </div>
            <div>
              <dt>Public verification</dt>
              <dd>{attempt.public_get_count} <small>checks</small></dd>
              <p>Fixed unauthenticated GitHub reads; workflow passed</p>
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
                <p className="kicker">Execution evidence</p>
                <h2>The production policy remained positive when we made the backtest harder to flatter.</h2>
              </div>
              <p>
                A consumed next-open audit replaced the policy's historical-close fill assumption, charged every absolute
                traded SPY and BIL leg, and repeated the ledger at one, five and 25 basis points. The policy returned
                {" "}{signedPct(baseExecution.total_return)} at five basis points and {signedPct(severeExecution.total_return)} at 25;
                SPY returned {signedPct(baseExecution.spy_total_return)} over the same adjusted path.
              </p>
            </div>

            <aside className="production-clarifier" aria-labelledby="production-title">
              <div className="production-copy">
                <p className="kicker">The fixed production book</p>
                <h3 id="production-title">A cautious SPY/BIL policy, audited as it would be queued.</h3>
                <p>
                  Three lagged trend horizons set the SPY fraction; a 10% volatility target scales it; BIL receives the
                  remainder. Signals are formed at close and the audit assumes fractional market orders at the next open.
                  The result supports execution resilience and downside control, not a claim of market-beating alpha.
                </p>
              </div>
              <dl className="production-metrics">
                <div>
                  <dt>Next-open return · 5 bp</dt>
                  <dd>{signedPct(baseExecution.total_return)}</dd>
                  <p>{pct(baseExecution.annualized_return)} annualized</p>
                </div>
                <div>
                  <dt>Maximum drawdown · 5 bp</dt>
                  <dd>{signedPct(baseExecution.maximum_drawdown)}</dd>
                  <p>{pct(baseExecution.annualized_volatility)} annualized volatility</p>
                </div>
                <div>
                  <dt>Return · 25 bp stress</dt>
                  <dd>{signedPct(severeExecution.total_return)}</dd>
                  <p>{signedPct(severeExecution.maximum_drawdown)} maximum drawdown</p>
                </div>
                <div>
                  <dt>Modeled $300 account</dt>
                  <dd>{compactUsd.format(smallAccount.ending_equity_usd)}</dd>
                  <p>{smallAccount.skipped_minimum_orders} sub-$1 adjustments skipped; {compactUsd.format(smallAccount.sell_day_fees_total_usd)} fee proxy</p>
                </div>
              </dl>
              <p className="production-status">
                Same policy, same consumed {execution.window.start}–{execution.window.end} window. SPY's higher
                {" "}{signedPct(baseExecution.spy_total_return)} raw return remains visible; no order or fill is presented as performance evidence.
              </p>
            </aside>

            <div className="section-intro evidence-intro rejected-intro">
              <div>
                <p className="kicker">Why the system needs a refusal gate</p>
                <h2>The stronger-looking backtest was the one Finly declined to trust.</h2>
              </div>
              <p>
                G4 turned a modeled $100,000 into {compactUsd.format(g4EndingValue)}, versus {compactUsd.format(spyEndingValue)} for SPY,
                after the declared costs. That {compactUsd.format(historicalDollarGap)} gap is tempting—and precisely why the
                post-selection, multiple-testing and source-overlap checks matter.
              </p>
            </div>

            <HistoricalExplorer />

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
          <div className="forward-stamp" aria-label={`${attempt.bound_runtime_source_count} runtime source files publicly hash-bound before the first eligible signal`}>
            <p>Public before the first signal</p>
            <strong>{attempt.bound_runtime_source_count}/{attempt.bound_runtime_source_count}</strong>
            <span>runtime source files matched the public commit</span>
            <small>{attempt.public_get_count} fixed public checks · workflow {attempt.verification_workflow.conclusion}</small>
          </div>
          <div className="forward-copy">
            <p className="kicker">Attempt 114 · prospective proof</p>
            <h2>We froze the next test before seeing its first result.</h2>
            <p>
              Before the exclusive first-signal deadline, Finly published the exact policy, accounting, settlement and
              inference bytes in commit {attempt.publication_commit.sha.slice(0, 7)} and linked them to a successful GitHub workflow.
              The primary test now requires consecutive evidence: no skipped session, replacement window, backfill, optional
              stopping or repeat confirmatory run.
            </p>
            <dl className="forward-facts">
              <div><dt>Timely public anchors</dt><dd>0 / {attempt.required_signal_commitments}</dd></div>
              <div><dt>Reconciled settlements</dt><dd>0 / {attempt.required_settlements}</dd></div>
              <div><dt>Broker mutation</dt><dd>{attempt.assurance.broker_mutation_authorized ? "Enabled" : "Disabled"}</dd></div>
              <div><dt>Performance inference</dt><dd>{attempt.assurance.performance_inference_permitted ? "Enabled" : "Disabled"}</dd></div>
            </dl>
            <div className="forward-links">
              <a href={attempt.publication_commit.url}>Inspect the frozen commit <span aria-hidden="true">↗</span></a>
              <a href={attempt.verification_workflow.url}>Inspect the successful workflow <span aria-hidden="true">↗</span></a>
            </div>
            <p className="boundary-note">
              The publication is a reproducible GitHub platform record, not an independent cryptographic timestamp.
              Provider origin, broker execution and future performance remain unverified.
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
