# BL-826 — cleaner pass (post-bounce recheck)

## Received

`git_handoff` from coder, commit `54828841e8` (merge_and_process,
task `BL-826-first-poll-cadence-underflow`). This is the coder's fix for the
architect's bounce recorded at `backlog/evidence/BL-826-bounce-20260807.md`
(D1: first hands-free re-arm poll sampled at the wider cooldown instead of
the steady poll cadence, leaving a blind window that could under-measure the
declared quiet tail). Fast-forward merged into `swarmforge-cleaner`.

## Review checklist (Cleanup Order)

- **Coverage of changed behavior**: `HandsFreeReArmGate.firstPollDelayMs` is
  covered by a new regression sweep
  (`first poll tick samples at the steady cadence, closing the two-tier
  blind window`, 500-iteration randomized simulation of the real two-tier
  schedule) plus a non-vacuity companion reproducing the bounce evidence's
  exact 390ms/400ms scenario against the pre-fix `firstPollDelayMs =
  cooldownMs` behavior. `TalkEngine.scheduleHandsFreeListen`'s
  `followsPlayback`-gated call to `firstPollDelayMs` is exercised
  transitively by the same property (it mirrors
  `HandsFreeListenPoll.run()`'s exact schedule).
- **CRAP / DRY / mutation tools**: not wired for `.kt` (constitution,
  Startup Tools — Kotlin row; same standing gap as the coder-pass and prior
  cleaner-pass evidence). Degraded unit-test-gap fallback applies, recorded
  not run. Manual DRY read: `simulateTwoTierPoll` is a new private helper
  shared by both the property sweep and its non-vacuity companion —
  duplication was factored out, not introduced.
- **Module structure / boundaries / encapsulation**: `firstPollDelayMs` is
  added to `HandsFreeReArmGate` as a pure function (no `android.*` in its
  signature), keeping the same testability boundary as `decide()`. The
  caller (`TalkEngine.scheduleHandsFreeListen`) computes `waitStartedAt`
  once and passes it through `HandsFreeListenPoll`, reusing the existing
  funnel — no new call path to the mic was introduced, no state duplicated.
- **Mutation-site size (BL-485)**: TS-only tool; this parcel touches only
  `.kt` files, out of scope. Not run.
- **Scope hygiene (BL-506)**: diff since `30ad2f4a` touches only
  `HandsFreeReArmGate.kt`, `TalkEngine.kt`,
  `HandsFreeReArmGatePropertyTest.kt`, plus the ticket YAML's bounce record
  and the architect's own evidence file. No ticket-less files swept in.

## Verification run

```
$ JAVA_HOME=/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home \
    ./gradlew :app:testDebugUnitTest --console=plain
BUILD SUCCESSFUL
```

Full `:app:testDebugUnitTest` suite green (not scoped to `--tests`), run
independently in this pass — not trusted from the coder's or architect's
evidence alone.

## Verdict

NONE — no defects found, no cleanup changes made. The bounce fix is a small,
well-scoped pure-function addition with regression coverage that
demonstrably fails pre-fix (non-vacuity test) and passes post-fix.
Forwarding unchanged.

By cleaner.
