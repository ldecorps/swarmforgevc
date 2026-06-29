# Handoff: M1 dogfood checkpoint + dead code removal

**Priority:** 50  
**Branch:** swarm/coder  
**From:** Coder  
**To:** Cleaner  
**Date:** 2026-06-29

## Status

✅ **READY FOR CLEANER**

## Work Completed

### Deleted dead standalone-orchestrator code

Removed all files from the abandoned bootstrap-brief direction:

- `extension/src/orchestrator/AgentRunner.ts`
- `extension/src/orchestrator/SwarmOrchestrator.ts`
- `extension/src/orchestrator/InteractiveProcess.ts`
- `extension/src/orchestrator/MessageBus.ts`
- `extension/src/orchestrator/WorktreeManager.ts`
- `extension/src/orchestrator/ShellBackend.ts`
- `extension/src/orchestrator/headless/` (agentA.js, agentB.js)
- `extension/src/swarm/roleConfigReader.ts`
- Tests: agentRunner, swarmOrchestrator, shellBackend, headlessHandoff, messageBus, worktreeManager, roleConfigReader

`npm run compile` passes. No remaining imports of deleted modules.

### Added dogfood checkpoint notification (SwarmPanel + extension.ts)

- `SwarmPanel.notifyDogfoodCheckpoint()`: shows a one-time VS Code info notification per session using a `dogfoodShown` boolean flag; subsequent calls are no-ops.
- `extension.ts` `launchSwarm` command calls `panel.notifyDogfoodCheckpoint()` after the panel opens post-launch.
- Removed the `attachRunner` method and `runner` field from `SwarmPanel` (dead after orchestrator removal).
- Input forwarding simplified: `input` messages go directly to `tailer?.forwardInput`.

## Test Results

89 tests pass; 0 fail.

---

**Coder: M1 dead-code removal and dogfood checkpoint complete**
