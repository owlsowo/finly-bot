# Finly: From Market Evidence to a Checked Alpaca Paper Order

## A frozen equity sleeve, a defined-risk options workflow, and a live $100,000 paper account

Bruce Wen · Brandeis University · [bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)

31 August 2026

## Abstract

Finly is an AI-assisted trading system built for the Alpaca paper-trading environment. It combines a frozen four-ETF momentum allocation with a separate SPY options workflow. The language model has a useful but deliberately limited task: it reads current public news, describes the evidence in a structured response, and may stop an options proposal. Deterministic code owns the economic direction, position size, contract selection, payoff calculation, broker fields, and final permit. Every permitted order is accompanied by a receipt that ties the evidence and risk calculation to the intended broker payload.

The equity rule, called G4, was developed in a retrospective 2013–2026 study. With a modeled one-way cost of five basis points, it turned $10,000 into $106,711, compared with $68,082 for SPY. A fixed industry-portfolio proxy was then replayed on 21,218 earlier trading days from Kenneth French's public archive; it annualized at 13.37 percent against 9.48 percent for the market and retained a 2.45-percentage-point net-log-growth advantage under a twenty-five-basis-point cost stress. The research gate treated that upside as a reason to test G4, not to promote it statistically: a human operator froze the dated competition allocation, and a separate scorer measures the $100,000 paper account against its baseline and contemporaneous SPY. The options demonstration produced a SPY debit spread with an exact $366 maximum loss and $634 maximum gain, and passed four source-removal checks and thirty-two input perturbations. The live system uses Alpaca's official MCP server, encrypted restart state, broker read-back, and a sanitized dashboard. A public test run contains 806 automated tests: 804 passed and two were skipped.

## 1. What we built

Trading systems often ask a single component to perform several unlike tasks. It reads a report, decides what the report means, selects an exposure, chooses an instrument, and sends an order. The apparent simplicity is misleading. An error in interpretation is not the same as an error in sizing, and neither should silently alter the fields that reach a broker.

Finly separates those tasks. A frozen G4 equity sleeve supplies the competition's initial allocation. A separate SPY options workflow admits only defined-risk debit spreads. The language model interprets a small set of public news, while code checks data quality, economic intent, payoff, liquidity, account limits, and order construction. A short-lived permit and receipt connect one reviewed decision to one exact order. A restartable Alpaca paper-trading runner records the intent, submits conservatively, and reconciles the result against broker state.

This design does not treat the model as decoration. Its assessment can prevent a proposal from advancing when the evidence is unclear or inconsistent. But the model cannot turn confidence into additional contracts, substitute a different option, widen a loss bound, or manufacture permission. Its influence is interpretive; the code remains responsible for the financial commitment.

## 2. The frozen G4 equity sleeve

### 2.1 Rule

G4 is a transparent momentum allocation over QQQ and the original nine Select Sector SPDR funds. On each twenty-one-session rebalance date, it assigns half of the risky allocation to QQQ. It ranks the sector funds by twelve-to-six-month momentum, where m_i(t) = log(P_i(t−126) / P_i(t−252)), and divides the remaining half equally among the three highest-ranked sectors. The six-month gap reduces the influence of the most recent part of the return path, while QQQ remains the stable core. This is a relative momentum rule rather than a discretionary market forecast. The broader literature on trend and momentum supplies context for the design, but it does not validate this particular specification [1].

For the competition, the final signal used Alpaca Market Data API bars from the IEX feed, adjusted for corporate actions, through the session of 28 August 2026. The signal retained the required 253 sessions, selected XLB, XLE, and XLV, and was frozen before the competition window [2]. The dedicated paper account preserves three percent in cash. The submitted target is 48.5 percent QQQ and 16.1667 percent in each of XLB, XLE, and XLV, leaving three percent as the operating reserve.

The human-selected competition protocol fixes a $100,000 baseline, a single initial rebalance, and no in-contest re-optimization. It also fixes the signal session, data source, target notionals, paper endpoint, MCP version, order method, client-order identifiers, and hashes of the governing artifacts [3]. The allocation is thus a known object before its separately measured forward result is observed.

### 2.2 Historical evidence

