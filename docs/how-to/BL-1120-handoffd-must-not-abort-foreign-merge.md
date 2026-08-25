# handoffd must not abort a foreign master-main merge (BL-1120)

## The gap

`master-main-reconcile-merge!` always ran `git merge --no-edit origin/main`
and, on any non-zero exit, `git merge --abort`. If a human was already
mid-merge (`MERGE_HEAD` set), the tick's merge failed and the abort
**stomped the human join** — observed twice during BL-1074 conflict
resolution.

## What changed

| Piece | Change |
| --- | --- |
| `master_main_reconcile_lib.bb` | `merge-attempt-plan` / `may-abort-failed-merge?`; surface reason `:human-merge-in-progress` |
| `handoffd.bb` `master-main-reconcile-merge!` | If `MERGE_HEAD` already present → skip + surface; abort only when this tick started the merge |

## Operator note

If you see a note like `BL-1120: human-merge-in-progress on master…`, finish
or deliberately abort your merge — handoffd will not clear it for you. A
conflict on a reconcile merge that the **daemon** started still aborts as
before (leaves the tree not mid-merge).

Full reconcile context: [BL-891](BL-891-master-main-reconcile-sweep.md).

Acceptance:
`specs/features/BL-1120-handoffd-must-not-abort-foreign-merge.feature`
