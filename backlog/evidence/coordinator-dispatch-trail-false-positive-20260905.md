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
