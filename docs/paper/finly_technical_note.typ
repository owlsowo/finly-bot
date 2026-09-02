#set page(
  paper: "us-letter",
  margin: (x: 0.78in, top: 0.68in, bottom: 0.66in),
  header: context align(right)[
    #text(size: 7.5pt, fill: luma(95), tracking: 0.4pt)[FINLY / TECHNICAL NOTE]
  ],
  footer: context align(center)[
    #text(size: 8pt, fill: luma(95))[#counter(page).display("1")]
  ],
)

#set text(font: "New Computer Modern", size: 9.6pt, lang: "en")
#set math.equation(numbering: "(1)", supplement: [Equation])
#set par(justify: true, leading: 0.54em, first-line-indent: 1.1em)
#set heading(numbering: "1.", outlined: true)
#show heading.where(level: 1): it => block(above: 13pt, below: 6pt)[
  #set text(size: 13.2pt, weight: "bold")
  #it
]
#show heading.where(level: 2): it => block(above: 9pt, below: 4pt)[
  #set text(size: 10.4pt, weight: "bold")
  #it
]
#show figure.caption: it => block(above: 4pt, below: 7pt)[
  #set text(size: 8.2pt)
  #it
]
#show link: set text(fill: rgb("174f45"))

#let noindent(body) = block[#set par(first-line-indent: 0em); #body]
#let small(body) = text(size: 8.2pt, body)
#let proposition(title, body) = block(
  above: 7pt,
  below: 7pt,
  inset: (left: 9pt, right: 7pt, y: 6pt),
  stroke: (left: 1.4pt + luma(35)),
)[
  #set par(first-line-indent: 0em)
  *Proposition (#title).* #body
]
#let codeblock(body) = block(
  width: 100%,
  inset: 8pt,
  above: 7pt,
  below: 7pt,
  fill: luma(247),
  stroke: 0.45pt + luma(190),
)[
  #set text(font: "Menlo", size: 7.8pt)
  #set par(justify: false, leading: 0.48em, first-line-indent: 0em)
  #body
]
#let source(body) = block(above: 2pt, below: 6pt)[
  #set text(size: 7.5pt, fill: luma(80))
  #set par(first-line-indent: 0em, justify: false)
  #body
]

#align(center)[
  #v(4pt)
  #text(size: 20pt, weight: "bold")[Finly: Controlled Delegation for]
  #linebreak()
  #text(size: 20pt, weight: "bold")[AI-Assisted Trading]
  #v(7pt)
  #text(size: 10.5pt, style: "italic")[A mathematical specification of one strategy with coordinated sleeves,]
  #linebreak()
  #text(size: 10.5pt, style: "italic")[defined-risk option compilation, and restart-safe Alpaca execution]
  #v(10pt)
  Bruce Wen · Brandeis University · #link("mailto:bwen412@brandeis.edu")[#text("bwen412@brandeis.edu")]
  #linebreak()
  2 September 2026
]

#v(8pt)
#noindent[
  *Abstract.* In a 2013--2026 historical simulation after modeled trading costs, \$10,000 became \$106,711 with Finly's four-fund allocation rule and \$68,082 with SPY, a \$38,629 difference in ending wealth. That result supplied the economic case for one autonomous paper-trading strategy with two coordinated execution sleeves and a narrow division of authority: a language model may interpret public information, but it may not create financial exposure. In the live options policy, fresh SPY price momentum owns the sign, while the option surface and model-assessed news may confirm, reduce, or veto that bounded view but cannot reverse it. The three outcomes are a bullish call spread, a bearish put spread, or no trade. A separately frozen long-horizon SPY/BIL receipt must also certify a risk-on state. Code then enumerates defined-risk bull-call or bear-put spreads, values each candidate under two scenario models, limits entry to one contract and at most \$500 of loss, and binds one exact order to a short-lived cryptographic permit. A restart-safe state machine submits through Alpaca and reconciles the broker before advancing.

  The allocation sleeve, called *Finly Core* (internal research identifier: G4), is a frozen four-fund rule. The coordinated options sleeve uses its own direction model and risk account so that the two sleeves remain independently auditable without becoming separate competition strategies. Through the September 2 close, the complete paper account finished \$141.24 above its \$100,000 baseline while the same-clock SPY baseline was \$284.76 below, a \$426.00 difference after 15 ETF fill events. The historical and paper results are measured separately. Together they make the contribution architectural as well as empirical: every capital-bearing decision has a rules-based owner, and every broker mutation can be traced to the evidence, policy, and risk state that authorized it.
]

