# Finly: Controlled Delegation and the Separation of Market Judgment from Trading Authority

## Technical paper and evidence record

Bruce Wen · Brandeis University · [bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)
29 August 2026 · Evidence through 27 August 2026

## Abstract

Trading agents often collapse two questions that should be evaluated separately: whether a system can form a plausible market judgment and whether that judgment has earned authority to risk capital. Finly is organized around their separation. AI may score bounded evidence, provide a rationale, and reduce or veto a deterministic proposal. A code-owned challenge suite may remove evidence families and rerun the checks. Deterministic code retains control over direction, horizon, option structure, maximum loss, order fields, equality checks, and the final `PERMIT` or `NO_TRADE` decision. The project therefore advances a narrower claim than autonomous forecasting or execution: interpretive judgment can contribute to a trading workflow without controlling capital-bearing decisions.

The historical record is presented as a test of that distinction rather than as proof of profitability. A descriptive candidate, G4, allocated 50% to QQQ and 50% equally among the top three sector ETFs ranked by 252-to-126-session log return, rebalanced every 21 sessions. In an adjusted-close replay from 2 January 2013 through 27 August 2026, G4 returned 967.11% in total, or 18.97% annualized, compared with SPY at 580.82% and 15.11%. Yet G4 failed promotion: its Deflated Sharpe probability was 3.75% against a 95% requirement, its worst adjusted familywise p-value was 0.3718 against 0.05, the static growth-control independence gate was unsupported, and the authenticated source-overlap gate did not pass. Seven later hash-frozen but fully retrospective challengers produced no selection. G4 is not the production policy. The frozen production book is a lower-risk SPY/BIL trend-and-volatility rule that underperformed SPY's raw return in its fixed holdout while materially reducing volatility and drawdown. Both records are now consumed, and Forward Trial 1 begins with zero observations. Finly's technical contribution is therefore a smaller, inspectable trust boundary—not a claim that either historical object predicts next month's winner.

## 1. The problem: judgment is not authority

A trading system can fail in at least two different ways. It can form a poor judgment about the market, or it can grant too much authority to a judgment whose reliability has not been established. Finly focuses on the second failure mode: even if a model produces a plausible judgment, what should that judgment be allowed to control?

The distinction is epistemic before it is architectural. Evidence can support a belief without warranting an action whose consequences are financially material. In trading, apparently small fields determine concrete exposure: direction, horizon, structure, maximum loss, and ultimately what may be transmitted toward a broker. The ability to interpret evidence does not itself establish authority over those fields.

Finly therefore separates judgment from authority. AI may score a bounded evidence bundle, explain its assessment, and reduce or veto a deterministic proposal. A code-owned challenge suite removes evidence families and reruns the checks. These functions allow the model to affect whether a proposed action survives review. They do not allow it to decide what capital-bearing action should exist. Deterministic code owns direction, horizon, option structure, maximum loss, order fields, equality checks, and the final decision.

This separation changes the meaning of refusal. `NO_TRADE` is not simply what happens when the system lacks a market opinion. The system may encounter evidence that looks commercially attractive and still refuse promotion because the evidence has not earned deployment authority. The historical research creates precisely that conflict. G4 looks strong enough retrospectively that promotion is tempting. The methodological question is whether temptation is sufficient.

## 2. Related work and the narrower claim

There are legitimate reasons to take systematic trend evidence seriously. Time-series momentum provides an established intellectual context for conditioning positions on historical price trends [1]. Volatility management similarly supports the proposition that exposure can be conditioned systematically on measured risk rather than narrative confidence [2]. These literatures make it unreasonable to dismiss a trend-based candidate merely because its rule is simple. Finly does not, however, claim novelty for momentum, portfolio rotation, or risk management as such.

The harder problem appears once a researcher searches repeatedly through historical data. A strategy discovered after extensive experimentation may look persuasive partly because the research process supplied many opportunities to find something persuasive. White's Reality Check addresses the difficulty of evaluating apparent performance after specification search [3]. The Deflated Sharpe Ratio likewise corrects confidence for selection bias, multiple testing, non-normality, and the observed variability of candidate results [4]. Finly invokes these methods as reasons to be skeptical of its own most attractive output, not as evidence that a new statistical theory has been invented.

