# Finly: Taking Trading Evidence Seriously

## Controlled delegation, failed promotion, and the discipline of an empty forward test

Bruce Wen · Brandeis University · [bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)

30 August 2026 · Evidence through 30 August 2026

## Abstract

Trading agents are usually evaluated as if their central problem were prediction: gather information, form a view, and convert the view into a position. Finly is organized around a prior problem. What authority should an artificial intelligence receive before its judgment has been distinguished from a persuasive error? The system answers by separating interpretation from authorization. A model may assess bounded evidence, explain uncertainty, and veto a proposal. Deterministic code retains control of the economic intent, the exposure-bearing fields, and the decision to permit or refuse an action.

The evidence is intentionally adversarial to the sales pitch. In the consumed, post-selected 2013-01-02–2026-08-27 retrospective replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%; promotion was rejected because the Deflated Sharpe probability was 3.75% and the worst familywise-adjusted p-value was 37.18%. Production v1 is the frozen unlevered SPY/BIL policy targeting 10% annualized volatility: in the consumed 2025-01-02–2026-08-28 modeled next-open study it returned +15.39% at 5 bp per traded leg and +10.56% at 25 bp, versus SPY +33.52%; at 5 bp its modeled annualized volatility was 8.12% and maximum drawdown was -5.45%, so it was risk-controlled but not market-beating on total return. Attempts 115 and 116 are publicly registered future-only tests. As of 2026-08-30T08:10:52.000Z, each had zero observed outcomes, and neither supports a performance claim. The result is a trading system whose most important output is sometimes refusal: not because profit is unimportant, but because a profit claim without a defensible chain of custody is not yet knowledge.

## 1. The question before the forecast

There is an easy way to describe an agentic trading system. The system observes prices and text, reasons over both, and sends a trade to a broker. Each verb seems to follow naturally from the one before it. Yet the sequence contains an unnoticed transfer of authority. The capacity to interpret a document becomes the capacity to choose an exposure; the capacity to explain uncertainty becomes the capacity to set a maximum loss; and a linguistic output, whose merit may remain contestable, becomes a financial instruction whose effects are immediate.

Finly was designed to make that transfer visible. Its thesis is that interpretive competence and capital authority should be treated as separate engineering objects. This does not imply that models are useless in finance. It implies only that an output should not acquire additional rights merely because it is fluent. Evidence assessment is one task. Economic aggregation is another. Order construction and authorization are different again. When these tasks are collapsed into a single agent, a post hoc explanation can conceal which component actually selected the risk. When they are separated, disagreement becomes inspectable and failure can resolve to no trade.

The paper develops this claim in four stages. First, it explains why the relevant unit of evaluation is a chain of custody from evidence to authority, rather than a screenshot of terminal wealth. Second, it examines Finly's strongest retrospective challenger and the decision to reject it. Third, it turns to the frozen production policy, whose risk-controlled result is more modest and, for that reason, more informative. Finally, it considers the strongest objection to this architecture—that caution without market-beating returns is merely sophisticated inaction—and explains why the objection is partly correct but does not justify granting a model unearned authority.

The scope is narrow. Finly does not establish future profitability, next-month outperformance, verified options profit and loss, or financial superiority over another project. Those exclusions are not buried in a final limitations paragraph. They determine how the system is built, what evidence is admitted, and which sentences are allowed to reach the submission [11].

## 2. A chain of custody for trading decisions

A trade can be traced through several kinds of judgment. An evidence layer decides what was observed and when. An interpretive layer decides what the observations may mean. An economic layer translates admissible evidence into a direction and risk posture. A compiler constructs an exact, typed intent. An authorization layer checks whether the intent, constraints, and available account context agree. The distinction matters because an error at each layer requires a different remedy. Bad evidence should be excluded; uncertain interpretation should reduce confidence or veto; an invalid intent should be rejected by schema; a risk violation should fail closed.

