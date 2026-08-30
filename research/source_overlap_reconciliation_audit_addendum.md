# Source-overlap reconciliation audit addendum

This addendum records semantic clarifications identified during an independent review. It does not modify, rescue, or replace the frozen protocol or its `FAIL_CLOSED` result.

## Correct terminology

- The sessions removed by the frozen 0.01 bp comparison are **all-versus-split adjustment-difference intervals**. They should not be described as distribution intervals. The detector can also flag vendor precision, rounding, and other adjustment differences.
- The protocol required no more than 8% exclusions for each symbol. Observed exclusions were approximately 78% to 96%, so the preregistered gate failed and the remaining sessions are too sparse and nonrepresentative for an all-symbol validation claim.
- Alpaca `adjustment=all` is an **all-adjusted price-series diagnostic**, not a total-return proxy. The result does not establish dividend-reinvested performance.

## What remains informative

The fixed candidate's common-panel diagnostic remains useful but subordinate to the failed overall gate: its top-three sector choice agreed on all 61 overlapping signal dates, daily candidate log returns correlated at 0.99924, annualized tracking error was 0.72%, and the candidate-minus-SPY annualized log-growth edge differed by about 2.17 basis points per year between the two reconstructed panels.

Those candidate-level observations do not override the protocol. Because every required symbol had to pass and the all-symbol ordinary-session definition failed, the authenticated reconciliation disposition remains `FAIL_CLOSED`.
