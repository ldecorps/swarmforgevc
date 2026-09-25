# BL-1739 [unit: bl781 property reads deleted isAllowedBabysitterMatch] — coder pass, 2026-09-25

QA bounce D1 (evidence 940e9cbdac's QA pass, `backlog/evidence/BL-1739-QA-20260925.md`):
`test/bl781LiveGrepOffender.property.test.js` invariant 3 regex-reads
`isAllowedBabysitterMatch`, which BL-1739's earlier rebuild (c4c81e8f57)
deleted in favor of `isLiveCodePath`.

## The fix

- `specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js`: exports
  `isLiveCodePath` alongside `registerSteps` (pure function, no other
  callers exist repo-wide — `grep -rn "require.*bl611BabysitterdLifecycleSteps"`
  before this change found none).
- `extension/test/bl781LiveGrepOffender.property.test.js` invariant 3
  rewritten (kept, per QA's "never delete it") to import `isLiveCodePath`
  directly and assert each `DELETED_WAKE` path is NOT exempt from the
  live-code scan (`isLiveCodePath(dead) === true`), instead of
  regex-parsing a function that no longer exists. Follows BL-781 feature
  scenario 04's own posture (BL-611 scenario 15 still passes with no
  allowlist, by construction).
- `specs/pipeline/steps/bl781RetireDeadBabysitterFilesKeepListPreservedSteps.js`:
  found broken while verifying the BL-781 acceptance feature end to end
  (not named in QA's bounce, but caused by the same rename, and it blocks
  the same feature this ticket owns):
  - `loadBl611Scan()` sliced live source starting at
    `function isAllowedBabysitterMatch` — gone, so the slice silently
    grabbed the wrong span and `scanRepoForBabysitter` came back
    undefined. Start marker moved to `const RETIRED_FILE_PATHS`, the
    earliest declaration `scanRepoForBabysitter` transitively depends on
    (RETIRED_FILE_PATHS, FORBIDDEN_RETIRED_PATTERNS, listTrackedFiles,
    isLiveCodePath all sit between it and `function registerSteps`).
  - The "every step passes" step read `scan.offenders`; the real
    `scanRepoForBabysitter()` returns `{ forbidden, liveCodeMatches }`
    (BL-1739's rename). Fixed to read `scan.liveCodeMatches`.

## Non-vacuity (BL-654), checked directly

Temporarily broke `isLiveCodePath` (`swarmforge/scripts/` branch made an
exception for `babysitter_lib.bb`), reran the property test: invariant 3
failed as expected (`isLiveCodePath('...babysitter_lib.bb') === false`
vs expected `true`). Restored the real source (verified `git diff` shows
only the intended one-line export addition), reran: green.

## Verification run before forwarding

- `npx vitest run --config vitest.properties.config.mjs test/bl781LiveGrepOffender.property.test.js`:
  5/5.
- `node specs/pipeline/cli.js specs/features/BL-781-retire-dead-babysitter-files-keep-list-preserved.feature`:
  12/12 (was 11/12 before the step-handler fix, `scanRepoForBabysitter is
  not defined`).
- `node specs/pipeline/cli.js specs/features/BL-611-deterministic-babysitterd-managed-by-swarm-lifecycle.feature`:
  27/27 — the underlying scan this ticket touches stays green.
- `npx tsc -p .`: clean.

## Scope

Touched: `specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js` (export
only, no behavior change), `extension/test/bl781LiveGrepOffender.property.test.js`
(invariant 3 rewrite), `specs/pipeline/steps/bl781RetireDeadBabysitterFilesKeepListPreservedSteps.js`
(loadBl611Scan marker + scan field name), this evidence file.
`backlog/standing-reds.tsv` NOT touched (land step's job).

By coder.