Recent agent research supplies a separate context. QFinZero presents a unified financial toolchain for language-model-based trading agents [5]. TrustTrade studies human-inspired selective consensus in an LLM trading setting [6]. Both illustrate growing interest in richer reasoning and coordination around financial decisions. Neither is treated here as a verified economic baseline for Finly, and no priority claim is made. Their relevance is conceptual: once automated reasoning participates in trading, the location of the authority boundary becomes a first-order design question.

Finly's claim is consequently narrower than “AI can trade profitably” and narrower than “this strategy beats the market.” It asks whether interpretive judgment can be incorporated while withholding control over the fields that determine capital exposure. Its empirical work asks whether that restraint survives contact with an unusually attractive retrospective result.

## 3. Controlled-delegation architecture

Finly is best understood as a division of responsibilities. Only adjusted price data enter the historical strategy. News, filings, prediction markets, congressional disclosures, and social signals remain proposed evidence sources; Finly does not count them as independent simply because they arrive through different channels. Repeated reports may share an origin, publication time may lag the event, and sensational channels may add variance rather than signal.

Second, AI operates inside a bounded evidentiary role. It may score supplied evidence, provide a rationale, and reduce or veto the deterministic proposal. A code-owned challenge step may remove one or more evidence families and rerun the assessment on a reduced basis. These permissions matter because a model that could only affirm a deterministic recommendation would add little meaningful judgment. Yet the output remains a typed assessment rather than an order.

Third, deterministic code compiles the capital-bearing intent. Direction and horizon are code-owned. So are the option structure, maximum loss, order fields, and equality checks. The model cannot substitute a different structure, enlarge the allowed loss, populate broker fields, or turn its confidence into permission. A gateway compares the code-derived intent with the echoed typed object. Any shape error, range error, stale input, mismatch, or failed gate resolves to `NO_TRADE`.

The strongest objection is that this architecture may remove the very discretion that makes an agent useful. Markets contain contextual information that fixed rules may represent imperfectly. If a model can distinguish relevant from irrelevant evidence, reconcile conflicting considerations, explain uncertainty, and revise its position under challenge, then allowing it to control more of the trade may appear more coherent than forcing its judgment through a deterministic boundary.

That objection establishes a plausible case for interpretive flexibility. It does not establish a case for execution authority. The two responsibilities have different verification properties. A rationale is an interpretive object; an order field has an exact value with an immediate operational consequence. Finly does not claim that deterministic code knows more about markets. It assigns the mechanically consequential parts of the workflow to a component whose outputs can be constrained and compared exactly. The architecture should therefore be judged as a control system: does the allocation of authority remain intact precisely when the model or the historical evidence becomes persuasive enough that relaxing it would be tempting?

## 4. Historical protocol and candidate construction

G4 supplies that test. Let `P(i,t)` be the adjusted close of sector ETF `i` on signal session `t`. Its ranking score is the older six-month log return inside a twelve-month lookback:

`m(i,t) = log(P(i,t-126) / P(i,t-252)).`

At each 21-session rebalance, the nine original sector ETFs are sorted by `m(i,t)`, with alphabetical ticker order breaking an exact tie. The portfolio assigns 50% to QQQ and divides the remaining 50% equally among the top three sectors. It is long-only with gross exposure equal to one. This is the whole allocation rule. No news, sentiment, option-chain data, or model output enters the replay.

The candidate was replayed over 3,434 sessions from 2 January 2013 through 27 August 2026 using a consumed adjusted-close ETF panel. A fresh-start allocation is established at the first eligible signal, and a five-basis-point one-way cost is applied to traded notional. SPY buy-and-hold is the disclosed benchmark. The public figure and machine-readable series use the same content-addressed evidence surface [11].

This replay is descriptive historical evidence, not a prospective investment record. G4 was selected after history was viewed. The repository records a local hash freeze of the core formula, historical partitions, and modeled costs before the first G4 output, but the local timestamp is not an independent time authority. The excess-Sharpe selection rule changed after the initial output, and later inference corrections were also introduced afterward. The current analysis is therefore not fully preregistered. It would be inaccurate to describe the promotion framework as one frozen rule set established before every observed result.

Every market interval used in this reported analysis is now consumed. There is no untouched retrospective partition within the reported dataset that could serve as an independent confirmation sample. Further slicing may reveal weaknesses, but it cannot recreate prospectivity. Research multiplicity adds a related complication. The program conservatively counts 113 effective attempts, including controls, rejected or unexecuted suggestions, invalidated runs, an aborted attempt, and reruns. That number is not equivalent to 113 independent viable strategies competing under identical conditions. The converse would also be mistaken: a heterogeneous adaptive process still creates opportunities for favorable findings. The count is a conservative record of substantial research activity, not a clean estimate of independent hypotheses.

