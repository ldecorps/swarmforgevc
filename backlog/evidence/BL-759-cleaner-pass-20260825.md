# BL-759 cleaner pass — 2026-08-25

## Inbound

Coder tip `993beee166` — hitchhike CLEAN vs `origin/main`. Fast-forward
onto `origin/main` = `94149c7279`.

## Checks run

1. `npm run compile` — OK
2. `dependency-gate.js` — PASSED
3. Property — `bl759CursorOperatorFrontDeskCycle.property.test.js` — 2/2
4. Unit filter drain/timeout — 6/6
5. Gherkin — BL-759 feature — 10/10

## Cleanup performed

NONE — leaf extract (`telegramPipelineDrain.ts` +
`controlDrainTimeoutMs` in control core) already small; bot re-exports
preserve the public surface. No further DRY without inventing structure.

## Forward

`git_handoff` to architect, priority 50, task
`BL-759-cursor-operator-front-desk-bot-import-cycle`.

By cleaner.
