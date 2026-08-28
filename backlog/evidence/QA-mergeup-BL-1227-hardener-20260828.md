# QA merge-up (BL-1227, commit df9899feb) — hardener worktree, 2026-08-28

QA note: "BL-1227 QA-approved df9899feb — merge your branch up to QA's."

`git merge df9899feb` produced 3 conflicts. All three were the same class:
QA's line had already reverted a botched "Merge coder BL-1227 for QA
verification" (`778991d21`, undoing `97b88aa8b`) that had entangled BL-1227's
tip with BL-1192/BL-1207/BL-1211/BL-1216's still-bounced content (see main's
own bounce trail: `002a4c672`, `42b5cd4dd`, `7bb2f56a4`, `dff356cc1`), then
landed a clean "tip-pure rebuild" of BL-1227 alone (`8c47abc2d`). My worktree
still carried a hardening pass (`9ead4600d`) built on top of the
now-reverted, still-bounced BL-1211 content (`recoveryFilterCliArgs.ts` /
`recovery-filter-check.ts`).

Per BL-490/BL-495 ("confirm CONTENT is gone, never by ancestry") and per
BL-1211's own subject matter (a recovery must never resurrect content a
bounce revert removed) — resolving these conflicts by keeping my side would
have reproduced exactly the defect BL-1211 exists to prevent. Resolved all
three toward QA's reverted state instead:

1. `extension/src/tools/recoveryFilterCliArgs.ts` (modify/delete) — deleted
   (matches df9899feb; confirmed absent from both `main` and df9899feb).
2. `specs/pipeline/steps/index.js` — dropped requires for
   `bl1192TaskScopeGateSteps`, `bl1207AbandonedLockLivenessSteps`,
   `bl1216DuplicateIdLiveCopyContentVerdictSteps` (files no longer exist on
   either side); kept `bl1227BootPrefixLiveBudgetCheckSteps` (common to
   both) and my own `bl1228ActivePoolFreshnessHoldAuditSteps` (unrelated,
   still-active ticket, unaffected by this entanglement).
3. `swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb` — dropped
   the BL-1216 test block (`path-pool`/`pool-classification`/
   `content-verdict`/duplicate-id `format-violation` cases); confirmed
   `backlog_hygiene_lib.bb` no longer defines those functions on either
   side (BL-1216 reverted with the rest).

One follow-on fix not part of the raw merge: `extension/test/bl1211OperatorCli.test.js`
(my own file, unmodified by the merge) required the now-deleted
`../out/tools/recovery-filter-check`, which would have crashed the whole
file at load. Split it: kept the still-valid `quarantine-lift-check.ts`
parseArgs/main() coverage (that source file is untouched, still on main),
removed the `recovery-filter-check`-specific tests and require.

## Verification
- `npm run compile` — clean.
- `bb swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb` — all pass.
- `node -e "require('./specs/pipeline/steps/index.js')"` — loads clean.
- `npx vitest run test/bl1211OperatorCli.test.js` — 5/5 green.
- `run_acceptance.sh specs/features/BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature` — 7/7 green.
- `npx vitest run test/cursorBridgeAgentSession.test.js test/telegramFrontDeskBotCli.test.js test/activePoolFreshnessAudit.test.js` (the three auto-merged, no-conflict test files) — 355/355 green.
- `grep -rl "recoveryFilterCliArgs\|recovery-filter-check"` across `extension/src`, `extension/test`, `specs/pipeline/steps` — no remaining references after the fix above.
- `grep -rl "task_scope_gate_lib\|task-scope-gate"` across `swarmforge/scripts/*.bb`, `swarmforge/scripts/test/*.bb`, `specs/pipeline/steps/*.js` — none (BL-1192's deletion is clean).

Per "QA merge-up broadcast (worktree roles)": merged, resolved, verified —
no forward, ending here with `done_with_current.sh`.

By hardener.
