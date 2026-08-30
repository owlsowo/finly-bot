# Finly

Finly is an agentic options-research system built around a deliberately narrow grant of power: an AI may interpret evidence, explain a view, and veto a proposal, but deterministic code owns exposure, option structure, maximum loss, broker fields, and the final `PERMIT` or `NO_TRADE` decision.

The project began with a conventional goal—find a strategy that could beat a simple benchmark—and arrived at a more consequential one. A persuasive forecast is not the same thing as permission to risk capital. Finly makes that distinction executable.

[Open the live case](https://owlsowo.github.io/finly-bot/) · [Read the one-page proposal](public/judge/Finly_Judge_Brief.pdf) · [Read the technical paper](public/judge/Finly_Technical_Proposal.pdf) · [Review the consulting deck](public/judge/Finly_Consulting_Deck.pdf) · [Watch the demo film](public/judge/Finly_Demo_Video.mp4)

## The strongest chart did not receive authority

In the consumed, post-selected 2013-01-02–2026-08-27 retrospective replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%; promotion was rejected because the Deflated Sharpe probability was 3.75% and the worst familywise-adjusted p-value was 37.18%.

That refusal is the central product demonstration. G4 was discovered after history had been examined, so its attractive return is evidence about the research process—not permission to describe a validated strategy or forecast future superiority. Finly records the result, preserves the assumptions, and denies promotion when the correction-aware gates fail.

## The production policy accepts a visible tradeoff

Production v1 is the frozen unlevered SPY/BIL policy targeting 10% annualized volatility: in the consumed 2025-01-02–2026-08-28 modeled next-open study it returned +15.39% at 5 bp per traded leg and +10.56% at 25 bp, versus SPY +33.52%; at 5 bp its modeled annualized volatility was 8.12% and maximum drawdown was -5.45%, so it was risk-controlled but not market-beating on total return.

The production rule is intentionally simpler than the rejected research shadow. Three lagged SPY-minus-BIL trend horizons determine exposure, a volatility target scales it, and BIL receives the balance. AI can examine bounded evidence and stop the process. It cannot rewrite the allocation, enlarge the trade, or turn a rationale into a broker order.

## Authority is divided before an order is constructed

| Stage | What it may do | What it may not do |
| --- | --- | --- |
| Evidence layer | Normalize timestamps, label provenance, and bind the review bundle. | Treat the presence of more data as confidence or permission. |
| AI assessment | Score bounded evidence, explain uncertainty, respond to source-removal challenges, and veto. | Choose exposure, contracts, quantity, maximum loss, or broker fields. |
| Quantitative core | Derive the code-owned direction, horizon, and typed economic intent. | Bypass the later equality, freshness, or loss gates. |
| Options compiler | Construct a defined-risk SPY vertical, calculate payoff bounds, and project an Alpaca multi-leg payload. | Submit a payload that differs from the authorized intent. |
| Authorization gateway | Check provenance, schema, equality, liquidity, account constraints, and aggregate loss. | Infer permission from model confidence or a favorable chart. |

This separation is testable. Supportive synthetic evidence can compile a bounded proposal; conflicting evidence returns `NO_TRADE` and a null payload. Broker mutation remains disabled in the published evidence path.

## The next performance claim begins at zero

Attempts 115 and 116 are publicly registered future-only tests. As of 2026-08-30T08:10:52.000Z, each had zero observed outcomes, and neither supports a performance claim.

The empty record is intentional. Historical data cannot become prospective by being replayed again, and a GitHub registration receipt is a platform record rather than an independent cryptographic timestamp. The protocols therefore keep outcome inference and broker authority closed until their stated future conditions are satisfied.

## Alpaca is inside the boundary, not outside it

Finly implements deterministic SPY debit-vertical construction, OCC-symbol validation, exact maximum-loss arithmetic, guarded multi-leg payload projection, idempotency, risk reservation, partial-fill freezes, and reconciliation checks. An authenticated read-only call to the dedicated Alpaca paper account succeeded through the official Alpaca MCP server. No order or fill is presented as performance evidence.

The historical ETF studies are not options P&L. They evaluate economic policies under disclosed modeled assumptions; the options layer demonstrates how an authorized intent would be bounded and compiled.

## Verify the evidence without trusting the presentation

The credential-free release path is reproducible with the pinned Node.js 26.7.0 runtime:

```bash
npm install
npm run verify
npm run dev
```

Useful focused checks include:

```bash
npm test                                  # behavior, evidence, and release-gate suite
npm run research:quant-extension-check   # historical research ledger
npm run research:forward-trial            # two-phase forward protocol
npm run research:forward-trial-live       # pre-session live activation
npm run economic:options-replay-check     # non-mutating options receipt
npm run llama:decision-check              # bounded local-model trace
npm run build                             # judge-facing site
```

The final performance language is locked by [`research/output/quantitative_release_gate.json`](research/output/quantitative_release_gate.json). The release gate verifies seven source artifacts by hash and permits no competitor return matchup or rank.

## Research basis

The candidate design draws on [time-series momentum](https://doi.org/10.1016/j.jfineco.2011.11.003) and [volatility-managed portfolios](https://doi.org/10.1111/jofi.12513). The decision to reject a compelling post-selected result follows the concerns formalized in [White's Reality Check](https://doi.org/10.1111/1468-0262.00152) and the [Deflated Sharpe Ratio](https://doi.org/10.3905/jpm.2014.40.5.094). These sources motivate the method; they do not validate Finly's implementation or future performance.

The broker boundary follows Alpaca's official documentation for [options trading](https://docs.alpaca.markets/us/docs/options-trading), [multi-leg orders](https://docs.alpaca.markets/reference/postorder), [paper trading](https://docs.alpaca.markets/us/docs/paper-trading), and [historical option data](https://docs.alpaca.markets/us/docs/historical-option-data).

## Repository map

```text
lib/         deterministic economic logic, evidence boundaries, compiler, and broker guards
research/    frozen protocols, statistical checks, and future-only trial machinery
scripts/     reproducible runners, receipt checkers, model tooling, and paper-account tools
evidence/    redacted, machine-checkable runtime records
fixtures/    synthetic controls, perturbations, and negative controls
src/         judge-facing website
tests/       release-blocking unit, metamorphic, lifecycle, statistical, and reporting tests
docs/        proposal sources, technical paper, setup notes, and requirements traceability
```

Finly is an educational paper-trading research prototype, not investment advice. Options can lose their full premium, and historical results do not guarantee future performance.
