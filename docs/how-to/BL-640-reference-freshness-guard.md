# BL-640: The Reference-Freshness Pre-Turn Guard

**`ready_for_next.sh` now refuses to start a turn if your worktree's copy of
any `swarmforge/constitution/articles/reference/` file has drifted from
`main`.**

## The Problem This Fixes

Top-level `swarmforge/constitution/articles/*.prompt` files are inlined into
every agent's composed boot prompt, so an amendment there reaches a role the
next time it respawns. The `articles/reference/` subdirectory — long-form,
incident-backed elaborations, read on demand rather than inlined at boot —
has no equivalent delivery path: it is read straight from whatever that
role's own worktree happens to have checked out, and nothing tells a role to
merge `main` when one of those files changes.

On 2026-07-25 an Article 5.1 amendment corrected a bounce-revert rule in
both forms — the inlined summary in `articles/workflow.prompt` and its
elaboration in `articles/reference/workflow-detailed.prompt`. Measured right
after landing: three role worktrees (`architect`, `cleaner`, `coder`) still
carried the **old** elaboration. The result was worse than plain staleness —
a role's inlined prompt said one thing ("verify the CONTENT is gone, never
the ancestry") while the elaboration it was told to read for the worked
example said the opposite (a check that could never pass), and the
contradiction had no signal attached to it at all.

## What Happens Now

`ready_for_next.bb` runs a freshness check before any dispatch logic (task
dequeue, batch dequeue, resume, or `NO_TASK`) — for every role, every pack,
every turn:

1. It hashes every file currently under the worktree's own
   `swarmforge/constitution/articles/reference/`.
2. It hashes the same directory's content at whichever of `main` /
   `origin/main` is currently ahead (this repo's QA lands its approved
   commit by pushing straight to `origin`, so `origin/main` can be ahead of
   the shared local `main` in the window before the master checkout next
   merges it in — see the workflow rule "A Prior QA Bounce Is Not In Your
   Worktree", BL-340).
3. Any path that differs, or is missing from the worktree, is stale.

**Fresh** (nothing stale, or the check itself can't run — no `main` ref, no
`reference/` directory, git unavailable): passes through silently. No cost
in the normal case.

**Stale**: the turn is refused (exit 2) with a message naming every drifted
file:

```
STALE_REFERENCE_ELABORATION: this worktree has not merged an amendment to the
swarmforge/constitution/articles/reference file(s) - an inlined constitution
rule and its on-demand elaboration could contradict each other until `main`
is merged:
  - swarmforge/constitution/articles/reference/workflow-detailed.prompt
Merge main, then run ready_for_next.sh again.
```

## What To Do When You See It

Merge `main` (or `origin/main`, whichever the message's context implies is
ahead) into your worktree, then run `ready_for_next.sh` again. The guard
does not attempt the merge for you and does not require one to succeed
cleanly on the first try — if your worktree also carries untracked,
hot-synced script copies that block a fast-forward, that is a separate,
already-tracked gap (BL-924, not yet built) and outside this guard's scope;
resolve the merge by hand and re-run.

## What This Deliberately Does Not Do

- It never merges `main` for you — refuse-and-report only. A mechanism that
  auto-merged would depend on that merge succeeding, which is exactly the
  dependency BL-924's untracked-copy defect can break; keeping the two
  independent was a deliberate specifier decision.
- It never inlines `reference/` content into the boot prompt. The whole
  directory (94,739 B measured) would more than double the composed prompt
  (74,564 B) on the stable cache prefix BL-519 created deliberately, to
  carry elaboration that's read rarely and on demand.
- It does not replace the existing "Amending An In-Flight Ticket's Spec"
  `note`-based delivery rule for **ticket** spec amendments
  (`backlog/*.yaml`, `specs/features/*.feature`) — that mechanism is
  unchanged; this guard covers the constitution's own `reference/` files
  only.

## See Also

- `swarmforge/scripts/reference_freshness_lib.bb` — the pure
  `stale-paths`/`fresh?`/`staleness-report` decision logic.
- `swarmforge/scripts/ready_for_next.bb` — the IO wiring
  (`enforce-reference-freshness-guard!`, `freshest-main-ref`).
- The "Reference-freshness pre-turn guard (BL-640)" section in
  `swarmforge/handoff-protocol.md`.
- **BL-924** — the untracked hot-synced-copy defect that can block the
  merge this guard asks for; deliberately a separate ticket.
