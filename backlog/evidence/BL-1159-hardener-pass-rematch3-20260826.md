# BL-1159 hardener pass (rematch 3) — bridge child crash give-up loop — 20260826

**Architect tip:** `86503547af`
**Task:** `BL-1159-bridge-child-survives-without-crash-giveup-loop`
**Rematch context:** QA rematch2 — restored main inline `cond->` observed-events block; kept `recover_miniapp_bridge` routing.

## Gates

| Gate | Result |
|------|--------|
| `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh` | ALL CHECKS PASSED |
| `test_recover_miniapp_bridge.sh` | ALL CHECKS PASSED |
| `test_start_stop_bridge_headless.sh` | ALL CHECKS PASSED |
| APS BL-1159 | 4/4 |
| Gherkin mutation | inapplicable (no Outline) |
| Surgical `bl1159_bridge_child_mutation_sweep.sh` | killed=4 survived=0 skipped=0 |
| `test_operator_runtime_tick.sh` | BL-653 idle-tick cases **fail** (architect-noted: main tick block restored; sibling concern) |
| `test_operator_runtime_bl653_escalation_driven.sh` | BL-653-01 idle cases fail (same root) |

## Hardening delta

- No code changes — prior surgical sweep + shell gates remain green for BL-1159 surface; `recover_miniapp_bridge` routing intact after operator_runtime merge fix.

By hardender.
