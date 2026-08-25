# BL-826 — architect pass — 2026-08-09

## Scope reviewed

Parcel received from cleaner at `4d2a539ccf` (merged into architect at
`4d2a539c` on top of `9e7a0bd2`). Commits in scope:

- `066fd1ab` (coder) — acceptance step handlers for the hands-free re-arm
  gate feature.
- `4d2a539c` (cleaner) — DRY extraction of shared BL-826/BL-769 step
  scaffolding into `specs/pipeline/steps/lib/androidJvmDecisionSteps.js`.

Files actually touched by this pass: `specs/pipeline/steps/bl826HandsFree
SelfListenEchoLoopSteps.js`, `specs/pipeline/steps/bl769AndroidPureLogicJvm
UnitSeamSteps.js`, `specs/pipeline/steps/lib/androidJvmDecisionSteps.js`,
`specs/pipeline/steps/index.js`. No production Kotlin changed this pass —
per the coder's own evidence, `HandsFreeReArmGate.kt`, `TalkEngine.kt`, and
`AudioTurnRecorder.kt` landed earlier via an out-of-band operator/Cursor
commit (`2e65b769`) that never ran through swarm review. Since this is that
code's first pass through review, I read it fresh rather than taking the
coder's word for it.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` (full-repo mode, since none
of this parcel's changed files sit under `extension/src`/`media` — the
gate's only scope) reports the pre-existing `telegram-front-desk-bot.ts`
acyclic cycle. Confirmed unrelated to this parcel (no import path between
it and any BL-826 file) and already tracked as `BL-759`. No violation
attributable to this parcel.

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against the four changed
files:

- `bl826HandsFreeSelfListenEchoLoopSteps.js` co-changes only with its own
  evidence file, `bl769...Steps.js`, `index.js`, and the new shared lib —
  exactly the files touched together in these two commits. Expected.
- `androidJvmDecisionSteps.js` (the new shared lib) co-changes only with
  the two step files that require it — the coupling a shared extraction is
  supposed to have, not a red flag.
- `bl769AndroidPureLogicJvmUnitSeamSteps.js` co-changes with its own
  original landing's files (android sources, its how-to doc) — pre-existing
  history, not from this pass.
- `index.js` reports dozens of "SUSPECTED COUPLING" files at high co-change
  counts (`telegram-front-desk-bot.ts` 67, `handoffd.bb` 54, etc.). This is
  the acceptance step registry — by design it gets a one-line addition on
  almost every feature the project has ever shipped, so it co-changes with
  nearly everything. Not a new or BL-826-specific coupling; judged benign.

No coupling defect found.

## Invariants review (BL-654)

1. *"No path arms the microphone while Bubble's own audio can still reach
   it..."* — no property test; coder's stated non-encodability reason
   verified sound: `TalkEngine` holds `Handler`/`Looper`/`Context` in its
   own fields, placing the wiring on the device-adjacent side of the
   Testability Boundary — Bubble line. Verified instead by direct reading of
   every `scheduleHandsFreeListen` call site in `TalkEngine.kt`
   (`setHandsFree`, `ensureListeningIfHandsFree`, `startRecording`'s
   no-device path, `stopRecording`'s no-audio/no-speech path,
   `applyTurnFailure`, both branches of `onPlaybackDone`): all six route
   through `HandsFreeListenPoll.run()`, which is the sole caller of
   `HandsFreeReArmGate.decide` and the sole path to
   `startRecording(auto = true)` for hands-free — no bypass found.
2. *"The gate always resolves..."* — encoded as
   `HandsFreeReArmGatePropertyTest.kt` (500 randomized inputs per run, four
   scenarios). Confirmed non-vacuous: the companion test with a
   deliberately ceiling-less decision function asserts it fails to arm,
   proving the property test can fail, not just pass by construction.

## required_wiring (both re-verified fresh, not taken on the coder's word)

- `TalkEngine.kt::scheduleHandsFreeListen` — every call site funnels through
  the gate; confirmed by direct read (see invariant 1 above).
- `AudioTurnRecorder.kt::AcousticEchoCanceler` — `attachEchoHardening` is
  called with the live `AudioRecord`'s real `audioSessionId` inside
  `start()`, before `ar.startRecording()`. Failure is caught and logged,
  never thrown — matches "absence must degrade silently". Also confirmed
  the post-arm settle window (`isWithinSettleWindow`) is wired into the mic
  read loop in `AudioTurnRecorder.kt` *before* `checkLimits` is called, so
  settle-window audio is excluded from speech detection too, not merely
  dropped from the transcript buffer.

## Acceptance — re-run independently, not taken on the coder/cleaner's word

- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-826-bubble-
  hands-free-self-listen-echo-loop.feature`: 6/6 scenarios pass.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-769-android-
  pure-logic-jvm-unit-seam.feature`: 4/4 scenarios pass, including the
  load-bearing canary — confirms the cleaner's extraction did not regress
  BL-769's own suite.

## Property testing pass (architect-owned, engineering.prompt)

No additional property-test candidates found beyond invariant 2's coverage.
`HandsFreeReArmGate.kt` is the only pure, testable module this parcel's
commits touch (the step-handler JS files are I/O-driving acceptance glue,
not property-shaped), and its round-trip/idempotence-shaped invariant is
already covered by the coder's property test above; nothing to add.

## Verdict

Clean. No architecture violation, no invariant violation, no correctness
defect found. Forwarding to hardener.

By architect.
