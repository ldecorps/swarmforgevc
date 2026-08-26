# BL-588 + BL-653 hardener pass (batch) — 20260826

**Architect tips:** `4ca62a87d6`, `42673aa12d`
**Tasks:** `BL-588-isolate-batch-recovery-trees`, `BL-653-operator-wakes-only-on-real-events-escalation-driven`

## Gates (combined pass)

| Gate | BL-588 | BL-653 |
|------|--------|--------|
| Unit / property | 16 vitest + 3 property | operator_lib + BL-653 shell |
| APS | 7/7 | 9/9 |
| Gherkin mutation (hard) | 3/3 killed | 6/6 killed |
| Stryker | deferred — batchRecovery.ts covered by property + unit | N/A Babashka slice |

## Hardening delta

- **Merge hygiene:** restored BL-728 wiring/steps dropped by architect merge; re-registered `bl728HandoffdDeliverParenVerificationSteps` in `index.js`.
- **BL-653:** fixed inverted `defineScoped(pattern, fn, FEATURE)` argument order (Background steps never bound); tightened Outline Examples with active-role allowlist.
- **BL-588:** Gherkin Outline landing-operation mutants already killed via CLI validator step.

By hardender.
