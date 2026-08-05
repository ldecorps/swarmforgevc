# Raw intake — Host queue: poll to pick / clear, 72h expiry, auto-present when idle

Status: new intake, not minted. Capture only (human via Cursor 2026-08-05
~09:40 CEST). Surface: the **Host / Cursor Remote bridge question queue**
(`pendingPrompts` on the cursor-bridge state), not `role_ask` / Approvals.

Related
- Existing (partial) plumbing in `extension/src/tools/telegramCursorBridgeLive.ts`:
  `postQueueSelectionPoll`, `processQueuedPollAnswer`, `/queue`,
  `Busy — question queued (N waiting). I will ask you to pick one when ready.`
  Queued items already carry `createdAtMs`. Auto-present on idle is attempted
  at end of `runCursorBridgePollOnce`, but the human experience is still wrong
  or incomplete — treat this intake as product completion, not greenfield.
- BL-767 (approved, paused) — queued answers must land in the origin topic;
  its out-of-scope note called the "choose which queued question runs next"
  poll a separate feature. This intake *is* that feature (plus clear/TTL).
- BL-764 / `docs/how-to/BL-764-front-desk-shared-token-bridge-fanout.md` —
  busy-queue poll staying Cursor-Remote-only for Bubble-originated messages
  was flagged as a follow-up; specifier decides whether this intake owns that
  or stays Host-topic-only for v1.
- BL-725 — rename Cursor Remote → Host (paused); use current topic names in
  prose, do not block on the rename.
- Not this intake: BL-568 (pane AskUserQuestion menus as polls), BL-772
  (role_ask attention epic), Bubble clarification sheet intake — different
  queues / surfaces. Do not merge without asking.

## Goal

When the Host bridge has finished a turn and questions are waiting in the
queue:

1. Present the queued questions **as a Telegram poll**.
2. Selecting an option **runs that question immediately** (send it to the
   Host agent as the next turn) and **removes it from the queue**.
3. The poll includes a **"clear all"** option that empties the queue without
   running anything.
4. Any question left in the queue **longer than 72 hours** is auto-cleared
   (dropped, not run), with a short receipt so the human knows what vanished.
5. The queue poll is presented **automatically** once the Host has finished
   working (idle / not busy) — the human should not have to remember `/queue`.

## Problem

- Questions typed while the Host is busy are acknowledged ("queued") but the
  follow-up pick UX is unreliable or incomplete: no clear-all, no age expiry,
  and auto-present-when-ready does not consistently feel like a first-class
  product surface.
- Stale queued prompts can pile up across days of continuous shifts and then
  fire unexpectedly when the bridge next goes idle.
- Dropping or ignoring the queue silently wastes the human's earlier asks.

## Why this matters

- Continuous 3-shift operation means the Host is often busy; the queue is the
  normal path for follow-up asks from the phone, not an edge case.
- A poll is the right attention + decision surface on Telegram (tap once).
- 72h TTL keeps the queue from becoming a landmine of forgotten prompts.

## Human decisions locked in this conversation (2026-08-05)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Poll presentation.** Queued questions appear as a native Telegram poll
   (one option per queued item, truncated labels OK within Telegram limits).
2. **Select = run + dequeue.** Voting an item option sends that prompt to the
   Host as the next turn and removes only that item from the queue.
3. **"Clear all" option.** Always present on the queue poll (when the queue is
   non-empty). Choosing it clears every pending prompt and does not start a
   Host turn. Specifier picks exact label (default proposal: `Clear all`).
4. **72-hour auto-clear.** Measured from each item's existing `createdAtMs`.
   Sweep on a natural cadence (idle transition and/or poll loop is fine —
   specifier picks). Dropped items get a short durable receipt in the Host
   topic (and origin topic if BL-767's origin field lands / already applies).
5. **Auto-present when Host finishes.** When the bridge transitions to idle
   with a non-empty queue, post the selection poll without requiring `/queue`.
   Manual `/queue` may remain as a refresh / list path.
6. **One live queue poll at a time.** Do not stack duplicate selection polls
   for the same queue snapshot (existing `pendingPromptPoll` guard is the
   right idea; keep it sound).
7. **Out of v1 unless specifier folds them in.** Reordering by drag; multi-
   select run-all; answering a *choice* question that was queued as free text
   without re-asking; Bubble Android UI for the same queue.

## Requested outcome

1. Specifier mints paused ticket(s) under an appropriate epic (likely
   `swarmforge-console` / Host bridge family — specifier picks; may be a
   slice that BL-767's out-of-scope note anticipated).
2. Behaviour above is acceptance-backed (Gherkin): auto-present on idle,
   select runs+removes, clear-all empties, 72h TTL drops with receipt,
   no duplicate poll spam.
3. Wire through the real shared-token / front-desk `poll_answer` fan-out so
   the vote actually reaches the bridge (do not leave another dark producer /
   consumer pair).
4. Docs / how-to updated for `/queue` + auto-present + clear-all + TTL.

## Open questions for the specifier (defaults OK if human is quiet)

- Clear-all confirmation: one tap vs Confirm/Cancel buttons? Default: **one
  tap on the poll option** (human asked for an option on the poll, not a
  second dialog).
- Receipt verbosity for 72h drops: one summary line vs per-item. Default:
  **one summary** naming count + oldest/newest age; per-item only if ≤3.
- Bubble-originated queued asks: should the selection poll post in the origin
  topic (BL-767 spirit) or only Host? Default proposal: **origin topic when
  known, else Host** — amend if too wide for v1.

## Out of scope

- Role_ask / Approvals / pane-menu poll transport (BL-568, BL-772).
- Making the unit suite green (separate intake).
- Changing what the Host agent decides — only how queued human prompts are
  presented, expired, and drained.
