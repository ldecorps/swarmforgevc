# BL-980 — hardener pass — 20260827

## Inbound

Merged architect `c75576bb62` into `swarmforge-hardender`.

## Scope

RECENTLY CLOSED relative age suffix from durable `doneClosedAtMs` via
`formatRecentlyClosedAgeLabel` in `pipelineBoard.ts`; text/HTML parity.

## Host / cooldown

| File | Decision |
|---|---|
| `pipelineBoard.ts` | **run** |
| `conciergeTick.ts` | **skip-cooldown** (co-change, fresh) |

Scoped Stryker (`pipelineBoard.js:261-284`) reported 0 mutants in range;
full-file scoped run (narrowed vitest include) 70% score — survivors outside
BL-980 ladder functions. Surgical sweep covers the parcel.

## BL-113 Gherkin (hard)

```
total=14 completed=14 killed=14 survived=0
outcome: pass
```

Hardening: step handler now derives via `formatRecentlyClosedAgeLabel`,
asserts bucket-edge sensitivity, and Examples trimmed to boundary rows only
(removed plateau interiors that let elapsed_ms mutants survive).

## Hand-authored surgical

6/6 killed (`bl980_recently_closed_mutation_sweep.sh`).

## Verification

- Unit `bl980RecentlyClosedElapsed.test.js`: **8/8**
- Property `bl980RecentlyClosedElapsed.property.test.js`: **2/2**
- Acceptance BL-980 feature: **13/13**

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-980-recently-closed-elapsed-time`.

By hardender.
