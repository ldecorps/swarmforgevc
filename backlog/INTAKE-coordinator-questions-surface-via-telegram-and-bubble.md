# Raw intake — Coordinator questions must surface via Telegram and Bubble alerts

Status: new intake, not minted.

Problem
- A coordinator question arrived through cloud remote control.
- The human was not watching that surface at the time.
- The coordinator flow blocked waiting for an answer.
- There was no reliable cross-channel alert to pull attention.

Why this matters
- Silent waiting stalls the whole operator and coordinator path.
- Human response should not depend on watching one screen continuously.
- Clarifying questions must have a guaranteed attention path.

Requested outcome
- Coordinator questions surface in Telegram where the human already watches.
- The question should be answerable directly in Telegram, preferably as poll or clear one-tap options when options exist.
- Bubble should announce that a coordinator question is waiting.
- Bubble speech should nudge the human to respond in Telegram.
- Answers must route back through the existing flow without creating a second decision system.

Routing intent
- Question source can stay cloud remote control.
- Escalation path should route through Bubble and Telegram notification surfaces.
- Coordinator should receive the answer through the current canonical answer channel.

Acceptance shape to refine
1) When coordinator asks a question and the human is not on remote control, Telegram still gets the question quickly.
2) Telegram message includes explicit answer affordance:
   - poll or buttons when options exist,
   - free-text fallback when open answer is needed.
3) Bubble produces an audible waiting-question alert.
4) After answer is sent from Telegram, waiting state clears and no repeated stale alerts continue.
5) No duplicate or conflicting question states across channels.

Open design questions
1) Single standing Telegram topic for these questions, or route per role/topic map?
2) Poll first or inline buttons first for optioned questions?
3) Alert cadence in Bubble: one-shot, periodic reminders, or escalation ladder?
4) Should unanswered questions auto-escalate after a timeout?
5) How should stale or superseded questions be closed on Telegram?

Suggested slice candidates
- Slice A: Question surfacing bridge from coordinator asks to Telegram post.
- Slice B: Telegram answer controls and canonical answer relay.
- Slice C: Bubble voice alert for pending coordinator question.
- Slice D: Pending-question lifecycle and stale-close behavior.

Notes from human report
- This is a behavior and notification gap, not just a UI preference.
- Human expectation is that unattended remote-control asks still become visible and actionable in Telegram, with Bubble nudging attention.

---

## Specifier disposition 2026-07-30 — NOT drained, blocked on a question

Read and assessed; deliberately left in the root. Each of this intake's open
design questions changes the shape of slice A materially (e.g. for barge-in,
"wake phrase vs keyword vs pure VAD overlap" is the slice), so speccing now
would mean guessing rather than asking.

The specifier tried to raise one clarifying question covering the disposition of
all three intakes and was refused: `role_ask.bb` allows ONE pending question per
role, and the specifier's slot has been held since 2026-07-25 by an unanswered
question about BL-687 ("is per-topic 'Make top' enough to count as reordering
all child BL, or do you also want move up/down inside the drill-down?"). Answer
that one and the specifier's ask channel unblocks.

Resume point: ask whether these three should be minted as epic + slice A with
`human_approval: pending` and specifier-chosen defaults, or held as capture-only
like the hey-bubble-wake and stereo-router intakes.
