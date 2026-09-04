# BL-1386 — CLEANER PASS (bounce rework), 2026-09-04

NONE. No defect found; no cleanup change made beyond the merge resolution
itself (recorded on the merge commit, `7f9671941a`).

## Merge entanglement (same shape as BL-1387's own merge)

Coder's D1 fix (`b21734aae3`) wires `open-merge-branch`'s `:own` case to a
new `:abort-owned-merge` branch, which requires BL-1387's
`classify-open-merge`/`open-merge-branch` machinery — coder built this on
top of BL-1387's `a51b4d68fe` before BL-1387's own (unrelated) D1 bounce
reached this branch. Resolved by taking coder's incoming version wholesale
for the four conflicted files, same reasoning as the earlier BL-1387 merge:
BL-1387's classify logic itself was never the defect that bounced it (a
missing second call site in `post_hotfix_merge_origin_lib.bb` was) — only
its own acceptance step handler stays correctly absent (bounced,
unaddressed by coder yet).

Resolved the modify/delete conflict on
`specs/pipeline/steps/lib/bl1387OrphanedMergeCli.sh` by keeping the
deletion — it is a fixture only `bl1387OrphanedMergeSurfacedSteps.js`
calls, and that file is correctly absent; keeping the modified fixture
without its only caller would be dead code.

## What was checked

- `master_main_reconcile_lib_test_runner.bb` — re-ran: ALL TESTS PASS.
- `master_main_reconcile_lib_property_runner.bb` — re-ran: ALL PROPERTIES
  HOLD, 500 runs (including the corrected per-class BL-1387 non-mutation
  property coder fixed — it previously would have passed the bounced D1
  code as correct).
- `test_handoffd_master_main_reconcile_wiring.sh` — re-ran: ALL SCENARIOS
  PASS, including the three new BL-1386 D1 wiring assertions.
- `mutation-site-count.js` on `bl1386ReconcileOwnsItsMergeSteps.js`: 178
  sites (`over` 100). Same reviewed-and-declined call as the original
  BL-1386 pass — one cohesive single-feature step handler, site count
  driven by assertion density.
- `jscpd` over the changed JS file: 0 clones.
- TypeScript compiles clean (`npx tsc --noEmit`).
- Discovery: `bl1386ReconcileOwnsItsMergeSteps.js` registers via BL-1371's
  registry; `bl1387OrphanedMergeSurfacedSteps.js` correctly does not
  (BL-1387 stays bounced).
- Ticket state: BL-1386 and BL-1387 both still `status: todo`,
  `assigned_to: coder` — unaffected by this merge, as expected (this
  parcel is BL-1386's rework, not a re-approval of either ticket).

BL-1386 bounce_count stays 1 (this is the rework responding to that bounce,
not a new one). Forwarding unchanged to architect.

By cleaner.
