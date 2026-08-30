# Finly Forward Trial 1

Forward Trial 1 is frozen at **zero signal commitments and zero settlements**. It claims neither performance nor live capture. The purpose of the release is narrower: freeze the deterministic Finly v1 rule, fresh-start unchanged G4 formula, SPY, QQQ, 50/50 SPY–QQQ, BIL, and 10% SPY volatility-target comparators before their first eligible return.

## Why the ledger is two-phase

A return cannot be settled until its future close exists. A signal, however, must be committed before execution. Combining both events in one after-the-fact “daily” row necessarily backdates later signals. Finly therefore separates them:

1. `SIGNAL_COMMITMENT N` is formed after completed-close data become available and strictly before the queued execution close. It binds the full normalized panel, source-response hashes, formula versions, action, and any target weights. It carries no broker authority.
2. A later settlement for N may use only immutable commitments N, N+1, and N+2. Their final panel points supply the signal, return-start, and return-end closes. The accounting layer recomputes returns, targets, turnover, the common 5 bp cost, equity, and closing weights.

This structure can support later frozen-rule evaluation, but it does not yet establish live pre-execution capture. G4 starts from the common $100,000/100% BIL baseline, derives a formula allocation on the first eligible signal, and then follows its frozen 21-session cadence.

## Public-clone and market-data gates

The ignored private Alpaca seed is deliberately **not redistributed**. A clean public clone can verify the tracked protocol, genesis, dependency hashes, zero-row state, and synthetic `TEST_ONLY` mechanics without it; verification reports `production_seed_available: false`. On the original machine the same check may report `true` after matching the exact private artifact and normalized-panel hashes.

No production signal may be committed merely because that seed exists. The frozen `adjustment=all` history can change query vintage after a split, distribution, or spin-off, so an immutable prefix is not yet a sound prospective total-return series. Production commitment stays closed until a vintage-stable raw-price/corporate-action method is implemented and tested. Settlement also requires independently reconciled outcome-price lineage: a pre-execution anchor proves when a commitment existed, not where its prices came from.

## Anchor gate

Local time and local hashes are not independent evidence. Production commitment and settlement writers are therefore disabled in this zero-row freeze. Before they can open, the market-data gates above must pass and every signal commitment needs a free independently verifiable pre-execution anchor, such as a public GitHub publication, RFC 3161/OpenTimestamps receipt, or trusted append-service signature. No automation, account, secret, or unsupported verification claim is included now.

Even 252 settlements cannot produce a judge-facing inference unless the first 254 signal commitments have independently verified anchors dated before their respective execution closes. The frozen primary endpoint is the first 252 settlements’ mean net daily log-return difference between Finly v1 and SPY, tested one-sided with the null-centered stationary bootstrap specified in the locally frozen protocol. Sessions 1–60 are engineering/reconciliation only; sessions 61–251 remain observation-only. Other books are descriptive.

## Commands

Read-only verification is the default and performs no network, broker read, or broker mutation:

```bash
npm run research:forward-trial
```

A reserved signal-append route requires an explicit local-write acknowledgement, but the current production protocol rejects it because the market-data gates are closed:

```bash
FINLY_FORWARD_TRIAL1_WRITE_ACK=APPEND_SIGNAL_COMMITMENT_WRITE_ONCE \
  node research/run_forward_trial1.mjs --append-signal-commitment /absolute/path/to/signal-input.json
```

The runner has no broker authority and cannot submit orders or append production settlements. Production signal append is also disabled in this zero-row version. Synthetic tests exercise the intended two-phase schema without being eligible for performance claims. An unknown file, gap, hash mismatch, altered formula, skipped session, future timestamp, post-execution commitment, symlinked persistent directory, credential-like value, or stale lock fails closed.

## Evidence boundary

Alpaca does not sign these response bodies. Provider/feed labels and response hashes aid replay but do not independently prove origin. IEX closes are modeled observations, the custom calendar must be revised for unscheduled closures, the ETF universe is fixed to current survivors, and the 5 bp/fractional accounting assumptions remain modeled. The local clock is not prospectivity evidence. The only safe current claim is: **the repository contains a clean-clone-verifiable, hash-bound, zero-row, two-phase protocol whose production commitment, settlement, and inference gates are closed.**
