# Finly submission requirements and release checklist

This is the internal traceability checklist for the Alpaca AI Trading Agents Hackathon. It is not submission copy. The event and form were rechecked on 31 August 2026. The stated deadline is **Friday, 4 September 2026 at 11:00 a.m. EDT** (15:00 UTC). Reopen the live form immediately before submission in case the organizer changes a field.

Finly should be entered in the **Options Alpha Agents** track. It is one autonomous competition strategy with two coordinated execution sleeves: a frozen four-fund allocation and a versioned, capped-risk SPY options sleeve. Its clearest proposition is controlled delegation: an AI may assess public news, explain uncertainty, and veto; deterministic code owns direction, option structure, exact maximum loss, broker fields, and the final `PERMIT` or `NO_TRADE` decision. The sleeves keep distinct signals, risk accounts, lifecycles, and revision records for auditability; they are not separate submitted strategies.

## Event requirements

| Published requirement | Finly evidence | Boundary or remaining action |
| --- | --- | --- |
| Autonomous AI trading agent using Alpaca's Trading API | Finly implements a bounded evidence pipeline, hosted-model assessment, deterministic economic intent, defined-risk options compilation, risk reservation, lifecycle state, and machine-checkable receipts. | The public demonstration is non-mutating. Do not describe a synthetic receipt as a broker order. |
| Use Alpaca MCP or Alpaca CLI | The official `alpaca-mcp-server==2.2.1` powers the coordinated paper runner. The first session produced 15 ETF fill events and a read-only same-clock score, published in [`competition_forward_profit_2026_08_31.json`](../public/data/competition_forward_profit_2026_08_31.json). | No live options order or fill is claimed. |
| Incorporate options | The competition strategy includes a capped-risk SPY options sleeve. Live v2 lets fresh market momentum compile into a one-contract bull-call or bear-put debit vertical while option skew and model-read news may only confirm, reduce, or stop it. The implementation validates OCC symbols, payoff bounds, quote freshness, liquidity, aggregate risk, and Alpaca multi-leg payload shape. | The historical return studies measure the coordinated four-fund sleeve, not historical options P&L. Public verticals are compiler fixtures unless a broker receipt says otherwise. |
| New dedicated Alpaca paper account reset to $100,000 | The authenticated account is active, unblocked, approved for Level 3 options, and measured from an exact $100,000 baseline. Its identifier is kept outside the public package. | Paste the ID only into the private form. |
| One-page explanation of AI logic, risk gates, and Alpaca infrastructure | [`Finly_Judge_Brief.pdf`](../public/judge/Finly_Judge_Brief.pdf) is a one-page analytical essay, with an editable [`DOCX`](../public/judge/Finly_Judge_Proposal.docx). | The public guidance does not expose a dedicated file type or field; add the PDF wherever the live form permits and repeat its link in Additional Information. |
| Public, original, open-source work | Repository: <https://github.com/owlsowo/finly-bot>. The project is MIT-licensed. | Keep secrets, account identifiers, private audit material, and direct competitor matchups out of the public release. |

The event judges paper-account **P&L and trading activity**. At the first close, Finly's broker equity was **$100,095.32** while a same-$100,000 SPY raw-price benchmark was **$99,942.01** at exactly **4:00 p.m. ET**. That is a **$153.31 first-session advantage**, based on 15 ETF fill events and zero external cashflows. The allocation and that result remain frozen. The options sleeve is versioned separately in [`options-policy-revision-v3-2026-09-02.json`](../config/options-policy-revision-v3-2026-09-02.json); earlier abstentions and P&L remain attributed to the policy revision that produced them. The account still has no verified live options fill, so do not force or imply one.

## Quantitative claims and their evidence boundaries

Judge-facing performance language is governed by the historical release gate and the separate read-only competition measurement. The downstream site, essay, paper, deck, film, metadata, and social copy must preserve the distinction between retrospective research and broker-observed paper performance.

1. “At the first market close on 31 August 2026, Finly was up $95.32 while the same-$100,000 SPY raw-price benchmark was down $57.99 at exactly 4:00 p.m. ET, a $153.31 advantage after 15 ETF fill events and with zero external cashflows.” Source: [`competition_forward_profit_2026_08_31.json`](../public/data/competition_forward_profit_2026_08_31.json).
2. “In the consumed, post-selected 2013-01-02–2026-08-27 retrospective replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%.” Source and research boundaries: [`quantitative_release_gate.json`](../research/output/quantitative_release_gate.json).
3. “A fixed industry proxy replay across 21,218 earlier market days annualized 13.37% versus 9.48% for the market, remained positive at all 21 tested rebalance anchors, and retained a positive edge under a 25 bp cost stress.” Source: [`attempt150_public_evidence.json`](../public/data/attempt150_public_evidence.json).
4. “Across 517 sampled SPY signal windows, the live compiler admitted 11 on a symmetric modeled quote surface: 7 bullish call spreads and 4 bearish put spreads, all with at least 1.25-to-1 reward/risk and the unchanged conservative-value margin.” Source and strict boundary: [`options_policy_calibration.json`](../public/data/options_policy_calibration.json). This is eligibility calibration with fixed modeled quotes, not historical options prices, P&L, orders, fills, or profitability evidence.
5. Attempts 115 and 116 are separate pre-registered research protocols. Their earlier zero-outcome status is not the competition account's status and must not be used to describe the now-measured live account.

