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
  #text(size: 10.5pt, style: "italic")[A mathematical specification of reduction-only model authority,]
  #linebreak()
  #text(size: 10.5pt, style: "italic")[defined-risk option compilation, and restart-safe Alpaca execution]
  #v(10pt)
  Bruce Wen · Brandeis University · #link("mailto:bwen412@brandeis.edu")[#text("bwen412@brandeis.edu")]
  #linebreak()
  31 August 2026
]

#v(8pt)
#noindent[
  *Abstract.* Finly is a paper-trading agent built around a narrow division of authority: a language model may interpret public information, but it may not create financial exposure. A deterministic policy first computes the maximum direction and size the system is willing to consider. Model evidence can reduce that envelope or veto the decision; it cannot enlarge it. Code then enumerates defined-risk option spreads, values each candidate under two scenario models, sizes maximum loss, and binds one exact order to a short-lived cryptographic permit. A restart-safe state machine submits through Alpaca and reconciles the broker before advancing.

  The competition account also holds a separate, frozen four-fund allocation called *Finly Core* (internal research identifier: G4). In a causal 2013--2026 simulation with five-basis-point one-way costs, a modeled \$10,000 became \$106,711 versus \$68,082 in SPY, the fund used here to represent the S&P 500. Finly Core and the options agent are deliberately not presented as one strategy: the former motivates the forward experiment; the latter demonstrates controlled AI delegation. At the first measured close, the paper account finished \$95.32 above its \$100,000 baseline while the same-clock SPY baseline was \$57.99 below, a \$153.31 difference. The contribution is therefore architectural as well as empirical: every capital-bearing decision has a rules-based owner, and every broker mutation can be traced to the evidence, policy, and risk state that authorized it.
]

= The problem: useful judgment without unbounded authority

The convenient design for an “AI trader” is also the hardest to audit: one model reads text, chooses a product, sizes the trade, and emits an order. Those steps fail for different reasons. A wrong interpretation is not the same defect as a stale quote, an oversized loss, or a duplicated broker call. Finly treats them as different computational objects.

Let $cal(E)_t$ denote the evidence available at time $t$, $u_t in [0,1]$ the deterministic exposure cap, $m_t$ a bounded model assessment, $c_t$ a compiled candidate, and $o_t$ the broker order. The system is a composition

$
  cal(E)_t arrow.r A_t arrow.r d_t arrow.r c_t arrow.r pi_t arrow.r o_t,
$ <eq:pipeline>

where $A_t$ is deterministic aggregation, $d_t$ is the permitted direction, and $pi_t$ is a one-use permit. The model contributes to $A_t$ but never receives the account state, candidate list, quantity, credentials, permit key, or mutation tool. This yields three separable claims:

- *economic claim:* a frozen rule produced a measurable historical path;
- *decision claim:* the model's authority is monotone and reduction-only;
- *execution claim:* only a fresh, state-bound permit can reach Alpaca.

The remainder derives those three claims and states where the available evidence stops.

#pagebreak()

= Finly Core: the frozen allocation

Finly Core supplies the competition account's equity allocation. It is not the direction model for the options branch. Its universe is QQQ, a fund tracking the Nasdaq-100, and the original nine Select Sector SPDR funds. On an eligible signal close $t$, it computes twelve-to-six-month momentum

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

= Reduction-only model evidence

The options branch begins from a separate long-only SPY/BIL authority. For horizons $h in {21,63,252}$,

$
  x_h(t) = ln frac("SPY"_t, "SPY"_(t-h)) - ln frac("BIL"_t, "BIL"_(t-h)),
$ <eq:excesstrend>

$
  q_t = frac(1,3) sum_h bb(1)[x_h(t) > 0],
  quad v_t = min(1, frac(0.10, sigma_(20,t))),
  quad u_t = q_t v_t.
$ <eq:econcap>

Thus $u_t$ is an unlevered bullish cap; it is zero when the deterministic policy does not authorize risk. Live market evidence contributes

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

where $b_j$ is a fixed base weight and the remaining factors encode declared quality, freshness, calibration, and independence. The live language-model path receives canonical public Alpaca news and returns only bounded event scores plus short rationales. Live market and option data come from Alpaca. Prediction-market evidence appears only in the synthetic interactive demonstration; it does not enter the live competition runner. Age weighting is $exp(-"hours"/24)$; the aggregate is shrunk by $0.65$.

Let $d_D$ be the direction derived only from deterministic families. Adverse model evidence produces

$
  g_t = "clip"(1 - sum_(j: m_j lt 0) frac((-m_j) a_j, 0.25), 0, 1),
$ <eq:modelgate>

and the authorized score is

$
  d_t = min(u_t, max(0,d_D)) g_t.
$ <eq:reduction>

#proposition("model evidence cannot increase financial authority")[
For any fixed deterministic state $(u_t,d_D)$ and any admissible event assessment, $0 <= d_t <= u_t$. Replacing an event score by a more supportive value cannot raise $d_t$ above $min(u_t,max(0,d_D))$.

