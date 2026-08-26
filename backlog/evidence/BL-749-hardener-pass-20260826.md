# BL-749 hardener pass — call-site before nit-downgrade — 20260826

**Architect tip:** `a6bc8f4c9d`
**Task:** `BL-749-bl623-pilot-nit-not-traced-to-real-defect`

## Gates

| Gate | Result |
|------|--------|
| unit `telegramCursorBridgePilot.test.js` | 16/16 (added `node:test` + polarity/obligation asserts) |
| APS BL-749 | 3/3 |
| Gherkin mutation | `inapplicable` (no Scenario Outline) |
| Surgical `bl749_pilot_call_site_trace_mutation_sweep.sh` | killed=6 survived=0 skipped=0 |
| BL-149 cooldown | `run` on telegramCursorBridgePilot.ts |

## Hardening delta

- Import `node:test` so `node --test` can run the unit file.
- BL-749 unit + APS now lock **never→always** polarity and **mandatory→optional**
  obligation on `composePilotExpeditorPrompt` REVIEW HATS text — previously those
  mutants survived the focused BL-749 assertions (only the full-brief equality
  test killed them as a side effect).
- Hand-authored surgical sweep over the REVIEW HATS block.

Tip purity: no `mutations/` / `base/` caches staged.

By hardender.
