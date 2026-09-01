# Finly submission copy

This file contains paste-ready language for the Lablab submission form and public launch posts. The Alpaca paper-account identifier is intentionally omitted; copy it from the ignored local environment into the private form field.

## Core fields

**Title — 37 characters**

> Finly: AI Trading That Shows Its Work

**Track**

> Options Alpha Agents

**Short description**

> Finly lets AI study trades while tested code caps the loss and controls each order. Its first $100K paper session ended $153.31 ahead of the S&P 500 fund (SPY).

**Long description**

> We built Finly around a simple belief: AI can study a trade, but it should not control the money.
>
> Finly has two parts. Finly Core is a rules-based portfolio that holds QQQ, three sector funds, and 3% cash. QQQ tracks the Nasdaq-100. We chose and locked the competition mix before paper trading began. Finly Options is a separate AI-assisted workflow. Qwen3-32B, hosted by Featherless, reviews public Alpaca news and explains what supports or weakens a trade. Fixed, tested code chooses the direction, contracts, size, maximum loss, and every Alpaca order field. The AI may lower confidence or stop a trade; it cannot increase the amount at risk.
>
> The evidence is measurable. In a 2013–2026 historical simulation with modeled trading costs, $10,000 became $106,711 with Finly Core and $68,082 with SPY, a fund that tracks the S&P 500—a $38,629 difference in ending wealth. A simpler industry version was checked across 21,218 earlier market days. It averaged 13.37% growth per year versus 9.48% for the market, stayed ahead in all 21 tests that changed which trading day of the month the holdings were updated, and remained ahead when the trading-cost assumption increased fivefold. These are historical tests, separate from the live account.
>
> Finly is also running in a dedicated $100,000 Alpaca paper account, which follows real prices with virtual money. At exactly 4:00 p.m. ET on its first day, Finly Core was up $95.32 while SPY was down $57.99 from the same $100,000 starting point—a $153.31 advantage. No options position was open at that close. The public dashboard shows both that recorded closing result and the changing account value.
>
> The options workflow is equally concrete. In the interactive demonstration, Finly builds a one-contract, two-option SPY plan with a $366 maximum loss and $634 maximum gain. It runs the decision again after removing each of four information sources one at a time and after 32 small input changes. No broker order or fill occurred. The demo shows both rising- and falling-price cases; during the competition, the live account may open only a rise-focused options trade or do nothing.
>
> This is not a chatbot bolted onto a broker. It is an inspectable chain from market information to a checked decision and one exact paper order. A cloud runner uses Alpaca's official connection, locks the code version allowed to trade, saves its progress before each action, and publishes a safe account summary. Judges can watch the paper account, replay both the trade and no-trade demonstrations, inspect the code, and reproduce the historical evidence.

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

> We built Finly so AI can study a trade without controlling the account. Tested code caps the loss and controls the order. At the first 4:00 p.m. close on its $100,000 Alpaca paper account, Finly Core gained $95.32 while SPY lost $57.99—a $153.31 advantage. No options position was open. Watch it here: https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

### Post 2 — how it works

> Most trading agents ask one model to research, size, and send. Finly splits those jobs. AI explains the information. Tested code chooses the exact position and maximum loss. A final check either prepares the Alpaca paper order or leaves the account alone. Try both paths: https://owlsowo.github.io/finly-bot/#controls @lablabai @AlpacaHQ

### Post 3 — the options proof

> In Finly's public options demo, one two-option SPY trade had a $366 maximum loss and $634 maximum gain. Finly reached the same decision after removing each of four sources one at a time and making 32 small input changes. Every number has a saved decision record. https://owlsowo.github.io/finly-bot/#controls @lablabai @AlpacaHQ

### Post 4 — the live account

> Finly does not need my laptop to stay awake. It runs in the cloud through Alpaca's official connection, locks the version of code allowed to trade, and publishes a safe view of the dedicated $100,000 paper account. Watch it here: https://owlsowo.github.io/finly-bot/#live @lablabai @AlpacaHQ

### Post 5 — why we built it

> Better trading AI is not only about generating more ideas. It is about knowing which ideas deserve money. Finly explains the market case, builds a trade with a fixed maximum loss, stress-tests the decision, and shows why it traded—or why it stayed out. The bull has horns; the model still does not get the keys. https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

## Disclosure sentence

Use this sentence wherever a compact limitation is required:

> Finly is an educational paper-trading project. The $106,711 result comes from a historical simulation after modeled costs, not a live account or a promise of future returns; options examples are paper-trade demonstrations unless the live dashboard reports a fill.
