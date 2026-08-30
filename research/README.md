# Quantitative research audit trail

This directory contains the public protocols, runners, receipts, and bounded outputs behind Finly's quantitative claims. Raw market panels and private account material remain excluded. Running a study does not change the trading policy, judge artifacts, or broker state; any public claim change must pass through the content-addressed evidence and claims-lock builders.

## Run

```bash
npm run research:quant-extension
npm run research:quant-extension-check
```

The runner performs authenticated **read-only** Alpaca SIP history requests and free Yahoo adjusted-close requests. It does not persist raw bars or credentials. It writes:

- `research/output/quant_candidate_extension.json` — complete machine-readable evidence, gates, hashes, metrics, and failed Booleans.
- `research/output/quant_candidate_extension_report.md` — answer-first audit report.

The checker is fully offline. It covers chronology and the full-session execution lag, future-row perturbation, partition exclusion, cost arithmetic, null/missing adjusted closes, all five rebalance anchors, an independent MRER calculation, and disposition logic.

## Interpretation boundary

All dates through 28 August 2026 are seen. Yahoo's four 28 August rows have null adjusted closes, so the uniform long-history panel ends 27 August without imputation. Alpaca's complete 28 August rows remain separate and reproduce frozen Finly exactly.

The development/validation selector is exploratory. A candidate is not promoted unless every private Gate A and Gate B item passes and a new broker-reconciled Gate C forward record subsequently passes. The current expected disposition is `KEEP_V1`.
