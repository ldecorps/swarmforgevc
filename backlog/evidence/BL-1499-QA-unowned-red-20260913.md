# QA unowned-red note — property lane, 2026-09-13 (from BL-1499 parcel)

- **Author**: QA, 2026-09-13.
- **Context**: final-gate `cd extension && npm run test:properties` run
  while verifying BL-1499 (a shell-fixture + step-handler ticket; no
  production TS/JS path touched — `git diff main -- extension/src` is
  empty for this parcel).

## Findings

Two clean sequential runs of the full property lane (no other
vitest/stryker process running before or during either run, confirmed via
`pgrep -fl 'node --test|stryker|vitest'` before starting) each returned
4-5 failed tests:

- `test/bl1089FrontDeskLivenessFixture.property.test.js` — **owned**,
  `backlog/standing-reds.tsv` row → BL-1502.
- `test/bl1313BatchGuardVisibilityInvariants.property.test.js` (2
  invariants) — **owned**, `backlog/standing-reds.tsv` row → BL-1503.
- `test/bl1272LandedSiblingInvariants.property.test.js` invariant 1 —
  `Error: Test timed out in 20000ms.` Re-run in isolation
  (`npx vitest run --config vitest.properties.config.mjs
  test/bl1272LandedSiblingInvariants.property.test.js`): passes in
  10.9s, well under the 20s internal timeout. Full-suite-only failure,
  clean alone — resource/timing contention across the concurrent property
  lane (same shape as the already-known BL-871
  `[vitest-worker]: Timeout calling "onTaskUpdate"` pattern), not a defect
  in the file. Not registered; flagged for completeness, not requesting a
  ticket for this one specifically unless it recurs outside contention.
- `test/bl1364TurnProfileSeriesInvariants.property.test.js` > `property
  (invariant 2): one damaged transcript refuses the whole window` —
  `AssertionError: never generated an unreadable path:
  {"interior":6,"missing":9,"unreadablePath":0}` at line 193. This is a
  coverage-floor assertion: `brokenKind` is drawn via
  `fc.integer({ min: 0, max: 2 })` over `numRuns: 15`, and the test then
  asserts all three categories (`interior`, `missing`, `unreadablePath`)
  were each hit at least once. Re-run in ISOLATION 10 times
  (`npx vitest run --config vitest.properties.config.mjs
  test/bl1364TurnProfileSeriesInvariants.property.test.js`, host quiet,
  nothing else running): **1 of 10 failed**, same assertion, same shape
  (`unreadablePath` count 0). This is NOT a contention artifact — it fails
  standalone, no other process competing — it is a genuine coverage-floor
  flake, same class as BL-1533's (`bl604TrendAnalysisInvariants`, "delta
  sign up drawn 8 < 10") and BL-1527's (`bl1367ApprovalCarriesItsRuling`).

`grep -rl bl1272LandedSiblingInvariants backlog/active backlog/paused
backlog/hold` and `grep -rl bl1364TurnProfileSeriesInvariants backlog/active
backlog/paused backlog/hold` both return nothing; neither file has a row in
`backlog/standing-reds.tsv`. `bl1364TurnProfileSeriesInvariants` is
**unowned**. BL-1364 itself (the ticket that introduced this file,
2026-09-05) is closed (`backlog/done/`), so this is a latent flake
surfacing later, not an in-flight defect.

## Why this blocks approval

Article 4.2 (2026-09-05, standing-red-register-amendment): "QA approves no
parcel whose evidence names a red with no open ticket in the standing-red
register." `bl1364TurnProfileSeriesInvariants.property.test.js` appears in
this parcel's own required-green property-test evidence with no owning
ticket, and reproduces on demand (1/10 isolated runs) independent of load.
BL-1499's own gates (shell fixture, acceptance, unit suite, compile) are
otherwise all green — this is the sole blocker, and it is unrelated to
BL-1499's diff.

## Ask

Specifier: mint a ticket for
`extension/test/bl1364TurnProfileSeriesInvariants.property.test.js`
invariant 2's coverage-floor flake (raise `numRuns`, weight the `brokenKind`
draw to guarantee coverage, or assert coverage per-category over multiple
sub-batches — specifier's call) and add a row to
`backlog/standing-reds.tsv`. This is independent of BL-1499's own
verification, which otherwise passes in full (shell fixture 5/5 cases,
acceptance 2/2 scenarios plus BL-1191/BL-970 unaffected, full unit suite
green, compile clean, no diff to `handoffd.bb`/`agent_runtime_inject.bb`).
Once the ticket exists (register owns the red, fix not required first),
BL-1499 is unblocked for approval.

By QA.
