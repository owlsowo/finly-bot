# Finly submission copy

This file contains paste-ready language for the Lablab submission form and public launch posts. The Alpaca paper-account identifier is intentionally omitted; copy it from the ignored local environment into the private form field.

## Core fields

**Title — 31 characters**

> Finly: A Safer AI Trading Agent

**Track**

> Options Alpha Agents

**Short description — 166 characters**

> Finly uses AI to research the market, turns that view into an exact defined-risk options trade, and checks the risk before anything can reach an Alpaca paper account.

**Long description**

> We built Finly because giving a language model direct control of a brokerage account is the wrong kind of automation. Finly is an AI trading agent that researches the market, turns a view into an exact trade, and checks every important risk before anything can reach Alpaca paper trading. It can move a supported idea forward, stop a weak one, and show the judge exactly how it reached that decision.
>
> During the competition, Finly combines a frozen four-ETF equity strategy with a separate SPY options agent. The equity sleeve follows one audited allocation rule. The options agent uses Qwen3-32B through Featherless to review current information and explain its view. Deterministic code—not the language model—sets the direction, position size, strikes, expiration, and maximum loss. Finly then removes sources, changes inputs, checks the payoff arithmetic and validates the broker fields. The final result is either a fully specified paper order or no trade at all.
>
> The quantitative case is concrete. In a cost-adjusted historical simulation from January 2013 through August 2026, the G4 strategy turned a modeled $10,000 into $106,711. SPY reached $68,082 over the same dates, a difference of $38,629 in ending wealth. Because that strategy was selected during research, we present the result as historical evidence rather than a promise about the next market session. We also tested a fixed industry version across 21,218 earlier market days. It produced a 3.89 percentage-point annualized advantage over the market, remained ahead under a 25-basis-point cost stress, and kept its advantage across all 21 monthly rebalance dates we tested.
>
> The options workflow is equally inspectable. In the public demonstration, Finly built a one-contract SPY debit spread with an exact $366 maximum loss and $634 maximum gain. The investment case survived all 4 source-removal checks and all 32 input perturbations before Finly produced an Alpaca-compatible paper-order plan. When the evidence conflicts, the same workflow stops before capital is exposed and publishes the reason.
>
> Finly now runs in the cloud against a dedicated, verified $100,000 Alpaca paper account. The runner uses Alpaca's official MCP server, keeps the trading code pinned to an audited Git revision, preserves restart state, and publishes a sanitized account and decision feed to the website. The public dashboard lets judges follow the account without exposing credentials or private broker identifiers.
>
> Open the live product, watch the competition account, and try both decision paths. Choose aligned evidence to see Finly prepare a defined-risk trade. Choose conflicting evidence to see it protect the account. Then open the decision record or repository and trace the result back to the code and source data.

**Technologies to select where available**

> Alpaca · Alpaca MCP · Featherless AI · Qwen3-32B · React · Vite · TypeScript · Node.js · Python · GitHub Actions

**Categories to select where available**

> AI Agents · Finance · Trading · Developer Tools

**Demo application platform**

> GitHub Pages

## Public links

- Live application: <https://owlsowo.github.io/finly-bot/>
- Repository: <https://github.com/owlsowo/finly-bot>
- One-page proposal: <https://owlsowo.github.io/finly-bot/judge/Finly_Judge_Brief.pdf>
- Technical paper: <https://owlsowo.github.io/finly-bot/judge/Finly_Technical_Proposal.pdf>
- Slide deck: <https://owlsowo.github.io/finly-bot/judge/Finly_Consulting_Deck.pdf>
- Demo video: <https://owlsowo.github.io/finly-bot/judge/Finly_Demo_Video.mp4>

Do not paste these URLs into the form until the final commit has been pushed and each public page has been opened in a signed-out browser session.

## Optional social-engagement drafts

Each post stands on its own. Attach the 1200×630 cover to the launch post and use a short product clip or chart for later posts. Recheck the organizer handles in the live form before publishing.

### Post 1 — launch

> We built Finly, an AI trading agent that can research a market idea without getting unchecked control of the account. In our cost-adjusted historical simulation, $10,000 became $106,711 versus $68,082 for SPY. Now Finly is running against a verified $100,000 Alpaca paper account, with every decision visible on the live dashboard. https://owlsowo.github.io/finly-bot/ @lablabai @AlpacaHQ

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
