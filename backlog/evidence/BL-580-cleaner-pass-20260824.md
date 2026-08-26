# BL-580 cleaner pass — 2026-08-24

## Inbound

Coder tip `5a69f9909b` ancestry vs `origin/main` was hitchhiked. Tip commit
surface alone is BL-580-only (4 paths: `front-desk-flow.mmd`, allowlist
entry in `render-briefing-diagrams.ts`, acceptance steps + register).

Cleaner recreated `swarmforge-cleaner` on `origin/main` and cherry-picked
`5a69f9909b` (hitchhike-free rematch tip `bb166ecb3`). Did **not** merge the
dirty tip ancestry.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Checks run

1. **Compile** — `cd extension && npm run compile`: OK (required before
   acceptance; steps read `extension/out/tools/render-briefing-diagrams`).
2. **Unit** — `npx vitest run test/renderBriefingDiagramsCli.test.js`:
   4/4 pass (after allowlist fixture update below).
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-580-front-desk-mechanism-briefing-diagram.feature`:
   2/2 pass (render + fail-loud on bad mermaid).

## Cleanup performed

Coder tip left `renderBriefingDiagramsCli.test.js` pinned to the pre-BL-580
three-name allowlist (would stand red). Updated fixture + expected names to
include `front-desk` / `front-desk-flow.mmd`; maxBuffer comment to four PNGs.

## Findings beyond that

NONE. Inventory NONE (after the unit-test allowlist sync).

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-580-front-desk-mechanism-briefing-diagram`.

By cleaner.
