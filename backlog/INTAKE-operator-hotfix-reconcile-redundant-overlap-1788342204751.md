# Intake: operator hotfix landed - reconcile now auto-resolves an identical-content dirty overlap

Filed by the Operator (2026-09-02, human-directed via Claude Code). This is a
NOTICE plus a BL-848 stamp-off request, not a spec: the specifier drains this
like any other backlog-root item.

## What landed on main (already live in the restarted handoffd)

- `d5739d84cc` - master_main_reconcile_lib: `blocking-overlap` + an optional
  `:redundant-paths!` adapter threaded through `sweep!` (pure decision logic).
- `f57795b6d2` - handoffd.bb wiring: `master-main-reconcile-redundant-paths!`
  (READ-ONLY proof: working-tree blob hash == `origin/main:<path>`) and
  `master-main-reconcile-drop-redundant-dirty-paths!` (the ONE drop site,
  recomputed fresh inside the `:merge!` adapter right before the real merge).
  Trailer `Hotfix-Certification: pending`; both rows are in
  `backlog/hotfix-ledger.yaml` (`state: pending`, no stamp ticket yet).

## Why

2026-09-02 ~06:30-08:47Z: ten paths staged in the master checkout (six
BL-1311 evidence files + four sources), every one byte-identical to
origin/main, held the reconcile at ahead=10/behind=10 `reason=dirty` for
hours. BL-919's path-overlap gate is correct for real uncommitted work but a
false block for a stale pre-land duplicate. `git merge` itself refuses ANY
dirty overlap regardless of content equality (verified in a scratch clone),
so the daemon now proves each overlapping path redundant and drops ONLY
those; anything unproven still blocks exactly as before.

## Evidence (TDD, isolated worktree, RED then GREEN)

- master_main_reconcile_lib_test_runner.bb: ALL TESTS PASS (+21; RED against
  the pre-hotfix lib: `Unable to resolve symbol: blocking-overlap`).
- master_main_reconcile_lib_property_runner.bb: 500 runs, ALL PROPERTIES
  HOLD, new invariant + two non-vacuity mutants (ignores-proof,
  trusts-everything).
- test_handoffd_master_main_reconcile_wiring.sh: 0 FAIL, new real-git
  scenario B2 (unstaged-M + staged-A identical overlap reconciles; unrelated
  dirt untouched; local history intact). RED before wiring.
- test_handoffd_push_sweep_wiring.sh 0 FAIL; babysitterd_sweep_lib_test_runner ok.

## Asks

1. Specifier: mint the BL-848 stamp-off review ticket for `f57795b6d2`
   (covering `d5739d84cc` as its first half) and `--link` both ledger rows.
   Grep the SHAs across backlog/ first - do not double-mint.
2. Worker worktrees need no hand-port: `sweep!` has one caller (handoffd.bb,
   master checkout); roles pick the change up on their normal merge of main.

By operator.
