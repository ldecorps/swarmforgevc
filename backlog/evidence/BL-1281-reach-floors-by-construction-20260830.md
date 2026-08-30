# BL-1281 — bl1048's reach floors are met by construction

Coder, 2026-08-30.

## What shipped

`extension/test/bl1048DeliveredParcelIsNotNotStarted.property.test.js` splits
its run budget across the SHAPE space and pins the first two tickets of every
draw to that cell's shape. The floors are untouched. Nine inline
`assert.ok(coverage.x >= N)` statements are replaced by BL-1062's shared
`assertReachFloor`, over floors now declared as data in
`extension/test/helpers/bl1048ReachFloors.js`.

## The arithmetic, so the guarantee is checkable rather than asserted

24 runs over 6 shapes is `runsPerCell(24, 6) = 4` runs per cell; each draw in a
cell carries 2 tickets of that cell's shape; so every shape is observed **at
least 8 times per run**. The two at-risk floors are 8. The remaining 0-4
tickets of each draw stay free, so the seven floors that were never at risk
keep the sampling breadth they had — and gain from the pinning, not lose.

The array stays 2-6 tickets, and the ticket arbitrary is the SAME record with
one field replaced (`TICKET_FIELDS` is named once), never a second hand-written
record that could drift.

## Measured, the same instrument the ticket used

A replay of the generator and the coverage-counting block, 2000 simulated runs:

| floor | value | miss rate before | miss rate after |
|---|---|---|---|
| deliveredOnly | 8 | 1.15% | **0.00%** |
| openedOnly | 8 | 1.32% | **0.00%** |
| the other seven | — | 0.00-0.05% | **0.00%** |
| **run level** | | **2.50%** | **0.00%** |

The real test was then run at seeds 1, 7, 4242, 99 and 12345 — 5/5 — via a
`PROPERTY_SEED` seam added for exactly this, which the acceptance drives.

## Why the generator moved into a helper

`helpers/bl1048ReachFloors.js` holds `SHAPES`, the floors, the ticket
arbitraries (`makeTicketArbitraries`), the pure shape-keyed counter, and
invariant 2's `weakenedFloors` predicate. bl1048, the property lane and the
acceptance all drive that one module.

The alternative was to leave them inline and let the property lane restate the
generator — which is the drift trap the engineering rules name, and would have
let BL-1281's property go green while bl1048's actual draw changed underneath
it. `fc` is passed in rather than required inside the helper, so it loads
outside vitest (the acceptance does) and there is one fast-check instance.

## The declared invariants (BL-654)

`extension/test/bl1281ReachFloorConstructionInvariants.property.test.js`.

**Invariant 1** is quantified over the SEED — the whole of what the old scheme
left to chance. 200 drawn seeds, each a full replay of the shipped scheme, each
required to clear both at-risk floors.

Its sensitivity half is **deterministic, not a second sample**. Searching the
old scheme for missing seeds found six inside the first 205 — 26, 142, 150,
169, 184, 205 — and those are pinned: each must still miss under the OLD
scheme (so a stale control announces itself) and must clear under the shipped
one. A control that was itself a 2.5%-per-seed lottery would be this ticket's
own defect wearing the costume of its proof.

**Invariant 2** compares the shipped floors against `PRE_CHANGE_FLOORS`, frozen
in both the property test and the acceptance handler so the comparison has a
fixed reference rather than comparing the list against itself. Both ways a
floor can be weakened — lowered, and dropped — are exercised for every one of
the nine, by construction rather than by hoping a random mutation hit both.

**Non-vacuity, shown by running:** reverted `drawForShape` to the unpinned
sampled array → both invariant-1 properties FAIL, naming a seed and the floor
it missed (`seed 308640: openedOnly reached 6, floor 8`). Restored, green.

## Runs

| what | result |
|---|---|
| bl1048 property test | 1/1, ~2.5s (was ~3.6s) |
| bl1048 at seeds 1, 7, 4242, 99, 12345 | 5/5 |
| BL-1281 property test | 4/4 |
| BL-1281 acceptance | 5/5 |
| full `npm run test:properties` | 27 files / 16 tests red — the standing set, unchanged; neither bl1048 nor bl1281 is among them |

`bl1048DeliveredParcelIsNotNotStarted.property.test.js` is still ABSENT from
`swarmforge/scripts/property_suite_standing_allowlist.tsv`, as the ticket's
second constraint requires — the flake is removed, not tolerated.

## Left as found

bl968, bl948 and bl955 (BL-1062's, and its ruling's), the other seven floors in
this file, and the repo-wide question of which other property tests declare a
sampled floor. The one lesson this ticket proves about that sweep is already in
its own notes: a floor count is not a defect count — seven of these nine were
never at risk.
