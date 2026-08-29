# Merge-deletion guard on `git merge --no-ff` (BL-1242)

*How-to. Task-oriented: understand why a merge commit was refused for
silently dropping branch work, and how to clear it.*

Commit-msg-time guard, sibling to the ticket-YAML-only
[`check_ticket_deletion.sh`](../../swarmforge/scripts/check_ticket_deletion.sh)
(BL-901): `swarmforge/scripts/check_merge_deletion.sh`, wired into
`swarmforge/git-hooks/commit-msg` alongside it. Both guards run on every
commit-msg invocation — neither's exit status can mask the other's (see
"Both guards always run" below).

## What it catches

A `git merge --no-ff` that resolves as "theirs deleted, ours unchanged"
for a path the receiving branch (`HEAD`, before the merge) itself
introduced or last touched, and the commit message names neither that
path nor its owning ticket. This is exactly the shape of the 2026-08-28
incident: QA reverted several bounced tickets on its own branch per
BL-490/BL-495, then approved and broadcast a merge-up for an unrelated
ticket. Every worktree role told to `git merge <qa-commit>` per
Article 2.5 would have silently lost six files across four tickets — no
conflict marker, no failing test, a clean-looking merge. One role caught
it only by hand-reading the diff (`backlog/evidence/BL-1242-merge-up-deletes-rebuilt-work-20260828.md`).

The guard only fires when a merge is actually in progress (`MERGE_HEAD`
exists) — an ordinary commit is untouched.

## What it does NOT catch, on purpose

- A deletion the commit message accounts for (see "Clearing it" below) —
  a deliberate revert-propagation merge (e.g. the cleaner's legitimate
  2026-08-28 re-merge) stays legal.
- A path already covered by `check_ticket_deletion.sh`
  (`backlog/{paused,active,done}/**/*.yaml|yml`) — reported once, by that
  guard, never doubled up.
- A non-merge commit, or a merge that removes nothing the receiving
  branch introduced.

## If you hit this refusal

```text
Error: merge deletes 'specs/pipeline/steps/bl1192TaskScopeGateSteps.js' (BL-1192, introduced at 101e9b1 on this branch), not named in the commit message.
Error: merge deletes 'extension/src/tools/recovery-filter-check.ts' (BL-1211, introduced at f30f9ac on this branch), not named in the commit message.
Commit rejected: name the affected ticket id(s) in the commit message to confirm a deliberate removal, or re-merge the branch commit(s) that introduced these paths first.
```

Each line names the deleted path, the ticket it was attributed to
(derived from the subject of the most recent commit on your own branch
history that touched the path — the repo's `TICKET: description` commit
convention), and the commit on your branch that introduced it.

1. **If the removal is genuinely QA's** (a legitimate bounce-revert
   propagating through the merge-up): name every listed ticket id
   anywhere in the merge commit message and re-commit. This is the
   identical escape `check_ticket_deletion.sh` (BL-901) already uses.
2. **Otherwise** the merge is about to drop rebuilt work: re-merge the
   branch commit(s) named in the refusal (the "introduced at" hash) into
   your branch first, then retry the merge-up.

A path the guard cannot attribute to any ticket (no `TICKET-id` in its
introducing commit's subject) is reported as `(unattributed)` and still
refuses — an attribution gap never silently passes.

## Both guards always run (2026-08-28 hardening pass)

The commit-msg hook runs `check_ticket_deletion.sh` and
`check_merge_deletion.sh` under `set -uo pipefail` (no `-e` across the
two calls) and combines their exit statuses — each script's own body
still enforces its own `set -euo pipefail`. Earlier, a failing
`check_ticket_deletion.sh` call aborted the hook before
`check_merge_deletion.sh` ever ran, so a merge violating both guards at
once only ever reported the first; a role naming the reported ticket and
resubmitting was then blindsided by the second violation on the next
attempt. A merge that violates both now reports both in one refusal.

## Where it lives

| Piece | Location |
| --- | --- |
| Guard script | `swarmforge/scripts/check_merge_deletion.sh` |
| Wired into | `swarmforge/git-hooks/commit-msg` (alongside `check_ticket_deletion.sh`) |
| Acceptance steps | `specs/pipeline/steps/bl1242MergeBranchWorkDeletionSteps.js` |
| Acceptance CLI | `specs/pipeline/steps/lib/bl1242MergeBranchWorkDeletionCli.sh` |

## Related

- BL-901 (`check_ticket_deletion.sh`) — the sibling guard this one is
  modelled on; covers backlog ticket YAML deletions only, never doubled
  up with this guard.
- BL-490/BL-495 (bounce-revert-out-of-branch) — the legitimate case this
  guard's message-naming escape must keep working.
- BL-1213 (parcel-rollback guard on `git_handoff` sends) — a related but
  different chokepoint: send-time, ticket-scoped, not merge-shaped.
- BL-1205 (tree-collapse guard on `git_handoff` sends) — mass-deletion,
  not per-path attribution.

## Verify

```bash
bash swarmforge/scripts/test/test_merge_deletion_guard.sh
bash swarmforge/scripts/test/test_ticket_deletion_guard.sh
node specs/pipeline/cli.js specs/features/BL-1242-merge-never-silently-drops-branch-work.feature
```

Acceptance: `specs/features/BL-1242-merge-never-silently-drops-branch-work.feature`
