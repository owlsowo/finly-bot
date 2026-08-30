# Finly recurring-contribution replay

## Answer first

For the latest complete three-calendar-month path, identical $300 monthly deposits ended at **$885.86** in the frozen G4 nonproduction shadow allocation and **$909.16** in SPY, a retrospective difference of **$-23.29**. This number is a historical replay, not a forecast.

| Horizon (months) | Rolling windows | G4 beat SPY | Median ending advantage | 5th-percentile advantage | Latest advantage |
|---:|---:|---:|---:|---:|---:|
| 1 | 163 | 62.6% | $1.03 | $-5.18 | $-13.31 |
| 3 | 161 | 65.8% | $5.39 | $-17.22 | $-23.29 |
| 6 | 158 | 69.0% | $21.59 | $-39.32 | $15.59 |
| 12 | 152 | 74.3% | $78.20 | $-96.04 | $138.61 |

## What this does and does not test

The replay uses the exact frozen, causal Generation 4 ETF ledgers; starts each rolling account from cash; applies the declared 5 bp entry and later-deposit purchase costs; permits fractional ETF units; and ends mark-to-market. The one-month calendar windows do not overlap; longer horizons overlap heavily, and every summary shares the same consumed historical path. The analysis does **not** replay option premiums, predict the next three months, or convert these dependent windows into independent win probabilities.

Protocol SHA-256: `861215eb3db00d6d232706e8765c41dd0752fb951f9ef3977e76e964221cd11a`
Ledger SHA-256: `6f656b79d7a4e836eda3b85d35bfca34841e80c0da16a2afdef30e862d8a23e1`
