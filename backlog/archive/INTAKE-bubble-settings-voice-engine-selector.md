# Raw intake — Bubble Settings: Local / OpenAI voice-engine selector

Status: new intake, not minted. Capture only (human via Cursor 2026-08-08).

Posture: **normal pipeline** — mint a BL, spec, implement through the swarm.
**Do not land this as an operator/Cursor hotfix.** The human explicitly asked
to put the swarm on notice and refuse a hotfix path.

Related (context, not blockers)
- Let's Talk audio already supports both engines via env:
  `LETS_TALK_AUDIO_ENGINE=local|openai` + `OPENAI_API_KEY` on the bridge host
  (`extension/src/bridge/letsTalkAudio.ts`, docs
  `docs/how-to/BL-696-miniapp-lets-talk-cursor-audio.md`).
- Bubble Settings dialog today: hold music, mute, hold-music volume
  (`android/.../dialog_settings.xml`, `TalkPanelActivity.showSettingsDialog`).
- Bubble remote config (`letsTalkBubbleConfig.ts` / BL-765) is feature flags
  only — no voice-engine field yet.
- Agent brain stays Cursor (`createLiveCursorBridgeAgentSession`). **Out of
  scope** to switch replies to GPT Chat Completions.

## Goal

- From Bubble's **Settings** screen, the human can pick the Let's Talk
  **voice engine**: **Local** (whisper.cpp + device `speechSynthesis` /
  current local path) or **OpenAI** (Whisper STT + OpenAI TTS).
- The choice reaches the **bridge** and actually changes STT/TTS for
  subsequent turns — not a phone-only preference that the host ignores.
- The **Cursor bridge agent** (the brain) is unchanged.

## Problem

- Switching voice today requires host env + bridge bounce
  (`LETS_TALK_AUDIO_ENGINE=openai`, `OPENAI_API_KEY`, bounce). That is
  invisible for day-to-day phone use.
- Settings already owns talk prefs (hold music / mute / volume) but has no
  voice-engine control.
- Human wants OpenAI voice quality available from the phone without changing
  who answers (Cursor).

## Locked human decisions (carry through)

1. **Voice only.** STT/TTS engine switch. Do **not** change the agent
   session / brain to OpenAI GPT.
2. **UI home:** Bubble Settings dialog (same surface as hold music / mute /
   volume) — a clear Local vs OpenAI selector.
3. **No hotfix.** Specifier mints a normal BL; coder lands through the
   pipeline. No Cursor hand-patch that bypasses certification.
4. **Secrets stay on the host.** The phone must never store or transmit
   `OPENAI_API_KEY`. OpenAI mode requires the key already present in the
   bridge environment; if missing, selecting OpenAI must fail loudly with a
   usable reason (not silent fallback that looks like success).

## Specifier should decide (defaults welcome if human silent)

- Persistence shape: prefer a durable bridge-side preference (file under
  `.swarmforge/operator/` or an extension of bubble-config) over env-only,
  so a Settings tap survives without editing shell profiles. Env can remain
  the bootstrap / override if useful.
- Whether changing engine needs a bridge process restart, or adapters can
  hot-swap via `resolveLetsTalkAudioAdapters*` on the next turn. Prefer
  hot-swap if safe; bounce is acceptable if documented and the UI says so.
- Whether Mini App Let's Talk gets the same control in this ticket or a
  follow-up (Android Settings is the asked surface; Mini App parity is
  nice-to-have).
- Capability flag: optionally gate the selector behind bubble-config
  (`features.voiceEngineSwitch` or similar) per BL-765 remote-config shape.
- Testability: bridge/unit coverage for engine resolution + preference
  read/write; Android JVM seam if UI logic is extractable; device check as
  recorded manual procedure per Bubble testability boundary.

## Requested outcome

1. Settings shows a Local / OpenAI voice-engine selector.
2. Choosing OpenAI uses OpenAI Whisper + TTS for later turns when the host
   has `OPENAI_API_KEY`; choosing Local uses the local engine path.
3. Cursor agent prompting / session sharing with Cursor Remote is unchanged.
4. Missing OpenAI key or unavailable local engine surfaces a clear error /
   disabled state — no silent wrong engine.
5. Documented in the Let's Talk / Bubble how-to (how to set the key on the
   host; what the selector does).

## Acceptance shape to refine

1. With Local selected and local STT wired, a turn still transcribes locally
   and speaks via the local/client TTS path.
2. With OpenAI selected and `OPENAI_API_KEY` set on the bridge, a turn uses
   OpenAI transcription and returns/plays OpenAI TTS (or the existing
   OpenAI reply-audio path).
3. Toggling in Settings without changing brain: reply content still comes
   from the Cursor bridge agent session.
4. OpenAI selected + no key → user-visible failure reason; Local remains
   usable.
5. Preference persists across Bubble relaunch (and across bridge restart if
   the chosen persistence shape allows).
6. No hotfix commit path; work rides a minted BL through the normal stages.

## Notes from human request (2026-08-08)

- Human confirmed GPT Go / ChatGPT voice subscription is separate from this;
  they only want OpenAI **voice** for Bubble, not GPT as the thinker.
- Explicit: "Voix open ai ca suffit. Je ne veux pas changer le cerveau."
- Explicit: put the selector in Bubble Settings; put the swarm on notice;
  do not hotfix.

## Specifier disposition 2026-08-09 — DRAINED

Minted as epic **BL-862** (`bubble-voice-engine`, M8) with two slices split on
the Bubble testability boundary:

- **BL-863** — bridge side: a durable `local|openai` preference under
  `.swarmforge/operator/`, resolution moved into the per-turn path so a change
  applies with no bounce, and a loud named failure when the selected engine is
  unusable. Node-unit testable, no device.
- **BL-864** — Bubble side: the Settings selector that writes the preference,
  opens on the engine actually in use, and shows the bridge's refusal reason.
  JVM-testable state logic plus a recorded manual device procedure.

All four locked human decisions carried verbatim into BL-862 and repeated on
the slice that owns each. The two quoted directives ("Voix open ai ca suffit.
Je ne veux pas changer le cerveau." / "put the selector in Bubble Settings; put
the swarm on notice; do not hotfix.") travel on all three tickets.

The four calls this file delegated to the specifier are answered in BL-862's
`approval_context`: durable bridge-side preference (not env-only), hot-swap
rather than bounce, Mini App parity deferred to a follow-up, selector gated
behind a bubble-config capability flag.

Probe finding that changed the spec: the silent fallback this intake warns
about **already exists** — both branches of `resolveLetsTalkAudioAdapters` end
in `?? {}`, so an unusable engine yields empty adapters that read as success.
BL-863 owns that as a fix, not merely as a constraint on new code. And hot-swap
is not free: `startBridge` resolves adapters once at construction
(`bridgeServer.ts:1578`), so BL-863 must move resolution into the turn path.

Not minted, per the intake's own framing: Mini App parity, and any change to
the agent/brain.
