# BL-935's bounced vacuous property test is live on `main` — 2026-08-19

## What QA reported
QA note (priority 00, to coordinator+architect): "BL-935's architect-bounced
e4b327e03 rode unreverted into be903f731" (be903f731 = QA-approved BL-947
commit, merged into this worktree this session).

## Verified, and it is worse than "rode unreverted"
This is not just an ancestry technicality — the actual FILE CONTENT on
`main` right now is the bounced, vacuous version, not the later fix:

- `git merge-base --is-ancestor e4b327e031 main` → true.
- `git merge-base --is-ancestor dfc82c1fd main` → **false** (`dfc82c1fd` is
  the coder's own fix for the exact defect I bounced e4b327e031 for —
  replacing the structurally vacuous P1 property — and it never reached
  `main`).
- `git show main:extension/test/vitestForkCeiling.property.test.js` is
  **byte-identical** to `git show e4b327e031:extension/test/vitestForkCeiling.property.test.js`
  — confirmed via direct diff.

So `main` currently ships the property test my own bounce
(`backlog/evidence/BL-935-architect-bounce-20260819.md`) found structurally
vacuous: "P1 ('never RAISES the fork count above what raw RAM allows')
could not fail for ANY finite return value of resolveVitestForkCeiling ...
the property tested resolveWorkerPoolSize's unchanged code, not this
ticket's new function." That characterization is the coder's own (from
`dfc82c1fd`'s commit message), confirming my finding was correct and that
the fix — which never landed — was a real, substantive correction, not a
process nicety.

## Root cause, my own process gap
Per "A Bounce Must Be Reverted Out Of The Bouncing Branch" (BL-490/BL-495):
bouncing a parcel requires reverting the bounced commit out of the
reviewing branch in the same step. I bounced e4b327e031 (`backlog/evidence/
BL-935-architect-bounce-20260819.md`) and dfc82c1fd (`backlog/evidence/
BL-935-architect-bounce-routing-20260819.md`) without reverting either
merge in my architect branch. Neither `git log --all --grep=e4b327e0` nor
`--grep=dfc82c1fd` across the whole repo shows a revert commit. Both
bounced commits' content therefore stayed live in my branch and rode
forward through later, unrelated tickets I correctly forwarded (their
ancestry includes my un-reverted merges).

## Disposition — not mine to fix unilaterally
`e4b327e031` is already an ancestor of `main`. Per the constitution's
explicit exception ("A Bounce Must Be Reverted..."): already an ancestor of
`main` → do NOT revert, report the breach. This is the SAME defect class
BL-952 already tracks (QA-ancestry-as-approval, BL-945's case) — a second,
independent occurrence, and a more severe one: BL-945's landed code was
docs/tooling; this one is a test file that silently provides zero coverage
for a stated invariant while reading as verified. Not reverting main here
myself; not touching BL-952's scope (its own `constraints:` already rules
out re-litigating disposition of already-landed code — that's the
operator's call). Surfacing as a second data point via `note` to specifier
+ coordinator, priority 00, so it feeds BL-952 the way BL-951 collected
multiple data points before a fix was scoped.

## What I am doing differently going forward
Any future bounce I record will include the revert step in the same
commit sequence — `git revert -m 1 <my-review-merge-commit>` — before
moving to the next task, confirmed by content diff (not ancestry) per the
constitution's own instruction. This gap affected exactly the two BL-935
bounces this session generated; no other bounce this session exists to
check against.
