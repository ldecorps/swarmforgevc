# BL-1015 — cleaner re-fix, send-back #1, D2

D2 (import cycle between `boyScoutRun.ts` and `boyScoutRun/cli.ts`, blamed on
cleaner) is cleared here. D1 (git-index gap on a failed commit, blamed on
coder) arrived already fixed in `126b913822` and is untouched by this commit.

## What was wrong

`cli.ts` imported `boyScoutRun` from the barrel `../boyScoutRun`, and the
barrel dynamically `require()`s `./boyScoutRun/cli` in its
`require.main === module` block. The architect's bounce note said the dynamic
`require` "does not participate in the static import graph dependency-cruiser
walks" — that turned out to be incorrect for this project's ruleset:
dependency-cruiser resolves `require()` calls (dynamic or not) into edges the
same as static imports, and `.dependency-cruiser.cjs`'s `acyclic` rule has no
`dependencyTypesNot` restriction excluding them. My first attempt (dropping
the barrel's `export { main } from './boyScoutRun/cli'` re-export alone) left
`node extension/out/tools/dependency-gate.js` still reporting the cycle,
confirming the dynamic edge really was load-bearing here.

## Fix

Moved the `boyScoutRun` state machine itself (the `boyScoutRun` function and
its private `blank` helper) out of the barrel into a new
`boyScoutRun/run.ts`. Both the barrel (`export { boyScoutRun } from
'./boyScoutRun/run'`) and `cli.ts` (`import { boyScoutRun } from './run'`) now
depend inward on `run.ts`; neither depends on the other. The barrel's dynamic
`require('./boyScoutRun/cli')` is now a leaf edge with no path back.

```
node extension/out/tools/dependency-gate.js
```

now reports only the three pre-existing `telegram-front-desk-bot.ts` /
`telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts` edges
the architect's own bounce note already excluded as unrelated pre-existing
debt — the `boyScoutRun` edge is gone.

`main` was also dropped from the barrel's static exports (kept as a separate,
smaller correction): a consumer that wants it reaches
`./boyScoutRun/cli` directly, the same path the dynamic `require` already
uses. `boyScoutRun.test.js` updated its import accordingly.

## Verification

- `npm run compile`: clean.
- `node extension/out/tools/dependency-gate.js` (full repo): only the three
  pre-existing telegram edges; the boyScoutRun cycle is gone.
- `npx vitest run --config vitest.config.mjs` (full unit suite): 471 files,
  8355 tests, all pass (was 470/8347 before this ticket's D1 fix landed; D1
  added `boyScoutRunCommitIndex.test.js`'s 4 tests plus assertions, this
  commit adds none new — pure move, no behavior change).
- `npx vitest run --config vitest.properties.config.mjs boyScoutRun.property.test.js`:
  passes.
- `specs/pipeline/scripts/run_acceptance.sh` on this ticket's feature: 9/9
  scenarios pass.
- `swarmforge/scripts/gherkin_lint_gate.sh` on the feature: parses cleanly.
- `npm run dry` (jscpd): 34 clones, same as before this commit — none in a
  touched file.
- `node extension/out/tools/mutation-site-count.js` on every touched file:
  `boyScoutRun.ts` 84, `boyScoutRun/run.ts` 92, `boyScoutRun/cli.ts` 5 — all
  within the 100-site threshold. `boyScoutRun/commit.ts` (D1's file, not
  touched by this D2 fix) is 104, marginally over; left whole — it is a
  cohesive commit-with-rollback module and a split for 4 sites would cost
  more clarity than it buys (BL-485 soft-advisory judgment, not a gate).

By cleaner.
