# Finly quantitative evidence surface

## Answer first

Across the ledger's **113 conservatively counted effective research attempts, zero new challenger was promoted to replace frozen v1**. This accounting includes controls, unexecuted or rejected suggestions, invalidated runs, an aborted attempt, and reruns; it is not a count of 113 independent viable strategies. The strongest surviving object is a descriptive G4 retrospective baseline, not a validated champion. G6 selected no challenger.

## Research-attempt accounting

| Counted component | Attempts |
|---|---:|
| 53 prior research attempts | 53 |
| 12 invalidated G1 attempts | 12 |
| 1 aborted attempt | 1 |
| 9 invalidated G2 attempts | 9 |
| 3 competitor suggestions | 3 |
| 5 literature suggestions | 5 |
| 8 G3 formulas | 8 |
| 1 correction rerun | 1 |
| 8 G4 attempts: 7 eligible formulas and 1 control | 8 |
| 5 G5 attempts: 4 eligible formulas and 1 control | 5 |
| 8 G6 attempts: 7 eligible formulas and 1 control | 8 |
| **Total: conservatively counted effective research attempts** | **113** |

The total is a conservative multiple-testing denominator. It includes controls, suggestions that were unexecuted or rejected, invalidated runs, an aborted attempt, and reruns. It must not be interpreted as 113 independent viable strategies. The core G4 formula, date partitions, and costs were committed before its run; the excess-Sharpe selection rule and later inference corrections changed afterward. Accordingly, the current analysis is not described as fully preregistered, and all historical intervals are now consumed.

## Consumed 2013–2026 G4 replay

| Metric | G4 candidate | SPY |
|---|---:|---:|
| Cumulative return | 967.11% | 580.82% |
| Annualized return | 18.97% | 15.11% |
| Annualized volatility | 18.01% | 16.79% |
| Cash-excess Sharpe | 0.96 | 0.83 |
| Maximum drawdown | -28.99% | -33.72% |
| Annualized turnover | 3.78× | 0.22× |

Window: **2013-01-02 to 2026-08-27** (3,434 aligned sessions). The replay uses a 5 bp one-way cost, a 1.0× risky-gross cap, causal signals, and terminal liquidation. Every date in this interval was already consumed during research.

## Why the G4 result was not promoted

- Cost sign at 5/10/25 bp: **passed**.
- Development and validation SPY edge at all 21 rebalance offsets: **passed**.
- Deflated-Sharpe probability: **3.75%**, below the 95% gate.
- Worst adjusted familywise p-value: **37.18%**, above the 5% gate.
- Independence from the static SPY/QQQ growth control: **not supported**.
- Authenticated source overlap for every used symbol: **not passed**.

Those failures are outcome-determinative: G4 remains descriptive evidence only.

## $300 monthly-contribution replay

| Horizon | Windows | Candidate exceeded SPY | Candidate profitable | SPY profitable | Median ending advantage | Worst ending advantage |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 163 | 62.6% | 62.6% | 68.1% | $1.03 | −$13.31 |
| 3 | 161 | 65.8% | 78.3% | 78.3% | $5.39 | −$30.30 |
| 6 | 158 | 69.0% | 88.0% | 82.3% | $21.59 | −$64.94 |
| 12 | 152 | 74.3% | 90.8% | 87.5% | $78.20 | −$149.83 |

The one-month calendar windows do not overlap; longer horizons overlap heavily, and all summaries share one consumed historical path. They describe frozen paths under equal contribution schedules rather than independent win probabilities. The negative worst-window values are retained to make downside cases visible.

## G6 challenger result

Seven frozen G6 candidates were assessed. None cleared the primary SPY track, and none cleared the separate growth-control track. Post-selection robustness therefore recorded no selected candidate and kept G4 only as a descriptive baseline.

## AEGIS-Q auxiliary boundary

The pinned legacy-equity replay status is **PUBLISHED_BUNDLE_NOT_REPRODUCED**. Its published bundle did not verify exactly. It is neither the submitted options strategy nor an apples-to-apples basis for financial rank, so its return metrics remain auxiliary context only.

## Exact safe claims

- Across the ledger's 113 conservatively counted effective research attempts, zero new challenger was promoted to replace frozen v1; this count includes controls, unexecuted or rejected suggestions, invalidated runs, an aborted attempt, and reruns, not 113 independent viable strategies.
- In the consumed 2013-01-02 through 2026-08-27 retrospective replay, the G4 candidate recorded 18.97% annualized return versus 15.11% for SPY after the declared 5 bp one-way costs.
- In that same consumed replay, the G4 candidate's maximum drawdown was -28.99% versus -33.72% for SPY.
- With $300 contributed monthly, the G4 candidate exceeded SPY's ending balance in 62.6% of 1-month windows, 65.8% of 3-month windows, 69.0% of 6-month windows, 74.3% of 12-month windows; the one-month calendar windows do not overlap, longer horizons overlap heavily, and all summaries share one consumed path, so they are descriptive rather than independent trials.
- The G4 robustness review rejected promotion: its deflated-Sharpe probability was 3.75%, and its worst adjusted familywise p-value was 37.18%.
- G6 evaluated seven frozen challengers and selected none on either the primary SPY track or the separate growth-control track.
- The core G4 formula, date partitions, and costs were committed before its run; the excess-Sharpe selection rule and later inference corrections changed afterward, so the current analysis is not described as fully preregistered.
- The pinned AEGIS-Q replay is an auxiliary legacy-equity reproduction attempt only; it did not reproduce the published bundle exactly and does not represent the submitted options strategy.
- All reported market intervals were already consumed; these artifacts do not establish future profitability or authorize live-capital use.

## Source integrity

| Artifact | Frozen path | SHA-256 |
|---|---|---|
| generation4 | `research/output/quant_champion_generation4.json` | `af935615b289b009af83fe67dd78a890ce4de3c2416bbf039b0da2f24de78788` |
| generation4_robustness | `research/output/quant_champion_generation4_robustness.json` | `6b8136da0c4d6b366763383a93d2e119cec2f5516761b6cb2d2c206eeefd3299` |
| generation6 | `research/output/quant_champion_generation6.json` | `028e0fdc69a8cb591a4d4fd6b6e4a20869d7a6296eb0650e643e3df23a4a3b9e` |
| generation6_robustness | `research/output/quant_champion_generation6_robustness.json` | `938eeed6f1dde418713c621231951e9509eb32da70b74e6c2e29be550da310fe` |
| recurring_contribution | `research/output/recurring_contribution_analysis.json` | `a6f49a99dabe6d59e6b5acccf07678b8d7f09ca9c4d59af469eeeb5e6b0ee1f5` |
| aegis_q_auxiliary | `research/output/aegis_q_legacy_reproduction.json` | `153c63138e6c9bcec6b8cee8443b00668d6abf31c91220c39445105464bd42a7` |

All six source hashes are verified before this surface is built. Missing, modified, or schema-incompatible inputs fail closed.
