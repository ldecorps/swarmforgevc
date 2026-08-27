# BL-1120 — coder rematch onto origin/main only — 20260825

QA bounce #2 (`0addcfeb9`): prior tips hitchhiked BL-1118/1123/534/695
lineages. Recreated on `origin/main` (`7e430470c`) with product only.

## Tip contents

- `master_main_reconcile_lib.bb` — `may-abort-failed-merge?` / `merge-attempt-plan` / `:human-merge-in-progress` surface
- `handoffd.bb` — skip when `MERGE_HEAD` present; abort only when this tick started the merge (BL-1123 integrity sweep retained)
- APS feature + steps + index registration
- property + lib test runners
- docs: new how-to + surgical index/Spec/891/mmd additions (no deletion of sibling how-tos)
- ticket + `abandoned_commits` for stacked prior tips

## Proof

- APS 2/2 green
- `master_main_reconcile_lib_test_runner.bb`: ALL TESTS PASS
- `bl1120_foreign_merge_abort_property_runner.bb`: ALL PROPERTIES HOLD
- `git diff --name-only origin/main...HEAD` = BL-1120-only paths

By coder.
