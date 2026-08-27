# BL-1188 bounce correction — D1 retracted (2026-08-27)

## What was wrong

`backlog/evidence/BL-1188-architect-bounce-20260827.md`'s D1 claimed
`extension/test/pipelineGridLive.test.js` never runs because it lacks
`const { test } = require('node:test');`. That claim is **WRONG** — retracted.

## Root cause of my own mistake

I invoked the file directly with `node --test test/pipelineGridLive.test.js`,
which fails because bare `test(...)` needs either an explicit
`node:test` import or a runner that injects it as a global. But that is
**not how this project runs its tests**. `extension/vitest.config.mjs:43`
sets `globals: true` specifically so — per its own comment at line 5-8 —
"the 88 migrated files" can use bare `test(...)` (node:test
module-as-function style) with no per-test import churn. `npm test`
(`package.json`'s real entry point) runs Vitest, not `node --test`.

Verified directly: `npx vitest run --config vitest.config.mjs
test/pipelineGridLive.test.js` — **6/6 pass**. I also re-ran the two
sibling files I found the same shape in while reviewing BL-1189
(`residentPaneSpy.test.js`, `residentPaneLive.test.js`) the same way — both
pass too (22/22 and 19/19). None of these three files have a defect; they
all follow the established, intentional convention for this codebase. My
error was the invocation method, not anything in the coder's diff.

## Disposition

- **D1 is RETRACTED.** Do not act on it.
- D2 (leaked `mkdtempSync` fixture dir in
  `specs/pipeline/steps/bl1188PipelineGridLiveStageParitySteps.js`) and D3
  (acceptance feature file never committed — since fixed by my own
  mechanical unblock commit `4a60b6070`, see the original evidence file)
  **still stand** — those were not test-runner-invocation-dependent; D2 was
  confirmed by direct code reading (no `afterEach`/`finally` anywhere in
  the file) and D3 by `git cat-file -e` / `git log --all -- <path>`.
- Going forward this session I am running `npx vitest run --config
  vitest.config.mjs <file>` for unit-test verification, never bare `node
  --test`, to avoid repeating this mistake.

## Apology / process note

This correction is being sent as a `note` to coder (who now holds the
bounced parcel) before they spend time on a non-issue. Sorry for the churn.
