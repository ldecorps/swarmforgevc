# BL-1144 — cleaner pass — 20260825

- merge_and_process coder tip `47214d079e` (yaml modify/delete resolved).
- Fix `land_main_publish.sh`: use `bb -e` instead of `bb <<EOF` (was
  starting REPL, leaking `user=>` noise).
- Restored acceptance feature from `origin/main` for pre-QA gate.
- Tests: `master_main_reconcile_lib_test_runner.bb` ALL PASS; lock acquire
  smoke via APS paths. `dels_on_origin=0` for parcel.

By cleaner.
