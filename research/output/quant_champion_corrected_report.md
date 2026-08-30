# Finly corrected quantitative champion search

Generated: 2026-08-29T10:32:44.982Z

Protocol SHA-256: `35d67bc6f7d540efeab8af1ca02712dc5e8873bd84580e793f1dbc6999b4f557`
Trial-ledger SHA-256: `cbd88396b4bd5e0f2fa805584496b50451e023168d937bf0352708678576d604`
Panel SHA-256: `b4d1932e421637a04348ca6947b53a866dd6b4a791a60a384889f5ed1bd93db0`

## Answer first

The audited pre-robustness selector chose **none**. Historical disposition: **KEEP_V1**. Pre-correction outputs are invalid and excluded. These metrics use queued t→t+1 execution, naturally drifting holdings, turnover against drifted weights, signal-time ensemble weights, and standalone boundary costs.

## development

| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Return minus SPY |
|---|---:|---:|---:|---:|---:|---:|
| bil_cash | 1.42% | 0.15% | 0.58% | n/a | -0.78% | -131.43% |
| spy_buy_hold | 132.85% | 9.22% | 20.34% | 0.525 | -50.70% | 0.00% |
| qqq_buy_hold | 242.45% | 13.71% | 20.90% | 0.709 | -49.37% | 109.60% |
| spy_levered_150 | 208.02% | 12.46% | 31.53% | 0.523 | -67.05% | 75.17% |
| sixty_forty | 105.82% | 7.83% | 11.04% | 0.717 | -30.68% | -27.03% |
| spy_vol_target_15 | 147.42% | 9.92% | 13.05% | 0.775 | -27.27% | 14.57% |
| frozen_finly | 75.02% | 6.02% | 7.99% | 0.753 | -11.21% | -57.83% |
| multi_asset_trend_ensemble | 117.48% | 8.45% | 8.40% | 0.995 | -10.52% | -15.37% |
| equity_bond_cross_signal | 148.76% | 9.98% | 9.03% | 1.081 | -12.41% | 15.91% |
| defensive_sleeve_rotation | 90.36% | 6.95% | 9.80% | 0.722 | -19.57% | -42.48% |
| dual_horizon_volatility_finly | 71.80% | 5.81% | 7.74% | 0.751 | -10.99% | -61.04% |
| trend_spy_vol15 | 111.89% | 8.15% | 9.98% | 0.821 | -15.88% | -20.96% |
| sector_top3_momentum | 134.82% | 9.32% | 13.01% | 0.737 | -19.70% | 1.97% |
| cross_asset_top3_momentum | 105.49% | 7.81% | 11.55% | 0.697 | -17.48% | -27.36% |
| equity_dual_momentum | 90.97% | 6.99% | 15.29% | 0.509 | -21.75% | -41.88% |
| sector_breadth_equity_rotation | 106.55% | 7.87% | 11.35% | 0.711 | -13.71% | -26.29% |
| fixed_literature_model_ensemble | 116.18% | 8.38% | 7.22% | 1.133 | -7.73% | -16.67% |
| equal_weight_expert_ensemble | 137.10% | 9.43% | 12.98% | 0.748 | -18.02% | 4.25% |
| online_mwu_expert_ensemble | 124.03% | 8.78% | 12.82% | 0.709 | -20.27% | -8.82% |
| qqq_regime_momentum_long_only | 79.40% | 6.29% | 12.45% | 0.541 | -27.24% | -53.45% |
| qqq_spy_regime_rotation | 145.45% | 9.83% | 14.04% | 0.727 | -23.26% | 12.60% |
| equity_relative_strength_always | 145.80% | 9.84% | 21.95% | 0.529 | -55.79% | 12.96% |
| equity_relative_strength_absolute | 145.78% | 9.84% | 16.02% | 0.657 | -22.36% | 12.93% |
| sector_top1_always | 38.74% | 3.48% | 19.32% | 0.265 | -38.43% | -94.10% |
| sector_top1_absolute | 62.04% | 5.17% | 16.63% | 0.377 | -27.48% | -70.80% |
| aegis_direction_proxy_spy | 28.97% | 2.69% | 10.14% | 0.298 | -22.11% | -103.87% |
| alphapilot_daily_gate_proxy | -29.37% | -3.56% | 5.72% | -0.631 | -35.02% | -162.21% |

