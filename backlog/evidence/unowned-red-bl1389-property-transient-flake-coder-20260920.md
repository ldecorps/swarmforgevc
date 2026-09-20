# Unowned-red note — transient property-suite flake, 2026-09-20

While verifying BL-1650 (touches `swarmforge/scripts/land_step_lib.bb`,
`specs/features/BL-1650-...feature`, `specs/pipeline/steps/
bl1650LandStepPureEvidenceStraySteps.js`, `specs/pipeline/steps/
bl1546ClosedOwnerNeverSilentlyExcludesSteps.js`, and a new
`extension/test/bl1650LandStepPureEvidenceStrayInvariants.property.test.js`
— never `own-paths`, `origin-main-sha`, or any file BL-1389's own invariant
test touches), the full `npm run test:properties` run (from `extension/`)
failed 2/1261 tests, both in
`test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js`
("invariant 2: a sibling reads landed only when EVERY attributed path is
on origin/main"):

```
AssertionError: a sibling with 1 path(s) absent from origin/main read landed:
{"action":"escalate","reason":"land-step: origin/main could not be resolved",
 "ownPaths":[],"landed":[],"unlanded":[],"landedPaths":{},"excluded":[]}
```

`land-step: origin/main could not be resolved` is `land-plan`'s own
fail-closed answer when `origin-main-sha` cannot resolve a ref in the
fixture repo at the moment it is called — a transient git/process
condition in that fixture, not a decision this ticket's own code makes.

Re-ran `test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js`
alone immediately after: all 3 tests (including invariant 2) passed
cleanly, no failures — 0/1 reproduction outside the full concurrent
property-lane run. Same "green alone, red inside the full lane" shape as
the 2026-09-13 QA note
(`unowned-red-property-suite-transient-flakes-QA-20260913.md`) and this
session's own earlier bl1368/bl1142 sightings — consistent with host
contention under the full lane's own concurrency (this host runs the
whole swarm's pipeline concurrently), not a logic defect BL-1650
introduced.

No active/paused/hold ticket names this file
(`grep -rl bl1389UnlandedSiblingPathNeverRidesInvariants backlog/active
backlog/paused backlog/hold` empty); `backlog/standing-reds.tsv` has no
row for it either.

Classed flaky, not filed as a mint request — flagging for the specifier
to decide whether it warrants a register row. No action taken against
BL-1650 on account of this: BL-1650's own acceptance feature (6/6),
`land_step_lib_test_runner.bb`, the BL-1546 acceptance feature, the full
unit lane (635/635 files, 10818/10818 tests), and BL-1650's own new
property test file are all green, and the failing file's own code path
is untouched by this parcel's diff.

By coder.
