# Finly demo film: public-first launch cut

The film starts with the problem in ordinary language, demonstrates the product before presenting performance, and ends by opening the technical evidence to judges. It uses the final Finly deck and project-owned product captures. The nine-scene storyboard targets 83 seconds; the final cut must land between 75 and 90 seconds.

1. **The hook — 7 seconds.** AI can sound certain and still be wrong. Finly does not give it the account keys.

2. **The product — 12 seconds.** Finly is a trading bot that uses real market prices and virtual money. AI studies the market and explains a trade. Fixed code caps the loss and decides what reaches Alpaca.

3. **Approve — 8 seconds.** When signals agree, Finly builds a paper-order plan. AI explains it; only rules can approve it.

4. **Refuse — 7 seconds.** When signals conflict, Finly does nothing. It shows why and stops before the account.

5. **The options calibration — 10 seconds.** We tested the live options gate across 517 sampled market windows. A representative eligible spread had $426 maximum loss, below Finly’s $500 limit. This is a reachability check, not options profit.

6. **The first live-market test — 11 seconds.** Finly’s allocation sleeve traded during live market hours, while its options sleeve was flat at the close rather than forcing a trade. Finly gained $95.32 while SPY lost $57.99—a $153.31 advantage from the same $100,000 start.

7. **The longer test — 10 seconds.** We also replayed the allocation rule from 2013 to 2026. $10,000 became $106,711 with Finly—$38,629 more than SPY after modeled trading costs.

8. **The older-market test — 10 seconds.** A simpler version of the portfolio was tested on a separate 80-year market record. It returned 13.37% a year versus 9.48% for the market and stayed ahead across all 21 tested monthly rebalance schedules.

9. **The technical handoff — 8 seconds.** Judges can inspect the 15 Alpaca ETF fill events, replay bullish and bearish options decisions, and rerun 826 automated checks in the public repository.

The performance figures are labeled as historical simulations in the visuals. The 2013–2026 result is checked against `research/output/quantitative_release_gate.json`; the separate 1927–2007 industry replay is checked against `public/data/attempt150_public_evidence.json`; the options example is checked against `public/data/latest_receipt.json`; and the locked first-close comparison is checked against `public/data/competition_forward_profit_2026_08_31.json`.

Final narration is supplied as one licensed human or ElevenLabs file per scene through `--audio-dir`. Name the files `01-hook`, `02-product`, `03-approve`, `04-refuse`, `05-options-calibration`, `06-live-result`, `07-historical-result`, `08-older-market-test`, and `09-technical-handoff`, using one supported audio extension per file. The builder has no system-voice path. The new public-first cut deliberately uses new scene filenames so the previous narration cannot be paired with the revised script by mistake. `--check` validates the claims, sources, filenames, and target runtime without rendering.
