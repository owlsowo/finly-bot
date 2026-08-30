# Finly demo film: narration and scene logic

The final film is a nine-part argument for judges. It uses a founder-led product-ad rhythm—a quick hook, visible product evidence, one memorable joke, and a return to the central claim—without using copyrighted footage, music, or visual assets.

1. **Hook.** Most trading demos begin with a chart going up and to the right. Finly asks what survives before that chart gets anywhere near a broker.

2. **Execution realism.** We replaced the frozen SPY/BIL policy's same-close assumption with next-session-open fills. Across 415 consumed sessions, after five basis points per traded-notional leg, it returned 15.39 percent with a 5.45 percent maximum drawdown. At 25 basis points, it still returned 10.56 percent. SPY returned 33.52 percent. Finly did not beat it.

3. **Small-account feasibility.** At one basis point per traded leg, a $300 shadow ended at $351.88. The preview enforced a $1 order minimum, skipped twelve sub-dollar adjustments, used nine-decimal fractional sizing, and charged a $0.70 sell-fee proxy. That tests affordability and mechanics. It is not a broker fill.

4. **Who controls capital.** The policy is deliberately boring. Three lagged SPY-minus-BIL trend horizons set exposure, a ten-percent volatility target scales it, and BIL receives the rest. AI may interpret evidence and veto. Deterministic code owns exposure, order fields, maximum loss, and permission.

5. **Challenge, then compile.** The supportive synthetic fixture survived four of four source removals and thirty-two of thirty-two perturbations. In the conflicting fixture, removing one source changed the decision, so Finly returned `NO_TRADE`. A surviving fixture can compile a defined-risk SPY spread—here with $366 maximum loss and $634 maximum gain—without transmitting it.

6. **The tempting result Finly rejected.** Even the strongest backtest did not receive authority. G4 turned a modeled $100,000 into $1,067,106 versus $680,817 for SPY. But it was selected after history was viewed and failed multiple-testing, growth-control, and source-overlap gates. Finly kept the chart, labeled it consumed, and rejected the strategy.

7. **Attempt 114.** Attempt 114 answers that hindsight problem. Before the first eligible signal, a public GitHub workflow verified 17 bound runtime files through 23 fixed public GET checks. The protocol requires 254 consecutive timely commitment anchors and 252 reconciled settlements, with no skipped sessions, backfill, replacement windows, optional stopping, or second confirmatory try.

8. **The boundary.** That record is not an independent cryptographic timestamp, provider-origin proof, broker fill, or profitability result. Today there is no prospective performance inference and no broker mutation authority. Alpaca access remains read-only.

9. **Close.** Finly is not a bigger forecast. It is a smaller, testable trust boundary: let AI interpret more, authorize less, and make correction, rejection, and `NO_TRADE` visible. The bull has horns. The llama still does not get the keys.

All numerical and boundary language in the film is locked to `public/data/submission_claims_lock.json`. The narration does not claim future profitability, historical options P&L, a broker fill, independent preregistration, statistical significance, or historical raw-return dominance over SPY.

The builder accepts one narration file per scene through `--audio-dir`, so an ElevenLabs export can be substituted without changing any visual or claim. If no audio directory is provided, the reproducible command uses the pinned free neural fallback voice declared in `scripts/build_demo_video.py`.
