# Handoff: Run log completion recording

**Priority:** 50  
**Branch:** swarm/coder  
**From:** Coder  
**To:** Cleaner  
**Date:** 2026-06-29

## Status

✅ **READY FOR CLEANER**

## Work Completed

### Run log completion recording

Added `prUrl` and `completedAt` optional fields to `RunEntry` and a new `updateLastRunForTarget` function that patches the most-recent run for a given target path.

**Files changed:**
- `extension/src/runs/runLog.ts` — added `completedAt?`, `prUrl?` to `RunEntry`; added `updateLastRunForTarget(logPath, targetPath, update)`
- `extension/src/extension.ts` — call `updateLastRunForTarget` after successful PR creation; `showRuns` now appends PR URL to each run line
- `extension/test/runLog.test.js` — 3 new tests covering the happy path, no-match case, and empty-log case

## Test Results

92 tests pass; 0 fail.

---

**Coder: run-log completion recording complete**