## 5. Results, falsification, and the refusal to promote

The strongest case for promoting G4 begins with the magnitude of its historical result. It returned 967.11% in total, compared with 580.82% for SPY. Annualized return was 18.97% against 15.11%. Modeled volatility was somewhat higher at 18.01% versus 16.79%, so the return advantage did not arrive through uniformly lower measured risk. Maximum drawdown was nevertheless less severe at -28.99% versus -33.72%. Annualized notional turnover was substantially higher, 3.78x versus 0.22x.

| Consumed replay, 2013-01-02 to 2026-08-27 | G4 shadow | SPY |
| --- | ---: | ---: |
| Total return | 967.11% | 580.82% |
| Annualized return | 18.97% | 15.11% |
| Annualized volatility | 18.01% | 16.79% |
| Maximum drawdown | -28.99% | -33.72% |
| Annualized notional turnover | 3.78x | 0.22x |

At a five-basis-point one-way cost, the sign of G4's historical edge over SPY remained positive across all 21 rebalance-anchor offsets. The sign also remained positive under the tested 5, 10, and 25 basis-point cost levels. These are local sensitivity checks, not independent trials or evidence of statistical significance.

The result also carries visible growth and universe hindsight. The fixed ETF menu contains only funds still available in 2026, and QQQ is an obvious ex-post winner. Over the same consumed interval, G4's 967.11% total return trailed QQQ's 1,136.28%, while its daily gross-return correlation with QQQ was 0.961. Those diagnostics do not prove that sector rotation contributed nothing, but they make it inappropriate to relabel a strong growth exposure as independent alpha. This is one reason the static growth-control gate is outcome-determinative [11].

A deployment advocate could point to a 3.86-percentage-point annualized return difference in the consumed replay, a less severe maximum drawdown, and positive edge signs under the tested cost and schedule variants. Those are descriptive sensitivity results, not independent confirmation. Even so, continued refusal can appear less like rigor and more like an unwillingness to act on evidence. This is the strongest version of the objection because it does not require pretending that historical results guarantee the future. It asks whether the evidence is strong enough to justify provisional promotion.

Finly's answer remains no. The robustness checks answer narrower questions than the promotion tests. Rebalance offsets test dependence on calendar timing; cost scenarios test sensitivity to modeled frictions. Neither recreates a clean confirmation sample or removes the consequences of selection after repeated research.

| Promotion gate | Observed | Required | Outcome |
| --- | ---: | ---: | :---: |
| Deflated Sharpe probability | 3.75% | ≥95% | Fail |
| Worst adjusted familywise p-value | 0.3718 | ≤0.05 | Fail |
| Static growth-control independence | Unsupported | Supported | Fail |
| Authenticated source overlap | Not passed | Passed | Fail |

The locked surface records a 3.75% probability that the observed Sharpe exceeds the deflated benchmark, below Finly's 95% promotion threshold. The worst adjusted familywise p-value was 0.3718, above the 0.05 threshold. These are post-selection promotion-gate diagnostics; neither is a forecast of profitability or a clean confirmatory test. The underlying Deflated Sharpe artifact used a declared 100-trial correction and estimated trial-distribution moments from the seven eligible G4 candidates, so it should not be interpreted as a complete statistical summary of the later, heterogeneous 113-item ledger [4]. The static growth-control independence gate was unsupported, and the authenticated source-overlap gate did not pass. These corrections should not be rewritten as if the complete promotion framework existed unchanged before the output. Their role is diagnostic: once more demanding questions were asked, the return record did not support promotion.

Seven hash-frozen but fully retrospective Generation 6 challengers were evaluated; none was selected on either the primary SPY or growth-control track. Because the historical inputs and literature themes had already been seen, this is a constrained-search result, not independent out-of-sample evidence. The result does not prove that G4's historical effect is unreal. It shows that the subsequent search did not produce a candidate that satisfied the relevant comparisons.

The refusal therefore rests on a distinction between descriptive persistence and evidentiary authority. G4 remains an interesting historical hypothesis. Its performance survives selected perturbations. Those facts do not erase its post-history selection, the adaptive research process, or the absence of untouched data [3]. The engineering result is what happens next: Finly does not allow an attractive chart to rewrite the authority boundary.

## 6. Forward Trial 1

