# A pre-existing, already-on-main defect surfaced while clearing BL-979's un-reverted bounce (2026-08-21)

**Author**: architect, discovered while actioning QA's BL-986 bounce
(`backlog/evidence/BL-986-bounce-20260821.md`), NOT a defect in BL-986 or
BL-979.

## What happened

Reverting BL-979's un-reverted pivot commit (`89fc90eee`, per BL-490/BL-495 —
see the revert commit `bfc398249` for the full obligation trail) restored
`extension/src/concierge/pipelineBoard.ts`,
`specs/features/BL-585-pipeline-board-ticket-column-matrix.feature` and
`specs/pipeline/steps/bl585PipelineBoardTicketColumnMatrixSteps.js` to their
pre-BL-979 content. Running the BL-585 feature against that restored state
turns up 2 failures (of 14) that were not visible before the revert:

```
Scenario "the epic prints as a per-ticket caption under the matrix" failed at
step "Then the caption line "537 swarm-reliability" appears below the matrix":
expected caption "537 swarm-reliability" in:
   537
...
537 (no backlog entry)
```

## This is NOT new breakage — it is already live on `main`

`git diff main -- extension/src/concierge/pipelineBoard.ts
specs/features/BL-585-pipeline-board-ticket-column-matrix.feature
specs/pipeline/steps/bl585PipelineBoardTicketColumnMatrixSteps.js` is EMPTY:
the three files are byte-identical to what is already shipped on `main`
today. `git merge-base --is-ancestor 4a0943328 main` (BL-956's hardening-pass
tip) is true, and `main`'s own history for these three files stops at
BL-585's own commit `a2ae8852c` — BL-956 never touched them.

Root cause: BL-956 (`main`, landed) changed `gridCaptionLine` in
`pipelineBoard.ts` to read `row.title ?? row.slug ?? NO_BACKLOG_ENTRY_LABEL`
for the caption text (the human hotfix moving captions from
epic-per-column to per-ticket title), but never updated BL-585's sibling
scenario 03, which still builds a fixture row of `{ id, column, epic, slug:
'' }` with no `title` — so on the shipped `main` code, that row's caption is
`(no backlog entry)` regardless of the `epic` the scenario sets, for BOTH
Examples rows in the Outline (the "absent" row's expected caption `537 (no
epic)` also does not match). This was never caught because nothing ran
BL-585's suite at BL-956's own tip — [[lesson_run_the_sibling_acceptance_features_cochange_flags]]
names exactly this class of gap.

BL-979's pivot (`89fc90eee`) rewrote this whole file for the row-per-ticket
layout as part of unrelated work, coincidentally replacing the stale
scenario with new ones — masking the break rather than fixing it. Reverting
BL-979 (required to clear BL-986's contamination) removed the mask, not the
underlying defect.

## Why I am not fixing this myself

- Not a defect in BL-986 (QA's own scope check already confirmed zero file
  overlap) or in BL-979 (BL-979 never claimed to fix BL-585's captions; its
  rewrite happened to but that was never the point of that ticket).
- It is a correctness defect I can see, but it is out of scope for both
  parcels currently in front of me and pre-dates them on `main` — not
  something to hand-patch inline as architect (writing the test/step-handler
  fix is coder's job, not mine), and not a `rule_proposal` either since this
  is a concrete defect, not a durable rule.

## Remediation

Re-express BL-585 scenario 03's Examples against BL-956's shipped
title/slug-first caption semantics (either give the fixture row a `title`,
or accept `(no backlog entry)`/`(no epic)` as the correct caption when only
`epic` is set — whichever the epic-vs-title caption behavior is actually
supposed to be is a product call, flagging rather than picking). Filed via
note to specifier + coordinator for ticketing; this file is the evidence
trail.
