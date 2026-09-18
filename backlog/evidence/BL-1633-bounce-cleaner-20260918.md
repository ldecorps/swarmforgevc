# BL-1633 — send-back to coder, 2026-09-18 (cleaner)

## What happened

Two problems, both centered on `specs/features/BL-1620-two-unit-lane-poles-come-under-the-per-file-budget.feature`
and its handler.

### D1 — BL-1006 retirement never done (spec-gap, coder's own ticket work)

BL-1633's own ticket text (`backlog/active/BL-1633-...yaml`) requires, as
part of THIS parcel: "What is wanted" item 5 (BL-1006, the slice-boundary
rule) says BL-1620's `# BL-1620 two-unit-lane-poles-02` scenario block and
its five step registrations must be RETIRED (deleted, not reworded) in
this parcel, and BL-1620's narrative sentence about the row re-tensed to
the past. `constraints:` names "BL-1620's feature and handler (scenario 02
retirement and the narrative re-tense only - BL-1006)" as in scope. The
coder's commit (`6e796454f8`) touches neither
`specs/features/BL-1620-two-unit-lane-poles-come-under-the-per-file-budget.feature`
nor `specs/pipeline/steps/bl1620TwoUnitLanePolesSteps.js`, and the coder's
own evidence (`backlog/evidence/BL-1633-coder-20260918.md`) never mentions
BL-1620, BL-1006 or scenario 02 retirement at all - the requirement was
skipped, not addressed and found unnecessary.

Confirmed live: `backlog/suite-poles.tsv`'s telegramFrontDeskBotCli row IS
removed (this parcel's own work), but BL-1620's scenario 02
("the register row stays, re-owned, until the gate confirms a pole
alone") still asserts `backlog/suite-poles.tsv names the file under
BL-1633` and that the row survives - directly contradicted by this
parcel's own register edit. Running BL-1620's feature now fails.

### D2 — a second, unrelated fix never merged in (not this ticket's authorship, but blocks together with D1)

Merging main into this worktree also surfaced that this branch predates
`7e74a9e2eb` ("BL-1620: align the Background step regex with the
specifier's ticket-free wording") - a fix the hardener landed on BL-1620's
OWN branch, unrelated to BL-1633's authorship. Acceptance for
`specs/features/BL-1620-*.feature` on the current merged tree fails all
three scenarios with "no step handler matched 'Given the extension unit
lane with the BL-1598 pole register'" (the Background literal mismatch
this session's earlier BL-1620 bounces already chased twice). This one is
not a defect IN BL-1633's authored diff - the coder simply has not merged
main since that commit landed - but it means D1's retirement, whenever
done, must be done against a tree that already carries `7e74a9e2eb`, or
the retirement will not resolve the actual failure.

```
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1620-*.feature
error: Scenario "a pole file comes under budget with its tests intact": no step handler matched "Given the extension unit lane with the BL-1598 pole register"
(and scenarios 02 and 03, same Background)
```

## Why this bounces rather than gets fixed here

`specs/features/*.feature` and `specs/pipeline/steps/*.js` are Gherkin/
acceptance-handler maintenance, explicitly out of the cleaner's domain
(cleaner.prompt "Does Not Own: ... maintain acceptance tests, Gherkin,
IR..."); constraints name the step handler as landing with the feature,
the coder's file to change. D1 is squarely a missed requirement of this
parcel's own ticket text - the coder's to finish, not the cleaner's to
silently absorb.

## The fix (direction, not mandate)

1. Merge main (already carries `7e74a9e2eb`) so the Background regex
   agrees again.
2. Delete the `# BL-1620 two-unit-lane-poles-02` comment, `Scenario:`, and
   its `Given`/`And`/`When`/`Then` lines from
   `specs/features/BL-1620-two-unit-lane-poles-come-under-the-per-file-budget.feature`.
3. Delete the five corresponding `scoped(...)` registrations from
   `specs/pipeline/steps/bl1620TwoUnitLanePolesSteps.js` (the ones this
   session's own review previously read: the Background scoped block stays
   - only the scenario-02-specific ones go).
4. Re-tense BL-1620's narrative clause per the ticket's own "How": "that
   its register row stays, re-owned by BL-1633 (...)" becomes "that its
   register row stayed, re-owned by BL-1633, until BL-1633 retired it" (a
   re-tense, not a rewrite).
5. Re-run `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1620-*.feature`
   (expect 2 scenarios, 01 and 03 only) and
   `specs/features/BL-1633-*.feature` (unaffected, still 5/5) both green.

My own review of BL-1633's authored diff otherwise found nothing else to
raise - `check-suite-file-budget.ts`, `recordTestDuration.js`, their unit
tests and the new BL-1633 feature/handler are clean, scoped, and pass as
written (59/59 unit, BL-1633's own acceptance unaffected by this bounce).

Sending as a `git_handoff` to coder, priority 00, carrying this merge
commit, rather than a bare note, since real feature/handler work needs to
change.

By cleaner.
