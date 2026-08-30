# Final live competitor audit

## Technical summary

The authenticated [live hackathon page](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/live) showed **20 visible submissions** at the August 30 refresh, seven more than the 13-project Generation 6 snapshot. None exposes an exact same-panel submitted-options return series suitable for a tournament P&L ranking.

**No public same-panel financial head-to-head is supported.** AEGIS-Q exposes an archived legacy-equity bundle, but not reproducible submitted-options P&L. **VRP Engine is the strongest new engineering mechanism**, but it publishes a demo journal rather than verified financial outcomes. Those roles must remain separate.

The immediate operational issue is more important than another model change: **Finly was absent from the expanded 20-project public submission list.** Its authenticated editor remained at **step 1 of 3, 26%**, producing the registry status `NOT_VISIBLE_DRAFT_WARNING`. A leaderboard association does not prove submission.

## Twenty visible projects produce no public tournament comparator

The table separates public financial evidence from mechanism evidence. “None” means unknown—not zero or inferior performance. A categorical audit table is used instead of a chart because exact classifications, licenses, and source bindings are the decision-relevant evidence.

| Rank | Project | Financial evidence | Mechanism evidence | License file |
|---:|---|---|---|---|
| 1 | [AlphaPilot AI](https://github.com/ibrahimjatt1313-prog/AlphaPilot/tree/29add3d4834323ef3b8e1254fed937d11d5e3ac7) | One local losing paper-log row; no inference | Implemented paper-options pipeline | None |
| 2 | [VibeHedge](https://github.com/ShinyDataTech/VibeHedge/tree/eaf8f7a1715d043bd5eaae78bd4b9db9ca314284) | None | Synthetic options; backward-fill leakage risk | None |
| 3 | [Options Sniper](https://github.com/public321-ai/option-sniper/tree/57062e4a1c3e1cd97df7c0eebced6a748bcf55e6) | None | Scanner, Greeks/IV/liquidity and news-risk components | None |
| 4 | [Tissue Regeneration Navigator](https://github.com/mahamtaqi3-cloud/Tissue-Regeneration-and-Genetic-Factor-Navigator/tree/06637f9e80301acda5ae09f18bc9568b1d544ca3) | None | Not a public trading mechanism | None |
| 5 | [Pin Desk](https://github.com/anujsuthar08/Pin-desk/tree/292825c37d2ca86843821e9119ecec4d4f9d2c5b) | None | Gamma, sizing, order, and risk components | MIT |
| 6 | **New:** [AlphaGuard AI](https://github.com/devenramanuj/finpulse-ai/tree/8aea3ee99c31018bd8f736cde68cff36dd2b56de) | None | Small multi-agent/risk prototype | None |
| 7 | [a continual learning agent](https://github.com/atlas-jj/finance-trueintrinsics-public/tree/08360a32eb24f5d7301cb69207d71206ccb8dd0c) | None | README/license only; source unreleased | Apache-2.0 |
| 8 | [Vega](https://github.com/isquividet/vega) | Prior scenario only | Repository unavailable at refresh | Unverifiable |
| 9 | [Odysseus](https://github.com/thoonnadi2003/odysseus/tree/065a3d995e29762e5ba3ae706f1eb12e4ad64de0) | None | Reproducible evaluation infrastructure | MIT |
| 10 | [NewsFlow Trader](https://github.com/icohangar-ops/newsflow-trader/tree/36cfd8dbf49f9228fe2f475c84db5cbae2719beb) | Mock-input output only | News orchestration with random mock feed | MIT |
| 11 | [AlphaSwarm](https://github.com/fokrulanthro16-eng/alphaswarm-sovereign/tree/564521dd933f111c5c13b922ad9afd249c573cc6) | Synthetic/demo only | Debate and deterministic risk components | MIT |
| 12 | [SPY Sentinel](https://github.com/ajennings1974/SPY-Sentinel-AI/tree/efd7edab9b19f10e2a7de0d130e7e335ad262d50) | Reproducible negative validation; 0/8 survivors | Exact research and rejection process | None |
| 13 | **New:** [VRP Engine](https://github.com/Ander-IbBi/alpaca-vrp-engine/tree/84d6bff500b53a27cb2743a870b9533fc7d5c098) | Demo journal only | Strongest new options/risk mechanism | MIT |
| 14 | [BABIL](https://github.com/TAKA2SEA/babil-alpaca-hackathon-2026/tree/9080b2a0d695bc5f733dc064926af7883a243441) | Isolated paper probe only | Authorization and execution controls | None |
| 15 | [AEGIS-Q](https://github.com/VicensPaneque/aegis-q/tree/76bb97e9200c41c519440bb64ea40d2161367627) | Legacy equity bundle; not submitted-options P&L | Archived equity rule plus options components | MIT |
| 16 | **New:** [AURA](https://github.com/mirzayasirabdullahbaig07/AURA-Alpaca-AI-Project/tree/23369f31024f72009446c1cbfe245e414ac0d2b2) | None; backtest is roadmap | Agent/critic/risk governance prototype | README claim only |
| 17 | **New:** [Vermiliion](https://github.com/Prasannaverse13/Vermilion-/tree/a0e411ecb4436d0743403588660f4462ef5737b1) | None | Human queue, MCP, and audit application | None |
| 18 | **New:** [OptionGuard](https://github.com/gokulmkrish/OptionGuard-Ai/tree/09938f4a2cc86e2e5534a7034e9d6d0daff51c1e) | Randomized synthetic metrics | Exact deterministic risk gates | MIT |
| 19 | **New:** [SOGNO](https://github.com/pedrogroppo2-cell/sogno-options-agent/tree/27a06e2bc71dbcb59dbe9321bb94f9fa39c40e22) | None | Not self-contained; imports absent modules | None |
| 20 | **New:** [Futarchists Options](https://github.com/VontariusF/options-tournament/tree/b068b7c5ad425202430c884a69d3733801e59037) | None | Broker/card code exists; claimed genetic certification is not implemented | MIT |

## No submission supports a public financial head-to-head

[AEGIS-Q's strategy](https://github.com/VicensPaneque/aegis-q/blob/76bb97e9200c41c519440bb64ea40d2161367627/src/pnl_agent/strategy.py), [backtester](https://github.com/VicensPaneque/aegis-q/blob/76bb97e9200c41c519440bb64ea40d2161367627/src/pnl_agent/backtest.py), and [metric bundle](https://github.com/VicensPaneque/aegis-q/blob/76bb97e9200c41c519440bb64ea40d2161367627/reports/metrics.json) describe an archived legacy-equity system, not the submitted AEGIS-Q options strategy. No competitor publishes the exact submitted-options rule, point-in-time data, execution assumptions, and outcome path needed for a defensible public P&L matchup. Finly therefore publishes no competitor-return comparison or tournament rank; internal adversarial checks remain private decision aids.

## VRP contributes two credible shadow tests, not a Kelly upgrade

VRP's [signal code](https://github.com/Ander-IbBi/alpaca-vrp-engine/blob/84d6bff500b53a27cb2743a870b9533fc7d5c098/src/vrp_engine/strategy/signals.py) blends 10- and 21-session close volatility with a Parkinson estimator, compares ATM implied volatility with realized volatility, and blocks front-expiry event risk through term slope. Its [pricing code](https://github.com/Ander-IbBi/alpaca-vrp-engine/blob/84d6bff500b53a27cb2743a870b9533fc7d5c098/src/vrp_engine/strategy/pricing.py) compares win probability under realized- and implied-volatility lognormal measures. Its [portfolio engine](https://github.com/Ander-IbBi/alpaca-vrp-engine/blob/84d6bff500b53a27cb2743a870b9533fc7d5c098/src/vrp_engine/risk/portfolio.py) adds exact piecewise-linear payoff, stress, beta-delta, and concentration controls.

Finly already has a conservative two-model probability gate, fixed 0.5%-of-equity/$500 per-trade sizing, a 3% aggregate-risk cap, leave-one-family-out recompilation, 32 deterministic perturbations, durable permit reservations, and execution receipts. The real gaps are an explicit term-slope veto and, if Finly later allows multiple positions, whole-book payoff/stress analysis.

VRP's 35%-Kelly size comes from an uncalibrated model probability and a binary approximation to continuous option payoff. The repository supplies no Brier score, log loss, reliability curve, or prospective outcome bundle. **Adding fractional Kelly now would convert unverified probability error into position-size error and weaken Finly's current rigor.** The defensible extension is a timestamped, non-authorizing IV/RV and term-slope shadow challenger with frozen thresholds and no Kelly.

## Scope and evidence definitions

- **Visible census:** the 20 projects shown after expanding the live submission list, not all teams or drafts.
- **Financial evidence:** broker-bound prospective outcomes or a complete historical rule, data convention, and metric bundle. Synthetic, randomized, mocked, scenario, and demo values do not qualify.
- **Mechanism evidence:** executable strategy, risk, execution, or evaluation logic. It can be technically strong without proving profit.
- **Public comparator eligibility:** an exact same-panel submitted-options rule and outcome path. No visible project qualifies.
- **Missing P&L:** unknown. It is never imputed as zero or treated as a Finly victory.
- **Pinned repository:** the verified public HEAD at refresh. Vega retains only its last accessible Generation 6 pin because the repository is now unavailable.

## Methodology binds each conclusion to a commit

The live page was inspected read-only in the authenticated browser and expanded to all visible submissions. Each linked repository was inspected at the commit recorded in `competitor_strategy_registry_generation7.json`; accessible HEADs were confirmed with `git ls-remote`. Evidence URLs point to commit-pinned files rather than moving branches. Root license files were checked separately from README claims. Financial and mechanism classifications were then assigned independently.

The validator enforces the 20-project census, seven-project delta, unique ranks and IDs, pinned accessible commits, zero public financial comparators, one strongest-new-mechanism designation, license totals, source URLs, and the Finly visibility warning.

## Limitations keep the comparison from becoming a leaderboard claim

- Public repositories can change after the capture; the registry describes the pinned commits only.
- Private datasets, broker histories, or unreleased logic could exist. Their absence from the repository is not evidence of poor performance.
- Vega could not be refreshed, so its entry retains the last accessible Generation 6 evidence.
- The live page's ordering reflects community votes and shows zero votes for most later submissions; it is not a judging score.
- No exact submitted-options return series can support “Finly beat every competitor.”
- Finly's draft-state observation was authenticated UI state, not a public submission-status API.

## Recommended next steps

1. **Resolve submission visibility first.** Complete all three steps and confirm Finly appears on the public live list.
2. **Keep adversarial competitor-return checks private.** Publish no head-to-head unless both submitted-options paths become exactly reproducible on one panel.
3. **Freeze VRP-style IV/RV and term slope as a shadow challenger.** Do not authorize trades or alter the promoted policy from this post-snapshot idea.
4. **Keep fixed bounded sizing.** Require prospective probability calibration before reconsidering any Kelly rule.
5. **Treat portfolio stress as a future safety extension.** It matters when Finly admits simultaneous or multi-underlying positions; it should sit below, not relax, the existing 3% aggregate cap.
6. **Respect licenses.** Preserve MIT/Apache notices when reusing code; independently implement ideas from repositories without a license file.

## Further questions

- Has the completed Finly submission become publicly visible after all three editor steps?
- Can the IV/RV shadow challenger accumulate enough timestamped chain/outcome observations to estimate calibration before the judging cutoff?
- Would multi-position functionality add judging value sufficient to justify the larger portfolio-risk and execution surface?

The source-of-record for exact classifications, URLs, and claim boundaries is `research/competitor_strategy_registry_generation7.json`.
