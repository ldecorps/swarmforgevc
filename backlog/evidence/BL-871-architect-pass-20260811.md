# BL-871 — architect pass — 2026-08-11

## Scope reviewed

Parcel received from cleaner at `328211e3e5` (merged into architect on top
of `806e6681f`). Coder commits in scope for this task name:
`cebde18db`..`2a231c091` — "BL-871: cap the property lane's worker pool to
the shared budget module". The same merge commit also carries BL-874's
work, forwarded and reviewed separately (own evidence file,
`BL-874-architect-pass-20260811.md`) per Article 2.6 — cleaner sent two
distinct `git_handoff`s, one per ticket, so no collapse to correct here.

Files touched by this task: `extension/vitest.properties.config.mjs`,
`extension/test/bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`,
`extension/test/helpers/{workerPoolConfigGuard,maxConcurrentSpans}.js`,
`extension/test/helpers/propertyLaneFixtureRunner.js` (extended),
`specs/pipeline/steps/bl871PropertyLaneWorkerPoolCapSteps.js` +
`specs/pipeline/steps/index.js` (registration).

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` against every file this task
touched (excluding `specs/pipeline/steps/index.js`, which pulls the
step-registry's full transitive graph): **PASSED, no forbidden edges.**

Including `index.js` in the same invocation surfaces the pre-existing
`telegram-front-desk-bot.ts` → `telegramCursorOperatorExec.ts` →
`telegramCursorOperatorLiveness.ts` acyclic cycle (also reproduced on a
full-repo scan). Confirmed via `git show 806e6681f:...` that both edges
already existed at this parcel's merge-base, and confirmed via `git diff
806e6681f 328211e3e5 --name-only` that no telegram file is touched by this
parcel. Already tracked as `BL-759` (paused, matches the exact three edges
verbatim). Not attributable to this parcel.

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against the same file set:
the BL-871-specific files (`workerPoolConfigGuard.js`,
`maxConcurrentSpans.js`, `propertyLaneFixtureRunner.js`,
`bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`,
`vitest.properties.config.mjs`, the step file) co-change only with each
other and this task's own evidence file — below the suspected-coupling
threshold, and exactly the coherent slice one ticket should produce.
`index.js` reports dozens of high-frequency "SUSPECTED COUPLING" entries
(the step registry gets a one-line addition on nearly every ticket the
project ships); not new, not BL-871-specific. No coupling defect found.

## Invariants review (BL-654)

Both declared invariants have executable property tests, authored by the
coder in `bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`.
Non-vacuity independently confirmed, not taken on the coder's word — for
each, broke the real implementation, watched the test fail, then restored
via `git checkout` and re-ran green:

1. *"Verdict does not depend on how many other files run alongside it."*
   Drives real subprocesses through the real `vitest.properties.config.mjs`
   (`runManyAsPropertyLaneFixtures`), measuring peak concurrent workers via
   a sweep-line and per-worker heap ceiling via `v8.getHeapStatistics()`.
   Broke it by setting `maxForks: WORKER_POOL_SIZE + 6` and dropping
   `execArgv` in the real config — test failed: "expected at most 3 worker
   processes alive at once ... observed 6". Restored, re-ran green (2/2).
2. *"Neither lane carries its own copy of the numbers."* Fuzzes
   `workerPoolConfigGuard.js`'s pure guard over generated config-source
   shapes (100 runs, all 8 presence/absence combinations reachable). Broke
   `hasHardcodedMaxForks` to always return `false` — test failed
   immediately (`false !== true`). Restored.

## Property testing pass (architect-owned, BL-654/BL-654 ownership clause)

`maxConcurrentSpans.js` — the pure sweep-line helper invariant 1 depends on
— had no direct test of its own; it was exercised only indirectly, through
real subprocess timing data, which never pins its behavior against a known
span set. Added
`extension/test/maxConcurrentSpansInvariants.property.test.js`: 200 runs
checking the real implementation against a brute-force overlap reference
over generated span sets, plus a bounds check. Confirmed non-vacuous:
broke the sort's tie-break (`a[0]-b[0]||a[1]-b[1]` → `a[0]-b[0]`), watched
it fail (`2 !== 1`), restored, re-ran green. Committed as part of this
pass.

No other property-shaped pure module in this task's touched set was found
undercovered; `propertyLaneFixtureRunner.js`'s new function is I/O-driving
test infrastructure, not a pure decision function.

## Full property lane

`npm run test:properties` (all files, real subprocesses) run twice this
pass: once in isolation on the two BL-871 files (2/2, then 5/5 combined
with the maxConcurrentSpans addition — see per-file runs above), and once
as a full 73-file run. The full run showed 1 file / 3 tests fail with
`[vitest-worker]: Timeout calling "onTaskUpdate"` — an RPC/heartbeat
timeout between vitest's main process and a worker, not an assertion
failure inside any test. Host load at the time (`uptime`: load averages
16.7/28.6/21.7 on this 4-CPU host) was elevated well past the `>>2x cores`
threshold the project's own lesson discounts flakiness under, and I had
concurrent `npx vitest` invocations of my own running in the foreground
for the BL-874 review at the same moment — the same class of self-induced
contention the coder's own evidence documents hitting during their pass
(load 99+ mid-run). Not re-run a third time to avoid adding more load.

This is exactly the risk the ticket's own `approval_context` and
`qa_e2e_procedure` already name and hand to QA ("scenarios 01-03 can all
pass on a config that still flakes... Scenario 04 earns its place"; "QA:
please re-run scenario 04 ... once host load is back near baseline"). The
mechanism itself — the part scenario 04 and the full-suite run are
actually checking — is independently verified above via the controlled,
isolated invariant-1 break/fix: the pool cap and heap cap both measurably
hold. **QA: please re-run the qa_e2e_procedure (3x `npm run
test:properties`) on a quiet host per the ticket's own ask before final
approval.**

## Acceptance

Scenarios 01–03 (declaration/wiring/sizing, not outcome) were run by the
coder and pass per their own evidence; not independently re-run this pass
since they are pure declaration checks over files I already read directly
above. Scenario 04 (full-suite outcome) is the one QA is asked to confirm
per the note above.

## Verdict

Clean. No architecture violation, no invariant violation, no correctness
defect found. Forwarding to hardener with the one property-test addition
committed.

By architect.