Finly must not claim future profitability, next-month SPY outperformance, verified live options P&L, or superiority over a named project. The first-close score is broker-observed paper performance; it is not the final competition result or a promise about later sessions.

## Required form and media package

| Form field or upload | Finly artifact or paste-ready source | Final check |
| --- | --- | --- |
| Project title, maximum 50 characters | `Finly: AI Trading That Shows Its Work` | 37 characters. |
| Short description, maximum 255 characters | [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md) | 144 characters. Recheck after pasting. |
| Long description, minimum 100 words and maximum 2,000 characters | [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md) | 304 words and 1,942 characters including paragraph breaks. |
| Main track | `Options Alpha Agents` | Select explicitly; do not rely on technology tags. |
| Technologies and categories | Alpaca, Alpaca MCP, Featherless AI, Qwen3-32B, React, Vite, TypeScript, Node.js, Python, GitHub Actions | Choose the closest categories exposed by the final form. |
| 16:9 cover image | [`finly-cover-16x9.png`](../public/brand/finly-cover-16x9.png) | Verify PNG/JPG acceptance and preview crop. |
| Slide presentation | [`Finly_Consulting_Deck.pdf`](../public/judge/Finly_Consulting_Deck.pdf), with editable [`PPTX`](../public/judge/Finly_Consulting_Deck.pptx) | Final nine-page PDF; overflow, template fidelity, links, and rendered pages passed QA. |
| Video presentation | [`Finly_Demo_Video.mp4`](../public/judge/Finly_Demo_Video.mp4) | Final 81-second, 1920×1080 H.264/AAC cut with ElevenLabs narration and synchronized captions; codec, duration, loudness, claims, and sampled frames passed QA. |
| Public repository | <https://github.com/owlsowo/finly-bot> | Open from a signed-out session after the final push. |
| Demo application platform and URL | Select `OTHER`; canonical GitHub Pages URL: <https://owlsowo.github.io/finly-bot/> | The live form accepts `OTHER`; keep one canonical URL. |
| Alpaca paper-account ID | Stored only in the ignored local environment | Enter directly into the private form; never paste it into Git, slides, video, or social posts. |
| Optional Additional Information | Links to the one-page essay, eight-page mathematical note, engineering appendix, source gate, and accessibility notes | Use if the live form exposes the field. |

The generic guide requests an IBM Bob report only where IBM Bob assisted. No evidence indicates that it was used for Finly, so that item is currently inapplicable.

## Judging criteria and honest position

No numerical weights or tie-break formula are published. The event-specific criteria are the governing frame.

| Criterion | Strongest verifiable evidence | Weakest point |
| --- | --- | --- |
| **P&L Performance** | First-close broker observation: +$95.32 for Finly versus -$57.99 for same-clock SPY, a +$153.31 advantage; 15 ETF fill events; zero external cashflows. Historical replays provide a separate longer-horizon rationale. | One session is a thin sample, and there is no live options P&L yet. |
| **Technology Implementation** | Controlled delegation, signed bullish/bearish options compilation, exact payoff checks, one-contract/$500 execution caps, mutation guards, risk reservations, bounded cancel/reprice exits, idempotency, reconciliation logic, 15 ETF fill events, read-only same-clock scoring, and 826 automated tests. | The live options sleeve has not yet produced an order/fill/read-back artifact. |
| **Creativity & Originality** | Finly makes the distinction between model judgment and capital-bearing authority executable, then demonstrates the complete boundary with a broker-observed allocation, a checked options approval, and a checked refusal. | Risk gates alone are familiar; the presentation must make the authority boundary concrete. |
| **Presentation & Execution** | One coherent story across a live interactive case, one-page essay, academic paper, consulting deck, captioned film, machine-readable gate, and source repository. | Every surface must be rebuilt and visually checked after the last claim change. |

## Social-engagement prize

The separate social prize accepts up to five X or LinkedIn post links created during the hackathon. The five drafts in [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md) use the required X handles `@lablabai` and `@AlpacaHQ`. Content quality and engagement may both matter; no minimum post count or scoring formula is published. Publishing the drafts and entering their resulting URLs remain manual actions for the builder.

## Final release sequence

1. Run `npm run verify` and reproduce it from a clean clone using the pinned runtime; current suite: 826 total, 824 passed, 0 failed, 2 skipped.
2. Confirm the one-page brief, eight-page mathematical note, fifteen-page engineering appendix, nine-page deck, and final video open correctly; inspect their renders rather than relying only on text extraction.
3. Sweep every public surface for stale claims, hidden internal audits, direct competitor matchup language, secrets, account identifiers, broken links, and incorrect organizer handles.
4. Push the ordinary release commit, wait for CI and Pages, and open every final URL from a signed-out browser.
5. Confirm the dedicated paper account and copy its ID only into the private form.
6. Reopen the event rules and form, select the track, attach every required file/link, and submit before the stated deadline.

Publishing the repository or website does not submit the project. The form submission, account ID, uploads, optional social links, and final approval remain the builder's actions.
