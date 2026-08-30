# Generation 4 source-overlap reconciliation

Protocol: `306f49f6632ed58c3e9ea446d87c1c28fc0a0d13b188cfa276f83f7cbbb0652d`

## Answer first

**FAIL_CLOSED** as of 2026-08-29T10:57:07.135Z. This is a source-concordance check against the exact content-addressed Yahoo panel used by Generation 4; it is not a second out-of-sample profitability test.

| Symbol | Common sessions | Yahoo dates covered | Ordinary log-return corr. | Median gap (bp) | P99 gap (bp) | Distribution intervals excluded | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| SPY | 1531 | 77.95% | 0.99751 | 1.18 | 17.89 | 1322 (86.41%) | FAIL |
| BIL | 1516 | 99.08% | 0.60752 | 0.55 | 2.19 | 1183 (78.09%) | FAIL |
| QQQ | 1530 | 100.00% | 0.99812 | 1.69 | 13.84 | 1360 (88.95%) | FAIL |
| XLK | 1530 | 100.00% | 0.99963 | 1.83 | 18.78 | 1462 (95.62%) | FAIL |
| XLF | 1530 | 100.00% | 0.99911 | 1.85 | 9.69 | 1461 (95.55%) | FAIL |
| XLE | 1530 | 100.00% | 0.99947 | 3.71 | 7.81 | 1470 (96.14%) | FAIL |
| XLY | 1530 | 100.00% | 0.99964 | 2.16 | 10.21 | 1464 (95.75%) | FAIL |
| XLP | 1530 | 100.00% | 0.99952 | 2.05 | 9.90 | 1459 (95.42%) | FAIL |
| XLI | 1530 | 100.00% | 0.99967 | 1.87 | 8.94 | 1448 (94.70%) | FAIL |
| XLB | 1530 | 100.00% | 0.99941 | 2.57 | 7.34 | 1468 (96.01%) | FAIL |
| XLV | 1530 | 100.00% | 0.99967 | 1.68 | 8.12 | 1439 (94.11%) | FAIL |
| XLU | 1530 | 100.00% | 0.99949 | 2.21 | 6.90 | 1467 (95.95%) | FAIL |

## Candidate-level result

- Fully common panel: 2020-07-27 to 2026-08-27 (1516 sessions).
- Exact top-three sector agreement: 100.00%.
- Mean top-three Jaccard agreement: 100.00%.
- Candidate daily log-return correlation: 0.999237.
- Candidate annualized log-return tracking error: 0.716%.
- Yahoo versus Alpaca candidate-minus-SPY log-growth edge difference: 2.17 bp/year.

## Disclosed distribution-interval exclusions

Yahoo adjusted close includes distributions; Alpaca `adjustment=split` does not. The protocol therefore identifies intervals where Alpaca `all` and `split` log returns differ by more than 0.01 bp, excludes only those intervals from the ordinary-session price-feed fidelity gate, discloses every date in JSON, and caps exclusions at 8% per symbol. Up to ten examples per symbol follow:

SPY: 2020-07-27, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10, 2020-08-11
BIL: 2020-08-05, 2020-08-07, 2020-08-17, 2020-08-18, 2020-08-20, 2020-08-21, 2020-08-25, 2020-08-26, 2020-09-02, 2020-09-10
QQQ: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10, 2020-08-11
XLK: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10
XLF: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10
XLE: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10
XLY: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10
XLP: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10
XLI: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10
XLB: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10
XLV: 2020-07-28, 2020-07-29, 2020-07-30, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10
XLU: 2020-07-28, 2020-07-29, 2020-07-31, 2020-08-03, 2020-08-04, 2020-08-05, 2020-08-06, 2020-08-07, 2020-08-10, 2020-08-11

## Boundary

Yahoo values are the stored adjusted-close points from the Generation 4 private panel. The ordinary-session feed check uses authenticated, read-only Alpaca IEX `adjustment=split` bars. The candidate-level total-return-like diagnostic uses Alpaca `adjustment=all`. IEX is a single-exchange feed, so exact close equality with Yahoo is not expected. Split-versus-all differences identify adjustment intervals but do not classify individual corporate actions.

Official Alpaca references: [historical bars](https://docs.alpaca.markets/us/reference/stockbars), [IEX versus SIP](https://docs.alpaca.markets/us/docs/market-data-faq).

Blocking reasons: SPY failed one or more source gates; BIL failed one or more source gates; QQQ failed one or more source gates; XLK failed one or more source gates; XLF failed one or more source gates; XLE failed one or more source gates; XLY failed one or more source gates; XLP failed one or more source gates; XLI failed one or more source gates; XLB failed one or more source gates; XLV failed one or more source gates; XLU failed one or more source gates.
