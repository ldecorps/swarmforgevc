# BL-1009 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `a4b9db88b8` (unified pipeline grid + caption swarm
badges; remote rows never show live held-by-role; `readSwarmName` wired in
conciergeTick) into `swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor a4b9db88b8 HEAD`.

## Checks run

1. **Compile** — `npm run compile` in `extension/` (acceptance reads
   gitignored `out/`).
2. **Unit** — `npx vitest run test/pipelineBoard.test.js`: 134/134.
3. **Properties** —
   `npx vitest run --config vitest.properties.config.mjs test/pipelineBoard.property.test.js`:
   12/12.
4. **Gherkin** —
   `node specs/pipeline/cli.js specs/features/BL-1009-one-unified-pipeline-grid-across-swarms.feature`:
   8/8. Required wiring: `bl1009` in `index.js`; `readSwarmName` import in
   `conciergeTick.ts`.

## Cleanup performed

- `conciergeTick.ts`: extracted `ticketMetaFromItem` so active/paused/done
  share one meta shape (including optional `swarm`).

## Findings beyond that

NONE. Inventory NONE. Note: gates are red until local `npm run compile`
because `out/` is gitignored and step handlers require it.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1009-one-unified-pipeline-grid-across-swarms`.

By cleaner.
