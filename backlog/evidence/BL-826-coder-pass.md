# BL-826 — coder pass

## Fix

**One gate in front of every re-arm.** `TalkEngine.scheduleHandsFreeListen`
is the single funnel every existing call site already went through
(`setHandsFree`, `ensureListeningIfHandsFree`, the no-audio branch of
`stopRecording`, `applyTurnFailure`, `onPlaybackDone`). Rather than arming
unconditionally once its `delayMs` elapses, it now hands off to a poll loop
(`TalkEngine.HandsFreeListenPoll`) that consults a new pure decision module,
`HandsFreeReArmGate.decide()`, on every tick. No call site bypasses it by
construction — there is only one `scheduleHandsFreeListen`.

- `HandsFreeReArmGate.kt` (new): pure logic, no `android.*` type in its own
  signature. `decide(Input): Decision` returns `Arm(reason)` or
  `NotYet(reason, recheckAtMs)`. `hasPlaybackToAwait = false` (hands-free
  toggled on, a failed-turn recovery, a stale THINKING-phase callback) arms
  immediately — no tail to wait for. Otherwise it refuses to arm while
  `playbackActive`, refuses until `now - lastAudioActivityAt >= quietTailMs`,
  and forces `Arm` once `nowMs >= waitStartedAt + ceilingMs` regardless of
  playback state — the bounded ceiling the ticket names as the fix's own
  regression guard. `isWithinSettleWindow()` is the pure post-arm-settle
  decision.
- `TalkEngine.kt`: `scheduleHandsFreeListen(delayMs, followsPlayback)` — the
  tail clock starts at the playback-done moment, not after `delayMs`, so the
  existing delay doubles as the first quiet-tail sample: a fast voice with no
  lingering audio still arms at the same ~`delayMs` mark as before; a slow
  one extends past it, bounded by the ceiling. `followsPlayback` is `true`
  only when `onPlaybackDone` fires from `Phase.SPEAKING` (real playback
  occurred) — the THINKING-phase firing the ticket calls out explicitly
  (`onPlaybackDone() also fires from Phase.THINKING`) now routes through the
  same function with `followsPlayback = false`, so it still funnels through
  the gate but doesn't wait out a tail that has nothing to be quiet after.
  Every other call site was already `followsPlayback = false` by default —
  their existing fixed-delay timing is unchanged.
- `ReplyAudioPlayer.kt`: `isAudioActive()` — a defensive re-check beyond the
  `onDone` callback (`mediaPlayer?.isPlaying` / TTS `engine.isSpeaking`),
  since `onDone` can fire slightly ahead of the last audible buffer. This is
  the real signal `playbackActive` polls.
- `AudioTurnRecorder.kt`: `attachEchoHardening()` attaches
  `AcousticEchoCanceler` / `NoiseSuppressor` to the live `AudioRecord`
  session in `start()` when the device reports them available (`isAvailable()`
  checked, failures logged and swallowed — absence degrades silently, kept
  `VOICE_COMMUNICATION` as-is per the ticket). Released in both `stop()` and
  `cancel()`, mirroring the existing `audioRecord?.release()` pattern. The
  capture loop discards audio (skips both the PCM write and `checkSilence`)
  while `HandsFreeReArmGate.isWithinSettleWindow(armedAt, now)` is true and
  `handsFree` — the post-arm settle window.

`HANDS_FREE_SILENCE_MS` and `MIN_RECORD_MS` are untouched (ticket's own
out_of_scope).

## required_wiring (both satisfied)

- `TalkEngine.kt::scheduleHandsFreeListen` — every existing call site routes
  through it unchanged; it is now gate-aware internally, so no call site
  needed to change to gain the gate.
- `AudioTurnRecorder.kt::AcousticEchoCanceler` — attached to the live
  `AudioRecord` session's `audioSessionId` in `start()`, not merely available
  as an unused helper.

## Acceptance (BL-112)

New step handlers: `specs/pipeline/steps/bl826BubbleHandsFreeSelfListenEchoLoopSteps.js`
(registered in `specs/pipeline/steps/index.js`), driving the real
`:app:testDebugUnitTest` gradle task (same posture as BL-769 — the feature's
own claim is that the real task exercises the gate, so a stubbed runner
would prove nothing).

```
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-826-bubble-hands-free-self-listen-echo-loop.feature
...
# tests 6
# pass 6
# fail 0
```

## Unit runs