= The problem: useful judgment without unbounded authority

The convenient design for an “AI trader” is also the hardest to audit: one model reads text, chooses a product, sizes the trade, and emits an order. Those steps fail for different reasons. A wrong interpretation is not the same defect as a stale quote, an oversized loss, or a duplicated broker call. Finly treats them as different computational objects.

Let $cal(E)_t$ denote the evidence available at time $t$, $u_t in [0,1]$ the deterministic exposure cap, $m_t$ a bounded model assessment, $c_t$ a compiled candidate, and $o_t$ the broker order. The system is a composition

$
  cal(E)_t arrow.r A_t arrow.r d_t arrow.r c_t arrow.r pi_t arrow.r o_t,
$ <eq:pipeline>

where $A_t$ is deterministic aggregation, $d_t$ is the permitted direction, and $pi_t$ is a one-use permit. The model contributes to $A_t$ but never receives the account state, candidate list, quantity, credentials, permit key, or mutation tool. This yields three separable claims:

- *economic claim:* a frozen rule produced a measurable historical path;
- *decision claim:* price momentum owns sign while option and model evidence are confirmation-only;
- *execution claim:* only a fresh, state-bound permit can reach Alpaca.

The remainder derives those three claims and states where the available evidence stops.

== Versioned live-policy provenance

The allocation rule, its historical ledger, and the frozen long-horizon SPY/BIL research artifacts were not revised. After the original options policy repeatedly produced `NO_TRADE`, Finly activated bidirectional live policy v2 at 3:28:21 UTC and then a prospective asymmetric-payoff calibration at 4:08:18 UTC on 2 September 2026. The current cloud workflow, revision `d8e1fcc`, pins implementation `318c943`: fresh market momentum can select a bounded bullish or bearish view; a candidate must show positive conservative value, at least 1.25-to-1 reward/risk, and at least 45 percent modeled probability of profit. The frozen economic receipt remains a freshness and risk-on guard. The \$500 loss ceiling, paper-only scope, preflight, one-use certificate, idempotent client-order identifier, and broker reconciliation remained hard controls. Earlier decisions and P&L remain attributed to the policy revision that produced them. No live options fill is claimed.

#pagebreak()

= Finly Core: the coordinated allocation sleeve

Finly Core supplies the four-fund sleeve of the competition strategy. The coordinated options sleeve uses a distinct direction model rather than inferring its direction from the Core backtest. The Core universe is QQQ, a fund tracking the Nasdaq-100, and the original nine Select Sector SPDR funds. On an eligible signal close $t$, it computes twelve-to-six-month momentum

$
  m_s(t) = ln frac(P_(s,t-126), P_(s,t-252)),
$ <eq:g4momentum>

ranks the sectors by $m_s(t)$, and selects the first three (alphabetical order breaks exact ties). The research target is

$
  w_s^star(t) = cases(
    1/2 & "if " s = "QQQ",
    1/6 & "if " s " is a selected sector",
    0   & "otherwise".
  )
$ <eq:g4weights>

The competition transform multiplies risky weights by $0.97$ and leaves three percent in cash. The frozen selection was QQQ, XLB, XLE, and XLV, producing exact target fractions $0.485$, $0.1616667$, $0.1616667$, $0.1616667$, and $0.03$ cash.

#codeblock[
*Algorithm 1 — Causal Finly Core allocation*

1. At close $t$, compute @eq:g4momentum from observations available through $t$.
2. Queue the target @eq:g4weights; do not earn the return into close $t$.
3. Execute the queued target at close $t+1$.
4. First earn the return from $t+1$ to $t+2$.
5. On non-rebalance days, carry the drifted holdings.
]

If $w_i^-(t+1)$ is the portfolio immediately before execution, one-way turnover and modeled cost are

$
  tau_(t+1) = sum_i abs(w_i^star(t) - w_i^-(t+1)),
  quad C_(t+1) = tau_(t+1) frac(b, 10000).
$ <eq:turnover>

For asset return $R_i(t+1,t+2)$, the net portfolio return and next drifted weight are

