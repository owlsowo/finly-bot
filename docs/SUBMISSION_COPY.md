# Finly submission copy

This file contains paste-ready language for the Lablab submission form and public launch posts. The Alpaca paper-account identifier is intentionally omitted; copy it from the ignored local environment into the private form field.

## Core fields

**Title — 37 characters**

> Finly: AI Trading That Shows Its Work

**Track**

> Options Alpha Agents

**Short description — 174 characters**

> Finly pairs Qwen3-32B with deterministic risk gates and Alpaca execution. At its first close on a $100K paper account, it finished $153.31 ahead of SPY—and showed every step.

**Long description**

> We built Finly around a simple belief: AI can help form a market view without getting unrestricted control of a brokerage account.
>
> For the competition, Finly pairs a frozen four-ETF allocation with a separate SPY options agent. Qwen3-32B, hosted by Featherless, reads current evidence and explains its view. Deterministic code then sets exposure, chooses the option structure, calculates maximum loss, validates every Alpaca field, and either permits a defined-risk paper order or stops the trade.
>
> The evidence is measurable. In a cost-adjusted 2013–2026 historical simulation, $10,000 grew to $106,711 with Finly's G4 allocation versus $68,082 with SPY—$38,629 more ending wealth. A separate fixed-industry replay across 21,218 earlier market days annualized 13.37% versus 9.48% for the market, remained ahead under a 25-basis-point cost stress, and kept a positive edge across all 21 monthly rebalance dates tested. These simulations are distinct from the live result.
>
> Finly is now running forward in a dedicated $100,000 Alpaca paper account. At its first market close, Finly was up $95.32 while the same-timestamp SPY benchmark was down $57.99—a $153.31 first-session advantage. The public dashboard places this closing-bell receipt beside the changing live account mark.
>
> The options workflow is equally concrete. In the interactive demo, Finly builds a one-contract SPY vertical with $366 maximum loss and $634 maximum gain, then challenges the decision by removing each evidence source and perturbing its inputs 32 ways. If the reasoning or arithmetic fails, no order is authorized.
>
> This is not a chatbot bolted onto a broker. It is an inspectable chain from evidence to decision to bounded execution. A cloud runner uses Alpaca's official MCP server, pins the audited trading revision, and publishes a sanitized live decision record. Judges can watch the paper account, test both trade and no-trade paths, inspect the code, and reproduce the historical evidence.

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

> We built Finly, an AI trading agent that researches the market while deterministic code controls the risk. At its first close on a $100,000 Alpaca paper account, Finly gained $95.32 while same-clock SPY lost $57.99—a $153.31 advantage. Every decision is inspectable: https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

### Post 2 — how it works

> Most trading agents ask one model to research, decide, size, and trade. Finly splits those jobs. AI reviews the information and explains its view. Code sets the exact position and maximum loss. A final check either prepares the Alpaca paper order or stops the trade. Try both paths here: https://owlsowo.github.io/finly-bot/#controls @lablabai @AlpacaHQ

### Post 3 — the options proof

> In Finly's public options demo, one SPY debit spread had a $366 maximum loss and $634 maximum gain. The investment case survived 4 of 4 source-removal checks and 32 of 32 input perturbations before the paper-order plan was prepared. Every number has a decision record behind it. https://owlsowo.github.io/finly-bot/#controls @lablabai @AlpacaHQ

### Post 4 — the live account

> Finly does not need my laptop to stay awake. A cloud runner uses Alpaca's official MCP server and a hosted Qwen3-32B model, keeps the trading revision pinned, and publishes a sanitized view of the dedicated $100,000 paper account. Watch it here: https://owlsowo.github.io/finly-bot/#live @lablabai @AlpacaHQ

### Post 5 — why we built it

> Better trading AI is not only about generating more ideas. It is about knowing which ideas deserve capital. Finly can explain the market case, build an exact defined-risk trade, test the reasoning, and show why it traded—or why it stayed out. The bull has horns; the model still does not get the keys. https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

## Disclosure sentence

Use this sentence wherever a compact limitation is required:

> Finly is an educational paper-trading project. The $106,711 result comes from a historical simulation after modeled costs, not a live account or a promise of future returns; options examples are paper-trade demonstrations unless the live dashboard reports a fill.
