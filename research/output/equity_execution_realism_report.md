# Finly equity execution-realism audit

## Answer first

The immutable, content-addressed Alpaca OHLC bundle reproduces a **16.38%** adjusted theoretical return at 1 bp per traded leg, versus **33.52%** for SPY over the same consumed 2025–2026 path. At 25 bp per leg the result remains positive at **10.56%**; the raw/no-distribution proxy is **12.75%**; and the $300 fractional proxy ends at **$351.88**. Finly did **not** beat SPY on total return in this period, and these retrospective mechanics do not prove alpha or future profit.

## Next-open experiment

Immutable adjusted and raw OHLC were supplied. The table below is a theoretical next-open ledger, not a paper-fill receipt.

| Cost per traded leg | Observations | Total return | Annualized return | Annualized volatility | Maximum drawdown | SPY total return |
|---:|---:|---:|---:|---:|---:|---:|
| 1 bp | 415 | 16.38% | 9.65% | 8.12% | -5.38% | 33.52% |
| 5 bp | 415 | 15.39% | 9.08% | 8.12% | -5.45% | 33.52% |
| 10 bp | 415 | 14.16% | 8.37% | 8.12% | -5.53% | 33.52% |
| 25 bp | 415 | 10.56% | 6.28% | 8.13% | -5.80% | 33.52% |

Raw/no-distribution proxy at 1 bp: **12.75%**. The $300 fractional proxy ended at **$351.88**.

## Available close-rebalance sensitivity — not execution realism

This assumes fills at a historical close and cannot be described as a next-open, paper-fill, or live-execution result.

| Cost per traded leg | Observations | Total return | Annualized return | Annualized volatility | Maximum drawdown | SPY total return |
|---:|---:|---:|---:|---:|---:|---:|
| 1 bp | 414 | 23.36% | 13.63% | 8.64% | -7.02% | 33.84% |
| 5 bp | 414 | 22.50% | 13.15% | 8.63% | -7.10% | 33.84% |
| 10 bp | 414 | 21.44% | 12.55% | 8.63% | -7.19% | 33.84% |
| 25 bp | 414 | 18.31% | 10.78% | 8.64% | -7.47% | 33.84% |

Five possible five-session cadence anchors at 1 bp show how much an arbitrary weekday-like phase changes the consumed path. “Fresh” starts the portfolio in BIL at the evaluation boundary instead of carrying pre-period state.

| Anchor | Continuous return | Continuous max drawdown | Fresh-start return | Fresh-start max drawdown |
|---:|---:|---:|---:|---:|
| 0 | 23.36% | -7.02% | 19.25% | -5.88% |
| 1 | 17.86% | -5.30% | 18.36% | -6.63% |
| 2 | 19.25% | -5.88% | 21.76% | -5.72% |
| 3 | 18.21% | -6.63% | 22.11% | -7.02% |
| 4 | 22.53% | -5.72% | 17.66% | -5.30% |

## Execution assumptions that can erase paper profitability

| Issue | Encoded treatment | Remaining boundary |
|---|---|---|
| Spread, slippage, market impact | Symmetric 1/5/10/25 bp per traded leg stress | Daily OHLC cannot reproduce quotes, queue position, halts, or price improvement |
| Distributions and cash yield | Adjusted SPY/BIL OHLC plus a raw/no-distribution proxy when the immutable bundle is present | Alpaca paper equity and historical adjusted-return accounting are not identical |
| Small-account feasibility | The generic OHLC engine supports $300, sell-first, $1 minimum, nine-decimal quantities, cash-capped buys, and a $0.01 sell-day fee proxy | Mathematically feasible in the shadow ledger; actual fractional eligibility, fills, and regulatory fees still require broker receipts |
| Tax and borrow | No taxes; no borrow cost because the frozen policy is long-only and unlevered | Taxable-account after-tax performance is untested |
| ETF universe | Only fixed SPY and BIL are consumed | The inherited 20-ETF source panel is a current-survivor menu and cannot support asset-selection claims |
| BIL staleness/rounding | The pinned close panel has 35.14% unchanged BIL close transitions | Coarsely rounded closes can suppress daily cash-proxy variation |

## Theory versus Alpaca paper

An adjusted-OHLC ledger is total-return theory. A raw/no-distribution ledger is only a closer proxy for paper-equity display. Neither is an Alpaca fill receipt. A paper round trip must preserve submitted order, broker acknowledgement, fill price and time, fees, fractional quantity, and exact account read-back without authorizing live-money execution.

## Reproduction and claim boundary

This artifact consumed frozen historical evidence only; it made no network call and no broker mutation. Close panel SHA-256: `aa2075c1989da7194f1de0f455fab83a4035ee878b5b410088d11aa39c0baaa2`. Policy source SHA-256: `b3887974330348bfe82445cf3cc6fbf96a571d6b57d986a61824184b659e8f8a`. OHLC bundle SHA-256: `bf6d30d1935580bad515c69f2f8f22a3107ec583fc262d3b661024ac83dc1f45`.

This consumed retrospective audit tests mechanics and sensitivity under disclosed assumptions. It does not establish alpha, a next-month SPY-beating probability, live/options profitability, or a promise of future returns. Close-only results are not next-open execution evidence.
