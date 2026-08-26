# BL-1159 hardener pass — bridge child crash give-up loop — 20260826

**Architect tip:** `5730b79da9`
**Task:** `BL-1159-bridge-child-survives-without-crash-giveup-loop`

## Gates

| Gate | Result |
|------|--------|
| `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh` | ALL CHECKS PASSED |
| `test_recover_miniapp_bridge.sh` | ALL CHECKS PASSED |
| `test_start_stop_bridge_headless.sh` | ALL CHECKS PASSED |
| `test_operator_runtime_tick.sh` | ALL CHECKS PASSED |
| APS BL-1159 | 4/4 |
| Gherkin mutation | **inapplicable** (no Scenario Outline) |
| Surgical `bl1159_bridge_child_mutation_sweep.sh` | killed=4 survived=0 skipped=0 |
| Stryker | N/A — shell edge + operator_runtime orchestration |

## Hardening delta

- Added surgical mutation sweep over `stop_bridge_headless.sh` defer guard and `recover_miniapp_bridge.sh` rearm/bounce routing (BL-638 fallback).
- APS steps use correct `defineScoped(pattern, fn, FEATURE)` order; no Outline allowlists needed.

By hardender.
