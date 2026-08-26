# BL-1160 hardener pass (rematch 2) — live screen activity dot per tile — 20260826

**Architect tip:** `4b4f971f96`
**Task:** `BL-1160-live-screen-activity-dot-per-tile`
**Rematch context:** QA bounce — dot repaint via `removeAttribute('hidden')` / `renderPane` refresh; BL-1153 index registration retained.

## Gates

| Gate | Result |
|------|--------|
| `residentSpyUiHtml.test.js` | 18/18 |
| APS BL-1160 | 8/8 |
| Gherkin mutation (hard) | stamp valid — 9/9 killed |
| Surgical `bl1160_resident_spy_ui_html_mutation_sweep.sh` | killed=4 survived=0 skipped=0 |
| Stryker | N/A — unit + surgical sweep cover TS |

## Hardening delta

- No step changes — prior Outline allowlists remain green against QA dot-repaint fix in `residentSpyUiHtml.ts`.

By hardender.
