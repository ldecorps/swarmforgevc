# A role takes up a parcel on its own line (BL-1871)

## What changed

Before this ticket, a `git_handoff`'s generated body — `merge_and_process
<sender> <commit>` — was always taken up by merging the cited commit into
whatever the receiving role's long-lived branch already held. Every ticket
that ever passed through a role therefore stayed on that role's branch
forever: on 2026-10-01, `swarmforge-coder` was 16,462 commits past
`origin/main`, `swarmforge-cleaner` 16,463, and `swarmforge-QA` 16,590. The
land step then had to replay a landing ticket's own paths back out of that
tangle, and QA's merge-up broadcast re-entangled whatever ticket a role held
next with every commit just landed.

From this ticket on, a task-mode role with its own worktree takes up a
`git_handoff` by **moving its worktree onto the parcel's commit** instead —
`git switch -C <branch> <commit>` — so the role's branch becomes the
parcel's own line. The literal handoff body is unchanged; what changed is
how `ready_for_next_task.bb`'s claim path processes it.

## What you'll see

- **A forwarding `git_handoff` for ticket X citing commit C**: the next
  `ready_for_next.sh` moves the role's worktree onto C. Any `merge_and_process`
  an agent still runs on the payload is then a no-op ("Already up to date") —
  the move already happened.
- **The same parcel served again** after the role has already committed on
  top of C (HEAD is C or a descendant of it): nothing moves. The role keeps
  working its own commit.
- **A coordinator `Work <ticket>` note to the coder**: the coder's worktree
  moves onto the newest commit any role has been handed off for that
  ticket, or a freshly fetched `origin/main` when nothing has been handed
  off yet. Exception: if the coder's current line already carries only that
  ticket's own unlanded commits, it stays there — a re-sent `Work` note
  never strands work the coder has not yet forwarded.
- **A non-forwarding copy (a reverse hop) or QA's merge-up `note`**: nothing
  moves. There is nothing to merge onto a parcel's own line; the role
  completes the note as before.
- **The specifier's and the coordinator's shared master checkout**: never
  moved. The two roles share one physical checkout on `main` with no single
  branch identity for a move to resolve against (the same exemption the
  BL-1195 and BL-1515 claim-path guards already take).
- **An uncommitted tracked change**: blocks the move. The claim path prints
  the changed paths and says the parcel was not taken up; it retries the
  move on every later ask, so the next ask after the role commits or
  restores those paths takes the parcel up normally.
- **A receive run from a checkout that is not the running role's own
  `roles.tsv` worktree** (BL-1904, the 2026-10-02 incident: a coder receive
  run from inside QA's worktree moved `swarmforge-QA` onto `origin/main`
  twice mid-pass, dropping QA's own parcel): the move is refused — nothing
  moves, no parcel-backup ref is written — and the claim path names the
  checkout it refused to move. A foreign checkout that would have stayed
  anyway (nothing to move, or already at the target) stays silently, same
  as any other role.

Example output when a move happens:
```
PARCEL_LINE: moved swarmforge-architect onto a1b2c3d9e8 (left 7f3c0e1a2b under refs/swarmforge/parcel-backup/architect/)
```
When a move is blocked:
```
PARCEL_LINE: uncommitted changes to tracked files (swarmforge/foo.bb); the parcel was not taken up. Commit or restore them and ask again.
PARCEL_LINE: /home/carillon/swarmforgevc/.worktrees/QA is not coder's own worktree (/home/carillon/swarmforgevc/.worktrees/coder); the parcel was not taken up there.
```
When nothing moves (parcel carries no work, or the role is already at or
past the target), the claim path prints nothing extra.

## No commit is ever lost

Before any move, the head being left is kept under
`refs/swarmforge/parcel-backup/<role>/<UTC stamp>` — a ref, not a reflog
entry, so it survives a `git gc`. If a move ever looks wrong, that ref is
where the commit a role held before the move is reachable from.

## Who this applies to

Every role with its own `.worktrees/<role>` checkout, in `task` receive
mode. The live pack's cleaner and hardener windows (`swarmforge/packs/full-forge.conf`)
now declare `task` instead of `batch` specifically so they take up their
own parcels through this same path, one ticket at a time, instead of
merging several tickets onto one shared branch.

## Scope and what is unchanged by this ticket

- The land step's replay, stray handling, and re-point, and QA's merge-up
  `note` send, are unchanged — retiring them is a later slice (tracked
  under the `landing-is-a-merge` epic), after parcels already in flight
  under the old merge-based pattern drain.
- `ready_for_next_batch.bb` (the batch helper itself) is unchanged; no live
  window uses it after this ticket, but another pack's batch-mode windows
  keep their receive mode until next launched for real.
- The lander daemon that actually lands an approved commit on `main` is a
  separate ticket (BL-1872), not this one.

## Where it lives

| Piece | Location |
| --- | --- |
| Pure decisions (`parcel-intent`, `move-decision`, `foreign-checkout?`) plus the impure `take-up!` | `swarmforge/scripts/parcel_line_lib.bb` |
| Wiring into the claim path (passes the role's own `roles.tsv` worktree as `:own-root`) | `swarmforge/scripts/ready_for_next_task.bb` |
| Cleaner/hardener receive-mode lines | `swarmforge/packs/full-forge.conf` |
| Step handler | `specs/pipeline/steps/bl1871ParcelLineTakeUpSteps.js` |
| Foreign-checkout refusal step handler (BL-1904) | `specs/pipeline/steps/bl1904TakeUpMovesOnlyOwnWorktreeSteps.js` |

Acceptance:
`specs/features/BL-1871-a-role-takes-up-a-ticket-on-its-own-line.feature`,
`specs/features/BL-1904-a-take-up-moves-only-the-roles-own-worktree.feature`

## See Also

- [Branch-identity guard — BRANCH_DRIFT_DETECTED / BRANCH_DRIFT_REPAIRED](BL-1515-branch-identity-guard.md) — the master-checkout exemption this ticket's move also takes.
- [Worktree drift guard — WORKTREE_DRIFT_DETECTED](BL-1195-worktree-drift-guard.md) — the companion guard that still runs in the claim path alongside this move.
- `swarmforge/handoff-protocol.md`'s `git_handoff` section — the wire-format description of `merge_and_process`, updated by this ticket to describe the move instead of a merge.
