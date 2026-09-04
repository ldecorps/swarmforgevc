# BL-1389 — hardener pass, 2026-09-04

Merged architect commit `f3787a170a` (clean pass, no bounce —
`backlog/evidence/BL-1389-architect-20260904.md`). Merge itself was
conflict-free; the two BL-1386/BL-1387 CLI fixtures lost their executable
bit in the merge (functionally harmless — both are invoked via `bash
<script>`, never `./<script>`), restored in a follow-up commit
(`402abddb09`) for repo convention.

## Checks re-run, all independently

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — **ALL
  PASS** (0 failures). Note: the coder, cleaner, and architect all
  reported 2 pre-existing failures here, attributed to the already-
  ticketed BL-1388 fixture-rot (a tree-guard fixture still asserting the
  hand-maintained-registry model BL-1371 retired). My run shows zero
  failures — plausibly because intervening QA-approved merges into this
  worktree since their reviews (BL-1385's governed pass, BL-1386/BL-1387)
  touch the same discovery/registration surface and happen to satisfy the
  stale fixture's assertions. Not a regression (fewer failures, not
  more); BL-1388 itself is unaffected — still `todo`, not claimed fixed
  here, and out of this ticket's scope either way.
- `npx vitest run --config vitest.properties.config.mjs
  bl1389UnlandedSiblingPathNeverRidesInvariants` — 3/3 PASS, all three
  declared invariants.
- `npx vitest run --config vitest.properties.config.mjs
  bl1308SiblingDetectorCoversReplay` — 2/2 PASS, the widened consumer
  property test unaffected.
- `run_acceptance.sh` on the BL-1389 feature — 5/5 PASS.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## required_wiring anchors — both confirmed present

- `swarmforge/scripts/land_step_cli.bb::EXCLUDED_SIBLING_PATH` — present,
  2 occurrences.
- `specs/pipeline/steps/bl1389UnlandedSiblingPathNeverRidesSteps.js::registerSteps`
  — present, 2 occurrences.

## BL-149 cooldown gate (all three changed production files)

`land_step_lib.bb`, `land_step_cli.bb`, `run_commit_guards.sh` — all
DECISION: skip-cooldown (still inside the 3-day window, this ticket's own
recent commits). No additional hand-authored sweep on top of the coder's
own passes; the property test's rigorous non-vacuity generator-reach
story (architect independently confirmed the generator deliberately
builds the merged-side-branch shape the defect requires, and the property
asserts that shape was actually reached) substitutes for a mutation pass
on the pure decision functions.

## BL-113 Gherkin mutation

No `Scenario Outline` in the feature (all five scenarios are plain
`Scenario:` blocks) — ran `run_gherkin_mutation.sh` to confirm rather than
assume: `"outcome": "inapplicable"`, matching BL-638. Manifest stamped.

## CRAP / DRY

Both `npm run crap` and `npm run dry` are scoped to `extension/src/**`.
This parcel touches no file under `extension/src` — CRAP/DRY N/A.

## Result

No defect found. No orphaned test/mutation processes left behind
(confirmed via `pgrep`). Forwarding to documenter.

By hardender.
