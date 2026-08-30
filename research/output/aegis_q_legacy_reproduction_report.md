# AEGIS-Q legacy equity reproduction — auxiliary comparator

**Disposition:** published metric bundle was not reproduced within the frozen tolerances

> This is an auxiliary reproduction of AEGIS-Q's archived legacy QQQ/TQQQ equity strategy. It is not the submitted AEGIS-Q options strategy, not options P&L, not a Finly champion candidate, not evidence of future profitability, and not an apples-to-apples financial comparison with Finly.

## Native comparison

The hash-pinned local public-data panel was evaluated from 2021-05-12 through 2026-08-27 (1,330 observations). Signals use close-*t* information and execute at split-adjusted open *t+1*. Cash earns zero, dividends are excluded, and each traded leg is charged 5 bp one way.

| Portfolio | Ending value | Total return | CAGR | Volatility | Sharpe | Max drawdown |
|---|---:|---:|---:|---:|---:|---:|
| agent | $269,902.01 | 169.90% | 20.64% | 29.28% | 0.791 | -33.65% |
| QQQ | $223,980.63 | 123.98% | 16.46% | 22.79% | 0.785 | -37.10% |
| TQQQ | $317,525.32 | 217.53% | 24.40% | 68.28% | 0.663 | -81.60% |

## Published-bundle check

40 published fields were compared. 18 failed. Numeric tolerances were absolute 1e-8 plus relative 1e-10; integers and strings required exact equality.

- agent: failed annual_volatility, cagr, ending_value, estimated_slippage_dollars, max_drawdown, profit, sharpe_0pct_cash, total_return, turnover_multiple, worst_day
- QQQ: all published fields matched
- TQQQ: failed annual_volatility, cagr, ending_value, max_drawdown, profit, sharpe_0pct_cash, total_return, worst_day

## Integrity boundary

Panel file SHA-256: `af1a3e3fe684d83ced9745d3c2f294fd7ee44236fee0408222a4b32f2bba5fa9`

Normalized panel SHA-256: `220c19c570f364eed6318e90de44ba04d99a57ff947d52d0ff9d19d739e27215`

Pinned AEGIS-Q commit: `76bb97e9200c41c519440bb64ea40d2161367627`

The runner has no network acquisition path. A different panel, source timestamp, code hash, protocol hash, or freeze receipt fails closed before simulation. The official runner persists a process-only claim before its own first computation; this is not cryptographic proof of an unseen outcome because the published target is already known. Partial writes resume only when bytes are identical; later checks use `--verify-existing` and never overwrite them.
