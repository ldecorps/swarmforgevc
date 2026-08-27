# Landing on main without external conflict resolution (BL-1130)

Absorbing `origin/main` into local `main` (handoffd's BL-891 reconcile and
Process B `post_hotfix_merge_origin.bb`) used to leave the master checkout
mid-merge when a land raced a content conflict — `MERGE_HEAD` plus `UU`/`AA`
paths — until a human finished the merge in an editor. BL-1120 correctly
refuses to abort a *foreign* merge; it does not make conflicted automated
joins safe. BL-1130 closes that gap for the **automated** absorb path.

## Rule

Automated absorb either:

1. **Completes** conflict-free (FF / non-conflicting merge), or
2. **Clean-refuses** with outcome `:refuse-rematch` — abort if a merge was
   started, leave **no** `MERGE_HEAD` and **no** unmerged paths, and surface
   rematch/refuse text (never "finish this merge in an editor").

Policy helpers live in `master_main_reconcile_lib.bb`
(`automated-absorb-plan`, `post-absorb-clean?`,
`absorb-outcome-names-rematch-or-refuse?`, merge-tree conflict foresight).
Git I/O stays in `handoffd.bb` and `post_hotfix_merge_origin{,_lib}.bb`.

## Operator / lander note

If you see `BL-1130: absorb refused — rematch tip onto origin/main`, rematch
the ticket tip onto current `origin/main` (tip purity) and re-land — do not
open an editor to finish a daemon merge. Human-owned merges still use the
BL-1120 skip path (`human-merge-in-progress`).

## Residual closed by BL-1131

Refuse-clean alone still left `wait-dirty-clear` until an operator finished
an absorb merge. [BL-1131](BL-1131-ticket-land-without-operator-absorb-merge.md)
adds rematch-then-FF so successful lands reach `behind=0` without that ops page.

## Residual closed by BL-1141

Naming `:refuse-rematch` without executing rematch still left
`wait-reconcile` until Cursor rematched. [BL-1141](BL-1141-bl1138-residual-refuse-rematch-not-executed.md)
runs rematch on the live refuse path (sibling of BL-1138 bookkeeping) and
clears the standing surface.

## Related

- [BL-1141 refuse-rematch recovery](BL-1141-bl1138-residual-refuse-rematch-not-executed.md)
- [BL-1131 rematch-then-FF land](BL-1131-ticket-land-without-operator-absorb-merge.md)
- [BL-891 master-main reconcile](BL-891-master-main-reconcile-sweep.md) (Process B updated)
- [BL-1120 foreign merge abort skip](BL-1120-handoffd-must-not-abort-foreign-merge.md)

Acceptance: `specs/features/BL-1130-land-on-main-without-external-conflict-resolution.feature`
