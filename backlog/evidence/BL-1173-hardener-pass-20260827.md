# BL-1173 — hardener pass — 20260827

## Inbound

Merged architect `ddf038e5f1` into `swarmforge-hardender`.

## Scope

Deprecator freshness-gate CLI (`deprecate-check.ts`) + promote fail-closed
consult. Soft Gherkin inapplicable (no Scenario Outline) — BL-638 surgical
sweep.

## Host / cooldown

| File | Decision |
|---|---|
| `deprecate-check.ts` | **run** |
| `promote_and_route_next.sh` | **skip-cooldown** (~1.9d) |

Scoped Stryker on `deprecate-check.js` (narrow vitest include): baseline score
low on unused CLI/IO surface; load-bearing evaluator paths covered by surgical
sweep + new unit cases below.

## BL-113 Gherkin (soft)

```
outcome: inapplicable (no Scenario Outline)
```

## Hand-authored surgical

9/9 killed (`bl1173_deprecate_check_mutation_sweep.sh`):
supersede hold, retired-surface hits (without RETIRED word), clean→hold,
expedite bypass, empty/malformed CLI→allow, hold side-effects, spec-gap,
stale claim.

## Hardening added

Unit tests isolating retiredSurfaceHits from `/\bRETIRED\b/` fallback, plus
stale-claim and spec-gap bounce holds.

## Verification

- Unit `deprecateCheck.test.js`: **10/10**
- Properties `deprecateCheck.property.test.js`: **5/5**
- Acceptance BL-1173 feature: **5/5**

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1173-deprecator-freshness-gate-cli`.

By hardender.
