# Finly submission requirements and evidence boundary

This document traces the public Finly package to the Alpaca AI Trading Agents Hackathon requirements. It is an internal release checklist, not a substitute for the Lablab submission form. The event page was rechecked on 29 August 2026 and lists the hackathon dates as 28 August through 4 September 2026. The working submission deadline is 4 September 2026 at 11:00 a.m. EDT; the form should be checked once more immediately before the final upload in case the organizer changes a field or deadline.

Finly should be entered in the **Options Alpha Agents** track. The project is strongest when presented as a controlled-delegation options agent: AI contributes bounded judgment and veto power, deterministic code owns the trade and its loss, and the system refuses to promote even its most attractive historical candidate when the evidence does not satisfy its authorization standard.

## The build satisfies the technical shape of the challenge, with one execution proof still outstanding

| Published requirement | Evidence in the Finly repository | Boundary that must remain explicit |
| --- | --- | --- |
| Build an autonomous AI trading agent with Alpaca's Trading API. | Finly implements an evidence pipeline, bounded model assessment, deterministic economic intent, defined-risk option compilation, risk reservations, a guarded paper-order lifecycle, and machine-checkable decision receipts. The model can interpret, challenge, reduce, or veto; code owns direction, horizon, structure, quantity, maximum loss, order fields, and the final `PERMIT` or `NO_TRADE` result. | The authenticated broker evidence is currently read-only. No competition-account order or fill is claimed as proof of performance. |
| Use Alpaca's MCP server or CLI. | The official `alpaca-mcp-server==2.2.1` was invoked over MCP stdio. An authenticated paper-mode `get_account_info` call succeeded, and the redacted, hashed trace is stored in [`evidence/alpaca_mcp_read_trace.json`](../evidence/alpaca_mcp_read_trace.json). The runtime schema for multi-leg option orders is pinned and checked separately. | The successful MCP call did not mutate the account. An MCP order acknowledgment, fill, exit, and exact read-back have not yet been captured. |
| Every strategy must incorporate options. | The submitted architecture compiles defined-risk SPY bull-call or bear-put debit verticals, validates OCC symbols, calculates exact payoff bounds, projects an atomic Alpaca multi-leg payload, and tests lifecycle failures including partial fills and reconciliation errors. | The 2013–2026 G4 chart is an ETF allocation replay used to evaluate the economic candidate. It is not historical options profit and loss. The public vertical examples are synthetic compiler fixtures, not broker fills. |
| Use a new dedicated Alpaca paper account reset to $100,000. | The authenticated trace records an active, unblocked dedicated paper account with the required starting balance and Level 3 options approval. The full account ID is retained locally for the Lablab form. | The public package should omit the full account ID together with credentials, the internal account UUID, buying power, and other unnecessary private fields. Account eligibility and the reset balance should be confirmed once more immediately before form submission. |

The remaining integration proof is intentionally narrow: a minimum-size, defined-risk paper option order should be acknowledged, reconciled, closed, and read back during market hours. That action is not necessary to describe the architecture honestly, but it would materially strengthen the Technology Implementation and P&L evidence. It must not be represented as completed until the broker record exists.

## The quantitative evidence is compelling enough to explain and not strong enough to oversell

The locked retrospective object is the G4 shadow strategy. From 2 January 2013 through 27 August 2026, under a five-basis-point one-way cost, it recorded 967.11% total return and 18.97% annualized return, compared with SPY at 580.82% and 15.11%. Its maximum drawdown was -28.99%, compared with -33.72% for SPY, while its annualized volatility and turnover were higher.

Those figures belong in the submission because P&L Performance is an official judging criterion. They must be accompanied by the reason G4 was not promoted. Its Deflated Sharpe probability was 3.75% against a 95% gate; its worst adjusted familywise p-value was 0.3718 against a 0.05 gate; the static growth-control independence gate was unsupported; and the authenticated source-overlap gate did not pass. Although the sign of the historical edge remained positive across all 21 tested rebalance-anchor offsets and the tested 5, 10, and 25 basis-point costs, those local sensitivity checks did not repair the failed promotion evidence.

Seven hash-frozen but fully retrospective Generation 6 challengers produced no selection. The research ledger conservatively counts 113 items, including controls, rejected or unexecuted suggestions, invalidated runs, one aborted attempt, and reruns. It is a multiple-testing record, not a claim that 113 independent viable strategies competed under identical conditions. The repository records a local hash freeze of the core G4 formula, date partitions, and costs before the first G4 output, but the local timestamp is not an independent time authority; the excess-Sharpe selection rule and later inferential corrections changed afterward. Accordingly, every market interval used in the reported analysis is treated as consumed, and the analysis is not described as fully preregistered.

The exact judge-facing language is locked in [`public/data/submission_claims_lock.json`](../public/data/submission_claims_lock.json). The permitted conclusion is that G4 recorded a higher historical annualized return and a shallower maximum drawdown than SPY under the disclosed assumptions, but failed promotion. The package must not say that Finly consistently outperforms SPY, is proven profitable, has independently validated forward results, or has demonstrated historical options profitability.

G4 must not be confused with the production book. Production uses the frozen `tsmom_ensemble_vol` SPY/BIL policy. In its fixed 2025–2026 holdout it underperformed SPY's raw return while materially reducing volatility and drawdown, and it has zero forward observations. The latest 95.71% SPY / 4.29% BIL figure is a research-only proposal; the paper account remained in its prior defensive state and no mutation was requested.

