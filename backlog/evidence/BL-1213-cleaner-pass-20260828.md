# BL-1213 cleaner pass — 2026-08-28

Merged coder handoff `eb7ac64e88` for BL-1213 (parcel-rollback send-time
gate). Resolved conflicts in `specs/pipeline/steps/index.js` (deduped
`bl718BubbleTalkMirrorSteps`/`bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps`/
`bl1195WorktreeTrackedContentDriftSteps` requires already present earlier
in the file, added the new `bl1213ParcelRollbackGuardSteps` require) and
`backlog/done/BL-1195-....yaml` (both bounce_history entries are real,
distinct events — kept both, chronological order).

## Cleanup
`parcel_rollback_guard_lib.bb`'s `findings-for-git-handoff` had two
branches producing a byte-identical warning string (one for an unresolvable
`parcel-full-sha`, one for unresolvable `changed-paths`). Collapsed into a
single `delay`d warning computation referenced from both fail-open paths.
Behavior-preserving: re-ran `parcel_rollback_guard_lib_test_runner.bb` and
`bl1213_parcel_rollback_guard_property_runner.bb` (2000 runs) after the
change — both green, unchanged from pre-edit.

## Verification
- `tsc --noEmit`: clean.
- `npm run compile`: clean.
- `parcel_rollback_guard_lib_test_runner.bb`: ALL PASS.
- `bl1213_parcel_rollback_guard_property_runner.bb`: 2000 runs, ALL PROPERTIES HOLD.
- `vitest run residentPaneLive residentPaneSpy`: 43/43 pass (BL-1189 merge-up
  content from the prior batch item, re-verified still green).
- `mutation-site-count.js specs/pipeline/steps/bl1213ParcelRollbackGuardSteps.js`:
  307 sites, `over` the 100 advisory threshold. Reviewed: this is one
  cohesive feature's fixture+step-handler file, same shape as the precedent
  `bl760DuplicateChainGuardSteps.js` it explicitly follows. A split would
  separate fixture-building from step-registration without improving
  structure or separation of concerns — left whole per BL-485's own
  guidance for a legitimately-cohesive module.

No architecture, DRY, or module-boundary issues found in the coder's new
`.bb`/step-handler code beyond the one collapsed duplication above.

By cleaner.
