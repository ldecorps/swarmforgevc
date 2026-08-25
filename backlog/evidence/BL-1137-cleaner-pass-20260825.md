# BL-1137 — cleaner pass — 20260825

- Tip-pure rebuild from `origin/main` + coder `5d72a40e0c` only
  (`dels_on_origin=0`).
- DRY: `git-add-or-commit-argv-for-root?` delegates to the cwd-aware
  process classifier; shared `git-add-or-commit-cmdline?` for regex gate.
- Kept `cwd-under-root?` (exact/`root/` prefix) rather than
  `project-scoped-process?` starts-with (sibling-prefix footgun).
- `master_checkout_drift_lib_test_runner.bb` +
  `bl1137_cwd_scoped_mute_property_runner.bb` green.

By cleaner.
