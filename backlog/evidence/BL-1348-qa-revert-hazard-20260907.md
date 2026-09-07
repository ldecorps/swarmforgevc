# BL-1348 — QA bounce revert wholesale-reverted ruling B, coder finding, 2026-09-07

## What happened

QA's spec-gap bounce (task `BL-1348 [spec-gap: missing free-cores
acceptance scenario]`, commit `7b045365cb`) is built on
`108d9a46e7` — `Revert "Merge documenter 9dd64ab8ba into QA."`. Taken as a
whole `git merge`, that revert would have silently reintroduced the
**rejected option-2** (raw core count) implementation over **ruling B**'s
`resolveFreeCoresCeiling`, in:

- `extension/src/tools/vitest-worker-memory-budget.ts`
  (`resolveFreeCoresCeiling` removed entirely)
- `extension/vitest.config.mjs` / `extension/vitest.properties.config.mjs`
  (`defaultCeiling` reverted to bare `os.cpus().length`)
- `extension/test/vitestWorkerMemoryBudget.test.js`,
  `bl1348VitestWorkerPoolHostSizingInvariants.property.test.js`,
  `bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`

— already fixed, already reviewed clean by cleaner
(`BL-1348-cleaner-20260907.md`) and architect
(`BL-1348-architect-20260907.md`), and already re-fixed for the spec-gap
in this same coder pass (`75bda87f37`).

The same wholesale revert also deleted two files belonging to **unrelated
tickets** that happened to be reachable through documenter's branch
history: `backlog/evidence/BL-940-coder-spec-gap-20260906.md` and
`backlog/evidence/BL-1468-premature-promotion-coder-20260907.md`.

## Why

A `git revert` of a merge commit reverses that merge's WHOLE combined diff
relative to the reverting branch's own prior state. QA's own branch had
not yet independently picked up ruling B before merging documenter's tip,
so — from QA's branch's perspective — that merge is what "introduced"
ruling B, and reverting the merge wholesale took it back out along with
the genuine defect (the missing scenario). A revert-of-merge is the wrong
tool for an omission (nothing was wrongly ADDED to revert); it only fit
here because bouncing a `git_handoff` conventionally reverts the merge
that brought the bad parcel in (BL-490/495), and that convention doesn't
distinguish "the parcel added something wrong" from "the parcel omitted
something," which is what this bounce actually was.

## What I did

Did **not** accept the merge as delivered. Merged `7b045365cb` into my
worktree, then restored every file the revert had wrongly touched back to
my own (correct) HEAD content — `extension/src/tools/
vitest-worker-memory-budget.ts`, both vitest configs, the three test
files, and all four evidence files (`BL-1348-architect/cleaner`,
`BL-940`, `BL-1468`) — keeping only the two files QA's bounce actually
intended to contribute: the `bounce_history` stamp on the ticket YAML and
the new `backlog/evidence/BL-1348-bounce-20260907.md`. Verified the final
merge commit's diff against its first parent is exactly those two files
(`git show --stat`), reran the full BL-1348 test/acceptance suite (6/6
scenarios, 37/37 + 4/4 + 2/2 unit/property tests) — all green with ruling
B intact. Commit: `0cf47be441` ("Merge QA 7b045365cb into coder (bounce
evidence only).").

## What is NOT yet resolved

`swarmforge-QA`'s OWN branch still has the reverted (option-2, BL-940/1468
evidence gone) state internally — I only fixed MY OWN worktree. Nothing
from this reverted state has reached `main` (BL-1348 never landed; still
`status: todo`). The risk window is QA's own future actions: a merge-up
broadcast note from QA telling worktree roles to merge QA's tip, sent
BEFORE QA re-syncs past this revert, would propagate the same silent
regression to cleaner/architect/hardener/documenter. Flagging for the
specifier to confirm QA's next pass on this ticket re-derives cleanly
(merges the corrected parcel forward again rather than resurrecting this
reverted tip) before any such broadcast.

I could not `redo_from.sh BL-1348 cleaner` to also replace my earlier
(functionally-identical, bookkeeping-incomplete) forwarded parcel
`75bda87f37` — cleaner had already claimed it into an in-process batch by
the time I tried. That parcel's actual fix content is correct either way
(the bounce_history bookkeeping is the only thing it lacks); not forcing
a redo into another role's active worktree.

By coder.