Finly assigns model judgment to the second layer. The model may read a bounded evidence bundle, produce a structured assessment, explain why a source matters, and disagree with the deterministic proposal. It may also stop the sequence. It may not author the economic direction, substitute an instrument, enlarge loss, populate the order fields, or infer permission from its own confidence. The code-owned intent and the model's typed echo can be compared exactly; a discrepancy is treated as a failed handoff, not as creative discretion.

This asymmetry is deliberate. A model can reduce action but cannot amplify it. One might initially regard that rule as unfair: if a model is trusted to recognize danger, why is it not trusted to recognize opportunity? The answer concerns error asymmetry rather than metaphysical status. A false veto forgoes a possible trade. A false authorization creates an exposure. Both errors matter, but only one can enlarge the system's financial commitment before review. Finly therefore permits the model to contribute negative information while requiring positive authority to remain with deterministic, testable rules.

The options layer follows the same logic. It is a compiler and control boundary, not a historical profit series. Code can map an already-permitted view into a defined-risk intent, calculate its payoff bounds, and project the broker-shaped fields required for review. The model may explain or challenge the underlying evidence; it does not select a contract or turn a rationale into a submitted order. Nothing in the historical ETF studies is rewritten as options performance. This separation is easy to state and surprisingly easy to violate, especially when a single interface displays research, recommendation, and execution as though they were one event.

Recent work on financial agents helps explain why this boundary is useful. QFinZero emphasizes standardized schemas, time-aligned interfaces, logging, and deterministic replay for language-model trading tools [7]. BacktestBench similarly treats reproducible computation and grounded verification as first-order evaluation problems [8]. TrustTrade addresses a complementary weakness: models may treat heterogeneous inputs with unjustified uniform trust, so selective agreement and deterministic anchors can reduce the influence of noisy evidence [9]. Finly accepts the general premise that models can help organize and interrogate financial information. Its additional claim is institutional: better interpretation does not by itself settle who owns the exposure.

## 3. What counts as evidence

The central methodological decision is not a choice of indicator. It is the classification of evidence. A retrospective replay can answer whether a stated rule would have behaved in a particular model of the past. It cannot, merely by being rerun, become a prospective test. A modeled next-open ledger can reveal sensitivity to timing and transaction-cost assumptions. It cannot become a broker fill record. A public protocol can show that rules were fixed before eligible observations. It cannot become a performance result while its outcome set remains empty.

Finly therefore distinguishes three evidential roles. The first is exploratory: consumed history may suggest a hypothesis, expose implementation defects, or reveal a risk profile. The second is promotion: a challenger must survive the tests defined for selection and must not borrow authority from the attractiveness of its own chart. The third is prospective: a future-only protocol begins with no favorable observation and earns a result only through the chronology it declared in advance. These roles are not ranks on a single scale. They answer different questions.

This distinction becomes especially important under adaptive research. Once many ideas have been proposed, altered, discarded, or revisited, the best survivor inherits a selection problem. White's Reality Check formalizes the intuition that searching across specifications changes the meaning of the winning result [3]. The Deflated Sharpe Ratio approaches the same problem from the standpoint of observed performance, accounting for non-normal returns and the fact that a selected Sharpe ratio emerged from a larger search [4]. Harvey, Liu, and Zhu place the issue in a broader empirical-finance context: a discovery threshold that ignores the number of tried factors will admit too many false positives [5]. These methods differ, but their common lesson is straightforward. A large historical return does not carry its own warrant.

Finly's quantitative release gate turns that lesson into an enforceable writing rule. It binds the submission to a small set of source-hashed statements and refuses any financial comparison for which the required same-panel evidence is absent [11]. This is more than editorial caution. Public language is part of the system's authority surface. If a website or paper silently upgrades a consumed replay into a forecast, the presentation has bypassed the very control that the code is meant to enforce.

There is a cost to this approach. Evidence categories make the pitch less smooth. A reader must hold several objects apart: the best retrospective challenger, the frozen production policy, the options control layer, and the future-only tests. Yet collapsing them would create only a verbal simplicity. The apparent unity would depend on allowing one object's return, another object's architecture, and a third object's ambition to certify one another. Finly instead keeps the chain of custody intact.

