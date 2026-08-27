# Raw intake — Bubble gestures: double-tap expands; tap = mic / send

Status: new intake, not minted. Capture only (human via Cursor 2026-07-30).

Related
- BL-707 — Android floating overlay companion; today **single tap** expands the
  Let's Talk panel; long-press pauses / resumes all. Mic start / stop-and-send
  live on the expanded panel (and hands-free), not on the collapsed bubble.
- `docs/how-to/BL-707-android-floating-overlay-companion.md`
- Other bubble gesture intakes (hey-bubble wake, barge-in, finish-shift
  reachability) — complementary; do not change those verbs here.

## Goal

Collapsed-bubble gesture model:

1. **Double-tap** → expand the Let's Talk panel.
2. **Single tap** → open the mic (start recording a turn).
3. **Another single tap** (while recording) → stop and **send** the question.

## Problem

- A single tap opens the talk panel — expand is too easy over other apps.
- Push-to-talk from the compact bubble requires opening the panel first.
- Human wants deliberate expand (double-tap) and a two-tap talk loop on the
  bubble itself: tap to speak, tap again to send.

## Why this matters

- Bubble is the always-on control surface; voice should work without expanding.
- Expand stays intentional (double-tap).
- Matches a simple push-to-talk rhythm: open mic → speak → tap to send.

## Requested outcome

### Expand

1. Double-tap the floating bubble → expand / open the Let's Talk panel
   (same panel as today's tap-to-expand).
2. Single tap no longer expands the panel.
3. Drag / move / drag-to-X teardown unchanged; double-tap must not fight drag
   (ignore expand if the finger clearly moved).

### Talk from collapsed bubble

4. Single tap when **not** recording → start mic / begin a voice turn
   (bubble stays collapsed; phase color / FGS mic behavior as today when
   recording).
5. Single tap while **recording** → stop capture and send the turn (same
   path as panel “stop recording” / send today).
6. If mic permission is missing → prompt / toast as today; do not pretend to
   record.
7. Long-press pause / resume behavior unchanged (and should not be confused
   with the tap mic/send loop).

### Docs

8. How-to line updated, e.g.: “Tap to talk / tap again to send; double-tap to
   expand; long-press to pause / resume.”

## Acceptance shape to refine

1) Double-tap collapsed bubble → talk panel opens.
2) Single tap when idle → mic opens / recording starts; panel does **not** open.
3) Single tap while recording → turn is sent; recording stops.
4) Long-press still toggles pause / resume.
5) Dragging the bubble does not count as tap or double-tap.
6) From the expanded panel, collapse still returns to the bubble as today;
   panel Record / Stop still work.

## Out of scope

- Reworking hold music, mute, playlist, or remote capability flags.
- Hey-bubble offline wake / barge-in / silence-to-passive (those may also
  open the mic; coordinate later so gestures do not fight).
- Changing typed-turn UX inside the expanded panel.
- Mini App minimize bubble (BL-706) — Android overlay only unless asked.

## Suggested type / priority hint for mint

- type: feature (UX gesture change on shipped BL-707 path)
- mutation_cost: low–medium (overlay gesture wiring + TalkEngine start/stop
  from bubble + how-to)
- Not offline expeditor. Queue-jump only if the human asks.

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

## Specifier disposition 2026-08-06 — BL-769 blocker cleared, but a design conflict needs the human

The 2026-07-31 blocker above is GONE: BL-769 and BL-761 are in
`backlog/done/M8/`, the Android testability policy is in the constitution, and
the gradle JVM seam runs. This intake is drainable.

It is not drained yet because probing the code surfaced a conflict between two
of the requested verbs that the intake does not resolve.

**Measured** (`OverlayService.kt:355-430`): the collapsed bubble runs one
hand-rolled touch state machine — `moved` / `longPressFired` / `touchSlop * 2`
/ `ViewConfiguration.getLongPressTimeout()` — and `ACTION_UP` with `!moved`
calls `onTap()` immediately. There is no double-tap concept anywhere in it.

**The conflict.** Requested outcome 1 (double-tap expands) and requested
outcome 4 (single tap when idle starts the mic) cannot both be instant. A tap
is not known to be single until the double-tap window (~300 ms) has expired,
so from idle either:

- the mic start waits out that window and push-to-talk feels late — against
  the intake's own "simple push-to-talk rhythm: open mic → speak → tap to
  send"; or
- the mic starts on tap 1, and a fast second tap hits requested outcome 5
  (stop and send) instead of expanding — so double-tap-to-expand simply never
  fires from idle, which is the state you would most often expand from.

Note this does NOT affect the recording state: once recording, a tap can send
immediately, because there is no competing idle-tap meaning to disambiguate.

Asked of the human 2026-08-06 via `role_ask.bb`. Resume here with the answer;
no other question is open on this intake, and the rest of its verbs (drag
unchanged, long-press pause/resume unchanged, permission prompt as today) are
clear and need no further input.

---

## DRAINED 2026-08-06 -> BL-828

Human answered the 2026-08-06 conflict question:

> Delay the idle tap ~300ms so double-tap can expand (mic starts slightly late)

Specced as `backlog/paused/BL-828-bubble-collapsed-gesture-model.yaml`, with
`specs/features/BL-828-bubble-collapsed-gesture-model.feature` as its acceptance
contract (lint-clean, IR-DRY 0 findings), bound to the BL-769 gradle JVM unit
seam. `human_approval: pending`.

Consolidation (BL-680): drained 1:1, NOT merged with any sibling Bubble intake.
The four screen intakes are remote UI under the BL-824 thin-shell epic and share
no code with the native overlay touch path; the hey-bubble wake intake is new
voice capability whose gestures must be arbitrated against this decider after it
exists rather than designed blind alongside it.

Every requested outcome (1-8) is carried into BL-828. Two consequences of the
human's ruling that the intake did not state are decided in the ticket and
flagged in its `approval_context` for the human's eye: the deferral applies to
the IDLE tap only (so a double-tap while recording sends AND expands), and the
whole gesture state machine is extracted to a pure-logic decider so acceptance
item 5 (dragging is never a tap) has a runnable contract.
