# BL-1598 — coder rebuild evidence, 2026-09-16 (on QA's Article 4.2 hold, amendment 92e8ec9499)

## Context

QA held the original parcel three times on 2026-09-16 at ~15:50Z (load 6.4
to 9.0): the register's numbers had drifted from the 13:16Z measurement
with no code change (three registered rows fell under 80% of budget; one
unregistered file, `emitLifecycleSnapshotCli.test.js`, rose to ~9.0s). The
specifier ruled the design — a snapshot gate that refuses on drift — was
the defect (`backlog/evidence/BL-1598-specifier-hold-adjudication-20260916.md`),
amended the ticket, and routed the fix to the coder (Article 4.3 — the
guard is the coder's domain; the spec defect is the specifier's, per
BL-990 the coder is not charged for this bounce).

## The rebuild

`check-suite-file-budget.ts`:
- `NEW_POLE_REFUSAL_FRACTION = 1.5` beside `PER_FILE_DURATION_BUDGET_MS`.
- `BudgetVerdictKind` gains `watch`; `BudgetCheckResult` gains `watchFiles`.
- `checkFileDurationBudget`: an unregistered file over budget but under
  `budgetMs * 1.5` is now `watch` (reported, `watchFiles`), never
  refused; at or above that line it is `new-pole` (refused, `offenders`,
  unchanged shape). A stale registered row is now reported
  (`staleRows`), **never refused** — `passed` now depends only on
  `offenders`/`unownedRows`. Headline verdict precedence (the amendment's
  own order): new-pole, unowned-row, watch, stale-row, ok.
- `formatGuardReport`: `watchFiles` and `staleRows` both move to
  `infoLines` (reported); only `offenders`/`unownedRows` remain in
  `failureLines`.

`testDurationRecorderLib.js`'s `buildRecord` gains `watch_files` (count),
independent of `result`/`budget_verdict` exactly like `new_offenders`.
`recordTestDuration.js` passes `guardVerdict.watchFiles.length` through.

## A pre-existing regression found and fixed in the same pass

Sweeping every consumer of `checkFileDurationBudget`/`check-suite-file-budget.ts`
(not just the files this ticket's own required_wiring names) turned up
`specs/pipeline/steps/noSingleFileBoundsTheSuiteSteps.js` — BL-378's own,
earlier acceptance feature (`specs/features/BL-378-no-single-file-bounds-the-suite.feature`).
Its scenario 04 structural check asserted `recordTestDurationSource`
still referenced `BUDGET_GUARD_CLI` and spawned it as a subprocess — the
architecture my **original** BL-1598 commit (5d98ea9a4d) replaced with an
in-process `runGuardAgainstReport` call. This broke silently: nothing in
`npm test` or the BL-1598 acceptance run exercises BL-378's own feature
file, so it went unnoticed through the original parcel's cleaner/
architect/hardener/documenter/QA pass. Running
`./specs/pipeline/scripts/run_acceptance.sh specs/features/BL-378-*.feature`
directly confirmed 3 of 4 scenarios failing (1 from this original
regression, 2 more from this rebuild's own 1.5x threshold change, since
the feature's own fixtures used `budgetMs + 1000`/`+2000`, now inside the
watch band). Fixed in this same commit: the structural check now asserts
`runGuardAgainstReport` and the unconditional
`fs.existsSync(REPORT_PATH)` guard; the two duration fixtures moved to
`budgetMs * 2`/`* 3` (clearly past 1.5x, preserving each scenario's own
intent — "exceeds that budget" meaning "exceeds it clearly enough to
refuse", never a probe of the watch band this feature predates).
`./specs/pipeline/scripts/run_acceptance.sh specs/features/BL-378-*.feature`
now 4/4.

## Verification

- `checkSuiteFileBudgetCli.test.js`: rewrote the three exact-shape
  assertions that assumed "any breach refuses" (8000ms vs 7000 budget is
  now `watch`, not `new-pole`); added an explicit watch-band test and a
  `main()`/subprocess-CLI watch test. 15 tests, all green.
- `testDurationRecorderLib.test.js`: updated the two exact-`deepEqual`
  `buildRecord` tests for the new `watch_files` field; added a
  watch-specific independence test. 9 tests, all green.
- `bl1598SuitePoleRegister.property.test.js` (coder-authored, BL-654):
  rewrote both declared-invariant-1 properties for the amended threshold
  (at/above 1.5x always new-pole; strictly between budget and 1.5x always
  watch, never refused) plus a third property covering the WHOLE duration
  range at once (no register). Non-vacuity re-checked by hand: hardcoding
  `passed` to `true` fails 2 of 3 properties immediately; reverted and
  reconfirmed green.
- Acceptance (`BL-1598-*.feature`): 12/12 subtests green (scenario 01 now
  6 rows, scenario 02 now 5 rows, scenario 03 unchanged at 9 rows).
- Acceptance (`BL-378-*.feature`, the pre-existing regression fixed
  above): 4/4 green.
- qa_e2e_procedure step 1, live: a fresh `npm test` run on this host
  (load ambient, unknown but clearly present given the earlier drift)
  now exits **0** — `emitLifecycleSnapshotCli.test.js` (9677 ms) resolves
  to `watch` (under the 10500 ms line), `pilotAcceptanceGateCli.test.js`
  and `recordBounceCli.test.js` resolve to `stale-row` (reported), 6
  files remain `ok` registered poles. The recorded row:
  `{"result":"pass","new_offenders":0,"watch_files":1,"budget_verdict":"watch"}`.
  This is the exact drift QA observed, now correctly absorbed without a
  refusal — direct confirmation the amendment fixes the hold.
- qa_e2e_procedure step 2, live, against the real report: appending a
  synthetic 100ms row → `stale-row` reported, `passed: true`. Removing
  the real bl968 row (69.9s) → `new-pole` refusal naming it. A scratch
  report with an unregistered file at 9000ms → `watch` naming it,
  `passed: true`. All three confirmed directly via `runGuardAgainstReport`
  against the real `.vitest-report.json`.
- qa_e2e_procedure step 3: `backlog/suite-poles.tsv` unchanged (9 rows,
  scenario 03 still pins this) — the amendment's own FIRM wording ("No
  register row is added for emitLifecycleSnapshotCli... BL-791's slice D
  inventory gains it").
- qa_e2e_procedure step 4: acceptance, above.

## Scope

Files touched: `check-suite-file-budget.ts`, `testDurationRecorderLib.js`,
`recordTestDuration.js`, their three test files, the BL-1598 feature +
step handler, and the BL-378 step handler (the regression fix). No
`backlog/suite-poles.tsv` change (unchanged per FIRM wording).
`emitLifecycleSnapshotCli` gets no register row — it is a watch file;
BL-791's slice D inventory is documenter/specifier territory, not this
parcel's.
