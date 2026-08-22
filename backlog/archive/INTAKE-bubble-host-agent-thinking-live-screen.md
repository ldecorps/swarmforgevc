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

---

## Specifier disposition 2026-08-06 — BL-769 blocker CLEARED; held on one cross-epic contradiction

The BL-769 blocker every prior disposition on this file names is GONE. BL-769
and BL-761 are in `backlog/done/M8/`, the Android testability policy is in the
constitution, and the gradle JVM seam runs. This intake is no longer blocked on
where an Android acceptance contract can live.

It is held on something new, found by reading the four screen intakes as one
cluster (BL-680 consolidation pass) instead of one at a time.

**The contradiction.** Two epics give opposite answers to how a Bubble screen
is built:

- **BL-774** (Bubble Live Screen epic, 2026-08-01) — "*Native UI only, or a
  staged WebView-backed migration?* — **Native**, from slice A. A WebView would
  carry the webview constraints this migration exists to escape." Its slice A,
  BL-775, is specced native and is already `human_approval: approved`.
- **BL-824** (Bubble thin shell + remote UI, 2026-08-06, human-approved) —
  the human's own locked decision of 2026-07-31: auto-update for most of the
  app, a thin native shell, and **APK only when the shell itself changes**.
  A new native screen changes the APK, which that decision forbids.

BL-774's "native" was a specifier default, explicitly labelled as such under
"the defaults taken". BL-824's is a human ruling. That asymmetry suggests the
answer, but reversing the technology of an already-approved ticket (BL-775) is
the human's call, not a specifier's — so it was asked rather than assumed.

**Asked of the human 2026-08-06** via `role_ask.bb`, with three options: remote
HTML for all screens (respec BL-775, screens sequence behind BL-825); native for
all screens (thin shell stops short of screens); or BL-775 stays native and only
new screens are remote.

**Why the whole cluster waits on it.** The answer decides each screen's
technology, its testability story (a bridge-served HTML bundle is Node-testable
today; a native page needs the JVM seam and a manual device procedure), its
`depends_on` (BL-825 or nothing), and whether these are slices of BL-774 /
BL-824 or their own epic. Speccing four screens before it lands would mean
rewriting four tickets afterwards.

**Nothing else on this intake is unclear.** Its human-locked decisions are sound
and are carried forward verbatim at mint. The remaining open questions the human
listed (page titles, pager order, window defaults, blurb source, chart-vs-number
layout) are specifier calls and will be decided at mint, not re-asked.

---

## Specifier disposition 2026-08-06 — DRAINED into BL-833 + BL-834 (1:N split).

Unblocked by the human's ruling of 2026-08-06:

> Remote HTML for all 4, and flip BL-775 to remote

Split as this intake's own mint hint asked ("Likely epic + thin slice A (shell +
one live source) rather than one fat ticket"):

- **BL-833** — the host-agent activity feed on the bridge (this intake's
  host/bridge requirements 7-9).
- **BL-834** — the Bubble Host page rendering it (requested outcomes 1-6), a
  remote HTML page. Epic BL-830.

**Open questions answered from the code, measured 2026-08-06.**

1. *Source of truth?* The **existing SDK progress lines**.
   `summarizeSdkProgressLine` already summarizes host events, and
   `createThrottledProgressReporter` already throttles them — but their only
   consumer in the whole tree is `telegramCursorBridgeLive.ts`, which sends them
   to Telegram. Nothing persists or serves them. No new channel and no
   transcript walker is needed; a tee and a read route are.
2. *Let's Talk turns only, or any Cursor session?* Any host session — the feed is
   keyed by session regardless of what started it, so restricting it would be
   extra work that removes capability.
3. *Native list vs WebView?* Settled by the human's ruling: remote HTML.
4. *Barge-in on this screen in slice 1?* No — the page is a window, not a
   cockpit, and BL-834's `approval_context` argues the case both ways for the
   human.

**Requirement 6 is met rather than deferred:** the pager swipe already returns to
Talk, and BL-834 re-seeds and re-attaches on return, so no separate affordance is
built.

**Redaction (requirement 9) is deliberately absent, and BL-833 says so plainly:**
verified 2026-08-06, no redaction helper exists in `extension/src` to inherit a
posture from. The feed changes no exposure class — every line is already going to
the operator's Telegram topic under the same principal — so a real redaction pass
belongs in its own ticket covering every surface at once, Telegram included.