## validation selection

| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Return minus SPY |
|---|---:|---:|---:|---:|---:|---:|
| bil_cash | 16.55% | 2.22% | 0.25% | n/a | -0.21% | -129.03% |
| spy_buy_hold | 145.59% | 13.72% | 19.46% | 0.646 | -33.72% | 0.00% |
| qqq_buy_hold | 243.59% | 19.32% | 24.12% | 0.763 | -35.12% | 98.00% |
| spy_levered_150 | 218.79% | 18.05% | 30.05% | 0.630 | -48.50% | 73.20% |
| sixty_forty | 78.17% | 8.62% | 11.46% | 0.587 | -21.21% | -67.42% |
| spy_vol_target_15 | 115.12% | 11.59% | 13.78% | 0.706 | -19.89% | -30.47% |
| frozen_finly | 56.88% | 6.66% | 8.83% | 0.527 | -9.68% | -88.71% |
| multi_asset_trend_ensemble | 53.24% | 6.30% | 9.22% | 0.472 | -19.87% | -92.35% |
| equity_bond_cross_signal | 40.75% | 5.01% | 10.92% | 0.302 | -19.66% | -104.84% |
| defensive_sleeve_rotation | 51.91% | 6.17% | 11.18% | 0.395 | -15.30% | -93.68% |
| dual_horizon_volatility_finly | 51.74% | 6.15% | 8.47% | 0.489 | -9.41% | -93.84% |
| trend_spy_vol15 | 78.28% | 8.63% | 11.13% | 0.603 | -14.75% | -67.31% |
| sector_top3_momentum | 62.46% | 7.19% | 16.07% | 0.376 | -25.95% | -83.12% |
| cross_asset_top3_momentum | 31.68% | 4.02% | 12.50% | 0.202 | -19.38% | -113.91% |
| equity_dual_momentum | 27.65% | 3.56% | 16.16% | 0.162 | -23.55% | -117.94% |
| sector_breadth_equity_rotation | 73.02% | 8.16% | 11.89% | 0.535 | -14.90% | -72.57% |
| fixed_literature_model_ensemble | 53.26% | 6.30% | 8.45% | 0.507 | -15.22% | -92.32% |
| equal_weight_expert_ensemble | 64.02% | 7.34% | 15.19% | 0.398 | -22.97% | -81.57% |
| online_mwu_expert_ensemble | 61.06% | 7.06% | 15.17% | 0.381 | -23.39% | -84.52% |
| qqq_regime_momentum_long_only | 90.78% | 9.68% | 16.16% | 0.518 | -18.32% | -54.80% |
| qqq_spy_regime_rotation | 126.33% | 12.40% | 18.65% | 0.603 | -28.59% | -19.26% |
| equity_relative_strength_always | 145.32% | 13.70% | 22.79% | 0.582 | -30.26% | -0.27% |
| equity_relative_strength_absolute | 115.66% | 11.63% | 19.95% | 0.542 | -28.56% | -29.93% |
| sector_top1_always | 179.34% | 15.84% | 26.61% | 0.604 | -31.15% | 33.76% |
| sector_top1_absolute | 131.24% | 12.75% | 26.06% | 0.507 | -31.15% | -14.35% |
| aegis_direction_proxy_spy | 24.89% | 3.23% | 10.90% | 0.146 | -23.11% | -120.70% |
| alphapilot_daily_gate_proxy | -3.10% | -0.45% | 6.08% | -0.405 | -16.08% | -148.69% |

## consumed recent diagnostic

| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Return minus SPY |
|---|---:|---:|---:|---:|---:|---:|
| bil_cash | 6.58% | 3.95% | 0.20% | n/a | -0.01% | -27.04% |
| spy_buy_hold | 33.62% | 19.29% | 17.35% | 0.878 | -18.76% | 0.00% |
| qqq_buy_hold | 41.89% | 23.74% | 22.69% | 0.879 | -22.77% | 8.27% |
| spy_levered_150 | 47.67% | 26.78% | 26.50% | 0.879 | -27.56% | 14.05% |
| sixty_forty | 22.66% | 13.24% | 10.60% | 0.857 | -10.52% | -10.96% |
| spy_vol_target_15 | 22.78% | 13.31% | 13.66% | 0.698 | -15.30% | -10.84% |
| frozen_finly | 18.10% | 10.66% | 8.31% | 0.792 | -5.84% | -15.52% |
| multi_asset_trend_ensemble | 32.33% | 18.59% | 9.68% | 1.408 | -6.96% | -1.29% |
| equity_bond_cross_signal | 15.58% | 9.22% | 11.76% | 0.477 | -13.09% | -18.04% |
| defensive_sleeve_rotation | 27.32% | 15.84% | 10.59% | 1.074 | -6.64% | -6.30% |
| dual_horizon_volatility_finly | 15.84% | 9.36% | 7.94% | 0.677 | -5.87% | -17.78% |
| trend_spy_vol15 | 20.84% | 12.21% | 10.72% | 0.766 | -9.17% | -12.78% |
| sector_top3_momentum | 15.67% | 9.27% | 13.65% | 0.433 | -13.79% | -17.95% |
| cross_asset_top3_momentum | 30.81% | 17.76% | 13.91% | 0.965 | -13.48% | -2.81% |
| equity_dual_momentum | 35.54% | 20.34% | 19.86% | 0.835 | -18.47% | 1.92% |
| sector_breadth_equity_rotation | 13.04% | 7.75% | 12.04% | 0.357 | -11.62% | -20.58% |
| fixed_literature_model_ensemble | 21.69% | 12.70% | 8.74% | 0.965 | -7.59% | -11.93% |
| equal_weight_expert_ensemble | 26.40% | 15.33% | 15.78% | 0.736 | -16.10% | -7.22% |
| online_mwu_expert_ensemble | 25.98% | 15.10% | 16.01% | 0.715 | -16.09% | -7.64% |
| qqq_regime_momentum_long_only | 28.99% | 16.76% | 15.67% | 0.819 | -11.22% | -4.63% |
| qqq_spy_regime_rotation | 22.46% | 13.12% | 16.80% | 0.587 | -13.07% | -11.17% |
| equity_relative_strength_always | 33.94% | 19.47% | 21.22% | 0.760 | -21.78% | 0.31% |
| equity_relative_strength_absolute | 21.40% | 12.53% | 16.85% | 0.554 | -13.07% | -12.22% |
| sector_top1_always | 19.67% | 11.55% | 22.74% | 0.424 | -20.00% | -13.95% |
| sector_top1_absolute | 13.49% | 8.01% | 22.42% | 0.283 | -20.00% | -20.13% |
| aegis_direction_proxy_spy | 14.40% | 8.53% | 9.54% | 0.498 | -9.94% | -19.22% |
| alphapilot_daily_gate_proxy | -1.30% | -0.79% | 5.07% | -0.897 | -4.70% | -34.92% |

## requested 2013 2015

| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Return minus SPY |
|---|---:|---:|---:|---:|---:|---:|
| bil_cash | -0.28% | -0.09% | 0.25% | n/a | -0.33% | -52.03% |
| spy_buy_hold | 51.75% | 14.91% | 12.74% | 1.162 | -11.91% | 0.00% |
| qqq_buy_hold | 77.95% | 21.18% | 14.82% | 1.377 | -13.94% | 26.20% |
| spy_levered_150 | 82.70% | 22.25% | 19.21% | 1.147 | -17.76% | 30.95% |
| sixty_forty | 31.29% | 9.50% | 7.24% | 1.302 | -6.88% | -20.45% |
| spy_vol_target_15 | 48.92% | 14.20% | 12.12% | 1.163 | -11.91% | -2.83% |
| frozen_finly | 18.58% | 5.85% | 8.70% | 0.707 | -7.14% | -33.17% |
| multi_asset_trend_ensemble | 8.38% | 2.72% | 7.64% | 0.402 | -8.46% | -43.37% |
| equity_bond_cross_signal | 34.19% | 10.30% | 8.91% | 1.155 | -9.09% | -17.56% |
| defensive_sleeve_rotation | 16.09% | 5.10% | 9.84% | 0.564 | -14.10% | -35.66% |
| dual_horizon_volatility_finly | 20.44% | 6.40% | 8.60% | 0.775 | -6.90% | -31.31% |
| trend_spy_vol15 | 37.38% | 11.17% | 10.72% | 1.050 | -7.60% | -14.37% |
| sector_top3_momentum | 47.64% | 13.87% | 12.94% | 1.076 | -10.91% | -4.10% |
| cross_asset_top3_momentum | 28.55% | 8.73% | 11.71% | 0.782 | -13.96% | -23.20% |
| equity_dual_momentum | 49.92% | 14.45% | 14.47% | 1.012 | -13.94% | -1.83% |
| sector_breadth_equity_rotation | 41.94% | 12.38% | 11.98% | 1.043 | -11.37% | -9.81% |
| fixed_literature_model_ensemble | 21.04% | 6.57% | 7.69% | 0.879 | -6.32% | -30.71% |
| equal_weight_expert_ensemble | 48.64% | 14.13% | 12.59% | 1.120 | -12.49% | -3.11% |
| online_mwu_expert_ensemble | 48.91% | 14.19% | 12.66% | 1.119 | -12.65% | -2.84% |
| qqq_regime_momentum_long_only | 30.25% | 9.21% | 12.64% | 0.768 | -13.31% | -21.50% |
| qqq_spy_regime_rotation | 71.50% | 19.70% | 13.83% | 1.376 | -13.94% | 19.75% |
| equity_relative_strength_always | 71.85% | 19.78% | 15.39% | 1.256 | -13.94% | 20.10% |
| equity_relative_strength_absolute | 52.46% | 15.09% | 14.69% | 1.037 | -14.30% | 0.71% |
| sector_top1_always | 31.52% | 9.56% | 15.38% | 0.677 | -16.72% | -20.23% |
| sector_top1_absolute | 31.52% | 9.56% | 15.38% | 0.677 | -16.72% | -20.23% |
| aegis_direction_proxy_spy | -3.97% | -1.34% | 8.62% | -0.103 | -20.24% | -55.72% |
| alphapilot_daily_gate_proxy | -11.98% | -4.17% | 4.32% | -0.942 | -15.52% | -63.73% |

## post 2013 full history

| Strategy | Return | Ann. return | Volatility | BIL-excess Sharpe | Max drawdown | Return minus SPY |
|---|---:|---:|---:|---:|---:|---:|
| bil_cash | 24.86% | 1.64% | 0.26% | n/a | -0.33% | -555.96% |
| spy_buy_hold | 580.82% | 15.11% | 16.79% | 0.826 | -33.72% | 0.00% |
| qqq_buy_hold | 1136.28% | 20.27% | 20.87% | 0.911 | -35.12% | 555.46% |
| spy_levered_150 | 1253.34% | 21.07% | 25.78% | 0.808 | -48.50% | 672.52% |
| sixty_forty | 252.74% | 9.69% | 9.86% | 0.822 | -21.21% | -328.08% |
| spy_vol_target_15 | 430.07% | 13.02% | 12.85% | 0.890 | -19.89% | -150.74% |
| frozen_finly | 170.00% | 7.56% | 8.53% | 0.707 | -9.68% | -410.82% |
| multi_asset_trend_ensemble | 159.59% | 7.25% | 8.65% | 0.665 | -19.87% | -421.23% |
| equity_bond_cross_signal | 172.53% | 7.63% | 10.19% | 0.613 | -19.66% | -408.28% |
| defensive_sleeve_rotation | 156.61% | 7.16% | 10.44% | 0.559 | -19.57% | -424.20% |
| dual_horizon_volatility_finly | 158.72% | 7.22% | 8.26% | 0.689 | -9.41% | -422.09% |
| trend_spy_vol15 | 278.07% | 10.25% | 10.59% | 0.821 | -14.75% | -302.75% |
| sector_top3_momentum | 258.65% | 9.83% | 14.41% | 0.609 | -25.95% | -322.17% |
| cross_asset_top3_momentum | 168.78% | 7.53% | 12.22% | 0.522 | -19.38% | -412.03% |
| equity_dual_momentum | 205.98% | 8.55% | 15.93% | 0.493 | -23.55% | -374.83% |
| sector_breadth_equity_rotation | 253.84% | 9.72% | 11.48% | 0.723 | -14.90% | -326.98% |
| fixed_literature_model_ensemble | 176.99% | 7.76% | 8.02% | 0.770 | -15.22% | -403.82% |
| equal_weight_expert_ensemble | 284.96% | 10.40% | 14.06% | 0.658 | -22.97% | -295.86% |
| online_mwu_expert_ensemble | 272.49% | 10.13% | 14.10% | 0.640 | -23.39% | -308.33% |
| qqq_regime_momentum_long_only | 252.29% | 9.68% | 14.62% | 0.594 | -27.24% | -328.52% |
| qqq_spy_regime_rotation | 531.48% | 14.48% | 16.46% | 0.805 | -28.59% | -49.34% |
| equity_relative_strength_always | 638.58% | 15.80% | 20.04% | 0.751 | -30.26% | 57.76% |
| equity_relative_strength_absolute | 386.27% | 12.31% | 17.63% | 0.655 | -28.56% | -194.55% |
| sector_top1_always | 438.19% | 13.15% | 22.40% | 0.591 | -31.15% | -142.63% |
| sector_top1_absolute | 322.49% | 11.15% | 22.03% | 0.517 | -31.15% | -258.33% |
| aegis_direction_proxy_spy | 66.91% | 3.83% | 9.82% | 0.266 | -23.11% | -513.91% |
| alphapilot_daily_gate_proxy | -13.64% | -1.07% | 5.25% | -0.490 | -20.73% | -594.46% |

