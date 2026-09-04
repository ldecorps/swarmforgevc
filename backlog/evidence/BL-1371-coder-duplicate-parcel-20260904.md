# BL-1371 — coder: the routed parcel was a duplicate of work already on `main`

2026-09-04. Not forwarded. This records what happened and why nothing went to
the cleaner.

## What the parcel asked for, and what was already true

A priority-00 `git_handoff` from the coordinator (payload
`merge_and_process coordinator 7b06ee8005`) routed BL-1371 to the coder. The
ticket was in `backlog/paused/` in this worktree, not `backlog/active/`.

BL-1371 had ALREADY been implemented and landed on `main` through the expedite
lane, exactly as its own re-grade note predicted it would have to be:

- `ed9efe8e18` Merge expedite/BL-1371: a step handler registers by discovery,
  not by a shared array
- `876bd76f08` Land BL-1371; un-park BL-1367/BL-1374/BL-1376/BL-1377/BL-1378
- `eca7fb5392` Close BL-1371: status done after expedite land on main
- the ticket YAML is at `backlog/done/BL-1371-...yaml` on `main`

Checked with `git branch --contains` on each of those commits (not `git log
--all`, which would have said nothing about `main`): all three are on `main`
and `origin/main`.

`main:specs/pipeline/steps/index.js` is already the discovery registry -
`HANDLER_SUFFIX = 'Steps.js'`, a non-recursive top-level scan, and a
`loadHandler()` that names the file it could not require. `main` also already
carries `specs/pipeline/steps/bl1371StepDiscoverySteps.js`.

## What this worktree did before finding that out

This branch was behind `main`, and the ticket copy it carried was the paused
one. Working from it, the coder implemented the same design independently
(`68f15b9c34`) and verified it: identical handler-identity sets before and
after (13892 each, 0 missing, 0 added), zero unscoped patterns shared between
two files, all 18164 concrete feature steps resolving to the same owning
handler under both load orders, three coder-authored property tests shown
non-vacuous against three deliberate breaks, and the BL-1303/BL-1277/BL-968
guards plus every array-shaped fixture moved with the change.

That commit is REVERTED (`b3541b01ae`). It is duplicate work, and carrying it
forward would have handed the cleaner a large parcel conflicting with a
landed, closed ticket. The revert leaves this branch mergeable with `main`'s
version rather than racing it.

## The two process facts worth keeping

1. **The parcel should not have been routed.** BL-1371 is `done` on `main` and
   its YAML has left `active/`. The route was reported back to the coordinator
   as a priority-00 note.
2. **A worktree's own backlog copy is not evidence of a ticket's state.** This
   worktree's `backlog/paused/BL-1371-...yaml` was stale by a full expedite
   run; only `main` (or `origin/main`, whichever is ahead) could say.

By coder.
