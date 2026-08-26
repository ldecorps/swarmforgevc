# BL-568 — cleaner pass — 20260825

- Tip-pure rebuild from `origin/main` + coder `90780bbf1f` only
  (`dels_on_origin=0`).
- DRY in `chase_sweep_lib.bb`: menu chrome / option chrome / question-line
  predicates; named nav/footer regexes; drop unused `opt-set`.
- Restored BL-955 / BL-607 steer comments around the BL-568 menu-block gate.
- `bl568_menu_blocked_test_runner.bb` green.
- Commit used `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` once (BL-1124
  recovery on this host — property suite mutates shared checkout).

By cleaner.
