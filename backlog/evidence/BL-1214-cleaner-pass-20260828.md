# BL-1214 cleaner pass — 2026-08-28

Merged coder handoff `6b08f29d29` for BL-1214 (`:ff-absorb` tries a real
3-way merge before resetting local `main` away, absorbing a non-conflicting
two-way divergence losslessly). Clean merge, no conflicts.

## Review
`absorb-with-merge!` (master_main_reconcile_lib.bb) is a small, well-
documented orchestration function (ff -> real merge -> fallback), matching
the existing `rematch-with-push-first!` shape in the same file. All three
call sites (handoffd.bb, swarm_heal.bb, post_hotfix_merge_origin_lib.bb)
wire it via the same adapters pattern already used throughout this file;
`merge3!` is nil-safe/optional in `post_hotfix_merge_origin_lib.bb` so a
caller not yet wired for BL-1214 keeps prior behavior — good backward-
compat discipline. No duplication, no structural issues.

## Verification
- `master_main_reconcile_lib_test_runner.bb`: ALL TESTS PASS.
- `test_handoffd_master_main_reconcile_wiring.sh`: all 16 scenarios PASS.
- Acceptance (`BL-1214-reconcile-absorbs-non-conflicting-two-way-divergence-with-a-real-merge.feature`
  via `run_acceptance.sh`): 3/3 pass.
- `bl1214AbsorbWithMergeSteps.js` fixture: has `finally`-guarded cleanup;
  0 leaked `/tmp/bl1214-*` directories after the run.
- `tsc --noEmit`: clean (no TS files touched by this ticket, checked for
  regression only).

By cleaner.
