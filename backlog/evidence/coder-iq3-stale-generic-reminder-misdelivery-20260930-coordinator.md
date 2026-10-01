# coder@iq3 claims stale `to: coder` reminder notes meant for whichever seat holds the ticket — 2026-09-30, coordinator

## Pattern (2 occurrences today)

1. **BL-1816** (~12:15Z): coder@iq3 dequeued a `"BL-1816 still todo -
   build+forward BEFORE completing this note"` reminder and crash-looped on
   it for ~40 min with zero progress. Coordinator reclaimed it back to the
   primary coder (see `backlog/evidence/coder-iq3-reliability-20260930-coordinator.md`).
2. **BL-1830** (~14:42Z): coder@iq3 dequeued a `"BL-1830 still todo -
   build+forward BEFORE completing this note"` reminder — but the PRIMARY
   coder was already actively landing real commits on BL-1830 at that
   exact time (`BL-1830: fix dangling evidence-file citation found in
   self-audit`, plus prior land/merge commits). Coordinator cleared the
   stale claim from coder@iq3's `in_process/` (moved to `abandoned/`); no
   fresh dispatch needed since the real work was already progressing
   elsewhere.

## What this looks like

These reminder notes are addressed `to: coder` / `recipient: coder`
(generic, not `to: coder@iq3`), but physically land in whichever seat's
worktree calls `ready_for_next.sh` first — including `coder@iq3`, even
when the primary `coder` seat is the one actually holding and progressing
the ticket. Whatever produces these "still todo - build+forward" reminders
(looks like a stalled-ticket chase/nudge, not a normal fresh dispatch)
appears to treat "coder" as one undifferentiated role for delivery, not
aware that two independent physical seats (`coder`, `coder@iq3`) can now
both poll for work under that name.

## Why this matters for the iq3 epic specifically

Every time this happens, coder@iq3 burns a chunk of its already-tight
context window (and a full session, given the crash-loop tendency under
investigation in BL-1840/1841) on a reminder it cannot act on productively
(the ticket is already done or in progress elsewhere). This is likely
contributing to - not just coinciding with - the instability BL-1837/1838/
1840/1841 are chasing: extra unproductive context churn stacked on top of
the window/compression issues those tickets already cover.

## Suggested scope

Whatever sends these stalled-ticket reminder notes should target the
SPECIFIC seat/worktree currently holding the ticket's claim (or the
ticket's `assigned_to` field, if that's seat-specific), not a bare `to:
coder` that any seat sharing that logical role name can claim.
