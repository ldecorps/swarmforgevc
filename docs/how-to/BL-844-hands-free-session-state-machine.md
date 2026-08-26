# The hands-free session state machine: wake once, talk, then go quiet

Slice of the `bubble-voice-barge-in` epic. Governs when Bubble is actually
listening in hands-free mode: passive until woken, conversational while
active, and quiet again — automatically — once the human stops talking, so a
polite "thank you" doesn't leave the mic hot forever.

## The states

`PassiveWake -> ActiveListen -> Thinking -> Speaking`, and back.

- **PassiveWake** — the default. Speech reaches no model at all; only a wake
  signal (BL-845's spotter) or an explicit gesture (push-to-talk, the UI)
  opens a session.
- **ActiveListen** — a session is open. An utterance here submits a turn (or
  is recognized as a closer/end phrase — see below) with no wake phrase
  needed.
- **Thinking** — a turn was submitted and Bubble is working on it.
- **Speaking** — Bubble is playing a spoken reply.

## The silence window

After a reply finishes speaking, a **10-second silence window** starts
(`HandsFreeSession.DEFAULT_SILENCE_WINDOW_MS`). This value comes from the
human's own research quoted in the intake — Alexa ~8s, Google ~8-10s, Gemini
Live ~15s, "not 20-60s" — and ships as a fixed constant; making it
configurable is deliberately a later slice.

- Speech inside the window is handled as a normal turn (returns to
  `Thinking`) and clears the window — a live follow-up needs no wake phrase.
- Silence through the window returns the session to `PassiveWake`.
- A **soft closer** ("thank you", "thanks") is acknowledged as a non-task but
  deliberately does **not** restart the window — silence still wins, so a
  polite goodbye doesn't hold the mic open for another ten seconds.
- A **hard end phrase** ("stop", "I'm done", "goodbye") drops to `PassiveWake`
  immediately, without waiting the window out.
- Both phrase checks match the **whole utterance only** (normalized: lowercase,
  letters/digits/whitespace only, collapsed whitespace) — "stop the
  deployment" is a task, not an exit.

## Interaction with barge-in (BL-777)

A barge-in signal received while `Speaking` returns the session directly to
`ActiveListen` — the human is already talking, so there's nothing to wait out.
This slice owns that transition; detecting the barge-in itself and aborting
the audio is BL-777's.

## Push-to-talk is untouched

With hands-free off, elapsed time (`Event.Tick`) never changes session state,
and a finished reply arms no silence window in the first place. An explicit
gesture still opens a session exactly as it does today — that's what "explicit"
means.

## Where the logic lives

`HandsFreeSession`
(`android/app/src/main/java/com/swarmforge/floatcompanion/HandsFreeSession.kt`)
is pure logic — a function of `(session, event, handsFree, silenceWindowMs)`
with no `android.*` type in its own signature — so it runs entirely under the
JVM unit suite (`android/gradlew :app:testDebugUnitTest`, no emulator or
device), per the Testability Boundary — Bubble rule. Elapsed time enters only
through `Event.Tick`'s clock reading — never a `sleep` or a wall-clock poll —
so the whole 10-second policy is testable without waiting ten seconds for
anything.

Events: `WakeSignal` (BL-845's spotter), `PushToTalkTap`, `Utterance`,
`PlaybackStarted`, `PlaybackFinished` (arms the silence window),
`BargeIn` (BL-777's detector), `TurnFailed`, and `Tick`.

## Depends on BL-826

This slice builds on the hands-free listen gate BL-826 rewrites in
`TalkEngine.kt`/`AudioTurnRecorder.kt` — the two tickets touch the same
surface, so this one starts only after BL-826 lands.

## Out of scope (this slice)

- The wake spotter itself (BL-845).
- Barge-in detection and playback abort (BL-777).
- The echo-loop gate (BL-826, a dependency, not a part of this slice).
- Making the silence window configurable.
- Any bridge or server-side change — this slice is entirely on the phone.

## Verifying on device

The state machine itself is fully verified by the gradle unit suite. The
device-surface manual procedure (once BL-845's spotter exists):

1. Wake, ask a question, let Bubble answer, say nothing — confirm it returns
   to passive about 10 seconds after the answer ends.
2. Wake, ask, let it answer, say "thank you", then nothing — confirm it
   returns to passive rather than staying hot.
3. Wake, ask, let it answer, ask a follow-up within the window — confirm no
   wake phrase was needed and the window restarted.
4. Wake, ask, and say "stop" while it is answering — confirm it goes quiet
   immediately.
5. Turn hands-free off and repeat step 1 — confirm nothing auto-returns to
   passive.

Acceptance feature: `specs/features/BL-844-hands-free-session-state-machine.feature`.