$
  r_(t+2) = sum_i w_i(t+1) R_i(t+1,t+2) - C_(t+1),
$ <eq:g4return>

$
  w_i^-(t+2) = frac(w_i(t+1) [1 + R_i(t+1,t+2)], 1 + sum_j w_j(t+1) R_j(t+1,t+2)).
$ <eq:drift>

Each standalone window begins from cash and charges both entry and terminal liquidation. SPY receives the same dates, lag, initial capital, and cost convention. This matters: without the two-close causal lag, the signal would earn a return that was already used to form the rank.

The design follows the empirical motivation for delayed momentum [1], but the exact universe, lookback, gap, and QQQ core were selected through research. The historical path is therefore a measured property of the frozen ledger, not an unbiased estimate of future alpha. Finly separately applies a Deflated Sharpe and maximum-statistic bootstrap audit [2,3]; the raw result did not pass statistical promotion.

As a distinct stress test, a 1927--2007 industry-proxy reconstruction covered 21,218 public market days, annualized 13.37 percent versus 9.48 percent for its market proxy, and remained positive at all 21 tested trading-day schedule offsets. It passed eight of nine precommitted gates. The nominal one-sided bootstrap $p$-value was 0.0024, but the 201-trial Bonferroni adjustment produced 0.4824 and the deflated-Sharpe probability was 0.718, below the required 0.95. This proxy is cross-era evidence for the rule's shape, not independent validation or a reconstruction of modern ETF trades.

#pagebreak()

= Signed live direction under a frozen risk-on guard

The coordinated options sleeve retains a distinct long-only SPY/BIL rule as a long-horizon risk-on guard. For horizons $h in {21,63,252}$,

$
  x_h(t) = ln frac("SPY"_t, "SPY"_(t-h)) - ln frac("BIL"_t, "BIL"_(t-h)),
$ <eq:excesstrend>

$
  q_t = frac(1,3) sum_h bb(1)[x_h(t) > 0],
  quad v_t = min(1, frac(0.10, sigma_(20,t))),
  quad w_t = q_t v_t.
$ <eq:econcap>

The frozen receipt is fresh only after its own point-in-time and hash checks. Live options entry additionally requires $w_t >= 0.50$. It does not choose the short-horizon sign. Instead it supplies bounded directional capacity

$
  u_t = 0.5 + 0.5 abs(w_t - 0.5),
$ <eq:livecapacity>

and otherwise returns `NO_TRADE`. Fresh market evidence alone chooses sign through

$
  z_t = 0.65 frac(M_5, sigma sqrt(5)) + 0.35 frac(M_20, sigma sqrt(20)),
  quad d_("market",t) = tanh(z_t/2),
$ <eq:marketsignal>

and the option surface contributes

$
  d_("surface",t) = -tanh frac("IV"_("put")-"IV"_("call"), 0.035).
$ <eq:surface>

For evidence family $j$, its effective weight is

$
  a_j = b_j q_j f_j c_j i_j,
$ <eq:effectiveweight>

where $b_j$ is a fixed base weight and the remaining factors encode declared quality, freshness, calibration, and independence. The live language-model path receives canonical public Alpaca news and returns only bounded event scores plus short rationales. Live market and option data come from Alpaca. Prediction-market evidence appears only in the synthetic interactive demonstration; it does not enter the live competition runner. Age weighting is $exp(-"hours"/24)$; the event aggregate is shrunk by $0.65$.

Let $s_t = "sign"(d_("market",t))$. Only option-surface or event evidence opposing that sign creates the confirmation penalty

$
  g_t = "clip"(1 - sum_(j in {"surface","events"}: "sign"(d_j)=-s_t)
  frac(abs(d_j) a_j, b_j), 0, 1),
$ <eq:modelgate>

and the authorized score is

$
  d_t = s_t min(u_t, abs(d_("market",t))) g_t.
$ <eq:reduction>

#proposition("non-market evidence cannot reverse price sign or enlarge its cap")[
For any fixed market state and admissible option/news assessments, $abs(d_t) <= min(u_t,abs(d_("market",t)))$. If $d_t != 0$, then $"sign"(d_t)=s_t$. Supportive option or event scores may improve agreement but cannot lift the magnitude above the price-momentum envelope.

