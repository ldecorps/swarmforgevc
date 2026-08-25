# BL-1140 — cleaner pass — 20260825

- Tip-pure rebuild from `origin/main` + coder `71475eb555` only
  (`dels_on_origin=0`).
- Moved BL-1140 assertions in `model_steward_test_runner.bb` **above** the
  report/exit gate so failures cannot print ALL PASS and still exit 0.
- DRY: bake-off ingest reuses `bl1127-coder-battery-eligibility`; pack align
  binds steward id once; revoked-tag check drops redundant `str`.
- `bb swarmforge/scripts/test/model_steward_test_runner.bb` — ALL PASS.

By cleaner.
