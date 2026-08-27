# BL-755 hardener pass — multi-branch parser per-arm land gate — 20260826

**Architect tip:** `406e11861b`
**Task:** `BL-755-bl661-pilot-only-tested-quoted-values`

## Gates

| Gate | Result |
|------|--------|
| unit `multiBranchParserCoverageCheck.test.js` | 9/9 (fail-open, <3-arm filter, exact-3 threshold) |
| property (vitest.properties) | 5/5 |
| APS BL-755 | 6/6 |
| Gherkin mutation | `inapplicable` (no Scenario Outline) |
| Surgical `bl755_multi_branch_parser_mutation_sweep.sh` | killed=8 survived=0 skipped=0 |
| BL-149 cooldown | `run` on multiBranchParserCoverageCheck.ts |

## Hardening delta

- Fail-open unit (`checked: false` when parsers/testTexts undefined).
- Unit locking `MIN_PARSER_ARMS` as **≥3 not >3** (exact three-arm cond + TS fixtures).
- Unit locking sub-threshold (<3 arm) parsers as no-op.
- Hand-authored surgical sweep locking fail-open, miss polarity, threshold
  constant, assess filter, empty no-op, and armExercised always-true/false.

Tip purity: no `mutations/` / `base/` caches staged.

By hardender.