*Proof.* By construction $g_t in [0,1]$ and $min(u_t,abs(d_("market",t))) in [0,u_t]$. Multiplication by $s_t$ fixes the sign, while multiplication by $g_t$ can only preserve or reduce magnitude. $square$
]

#figure(
  image("../../public/figures/technical-paper/authority-envelope.svg", width: 53%),
  caption: [Magnitude envelope after market momentum chooses sign. Opposing option or news evidence may shrink the view to zero; neither family can reverse the sign or lift the deterministic cap.],
) <fig:authority>

This is the central allocation-of-authority property. Schema validation controls the shape of the model output; @eq:reduction controls its economic consequence. Bullish market momentum can compile a call spread, bearish momentum can compile a put spread, and neutral or insufficiently confirmed evidence becomes `NO_TRADE`.

= Defined-risk option compilation

Once $d_t$ passes direction, coverage, and agreement gates, rules-based code enumerates same-expiry SPY vertical debit spreads. A vertical debit spread buys one option and sells another with the same expiry, fixing maximum loss before submission. Live v2 requires $abs(d_t) >= 0.12$, evidence coverage at least 0.30, agreement at least 0.45, a decision no older than 30 minutes, and a fresh long-horizon risk-on receipt with at least 50 percent indicated SPY exposure. Positive $d_t$ selects bull-call candidates; negative $d_t$ selects bear-put candidates. Quotes must also pass age, feed, spread, open-interest, tradability, and days-to-expiry checks. Width $W$ is between \$1 and \$15. With a \$0.03 allowance on each leg, entry debit is

$
  D = "ask"_("long") - "bid"_("short") + 2(0.03).
$ <eq:debit>

Candidates require $0 < D < W$. For one contract,

$
  L = 100D, quad G = 100(W-D), quad frac(G,L) >= 1,
$ <eq:riskreward>

where $L$ and $G$ are maximum loss and maximum gain. Terminal profit for a bull-call or bear-put spread is

$
  Pi_("call")(S_T) = 100 [min(W,max(0,S_T-K_("long"))) - D],
$

$
  Pi_("put")(S_T) = 100 [min(W,max(0,K_("long")-S_T)) - D].
$ <eq:payoff>

#figure(
  image("../../public/figures/technical-paper/options-payoff.svg", width: 48%),
  caption: [Payoff of the published synthetic SPY 560/550 bear-put compiler fixture. Debit \$3.66 fixes the one-contract loss at \$366 before any order is considered. Live v2 can compile the same defined-risk structure when fresh market momentum is bearish and every hard execution check passes; this historical fixture remains synthetic.],
) <fig:payoff>

== Two-model valuation

Each candidate is valued with 2,048 deterministic paths under two models. Model A uses a directionally tilted lognormal distribution:

$
  sigma_A = max(0.08, "IV"(1+0.12v)),
$

$
  ln frac(S_h,S_0) = (0.38d - sigma_A^2/2) frac(h,252)
  + sigma_A sqrt(frac(h,252)) z.
$ <eq:modela>

Model B draws circular five-session blocks from historical SPY log returns. Its target daily volatility is

$
  sigma_(B,"daily") = [0.55 sigma_("hist") + 0.45 "IV"/sqrt(252)](1+0.12v),
$ <eq:modelb>

after which centered blocks are rescaled, their empirical mean is restored, and a $0.00115d$ per-session tilt is added. Remaining option time is never below one day. Legs are marked with Black--Scholes [4], then spread value is clipped to $[0,W]$ after two exit-slippage charges.

For model $k$, let $mu_k$ be mean profit and $"SE"_k$ its Monte Carlo standard error. Finly ranks candidates by conservative expected value

$
  "CEV" = min_k (mu_k - 1.645 "SE"_k),
$ <eq:cev>

and the live policy requires $"CEV" >= max(5,0.02L)$ dollars, worst-model probability of profit at least $0.45$, and reward-to-risk of at least $1.25$. A positive-value asymmetric spread need not win more than half the time; the value and payoff-ratio gates remain independent. Quantity is fixed at one contract when the candidate fits the live budget:

$
  Q = cases(1 & "if " L <= min(0.005E,500), 0 & "otherwise"),
$ <eq:size>