The principal historical replay covers 2 January 2013 through 27 August 2026. With five basis points of modeled one-way trading cost, G4 returned 967.11 percent and SPY returned 580.82 percent. Expressed as terminal wealth, $10,000 became $106,711 under G4 and $68,082 under SPY, a difference of $38,629 [4]. The same public evidence package contains the wealth and drawdown series used in the presentation [5].

These are retrospective results. G4 was selected during the research process, and the final specification benefited from observing the ETF-era sample. The return difference is economically interesting, but it is not an unbiased estimate of future excess return. The release gate therefore preserves it as a precise report of a modeled past under stated cost assumptions, without granting statistical promotion.

We therefore performed a separate, fixed-form reproduction on an earlier public dataset. Ten value-weighted U.S. industry portfolios from Kenneth French's Data Library supplied an external industry proxy rather than the modern ETFs themselves [6]. The replay covers 7 May 1927 through 29 May 2007, or 21,218 trading days, and uses the same base five-basis-point cost convention. The proxy produced 13.37 percent annualized growth against 9.48 percent for the market, a 3.89-percentage-point difference. Its advantage was positive at all twenty-one monthly anchors. Under a twenty-five-basis-point cost stress, the net-log-growth advantage remained 2.45 percentage points, and the maximum drawdown was 16.31 percentage points shallower than the market proxy [7].

This earlier study answers a narrower question: whether a fixed industry version of the rule also exhibited useful behavior in a long, separate historical era. The instruments are proxies, the execution remains modeled, and the data are still historical. It strengthens the robustness case without turning either replay into a live performance record.

## 3. The SPY options workflow

### 3.1 From evidence to an economic intent

The options component trades only SPY and admits three outcomes: a bull-call debit spread, a bear-put debit spread, or no trade. Its inputs are time-stamped and typed. They include market observations, option-chain information, event evidence, public news, and a small prediction-market contribution. Each source has an explicit role and weight; repeated prose cannot substitute for price or options evidence.

The language model is Qwen3-32B, hosted through Featherless. It receives only canonical public Alpaca news. It does not receive account identifiers, broker credentials, buying power, compiler internals, private risk state, or a prepared order. Inference uses a fixed temperature of zero, disables the model's extended thinking mode, and requires a JSON response that matches a strict schema [8]. The response can describe support, conflict, uncertainty, and relevance. It can stop the proposal. It cannot choose the direction or the financial terms.

Code combines the admissible evidence into the direction and strength of the candidate view. It then searches for a vertical debit spread subject to the current policy: three to fourteen days to expiry, quote-age limits, maximum relative spread, minimum open interest, minimum modeled probability of profit, minimum reward-to-risk, and minimum expected value. Position size is bounded by one half of one percent of account equity, reduced to one quarter percent for a half-risk decision, capped at $500 of maximum loss per trade, limited to four contracts, and further constrained by a three-percent aggregate options-risk ceiling [9].

### 3.2 Payoff and perturbation checks

A vertical debit spread has a finite payoff that can be checked without relying on a model's prose. For a one-contract spread with strike width W dollars and debit D dollars per share, maximum loss equals 100D, while maximum gain equals 100(W−D).

Finly recomputes these quantities from the selected legs and verifies them again against the broker-shaped order. The demonstration receipt describes a SPY debit spread with a $3.66 debit and a $10 strike width: maximum loss is therefore $366 and maximum gain is $634 [10]. This is a synthetic fixture designed to expose the complete decision path. It is not presented as a broker fill.

The same fixture was subjected to four source-removal checks and thirty-two perturbations of its material inputs. Source removal asks whether any individual evidence family has been allowed to carry more authority than the design permits. Perturbation testing changes inputs around their admissible boundaries and checks that payoff, sizing, and permission remain consistent. All four removal checks and all thirty-two perturbations passed [10]. The test does not show that the market view will be correct; it shows that the safety properties do not depend on one convenient input arrangement.

### 3.3 A permit tied to one order

Once the evidence, intent, spread, and account checks agree, the system issues a permit valid for thirty seconds. A final preflight must be no more than fifteen seconds old. Entry is stopped if the debit has moved by more than $0.10 or the underlying has moved by more than 0.5 percent from the reviewed state. The account must have the required options level and retain at least twenty-five percent buying power after the proposed trade [9].

