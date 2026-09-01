# Finly submission copy

This file contains paste-ready language for the Lablab submission form and public launch posts. The Alpaca paper-account identifier is intentionally omitted; copy it from the ignored local environment into the private form field.

## Core fields

**Title — 37 characters**

> Finly: AI Trading That Shows Its Work

**Track**

> Options Alpha Agents

**Short description**

> Finly is a paper-trading bot: AI explains the market, but tested code controls the money. Its first $100K session finished $153.31 ahead of SPY.

**Long description**

> Finly is a paper-trading bot that lets AI study the market without giving it control of the account. Paper trading follows real prices with virtual money. In Finly's first session on a dedicated $100,000 Alpaca paper account, the portfolio gained $95.32 while SPY—the fund commonly used to represent the S&P 500—lost $57.99 from the same starting point. Finly finished the session $153.31 ahead. No options position was open at that close.
>
> Finly starts with a rules-based portfolio: 48.5% in QQQ, which tracks the Nasdaq-100; 48.5% divided among three sector funds with stronger longer-term price trends; and 3% in cash. We fixed the portfolio and its selection rule before paper trading began. When the evidence supports it, the same system can also consider one small SPY options trade with a defined maximum loss.
>
> Qwen3-32B, hosted by Featherless, reads public Alpaca news and explains what supports the trade, what argues against it, and what remains uncertain. The model does not decide how much money to risk or write the broker order. Fixed, tested code chooses the direction, contracts, quantity, maximum loss, and every field sent to Alpaca. The competition limit is $500 of maximum loss per options trade. AI can make Finly more cautious or stop a trade; it cannot raise that limit.
>
> Finly's historical tests provide a longer view. In a January 2013–August 2026 simulation after modeled trading costs, $10,000 became $106,711 with Finly's portfolio rule and $68,082 with SPY—a $38,629 difference in ending wealth. A simpler version built from long-running industry data was tested across 21,218 earlier market days. It averaged 13.37% growth per year versus 9.48% for the market, remained ahead in all 21 tests that changed the monthly update day, and stayed ahead when the assumed trading cost increased fivefold. These are historical simulations, separate from the live account.
>
> The options controls are also visible. In the interactive demonstration, Finly built a one-contract, two-option SPY plan with a $366 maximum loss and $634 maximum gain. It ran the decision again after removing each of four information sources in turn and after 32 small input changes. With conflicting evidence, the safety check blocked the order. No broker order or fill occurred in the demonstration. During the competition, the live account may open only an approved rising-price options trade—or do nothing.
>
> Finly runs in the cloud through Alpaca's official connection. It locks the version of the code allowed to trade, saves its progress before each action, and checks the paper account after an order. The public dashboard clearly separates the recorded first-close comparison from the account value that keeps changing with market prices. Judges can watch the account, replay both an approval and a safety stop, inspect the code, and reproduce the historical evidence.
>
> Finly's contribution is straightforward: the AI may explain an investment idea, but tested software decides whether that idea deserves money.

**Technologies to select where available**

> Alpaca · Alpaca MCP · Featherless AI · Qwen3-32B · React · Vite · TypeScript · Node.js · Python · GitHub Actions

**Categories to select where available**

> AI Agents · Finance · Trading · Developer Tools

**Demo application platform**

> GitHub Pages

## Public links

- Live application: <https://owlsowo.github.io/finly-bot/>
- Repository: <https://github.com/owlsowo/finly-bot>
- Competition deployment record: <https://owlsowo.github.io/finly-bot/data/competition-deployment-record.json>
- One-page proposal: <https://owlsowo.github.io/finly-bot/judge/Finly_Judge_Brief.pdf>
- Mathematical technical note: <https://owlsowo.github.io/finly-bot/judge/Finly_Technical_Proposal.pdf>
- Engineering appendix: <https://owlsowo.github.io/finly-bot/judge/Finly_Engineering_Appendix.pdf>
- Slide deck: <https://owlsowo.github.io/finly-bot/judge/Finly_Consulting_Deck.pdf>
- Demo video: <https://owlsowo.github.io/finly-bot/judge/Finly_Demo_Video.mp4>

Do not paste these URLs into the form until the final commit has been pushed and each public page has been opened in a signed-out browser session.

## Optional social-engagement drafts

Each post stands on its own. Attach the 1200×630 cover to the launch post and use a short product clip or chart for later posts. Recheck the organizer handles in the live form before publishing.

### Post 1 — launch

> We built Finly so AI can study the market without controlling the account. In its first session on a $100,000 Alpaca paper account, Finly gained $95.32 while SPY lost $57.99 from the same starting point—a $153.31 advantage at the closing bell. See the account and the evidence: https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

### Post 2 — how it works

> Finly gives AI one job: explain the market. Tested code chooses the position, fixes the maximum loss, and decides whether an order may reach Alpaca. If the evidence conflicts, Finly leaves the paper account alone. Try both decisions: https://owlsowo.github.io/finly-bot/#controls @lablabai @AlpacaHQ

### Post 3 — the options proof

> Finly's public options demo built a SPY trade with a $366 maximum loss and $634 maximum gain. It kept the same decision after four source-removal tests and 32 small input changes—and its safety check blocked the order when the evidence conflicted. Replay it: https://owlsowo.github.io/finly-bot/#controls @lablabai @AlpacaHQ

### Post 4 — the live account

> Finly runs in the cloud, so my laptop does not need to stay awake. It uses Alpaca's official connection, locks the code version allowed to trade, and publishes a safe view of its dedicated $100,000 paper account. Watch it here: https://owlsowo.github.io/finly-bot/#live @lablabai @AlpacaHQ

### Post 5 — why we built it

> A better trading agent should do more than produce confident opinions. Finly explains the case, fixes the possible loss, tests whether the decision survives small changes, and shows why it traded—or why it stayed out. AI reads the market; code controls the money. https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

## Disclosure sentence

Use this sentence wherever a compact limitation is required:

> Finly is an educational paper-trading project. The $106,711 result comes from a historical simulation after modeled costs, not a live account or a promise of future returns; options examples are paper-trade demonstrations unless the live dashboard reports a fill.
