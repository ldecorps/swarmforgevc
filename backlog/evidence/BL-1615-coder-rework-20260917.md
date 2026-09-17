# BL-1615 coder rework: architect bounce D1

Architect bounce (`backlog/evidence/BL-1615-bounce-20260917.md`, commit
baf4eea434) found D1: `enforce-branch-claim-guard!`/`requeue-and-refuse!`
still requeued a refused claim to the single `stage-queue-dir :new`
binding, even for a candidate BL-1615's own union claim
(`claim-stage-handoff-files`) pulled from the seat's OWN new/ - a refusal
on a seat-addressed candidate silently relocated it into the shared stage
queue, violating the ticket's own FIRM clause and declared invariant 2.

## Fix

`ready_for_next_task.bb` gains `origin-new-dir-for` (beside
`requeue-and-refuse!`): the requeue target is now resolved from the
handoff file's own `recipient:` header - the seat's own mailbox when
addressed to the seat itself exactly (`current-role`, not merely the
stage), the shared stage queue otherwise. This mirrors
`stage-handoff-files`' own recipient match exactly, so the requeue target
always agrees with what `claim-stage-handoff-files` would offer the file
from again. Both call sites (the in-process resume path and the
fresh-dequeue path) now pass `(origin-new-dir-for handoff-file)` instead
of the removed single `new-dir` binding.

## New coverage

Scenario 04 added to the feature (architect's own remediation direction):
a non-forwarding copy addressed to `coder@2`, its worktree checked out on
a DIFFERENT ticket's branch with uncommitted changes (the guard's
`:refuse-requeue` path) - the claim is refused (`BRANCH_CLAIM_MISMATCH`)
and the file lands back in `coder@2`'s own `new/`, never the stage queue.

This required giving `coder@2` a REAL linked `git worktree` in the fixture
(`git worktree add`) rather than a plain directory - the branch-claim
guard reads `git rev-parse --show-toplevel` from cwd, which a plain
subdirectory resolves to the SHARED root checkout, not an independent
branch/dirty state. Every other seat in the fixture stays a plain
directory (unaffected: none of the other scenarios needs an independent
branch state, matching `bl983StageQueueSteps.js`'s own convention).

## Verification

- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1615-*.feature`:
  8 of 8 scenarios green (the original 7 plus the new scenario 04).
- Sibling features re-verified green, unchanged in scope: BL-983 (5/5),
  BL-1004 (5/5).
- `check_bb_scripts_load.sh --all`: 311 scripts, all clean.
- D2 (secondary, non-blocking per the bounce): no bb unit runner was
  extended - unchanged rationale from the original evidence
  (`BL-1615-coder-20260917.md`): `origin-new-dir-for`, like
  `claim-queue-dirs`/`claim-stage-handoff-files` before it, resolves
  through `current-role` (a process-env read with no in-process seam), so
  its coverage lives in the acceptance feature's real-subprocess
  scenarios, same posture as every other roles.tsv-dependent
  `handoff_lib.bb`/`ready_for_next_task.bb` function in this codebase.