## Forward Trial 1 preserves a real prospective boundary instead of inventing one

Forward Trial 1 uses separate signal-commitment and outcome-settlement phases and begins at zero commitments and zero settlements. The protocol predefines the production, G4 shadow, and benchmark books; requires 252 settlements before the primary calculation; and keeps production commitment, production settlement, performance inference, and broker authority disabled.

The protocol is clean-clone-verifiable and locally hash-bound. That does not independently prove when a signal existed, who supplied an input, or whether a market outcome was reconstructed correctly. The external pre-execution anchor, corporate-action reconciliation, provider-origin verification, and outcome-price reconciliation gates therefore remain closed. Its synthetic `TEST_ONLY` path demonstrates schema and accounting mechanics only. The safe, exact statement is recorded in the claim registry and in [`research/FORWARD_TRIAL1.md`](../research/FORWARD_TRIAL1.md).

## Every required submission artifact has a named owner and a final-state check

| Form field or upload | Current Finly artifact | Release status |
| --- | --- | --- |
| Project title, no more than 50 characters | `Finly: The Trading Agent That Can Say No` | Final copy is locked in [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md). |
| Short description, no more than 255 characters | Paste-ready 186-character description in [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md). | Final; recheck form rendering before submission. |
| Long description, at least 100 characters | Paste-ready human-edited description in [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md). | Final; paste only after public URLs resolve. |
| Public repository | `https://github.com/owlsowo/finly-bot` | The 320-file release candidate passed the clean-snapshot verification; the final push remains pending the history-privacy decision. |
| Hosted prototype | `https://owlsowo.github.io/finly-bot/` | The production build and local link checks pass; GitHub Pages will redeploy from the final `main` push. |
| 16:9 cover image | [`public/brand/finly-cover-16x9.png`](../public/brand/finly-cover-16x9.png) | Complete and visually checked. |
| Slide deck | [`public/judge/Finly_Consulting_Deck.pdf`](../public/judge/Finly_Consulting_Deck.pdf) and editable [`PPTX`](../public/judge/Finly_Consulting_Deck.pptx) | Nine-slide consulting-style deck complete; content, link, overflow and visual QA passed. |
| Video, no more than five minutes and under 300 MB | [`public/judge/Finly_Demo_Video.mp4`](../public/judge/Finly_Demo_Video.mp4) | Final 176.9-second narrated, captioned 16:9 cut; duration, decode, audio level, captions, sampled frames and claims passed QA. |
| One-page explanation of AI logic, risk gates, and Alpaca infrastructure | [`public/judge/Finly_Judge_Brief.pdf`](../public/judge/Finly_Judge_Brief.pdf), with editable [`DOCX`](../public/judge/Finly_Judge_Proposal.docx) | Complete as a one-page analytical essay; PDF/DOCX page, render and text-layer QA passed. |
| Fuller technical paper | [`public/judge/Finly_Technical_Proposal.pdf`](../public/judge/Finly_Technical_Proposal.pdf), with editable [`DOCX`](../public/judge/Finly_Technical_Paper.docx) | Complete and visually checked. It is supplementary rather than a replacement for the required one-page submission. |
| Alpaca paper account ID | Retained in the ignored local environment and entered directly in the Lablab form. | Ready for the form; do not publish the full identifier in the repository, deck, video, or social posts. Recheck eligibility before submission. |
| Optional social-engagement entries, up to five posts | Five paste-ready, stand-alone drafts in [`docs/SUBMISSION_COPY.md`](SUBMISSION_COPY.md), plus the social cover. | Final copy; publish only after every linked public page works, and verify the organizer tags in the live form. |

Publishing a repository or website does not submit the project. The Lablab form, track selection, account ID, uploads, URLs, and optional social links remain a separate final action by the builder.

## The final review should follow the four published judging criteria

No public numerical weights were found, so Finly should not invent a composite score. The release review should instead ask what a judge can verify under each criterion.

| Judging criterion | Finly's strongest evidence | Principal weakness to close |
| --- | --- | --- |
| **P&L Performance** | The consumed G4 replay is economically attractive and unusually candid about costs, turnover, drawdown, multiplicity, failed gates, and hindsight. | There is no completed competition-account options P&L. A small paper round trip would improve credibility but would not prove strategy profitability. |
| **Technology Implementation** | Controlled delegation, typed intents, deterministic option compilation, payoff verification, mutation guards, receipts, extensive tests, and a zero-row forward protocol form a coherent system rather than a single model prompt. | The broker path has authenticated read-only evidence but no final order/fill/read-back artifact. |
| **Creativity & Originality** | Finly's novelty is the separation of informational judgment from capital-bearing authority, demonstrated by refusing its own strongest historical chart after correction-aware promotion gates fail. | Bounded models and risk gates are not unique by themselves. The submission must explain the evidence-governance distinction precisely. |
| **Presentation & Execution** | The website, essay, technical paper, consulting deck, machine-readable claim registry, captioned film, and social drafts tell one inspectable story. | Rebuild the final artifacts after the last claim change and check every published link from a clean browser session. |

The release is ready only when the repository passes `npm run verify`, a clean clone reproduces the public checks, the website and documents agree with the claim registry, the final video opens with correct narration and captions, all uploaded files open correctly, and a final refresh confirms that no new submission materially changes the competitive framing.
