# BL-1588 — full property-lane reproduction (pre-fix), 2026-09-16

## Failing command
`npm run test:properties` (from `extension/`), full property-lane run.

## Commit
Started at the coder worktree tip after merging `main`'s `65fca0e708`
(BL-1590/BL-1591 mint + BL-1588 promotion), before this parcel's own code
change landed — i.e. this is the tree as BL-1588 found it.

## Run 1 (2026-09-16, 10:12:06–10:17:26 UTC, 319.94s wall, 8 files failed / 400
passed of 408, `tmp/bl1588-prefix-lane-1.log`)

Host at start: `loadavg 8.67 8.09 5.73`, 20 CPUs (busy — other swarm agents
live on this host concurrently; WORKER_POOL_SIZE resolved to 11 forks via
`resolveVitestWorkerPool` at this load).

### BL-1588's four named files — 3 of 4 reproduced this run

`test/bl1308SiblingDetectorCoversReplay.property.test.js > property
(invariant 1): every ticket whose content the replay tip adds is named in
the report` (29146ms):
```
Error: Test timed out in 20000ms.
```

`test/bl1315OwnPathsFullRangeInvariants.property.test.js > property
(invariant 1 and 2): every own path survives, every unlanded-sibling-only
path is dropped` (21415ms):
```
Error: Test timed out in 20000ms.
```

`test/bl1354SharedPathLandedSiblingInvariants.property.test.js > BL-1354/
BL-654 invariant 2: a sibling is judged on its own attributed content only`
(25399ms):
```
Error: Test timed out in 20000ms.
```

`bl1343ReplayNeverDropsOwnPathInvariants.property.test.js` did NOT time out
this run (green) — consistent with the ticket's own description that the
class is intermittent and sequencer-order-dependent.

### Unowned reds outside BL-1588's named population — reported separately

Four MORE fixture-spawning-shaped files timed out in this same run that are
NOT among BL-1588's four named files and carried no register row at the
time (`backlog/standing-reds.tsv` grepped clean for all four ids below,
2026-09-16, before this note). Per BL-1588's own constraints, the
population this ticket fixes is pinned to its four named files, not grown
by this run's evidence — reported as an unowned-red note (priority 00) to
the specifier and coordinator rather than folded into this parcel's scope.
The specifier adjudicated same-day: **BL-1592** (commit `012bb81731`) now
owns all four, `depends_on: BL-1588` (specifier note
`20260916T092900Z_001570`, "BL-1588: bl1375/1309/1389/1529 reds owned by
BL-1592 (012bb81731) - cite id"):

`test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js > BL-1375/
BL-654 invariant 1: a sibling that is not positively approved still blocks,
and is named` (21596ms): `Error: Test timed out in 20000ms.`

`test/bl1309LandDecideEntanglementInvariants.property.test.js > BL-1309/
BL-654 invariant 1: a withheld or unapproved ticket on the tip is never
advised for push` (23211ms): `Error: Test timed out in 20000ms.`

`test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js >
BL-1389/BL-654 invariant 1: a path an unlanded sibling owns alone never
rides, whatever its approval reads` (22437ms): `Error: Test timed out in
20000ms.`

`test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js > BL-1529
invariant: a challenge, a refusal, and a queue are three distinguishable
outcomes` (74454ms, own explicit 60000ms budget): `Error: Test timed out in
60000ms.`

Also one allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"`
unhandled error (BL-871, confirmed benign, not a red).

## Reading

The three of BL-1588's four named files that reproduced here match the
ticket's own diagnosis: none of `bl1308`/`bl1315`/`bl1354` carries any
per-test budget at all (relies on the lane's flat 20000ms `testTimeout`),
so a busy lane — whether busy from the property lane's own fixture-spawning
population or, as measured here, from other concurrent host activity —
holds them to the unscaled ceiling regardless. `bl1343` (already wired to
`propertyLaneTimeoutMs`) did not reproduce this particular run, consistent
with BL-1580's own two runs each catching a different subset.

The four extra unowned reds are the identical failure shape
(fixture-spawning property test, flat `Test timed out in Nms`) in files
BL-1588 does not name — evidence the underlying class is broader than the
four pinned files, but per BL-1588's explicit constraint ("the population
is pinned by NAMED files... not by grep") growing this ticket's scope to
cover them is out of policy; they are reported, not fixed, here.
