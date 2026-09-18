# BL-831 — bounce response (coder), 2026-09-18

## The finding

Cleaner bounced (`backlog/evidence/BL-831-bounce-cleaner-20260918.md`):
`specs/pipeline/steps/bl831BubblePipelineBoardPageSteps.js`'s `ensure(ctx)`
created a fresh `fs.mkdtempSync` root per feature scenario with no cleanup
anywhere — a permanent leak of one directory under `os.tmpdir()` per run,
same class already fixed this session in `bl1624`/`bl1626`/`bl1632`/`bl693`'s
own handlers via the `fixtureReaper.js` `onAbnormalExit`-tracked pattern.

## The fix

Applied the identical `bl693DocsDuplicateParagraphGuardSteps.js` shape:

- `trackedDirs` Set + `trackDir(dir)` (returns an idempotent remover) +
  `onAbnormalExit` registration once at module load, so an uncaught throw
  mid-scenario or a killed runner still reaps every tracked root.
- `cleanupFixtureRoot(ctx)` helper, called from a `finally` in each
  scenario's own terminal `Then` step (all 8 scenarios' Backgrounds call
  `ensure(ctx)`, so every scenario needs cleanup).
- `ensure(ctx)` now calls `trackDir(root)` the moment the directory exists
  and stores the remover on `ctx.cleanupBl831Root`.

## Confirmed

```
$ rm -rf /tmp/bl831-*
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-831-*.feature
... 8/8 scenarios pass ...
$ ls -d /tmp/bl831-*
(eval):13: no matches found: /tmp/bl831-*
```

Zero leaked directories after a full 8-scenario run.

## Verification

- `npx tsc -p .` (extension/): clean (unrelated — this bounce touches only
  the `.js` step handler, no TypeScript).
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-831-bubble-pipeline-board-page.feature`
  — 8/8 scenarios green, zero leaked `/tmp/bl831-*` roots.
- `npm test` (extension/): 630/630 test files passed, 10761/10761 tests
  passed. (Picked up BL-775's sibling files this branch also carries via
  the merged cleaner tip — unrelated to this fix, all green.)
- `npm run test:properties` (extension/): green (see run log).

## Files touched

- `specs/pipeline/steps/bl831BubblePipelineBoardPageSteps.js`
- this evidence file