## Selection gates

| Candidate | Development log-growth edge | Validation log-growth edge | Eligible | Failed gates |
|---|---:|---:|---:|---|
| equity_relative_strength_always | 0.57% | -0.02% | no | validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_volatility_not_above_spy, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct |
| qqq_spy_regime_rotation | 0.55% | -1.17% | no | validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| equity_relative_strength_absolute | 0.56% | -1.86% | no | validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_volatility_not_above_spy, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| qqq_regime_momentum_long_only | -2.72% | -3.61% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| sector_top1_absolute | -3.78% | -0.86% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_volatility_not_above_spy, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_positive_fraction_at_least_60pct |
| trend_spy_vol15 | -0.98% | -4.58% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| sector_breadth_equity_rotation | -1.25% | -5.01% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| sector_top1_always | -5.40% | 1.84% | no | development_raw_log_growth_exceeds_spy, validation_volatility_not_above_spy, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_positive_fraction_at_least_60pct |
| equal_weight_expert_ensemble | 0.19% | -5.78% | no | validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| sector_top3_momentum | 0.09% | -5.91% | no | validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| online_mwu_expert_ensemble | -0.40% | -6.04% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| fixed_literature_model_ensemble | -0.78% | -6.75% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| multi_asset_trend_ensemble | -0.71% | -6.75% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| defensive_sleeve_rotation | -2.10% | -6.87% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| dual_horizon_volatility_finly | -3.17% | -6.89% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| equity_bond_cross_signal | 0.69% | -7.97% | no | validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| cross_asset_top3_momentum | -1.30% | -8.92% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| equity_dual_momentum | -2.07% | -9.36% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| aegis_direction_proxy_spy | -6.17% | -9.68% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |
| alphapilot_daily_gate_proxy | -12.45% | -13.31% | no | development_raw_log_growth_exceeds_spy, validation_raw_log_growth_exceeds_spy, validation_raw_advantage_at_least_50bp, validation_sharpe_exceeds_frozen_by_10bp, validation_sharpe_exceeds_vol_target_by_10bp, validation_drawdown_not_over_2pp_worse_than_frozen, validation_drawdown_not_worse_than_15pct, validation_rolling_252_median_raw_excess_positive, validation_rolling_252_positive_fraction_at_least_60pct, validation_rolling_504_median_raw_excess_positive, validation_rolling_504_positive_fraction_at_least_60pct, validation_rolling_756_median_raw_excess_positive, validation_rolling_756_positive_fraction_at_least_60pct |

The consumed 2025–2026 interval did not rank or break ties. Recent hard-safety veto: **no**.

## Claim boundary

All history is seen and revised. A retrospective pass can earn only SHADOW_ONLY after robustness; it cannot establish future profit, exact submitted-competitor P&L, or options profitability. QQQ, 1.5x SPY, and the separate TQQQ proxy remain visible diagnostics so a raw SPY beat cannot be passed off as hidden leverage or unexplained alpha.
