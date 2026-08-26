# BL-653 hardener pass (rematch 2) — escalation-driven operator wake — 20260826

**Architect tip:** `b87ee07b86`
**Task:** `BL-653-operator-wakes-only-on-real-events-escalation-driven`
**Rematch context:** cleaner re-cut restores `tick-observed-events` in `operator_runtime.bb`; patrol/liveness pseudo-events dropped.

## Gates

| Gate | Result |
|------|--------|
| `operator_lib_test_runner.bb` | ALL TESTS PASSED |
| `operator_lib_bl653_property_runner.bb` | ALL PASSED |
| `test_operator_runtime_bl653_escalation_driven.sh` | ALL CHECKS PASSED |
| `test_operator_runtime_tick.sh` | ALL CHECKS PASSED |
| APS BL-653 | 9/9 |
| Gherkin mutation (hard) | stamp valid — **6/6 killed** |
| Stryker | N/A — Babashka operator slice |

## Hardening delta

- **Merge hygiene:** `defineScoped(pattern, fn, FEATURE)` order intact; Outline allowlists (`ACTIVE_ROLES`, `OPERATOR_OUTCOMES`) present; single `bl728HandoffdDeliverParenVerificationSteps` registration at line 329; bl653/bl660 step modules registered.
- **No code changes required** — architect slice verified green end-to-end.

By hardender.
