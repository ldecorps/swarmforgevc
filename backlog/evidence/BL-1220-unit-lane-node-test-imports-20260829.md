# BL-1220 — the unit lane's node:test imports, repaired and measured

Coder, 2026-08-29. Evidence for `qa_e2e_procedure` steps 2, 3 and 6, and for
invariant 3 (test-count preservation).

## What was found, re-enumerated at implementation time

The ticket's own note says the count drifts and must be re-measured, never
taken from the ticket. Measured in this worktree before the change: **24**
main-lane files carried a top-level `node:test` import.

One of the 24 is `propertyGeneratorReachCheck.test.js`. A first sweep filtered
the file list with `grep -v property` and lost it — its NAME contains
"property" but its suffix is `.test.js`, so it is a unit-lane file. The guard
caught it on its first run against the real tree, which is the guard earning
its place before it was even committed.

`benchmarkNodeTestEvaluator.test.js` appears in the ticket's list but carries
`node:test` only inside quoted fixture STRINGS — it declares nothing to
node:test and is correctly left alone. The guard does not flag it.

## Declared vs collected, per repaired file

Declared = `test(`/`it(` declarations in the pre-change file at HEAD.
Collected = tests Vitest reports for the repaired file.

**Totals: 219 declared, 219 collected. Zero shortfalls.** Invariant 3 holds
file by file, not just in aggregate.

| file | declared | collected |
|---|---|---|
| bl1147ProbeLegacyTopicAdoption.test.js | 9 | 9 |
| bl1150OutageFailoverCliLoadFileSafe.test.js | 3 | 3 |
| contextTelemetryProducer.test.js | 5 | 5 |
| crossFileDuplicationCheck.test.js | 7 | 7 |
| devBounceLib.test.js | 35 | 35 |
| hostActivityFeed.test.js | 6 | 6 |
| humanLoopReliability.test.js | 6 | 6 |
| multiBranchParserCoverageCheck.test.js | 9 | 9 |
| multiworktreeAcceptanceFixture.test.js | 9 | 9 |
| nightClosingCeremony.test.js | 10 | 10 |
| nightClosingCeremonyGate.test.js | 3 | 3 |
| nightClosingCeremonyLive.test.js | 8 | 8 |
| nightClosingCeremonyRun.test.js | 2 | 2 |
| operatorPostmortem.test.js | 5 | 5 |
| pendingApprovalsAnnouncement.test.js | 5 | 5 |
| perHatRolePromptEvidenceCheck.test.js | 7 | 7 |
| pilotAcceptanceGate.test.js | 32 | 32 |
| pilotMkdtempConventionCheck.test.js | 3 | 3 |
| pilotScopedCrapCheck.test.js | 8 | 8 |
| propertyGeneratorReachCheck.test.js | 4 | 4 |
| shellEntryPointDriveCheck.test.js | 9 | 9 |
| telegramCursorBridgePilot.test.js | 21 | 21 |
| transcriptWalker.test.js | 3 | 3 |
| unreachableStepHandlerCheck.test.js | 10 | 10 |
## Full-suite effect (step 3)

| | failing FILES | failing tests | files collecting zero tests |
|---|---|---|---|
| before | 37 | 17 | 24 |
| after  | 20 | 33 | 0 |

Failing files dropped by **17** (the ticket's floor is 15). Failing *tests*
rose, which is the point: 16 assertions that had not executed since BL-124 now
run and fail honestly on BL-1221's separate defect.

## The one file that needed more than the import deletion

`hostActivityFeed.test.js` used `test.beforeEach(...)` — node:test hangs that
hook off the `test` function; Vitest supplies `beforeEach` as its own global.
With only the import removed the file threw `test.beforeEach is not a function`
and collected **zero** tests, which invariants 1 and 2 forbid outright. The
binding was moved to the global (`test.beforeEach` → `beforeEach`), which is
the same runner-binding repair the import deletion is, not a rewrite of any
assertion. It now collects 6 of 6 declared. Called out here rather than left
for a reviewer to find, because it is the only file in the set whose repair was
not literally the deletion of one line.

## Remaining failures, all attributed

Seven files, sixteen tests, all `TypeError: deps.checkOrphanedAuthoredDocs is
not a function` — BL-1221's defect, named in this ticket's own `out_of_scope`
as the expected intermediate state:

    crossFileDuplicationCheck.test.js (2)   pilotAcceptanceGate.test.js (8)
    multiBranchParserCoverageCheck.test.js (1)  pilotScopedCrapCheck.test.js (2)
    perHatRolePromptEvidenceCheck.test.js (1)   shellEntryPointDriveCheck.test.js (1)
    unreachableStepHandlerCheck.test.js (1)

Nothing was allowlisted, skipped, or deleted to clear the lane, and the guard
ships with no allowlist parameter and no skip path — the mechanism that made
the property lane's copy of this defect invisible is not introduced here.

The other 13 failing files are the pre-existing, separately-owned reds the
ticket lists as out of scope (repo-hygiene guards, the CURSOR_API_KEY gap, the
backfill/telegram reds). None of them changed.

## Step 6 — what still mentions node:test in the unit lane

Four files, none of them an import:

- `nodeTestImportGuard.test.js` — the guard's own fixture strings (data).
- `benchmarkNodeTestEvaluator.test.js` — fixture strings for the benchmark
  evaluator (data).
- `hostActivityFeed.test.js` — a comment explaining the hook move.
- `pilotAcceptanceGateCli.test.js` — a comment.

## Invariants — what is encoded and what is not

- **Invariant 1** ("no unit-lane file declares its tests to a runner the lane
  does not execute") and **invariant 2** ("a file contributing zero collected
  tests fails its lane; never allowlisted, skipped or deleted into a pass") are
  encoded in `extension/test/nodeTestImportGuard.property.test.js`: every
  import form is flagged wherever it sits, the same string as data never is,
  the walk reports every violation with no skip path, and lane membership is
  decided by the lane globs rather than an exemption list. Reachability floors
  are asserted on both sides of each boundary.
- **Invariant 3** ("a repaired file reports the same number of tests it
  declared") is not encodable as a property: it compares a measurement of the
  pre-change tree against a measurement of the post-change tree, which is not a
  pure function's input space, and BL-1038 forbids a test that derives its
  subject from the live repository. The measurement it demands is the table
  above — 24 files, 219 = 219, walked rather than sampled. This is the coder
  role's "stated reason" path for a declared invariant with no executable
  encoding.
