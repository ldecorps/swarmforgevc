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
- status badges for **wake lock**, **bridge health**, and **PWA install**;
- optional **Hands-free**, **Mute voice playback**, **Keep screen awake**, and
  **Hold music** toggles;
- **Pause all** (stops mic/playback/hold music until Resume);
- **Install app** (when the browser offers a PWA install);
- a **New session** control;
- a short text transcript of the latest agent reply after each turn.

Successful audio turns are also mirrored (best-effort) to the Cursor Remote
Telegram topic, including numbered choice polls when the reply lists options.

**Amendments:**

- [Local hybrid audio](../reference/specs/BL-696-amendment-local-hybrid-audio.md)
  (2026-07-27) — whisper.cpp STT + browser `speechSynthesis`.
- [Operator console post-ship](../reference/specs/BL-696-amendment-lets-talk-operator-console.md)
  (2026-07-29) — PWA auth, hold music, wake lock, Pause all, Cursor Remote
  mirror, `/redeploy miniapp`, miniapp watchdog.
- [Floating minimize](BL-706-lets-talk-floating-minimized-chat.md)
  (2026-07-29) — compact draggable bubble with record + pause + expand.
- [Android floating overlay companion](BL-707-android-floating-overlay-companion.md)
  (2026-07-29) — native bubble over other apps; home hands-free with
  settings, volume, and playlist.

## Record a Turn

1. Wait until state is **ready** (bridge badge healthy; bearer present).
2. Tap **Record**, speak your question or instruction, then tap **Stop**.
3. The bridge transcribes the audio server-side, prompts the shared Cursor
   agent, and the WebView speaks the reply via `speechSynthesis` (local mode).
   Quiet hold music plays during `thinking` when enabled.
   Catalog includes the Zappa set plus BL-705 iconic homages (Thanatos,
   Ghost'n Goblins, Zelda, Tron, Tetris, Mega Man) — see
   `docs/how-to/BL-705-lets-talk-more-chiptunes.md`.
4. The transcript appears under the playback bar; state returns to **ready**.

The browser captures audio only. Speech-to-text runs on the bridge host so the
Mini App CSP is never widened beyond `connect-src 'self'`.

### Install on the home screen

1. Open Let's Talk once from a console/Telegram link that includes `?bearer=…`
   (the page stores the token in `localStorage` + cookie).
2. Tap **Install app** (or the browser “Add to Home Screen” flow).
3. The installed shortcut uses a manifest `start_url` that includes the bearer,
   so launches stay signed in. Bare `/lets-talk` without a stored token still
   loads the shell but turns return **401**.

### Local mode (recommended)

```bash
./swarmforge/scripts/start_bridge_headless.sh /path/to/repo 8765
./swarmforge/scripts/stop_bridge_headless.sh /path/to/repo

# After Mini App / bridge code changes: compile extension + restart so the
# new build is live (probes /lets-talk).
./swarmforge/scripts/bounce_bridge_headless.sh /path/to/repo 8765
```

The **supervisor** (`bridge_headless_supervisor.bb`) auto-restarts the bridge on
crash or stalled `/lets-talk` health. Logs:
`.swarmforge/operator/bridge-headless-supervisor.log`

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
vice versa. After each successful turn the bridge also posts the reply text
into the Cursor Remote topic (and a poll when the reply is a numbered choice
list).

Use **New session** when you want a fresh Cursor agent with no prior context.
That clears the shared session the same way `/new` does on the text topic.

On the Cursor Remote topic, `/redeploy miniapp` compiles the extension and
bounces the headless Mini App bridge. The operator runtime can also auto-bounce
when `/lets-talk` stays down (see the
[operator console amendment](../reference/specs/BL-696-amendment-lets-talk-operator-console.md)).

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

## Developer Gates (Let's Talk + cursor bridge)

From `extension/`:

```bash
npm run coverage:lets-talk-cursor-bridge   # >= 90% per scoped production file
npm run crap:lets-talk-cursor-bridge       # CRAP <= 6 (includes telegramCursorBridgePilot)
npm run test:properties                    # BL-696 invariant property tests
npm run mutation:lets-talk-cursor-bridge   # hardener: scoped Stryker (includes Pilot)
```

### Cursor Remote `/pilot` (operator)

On the Cursor Remote Telegram topic, `/pilot [BL-xxx]` asks the **Cursor bridge
agent** to staff an offline expedition (Cursor-as-expeditor). It does **not**
spawn `claude -p` / `expedite_cli`. `/pilot` is refused while an automated
`/expedite` lock is held. Sibling verbs (`/hydrate`, `/autopilot`, `/land`,
shifts/holidays) live on the same surface — see
[BL-698 operator commands how-to](BL-698-telegram-cursor-operator-commands.md)
and
[BL-696 amendment — Telegram operator commands](../reference/specs/BL-696-amendment-telegram-operator-commands.md).

After TypeScript changes, restart the headless Mini App bridge:

```bash
./swarmforge/scripts/bounce_bridge_headless.sh [repo-root] [port]
```
