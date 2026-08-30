# Finly submission requirements and release checklist

This is the internal traceability checklist for the Alpaca AI Trading Agents Hackathon. It is not submission copy. The event and live gallery were rechecked on 30 August 2026. The stated deadline is **Friday, 4 September 2026 at 11:00 a.m. EDT** (15:00 UTC). Reopen the live form immediately before submission in case the organizer changes a field.

Finly should be entered in the **Options Alpha Agents** track. Its clearest proposition is controlled delegation: an AI may assess bounded evidence, explain uncertainty, and veto; deterministic code owns exposure, option structure, exact maximum loss, broker fields, and the final `PERMIT` or `NO_TRADE` decision.

## Event requirements

| Published requirement | Finly evidence | Boundary or remaining action |
| --- | --- | --- |
| Autonomous AI trading agent using Alpaca's Trading API | Finly implements a bounded evidence pipeline, local-model assessment, deterministic economic intent, defined-risk options compilation, risk reservation, lifecycle state, and machine-checkable receipts. | The public demonstration is non-mutating. Do not describe a synthetic receipt as a broker order. |
| Use Alpaca MCP or Alpaca CLI | The official `alpaca-mcp-server==2.2.1` completed an authenticated paper-mode `get_account_info` call. A redacted, hashed trace is stored in [`evidence/alpaca_mcp_read_trace.json`](../evidence/alpaca_mcp_read_trace.json). | The trace proves authenticated read access, not an order, fill, or profit. |
| Incorporate options | A typed intent compiles into a defined-risk SPY bull-call or bear-put debit vertical. The implementation validates OCC symbols, payoff bounds, quote freshness, equality, aggregate risk, and Alpaca multi-leg payload shape. | The historical return studies are ETF policy replays, not historical options P&L. Public verticals are compiler fixtures, not fills. |
| New dedicated Alpaca paper account reset to $100,000 | The authenticated account is recorded as active, unblocked, and approved for Level 3 options. Its identifier is kept outside the public package. | Reconfirm that the account is dedicated, begins at exactly $100,000, and paste its ID only into the private form. |
| One-page explanation of AI logic, risk gates, and Alpaca infrastructure | [`Finly_Judge_Brief.pdf`](../public/judge/Finly_Judge_Brief.pdf) is a one-page analytical essay, with an editable [`DOCX`](../public/judge/Finly_Judge_Proposal.docx). | The public guidance does not expose a dedicated file type or field; add the PDF wherever the live form permits and repeat its link in Additional Information. |
| Public, original, open-source work | Repository: <https://github.com/owlsowo/finly-bot>. The project is MIT-licensed. | Keep secrets, account identifiers, private audit material, and direct competitor matchups out of the public release. |

The event judges paper-account **P&L and trading activity**. Finly currently has no competition-account option order, fill, or realized P&L. That is a material scoring weakness, not a hidden technicality. No broker mutation should be claimed or performed as part of this release unless the builder separately authorizes it and the resulting record satisfies the existing safety gates.

## Quantitative claims are governed by one release gate

The only judge-facing performance language is in [`research/output/quantitative_release_gate.json`](../research/output/quantitative_release_gate.json). The downstream site, essay, paper, deck, film, metadata, and social copy must not paraphrase beyond these boundaries.

1. “In the consumed, post-selected 2013-01-02–2026-08-27 retrospective replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%; promotion was rejected because the Deflated Sharpe probability was 3.75% and the worst familywise-adjusted p-value was 37.18%.”
2. “Production v1 is the frozen unlevered SPY/BIL policy targeting 10% annualized volatility: in the consumed 2025-01-02–2026-08-28 modeled next-open study it returned +15.39% at 5 bp per traded leg and +10.56% at 25 bp, versus SPY +33.52%; at 5 bp its modeled annualized volatility was 8.12% and maximum drawdown was -5.45%, so it was risk-controlled but not market-beating on total return.”
3. “Attempts 115 and 116 are publicly registered future-only tests. As of 2026-08-30T08:10:52.000Z, each had zero observed outcomes, and neither supports a performance claim.”
4. “At the Generation 7 capture, 20 projects were visible and zero supplied an exact same-panel submitted-options comparator; missing P&L is unknown, never zero, and supports neither a return matchup nor a competitor rank.”

The live gallery later showed 21 total submissions and 17 Options Alpha Agents submissions at 04:59 EDT on 30 August. That does not invalidate the explicitly dated Generation 7 statement, but the 20-project count must never be presented as current.

