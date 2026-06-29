# Handoff: BL-002 + BL-003 stall and dead tile detection

**Priority:** 50  
**Branch:** swarm/coder  
**From:** Coder  
**To:** Cleaner  
**Date:** 2026-06-29

## Status

✅ **READY FOR CLEANER**

## Work Completed

### BL-002: Stall detection (commit 1f9b68a)
- `STALL_THRESHOLD_MS = 120_000` exported constant
- `isStalled(lastChangedAt, now)` pure helper
- `PaneTailer`: tracks `lastChangedAt` per role; emits `StallEvent[]` via `onStall` when state changes
- `SwarmPanel`: forwards `{ type: 'stall', events }` to webview
- Webview: `.tile.stalled { border-color: #d4a017 }` (amber); cleared on next output

### BL-003: Dead tile detection (commit ea155eb)
- `DeadEvent` interface exported from paneTailer
- `PaneTailer`: tracks `liveRoles` and `deadRoles` sets; emits `DeadEvent[]` via `onDead` when a previously-live session disappears or recovers
- Does not crash on missing session (existing behaviour preserved)
- `SwarmPanel`: forwards `{ type: 'dead', events }` to webview
- Webview: `.tile.dead { border-color: #e53935 }` (red); clears on recovery
- Existing error message text in tile is retained alongside the red border

## Test Results

105 tests pass; 0 fail.

---

**Coder: BL-002 + BL-003 complete**
