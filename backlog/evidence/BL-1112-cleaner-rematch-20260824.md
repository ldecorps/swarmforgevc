# BL-1112 cleaner rematch — 2026-08-24

## Inbound

Merged architect bounce `9afe018b5c` into `swarmforge-cleaner` via
`git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 9afe018b5c HEAD`.

## Inventory clearance (Article 4.4)

1. **Stamp-off step ↔ feature wording** — closed.
   `bl1113CursorHotfixStampOffSteps.js` now matches the feature phrase
   `HTML nbsp entity` (was `HTML numeric nbsp entity`). Assertion still
   locks numeric `&#160;` and forbids named `&nbsp;`.

## Checks run

1. **BL-1113 stamp-off** —
   `node specs/pipeline/cli.js specs/features/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.feature`:
   **9/9** pass.
2. **BL-1112 acceptance** (regression) —
   `node specs/pipeline/cli.js specs/features/BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox.feature`:
   **6/6** pass.

## Findings beyond that

NONE. Inventory empty.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox`.

By cleaner.
