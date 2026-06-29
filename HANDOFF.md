# Handoff: M1 Orchestrator Enhancements

**Priority:** 50
**Branch:** main
**From:** Coder
**To:** Cleaner
**Date:** 2026-06-29

## Status

✅ **READY FOR CLEANER** — All 115 tests pass.

## Dogfood Checkpoint

**DOGFOOD CHECKPOINT REACHED** — The extension is running against its own repo. Launch and live interactive tiles are functional. The developer has confirmed this.

## Work Completed (commit 6732a31)

### ShellBackend
- Added optional `cwd` to constructor so agents can be spawned in a specific working directory.

### SwarmOrchestrator
- Added `displayName` per `AgentConfig` (falls back to role name).
- Added `cwd` per `AgentConfig`.
- Added `write(role, data)` to send stdin to a specific agent.
- Added `getRoles()` to expose configured role list.
- Changed internal `backends` from array to `Map<string, ShellBackend>` for O(1) lookup by role.

### WorktreeManager — macOS symlink fix
- `ensureWorktree` now uses `fs.realpathSync` when comparing the expected worktree path to git's registered paths.
- Root cause: git resolves `/var/folders` → `/private/var/folders` (macOS symlink), but `path.resolve` does not. The reuse test caught this.

### package.json
- Added `swarmforge.agentCommand`, `swarmforge.agentArgs`, `swarmforge.roles` config stubs (marked reserved for future standalone orchestrator mode; current launch path uses `./swarm`).

### swarmforge.conf
- Added `--remote-control SwarmForge-Coder` and `--remote-control SwarmForge-Cleaner` to agent windows.

## Test Coverage
- 9 tests for SwarmOrchestrator (up from 5)
- 5 tests for ShellBackend (up from 4)
- 6 tests for WorktreeManager (up from 5, including the reuse/symlink test)
- 115 total, all pass

## M1 Feature Status

All Milestone 1 features are complete:
- ✅ A. Launch swarm (`swarmforge.launchSwarm`)
- ✅ B. Live interactive tiles (`SwarmPanel` + `PaneTailer`)
- ✅ 1. Target selection + Initialize (`swarmforge.setTarget`, `swarmforge.initializeTarget`)
- ✅ 2. Stop (`swarmforge.stopSwarm`)
- ✅ 3. Pipeline awareness (`swarmState.ts`, stage poller in panel)
- ✅ 4. PR at end (`swarmforge.openPR`)
- ✅ 5. Named runs (`runLog.ts`, `swarmforge.showRuns`)

---

**Coder: M1 orchestrator enhancements complete**
