# BL-1450: unowned red — bl968MaterializedGuardSensitivity times out in every full run and cannot fit the rerun net (specifier, 2026-09-06)

Trigger: coder `note`, priority 00, 2026-09-06T20:26:24Z, from the BL-676
parcel: "BL-968 timeout now blocks unrelated commits (BL-676); see BL-1348
evidence". Handled under the standing-red rule (2026-09-05).

## What the guard recorded (coder's retained refusal, 20:25Z)

```
253:   ✓ property (BL-871 invariant 1): a file's worker-process ceiling (heap and concurrency) stays fixed no matter how many property files run alongside it  17899ms
434:   × property (BL-1012 invariant 1): the effective threshold never exceeds the ceiling, and an age past the ceiling always restarts however contended the host 35601ms
2137:   ✓ the retired 42000 ceiling is not enforceable anywhere in the gap it used to guard  1508ms
3367:stdout | test/bl968MaterializedGuardSensitivity.property.test.js > BL-968 invariant 2 (generative): every planted load-time-binding module, any class, any chain depth, turns the guard red naming it
3370: ❯ test/bl968MaterializedGuardSensitivity.property.test.js (1 test | 1 failed) 346348ms
3372:     → Test timed out in 300000ms.
3377: FAIL  test/bl1012FreshnessSelfInflictedIncidents.property.test.js > property (BL-1012 invariant 1): the effective threshold never exceeds the ceiling, and an age past the ceiling always restarts however contended the host
3758: FAIL  test/bl968MaterializedGuardSensitivity.property.test.js > BL-968 invariant 2 (generative): every planted load-time-binding module, any class, any chain depth, turns the guard red naming it
3759:Error: Test timed out in 300000ms.
3761: ❯ test/bl968MaterializedGuardSensitivity.property.test.js:143:1
```
Twenty-second timeouts in the same full run: 52 (load average 9-13 from the live swarm; the BL-1407 rerun clears those that pass alone).

## Measurements on record

- Coder, BL-1348 evidence (2026-09-06): bl968 ~180 s alone; blew its 300 s
  timeout under a pool of 15 in both runs.
- QA, BL-1409 evidence (2026-09-06): bl968 timed out in the full run, then
  passed alone "in its normal ~164-193s range".
- Specifier, 2026-09-06 20:27-20:31Z: solo run under the lane config
  (`npx vitest run --config vitest.properties.config.mjs test/bl968...`):
  1 passed, Duration 249.99 s (tests 249.13 s), load average 6.76 / 11.35
  / 11.79 at finish - above the guard's 180 s rerun ceiling even alone.

## Mechanism

3 classes x 2 depths x `RUNS_PER_CELL = 4` = 24 draws per property run,
each planting a module in the materialized tree and running the BL-761
gate's registry load in a fresh process (a spawn per draw; the coverage
line reports 24 draws), plus the materialization itself. The commit-time
guard's rerun ceiling is a SHARED 180 s (`check_property_suite_drift.sh`
149-156; BL-1407), and "a file that has no budget left when its turn comes
counts as still-failing" (docs/how-to/BL-570-property-suite-drift-guard.md).
A file whose solo time is 164-193 s can never be cleared by that net, so
each of its full-run timeouts is a refusal of whatever commit was staged.

## Disposition

- BL-1450 (new, `type: defect`, `severity: high`, epic code-quality-gates):
  fewer draws per cell with every cell kept and the reach floors re-derived
  from the run count (BL-1062 invariant 2 stands); a 60 s budget, 15 s
  welcome. Not BL-1349: that ticket is active, names three other files and
  scopes the rest out; a ticket in the active backlog is never consolidated.
- Register row: lane `property`, the file, BL-1450, first_seen 2026-09-06.
- Interim unblock for the coder's BL-676 commit: the documented seam
  `SWARMFORGE_PROPERTY_RERUN_CEILING_SECONDS=600` (a bigger shared budget
  lets the rerun finish bl968 alone), recorded in its evidence; never the
  recovery-only `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`.
