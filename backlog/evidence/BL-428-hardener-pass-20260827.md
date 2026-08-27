# BL-428 — hardener tip-pure pass — 20260827

## Inbound

Architect `ccf2883887` / tip-pure content `279bf406eb` (coder `742f2d2902`).
Task `BL-428-decrap-preexisting-high-crap-on-touch` — paneHistory
`detectFooterLineCount` module decrap slice.

## Hardening

1. **Unit** — `paneHistory.test.js` **18/18**; `footerDetectionParity.test.js`
   **11/11**; `footerAwareScroll.test.js` **14/14** (43 total).
2. **CRAP** — scoped `crapReport.js src/panel/paneHistory.ts` after targeted
   vitest coverage: all functions **≤6** (`detectFooterLineCount` **3.00**).
3. **Surgical** — `bl428_pane_history_mutation_sweep.sh`: **8/8 killed**
   (0 survived). Added bottom-most-prompt regression test to kill top-down
   scan survivor.

## Gates

| Gate | Result |
|---|---|
| Unit (paneHistory + parity + scroll) | **43/43** |
| CRAP (`paneHistory.ts`) | **≤6** all functions |
| Cooldown | **run** (`paneHistory.ts`, 55d) |
| Gherkin / acceptance | n/a (standing tracker decrap slice; no feature) |
| Properties | n/a |
| Surgical | **8/8 killed** |

## Tip purity

Handoff delta on architect tip: hardener regression test, surgical sweep,
this evidence. BL-428 product paths only — no sibling hitchhikers.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-428-decrap-preexisting-high-crap-on-touch`.

By hardender.
