# Public submission reproducibility landscape

**Source audit:** August 29, 2026 at 08:21 UTC. **Final roster refresh:** August 29, 2026 at 18:43 UTC. **Scope:** all 14 projects visible on the public [hackathon dashboard](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/live), each tied to the public repository revision recorded below. Pin Desk and AlphaGuard AI were the two additions since the source audit.

This is a neutral evidence-availability map, not a ranking, security review, profitability leaderboard, or prediction of judging outcomes. Missing P&L is **unknown, never zero**. A build, syntax check, test suite, scenario, or product demo does not by itself establish trading profitability.

The checked [Lablab event materials](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon) identify four current judging criteria: P&amp;L Performance, Technology Implementation, Creativity &amp; Originality, and Presentation &amp; Execution. No numerical weights were published in the checked materials, so this landscape does not invent a composite score.

## What the snapshot establishes

- Ten repositories supported at least one bounded credential-free check without broker or external-state mutation: eight checks passed at their stated level, one was partial, and one build did not complete.
- Three repositories were not run because the pinned artifact lacked implementation, the required runtime was unavailable, or no isolated non-mutating check was present. One repository remained metadata-only under the audit safety policy.
- None of the 14 public artifacts supplied a verified dedicated competition-account P&amp;L snapshot for this audit. Every competition P&amp;L cell is therefore `UNKNOWN`. Pin Desk's repository reports one paper round trip, but the broker read-back was not independently reproduced and a single trade is not a competition-account performance snapshot.
- None supplied the submitted strategy, point-in-time data, option-chain history, and execution assumptions needed for one truly common historical replay. No cross-project P&L was generated.

## Pinned provenance and bounded checks

“Pass” below means only that the listed check completed. Syntax and build results are deliberately labeled so they cannot be mistaken for strategy validation.

