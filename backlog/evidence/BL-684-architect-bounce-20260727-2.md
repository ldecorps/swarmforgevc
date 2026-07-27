# BL-684 — architect SEND BACK (round 2): acceptance gate regressed 21/21 -> 20/21

**Parcel:** cleaner commit `5c749b186` ("restore two dated records' original
'facilitator' wording", authored by coder, forwarded unchanged by cleaner),
merged into architect at `235cc0548`. Follows the first architect bounce
(`backlog/evidence/BL-684-architect-bounce-20260727.md`).

**Verdict:** SEND BACK to coder.

## What round 1 fixed correctly

The coder's fix restores the original "facilitator" wording in both dated
records I flagged (`docs/briefings/2026-07-26.md`,
`docs/explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md`),
adds the lessons file to `extension/test/onboarderRenameNoResidualFacilitator.test.js`'s
`ALLOWED_RESIDUAL_FILES` with a clear rationale comment, and the vitest
regression test passes:

```
npx vitest run test/onboarderRenameNoResidualFacilitator.test.js
 ✓ test/onboarderRenameNoResidualFacilitator.test.js (1 test) 65ms
```

Content-wise this is the right fix, correctly scoped — no unrelated files
touched.

## Defect — the same "no residual old word" rule is enforced TWICE, and only one enforcement point was updated

This codebase has two independent gates asserting "the old word 'facilitator'
survives only in exempt record files":

1. `extension/test/onboarderRenameNoResidualFacilitator.test.js` —
   `ALLOWED_RESIDUAL_FILES` / `EXEMPT_PREFIXES`. **Updated by this fix.**
2. `specs/pipeline/steps/bl684OnboarderRenameSteps.js` — a separate,
   differently-shaped `CONTENT_EXEMPT` regex list, driving Gherkin scenario
   "the old word survives only where it names its own history"
   (`specs/features/BL-684-rename-onboarding-facilitator-to-onboarder.feature`,
   scenario onboarder-rename-01). **NOT updated.**

`CONTENT_EXEMPT` (lines 114-126) has no entry matching
`docs/explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md` — its
only docs-shaped entry is `^docs\/briefings\/\d{4}-\d{2}-\d{2}\.md$`, which
does not match a `docs/explanation/` path.

Ran the actual acceptance suite (not the unit test) to confirm, rather than
reasoning about it statically:

```
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-684-rename-onboarding-facilitator-to-onboarder.feature
...
# tests 21
# pass 20
# fail 1
```

```
not ok 1 - the old word survives only where it names its own history
  error: 'Scenario "the old word survives only where it names its own
  history" failed at step "Then every file still containing the old word is
  a record file that names its own history": expected every remaining match
  to be an exempt record file, found unexplained:
  ["docs/explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md"]'
```

This is a real regression: the coder's own acceptance-gate wiring commit
(`6760e5930`, "wire the acceptance gate for the Onboarder rename (0/21 ->
21/21)") landed this feature at 21/21. This fix, by restoring the word to a
file the Gherkin-side allowlist doesn't know about, takes it back to 20/21.
The vitest test staying green masked this — it is not the only consumer of
"is this file exempt".

Surfaced by the architect co-change tool
(`node extension/out/tools/co-change-report.js
extension/test/onboarderRenameNoResidualFacilitator.test.js`), which flagged
`specs/pipeline/steps/bl684OnboarderRenameSteps.js` as SUSPECTED COUPLING (3
co-changes, at the default threshold) — the two files have moved together
across this ticket's history because they encode the same rule twice. That
prompted running the acceptance suite directly rather than trusting the unit
test alone.

## Complete site list (both sites accounted for — do not re-bounce for a third)

Searched every file in the repo implementing a residual-facilitator
exemption list (`grep -rln` for `CONTENT_EXEMPT\|ALLOWED_RESIDUAL\|EXEMPT_PREFIX`
across `extension/` and `specs/`, excluding unrelated cost-health/briefing-digest
hits). Exactly two files implement this specific rule, and exactly one needed
this update:

1. `extension/test/onboarderRenameNoResidualFacilitator.test.js` — already
   fixed in this parcel.
2. `specs/pipeline/steps/bl684OnboarderRenameSteps.js` — **still needs it.**

### Remediation

Add a `docs/explanation/` entry to `CONTENT_EXEMPT` in
`specs/pipeline/steps/bl684OnboarderRenameSteps.js` (around line 118, next to
the `docs/briefings/` entry), matching the same file the vitest allowlist now
exempts:

```js
/^docs\/explanation\/lessons-2026-07-25-green-suites-that-proved-nothing\.md$/,
```

(A dated-file-pattern regex like the `docs/briefings/` one isn't appropriate
here since this is a one-off incident retrospective, not a recurring
per-date file — an exact match is correct and matches how the vitest test's
own allowlist just handled it.)

After adding it, re-run
`bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-684-rename-onboarding-facilitator-to-onboarder.feature`
and confirm 21/21 before forwarding.

## What is NOT the problem (do not over-correct)

- The two content restorations themselves are correct and complete — both
  dated docs verified to contain "facilitator" and not "onboarder" at the
  flagged lines.
- Dependency-rule hard gate PASSED on this delta's only source file
  (`extension/test/onboarderRenameNoResidualFacilitator.test.js`); docs files
  are outside the dependency graph.
- No other site in the repo implements this exemption rule a third time —
  confirmed by the repo-wide grep above.
- Everything the round-1 evidence already cleared (dependency gate full-repo,
  filename-history, required_wiring, invariant 2 launcher-guard verification,
  Telegram out-of-scope) is unaffected by this two-line-plus-allowlist delta
  and was not re-litigated.

## Bounce hygiene

Reverted my own review-merge (`235cc0548`, cleaner's `5c749b186` merged into
`swarmforge-architect`) via `git revert -m 1` per BL-490/BL-495 — confirmed
`git diff --name-only <prior-tip> HEAD` is empty (bounced content fully
absent from my tree). Confirmed not on `main`
(`git merge-base --is-ancestor 5c749b186 main` is false), so the exception
does not apply.

— By architect.
