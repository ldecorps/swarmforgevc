# BL-601 — architect bounce — 20260827

## Review inventory (Article 4.4)

### D1 — architecture / acyclic (coder)

Tip-pure coder `a2e4e88a3` / `2faa3e5210` introduces the same cycle class as
BL-600: `compactionCadence.ts` imports `computeTrend` from `./trend`, while
`trend.ts` gains:

```
export { trendForCompactionCadencePerHour } from './compactionCadence';
```

That is a forbidden `acyclic` edge pair under
`node extension/out/tools/dependency-gate.js` (same hard gate that bounced
BL-600 for `humanDecisionLatency` ↔ `trend`).

**Remediation:** Do not re-export metric helpers from `trend.ts`. Keep
`compactionCadence` importing inward to `trend`/`stageDwell`; expose
TrendedNumber wiring from the metric module (or a thin non-cyclic facade)
without `trend.ts` importing the metric.

Cherry-pick aborted after conflict preview — parcel not landed.

## Invariants (informational)

Coder reports property 4/4 for spinner/NA/pure aggregation. Not verified on
tip after D1; fix the cycle first, then re-present.

## Commit reviewed

`a2e4e88a3`

By architect.