Forward Trial 1 defines the next evidence stage. A clean clone can verify its local state, but the record begins with no signal commitments and no settled outcomes. The protocol separates what must be fixed before a decision from what can be measured only after the outcome. Because a local timestamp and hash cannot prove when external data were observed, production writes, broker authority, and performance inference remain disabled until an independent pre-execution anchor exists [12].

The primary forward book is not G4. It is `tsmom_ensemble_vol`, a five-session SPY/BIL policy that combines positive 21-, 63-, and 252-session SPY-minus-BIL trends with a ten-percent volatility target. In the fixed 2 January 2025 to 28 August 2026 holdout, it returned 18.99% in total and 11.13% annualized, compared with SPY at 33.52% and 19.19%. Its annualized volatility was 8.31% rather than 17.33%, and its maximum drawdown was -5.79% rather than -18.76%. That is a genuine risk tradeoff, not raw-return outperformance. The latest research receipt proposed 95.71% SPY and 4.29% BIL, but the paper account remained in its prior defensive state and no mutation was requested.

Seven frozen books identify the production policy, the G4 shadow, SPY, QQQ, a 50/50 SPY-QQQ benchmark, BIL, and a 10% SPY volatility target. The minimum primary calculation requires 252 settlements. At genesis, none exists. This is a structural commitment, not yet chronological proof: local timestamps and hashes cannot independently establish that a signal was captured before execution. The closed external-anchor gate exists for that reason.

The zero matters because it prevents mechanics from masquerading as evidence. `TEST_ONLY` runs demonstrate schema and accounting behavior; they do not prove prospectivity, provider origin, execution, performance, or future profit. Corporate-action reconciliation, provider outcome-price reconciliation, and the independent anchor remain closed. The protocol is a place where future evidence can be recorded, not evidence that the burden has already been met.

## 7. Options and the Alpaca boundary

The historical allocation and the options architecture must remain separate. G4 is an ETF replay. Its reported return, drawdown, and turnover are not options P&L. They demonstrate neither option selection nor two-leg execution.

The options contribution is architectural. A controlled compiler converts a permitted view into a defined-risk intent while deterministic code retains direction, horizon, spread structure, exact maximum loss, and order fields. A gateway requires exact equality between the code-derived intent and the echoed typed object before any order path could proceed. The model does not author an Alpaca payload. This division is consistent with Alpaca's official options and order interfaces [7,8].

The broker evidence is also limited. The locked evidence surface records a successful authenticated read-only Alpaca paper-account check [9,11]. No broker order or fill is presented as performance evidence, and live capital is not authorized. The successful check establishes only that authenticated read-only access succeeded at that point. It is not an execution test.

Nor could the long G4 replay be converted honestly into a long options P&L by assumption. According to Alpaca's historical option-data documentation, its coverage begins in February 2024 [10], while the ETF replay begins in 2013. Historical bars also do not by themselves establish simultaneous multi-leg fills, quote width, queue position, assignment, or account-specific fees. A functioning authorization boundary and a profitable execution record are different achievements. Conflating them would reproduce the mistake Finly is designed to prevent.

## 8. Limitations and next proof

The principal limitation is adaptivity. G4 was selected after history was viewed. The repository records a local hash freeze of the formula, partitions, and costs before the first output, but the local timestamp is not an independent time authority; a selection rule and later inference corrections changed after the initial result. The analysis is not fully preregistered. No market interval used in the reported analysis remains untouched, so additional slicing of the same data may identify fragility but cannot generate a clean confirmation sample.

Second, the 113-attempt count is conservative and heterogeneous. It must not be converted into the simpler statement that 113 independent viable strategies were tested. It also cannot be used as a reason to ignore multiplicity. The defensible interpretation lies between those extremes: substantial adaptive research occurred, its effective multiplicity is difficult to summarize with one number, and inference should remain cautious.

Third, the robustness evidence has limited scope. Positive historical edge signs across 21 offsets and three cost assumptions reduce concern about calendar timing and modestly different modeled costs. They do not establish out-of-sample persistence. The Deflated Sharpe and adjusted familywise diagnostics provide reasons not to promote G4; they do not transform the earlier adaptive process into a clean confirmatory design.

Fourth, no options profitability claim follows from G4. No broker order or fill is presented as performance evidence, and the authenticated Alpaca interaction was read-only. The options work demonstrates a controlled compiler and authorization boundary. Its economics remain a separate proof stage.

