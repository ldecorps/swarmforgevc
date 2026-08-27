# BL-565 — architect pass — 20260827

**Received:** `merge_and_process cleaner 217d2bb0df` (handoff
`00_20260827T145847Z_000029_from_cleaner_to_architect`)
**Merged at:** cherry-picked `217d2bb0df` → `f3e5a7f3b`
**Task:** BL-565-cost-ledger-synthetic-pricing-max-billed-roles

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Parcel intent

Populate Max-billed pipeline-role `llm_invocation` records with tokens (GH-22
context-events / transcript usage; null when unobservable) and add
`syntheticCostUsd` from committed list-price table, kept distinct from
`costUsd`. Rollups label billed vs synthetic separately.

## Merge note

Cherry-picked `217d2bb0df` cleanly. APS run with `GIT_DIR`/`GIT_WORK_TREE`
unset in shell — leaked worktree env otherwise corrupts architect checkout
during handoffd acceptance runners (same class as BL-1112 fixture leak).

## Checks

| Check | Result |
|-------|--------|
| Compile | PASS (`npm run compile`) |
| Unit | **5/5** (`syntheticLlmCost.test.js`) |
| APS | **9/9** (`BL-565-cost-ledger-synthetic-pricing-max-billed-roles.feature`) |
| Wiring | `bl565CostLedgerSyntheticPricingSteps` registered; `handoffd.bb` + `llm_cost_ledger_lib.bb` token capture |

## Forward

`git_handoff` → **hardender**, task `BL-565-cost-ledger-synthetic-pricing-max-billed-roles`.

By architect.
