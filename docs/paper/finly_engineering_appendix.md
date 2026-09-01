# Finly: Controlled Delegation for an Alpaca Trading Agent

## A frozen equity sleeve, a reduction-only news model, a deterministic options compiler, and restart-safe paper execution

Bruce Wen · Brandeis University · [bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)

31 August 2026

## Abstract

Finly is an AI-assisted trading system built for the Alpaca paper-trading environment. Its design begins from a narrow observation: interpreting information and authorizing financial risk are different jobs. A language model may be useful for reading current public news, but it should not silently acquire the authority to choose an instrument, enlarge a position, alter a loss bound, or manufacture a broker order. Finly therefore separates model judgment from capital-bearing decisions and records the boundary in machine-checkable artifacts.

The system has two execution branches. The first is G4, a frozen four-ETF competition sleeve. G4 assigns one half of its research allocation to QQQ and divides the other half among the three strongest original Select Sector SPDR funds under a twelve-to-six-month relative-momentum rule. The competition deployment scales that allocation to 97 percent, preserves a 3 percent cash reserve, and performs one initial rebalance without in-contest re-optimization. In a consumed, post-selected simulation from 2 January 2013 through 27 August 2026, with modeled one-way costs of five basis points, G4 returned 967.11 percent while SPY returned 580.82 percent. The result is economically large but did not pass Finly's promotion gate: its Deflated Sharpe probability was 3.75 percent, its worst familywise-adjusted bootstrap p-value was 37.18 percent, it did not consistently beat a static SPY/QQQ growth control, and the frozen Yahoo-versus-Alpaca source reconciliation failed closed.

The second branch is a SPY options agent. A separate long-only SPY/BIL policy supplies a bounded bullish direction or no-trade authority. Deterministic market and option-surface evidence must confirm that direction. Qwen3-32B, hosted through Featherless, sees only canonical public Alpaca news and is reduction-only: supportive prose cannot increase exposure, while adverse evidence may reduce or veto a proposal. Code enumerates defined-risk vertical debit spreads, evaluates two 2,048-path scenario models, applies conservative expected-value and probability gates, sizes maximum loss, and issues a thirty-second HMAC-signed risk certificate bound to one exact order projection. Alpaca execution proceeds through a durable state machine, deterministic client-order identifiers, pre-mutation checkpoints, broker read-back, and fail-closed reconciliation.

This paper specifies the algorithms, causal timing, cost conventions, statistical tests, risk constraints, state transitions, and reproducibility boundary. At the first closing bell, Finly was up $95.32 while the same-$100,000 SPY raw-price benchmark was down $57.99, a $153.31 advantage at one exact timestamp. The evidence supports an inspectable paper-trading experiment, not durable alpha, verified live options profit, or future outperformance.

## 1. Problem, scope, and contributions

Trading-agent demonstrations often collapse a chain of unlike decisions into one prompt. A model reads a report, states a view, chooses a product, chooses a size, and emits something shaped like an order. That sequence is attractive on screen because it is short. It is also difficult to audit. A mistaken interpretation, a stale quote, a sizing error, and a duplicated broker mutation have different causes and require different controls.

Finly treats the agent as a controlled pipeline rather than a single oracle. The project makes four contributions.

1. **A two-branch quantitative design.** G4 is a frozen equity allocation used for the time-bounded competition account. The options overlay has a separate SPY/BIL economic authority and does not infer its direction from the G4 backtest.
2. **Reduction-only model authority.** The hosted model extracts bounded scores and rationales from canonical public news. It cannot amplify the deterministic direction, choose an option, choose quantity, access account secrets, or authorize a broker mutation.
3. **A deterministic compiler and permit.** Typed evidence becomes a checked intent; an enumerator constructs vertical spreads; two scenario models evaluate them; fixed gates select at most one candidate; and an HMAC-signed certificate binds evidence, policy, risk, account, market, candidate, quantity, and order projection.
4. **Restart-safe Alpaca execution.** The cloud runner persists intent before mutation, advances at most one broker-changing step per cycle, assigns deterministic client-order identifiers, reconciles ambiguous acknowledgements, and publishes only sanitized status.

Research, synthetic demonstration, paper authorization, and broker observation are distinct. A replay is not a fill, a fixture is not an executable permit, and a paper fill is not real-capital execution. Tests establish software behavior, not forecast accuracy [1–7].

## 2. Architecture and authority

Finly has two independent paths that meet at the same paper account and measurement layer.

~~~text
Historical adjusted closes
        │
        ├── G4 research rule ── frozen 2026-08-28 signal
        │                         │
        │                         └── one-time QQQ/XLB/XLE/XLV plan
        │                                      │
        │                              signed equity state machine
        │                                      │
        │                              Alpaca MCP stock orders
        │
