# Finly: Controlled Delegation Before Capital Is at Risk

## Technical paper and evidence record

Bruce Wen · Brandeis University · [bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)
30 August 2026 · Evidence through 30 August 2026

## Abstract

A trading agent can fail because its market judgment is wrong. It can also fail because a plausible judgment is given more authority than the evidence warrants. Finly is built around the second problem. AI may assess a bounded evidence bundle, state reasons, and reduce or veto a deterministic proposal. It may not choose direction, horizon, option structure, maximum loss, order fields, or whether an order is permitted. Those capital-bearing decisions remain with testable code.

The project tests that division against its own strongest temptation. A retrospective challenger named G4 gained 967.11% from 2013 through August 2026, versus 580.82% for SPY, but failed four promotion gates and was never adopted. The actual frozen production policy is a lower-risk SPY/BIL trend-and-volatility rule. In a 415-observation next-open replay with five basis points charged on each traded-notional leg, it gained 15.39% with a -5.45% maximum drawdown, while SPY gained 33.52%. The policy preserved a positive 10.56% return at 25 basis points per leg; a separate one-basis-point $300 shadow ended at $351.88. Finly therefore does not claim historical raw-return dominance for the deployable policy. It claims a coherent authority boundary, a friction-aware risk result, and a publicly frozen prospective protocol capable of testing the stronger economic claim without rewriting the rules afterward.

## 1. Finly draws one line before trading begins

Most trading systems are organized around a forecast: estimate a return, convert confidence into a position, and transmit the result. Finly inserts a prior question. Which component has earned the right to decide the mechanically consequential parts of the trade?

That question matters because “the agent” is not one object in this repository. Three objects perform different jobs and support different conclusions:

| Object | What it does | What its evidence can establish |
| --- | --- | --- |
| **G4 research challenger** | Replays a fixed QQQ-and-sector rotation rule over consumed history | Whether an attractive retrospective hypothesis survives promotion tests |
| **`tsmom_ensemble_vol` production policy** | Allocates between SPY and BIL using three trend horizons and a volatility scale | Whether the frozen policy exhibits the intended risk and friction behavior |
| **Options compiler and gateway** | Converts an already-permitted view into a typed, defined-risk intent and checks exact equality | Whether AI judgment can be prevented from controlling order structure or authorization |

The separation is substantive, not cosmetic. G4 is not the policy the system would trade. The production policy does not generate the options result. The options compiler does not inherit G4's historical return. Treating them as one model would make Finly appear simpler while rendering every performance statement ambiguous.

The project's central proposition is correspondingly narrow: interpretive judgment can improve a trading workflow without controlling capital-bearing fields. This is not a claim that deterministic rules know more about markets than language models. It is a claim about verification. A rationale is an interpretive object; an order side, contract, quantity, limit price, and maximum loss have exact values and immediate operational consequences. Finly assigns those exact decisions to the component that can be constrained and compared exactly.

## 2. Prior research supports systematic signals, not unrestricted authority

Finly's production rule is deliberately conventional. Time-series momentum provides evidence that an asset's own past return can contain information about subsequent direction [1]. Volatility management provides a separate reason to reduce exposure when measured risk rises [2]. These findings justify testing a transparent trend-and-volatility policy. They do not imply that any particular backtest has discovered persistent alpha, and Finly makes no novelty claim for momentum or volatility scaling.

The research problem changes once many specifications have been considered. An adaptive search supplies repeated opportunities to find a persuasive result. White's Reality Check formalizes the resulting data-snooping concern [3]; the Deflated Sharpe Ratio addresses selection bias, multiple testing, non-normal returns, and variation across tested strategies [4]. Finly uses these ideas against its own best-looking candidate. The point is not to decorate a backtest with statistical terminology. It is to make refusal possible after a result becomes emotionally difficult to refuse.

Agentic-finance research creates a complementary problem. QFinZero presents a unified toolchain for language-model-based financial agents [5], while TrustTrade studies selective consensus among reasoning agents [6]. Such work broadens what an automated system can interpret and coordinate. It also raises the stakes of deciding where reasoning ends and authorization begins. Finly's contribution lies at that boundary: the model can challenge evidence and stop a proposal, but it cannot transform persuasiveness into exposure.

