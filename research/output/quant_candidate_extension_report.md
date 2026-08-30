# Finly quantitative candidate extension

Generated 2026-08-29. Private research artifact; no public claim is changed by this report.

## Answer first

**Disposition: KEEP_V1.** The exploratory selector chose 252-session absolute momentum, otherwise BIL, but this is not a promotion or a winner. On the already-seen 2025-2026 extension it trailed frozen Finly's BIL-excess Sharpe and trailed SPY's raw return.

The economically honest question is not whether one backtest line is highest. It is whether an alternative improves a declared metric consistently across development, validation, rolling windows, subperiods, costs, and statistical corrections. The 2025-2026 interval has already been viewed, so this report labels it a **post-holdout research extension**, not a fresh holdout.

No tested candidate is authorized to replace frozen Finly. No candidate beat frozen Finly simultaneously on return, BIL-excess Sharpe, and drawdown in development, validation, and the seen extension; no candidate beat SPY's raw return in all three partitions. The independent A/B/C promotion rule retains v1 whenever any Gate A or Gate B Boolean fails.

## Explicit promotion gate

| Gate | Passed | Consequence |
|---|---:|---|
| A — freeze and engineering eligibility | no | Historical research was not frozen before its results were seen. |
| B — permission to enter prospective shadow | no | MRER, window frequency, costs, paired DSR, and 5/20/60 block tests must all pass against both baselines under all five anchors. |
| C — forward broker evidence | no | No new 60-session broker-reconciled v2 record exists. |

Every failed Boolean is listed at the end of this report and represented structurally in the JSON.

## Data decision

The uniform long-history panel uses Yahoo adjusted close because its 2016-2026 overlap passed explicit, usage-specific long-horizon reconciliation gates against authenticated Alpaca SIP adjusted bars. Those gates were set during this exploratory extension after initial overlap inspection, so they are not preregistered. No Yahoo/Alpaca splice is used. Exact common Yahoo history is 2007-05-30 through 2026-08-27 (4,843 complete sessions); scoring begins only after 252 complete lookback sessions on 2008-06-02.

| Symbol | Common overlap | Return correlation | Median abs. diff | 95th-pct abs. diff | Terminal log-wealth diff | Gate |
|---|---:|---:|---:|---:|---:|---:|
| SPY | 2678 | 0.996090 | 0.0015% | 0.0568% | 0.96% | PASS |
| BIL | 2678 | 0.963877 | 0.0020% | 0.0109% | 0.02% | PASS |
| TLT | 2678 | 0.999959 | 0.0032% | 0.0093% | 0.18% | PASS |
| GLD | 2678 | 0.995681 | 0.0000% | 0.0238% | 0.00% | PASS |

Yahoo is a free endpoint without a data SLA. Its four 28 August rows had null adjusted closes and were omitted without imputation, so the uniform panel ends 27 August; Alpaca's complete 28 August row remains separate for exact v1 replication. Raw responses are not stored, but response and normalized-series SHA-256 fingerprints are recorded in the JSON. Alpaca remains the authenticated overlap reference. The JSON also preserves the largest overlap disagreements, concentrated in the March 2020 stress period; this admission is for slow trend research, not event-level execution reconstruction.

## Candidate selection uses no 2025-2026 rows

Development is 2008-06-01 to 2017-12-31; validation is 2018-01-01 to 2024-12-31. The objective is the minimum of development and validation BIL-excess Sharpe, subject to positive BIL-relative evidence in both, meaningful utilization, no leverage, and shallower validation drawdown than SPY.

| Candidate | Development Sharpe | Validation Sharpe | Robust score | Eligible |
|---|---:|---:|---:|---:|
| frozen_finly | 0.807 | 0.578 | 0.578 | yes |
| absolute_252_cash | 0.811 | 0.674 | 0.674 | yes |
| absolute_majority_cash | 0.717 | 0.612 | 0.612 | yes |
| signed_ensemble_unlevered | 0.580 | 0.227 | 0.227 | yes |
| frozen_drawdown_brake | 0.802 | 0.589 | 0.589 | yes |
| frozen_volatility_brake | 0.820 | 0.589 | 0.589 | yes |
| dual_momentum_cross_asset_gate | 0.659 | 0.282 | 0.282 | yes |

