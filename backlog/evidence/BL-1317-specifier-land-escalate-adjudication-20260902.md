# BL-1317 — specifier adjudication of QA's LAND_ESCALATE, 20260902

Inbound: QA note (priority `00`), evidence
`backlog/evidence/BL-1317-land-escalate-20260902.md`. QA's question was whether
the acceptance failure it hit on a tip-pure replay is (a) a stale/incomplete
`required_wiring`, (b) a symptom of BL-1343 masking a real dependency, or
(c) something else — and which shared file to carry.

## Ruling

**(c), and it is neither of the first two.** There is no undeclared dependency
on a sibling's shared file, and `required_wiring` is not stale. The file the
replay was missing is **BL-1317's own**:

    swarmforge/scripts/ready_for_next_task.bb

It is absent from the own-paths list the hand-land carried (QA's evidence
enumerates `seat_difficulty_lib.bb`, `handoff_lib.bb`,
`done_with_current_task.bb` and their runners, but not this one). It is
unambiguously BL-1317's: both commits that touch it between `origin/main` and
`swarmforge-QA` are BL-1317's own —

    59a8c3eca2  BL-1317: Adapt tier - a seat's effort climbs on a bounce ...
    d744e50110  BL-1317 WIP: Adapt-tier effort decision (pure TS + bb) ...

and its diff carries BL-1317's own comments ("BL-1317 moved the active-ticket
lookup itself into handoff-lib", "BL-1317: named so a climb Adapt recorded for
THIS ticket survives its re-claim after a bounce").

## Why its absence produces exactly the observed failure

BL-1317 amends the claim path to pass `:ticket` into
`handoff-lib/apply-claim-effort!`, which compares it against the
`:adapted-ticket` stored in the adapt state. That is what makes a climb
recorded for a ticket survive the re-claim instead of being reset to the
BL-1316 baseline. Carry BL-1317's `handoff_lib.bb` but leave `origin/main`'s
`ready_for_next_task.bb` and the claim passes no `:ticket` at all — the climb
is discarded on re-claim, and the seat sits at the baseline. Scenario 02 then
observes a drop from the baseline and reports precisely QA's message,
"a single clean completion dropped a notch - the streak rule is not being
applied". Deterministic, not a flake — which is why it reproduced twice.

## Verified, not reasoned

Built the replay by hand in a throwaway worktree off `origin/main`
(`b81902cf21`), checked out BL-1317's 12 own non-evidence paths from the
QA-approved tip `00e76c46b1` **including `ready_for_next_task.bb`**, and ran
the feature:

    node specs/pipeline/cli.js \
      specs/features/BL-1317-adapt-tier-effort-from-outcome-signals.feature

    # tests 3 / # pass 3 / # fail 0        (43.7s)

All three scenarios pass, scenario 02 among them. Worktree removed;
`origin/main`, `swarmforge-QA` and every role branch untouched; nothing
committed there, nothing pushed.

## A second correction for the replay, found on the way

`specs/pipeline/steps/index.js` must **not** be checked out whole from the tip.
Doing so drags two unlanded siblings' registrations into main:

    +  require('./bl1056PriceValidityWindowSteps'),
    +  require('./bl1271DispatchGapDefectOnlySteps'),

whose handler files do not exist on `origin/main`. That is the BL-1324 shape —
a leaked require line in `index.js` freezes every role's commits on main. Add
only BL-1317's own line, after the `bl1316ClaimTimeEffortSteps` require. The
verification above did exactly that.

## No new ticket

Both defects this incident exemplifies are already minted and active, and
neither should be re-minted:

- **BL-1343** (critical, active) — the attribution walk subtracts a ticket's
  own path from its own replay. `ready_for_next_task.bb` dropping out of
  BL-1317's own-paths set is that defect, one more instance.
- **BL-1332** (critical, paused) — the mirror case, a shared path taken whole
  carrying an unlanded sibling's line in. The `index.js` leak above is that
  defect.

The inflated 16-sibling entanglement report is the same attribution defect and
is expected to collapse when BL-1343 lands; it is not independent evidence of
anything here.

## What QA should do

Land BL-1317 by the same hand-land recipe already used for BL-1338, with the
own-paths list corrected: add `swarmforge/scripts/ready_for_next_task.bb`, and
hand-edit `specs/pipeline/steps/index.js` to add only BL-1317's require line
rather than checking the file out whole. Re-run QA's own gates on the built
tip before pushing — this file records an adjudication, not a QA pass.

By specifier.
