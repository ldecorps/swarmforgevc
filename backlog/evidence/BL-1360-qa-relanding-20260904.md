# BL-1360 — QA re-verification and land, 2026-09-04

## Context

Resumed via coordinator `note` (priority `00`): "BL-1360 QA-approved
unlanded (0b46b44b12), coder declined re-route." Confirmed: `0b46b44b12`
is already an ancestor of this worktree's HEAD but not of `origin/main`.
Per `BL-1360-land-escalate-20260903.md`, it was blocked by the largest
instance of the shared-`index.js`-registry deadlock this session recorded
(9 missing sibling handler files: BL-1296, BL-1309, BL-1356, BL-1359,
BL-1367, BL-1374, BL-1376, BL-1377, BL-1378). Every one of those 9 has
now landed: BL-1296/BL-1309/BL-1356/BL-1359 by QA earlier this session;
BL-1374/BL-1376/BL-1377/BL-1378 likewise; BL-1367 remains — checked
separately below. BL-1371 (directory discovery) also removed the shared-
file coupling mechanism itself.

## Re-verification

BL-1360's own code has not changed since its QA approval; re-ran rather
than trusted:

- `npm run compile` — clean.
- `bb swarmforge/scripts/test/ceremony_handoff_lib_test_runner.bb` — ALL
  PASS.
- `bash swarmforge/scripts/test/test_ceremony_handoff_cli.sh` — 6/6 PASS.
- `bb swarmforge/scripts/test/bl1360_ceremony_handoff_property_runner.bb`
  — ALL PROPERTIES HOLD (500 pure runs).
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1360-a-ceremony-handoff-is-composed-not-retyped.feature`
  — 6/6 pass, matching the original QA approval's evidence.
- Wiring: `bl1360CeremonyHandoffComposedSteps.js` exports `registerSteps`
  (line 210); no `index.js` mention needed under discovery.
- Process hygiene: no orphaned test/mutation processes before or after.
- `human_approval: approved`, no `ruling_options` — a plain approval.

## Landing

`bb swarmforge/scripts/land_step_cli.bb
BL-1360-a-ceremony-handoff-is-composed-not-retyped <HEAD>`, with
`origin/main` freshly fetched and merged into this worktree first (per
BL-1359's own lesson this session — a stale comparison base can produce a
false "nothing to commit"). Full accounting in
`BL-1360-land-success-20260904.md`.

By QA.
