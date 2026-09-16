# Sampled reach-floor send-time gate on `git_handoff` sends (BL-1584)

*How-to. Task-oriented: understand why a `git_handoff` send was refused
for adding a property test with a low-budget reach-floor assertion, and
how to clear it.*

Send-time gate in `swarm_handoff.bb`, alongside the other send-time gates
(`ticket_close_guard_lib.bb`, `duplicate_chain_guard_lib.bb`,
`task_commit_coherence_gate_lib.bb`, `parcel_rollback_guard_lib.bb`,
`tree_collapse_guard_lib.bb`, `unregistered_test_gate_lib.bb`). Full
mechanics:
[`swarmforge/handoff-protocol.md`](../../swarmforge/handoff-protocol.md#sampled-reach-floor-send-time-gate-bl-1584).

## What it catches

A parcel that adds a file under `extension/test/*.property.test.js` that
draws a low, literal fast-check budget (`numRuns:` under 100, or an
`fc.sample(<arb>, <int>)` call with a small count) and then asserts every
arm of its case space was reached. That shape is a seed lottery — it
passes most of the time and goes red in QA's lane at a rate of roughly 1
in a few hundred runs, with nothing actually wrong in the code under
test. `extension/test/helpers/reachFloors.js` shipped the remedy
(`runsPerCell` + `assertReachFloor`, BL-1062) well before this gate
existed, and the convention was already written into the hardener's and
coder's prompts — but nothing at the send chokepoint read the file to
enforce it, so the class kept growing: seven unowned-red tickets in ten
days (BL-1555, BL-1559, BL-1572, BL-1578, BL-1580, BL-1581 and BL-1579's
neighbours), each one an Article 4.2 hold on an unrelated parcel, a
standing-red register row, and a specifier round trip to adjudicate.

## How it decides

One pure classifier, `classify` in `sampled_reach_floor_guard_lib.bb`,
reads a property test file's text and answers `{:verdict :reach-floor?
:constructed? :budget :matched}`. The gate and the census CLI (below)
both call this same function — never a second notion of reach floor,
construction, or budget.

- **`reach-floor?`** is true when the text calls `assertReachFloor(`, or
  an `assert(`/`assert.<fn>(` call's own argument text carries one of a
  pinned phrase list (`"never reached"`, `"reach floor"`, `"both arms"`,
  `"were reached"`, and others — the full list is `known-phrases` in the
  guard lib, data rather than a hand-assembled regex, so an amendment is
  a one-line change).
- **`constructed?`** is true when the text calls `runsPerCell(` — the
  file already uses the fixed remedy and is never a refusal candidate.
- **`budget`** is the smallest literal draw count across every draw site
  in the file (`numRuns: <int>`, `fc.assert`/`fc.check` with no
  `numRuns:` counting as fast-check's default 100, and `fc.sample(<arb>,
  <int>)` or its `{numRuns: <int>}` form). It is `:unresolved` when any
  draw site's count is not an integer literal, `:none` when the file has
  no fast-check draw site at all.
- **`verdict`** is `no-floor`; `constructed` (a floor assertion alongside
  `runsPerCell`); `no-draw` (a floor assertion with no fast-check draw
  site — an exhaustive hand loop, or a hand-rolled RNG, that the
  classifier cannot distinguish from real sampling, so it never refuses
  on this verdict); `sampled-low` (a floor assertion, no `runsPerCell`,
  budget under 100 or unresolved — the refusable shape); or
  `sampled-high` (a floor assertion, no `runsPerCell`, literal budget 100
  or more).
- **A comment never matches.** `strip-comments` blanks every `//` and
  `/* */` span (string/template-literal-aware, so a comment marker inside
  a string is never mistaken for a real comment) and runs first, before
  any other check in `classify`. This applies uniformly — not only to
  phrase matching inside an assert call, but also to `runsPerCell(`
  detection — so a comment merely mentioning either never flips the
  verdict.

**Parcel-scoped and added-only.** The check asks only "does THIS parcel
ADD a `sampled-low` property test file" — a path is `:added` when it was
absent at the received commit (read from the sender's in_process
mailbox, the same reader BL-1576's merge-drop guard uses) and present at
the forwarded one. A `:modified` file, or an `:added` file of any other
verdict, is at most one `SAMPLED_REACH_FLOOR WARNING:` line naming it —
never a refusal. A pre-existing file's shape is not this parcel's fault
to fix, so the ongoing sweep of the 108 pre-existing files (BL-1585
onward) is never refused by this gate.

**Fail-open on unreadable facts**, the same posture as every other
send-time gate in `swarm_handoff.bb`: an unresolvable task id, an
unreadable forwarded commit, an unreadable recorded received commit, or
an unreadable candidate file each warn on stderr and the send proceeds.
No recorded received commit at all (an ordinary first-hop parcel) is
silent, not a warning — the same convention the merge-drop guard
(BL-1576) and BL-806 follow.

## Fixing it

The refusal names the file, the assertion text that matched (first 80
characters), the budget, and the remedy:

```text
SAMPLED_REACH_FLOOR: Cannot send git_handoff for BL-1584 - this parcel
adds a property test file that draws a low, literal budget and then
asserts every arm was reached (BL-1584):
extension/test/qaProbe.property.test.js (budget 4): "generator never
reached a". Remedy: runsPerCell(budget, cells) per cell and
assertReachFloor (extension/test/helpers/reachFloors.js).
```

1. Open the named file and find the low-budget draw site the message
   points at.
2. Replace the ad-hoc `numRuns:`/`fc.sample` draw with
   `runsPerCell(budget, cells)` per cell (import from
   `extension/test/helpers/reachFloors.js`), and replace the manual
   reach assertion with `assertReachFloor` from the same helper.
3. Commit and re-send:

```bash
git add extension/test/qaProbe.property.test.js
git commit -m "BL-1584: use runsPerCell/assertReachFloor for the reach-floor assertion"
swarm_handoff.sh ./tmp/handoff.txt
```

A `SAMPLED_REACH_FLOOR WARNING:` line (an `:added` `sampled-high`/
`no-draw` file, or any `:modified` file) is informational — the send
still queues; the same `runsPerCell`/`assertReachFloor` remedy applies if
the warning is worth acting on, but nothing forces it here.

## The census CLI

`bb swarmforge/scripts/sampled_reach_floor_census_cli.bb <project-root>`
runs the same classifier over every `extension/test/*.property.test.js`
file and prints one `file<TAB>verdict<TAB>budget` row per file, sorted by
path, plus a trailing `SUMMARY verdict=count ...` line. It replaces the
mint-time greps recorded in
[`backlog/evidence/BL-1583-sampled-reach-floor-census-20260915.md`](../../backlog/evidence/BL-1583-sampled-reach-floor-census-20260915.md);
the sweep slices' evidence and QA's e2e procedure cite its output
directly rather than re-deriving a count by hand.

## Where it lives

| Piece | Location |
| --- | --- |
| Guard library (classifier + gate) | `swarmforge/scripts/sampled_reach_floor_guard_lib.bb` |
| Census CLI | `swarmforge/scripts/sampled_reach_floor_census_cli.bb` |
| Wired into | `swarmforge/scripts/swarm_handoff.bb` (send-time `validate`, beside the BL-1240 unregistered-test gate) |
| Acceptance steps | `specs/pipeline/steps/bl1584SampledReachFloorGateSteps.js` |
| Frozen fixture corpus | `specs/pipeline/fixtures/bl1584/*.property.fixture.js` |

## Related

- [Unregistered-test send-time gate](BL-1240-unregistered-test-send-time-gate.md)
  — the sibling send-time gate this one sits beside in `swarm_handoff.bb`;
  same parcel-scoped, added-only, fail-open shape.
- [Merge-drop guard](../../swarmforge/handoff-protocol.md#merge-drop-guard-bl-1576)
  — the received-commit reader (`received-commit-for-task`) this gate
  reuses rather than re-deriving.
- `extension/test/helpers/reachFloors.js` — the `runsPerCell` +
  `assertReachFloor` remedy this gate's refusal message points at
  (BL-1062).

## Verify

```bash
bb swarmforge/scripts/test/sampled_reach_floor_guard_lib_test_runner.bb
bb swarmforge/scripts/test/bl1584_sampled_reach_floor_property_runner.bb
node specs/pipeline/cli.js specs/features/BL-1584-a-new-property-test-with-a-sampled-reach-floor-is-refused-at-send.feature
```

Acceptance:
`specs/features/BL-1584-a-new-property-test-with-a-sampled-reach-floor-is-refused-at-send.feature`.
