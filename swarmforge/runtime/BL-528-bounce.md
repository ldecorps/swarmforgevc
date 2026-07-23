# BL-528 bounce — coordinator partial return (2026-07-21)

Your attempted git_handoff to cleaner **did not run**. `tmp/handoff.txt` was
gitignored (aider skipped it). No outbox parcel, no rotation, in_process never
completed.

## Fix before any handoff

1. **Implement `extension/src/metrics/claimLiveness.ts`** — tests already import
   it; `claimTracker.ts` and `claimHealer.ts` depend on it. Make
   `claimLiveness.test.ts` pass.

2. **Run tests** — from coder worktree:
   `cd extension && npm test -- --testPathPattern='claim'`
   All claim* tests must pass (compile + run).

3. **TDD for remaining slices** — failing test first, then minimal src, then
   green test. No more feat-then-test commit pairs.

4. **Decide `extension/src/swarm/bounceWatcher.ts`** — untracked; finish with
   tests or delete if out of scope.

5. **Wire integration** — heartbeat/claim tracker must match BL-528 outcome
   (idle reclaim → nudge → reassign → halt). Read
   `backlog/active/BL-528-auto-heal-claim-without-progress.yaml`.

## Handoff protocol (when green)

- Draft: `swarmforge/runtime/handoff-draft.txt` (NOT `tmp/` — gitignored)
- Run: `! ./swarmforge/scripts/swarm_handoff.sh swarmforge/runtime/handoff-draft.txt`
- Commit abbrev: **exactly 10** hex chars (e.g. `a8c3e31358`)
- Then: `! ./swarmforge/scripts/rotate_to_role.sh cleaner`
- Do NOT handoff until `npm test` passes.
