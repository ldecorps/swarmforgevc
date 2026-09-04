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
naming a different sha, is never aborted by the daemon either (see
"Foreign but not always human" below for how it is now classified). A
failed abort is retried with a short bounded backoff and, if it still
fails, logged as `merge-abort-failed` with git's own error text (never
silently discarded, never the fixed word `conflict`) and the record is
left in place for the next tick to finish by ownership.

## Foreign but not always human (BL-1387)

Not owning a merge and it being a HUMAN'S are two different facts, and this
rule used to conflate them: any `MERGE_HEAD` with no BL-1386 ownership
record was surfaced as `human-merge-in-progress` on the strength of that
absence alone. On 2026-09-04 that reading held two roles and the daemon for
15 minutes on a merge that belonged to nobody — the daemon's own failed
abort (`pgrep -ax git` empty, no `.git/index.lock`, the index carrying none
of `HEAD..MERGE_HEAD`) — and told the human nothing they could act on.

A non-owned `MERGE_HEAD` now classifies on POSITIVE evidence, never
absence: `human-merge-in-progress` requires a live `git` process whose cwd
is the checkout, or a fresh `.git/index.lock` (mtime inside a short
window); with neither signal it classifies `orphaned-merge` instead and
escalates AT ONCE rather than holding for three ticks as if it were
patience. The daemon still never aborts an orphan itself — auto-abort is a
separate, unbuilt decision with a real cost (backing up staged-new files an
abort would delete) — but the surfaced text now states plainly whether the
index carries the incoming side, and the coordinator's step-0 action table
(BL-798) tells whoever holds the parcel to back the staged files up, then
`git merge --abort` by hand, and let the daemon's next tick redo the join.

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

