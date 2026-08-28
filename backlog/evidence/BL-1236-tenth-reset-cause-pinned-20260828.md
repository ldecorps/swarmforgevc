# BL-1236 evidence — tenth reset-to-origin occurrence, cause pinned to one line

**Recorded:** 2026-08-28, by the specifier, while adjudicating the
coordinator's priority-00 note about BL-1233 being unreachable.
**Owner:** BL-1236 (defect/critical, `backlog/paused/`). BL-1214 is closed and
did NOT prevent this; see "Why BL-1214 did not catch it" below.

## What happened

`handoffd` daemon log (all times UTC):

    06:11:54.973Z  push-sweep diverged delivered
    06:11:56.134Z  master-main-reconcile drift ahead=9 behind=30
    06:11:58.051Z  master-main-reconcile conflict predicted-conflict-colliding-local-ahead
    06:11:59.176Z  master-main-reconcile reconciled

Reflog on `main`:

    bddfe75a1 HEAD@{2026-08-28 07:11:59 +0100} reset: moving to origin/main

Nine commits became unreachable. This is the first occurrence observed with the
daemon's own decision line one second before the act — every prior occurrence
was reconstructed from casualties.

## The nine casualties

| Commit | Content | Disposition |
|---|---|---|
| `38b7cbb66` | BL-1232 `human_approval: approved` (real human tap) | **RESTORED** `8c639fc36` |
| `fcb600bc3` | BL-1230 two spec-time notes incl. the fixture-path hazard | **RESTORED** `8c639fc36` |
| `72d1f78df` | BL-1233 `human_approval: approved` (real human tap) | **RESTORED** `8c639fc36` |
| `5f1cb5035` | BL-1233 ticket YAML (161 lines) + feature file (32 lines) | **RESTORED** `8c639fc36` |
| `4078b2e63` | BL-1233 topic record | **RESTORED** `8c639fc36` |
| `15b54f975` | BL-1227 topic record | **RESTORED** `8c639fc36` |
| `331b20f40` | Operator raw intake (ollama front-desk question) | not restored — already drained into BL-1235, which quotes it verbatim |
| `7a83cdc01` / `72f2fc020` | `INTAKE-optest.md` added then removed | net zero, nothing to restore |

Also lost earlier in the same reflog window: `a94a07a62` "Promote BL-1227:
paused → active". BL-1227 is in `backlog/active/` today, so the promotion was
re-done; no action.

Every restore verified byte-identical with `git diff <lost-commit> -- <paths>`
returning empty.

## Cause — measured, not inferred

`master_main_reconcile_lib.bb:167`:

    (defn merge-tree-reports-conflict?
      [merge-tree-out]
      (boolean (re-find #"(?i)changed in both|CONFLICT|added in both"
                        (or merge-tree-out ""))))

`handoffd.bb:3135-3143` feeds it the output of the **legacy three-argument**
`git merge-tree <base> HEAD origin/main`, which is a unified diff of merged
CONTENT, not a conflict report. The regex therefore searches the text of the
files being merged.

Replaying the exact inputs:

    $ git merge-tree --write-tree 38b7cbb66 bddfe75a1
    73700df8ed86d78967c37060967328411c161104          # exit 0 — CLEAN MERGE

    $ git merge-tree fc0a84439 38b7cbb66 bddfe75a1 | grep -c 'changed in both'
    0                                                  # no real conflict marker

    $ git merge-tree fc0a84439 38b7cbb66 bddfe75a1 | grep -icE 'changed in both|CONFLICT|added in both'
    5                                                  # five PROSE matches

The five matches, in full:

     89:-     naming BL-1185 and at least one conflicting path; confirm no mailbox file.
    159:+foreign ticket id... lists at least one conflicting path"). BL-1185 is in
    304:+conflicts (just the usual `index.js` require).
    337:+clean; only `human_approval` was blocking). No conflicts. This is a
    617:+     naming BL-1185 and at least one conflicting path; confirm no mailbox file.

Line 337 reads **"No conflicts."** A sentence asserting the absence of conflicts
is what predicted the conflict that destroyed nine commits.

## Why BL-1214 did not catch it

BL-1214 (closed 04:46 local, 2.5 hours before this occurrence) made the
`:ff-absorb` executor attempt a real 3-way merge before falling back to reset.
That code is correct and was simply never reached. `post-land-absorb-plan`
(`master_main_reconcile_lib.bb:189-194`):

    (and (pos? behind) (zero? ahead)) :ff-absorb
    absorb-would-conflict?            :replay-bookkeeping     ;; <- taken (ahead=9)
    :else                             :ff-absorb

`:replay-bookkeeping` calls `master-main-rematch-onto-origin!` directly — no
merge attempt. BL-1198's "push first, reset only if the push is rejected" guard
did fire and did not help: at ahead=9 behind=30 the push is necessarily
rejected, which is precisely when the data loss happens.

With an honest predicate, `absorb-would-conflict?` is false, the plan falls
through to `:else :ff-absorb`, and BL-1214's merge absorbs the divergence
losslessly. **The predicate is the entire fix.**

## Reusable detection probe

`git log --all --grep=<id>` reports clean — casualties are unreachable, not
un-merged. Only the reflog sees them:

    git log -g --format='%h %gd %gs' | head -80 > /tmp/reflog.txt
    while read -r h rest; do
      git merge-base --is-ancestor "$h" HEAD 2>/dev/null || echo "LOST: $h $rest"
    done < /tmp/reflog.txt

21 unreachable commits in the top 80 entries at the time of writing.

## Standing hazard while BL-1236 is open

BL-1236's own YAML and feature file contain the word "conflict" dozens of
times. Merging them makes the false prediction more likely, not less, until the
predicate is fixed.
