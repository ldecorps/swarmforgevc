# BL-1579 — QA unowned-red hold, 2026-09-15

## Commit tested

`eff1a391b7` (Merge documenter ceffd309e0 into QA — the BL-1579 parcel commit
under verification).

## What happened

BL-1579's own scope (`extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`
and `extension/test/bl1323StampOffInvariants.property.test.js`) is fully
verified green: both files pass alone (unloaded, 3x each) and 5/5 loaded
`npm run test:properties` full-lane runs alongside a concurrent
`npm run test` load generator (peak 1-minute load 17.04 on 20 cores) — see
`backlog/evidence/BL-1579-coder-20260915.md` for the coder's own repro/fix and
this pass's own gate log. The full unit suite is 620/620 files, 10513/10513
tests green. Acceptance on `specs/features/BL-1579-*.feature` is 4/4 green.
`pre_qa_gate.sh` reports OK. `qa-sibling-check.js status --ticket BL-1579`
reports `VERIFY BL-1579` (no open deferral).

BL-1579's own `qa_e2e_procedure` step 2 requires a full `npm run
test:properties` lane run and recording "every red of any other file... with
its assertion text." That run surfaced ONE red, in a file BL-1579 never
touches:

**`extension/test/bl1358MutantTimeCeilingInvariants.property.test.js`**, test
`BL-1358/BL-654 P1+P2: a timeout is its own verdict, and leaves every other
mutant its ordinary one`, verbatim:

```
AssertionError: the hang was never followed by another mutant - P2 was never actually exercised

- Expected
+ Received

- true
+ false

 ❯ test/bl1358MutantTimeCeilingInvariants.property.test.js:152:10
    150|   // A hang in last position alone would prove nothing about the rest …
    151|   // run continuing, so the reach that matters is asserted specificall…
    152|   assert.ok(hangFollowed > 0, 'the hang was never followed by another …
```

## Grep for an existing owner

`grep -rl "bl1358MutantTimeCeilingInvariants\|BL-1358" backlog/` finds only
`backlog/done/BL-1358-a-mutant-that-will-not-finish-is-killed-and-reported.yaml`
(closed) and its own pass-evidence trail (coder/cleaner/architect/hardener/
land-success, all 2026-09-04) — the ticket that AUTHORED this test, not an
open ticket for a red in it. `backlog/standing-reds.tsv` carries no row for
this file. This is an unowned red, first sighting.

## Reproduction (not this parcel's cause)

The file is untouched by BL-1579 (not in `git diff origin/main..HEAD --stat`
for this parcel outside the two named test files, the new helper, and the
new feature/step files). Re-ran the file alone, unloaded, 5 more times after
the lane-run failure: 1 fail (the lane run itself) / 6 total attempts (17%).

This reads as a genuine sampled-floor gap, not a load-timeout (the failing
assertion is a reach-floor check, not a `Test timed out` message, and the
file runs ~4.5-5s, far under the 20s cap). Reading the test
(`test/bl1358MutantTimeCeilingInvariants.property.test.js:104-153`): the
outer `fc.assert` uses `numRuns: 3` only. `hangFollowed` increments when the
drawn hang position is NOT last among 1-2 ordinary mutants
(`fc.array(fc.constantFrom('pass','fail'), {minLength:1,maxLength:2})`,
`position = rawPos % (ordinary.length + 1)`). Per-run miss probability is
1/2 when `ordinary.length===1` (position drawn from {0,1}) or 1/3 when
`ordinary.length===2` (position drawn from {0,1,2}) — i.e. roughly a third to
a half chance per run that the hang lands last. Over only 3 runs, the
all-last-position (assertion-failing) case is far from negligible; the
observed 1/6 empirical rate is consistent with that arithmetic. This is the
same class of construction-with-too-few-draws floor the specifier fixed
today in BL-1572/BL-1580/BL-1564/BL-1559 — flagging rather than fixing per
QA's own prompt (QA never edits mutation/property test logic itself).

## Disposition

Per Article 4.2 / the 2026-09-05 standing-red-register amendment: this red
carries no open ticket, so BL-1579's approval is withheld until it is owned.
This is not BL-1579's defect and not a bounce — the parcel waits. QA hold
opened (`BL-1579-two-fixture-spawning-property-files-red-under-lane-load`,
red `extension/test/bl1358MutantTimeCeilingInvariants.property.test.js`).

By QA.
