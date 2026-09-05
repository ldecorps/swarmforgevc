# QA worktree branch reconcile blocked by BL-1403's own class, 2026-09-04

A coordinator chase note ("branch behind f4ce3bd2cc: branch cannot
fast-forward to landed commit - merge up") asked this worktree to merge
`origin/main` into `swarmforge-QA`. The reconcile diverged because this
session's hand-built tip-pure lands (BL-1399/1395/1398/1388/1393/1382)
pushed straight to `origin/main` without merging back into `swarmforge-QA`
(the documented shape — see each ticket's own `land-escalate` evidence).

`git merge origin/main` resolved one real conflict cleanly
(`suite-manifest.tsv`, duplicate rows from parallel tip-pure lands) but was
then refused by `check_merge_deletion.sh` on two intake files
(`backlog/INTAKE-human-expedite-park-must-unhold-on-finish-1788436320924.md`,
`backlog/INTAKE-operator-question-1788557930426.md`) moved to
`backlog/archive/` by origin's own specifier commits. Both are genuine
moves (they reappear byte-identical under `backlog/archive/` in the same
merge), but the guard's `ticket_id_for_path` returns empty for them —
neither file's introducing commit subject carries a `BL-####` id — so
`[[ -n "$id" ]]` is false and the violation is unexemptable by naming any
ticket, exactly the defect **BL-1403** ("the merge-deletion guard never
reports a move and never refuses unexemptably (intake archive blocks
every merge-up)") already describes. Not re-attempting a workaround here —
BL-1403 is the fix, minted and paused.

Aborted the merge cleanly (`git merge --abort`); `swarmforge-QA` is back
at its last real commit, unaffected. This reconcile is a hygiene task, not
blocking any in-flight parcel — no parcel in this worktree's inbox needed
`origin/main`'s newer content to proceed. Deferring the reconcile until
BL-1403 lands.

By QA.
