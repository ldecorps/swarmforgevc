# BL-1160 QA pass — rematch 4 — 20260826

**Cleaner tip:** `d6bb15fd39` (re-cut BL-1160-only post-BL-1159 + APS hardening)
**Documenter handoff:** `997928298e` (yaml-only abandon; clean tree from cleaner tip)
**Task:** `BL-1160-live-screen-activity-dot-per-tile`
**Sibling check:** `VERIFY BL-1160` (exit 0)

## Land-tip integration

QA integrated cleaner re-cut `d6bb15fd39` onto `origin/main` @ `1a97fef0f9` (post-BL-588). Restored `bl588BatchRecoverySteps` in `index.js` (+1 line). **11 paths** vs `origin/main`.

## Ticket gates

| Gate | Result |
|------|--------|
| Acceptance `BL-1160-live-screen-activity-dot-per-tile.feature` | 8/8 PASS |
| Unit `residentSpyUiHtml.test.js` | 18/18 PASS |
| Mutation sweep `bl1160_resident_spy_ui_html_mutation_sweep.sh` | 4/4 killed |
| Compile | PASS |
| `index.js` bl1153 + bl1159 + bl1160 + bl588 | PASS |

## Inventory

NONE — approve land on `origin/main`.

By QA.
