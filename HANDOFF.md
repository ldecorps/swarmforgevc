# Handoff: BL-002 stall detection

**Priority:** 50  
**Branch:** swarm/coder  
**From:** Coder  
**To:** Cleaner  
**Date:** 2026-06-29

## Status

✅ **READY FOR CLEANER**

## Work Completed

### BL-002: Stall detection — amber tile border after 120s of no output

**Files changed:**
- `extension/src/panel/paneTailer.ts`
  - Exported `STALL_THRESHOLD_MS = 120_000` constant
  - Exported `isStalled(lastChangedAt, now)` pure helper
  - Added `lastChangedAt` map: updated when a role's text changes
  - Added `stalledRoles` set: tracks current stall state to emit change-only events
  - Added optional `onStall` callback to constructor
  - `poll()` emits `StallEvent[]` when stall state changes per role
- `extension/src/panel/swarmPanel.ts`
  - Passes `onStall` callback to `PaneTailer`; forwards `{ type: 'stall', events }` to webview
- `extension/src/panel/webviewHtml.ts`
  - CSS: `.tile.stalled { border-color: #d4a017; }` (amber)
  - `case 'stall'`: toggles `.stalled` class per event
  - `case 'output'`: clears `.stalled` on any output update (auto-recovery)

**Tests added:**
- `paneTailer.test.js`: 5 tests for `STALL_THRESHOLD_MS` and `isStalled`
- `webviewHtml.test.js`: 2 tests for stall CSS and stall message handler

## Test Results

102 tests pass; 0 fail.

---

**Coder: BL-002 complete**