## 4. The strongest historical result was rejected

G4 is the most tempting object in the repository because its consumed replay looks like the result the project was originally seeking. It is a transparent ETF challenger developed during an adaptive research process. The historical study is descriptive and post-selected; every interval in the stated window has already been observed. Its purpose in the final system is therefore not to establish superiority, but to test whether Finly can refuse an attractive survivor once the inferential cost of the search is taken seriously.

The authorized quantitative statement is exact: in the consumed, post-selected 2013-01-02–2026-08-27 retrospective replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%; promotion was rejected because the Deflated Sharpe probability was 3.75% and the worst familywise-adjusted p-value was 37.18% [11]. Two facts must be read together. The historical difference is large enough to deserve investigation. The selection-aware evidence is weak enough to deny promotion. Neither fact cancels the other.

The obvious objection is that Finly has designed a gate that discards economic information. Markets do not award points for epistemic modesty; if a strategy would have produced a much larger terminal value, declining to use it can look less like rigor than timidity. This objection has force. Statistical correction should not be used as a ritual that makes every imperfect result inadmissible. A rejected backtest may still contain a useful hypothesis, and post-selection does not prove that the underlying effect is false.

However, the conclusion Finly draws is not that G4 is worthless. It is that G4 has not earned deployment authority. That is a different claim. The challenger may motivate a future experiment, inform a scenario analysis, or reveal the sort of growth exposure that the research process repeatedly favored. What it may not do is use its own selected return to waive the test designed to evaluate selection. Once this distinction is made, rejection is not the destruction of a hypothesis. It is the preservation of its proper evidential status.

This is the first sense in which Finly takes trading evidence seriously. A historical chart remains evidence about a modeled past. It is neither ignored nor permitted to speak beyond its jurisdiction. The system's most impressive retrospective number is therefore presented beside the reason it failed, not separated from that reason by a footnote or a later disclaimer.

## 5. Production v1 makes a smaller, testable promise

If G4 represents the temptation to maximize the historical case, production v1 represents the discipline of choosing an object whose behavior can be stated without borrowing from that case. The production policy is frozen, unlevered, and limited to an allocation between SPY and BIL. It combines a trend posture with volatility targeting. The purpose is not to imitate the retrospective challenger. It is to reduce exposure when the rule's measured risk rises and to preserve a liquid residual allocation when the directional case is weaker [1,2].

Again, the authorized claim is exact. Production v1 is the frozen unlevered SPY/BIL policy targeting 10% annualized volatility: in the consumed 2025-01-02–2026-08-28 modeled next-open study it returned +15.39% at 5 bp per traded leg and +10.56% at 25 bp, versus SPY +33.52%; at 5 bp its modeled annualized volatility was 8.12% and maximum drawdown was -5.45%, so it was risk-controlled but not market-beating on total return [11,12].

This result has an honest interpretation. The policy remained positive under both stated cost assumptions and exhibited modeled annualized volatility of 8.12% and maximum drawdown of -5.45% in the stated model. It also gave up substantial upside relative to SPY. A reader who wants the highest historical total return should prefer SPY on this consumed interval. A reader who wants to inspect those modeled risk measurements can find them. The study does not decide whether that exchange will be attractive in the future.

The execution language matters. “Modeled next-open” identifies the temporal assumption used to convert a close-based decision into the following session's execution price. “Per traded leg” identifies how the stated transaction-cost stress is applied. These details prevent a low-friction close-to-close abstraction from masquerading as a broker result. They do not verify liquidity, queue position, partial fills, rejected orders, or contemporaneous options spreads. Consequently, the result is an execution-realism study within an adjusted-OHLC ledger, not a claim about broker fills and not options profit and loss [12].

