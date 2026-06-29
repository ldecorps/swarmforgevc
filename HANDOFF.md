# Handoff: Checkpoint B — Orchestrator-backed tiles

**Priority:** 50  
**Branch:** swarm/coder  
**From:** Coder  
**To:** Cleaner  
**Date:** 2026-06-29

## Status

✅ **READY FOR CLEANER** — Checkpoint B substrate wired, all new tests pass.

## Work Completed (commit 46b6dcd)

### Modified: SwarmOrchestrator

- `backends` changed from `ShellBackend[]` to `Map<string, ShellBackend>` (key = role name)
- Added `writeToAgent(role: string, data: string)` — forwards stdin to named agent

### New: AgentRunner (`extension/src/orchestrator/AgentRunner.ts`)

- Accepts `RoleConfig[]` (role, displayName, command, args)
- Creates and owns a `SwarmOrchestrator`; exposes `start()`, `stop()`, `getOrchestrator()`, `getRoles()`
- Thin mapping layer between role configs and the orchestrator

### Modified: SwarmPanel

- Added `runner: AgentRunner | undefined` field
- Added `attachRunner(runner: AgentRunner)` — stops any existing PaneTailer, subscribes to
  orchestrator output events, posts `{ type: 'output', updates }` messages to the webview
- Input forwarding: when a runner is attached, routes `input` messages to
  `runner.getOrchestrator().writeToAgent(role, data)` instead of tmux

### Tests

- `agentRunner.test.js` (new) — 3 tests: streaming, getRoles, stop
- `swarmOrchestrator.test.js` — 1 new test: writeToAgent via `sh -c 'read line; echo "$line"'`
- All 10 orchestrator + agentRunner tests pass; prior suite unaffected

## What's Next for Coder

After cleaner pass, the next slice is **wiring the launch command** (`swarmforge.launchSwarm`
in `extension.ts`) to use `AgentRunner` instead of `launchSwarm`/tmux:

1. Read role configs from `.swarmforge/roles.tsv` (or a hardcoded bootstrap config) to produce
   `RoleConfig[]`
2. Create `AgentRunner`, call `start()`, call `panel.attachRunner(runner)` 
3. Store the runner on the extension context so `stopSwarm` can call `runner.stop()`

This completes the "tiles on top of the orchestrator" path and reaches the dogfood checkpoint.

---

**Coder: Checkpoint B substrate complete**
