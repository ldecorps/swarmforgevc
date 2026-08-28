# Vitest "No test suite found" hits property test files using `require('node:test')` (2026-08-27)

## What I found

`npx vitest run --config vitest.properties.config.mjs <file>` reports
`Error: No test suite found in file <path>` (exit 1) for any
`*.property.test.js` file that explicitly `require('node:test')` for its
`test` function, even though the tests inside genuinely run and pass —
confirmed by running the SAME file directly via `node --test <file>`,
which correctly collects and reports every case (all green).

## Scale

At least 14 files use this pattern and are affected, spot-checked two
completely unrelated ones in isolation (no shared cause beyond the import
style):
- `test/bl1200FixtureGitWritesStayInOwnRepo.property.test.js` (new this
  session, BL-1200)
- `test/alertTelemetry.property.test.js` (pre-existing, unrelated to
  anything I reviewed today)

Full grep for the pattern: `grep -l "require('node:test')" test/*.property.test.js`
— 14 matches, listed in my session notes, not reproduced here in full.

## Not a per-ticket defect

`vitest.config.mjs`'s own comment (line 5-8) explains `globals: true` was
added so files using bare `test(...)` (no import) work without per-test
import churn. A file that explicitly imports `test` from `node:test`
instead bypasses Vitest's own global registration, and Vitest's collector
apparently cannot see node:test's own registration in this environment —
this reproduces on a file untouched by any of today's incidents, so it
predates BL-1200/BL-1188/BL-1189/BL-592 entirely.

## Consequence

`npm run test:properties` (the real CI-equivalent command) genuinely fails
on any of these 14+ files today, non-zero exit, "No test suite found" —
this is a live, currently-red condition for whoever runs the full property
suite, not a hypothetical.

## Not filing a ticket myself

Grepped `backlog/{paused,active,hold,done}` for "No test suite found" and
related terms — no existing ticket found — but I'm flagging via note
rather than minting, since diagnosing root cause (Vitest version, a config
option, a node:test/Vitest interop bug) is investigation work I have not
done and is outside an architecture review's scope.
