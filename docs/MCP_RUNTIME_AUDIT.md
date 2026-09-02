# Alpaca MCP runtime audit and current status

Audit date: 2026-08-28
Current-status update: 2026-09-01

## Decision

This document began as a pre-launch audit and preserves what had been verified
on 28 August. It is not the current execution policy. Finly's competition
runner later enabled paper-only mutation at a pinned revision and completed 15
ETF fill events on the dedicated $100,000 Alpaca paper account. The coordinated
options sleeve is implemented and broker-capable, but no live options order or
fill is claimed. Its public approval and refusal examples remain synthetic.

## Reproduced locally

The official package `alpaca-mcp-server==2.2.1` was installed in a local Python
virtual environment. `scripts/introspect_alpaca_mcp.py` supplied dummy
credentials, forced `ALPACA_PAPER_TRADE=true`, constructed the server, and
listed its trading tools. That operation did not call Alpaca's network.

Observed result:

```json
{"network_call_made":false,"package":"alpaca-mcp-server","paper":true,"status":"RUNTIME_SCHEMAS_MATCH","tools":[{"schema_sha256":"sha256:652e116dd021d05fceb7f34b0dcf17d6c3a0dfe82dc47f67372dbf872a521a55","tool":"place_option_order"},{"schema_sha256":"sha256:3826d0d06bf6c48e77897fa2a833431a42287b34c4bb9a3a303db7b726759288","tool":"place_stock_order"}],"version":"2.2.1"}
```

The canonical `place_option_order` parameter schema is checked in at
`config/alpaca-mcp-place-option-order-2.2.1.json`; the frozen G4 protocol binds
the observed `place_stock_order` hash. The local verifier confirms:

- package and schema artifact are pinned to version 2.2.1;
- both mutation tools are present with the exact canonical SHA-256 values above;
- `legs` is an array in the exposed runtime schema;
- unknown top-level parameters are disallowed by the exposed schema;
- `extended_hours` is absent; and
- the example MCP configuration keeps paper mode explicit.

## Authenticated MCP read at the 28 August checkpoint

On 2026-08-28, Finly started the official `alpaca-mcp-server==2.2.1` as an MCP
stdio subprocess and invoked its authenticated, read-only `get_account_info`
tool in paper mode. The call succeeded; the account was active, unblocked, and
approved and enabled for options level 3, and the required $100,000 starting
balance matched. The committed `evidence/alpaca_mcp_read_trace.json` retains the
tool and raw-response hashes plus safe account-state fields while omitting
credentials, all account identifiers, balances, buying power, and the raw
response. It records
`mutation_requested:false`.

The direct health check also read account configuration and the market clock.
Because the market was closed, its health gate remained blocked on
`market_open`, and an autonomous snapshot attempt returned fail-closed
`NO_TRADE` when the stock quote was stale. Execution stayed disabled throughout
this pre-launch check.

## What this 28 August checkpoint had not reproduced

The authenticated MCP read does **not** establish any of the following:

- MCP serialization of a real multi-leg request;
- Alpaca acceptance, rejection, fill, or partial-fill behavior;
- idempotent recovery after a timeout or process restart;
- nested-leg reconciliation against the accepted broker order;
- cancel, close, expiry, assignment, or emergency-exit behavior; or
- profitability, durable alpha, or live execution quality.

At the time of this audit, those gaps blocked mutation. The current release has
since exercised the stock-order path and tests the options entry, retry,
reconciliation, and exit lifecycle. A real options acceptance, rejection,
partial fill, close, assignment, or expiry is still not claimed without a
corresponding broker artifact.

## Synthetic replay boundary

The checked demonstration uses synthetic, timestamped fixture records. At this
code state it compiles a SPY 560/550 bear put debit spread at a modeled $3.66
debit, with exact payoff bounds of $366 maximum loss and $634 maximum gain.
Its conservative modeled score is $97.18 and its worst-model positive-outcome fraction
is 60.89%. All four leave-one-family-out recompilations survive; 32 deterministic
perturbations produce no direction flip, retain the same compiled action type,
and have a $71.48 nearest-rank fifth-percentile modeled EV.

These are deterministic model outputs for one synthetic fixture. They are not
historical returns, a paper fill, a broker receipt, or evidence of future
profitability. The replay certificate is scoped to `synthetic_replay` and is
non-executable.

## Publication boundary

Source code and static demonstration artifacts belong in the GitHub repository
and, if published, GitHub Pages. They are not uploaded to GPT Sites.

## Current release boundary

Finly is one autonomous competition strategy with two coordinated sleeves. Its
four-fund sleeve produced 15 ETF fill events; its capped-risk SPY options sleeve
may submit only a fresh order that passes the existing evidence, payoff, loss,
account, and lifecycle checks. Otherwise it records `NO_TRADE`. The public
verification run contains 827 tests: 825 passed, none failed, and two were
skipped. These facts supersede the pre-launch statement that all broker
execution was prohibited; they do not establish live options P&L or future
profitability.