Finally, Forward Trial 1 has not produced forward performance. It remains zero-row, without an independent external anchor and with production and inference disabled. The next proof is empirical and chronological: new observations must be generated after the relevant choices are committed, then reconciled to provider and broker records. Until that occurs, Finly's smaller trust boundary is the supported contribution.

## 9. Conclusion

Finly begins from a distinction that becomes difficult to preserve once historical evidence is attractive. Forming a plausible market judgment and earning authority to risk capital are not the same problem. G4 supplies the strongest internal challenge to that premise. Its disclosed replay produced 967.11% total return and 18.97% annualized return, exceeded SPY's historical return, had a less severe maximum drawdown, and retained a positive historical edge sign across 21 rebalance-anchor offsets and the tested 5, 10, and 25 basis-point cost checks.

Those results deserve to be reported. They do not deserve more authority than their methodology supports. G4 was selected after history was viewed. The analysis is not fully preregistered. The conservative count of 113 effective attempts describes a mixed research process rather than 113 independent strategies. G4 failed the Deflated Sharpe, adjusted familywise, static growth-control independence, and authenticated source-overlap gates. Seven later hash-frozen but fully retrospective challengers produced no selection. Every market interval used in the reported analysis is consumed.

The architecture applies the same reasoning to the agent. AI may contribute bounded judgment, rationale, reduction, and veto, while a code-owned suite controls the evidence-removal challenge. The model does not control direction, horizon, option structure, maximum loss, order fields, or the final permit decision. The ETF replay is not options P&L, and a read-only broker check is not evidence of execution. Forward Trial 1 remains a zero-row protocol whose production and inference gates are disabled.

Finly has not demonstrated a profitable strategy, and it does not ask the judges to pretend otherwise. What it does demonstrate is a coherent division of responsibility: AI can interpret evidence and stop a trade, while testable code controls the choices that put capital at risk. G4 is the decisive example because even the project's most persuasive historical result was not allowed to erase that boundary.

## References

[1] T. J. Moskowitz, Y. H. Ooi, and L. H. Pedersen. “Time Series Momentum.” *Journal of Financial Economics* 104(2), 2012, 228–250. [doi:10.1016/j.jfineco.2011.11.003](https://doi.org/10.1016/j.jfineco.2011.11.003).

[2] A. Moreira and T. Muir. “Volatility-Managed Portfolios.” *Journal of Finance* 72(4), 2017, 1611–1644. [doi:10.1111/jofi.12513](https://doi.org/10.1111/jofi.12513).

[3] H. White. “A Reality Check for Data Snooping.” *Econometrica* 68(5), 2000, 1097–1126. [doi:10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152).

[4] D. H. Bailey and M. López de Prado. “The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality.” *Journal of Portfolio Management* 40(5), 2014, 94–107. [doi:10.3905/jpm.2014.40.5.094](https://doi.org/10.3905/jpm.2014.40.5.094).

[5] H. Luo et al. “QFinZero: A Unified Financial Toolchain for LLM-Based Trading Agents.” *Proceedings of the 64th Annual Meeting of the Association for Computational Linguistics: System Demonstrations*, 2026. [doi:10.18653/v1/2026.acl-demo.7](https://doi.org/10.18653/v1/2026.acl-demo.7).

[6] M. Li et al. “TrustTrade: Human-Inspired Selective Consensus Reduces Decision Uncertainty in LLM Trading Agents.” arXiv:2603.22567, 2026. [arxiv.org/abs/2603.22567](https://arxiv.org/abs/2603.22567).

[7] Alpaca. “Options Trading.” Official documentation. [docs.alpaca.markets/us/docs/options-trading](https://docs.alpaca.markets/us/docs/options-trading).

[8] Alpaca. “Create an Order.” Trading API reference. [docs.alpaca.markets/reference/postorder](https://docs.alpaca.markets/reference/postorder).

[9] Alpaca. “Paper Trading.” Official documentation. [docs.alpaca.markets/us/docs/paper-trading](https://docs.alpaca.markets/us/docs/paper-trading).

[10] Alpaca. “Historical Option Data.” Official documentation. [docs.alpaca.markets/us/docs/historical-option-data](https://docs.alpaca.markets/us/docs/historical-option-data).

[11] Finly. “Submission Quantitative Evidence Surface,” 2026. Claim registry: `public/data/submission_claims_lock.json`.

[12] Finly. “Forward Trial 1 Protocol,” version 2, 2026. Verification guide: `research/FORWARD_TRIAL1.md`.
