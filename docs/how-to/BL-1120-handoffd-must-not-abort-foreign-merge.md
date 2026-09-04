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

## Ownership across ticks (BL-1386)

"Started the merge" used to mean only *this* tick — a `MERGE_HEAD` still
open when the NEXT tick ran was, by this rule, always foreign, because the
daemon kept no record of its own merges past the tick that created them.
Three times on 2026-09-04 the daemon's own `git merge --abort` failed
silently (the ordinary cause on this checkout: `.git/index.lock` held by
another writer), the failure was never logged, and the next tick read the
still-open `MERGE_HEAD` as a human's and surfaced `human-merge-in-progress`
against its own orphaned merge — a merge whose conclusion would have
reverted a QA landing on push.

BL-1386 gives the daemon a durable ownership record
(`.swarmforge/daemon/master-main-merge-owner.json`: the sha it is merging,
tick, pid, timestamp — written before `git merge`, cleared after a
successful merge or abort). "A merge this daemon started" now means: THIS
tick's merge, **or** any `MERGE_HEAD` whose sha matches a still-standing
ownership record from an earlier tick. Only that positive match may be
aborted — this rule never widens; a `MERGE_HEAD` with no record, or one
naming a different sha, is still surfaced as `human-merge-in-progress`
exactly as before. A failed abort is retried with a short bounded backoff
and, if it still fails, logged as `merge-abort-failed` with git's own error
text (never silently discarded, never the fixed word `conflict`) and the
record is left in place for the next tick to finish by ownership.

Full reconcile context: [BL-891](BL-891-master-main-reconcile-sweep.md).

Acceptance:
`specs/features/BL-1120-handoffd-must-not-abort-foreign-merge.feature`

## Bare origin/main rematch

QA bounced stacked tips that hitchhiked sibling rematches. Recreate on
current `origin/main` and land **BL-1120 paths only** (never merge into
hitchhiked ancestry). Hitchhike gate:

```bash
git diff --name-only origin/main...HEAD \
  | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8' \
  && echo FAIL || echo CLEAN
```

