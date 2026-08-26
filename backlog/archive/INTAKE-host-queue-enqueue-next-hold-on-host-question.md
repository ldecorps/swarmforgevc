# ARCHIVED — drained by specifier 2026-08-26

Disposition: Already shipped as backlog/done/M8/BL-1146-host-queue-enqueue-next-hold-on-host-question.yaml — no remint.

---

# INTAKE — Host queue: "enqueue next" pin + hold when host asks a question

**Source:** human via Cursor, 2026-08-25 ~17:02 BST (UI tweak)  
**Amendment:** human via Cursor, 2026-08-25 ~19:41 BST  
**Surface:** Host / Cursor Remote bridge question queue (`pendingPrompts`) — maintain
path on BL-810/BL-811/BL-894; not new Telegram product chrome.

Status: **new intake, not minted.** Specifier: mint and spec (or soft-mint /
Cursor hotfix with `Hotfix-Certification: pending` if that is the house
shape for Host-topic maintain).

## Why this is in front of you

While Cursor is busy, inbound Host questions are queued with:

> Busy — question queued (N waiting). I will ask you to pick one when ready.

Today the pick poll only appears **after** idle
(`postQueueSelectionPoll` / `presentQueueSelectionPollAfterIdle` in
`extension/src/tools/telegramCursorBridgeLive.ts`), and a vote while still
busy is **dropped** (`processQueuedPollAnswer` returns after clearing the
poll when `holder.busy`). The human wants to **pre-choose** which queued
item runs automatically when idle ("enqueue next").

## Goal

1. Add an **"enqueue next"** option when presenting the queue (while busy
   and/or via `/queue`) so the chosen queued item is **pinned** as the
   automatic next run.
2. When the Host agent goes idle with a valid pin, **auto-start that item**
   without a second "choose next" poll.
3. Idle without a pin keeps today's choose-next poll (run on vote).
4. Clear pin on clear-all / drop / expiry of that id; ack after pin:
   `Enqueued next: <label>. Will start when idle.`

## Amendment (locked, 2026-08-25 ~19:41 BST) — do not auto-chain over a host question

If the Host **finishes its turn by answering with a question** (the agent is
asking the human something — clarification, choice, missing fact, etc.),
then **ignore the automatic enqueue / pin for that idle transition**.

- Leave the pinned item in the queue (do not dequeue or start it).
- Do **not** post or act on the auto-start path that would steal the
  human's attention away from answering the host.
- Let the human reply to the host's question first.
- After that human answer turn completes (or the human explicitly
  `/queue` / re-pins / picks), normal pin / idle-poll behaviour may resume.

Rationale: auto-chaining a queued demand on top of an unanswered host
question races the human and loses the clarification the agent needed.

Specifier: reuse whatever existing "host message is a question /
needs-human" signal the bridge or panel already has (e.g. needs-human /
decision-menu / AskUserQuestion chrome detection) if one is honest; do not
invent a second classifier if an existing one covers the live cases. If none
is reliable enough, name the minimal detection in the feature and fail closed
toward **holding the pin** (prefer false hold over false auto-start).

## Preferred shape (from plan; specifier may refine)

1. **Pin while busy** — queue presentation while a run is in flight means
   enqueue-next (auto-start when idle), not run-now.
2. **Idle with pin and host reply is NOT a question** — start pinned prompt;
   skip choose-next poll.
3. **Idle with pin and host reply IS a question** — **hold**: keep pin (or
   keep item queued without starting); no auto-start; human answers host.
4. **Idle without pin** — existing choose-next poll.
5. **`/queue` while busy** — enqueue-next poll (supersede prior poll id as
   today).
6. Optional default from plan: FIFO auto-start when exactly one pending and
   no pin — **but the amendment still wins**: never FIFO/pin auto-start over
   a host question.

State: optional `enqueueNextPromptId` on `CursorBridgePersistedState`.

## Out of scope

- Bubble UI; Local Agent queue.
- Full queue reordering beyond one "next" pin.
- Auto-running N≥2 without a pin (still need pin or idle pick).
- New Telegram product surface beyond Host topic maintain.

## Related

- `docs/how-to/BL-810-host-queue-selection-poll-clear-all-and-ttl.md`
- `extension/src/tools/telegramCursorBridgeLive.ts` /
  `telegramCursorBridgeCore.ts`
- Prior Cursor plan (same day): "Enqueue next queue pin" — this intake is
  the durable drain target; plan alone was not filed until now, plus the
  question-hold amendment.

## Acceptance sketch

- Feature: while busy, human can pin a queued item as enqueue-next; ack
  confirms; pin survives until idle start, clear-all, drop, or expiry.
- Feature: idle + valid pin + host final message is **not** a question →
  that item starts without a choose-next poll.
- Feature: idle + valid pin + host final message **is** a question → pin
  is **not** auto-started; human can answer the host; queued item remains
  available afterward.
- Feature: idle without pin → existing choose-next poll unchanged.
- Property/unit: busy vote no longer silently dropped when mode is
  enqueue-next; stale pin ignored; clear-all clears pin.
