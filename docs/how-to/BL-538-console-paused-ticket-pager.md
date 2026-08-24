# Reviewing Paused Tickets in the Mini App Console

Use the paused-ticket pager when you need to triage `backlog/paused/` from a
phone without opening the repository. It is part of the Telegram Mini App
console and runs on the existing bridge host.

## Open the Pager

Open the allowlisted SwarmForge console Mini App and choose **Paused tickets**.
The console links to `/paused-pager` on the bridge server. The HTML shell is
publicly reachable like the other Mini App shells, but the JSON feed and
control route require the console token.

The pager shows one paused ticket at a time:

- the ticket id and title at the top;
- the ticket YAML in the middle;
- a **Set highest priority, expedite** control at the bottom.

When `backlog/paused/` is empty, the pager shows an empty state and no
expedite control.

## Move Between Tickets

Use the previous and next controls, or swipe on a phone, to move through the
paused queue. Tickets are ordered by numeric priority ascending, then ticket id
ascending. Navigation stops at the first and last ticket; it does not wrap.

## Expedite a Ticket

Use **Set highest priority, expedite** only for work that should jump to the
front of the swarm queue. The control uses the same two-tap discipline as the
operator console's destructive actions: the first tap asks for confirmation and
does not change the ticket.

After confirmation, the bridge reuses the existing promote path
(`promoteToActive` in `extension/src/panel/backlogWriter.ts`), which
(BL-1083) consults the same promotion-gates chokepoint
`promote_and_route_next.sh` uses — `depends_on`, a `backlog/hold/` marker, and
`active_backlog_max_depth` — before moving anything. Expedite records the
human's tap as the ticket's approval BEFORE the gates run, so
`human_approval` is satisfied rather than skipped; it does not bypass
`depends_on`, hold, or the depth cap.

- **Allowed**: sets the ticket priority to `0`, moves the ticket from
  `backlog/paused/` to `backlog/active/`, and leaves the pager on the next
  remaining paused ticket, or the empty state. The durable commit names
  **both** ends of that rename (paused deletion + active addition) so the
  ticket never sits in two folders at once (BL-1091); plain Approve/Reject/
  Amend still commit exactly one path.
- **Refused**: the ticket is left exactly where it was (still in
  `backlog/paused/`, priority unchanged) and the pager shows the gate's own
  name and reason — e.g. an unlanded `depends_on` id, or the ticket being
  held — as a 409 response rather than a bare failure ([BL-572/BL-662](BL-662-paused-pager-shows-server-failure-reason.md)).
  The same gate consultation guards the Telegram Expedite verb; a ticket
  refused here is refused there too, since both call the one mover.

The pager is not a general YAML editor. It only supports reviewing paused
tickets and expediting one ticket at a time.
