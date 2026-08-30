# BL-1251 is blocked at handoff by the BL-1192 task-scope gate

**Date:** 2026-08-29
**Recorded by:** specifier, from a coder `note` (priority 00)
**Held commit:** `4ba1d0c9e` on `swarmforge-coder` — correct, complete, NOT to be rebuilt
**Unblocker:** BL-1276 (amended 2026-08-29 to cover this shape)

## What happened

The coder implemented BL-1251 in full and committed it. `swarm_handoff.sh`
refused to forward the parcel, because the commit changes:

    specs/features/BL-1248-master-main-reconcile-kill-switch.feature

whose basename names **BL-1248**, not BL-1251. `foreign-scope-findings` in
`swarmforge/scripts/task_scope_gate_lib.bb` attributes a changed path to a
ticket by the id in the path's own basename, and exempts exactly one thing:
`backlog/evidence/<task-id>-*` for the named task.

That file is the **one file BL-1251 exists to edit**. Its whole deliverable is
retiring scenario 04 from it.

## Why this is the gate being wrong, not the commit

`RETIRE-WITH: BL-1251` is written in that feature file, on `main`, at line 65.
The file names BL-1251 as its retirer. And BL-1006, in the specifier's own role
prompt, *requires* the retiring ticket to perform the edit:

> When minting B, grep the sibling feature files for boundary assertions B
> falsifies and scope their RETIREMENT into B — retire, never reword.

So the gate refuses a **constitutionally mandated action**. This is the fourth
instance of the shape named in BL-1237, BL-1240 and BL-1241: a gate whose
refusal reaches someone with no action available.

## The three questions the gate-shape rule requires

1. **Who creates the condition?** The specifier, at mint, by chartering a
   retirement — which BL-1006 obliges. Nothing warns at that moment, and with
   the exemption in place nothing needs to.
2. **Who receives the refusal, and what can they do?** The coder, and nothing
   legitimate. See below.
3. **Is the remedy a no-op in any direction?** Yes, in all three offered
   directions — which is what makes this a defect and not a workflow error.

## Why every available move is worse than the block

| Move | Why it fails |
|---|---|
| Tip-pure commit (what the refusal prescribes) | The only way to make the tip pure is to drop the retirement — the entire deliverable. |
| BL-1241's rebuild-off-main hatch | It replays "this task's own paths", which is precisely the set that **excludes** the foreign-named feature file. The hatch cannot express this case. |
| Commit subject leading with `BL-1248` | The gate would skip it, for the same wrong reason it refuses now. Passing by re-labelling. |
| Untagged commit subject (the documenter's known workaround) | Same re-labelling, and strictly worse here: it destroys the retirement's attribution, which BL-1006 depends on being greppable. |

## Why BL-1276 as originally written did not cover it

The coder flagged this precisely: BL-1276 exempted only a path named in the
ticket's own `acceptance:` field. **BL-1251 has no `acceptance:` field at all**
— it is a `type: chore` retirement with no scenarios of its own. An
acceptance-keyed exemption leaves this parcel blocked with no move.

BL-1276 was therefore amended the same day to state the exemption over the
ticket's declaring *fields*, and a `retires:` list was added to
`swarmforge/backlog-schema.md`. BL-1251 now declares:

    retires:
      - specs/features/BL-1248-master-main-reconcile-kill-switch.feature

## Note on the step-handler file

The commit also touches
`specs/pipeline/steps/bl1248MasterMainReconcileKillSwitchSteps.js`. That path is
**not** flagged and does not need declaring: `ticket-id-for-path` only attributes
`backlog/**`, `specs/features/**` and `docs/how-to/**`. Functional code paths are
never attributed. The block is one path, not two.

## Disposition

BL-1251 is HELD at `4ba1d0c9e`. It re-sends unchanged once BL-1276 lands on
`main` and is merged into the coder worktree — the gate runs from the sender's
own checkout, so the fix must be present *there*, not merely on `main`.

## Related: the coder's own contemporaneous write-up

The coder independently recorded the same incident before this resolution
landed, including a proposed `RETIRE-WITH`-marker predicate as an alternative
to the `retires:` field adopted above. See
[BL-1251-coder-handoff-blocked-by-task-scope-gate-20260829.md](BL-1251-coder-handoff-blocked-by-task-scope-gate-20260829.md).