## 3. The model can challenge a trade; code alone can compose it

Finly's operating sequence contains six responsibilities. First, source adapters label evidence families rather than presenting a blended wall of text. Second, a local Llama-compatible model returns a bounded typed assessment and a rationale. Third, deterministic aggregation derives the market intent. Fourth, code compiles the exact defined-risk structure and maximum loss. Fifth, the challenge suite removes evidence families or perturbs inputs and repeats the assessment. Sixth, the gateway issues either `PERMIT` or `NO_TRADE`.

The model has meaningful but asymmetric power. It may lower a score, identify a conflict, or veto a deterministic proposal. It cannot reverse the trade, extend the horizon, substitute a contract, increase maximum loss, or populate the broker payload. The code-derived intent and the model's echoed typed object must match exactly. A stale input, unknown field, schema error, out-of-range value, or equality failure resolves to `NO_TRADE`.

The strongest objection is that this architecture may remove the discretion that makes an agent useful. Markets are contextual; a model may detect that a mechanically identical signal has different meaning under different macroeconomic or informational conditions. If its judgment is valuable enough to consult, preventing it from adjusting the structure can seem internally inconsistent.

The objection correctly identifies a cost. Finly may reject a trade that a more permissive agent would take, and it cannot use eloquence as a substitute for an unencoded action. But interpretive value and execution authority have different error surfaces. A nuanced rationale can be reviewed after the fact; an unconstrained quantity or contract can create loss before anyone resolves why it was chosen. Finly therefore treats discretion as something to earn in stages. The model receives enough authority to challenge the proposal. It does not receive authority to define the exposure it is evaluating.

## 4. One evidence convention governs every quantitative claim

The comparison basis and evidentiary boundary are stated once here. **SPY buy-and-hold is the disclosed equity comparator.** G4 is a post-selected, adjusted-close descriptive replay over consumed history. Production-policy results are consumed, theoretical adjusted-OHLC next-open ledgers: signals are formed at close *t*, fractional market orders are modeled at open *t+1*, and exposure earns the next-open-to-next-open return. They are not Alpaca fill receipts, options P&L, or evidence that Finly will beat SPY in the future. Options results are synthetic control tests plus an authenticated read-only paper-account check. Attempt 114 is a prospective design with no settled performance at the evidence date.

| Evidence object | Period or sample | Decision it supports |
| --- | --- | --- |
| G4 adjusted-close replay | 3,434 sessions, 2 Jan. 2013–27 Aug. 2026 | Reject or promote a historical challenger |
| Production next-open replay | 415 observations, 2 Jan. 2025–28 Aug. 2026 | Check implementation, costs, drawdown, and small-account feasibility |
| Options control fixtures | Synthetic spread, 4 removals, 32 perturbations | Verify that model disagreement cannot change code-owned intent |
| Attempt 114 | 254 future commitments yielding 252 settlements | Test one predeclared production-policy endpoint prospectively |

Research multiplicity is recorded conservatively. The ledger counts 113 effective attempts, but that total includes controls, invalidated runs, rejected or unexecuted suggestions, an aborted attempt, and reruns. It is not a claim that 113 independent viable strategies competed under identical conditions. It does establish that an adaptive research process occurred and that an attractive survivor should not receive naive inference.

This convention also fixes the meaning of “outperformance.” G4 exceeded SPY's historical total return in its consumed replay. The production policy did not; it exchanged upside for lower volatility and drawdown. The options compiler has no return series at all. The prospective protocol will not have a result until its fixed chronology and reconciliation requirements are complete. Keeping those sentences separate is part of the control design.

## 5. G4 shows why attractive history is not deployment authority

G4 ranks the nine original sector ETFs using an older six-month return inside a twelve-month lookback. If `P(i,t)` is the adjusted close of sector ETF `i` at signal session `t`, the score is

`m(i,t) = log(P(i,t-126) / P(i,t-252)).`

Every 21 sessions, the rule places 50% in QQQ and divides the remaining 50% equally among the three sectors with the highest score. Alphabetical ticker order breaks an exact tie. The portfolio is long-only and unlevered. No language-model output, news, prediction-market data, congressional trading record, or social signal enters the replay [7].

