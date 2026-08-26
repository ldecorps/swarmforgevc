# BL-1160 hardener pass (rematch 3) — live screen activity dot per tile — 20260826

**Architect tip:** `3d11802a57`
**Task:** `BL-1160-live-screen-activity-dot-per-tile`
**Rematch context:** QA rematch2 — APS `waitForVisibleTileDots`; immediate `activitySignal` paint in `renderPane`.

## Gates

| Gate | Result |
|------|--------|
| `residentSpyUiHtml.test.js` | 18/18 |
| APS BL-1160 | 8/8 |
| Gherkin mutation (hard) | stamp valid — 9/9 killed |
| Surgical sweep | killed=4 survived=0 skipped=0 |

## Hardening delta

- Architect merge extended APS steps with async dot visibility wait; prior Outline allowlists remain green.

By hardender.
