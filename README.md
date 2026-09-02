# Finly

![Finly finished $38,629 ahead of SPY in a 2013–2026 cost-modeled historical simulation](public/brand/finly-cover-16x9.png)

**Finly is a paper-trading bot that lets AI explain the market while tested code controls the money.**

In a cost-modeled historical simulation from January 2013 through August 2026, **$10,000 became $106,711 with Finly and $68,082 with SPY**—a **$38,629 difference in ending wealth**. That is the headline research result. It is a historical simulation, not a live return or a forecast.

The deployment evidence is separate: through the September 2 close, Finly's dedicated $100,000 Alpaca paper account gained **$141.24** while SPY—the fund commonly used to represent the S&P 500—lost **$284.76** from the same starting point. Finly therefore finished **$426.00 ahead of SPY** at the same 4:00 p.m. timestamp.

[Open Finly](https://owlsowo.github.io/finly-bot/) · [Watch the paper account](https://owlsowo.github.io/finly-bot/#live) · [Try a decision](https://owlsowo.github.io/finly-bot/#controls) · [Read the one-page proposal](public/judge/Finly_Judge_Brief.pdf) · [Open the mathematical note](public/judge/Finly_Technical_Proposal.pdf) · [View the deck](public/judge/Finly_Consulting_Deck.pdf)

## One strategy, two coordinated sleeves

Finly is one autonomous competition strategy with two coordinated sleeves. Its four-fund allocation keeps roughly half the account in QQQ, which tracks the Nasdaq-100; divides most of the remainder among three market sectors with stronger longer-term price trends; and holds 3% in cash. The allocation and its selection rule were fixed before paper trading began.

The coordinated SPY options sleeve evaluates a small, defined-risk trade on the same paper account. Fresh SPY price momentum chooses a positive or negative short-horizon view. Option-market evidence and Qwen3-32B's reading of public Alpaca news may support it, weaken it, or stop it. Fixed code—not the model—chooses a bullish call spread, a bearish put spread, or no trade; fixes every broker field; and limits a live entry to **one contract and no more than $500 of possible loss**.

The idea is simple: use AI for the part it does well—reading and explaining—while ordinary software keeps control of the account.

## What judges can verify

### A real paper account

Finly runs in the cloud against a verified Alpaca paper account, so the laptop does not need to stay awake. Through the September 2 close, the account had recorded 15 ETF fill events, no deposits or withdrawals, and the **$426.00 same-timestamp advantage over SPY** described above. During that session the options sleeve completed **24 live evaluation cycles**: 14 candidates failed certification, six lacked enough model evidence, and four arrived after the entry window. Every cycle ended `NO_TRADE`, so the sleeve added **$0 of new options risk** instead of forcing a position.

The [live dashboard](https://owlsowo.github.io/finly-bot/#live) separates the locked September 2 comparison from the account value that continues to change with market prices. It also shows the current holdings, the latest options decision, and the risk limit without exposing credentials or account numbers.

### Historical tests

In a simulation from January 2013 through August 2026, after modeled trading costs, **$10,000 became $106,711 with Finly's underlying four-fund research rule (before the competition's 3% cash scaling)** and **$68,082 with SPY**. That is a **$38,629 difference in ending wealth**.

A simpler version built from long-running industry data was also tested on **21,218 market days from 1927 through 2007**. It averaged **13.37% growth per year versus 9.48% for the market**, remained ahead in all 21 tests that changed the monthly update day, and stayed ahead when the assumed trading cost was increased fivefold.

### A decision anyone can replay

The interactive options demonstration shows all three outcomes: a bullish call spread, a bearish put spread, or no trade. In one illustrative SPY plan, the most that could be lost was **$366** and the most that could be gained was **$634**. Change the evidence and Finly shows why the decision weakens or stops before the paper account takes on risk.

The live policy is deliberately selective without requiring every good trade to win more than half the time. Across **517 sampled SPY signal windows**, **11 cleared every alpha gate** on the symmetric modeled quote surface: **7 bullish call spreads and 4 bearish put spreads**. Their certified maximum losses were **$440–$455**, conservative modeled values after costs were **$10.08–$22.26**, and reward-to-risk ratios were **2.30–2.41**. The [reproducible calibration artifact](evidence/options_policy_calibration.json) shows that both directions are reachable under the same rules; it is not a claim of historical option quotes or realized profit.

## How one idea becomes one checked order

1. **Finly gathers current information.** The live path records prices, option quotes, trading activity, and public Alpaca news.
2. **AI explains the case.** The model identifies the evidence for the trade, the evidence against it, and what remains uncertain.
3. **Code builds the position.** Tested rules choose the exact options, quantity, possible gain, and maximum loss.
4. **Finly challenges the decision.** It removes information sources and changes important inputs, publishing whether confidence survives without allowing those diagnostics to enlarge the trade.
5. **Hard rules decide whether money may move.** A short-lived certificate, one-contract limit, $500 ceiling, fresh-account checks, exact order binding, idempotency, and broker read-back still control execution.

## For technical judges

The [mathematical technical note](public/judge/Finly_Technical_Proposal.pdf) derives the portfolio rule, the limit on AI authority, options payoff, conservative valuation, risk sizing, one-order approval, and restart-safe execution. The [engineering appendix](public/judge/Finly_Engineering_Appendix.pdf) maps those claims to code, tests, evidence files, and cloud operations.

Some frozen research files call the four-fund allocation `G4`. That is an internal experiment label retained for reproducibility, not a product generation or a second Finly strategy.

The public verification run found **827 automated tests: 825 passed, 0 failed, and 2 optional private-ledger checks were skipped**. The suite covers historical timing and trading costs, bullish and bearish options paths, ordinary-market calibration, payoff arithmetic, data freshness, position limits, account checks, order construction, bounded cancel/reprice exits, lost acknowledgements, restart recovery, encrypted state, public-data filtering, and competition scoring.

The allocation sleeve remained unchanged after paper trading began. The options sleeve was revised separately after a published no-trade diagnostic; the [current dated revision record](config/options-policy-revision-v3-2026-09-02.json) identifies the exact code, what changed, what did not, and how earlier decisions remain attributed. The [superseded v2 record](config/options-policy-revision-2026-09-01.json) remains public.

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
