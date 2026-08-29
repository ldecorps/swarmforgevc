# Worktree drift guard — WORKTREE_DRIFT_DETECTED (BL-1195)

## What triggered this

2026-08-27: the coder found `handoff_inject_lib.bb`, `handoffd.bb`, and
`briefing_email_lib.bb` reverted to pre-BL-1191/pre-BL-1184 content in its
own worktree — uncommitted, with no commit anywhere (local or on any
branch) that authored the change. The coder caught it only because it
happened to notice unexpected diff content before starting work; nothing
structural would have caught it otherwise, and the parcel could have been
forwarded with a shipped fix silently missing again. **Root cause found and
fixed by [BL-1233](BL-1233-launcher-guard-survives-ambient-git-env.md):**
BL-373's launcher-cp guard covers this exact file set but was fully
defeated by an ambient `GIT_DIR`/`GIT_WORK_TREE` in the launcher's
environment, which made its tracked-path query answer for the wrong repo
and silently copy over tracked files instead of leaving them to git.

## What the guard does

`ready_for_next.bb` runs `enforce-worktree-drift-guard!` before dispatch
decides task vs. batch, on every turn. It compares the current worktree's
tracked-file content against that worktree's own `HEAD` (`git diff
--name-only HEAD`) and asks one question, no finer-grained than this: does
the role already hold (or is about to resume) an in-progress task?

- **No in-progress task, but tracked files differ from HEAD** — nothing
  legitimately explains the diff. The guard refuses:
  ```
  WORKTREE_DRIFT_DETECTED: tracked content in this worktree differs from
  its own HEAD with no in-progress task to explain it - this may be the
  same "silent revert, no authoring commit" shape as BL-1195's own
  incident. Preserve it, never discard or forward it:
    git stash push -u -m "worktree-drift-$(date -u +%Y%m%dT%H%M%SZ)"
  Drifted path(s):
    - swarmforge/scripts/handoffd.bb
  ```
- **An in-progress task exists** — every currently-modified path is
  presumed that task's own WIP; no false flag (this is what stops the guard
  from blocking ordinary in-flight work).
- **A clean worktree** — passes silently either way.

The guard never stashes or discards on its own: it only reports and names
the required next step. Discarding drifted content is exactly the
mechanism this guard exists to catch, so it must never itself take that
action as a side effect of merely checking.

## If you hit this

1. **Do not discard.** `git stash push -u -m "worktree-drift-<timestamp>"`
   as instructed — the stash is the primary forensic evidence for whoever
   investigates the mechanism next.
2. Report it (a `note`, priority `00`, to specifier/coordinator) rather than
   working around it — this is the same shape of incident BL-1195 itself
   was minted from.

## Master-resident roles are exempt

The coordinator and specifier work directly in the **shared master
checkout**, not a dedicated `.worktrees/<role>`. That checkout is by design
a genuinely concurrent, multi-writer surface — coordinator bookkeeping, the
BL-topic-record writer, QA's fast-forward, the specifier, and
`operator_file_question.bb` all commit into one git index with no
isolation, and several of those writers (spec/prompt drafting, backlog
bookkeeping) have no handoff parcel to point at even in principle. A
per-role "does an in-process parcel explain this diff?" check cannot tell a
legitimate concurrent writer's own WIP apart from real unexplained drift on
that surface — there is no parcel-shaped signal to widen toward. So the
guard skips entirely whenever the invoking role's own `worktree-name` is
`"master"` (same posture already taken by `check_branch_namespace.bb`,
`post_qa_branch_sweep_lib.bb`, and `pre_qa_gate_gather_lib.bb`). Every
other pipeline role's own dedicated worktree — exclusively written by that
one role — keeps the guard's full original detection value.

## Where it lives

| Piece | Location |
| --- | --- |
| Pure decision logic | `swarmforge/scripts/worktree_drift_lib.bb` — `unexplained-drift`, `drift-detected?`, `drift-report` |
| Wiring (real git, master carve-out) | `swarmforge/scripts/ready_for_next.bb` — `enforce-worktree-drift-guard!` |

Acceptance:
`specs/features/BL-1195-worktree-tracked-content-drift-is-detected-not-silently-carried.feature`