Alpaca SPY/BIL bars ── deterministic economic policy ── bullish cap / NO_TRADE
Alpaca SPY market ───── deterministic market score ───────────────┐
Alpaca option chain ─── deterministic option-surface score ──────┤
Alpaca public news ──── Qwen structured assessment ── reduce/veto┤
                                                                  ▼
                                                    checked economic intent
                                                                  │
                                     enumerate and value SPY vertical spreads
                                                                  │
                              source-removal + 32-case perturbation challenge
                                                                  │
                                     HMAC risk certificate + fresh preflight
                                                                  │
                                             Alpaca MCP multi-leg paper order

Both branches ── broker read-back ── encrypted state ── sanitized feed/scorer
~~~

| Component | May decide | May not decide |
| --- | --- | --- |
| G4 research rule | Ranked sectors and research weights | Options, credentials, or discretionary overrides |
| Frozen competition protocol | Dated one-time allocation and 3% reserve | In-contest re-optimization |
| SPY/BIL economic policy | Maximum long-only SPY weight or no trade | Contract, quantity, or broker payload |
| Qwen news assessor | Bounded event scores and rationales | Direction amplification, contract, size, credentials, mutation |
| Deterministic compiler | Eligible spread and order-independent risk | Broker submission |
| Certificate and preflight | Permit or no trade for one projection | General permission to trade |
| Alpaca executor | Submit or reconcile the bound paper order | Change certified economics |

The threat model assumes public text can be misleading, duplicated, stale, or adversarial; reads can fail; acknowledgements can be lost after acceptance; scheduled jobs can begin late; and state can be modified. Historical prices, paper fills, and a short competition window are not treated as proof of long-run alpha.

## 3. The frozen G4 equity sleeve

### 3.1 Research rule

G4 operates on QQQ, BIL as the simulator's cash symbol, and the original nine Select Sector SPDR funds: XLB, XLE, XLF, XLI, XLK, XLP, XLU, XLV, and XLY. On each eligible twenty-one-session signal date it computes twelve-to-six-month momentum:

$$
m_s(t) = ln[P_s(t−126) / P_s(t−252)].
$$

The six-month gap excludes the most recent 126 sessions from the ranking interval. The strategy sorts sectors by descending m_s(t), breaks an exact tie alphabetically, chooses the first three, assigns 50 percent to QQQ, and assigns one sixth to each selected sector. All remaining weights are zero. It is long-only with risky gross exposure capped at one [8].

~~~text
Algorithm 1: G4 research allocation

Inputs:
  adjusted closes P for QQQ, BIL, and nine sector funds
  lookback L = 252 sessions
  gap endpoint G = 126 sessions
  rebalance interval R = 21 sessions
  anchor a in {0, …, 20}

Initialize the portfolio in BIL.

For each eligible signal close t:
  If (t − L − a) mod R = 0:
    For each sector s:
      momentum[s] ← ln(P[s,t−G] / P[s,t−L])
    selected ← top three by descending momentum,
                then ascending symbol for exact ties
    target[QQQ] ← 0.50
    target[s] ← 1/6 for each selected sector
    target[all other risky symbols] ← 0
    target[BIL] ← 0
  Else:
    retain the drifted portfolio

  Queue a new target at close t.
  Execute it at close t+1.
  First earn its return from close t+1 to close t+2.
~~~

The momentum literature motivates delayed trend measurement but does not validate this universe, lookback, gap, or core weight [9]. G4 was selected after substantial research on the available ETF history and is post-selected.

### 3.2 Competition transform

The competition signal is distinct from a recurring G4 backtest. Alpaca IEX adjustment-all daily bars through 28 August 2026 supplied 253 retained sessions and selected XLB, XLE, and XLV [2]. The protocol scaled research weights by 0.97:

$$
w_QQQ = 0.97 × 0.50 = 0.485; w_XLB = w_XLE = w_XLV = 0.97 × (1/6) = 0.1616667; w_cash = 0.03.
$$

For the exact $100,000 baseline, target notionals are $48,500 for QQQ and approximately $16,166.67 for each sector. The protocol fixes the signal session, source, adjustment, targets, paper endpoint, MCP version, order method, identifier namespace, and artifact hashes. It authorizes one initial rebalance and no in-contest re-optimization [3]. A human chose this dated research candidate for the competition; the live account is its forward observation, not a continuation of the backtest.

## 4. Causal simulation and benchmark methodology

### 4.1 Data and timing

The headline G4 replay uses a hash-pinned panel of Yahoo Finance adjusted closes. The runner retained aligned sessions and did not impute unavailable 28 August 2026 adjusted-close rows, so the uniform panel ends on 27 August [4,5]. The competition signal was reproduced separately from Alpaca IEX bars. A provider-overlap experiment later failed its strict reconciliation gate; the two sources must not be described as equivalent [6].

