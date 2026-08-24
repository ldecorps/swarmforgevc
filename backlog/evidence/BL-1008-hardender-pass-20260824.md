# BL-1008 — hardender pass, 20260824

## Inbound

Merged architect `626e1c318c` into `swarmforge-hardender`.

## Scope

`resolveBoundedWatchDeadlineMs`: base 10000ms scaled via BL-1007
`effectiveBudgetMs`, clamped to `testBudget - 1`. Diagnostic still names
event + path.

## Host / cooldown

| File | Decision |
|---|---|
| `boundedWatchWait.js` | **run** (~5.4d) |

No Stryker (test helper). Surgical on deadline resolve + diagnostic.

## BL-113 Gherkin (soft)

```
total=11 completed=11 killed=11 survived=0
outcome: pass
```

(KNOWN_FACTORS / KNOWN_DEADLINES / KNOWN_ROWS already in steps.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| bare base, no scale | killed |
| clamp to testBudget (not −1) | killed |
| return scaled only | killed |
| describe drops watched path | killed |
| ignore opts.factor | killed |

Survivors: 0.

## Verification

- Acceptance 8/8; unit 10/10; properties 3/3

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1008-the-bounded-watch-deadline-is-itself-an-absolute-constant`.

By hardender.
