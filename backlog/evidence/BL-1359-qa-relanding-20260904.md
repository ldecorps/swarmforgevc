# BL-1359 — QA re-verification and land, 2026-09-04

## Context

Resumed via coordinator `note` (priority `00`): "BL-1359 already
QA-approved (ea2917409f) unlanded, not fresh coder work." Confirmed:
`ea2917409f` (`BL-1359-qa-approval-20260903.md`) is an already-ancestor of
this worktree's HEAD but not of `origin/main`. It was blocked purely by the
shared-`index.js`-registry deadlock (`BL-1359-land-escalate-20260903.md`,
2026-09-03: three genuinely-unlanded siblings on the same file — BL-1296,
BL-1309, BL-1356). All three named blockers are now resolved: BL-1296 and
BL-1309 landed by QA this session (`a72336cd8f`, `f7b512ea80`); BL-1371
(directory discovery, landed 2026-09-03) removed the shared-file coupling
mechanism itself, so no `index.js` edit is needed for ANY handler
registration going forward.

## Re-verification

BL-1359's own code has not changed since its QA approval; re-ran rather
than trusted, given a day and several intervening lands:

- `npm run compile` — clean.
- `bb swarmforge/scripts/test/bl1359_merge_charged_test_runner.bb` — ALL
  PASS.
- `npx vitest run --config vitest.properties.config.mjs
  bl1359MergeChargedInvariants` — 3/3 pass, all three declared invariants.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1359-a-merge-is-charged-only-with-what-it-introduced.feature`
  — 7/7 pass, matching the original QA approval's evidence.
- Wiring: `bl1359MergeChargedOnlyWithIntroducedSteps.js` exports
  `registerSteps` (line 309); no `index.js` mention needed under
  discovery (`grep -c` → 0, expected and correct post-BL-1371).
- Process hygiene: no orphaned test/mutation processes before or after.
- `human_approval: approved`, no `ruling_options`/`human_ruling` on this
  ticket — a plain approval, not a disputed-choice case.

## Landing

`bb swarmforge/scripts/land_step_cli.bb
BL-1359-a-merge-is-charged-only-with-what-it-introduced <HEAD>` — expected
`LAND_REPLAY`, not `LAND_ESCALATE`, confirming the three named blockers are
genuinely cleared. Full accounting in `BL-1359-land-success-20260904.md`.

By QA.
