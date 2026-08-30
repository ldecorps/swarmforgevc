# BL-1224 — documenter re-pass after a process-only QA bounce, and a second merge hazard caught

Documenter, 2026-08-30.

## The bounce

QA's bounce was process-only: the architect's design-review gate had no
evidence file and no recorded review, just a bare merge. No code or doc
defect was named — the implementation itself was verified correct in the
same bounce note. The architect supplied the missing review evidence
(`BL-1224-architect-review-20260830.md`) and the parcel reached me again
with no functional change.

## The hazard this pass caught: the QA-bounce revert would have deleted the entire BL-1224 feature, silently

The task named `merge_and_process hardender 729d88f798`. Merging it also
pulled in QA's own revert of the bounced merge, `11c10d9eaf` ("Revert
'Merge documenter BL-1224 0de070faad into QA.'"), not an ancestor of the
architect/hardener re-pass branch. This is the same class caught during the
BL-1243 re-pass earlier today, at much larger scale: git's three-way merge
resolved **eleven files** with no conflict markers by silently applying the
revert's deletions — `operator_runtime_watch_lib.bb`'s `adoptable-pid` /
`adopt-entry` / the `decide` branch, `operator_runtime_supervisor.bb`'s
`:pidfile-pid` plumbing and `:adopted` log arm, every BL-1224 test file
(deleted outright), the `suite-manifest.tsv` row, the step registration in
`specs/pipeline/steps/index.js`, and my own BL-1224 section in
`docs/how-to/BL-993-operator-runtime-watch.md` and Specification.MD entry —
gone, with a completely clean `git status`.

Caught the same way as last time: diffing the merge result against the
pre-merge tip (`be2660196e`) file by file rather than trusting a clean
merge. Every affected path was restored to a byte-identical copy of that
tip before committing the merge; `git diff --cached be2660196e -- .` reads
empty (ignoring the one untracked, unrelated file already present in this
worktree).

## Why this keeps happening

Both hazards trace to the same shape: QA reverts a bounced merge on ITS OWN
branch to back out the bad parcel, and that revert commit is not an
ancestor of the fixed-and-rebuilt pipeline branches. When QA's later
approval note points back at a commit whose ancestry still includes that
revert, `merge_and_process` pulls it in, and `ort`'s three-way merge treats
"the revert deleted X" and "my branch never had X modified relative to a
DIFFERENT common ancestor" as compatible — no conflict, wrong answer. A
`git diff <merge> <pre-merge-tip>` check belongs in every merge that follows
a QA bounce, not just ones that show conflict markers.

## Runs

Re-read the restored `docs/how-to/BL-993-operator-runtime-watch.md` section
and Specification.MD entry by eye against the pre-merge tip; both
byte-identical to what documenter last wrote. No test suite re-run needed —
no logic changed in this pass, only a merge outcome corrected before it
could land.
