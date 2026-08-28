# BL-1214 — architect pass (2nd review, re-fix), 2026-08-28

Commit reviewed: 740c6e895a (cleaner, verifying coder re-fix 1f931ec0df).

## D1 (ff-success exit-code regression) — fixed
`run-post-hotfix-merge!`'s `:ff-absorb` dispatch changed from matching only
`:outcome :merged` to `(if (:success result) (finish-ok ... (:outcome result)) result)`
— every successful outcome (`:ff` and `:merged` alike) now runs `finish-ok`
uniformly. The pre-existing test's own stale assertion (`:outcome :merged`
for a plain fast-forward, which has always actually been `:ff`) was also
corrected in the same commit.

## D2 (stale swarm_heal divergence test) — fixed
`test_swarm_heal_push_before_reset.sh` §2 rewritten to assert the correct
BL-1214 behaviour for a genuine non-conflicting divergence: both the
origin-landed and local-only commits reachable, tip a 2-parent merge
commit — mirroring `test_handoffd_master_main_reconcile_wiring.sh`
scenario 02's assertions for the identical invariant at the other call
site.

## Verification (all green)
- `post_hotfix_merge_origin_lib_test_runner.bb`: ALL TESTS PASSED.
- `test_swarm_heal_push_before_reset.sh`: ALL PASS (§2 rewritten).
- `test_handoffd_master_main_reconcile_wiring.sh`: ALL SCENARIOS PASS (no regression).
- `bl1118_post_hotfix_merge_property_runner.bb`: ALL TESTS PASSED (no regression).
- BL-1214 acceptance feature: 3/3 pass.

No new architecture concerns; no TypeScript touched (dependency gate N/A).

NONE outstanding. Forwarding to hardener.

By architect.
