# BL-1084 — hardener pass, 20260824

## Inbound

Merged architect `37919dc2e6` into `swarmforge-hardender`.

## Scope

Durable supersede marker store; `turn-verdict` consulted at every role's
turn-start (`ready_for_next.bb`). Unreadable store fails closed.

## Host / cooldown

| File | Decision |
|---|---|
| `supersede_lib.bb` | **run** (new) |
| `ready_for_next.bb` | **run** (~5.8d) |

No Stryker (babashka). Gherkin + surgical.

## BL-113 Gherkin (soft)

First pass: 4 killed / 3 survived (case-flip of Outline roles; steps ignored
role strings).

Harden: `KNOWN_ROLES` exact-set asserts on every role-capturing step.

Recheck: **7/7 killed**, outcome pass.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| unreadable → :ok | killed |
| never refuse superseded | killed |
| absent → refuse | killed |
| ignore candidate match | killed |
| unknown status → :ok | killed (after unit assert) |

Survivors: 0.

## Verification

- Acceptance 9/9
- Unit ALL PASS; property 500 HOLD; `test_supersede_guard.sh` ALL PASS

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1084-a-superseded-task-stops-at-every-stage`.

By hardender.
