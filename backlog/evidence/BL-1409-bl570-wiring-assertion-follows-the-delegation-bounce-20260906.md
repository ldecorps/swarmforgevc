# BL-1409 — QA bounce, 2026-09-06

1. **Failing command**: `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1409-bl570-wiring-assertion-follows-the-delegation.feature`
2. **Commit hash**: f51abbff77 (the documenter's forward; QA's own review commits since are 2f0e51c9f9 / c6e5928a4e)
3. **First error excerpt**:
   ```
   FAIL: 11: all-allowlisted reds must allow, got 1: property-suite-guard: run
    FAIL  test/bl632CommitTimeGuardInvariants.property.test.js > x
   property-suite-guard: test/bl632CommitTimeGuardInvariants.property.test.js still fails when run alone
   Commit rejected: property suite failed with non-allowlisted files:
   test/bl632CommitTimeGuardInvariants.property.test.js
   ```
4. **Failure class**: spec-gap
5. **Expected vs observed**: Scenario 04 asserted the whole drift-guard shell
   suite exits 0 ("every case passes"); observed the suite correctly running
   past case 07 (this ticket's own fix, verified working) and then failing at
   case 11 — a separate, already-ticketed red (BL-1448, `depends_on:
   [BL-1409]`, hidden behind case 07 since mint on 2026-09-05) that cannot be
   already-fixed when this ticket lands. The scenario was wrong at mint, not
   falsified later.

**Blamed role**: specifier (the mint did not know case 11 existed;
`backlog/evidence/BL-1409-spec-amendment-scenario-04-20260906.md` records the
amendment). **Remediation pointer**: replace scenario 04 in
`specs/features/BL-1409-bl570-wiring-assertion-follows-the-delegation.feature`
with the text in that amendment file (asserts `PASS: 07`..`PASS: 10`, not
`rc == 0`), update the matching step handler in
`specs/pipeline/steps/bl1409Bl570WiringFollowsTheDelegationSteps.js`, and
qa_e2e_procedure item 2 to match.

Routed to the coder per the specifier's own amendment note (the parcel is at
QA; the feature is not edited on main while a parcel past the coder carries
its own copy, so the bounce carries the replacement text into the parcel).
Not a workmanship fault of any prior stage — the parcel was built correctly
against the contract as minted; recorded as a misattributed-bounce correction
alongside this bounce per BL-990.

## record-bounce.js revertCheck (false positive, BL-1188 precedent)

`record-bounce.js`'s own output flagged `"verdict": "violation"` with remedy
`git revert --no-edit 6f5f21f988`, naming this evidence file itself as the
only "live" file. NOT acted on: that commit's sole content is this
brand-new evidence file, never part of any prior bounce-revert; the
BL-490/BL-495 revert duty is for undoing a role's own defective commit
before bouncing, and there is none here — the wrong scenario 04 text
predates every pipeline role's own work (present since mint). Same
tooling-accuracy gap already documented in
`backlog/evidence/BL-1188-record-bounce-false-positive-on-recovery-20260827.md`;
not re-flagged as a new note per the one-escalation-per-structural-cause
discipline.

By QA.
