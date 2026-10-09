# Coordinator finding: sibling-rework defer wedges the whole stage queue

Date: 2026-10-09
Reporter: coordinator

## What happened

The bare `coder` seat (local-model/iq3) sat `State: idle` for an extended
period with real, valid work queued behind it (BL-2091, BL-2094, BL-2024,
BL-1784 — all live `Work <id>` dispatch notes `to: coder`), yet
`ready_for_next.sh` kept returning `NO_TASK`.

Root cause: the head-of-queue item was a `Work BL-2077` rebuild note. BL-2077
had previously been worked by the *other* coder-tier seat (coder@2), so the
sibling-rework defer logic correctly refused to let the bare `coder` seat
claim it ("DEFERRED sibling-rework ... was worked by another seat of this
stage; leaving it in the stage queue for that seat until the cross-seat
deadline"). That refusal is correct in isolation — but the dispatcher then
reports `NO_TASK` for the whole call, instead of skipping the deferred head
item and serving the next eligible queued item behind it.

Net effect: ANY deferred head-of-queue item (sibling-rework, or any other
reason a seat might legitimately defer) silently starves every other queued
item behind it at that stage, with no error, no nudge, and no babysitter
finding — a seat reads as cleanly idle ("nothing to do") when it is actually
blocked by an unrelated head-of-line item.

## Minimal action taken this time (coordinator, by hand)

Pulled the blocking `Work BL-2077` note out of the bare `coder` seat's
`inbox/new/` and re-sent it addressed specifically `to: coder@2` (the seat
it was actually reserved for), which unblocked the queue immediately. This
is a one-off workaround, not a fix — it required a human/coordinator to
notice the idle-with-queued-work mismatch by hand; nothing detects this on
its own.

## What's worth fixing

1. **Detection**: a babysitter check that flags "seat reads NO_TASK/idle but
   its stage inbox/new/ holds >0 items" as its own finding class (distinct
   from the existing `seat-stuck-<role>` and generic parcel-aging checks,
   both of which only look at claimed/in_process items, never an unclaimed
   queue sitting behind a defer).
2. **Prevention**: the dispatcher (`ready_for_next_task.bb` / whatever owns
   the sibling-rework defer decision) should skip a deferred head item and
   continue scanning the queue for the next eligible item, rather than
   returning `NO_TASK` for the whole call. The defer-to-sibling behavior
   itself is correct and should stay; only the "stop scanning on defer"
   behavior is the defect.

## Scope note

This is a fix to the swarm's own queue/dispatch machinery (forge process),
not a change to the product the swarm builds — same altitude as other
`swarmforge/scripts/*.bb` tickets, not a dogfood-ambiguous item.
