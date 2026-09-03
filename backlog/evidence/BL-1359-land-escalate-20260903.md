# BL-1359 — LAND_ESCALATE, 20260903

QA-approved commit `ea2917409f` (`BL-1359-qa-approval-20260903.md`) could
not land.

## `land_step_cli.bb`

`bb swarmforge/scripts/land_step_cli.bb
BL-1359-a-merge-is-charged-only-with-what-it-introduced ea2917409f .`
returned `LAND_ESCALATE`:

    land-step: refusing to replay BL-1359 -
    specs/pipeline/steps/index.js is shared with unlanded sibling(s)
    BL-1296,BL-1309,BL-1328,BL-1337,BL-1346,BL-1351,BL-1354,BL-1356, and
    a replayed path is taken whole, so landing it would carry the
    sibling's lines into main (BL-1332)

## Diagnosis: a genuine, growing pileup on the same shared registry file

Checked each named sibling's own `require(...)` line in `index.js`
against `origin/main` directly:

- **BL-1328, BL-1337, BL-1346, BL-1351, BL-1354**: already byte-identical
  on `origin/main` — the known per-ticket-not-per-path false-positive
  shape.
- **BL-1296, BL-1309, BL-1356**: genuinely NOT on `origin/main` yet.
  `git diff origin/main HEAD -- specs/pipeline/steps/index.js` shows
  three real added lines: `require('./bl1296BubbleSeatSteps')`,
  `require('./bl1309LandDecideStepEntanglementSteps')`,
  `require('./bl1356StampOffWatchesTheRunSteps')`. All three are
  already-documented, still-open blockers:
  `BL-1356-land-escalate-20260903.md` and
  `BL-1309-land-escalate-20260903.md` (both filed earlier today, both
  escalated to the specifier already). BL-1296 has not yet reached QA
  this session (`status: todo`, `human_approval: approved`, but its own
  required-stage pipeline has not forwarded a parcel here).

This is not a mistake in my own commits this time (unlike BL-1309's
land-escalate, which traced to my own merge-commit subject) — it is the
same shared-registry-file shape recurring because three approved-but-
unlanded tickets are now stacked on `index.js` ahead of this one, and
`land_step_cli.bb`'s whole-file replay correctly refuses to guess which
of their lines are safe to drop.

## Bounded rematch

`git fetch origin main` immediately before this attempt — no new
commits. Not a race.

## Disposition

Not a bounce — BL-1359's own code, tests, and wiring are all verified
correct (see the QA approval evidence). Approval **stands**. This is now
the third same-shaped escalation on `specs/pipeline/steps/index.js`
today (BL-1309, BL-1356, now BL-1359) — worth the specifier's attention
as a pattern, not just three isolated blocks: every ticket that lands a
new pipeline step handler queues up behind whichever earlier one is
still unlanded, and today three landed in quick succession without any
of them clearing first. Sending the specifier a `note` naming this and
the three still-open blockers, and stopping.

By QA.
