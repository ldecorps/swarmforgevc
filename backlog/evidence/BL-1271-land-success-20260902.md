# BL-1271 — LAND SUCCESS, 20260902

Coordinator note (priority 00, post-BL-1343 land): re-land BL-1056 (done,
`BL-1056-land-success-20260902.md`) + BL-1271, close. This covers BL-1271.

Follows `BL-1271-land-escalate-20260902.md` (QA-approved `0ea1c8cb3b`,
held off `main` behind the BL-1343 attribution-walk defect, now fixed and
landed).

## Same discipline as BL-1317/BL-1340/BL-1341/BL-1343/BL-1056

`land_step_cli.bb`'s replay could not be trusted for this land either
(BL-1332 still open). Hand-built the tip-pure commit instead, from
BL-1271's own pipeline commits (coder `ddb8f766d8`, cleaner `f9d4cba01d`,
architect `8d0c014466`, hardener `3d3d731a41`, documenter `fc7959ae96`,
QA bounce `991ec6ead8`, hardener repass `06b273043d`, documenter refix
`5fb0510c3b`), diffed net against `origin/main` rather than replaying each
bounce/revert step individually — the net diff to `dispatch_gap_test_runner.bb`
and the ticket YAML each verified free of unrelated ticket references.

The ticket's own `34cc4938b0` (coordinator's "decline the adjudication
re-record" note) was already an ancestor of `origin/main`, so not
re-carried.

## Verification (against the final tip-pure tree, before commit)

- Compile: clean.
- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb`: ALL PASS.
- Acceptance
  (`specs/features/BL-1271-dispatch-gap-suite-stale-bug-fixtures.feature`):
  3/3.
- Feature-handler registration confirmed
  (`specs/pipeline/steps/index.js` requires
  `./bl1271DispatchGapDefectOnlySteps`).
- Full diff against `origin/main` verified to match the intended 13-file
  own-paths list exactly before pushing.

## Landed

- Tip-pure commit `8fb128969a` pushed to `origin/main`
  (`ddd5cf07a9..8fb128969a`) — `origin/main` had not moved since branching,
  no rematch needed.
- `swarmforge-QA` merged up to `8fb128969a` at `aec4eb0e74`. No conflicts.
- `abandoned_commits: [0ea1c8cb3b]` recorded on the ticket YAML.

## Session summary — five held-off parcels cleared

This closes the chain that started with BL-1343's mint: BL-1338 (landed
earlier), BL-1317, BL-1340, BL-1341, BL-1343 itself, BL-1056, and BL-1271
are all now on `main`. BL-1332 (the mirror over-inclusion defect that made
`land_step_cli.bb`'s own replay untrustworthy for every one of these
lands) remains open and tracked — its own ticket, not re-reported here.

By QA.
