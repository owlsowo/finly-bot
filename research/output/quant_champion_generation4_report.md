# Finly Generation 4 quantitative search

Protocol: `918b6992a8a4531cf24c4dd6b540c4fda1d19f8ed7a16717d09effa3f8f075e5`
Panel: `bef945fb53d56801d0d9f99d23a641d2ee7a7c14c515ddb3fec1acc79451e883`

## Answer first

Raw-return candidate before robustness: **qqq_core_sector_12_6**. Balanced candidate: **none**. Disposition: **RAW_RETURN_ROBUSTNESS_PENDING**.

| Candidate | Development SPY edge | Validation SPY edge | Validation vol | Validation drawdown | Failed raw gates |
|---|---:|---:|---:|---:|---|
| qqq_vs_spy_relative_regime_fully_invested | 2.19% | 2.29% | 22.10% | -30.44% | rolling_252_median_spy_edge_positive, rolling_252_spy_win_fraction_60pct |
| qqq_core_sector_12_6 | 1.61% | 4.39% | 20.99% | -28.99% | none |
| spy_core_qqq_sector_12_6 | 0.84% | 2.22% | 20.05% | -31.37% | none |
| qqq_defensive_dual_momentum | 0.66% | -1.02% | 21.45% | -29.49% | validation_log_growth_exceeds_spy, validation_edge_at_least_50bp, rolling_252_spy_win_fraction_60pct |
| spy_qqq_defensive_sleeves | -0.98% | -1.77% | 15.90% | -26.60% | development_log_growth_exceeds_spy, validation_log_growth_exceeds_spy, validation_edge_at_least_50bp, rolling_252_median_spy_edge_positive, rolling_252_spy_win_fraction_60pct, rolling_504_median_spy_edge_positive, rolling_504_spy_win_fraction_60pct, rolling_756_median_spy_edge_positive, rolling_756_spy_win_fraction_60pct |
| qqq_regime_defensive_rotation | -2.81% | -4.17% | 18.15% | -24.11% | development_log_growth_exceeds_spy, validation_log_growth_exceeds_spy, validation_edge_at_least_50bp, rolling_252_median_spy_edge_positive, rolling_252_spy_win_fraction_60pct, rolling_504_median_spy_edge_positive, rolling_504_spy_win_fraction_60pct, rolling_756_median_spy_edge_positive, rolling_756_spy_win_fraction_60pct |
| equity_defensive_relative_strength | -3.11% | -8.03% | 20.51% | -30.94% | development_log_growth_exceeds_spy, validation_log_growth_exceeds_spy, validation_edge_at_least_50bp, rolling_252_median_spy_edge_positive, rolling_252_spy_win_fraction_60pct, rolling_504_median_spy_edge_positive, rolling_504_spy_win_fraction_60pct, rolling_756_median_spy_edge_positive, rolling_756_spy_win_fraction_60pct |

The mandatory static 50/50 SPY/QQQ control returned 192.60% in validation. It is not an agent and cannot win selection; it exists to expose how much apparent SPY outperformance is merely a growth tilt. Every result is retrospective and remains unproven prospectively.
