# BL-1087 — hardener pass

Received from architect as `merge_and_process architect 04ef599e9f`
(COMPLIANT; named pack-conf doc drift clean). Merge already on
`swarmforge-hardender` as `b72af0ab7`.

## BL-149 cooldown gate

```
bb swarmforge/scripts/mutation_cooldown_gate.bb <root> extension/src/docs/namedPackConfDrift.ts
DECISION: run
bb swarmforge/scripts/mutation_cooldown_gate.bb <root> specs/pipeline/steps/bl1087QwenCodeDocDriftSteps.js
DECISION: run
```

Host quiet (load ~1.7 on 20 cores). Proceeded.

## Stryker (`out/docs/namedPackConfDrift.js`)

Full-suite dry-run fails on an unrelated `CURSOR_API_KEY` env gap in
`cursorBridgeAgentSession.test.js` — not this parcel. Scoped the vitest
runner to `test/namedPackConfDrift.test.js` for the mutation pass only
(scratch config; not committed).

First pass: **54 killed / 2 survived / 0 no-cov** (96.43%).

| survivor | fix |
|---|---|
| Regex `/^[A-Z]…$/` → `/[A-Z]…$/` on `isIllustrativePackPlaceholder` | Assert `xNAME` / `aPACK` are not placeholders (start anchor is load-bearing) |
| MethodExpression `[...absent].sort()` → `[...absent]` | Assert multi-absent result is lexicographically sorted |

Second pass after those unit tests: **56/56 killed, 100%**.

## BL-113 Gherkin soft mutation

Prior session already ran soft mutation to completion (6/6 killed on the two
`Scenario Outline`s). Soft re-run this pass: `total=0 skipped_scenarios=2
skipped_mutations=6`, `outcome: pass` — stamp still valid (BL-460). Manifest
in the feature file records both outlines clean.

## Verification this pass

| check | result |
|---|---|
| unit `namedPackConfDrift.test.js` | 7/7 |
| property `namedPackConfDrift.property.test.js` | ALL PROPERTIES HOLD |
| acceptance BL-1087 feature | 11/11 |
| Stryker scoped to `namedPackConfDrift.js` | 100% (56/56) |
| Gherkin soft (stamp confirm) | pass, 6 skipped |
| CRAP `src/docs/namedPackConfDrift.ts` | max 4.00 (`collectAbsentPacks`); all ≤6 |

No orphaned `node --test`/`stryker` processes at handoff.

## Forward

To documenter, task `BL-1087-docs-stop-describing-the-withdrawn-qwen-code-seat`,
this hardener commit.
