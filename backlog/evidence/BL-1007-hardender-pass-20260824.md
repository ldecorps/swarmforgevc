# BL-1007 — hardender pass, 20260824

## Inbound

Merged architect `574c929d82` into `swarmforge-hardender`.

## Scope

Unit-lane contention budget: `effectiveBudgetMs` / `loadNormalizedDurationMs`;
setup records attributable normalized durations; Outline cells locked.

## Host / cooldown

| File | Decision |
|---|---|
| `contentionBudget.js` | **run** |
| `contentionBudgetSetup.js` | **run** |

No Stryker (helper/config). Surgical on budget arithmetic + setup.

## BL-113 Gherkin (soft)

```
total=21 completed=21 killed=21 survived=0
outcome: pass
```

Locked with `KNOWN_BASES` / `KNOWN_FACTORS` / `KNOWN_EFFECTIVES` / `KNOWN_ROWS`.

## Harden locks

- Property: quiet factors (<1) must not inflate load-normalized duration
  (divisor floored at 1).

## Hand-authored surgical

| Mutant | Result |
|---|---|
| no floor-at-1 on effective | killed |
| no ceiling clamp | killed |
| unusable scales base | killed |
| norm denom skips max(1,f) | killed |
| setup leaves normalized null | killed |

Survivors: 0.

## Verification

- Acceptance 11/11; properties 5/5

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention`.

By hardender.
