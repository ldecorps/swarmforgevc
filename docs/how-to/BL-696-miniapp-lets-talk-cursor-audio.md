# Let's Talk — Discrete Audio Turns in the Mini App Console

Use **Let's Talk** when you want to speak to the same Cursor bridge agent
that powers the **Cursor Remote** Telegram topic, without typing in the forum
thread. It is part of the Telegram Mini App console and runs on the existing
bridge host.

This is discrete turn-taking only: record → transcribe → Cursor agent reply →
text-to-speech playback → ready for the next turn. It is not a phone call;
there is no live duplex, streaming speech-to-text, or open-mic mode.

## Open the Screen

Open the allowlisted SwarmForge console Mini App and choose **Let's Talk**.
The console links to `/lets-talk` on the bridge server. The HTML shell is
publicly reachable like the other Mini App shells, but the turn and
new-session routes require the console control token.

The screen shows:

- a tap-to-toggle **Record** control (tap once to start, tap again to stop);
- conversation state (`ready`, `thinking`, `speaking`, or `error`);
- a **New session** control;
- a short text transcript of the latest agent reply after each turn.

## Record a Turn

1. Wait until state is **ready**.
2. Tap **Record**, speak your question or instruction, then tap **Stop**.
3. The bridge transcribes the audio server-side, prompts the shared Cursor
   agent, synthesizes the reply server-side, and plays it back in the WebView.
4. The transcript appears under the playback bar; state returns to **ready**.

The browser captures audio only. Speech-to-text runs on the bridge host so the
Mini App CSP is never widened beyond `connect-src 'self'`.

**Amendment (2026-07-27):** operator chose **local hybrid audio** — server-side
STT via whisper.cpp (no OpenAI quota) and **browser `speechSynthesis`** for
playback instead of server TTS. See
[BL-696 amendment — local hybrid audio](../reference/specs/BL-696-amendment-local-hybrid-audio.md).

### Local mode (recommended)

```bash
export LETS_TALK_AUDIO_ENGINE=local
export WHISPER_MODEL_PATH=~/.swarmforge/models/ggml-base.bin
export WHISPER_CPP_BIN=whisper-cli   # or path to whisper.cpp main binary
export FFMPEG_BIN=ffmpeg             # optional; converts webm/mp4 from the phone
export LETS_TALK_SPEECH_LANGUAGE=auto  # default: detect fr/en each turn
```

Use a **multilingual** whisper model (`ggml-base.bin`, not `base.en`) so French
STT works. Force a language with `LETS_TALK_SPEECH_LANGUAGE=fr` or `=en`.

Each turn returns `speechLocale` (`fr-FR` or `en-US`). The Mini App sets
`speechSynthesis` to that locale and picks the best installed phone voice.
The Cursor agent is prompted in the matching language.

Restart the bridge after setting env vars.

### OpenAI mode (legacy v1)

When `LETS_TALK_AUDIO_ENGINE=openai` (or unset) and `OPENAI_API_KEY` is set,
the bridge uses OpenAI Whisper + TTS and returns `replyAudioBase64`.

## Shared Session with Cursor Remote

By default, Let's Talk uses the same `agentId` as the **Cursor Remote**
Telegram topic. Context from an audio turn is visible to the text topic, and
vice versa.

Use **New session** when you want a fresh Cursor agent with no prior context.
That clears the shared session the same way `/new` does on the text topic.

## Auth and Failure Posture

- `POST /lets-talk/turn` and `POST /lets-talk/new-session` require the same
  console control auth as the other Mini App control routes (bearer plus
  `X-Control-Token`). A missing or wrong token returns **401** with no
  speech-to-text spend and no agent prompt.
- Transient speech-to-text errors retry within a bounded budget; the screen
  briefly shows **error** while retrying, then completes or surfaces a
  recoverable message.
- Structurally bad audio surfaces a recoverable on-screen error and does not
  wedge the session.

## What This Screen Is Not

- Not a replacement for the Cursor Remote or Concierge text topics.
- Not coordinator, operator, or pipeline voice.
- Not background or lock-screen playback.
