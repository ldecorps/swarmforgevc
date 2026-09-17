# Work notes attribute mutation cost without a task header (BL-1185)

*How-to. Task-oriented: understand why a hard coder seat can claim an
ambulance Work note that has no `task:` header — and why ops must not stamp
`task:` onto notes.*

## The gap

BL-1001 difficulty routing reads ticket `mutation_cost` for
`difficulty-allows-claim?`. That path used only the handoff `task:` header.
Coordinator **Work** notes are `type: note` with `message: Work BL-…` and
**must not** carry `task:` (`swarm_handoff` rejects `task` on notes —
git_handoff-only). Nil task → nil cost → hard seat `:defer-better-fit` when
an easy sibling is idle → `NO_TASK` while the ambulance patient sat in
`new/`.

## What changed

Attribution reuses `supersede_lib/task-name-from-content`:

| Handoff shape | Cost for seat difficulty |
| --- | --- |
| `git_handoff` with `task:` | That task → YAML `mutation_cost` |
| `type: note`, `Work BL-…` message, **no** `task:` | Parsed Work id → YAML `mutation_cost` |
| Other note, no `task:` | Cost unset (legacy defer unchanged) |

Do **not** stamp `task:` onto Work notes. Temporary easy-seat pins are ops
unblocks only — this attribution is the durable fix.

## Operator check

1. Confirm the Work note is `type: note` and has no `task:` line.
2. Confirm the message looks like `Work BL-….`.
3. On a hard seat with an idle easy sibling, `ready_for_next` should claim a
   high-`mutation_cost` ambulance patient rather than print `NO_TASK` solely
   for nil task cost.

## Verify

```bash
cd extension && npm test -- bl1185WorkNoteMissingTaskHeader
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1185-work-note-missing-task-header-defers-hard-seat.feature
```

## Silently reverted, then restored (BL-1608)

BL-1167's land (`ccc63d8cfd`, 2026-08-27, same afternoon as this fix)
rewrote `difficulty-allows-claim?`'s signature and replaced the call above
with a bare `task:` header read — removing this attribution outright, one
commit after its own architect pass said "keep BL-1185 attribution"
(the BL-571/BL-958 silent-revert class). Nothing ran this feature again
until 2026-09-16, when a full acceptance-corpus run (BL-1602) found
scenario 02 red on `main` and traced it to the missing call.

BL-1608 restores it as `claim-task-name`, one shared function both
`difficulty-allows-claim?` and `apply-effort-for-task!` (BL-1316's effort
apply, which reads the same attribution at claim time and had silently
lost it too) now call — so the two readers cannot drift apart again the
way a duplicated inline read once did.

Related: [Difficulty-aware coder seat routing](BL-1001-difficulty-aware-coder-seat-routing.md).
