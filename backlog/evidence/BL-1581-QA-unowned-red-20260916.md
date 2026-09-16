# BL-1581 — QA unowned-red hold, 2026-09-16

## Failing command
`npm run test:properties` (extension/), full lane, run as part of the
BL-1581 final-gate property-suite check.

## Commit
Parcel commit under test (pre-merge, this branch's tip before the hold):
merge of documenter `a902913ddf` into QA (`Merge documenter a902913ddf into QA.`).

## First error excerpt (verbatim)
```
FAIL  test/bl1030StopFlagTokenBoundary.property.test.js > BL-1030/BL-654 invariant 1: a forbidden flag is refused exactly when the SHELL makes it a token of its own
AssertionError: generator coverage: only 11 of 60 draws were real flags (floor 12)

- Expected
+ Received

- true
+ false

 ❯ test/bl1030StopFlagTokenBoundary.property.test.js:197:10
   195|   // Generator reach: an asserted floor, not a hoped-for one. Both hal…
   196|   // the invariant have to be exercised or the sweep is one-sided.
   197|   assert.ok(refusedCount >= 12, `generator coverage: only ${refusedCou…
```

## Failure class
`behavior` — a sampled-reach-floor generator-coverage assertion (the
BL-1062/BL-1578/BL-1580/BL-1581 shape), not a defect in the guard code
the file exercises.

## Expected vs observed
Expected: `refusedCount >= 12` of 60 draws to be real forbidden flags.
Observed: only 11 of 60 in this one seeded run — a floor a uniform draw
misses some fraction of the time, same shape as every prior sampled-floor
ticket this week.

## Reproducibility
Re-ran the file standalone 5/5 times immediately after
(`npx vitest run --config vitest.properties.config.mjs
test/bl1030StopFlagTokenBoundary.property.test.js`): green all 5. This is
an intermittent sampled-floor miss, not a deterministic defect — reported
as such per QA.prompt's "say deterministic or flaky only from evidence."

## Ownership check (BL-1063)
- `grep -rl "bl1030StopFlagTokenBoundary\|generator coverage: only" backlog/active backlog/paused` -
  no hit naming this file as an owned fix ticket.
- `grep -n "bl1030" backlog/standing-reds.tsv` - no row.
- `backlog/evidence/BL-1583-sampled-reach-floor-census-20260915.md` lists
  `extension/test/bl1030StopFlagTokenBoundary.property.test.js` as a
  census candidate (`default100`, unresolved miss rate) but NOT as a
  swept/owned file: `grep -n "bl1030" backlog/paused/BL-1585*.yaml
  backlog/paused/BL-1586*.yaml backlog/paused/BL-1587*.yaml` - no hit.
  It falls in the epic BL-1583's `remaining_slices` (sweep 4/5/6), not yet
  minted as its own fix ticket.
- Conclusion: UNOWNED. This red is not this parcel's defect (BL-1581
  touches only `extension/test/bl1358MutantTimeCeilingInvariants.property.test.js`
  and its step handler) and has no open ticket naming it.

By QA.
