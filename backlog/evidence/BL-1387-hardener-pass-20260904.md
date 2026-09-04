# BL-1387 — hardener pass, 2026-09-04

Merged architect commit `101baae27b` (D1+D2 both fixed and re-verified —
`backlog/evidence/BL-1387-architect-pass3-20260904.md`). Independently
re-ran every gate rather than trusting the evidence trail. An add/add
conflict in `bl1387OrphanedMergeSurfacedSteps.js` resolved by taking the
incoming side's D2 step handlers (my side was empty at that point in the
file — see the merge commit).

## Checks re-run, all independently

- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` —
  ALL TESTS PASS.
- `bb swarmforge/scripts/test/post_hotfix_merge_origin_lib_test_runner.bb`
  — ALL TESTS PASSED.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
  — ALL PROPERTIES HOLD, 500 runs. BL-1387's own 8-cell owner-signal
  generator-reach line confirmed, plus the explicit non-vacuity line "the
  old presence-only reading yields :live-human with no owner signal, which
  invariant 1 rejects".
- `bash swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
  — ALL SCENARIOS PASS (ran >120s, detached via the standing 2m-ceiling
  workaround, collected from its own completion marker).
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1387 feature —
  8/8 PASS, including scenario 06 (the D2 fix: an owned merge classifies
  as the daemon's own, neither human nor orphaned).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## required_wiring anchors — all three confirmed present

- `swarmforge/scripts/handoffd.bb::orphaned-merge` — present
  (`master-main-orphaned-merge-escalation`, the `:orphaned-merge`
  outcome/error keys at the dispatch site).
- `swarmforge/scripts/master_main_reconcile_lib.bb::orphaned-merge` —
  present (`orphaned-merge-message`, `orphaned-merge-escalation`,
  `:skip-orphaned-merge` in `open-merge-branch` and
  `absorb-dispatch-plan`'s propagation set).
- `specs/pipeline/steps/bl1387OrphanedMergeSurfacedSteps.js::registerSteps`
  — present, 2 occurrences.

## BL-149 cooldown gate (BL-1387's own changed production files)

`handoffd.bb`, `master_main_reconcile_lib.bb`,
`post_hotfix_merge_origin.bb`, `post_hotfix_merge_origin_lib.bb` — all
DECISION: skip-cooldown (still inside the 3-day window, this ticket's and
BL-1386's own recent commits). No additional hand-authored sweep on top of
what the coder/architect already ran across two bounce cycles this pass;
the property runner's per-invariant non-vacuity proofs (500 runs) cover
the pure-lib decision functions the daemon adapters call, matching the
Babashka-degraded-fallback direction this ticket's siblings already
established.

## BL-113 Gherkin mutation (both Scenario Outlines in the feature)

Ran `run_gherkin_mutation.sh` soft over the BL-1387 feature against
`specs/pipeline/steps/index.js` (discovery registry). 6/6 mutants killed
(2+4), 0 survived, 0 errors. Manifest stamped.

## CRAP / DRY

Both `npm run crap` and `npm run dry` are scoped to `extension/src/**`.
This parcel touches no file under `extension/src` — CRAP/DRY N/A.

## Result

No defect found. No orphaned test/mutation processes left behind
(confirmed via `pgrep`). Forwarding to documenter.

By hardender.
