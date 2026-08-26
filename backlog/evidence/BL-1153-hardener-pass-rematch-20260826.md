# BL-1153 hardener pass (rematch) — sticky web font size — 20260826

**Architect tip:** `474356f8d5`
**Task:** `BL-1153-sticky-web-font-size-choice`

## Gates

| Gate | Result |
|------|--------|
| `webUiFontSizePreference.test.js` + `residentSpyUiHtml.test.js` | 18/18 |
| APS BL-1153 | 6/6 |
| Gherkin mutation (hard) | total=2 killed=2 survived=0 errors=0 |
| Surgical `bl1153_web_ui_font_size_preference_mutation_sweep.sh` | killed=4 survived=0 skipped=0 |
| Stryker (full) | BLOCKED — dry-run red on standing `cursorBridgeAgentSession` host debt (unrelated to parcel); surgical sweep + unit tests cover preference module |
| BL-149 cooldown | run on all three new TS modules |

## Hardening delta

- APS scenario 02: route Outline `surface` Examples through a label→config map so Gherkin surface spelling mutants fail (m1/m2 were surviving).
- Unit tests: exact per-surface default resolution, corrupt-file `unreadable` kind, pipeline-grid max clamp.
- Hand-authored surgical sweep over `webUiFontSizePreference.ts` (4 mutants).

Tip purity: no mutation caches staged.

By hardender.
