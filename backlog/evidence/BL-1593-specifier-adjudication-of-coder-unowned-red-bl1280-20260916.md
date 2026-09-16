# Coder unowned-red note (bl1280 guard) on the BL-1588 parcel - specifier adjudication (2026-09-16)

Inbound: `00_20260916T093427Z_001976_from_coder_to_specifier` (recipients
specifier, coordinator), "unowned-red: bl1280 raw mkdtempSync,
nightClosingCeremonyRotateDocFallback:29". Coder evidence, untracked in the
coder worktree at adjudication time and landing with BL-1588's parcel:
`backlog/evidence/BL-1588-coder-unowned-red-bl1280-20260916.md`.

## What the coder observed

During BL-1588's full property-lane verification,
`extension/test/bl1280MkdtempMigrationInvariants.property.test.js`
invariant 2 ("leaves the real tree with no raw call site under the
three-path list") failed: `findRawMkdtempCallSites(TEST_DIR)` returned one
site, `extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js`
line 29, against an expected `[]`. The coder read the file's header
("Hotfix 2026-09-16"), attributed it to `a27d082c2d`, judged it outside
BL-1588's scope and reported it as an unowned red. All correct.

## Reproduced on main (read and run, not guessed)

- `git log --diff-filter=A -- extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js`
  -> `a27d082c2d` (human hotfix, 2026-09-16, stamp-off ticket BL-1591 in
  `backlog/paused/`, approved, medium).
- Specifier run on main at `012bb81731`:
  `npx vitest run --config vitest.properties.config.mjs test/bl1280MkdtempMigrationInvariants.property.test.js`
  -> 1 failed, 5 passed, 1.14 s; the failing assertion is
  `bl1280MkdtempMigrationInvariants.property.test.js:232`
  `assert.deepEqual(findRawMkdtempCallSites(TEST_DIR), [])`, received
  `[{ file: ".../nightClosingCeremonyRotateDocumenterFallback.test.js", line: 29 }]`.
- Line 29, inside `makeFixture()`:
  `const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncc-rotate-fallback-'));`.
  `makeFixture()` is called from each of the three `test()` bodies (lines
  118, 133, 144); the file has no `rmSync`, `afterEach` or `afterAll`, so
  three roots leak per run.
- `extension/test/helpers/tmpDir.js` offers `mkTmpDir` (per-test, swept by
  `tmpDirSetup.js`'s afterEach in the unit lane), `mkSharedTmpDir`
  (afterAll) and `mkProcessTmpDir` (process exit). One root per test body
  is `mkTmpDir`'s contract exactly; the other two would outlive their
  tests (BL-1280 invariant 1).

## Ownership check

- `grep -rlE 'bl1280|nightClosingCeremonyRotateDocumenterFallback' backlog/paused backlog/active`
  hits only BL-1591, which names the fallback test as part of the hotfix's
  landed diff it reviews and is FIRM that it changes no production file and
  extends tests only if the coder chooses to. It does not own the guard's
  red, and folding a fix scenario into an approved feature file would need
  a re-pend that posts no fresh ask (BL-1455).
- `backlog/standing-reds.tsv` carried no row for the guard file; register
  before this pass 9 rows (BL-1588 x4, BL-1589 x1, BL-1592 x4), all owned.
- Genuinely unowned under Article 4.2.

## Outcome

Minted BL-1593 (`type: defect`, `severity: high`, epic code-quality-gates,
`depends_on: []`) owning the guard file's row; one register row added
(first_seen 2026-09-16, register now 10 rows, all owned - one more unowned
red trips BL-1429's throttle); a bookkeeping line added to BL-1591's
`notes:` naming BL-1593 as the migration's owner so the stamp-off parcel
does not also touch line 29 (the two share the file and must not
co-activate, Article 3.2.3). The coordinator sent the paused-ready note and
the coder (holding BL-1588) the owner note. No parcel is withheld on this
red today.
