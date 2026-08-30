# BL-1264 — hardener pass, 20260830

Commit reviewed: b52090e9f6 (architect tip, merged into hardener as
`3ace691b22`).

## Re-verification of what the coder/architect already built
- `npx vitest run test/backlogDashboard.test.js` — 51/51 green.
- `npm run test:properties -- bl1264` —
  `bl1264OptionalKeyAbsenceInvariants.property.test.js` 3/3 green.
- `node specs/pipeline/cli.js specs/features/BL-1264-an-absent-approval-context-is-an-absent-key.feature`
  — 4/4 scenarios pass.

## Mutation
- BL-149 cooldown gate on the one changed production file
  (`extension/src/metrics/backlogDashboard.ts`): `DECISION: run`
  (file_age_days 3.70 > 3-day cooldown; load quiet, 6.9 on 20 cores).
- `npx stryker run --mutate out/metrics/backlogDashboard.js --force` —
  blocked at the dry run by the same pre-existing, already-ticketed standing
  red the rest of the fleet is hitting today: `liveRepoDerivationGuard`
  fails on 3 files (`bl1243PaneActivitySignal.test.js`,
  `deprecateRetiredReferents.test.js`, `docsStructureRealTree.test.js`),
  none of which this ticket touches. Tracked as **BL-1291** (paused,
  `backlog/paused/BL-1291-a-live-repo-read-is-pinned-or-justified.yaml`).
  Same shape as today's BL-1182/BL-1277/BL-1281 hardener passes. Not this
  ticket's defect — per BL-1063, checked before reporting.
- Per the BL-638 no-run-tool fallback, hand-authored a mutation sweep
  against the compiled `out/metrics/backlogDashboard.js`'s
  `computeNeedsApproval`, re-running
  `npx vitest run test/backlogDashboard.test.js` after each hand-applied
  mutation, restoring the file (byte-identical diff confirmed) afterward:
  - Revert the conditional spread back to the old unconditional
    `approvalContext: item.approvalContext` — KILLED (2 failed, exactly the
    ticket's predicted regression).
  - Flip the ternary's `=== undefined` to `!== undefined` — KILLED (4
    failed).
  - Flip the filter predicate `humanApproval === 'pending'` to `!==` —
    KILLED (8 failed).
  - Substitute the empty-object branch with a sentinel
    (`{ approvalContext: '' }` instead of `{}`) — the exact substitution the
    ticket's constraints forbid — KILLED (3 failed).
  - Swap `title: item.title` for `title: item.id` — KILLED (2 failed).
  All 5 mutants killed, 0 survivors, 0 skipped. File restored, diffed
  byte-identical against the pre-mutation compiled output, suite re-run
  clean (51/51) before continuing.

## CRAP
`node scripts/crapReport.js src/metrics/backlogDashboard.ts` —
`computeNeedsApproval` CRAP=1.00 (complexity=1, coverage=100%). Every
function in the file is <= 6 (max in file: 5.00). No regression; `out/`
scoping error not made (CRAP run against `src/*.ts`, per the shared rule).

Coverage report needed `--coverage.reportOnFailure=true` to be written at
all — the full suite carries the same standing unrelated reds noted below,
which by default suppress Vitest's coverage-final.json write. Per the
accepted rule_proposal (2026-08-30), forced the report and read it; no file
touched by this ticket is among the failing tests, so the number is not a
floor for backlogDashboard.ts specifically.

## DRY
`npx jscpd src/metrics/backlogDashboard.ts --min-lines 5 --min-tokens 50` —
0 clones found.

## Whole-tree standing guards
Parcel touches `extension/test/` and `specs/pipeline/steps/`, so ran all 17
non-property `test/*Guard*.test.js`: 3 failed —
`liveRepoDerivationGuard`, `socketFixtureShortRootGuard`,
`tempDirTrapGuard` — the same confirmed pre-existing standing-red set named
in today's BL-1182/BL-1277/BL-1281 hardener passes; none names `bl1264` or
`backlogDashboard`. 14/17 pass, 171/174 tests pass.

## Full suite
`npx vitest run --coverage --coverage.reportOnFailure=true`: 25 failed /
556 passed test files (221 failed / 9581 passed tests) — the same standing
baseline shape reported across today's other hardener passes; no new
failure names this ticket's files.

## Orphan process check
`pgrep -fl 'node --test|stryker'` before and after: only this worktree's
own shell/bash entries, no leftover node/stryker workers. Nothing leaked.

## Out-of-scope observation — unrelated dirty tree in this worktree
At the time of this pass, `git status` in this worktree also showed 6
tracked files modified (`swarmforge/constitution/articles/02_handoffs.md`,
`swarmforge/roles/architect.prompt`, `swarmforge/roles/cleaner.prompt`,
`swarmforge/scripts/handoff_lib.bb`, `swarmforge/scripts/swarm_handoff.bb`,
`swarmforge/scripts/swarmforge.sh`) plus 3 untracked files under
`swarmforge/scripts/`, none of which this session created or edited and
none of which touch BL-1264's files. They read as in-progress reverse-hop
propagation work (Article 2.3's back-one/back-all) from a concurrent
process in this same worktree. Left entirely untouched and unstaged per
"never delete/sweep what you did not create" — not part of this commit.

## Verdict
Hardened. No real gap found (all 5 hand-authored mutants killed on first
try); no code change needed from this stage. Stryker itself blocked by an
already-known, unowned baseline defect (BL-1291); hand-authored sweep
substituted per BL-638. Forwarding the received commit (no functional
change from this stage) to documenter.

By hardener.
