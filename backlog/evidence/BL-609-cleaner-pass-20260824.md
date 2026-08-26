# BL-609 cleaner pass — 2026-08-24

## Inbound

Coder tip `dab4a59a85` ancestry vs `origin/main` was hitchhiked (INTAKE /
done/M8 / acpHostClient / …). Tip commit surface alone is BL-609-only
(6 paths).

Cleaner recreated `swarmforge-cleaner` on `origin/main` and cherry-picked
`dab4a59a85` (hitchhike-free rematch tip `fbb578749f`). Resolved
`specs/pipeline/steps/index.js` to register only
`bl609ResidentSpyFontSizeControlSteps` (dropped hitchhiked `bl584` require).
Did **not** merge the dirty tip ancestry.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Checks run

1. **Compile** — `cd extension && npm run compile`: OK.
2. **Unit** — `npx vitest run test/residentSpyPaneFontSize.test.js
   test/residentSpyUiHtml.test.js`: 15/15 pass.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-609-resident-spy-font-size-control.feature`:
   7/7 pass.

## Cleanup performed

NONE — clamp/step helpers already small; HTML shell interpolates the same
constants; no CC tidy owed.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-609-resident-spy-font-size-control`.

By cleaner.
