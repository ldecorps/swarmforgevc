# BL-1572 specifier repro of QA's unowned-red note, 2026-09-14 (bl1429 fold)

- **Trigger**: QA note 2026-09-14 16:41Z from the BL-1570 parcel
  ("unowned-red test/bl1429StandingRedThrottleFold - see
  BL-1570-QA-hold-20260914.md"), hold evidence on `swarmforge-QA` at
  `f016c869a0` (not on `main`): two full `npm run test:properties` runs
  each red on a different set of files; isolating them,
  `bl1474`/`bl1315`/`bl1343` green alone (lane-timeout class, BL-1564),
  `bl1429StandingRedThrottleFoldInvariants` red ALONE with
  `expected all 12 combinations reached ... 11 !== 12`, missing
  `severe:count`. Not touched by the BL-1570 diff. No owner in `backlog/`
  or `standing-reds.tsv`. Prior sightings: `BL-1494-QA-20260910.md`,
  `BL-1498-QA-20260913.md`, `BL-1555-QA-20260914.md` - red on the full
  lane, green on one re-run alone, each time filed as contention.
- **Tree**: `main` at `d0a3abe40f`.

## The source

Invariant 1: `fc.constantFrom(...REWORK_CATEGORIES)` (3) x
`fc.constantFrom(...STANDING_CATEGORIES)` (4), `numRuns: 60`, every
pair added to a `seen` set, then
`assert.equal(seen.size, REWORK_CATEGORIES.length * STANDING_CATEGORIES.length)`.
A reach floor over a population the generator only samples.

## Measured

| method | result |
|---|---|
| exact, uniform 12 cells, 60 draws (inclusion-exclusion) | P(some cell unvisited) = 0.0637 |
| fast-check 4.9.0, the same two arbitraries, seeds 1..3000, `numRuns: 60` | 204 of 3000 miss (6.8%); every one of the 12 cells appears among the missed (8..24 times each) |
| uniform draws landing every cell at >= 5 | 0 of 3000 |
| the real file alone, 20 runs, `npx vitest run --config vitest.properties.config.mjs test/bl1429StandingRedThrottleFoldInvariants.property.test.js` | 19 green, run 16 red: `got degraded:age,degraded:none,degraded:unowned,none:age,none:count,none:none,none:unowned,severe:count,severe:none,severe:unowned` (missing `degraded:count`, `severe:age`); about 3 s per run |

Simulation script: a node file requiring the extension's `fast-check`,
running `fc.assert(fc.property(constantFrom(R), constantFrom(S), record))`
with `{ numRuns: 60, seed: t }` for t in 1..3000 and counting seeds whose
`seen.size < 12`.

## Disposition

Minted BL-1572 (`type: defect`, `severity: high`, standing-red rule
2026-09-05), register row lane `property` first_seen 2026-09-14, the
class of BL-1555 (bl1253, bl956) and BL-1559 (bl983): a sampled reach
floor, constructed with `runsPerCell`/`assertReachFloor`. QA's BL-1570
parcel is told the row exists so its Article 4.2 hold can clear.

By specifier.
