# BL-1387 — CLEANER PASS (bounce rework), 2026-09-04

NONE. No defect found; no cleanup change made beyond the merge resolution
itself (recorded on the merge commit, `da88749399`).

## What changed and why it matters

Coder's rework (`0e31d40b55`) fixes the architect's D1 (a second bare-presence
`human-merge-in-progress` site in `post_hotfix_merge_origin_lib.bb`), and in
driving that fix end to end, found and fixed a more severe pre-existing
defect: `absorb-dispatch-plan`'s `cond` propagated only
`:skip-human-merge-in-progress`, so `:skip-orphaned-merge` and
`:abort-owned-merge` fell through to `:ff-absorb` — a MUTATING plan on a
checkout with an open `MERGE_HEAD`. `handoffd.bb` dispatches through that
function, so BOTH BL-1386's abort-by-ownership and BL-1387's orphan
classification were unreachable from the live daemon despite passing their
own acceptance fixtures (which called the inner `automated-absorb-plan`
directly — same fixture-vs-production gap the first bounce was about).
Now pinned by a test asserting no open merge reaches a mutating plan under
any class.

## Conflict resolution

- Modify/delete on `specs/pipeline/steps/lib/bl1387OrphanedMergeCli.sh`:
  restored — its only caller, `bl1387OrphanedMergeSurfacedSteps.js`, is
  back with this rework.
- Content conflict on
  `swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb`: purely
  additive on the incoming side (new `absorb-dispatch-plan` propagation
  rows), no removal on either side — kept both.
- `master_main_reconcile_lib.bb` auto-merged clean.

## What was checked

- `master_main_reconcile_lib_test_runner.bb` — re-ran: ALL TESTS PASS.
- `master_main_reconcile_lib_property_runner.bb` — re-ran: ALL PROPERTIES
  HOLD, 500 runs.
- `post_hotfix_merge_origin_lib_test_runner.bb` — re-ran: ALL TESTS PASSED,
  including the new end-to-end dispatch rows.
- `bl1118_post_hotfix_merge_property_runner.bb` — re-ran: ALL TESTS PASSED.
- `bl1120_foreign_merge_abort_property_runner.bb` — re-ran: ALL PROPERTIES
  HOLD.
- `test_handoffd_master_main_reconcile_wiring.sh` — re-ran: ALL SCENARIOS
  PASS.
- `mutation-site-count.js` on `bl1387OrphanedMergeSurfacedSteps.js`: 125
  sites (`over` 100). Same reviewed-and-declined call as the original
  BL-1387 pass — one cohesive single-feature step handler.
- `jscpd` over the changed files (JS handler + the four touched `.bb`
  files): 0 clones.
- TypeScript compiles clean; both `bl1386ReconcileOwnsItsMergeSteps.js` and
  `bl1387OrphanedMergeSurfacedSteps.js` now discover via BL-1371's registry.
- Coder's own caller enumeration (`grep -rln
  'absorb-dispatch-plan|post-land-absorb-plan|automated-absorb-plan|merge-attempt-plan'`
  and a second grep for bare `human-merge-in-progress`) re-run: matches the
  evidence file's claim — no bare-presence assertion remains in any of the
  three files that dispatch on an open merge.

Forwarding unchanged to architect.

By cleaner.
