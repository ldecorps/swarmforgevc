# BL-1124 — hardener pass — 2026-08-25

Architect tip: `5a8acaaf69` (shared-repo property-suite canary). Recreated
`swarmforge-hardender` on tip. BL-506: **BL-1124 paths only** (stacked rematch
ancestry not re-hardened).

## Scope

- `swarmforge/scripts/property_suite_shared_repo_guard.sh`
- Drift wiring + unit runner killers
- APS feature (soft mutation inapplicable — no Outline)

## Gates

| Check | Result |
|---|---|
| Unit guard runner | ALL PASS (incl. 04b/04c/04d killers) |
| Drift guard tests | ALL PASS |
| Acceptance | **4/4** |
| Gherkin soft | **inapplicable** (`total=0`) |
| Surgical bash mutants | **6/6 killed** |

### Surgical detail

1. `assert_not_bare` never-fail (`bare == never`)
2. `assert_unchanged` skip compare
3–4. `refuse_reset_when_ahead` always-ok / invert
5. empty dest `return 0`
6. drop live-checkout marker probe

Killers added for prior survivors (2) and (5).

## CRAP / Stryker TS

N/A — bash parcel.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1124-property-suite-fixtures-must-not-mutate-shared-main`, commit = this tip.

By hardener.
