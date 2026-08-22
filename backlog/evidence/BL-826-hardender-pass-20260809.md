# BL-826 — hardener pass — 2026-08-09

## Scope reviewed

Parcel received from architect at `5b992d3cb4` (merged into hardener on top
of `9e7a0bd2`). Per the architect's own evidence, no production Kotlin
changed this pass — `HandsFreeReArmGate.kt`, `TalkEngine.kt`, and
`AudioTurnRecorder.kt` landed earlier via the out-of-band operator/Cursor
commit (`2e65b769`) and were verified fresh by both coder and architect
against the ticket's `required_wiring` and invariants. Files actually added
by this ticket's own pipeline work: `specs/pipeline/steps/bl826HandsFree
SelfListenEchoLoopSteps.js`, `specs/pipeline/steps/lib/androidJvmDecision
Steps.js` (shared with BL-769), `specs/pipeline/steps/bl769AndroidPureLogic
JvmUnitSeamSteps.js` (DRY-extracted), `specs/pipeline/steps/index.js`.

## Tooling applicability (constitution, Startup Tools)

- **Kotlin (`.kt`)**: no mutation/CRAP/DRY tool pinned for this project's
  Android surface. Degraded unit-test-gap fallback applies — recorded per
  the ticket's own hardener note. No source change to hand-harden this
  pass; the coder's and architect's existing coverage (`HandsFreeReArmGate
  Test.kt` 8 tests, `HandsFreeReArmGatePropertyTest.kt` 5 tests incl. the
  ceiling-clamp non-vacuity check) stands, re-run fresh below.
- **JS step-handler files** (`specs/pipeline/steps/**`): outside Stryker's
  `mutate: ["out/**/*.js"]` scope (`extension/stryker.config.json`) and
  outside the CRAP/jscpd scripts' `extension/src` scope (constitution:
  "the jscpd/CRAP quality scripts are scoped to `extension/src`") — no
  root-level `.jscpd.json` exists either. Neither tool applies to this
  parcel's changed files.
- **What does apply**: BL-113 soft Gherkin acceptance mutation — the
  feature carries a `Scenario Outline:` + `Examples:` block (six decision
  names), so this is not the BL-638 zero-mutant case.

## BL-113 Gherkin acceptance mutation (soft)

`specs/pipeline/scripts/run_gherkin_mutation.sh specs/features/BL-826-
bubble-hands-free-self-listen-echo-loop.feature ./tmp/bl826-gherkin-
mutation specs/pipeline/steps/index.js soft`:

```
Total 6, Killed 6, Survived 0, Errors 0
outcome: pass
```

Every one of the six `<decision>` example values is load-bearing — each
single-character mutation of an example string produced a real acceptance
failure (`unknown <decision> example ... expected one of: ...`), confirming
the step handler's `KNOWN_VALUES` mapping (BL-233, no passthrough) actually
discriminates each decision rather than accepting anything. Manifest
stamped into the feature file (`Total:6 Killed:6 Survived:0 Errors:0`).
Zero survivors — nothing to fix, nothing to record as equivalent (BL-234
not applicable).

## Fresh verification (not taken on prior passes' word)

- `./gradlew :app:testDebugUnitTest --tests "*HandsFreeReArmGate*"`
  (JDK 17 via `/usr/local/opt/openjdk@17`, `ANDROID_SDK_ROOT` via the main
  checkout's `.swarmforge/android-sdk`): `BUILD SUCCESSFUL`.
- `run_acceptance.sh specs/features/BL-826-bubble-hands-free-self-listen-
  echo-loop.feature`: 6/6 scenarios pass.
- `run_acceptance.sh specs/features/BL-769-android-pure-logic-jvm-unit-
  seam.feature` (canary for the cleaner's shared-lib extraction): 4/4
  scenarios pass — confirms `androidJvmDecisionSteps.js` did not regress
  BL-769's own suite.

## Process hygiene

Checked for orphaned test/mutation processes before and after this pass
(`pgrep -fl 'node --test|stryker|gradle'`, `pgrep -afl tmux`): only
long-lived Gradle daemons (expected, reused across invocations) and the
live swarm's own `swarmforge-coder` tmux session. No leaked fixture
processes or tmux servers from this pass's mutation/acceptance runs.

## Verdict

Clean. No surviving mutants, no coverage gap requiring a new test, no
CRAP/DRY regression possible to compute (out of scope for both changed
surfaces per Startup Tools). Nothing to fix. Forwarding to documenter.

By hardender.
