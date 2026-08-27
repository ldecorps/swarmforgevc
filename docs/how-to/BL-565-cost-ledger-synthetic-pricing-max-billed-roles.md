# Cost ledger synthetic pricing for Max-billed roles (BL-565)

*How-to. Task-oriented: read Max-subscription pipeline spend as list-price
estimates without mixing them with real billed dollars.*

## The gap

BL-551's `llm_invocation` ledger (`.swarmforge/telemetry/llm-cost-*.jsonl`)
recorded pipeline roles with `tokens: null` and `costUsd: null` because Claude
Max seats have no per-call API price. Only OpenRouter-billed paths (e.g.
front-desk-operator) carried real dollars, so 7-day rollups ranked Max-billed
roles by invocation count alone.

## What changed

Two layers, kept distinct in every rollup:

1. **Token capture at record time** — `handoffd.bb` delivery and related
   writers populate `tokens` from GH-22 context-telemetry / transcript usage
   when observable. When usage cannot be read, the record keeps today's
   null-token shape and delivery still completes.

2. **Synthetic list-price dollars** — `syntheticLlmCost.ts` derives
   `syntheticCostUsd` from the committed pricing table for unbilled records.
   `costUsd` stays null unless the provider actually billed. Rollups (`swarm-cost-rank`,
   `/cost-rank`, cost & health sidecar) show **billed** and **synthetic
   estimate** totals as separate labelled columns — never summed silently.
   Unknown models land in an **unknown-price** bucket, not zero.

| Field | Meaning |
| --- | --- |
| `costUsd` | Real provider-billed dollars only |
| `syntheticCostUsd` | List-price estimate from tokens × pricing table |
| Sidecar label | Includes pricing table `as_of` (estimates) |

Historical records written before this slice are **not** backfilled.

## Operator check

After a pipeline handoff delivery, inspect the latest ledger line for that
role: when usage was observable you should see non-null `tokens` and, for a
model in the price table, a positive `syntheticCostUsd` with `costUsd` still
null. Re-run a 7-day cost-rank rollup and confirm Max-billed roles sort by
synthetic dollars, not invocation count alone.

## Verify

```bash
cd extension && npm test -- syntheticLlmCost llmCostLedger
bb swarmforge/scripts/test/llm_cost_ledger_lib_test_runner.bb
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-565-cost-ledger-synthetic-pricing-max-billed-roles.feature
```

Related: [Context Telemetry (GH-22)](GH-22-context-telemetry-recorder-and-query-cli.md),
[Context-telemetry producer wiring](BL-665-context-telemetry-producer-wiring.md).
