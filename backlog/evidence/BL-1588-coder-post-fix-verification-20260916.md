# BL-1588 — post-fix verification, 2026-09-16

## The fix

`extension/test/helpers/propertyLaneContentionBudget.js`'s
`propertyLaneTimeoutMs` now takes `max(load-derived factor, forks /
QUIET_LOAD_CEILING)` where `forks` comes from
`vitest.properties.config.mjs`'s own `WORKER_POOL_SIZE`
(`resolveVitestWorkerPool`), published to every worker via the
`SWARMFORGE_PROPERTY_LANE_FORKS` env key before any fork spawns. A single
fork (a file run alone) contributes `1/4 = 0.25`, under the `factor > 1`
threshold, so a lone file on a quiet host still resolves to the strict
20000 ms base — unchanged from before this parcel (invariant 1, encoded in
`extension/test/bl1588PropertyLaneBudgetConcurrencyInvariant.property.test.js`).
`bl1308`, `bl1315` and `bl1354` are wired to `propertyLaneTimeoutMs` the
same way `bl1343` already was (BL-1579).

## 20-of-20 alone, each of the four named files (post-fix, `tmp/bl1588-alone-*.log`)

| file | runs | FAIL lines | duration range |
|---|---|---|---|
| bl1308SiblingDetectorCoversReplay | 20/20 green | 0 | 8.58s–11.52s |
| bl1315OwnPathsFullRangeInvariants | 20/20 green | 0 | 13.44s–27.55s |
| bl1343ReplayNeverDropsOwnPathInvariants | 20/20 green | 0 | 14.47s–19.41s |
| bl1354SharedPathLandedSiblingInvariants | 20/20 green | 0 | 8.70s–12.42s |

Every run stayed under the 20000 ms base (a single fork, quiet host —
invariant 1 holds).

## 5 full property-lane runs (post-fix, `npm run test:properties`, `tmp/bl1588-postfix-lane-{1..5}.log`)

None of the four named files, `bl1343ReplayNeverDropsOwnPathInvariants` or
`bl1323StampOffInvariants` (BL-1579) failed in any of the 5 runs. Per-test
durations for the four named files across all 5 runs, all comfortably
inside their scaled budget:

| run | bl1308 | bl1315 | bl1343 | bl1354 | exit |
|---|---|---|---|---|---|
| 1 (233.03s) | 25594ms | 24221ms | 42777ms | 30304ms | 1 (unrelated, below) |
| 2 (240.15s) | 23442ms | 21267ms | 37097ms | 24701ms | 1 |
| 3 (239.06s) | 20237ms | 20220ms | 29357ms | 23225ms | 1 |
| 4 (236.77s) | 21905ms | 18577ms | 32640ms | 25061ms | 1 |
| 5 (235.60s) | 19877ms | 18715ms | 30063ms | 21418ms | 1 |

Every one of the 5 runs failed exactly one test, and it is the same test
in every run:
`test/bl1280MkdtempMigrationInvariants.property.test.js > BL-1280
invariant 2 ... leaves the real tree with no raw call site under the
three-path list` — the unowned red reported separately
(`backlog/evidence/BL-1588-coder-unowned-red-bl1280-20260916.md`), owned
by **BL-1593**, unrelated to this parcel's scope; run 1 additionally hit
`bl1529ScriptSenderAuditOutcomesInvariant`'s own explicit 60000ms budget
(`Error: Test timed out in 60000ms.`), owned by **BL-1592**
(`depends_on: BL-1588`) per
`backlog/evidence/BL-1588-coder-full-lane-reproduction-20260916.md`. Exit
code 1 in every run reflects those pre-existing, separately-owned reds,
not this ticket's four files.

## Acceptance

`swarmforge/scripts/run_acceptance.sh
specs/features/BL-1588-fixture-spawning-property-files-time-out-in-a-full-lane-run.feature`
— 11/11 scenarios pass (scenario 01 x4, scenario 02 x4, scenario 03 x3).

## Register rows

The four rows for `bl1308`/`bl1315`/`bl1343`/`bl1354` in
`backlog/standing-reds.tsv` are removed in this same commit — the fired
route (recorded failure text in the pre-fix reproduction evidence, the
remedy above, and the green runs recorded here) is satisfied, per the
ticket's own disjunctive acceptance criteria.