The permit is not a general approval to trade SPY. It binds hashes and structured fields for the particular evidence record, economic intent, risk calculation, option legs, and broker payload. If a material field changes, the binding no longer matches and a new decision is required. In Finly, permission is specific: the approved order can proceed only while the checked evidence, risk calculation, and order fields still match.

## 4. Live Alpaca paper implementation

### 4.1 Official account and broker path

Finly runs against a dedicated Alpaca paper account with a verified starting equity of $100,000. The pre-open public snapshot records the account as ready, flat, and fully in cash, with no secret or raw account identifier exposed [11]. Broker access uses Alpaca's official open-source MCP server, pinned at version 2.2.1, and the G4 sleeve uses its stock-order method against the paper endpoint [3,12]. The competition window begins at 09:30 Eastern time on 31 August 2026. The frozen G4 sleeve begins its single initial rebalance at that opening; a pre-open ready state is not reported as a fill.

Before submission, the runner verifies the expected account identity, the untouched $100,000 baseline, market-open status, available buying power, and that each asset is active, tradable, and fractionable. It constructs exact notional market-day orders: $48,500 for QQQ and approximately $16,166.67 for each of XLB, XLE, and XLV. Deterministic client-order identifiers make each intended order recoverable.

### 4.2 Conservative progression and restart safety

The cloud runner makes at most one order-changing broker call in a cycle. It first writes the intended action to durable private state, then checkpoints that state, makes the MCP call, and reads the result back from Alpaca. If the submission acknowledgement is lost, the next cycle searches by the deterministic client-order identifier before it can consider another order. This ordering is meant to prevent an uncertain network result from becoming a duplicate trade.

After the four target positions exist, the runner reconciles symbols, position values, cash reserve, and notional tolerance. The options workflow remains gated until this equity state is ready. The same principle applies to subsequent options entries and exits: local intention is not treated as broker fact until read-back agrees [8].

The runner is scheduled through GitHub Actions, but in-process time checks—not the scheduler's punctuality—govern when action is permitted. Each cycle restores encrypted state, checks its pinned revision and contract, progresses conservatively, and publishes a sanitized status record. Private state uses AES-256-GCM encryption and is stored separately from the public dashboard. The model sees only public evidence, while account credentials remain in the runner's secret environment [8].

### 4.3 Forward measurement

The forward-profit contract was frozen before the competition window. Its primary measure is the verified paper-account equity minus the exact $100,000 baseline, using the broker's marked equity and reflected charges. Its secondary measure compares Finly with SPY at an exact common timestamp using regular-hours, raw, one-minute Alpaca IEX prices and no forward filling [13]. The scorer is GET-only: it reads account, calendar, order, activity, and market-data records but cannot mutate the account.

The contract also treats attribution as part of measurement. It checks the complete activity interval, rejects unexplained deposits or withdrawals, verifies order provenance for counted fills, and publishes only aggregate sanitized output. These rules matter because a paper-account gain is not informative if an outside cash flow, an earlier order, or a mismatched timestamp can enter the calculation. At the time of writing, the live window has not yet produced a result. The contract states how that result will be computed once broker observations exist.

## 5. Verification

The public repository includes unit, integration, fixture, contract, and workflow tests. The current public run executed 806 automated tests: 804 passed, none failed, and two were skipped [14]. The suite covers G4 signal reproduction and weight construction; baseline, account, asset, cash-reserve, and market-session checks; deterministic order identities and lost-acknowledgement recovery; option payoff arithmetic, risk ceilings, quote freshness, and broker-field translation; the boundary between public model input and private account state; source-removal and thirty-two-case input checks; encrypted checkpoints and restart behavior; and the calendar, timestamps, activity, provenance, and valuation rules used by the forward scorer.

Passing tests do not prove profitability, nor can fixtures reproduce every broker or market condition. They do establish that the published numerical and operational contracts are executable rather than merely described.

## 6. Limitations

Finly has four principal limitations. First, G4 was chosen during research. The 2013–2026 replay is consequently exposed to selection and backtest overfitting; the earlier industry study is supportive evidence, not an independent proof of expected return [15,16]. Second, both historical studies depend on modeled prices and costs. They do not reproduce queue priority, partial fills, spread changes, halts, or every corporate-action edge case.

Third, the options receipt is a controlled demonstration. Its exact payoff and safety checks are real properties of the compiled fixture, but it contains no live options profit and loss. A successful compilation says that the proposed loss is bounded and the order is internally coherent; it does not say that the directional forecast is correct.

