# BL-1323 — cleaner pass on rework (2026-09-02)

NONE — no defect found. Forwarded to architect.

## Reviewed

The coder's rework (68b63e0710..7b0ff8188a) fixes architect bounce D1: the
property test's `pathsArb` used a weighted `fc.oneof` over four shapes
(weights empty=1, sentinel=1, ordinary=2, overCap=2), so the two low-weight
corners landed at P≈1/6 per draw and a 20-run pass missed one about 5% of
the time — the same generator-shape defect already fixed once in BL-1343's
property test earlier the same day, this time in a second file. The rework
draws the shape via the enclosing loop (`for (const [shape, arbitrary] of
Object.entries(SHAPES))`, `numRuns: 5` per shape, 20 total unchanged) so
every reach counter holds by construction rather than by draw. No
production code or review conclusion changed — matches the bounce's
diagnosis exactly, and the coder explicitly named this as the same class
already fixed for BL-1343 rather than treating it as a fresh defect.

No readability issues this time: unlike BL-1343's rework, the loop wrapping
here introduced no indentation drift or stray blank lines — the body was
written fresh at the correct nesting depth.

## Verification run (not assumed)

- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1323-main-sync-deadlock-hints-name-overlaps-and-teach-swarm-heal.feature` → 7/7 pass.
- `npx vitest run --config vitest.properties.config.mjs bl1323StampOffInvariants`, 7 consecutive runs → 7/7 clean (3/3 tests each run), confirming D1 is resolved.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` → ALL TESTS PASS.

## Merge note

Clean merge, no conflicts — the coder's rework landed on top of this
worktree's already-merged BL-1323 bounce revert with no overlap.
