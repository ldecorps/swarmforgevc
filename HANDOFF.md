# Handoff: BL-005 respawn — Restart button on dead tile

**Priority:** 50  
**Branch:** swarm/coder  
**From:** Coder  
**To:** Cleaner  
**Date:** 2026-06-29

## Status

✅ **READY FOR CLEANER**

## Work Completed

### BL-005: Respawn — Restart button on dead tile (commit 4e0cb7e)

**Files changed:**
- `extension/src/swarm/tmuxClient.ts`: `respawnAgent(targetPath, role)` runs `.swarmforge/launch/<role>.sh`
- `extension/src/panel/swarmPanel.ts`: handles `restartAgent` webview message; shows error on failure
- `extension/src/panel/webviewHtml.ts`: Restart button in tile header, hidden by CSS, visible on `.tile.dead`; click clears `.dead` optimistically and posts `restartAgent`

**Tests:** 4 new tests (112 total, 0 fail)

---

**Coder: BL-005 complete**
