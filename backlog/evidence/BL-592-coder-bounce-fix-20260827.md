# BL-592 coder bounce fix — 2026-08-27

## Architect bounce addressed

`backlog/evidence/BL-592-architect-bounce-20260827.md` (architect worktree)
D1: `bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js`'s `mkFixture()`/
`ctx.bridgeHandle` leaked on any throw before a scenario's own manual
`stopBridge(ctx)` cleanup step.

## Fix

`runtime.js`'s `runScenario` has no per-scenario teardown hook of its own
(verified — bare `context = {}` and a step loop, no try/finally), and the
registry (`stepRegistry.js`) exposes only `{ define, defineScoped, resolve
}` — no `after`/`afterEach`. Used node:test's own `afterEach` instead,
registered once at this step file's module scope, scoped to only the
current scenario's `ctx` via a module-level `currentCtx` tracked by the
Background step (`the live Mini App console spec tree screen is open`,
which every scenario in this feature runs first) and `ensureBridge` as a
safety net. Unconditionally stops the bridge handle and `fs.rmSync`s
`ctx.root` after every scenario, pass or fail. Verified directly: a step
made to throw mid-scenario still had its fixture dir removed afterward (not
merely inferred from the acceptance suite's own happy-path green).

Existing manual `stopBridge(ctx)` calls in three `Then` steps were left in
place (idempotent no-op once already stopped), per the bounce's own
remediation note.

## A second defect found and fixed while verifying

Re-running the acceptance suite to confirm D1's fix hit `git add -A`/`git
commit` failures inside `mkFixture()`/`writeYaml()` — `fatal: Unable to
create '.../swarmforgevc/.git/index.lock': File exists` — because those
`execFileSync('git', ...)` calls never scrubbed the ambient `GIT_DIR`/
`GIT_WORK_TREE` env vars from this session before shelling out, so under
concurrent scenarios the "isolated" `cwd`-scoped fixture repo silently
became the real shared repo instead. Same class of bug as
`backlog/evidence/BL-1124-property-fixture-git-env-leak-20260827.md` (this
session), a different file. Fixed in-file (already the file this bounce touches) with a
small `git(args, cwd)` helper that deletes `GIT_DIR`/`GIT_WORK_TREE` from a
copied `env` before every call, matching the established good pattern in
`extension/test/helpers/sharedRepoFixture.js`.

## Verification

- Acceptance: 8/8 scenarios green, zero leaked `/tmp/sfvc-bl592-*`
  directories after the run (previously 84 per the architect's own repro).
- Direct cleanup-on-throw check: a step forced to throw mid-scenario still
  had `ctx.root` removed by the `afterEach` hook afterward.
- Unit regression: `docsTree.test.js` (42), `pwaDocsExplorer.test.js` (26)
  — unaffected, still green.

## Forward

`git_handoff` to cleaner, priority `50`, task
`BL-592-spec-tree-on-live-console-with-epic-tier`.

By coder.
