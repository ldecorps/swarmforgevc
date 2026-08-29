# Retirement-readdition guard on `git merge --no-ff` (BL-1258)

*How-to. Task-oriented: understand why a merge commit was refused for
silently restoring a retired ticket's artefacts, how to clear it, and how
to record a retirement so this guard can see it.*

Commit-msg-time guard, the addition-side twin of
[`check_merge_deletion.sh`](BL-1242-merge-deletion-guard.md) (BL-1242):
`swarmforge/scripts/check_retirement_readdition.sh`, wired into
`swarmforge/git-hooks/commit-msg` alongside both `check_ticket_deletion.sh`
(BL-901) and `check_merge_deletion.sh`. All three guards run on every
commit-msg invocation — none's exit status can mask another's.

## What it catches

BL-1242 refuses a merge that silently **drops** a path the receiving
branch introduced. Nothing refused the mirror case: a branch that still
carries a *retired* ticket's artefacts presents them to a merge as a
clean one-sided **add** — no conflict, no marker — and the retirement
never holds. This is exactly the
`BL-1247-reconcile-sweep-kill-switch` incident: adjudicated a superseded
id collision and retired, but three branches each carried a different,
uncoordinated partial retirement, none of which ever reached `main`, and
a later merge from a branch still holding the mint would have brought it
straight back.

The guard only fires when a merge is actually in progress (`MERGE_HEAD`
exists) and only for paths recorded in the **retirement registry** (see
below) — an ordinary commit, or a merge adding a live ticket's new files,
is untouched.

## The registry: a ref, not a branch

A retirement record committed to `main` is invisible to a branch that has
not yet merged `main` — the exact failure this guard exists to close.
Instead, `retirement_registry_lib.bb` stores the retired-paths map as a
single JSON blob pointed at by `refs/retirement/registry`. Every role
worktree in this swarm is a `git worktree` of the *same* repository,
sharing one object database and ref namespace — a ref update is visible
to every worktree the instant it happens, regardless of which branch that
worktree's `HEAD` points at. No merge, no checkout, no ordinary merge
traffic required.

Record a retirement (replacing any prior path set for the same id — a
re-adjudication that narrows a retirement must not leave stale paths
behind):

```bash
bb swarmforge/scripts/retirement_registry_cli.bb . register BL-1247 \
  backlog/active/BL-1247-....yaml \
  specs/features/BL-1247-....feature \
  specs/pipeline/steps/bl1247....js
```

List everything currently retired (the shape the guard itself reads):

```bash
bb swarmforge/scripts/retirement_registry_cli.bb . paths
# <path>\t<ticket-id>, one per line
```

As of this writing, registering a retirement is a manual step in the
adjudication ritual — the specifier's own retirement/deprecator prose has
not yet been updated to call it (tracked as follow-on work, not part of
this guard). A retirement written only to `backlog/evidence/` is
paperwork; only a path registered here is enforced.

## If you hit this refusal

```text
Error: merge re-adds 'specs/features/BL-1247-reconcile-sweep-kill-switch.feature', retired under BL-1247, not named in the commit message.
Commit rejected: BL-1247's artefacts cannot re-enter through a merge. Delete the retired paths on this branch, or name the retired ticket id(s) in the commit message to confirm a deliberate un-retirement.
```

1. **If your branch is the one still carrying the stale artefacts**, the
   cheapest move: delete the retired paths on your own branch first, then
   retry the merge.
2. **If this is a deliberate un-retirement** (the id is being reused, or
   the retirement itself was wrong), name the retired ticket id anywhere
   in the merge commit message and re-commit — the identical
   message-naming escape `check_ticket_deletion.sh` (BL-901) and
   `check_merge_deletion.sh` (BL-1242) already use.

## Where it lives

| Piece | Location |
| --- | --- |
| Registry lib | `swarmforge/scripts/retirement_registry_lib.bb` |
| Registry CLI | `swarmforge/scripts/retirement_registry_cli.bb` |
| Guard script | `swarmforge/scripts/check_retirement_readdition.sh` |
| Wired into | `swarmforge/git-hooks/commit-msg` (alongside `check_ticket_deletion.sh` and `check_merge_deletion.sh`) |
| Registry ref | `refs/retirement/registry` (single JSON blob, no commit history) |
| Acceptance steps | `specs/pipeline/steps/bl1258RetirementDurabilitySteps.js` |

## Related

- BL-1242 (`check_merge_deletion.sh`) — the deletion-side sibling this
  guard mirrors; that one refuses work silently dropped, this one refuses
  retired work silently restored.
- BL-901 (`check_ticket_deletion.sh`) — the original message-naming
  escape both siblings reuse.
- Article 3.6 (deprecator freshness gate) — the adjudication step that
  decides a retirement; this guard enforces one once it is registered,
  it does not adjudicate.

## Verify

```bash
bash swarmforge/scripts/test/test_retirement_readdition_guard.sh
bb   swarmforge/scripts/test/retirement_registry_lib_test_runner.bb
node specs/pipeline/cli.js specs/features/BL-1258-a-retirement-is-durable-across-branches.feature
```

Acceptance: `specs/features/BL-1258-a-retirement-is-durable-across-branches.feature`
