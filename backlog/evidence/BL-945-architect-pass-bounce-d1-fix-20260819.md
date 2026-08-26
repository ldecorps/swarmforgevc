# BL-945 architect pass — QA D1 bounce-fix re-review, 2026-08-19

Reviewed commit: e6c402460 (via cleaner's merge a7e6443e2f, already an
ancestor of this worktree's HEAD from the prior BL-631 merge — no new
merge required).

## Scope
QA's D1 (`backlog/evidence/BL-945-qa-bounce-20260819.md`): both of
BL-945's own new test files called `fs.mkdtempSync(path.join(os.tmpdir(),
...))` directly instead of the shared `extension/test/helpers/tmpDir.js`
`mkTmpDir()` (BL-420's single sweep point). Fixed by switching both files
to `mkTmpDir()` and dropping the now-redundant manual `try/finally` +
`fs.rmSync` (the helper's own afterEach sweep covers it).

## Verification
- `node extension/out/tools/dependency-gate.js` on both changed files:
  PASSED, no forbidden edges.
- `npx vitest run test/tmpDirMigrationGuard.test.js`: 11/11 pass,
  including "the real extension/test/ tree has zero raw mkdtemp call
  sites outside the shared helper" — the exact check D1 failed on.
- `npx vitest run test/constitutionDocCitations.test.js`: 6/6 pass.
- `npx vitest run --config vitest.properties.config.mjs
  test/constitutionDocCitationsInvariant.property.test.js`: 4/4 pass.

## Invariants / required_wiring
Out of scope for this fix — D1 is fixture-cleanup hygiene in the test
files themselves, not the citation-check logic. The ticket's invariant
(check reports only unresolvable paths) and required_wiring
(`ARTICLES_DIR` comment literal) are untouched by this diff and were
already verified PASS in QA's own inventory before this fix.

## Verdict
COMPLIANT. Forwarding to hardener.
