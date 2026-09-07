# BL-1349 — cleaner send-back, 2026-09-06

Received: architect bounce (`330aaba6b6` / revert `7d5a9e5c96`) —
"no-deletion check compares HEAD to itself, vacuous."

## Why this is not a cleaner fix

The defect (D1, architect's evidence
`backlog/evidence/BL-1349-architect-bounce-20260906.md`) is in
`specs/pipeline/steps/bl1349SpawnHeavyPropertyBudgetSteps.js`, an
acceptance step handler authored in coder's commit `7f0e5766c9`
("BL-1349: fit three spawn-heavy property files to a 15s budget"). Per
this role's constitution ("Does Not Own"): cleaner does not create, run,
or maintain acceptance tests, Gherkin, IR, or their step handlers. The
`no-property-is-dropped-02` scenario's "before" reference needs to resolve
against the actual parent commit (e.g. `7f0e5766c9^`, or a recorded base
SHA) rather than bare `HEAD`, which is an acceptance-authoring decision,
not a cleanup/structure/mutation concern this role owns.

Architect's revert already stripped the tuning commit and the step
handler from this branch entirely, so there is nothing left here for
cleaner to clean up — the fix has to be re-authored by coder with a
correct "before" reference.

## Inventory (travels with the parcel, Article 4.4)

- D1 — invariant-unencoded: `no-property-is-dropped-02` step compares
  `git show HEAD:<path>` to the live file, which are always identical
  once the tuning commit exists on the branch. Blamed role: coder.
  Remediation: diff against the parent-of-tuning commit (or a recorded
  base SHA), not `HEAD`. Unchanged from architect's evidence — no new
  cleaner-side items found (nothing else to clean up: the revert removed
  all touched files).

By cleaner.
