# BL-1401 — hardener pass, 2026-09-05

Merged architect commit `b4dfa8925a` (COMPLIANT, clean sweep — all three
invariants verified directly in the live handler diff, the previously-red
BL-632 acceptance confirmed fixed at 11/11 —
`backlog/evidence/BL-1401-architect-20260905.md`). This ticket is the
acceptance-fixture counterpart to BL-1398's property-test fixture fix,
consuming the same `deriveCommitGuardFixtureSet()` helper (already
hand-mutation-tested in my own BL-1398 hardening pass this session) —
depends_on: [BL-1398] correctly sequenced.

## Checks re-run, all independently

- `test_bl1401_acceptance_fixture_derives_set.sh` — 6/6 ALL PASS: the
  real BL-632 feature passes every scenario against the real runner, the
  acceptance handler consumes BL-1398's helper (no second parse), a guard
  added to the runner appears in the fixture's set with no handler edit
  and the guard chain runs it, a guard the runner names but the tree
  lacks fails the build naming it.
- `run_acceptance.sh` on the BL-632 feature — **11/11 pass**, confirming
  the red this ticket exists to close (previously 4 pass / 7 fail on
  `main`, matching the architect's own earlier BL-1398 review finding) is
  genuinely fixed.
- `run_acceptance.sh` on the BL-1401 feature — 3/3 pass.
- `npm run compile` clean, then
  `bl1401AcceptanceFixtureDerivedSet.property.test.js` — 2/2 pass.
- `check_feature_handler_registration.sh` — rc 0.
- `jscpd` over the three changed/new JS files (correct pattern flag,
  since the default invocation silently analysed 0 files from this cwd)
  — 3 files analysed, 0 clones.
- required_wiring anchors grepped directly:
  `deriveCommitGuardFixtureSet` imported and called at
  `bl632CommitTimeGuardSteps.js:42/81`; `registerSteps` exported from
  `bl1401AcceptanceFixtureDerivesItsSetSteps.js:60/110`.

## No production code in this ticket's own scope — mutation N/A

No `.bb`/`.sh` file in this ticket's diff — it consumes
`extension/test/helpers/commitGuardFixtureSet.js`'s
`deriveCommitGuardFixtureSet()`, whose safety-critical
throw-on-missing-guard branch I already hand-mutation-tested and
confirmed killed in my own BL-1398 hardening pass this session
(`backlog/evidence/BL-1398-hardener-pass-20260904.md`). Nothing new to
mutate here; this parcel is a consumer, not a re-implementation.

## BL-113 Gherkin mutation

`grep -c "Scenario Outline"` on the feature: 0 — inapplicable per BL-638.

## CRAP / DRY

No `extension/src` file in this ticket's own diff — N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes. Clean working tree.

## Result

The BL-632 acceptance fixture now derives its guard set from the runner
exactly as BL-1398's property-test fixture does, closing the last
hand-listed guard array this session's BL-973/BL-1279-class staleness
sweep found. All checks and both required_wiring anchors re-verified
independently. Forwarding to documenter.

By hardener.
