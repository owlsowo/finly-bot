# Attempt 116 source attribution and adaptation boundary

Attempt 116 independently implements a small, preregistered volatility-signal idea from [`Ander-IbBi/alpaca-vrp-engine`](https://github.com/Ander-IbBi/alpaca-vrp-engine) at the exact pinned commit [`84d6bff500b53a27cb2743a870b9533fc7d5c098`](https://github.com/Ander-IbBi/alpaca-vrp-engine/commit/84d6bff500b53a27cb2743a870b9533fc7d5c098). The upstream project is distributed under the MIT License. Its notice is retained verbatim in [`UPSTREAM_LICENSE.txt`](./UPSTREAM_LICENSE.txt).

## Adapted signal semantics

The primary source is [`src/vrp_engine/strategy/signals.py`](https://github.com/Ander-IbBi/alpaca-vrp-engine/blob/84d6bff500b53a27cb2743a870b9533fc7d5c098/src/vrp_engine/strategy/signals.py):

- annualized close-to-close volatility is the sample standard deviation of log returns multiplied by `sqrt(252)`;
- annualized Parkinson volatility is `sqrt(252 * sum(log(high / low)^2) / (4 * n * ln(2)))`;
- blended realized volatility is an arithmetic volatility blend: 40% 10-return close-to-close, 20% 21-return close-to-close, and 40% 21-bar Parkinson;
- the relative IV–RV gap is `(front ATM IV - blended RV) / blended RV`;
- a gap at or above `+0.15` is a sell-vol shadow stance, a gap at or below `-0.15` is a buy-vol shadow stance, and the strict interior stands down;
- term slope is the signed difference `front ATM IV - next ATM IV`, measured in decimal-volatility points; a strict raw floating-point comparison greater than `0.08` blackouts either directional stance.

The pinned source calls the relative gap `vrp_z`, but it is not a statistical z-score. Attempt 116 therefore calls it a **relative IV–RV gap**. It is also a proxy rather than a claim about future realized variance.

## Deliberate bounded safety differences

Attempt 116 is narrower than the upstream runtime:

1. It requires complete 10-return, 21-return, and 21-bar windows. The upstream implementation can use as few as three valid observations and renormalize around missing components; Attempt 116 never renormalizes.
2. It rejects malformed bars instead of silently filtering them.
3. Equal-distance ATM strikes use a deterministic lower-strike tie-break. The upstream result follows input order in a tie.
4. A missing front or next ATM IV stands down. The upstream term blackout fails open when the next-expiry ATM IV is missing.
5. Attempt 116 derives front and next from the sorted distinct expiries present in a caller-asserted complete 1–9 DTE surface. It validates DTE and SPY identity but cannot independently prove that the caller omitted no eligible expiry or strike.

These differences are fail-closed or deterministic and do not change the registered 40/20/40 formula, inclusive ±0.15 stance boundaries, or strict `> 0.08` term-blackout rule when all required inputs exist.

## Timing and origin assurance

The pure compiler requires a canonical surface snapshot timestamp, the same timestamp and SPY identity on every option quote, a caller-supplied source-receipt hash, and—only for prospective inputs—a public-registration receipt observation that is no later than the snapshot. It derives the first two expiries rather than accepting caller-selected expiry labels. It rejects a snapshot before the frozen first-eligible instant or after the signal observation time. These checks bind the caller's evidence consistently; they do **not** independently authenticate the provider, the public-platform receipt, either timestamp, or the caller's assertion that the 1–9 DTE surface is complete. Any compiled artifact labels that limitation explicitly.

## Explicit exclusions

No code or behavior is adapted from the upstream pricing, sizing, or portfolio-risk modules. Attempt 116 does not implement fractional Kelly, probability-wedge sizing, expected-value gates, option-structure selection, tradable-leg or order-contract selection, quantity sizing, broker reads, broker mutation, order construction, historical scoring, or performance inference. Its nearest-strike call and put records are analytical ATM reference quotes used only to calculate implied volatility; they are not order legs. Attempt 116 is a pure, non-authorizing shadow signal compiler with its real-data runner disabled.

For the Parkinson estimator itself, see Michael Parkinson, “The Extreme Value Method for Estimating the Variance of the Rate of Return,” *The Journal of Business* 53(1), 61–65 (1980), [doi:10.1086/296071](https://doi.org/10.1086/296071).
