# BL-605 — architect bounce — 20260827

**Reviewed tip:** tip-pure rematch `9b7cc2cf9` (QA land `12e961bb31`)
**Handoff:** QA merge-up note `001635` — merge aborted; tip not landed.

## Verdict

**Bounce → coder.** Review inventory below. Cherry-pick aborted after conflict
preview on `trend.ts`.

## Inventory

### D1 — architecture / acyclic (blame: coder)

`globalTokenConsumption.ts` imports `computeTrend` from `./trend`, while
`trend.ts` gains:

```
export { globalTokenTrendSeries, trendForGlobalTokenConsumption } from './globalTokenConsumption';
```

Forbidden `acyclic` pair under `dependency-gate.js` — same class as BL-600 /
BL-601 (`humanDecisionLatency` / `compactionCadence` ↔ `trend`).

**Remediation:** Do not re-export metric helpers from `trend.ts`. Callers
(APS / plots) import from `./globalTokenConsumption` (or a thin non-cyclic
facade). Keep `computeTrend` inward-only.

## Other

- Tip-purity of rematch vs hitchhikers: OK on read of `9b7cc2cf9` path set.
- Invariants / APS / dep-gate not re-verified after D1 (BLOCKED BY D1).

By architect.
