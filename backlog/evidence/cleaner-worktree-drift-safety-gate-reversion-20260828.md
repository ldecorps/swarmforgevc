# Cleaner worktree drift: two safety gates silently reverted (2026-08-28)

## Context

On session start, `ready_for_next.sh` refused with
`WORKTREE_DRIFT_DETECTED` (the `worktree_drift_lib.bb` guard) for two
tracked paths differing from this worktree's own HEAD
(`f1a10750a`, "evidence(BL-1211): recovery-filter CLI verified") with no
in-progress task to explain it — the same "silent revert, no authoring
commit" shape as BL-1195.

Note: the first drift report (before I unset an ambient `GIT_DIR`/
`GIT_WORK_TREE` env leak — see the `ambient-git-dir-worktree-env-leak`
incident class) pointed git at the shared `main` checkout and reported
`docs/briefings/.sent.json` drift there instead; that is unrelated noise
from the mis-pointed git, not from this worktree.

## What the drift removed (working tree vs this worktree's own HEAD)

Both landed, ancestor-of-HEAD safety commits, content reverted with no
commit removing them:

- `swarmforge/scripts/check_property_suite_drift.sh` — HEAD has
  `55e138201` (BL-1196 amendment: strips `GIT_DIR`/`GIT_WORK_TREE`/
  `GIT_INDEX_FILE` before the property suite launches, closing the exact
  ambient-env vector noted above). Working tree had that whole guarded
  block (the comment + `unset -v GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE`)
  removed.
- `swarmforge/scripts/swarm_handoff.bb` — HEAD has `39d237159`/`1a016cdb0`
  (BL-1192: pre-handoff task-scope gate, refuses an entangled
  `git_handoff` whose cited commit's own commits since the task's last
  handoff carry a path belonging to a different ticket). Working tree had
  the `task_scope_gate_lib.bb` load, the gate invocation, and its refusal
  wiring all removed — `swarm_handoff.sh` would have silently stopped
  enforcing BL-1192 for every hop, not just the QA edge BL-531 covers.

## What I did

Per the drift guard's own prescribed remedy and the constitution
(preserve, never discard or forward; never delete/sweep content I didn't
create): stashed exactly the two drifted paths, tagged, and left `HEAD`'s
correct (safety-gate-intact) content in place in the working tree.

```
git stash push -u -m "worktree-drift-20260828T060145Z" -- \
  swarmforge/scripts/check_property_suite_drift.sh \
  swarmforge/scripts/swarm_handoff.bb
```

Stash SHA: `ba5425e373d25480cf37131bd9cfccd9dc319cdf`
(`stash@{0}` at time of writing, tag `worktree-drift-20260828T060145Z` —
re-find by tag via `git stash list --format='%H %gs'`, never by index).

Worktree is now clean at HEAD `f1a10750a` with both safety gates intact.
`ready_for_next.sh` returns `NO_TASK` — there is no in-flight ticket this
drift belongs to, so it is not a bounce and not a parcel.

## Ask

This is a `spec-gap`/anomaly note, not a ticket defect I can own or fix —
I did not author the reversion and there is no active parcel to attach it
to. Surfacing to specifier + coordinator: is this drift-guard hardening
(BL-1195/BL-1196/BL-1192 lineage) itself under active rework on some other
branch/session that would explain two safety gates losing their content
in this worktree with no commit, or is this a new incident that needs a
ticket? The stashed content is preserved, not discarded, pending
disposition.
