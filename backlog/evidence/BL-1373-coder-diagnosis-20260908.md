# BL-1373 Coder Diagnosis — 2026-09-08

## Root Cause

The BL-1086 cache (`gather-pipeline-code-on-main-cached` in `babysitter_check.bb:665`) keys only on the three git tips (main, origin/main, swarmforge-QA), but the cached result depends on BOTH the tips AND the qa-exclusive-paths returned by `qa-exclusive-paths`.

## Mechanism

1. `gather-pipeline-code-on-main` (line 633) calls `qa-exclusive-paths` at line 634, which shells out to `check_pipeline_code_on_main.sh --list-paths` (or the stub when `BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT` is set).
2. The result (offending commits) is computed using that path set.
3. `gather-pipeline-code-on-main-cached` (line 665) caches the result keyed only on the three tips.
4. When the cache is hit (same tips), it returns the cached result WITHOUT re-evaluating `qa-exclusive-paths`.

## Why Scenario 07 Fails

Scenario 07 sets `BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT` to a stub that returns a different path set (`docs/custom-secret.md`). But if a prior sweep already cached a result for the same tips, the cache returns the old result computed with the real path set (`extension/src/`, etc.), not the stub's path set.

## Fix

Include the qa-exclusive-paths in the cache key. The cache should invalidate when the path set changes, not just when the tips change.

## Invariants

The two invariants from the ticket are:
1. The classified path set is whatever BL-632's single source reports at runtime, including a set the sweep has never seen before - never a value fixed at any earlier moment.
2. A path the single source does not report produces no finding, so widening the set is never achieved by classifying everything.

The fix must preserve both invariants.
