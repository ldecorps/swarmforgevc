# `:ff-absorb` attempts a real 3-way merge before resetting local main away (BL-1214)

## The gap

`absorb-dispatch-plan` (`master_main_reconcile_lib.bb`) resolves a
`behind>0` + `ahead>0` + no-predicted-conflict divergence to `:ff-absorb` —
its own name for "this should be absorbable". But every executor of that
plan (`handoffd.bb`'s `master-main-reconcile-merge!`, `swarm_heal.bb`'s
inline `:merge!`/`:rematch!` pair, `post_hotfix_merge_origin.bb`'s absorb +
`rematch-onto-origin!`) ran only `git merge --ff-only --no-edit
origin/main`. A genuine two-way divergence can never fast-forward, however
non-conflicting its content — so that merge always failed, no `MERGE_HEAD`
was ever created, and every call site fell straight through to `git reset
--hard origin/main`, discarding the local-only commit outright. The plan
said "absorb"; the execution could only fast-forward.

This fired in production on `main` on 2026-08-28 and destroyed four
committed commits, including the human's own approval of this ticket
(`human_approval: approved` on both BL-1214 and BL-1215 reverted back to
`pending`) — see `backlog/evidence/BL-1198-preexisting-two-way-divergence-reset-defect-20260827.md`
and the ticket's own notes for the recovery (`rescue/main-before-reset-20260828`).

## Fix

Between the failed fast-forward and the reset fallback, the shared
`absorb-with-merge!` (`master_main_reconcile_lib.bb`) now attempts one
plain 3-way `git merge --no-edit origin/main`:

- **Merge succeeds** — the divergence is absorbed losslessly via a real
  2-parent merge commit; both the landed commit and the local-only
  bookkeeping commit stay reachable. No reset happens.
- **Merge conflicts** — the attempt is aborted cleanly (reusing the
  existing `may-abort-failed-merge?` seam from BL-1120, never re-deriving
  the check, and never leaving a conflicted `MERGE_HEAD` behind per the
  BL-1130/BL-1131/BL-1135 designed-refusal guarantee) and control falls
  through to today's `git reset --hard origin/main` recovery, byte-for-byte
  unchanged. `handoffd.bb` logs `master-main-reconcile conflict` at this
  point so the attempt is observable even though the reset then succeeds.

This composes with BL-1198's push-before-reset into one ladder:
**fast-forward → push → 3-way merge → reset (last resort)**.

## Where it lives

| Call site | File |
| --- | --- |
| Shared primitive | `swarmforge/scripts/master_main_reconcile_lib.bb` — `absorb-with-merge!` |
| Daemon reconcile | `swarmforge/scripts/handoffd.bb` |
| Manual heal | `swarmforge/scripts/swarm_heal.bb` |
| Post-hotfix merge | `swarmforge/scripts/post_hotfix_merge_origin.bb` |

Only how an already-planned `:ff-absorb` is *executed* changed —
`absorb-dispatch-plan` itself (when a rematch/absorb is planned) is
unchanged.

## A regression the fix's own bounce caught: FF-success exit code

The first round of this fix accidentally narrowed
`run-post-hotfix-merge!`'s success dispatch to only the `:merged` outcome,
so an ordinary fast-forward (the common case, no divergence at all) fell
through to a bare passthrough branch instead of `finish-ok`, regressing the
exit code and the "deadlock cleared when behind 0" case. Architect review
caught it; the re-fix restores `finish-ok` for both `:merged` and plain
`:ff` outcomes. A `test_swarm_heal_push_before_reset.sh` divergence
assertion that had gone stale during the fix round was corrected in the
same pass.

## Constraints preserved

- The conflicting-divergence path behaves exactly as it did before this
  ticket, once a real merge has actually been attempted and conflicted.
- No conflicted `MERGE_HEAD` is ever left for an operator to finish.
- No merge this path did not itself start is ever aborted.

## Related

- [BL-1198 rematch reset pushes local-ahead main before discarding it](BL-1198-rematch-reset-must-push-before-discarding-local-ahead-commits.md)
- [BL-891 master-main reconcile sweep](BL-891-master-main-reconcile-sweep.md)
- [BL-1120 handoffd must not abort a foreign merge](BL-1120-handoffd-must-not-abort-foreign-merge.md)

Acceptance:
`specs/features/BL-1214-reconcile-absorbs-non-conflicting-two-way-divergence-with-a-real-merge.feature`
