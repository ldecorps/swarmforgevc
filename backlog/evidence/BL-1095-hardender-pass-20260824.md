# BL-1095 — hardender pass, 20260824

## Inbound

Merged architect `f03b3777ce` into `swarmforge-hardender`.

## Scope

`expedited-types` → `#{"defect"}` only; mint hygiene refuses `type: bug`
(`:retired-ticket-type`).

## Host / cooldown

| File | Decision |
|---|---|
| `promotion_gates_lib.bb` | **run** (~4.7d) |
| `backlog_hygiene_lib.bb` | **skip-cooldown** |

## BL-113 Gherkin (soft)

```
total=22 completed=22 killed=22 survived=0
outcome: pass
```

## Hand-authored surgical

| Mutant | Result |
|---|---|
| restore bug in expedited-types | killed |
| drop mint refuse for bug | killed |
| refuse defect too | killed |
| empty expedited-types | killed |

Survivors: 0.

## Verification

- Acceptance 9/9; promotion + hygiene units green

## Findings

NONE (Article 3.2.4 Transition prose trim remains specifier/BL-798 as noted).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1095-retire-the-expedite-lanes-legacy-bug-type`.

By hardender.
