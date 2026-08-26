# BL-588 hardener pass (rematch 6) — batch recovery trees — 20260826

**Architect tip:** `cd5e30e418`
**Task:** `BL-588-isolate-batch-recovery-trees-scrub-deleted-siblings`
**Rematch context:** scrub-deleted-siblings bounce; sibling BL-653/660 slices verified intact at HEAD.

## Gates

| Gate | Result |
|------|--------|
| Unit `batchRecovery.test.js` + CLI | 16/16 |
| Property `batchRecovery.property.test.js` | 3/3 |
| APS BL-588 | 7/7 |
| Gherkin mutation (hard) | total=3 killed=3 survived=0 errors=0 |
| Stryker | N/A — property runner + unit cover `batchRecovery.ts` |

## Hardening delta

- No code changes required — prior landing-operation Outline hardening and property-lane fix remain green; sibling slices (BL-653, BL-660, BL-728) intact after merge.

By hardender.