The result is deliberately hard to dismiss. Under a five-basis-point one-way cost on traded notional, G4 gained 967.11%, versus 580.82% for SPY. Its annualized return was 18.97%, 3.86 percentage points above SPY. It also experienced a less severe maximum drawdown, although it carried somewhat higher volatility and substantially higher turnover.

| Consumed replay, 2 Jan. 2013–27 Aug. 2026 | G4 | SPY |
| --- | ---: | ---: |
| Total return | **967.11%** | 580.82% |
| Annualized return | **18.97%** | 15.11% |
| Annualized volatility | 18.01% | 16.79% |
| Maximum drawdown | **-28.99%** | -33.72% |
| Annualized notional turnover | 3.78× | 0.22× |

The sign of G4's historical edge remained positive across all 21 rebalance-anchor offsets and at the tested 5, 10, and 25 basis-point costs. That persistence answers two useful questions: the result was not created by one weekday-like rebalance phase, and modestly different modeled frictions did not reverse it. It does not answer the selection question.

The growth-control diagnostics sharpen the problem. Over the same interval, G4 trailed QQQ's 1,136.28% total return, and its daily gross-return correlation with QQQ was 0.961. A fixed universe composed only of funds still trading in 2026 also carries survivor hindsight. Those facts do not show that rotation contributed nothing. They do show that “independent alpha” would be a stronger claim than the evidence supports.

Finly therefore required G4 to pass four promotion gates. It passed none [8].

| Promotion gate | Observed | Requirement | Decision |
| --- | ---: | ---: | :---: |
| Deflated Sharpe probability | 3.75% | ≥95% | Fail |
| Worst familywise-adjusted p-value | 0.3718 | ≤0.05 | Fail |
| Static growth-control independence | Unsupported | Supported | Fail |
| Authenticated source overlap | Not passed | Passed | Fail |

Seven later hash-frozen but fully retrospective Generation 6 challengers were then assessed; none was selected on either the SPY or growth-control track. That later search is informative about the difficulty of replacing the incumbent research object, but it cannot recreate untouched data. G4 remains a worthwhile hypothesis and a strong visual result. It is not the production policy.

## 6. The production book buys protection rather than maximum upside

The frozen production policy, `tsmom_ensemble_vol`, uses only SPY and BIL. On each five-session rebalance date, code evaluates SPY-minus-BIL log returns over 21, 63, and 252 sessions. The fraction of horizons with positive excess trend supplies the directional score. That score is multiplied by an unlevered volatility scale,

`min(1, 0.10 / annualized 20-session realized volatility),`

to obtain the SPY target weight; the remainder goes to BIL. The weight is bounded between zero and one. This construction lets the rule participate when several horizons agree, reduce equity exposure when realized volatility rises, and hold the unallocated capital in a Treasury-bill proxy [1,2,9].

Execution realism changes the headline result. The next-open engine charges each absolute SPY and BIL traded-notional leg, rather than applying one cost to an abstract net weight change. It is sell-first, cash-caps buys, supports fractional units, and rebalances every five sessions. Under five basis points per leg, the production book gained 15.39% with a -5.45% maximum drawdown. SPY gained 33.52%. Increasing the charge fivefold to 25 basis points reduced Finly's return to 10.56% but did not make it negative [9].

| Next-open adjusted ledger, 415 observations | Total return | Annualized return | Annualized volatility | Maximum drawdown | SPY total return |
| --- | ---: | ---: | ---: | ---: | ---: |
| Finly, 1 bp per traded leg | 16.38% | 9.65% | 8.12% | -5.38% | 33.52% |
| **Finly, 5 bp per traded leg** | **15.39%** | **9.08%** | **8.12%** | **-5.45%** | **33.52%** |
| Finly, 25 bp per traded leg | 10.56% | 6.28% | 8.13% | -5.80% | 33.52% |

The small-account result is a separate one-basis-point shadow, not another row from the five-basis-point ledger. It began with $300, enforced $1 minimum orders, used nine-decimal fractional quantities, sold before buying, and included a $0.70 aggregate fee proxy. Twelve sub-minimum orders were skipped. It ended at **$351.88**, a gain of 17.29%. The simulation shows that the policy's mechanics do not require institutional capital; it does not verify fractional eligibility or fills at a broker.

