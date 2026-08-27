# Stray revert WIP found in coder worktree — 2026-08-27

Coder reported (priority-00 note to coordinator): its worktree had stray,
uncommitted WIP that reverted committed feature code. Coder stashed it
rather than committing/forwarding — correct defensive move, not yet
triaged.

Stash: `.worktrees/coder` `stash@{0}` — "coder-worktree-stray-revert-BL1191-BL1184-20260827"
Underlying commit content is `a4aec863c` per coder's note.

## What the stash reverts (verified via `git stash show -p`)
- `swarmforge/scripts/briefing_email_lib.bb`: removes the `shift-velocity`
  diagram heading/note-line branches and collapses
  `diagram-section-from-sources` back to the 2-arity form (drops the
  `shift-velocity-source-fn` arg) — this is BL-1184 (active, in
  `backlog/active/`, assigned to coder, "briefing-shift-velocity") feature
  code.
- `swarmforge/scripts/handoff_inject_lib.bb` and `handoffd.bb`: drops the
  `wake_dedup_lib.bb` load and the wake-dedup logic in
  `notify-delivered-recipient!` — this is BL-1191
  ("handoff-wake-follow-up-dedup"), already in `backlog/done/M8/`.
- Deletes `swarmforge/scripts/test/test_swarm_handoff_sync_deliver.sh`
  wholesale (71 lines).

## Why this matters
BL-1184's own feature code is still intact in the coder's actual working
tree (this was stashed, not applied) — no active-ticket work was lost. But
BL-1191 is a **closed, done** ticket whose shipped code someone/something
tried to strip out, in the coder's own worktree, with no commit authoring
the revert (it never got committed — it was live uncommitted diff when the
coder noticed). This matches the recurring "silent revert with no
authoring commit" family (see memory:
`cursor-agent-commits-then-reverts-uncommitted-work-on-main`,
`detect-content-no-commit-authored`, `phantom-revert-root-cause`) — worth
specifier triage for whether this needs a defect ticket on the *process*
that produced it (e.g., a stale local branch/tool state in the coder
worktree resurrecting a pre-BL-1191 checkout), not on BL-1184 or BL-1191
themselves, which are unaffected.

No action taken beyond stashing + this record — coordinator does not
diagnose domain content; routed to specifier for adjudication.
