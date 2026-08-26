# BL-1159 hardener pass (rematch 2) — bridge child crash give-up loop — 20260826

**Architect tip:** `d6d53109a4`
**Task:** `BL-1159-bridge-child-survives-without-crash-giveup-loop`
**Rematch context:** QA bounce D1 — restored `bl1153StickyWebFontSizeChoiceSteps` alongside BL-1159/1160 in `index.js`.

## Gates

| Gate | Result |
|------|--------|
| `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh` | ALL CHECKS PASSED |
| `test_recover_miniapp_bridge.sh` | ALL CHECKS PASSED |
| `test_start_stop_bridge_headless.sh` | ALL CHECKS PASSED |
| `test_operator_runtime_tick.sh` | ALL CHECKS PASSED |
| APS BL-1159 | 4/4 |
| Gherkin mutation | inapplicable (no Outline) |
| Surgical `bl1159_bridge_child_mutation_sweep.sh` | killed=4 survived=0 skipped=0 |

## Hardening delta

- No code changes — prior rematch 1 hardening (surgical sweep + shell gates) remains green; BL-1153 APS registration restored by architect merge.

By hardender.
