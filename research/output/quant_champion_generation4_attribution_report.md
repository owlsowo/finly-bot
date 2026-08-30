# Finly Generation 4 selected-candidate attribution

## Boundary

**Post-selection, descriptive diagnostic only.** Candidate `qqq_core_sector_12_6` was fixed before this analysis. Nothing here is a search criterion, validation gate, fresh out-of-sample test, or permission to change the selected strategy. Inputs are the content-addressed frozen Generation 4 private panel and ledger only.

## Answer first

From 2013 through 2026-08-27, standalone net return was 967.11% for the candidate, versus 580.82% for SPY, 827.21% for the static 50/50 SPY/QQQ control, and 1136.28% for QQQ. The candidate's direct average start-of-return exposure was 50.01% QQQ and 7.49% XLK; QQQ plus XLK averaged 57.50%, but that is not a look-through technology weight. Daily gross-return correlation was 0.961 with QQQ and 0.979 with the static control. These numbers show substantial growth/technology exposure; they do not by themselves decide whether all gains came from that exposure.

## Sector selection and average weights

219 executed monthly rebalance decisions, with three sector slots per decision. QQQ's average target and realized weights were 50.00% and 50.01%, respectively.

| Sector | Decisions selected | Decision frequency | Average target weight | Average realized weight |
|---|---:|---:|---:|---:|
| XLK | 98 | 44.75% | 7.46% | 7.49% |
| XLY | 89 | 40.64% | 6.77% | 6.78% |
| XLU | 79 | 36.07% | 6.01% | 6.00% |
| XLV | 73 | 33.33% | 5.56% | 5.52% |
| XLP | 71 | 32.42% | 5.40% | 5.42% |
| XLF | 69 | 31.51% | 5.25% | 5.27% |
| XLI | 68 | 31.05% | 5.18% | 5.18% |
| XLE | 59 | 26.94% | 4.49% | 4.47% |
| XLB | 51 | 23.29% | 3.88% | 3.85% |

## Gross-return contribution

Contributions are in terminal initial-capital return points and reconcile to compounded gross return before costs.

| Position | Gross contribution | Share of gross return |
|---|---:|---:|
| QQQ | 6.371 | 50.12% |
| XLK | 2.014 | 15.84% |
| XLI | 0.878 | 6.91% |
| XLY | 0.850 | 6.69% |
| XLE | 0.820 | 6.45% |
| XLV | 0.533 | 4.19% |
| XLF | 0.502 | 3.95% |
| XLU | 0.301 | 2.37% |
| XLB | 0.255 | 2.01% |
| XLP | 0.186 | 1.47% |

Direct QQQ produced 50.12% of gross return; direct QQQ plus XLK produced 65.96%. Reconciliation error: `1.23e-8`. Modeled transaction-cost simple sum was 3.40% of contemporaneous portfolio value across the full path; annualized turnover was 3.73x.

## Standalone requested periods

Each period charges a fresh 5 bp one-way entry and terminal exit.

| Period | Candidate | SPY | Static 50/50 | QQQ |
|---|---:|---:|---:|---:|
| 2013–2015 | 69.60% | 51.75% | 64.46% | 77.95% |
| 2013–2026-08-27 | 967.11% | 580.82% | 827.21% | 1136.28% |

## Standalone calendar years

Each row charges a new 5 bp one-way entry and exit boundary. Asterisks denote partial years.

| Year | Candidate | SPY | Static 50/50 | QQQ |
|---|---:|---:|---:|---:|
| 2008* | -37.91% | -34.58% | -37.54% | -40.45% |
| 2009 | 40.20% | 26.17% | 39.79% | 54.46% |
| 2010 | 16.61% | 14.89% | 17.45% | 19.97% |
| 2011 | 4.60% | 1.74% | 2.60% | 3.32% |
| 2012 | 16.13% | 15.82% | 16.94% | 17.94% |
| 2013 | 34.11% | 32.11% | 34.29% | 36.43% |
| 2014 | 16.24% | 13.29% | 16.15% | 19.00% |
| 2015 | 8.49% | 1.08% | 5.12% | 9.27% |
| 2016 | 6.01% | 11.83% | 9.43% | 6.93% |
| 2017 | 21.34% | 21.52% | 26.99% | 32.47% |
| 2018 | -4.93% | -4.71% | -2.48% | -0.27% |
| 2019 | 39.32% | 31.03% | 34.89% | 38.75% |
| 2020 | 29.71% | 18.16% | 32.53% | 48.19% |
| 2021 | 25.07% | 28.53% | 28.01% | 27.23% |
| 2022 | -7.92% | -18.30% | -25.71% | -32.68% |
| 2023 | 30.86% | 25.99% | 39.75% | 54.62% |
| 2024 | 27.73% | 24.70% | 25.15% | 25.39% |
| 2025 | 17.08% | 17.54% | 19.09% | 20.59% |
| 2026* | 24.30% | 13.51% | 15.56% | 17.49% |

## Conventional crisis slices

These are hindsight-labeled, standalone peak/trough windows and are descriptive—not independent stress tests.

| Slice | Candidate | SPY | Static 50/50 | QQQ |
|---|---:|---:|---:|---:|
| GFC, available-ledger start to the March 2009 trough | -48.71% | -50.62% | -49.47% | -48.46% |
| 2011 euro-area debt / U.S. downgrade drawdown | -16.68% | -18.54% | -15.91% | -13.29% |
| COVID crash, prior SPY peak to trough | -28.75% | -33.50% | -30.42% | -27.33% |
| 2022 inflation / tightening bear-market drawdown | -13.99% | -24.17% | -29.03% | -33.75% |

## Overlapping rolling candidate-minus-SPY differences

These compound the already-recorded continuous net returns without adding artificial boundary trades to every window.

| Sessions | Windows | Mean | Median | P05 | P95 | Win fraction |
|---:|---:|---:|---:|---:|---:|---:|
| 5 | 4585 | 0.06% | 0.07% | -1.08% | 1.15% | 55.16% |
| 21 | 4569 | 0.25% | 0.25% | -1.96% | 2.56% | 59.18% |
| 63 | 4527 | 0.77% | 0.78% | -2.77% | 4.78% | 65.21% |
| 252 | 4338 | 3.31% | 3.35% | -4.03% | 10.96% | 77.20% |

The windows overlap heavily and are autocorrelated; counts and win fractions are not independent trials or p-values.

## Exposure proxies and caveats

The market-plus-growth proxy regression has SPY-minus-BIL beta 0.960, QQQ-minus-SPY beta 0.447, and R² 0.960. The static-control-plus-XLK proxy regression has R² 0.960. The exposure pattern explains most daily variation and QQQ/XLK supplied most gross return, while the candidate still exceeded the static control by 139.89 cumulative percentage points since 2013 and trailed all-QQQ by 169.17 cumulative percentage points. That combination is consistent with a dominant growth exposure plus a smaller sector-rotation difference; it is not proof that rotation generated persistent alpha. These are ETF proxies, not academic factors, and their in-sample linearized intercepts are not alpha claims. Gross contribution omits trading costs, crisis endpoints are chosen with hindsight, QQQ overlaps technology holdings, the ETF menu is fixed and limited, all evidence was consumed during strategy development, and 2026 is partial.