The decision implication is clear. An investor seeking the highest return in this consumed interval would have preferred SPY. A user seeking materially lower modeled path risk received that behavior from Finly: roughly half SPY's annualized volatility and a much smaller drawdown. The production policy should therefore be described as a defensive allocation with positive friction-stressed historical returns, not as a SPY-beating engine.

## 7. The options compiler enforces authority at the final mile

The options component begins only after a view has survived the earlier controls. Deterministic code chooses the direction and horizon, selects the defined-risk spread structure, calculates the debit and payoff bounds, and constructs the typed intent. The local model may assess the evidence for that view, but it cannot compose the order. The gateway accepts the echoed intent only on exact equality [10,11].

In the checked synthetic fixture, code constructed a one-contract SPY 560/550 bear-put debit spread at a $3.66 debit, fixing maximum loss at **$366** and maximum gain at **$634**. Four evidence-family removals and 32 perturbations produced no direction flip. Conflicting evidence produced `NO_TRADE`, `certified:false`, no permit, and a null payload [12].

An authenticated Alpaca paper-account call also verified read-only access through the official MCP surface. Mutation remained disabled; no order was submitted, accepted, executed, or filled. That is the correct stopping point for the present claim. The broker check demonstrates that the integration can reach an authenticated account without silently broadening authority. It does not convert the synthetic spread into performance evidence.

This division is the product-level result. A model can be persuasive and still fail equality. A backtest can be attractive and still fail promotion. A broker connection can succeed and still lack permission to mutate the account. The same principle survives at three levels of the system.

## 8. Attempt 114 makes the next test public before the signal

