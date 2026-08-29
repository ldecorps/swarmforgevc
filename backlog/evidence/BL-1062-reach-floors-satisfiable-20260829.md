# BL-1062 — the reach floors are satisfiable by construction

Coder, 2026-08-29.

## Measured, before and after (qa_e2e steps 1 and 2)

The ticket's arithmetic, recomputed from the checked-in constants rather than
taken on report: bl968 drew 3 classes uniformly over `NUM_RUNS = 24` against
`CLASS_FLOOR = 5`, so per class P(count ≤ 4) under Binomial(24, 1/3) is 5.9%
and ~16% of runs failed on correct code; bl948 drew 3 death shapes over 12 runs
and asserted all three appeared, ~2.3% per run.

I did not have to construct the "before" observation: **this defect blocked
four of my own commits earlier today**, on a quiet host, with the pre-commit
property-suite guard refusing BL-603, BL-1268 (twice) and BL-1220 on
`test/bl968MaterializedGuardSensitivity.property.test.js` and once on an
unrelated file. The verbatim red was
`reach floor: class benign-subprocess drawn 3 < 5 of 24`, and each time the
same file passed standalone on the next attempt — which is the signature of
seed luck, not contention. Recorded at the time in
`backlog/evidence/BL-1062-coder-reply-guard-rejections.md`.

**After, 20 runs each, fresh seed per run:**

    bl968 AFTER: pass=20 fail=0
    bl948 AFTER: pass=20 fail=0

bl968's coverage is now identical on every run, which is the point:

    {"cls":{"git-root-resolve":8,"live-repo-read":8,"benign-subprocess":8},
     "depth":{"direct":12,"via-lib":12}}

## The shape

Iterate the small categorical space; layer the random draw inside each cell.

- **bl968**: cells are `CLASSES × DEPTHS` (3 × 2), each run `RUNS_PER_CELL = 4`
  times, with `suffix` / `repoFile` / `spawnExpr` still drawn randomly. Total
  draws stay at 24, so the wall clock is unchanged on a lane that already
  carries a 55s file.
- **bl948**: 3 shapes × 4 runs = 12 child spawns, same total as before.

Per invariant 1 the probability of a floor failing on a correct implementation
is now **zero, not a small number** — it is a property of the loop bounds, and
that reasoning is recorded next to the floors rather than left to be
rediscovered.

bl948's own comment claimed the coverage was "by construction" when it was by
chance. That claim is now true, and the comment records that it used to be
false — fixing the comment without fixing the sampling would have left the
flake in place, which the ticket calls out by name.

## A defect in my own first fix, found by running the break

qa_e2e step 3 asks for the restricted-generator check. My first version put the
floor assertion over the same constant that drives the iteration:

    for (const cls of CLASSES) assertReachFloor(...)

Deleting `benign-subprocess` from `CLASSES` therefore deleted its check too,
and **the break passed green** — the test would have silently stopped
exercising a class while claiming a floor. The floor is now asserted over a
SEPARATE `REQUIRED_CLASSES` / `REQUIRED_DEPTHS` list stating the contract, so
the two cannot drift into agreement:

| break | before the split | after |
|---|---|---|
| drop `benign-subprocess` from bl968's iterated space | **passed** | `reach floor: class benign-subprocess drawn 0 < 5` |
| drop `nonzero` from bl948's `DEATH_SHAPES` | `reach floor: death shape nonzero drawn 0 < 1` | unchanged |

Recorded rather than quietly corrected, because "the floor is satisfiable by
construction" and "the floor still catches a generator that stops reaching a
value" are in tension, and the first is easy to buy with the second.

## No floor was weakened or deleted (qa_e2e step 4)

`git diff` over both files shows no `-` line touching `CLASS_FLOOR`,
`DEPTH_FLOOR`, or `assert.equal(drawn.size, 3, ...)`. The constants are
unchanged at 5 and 6. bl948 GAINS a per-shape floor naming the missing shape,
which it did not have before — previously a missing shape produced only
`expected every death shape drawn, got clean, throw`.

Acceptance scenario 03 pins this mechanically: it greps both shipped files for
a required-space entry per value and for the floor assertions themselves, so a
later parcel cannot reach green by deleting one.

## Route chosen (qa_e2e step 5)

Constructive coverage, NOT raising `numRuns` — so step 5's "record the computed
probability next to the floor" applies in its stronger form: the probability is
zero by construction, and the lane's wall clock did not move (24 and 12 draws,
exactly as before).

## One shared assertion

The floor check now lives in `extension/test/helpers/reachFloors.js` and both
tests call it. That is what lets acceptance scenario 02 drive the SAME function
the tests use rather than a restatement of it — and it avoids the alternative,
which would have been mutating a live test file mid-run to prove the point.
After BL-1209 (whose whole subject was a test that wrote into the collected
test tree) that was not a trade I was willing to make.

## A THIRD file has the same defect, out of this ticket's scope

While committing this parcel the property-suite guard refused it on
`test/bl1048DeliveredParcelIsNotNotStarted.property.test.js`:

    AssertionError: opened-only reach too low:
      {"deliveredOnly":12,"openedOnly":7,"bothStatesSameRole":14,"crossRole":33,...}
    { seed: 1272683747 }

That is BL-1062's defect exactly — a sampled reach floor asserted after an
unseeded draw. The file passes standalone, and it declares **nine** floors over
`numRuns: 24` (`deliveredOnly >= 8`, `openedOnly >= 8`, `bothStatesSameRole >= 4`,
`crossRole >= 6`, `deliveredNote >= 4`, `deliveredBatched >= 4`,
`deliveredMasterResident >= 2`, `noParcel >= 4`, `closedButDelivered >= 2`),
each a separate lottery against the same 24 draws; the observed miss was
`openedOnly` at 7 of a required 8.

Not fixed here. This ticket names two files and computes the arithmetic for
each; widening it to a third with nine interacting floors would be scope creep
on a slice whose whole point is that the floors were never checked for
satisfiability. Reported to the specifier by note instead. The fix shape this
parcel establishes — iterate the space, layer the draw inside, assert the floor
over a separate required-space list — applies directly, and
`extension/test/helpers/reachFloors.js` is now there to be reused.
