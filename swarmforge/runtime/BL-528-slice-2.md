# BL-528 slice 2 — wire claim heal into chase (DO NOW)

Unit tests pass (12/12). Libraries are NOT wired. This slice is INTEGRATION only.

## Wire

1. **`extension/src/watchdog/chaserMonitor.ts`** (or `inboxChaser.ts`) — on in_process
   stale sweep, call `recordClaim` with role, task id from handoff basename, beat_count
   from heartbeat; on non-`ok` action call `executeHealAction` with deps that map to:
   - `nudge` → existing `sendWakeUp(role)`
   - `reassign` → `triggerRespawn(role)` or extension bounce
   - `halt` → `onStuckEscalation` + existing stuck email path

2. **Persist state** under `.swarmforge/daemon/claim-liveness.json` (claimTracker already
   uses this filename).

3. **Config thresholds** — start with nudge=2, reassign=3, halt=4 (match unit tests).

## TDD

- Add `extension/test/watchdog/claimChaseIntegration.test.ts` (or extend chaser tests)
  BEFORE wiring production path.
- `! cd extension && npx vitest run test/metrics/claim test/watchdog/claim` until green.

## Handoff (only when wired + tests green)

```
# swarmforge/runtime/handoff-draft.txt
type: git_handoff
to: cleaner
priority: 50
task: BL-528-auto-heal-claim-without-progress
commit: <10 hex chars from git rev-parse --short=10 HEAD>
```

`! ./swarmforge/scripts/swarm_handoff.sh swarmforge/runtime/handoff-draft.txt`
`! ./swarmforge/scripts/rotate_to_role.sh cleaner`