A decision formed with observations through close t is queued at t, executes at close t+1, and first earns the return from t+1 to t+2. Two later closes must exist before a signal is eligible. This prevents the close used to form a rank from also earning the return into that close.

Let w*ᵢ(t) be a queued target, w⁻ᵢ(t+1) the drifted holding immediately before execution, and Rᵢ(t+1,t+2) the subsequent return. One-way turnover and cost are

$$
τ(t+1) = Σᵢ |w*ᵢ(t) − w⁻ᵢ(t+1)|; C(t+1) = τ(t+1) × b / 10,000.
$$

Gross and net returns are

$$
g(t+2) = Σᵢ wᵢ(t+1)Rᵢ(t+1,t+2); r(t+2) = g(t+2) − C(t+1) − max[0, −w_BIL(t+1)]s_borrow/252.
$$

G4 is unlevered, so financing cost is zero. Holdings then drift:

$$
w⁻ᵢ(t+2) = wᵢ(t+1)[1 + Rᵢ(t+1,t+2)] / [1 + g(t+2)].
$$

Every standalone date slice is rebased from cash. Its first row is charged entry from BIL and its last row is charged terminal liquidation. SPY buy-and-hold receives the identical panel, lag, entry, and terminal-cost treatment [5].

### 4.2 Metrics and partitions

For n sessions and initial wealth V₀,

$$
V_n = V₀ Πₜ[1 + r(t)]; Annualized return = (V_n/V₀)^(252/n) − 1; Annualized volatility = √252 × sample standard deviation[r(t)].
$$

$$
Cash-excess Sharpe = √252 × mean[r(t) − r_BIL(t)] / sample standard deviation[r(t) − r_BIL(t)]; Maximum drawdown = minₜ {V(t)/maxᵤ≤ₜ[V(u)] − 1}.
$$

Five-percent daily expected shortfall averages observations at or below the empirical fifth percentile. These ledger metrics are not probabilities of future profit.

The robustness protocol reports development from 2 June 2008 through 29 December 2017, validation from 2 January 2018 through 31 December 2024, and a consumed recent diagnostic from 2 January 2025 through 28 August 2026. Validation was observed during selection and the recent interval was consumed by a safety veto. No pristine holdout remained [6].

Comparators included SPY, QQQ, the lower-volatility frozen Finly policy, a 15-percent-volatility SPY target, and a static 50/50 SPY/QQQ control. That static control is necessary because half of G4 is always QQQ; sector rotation that cannot consistently beat a simple growth tilt cannot establish independent sector-selection alpha.

## 5. Historical evidence and statistical audit

### 5.1 ETF-era result

The release gate permits one precise headline. In the consumed, post-selected 2 January 2013 through 27 August 2026 replay, with five basis points of modeled one-way cost, G4 returned 967.11 percent and SPY returned 580.82 percent [4].

| Modeled $10,000 investment | Total return | Ending wealth |
| --- | ---: | ---: |
| G4 | +967.11% | $106,711 |
| SPY, identical panel and cost convention | +580.82% | $68,082 |
| Historical ending-wealth difference | — | $38,629 |

The public wealth and drawdown series permit chart reproduction [7]. These values accurately report the frozen ledger under its assumptions. They are not an unbiased estimate of expected excess return.

### 5.2 Robustness that passed

The raw SPY edge stayed positive at five, ten, and twenty-five basis points. The schedule experiment tested every possible offset of the twenty-one-session cycle. These are sensitivity variants, not independent samples.

| Annualized net-log-growth edge over SPY | Minimum | Median | Maximum | Positive offsets |
| --- | ---: | ---: | ---: | ---: |
| Development, 2008–2017 | 1.17 pp | 1.79 pp | 3.32 pp | 21/21 |
| Validation, 2018–2024 | 2.28 pp | 2.96 pp | 4.40 pp | 21/21 |

Thus the result is not explained by one convenient rebalance weekday. This is useful falsification evidence, but it does not correct strategy search or establish independence from growth exposure.

### 5.3 Deflated Sharpe and familywise tests

For candidate j and SPY on the same validation row,

$$
Δⱼ(t) = rⱼ(t) − r_SPY(t); Tⱼ = √n × mean[Δⱼ(t)].
$$

The Deflated Sharpe calculation uses paired-return skewness, Pearson kurtosis, and a declared cumulative trial count of 100. G4's annualized paired Sharpe was 0.8614 while the trial-adjusted benchmark was 1.5330. The estimated probability that the observed Sharpe exceeded the deflated benchmark was 0.03748, below the frozen 0.95 gate [6,10].

The White-style maximum-statistic bootstrap centers candidate-minus-SPY returns under the null. Each iteration applies one shared index path to all seven candidate series. For iteration b,

$$
Tᵐᵃˣ(b) = maxⱼ {√n × mean[Δ⁰ⱼ,b(t)]}; p_FWER = [1 + count(Tᵐᵃˣ(b) ≥ T_G4)] / (B + 1).
$$

