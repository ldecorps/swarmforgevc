# BL-826 — cleaner pass

## Received

`git_handoff` from coder, commit `1ee0741c09` (merge_and_process). Merged
into `swarmforge-cleaner` at `df02204c`.

## Review checklist (Cleanup Order)

- **Coverage of changed behavior**: `HandsFreeReArmGateTest.kt` (8 example
  cases) + `HandsFreeReArmGatePropertyTest.kt` (500-sweep randomized
  property + non-vacuity proof) cover `HandsFreeReArmGate.decide()` and
  `isWithinSettleWindow()`. `AudioTurnRecorder`/`ReplyAudioPlayer` additions
  (`attachEchoHardening`, `releaseEchoHardening`, `isAudioActive`) are the
  thin `android.*` edge per the Testability Boundary — Bubble; not unit
  covered by design, degrade-silently paths are try/catch-swallowed.
- **CRAP tool**: not wired for `.kt` (constitution, Startup Tools — Kotlin
  row). Degraded unit-test-gap fallback applies; recorded, not run.
- **DRY tool**: not wired for `.kt`, same fallback. Manual read: the two
  `attachEchoHardening`/`releaseEchoHardening` try/catch pairs in
  `AudioTurnRecorder.kt` are structurally similar (create-and-enable vs.
  release, each guarding one of two independent `AudioEffect` types) but
  differ in what they call and which field they touch — collapsing them
  into a shared helper would trade two four-line blocks for an
  indirection with no meaningful duplication removed. Left as-is.
- **Module structure / boundaries / encapsulation**: `HandsFreeReArmGate` is
  a pure `object` with no `android.*` in its own signature, callable and
  tested with no device or emulator — matches the Testability Boundary —
  Bubble's thin-edge rule already applied elsewhere in this codebase.
  `TalkEngine.scheduleHandsFreeListen` remains the single funnel every
  re-arm call site passes through (verified by reading all five call
  sites); no alternate path to the mic was introduced. `HandsFreeListenPoll`
  is a private inner class scoped to one wait's lifetime, not shared
  mutable state.
- **Mutation-site size (BL-485)**: TS-only tool
  (`extension/out/tools/mutation-site-count.js` mutates compiled
  `out/**/*.js`); this parcel touches only `.kt` files, out of that tool's
  scope. Not run — no compiled counterpart exists for Kotlin.
- **Mutation over uncovered/weakly-covered changed behavior**: no Kotlin
  mutation tool pinned (constitution). BLOCKED BY tooling gap, same as
  CRAP/DRY above — not a defect in this parcel, a standing project gap
  already recorded (BL-472).

## Verification run

```
$ JAVA_HOME=/usr/local/opt/openjdk ANDROID_SDK_ROOT=~/Library/Android/sdk \
    ./gradlew :app:testDebugUnitTest --console=plain
BUILD SUCCESSFUL
```

```
$ bash specs/pipeline/scripts/run_acceptance.sh \
    specs/features/BL-826-bubble-hands-free-self-listen-echo-loop.feature
# tests 6
# pass 6
# fail 0
```

## Verdict

NONE — no defects found, no cleanup changes made. The coder's parcel is
already a well-separated pure-logic module behind a thin device edge, with
example and property coverage. Forwarding unchanged.

By cleaner.
