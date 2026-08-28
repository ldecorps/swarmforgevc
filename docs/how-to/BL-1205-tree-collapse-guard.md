# Tree-collapse (mass-deletion) guard on `git_handoff` sends (BL-1205)

*How-to. Task-oriented: understand why a `git_handoff` send was refused
for mass-deleting the recipient's tracked files, and how to clear it.*

Send-time gate in `swarm_handoff.sh`, alongside the other send-time gates
(`ticket_close_guard_lib.bb`, `duplicate_chain_guard_lib.bb`,
`task_commit_coherence_gate_lib.bb`, `parcel_rollback_guard_lib.bb`).
Unlike the ticket-scoped [BL-1213 parcel-rollback
guard](BL-1213-parcel-rollback-guard.md), this one checks **every**
`git_handoff`, to **every** recipient role, whether or not it names a
ticket — mass deletion is a tree-wide symptom, not a ticket-scoped one.
Full mechanics: [`swarmforge/handoff-protocol.md`](../../swarmforge/handoff-protocol.md#tree-collapse-guard-bl-1205).

## What it catches

A send whose merge into the recipient's own branch would remove a large
fraction of that branch's tracked files. On 2026-08-27,
`refs/heads/swarmforge-architect` was collapsed to 79 tracked paths by 200
test-fixture commits (`init`/`seed`/`fixture: initial`, all authored at
the identical second) — each one a ~9,700-file deletion relative to the
real tree. Every ordinary merge downstream honored those deletions the
normal way (one side deleted, the other untouched, no conflict, no
marker), so the branch looked like it was healing while merges were
silently re-applying the deletion each time. Nothing in `swarm_handoff.sh`
saw it: the QA-bound pre-QA gate only arms when the recipient list
includes QA and keys its findings to a ticket id, so a deletion tied to no
ticket sailed through every non-QA hop.

## How it decides

The guard **simulates** the merge the recipient is about to perform
(`git merge-tree --write-tree <recipient-branch> <cited-commit>`) and
compares the resulting tree's path count against the recipient branch's
own current count — it does not infer intent from the sender's diff, the
same simulation that confirmed the original incident. It refuses when the
merge would remove more paths than the **smaller of** 5% of the
recipient's own path count or 100 paths flat (the live incident's 9,680
removed paths cleared either bound by two orders of magnitude; an
ordinary directory-deletion refactor clears neither).

Every recipient the handoff names is checked independently — a
mass-deletion finding for **any one** recipient refuses the whole send.
The guard only ever reports; it never rewrites, alters, or reverts the
commit it is refusing, and an unreadable recipient branch contributes a
warning, never a refusal on its own.

## If you hit this refusal

```text
Cannot send git_handoff to hardener: merging the cited commit into
swarmforge-hardender would remove 9680 of its 9773 tracked paths (leaving
93) - refused as a mass-deletion forward (BL-1205). If this is genuinely
intended, land it by hand after confirming the recipient branch's health;
if the recipient branch is itself corrupt, it needs re-cutting from a
known-good ref, not a parcel routed through it.
```

1. If the recipient branch is the one that's actually corrupt (a
   collapsed tree, like the source incident), do not route more work
   through it — re-cut it from a known-good ref first (see
   [BL-1211](../../swarmforge/handoff-protocol.md) / the quarantine-lift
   family for recovery).
2. If the deletion is genuinely intended (a real, deliberate mass
   removal), land it by hand after confirming the recipient branch's
   health — this guard only blocks the automated `swarm_handoff.sh` path.

## Where it lives

| Piece | Location |
| --- | --- |
| Guard library | `swarmforge/scripts/tree_collapse_guard_lib.bb` |
| Wired into | `swarmforge/scripts/swarm_handoff.bb` (send-time `validate`) |
| Acceptance steps | `specs/pipeline/steps/bl1205HandoffRefusesAMassDeletionForwardSteps.js` |

## Related

- [BL-1213 parcel-rollback guard](BL-1213-parcel-rollback-guard.md) — the ticket-scoped sibling: catches a *content* rollback for one ticket's own paths, not a tree-wide deletion.
- BL-1196 / BL-1200 (fixture-writes-into-live-repo prevention) and BL-1202 (shared-repo canary) — the cause and detection halves of the same incident thread; this ticket is the containment half, stopping an already-corrupt branch from spreading its deletions downstream.

## Verify

```bash
bb swarmforge/scripts/test/tree_collapse_guard_lib_test_runner.bb
bb swarmforge/scripts/test/bl1205_tree_collapse_guard_property_runner.bb
node specs/pipeline/cli.js specs/features/BL-1205-handoff-refuses-a-mass-deletion-forward.feature
```

Acceptance: `specs/features/BL-1205-handoff-refuses-a-mass-deletion-forward.feature`
