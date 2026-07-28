# BL-696 Amendment: Local hybrid audio (server STT + browser TTS)

**Status:** approved by operator (2026-07-27)  
**Parent:** [BL-696 backlog](../../backlog/paused/BL-696-miniapp-lets-talk-cursor-audio.yaml) · [feature](../../specs/features/BL-696-miniapp-lets-talk-cursor-audio.feature) · [how-to](../../how-to/BL-696-miniapp-lets-talk-cursor-audio.md)  
**Supersedes (partially):** v1 architecture pin §2 in BL-696 `description` — *“the bridge host runs STT **and TTS** server-side”*

---

## Context

v1 shipped with OpenAI Whisper (STT) and OpenAI TTS on the bridge host. In production this
hit **quota / billing** failures (`insufficient_quota`), surfaced to the user as a misleading
“audio could not be decoded” error. The Cursor agent path is unaffected; only the audio I/O
adapters need an alternative that does **not** depend on a cloud LLM or speech API.

Three options were evaluated:

| Option | STT | TTS | Deterministic? |
|--------|-----|-----|----------------|
| 1 — Browser-native | `SpeechRecognition` | `speechSynthesis` | No (OS voices) |
| 2 — Fully local server | whisper.cpp / Vosk | Piper / espeak-ng | Yes (pinned models) |
| **3 — Hybrid (chosen)** | **whisper.cpp on bridge** | **`speechSynthesis` in WebView** | STT yes; TTS varies by device |

**Operator decision (2026-07-27):** implement **option 3**.

Rationale: keeps audio upload + server-side transcription (matches existing CSP and
`MediaRecorder` flow), avoids server TTS dependencies and model weight, and removes OpenAI
quota as a blocker for the speech loop. TTS quality will vary by phone/OS — acceptable for
an operator console; STT remains reproducible with a pinned local model.

---

## What changes

### Unchanged (must not regress)

- Discrete turn model: record → STT → Cursor agent → playback → ready.
- `POST /lets-talk/turn` and `POST /lets-talk/new-session` auth (`requireControlAuth`).
- Shared `agentId` with Cursor Remote; **New session** semantics.
- CSP `connect-src 'self'` — no provider calls from the WebView.
- Injectable `TranscribeAudio` / `SynthesizeSpeech` adapter seam (`letsTalkAudio.ts`).
- All eight BL-696 acceptance scenarios remain valid **by user-visible outcome** (user still
  hears a spoken reply and sees a transcript).

### Changed

| Layer | v1 (shipped) | Amendment (option 3) |
|-------|--------------|----------------------|
| STT | OpenAI Whisper API | **Local whisper.cpp** (or equivalent) subprocess on bridge host |
| TTS | OpenAI TTS API → `replyAudioBase64` in JSON | **Browser `speechSynthesis`** on `replyText`; server does not synthesize |
| Turn response | `{ replyText, replyAudioBase64, … }` | `{ replyText, … }` required; `replyAudioBase64` **optional** (omit in local mode) |
| Engine selection | `OPENAI_API_KEY` present → OpenAI adapters | `LETS_TALK_AUDIO_ENGINE=local` → local STT + client TTS; `openai` remains fallback |
| Spend / quota | STT + TTS billed per turn | **No cloud speech spend**; Cursor agent still uses `CURSOR_API_KEY` |

---

## Architecture pins (amendment)

1. **STT adapter — local**  
   - Env: `LETS_TALK_AUDIO_ENGINE=local` (default once implemented; until then `openai` if key set).  
   - Implementation: bridge invokes **whisper.cpp** (or pinned equivalent) as a subprocess with
     a fixed model path (e.g. `~/.swarmforge/models/whisper-base.en.bin`).  
   - Same input contract: `TranscribeAudio(bytes, mimeType) → SttResult`.  
   - Transient vs unprocessable failure posture unchanged (BL-426 mapping).

2. **TTS — client-side**  
   - When `LETS_TALK_AUDIO_ENGINE=local`, `resolveLetsTalkAudioAdapters` does **not** register
     `synthesizeSpeech` on the server.  
   - `letsTalkUiHtml.ts` speaks `replyText` via `window.speechSynthesis` after a successful turn.  
   - `speaking` phase covers synthesis + playback end (`utterance.onend`).  
   - If `speechSynthesis` is unavailable, show recoverable error with transcript visible
     (text-only fallback).

3. **Turn route**  
   - `POST /lets-talk/turn` still accepts `audioBase64` + `mimeType`.  
   - Success body: `replyText` and `transcript` required; `replyAudioBase64` optional.  
   - Client: if `replyAudioBase64` present → play as today; else → `speechSynthesis`.

4. **CSP**  
   - Still no widening. `speechSynthesis` and `SpeechRecognition` are **not** used for STT in
     option 3 (STT stays server-side). Only TTS moves to the browser.

5. **OpenAI fallback**  
   - `LETS_TALK_AUDIO_ENGINE=openai` + `OPENAI_API_KEY` preserves v1 behaviour for hosts that
     prefer cloud speech. Not required for Let's Talk to function once local STT is installed.

---

## Operator setup (local mode)

Document in how-to when implemented:

```bash
# Install whisper.cpp binary + base.en model (exact paths TBD by implementation)
export LETS_TALK_AUDIO_ENGINE=local
export WHISPER_CPP_BIN=/path/to/whisper-cli   # name TBD
export WHISPER_MODEL_PATH=~/.swarmforge/models/whisper-base.en.bin
```

Restart the bridge headless / front-desk process after env changes.

---

## Implementation ticket (follow-on)

**Status: implemented 2026-07-27** in `extension/src/bridge/letsTalkLocalAudio.ts`,
`letsTalkAudio.ts` (`LETS_TALK_AUDIO_ENGINE=local`), `letsTalkRoutes.ts`
(optional `replyAudioBase64`, `clientTts`), and `letsTalkUiHtml.ts`
(`speechSynthesis`).

---

## Out of scope (unchanged)

- Live duplex, streaming STT, WebRTC
- Browser-native STT (option 1) — rejected for Telegram WebView reliability
- Fully local server TTS (option 2) — deferred; can revisit if client TTS is insufficient
