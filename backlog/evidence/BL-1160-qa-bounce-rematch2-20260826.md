# BL-1160 QA bounce (rematch 2) — 20260826

**Commit checked:** `0357b90a0` (Merge documenter `62c9b9f668`)
**Task:** `BL-1160-live-screen-activity-dot-per-tile`
**Routing:** `coder`

## Gates

| Gate | Result |
|------|--------|
| Unit `residentSpyUiHtml.test.js` | **18/18 PASS** (BL-1160 + BL-1153) |
| Acceptance | **5/8 FAIL** — tile dots `got 0` visible / `hidden` in palette scenarios |
| Mutation sweep | 4/4 killed |
| Compile | PASS |
| Tip purity | **FAIL** — 63 sibling hitchhiker paths |

## Defects

**D1 — acceptance (blame: coder):** APS scenarios see zero visible per-tile dots despite unit tests green.

- **Failing command:** `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1160-live-screen-activity-dot-per-tile.feature`
- **First error:** `expected 8 visible tile dots, got 0`; palette steps `got hidden`
- **Expected:** visible per-tile dots after grid render with activitySignal payload
- **Observed:** `bl1160Render.visibleTileDotCount === 0` in step handler

**Remediation:** `specs/pipeline/steps/bl1160LiveScreenActivityDotPerTileSteps.js` + `residentSpyUiHtml.ts` — ensure APS render path invokes the same `setStatus` / `updateAllPaneStatusDots` refresh as unit tests (likely missing post-render tick or aggregate kind).

**D2 — behavior (blame: cleaner):** tip entangled with BL-588/1159/653/660/INTAKE (63 paths).

**Remediation:** re-cut BL-1160-only from `origin/main` after D1 fix.

## Inventory

D1 (coder), D2 (cleaner). Route **coder**.

By QA.
