# BL-386 architect review — 20260714

## Verdict: BOUNCE to coder — `pwa/app.js` crashes on an empty `taskIds` battery

## What was reviewed

Merged cleaner's `e6f043786c` (coder's `dbdeca61aa`, architect-bounce fix
`9b85d750`, cleaner cleanups `7c2fffa6bd` + `e6f043786c`) into the architect
worktree. Ran full compile (clean) and the two required hard gates scoped to
every changed benchmark/backlogDashboard file:
`dependency-gate.js` — PASSED, no forbidden edges.
`co-change-report.js` — all reported coupling is within the expected
benchmark-module cluster (`aggregate.ts`/`report.ts`/`runBenchmark.ts`/
`taskFixture.ts`/`taskSoundness.ts`/`types.ts` and their own tests); no
cross-boundary coupling. Architecturally the battery/soundness split is
clean: `taskSoundness.ts` depends on `taskFixture.ts`'s new overlay helpers,
`runBenchmark.ts` orchestrates soundness-then-scoring, and the two-layer
(view/substrate) and I/O-ownership boundaries are untouched by this parcel.

The prior architect bounce (`9b85d750`, legacy-shape committed report
crashing `readLatestBenchmarkReport`) is fixed correctly:
`normalizeBenchmarkReport` migrates `taskId` -> `taskIds` at the read
boundary, defaults `refusedTasks`/`taskScores`, and passes an
already-current-shape report through unchanged. The cleaner's own follow-up
(`e6f043786c`) closes the one surviving mutant in that function's
no-`taskId` fallback branch. Both confirmed correct by reading the diffs.

## The defect

`pwa/app.js`'s `renderRoleLeaderboard` (same commit `dbdeca61aa`, adapting
to the `taskIds` rename) reads `roleFromTaskId(report.taskIds[0])`.
`BenchmarkReport.taskIds` is explicitly allowed to be `[]` — that is the
whole point of acceptance scenario 05 (`refusedTasks`): `runBenchmark`
builds and returns a report with `taskIds: soundTasks.map(...)` with no
floor, and `buildBenchmarkReport`/`report.ts` has no guard requiring at
least one sound task. If every task in the battery is refused,
`taskIds` is `[]`, `report.taskIds[0]` is `undefined`, and
`roleFromTaskId` calls `.indexOf` on it. Reproduced directly:

```
$ node -e "
function roleFromTaskId(taskId) { return taskId.indexOf('-task-'); }
roleFromTaskId(({taskIds: []}).taskIds[0]);
"
TypeError: Cannot read properties of undefined (reading 'indexOf')
```

`renderRoleLeaderboard` is the last call in `renderAll` (`pwa/app.js:996`)
with no surrounding try/catch, so this throws uncaught rather than
degrading the way its own neighboring contract intends (the function's own
comment: "hidden entirely, never rendered empty" — that contract covers
`report === null`, not `report.taskIds === []`).

Not reachable with today's fixture set only by accident: `coder-task-01`
has no `reference/` directory, so `checkTaskSoundness` treats it as
unconditionally sound (opt-in check) and it can never be refused, which
keeps `taskIds` non-empty in practice. But that is an artifact of which
fixtures happen to exist today, not an invariant the code enforces — the
type (`RefusedTask[]` alongside `taskIds: string[]`) and the ticket's own
scenario 05 are explicitly designed around "a task can be refused," and
adding a `reference/` solution to `coder-task-01` later (a natural
improvement, not a misuse) or shrinking the battery to a single
now-broken-reference task would make every task refusable at once,
committing a report that crashes the dashboard the next time it loads
`backlog.json`. There is no test anywhere in this parcel
(`pwaDashboard.test.js`, `roleLeaderboardSurfaceSteps.js`) that exercises
an empty-`taskIds` report.

## Why this is a bounce, not a rule_proposal

A correctness defect the architect can see is a send-back, not a
`rule_proposal` (BL-333's lesson: a note alone doesn't stop the parcel,
and this exact ticket landed on `main` before the proposal was actioned).
This is a concrete, reproducible defect in code this same commit changed
to adapt to the new schema, on the very axis (refused tasks) this ticket
introduces.

## Remediation direction (not prescriptive — coder's call on mechanism)

`renderRoleLeaderboard` (or `roleFromTaskId`) needs to handle
`taskIds.length === 0` without throwing — e.g. fall back to deriving the
role from `refusedTasks[0].taskId` when no task ran, or render a distinct
"battery fully refused" state instead of a role table. Whichever is
chosen, add a test that builds a `taskIds: []` report (with a populated
`refusedTasks`) and asserts the PWA renders without throwing.

## Scope check

None of `dbdeca61aa`, `7c2fffa6bd`, `9b85d750`, or `e6f043786c` has this
evidence file's finding as an ancestor — first time raised for BL-386.
