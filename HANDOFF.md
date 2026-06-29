# Handoff: Checkpoint A Step 5 — Two-Agent Headless Handoff

**Priority:** 50  
**Branch:** main  
**From:** Coder  
**To:** Cleaner  
**Date:** 2026-06-29

## Status

✅ **READY FOR CLEANER** — Checkpoint A step 5 implemented, all new tests pass.

## Work Completed

### New: SwarmOrchestrator (commit 2fc6894)

Implemented `extension/src/orchestrator/SwarmOrchestrator.ts`:
- Takes `AgentConfig[]` (role, command, args)
- Spawns each as a `ShellBackend`
- Labels output chunks with role name via `onOutput`
- Reports exits with role + code via `onAgentExit`
- `stop()` kills all running agents
- `waitAll()` resolves when all agents have exited

### New: Headless mock agents

- `extension/src/orchestrator/headless/agentA.js` — writes a handoff message to agent-b's inbox and exits
- `extension/src/orchestrator/headless/agentB.js` — polls the MessageBus inbox, acks the first pending message, exits

### New: Tests

- `extension/test/swarmOrchestrator.test.js` — 6 unit tests for SwarmOrchestrator
- `extension/test/headlessHandoff.test.js` — 1 integration test: two agents exchange a real handoff via MessageBus from a terminal

All 7 new tests pass. Prior 78 tests unaffected (no production files modified).

## Checkpoint A Status

Per `docs/bootstrap-brief.md`:
- ✅ InteractiveProcess seam
- ✅ ShellBackend
- ✅ WorktreeManager
- ✅ MessageBus (atomic write via tmp+rename)
- ✅ Two-agent handoff, headless (step 5 — done in this commit)
- ❌ LanguageModelRoleRuntime (step 6 — needs extension host / vscode.lm; out of coder scope for now)

## What's Next for Coder

After cleaner pass, the next M1 behavior slice is wiring the VS Code webview tiles to
`SwarmOrchestrator`-spawned processes (Checkpoint B) instead of tmux panes. This means:
1. An `AgentRunner` that maps role configs to `AgentConfig` and starts the orchestrator
2. The panel subscribing to `SwarmOrchestrator.onOutput` instead of `PaneTailer`

---

**Coder: Checkpoint A step 5 complete**
