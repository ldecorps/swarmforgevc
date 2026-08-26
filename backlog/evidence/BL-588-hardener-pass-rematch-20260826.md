# BL-588 hardener pass (rematch) — batch recovery trees — 20260826

**Architect tip:** `0d81184955`
**Task:** `BL-588-isolate-batch-recovery-trees`
**Rematch context:** architect bounce D1 — `batchRecovery.property.test.js` vitest globals restored (no `node:test` import).

## Gates

| Gate | Result |
|------|--------|
| Unit `batchRecovery.test.js` + CLI | 16/16 |
| Property `batchRecovery.property.test.js` | 3/3 |
| APS BL-588 | 7/7 |
| Gherkin mutation (soft re-run) | stamp valid — 3/3 killed |
| Stryker | N/A — property runner + unit cover `batchRecovery.ts` |

## Hardening delta

- No new test/code changes — prior hardening (landing-operation Outline map in `bl588BatchRecoverySteps.js`) remains green against property-lane fix.

By hardender.