The protocol freezes B = 2,000 iterations for circular and moving blocks of 5, 20, and 60 sessions. Unadjusted fixed-candidate p-values were approximately 0.0045 to 0.0090, but familywise p-values were roughly 0.30 to 0.37. The worst was 0.371814; all six failed the five-percent gate.

| Promotion gate | Threshold | Observed | Result |
| --- | ---: | ---: | --- |
| Deflated Sharpe probability | ≥ 95% | 3.75% | Fail |
| All six familywise p-values | ≤ 5% | Worst 37.18% | Fail |
| SPY edge at 5/10/25 bp | Positive at all costs | Positive | Pass |
| Edge at all 21 offsets | Positive in development and validation | 21/21, 21/21 | Pass |
| Consistency above static 50/50 SPY/QQQ | Frozen rolling-window rule | Not consistent | Fail |
| Authenticated source overlap | Every used symbol passes | Fail-closed | Fail |

The disposition is “retrospective raw-return evidence; not statistically promoted.” It motivates a dated experiment, not future-profit language [33,34].

### 5.4 Earlier industry proxy

A separate fixed replay uses Kenneth French's value-weighted ten-industry daily portfolios. The primary window spans 7 May 1927 through 29 May 2007, 21,218 observations, outside the modern ETF-era overlap. These are industry portfolios, not tradable QQQ and SPDR shares, so the exercise tests the shape of an industry-momentum proxy [11,12].

| 1927–2007 modeled comparison | Finly proxy | Market proxy |
| --- | ---: | ---: |
| Annualized return | 13.37% | 9.48% |
| Cash-excess Sharpe | 0.573 | 0.429 |
| Maximum drawdown | −67.76% | −84.07% |
| Annualized net-log-growth advantage | 3.49 pp | — |

All twenty-one offsets retained a positive edge. The edge remained 2.45 percentage points at a twenty-five-basis-point cost, and maximum drawdown was 16.31 percentage points shallower. A volatility-matched market comparison still left a 2.17-percentage-point net-log-growth advantage.

Five of seven complete decades were positive. A nominal one-sided bootstrap p-value of 0.0024 became 0.4824 after Bonferroni adjustment for 201 global trials:

$$
p_adjusted = min(1, 201 × 0.0024) = 0.4824.
$$

The Deflated Sharpe probability was 0.7182. Eight of nine precommitted gates passed, but the overall statistical gate failed. This supplies cross-era economic evidence, not independent proof of durable alpha.

## 6. The separate SPY/BIL economic authority

G4 chooses the competition equity sleeve; it does not authorize options. The options branch uses a frozen long-only SPY/BIL policy called tsmom_ensemble_vol [13,14].

For h in {21, 63, 252}, it computes SPY's excess log trend:

$$
x_h(t) = ln[SPY(t)/SPY(t−h)] − ln[BIL(t)/BIL(t−h)].
$$

Let q(t) be the fraction of positive trends and σ₂₀(t) the annualized sample volatility of twenty SPY daily returns:

$$
q(t) = (1/3) Σ_h I[x_h(t) > 0]; v(t) = min[1, 0.10/σ₂₀(t)]; w_SPY(t) = q(t)v(t); w_BIL(t) = 1 − w_SPY(t).
$$

The policy is unlevered, never shorts, and proposes a rebalance every five completed sessions. A daily bar becomes eligible only after regular close plus fifteen minutes, and SPY/BIL sessions must align. In research, a close-t signal executes at t+1 and first earns t+1-to-t+2 returns. In deployment it produces a hashed economic receipt and does not mutate the broker.

In the separate 2 January 2025 through 28 August 2026 execution-realism artifact, it returned 15.39 percent at five basis points per traded leg and 10.56 percent at twenty-five basis points, versus SPY's 33.52 percent. At five basis points it had 8.12 percent modeled annualized volatility and −5.45 percent maximum drawdown. It was risk-controlled, not market-beating on total return [4].

For an options entry, the guard requires a fresh rebalance proposal and at least 50 percent indicated SPY exposure. If it passes, it supplies a bullish-only direction cap equal to the SPY weight. If it fails, the outcome is no trade. Thus the library supports bullish calls and bearish puts, but the competition's live-authorized path can advance only a bullish spread or no trade.

## 7. Evidence, model role, and deterministic intent

### 7.1 Canonical signals

Every evidence record includes family, underlying, source kind and URI, origin ID, publication and receipt timestamps, content hash, duplicate-group hash, and an evidence ID derived from the canonical body. IDs, origins, and duplicate groups cannot cross families. A second signal from one family is rejected rather than double-counted [15,16].

The deployed runner builds three live families.

- **Market.** With twenty recent SPY log returns and volatility σ:

