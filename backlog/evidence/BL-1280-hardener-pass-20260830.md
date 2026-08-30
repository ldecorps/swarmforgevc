# BL-1280 — hardener pass

Hardener, 2026-08-30.

## Scope

Every changed file is `extension/test/**` (test code) or acceptance-pipeline
step/property-test JS — no `extension/src` involved, so Stryker/CRAP/DRY do
not apply (same basis as the architect's review and the three prior
BL-1274/1279/1277 passes this shift).

## Hand-authored mutation sweep — found and closed a real gap

**Mutant: broaden `findRawMkdtempCallSites`'s `catch (err)` block in
`extension/test/helpers/rawMkdtempGuard.js` to swallow every read error, not
just `ENOENT`.** The coder's own evidence and the architect's review both
state "only ENOENT is skipped, so a permission or IO error still fails
loudly" as a specific, load-bearing property of the fix — but no test
exercised it. Hand-mutated (removed the `err.code === 'ENOENT'` check,
`continue` unconditionally) and re-ran everything the ticket's own
qa_e2e_procedure names: `tmpDirMigrationGuard.test.js`,
`pilotMkdtempConventionCheck.test.js`, the BL-1280 acceptance feature, and the
BL-1280 property lane. **All green with the mutant in place** — the claim in
both evidence files was true but unverified.

**Closed.** Added
`extension/test/tmpDirMigrationGuard.test.js` > "a non-ENOENT read failure
still throws - only a vanished file is tolerated": plants a file, `chmod
000`s it to force `EACCES` on read, and asserts `findRawMkdtempCallSites`
throws an error that is NOT `ENOENT`. Confirmed this test fails against the
mutant (`Missing expected exception`) and passes against the real code;
restored the source file to a clean `git diff` before finishing. `chmod` is
restored in a `finally` regardless of assertion outcome.

## Verification

- `npx vitest run test/tmpDirMigrationGuard.test.js
  test/pilotMkdtempConventionCheck.test.js` — 21/21 (was 20/20 before my
  added test; the migration guard file is now 12 tests, was 11).
- `node specs/pipeline/cli.js specs/features/BL-1280-...feature` — 4/4.
- `bl1280MkdtempMigrationInvariants.property.test.js` (properties lane) —
  6/6.
- Full `vitest run --config vitest.config.mjs`, **after `npm run compile`**
  (the first run pre-compile showed a spurious 27 failed files / 222 failed
  tests — a stale `out/` from before this merge, not a regression; compiling
  cleanly resolved it): **26 failed files / 218 failed tests / 9437 passed**,
  exactly matching the coder's and architect's claimed post-fix baseline
  (218, not 219 — `tmpDirMigrationGuard.test.js` is no longer in the failing
  set at all; the +1 passed test over the architect's 9436 is my own new
  regression test). Diffed the failing-file list: no new file appears that
  wasn't already red at the architect's tip, and `tmpDirMigrationGuard.test.js`
  itself is confirmed absent from the red list.
- Whole-tree guards for `extension/test/`: the same standing 4 as
  BL-1274/BL-1279's passes minus one — `tmpDirMigrationGuard` itself no
  longer fails (this ticket's own subject), leaving
  `liveRepoDerivationGuard`, `socketFixtureShortRootGuard`,
  `tempDirTrapGuard` as pre-existing, unrelated debt.

## CRAP / DRY / mutation-site count

Not applicable — no `extension/src` file in this ticket's diff.

Forwarding to documenter.
