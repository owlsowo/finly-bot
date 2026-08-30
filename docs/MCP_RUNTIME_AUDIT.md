# Alpaca MCP runtime audit

Audit date: 2026-08-28

## Decision

The release may demonstrate a synthetic evidence-to-order replay. It may not
submit an Alpaca order. Broker execution remains prohibited until a controlled
paper roundtrip and the complete entry/retry/reconciliation/exit lifecycle are
tested.

## Reproduced locally

The official package `alpaca-mcp-server==2.2.1` was installed in a local Python
virtual environment. `scripts/introspect_alpaca_mcp.py` supplied dummy
credentials, forced `ALPACA_PAPER_TRADE=true`, constructed the server, and
listed its trading tools. That operation did not call Alpaca's network.

Observed result:

```json
{"network_call_made":false,"package":"alpaca-mcp-server","paper":true,"schema_sha256":"sha256:652e116dd021d05fceb7f34b0dcf17d6c3a0dfe82dc47f67372dbf872a521a55","status":"RUNTIME_SCHEMA_MATCH","tool":"place_option_order","version":"2.2.1"}
```

The canonical `place_option_order` parameter schema is checked in at
`config/alpaca-mcp-place-option-order-2.2.1.json`. The local verifier confirms:

- package and schema artifact are pinned to version 2.2.1;
- the tool is exactly `place_option_order`;
- the canonical schema SHA-256 matches the value above;
- `legs` is an array in the exposed runtime schema;
- unknown top-level parameters are disallowed by the exposed schema;
- `extended_hours` is absent; and
- the example MCP configuration keeps paper mode explicit.

## Authenticated MCP read

On 2026-08-28, Finly started the official `alpaca-mcp-server==2.2.1` as an MCP
stdio subprocess and invoked its authenticated, read-only `get_account_info`
tool in paper mode. The call succeeded; the account was active, unblocked, and
approved and enabled for options level 3, and the required $100,000 starting
balance matched. The committed `evidence/alpaca_mcp_read_trace.json` retains the
tool and raw-response hashes plus safe account-state fields while omitting
credentials, all account identifiers, balances, buying power, and the raw
response. It records
`mutation_requested:false`.

The separate direct health check also read account configuration and the market
clock. Because the market was closed, its health gate remained blocked on
`market_open`, and an autonomous snapshot attempt returned fail-closed
`NO_TRADE` when the stock quote was stale. Execution stayed disabled
throughout.

## Not reproduced yet

The authenticated MCP read does **not** establish any of the following:

- MCP serialization of a real multi-leg request;
- Alpaca acceptance, rejection, fill, or partial-fill behavior;
- idempotent recovery after a timeout or process restart;
- nested-leg reconciliation against the accepted broker order;
- cancel, close, expiry, assignment, or emergency-exit behavior; or
- profitability, durable alpha, or live execution quality.

Those are release blockers for mutation, not details inferred from the tool
schema.

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
