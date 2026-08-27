# BL-601 — architect pass (acyclic rematch) — 20260827

**Tip:** tip-pure feature `a2e4e88a3` + acyclic fix inlined → architect `d6284a12a`
(+ rematch evidence). Cleaner tip `8cea3c3e59` was evidence-only on polluted
ancestry; prior bounce `88c606593c` (compactionCadence↔trend re-export).
**Handoff:** `00_20260827T082557Z_000987_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Functional paths:

- `extension/src/metrics/compactionCadence.ts`
- `extension/src/metrics/compactionTelemetryStore.ts`
- `extension/src/metrics/trend.ts` (comment only — no re-export)
- `extension/test/compactionCadence.{test,property.test}.js`
- `specs/pipeline/steps/bl601TrendCompactionCadenceSteps.js`
- `specs/pipeline/steps/index.js` (+ `bl601` only)

## Architecture

- `compactionCadence` imports `computeTrend` from `./trend` (inward only).
- `trend.ts` does **not** re-export `trendForCompactionCadencePerHour`.
- APS/callers load the helper from `out/metrics/compactionCadence`.
- Unit lock asserts `trend.ts` source has no `./compactionCadence` re-export.
- Dep-gate: **PASSED** (no forbidden edges).

## Invariants

Property suite encodes spinner/NA/pure aggregation (4/4). Measuring does not
mutate thresholds (pure aggregator; APS green).

## Verification

| Check | Result |
|-------|--------|
| `tsc --noEmit` | pass |
| `compactionCadence.test.js` | 7/7 |
| `compactionCadence.property.test.js` | 4/4 |
| APS BL-601 feature | 6/6 |
| `dependency-gate.js` | PASSED |

By architect.
