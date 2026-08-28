# BL-1214 hardener pass — 2026-08-28

Merged architect handoff `f6ca57dc3a` (2nd architect review, verifying
cleaner's re-fix of the ff-success exit-code regression D1). No conflicts.
Same batch also carried a QA merge-up note for BL-1219 (`b30643c5dd`),
merged first per the merge-up protocol (merge only, no forward — the chain
ended at QA for that ticket).

Diff scope for BL-1214 in this batch: `swarmforge/scripts/master_main_reconcile_lib.bb`
(the shared `absorb-with-merge!` ladder) already landed in an earlier
round this session; this round's own diff is `post_hotfix_merge_origin_lib.bb`
(the D1 exit-code fix) plus its test runner and the `swarm_heal` shell
test's D2 re-fix (stale divergence assertion corrected).

## Mutation approach

Pure Babashka/bash, no wired mutation/CRAP/DRY tool (Startup Tools:
"Babashka/Clojure... have NO mutation/CRAP/DRY wired"). Hardening below is
hand-authored mutation, matching the BL-638 fallback discipline, targeted
at the two things this ticket's two bounce rounds fixed.

## Hand-verified: D1 (ff-success exit-code fix) is non-vacuously covered

Reverted `run-post-hotfix-merge!`'s dispatch back to the pre-fix shape
(`(if (= (:outcome result) :merged) (finish-ok ...) result)`, i.e. only
`:merged` finishes ok, an ordinary `:ff` falls through to the bare
passthrough branch). Re-ran:

- `post_hotfix_merge_origin_lib_test_runner.bb`: **3 failures** (`success
  ok`, `success exit 0`, `deadlock cleared when behind 0`) — the exact
  regression class this fix closes.
- `test_swarm_heal_push_before_reset.sh` and the acceptance feature: both
  stayed green under this specific mutant (neither drives a genuine
  ordinary-fast-forward-through-`run-post-hotfix-merge!` case the way the
  unit runner does), which is fine — the unit runner is the layer that
  actually pins this fix, and it does so unambiguously.

Restored the real fix; `post_hotfix_merge_origin_lib_test_runner.bb`
returns to `ALL TESTS PASSED`.

## Hand-verified: the core "merge before reset" behavior is covered at three independent layers

Separately mutated the SHARED function itself
(`master_main_reconcile_lib.bb`'s `absorb-with-merge!`) to skip the real
3-way merge attempt entirely and fall straight to `fallback!` on any
failed fast-forward — i.e. reverted the ticket's whole point, simulating
"what if the merge step were silently removed". Re-ran the three
consumer-level test suites named in the ticket's own scope:

- `test_swarm_heal_push_before_reset.sh`: **FAILED** ("expected the
  local-only commit ... to STILL be reachable from main - a
  non-conflicting divergence must be merged, never discarded (BL-1214)").
- `test_handoffd_master_main_reconcile_wiring.sh`: **FAILED** ("expected
  the local-only bookkeeping commit ... to STAY reachable from ROOT's
  main, not be discarded").
- BL-1214 acceptance feature: **2 of 3 scenarios FAILED** ("merge! was
  never attempted").

All three catch the mutant independently, at the three different call
sites the ticket names (`swarm_heal.bb` via `post_hotfix_merge_origin_lib.bb`,
`handoffd.bb` directly, and the acceptance driver). Restored the real
function; all three suites return to green.

## Verification (real code, after both restores)

- `post_hotfix_merge_origin_lib_test_runner.bb`: ALL TESTS PASSED.
- `test_swarm_heal_push_before_reset.sh`: ALL PASS.
- `test_handoffd_master_main_reconcile_wiring.sh`: ALL SCENARIOS PASS.
- `bl1118_post_hotfix_merge_property_runner.bb`: ALL TESTS PASSED.
- BL-1214 acceptance feature, 3 consecutive runs: 3/3 pass every run.
- No conflicting-path regression: scenario "A conflicting two-way
  divergence still falls back to today's reset recovery" (the ticket's own
  explicit "must not weaken" constraint) passes in every run above.

## Cleanup

Restored both hand-mutated files to their exact pre-mutation content
(`git diff` empty on each) before moving to the next probe and before
finalizing. No orphaned processes, no leaked fixture directories (this
ticket's own tests clean up their own scratch git repos internally, none
observed left behind by `git status`/`ls /tmp` checks).

By hardener.
