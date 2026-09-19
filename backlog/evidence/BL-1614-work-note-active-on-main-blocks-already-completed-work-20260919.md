# BL-1614's active-on-main refusal blocks a Work note whose real work
# already happened, when the note's dequeue is re-stamped later than that
# work — coder evidence, 2026-09-19

## What happened

Inbound `10_20260918T150112Z_009529_from_coordinator_to_coder_for_coder.handoff`,
message "Work BL-1637: merge main first, then read backlog/active".

- I merged main, read `backlog/active/BL-1637-*.yaml`, implemented the
  ticket, ran the full verification (bb runner, unit lane, property lane
  incl. a coder-authored non-vacuous property test, acceptance suite),
  committed `d59f181d38` (subject: "BL-1637: a seat's forward is filed
  where its completion gate looks"), and sent a `git_handoff` to the
  cleaner: `50_20260919T020229Z_002048_from_coder_to_cleaner.handoff`,
  delivered at `2026-09-19T02:02:29Z`.
- Only afterward did I run `ready_for_next.sh` for the first time this
  session (an earlier attempt had refused with `WORKTREE_DRIFT_DETECTED`
  before touching the queue). It processed two other already-in_process
  items first (an architect merge-only note for BL-1635, a QA merge-up
  note for BL-831), then reached this Work note and (re-)dequeued it,
  stamping `dequeued_at: 2026-09-19T02:05:03.429278153Z` — three minutes
  *after* my commit and forward above.
- `done_with_current.sh` (plain) refused: `WORK_NOT_EVIDENCED` — no
  commit/git_handoff naming BL-1637 since 02:05:03Z (correct: none
  exists, since the real work predates this dequeue stamp).
- `done_with_current.sh --no-work "<honest reason>"` refused:
  `WORK_ACTIVE_ON_MAIN: BL-1637 is active on main at fb259484b4` — even
  after merging main. `work_note_evidence_lib.bb`'s
  `work-note-completion-decision` refuses *any* stated reason whenever
  the ticket is active on main, by design (BL-1614's own comment: "a
  Work note is never completed with a no-work reason while its ticket
  sits in backlog/active on main"). But a ticket genuinely in flight
  through the pipeline (coder→cleaner→…→QA) is *always* active on main
  until QA closes it — so this refusal fires unconditionally for any
  Work note about a ticket still mid-pipeline, regardless of whether the
  reason is a true "already done and forwarded" or a false "not
  promoted."

## Why this is a gap, not a false alarm

BL-1614 was built to stop an agent declining a Work note with "not
promoted" when the ticket actually *was* promoted (a stale worktree
read). My case is the opposite shape: the ticket was genuinely promoted,
I genuinely did the work and forwarded it, and the *note's own dequeue
timestamp* is the stale artifact — re-stamped later than the real
evidence because this note was queued behind other in_process items
processed first in the same `ready_for_next.sh` run. The decision table
has no clause distinguishing "no work exists" from "work already
happened before this dequeue" — both hit `:refuse-active-on-main` the
same way once a reason is given, and plain completion requires evidence
*strictly after* a dequeue stamp that can legitimately postdate real
work in this multi-item-queue-then-dequeue shape.

## What I did NOT do

- Did not fabricate a commit or resend the git_handoff just to manufacture
  a post-02:05:03Z timestamp (the parcel is already live at the cleaner;
  a resend risks the exact duplicate-parcel shape BL-1637's own note
  warned against).
- Did not force the inbound out of in_process by any other means.

## Current state

The inbound (`10_20260918T150112Z_009529_...handoff`) remains in
`in_process`, uncompleted, pending adjudication. BL-1637 itself is
unaffected and already progressing (forwarded to cleaner, commit
`d59f181d38`).

By coder.
