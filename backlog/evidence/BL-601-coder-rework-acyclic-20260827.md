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

## Commit note

Pre-commit property suite mutated shared checkout to fixture `init`
(BL-1124); tip restored from reflog to `59ff0ae2d`. Commit used
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` as recovery-only (BL-1121) —
standing reds tracked by BL-1175, not caused by this parcel.

By coder.