Finly must not claim future profitability, next-month SPY outperformance, verified options P&L, promotion or validation of G4, a result from Attempts 115 or 116, or superiority over a named project. The point of the G4 result is that an attractive backtest did **not** receive authority.

## Required form and media package

| Form field or upload | Finly artifact or paste-ready source | Final check |
| --- | --- | --- |
| Project title, maximum 50 characters | `Finly: The Trading Agent That Can Say No` | 40 characters. |
| Short description, maximum 255 characters | [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md) | 186 characters. Recheck after pasting. |
| Long description, minimum 100 words | [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md) | 269 words in the current draft. |
| Main track | `Options Alpha Agents` | Select explicitly; do not rely on technology tags. |
| Technologies and categories | Alpaca, Codex, Llama 3.2/Ollama, React, Vite, TypeScript, Python, Node.js | Choose the closest categories exposed by the final form. |
| 16:9 cover image | [`finly-cover-16x9.png`](../public/brand/finly-cover-16x9.png) | Verify PNG/JPG acceptance and preview crop. |
| Slide presentation | [`Finly_Consulting_Deck.pdf`](../public/judge/Finly_Consulting_Deck.pdf), with editable [`PPTX`](../public/judge/Finly_Consulting_Deck.pptx) | Final nine-page PDF; overflow, template fidelity, links, and rendered pages passed QA. |
| Video presentation | [`Finly_Demo_Video.mp4`](../public/judge/Finly_Demo_Video.mp4) | Final 184.8-second, 20.5 MB, 1920×1080 H.264/AAC cut with neural narration and synchronized captions; codec, duration, loudness, claims, and sampled frames passed QA. |
| Public repository | <https://github.com/owlsowo/finly-bot> | Open from a signed-out session after the final push. |
| Demo application platform and URL | GitHub Pages at <https://owlsowo.github.io/finly-bot/> | The event page accepts a platform and URL, but the generic rule book names Streamlit, Replit, or Vercel. Obtain organizer confirmation or create a Vercel mirror if the form rejects GitHub Pages. |
| Alpaca paper-account ID | Stored only in the ignored local environment | Enter directly into the private form; never paste it into Git, slides, video, or social posts. |
| Optional Additional Information | Links to the one-page essay, paper, source gate, and accessibility notes | Use if the live form exposes the field. |

The generic guide requests an IBM Bob report only where IBM Bob assisted. No evidence indicates that it was used for Finly, so that item is currently inapplicable.

## Judging criteria and honest position

No numerical weights or tie-break formula are published. The event-specific criteria are the governing frame.

| Criterion | Strongest verifiable evidence | Weakest point |
| --- | --- | --- |
| **P&L Performance** | The G4 replay is economically attractive and unusually explicit about costs, hindsight, multiplicity, and failed promotion gates. | There is no competition-account options P&L. Historical ETF replays cannot substitute for it. |
| **Technology Implementation** | Controlled delegation, deterministic options compilation, exact payoff checks, mutation guards, risk reservations, idempotency, reconciliation logic, authenticated read-only Alpaca evidence, and a large automated test suite. | The broker path has no order/fill/read-back artifact. |
| **Creativity & Originality** | Finly makes the distinction between model judgment and capital-bearing authority executable, then demonstrates it by rejecting its most marketable chart. | Risk gates alone are familiar; the presentation must make the authority boundary concrete. |
| **Presentation & Execution** | One coherent story across a live interactive case, one-page essay, academic paper, consulting deck, captioned film, machine-readable gate, and source repository. | Every surface must be rebuilt and visually checked after the last claim change. |

## Social-engagement prize

The separate social prize accepts up to five X or LinkedIn post links created during the hackathon. The five drafts in [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md) use the required X handles `@lablabai` and `@AlpacaHQ`. Content quality and engagement may both matter; no minimum post count or scoring formula is published. Publishing the drafts and entering their resulting URLs remain manual actions for the builder.

## Final release sequence

1. Run `npm run verify` and reproduce it from a clean clone using the pinned runtime.
2. Confirm the one-page brief, eight-page paper, nine-page deck, and final video open correctly; inspect their renders rather than relying only on text extraction.
3. Sweep every public surface for stale claims, hidden internal audits, direct competitor matchup language, secrets, account identifiers, broken links, and incorrect organizer handles.
4. Push the ordinary release commit, wait for CI and Pages, and open every final URL from a signed-out browser.
5. Confirm the dedicated paper account and copy its ID only into the private form.
6. Reopen the event rules and form, select the track, attach every required file/link, and submit before the stated deadline.

Publishing the repository or website does not submit the project. The form submission, account ID, uploads, optional social links, and final approval remain the builder's actions.
