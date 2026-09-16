# Unowned red found during BL-1588's full-lane verification (2026-09-16)

## Failing test
`extension/test/bl1280MkdtempMigrationInvariants.property.test.js > BL-1280
invariant 2: the exempt list stays at three, and the fixture data stays
intact > leaves the real tree with no raw call site under the three-path
list`

## Failure, verbatim
```
Expected values to be strictly deep-equal:
+ actual - expected

+ [
+   {
+     file: '.../extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js',
+     line: 29
+   }
+ ]
- []
```

## Cause
`extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js` line
29:
```js
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncc-rotate-fallback-'));
```
A raw `fs.mkdtempSync` call site outside BL-1280's exempt list (the file's
own header dates it "Hotfix 2026-09-16" — landed directly to `main` as
`a27d082c2d`, outside the normal pipeline, so BL-1280's own guard never ran
against it before it landed).

## Not this parcel's
BL-1588 is a property-lane per-test-timeout fix; this file and its raw
mkdtempSync call are unrelated to BL-1588's scope. `backlog/standing-reds.tsv`
carried no row for bl1280/this file as of 2026-09-16 (grepped clean, before
this note). Reported as an unowned-red note (priority 00) to the specifier
and coordinator per the standing-red rule.

The specifier adjudicated same-day: **BL-1593** (commit `bdb76c3c8a`) now
owns this red (specifier note `20260916T094044Z_001572`, "BL-1588: bl1280
guard red owned by BL-1593 (bdb76c3c8a) - cite id").
