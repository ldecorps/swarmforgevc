# BL-1001 — hardender pass, 20260824

## Inbound

Merged architect `583ca227ec` into `swarmforge-hardender`.

## Scope

`seat_difficulty_lib.bb` / claim filter: declared `--seat-tier` routing;
undeclared seats skip on tier-active stages; asymmetric spill / prefer-fit.

## Host / cooldown

| File | Decision |
|---|---|
| `seat_difficulty_lib.bb` | **run** |
| `ready_for_next_task.bb` | **run** (~3.4d) |

No Stryker (babashka). Surgical on the pure lib.

## BL-113 Gherkin (soft)

```
total=6 completed=6 killed=6 survived=0
outcome: pass
```

(Outline mutation_cost/seat cells.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| undeclared → :claim on tier stage | killed |
| easy ceiling raised to hard | killed |
| never defer better-fit | killed |
| seat-accepts? always true | killed |
| stage-tiers-active? always false | killed |

Survivors: 0.

## Verification

- Acceptance 6/6; unit ALL PASS; properties 4/4

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1001-difficulty-aware-coder-seat-routing`.

By hardender.
