# BL-1598 — coder resume after architect bounce, 2026-09-16

## Bounce recap

Architect bounced (`backlog/evidence/BL-1598-architect-bounce-20260916.md`,
commit `32fb5fd439`, blamed coder): the coder-rebuild commit
(`2bc9a2b80c`, `backlog/evidence/BL-1598-coder-rebuild-20260916.md`)
applied the QA-hold amendment (watch band, 1.5x new-pole line, stale
reports never refuse) but in doing so replaced
`extension/test/checkSuiteFileBudgetCli.test.js` with a 15-test file that
imports only `main, extractFileDurations, checkFileDurationBudget,
formatBudgetOffenders, PER_FILE_DURATION_BUDGET_MS,
NEW_POLE_REFUSAL_FRACTION` — dropping all unit coverage of
`parseRegisterRows`, `openTicketIds`, `runGuardAgainstReport`,
`formatGuardReport`, and `printGuardReport` the hardener's earlier pass
(`backlog/evidence/BL-1598-hardender-20260916.md`) added to close a scoped
Stryker gap (42 survived + 83 no-coverage mutants) and bring
`checkFileDurationBudget`'s CRAP from 12 to under 6.

## Finding: already fixed in this worktree, by an earlier merge

This coder worktree's branch already carries the full fix. Traced via
`git log --oneline 2bc9a2b80c..HEAD -- extension/test/checkSuiteFileBudgetCli.test.js`:
commit `6fd600caef` ("Merge QA eb831c9ec6 into cleaner.", 2026-09-16
17:03:05, i.e. BEFORE the architect's 17:30:48 bounce) hand-resolved a
real merge conflict on `check-suite-file-budget.ts` and its test file,
with its own message recording the resolution explicitly: "Resolved
conflict in check-suite-file-budget.ts: kept BL-1598's amended [version]
... and both acceptance features (BL-378, BL-1598) pass." That merge
brought forward `eb831c9ec6`'s side, which still carried the hardener's
full 45-test coverage (pre-rebuild), reconciled against the amended
(watch-band/1.5x) assertions — i.e. exactly the "keep the rebuild's
amended assertions AND restore full coverage" shape the architect's own
remediation asked for, arrived at independently via a parallel
worktree's merge before the bounce was even filed.

`main`'s own copy of the ticket (`git show main:backlog/active/BL-1598-...yaml`)
still shows `bounce_count: 1` (QA's bounce only) — the architect bounce
exists only on the not-yet-landed pipeline branches, confirming this is a
live, current bounce this resume answers, not stale history.

## Re-verification (this worktree, HEAD after merging QA's BL-1548 land)

- `tsc --noEmit -p .` clean.
- `npx vitest run test/checkSuiteFileBudgetCli.test.js` — **45/45 tests
  pass** (matches pre-rebuild coverage: `parseRegisterRows`,
  `openTicketIds`, `checkFileDurationBudget`'s full decision table,
  `formatGuardReport`, `printGuardReport`, `runGuardAgainstReport`, `main()`
  — all present, all using the AMENDED assertions: stale-row reports not
  refuses, 11000ms/1.5x new-pole line, `watchFiles` present on every
  `BudgetCheckResult` fixture).
- `npx vitest run test/bl1598SuitePoleRegister.property.test.js --config vitest.properties.config.mjs`
  — 3/3 pass.
- `./specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1598-*.feature`
  — 12/12 scenarios pass (scenario 01's 6 amended rows, scenario 02's 5
  rows including the two new `watch`/`stale-row` cases, scenario 03's 9
  registered poles).
- `extension/src/tools/check-suite-file-budget.ts` inspected directly:
  `NEW_POLE_REFUSAL_FRACTION = 1.5`, `BudgetVerdictKind = 'ok' | 'watch' |
  'stale-row' | 'unowned-row' | 'new-pole'`, `watchFiles` on
  `BudgetCheckResult`, verdict priority new-pole > unowned-row > watch >
  stale-row > ok — matches the amendment throughout.
- `extension/scripts/testDurationRecorderLib.js` carries `watch_files`
  beside `pole_ms`/`work_ms`/`new_offenders`/`budget_verdict`.
- `backlog/suite-poles.tsv`: 9 rows, unchanged.

No production or test code changed in this commit — this resume is
evidence-only, recording that the bounce's D1 defect is not present on
this branch's tip and why, so the pipeline can proceed from a verified
state rather than re-deriving the same fix a parallel worktree already
made.

By coder.
