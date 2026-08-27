# BL-600 — architect bounce — 20260827

## Review inventory (Article 4.4)

### D1 — architecture / acyclic (coder)

Hard gate `dependency-gate.js` **FAILED** on tip-pure coder `6036352f61`:

```
src/metrics/humanDecisionLatency.ts -> src/metrics/trend.ts violates "acyclic"
src/metrics/humanDecisionLatency.ts -> src/metrics/stageDwell.ts violates "acyclic"
```

**Cause:** `humanDecisionLatency.ts` imports `computeTrend` from `./trend`, while
`trend.ts` re-exports `trendForDecisionLatencyMedian` from
`./humanDecisionLatency` — a classic cycle. The `stageDwell` edge participates
in the same cycle report from depcruise.

**Remediation:** Break the cycle. Prefer keeping the pure aggregator importing
`trend`/`stageDwell` inward, and move the TrendedNumber wiring (or a thin
facade) so `trend.ts` does not import/re-export `humanDecisionLatency`. Do not
weaken the acyclic rule.

## Invariants (informational)

P1–P3 cover pending-vs-decided and pure pairing. Invariant 3 stated as
"module has no Telegram/approval side calls" in coder evidence — not the bounce
reason. Parcel not forwarded.

## Inbound

Cleaner `566c122982` (also carried BL-597). Reviewed tip-pure `6036352f61`
(7 paths). Cherry-pick applied briefly for gate run, then reset — tip not
forwarded.

## Commit reviewed

`6036352f61`

By architect.
