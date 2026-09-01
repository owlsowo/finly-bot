# Finly

![Finly finished its first Alpaca paper-trading session $153.31 ahead of SPY, a fund that tracks the S&P 500](public/brand/finly-cover-16x9.png)

**Finly shows its work before it trades.**

AI can study a trade. It should not control your money. Finly lets AI explain public market information while fixed, tested code chooses the position, caps the possible loss, and decides whether anything may reach Alpaca paper trading.

Paper trading follows real market prices with virtual money. SPY is a fund that tracks the S&P 500; QQQ is a fund that tracks the Nasdaq-100.

[Open Finly](https://owlsowo.github.io/finly-bot/) · [Watch the $100K paper account](https://owlsowo.github.io/finly-bot/#live) · [Try the trade decision](https://owlsowo.github.io/finly-bot/#controls) · [Read the one-page proposal](public/judge/Finly_Judge_Brief.pdf) · [Open the mathematical note](public/judge/Finly_Technical_Proposal.pdf) · [View the deck](public/judge/Finly_Consulting_Deck.pdf)

## Finly has two parts

**Finly Core** is the base portfolio. It keeps roughly half the competition account in QQQ, divides most of the remainder across three market sectors selected for stronger longer-term price trends, and keeps 3% in cash. We chose and locked the competition mix before paper trading began.

**Finly Options** is the AI-assisted options workflow. A hosted model reviews public Alpaca news and explains what supports or weakens a trade. Fixed code chooses the direction, contracts, size, maximum loss, and every broker field. The AI may lower confidence or stop a trade; it cannot increase the amount at risk.

The two systems share one principle: the explanation can be flexible, but control of the money is not.

## The results in plain English

### Tested in the past

In a historical simulation from January 2013 through August 2026, with modeled trading costs, **$10,000 became $106,711 with Finly Core** and **$68,082 with SPY**—a **$38,629 difference in ending wealth**.

A simpler industry version was then checked on **21,218 earlier market days** from 1927 through 2007. It averaged **13.37% growth per year versus 9.48% for the market**, stayed ahead in all 21 tests that changed which trading day of the month the holdings were updated, and remained ahead when the trading-cost assumption was increased fivefold.

### Running in the present

Finly runs in the cloud against a dedicated, verified **$100,000 Alpaca paper account**. At the first closing bell, Finly Core was **up $95.32**. SPY, measured from the same $100,000 starting point at the same 4:00 p.m. price, was **down $57.99**. Finly therefore ended day one **$153.31 ahead**, after 15 broker fill events and with no deposits or withdrawals. No options position was open at that close.

The [live dashboard](https://owlsowo.github.io/finly-bot/#live) shows the changing paper-account value, current positions, latest decision, and fixed risk limits without exposing credentials or account numbers. The laptop does not need to stay awake.

### Inspectable at every step

In the interactive options demonstration, Finly prepared one illustrative SPY two-option plan with a **$366 maximum loss** and **$634 maximum gain**. It reached the same decision after each of four information sources was removed one at a time and after 32 small changes to the inputs. No broker order or fill occurred. Switch the website to conflicting evidence and Finly stops before the paper account takes on any risk.

The demo shows both rising- and falling-price cases. During the competition, the live account may open only a rise-focused options trade—or do nothing.

## How a trade moves through Finly

1. **Gather the evidence.** The live path records current prices, options activity and public Alpaca news. The interactive demonstration can also include economic and prediction-market examples.
2. **Explain the idea.** AI states what the evidence supports, what conflicts, and what remains uncertain.
3. **Build the trade.** Fixed code chooses the exact options, size, possible gain, and maximum loss.
4. **Try to break it.** Remove information sources and change important inputs to see whether the decision still holds.
5. **Trade—or do nothing.** If every check passes, prepare one exact Alpaca paper order. Otherwise, leave the account untouched.

## For technical judges

The public explanation stays simple; the implementation does not. The [mathematical technical note](public/judge/Finly_Technical_Proposal.pdf) derives the portfolio rule, AI authority limit, options payoff, conservative valuation, risk sizing, one-order approval, and restart-safe execution. The [engineering appendix](public/judge/Finly_Engineering_Appendix.pdf) maps those claims to code, tests, evidence files, and cloud operations.

Internally, Finly Core retains the research identifier `G4` in frozen code and evidence files. That identifier is kept for reproducibility; it is not a separate public product.

The public verification run discovered **809 automated tests: 807 passed, 0 failed, and 2 were skipped**. Coverage includes historical timing and costs, option payoff arithmetic, data freshness, position limits, account checks, order construction, lost acknowledgements, restart recovery, encrypted state, public-data filtering, and competition scoring.

```bash
npm install
npm run verify
```

## Repository map

```text
lib/         strategy logic, options compiler, risk checks, and broker guards
research/    historical studies, frozen protocols, and forward measurement
scripts/     cloud runner, receipt checkers, model tools, and artifact builders
evidence/    redacted runtime records
fixtures/    aligned, conflicting, and boundary-test scenarios
src/         public product website and live dashboard
tests/       unit, integration, restart, statistical, and reporting tests
docs/        proposal, mathematical note, engineering appendix, and operating notes
```

## Research and broker sources

The strategy draws on published work on [time-series momentum](https://doi.org/10.1016/j.jfineco.2011.11.003) and [volatility-managed portfolios](https://doi.org/10.1111/jofi.12513), plus [Kenneth French's public Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html). The broker path follows Alpaca's documentation for [options trading](https://docs.alpaca.markets/us/docs/options-trading), [multi-leg orders](https://docs.alpaca.markets/reference/postorder), and [paper trading](https://docs.alpaca.markets/us/docs/paper-trading).

Finly is an educational paper-trading project. Historical simulations are not live results or promises of future returns, and options can lose their full premium.