*Proof.* By construction $g_t in [0,1]$ and $min(u_t,max(0,d_D)) in [0,u_t]$. Their product therefore lies in $[0,u_t]$. Supportive scores are absent from the penalty sum in @eq:modelgate, so they cannot create authority beyond the deterministic envelope. $square$
]

#figure(
  image("../../public/figures/technical-paper/authority-envelope.svg", width: 53%),
  caption: [Reduction-only authority. Negative event evidence can shrink a deterministic cap; supportive evidence cannot lift the cap.],
) <fig:authority>

This is the central safety property. Schema validation controls the shape of the model output; @eq:reduction controls its economic consequence.

#pagebreak()

= Defined-risk option compilation

Once $d_t$ passes direction, coverage, and agreement gates, rules-based code enumerates same-expiry SPY vertical debit spreads. A vertical debit spread buys one option and sells another with the same expiry, fixing maximum loss before submission. The competition path is bullish-or-`NO_TRADE`: it requires $d_t >= 0.18$, evidence coverage at least 0.35, agreement at least 0.55, a decision no older than 30 minutes, and a final SPY weight of at least 0.50. It evaluates entry only on the frozen five-session schedule after the relevant close. Quotes must also pass age, feed, spread, open-interest, tradability, and days-to-expiry checks. Width $W$ is between \$1 and \$15. With a \$0.03 allowance on each leg, entry debit is

$
  D = "ask"_("long") - "bid"_("short") + 2(0.03).
$ <eq:debit>

Candidates require $0 < D < W$. For one contract,

$
  L = 100D, quad G = 100(W-D), quad frac(G,L) >= 1.25,
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
  caption: [Payoff of the published synthetic SPY 560/550 bear-put compiler fixture. Debit \$3.66 fixes the one-contract loss at \$366 before any order is considered. Because the competition guard is bullish-only, this fixture cannot authorize a live competition trade.],
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

and requires $"CEV" >= max(10,0.06L)$ dollars and worst-model probability of profit at least $0.53$. Quantity is

$
  Q = min(4, floor(frac(min(f E,500),L))),
$ <eq:size>

with $f=0.005$ normally and $f=0.0025$ at half risk. New plus open defined risk may not exceed $0.03E$.

#pagebreak()

= Challenge, permit, and broker state

Passing the expected-value gate is necessary but insufficient. Finly removes each evidence family in turn and applies 32 deterministic Halton perturbations to evidence scores, spot, IV, history scale, interest rate, horizon, and debit. A candidate survives only if direction does not flip, the trade rate stays above 80 percent, the same structure appears in at least 75 percent of cases, and the fifth-percentile conservative value remains positive. The published synthetic fixture passed four of four family removals and 32 of 32 perturbations, with \$366 maximum loss and \$634 maximum gain.

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

Verification recomputes both values with timing-safe equality, requires paper mode and `paper_submit` scope, checks a 30-second time-to-live, and binds the exact account, market snapshot, candidate, quantity, loss reservation, and desired order. A permit is not general permission; any changed field creates a different body and invalidates @eq:hmac.

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

The options lifecycle is separate:

#block[
  #set text(size: 8.1pt)
$
  "CREATED" arrow.r "ENTRY_ACCEPTED" arrow.r "POSITION_OPEN"
  arrow.r "EXIT_REQUIRED" arrow.r "EXIT_ACCEPTED" arrow.r "CLOSED",
$ <eq:optionstates>
]

with cancellation, error, and frozen branches. It additionally requires the fresh permit in @eq:hmac and a forced exit by the configured deadline. The two machines share Alpaca read-back and duplicate-prevention rules, but their states are not interchangeable.

#codeblock[
*Algorithm 2 — One conservative execution cycle*

1. Authenticate the encrypted checkpoint and frozen protocol.
2. Read Alpaca clock, account, positions, orders, and asset eligibility.
3. Persist ORDER_PENDING and the deterministic client-order identifier.
4. Submit exactly one permitted paper mutation.
5. If acknowledgement is absent, query that identifier; never blind-resubmit.
6. Read back quantity, price, status, and notional.
7. Advance only after reconciliation; otherwise defer or freeze.
]

This ordering addresses the ambiguous-acknowledgement failure: if the runner dies after Alpaca accepts an order but before the response is stored, the next process recovers the same identifier instead of creating a duplicate. GitHub Actions provides the cloud clock; Alpaca's market clock and the in-process authorization window, not the scheduler, decide whether mutation is permitted [5].

#pagebreak()

= Quantitative evidence

The principal historical comparison uses aligned adjusted closes from 2 January 2013 through 27 August 2026 and the causal timing in Algorithm 1. Both Finly Core and SPY begin with \$10,000 and pay five basis points for one-way turnover.

