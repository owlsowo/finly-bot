# Finly Forward Live Trial 1A

Finly Forward Live Trial 1A is a prospective, research-only evaluation of the unchanged production policy `tsmom_ensemble_vol`. It is separate from the older zero-row protocol and from the post-selected G4 historical shadow.

## Activated before the first eligible session

The write-once activation in [`forward_trial_live/activation.json`](forward_trial_live/activation.json) was created at `2026-08-30T02:02:35.624Z`, before the official 31 August 2026 market session. It binds:

- the unchanged `buildCurrentEconomicDecision` implementation and protocol hash;
- a fresh-start portfolio held entirely in BIL;
- the official Alpaca calendar response for the first and next sessions;
- a close-plus-fifteen-minute data-availability boundary;
- consecutive, same-vintage, content-addressed signal commitments;
- settlement and performance-inference gates that remain closed; and
- `broker_mutation_authorized: false` with no order payload.

The activation is not a signal, trade, return, or profitability result. Its purpose is to prevent a favorable first observation from being selected retrospectively.

## Read-only transport evidence

The dedicated client permits only allowlisted HTTPS GET requests for the frozen twenty-symbol universe, the official trading calendar, and bounded corporate-action announcements. Every response must contain a canonical HTTP `Date` header within five minutes of the local receipt. Credential-free provenance records the local request and response instants, the origin date, every page, normalized response hashes, and the fact that Alpaca does not provide a cryptographic response signature.

This improves the evidence for when an acquisition occurred, but it does not turn a provider header into an independent timestamp authority. The public commitment anchor must still be published before its declared next-session close.

## Timing of the first permitted signal

The first acquisition is allowed only from `2026-08-31T20:15:00.000Z` until strictly before `2026-09-01T20:00:00.000Z`. It must end on the completed 31 August session, contain exactly 253 aligned all-adjusted closes and the same final two raw closes for all twenty symbols, and derive the target weights through the frozen production function.

The private price-bearing bundle will remain under the ignored `data/private/` boundary. Only its price-free, hash-bound manifest may be committed publicly. Neither path can submit, cancel, or replace an Alpaca order.

## Commands

Clean-clone verification is credential-free and performs no network call:

```bash
npm run research:forward-trial-live
```

The activation command is idempotent once the tracked activation exists. On a fresh authorized machine it performs one authenticated, read-only calendar request and writes the activation once:

```bash
npm run research:forward-trial-live:activate
```

The first signal-capture command is intentionally not exposed until its acquisition adapter, private persistence, public-manifest publication, and deadline checks are all release-tested. No broker mutation route will be added to this runner.
