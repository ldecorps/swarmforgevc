# ANSWER — Bubble answering seat: option B (dedicated worker, stays a mirror)

Asked by: specifier, via `role_ask.bb` 2026-08-29 ~01:52Z (marker
`.swarmforge/operator/role-awaiting/specifier.json`).
Answered by: the human, 2026-08-30, directly in the specifier's live session
(not through the Telegram bot — the bot did not record it, so the marker was
cleared with `role_ask.bb --resolve`).

## Question as posed

> Bubble seat (intake: Bubble goes quiet while Cursor is busy). Today Bubble
> is a MIRROR topic and both it and Cursor's host topic route to the ONE
> Cursor answering seat. Giving Bubble its own seat can mean two different
> things, and it changes the spec: (A) INDEPENDENT responder - Bubble answers
> on its own in parallel and may diverge from what you see at the front desk
> (a genuine second brain); or (B) DEDICATED WORKER - Bubble stays a mirror of
> the front desk but gets its own worker so it stays answerable while Cursor
> is busy (lighter). Which?

## Answer

**B — dedicated worker, stays a mirror.**

As presented and selected:

> Bubble remains a mirror of the front desk but gets its own worker, so it
> stays answerable while Cursor is busy. Lighter, preserves "Bubble = phone
> view of the front desk", and cannot diverge from what you see at the front
> desk.

Behaviour selected:

```
  Bubble topic (11810) -> its own worker
  Cursor topic  (8435)  -> Cursor seat

  Same answers as the front desk, just not
  blocked behind Cursor's current turn.
```

Acceptance shape selected:

```
  - Bubble answers while Cursor seat is busy
  - Bubble's answer == front desk's answer
  - no cross-answering between seats
  - one getUpdates owner (no 409 regression)
```

## Disposition

Unblocks `backlog/INTAKE-bubble-own-seat-parallel-answering.yaml`, specced as
**BL-1296**. Option A (independent responder / second brain) is NOT being
built; divergence from the front desk is explicitly out of scope.
