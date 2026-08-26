# BL-1046 hardener pass — console grid tile held-ticket strip — 20260826

**Architect tip:** `2c53d741ca`
**Task:** `BL-1046-the-console-tile-names-the-ticket-a-seat-holds`

## Gates

| Gate | Result |
|------|--------|
| Vitest `residentSpyUiHtml.test.js` | 12/12 (+2 BL-1046 grid tile assertions) |
| Vitest `residentPaneSpy.test.js` | 18/18 |
| Vitest `bl994LiveScreenGrid.test.js` | 8/8 |
| APS BL-1046 | 11/11 |
| Gherkin mutation (hard) | 4/4 killed (Scenario Outline roles) |
| Surgical `bl1046_resident_pane_spy_mutation_sweep.sh` | killed=6 survived=0 skipped=2 |
| Surgical `bl1046_resident_spy_ui_html_mutation_sweep.sh` | killed=4 survived=0 skipped=3 |
| BL-149 cooldown | `skip-cooldown` on `residentSpyUiHtml.ts`; surgical sweep covers grid head |

## Hardening delta

- Unit: single-parcel hides `+N` badge; slug omitted when `ticketTitle` absent.
- APS steps: `requireCanonicalRole` rejects case-flipped role ids (killed 2 Gherkin
  survivors that `roleKey().toLowerCase()` had masked).
- Hand-authored surgical sweeps over `residentPaneSpy.ts` held-meta resolver and
  `residentSpyUiHtml.ts` grid tile head.

Tip purity: no `mutations/` caches staged.

By hardender.
