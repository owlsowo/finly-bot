# Finly

Finly is a trading agent built around one rule: an AI may interpret evidence, but it does not get to decide how much capital to risk. The project began with a familiar ambition—use market data and AI judgment to find an options trade—and ran into a harder question. When a backtest looks unusually good, what evidence should it have to produce before the system is allowed to act on it?

Finly answers by separating market judgment from trading authority. An AI component may interpret a bounded evidence bundle, explain its assessment, reconsider that assessment when evidence is removed, or veto a proposal. It may not choose the direction, horizon, option structure, maximum loss, order fields, or final broker permission. Those decisions remain with deterministic code that can be tested, compared exactly, and made to fail closed.

[Open the interactive historical case](https://owlsowo.github.io/finly-bot/#range) · [Read the one-page proposal](public/judge/Finly_Judge_Brief.pdf) · [Read the technical paper](public/judge/Finly_Technical_Proposal.pdf) · [Review the consulting deck](public/judge/Finly_Consulting_Deck.pdf)

## A modeled $100,000 reached $1,067,106 in the strongest consumed replay

The most attractive candidate produced during the research program was the G4 shadow strategy. Every 21 trading sessions, it allocated half of the portfolio to QQQ and divided the other half equally among the three original sector ETFs with the strongest twelve-minus-six-month momentum. In a consumed adjusted-close replay from 2 January 2013 through 27 August 2026, after a modeled five-basis-point one-way cost, G4 recorded a higher annualized return and a shallower maximum drawdown than SPY.

The result is now explorable rather than frozen in one favorable screenshot. The [live range tool](https://owlsowo.github.io/finly-bot/#range) recomputes the G4 shadow and SPY from a modeled $100,000 for any selectable calendar-year interval inside the public evidence boundary. Across the full consumed record, G4 beat SPY in all **2,175 of 2,175** overlapping five-year trading-session windows. Those windows overlap heavily and are descriptive rather than independent tests, but they show that the full-period difference was not created by one endpoint alone.

| Consumed retrospective replay | G4 shadow | SPY buy-and-hold |
| --- | ---: | ---: |
| Total return | **967.11%** | 580.82% |
| Annualized return | **18.97%** | 15.11% |
| Annualized volatility | 18.01% | **16.79%** |
| Maximum drawdown | **-28.99%** | -33.72% |
| Annualized turnover | 3.78x | 0.22x |

The easy presentation would describe that chart as proof that the strategy works. Finly does not. G4 was selected after historical results had been viewed, every market interval used in the reported replay is now consumed, and the research process was adaptive. The repository records a local hash freeze of the formula, partitions, and costs before the first G4 output, but its timestamp is not an independent time authority. The excess-Sharpe selection rule and later inferential corrections changed afterward. The analysis is therefore not described as fully preregistered, and the replay is not treated as a forecast.

The result also failed the gates intended to distinguish an attractive backtest from evidence that deserves deployment authority:

| Promotion question | Observed evidence | Required evidence | Decision |
| --- | ---: | ---: | :---: |
| Did performance survive the Deflated Sharpe correction? | 3.75% probability | At least 95% | **Fail** |
| Did it survive the worst adjusted familywise test? | 0.3718 adjusted p-value | At most 0.05 | **Fail** |
| Was the edge independent of the static growth control? | Not supported | Supported | **Fail** |
| Did every required symbol pass authenticated source overlap? | No | Yes | **Fail** |
| Did the historical edge retain its sign at 5, 10, and 25 basis points? | Yes | Yes | Pass |
| Did all 21 monthly rebalance offsets retain a positive SPY edge? | Yes | Yes | Pass |

Seven later, frozen Generation 6 challengers produced no selection on either the primary SPY track or the separate growth-control track. Across a ledger of 113 conservatively counted research items, no new challenger earned promotion. That number includes controls, rejected or unexecuted suggestions, invalidated runs, an aborted attempt, and reruns; it is not a claim that 113 independent viable strategies were tested under identical conditions.

The precise public boundary is stored in [`public/data/submission_claims_lock.json`](public/data/submission_claims_lock.json), and the chart is backed by the machine-readable series in [`public/data/g4_wealth_drawdown.json`](public/data/g4_wealth_drawdown.json). The historical object is an ETF allocation replay. It is not options profit and loss, a paper-account fill record, or evidence of future profitability.

G4 is not the production policy. The frozen production book, `tsmom_ensemble_vol`, is a lower-risk SPY/BIL rule. In its now-consumed fixed 2025–2026 holdout it returned 11.13% annualized versus SPY's 19.19%, while reducing annualized volatility from 17.33% to 8.31% and maximum drawdown from -18.76% to -5.79%. The latest deterministic receipt proposed 95.71% SPY and 4.29% BIL, but no broker mutation was requested. Production Finly has zero forward observations; the evidence does not support saying it is more likely than not to beat SPY next month.

## Finly assigns each decision right to the component that can be audited

The architecture is designed around a simple institutional principle: the ability to contribute information does not automatically confer the right to act on capital. Each stage therefore receives only the authority it needs.

| Stage | What it contributes | What it is not allowed to do |
| --- | --- | --- |
| Evidence layer | Normalizes timestamps, labels sources, and records the bundle presented for review. | It cannot convert the presence of more data into confidence or permission. |
| AI assessment | Scores bounded evidence, gives a rationale, responds to evidence-removal challenges, and may veto. | It cannot enlarge exposure, choose contracts, populate an order, or authorize execution. |
| Quantitative core | Produces the code-owned direction, horizon, and typed economic intent. | It cannot bypass the later risk and equality gates. |
| Options compiler | Constructs a defined-risk SPY vertical, calculates exact payoff bounds, and projects an Alpaca multi-leg payload. | It cannot submit anything unless the compiled order agrees exactly with the permitted intent. |
| Authorization gateway | Checks freshness, provenance, schema, equality, aggregate loss, liquidity, and account constraints before returning `PERMIT` or `NO_TRADE`. | It cannot infer permission from model confidence or a favorable historical chart. |

This allocation of rights is Finly's main technical claim. AI remains useful because it can interpret evidence, articulate uncertainty, and stop a trade. Deterministic code retains the fields whose values produce immediate financial consequences.

## The forward test begins with no favorable observations

Historical data cannot become prospective merely because it is replayed again. Forward Trial 1 therefore begins with zero signal commitments and zero outcome settlements. It uses separate commitment and settlement phases, defines the benchmark books in advance, and keeps performance inference disabled until 252 settlements exist.

The original zero-row protocol remains locally hash-bound and can be verified from a clean clone, but those properties have a strict limit. A local timestamp and hash cannot independently prove that a signal existed before market execution. An external pre-execution anchor, provider reconciliation, corporate-action handling, and outcome-price reconciliation are still required. For that reason, settlement, broker authority, and performance inference remain disabled.

Finly's separate live trial was activated before its first eligible session. The tracked activation freezes the unchanged production formula, an all-BIL starting state, the official Alpaca calendar boundary for 31 August 2026, write-once commitments, no backfill, and no broker authority. Its hash is `sha256:a9ad429e2094d7cb59300bab18727306121554b62ac112a8e297ce9e12b2800d`. No signal or return is implied by activation; the first signal cannot legally be captured until the August 31 close plus the fixed fifteen-minute availability delay. See [`research/FORWARD_TRIAL_LIVE.md`](research/FORWARD_TRIAL_LIVE.md).

The `TEST_ONLY` path demonstrates the frozen schema and accounting mechanics. It does not prove prospectivity, provider origin, execution quality, profitability, or future returns. The full protocol and verification instructions are in [`research/FORWARD_TRIAL1.md`](research/FORWARD_TRIAL1.md).

## The options layer is implemented without rewriting an ETF replay as options profit

Finly deterministically compiles defined-risk SPY debit verticals and calculates their exact maximum loss and payoff bounds. The order lifecycle includes paper-only account checks, short-lived authorization, idempotency, durable risk reservations, partial-fill freezes, and entry/exit reconciliation. A credential-free synthetic receipt demonstrates how supportive evidence, adverse evidence, and a severe-evidence veto flow through the same boundary in [`public/data/economic_options_overlay_replay.json`](public/data/economic_options_overlay_replay.json).

An authenticated read-only check of the dedicated Alpaca paper account succeeded through the official Alpaca MCP server. No order or fill is presented as performance evidence, and broker mutation remains disabled by default. That distinction matters because Alpaca's freely available historical options coverage does not support a faithful 2013–2026 reconstruction of contemporaneous multi-leg execution.

## The repository can be checked without trusting the presentation

The v0.4.3 prospective-capture release pins exact Node.js 26.7.0 Darwin-arm64 and Linux-x64 verification profiles, including the visible global-fetch wrapper source; only the Darwin profile is authorized for capture. Public verification needs no paid service or broker credentials:

```bash
npm install
npm run verify
npm run dev
```

The complete release check runs the test suite, reconstructs the public receipts, verifies the quantitative evidence and claim registry, checks the competitor evidence map, validates the MCP configuration, and builds the site. More focused checks are also available:

```bash
npm test                                  # run the full behavior and evidence suite
npm run research:quant-extension-check   # verify the historical research ledger offline
npm run research:g4-window-explorer      # rebuild the range explorer when the private ledger is present
npm run research:forward-trial            # verify the zero-row two-phase forward protocol
npm run research:forward-trial-live       # verify the pre-session live activation
npm run economic:options-replay-check     # reconstruct the non-mutating options receipt
npm run llama:decision-check              # reconstruct the bounded local-model trace
npm run competitor:check                  # validate the public competitor evidence map
npm run build                             # type-check and build the judge-facing site
```

Authenticated scripts are intentionally separate. `npm run paper:health` performs a read-only readiness check when local Alpaca paper credentials are supplied. `npm run paper:agent` reaches the guarded paper lifecycle, but broker mutation still requires every explicit local control and is not part of the public credential-free verification path.

## The evidence supports a narrower conclusion than a profit claim

Finly demonstrates a content-addressed historical research record, a bounded role for model judgment, deterministic defined-risk option compilation, a default-deny authorization boundary, and a forward protocol that refuses to manufacture observations. A clean clone verifies the published outputs and hashes; rebuilding the recurring-contribution windows requires a local raw ledger that is deliberately not redistributed. The project does not demonstrate durable alpha, historical options fills, completed competition-account profit and loss, live-money readiness, or future outperformance.

The project is deliberately candid about that boundary because the refusal is itself the test. A system has not earned trust merely because its best chart is persuasive. It earns trust when the rights to interpret evidence, define exposure, construct an order, and authorize capital remain distinguishable—and when failed evidence actually results in `NO_TRADE`.

## Research basis

The candidate design is informed by the literature on [time-series momentum](https://doi.org/10.1016/j.jfineco.2011.11.003) and [volatility-managed portfolios](https://doi.org/10.1111/jofi.12513). The skepticism applied to repeated historical search follows [White's Reality Check](https://doi.org/10.1111/1468-0262.00152) and the [Deflated Sharpe Ratio](https://doi.org/10.3905/jpm.2014.40.5.094). Recent agentic-finance context includes [QFinZero](https://doi.org/10.18653/v1/2026.acl-demo.7) and [TrustTrade](https://arxiv.org/abs/2603.22567). These sources motivate Finly's design and evaluation protocol; they do not validate its implementation or future performance.

The broker boundary follows Alpaca's official documentation for [options trading](https://docs.alpaca.markets/us/docs/options-trading), [multi-leg orders](https://docs.alpaca.markets/reference/postorder), [paper trading](https://docs.alpaca.markets/us/docs/paper-trading), and [historical option data](https://docs.alpaca.markets/us/docs/historical-option-data).

## Repository map

```text
lib/         deterministic economic logic, evidence boundaries, compiler, and broker guards
research/    frozen protocols, attempt ledgers, statistical checks, and forward-trial machinery
scripts/     reproducible runners, receipt checkers, local-model tooling, and paper-account tools
evidence/    redacted, machine-checkable runtime and competitor records
fixtures/    synthetic controls, perturbations, and negative controls
src/         judge-facing website
tests/       release-blocking unit, metamorphic, lifecycle, statistical, and reporting tests
docs/        proposal sources, technical paper, setup notes, and requirements traceability
```

Finly is an educational paper-trading prototype, not investment advice. Options can lose their full premium, and historical results do not guarantee future performance.
