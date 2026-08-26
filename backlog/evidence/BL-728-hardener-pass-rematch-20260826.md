# BL-728 hardener pass (rematch) — handoffd deliver! verification — 20260826

**Architect tip:** `f453b00543`
**Task:** `BL-728-bl636-commit-message-claims-unlanded-parenfix`
**Rematch context:** QA bounce D1 — out-of-scope BL-1153 test removed from `residentSpyUiHtml.test.js` on cleaner tip `8bc439e514`.

## Gates

| Gate | Result |
|------|--------|
| wiring `test_handoffd_one_shot_flags_parse.sh` | ALL PASS |
| APS BL-728 | 7/7 |
| Gherkin mutation (soft re-run) | stamp valid — manifest total=6 killed=6 survived=0 errors=0 |
| Surgical `bl728_handoffd_deliver_paren_mutation_sweep.sh` | killed=2 survived=0 skipped=0 |
| `residentSpyUiHtml.test.js` (parcel-touched, post-rematch) | 12/12 PASS |
| Stryker / CRAP / DRY | N/A — Babashka/shell verification slice only |
| BL-149 cooldown | N/A — parcel did not commit-touch `handoffd.bb` |

## Hardening delta

- No new test or code changes this rematch pass — prior hardening (`f4dd1cee0`: APS spawnSync timeout + surgical sweep) remains green against the QA-bounce fix.
- Soft Gherkin re-run confirms prior mutation stamp; no survivors.

Tip purity: no mutation caches staged.

By hardender.
