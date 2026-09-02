# Frozen v1 economic core → model brake → options replay

Finly publishes a deterministic, credential-free architecture receipt at
[`public/data/economic_options_overlay_replay.json`](../public/data/economic_options_overlay_replay.json).
It is deliberately a synthetic, non-mutating replay of the original v1 policy,
retained byte-for-byte for provenance after live policy v2 was separately
versioned. It proves which component owned direction in that frozen policy, how
model evidence was bounded, and whether the compiler produced a defined-risk
SPY vertical. It does **not** describe live-v2 direction, and it does **not** claim
historical options profit, a broker fill, or future performance.

The replay evaluates four exact branches against one hashed bullish economic
core and one fixed option surface:

1. no model evidence: deterministic market/options confirmation selects a bull-call debit spread;
2. supportive model evidence: direction and volatility remain identical, so the model cannot amplify the trade;
3. adverse model evidence: the direction score falls but cannot become bearish;
4. severe adverse model evidence: Finly emits `NO_TRADE` and no option candidate survives.

Every branch stays in `synthetic_replay` certificate scope, invokes no executor,
requests no broker mutation, and retains the same $500 risk cap as the live
paper path. Rebuild and verify it locally with:

```bash
npm run economic:options-replay
npm run economic:options-replay-check
```

The checker regenerates the public artifact in memory, requires an exact byte
match, verifies the top-level hash and every declared invariant, and rejects
credential-shaped content.
