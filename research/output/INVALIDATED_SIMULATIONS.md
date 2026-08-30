# Invalidated simulation outputs

The following outputs are retained only as an append-only audit trail and must not support a performance, selection, or validation claim:

- `quant_champion_search.json` and `quant_champion_search_report.md`
- `quant_champion_generation2.json` and `quant_champion_generation2_report.md`

An independent post-output review found two defects in the shared simulator:

1. Mixed portfolios retained their target weights for free between scheduled reviews instead of drifting with asset returns. Turnover was therefore understated for partial and multi-asset strategies.
2. The loop realized the `t+1 -> t+2` return before invoking the `t+1` signal, which made that future row visible to stateful strategies through the observation API.

The Generation 1 and Generation 2 policies did not become public claims, and Generation 2's current stateless rules did not consume the unsafe observation API. Nevertheless, all affected economic outputs are invalidated rather than selectively defended. The corrected simulator queues close-`t` decisions for close `t+1`, first earns the `t+1 -> t+2` return, exposes only rows completed by the signal close, lets holdings drift between reviews, and computes turnover against drifted pretrade holdings.

See `champion_search_corrected_protocol.json` and its freeze receipt for the first eligible corrected run.
