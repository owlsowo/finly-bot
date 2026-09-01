# Finly

![Finly finished its first Alpaca paper-trading session $153.31 ahead of SPY, a fund that tracks the S&P 500](public/brand/finly-cover-16x9.png)

**Finly is a paper-trading bot that lets AI explain the market while tested code controls the money.**

Paper trading follows real prices with virtual money. In Finly's first session on a dedicated $100,000 Alpaca paper account, the portfolio gained **$95.32** while SPY—the fund commonly used to represent the S&P 500—lost **$57.99** from the same starting point. Finly therefore finished the session **$153.31 ahead of SPY**. No options position was open at that close.

[Open Finly](https://owlsowo.github.io/finly-bot/) · [Watch the paper account](https://owlsowo.github.io/finly-bot/#live) · [Try a decision](https://owlsowo.github.io/finly-bot/#controls) · [Read the one-page proposal](public/judge/Finly_Judge_Brief.pdf) · [Open the mathematical note](public/judge/Finly_Technical_Proposal.pdf) · [View the deck](public/judge/Finly_Consulting_Deck.pdf)

## What Finly does

Finly starts with a rules-based base portfolio: roughly half the account in QQQ, which tracks the Nasdaq-100; most of the remainder divided among three market sectors with stronger longer-term price trends; and 3% held in cash. The competition portfolio and its selection rule were fixed before paper trading began.

Finly can also consider a small, defined-risk SPY options trade. A hosted AI model reads public Alpaca news and explains what supports or weakens the idea. It does not choose how much money to risk or write the broker order. Fixed code chooses the direction, contracts, quantity, maximum loss, and every field sent to Alpaca. The competition limit is **$500 of maximum loss per options trade**. The AI may make the system more cautious or stop a trade; it cannot raise that limit.

The idea is simple: use AI for the part it does well—reading and explaining—while ordinary software keeps control of the account.

## What judges can verify

### A real paper account

Finly runs in the cloud against a verified Alpaca paper account, so the laptop does not need to stay awake. At the first 4:00 p.m. close, the account had recorded 15 broker fill events, no deposits or withdrawals, and the **$153.31 advantage over SPY** described above. That result is a record of one session, not a promise about the next one.

The [live dashboard](https://owlsowo.github.io/finly-bot/#live) separates the locked first-close comparison from the account value that continues to change with market prices. It also shows the current holdings, the latest options decision, and the risk limit without exposing credentials or account numbers.

### Historical tests

In a simulation from January 2013 through August 2026, after modeled trading costs, **$10,000 became $106,711 with Finly's portfolio rule** and **$68,082 with SPY**. That is a **$38,629 difference in ending wealth**.

A simpler version built from long-running industry data was also tested on **21,218 market days from 1927 through 2007**. It averaged **13.37% growth per year versus 9.48% for the market**, remained ahead in all 21 tests that changed the monthly update day, and stayed ahead when the assumed trading cost was increased fivefold.

### A decision anyone can replay

The interactive options demonstration shows what the risk controls do. In one illustrative SPY plan, the most that could be lost was **$366** and the most that could be gained was **$634**. Finly reached the same decision when each of four information sources was removed in turn and after 32 small changes to the inputs. No broker order or fill occurred.

Change the demonstration to conflicting evidence and Finly stops before the paper account takes on any risk. The demo can illustrate rising- and falling-price cases; during the competition, the live account may open only an approved rising-price options trade—or do nothing.

## How one idea becomes one checked order

1. **Finly gathers current information.** The live path records prices, option quotes, trading activity, and public Alpaca news.
2. **AI explains the case.** The model identifies the evidence for the trade, the evidence against it, and what remains uncertain.
3. **Code builds the position.** Tested rules choose the exact options, quantity, possible gain, and maximum loss.
4. **Finly tries to disprove the decision.** It removes information sources and changes important inputs to see whether the result still holds.
5. **The system trades or stays out.** Only a decision that passes every check can become one exact Alpaca paper order. Otherwise, the account is left untouched.

## For technical judges

The [mathematical technical note](public/judge/Finly_Technical_Proposal.pdf) derives the portfolio rule, the limit on AI authority, options payoff, conservative valuation, risk sizing, one-order approval, and restart-safe execution. The [engineering appendix](public/judge/Finly_Engineering_Appendix.pdf) maps those claims to code, tests, evidence files, and cloud operations.

Some frozen research files call the base portfolio configuration `G4`. That is an internal experiment label retained for reproducibility, not a product generation or a second Finly product.

The public verification run found **809 automated tests: 807 passed, 0 failed, and 2 were skipped**. The suite covers historical timing and trading costs, options payoff arithmetic, data freshness, position limits, account checks, order construction, lost acknowledgements, restart recovery, encrypted state, public-data filtering, and competition scoring.

```bash
npm install
npm run verify
```

## Repository map

```text
lib/         portfolio logic, options compiler, risk checks, and broker guards
research/    historical studies, frozen protocols, and forward measurement
scripts/     cloud runner, receipt checkers, model tools, and artifact builders
evidence/    redacted runtime records
fixtures/    aligned, conflicting, and boundary-test scenarios
src/         public website, interactive decision, and live dashboard
tests/       unit, integration, restart, statistical, and reporting tests
docs/        proposal, mathematical note, engineering appendix, and operating notes
```

## Research and broker sources

The portfolio research draws on published work about [time-series momentum](https://doi.org/10.1016/j.jfineco.2011.11.003) and [volatility-managed portfolios](https://doi.org/10.1111/jofi.12513), together with [Kenneth French's public Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html). The broker path follows Alpaca's documentation for [options trading](https://docs.alpaca.markets/us/docs/options-trading), [multi-leg orders](https://docs.alpaca.markets/reference/postorder), and [paper trading](https://docs.alpaca.markets/us/docs/paper-trading).

Finly is an educational paper-trading project. Historical simulations are not live results or promises of future returns, and options can lose their full premium.
