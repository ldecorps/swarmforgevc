# BL-653 hardener pass (rematch) — escalation-driven operator wake — 20260826

**Architect tip:** `2fa594c7b0`
**Task:** `BL-653-operator-wakes-only-on-real-events-escalation-driven`
**Rematch context:** operator slice restored after BL-588 hitchhiker scrub; architect merge re-broke `defineScoped` order and dropped BL-728 wiring.

## Gates

| Gate | Result |
|------|--------|
| `operator_lib_test_runner.bb` | ALL TESTS PASSED |
| `operator_lib_bl653_property_runner.bb` | ALL PASSED |
| `test_operator_runtime_bl653_escalation_driven.sh` | ALL CHECKS PASSED |
| APS BL-653 | 9/9 |
| Gherkin mutation (hard) | total=6 killed=6 survived=0 errors=0 |
| Stryker | N/A — Babashka operator slice |

## Hardening delta

- **BL-653:** restored `defineScoped(pattern, fn, FEATURE)` order (Background steps were unbound); re-applied Outline allowlists (`ACTIVE_ROLES`, `OPERATOR_OUTCOMES`) so scenario-4 example mutants fail at Then.
- **Merge hygiene:** re-registered `bl728HandoffdDeliverParenVerificationSteps` in `index.js`; restored BL-728 steps/shell/evidence dropped by architect merge; restored sibling hardener evidence (BL-588, BL-660) scrubbed by merge.

By hardender.
