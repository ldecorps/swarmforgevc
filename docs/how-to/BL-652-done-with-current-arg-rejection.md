# `done_with_current.sh` refuses every argument except `--no-work` (BL-652, BL-1422)

`done_with_current.sh` completes the current in_process parcel (task mode) or
archives the whole in_process batch (batch mode). It previously dropped argv
in `dispatch_lib.bb`'s `run-helper!`, so a usage probe like
`done_with_current.sh --help` still ran the full destructive completion —
including archiving unworked batch items and chaining `ready_for_next`.

## Contract

The done_with_current family takes **no arguments**, with one exception
(BL-1422, below): `--no-work "<reason>"` (non-blank reason) on task-mode
completion of a Work dispatch note. Any other argv (including `--help`,
`-h`, junk, a bare `--no-work` with no reason, or a blank reason) fails
fast:

- non-zero exit (exit 2)
- usage text: `Usage: done_with_current.sh takes no arguments, or --no-work "<reason>"`
- **no** completion side effects (nothing moved, no `completed_at`, no
  ready_for_next / idle-boundary, no rotation)

Wired on entry (`done_with_current.bb`) and on both helpers
(`done_with_current_task.bb`, `done_with_current_batch.bb`) via
`dispatch-lib/refuse-unexpected-args!`.

Argumentless invocation is unchanged for every non-Work-note parcel:
archive / stamp / chain as before.

## `--no-work` and the Work-note evidence gate (BL-1422)

`route_backlog_to_coder.sh` dispatches a ticket as a priority-10 note whose
message reads `Work <ticket>: read file in backlog/active`. Completing that
note with no work done silently lost the dispatch — a role clearing a queue
of chase notes with back-to-back `done_with_current.sh` calls swept the
Work note out unread along with them (BL-1384 was blind-completed four
times in one day this way, each costing a coordinator round trip with the
ticket still unworked).

Task-mode completion now recognises a Work note (via
`chase-sweep-lib/dispatch-trail-ticket-id`, BL-1223's one dispatch-trail
parser) and, for one, requires evidence of work **since the note's own
`dequeued_at`**:

- a commit on the role's current branch whose subject's leading ticket id
  is exactly the dispatched ticket (`git log --since=<dequeued_at>`), or
- a `git_handoff` in the role's own `outbox/` or `sent/` mailbox, created
  after `dequeued_at`, whose `task:` header names the ticket.

| Case | Result |
| --- | --- |
| Work note, evidence found | Completes exactly as any other note |
| Work note, no evidence, no `--no-work` | Refused (exit 1, `WORK_NOT_EVIDENCED: <ticket> has no commit or git_handoff naming it since dequeue.`); the note stays in_process, nothing dequeued |
| Work note, no evidence, `--no-work "<reason>"` | Completes; the completed file gains `no_work_reason: <reason>` and `no_work_at:` so the coordinator and BL-1415's dropped-parcel verdict read a deliberate non-start, not an inferred one |
| Any non-Work note, or a `git_handoff` | Completes exactly as today — this gate never applies |

Re-routing on a `--no-work` completion is out of scope here — the dropped-
parcel sweep's own action (BL-1415) is unchanged; this ticket only stops
the silent sweep at the moment of completion.

## Operator / agent check

```bash
# Must refuse — parcel stays in in_process
done_with_current.sh --help

# A Work note with no work done: refused
done_with_current.sh
# WORK_NOT_EVIDENCED: BL-9001 has no commit or git_handoff naming it since dequeue.

# Deliberate non-start, recorded rather than silent
done_with_current.sh --no-work "waiting on BL-9000"

# Completes only with zero args (or the one --no-work exception above)
done_with_current.sh
```

Out of scope: `ready_for_next.sh`'s internal `--idle-boundary` contract;
batch-mode completion never receives Work notes (batch roles receive
`git_handoff`s), so this gate does not apply to
`done_with_current_batch.bb`.

Acceptance: `specs/features/BL-652-done-with-current-arg-rejection.feature`,
`specs/features/BL-1422-a-work-note-is-not-completed-without-work.feature`.
