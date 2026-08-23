# Barge-in: stopping Bubble's speech when the human talks over it

Slice A of the `bubble-voice-barge-in` epic. In hands-free mode, speaking over
Bubble's spoken reply now stops that reply within 300ms and leaves exactly one
listening session open for the instruction that prompted the interruption.
Push-to-talk is unchanged — no audio input aborts playback there.

This slice stops playback and starts listening. It does **not** decide what
happens to the task that was running (cancel, pause, or supersede) — that is a
later slice (E), and shipping the abort alone is safe because aborting
playback has no side effect beyond silence.

## Behaviour

- **Hands-free**: while Bubble speaks, sustained human speech over the
  playback (120ms onset sustain) stops it within a 300ms budget and leaves
  exactly one listening session open.
- **Room noise and Bubble's own voice never trigger it.** A frame must clear
  both the absolute onset threshold *and* the reference level Bubble's own
  output contributes (a fixed margin over it) — hearing itself would make the
  feature unusable, not merely imperfect, so this is not tunable away.
- **Push-to-talk**: unaffected. No audio input can abort playback; the mic
  opens only when activated manually.
- **Repeated/concurrent barge-ins never stack sessions.** At most one
  listening session exists at any instant, on every path — a second barge-in
  in quick succession, a duplicate `playbackStarted`, or a duplicate close
  cannot open or close a session twice.

## Where the logic lives

`BargeInDetector` (`android/app/src/main/java/com/swarmforge/floatcompanion/BargeInDetector.kt`)
is pure decision logic — no `android.*` type in its signatures — so it runs
under the JVM unit suite (`android/gradlew :app:testDebugUnitTest`, no
emulator or device) per the Testability Boundary — Bubble rule. It is a state
machine over three inputs from the caller:

- `playbackStarted(state, mode)` — Bubble began speaking; opens a listening
  session in hands-free mode.
- `frame(state, frame, mode, tuning)` — one reduced capture-level poll; the
  only path that can emit an abort, and every abort clears
  `playbackRunning` in the same step.
- `playbackFinished(state, mode)` — playback ended on its own; closes the
  listening session if nothing else needs it.

`TalkEngine.kt` (the device-surface caller) owns every framework concern the
detector itself is deliberately blind to: opening the mic, reducing capture
buffers to a plain `Frame`, and stopping playback. It reduces each capture
buffer's RMS level against `BargeInDetector.SELF_OUTPUT_REFERENCE_LEVEL` (or
Bubble's real output level while speaking) and drives the detector's `frame()`
on each poll; the required-wiring anchor is
`TalkEngine.kt::bargeIn` (the detector is driven from the live talk loop, not
only from tests).

`ReplyAudioPlayer.kt` exposes the `abort` call that lets the detector's
`AbortPlayback` effect actually stop playback — `TalkEngine.onBargeIn()` calls
`replyPlayer?.abort(effect.reason)` and nothing else; the in-flight task
itself is untouched.

## Tuning constants

| Constant | Value | Meaning |
|---|---|---|
| `DEFAULT_ONSET_THRESHOLD` | `0.02` | Normalized RMS a frame must reach to count as speech at all (matches `AudioTurnRecorder`'s own speech floor) |
| `DEFAULT_ONSET_SUSTAIN_MS` | `120` | How long that level must hold before it's an interruption, not a cough |
| `DEFAULT_SELF_OUTPUT_MARGIN` | `2.5` | How far captured audio must exceed Bubble's own output level to count as human |
| `SELF_OUTPUT_REFERENCE_LEVEL` | `0.04` | The fixed reference floor `TalkEngine` reports while Bubble is speaking |
| `DEFAULT_STOP_LATENCY_BUDGET_MS` | `300` | The interruption's stop-latency budget |
| `MAX_FRAME_INTERVAL_MS` | `60` | The longest gap between polls the detector is specified against — sustain + this must fit inside the stop budget |

A gap in speech clears the onset rather than extending it: an interruption is
continuous speech, not the sum of unrelated syllables.

## Out of scope (this slice)

- Deciding the in-flight task's fate on interrupt (cancel/pause/supersede —
  slice E).
- Listening while the agent is executing (slice C).
- Voice-mode switching by command (slice D).
- Any change to push-to-talk.

## Verifying on device

No emulator/`androidTest` is used for this (Robolectric/`androidTest`
deliberately not adopted for Bubble). The device-surface procedure recorded
against this ticket:

1. In hands-free mode, ask something that produces a long spoken reply, speak
   over it, and confirm the speech stops promptly and the mic is listening —
   repeat five times to shake out a stuck mic.
2. Let a full reply play with the room quiet and confirm Bubble never aborts
   itself.
3. Switch to push-to-talk and confirm speaking over playback does nothing.

Acceptance feature: `specs/features/BL-777-barge-in-detector-and-playback-abort.feature`.
JVM unit tests: `BargeInDetectorTest.kt`, `BargeInDetectorPropertyTest.kt`.