$$
z_market = 0.65 M₅/(σ√5) + 0.35 M₂₀/(σ√20); d_market = tanh(z_market/2).
$$

- **Options.** At the earliest expiry with both rights, code selects nearest-to-spot call and put. For κ = IV_put − IV_call:

$$
d_options = −tanh(κ/0.035).
$$

- **Events.** Up to twelve nonduplicated Alpaca news items no older than seventy-two hours receive age weights exp(−age_hours/24); the weighted model score is shrunk by 0.65.

The schema also supports a prediction-market family with base weight 0.05, and the complete synthetic fixture exercises it. The current autonomous live builder has no production prediction-market feed. It is a supported family, not a current live source.

### 7.2 Hosted model boundary

Qwen3-32B receives only canonical public news text, required evidence IDs, underlying, and timestamp. Temperature is zero, extended thinking is disabled, and output must contain exactly one assessment per ID: direction score, volatility score, and short rationale. Unknown keys, missing or duplicate IDs, nonfinite scores, malformed JSON, timeout, identity mismatch, or hash mismatch fails extraction [17].

The model has no account identifier, credential, equity, buying power, position, compiler state, risk object, candidate list, order payload, or mutation tool. Source text is untrusted data, not instructions. Model output is evidence assessment, not a trade.

### 7.3 Aggregation and reduction-only authority

For family j,

$$
a_j = b_j × quality_j × freshness_j × calibration_j × independence_j,
$$

where base weights are 0.50 market, 0.20 options, 0.25 events, and 0.05 prediction market. In the generic library path,

$$
d = Σ_j a_jd_j / Σ_j a_j.
$$

Coverage is min(1, Σ a_j); agreement is the share of absolute directional weight aligned with the aggregate sign. Trading requires |d| ≥ 0.18, coverage ≥ 0.35, and agreement ≥ 0.55 [16,18].

The live economic-authority path removes events from deterministic direction. Let d_D be deterministic direction and u the bullish economic cap. Negative event evidence creates

$$
g_model = clip[1 − Σ_events,dⱼ<0 {(−d_j)a_j / 0.25}, 0, 1].
$$

The supported score is

$$
d_supported = min[u, max(0,d_D)] × g_model.
$$

Positive model evidence cannot increase it. Negative evidence reduces it and may drive it to zero. This monotone, reduction-only relationship is Finly's central controlled-delegation property.

## 8. Deterministic options compilation

### 8.1 Enumeration and payoff

The compiler accepts SPY and three library outcomes: bull-call debit spread, bear-put debit spread, or no trade. Quotes must pass schema, underlying, right, feed, age, relative spread, open-interest, tradability, and DTE checks. Entry DTE is three to fourteen days; maximum relative leg spread is 0.25; minimum open interest is 50; indicative quotes may be ninety seconds old and OPRA quotes thirty seconds [18].

For each same-expiry pair, code assigns the lower-strike call as bullish long leg or higher-strike put as bearish long leg. Width W is $1–$15. Entry debit is

$$
D = ask_long − bid_short + 2($0.03).
$$

Candidates require 0 < D < W. For one contract,

$$
Maximum loss = 100D; Maximum gain = 100(W − D).
$$

with reward-to-risk at least 1.25. Terminal payoff is

$$
Π_call(S_T) = 100{min[W, max(0, S_T − K_long)] − D}; Π_put(S_T) = 100{min[W, max(0, K_long − S_T)] − D}.
$$

### 8.2 Scenario valuation

Every spread is evaluated under two models with 2,048 paths [19,20]. The tilted-implied model uses normal quantiles. For horizon h, direction d, volatility score v, and mean leg IV:

$$
σ_A = max[0.08, IV(1 + 0.12v)]; ln[S_h/S₀] = (0.38d − σ_A²/2)(h/252) + σ_A√(h/252)z.
$$

The second model draws five-session circular blocks from historical SPY log returns. Its target daily volatility is

$$
σ_B,daily = [0.55σ_hist + 0.45(IV/√252)](1 + 0.12v).
$$

Centered historical returns are scaled to that value, restored to their mean, and receive directional tilt 0.00115d per session. Seeds derive deterministically from candidate ID and market time.

Remaining option time at the horizon is

$$
T_remaining = max[1/365, DTE/365 − h/252].
$$

Each leg is marked with Black–Scholes [21]:

$$
d₁ = {ln(S/K) + (r − q + σ²/2)T} / (σ√T); d₂ = d₁ − σ√T; C = Se^(−qT)Φ(d₁) − Ke^(−rT)Φ(d₂); P = Ke^(−rT)Φ(−d₂) − Se^(−qT)Φ(−d₁).
$$

Close value is clipped to [0,W] after two $0.03 exit-slippage charges. For model m, Finly records mean profit μ_m, standard error SE_m, probability of profit, and five-percent expected shortfall. Conservative expected value is

