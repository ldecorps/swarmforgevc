# Intake: audio conversation mode for agents, starting with coordinator

Filed by the coordinator (2026-07-15), human's own words: "add audio
conversation mode to agents, starting with coordinator." This is a RAW ask,
not a spec: the specifier drains this like any other backlog-root item and
decides what (if anything) becomes a real ticket, including scope, sequencing,
and whether "starting with coordinator" means a coordinator-only slice first
with other roles as explicit follow-ups.

## Context (verified against the live code, not from memory)

- No existing audio/voice surface exists in this codebase today — grep for
  "audio", "voice", "speech", "tts", "stt" under `extension/`, `swarmforge/`,
  and `pwa/` turns up nothing. This is a new capability, not an extension of
  something already wired.
- Today every role (including the coordinator) is a headless `claude` CLI
  process running inside a tmux pane (see `swarmforge/roles/coordinator.prompt`
  and the launch commands in `.swarmforge/launch/`), driven entirely by text:
  handoff mail, tmux keystroke injection, and pane output. There is no audio
  I/O path anywhere in the current architecture — no microphone capture, no
  TTS output, no telephony/WebRTC integration.
- The two existing human-facing surfaces are the static backlog-dashboard PWA
  (`pwa/`, a read-only git-state projection) and the live holistic UI
  (`extension/src/bridge/holisticUiHtml.ts`, served by `bridge/bridgeServer.ts`)
  plus the Telegram front-desk/Operator channel
  (`swarmforge/scripts/front_desk_supervisor_lib.bb`,
  `swarmforge/scripts/operator_runtime.bb`). None of these carry audio.
- The coordinator itself never engages with the domain (see its role prompt's
  "Altitude" section) and is explicitly meta/process-only — so "audio
  conversation mode... starting with coordinator" most likely means giving the
  *human* a voice channel to talk to the coordinator specifically (as the
  routing/status role), not that the coordinator gains new domain
  responsibilities. The specifier should confirm this reading with the human
  if it's ambiguous rather than assume.

## What the specifier should scope

- Whether this rides an existing channel (e.g. a voice mode bolted onto the
  Telegram front desk, which already has bridge/session plumbing) or needs a
  new one (e.g. WebRTC/mic capture into the live holistic UI webview).
- What "conversation mode" means concretely: push-to-talk one-shot voice
  commands, or a continuous two-way spoken exchange with the coordinator while
  it's idle/between handoffs.
- Which existing constraints this must respect: the extension-host secrets
  boundary (local-engineering.prompt), the webview storage/postMessage
  isolation rules, and the "coordinator never self-schedules polling" rule —
  a live audio session must not turn the coordinator into a polling loop.
- Whether "starting with coordinator" implies a planned follow-up sequence to
  other roles (the specifier should say so explicitly if it slices the epic
  that way, per the epic runtime-wiring-slice rule — no epic should ship a
  coordinator-only slice while silently leaving "and the other roles" as an
  untracked gap).

Out of scope for this intake note (specifier's call whether to fold in or
split out): audio for any role other than the coordinator, until a follow-up
ticket explicitly scopes it.
