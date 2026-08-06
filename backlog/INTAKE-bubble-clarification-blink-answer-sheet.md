# Raw intake — Bubble: pending clarification blink + answer sheet

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket. Human noted many prior attempts at this class of feature
did not really work; treat reliability of pending state and clear-on-answer
as first-class, not cosmetic.

Related
- `backlog/INTAKE-coordinator-questions-surface-via-telegram-and-bubble.md` —
  earlier capture: coordinator asks must surface on Telegram + Bubble nudge;
  answer preferred on Telegram. Specifier left undrained 2026-07-30 in a
  batch disposition. This intake is the drained Bubble-first UX: blink on
  collapsed bubble, open sheet, answer (or discuss further) **on Bubble**.
  Prefer one coherent epic that covers both surfaces rather than minting
  conflicting twins; do not silently drop Telegram if that intake still
  stands.
- BL-607 — `role_ask.bb` per-role clarifying questions with optional choices;
  Telegram topic buttons already exist. Bubble should consume the **same**
  pending-question state and answer channel, not invent a second system.
- BL-410 / Approvals buttons — prior art for choice taps + amend-style flows.
- BL-707 — Android floating overlay companion (collapsed bubble colors /
  phases today are talk/recording oriented, not needs-clarification).
- Sibling Bubble pager intakes (Notes, Control, Live) — this may be a
  dedicated Questions sheet on expand, or a modal over Talk; specifier picks.

## Goal

When an agent asks the human for clarification, the **collapsed** Bubble
pulses an attention color so the human notices without staring at Telegram.
Tapping opens a question sheet: the asker's choices plus one extra choice,
**discuss it further**. The human can answer there; discuss-further opens
Let’s Talk with that question in context.

## Problem

- Clarifying questions still stall when the human is not watching the right
  surface.
- Prior attempts at phone / cross-channel attention for these asks have not
  stuck in practice.
- Collapsed Bubble today does not shout “something needs your pick.”
- Even when the human sees a question, answering from Bubble (with choices)
  is not a reliable first-class path.

## Why this matters

- One pending clarification can block a whole pipeline role.
- Bubble is the always-on overlay; a blink is the right attention channel.
- Choices plus discuss-further matches how the human actually decides:
  pick now, or talk it through.

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Collapsed attention.** While a clarification is truly waiting, the
   overlay circle **blinks / pulses** an attention color (default proposal:
   **amber**, distinct from recording red and Let’s Talk green). Specifier
   may tune hue; human left color to a sensible pick.
2. **Clear when done.** Blink stops when the question is answered, cancelled,
   or superseded. No zombie blink.
3. **Open sheet.** Tap / expand surfaces the pending question: who asked,
   question text, the **given choices**, plus one extra choice:
   **discuss it further**.
4. **Answer path.** Tapping a listed choice submits the answer on the
   **existing** canonical answer channel (same as Telegram `role_ask` /
   button answers). No second decision system.
5. **Discuss further.** That choice does not fake an option pick; it opens
   Let’s Talk with the pending question in context so the human can talk
   through it.
6. **Reliability over chrome.** One clear pending state at a time for version
   one (align with `role_ask` one-pending-per-role if that remains the
   contract). Blink only while waiting is real.
7. **Out of version one.** Fancy multi-question inbox UI; inventing a new
   ask protocol; replacing Telegram entirely (unless specifier folds both).

## Requested outcome

1. Bridge (or existing pending-question store) exposes “clarification waiting”
   to the companion in a form Bubble can poll or push.
2. Collapsed Bubble pulses while waiting; stops when cleared.
3. Question sheet with choices + discuss further; choice answers land in the
   same place Telegram answers do.
4. Discuss further → Let’s Talk session primed with the question context.
5. Document the attention color and clear rules in the companion how-to.

## Acceptance shape to refine

1) Agent raises a clarification with options → collapsed Bubble pulses within
   a short bound while bridge reachable.
2) Open Bubble → see question, options, and discuss further.
3) Tap an option → pending clears, blink stops, role unblocks as with a
   Telegram answer.
