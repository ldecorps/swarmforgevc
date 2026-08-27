# BL-1131 cleaner pass — 2026-08-25

## Inbound

Coder tip `2373091b76` — hitchhike CLEAN. Rematched **1131-only** onto
`origin/main` = `4d4349b044`.

## Checks run

1. Gherkin — BL-1131 feature — 4/4
2. `bl1131_ticket_land_property_runner.bb` — ALL PROPERTIES HOLD
3. `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS
4. `post_hotfix_merge_origin_lib_test_runner.bb` — ALL TESTS PASSED

## Cleanup performed

- Extract `absorb-dispatch-plan` in `master_main_reconcile_lib.bb` so
  `handoffd` and `post_hotfix_merge_origin_lib` share one BL-1130+1131
  absorb decision order (noop / replay / refuse / ff-absorb).

## Forward

`git_handoff` to architect, priority 50, task
`BL-1131-ticket-land-without-operator-absorb-merge`.

By cleaner.
