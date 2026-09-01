# Alpaca MCP paper setup

Finly is configured for Alpaca's official MCP package
`alpaca-mcp-server==2.2.1`. Paper mode is explicit and the repository enables
only the seven toolsets used by its coordinated four-fund and SPY-options
sleeves.

## Current verified state

The package was installed locally, built with dummy credentials, and asked to
list its tools without making a network call. The resulting
mutation schemas have these exact canonical hashes:

```text
place_option_order: sha256:652e116dd021d05fceb7f34b0dcf17d6c3a0dfe82dc47f67372dbf872a521a55
place_stock_order: sha256:3826d0d06bf6c48e77897fa2a833431a42287b34c4bb9a3a303db7b726759288
```

The checked-in artifact is
`config/alpaca-mcp-place-option-order-2.2.1.json`. It confirms that multi-leg
orders accept a `legs` array and that `extended_hours` is not a parameter of
this tool version.

The order-tool introspection is an **offline runtime-schema check**, not proof
of broker mutation. Separately, the same pinned official server was invoked
over MCP stdio with paper credentials: its read-only `get_account_info` tool
succeeded and produced the redacted trace at
`evidence/alpaca_mcp_read_trace.json`. That trace confirms paper mode, an active
and unblocked options-level-3 account, the required starting balance, and
`mutation_requested:false` without serializing credentials or the raw response.

That trace records the pre-launch read check, not the current release ceiling.
The pinned competition runner later enabled paper-only mutation and completed
15 ETF fill events on the dedicated account. Finly's coordinated options sleeve
uses the same official MCP boundary and a tested entry/retry/reconciliation/exit
lifecycle, but no live options order or fill is claimed. The public options
examples remain synthetic approval and `NO_TRADE` demonstrations.

## Configure locally

1. Install `uv` from Astral's official instructions if `uvx` is unavailable.
2. Copy `config/alpaca-mcp.example.json` into your MCP client's local config.
3. Replace the two sentinel credential strings **in the local config only**.
4. Keep `ALPACA_PAPER_TRADE` equal to `true`.
5. Restart the MCP client so it discovers the pinned schemas.
6. Run `npm run mcp:verify` to audit the checked-in config and schema artifact.

`npm run mcp:verify` intentionally performs no network request. To repeat the
runtime introspection against a locally installed package, create a disposable
virtual environment and run:

```bash
python3 -m venv .venv-alpaca-mcp
.venv-alpaca-mcp/bin/python -m pip install "alpaca-mcp-server==2.2.1"
.venv-alpaca-mcp/bin/python scripts/introspect_alpaca_mcp.py
```

The expected terminal status is `RUNTIME_SCHEMAS_MATCH` with both hashes above and
`network_call_made:false`.

To reproduce the authenticated, read-only MCP protocol call after placing paper
credentials in the ignored `.env.local`, run:

```bash
.venv-alpaca-mcp/bin/python scripts/run_authenticated_mcp_read.py \
  --expected-account-id YOUR_PAPER_ACCOUNT_ID \
  --server-command .venv-alpaca-mcp/bin/alpaca-mcp-server
```

This starts the official server as an MCP stdio subprocess and calls only
`get_account_info`. The script fails if the account differs, the tool errors,
or the package version drifts; it never requests a mutation.

## Read-only paper readiness

With paper credentials present only in the local environment, run:

```bash
APCA_API_KEY_ID=... APCA_API_SECRET_KEY=... npm run paper:health
```

The command reads the paper account, account configuration, and market clock.
It reports `check_type: "READ_ONLY_HEALTH"` plus:

- `status: "READY"` when the account is active, unblocked, not suspended,
  options level 3 or higher is effective, and the market is open;
- `status: "BLOCKED"` with explicit blockers otherwise.

`READY` means only that the read-side prerequisites were visible at that
moment. The output always reports `mutation_authorized:false`; it does not
authorize an order.

## Controlled paper deployment checklist

The guarded runner is for the dedicated hackathon **paper account only**. It
must never be pointed at a live-money account. Run it during market hours, after
the read-only health check reports `READY`, and keep the default one-cycle
interval unless a longer supervised run is intentional.

For a fresh isolated paper deployment, put the following values in the ignored `.env.local`.
The REST client and preflight are code-locked to the paper host shown below, and
the acknowledgement must match exactly. Generate the signing secret locally; it
must contain at least 32 bytes. The ledger path must remain in the ignored
local-state directory.

