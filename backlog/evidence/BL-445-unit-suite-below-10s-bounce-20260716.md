# BL-445 QA bounce evidence — 2026-07-16

## 1. Failing command
```
npm test
```
Run from `extension/` in the QA worktree, exactly as the ticket's own E2E QA
procedure specifies ("run `npm test` in extension/ ... confirm the recorded
duration_ms is < 10000 with headroom").

## 2. Commit hash tested
`9fb7e05d80` (documenter's `git_handoff` for BL-445-unit-suite-below-10s),
merged into the QA worktree at `495f5f72` for this verification. Ancestry
confirmed: coder `f4978d68` → cleaner `95937369` → architect `e3b8b774f7` →
hardener `4b1c31c8` → documenter `9fb7e05d80`, all ancestors of the merge
commit tested.

## 3. First error excerpt (observed output)
Two independent full-suite runs, back to back, second one after the only
concurrent heavy process on the host (a `stryker` mutation run in
`.worktrees/coder`) had already finished:

Run 1 (`.test-durations.jsonl` @ 2026-07-16T07:53:57.625Z):
```
 Test Files  292 passed (292)
      Tests  4387 passed (4387)
   Start at  08:53:32
   Duration  24.52s (transform 1.31s, setup 857ms, collect 14.59s, tests 52.51s, environment 60ms, prepare 22.25s)

JSON report written to /home/carillon/swarmforgevc/.worktrees/QA/extension/.vitest-report.json
suite duration over budget: 24.9s exceeds the 10.0s suite budget
suite file budget OK: 292 files, all within 7.0s
```

Run 2, lower host load, no concurrent mutation run (`.test-durations.jsonl`
@ 2026-07-16T07:55:49.869Z):
```
 Test Files  292 passed (292)
      Tests  4387 passed (4387)
   Start at  08:55:33
   Duration  16.47s (transform 874ms, setup 541ms, collect 9.88s, tests 37.39s, environment 39ms, prepare 14.00s)

JSON report written to /home/carillon/swarmforgevc/.worktrees/QA/extension/.vitest-report.json
suite duration over budget: 16.8s exceeds the 10.0s suite budget
suite file budget OK: 292 files, all within 7.0s
```

Both runs pass every test (4387/4387) and every per-file budget check — this
is not a correctness or coverage regression. The change's own new tool
(`check-suite-duration-budget.js`) self-reports "over budget" on both runs,
using the exact number the ticket asks QA to check.

## 4. Failure class
`behavior` — the recorded duration does not satisfy the ticket's own explicit
acceptance bar. This is an intent mismatch, not a compile/unit/integration/
acceptance-scenario failure: unit tests are green (4387/4387) and the 5
Gherkin acceptance scenarios for the durable-ratchet half all pass
(`run_acceptance.sh specs/features/BL-445-unit-suite-below-10s.feature` →
5/5 ok).

## 5. Expected vs observed
Expected: `npm test` records `duration_ms < 10000` **with headroom**.
Observed: best of two consecutive runs (lower-load run) is `16759ms` —
68% over the 10000ms budget, zero headroom; the higher-load run was
`24936ms`. Neither run is close to the target.

## Context for the coder
The durable-ratchet half of the ticket (the budget-verdict CLI, its wiring
into `recordTestDuration.js`, and the widened `MAX_WORKERS`/
`PER_WORKER_HEAP_MB`) is solid and should stay — it materially improved
things: the hardener-era baseline immediately before this fix was
40-60s/run (`.test-durations.jsonl`, test_count 276-290), and the same
suite now runs 16.8-24.9s post-fix. That is real, measured progress, just
not enough to clear the ticket's own "<10000ms with headroom" bar.

The vitest reporter's own phase breakdown suggests the remaining pole is
not test-execution parallelism (which `MAX_WORKERS` targets): in the
lower-load run, `collect` alone is 9.88s and `prepare` is 14.00s — these
are largely serial/transform-bound phases, not something a wider worker
pool helps. The ticket's own "PROFILE BEFORE CUTTING" instruction pointed
at exactly this kind of fixed overhead (coverage instrumentation,
worker-pool spin-up) as a candidate; that profiling step does not appear
to have been carried through to a fix for the `collect`/`prepare` cost.

Also worth noting for calibration: this host runs a permanently-live
8-agent swarm (coordinator, specifier, coder, cleaner, architect, hardener,
documenter, QA all resident) plus a handoff daemon, bridge server, and
Telegram bot — there is no actually-idle window to measure against. Both
evidence runs above already reflect the best available real-world
conditions (the second run has no other worktree running a heavy process).
