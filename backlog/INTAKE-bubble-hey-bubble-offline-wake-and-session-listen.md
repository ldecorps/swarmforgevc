# Raw intake — Bubble “hey bubble” offline wake + session listening

Status: new intake, not minted. Do not build yet — capture only (human via Let's Talk 2026-07-30).

Related
- `backlog/INTAKE-voice-barge-in-to-interrupt-and-resteer-bubble-speech.md` — barge-in and re-steer while speaking/thinking; this intake owns the wake → active → silence-end state machine around that.

## Goal

Alexa / Google-style listening for Bubble:

1. **Passive (offline):** always listen only for the wake phrase **“hey bubble”**, entirely on-device in the app — no LLM, no bridge turn, no cloud STT for that trigger.
2. **Active:** after wake, what the human says next is a model turn (bridge). Back-and-forth continues; human may barge in / steer mid-reply (see related intake).
3. **Session end (hands-free):** after Bubble finishes an answer, the human may
   still reply once (e.g. “thank you”). If they then say nothing more for a
   short silence window, treat that as “I’ve got nothing more to say” and
   return to passive wake-only. Silence alone after Bubble’s answer also ends
   the session the same way — no need to force a closing phrase.
4. **Re-entry:** only “hey bubble” (or explicit UI / push-to-talk) starts active listening again.
5. **Push-to-talk** stays a separate mode: mic is manual; no always-on active
   session that auto-returns to passive via silence. Hands-free owns this
   passive ↔ active loop.

## Feasibility (answered 2026-07-30)

**Yes — passive wake can be fully offline / client-only.**

- On-device **keyword spotting** (wake-word engine) runs locally on the phone CPU/NPU.
- It does not need an LLM, the Let's Talk bridge, or network for the wake decision.
- Bridge / LLM connectivity is required only after the switch to **active** (ensure bridge reachable, then send the follow-on utterance as a turn).
- Caveat: Android’s stock `SpeechRecognizer` is often cloud-backed — **not** acceptable for the passive path. Passive must use a true on-device spotter (e.g. Porcupine-class or equivalent open on-device model), not “always-on cloud dictation.”

## Problem

- Today hands-free / mic behavior is turn-oriented and does not match “always hear the wake phrase, then converse, then go quiet.”
- Leaving a full STT or bridge path open while idle would burn battery, bandwidth, and privacy for no reason.
- Without a clear session end, Bubble either stays hot forever or forces another manual mic gesture every turn.

## Why this matters

- Hands-free should feel like a domestic assistant: wake once, talk, stop when done.
- Idle cost and privacy stay low if wake is offline-only.
- Same product story as barge-in: live conversation while active; dormant otherwise.

## Requested outcome

- Passive mode: on-device “hey bubble” only; **zero** bridge `/lets-talk/turn` (and no LLM) until wake fires.
- On wake: strip or gate the wake phrase; ensure bridge connection; capture the command that follows; run a normal turn.
- While active (hands-free): conversation continues without repeating the wake
  phrase each time; barge-in / re-steer per related intake.
- After Bubble’s spoken answer completes: start a **silence timer** (default
  **10 seconds**, from Alexa ~8s / Google ~8–10s / Gemini Live ~15s research;
  not 20–60s).
- If the human speaks again in that window (follow-up question, or a short
  closer like “thank you” / “thanks”), that utterance is handled as a normal
  turn or as a soft close; then the silence timer runs again.
- **Nothing more after that** (timer expires) → back to passive. That is the
  main “I’m done” signal in hands-free — not staying hot forever after a polite
  closer.
- Speech during the window that is a real follow-up resets the timer and keeps
  the session active.
- Explicit hard end phrases (“stop”, “I’m done”, “goodbye”) may still drop to
  passive immediately without waiting out the full silence window.
- Soft closers (“thank you”, “thanks”) should not keep the session alive by
  themselves: after they are acknowledged (or lightly ignored as non-tasks),
  silence wins and passive resumes.
- Push-to-talk remains an alternate mode; this silence / closer policy is the
  hands-free default only when hands-free is on.

## Scope intent

- State machine: PassiveWake ↔ ActiveListen ↔ Thinking ↔ Speaking (with barge-in back to ActiveListen).
- On-device wake spotter ownership in the Bubble app (overlay / TalkEngine lifetime).
- Hard rule: passive path never calls the bridge or an LLM.
- Active path: existing BridgeClient turn flow after connectivity check.
- Configurable silence duration later; ship default 10s.
- Cross-wire with barge-in intake for interrupt-while-speaking / while-thinking.

## Acceptance shape to refine

1) With network off (or bridge unreachable), saying “hey bubble” still wakes locally (UI / local ack); only the follow-on model turn fails loudly if bridge is down.
2) With bridge up, “hey bubble …” then a request produces one turn; follow-ups within 10s need no wake phrase.
3) After an answer, 10s of silence with no speech returns to passive; a later request without wake is ignored for model routing.
4) After an answer, human says “thank you” (or similar) then stays quiet for the silence window → passive; Bubble does not stay in active listen just because thanks was heard.
5) Passive idle produces no bridge turn traffic.
6) Barge-in while speaking in active mode still works (related intake).
7) Push-to-talk mode is unchanged when hands-free is off (no auto passive return via silence).

