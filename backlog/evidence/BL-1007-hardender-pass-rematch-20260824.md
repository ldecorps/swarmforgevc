# BL-1007 — hardender pass (rematch), 20260824

## Inbound

Merged architect rematch `c92b0a1db6` into `swarmforge-hardender`.

## Scope

Attribution rematch: `evidenceTestsAreAttributable`, smoke probe rename,
`loadNormalizedDurationMs` recorded per budgeted test. Outline KNOWN_*
locks retained from prior harden tip.

## Host / cooldown

| File | Decision |
|---|---|
| `contentionBudget.js` | **skip-cooldown** (fresh rematch) |
| `contentionBudgetSetup.js` | **skip-cooldown** |

Gherkin soft: prior stamp (Outline unchanged) — skipped_mutations=21,
outcome pass. Surgical on attribution helpers.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| evidenceTestsAreAttributable always true | killed |
| empty tests[] treated attributable | killed |
| setup leaves normalized null | killed |
| norm denom skips max(1,f) | killed |
| effectiveBudget drops ceiling | killed |

Survivors: 0.

## Verification

- Acceptance 11/11; properties 7/7

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention`.

By hardender.