One might ask why this policy deserves the label “production” if it did not beat SPY. Here “production” names the frozen decision object, not a commercial performance certification. It is the policy against which future evidence can be collected without quietly changing the formula. The label would become misleading only if it implied that the economic case were complete. Finly states the contrary: the policy is implemented and bounded; profitability remains unproved.

## 6. The model is useful precisely because it can disagree

A common critique of constrained-agent design is that deterministic rules do the substantive work while the model supplies an explanation afterward. If that were Finly's architecture, the AI component would indeed be ornamental. The relevant question is whether model judgment can alter the path without gaining control of the exposure.

Finly's answer is the veto. Evidence may be ambiguous, temporally inconsistent, or poorly grounded even when the deterministic market inputs form a valid signal. A model can identify that tension and stop the handoff. It can also produce a structured assessment whose content is bound to the evidence it was shown. What it cannot do is resolve the tension by inventing a new position. This is a narrow form of agency, but it is genuine: the model changes whether the proposed action survives, while code retains what the action would be.

The architecture also answers the “more data is always better” intuition. Additional information has value only if its provenance, timing, and role can be stated. A social post, a news report, a prediction market, and a regulatory filing are not interchangeable votes. Aggregating them merely because they point in the same direction can transform common-source repetition into false confidence. Finly therefore treats interpretation as a challenge process rather than a popularity count. The model may ask whether sources cohere, but the quantity of text cannot create permission.

There is still a hard limitation. A veto-capable model may reject useful trades for reasons that are difficult to calibrate, and a bounded evidence bundle may omit information that an expert would consider decisive. Controlled delegation reduces one class of failure; it does not solve market inference. The design should therefore be evaluated on two axes that must remain separate: whether the boundary holds, and whether the underlying policy makes money. Strong control evidence cannot substitute for weak economic evidence. Strong economic evidence, when it eventually exists, should not be allowed to dissolve the control boundary.

## 7. Two future-only tests, and no result yet

The proper response to consumed evidence is not another retrospective variation presented with greater confidence. It is a future test whose rules exist before the eligible inputs. Finly has registered two such attempts. They have different research roles, but the same evidential constraint: neither can inherit a performance conclusion from data observed before registration.

Attempt 115 asks a bounded question about the frozen equity policy family. It preserves the incumbent while registering a challenger whose risk estimate responds differently to adverse returns [13]. Attempt 116 is an options-volatility shadow compiler adapted from a pinned, attributed source; it excludes order construction, sizing, broker mutation, historical scoring, and production integration [14]. These descriptions state what the protocols are designed to test. They do not state that either test works.

The authorized outcome statement is therefore deliberately empty. Attempts 115 and 116 are publicly registered future-only tests. As of 2026-08-30T08:10:52.000Z, each had zero observed outcomes, and neither supports a performance claim. [11,13,14] Their public receipts establish a GitHub platform record whose bound files can be checked. They are not independent cryptographic timestamps, proof of market-data provenance, broker execution records, or outcome evidence [11].

Why present an experiment before it has results? Because the absence of results is what gives the registration its meaning. A protocol published after a favorable observation would explain what the researcher chose to keep. A protocol published before any eligible observation defines what the researcher has agreed not to change. The former can document history; the latter can constrain the future.

This prospective boundary also protects the qualitative story. Finly cannot quietly replace a failed test with a more favorable interval, report an interim result as though the stopping rule had been satisfied, or transfer the options shadow's eventual behavior to the equity policy. Each object must earn only its own conclusion. The repository is thus not a collection of increasingly confident backtests. It is a record of claims whose permissions are intentionally difficult to expand.

## 8. Comparison without an invented leaderboard

A hackathon naturally invites comparison. Yet a financial comparison is meaningful only if the strategies share a panel, chronology, execution assumptions, and a reproducible definition of return. A project that publishes no compatible profit and loss cannot be treated as having earned zero; nor can its absence be converted into evidence that another project won.

