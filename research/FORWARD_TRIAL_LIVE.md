# Finly Forward Live Trial 1A

Finly Forward Live Trial 1A is a prospective, research-only evaluation of the unchanged production policy `tsmom_ensemble_vol`. It is separate from the older zero-row protocol and from the post-selected G4 historical shadow.

## Activated before the first eligible session

The write-once activation in [`forward_trial_live/activation.json`](forward_trial_live/activation.json) was created at `2026-08-30T02:02:35.624Z`, before the official 31 August 2026 market session. It binds:

- the named `buildCurrentEconomicDecision` policy and protocol hash;
- a fresh-start portfolio held entirely in BIL;
- the official Alpaca calendar response for the first and next sessions;
- a close-plus-fifteen-minute data-availability boundary;
- consecutive, same-vintage, content-addressed signal commitments;
- settlement and performance-inference gates that remain closed; and
- `broker_mutation_authorized: false` with no order payload.

The activation is not a signal, trade, return, or profitability result. Its purpose is to prevent a favorable first observation from being selected retrospectively. The supplemental [`forward_trial_live/runtime_manifest.json`](forward_trial_live/runtime_manifest.json) binds the activation hash to the complete capture-time source closure: canonical hashing, the production policy, the Alpaca response normalizer, the commitment core, and the live runner. Before capture and during clean-clone verification, the runner rehashes all five files, checks the pinned Node/V8/ICU/time-zone/OpenSSL versions and visible global-fetch wrapper source, and rejects visible preload, loader, proxy, or alternate-CA configuration. The manifest must be published on GitHub before the activated first session closes; every private commitment and price-free public anchor carries its self-hash.

The manifest freezes two exact Node.js 26.7.0 profiles because the Darwin-arm64 Homebrew and Linux-x64 official builds carry different time-zone and OpenSSL data. Both profiles may verify; only the Darwin profile may capture a signal. That runtime check is an accidental-drift control, not a hostile-host attestation. Code executed before the runner could conceal its own launch flags or monkey-patch the checks; Finly therefore records `hostile_preexecution_environment_excluded: false`. GitHub proves which source bytes were public, not that a local operating system executed them faithfully.

## Read-only transport evidence

The dedicated client permits only allowlisted HTTPS GET requests for the frozen twenty-symbol universe, the official trading calendar, and bounded corporate-action announcements. Every response must contain a canonical HTTP `Date` header within five minutes of the local receipt. For signal bars, every request must begin after the close-plus-fifteen-minute boundary and every origin `Date` must be on or after that boundary. The private commitment durably stores the credential-free request metadata, every per-page timing receipt, all normalized raw and adjusted bars, and recomputable response hashes. It also records that Alpaca does not provide a cryptographic response signature.

This improves the evidence for when an acquisition occurred, but it does not turn an unsigned provider header into an independent timestamp authority. The original activation stores hashes rather than the complete first calendar response; that historical omission cannot be repaired retrospectively and remains a provenance limitation. Each later capture does persist and cross-check the complete normalized calendar response and its credential-free HTTPS receipt, but neither is independently provider-signed. The public commitment anchor must still be published before its declared next-session close.

## Timing of the first permitted signal

The first acquisition is allowed only from `2026-08-31T20:15:00.000Z` until strictly before `2026-09-01T20:00:00.000Z`. It must end on the completed 31 August session, contain exactly 253 aligned all-adjusted closes and the same final two raw closes for all twenty symbols, and derive the target weights through the frozen production function.

The private price-bearing bundle remains under the ignored `data/private/` boundary. Only its price-free, hash-bound manifest may be committed publicly. The writer locks before discovering the disk head or requesting data, rejects stale or forked sequences with a compare-and-swap check, stages and fsyncs canonical bytes before an atomic content-addressed hard link, and reopens both complete chains after writing. Clean-clone verification checks the public schema, timing, formula/source binding, authority, filenames, and exposed private-hash linkage even when prices are absent. Neither path can submit, cancel, or replace an Alpaca order.

## Commands

Clean-clone verification is credential-free and performs no network call. Its output deliberately keeps `external_anchor_verified`, `prospectivity_verified`, and `performance_inference_permitted` false until separate public-timestamp evidence exists:

```bash
npm run research:forward-trial-live
```

The activation command is idempotent once the tracked activation exists. On a fresh authorized machine it performs one authenticated, read-only calendar request and writes the activation once:

```bash
npm run research:forward-trial-live:activate
```

The signal writer requires a deliberate local acknowledgement. It is invalid before the selected close-plus-fifteen-minute boundary and at or after the next official close:

```bash
FINLY_FORWARD_LIVE_WRITE_ACK=APPEND_SIGNAL_COMMITMENT_WRITE_ONCE \
  npm run research:forward-trial-live:append
```

The command reads only the official calendar and daily bars. It writes one private commitment and one price-free public anchor; it has no broker mutation route. Local creation alone does not prove prospectivity. The public anchor still must be committed and pushed before the printed deadline, and the resulting GitHub publication evidence must be checked separately while `external_anchor_verified` remains false unless an independent cryptographic timestamp is added later.

After the anchor-only commit's `Verify Finly` workflow succeeds, verify the public GitHub record with the run ID, content-addressed anchor path, and the frozen parent release SHA:

```bash
npm run research:forward-trial-live:verify-github -- \
  --run-id <github-actions-run-id> \
  --anchor-path <research/forward_trial_live/anchors/00000001_hash.json> \
  --expected-parent-sha <frozen-v0.4.3-release-sha>
```

For sequences 2 through 254, the expected parent must be the immediately prior anchor-publication commit and the immediately prior local receipt is mandatory:

```bash
npm run research:forward-trial-live:verify-github -- \
  --run-id <github-actions-run-id> \
  --anchor-path <research/forward_trial_live/anchors/00000002_hash.json> \
  --expected-parent-sha <sequence-1-anchor-commit-sha> \
  --previous-receipt-path <research/forward_trial_live/github_receipts/00000001_receipt-hash.json>
```

Sequence 1 performs fifteen fixed, unauthenticated GET requests; each successor performs sixteen, adding the prior public anchor at the exact parent commit. Every anchor commit must directly extend the preceding anchor commit and add only its one new anchor, so local receipts and unrelated changes must not be inserted into that Git chain. The verifier validates the complete canonical anchor prefix plus the prior receipt, workflow run, anchor bytes, private-hash link, and direct Git parent. Its bytes must be published before sequence 1 and remain byte-frozen after sequence 1 through sequence 254.

Each content-addressed, write-once receipt contains the exact request URLs, GitHub HTTP dates, response-byte hashes, and byte lengths. It is explicitly a reproducible public-API pointer—not self-contained offline evidence—and leaves `external_anchor_verified: false`: GitHub's platform record is useful publication evidence, not an independent cryptographic timestamp or broker-origin signature.
