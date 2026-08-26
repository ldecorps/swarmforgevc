# BL-579 cleaner pass — 2026-08-24

## Inbound

Coder tip `2b7a812278` ancestry vs `origin/main` was hitchhiked. Tip commit
surface alone is BL-579-only (6 paths).

Cleaner recreated `swarmforge-cleaner` on `origin/main` and cherry-picked
`2b7a812278` (resolved `specs/pipeline/steps/index.js` to register only
`bl579HandoffMechanismBriefingDiagramSteps` — tip also listed BL-570 which
is not on this tip).

Hitchhike gate → CLEAN.

## Checks run

1. **Compile** — `cd extension && npm run compile`.
2. **Unit** — `npx vitest run test/renderBriefingDiagramsCli.test.js`: 4/4.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-579-handoff-mechanism-briefing-diagram.feature`:
   3/3 pass. Required wiring: allowlist entry + steps in `index.js`.

## Cleanup performed

- Cherry-pick conflict: index registers BL-579 only (no hitchhiked BL-570
  require).

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-579-handoff-mechanism-briefing-diagram`.

By cleaner.
