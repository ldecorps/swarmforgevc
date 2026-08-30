# BL-1297 spec correction — 2026-08-30 (specifier)

## What reached me
Hardener note, priority `00`: "BL-1297 send blocked: dup-chain+self-entangled
tip; see evidence", with a full write-up committed on the hardener branch at
`backlog/evidence/BL-1297-hardener-send-blocked-20260830.md` (`476f49fc34`).
Hardening itself was complete and green (`2d49d9d6e5`); only the forward was
refused. The hardener declined both remedies the tool named (`redo_from.sh`
salvage, a tip-pure rebuild of a multi-hundred-commit branch mid drift-storm)
as outside its authority and routed the gap here. That was the right call.

## Refusal 1 — duplicate-chain guard. Real, transient, already clear.
`duplicate_chain_guard_lib.bb` refused the send naming the specifier's copy
`00_20260830T175000Z_001295_from_architect_to_specifier`. That file is a
`back-all` reverse-hop copy the architect's forward synthesized.

The hardener read it as "a COMPLETED parcel still blocks", which the guard's
own code contradicts — `live-parcel-for-ticket` walks `:new` and
`:in_process` only. Reconstructed: the copy was dequeued at 17:50:03 and
completed at 17:55:57, so it was live in the specifier's `in_process` during
the send attempt, and had moved to `completed/` by the time the write-up was
made at 18:01. The guard behaved exactly as designed.

Verified clear now, by calling the guard directly rather than inferring:

    duplicate-chain-guard-lib/blocking-parcel <root>
      "BL-1297-a-merge-commits-own-paths-are-not-empty" "hardender"  ->  nil

from both the master root and the hardener worktree. Nothing to fix in this
ticket. The underlying interaction — a reverse hop plants a live `git_handoff`
for the same ticket in every earlier mailbox, each of which blocks the next
role's forward until drained — is real and is filed as BL-1302.

## Refusal 2 — the spec defect. Mine.
The gate refused naming 11 paths across BL-1295, BL-1272, BL-1298, BL-676,
BL-677, BL-816, BL-875 and GH-24. The hardener wrote none of them: they
arrived in the receive-merge every stage is required to make, plus the routine
main syncs the constitution requires.

The ticket asked for one answer — a commit's change against its first parent —
for three callers. Measured on the hardener's own receive-merge `d4e74ea3d1`:

    git diff --name-only d4e74ea3d1^1 d4e74ea3d1   ->  25 paths, 8 tickets
    git diff-tree --cc --name-only -r d4e74ea3d1   ->   1 path
    the one authored path: swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb
    control, single-parent 2d49d9d6e5              ->  1 and 1, identical

So the callers are asking two different questions. The land-step replay wants
DELIVERED (what content this commit puts on the branch — the first-parent
delta). The send-time scope gate and the unregistered-test gate judge the
parcel's AUTHOR, and want AUTHORED (what differs from every parent — empty for
a clean receive-merge, because that content was authored upstream and is
already attributed to the commits that made it).

Reading DELIVERED as AUTHORED refuses every forward in the pipeline the moment
a branch has synced main, which is always. The single authored path here is
BL-1297's own test runner, so under the corrected semantics this parcel passes
on its merits.

## Disposition
Spec amended, not bounced on workmanship: the coder implemented the contract
faithfully and the contract was wrong. Invariant 2's "all three callers answer
the same question identically" is replaced; scenario 02 re-scoped to a merge's
own resolution; scenarios 05 (clean receive-merge not refused) and 06 (the two
answers agree on a single-parent commit) added. Handlers for 05/06 must land in
the same parcel as the rename (BL-233).

Not recorded against the coder or the hardener: no bounce is charged for a
defect in the spec they were given.
