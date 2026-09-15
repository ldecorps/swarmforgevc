# BL-1580 — unowned red in `npm run test:properties` (unrelated to this parcel)

## Failing command
`npm run test:properties` (from `extension/`), full property-lane run.

## Commit
`bd41e42af2` ("Merge documenter edbb16133c into QA."), parcel task
`BL-1580-bl1295-revert-attribution-boolean-arm-is-constructed`.

## Failures — verbatim, two full-lane runs at this commit

**Run 1** (22:17:18–22:22:19, 301.38s, 2 files failed / 406 passed of 408):

`test/bl1308SiblingDetectorCoversReplay.property.test.js > property
(invariant 1): every ticket whose content the replay tip adds is named in
the report`:
```
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
```

`test/bl1315OwnPathsFullRangeInvariants.property.test.js > property
(invariant 1 and 2): every own path survives, every unlanded-sibling-only
path is dropped`:
```
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
```

**Run 2** (22:25:06–22:29:49, 282.87s, 3 files failed / 405 passed of 408):

`test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js > BL-1343/BL-654
invariant 1: a differing tip is never reported as landed or as nothing left
to replay`:
```
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
```

`test/bl1354SharedPathLandedSiblingInvariants.property.test.js > BL-1354/BL-654
invariant 2: a sibling is judged on its own attributed content only`:
```
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
```

(A third file in run 2's tally, per the file-count, produced no additional
text beyond the two `Unhandled Error: [vitest-worker]: Timeout calling
"onTaskUpdate"` entries — the BL-871-allowlisted benign noise, same both
runs, not counted as a red here.)

None of the four named files overlap between the two runs, and none is
`bl1295RevertAttributionInvariants.property.test.js` (this parcel's own
file, green both runs, and separately green 3/3 standalone consecutive runs
plus this ticket's own 15/15 QA e2e procedure runs, `BL-1580 reach map
(bl1295): {"arms":2,"minDrawsPerArm":3}` printed every time).

## This is load-contention, not a floor miss — simulated, not guessed
All four failures read `Error: Test timed out in 20000ms.` (the property
lane's fixed `testTimeout`), not an assertion. Re-run standalone,
back-to-back, on a quiet host (`uptime` 1-min load 1.75–1.87 throughout,
no other `vitest`/`stryker`/`npm run test` process observed via `ps aux`):

- `bl1308SiblingDetectorCoversReplay.property.test.js` alone: 1/1 green,
  invariant 1 at 12.7s.
- `bl1315OwnPathsFullRangeInvariants.property.test.js` alone: 1/1 green,
  the failing test at 11.2s.
- `bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`,
  `bl1354SharedPathLandedSiblingInvariants.property.test.js` and
  `bl1315OwnPathsFullRangeInvariants.property.test.js` together, 3
  consecutive rounds: 3/3 green every round, every individual test
  8.0–14.8s — well under the 20s cap.

`bl1343...` invariant 1 is a **recurrence**: BL-1579 (closed, on `main`)
wired it to `propertyLaneTimeoutMs(20000)` (a load-relative budget,
`extension/test/helpers/propertyLaneContentionBudget.js`) specifically for
this file, verified 30/30 green under a *heavier* measured load (peak
1-min 12.87) than either of my two full-lane runs here. That the raw
`20000ms` ceiling still shows in the run-2 failure text (not a scaled
value) suggests the budget reads load at file-load/registration time,
before the full 408-file lane's own parallel ramp-up — a real gap in
BL-1579's fix under a full-lane run specifically, not something this
parcel touches or owns. `bl1308`/`bl1315`/`bl1354` were never in BL-1579's
scope (that ticket named only `bl1343ReplayNeverDropsOwnPathInvariants`
and `bl1323StampOffInvariants`).

## Grep for existing ownership (BL-1063)
`grep -rl "bl1308\|bl1315\|bl1343\|bl1354" backlog/active backlog/paused`
returns nothing for any of the four files.
`bb swarmforge/scripts/standing_red_register_cli.bb .` lists only the two
rows this parcel and its sibling BL-1581 own
(`bl1295RevertAttributionInvariants` → BL-1580,
`bl1358MutantTimeCeilingInvariants` → BL-1581); none of the four files
above carries a row. BL-1579 (closed) named `bl1343...` and
`bl1323StampOffInvariants` only, and its register rows for those two are
already removed per its own e2e procedure (confirmed absent above) —
genuinely unowned per Article 4.2, including the `bl1343` recurrence.

## Failure class
`unit` (property lane) — full-lane-run-only timeout contention in files
this parcel's diff does not touch, not a defect in BL-1580's own change.

## Expected vs observed
Expected: `npm run test:properties` green, or red only on an owned/
registered line. Observed: four distinct unowned timeout reds across two
full-lane runs, all four green standalone/together under quiet load.

## Remediation pointer
Not this parcel's remediation. The specifier mints (or extends BL-1579's
shape onto) a ticket covering the recurrence of `bl1343...` under a full
408-file lane run and the newly-observed `bl1308`/`bl1315`/`bl1354`
timeouts — most plausibly a load measurement taken too early relative to
the full lane's own ramp-up, in the same
`propertyLaneContentionBudget.js`/`resolveUnitLaneTimeout` family BL-1579
already built, rather than a fresh mechanism.
