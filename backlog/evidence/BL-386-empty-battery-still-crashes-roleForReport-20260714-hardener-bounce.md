# BL-386 hardener bounce — 20260714

## Verdict: BOUNCE to coder — `roleForReport` still crashes on a battery with ZERO total tasks

## What was reviewed

Merged architect's `d16078e75d` (which itself carries the architect's own
prior bounce fix `1d9fd3bb5b`, "pwa role leaderboard survives an all-refused
battery") into the hardener worktree, alongside BL-377. Ran the full compile,
unit suite, CRAP, and DRY passes over the changed files as part of the
combined hardening batch.

`1d9fd3bb5b` fixed the case where every task in the battery is refused
(`taskIds: []`, `refusedTasks` non-empty) by falling back to
`refusedTasks[0].taskId`. That fix is correct for the case it targets. It
does not cover the case one level further out: a battery with **zero tasks
in total** — `taskIds: []` AND `refusedTasks: []`, both empty.

## The defect

`pwa/app.js`'s `roleForReport` (added by `1d9fd3bb5b`):

```js
function roleForReport(report) {
  var taskId = report.taskIds.length > 0 ? report.taskIds[0] : report.refusedTasks[0].taskId;
  return roleFromTaskId(taskId);
}
```

falls back to `report.refusedTasks[0]` unconditionally whenever `taskIds` is
empty — but `refusedTasks` is only guaranteed non-empty when every task that
existed was refused. If the battery itself contained no tasks (`tasks: []`
passed into `runBenchmark`), `soundAndRefusedTasks` loops zero times and both
`sound` and `refused` come back empty, so `buildBenchmarkReport` produces
`taskIds: []` and `refusedTasks: []` together. `refusedTasks[0]` is then
`undefined`, and `.taskId` on it throws. Reproduced directly:

```
$ node -e "
function roleFromTaskId(taskId) { return taskId.indexOf('-task-'); }
function roleForReport(report) {
  var taskId = report.taskIds.length > 0 ? report.taskIds[0] : report.refusedTasks[0].taskId;
  return roleFromTaskId(taskId);
}
roleForReport({ taskIds: [], refusedTasks: [] });
"
TypeError: Cannot read properties of undefined (reading 'taskId')
```

Trace to the source: `loadTaskBattery(batteryRoot)`
(`extension/src/benchmark/taskFixture.ts:21-28`) is a bare
`readdirSync(...).filter(isDirectory)` with no minimum-count guard, so an
empty (or wrongly-pathed) battery root legitimately produces `tasks: []`.
`runBenchmark` (`extension/src/benchmark/runBenchmark.ts:60-72`) has no floor
either — it passes whatever `soundAndRefusedTasks` returns straight through
to `buildBenchmarkReport`. Nothing between the CLI's directory read and the
PWA's render call requires at least one task, sound or refused.

Not reachable with today's single-task battery in day-to-day operation
(`coder-task-01` always exists), but the same class of gap as the original
bounce: the *type* (`taskIds: string[]`, `refusedTasks: RefusedTask[]`, both
independently possibly-empty) allows a state the renderer's own fallback
still does not handle, and nothing in `runBenchmark`/`loadTaskBattery`
prevents that state from occurring if the battery root is ever empty or
misconfigured.

## Why this is a bounce, not a hardener fix or a rule_proposal

Same reasoning as the architect's own prior bounce on this exact function
(`ce92e698`): a correctness defect a reviewer can see is a send-back, not a
silent patch or a `rule_proposal` that doesn't stop the parcel. The hardener
does not own defect remediation design — that decision (whether to floor
`roleForReport`'s fallback, refuse to render, or guard further upstream in
`runBenchmark`/`loadTaskBattery`) belongs to the coder.

## Remediation direction (not prescriptive — coder's call on mechanism)

`roleForReport` needs a third branch (or an upstream guard) for
`taskIds.length === 0 && refusedTasks.length === 0` — e.g. render a distinct
"battery produced no tasks" state instead of indexing into an empty array,
or have `runBenchmark`/`loadTaskBattery` refuse an empty battery outright so
the report can never carry this shape. Whichever is chosen, add a test that
builds a report with both `taskIds: []` and `refusedTasks: []` and asserts
the PWA renders without throwing (mirroring `1d9fd3bb5b`'s own
all-refused-battery test, one case further out).

## Scope check

Neither `d16078e75d` nor any of its ancestors (`1d9fd3bb5b`, `dbdeca61aa`,
`9b85d750`, `7c2fffa6bd`, `e6f043786c`) has this evidence file's finding as
an ancestor — first time raised for this specific gap.

By hardener.
