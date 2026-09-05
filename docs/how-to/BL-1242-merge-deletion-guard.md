# Merge-deletion guard on `git merge --no-ff` (BL-1242, both directions since BL-1341, moves and attribution fixed BL-1403)

*How-to. Task-oriented: understand why a merge commit was refused for
silently dropping branch work, and how to clear it.*

Commit-msg-time guard, sibling to the ticket-YAML-only
[`check_ticket_deletion.sh`](../../swarmforge/scripts/check_ticket_deletion.sh)
(BL-901): `swarmforge/scripts/check_merge_deletion.sh`, wired into
`swarmforge/git-hooks/commit-msg` alongside it. Both guards run on every
commit-msg invocation — neither's exit status can mask the other's (see
"Both guards always run" below).

## What it catches

A `git merge --no-ff` that resolves as "one side deleted, the other
unchanged" for a path either parent had, and the commit message names
neither that path nor its owning ticket. Two directions, both covered
since BL-1341:

- **This branch** (`HEAD`, before the merge): a path `HEAD` introduced
  or last touched is missing from the result. This is the original
  2026-08-28 incident shape: QA reverted several bounced tickets on its
  own branch per BL-490/BL-495, then approved and broadcast a merge-up
  for an unrelated ticket. Every worktree role told to `git merge
  <qa-commit>` per Article 2.5 would have silently lost six files across
  four tickets — no conflict marker, no failing test, a clean-looking
  merge. One role caught it only by hand-reading the diff
  (`backlog/evidence/BL-1242-merge-up-deletes-rebuilt-work-20260828.md`).
- **The incoming branch** (`MERGE_HEAD`): a path that exists ONLY on the
  branch being merged IN is missing from the result. `HEAD` never had
  it, so the original HEAD-only diff was empty and the merge sailed
  through — the guard's own blind spot until BL-1341. On `main` the
  incoming branch is `origin/main`, the branch QA pushes approved work
  onto, so this was the direction that lost reviewed work: merge
  `b71c941a19` (2026-09-02) dropped 9 of BL-1330's landed paths this way
  — zero deletions against `HEAD`, nine against `MERGE_HEAD`.

A path dropped from BOTH sides is one finding, naming both sides, never
two separate refusals (see "Both-sides drops" below).

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
- **A moved path (BL-1403).** `collect_deletions` now runs with rename
  detection on (`git diff --name-status -M`, git's default similarity
  threshold) and skips any `R*` status — a `git mv` (a root-drain
  archiving a raw intake into `backlog/archive/`, plus an appended footer,
  is the recurring real-world case) reports as a rename, never a bare `D`,
  because its content survives at the new path. The guard exists so a
  merge never silently drops work; a move drops nothing. Only a
  status-only rewrite that keeps just the filename (well below the
  similarity threshold) still reports as delete+add, correctly.

## A refusal is exemptable whenever EITHER side names a ticket (BL-1403)

Before this fix, attribution fell back from `HEAD` to `MERGE_HEAD` only
when HEAD's introducing commit had **no subject at all** — but a raw
intake's own introducing commit ("Operator: file a question as raw
intake for the swarm") has a perfectly normal subject that, by design,
names no ticket yet (the ticket doesn't exist at intake time). So the id
came back empty, the exemption could never match anything, and the
refusal always printed `(unattributed)` — even though the commit that
later archived the same path (a root-drain "Mint BL-nnnn: ... archive its
intake") *did* name the right ticket, on the other side of the merge.

Every worktree hit this on its next merge-up after every root drain
(recorded in `check_merge_deletion.sh`'s BL-1403 header): there was no
commit message that could ever satisfy the guard, so the only way through
was cherry-picking the archiving commit before merging — a recipe each
role had to rediscover by hand. `attribution_for_path` now falls back to
`MERGE_HEAD` whenever HEAD's subject yields **no ticket id**, not only
when it is empty, and reports the commit from whichever side the id
actually came from — never a commit/id pair from two different sides.

## If you hit this refusal

```text
Error: merge deletes 'specs/pipeline/steps/bl1192TaskScopeGateSteps.js' (BL-1192, introduced at 101e9b1 on this branch), not named in the commit message.
Error: merge deletes 'extension/src/tools/recovery-filter-check.ts' (BL-1211, introduced at f30f9ac on this branch), not named in the commit message.
Commit rejected: name the affected ticket id(s) in the commit message to confirm a deliberate removal, or re-merge the branch commit(s) that introduced these paths first.
```

Each line names the deleted path, the ticket it was attributed to
(derived from the subject of the most recent commit — on whichever side
actually carries the path's history, `HEAD` first, `MERGE_HEAD` as
fallback — that touched the path, the repo's `TICKET: description`
commit convention), the commit that introduced it, and which side it
was dropped from: `on this branch`, `on the incoming branch`, or `on
this branch and the incoming branch` for a both-sides drop.

1. **If the removal is genuinely QA's** (a legitimate bounce-revert
   propagating through the merge-up): name every listed ticket id
   anywhere in the merge commit message and re-commit. This is the
   identical escape `check_ticket_deletion.sh` (BL-901) already uses.
2. **Otherwise** the merge is about to drop rebuilt work: re-merge the
   branch commit(s) named in the refusal (the "introduced at" hash) into
   your branch first, then retry the merge-up.

A path the guard cannot attribute to any ticket (no `TICKET-id` in its
introducing commit's subject on either side) is reported as
`(unattributed)` and still refuses — an attribution gap never silently
passes.

## Both-sides drops report one finding, naming both sides (BL-1341)

A path missing from BOTH `HEAD` and `MERGE_HEAD`'s pre-merge trees is
recorded once, not twice — `check_merge_deletion.sh`'s `side_of` map
folds a second-seen side into the first finding's text (`"this branch
and the incoming branch"`) instead of emitting a duplicate refusal line.
The hardener's own pass on BL-1341 closed a gap in that fold itself: an
early implementation *overwrote* the recorded side instead of appending,
so a both-sides drop could silently report only the side found second,
losing the fact that the resolver's OWN branch also carried a version of
that path. Test 13b (`test_merge_deletion_guard.sh`) now asserts a
both-sides finding's text contains both `"this branch"` and `"the
incoming branch"`.

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
- BL-1341 (this guard's second, incoming-side direction) — the
  `HEAD`-only predicate above was deliberately one-directional at
  BL-1242 mint; BL-1341 closed the mirror blind spot after merge
  `b71c941a19` dropped QA-landed work through it. Deliberately kept in
  ONE script rather than a fourth sibling guard — see the script's own
  BL-1341 header comment.
- BL-1403 (moves are not deletions; either-side attribution) — closed the
  recurring unexemptable block every root-drain intake archive triggered
  on the next merge-up in every worktree.

## Verify

```bash
bash swarmforge/scripts/test/test_merge_deletion_guard.sh
bash swarmforge/scripts/test/test_ticket_deletion_guard.sh
node specs/pipeline/cli.js specs/features/BL-1242-merge-never-silently-drops-branch-work.feature
```

Acceptance: `specs/features/BL-1242-merge-never-silently-drops-branch-work.feature`,
plus `specs/features/BL-1403-the-merge-deletion-guard-never-reports-a-move-and-never-refuses-unexemptably.feature`
for the moves/attribution fix above, with a property runner
(`swarmforge/scripts/test/bl1403_merge_deletion_guard_property_runner.bb`).
