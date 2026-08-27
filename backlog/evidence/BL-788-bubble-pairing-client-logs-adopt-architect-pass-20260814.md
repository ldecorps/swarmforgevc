# BL-788 architect re-review — 2026-08-14

## Commit reviewed
`83e3cdc3ab` (architect's merge of cleaner's `09739a37ab`, itself cleaner's
merge of coder's `5caaa08d4` — the fix for bounce #1, D1).

## D1 remediation check (invariant-unencoded: PairingSave.merge)

`android/app/src/test/java/com/swarmforge/floatcompanion/PairingSavePropertyTest.kt`
now exists, following the project's established `kotlin.random.Random`
pattern (same shape as `HandsFreeReArmGatePropertyTest.kt` /
`VoiceEngineSelectorPropertyTest.kt`).

- Encodes declared invariant 3 directly: for randomly generated
  stored/input url+token pairs (blank, whitespace-only, unicode,
  slash-heavy), a trimmed-blank input never changes its stored
  counterpart, and a non-blank input always replaces it per
  `PairingSave`'s own normalize/trim rules, never with a blank result.
- Non-vacuous, two ways: (1) a companion test proves an
  unconditional-overwrite merge WOULD violate the property (`sawViolation`
  assertion), so the property is provably capable of failing; (2) a
  regression test reproduces the exact pre-fix defect (see below) against a
  local copy of the old `normalizeUrl` logic, confirming the property
  actually caught something real, not a strawman.
- The generator (deliberately biased toward slash-heavy input, not left to
  uniform chance — an all-slash string is astronomically unlikely under
  uniform sampling, BL-654 generator-reach) found a real bug:
  `normalizeUrl`'s `trimEnd('/')` collapsed an all-slash input (e.g. `"///"`,
  non-blank per `isBlank()`) to `""`, silently blanking a non-blank stored
  credential — invariant 3 violated by a side door the six fixed-example
  tests never exercised. Fixed by falling back to the pre-trim raw when
  trimming trailing slashes would otherwise empty it.

## Verification run (this pass, JDK 17 + `.swarmforge/android-sdk`, this
machine lacks a default JDK 17 — resolved via `/usr/local/opt/openjdk@17`
per the BL-826 hardener-pass precedent)

- `./gradlew :app:testDebugUnitTest --tests "...PairingSavePropertyTest"`:
  **BUILD SUCCESSFUL**, 3/3 tests, 0 failures, 0 errors
  (`android/app/build/test-results/testDebugUnitTest/TEST-....PairingSavePropertyTest.xml`).
- `./gradlew :app:testDebugUnitTest --tests "...PairingSaveTest"` (the
  original six example tests): **BUILD SUCCESSFUL** — the `normalizeUrl` fix
  does not regress the existing example coverage.

## Rest of the inventory (unchanged since the 2026-08-13 bounce pass —
re-confirmed, not re-litigated, since this round's diff is Kotlin-only:
`PairingSave.kt` + `PairingSavePropertyTest.kt`, no TS files touched)

- Dependency-rule gate (`node extension/out/tools/dependency-gate.js` on
  the three TS files in the parcel — unchanged since the prior pass):
  re-run this pass, **PASSED**, no forbidden edges.
- Invariants 1 and 2: unaffected by this round's diff, previously verified
  green (`extension/test/bl788BubblePairingInvariants.property.test.js`).
- Required wiring, acceptance feature, the three approval-gated
  corrections, route-ordering read: unaffected by this round's diff,
  previously verified (see the 2026-08-13 bounce evidence file).

## Disposition

No new defects found. D1 is fully remediated: the invariant-unencoded gap
is closed with a real, non-vacuous property test that caught and drove the
fix for an actual bug. Forwarding to **hardender**.
