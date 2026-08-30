# Attempt 114 prospective profitability protocol

This directory contains the immutable, pre-signal evaluation freeze for research attempt 114. It registers one confirmatory evaluation of the already-frozen `tsmom_ensemble_vol` incumbent; it does not introduce or select a policy.

The freeze timestamp is `2026-08-30T04:02:23.484Z`, strictly before the activated first signal close at `2026-08-31T20:00:00.000Z`. The protocol self-hash is:

```text
sha256:a1eb1b3304920f72606d2bb710adb9e5580a213cda1df51a776aa55940f7f311
```

The canonical `protocol.json` raw-byte hash in this release is:

```text
sha256:794bb93d578b4b4766daac1c27d7fa0a68f730fbeda853b208aa98ad501572ff
```

`protocol_sha256` hashes the stable canonical representation of every protocol field before that field. The validator also hard-codes that digest, checks canonical JSON bytes, rejects unknown or changed fields, refuses symlink traversal, verifies all frozen upstream raw bytes, and re-validates the source activation/runtime semantics.

The recorded pre-signal head is explicitly `local_snapshot_only`. Prepublication correctness fixes were incorporated into this canonical draft while retaining its original local freeze timestamp; that local timestamp is not independent evidence of prospectivity. Only the hashes shown above identify the final draft described here, and the required independent publication has not yet occurred.

## Frozen evaluation

The sample is the first 252 consecutive post-activation return intervals, with no skipped sessions, replacement window, backfill, optional stopping, or repeat confirmatory test. It requires exactly 254 consecutive signal commitments:

```text
commitment N at completed close S_N
  -> modeled execution at close S_N+1
  -> earned close-to-close return S_N+1 through S_N+2
  -> settlement N after commitment/outcome close S_N+2
```

Consequently, final evaluation must wait for the N+2 close. Settlement 252 cannot exist until commitment/close 254 exists. Any later observations are outside the primary endpoint.

Protocol/runtime publication is only the first prospectivity gate. Every commitment 1 through 254 must have a one-to-one, independently verified publication receipt strictly before its own execution close S_N+1. A local timestamp, hash chain, or local public-anchor file is insufficient. Accepted mechanisms are a verifiable public GitHub Actions/commit publication, an RFC 3161 or OpenTimestamps receipt, or a trusted append-service signature. Each receipt must bind the commitment sequence/session, private-bundle chain, formula/runtime and decision hashes, action, target weights, capture time, and execution-close deadline. Each of the 252 settlements also requires independently reconciled outcome-price lineage; Alpaca source labels and unsigned responses alone do not prove provider origin. Missing or late evidence fails closed regardless of performance.

All books start at USD 100,000 in BIL and use fractional units. Every absolute SPY and BIL traded-notional leg costs 5 basis points one way. HOLD means the drifted closing weights continue with zero turnover. The SPY comparator's initial BIL-to-SPY switch therefore has L1 turnover 2 and modeled cost return 0.001. There is no terminal liquidation.

The sole primary endpoint is the mean of

```text
log1p(incumbent_net_simple_return) - log1p(spy_net_simple_return)
```

over the frozen 252 intervals. The one-sided null-centered stationary bootstrap is frozen at seed 20260829, 4,999 resamples, expected block length 20, restart probability 0.05, and alpha 0.05. It runs once, only after complete finalization.

The volatility-matched SPY/BIL path is descriptive and cannot replace the primary SPY comparator. Its exact IDs are `incumbent_tsmom_ensemble_vol`, `spy_buy_hold`, `bil_cash`, and `volatility_matched_spy_incumbent_tsmom_ensemble_vol`; all inputs are the books' already-costed `net_return` values. It uses a causal 63-session volatility lookback, 21-session rebalancing, SPY weight bounds 0 to 1.5, BIL residual weight, 5-basis-point one-way trading costs, and a 0.5% annual borrowing spread. The first 63 intervals are warmup and the final 189 are scored. A future hash-bound descriptive wrapper must override the reused builder's historical `primary_risk_matched_gate` role label, which has no primary authority in attempt 114. The full-window bridge is the exact telescoping sum of net log-return differences—warmup Finly-minus-SPY plus scored Finly-minus-volatility-match plus scored volatility-match-minus-SPY—and must reconcile within `1e-12`.

## Separate future ledgers

Settlement persistence is intentionally absent from this release. A future, separately frozen implementation must produce two independently chained ledgers:

- The adjusted theoretical ledger uses same-vintage `adjustment=all` returns and is the only source for primary inference.
- The Alpaca paper cash-equity ledger values only cash plus SPY/BIL quantities at broker-raw tradable prices. It is modeled preview evidence, not proof of broker execution. Adjusted returns may not enter cash equity or order sizing; its independently bound builder is `lib/equity_shadow_execution.mjs`.

Any future combined interval bundle must bind both independent ledger heads. Neither ledger may claim fills or authorize broker mutation. This protocol contains no broker client, order payload, place/cancel/replace authority, account identifier, or credential.

## Checkpoint and state

After 60 settlements and therefore 62 commitments, the only permitted checkpoint is structural engineering verification: counts, hashes, chain continuity, deterministic replay, ledger separation, credential scanning, and absence of broker mutation surfaces. Equity, returns, profit/loss, comparator differences, decomposition, p-values, and profitability language are forbidden. A fatal issue terminates attempt 114 and requires a newly registered attempt 115; it cannot change this protocol.

The initial state is `PRE_SIGNAL_FROZEN_LOCAL`. It can become prospective only through separately verified publication of this protocol and the required runtime manifest strictly before the exclusive first-close deadline. Transition beyond the session-60 checkpoint requires exactly 60 settlements, 62 independently verified timely anchors, and a clean performance-free engineering receipt. Finalization requires exactly 254 timely independently verified anchors, exactly 252 consecutive N/N+1/N+2 settlements, and reconciled outcome-price lineage. Missed publication, broken commitment timing, changed bytes or formulas, ledger contamination, performance-bearing interim output, or any other frozen integrity failure transitions fail-closed. No terminal state changes the incumbent policy.

## Relationship to the live trial

Binding attempt 114 to the current activation and runtime manifest before the first signal does not modify the meaning of those already-frozen artifacts. In particular, their settlement and inference gates remain closed. Attempt 114 is a new, separately registered evaluation layer over the future commitments they produce; it is not a retrofit of settlement authority into `finly_forward_trial_live_1a`.

Prospective status also does not follow merely from the local timestamp. The next required step is to create and publicly verify `research/prospective_attempt114/runtime_manifest.json` strictly before the exclusive `2026-08-31T20:00:00.000Z` deadline. That manifest must bind the canonical protocol raw bytes and self-hash, `protocol.mjs`, the shadow-equity source, the future descriptive decomposition wrapper, and every future settlement/inference source before any of them runs. Until then the inference gate remains closed. If that publication is not independently established before the deadline, the state is `TERMINAL_NOT_PROSPECTIVE`; even successful pre-signal publication does not open final inference until all 254 timely anchor receipts and all 252 outcome-price lineages verify.

## Verification

Run the isolated protocol tests:

```sh
node --test tests/prospective_attempt114_protocol.test.mjs
```

Or verify the frozen upstream bytes directly:

```sh
node --input-type=module -e 'import { verifyProspectiveAttempt114UpstreamBytes } from "./research/prospective_attempt114/protocol.mjs"; console.log(await verifyProspectiveAttempt114UpstreamBytes())'
```

The verifier is read-only. It does not create the future runtime manifest, write settlement state, contact Alpaca, or mutate a broker account.
