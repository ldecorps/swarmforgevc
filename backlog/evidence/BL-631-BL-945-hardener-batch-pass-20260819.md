# BL-631 + BL-945 hardener batch pass (QA-bounce fixes) — 2026-08-19

## Batch scope
Two equal-priority parcels arrived together: the coder's fixes for QA's
own D1 bounces on BL-631 (`3eac819b2`, `fixtureReaper.track()` wiring for
the fake-coordinator tmux fixture) and BL-945 (`e6c402460`, switching both
new test files from raw `fs.mkdtempSync` to the shared `mkTmpDir()`
helper). Per batch-mode protocol, merged both and ran ONE combined
hardening pass over the union of their changed files rather than two
separate passes.

## Files in scope
- BL-631: `specs/pipeline/steps/bl631BabysitterDetectsPipelineCodeOnMainSteps.js`
  (single file).
- BL-945: `extension/test/constitutionDocCitations.test.js`,
  `extension/test/constitutionDocCitationsInvariant.property.test.js`.
(`extension/test/vitestForkCeiling.property.test.js`, visible in the wider
merge via cleaner's own branch history, belongs to sibling ticket BL-935 —
still architect-bounced, not touched by either fix commit per `git show
--stat` on both, not reviewed here.)

## Tooling scope check
No `extension/src/*.ts` touched by either fix. Stryker/CRAP/DRY
inapplicable.

## Checks run (complete inventory, not first-failure-stop)

1. **Both standing whole-tree guards, independently re-run against the
   real tree** (the exact two guards QA's bounces named, and the same two
   this session's own rule_proposal now requires checking on any parcel
   touching `specs/pipeline/steps/` or `extension/test/`):
   `npx vitest run test/tmuxReaperGuard.test.js
   test/tmpDirMigrationGuard.test.js
   test/constitutionDocCitations.test.js` — **24/24 pass**, both
   "the real ... tree has zero violations" assertions green (previously
   the exact failures QA bounced on).
2. **BL-945's property test, independently re-run**: `npx vitest run
   --config vitest.properties.config.mjs
   test/constitutionDocCitationsInvariant.property.test.js` — **4/4
   pass**.
3. **Both tickets' own acceptance features, independently re-run**:
   - `specs/features/BL-631-babysitter-detects-pipeline-work-on-main.feature`
     — **17/17 PASS**, including scenario 17 (2026-07-25 regression
     reproduces exactly) and scenario 8 (merge-commit case) — unaffected
     by the fixture-teardown-only fix, as expected.
   - `specs/features/BL-945-constitution-doc-citations-resolve-on-main.feature`
     — **4/4 PASS**.
4. **Leak/process check**: 0 leaked `bl631`/`bl945`-prefixed fixture
   dirs; `git status --short` clean; no stray tmux servers beyond the
   live-swarm sockets.
5. **Fix-scope discipline**: confirmed via `git show --stat` on both
   fix commits that each touches only the files named above — no
   detection-logic, invariant, or required_wiring surface reopened by
   either fix (both are test-fixture-teardown-only changes, matching
   both architect re-reviews' own scope statements).

## Outcome
No defects found in either fix. Both QA-bounced whole-tree guard
violations independently reconfirmed fixed against the real tree, not
just re-read from either evidence file. Both tickets' full acceptance
suites reconfirmed green, unaffected by the narrow fixture-hygiene fixes.

Forwarding BOTH tickets to documenter, each as its own `git_handoff`
under its own stable task name (Article 2.6).

By hardener.