```dotenv
ALPACA_PAPER_BASE_URL=https://paper-api.alpaca.markets
ALPACA_PAPER_TRADE=true
FINLY_COMPETITION_ACCOUNT_ID=YOUR_PAPER_ACCOUNT_ID
FINLY_COMPETITION_START_AT=2026-08-31T13:30:00.000Z
FINLY_COMPETITION_END_AT=2026-09-04T13:30:00.000Z
FINLY_EXECUTION_TRANSPORT=mcp
FINLY_EXECUTION_ENABLED=true
FINLY_PAPER_SIGNING_SECRET=
FINLY_PERMIT_LEDGER_PATH=data/ledger
FINLY_PAPER_MUTATION_ACK=I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT
```

Keep the Alpaca API key and secret in the same ignored file under either the
`APCA_API_KEY_ID` / `APCA_API_SECRET_KEY` names used by the REST reads or the
`ALPACA_API_KEY` / `ALPACA_SECRET_KEY` names used by the official MCP server.
Finly accepts both aliases locally; if both pairs are present, they must be
byte-for-byte identical so REST preflight cannot validate one account while MCP
mutates another. Credentials never enter an order projection.

Then complete this guarded sequence:

1. `npm run mcp:runtime` confirms that the installed package 2.2.1 exposes the
   pinned live tool schema without a network call, and `npm run mcp:verify`
   validates the committed authenticated-read trace offline;
2. `npm run paper:health` reports `READY` for the exact paper host. The guarded
   preflight separately requires the live account number to equal
   `FINLY_COMPETITION_ACCOUNT_ID` before mutation;
3. run `npm run paper:agent` while supervising the official paper account. The
   runner admits execution only from 9:30 a.m. ET on 31 August 2026 through
   9:30 a.m. ET on 4 September 2026; before the start it records `NO_TRADE`, and
   at the end it stops the loop. Before every
   cycle, the runner fetches a new read-only economic bundle in memory, derives
   the latest completed session from Alpaca's official calendar, waits a
   declared 15 minutes beyond that session's regular close, and records fetch
   completion—not the daily bar's session-label timestamp—as data availability.
   A failed, malformed, incomplete-current-session, or stale refresh fails the
   new-entry path closed. The runner may place one minimum-size, defined-risk
   `mleg` limit order only if the complete deterministic decision and permit
   path passes; otherwise it records `NO_TRADE`;
4. confirm that any accepted order is fetched by client order ID with nested
   legs and reconciled exactly against Finly's canonical projection;
5. disable mutation again by restoring `FINLY_EXECUTION_ENABLED=false` and
   clearing `FINLY_PAPER_MUTATION_ACK`;
6. before describing the options integration as broker-proven, exercise duplicate
   submission, timeout recovery, rejection, partial-fill, restart, cancel, and
   exit behavior without increasing risk.

`npm run paper:agent` is not part of `npm run verify` and must never be used as
an unattended release check. The acknowledgement authorizes paper-account
mutation only; it does not authorize real-money trading.

The static economic receipt path is evidence for judges, not an execution
input. The paper agent does not load that committed file as its live guard.
Each cycle refreshes and validates its own authenticated bundle immediately
before evaluating a new position.

The current release state is narrower and clearer: paper-only ETF execution is
broker-observed, the options workflow is implemented and may act only when all
existing gates approve, and no live options fill or options P&L is claimed.
Failure to approve remains a valid `NO_TRADE`, not permission to relax the
risk controls.

The public repository must never contain API keys. Code and static artifacts
are published through GitHub/GitHub Pages, not GPT Sites.

## Laptop-free GitHub Actions runner

The guarded one-cycle agent can also run on GitHub Actions during the exact
official window. Setup, required secrets, encrypted restart state, and the
sanitized live dashboard feed are documented in
[`docs/CLOUD_RUNNER.md`](CLOUD_RUNNER.md). The cloud transport remains the same
pinned Alpaca MCP server and dedicated paper account. A hosted Featherless
extractor may assess public news, but it receives no account/order data and has
no broker authority; any missing or invalid model response is omitted rather
than trusted.

## Official references

- [Alpaca MCP server documentation](https://docs.alpaca.markets/us/docs/alpaca-mcp-server)
- [Alpaca MCP server repository](https://github.com/alpacahq/alpaca-mcp-server)
- [Alpaca order endpoint documentation](https://docs.alpaca.markets/reference/postorder)
