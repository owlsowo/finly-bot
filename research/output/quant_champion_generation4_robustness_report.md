# Finly Generation 4 post-selection robustness

## Answer first

**KEEP_V1_POST_SELECTION_ROBUSTNESS_FAILED**. Fixed candidate: `qqq_core_sector_12_6`. Local robustness: **FAIL**. Authenticated source overlap: **INVALID_OR_FAILED**. Promotion is fail-closed until every frozen gate passes.

## Cost stress versus SPY

| One-way cost | Development log-growth edge | Validation log-growth edge | Recent edge (consumed) | Pre-recent sign gate |
|---:|---:|---:|---:|---|
| 5 | 1.61% | 4.39% | 5.29% | PASS |
| 10 | 1.43% | 4.22% | 5.08% | PASS |
| 25 | 0.88% | 3.72% | 4.48% | PASS |

## Schedule sensitivity

All 21 native monthly offsets were run. Development minimum: 1.17% at offset 16; validation minimum: 2.28% at offset 17. All-offset sign gate: **PASS**.

## Multiplicity and dependence

| Consumed slice | DSR probability | Worst familywise adjusted p-value across circular/moving 5/20/60 blocks |
|---|---:|---:|
| Validation only | 3.75% | 0.3718 |

The DSR declares all 100 disclosed trials, while its observable trial-distribution moments use the seven eligible Generation 4 candidates on the exact ledger. The static 50/50 growth control is excluded from that candidate family and reported separately. The block tests share one resampled path across the family and use deterministic seeds. Validation was already consumed by selection; these tests do not create a fresh holdout.

## Growth-control boundary

The candidate did not meet the frozen consistency definition against the static growth control. Mechanical distinction is disclosed, but alpha independent of SPY/QQQ growth exposure is rejected.

## Required caveats

- Development, validation, and 2025–2026 recent data were all seen before this post-selection audit. Recent is a consumed veto diagnostic, not fresh evidence.
- The ETF universe survives to 2026 and QQQ is an obvious ex-post winner; this is retrospective shadow research, not proof of future profitability.
- Source overlap is checked only from a separate authenticated artifact. This runner makes no market request and refuses promotion when that artifact is absent, malformed, incomplete, or tied to another panel hash.
- Failing the static-control consistency definition rejects alpha independent of growth tilt even if the candidate is mechanically different and beats SPY.
- A pass may justify only the frozen label `RAW_RETURN_SHADOW_ONLY`; it cannot justify `BALANCED_SHADOW_ONLY`, live capital, or a profitability guarantee.