Fourth, paper trading differs from deployment with real capital. Alpaca paper trading is the appropriate environment for testing order semantics and operational state, but simulated fills cannot establish live-market execution quality [17]. The competition account will provide forward paper observations over a short interval. Those observations will be useful and public, but the interval is too brief to settle long-run performance.

These limitations shape the claims rather than nullify the project. Finly has built a complete path from public evidence to a defined-risk, reviewable paper order; it has not built a guarantee of return. The frozen strategy and forward scorer are intended to keep that distinction intact after the results become known.

## 7. Conclusion

Finly joins three things that are often shown separately: a quantitative rule, an AI interpretation, and a broker implementation. The G4 sleeve supplies a fixed and reproducible equity allocation. The SPY options workflow lets a language model examine current public news while deterministic code retains the terms that create loss. The Alpaca runner gives each intended action durable state, a unique identity, a broker read-back, and a public sanitized record.

The historical evidence gives a concrete reason to test the system: G4's ETF-era replay substantially exceeded SPY, and its fixed external-era proxy retained an advantage across a much earlier dataset and a severe cost stress. The engineering evidence gives a concrete reason to trust the test: the competition rule was frozen, the account begins from a verified $100,000 baseline, the model cannot alter exposure, and 806 automated tests exercise the published boundaries. The live result remains to be observed. Finly's purpose is to observe it without changing the rule, confusing a simulation with a fill, or asking an eloquent model to carry authority that belongs in checked code.

## References

[1] T. J. Moskowitz, Y. H. Ooi, and L. H. Pedersen. “Time Series Momentum.” *Journal of Financial Economics* 104, no. 2 (2012): 228–250. [doi:10.1016/j.jfineco.2011.11.003](https://doi.org/10.1016/j.jfineco.2011.11.003).

[2] Finly. “Frozen G4 Source Signal.” [config/g4-official-source-signal.json](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/config/g4-official-source-signal.json).

[3] Finly. “Frozen G4 Competition Protocol.” [config/g4-official-production.json](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/config/g4-official-production.json).

[4] Finly. “Quantitative Release Gate.” [research/output/quantitative_release_gate.json](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/research/output/quantitative_release_gate.json).

[5] Finly. “G4 Wealth and Drawdown Series.” [public/data/g4_wealth_drawdown.json](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/public/data/g4_wealth_drawdown.json).

[6] Kenneth R. French. [Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html).

[7] Finly. “External-Era Public Evidence.” [public/data/attempt150_public_evidence.json](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/public/data/attempt150_public_evidence.json).

[8] Finly. “Cloud Runner and Restart Design.” [docs/CLOUD_RUNNER.md](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/docs/CLOUD_RUNNER.md).

[9] Finly. “Options Policy.” [lib/policy.mjs](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/lib/policy.mjs).

[10] Finly. “Latest Options Decision Receipt.” [public/data/latest_receipt.json](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/public/data/latest_receipt.json).

[11] Finly. “Sanitized Competition Account Snapshot.” [public/data/competition_live.json](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/public/data/competition_live.json).

[12] Alpaca. “MCP Server.” Official documentation. [docs.alpaca.markets/docs/mcp-server](https://docs.alpaca.markets/docs/mcp-server).

[13] Finly. “Competition Forward-Profit Contract.” [config/competition-forward-profit.json](https://github.com/owlsowo/finly-bot/blob/e54f7f4bd20ca30aabfe610fabbb743e5006b797/config/competition-forward-profit.json).

[14] Finly. “Public Automated-Test Run.” [GitHub Actions run 33369848292](https://github.com/owlsowo/finly-bot/actions/runs/33369848292).

[15] H. White. “A Reality Check for Data Snooping.” *Econometrica* 68, no. 5 (2000): 1097–1126. [doi:10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152).

[16] D. H. Bailey and M. López de Prado. “The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality.” *Journal of Portfolio Management* 40, no. 5 (2014): 94–107. [doi:10.3905/jpm.2014.40.5.094](https://doi.org/10.3905/jpm.2014.40.5.094).

[17] Alpaca. “Paper Trading.” Official documentation. [docs.alpaca.markets/docs/paper-trading](https://docs.alpaca.markets/docs/paper-trading).