$$
CEV = min_m [μ_m − 1.645 SE_m]; require CEV ≥ max[$10, 0.06 × maximum loss] and conservative probability ≥ 0.53.
$$

Probability and expected shortfall take the worse model. Among candidates with loss no greater than $500, the compiler maximizes CEV divided by maximum loss and breaks exact ties by stable candidate hash.

### 8.3 Size and challenge suite

With equity E and per-contract loss L,

$$
Q = min{4, floor[min(fE, $500)/L]},
$$

where f = 0.005 normally and 0.0025 at half-risk. New plus open defined risk may not exceed 0.03E [22].

The complete synthetic fixture contains four families, so leave-one-family-out testing creates four variants. Each must retain the same nonneutral direction, pass coverage and agreement, compile the same action, and leave the fixed candidate above EV and probability gates.

Thirty-two deterministic Halton variants perturb source direction by ±0.05, quality by ±0.03, freshness and calibration by ±0.02, independence by ±0.015, spot by ±0.2 percent, leg IV by ±4 percent, history scale from 0.94 to 1.06, interest rate by ±0.5 percentage points, horizon by −1/0/+1, and entry debit by less than $0.04 [23]. Passing requires zero direction flips, at least 90 percent nonneutral direction, 80 percent trade rate, 75 percent same structure, and positive nearest-rank fifth-percentile CEV.

In the published synthetic run, four of four removals passed; all thirty-two variants retained direction and trade; trade and same-structure rates were 100 percent; and fifth-percentile CEV was $71.48. The selected bearish fixture had $3.66 debit, $366 maximum loss, $634 maximum gain, CEV $97.18, and 60.89 percent conservative probability [24]. It is a synthetic compiler test. Its synthetic_replay certificate cannot authorize the paper executor.

## 9. Certificate and paper execution

### 9.1 One permit for one order

A paper-submit certificate is valid for thirty seconds. It contains run and expiry times, paper mode, scope, intent hash, candidate ID and snapshot hash, desired order-projection hash, policy hash, evidence root, account and market hashes, observed spot and time, feed, quantity, loss reservation, entry ceiling, account equity, open risk, CEV, probability, expected shortfall, challenge summaries, and all Boolean checks [22].

The certificate ID hashes its canonical body. A separate secret of at least thirty-two bytes signs it:

$$
signature = HMAC-SHA256(secret, canonical certificate body).
$$

Verification recomputes body hash and HMAC with timing-safe equality, checks paper mode and paper_submit scope, and rejects stale permits. Synthetic certificates use a separate scope. Final preflight may be fifteen seconds old at most; reviewed debit may drift $0.10, SPY 0.5 percent; the account needs Level 3 options and at least 25 percent post-trade buying power.

### 9.2 Broker state machine

The equity runner persists signed phases PLANNED, ORDER_PENDING, RECONCILING, READY, and FROZEN [25].

~~~text
Algorithm 2: one conservative G4 cloud cycle

Restore and authenticate encrypted state.
Reject a mismatched protocol, revision, account binding, or signature.

If READY:
  verify exact holdings, quantities, and no open equity order
  return READY or freeze a hard contradiction
If FROZEN:
  return without mutation

Read clock, account, positions, orders, and asset eligibility.
Require the dedicated active, unblocked, initially flat $100,000 paper account,
the exact market window, paper endpoint, and mutation acknowledgements.

Choose the first leg not FILLED.
If no leg remains:
  reconcile total notional, cash reserve, exact symbols, and quantities
  defer while broker endpoints converge
  otherwise transition RECONCILING → READY

Before placing one leg:
  persist ORDER_PENDING with mutation_started = true
  compare-and-swap the state revision and checkpoint encryption
  call Alpaca MCP once

If acknowledgement is absent:
  look up the deterministic client-order ID
  if still absent, return ORDER_AMBIGUOUS without resubmission

Read back the order.
Pending stays ORDER_PENDING.
Failure or contradiction becomes FROZEN.
Fill signs quantity, average price, and notional,
then returns to PLANNED or advances to RECONCILING.
~~~

Each cycle permits at most one broker-changing call. Deterministic IDs hash the frozen protocol, sequence, symbol, and notional. Because intent is durable before mutation, a runner dying after Alpaca accepts an order recovers the same ID rather than creating a duplicate.

Final readiness requires filled notional no lower than $20 below the authorized total and no higher than 97 percent of baseline plus one cent; cash no lower than 3 percent minus $5; exactly QQQ, XLB, XLE, and XLV; no open equity order; and broker quantities matching signed fills. Temporary endpoint convergence defers; arithmetic or identity contradiction freezes.

### 9.3 Cloud state and measurement

GitHub Actions runs while the laptop is off. Schedule time is not authority: an in-process UTC window and Alpaca clock govern mutation. Concurrency permits one cycle. The official Alpaca MCP server is pinned at 2.2.1 [26,27].

