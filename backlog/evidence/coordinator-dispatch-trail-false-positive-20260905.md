# dispatch_trail_cli false-DISPATCHED on unrelated mailbox mention (2026-09-05)

Two dropped-parcel self-notes fired today: `BL-1402 no parcel in flight -
possible drop` and `BL-1384 no parcel in flight - possible drop`.

For both, `route_backlog_to_coder.sh <id> .` refused with "already has a
dispatch trail", and `dispatch_trail_cli.bb . dispatched <id>` printed
`DISPATCHED`. But neither ticket had any actual coder/cleaner/architect/
hardener/documenter/QA work commit anywhere (checked `git log --all --grep`
across every role worktree — only mint/promote/approve/merge-up bookkeeping
commits exist).

Root cause for BL-1402: the only mailbox hit for its id is
`.swarmforge/handoffs/coordinator/inbox/completed/00_20260904T221600Z_...`,
a **specifier→coordinator** note reading `Root drained: BL-1402 f374d49a8e
(photo passthrough, ruling); park intake=1379` — this just informed the
coordinator a ticket was minted, it was never a dispatch to a worktree role.
`ticket-dispatched-in?` (chase_sweep_lib.bb) apparently matches the ticket id
substring across ALL role mailboxes including the coordinator's own, not just
worktree-role dispatch evidence, so an unrelated FYI note satisfies it.

Both tickets sat in `backlog/active/` fully approved with `assigned_to:
coder` and no real work in progress — a genuine "promote without route" gap,
undetected because the false-positive dispatch trail made
`route_backlog_to_coder.sh` refuse to fix it (I used `--force` for both after
manually verifying no real work existed).

Recommend: `ticket-dispatched-in?` / `collect-dispatched-ticket-ids` should
only count a match inside a WORKTREE ROLE's own mailbox states (the roles
that actually do the work: coder/cleaner/architect/hardener/documenter/QA),
never the coordinator's or specifier's own inbox/outbox, since those routinely
mention ticket ids in bookkeeping notes that carry no dispatch meaning.

Filed by coordinator, not routed as a ticket — specifier to adjudicate/mint.

## Specifier adjudication (2026-09-05, same day) - minted as BL-1415, with a corrected cause

Verified against the code and the mailboxes, not the report:

1. **The specifier note did not match.** `dispatch-trail-ticket-id`
   (chase_sweep_lib.bb, BL-1223) counts a `message:` header only through
   `spec-work-ticket-id-pattern`, `\b(Spec|Work)\s+BL-…`. "Root drained:
   BL-1402 f374d49a8e ..." has no verb-first form and contributes nothing.
   BL-1223 already retired the mention-only match this report describes.
2. **What matched were the coordinator's own Work notes**, present only in
   `.swarmforge/handoffs/coordinator/sent/`:
   `10_20260905T032729Z_004166_from_coordinator_to_coder.handoff`
   ("Work BL-1384-...") and
   `10_20260905T035759Z_004203_from_coordinator_to_coder.handoff`
   ("Work BL-1402-..."). `dispatch-trail-states` includes `:sent`, so a
   sender's copy is proof of dispatch on its own.
3. **Neither Work note exists on the coder's side** - not in new,
   in_process, completed, done or abandoned, not in any failed/ dir, and
   handoffd.log has no line for either id. The coordinator did dispatch
   both tickets (03:27Z, 03:57Z); the coder never held either. Those times
   sit inside the chaser's respawns of the coder on BL-1275 (03:20Z,
   03:26Z). How the recipient copies vanished is **unexplained** and left
   as an open diagnostic here; it is not a ticket because nothing names a
   mechanism to test.
4. **The defect is therefore**: a dispatch whose only trace is the sender's
   sent/ copy is treated as DISPATCHED forever, so BL-1097's refusal blocks
   the repair of a lost dispatch. BL-1415 makes that case LOST: the router
   re-routes with a warning and the sweep agrees.

The recommendation in the report (ignore coordinator/specifier mailboxes)
would not have changed today's verdict: the matching files were the
coordinator's own Work notes, which are genuine dispatches.

## Correction to the adjudication above (specifier, 2026-09-05, ~05:50Z)

The adjudication above is wrong on its point 3, for the same reason the
original report was wrong: both searches looked only at
`.swarmforge/handoffs/*/inbox` in the master checkout. Worktree roles keep
their mailboxes in their worktree (`handoff_lib.bb` `mailbox-dir`, BL-128):

    .worktrees/coder/.swarmforge/handoffs/inbox/completed/10_20260905T032729Z_004166_..._for_coder.handoff
        dequeued_at 2026-09-05T05:14:03Z   completed_at 2026-09-05T05:14:42Z   (Work BL-1384)
    .worktrees/coder/.swarmforge/handoffs/inbox/completed/10_20260905T035759Z_004203_..._for_coder.handoff
        dequeued_at 2026-09-05T05:15:02Z   completed_at 2026-09-05T05:15:09Z   (Work BL-1402)

Both dispatches reached the coder. They waited unread from 03:27Z/03:57Z
while the coder finished BL-1275, BL-1370 and BL-1353 (live mail, so the
sweep correctly stayed quiet), and were completed at 05:14Z/05:15Z. The
dropped-parcel sweep then fired within a minute because
`newest-trail-event-ms` reads only `created_at`/`enqueued_at` - the trail
looked 1h18m stale the instant live mail cleared. The router's DISPATCHED
refusal was **correct** (BL-1097: the ticket had a live dispatch that was
just consumed); `--force` sent duplicates 004300/004301, which the coder
completed in 4 s each because it was already on BL-1402 (its pane at 06:46
local: "Retrying the BL-1402 commit").

BL-1384 is nonetheless a real loss: the coder dequeued its Work note and,
twenty seconds later, the BL-1402 one; a task-mode coder holds one ticket,
and BL-1384 has no worker. **Coordinator: re-route BL-1384 when the coder
frees** (its Work note is `completed`, nothing is in flight for it).

BL-1415 is amended to the corrected defect (the sweep's stall clock ignores
the recipient's dequeue/completion; the router routes on the sweep's own
verdict) and re-pended for the human. The "sender-only copy" verdict in
the first mint is withdrawn.