Exploratory selector choice, not promoted: **252-session absolute momentum, otherwise BIL**. Selection receipt SHA-256: `de1d53e7453291a94c2239215754376b53d6b46416909f524e10292c8b9605e0`.

### Validation metrics (2018-2024)

| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Avg. |SPY| |
|---|---:|---:|---:|---:|---:|---:|
| BIL cash baseline | 16.55% | 2.22% | 0.25% | n/a | -0.21% | 0.00% |
| SPY buy-and-hold baseline | 145.95% | 13.74% | 19.46% | 0.647 | -33.72% | 100.00% |
| SPY 10% volatility-target baseline | 93.70% | 9.92% | 10.88% | 0.723 | -13.05% | 71.54% |
| Frozen Finly 21/63/252 relative-trend ensemble | 61.93% | 7.14% | 8.84% | 0.578 | -9.41% | 58.33% |
| 252-session absolute momentum, otherwise BIL | 80.41% | 8.81% | 10.03% | 0.674 | -12.19% | 62.92% |
| 21/63/252 majority absolute momentum, otherwise BIL | 69.05% | 7.80% | 9.44% | 0.612 | -12.05% | 59.82% |
| Signed multi-horizon trend with uninvested collateral | 30.56% | 3.89% | 8.90% | 0.227 | -10.41% | 56.99% |
| Frozen Finly with a fixed drawdown brake | 62.91% | 7.23% | 8.80% | 0.589 | -9.45% | 58.09% |
| Frozen Finly with a fixed high-volatility brake | 62.71% | 7.21% | 8.78% | 0.589 | -9.14% | 57.77% |
| Frozen Finly with a 252-session SPY/TLT/GLD dual-momentum gate | 31.33% | 3.98% | 6.93% | 0.282 | -8.96% | 37.79% |

## Already-seen 2025-2026 research extension

| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Avg. |SPY| |
|---|---:|---:|---:|---:|---:|---:|
| BIL cash baseline | 6.58% | 3.95% | 0.20% | n/a | -0.01% | 0.00% |
| SPY buy-and-hold baseline | 33.82% | 19.40% | 17.35% | 0.883 | -18.76% | 100.00% |
| SPY 10% volatility-target baseline | 18.23% | 10.73% | 10.75% | 0.640 | -11.59% | 75.59% |
| Frozen Finly 21/63/252 relative-trend ensemble | 19.18% | 11.27% | 8.32% | 0.858 | -5.79% | 62.81% |
| 252-session absolute momentum, otherwise BIL | 14.58% | 8.64% | 10.36% | 0.476 | -11.85% | 74.99% |
| 21/63/252 majority absolute momentum, otherwise BIL | 25.76% | 14.97% | 8.82% | 1.184 | -4.47% | 64.79% |
| Signed multi-horizon trend with uninvested collateral | 19.02% | 11.18% | 8.39% | 0.843 | -5.70% | 58.03% |
| Frozen Finly with a fixed drawdown brake | 19.27% | 11.32% | 8.32% | 0.863 | -5.65% | 62.77% |
| Frozen Finly with a fixed high-volatility brake | 18.82% | 11.07% | 8.31% | 0.836 | -5.65% | 62.64% |
| Frozen Finly with a 252-session SPY/TLT/GLD dual-momentum gate | 7.66% | 4.59% | 2.08% | 0.307 | -1.73% | 3.35% |

Selected-versus-frozen differences: return -4.61%, Sharpe -0.382, drawdown -6.06%. Selected-versus-SPY raw return difference: -19.24%.

The same selector choice also trails the 10% volatility-target baseline in this seen extension by -3.65% of total return and -0.164 Sharpe.

## The requested 2013-2015 check

| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Avg. |SPY| |
|---|---:|---:|---:|---:|---:|---:|
| BIL cash baseline | -0.28% | -0.09% | 0.25% | n/a | -0.33% | 0.00% |
| SPY buy-and-hold baseline | 51.97% | 14.97% | 12.75% | 1.166 | -11.91% | 100.00% |
| SPY 10% volatility-target baseline | 30.68% | 9.33% | 10.61% | 0.903 | -10.75% | 84.42% |
| Frozen Finly 21/63/252 relative-trend ensemble | 20.65% | 6.46% | 8.71% | 0.773 | -6.50% | 73.98% |
| 252-session absolute momentum, otherwise BIL | 30.73% | 9.34% | 10.56% | 0.908 | -10.75% | 83.61% |
| 21/63/252 majority absolute momentum, otherwise BIL | 19.95% | 6.25% | 9.43% | 0.700 | -8.45% | 77.93% |
| Signed multi-horizon trend with uninvested collateral | 10.88% | 3.50% | 8.19% | 0.473 | -8.30% | 68.42% |
| Frozen Finly with a fixed drawdown brake | 20.65% | 6.46% | 8.71% | 0.773 | -6.50% | 73.98% |
| Frozen Finly with a fixed high-volatility brake | 20.85% | 6.52% | 8.70% | 0.780 | -6.50% | 73.90% |
| Frozen Finly with a 252-session SPY/TLT/GLD dual-momentum gate | 18.88% | 5.93% | 7.69% | 0.802 | -5.52% | 59.31% |

This interval is inside development, not an independent test. It is reported because it was explicitly requested and was not used as a separate tuning target.

## Rolling and walk-forward evidence

For absolute_252_cash, positive rolling-window fractions were 82.34% over 252 sessions, 97.26% over 504 sessions, and 100.00% over 756 sessions. The respective fractions beating SPY were 12.49%, 11.82%, and 2.95%. These windows overlap and are not independent.

The annual walk-forward selector produced 12 test-year folds from 2013 through 2024. Its stitched return was 121.23%, BIL-excess Sharpe 0.729, and maximum drawdown -9.45%. Fold selection counts: FAIL_CLOSED_BIL 3, absolute_252_cash 5, frozen_drawdown_brake 1, frozen_volatility_brake 3.

## Costs, parameters, tails, and statistical gates

Base costs are one basis point per one-way traded notional. A long-only change from 0% to 100% SPY trades two notionals—sell BIL and buy SPY—so it costs two basis points. The signed strategy is capped at one unit of gross exposure, excludes short-sale proceeds from BIL, and pays a 50-basis-point annualized borrow charge on short notional.

Target-volatility and 1/5/10-basis-point cost sensitivities for the selected and frozen strategies are recorded in the JSON. Tail evidence includes daily 5% expected shortfall, worst day, worst five-session and 20-session windows, drawdown dates, turnover, long/short utilization, and cash utilization.

For the selected candidate, the selection-sample Deflated-Sharpe probability is 23.35% and the White-style familywise p-value is 0.00100. The corresponding already-seen 2025-2026 values are 11.40% and 0.08092. These are falsification tools, not proof of stationarity or future profitability.

### Gate B matched-risk evidence, anchor 0

MRER is annualized candidate log growth minus BIL growth plus the baseline's BIL-excess log growth scaled to the candidate's realized volatility. Promotion requires positive median MRER and at least 60% positive annual-origin windows versus **both** baselines for every horizon, under every anchor and cost stress.

| Baseline | Sessions | Windows | Median MRER | Positive fraction | Median gate | Frequency gate |
|---|---:|---:|---:|---:|---:|---:|
| frozen_finly | 252 | 18 | 0.63% | 66.67% | PASS | PASS |
| frozen_finly | 504 | 17 | 0.01% | 52.94% | PASS | FAIL |
| frozen_finly | 756 | 16 | 0.18% | 62.50% | PASS | PASS |
| vol_target_10 | 252 | 18 | 0.00% | 16.67% | FAIL | FAIL |
| vol_target_10 | 504 | 17 | -0.87% | 23.53% | FAIL | FAIL |
| vol_target_10 | 756 | 16 | -0.57% | 31.25% | FAIL | FAIL |

The JSON contains the same window families for all five rebalance anchors, 1/5/10 bp each-way costs, paired Deflated-Sharpe probabilities using a conservative 53-trial declaration, and familywise circular-block tests at 5/20/60 sessions.

## What this can and cannot establish