| Public submission | Pinned revision | Bounded local check | Submitted-strategy replay | Competition P&L |
|---|---|---|---|---|
| [VibeHedge](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/shinydatatech/vibehedge-autonomous-ai-options-hedging-agent) | [`eaf8f7a`](https://github.com/ShinyDataTech/VibeHedge/commit/eaf8f7a1715d043bd5eaae78bd4b9db9ca314284) | Pass: Python syntax only; model artifact not executed | Not available: no credential-free historical evaluator or shared option-chain history | Unknown |
| [Tissue Regeneration and Genetic Factor Navigator](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/tissulogic/tissue-regeneration-and-genetic-factor-navigator) | [`06637f9`](https://github.com/mahamtaqi3-cloud/Tissue-Regeneration-and-Genetic-Factor-Navigator/commit/06637f9e80301acda5ae09f18bc9568b1d544ca3) | Excluded: metadata only; source was not inspected or executed | Not assessed | Unknown |
| [Options Sniper](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/primehack-security-team/options-sniper-trading-agent) | [`eebc95a`](https://github.com/public321-ai/option-sniper/commit/eebc95a574d42287a2266fb2db678fcef645f190) | Pass: locked install with lifecycle scripts disabled, then production build | Not available: no credential-free historical evaluator or shared option-chain history | Unknown |
| [Pin Desk](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/gasbin/pin-desk) | [`292825c`](https://github.com/anujsuthar08/Pin-desk/commit/292825c37d2ca86843821e9119ecec4d4f9d2c5b) | Pass: Python syntax only; dependency tests and broker paths were not executed | Not available: no credential-free historical evaluator or recoverable historical open-interest series | Unknown |
| [AlphaGuard AI](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/alphaguard-ai/alphaguard-ai-autonomous-multi-agent-trading-desk) | [`8aea3ee`](https://github.com/devenramanuj/finpulse-ai/commit/8aea3ee99c31018bd8f736cde68cff36dd2b56de) | Pass: Python syntax only; no locked dependency manifest or economic evaluator | Not available: no historical evaluator or point-in-time dataset | Unknown |
| [A Continual Learning Agent](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/trueintrinsics-agent/a-continual-learning-agent) | [`08360a3`](https://github.com/atlas-jj/finance-trueintrinsics-public/commit/08360a32eb24f5d7301cb69207d71206ccb8dd0c) | Not run: no implementation at the pinned revision | Not available | Unknown |
| [Vega](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/isquividet/vega-autonomous-long-gamma-options-agent) | [`263da01`](https://github.com/isquividet/vega/commit/263da012325f46c00a0396e03c8d068c496d6531) | Pass: project evidence reconciliation; broker-dependent rows were not reproduced | Not available: modeled scenario is not a historical replay | Unknown |
| [Odysseus](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/odysseus/odysseus-ai-powered-strategy-research) | [`065a3d9`](https://github.com/thoonnadi2003/odysseus/commit/065a3d995e29762e5ba3ae706f1eb12e4ad64de0) | Not run: required .NET 10 runtime unavailable | Not available: no public real-market result | Unknown |
| [NewsFlow Trader](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/cubiczan/newsflow-trader) | [`36cfd8d`](https://github.com/icohangar-ops/newsflow-trader/commit/36cfd8dbf49f9228fe2f475c84db5cbae2719beb) | Not run: Bun unavailable and no isolated non-mutating check | Not available: no historical evaluator | Unknown |
| [AlphaSwarm Sovereign](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/intelliyash/alphaswarm-sovereign-capital) | [`564521d`](https://github.com/fokrulanthro16-eng/alphaswarm-sovereign/commit/564521dd933f111c5c13b922ad9afd249c573cc6) | Build did not complete after Python syntax and locked-install checks passed | Not available: modeled scenario is not a historical replay | Unknown |
| [AlphaPilot AI](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/quantum-coders/alphapilot-ai) | [`771edcb`](https://github.com/ibrahimjatt1313-prog/AlphaPilot/commit/771edcbb9fea3d383d90e6427c550689e15b0816) | Pass: Python syntax only; no dependency manifest | Not available: no credential-free replay entry point | Unknown |
| [SPY Sentinel AI](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/spy-sentinel-ai/spy-sentinel-ai) | [`efd7eda`](https://github.com/ajennings1974/SPY-Sentinel-AI/commit/efd7edab9b19f10e2a7de0d130e7e335ad262d50) | Pass: Python syntax only | Not available: signal study is not portfolio P&L and no locked credential-free replay was present | Unknown |
| [BABIL](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/babil/babil-human-in-the-loop-ai-options-trading-agent) | [`9080b2a`](https://github.com/TAKA2SEA/babil-alpaca-hackathon-2026/commit/9080b2a0d695bc5f733dc064926af7883a243441) | Partial: static check passed; one credential-free product test failed | Not available: no historical options evaluator or shared option-chain history | Unknown |
| [AEGIS-Q](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/team-v/aegis-q) | [`76bb97e`](https://github.com/VicensPaneque/aegis-q/commit/76bb97e9200c41c519440bb64ea40d2161367627) | Pass: credential-free tests and deterministic options demo | Not available: historical result covers a different legacy equity strategy | Unknown |

The machine-readable [landscape manifest](../evidence/competitor_benchmark.json) records the exact commands, reason codes, data-window availability, baselines, and cost assumptions behind this table.

## Why a common historical replay was not run

A fair replay needs the same timestamped signal/position contract, point-in-time dataset, option-chain history, capital base, execution lag, fee/spread/impact model, and baseline. The public submissions do not share those inputs. Several are product interfaces or research systems rather than exportable strategies; several require unavailable runtimes or external services; and one was intentionally excluded from source inspection.

One repository includes a historical result for a legacy equity-regime strategy. Its window is May 12, 2021 through August 27, 2026, its baseline is QQQ buy-and-hold, and it assumes 5 bp one-way slippage with signal-at-close/next-open execution. Because that is not the submitted options policy, it is context only—not submitted-strategy P&L and not a common benchmark result. Pin Desk separately reports a single paper round trip with a net loss of $5.20; this audit did not reproduce its broker evidence, and one round trip is not a strategy P&L series or common benchmark. Other committed artifacts include modeled scenarios, synthetic demonstrations, or signal studies; the manifest labels each rather than converting it into portfolio P&L.

Building adapters or substituting market data would create new strategies on behalf of teams. The audit therefore records `NOT_RUN` and produces no comparative return, Sharpe, drawdown, or P&L table.

## Finly comparison boundary

Finly is not ranked here and was not cross-project backtested. Its locked G4 evidence is a consumed adjusted-close ETF replay from January 2, 2013 through August 27, 2026. Under modeled 5 bp one-way costs, G4 recorded 18.97% annualized return versus 15.11% for SPY and a shallower maximum drawdown of -28.99% versus -33.72%. G4 was selected after viewing history and failed promotion; the replay is descriptive only, not options P&amp;L and not a forecast. It cannot support claims that Finly beat another submission, has verified competition-account profit, or proved options profitability. Finly's competition-account P&amp;L remains **unknown** until a dedicated account artifact and broker read-back are captured.

## Reproduction and safety

Run `npm run competitor:check` to validate project count, unique pinned SHAs, status taxonomy, complete unknown-P&L fields, common-replay boundaries, Finly's source-artifact pin, public-report coverage, and secret-pattern exclusions. This checker validates the published record; it does not clone or execute competitor repositories.
