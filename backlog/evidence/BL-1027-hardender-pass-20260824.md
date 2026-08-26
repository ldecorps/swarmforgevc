# BL-1027 — hardender pass, 20260824

## Inbound

Merged architect `9a85caa0b5` into `swarmforge-hardender`.

## Scope

Mint-time `dangling-acceptance-violation`: `applicable?` + working-tree
exists probe; wired through hygiene gate / epic audit.

## Host / cooldown

| File | Decision |
|---|---|
| `backlog_hygiene_lib.bb` | **skip-cooldown** (~0.11d) |

Gherkin soft + surgical (no Stryker).

## BL-113 Gherkin (soft)

```
total=14 completed=14 killed=14 survived=0
outcome: pass
```

(KNOWN_DECLARATIONS map already in steps.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| never report dangling | killed |
| skip applicable? gate | killed |
| invert exists? | killed |
| drop dangling from collect | killed |
| wrong kind (:unreadable) | killed |

Survivors: 0.

## Verification

- Acceptance 9/9; unit all passed; properties all passed

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer`.

By hardender.
