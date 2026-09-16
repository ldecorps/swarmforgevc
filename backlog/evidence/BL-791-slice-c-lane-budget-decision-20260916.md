# BL-791 slice C - lane budget decision and measurement (specifier, 2026-09-16)

Inbound: coordinator note, priority 00, 13:13Z (00_20260916T131330Z_008676):
"BL-791 slice C: operator authorizes you to decide lane budget, mint gate".
No Telegram text carrying the operator's words was found under
`.swarmforge/operator/` or `backlog/topics/BL-791.json`; the relay is the
record, and the decision is written on the epic for the operator to amend.

## Measurement (profile first, per the epic's own rule)

`npm test` from `extension/`, master checkout, 2026-09-16 13:16 UTC. Host:
20 cores, 1-minute load 10.84 at start (8 other swarm agents live),
`vitest.config.mjs` pool `forks` maxForks 9, isolate false, testTimeout
20000. Report `extension/.vitest-report.json`; row appended to
`.test-durations.jsonl`: `{"finished_at":"2026-09-16T13:17:12.995Z","test_count":1027,"result":"fail","duration_ms":73169}`.

- 622 files, 10566 tests; 3 files failed: liveRepoDerivationGuard and
  tmpDirMigrationGuard (BL-1593, hotfix a27d082c2d), bl1277UnscopedStepCollisionGuard
  (timeout at 23537 ms vs 20000 - BL-1600, minted this pass, register row added).
- Wall 72.0 s (vitest) / 73.2 s (recorder); `real 1m28.7s` including
  compile; CPU `user 6m42s sys 1m43s`.
- Summed per-file work 546.1 s; median file 0.06 s; p90 1.52 s.
- 9 files over BL-378's 7000 ms: 69.9 bl968StepRegistryMaterializedTreeGuard,
  65.3 telegramFrontDeskBotCli.test.js, 36.6 renderBriefingBurndownCli,
  36.3 briefingDigestLineCli, 23.6 bl1277UnscopedStepCollisionGuard,
  14.6 renderBriefingDiagramsCli, 10.6 epicReorderBridge,
  8.5 pilotAcceptanceGateCli, 7.3 recordBounceCli = 273 s, half the lane.
- Both existing gates fired: "suite duration over budget: 73.2s exceeds
  the 10.0s suite budget"; "suite file budget exceeded (9 offender(s))".
  `computeFinalExitCode` folds the per-file guard into the exit code, so
  `result: fail` on every recorded row since 2026-07-07 - the gate has
  been permanently red and therefore silent (the epic's own half-answer).

## Why work, not wall, is the line

| run | host | forks | files | wall | summed work |
|---|---|---|---|---|---|
| 2026-08-22 05:52 | macOS, 2 cores, BL-935 ceiling | 1 | 460 | 689.4 s | 533.8 s |
| 2026-09-16 13:16 | WSL, 20 cores, load 10.8 | 9 | 622 | 72.0 s | 546.1 s |

Wall moved tenfold with the fork count; summed work moved 2 percent while
162 files were added. A gate on wall flakes with load and the pool (BL-445
made it surface-only for that reason); a gate on work holds one number on
every host. The 13 s operator ceiling is a wall figure, so it becomes a
DERIVED, printed distance: `max(slowest file, work / forks)` - 69.9 s
today at any fork count, about 30 s with every pole under 7 s, 13 s only
with summed work under about 110 s as well.

## Decision

Recorded on BL-791 (`lane_budget_decision_2026_09_16`): host budget and
lane composition unchanged; the line is summed per-file work,
`SUITE_WORK_BUDGET_MS` 550000, 10 percent tolerance, refused above,
lowered only (BL-1599); the per-file gate regains its signal through a
committed pole register owned by the epic until slice D tickets take rows
over (BL-1598); `npm test`'s recorded row separates the test outcome from
the budget verdicts. Slice D (the nine poles) is inventoried on the epic,
not minted: one ticket per file or shared cause, the two 65 to 70 s files
first.

## Also found and owned

`bl1277UnscopedStepCollisionGuard.test.js` timed out at 23.5 s under load
(green in QA's run the same morning): standing red at first sighting,
BL-1600 minted, register row added (unit lane). Register now 13 rows.
