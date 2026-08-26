# BL-1012 tmpDirMigrationGuard violation — discovered during BL-621 hardening

**Date:** 2026-08-21
**Discovered by:** hardener, while running the standing whole-tree guards
(`extension/test/*Guard*.test.js`) required for the BL-621 parcel per the
hardener's own 2026-08-19 rule (a parcel touching `specs/pipeline/steps/` or
`extension/test/` must run every standing guard before forwarding).

## Finding

`extension/test/tmpDirMigrationGuard.test.js` — "the real extension/test/
tree has zero raw mkdtemp call sites outside the shared helper" — FAILS:

```
expected zero raw mkdtemp call sites, found:
[{ file: '.../extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js', line: 44 }]
```

`mkRoot()` in that file (line 44) calls `fs.mkdtempSync(path.join(os.tmpdir(),
'sfvc-bl1012-prop-'))` directly instead of going through the shared
`mkTmpDir()` helper in `extension/test/helpers/tmpDir.js` (BL-420's
single-cleanup-point convention).

## Scope confirmation — NOT a BL-621 defect

- `bl1012FreshnessSelfInflictedIncidents.property.test.js` was authored
  entirely under commit `ddbf1b130` ("BL-1012: make the freshness threshold
  contention-relative, bounded, and self-aware").
- That commit, and the file, are **already on `origin/main`**
  (`git cat-file -e origin/main:extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js`
  succeeds), landed via QA approval commit `5954b3828` ("BL-1012 QA approval:
  ... verified independently ... ").
- BL-621's own diff never touches this file. This is a pre-existing gap in
  already-shipped code, found incidentally, not something BL-621 introduced
  or is responsible for fixing under its own ticket scope ("An Approval
  Authorizes Only Its Ticket's Work").

## Why it wasn't caught earlier

The standing-guard sweep only runs when a role's own parcel touches
`extension/test/` or `specs/pipeline/steps/` (the rule that requires it).
Whatever hardening pass BL-1012 went through evidently did not run this
specific guard against the full tree before forwarding — the same failure
mode the guard's own originating incidents (BL-631, BL-945) describe.

## Suggested fix (not applied here — out of BL-621's scope)

In `mkRoot()`, replace:
```js
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1012-prop-'));
```
with:
```js
const { mkTmpDir } = require('./helpers/tmpDir');
...
const root = mkTmpDir('sfvc-bl1012-prop-');
```
(mirrors every other test file's convention; verify `os`/`path` requires are
still needed elsewhere in the file before removing them.)

## Disposition

Left unfixed here per ticket-scope discipline. Flagged via `note` (priority
00) to specifier and coordinator to mint a `type: defect` ticket. BL-621's
own forward is unaffected — this finding does not block or bounce BL-621.

---

## Disposition — NO TICKET MINTED (specifier, 2026-08-21)

**The violation was already fixed before this evidence file was written.**
No defect ticket exists or is coming; this section closes the record.

- `283045133` "BL-1012: migrate the property test off raw mkdtemp to the
  shared helper" (by cleaner, authored 23:19:40, on `main` by 23:36:38)
  replaced line 44 with `mkTmpDir('sfvc-bl1012-prop-')` and added the
  `require('./helpers/tmpDir')` on line 6. Its own message records that the
  **coder's note** flagged it — so the system did catch this, just through a
  different path than the standing-guard sweep.
- That commit is an ancestor of `origin/main`. Verified by content, not
  existence: `git show origin/main:extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js
  | grep -n 'mkdtemp\|mkTmpDir'` returns only the two `mkTmpDir` lines.
- `npx vitest run test/tmpDirMigrationGuard.test.js` is green on `main`
  (11/11). The four remaining `mkdtempSync` hits under `extension/test/` are
  the guard's own fixtures, its self-reference, and the shared helper — all
  deliberately exempt.
- This evidence file was committed at 23:48:48, **twelve minutes after** the
  fix landed. The hardener's worktree had not merged `main`, so the sweep
  read a stale copy of the file.

### Why the origin/main check above did not catch it

The finding's own scope-confirmation step used `git cat-file -e
origin/main:<path>`, which tests only that the **file** exists on `main` —
true for any already-merged code whether or not the defect survives. A
content probe (`git show origin/main:<path> | grep '<offending literal>'`)
would have shown `mkTmpDir` immediately. Recorded as a standing rule in
`swarmforge/roles/hardender.prompt` ("`git cat-file -e` proves the FILE
exists, never that the DEFECT does") so the next whole-tree sweep charges a
hit only against content it re-read from a fresh ref.

**BL-621 is unaffected either way** — the original disposition was right that
this never blocked or bounced it.
