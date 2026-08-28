# BL-1214 cleaner re-verification (exit-code regression re-fix) — 2026-08-28

Merged coder's re-fix (`1f931ec0df`) for the architect's bounce (D1: an
ordinary fast-forward success — `:outcome :ff` — fell into the
bare-passthrough branch instead of `finish-ok`, so `post_hotfix_merge_origin.bb`'s
CLI reported failure/exit 1 for a plain successful FF, and `swarm_heal.bb`
reported `"ok?":null`. D2: a stale shell-test assertion in
`test_swarm_heal_push_before_reset.sh` §2 still expected the pre-BL-1214
discard-by-reset behavior for a case BL-1214 now merges-and-preserves).

## Review
D1's fix is a minimal, well-explained one-line change
(`(= (:outcome result) :merged)` → `(:success result)`), treating every
successful outcome uniformly rather than narrowly matching `:merged`. D2's
test update mirrors the equivalent assertion already established at the
handoffd.bb call site (`test_handoffd_master_main_reconcile_wiring.sh`
scenario 02) for the same invariant. No duplication or structural issues.

## Verification
- `post_hotfix_merge_origin_lib_test_runner.bb`: ALL TESTS PASSED.
- `test_swarm_heal_push_before_reset.sh`: ALL PASS (including the updated
  §2 divergence-preserving assertions).
- `test_handoffd_master_main_reconcile_wiring.sh`: ALL SCENARIOS PASS
  (regression check — unaffected by this fix).
- `master_main_reconcile_lib_test_runner.bb`: ALL TESTS PASS (regression
  check).
- BL-1214 acceptance feature via `run_acceptance.sh`: 3/3 pass.

By cleaner.
