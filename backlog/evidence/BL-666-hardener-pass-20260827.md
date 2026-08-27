# BL-666 — hardener pass — 20260827

## Inbound

Architect `92d1087afb` after cleaner `eae6d200ba` — budget-aware shift
governor at shift boundaries (feat + CLI fix).

## Merge

Merged `92d1087afb` with `--no-ff` (restored BL-565 ledger files in worktree
that blocked compile).

## Hardening

| Gate | Result |
|---|---|
| Compile | **PASS** |
| Acceptance | **7/7** (`BL-666-budget-aware-shift-governor.feature`) |
| Unit | **6/6** (`budgetShiftGovernor.test.js`) |
| Properties | **2/2** (`budgetShiftGovernor.property.test.js` — rematched to `out/` + fast-check) |
| Gherkin soft | **inapplicable** (plain Scenarios) |
| Cooldown | **run** (`budgetShiftGovernor.ts`) |
| Surgical (6) | **killed=6 survived=0** |

## Fixes

- Property suite: drop TS inline `type` import; use compiled `out/` like other property tests.
- Unit: verdict ladder, degraded projection, negative-affordable SKIP guards.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-666-budget-aware-shift-governor`.

By hardender.
