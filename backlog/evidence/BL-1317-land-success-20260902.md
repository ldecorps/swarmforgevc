# BL-1317 — LAND SUCCESS, 20260902 (second hand-land attempt)

Follows `BL-1317-land-escalate-20260902.md` (first attempt escalated: an
undiagnosed real dependency broke acceptance 2/3 on the tip-pure replay) and
the specifier's adjudication (main commit `9d8b7fdda4`): the missing
dependency is BL-1317's own `swarmforge/scripts/ready_for_next_task.bb` —
touched in round 1 (`d744e50110`, `59a8c3eca2`) but never re-touched in
round 2, so it fell off the diff-stat scan used to build the first
attempt's carried-paths list.

## What changed in this attempt

Rebuilt the tip-pure commit from `origin/main`, carrying the same own-paths
as before PLUS `swarmforge/scripts/ready_for_next_task.bb`. Two more gaps
surfaced and were fixed during verification:

1. `specs/pipeline/steps/index.js` — checking out the whole `swarmforge-QA`
   copy would have re-introduced other unlanded tickets' require lines
   (BL-1056, BL-1271). Instead, added only BL-1317's own
   `require('./bl1317AdaptEffortSteps')` line to `origin/main`'s copy.
2. `docs/index.md` — the documenter's how-to page
   (`docs/how-to/BL-1317-adapt-tier-effort-from-outcome-signals.md`) had no
   link into `docs/index.md`, caught by
   `test/docsStructureRealTree.test.js`'s real-tree orphan scan. Added the
   link.

## Verification (full re-run against the tip-pure tree)

- Compile (`npm run compile`): clean.
- Unit suite (`npm test`, `extension/`): 25 files failing before the
  `docs/index.md` fix (one extra: `docsStructureRealTree`), 14 files / 25
  tests failing after — the same pre-existing standing-debt population
  named in `BL-1317-qa-approval-20260902.md` (landPilotedTicket /
  `checkOrphanedAuthoredDocs` family, `constitutionDocCitations`, several
  real-tree scanners). None reference BL-1317, `seat_difficulty_lib`,
  `handoff_lib`, `ready_for_next_task`, or `done_with_current_task`.
- Property suite (`npm run test:properties`): 24 files / 13 tests red, same
  pre-existing population; BL-1317's own
  `bl1317AdaptEffortInvariants.property.test.js` — 4/4 green.
- Effort-ladder cross-language parity
  (`swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh`): 5/5 PASS.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1317-adapt-tier-effort-from-outcome-signals.feature`):
  **3/3 PASS** — the scenario that failed 2/3 in the first attempt ("a clean
  streak may drop one notch but not below the claim-time baseline") now
  passes with `ready_for_next_task.bb` correctly carried.
- Orphaned test processes: reaped a leftover vitest process group after the
  property-suite run before proceeding, per the QA orphan check.

## Pre-commit guard override

The pre-commit `check_property_suite_drift.sh` guard flagged
`test/bl1277StepCollisionInvariants.property.test.js` and
`test/bl800StepRegistryScopingConsistency.property.test.js` as
non-allowlisted. Both fail with "Cannot find module
'./bl1056PriceValidityWindowSteps'" — an unrelated unlanded sibling
ticket's step file, absent because this commit is built from `origin/main`
(not `swarmforge-QA`), not a defect in this commit's diff. Committed with
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` per the documented recovery-only
override (BL-1234 class of guard bug — matcher misbehaves on a real,
independently-verified property run).

## Landed

- Tip-pure commit `e1997daa29` pushed directly to `origin/main`
  (`7c0ace640e..e1997daa29`), after a bounded rematch: `origin/main` had
  advanced by 5 unrelated commits (BL-1348/BL-1349 minting) between the
  first `--decide-only` check and the push; diffed clean of any BL-1317
  file overlap, cherry-picked (`-x`) onto the new tip, re-verified content
  identical, pushed.
- `swarmforge-QA` merged up to `e1997daa29` at `5a7162d47b`. One real merge
  conflict, in `specs/pipeline/steps/index.js`: purely additive on both
  sides (BL-1317's require line present on both, BL-1271's require line
  only on the QA side) — kept both.
- `abandoned_commits: [00e76c46b1]` should be recorded on the ticket YAML
  per BL-1241's replay discipline (the originally QA-approved commit is
  superseded by this tip-pure replay).

By QA.
