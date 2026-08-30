# Generation 5 authenticated source reconciliation v2

Protocol: `88f000732851a59f56a218c791731bb913e8ec51cd461b7a9347da6ae1697be6`
Freeze receipt: `3238a3bbb13f3c08073a81cb8bb1d2424ee42f8751d7e52f76ffdc07d98a3828`

## Answer first

**FAIL_CLOSED** as of 2026-08-29T11:42:13.181Z. The protocol was designed after the Generation 4 `FAIL_CLOSED` result was observed. It compares already-seen history and is not fresh out-of-sample evidence.

## Primary per-symbol comparison

The primary source-concordance comparison is the stored Generation 4 Yahoo adjusted-close panel versus fresh authenticated Alpaca IEX `adjustment=all` daily closes. No session is excluded based on `all` versus `split` differences.

| Symbol | Common sessions | Yahoo coverage of Alpaca dates | Daily correlation / BIL mean gap | Tracking error | Median gap (bp) | P99 gap (bp) | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| SPY | 1531 | 100.00% | 0.99870 | 0.950% | 1.35 | 9.17 | PASS |
| BIL | 1516 | 100.00% | 0.29 bp/yr mean gap | 0.161% | 0.89 | 2.53 | PASS |
| QQQ | 1530 | 100.00% | 0.99918 | 0.918% | 1.92 | 18.92 | PASS |
| IWM | 1530 | 100.00% | 0.99932 | 0.830% | 2.27 | 14.27 | PASS |
| EFA | 1530 | 100.00% | 0.99912 | 0.685% | 2.02 | 10.61 | PASS |
| EEM | 1530 | 100.00% | 0.99926 | 0.759% | 2.81 | 12.43 | PASS |
| IEF | 1530 | 100.00% | 0.99847 | 0.402% | 1.24 | 8.46 | PASS |
| TLT | 1530 | 100.00% | 0.99910 | 0.648% | 2.14 | 13.55 | PASS |
| GLD | 1530 | 100.00% | 0.99974 | 0.426% | 1.21 | 8.12 | PASS |
| DBC | 1529 | 100.00% | 0.99697 | 1.488% | 3.90 | 34.46 | PASS |
| VNQ | 1530 | 100.00% | 0.99841 | 1.051% | 2.97 | 18.10 | PASS |
| XLK | 1530 | 100.00% | 0.99922 | 0.993% | 2.73 | 17.05 | PASS |
| XLF | 1530 | 100.00% | 0.99842 | 1.064% | 3.68 | 18.10 | PASS |
| XLE | 1530 | 100.00% | 0.99912 | 1.167% | 3.35 | 19.78 | PASS |
| XLY | 1530 | 100.00% | 0.99929 | 0.870% | 2.29 | 17.09 | PASS |
| XLP | 1530 | 100.00% | 0.99842 | 0.750% | 2.37 | 13.35 | PASS |
| XLI | 1530 | 100.00% | 0.99937 | 0.624% | 1.92 | 11.17 | PASS |
| XLB | 1530 | 100.00% | 0.99918 | 0.775% | 2.44 | 14.83 | PASS |
| XLV | 1530 | 100.00% | 0.99822 | 0.890% | 2.20 | 13.75 | PASS |
| XLU | 1530 | 100.00% | 0.99886 | 0.822% | 2.57 | 11.47 | PASS |

BIL uses its separately frozen near-zero-return gates and has no correlation requirement.

## Every eligible Generation 5 candidate

| Candidate | Exact canonical decision agreement | Daily return correlation | Tracking error | Edge difference vs SPY | Result |
|---|---:|---:|---:|---:|---|
| flex_top5_voladj_momentum_trend | 100.00% | 0.999151 | 0.565% | 1.41 | PASS |
| sector_12_1_top3_individual_trend | 100.00% | 0.999150 | 0.649% | 0.72 | PASS |
| qqq_vs_two_factor_residual_sector_basket | 100.00% | 0.999276 | 0.814% | 5.98 | PASS |
| long_only_tsmom_ewma60 | 16.39% | 0.999028 | 0.624% | 2.06 | FAIL |

The full decision vector is rounded to the engine's canonical ten decimal places before exact comparison. Every eligible candidate must pass every candidate gate, and every one of the 20 symbols must pass its own primary gate family.

## Split-adjusted diagnostic boundary

Alpaca IEX `adjustment=split` is retained only as a disclosed diagnostic. Alpaca documents `split` as forward/reverse split adjustment and `all` as split, cash-dividend, and spin-off adjustment. Split/all differences are not classified as corporate-action dates and do not remove any observation. IEX is Investors Exchange, one exchange rather than the consolidated SIP feed.

Official Alpaca references: [historical bars](https://docs.alpaca.markets/us/reference/stockbars), [IEX versus SIP](https://docs.alpaca.markets/us/docs/market-data-faq).

## Decision boundary

long_only_tsmom_ewma60 failed one or more candidate source-concordance gates

Even a pass supports only source concordance over authenticated overlap. It does not prove future profitability, independent alpha, or permission for live capital.
