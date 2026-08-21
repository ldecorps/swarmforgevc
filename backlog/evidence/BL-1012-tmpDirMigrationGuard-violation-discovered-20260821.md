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
