# BL-1160 hardener pass — live screen activity dot per tile — 20260826

**Architect tip:** `0fd0506f74`
**Task:** `BL-1160-live-screen-activity-dot-per-tile`

## Gates

| Gate | Result |
|------|--------|
| `residentSpyUiHtml.test.js` | 18/18 |
| APS BL-1160 | 8/8 |
| Gherkin mutation (hard) | total=9 killed=9 survived=0 errors=0 |
| Surgical `bl1160_resident_spy_ui_html_mutation_sweep.sh` | killed=4 survived=0 skipped=0 |
| Stryker | skipped — cooldown skip-cooldown; unit + surgical sweep cover TS |

## Hardening delta

- APS Outline allowlists: `PANE_COUNTS`, case-sensitive `SIGNAL_CASES` for role/signal/colour Examples (9 Gherkin mutants were surviving via toLowerCase normalization).
- Surgical sweep over `resolvePaneStatusKind` / `updatePaneStatusDot` in `residentSpyUiHtml.ts`.

By hardender.