New plus open defined risk may not exceed $0.03E$. Thus a live entry is one contract, at most 0.5 percent of equity, and never more than \$500 of certified maximum loss.

= Challenge, permit, and broker state

Finly records alpha-confidence diagnostics by removing each evidence family in turn and applying 32 deterministic Halton perturbations to evidence scores, spot, IV, history scale, interest rate, horizon, and debit. Live diagnostics prohibit an opposite-sign flip, require all leave-one-family-out variants to retain the base sign when nonneutral, and summarize nonneutral direction, trade, structure, and fifth-percentile conservative-value rates. They diagnose fragility; they are not hard authorization checks. The published synthetic fixture remains a frozen compiler demonstration that passed four removals and 32 perturbations with \$366 maximum loss and \$634 maximum gain. A live `risk_certificate.v3` instead requires an eligible selected candidate, exactly one contract, loss within the \$500 and 0.5-percent budget, aggregate risk within three percent of equity, a fresh recognized quote feed, a fresh unblocked paper account, and MCP execution transport.

== A permit for one projection

The compiler still cannot submit. It constructs a canonical intent $I$, candidate snapshot $C$, order projection $O$, risk state $R$, account state $A$, market state $M$, evidence root $H_E$, and policy version $H_P$. The permit body is

$
  B = "canon"(I,C,O,R,A,M,H_E,H_P,t_("issue"),t_("expiry"),"nonce").
$ <eq:permitbody>

Its identifier and signature are

$
  "id" = "SHA256"(B),
  quad s = "HMAC-SHA256"(k,B).
$ <eq:hmac>

Verification recomputes both values with timing-safe equality, requires paper mode and `paper_submit` scope, checks a 30-second time-to-live, and binds the exact account, market snapshot, candidate, quantity, loss reservation, and desired order. The v3 certificate records alpha diagnostics but authorizes only from hard safety checks. A final broker preflight rechecks account, options level, buying power, positions, orders, quote/debit drift, and underlying drift before mutation. A permit is not general permission; any changed field creates a different body and invalidates @eq:hmac.

#proposition("projection binding")[
Assuming collision resistance of SHA-256 and unforgeability of HMAC under secret key $k$, a certificate for order $O$ cannot authorize a materially different order $O' != O$ without either failing the body-hash comparison or producing a new valid signature.
]

== Two restart-safe broker lifecycles

The cloud runner persists a signed state before every broker mutation. Finly Core's equity coordinator uses

$
  "PLANNED" arrow.r "ORDER_PENDING" arrow.r "RECONCILING"
  arrow.r "READY",
$ <eq:states>

with any hard contradiction entering `FROZEN`. One cycle may issue at most one broker-changing call.

The coordinated options sleeve uses a distinct lifecycle:

#block[
  #set text(size: 8.1pt)
$
  "CREATED" arrow.r "ENTRY_ACCEPTED" arrow.r "POSITION_OPEN"
  arrow.r "EXIT_REQUIRED" arrow.r "EXIT_ACCEPTED" arrow.r "CLOSED",
$ <eq:optionstates>
]

with cancellation, error, and frozen branches. It additionally requires the fresh permit in @eq:hmac and a forced exit by the configured deadline. At that deadline, the runner first reconciles the exact working order, cancels only after identifying that order, waits for terminal cancellation, and makes at most one deterministic replacement at a \$0.01 credit floor. The same client-order identifiers survive retries and restarts, including a lost cancellation acknowledgement. Finly never converts the close into a debit or market order. The floor bounds behavior but cannot guarantee a fill. The two machines share Alpaca read-back and duplicate-prevention rules, but their states are not interchangeable.

Entry and replacement-close placement use Alpaca's official MCP transport. Cancellation uses Alpaca's exact paper-trading REST `DELETE` endpoint, followed by the same broker read-back and reconciliation checks.

#codeblock[
*Algorithm 2 — One conservative execution cycle*

1. Authenticate the encrypted checkpoint and versioned live protocol.
2. Read Alpaca clock, account, positions, orders, and asset eligibility.
3. Persist ORDER_PENDING and the deterministic client-order identifier.
4. Submit exactly one permitted paper mutation.
5. If acknowledgement is absent, query that identifier; never blind-resubmit.
6. Read back quantity, price, status, and notional.
7. Advance only after reconciliation; otherwise defer or freeze.
]

