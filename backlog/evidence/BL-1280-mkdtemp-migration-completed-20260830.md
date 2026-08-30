# BL-1280 — the raw-mkdtemp migration is finished for extension/test

Coder, 2026-08-30.

## What shipped

1. **The 33 real call sites**, across 24 files, allocate through `mkTmpDir`.
   The 23 files that lacked the import got it. Every prefix string is
   unchanged, so no fixture directory name moved.
2. **The fixture strings** in `pilotMkdtempConventionCheck.test.js` and its
   property sibling split the literal across the `mkdtempSync(` boundary. The
   bytes written to disk are identical; there is simply no line for the scan to
   match.
3. **The exempt list is back to three.** BL-1209 had added the two pilot files;
   BL-1280 removes them, and `tmpDirMigrationGuard.test.js`'s assertion moves
   from five to three with it.
4. Acceptance step handlers, registered in `specs/pipeline/steps/index.js`.

## Why the exempt list, not the fixture strings, was the thing to fix

Both routes make the scan green. They differ in what they cost later: a
FILE-level exemption also hides a REAL raw call that file gains afterwards,
which is a silent hole in the guard, while splitting the literal costs one
comment and keeps the file scanned like every other. `tmpDir.js`'s own comment
already said the list is meant to stay "exactly the three documented paths".

## The lifetime audit, which is invariant 1

`mkTmpDir` is swept by an `afterEach`. A root allocated from a `beforeAll` — or
at module scope — is therefore destroyed after the FIRST test in its file, and
every later test sees a root that is gone. That is the one way this migration
could break something while the guard it satisfies goes green.

All 33 sites were classified before migrating: **0 in a `beforeAll`**, 1 in a
`beforeEach`, the rest in test bodies or local helper functions, and no file in
the set contains a `beforeAll` at all. So `mkTmpDir` is correct throughout and
neither `mkSharedTmpDir` nor `mkProcessTmpDir` is needed — which is what keeps
the slice small.

## One thing the ticket did not predict: a race the green scan exposed

With violations at zero, `tmpDirMigrationGuard.test.js` still failed in the
FULL unit lane, on something else entirely:

```
ENOENT: no such file or directory, open '.../extension/test/bl868-fixture-695761-peer0.property.test.js'
  at walk (test/helpers/rawMkdtempGuard.js:61)
```

Other suites in the same lane write transient fixture files INTO
`extension/test` and delete them again (bl868's
`bl868-fixture-<n>-peer<n>.property.test.js`), and with `isolate: false` they
run beside the scan. The race was always there; until the migration finished,
the walk always threw on a violation first, so it never showed. A guard that
ENOENTs is not green, so the walk now skips a file that vanished between
`readdir` and `readFile` — and ONLY on `ENOENT`, so a permission or IO error
still fails loudly. A file that no longer exists cannot hold a call site.

The deeper question — whether a suite should be writing scratch `.test.js`
files into the scanned tree at all — is left alone; it is bl868's surface, not
this ticket's.

## The declared invariants (BL-654)

`extension/test/bl1280MkdtempMigrationInvariants.property.test.js`, property
lane only.

**Invariant 1** is checked EXHAUSTIVELY over every `mkTmpDir` allocation in
`extension/test` — a finite enumerable domain, and a sampled version would pass
while one of 33 sites sat in a `beforeAll`. The generative half is the
sensitivity draw: a synthesised file placing the allocation in each
too-long-lived position in turn, which the same classifier must flag. Without
it the exhaustive half would pass against a classifier that answers "fine" to
everything.

Writing the classifier surfaced three shapes that LOOK like an allocation and
are not, all three live in the tree: `const mkdir = () => mkTmpDir('x-')`
(defines a maker; the allocation is wherever it is invoked), a fixture STRING
whose contents spell the call, and a comment mentioning it — this evidence
file's own property test had the last one. Each is excluded explicitly rather
than by loosening the match.

**Invariant 2** asserts both halves together, because they pull against each
other: keeping the fixture data intact is trivial if you exempt its file (what
BL-1209 did), and shrinking the exempt list is trivial if you rewrite the data
(which destroys the test the data belongs to). So for each data carrier the
property asserts the file is scanned AND clean, and that folding its adjacent
string literals brings the contiguous pattern back — i.e. the bytes it writes
still trip the detector.

**Non-vacuity, both shown by running:**
- invariant 1: added a `beforeAll(() => mkTmpDir(...))` to
  `topicThreadKind.test.js` → the exhaustive check FAILS naming that site.
  Restored, green.
- invariant 2: put `pilotMkdtempConventionCheck.test.js` back on the exempt
  list → both invariant-2 properties FAIL. Restored, green.

## Runs

| what | before | after |
|---|---|---|
| `findRawMkdtempCallSites(extension/test)` | 33 violations / 24 files | **0** |
| `npx vitest run test/tmpDirMigrationGuard.test.js` | 1 failed / 10 passed | **11 passed** |
| the same guard inside the FULL unit lane | failed (violations, then the ENOENT race) | **passes** |
| BL-1280 acceptance | — | **4/4** |
| BL-1280 property lane | — | **6/6** |
| `test/pilotMkdtempConventionCheck.test.js` | 9 passed | 9 passed |
| full unit lane | 27 files / 219 tests red | **26 files / 218 tests red** — exactly the migration guard removed, nothing else moved |

Every migrated file was also run on its own lane. Three reds among them are
pre-existing and were baselined against HEAD, unchanged:

- `pilotScopedCrapCheck.test.js` — 2 fail before and after.
- `alertTelemetry.property.test.js` and `bl669OutageFailoverSteward.property.test.js`
  — "No test suite found", the known `require('node:test')` class, both already
  on `property_suite_standing_allowlist.tsv` under BL-1175. Identical at HEAD.

## Left as found

- `specs/pipeline/steps/` — BL-1226's surface.
- The property lane's separate `tempDirTrapGuard` red — different guard,
  different lane.
- bl868's transient fixture files in the scanned tree, beyond making the walk
  tolerate them.
