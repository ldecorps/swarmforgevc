# BL-753 hardener pass — unreachable step-handler land gate — 20260826

**Architect tip:** `eeea6df80c`
**Task:** `BL-753-bl694-pilot-dead-step-handler-read-as-cosmetic`

## Gates

| Gate | Result |
|------|--------|
| unit `unreachableStepHandlerCheck.test.js` | 10/10 (`node:test` + fail-open undefined + unparsable literal) |
| property (vitest.properties) | 6/6 |
| APS BL-753 | 5/5 |
| Gherkin mutation | `inapplicable` (no Scenario Outline) |
| Surgical `bl753_unreachable_step_handler_mutation_sweep.sh` | killed=8 survived=0 skipped=0 |
| BL-149 cooldown | `run` on unreachableStepHandlerCheck.ts |

## Hardening delta

- Import `node:test` for `node --test` discovery.
- Unit covering fail-open (`checked: false` when feature/stepFiles undefined).
- Unit covering unparsable registered regex literals (compile fail → no false miss).
- Hand-authored surgical sweep locking fail-open polarity, miss polarity,
  FEATURE pairing AND, empty-set no-op, and path-gate always-true/false.

Tip purity: no `mutations/` / `base/` caches staged.

By hardender.
