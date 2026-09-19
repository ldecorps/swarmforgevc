# BL-871's own acceptance feature has two pre-existing stale expectations
# and a scenario 04 that crashes the acceptance harness process - found
# while verifying BL-1651 does not regress it, 2026-09-19

Not BL-1651's own defect: `specs/features/BL-871-property-lane-worker-pool-cap.feature`'s
scenarios 02-04, run via `run_acceptance.sh`, on this host, today.

## Scenario 02: "both lanes size their pool from the same shared budget module"

`bl871PropertyLaneWorkerPoolCapSteps.js`'s handler computes
`expectedMaxForks = resolveWorkerPoolSize(os.totalmem() / (1024*1024))`
(bare call, default ceiling = MAX_WORKERS = 6) and compares it against
the REAL `vitest.properties.config.mjs`'s own `maxForks`, which is
`resolveVitestWorkerPool({..., defaultCeiling: resolveFreeCoresCeiling(cores, loadAvg5min)})`
- a DIFFERENT ceiling whenever `resolveFreeCoresCeiling` resolves above 6
(a quiet host: cores=20, loadAvg5min low, e.g. 20-2=18, well above 6).
Failed today: `expected maxForks to equal resolveWorkerPoolSize's own
answer (6) for this host, got 9`. BL-1651 did not touch this handler's
`expectedMaxForks` line (only its heap-comparison lines, per
`bl1651-*` evidence). Pre-existing since BL-1348/BL-1336 landed
`resolveFreeCoresCeiling` as the config's real `defaultCeiling` without
updating this scenario's own expectation formula to match.

## Scenario 03: "the pool shrinks to what the host can hold" [2] (8192MB)

`vitestWorkerMemoryBudget.test.js`'s own comment (2026-09, BL-1348)
already documents this exact row is stale: "an 8192MB host no longer
demonstrates a shrink below MAX_WORKERS=6 at all (floor(8192*0.5/640) is
exactly 6)" - PER_WORKER_HEAP_MB dropped 1280 -> 640 there, but
`BL-871-property-lane-worker-pool-cap.feature`'s own Examples table
(`| 8192  | 3       |`) was never updated to match. Failed today:
`expected resolved pool size 3, got 6` - matches the documented math
exactly.

## Scenario 04: "a subprocess-heavy property file passes under a
full-suite run" crashes the acceptance harness process

Running the full BL-871 feature (all 4 scenarios) via `run_acceptance.sh`
twice today: both times the process printed only the
`[property-lane-budget]` line (scenario 01/02's own dynamic `import()` of
the config) and then produced NO further output at all, exiting 1 with
no TAP summary. `dmesg` shows a real `signal: 6` (SIGABRT) node crash in
the matching time window. Isolated: scenarios 01-03 alone (a trimmed
local copy of the feature, same step handlers via `defineScoped`'s
feature-name matching) run cleanly - two real "not ok"s (above), no
crash. The REAL underlying command scenario 04 spawns
(`npm run test:properties`, full 424+2-file lane, no filter) completed
cleanly TWICE today when run directly outside the harness (evidence:
this ticket's own `extension/test/property-lane-heap-census.txt`
generation runs) - no FATAL ERROR, no heap crash, exit 1 only from one
unrelated pre-existing timeout flake. So the crash is specific to
running that heavy spawn synchronously (`spawnSync`, no `maxBuffer` set
- Node's 1MB default) FROM WITHIN the acceptance harness's own long-lived
`node:test` process, not the lane itself. Not chased further under this
ticket's own time budget; scenario 04's `spawnSync` call
(`bl871PropertyLaneWorkerPoolCapSteps.js` line ~153) is the first place
to look - no `maxBuffer` override, and nesting a 400s+, multi-fork,
memory-hungry child inside a test-runner process is a plausible
resource-contention shape regardless of maxBuffer specifically.

## Why this is not BL-1651's own defect

BL-1651 changed `bl871PropertyLaneWorkerPoolCapSteps.js`'s heap-cap
comparison only (scenario 02's `actualHeap` check, floor-only now) and
`bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`'s own heap
tolerance check (parses the config's own printed value instead of the
fixed constant) - both re-verified green in isolation. Neither touches
`expectedMaxForks`, the Examples table, or scenario 04's spawn. All three
findings above reproduce identically against `git show
HEAD~N:specs/features/BL-871-property-lane-worker-pool-cap.feature` and
its pre-BL-1651 step handler content (inspected, not independently
re-run under this ticket's own time budget).

By coder.
