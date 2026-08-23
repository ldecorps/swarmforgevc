# "Hey Bubble" — offline, on-device wake spotting

Slice of the `bubble-voice-barge-in` epic, depends on [BL-844's session state
machine](BL-844-hands-free-session-state-machine.md). Lets the phone listen
all day for the phrase **"hey bubble"** without talking to anything: passive
listening runs entirely on-device, makes no bridge request and no cloud speech
call, and the bubble turns soft teal to show it's armed without looking like a
hot mic.

## Why not Android's stock `SpeechRecognizer`

It's frequently cloud-backed, which would make "passive listening" mean
"streaming the room to a server". The passive path requires a true on-device
spotter (Porcupine-class or an equivalent open on-device model). **This slice
does not choose that engine** — it's deliberately left as an injected
interface (`WakeSpotter.Engine`), because picking one brings a licence and a
model file into the APK, a call the human hasn't made yet. Until an engine is
wired in, `OverlayService` logs that no engine is configured and the phrase
does not wake the phone.

## Behaviour

- **Passive is offline and local.** The wake decision itself never reaches the
  network, whatever the phone hears. With the network off, the phrase still
  wakes Bubble locally — only the follow-on model turn fails, and it fails
  loudly with its reason rather than silently.
- **The phrase never travels.** Whatever follows "hey bubble" in the same
  utterance is what gets submitted as the turn; the wake phrase itself is
  stripped before anything is passed on. A bare wake with nothing after it
  opens the session and submits nothing.
- **Same-utterance wake + command works.** "hey bubble, what's the pipeline
  doing" produces exactly one turn, not a beep-then-listen gate.
- **An ignored utterance carries no text onward at all** — not even as far as
  a log line, only a fixed reason string.

## The colour table

| State | Colour | Hex | `themes.xml` resource |
|---|---|---|---|
| Ready / idle | Green | `#238636` | `sf_bubble` |
| Passive wake listening | **Soft teal** | `#2A9D8F` | `sf_bubble_passive` |
| Active listening (recording) | Red | `#DA3633` | `sf_bubble_recording` |
| Thinking | Amber | `#D29922` | `sf_bubble_thinking` |
| Speaking | Blue | `#1F6FEB` | `sf_bubble_speaking` |
| Error | Red | `#DA3633` | `sf_bubble_recording` |
| Paused | Gray | `#6E7681` | `sf_bubble_paused` |

Red is **derived** from whether the state captures audio for the model
(`WakeSpotter.capturesForModel`), not hand-assigned per state — so a new
state can't become red without also declaring that it captures audio for the
model. Passive wake listening is teal and captures nothing.

## Where the logic lives

`WakeSpotter`
(`android/app/src/main/java/com/swarmforge/floatcompanion/WakeSpotter.kt`) is
the pure decision half — no `android.*` type in its own signature, so it runs
under the JVM unit suite (`android/gradlew :app:testDebugUnitTest`, no
emulator or device). Its surface:

- `WakeSpotter.Engine` — the injected spotter interface (`start(onHeard)`);
  no implementation ships in this slice.
- `onHeard(text)` — the whole passive decision: `Decision.Wake(request)` or
  `Decision.Ignore(reason)`. Neither arm can reach the network.
- `strip(heard)` / `isWake(heard)` — phrase detection and removal, matched
  against a normalized (lowercased, alphanumeric+whitespace-only) form so
  punctuation/case don't affect matching.
- `acknowledge(bridgeReachable)` — always acknowledges the wake locally first;
  only the returned `turnFailureReason` differs depending on bridge
  reachability, so the phone-side ack never waits on a network check.
- `colourFor(state)` / `capturesForModel(state)` — the state-to-colour
  mapping described above.

`OverlayService.kt` runs the spotter **inside the overlay's existing
foreground service** rather than starting a second one (the required-wiring
anchor: `OverlayService.kt::WakeSpotter`) — two always-on services for one
always-on feature would cost battery and permissions for nothing. It arms the
engine in `startWakeSpotter()`, routes every heard utterance through
`WakeSpotter.onHeard()` in `onWakeSpotterHeard()`, and derives the bubble's
colour resource from `WakeSpotter.colourFor()` — never a second, hand-written
table.

## Out of scope (this slice)

- The session lifecycle after wake — [BL-844](BL-844-hands-free-session-state-machine.md), which this depends on.
- Barge-in detection — BL-777.
- Server-side or LLM-based wake detection — the human ruled the wake path is
  on-device, full stop.
- Wake-phrase variants, locale and accent tuning — a later pass, once there's
  a real spotter engine to tune.
- Making the wake phrase configurable.

## Verifying on device

The acceptance feature covers wake-phrase stripping, the passive-mode
network-silence gate, the local-ack-before-bridge decision, and the
state-to-colour mapping — all pure logic. Whether a real spotter engine
actually hears the phrase, offline, from across a room, without draining the
battery is **not** something an acceptance scenario can execute; it's a
recorded manual device procedure once an engine is wired in:

1. Airplane mode, say "hey bubble" — confirm the bubble acknowledges locally
   and turns red, and the follow-on turn reports the bridge as unreachable
   with a readable reason rather than failing silently.
2. Back online, say "hey bubble what is the pipeline doing" as one utterance —
   confirm exactly one turn is submitted and its text does not contain the
   wake phrase.
3. Leave the phone passive for 30 minutes with the bridge log open — confirm
   zero requests arrived.
4. Confirm the bubble is soft teal while passive and only red while capturing
   for the model.
5. Record the battery drain over that 30 idle minutes as the baseline for any
   later tuning.

Acceptance feature: `specs/features/BL-845-offline-hey-bubble-wake.feature`.