- It can identify whether a small, literature-grounded rule improves return, Sharpe, drawdown, utilization, or cost robustness in these samples.
- It cannot make 2025-2026 fresh again, turn Yahoo into exchange-grade source data, establish live fill quality, or prove options profitability.
- Competitor projects are not simulated here because no public strategy specification has yet been shown to be faithful enough for like-for-like replication.
- Frozen Finly remains the incumbent. A new candidate would need a newly frozen, prospective Alpaca paper period after passing Gates A and B.

## Every failed promotion Boolean

- Gate A: `checks.immutable_pre_evaluation_freeze_exists`
- Gate A: `checks.complete_human_and_code_trial_registry_frozen`
- Gate A: `checks.output_schema_frozen_before_evaluation`
- Gate B: `anchors.0.core_direction.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.0.core_direction.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `anchors.0.core_direction.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.0.core_direction.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `anchors.0.core_direction.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.0.core_direction.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `anchors.0.core_direction.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.0.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.0.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.0.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.0.paired_statistics.frozen_finly.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.0.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.0.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.0.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.0.paired_statistics.vol_target_10.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.0.three_year_tail_and_drawdown.frozen_finly.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.0.three_year_tail_and_drawdown.vol_target_10.largest_3y_positive_paired_excess_share_at_most_50_percent`
- Gate B: `anchors.0.three_year_tail_and_drawdown.vol_target_10.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.1.core_direction.frozen_finly.504.median_mrer_strictly_positive`
- Gate B: `anchors.1.core_direction.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.1.core_direction.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `anchors.1.core_direction.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.1.core_direction.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `anchors.1.core_direction.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.1.core_direction.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `anchors.1.core_direction.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.1.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.1.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.1.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.1.paired_statistics.frozen_finly.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.1.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.1.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.1.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.1.paired_statistics.vol_target_10.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.1.three_year_tail_and_drawdown.frozen_finly.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.1.three_year_tail_and_drawdown.vol_target_10.largest_3y_positive_paired_excess_share_at_most_50_percent`
- Gate B: `anchors.1.three_year_tail_and_drawdown.vol_target_10.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.2.core_direction.frozen_finly.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.2.core_direction.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `anchors.2.core_direction.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.2.core_direction.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `anchors.2.core_direction.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.2.core_direction.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `anchors.2.core_direction.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.2.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.2.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.2.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.2.paired_statistics.frozen_finly.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.2.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.2.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.2.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.2.paired_statistics.vol_target_10.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.2.three_year_tail_and_drawdown.frozen_finly.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.2.three_year_tail_and_drawdown.frozen_finly.worst_3y_drawdown_not_worse_than_15_percent`
- Gate B: `anchors.2.three_year_tail_and_drawdown.vol_target_10.largest_3y_positive_paired_excess_share_at_most_50_percent`
- Gate B: `anchors.2.three_year_tail_and_drawdown.vol_target_10.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.2.three_year_tail_and_drawdown.vol_target_10.worst_3y_drawdown_not_worse_than_15_percent`
- Gate B: `anchors.3.core_direction.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.3.core_direction.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `anchors.3.core_direction.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.3.core_direction.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `anchors.3.core_direction.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.3.core_direction.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `anchors.3.core_direction.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.3.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.3.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.3.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.3.paired_statistics.frozen_finly.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.3.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.3.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.3.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.3.paired_statistics.vol_target_10.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.3.three_year_tail_and_drawdown.frozen_finly.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.3.three_year_tail_and_drawdown.vol_target_10.largest_3y_positive_paired_excess_share_at_most_50_percent`
- Gate B: `anchors.3.three_year_tail_and_drawdown.vol_target_10.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.4.core_direction.frozen_finly.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.4.core_direction.frozen_finly.504.median_mrer_strictly_positive`
- Gate B: `anchors.4.core_direction.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.4.core_direction.frozen_finly.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.4.core_direction.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `anchors.4.core_direction.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.4.core_direction.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `anchors.4.core_direction.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.4.core_direction.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `anchors.4.core_direction.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `anchors.4.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.4.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.4.paired_statistics.frozen_finly.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.4.paired_statistics.frozen_finly.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.4.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_20`
- Gate B: `anchors.4.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_5`
- Gate B: `anchors.4.paired_statistics.vol_target_10.familywise_p_at_most_5_percent_block_60`
- Gate B: `anchors.4.paired_statistics.vol_target_10.paired_deflated_sharpe_probability_at_least_95_percent`
- Gate B: `anchors.4.three_year_tail_and_drawdown.frozen_finly.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `anchors.4.three_year_tail_and_drawdown.vol_target_10.largest_3y_positive_paired_excess_share_at_most_50_percent`
- Gate B: `anchors.4.three_year_tail_and_drawdown.vol_target_10.worst_3y_drawdown_no_more_than_2pp_worse_than_frozen`
- Gate B: `cost_grid.0.1.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.1.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.1.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.1.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.1.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.1.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.1.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.10.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.10.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.10.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.10.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.10.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.10.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.5.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.5.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.5.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.5.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.5.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.0.5.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.0.5.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.1.frozen_finly.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.1.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.1.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.1.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.1.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.1.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.1.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.1.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.10.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.10.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.10.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.10.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.10.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.10.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.10.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.5.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.5.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.5.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.5.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.5.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.1.5.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.1.5.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.1.frozen_finly.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.1.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.1.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.1.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.1.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.1.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.1.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.10.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.10.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.10.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.10.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.10.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.10.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.5.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.5.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.5.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.5.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.2.5.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.2.5.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.1.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.1.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.1.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.1.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.1.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.1.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.1.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.10.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.10.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.10.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.10.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.10.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.10.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.5.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.5.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.5.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.5.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.3.5.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.3.5.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.1.frozen_finly.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.1.frozen_finly.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.1.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.1.frozen_finly.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.1.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.1.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.1.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.1.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.1.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.1.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.10.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.10.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.10.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.10.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.10.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.10.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.10.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.5.frozen_finly.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.5.frozen_finly.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.5.vol_target_10.252.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.5.vol_target_10.252.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.5.vol_target_10.504.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.5.vol_target_10.504.positive_mrer_fraction_at_least_60_percent`
- Gate B: `cost_grid.4.5.vol_target_10.756.median_mrer_strictly_positive`
- Gate B: `cost_grid.4.5.vol_target_10.756.positive_mrer_fraction_at_least_60_percent`
- Gate B: `requirements.all_five_rebalance_anchors_pass_base_gate`
- Gate B: `requirements.all_five_rebalance_anchors_survive_1_5_10bp_cost_direction`
- Gate B: `requirements.full_human_and_code_trial_registry_known`
- Gate C: `checks.forward_policy_frozen_before_collection`
- Gate C: `checks.at_least_60_new_market_sessions`
- Gate C: `checks.at_least_12_scheduled_core_decisions`
- Gate C: `checks.broker_reconciled_core_pnl_positive_and_better_than_both_baselines`
- Gate C: `checks.forward_maximum_drawdown_at_most_10_percent`
- Gate C: `checks.one_hundred_percent_decision_order_fill_position_fee_equity_reconciliation`
- Gate C: `checks.zero_policy_broker_boundary_violations`
- Gate C: `checks.options_has_50_completed_broker_reconciled_spreads`
- Gate C: `checks.options_net_pnl_positive_under_frozen_cost_model`

## Primary sources

- [Time Series Momentum](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2089463) — Fixed 1- to 12-month directional trend signals; this study uses a single-ETF, unlevered adaptation.
- [A Century of Evidence on Trend-Following Investing](https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing) — The predeclared 1-, 3-, and 12-month horizon ensemble.
- [Absolute Momentum: A Simple Rule-Based Strategy and Universal Trend-Following Overlay](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2244633) — Long/cash absolute momentum and the bounded cross-asset relative-momentum gate.
- [Volatility-Managed Portfolios](https://www.nber.org/papers/w22208) — Lagged inverse-volatility scaling, capped at one rather than levered.
- [Momentum Has Its Moments](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2041429) — A fixed high-volatility brake as a falsifiable crash-risk overlay.
- [The Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) — Multiple-testing and non-normality-aware Sharpe falsification.
- [A Reality Check for Data Snooping](https://users.ssc.wisc.edu/~behansen/718/White2000.pdf) — Shared-block maximum-statistic bootstrap across the disclosed candidate family.
- [Alpaca Historical Stock Bars](https://docs.alpaca.markets/reference/stockbars) — Authenticated, adjusted SIP overlap reference for source reconciliation.
