# BL-600 — cleaner pass (acyclic rematch) — 20260827

## Inbound

Architect bounce D1: `humanDecisionLatency`↔`trend` re-export cycle.
Coder tip-pure rematch `7e6124ec5a` (8 paths on `origin/main`, `dels=0`).

## Checks run

1. **Tip purity** — BL-600-only; `dels=0`.
2. **Compile** — PASS.
3. **Unit** — `humanDecisionLatency.test.js`: 6/6 PASS (incl. acyclic lock).
4. **Property** — `humanDecisionLatency.property.test.js`: 3/3 PASS.
5. **Dep-gate** (`humanDecisionLatency.ts` + `trend.ts`) — PASSED.

## Cleanup performed

NONE. Aggregator imports `computeTrend`/`splitOutliers` inward; no
`trend.ts` re-export (same pattern as BL-601).

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task `BL-600-acyclic-cycle-bounce`.

By cleaner.
