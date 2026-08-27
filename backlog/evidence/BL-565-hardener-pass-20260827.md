# BL-565 — hardener pass — 20260827

## Inbound

Architect `23b4af9524` after cleaner `217d2bb0df` — synthetic list-price
rollups and handoff token capture for Max-billed pipeline roles.

## Merge

Merged architect handoff (tip `ab755c0ef8`).

## Hardening

| Gate | Result |
|---|---|
| Compile | **PASS** |
| Acceptance | **9/9** (`BL-565-cost-ledger-synthetic-pricing-max-billed-roles.feature`; clean `GIT_DIR` + `swarm.env`) |
| Unit | **43/43** (`syntheticLlmCost.test.js` 9/9, `llmCostLedger.test.js` 23/23, store 14/14) |
| Babashka | **ALL PASS** (`llm_cost_ledger_lib_test_runner.bb`) |
| Gherkin soft | **inapplicable** (plain Scenarios; exit 2) |
| Cooldown | **run** on `syntheticLlmCost.ts`, `llmCostLedger.ts` |
| Stryker (targeted) | **deferred** — initial dry-run failed suite budget on unrelated sidecar tests; surgical sweeps load-bearing |
| Surgical (`syntheticLlmCost.ts`, 5) | **killed=5 survived=0** |
| Surgical (`llmCostLedger.ts`, 6) | **killed=5 survived=0 equivalent=1** (`billed synthetic zero` — guard unreachable from sole caller) |

## Test strengthening

Added unit coverage for partial tokens, zero list-price estimate, enrich
no-op on null synthetic, unknown-price without tokens, synthetic ranking,
separate billed/synthetic rollups.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-565-cost-ledger-synthetic-pricing-max-billed-roles`.

By hardender.