4) Tap discuss further → Let’s Talk opens with that question context; blink
   policy for “still unanswered while discussing” is specifier-owned (propose:
   keep pulsing until a real answer is submitted).
5) No pending question → no attention pulse.
6) Stale / already-answered question never re-arms the blink.

## Out of scope

- Notes / Control / Live pager features (separate intakes).
- Replacing BL-607 ask creation.
- Email escalation of clarifications (unless already covered elsewhere).
- Minting without specifier disposition.

## Suggested type / priority hint for mint

- type: feature (high human-facing value; prior failed attempts → treat as
  reliability-sensitive)
- mutation_cost: medium–high (pending-question read API + Android pulse +
  answer sheet + discuss→Talk handoff + how-to; Android acceptance-seam /
  BL-761 sequencing applies)
- Coordinate with
  `INTAKE-coordinator-questions-surface-via-telegram-and-bubble.md` on mint.
- Not offline expeditor unless the human asks — but this unblocks stalled
  asks, so queue priority is a fair specifier judgment call.

## Specifier: please weigh in

Open questions the human did not fully lock:
- Exact amber (or other) pulse cadence and accessibility (reduce-motion).
- Expand gesture vs dedicated tap target while double-tap-expand intake is
  also pending.
- Whether discuss-further keeps the blink until a formal answer exists.
- Multi-role: if two roles ask, v1 show one (which?) or a short queue.
- Voice nudge in addition to blink (older intake asked for speech nudge).
- Native sheet vs WebView.

---

## Specifier disposition 2026-08-02 — NOT drained, same blocker as the sibling intakes

Read and assessed. Held for the same reason the four sibling Bubble intakes
were held on 2026-07-31, re-verified today: this repository still has no
settled policy for where Android device behaviour's acceptance contract lives.
Speccing this today would mean writing one more inert feature file — every
scenario failing "no step handler matched" — which is exactly the defect
BL-761 and BL-769 exist to stop.

Re-checked 2026-08-02, and one thing HAS changed: a JVM unit seam now exists
in the tree, hand-built by the Bubble pairing hotfix (`junit` in
`android/app/build.gradle.kts`, plus `PairingSaveTest.kt`). So "can a JVM test
run here at all" is now answered YES by demonstration. That does **not**
unblock this intake, because the missing piece was never the mechanism — it is
the POLICY naming the Android device surface as environmentally unsuitable and
stating where Bubble behaviour is verified instead. BL-769 has been amended to
narrow onto exactly that, and remains the keystone.

Resume point: once BL-769 lands its policy, spec this against it.

**Split hint for whoever drains this.** The blocker covers Android *device*
behaviour only. If this intake contains a slice that lives on the bridge, the
extension host, or `.swarmforge/` state — data, endpoints, or projections the
phone merely renders — that slice is testable in the Node runner today and is
NOT blocked. Split it out and spec it rather than holding the whole intake
behind BL-769.

---

## Specifier disposition 2026-08-06 — both prior blockers CLEARED; still at root, next in line

Every earlier disposition on this file holds it behind the Android
acceptance-seam blocker. **That blocker is gone** (BL-769 and BL-761 are in
`backlog/done/M8/`; the Testability Boundary — Bubble policy is in the
constitution; the gradle JVM seam runs).

The second blocker — how a Bubble screen is built — is also gone. The human
ruled 2026-08-06:

> Remote HTML for all 4, and flip BL-775 to remote

so a Bubble SCREEN is a remote HTML page in the UI bundle (BL-825 resolves it,
BL-829 renders it), and no screen changes the APK.

This intake was NOT in that four-screen cluster and is not drained yet. It is
next in line, and whoever drains it must place it against BL-824's thin-shell
boundary rather than assume the screens ruling covers all of it: the
collapsed-bubble gestures, the overlay window, the mic/talk engine and the wake
word are **native shell** by BL-824's locked decision 2, while pages and sheets
are candidates for remote HTML. An intake that straddles that line splits along
it. BL-824's slice E tracks the remaining placement work.

**No question is pending on this file.** Nothing here needs the human before it
can be drained.
