# BL-1120 cleaner rematch — onto origin/main — 2026-08-25

## Inbound

Coder tip `f413784762` — hitchhike CLEAN. Rematched onto current
`origin/main` = `4633d9bf42` (includes BL-1081). Spec conflict resolved:
BL-1120 Last Updated, BL-1081 prior.

## Checks run

1. Hitchhike gate — CLEAN
2. `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS
3. `bl1120_foreign_merge_abort_property_runner.bb` — ALL PROPERTIES HOLD
4. Gherkin — BL-1120 feature — 2/2

## Cleanup performed

NONE — pure helpers (`may-abort-failed-merge?`, `merge-attempt-plan`) already
extracted; handoffd merge path stays thin (CC ≤ 6).

## Forward

`git_handoff` to architect, priority 00, task
`BL-1120-handoffd-must-not-abort-foreign-merge`.

By cleaner.