The release gate states the field boundary precisely. At the Generation 7 capture, 20 projects were visible and zero supplied an exact same-panel submitted-options comparator; missing P&L is unknown, never zero, and supports neither a return matchup nor a competitor rank. [11] This aggregate finding is useful because it defines what the available evidence cannot answer. It does not criticize another team, and it does not authorize Finly to declare itself financially superior.

The case for Finly must therefore be comparative in a different sense. Judges can ask whether the project distinguishes retrospective from prospective evidence, whether its performance language matches its execution model, whether the AI component's rights are explicit, whether a favorable survivor can actually fail promotion, and whether the next experiment was registered before its outcomes. These are observable properties of the submission. They do not require an invented cross-project return chart.

## 9. Counterarguments and failure analysis

### 9.1 A safe system that cannot prove profit may still be economically weak

The most serious objection is not technical. It is that a trading project is ultimately supposed to make money. A system can possess immaculate controls and still allocate capital poorly. Finly's production study does not defeat this objection; it confirms part of it, because SPY produced the larger total return in the consumed interval. The project should not ask judges or future users to treat risk control as a synonym for value.

The reply is conditional. If the sole objective is maximum historical total return in the stated period, Finly has not established a reason to prefer production v1. If the objective includes limiting modeled volatility and drawdown while retaining a rule that can be tested prospectively, the policy supplies relevant evidence. The economic question remains open because preferences over that tradeoff and future outcomes remain open. Controlled delegation does not settle the objective function. It makes the evidence for each objective harder to confuse.

### 9.2 Refusal can become an unfalsifiable success condition

A second objection concerns the product story itself. If every failed performance test is reinterpreted as proof that the controls work, Finly could never lose. That would be an elegant form of immunization: a good return would support the strategy, while a bad return would support the epistemology.

This objection is correct unless success is divided in advance. Boundary success means that authority did not expand when a gate failed. Economic success means that the frozen policy satisfied a declared performance endpoint. The former can occur while the latter fails. Finly's present evidence supports bounded historical and methodological claims; it does not support profitability. Attempts 115 and 116 preserve that distinction by beginning with zero outcomes and by withholding performance language until their own conditions are met.

### 9.3 Deterministic code can be confidently wrong

The final objection turns the critique of AI back on the compiler. Code is auditable, but auditability does not make its assumptions true. A deterministic trend rule can fail in a new regime; a volatility estimate can understate tail risk; a schema can perfectly validate the wrong economic intent. Restricting a model cannot rescue a poor policy.

Finly accepts this limitation. Determinism is used where exact comparison and bounded authority matter, not as a claim of superior market understanding. The model, the policy, and the compiler can each be wrong in different ways. The point of separation is to reveal which claim failed and to prevent one component from silently repairing another after the outcome is known.

## 10. What the evidence permits us to conclude

Finly presently establishes a smaller thesis than a conventional trading pitch would prefer. It shows that a trading agent can give AI a meaningful interpretive and veto role without granting it control of exposure-bearing fields. It shows that the project's strongest historical survivor can remain visible while being rejected for promotion. It shows that the frozen production policy was positive and risk-controlled in a consumed modeled study while still underperforming SPY on total return. It shows that future-only protocols can be made public before they possess a favorable outcome.

The project does not show that Finly will be profitable, will beat SPY next month, has verified options profit and loss, or ranks above another submission. G4 is not validated or promoted. Missing competitor performance is not a Finly win. Attempts 115 and 116 have no outcome at the evidence date. These are not ceremonial caveats; they are the borders of the present claim [11].

The next useful evidence is therefore already defined. Production v1 must be judged on future observations gathered without revising the frozen object. The registered challengers must complete their own prospective chronology before any performance inference is permitted. Options work must remain a shadow or control result until a separately authorized execution study exists. If those tests fail, the failure should remain visible. If they succeed, the stronger claim will have a chain of custody that the current backtests cannot supply.

The governing idea can now be stated without metaphor. A model's capacity to interpret evidence is not the same property as a system's authority to place capital at risk. A responsible agent must connect the two, but it should not collapse them. Finly's contribution is to make that connection explicit, falsifiable, and capable of refusal. Profit remains the objective. Until the evidence earns the sentence, however, profit is not the claim.

