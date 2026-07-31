# Raw intake — Bubble screen: watch the host agent think live (tmux-pane equivalent)

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-30).

Related
- `backlog/INTAKE-migrate-live-screen-from-mini-app-to-bubble.md` — migrate the
  existing Live Screen into Bubble; this intake is a **new** watch surface for
  the **host agent** (Cursor / Let's Talk agent), not a copy of today's Live
  Screen widgets.
- STEERING — Bubble is the one phone surface; messaging vs **host agent** naming.
- BL-696 / Let's Talk / bridge — host path that already owns the Cursor agent
  turn; this intake wants a live read of that agent's reasoning stream.

## Goal

On Bubble, open a **new screen** where the human can watch the **host agent**
(Cursor agent on the laptop / host) **think in near real time** — the phone
equivalent of staring at a **tmux pane** while the agent works.

As close to live as the pipe allows: streaming tokens / tool steps / status,
not a summary after the turn ends.

Host agent only. Other swarm seats (coder, specifier, …) are out of scope for
this intake.

## Problem

- Today the human hears or sees finished turns, not the agent's live thought
  loop.
- On the laptop they can watch a pane; on the phone there is no equivalent.
- Bubble is the always-on control surface, but it does not yet expose host-agent
  cognition while a turn or `/pilot` / Let's Talk session is running.
- Without that pane, trust and steering stay late: you only intervene after a
  wrong path has already burned tokens.

## Why this matters

- Same muscle as watching a tmux pane: presence, interruptibility, confidence.
- Lets the human barge or re-steer earlier (pairs with barge-in / talk intakes).
- Makes the host agent feel co-located with the phone, not a black box that
  answers later.
- Aligns with Bubble-first: the laptop pane should not be the only place to see
  the agent think.

## Requested outcome

### New Bubble screen — Host thinking

1. A dedicated Bubble screen (name bikeshed OK: Host pane / Thinking / Agent
   live) reachable from the talk panel or Bubble navigation.
2. While the host agent is active (Let's Talk turn, Cursor operator session,
   or equivalent bound host agent), the screen shows a **live-updating** feed
   of what it is doing: reasoning / status / tool or hat steps — whatever the
   host can stream without inventing a fake transcript.
3. Latency target: **as near real-time as practical** (stream or short polls);
   not “dump the full thought only when the reply is ready.”
4. When the agent is idle / swarm asleep / no host bound: clear empty or
   “host quiet” state — not a spinner forever, not a tunnel-error lookalike.
5. Scrollable history for the current session so the human can catch up if they
   glanced away; newest activity stays easy to find.
6. Optional later: jump back to talk / mic from that screen without losing the
   feed (out of slice 1 if costly).

### Host / bridge

7. Bridge (or host agent adapter) exposes a stream or event feed of host-agent
   activity suitable for the phone UI.
8. Do not require the human to keep a laptop tmux pane open for the same
   visibility.
9. Privacy / noise: do not spam secrets; prefer the same redaction posture as
   other operator surfaces if one already exists.

### Docs

10. Short how-to: what the screen shows, when it updates, what “quiet host”
    means, and that it is the phone stand-in for watching the host pane.

## Acceptance shape to refine

1) From Bubble, open the new Host-thinking screen.
2) Start or continue a host-agent turn; within a short bound, activity appears
   on that screen without waiting for the final spoken/text reply.
3) Feed keeps updating while the agent is working; stops cleanly when the
   turn / session ends.
4) Idle / no-agent case is explicit and calm.
5) Closing the screen does not kill the host agent; reopening resumes or
   reconnects to the live feed for the active session.
6) Does not depend on Telegram Mini App Live Screen for this capability.

## Out of scope

- Full Live Screen migration parity (separate intake).
- Streaming swarm role panes (coder, specifier, …) — **host agent only**.
- Replacing Let's Talk voice replies with the thinking feed.
- Exact pixel clone of tmux chrome; intent is equivalent visibility, not a
  terminal emulator unless that proves cheapest.

## Open questions

1) Source of truth: Cursor agent SDK events, bridge progress, transcript
   walker, or a new host “thinking” channel?
2) First slice: Let's Talk turns only, or any Cursor Remote /pilot session too?
3) Native Bubble list UI vs WebView of an existing host debug view?
4) Should barge-in / “stop and re-steer” affordances sit on this screen in
   slice 1, or talk-panel only?

## Suggested type / priority hint for mint

- type: feature (new Bubble surface + host stream)
- mutation_cost: medium (bridge stream + Android screen); possibly high if
  Cursor does not already expose a usable event feed
- Not offline expeditor. Specifier first; queue-jump only if the human asks.
- Likely epic + thin slice A (shell + one live source) rather than one fat
  ticket.

---

## Specifier disposition 2026-07-31 — NOT drained, sequenced behind BL-761

Read and assessed. Blocked on a real finding, not on ambiguity: this repo has
no way to write an executable acceptance contract for Android device behavior.
There is no `test`/`androidTest` source set under `android/`, no JVM unit
suite, and the acceptance runner (`specs/pipeline`) is Node and cannot reach
Kotlin. Measured 2026-07-31: BL-707 runs 0 of 6 scenarios, BL-706 0 of 4,
BL-718 0 of 6, BL-696 3 of 8 — all shipped, all "no step handler matched".

Speccing another Bubble ticket today would mean writing one more inert
acceptance contract, which is precisely the defect BL-727 and BL-761 exist to
stop. BL-761 (`backlog/paused/`) specs the gate and names the Android-seam
policy as its own out-of-scope sequencing hazard.

Resume point: once the Android-seam policy is settled (where device behavior
is verified, given it cannot ride the Node acceptance runner), spec these
against it. The behavior captured above is clear and needs no further
questions — only a place to put its contract.
