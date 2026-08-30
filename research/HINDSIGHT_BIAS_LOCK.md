# Finly historical-research cutoff

Cutoff: **2026-08-29T11:54:51Z**
Disposition: **HISTORICAL TUNING CLOSED**

This file closes Finly's historical search. No strategy rule, universe, lookback, rebalance cadence, selection threshold, cost assumption, or benchmark may be changed in response to any market observation dated on or before 27 August 2026. The remaining submission work may improve engineering, explanation, interface design, and demonstrations, but it may not use the consumed history to improve a reported performance number.

## What the history currently supports

- Generation 4 found one retrospective raw-return candidate, `qqq_core_sector_12_6`, after 100 disclosed trials. It kept a positive annualized log-growth edge over SPY in development and validation under 5, 10, and 25 basis-point one-way cost assumptions and across all 21 monthly schedule offsets.
- That candidate **failed** the frozen post-selection research standard: validation deflated-Sharpe probability was 3.75%, the worst familywise block-bootstrap p-value was 0.3718, and the result was not consistently better than static growth controls. It is therefore a descriptive shadow candidate, not proven alpha and not a promoted live strategy.
- Generation 5 froze five additional trials before execution. None qualified against SPY or the growth controls, so the outcome remained `KEEP_V1`.
- Authenticated Alpaca source reconciliation passed all 20 per-symbol gates and three discrete candidate decision traces. The continuous inverse-volatility candidate failed only the preregistered exact canonical-weight gate, so the overall source result remains `FAIL_CLOSED`.

## Remaining hindsight risks

The historical record cannot be made pristine after the fact. The ETF universe survives to 2026; QQQ and technology were obvious ex-post winners; development and validation intervals have now both been inspected; strategy themes were informed by prior failures; and multiple generations were tried. Hashes and frozen gates prove reproducibility and prevent silent rewriting, but they do not convert consumed history into fresh out-of-sample evidence.

## Permitted claims

Finly may say that its fixed candidate beat SPY retrospectively in the disclosed slices and remained positive under the disclosed cost and schedule perturbations. It may say that the research process rejected promotion when multiplicity, growth-control, and source gates did not all pass. It may not claim persistent alpha, future profitability, superiority to every competitor's financial model, or independent options profitability.

## Next admissible financial evidence

Only prospectively timestamped paper observations collected after this cutoff are eligible as new performance evidence. The frozen strategy must run without parameter changes; all signals, abstentions, orders, fills, fees, and account-equity changes must be recorded. Any later revision becomes a separately named candidate and starts a new prospective clock. Historical replay may be rerun only as a deterministic regression test against the hash-pinned expected outputs, never as a search loop.

## Hash-pinned evidence

| Artifact | SHA-256 |
|---|---|
| `research/champion_search_generation4_protocol.json` | `918b6992a8a4531cf24c4dd6b540c4fda1d19f8ed7a16717d09effa3f8f075e5` |
| `research/champion_search_generation4_freeze_receipt.json` | `c1b662533c31dc326ddb9ed4633b36081fbd0386652cf753cd6a2fc62c843a46` |
| `research/output/quant_champion_generation4.json` | `af935615b289b009af83fe67dd78a890ce4de3c2416bbf039b0da2f24de78788` |
| `research/champion_generation4_robustness_protocol.json` | `5e6138c71be81bba74f9ff7ed1ff80c3a71e975b721389c4d6dc66ee9d8f5881` |
| `research/champion_generation4_robustness_freeze_receipt.json` | `bde1398b92ed71770766ebf98d3c41b51f302773d160bf44fda4a09238e4a31f` |
| `research/output/quant_champion_generation4_robustness.json` | `6b8136da0c4d6b366763383a93d2e119cec2f5516761b6cb2d2c206eeefd3299` |
| `research/champion_search_generation5_protocol.json` | `d2187039d1471dd4e27681d350355f917aec556f019c09f8155bb48c0509f10e` |
| `research/champion_search_generation5_freeze_receipt.json` | `77eafc80d2d5eabec46e22d9193b9f4a8ab51eee199fdca10b1ef176b35351f0` |
| `research/output/quant_champion_generation5.json` | `7e750ce659f4589b0df073195965ae3152f80175c5b9b9eae8b3ab9df839f6a5` |
| `research/source_overlap_reconciliation_generation5_protocol.json` | `88f000732851a59f56a218c791731bb913e8ec51cd461b7a9347da6ae1697be6` |
| `research/source_overlap_reconciliation_generation5_freeze_receipt.json` | `3238a3bbb13f3c08073a81cb8bb1d2424ee42f8751d7e52f76ffdc07d98a3828` |
| `research/output/source_overlap_reconciliation_generation5.json` | `b5a9aa1f1212429732aa83a350d7003d6c5ed0b7f8f76bccba3c2d69ef07b6d6` |
