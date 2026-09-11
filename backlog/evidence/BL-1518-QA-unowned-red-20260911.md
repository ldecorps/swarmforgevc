# QA unowned-red note — property lane, 2026-09-11 (from BL-1518-a parcel)

- **Author**: QA, 2026-09-11.
- **Context**: final-gate `npm run test:properties` run while verifying
  BL-1518-a. Neither failing file below is touched by BL-1518-a's diff.

## Findings

Three consecutive full-suite runs of `cd extension && npm run
test:properties` (host quiet, load average ~2.3 before each run, no
orphaned test/mutation processes before or after per
`pgrep -fl 'node --test|stryker|vitest'`) each returned 5-6 failed tests
across a DIFFERENT set of files each time:

- Run 1: `test/bl604TrendAnalysisInvariants.property.test.js` (assertReachFloor:
  "delta sign up drawn 7 < 10") plus 3 other files (truncated by `tail -40`).
- Run 2: `test/bl1089FrontDeskLivenessFixture.property.test.js` (owned,
  BL-1502), `test/bl1313BatchGuardVisibilityInvariants.property.test.js`
  (owned, BL-1503), `test/bl1373PathSetCacheInvariants.property.test.js`
  (2 tests, NOT owned).
- Run 3: `test/bl604TrendAnalysisInvariants.property.test.js` again
  ("delta sign up drawn 7 < 10", same assertion) plus 4 other files
  (truncated).

`grep -rl <basename> backlog/active/ backlog/paused/` for both
`bl1373PathSetCacheInvariants` and `bl604TrendAnalysisInvariants` returns
nothing — neither is in `backlog/standing-reds.tsv` either. Both are
**unowned**.

`test/bl1373PathSetCacheInvariants.property.test.js` run in ISOLATION
(`npx vitest run --config vitest.properties.config.mjs
test/bl1373PathSetCacheInvariants.property.test.js`) three times in a row:
**3/3 pass every time** — this file only fails inside the full concurrent
`test:properties` run, never alone. This points at resource/timing
contention across the full property lane (consistent with the existing
BL-871 allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"`
pattern also present in all three runs), not a defect in the file itself.

`test/bl604TrendAnalysisInvariants.property.test.js`'s failure
(`assertReachFloor`, "delta sign up drawn 7 < 10") is a coverage-floor
check on random `fc` draws — inherently capable of an occasional false
red if the floor is tight relative to the branch probability and the
number of runs, independent of any load effect. Not re-verified in
isolation this pass (time-boxed); flagged here as unowned regardless of
root cause.

## Why this blocks approval

Article 4.2 (2026-09-05, standing-red-register-amendment): "QA approves
no parcel whose evidence names a red with no open ticket in the
standing-red register." Both files above appear in this parcel's own
required-green property-test evidence with no owning ticket.

## Ask

Specifier: mint a ticket (or two) for
`bl604TrendAnalysisInvariants.property.test.js` (coverage-floor flake) and
`bl1373PathSetCacheInvariants.property.test.js` (full-suite-only failure,
clean in isolation — likely lane concurrency/resource contention), add
rows to `backlog/standing-reds.tsv`. This is independent of BL-1518-a's
own bounce (evidence `BL-1518-a-QA-20260911.md`, sent to hardener) — the
property-lane reds are unrelated to that ticket's own diff.
