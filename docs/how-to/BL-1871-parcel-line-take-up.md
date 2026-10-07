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
When that line carried the ticket's own unlanded commits past the old merge
base (BL-2044), and the move starts the ticket fresh — a coordinator `Work`
note, or a forwarded `git_handoff` whose commit is already on `origin/main`
(a BL-1887 route) — the move re-applies them onto the new target before
reporting, and says so:
```
PARCEL_LINE: moved swarmforge-coder onto a1b2c3d9e8 (left 7f3c0e1a2b under refs/swarmforge/parcel-backup/coder/); re-applied 2 commit(s)
```
When a move is blocked:
```
PARCEL_LINE: uncommitted changes to tracked files (swarmforge/foo.bb); the parcel was not taken up. Commit or restore them and ask again.
PARCEL_LINE: /home/carillon/swarmforgevc/.worktrees/QA is not coder's own worktree (/home/carillon/swarmforgevc/.worktrees/coder); the parcel was not taken up there.
```
When the re-apply itself conflicts (BL-2044), the cherry-pick is aborted and
the worktree is switched back to the old head unchanged — nothing moves:
```
PARCEL_LINE: re-applying 9f1c2b3d4e onto a1b2c3d9e8 conflicted; the parcel was not taken up.
```
When nothing moves (parcel carries no work, or the role is already at or
past the target), the claim path prints nothing extra.

## What the ACTION block says, under each PARCEL_LINE outcome (BL-1924)

`print-task` prints the PARCEL_LINE outcome above, then an ACTION block that
follows it — it never tells a task-mode seat to run `merge_and_process` as a
shell command, and never contradicts a refusal by also saying "do not ask
again". The task helper (`ready_for_next_task.bb`) passes `{:task-mode? true
:take-up <take-up! outcome>}` plus the served ticket file and next stage to
`print-task`; a batch seat's one-arity call never passes these, so it always
gets the pre-BL-1924 text below.

- **A forwarding `git_handoff`, take-up `:moved` or `:stay` (task mode)**:
  step 1 says ready_for_next.sh already put the worktree on the parcel's
  line, that there is nothing to merge, and that `merge_and_process` is not
  a shell command. Step 2 names the ticket file to `read_file` (when one was
  found under `backlog/active/`) and says to implement it. Step 3 says to
  commit only the changed paths, `git add <path>` for each, never
  `git add .`, with a message ending `By <role>.`. Step 4 names the next
  stage and prints the one shell command that writes `tmp/handoff.txt`
  (`type: git_handoff`, `to: <next-stage>`, `priority: 00` — `50` only when
  the sending role is `coder`, `task: <ticket id>`, `commit:` read live from
  `git rev-parse HEAD`), then says to run `swarm_handoff.sh tmp/handoff.txt`
  and that a printed `AUDIT_REQUIRED` means re-running that same command.
  Step 5 says to run `done_with_current.sh`.
- **The same, batch mode (one-arity `print-task` call, e.g.
  `ready_for_next_batch.bb`)**: step 1 says "Execute the PAYLOAD
  (merge_and_process …) in this worktree." — unchanged, since a batch seat
  really does merge several tickets onto one shared branch. Step 3 is the
  generic "Commit, git_handoff to the next role, then done_with_current /
  ready_for_next." — no per-ticket file name or forward command.
- **Take-up `:refused` (either mode)**: the ACTION block is exactly two
  lines — "This parcel is in_process but was NOT taken up - read the
  PARCEL_LINE line above." and "Do not start its work on this tree. Fix what
  PARCEL_LINE names, then run ready_for_next.sh again." No numbered steps,
  no work steps, no `done_with_current.sh` step — a refusal is a dead end
  until the blocking cause (an uncommitted path, a foreign checkout) is
  cleared.
- **A non-forwarding (reverse-copy) `git_handoff`, task mode, taken up**:
  since BL-1871 a reverse copy carries no work and is never taken up, so
  `print-task` prints exactly two steps: "This is a reverse copy
  (non-forwarding: true). It carries no work for you: do not read or
  implement its ticket, and do not merge, commit or forward anything for
  it. Ignore the PAYLOAD's merge_and_process and replay lines." and "Run
  now: swarmforge/scripts/done_with_current.sh". No ticket file, no
  implement step, no commit step, no forward step. A batch seat still
  merges a reverse copy's payload, so the batch one-arity call prints the
  ordinary merge_and_process text instead.
- **QA's merge-up `note`, task mode**: step 1 says the note carries no work
  in task mode because ready_for_next.sh already put the worktree on each
  parcel's own line, and says not to merge, fetch, or inspect any branch for
  it. Step 2 says to run `done_with_current.sh`.
- **Any other `note` (either mode)**: step 1 says to read the PAYLOAD and
  act on it per the role's own prompt; when a ticket file was resolved for
  the note, it names that file and says to read it with `read_file`. Steps 2
  and 3 say to run `done_with_current.sh` when there is nothing further to
  do, then run `ready_for_next.sh` for the next parcel.

## No commit is ever lost

Before any move, the head being left is kept under
`refs/swarmforge/parcel-backup/<role>/<UTC stamp>` — a ref, not a reflog
entry, so it survives a `git gc`. If a move ever looks wrong, that ref is
where the commit a role held before the move is reachable from.

That backup ref is still written on every move, but since BL-2044 it is no
longer the only place the ticket's own commits land. A line a seat holds
can be force-moved onto the start target — a `:start` intent, origin/main's
tip — when it carries an unlanded *other* ticket's work and so fails
`own-line?`'s check; before BL-2044 the current ticket's own unlanded
commits on that same line were stranded under the backup ref with nothing
re-applying them, silently losing a seat's finished work at the next serve.

The re-apply runs for a **start move** — not for the `:start`/`:take-up`
intent keyword itself, but for whichever moves resolve through
`start-target` (BL-2044 D1): a coordinator `Work` note, forcing the line
off its old base, **and** a forwarded `git_handoff` whose cited commit is
already on `origin/main` (a BL-1887 route git_handoff, which starts its
ticket fresh exactly as a Work note does). A plain `:take-up` at a parcel
commit that is *not* on `origin/main` never re-applies: its target already
**is** the parcel, so cherry-picking the role's own commit onto it a second
time is an empty cherry-pick — which `git cherry-pick` reports as a
conflict, not a no-op — and would wrongly refuse the commonest bounce shape
(a role receiving its own bounced commit back). For a start move,
`take-up!` reads the commits past the old merge base whose subject names
**the ticket itself**
(`reapply-worthy?` — stricter than `own-line?`'s own `line-commit-ok?`,
which also calls a commit "the ticket's own" when its subject names only
*done* tickets; a done ticket's original commit is excluded here because a
target may already hold its landed replay, or the commit may belong to an
unrelated ticket's line it would be wrong to inject it into), excludes
merges, and excludes any commit already an ancestor of the new target
(the ticket's newest handed-off commit can already carry the same work).
What survives is cherry-picked, oldest first, onto the new target after
the switch, before reporting the move. If a cherry-pick conflicts, the
take-up aborts it and switches back to the old head unchanged (no
cherry-pick or merge left in progress), refuses with the conflicting
commit named, and the parcel is not taken up — the backup ref from this
same move is still there either way.

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
