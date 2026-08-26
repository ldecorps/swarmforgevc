# BL-1130 cleaner pass — 2026-08-25

## Inbound

Coder tip `a3c4429c42` — hitchhike CLEAN vs `origin/main`. Fast-forward
onto `origin/main` = `8e512cf2fb`.

## Checks run

1. `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS
2. `post_hotfix_merge_origin_lib_test_runner.bb` — ALL TESTS PASSED
3. `bl1130_absorb_plan_property_runner.bb` — ALL TESTS PASSED
4. Gherkin — BL-1130 feature — 2/2

## Cleanup performed

- `surface-message`: one `refuse-absorb` string shared by `:conflict` and
  `:refuse-rematch`.
- `post_hotfix_merge_origin_lib`: `print-refuse-rematch!` + shared line so
  preflight refuse and finish-conflict do not duplicate the refuse message.

## Forward

`git_handoff` to architect, priority 50, task
`BL-1130-land-on-main-without-external-conflict-resolution`.

By cleaner.
