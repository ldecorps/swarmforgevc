# The Bubble Settings voice-engine selector (BL-864)

Bubble Settings gains a Local / OpenAI voice-engine control, on the same
surface as hold music, mute, and hold-music volume. It writes the durable
preference BL-863 added on the bridge; this is the phone-facing half.

## Behaviour

1. **Opens on the truth.** Opening Settings fetches `GET
   /lets-talk/audio-engine`; the selector shows whichever engine the bridge
   reports as actually in use, never a locally cached guess.
2. **A tap writes through, never gets ahead of the bridge.** Choosing an
   engine sends its name (never a credential) to `POST
   /lets-talk/audio-engine`. Android's `RadioGroup` checks the tapped button
   before any listener runs; the listener immediately re-renders the last
   *confirmed* state in the same UI pass, so the tap is never drawn on
   screen until the bridge actually answers. Only `ChoiceOutcome.Accepted`
   advances the visible selection — a refusal or an unreachable bridge shows
   its message and leaves the working engine selected exactly as it was.
   (Fixed post-review, BL-864-voice-engine-selector-tap-leak: the original
   cut let the tapped button render immediately because nothing intercepted
   `RadioGroup`'s own tap-time check.)
3. **An unserviceable engine is offered disabled, with its reason** — e.g.
   OpenAI with no `OPENAI_API_KEY` on the host — using BL-863's
   serviceability answer, so the human sees why instead of meeting a choice
   that fails.
4. **Gated.** The selector is present only when the bubble-config
   `voiceEngineSwitch` capability flag is on; with it off, the other talk
   settings are unaffected and no selector is shown.
5. **Survives a relaunch.** The choice is durable on the bridge (BL-863's
   preference store), so a fresh Settings open after a Bubble relaunch opens
   on the previously accepted engine.

## Where it lives

- Pure state machine (dialog-open state, post-tap state — no `android.*`
  type in its own signature, JVM-unit-tested): `VoiceEngineSelector.kt`
  (`stateForStatus`, `stateAfterChoice`).
- Device wiring (dialog views, the tap-leak fix, `BridgeClient` calls):
  `TalkPanelActivity.kt::showSettingsDialog`.
- Bridge HTTP surface: `letsTalkAudioEngineRoutes.ts` — `GET
  /lets-talk/audio-engine` (status: enabled, engine in use, per-engine
  serviceability + reason), `POST /lets-talk/audio-engine` (write; body is
  `{"engine": "local"|"openai"}` only — an extra key is refused wholesale,
  never stripped, so a credential can't be smuggled through under a
  different field name).
- Tests: `VoiceEngineSelectorTest.kt` / `VoiceEngineSelectorPropertyTest.kt`
  (JVM unit suite, `./gradlew :app:testDebugUnitTest`);
  `extension/test/letsTalkAudioEngineRoutes.test.js`.
- Acceptance: `specs/features/BL-864-bubble-settings-voice-engine-selector.feature`.

## Testability boundary

Per the Bubble testability boundary, only the dialog-wiring lines that
inflate the control and forward `BridgeClient` results into the pure state
machine are device-surface; everything the selector *decides* — what's
selected, what's disabled, what message shows, what a tap sends — lives in
`VoiceEngineSelector.kt` and runs under the JVM suite with no emulator.

## Out of scope

The bridge-side preference store, per-turn resolution, and serviceability
answer — BL-863. Switching the Cursor agent itself to OpenAI — explicitly
forbidden by the human; this control only changes which engine speaks and
listens.
