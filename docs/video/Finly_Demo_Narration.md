# Finly demo film: 75-second launch cut

The film opens on the result, shows the product before the midpoint, and closes with one invitation. It uses the final Finly deck and four project-owned film captures. The nine-scene storyboard targets 74 seconds; the final cut must land between 65 and 80 seconds.

1. **The number — 8 seconds.** In our 2013–2026 historical simulation, $10,000 became $106,711 with Finly—$38,629 more than SPY after modeled trading costs.

2. **What we built — 7 seconds.** We built Finly to turn market evidence into a paper trade while code keeps control of the account.

3. **A second test — 10 seconds.** This separate, 80-year industry test returned 13.37% a year versus 9.48% for the market and stayed ahead across all 21 trading-day schedule offsets.

4. **How it works — 12 seconds.** Here’s how it works. Finly reads market signals and explains one view. Code chooses the position size, option legs, maximum loss, and exact Alpaca order. A final check either sends the paper trade or stops it.

5. **The product — 5 seconds.** Watch it run. When the evidence agrees, Finly builds a paper order with a fixed maximum loss.

6. **Change the evidence — 5 seconds.** Change the evidence, and Finly stops. The same screen shows exactly why.

7. **The risk check — 11 seconds.** This example built one SPY trade with a $366 maximum loss and $634 maximum gain. It reached the same decision after we removed each of four sources one at a time and changed the inputs 32 different ways.

8. **The live account — 9 seconds.** At the first close, Finly gained $95.32 while SPY lost $57.99 from the same $100,000 starting point—a $153.31 advantage.

9. **The close — 7 seconds.** Every decision has a saved record. Follow the paper test, check the numbers, and read the code.

The performance figures are labeled as historical simulations in the visuals. The 2013–2026 result is checked against `research/output/quantitative_release_gate.json`; the separate 1927–2007 industry replay is checked against `public/data/attempt150_public_evidence.json`; the options example is checked against `public/data/latest_receipt.json`; and the paper-account statement is checked against `public/data/competition_live.json`.

Final narration is supplied as one licensed human or ElevenLabs file per scene through `--audio-dir`. The builder will not write a system-voice render to the public or distribution folders. `--draft-preview` may create a clearly named local pacing draft, and `--check` validates the claims, sources, filenames, and target runtime without rendering.
