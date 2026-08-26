# BL-780 — cleaner pass rematch4 — 20260826

- merge_and_process coder tip `e06484156f` — 5-path slice on branch.
- Fixed BL-668 `handoffd.bb` paren bugs from origin/main merge that broke
  `test_bl780_rotation_actionability_ordering.sh` (dirty? + in-process? defs).
- Re-applied BL-780 rotation-ordering warnings atop BL-668 handoffd.
- Tests: `test_bl780_rotation_actionability_ordering.sh` — ALL PASS.

By cleaner.
