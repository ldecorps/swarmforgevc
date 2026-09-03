# Land-queue deadlock on specs/pipeline/steps/index.js — 2026-09-03

Four APPROVED tickets each add one `require(...)` line to
`specs/pipeline/steps/index.js` on `swarmforge-QA`, none of them landed:

    + require('./bl1296BubbleSeatSteps'),
    + require('./bl1309LandDecideStepEntanglementSteps'),
    + require('./bl1356StampOffWatchesTheRunSteps'),
    + require('./bl1359MergeChargedOnlyWithIntroducedSteps'),

All four: `human_approval: approved`, `status: todo`, `backlog/active/`.

## Why none can go first

`land_step_cli.bb` builds a tip-pure commit "containing only this ticket's own
paths". For a SHARED path BL-1332's rule is that a replayed path is taken
WHOLE, so a tip-pure commit for any one of the four would carry the other
three's lines. Each therefore returns `LAND_ESCALATE` naming the others as
unlanded siblings. QA has now reported three of the four (BL-1309, BL-1356,
BL-1359).

The two escapes are closed independently and each for a good reason:

- A combined multi-ticket commit is refused by the task-scope gate (BL-1192).
- `land_step_cli.bb` takes ONE task name and one commit; there is no
  multi-ticket land mode.

## This is the predicted cost of BL-1309's ruling, larger than predicted

BL-1309 asked the human how wide the refusal should be. Option 1 - refuse every
entangled tip - was chosen, and its stated cost was "a slower land, every time,
including the many where the entangled sibling was going to land ten minutes
later anyway".

The cost is not only slower. When N approved tickets share one path it is
circular: none is landable until another lands. Option 2 - refuse only when the
sibling is WITHHELD or awaiting approval - would dissolve this case entirely,
because all four siblings here are approved.

That consequence was not in the options as put, so it is new information rather
than a re-litigation of a settled ruling.

## Not a QA error

QA diagnosed each escalation correctly, did not hand-roll a replay, and did not
rebase to reword a merge - both out of policy and both correctly declined. The
escalations are the gate working as ruled.
