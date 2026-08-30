# Finly quantitative release gate

## Decision

**GO for a bounded quantitative release; NO-GO for any Finly-versus-competitor return or P&L matchup.** The site, paper, deck, and video may use only the four exact allowed claims below. No financial rank is authorized.

## The releaseable evidence is useful but does not establish market superiority

| Evidence | Exact result | Release interpretation |
|---|---|---|
| Consumed, post-selected G4 replay | 2013-01-02–2026-08-27; modeled 5 bp one-way; +967.11% vs SPY +580.82%; DSR 3.75%; familywise p 37.18% | Rejected; not promoted |
| Production v1, modeled next open | 2025-01-02–2026-08-28; +15.39% at 5 bp/leg; +10.56% at 25 bp/leg; SPY +33.52% | Unlevered SPY/BIL policy targeting 10% annualized volatility; not market-beating on total return |
| Attempts 115 and 116 | Publicly registered, future-only, zero outcomes as of 2026-08-30T08:10:52.000Z | No performance claim |
| Generation 7 census | 20 visible projects; 0 exact same-panel submitted-options comparators | Missing P&L is unknown; no matchup or rank |

G4's +967.11% headline over 2013-01-02–2026-08-27 with modeled 5 bp one-way costs cannot be presented as validation: the path was consumed and the candidate was selected after viewing history. Its 3.75% Deflated Sharpe probability missed the 95% gate, and its 37.18% worst familywise-adjusted p-value exceeded the 5% ceiling.

Production v1 is the frozen unlevered SPY/BIL policy targeting 10% annualized volatility. In the consumed 2025-01-02–2026-08-28 modeled next-open study, at 5 bp per leg it recorded 8.12% modeled annualized volatility and a -5.45% maximum drawdown, but its +15.39% total return remained below SPY's +33.52%. This is a theoretical adjusted-OHLC ledger, not a broker-fill replay or options P&L.

## Exact allowed claims

1. In the consumed, post-selected 2013-01-02–2026-08-27 retrospective replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%; promotion was rejected because the Deflated Sharpe probability was 3.75% and the worst familywise-adjusted p-value was 37.18%.
2. Production v1 is the frozen unlevered SPY/BIL policy targeting 10% annualized volatility: in the consumed 2025-01-02–2026-08-28 modeled next-open study it returned +15.39% at 5 bp per traded leg and +10.56% at 25 bp, versus SPY +33.52%; at 5 bp its modeled annualized volatility was 8.12% and maximum drawdown was -5.45%, so it was risk-controlled but not market-beating on total return.
3. Attempts 115 and 116 are publicly registered future-only tests. As of 2026-08-30T08:10:52.000Z, each had zero observed outcomes, and neither supports a performance claim.
4. At the Generation 7 capture, 20 projects were visible and zero supplied an exact same-panel submitted-options comparator; missing P&L is unknown, never zero, and supports neither a return matchup nor a competitor rank.

These sentences may be copied verbatim into the site, paper, deck, or video. If shortened, preserve the evidence class, historical window, cost basis, rejection or zero-outcome status, and the no-matchup boundary.

## Exact forbidden claims

- Finly will be profitable in the future.
- Finly will beat SPY next month.
- Finly has verified options P&L.
- Finly ranks first, or above any named competitor, on returns or profitability.
- Attempt 115 or Attempt 116 has a performance outcome.
- G4 is validated, promoted, or evidence of future market superiority.
- Missing competitor P&L equals zero or proves a Finly win.
- Any Finly-versus-competitor return or P&L matchup.

Do not imply any of these claims through a chart, caption, title, voice-over, ordering, or omission of the stated qualifiers.

## Registration and evidence-availability boundaries

Attempts 115 and 116 have canonically validated public GitHub publication receipts and first eligible sessions after registration. Both remain future-only with **zero observed outcomes** as of 2026-08-30T08:10:52.000Z. Their receipts establish a public platform record, not an independent cryptographic timestamp, market-data provenance, broker execution, or performance.

The Generation 7 registry records **20 visible projects** and **zero exact same-panel submitted-options comparators**. Missing P&L remains unknown, never zero; it supports neither a Finly win nor a financial rank. No project-level return figure belongs in this release gate.

## Source integrity

| Source | Frozen repository path | Raw-byte SHA-256 |
|---|---|---|
| submission_quantitative_evidence_surface | `research/output/submission_quantitative_evidence_surface.json` | `sha256:e69236a8b313bb42a9add625c0a90ce0ed678c8a81da259ef0399b8afb2da4db` |
| equity_execution_realism | `research/output/equity_execution_realism.json` | `sha256:8d4eb5922acf46c539790c398364ffcd41aa6c189c38494bf31f871bb6dfeb6d` |
| attempt115_protocol | `research/downside_semivolatility_challenger_protocol.json` | `sha256:34d30a46e70c07b27fad637b1948262f953662b43e30cbbaf86b84927dbe0e53` |
| attempt115_publication_receipt | `research/prospective_attempt115/publication_receipts/4dd7720d25198702013ab10e582b37004515bed5e4466a56eca89192559d2cd9.json` | `sha256:16d6af10a21b6654b862cf48a1489fca51aa7015b3f33b152832a2637704f436` |
| attempt116_protocol | `research/prospective_attempt116/protocol.json` | `sha256:3baa380e02f982d1c0c892357cded0e24ad311c2e73c1c1cc38d1d1b5d1501a2` |
| attempt116_publication_receipt | `research/prospective_attempt116/publication_receipts/934e52a583893e2720a0962195efd56b5f4b2a0554a1b8f8dfa9ab5951191362.json` | `sha256:1f959fd4245b7abd0c8eeeef2c4034623f93f68a691a9f80e0570c97ceab16ec` |
| competitor_strategy_registry_generation7 | `research/competitor_strategy_registry_generation7.json` | `sha256:06d57411772d9670df9af48bc66e699b201f561d0bebd90f4a1aac40ccf17f7f` |

All seven sources are required. Missing files, byte drift, schema drift, protocol self-hash drift, or receipt validation failure stops the build. Artifact self-hash: `sha256:033cdabd1965ee7b0c1226183dcb0c03d2c093ebccc9e8ba3b6adea7cbe92cc6`.
