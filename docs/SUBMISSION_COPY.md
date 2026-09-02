# Finly submission copy

This file contains paste-ready language for the Lablab submission form and public launch posts. The Alpaca paper-account identifier is intentionally omitted; copy it from the ignored local environment into the private form field.

## Core fields

**Title — 37 characters**

> Finly: AI Trading That Shows Its Work

**Track**

> Options Alpha Agents

**Short description**

> Finly is a paper-trading bot: AI explains the market, but tested code controls the money. Through September 2, its $100K paper account finished $426 ahead of SPY.

**Long description — maximum 2,000 characters**

> Most trading bots ask AI what to buy and let confidence pass for evidence. Finly is one autonomous strategy with two coordinated sleeves and a strict line between research and authority. Qwen3-32B, hosted through Featherless, reads public Alpaca news and explains the case. Fresh price momentum chooses the sign; options data and AI-read news may support, weaken, or stop it. Tested code fixes the contracts, quantity, price, maximum loss, and every broker field.
>
> The four-fund sleeve follows a rule fixed before trading began: 48.5% QQQ, 48.5% divided among three stronger-trending sectors, and 3% cash. Fifteen ETF fill events built the allocation. Through September 2, Finly gained $141.24 while SPY lost $284.76 from the same $100,000 start, leaving Finly $426.00 ahead at the 4:00 p.m. close.
>
> The coordinated options sleeve can build a bullish call spread, a bearish put spread, or no trade. Live entries are exactly one contract and capped at $500 maximum loss. On September 2 it completed 24 live evaluation cycles; 14 candidates failed certification, six lacked enough model evidence, and four arrived after the entry window. Every cycle ended no trade, adding $0 of new options risk.
>
> Finly runs in the cloud through Alpaca's official MCP and Trading API path. It locks the trading version, saves state before every action, and reconciles orders after a restart. Judges can inspect the account, replay an approval and a refusal, and reproduce the evidence with one command.
>
> In a 2013–2026 cost-modeled replay of the underlying rule—before the 3% cash scaling—$10,000 became $106,711 versus $68,082 for SPY. A 21,218-day earlier-market test averaged 13.37% annually versus 9.48% for the market and led across all 21 tested monthly rebalance schedules. Of 827 automated tests, 825 passed, none failed, and two optional private-ledger checks were skipped.
>
> Finly's advantage is not giving AI more power. It gives AI the smallest useful job, then makes every dollar answer to tested code.

**Technologies to select where available**

> Alpaca · Alpaca MCP · Featherless AI · Qwen3-32B · React · Vite · TypeScript · Node.js · Python · GitHub Actions

**Categories to select where available**

> AI Agents · Finance · Trading · Developer Tools

**Demo application platform**

> Other — GitHub Pages

**Additional information**

> Start with the required one-page write-up: https://owlsowo.github.io/finly-bot/judge/Finly_Judge_Brief.pdf. It covers Finly's AI logic, deterministic risk gates, and Alpaca implementation. Technical judges can continue to the mathematical note (https://owlsowo.github.io/finly-bot/judge/Finly_Technical_Proposal.pdf) and engineering appendix (https://owlsowo.github.io/finly-bot/judge/Finly_Engineering_Appendix.pdf). The live account and interactive decision are at https://owlsowo.github.io/finly-bot/. Public evidence reproduces from the repository with `npm ci && npm run verify`: 827 tests ran, 825 passed, none failed, and two optional private-ledger checks were skipped. The dedicated Alpaca account ID is entered in the required private field, not repeated here.

## Form completion checklist

The Lablab form has three steps. Do not rely on public URLs for the upload fields.

1. **Basic information:** paste the title, short description, and long description above; select Finance, Investment, Options Alpha Agents, Alpaca, Featherless, and the other technologies actually used.
2. **Media:** upload `public/brand/finly-cover-16x9.png`, `public/judge/Finly_Demo_Video.mp4`, and `public/judge/Finly_Consulting_Deck.pdf`.
3. **Application:** paste the public repository and live-application URLs below; select `OTHER` for the platform; enter the dedicated Alpaca paper-account ID from the ignored local environment.

The account ID is required for judging. Keep it out of the public repository and enter it only in the private Lablab form field.

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

> We built Finly so AI can study the market without controlling the account. Through September 2, its $100,000 Alpaca paper account gained $141.24 while SPY lost $284.76 from the same start—a $426 advantage at the closing bell. See the account and the evidence: https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

### Post 2 — how it works

> Finly gives AI one job: explain the market. Tested code chooses the position, fixes the maximum loss, and decides whether an order may reach Alpaca. If the evidence conflicts, Finly leaves the paper account alone. Try both decisions: https://owlsowo.github.io/finly-bot/#controls @lablabai @AlpacaHQ

### Post 3 — the options proof

> Finly ran 24 live options checks on September 2. Fourteen candidates failed certification, six lacked enough model evidence, and four arrived after the entry window. It forced zero trades and added $0 of options risk. See the decision record: https://owlsowo.github.io/finly-bot/#live @lablabai @AlpacaHQ

### Post 4 — the live account

> Finly runs in the cloud, so my laptop does not need to stay awake. It uses Alpaca's official connection, locks the code version allowed to trade, and publishes a safe view of its dedicated $100,000 paper account. Watch it here: https://owlsowo.github.io/finly-bot/#live @lablabai @AlpacaHQ

### Post 5 — why we built it

> A better trading agent should do more than produce confident opinions. Finly explains the case, fixes the possible loss, tests whether the decision survives small changes, and shows why it traded—or why it stayed out. AI reads the market; code controls the money. https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

## Disclosure sentence

Use this sentence wherever a compact limitation is required:

> Finly is an educational paper-trading project. The $106,711 result comes from a historical simulation after modeled costs, not a live account or a promise of future returns; options examples are paper-trade demonstrations unless the live dashboard reports a fill.
