# BL-697: Let's Talk hands-free listening

**Status:** approved by operator (2026-07-27)  
**Parent:** [BL-696 backlog](../../backlog/paused/BL-696-miniapp-lets-talk-cursor-audio.yaml) · [feature](../../specs/features/BL-697-lets-talk-hands-free-listening.feature) · [how-to](../../how-to/BL-696-miniapp-lets-talk-cursor-audio.md)

---

## Context

BL-696 shipped discrete tap-to-toggle turns. The operator requested a more natural
conversation flow: after the agent finishes speaking, listening resumes automatically;
when the user stops speaking for about two to three seconds, the turn is submitted
without tapping Record or Stop.

This remains **discrete turn-taking** on the server (`POST /lets-talk/turn`). Only
the Mini App WebView capture UX changes.

---

## Behaviour

| Control | Off (default) | On |
|--------|----------------|-----|
| After agent playback | User taps Record | Mic opens after ~400 ms |
| End of user speech | User taps Stop | Auto-submit after ~2.5 s silence |
| Record button | Record / Stop | Record / Listening (manual override) |
| Preference | — | Persisted in `localStorage` |

### Guards

- Echo cancellation and noise suppression on `getUserMedia`.
- Short delay after TTS before opening the mic (avoid recording the agent voice).
- Minimum recording length unchanged (400 ms).
- Silence end requires speech detected first (ambient noise alone does not submit).
- If no speech within 30 s, cancel and show a recoverable error; re-arm when hands-free stays on.
- Thinking / speaking phases disable the toggle and record control.
- Server routes, auth, STT, and Cursor agent session unchanged.

### Out of scope

- Duplex / streaming STT.
- Server-side changes.
- Wake-word detection.

---

## Implementation map

| Layer | File | Change |
|-------|------|--------|
| Pure decisions | `extension/src/bridge/letsTalkCore.ts` | Silence thresholds, schedule/end/cancel decisions |
| WebView | `extension/src/bridge/letsTalkUiHtml.ts` | Toggle, VAD via Web Audio `AnalyserNode`, auto loop |
| Tests | `extension/test/letsTalkCore.test.js`, `letsTalkBridge.test.js` | Decision unit tests; shell contains toggle |

---

## Acceptance

See [BL-697 feature file](../../../specs/features/BL-697-lets-talk-hands-free-listening.feature).

All BL-696 scenarios remain valid with hands-free **off**.