#figure(
  image("../../public/figures/technical-paper/g4-wealth-drawdown.svg", width: 98%),
  caption: [Modeled wealth and drawdown under an identical date, lag, capital, and cost convention. Finly Core is the frozen historical allocation; it is not the options agent's realized P&L.],
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

The \$38,629 ending-wealth difference is the strongest simple description of the ledger. It should be read with two facts. First, Finly Core did not beat QQQ over the full interval; part of its return is an explicit growth allocation. Second, the candidate did not pass its selection-adjusted promotion gate: the Deflated Sharpe probability was 3.75 percent and the worst familywise bootstrap $p$-value was 37.18 percent. The result is therefore sufficiently strong to motivate a forward paper experiment, but not to establish expected future outperformance.

The verified \$100,000 Alpaca paper account supplies a separate operational observation. At the first exact 4:00 p.m. ET close, account equity was \$100,095.32. A same-\$100,000 raw-price SPY baseline was \$99,942.01, giving a \$153.31 difference. The reconciliation record contains 15 broker *fill events* from four stock orders and zero external cashflows [8]. No live options position existed, so this is evidence for deployment and measurement, not realized options profitability.

The public verification run discovered 809 tests: 807 passed, none failed, and two were skipped [9]. Tests cover evidence separation, payoff arithmetic, scenario determinism, source removal, perturbation stability, risk ceilings, HMAC scope, stale permits, client-order recovery, state encryption, causal backtest timing, cost parity, and submission artifacts. Tests establish implemented invariants; they do not turn one forward session into a forecast.

#pagebreak()

= Discussion and reproducibility

Finly's novelty is not another request for a model to “pick a stock.” It is a narrower contract between probabilistic interpretation and deterministic finance. The model can add context where rules are brittle, but @eq:reduction prevents persuasive text from manufacturing exposure. The compiler can search an option chain, but @eq:riskreward, @eq:cev, and @eq:size make the downside explicit before a candidate exists. The executor can mutate the broker, but @eq:hmac binds the permission to one state and one order.

This separation also makes failure legible. A forecast error belongs to the evidence layer; a payoff error belongs to the compiler; an oversized order belongs to risk; a repeated call belongs to the state machine. Each layer can be tested without pretending the others are correct.

The principal limitations are selection bias in Finly Core, vendor differences between historical Yahoo adjusted closes and the Alpaca signal panel, simplified close execution and fixed costs, approximation error in the two option scenario models, the possibility of language-model misinterpretation, and the short forward window. Defined loss bounds the consequence of a wrong trade; it does not make the trade right.

The complete implementation, tests, evidence JSON, and build sources are public. A clean checkout uses:

#codeblock[
`npm ci`

`npm run verify`
]

The technical boundary is inspectable in the source modules for the frozen Finly Core (`G4`) engine, the separate SPY/BIL economic authority, signal aggregation, option compiler, risk certificate, stability suite, and both broker lifecycles [6,10]. The PDF figures are generated from the same public data used by the website and deck.

== References

#set text(size: 8.1pt)
#set par(first-line-indent: 0em, leading: 0.4em, justify: false)

[1] T. J. Moskowitz, Y. H. Ooi, and L. H. Pedersen. “Time Series Momentum.” _Journal of Financial Economics_ 104 (2012), 228--250. #link("https://doi.org/10.1016/j.jfineco.2011.11.003")[doi:10.1016/j.jfineco.2011.11.003].

[2] D. H. Bailey and M. López de Prado. “The Deflated Sharpe Ratio.” _Journal of Portfolio Management_ 40 (2014), 94--107. #link("https://doi.org/10.3905/jpm.2014.40.5.094")[doi:10.3905/jpm.2014.40.5.094].

[3] H. White. “A Reality Check for Data Snooping.” _Econometrica_ 68 (2000), 1097--1126. #link("https://doi.org/10.1111/1468-0262.00152")[doi:10.1111/1468-0262.00152].

[4] F. Black and M. Scholes. “The Pricing of Options and Corporate Liabilities.” _Journal of Political Economy_ 81 (1973), 637--654. #link("https://doi.org/10.1086/260062")[doi:10.1086/260062].

[5] Alpaca. “Official MCP Server.” #link("https://docs.alpaca.markets/us/docs/alpaca-mcp-server")[docs.alpaca.markets].

[6] Finly. “Quantitative release gate and G4 wealth ledger.” #link("https://github.com/owlsowo/finly-bot/tree/main/research")[research source] and #link("https://owlsowo.github.io/finly-bot/data/g4_wealth_drawdown.json")[public series].

[7] Finly. “Frozen competition protocol.” #link("https://github.com/owlsowo/finly-bot/blob/main/config/g4-official-production.json")[configuration record].

[8] Finly. “First-session same-clock measurement.” #link("https://owlsowo.github.io/finly-bot/data/competition_forward_profit_2026_08_31.json")[public evidence].

[9] Finly. “Automated verification.” #link("https://github.com/owlsowo/finly-bot/actions")[GitHub Actions].

[10] Finly. “Implementation.” #link("https://github.com/owlsowo/finly-bot")[github.com/owlsowo/finly-bot].
