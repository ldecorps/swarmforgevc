# Parcel-rollback guard on `git_handoff` sends (BL-1213)

*How-to. Task-oriented: understand why a `git_handoff` send was refused
for silently losing landed work, and how to clear it.*

Send-time gate in `swarm_handoff.sh`, alongside the other three
send-time gates (`ticket_close_guard_lib.bb`, `duplicate_chain_guard_lib.bb`,
`task_commit_coherence_gate_lib.bb`). Full mechanics:
[`swarmforge/handoff-protocol.md`](../../swarmforge/handoff-protocol.md#parcel-rollback-guard-bl-1213).

## What it catches

A branch whose tip has quietly reverted to pre-parcel content for a path
the ticket's own accepted parcel commit changed — with nothing on the
branch (no revert commit) explaining why. This happens most often after a
bulk restore-from-sibling repair (rebuilding a collapsed worktree from
another branch's on-disk content): the repair can accidentally carry
stale bytes for a path a more recent parcel had already fixed, and every
other check reads clean — the commit log shows a "recovery" subject, not
a revert; the tree is full-size; and BL-1098's own silent-revert
predicate excuses it because the tip does match its newest authoring
commit.

## What it does NOT catch, on purpose

- A legitimate `git revert` of the parcel commit (BL-490/BL-495 bounce
  reverts stay legal).
- Later work that authors genuinely different content for the same path.
- Paths the ticket's own parcel commit never touched (this is a
  ticket-scoped check, not a full-tree freshness walk).
- A `note` handoff — only `git_handoff` sends are checked.

## If you hit this refusal

```text
Cannot send git_handoff for BL-901: this branch's tip holds pre-parcel
content for one path (extension/src/docs/docsTree.ts) - accepted commit
e5cf2a3af changed it but no revert of that commit explains the rollback
on this branch (BL-1213). If this is a deliberate BL-490/BL-495 bounce
revert, revert the parcel commit properly; otherwise the branch has
silently lost landed work and needs the content restored before this
send.
```

1. If you genuinely meant to bounce-revert the parcel commit, do it
   properly (`git revert -m 1 <parcel-commit>` for a merge, plain
   `git revert` otherwise) rather than hand-editing the path back — the
   guard reads revert history, not just current content.
2. Otherwise, restore the named path(s) to the parcel commit's content
   (`git show <parcel-commit>:<path>` is the source of truth) and re-send.

## Where it lives

| Piece | Location |
| --- | --- |
| Guard library | `swarmforge/scripts/parcel_rollback_guard_lib.bb` |
| Wired into | `swarmforge/scripts/swarm_handoff.bb` (send-time `validate`) |
| Acceptance steps | `specs/pipeline/steps/bl1213ParcelRollbackGuardSteps.js` |

## Related

- BL-1098 (push-sweep silent-revert predicate, `push_sweep_lib.bb`; see [BL-1085 push-sweep how-to](BL-1085-push-sweep-caches-its-refusal-and-gathers-once.md)) — the check this gate's shape deliberately does not reimplement; different question, different chokepoint.
- BL-1205 (mass-deletion forward gate), BL-1211 (resurrection direction + quarantine lift), BL-1208 (record-bounce revert remedy), BL-1195 (worktree drift with no authoring commit) — sibling tickets in the same incident thread; none of them covers this direction.

## Verify

```bash
bash swarmforge/scripts/test/parcel_rollback_guard_lib_test_runner.bb
bb swarmforge/scripts/test/bl1213_parcel_rollback_guard_property_runner.bb
node specs/pipeline/cli.js specs/features/BL-1213-forward-refused-when-branch-rolled-back-a-parcel.feature
```

Acceptance: `specs/features/BL-1213-forward-refused-when-branch-rolled-back-a-parcel.feature`
