# BL-601 — coder rework — acyclic cycle (architect bounce 88c606593c)

## Root cause

`trend.ts` re-exported `trendForCompactionCadencePerHour` from
`./compactionCadence` while `compactionCadence.ts` imports `computeTrend`
from `./trend` — a forbidden acyclic pair under `dependency-gate.js`.

## Fix

1. Removed the BL-601 re-export from `trend.ts`.
2. Acceptance step loads `trendForCompactionCadencePerHour` from
   `compactionCadence` (same module that owns the helper; still uses
   `computeTrend` inward).
3. Unit test locks the absence of the re-export in `trend.ts` source.

## Sibling (not this parcel)

Scoped dep-gate on `compactionCadence.ts` / `trend.ts` still reports
`humanDecisionLatency` ↔ `trend` / `stageDwell` cycles — already ticketed
and bounced as **BL-600** (`2fa2e41c7`). Out-of-parcel; left untouched
(BL-506 / BL-1063).

## Verification

| check | result |
|---|---|
| `compactionCadence.test.js` | 7/7 (incl. acyclic lock) |
| `compactionCadence.property.test.js` | 4/4 |
| `run_acceptance.sh BL-601…feature` | 6/6 |
| dep-gate: compactionCadence↔trend cycle | **gone** |

By coder.