```
$ JAVA_HOME=/usr/local/opt/openjdk ANDROID_SDK_ROOT=~/Library/Android/sdk ./gradlew :app:testDebugUnitTest --console=plain
BUILD SUCCESSFUL
```

All four unit test classes (`BridgeClientTest`, `PairingDeepLinkTest`,
`HandsFreeReArmGateTest`, `HandsFreeReArmGatePropertyTest`) pass — 27 tests,
0 failures, 0 errors. Confirmed `HandsFreeReArmGateTest` is load-bearing:
temporarily stubbed `HandsFreeReArmGate.decide()` to always return
`Arm("stubbed")` and re-ran — 6 of 8 `HandsFreeReArmGateTest` cases failed
(every `NotYet`-asserting case; the two Arm-asserting cases in that class
correctly still passed, since an always-Arm stub is still Arm). Restored
before commit. `HandsFreeReArmGatePropertyTest`'s own main property
("resolves within the ceiling") did NOT fail against that same stub — an
always-Arm implementation trivially resolves within any ceiling, so that
property alone cannot distinguish a correct gate from a stub; its
non-vacuity instead rests on the in-file un-ceilinged stand-in (a `decide`
substitute with the ceiling clamp removed, `playbackActive` pinned true
forever), which never arms — proving the property genuinely exercises the
ceiling clamp. The two test classes are complementary: the fixed examples
catch a stubbed/wrong gate, the property test catches a gate that drops the
ceiling bound.

Hardener note: no Kotlin mutation/CRAP/DRY tool is pinned in this project
(constitution, Startup Tools). This parcel is `.kt`-only, so it runs the
degraded unit-test-gap fallback and this records that it did.

## BL-654 declared-invariant coverage

Ticket declares two invariants.

1. **"No path arms the microphone while Bubble's own audio can still reach
   it: every re-arm route — post-speech, error, THINKING, timeout and
   recovery — passes the same quiet-tail gate, with no bypass."** —
   **stated reason, no property test**. This invariant quantifies over the
   call graph (every call site of `scheduleHandsFreeListen`), not over
   `HandsFreeReArmGate`'s own input/output space — it is a wiring/process
   property, the shape BL-654 and BL-812's own invariant-2 stated-reason
   describe as admitting no executable encoding via a pure module's
   generated-input property test. It is satisfied by construction instead:
   `scheduleHandsFreeListen` is the single implementation of the re-arm
   schedule, every existing call site already routes through it (unchanged
   by this parcel — see required_wiring above), and it now always consults
   the gate internally before arming. There is no second path to the mic to
   audit; enforcement is "there is only one function", verifiable by
   inspection of `TalkEngine.kt`'s five call sites, all still calling
   `scheduleHandsFreeListen`.
2. **"The gate always resolves: for every input it either arms the mic or
   records why it will not, within a bounded ceiling, so hands-free can
   never latch silently off."** — property test authored:
   `HandsFreeReArmGatePropertyTest.kt`. This invariant IS a pure property of
   `decide()`'s own input/output space and gets a real property test: 500
   randomized (waitStartedAt, quietTailMs, ceilingMs, pollIntervalMs) sweeps,
   each replaying the exact poll-and-recheck loop `TalkEngine` runs in
   production (repeatedly call `decide()`, advance `now` to its own
   `recheckAtMs` on `NotYet`, with flapping random `playbackActive` each
   tick) — asserting every `NotYet` recommends a recheck strictly after now
   and never past the ceiling, carries a non-blank reason, and that the
   simulated wait always reaches `Arm` within the ceiling. Non-vacuity is
   proven inline in the same file by a second test running the identical
   simulation against a deliberately un-ceilinged `decide` stand-in
   (`playbackActive` pinned true forever) and asserting it does NOT resolve —
   proving the property is actually exercising the ceiling clamp, not
   passing by construction. No Kotlin property-test framework is pinned in
   this project (constitution: Startup Tools — the `*.property.test.js`
   apparatus is TS-only); this runs as a plain JUnit test under the same
   `:app:testDebugUnitTest` task as every other Kotlin unit test, the
   documented degraded posture for a `.kt`-only parcel, but is a property
   test in substance (randomized sweep + non-vacuity proof, not a fixed
   example).

## Manual procedure (device surface)

Per the ticket's `verification` section, the mic/speaker/echo-cancellation
behavior is device surface and is QA's to run on a paired phone against the
7-step recorded procedure in the ticket YAML. Not run here.
