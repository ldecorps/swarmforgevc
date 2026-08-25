# BL-1130 — hardener pass — 2026-08-25

Architect tip: `e5115a2440`. Recreated `swarmforge-hardender` on tip.
Authorize **BL-1130 paths** (+ intentional BL-1118 APS companion).

## Gates

| Check | Result |
|---|---|
| Acceptance BL-1130 | **2/2** |
| Acceptance BL-1118 companion | **4/4** |
| `bl1130_absorb_plan_property_runner.bb` | **ALL TESTS PASSED** |
| `master_main_reconcile_lib_test_runner.bb` | **ALL TESTS PASS** |
| `post_hotfix_merge_origin_lib_test_runner.bb` | **ALL TESTS PASSED** |
| Soft Gherkin | N/A (no Scenario Outline) |
| Surgical | **3/3 killed** |

### Surgical

| Mutant | Killer |
|---|---|
| `post-absorb-clean?` → always `true` | APS `DIRTY_CLEAN_PROBE=false` (+ property) |
| `absorb-outcome-names-rematch-or-refuse?` → always `true` | APS `EDITOR_PHRASE_REJECTED=true` (+ property) |
| `would-conflict?` → `:run-merge` | APS + property |

## Harden this hop

APS now prints/asserts `POST_ABSORB_CLEAN`, a dirty `post-absorb-clean?(true,1)`
probe, rematch naming, and rejection of “finish this merge in an editor”.

## CRAP / Stryker TS

N/A — Babashka parcel.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1130-land-on-main-without-external-conflict-resolution`, commit = this tip.

By hardener.