Retrospective refinement cannot answer the remaining economic question. Attempt 114 therefore freezes the incumbent production policy and its evaluation before the first signal. On 30 August 2026, commit [`38a999c`](https://github.com/owlsowo/finly-bot/commit/38a999cdf5db98f3a831d137b799ff8a48248e71) publicly recorded the protocol and a manifest binding **17 named source files**. The associated GitHub workflow completed successfully at 04:43:05 UTC, before the exclusive first-signal deadline of 20:00 UTC on 31 August. A fixed collection then made **23 unauthenticated public GET requests** to re-fetch the repository, commit, workflow, jobs, workflow file, runtime manifest, and each bound source file [13–15].

The protocol requires 254 consecutive signal commitments to create the first 252 settlements. Commitment `N` is formed after close `S_N`, modeled at close `S_N+1`, and earns the adjusted close-to-close return from `S_N+1` to `S_N+2`. Every commitment must receive a verified publication anchor before its execution close, and every outcome requires independently reconciled price lineage. There is no skipping, backfill, replacement window, policy change, repeated confirmatory test, or optional stopping.

All books begin with $100,000 in BIL and use the same five-basis-point one-way charge on each absolute SPY and BIL traded-notional leg. The primary endpoint is the mean daily net log-return difference between `tsmom_ensemble_vol` and SPY over 252 intervals. The fixed test is a one-sided, null-centered stationary block bootstrap with 4,999 resamples, a 20-session expected block, seed 20260829, and an alpha of 0.05. The session-60 checkpoint may report engineering integrity—counts, hashes, chain continuity, replay equality, ledger separation, and anchor verification—but may not reveal returns, equity, p-values, or a profitability decision.

The publication receipt has a precise assurance boundary. It records a reproducible public GitHub pointer, a successful workflow, and observed publication before the deadline. It is not an independent cryptographic timestamp, does not establish the market-data provider's origin, does not prove broker execution, and does not permit performance inference before the full 254/252 evidence requirement is met. Those limits are not boilerplate. They explain exactly what the next result must earn.

## 9. What the evidence supports now

Finly has already answered the architectural question. The model can interpret evidence and veto a proposal while deterministic code retains control of capital-bearing fields. The checked compiler fixes payoff bounds, refuses malformed or conflicting intent, and reaches an authenticated paper account without obtaining mutation authority. That is a demonstrable controlled-delegation system rather than an autonomy slogan.

The economic record is more nuanced and therefore more credible. G4 produced the project's strongest historical return, but its growth exposure, adaptive provenance, and four failed promotion gates prevented adoption. The frozen production policy then delivered what its design predicts: positive friction-stressed historical returns and much smaller drawdown, at the cost of substantial upside relative to SPY. Neither object supports a claim about next month's winner.

Attempt 114 is the bridge between those conclusions. Its public pre-signal freeze makes the policy, runtime, chronology, costs, comparator, endpoint, and stopping rule inspectable before performance exists. The next decision is no longer “find a better chart.” It is “complete the 254 commitments and 252 reconciled settlements without changing the experiment.” A positive prospective result would strengthen the economic case; a negative result would remain informative because the policy cannot be rewritten to escape it.

The unresolved questions are empirical: will the defensive risk profile persist, will the primary SPY comparison support a positive net log-return edge, and will broker-shadow accounting reconcile once actual paper receipts exist? Finly does not answer those questions early. Its contribution is to make early answers unnecessary—and later answers believable.

## References

[1] T. J. Moskowitz, Y. H. Ooi, and L. H. Pedersen. “Time Series Momentum.” *Journal of Financial Economics* 104(2), 2012, 228–250. [doi:10.1016/j.jfineco.2011.11.003](https://doi.org/10.1016/j.jfineco.2011.11.003).

[2] A. Moreira and T. Muir. “Volatility-Managed Portfolios.” *Journal of Finance* 72(4), 2017, 1611–1644. [doi:10.1111/jofi.12513](https://doi.org/10.1111/jofi.12513).

[3] H. White. “A Reality Check for Data Snooping.” *Econometrica* 68(5), 2000, 1097–1126. [doi:10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152).

[4] D. H. Bailey and M. López de Prado. “The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality.” *Journal of Portfolio Management* 40(5), 2014, 94–107. [doi:10.3905/jpm.2014.40.5.094](https://doi.org/10.3905/jpm.2014.40.5.094).

[5] H. Luo et al. “QFinZero: A Unified Financial Toolchain for LLM-Based Trading Agents.” *Proceedings of the 64th Annual Meeting of the Association for Computational Linguistics: System Demonstrations*, 2026. [doi:10.18653/v1/2026.acl-demo.7](https://doi.org/10.18653/v1/2026.acl-demo.7).

[6] M. Li et al. “TrustTrade: Human-Inspired Selective Consensus Reduces Decision Uncertainty in LLM Trading Agents.” arXiv:2603.22567, 2026. [arxiv.org/abs/2603.22567](https://arxiv.org/abs/2603.22567).

[7] Finly. “Generation 4 Quantitative Champion Report.” 2026. [`research/output/quant_champion_generation4_report.md`](../../research/output/quant_champion_generation4_report.md).

[8] Finly. “Generation 4 Robustness Report.” 2026. [`research/output/quant_champion_generation4_robustness_report.md`](../../research/output/quant_champion_generation4_robustness_report.md).

[9] Finly. “Equity Execution-Realism Audit.” 2026. [`research/output/equity_execution_realism_report.md`](../../research/output/equity_execution_realism_report.md).

[10] Alpaca. “Options Trading.” Official documentation. [docs.alpaca.markets/us/docs/options-trading](https://docs.alpaca.markets/us/docs/options-trading).

[11] Alpaca. “Create an Order.” Trading API reference. [docs.alpaca.markets/reference/postorder](https://docs.alpaca.markets/reference/postorder).

[12] Finly. “Alpaca MCP Runtime Audit.” 2026. [`docs/MCP_RUNTIME_AUDIT.md`](../MCP_RUNTIME_AUDIT.md).

[13] Finly. “Attempt 114 Prospective Profitability Protocol.” 2026. [`research/prospective_attempt114/protocol.json`](../../research/prospective_attempt114/protocol.json).

[14] Finly. “Attempt 114 Runtime Manifest.” 2026. [`research/prospective_attempt114/runtime_manifest.json`](../../research/prospective_attempt114/runtime_manifest.json).

[15] Finly. “Attempt 114 GitHub Publication Collection Receipt.” 2026. [`research/prospective_attempt114/publication_receipts/a10099fa…json`](../../research/prospective_attempt114/publication_receipts/a10099fa3931c9ef6d40446486744dde72f1efb5538515d03c015cd7c1a87fbb.json).