## Open design questions

1) Exact wake variants: “hey bubble”, “hi bubble”, locale / accent robustness?
2) Same-utterance wake+command vs beep-then-listen after wake only?
3) Local ack sound/TTS on wake before bridge is confirmed?
4) Battery / always-on mic foreground-service policy on Android 14+?
5) One short local reprompt before session end, or silent close only (v1 = silent close)?

## Widget size (captured + applied 2026-07-30)

- Human asked for the floating bubble ~**25% smaller**.
- Overlay was `96dp` → **`72dp`**; icon `52dp` → **`39dp`** (`overlay_bubble.xml`). Rebuild/redeploy APK to see it.

## Color coding (propose — agree before coding phase colors)

Today (overlay disc):

| State | Color | Hex (approx) |
|-------|--------|----------------|
| Ready / idle | Green | `#238636` |
| Active listening (recording) | **Red** | `#DA3633` |
| Thinking | Amber | `#D29922` |
| Speaking | Blue | `#1F6FEB` |
| Error | Red | `#DA3633` |
| Paused | Gray | `#6E7681` |

Human constraint: **red stays active listening** (hot mic to the model). Passive wake listening must not be red.

**Agreed passive (wake-only) color: soft teal** `#2A9D8F` (`sf_bubble_passive` in themes.xml) — human confirmed 2026-07-30. Standby “armed” without looking like hot mic (red), thinking (amber), or speaking (blue). Keep current green for non-wake idle until wake ships; then wire teal on PassiveWake.

## Non-goals (this intake)

- Building the wake/session feature in this capture pass.
- Server-side or LLM-based wake detection.
- Dual Telegram poller / Bubble topic twin work (separate track).
- Painting the bubble teal before PassiveWake exists (resource reserved only).


## specifier_disposition

**2026-08-02 — NOT drained. Parked with the other Bubble intakes, same blocker.**

This intake carried no disposition footer while every sibling did, which made it
look neglected rather than parked. It is not: it inherits exactly the block the
other Bubble screen intakes carry. The repo cannot yet write an *executable*
acceptance contract for Android behavior, and speccing Gherkin no runner can
execute is the defect BL-761 exists to stop.

**Resume point:** BL-769 (Android pure-logic JVM unit seam) must *ship*, not
merely be promoted. Verify that against `main` when resuming rather than
assuming it — as of today an `android/app/src/test/` directory exists in the
master working tree but is **untracked and ticket-less**, so it is hand work in
progress, not a landed seam. Its BL-506 disposition is itself still open (see
BL-787's notes on the untriaged 2026-08-02 bodies).

**Also needs the question slot.** Open choice 5 in this intake — one short local
reprompt before session end, or silent close only (v1 = silent close) — is the
human's to settle, and `role_ask.bb` permits one pending question per role. The
slot is currently held by GH-29 (asked 2026-08-02). The intake's own default
(silent close) is a reasonable v1 if the human never rules otherwise.

**Related, already minted:** BL-776 (EPIC — Bubble voice barge-in) and BL-777
(barge-in detector and playback abort) cover the sibling barge-in intake this
one points at. This intake owns the wake → active → silence-end state machine
around that, and is not superseded by it.
