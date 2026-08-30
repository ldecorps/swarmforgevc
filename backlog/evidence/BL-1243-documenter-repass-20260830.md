# BL-1243 — documenter re-pass after QA bounce, and a merge hazard caught before it landed

Documenter, 2026-08-30.

## The bounce (D1-D4) and the doc half

QA's D4 was mine: `Specification.MD`'s entry said "unavailable or never
captured → no per-pane signal at all" and, one sentence later, that a blank
capture answers `stale` — both clauses describe a pane with no usable text
and they contradicted each other. The coder fixed the wording while
answering D1-D3 (commit `9f5a29f41`), since QA routed D4 under "code AND
docs both defective → the earlier of the two". Verified the corrected clause
now reads consistently: "unavailable, meaning no capture at all → no
per-pane signal ... A blank capture ... is the other half of that and
answers for itself with `stale`". No further doc change needed — this is a
clean review pass on the doc content itself.

## The hazard this pass caught: `merge_and_process`'s QA-bounce revert silently dropped the rebuild

The task named `merge_and_process hardender 5b307f2d1f`. Merging that commit
also pulled in QA's own revert of the FIRST (bounced) merge,
`c51f5ebb07` ("Revert 'Merge documenter BL-1243 c339946666 into QA.'"),
which is not an ancestor of the hardener's re-pass branch. Git's three-way
merge resolved `extension/src/bridge/residentPaneLive.ts` and
`specs/pipeline/steps/index.js` **without conflict markers** — but the
resolution silently applied the revert's deletions: `activitySignal`, the
`PaneActivitySignal` type, and `derivePaneActivitySignal` entirely gone from
the first file, and the `bl1243LiveScreenPerPaneActivitySteps` registration
gone from the second. Two evidence files
(`BL-1243-architect-review-20260830.md`,
`BL-1243-hardener-pass-20260830.md`) were also staged for deletion the same
way.

Caught by diffing the merge result against the hardener's own tip
(`git show 5b307f2d1f:<path>`) rather than trusting a clean `git status` —
this is the merge-silently-drops-fix class the constitution's guardrails
name explicitly ("a merge can silently revert already-landed work — diff
every merge against BOTH parents"). All five affected paths were restored to
byte-identical copies of the hardener's tip before committing the merge;
`activitySignal`/`derivePaneActivitySignal`/the bl1243 step registration are
confirmed present post-commit.

## Runs

Re-read the corrected Specification.MD clause and the restored
`residentPaneLive.ts` by eye; no test suite re-run needed since no logic
changed in this pass — the fix already exists on the hardener's tip and
this pass only prevented the merge from erasing it.
