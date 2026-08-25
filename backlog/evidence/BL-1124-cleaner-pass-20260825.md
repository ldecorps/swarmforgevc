# BL-1124 — cleaner pass — 20260825

- Tip-pure cherry-pick coder `1d061adfd9` onto `origin/main` only
  (`dels_on_origin=0`). Canary spawn paths unset
  `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD` so acceptance exercises the real
  guard.
- `bash property_suite_shared_repo_guard_test_runner.sh` — ALL PASS.

By cleaner.