## References

[1] T. J. Moskowitz, Y. H. Ooi, and L. H. Pedersen. “Time Series Momentum.” *Journal of Financial Economics* 104, no. 2 (2012): 228–250. [doi:10.1016/j.jfineco.2011.11.003](https://doi.org/10.1016/j.jfineco.2011.11.003).

[2] A. Moreira and T. Muir. “Volatility-Managed Portfolios.” *Journal of Finance* 72, no. 4 (2017): 1611–1644. [doi:10.1111/jofi.12513](https://doi.org/10.1111/jofi.12513).

[3] H. White. “A Reality Check for Data Snooping.” *Econometrica* 68, no. 5 (2000): 1097–1126. [doi:10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152).

[4] D. H. Bailey and M. López de Prado. “The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality.” *Journal of Portfolio Management* 40, no. 5 (2014): 94–107. [doi:10.3905/jpm.2014.40.5.094](https://doi.org/10.3905/jpm.2014.40.5.094).

[5] C. R. Harvey, Y. Liu, and H. Zhu. “… and the Cross-Section of Expected Returns.” *Review of Financial Studies* 29, no. 1 (2016): 5–68. [doi:10.1093/rfs/hhv059](https://doi.org/10.1093/rfs/hhv059).

[6] D. H. Bailey, J. M. Borwein, M. López de Prado, and Q. J. Zhu. “The Probability of Backtest Overfitting.” *Journal of Computational Finance* 20, no. 4 (2017): 39–69. [doi:10.21314/JCF.2016.322](https://doi.org/10.21314/JCF.2016.322).

[7] H. Luo et al. “QFinZero: A Unified Financial Toolchain for LLM-Based Trading Agents.” *Proceedings of the 64th Annual Meeting of the Association for Computational Linguistics: System Demonstrations* (2026): 68–77. [doi:10.18653/v1/2026.acl-demo.7](https://doi.org/10.18653/v1/2026.acl-demo.7).

[8] Z. Wang et al. “BacktestBench: Benchmarking Large Language Models for Automated Quantitative Strategy Backtesting.” arXiv:2605.17937 (2026). [arxiv.org/abs/2605.17937](https://arxiv.org/abs/2605.17937).

[9] M. Li et al. “TrustTrade: Human-Inspired Selective Consensus Reduces Decision Uncertainty in LLM Trading Agents.” arXiv:2603.22567 (2026). [arxiv.org/abs/2603.22567](https://arxiv.org/abs/2603.22567).

[10] Alpaca. “Options Trading.” Official documentation. [docs.alpaca.markets/us/docs/options-trading](https://docs.alpaca.markets/us/docs/options-trading).

[11] Finly. “Quantitative Release Gate.” Evidence as of 30 August 2026. [research/output/quantitative_release_gate.json](https://github.com/owlsowo/finly-bot/blob/c953d74444bd0cee1bc884701d98ff510cc4db80/research/output/quantitative_release_gate.json).

[12] Finly. “Equity Execution Realism.” [research/output/equity_execution_realism.json](https://github.com/owlsowo/finly-bot/blob/c953d74444bd0cee1bc884701d98ff510cc4db80/research/output/equity_execution_realism.json).

[13] Finly. “Attempt 115: Downside Semivolatility Challenger Protocol” and public registration record. [Registration commit](https://github.com/owlsowo/finly-bot/commit/fc560b3bad6c06326c8ee2020a24b2dc099b97a1); [verification workflow](https://github.com/owlsowo/finly-bot/actions/runs/33299044143).

[14] Finly. “Attempt 116: Prospective Options Volatility Shadow Protocol” and public registration record. [Registration commit](https://github.com/owlsowo/finly-bot/commit/a46ee3d2f9fc4ecbf1fc159fb20e56b0708a009f); [verification workflow](https://github.com/owlsowo/finly-bot/actions/runs/33300509077).
