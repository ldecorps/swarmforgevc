# BL-753 hardener rematch pass — node:test dedupe after architect rematch — 20260826

**Architect rematch tip:** `a5d35be521`
**Prior hardener tip:** `af903555bb`
**Task:** `BL-753-bl694-pilot-dead-step-handler-read-as-cosmetic`

## Rematch delta

Architect rematch restored `node:test` on a tip that already had our hardener
import — merge duplicated `const { test } = require('node:test')` and broke
`node --test` discovery (SyntaxError redeclaration). Removed the duplicate.

## Gates (re-run)

| Gate | Result |
|------|--------|
| unit | 10/10 |
| property | 6/6 |
| APS BL-753 | 5/5 |
| Surgical `bl753_unreachable_step_handler_mutation_sweep.sh` | killed=8 survived=0 skipped=0 |
| Gherkin mutation | `inapplicable` (no Outline) |

No new production mutants; fail-open / polarity coverage from `af903555bb` retained.

By hardender.
