# BL-1160 hardener pass (rematch 4) — live screen activity dot per tile — 20260826

**Architect tip:** `c9688a316e`
**Task:** `BL-1160-live-screen-activity-dot-per-tile`
**Rematch context:** cleaner re-cut BL-1160-only post-BL-1159 land; APS steps retain closed-set Examples + async dot wait.

## Gates

| Gate | Result |
|------|--------|
| `residentSpyUiHtml.test.js` | 18/18 |
| APS BL-1160 | 8/8 |
| Gherkin mutation (hard) | stamp valid — **9/9 killed** |
| Surgical `bl1160_resident_spy_ui_html_mutation_sweep.sh` | killed=4 survived=0 skipped=0 |

## Hardening delta

- **Merge hygiene:** Outline allowlists (`PANE_COUNTS`, `SIGNAL_CASES`) intact; bl728/bl653/bl660/bl588/bl1159 siblings registered; no code changes required.

By hardender.