This ordering addresses the ambiguous-acknowledgement failure: if the runner dies after Alpaca accepts an order but before the response is stored, the next process recovers the same identifier instead of creating a duplicate. GitHub Actions provides the cloud clock; Alpaca's market clock and the in-process authorization window, not the scheduler, decide whether mutation is permitted [5].

= Quantitative evidence

The principal historical comparison uses aligned adjusted closes from 2 January 2013 through 27 August 2026 and the causal timing in Algorithm 1. Both Finly Core and SPY begin with \$10,000 and pay five basis points for one-way turnover.

#figure(
  image("../../public/figures/technical-paper/g4-wealth-drawdown.svg", width: 88%),
  caption: [Modeled wealth and drawdown under an identical date, lag, capital, and cost convention. Finly Core is the four-fund sleeve's historical allocation; this is not realized options P&L.],
) <fig:wealth>

#table(
  columns: (2.15fr, 1fr, 1fr),
  inset: (x: 5pt, y: 3.5pt),
  stroke: 0.35pt + luma(190),
  align: (left, right, right),
  table.header([*Metric*], [*Finly Core*], [*SPY*]),
  [Total return], [967.11%], [580.82%],
  [Annualized return], [18.97%], [15.11%],
  [Annualized volatility], [18.01%], [16.79%],
  [Cash-excess Sharpe], [0.965], [0.826],
  [Maximum drawdown], [−28.99%], [−33.72%],
  [Ending wealth], [\$106,711], [\$68,082],
)

#source[Source: frozen public wealth ledger and quantitative release gate [6,7]. Values may differ by rounding.]

The \$38,629 ending-wealth difference is the strongest simple description of the ledger. It should be read with two facts. First, Finly Core did not beat QQQ over the full interval; part of its return is an explicit growth allocation. Second, the candidate did not pass its selection-adjusted promotion gate: the Deflated Sharpe probability was 3.75 percent and the worst familywise bootstrap p-value was 37.18 percent. The result is therefore sufficiently strong to motivate a forward paper experiment, but not to establish expected future outperformance.

The verified \$100,000 Alpaca paper account supplies the operational observation for the complete strategy. At the exact 4:00 p.m. ET close on September 2, account equity was \$100,141.24. A same-\$100,000 raw-price SPY baseline was \$99,715.24, giving a \$426.00 difference. The reconciliation record contains 15 ETF *fill events* from four orders and zero external cashflows [8]. During the September 2 session, the options sleeve completed 24 live evaluation cycles: 14 returned `NO_CERTIFIED_TRADE`, six returned `MODEL_EVIDENCE_NO_TRADE`, and four returned `OPTIONS_ENTRY_CUTOFF_NO_TRADE`; no option order or fill occurred [12]. This is evidence for deployment, measurement, and decision discipline, not realized options profitability.

The live-policy reachability check is deliberately narrower. It sampled 517 five-session SPY signal windows from 2016 through 2026 and compiled each signal against one fixed, symmetric modeled 14-day option surface. Eleven windows cleared every alpha gate: seven bullish call spreads and four bearish put spreads. Maximum loss ranged from \$440 to \$455, conservative modeled value after costs from \$10.08 to \$22.26, reward-to-risk from 2.30 to 2.41, and modeled probability of profit from 45.12 to 47.71 percent [11]. This experiment tests bidirectional signal and quote-surface eligibility. It does not use historical option quotes and therefore is not an options-return backtest.

The public verification run discovered 827 tests: 825 passed, none failed, and two were skipped [9]. Tests cover evidence separation, signed live direction, eligibility-calibration integrity, payoff arithmetic, scenario determinism, source-removal and perturbation diagnostics, risk ceilings, v3 HMAC scope, stale permits, bounded cancel/reprice exits, client-order recovery, state encryption, causal backtest timing, cost parity, and submission artifacts. Tests establish implemented invariants; they do not turn one forward session into a forecast.

= Discussion and reproducibility

Finly's novelty is not another request for a model to “pick a stock.” It is a narrower contract between probabilistic interpretation and deterministic finance. Price momentum owns the signed view; option skew and Qwen-assessed news can confirm it or make the system more cautious, while @eq:reduction prevents persuasive text from reversing the sign or manufacturing exposure. The compiler can search an option chain, but @eq:riskreward, @eq:cev, and @eq:size make the downside explicit before a candidate exists. The executor can mutate the broker, but @eq:hmac binds the permission to one state and one order.