Lifecycle journals are encrypted with AES-256-GCM under a secret different from the certificate secret and stored on an isolated state branch. State is checkpointed before entry and exit mutation. The public branch contains only allowlisted competition_live.json without credentials, raw account identity, or broker IDs. GitHub Pages fetches that file; it never receives a trading secret [27].

The GET-only scorer compares Finly with same-timestamp SPY and rejects cashflow or provenance breaks [28]. At the first close, Finly was +$95.32 versus SPY -$57.99 at 4:00 p.m. ET: +$153.31 after 15 fills and zero external cashflows [35].

## 10. Verification, reproducibility, and hackathon fit

The public run executed 809 tests: 807 passed, none failed, and two were skipped [29]. Coverage includes schemas, evidence separation, G4 weights, causal lag, costs, option payoff, Black–Scholes, scenario determinism, removals, perturbations, risk limits, HMAC scopes, broker translation, stale preflight, duplicate recovery, encryption, calendar boundaries, forward attribution, and artifact checks. This establishes tested software behavior, not forecast accuracy or profitability.

The repository pins Node.js 26.7.0. A clean reproduction begins:

~~~text
npm ci
npm run verify
~~~

The command runs linting, tests, replay and receipt checks, recorded model-decision checks, economic research, current-decision and economic-options checks, registered forward-trial verification, MCP configuration, production build, and submission validation. Historical evidence, gates, receipts, protocol, forward contract, and sanitized status are machine-readable JSON. References point to a fixed revision.

Finly maps to the Options Alpha Agents requirements [1,30].

| Requirement | Implementation | Boundary |
| --- | --- | --- |
| Autonomous AI agent using Alpaca | Hosted assessment, economic intent, compiler, certificate, lifecycle, cloud runner | Interpretation is not broker authority |
| Alpaca MCP or CLI | Official MCP 2.2.1, paper endpoint, authenticated path | Read access is not a fill |
| Incorporate options | SPY vertical compiler, payoff, limits, multi-leg translation | ETF history is not options P&L |
| Dedicated $100,000 paper account | Active Level 3 paper account with private ID and sanitized snapshot [32] | Credentials stay outside Git |
| One-page explanation | Separate judge brief plus this technical paper | The paper supplements the brief |
| Public original work | MIT repository and source-bound artifacts [31] | Secrets and private state excluded |

The strongest claim is not that an LLM found a guaranteed trade. It is that the division of authority is executable: the model reads; code computes; the permit binds; Alpaca records; and a public scorer measures without rewriting the rule.

## 11. Threats and limitations

**Selection and multiplicity.** G4 followed extensive exploration. ETF-era partitions were consumed, statistical promotion failed, and no pristine holdout remains. The external proxy also failed its adjusted gate. Historical outperformance is not a forecast.

**Data mismatch.** G4 research uses Yahoo adjusted closes; competition signaling uses Alpaca IEX adjustment-all. Strict reconciliation failed for every required symbol. Adjusted series reflect vendor methodology and revised corporate actions.

**Universe and control.** The ETF universe consists of 2026 survivors. QQQ creates a growth tilt, and rotation did not consistently beat static SPY/QQQ. French industries are proxies, not the modern instruments.

**Execution.** Close replays with fixed costs omit queue priority, dynamic spreads, partial fills, halts, latency, impact, and some corporate-action cases. Alpaca paper fills cannot establish real-capital execution quality.

**Options model risk.** Positive CEV inside two approximate models can fail under jumps, regime change, surface movement, or unmodeled dependence. Defined risk does not make direction correct.

**News model.** Qwen can misunderstand or omit context. Schema validation controls shape, not truth; reduction-only authority only limits the consequence.

**Operations.** GitHub Actions can fail or run late. State, timing, read, or reconciliation failures become no trade or frozen state.

**Short forward window.** A few days cannot estimate long-run return. One realized path primarily tests operational execution.

## 12. Conclusion

Finly combines a frozen quantitative sleeve, an AI evidence reader, a deterministic options compiler, and restart-safe Alpaca execution without pretending they are one model. G4 supplies a compelling historical reason to test: $10,000 became $106,711 versus $68,082 for SPY. The failed statistical, control, and source gates supply the reason to be careful.

The system turns that tension into design. A separate SPY/BIL rule bounds options direction. News may reduce or veto but cannot amplify it. Code owns payoff, EV gates, quantity, loss, and broker fields. A short-lived HMAC certificate binds one state to one projection. Encrypted checkpoints and deterministic IDs make uncertain acknowledgements recoverable. The paper account then observes what happens without changing the rule.

Finly's contribution is controlled delegation: every component has a useful job, every capital-bearing decision has a deterministic owner, and every public claim traces to supporting evidence.

## References

