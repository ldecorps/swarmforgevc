# BL-748 — hardender pass, 20260824

## Inbound

Merged architect `7c534615d1` into `swarmforge-hardender`.

## Scope

`log-routing-skip!` in `swarm_handoff.bb`: try/catch + `report-nonfatal!` so
journal I/O failure never aborts `-main`'s let (sync inject + draft consume).

## Host / cooldown

`swarm_handoff.bb`: **skip-cooldown** (~0.22d). Gherkin + surgical; no Stryker.

## BL-113 Gherkin (soft)

```
total=2 completed=2 killed=2 survived=0
outcome: pass
```

(Outline journal faults: create-dirs / append.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| drop try/catch | killed |
| rethrow in catch | killed |
| silent swallow (no stderr report) | killed |
| skip call-site invoke | killed |

Survivors: 0.

## Verification

- Acceptance 4/4

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-748-bl623-log-routing-skip-uncaught-exception-blocks-delivery`.

By hardender.
