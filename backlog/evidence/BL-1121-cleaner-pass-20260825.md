# BL-1121 cleaner pass — 2026-08-25

## Inbound

Coder tip `54d964aec5` — hitchhike CLEAN. Rematched **1121-only** onto
`origin/main` = `4d4349b04` (BL-1122 QA tip).

## Checks run

1. Gherkin — BL-1121 feature — 3/3
2. `bl1121_reconcile_import_property_runner.bb` — ALL PROPERTIES HOLD
3. `test_property_suite_drift_guard.sh` — ALL PASS (incl. 08–10)
4. `test_commit_size_guard.sh` / `test_ticket_deletion_guard.sh` — ALL PASS
   (fixtures now install `incoming_merge_parent_lib.sh`)

Note: `test_pipeline_code_on_main_guard.sh` BL-925 invariant-2 grep against
`handoffd.bb` fails on `origin/main` already (matches unrelated
`"merge-base" "--is-ancestor"` for origin/main tracking). Not introduced by
this tip; not fixed here.

## Cleanup performed

- Extract `incoming_merge_parent_lib.sh` (`resolve_incoming_merge_parent`)
  shared by `check_property_suite_drift.sh` and `check_pipeline_code_on_main.sh`
  so the MERGE_HEAD / lone-GITHEAD_ contract cannot drift.
- Hook fixtures that copy the property/pipeline guards also copy the new lib
  (and `property_suite_shared_repo_guard.sh` where missing).

## Forward

`git_handoff` to architect, priority 50, task
`BL-1121-reconcile-import-skips-property-suite-guard`.

By cleaner.