[1] Finly. “Submission Requirements and Release Checklist.” [docs/REQUIREMENTS_MATRIX.md](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/docs/REQUIREMENTS_MATRIX.md).

[2] Finly. “Frozen G4 Source Signal.” [config/g4-official-source-signal.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/config/g4-official-source-signal.json).

[3] Finly. “Frozen G4 Competition Protocol.” [config/g4-official-production.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/config/g4-official-production.json).

[4] Finly. “Quantitative Release Gate.” [research/output/quantitative_release_gate.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/research/output/quantitative_release_gate.json).

[5] Finly. “Generation 4 Simulation Engine.” [research/champion_engine.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/research/champion_engine.mjs).

[6] Finly. “Generation 4 Robustness Result.” [research/output/quant_champion_generation4_robustness.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/research/output/quant_champion_generation4_robustness.json).

[7] Finly. “G4 Wealth and Drawdown Series.” [public/data/g4_wealth_drawdown.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/public/data/g4_wealth_drawdown.json).

[8] Finly. “Generation 4 Strategy Definitions.” [research/champion_strategies_generation4.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/research/champion_strategies_generation4.mjs).

[9] T. J. Moskowitz, Y. H. Ooi, and L. H. Pedersen. “Time Series Momentum.” *Journal of Financial Economics* 104, no. 2 (2012): 228–250. [doi:10.1016/j.jfineco.2011.11.003](https://doi.org/10.1016/j.jfineco.2011.11.003).

[10] Finly. “Generation 4 Statistical Methods.” [research/champion_statistics.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/research/champion_statistics.mjs).

[11] Kenneth R. French. [Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html).

[12] Finly. “External-Era Public Evidence.” [public/data/attempt150_public_evidence.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/public/data/attempt150_public_evidence.json).

[13] Finly. “Economic Research and Current Policy.” [lib/economic_research.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/economic_research.mjs).

[14] Finly. “Economic Research Evidence.” [public/data/economic_research.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/public/data/economic_research.json).

[15] Finly. “Live Signal Construction.” [lib/live_signals.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/live_signals.mjs).

[16] Finly. “Evidence Aggregation.” [lib/signals.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/signals.mjs).

[17] Finly. “Hosted Evidence Extractor.” [lib/evidence_extractor.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/evidence_extractor.mjs).

[18] Finly. “Options and Risk Policy.” [lib/policy.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/policy.mjs).

[19] Finly. “Deterministic Options Compiler.” [lib/compiler.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/compiler.mjs).

[20] Finly. “Scenario and Black–Scholes Functions.” [lib/quant.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/quant.mjs).

[21] F. Black and M. Scholes. “The Pricing of Options and Corporate Liabilities.” *Journal of Political Economy* 81, no. 3 (1973): 637–654. [doi:10.1086/260062](https://doi.org/10.1086/260062).

[22] Finly. “Risk Certificate.” [lib/risk.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/risk.mjs).

[23] Finly. “Source-Removal and Perturbation Gate.” [lib/stability.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/stability.mjs).

[24] Finly. “Latest Synthetic Options Decision Receipt.” [public/data/latest_receipt.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/public/data/latest_receipt.json).

[25] Finly. “Official G4 Equity Runner.” [lib/g4_official_equity.mjs](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/lib/g4_official_equity.mjs).

[26] Alpaca. “MCP Server.” [Official documentation](https://docs.alpaca.markets/us/docs/alpaca-mcp-server).

[27] Finly. “Cloud Runner and Restart Design.” [docs/CLOUD_RUNNER.md](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/docs/CLOUD_RUNNER.md).

[28] Finly. “Competition Forward-Profit Contract.” [config/competition-forward-profit.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/config/competition-forward-profit.json).

[29] Finly. “Public Automated-Test Run.” [GitHub Actions run 33369848292](https://github.com/owlsowo/finly-bot/actions/runs/33369848292).

[30] lablab.ai. [Alpaca AI Trading Agents Hackathon](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon).

[31] Finly. [Public repository](https://github.com/owlsowo/finly-bot).

[32] Finly. “Sanitized Competition Account Snapshot.” [public/data/competition_live.json](https://github.com/owlsowo/finly-bot/blob/fe3a766bcc518b2961bbcae82e836417746af2a6/public/data/competition_live.json).

[33] H. White. “A Reality Check for Data Snooping.” *Econometrica* 68, no. 5 (2000): 1097–1126. [doi:10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152).

[34] D. H. Bailey and M. López de Prado. “The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality.” *Journal of Portfolio Management* 40, no. 5 (2014): 94–107. [doi:10.3905/jpm.2014.40.5.094](https://doi.org/10.3905/jpm.2014.40.5.094).

[35] Finly. “First-Session Same-Clock Forward Measurement.” [public/data/competition_forward_profit_2026_08_31.json](https://owlsowo.github.io/finly-bot/data/competition_forward_profit_2026_08_31.json).
