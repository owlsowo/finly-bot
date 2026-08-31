# Cloud paper runner and live dashboard feed

Finly can run on GitHub Actions while the development laptop is off. The cloud
runner executes one guarded cycle at a time against the dedicated Alpaca paper
account. It does not use Investopedia: only the Alpaca account is relevant to
the hackathon's official equity snapshot, and Alpaca provides a reproducible
broker record for every accepted paper order.

The workflow is intentionally inert until its secrets are configured and its
encrypted state branch is initialized manually. Committing the workflow alone
does not authorize a trade.

## What runs in the cloud

`.github/workflows/paper-agent-cloud.yml` has date-specific five-minute triggers
covering U.S. market hours during the official scoring period, plus a
mutation-disabled 8:30 a.m. ET opening-day readiness rehearsal. A second,
in-process UTC gate admits mutation only inside the exact half-open interval:

```text
2026-08-31T13:30:00.000Z <= now < 2026-09-04T13:30:00.000Z
```

Finly stops opening options positions at 3:00 p.m. ET on Wednesday
(`2026-09-02T19:00:00.000Z`). Any remaining filled options position receives a
forced competition-end exit at 3:00 p.m. ET on Thursday
(`2026-09-03T19:00:00.000Z`), leaving twelve scheduled five-minute
reconciliation cycles before Thursday's close. These narrower controls do not
change the official scoring window.

GitHub's scheduler can start a job later than its nominal minute, so the broker
clock and Finly's own time gate—not the cron expression—remain authoritative.
Workflow concurrency permits only one Finly paper cycle at a time.

Each live run:

1. restores authenticated lifecycle state from the isolated
   `finly-cloud-state` branch;
2. installs the pinned official `alpaca-mcp-server==2.2.1` package;
3. advances at most one step of the frozen, one-time G4 equity allocation, then
   runs the market/options/economic decision cycle only after the four-leg
   equity sleeve is reconciled as ready;
4. checkpoints encrypted lifecycle state before every equity or options broker
   mutation and again after the cycle; and
5. publishes a small read-only `competition_live.json` snapshot containing
   equity, P&L, aggregate exposure, market status, and a bounded agent status.

Initialization and pre-open readiness runs install the same pinned MCP package
and perform an offline, dummy-credential schema check for both
`place_stock_order` and `place_option_order`. This warms the package cache and
detects transport-schema drift before the opening bell without contacting the
broker or authorizing a mutation.

When a `FEATHERLESS_API_KEY` repository secret is present, the runner sends only
canonical public Alpaca news documents to the pinned
`NousResearch/Hermes-4-14B` model through Featherless's OpenAI-compatible HTTPS
endpoint. Thinking is disabled, temperature is zero, and JSON-object mode is
followed by Finly's exact local schema validation of every evidence ID, score,
and short rationale. The hosted extractor
has no account, broker, compiler, risk, or mutation object in scope. Its output
is validated again before aggregation and can never directly select a contract,
size, price, risk limit, or order.

The deployed live workflow requires the `FEATHERLESS_API_KEY` secret so judges
can see a hosted agentic evidence step while the laptop is off. It is still not
a broker dependency: an HTTP, timeout, model-identity, JSON, or exact-schema
failure records the event family as omitted and continues through the
deterministic market/options/economic, risk, compiler, challenge, and execution
gates. Deterministic broker authority is unchanged.

## Required GitHub Actions secrets

Create these repository secrets. Do not paste their values into an issue,
workflow file, commit, build log, or public dashboard:

- `FINLY_ALPACA_API_KEY_ID`
- `FINLY_ALPACA_SECRET_KEY`
- `FINLY_COMPETITION_ACCOUNT_ID`
- `FINLY_PAPER_SIGNING_SECRET` (at least 32 random bytes)
- `FINLY_CLOUD_STATE_SECRET` (a different value with at least 32 random bytes)
- `FINLY_PAPER_MUTATION_ACK` with the exact paper-only acknowledgement from
  `docs/MCP_SETUP.md`
- `FEATHERLESS_API_KEY` (the $25 hackathon credit funds the hosted news step)

The workflow maps one Alpaca key pair to both the REST preflight and MCP
transport names so two different accounts cannot be validated and mutated.

## One-time initialization

Before the official start time, open the workflow in GitHub Actions, select
**Run workflow**, and set `initialize_state` to `true`. Initialization is
manual-only and rejected after the competition begins. It authenticates the
paper account read side, probes the hosted Hermes extractor with one synthetic
no-broker-data document, creates the first encrypted state envelope, and
publishes the first sanitized dashboard snapshot without enabling mutation. A
failed hosted probe is visible in Actions but cannot block G4 initialization;
the live options path independently fails closed whenever hosted evidence is
unavailable. Readiness runs repeat that tiny probe before the opening bell.

Every later scheduled or manually dispatched live run requires that state
branch. A missing, modified, undecryptable, or incomplete state envelope fails
closed; the runner never silently treats missing state as a new account.

## Public and private state boundary

The repository is public, so the state branch contains exactly two artifacts:

- `competition_live.json`: an allowlisted, read-only summary with no account
  number, credentials, broker/order IDs, or symbols. It reports the G4 equity
  sleeve's gross market value separately from the options overlay's certified
  maximum loss;
- `private-state.enc.json`: lifecycle journals encrypted with AES-256-GCM under
  the separate `FINLY_CLOUD_STATE_SECRET`.

The live JSON is available at:

```text
https://raw.githubusercontent.com/owlsowo/finly-bot/finly-cloud-state/competition_live.json
```

GitHub Pages remains a static host. The website can fetch this JSON at runtime
with a cache-busting query string; Pages itself never receives Alpaca secrets
and never places an order.

## Failure behavior

- A missing required secret stops before any account read or mutation.
- A missing state branch stops every non-initialization run.
- State is encrypted and pushed before each entry mutation. If the runner dies
  after Alpaca accepts an order, the next job restores the pending session and
  reconciles the deterministic client-order ID rather than submitting a second
  order.
- Exit state is also checkpointed before its mutation. A restart derives the
  same exit idempotency key and reconciles it before retrying.
- G4 equity intent is persisted and encrypted before each of its four one-time
  paper orders. A restart reconciles the same deterministic client-order ID;
  it never silently starts the allocation again.
- A failed market read, economic refresh, broker preflight, MCP schema check,
  state checkpoint, or read-back ends in `NO_TRADE` or a frozen lifecycle.

This runner is paper-only infrastructure for the hackathon. It is not a
real-money deployment plan.