This separation also makes failure legible. A forecast error belongs to the evidence layer; a payoff error belongs to the compiler; an oversized order belongs to risk; a repeated call belongs to the state machine. Each layer can be tested without pretending the others are correct.

The principal limitations are selection bias in Finly Core, vendor differences between historical Yahoo adjusted closes and the Alpaca signal panel, simplified close execution and fixed costs, approximation error in the two option scenario models, the possibility of language-model misinterpretation, and the short forward window. The live-policy thresholds were calibrated after a no-trade diagnostic, so they have little independent forward exposure and must not be described as proven alpha. Defined loss bounds the consequence of a wrong trade; it does not make the trade right.

The complete implementation, tests, evidence JSON, and build sources are public. A clean checkout uses:

#codeblock[
`npm ci`

`npm run verify`
]

The frozen research boundary is inspectable at revision `36ce122`; the activated prospective options implementation is inspectable at revision `318c943`, and the cloud pin at revision `d8e1fcc` [6,10]. Together those revisions expose the Finly Core (`G4`) engine, frozen SPY/BIL risk-on receipt, bidirectional options authority, signal aggregation, option compiler, v3 risk certificate, diagnostic stability suite, and both broker lifecycles. The PDF figures are generated from the same public data used by the website and deck.

#pagebreak()

== References

#set text(size: 8.1pt)
#set par(first-line-indent: 0em, leading: 0.4em, justify: false)

[1] T. J. Moskowitz, Y. H. Ooi, and L. H. Pedersen. “Time Series Momentum.” _Journal of Financial Economics_ 104 (2012), 228--250. #link("https://doi.org/10.1016/j.jfineco.2011.11.003")[doi:10.1016/j.jfineco.2011.11.003].

[2] D. H. Bailey and M. López de Prado. “The Deflated Sharpe Ratio.” _Journal of Portfolio Management_ 40 (2014), 94--107. #link("https://doi.org/10.3905/jpm.2014.40.5.094")[doi:10.3905/jpm.2014.40.5.094].

[3] H. White. “A Reality Check for Data Snooping.” _Econometrica_ 68 (2000), 1097--1126. #link("https://doi.org/10.1111/1468-0262.00152")[doi:10.1111/1468-0262.00152].

[4] F. Black and M. Scholes. “The Pricing of Options and Corporate Liabilities.” _Journal of Political Economy_ 81 (1973), 637--654. #link("https://doi.org/10.1086/260062")[doi:10.1086/260062].

[5] Alpaca. “Official MCP Server.” #link("https://docs.alpaca.markets/us/docs/alpaca-mcp-server")[docs.alpaca.markets].

[6] Finly. “Quantitative release gate and G4 wealth ledger.” #link("https://github.com/owlsowo/finly-bot/tree/36ce122/research")[research source] and #link("https://owlsowo.github.io/finly-bot/data/g4_wealth_drawdown.json")[public series].

[7] Finly. “Frozen allocation protocol and current options implementation.” #link("https://github.com/owlsowo/finly-bot/blob/36ce122/config/g4-official-production.json")[allocation record] and #link("https://github.com/owlsowo/finly-bot/blob/318c943/lib/live_economic_options_authority.mjs")[live authority].

[8] Finly. “September 2 same-clock measurement.” #link("https://owlsowo.github.io/finly-bot/data/competition_forward_profit_2026_09_02.json")[public evidence].

[9] Finly. “Automated verification.” #link("https://github.com/owlsowo/finly-bot/actions")[GitHub Actions].

[10] Finly. “Activated implementation and pinned cloud workflow.” #link("https://github.com/owlsowo/finly-bot/tree/318c943")[implementation] and #link("https://github.com/owlsowo/finly-bot/tree/d8e1fcc")[deployment pin].

[11] Finly. “Current signal and quote-surface eligibility calibration.” #link("https://owlsowo.github.io/finly-bot/data/options_policy_calibration.json")[public artifact].

[12] Finly. “September 2 live options decision record.” #link("https://owlsowo.github.io/finly-bot/data/options_live_decision_funnel_2026_09_02.json")[public artifact].
