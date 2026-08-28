# BL-1205 cleaner pass — 2026-08-28

Merged coder handoff `e7f0880e93` for BL-1205 (tree-collapse send-time
gate). Resolved `specs/pipeline/steps/index.js` (deduped the
`bl1195WorktreeTrackedContentDriftSteps` require already present, kept the
new `bl1205HandoffRefusesAMassDeletionForwardSteps` require) and
`backlog/topics/BL-428.json` (both sides byte-identical — no real
conflict, a line-ending artifact only).

## Review
`tree_collapse_guard_lib.bb`: clean, matches the precedent fail-open gate
shape (parcel_rollback_guard_lib.bb, BL-1213) — real `git merge-tree
--write-tree` simulation, no diff-based guessing, per-recipient
independent findings/warnings. No duplication or module-boundary issues.
`swarm_handoff.bb` wiring: consistent with the existing four-gate
chokepoint pattern, no changes needed.

`specs/pipeline/steps/bl1205HandoffRefusesAMassDeletionForwardSteps.js`:
255 mutation sites, over the 100 advisory threshold (BL-485). Same
legitimately-cohesive fixture+step-handler shape as
`bl1213ParcelRollbackGuardSteps.js`/`bl760DuplicateChainGuardSteps.js` it
explicitly follows — left whole.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `tree_collapse_guard_lib_test_runner.bb`: ALL PASS.
- `bl1205_tree_collapse_guard_property_runner.bb`: 2000 runs, ALL PROPERTIES HOLD.

By cleaner.
